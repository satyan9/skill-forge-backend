const mongoose = require('mongoose');

const SubmissionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  timestamp: { type: Date, default: Date.now },
  topic: { type: String, required: true },
  difficulty: { type: String, enum: ['Beginner', 'Intermediate', 'Advanced', 'Easy', 'Medium', 'Hard'], default: 'Beginner' },
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
}, { timestamps: true });

module.exports = mongoose.model('Submission', SubmissionSchema);
