const mongoose = require("mongoose");

const walletTransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["deposit", "withdraw", "game_entry", "game_win", "bonus", "refund"],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "rejected"],
      default: "completed",
      index: true,
    },
    balanceBucket: {
      type: String,
      enum: ["deposit_balance", "winning_balance", "bonus_balance"],
      default: null,
    },
    referenceId: {
      type: String,
      default: null,
      index: true,
    },
metadata: {
      type: Object,
      default: {},
    },
source: {
      type: String,
      enum: ['deposit', 'referral', 'game_entry', 'game_win', 'game_loser', 'withdraw', 'bonus', 'platform_reward', 'unknown'],
      default: 'unknown',
      index: true,
    }
  },
  {
    timestamps: true,
  }

);

module.exports = mongoose.model("WalletTransaction", walletTransactionSchema);
