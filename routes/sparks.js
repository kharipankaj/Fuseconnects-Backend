const express = require("express");
const router = express.Router();
const Post = require("../models/postcard");
const User = require("../models/User");
const auth = require("../middleware/auth.js");
const mongoose = require("mongoose");

router.get("/", auth, async (req, res) => {
  try {
    const posts = await Post.find({ username: req.user.username, postType: "spark" })
      .populate("userId", "username profilePhoto")
      .populate("comments.user", "username profilePhoto")
      .sort({ createdAt: -1 });

    res.json(posts);
  } catch (err) {
    console.error("❌ Error fetching posts:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/user/:username", async (req, res) => {
  try {
    const posts = await Post.find({ username: req.params.username, postType: "spark" })
      .populate("userId", "username profilePhoto")
      .populate("comments.user", "username profilePhoto")
      .sort({ createdAt: -1 });

    const postCount = posts.length;
    await User.findOneAndUpdate(
      { username: req.params.username },
      { postCount: postCount }
    );

    res.json(posts);
  } catch (err) {
    console.error("❌ Error fetching posts by username:", err);
    res.status(500).json({ error: err.message });
  }
});


router.post("/", auth, async (req, res) => {
  try {
    const { caption, imageUrl } = req.body;
    if (!caption && !imageUrl) {
      return res.status(400).json({ error: "Post must have a caption or image" });
    }

    const newPost = new Post({
      userId: req.user.id,
      username: req.user.username,
      caption,
      imageUrl,
      postType: "spark",
    });

    await newPost.save();

    
    await User.findByIdAndUpdate(req.user.id, { $inc: { postCount: 1 } });

    res.status(201).json(newPost);
  } catch (err) {
    console.error("❌ Error creating post:", err);
    res.status(500).json({ error: err.message });
  }
});


router.post("/:id/like", auth, async (req, res) => {
  try {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: "User ID missing in token" });
    }

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });

    const userId = new mongoose.Types.ObjectId(req.user.id);

    if (!Array.isArray(post.likes)) post.likes = [];

    const isLiked = post.likes.some(id => id.equals(userId));

    if (isLiked) {
      post.likes = post.likes.filter(id => !id.equals(userId));
    } else {
      post.likes.push(userId);
    }

    await post.save();
    res.json({ likes: post.likes.length, isLiked: !isLiked });
  } catch (err) {
    console.error("❌ Error toggling like:", err);
    res.status(500).json({ error: err.message });
  }
});


router.post("/:id/comment", auth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: "Comment text required" });

    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });

    const comment = {
      user: new mongoose.Types.ObjectId(req.user.id),
      text,
      createdAt: new Date(),
    };

    post.comments.push(comment);
    await post.save();

    await post.populate("comments.user", "username profilePhoto");

    res.json({ comments: post.comments });
  } catch (err) {
    console.error("❌ Error adding comment:", err);
    res.status(500).json({ error: err.message });
  }
});


router.post("/:id/save", auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });

    const userId = new mongoose.Types.ObjectId(req.user.id);
    const isSaved = post.savedBy.some(id => id.equals(userId));

    if (isSaved) {
      post.savedBy = post.savedBy.filter(id => !id.equals(userId));
    } else {
      post.savedBy.push(userId);
    }

    await post.save();
    res.json({ isSaved: !isSaved });
  } catch (err) {
    console.error("❌ Error toggling save:", err);
    res.status(500).json({ error: err.message });
  }
});
router.get("/:id", auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate("userId", "username profilePhoto")
      .populate("comments.user", "username profilePhoto")
      .populate("likes", "username")
      .populate("savedBy", "username");

    if (!post) return res.status(404).json({ error: "Post not found" });

    res.json(post);
  } catch (err) {
    console.error("❌ Error fetching post:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/view", auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });

    if (!Array.isArray(post.views)) {
      console.warn(`Post ${req.params.id} has views as ${typeof post.views}, migrating`);
      const oldCount = typeof post.views === 'number' ? post.views : 0;
      await Post.updateOne({ _id: req.params.id }, { $set: { views: [], viewscount: oldCount } });
      post.views = [];
      post.viewscount = oldCount;
    }

    if (!post.views.includes(req.user.username)) {
      post.views.push(req.user.username);
      post.viewscount += 1;
    }

    await post.save();

    res.json({ views: post.viewscount });
  } catch (err) {
    console.error("❌ Error incrementing view:", err);
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });

    if (post.username !== req.user.username) {
      return res.status(403).json({ error: "You can only delete your own posts" });
    }

    await Post.findByIdAndDelete(req.params.id);

    await User.findOneAndUpdate(
      { username: req.user.username },
      { $inc: { postCount: -1 } }
    );

    res.json({ message: "Post deleted successfully" });
  } catch (err) {
    console.error("❌ Error deleting post:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
