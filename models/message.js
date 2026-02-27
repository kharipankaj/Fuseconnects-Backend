const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    roomId: {
      type: String,
      index: true,
      required: false,
    },

    roomType: {
      type: String,
      enum: ["general", "community"],
      default: "community",
      index: true,
    },

    roomName: {
      type: String,
      trim: true,
      index: true,
    },

    city: {
      type: String,
      lowercase: true,
      index: true,
    },

    senderId: {
      type: mongoose.Schema.Types.Mixed,
      required: false,
    },

    senderType: {
      type: String,
      enum: ["user", "anonymous", "system"],
      default: "user",
    },

    messageType: {
      type: String,
      enum: ["text", "image", "system"],
      default: "text",
    },

    text: {
      type: String,
      trim: true,
    },

    // 🔥 DELIVERY LOGIC
    deliveredTo: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    pendingFor: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    readBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    sentAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      default: () => Date.now() + 1000 * 60 * 60 * 24, // 24 hours
      expires: 0, // ⏱️ TTL index
    },

  },
  { timestamps: true }
);

// export default mongoose.model("Message", messageSchema);

const message = mongoose.model('Message', messageSchema);

module.exports = message;
