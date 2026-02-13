const Notification = require('../models/Notification');
const User = require('../models/User');

const createNotification = async (type, fromUserId, toUserId, postId = null, customMessage = null) => {
  try {
    if (fromUserId.toString() === toUserId.toString()) {
      return null;
    }
    let message = '';
    switch (type) {
      case 'follow':
        message = 'started following you';
        break;
      case 'like':
        message = 'liked your post';
        break;
      case 'comment':
        message = 'commented on your post';
        break;
      case 'post':
        message = 'posted for the first time';
        break;
      case 'follow_request':
        message = 'requested to follow you';
        break;
      case 'follow_request_accepted':
        message = 'accepted your follow request';
        break;
      case 'follow_request_rejected':
        message = 'rejected your follow request';
        break;
      default:
        message = customMessage || 'interacted with you';
    }
    const notification = new Notification({
      type,
      fromUser: fromUserId,
      toUser: toUserId,
      postId,
      message,
      read: false
    });

    await notification.save();

    await User.findByIdAndUpdate(toUserId, {
      $push: { notifications: notification._id },
      $inc: { unreadNotificationCount: 1 }
    });

    return notification;
  } catch (error) {
    console.error('❌ Error creating notification:', error);
    return null;
  }
};

const createGroupedNotification = async (type, fromUserId, toUserId, postId = null, count = 1) => {
  try {
    if (fromUserId.toString() === toUserId.toString()) {
      return null;
    }
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const existingNotification = await Notification.findOne({
      type,
      fromUser: fromUserId,
      toUser: toUserId,
      postId,
      createdAt: { $gt: oneDayAgo },
      read: false
    }).sort({ createdAt: -1 });

    if (existingNotification) {
      existingNotification.message = count > 1 ?
        `liked your post and ${count - 1} other${count > 2 ? 's' : ''}` :
        existingNotification.message;
      await existingNotification.save();
      return existingNotification;
    } else {
      return await createNotification(type, fromUserId, toUserId, postId);
    }
  } catch (error) {
    console.error('❌ Error creating grouped notification:', error);
    return null;
  }
};

module.exports = {
  createNotification,
  createGroupedNotification
};
