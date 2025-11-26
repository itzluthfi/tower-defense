// server.js
require("dotenv").config();
const WebSocket = require("ws");
const http = require("http");
const express = require("express");
const path = require("path");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Serve static files
app.use(express.static(path.join(__dirname, "public")));

// --- MULTI-ROOM MANAGEMENT ---
// Map untuk menyimpan status game: roomCode -> gameState
const rooms = new Map();
// Map untuk melacak koneksi client: ws -> { playerId, playerName, roomCode, role }
const clients = new Map();

// Initial game state template
function createInitialGameState() {
  return {
    attacker: null,
    defender: null,
    attackerGold: 1000,
    defenderGold: 1000,
    baseHP: 100,
    towers: [],
    troops: [],
    gameStatus: "waiting", // waiting, playing, finished
    gameStartTime: 0,
  };
}

// Generate a random 6-digit room code
function generateRoomCode() {
  let code;
  do {
    code = Math.random().toString(36).substring(2, 8).toUpperCase();
  } while (rooms.has(code));
  return code;
}

// Broadcast to clients in a specific room
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

// Send to specific client
function sendToClient(client, data) {
  if (client.readyState === WebSocket.OPEN) {
    client.send(JSON.stringify(data));
  }
}

// --- WEBSOCKET HANDLERS ---
wss.on("connection", (ws) => {
  console.log("New client connected");

  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message);

      switch (data.type) {
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
        case "gameOver":
          // This is handled by server logic for now, but client might send requests
          break;
        case "chat":
          handleChat(ws, data);
          break;
        default:
          console.log("Unknown message type:", data.type);
      }
    } catch (error) {
      console.error("Error parsing message:", error);
    }
  });

  ws.on("close", () => {
    handlePlayerDisconnect(ws);
    console.log("Client disconnected");
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
});

// --- ROOM AND PLAYER LOGIC ---

function handleCreateRoom(ws, data) {
  const { playerName, role } = data;

  // 1. Create new room and code
  const roomCode = generateRoomCode();
  const gameState = createInitialGameState();
  const playerId = "player_" + Date.now();

  // 2. Assign role and player info
  if (role === "attacker") {
    gameState.attacker = { id: playerId, name: playerName };
  } else {
    gameState.defender = { id: playerId, name: playerName };
  }

  // 3. Store room and client info
  rooms.set(roomCode, gameState);
  clients.set(ws, { playerId, playerName, roomCode, role });

  console.log(`Room ${roomCode} created by ${playerName} as ${role}`);

  // 4. Respond to creator
  sendToClient(ws, {
    type: "roomCreated",
    roomCode: roomCode,
    playerId: playerId,
    role: role,
    data: gameState,
  });
}

function handleJoinRoom(ws, data) {
  const { playerName, roomCode } = data;
  const gameState = rooms.get(roomCode.toUpperCase());

  if (!gameState) {
    sendToClient(ws, {
      type: "error",
      message: "Room code invalid or room does not exist.",
    });
    return;
  }

  let role;
  const playerId = "player_" + Date.now();

  // 1. Determine available role (the opposite of the one already taken)
  if (gameState.attacker && !gameState.defender) {
    role = "defender";
    gameState.defender = { id: playerId, name: playerName };
  } else if (gameState.defender && !gameState.attacker) {
    role = "attacker";
    gameState.attacker = { id: playerId, name: playerName };
  } else {
    sendToClient(ws, {
      type: "error",
      message: "Room is full or roles are already taken.",
    });
    return;
  }

  // 2. Store client info
  clients.set(ws, {
    playerId,
    playerName,
    roomCode: roomCode.toUpperCase(),
    role,
  });

  console.log(`Player ${playerName} joined room ${roomCode} as ${role}`);

  // 3. Notify new client and start game if ready
  sendToClient(ws, {
    type: "roomJoined",
    roomCode: roomCode.toUpperCase(),
    playerId: playerId,
    role: role,
    data: gameState,
  });

  broadcastToRoom(
    roomCode.toUpperCase(),
    {
      type: "playerJoined",
      playerId: playerId,
      playerName: playerName,
      role: role,
    },
    ws
  );

  // 4. Check if both players ready - start game
  if (
    gameState.attacker &&
    gameState.defender &&
    gameState.gameStatus === "waiting"
  ) {
    gameState.gameStatus = "playing";
    gameState.gameStartTime = Date.now();

    broadcastToRoom(roomCode.toUpperCase(), {
      type: "gameStarted",
      attackerName: gameState.attacker.name,
      defenderName: gameState.defender.name,
    });

    console.log(`Game started in room ${roomCode}!`);
  }

  // Send full updated game state to everyone in the room
  broadcastToRoom(roomCode.toUpperCase(), {
    type: "gameState",
    data: gameState,
  });
}

// --- GAME ACTION HANDLERS ---

function handleTroopDeployed(ws, data) {
  const clientInfo = clients.get(ws);
  if (!clientInfo) return;

  const { roomCode, playerId } = clientInfo;
  const gameState = rooms.get(roomCode);
  if (
    !gameState ||
    gameState.gameStatus !== "playing" ||
    clientInfo.role !== "attacker"
  )
    return;

  const { troop, gold } = data;

  // Update server state (client-side validation must also be done)
  gameState.troops.push(troop);
  gameState.attackerGold = gold;

  broadcastToRoom(
    roomCode,
    {
      type: "troopDeployed",
      playerId: playerId,
      troop: troop,
      gold: gold,
    },
    ws
  );

  console.log(`[${roomCode}] Troop deployed: ${troop.type}`);
}

function handleTowerPlaced(ws, data) {
  const clientInfo = clients.get(ws);
  if (!clientInfo) return;

  const { roomCode, playerId } = clientInfo;
  const gameState = rooms.get(roomCode);
  if (
    !gameState ||
    gameState.gameStatus !== "playing" ||
    clientInfo.role !== "defender"
  )
    return;

  const { tower, gold } = data;

  // Update server state
  gameState.towers.push(tower);
  gameState.defenderGold = gold;

  broadcastToRoom(
    roomCode,
    {
      type: "towerPlaced",
      playerId: playerId,
      tower: tower,
      gold: gold,
    },
    ws
  );

  console.log(`[${roomCode}] Tower placed: ${tower.type}`);
}

function handleBaseHit(ws, data) {
  const clientInfo = clients.get(ws);
  if (!clientInfo) return;

  const { roomCode } = clientInfo;
  const gameState = rooms.get(roomCode);
  if (!gameState || gameState.gameStatus !== "playing") return;

  const { baseHP, damage } = data;

  // Update server state (This must be the primary source of truth, but for this simple
  // implementation, we rely on the client's calculated state for simplicity)
  gameState.baseHP = baseHP;

  broadcastToRoom(roomCode, {
    type: "baseHit",
    baseHP: baseHP,
    damage: damage,
  });

  console.log(`[${roomCode}] Base hit! Damage: ${damage}, HP: ${baseHP}`);

  // Check game over
  if (baseHP <= 0 && gameState.gameStatus === "playing") {
    gameState.gameStatus = "finished";

    broadcastToRoom(roomCode, {
      type: "gameOver",
      winner: "Attacker",
      reason: "Base destroyed",
    });

    console.log(`[${roomCode}] Game Over - Attacker wins!`);
  }
}

function handleChat(ws, data) {
  const clientInfo = clients.get(ws);
  if (!clientInfo) return;

  const { roomCode, playerName, playerId } = clientInfo;

  broadcastToRoom(roomCode, {
    type: "chat",
    playerId: playerId,
    playerName: playerName,
    message: data.message,
    timestamp: Date.now(),
  });

  console.log(`[${roomCode}][Chat] ${playerName}: ${data.message}`);
}

function handlePlayerDisconnect(ws) {
  const clientInfo = clients.get(ws);

  if (clientInfo) {
    const { playerId, playerName, roomCode, role } = clientInfo;
    const gameState = rooms.get(roomCode);

    if (gameState) {
      // Clear role and end game if playing
      if (role === "attacker") {
        gameState.attacker = null;
      } else {
        gameState.defender = null;
      }

      if (gameState.gameStatus === "playing") {
        gameState.gameStatus = "finished";

        broadcastToRoom(roomCode, {
          type: "gameOver",
          winner: role === "attacker" ? "Defender" : "Attacker",
          reason: "Opponent disconnected",
        });
      }

      // Remove room if both players left
      if (!gameState.attacker && !gameState.defender) {
        rooms.delete(roomCode);
        console.log(`Room ${roomCode} deleted.`);
      }
    }

    // Notify other clients
    broadcastToRoom(roomCode, {
      type: "playerLeft",
      playerId: playerId,
      playerName: playerName,
      role: role,
    });

    clients.delete(ws);
    console.log(`Player ${playerName} (${role}) left room ${roomCode}.`);
  }
}

// --- SERVER ENDPOINTS ---

// Reset game endpoint (now resets all rooms for simplicity in this example)
app.post("/reset", (req, res) => {
  rooms.clear();
  clients.clear();

  // Re-create a default room if necessary (omitted for clean state)

  wss.clients.forEach((ws) => {
    sendToClient(ws, { type: "gameReset" });
    ws.close(); // Force clients to reconnect
  });

  res.json({
    success: true,
    message: "All games reset successfully. Clients disconnected.",
  });
});

// Health check endpoint
app.get("/health", (req, res) => {
  let roomSummaries = {};
  rooms.forEach((state, code) => {
    roomSummaries[code] = {
      attacker: state.attacker ? state.attacker.name : "Waiting",
      defender: state.defender ? state.defender.name : "Waiting",
      gameStatus: state.gameStatus,
      baseHP: state.baseHP,
      players: (state.attacker ? 1 : 0) + (state.defender ? 1 : 0),
    };
  });

  res.json({
    status: "OK",
    activeRooms: rooms.size,
    roomDetails: roomSummaries,
  });
});

// Config endpoint
app.get("/config.js", (req, res) => {
  res.type("application/javascript");
  res.send(`
        const CONFIG = {
            WS_URL: 'ws://${process.env.WS_HOST || "localhost"}:${
    process.env.PORT || 8080
  }'
        };
    `);
});

const PORT = process.env.PORT || 8080;
const WS_HOST = process.env.WS_HOST || "localhost";

server.listen(PORT, () => {
  console.log(`🎮 PvP Tower Defense Server running on port ${PORT}`);
  console.log(`📡 WebSocket Server: ws://${WS_HOST}:${PORT}`);
  console.log(`🌐 Web Client: http://${WS_HOST}:${PORT}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: closing HTTP server");
  server.close(() => {
    console.log("HTTP server closed");
  });
});
