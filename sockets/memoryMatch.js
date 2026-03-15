const User = require("../models/User");
const { recordPlatformFeeCollection } = require("../services/platformFeeService");
const { deductGameEntry, payoutGameWinner, refundGameEntry, validateGameEntry } = require("../services/gameWalletService");

const ENTRY_OPTIONS = [10, 20, 50, 100];
const BOARD_PAIR_VALUES = ["A", "B", "C", "D", "E", "F", "G", "H"];
const TOTAL_PAIRS = BOARD_PAIR_VALUES.length;
const MISMATCH_HIDE_DELAY_MS = 900;
const DISCONNECT_GRACE_MS = 10000;
const GAME_KEY = "memory_match";
const GAME_LABEL = "Memory Match";
const EARLY_EXIT_PAIRS = 4; // Refund if total pairs < EARLY_EXIT_PAIRS (half of 8)

const queueByEntry = new Map();
const matches = new Map();
const playerToMatch = new Map();

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

function generateMatchId() {
  return `mm-match-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateRoomId(matchId) {
  return `memory_match:${matchId}`;
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
    console.warn("memory_match display name lookup failed:", error);
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

function shuffle(values) {
  const next = [...values];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[randomIndex]] = [next[randomIndex], next[index]];
  }
  return next;
}

function createBoard() {
  const values = shuffle([...BOARD_PAIR_VALUES, ...BOARD_PAIR_VALUES]);
  return values.map((value, index) => ({
    index,
    value,
    matched: false,
    revealed: false,
    matchedBy: null,
  }));
}

function getPlayerKey(match, playerId) {
  if (match.playerOne.id === playerId) {
    return "playerOne";
  }

  if (match.playerTwo.id === playerId) {
    return "playerTwo";
  }

  return null;
}

function getBoardView(match) {
  return match.board.map((card) => ({
    index: card.index,
    value: card.revealed || card.matched ? card.value : null,
    revealed: card.revealed,
    matched: card.matched,
    matchedBy: card.matched ? card.matchedBy : null,
  }));
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
    totalPairs: TOTAL_PAIRS,
    boardSize: match.board.length,
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

function invertLatestTurn(latestTurn) {
  if (!latestTurn) {
    return null;
  }

  return {
    ...latestTurn,
    playerOneName: latestTurn.playerTwoName,
    playerTwoName: latestTurn.playerOneName,
  };
}

function buildStatePayload(match, forPlayerId) {
  const isPlayerOne = match.playerOne.id === forPlayerId;
  const self = isPlayerOne ? match.playerOne : match.playerTwo;
  const opponent = isPlayerOne ? match.playerTwo : match.playerOne;
  const currentTurnPlayer = match[match.currentTurn];

  return {
    match: getMatchSnapshot(match, forPlayerId),
    state: {
      phase: match.phase,
      board: getBoardView(match),
      currentTurn: currentTurnPlayer.id === self.id ? "you" : "opponent",
      resolving: match.resolving,
      pairCount: {
        you: self.pairs,
        opponent: opponent.pairs,
      },
      moves: {
        you: self.moves,
        opponent: opponent.moves,
      },
      turnNumber: match.turnNumber,
      remainingPairs: TOTAL_PAIRS - (match.playerOne.pairs + match.playerTwo.pairs),
      latestTurn: isPlayerOne ? match.latestTurn : invertLatestTurn(match.latestTurn),
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
  emitToPlayer(io, match.playerOne, "memory_match_state", buildStatePayload(match, match.playerOne.id));
  emitToPlayer(io, match.playerTwo, "memory_match_state", buildStatePayload(match, match.playerTwo.id));
}

function buildResultPayload(match, playerKey) {
  const self = match[playerKey];
  const opponent = playerKey === "playerOne" ? match.playerTwo : match.playerOne;
  const isDraw = self.pairs === opponent.pairs;
  const didPlayerWin = !isDraw && self.pairs > opponent.pairs;
  const selfAccuracy = self.moves > 0 ? Math.round((self.pairs / self.moves) * 100) : 100;
  const opponentAccuracy = opponent.moves > 0 ? Math.round((opponent.pairs / opponent.moves) * 100) : 100;

  return {
    match: getMatchSnapshot(match, self.id),
    player: {
      name: self.name,
      pairs: self.pairs,
      moves: self.moves,
      accuracy: selfAccuracy,
    },
    opponent: {
      name: opponent.name,
      pairs: opponent.pairs,
      moves: opponent.moves,
      accuracy: opponentAccuracy,
    },
    turnHistory:
      playerKey === "playerOne"
        ? match.turnHistory
        : match.turnHistory.map((turn) => ({
            ...turn,
            playerOneName: turn.playerTwoName,
            playerTwoName: turn.playerOneName,
          })),
    rewardEarned: isDraw ? 0 : didPlayerWin ? match.reward : match.loserReward,
    didPlayerWin,
    isDraw,
    completedAt: Date.now(),
  };
}

async function finalizeMatch(io, match) {
  clearTimer(match.resolveTimer);
  clearTimer(match.disconnectTimerOne);
  clearTimer(match.disconnectTimerTwo);

  try {
    // 💰 GAME PAYOUTS
    const p1Won = match.playerOne.pairs > match.playerTwo.pairs;
    const p2Won = match.playerTwo.pairs > match.playerOne.pairs;
    
    // Winner payout (or 0 if draw)
    if (p1Won) {
      await payoutGameWinner(match.playerOne.id, GAME_KEY, match.reward, match.id, false, {
        pairs: match.playerOne.pairs,
        opponentPairs: match.playerTwo.pairs
      });
    } else if (p2Won) {
      await payoutGameWinner(match.playerTwo.id, GAME_KEY, match.reward, match.id, false, {
        pairs: match.playerTwo.pairs,
        opponentPairs: match.playerOne.pairs
      });
    }
    
    // Loser consolation (if not draw)
    if (p1Won) {
      await payoutGameWinner(match.playerTwo.id, GAME_KEY, match.loserReward, match.id, true, {
        pairs: match.playerTwo.pairs,
        opponentPairs: match.playerOne.pairs
      });
    } else if (p2Won) {
      await payoutGameWinner(match.playerOne.id, GAME_KEY, match.loserReward, match.id, true, {
        pairs: match.playerOne.pairs,
        opponentPairs: match.playerTwo.pairs
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
        totalPairs: TOTAL_PAIRS,
        playerOnePairs: match.playerOne.pairs,
        playerTwoPairs: match.playerTwo.pairs,
      },
    }).catch((error) => {
      console.error("memory_match platform fee save failed:", error);
    });
  } catch (payoutError) {
    console.error(`MemoryMatch payout error [${match.id}]:`, payoutError);
    // Graceful - don't block emits
  }

  emitToPlayer(io, match.playerOne, "memory_match_complete", buildResultPayload(match, "playerOne"));
  emitToPlayer(io, match.playerTwo, "memory_match_complete", buildResultPayload(match, "playerTwo"));

  playerToMatch.delete(match.playerOne.id);
  playerToMatch.delete(match.playerTwo.id);
  matches.delete(match.id);
}

function maybeFinalizeMatch(io, match) {
  if (match.playerOne.pairs + match.playerTwo.pairs >= TOTAL_PAIRS) {
    match.phase = "complete";
    emitMatchState(io, match);
    finalizeMatch(io, match);
  }
}

function resolveSelectedCards(io, match, currentPlayerKey) {
  clearTimer(match.resolveTimer);
  const [firstIndex, secondIndex] = match.selectedIndices;
  const firstCard = match.board[firstIndex];
  const secondCard = match.board[secondIndex];
  const currentPlayer = match[currentPlayerKey];
  const opponentKey = currentPlayerKey === "playerOne" ? "playerTwo" : "playerOne";

  currentPlayer.moves += 1;
  match.resolving = true;

  const isMatch = firstCard.value === secondCard.value;

  match.latestTurn = {
    playerOneName: match.playerOne.name,
    playerTwoName: match.playerTwo.name,
    flipped: [firstIndex, secondIndex],
    value: firstCard.value,
    matched: isMatch,
    turnPlayer: currentPlayer.name,
  };

  if (isMatch) {
    firstCard.matched = true;
    secondCard.matched = true;
    firstCard.revealed = true;
    secondCard.revealed = true;
    firstCard.matchedBy = currentPlayer.name;
    secondCard.matchedBy = currentPlayer.name;
    currentPlayer.pairs += 1;
    match.turnHistory.push(match.latestTurn);
    match.selectedIndices = [];
    match.resolving = false;
    emitMatchState(io, match);
    maybeFinalizeMatch(io, match);
    return;
  }

  emitMatchState(io, match);

  match.resolveTimer = setTimeout(() => {
    firstCard.revealed = false;
    secondCard.revealed = false;
    match.currentTurn = opponentKey;
    match.turnNumber += 1;
    match.turnHistory.push(match.latestTurn);
    match.selectedIndices = [];
    match.resolving = false;
    emitMatchState(io, match);
  }, MISMATCH_HIDE_DELAY_MS);
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
    phase: "active",
    board: createBoard(),
    selectedIndices: [],
    currentTurn: Math.random() > 0.5 ? "playerOne" : "playerTwo",
    turnNumber: 1,
    resolving: false,
    latestTurn: null,
    turnHistory: [],
    playerOne: {
      ...firstPlayer,
      pairs: 0,
      moves: 0,
      disconnectedAt: null,
    },
    playerTwo: {
      ...secondPlayer,
      pairs: 0,
      moves: 0,
      disconnectedAt: null,
    },
    resolveTimer: null,
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

  emitToPlayer(io, match.playerOne, "memory_match_found", {
    match: getMatchSnapshot(match, match.playerOne.id),
  });
  emitToPlayer(io, match.playerTwo, "memory_match_found", {
    match: getMatchSnapshot(match, match.playerTwo.id),
  });

  emitMatchState(io, match);
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
    emitToPlayer(io, opponent, "memory_match_error", {
      message: "Opponent disconnected from the match.",
    });

    // 💰 REFUND if early exit (< half pairs completed)
    try {
      const totalPairsDone = match.playerOne.pairs + match.playerTwo.pairs;
      if (totalPairsDone < EARLY_EXIT_PAIRS) {
        const disconnectUserId = player.id.startsWith('u:') ? player.id.slice(2) : null;
        if (disconnectUserId) {
          await refundGameEntry(disconnectUserId, match.entry, `${GAME_KEY}:${match.id}:refund`, {
            reason: 'player_disconnect',
            pairsDone: totalPairsDone,
            playerKey
          });
        }
      }
    } catch (refundError) {
      console.error(`MemoryMatch disconnect refund failed [${match.id}]:`, refundError);
    }

    clearTimer(match.resolveTimer);
    clearTimer(match.disconnectTimerOne);
    clearTimer(match.disconnectTimerTwo);
    playerToMatch.delete(match.playerOne.id);
    playerToMatch.delete(match.playerTwo.id);
    matches.delete(match.id);
  }, DISCONNECT_GRACE_MS);
}

module.exports = function attachMemoryMatchHandlers(io, socket) {
  socket.on("memory_match_queue_join", async ({ entry, playerId, playerName } = {}) => {
    if (!socket.user?.id) {
      socket.emit("memory_match_error", { message: "Login required for live matchmaking." });
      return;
    }

    const normalizedEntry = normalizeEntry(entry);
    
    // 💰 WALLET VALIDATION + DEDUCTION
    try {
      await validateGameEntry(socket.user.id, normalizedEntry);
      await deductGameEntry(socket.user.id, GAME_KEY, normalizedEntry, socket.id, { action: 'queue_join' });
    } catch (walletError) {
      socket.emit("memory_match_error", { message: walletError.message });
      return;
    }

    const normalizedPlayerId = resolvePlayerId(socket, playerId);
    const normalizedPlayerName = await resolveDisplayName(socket, playerName);

    removeQueueEntry(normalizedPlayerId);

    if (playerToMatch.has(normalizedPlayerId)) {
      const existingMatch = matches.get(playerToMatch.get(normalizedPlayerId));
      if (existingMatch) {
        socket.emit("memory_match_found", {
          match: getMatchSnapshot(existingMatch, normalizedPlayerId),
        });
        socket.emit("memory_match_state", buildStatePayload(existingMatch, normalizedPlayerId));
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

    socket.emit("memory_match_queue_status", {
      entry: normalizedEntry,
      queuedAt: queueEntry.joinedAt,
      queueSize: queue.length,
    });
  });

  socket.on("memory_match_queue_leave", ({ playerId } = {}) => {
    const normalizedPlayerId = resolvePlayerId(socket, playerId);
    if (normalizedPlayerId) {
      removeQueueEntry(normalizedPlayerId);
    }
  });

  socket.on("memory_match_join_match", ({ matchId, playerId } = {}) => {
    if (!socket.user?.id) {
      socket.emit("memory_match_error", { message: "Login required for live matchmaking." });
      return;
    }

    const normalizedPlayerId = resolvePlayerId(socket, playerId);
    const match = matchId
      ? matches.get(matchId)
      : normalizedPlayerId
      ? matches.get(playerToMatch.get(normalizedPlayerId))
      : null;

    if (!match || !normalizedPlayerId) {
      socket.emit("memory_match_error", { message: "Match not found." });
      return;
    }

    const playerKey = getPlayerKey(match, normalizedPlayerId);
    if (!playerKey) {
      socket.emit("memory_match_error", { message: "Player not part of this match." });
      return;
    }

    const player = match[playerKey];
    player.socketId = socket.id;
    player.disconnectedAt = null;

    const timerField = playerKey === "playerOne" ? "disconnectTimerOne" : "disconnectTimerTwo";
    clearTimer(match[timerField]);

    socket.join(match.roomId);
    socket.emit("memory_match_found", {
      match: getMatchSnapshot(match, normalizedPlayerId),
    });
    socket.emit("memory_match_state", buildStatePayload(match, normalizedPlayerId));
  });

  socket.on("memory_match_flip", ({ matchId, playerId, cardIndex } = {}) => {
    if (!socket.user?.id) {
      return;
    }

    const normalizedPlayerId = resolvePlayerId(socket, playerId);
    const match = matchId ? matches.get(matchId) : null;

    if (!match || match.phase !== "active" || match.resolving) {
      return;
    }

    const playerKey = getPlayerKey(match, normalizedPlayerId);
    if (!playerKey || match.currentTurn !== playerKey) {
      return;
    }

    const normalizedCardIndex = Math.round(Number(cardIndex));
    if (!Number.isInteger(normalizedCardIndex) || normalizedCardIndex < 0 || normalizedCardIndex >= match.board.length) {
      return;
    }

    const card = match.board[normalizedCardIndex];
    if (!card || card.matched || card.revealed || match.selectedIndices.includes(normalizedCardIndex)) {
      return;
    }

    card.revealed = true;
    match.selectedIndices.push(normalizedCardIndex);
    emitMatchState(io, match);

    if (match.selectedIndices.length >= 2) {
      resolveSelectedCards(io, match, playerKey);
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
