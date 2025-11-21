const express = require('express');
const cors = require('cors');
const axios = require('axios');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS so your frontend can communicate
app.use(cors());

// Serve the static HTML file from the "public" folder
app.use(express.static(path.join(__dirname, 'public')));

// BASE URL for Binance API
const BINANCE_BASE = 'https://api.binance.com/api/v3';

// --- PROXY ROUTES ---

// 1. Get Ticker Price
app.get('/proxy/ticker', async (req, res) => {
    try {
        const { symbol } = req.query;
        const response = await axios.get(`${BINANCE_BASE}/ticker/price?symbol=${symbol}`);
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch price' });
    }
});

// 2. Get 24hr Stats
app.get('/proxy/24hr', async (req, res) => {
    try {
        const { symbol } = req.query;
        const response = await axios.get(`${BINANCE_BASE}/ticker/24hr?symbol=${symbol}`);
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// 3. Get Klines (Candlesticks)
app.get('/proxy/klines', async (req, res) => {
    try {
        const { symbol, interval, limit } = req.query;
        const response = await axios.get(`${BINANCE_BASE}/klines`, {
            params: {
                symbol: symbol,
                interval: interval || '1h',
                limit: limit || 500
            }
        });
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch klines' });
    }
});

// 4. NEW: Get Order Book Depth (THIS WAS MISSING)
app.get('/proxy/depth', async (req, res) => {
    try {
        const { symbol, limit } = req.query;
        const response = await axios.get(`${BINANCE_BASE}/depth`, {
            params: {
                symbol: symbol,
                limit: limit || 50
            }
        });
        res.json(response.data);
    } catch (error) {
        console.error('Depth Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch depth' });
    }
});

// Fallback: Serve index.html for any other route
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
