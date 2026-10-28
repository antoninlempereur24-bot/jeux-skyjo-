/* =========================================================================
   Skyjo multijoueur - client
   ========================================================================= */

const CARD_DATA = {
    "-4": "https://github.com/antoninlempereur24-bot/cartes-skijo/blob/main/1B864298-6436-4BE8-9E4D-9774B5E905F2.PNG?raw=true",
    "-2": "https://github.com/antoninlempereur24-bot/cartes-skijo/blob/main/D06DD7EA-9AEC-497D-A931-8F6D0EF24C46.png?raw=true",
    "-1": "https://github.com/antoninlempereur24-bot/cartes-skijo/blob/main/8B4DBB36-4CDD-44C6-A679-7F026EE5D4AC.png?raw=true",
    "0": "https://github.com/antoninlempereur24-bot/cartes-skijo/blob/main/BC858719-5A8E-48A3-86DF-534976ABFF0E.png?raw=true",
    "1": "https://github.com/antoninlempereur24-bot/cartes-skijo/blob/main/431506FA-931A-4438-A65D-D9A38FDBF992.png?raw=true",
    "2": "https://github.com/antoninlempereur24-bot/cartes-skijo/blob/main/9CC96367-9451-44F8-910D-46FD8DBD5E0A.png?raw=true",
    "3": "https://github.com/antoninlempereur24-bot/cartes-skijo/blob/main/BB7FE10A-1FF4-4291-ACEB-1DF584E9D42B.png?raw=true",
    "4": "https://github.com/antoninlempereur24-bot/cartes-skijo/blob/main/7A06B09A-7682-4105-AB22-2377CE85AFCA.png?raw=true",
    "5": "https://github.com/antoninlempereur24-bot/cartes-skijo/blob/main/3B317941-1B34-4050-8F78-9D7D2B317C30.png?raw=true",
    "6": "https://github.com/antoninlempereur24-bot/cartes-skijo/blob/main/F053B45E-5D3E-482B-917F-8DD663294C2E.png?raw=true",
    "7": "https://github.com/antoninlempereur24-bot/cartes-skijo/blob/main/64E4C207-AA86-451E-887B-2025F3BE6185.png?raw=true",
    "8": "https://github.com/antoninlempereur24-bot/cartes-skijo/blob/main/41E6B76F-7931-47A7-AEED-396B65F8EAC3.png?raw=true",
    "9": "https://github.com/antoninlempereur24-bot/cartes-skijo/blob/main/B8F522EE-C7DA-4291-9FBE-76C7CE7F55A9.png?raw=true",
    "10": "https://github.com/antoninlempereur24-bot/cartes-skijo/blob/main/337C2B72-CC66-4EBF-8F5D-6BA021C443A8.png?raw=true",
    "11": "https://github.com/antoninlempereur24-bot/cartes-skijo/blob/main/0741C321-130A-437A-AC57-593EE618BB84.png?raw=true",
    "12": "https://github.com/antoninlempereur24-bot/cartes-skijo/blob/main/87D4D1A8-972F-44FA-9031-73D65A201046.png?raw=true",
    "13": "https://github.com/antoninlempereur24-bot/cartes-skijo/blob/main/BC426F04-D2EF-483D-9788-362E528937FC.PNG?raw=true",
    "20": "https://github.com/antoninlempereur24-bot/cartes-skijo/blob/main/88EC9052-8FF3-4418-99F7-12ED97B63188.PNG?raw=true"
};

const socket = io();
const $ = (id) => document.getElementById(id);

let state = null;      // dernier état reçu du serveur
let lastEventShown = '';

// Pré-chargement des images pour qu'elles s'affichent instantanément
Object.values(CARD_DATA).forEach((url) => { const i = new Image(); i.src = url; });

/* ---------------------------------------------------------------------------
   Session (survit au rafraîchissement) : pseudo + code du salon
   --------------------------------------------------------------------------- */
const store = {
  get() { try { return JSON.parse(localStorage.getItem('skyjo_session') || 'null'); } catch (e) { return null; } },
  set(v) { try { localStorage.setItem('skyjo_session', JSON.stringify(v)); } catch (e) {} },
  clear() { try { localStorage.removeItem('skyjo_session'); } catch (e) {} },
  getName() { try { return localStorage.getItem('skyjo_name') || ''; } catch (e) { return ''; } },
  setName(n) { try { localStorage.setItem('skyjo_name', n); } catch (e) {} }
};

/* ---------------------------------------------------------------------------
   Utilitaires UI
   --------------------------------------------------------------------------- */
function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $('screen-' + name).classList.add('active');
}

function toast(msg, type) {
  const el = document.createElement('div');
  el.className = 'toast ' + (type || '');
  el.textContent = msg;
  $('toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 2200);
  setTimeout(() => el.remove(), 2600);
}

function buzz(ms) { if (navigator.vibrate) { try { navigator.vibrate(ms || 12); } catch (e) {} } }

function valueClass(v) {
  if (v < 0) return 'v-neg';
  if (v === 0) return 'v-zero';
  if (v <= 4) return 'v-low';
  if (v <= 8) return 'v-mid';
  if (v <= 12) return 'v-high';
  return 'v-max';
}

/* ---------------------------------------------------------------------------
   Construction des cartes
   --------------------------------------------------------------------------- */
function fillFace(el, value) {
  el.classList.add('face', valueClass(value));
  // Texte toujours présent sous l'image : visible si l'image est lente ou en erreur
  const t = document.createElement('span');
  t.className = 'card-text';
  t.textContent = String(value);
  el.appendChild(t);

  const url = CARD_DATA[String(value)];
  if (url) {
    const img = document.createElement('img');
    img.className = 'card-img';
    img.alt = String(value);
    img.draggable = false;
    img.onload = function () { img.classList.add('loaded'); };
    img.onerror = function () { img.remove(); }; // la valeur textuelle reste affichée
    img.src = url;
    el.appendChild(img);
  }
}

function makeCard(cell, opts) {
  opts = opts || {};
  const el = document.createElement('div');
  el.className = 'card';
  if (opts.index !== undefined) el.dataset.i = String(opts.index);

  if (cell.removed) {
    el.classList.add('removed');
    return el;
  }
  if (cell.revealed && cell.value !== null && cell.value !== undefined) {
    fillFace(el, cell.value);
  } else {
    el.classList.add('back');
  }
  if (opts.clickable) el.classList.add('clickable');
  return el;
}

/* ---------------------------------------------------------------------------
   Aides d'état
   --------------------------------------------------------------------------- */
function getMe() { return state ? state.players.find((p) => p.name === state.me) : null; }
function isMyTurn() { return !!state && state.phase === 'playing' && state.currentPlayer === state.me; }

function canClickMyCard(cell) {
  if (!state || !cell || cell.removed) return false;
  const me = getMe();
  if (state.phase === 'init') return me.initCount < 2 && !cell.revealed;
  if (isMyTurn()) {
    if (state.turnPhase === 'place' || state.turnPhase === 'placeOnly') return true;
    if (state.turnPhase === 'flip') return !cell.revealed;
  }
  return false;
}

/* ---------------------------------------------------------------------------
   Bannière d'instructions
   --------------------------------------------------------------------------- */
function bannerInfo(s) {
  const me = getMe();
  if (s.phase === 'init') {
    if (me.initCount < 2) {
      const n = 2 - me.initCount;
      return { text: `Initialisation : clique sur ${n} carte${n > 1 ? 's' : ''} cachée${n > 1 ? 's' : ''} de ta grille pour ${n > 1 ? 'les' : 'la'} retourner`, cls: 'mine' };
    }
    const ready = s.players.filter((p) => p.initCount >= 2).length;
    return { text: `Tes 2 cartes sont retournées. En attente des autres joueurs (${ready}/${s.players.length} prêts)…`, cls: 'wait' };
  }
  if (s.phase === 'playing') {
    if (s.currentPlayer === s.me) {
      switch (s.turnPhase) {
        case 'draw':
          return { text: "C'est ton tour : Clique sur la pioche ou la défausse", cls: 'mine' };
        case 'place':
          return { text: `Tu as pioché un ${s.drawnCard} : clique sur une carte de ta grille pour la placer (ou jette-la avec la défausse)`, cls: 'mine' };
        case 'placeOnly':
          return { text: `Tu as pris le ${s.drawnCard} : clique sur une carte de ta grille pour la remplacer`, cls: 'mine' };
        case 'flip':
          return { text: 'Choisis une carte cachée de ta grille à retourner', cls: 'mine' };
      }
    }
    let what = 'réfléchit…';
    if (s.turnPhase === 'draw') what = 'choisit entre la pioche et la défausse…';
    else if (s.turnPhase === 'place' || s.turnPhase === 'placeOnly') what = 'choisit où placer sa carte…';
    else if (s.turnPhase === 'flip') what = 'retourne une carte cachée…';
    return { text: `Tour de ${s.currentPlayer} : il ${what}`, cls: 'wait' };
  }
  return { text: '', cls: 'wait' };
}

/* ---------------------------------------------------------------------------
   Rendu
   --------------------------------------------------------------------------- */
function render() {
  if (!state) { showScreen('home'); return; }
  const s = state;

  if (s.phase === 'lobby') { renderLobby(s); showScreen('lobby'); }
  else if (s.phase === 'ended') { renderEnd(s); showScreen('end'); }
  else { renderGame(s); showScreen('game'); }
}

function renderLobby(s) {
  $('btn-copy').textContent = s.code;
  $('lobby-count').textContent = String(s.players.length);
  const ul = $('lobby-players');
  ul.innerHTML = '';
  s.players.forEach((p) => {
    const li = document.createElement('li');
    if (p.name === s.me) li.classList.add('is-me');
    const dot = document.createElement('span');
    dot.className = 'dot' + (p.connected ? '' : ' off');
    const name = document.createElement('span');
    name.textContent = p.name + (p.name === s.me ? ' (toi)' : '');
    li.appendChild(dot);
    li.appendChild(name);
    if (p.isHost) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = '👑 Hôte';
      li.appendChild(tag);
    }
    ul.appendChild(li);
  });

  const iAmHost = s.host === s.me;
  const startBtn = $('btn-start');
  startBtn.classList.toggle('hidden', !iAmHost);
  startBtn.disabled = s.players.length < 2;
  $('lobby-hint').textContent = iAmHost
    ? (s.players.length < 2 ? 'Partage le code : il faut au moins 2 joueurs pour lancer.' : 'Tout le monde est prêt ? Lance la partie !')
    : "En attente de l'hôte pour lancer la partie…";
}

function renderOpponentBoard(p, active, small) {
  const box = document.createElement('div');
  box.className = 'opp' + (active ? ' active' : '') + (p.connected ? '' : ' offline');
  const head = document.createElement('div');
  head.className = 'opp-head';
  const n = document.createElement('span');
  n.className = 'opp-name';
  n.textContent = p.name;
  const sc = document.createElement('span');
  sc.className = 'opp-score';
  sc.textContent = String(p.visibleScore);
  head.appendChild(n);
  head.appendChild(sc);
  box.appendChild(head);
  const board = document.createElement('div');
  board.className = 'board';
  (p.grid || []).forEach((c) => board.appendChild(makeCard(c)));
  box.appendChild(board);
  return box;
}

function renderGame(s) {
  const me = getMe();
  const myTurn = isMyTurn();

  $('game-name').textContent = s.gameName || 'Partie';
  $('game-code').textContent = s.code;

  // Bannière
  const b = bannerInfo(s);
  const banner = $('banner');
  banner.textContent = b.text;
  banner.className = 'banner ' + b.cls;

  // Journal
  $('event-log').textContent = s.lastEvent || '';

  // Adversaires
  const others = $('others');
  others.innerHTML = '';
  s.players.filter((p) => p.name !== s.me).forEach((p) => {
    others.appendChild(renderOpponentBoard(p, s.currentPlayer === p.name));
  });
  others.classList.toggle('hidden', s.players.length < 2);

  // Pioche
  const deck = $('deck');
  deck.innerHTML = '';
  const deckCard = document.createElement('div');
  deckCard.className = 'card back' + (myTurn && s.turnPhase === 'draw' ? ' clickable' : '');
  deck.appendChild(deckCard);
  const cnt = document.createElement('span');
  cnt.className = 'count';
  cnt.textContent = String(s.deckCount);
  deck.appendChild(cnt);

  // Défausse
  const discard = $('discard');
  discard.innerHTML = '';
  const discardClickable = myTurn && ((s.turnPhase === 'draw' && s.discardTop !== null) || s.turnPhase === 'place');
  if (s.discardTop !== null) {
    discard.appendChild(makeCard({ revealed: true, value: s.discardTop }, { clickable: discardClickable }));
  } else {
    const e = document.createElement('div');
    e.className = 'card empty';
    discard.appendChild(e);
  }

  // Main (carte en cours)
  const hand = $('hand');
  hand.innerHTML = '';
  if (myTurn && s.drawnCard !== null && (s.turnPhase === 'place' || s.turnPhase === 'placeOnly')) {
    hand.appendChild(makeCard({ revealed: true, value: s.drawnCard }));
    $('hand-label').textContent = 'Ta carte';
  } else {
    const e = document.createElement('div');
    e.className = 'card empty';
    hand.appendChild(e);
    $('hand-label').textContent = 'Main';
  }
  $('btn-discard-drawn').classList.toggle('hidden', !(myTurn && s.turnPhase === 'place'));

  // Ma grille
  $('me-zone').classList.toggle('active', myTurn);
  $('me-name').textContent = s.me + (myTurn ? ' — à toi !' : '');
  $('me-score').textContent = 'Visible : ' + me.visibleScore;
  const board = $('my-board');
  board.innerHTML = '';
  (me.grid || []).forEach((cell, i) => {
    board.appendChild(makeCard(cell, { index: i, clickable: canClickMyCard(cell) }));
  });
}

function renderEnd(s) {
  $('end-game-name').textContent = s.gameName ? `« ${s.gameName} »` : '';
  $('end-finisher').textContent = s.finisher ? `${s.finisher} a retourné toute sa grille et termine la manche.` : '';

  const ol = $('end-ranking');
  ol.innerHTML = '';
  const best = s.scores && s.scores.length ? s.scores[0].score : null;
  (s.scores || []).forEach((r) => {
    const li = document.createElement('li');
    if (r.score === best) li.classList.add('winner');
    const n = document.createElement('span');
    n.textContent = r.name + (r.name === s.me ? ' (toi)' : '');
    li.appendChild(n);
    if (r.name === s.finisher) {
      const t = document.createElement('span');
      t.className = 'tag';
      t.textContent = 'a terminé';
      li.appendChild(t);
    }
    const pts = document.createElement('span');
    pts.className = 'pts';
    pts.textContent = r.score + ' pts';
    li.appendChild(pts);
    ol.appendChild(li);
  });

  const boards = $('end-boards');
  boards.innerHTML = '';
  s.players.forEach((p) => {
    const found = (s.scores || []).find((x) => x.name === p.name);
    const copy = Object.assign({}, p, { visibleScore: found ? found.score : p.visibleScore });
    boards.appendChild(renderOpponentBoard(copy, false));
  });

  const iAmHost = s.host === s.me;
  $('btn-replay').classList.toggle('hidden', !iAmHost);
  $('end-wait').classList.toggle('hidden', iAmHost);
}

/* ---------------------------------------------------------------------------
   Interactions
   --------------------------------------------------------------------------- */
function onMyCardClick(i) {
  if (!state) return;
  const me = getMe();
  const cell = me && me.grid ? me.grid[i] : null;
  if (!cell) return;

  if (state.phase === 'init') {
    if (me.initCount >= 2) return toast('Tu as déjà retourné 2 cartes. Patiente un instant !');
    if (cell.revealed) return toast('Choisis une carte cachée.');
    buzz();
    socket.emit('revealInit', { index: i });
    return;
  }
  if (state.phase !== 'playing') return;
  if (!isMyTurn()) return toast("Ce n'est pas ton tour.");
  if (cell.removed) return;

  if (state.turnPhase === 'draw') return toast("D'abord, clique sur la pioche ou la défausse.");
  if (state.turnPhase === 'place' || state.turnPhase === 'placeOnly') {
    buzz();
    socket.emit('placeCard', { index: i });
  } else if (state.turnPhase === 'flip') {
    if (cell.revealed) return toast('Choisis une carte cachée.');
    buzz();
    socket.emit('flipCard', { index: i });
  }
}

function onDeckClick() {
  if (!state || state.phase !== 'playing') return;
  if (!isMyTurn()) return toast("Ce n'est pas ton tour.");
  if (state.turnPhase !== 'draw') return toast('Tu as déjà pris une carte.');
  buzz();
  socket.emit('drawDeck');
}

function onDiscardClick() {
  if (!state || state.phase !== 'playing') return;
  if (!isMyTurn()) return toast("Ce n'est pas ton tour.");
  if (state.turnPhase === 'draw') {
    if (state.discardTop === null) return toast('La défausse est vide.');
    buzz();
    socket.emit('takeDiscard');
  } else if (state.turnPhase === 'place') {
    buzz();
    socket.emit('discardDrawn');
  } else if (state.turnPhase === 'placeOnly') {
    toast('Tu as pris cette carte : place-la sur ta grille.');
  }
}

// Délégation d'événements : les clics restent fiables même si l'interface est re-rendue
$('my-board').addEventListener('click', (e) => {
  const card = e.target.closest('.card[data-i]');
  if (card) onMyCardClick(Number(card.dataset.i));
});
$('deck').addEventListener('click', onDeckClick);
$('discard').addEventListener('click', onDiscardClick);
$('btn-discard-drawn').addEventListener('click', () => {
  if (state && isMyTurn() && state.turnPhase === 'place') { buzz(); socket.emit('discardDrawn'); }
});

/* ---------------------------------------------------------------------------
   Accueil / salon
   --------------------------------------------------------------------------- */
$('inp-username').value = store.getName();

function readName() {
  const name = $('inp-username').value.trim().slice(0, 14);
  if (!name) { toast('Entre un pseudo.', 'error'); $('inp-username').focus(); return null; }
  store.setName(name);
  return name;
}

function afterJoin(username, res) {
  if (!res || res.error) { toast((res && res.error) || 'Erreur de connexion.', 'error'); return; }
  store.set({ username: res.username || username, code: res.code });
}

$('btn-create').addEventListener('click', () => {
  const username = readName();
  if (!username) return;
  socket.emit('join', { username, create: true }, (res) => afterJoin(username, res));
});

function doJoin() {
  const username = readName();
  if (!username) return;
  const code = $('inp-code').value.trim().toUpperCase();
  if (code.length !== 4) { toast('Le code du salon fait 4 caractères.', 'error'); $('inp-code').focus(); return; }
  socket.emit('join', { username, code }, (res) => afterJoin(username, res));
}
$('btn-join').addEventListener('click', doJoin);
$('inp-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') doJoin(); });
$('inp-code').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
$('inp-username').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { if ($('inp-code').value.trim()) doJoin(); else $('btn-create').click(); }
});

$('btn-copy').addEventListener('click', () => {
  const code = state ? state.code : '';
  if (!code) return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(code).then(() => toast('Code copié !', 'ok')).catch(() => toast('Code : ' + code));
  } else {
    toast('Code : ' + code);
  }
});

$('btn-start').addEventListener('click', () => socket.emit('startGame'));
$('btn-replay').addEventListener('click', () => socket.emit('playAgain'));

function leave() {
  socket.emit('leaveRoom');
  store.clear();
  state = null;
  showScreen('home');
}
$('btn-leave-lobby').addEventListener('click', leave);
$('btn-leave-end').addEventListener('click', leave);
$('btn-leave-game').addEventListener('click', () => {
  if (confirm('Quitter la partie en cours ?')) leave();
});

/* ---------------------------------------------------------------------------
   Socket.io
   --------------------------------------------------------------------------- */
socket.on('connect', () => {
  $('conn').classList.add('hidden');
  const sess = store.get();
  if (sess && sess.username && sess.code) {
    // Reprise automatique de session (rafraîchissement / micro-déconnexion)
    socket.emit('join', { username: sess.username, code: sess.code, rejoin: true }, (res) => {
      if (res && res.error) {
        store.clear();
        state = null;
        showScreen('home');
        toast(res.error, 'error');
      }
    });
  }
});

socket.on('disconnect', () => { $('conn').classList.remove('hidden'); });

socket.on('state', (s) => {
  state = s;
  render();
});

socket.on('toast', (t) => toast(t.msg, t.type));
