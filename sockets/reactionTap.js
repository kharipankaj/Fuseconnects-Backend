const User = require("../models/User");
const { recordPlatformFeeCollection } = require("../services/platformFeeService");
const { deductGameEntry, payoutGameWinner, refundGameEntry, validateGameEntry } = require("../services/gameWalletService");

const TOTAL_ROUNDS = 5;
const FALSE_START_PENALTY_MS = 650;
const MISSED_TAP_MS = 5001;
const MAX_REACTION_MS = 5000;
const COUNTDOWN_MS = 3000;
const READY_WINDOW_MS = 5000;
const BETWEEN_ROUNDS_MS = 1400;

const queueByEntry = new Map();
const matches = new Map();
const playerToMatch = new Map();
const GAME_KEY = "reaction_tap";
const GAME_LABEL = "Reaction Tap";
const EARLY_EXIT_ROUND = 3; // Refund if currentRound < EARLY_EXIT_ROUND (5 rounds total)

function getReward(entry) {
  return Number((Number(entry || 0) * 2 * 0.7).toFixed(2));
}

function getLoserReward(entry) {
  return Number((Number(entry || 0) * 2 * 0.05).toFixed(2));
}

function getPlatformFee(entry) {
  return Number((Number(entry || 0) * 2 * 0.25).toFixed(2));
}

function getQueue(entry) {
  const normalizedEntry = Number(entry) || 20;
  if (!queueByEntry.has(normalizedEntry)) {
    queueByEntry.set(normalizedEntry, []);
  }

  return queueByEntry.get(normalizedEntry);
}

function generateMatchId() {
  return `rt-match-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateRoomId(matchId) {
  return `reaction_tap:${matchId}`;
}

function getAverage(values) {
  if (!values.length) {
    return 0;
  }

  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function getRoundWinner(playerMs, opponentMs) {
  if (playerMs === opponentMs) {
    return "tie";
  }

  return playerMs < opponentMs ? "player" : "opponent";
}

function getMatchOutcome(match) {
  const playerOneAverage = getAverage(match.playerOne.rounds);
  const playerTwoAverage = getAverage(match.playerTwo.rounds);

  if (playerOneAverage < playerTwoAverage) {
    return {
      winner: "playerOne",
      playerOneAverage,
      playerTwoAverage,
      isDraw: false,
    };
  }

  if (playerTwoAverage < playerOneAverage) {
    return {
      winner: "playerTwo",
      playerOneAverage,
      playerTwoAverage,
      isDraw: false,
    };
  }

  if (match.playerOne.wins > match.playerTwo.wins) {
    return {
      winner: "playerOne",
      playerOneAverage,
      playerTwoAverage,
      isDraw: false,
    };
  }

  if (match.playerTwo.wins > match.playerOne.wins) {
    return {
      winner: "playerTwo",
      playerOneAverage,
      playerTwoAverage,
      isDraw: false,
    };
  }

  return {
    winner: null,
    playerOneAverage,
    playerTwoAverage,
    isDraw: true,
  };
}

function clearTimer(timerId) {
  if (timerId) {
    clearTimeout(timerId);
  }
}

function removeQueueEntry(playerId) {
  for (const [entry, queue] of queueByEntry.entries()) {
    const index = queue.findIndex((item) => item.player.id === playerId);
    if (index >= 0) {
      const [removed] = queue.splice(index, 1);
      clearTimer(removed.timeoutId);
      if (!queue.length) {
        queueByEntry.delete(entry);
      }
      return removed;
    }
  }

  return null;
}

async function resolveReactionTapDisplayName(socket, fallbackName) {
  const username =
    socket.user?.username ||
    socket.user?.user?.username ||
    socket.user?.name ||
    null;
  const userId =
    socket.user?.id ||
    socket.user?.userId ||
    socket.user?._id ||
    socket.user?.sub ||
    socket.user?.uid ||
    socket.user?.user?.id ||
    socket.user?.user?._id ||
    null;

  try {
    let user = null;

    if (userId) {
      user = await User.findById(userId).select("anonId username").lean();
    } else if (username) {
      user = await User.findOne({ username }).select("anonId username").lean();
    }

    if (user?.anonId) {
      return user.anonId;
    }
  } catch (error) {
    console.warn("reaction_tap display name lookup failed:", error);
  }

  if (typeof fallbackName === "string" && fallbackName.trim()) {
    return fallbackName.trim().slice(0, 30);
  }

  return `Player_${String(socket.id).slice(-4)}`;
}

function resolveReactionTapPlayerId(socket, fallbackPlayerId) {
  const userId =
    socket.user?.id ||
    socket.user?.userId ||
    socket.user?._id ||
    socket.user?.sub ||
    socket.user?.uid ||
    null;

  if (userId) {
    return `u:${userId}`;
  }

  if (typeof fallbackPlayerId === "string" && fallbackPlayerId.trim()) {
    return fallbackPlayerId.trim();
  }

  return socket.id;
}

function getMatchSnapshot(match, forPlayerId) {
  const isPlayerOne = match.playerOne.id === forPlayerId;
  const self = isPlayerOne ? match.playerOne : match.playerTwo;
  const opponent = isPlayerOne ? match.playerTwo : match.playerOne;

  return {
    id: match.id,
    roomId: match.roomId,
    entry: match.entry,
    reward: match.reward,
    loserReward: match.loserReward,
    platformFee: match.platformFee,
    rounds: match.rounds,
    mode: match.mode,
    you: {
      id: self.id,
      name: self.name,
    },
    opponent: {
      id: opponent.id,
      name: opponent.name,
      latency: opponent.latency || 0,
    },
  };
}

function buildStatePayload(match, forPlayerId) {
  const isPlayerOne = match.playerOne.id === forPlayerId;
  const self = isPlayerOne ? match.playerOne : match.playerTwo;
  const opponent = isPlayerOne ? match.playerTwo : match.playerOne;
  const latestRound = match.latestRound
    ? isPlayerOne
      ? match.latestRound
      : {
          playerMs: match.latestRound.opponentMs,
          opponentMs: match.latestRound.playerMs,
          winner:
            match.latestRound.winner === "player"
              ? "opponent"
              : match.latestRound.winner === "opponent"
              ? "player"
              : "tie",
        }
    : null;

  return {
    match: getMatchSnapshot(match, forPlayerId),
    state: {
      phase: match.phase,
      round: match.currentRound,
      totalRounds: match.rounds,
      roundEndsAt: match.roundEndsAt,
      readyAt: match.readyAt,
      scores: {
        you: self.wins,
        opponent: opponent.wins,
      },
      averages: {
        you: getAverage(self.rounds),
        opponent: getAverage(opponent.rounds),
      },
      latestRound,
    },
  };
}

function emitToPlayer(io, player, event, payload) {
  if (!player.socketId) {
    return;
  }

  io.to(player.socketId).emit(event, payload);
}

function emitMatchState(io, match) {
  emitToPlayer(io, match.playerOne, "reaction_tap_match_state", buildStatePayload(match, match.playerOne.id));
  emitToPlayer(io, match.playerTwo, "reaction_tap_match_state", buildStatePayload(match, match.playerTwo.id));
}

async function finalizeMatch(io, match) {
  clearTimer(match.phaseTimer);
  clearTimer(match.disconnectTimerOne);
  clearTimer(match.disconnectTimerTwo);

  try {
    // 💰 GAME PAYOUTS
    const outcome = getMatchOutcome(match);
    const p1Won = outcome.winner === 'playerOne';
    const p2Won = outcome.winner === 'playerTwo';
    
    // Winner payout
    if (p1Won) {
      await payoutGameWinner(match.playerOne.id, GAME_KEY, match.reward, match.id, false, {
        wins: match.playerOne.wins,
        avgMs: outcome.playerOneAverage,
        opponentAvgMs: outcome.playerTwoAverage
      });
    } else if (p2Won) {
      await payoutGameWinner(match.playerTwo.id, GAME_KEY, match.reward, match.id, false, {
        wins: match.playerTwo.wins,
        avgMs: outcome.playerTwoAverage,
        opponentAvgMs: outcome.playerOneAverage
      });
    }
    
    // Loser consolation
    if (p1Won) {
      await payoutGameWinner(match.playerTwo.id, GAME_KEY, match.loserReward, match.id, true, {
        wins: match.playerTwo.wins,
        avgMs: outcome.playerTwoAverage
      });
    } else if (p2Won) {
      await payoutGameWinner(match.playerOne.id, GAME_KEY, match.loserReward, match.id, true, {
        wins: match.playerOne.wins,
        avgMs: outcome.playerOneAverage
      });
    }

    recordPlatformFeeCollection({
      matchId: match.id,
      gameKey: GAME_KEY,
      gameLabel: GAME_LABEL,
      entryAmount: match.entry,
      winnerReward: match.reward,
      loserReward: match.loserReward,
      platformFee: match.platformFee,
      playerOne: match.playerOne,
      playerTwo: match.playerTwo,
      metadata: {
        rounds: match.rounds,
        playerOneWins: match.playerOne.wins,
        playerTwoWins: match.playerTwo.wins,
      },
    }).catch((error) => {
      console.error("reaction_tap platform fee save failed:", error);
    });
  } catch (payoutError) {
    console.error(`ReactionTap payout error [${match.id}]:`, payoutError);
  }

  const outcome = getMatchOutcome(match);
  const playerOneAverage = outcome.playerOneAverage;
  const playerTwoAverage = outcome.playerTwoAverage;
  const playerOneWon = outcome.winner === "playerOne";
  const playerTwoWon = outcome.winner === "playerTwo";

  const playerOnePayload = {
    match: getMatchSnapshot(match, match.playerOne.id),
    player: {
      name: match.playerOne.name,
      averageMs: playerOneAverage,
      wins: match.playerOne.wins,
      rounds: match.playerOne.rounds,
    },
    opponent: {
      name: match.playerTwo.name,
      averageMs: playerTwoAverage,
      wins: match.playerTwo.wins,
      rounds: match.playerTwo.rounds,
    },
    rewardEarned: outcome.isDraw ? 0 : playerOneWon ? match.reward : match.loserReward,
    didPlayerWin: playerOneWon,
    isDraw: outcome.isDraw,
    completedAt: Date.now(),
  };

  emitToPlayer(io, match.playerOne, "reaction_tap_match_complete", playerOnePayload);

  const playerTwoPayload = {
    match: getMatchSnapshot(match, match.playerTwo.id),
    player: {
      name: match.playerTwo.name,
      averageMs: playerTwoAverage,
      wins: match.playerTwo.wins,
      rounds: match.playerTwo.rounds,
    },
    opponent: {
      name: match.playerOne.name,
      averageMs: playerOneAverage,
      wins: match.playerOne.wins,
      rounds: match.playerOne.rounds,
    },
    rewardEarned: outcome.isDraw ? 0 : playerTwoWon ? match.reward : match.loserReward,
    didPlayerWin: playerTwoWon,
    isDraw: outcome.isDraw,
    completedAt: Date.now(),
  };

  emitToPlayer(io, match.playerTwo, "reaction_tap_match_complete", playerTwoPayload);

  playerToMatch.delete(match.playerOne.id);
  playerToMatch.delete(match.playerTwo.id);
  matches.delete(match.id);
}

function startReadyPhase(io, match) {
  match.phase = "ready";
  match.readyAt = Date.now();
  match.roundEndsAt = match.readyAt + READY_WINDOW_MS;
  match.submissions = {};

  emitMatchState(io, match);

  match.phaseTimer = setTimeout(() => finalizeRound(io, match), READY_WINDOW_MS);
}

function startWaitingPhase(io, match) {
  match.phase = "waiting";
  match.readyAt = null;
  match.roundEndsAt = Date.now() + (1400 + Math.floor(Math.random() * 2200));
  emitMatchState(io, match);

  match.phaseTimer = setTimeout(() => startReadyPhase(io, match), match.roundEndsAt - Date.now());
}

function startCountdownPhase(io, match) {
  clearTimer(match.phaseTimer);
  match.phase = "countdown";
  match.readyAt = null;
  match.roundEndsAt = Date.now() + COUNTDOWN_MS;
  emitMatchState(io, match);

  match.phaseTimer = setTimeout(() => startWaitingPhase(io, match), COUNTDOWN_MS);
}

function finalizeRound(io, match) {
  clearTimer(match.phaseTimer);

  const playerOneMs = match.submissions[match.playerOne.id] ?? MISSED_TAP_MS;
  const playerTwoMs = match.submissions[match.playerTwo.id] ?? MISSED_TAP_MS;
  const winner = getRoundWinner(playerOneMs, playerTwoMs);

  match.playerOne.rounds.push(playerOneMs);
  match.playerTwo.rounds.push(playerTwoMs);

  if (winner === "player") {
    match.playerOne.wins += 1;
  } else if (winner === "opponent") {
    match.playerTwo.wins += 1;
  }

  match.latestRound = {
    playerMs: playerOneMs,
    opponentMs: playerTwoMs,
    winner,
  };
  match.phase = "round-result";
  match.roundEndsAt = Date.now() + BETWEEN_ROUNDS_MS;

  emitMatchState(io, match);

  if (match.currentRound >= match.rounds) {
    match.phaseTimer = setTimeout(() => finalizeMatch(io, match), BETWEEN_ROUNDS_MS);
    return;
  }

  match.phaseTimer = setTimeout(() => {
    match.currentRound += 1;
    match.latestRound = null;
    startCountdownPhase(io, match);
  }, BETWEEN_ROUNDS_MS);
}

function createMatch(io, firstPlayer, secondPlayer) {
  const matchId = generateMatchId();
  const match = {
    id: matchId,
    roomId: generateRoomId(matchId),
    entry: firstPlayer.entry,
    reward: getReward(firstPlayer.entry),
    loserReward: getLoserReward(firstPlayer.entry),
    platformFee: getPlatformFee(firstPlayer.entry),
    rounds: TOTAL_ROUNDS,
    currentRound: 1,
    phase: "countdown",
    roundEndsAt: null,
    readyAt: null,
    latestRound: null,
    submissions: {},
    playerOne: {
      ...firstPlayer,
      rounds: [],
      wins: 0,
      disconnectedAt: null,
    },
    playerTwo: {
      ...secondPlayer,
      rounds: [],
      wins: 0,
      disconnectedAt: null,
    },
    mode: "pvp",
    phaseTimer: null,
    disconnectTimerOne: null,
    disconnectTimerTwo: null,
  };

  matches.set(match.id, match);
  playerToMatch.set(match.playerOne.id, match.id);
  playerToMatch.set(match.playerTwo.id, match.id);

  if (match.playerOne.socketId) {
    io.sockets.sockets.get(match.playerOne.socketId)?.join(match.roomId);
  }
  if (match.playerTwo.socketId) {
    io.sockets.sockets.get(match.playerTwo.socketId)?.join(match.roomId);
  }

  emitToPlayer(io, match.playerOne, "reaction_tap_match_found", {
    match: getMatchSnapshot(match, match.playerOne.id),
  });

  emitToPlayer(io, match.playerTwo, "reaction_tap_match_found", {
    match: getMatchSnapshot(match, match.playerTwo.id),
  });

  startCountdownPhase(io, match);
}

async function cancelMatchForDisconnect(io, match, playerKey) {
  const timerField = playerKey === "playerOne" ? "disconnectTimerOne" : "disconnectTimerTwo";
  clearTimer(match[timerField]);
  match[timerField] = setTimeout(async () => {
    const player = match[playerKey];
    if (!player || !player.disconnectedAt) {
      return;
    }

    const opponent = playerKey === "playerOne" ? match.playerTwo : match.playerOne;
    emitToPlayer(io, opponent, "reaction_tap_error", {
      message: "Opponent disconnected from the match.",
    });

    // 💰 REFUND if early exit
    try {
      if (match.currentRound < EARLY_EXIT_ROUND) {
        const disconnectUserId = player.id.startsWith('u:') ? player.id.slice(2) : null;
        if (disconnectUserId) {
          await refundGameEntry(disconnectUserId, match.entry, `${GAME_KEY}:${match.id}:refund`, {
            reason: 'player_disconnect',
            round: match.currentRound,
            playerKey
          });
        }
      }
    } catch (refundError) {
      console.error(`ReactionTap disconnect refund failed [${match.id}]:`, refundError);
    }

    clearTimer(match.phaseTimer);
    clearTimer(match.disconnectTimerOne);
    clearTimer(match.disconnectTimerTwo);
    playerToMatch.delete(match.playerOne.id);
    playerToMatch.delete(match.playerTwo.id);
    matches.delete(match.id);
  }, 10000);
}

module.exports = function attachReactionTapHandlers(io, socket) {
  socket.on("reaction_tap_queue_join", async ({ entry, playerId, playerName } = {}) => {
    if (!socket.user?.id) {
      socket.emit("reaction_tap_error", { message: "Login required for live matchmaking." });
      return;
    }

    const normalizedEntry = Number(entry) || 20;
    
    // 💰 WALLET VALIDATION + DEDUCTION
    try {
      await validateGameEntry(socket.user.id, normalizedEntry);
      await deductGameEntry(socket.user.id, GAME_KEY, normalizedEntry, socket.id, { action: 'queue_join' });
    } catch (walletError) {
      socket.emit("reaction_tap_error", { message: walletError.message });
      return;
    }

    const normalizedPlayerId = resolveReactionTapPlayerId(socket, playerId);
    const normalizedPlayerName = await resolveReactionTapDisplayName(socket, playerName);

    removeQueueEntry(normalizedPlayerId);

    if (playerToMatch.has(normalizedPlayerId)) {
      const existingMatch = matches.get(playerToMatch.get(normalizedPlayerId));
      if (existingMatch) {
        socket.emit("reaction_tap_match_found", {
          match: getMatchSnapshot(existingMatch, normalizedPlayerId),
        });
        socket.emit(
          "reaction_tap_match_state",
          buildStatePayload(existingMatch, normalizedPlayerId)
        );
        return;
      }
    }

    const queue = getQueue(normalizedEntry);
    const opponentIndex = queue.findIndex((item) => item.player.id !== normalizedPlayerId);

    if (opponentIndex >= 0) {
      const [opponent] = queue.splice(opponentIndex, 1);
      clearTimer(opponent.timeoutId);
      if (!queue.length) {
        queueByEntry.delete(normalizedEntry);
      }

      createMatch(io, opponent.player, {
        id: normalizedPlayerId,
        name: normalizedPlayerName,
        socketId: socket.id,
        entry: normalizedEntry,
        latency: 18 + Math.floor(Math.random() * 30),
      });
      return;
    }

    const queueEntry = {
      player: {
        id: normalizedPlayerId,
        name: normalizedPlayerName,
        socketId: socket.id,
        entry: normalizedEntry,
        latency: 18 + Math.floor(Math.random() * 30),
      },
      joinedAt: Date.now(),
    };

    queue.push(queueEntry);

    socket.emit("reaction_tap_queue_status", {
      entry: normalizedEntry,
      queuedAt: queueEntry.joinedAt,
      queueSize: queue.length,
    });
  });

  socket.on("reaction_tap_queue_leave", ({ playerId } = {}) => {
    const normalizedPlayerId = resolveReactionTapPlayerId(socket, playerId);
    if (normalizedPlayerId) {
      removeQueueEntry(normalizedPlayerId);
    }
  });

  socket.on("reaction_tap_join_match", ({ matchId, playerId } = {}) => {
    if (!socket.user?.id) {
      socket.emit("reaction_tap_error", { message: "Login required for live matchmaking." });
      return;
    }

    const normalizedPlayerId = resolveReactionTapPlayerId(socket, playerId);
    const match = matchId ? matches.get(matchId) : normalizedPlayerId ? matches.get(playerToMatch.get(normalizedPlayerId)) : null;

    if (!match || !normalizedPlayerId) {
      socket.emit("reaction_tap_error", { message: "Match not found." });
      return;
    }

    const playerKey =
      match.playerOne.id === normalizedPlayerId
        ? "playerOne"
        : match.playerTwo.id === normalizedPlayerId
        ? "playerTwo"
        : null;

    if (!playerKey) {
      socket.emit("reaction_tap_error", { message: "Player not part of this match." });
      return;
    }

    const player = match[playerKey];
    player.socketId = socket.id;
    player.disconnectedAt = null;

    const timerField = playerKey === "playerOne" ? "disconnectTimerOne" : "disconnectTimerTwo";
    clearTimer(match[timerField]);

    socket.join(match.roomId);
    socket.emit("reaction_tap_match_found", {
      match: getMatchSnapshot(match, normalizedPlayerId),
    });
    socket.emit("reaction_tap_match_state", buildStatePayload(match, normalizedPlayerId));
  });

  socket.on("reaction_tap_submit", ({ matchId, playerId, reactionMs } = {}) => {
    if (!socket.user?.id) {
      return;
    }

    const normalizedPlayerId = resolveReactionTapPlayerId(socket, playerId);
    const match = matchId ? matches.get(matchId) : null;

    if (!match || !normalizedPlayerId) {
      return;
    }

    const isPlayerOne = match.playerOne.id === normalizedPlayerId;
    const isPlayerTwo = match.playerTwo.id === normalizedPlayerId;
    if (!isPlayerOne && !isPlayerTwo) {
      return;
    }

    if (match.submissions[normalizedPlayerId] !== undefined) {
      return;
    }

    let finalReactionMs = Math.round(Number(reactionMs) || 0);
    if (match.phase === "countdown" || match.phase === "waiting") {
      finalReactionMs = FALSE_START_PENALTY_MS;
    } else if (match.phase !== "ready") {
      return;
    } else {
      finalReactionMs = Math.min(Math.max(finalReactionMs, 110), MAX_REACTION_MS);
    }

    match.submissions[normalizedPlayerId] = finalReactionMs;

    if (Object.keys(match.submissions).length >= 2) {
      finalizeRound(io, match);
    }
  });

  socket.on("disconnect", () => {
    const queueEntry = Array.from(queueByEntry.values())
      .flat()
      .find((item) => item.player.socketId === socket.id);

    if (queueEntry) {
      removeQueueEntry(queueEntry.player.id);
    }

    for (const match of matches.values()) {
      if (match.playerOne.socketId === socket.id) {
        match.playerOne.disconnectedAt = Date.now();
        cancelMatchForDisconnect(io, match, "playerOne");
      }

      if (match.playerTwo.socketId === socket.id) {
        match.playerTwo.disconnectedAt = Date.now();
        cancelMatchForDisconnect(io, match, "playerTwo");
      }
    }
  });
};
