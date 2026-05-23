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
  betting: $('screen-betting'),
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
  $('qr-code').innerHTML = `<img src="${dataUrl}" alt="QR code to join">`;
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
        <span class="pts">€${p.score}</span>
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
      ? 'At least one player has joined — start when ready'
      : 'Share the code — players join on their phones';
    renderQr(s.roomCode);
  } else {
    $('lobby-hint').textContent = 'Waiting for the room creator to start the game…';
  }
}

function renderSpectateContent(s) {
  const content = $('spectate-content');
  const q = s.question;

  if (s.phase === 'voting') {
    content.classList.remove('hidden');
    $('spectate-bets').classList.add('hidden');
    $('spectate-meta').innerHTML = `
      <span class="badge">Round ${s.currentIndex + 1}/${s.totalQuestions}</span>
      <span class="badge">${escapeHtml(s.roundDifficulty)} next</span>
    `;
    $('spectate-question').textContent = 'Vote for the next category';
    
    const tally = $('spectate-vote-tally');
    if (s.voteTally?.length) {
      $('spectate-choices').classList.add('hidden');
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
      $('spectate-choices').classList.remove('hidden');
      $('spectate-choices').innerHTML = (s.voteOptions || [])
        .map((opt) => `<div class="choice-display">${escapeHtml(opt.label)}</div>`)
        .join('');
    }
    return;
  }

  if (s.phase === 'betting') {
    content.classList.remove('hidden');
    $('spectate-vote-tally').classList.add('hidden');
    $('spectate-choices').classList.add('hidden');
    $('spectate-meta').innerHTML = `
      <span class="badge">Round ${s.currentIndex + 1}/${s.totalQuestions}</span>
    `;
    $('spectate-question').textContent = 'Players are placing bets!';
    
    // Render all active bets globally
    $('spectate-bets').classList.remove('hidden');
    let allBetsHtml = '';
    for (const p of s.players) {
      if (p.bets) {
        for (const [targetId, bet] of Object.entries(p.bets)) {
          const target = s.players.find(t => t.id === targetId);
          if (target) {
            const betTypeClass = bet.isFor ? 'bet-for' : 'bet-against';
            const betTypeText = bet.isFor ? 'FOR' : 'AGAINST';
            allBetsHtml += `
              <div class="spectate-bet-row">
                <span class="name">${escapeHtml(p.name)}</span> 
                <span class="muted" style="font-size: 0.9rem;">bet</span> 
                <span class="pts">€${bet.amount}</span> 
                <span class="badge ${betTypeClass}">${betTypeText}</span> 
                <span class="name">${escapeHtml(target.name)}</span>
              </div>
            `;
          }
        }
      }
    }
    if (!allBetsHtml) allBetsHtml = '<p class="status-msg">Waiting for bets...</p>';
    $('spectate-bets').innerHTML = allBetsHtml;

    return;
  }

  if ((s.phase === 'question' || s.phase === 'reveal') && q) {
    content.classList.remove('hidden');
    $('spectate-vote-tally').classList.add('hidden');
    $('spectate-bets').classList.add('hidden');
    $('spectate-choices').classList.remove('hidden');
    
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

  const timedPhases = ['voting', 'betting', 'question'];
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

function renderChoices(q, phase, myAnswer, containerId, me) {
  const container = $(containerId);
  container.innerHTML = q.choices
    .map((c, i) => {
      let cls = 'choice-btn';
      if (phase === 'question' && myAnswer === i) cls += ' selected';
      if (phase === 'reveal') {
        if (c.isCorrect) cls += ' correct';
        else if (myAnswer === i) cls += ' incorrect';
      }
      const disabled = phase !== 'question' || (myAnswer !== null && myAnswer !== undefined);
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
    const txt = index === -1 ? 'Question skipped!' : 'Answer locked in!';
    $('answer-status').textContent = txt;
    $('answer-status').classList.remove('hidden');
    renderChoices(state.question, 'question', index, 'choices', state.players.find((p) => p.id === myPlayerId));
    
    $('btn-skip').classList.add('hidden');
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
      $('spectate-bets').classList.add('hidden');
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

  if (s.phase === 'betting') {
    showScreen('betting');
    $('subtitle').textContent = `Room ${s.roomCode}`;
    $('bet-meta').innerHTML = `
      <span class="badge">Round ${s.currentIndex + 1}/${s.totalQuestions}</span>
    `;
    renderTimerBar('bet-timer', s.timeLeft, s.timeMax, timerPhaseKey(s));
    renderScoreboard(s.players, 'bet-scores');

    if (me?.lockedBets) {
      $('bet-controls').classList.add('hidden');
      $('btn-lock-bets').classList.add('hidden');
      $('bet-balance').textContent = 'Waiting for others...';
    } else {
      $('bet-controls').classList.remove('hidden');
      $('btn-lock-bets').classList.remove('hidden');
      $('bet-balance').textContent = `Your Balance: €${me?.score || 0}`;

      const select = $('bet-target');
      const curVal = select.value;
      select.innerHTML = '<option value="">Select Player</option>' + s.players.filter(p => p.id !== me.id).map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
      if (curVal) select.value = curVal;
    }

    // List active bets on the player's personal screen
    const betList = Object.entries(me?.bets || {}).map(([tid, bet]) => {
      const target = s.players.find(p => p.id === tid);
      return `<li>€${bet.amount} ${bet.isFor ? 'FOR' : 'AGAINST'} ${escapeHtml(target?.name || 'Unknown')}</li>`;
    }).join('');
    $('current-bets').innerHTML = betList;

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
        $('btn-skip').classList.remove('hidden');
        $('btn-skip').disabled = false;
      } else if (selectedChoice !== null) {
        $('btn-skip').classList.add('hidden');
        if (selectedChoice !== -1) {
          $('answer-status').textContent = 'Answer locked in!';
          $('answer-status').classList.remove('hidden');
        }
      }
    } else {
      $('answer-status').classList.add('hidden');
      if (me?.skipped) {
        $('btn-skip').classList.remove('hidden');
        $('btn-skip').disabled = true;
        $('btn-skip').classList.add('selected');
        $('btn-skip').textContent = 'You skipped (+€10)';
      } else {
        $('btn-skip').classList.add('hidden');
        $('btn-skip').textContent = 'Skip (Get €10)';
        $('btn-skip').classList.remove('selected');
      }
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

    const myAnswer = isReveal ? me?.currentChoice : selectedChoice;
    renderChoices(q, s.phase, myAnswer, 'choices', me);
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
      ? `You finished #${rank} with €${meFinal.score}`
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

$('btn-skip')?.addEventListener('click', () => {
  submitAnswer(-1);
});

$('btn-place-bet').addEventListener('click', () => {
  const targetId = $('bet-target').value;
  const amount = Number($('bet-amount').value);
  const isFor = $('bet-type').value === 'for';

  if (!targetId || amount < 0) return;
  
  socket.emit('player:bet', { targetId, amount, isFor }, (res) => {
    if (res?.error) alert(res.error);
  });
});

$('btn-lock-bets').addEventListener('click', () => {
  socket.emit('player:lockBets', {}, (res) => {
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