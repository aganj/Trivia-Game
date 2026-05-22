const socket = io();
let myPlayerId = null;
let isOrganizer = false;
let selectedChoice = null;
let selectedCategory = null;
let joinUrl = '';

const $ = (id) => document.getElementById(id);

const screens = {
  home: $('screen-home'),
  lobby: $('screen-lobby'),
  spectate: $('screen-spectate'),
  waiting: $('screen-waiting'),
  voting: $('screen-voting'),
  question: $('screen-question'),
  finished: $('screen-finished'),
};

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.toggle('hidden', key !== name);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showFieldError(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.classList.toggle('hidden', !msg);
}

const timerPhaseKeys = {};

function timerPhaseKey(s) {
  return `${s.phase}-${s.currentIndex}`;
}

function renderTimerBar(barId, timeLeft, timeMax, phaseKey) {
  if (!timeMax || !phaseKey) return;

  const bar = $(barId);
  const fill = bar.querySelector('.timer-bar-fill');

  if (timerPhaseKeys[barId] !== phaseKey) {
    timerPhaseKeys[barId] = phaseKey;
    fill.style.animation = 'none';
    void fill.offsetWidth;
    fill.style.width = '100%';
    const elapsed = Math.max(0, timeMax - timeLeft);
    fill.style.animation = `timer-shrink ${timeMax}s linear forwards`;
    fill.style.animationDelay = elapsed > 0 ? `-${elapsed}s` : '0s';
  }

  bar.classList.toggle('urgent', timeLeft > 0 && timeLeft <= 5);
}

function renderChoiceDisplays(choices, reveal = false) {
  return choices
    .map((c) => {
      let cls = 'choice-display';
      if (reveal) {
        if (c.isCorrect) cls += ' correct';
        else cls += ' wrong-highlight';
      }
      return `<div class="${cls}">${escapeHtml(c.text)}</div>`;
    })
    .join('');
}

async function loadNetworkInfo() {
  const res = await fetch('/api/network');
  const { port, addresses } = await res.json();
  const host = addresses[0] || window.location.hostname;
  const proto = window.location.protocol;
  return `${proto}//${host}:${port}`;
}

async function renderQr(roomCode) {
  const base = await loadNetworkInfo();
  joinUrl = `${base}/?room=${roomCode}`;
  $('join-url').textContent = joinUrl;

  const res = await fetch(`/api/qr?url=${encodeURIComponent(joinUrl)}`);
  const { dataUrl } = await res.json();
  $('qr-code').innerHTML = `<img src="${dataUrl}" alt="QR code to join" width="200" height="200">`;
}

function renderScoreboard(players, containerId, reveal = false) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const top = sorted[0]?.score ?? 0;
  $(containerId).innerHTML = sorted
    .map((p) => {
      const extra =
        reveal && p.lastAnswerCorrect === true
          ? ' ✓'
          : reveal && p.lastAnswerCorrect === false
            ? ' ✗'
            : '';
      const leader = p.score === top && top > 0 ? ' leader' : '';
      const isMe = p.id === myPlayerId ? ' (you)' : '';
      return `<div class="score-row${leader}">
        <span class="name">${escapeHtml(p.name)}${isMe}${extra}</span>
        <span class="pts">${p.score}</span>
      </div>`;
    })
    .join('');
}

function renderLobby(s) {
  $('room-code').textContent = s.roomCode;
  $('player-count').textContent = s.players.length;

  const list = $('players-list');
  if (!s.players.length) {
    list.innerHTML = '<li class="empty-state">No players yet — share the code</li>';
  } else {
    list.innerHTML = s.players
      .map(
        (p) =>
          `<li><span class="player-name"><span class="player-dot"></span>${escapeHtml(p.name)}${p.id === myPlayerId ? ' (you)' : ''}</span></li>`,
      )
      .join('');
  }

  const isSetupDevice = isOrganizer && !myPlayerId;
  document.querySelector('#screen-lobby .join-panel')?.classList.toggle('hidden', !isSetupDevice);
  $('btn-start').classList.toggle('hidden', !(isSetupDevice && s.canStart));

  if (isSetupDevice) {
    $('lobby-hint').textContent = s.canStart
      ? 'At least one player has joined — start when ready (you play on another phone)'
      : 'Share the code — players join on their phones';
    renderQr(s.roomCode);
  } else {
    $('lobby-hint').textContent = 'Waiting for the room creator to start the game…';
  }
}

function renderSpectateContent(s) {
  const content = $('spectate-content');
  const q = s.question;
  const phaseKey = timerPhaseKey(s);

  if (s.phase === 'voting') {
    content.classList.remove('hidden');
    $('spectate-meta').innerHTML = `
      <span class="badge">Round ${s.currentIndex + 1}/${s.totalQuestions}</span>
      <span class="badge">${escapeHtml(s.roundDifficulty)} next</span>
    `;
    $('spectate-question').textContent = 'Vote for the next category';
    $('spectate-choices').innerHTML = (s.voteOptions || [])
      .map((opt) => `<div class="choice-display">${escapeHtml(opt.label)}</div>`)
      .join('');

    const tally = $('spectate-vote-tally');
    if (s.voteTally?.length) {
      tally.classList.remove('hidden');
      const maxVotes = Math.max(...s.voteTally.map((t) => t.votes));
      tally.innerHTML = s.voteTally
        .map((t) => {
          const leading = t.votes === maxVotes && maxVotes > 0 ? ' leading' : '';
          return `<div class="tally-row${leading}">
            <span>${escapeHtml(t.label)}</span>
            <span class="tally-votes">${t.votes}</span>
          </div>`;
        })
        .join('');
    } else {
      tally.classList.add('hidden');
    }
    return;
  }

  if ((s.phase === 'question' || s.phase === 'reveal') && q) {
    content.classList.remove('hidden');
    $('spectate-vote-tally').classList.add('hidden');
    $('spectate-meta').innerHTML = `
      <span class="badge">${escapeHtml(q.category)}</span>
      <span class="badge">${escapeHtml(q.difficulty)}</span>
      <span class="badge">Round ${s.currentIndex + 1}/${s.totalQuestions}</span>
    `;
    $('spectate-question').textContent = q.text;
    $('spectate-choices').innerHTML = renderChoiceDisplays(q.choices, s.phase === 'reveal');
    return;
  }

  content.classList.add('hidden');
}

function renderSpectate(s) {
  showScreen('spectate');
  $('subtitle').textContent = `Room ${s.roomCode}`;

  const timedPhases = ['voting', 'question'];
  const phaseKey = timerPhaseKey(s);
  if (timedPhases.includes(s.phase) && s.timeMax) {
    $('spectate-timer').classList.remove('hidden');
    renderTimerBar('spectate-timer', s.timeLeft, s.timeMax, phaseKey);
  } else {
    $('spectate-timer').classList.add('hidden');
  }

  renderSpectateContent(s);
  renderScoreboard(s.players, 'spectate-scores', s.phase === 'reveal');
}

function renderVoteOptions(s, me) {
  const container = $('vote-options');
  if (!s.voteOptions) return;

  container.innerHTML = s.voteOptions
    .map((opt) => {
      let cls = 'choice-btn vote-btn';
      if (selectedCategory === opt.id) cls += ' selected';
      const disabled = s.phase !== 'voting' || me?.hasVoted;
      return `<button class="${cls}" data-id="${opt.id}" ${disabled ? 'disabled' : ''}>${escapeHtml(opt.label)}</button>`;
    })
    .join('');

  container.querySelectorAll('.vote-btn').forEach((btn) => {
    btn.addEventListener('click', () => submitVote(btn.dataset.id));
  });
}

function submitVote(categoryId) {
  if (selectedCategory !== null) return;
  selectedCategory = categoryId;

  socket.emit('player:vote', { categoryId }, (res) => {
    if (res?.error) {
      selectedCategory = null;
      $('vote-status').textContent = res.error;
      $('vote-status').classList.remove('hidden');
      return;
    }
    $('vote-status').textContent = 'Vote submitted!';
    $('vote-status').classList.remove('hidden');
    renderVoteOptions(state, state.players.find((p) => p.id === myPlayerId));
  });
}

function renderChoices(q, phase, myAnswer, containerId) {
  const container = $(containerId);
  container.innerHTML = q.choices
    .map((c, i) => {
      let cls = 'choice-btn';
      if (phase === 'question' && selectedChoice === i) cls += ' selected';
      if (phase === 'reveal') {
        if (c.isCorrect) cls += ' correct';
        else if (myAnswer === i) cls += ' incorrect';
      }
      const disabled = phase !== 'question' || selectedChoice !== null;
      return `<button class="${cls}" data-index="${i}" ${disabled ? 'disabled' : ''}>${escapeHtml(c.text)}</button>`;
    })
    .join('');

  if (phase === 'question') {
    container.querySelectorAll('.choice-btn').forEach((btn) => {
      btn.addEventListener('click', () => submitAnswer(Number(btn.dataset.index)));
    });
  }
}

function submitAnswer(index) {
  if (selectedChoice !== null) return;
  selectedChoice = index;
  socket.emit('player:answer', { choiceIndex: index }, (res) => {
    if (res?.error) {
      selectedChoice = null;
      $('answer-status').textContent = res.error;
      $('answer-status').classList.remove('hidden');
      return;
    }
    $('answer-status').textContent = 'Answer locked in!';
    $('answer-status').classList.remove('hidden');
    renderChoices(state.question, 'question', index, 'choices');
  });
}

let state = null;

function onState(s) {
  state = s;
  const me = s.players.find((p) => p.id === myPlayerId);

  if (isOrganizer && !myPlayerId) {
    if (s.phase === 'lobby') {
      showScreen('lobby');
      $('subtitle').textContent = `Room ${s.roomCode}`;
      renderLobby(s);
      return;
    }
    if (s.phase === 'finished') {
      showScreen('spectate');
      $('spectate-timer').classList.add('hidden');
      $('spectate-content').classList.remove('hidden');
      $('spectate-vote-tally').classList.add('hidden');
      $('spectate-meta').innerHTML = '';
      $('spectate-question').textContent = 'Game over';
      $('spectate-choices').innerHTML = '';
      renderScoreboard(s.players, 'spectate-scores');
      return;
    }
    renderSpectate(s);
    return;
  }

  if (s.phase === 'lobby') {
    showScreen('lobby');
    $('subtitle').textContent = `Room ${s.roomCode}`;
    renderLobby(s);
    return;
  }

  if (s.phase === 'paused') {
    showScreen('waiting');
    $('waiting-msg').textContent = s.statusMessage || 'Game paused';
    $('waiting-name').textContent = me ? `Playing as ${me.name}` : '';
    $('subtitle').textContent = `Room ${s.roomCode} — rejoin with code to continue`;
    return;
  }

  if (s.phase === 'voting') {
    showScreen('voting');
    $('subtitle').textContent = `Room ${s.roomCode}`;

    if (!me?.hasVoted) {
      selectedCategory = null;
      $('vote-status').classList.add('hidden');
    }

    $('vote-meta').innerHTML = `
      <span class="badge">Round ${s.currentIndex + 1}/${s.totalQuestions}</span>
      <span class="badge">${escapeHtml(s.roundDifficulty)} next</span>
    `;
    $('vote-prompt').textContent = 'Vote for the next category';
    renderTimerBar('vote-timer', s.timeLeft, s.timeMax, timerPhaseKey(s));

    renderVoteOptions(s, me);
    renderScoreboard(s.players, 'vote-scores');
    return;
  }

  if (s.phase === 'question' || s.phase === 'reveal') {
    showScreen('question');
    $('subtitle').textContent = `Room ${s.roomCode}`;
    const q = s.question;
    if (!q) return;

    const isReveal = s.phase === 'reveal';

    if (!isReveal) {
      if (!me?.hasAnswered) {
        selectedChoice = null;
        $('answer-status').classList.add('hidden');
      } else if (selectedChoice !== null) {
        $('answer-status').textContent = 'Answer locked in!';
        $('answer-status').classList.remove('hidden');
      }
    } else {
      $('answer-status').classList.add('hidden');
    }

    $('q-meta').innerHTML = `
      <span class="badge">${escapeHtml(q.category)}</span>
      <span class="badge">${escapeHtml(q.difficulty)}</span>
      <span class="badge">Round ${s.currentIndex + 1}/${s.totalQuestions}</span>
    `;
    $('q-text').textContent = q.text;

    $('q-timer').classList.toggle('hidden', isReveal);
    if (!isReveal) {
      renderTimerBar('q-timer', s.timeLeft, s.timeMax, timerPhaseKey(s));
    }

    const myAnswer = isReveal && me?.hasAnswered ? selectedChoice : me?.hasAnswered ? selectedChoice : null;
    renderChoices(q, s.phase, myAnswer, 'choices');
    renderScoreboard(s.players, 'question-scores', isReveal);

    if (isReveal) {
      selectedChoice = null;
    }
    return;
  }

  if (s.phase === 'finished') {
    showScreen('finished');
    const sorted = [...s.players].sort((a, b) => b.score - a.score);
    const rank = sorted.findIndex((p) => p.id === myPlayerId) + 1;
    const meFinal = s.players.find((p) => p.id === myPlayerId);
    $('final-rank').textContent = meFinal
      ? `You finished #${rank} with ${meFinal.score} points`
      : 'Game over';
    renderScoreboard(s.players, 'final-scores');
  }
}

socket.on('game:state', onState);

$('btn-create').addEventListener('click', () => {
  showFieldError('create-error', '');

  socket.emit('room:create', {}, (res) => {
    if (res?.error) {
      showFieldError('create-error', res.error);
      return;
    }
    isOrganizer = true;
    myPlayerId = null;
    onState(res.state);
  });
});

$('btn-join').addEventListener('click', () => {
  const roomCode = $('room-input').value.trim().toUpperCase();
  const name = $('join-name').value.trim();
  showFieldError('join-error', '');

  socket.emit('room:join', { roomCode, name }, (res) => {
    if (res?.error) {
      showFieldError('join-error', res.error);
      return;
    }
    isOrganizer = false;
    myPlayerId = res.playerId;
    onState(res.state);
  });
});

$('btn-start').addEventListener('click', () => {
  $('btn-start').disabled = true;
  socket.emit('room:start', (res) => {
    $('btn-start').disabled = false;
    if (res?.error) alert(res.error);
  });
});

$('btn-new-game').addEventListener('click', () => {
  location.href = '/';
});

const params = new URLSearchParams(location.search);
const roomFromUrl = params.get('room');
if (roomFromUrl) {
  const code = roomFromUrl.toUpperCase().slice(0, 4);
  $('room-input').value = code;
  $('home-create-card').classList.add('hidden');
  $('subtitle').textContent = `Join room ${code}`;
} else {
  $('subtitle').textContent = 'Create or join a room';
}
