const mongoose = require('mongoose');

const userBlockSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    anonId: {
      type: String,
      index: true,
    },
    blockedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    blockedByAnonId: {
      type: String,
    },
    reason: {
      type: String,
      trim: true,
    },
    durationMinutes: {
      type: Number,
      required: true,
      min: 1,
      max: 10080, // 7 days max
    },
    blockStartTime: {
      type: Date,
      default: Date.now,
      index: true,
    },
    blockEndTime: {
      type: Date,
      required: true,
    },
    blockReason: {
      type: String,
      enum: ['spam', 'harassment', 'abuse', 'other'],
      default: 'other',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// TTL Index: Automatically delete expired blocks after blockEndTime
userBlockSchema.index({ blockEndTime: 1 }, { expireAfterSeconds: 0 });

// Compound index for quick lookup
userBlockSchema.index({ userId: 1, isActive: 1 });
userBlockSchema.index({ anonId: 1, isActive: 1 });

module.exports = mongoose.model('UserBlock', userBlockSchema);
