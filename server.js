require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

// Connection caching for Vercel
let isConnected = false;
async function connectToDatabase() {
  if (isConnected) return;
  const db = await mongoose.connect(process.env.MONGODB_URI);
  isConnected = db.connections[0].readyState === 1;
  const { startChangeStream } = require('./routes/notifications');
  startChangeStream();
}

const app = express();

// ── CORS ──────────────────────────────────
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
app.use(cors({
  origin: ['https://skillpilot-seven.vercel.app', 'http://localhost:5173', 'http://127.0.0.1:5173'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── BODY PARSING ─────────────────────────
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// ── ROUTES ───────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/submissions', require('./routes/submissions'));
const { router: notifRouter, startChangeStream } = require('./routes/notifications');
app.use('/api/notifications', notifRouter);

// ── HEALTH CHECK ─────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'Skillpilot API is running',
    timestamp: new Date().toISOString(),
    dbStatus: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

// ── 404 HANDLER ──────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.path} not found` });
});

// ── GLOBAL ERROR HANDLER ─────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, message: 'Internal server error' });
});

// ── MONGODB CONNECTION ───────────────────
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('MONGODB_URI not set in .env');
}

// Middleware to ensure DB is connected before handling routes
app.use(async (req, res, next) => {
  try {
    await connectToDatabase();
    next();
  } catch (err) {
    next(err);
  }
});

// Start the server if NOT running on Vercel
if (!process.env.VERCEL) {
  connectToDatabase().then(() => {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 SkillPilot API running on port ${PORT}`);
    });
  }).catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}

module.exports = app;
