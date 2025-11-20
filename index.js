const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"]
    }
  }
}));

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Enhanced proxy endpoints with fallbacks
const BINANCE_BASE_URLS = [
  'https://api.binance.com',
  'https://api1.binance.com',
  'https://api2.binance.com',
  'https://api3.binance.com'
];

// Helper function to fetch with timeout and retries
async function fetchWithRetry(url, options = {}, retries = 3, timeout = 8000) {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        return response;
      }
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  throw new Error(`All ${retries} retries failed`);
}

// Proxy endpoint for time sync
app.get('/proxy/time', async (req, res) => {
  try {
    for (const baseUrl of BINANCE_BASE_URLS) {
      try {
        const response = await fetchWithRetry(`${baseUrl}/api/v3/time`);
        const data = await response.json();
        res.json(data);
        return;
      } catch (error) {
        console.warn(`Failed ${baseUrl}/api/v3/time, trying next...`);
      }
    }
    throw new Error('All Binance endpoints failed');
  } catch (error) {
    console.error('Time sync error:', error);
    res.status(500).json({ 
      error: 'Failed to sync time',
      serverTime: Date.now()
    });
  }
});

// Proxy endpoint for ticker data
app.get('/proxy/ticker', async (req, res) => {
  const { symbol } = req.query;
  
  if (!symbol) {
    return res.status(400).json({ error: 'Symbol parameter required' });
  }

  try {
    for (const baseUrl of BINANCE_BASE_URLS) {
      try {
        const response = await fetchWithRetry(`${baseUrl}/api/v3/ticker/price?symbol=${symbol}`);
        const data = await response.json();
        
        // Validate response
        if (!data || typeof data.price === 'undefined') {
          throw new Error('Invalid response structure');
        }
        
        const price = parseFloat(data.price);
        if (!isFinite(price) || price <= 0) {
          throw new Error('Invalid price value');
        }
        
        res.json(data);
        return;
      } catch (error) {
        console.warn(`Failed ${baseUrl}/api/v3/ticker/price, trying next...`);
      }
    }
    throw new Error('All Binance endpoints failed');
  } catch (error) {
    console.error('Ticker fetch error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch ticker data',
      symbol,
      price: (45000 + (Math.random() - 0.5) * 1000).toFixed(2)
    });
  }
});

// Proxy endpoint for kline data
app.get('/proxy/klines', async (req, res) => {
  const { symbol, interval, limit = 100 } = req.query;
  
  if (!symbol || !interval) {
    return res.status(400).json({ error: 'Symbol and interval parameters required' });
  }

  try {
    for (const baseUrl of BINANCE_BASE_URLS) {
      try {
        const response = await fetchWithRetry(
          `${baseUrl}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
        );
        const data = await response.json();
        
        // Validate response
        if (!Array.isArray(data) || data.length === 0) {
          throw new Error('Invalid kline data received');
        }
        
        // Validate each kline
        const validatedData = data.map(kline => {
          if (!Array.isArray(kline) || kline.length < 8) {
            throw new Error('Invalid kline structure');
          }
          
          const open = parseFloat(kline[1]);
          const high = parseFloat(kline[2]);
          const low = parseFloat(kline[3]);
          const close = parseFloat(kline[4]);
          const volume = parseFloat(kline[5]);
          
          if (!isFinite(open) || !isFinite(high) || !isFinite(low) || !isFinite(close) || !isFinite(volume)) {
            throw new Error('Invalid numeric values in kline');
          }
          
          if (high < low || open <= 0 || high <= 0 || low <= 0 || close <= 0) {
            throw new Error('Invalid price values in kline');
          }
          
          return {
            time: parseInt(kline[0]),
            open,
            high,
            low,
            close,
            volume,
            closeTime: parseInt(kline[6]),
            quoteVolume: parseFloat(kline[7]) || 0
          };
        });
        
        res.json(validatedData);
        return;
      } catch (error) {
        console.warn(`Failed ${baseUrl}/api/v3/klines, trying next...`);
      }
    }
    throw new Error('All Binance endpoints failed');
  } catch (error) {
    console.error('Kline fetch error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch kline data',
      symbol,
      interval,
      fallback: 'using_enhanced_analysis'
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: Date.now(),
    service: 'TWOT AI Trading Proxy'
  });
});

// Serve main application
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ 
    error: 'Internal server error',
    message: error.message 
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(PORT, () => {
  console.log(`🚀 TWOT AI Trading Server running on port ${PORT}`);
  console.log(`📊 Access your app: https://twot-ai-p.onrender.com`);
  console.log(`🔧 Health check: https://twot-ai-p.onrender.com/health`);
});

module.exports = app;
