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

// Game state
let gameState = {
    attacker: null,
    defender: null,
    attackerGold: 1000,
    defenderGold: 1000,
    baseHP: 100,
    towers: [],
    troops: [],
    gameStatus: 'waiting', // waiting, playing, finished
    gameStartTime: 0
};

// Store clients
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
    
    // Send current game state
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
                    
                case 'troopDeployed':
                    handleTroopDeployed(data);
                    break;
                    
                case 'towerPlaced':
                    handleTowerPlaced(data);
                    break;
                    
                case 'baseHit':
                    handleBaseHit(data);
                    break;
                    
                case 'gameOver':
                    handleGameOver(data);
                    break;
                    
                case 'chat':
                    handleChat(data);
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
    const { playerId, playerName, role } = data;
    
    // Check if role is available
    if (role === 'attacker' && gameState.attacker) {
        sendToClient(ws, {
            type: 'error',
            message: 'Attacker role already taken'
        });
        return;
    }
    
    if (role === 'defender' && gameState.defender) {
        sendToClient(ws, {
            type: 'error',
            message: 'Defender role already taken'
        });
        return;
    }
    
    // Assign role
    if (role === 'attacker') {
        gameState.attacker = { id: playerId, name: playerName };
    } else {
        gameState.defender = { id: playerId, name: playerName };
    }
    
    // Store client info
    clients.set(ws, { playerId, playerName, role });
    
    // Notify all clients
    broadcast({
        type: 'playerJoined',
        playerId: playerId,
        playerName: playerName,
        role: role
    });
    
    console.log(`Player ${playerName} joined as ${role}`);
    
    // Check if both players ready - start game
    if (gameState.attacker && gameState.defender && gameState.gameStatus === 'waiting') {
        gameState.gameStatus = 'playing';
        gameState.gameStartTime = Date.now();
        
        broadcast({
            type: 'gameStarted'
        });
        
        console.log('Game started!');
    }
    
    // Send updated game state
    broadcast({
        type: 'gameState',
        data: gameState
    });
}

function handleTroopDeployed(data) {
    const { playerId, troop, gold } = data;
    
    // Add troop to game state
    gameState.troops.push(troop);
    gameState.attackerGold = gold;
    
    // Broadcast to all clients
    broadcast({
        type: 'troopDeployed',
        playerId: playerId,
        troop: troop,
        gold: gold
    });
    
    console.log(`Troop deployed: ${troop.type} in lane ${troop.lane}`);
}

function handleTowerPlaced(data) {
    const { playerId, tower, gold } = data;
    
    // Add tower to game state
    gameState.towers.push(tower);
    gameState.defenderGold = gold;
    
    // Broadcast to all clients
    broadcast({
        type: 'towerPlaced',
        playerId: playerId,
        tower: tower,
        gold: gold
    });
    
    console.log(`Tower placed: ${tower.type} at (${tower.x}, ${tower.y})`);
}

function handleBaseHit(data) {
    const { baseHP, damage } = data;
    
    gameState.baseHP = baseHP;
    
    broadcast({
        type: 'baseHit',
        baseHP: baseHP,
        damage: damage
    });
    
    console.log(`Base hit! Damage: ${damage}, HP: ${baseHP}`);
    
    // Check game over
    if (baseHP <= 0) {
        gameState.gameStatus = 'finished';
        
        broadcast({
            type: 'gameOver',
            winner: 'Attacker',
            reason: 'Base destroyed'
        });
        
        console.log('Game Over - Attacker wins!');
    }
}

function handleGameOver(data) {
    const { winner, reason } = data;
    
    gameState.gameStatus = 'finished';
    
    broadcast({
        type: 'gameOver',
        winner: winner,
        reason: reason
    });
    
    console.log(`Game Over - ${winner} wins! Reason: ${reason}`);
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

function handlePlayerDisconnect(ws) {
    const clientInfo = clients.get(ws);
    
    if (clientInfo) {
        const { playerId, playerName, role } = clientInfo;
        
        // Clear role
        if (role === 'attacker') {
            gameState.attacker = null;
        } else {
            gameState.defender = null;
        }
        
        // If game was playing, end it
        if (gameState.gameStatus === 'playing') {
            gameState.gameStatus = 'finished';
            
            broadcast({
                type: 'gameOver',
                winner: role === 'attacker' ? 'Defender' : 'Attacker',
                reason: 'Opponent disconnected'
            });
        }
        
        // Notify other clients
        broadcast({
            type: 'playerLeft',
            playerId: playerId,
            playerName: playerName,
            role: role
        });
        
        clients.delete(ws);
        console.log(`Player ${playerName} (${role}) left the game`);
    }
}

// Reset game endpoint
app.post('/reset', (req, res) => {
    gameState = {
        attacker: null,
        defender: null,
        attackerGold: 1000,
        defenderGold: 1000,
        baseHP: 100,
        towers: [],
        troops: [],
        gameStatus: 'waiting',
        gameStartTime: 0
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
        attacker: gameState.attacker ? gameState.attacker.name : 'Waiting',
        defender: gameState.defender ? gameState.defender.name : 'Waiting',
        gameStatus: gameState.gameStatus,
        baseHP: gameState.baseHP
    });
});

// Config endpoint
app.get('/config.js', (req, res) => {
    res.type('application/javascript');
    res.send(`
        const CONFIG = {
            WS_URL: 'ws://${process.env.WS_HOST || 'localhost'}:${process.env.PORT || 8080}'
        };
    `);
});

const PORT = process.env.PORT || 8080;
const WS_HOST = process.env.WS_HOST || 'localhost';

server.listen(PORT, () => {
    console.log(`🎮 PvP Tower Defense Server running on port ${PORT}`);
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