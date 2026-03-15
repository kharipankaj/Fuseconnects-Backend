const PlatformFeeCollection = require("../models/PlatformFeeCollection");

function roundAmount(value) {
  return Number(Number(value || 0).toFixed(2));
}

async function recordPlatformFeeCollection({
  matchId,
  gameKey,
  gameLabel,
  entryAmount,
  winnerReward,
  loserReward,
  platformFee,
  playerOne,
  playerTwo,
  metadata = {},
}) {
  if (!matchId || !gameKey || !gameLabel) {
    throw new Error("Platform fee record requires matchId, gameKey, and gameLabel");
  }

  return PlatformFeeCollection.findOneAndUpdate(
    { matchId },
    {
      $set: {
        gameKey,
        gameLabel,
        entryAmount: roundAmount(entryAmount),
        totalPool: roundAmount(Number(entryAmount || 0) * 2),
        winnerReward: roundAmount(winnerReward),
        loserReward: roundAmount(loserReward),
        platformFee: roundAmount(platformFee),
        playerOne: {
          id: String(playerOne?.id || ""),
          name: String(playerOne?.name || "Player 1"),
        },
        playerTwo: {
          id: String(playerTwo?.id || ""),
          name: String(playerTwo?.name || "Player 2"),
        },
        metadata,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    }
  );
}

module.exports = {
  recordPlatformFeeCollection,
  roundAmount,
};
