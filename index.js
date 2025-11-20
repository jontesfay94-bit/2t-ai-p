// index.js
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend from /public
app.use(express.static(path.join(__dirname, 'public')));

// Binance base
const BINANCE = 'https://api.binance.com/api/v3';

// helper: fetch JSON with timeout and error handling
async function getJSON(url, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeout || 8000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'smc-proxy' } });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

// health
app.get('/', (req, res) => res.json({ ok: true, msg: 'SMC proxy server running' }));

// /proxy/time
app.get('/proxy/time', async (req, res) => {
  try {
    const data = await getJSON(`${BINANCE}/time`, { timeout: 5000 });
    res.json({ serverTime: data.serverTime });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// /proxy/ticker?symbol=BTCUSDT
app.get('/proxy/ticker', async (req, res) => {
  const symbol = (req.query.symbol || 'BTCUSDT').toUpperCase();
  try {
    const data = await getJSON(`${BINANCE}/ticker/price?symbol=${symbol}`);
    res.json({ symbol: data.symbol, price: data.price });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// /proxy/klines?symbol=BTCUSDT&interval=1m&limit=120
app.get('/proxy/klines', async (req, res) => {
  const symbol = (req.query.symbol || 'BTCUSDT').toUpperCase();
  const interval = req.query.interval || '1m';
  const limit = Math.min(1000, Number(req.query.limit) || 120);
  try {
    const url = `${BINANCE}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
    const data = await getJSON(url);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// /proxy/depth?symbol=BTCUSDT&limit=5
app.get('/proxy/depth', async (req, res) => {
  const symbol = (req.query.symbol || 'BTCUSDT').toUpperCase();
  const limit = Math.min(500, Number(req.query.limit) || 5);
  try {
    const url = `${BINANCE}/depth?symbol=${symbol}&limit=${limit}`;
    const data = await getJSON(url);
    // Return what Binance returns (bids/asks)
    res.json(data);
  } catch (e) {
    // Surface error so client can fallback if needed
    res.status(500).json({ error: e.message });
  }
});

// Start server (Render sets PORT)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SMC proxy server listening on port ${PORT}`));
