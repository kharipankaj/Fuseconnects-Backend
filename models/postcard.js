const mongoose = require("mongoose");

const PostSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    username: {
      type: String,
      required: true,
      index: true
    },

    caption: {
      type: String,
      trim: true,
      maxlength: 2200,
    },

    media: [
      {
        url: { type: String, required: true },
        type: { type: String, enum: ["image", "video"], default: "image" },
        thumbnail: { type: String },
      },
    ],

    location: {
      type: String,
      trim: true,
    },

    mood: {
      type: String,
      trim: true,
    },

    postType: {
      type: String,
      enum: ["photo", "spark"], 
      required: true,
      default: "photo",
    },

    isHidden: {
      type: Boolean,
      default: false,
    },

    hideLikes: {
      type: Boolean,
      default: false,
    },

    commentsDisabled: {
      type: Boolean,
      default: false,
    },

    tags: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    mentions: [
      {
        username: String,
      },
    ],

    comments: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        text: { type: String, required: true },
        replies: [
          {
            user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
            text: String,
            createdAt: { type: Date, default: Date.now },
          },
        ],
        createdAt: { type: Date, default: Date.now },
      },
    ],

    likes: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    savedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    views: {
      type: [String],
      default: [],
    },

    viewscount: {
      type: Number,
      default: 0,
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

PostSchema.virtual('viewCount').get(function() {
  return this.views.length;
});

PostSchema.pre('save', function(next) {
  if (!Array.isArray(this.views)) {
    console.warn(`Post ${this._id} has views as ${typeof this.views}, converting to array`);
    this.views = [];
    this.viewscount = this.viewscount || 0;
  }
  next();
});

module.exports = mongoose.model("Post", PostSchema);
