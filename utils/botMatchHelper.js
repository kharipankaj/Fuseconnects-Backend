// Bot Match Helper - Shared across all games
const User = require('../models/User');

// Bot outcomes: 3 LOSS, 2 WIN shuffled for realism
const BOT_OUTCOMES = ['LOSS', 'WIN', 'LOSS', 'WIN', 'LOSS'];

/**
 * Check if user eligible for bot match (first 5 games)
 */
async function isBotMatchEligible(userId) {
  const user = await User.findById(userId).select('botMatchesPlayed');
  return user.botMatchesPlayed < 5;
}

/**
 * Get predetermined outcome for user's nth bot match
 */
function getBotOutcome(botMatchIndex) {
  return BOT_OUTCOMES[botMatchIndex];
}

/**
 * Generate realistic bot performance based on game + desired outcome
 */
function generateBotPerformance(gameKey, favorUserWin) {
  const performances = {
    'math_quiz': {
      botScore: favorUserWin ? 12 + Math.floor(Math.random()*3) : 15 + Math.floor(Math.random()*2),
      botCorrect: favorUserWin ? 3 : 4
    },
    'typing_race': {
      botProgress: favorUserWin ? 75 + Math.floor(Math.random()*10) : 85 + Math.floor(Math.random()*5),
      botWpm: favorUserWin ? 75 + Math.floor(Math.random()*15) : 95 + Math.floor(Math.random()*10)
    },
    'reaction_tap': {
      botAvgMs: favorUserWin ? 220 + Math.floor(Math.random()*40) : 180 + Math.floor(Math.random()*25)
    },
    'memory_match': {
      botPairs: favorUserWin ? 5 + Math.floor(Math.random()*1) : 6 + Math.floor(Math.random()*1),
      botMoves: 12 + Math.floor(Math.random()*3)
    }
  };
  return performances[gameKey] || { score: 100 };
}

/**
 * Update user bot stats after match
 */
async function updateBotMatchStats(userId, outcome, gameKey, matchData = {}) {
  const user = await User.findById(userId);
  user.botMatchesPlayed += 1;
  
  // Track game history (optional analytics)
  if (!user.gameHistory) user.gameHistory = [];
  user.gameHistory.push({
    game: gameKey,
    outcome,
    score: matchData.score || 0,
    playedAt: new Date()
  });
  
  await user.save();
  console.log(`🤖 User ${userId.slice(-4)} bot match #${user.botMatchesPlayed}: ${outcome} (${gameKey})`);
}

module.exports = {
  isBotMatchEligible,
  getBotOutcome,
  generateBotPerformance,
  updateBotMatchStats
};

