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
    // Mélange Fisher-Yates
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

io.on('connection', (socket) => {
    console.log(`Utilisateur connecté : ${socket.id}`);

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
            initRevealedCount: {},
            turnIndex: 0,
            turnPhase: 'draw',
            drawnCard: null,
            drawnSource: null
        };

        socket.join(roomCode);
        socket.emit('room-joined', {
            roomCode,
            players: rooms[roomCode].players,
            hostId: socket.id
        });
    });

    socket.on('join-room', ({ username, code }) => {
        const room = rooms[code];
        if (!room) {
            socket.emit('error-message', "Salon introuvable.");
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

    socket.on('start-game', (roomCode) => {
        const room = rooms[roomCode];
        if (!room || room.hostId !== socket.id) return;

        room.status = 'initializing';
        room.deck = createDeck();
        room.discardPile = [room.deck.pop()];

        room.players.forEach(player => {
            room.playersGrids[player.id] = [];
            room.initRevealedCount[player.id] = 0;
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

    socket.on('player-action', (data) => {
        const room = rooms[data.roomCode];
        if (!room) return;

        const { action, index } = data;
        const playerId = socket.id;

        // Phase 1 : Révéler 2 cartes au départ
        if (room.status === 'initializing') {
            const grid = room.playersGrids[playerId];
            if (grid && grid[index] && !grid[index].isRevealed) {
                grid[index].isRevealed = true;
                room.initRevealedCount[playerId]++;

                let allDone = true;
                room.players.forEach(p => {
                    if (room.initRevealedCount[p.id] < 2) allDone = false;
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

        // Phase 2 : Tour par tour officiel
        if (room.status === 'playing') {
            const currentTurnPlayer = room.players[room.turnIndex];
            if (currentTurnPlayer.id !== playerId) return; // Ce n'est pas ton tour

            // Étape A : Piocher
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

            // Étape B : Action avec la carte piochée
            if (room.turnPhase === 'action') {
                const grid = room.playersGrids[playerId];

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

function nextTurn(room, roomCode) {
    let gameEnded = false;
    room.players.forEach(p => {
        const grid = room.playersGrids[p.id];
        if (grid.every(c => c.isRevealed)) {
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
        room.playersGrids[p.id].forEach(c => {
            total += parseInt(c.value, 10);
        });
        scores[p.username] = total;
    });
    return scores;
}

function sendGameState(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    const currentTurnPlayer = room.players[room.turnIndex];

    const gameState = {
        status: room.status,
        topDiscard: room.discardPile.length > 0 ? room.discardPile[room.discardPile.length - 1] : null,
        turnPlayerId: currentTurnPlayer ? currentTurnPlayer.id : null,
        turnPlayerName: currentTurnPlayer ? currentTurnPlayer.username : '',
        turnPhase: room.turnPhase,
        drawnCard: room.drawnCard,
        drawnSource: room.drawnSource,
        playersGrids: room.playersGrids,
        players: room.players,
        initRevealedCount: room.initRevealedCount
    };

    io.to(roomCode).emit('game-state-update', gameState);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Serveur Skyjo lancé sur le port ${PORT}`);
});
