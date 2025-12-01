
const bcrypt = require("bcryptjs");
const WebSocket = require("ws");

const rooms = new Map();
const clients = new Map();
const disconnectTimers = new Map();
const DISCONNECT_GRACE_PERIOD_MS = 60000;
const GAME_DURATION_MS = 60000;

let dbPool; 

function createInitialGameState() {
  return {
    attacker: null,
    defender: null,
    attackerGold: 1000,
    defenderGold: 1000,
    baseHP: 100,
    towers: [],
    troops: [],
    gameStatus: "waiting",
    gameStartTime: 0,
  };
}

function generateRoomCode() {
  let code;
  do {
    code = Math.random().toString(36).substring(2, 8).toUpperCase();
  } while (rooms.has(code));
  return code;
}

function broadcastToRoom(roomCode, data, wss, excludeClient = null) {
  const message = JSON.stringify(data);
  wss.clients.forEach((ws) => {
    const clientInfo = clients.get(ws);
    if (
      clientInfo &&
      clientInfo.roomCode === roomCode &&
      ws !== excludeClient &&
      ws.readyState === WebSocket.OPEN
    ) {
      ws.send(message);
    }
  });
}

function sendToClient(client, data) {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(data));
  }
}


async function processGameOver(roomCode, winnerRole, reason, finalBaseHp, wss) {
    const gameState = rooms.get(roomCode);
    if (!gameState || gameState.gameStatus === "finished") return;

    gameState.gameStatus = "finished";

    const attackerId = gameState.attacker ? gameState.attacker.id : null;
    const defenderId = gameState.defender ? gameState.defender.id : null;

    let winnerId = null;
    let loserId = null;
    if (winnerRole === "Attacker") {
        winnerId = attackerId;
        loserId = defenderId;
    } else if (winnerRole === "Defender") {
        winnerId = defenderId;
        loserId = attackerId;
    }

    const durationSec = gameState.gameStartTime
        ? Math.floor((Date.now() - gameState.gameStartTime) / 1000)
        : 0;

    broadcastToRoom(roomCode, {
        type: "gameOver",
        winner: winnerRole,
        reason: reason,
    }, wss);

    try {
        if (attackerId && defenderId && winnerId && loserId) {
            const isAttackerWin = winnerRole === "Attacker";

            await broadcastLeaderboardUpdate(wss);
            await dbPool.execute(
                "UPDATE users SET matches_played = matches_played + 1, wins = wins + ?, losses = losses + ?, trophies = trophies + ? WHERE id = ?",
                [isAttackerWin ? 1 : 0, isAttackerWin ? 0 : 1, isAttackerWin ? 10 : 0, attackerId]
            );

            await dbPool.execute(
                "UPDATE users SET matches_played = matches_played + 1, wins = wins + ?, losses = losses + ?, trophies = trophies + ? WHERE id = ?",
                [isAttackerWin ? 0 : 1, isAttackerWin ? 1 : 0, isAttackerWin ? 0 : 10, defenderId]
            );

            await dbPool.execute(
                `UPDATE matches
                SET winner_id = ?, loser_id = ?, reason = ?, base_hp_final = ?, duration_sec = ?, status = 'finished'
                WHERE room_code = ? AND status = 'playing'`,
                [winnerId, loserId, reason, finalBaseHp, durationSec, roomCode]
            );

            console.log(`✅ Match ${roomCode} logged and database updated. Winner: ${winnerRole}`);
            await broadcastLeaderboardUpdate(wss);
        } else {
            console.log(`⚠️ Database skipped for Room ${roomCode}. Missing player ID.`);
        }
    } catch (err) {
        console.error("❌ Error updating database:", err);
    }

    setTimeout(() => {
        rooms.delete(roomCode);
        console.log(`🧹 Room ${roomCode} deleted.`);
    }, 5000);
}

async function startGracePeriodTimer(roomCode, disconnectedRole, wss) {
    if (disconnectTimers.has(roomCode)) {
        clearTimeout(disconnectTimers.get(roomCode));
    }

    const timer = setTimeout(async () => {
        const gameState = rooms.get(roomCode);
        if (gameState && gameState.gameStatus === "playing") {
            const winnerRole = disconnectedRole === "attacker" ? "Defender" : "Attacker";
            const reason = "Opponent did not reconnect in time.";

            console.log(`[${roomCode}] Grace period expired. Forcing game over.`);

            await processGameOver(roomCode, winnerRole, reason, gameState.baseHP, wss);
        }
        disconnectTimers.delete(roomCode);
    }, DISCONNECT_GRACE_PERIOD_MS);

    disconnectTimers.set(roomCode, timer);
}


async function handleRegister(ws, data) {
    const { username, password } = data;
    try {
        const [rows] = await dbPool.execute("SELECT id FROM users WHERE username = ?", [username]);
        if (rows.length > 0) {
            return sendToClient(ws, { type: "authError", message: "Username already taken" });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        await dbPool.execute("INSERT INTO users (username, password, wins, losses, matches_played, trophies) VALUES (?, ?, 0, 0, 0, 0)", [username, hashedPassword]);
        sendToClient(ws, { type: "registerSuccess", message: "Registration successful! Please login." });
    } catch (err) {
        console.error("Registration Error:", err);
        sendToClient(ws, { type: "authError", message: "Server database error during registration." });
    }
}

async function handleLogin(ws, data) {
    const { username, password } = data;
    try {
        const [rows] = await dbPool.execute("SELECT * FROM users WHERE username = ?", [username]);
        if (rows.length === 0) return sendToClient(ws, { type: "authError", message: "User not found" });

        const user = rows[0];
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return sendToClient(ws, { type: "authError", message: "Invalid password" });

        clients.set(ws, { id: user.id, username: user.username, authenticated: true, roomCode: null, role: null });
        sendToClient(ws, { type: "loginSuccess", username: user.username, id: user.id });

        await handleGetDashboard(ws);
    } catch (err) {
        console.error("Login Error:", err);
        sendToClient(ws, { type: "authError", message: "Server error during login" });
    }
}

async function handleReauth(ws, data, wss) {
    const { id } = data;
    if (!id) return;

    try {
        const [userRows] = await dbPool.execute("SELECT id, username FROM users WHERE id = ?", [id]);
        if (userRows.length === 0) return sendToClient(ws, { type: "authError", message: "Session invalid or user deleted." });

        const user = userRows[0];
        const [matchRows] = await dbPool.execute(
            `SELECT room_code, attacker_id, defender_id 
            FROM matches 
            WHERE (attacker_id = ? OR defender_id = ?) 
            AND status IN ('waiting', 'playing') 
            ORDER BY created_at DESC LIMIT 1`,
            [id, id]
        );

        let roomCode = null;
        let role = null;
        let gameState = null;

        if (matchRows.length > 0) {
            const match = matchRows[0];
            roomCode = match.room_code;
            role = match.attacker_id == id ? "attacker" : "defender";
            gameState = rooms.get(roomCode);
        }

        clients.set(ws, { id: user.id, username: user.username, authenticated: true, roomCode: roomCode, role: role });

        if (roomCode && gameState) {
            if (disconnectTimers.has(roomCode)) {
                clearTimeout(disconnectTimers.get(roomCode));
                disconnectTimers.delete(roomCode);
                console.log(`[${roomCode}] Grace period cancelled for ${user.username}.`);
            }

            const playerState = role === "attacker" ? gameState.attacker : gameState.defender;
            if (playerState) playerState.disconnected = false; 

            sendToClient(ws, { type: "roomJoined", roomCode: roomCode, playerId: user.id, role: role, data: gameState });
            broadcastToRoom(roomCode, { type: "chat", playerName: user.username, message: `${user.username} reconnected.`, }, wss, ws);
        } else {
            sendToClient(ws, { type: "reauthSuccess", roomCode: roomCode, role: role });
        }
    } catch (err) {
        console.error("Reauth Error:", err);
        sendToClient(ws, { type: "authError", message: "Server error during reauth." });
    }
}

async function handleGetDashboard(ws) {
    const clientInfo = clients.get(ws);
    if (!clientInfo) return;

    try {
        const [userRows] = await dbPool.execute("SELECT wins, losses, matches_played, trophies FROM users WHERE id = ?", [clientInfo.id]);
        const stats = userRows[0] || {};
        const [leaderboard] = await dbPool.execute("SELECT username, trophies FROM users ORDER BY trophies DESC LIMIT 10");

        sendToClient(ws, { type: "dashboardData", stats: stats, leaderboard: leaderboard });
    } catch (err) {
        console.error("Dashboard Fetch Error:", err);
    }
}

async function handleGetAvailableMatches(ws) {
    try {
        const query = `
        SELECT 
          m.room_code, m.created_at, 
          COALESCE(ua.username, ud.username) AS creator_name,
          CASE
            WHEN m.attacker_id IS NOT NULL AND m.defender_id IS NULL THEN 'defender'
            WHEN m.defender_id IS NOT NULL AND m.attacker_id IS NULL THEN 'attacker'
            ELSE 'unknown'
          END AS needed_role
        FROM matches m
        LEFT JOIN users ua ON m.attacker_id = ua.id
        LEFT JOIN users ud ON m.defender_id = ud.id
        WHERE m.status = 'waiting' AND (m.attacker_id IS NOT NULL OR m.defender_id IS NOT NULL)
        ORDER BY m.created_at DESC
        LIMIT 20;
        `;
        const [matches] = await dbPool.execute(query);
        sendToClient(ws, { type: "availableMatches", matches: matches });
    } catch (err) {
        console.error("Get Available Matches Error:", err);
    }
}

async function handleCreateRoom(ws, data) {
    const clientInfo = clients.get(ws);
    const { role } = data;
    if (clientInfo.roomCode) return sendToClient(ws, { type: "error", message: "Already in a room." });

    const roomCode = generateRoomCode();
    const gameState = createInitialGameState();
    clientInfo.roomCode = roomCode;
    clientInfo.role = role;
    const playerInfo = { id: clientInfo.id, name: clientInfo.username };

    if (role === "attacker") gameState.attacker = playerInfo;
    else gameState.defender = playerInfo;
    rooms.set(roomCode, gameState);

    try {
        const roleColumn = role === "attacker" ? "attacker_id" : "defender_id";
        await dbPool.execute(`INSERT INTO matches (room_code, ${roleColumn}, status) VALUES (?, ?, 'waiting')`, [roomCode, clientInfo.id]);
        console.log(`✅ Match ${roomCode} created in database`);
    } catch (err) {
        console.error("Error logging match creation:", err);
    }

    sendToClient(ws, { type: "roomCreated", roomCode: roomCode, playerId: clientInfo.id, role: role, data: gameState });
}

async function handleJoinRoom(ws, data, wss) {
    const clientInfo = clients.get(ws);
    const { roomCode } = data;
    const upperRoomCode = roomCode.toUpperCase();
    const gameState = rooms.get(upperRoomCode);

    if (clientInfo.roomCode) return sendToClient(ws, { type: "error", message: "Already in a room." });
    if (!gameState) return sendToClient(ws, { type: "error", message: "Room invalid." });

    let role;
    const playerInfo = { id: clientInfo.id, name: clientInfo.username };

    if (gameState.attacker && !gameState.defender) {
        role = "defender";
        gameState.defender = playerInfo;
    } else if (gameState.defender && !gameState.attacker) {
        role = "attacker";
        gameState.attacker = playerInfo;
    } else {
        return sendToClient(ws, { type: "error", message: "Room full." });
    }

    clientInfo.roomCode = upperRoomCode;
    clientInfo.role = role;

    sendToClient(ws, { type: "roomJoined", roomCode: clientInfo.roomCode, playerId: clientInfo.id, role: role, data: gameState });
    broadcastToRoom(clientInfo.roomCode, { type: "playerJoined", playerId: clientInfo.id, playerName: clientInfo.username, role: role, }, wss, ws);

    startGameTimer(clientInfo.roomCode, wss);

    if (gameState.attacker && gameState.defender && gameState.gameStatus === "waiting") {
        gameState.gameStatus = "playing";
        gameState.gameStartTime = Date.now();

        try {
            const roleColumn = role === "attacker" ? "attacker_id" : "defender_id";
            await dbPool.execute(`UPDATE matches SET ${roleColumn} = ?, status = 'playing' WHERE room_code = ? AND status = 'waiting'`, [clientInfo.id, upperRoomCode]);
            console.log(`✅ Match ${upperRoomCode} status updated to 'playing'`);
        } catch (err) {
            console.error("Error updating match status:", err);
        }

        broadcastToRoom(clientInfo.roomCode, { type: "gameStarted", attackerName: gameState.attacker.name, defenderName: gameState.defender.name, }, wss);
    }
}

async function handleLeaveMatch(ws, wss) {
    const clientInfo = clients.get(ws);
    if (!clientInfo || !clientInfo.roomCode) return;

    const { roomCode, role, username } = clientInfo;
    const gameState = rooms.get(roomCode);

    if (gameState && gameState.gameStatus === "playing") {
        const winnerRole = role === "attacker" ? "Defender" : "Attacker";
        console.log(`[${roomCode}] Player ${username} explicitly left. Forcing game over.`);
        
        await processGameOver(roomCode, winnerRole, "Player Forfeited", gameState.baseHP, wss);
    } 
    
    clientInfo.roomCode = null;
    clientInfo.role = null;
}

function handleTroopDeployed(ws, data, wss) {
    const clientInfo = clients.get(ws);
    if (clientInfo?.role !== "attacker" || !clientInfo.roomCode) return;
    const gameState = rooms.get(clientInfo.roomCode);
    if (!gameState || gameState.gameStatus !== "playing") return;

    gameState.troops.push(data.troop);
    gameState.attackerGold = data.gold;
    broadcastToRoom(clientInfo.roomCode, { type: "troopDeployed", playerId: clientInfo.id, troop: data.troop, gold: data.gold, }, wss, ws);
}

function handleTowerPlaced(ws, data, wss) {
    const clientInfo = clients.get(ws);
    if (clientInfo?.role !== "defender" || !clientInfo.roomCode) return;
    const gameState = rooms.get(clientInfo.roomCode);
    if (!gameState || gameState.gameStatus !== "playing") return;

    gameState.towers.push(data.tower);
    gameState.defenderGold = data.gold;
    broadcastToRoom(clientInfo.roomCode, { type: "towerPlaced", playerId: clientInfo.id, tower: data.tower, gold: data.gold, }, wss, ws);
}

function handleChat(ws, data, wss) {
    const clientInfo = clients.get(ws);
    if (!clientInfo?.roomCode) return;
    broadcastToRoom(clientInfo.roomCode, { type: "chat", playerId: clientInfo.id, playerName: clientInfo.username, message: data.message, }, wss);
}

async function handleBaseHit(ws, data, wss) {
    const clientInfo = clients.get(ws);
    if (!clientInfo?.roomCode) return;
    const roomCode = clientInfo.roomCode;
    const gameState = rooms.get(roomCode);

    if (!gameState || gameState.gameStatus !== "playing") return;

    gameState.baseHP = data.baseHP;
    broadcastToRoom(roomCode, { type: "baseHit", baseHP: data.baseHP, damage: data.damage, }, wss);

    if (gameState.baseHP <= 0) {
        await processGameOver(roomCode, "Attacker", "Base Destroyed", gameState.baseHP, wss);
    }
}

async function handlePlayerDisconnect(ws, wss) {
    const clientInfo = clients.get(ws);
    if (!clientInfo || !clientInfo.roomCode) {
        clients.delete(ws);
        return;
    }

    const { roomCode, role, id: userId } = clientInfo;
    const gameState = rooms.get(roomCode);
    clients.delete(ws);

    if (gameState) {
        if (gameState.gameStatus === "playing") {
            const disconnectedPlayer = role === "attacker" ? gameState.attacker : gameState.defender;
            if (disconnectedPlayer) disconnectedPlayer.disconnected = true;

            broadcastToRoom(roomCode, { type: "playerDisconnected", playerId: userId, playerName: clientInfo.username, role: role, }, wss);

            console.log(`[${roomCode}] Player ${clientInfo.username} disconnected. Starting grace period...`);
            startGracePeriodTimer(roomCode, role, wss);
        } else {
            if (role === "attacker") gameState.attacker = null;
            if (role === "defender") gameState.defender = null;
            
            try {
                await dbPool.execute("DELETE FROM matches WHERE room_code = ? AND status = 'waiting'", [roomCode]);
                console.log(`✅ Cancelled waiting match ${roomCode}`);
            } catch (err) {
                console.error("Error deleting waiting match:", err);
            }
            if (!gameState.attacker && !gameState.defender) rooms.delete(roomCode);
        }
    }
}

async function broadcastLeaderboardUpdate(wss) {
  try {
    const [leaderboard] = await dbPool.execute(
      "SELECT username, trophies FROM users ORDER BY trophies DESC LIMIT 10"
    );

    const message = JSON.stringify({
      type: "leaderboardUpdate",
      leaderboard: leaderboard,
    });

    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });

    console.log("📊 Real-time Leaderboard broadcasted.");
  } catch (err) {
    console.error("Error broadcasting leaderboard:", err);
  }
}

function startGameTimer(roomCode, wss) {
    setTimeout(async () => {
        const gameState = rooms.get(roomCode);
        
        if (gameState && gameState.gameStatus === "playing") {
            console.log(`⏰ Time limit reached for room ${roomCode}. Defender wins!`);
            
            await processGameOver(
                roomCode, 
                "Defender",       
                "Time Limit Reached", 
                gameState.baseHP, 
                wss
            );
        }
    }, GAME_DURATION_MS);
}

module.exports = (wssInstance, poolInstance) => {
    dbPool = poolInstance;

    wssInstance.on("connection", (ws) => {
        clients.set(ws, { authenticated: false });

        ws.on("message", async (message) => {
            try {
                const data = JSON.parse(message);
                const clientInfo = clients.get(ws);

                if (data.type === "register") return handleRegister(ws, data);
                if (data.type === "login") return handleLogin(ws, data);
                if (data.type === "reauth") return handleReauth(ws, data, wssInstance);
                
                if (!clientInfo || !clientInfo.authenticated) {
                    return sendToClient(ws, { type: "error", message: "Authentication required." });
                }
                
                switch (data.type) {
                    case "getDashboard": return handleGetDashboard(ws);
                    case "getAvailableMatches": return handleGetAvailableMatches(ws);
                    case "rejoinRoom": return handleRejoinRoom(ws, data);
                    
                    case "createRoom": return handleCreateRoom(ws, data);
                    case "joinRoom": return handleJoinRoom(ws, data, wssInstance);
                    case "leaveMatch": return handleLeaveMatch(ws, wssInstance);

                    case "updateGold":
                        if (!clientInfo || !clientInfo.roomCode) return;
                        const gameState = rooms.get(clientInfo.roomCode);
                        if (!gameState) return;
                    
                        if (data.role === "attacker") gameState.attackerGold = data.gold;
                        else if (data.role === "defender") gameState.defenderGold = data.gold;

                        return broadcastToRoom(clientInfo.roomCode, { type: "updateGold", role: data.role, gold: data.gold, }, wssInstance, ws);
                    
                    case "troopDeployed": return handleTroopDeployed(ws, data, wssInstance);
                    case "towerPlaced": return handleTowerPlaced(ws, data, wssInstance);
                    case "baseHit": return handleBaseHit(ws, data, wssInstance);
                    case "chat": return handleChat(ws, data, wssInstance);

                    default: console.log("Unknown message type:", data.type);
                }
            } catch (error) {
                console.error("Error processing message:", error);
            }
        });

        ws.on("close", () => {
            handlePlayerDisconnect(ws, wssInstance);
        });
    });
};