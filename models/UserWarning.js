const mongoose = require('mongoose');

const userWarningSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    anonId: {
      type: String,
      index: true,
    },
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message',
    },
    roomId: {
      type: String,
      index: true,
    },
    roomType: {
      type: String,
      enum: ['general', 'community'],
      required: true,
    },
    violationType: {
      type: String,
      enum: ['ABUSE', 'HARASSMENT', 'HATE', 'SEXUAL', 'THREAT'],
      required: true,
    },
    reason: {
      type: String,
    },
    message: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ['active', 'acknowledged', 'resolved'],
      default: 'active',
    },
    warningCount: {
      type: Number,
      default: 1,
    },
    issuedAt: {
      type: Date,
      default: Date.now,
    },
    acknowledgedAt: {
      type: Date,
    },
    expiresAt: {
      type: Date,
      default: () => Date.now() + 1000 * 60 * 60 * 24 * 30, // 30 days
      expires: 0, // TTL index
    },
  },
  { timestamps: true }
);

// Index for quick lookups
userWarningSchema.index({ userId: 1, status: 1 });
userWarningSchema.index({ anonId: 1, status: 1 });
userWarningSchema.index({ createdAt: -1 });

const UserWarning = mongoose.model('UserWarning', userWarningSchema);

module.exports = UserWarning;
