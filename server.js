
Claude
Server · JS
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
 
const app = express();
const server = http.createServer(app);
const io = new Server(server);
 
// ---------------------------------------------------------------------------
// Fichiers statiques (on n'expose que les 3 fichiers du client)
// ---------------------------------------------------------------------------
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/style.css', (req, res) => res.sendFile(path.join(__dirname, 'style.css')));
app.get('/script.js', (req, res) => res.sendFile(path.join(__dirname, 'script.js')));
 
// ---------------------------------------------------------------------------
// Constantes
// ---------------------------------------------------------------------------
const MAX_PLAYERS = 8;
const MIN_PLAYERS = 2;
const GRID_SIZE = 12; // 3 lignes x 4 colonnes
const COLS = 4;
const ROWS = 3;
const BOT_DELAY_MS = 15000;      // délai avant auto-jeu d'un joueur déconnecté
const LOBBY_GRACE_MS = 6000;     // délai avant retrait d'un joueur déconnecté du salon
const EMPTY_ROOM_MS = 120000;    // suppression d'un salon sans connexion
 
// Composition du paquet (cartes -4, 13 et 20 en plus du jeu classique)
const CARD_COUNTS = { '-4': 3, '-2': 5, '-1': 10, '0': 15, '13': 5, '20': 2 };
for (let v = 1; v <= 12; v++) CARD_COUNTS[String(v)] = 10;
 
const GAME_NAMES = [
  'La Bataille des As',
  "Le Duel de l'Extrême",
  'Partie Légendaire #',
  'Le Grand Chelem',
  'La Revanche des Cartes Cachées',
  'Le Tournoi du Siècle',
  'Skyjo Mania #',
  'Le Choc des Titans',
  'La Course aux Points Négatifs',
  "L'Épopée des Colonnes",
  'Le Défi du Glaçon',
  'Partie Endiablée #',
  'La Guerre des Glaciers',
  'Le Sommet des Stratèges',
  'Le Combat des Cartes #'
];
 
// ---------------------------------------------------------------------------
// État global : rooms[code]
// Toutes les données de joueurs sont indexées par PSEUDO (username),
// jamais par socket.id.
// ---------------------------------------------------------------------------
const rooms = {};
 
function makeRoom(code, host) {
  return {
    code,
    host,                 // username de l'hôte
    phase: 'lobby',       // lobby | init | playing | ended
    gameName: '',
    players: [],          // usernames dans l'ordre de jeu
    sockets: {},          // sockets[username] = socket.id courant (ou absent si déconnecté)
    playersGrids: {},     // playersGrids[username] = [{value, revealed, removed} x12]
    initRevealedCount: {},// initRevealedCount[username] = nb de cartes retournées à l'init
    deck: [],
    discard: [],
    turnIndex: 0,
    turnPhase: 'draw',    // draw | place | placeOnly | flip
    drawnCard: null,
    scores: null,
    finisher: null,
    lastEvent: '',
    botTimer: null,
    cleanupTimer: null
  };
}
 
// ---------------------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------------------
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
 
function buildDeck() {
  const deck = [];
  for (const [val, count] of Object.entries(CARD_COUNTS)) {
    for (let i = 0; i < count; i++) deck.push(Number(val));
  }
  return shuffle(deck);
}
 
function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 200; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
    if (!rooms[code]) return code;
  }
  return null;
}
 
function randomGameName() {
  const base = GAME_NAMES[Math.floor(Math.random() * GAME_NAMES.length)];
  if (base.endsWith('#')) return base + (1 + Math.floor(Math.random() * 99));
  return base;
}
 
function cleanName(name) {
  return String(name || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
}
 
function isValidIndex(i) {
  return Number.isInteger(i) && i >= 0 && i < GRID_SIZE;
}
 
function connectedCount(room) {
  return room.players.filter(u => room.sockets[u]).length;
}
 
// ---------------------------------------------------------------------------
// Vue envoyée aux clients (les valeurs des cartes cachées ne sortent jamais)
// ---------------------------------------------------------------------------
function visibleScore(grid) {
  if (!grid) return 0;
  return grid.reduce((s, c) => (c.revealed && !c.removed ? s + c.value : s), 0);
}
 
function viewFor(room, me) {
  const cur = room.phase === 'playing' ? room.players[room.turnIndex] : null;
  return {
    code: room.code,
    phase: room.phase,
    gameName: room.gameName,
    host: room.host,
    me,
    players: room.players.map(u => {
      const grid = room.playersGrids[u] || null;
      return {
        name: u,
        connected: !!room.sockets[u],
        isHost: u === room.host,
        initCount: room.initRevealedCount[u] || 0,
        visibleScore: visibleScore(grid),
        grid: grid
          ? grid.map(c => ({
              revealed: c.revealed,
              removed: c.removed,
              value: c.revealed && !c.removed ? c.value : null
            }))
          : null
      };
    }),
    currentPlayer: cur,
    turnPhase: room.turnPhase,
    drawnCard: cur === me ? room.drawnCard : null,
    discardTop: room.discard.length ? room.discard[room.discard.length - 1] : null,
    deckCount: room.deck.length,
    lastEvent: room.lastEvent,
    scores: room.scores,
    finisher: room.finisher
  };
}
 
function broadcast(room) {
  for (const u of room.players) {
    const sid = room.sockets[u];
    if (sid) io.to(sid).emit('state', viewFor(room, u));
  }
  scheduleBot(room);
}
 
function toast(socket, msg, type = 'error') {
  socket.emit('toast', { type, msg });
}
 
// ---------------------------------------------------------------------------
// Logique de jeu
// ---------------------------------------------------------------------------
function startGame(room) {
  room.phase = 'init';
  room.gameName = randomGameName();
  room.deck = buildDeck();
  room.discard = [];
  room.playersGrids = {};
  room.initRevealedCount = {};
  room.scores = null;
  room.finisher = null;
  room.drawnCard = null;
  room.turnPhase = 'draw';
  room.turnIndex = 0;
 
  for (const u of room.players) {
    const grid = [];
    for (let i = 0; i < GRID_SIZE; i++) {
      grid.push({ value: room.deck.pop(), revealed: false, removed: false });
    }
    room.playersGrids[u] = grid;
    room.initRevealedCount[u] = 0;
  }
  room.discard.push(room.deck.pop());
  room.lastEvent = `Début de « ${room.gameName} » ! Chacun retourne 2 cartes.`;
}
 
function backToLobby(room, msg) {
  room.phase = 'lobby';
  room.playersGrids = {};
  room.initRevealedCount = {};
  room.deck = [];
  room.discard = [];
  room.drawnCard = null;
  room.turnPhase = 'draw';
  room.turnIndex = 0;
  room.scores = null;
  room.finisher = null;
  room.gameName = '';
  room.lastEvent = msg || '';
}
 
function checkInitDone(room) {
  if (room.phase !== 'init') return;
  const allReady = room.players.every(u => (room.initRevealedCount[u] || 0) >= 2);
  if (!allReady) return;
 
  // Le joueur ayant la plus grande somme de cartes visibles commence
  let best = -Infinity;
  let bestIdx = 0;
  room.players.forEach((u, i) => {
    const s = visibleScore(room.playersGrids[u]);
    if (s > best) { best = s; bestIdx = i; }
  });
  room.turnIndex = bestIdx;
  room.turnPhase = 'draw';
  room.phase = 'playing';
  room.lastEvent = `${room.players[bestIdx]} commence (plus grosse somme visible : ${best}).`;
}
 
function ensureDeck(room) {
  if (room.deck.length > 0) return true;
  if (room.discard.length <= 1) return false;
  const top = room.discard.pop();
  room.deck = shuffle(room.discard);
  room.discard = [top];
  room.lastEvent = 'La pioche est vide : la défausse est mélangée.';
  return room.deck.length > 0;
}
 
// Élimine les colonnes de 3 cartes identiques visibles
function checkColumns(room, username) {
  const grid = room.playersGrids[username];
  for (let c = 0; c < COLS; c++) {
    const idx = [];
    for (let r = 0; r < ROWS; r++) idx.push(r * COLS + c);
    const cells = idx.map(i => grid[i]);
    if (cells.every(x => x.revealed && !x.removed) &&
        cells[0].value === cells[1].value && cells[1].value === cells[2].value) {
      const v = cells[0].value;
      cells.forEach(x => { x.removed = true; room.discard.push(x.value); });
      room.lastEvent = `Colonne de ${v} éliminée chez ${username} !`;
    }
  }
}
 
function allDone(grid) {
  return grid.every(c => c.revealed || c.removed);
}
 
function endRound(room, finisher) {
  room.phase = 'ended';
  room.finisher = finisher;
  room.drawnCard = null;
  room.turnPhase = 'draw';
  const scores = [];
  for (const u of room.players) {
    const grid = room.playersGrids[u];
    grid.forEach(c => { if (!c.removed) c.revealed = true; });
    const total = grid.reduce((s, c) => (c.removed ? s : s + c.value), 0);
    scores.push({ name: u, score: total });
  }
  scores.sort((a, b) => a.score - b.score);
  room.scores = scores;
  room.lastEvent = `${finisher} a retourné toute sa grille : fin de manche !`;
}
 
function nextTurn(room) {
  room.turnIndex = (room.turnIndex + 1) % room.players.length;
  room.turnPhase = 'draw';
  room.drawnCard = null;
}
 
function afterAction(room, username) {
  checkColumns(room, username);
  if (allDone(room.playersGrids[username])) {
    endRound(room, username);
  } else {
    nextTurn(room);
  }
}
 
function randomHiddenIndex(grid) {
  const hidden = [];
  grid.forEach((c, i) => { if (!c.revealed && !c.removed) hidden.push(i); });
  if (!hidden.length) return -1;
  return hidden[Math.floor(Math.random() * hidden.length)];
}
 
// Actions automatiques pour un joueur déconnecté qui bloque la partie
function autoStep(room) {
  if (room.phase === 'init') {
    for (const u of room.players) {
      if (room.sockets[u]) continue;
      const grid = room.playersGrids[u];
      while ((room.initRevealedCount[u] || 0) < 2) {
        const i = randomHiddenIndex(grid);
        if (i < 0) break;
        grid[i].revealed = true;
        room.initRevealedCount[u]++;
      }
    }
    checkInitDone(room);
    return;
  }
 
  if (room.phase !== 'playing') return;
  const u = room.players[room.turnIndex];
  if (room.sockets[u]) return;
  const grid = room.playersGrids[u];
 
  if (room.turnPhase === 'draw') {
    if (!ensureDeck(room)) { nextTurn(room); return; }
    room.drawnCard = room.deck.pop();
    room.turnPhase = 'place';
  }
  if (room.turnPhase === 'placeOnly') {
    let i = randomHiddenIndex(grid);
    if (i < 0) i = grid.findIndex(c => !c.removed);
    const old = grid[i];
    grid[i] = { value: room.drawnCard, revealed: true, removed: false };
    room.discard.push(old.value);
    room.drawnCard = null;
    room.lastEvent = `${u} (déconnecté) joue automatiquement.`;
    afterAction(room, u);
    return;
  }
  if (room.turnPhase === 'place') {
    room.discard.push(room.drawnCard);
    room.drawnCard = null;
    room.turnPhase = 'flip';
  }
  if (room.turnPhase === 'flip') {
    const i = randomHiddenIndex(grid);
    if (i < 0) { nextTurn(room); return; }
    grid[i].revealed = true;
    room.lastEvent = `${u} (déconnecté) joue automatiquement.`;
    afterAction(room, u);
  }
}
 
function needsBot(room) {
  if (room.phase === 'init') {
    return room.players.some(u => !room.sockets[u] && (room.initRevealedCount[u] || 0) < 2);
  }
  if (room.phase === 'playing') {
    return !room.sockets[room.players[room.turnIndex]];
  }
  return false;
}
 
function scheduleBot(room) {
  if (room.botTimer) { clearTimeout(room.botTimer); room.botTimer = null; }
  if (!rooms[room.code] || !needsBot(room)) return;
  room.botTimer = setTimeout(() => {
    room.botTimer = null;
    if (!rooms[room.code]) return;
    autoStep(room);
    broadcast(room);
  }, BOT_DELAY_MS);
}
 
// ---------------------------------------------------------------------------
// Gestion des joueurs / salons
// ---------------------------------------------------------------------------
function removePlayer(room, username) {
  const idx = room.players.indexOf(username);
  if (idx < 0) return;
  room.players.splice(idx, 1);
  delete room.sockets[username];
  delete room.playersGrids[username];
  delete room.initRevealedCount[username];
 
  if (room.players.length === 0) {
    if (room.botTimer) clearTimeout(room.botTimer);
    if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
    delete rooms[room.code];
    return;
  }
 
  if (room.host === username) {
    room.host = room.players.find(p => room.sockets[p]) || room.players[0];
  }
 
  if (room.phase === 'init' || room.phase === 'playing' || room.phase === 'ended') {
    if (room.phase !== 'ended' && room.players.length < MIN_PLAYERS) {
      backToLobby(room, 'Pas assez de joueurs : retour au salon.');
    } else if (room.phase === 'playing') {
      if (idx < room.turnIndex) {
        room.turnIndex--;
      } else if (idx === room.turnIndex) {
        if (room.drawnCard !== null && room.turnPhase !== 'draw') room.discard.push(room.drawnCard);
        room.drawnCard = null;
        room.turnPhase = 'draw';
        if (room.turnIndex >= room.players.length) room.turnIndex = 0;
      }
    } else if (room.phase === 'init') {
      checkInitDone(room);
    }
  }
  room.lastEvent = `${username} a quitté la partie.`;
  broadcast(room);
}
 
function clearSocketBinding(socket) {
  const { username, code } = socket.data || {};
  if (!code) return;
  socket.leave(code);
  socket.data.username = null;
  socket.data.code = null;
}
 
function withRoom(socket, fn) {
  const username = socket.data.username;
  const room = rooms[socket.data.code];
  if (!room || !username || !room.players.includes(username) || room.sockets[username] !== socket.id) return;
  fn(room, username);
}
 
// ---------------------------------------------------------------------------
// Socket.io
// ---------------------------------------------------------------------------
io.on('connection', (socket) => {
  socket.data = { username: null, code: null };
 
  socket.on('join', (payload, cb) => {
    const reply = typeof cb === 'function' ? cb : () => {};
    payload = payload || {};
    const username = cleanName(payload.username);
    if (!username) return reply({ error: 'Entre un pseudo.' });
 
    // Si ce socket était déjà dans un autre salon, on le détache proprement
    if (socket.data.code && (socket.data.code !== String(payload.code || '').toUpperCase() || socket.data.username !== username)) {
      const oldRoom = rooms[socket.data.code];
      const oldUser = socket.data.username;
      if (oldRoom && oldRoom.sockets[oldUser] === socket.id) {
        delete oldRoom.sockets[oldUser];
        if (oldRoom.phase === 'lobby') removePlayer(oldRoom, oldUser);
        else broadcast(oldRoom);
      }
      clearSocketBinding(socket);
    }
 
    let room;
    if (payload.create) {
      const code = makeCode();
      if (!code) return reply({ error: 'Impossible de créer un salon.' });
      room = makeRoom(code, username);
      rooms[code] = room;
    } else {
      const code = String(payload.code || '').toUpperCase().trim();
      if (code.length !== 4) return reply({ error: 'Le code doit contenir 4 caractères.' });
      room = rooms[code];
      if (!room) return reply({ error: 'Salon introuvable.' });
    }
 
    const exists = room.players.includes(username);
    if (exists) {
      const oldSid = room.sockets[username];
      if (oldSid && oldSid !== socket.id && io.sockets.sockets.get(oldSid) && !payload.rejoin) {
        return reply({ error: 'Ce pseudo est déjà utilisé dans ce salon.' });
      }
      // Reprise de session (rafraîchissement / micro-déconnexion) : on rattache le nouveau socket
      if (oldSid && oldSid !== socket.id) {
        const old = io.sockets.sockets.get(oldSid);
        if (old) { old.data.username = null; old.data.code = null; old.leave(room.code); }
      }
    } else {
      if (room.phase !== 'lobby') return reply({ error: 'La partie a déjà commencé.' });
      if (room.players.length >= MAX_PLAYERS) return reply({ error: 'Le salon est plein (8 joueurs max).' });
      room.players.push(username);
    }
 
    room.sockets[username] = socket.id;
    socket.data.username = username;
    socket.data.code = room.code;
    socket.join(room.code);
 
    if (room.cleanupTimer) { clearTimeout(room.cleanupTimer); room.cleanupTimer = null; }
    if (!exists) room.lastEvent = `${username} a rejoint le salon.`;
 
    reply({ ok: true, code: room.code, username });
    broadcast(room);
  });
 
  socket.on('leaveRoom', () => {
    const username = socket.data.username;
    const room = rooms[socket.data.code];
    if (room && username && room.sockets[username] === socket.id) {
      clearSocketBinding(socket);
      removePlayer(room, username);
    } else {
      clearSocketBinding(socket);
    }
  });
 
  socket.on('startGame', () => {
    withRoom(socket, (room, u) => {
      if (room.host !== u) return toast(socket, "Seul l'hôte peut lancer la partie.");
      if (room.phase !== 'lobby') return;
      if (room.players.length < MIN_PLAYERS) return toast(socket, 'Il faut au moins 2 joueurs.');
      startGame(room);
      broadcast(room);
    });
  });
 
  socket.on('playAgain', () => {
    withRoom(socket, (room, u) => {
      if (room.host !== u) return toast(socket, "Seul l'hôte peut relancer.");
      if (room.phase !== 'ended') return;
      backToLobby(room, 'Retour au salon pour une nouvelle manche.');
      broadcast(room);
    });
  });
 
  socket.on('revealInit', (data) => {
    withRoom(socket, (room, u) => {
      if (room.phase !== 'init') return;
      const i = data && data.index;
      if (!isValidIndex(i)) return;
      if ((room.initRevealedCount[u] || 0) >= 2) return toast(socket, 'Tu as déjà retourné 2 cartes.');
      const card = room.playersGrids[u][i];
      if (card.revealed) return;
      card.revealed = true;
      room.initRevealedCount[u]++;
      checkInitDone(room);
      broadcast(room);
    });
  });
 
  socket.on('drawDeck', () => {
    withRoom(socket, (room, u) => {
      if (room.phase !== 'playing' || room.players[room.turnIndex] !== u || room.turnPhase !== 'draw') return;
      if (!ensureDeck(room)) return toast(socket, 'Plus de cartes à piocher.');
      room.drawnCard = room.deck.pop();
      room.turnPhase = 'place';
      room.lastEvent = `${u} pioche une carte.`;
      broadcast(room);
    });
  });
 
  socket.on('takeDiscard', () => {
    withRoom(socket, (room, u) => {
      if (room.phase !== 'playing' || room.players[room.turnIndex] !== u || room.turnPhase !== 'draw') return;
      if (!room.discard.length) return toast(socket, 'La défausse est vide.');
      room.drawnCard = room.discard.pop();
      room.turnPhase = 'placeOnly';
      room.lastEvent = `${u} prend le ${room.drawnCard} de la défausse.`;
      broadcast(room);
    });
  });
 
  socket.on('placeCard', (data) => {
    withRoom(socket, (room, u) => {
      if (room.phase !== 'playing' || room.players[room.turnIndex] !== u) return;
      if (room.turnPhase !== 'place' && room.turnPhase !== 'placeOnly') return;
      const i = data && data.index;
      if (!isValidIndex(i)) return;
      const grid = room.playersGrids[u];
      if (grid[i].removed) return;
      const placed = room.drawnCard;
      const old = grid[i].value;
      grid[i] = { value: placed, revealed: true, removed: false };
      room.discard.push(old);
      room.drawnCard = null;
      room.lastEvent = `${u} place le ${placed} et défausse le ${old}.`;
      afterAction(room, u);
      broadcast(room);
    });
  });
 
  socket.on('discardDrawn', () => {
    withRoom(socket, (room, u) => {
      if (room.phase !== 'playing' || room.players[room.turnIndex] !== u) return;
      if (room.turnPhase !== 'place') return; // seulement si pioché dans la pioche
      room.discard.push(room.drawnCard);
      room.lastEvent = `${u} jette le ${room.drawnCard} et va retourner une carte.`;
      room.drawnCard = null;
      room.turnPhase = 'flip';
      broadcast(room);
    });
  });
 
  socket.on('flipCard', (data) => {
    withRoom(socket, (room, u) => {
      if (room.phase !== 'playing' || room.players[room.turnIndex] !== u || room.turnPhase !== 'flip') return;
      const i = data && data.index;
      if (!isValidIndex(i)) return;
      const card = room.playersGrids[u][i];
      if (card.revealed || card.removed) return toast(socket, 'Choisis une carte cachée.');
      card.revealed = true;
      room.lastEvent = `${u} retourne un ${card.value}.`;
      afterAction(room, u);
      broadcast(room);
    });
  });
 
  socket.on('disconnect', () => {
    const username = socket.data.username;
    const room = rooms[socket.data.code];
    if (!room || !username) return;
    if (room.sockets[username] !== socket.id) return; // déjà remplacé par une reconnexion
    delete room.sockets[username];
 
    if (room.phase === 'lobby') {
      // laisse un court délai (rafraîchissement de page)
      setTimeout(() => {
        const r = rooms[room.code];
        if (r && r.phase === 'lobby' && !r.sockets[username] && r.players.includes(username)) {
          removePlayer(r, username);
        }
      }, LOBBY_GRACE_MS);
    }
 
    if (room.host === username) {
      const other = room.players.find(p => p !== username && room.sockets[p]);
      if (other && room.phase === 'lobby') room.host = other;
    }
 
    if (connectedCount(room) === 0) {
      if (room.botTimer) { clearTimeout(room.botTimer); room.botTimer = null; }
      if (room.cleanupTimer) clearTimeout(room.cleanupTimer);
      room.cleanupTimer = setTimeout(() => {
        const r = rooms[room.code];
        if (r && connectedCount(r) === 0) {
          if (r.botTimer) clearTimeout(r.botTimer);
          delete rooms[r.code];
        }
      }, EMPTY_ROOM_MS);
      return;
    }
    broadcast(room);
  });
});
 
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Skyjo : serveur démarré sur http://localhost:${PORT}`);
});
 
Claude a terminé sa réponse.

    
