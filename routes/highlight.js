const express = require("express");
const mongoose = require("mongoose");
const Highlight = require("../models/Highlight.js");
const Story = require("../models/story.js");
const User = require("../models/User.js");

const router = express.Router();

const auth = require("../middleware/auth.js");

router.post("/", auth, async (req, res) => {
    try {
        const { title, coverImage, storyIds } = req.body;

        if (!title || title.trim().length === 0 || title.length > 20 || !coverImage || !storyIds || storyIds.length === 0) {
            return res.status(400).json({ error: "Title must be between 1 and 20 characters, cover image, and at least one story are required" });
        }

        const stories = await Story.find({
            _id: { $in: storyIds },
            user: req.user.id,
            expiresAt: { $gt: new Date() }
        });

        if (stories.length !== storyIds.length) {
            return res.status(400).json({ error: "Some stories not found or expired" });
        }

        const highlight = new Highlight({
            title,
            coverImage,
            stories: storyIds,
            user: req.user.id
        });

        await highlight.save();

        await User.findByIdAndUpdate(req.user.id, {
            $push: { highlights: highlight._id }
        });

        res.status(201).json(highlight);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get("/", auth, async (req, res) => {
    try {
        const highlights = await Highlight.find({ user: req.user.id })
            .populate({
                path: 'stories',
                match: { expiresAt: { $gt: new Date() } },
                select: 'media user createdAt'
            })
            .sort({ createdAt: -1 });

        const activeHighlights = highlights.filter(h => h.stories.length > 0);

        res.json(activeHighlights);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.put("/:id", auth, async (req, res) => {
    try {
        const { title, coverImage, storyIds } = req.body;

        if (title !== undefined && (!title || title.trim().length === 0 || title.length > 20)) {
            return res.status(400).json({ error: "Title must be between 1 and 20 characters" });
        }

        const highlight = await Highlight.findOne({
            _id: req.params.id,
            user: req.user.id
        });

        if (!highlight) {
            return res.status(404).json({ error: "Highlight not found" });
        }

        if (storyIds) {
            const stories = await Story.find({
                _id: { $in: storyIds },
                user: req.user.id,
                expiresAt: { $gt: new Date() }
            });

            if (stories.length !== storyIds.length) {
                return res.status(400).json({ error: "Some stories not found or expired" });
            }
        }

        highlight.title = title || highlight.title;
        highlight.coverImage = coverImage || highlight.coverImage;
        if (storyIds) highlight.stories = storyIds;

        await highlight.save();

        res.json(highlight);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete("/:id", auth, async (req, res) => {
    try {
        const highlight = await Highlight.findOneAndDelete({
            _id: req.params.id,
            user: req.user.id
        });

        if (!highlight) {
            return res.status(404).json({ error: "Highlight not found" });
        }

        await User.findByIdAndUpdate(req.user.id, {
            $pull: { highlights: req.params.id }
        });

        res.json({ message: "Highlight deleted successfully" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post("/:id/story", auth, async (req, res) => {
    try {
        const { storyId } = req.body;

        const highlight = await Highlight.findOne({
            _id: req.params.id,
            user: req.user.id
        });

        if (!highlight) {
            return res.status(404).json({ error: "Highlight not found" });
        }

        const story = await Story.findOne({
            _id: storyId,
            user: req.user.id,
            expiresAt: { $gt: new Date() }
        });

        if (!story) {
            return res.status(404).json({ error: "Story not found or expired" });
        }

        if (!highlight.stories.includes(storyId)) {
            highlight.stories.push(storyId);
            await highlight.save();
        }

        res.json(highlight);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete("/:id/story/:storyId", auth, async (req, res) => {
    try {
        const highlight = await Highlight.findOne({
            _id: req.params.id,
            user: req.user.id
        });

        if (!highlight) {
            return res.status(404).json({ error: "Highlight not found" });
        }

        highlight.stories = highlight.stories.filter(id => !id.equals(req.params.storyId));
        await highlight.save();

        res.json(highlight);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
