// index.js
// Simple proxy server for Binance endpoints used by the TWOT AI frontend.
// Keeps behavior minimal and robust: time, ticker, klines, depth endpoints.
const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve static frontend from /public if present
app.use(express.static(path.join(__dirname, 'public')));

// Binance API base
const BINANCE = 'https://api.binance.com/api/v3';

// Helper: fetch JSON with timeout and error handling
async function getJSON(url, opts = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeout || 8000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'twot-ai-proxy' } });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

// Health / root
app.get('/', (req, res) => res.json({ ok: true, msg: 'TWOT AI proxy server running' }));

// /proxy/time -> returns { serverTime }
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
    const data = await getJSON(url, { timeout: 10000 });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// /proxy/depth?symbol=BTCUSDT&limit=5
app.get('/proxy/depth', async (req, res) => {
  const symbol = (req.query.symbol || 'BTCUSDT').toUpperCase();
  const limit = Math.min(500, Number(req.query.limit) || 50);
  try {
    const url = `${BINANCE}/depth?symbol=${symbol}&limit=${limit}`;
    const data = await getJSON(url, { timeout: 8000 });
    // Return bids/asks as received; client will fallback if structure missing
    res.json(data);
  } catch (e) {
    // Surface error so client can attempt fallback
    res.status(500).json({ error: e.message });
  }
});

// Start server (PORT provided by hosting environment)
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`TWOT AI proxy server listening on port ${PORT}`));
