const TRIVIA_API = 'https://the-trivia-api.com/v2/questions';
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const VOTE_OPTIONS_COUNT = 4;

export const VOTE_CATEGORIES = [
  { id: 'science', label: 'Science' },
  { id: 'history', label: 'History' },
  { id: 'geography', label: 'Geography' },
  { id: 'film_and_tv', label: 'Film & TV' },
  { id: 'music', label: 'Music' },
  { id: 'sport_and_leisure', label: 'Sports' },
  { id: 'food_and_drink', label: 'Food & Drink' },
  { id: 'general_knowledge', label: 'General Knowledge' },
  { id: 'arts_and_literature', label: 'Arts & Literature' },
  { id: 'society_and_culture', label: 'Society & Culture' },
];

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function generateRoomCode() {
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)];
  }
  return code;
}

export function difficultyForRound(roundIndex, totalRounds) {
  if (totalRounds <= 1) return 'easy';
  const progress = roundIndex / (totalRounds - 1);
  if (progress < 0.34) return 'easy';
  if (progress < 0.67) return 'medium';
  return 'hard';
}

function formatCategory(id) {
  const found = VOTE_CATEGORIES.find((c) => c.id === id);
  return found?.label ?? id.replace(/_/g, ' ');
}

export function pickVoteOptions(room) {
  const excludeId = room.lastPlayedCategory;
  const eligible = VOTE_CATEGORIES.filter((c) => c.id !== excludeId);

  const sorted = [...eligible].sort((a, b) => {
    const countA = room.categoryPlayCount[a.id] ?? 0;
    const countB = room.categoryPlayCount[b.id] ?? 0;
    if (countA !== countB) return countA - countB;
    return Math.random() - 0.5;
  });

  return shuffle(sorted.slice(0, VOTE_OPTIONS_COUNT));
}

function tallyVotes(room) {
  const counts = {};
  for (const p of room.players) {
    if (p.categoryVote) {
      counts[p.categoryVote] = (counts[p.categoryVote] || 0) + 1;
    }
  }

  let max = 0;
  let winners = [];
  for (const [cat, count] of Object.entries(counts)) {
    if (count > max) {
      max = count;
      winners = [cat];
    } else if (count === max) {
      winners.push(cat);
    }
  }

  if (winners.length) {
    return winners[Math.floor(Math.random() * winners.length)];
  }

  const fallback = room.voteOptions[Math.floor(Math.random() * room.voteOptions.length)];
  return fallback.id;
}

function hasPlayers(room) {
  return room.players.length > 0;
}

function isActivePhase(phase) {
  return ['voting', 'question', 'reveal'].includes(phase);
}

function sanitizePublicState(room) {
  const current = room.currentQuestion;
  const phase = room.phase;

  let question = null;
  if (current && (phase === 'question' || phase === 'reveal')) {
    question = {
      text: current.text,
      category: current.category,
      difficulty: current.difficulty,
      choices: phase === 'reveal'
        ? current.choices.map((c, i) => ({
            text: c.text,
            index: i,
            isCorrect: c.isCorrect,
          }))
        : current.choices.map((c, i) => ({ text: c.text, index: i })),
      correctIndex: phase === 'reveal' ? current.correctIndex : undefined,
    };
  }

  const voteTally =
    phase === 'voting'
      ? buildVoteTally(room)
      : undefined;

  return {
    roomCode: room.code,
    phase,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      hasAnswered: phase === 'question' ? p.hasAnswered : undefined,
      hasVoted: phase === 'voting' ? p.hasVoted : undefined,
      lastAnswerCorrect: phase === 'reveal' ? p.lastAnswerCorrect : undefined,
    })),
    currentIndex: room.currentIndex,
    totalQuestions: room.totalQuestions,
    question,
    timeLeft: room.timeLeft,
    timeMax: room.phaseTimeMax ?? undefined,
    voteOptions: phase === 'voting' ? room.voteOptions : undefined,
    voteTally,
    roundCategory: room.roundCategory ? formatCategory(room.roundCategory) : undefined,
    roundDifficulty: room.roundDifficulty,
    statusMessage: room.statusMessage,
    canStart: room.phase === 'lobby' && hasPlayers(room),
  };
}

function createPlayer(socketId, name) {
  return {
    id: socketId,
    name,
    score: 0,
    hasAnswered: false,
    hasVoted: false,
    categoryVote: null,
    lastAnswerCorrect: null,
    currentChoice: null,
  };
}

function buildVoteTally(room) {
  const counts = {};
  for (const opt of room.voteOptions) {
    counts[opt.id] = 0;
  }
  for (const p of room.players) {
    if (p.categoryVote && counts[p.categoryVote] !== undefined) {
      counts[p.categoryVote] += 1;
    }
  }
  return room.voteOptions.map((opt) => ({
    id: opt.id,
    label: opt.label,
    votes: counts[opt.id] ?? 0,
  }));
}

export class GameManager {
  constructor({
    questionsPerGame,
    answerTimeSec,
    voteTimeSec,
    revealTimeSec,
    minPlayers,
    apiKey,
    onTick,
  }) {
    this.questionsPerGame = questionsPerGame;
    this.answerTimeSec = answerTimeSec;
    this.voteTimeSec = voteTimeSec;
    this.revealTimeSec = revealTimeSec;
    this.minPlayers = minPlayers;
    this.apiKey = apiKey;
    this.onTick = onTick;
    this.rooms = new Map();
    this.timers = new Map();
  }

  createRoom(organizerSocketId) {
    let code;
    do {
      code = generateRoomCode();
    } while (this.rooms.has(code));

    const room = {
      code,
      organizerSocketId,
      phase: 'lobby',
      players: [],
      currentQuestion: null,
      currentIndex: 0,
      totalQuestions: this.questionsPerGame,
      timeLeft: 0,
      voteOptions: [],
      roundCategory: null,
      roundDifficulty: null,
      statusMessage: null,
      lastPlayedCategory: null,
      categoryPlayCount: {},
    };
    this.rooms.set(code, room);
    return { roomCode: code, state: sanitizePublicState(room) };
  }

  joinRoom(roomCode, socketId, name) {
    const code = String(roomCode || '').trim().toUpperCase();
    const room = this.rooms.get(code);
    if (!room) return { error: 'Room not found' };
    if (room.organizerSocketId === socketId) {
      return { error: 'Join as a player on a different phone' };
    }
    if (!['lobby', 'paused'].includes(room.phase)) {
      return { error: 'Game already in progress — wait for a new game' };
    }

    const trimmed = String(name || '').trim().slice(0, 20);
    if (!trimmed) return { error: 'Enter your name' };
    if (room.players.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
      return { error: 'Name already taken' };
    }

    room.players.push(createPlayer(socketId, trimmed));

    if (room.phase === 'paused') {
      this.resumeFromPause(room);
    }

    return { roomCode: code, playerId: socketId, state: sanitizePublicState(room) };
  }

  removePlayer(roomCode, playerId) {
    const room = this.rooms.get(roomCode);
    if (!room) return {};

    room.players = room.players.filter((p) => p.id !== playerId);

    if (!hasPlayers(room)) {
      if (isActivePhase(room.phase)) {
        this.pauseGame(room);
        return { state: sanitizePublicState(room) };
      }
      this.removeRoom(roomCode);
      return { roomDeleted: true };
    }

    return { state: sanitizePublicState(room) };
  }

  pauseGame(room) {
    this.clearTimer(room.code);
    room.phase = 'paused';
    room.statusMessage = 'No players left — game paused';
    this.emit(room);
  }

  resumeFromPause(room) {
    if (room.phase !== 'paused' || !hasPlayers(room)) return;
    if (room.currentIndex >= room.totalQuestions) {
      room.phase = 'finished';
      room.statusMessage = null;
      this.emit(room);
      return;
    }
    this.beginVoting(room);
  }

  removeRoom(roomCode) {
    this.clearTimer(roomCode);
    this.rooms.delete(roomCode);
  }

  recordCategoryPlayed(room, categoryId) {
    room.lastPlayedCategory = categoryId;
    room.categoryPlayCount[categoryId] = (room.categoryPlayCount[categoryId] ?? 0) + 1;
  }

  startGame(roomCode, socketId, { asOrganizer = false } = {}) {
    const room = this.rooms.get(roomCode);
    if (!room) return { error: 'Room not found' };
    const isOrganizer = asOrganizer && room.organizerSocketId === socketId;
    if (!isOrganizer) {
      return { error: 'Only the device that created the room can start the game' };
    }
    if (room.phase !== 'lobby') return { error: 'Game already started' };
    if (!hasPlayers(room)) {
      return { error: 'Need at least 1 player to start' };
    }

    room.currentIndex = 0;
    room.lastPlayedCategory = null;
    room.categoryPlayCount = {};
    this.beginVoting(room);
    return { state: sanitizePublicState(room) };
  }

  beginVoting(room) {
    if (!hasPlayers(room)) {
      this.pauseGame(room);
      return;
    }

    for (const p of room.players) {
      p.hasVoted = false;
      p.categoryVote = null;
      p.hasAnswered = false;
      p.currentChoice = null;
      p.lastAnswerCorrect = null;
    }

    room.currentQuestion = null;
    room.roundCategory = null;
    room.roundDifficulty = difficultyForRound(room.currentIndex, room.totalQuestions);
    room.voteOptions = pickVoteOptions(room);
    room.phase = 'voting';
    room.phaseTimeMax = this.voteTimeSec;
    room.timeLeft = this.voteTimeSec;
    room.statusMessage = `Round ${room.currentIndex + 1} — pick a category (${VOTE_OPTIONS_COUNT} choices)`;

    this.startTimer(room, () => {
      if (!hasPlayers(room)) {
        this.pauseGame(room);
        return;
      }
      this.resolveVotingAndLoadQuestion(room.code);
    });
    this.emit(room);
  }

  submitVote(roomCode, playerId, categoryId) {
    const room = this.rooms.get(roomCode);
    if (!room) return { error: 'Room not found' };
    if (room.phase !== 'voting') return { error: 'Not voting right now' };
    if (!hasPlayers(room)) return { error: 'Game is paused' };

    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { error: 'Player not found' };
    if (player.hasVoted) return { error: 'Already voted' };

    const valid = room.voteOptions.some((o) => o.id === categoryId);
    if (!valid) return { error: 'Invalid category' };

    player.hasVoted = true;
    player.categoryVote = categoryId;

    if (room.players.every((p) => p.hasVoted)) {
      this.clearTimer(roomCode);
      this.resolveVotingAndLoadQuestion(roomCode);
    }

    return { state: sanitizePublicState(room) };
  }

  async resolveVotingAndLoadQuestion(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room || room.phase !== 'voting') return;
    if (!hasPlayers(room)) {
      this.pauseGame(room);
      return;
    }

    this.clearTimer(roomCode);
    room.roundCategory = tallyVotes(room);

    try {
      const question = await this.fetchQuestion(room.roundCategory, room.roundDifficulty);
      if (!hasPlayers(room)) {
        this.pauseGame(room);
        return;
      }
      room.currentQuestion = question;
      this.recordCategoryPlayed(room, room.roundCategory);
      this.beginQuestion(room);
    } catch (err) {
      if (!hasPlayers(room)) {
        this.pauseGame(room);
        return;
      }
      room.phase = 'voting';
      room.statusMessage = err.message || 'Failed to load question — vote again';
      this.beginVoting(room);
    }
  }

  async fetchQuestion(category, difficulty) {
    const params = new URLSearchParams();
    params.set('limit', '1');
    params.set('categories', category);
    params.set('difficulties', difficulty);

    const headers = {};
    if (this.apiKey) headers['x-api-key'] = this.apiKey;

    const res = await fetch(`${TRIVIA_API}?${params}`, { headers });
    if (!res.ok) {
      throw new Error(`Trivia API error (${res.status})`);
    }

    const data = await res.json();
    if (!data.length) {
      throw new Error('No question found for this category');
    }

    const q = data[0];
    const choices = shuffle([
      { text: q.correctAnswer.trim(), isCorrect: true },
      ...q.incorrectAnswers.map((a) => ({ text: a.trim(), isCorrect: false })),
    ]);
    const correctIndex = choices.findIndex((c) => c.isCorrect);

    return {
      id: q.id,
      text: q.question.text,
      category: formatCategory(q.category),
      difficulty: q.difficulty,
      choices,
      correctIndex,
    };
  }

  beginQuestion(room) {
    if (!hasPlayers(room)) {
      this.pauseGame(room);
      return;
    }

    if (!room.currentQuestion) {
      room.phase = 'finished';
      this.clearTimer(room.code);
      return;
    }

    room.phase = 'question';
    room.phaseTimeMax = this.answerTimeSec;
    room.timeLeft = this.answerTimeSec;
    room.statusMessage = null;

    this.startTimer(room, () => {
      if (!hasPlayers(room)) {
        this.pauseGame(room);
        return;
      }
      const result = this.revealAnswers(room.code);
      this.emitState(result);
    });
    this.emit(room);
  }

  submitAnswer(roomCode, playerId, choiceIndex) {
    const room = this.rooms.get(roomCode);
    if (!room) return { error: 'Room not found' };
    if (room.phase !== 'question') return { error: 'Not accepting answers' };
    if (!hasPlayers(room)) return { error: 'Game is paused' };

    const player = room.players.find((p) => p.id === playerId);
    if (!player) return { error: 'Player not found' };
    if (player.hasAnswered) return { error: 'Already answered' };

    const idx = Number(choiceIndex);
    const q = room.currentQuestion;
    if (idx < 0 || idx >= q.choices.length) return { error: 'Invalid choice' };

    player.hasAnswered = true;
    player.currentChoice = idx;

    if (room.players.every((p) => p.hasAnswered)) {
      this.clearTimer(roomCode);
      const result = this.revealAnswers(roomCode);
      return result;
    }

    return { state: sanitizePublicState(room) };
  }

  revealAnswers(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room || room.phase !== 'question') return { error: 'Invalid phase' };
    if (!hasPlayers(room)) {
      this.pauseGame(room);
      return { state: sanitizePublicState(room) };
    }

    this.clearTimer(roomCode);
    const q = room.currentQuestion;

    for (const p of room.players) {
      if (p.currentChoice === q.correctIndex) {
        p.score += 1;
        p.lastAnswerCorrect = true;
      } else if (p.hasAnswered) {
        p.lastAnswerCorrect = false;
      } else {
        p.lastAnswerCorrect = null;
      }
    }

    room.phase = 'reveal';
    room.phaseTimeMax = this.revealTimeSec;
    room.timeLeft = this.revealTimeSec;
    room.statusMessage = 'Next round starting soon…';

    this.startTimer(room, () => {
      if (!hasPlayers(room)) {
        this.pauseGame(room);
        return;
      }
      this.advanceAfterReveal(room.code);
    });

    const state = sanitizePublicState(room);
    this.onTick?.(room.code, state);
    return { state };
  }

  advanceAfterReveal(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room || room.phase !== 'reveal') return;
    if (!hasPlayers(room)) {
      this.pauseGame(room);
      return;
    }

    this.clearTimer(roomCode);
    room.currentIndex += 1;

    if (room.currentIndex >= room.totalQuestions) {
      room.phase = 'finished';
      room.statusMessage = null;
      this.emit(room);
      return { state: sanitizePublicState(room) };
    }

    this.beginVoting(room);
    return { state: sanitizePublicState(room) };
  }

  startTimer(room, onExpire) {
    this.clearTimer(room.code);

    const timer = setInterval(() => {
      if (!hasPlayers(room) && isActivePhase(room.phase)) {
        this.clearTimer(room.code);
        this.pauseGame(room);
        return;
      }

      room.timeLeft -= 1;
      this.emit(room);

      if (room.timeLeft <= 0) {
        this.clearTimer(room.code);
        onExpire();
      }
    }, 1000);
    this.timers.set(room.code, timer);
  }

  emit(room) {
    this.onTick?.(room.code, sanitizePublicState(room));
  }

  emitState(result) {
    if (result?.state) {
      this.onTick?.(result.state.roomCode, result.state);
    }
  }

  clearTimer(roomCode) {
    const t = this.timers.get(roomCode);
    if (t) {
      clearInterval(t);
      this.timers.delete(roomCode);
    }
  }
}
