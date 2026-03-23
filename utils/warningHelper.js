const UserWarning = require("../models/UserWarning");

/**
 * Get active warning count for a user
 */
async function getActiveWarnings(userId, anonId) {
  const count = await UserWarning.countDocuments({
    $or: [
      { userId, status: 'active' },
      { anonId, status: 'active' }
    ]
  });
  return count;
}

/**
 * Get recent violations (last 7 days)
 */
async function getRecentViolations(userId, anonId) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  
  const violations = await UserWarning.find({
    $or: [
      { userId, createdAt: { $gte: sevenDaysAgo } },
      { anonId, createdAt: { $gte: sevenDaysAgo } }
    ]
  }).lean();
  
  return violations;
}

/**
 * Check if user should be suspended (3+ violations in 7 days)
 */
async function shouldSuspendUser(userId, anonId) {
  const recentViolations = await getRecentViolations(userId, anonId);
  return recentViolations.length >= 3;
}

/**
 * Check if user should be banned (5+ violations in 30 days)
 */
async function shouldBanUser(userId, anonId) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  
  const violations = await UserWarning.countDocuments({
    $or: [
      { userId, createdAt: { $gte: thirtyDaysAgo } },
      { anonId, createdAt: { $gte: thirtyDaysAgo } }
    ]
  });
  
  return violations >= 5;
}

/**
 * Get violation summary for a user
 */
async function getViolationSummary(userId, anonId) {
  const allViolations = await UserWarning.find({
    $or: [{ userId }, { anonId }]
  }).lean();

  const byType = {};
  allViolations.forEach(v => {
    byType[v.violationType] = (byType[v.violationType] || 0) + 1;
  });

  const recent7Days = await getRecentViolations(userId, anonId);
  const suspended = await shouldSuspendUser(userId, anonId);
  const banned = await shouldBanUser(userId, anonId);

  return {
    totalViolations: allViolations.length,
    violationsByType: byType,
    recent7Days: recent7Days.length,
    recent30Days: allViolations.slice(0, allViolations.length).filter(
      v => Date.now() - v.createdAt.getTime() < 30 * 24 * 60 * 60 * 1000
    ).length,
    shouldSuspend: suspended,
    shouldBan: banned,
    lastViolation: allViolations[0]?.createdAt || null
  };
}

/**
 * Create a warning log
 */
async function createWarning(warningData) {
  const warning = await UserWarning.create(warningData);
  return warning;
}

module.exports = {
  getActiveWarnings,
  getRecentViolations,
  shouldSuspendUser,
  shouldBanUser,
  getViolationSummary,
  createWarning
};
