const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const User = require('../models/User');
const auth = require('../middleware/auth.js');

router.get('/', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const notifications = await Notification.find({ toUser: req.user.id })
      .populate('fromUser', 'username firstName lastName displayPicture')
      .populate('postId', 'media caption')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Notification.countDocuments({ toUser: req.user.id });

    res.json({
      notifications,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit),
        totalNotifications: total,
        hasMore: page * limit < total
      }
    });
  } catch (err) {
    console.error('❌ Error fetching notifications:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

router.get('/unread-count', auth, async (req, res) => {
  try {
    const count = await Notification.countDocuments({
      toUser: req.user.id,
      read: false
    });
    res.json({ count });
  } catch (err) {
    console.error('❌ Error fetching unread count:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

router.put('/:id/read', auth, async (req, res) => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      toUser: req.user.id
    });

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    if (!notification.read) {
      notification.read = true;
      await notification.save();

      await User.findByIdAndUpdate(req.user.id, {
        $inc: { unreadNotificationCount: -1 }
      });
    }

    res.json({ message: 'Notification marked as read' });
  } catch (err) {
    console.error('❌ Error marking notification as read:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

router.put('/mark-all-read', auth, async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { toUser: req.user.id, read: false },
      { read: true }
    );

    await User.findByIdAndUpdate(req.user.id, {
      unreadNotificationCount: 0
    });

    res.json({
      message: 'All notifications marked as read',
      updatedCount: result.modifiedCount
    });
  } catch (err) {
    console.error('❌ Error marking all notifications as read:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

router.delete('/:id', auth, async (req, res) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      toUser: req.user.id
    });

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    if (!notification.read) {
      await User.findByIdAndUpdate(req.user.id, {
        $inc: { unreadNotificationCount: -1 }
      });
    }

    res.json({ message: 'Notification deleted successfully' });
  } catch (err) {
    console.error('❌ Error deleting notification:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

router.get('/recent', auth, async (req, res) => {
  try {
    const since = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 5 * 60 * 1000);

    const notifications = await Notification.find({
      toUser: req.user.id,
      createdAt: { $gt: since }
    })
      .populate('fromUser', 'username firstName lastName displayPicture')
      .populate('postId', 'media caption')
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({ notifications });
  } catch (err) {
    console.error('❌ Error fetching recent notifications:', err);
    res.status(500).json({ message: 'Server Error' });
  }
});

module.exports = router;
