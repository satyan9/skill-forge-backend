const mongoose = require('mongoose');

/**
 * Stores pending OTPs for email verification.
 * A TTL index automatically removes the document after `expiresAt`.
 */
const OtpSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  otp: {
    type: String,
    required: true,
  },
  purpose: {
    type: String,
    enum: ['register', 'login', 'reset'],
    default: 'register',
  },
  attempts: {
    type: Number,
    default: 0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    // MongoDB TTL: auto-delete document after 10 minutes
    expires: 600,
  },
});

// Compound index so we can quickly find otp by email+purpose
OtpSchema.index({ email: 1, purpose: 1 });

module.exports = mongoose.model('Otp', OtpSchema);
