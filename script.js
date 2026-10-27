const socket = io();

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

const screens = {
    home: document.getElementById('screen-home'),
    lobby: document.getElementById('screen-lobby'),
    game: document.getElementById('screen-game'),
    gameover: document.getElementById('screen-gameover')
};

const usernameInput = document.getElementById('username-input');
const roomCodeInput = document.getElementById('room-code-input');
const errorMsg = document.getElementById('error-msg');
const playersList = document.getElementById('players-list');
const displayRoomCode = document.getElementById('display-room-code');
const btnStart = document.getElementById('btn-start');
const waitMsg = document.getElementById('wait-msg');
const instructionEl = document.getElementById('game-instruction');

const drawPile = document.getElementById('draw-pile');
const discardPile = document.getElementById('discard-pile');
const drawnCardArea = document.getElementById('drawn-card-area');
const drawnCardSlot = document.getElementById('drawn-card-slot');
const btnDiscardDrawn = document.getElementById('btn-discard-drawn');

let currentRoom = null;
let isHost = false;

function switchScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[screenName].classList.add('active');
}

document.getElementById('btn-create').addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (!username) { errorMsg.textContent = "Entre un pseudo !"; return; }
    errorMsg.textContent = "";
    isHost = true;
    socket.emit('create-room', username);
});

document.getElementById('btn-join').addEventListener('click', () => {
    const username = usernameInput.value.trim();
    const code = roomCodeInput.value.trim().toUpperCase();
    if (!username) { errorMsg.textContent = "Entre un pseudo !"; return; }
    if (code.length !== 4) { errorMsg.textContent = "Code à 4 caractères requis."; return; }
    errorMsg.textContent = "";
    isHost = false;
    socket.emit('join-room', { username, code });
});

btnStart.addEventListener('click', () => {
    socket.emit('start-game', currentRoom);
});

socket.on('room-joined', ({ roomCode, players, hostId }) => {
    currentRoom = roomCode;
    displayRoomCode.textContent = roomCode;
    document.getElementById('hud-room').textContent = roomCode;
    switchScreen('lobby');
    updateLobby(players, hostId);
});

socket.on('update-players', ({ players, hostId }) => {
    updateLobby(players, hostId);
});

socket.on('error-message', (msg) => {
    errorMsg.textContent = msg;
});

function updateLobby(players, hostId) {
    playersList.innerHTML = '';
    players.forEach(p => {
        const li = document.createElement('li');
        li.textContent = p.username + (p.id === hostId ? ' (Hôte)' : '');
        playersList.appendChild(li);
    });

    if (socket.id === hostId) {
        btnStart.style.display = 'block';
        waitMsg.style.display = 'none';
    } else {
        btnStart.style.display = 'none';
        waitMsg.style.display = 'block';
    }
}

socket.on('game-started', () => {
    switchScreen('game');
});

drawPile.onclick = () => {
    socket.emit('player-action', { roomCode: currentRoom, action: 'draw-deck' });
};

discardPile.onclick = () => {
    socket.emit('player-action', { roomCode: currentRoom, action: 'draw-discard' });
};

btnDiscardDrawn.onclick = () => {
    socket.emit('player-action', { roomCode: currentRoom, action: 'discard-drawn' });
};

socket.on('game-state-update', (state) => {
    renderGame(state);
});

socket.on('game-over', (scores) => {
    switchScreen('gameover');
    const box = document.getElementById('final-scores');
    box.innerHTML = '<h3>Scores finaux :</h3><ul>';
    for (let user in scores) {
        box.innerHTML += `<li><b>${user}</b> : ${scores[user]} points</li>`;
    }
    box.innerHTML += '</ul>';
});

function renderGame(state) {
    const isMyTurn = (state.turnPlayerId === socket.id);
    const myGrid = state.playersGrids[socket.id] || [];

    if (state.status === 'initializing') {
        const revealed = state.initRevealedCount[socket.id] || 0;
        if (revealed < 2) {
            instructionEl.textContent = `Début : Clique sur ${2 - revealed} carte(s) pour les révéler.`;
        } else {
            instructionEl.textContent = "En attente des autres joueurs...";
        }
    } else if (state.status === 'playing') {
        if (isMyTurn) {
            if (state.turnPhase === 'draw') {
                instructionEl.textContent = "Ton tour : Pioche (gauche) ou Défausse (droite).";
            } else if (state.turnPhase === 'action') {
                instructionEl.textContent = "Clique sur une carte de ta grille pour y placer ta carte.";
            } else if (state.turnPhase === 'reveal-one') {
                instructionEl.textContent = "Choisis une carte cachée de ta grille à révéler.";
            }
        } else {
            instructionEl.textContent = `Tour de ${state.turnPlayerName}...`;
        }
    }

    discardPile.innerHTML = '';
    if (state.topDiscard) {
        const imgUrl = CARD_DATA[state.topDiscard] || '';
        discardPile.innerHTML = `<img src="${imgUrl}" alt="${state.topDiscard}" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span style="display:none; font-weight:bold; font-size:1.2rem; color:var(--accent);">${state.topDiscard}</span>`;
    } else {
        discardPile.innerHTML = `<div class="card-placeholder">Vide</div>`;
    }

    if (state.drawnCard && isMyTurn && state.turnPhase === 'action') {
        drawnCardArea.style.display = 'flex';
        const imgUrl = CARD_DATA[state.drawnCard] || '';
        drawnCardSlot.innerHTML = `<img src="${imgUrl}" alt="${state.drawnCard}" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span style="display:none; font-weight:bold; font-size:1.2rem; color:var(--accent);">${state.drawnCard}</span>`;
        if (state.drawnSource === 'deck') {
            btnDiscardDrawn.style.display = 'block';
        } else {
            btnDiscardDrawn.style.display = 'none';
        }
    } else {
        drawnCardArea.style.display = 'none';
    }

    const gridEl = document.getElementById('player-grid');
    gridEl.innerHTML = '';

    myGrid.forEach((card, index) => {
        const slot = document.createElement('div');
        slot.className = `card-slot ${card.isRevealed ? '' : 'hidden'}`;

        if (card.isRevealed && card.value) {
            const imgUrl = CARD_DATA[card.value] || '';
            slot.innerHTML = `<img src="${imgUrl}" alt="${card.value}" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';"><span style="display:none; font-weight:bold; font-size:1.3rem; color:var(--accent);">${card.value}</span>`;
        } else {
            slot.innerHTML = `<div class="card-back">?</div>`;
        }

        // Clic et tactile réactifs
        slot.onclick = () => {
            if (state.status === 'initializing') {
                if (!card.isRevealed) {
                    socket.emit('player-action', { roomCode: currentRoom, action: 'reveal-init', index });
                }
            } else if (state.status === 'playing' && isMyTurn) {
                if (state.turnPhase === 'action' || state.turnPhase === 'reveal-one') {
                    socket.emit('player-action', {
                        roomCode: currentRoom,
                        action: state.turnPhase === 'reveal-one' ? 'reveal-hidden' : 'place-grid',
                        index
                    });
                }
            }
        };

        gridEl.appendChild(slot);
    });

    const opponentsContainer = document.getElementById('opponents-list');
    opponentsContainer.innerHTML = '';
    state.players.forEach(p => {
        if (p.id !== socket.id) {
            const oppCard = document.createElement('div');
            oppCard.className = 'opponent-card';
            oppCard.innerHTML = `<strong>${p.username}</strong>`;
            
            const miniGrid = document.createElement('div');
            miniGrid.className = 'opponent-mini-grid';
            const oppGrid = state.playersGrids[p.id] || [];
            oppGrid.forEach(c => {
                const mini = document.createElement('div');
                mini.className = `mini-slot ${c.isRevealed ? 'revealed' : ''}`;
                miniGrid.appendChild(mini);
            });
            oppCard.appendChild(miniGrid);
            opponentsContainer.appendChild(oppCard);
        }
    });
}
