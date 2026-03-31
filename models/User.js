const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const SubmissionSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  topic: { type: String, required: true },
  difficulty: { type: String, enum: ['Easy', 'Medium', 'Hard'], default: 'Medium' },
  language: { type: String, default: 'javascript' },
  questionType: { type: String, default: 'coding' },
  question: {
    title: String,
    description: String,
    examples: [{ input: String, output: String, explanation: String }],
    constraints: [String],
    hints: [String],
    testCases: mongoose.Schema.Types.Mixed,
  },
  userCode: { type: String, default: '' },
  executionResult: {
    passed: { type: Boolean, default: false },
    output: String,
    error: String,
    testsPassed: { type: Number, default: 0 },
    testsTotal: { type: Number, default: 0 },
  },
  review: { type: mongoose.Schema.Types.Mixed, default: null },
  score: { type: Number, default: 0, min: 0, max: 100 },
  timeTaken: { type: Number, default: 0 },
  status: { type: String, enum: ['completed', 'partial', 'failed'], default: 'completed' },
}, { _id: true });

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, match: [/^\S+@\S+\.\S+$/, 'Invalid email'] },
  password: { type: String, required: true, minlength: 6 },

  // Social auth
  emailVerified: { type: Boolean, default: false },
  avatar: { type: String, default: null },
  authProviders: { type: [String], default: ['local'] }, // ['local', 'google', 'facebook', 'github']
  googleId: { type: String, default: null },
  facebookId: { type: String, default: null },
  githubId: { type: String, default: null },

  submissions: [SubmissionSchema],

  stats: {
    totalSubmissions: { type: Number, default: 0 },
    totalPassed: { type: Number, default: 0 },
    averageScore: { type: Number, default: 0 },
    topicsAttempted: { type: [String], default: [] },
    streakDays: { type: Number, default: 0 },
    lastActive: { type: Date, default: Date.now },
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  // Don't hash if it's an OAuth placeholder password (already hashed-looking)
  if (this.password.startsWith('google_oauth_') || this.password.startsWith('facebook_oauth_') || this.password.startsWith('github_oauth_')) {
    this.password = await bcrypt.hash(this.password, 12);
  } else {
    this.password = await bcrypt.hash(this.password, 12);
  }
  next();
});

UserSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

UserSchema.methods.recalculateStats = function () {
  const subs = this.submissions;
  this.stats.totalSubmissions = subs.length;
  this.stats.totalPassed = subs.filter(s => s.executionResult && s.executionResult.passed).length;
  const scores = subs.map(s => s.score || 0);
  this.stats.averageScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  this.stats.topicsAttempted = [...new Set(subs.map(s => s.topic).filter(Boolean))];
  this.stats.lastActive = new Date();
  this.updatedAt = new Date();
};

module.exports = mongoose.model('User', UserSchema);
