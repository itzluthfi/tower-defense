// server.js - FINAL VERSION WITH MYSQL & MATCH LIST FEATURE

require("dotenv").config();
const WebSocket = require("ws");
const http = require("http");
const express = require("express");
const path = require("path");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- KONFIGURASI DATABASE ---
const DB_CONFIG = {
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "tower_defense_db",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
};

let pool;

// --- FUNGSI UTILITY DATABASE ---
async function initializeDatabase() {
  console.log("🛠️ Checking database schema...");

  try {
    const rootConnection = await mysql.createConnection({
      host: DB_CONFIG.host,
      user: DB_CONFIG.user,
      password: DB_CONFIG.password,
    });

    await rootConnection.execute(
      `CREATE DATABASE IF NOT EXISTS ${DB_CONFIG.database}`
    );
    console.log(`✅ Database '${DB_CONFIG.database}' is ready.`);

    await rootConnection.end();
    pool = mysql.createPool(DB_CONFIG);

    const createUsersTableSQL = `
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password VARCHAR(255) NOT NULL,
                wins INT DEFAULT 0,
                losses INT DEFAULT 0,
                matches_played INT DEFAULT 0,
                trophies INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB;
        `;

    const createMatchesTableSQL = `
            CREATE TABLE IF NOT EXISTS matches (
                id INT AUTO_INCREMENT PRIMARY KEY,
                room_code VARCHAR(10) NOT NULL,
                attacker_id INT,
                defender_id INT,
                winner_id INT,
                loser_id INT,
                reason VARCHAR(255),
                base_hp_final INT DEFAULT 0,
                duration_sec INT,
                status VARCHAR(20) DEFAULT 'waiting',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (attacker_id) REFERENCES users(id),
                FOREIGN KEY (defender_id) REFERENCES users(id)
            ) ENGINE=InnoDB;
        `;

    const conn = await pool.getConnection();
    try {
      await conn.execute(createUsersTableSQL);
      console.log("✅ Table 'users' is ready.");

      await conn.execute(createMatchesTableSQL);
      console.log("✅ Table 'matches' is ready.");
    } finally {
      conn.release();
    }
  } catch (err) {
    if (err.code === "ER_ACCESS_DENIED_ERROR") {
      console.error(
        "❌ FATAL: Database initialization failed. Check DB_USER and DB_PASSWORD in .env."
      );
    } else {
      console.error("❌ FATAL: Database initialization failed:", err);
    }
    process.exit(1);
  }
}

// --- SERVER SETUP ---
app.use(express.static(path.join(__dirname, "public")));

const rooms = new Map();
const clients = new Map();

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

function broadcastToRoom(roomCode, data, excludeClient = null) {
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

// --- WEBSOCKET HANDLERS ---
wss.on("connection", (ws) => {
  clients.set(ws, { authenticated: false });

  ws.on("message", async (message) => {
    try {
      const data = JSON.parse(message);
      const clientInfo = clients.get(ws);

      if (data.type === "register") {
        await handleRegister(ws, data);
        return;
      }
      if (data.type === "login") {
        await handleLogin(ws, data);
        return;
      }
      if (data.type === "reauth") {
        await handleReauth(ws, data);
        return;
      }
      // NEW HANDLER FOR REJOIN
      if (data.type === "rejoinRoom") {
        await handleRejoinRoom(ws, data);
        return;
      }

      if (!clientInfo || !clientInfo.authenticated) {
        sendToClient(ws, {
          type: "error",
          message: "Authentication required. Please login first.",
        });
        return;
      }

      switch (data.type) {
        case "getDashboard":
          await handleGetDashboard(ws);
          break;
        case "getAvailableMatches":
          await handleGetAvailableMatches(ws);
          break;
        case "createRoom":
          await handleCreateRoom(ws, data);
          break;
        case "joinRoom":
          await handleJoinRoom(ws, data);
          break;
        case "troopDeployed":
          handleTroopDeployed(ws, data);
          break;
        case "towerPlaced":
          handleTowerPlaced(ws, data);
          break;
        case "baseHit":
          handleBaseHit(ws, data);
          break;
        case "chat":
          handleChat(ws, data);
          break;
        default:
          console.log("Unknown message type:", data.type);
      }
    } catch (error) {
      console.error("Error processing message:", error);
    }
  });

  ws.on("close", () => {
    handlePlayerDisconnect(ws);
  });
});

// --- AUTH HANDLERS ---
async function handleRegister(ws, data) {
  const { username, password } = data;
  if (!username || !password) {
    sendToClient(ws, {
      type: "authError",
      message: "Username and password required.",
    });
    return;
  }
  try {
    const [rows] = await pool.execute(
      "SELECT id FROM users WHERE username = ?",
      [username]
    );
    if (rows.length > 0) {
      sendToClient(ws, {
        type: "authError",
        message: "Username already taken",
      });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.execute(
      "INSERT INTO users (username, password, wins, losses, matches_played, trophies) VALUES (?, ?, 0, 0, 0, 0)",
      [username, hashedPassword]
    );

    sendToClient(ws, {
      type: "registerSuccess",
      message: "Registration successful! Please login.",
    });
  } catch (err) {
    console.error("Registration Error:", err);
    sendToClient(ws, {
      type: "authError",
      message: "Server database error during registration.",
    });
  }
}

async function handleLogin(ws, data) {
  const { username, password } = data;
  if (!username || !password) {
    sendToClient(ws, {
      type: "authError",
      message: "Username and password required.",
    });
    return;
  }
  try {
    const [rows] = await pool.execute(
      "SELECT * FROM users WHERE username = ?",
      [username]
    );
    if (rows.length === 0) {
      sendToClient(ws, { type: "authError", message: "User not found" });
      return;
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      sendToClient(ws, { type: "authError", message: "Invalid password" });
      return;
    }

    clients.set(ws, {
      id: user.id,
      username: user.username,
      authenticated: true,
      roomCode: null,
      role: null,
    });

    sendToClient(ws, {
      type: "loginSuccess",
      username: user.username,
      id: user.id,
    });

    await handleGetDashboard(ws);
  } catch (err) {
    console.error("Login Error:", err);
    sendToClient(ws, {
      type: "authError",
      message: "Server error during login",
    });
  }
}

async function handleReauth(ws, data) {
  const { id } = data;
  if (!id) return;

  try {
    const [userRows] = await pool.execute(
      "SELECT id, username FROM users WHERE id = ?",
      [id]
    );

    if (userRows.length === 0) {
      sendToClient(ws, {
        type: "authError",
        message: "Session invalid or user deleted.",
      });
      return;
    }

    const user = userRows[0];

    // Cek apakah user sedang bermain atau menunggu di match
    const [matchRows] = await pool.execute(
      `SELECT room_code, status, attacker_id, defender_id 
         FROM matches 
         WHERE (attacker_id = ? OR defender_id = ?) 
         AND status IN ('waiting', 'playing') 
         ORDER BY created_at DESC LIMIT 1`,
      [id, id]
    );

    let roomCode = null;
    let role = null;

    if (matchRows.length > 0) {
      const match = matchRows[0];
      roomCode = match.room_code;
      role = match.attacker_id == id ? "attacker" : "defender";

      // Cek jika room masih ada di in-memory state
      if (!rooms.has(roomCode) && match.status === "playing") {
        console.warn(
          `Room ${roomCode} missing from memory, forcing game over.`
        );
        // Jika room hilang dari memory tapi DB bilang 'playing', anggap kalah
        // Atau, opsional: Coba rebuild game state, tapi ini kompleks.
        // Saat ini, kita biarkan saja klien melanjutkan dan panggil handlePlayerDisconnect
        // jika mereka mencoba aksi yang memerlukan state memory.
        roomCode = null;
        role = null;
      }
    }

    clients.set(ws, {
      id: user.id,
      username: user.username,
      authenticated: true,
      roomCode: roomCode, // Simpan roomCode di sesi server
      role: role,
    });

    sendToClient(ws, {
      type: "reauthSuccess",
      roomCode: roomCode, // Kirim roomCode & role untuk rejoin
      role: role,
    });
  } catch (err) {
    console.error("Reauth Error:", err);
    sendToClient(ws, {
      type: "authError",
      message: "Server error during reauth.",
    });
  }
}

async function handleGetDashboard(ws) {
  const clientInfo = clients.get(ws);
  if (!clientInfo) return;

  try {
    const [userRows] = await pool.execute(
      "SELECT wins, losses, matches_played, trophies FROM users WHERE id = ?",
      [clientInfo.id]
    );
    const stats = userRows[0] || {};

    const [leaderboard] = await pool.execute(
      "SELECT username, trophies FROM users ORDER BY trophies DESC LIMIT 10"
    );

    sendToClient(ws, {
      type: "dashboardData",
      stats: stats,
      leaderboard: leaderboard,
    });
  } catch (err) {
    console.error("Dashboard Fetch Error:", err);
  }
}

async function handleGetAvailableMatches(ws) {
  try {
    const [matches] =
      await pool.execute(`SELECT m.room_code, m.created_at, COALESCE(ua.username, ud.username) as creator_name,
              CASE 
                WHEN m.attacker_id IS NOT NULL AND m.defender_id IS NULL THEN 'defender'
                WHEN m.defender_id IS NOT NULL AND m.attacker_id IS NULL THEN 'attacker'
                ELSE 'unknown'
              END as needed_role
       FROM matches m
       LEFT JOIN users ua ON m.attacker_id = ua.id
       LEFT JOIN users ud ON m.defender_id = ud.id
       WHERE m.status = 'waiting' AND (m.attacker_id IS NOT NULL OR m.defender_id IS NOT NULL)
       ORDER BY m.created_at DESC
       LIMIT 20`);

    sendToClient(ws, {
      type: "availableMatches",
      matches: matches,
    });
  } catch (err) {
    console.error("Get Available Matches Error:", err);
  }
}

async function handleRejoinRoom(ws, data) {
  const clientInfo = clients.get(ws);
  const { roomCode } = data;

  if (
    !clientInfo ||
    !clientInfo.authenticated ||
    clientInfo.roomCode !== roomCode
  ) {
    return sendToClient(ws, {
      type: "error",
      message: "Cannot rejoin: Invalid room or authentication.",
    });
  }

  const gameState = rooms.get(roomCode);
  if (!gameState) {
    // Room hilang dari memory. Ini adalah kondisi kritis.
    // Hapus status 'playing' dari DB dan suruh klien kembali ke dashboard.
    await pool.execute(
      `UPDATE matches SET status = 'finished', reason = 'Memory state lost' 
             WHERE room_code = ? AND status = 'playing'`,
      [roomCode]
    );
    clientInfo.roomCode = null;
    clientInfo.role = null;
    return sendToClient(ws, {
      type: "error",
      message: "Game state lost. Returning to dashboard.",
    });
  }

  // Success: Kirim full game state agar klien dapat melanjutkan
  sendToClient(ws, {
    type: "roomJoined", // Gunakan event yang sama agar klien memproses state
    roomCode: roomCode,
    playerId: clientInfo.id,
    role: clientInfo.role,
    data: gameState,
  });

  // Beritahu pemain lain bahwa pemain ini kembali online
  broadcastToRoom(roomCode, {
    type: "chat",
    playerName: clientInfo.username,
    message: `${clientInfo.username} reconnected.`,
  });
}

// --- GAME ROOM HANDLERS ---
async function handleCreateRoom(ws, data) {
  const clientInfo = clients.get(ws);
  const { role } = data;
  if (clientInfo.roomCode)
    return sendToClient(ws, { type: "error", message: "Already in a room." });

  const roomCode = generateRoomCode();
  const gameState = createInitialGameState();

  clientInfo.roomCode = roomCode;
  clientInfo.role = role;

  const playerInfo = { id: clientInfo.id, name: clientInfo.username };
  if (role === "attacker") gameState.attacker = playerInfo;
  else gameState.defender = playerInfo;

  rooms.set(roomCode, gameState);

  try {
    if (role === "attacker") {
      await pool.execute(
        "INSERT INTO matches (room_code, attacker_id, status) VALUES (?, ?, 'waiting')",
        [roomCode, clientInfo.id]
      );
    } else {
      await pool.execute(
        "INSERT INTO matches (room_code, defender_id, status) VALUES (?, ?, 'waiting')",
        [roomCode, clientInfo.id]
      );
    }
    console.log(`✅ Match ${roomCode} created in database`);
  } catch (err) {
    console.error("Error logging match creation:", err);
  }

  sendToClient(ws, {
    type: "roomCreated",
    roomCode: roomCode,
    playerId: clientInfo.id,
    role: role,
    data: gameState,
  });
}

async function handleJoinRoom(ws, data) {
  const clientInfo = clients.get(ws);
  const { roomCode } = data;
  const upperRoomCode = roomCode.toUpperCase();
  const gameState = rooms.get(upperRoomCode);

  if (clientInfo.roomCode)
    return sendToClient(ws, { type: "error", message: "Already in a room." });
  if (!gameState) {
    sendToClient(ws, { type: "error", message: "Room invalid." });
    return;
  }

  let role;
  const playerInfo = { id: clientInfo.id, name: clientInfo.username };

  if (gameState.attacker && !gameState.defender) {
    role = "defender";
    gameState.defender = playerInfo;
  } else if (gameState.defender && !gameState.attacker) {
    role = "attacker";
    gameState.attacker = playerInfo;
  } else {
    sendToClient(ws, { type: "error", message: "Room full." });
    return;
  }

  clientInfo.roomCode = upperRoomCode;
  clientInfo.role = role;

  sendToClient(ws, {
    type: "roomJoined",
    roomCode: clientInfo.roomCode,
    playerId: clientInfo.id,
    role: role,
    data: gameState,
  });

  broadcastToRoom(
    clientInfo.roomCode,
    {
      type: "playerJoined",
      playerId: clientInfo.id,
      playerName: clientInfo.username,
      role: role,
    },
    ws
  );

  if (
    gameState.attacker &&
    gameState.defender &&
    gameState.gameStatus === "waiting"
  ) {
    gameState.gameStatus = "playing";
    gameState.gameStartTime = Date.now();

    try {
      // Tentukan ID yang akan diupdate di DB
      const idToUpdate = role === "attacker" ? clientInfo.id : clientInfo.id;
      const roleColumn = role === "attacker" ? "attacker_id" : "defender_id";

      // Update DB: Tambahkan ID pemain kedua dan ubah status
      await pool.execute(
        `UPDATE matches SET ${roleColumn} = ?, status = 'playing' WHERE room_code = ? AND status = 'waiting'`,
        [idToUpdate, upperRoomCode]
      );
      console.log(`✅ Match ${upperRoomCode} status updated to 'playing'`);
    } catch (err) {
      console.error("Error updating match status:", err);
    }

    broadcastToRoom(clientInfo.roomCode, {
      type: "gameStarted",
      attackerName: gameState.attacker.name,
      defenderName: gameState.defender.name,
    });
  }
}

// --- GAMEPLAY HANDLERS ---
function handleTroopDeployed(ws, data) {
  const clientInfo = clients.get(ws);
  if (clientInfo?.role !== "attacker" || !clientInfo.roomCode) return;
  const gameState = rooms.get(clientInfo.roomCode);
  if (!gameState || gameState.gameStatus !== "playing") return;

  gameState.troops.push(data.troop);
  gameState.attackerGold = data.gold;
  broadcastToRoom(
    clientInfo.roomCode,
    {
      type: "troopDeployed",
      playerId: clientInfo.id,
      troop: data.troop,
      gold: data.gold,
    },
    ws
  );
}

function handleTowerPlaced(ws, data) {
  const clientInfo = clients.get(ws);
  if (clientInfo?.role !== "defender" || !clientInfo.roomCode) return;
  const gameState = rooms.get(clientInfo.roomCode);
  if (!gameState || gameState.gameStatus !== "playing") return;

  gameState.towers.push(data.tower);
  gameState.defenderGold = data.gold;

  broadcastToRoom(
    clientInfo.roomCode,
    {
      type: "towerPlaced",
      playerId: clientInfo.id,
      tower: data.tower,
      gold: data.gold,
    },
    ws
  );
}

function handleChat(ws, data) {
  const clientInfo = clients.get(ws);
  if (!clientInfo?.roomCode) return;
  broadcastToRoom(clientInfo.roomCode, {
    type: "chat",
    playerId: clientInfo.id,
    playerName: clientInfo.username,
    message: data.message,
  });
}

// --- GAME OVER HANDLERS ---
async function handleBaseHit(ws, data) {
  const clientInfo = clients.get(ws);
  if (!clientInfo?.roomCode) return;
  const roomCode = clientInfo.roomCode;
  const gameState = rooms.get(roomCode);

  if (!gameState || gameState.gameStatus !== "playing") return;

  gameState.baseHP = data.baseHP;
  broadcastToRoom(roomCode, {
    type: "baseHit",
    baseHP: data.baseHP,
    damage: data.damage,
  });

  if (gameState.baseHP <= 0) {
    await processGameOver(roomCode, "Attacker", "Base Destroyed");
  }
}

async function handlePlayerDisconnect(ws) {
  const clientInfo = clients.get(ws);
  if (!clientInfo || !clientInfo.roomCode) {
    clients.delete(ws);
    return;
  }

  const { roomCode, role } = clientInfo;
  const gameState = rooms.get(roomCode);

  if (gameState) {
    if (gameState.gameStatus === "playing") {
      const winnerRole = role === "attacker" ? "Defender" : "Attacker";
      console.log(`Player ${clientInfo.username} disconnected. Game Over.`);
      await processGameOver(roomCode, winnerRole, "Opponent Disconnected");
    } else {
      if (role === "attacker") gameState.attacker = null;
      if (role === "defender") gameState.defender = null; // Delete match from database if still waiting

      try {
        await pool.execute(
          "DELETE FROM matches WHERE room_code = ? AND status = 'waiting'",
          [roomCode]
        );
        console.log(`✅ Cancelled waiting match ${roomCode}`);
      } catch (err) {
        console.error("Error deleting waiting match:", err);
      }

      if (!gameState.attacker && !gameState.defender) rooms.delete(roomCode);
    }
  }

  clients.delete(ws);
}

async function processGameOver(roomCode, winnerRole, reason) {
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
  });

  try {
    if (attackerId && defenderId && winnerId && loserId) {
      const isAttackerWin = winnerRole === "Attacker";

      await pool.execute(
        "UPDATE users SET matches_played = matches_played + 1, wins = wins + ?, losses = losses + ?, trophies = trophies + ? WHERE id = ?",
        [
          isAttackerWin ? 1 : 0,
          isAttackerWin ? 0 : 1,
          isAttackerWin ? 10 : 0,
          attackerId,
        ]
      );

      await pool.execute(
        "UPDATE users SET matches_played = matches_played + 1, wins = wins + ?, losses = losses + ?, trophies = trophies + ? WHERE id = ?",
        [
          isAttackerWin ? 0 : 1,
          isAttackerWin ? 1 : 0,
          isAttackerWin ? 0 : 10,
          defenderId,
        ]
      );

      await pool.execute(
        `UPDATE matches SET
          winner_id = ?, loser_id = ?, reason = ?, base_hp_final = ?, duration_sec = ?, status = 'finished'
          WHERE room_code = ? AND status = 'playing'`,
        [winnerId, loserId, reason, gameState.baseHP, durationSec, roomCode]
      );
      console.log(`✅ Match ${roomCode} logged to database.`);

      console.log(
        `✅ Database updated for Room ${roomCode}. Winner: ${winnerRole}`
      );
    } else {
      console.log(
        `⚠️ Database skipped for Room ${roomCode}. Missing one player ID.`
      );
    }
  } catch (err) {
    console.error("❌ Error updating database:", err);
  }

  setTimeout(() => {
    rooms.delete(roomCode);
    console.log(`🧹 Room ${roomCode} deleted.`);
  }, 5000);
}

// --- START SERVER ---
async function startServer() {
  await initializeDatabase();

  const PORT = process.env.PORT || 8080;
  const WS_HOST = process.env.WS_HOST || "localhost";

  server.listen(PORT, () => {
    console.log(`\n======================================================`);
    console.log(`🎮 PvP Tower Defense Server (MySQL) running on port ${PORT}`);
    console.log(`📡 WebSocket Server: ws://${WS_HOST}:${PORT}`);
    console.log(`🌐 Web Client: http://${WS_HOST}:${PORT}`);
    console.log(`======================================================\n`);
  });
}

startServer();

app.get("/config.js", (req, res) => {
  res.type("application/javascript");
  const wsHost = process.env.WS_HOST || req.hostname;
  const port = process.env.PORT || 8080;

  res.send(`
        const CONFIG = {
            WS_URL: 'ws://${wsHost}:${port}'
        };
    `);
});
