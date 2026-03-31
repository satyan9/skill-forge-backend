const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');



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



  stats: {
    totalSubmissions: { type: Number, default: 0 },
    totalPassed: { type: Number, default: 0 },
    averageScore: { type: Number, default: 0 },
    topicsAttempted: { type: [String], default: [] },
    streakDays: { type: Number, default: 0 },
    lastActive: { type: Date, default: Date.now },
    moduleScores: { type: Map, of: Number, default: {} },
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

UserSchema.methods.recalculateStats = function (subs = []) {
  this.stats.totalSubmissions = subs.length;
  this.stats.totalPassed = subs.filter(s => s.executionResult && s.executionResult.passed).length;
  const scores = subs.map(s => s.score || 0);
  this.stats.averageScore = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
  this.stats.topicsAttempted = [...new Set(subs.map(s => s.topic).filter(Boolean))];

  const moduleSums = {};
  const moduleCounts = {};
  subs.forEach(s => {
    const mod = s.topic || 'Programming'; // default fallback
    if (!moduleSums[mod]) { moduleSums[mod] = 0; moduleCounts[mod] = 0; }
    moduleSums[mod] += (s.score || 0);
    moduleCounts[mod]++;
  });

  const moduleScores = {};
  for (const mod in moduleSums) {
    moduleScores[mod] = Math.round(moduleSums[mod] / moduleCounts[mod]);
  }
  this.stats.moduleScores = moduleScores;

  // ── Streak calculation ────────────────────────────────
  // Get unique calendar days (IST-safe: use UTC date string)
  const daySet = new Set(
    subs.map(s => new Date(s.timestamp).toISOString().split('T')[0])
  );
  const days = [...daySet].sort(); // ascending YYYY-MM-DD strings

  const todayStr = new Date().toISOString().split('T')[0];
  const yesterdayStr = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().split('T')[0];
  })();

  // Streak only counts if user submitted today OR yesterday (generous 1-day grace)
  if (!daySet.has(todayStr) && !daySet.has(yesterdayStr)) {
    this.stats.streakDays = 0;
  } else {
    // Walk backwards from today counting consecutive days present in daySet
    let streak = 0;
    let check = new Date();
    check.setUTCHours(0, 0, 0, 0);

    while (true) {
      const checkStr = check.toISOString().split('T')[0];
      if (daySet.has(checkStr)) {
        streak++;
        check.setUTCDate(check.getUTCDate() - 1);
      } else {
        break;
      }
    }
    this.stats.streakDays = streak;
  }

  this.stats.lastActive = new Date();
  this.updatedAt = new Date();
};

module.exports = mongoose.model('User', UserSchema);
