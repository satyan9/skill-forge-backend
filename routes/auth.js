const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');

const User = require('../models/User');
const Otp = require('../models/Otp');
const { generateOtp, sendOtpEmail } = require('../services/emailService');
const authMiddleware = require('../middleware/auth');

// Google OAuth client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// ── helpers ───────────────────────────────────────
function generateToken(userId) {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function safeUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    avatar: user.avatar || null,
    authProviders: user.authProviders || ['local'],
    emailVerified: user.emailVerified || false,
    stats: user.stats,
    createdAt: user.createdAt,
  };
}

// ────────────────────────────────────────────────
// POST /api/auth/send-otp
// Send OTP to email (for verification before signup / login)
// ────────────────────────────────────────────────
router.post('/send-otp', [
  body('email').isEmail().normalizeEmail().withMessage('Invalid email address'),
  body('purpose').optional().isIn(['register', 'login', 'reset']),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const { email, purpose = 'register' } = req.body;

  try {
    // For register: check email not already taken
    if (purpose === 'register') {
      const existing = await User.findOne({ email });
      if (existing && existing.emailVerified) {
        return res.status(409).json({ success: false, message: 'Email already registered. Please sign in.' });
      }
    }

    // For reset: check if account exists
    if (purpose === 'reset') {
      const existing = await User.findOne({ email });
      if (!existing) {
        return res.status(404).json({ success: false, message: 'No account found with this email.' });
      }
    }

    // Rate-limiting: allow max 3 OTP requests per 10 min
    const recentCount = await Otp.countDocuments({ email, purpose });
    if (recentCount >= 3) {
      return res.status(429).json({ success: false, message: 'Too many OTP requests. Please wait 10 minutes.' });
    }

    // Delete any existing OTP for this email+purpose
    await Otp.deleteMany({ email, purpose });

    // Generate & save new OTP
    const otp = generateOtp();
    await Otp.create({ email, otp, purpose });

    // Send email (or print to console in dev mode)
    await sendOtpEmail(email, otp, purpose);

    const isDevMode = process.env.DEV_OTP_CONSOLE === 'true';
    return res.json({
      success: true,
      message: isDevMode
        ? `DEV MODE: OTP printed in server terminal only. Code NOT sent by email.`
        : `Verification code sent to ${email}. Check your inbox.`,
      // NOTE: devOtp is NEVER included in the response for security
    });
  } catch (err) {
    console.error('Send OTP error:', err);
    if (err.message === 'EMAIL_NOT_CONFIGURED') {
      return res.status(500).json({
        success: false,
        message: 'Email service not set up yet. Please add your EMAIL_USER and EMAIL_PASS (App Password) to server/.env',
      });
    }
    if (err.message?.includes('EAUTH') || err.message?.includes('Invalid login') || err.message?.includes('BadCredentials')) {
      return res.status(500).json({
        success: false,
        message: 'Gmail App Password is incorrect. You must generate a 16-letter App Password in your Google Account Security settings.',
      });
    }
    return res.status(500).json({ success: false, message: 'Failed to send OTP. Please try again.' });
  }
});

// ────────────────────────────────────────────────
// POST /api/auth/verify-otp
// Verify OTP (returns a short-lived pre-auth token for completing signup)
// ────────────────────────────────────────────────
router.post('/verify-otp', [
  body('email').isEmail().normalizeEmail(),
  body('otp').isLength({ min: 6, max: 6 }).withMessage('OTP must be 6 digits'),
  body('purpose').optional().isIn(['register', 'login', 'reset']),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const { email, otp, purpose = 'register' } = req.body;

  try {
    const record = await Otp.findOne({ email, purpose });

    if (!record) {
      return res.status(400).json({ success: false, message: 'OTP expired or not found. Please request a new one.' });
    }

    // Track wrong attempts (max 5)
    if (record.otp !== otp) {
      record.attempts += 1;
      await record.save();
      if (record.attempts >= 5) {
        await record.deleteOne();
        return res.status(400).json({ success: false, message: 'Too many wrong attempts. Request a new OTP.' });
      }
      return res.status(400).json({
        success: false,
        message: `Incorrect OTP. ${5 - record.attempts} attempts remaining.`,
      });
    }

    // OTP valid — delete it
    await record.deleteOne();

    // Issue a short-lived "email-verified" pre-auth token (3 minutes)
    const preAuthToken = jwt.sign(
      { email, emailVerified: true, purpose },
      process.env.JWT_SECRET,
      { expiresIn: '3m' }
    );

    return res.json({
      success: true,
      message: 'OTP verified successfully!',
      preAuthToken,
    });
  } catch (err) {
    console.error('Verify OTP error:', err);
    return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
  }
});

// ────────────────────────────────────────────────
// POST /api/auth/register
// Complete registration after OTP verification
// ────────────────────────────────────────────────
router.post('/register', [
  body('name').trim().isLength({ min: 2, max: 80 }),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('preAuthToken').notEmpty().withMessage('Email verification required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const { name, email, password, preAuthToken } = req.body;

  try {
    // Verify pre-auth token
    let decoded;
    try {
      decoded = jwt.verify(preAuthToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ success: false, message: 'Email verification expired. Please verify OTP again.' });
    }

    if (decoded.email !== email || !decoded.emailVerified) {
      return res.status(401).json({ success: false, message: 'Email mismatch. Please verify your email.' });
    }

    const existing = await User.findOne({ email });
    if (existing && existing.emailVerified) {
      return res.status(409).json({ success: false, message: 'Email already registered. Please sign in.' });
    }

    const user = existing || new User({ name, email, password });
    if (existing) {
      user.name = name;
      user.password = password;
    }
    user.emailVerified = true;
    user.authProviders = ['local'];
    await user.save();

    const token = generateToken(user._id);
    return res.status(201).json({ success: true, message: 'Account created!', token, user: safeUser(user) });
  } catch (err) {
    console.error('Register error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ────────────────────────────────────────────────
// POST /api/auth/login
// ────────────────────────────────────────────────
router.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ success: false, message: 'Invalid email or password.' });

    const isMatch = await user.comparePassword(password);
    if (!isMatch) return res.status(401).json({ success: false, message: 'Invalid email or password.' });

    user.stats.lastActive = new Date();
    await user.save();

    const token = generateToken(user._id);
    return res.json({ success: true, message: 'Welcome back!', token, user: safeUser(user) });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ────────────────────────────────────────────────
// POST /api/auth/reset-password
// ────────────────────────────────────────────────
router.post('/reset-password', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('preAuthToken').notEmpty().withMessage('Verification required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  const { email, password, preAuthToken } = req.body;

  try {
    let decoded;
    try {
      decoded = jwt.verify(preAuthToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ success: false, message: 'Session expired. Please verify OTP again.' });
    }

    if (decoded.email !== email || decoded.purpose !== 'reset') {
      return res.status(401).json({ success: false, message: 'Invalid verification session.' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    user.password = password;
    await user.save();

    return res.json({ success: true, message: 'Password has been reset successfully. You can now log in.' });
  } catch (err) {
    console.error('Reset password error:', err);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ────────────────────────────────────────────────
// POST /api/auth/google
// Login / Register with Google ID token
// ────────────────────────────────────────────────
router.post('/google', [
  body('idToken').notEmpty().withMessage('Google ID token required'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ success: false, errors: errors.array() });

  try {
    const { idToken } = req.body;

    // Verify Google token
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { email, name, picture, sub: googleId, email_verified } = payload;

    if (!email_verified) {
      return res.status(400).json({ success: false, message: 'Google account email is not verified.' });
    }

    // Find or create user
    let user = await User.findOne({ email });
    if (!user) {
      user = new User({
        name,
        email,
        password: `google_oauth_${googleId}_${Date.now()}`, // random, won't be used
        emailVerified: true,
        avatar: picture,
        authProviders: ['google'],
        googleId,
      });
      await user.save();
    } else {
      // Link Google to existing account
      if (!user.authProviders.includes('google')) user.authProviders.push('google');
      user.googleId = googleId;
      if (!user.avatar) user.avatar = picture;
      user.emailVerified = true;
      user.stats.lastActive = new Date();
      await user.save();
    }

    const token = generateToken(user._id);
    return res.json({
      success: true,
      message: user.createdAt === user.updatedAt ? 'Account created with Google!' : 'Welcome back!',
      token,
      user: safeUser(user),
    });
  } catch (err) {
    console.error('Google auth error:', err);
    if (err.message?.includes('Token used too late') || err.message?.includes('Invalid token')) {
      return res.status(401).json({ success: false, message: 'Google login failed. Please try again.' });
    }
    return res.status(500).json({ success: false, message: 'Google authentication failed.' });
  }
});

// ────────────────────────────────────────────────
// GET /api/auth/me
// ────────────────────────────────────────────────
router.get('/me', authMiddleware, async (req, res) => {
  return res.json({ success: true, user: safeUser(req.user) });
});

module.exports = router;
