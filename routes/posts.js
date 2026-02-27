const express = require("express");
const router = express.Router();
const Post = require("../models/postcard");
const User = require("../models/User");
const auth = require("../middleware/auth.js");
const mongoose = require("mongoose");
const { createNotification } = require("../utils/notificationHelper");
const { trackSingleView } = require("../utils/viewTracker");
const NodeCache = require("node-cache");

const userProfileCache = new NodeCache({ stdTTL: 600, checkperiod: 60 });

router.get("/", auth, async (req, res) => {
  try {
    const posts = await Post.find({
      username: req.user.username,
      isHidden: false
    })
      .populate("userId", "username displayPicture")
      .populate("comments.user", "username displayPicture")
      .sort({ createdAt: -1 })
      .lean();

    res.json(posts);
  } catch (err) {
    console.error("❌ Error fetching posts:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/user/:username", auth, async (req, res) => {
  try {
    const username = req.params.username;
    const viewerId = req.user ? req.user.id : null;

    const user = await User.findOne({ username });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.isPrivate) {
      if (!viewerId) {
        return res.status(403).json({ error: "Posts are private" });
      }
      const isFollower = user.followers.some(followerId => followerId.toString() === viewerId);
      if (!isFollower) {
        return res.status(403).json({ error: "Posts are private" });
      }
    }

    const posts = await Post.find({
      username,
      isHidden: false
    })
      .populate("userId", "username displayPicture")
      .populate("comments.user", "username displayPicture")
      .sort({ createdAt: -1 })
      .lean();

    const postCount = posts.length;
    await User.findOneAndUpdate(
      { username },
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
    if (!isLiked && post.userId.toString() !== req.user.id) {
      await createNotification('like', req.user.id, post.userId, post._id);
    }

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

    if (post.commentsDisabled) {
      return res.status(403).json({ error: "Comments are disabled for this post" });
    }

    const comment = {
      user: new mongoose.Types.ObjectId(req.user.id),
      text,
      createdAt: new Date(),
    };

    post.comments.push(comment);
    await post.save();

    await post.populate("comments.user", "username displayPicture ");

    if (post.userId.toString() !== req.user.id) {
      await createNotification('comment', req.user.id, post.userId, post._id);
    }

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

    if (!isSaved && post.userId.toString() !== req.user.id) {
      await createNotification('save', req.user.id, post.userId, post._id, 'saved your post');
    }

    res.json({ isSaved: !isSaved });
  } catch (err) {
    console.error("❌ Error toggling save:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/saved", auth, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const posts = await Post.find({ savedBy: userId })
      .populate("userId", "username displayPicture ")
      .populate("comments.user", "username displayPicture ")
      .sort({ createdAt: -1 });

    res.json(posts);
  } catch (err) {
    console.error("❌ Error fetching saved posts:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/liked", auth, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const posts = await Post.find({ likes: userId })
      .populate("userId", "username displayPicture")
      .populate("comments.user", "username displayPicture")
      .sort({ createdAt: -1 });

    res.json(posts);
  } catch (err) {
    console.error("❌ Error fetching liked posts:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/comments", auth, async (req, res) => {
  try {
    const userId = new mongoose.Types.ObjectId(req.user.id);
    const posts = await Post.find({ "comments.user": userId })
      .populate("userId", "username displayPicture")
      .populate("comments.user", "username displayPicture")
      .sort({ createdAt: -1 });

    const userComments = [];
    posts.forEach(post => {
      post.comments.forEach(comment => {
        if (comment.user.equals(userId)) {
          userComments.push({
            postId: post._id,
            postCaption: post.caption,
            postUsername: post.username,
            comment: comment
          });
        }
      });
    });

    res.json(userComments);
  } catch (err) {
    console.error("❌ Error fetching user comments:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/hidden", auth, async (req, res) => {
  try {
    const posts = await Post.find({
      username: req.user.username,
      isHidden: true
    })
      .populate("userId", "username displayPicture")
      .populate("comments.user", "username displayPicture ")
      .sort({ createdAt: -1 });

    res.json(posts);
  } catch (err) {
    console.error("❌ Error fetching hidden posts:", err);
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id)
      .populate("userId", "username displayPicture")
      .populate("comments.user", "username displayPicture")
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
    await trackSingleView(req.params.id, req.user.username);
    const post = await Post.findById(req.params.id).select('viewscount');
    res.json({ views: post.viewscount });
  } catch (err) {
    console.error("❌ Error incrementing view:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/:postId/comments/:commentId/report", auth, async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: "Report reason required" });

    const post = await Post.findById(req.params.postId);
    if (!post) return res.status(404).json({ error: "Post not found" });

    const comment = post.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ error: "Comment not found" });

    console.log(`Report on comment ${req.params.commentId} by ${req.user.username}: ${reason}`);

    res.json({ message: "Comment reported successfully" });
  } catch (err) {
    console.error("❌ Error reporting comment:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/hide", auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });

    if (post.username !== req.user.username) {
      return res.status(403).json({ error: "You can only hide your own posts" });
    }

    post.isHidden = !post.isHidden;
    await post.save();

    res.json({
      message: `Post ${post.isHidden ? 'hidden' : 'unhidden'} successfully`,
      isHidden: post.isHidden
    });
  } catch (err) {
    console.error("❌ Error toggling post visibility:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/hide-likes", auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });

    if (post.username !== req.user.username) {
      return res.status(403).json({ error: "You can only hide likes on your own posts" });
    }

    post.hideLikes = !post.hideLikes;
    await post.save();

    res.json({
      message: `Like button ${post.hideLikes ? 'hidden' : 'shown'} successfully`,
      hideLikes: post.hideLikes
    });
  } catch (err) {
    console.error("❌ Error toggling like button visibility:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/disable-comments", auth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });

    if (post.username !== req.user.username) {
      return res.status(403).json({ error: "You can only disable comments on your own posts" });
    }

    post.commentsDisabled = !post.commentsDisabled;
    await post.save();

    res.json({
      message: `Comments ${post.commentsDisabled ? 'disabled' : 'enabled'} successfully`,
      commentsDisabled: post.commentsDisabled
    });
  } catch (err) {
    console.error("❌ Error toggling comments:", err);
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
