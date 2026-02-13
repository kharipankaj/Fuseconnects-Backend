const User = require('../models/User');

// Role hierarchy for comparisons
const ROLE_RANK = {
  user: 0,
  helper: 1,
  moderator: 2,
  admin: 3
};

// Trust score levels
const TRUST_LEVELS = {
  HIGH: 70,
  MEDIUM: 40,
  LOW: 30,
  VERY_LOW: 0
};

// User states priority (higher number = more restrictive)
const STATE_PRIORITY = {
  active: 0,
  new: 1,
  limited: 2,
  suspended: 3,
  banned: 4
};

/**
 * Core permission checking function - Instagram-style logic
 * @param {Object} params - Permission check parameters
 * @param {string} params.action - The action being performed (e.g., 'create_post', 'send_message')
 * @param {Object} params.actor - The user performing the action
 * @param {Object} params.target - The target user/content/room (optional)
 * @param {string} params.context - Context of the action (e.g., 'own_content', 'public_room', 'private_room')
 * @param {Object} params.metadata - Additional metadata (optional)
 * @returns {Object} { allowed: boolean, reason: string, silent: boolean }
 */
async function checkPermission({ action, actor, target, context = 'general', metadata = {} }) {
  try {
    // 1. Check user state first (most restrictive)
    const stateCheck = checkUserState(actor);
    if (!stateCheck.allowed) {
      return stateCheck;
    }

    // 2. Check role-based permissions
    const roleCheck = checkRolePermission(action, actor.role);
    if (!roleCheck.allowed) {
      return roleCheck;
    }

    // 3. Check relationship-based permissions
    if (target && target._id) {
      const relationshipCheck = await checkRelationshipPermission(action, actor, target);
      if (!relationshipCheck.allowed) {
        return relationshipCheck;
      }
    }

    // 4. Check context-specific rules
    const contextCheck = checkContextPermission(action, context, actor, target);
    if (!contextCheck.allowed) {
      return contextCheck;
    }

    // 5. Apply trust score limits
    const trustCheck = checkTrustScoreLimits(action, actor.trustScore);
    if (!trustCheck.allowed) {
      return trustCheck;
    }

    // 6. Check for soft restrictions (silent limits)
    const softCheck = checkSoftRestrictions(action, actor, target);
    if (softCheck.silent) {
      return softCheck;
    }

    return { allowed: true, reason: 'Permission granted', silent: false };

  } catch (error) {
    console.error('Permission check error:', error);
    return { allowed: false, reason: 'Permission check failed', silent: false };
  }
}

/**
 * Check user state restrictions
 */
function checkUserState(user) {
  const state = user.userState || 'active';

  switch (state) {
    case 'banned':
      return { allowed: false, reason: 'Account banned', silent: false };
    case 'suspended':
      return { allowed: false, reason: 'Account suspended', silent: false };
    case 'limited':
      return { allowed: true, reason: 'Limited account - some actions restricted', silent: false };
    case 'new':
      return { allowed: true, reason: 'New account - rate limited', silent: false };
    default:
      return { allowed: true, reason: 'Active account', silent: false };
  }
}

/**
 * Check role-based permissions
 */
function checkRolePermission(action, role) {
  const userRank = ROLE_RANK[role] || 0;

  // Define minimum roles for actions
  const roleRequirements = {
    // Moderation actions
    warn_user: 1, // helper
    add_strike: 2, // moderator
    suspend_user: 2, // moderator
    ban_user: 3, // admin
    shadow_ban: 3, // admin

    // Content moderation
    delete_post: 1,
    hide_comment: 1,
    moderate_room: 2,

    // General actions (user level)
    create_post: 0,
    send_message: 0,
    comment: 0,
    follow: 0,
    like: 0
  };

  const requiredRank = roleRequirements[action] || 0;

  if (userRank < requiredRank) {
    return { allowed: false, reason: `Insufficient role for ${action}`, silent: false };
  }

  return { allowed: true, reason: 'Role check passed', silent: false };
}

/**
 * Check relationship-based permissions
 */
async function checkRelationshipPermission(action, actor, target) {
  // Self actions always allowed
  if (actor._id.equals(target._id)) {
    return { allowed: true, reason: 'Self action', silent: false };
  }

  // Check if blocked
  if (actor.isBlocked(target._id)) {
    return { allowed: false, reason: 'User blocked', silent: false };
  }

  // Check if target blocked actor
  if (target.isBlocked && target.isBlocked(actor._id)) {
    return { allowed: false, reason: 'Blocked by target', silent: false };
  }

  // Check relationship type
  const isFollowing = actor.following && actor.following.includes(target._id);
  const isMutual = isFollowing && target.following && target.following.includes(actor._id);
  const isPrivate = target.isPrivate;

  // Private account rules
  if (isPrivate && !isFollowing && action !== 'follow') {
    return { allowed: false, reason: 'Private account - follow required', silent: false };
  }

  // Action-specific relationship checks
  switch (action) {
    case 'send_dm':
      if (!isFollowing && !isMutual) {
        return { allowed: false, reason: 'Must follow to send DM', silent: false };
      }
      break;
    case 'view_private_profile':
      if (!isFollowing) {
        return { allowed: false, reason: 'Must follow to view private profile', silent: false };
      }
      break;
  }

  return { allowed: true, reason: 'Relationship check passed', silent: false };
}

/**
 * Check context-specific permissions
 */
function checkContextPermission(action, context, actor, target) {
  switch (context) {
    case 'own_content':
      return { allowed: true, reason: 'Own content', silent: false };

    case 'public_room':
      return { allowed: true, reason: 'Public room', silent: false };

    case 'private_room':
      // Check if user is member of private room
      if (target && target.members && !target.members.includes(actor._id)) {
        return { allowed: false, reason: 'Not a member of private room', silent: false };
      }
      return { allowed: true, reason: 'Private room member', silent: false };

    case 'anonymous':
      // Stricter rules for anonymous contexts
      if (actor.trustScore < TRUST_LEVELS.MEDIUM) {
        return { allowed: false, reason: 'Low trust score for anonymous action', silent: false };
      }
      return { allowed: true, reason: 'Anonymous context allowed', silent: false };

    case 'sensitive_topic':
      if (actor.trustScore < TRUST_LEVELS.HIGH) {
        return { allowed: false, reason: 'High trust required for sensitive topics', silent: false };
      }
      return { allowed: true, reason: 'Sensitive topic access granted', silent: false };

    default:
      return { allowed: true, reason: 'General context', silent: false };
  }
}

/**
 * Check trust score limits
 */
function checkTrustScoreLimits(action, trustScore) {
  const limits = {
    create_post: TRUST_LEVELS.LOW,
    send_message: TRUST_LEVELS.LOW,
    comment: TRUST_LEVELS.MEDIUM,
    create_room: TRUST_LEVELS.MEDIUM,
    anonymous_action: TRUST_LEVELS.MEDIUM
  };

  const requiredScore = limits[action] || TRUST_LEVELS.VERY_LOW;

  if (trustScore < requiredScore) {
    return { allowed: false, reason: `Trust score too low for ${action}`, silent: false };
  }

  return { allowed: true, reason: 'Trust score sufficient', silent: false };
}

/**
 * Check soft restrictions (silent limits)
 */
function checkSoftRestrictions(action, actor, target) {
  if (!target || !actor.isRestricted(target._id)) {
    return { allowed: true, reason: 'No restrictions', silent: false };
  }

  const restrictions = actor.getRestrictionLevel(target._id);

  switch (action) {
    case 'comment':
      if (restrictions.commentHidden) {
        return { allowed: true, reason: 'Comment will be hidden', silent: true };
      }
      break;
    case 'send_dm':
      if (restrictions.dmDelayed) {
        return { allowed: true, reason: 'DM will be delayed', silent: true };
      }
      break;
    case 'create_post':
      if (restrictions.postReachZero) {
        return { allowed: true, reason: 'Post reach will be zero', silent: true };
      }
      break;
    case 'anon_chat':
      if (restrictions.anonReadOnly) {
        return { allowed: false, reason: 'Read-only in anonymous chat', silent: false };
      }
      break;
  }

  return { allowed: true, reason: 'Soft restrictions applied', silent: false };
}

/**
 * Get relationship type between two users
 */
async function getRelationshipType(userA, userB) {
  if (userA._id.equals(userB._id)) return 'self';

  const isAFollowingB = userA.following && userA.following.includes(userB._id);
  const isBFollowingA = userB.following && userB.following.includes(userA._id);

  if (isAFollowingB && isBFollowingA) return 'mutual';
  if (isAFollowingB) return 'following';
  if (isBFollowingA) return 'follower';

  return 'none';
}

/**
 * Apply rate limiting based on trust score
 */
function getRateLimit(action, trustScore) {
  const baseLimits = {
    create_post: { high: 10, medium: 5, low: 1 },
    send_message: { high: 50, medium: 20, low: 5 },
    comment: { high: 30, medium: 10, low: 3 },
    follow: { high: 20, medium: 10, low: 3 }
  };

  const limits = baseLimits[action];
  if (!limits) return null;

  if (trustScore >= TRUST_LEVELS.HIGH) return limits.high;
  if (trustScore >= TRUST_LEVELS.MEDIUM) return limits.medium;
  return limits.low;
}

/**
 * Log permission decision for analytics
 */
function logPermissionDecision(decision, params) {
  // In production, this would log to a service like DataDog, CloudWatch, etc.
  console.log('Permission Decision:', {
    action: params.action,
    actor: params.actor._id,
    target: params.target?._id,
    allowed: decision.allowed,
    reason: decision.reason,
    silent: decision.silent,
    timestamp: new Date()
  });
}

module.exports = {
  checkPermission,
  getRelationshipType,
  getRateLimit,
  logPermissionDecision,
  ROLE_RANK,
  TRUST_LEVELS,
  STATE_PRIORITY
};
