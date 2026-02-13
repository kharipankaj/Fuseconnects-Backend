const express = require("express");
const router = express.Router();
const Post = require("../models/postcard");
const User = require("../models/User");
const auth = require("../middleware/auth.js");
const { trackBulkViews } = require("../utils/viewTracker");
const NodeCache = require("node-cache");

const userProfileCache = new NodeCache({ stdTTL: 600, checkperiod: 60 });


router.get("/", auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const trackViews = req.query.trackViews === 'true'; 
    const currentUser = await User.findById(req.user.id).select('following');
    const followingList = currentUser.following.map(id => id.toString());

    const postsQuery = Post.find()
      .populate("userId", "username displayPicture isPrivate")
      .populate("comments.user", "username displayPicture")
      .populate("likes", "_id username")
      .populate("savedBy", "_id username")
      .sort({ createdAt: -1 });

    const allPosts = await postsQuery.lean();

    const filteredPosts = allPosts.filter(post => {
      const postAuthor = post.userId;

      if (postAuthor._id.toString() === req.user.id) {
        return true;
      }

      if (!postAuthor.isPrivate) {
        return true;
      }

      return followingList.includes(postAuthor._id.toString());
    });

    const skip = (page - 1) * limit;
    const paginatedPosts = filteredPosts.slice(skip, skip + limit);

    if (trackViews && req.user && req.user.username) {
      try {
        const postIds = paginatedPosts.map(post => post._id.toString());
        await trackBulkViews(postIds, req.user.username);
      } catch (viewError) {
      }
    }

    const processedPosts = paginatedPosts.map(post => {
      if (post.userId) {
        const user = post.userId;
        user.displayPicture = user.displayPicture ||
          null;
      }

      if (post.comments && post.comments.length > 0) {
        post.comments = post.comments.map(comment => {
          if (comment.user) {
            const user = comment.user;
            user.displayPicture = user.displayPicture ||
              null;
          }
          return comment;
        });
      }

      return post;
    });

    const total = filteredPosts.length;

    res.json({
      data: processedPosts,
      page,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    });
  } catch (err) {
    console.error("❌ Error fetching feed posts:", err);
    res.status(500).json({ error: err.message });
  }
});

router.post("/view", auth, async (req, res) => {
  try {
    const { postIds } = req.body;

    if (!postIds || !Array.isArray(postIds) || postIds.length === 0) {
      return res.status(400).json({ error: "postIds array is required" });
    }

    if (!req.user || !req.user.username) {
      return res.status(401).json({ error: "User authentication required" });
    }

    const { totalViewsAdded, results } = await trackBulkViews(postIds, req.user.username);

    res.json({
      message: `View tracking completed`,
      totalViewsAdded,
      results
    });
  } catch (err) {
    console.error("❌ Error in bulk view tracking:", err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
