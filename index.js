const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Serve the main application
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'Trading AI is running' });
});

// API endpoint for server time (optional enhancement)
app.get('/api/time', (req, res) => {
    res.json({ 
        serverTime: Date.now(),
        timezone: 'UTC'
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Trading AI Server running on port ${PORT}`);
    console.log(`Access the app at: http://localhost:${PORT}`);
});





