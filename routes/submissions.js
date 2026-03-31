const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const authMiddleware = require('../middleware/auth');
const User = require('../models/User');

// All routes require authentication
router.use(authMiddleware);

// ────────────────────────────────────────
// POST /api/submissions
// Save a new submission with review data
// ────────────────────────────────────────
router.post(
  '/',
  [
    body('topic').trim().notEmpty().withMessage('Topic is required'),
    body('question').optional(),
    body('userCode').optional(),
    body('review').optional(),
    body('score').optional().isNumeric().withMessage('Score must be a number'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, errors: errors.array() });
    }

    try {
      const user = await User.findById(req.user._id);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

      const {
        topic,
        difficulty = 'Medium',
        language = 'javascript',
        questionType = 'coding',
        question = {},
        userCode = '',
        executionResult = {},
        review = null,
        score = 0,
        timeTaken = 0,
        status = 'completed',
      } = req.body;

      const submission = {
        timestamp: new Date(),
        topic,
        difficulty,
        language,
        questionType,
        question,
        userCode,
        executionResult,
        review,
        score: Math.min(Math.max(Number(score) || 0, 0), 100),
        timeTaken,
        status,
      };

      user.submissions.push(submission);
      user.recalculateStats();
      await user.save();

      const savedSubmission = user.submissions[user.submissions.length - 1];

      return res.status(201).json({
        success: true,
        message: 'Submission saved successfully',
        submission: savedSubmission,
        stats: user.stats,
      });
    } catch (err) {
      console.error('Save submission error:', err);
      return res.status(500).json({ success: false, message: 'Failed to save submission' });
    }
  }
);

// ────────────────────────────────────────
// GET /api/submissions
// Get all submissions (paginated) for the authenticated user
// ────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const topic = req.query.topic;
    const status = req.query.status;

    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    let subs = [...user.submissions].reverse(); // newest first

    // filter by topic
    if (topic) subs = subs.filter(s => s.topic && s.topic.toLowerCase().includes(topic.toLowerCase()));
    // filter by status
    if (status) subs = subs.filter(s => s.status === status);

    const total = subs.length;
    const startIdx = (page - 1) * limit;
    const paginated = subs.slice(startIdx, startIdx + limit);

    return res.json({
      success: true,
      submissions: paginated,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      stats: user.stats,
    });
  } catch (err) {
    console.error('Get submissions error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch submissions' });
  }
});

// ────────────────────────────────────────
// GET /api/submissions/:id
// Get a single submission by ID with full review
// ────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const submission = user.submissions.id(req.params.id);
    if (!submission) return res.status(404).json({ success: false, message: 'Submission not found' });

    return res.json({ success: true, submission });
  } catch (err) {
    console.error('Get submission error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch submission' });
  }
});

// ────────────────────────────────────────
// DELETE /api/submissions/:id
// Delete a specific submission
// ────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    const submission = user.submissions.id(req.params.id);
    if (!submission) return res.status(404).json({ success: false, message: 'Submission not found' });

    submission.deleteOne();
    user.recalculateStats();
    await user.save();

    return res.json({ success: true, message: 'Submission deleted', stats: user.stats });
  } catch (err) {
    console.error('Delete submission error:', err);
    return res.status(500).json({ success: false, message: 'Failed to delete submission' });
  }
});

// ────────────────────────────────────────
// GET /api/submissions/stats/summary
// Get stats summary for the dashboard
// ────────────────────────────────────────
router.get('/stats/summary', async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    // Build topic breakdown
    const topicMap = {};
    user.submissions.forEach(s => {
      if (!s.topic) return;
      if (!topicMap[s.topic]) topicMap[s.topic] = { count: 0, totalScore: 0, passed: 0 };
      topicMap[s.topic].count++;
      topicMap[s.topic].totalScore += s.score || 0;
      if (s.executionResult && s.executionResult.passed) topicMap[s.topic].passed++;
    });

    const topicBreakdown = Object.entries(topicMap).map(([topic, data]) => ({
      topic,
      count: data.count,
      avgScore: Math.round(data.totalScore / data.count),
      passed: data.passed,
    })).sort((a, b) => b.count - a.count);

    // Recent 7 days activity
    const now = new Date();
    const recentActivity = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() - (6 - i));
      const dateStr = d.toISOString().split('T')[0];
      const count = user.submissions.filter(s => {
        const sDate = new Date(s.timestamp).toISOString().split('T')[0];
        return sDate === dateStr;
      }).length;
      return { date: dateStr, count };
    });

    return res.json({
      success: true,
      stats: user.stats,
      topicBreakdown,
      recentActivity,
      totalSubmissions: user.submissions.length,
    });
  } catch (err) {
    console.error('Stats error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch stats' });
  }
});

module.exports = router;
