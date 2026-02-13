const express = require("express");
const router = express.Router();
const Story = require("../models/story");
const jwtAuth = require("../middleware/jwtauth");
const cloudinaryUpload = require("../middleware/cloudinaryUpload");

router.post("/", jwtAuth, cloudinaryUpload("media"), async (req, res) => {
  try {
    console.log("Uploadstory route - req.user:", req.user);
    console.log("Uploadstory route - req.uploadedData:", req.uploadedData);

    if (!req.uploadedData) {
      return res.status(400).json({ success: false, message: "No media uploaded" });
    }

    const expirationMinutes = parseInt(req.body.expirationMinutes) || 1440;
    const expirationTime = new Date(Date.now() + expirationMinutes * 60000);

    const story = await Story.create({
      user: req.user?._id || req.user?.id,
      media: [
        {
          type: req.uploadedData.mediaType,
          url: req.uploadedData.url,
        }
      ],
      caption: req.body.caption || "",
      expiresAt: expirationTime,
    });

    res.json({ success: true, story });
  } catch (err) {
    console.error("Story save error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

module.exports = router;
