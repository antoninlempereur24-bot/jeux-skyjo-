const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

const rooms = {};

function generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return rooms[code] ? generateRoomCode() : code;
}

function createDeck() {
    const cardCounts = {
        "-4": 5, "-2": 5, "-1": 5, "0": 15,
        "1": 10, "2": 10, "3": 10, "4": 10, "5": 10, "6": 10,
        "7": 10, "8": 10, "9": 10, "10": 10, "11": 10, "12": 10, "13": 10,
        "20": 5
    };
    let deck = [];
    for (let val in cardCounts) {
        for (let i = 0; i < cardCounts[val]; i++) {
            deck.push(val);
        }
    }
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

io.on('connection', (socket) => {
    console.log(`Connexion : ${socket.id}`);

    socket.on('create-room', (username) => {
        const cleanName = username.trim();
        const roomCode = generateRoomCode();
        rooms[roomCode] = {
            code: roomCode,
            hostId: socket.id,
            players: [{ id: socket.id, username: cleanName }],
            status: 'waiting',
            deck: [],
            discardPile: [],
            playersGrids: {},
            initRevealedCount: {},
            turnIndex: 0,
            turnPhase: 'draw',
            drawnCard: null,
            drawnSource: null
        };

        socket.join(roomCode);
        socket.emit('room-joined', { roomCode, players: rooms[roomCode].players, hostId: socket.id });
    });

    socket.on('join-room', ({ username, code }) => {
        const room = rooms[code];
        const cleanName = username.trim();
        if (!room) {
            socket.emit('error-message', "Salon introuvable.");
            return;
        }

        const existingPlayer = room.players.find(p => p.username.toLowerCase() === cleanName.toLowerCase());
        if (existingPlayer) {
            existingPlayer.id = socket.id;
            if (room.hostId === room.players[0].id) {
                room.hostId = socket.id;
            }
        } else {
            if (room.status !== 'waiting') {
                socket.emit('error-message', "La partie a déjà commencé.");
                return;
            }
            room.players.push({ id: socket.id, username: cleanName });
        }

        socket.join(code);

        io.to(code).emit('update-players', { players: room.players, hostId: room.hostId });
        socket.emit('room-joined', { roomCode: code, players: room.players, hostId: room.hostId });
    });

    socket.on('start-game', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;

        room.status = 'initializing';
        room.deck = createDeck();
        room.discardPile = [room.deck.pop()];

        room.players.forEach(player => {
            room.playersGrids[player.username] = [];
            room.initRevealedCount[player.username] = 0;
            for (let i = 0; i < 12; i++) {
                room.playersGrids[player.username].push({
                    value: room.deck.pop(),
                    isRevealed: false
                });
            }
        });

        io.to(roomCode).emit('game-started');
        sendGameState(roomCode);
    });

    socket.on('player-action', (data) => {
        const room = rooms[data.roomCode];
        if (!room) {
            socket.emit('error-message', "Salon introuvable ou expiré.");
            return;
        }

        const { action, index } = data;
        const player = room.players.find(p => p.id === socket.id);
        if (!player) return;
        const username = player.username;

        if (room.status === 'initializing') {
            const grid = room.playersGrids[username];
            if (grid && grid[index] && !grid[index].isRevealed) {
                grid[index].isRevealed = true;
                room.initRevealedCount[username] = (room.initRevealedCount[username] || 0) + 1;

                let allDone = true;
                room.players.forEach(p => {
                    if ((room.initRevealedCount[p.username] || 0) < 2) allDone = false;
                });

                if (allDone) {
                    room.status = 'playing';
                    room.turnIndex = 0;
                    room.turnPhase = 'draw';
                }
                sendGameState(roomCode);
            }
            return;
        }

        if (room.status === 'playing') {
            const currentTurnPlayer = room.players[room.turnIndex];
            if (!currentTurnPlayer || currentTurnPlayer.id !== socket.id) return;

            if (room.turnPhase === 'draw') {
                if (action === 'draw-deck') {
                    if (room.deck.length === 0) {
                        const top = room.discardPile.pop();
                        room.deck = room.discardPile;
                        room.discardPile = [top];
                        for (let i = room.deck.length - 1; i > 0; i--) {
                            const j = Math.floor(Math.random() * (i + 1));
                            [room.deck[i], room.deck[j]] = [room.deck[j], room.deck[i]];
                        }
                    }
                    if (room.deck.length > 0) {
                        room.drawnCard = room.deck.pop();
                        room.drawnSource = 'deck';
                        room.turnPhase = 'action';
                    }
                } else if (action === 'draw-discard') {
                    if (room.discardPile.length > 0) {
                        room.drawnCard = room.discardPile.pop();
                        room.drawnSource = 'discard';
                        room.turnPhase = 'action';
                    }
                }
                sendGameState(roomCode);
                return;
            }

            if (room.turnPhase === 'action') {
                const grid = room.playersGrids[username];

                if (action === 'place-grid' && grid && grid[index]) {
                    const oldCard = grid[index].value;
                    grid[index].value = room.drawnCard;
                    grid[index].isRevealed = true;

                    room.discardPile.push(oldCard);
                    room.drawnCard = null;
                    room.drawnSource = null;

                    nextTurn(room, roomCode);
                } else if (action === 'discard-drawn' && room.drawnSource === 'deck') {
                    room.discardPile.push(room.drawnCard);
                    room.drawnCard = null;
                    room.drawnSource = null;
                    room.turnPhase = 'reveal-one';
                    sendGameState(roomCode);
                    return;
                } else if (action === 'reveal-hidden' && room.turnPhase === 'reveal-one' && grid && grid[index] && !grid[index].isRevealed) {
                    grid[index].isRevealed = true;
                    room.turnPhase = 'draw';
                    nextTurn(room, roomCode);
                }
            }
        }
    });

    socket.on('disconnect', () => {
        console.log(`Déconnexion : ${socket.id}`);
    });
});

function nextTurn(room, roomCode) {
    let gameEnded = false;
    room.players.forEach(p => {
        const grid = room.playersGrids[p.username];
        if (grid && grid.every(c => c.isRevealed)) {
            room.status = 'finished';
            gameEnded = true;
        }
    });

    if (gameEnded) {
        io.to(roomCode).emit('game-over', calculateScores(room));
        return;
    }

    room.turnIndex = (room.turnIndex + 1) % room.players.length;
    room.turnPhase = 'draw';
    sendGameState(roomCode);
}

function calculateScores(room) {
    const scores = {};
    room.players.forEach(p => {
        let total = 0;
        if (room.playersGrids[p.username]) {
            room.playersGrids[p.username].forEach(c => {
                total += parseInt(c.value, 10);
            });
        }
        scores[p.username] = total;
    });
    return scores;
}

function sendGameState(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    const currentTurnPlayer = room.players[room.turnIndex];

    // Envoi sécurisé : chaque joueur ne voit que ses propres cartes révélées et les cartes des autres révélées
    room.players.forEach(p => {
        const socketGrids = {};
        room.players.forEach(otherP => {
            socketGrids[otherP.id] = (room.playersGrids[otherP.username] || []).map(card => ({
                isRevealed: card.isRevealed,
                value: card.isRevealed ? card.value : null
            }));
        });

        io.to(p.id).emit('game-state-update', {
            status: room.status,
            topDiscard: room.discardPile.length > 0 ? room.discardPile[room.discardPile.length - 1] : null,
            turnPlayerId: currentTurnPlayer ? currentTurnPlayer.id : null,
            turnPlayerName: currentTurnPlayer ? currentTurnPlayer.username : '',
            turnPhase: room.turnPhase,
            drawnCard: (currentTurnPlayer && currentTurnPlayer.id === p.id) ? room.drawnCard : null,
            drawnSource: room.drawnSource,
            playersGrids: socketGrids,
            players: room.players,
            initRevealedCount: room.initRevealedCount
        });
    });
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serveur Skyjo lancé sur le port ${PORT}`);
});
