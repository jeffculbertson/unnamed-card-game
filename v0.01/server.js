const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { randomUUID } = require('crypto');

const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');

/**
 * In-memory game store. Keys are game codes, values are game objects:
 * { id, hostId, status, players: [{id, name, position}], hands: {playerId: string[]} }
 */
const games = new Map();

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const { pathname } = parsedUrl;

  try {
    if (pathname.startsWith('/api/')) {
      await handleApi(req, res, parsedUrl);
    } else {
      await serveStatic(req, res, pathname);
    }
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: 'Unexpected server error' });
  }
});

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function notFound(res) {
  res.writeHead(404);
  res.end('Not found');
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error('Payload too large'));
        req.connection.destroy();
      }
    });
    req.on('end', () => {
      try {
        const parsed = data ? JSON.parse(data) : {};
        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    });
  });
}

async function handleApi(req, res, parsedUrl) {
  const { pathname, query } = parsedUrl;

  if (req.method === 'POST' && pathname === '/api/game/create') {
    const body = await readBody(req);
    const name = (body.name || '').trim();
    if (!name) {
      return sendJson(res, 400, { error: 'Name is required' });
    }
    const { game, player } = createGame(name);
    return sendJson(res, 200, { gameId: game.id, playerId: player.id, position: player.position });
  }

  if (req.method === 'POST' && pathname === '/api/game/join') {
    const body = await readBody(req);
    const gameId = (body.gameId || '').toString().trim().toUpperCase();
    const name = (body.name || '').trim();
    const game = games.get(gameId);
    if (!game) {
      return sendJson(res, 404, { error: 'Game not found' });
    }
    if (game.status !== 'lobby') {
      return sendJson(res, 400, { error: 'Game already started' });
    }
    if (!name) {
      return sendJson(res, 400, { error: 'Name is required' });
    }
    if (game.players.length >= 4) {
      return sendJson(res, 400, { error: 'Game is full' });
    }
    const { player } = joinGame(game, name);
    return sendJson(res, 200, { gameId: game.id, playerId: player.id, position: player.position });
  }

  if (req.method === 'POST' && pathname === '/api/game/start') {
    const body = await readBody(req);
    const { gameId, playerId } = body;
    const game = games.get(gameId);
    if (!game) {
      return sendJson(res, 404, { error: 'Game not found' });
    }
    if (game.hostId !== playerId) {
      return sendJson(res, 403, { error: 'Only the host can start the game' });
    }
    if (game.players.length !== 4) {
      return sendJson(res, 400, { error: 'Need exactly 4 players to start' });
    }
    deal(game);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'GET' && pathname === '/api/game/state') {
    const { gameId, playerId } = query;
    const game = games.get(gameId);
    if (!game) {
      return sendJson(res, 404, { error: 'Game not found' });
    }
    if (!game.players.some(p => p.id === playerId)) {
      return sendJson(res, 403, { error: 'You are not part of this game' });
    }
    return sendJson(res, 200, projectGameForPlayer(game, playerId));
  }

  notFound(res);
}

function createGame(name) {
  const gameId = generateCode();
  const player = { id: randomUUID(), name, position: 0 };
  const game = {
    id: gameId,
    hostId: player.id,
    status: 'lobby',
    players: [player],
    hands: {},
    createdAt: Date.now(),
  };
  games.set(gameId, game);
  return { game, player };
}

function joinGame(game, name) {
  const existingPositions = game.players.map(p => p.position);
  const available = [0, 1, 2, 3].find(pos => !existingPositions.includes(pos));
  const player = { id: randomUUID(), name, position: available };
  game.players.push(player);
  return { game, player };
}

function deal(game) {
  const deck = buildDeck();
  shuffle(deck);
  game.hands = {};
  game.players
    .slice()
    .sort((a, b) => a.position - b.position)
    .forEach((player, idx) => {
      const start = idx * 13;
      game.hands[player.id] = deck.slice(start, start + 13);
    });
  game.status = 'started';
}

function buildDeck() {
  const suits = ['S', 'H', 'D', 'C'];
  const ranks = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
  const deck = [];
  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push(`${rank}${suit}`);
    }
  }
  return deck;
}

function shuffle(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function projectGameForPlayer(game, playerId) {
  const playerHand = game.hands[playerId] || [];
  const sortedHand = [...playerHand].sort(cardComparator);
  return {
    gameId: game.id,
    status: game.status,
    hostId: game.hostId,
    players: game.players.map(p => ({
      id: p.id,
      name: p.name,
      position: p.position,
      isHost: p.id === game.hostId,
      isYou: p.id === playerId,
      handSize: game.hands[p.id]?.length || 0,
    })),
    hand: sortedHand,
  };
}

const suitOrder = { S: 0, H: 1, D: 2, C: 3 };
const rankOrder = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];
function cardComparator(a, b) {
  const [rankA, suitA] = splitCard(a);
  const [rankB, suitB] = splitCard(b);
  if (suitA !== suitB) {
    return suitOrder[suitA] - suitOrder[suitB];
  }
  return rankOrder.indexOf(rankA) - rankOrder.indexOf(rankB);
}

function splitCard(card) {
  const suit = card.slice(-1);
  const rank = card.slice(0, -1);
  return [rank, suit];
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i += 1) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  if (games.has(code)) {
    return generateCode();
  }
  return code;
}

async function serveStatic(req, res, pathname) {
  let filePath = path.join(publicDir, pathname);

  if (pathname === '/') {
    filePath = path.join(publicDir, 'index.html');
  }

  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(publicDir)) {
    return notFound(res);
  }

  try {
    const stat = fs.statSync(normalized);
    if (stat.isDirectory()) {
      filePath = path.join(normalized, 'index.html');
    } else {
      filePath = normalized;
    }
  } catch (err) {
    return notFound(res);
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      return notFound(res);
    }
    res.writeHead(200, { 'Content-Type': mimeType });
    res.end(data);
  });
}

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
