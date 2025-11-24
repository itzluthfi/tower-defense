require('dotenv').config();
const WebSocket = require('ws');
const http = require('http');
const express = require('express');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Game state yang di-share ke semua clients
let gameState = {
    players: {},
    towers: [],
    enemies: [],
    wave: 1,
    lives: 20,
    gold: 500,
    waveInProgress: false
};

// Store all connected clients
const clients = new Map();

// Broadcast to all clients
function broadcast(data, excludeClient = null) {
    const message = JSON.stringify(data);
    wss.clients.forEach(client => {
        if (client !== excludeClient && client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

// Send to specific client
function sendToClient(client, data) {
    if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data));
    }
}

wss.on('connection', (ws) => {
    console.log('New client connected');
    
    // Send current game state to new client
    sendToClient(ws, {
        type: 'gameState',
        data: gameState
    });

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            
            switch(data.type) {
                case 'playerJoined':
                    handlePlayerJoined(ws, data);
                    break;
                    
                case 'towerPlaced':
                    handleTowerPlaced(data);
                    break;
                    
                case 'startWave':
                    handleStartWave(data);
                    break;
                    
                case 'enemyDied':
                    handleEnemyDied(data);
                    break;
                    
                case 'enemyReachedBase':
                    handleEnemyReachedBase(data);
                    break;
                    
                case 'waveComplete':
                    handleWaveComplete(data);
                    break;
                    
                case 'chat':
                    handleChat(data);
                    break;
                    
                case 'syncGameState':
                    handleSyncGameState(data);
                    break;
                    
                default:
                    console.log('Unknown message type:', data.type);
            }
        } catch (error) {
            console.error('Error parsing message:', error);
        }
    });

    ws.on('close', () => {
        handlePlayerDisconnect(ws);
        console.log('Client disconnected');
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

function handlePlayerJoined(ws, data) {
    const { playerId, playerName } = data;
    
    // Add player to game state
    gameState.players[playerId] = {
        name: playerName,
        score: 0,
        towersPlaced: 0
    };
    
    // Store client info
    clients.set(ws, { playerId, playerName });
    
    // Notify all clients
    broadcast({
        type: 'playerJoined',
        playerId: playerId,
        playerName: playerName
    });
    
    // Send updated game state
    broadcast({
        type: 'gameState',
        data: gameState
    });
    
    console.log(`Player ${playerName} (${playerId}) joined the game`);
}

function handleTowerPlaced(data) {
    const { playerId, playerName, tower, towerType } = data;
    
    // Add tower to game state
    gameState.towers.push(tower);
    
    // Update player stats
    if (gameState.players[playerId]) {
        gameState.players[playerId].towersPlaced++;
        gameState.players[playerId].score += 10;
    }
    
    // Broadcast to all clients
    broadcast({
        type: 'towerPlaced',
        playerId: playerId,
        playerName: playerName,
        tower: tower,
        towerType: towerType
    });
    
    console.log(`${playerName} placed a ${towerType} tower at (${tower.x}, ${tower.y})`);
}

function handleStartWave(data) {
    if (gameState.waveInProgress) {
        return;
    }
    
    gameState.waveInProgress = true;
    
    broadcast({
        type: 'waveStarted',
        wave: gameState.wave
    });
    
    console.log(`Wave ${gameState.wave} started`);
}

function handleEnemyDied(data) {
    const { enemyId, killerId, reward } = data;
    
    // Add gold
    gameState.gold += reward;
    
    // Update player score
    if (gameState.players[killerId]) {
        gameState.players[killerId].score += reward;
    }
    
    broadcast({
        type: 'enemyDied',
        enemyId: enemyId,
        killerId: killerId,
        reward: reward,
        currentGold: gameState.gold
    });
}

function handleEnemyReachedBase(data) {
    gameState.lives--;
    
    broadcast({
        type: 'enemyReachedBase',
        lives: gameState.lives
    });
    
    // Check game over
    if (gameState.lives <= 0) {
        broadcast({
            type: 'gameOver',
            finalWave: gameState.wave,
            players: gameState.players
        });
        console.log('Game Over!');
    }
}

function handleWaveComplete(data) {
    const { wave, goldEarned } = data;
    
    gameState.gold += goldEarned;
    gameState.wave++;
    gameState.waveInProgress = false;
    
    broadcast({
        type: 'waveComplete',
        wave: wave,
        goldEarned: goldEarned,
        nextWave: gameState.wave,
        currentGold: gameState.gold
    });
    
    console.log(`Wave ${wave} completed! Next wave: ${gameState.wave}`);
}

function handleChat(data) {
    const { playerId, playerName, message } = data;
    
    broadcast({
        type: 'chat',
        playerId: playerId,
        playerName: playerName,
        message: message,
        timestamp: Date.now()
    });
    
    console.log(`[Chat] ${playerName}: ${message}`);
}

function handleSyncGameState(data) {
    // Update server game state from client
    // This handles real-time synchronization
    if (data.towers) gameState.towers = data.towers;
    if (data.enemies) gameState.enemies = data.enemies;
    if (data.gold !== undefined) gameState.gold = data.gold;
    if (data.lives !== undefined) gameState.lives = data.lives;
    
    broadcast({
        type: 'gameState',
        data: gameState
    }, data.sender);
}

function handlePlayerDisconnect(ws) {
    const clientInfo = clients.get(ws);
    
    if (clientInfo) {
        const { playerId, playerName } = clientInfo;
        
        // Remove player from game state
        delete gameState.players[playerId];
        
        // Notify other clients
        broadcast({
            type: 'playerLeft',
            playerId: playerId,
            playerName: playerName
        });
        
        // Send updated game state
        broadcast({
            type: 'gameState',
            data: gameState
        });
        
        clients.delete(ws);
        console.log(`Player ${playerName} (${playerId}) left the game`);
    }
}

// Reset game endpoint
app.post('/reset', (req, res) => {
    gameState = {
        players: {},
        towers: [],
        enemies: [],
        wave: 1,
        lives: 20,
        gold: 500,
        waveInProgress: false
    };
    
    broadcast({
        type: 'gameReset'
    });
    
    res.json({ success: true, message: 'Game reset successfully' });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        connectedPlayers: Object.keys(gameState.players).length,
        wave: gameState.wave,
        lives: gameState.lives
    });
});

app.get('/config.js', (req, res) => {
    res.type('application/javascript');
    res.send(`
        // Konfigurasi Klien yang diambil dari .env server
        const CONFIG = {
            WS_URL: 'ws://${process.env.WS_HOST || 'localhost'}:${process.env.PORT || 8080}'
        };
    `);
});

const PORT = process.env.PORT || 8080;
const WS_HOST = process.env.WS_HOST || 'localhost';

server.listen(PORT, () => {
    console.log(`🎮 Tower Defense Server running on port ${PORT}`);
    console.log(`📡 WebSocket Server: ws://${WS_HOST}:${PORT}`);
    console.log(`🌐 Web Client: http://${WS_HOST}:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
    });
});