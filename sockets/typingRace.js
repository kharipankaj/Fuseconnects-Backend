const User = require("../models/User");
const { recordPlatformFeeCollection } = require("../services/platformFeeService");
const { deductGameEntry, payoutGameWinner, refundGameEntry, validateGameEntry } = require("../services/gameWalletService");

const ENTRY_OPTIONS = [10, 20, 50, 100];
const COUNTDOWN_MS = 3000;
const RACE_DURATION_MS = 30000;
const DISCONNECT_GRACE_MS = 10000;

const PASSAGES = [
  "The quick brown fox jumps over the lazy dog near the river bank.",
  "Typing with steady focus beats panic and wins the race every time.",
  "Fast fingers mean nothing without rhythm accuracy and control.",
  "Practice every day and clean typing speed will follow naturally.",
  "Small consistent improvements create strong reliable typing habits.",
];

const queueByEntry = new Map();
const matches = new Map();
const playerToMatch = new Map();
const GAME_KEY = "typing_race";
const GAME_LABEL = "Typing Race";
const EARLY_EXIT_SECONDS = 15; // Refund if >15s remaining in 30s race

function normalizeEntry(entry) {
  const normalized = Number(entry) || 10;
  return ENTRY_OPTIONS.includes(normalized) ? normalized : 10;
}

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
  const normalizedEntry = normalizeEntry(entry);
  if (!queueByEntry.has(normalizedEntry)) {
    queueByEntry.set(normalizedEntry, []);
  }

  return queueByEntry.get(normalizedEntry);
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
      if (!queue.length) {
        queueByEntry.delete(entry);
      }
      return removed;
    }
  }

  return null;
}

function randomPassage() {
  return PASSAGES[Math.floor(Math.random() * PASSAGES.length)];
}

function generateMatchId() {
  return `tr-match-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateRoomId(matchId) {
  return `typing_race:${matchId}`;
}

async function resolveDisplayName(socket, fallbackName) {
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
    console.warn("typing_race display name lookup failed:", error);
  }

  if (typeof fallbackName === "string" && fallbackName.trim()) {
    return fallbackName.trim().slice(0, 30);
  }

  return `Player_${String(socket.id).slice(-4)}`;
}

function resolvePlayerId(socket, fallbackPlayerId) {
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

function createPlayerState(player) {
  return {
    ...player,
    progress: 0,
    currentIndex: 0,
    errors: 0,
    finishedAt: null,
    submittedAt: null,
    wpm: 0,
    accuracy: 100,
    disconnectedAt: null,
  };
}

function calculateMetrics(currentIndex, errors, elapsedMs) {
  const safeElapsedMs = Math.max(elapsedMs, 1);
  const minutes = safeElapsedMs / 60000;
  const wpm = Math.max(0, Math.round(currentIndex / 5 / minutes));
  const totalKeystrokes = currentIndex + errors;
  const accuracy = totalKeystrokes > 0 ? Math.round((currentIndex / totalKeystrokes) * 100) : 100;

  return { wpm, accuracy };
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
    passage: match.passage,
    you: {
      id: self.id,
      name: self.name,
    },
    opponent: {
      id: opponent.id,
      name: opponent.name,
    },
  };
}

function buildStatePayload(match, forPlayerId) {
  const isPlayerOne = match.playerOne.id === forPlayerId;
  const self = isPlayerOne ? match.playerOne : match.playerTwo;
  const opponent = isPlayerOne ? match.playerTwo : match.playerOne;

  return {
    match: getMatchSnapshot(match, forPlayerId),
    state: {
      phase: match.phase,
      countdownEndsAt: match.countdownEndsAt,
      raceEndsAt: match.raceEndsAt,
      progress: {
        you: self.progress,
        opponent: opponent.progress,
      },
      stats: {
        you: {
          wpm: self.wpm,
          accuracy: self.accuracy,
          errors: self.errors,
          currentIndex: self.currentIndex,
        },
        opponent: {
          wpm: opponent.wpm,
          accuracy: opponent.accuracy,
          errors: opponent.errors,
          currentIndex: opponent.currentIndex,
        },
      },
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
  emitToPlayer(io, match.playerOne, "typing_race_match_state", buildStatePayload(match, match.playerOne.id));
  emitToPlayer(io, match.playerTwo, "typing_race_match_state", buildStatePayload(match, match.playerTwo.id));
}

function buildResultPayload(match, playerKey) {
  const self = match[playerKey];
  const opponent = playerKey === "playerOne" ? match.playerTwo : match.playerOne;
  const isDraw =
    self.progress === opponent.progress &&
    self.wpm === opponent.wpm &&
    self.accuracy === opponent.accuracy;
  const didPlayerWin =
    !isDraw &&
    (self.progress > opponent.progress ||
      (self.progress === opponent.progress && self.wpm > opponent.wpm) ||
      (self.progress === opponent.progress && self.wpm === opponent.wpm && self.accuracy > opponent.accuracy));

  return {
    match: getMatchSnapshot(match, self.id),
    player: {
      name: self.name,
      progress: self.progress,
      wpm: self.wpm,
      accuracy: self.accuracy,
      errors: self.errors,
      finishedAt: self.finishedAt,
    },
    opponent: {
      name: opponent.name,
      progress: opponent.progress,
      wpm: opponent.wpm,
      accuracy: opponent.accuracy,
      errors: opponent.errors,
      finishedAt: opponent.finishedAt,
    },
    didPlayerWin,
    isDraw,
    rewardEarned: isDraw ? 0 : didPlayerWin ? match.reward : match.loserReward,
    completedAt: Date.now(),
  };
}

async function finalizeMatch(io, match) {
  clearTimer(match.phaseTimer);
  clearTimer(match.disconnectTimerOne);
  clearTimer(match.disconnectTimerTwo);

  try {
    // 💰 GAME PAYOUTS
    const p1Result = buildResultPayload(match, "playerOne");
    const p2Result = buildResultPayload(match, "playerTwo");
    
    if (p1Result.didPlayerWin) {
      await payoutGameWinner(match.playerOne.id, GAME_KEY, match.reward, match.id, false, {
        progress: p1Result.player.progress,
        wpm: p1Result.player.wpm,
        accuracy: p1Result.player.accuracy
      });
      await payoutGameWinner(match.playerTwo.id, GAME_KEY, match.loserReward, match.id, true, {
        progress: p2Result.player.progress,
        wpm: p2Result.player.wpm,
        accuracy: p2Result.player.accuracy
      });
    } else if (p2Result.didPlayerWin) {
      await payoutGameWinner(match.playerTwo.id, GAME_KEY, match.reward, match.id, false, {
        progress: p2Result.player.progress,
        wpm: p2Result.player.wpm,
        accuracy: p2Result.player.accuracy
      });
      await payoutGameWinner(match.playerOne.id, GAME_KEY, match.loserReward, match.id, true, {
        progress: p1Result.player.progress,
        wpm: p1Result.player.wpm,
        accuracy: p1Result.player.accuracy
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
        passage: match.passage,
        playerOneProgress: match.playerOne.progress,
        playerTwoProgress: match.playerTwo.progress,
      },
    }).catch((error) => {
      console.error("typing_race platform fee save failed:", error);
    });
  } catch (payoutError) {
    console.error(`TypingRace payout error [${match.id}]:`, payoutError);
  }

  emitToPlayer(io, match.playerOne, "typing_race_match_complete", buildResultPayload(match, "playerOne"));
  emitToPlayer(io, match.playerTwo, "typing_race_match_complete", buildResultPayload(match, "playerTwo"));

  playerToMatch.delete(match.playerOne.id);
  playerToMatch.delete(match.playerTwo.id);
  matches.delete(match.id);
}

function maybeFinalizeMatch(io, match) {
  const bothFinished = !!match.playerOne.finishedAt && !!match.playerTwo.finishedAt;
  const timeUp = match.raceEndsAt && Date.now() >= match.raceEndsAt;

  if (bothFinished || timeUp) {
    finalizeMatch(io, match);
  }
}

function startRace(io, match) {
  match.phase = "race";
  match.countdownEndsAt = null;
  match.raceStartedAt = Date.now();
  match.raceEndsAt = match.raceStartedAt + RACE_DURATION_MS;

  emitMatchState(io, match);

  match.phaseTimer = setTimeout(() => {
    maybeFinalizeMatch(io, match);
  }, RACE_DURATION_MS);
}

function startCountdown(io, match) {
  clearTimer(match.phaseTimer);
  match.phase = "countdown";
  match.countdownEndsAt = Date.now() + COUNTDOWN_MS;
  match.raceEndsAt = null;
  emitMatchState(io, match);

  match.phaseTimer = setTimeout(() => startRace(io, match), COUNTDOWN_MS);
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
    passage: randomPassage(),
    phase: "countdown",
    countdownEndsAt: null,
    raceEndsAt: null,
    raceStartedAt: null,
    playerOne: createPlayerState(firstPlayer),
    playerTwo: createPlayerState(secondPlayer),
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

  emitToPlayer(io, match.playerOne, "typing_race_match_found", {
    match: getMatchSnapshot(match, match.playerOne.id),
  });
  emitToPlayer(io, match.playerTwo, "typing_race_match_found", {
    match: getMatchSnapshot(match, match.playerTwo.id),
  });

  startCountdown(io, match);
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
    emitToPlayer(io, opponent, "typing_race_error", {
      message: "Opponent disconnected from the race.",
    });

    // 💰 REFUND if early in race (>15s remaining)
    try {
      if (match.raceEndsAt && (match.raceEndsAt - Date.now()) > EARLY_EXIT_SECONDS * 1000) {
        const disconnectUserId = player.id.startsWith('u:') ? player.id.slice(2) : null;
        if (disconnectUserId) {
          await refundGameEntry(disconnectUserId, match.entry, `${GAME_KEY}:${match.id}:refund`, {
            reason: 'player_disconnect',
            timeRemaining: (match.raceEndsAt - Date.now()) / 1000,
            playerKey
          });
        }
      }
    } catch (refundError) {
      console.error(`TypingRace disconnect refund failed [${match.id}]:`, refundError);
    }

    clearTimer(match.phaseTimer);
    clearTimer(match.disconnectTimerOne);
    clearTimer(match.disconnectTimerTwo);
    playerToMatch.delete(match.playerOne.id);
    playerToMatch.delete(match.playerTwo.id);
    matches.delete(match.id);
  }, DISCONNECT_GRACE_MS);
}

module.exports = function attachTypingRaceHandlers(io, socket) {
  socket.on("typing_race_queue_join", async ({ entry, playerId, playerName } = {}) => {
    if (!socket.user?.id) {
      socket.emit("typing_race_error", { message: "Login required for live matchmaking." });
      return;
    }

    const normalizedEntry = normalizeEntry(entry);
    
    // 💰 WALLET VALIDATION + DEDUCTION
    try {
      await validateGameEntry(socket.user.id, normalizedEntry);
      await deductGameEntry(socket.user.id, GAME_KEY, normalizedEntry, socket.id, { action: 'queue_join' });
    } catch (walletError) {
      socket.emit("typing_race_error", { message: walletError.message });
      return;
    }

    const normalizedPlayerId = resolvePlayerId(socket, playerId);
    const normalizedPlayerName = await resolveDisplayName(socket, playerName);

    removeQueueEntry(normalizedPlayerId);

    if (playerToMatch.has(normalizedPlayerId)) {
      const existingMatch = matches.get(playerToMatch.get(normalizedPlayerId));
      if (existingMatch) {
        socket.emit("typing_race_match_found", {
          match: getMatchSnapshot(existingMatch, normalizedPlayerId),
        });
        socket.emit("typing_race_match_state", buildStatePayload(existingMatch, normalizedPlayerId));
        return;
      }
    }

    const queue = getQueue(normalizedEntry);
    const opponentIndex = queue.findIndex((item) => item.player.id !== normalizedPlayerId);

    if (opponentIndex >= 0) {
      const [opponent] = queue.splice(opponentIndex, 1);
      if (!queue.length) {
        queueByEntry.delete(normalizedEntry);
      }

      createMatch(io, opponent.player, {
        id: normalizedPlayerId,
        name: normalizedPlayerName,
        socketId: socket.id,
        entry: normalizedEntry,
      });
      return;
    }

    const queueEntry = {
      player: {
        id: normalizedPlayerId,
        name: normalizedPlayerName,
        socketId: socket.id,
        entry: normalizedEntry,
      },
      joinedAt: Date.now(),
    };

    queue.push(queueEntry);

    socket.emit("typing_race_queue_status", {
      entry: normalizedEntry,
      queuedAt: queueEntry.joinedAt,
      queueSize: queue.length,
    });
  });

  socket.on("typing_race_queue_leave", ({ playerId } = {}) => {
    const normalizedPlayerId = resolvePlayerId(socket, playerId);
    if (normalizedPlayerId) {
      removeQueueEntry(normalizedPlayerId);
    }
  });

  socket.on("typing_race_join_match", ({ matchId, playerId } = {}) => {
    if (!socket.user?.id) {
      socket.emit("typing_race_error", { message: "Login required for live matchmaking." });
      return;
    }

    const normalizedPlayerId = resolvePlayerId(socket, playerId);
    const match = matchId
      ? matches.get(matchId)
      : normalizedPlayerId
      ? matches.get(playerToMatch.get(normalizedPlayerId))
      : null;

    if (!match || !normalizedPlayerId) {
      socket.emit("typing_race_error", { message: "Match not found." });
      return;
    }

    const playerKey =
      match.playerOne.id === normalizedPlayerId
        ? "playerOne"
        : match.playerTwo.id === normalizedPlayerId
        ? "playerTwo"
        : null;

    if (!playerKey) {
      socket.emit("typing_race_error", { message: "Player not part of this race." });
      return;
    }

    const player = match[playerKey];
    player.socketId = socket.id;
    player.disconnectedAt = null;

    const timerField = playerKey === "playerOne" ? "disconnectTimerOne" : "disconnectTimerTwo";
    clearTimer(match[timerField]);

    socket.join(match.roomId);
    socket.emit("typing_race_match_found", {
      match: getMatchSnapshot(match, normalizedPlayerId),
    });
    socket.emit("typing_race_match_state", buildStatePayload(match, normalizedPlayerId));
  });

  socket.on("typing_race_progress", ({ matchId, playerId, currentIndex, errors } = {}) => {
    if (!socket.user?.id) {
      return;
    }

    const normalizedPlayerId = resolvePlayerId(socket, playerId);
    const match = matchId ? matches.get(matchId) : null;
    if (!match || !normalizedPlayerId || match.phase !== "race") {
      return;
    }

    const player =
      match.playerOne.id === normalizedPlayerId
        ? match.playerOne
        : match.playerTwo.id === normalizedPlayerId
        ? match.playerTwo
        : null;

    if (!player || player.finishedAt) {
      return;
    }

    const passageLength = match.passage.length;
    const nextIndex = Math.max(player.currentIndex, Math.min(Math.round(Number(currentIndex) || 0), passageLength));
    const nextErrors = Math.max(player.errors, Math.round(Number(errors) || 0));
    const elapsedMs = match.raceStartedAt ? Date.now() - match.raceStartedAt : 0;
    const metrics = calculateMetrics(nextIndex, nextErrors, elapsedMs);

    player.currentIndex = nextIndex;
    player.errors = nextErrors;
    player.progress = Math.round((nextIndex / passageLength) * 100);
    player.wpm = metrics.wpm;
    player.accuracy = metrics.accuracy;
    player.submittedAt = Date.now();

    if (nextIndex >= passageLength) {
      player.finishedAt = Date.now();
      player.progress = 100;
    }

    emitMatchState(io, match);
    maybeFinalizeMatch(io, match);
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
