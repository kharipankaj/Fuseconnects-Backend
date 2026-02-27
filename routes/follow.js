const express = require("express");
const router = express.Router();
const User = require("../models/User");
const auth = require("../middleware/auth.js");
const { createNotification } = require("../utils/notificationHelper");

const DEFAULT_DP = 'https://res.cloudinary.com/dhiw3k8to/image/upload/v1758801571/myUploads/hcowwm7uonqkcebhtktx.jpg';

router.post("/:username/follow", auth, async (req, res) => {
  try {
    const { username } = req.params;
    const currentUserId = req.user.id;

    const userToFollow = await User.findOne({ username });
    if (!userToFollow) {
      return res.status(404).json({ message: "User not found" });
    }

    if (userToFollow._id.toString() === currentUserId) {
      return res.status(400).json({ message: "Cannot follow yourself" });
    }

    const currentUser = await User.findById(currentUserId);
    if (currentUser.following.includes(userToFollow._id)) {
      return res.status(400).json({ message: "Already following this user" });
    }

    if (userToFollow.isPrivate) {
      const existingRequest = userToFollow.followRequests.find(req => req.requester.toString() === currentUserId && req.status === 'pending');
      if (existingRequest) {
        return res.status(400).json({ message: "Follow request already sent" });
      }

      userToFollow.followRequests.push({ requester: currentUserId });
      await userToFollow.save();

      res.json({ message: "Follow request sent" });
    } else {
      currentUser.following.push(userToFollow._id);
      currentUser.followingCount += 1;
      await currentUser.save();

      userToFollow.followers.push(currentUserId);
      userToFollow.followerCount += 1;
      await userToFollow.save();

      await createNotification('follow', currentUserId, userToFollow._id);

      res.json({ message: "Successfully followed user" });
    }
  } catch (err) {
    console.error("❌ Follow error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

router.post("/:username/unfollow", auth, async (req, res) => {
  try {
    const { username } = req.params;
    const currentUserId = req.user.id;

    const userToUnfollow = await User.findOne({ username });
    if (!userToUnfollow) {
      return res.status(404).json({ message: "User not found" });
    }

    const currentUser = await User.findById(currentUserId);
    if (!currentUser.following.includes(userToUnfollow._id)) {
      return res.status(400).json({ message: "Not following this user" });
    }

    currentUser.following = currentUser.following.filter(id => id.toString() !== userToUnfollow._id.toString());
    currentUser.followingCount -= 1;
    await currentUser.save();

    userToUnfollow.followers = userToUnfollow.followers.filter(id => id.toString() !== currentUserId);
    userToUnfollow.followerCount -= 1;
    await userToUnfollow.save();

    res.json({ message: "Successfully unfollowed user" });
  } catch (err) {
    console.error("❌ Unfollow error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

router.get("/:username/followers", auth, async (req, res) => {
  try {
    const { username } = req.params;

    const user = await User.findOne({ username }).populate('followers', 'username firstName lastName displayPicture');
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      followers: user.followers.map(f => ({
        id: f._id,
        username: f.username,
        fullName: `${f.firstName} ${f.lastName}`,
        displayPicture: f.displayPicture || DEFAULT_DP
      }))
    });
  } catch (err) {
    console.error("❌ Get followers error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

router.get("/:username/following", auth, async (req, res) => {
  try {
    const { username } = req.params;

    const user = await User.findOne({ username }).populate('following', 'username firstName lastName displayPicture');
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      following: user.following.map(f => ({
        id: f._id,
        username: f.username,
        fullName: `${f.firstName} ${f.lastName}`,
        displayPicture: f.displayPicture || DEFAULT_DP
      }))
    });
  } catch (err) {
    console.error("❌ Get following error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

router.get("/:username/follows-back", auth, async (req, res) => {
  try {
    const { username } = req.params;
    const currentUserId = req.user.id;

    const targetUser = await User.findOne({ username });
    if (!targetUser) {
      return res.status(404).json({ message: "User not found" });
    }

    const currentUser = await User.findById(currentUserId);
    const followsBack = currentUser.following.includes(targetUser._id);

    res.json({ followsBack });
  } catch (err) {
    console.error("❌ Check follows back error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

router.get("/requests", auth, async (req, res) => {
  try {
    const currentUserId = req.user.id;

    const user = await User.findById(currentUserId).populate('followRequests.requester', 'username firstName lastName displayPicture');
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const pendingRequests = user.followRequests.filter(req => req.status === 'pending');

    res.json({
      requests: pendingRequests.map(req => ({
        id: req._id,
        requester: {
          id: req.requester._id,
          username: req.requester.username,
          fullName: `${req.requester.firstName} ${req.requester.lastName}`,
          displayPicture: req.requester.displayPicture || DEFAULT_DP
        },
        requestedAt: req.requestedAt
      }))
    });
  } catch (err) {
    console.error("❌ Get follow requests error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

router.post("/:username/accept-request/:requesterId", auth, async (req, res) => {
  try {
    const { username, requesterId } = req.params;
    const currentUserId = req.user.id;

    const user = await User.findOne({ username });
    if (!user || user._id.toString() !== currentUserId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const requestIndex = user.followRequests.findIndex(req => req.requester.toString() === requesterId && req.status === 'pending');
    if (requestIndex === -1) {
      return res.status(404).json({ message: "Follow request not found" });
    }

    user.followRequests[requestIndex].status = 'accepted';

    user.followers.push(requesterId);
    user.followerCount += 1;

    await user.save();

    const requester = await User.findById(requesterId);
    if (requester) {
      requester.following.push(currentUserId);
      requester.followingCount += 1;
      await requester.save();
    }

    res.json({ message: "Follow request accepted" });
  } catch (err) {
    console.error("❌ Accept follow request error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

router.post("/:username/reject-request/:requesterId", auth, async (req, res) => {
  try {
    const { username, requesterId } = req.params;
    const currentUserId = req.user.id;

    const user = await User.findOne({ username });
    if (!user || user._id.toString() !== currentUserId) {
      return res.status(403).json({ message: "Unauthorized" });
    }

    const requestIndex = user.followRequests.findIndex(req => req.requester.toString() === requesterId && req.status === 'pending');
    if (requestIndex === -1) {
      return res.status(404).json({ message: "Follow request not found" });
    }

    user.followRequests[requestIndex].status = 'rejected';

    await user.save();

    res.json({ message: "Follow request rejected" });
  } catch (err) {
    console.error("❌ Reject follow request error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

module.exports = router;
