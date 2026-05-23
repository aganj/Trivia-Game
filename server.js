import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import { GameManager } from './game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const QUESTIONS_PER_GAME = Number(process.env.QUESTIONS_PER_GAME) || 10;
const ANSWER_TIME_SEC = Number(process.env.ANSWER_TIME_SEC) || 20;
const VOTE_TIME_SEC = Number(process.env.VOTE_TIME_SEC) || 15;
const CATEGORY_REVEAL_TIME_SEC = 3; // Time to show the chosen category
const REVEAL_TIME_SEC = Number(process.env.REVEAL_TIME_SEC) || 6;
const BET_TIME_SEC = Number(process.env.BET_TIME_SEC) || 30;
const BET_REVEAL_TIME_SEC = 5;
const MIN_PLAYERS = 1;

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
const games = new GameManager({
  questionsPerGame: QUESTIONS_PER_GAME,
  answerTimeSec: ANSWER_TIME_SEC,
  voteTimeSec: VOTE_TIME_SEC,
  categoryRevealTimeSec: CATEGORY_REVEAL_TIME_SEC,
  revealTimeSec: REVEAL_TIME_SEC,
  betTimeSec: BET_TIME_SEC,
  betRevealTimeSec: BET_REVEAL_TIME_SEC,
  minPlayers: MIN_PLAYERS,
  apiKey: process.env.TRIVIA_API_KEY,
  onTick: (roomCode, state) => {
    if (state) io.to(roomCode).emit('game:state', state);
  },
});

app.use(express.static(path.join(__dirname, 'public')));

function getLocalAddresses() {
  const addresses = [];
  for (const nets of Object.values(os.networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

app.get('/api/network', (_req, res) => {
  res.json({
    port: PORT,
    addresses: getLocalAddresses(),
  });
});

app.get('/api/qr', async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    res.status(400).json({ error: 'url required' });
    return;
  }
  try {
    const dataUrl = await QRCode.toDataURL(url, { margin: 2, width: 280 });
    res.json({ dataUrl });
  } catch {
    res.status(500).json({ error: 'Failed to generate QR' });
  }
});

io.on('connection', (socket) => {
  socket.on('room:create', (_payload, cb) => {
    const result = games.createRoom(socket.id);
    if (result.error) return cb?.({ error: result.error });
    socket.join(result.roomCode);
    socket.data.roomCode = result.roomCode;
    socket.data.isOrganizer = true;
    cb?.({ roomCode: result.roomCode, state: result.state });
  });

  socket.on('room:join', ({ roomCode, name, avatar }, cb) => {
    const result = games.joinRoom(roomCode, socket.id, name, avatar);
    if (result.error) return cb?.({ error: result.error });
    socket.join(result.roomCode);
    socket.data.roomCode = result.roomCode;
    socket.data.playerId = result.playerId;
    io.to(result.roomCode).emit('game:state', result.state);
    cb?.({ playerId: result.playerId, state: result.state });
  });

  socket.on('room:start', ({ totalQuestions }, cb) => {
    const roomCode = socket.data.roomCode;
    if (!roomCode || !socket.data.isOrganizer) {
      return cb?.({ error: 'Only the device that created the room can start the game' });
    }
    const result = games.startGame(roomCode, socket.id, { asOrganizer: true, totalQuestions });
    if (result.error) return cb?.({ error: result.error });
    io.to(roomCode).emit('game:state', result.state);
    cb?.({ ok: true });
  });

  socket.on('room:restart', (cb) => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return cb?.({ error: 'Not in a game' });
    const result = games.restartRoom(roomCode, socket.id);
    if (result.error) return cb?.({ error: result.error });
    io.to(roomCode).emit('game:state', result.state);
    cb?.({ ok: true });
  });

  socket.on('player:vote', ({ categoryId }, cb) => {
    const roomCode = socket.data.roomCode;
    const playerId = socket.data.playerId;
    if (!roomCode || !playerId) return cb?.({ error: 'Not in a game' });
    const result = games.submitVote(roomCode, playerId, categoryId);
    if (result.error) return cb?.({ error: result.error });
    io.to(roomCode).emit('game:state', result.state);
    cb?.({ ok: true });
  });

  socket.on('player:bet', ({ targetId, amount, isFor }, cb) => {
    const roomCode = socket.data.roomCode;
    const playerId = socket.data.playerId;
    if (!roomCode || !playerId) return cb?.({ error: 'Not in a game' });
    const result = games.submitBet(roomCode, playerId, targetId, amount, isFor);
    if (result.error) return cb?.({ error: result.error });
    io.to(roomCode).emit('game:state', result.state);
    cb?.({ ok: true });
  });

  socket.on('player:lockBets', (_payload, cb) => {
    const roomCode = socket.data.roomCode;
    const playerId = socket.data.playerId;
    if (!roomCode || !playerId) return cb?.({ error: 'Not in a game' });
    const result = games.lockBets(roomCode, playerId);
    if (result.error) return cb?.({ error: result.error });
    io.to(roomCode).emit('game:state', result.state);
    cb?.({ ok: true });
  });

  socket.on('player:answer', ({ choiceIndex }, cb) => {
    const roomCode = socket.data.roomCode;
    const playerId = socket.data.playerId;
    if (!roomCode || !playerId) return cb?.({ error: 'Not in a game' });
    const result = games.submitAnswer(roomCode, playerId, choiceIndex);
    if (result.error) return cb?.({ error: result.error });
    io.to(roomCode).emit('game:state', result.state);
    cb?.({ ok: true });
  });

  socket.on('disconnect', () => {
    const roomCode = socket.data.roomCode;
    if (!roomCode) return;
    if (socket.data.isOrganizer) return;
    const playerId = socket.data.playerId;
    if (!playerId) return;

    const result = games.removePlayer(roomCode, playerId);
    if (result.roomDeleted) return;
    if (result.state) {
      io.to(roomCode).emit('game:state', result.state);
    }
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  const addrs = getLocalAddresses();
  console.log(`\n  Trivia Game running!\n`);
  console.log(`  Open on phones:   http://localhost:${PORT}`);
  if (addrs.length) {
    for (const addr of addrs) {
      console.log(`                    http://${addr}:${PORT}`);
    }
  }
  console.log('');
});