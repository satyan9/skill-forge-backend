/**
 * notificationHelper.js
 * 
 * Use this anywhere in route handlers to send real-time notifications to a user.
 * It saves the notification to MongoDB, which triggers the Change Stream → SSE push.
 * 
 * Usage:
 *   const { notify } = require('../services/notificationHelper');
 *   await notify(userId, 'success', '🎉 Submission Saved', 'Your quiz score has been recorded.');
 */

const Notification = require('../models/Notification');

/**
 * @param {string|ObjectId} userId
 * @param {'success'|'info'|'warning'|'error'|'achievement'} type
 * @param {string} title
 * @param {string} message
 * @param {object} [options] - { link, meta }
 */
async function notify(userId, type = 'info', title, message, options = {}) {
  try {
    await Notification.create({
      userId,
      type,
      title,
      message,
      link: options.link || null,
      meta: options.meta || {},
    });
  } catch (err) {
    // Non-fatal — log but don't crash the main request
    console.error('Failed to create notification:', err.message);
  }
}

module.exports = { notify };
