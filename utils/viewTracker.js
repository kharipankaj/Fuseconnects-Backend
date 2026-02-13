const Post = require("../models/postcard");

/**
 * @param {String} postId 
 * @param {String} username 
 * @returns {Promise<Boolean>} 
 */
async function trackSingleView(postId, username) {
  const post = await Post.findById(postId);
  if (!post) {
    throw new Error("Post not found");
  }

  if (!Array.isArray(post.views)) {
    const oldCount = typeof post.views === 'number' ? post.views : 0;
    await Post.updateOne({ _id: postId }, { $set: { views: [], viewscount: oldCount } });
    post.views = [];
    post.viewscount = oldCount;
  }

  if (!post.views.includes(username)) {
    post.views.push(username);
    post.viewscount += 1;
    await post.save();
    return true;
  }
  return false;
}

/**
 * @param {Array<String>} postIds - Array of post IDs to track views for.
 * @param {String} username - The username of the viewer.
 * @returns {Promise<Object>} - Returns an object with totalViewsAdded and results array.
 */
async function trackBulkViews(postIds, username) {
  if (!Array.isArray(postIds) || postIds.length === 0) {
    throw new Error("postIds array is required");
  }
  if (!username) {
    throw new Error("Username is required");
  }

  const results = [];
  let totalViewsAdded = 0;

  for (const postId of postIds) {
    try {
      const added = await trackSingleView(postId, username);
      results.push({ postId, success: true, viewsAdded: added ? 1 : 0 });
      if (added) totalViewsAdded += 1;
    } catch (err) {
      results.push({ postId, error: err.message });
    }
  }

  return { totalViewsAdded, results };
}

module.exports = {
  trackSingleView,
  trackBulkViews,
};
