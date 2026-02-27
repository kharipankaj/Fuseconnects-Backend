const express = require("express");
const Post = require("../models/postcard.js");
const User = require("../models/User.js");
const mongoose = require("mongoose");
const auth = require("../middleware/auth.js");
const cloudinaryUpload = require("../middleware/cloudinaryUpload.js");

const router = express.Router();

router.post("/", auth, cloudinaryUpload("file"), async (req, res) => {
  try {
    const { caption, location, mood, postType } = req.body;

    if (!req.uploadedData) {
      return res.status(400).json({ success: false, message: "File upload failed" });
    }
    const { url, mediaType } = req.uploadedData;

    const actualUserId = req.user.id;
    const actualUsername = req.user.username;
    const allowedTypes = ["photo", "spark"];
    if (!allowedTypes.includes(postType)) {
      return res.status(400).json({ success: false, message: "Invalid post type" });
    }

    const newPost = new Post({
      caption,
      location,
      mood,
      postType, 
      media: [{ url, type: mediaType }],
      userId: actualUserId,
      username: actualUsername,
    });

    await newPost.save();
    const updatedUser = await User.findByIdAndUpdate(
      actualUserId,
      { $inc: { postCount: 1 } },
      { new: true }
    );

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.json({
      success: true,
      message: "Post saved successfully!",
      post: newPost,
    });
  } catch (error) {
    console.error("Post save error:", error);
    res.status(500).json({ success: false, message: "Post creation failed", error: error.message });
  }
});

module.exports = router;
