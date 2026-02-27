const User = require('../models/User');

// Role hierarchy for comparisons
const ROLE_RANK = {
  user: 0,
  helper: 1,
  moderator: 2,
  admin: 3
};

async function loadFullUser(req, res, next) {
  try {
    if (!req.user || !req.user.id) return res.status(401).json({ message: 'Unauthorized' });
    const user = await User.findById(req.user.id).select('+role +banned +suspendedUntil');
    if (!user) return res.status(401).json({ message: 'Unauthorized: user not found' });

    // attach full user document
    req.currentUser = user;

    // check for ban/suspension
    if (user.banned) return res.status(403).json({ message: 'Account banned' });
    if (user.suspendedUntil && user.suspendedUntil > new Date()) {
      return res.status(403).json({ message: 'Account suspended until ' + user.suspendedUntil.toISOString() });
    }

    return next();
  } catch (err) {
    console.error('moderationAuth: loadFullUser error', err);
    return res.status(500).json({ message: 'Server error' });
  }
}

function requireRole(minRole) {
  return async function (req, res, next) {
    if (!req.currentUser) {
      // try to load
      await loadFullUser(req, res, async () => {});
    }

    const user = req.currentUser;
    if (!user) return res.status(401).json({ message: 'Unauthorized' });

    const userRank = ROLE_RANK[user.role || 'user'] || 0;
    const minRank = ROLE_RANK[minRole] || 0;

    if (userRank < minRank) {
      return res.status(403).json({ message: 'Forbidden: insufficient role' });
    }

    return next();
  };
}

function isHelper(req, res, next) {
  return requireRole('helper')(req, res, next);
}

function isModerator(req, res, next) {
  return requireRole('moderator')(req, res, next);
}

function isAdmin(req, res, next) {
  return requireRole('admin')(req, res, next);
}

/**
 * Dynamic permission middleware using Instagram-style permission matrix
 * @param {string} action - The action being performed
 * @param {Object} options - Additional options
 * @param {string} options.context - Context of the action
 * @param {boolean} options.requireTarget - Whether target user is required
 * @param {Function} options.targetLoader - Function to load target user
 */
function requirePermission(action, options = {}) {
  return async function (req, res, next) {
    try {
      if (!req.currentUser) {
        await loadFullUser(req, res, () => {});
      }

      const actor = req.currentUser;
      if (!actor) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      let target = null;
      if (options.requireTarget) {
        if (options.targetLoader) {
          target = await options.targetLoader(req);
        } else if (req.params.userId || req.body.targetUserId) {
          const targetId = req.params.userId || req.body.targetUserId;
          target = await User.findById(targetId);
        }

        if (!target && options.requireTarget) {
          return res.status(400).json({ message: 'Target user required' });
        }
      }

      const context = options.context || 'general';
      const metadata = { ...req.body, ...req.params };

      const permissionResult = await checkPermission({
        action,
        actor,
        target,
        context,
        metadata
      });

      if (!permissionResult.allowed) {
        return res.status(permissionResult.silent ? 200 : 403).json({
          message: permissionResult.reason,
          silent: permissionResult.silent
        });
      }

      // Attach permission result for logging/analytics
      req.permissionResult = permissionResult;

      // Update user's last activity
      actor.lastActivity = new Date();
      actor.accountAge = Math.floor((Date.now() - actor.createdAt) / (1000 * 60 * 60 * 24));
      await actor.updateUserState();

      next();
    } catch (error) {
      console.error('Permission middleware error:', error);
      return res.status(500).json({ message: 'Permission check failed' });
    }
  };
}

// Specific action-based middleware
function canCreatePost(req, res, next) {
  return requirePermission('create_post')(req, res, next);
}

function canSendMessage(req, res, next) {
  return requirePermission('send_message')(req, res, next);
}

function canComment(req, res, next) {
  return requirePermission('comment')(req, res, next);
}

function canFollow(req, res, next) {
  return requirePermission('follow', { requireTarget: true })(req, res, next);
}

function canModerate(req, res, next) {
  return requirePermission('moderate')(req, res, next);
}

function canViewPrivateProfile(req, res, next) {
  return requirePermission('view_private_profile', {
    requireTarget: true,
    context: 'private_profile'
  })(req, res, next);
}

function canSendDM(req, res, next) {
  return requirePermission('send_dm', {
    requireTarget: true,
    context: 'direct_message'
  })(req, res, next);
}

module.exports = {
  loadFullUser,
  requireRole,
  isHelper,
  isModerator,
  isAdmin,
  requirePermission,
  canCreatePost,
  canSendMessage,
  canComment,
  canFollow,
  canModerate,
  canViewPrivateProfile,
  canSendDM
};
