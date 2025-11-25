// Game State
let gameState = {
    attacker: null,
    defender: null,
    attackerGold: 1000,
    defenderGold: 1000,
    baseHP: 100,
    towers: [],
    troops: [],
    projectiles: [],
    gameStatus: 'waiting', // waiting, playing, finished
    gameStartTime: 0
};

let playerId = null;
let playerName = '';
let playerRole = null; // 'attacker' or 'defender'
let selectedUnit = null;
let ws = null;
let reconnectInterval = null;
let gameTime = 0;

// Troop Types (for Attacker)
const TROOP_TYPES = {
    soldier: { 
        name: 'Soldier', 
        cost: 50, 
        health: 50, 
        maxHealth: 50,
        damage: 10, 
        speed: 1.2, 
        color: '#10b981', 
        emoji: '🪖',
        size: 10
    },
    tank: { 
        name: 'Tank', 
        cost: 150, 
        health: 200, 
        maxHealth: 200,
        damage: 5, 
        speed: 0.6, 
        color: '#6b7280', 
        emoji: '🚚',
        size: 15
    },
    runner: { 
        name: 'Runner', 
        cost: 80, 
        health: 30, 
        maxHealth: 30,
        damage: 8, 
        speed: 2.5, 
        color: '#fbbf24', 
        emoji: '🏃',
        size: 8
    },
    bomber: { 
        name: 'Bomber', 
        cost: 200, 
        health: 40, 
        maxHealth: 40,
        damage: 50, 
        speed: 1.0, 
        color: '#ef4444', 
        emoji: '💣',
        size: 12,
        explosive: true
    }
};

// Tower Types (for Defender)
const TOWER_TYPES = {
    basic: { 
        name: 'Basic Tower', 
        cost: 100, 
        damage: 15, 
        range: 120, 
        speed: 1000, 
        color: '#3b82f6', 
        emoji: '⚔️'
    },
    sniper: { 
        name: 'Sniper Tower', 
        cost: 250, 
        damage: 60, 
        range: 220, 
        speed: 2500, 
        color: '#ef4444', 
        emoji: '🎯'
    },
    rapid: { 
        name: 'Rapid Tower', 
        cost: 180, 
        damage: 8, 
        range: 100, 
        speed: 400, 
        color: '#10b981', 
        emoji: '⚡'
    },
    splash: { 
        name: 'Splash Tower', 
        cost: 300, 
        damage: 20, 
        range: 110, 
        speed: 1800, 
        color: '#f59e0b', 
        emoji: '💥', 
        splashRadius: 50
    }
};

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// 3 PATHS (Top, Middle, Bottom)
const PATHS = [
    // Path 1 (Top Lane)
    [
        {x: 0, y: 150}, {x: 300, y: 150}, {x: 300, y: 100}, 
        {x: 600, y: 100}, {x: 600, y: 150}, {x: 900, y: 150}
    ],
    // Path 2 (Middle Lane)
    [
        {x: 0, y: 350}, {x: 200, y: 350}, {x: 200, y: 300},
        {x: 450, y: 300}, {x: 450, y: 400}, {x: 700, y: 400},
        {x: 700, y: 350}, {x: 900, y: 350}
    ],
    // Path 3 (Bottom Lane)
    [
        {x: 0, y: 550}, {x: 300, y: 550}, {x: 300, y: 600},
        {x: 600, y: 600}, {x: 600, y: 550}, {x: 900, y: 550}
    ]
];

// Base position
const BASE_POS = {x: 900, y: 350};

// WebSocket Connection
function connectWebSocket() {
    const wsUrl = CONFIG.WS_URL;
    
    try {
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            console.log('Connected to server');
            updateConnectionStatus(true);
            addMessage('Connected to server!', 'system');
            
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
            addMessage('Connection error', 'error');
        };
        
        ws.onclose = () => {
            console.log('Disconnected');
            updateConnectionStatus(false);
            
            if (!reconnectInterval) {
                reconnectInterval = setInterval(() => {
                    connectWebSocket();
                }, 3000);
            }
        };
    } catch (error) {
        console.error('Failed to connect:', error);
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
            gameState = { ...gameState, ...data.data };
            updateUI();
            break;
            
        case 'playerJoined':
            if (data.role === 'attacker') {
                gameState.attacker = { id: data.playerId, name: data.playerName };
            } else {
                gameState.defender = { id: data.playerId, name: data.playerName };
            }
            addMessage(`${data.playerName} joined as ${data.role}`, 'join');
            updateUI();
            break;
            
        case 'gameStarted':
            gameState.gameStatus = 'playing';
            gameState.gameStartTime = Date.now();
            addMessage('⚔️ Game Started! Battle begins!', 'success');
            document.getElementById('waitingModal').classList.add('hidden');
            updateUI();
            break;
            
        case 'troopDeployed':
            if (data.playerId !== playerId) {
                gameState.troops.push(data.troop);
                gameState.attackerGold = data.gold;
                updateUI();
            }
            break;
            
        case 'towerPlaced':
            if (data.playerId !== playerId) {
                gameState.towers.push(data.tower);
                gameState.defenderGold = data.gold;
                updateUI();
            }
            break;
            
        case 'baseHit':
            gameState.baseHP = data.baseHP;
            addMessage(`💥 Base hit! HP: ${data.baseHP}`, 'error');
            updateUI();
            break;
            
        case 'gameOver':
            gameState.gameStatus = 'finished';
            addMessage(`🏆 ${data.winner} wins!`, 'success');
            setTimeout(() => {
                alert(`Game Over! Winner: ${data.winner}\nReason: ${data.reason}`);
            }, 1000);
            break;
            
        case 'chat':
            if (data.playerId !== playerId) {
                addMessage(`${data.playerName}: ${data.message}`, 'chat');
            }
            break;
            
        case 'playerLeft':
            addMessage(`${data.playerName} left the game`, 'error');
            if (gameState.gameStatus === 'playing') {
                gameState.gameStatus = 'finished';
                addMessage('Game ended - opponent disconnected', 'error');
            }
            break;
    }
}

function sendToServer(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function selectRole(role) {
    const nameInput = document.getElementById('playerNameInput');
    playerName = nameInput.value.trim();
    
    if (!playerName) {
        alert('Please enter your name!');
        return;
    }

    playerRole = role;
    playerId = 'player_' + Date.now();
    
    document.getElementById('roleModal').style.display = 'none';
    document.getElementById('waitingModal').classList.remove('hidden');
    
    // Update role display
    const roleEl = document.getElementById('playerRole');
    if (role === 'attacker') {
        roleEl.className = 'px-4 py-2 rounded-full font-bold text-white role-attacker';
        roleEl.textContent = '⚔️ Attacker';
        document.getElementById('attackerUnits').classList.remove('hidden');
    } else {
        roleEl.className = 'px-4 py-2 rounded-full font-bold text-white role-defender';
        roleEl.textContent = '🛡️ Defender';
        document.getElementById('defenderUnits').classList.remove('hidden');
    }
    
    connectWebSocket();
    
    setTimeout(() => {
        sendToServer({
            type: 'playerJoined',
            playerId: playerId,
            playerName: playerName,
            role: role
        });
    }, 500);

    startGameLoop();
}

function selectUnit(type) {
    selectedUnit = type;
    document.querySelectorAll('.unit-btn').forEach(btn => {
        btn.classList.remove('selected');
    });
    document.getElementById('unit-' + type).classList.add('selected');
}

canvas.addEventListener('click', (e) => {
    if (!selectedUnit || gameState.gameStatus !== 'playing') return;
    
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) * (canvas.width / rect.width);
    const y = (e.clientY - rect.top) * (canvas.height / rect.height);
    
    if (playerRole === 'attacker') {
        deployTroop(x, y);
    } else {
        placeTower(x, y);
    }
});

function deployTroop(x, y) {
    const troopType = TROOP_TYPES[selectedUnit];
    if (gameState.attackerGold < troopType.cost) {
        addMessage('Not enough gold!', 'error');
        return;
    }
    
    // Detect which lane was clicked
    let lane = -1;
    if (y < 250) lane = 0; // Top
    else if (y < 450) lane = 1; // Middle
    else lane = 2; // Bottom
    
    if (lane === -1) return;
    
    const path = PATHS[lane];
    const troop = {
        id: 'troop_' + Date.now(),
        type: selectedUnit,
        health: troopType.health,
        maxHealth: troopType.maxHealth,
        lane: lane,
        pathIndex: 0,
        progress: 0,
        x: path[0].x,
        y: path[0].y
    };
    
    gameState.troops.push(troop);
    gameState.attackerGold -= troopType.cost;
    
    sendToServer({
        type: 'troopDeployed',
        playerId: playerId,
        troop: troop,
        gold: gameState.attackerGold
    });
    
    addMessage(`Deployed ${troopType.name} to lane ${lane + 1}`, 'tower');
    updateUI();
}

function placeTower(x, y) {
    const towerType = TOWER_TYPES[selectedUnit];
    if (gameState.defenderGold < towerType.cost) {
        addMessage('Not enough gold!', 'error');
        return;
    }
    
    // Check if on path
    if (isOnAnyPath(x, y, 40)) {
        addMessage('Cannot place tower on path!', 'error');
        return;
    }
    
    const tower = {
        id: 'tower_' + Date.now(),
        type: selectedUnit,
        x: x,
        y: y,
        lastShot: 0
    };
    
    gameState.towers.push(tower);
    gameState.defenderGold -= towerType.cost;
    
    sendToServer({
        type: 'towerPlaced',
        playerId: playerId,
        tower: tower,
        gold: gameState.defenderGold
    });
    
    addMessage(`Placed ${towerType.name}`, 'tower');
    updateUI();
}

function isOnAnyPath(x, y, threshold) {
    for (const path of PATHS) {
        for (let i = 0; i < path.length - 1; i++) {
            const dist = distanceToLineSegment(x, y, path[i].x, path[i].y, path[i+1].x, path[i+1].y);
            if (dist < threshold) return true;
        }
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

function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw paths
    PATHS.forEach((path, idx) => {
        const colors = ['#a78bfa', '#f472b6', '#fb923c'];
        ctx.strokeStyle = colors[idx];
        ctx.lineWidth = 35;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) {
            ctx.lineTo(path[i].x, path[i].y);
        }
        ctx.stroke();
        
        // Lane number
        ctx.fillStyle = 'white';
        ctx.font = 'bold 16px Arial';
        ctx.fillText(`Lane ${idx + 1}`, 10, path[0].y - 30);
    });
    
    // Draw base
    ctx.fillStyle = '#3b82f6';
    ctx.beginPath();
    ctx.arc(BASE_POS.x, BASE_POS.y, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'white';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('🏰', BASE_POS.x, BASE_POS.y + 8);
    
    // Base HP bar
    ctx.fillStyle = '#000';
    ctx.fillRect(BASE_POS.x - 40, BASE_POS.y - 50, 80, 8);
    ctx.fillStyle = '#10b981';
    ctx.fillRect(BASE_POS.x - 40, BASE_POS.y - 50, 80 * (gameState.baseHP / 100), 8);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 12px Arial';
    ctx.fillText(`${gameState.baseHP}HP`, BASE_POS.x, BASE_POS.y - 60);
    
    // Update and draw troops
    for (let i = gameState.troops.length - 1; i >= 0; i--) {
        const troop = gameState.troops[i];
        const troopType = TROOP_TYPES[troop.type];
        const path = PATHS[troop.lane];
        
        if (troop.pathIndex < path.length - 1) {
            const current = path[troop.pathIndex];
            const next = path[troop.pathIndex + 1];
            const dx = next.x - current.x;
            const dy = next.y - current.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            troop.progress += troopType.speed;
            
            if (troop.progress >= distance) {
                troop.progress = 0;
                troop.pathIndex++;
            }
            
            const t = troop.progress / distance;
            troop.x = current.x + dx * t;
            troop.y = current.y + dy * t;
        } else {
            // Reached base
            let damage = troopType.damage;
            if (troopType.explosive) {
                damage = troopType.damage; // Bomber deals full damage
            }
            
            gameState.baseHP -= damage;
            gameState.troops.splice(i, 1);
            
            if (playerRole === 'attacker') {
                sendToServer({
                    type: 'baseHit',
                    baseHP: gameState.baseHP,
                    damage: damage
                });
            }
            
            if (gameState.baseHP <= 0) {
                gameState.gameStatus = 'finished';
                sendToServer({
                    type: 'gameOver',
                    winner: 'Attacker',
                    reason: 'Base destroyed'
                });
            }
            continue;
        }
        
        // Draw troop
        ctx.fillStyle = troopType.color;
        ctx.beginPath();
        ctx.arc(troop.x, troop.y, troopType.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${troopType.size + 4}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(troopType.emoji, troop.x, troop.y);
        
        // Health bar
        if (troop.health < troop.maxHealth) {
            ctx.fillStyle = '#000';
            ctx.fillRect(troop.x - 15, troop.y - troopType.size - 10, 30, 4);
            ctx.fillStyle = '#10b981';
            ctx.fillRect(troop.x - 15, troop.y - troopType.size - 10, 30 * (troop.health / troop.maxHealth), 4);
        }
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
        ctx.strokeStyle = towerType.color + '22';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(tower.x, tower.y, towerType.range, 0, Math.PI * 2);
        ctx.stroke();
        
        // Find and shoot troops
        if (now - tower.lastShot >= towerType.speed) {
            let target = null;
            let maxProgress = -1;
            
            gameState.troops.forEach(troop => {
                const dist = Math.sqrt((troop.x - tower.x) ** 2 + (troop.y - tower.y) ** 2);
                const progress = troop.pathIndex * 1000 + troop.progress;
                if (dist <= towerType.range && progress > maxProgress) {
                    target = troop;
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
                    speed: 8
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
            // Hit
            if (proj.type === 'splash') {
                gameState.troops.forEach(troop => {
                    const d = Math.sqrt((troop.x - proj.targetX) ** 2 + (troop.y - proj.targetY) ** 2);
                    if (d <= 50) {
                        troop.health -= proj.damage;
                    }
                });
            } else {
                proj.target.health -= proj.damage;
            }
            
            // Remove dead troops
            for (let j = gameState.troops.length - 1; j >= 0; j--) {
                if (gameState.troops[j].health <= 0) {
                    gameState.troops.splice(j, 1);
                    if (playerRole === 'defender') {
                        gameState.defenderGold += 5;
                    }
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
    
    updateUI();
}

function updateUI() {
    document.getElementById('attackerGold').textContent = gameState.attackerGold;
    document.getElementById('defenderGold').textContent = gameState.defenderGold;
    document.getElementById('defenderHP').textContent = gameState.baseHP;
    document.getElementById('attackerTroops').textContent = gameState.troops.length;
    
    if (gameState.attacker) {
        document.getElementById('attackerName').textContent = gameState.attacker.name;
    }
    if (gameState.defender) {
        document.getElementById('defenderName').textContent = gameState.defender.name;
    }
    
    const statusText = document.getElementById('statusText');
    if (gameState.gameStatus === 'waiting') {
        statusText.textContent = 'Waiting';
        statusText.className = 'font-bold text-yellow-600';
    } else if (gameState.gameStatus === 'playing') {
        statusText.textContent = 'Playing';
        statusText.className = 'font-bold text-green-600';
        
        // Update game time
        if (gameState.gameStartTime) {
            const elapsed = Math.floor((Date.now() - gameState.gameStartTime) / 1000);
            const mins = Math.floor(elapsed / 60);
            const secs = elapsed % 60;
            document.getElementById('gameTime').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
        }
    } else {
        statusText.textContent = 'Finished';
        statusText.className = 'font-bold text-red-600';
    }
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
    msg.textContent = text;
    
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

function startGameLoop() {
    setInterval(gameLoop, 1000 / 60);
}

updateUI();