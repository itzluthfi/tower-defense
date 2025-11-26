// server.js - FINAL VERSION WITH MYSQL
require("dotenv").config();
const WebSocket = require("ws");
const http = require("http");
const express = require("express");
const path = require("path");
const mysql = require("mysql2/promise"); // Menggunakan versi promise agar code lebih rapi (async/await)
const bcrypt = require("bcryptjs");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// --- MYSQL CONNECTION POOL ---
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root", // Ganti sesuai user MySQL Anda
  password: process.env.DB_PASSWORD || "", // Ganti sesuai password MySQL Anda
  database: process.env.DB_NAME || "tower_defense_db",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Test koneksi database saat start
pool
  .getConnection()
  .then((conn) => {
    console.log("✅ Connected to MySQL Database");
    conn.release();
  })
  .catch((err) => {
    console.error("❌ MySQL Connection Error:", err);
  });

app.use(express.static(path.join(__dirname, "public")));

// --- IN-MEMORY GAME STATE ---
const rooms = new Map();
// clients: ws -> { id, username, roomCode, role, authenticated }
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

      // --- PUBLIC ENDPOINTS (No Login Required) ---
      if (data.type === "register") {
        await handleRegister(ws, data);
        return;
      }
      if (data.type === "login") {
        await handleLogin(ws, data);
        return;
      }

      // --- PROTECTED ENDPOINTS (Login Required) ---
      if (!clientInfo || !clientInfo.authenticated) {
        sendToClient(ws, { type: "error", message: "Please login first." });
        return;
      }

      switch (data.type) {
        case "getDashboard":
          await handleGetDashboard(ws);
          break;
        case "createRoom":
          handleCreateRoom(ws, data);
          break;
        case "joinRoom":
          handleJoinRoom(ws, data);
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
          console.log("Unknown type:", data.type);
      }
    } catch (error) {
      console.error("Error parsing message:", error);
    }
  });

  ws.on("close", () => {
    handlePlayerDisconnect(ws);
  });
});

// --- AUTH HANDLERS (MySQL) ---

async function handleRegister(ws, data) {
  const { username, password } = data;
  try {
    // Cek apakah username ada
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
    console.error(err);
    sendToClient(ws, { type: "authError", message: "Server database error" });
  }
}

async function handleLogin(ws, data) {
  const { username, password } = data;
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

    // Login sukses
    clients.set(ws, {
      id: user.id, // Simpan ID database
      username: user.username,
      authenticated: true,
    });

    sendToClient(ws, { type: "loginSuccess", username: user.username });

    // Langsung kirim data dashboard setelah login
    await handleGetDashboard(ws);
  } catch (err) {
    console.error(err);
    sendToClient(ws, {
      type: "authError",
      message: "Server error during login",
    });
  }
}

async function handleGetDashboard(ws) {
  const clientInfo = clients.get(ws);
  if (!clientInfo) return;

  try {
    // 1. Ambil Stats User
    const [userRows] = await pool.execute(
      "SELECT wins, losses, matches_played, trophies FROM users WHERE id = ?",
      [clientInfo.id]
    );
    const stats = userRows[0];

    // 2. Ambil Leaderboard (Top 10 berdasarkan Trophies)
    const [leaderboard] = await pool.execute(
      "SELECT username, trophies FROM users ORDER BY trophies DESC LIMIT 10"
    );

    sendToClient(ws, {
      type: "dashboardData",
      stats: stats,
      leaderboard: leaderboard,
    });
  } catch (err) {
    console.error("Dashboard Error:", err);
  }
}

// --- GAME ROOM HANDLERS ---

function handleCreateRoom(ws, data) {
  const clientInfo = clients.get(ws);
  const { role } = data;
  const roomCode = generateRoomCode();
  const gameState = createInitialGameState();

  clientInfo.roomCode = roomCode;
  clientInfo.role = role;

  if (role === "attacker")
    gameState.attacker = { id: clientInfo.id, name: clientInfo.username };
  else gameState.defender = { id: clientInfo.id, name: clientInfo.username };

  rooms.set(roomCode, gameState);

  sendToClient(ws, {
    type: "roomCreated",
    roomCode: roomCode,
    playerId: clientInfo.id,
    role: role,
    data: gameState,
  });
}

function handleJoinRoom(ws, data) {
  const clientInfo = clients.get(ws);
  const { roomCode } = data;
  const gameState = rooms.get(roomCode.toUpperCase());

  if (!gameState) {
    sendToClient(ws, { type: "error", message: "Room invalid." });
    return;
  }

  let role;
  if (gameState.attacker && !gameState.defender) {
    role = "defender";
    gameState.defender = { id: clientInfo.id, name: clientInfo.username };
  } else if (gameState.defender && !gameState.attacker) {
    role = "attacker";
    gameState.attacker = { id: clientInfo.id, name: clientInfo.username };
  } else {
    sendToClient(ws, { type: "error", message: "Room full." });
    return;
  }

  clientInfo.roomCode = roomCode.toUpperCase();
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
    broadcastToRoom(clientInfo.roomCode, {
      type: "gameStarted",
      attackerName: gameState.attacker.name,
      defenderName: gameState.defender.name,
    });
  }
}

// --- ACTION HANDLERS ---
function handleTroopDeployed(ws, data) {
  const clientInfo = clients.get(ws);
  if (!clientInfo?.roomCode) return;
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
  if (!clientInfo?.roomCode) return;
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

// --- GAME OVER & DATABASE UPDATE ---

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
  if (!clientInfo) return;

  const { roomCode, role } = clientInfo;
  const gameState = rooms.get(roomCode);

  if (gameState) {
    if (gameState.gameStatus === "playing") {
      const winnerRole = role === "attacker" ? "Defender" : "Attacker";
      await processGameOver(roomCode, winnerRole, "Opponent Disconnected");
    } else {
      // Bersihkan state jika game belum mulai
      if (role === "attacker") gameState.attacker = null;
      if (role === "defender") gameState.defender = null;
      if (!gameState.attacker && !gameState.defender) rooms.delete(roomCode);
    }
  }
  clients.delete(ws);
}

async function processGameOver(roomCode, winnerRole, reason) {
  const gameState = rooms.get(roomCode);
  if (!gameState) return;

  gameState.gameStatus = "finished";

  // Cari ID user Attacker dan Defender
  let attackerId = gameState.attacker ? gameState.attacker.id : null;
  let defenderId = gameState.defender ? gameState.defender.id : null;
  let winnerName = "";

  if (winnerRole === "Attacker" && gameState.attacker)
    winnerName = gameState.attacker.name;
  if (winnerRole === "Defender" && gameState.defender)
    winnerName = gameState.defender.name;

  broadcastToRoom(roomCode, {
    type: "gameOver",
    winner: winnerRole,
    reason: reason,
  });

  // --- UPDATE MYSQL DATABASE ---
  try {
    if (attackerId && defenderId) {
      const isAttackerWin = winnerRole === "Attacker";

      // Update Attacker
      await pool.execute(
        "UPDATE users SET matches_played = matches_played + 1, wins = wins + ?, losses = losses + ?, trophies = trophies + ? WHERE id = ?",
        [
          isAttackerWin ? 1 : 0,
          isAttackerWin ? 0 : 1,
          isAttackerWin ? 10 : 0,
          attackerId,
        ]
      );

      // Update Defender
      await pool.execute(
        "UPDATE users SET matches_played = matches_played + 1, wins = wins + ?, losses = losses + ?, trophies = trophies + ? WHERE id = ?",
        [
          isAttackerWin ? 0 : 1,
          isAttackerWin ? 1 : 0,
          isAttackerWin ? 0 : 10,
          defenderId,
        ]
      );

      console.log(`✅ Database updated for Room ${roomCode}`);
    }
  } catch (err) {
    console.error("❌ Error updating database:", err);
  }

  // Hapus room setelah 5 detik
  setTimeout(() => {
    rooms.delete(roomCode);
  }, 5000);
}

const PORT = process.env.PORT || 8080;
const WS_HOST = process.env.WS_HOST || "localhost"; // Tambahkan kembali variabel ini

server.listen(PORT, () => {
  console.log(`🎮 PvP Tower Defense Server (MySQL) running on port ${PORT}`);
  console.log(`📡 WebSocket Server: ws://${WS_HOST}:${PORT}`);
  console.log(`🌐 Web Client: http://${WS_HOST}:${PORT}`);
});

app.get("/config.js", (req, res) => {
  res.type("application/javascript");
  // Menggunakan req.hostname agar otomatis menyesuaikan IP (localhost atau 192.168...)
  const wsHost = process.env.WS_HOST || req.hostname;
  const port = process.env.PORT || 8080;

  res.send(`
        const CONFIG = {
            WS_URL: 'ws://${wsHost}:${port}'
        };
    `);
});
