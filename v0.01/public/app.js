const els = {
  gameCode: document.getElementById('gameCode'),
  playerName: document.getElementById('playerName'),
  status: document.getElementById('status'),
  players: document.getElementById('players'),
  startGame: document.getElementById('startGame'),
  message: document.getElementById('message'),
  hand: document.getElementById('hand'),
  seats: {
    north: document.querySelector('[data-seat="north"]'),
    south: document.querySelector('[data-seat="south"]'),
    east: document.querySelector('[data-seat="east"]'),
    west: document.querySelector('[data-seat="west"]'),
  },
  forms: {
    create: document.getElementById('createForm'),
    join: document.getElementById('joinForm'),
  },
  resetSession: document.getElementById('resetSession'),
};

const state = {
  session: loadSession(),
  pollId: null,
  lastGame: null,
};

initialize();

function initialize() {
  els.forms.create.addEventListener('submit', onCreate);
  els.forms.join.addEventListener('submit', onJoin);
  els.startGame.addEventListener('click', onStart);
  els.resetSession.addEventListener('click', clearSession);
  renderSession();
  if (state.session) {
    beginPolling();
  }
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem('card-table-session')) || null;
  } catch (err) {
    return null;
  }
}

function saveSession(session) {
  state.session = session;
  localStorage.setItem('card-table-session', JSON.stringify(session));
  renderSession();
}

function clearSession() {
  state.session = null;
  state.lastGame = null;
  localStorage.removeItem('card-table-session');
  stopPolling();
  renderSession();
  setMessage('Session cleared. Create or join a game to continue.', false);
}

function renderSession() {
  els.gameCode.textContent = state.session?.gameId || '—';
  els.playerName.textContent = state.session?.name || '—';
  els.status.textContent = state.lastGame?.status ? formatStatus(state.lastGame.status) : 'Idle';
  els.hand.innerHTML = '';
  updateSeats([]);
  updatePlayers([]);
  updateStartButton();
}

async function onCreate(event) {
  event.preventDefault();
  const name = event.target.name.value.trim();
  if (!name) {
    return;
  }
  try {
    const res = await fetch('/api/game/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Unable to create game');
    }
    saveSession({ gameId: data.gameId, playerId: data.playerId, name });
    setMessage(`Created game ${data.gameId}. Invite friends with the code.`, false);
    beginPolling();
  } catch (err) {
    setMessage(err.message || 'Problem creating game');
  }
}

async function onJoin(event) {
  event.preventDefault();
  const gameId = event.target.gameId.value.trim().toUpperCase();
  const name = event.target.name.value.trim();
  if (!gameId || !name) {
    return;
  }
  try {
    const res = await fetch('/api/game/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, name }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Unable to join game');
    }
    saveSession({ gameId: data.gameId, playerId: data.playerId, name });
    setMessage(`Joined game ${data.gameId}.`, false);
    beginPolling();
  } catch (err) {
    setMessage(err.message || 'Problem joining game');
  }
}

async function onStart() {
  if (!state.session) return;
  try {
    const res = await fetch('/api/game/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId: state.session.gameId, playerId: state.session.playerId }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Unable to start game');
    }
    setMessage('Cards dealt.', false);
    await pollOnce();
  } catch (err) {
    setMessage(err.message || 'Problem starting game');
  }
}

function beginPolling() {
  stopPolling();
  pollOnce();
  state.pollId = setInterval(pollOnce, 2000);
}

function stopPolling() {
  if (state.pollId) {
    clearInterval(state.pollId);
    state.pollId = null;
  }
}

async function pollOnce() {
  if (!state.session) return;
  try {
    const params = new URLSearchParams({
      gameId: state.session.gameId,
      playerId: state.session.playerId,
    });
    const res = await fetch(`/api/game/state?${params.toString()}`);
    if (res.status === 404) {
      setMessage('Game not found. Reset to start over.');
      stopPolling();
      return;
    }
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Unable to load game state');
    }
    state.lastGame = data;
    renderState(data);
  } catch (err) {
    setMessage(err.message || 'Connection problem');
  }
}

function renderState(game) {
  els.gameCode.textContent = game.gameId;
  els.status.textContent = formatStatus(game.status);
  updatePlayers(game.players);
  updateStartButton(game);
  updateSeats(game.players);
  renderHand(game.hand || []);
}

function updatePlayers(players) {
  if (!players || players.length === 0) {
    els.players.innerHTML = '<li class="muted">No players yet.</li>';
    return;
  }
  els.players.innerHTML = '';
  players
    .slice()
    .sort((a, b) => a.position - b.position)
    .forEach(player => {
      const li = document.createElement('li');
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = player.name || 'Seat';
      const meta = document.createElement('div');
      meta.className = 'muted';
      const role = [];
      role.push(`Seat ${player.position + 1}`);
      if (player.isHost) role.push('Host');
      if (player.isYou) role.push('You');
      meta.textContent = role.join(' • ');
      li.appendChild(name);
      li.appendChild(meta);
      els.players.appendChild(li);
    });
}

function updateStartButton(game) {
  const isHost = !!game?.players?.find(p => p.isHost && p.isYou);
  const ready = game?.players?.length === 4 && game?.status === 'lobby';
  els.startGame.disabled = !(isHost && ready);
}

function updateSeats(players) {
  const you = players.find(p => p.isYou);
  const yourPos = you ? you.position : 0;
  const defaultLabel = 'Waiting…';

  Object.values(els.seats).forEach(seat => {
    seat.querySelector('.seat-name').textContent = defaultLabel;
    seat.querySelector('.seat-cards').innerHTML = '';
  });

  players.forEach(player => {
    const seatName = seatFor(player.position, yourPos);
    const seat = els.seats[seatName];
    if (!seat) return;
    const label = [];
    label.push(player.name || 'Seat');
    if (player.isHost) label.push('(Host)');
    if (player.isYou) label.push('(You)');
    seat.querySelector('.seat-name').textContent = label.join(' ');
    const cards = seat.querySelector('.seat-cards');
    cards.innerHTML = '';
    if (player.isYou) {
      cards.innerHTML = '<span class="muted small">Your hand below</span>';
    } else if (state.lastGame?.status === 'started') {
      for (let i = 0; i < (player.handSize || 0); i += 1) {
        const back = document.createElement('div');
        back.className = 'card-back';
        cards.appendChild(back);
      }
    }
  });
}

function renderHand(cards) {
  els.hand.innerHTML = '';
  if (!cards.length) {
    els.hand.innerHTML = '<span class="muted">Your hand will appear here after the host deals.</span>';
    return;
  }
  cards.forEach(card => {
    const { rank, suitSymbol, color } = parseCard(card);
    const el = document.createElement('div');
    el.className = 'card-face';
    el.innerHTML = `<div>${rank}</div><div class="suit" style="color:${color}">${suitSymbol}</div>`;
    els.hand.appendChild(el);
  });
}

function setMessage(text, isError = true) {
  els.message.textContent = text || '';
  els.message.style.color = isError ? 'var(--danger)' : 'var(--accent)';
}

function formatStatus(status) {
  if (status === 'started') return 'Cards dealt';
  if (status === 'lobby') return 'Lobby';
  return 'Idle';
}

function seatFor(position, you) {
  const relative = (position - you + 4) % 4;
  return ['south', 'west', 'north', 'east'][relative];
}

function parseCard(card) {
  const suit = card.slice(-1);
  const rank = card.slice(0, -1);
  const map = {
    S: { symbol: '♠', color: '#0d1b2c' },
    C: { symbol: '♣', color: '#0d1b2c' },
    H: { symbol: '♥', color: '#c03434' },
    D: { symbol: '♦', color: '#c03434' },
  };
  const suitInfo = map[suit] || { symbol: suit, color: '#0d1b2c' };
  return { rank, suitSymbol: suitInfo.symbol, color: suitInfo.color };
}
