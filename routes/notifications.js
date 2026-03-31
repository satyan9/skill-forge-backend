const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const authMiddleware = require('../middleware/auth');

// ── In-memory SSE client store ───────────────────────────────────────────────
// Map<userId (string) → Set<res>> — supports multi-tab usage
const clients = new Map();

function getClients(userId) {
  return clients.get(userId.toString()) || new Set();
}

function addClient(userId, res) {
  const id = userId.toString();
  if (!clients.has(id)) clients.set(id, new Set());
  clients.get(id).add(res);
}

function removeClient(userId, res) {
  const id = userId.toString();
  const set = clients.get(id);
  if (set) {
    set.delete(res);
    if (set.size === 0) clients.delete(id);
  }
}

function pushToUser(userId, data) {
  const set = getClients(userId);
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  set.forEach((res) => {
    try {
      res.write(payload);
    } catch (e) {
      // client disconnected, will be cleaned on close event
    }
  });
}

// ── MongoDB Change Stream (start once after DB connects) ─────────────────────
let changeStreamStarted = false;

function startChangeStream() {
  if (changeStreamStarted) return;
  changeStreamStarted = true;

  try {
    const stream = Notification.watch(
      [{ $match: { 'fullDocument.userId': { $exists: true } } }],
      { fullDocument: 'updateLookup' }
    );

    stream.on('change', (change) => {
      if (
        change.operationType === 'insert' ||
        change.operationType === 'update' ||
        change.operationType === 'replace'
      ) {
        const doc = change.fullDocument;
        if (!doc) return;
        pushToUser(doc.userId, { type: 'notification', payload: doc });
      }
    });

    stream.on('error', (err) => {
      console.error('⚠️  Notification Change Stream error:', err.message);
      changeStreamStarted = false;
      // Retry after 5 seconds
      setTimeout(startChangeStream, 5000);
    });

    console.log('🔔 Notification Change Stream active');
  } catch (err) {
    console.error('Failed to start Change Stream:', err.message);
    changeStreamStarted = false;
  }
}

// Export so server.js can call this after DB connects
module.exports.startChangeStream = startChangeStream;

// ────────────────────────────────────────────────────────────────────────────
// GET /api/notifications/stream  ← SSE endpoint (real-time)
// ────────────────────────────────────────────────────────────────────────────
router.get('/stream', authMiddleware, (req, res) => {
  const userId = req.user._id;

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable Nginx buffering if used
  res.flushHeaders();

  // Send a heartbeat every 25s to keep the connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch (e) {
      clearInterval(heartbeat);
    }
  }, 25000);

  addClient(userId, res);

  // Send a "connected" confirmation event
  res.write(`data: ${JSON.stringify({ type: 'connected', userId })}\n\n`);

  req.on('close', () => {
    clearInterval(heartbeat);
    removeClient(userId, res);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// GET /api/notifications  ← fetch all notifications for current user
// ────────────────────────────────────────────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const notifications = await Notification.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const unreadCount = await Notification.countDocuments({
      userId: req.user._id,
      read: false,
    });

    return res.json({ success: true, notifications, unreadCount });
  } catch (err) {
    console.error('Fetch notifications error:', err);
    return res.status(500).json({ success: false, message: 'Failed to load notifications.' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// POST /api/notifications  ← create a notification (system / admin use)
// ────────────────────────────────────────────────────────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { title, message, type = 'info', link, meta } = req.body;
    if (!title || !message) {
      return res.status(400).json({ success: false, message: 'title and message are required.' });
    }

    const notification = await Notification.create({
      userId: req.user._id,
      title,
      message,
      type,
      link: link || null,
      meta: meta || {},
    });

    return res.status(201).json({ success: true, notification });
  } catch (err) {
    console.error('Create notification error:', err);
    return res.status(500).json({ success: false, message: 'Failed to create notification.' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// PATCH /api/notifications/:id/read  ← mark one as read
// ────────────────────────────────────────────────────────────────────────────
router.patch('/:id/read', authMiddleware, async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user._id },
      { read: true },
      { new: true }
    );
    if (!notification) return res.status(404).json({ success: false, message: 'Notification not found.' });
    return res.json({ success: true, notification });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// PATCH /api/notifications/read-all  ← mark all as read
// ────────────────────────────────────────────────────────────────────────────
router.patch('/read-all', authMiddleware, async (req, res) => {
  try {
    await Notification.updateMany({ userId: req.user._id, read: false }, { read: true });
    return res.json({ success: true, message: 'All notifications marked as read.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// DELETE /api/notifications/:id  ← delete one
// ────────────────────────────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await Notification.findOneAndDelete({ _id: req.params.id, userId: req.user._id });
    return res.json({ success: true, message: 'Notification deleted.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ────────────────────────────────────────────────────────────────────────────
// DELETE /api/notifications  ← clear all
// ────────────────────────────────────────────────────────────────────────────
router.delete('/', authMiddleware, async (req, res) => {
  try {
    await Notification.deleteMany({ userId: req.user._id });
    return res.json({ success: true, message: 'All notifications cleared.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports.router = router;
