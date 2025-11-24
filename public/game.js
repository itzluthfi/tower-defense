// Game State
let gameState = {
    players: {},
    towers: [],
    enemies: [],
    projectiles: [],
    wave: 1,
    lives: 20,
    gold: 500,
    gameStatus: 'waiting',
    waveInProgress: false
};

let playerId = null;
let playerName = '';
let selectedTowerType = 'basic';
let ws = null;
let reconnectInterval = null;

const TOWER_TYPES = {
    basic: { name: 'Basic', cost: 100, damage: 10, range: 120, speed: 1000, color: '#3b82f6', emoji: '⚔️' },
    sniper: { name: 'Sniper', cost: 200, damage: 50, range: 200, speed: 2000, color: '#ef4444', emoji: '🎯' },
    rapid: { name: 'Rapid', cost: 150, damage: 5, range: 100, speed: 300, color: '#10b981', emoji: '⚡' },
    splash: { name: 'Splash', cost: 250, damage: 15, range: 110, speed: 1500, color: '#f59e0b', emoji: '💥', splashRadius: 50 }
};

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const PATH = [
    {x: 0, y: 300}, {x: 200, y: 300}, {x: 200, y: 150}, 
    {x: 400, y: 150}, {x: 400, y: 450}, {x: 600, y: 450},
    {x: 600, y: 300}, {x: 800, y: 300}
];

// WebSocket Connection
function connectWebSocket() {
    // Change this to your server URL
    const wsUrl = 'ws://localhost:8080';
    
    try {
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            console.log('Connected to server');
            updateConnectionStatus(true);
            addMessage('Connected to server!', 'system');
            
            // Clear reconnect interval
            if (reconnectInterval) {
                clearInterval(reconnectInterval);
                reconnectInterval = null;
            }
        };
        
        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleServerMessage(data);
            } catch (error) {
                console.error('Error parsing message:', error);
            }
        };
        
        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            addMessage('Connection error. Reconnecting...', 'error');
        };
        
        ws.onclose = () => {
            console.log('Disconnected from server');
            updateConnectionStatus(false);
            addMessage('Disconnected from server. Reconnecting...', 'error');
            
            // Auto reconnect
            if (!reconnectInterval) {
                reconnectInterval = setInterval(() => {
                    console.log('Attempting to reconnect...');
                    connectWebSocket();
                }, 3000);
            }
        };
    } catch (error) {
        console.error('Failed to connect:', error);
        addMessage('Failed to connect to server', 'error');
    }
}

function updateConnectionStatus(connected) {
    const statusEl = document.getElementById('connectionStatus');
    if (connected) {
        statusEl.className = 'flex items-center gap-2 px-4 py-2 bg-green-100 text-green-700 rounded-full font-semibold';
        statusEl.innerHTML = '<span class="w-3 h-3 bg-green-500 rounded-full pulse"></span> Connected';
    } else {
        statusEl.className = 'flex items-center gap-2 px-4 py-2 bg-red-100 text-red-700 rounded-full font-semibold';
        statusEl.innerHTML = '<span class="w-3 h-3 bg-red-500 rounded-full"></span> Disconnected';
    }
}

function handleServerMessage(data) {
    switch(data.type) {
        case 'gameState':
            // Merge server state dengan client state
            gameState.players = data.data.players || {};
            gameState.wave = data.data.wave || 1;
            gameState.lives = data.data.lives || 20;
            gameState.gold = data.data.gold || 500;
            updateUI();
            break;
            
        case 'playerJoined':
            gameState.players[data.playerId] = { name: data.playerName, score: 0 };
            addMessage(`${data.playerName} joined the battle!`, 'join');
            updateUI();
            break;
            
        case 'playerLeft':
            if (gameState.players[data.playerId]) {
                addMessage(`${data.playerName} left the game`, 'error');
                delete gameState.players[data.playerId];
                updateUI();
            }
            break;
            
        case 'towerPlaced':
            if (data.playerId !== playerId) {
                gameState.towers.push(data.tower);
                addMessage(`${data.playerName} placed a ${data.towerType} tower`, 'tower');
            }
            break;
            
        case 'waveStarted':
            addMessage(`🌊 Wave ${data.wave} started!`, 'system');
            gameState.waveInProgress = true;
            break;
            
        case 'waveComplete':
            gameState.gold = data.currentGold;
            gameState.wave = data.nextWave;
            gameState.waveInProgress = false;
            addMessage(`Wave ${data.wave} completed! +${data.goldEarned} gold`, 'success');
            updateUI();
            break;
            
        case 'enemyDied':
            gameState.gold = data.currentGold;
            updateUI();
            break;
            
        case 'enemyReachedBase':
            gameState.lives = data.lives;
            addMessage('An enemy reached the base! -1 life', 'error');
            updateUI();
            break;
            
        case 'gameOver':
            addMessage('💀 Game Over! All lives lost.', 'error');
            gameState.waveInProgress = false;
            break;
            
        case 'chat':
            if (data.playerId !== playerId) {
                addMessage(`${data.playerName}: ${data.message}`, 'chat');
            }
            break;
            
        case 'gameReset':
            addMessage('Game has been reset by server', 'system');
            resetGame();
            break;
    }
}

function sendToServer(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    } else {
        addMessage('Not connected to server', 'error');
    }
}

function joinGame() {
    const nameInput = document.getElementById('playerNameInput');
    playerName = nameInput.value.trim();
    
    if (playerName.length === 0) {
        alert('Please enter your name!');
        return;
    }

    playerId = 'player_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    document.getElementById('nameModal').style.display = 'none';
    
    connectWebSocket();
    
    // Wait for connection then send join message
    const waitForConnection = setInterval(() => {
        if (ws && ws.readyState === WebSocket.OPEN) {
            sendToServer({
                type: 'playerJoined',
                playerId: playerId,
                playerName: playerName
            });
            clearInterval(waitForConnection);
        }
    }, 100);

    startGameLoop();
}

function selectTower(type) {
    selectedTowerType = type;
    document.querySelectorAll('.tower-btn').forEach(btn => {
        btn.classList.remove('selected');
    });
    document.getElementById('tower-' + type).classList.add('selected');
}

function addMessage(text, type = 'info') {
    const log = document.getElementById('messageLog');
    const msg = document.createElement('div');
    msg.className = 'text-sm p-2 rounded-lg';
    
    const colors = {
        system: 'bg-blue-100 text-blue-800',
        join: 'bg-green-100 text-green-800',
        tower: 'bg-purple-100 text-purple-800',
        success: 'bg-yellow-100 text-yellow-800',
        chat: 'bg-gray-100 text-gray-800',
        error: 'bg-red-100 text-red-800'
    };
    
    msg.className += ' ' + (colors[type] || colors.info);
    
    const timestamp = new Date().toLocaleTimeString();
    msg.textContent = `[${timestamp}] ${text}`;
    
    log.appendChild(msg);
    log.scrollTop = log.scrollHeight;
}

function sendChat() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    
    if (message) {
        sendToServer({
            type: 'chat',
            playerId: playerId,
            playerName: playerName,
            message: message
        });
        
        addMessage(`You: ${message}`, 'chat');
        input.value = '';
    }
}

canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    
    const towerType = TOWER_TYPES[selectedTowerType];
    
    if (gameState.gold >= towerType.cost) {
        if (!isOnPath(x, y)) {
            const tower = {
                id: 'tower_' + Date.now(),
                type: selectedTowerType,
                x: x,
                y: y,
                lastShot: 0,
                owner: playerId
            };
            
            gameState.towers.push(tower);
            gameState.gold -= towerType.cost;
            
            sendToServer({
                type: 'towerPlaced',
                playerId: playerId,
                playerName: playerName,
                tower: tower,
                towerType: towerType.name
            });
            
            addMessage(`You placed a ${towerType.name} tower!`, 'tower');
            updateUI();
        } else {
            addMessage('Cannot place tower on path!', 'error');
        }
    } else {
        addMessage('Not enough gold!', 'error');
    }
});

function isOnPath(x, y) {
    for (let i = 0; i < PATH.length - 1; i++) {
        const dist = distanceToLineSegment(x, y, PATH[i].x, PATH[i].y, PATH[i+1].x, PATH[i+1].y);
        if (dist < 30) return true;
    }
    return false;
}

function distanceToLineSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
    const closestX = x1 + t * dx;
    const closestY = y1 + t * dy;
    return Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2);
}

function startWave() {
    if (gameState.waveInProgress) {
        addMessage('Wave already in progress!', 'error');
        return;
    }
    
    sendToServer({
        type: 'startWave',
        wave: gameState.wave
    });
    
    gameState.waveInProgress = true;
    
    const enemyCount = 5 + gameState.wave * 3;
    const enemyHealth = 20 + gameState.wave * 10;
    const enemySpeed = 0.5 + gameState.wave * 0.1;
    
    for (let i = 0; i < enemyCount; i++) {
        setTimeout(() => {
            gameState.enemies.push({
                id: 'enemy_' + Date.now() + '_' + i,
                health: enemyHealth,
                maxHealth: enemyHealth,
                speed: enemySpeed,
                pathIndex: 0,
                progress: 0,
                x: PATH[0].x,
                y: PATH[0].y,
                reward: 10 + gameState.wave * 2
            });
        }, i * 1000);
    }
}

function updateUI() {
    document.getElementById('livesCount').textContent = gameState.lives;
    document.getElementById('goldCount').textContent = gameState.gold;
    document.getElementById('waveCount').textContent = gameState.wave;
    document.getElementById('playersCount').textContent = Object.keys(gameState.players).length;
    
    const playersList = document.getElementById('playersList');
    playersList.innerHTML = '';
    
    if (Object.keys(gameState.players).length === 0) {
        playersList.innerHTML = '<div class="text-gray-500 text-center py-4">Waiting for players...</div>';
    } else {
        Object.entries(gameState.players).forEach(([id, player]) => {
            const div = document.createElement('div');
            div.className = 'bg-gradient-to-r from-purple-100 to-pink-100 p-3 rounded-lg flex justify-between items-center';
            
            const isMe = id === playerId;
            div.innerHTML = `
                <span class="font-bold text-gray-800">${player.name} ${isMe ? '(You)' : ''}</span>
                <span class="text-purple-600 font-semibold">⭐ ${player.score || 0}</span>
            `;
            playersList.appendChild(div);
        });
    }
}

function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw path
    ctx.strokeStyle = '#a78bfa';
    ctx.lineWidth = 40;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(PATH[0].x, PATH[0].y);
    for (let i = 1; i < PATH.length; i++) {
        ctx.lineTo(PATH[i].x, PATH[i].y);
    }
    ctx.stroke();

    // Update and draw enemies
    for (let i = gameState.enemies.length - 1; i >= 0; i--) {
        const enemy = gameState.enemies[i];
        
        if (enemy.pathIndex < PATH.length - 1) {
            const current = PATH[enemy.pathIndex];
            const next = PATH[enemy.pathIndex + 1];
            const dx = next.x - current.x;
            const dy = next.y - current.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            enemy.progress += enemy.speed;
            
            if (enemy.progress >= distance) {
                enemy.progress = 0;
                enemy.pathIndex++;
            }
            
            const t = enemy.progress / distance;
            enemy.x = current.x + dx * t;
            enemy.y = current.y + dy * t;
        } else {
            // Enemy reached end
            gameState.lives--;
            gameState.enemies.splice(i, 1);
            
            sendToServer({
                type: 'enemyReachedBase',
                lives: gameState.lives
            });
            
            updateUI();
            
            if (gameState.lives <= 0) {
                gameState.waveInProgress = false;
            }
            continue;
        }
        
        // Draw enemy
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(enemy.x, enemy.y, 12, 0, Math.PI * 2);
        ctx.fill();
        
        // Health bar
        ctx.fillStyle = '#000';
        ctx.fillRect(enemy.x - 15, enemy.y - 20, 30, 4);
        ctx.fillStyle = '#10b981';
        ctx.fillRect(enemy.x - 15, enemy.y - 20, 30 * (enemy.health / enemy.maxHealth), 4);
    }

    // Update and draw towers
    const now = Date.now();
    gameState.towers.forEach(tower => {
        const towerType = TOWER_TYPES[tower.type];
        
        // Draw tower
        ctx.fillStyle = towerType.color;
        ctx.beginPath();
        ctx.arc(tower.x, tower.y, 15, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(towerType.emoji, tower.x, tower.y);
        
        // Draw range
        ctx.strokeStyle = towerType.color + '33';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(tower.x, tower.y, towerType.range, 0, Math.PI * 2);
        ctx.stroke();
        
        // Find and shoot enemies
        if (now - tower.lastShot >= towerType.speed) {
            let target = null;
            let maxProgress = -1;
            
            gameState.enemies.forEach(enemy => {
                const dist = Math.sqrt((enemy.x - tower.x) ** 2 + (enemy.y - tower.y) ** 2);
                const progress = enemy.pathIndex * 1000 + enemy.progress;
                if (dist <= towerType.range && progress > maxProgress) {
                    target = enemy;
                    maxProgress = progress;
                }
            });
            
            if (target) {
                tower.lastShot = now;
                gameState.projectiles.push({
                    x: tower.x,
                    y: tower.y,
                    targetX: target.x,
                    targetY: target.y,
                    target: target,
                    damage: towerType.damage,
                    color: towerType.color,
                    type: tower.type,
                    speed: 5
                });
            }
        }
    });

    // Update and draw projectiles
    for (let i = gameState.projectiles.length - 1; i >= 0; i--) {
        const proj = gameState.projectiles[i];
        const dx = proj.targetX - proj.x;
        const dy = proj.targetY - proj.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        if (dist < proj.speed) {
            // Hit target
            if (proj.type === 'splash') {
                gameState.enemies.forEach(enemy => {
                    const d = Math.sqrt((enemy.x - proj.targetX) ** 2 + (enemy.y - proj.targetY) ** 2);
                    if (d <= 50) {
                        enemy.health -= proj.damage;
                    }
                });
            } else {
                proj.target.health -= proj.damage;
            }
            
            // Check if enemy died
            for (let j = gameState.enemies.length - 1; j >= 0; j--) {
                if (gameState.enemies[j].health <= 0) {
                    const enemy = gameState.enemies[j];
                    gameState.gold += enemy.reward;
                    
                    sendToServer({
                        type: 'enemyDied',
                        enemyId: enemy.id,
                        killerId: playerId,
                        reward: enemy.reward
                    });
                    
                    gameState.enemies.splice(j, 1);
                    updateUI();
                }
            }
            
            gameState.projectiles.splice(i, 1);
        } else {
            proj.x += (dx / dist) * proj.speed;
            proj.y += (dy / dist) * proj.speed;
            
            // Draw projectile
            ctx.fillStyle = proj.color;
            ctx.beginPath();
            ctx.arc(proj.x, proj.y, 5, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Check wave completion
    if (gameState.waveInProgress && gameState.enemies.length === 0) {
        const goldEarned = 50 + gameState.wave * 20;
        
        sendToServer({
            type: 'waveComplete',
            wave: gameState.wave,
            goldEarned: goldEarned
        });
        
        gameState.waveInProgress = false;
    }
}

function startGameLoop() {
    setInterval(gameLoop, 1000 / 60);
}

function resetGame() {
    if (confirm('Are you sure you want to reset the game?')) {
        gameState.towers = [];
        gameState.enemies = [];
        gameState.projectiles = [];
        gameState.wave = 1;
        gameState.lives = 20;
        gameState.gold = 500;
        gameState.waveInProgress = false;
        
        addMessage('Game reset! Ready to defend again.', 'system');
        updateUI();
    }
}

// Initialize
updateUI();