const socket = io();

// Table de correspondance avec les liens RAW de tes images GitHub
const CARD_DATA = {
    "-4": "https://raw.githubusercontent.com/antoninlempereur24-bot/cartes-skijo/main/1B864298-6436-4BE8-9E4D-9774B5E905F2.PNG",
    "-2": "https://raw.githubusercontent.com/antoninlempereur24-bot/cartes-skijo/main/D06DD7EA-9AEC-497D-A931-8F6D0EF24C46.png",
    "-1": "https://raw.githubusercontent.com/antoninlempereur24-bot/cartes-skijo/main/8B4DBB36-4CDD-44C6-A679-7F026EE5D4AC.png",
    "0": "https://raw.githubusercontent.com/antoninlempereur24-bot/cartes-skijo/main/BC858719-5A8E-48A3-86DF-534976ABFF0E.png",
    "1": "https://raw.githubusercontent.com/antoninlempereur24-bot/cartes-skijo/main/431506FA-931A-4438-A65D-D9A38FDBF992.png",
    "2": "https://raw.githubusercontent.com/antoninlempereur24-bot/cartes-skijo/main/9CC96367-9451-44F8-910D-46FD8DBD5E0A.png",
    "3": "https://raw.githubusercontent.com/antoninlempereur24-bot/cartes-skijo/main/BB7FE10A-1FF4-4291-ACEB-1DF584E9D42B.png",
    "4": "https://raw.githubusercontent.com/antoninlempereur24-bot/cartes-skijo/main/7A06B09A-7682-4105-AB22-2377CE85AFCA.png",
    "5": "https://raw.githubusercontent.com/antoninlempereur24-bot/cartes-skijo/main/3B317941-1B34-4050-8F78-9D7D2B317C30.png",
    "6": "https://raw.githubusercontent.com/antoninlempereur24-bot/cartes-skijo/main/F053B45E-5D3E-482B-917F-8DD663294C2E.png",
    "7": "https://raw.githubusercontent.com/antoninlempereur24-bot/cartes-skijo/main/64E4C207-AA86-451E-887B-2025F3BE6185.png",
    "8": "https://raw.githubusercontent.com/antoninlempereur24-bot/cartes-skijo/main/41E6B76F-7931-47A7-AEED-396B65F8EAC3.png",
    "9": "https://raw.githubusercontent.com/antoninlempereur24-bot/cartes-skijo/main/B8F522EE-C7DA-4291-9FBE-76C7CE7F55A9.png",
    "10": "https://raw.githubusercontent.com/antoninlempereur24-bot/cartes-skijo/main/337C2B72-CC66-4EBF-8F5D-6BA021C443A8.png",
    "11": "https://raw.githubusercontent.com/antoninlempereur24-bot/cartes-skijo/main/0741C321-130A-437A-AC57-593EE618BB84.png",
    "12": "https://raw.githubusercontent.com/antoninlempereur24-bot/cartes-skijo/main/87D4D1A8-972F-44FA-9031-73D65A201046.png",
    "13": "https://raw.githubusercontent.com/antoninlempereur24-bot/cartes-skijo/main/BC426F04-D2EF-483D-9788-362E528937FC.PNG",
    "20": "https://raw.githubusercontent.com/antoninlempereur24-bot/cartes-skijo/main/88EC9052-8FF3-4418-99F7-12ED97B63188.PNG"
};

const screens = {
    home: document.getElementById('screen-home'),
    lobby: document.getElementById('screen-lobby'),
    game: document.getElementById('screen-game')
};

const usernameInput = document.getElementById('username-input');
const roomCodeInput = document.getElementById('room-code-input');
const errorMsg = document.getElementById('error-msg');
const playersList = document.getElementById('players-list');
const displayRoomCode = document.getElementById('display-room-code');
const btnStart = document.getElementById('btn-start');
const waitMsg = document.getElementById('wait-msg');

let currentRoom = null;
let isHost = false;

function switchScreen(screenName) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[screenName].classList.add('active');
}

document.getElementById('btn-create').addEventListener('click', () => {
    const username = usernameInput.value.trim();
    if (!username) {
        errorMsg.textContent = "Entre un pseudo valide !";
        return;
    }
    errorMsg.textContent = "";
    isHost = true;
    socket.emit('create-room', username);
});

document.getElementById('btn-join').addEventListener('click', () => {
    const username = usernameInput.value.trim();
    const code = roomCodeInput.value.trim().toUpperCase();
    if (!username) {
        errorMsg.textContent = "Entre un pseudo valide !";
        return;
    }
    if (code.length !== 4) {
        errorMsg.textContent = "Le code de salon doit faire 4 caractères.";
        return;
    }
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

socket.on('game-state-update', (gameState) => {
    renderGame(gameState);
});

function renderGame(state) {
    document.getElementById('hud-turn').textContent = state.turnPlayerName;

    const discardPile = document.getElementById('discard-pile');
    if (state.topDiscard) {
        discardPile.innerHTML = `<img src="${CARD_DATA[state.topDiscard]}" alt="Carte ${state.topDiscard}">`;
    }

    const gridEl = document.getElementById('player-grid');
    gridEl.innerHTML = '';
    const myGrid = state.playersGrids[socket.id] || [];

    myGrid.forEach((card, index) => {
        const slot = document.createElement('div');
        slot.className = `card-slot ${card.isRevealed ? '' : 'hidden'}`;
        
        if (card.isRevealed) {
            slot.innerHTML = `<img src="${CARD_DATA[card.value]}" alt="${card.value}">`;
        } else {
            slot.innerHTML = `<div class="card-back">?</div>`;
        }

        slot.addEventListener('click', () => {
            socket.emit('player-action', { roomCode: currentRoom, action: 'select-grid', index });
        });

        gridEl.appendChild(slot);
    });
}
