const socket = io();
let myPlayerId = null;
let isOrganizer = false;
let selectedChoice = null;
let selectedCategory = null;
let joinUrl = '';
let avatarDataUrl = null;

let lastPhase = null;
let lastQuestionIndex = null;

const $ = (id) => document.getElementById(id);

const screens = {
  home: $('screen-home'),
  lobby: $('screen-lobby'),
  spectate: $('screen-spectate'),
  waiting: $('screen-waiting'),
  voting: $('screen-voting'),
  category_reveal: $('screen-category-reveal'),
  betting: $('screen-betting'),
  question: $('screen-question'),
  finished: $('screen-finished'),
};

function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.toggle('hidden', key !== name);
  });
  
  // Hide active header on home and lobby
  const isGamePhase = !['home', 'lobby', 'waiting', 'finished'].includes(name);
  $('active-game-header').classList.toggle('hidden', !isGamePhase && name !== 'spectate');
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
function timerPhaseKey(s) { return `${s.phase}-${s.currentIndex}`; }

function renderCircularTimer(timeLeft, timeMax, phaseKey) {
  const timerEl = $('header-timer');
  const valEl = $('header-timer-val');
  
  if (!timeMax || !phaseKey || timeLeft < 0) {
    timerEl.classList.add('hidden');
    return;
  }
  
  timerEl.classList.remove('hidden');
  valEl.textContent = `${timeLeft}s`;
  
  const pct = Math.max(0, timeLeft / timeMax);
  timerEl.style.setProperty('--timer-deg', `${pct * 360}deg`);
  
  if (timeLeft > 0 && timeLeft <= 5) timerEl.classList.add('urgent');
  else timerEl.classList.remove('urgent');
}

function renderChoiceDisplays(choices, reveal = false, allPlayers = []) {
  const prefixes = ['A', 'B', 'C', 'D'];
  return choices.map((c, i) => {
      let cls = 'choice-display';
      if (reveal) {
        if (c.isCorrect) cls += ' correct';
        else cls += ' wrong-highlight';
      }
      
      let avatarsHtml = '';
      if (reveal) {
        const choosers = allPlayers.filter(p => p.currentChoice === i);
        if (choosers.length > 0) {
          avatarsHtml = '<div class="choice-avatars">' + choosers.map(p => {
            const avatarSrc = p.avatar || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%2348bfe3"/></svg>';
            return `<img class="player-avatar" src="${avatarSrc}" title="${escapeHtml(p.name)}">`;
          }).join('') + '</div>';
        }
      }

      return `<div class="${cls}">
        <div style="display:flex; align-items:center; gap:1rem; width:100%;">
          <span class="choice-prefix">${prefixes[i] || ''}</span>
          <span class="choice-text">${escapeHtml(c.text)}</span>
        </div>
        ${avatarsHtml}
      </div>`;
    }).join('');
}

async function loadNetworkInfo() {
  const res = await fetch('/api/network');
  const { port, addresses } = await res.json();
  const host = addresses[0] || window.location.hostname;
  return `${window.location.protocol}//${host}:${port}`;
}

async function renderQr(roomCode) {
  const base = await loadNetworkInfo();
  joinUrl = `${base}/?room=${roomCode}`;
  $('join-url').textContent = joinUrl;
  const res = await fetch(`/api/qr?url=${encodeURIComponent(joinUrl)}`);
  const { dataUrl } = await res.json();
  $('qr-code').innerHTML = `<img src="${dataUrl}" alt="QR code to join">`;
}

// Avatar upload processing
$('join-avatar').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (event) => {
     const img = new Image();
     img.onload = () => {
        const canvas = document.createElement('canvas');
        const size = 120;
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const scale = Math.max(size / img.width, size / img.height);
        const x = (size / scale - img.width) / 2;
        const y = (size / scale - img.height) / 2;
        ctx.scale(scale, scale);
        ctx.drawImage(img, x, y);
        avatarDataUrl = canvas.toDataURL('image/jpeg', 0.8);
     };
     img.src = event.target.result;
  };
  reader.readAsDataURL(file);
});

function renderScoreboard(players, containerId, reveal = false) {
  const sorted = [...players].sort((a, b) => b.score - a.score);
  const top = sorted[0]?.score ?? 0;
  
  const newHtml = sorted.map((p) => {
      const extra = reveal && p.lastAnswerCorrect === true ? ' ✓' : reveal && p.lastAnswerCorrect === false ? ' ✗' : '';
      const leader = p.score === top && top > 0 ? ' leader' : '';
      const isMe = p.id === myPlayerId ? ' (you)' : '';
      const eliminated = p.isEliminated ? ' opacity: 0.5;' : '';
      const avatarSrc = p.avatar || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%2348bfe3"/></svg>';
      
      return `<div class="score-row${leader}" style="${eliminated}">
        <div class="score-player-info">
           <img class="player-avatar" src="${avatarSrc}">
           <span class="name">${escapeHtml(p.name)}${isMe}${extra}</span>
        </div>
        <span class="pts">€${p.score}</span>
      </div>`;
    }).join('');

  const container = $(containerId);
  if (container.innerHTML !== newHtml) container.innerHTML = newHtml;
}

function renderLobby(s) {
  $('room-code').textContent = s.roomCode;
  $('player-count').textContent = s.players.length;

  const list = $('players-list');
  if (!s.players.length) {
    list.innerHTML = '<li class="empty-state">No players yet — share the code</li>';
  } else {
    list.innerHTML = s.players.map((p) => {
      const avatarSrc = p.avatar || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%2348bfe3"/></svg>';
      return `<li><div class="player-name"><img class="player-avatar" style="width:50px;height:50px;margin-right:10px" src="${avatarSrc}">${escapeHtml(p.name)}${p.id === myPlayerId ? ' (you)' : ''}</div></li>`;
    }).join('');
  }

  const isSetupDevice = isOrganizer && !myPlayerId;
  document.querySelector('#screen-lobby .join-panel')?.classList.toggle('hidden', !isSetupDevice);
  $('lobby-host-controls').classList.toggle('hidden', !isSetupDevice);
  
  if (isSetupDevice) {
    $('btn-start').disabled = !s.canStart;
    $('lobby-hint').textContent = s.canStart
      ? 'Players connected. Ready to start!'
      : 'Share the code — players join on their phones';
    renderQr(s.roomCode);
  } else {
    $('lobby-hint').textContent = 'Waiting for the host to start the game…';
  }
}

function renderSpectateContent(s) {
  const content = $('spectate-content');
  const q = s.question;

  if (s.phase === 'voting') {
    content.classList.remove('hidden');
    $('spectate-bets').classList.add('hidden');
    $('spectate-meta').innerHTML = `<span class="badge">${escapeHtml(s.roundDifficulty)} next</span>`;
    $('spectate-question').textContent = 'Vote for the next category';
    
    const tally = $('spectate-vote-tally');
    if (s.voteTally?.length) {
      $('spectate-choices').classList.add('hidden');
      tally.classList.remove('hidden');
      const maxVotes = Math.max(...s.voteTally.map((t) => t.votes));
      tally.innerHTML = s.voteTally.map((t) => {
          const leading = t.votes === maxVotes && maxVotes > 0 ? ' leading' : '';
          return `<div class="tally-row${leading}">
            <span>${escapeHtml(t.label)}</span><span class="tally-votes">${t.votes}</span>
          </div>`;
        }).join('');
    } else {
      tally.classList.add('hidden');
      $('spectate-choices').classList.remove('hidden');
      $('spectate-choices').innerHTML = (s.voteOptions || [])
        .map((opt) => `<div class="choice-display">${escapeHtml(opt.label)}</div>`).join('');
    }
    return;
  }

  if (s.phase === 'category_reveal') {
    content.classList.add('hidden');
    return;
  }

  if (s.phase === 'betting' || s.phase === 'bet_reveal') {
    content.classList.remove('hidden');
    $('spectate-vote-tally').classList.add('hidden');
    $('spectate-choices').classList.add('hidden');
    $('spectate-meta').innerHTML = `<span class="badge">${escapeHtml(s.roundCategory)}</span>`;
    $('spectate-question').textContent = s.phase === 'bet_reveal' ? 'Bets Locked!' : 'Players are placing bets!';
    
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
    if ($('spectate-bets').innerHTML !== allBetsHtml) $('spectate-bets').innerHTML = allBetsHtml;
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
    `;
    $('spectate-question').textContent = q.text;
    $('spectate-choices').className = 'choices-display choices-grid';
    $('spectate-choices').innerHTML = renderChoiceDisplays(q.choices, s.phase === 'reveal', s.players);
    return;
  }

  content.classList.add('hidden');
}

function renderSpectate(s) {
  if (s.phase === 'category_reveal') {
    showScreen('category_reveal');
    $('revealed-category').textContent = s.roundCategory;
  } else {
    showScreen('spectate');
    renderSpectateContent(s);
  }
  
  $('subtitle').textContent = `Room ${s.roomCode}`;
  
  const timedPhases = ['voting', 'betting', 'question'];
  if (timedPhases.includes(s.phase)) {
    renderCircularTimer(s.timeLeft, s.timeMax, timerPhaseKey(s));
  } else {
    $('header-timer').classList.add('hidden');
  }

  const isReveal = s.phase === 'reveal';
  $('spectate-scoreboard-card').classList.toggle('hidden', !isReveal);
  $('spectate-split').classList.toggle('has-sidebar', isReveal);
  if (isReveal) {
    renderScoreboard(s.players, 'spectate-scores', true);
  }
}

function renderVoteOptions(s, me) {
  const container = $('vote-options');
  if (!s.voteOptions) return;

  container.innerHTML = s.voteOptions.map((opt) => {
      let cls = 'choice-btn vote-btn';
      if (selectedCategory === opt.id) cls += ' selected';
      const disabled = s.phase !== 'voting' || me?.hasVoted || me?.isEliminated;
      return `<button class="${cls}" data-id="${opt.id}" ${disabled ? 'disabled' : ''}>${escapeHtml(opt.label)}</button>`;
    }).join('');

  container.querySelectorAll('.vote-btn').forEach((btn) => {
    btn.addEventListener('click', () => submitVote(btn.dataset.id));
  });
}

function submitVote(categoryId) {
  if (selectedCategory !== null) return;
  selectedCategory = categoryId;
  socket.emit('player:vote', { categoryId }, (res) => {
    if (res?.error) { selectedCategory = null; $('vote-status').textContent = res.error; $('vote-status').classList.remove('hidden'); return; }
    $('vote-status').textContent = 'Vote submitted!'; $('vote-status').classList.remove('hidden');
    renderVoteOptions(state, state.players.find((p) => p.id === myPlayerId));
  });
}

function renderChoices(q, phase, myAnswer, containerId, me, allPlayers = []) {
  const container = $(containerId);
  const prefixes = ['A', 'B', 'C', 'D'];
  container.innerHTML = q.choices.map((c, i) => {
      let cls = 'choice-btn';
      if (phase === 'question' && myAnswer === i) cls += ' selected';
      if (phase === 'reveal') {
        if (c.isCorrect) cls += ' correct';
        else if (myAnswer === i) cls += ' incorrect';
      }
      const disabled = phase !== 'question' || (myAnswer !== null && myAnswer !== undefined) || me?.isEliminated;

      let avatarsHtml = '';
      if (phase === 'reveal') {
        const choosers = allPlayers.filter(p => p.currentChoice === i);
        if (choosers.length > 0) {
          avatarsHtml = '<div class="choice-avatars">' + choosers.map(p => {
            const avatarSrc = p.avatar || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%2348bfe3"/></svg>';
            return `<img class="player-avatar" src="${avatarSrc}" title="${escapeHtml(p.name)}">`;
          }).join('') + '</div>';
        }
      }

      return `<button class="${cls}" data-index="${i}" ${disabled ? 'disabled' : ''}>
        <div style="display:flex; align-items:center; gap:1rem; width:100%;">
          <span class="choice-prefix">${prefixes[i] || ''}</span>
          <span class="choice-text">${escapeHtml(c.text)}</span>
        </div>
        ${avatarsHtml}
      </button>`;
    }).join('');

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
    if (res?.error) { selectedChoice = null; $('answer-status').textContent = res.error; $('answer-status').classList.remove('hidden'); return; }
    const txt = index === -1 ? 'Question skipped!' : 'Answer locked in!';
    $('answer-status').textContent = txt; $('answer-status').classList.remove('hidden');
    renderChoices(state.question, 'question', index, 'choices', state.players.find((p) => p.id === myPlayerId), state.players);
    $('btn-skip').classList.add('hidden');
  });
}

// Bet slider dynamic update
const betSlider = $('bet-amount');
const betDisplay = $('bet-amount-display');
betSlider.addEventListener('input', () => {
   betDisplay.textContent = '€' + betSlider.value;
});

let state = null;

function onState(s) {
  // Catch the globally emitted close state to return everything back to home
  if (s && s.phase === 'closed') {
    location.href = '/';
    return;
  }

  state = s;
  const me = s.players.find((p) => p.id === myPlayerId);

  const phaseChanged = lastPhase !== s.phase || lastQuestionIndex !== s.currentIndex;
  lastPhase = s.phase;
  lastQuestionIndex = s.currentIndex;

  // Global header info mapping
  if (s.phase !== 'lobby' && s.phase !== 'home' && s.phase !== 'finished') {
    $('header-q-count').childNodes[0].nodeValue = `Question ${s.currentIndex + 1} / ${s.totalQuestions} `;
    $('tiebreaker-badge').classList.toggle('hidden', !s.tiebreakerMode);
    
    const progressPct = ((s.currentIndex + 1) / s.totalQuestions) * 100;
    $('header-progress-fill').style.width = `${progressPct}%`;
  }

  const timedPhases = ['voting', 'betting', 'question'];
  if (timedPhases.includes(s.phase)) {
    renderCircularTimer(s.timeLeft, s.timeMax, timerPhaseKey(s));
  } else {
    $('header-timer').classList.add('hidden');
  }

  if (isOrganizer && !myPlayerId) {
    if (s.phase === 'lobby') { showScreen('lobby'); $('subtitle').textContent = `Room ${s.roomCode}`; renderLobby(s); return; }
    if (s.phase === 'finished') {
      showScreen('finished');
      $('final-rank').textContent = '';
      $('btn-restart').classList.remove('hidden');
      renderScoreboard(s.players, 'final-scores', false);
      return;
    }
    renderSpectate(s);
    return;
  }

  // Player Auto-scroll logic 
  if (phaseChanged && myPlayerId) {
    setTimeout(() => {
      if (s.phase === 'voting') {
        $('vote-options')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (s.phase === 'question') {
        $('choices')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 150);
  }

  // Player logic follows
  if (s.phase === 'lobby') { showScreen('lobby'); $('subtitle').textContent = `Room ${s.roomCode}`; renderLobby(s); return; }
  
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
    
    // Hide difficulty string, just provide instructions directly
    $('vote-meta').innerHTML = '';
    
    if (me?.isEliminated) {
      $('vote-status').classList.remove('hidden');
      $('vote-status').textContent = 'You are eliminated. Spectating tiebreaker...';
    }
    
    renderVoteOptions(s, me);
    return;
  }

  if (s.phase === 'category_reveal') {
    showScreen('category_reveal');
    $('revealed-category').textContent = s.roundCategory;
    return;
  }

  if (s.phase === 'betting' || s.phase === 'bet_reveal') {
    showScreen('betting');
    $('subtitle').textContent = `Room ${s.roomCode}`;
    $('bet-meta').innerHTML = `<span class="badge">Next: ${escapeHtml(s.roundCategory)}</span>`;

    if (me?.isEliminated) {
      $('bet-controls').classList.add('hidden');
      $('btn-lock-bets').classList.add('hidden');
      $('bet-status').classList.remove('hidden');
      $('bet-status').textContent = 'You are eliminated! Spectating...';
    } else if (me?.score < 10) {
      $('bet-controls').classList.add('hidden');
      $('btn-lock-bets').classList.add('hidden');
      $('bet-status').classList.remove('hidden');
      $('bet-status').innerHTML = 'You are too broke to bet! 😭<br>Waiting for others...';
    } else if (s.phase === 'bet_reveal' || me?.lockedBets) {
      $('bet-controls').classList.add('hidden');
      $('btn-lock-bets').classList.add('hidden');
      $('bet-status').classList.remove('hidden');
      $('bet-status').textContent = s.phase === 'bet_reveal' ? 'All bets locked! Revealing...' : 'Waiting for others...';
    } else {
      $('bet-controls').classList.remove('hidden');
      $('btn-lock-bets').classList.remove('hidden');
      $('bet-status').classList.add('hidden');
      $('bet-balance').textContent = `Your Balance: €${me?.score || 0}`;

      betSlider.max = me.score;
      if (Number(betSlider.value) > me.score) betSlider.value = me.score;
      betDisplay.textContent = '€' + betSlider.value;

      const select = $('bet-target');
      const curVal = select.value;
      const selectHtml = '<option value="">Select Player</option>' + s.players.filter(p => p.id !== me.id).map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
      if (select.innerHTML !== selectHtml) select.innerHTML = selectHtml;
      if (curVal) select.value = curVal;
    }

    const betListHtml = Object.entries(me?.bets || {}).map(([tid, bet]) => {
      const target = s.players.find(p => p.id === tid);
      return `<li>€${bet.amount} ${bet.isFor ? 'FOR' : 'AGAINST'} ${escapeHtml(target?.name || 'Unknown')}</li>`;
    }).join('');
    if ($('current-bets').innerHTML !== betListHtml) $('current-bets').innerHTML = betListHtml;
    return;
  }

  if (s.phase === 'question' || s.phase === 'reveal') {
    showScreen('question');
    $('subtitle').textContent = `Room ${s.roomCode}`;
    const q = s.question;
    if (!q) return;

    // IMPORTANT: Keep question text hidden on the player screen to encourage looking at the main screen.
    $('q-text').classList.add('hidden');

    const isReveal = s.phase === 'reveal';

    // Enable Split layout right sidebar scoreboard for players during reveal
    $('question-scoreboard-card').classList.toggle('hidden', !isReveal);
    $('question-split').classList.toggle('has-sidebar', isReveal);
    if (isReveal) {
      renderScoreboard(s.players, 'question-scores', true);
    }

    if (!isReveal) {
      if (me?.isEliminated) {
        $('answer-status').textContent = 'Spectating...';
        $('answer-status').classList.remove('hidden');
        $('btn-skip').classList.add('hidden');
      } else if (!me?.hasAnswered) {
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
      if (me?.isEliminated) {
        $('btn-skip').classList.add('hidden');
      } else if (me?.skipped) {
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

    if (isReveal) {
      $('q-meta').innerHTML = `
        <span class="badge">${escapeHtml(q.category)}</span>
        <span class="badge">${escapeHtml(q.difficulty)}</span>
      `;
    } else {
      $('q-meta').innerHTML = `<span class="badge" style="border: none; background: rgba(255,255,255,0.1); color: var(--accent2); font-size: 1.1rem; padding: 0.5rem 1rem;">Pick your answer</span>`;
    }

    const myAnswer = isReveal ? me?.currentChoice : selectedChoice;
    renderChoices(q, s.phase, myAnswer, 'choices', me, s.players);
    if (isReveal) selectedChoice = null;
    return;
  }

  if (s.phase === 'finished') {
    showScreen('finished');
    const sorted = [...s.players].sort((a, b) => b.score - a.score);
    const rank = sorted.findIndex((p) => p.id === myPlayerId) + 1;
    const meFinal = s.players.find((p) => p.id === myPlayerId);
    $('final-rank').textContent = meFinal ? `You finished #${rank} with €${meFinal.score}` : 'Game over';
    $('btn-restart').classList.add('hidden'); // Players don't restart, only host
    
    renderScoreboard(s.players, 'final-scores', false);
  }
}

socket.on('game:state', onState);

$('btn-create').addEventListener('click', () => {
  showFieldError('create-error', '');
  socket.emit('room:create', {}, (res) => {
    if (res?.error) { showFieldError('create-error', res.error); return; }
    isOrganizer = true; myPlayerId = null; onState(res.state);
  });
});

$('btn-join').addEventListener('click', () => {
  const roomCode = $('room-input').value.trim().toUpperCase();
  const name = $('join-name').value.trim();
  showFieldError('join-error', '');
  socket.emit('room:join', { roomCode, name, avatar: avatarDataUrl }, (res) => {
    if (res?.error) { showFieldError('join-error', res.error); return; }
    isOrganizer = false; myPlayerId = res.playerId; onState(res.state);
  });
});

$('btn-start')?.addEventListener('click', () => {
  $('btn-start').disabled = true;
  const tq = Number($('game-length').value) || 10;
  socket.emit('room:start', { totalQuestions: tq }, (res) => {
    $('btn-start').disabled = false;
    if (res?.error) alert(res.error);
  });
});

$('btn-restart')?.addEventListener('click', () => {
  $('btn-restart').disabled = true;
  socket.emit('room:restart', (res) => {
    $('btn-restart').disabled = false;
    if (res?.error) alert(res.error);
  });
});

$('btn-skip')?.addEventListener('click', () => { submitAnswer(-1); });

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