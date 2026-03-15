const express = require("express");
const auth = require("../middleware/auth");
const DepositRequest = require("../models/DepositRequest");
const PlatformFeeCollection = require("../models/PlatformFeeCollection");
const WithdrawRequest = require("../models/WithdrawRequest");
const WalletTransaction = require("../models/WalletTransaction");
const cloudinaryUpload = require("../middleware/cloudinaryUpload.js");
const User = require("../models/User");
const {
  creditWalletBalance,
  debitWalletBalance,
  ensureWallet,
  getWalletSummary,
  roundAmount,
} = require("../services/walletService");

const router = express.Router();

const MIN_WITHDRAW_AMOUNT = 500;
const MAX_WITHDRAW_AMOUNT = 5000;
const DAILY_WITHDRAW_LIMIT = 10000;

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "Access denied" });
  }

  return next();
}

function isValidUpiId(value) {
  return typeof value === "string" && /^[\w.\-]{2,256}@[a-zA-Z]{2,64}$/.test(value.trim());
}

router.get("/", auth, async (req, res) => {
  try {
    const summary = await getWalletSummary(req.user.id, true);
    return res.json(summary);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get("/transactions", auth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const transactions = await WalletTransaction.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({ transactions });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get("/deposit-requests", auth, async (req, res) => {
  try {
    const requests = await DepositRequest.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ requests });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/deposit-requests", auth, cloudinaryUpload("file"), async (req, res) => {
  try {

    if (!req.uploadedData) {
      return res.status(400).json({ success: false, message: "File upload failed" });
    }
    const { url, mediaType } = req.uploadedData;
    
    const amount = roundAmount(req.body.amount);
    const utr = String(req.body.utr || "").trim().toUpperCase();
    const screenshotUrl = String(req.uploadedData.url ||"").trim();

if (amount < 50) {
      return res.status(400).json({ error: "Minimum deposit amount is Rs 50" });
    }

    if (!utr) {
      return res.status(400).json({ error: "UTR is required" });
    }

    const existing = await DepositRequest.findOne({ utr });
    if (existing) {
      return res.status(400).json({ error: "UTR already submitted" });
    }

    const request = await DepositRequest.create({
      userId: req.user.id,
      amount,
      utr,
      screenshotUrl,
      status: "pending",
    });

    return res.status(201).json({ message: "Deposit request created", request });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get("/withdraw-requests", auth, async (req, res) => {
  try {
    const requests = await WithdrawRequest.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ requests });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post("/withdraw-requests", auth, async (req, res) => {
  try {
    const wallet = await ensureWallet(req.user.id);
    const amount = roundAmount(req.body.amount);
    const upiId = String(req.body.upi_id || req.body.upiId || "").trim();

    if (amount < MIN_WITHDRAW_AMOUNT) {
      return res.status(400).json({ error: `Minimum withdraw amount is Rs ${MIN_WITHDRAW_AMOUNT}` });
    }

    if (amount > MAX_WITHDRAW_AMOUNT) {
      return res.status(400).json({ error: `Maximum withdraw amount is Rs ${MAX_WITHDRAW_AMOUNT}` });
    }

    if (!isValidUpiId(upiId)) {
      return res.status(400).json({ error: "Valid UPI ID is required" });
    }

    if (wallet.winningBalance < amount) {
      return res.status(400).json({ error: `Insufficient winning balance. Need Rs${amount.toFixed(2)}, available Rs${wallet.winningBalance.toFixed(2)}` });
    }

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const todayWithdrawals = await WithdrawRequest.aggregate([
      {
        $match: {
          userId: wallet.userId,
          createdAt: { $gte: startOfDay },
          status: { $in: ["pending", "approved", "paid"] },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: "$amount" },
        },
      },
    ]);

    const usedToday = todayWithdrawals[0]?.total || 0;
    if (usedToday + amount > DAILY_WITHDRAW_LIMIT) {
      return res.status(400).json({ error: `Daily withdraw limit is Rs ${DAILY_WITHDRAW_LIMIT}` });
    }

    const request = await WithdrawRequest.create({
      userId: req.user.id,
      amount,
      upiId,
      status: "pending",
    });

    await User.findByIdAndUpdate(req.user.id, { upiId });

    return res.status(201).json({ message: "Withdraw request created", request });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get("/admin/deposit-requests", auth, requireAdmin, async (req, res) => {
  try {
    const status = req.query.status || "pending";
    const filter = status === "all" ? {} : { status };
    const requests = await DepositRequest.find(filter)
      .populate("userId", "username email")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ requests });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.patch("/admin/deposit-requests/:id", auth, requireAdmin, async (req, res) => {
  try {
    const request = await DepositRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ error: "Deposit request not found" });
    }

    if (request.status !== "pending") {
      return res.status(400).json({ error: "Deposit request already processed" });
    }

    const action = String(req.body.action || "").trim().toLowerCase();
    if (!["approve", "reject"].includes(action)) {
      return res.status(400).json({ error: "Action must be approve or reject" });
    }

    if (action === "approve") {
      const approveAmount = req.body.amount ? roundAmount(req.body.amount) : request.amount;
      if (approveAmount <= 0) {
        return res.status(400).json({ error: "Approved amount must be greater than zero" });
      }

await creditWalletBalance({
        userId: request.userId,
        type: "deposit",
        amount: approveAmount,
        balanceBucket: "deposit_balance",
        referenceId: request._id.toString(),
        metadata: {
          utr: request.utr,
          screenshotUrl: request.screenshotUrl,
          originalAmount: request.amount,
          approvedAmount: approveAmount,
        },
        source: 'deposit'
      });
      request.status = "approved";
      request.approvedAmount = approveAmount;
      request.verifiedAt = new Date();
      request.reviewedBy = req.user.id;
      await request.save();
      return res.json({ message: `Deposit request approved for Rs ${approveAmount.toFixed(2)}` });
    }

    request.status = "rejected";
    request.verifiedAt = new Date();
    request.reviewedBy = req.user.id;
    await request.save();
    return res.json({ message: "Deposit request rejected" });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get("/admin/withdraw-requests", auth, requireAdmin, async (req, res) => {
  try {
    const status = req.query.status || "pending";
    const filter = status === "all" ? {} : { status };
    const requests = await WithdrawRequest.find(filter)
      .populate("userId", "username email upiId")
      .sort({ createdAt: -1 })
      .lean();

    return res.json({ requests });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get("/admin/transactions", auth, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 250);
    const type = String(req.query.type || "game").trim().toLowerCase();

    let typeFilter = {};
    if (type === "game") {
      typeFilter = { type: { $in: ["game_entry", "game_win"] } };
    } else if (type !== "all") {
      typeFilter = { type };
    }

    const transactions = await WalletTransaction.find(typeFilter)
      .populate("userId", "username email")
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return res.json({ transactions });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get("/admin/platform-fees", auth, requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 100, 250);
    const gameKey = String(req.query.gameKey || "all").trim().toLowerCase();

    const filter = gameKey === "all" ? {} : { gameKey };
    const records = await PlatformFeeCollection.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    const aggregate = await PlatformFeeCollection.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          totalCollected: { $sum: "$platformFee" },
          totalMatches: { $sum: 1 },
        },
      },
    ]);

    const byGame = await PlatformFeeCollection.aggregate([
      { $match: filter },
      {
        $group: {
          _id: "$gameKey",
          gameLabel: { $first: "$gameLabel" },
          totalCollected: { $sum: "$platformFee" },
          totalMatches: { $sum: 1 },
        },
      },
      { $sort: { totalCollected: -1 } },
    ]);

    return res.json({
      summary: {
        totalCollected: roundAmount(aggregate[0]?.totalCollected || 0),
        totalMatches: aggregate[0]?.totalMatches || 0,
      },
      byGame,
      records,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.patch("/admin/withdraw-requests/:id", auth, requireAdmin, async (req, res) => {
  try {
    const request = await WithdrawRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ error: "Withdraw request not found" });
    }

    const action = String(req.body.action || "").trim().toLowerCase();
    if (!["approve", "reject", "paid"].includes(action)) {
      return res.status(400).json({ error: "Action must be approve, reject, or paid" });
    }

    if (action === "approve") {
      if (request.status !== "pending") {
        return res.status(400).json({ error: "Only pending requests can be approved" });
      }
      request.status = "approved";
      request.reviewedBy = req.user.id;
      await request.save();
      return res.json({ message: "Withdraw request approved" });
    }

    if (action === "reject") {
      if (!["pending", "approved"].includes(request.status)) {
        return res.status(400).json({ error: "Only pending or approved requests can be rejected" });
      }
      request.status = "rejected";
      request.processedAt = new Date();
      request.reviewedBy = req.user.id;
      await request.save();
      return res.json({ message: "Withdraw request rejected" });
    }

    if (request.status !== "approved") {
      return res.status(400).json({ error: "Withdraw request must be approved before marking paid" });
    }

    const wallet = await ensureWallet(request.userId);
    if (wallet.winningBalance < request.amount) {
      return res.status(400).json({ error: "Insufficient winning balance at payout time" });
    }

    await debitWalletBalance({
      userId: request.userId,
      type: "withdraw",
      amount: request.amount,
      balanceBucket: "winning_balance",
      referenceId: `${request._id}:withdraw-winning`,
      metadata: {
        upiId: request.upiId,
      },
    });

    request.status = "paid";
    request.processedAt = new Date();
    request.reviewedBy = req.user.id;
    await request.save();
    return res.json({ message: "Withdraw request marked paid" });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
