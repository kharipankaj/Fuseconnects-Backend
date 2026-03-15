const { debitGameEntry, creditWalletBalance, ensureWallet } = require('./walletService');
const WalletTransaction = require('../models/WalletTransaction');

const GAME_NAMESPACE = 'game:';

/**
 * Atomic game wallet operations with idempotency
 */
async function deductGameEntry(userId, gameKey, entryAmount, matchId, metadata = {}) {
  const referenceId = `${GAME_NAMESPACE}${gameKey}:${matchId}`;
  
  try {
    // Idempotency check
    const existing = await WalletTransaction.findOne({
      userId,
      referenceId,
      type: 'game_entry'
    });
    
    if (existing) {
      throw new Error(`Entry already deducted for match ${matchId}`);
    }
    
    const wallet = await debitGameEntry(userId, entryAmount, referenceId, {
      game: gameKey,
      matchId,
      ...metadata
    });
    
    return wallet;
  } catch (error) {
    console.error(`Game entry deduction failed [${gameKey}:${matchId}]:`, error.message);
    throw error;
  }
}

async function payoutGameWinner(userId, gameKey, amount, matchId, isLoser = false, metadata = {}) {
  const type = isLoser ? 'game_loser_payout' : 'game_winner_payout';
  const referenceId = `${GAME_NAMESPACE}${gameKey}:${matchId}:payout`;
  
  try {
    const wallet = await ensureWallet(userId);
    const existing = await WalletTransaction.findOne({
      userId,
      referenceId,
      type
    });
    
    if (existing) {
      console.warn(`Payout already processed [${gameKey}:${matchId}]`);
      return wallet;
    }
    
    await creditWalletBalance({
      userId,
      type,
      amount,
      balanceBucket: 'winning_balance',
      referenceId,
      metadata: {
        game: gameKey,
        matchId,
        ...metadata
      }
    });
    
    return await ensureWallet(userId);
  } catch (error) {
    console.error(`Game payout failed [${gameKey}:${matchId}]:`, error.message);
    throw error;
  }
}

async function refundGameEntry(userId, gameKey, matchId, metadata = {}) {
  const referenceId = `${GAME_NAMESPACE}${gameKey}:${matchId}:refund`;
  
  try {
    // Credit back to original buckets (reverse debitGameEntry)
    await creditWalletBalance({
      userId,
      type: 'game_refund',
      amount: metadata.originalEntry || 0,
      balanceBucket: 'deposit_balance', // Simplified - in prod track original bucket
      referenceId,
      metadata: {
        game: gameKey,
        matchId,
        reason: metadata.reason || 'disconnect',
        ...metadata
      }
    });
    
    console.log(`Refund completed [${gameKey}:${matchId}]`);
  } catch (error) {
    console.error(`Game refund failed [${gameKey}:${matchId}]:`, error.message);
    throw error;
  }
}

async function validateGameEntry(userId, entryAmount) {
  const wallet = await ensureWallet(userId);
  const totalBalance = wallet.depositBalance + wallet.winningBalance + wallet.bonusBalance;
  
  if (totalBalance < entryAmount) {
    throw new Error(`Insufficient balance. Need Rs${entryAmount}, have Rs${Math.floor(totalBalance)}`);
  }
  
  return true;
}

module.exports = {
  deductGameEntry,
  payoutGameWinner,
  refundGameEntry,
  validateGameEntry
};
