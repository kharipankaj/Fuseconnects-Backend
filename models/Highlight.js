const mongoose = require("mongoose");

const highlightSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    coverImage: {
      type: String,
      required: true,
    },
    stories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Story",
        required: true,
      },
    ],
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

highlightSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.models.Highlight || mongoose.model("Highlight", highlightSchema);
