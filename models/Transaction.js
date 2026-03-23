const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  type: {
    type: String,
    required: true,
    enum: ['deposit', 'withdraw', 'win', 'loss', 'referral'],
    index: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed'],
    default: 'completed'
  },
  description: String
}, {
  timestamps: true
});

// Index for efficient queries
transactionSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);
