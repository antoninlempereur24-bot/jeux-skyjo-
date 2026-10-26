const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Servir les fichiers statiques du dossier courant
app.use(express.static(__dirname));

const rooms = {};

// Générateur de code de salon aléatoire à 4 caractères (ex: 68J7)
function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return rooms[code] ? generateRoomCode() : code;
}

// Générateur de paquet Skyjo simplifié
function createDeck() {
    // Valeurs typiques du Skyjo : distribution approximative des cartes
    const values = [-4,-2,-1,0,1,2,3,4,5,6,7,8,9,10,11,12,13,20];
    let deck = [];
    values.forEach(val => {
        // Répétition des cartes selon les règles classiques
        let count = (val === 0) ? 5 : (val < 0 || val >= 13 ? 2 : 5);
        for(let i=0; i<count; i++) {
            deck.push(val.toString());
        }
    });
    // Mélange du deck (Fisher-Yates)
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

io.on('connection', (socket) => {
    console.log(`Utilisateur connecté : ${socket.id}`);

    // Création d'une partie
    socket.on('create-room', (username) => {
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            code: roomCode,
            hostId: socket.id,
            players: [{ id: socket.id, username }],
            status: 'waiting',
            deck: [],
            discardPile: [],
            playersGrids: {},
            turnIndex: 0
        };

        socket.join(roomCode);
        socket.emit('room-joined', {
            roomCode,
            players: rooms[roomCode].players,
            hostId: socket.id
        });
    });

    // Rejoindre une partie existante via le code à 4 caractères
    socket.on('join-room', ({ username, code }) => {
        const room = rooms[code];
        if (!room) {
            socket.emit('error-message', "Salon introuvable avec ce code.");
            return;
        }
        if (room.status !== 'waiting') {
            socket.emit('error-message', "La partie a déjà commencé.");
            return;
        }

        room.players.push({ id: socket.id, username });
        socket.join(code);

        io.to(code).emit('update-players', {
            players: room.players,
            hostId: room.hostId
        });

        socket.emit('room-joined', {
            roomCode: code,
            players: room.players,
            hostId: room.hostId
        });
    });

    // Lancer la partie
    socket.on('start-game', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;

        room.status = 'playing';
        room.deck = createDeck();
        room.discardPile = [room.deck.pop()];

        // Initialisation des grilles 3x4 (12 cartes par joueur, cachées au début)
        room.players.forEach(player => {
            room.playersGrids[player.id] = [];
            for (let i = 0; i < 12; i++) {
                room.playersGrids[player.id].push({
                    value: room.deck.pop(),
                    isRevealed: false
                });
            }
        });

        io.to(roomCode).emit('game-started');
        sendGameState(roomCode);
    });

    // Gestion des actions en jeu (clic sur grille, etc.)
    socket.on('player-action', ({ roomCode, action, index }) => {
        const room = rooms[roomCode];
        if (!room || room.status !== 'playing') return;

        const grid = room.playersGrids[socket.id];
        if (grid && grid[index]) {
            // Pour l'exemple, révéler la carte cliquée
            grid[index].isRevealed = true;
            sendGameState(roomCode);
        }
    });

    socket.on('disconnect', () => {
        console.log(`Utilisateur déconnecté : ${socket.id}`);
        // Nettoyage basique des salons vides ou gestion des hôtes déconnectés
        for (const code in rooms) {
            const room = rooms[code];
            room.players = room.players.filter(p => p.id !== socket.id);
            if (room.players.length === 0) {
                delete rooms[code];
            } else if (room.hostId === socket.id) {
                room.hostId = room.players[0].id;
                io.to(code).emit('update-players', {
                    players: room.players,
                    hostId: room.hostId
                });
            }
        }
    });
});

function sendGameState(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    const turnPlayer = room.players[room.turnIndex];

    const gameState = {
        topDiscard: room.discardPile[room.discardPile.length - 1],
        turnPlayerName: turnPlayer ? turnPlayer.username : '',
        playersGrids: room.playersGrids
    };

    io.to(roomCode).emit('game-state-update', gameState);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serveur Skyjo lancé sur le port ${PORT}`);
});