const { v4: uuidv4 } = require("uuid");
const crypto = require("node:crypto");

class GameEngine {
  constructor(io, playerModel, roundModel, betModel) {
    this.io = io;
    this.Player = playerModel;
    this.Round = roundModel;
    this.Bet = betModel;

    this.state = "waiting";
    this.currentRound = null;
    this.currentMultiplier = 1.0;
    this.startTime = null;
    this.tickInterval = null;
    this.crashPoint = null;

    this.activeBets = new Map(); // ✅ playerId based
    this.recentCrashes = [];

    this.WAITING_DURATION = 7000;
    this.TICK_RATE = 100;
  }

  start() {
    this.scheduleNextRound();
  }

  scheduleNextRound() {
    this.state = "waiting";
    this.currentMultiplier = 1.0;
    this.activeBets.clear();
    this.currentRound = null;
    this.crashPoint = null;

    this.io.emit("game:waiting", {
      countdownSeconds: this.WAITING_DURATION / 1000,
    });

    setTimeout(() => this.startRound(), this.WAITING_DURATION);
  }

  // 🔐 UNPREDICTABLE + FAIR CRASH GENERATOR
  generateCrashPoint(serverSeed, roundId) {
    const hash = crypto
      .createHmac("sha256", serverSeed)
      .update(roundId)
      .digest("hex");

    // Convert hash → large number
    const h = parseInt(hash.substring(0, 13), 16);
    const e = Math.pow(2, 52);

    // 🎯 Provably fair formula (used in real crash games)
    let crash = (100 * e - h) / (e - h);
    crash = crash / 100;

    // 🔒 Clamp limits (your requirement)
    if (crash < 1.1) crash = 1.1;
    if (crash > 10) crash = 10;

    return Math.floor(crash * 100) / 100;
  }

  async startRound() {
    const roundId = uuidv4();
    const serverSeed = crypto.randomUUID();

    this.crashPoint = this.generateCrashPoint(serverSeed, roundId);

    const hash = crypto
      .createHmac("sha256", serverSeed)
      .update(roundId)
      .digest("hex");

    this.startTime = Date.now();
    this.state = "flying";

    try {
      this.currentRound = await this.Round.create({
        roundId,
        serverSeed,
        hmacProof: hash,
        crashPoint: this.crashPoint,
        startTime: new Date(this.startTime),
        status: "flying",
      });
    } catch {
      this.currentRound = { roundId, crashPoint: this.crashPoint };
    }

    // ❗ Only send hash (not serverSeed)
    this.io.emit("game:start", {
      roundId,
      startTime: this.startTime,
      hash,
    });

    this.tickInterval = setInterval(() => this.tick(), this.TICK_RATE);
  }

  tick() {
    const elapsed = (Date.now() - this.startTime) / 1000;

    // 📈 exponential curve
    this.currentMultiplier =
      Math.floor(Math.exp(0.06 * elapsed) * 100) / 100;

    this.io.emit("game:tick", {
      multiplier: this.currentMultiplier,
      elapsed,
    });

    this.checkAutoCashouts();

    if (this.currentMultiplier >= this.crashPoint) {
      this.crash();
    }
  }

  async crash() {
    clearInterval(this.tickInterval);
    this.state = "crashed";

    const cp = this.crashPoint;

    this.recentCrashes.unshift(cp);
    if (this.recentCrashes.length > 12) this.recentCrashes.pop();

    // 💾 Save bets
    for (const [, bet] of this.activeBets.entries()) {
      try {
        const multiplier = bet.cashedOutAt || null;

        const profit = multiplier
          ? Math.floor(
              (bet.betAmount * multiplier - bet.betAmount) * 100
            ) / 100
          : -bet.betAmount;

        await this.Bet.create({
          playerId: bet.playerId,
          username: bet.username,
          roundId: this.currentRound?.roundId,
          betAmount: bet.betAmount,
          cashedOutAt: multiplier,
          profit,
          won: !!multiplier,
        });
      } catch {}
    }

    try {
      await this.Round.updateOne(
        { roundId: this.currentRound?.roundId },
        { $set: { status: "crashed", endTime: new Date() } }
      );
    } catch {}

    // 🔓 Reveal serverSeed AFTER crash
    this.io.emit("game:crash", {
      crashPoint: cp,
      roundId: this.currentRound?.roundId,
      recentCrashes: this.recentCrashes,
      serverSeed: this.currentRound?.serverSeed,
    });

    setTimeout(() => this.scheduleNextRound(), 2000);
  }

  async placeBet(socket, { playerId, username, betAmount, autoCashout }) {
    if (this.state !== "waiting") {
      return { success: false, message: "Betting closed" };
    }

    if (this.activeBets.has(playerId)) {
      return { success: false, message: "Already bet" };
    }

    if (!betAmount || betAmount <= 0) {
      return { success: false, message: "Invalid amount" };
    }

    try {
      let player = await this.Player.findOneAndUpdate(
        { _id: playerId, walletBalance: { $gte: betAmount } },
        { $inc: { walletBalance: -betAmount } },
        { new: true }
      );

      if (!player) {
        player = await this.Player.findOneAndUpdate(
          { _id: playerId, balance: { $gte: betAmount } },
          { $inc: { balance: -betAmount } },
          { new: true }
        );
      }

      if (!player) {
        return { success: false, message: "Insufficient balance" };
      }

      // Increment games played stat
      try {
        await this.Player.findByIdAndUpdate(playerId, { $inc: { gamesPlayed: 1 } });
        console.log(`✅ STATS: gamesPlayed +1 for ${playerId.slice(-4)}`);
      } catch (err) {
        console.error(`❌ gamesPlayed update failed for ${playerId}:`, err.message);
      }

      this.activeBets.set(playerId, {
        playerId,
        username,
        betAmount,
        cashedOut: false,
        autoCashout: autoCashout || null,
      });

      this.io.emit("bet:placed", { username, betAmount });

      const newBalance =
        player.walletBalance ?? player.balance ?? 0;

      return { success: true, balance: newBalance };
    } catch {
      return { success: false, message: "Server error" };
    }
  }

  async cashOut(socket, { playerId }) {
    if (this.state !== "flying") {
      return { success: false, message: "Game not running" };
    }

    const bet = this.activeBets.get(playerId);

    if (!bet) return { success: false, message: "No bet" };
    if (bet.cashedOut)
      return { success: false, message: "Already cashed" };

    const multiplier = this.currentMultiplier;

    const winAmount =
      Math.floor(bet.betAmount * multiplier * 100) / 100;

    const profit =
      Math.floor((winAmount - bet.betAmount) * 100) / 100;

    bet.cashedOut = true;
    bet.cashedOutAt = multiplier;

    try {
      let player = await this.Player.findByIdAndUpdate(
        playerId,
        { $inc: { walletBalance: winAmount } },
        { new: true }
      );

      if (player?.walletBalance === undefined) {
        player = await this.Player.findByIdAndUpdate(
          playerId,
          { $inc: { balance: winAmount } },
          { new: true }
        );
      }

      await this.Bet.create({
        playerId,
        username: bet.username,
        roundId: this.currentRound?.roundId,
        betAmount: bet.betAmount,
        cashedOutAt: multiplier,
        profit,
        won: true,
      });

      // Increment total wins stat
      try {
        await this.Player.findByIdAndUpdate(playerId, { $inc: { totalWins: 1 } });
        console.log(`✅ STATS: totalWins +1 for ${playerId.slice(-4)}`);
      } catch (err) {
        console.error(`❌ totalWins update failed for ${playerId}:`, err.message);
      }

      this.io.emit("game:cashout", {
        username: bet.username,
        multiplier,
        profit,
      });

      const newBalance =
        player?.walletBalance ?? player?.balance ?? 0;

      return {
        success: true,
        multiplier,
        winAmount,
        profit,
        balance: newBalance,
      };
    } catch {
      return { success: false, message: "Cashout error" };
    }
  }

  checkAutoCashouts() {
    for (const [playerId, bet] of this.activeBets.entries()) {
      if (
        !bet.cashedOut &&
        bet.autoCashout &&
        this.currentMultiplier >= bet.autoCashout
      ) {
        this.cashOut(null, { playerId });
      }
    }
  }

  getState() {
    return {
      state: this.state,
      multiplier: this.currentMultiplier,
      roundId: this.currentRound?.roundId,
      recentCrashes: this.recentCrashes,
    };
  }
}

module.exports = GameEngine;