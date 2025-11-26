// game.js
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
let roomCode = null;
let selectedUnit = null;
let ws = null;
let reconnectInterval = null;

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');


// -------------------------------------------------------
// --- PERBAIKAN: MEMINDAHKAN FUNGSI UTILITAS KE ATAS ---
// -------------------------------------------------------

function updateConnectionStatus(connected) {
    const statusEl = document.getElementById('connectionStatus');
    // Tambahkan cek null karena elemen ini mungkin belum dimuat saat awal koneksi
    if (!statusEl) return; 

    if (connected) {
        statusEl.className = 'flex items-center gap-2 px-4 py-2 bg-green-100 text-green-700 rounded-full font-semibold';
        statusEl.innerHTML = '<span class="w-3 h-3 bg-green-500 rounded-full pulse"></span> Connected';
    } else {
        statusEl.className = 'flex items-center gap-2 px-4 py-2 bg-red-100 text-red-700 rounded-full font-semibold';
        statusEl.innerHTML = '<span class="w-3 h-3 bg-red-500 rounded-full"></span> Disconnected';
    }
}

function updateUI() {
    // PERBAIKAN: Cek apakah Game Container sudah terlihat. 
    // Jika tidak, jangan coba mengakses elemen di dalamnya.
    const gameContainer = document.getElementById('gameContainer');
    if (gameContainer && gameContainer.classList.contains('hidden')) {
        // Hanya update status jika perlu
        const statusText = document.getElementById('statusText');
        if (statusText) statusText.textContent = 'Waiting'; 
        return; 
    }

    // Perbaikan untuk mencegah 'Cannot set properties of null'
    // Menggunakan optional chaining (`?.`) atau pengecekan if eksplisit
    const attackerGoldEl = document.getElementById('attackerGold');
    if (attackerGoldEl) attackerGoldEl.textContent = gameState.attackerGold;
    
    const defenderGoldEl = document.getElementById('defenderGold');
    if (defenderGoldEl) defenderGoldEl.textContent = gameState.defenderGold;
    
    const defenderHPEl = document.getElementById('defenderHP');
    if (defenderHPEl) defenderHPEl.textContent = gameState.baseHP;
    
    const attackerTroopsEl = document.getElementById('attackerTroops');
    if (attackerTroopsEl) attackerTroopsEl.textContent = gameState.troops.length;
    
    const attackerNameEl = document.getElementById('attackerName');
    if (attackerNameEl) attackerNameEl.textContent = gameState.attacker ? gameState.attacker.name : 'Waiting...';
    
    const defenderNameEl = document.getElementById('defenderName');
    if (defenderNameEl) defenderNameEl.textContent = gameState.defender ? gameState.defender.name : 'Waiting...';
    
    const statusText = document.getElementById('statusText');
    if (statusText) {
        if (gameState.gameStatus === 'waiting') {
            statusText.textContent = 'Waiting';
            statusText.className = 'font-bold text-yellow-600';
            document.getElementById('waitingModal')?.classList.remove('hidden');
        } else if (gameState.gameStatus === 'playing') {
            statusText.textContent = 'Playing';
            statusText.className = 'font-bold text-green-600';
            document.getElementById('waitingModal')?.classList.add('hidden');

            // Update game time (countdown is actually elapsed time)
            const countdownEl = document.getElementById('countdown');
            if (countdownEl && gameState.gameStartTime) {
                const elapsed = Math.floor((Date.now() - gameState.gameStartTime) / 1000);
                const mins = Math.floor(elapsed / 60);
                const secs = elapsed % 60;
                countdownEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
            }
        } else {
            statusText.textContent = 'Finished';
            statusText.className = 'font-bold text-red-600';
        }
    }
}

function addMessage(text, type = 'info') {
    const log = document.getElementById('messageLog');
    if (!log) return; // Tambahkan cek null

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
    
    msg.className += ' ' + (colors[type] || 'bg-gray-100 text-gray-800');
    msg.textContent = text;
    
    log.appendChild(msg);
    log.scrollTop = log.scrollHeight;
}

// WebSocket Connection
function connectWebSocket(callback) {
    const wsUrl = CONFIG.WS_URL;
    
    try {
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            console.log('Connected to server');
            // PERBAIKAN: updateConnectionStatus sudah dipindahkan ke atas
            updateConnectionStatus(true); 
            addMessage('Connected to server!', 'system');
            
            if (reconnectInterval) {
                clearInterval(reconnectInterval);
                reconnectInterval = null;
            }

            if (callback) callback();
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
            updateConnectionStatus(false);
            addMessage('Connection error', 'error');
        };
        
        ws.onclose = () => {
            console.log('Disconnected');
            updateConnectionStatus(false);
            
            if (!reconnectInterval) {
                reconnectInterval = setInterval(() => {
                    console.log('Attempting to reconnect...');
                    // Hanya connect, jangan coba create/join ulang di sini
                    connectWebSocket(); 
                }, 3000);
            }
        };
    } catch (error) {
        console.error('Failed to connect:', error);
        updateConnectionStatus(false);
    }
}


// -------------------------------------------------------
// --- SISA KODE DARI SINI KE BAWAH TIDAK BERUBAH ---
// -------------------------------------------------------

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


// 3 PATHS (Top, Middle, Bottom)
const PATHS = [
    // Path 1 (Top Lane) - Purple
    [
        {x: 0, y: 150}, {x: 300, y: 150}, {x: 300, y: 100}, 
        {x: 600, y: 100}, {x: 600, y: 150}, {x: 900, y: 150}
    ],
    // Path 2 (Middle Lane) - Pink
    [
        {x: 0, y: 350}, {x: 200, y: 350}, {x: 200, y: 300},
        {x: 450, y: 300}, {x: 450, y: 400}, {x: 700, y: 400},
        {x: 700, y: 350}, {x: 900, y: 350}
    ],
    // Path 3 (Bottom Lane) - Orange
    [
        {x: 0, y: 550}, {x: 300, y: 550}, {x: 300, y: 600},
        {x: 600, y: 600}, {x: 600, y: 550}, {x: 900, y: 550}
    ]
];

// Base position
const BASE_POS = {x: 900, y: 350};

// --- WEBSOCKET & SERVER COMMUNICATION ---

function sendToServer(data) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function handleServerMessage(data) {
    switch(data.type) {
        case 'gameState':
            gameState = { ...gameState, ...data.data };
            updateUI();
            break;

        case 'roomCreated':
        case 'roomJoined':
            // Used for initial setup/transition after connecting
            roomCode = data.roomCode;
            playerId = data.playerId;
            playerRole = data.role;
            gameState = { ...gameState, ...data.data };
            
            document.getElementById('displayRoomCode').textContent = roomCode;
            document.getElementById('mainMenu').classList.add('hidden');
            document.getElementById('createMatchModal').classList.add('hidden');
            document.getElementById('joinMatchModal').classList.add('hidden');
            document.getElementById('gameContainer').classList.remove('hidden');

            setupPlayerRoleUI(playerRole);
            
            if (data.type === 'roomCreated' && gameState.gameStatus === 'waiting') {
                document.getElementById('waitingModal').classList.remove('hidden');
            }

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
            document.getElementById('waitingModal')?.classList.add('hidden');
            updateUI();
            break;
            
        case 'troopDeployed':
            // Only update if not the sender (sender updates locally before sending)
            if (data.playerId !== playerId) {
                gameState.troops.push(data.troop);
                gameState.attackerGold = data.gold;
                updateUI();
            }
            break;
            
        case 'towerPlaced':
            // Only update if not the sender
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
            showGameOverModal(data.winner, data.reason);
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
            if (data.role === 'attacker') gameState.attacker = null;
            if (data.role === 'defender') gameState.defender = null;
            updateUI();
            break;

        case 'error':
            alert(`Error: ${data.message}`);
            returnToMenu();
            break;

        case 'gameReset':
            alert('Server reset. Returning to menu.');
            returnToMenu();
            break;
    }
}

// --- GAME LOGIC ---

function selectUnit(type) {
    selectedUnit = type;
    document.querySelectorAll('.unit-btn').forEach(btn => {
        btn.classList.remove('selected');
    });
    document.getElementById('unit-' + type).classList.add('selected');
}

canvas.addEventListener('click', (e) => {
    if (!selectedUnit || gameState.gameStatus !== 'playing') return;
    if (playerRole !== 'attacker' && playerRole !== 'defender') return;
    
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
    if (y > 100 && y < 200) lane = 0; // Top Lane area
    else if (y > 300 && y < 400) lane = 1; // Middle Lane area
    else if (y > 500 && y < 600) lane = 2; // Bottom Lane area
    
    if (lane === -1) {
        addMessage('Click closer to a lane to deploy troops!', 'error');
        return;
    }

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
    
    // Client-side update (will be confirmed by server broadcast)
    gameState.troops.push(troop);
    gameState.attackerGold -= troopType.cost;
    
    sendToServer({
        type: 'troopDeployed',
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
    
    // Check if too close to path or other towers
    if (isOnAnyPath(x, y, 30)) {
        addMessage('Cannot place tower too close to path!', 'error');
        return;
    }

    if (isTooCloseToOtherTowers(x, y, 40)) {
        addMessage('Cannot place tower too close to another tower!', 'error');
        return;
    }
    
    const tower = {
        id: 'tower_' + Date.now(),
        type: selectedUnit,
        x: x,
        y: y,
        lastShot: 0
    };
    
    // Client-side update
    gameState.towers.push(tower);
    gameState.defenderGold -= towerType.cost;
    
    sendToServer({
        type: 'towerPlaced',
        tower: tower,
        gold: gameState.defenderGold
    });
    
    addMessage(`Placed ${towerType.name}`, 'tower');
    updateUI();
}

function isTooCloseToOtherTowers(x, y, minDistance) {
    for (const tower of gameState.towers) {
        const dist = Math.sqrt((tower.x - x)**2 + (tower.y - y)**2);
        if (dist < minDistance) return true;
    }
    return false;
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
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return Math.sqrt((px - x1)**2 + (py - y1)**2);
    
    const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
    const closestX = x1 + t * dx;
    const closestY = y1 + t * dy;
    return Math.sqrt((px - closestX) ** 2 + (py - closestY) ** 2);
}

function gameLoop() {
    if (gameState.gameStatus !== 'playing') {
        updateUI(); 
        return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw paths and base
    drawGameMap();
    
    // Update and draw troops
    for (let i = gameState.troops.length - 1; i >= 0; i--) {
        const troop = gameState.troops[i];
        const troopType = TROOP_TYPES[troop.type];
        const path = PATHS[troop.lane];
        
        // --- MOVEMENT LOGIC ---
        if (troop.pathIndex < path.length - 1) {
            const current = path[troop.pathIndex];
            const next = path[troop.pathIndex + 1];
            const dx = next.x - current.x;
            const dy = next.y - current.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            troop.progress += troopType.speed;
            
            if (distance > 0 && troop.progress >= distance) {
                troop.progress -= distance;
                troop.pathIndex++;
            }
            
            // Recalculate position
            const segmentStart = path[troop.pathIndex];
            const segmentEnd = path[troop.pathIndex + 1] || BASE_POS; // Use BASE_POS for last segment
            const segDx = segmentEnd.x - segmentStart.x;
            const segDy = segmentEnd.y - segmentStart.y;
            const segmentDist = Math.sqrt(segDx * segDx + segDy * segDy) || 1; 

            const t = troop.progress / segmentDist;
            troop.x = segmentStart.x + segDx * t;
            troop.y = segmentStart.y + segDy * t;
            
        } else {
            // Reached base logic
            if (Math.abs(troop.x - BASE_POS.x) < 5 && Math.abs(troop.y - BASE_POS.y) < 5) {
                let damage = troopType.damage;
                gameState.baseHP -= damage;
                gameState.troops.splice(i, 1);
                
                // Only Attacker updates the server with base hit
                if (playerRole === 'attacker') {
                    sendToServer({
                        type: 'baseHit',
                        baseHP: gameState.baseHP,
                        damage: damage
                    });
                }
                
                if (gameState.baseHP <= 0) {
                    gameState.gameStatus = 'finished';
                    // Attacker sends game over signal
                    if (playerRole === 'attacker') {
                        sendToServer({
                            type: 'gameOver',
                            winner: 'Attacker',
                            reason: 'Base destroyed'
                        });
                    }
                }
                continue;
            } else {
                 // Move towards the base from the last path point
                const lastPoint = path[path.length - 1];
                const dx = BASE_POS.x - lastPoint.x;
                const dy = BASE_POS.y - lastPoint.y;
                const dist = Math.sqrt(dx*dx + dy*dy);
                
                troop.x += (dx / dist) * troopType.speed;
                troop.y += (dy / dist) * troopType.speed;
            }
        }
        
        drawTroop(troop, troopType);
    }
    
    // Update and draw towers (shooting logic)
    const now = Date.now();
    gameState.towers.forEach(tower => {
        const towerType = TOWER_TYPES[tower.type];
        drawTower(tower, towerType);
        
        // Find and shoot troops
        if (now - tower.lastShot >= towerType.speed) {
            let target = findTarget(tower, towerType.range);
            
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
                    splashRadius: towerType.splashRadius || 0,
                    speed: 8
                });
            }
        }
    });
    
    // Update and draw projectiles (and damage troops)
    updateProjectiles();
    
    updateUI();
}

// --- DRAWING FUNCTIONS ---

function drawGameMap() {
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
    ctx.textBaseline = 'middle';
    ctx.fillText('🏰', BASE_POS.x, BASE_POS.y);
    
    // Base HP bar
    ctx.fillStyle = '#000';
    ctx.fillRect(BASE_POS.x - 40, BASE_POS.y - 50, 80, 8);
    ctx.fillStyle = (gameState.baseHP > 50 ? '#10b981' : (gameState.baseHP > 20 ? '#fbbf24' : '#ef4444'));
    ctx.fillRect(BASE_POS.x - 40, BASE_POS.y - 50, 80 * (gameState.baseHP / 100), 8);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 12px Arial';
    ctx.fillText(`${gameState.baseHP}HP`, BASE_POS.x, BASE_POS.y - 60);
}

function drawTroop(troop, troopType) {
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
        ctx.fillStyle = (troop.health/troop.maxHealth > 0.5 ? '#10b981' : (troop.health/troop.maxHealth > 0.2 ? '#fbbf24' : '#ef4444'));
        ctx.fillRect(troop.x - 15, troop.y - troopType.size - 10, 30 * (troop.health / troop.maxHealth), 4);
    }
}

function drawTower(tower, towerType) {
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
}

function findTarget(tower, range) {
    let target = null;
    let maxProgress = -1;
    
    gameState.troops.forEach(troop => {
        const dist = Math.sqrt((troop.x - tower.x) ** 2 + (troop.y - tower.y) ** 2);
        // Prioritize troops that have progressed the furthest down their path
        const path = PATHS[troop.lane];
        const currentSegmentLength = Math.sqrt(
            (path[troop.pathIndex+1].x - path[troop.pathIndex].x)**2 + 
            (path[troop.pathIndex+1].y - path[troop.pathIndex].y)**2
        );

        let progress;
        // Estimate overall progress (rough calculation, actual implementation may vary)
        if (troop.pathIndex < path.length - 1) {
             progress = troop.pathIndex * 1000 + (troop.progress / (currentSegmentLength || 1)) * 1000;
        } else {
             progress = path.length * 1000 + 100; // Troops at the end are highest priority
        }

        if (dist <= range && progress > maxProgress) {
            target = troop;
            maxProgress = progress;
        }
    });
    return target;
}

function updateProjectiles() {
    for (let i = gameState.projectiles.length - 1; i >= 0; i--) {
        const proj = gameState.projectiles[i];
        
        // Find the troop that corresponds to the projectile's target
        const targetTroop = gameState.troops.find(t => t.id === proj.target.id);

        // If target is gone, but projectile still moving, let it hit the last known coordinates
        if (targetTroop) {
             proj.targetX = targetTroop.x;
             proj.targetY = targetTroop.y;
        }

        const dx = proj.targetX - proj.x;
        const dy = proj.targetY - proj.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < proj.speed) {
            // Hit logic
            if (proj.type === 'splash') {
                const splashCenter = { x: proj.targetX, y: proj.targetY };
                gameState.troops.forEach(troop => {
                    const d = Math.sqrt((troop.x - splashCenter.x) ** 2 + (troop.y - splashCenter.y) ** 2);
                    if (d <= proj.splashRadius) {
                        troop.health -= proj.damage;
                    }
                });
            } else if (targetTroop) {
                targetTroop.health -= proj.damage;
            }
            
            // Remove dead troops and award gold (only Defender updates client gold)
            for (let j = gameState.troops.length - 1; j >= 0; j--) {
                if (gameState.troops[j].health <= 0) {
                    gameState.troops.splice(j, 1);
                    if (playerRole === 'defender') {
                        gameState.defenderGold += 5; // Reward for kill
                    }
                }
            }
            
            gameState.projectiles.splice(i, 1);
        } else {
            // Move projectile
            proj.x += (dx / dist) * proj.speed;
            proj.y += (dy / dist) * proj.speed;
            
            // Draw projectile
            ctx.fillStyle = proj.color;
            ctx.beginPath();
            ctx.arc(proj.x, proj.y, 5, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}


// --- UI/CHAT FUNCTIONS ---

function setupPlayerRoleUI(role) {
    const roleEl = document.getElementById('playerRole');
    document.getElementById('attackerUnits').classList.add('hidden');
    document.getElementById('defenderUnits').classList.add('hidden');

    if (role === 'attacker') {
        roleEl.className = 'px-4 py-2 rounded-full font-bold text-white role-attacker';
        roleEl.textContent = '⚔️ Attacker';
        document.getElementById('attackerUnits').classList.remove('hidden');
    } else if (role === 'defender') {
        roleEl.className = 'px-4 py-2 rounded-full font-bold text-white role-defender';
        roleEl.textContent = '🛡️ Defender';
        document.getElementById('defenderUnits').classList.remove('hidden');
    } else {
         roleEl.className = 'px-4 py-2 rounded-full font-bold text-white bg-gray-500';
         roleEl.textContent = '👤 Spectator';
    }
}

function sendChat() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    
    if (message && playerId) {
        sendToServer({
            type: 'chat',
            message: message
        });
        
        addMessage(`You: ${message}`, 'chat');
        input.value = '';
    }
}

function startGameLoop() {
    setInterval(gameLoop, 1000 / 60);
}

// --- MENU/MODAL FUNCTIONS ---

function showRoleModal() {
    document.getElementById('mainMenu').classList.add('hidden');
    document.getElementById('roleModal').style.display = 'flex';
}

let selectedCreateRole = null;
function selectCreateRole(role) {
    selectedCreateRole = role;
    document.getElementById('createAttacker').classList.remove('selected');
    document.getElementById('createDefender').classList.remove('selected');
    document.getElementById(`create${role.charAt(0).toUpperCase() + role.slice(1)}`).classList.add('selected');
}

function showCreateMatch() {
    const playerNameMenu = document.getElementById('playerNameMenu').value.trim();
    if (!playerNameMenu) {
        alert('Please enter your name first!');
        return;
    }
    document.getElementById('createName').value = playerNameMenu;
    selectedCreateRole = null; // Reset selection
    document.getElementById('createAttacker').classList.remove('selected');
    document.getElementById('createDefender').classList.remove('selected');

    document.getElementById('mainMenu').classList.add('hidden');
    document.getElementById('createMatchModal').classList.remove('hidden');
}

function showJoinMatch() {
    const playerNameMenu = document.getElementById('playerNameMenu').value.trim();
    if (!playerNameMenu) {
        alert('Please enter your name first!');
        return;
    }
    document.getElementById('joinName').value = playerNameMenu;
    document.getElementById('roomCodeInput').value = ''; // Clear room code
    document.getElementById('mainMenu').classList.add('hidden');
    document.getElementById('joinMatchModal').classList.remove('hidden');
}

function backToMenu() {
    document.getElementById('createMatchModal').classList.add('hidden');
    document.getElementById('joinMatchModal').classList.add('hidden');
    document.getElementById('mainMenu').classList.remove('hidden');
}

function createMatch() {
    playerName = document.getElementById('createName').value.trim();
    if (!playerName || !selectedCreateRole) {
        alert('Please enter your name and select a role!');
        return;
    }

    // Connect WebSocket dan kirim pesan 'createRoom' setelah koneksi terbuka
    connectWebSocket(() => {
        sendToServer({
            type: 'createRoom',
            playerName: playerName,
            role: selectedCreateRole
        });
    });
}

function joinMatch() {
    playerName = document.getElementById('joinName').value.trim();
    roomCode = document.getElementById('roomCodeInput').value.trim().toUpperCase();
    
    if (!playerName || roomCode.length !== 6) {
        alert('Please enter your name and a 6-digit room code!');
        return;
    }

    // Connect WebSocket dan kirim pesan 'joinRoom' setelah koneksi terbuka
    connectWebSocket(() => {
        sendToServer({
            type: 'joinRoom',
            playerName: playerName,
            roomCode: roomCode
        });
    });
}

function cancelWaiting() {
    // Attempt to close WebSocket gracefully, which triggers handlePlayerDisconnect on server
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
    }
    returnToMenu();
}

function showGameOverModal(winner, reason) {
    document.getElementById('gameOverModal').classList.remove('hidden');
    
    const isWinner = playerRole && winner.toLowerCase() === playerRole;

    document.getElementById('winnerText').textContent = isWinner ? 'VICTORY!' : 'DEFEAT!';
    document.getElementById('winnerEmoji').textContent = isWinner ? '🏆' : '💀';
    document.getElementById('gameResult').innerHTML = `
        <p class="text-xl font-semibold mb-2">${winner} wins!</p>
        <p>Reason: ${reason}</p>
        <p class="mt-4">Final Base HP: ${gameState.baseHP}</p>
        <p>Total Troops Deployed: ${gameState.troops.length}</p>
    `;
}

function returnToMenu() {
    // Reset client state
    gameState = {
        attacker: null,
        defender: null,
        attackerGold: 1000,
        defenderGold: 1000,
        baseHP: 100,
        towers: [],
        troops: [],
        projectiles: [],
        gameStatus: 'waiting',
        gameStartTime: 0
    };
    playerId = null;
    playerName = '';
    playerRole = null;
    roomCode = null;
    selectedUnit = null;

    // Show main menu and hide game elements
    document.getElementById('gameContainer')?.classList.add('hidden');
    document.getElementById('waitingModal')?.classList.add('hidden');
    document.getElementById('gameOverModal')?.classList.add('hidden');
    document.getElementById('mainMenu').classList.remove('hidden');
    
    const messageLog = document.getElementById('messageLog');
    if (messageLog) messageLog.innerHTML = '<div class="text-gray-500 text-xs">Game ready...</div>';
    
    updateUI(); // Panggil updateUI untuk reset display jika gameContainer tidak hidden
}

// Attach public functions to window object for HTML access
window.selectUnit = selectUnit;
window.sendChat = sendChat;
window.showCreateMatch = showCreateMatch;
window.showJoinMatch = showJoinMatch;
window.createMatch = createMatch;
window.joinMatch = joinMatch;
window.backToMenu = backToMenu;
window.selectCreateRole = selectCreateRole;
window.cancelWaiting = cancelWaiting;
window.returnToMenu = returnToMenu;

startGameLoop(); // Start the visual update loop