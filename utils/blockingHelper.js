const UserBlock = require('../models/UserBlock');

/**
 * Check if a user is currently blocked
 * @param {string} userId - User MongoDB ID
 * @param {string} anonId - Anonymous ID
 * @returns {Promise<{isBlocked: boolean, remainingMinutes?: number, reason?: string}>}
 */
async function checkIfUserIsBlocked(userId, anonId) {
  try {
    // Check by userId first
    let block = null;

    if (userId) {
      block = await UserBlock.findOne({
        userId,
        isActive: true,
        blockEndTime: { $gt: new Date() },
      });
    }

    // If no block found by userId, check by anonId
    if (!block && anonId) {
      block = await UserBlock.findOne({
        anonId,
        isActive: true,
        blockEndTime: { $gt: new Date() },
      });
    }

    if (!block) {
      return { isBlocked: false };
    }

    const now = new Date();
    const remainingMs = block.blockEndTime - now;
    const remainingMinutes = Math.ceil(remainingMs / (1000 * 60));

    return {
      isBlocked: true,
      remainingMinutes: Math.max(0, remainingMinutes),
      reason: block.blockReason,
      blockedByAnonId: block.blockedByAnonId || 'Moderator',
    };
  } catch (error) {
    console.error('Error checking user block status:', error);
    return { isBlocked: false };
  }
}

/**
 * Block a user for specified duration
 * @param {string} userId - User to block (MongoDB ID)
 * @param {string} anonId - Anonymous ID of user to block
 * @param {string} blockedBy - MongoDB ID of admin/moderator
 * @param {number} durationMinutes - Duration in minutes
 * @param {string} reason - Reason for blocking
 * @param {string} blockedByAnonId - AnonID of the blocker
 * @returns {Promise<object>} Created block record
 */
async function blockUser(userId, anonId, blockedBy, durationMinutes, reason = 'other', blockedByAnonId = null) {
  try {
    // Calculate end time
    const blockStartTime = new Date();
    const blockEndTime = new Date(blockStartTime.getTime() + durationMinutes * 60 * 1000);

    // Check if user is already blocked
    const existingBlock = await UserBlock.findOne({
      $or: [
        { userId, isActive: true },
        { anonId, isActive: true },
      ],
    });

    if (existingBlock) {
      // Update existing block
      existingBlock.blockEndTime = blockEndTime;
      existingBlock.durationMinutes = durationMinutes;
      existingBlock.blockReason = reason;
      existingBlock.isActive = true;
      existingBlock.blockStartTime = blockStartTime;
      await existingBlock.save();
      return existingBlock;
    }

    // Create new block
    const block = await UserBlock.create({
      userId,
      anonId,
      blockedBy,
      blockedByAnonId,
      durationMinutes,
      blockReason: reason,
      blockStartTime,
      blockEndTime,
      isActive: true,
    });

    return block;
  } catch (error) {
    console.error('Error blocking user:', error);
    throw error;
  }
}

/**
 * Unblock a user immediately
 * @param {string} userId - User to unblock
 * @param {string} anonId - Anonymous ID
 * @returns {Promise<boolean>} Success status
 */
async function unblockUser(userId, anonId) {
  try {
    const result = await UserBlock.updateMany(
      {
        $or: [
          { userId, isActive: true },
          { anonId, isActive: true },
        ],
      },
      {
        isActive: false,
      }
    );

    return result.modifiedCount > 0;
  } catch (error) {
    console.error('Error unblocking user:', error);
    throw error;
  }
}

/**
 * Get all active blocks
 * @returns {Promise<array>} List of active blocks
 */
async function getActiveBlocks() {
  try {
    return await UserBlock.find({
      isActive: true,
      blockEndTime: { $gt: new Date() },
    })
      .populate('userId', 'anonId username')
      .populate('blockedBy', 'anonId username')
      .sort({ blockStartTime: -1 });
  } catch (error) {
    console.error('Error getting active blocks:', error);
    throw error;
  }
}

/**
 * Get blocks for a specific user
 * @param {string} userId - User MongoDB ID
 * @param {string} anonId - Anonymous ID
 * @returns {Promise<array>} User's block history
 */
async function getUserBlockHistory(userId, anonId) {
  try {
    return await UserBlock.find({
      $or: [
        { userId },
        { anonId },
      ],
    })
      .populate('blockedBy', 'anonId username')
      .sort({ blockStartTime: -1 });
  } catch (error) {
    console.error('Error getting user block history:', error);
    throw error;
  }
}

module.exports = {
  checkIfUserIsBlocked,
  blockUser,
  unblockUser,
  getActiveBlocks,
  getUserBlockHistory,
};
