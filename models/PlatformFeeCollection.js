const mongoose = require("mongoose");

const platformFeeCollectionSchema = new mongoose.Schema(
  {
    matchId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    gameKey: {
      type: String,
      required: true,
      index: true,
    },
    gameLabel: {
      type: String,
      required: true,
    },
    entryAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    totalPool: {
      type: Number,
      required: true,
      min: 0,
    },
    winnerReward: {
      type: Number,
      required: true,
      min: 0,
    },
    loserReward: {
      type: Number,
      required: true,
      min: 0,
    },
    platformFee: {
      type: Number,
      required: true,
      min: 0,
    },
    playerOne: {
      id: { type: String, required: true },
      name: { type: String, required: true },
    },
    playerTwo: {
      id: { type: String, required: true },
      name: { type: String, required: true },
    },
    metadata: {
      type: Object,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("PlatformFeeCollection", platformFeeCollectionSchema);
