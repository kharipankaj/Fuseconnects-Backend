const express = require("express");
const mongoose = require("mongoose");
const Story = require("../models/story.js");
const User = require("../models/User.js");
const router = express.Router();

router.get("/", async (req, res) => {
    try {
        const stories = await Story.find({ expiresAt: { $gt: new Date() } })
            .populate("user", "username displayPicture")
            .populate("replies.user", "_id username")
            .populate("views", "_id username")
            .sort({ createdAt: -1 });

        res.json(stories);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.patch("/:id/like", async (req, res) => {
    try {
        const { userId } = req.body;
        const userObjectId = new mongoose.Types.ObjectId(userId);
        const story = await Story.findById(req.params.id);
        if (!story) return res.status(404).send("Story not found");

        if (story.likes.some(id => id.equals(userObjectId))) story.likes.pull(userObjectId);
        else story.likes.push(userObjectId);

        await story.save();
        res.json(story);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.patch("/:id/view", async (req, res) => {
    try {
        const { userId } = req.body;
        const userObjectId = new mongoose.Types.ObjectId(userId);
        const story = await Story.findById(req.params.id);
        if (!story) return res.status(404).send("Story not found");

        if (!story.views.some(id => id.equals(userObjectId))) {
            story.views.push(userObjectId);
            await story.save();
        }

        const populated = await story.populate("views", "_id username");
        res.json(populated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post("/:id/reply", async (req, res) => {
    try {
        const { userId, text } = req.body;
        const userObjectId = new mongoose.Types.ObjectId(userId);
        const story = await Story.findById(req.params.id);
        if (!story) return res.status(404).send("Story not found");

        story.replies.push({ user: userObjectId, text });
        await story.save();
        const populated = await story.populate("replies.user", "_id username");
        res.json(populated);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});



module.exports = router;
