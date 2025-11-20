// index.js
// TWOT AI proxy + persistence + calibration
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const BINANCE = 'https://api.binance.com/api/v3';
const DATA_PATH = path.join(__dirname, 'twot_data.json');

// default persisted structure
const DEFAULT_STORE = {
  weights: {
    patternWeights: { orderBlock:1, fvg:1, liquidity:1, volume:1, rsi:1, macd:1, stoch:1, momentum:1, priceAction:1 },
    contextWeights: { uptrend:1, downtrend:1, ranging:1 },
    marketBias: 0
  },
  history: [] // rated entries { id, symbol, timeframe, type, correctedType?, outcome, analysis, created, outcomeTime }
};

// load or initialize store
function loadStore(){
  try{
    if(!fs.existsSync(DATA_PATH)){
      fs.writeFileSync(DATA_PATH, JSON.stringify(DEFAULT_STORE, null, 2));
      return JSON.parse(JSON.stringify(DEFAULT_STORE));
    }
    const raw = fs.readFileSync(DATA_PATH, 'utf8');
    return JSON.parse(raw);
  }catch(e){
    console.error('Failed to load store, using default', e);
    return JSON.parse(JSON.stringify(DEFAULT_STORE));
  }
}
function saveStore(store){
  try{
    fs.writeFileSync(DATA_PATH, JSON.stringify(store, null, 2));
    return true;
  }catch(e){ console.error('Failed to save store', e); return false; }
}

// simple getJSON helper with timeout
async function getJSON(url, timeout=8000){
  const controller = new AbortController();
  const id = setTimeout(()=>controller.abort(), timeout);
  try{
    const res = await fetch(url, { signal: controller.signal, headers:{ 'User-Agent':'twot-ai-proxy' } });
    clearTimeout(id);
    if(!res.ok) throw new Error('HTTP '+res.status);
    return await res.json();
  }catch(e){
    clearTimeout(id);
    throw e;
  }
}

// Proxy endpoints (unchanged)
app.get('/proxy/time', async (req, res) => {
  try {
    const data = await getJSON(`${BINANCE}/time`, 4000);
    res.json({ serverTime: data.serverTime });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/proxy/ticker', async (req, res) => {
  const symbol = (req.query.symbol || 'BTCUSDT').toUpperCase();
  try {
    const data = await getJSON(`${BINANCE}/ticker/price?symbol=${symbol}`, 5000);
    res.json({ symbol: data.symbol, price: data.price });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/proxy/klines', async (req, res) => {
  const symbol = (req.query.symbol || 'BTCUSDT').toUpperCase();
  const interval = req.query.interval || '1m';
  const limit = Math.min(1000, Number(req.query.limit) || 200);
  try{
    const data = await getJSON(`${BINANCE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, 9000);
    res.json(data);
  }catch(e){
    res.status(500).json({ error: e.message });
  }
});

app.get('/proxy/depth', async (req, res) => {
  const symbol = (req.query.symbol || 'BTCUSDT').toUpperCase();
  const limit = Math.min(500, Number(req.query.limit) || 50);
  try{
    const data = await getJSON(`${BINANCE}/depth?symbol=${symbol}&limit=${limit}`, 7000);
    res.json(data);
  }catch(e){
    res.status(500).json({ error: e.message });
  }
});

/* ---------- Persistence API ---------- */

// GET /api/weights  -> return persisted weights + optional recent history
app.get('/api/weights', (req, res) => {
  const store = loadStore();
  res.json({ ...store.weights, history: store.history.slice(0,50) });
});

// POST /api/weights -> overwrite stored weights (body: weights)
app.post('/api/weights', (req, res) => {
  const body = req.body;
  if(!body || !body.patternWeights) return res.status(400).json({ error: 'invalid weights' });
  const store = loadStore();
  store.weights = body;
  const ok = saveStore(store);
  if(!ok) return res.status(500).json({ error: 'failed to save' });
  res.json({ ok:true });
});

// GET /api/history -> return full rated history (capped)
app.get('/api/history', (req, res) => {
  const store = loadStore();
  res.json({ history: store.history.slice(0,1000) });
});

// POST /api/history -> append a rated entry
app.post('/api/history', (req, res) => {
  const entry = req.body;
  if(!entry || !entry.id) return res.status(400).json({ error: 'invalid entry' });
  const store = loadStore();
  store.history.unshift(entry);
  if(store.history.length > 2000) store.history.splice(2000);
  const ok = saveStore(store);
  if(!ok) return res.status(500).json({ error: 'failed to persist history' });
  res.json({ ok:true });
});

/* ---------- Calibration endpoint ---------- */
/*
  POST /api/calibrate
  - loads stored history (rated entries)
  - computes a simple calibration: for each pattern, compute success ratio and n
  - updates patternWeights by boosting patterns with positive correlation and reducing those with negative correlation
  - also adjusts marketBias by evaluating recent corrected entries
  - returns new weights
*/
app.post('/api/calibrate', (req, res) => {
  try {
    const store = loadStore();
    const hist = store.history || [];

    // Build counts per pattern
    const patternCounts = {}; // {pattern: {pos: n, neg: m, total}}
    for(const entry of hist){
      if(!entry.analysis || !entry.analysis.patterns) continue;
      const isSuccess = entry.outcome === 'Success';
      const isCorrection = entry.outcome === 'Corrected';
      for(const p of entry.analysis.patterns){
        patternCounts[p] = patternCounts[p] || {pos:0,neg:0,total:0};
        patternCounts[p].total++;
        if(isSuccess) patternCounts[p].pos++;
        if(isCorrection) patternCounts[p].neg++;
      }
    }

    // simple update: newWeight = oldWeight * (1 + alpha * (pos - neg)/max(1,total))
    const newWeights = Object.assign({}, store.weights.patternWeights);
    const alpha = 0.22; // strength factor
    for(const p in newWeights){
      const c = patternCounts[p] || {pos:0,neg:0,total:0};
      const delta = (c.pos - c.neg) / Math.max(1, c.total); // -1..1
      newWeights[p] = Math.max(0.25, Math.min(3, newWeights[p] * (1 + alpha * delta)));
    }

    // adjust marketBias by majority of corrections in recent history
    const recent = hist.slice(0,200);
    let bias = store.weights.marketBias || 0;
    let biasDelta = 0;
    let count = 0;
    for(const e of recent){
      if(e.correctedType){
        biasDelta += (e.correctedType === 'BUY') ? 1 : -1;
        count++;
      }
    }
    if(count > 0) {
      bias += Math.round((biasDelta / count) * 10); // scale
      bias = Math.max(-100, Math.min(100, bias));
    }

    // apply changes
    store.weights.patternWeights = newWeights;
    store.weights.marketBias = bias;
    saveStore(store);

    res.json({ ok:true, weights: store.weights });
  } catch(e){
    console.error('Calibration failed', e);
    res.status(500).json({ error: 'calibration failed' });
  }
});

/* ---------- Health ---------- */
app.get('/health', (req, res) => res.json({ ok:true }));

/* ---------- Start server ---------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, ()=>console.log(`TWOT AI proxy & store listening on ${PORT}`));
