const Wallet = require("../models/Wallet");
const WalletTransaction = require("../models/WalletTransaction");

const BALANCE_BUCKET_MAP = {
  deposit_balance: "depositBalance",
  winning_balance: "winningBalance",
  bonus_balance: "bonusBalance",
};

function roundAmount(value) {
  return Number(Number(value).toFixed(2));
}

function getWalletTotal(wallet) {
  return roundAmount(wallet.depositBalance + wallet.winningBalance + wallet.bonusBalance);
}

async function ensureWallet(userId) {
  let wallet = await Wallet.findOne({ userId });
  if (!wallet) {
    wallet = await Wallet.create({
      userId,
      depositBalance: 0,
      winningBalance: 0,
      bonusBalance: 0,
    });
  }

  return wallet;
}

async function createWalletTransaction({
  userId,
  type,
  amount,
  status = "completed",
  balanceBucket = null,
  referenceId = null,
  metadata = {},
  source = 'unknown',
}) {
  return WalletTransaction.create({
    userId,
    type,
    amount: roundAmount(amount),
    status,
    balanceBucket,
    referenceId,
    metadata,
    source,
  });
}

async function applyWalletChange({
  userId,
  type,
  amount,
  balanceBucket,
  referenceId = null,
  metadata = {},
  source = 'unknown',
}) {
  const wallet = await ensureWallet(userId);
  const bucketKey = BALANCE_BUCKET_MAP[balanceBucket];

  if (!bucketKey) {
    throw new Error("Invalid balance bucket");
  }

  const nextBalance = roundAmount(wallet[bucketKey] + amount);
  if (nextBalance < 0) {
    throw new Error(`${balanceBucket} cannot go below zero`);
  }

await createWalletTransaction({
    userId,
    type,
    amount,
    balanceBucket,
    referenceId,
    metadata,
    source,
  });

  wallet[bucketKey] = nextBalance;
  await wallet.save();

  return wallet;
}

async function creditWalletBalance(args) {
  return applyWalletChange(args);
}

async function debitWalletBalance(args) {
  return applyWalletChange({
    ...args,
    amount: -Math.abs(args.amount),
  });
}

async function getWalletSummary(userId, split = false) {
  const wallet = await ensureWallet(userId);
  const summary = {
    deposit_balance: roundAmount(wallet.depositBalance),
    winning_balance: roundAmount(wallet.winningBalance),
    bonus_balance: roundAmount(wallet.bonusBalance),
    total_balance: getWalletTotal(wallet),
  };

  if (split) {
    const [realDeposit, referralEarnings] = await Promise.all([
      WalletTransaction.aggregate([
        { $match: { userId, source: 'deposit', status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]),
      WalletTransaction.aggregate([
        { $match: { userId, source: 'referral', status: 'completed' } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ])
    ]);
    summary.real_deposits = roundAmount(realDeposit[0]?.total || 0);
    summary.referral_earnings = roundAmount(referralEarnings[0]?.total || 0);
  }

  return summary;
}

async function debitGameEntry(userId, entryFee, referenceId = null, metadata = {}) {
  // Idempotency check
  if (referenceId) {
    const existing = await WalletTransaction.findOne({
      userId,
      referenceId,
      type: "game_entry"
    });
    if (existing) {
      console.warn(`Game entry already deducted: ${referenceId}`);
      return await ensureWallet(userId);
    }
  }

  const wallet = await ensureWallet(userId);
  const totalBalance = getWalletTotal(wallet);
  const amountToDebit = roundAmount(entryFee);

  if (totalBalance < amountToDebit) {
    throw new Error(`Insufficient wallet balance. Need Rs${amountToDebit}, have Rs${Math.floor(totalBalance)}`);
  }

  let remaining = amountToDebit;
  const buckets = ["deposit_balance", "winning_balance", "bonus_balance"];

  for (const bucket of buckets) {
    if (remaining <= 0) {
      break;
    }

    const bucketKey = BALANCE_BUCKET_MAP[bucket];
    const available = roundAmount(wallet[bucketKey]);
    if (available <= 0) {
      continue;
    }

    const debitAmount = Math.min(available, remaining);
    await debitWalletBalance({
      userId,
      type: "game_entry",
      amount: debitAmount,
      balanceBucket: bucket,
      referenceId,
      metadata,
    });
    remaining = roundAmount(remaining - debitAmount);
  }

  return await ensureWallet(userId);
}

async function refundGameEntry(userId, entryFee, referenceId = null, metadata = {}) {
  const amountToCredit = roundAmount(entryFee);
  
  // Idempotency check
  if (referenceId) {
    const existing = await WalletTransaction.findOne({
      userId,
      referenceId,
      type: "game_refund"
    });
    if (existing) {
      console.warn(`Game refund already processed: ${referenceId}`);
      return await ensureWallet(userId);
    }
  }

  // Credit back preferring deposit_balance (simplified)
  await creditWalletBalance({
    userId,
    type: "game_refund",
    amount: amountToCredit,
    balanceBucket: "deposit_balance",
    referenceId,
    metadata: {
      ...metadata,
      note: "Refund for cancelled/disconnected game"
    }
  });

  console.log(`Game refund completed: Rs${amountToCredit} to user ${userId}`);
  return await ensureWallet(userId);
}

module.exports = {
  createWalletTransaction,
  applyWalletChange,
  creditWalletBalance,
  debitWalletBalance,
  debitGameEntry,
  refundGameEntry,
  ensureWallet,
  getWalletSummary,
  roundAmount,
};
