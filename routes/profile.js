const express = require("express");
const router = express.Router();
const User = require("../models/User");
const auth = require("../middleware/auth.js");
const cloudinaryUpload = require("../middleware/cloudinaryUpload.js");
const cloudinary = require("../config/cloudinary.js");

const extractPublicId = (url) => {
  if (!url || !url.includes('cloudinary.com')) return null;
  const parts = url.split('/upload/');
  if (parts.length < 2) return null;
  const afterUpload = parts[1];
  const segments = afterUpload.split('/');
  if (segments[0].match(/^v\d+$/)) {
    segments.shift();
  }
  return segments.join('/').replace(/\.[^.]+$/, '');
};

router.get("/", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select(
      "firstName lastName username bio displayPicture followerCount followingCount postCount SparkCount gender birthday location email mobile createdAt isPrivate country state district city"
    );

    if (!user) return res.status(404).json({ message: "User not found" });

    res.json({
      username: user.username,
      fullName: `${user.firstName} ${user.lastName}`,
      bio: user.bio || "",
      city: user.city || "",
      displayPicture: user.displayPicture || null,
      followerCount: user.followerCount,
      followingCount: user.followingCount,
      postCount: user.postCount,
      SparkCount: user.SparkCount,
      gender: user.gender || "",
      birthday: user.birthday || "",
      location: user.location || "",
      email: user.email,
      mobile: user.mobile,
      createdAt: user.createdAt,
      isPrivate: user.isPrivate,
      isOwnProfile: true,
      country: user.country || "",
      state: user.state || "",
      district: user.district || ""
    });
  } catch (err) {
    console.error("❌ Profile fetch error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

router.get("/:username", auth, async (req, res) => {
  try {
    const { username } = req.params;
    const currentUserId = req.user.id;

    const user = await User.findOne({ username }).select(
      "firstName lastName username bio displayPicture followerCount followingCount postCount SparkCount gender birthday location followers isPrivate followRequests"
    );

    if (!user) return res.status(404).json({ message: "User not found" });
    const isFollowing = user.followers.includes(currentUserId);
    const hasPendingRequest = user.followRequests.some(req => req.requester.toString() === currentUserId && req.status === 'pending');

    res.json({
      username: user.username,
      fullName: `${user.firstName} ${user.lastName}`,
      bio: user.bio || "",
      displayPicture: user.displayPicture || null,
      followerCount: user.followerCount,
      followingCount: user.followingCount,
      postCount: user.postCount,
      SparkCount: user.SparkCount,
      gender: user.gender || "",
      birthday: user.birthday || "",
      isOwnProfile: user._id.toString() === currentUserId,
      isFollowing,
      isPrivate: user.isPrivate,
      hasPendingRequest
    });
  } catch (err) {
    console.error("❌ Profile fetch error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

router.get("/check-username/:username", async (req, res) => {
  try {
    const { username } = req.params;
    const existingUser = await User.findOne({ username });

    if (existingUser) {
      return res.json({ available: false, message: "Username already taken" });
    }
    res.json({ available: true, message: "Username available" });
  } catch (err) {
    console.error("❌ Username check error:", err);
    res.status(500).json({ message: "Server Error" });
  }
});

router.put("/edit", auth, cloudinaryUpload("profilePhoto"), async (req, res) => {
  try {
    const { firstName, lastName, username, bio, gender, birthday, location, latitude, longitude, isPrivate, country, state, district, city } = req.body;
    console.log("PUT /edit request body:", req.body);

    const updateData = {};
    ["firstName","lastName","username","bio","gender","birthday","location","latitude","longitude","isPrivate","country","state","district","city"]
      .forEach(key => {
        if (req.body[key] !== undefined) updateData[key] = req.body[key];
      });
    console.log("Update data:", updateData);



    const DEFAULT_DP = 'https://res.cloudinary.com/dhiw3k8to/image/upload/v1758988596/myUploads/fzf1dskuqnzrt92rt6px.jpg';

    const currentUser = await User.findById(req.user.id).select('displayPicture');

    if (req.uploadedData?.url) {
      if (currentUser && currentUser.displayPicture && currentUser.displayPicture !== DEFAULT_DP) {
        const publicId = extractPublicId(currentUser.displayPicture);
        if (publicId) {
          try {
            await cloudinary.deleteImage(publicId);
            console.log('Successfully deleted old profile image from Cloudinary');
          } catch (deleteErr) {
            console.error('Error deleting old profile image:', deleteErr);
          }
        }
      }
      updateData.displayPicture = req.uploadedData.url;
    }

    if (req.body.removePhoto === 'true') {
      if (currentUser && currentUser.displayPicture && currentUser.displayPicture !== DEFAULT_DP) {
        const publicId = extractPublicId(currentUser.displayPicture);
        if (publicId) {
          try {
            await cloudinary.deleteImage(publicId);
            console.log('Successfully deleted old profile image from Cloudinary');
          } catch (deleteErr) {
            console.error('Error deleting old profile image:', deleteErr);
          }
        }
      }
      updateData.displayPicture = DEFAULT_DP;
    }

    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      updateData,
      { new: true }
    ).select("firstName lastName username bio displayPicture gender birthday location country state district");

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      ...updatedUser.toObject(),
      fullName: `${updatedUser.firstName} ${updatedUser.lastName}`.trim(),
    });
  } catch (err) {
    console.error("❌ Profile update error:", err);
    res.status(500).json({ message: "Server Error" });
  }

});

router.patch('/:username/toggle-private', auth, async (req, res) => {
  try {
    const user = await User.findOne({ username: req.params.username });
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (req.user.id !== user._id.toString()) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    user.isPrivate = !user.isPrivate;
    await user.save();

    res.json({ isPrivate: user.isPrivate });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;