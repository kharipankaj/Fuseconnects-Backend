const User = require("../models/User");
const { recordPlatformFeeCollection } = require("../services/platformFeeService");
const { deductGameEntry, payoutGameWinner, refundGameEntry, validateGameEntry } = require("../services/gameWalletService");

const TOTAL_ROUNDS = 5;
const ROUND_TIME_MS = 8000;
const BETWEEN_ROUNDS_MS = 1800;
const ENTRY_OPTIONS = [10, 20, 50, 100];
const OPERATIONS = ["+", "-", "*"];

const queueByEntry = new Map();
const matches = new Map();
const playerToMatch = new Map();
const GAME_KEY = "math_quiz";
const GAME_LABEL = "Math Quiz";
const EARLY_EXIT_ROUND = 3; // Refund if currentRound < EARLY_EXIT_ROUND

function getReward(entry) {
  return Number((Number(entry || 0) * 2 * 0.7).toFixed(2));
}

function getLoserReward(entry) {
  return Number((Number(entry || 0) * 2 * 0.05).toFixed(2));
}

function getPlatformFee(entry) {
  return Number((Number(entry || 0) * 2 * 0.25).toFixed(2));
}

function normalizeEntry(entry) {
  const normalized = Number(entry) || 10;
  return ENTRY_OPTIONS.includes(normalized) ? normalized : 10;
}

function getQueue(entry) {
  const normalizedEntry = normalizeEntry(entry);
  if (!queueByEntry.has(normalizedEntry)) {
    queueByEntry.set(normalizedEntry, []);
  }

  return queueByEntry.get(normalizedEntry);
}

function generateMatchId() {
  return `mq-match-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateRoomId(matchId) {
  return `math_quiz:${matchId}`;
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

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function generateOperand(operation) {
  if (operation === "*") {
    return 2 + Math.floor(Math.random() * 10);
  }

  return 6 + Math.floor(Math.random() * 35);
}

function computeAnswer(left, right, operation) {
  if (operation === "+") {
    return left + right;
  }

  if (operation === "-") {
    return left - right;
  }

  return left * right;
}

function buildOptions(correctAnswer) {
  const options = new Set([correctAnswer]);

  while (options.size < 4) {
    const variance = 1 + Math.floor(Math.random() * 8);
    const direction = Math.random() > 0.5 ? 1 : -1;
    options.add(correctAnswer + variance * direction);
  }

  return Array.from(options).sort(() => Math.random() - 0.5);
}

function createQuestion(index) {
  const operation = randomFrom(OPERATIONS);
  let left = generateOperand(operation);
  let right = generateOperand(operation);

  if (operation === "-" && right > left) {
    [left, right] = [right, left];
  }

  const answer = computeAnswer(left, right, operation);

  return {
    id: `math-q-${index + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    prompt: `${left} ${operation} ${right}`,
    answer,
    options: buildOptions(answer),
  };
}

function createQuestionSet() {
  return Array.from({ length: TOTAL_ROUNDS }, (_, index) => createQuestion(index));
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
    console.warn("math_quiz display name lookup failed:", error);
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

function getRoundQuestion(match) {
  return match.questions[match.currentRound - 1] || null;
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

function invertRoundSummary(summary) {
  if (!summary) {
    return null;
  }

  return {
    ...summary,
    playerAnswer: summary.opponentAnswer,
    opponentAnswer: summary.playerAnswer,
    playerCorrect: summary.opponentCorrect,
    opponentCorrect: summary.playerCorrect,
    playerTimeMs: summary.opponentTimeMs,
    opponentTimeMs: summary.playerTimeMs,
    playerScore: summary.opponentScore,
    opponentScore: summary.playerScore,
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
      round: match.currentRound,
      totalRounds: match.rounds,
      roundEndsAt: match.roundEndsAt,
      scores: {
        you: self.score,
        opponent: opponent.score,
      },
      correct: {
        you: self.correct,
        opponent: opponent.correct,
      },
      question: match.phase === "question" ? getRoundQuestion(match) : null,
      latestRound: isPlayerOne ? match.latestRound : invertRoundSummary(match.latestRound),
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
  emitToPlayer(io, match.playerOne, "math_quiz_match_state", buildStatePayload(match, match.playerOne.id));
  emitToPlayer(io, match.playerTwo, "math_quiz_match_state", buildStatePayload(match, match.playerTwo.id));
}

function buildPlayerResultPayload(match, playerKey) {
  const self = match[playerKey];
  const opponent = playerKey === "playerOne" ? match.playerTwo : match.playerOne;
  const isDraw = self.score === opponent.score;
  const didPlayerWin = self.score > opponent.score;

  return {
    match: getMatchSnapshot(match, self.id),
    playerScore: self.score,
    opponentScore: opponent.score,
    playerCorrect: self.correct,
    opponentCorrect: opponent.correct,
    rewardEarned: isDraw ? 0 : didPlayerWin ? match.reward : match.loserReward,
    didPlayerWin,
    isDraw,
    rounds: playerKey === "playerOne" ? match.roundsHistory : match.roundsHistory.map(invertRoundSummary),
    completedAt: Date.now(),
  };
}

async function finalizeMatch(io, match) {
  clearTimer(match.phaseTimer);
  clearTimer(match.disconnectTimerOne);
  clearTimer(match.disconnectTimerTwo);

  try {
    // 💰 GAME PAYOUTS
    const p1Won = match.playerOne.score > match.playerTwo.score;
    const p2Won = match.playerTwo.score > match.playerOne.score;
    
    // Winner payout (or 0 if draw)
    if (p1Won) {
      await payoutGameWinner(match.playerOne.id, GAME_KEY, match.reward, match.id, false, {
        score: match.playerOne.score,
        opponentScore: match.playerTwo.score
      });
    } else if (p2Won) {
      await payoutGameWinner(match.playerTwo.id, GAME_KEY, match.reward, match.id, false, {
        score: match.playerTwo.score,
        opponentScore: match.playerOne.score
      });
    }
    
    // Loser consolation (if not draw)
    if (p1Won) {
      await payoutGameWinner(match.playerTwo.id, GAME_KEY, match.loserReward, match.id, true, {
        score: match.playerTwo.score,
        opponentScore: match.playerOne.score
      });
    } else if (p2Won) {
      await payoutGameWinner(match.playerOne.id, GAME_KEY, match.loserReward, match.id, true, {
        score: match.playerOne.score,
        opponentScore: match.playerTwo.score
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
        playerOneScore: match.playerOne.score,
        playerTwoScore: match.playerTwo.score,
      },
    }).catch((error) => {
      console.error("math_quiz platform fee save failed:", error);
    });
  } catch (payoutError) {
    console.error(`MathQuiz payout error [${match.id}]:`, payoutError);
    // Don't block emit - graceful degradation
  }

  emitToPlayer(io, match.playerOne, "math_quiz_match_complete", buildPlayerResultPayload(match, "playerOne"));
  emitToPlayer(io, match.playerTwo, "math_quiz_match_complete", buildPlayerResultPayload(match, "playerTwo"));

  playerToMatch.delete(match.playerOne.id);
  playerToMatch.delete(match.playerTwo.id);
  matches.delete(match.id);
}

function calculateRoundScore(answeredCorrectly, responseMs) {
  if (!answeredCorrectly || responseMs === null) {
    return 0;
  }

  return Math.max(150, Math.round(1300 - responseMs * 0.28));
}

function finalizeRound(io, match) {
  clearTimer(match.phaseTimer);

  const question = getRoundQuestion(match);
  const playerOneSubmission = match.submissions[match.playerOne.id] || null;
  const playerTwoSubmission = match.submissions[match.playerTwo.id] || null;

  const playerOneCorrect = !!playerOneSubmission && playerOneSubmission.answer === question.answer;
  const playerTwoCorrect = !!playerTwoSubmission && playerTwoSubmission.answer === question.answer;
  const playerOneResponseMs = playerOneSubmission ? playerOneSubmission.responseMs : null;
  const playerTwoResponseMs = playerTwoSubmission ? playerTwoSubmission.responseMs : null;
  const playerOneScore = calculateRoundScore(playerOneCorrect, playerOneResponseMs);
  const playerTwoScore = calculateRoundScore(playerTwoCorrect, playerTwoResponseMs);

  match.playerOne.score += playerOneScore;
  match.playerTwo.score += playerTwoScore;
  match.playerOne.correct += playerOneCorrect ? 1 : 0;
  match.playerTwo.correct += playerTwoCorrect ? 1 : 0;

  match.latestRound = {
    question: question.prompt,
    correctAnswer: question.answer,
    playerAnswer: playerOneSubmission?.answer ?? null,
    opponentAnswer: playerTwoSubmission?.answer ?? null,
    playerCorrect: playerOneCorrect,
    opponentCorrect: playerTwoCorrect,
    playerTimeMs: playerOneResponseMs,
    opponentTimeMs: playerTwoResponseMs,
    playerScore: playerOneScore,
    opponentScore: playerTwoScore,
  };
  match.roundsHistory.push(match.latestRound);
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
    startQuestionPhase(io, match);
  }, BETWEEN_ROUNDS_MS);
}

function startQuestionPhase(io, match) {
  clearTimer(match.phaseTimer);
  match.phase = "question";
  match.submissions = {};
  match.roundEndsAt = Date.now() + ROUND_TIME_MS;
  emitMatchState(io, match);

  match.phaseTimer = setTimeout(() => finalizeRound(io, match), ROUND_TIME_MS);
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
    phase: "question",
    roundEndsAt: null,
    latestRound: null,
    questions: createQuestionSet(),
    submissions: {},
    roundsHistory: [],
    playerOne: {
      ...firstPlayer,
      score: 0,
      correct: 0,
      disconnectedAt: null,
    },
    playerTwo: {
      ...secondPlayer,
      score: 0,
      correct: 0,
      disconnectedAt: null,
    },
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

  emitToPlayer(io, match.playerOne, "math_quiz_match_found", {
    match: getMatchSnapshot(match, match.playerOne.id),
  });
  emitToPlayer(io, match.playerTwo, "math_quiz_match_found", {
    match: getMatchSnapshot(match, match.playerTwo.id),
  });

  startQuestionPhase(io, match);
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
    emitToPlayer(io, opponent, "math_quiz_error", {
      message: "Opponent disconnected from the match.",
    });

    // 💰 REFUND if early exit (before halfway)
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
      console.error(`MathQuiz disconnect refund failed [${match.id}]:`, refundError);
    }

    clearTimer(match.phaseTimer);
    clearTimer(match.disconnectTimerOne);
    clearTimer(match.disconnectTimerTwo);
    playerToMatch.delete(match.playerOne.id);
    playerToMatch.delete(match.playerTwo.id);
    matches.delete(match.id);
  }, 10000);
}

module.exports = function attachMathQuizHandlers(io, socket) {
  socket.on("math_quiz_queue_join", async ({ entry, playerId, playerName } = {}) => {
    if (!socket.user?.id) {
      socket.emit("math_quiz_error", { message: "Login required for live matchmaking." });
      return;
    }

    const normalizedEntry = normalizeEntry(entry);
    
    // 💰 WALLET VALIDATION + DEDUCTION
    try {
      await validateGameEntry(socket.user.id, normalizedEntry);
      await deductGameEntry(socket.user.id, GAME_KEY, normalizedEntry, socket.id, { action: 'queue_join' });
    } catch (walletError) {
      socket.emit("math_quiz_error", { message: walletError.message });
      return;
    }

    const normalizedPlayerId = resolvePlayerId(socket, playerId);
    const normalizedPlayerName = await resolveDisplayName(socket, playerName);

    removeQueueEntry(normalizedPlayerId);

    if (playerToMatch.has(normalizedPlayerId)) {
      const existingMatch = matches.get(playerToMatch.get(normalizedPlayerId));
      if (existingMatch) {
        socket.emit("math_quiz_match_found", {
          match: getMatchSnapshot(existingMatch, normalizedPlayerId),
        });
        socket.emit("math_quiz_match_state", buildStatePayload(existingMatch, normalizedPlayerId));
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

      // Match found - entry fees already deducted
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

    socket.emit("math_quiz_queue_status", {
      entry: normalizedEntry,
      queuedAt: queueEntry.joinedAt,
      queueSize: queue.length,
    });
  });

  socket.on("math_quiz_queue_leave", ({ playerId } = {}) => {
    const normalizedPlayerId = resolvePlayerId(socket, playerId);
    if (normalizedPlayerId) {
      removeQueueEntry(normalizedPlayerId);
    }
  });

  socket.on("math_quiz_join_match", ({ matchId, playerId } = {}) => {
    if (!socket.user?.id) {
      socket.emit("math_quiz_error", { message: "Login required for live matchmaking." });
      return;
    }

    const normalizedPlayerId = resolvePlayerId(socket, playerId);
    const match = matchId
      ? matches.get(matchId)
      : normalizedPlayerId
      ? matches.get(playerToMatch.get(normalizedPlayerId))
      : null;

    if (!match || !normalizedPlayerId) {
      socket.emit("math_quiz_error", { message: "Match not found." });
      return;
    }

    const playerKey =
      match.playerOne.id === normalizedPlayerId
        ? "playerOne"
        : match.playerTwo.id === normalizedPlayerId
        ? "playerTwo"
        : null;

    if (!playerKey) {
      socket.emit("math_quiz_error", { message: "Player not part of this match." });
      return;
    }

    const player = match[playerKey];
    player.socketId = socket.id;
    player.disconnectedAt = null;

    const timerField = playerKey === "playerOne" ? "disconnectTimerOne" : "disconnectTimerTwo";
    clearTimer(match[timerField]);

    socket.join(match.roomId);
    socket.emit("math_quiz_match_found", {
      match: getMatchSnapshot(match, normalizedPlayerId),
    });
    socket.emit("math_quiz_match_state", buildStatePayload(match, normalizedPlayerId));
  });

  socket.on("math_quiz_submit", ({ matchId, playerId, answer, responseMs } = {}) => {
    if (!socket.user?.id) {
      return;
    }

    const normalizedPlayerId = resolvePlayerId(socket, playerId);
    const match = matchId ? matches.get(matchId) : null;

    if (!match || !normalizedPlayerId || match.phase !== "question") {
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

    const question = getRoundQuestion(match);
    const normalizedAnswer = Number(answer);
    if (!Number.isFinite(normalizedAnswer) || !question.options.includes(normalizedAnswer)) {
      return;
    }

    const normalizedResponseMs = Math.min(
      Math.max(Math.round(Number(responseMs) || ROUND_TIME_MS), 0),
      ROUND_TIME_MS
    );

    match.submissions[normalizedPlayerId] = {
      answer: normalizedAnswer,
      responseMs: normalizedResponseMs,
    };

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
