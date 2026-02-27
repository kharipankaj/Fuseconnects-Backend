const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    enum: ['follow', 'like', 'comment', 'post', 'follow_request', 'follow_request_accepted', 'follow_request_rejected']
  },
  fromUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  toUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  postId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Post',
    default: null
  },
  message: {
    type: String,
    required: true
  },
  read: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now
  },

  relatedNotifications: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Notification'
  }]
});

notificationSchema.index({ toUser: 1, createdAt: -1 });
notificationSchema.index({ toUser: 1, read: 1 });
notificationSchema.index({ type: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
