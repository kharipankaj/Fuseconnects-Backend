const mongoose = require("mongoose");

const roomSchema = new mongoose.Schema(
  {
    roomId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    roomName: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["public", "private", "city"],
      default: "public",
    },
    city: {
      type: String,
      lowercase: true,
      index: true,
    },
    members: {
      type: Number,
      default: 0
    },
    anonIds: [{
      type: String,
      index: true
    }],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastMessageAt: Date,
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.CommunityRoom ||
  mongoose.model("CommunityRoom", roomSchema);
