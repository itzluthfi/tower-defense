// game.js - FULL VERSION (AUTH + GAMEPLAY + MYSQL)

const CONFIG = {
  // Ganti 'localhost' dengan IP laptop Anda jika main dari HP (misal: '192.168.1.5')
  WS_URL: "ws://localhost:8080",
};

// --- GLOBAL VARIABLES ---
let gameState = {
  attacker: null,
  defender: null,
  attackerGold: 1000,
  defenderGold: 1000,
  baseHP: 100,
  towers: [],
  troops: [],
  projectiles: [],
  gameStatus: "waiting", // waiting, playing, finished
  gameStartTime: 0,
};

// User & Connection State
let currentUser = null; // Menyimpan data user yang login { id: 1, username: "Adi" }
let ws = null;
let reconnectInterval = null;

// Game Room Variables
let playerId = null; // ID sementara di room (untuk logika sender/receiver)
let playerRole = null; // 'attacker' or 'defender'
let roomCode = null;
let selectedUnit = null;

// Canvas Setup
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

// -------------------------------------------------------
// --- 1. AUTHENTICATION & DASHBOARD LOGIC (NEW) ---
// -------------------------------------------------------

let authMode = "login"; // 'login' or 'register'

// --- SESSION MANAGEMENT (LOCAL STORAGE) ---
function saveSession(user) {
  localStorage.setItem("td_session_id", user.id);
  localStorage.setItem("td_session_username", user.username);
}

function clearSession() {
  localStorage.removeItem("td_session_id");
  localStorage.removeItem("td_session_username");
}

function checkSessionAndStart() {
  const storedUsername = localStorage.getItem("td_session_username");
  const storedId = localStorage.getItem("td_session_id");

  // Jika ada sesi di localStorage
  if (storedUsername && storedId) {
    currentUser = { id: storedId, username: storedUsername };

    // Langsung tampilkan dashboard, lalu coba koneksi WS & kirim getDashboard
    document.getElementById("authScreen").classList.add("hidden");
    document.getElementById("dashboardScreen").classList.remove("hidden");
    document.getElementById("dashboardScreen").classList.add("flex");

    // Koneksi dan segera minta data dashboard
    connectWebSocket(requestDashboard);
  } else {
    // Jika tidak ada sesi, tampilkan login screen dan konek WS
    document.getElementById("authScreen").classList.remove("hidden");
    connectWebSocket();
  }
}
// --- END SESSION MANAGEMENT ---

function toggleAuth(mode) {
  authMode = mode;
  const btnText = mode === "login" ? "Login" : "Register";
  document.getElementById("btnSubmitAuth").textContent = btnText; // Style Tabs Visual

  if (mode === "login") {
    document.getElementById("tabLogin").className =
      "flex-1 py-2 rounded-md font-bold text-sm bg-white/10 text-white transition-all";
    document.getElementById("tabRegister").className =
      "flex-1 py-2 rounded-md font-bold text-sm text-gray-400 hover:text-white transition-all";
  } else {
    document.getElementById("tabLogin").className =
      "flex-1 py-2 rounded-md font-bold text-sm text-gray-400 hover:text-white transition-all";
    document.getElementById("tabRegister").className =
      "flex-1 py-2 rounded-md font-bold text-sm bg-white/10 text-white transition-all";
  }
  document.getElementById("authMessage").textContent = "";
}

function submitAuth() {
  const username = document.getElementById("authUsername").value.trim();
  const password = document.getElementById("authPassword").value.trim();

  if (!username || !password) {
    document.getElementById("authMessage").textContent =
      "Please fill all fields";
    return;
  } // Pastikan WS terkoneksi sebelum kirim auth

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    connectWebSocket(() => {
      sendAuthRequest(username, password);
    });
  } else {
    sendAuthRequest(username, password);
  }
}

function sendAuthRequest(username, password) {
  sendToServer({
    type: authMode, // 'login' atau 'register'
    username: username,
    password: password,
  });
}

function requestDashboard() {
  sendToServer({ type: "getDashboard" });
}

function requestAvailableMatches() {
  sendToServer({ type: "getAvailableMatches" });
}

function updateDashboardUI(stats, leaderboard) {
  // 1. Update Profile Stats
  document.getElementById("dashUsername").textContent = currentUser.username;
  document.getElementById("dashTrophies").textContent = stats.trophies;
  document.getElementById("dashWins").textContent = stats.wins;
  document.getElementById("dashLosses").textContent = stats.losses;
  document.getElementById("dashMatches").textContent = stats.matches_played; // 2. Update Leaderboard Table

  const tbody = document.getElementById("leaderboardBody");
  tbody.innerHTML = "";

  if (leaderboard.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="3" class="p-4 text-center text-gray-500">No players yet.</td></tr>';
  } else {
    leaderboard.forEach((player, index) => {
      const row = document.createElement("tr");
      row.className = "hover:bg-white/5 transition border-b border-white/5";

      let rankDisplay = index + 1;
      if (index === 0) rankDisplay = "🥇";
      if (index === 1) rankDisplay = "🥈";
      if (index === 2) rankDisplay = "🥉";

      row.innerHTML = `
                <td class="p-3 font-bold ${
        index < 3 ? "text-yellow-400" : "text-gray-400"
      }">${rankDisplay}</td>
                <td class="p-3 font-semibold text-white">${player.username}</td>
                <td class="p-3 text-right font-bold text-yellow-400">${
        player.trophies
      } 🏆</td>
            `;
      tbody.appendChild(row);
    });
  }
}

function requestDashboard() {
  sendToServer({ type: "getDashboard" });
}

function requestAvailableMatches() {
  sendToServer({ type: "getAvailableMatches" });
}

function updateAvailableMatchesUI(matches) {
  const tbody = document.getElementById("availableMatchesBody");
  tbody.innerHTML = "";

  if (matches.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="4" class="p-4 text-center text-gray-500">No available matches</td></tr>';
  } else {
    matches.forEach((match) => {
      const row = document.createElement("tr");
      row.className = "hover:bg-white/5 transition border-b border-white/5";

      const timeAgo = getTimeAgo(new Date(match.created_at));
      const roleNeeded =
        match.needed_role === "attacker" ? "⚔️ Attacker" : "🛡️ Defender";
      const roleColor =
        match.needed_role === "attacker" ? "text-pink-400" : "text-blue-400";

      row.innerHTML = `
        <td class="p-3 font-mono font-bold text-purple-400">${match.room_code}</td>
        <td class="p-3 text-white">${match.creator_name}</td>
        <td class="p-3 ${roleColor} font-semibold">${roleNeeded}</td>
        <td class="p-3 text-gray-400 text-xs">${timeAgo}</td>
        <td class="p-3 text-right">
          <button onclick="quickJoinMatch('${match.room_code}')" 
                  class="bg-green-600 hover:bg-green-700 text-white px-4 py-1 rounded-lg text-sm font-bold transition">
            Join
          </button>
        </td>
      `;
      tbody.appendChild(row);
    });
  }
}

function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

// -------------------------------------------------------
// --- 2. WEBSOCKET CONNECTION & HANDLERS ---
// -------------------------------------------------------

function connectWebSocket(callback) {
  const wsUrl = CONFIG.WS_URL;
  ws = new WebSocket(wsUrl);
  const storedId = localStorage.getItem("td_session_id");

  ws.onopen = () => {
    console.log("WS Connected");
    if (reconnectInterval) clearInterval(reconnectInterval);
    if (storedId) {
      sendToServer({
        type: "reauth",
        id: storedId,
      });
    } else {
      if (callback) callback();
    }
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      handleServerMessage(data);
    } catch (error) {
      console.error("Error parsing message:", error);
    }
  };

  ws.onclose = () => {
    console.log("WS Disconnected"); // Auto reconnect logic
    if (!reconnectInterval) {
      reconnectInterval = setInterval(() => {
        console.log("Reconnecting...");
        connectWebSocket();
      }, 3000);
    }
  };
}

function sendToServer(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function handleServerMessage(data) {
  switch (
    data.type // --- AUTH RESPONSES ---
  ) {
    case "registerSuccess":
      document.getElementById("authMessage").className =
        "text-center text-green-400 text-sm mt-4";
      document.getElementById("authMessage").textContent = data.message;
      setTimeout(() => toggleAuth("login"), 1500); // Auto switch ke login tab
      break;

    case "loginSuccess":
      currentUser = { id: data.id, username: data.username }; // Simpan ID dari server
      saveSession(currentUser); // Simpan sesi // Sembunyikan Auth Screen, Tampilkan Dashboard
      document.getElementById("authScreen").classList.add("hidden");
      document.getElementById("dashboardScreen").classList.remove("hidden");
      document.getElementById("dashboardScreen").classList.add("flex");
      break;

    case "authError":
      document.getElementById("authMessage").className =
        "text-center text-red-400 text-sm mt-4";
      document.getElementById("authMessage").textContent = data.message;
      break;

    case "reauthSuccess":
      console.log("Re-authentication successful. Fetching dashboard data...");
      if (data.roomCode && data.role) {
        rejoinMatch(data.roomCode); // Jika sedang match, langsung rejoin
      } else {
        requestDashboard(); // Jika tidak ada match, tampilkan dashboard
      }
      break;

    case "dashboardData":
      updateDashboardUI(data.stats, data.leaderboard);
      requestAvailableMatches(); // Panggil List Match setelah dashboard dimuat
      break;

    case "availableMatches":
      updateAvailableMatchesUI(data.matches);
      break;

    case "roomCreated":
    case "roomJoined":
      roomCode = data.roomCode;
      playerId = data.playerId;
      playerRole = data.role;
      gameState = { ...gameState, ...data.data }; // Switch UI ke Game Mode

      document.getElementById("createMatchModal").classList.add("hidden");
      document.getElementById("joinMatchModal").classList.add("hidden");
      document.getElementById("dashboardScreen").classList.add("hidden");
      document.getElementById("dashboardScreen").classList.remove("flex");
      document.getElementById("gameContainer").classList.remove("hidden");

      setupPlayerRoleUI(playerRole);
      if (data.type === "roomCreated") {
        document.getElementById("displayRoomCode").textContent = roomCode;
        document.getElementById("waitingModal").classList.remove("hidden");
      }
      updateGameUI();
      break;

    case "gameStarted":
      gameState.gameStatus = "playing";
      gameState.gameStartTime = Date.now();
      document.getElementById("waitingModal").classList.add("hidden");
      addMessage("Game Started!", "system");
      updateGameUI();
      break;

    case "playerJoined":
      if (data.role === "attacker")
        gameState.attacker = { id: data.playerId, name: data.playerName };
      else gameState.defender = { id: data.playerId, name: data.playerName };
      addMessage(`${data.playerName} joined.`, "system");
      updateGameUI();
      break; // --- GAMEPLAY ACTIONS ---

    case "troopDeployed":
      if (data.playerId !== playerId) {
        gameState.troops.push(data.troop);
        gameState.attackerGold = data.gold;
      }
      break;
    case "towerPlaced":
      if (data.playerId !== playerId) {
        gameState.towers.push(data.tower);
        gameState.defenderGold = data.gold;
      }
      break;
    case "baseHit":
      gameState.baseHP = data.baseHP;
      updateGameUI();
      break;
    case "gameOver":
      gameState.gameStatus = "finished";
      showGameOverModal(data.winner, data.reason);
      break;
    case "chat":
      addMessage(`${data.playerName}: ${data.message}`, "chat");
      break;
    case "error":
      alert(data.message);
      break;
  }
}

// -------------------------------------------------------
// --- 3. UI HELPER FUNCTIONS ---
// -------------------------------------------------------

function setupPlayerRoleUI(role) {
  document.getElementById("attackerUnits").classList.add("hidden");
  document.getElementById("defenderUnits").classList.add("hidden");
  const roleEl = document.getElementById("playerRole");

  if (role === "attacker") {
    roleEl.textContent = "⚔️ Attacker";
    roleEl.className =
      "px-4 py-2 rounded-lg bg-pink-600 border border-pink-400";
    document.getElementById("attackerUnits").classList.remove("hidden");
  } else {
    roleEl.textContent = "🛡️ Defender";
    roleEl.className =
      "px-4 py-2 rounded-lg bg-blue-600 border border-blue-400";
    document.getElementById("defenderUnits").classList.remove("hidden");
  }
}

function updateGameUI() {
  const gameContainer = document.getElementById("gameContainer");
  if (!gameContainer || gameContainer.classList.contains("hidden")) {
    return;
  }

  const attackerGoldEl = document.getElementById("attackerGold");
  const defenderGoldEl = document.getElementById("defenderGold");
  const defenderHPEl = document.getElementById("defenderHP");
  const attackerNameEl = document.getElementById("attackerName");
  const defenderNameEl = document.getElementById("defenderName");
  const countdownEl = document.getElementById("countdown");

  if (
    !attackerGoldEl ||
    !defenderGoldEl ||
    !defenderHPEl ||
    !attackerNameEl ||
    !defenderNameEl
  ) {
    return;
  }

  attackerGoldEl.textContent = gameState.attackerGold;
  defenderGoldEl.textContent = gameState.defenderGold;
  defenderHPEl.textContent = gameState.baseHP;

  attackerNameEl.textContent = gameState.attacker
    ? gameState.attacker.name
    : "Waiting...";
  defenderNameEl.textContent = gameState.defender
    ? gameState.defender.name
    : "Waiting...";

  if (gameState.gameStatus === "playing" && countdownEl) {
    const elapsed = Math.floor((Date.now() - gameState.gameStartTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    countdownEl.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;
  }
}

function addMessage(text, type) {
  const log = document.getElementById("messageLog");
  const div = document.createElement("div");
  div.textContent = text;
  if (type === "chat") div.className = "text-white font-bold";
  else div.className = "text-gray-400 italic";
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function showGameOverModal(winner, reason) {
  document.getElementById("gameOverModal").classList.remove("hidden");
  const isWin = playerRole && playerRole.toLowerCase() === winner.toLowerCase();

  document.getElementById("winnerText").textContent = isWin
    ? "VICTORY!"
    : "DEFEAT";
  document.getElementById("winnerEmoji").textContent = isWin ? "🏆" : "💀";

  document.getElementById("gameResult").innerHTML = `
        <p>Winner: <span class="font-bold text-yellow-400">${winner}</span></p>
        <p>Reason: ${reason}</p>
        <p>Final Base HP: ${gameState.baseHP}</p>
        ${
    isWin
      ? '<p class="text-green-400 mt-2 font-bold">+10 Trophies!</p>'
      : '<p class="text-red-400 mt-2 font-bold">+0 Trophies</p>'
  }
    `;
}

// -------------------------------------------------------
// --- 4. MENU & BUTTON ACTIONS ---
// -------------------------------------------------------

function showCreateMatch() {
  document.getElementById("createMatchModal").classList.remove("hidden");
}

function showJoinMatch() {
  document.getElementById("joinMatchModal").classList.remove("hidden");
  requestAvailableMatches();
}

function backToDashboard() {
  document.getElementById("createMatchModal").classList.add("hidden");
  document.getElementById("joinMatchModal").classList.add("hidden");
}

let selectedCreateRoleValue = null;
function selectCreateRole(role) {
  selectedCreateRoleValue = role;
  document.getElementById("createAttacker").classList.remove("selected");
  document.getElementById("createDefender").classList.remove("selected");
  if (role === "attacker")
    document.getElementById("createAttacker").classList.add("selected");
  else document.getElementById("createDefender").classList.add("selected");
}

// Create Room (Tidak perlu kirim Nama lagi, server ambil dari session login)
function createMatch() {
  if (!selectedCreateRoleValue) return alert("Select a role first!");
  sendToServer({ type: "createRoom", role: selectedCreateRoleValue });
}

// Join Room
function joinMatch() {
  const code = document.getElementById("roomCodeInput").value.trim();
  if (code.length !== 6) return alert("Invalid Code");
  sendToServer({ type: "joinRoom", roomCode: code });
}

function quickJoinMatch(code) {
  sendToServer({ type: "joinRoom", roomCode: code });
}

function rejoinMatch(code) {
  sendToServer({ type: "rejoinRoom", roomCode: code });
}

function cancelWaiting() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();

    location.reload();
  } else {
    returnToMenu();
  }
}

function returnToMenu() {
  // Reset Client State
  gameState = {
    attacker: null,
    defender: null,
    attackerGold: 1000,
    defenderGold: 1000,
    baseHP: 100,
    towers: [],
    troops: [],
    projectiles: [],
    gameStatus: "waiting",
    gameStartTime: 0,
  };

  roomCode = null;
  playerId = null;
  playerRole = null; // UI Switch

  document.getElementById("gameContainer").classList.add("hidden");
  document.getElementById("gameOverModal").classList.add("hidden");
  document.getElementById("waitingModal").classList.add("hidden"); // Show Dashboard

  document.getElementById("dashboardScreen").classList.remove("hidden");
  document.getElementById("dashboardScreen").classList.add("flex"); // Refresh Stats & Leaderboard

  requestDashboard();
}

function confirmExit() {
  if (
    confirm(
      "Exit game? You will return to dashboard. This might count as a loss if the game has started."
    )
  ) {
    // Close sementara trigger disconnect di server, lalu biarkan auto-reconnect
    ws.close();
    location.reload();
  }
}

function logout() {
  if (confirm("Are you sure you want to logout?")) {
    clearSession(); // Hapus sesi dari localStorage
    window.location.reload();
  }
}

// -------------------------------------------------------
// --- 5. GAME LOGIC & CANVAS (ORIGINAL CODE INTEGRATED) ---
// -------------------------------------------------------

// CONSTANTS
const TROOP_TYPES = {
  soldier: {
    name: "Soldier",
    cost: 50,
    health: 50,
    maxHealth: 50,
    damage: 10,
    speed: 1.2,
    color: "#10b981",
    emoji: "🪖",
    size: 10,
  },
  tank: {
    name: "Tank",
    cost: 150,
    health: 200,
    maxHealth: 200,
    damage: 5,
    speed: 0.6,
    color: "#6b7280",
    emoji: "🚚",
    size: 15,
  },
  runner: {
    name: "Runner",
    cost: 80,
    health: 30,
    maxHealth: 30,
    damage: 8,
    speed: 2.5,
    color: "#fbbf24",
    emoji: "🏃",
    size: 8,
  },
  bomber: {
    name: "Bomber",
    cost: 200,
    health: 40,
    maxHealth: 40,
    damage: 50,
    speed: 1.0,
    color: "#ef4444",
    emoji: "💣",
    size: 12,
    explosive: true,
  },
};

const TOWER_TYPES = {
  basic: {
    name: "Basic",
    cost: 100,
    damage: 15,
    range: 120,
    speed: 1000,
    color: "#3b82f6",
    emoji: "⚔️",
  },
  sniper: {
    name: "Sniper",
    cost: 250,
    damage: 60,
    range: 220,
    speed: 2500,
    color: "#ef4444",
    emoji: "🎯",
  },
  rapid: {
    name: "Rapid",
    cost: 180,
    damage: 8,
    range: 100,
    speed: 400,
    color: "#10b981",
    emoji: "⚡",
  },
  splash: {
    name: "Splash",
    cost: 300,
    damage: 20,
    range: 110,
    speed: 1800,
    color: "#f59e0b",
    emoji: "💥",
    splashRadius: 50,
  },
};

const PATHS = [
  [
    { x: 0, y: 150 },
    { x: 300, y: 150 },
    { x: 300, y: 100 },
    { x: 600, y: 100 },
    { x: 600, y: 150 },
    { x: 900, y: 150 },
  ],
  [
    { x: 0, y: 350 },
    { x: 200, y: 350 },
    { x: 200, y: 300 },
    { x: 450, y: 300 },
    { x: 450, y: 400 },
    { x: 700, y: 400 },
    { x: 700, y: 350 },
    { x: 900, y: 350 },
  ],
  [
    { x: 0, y: 550 },
    { x: 300, y: 550 },
    { x: 300, y: 600 },
    { x: 600, y: 600 },
    { x: 600, y: 550 },
    { x: 900, y: 550 },
  ],
];
const BASE_POS = { x: 900, y: 350 };

function selectUnit(type) {
  selectedUnit = type;
  document
    .querySelectorAll(".unit-btn")
    .forEach((btn) => btn.classList.remove("selected"));
  document.getElementById("unit-" + type).classList.add("selected");
}

function sendChat() {
  const input = document.getElementById("chatInput");
  const message = input.value.trim();
  if (message) {
    sendToServer({ type: "chat", message: message }); // Client side chat echo removed here because server broadcasts it back
    input.value = "";
  }
}

// Canvas Click Handler
canvas.addEventListener("click", (e) => {
  if (!selectedUnit || gameState.gameStatus !== "playing") return; // Scaling correction for responsive canvas

  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top) * scaleY;

  if (playerRole === "attacker") deployTroop(x, y);
  else if (playerRole === "defender") placeTower(x, y);
});

function deployTroop(x, y) {
  const troopType = TROOP_TYPES[selectedUnit];
  if (gameState.attackerGold < troopType.cost) {
    addMessage("Not enough gold!", "error");
    return;
  } // Lane Detection

  let lane = -1;
  if (y > 100 && y < 200) lane = 0;
  else if (y > 300 && y < 400) lane = 1;
  else if (y > 500 && y < 600) lane = 2;

  if (lane === -1) {
    addMessage("Click near a lane!", "error");
    return;
  }

  const path = PATHS[lane];
  const troop = {
    id: "troop_" + Date.now(),
    type: selectedUnit,
    health: troopType.health,
    maxHealth: troopType.maxHealth,
    lane: lane,
    pathIndex: 0,
    progress: 0,
    x: path[0].x,
    y: path[0].y,
  };

  gameState.troops.push(troop);
  gameState.attackerGold -= troopType.cost;

  sendToServer({
    type: "troopDeployed",
    troop: troop,
    gold: gameState.attackerGold,
  });
  addMessage(`Deployed ${troopType.name}`, "tower");
  updateGameUI();
}

function placeTower(x, y) {
  const towerType = TOWER_TYPES[selectedUnit];
  if (gameState.defenderGold < towerType.cost) {
    addMessage("Not enough gold!", "error");
    return;
  }

  if (isOnAnyPath(x, y, 30)) {
    addMessage("Too close to path!", "error");
    return;
  }
  if (isTooCloseToOtherTowers(x, y, 40)) {
    addMessage("Too close to other tower!", "error");
    return;
  }

  const tower = {
    id: "tower_" + Date.now(),
    type: selectedUnit,
    x: x,
    y: y,
    lastShot: 0,
  };
  gameState.towers.push(tower);
  gameState.defenderGold -= towerType.cost;

  sendToServer({
    type: "towerPlaced",
    tower: tower,
    gold: gameState.defenderGold,
  });
  addMessage(`Placed ${towerType.name}`, "tower");
  updateGameUI();
}

// Logic Helpers
function isTooCloseToOtherTowers(x, y, minDistance) {
  for (const tower of gameState.towers) {
    const dist = Math.sqrt((tower.x - x) ** 2 + (tower.y - y) ** 2);
    if (dist < minDistance) return true;
  }
  return false;
}

function isOnAnyPath(x, y, threshold) {
  for (const path of PATHS) {
    for (let i = 0; i < path.length - 1; i++) {
      const dist = distanceToLineSegment(
        x,
        y,
        path[i].x,
        path[i].y,
        path[i + 1].x,
        path[i + 1].y
      );
      if (dist < threshold) return true;
    }
  }
  return false;
}

function distanceToLineSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2);
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lenSq));
  return Math.sqrt((px - (x1 + t * dx)) ** 2 + (py - (y1 + t * dy)) ** 2);
}

// GAME LOOP
function gameLoop() {
  if (gameState.gameStatus !== "playing") {
    updateGameUI();
    return;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGameMap(); // LOGIC TROOPS

  for (let i = gameState.troops.length - 1; i >= 0; i--) {
    const troop = gameState.troops[i];
    const type = TROOP_TYPES[troop.type];
    const path = PATHS[troop.lane]; // Move

    if (troop.pathIndex < path.length - 1) {
      const curr = path[troop.pathIndex];
      const next = path[troop.pathIndex + 1];
      const segDist = Math.sqrt(
        (next.x - curr.x) ** 2 + (next.y - curr.y) ** 2
      );
      troop.progress += type.speed;
      if (segDist > 0 && troop.progress >= segDist) {
        troop.progress -= segDist;
        troop.pathIndex++;
      } // Interpolate
      const pStart = path[troop.pathIndex];
      const pEnd = path[troop.pathIndex + 1] || BASE_POS;
      const dist =
        Math.sqrt((pEnd.x - pStart.x) ** 2 + (pEnd.y - pStart.y) ** 2) || 1;
      const t = troop.progress / dist;
      troop.x = pStart.x + (pEnd.x - pStart.x) * t;
      troop.y = pStart.y + (pEnd.y - pStart.y) * t;
    } else {
      // Base Hit
      if (Math.abs(troop.x - BASE_POS.x) < 5) {
        gameState.troops.splice(i, 1);
        gameState.baseHP -= type.damage;
        if (playerRole === "attacker") {
          sendToServer({
            type: "baseHit",
            baseHP: gameState.baseHP,
            damage: type.damage,
          });
        }
        continue;
      } else {
        // Final stretch to base center
        const dx = BASE_POS.x - troop.x;
        const dy = BASE_POS.y - troop.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        troop.x += (dx / d) * type.speed;
        troop.y += (dy / d) * type.speed;
      }
    }
    drawTroop(troop, type);
  } // LOGIC TOWERS & PROJECTILES

  const now = Date.now();
  gameState.towers.forEach((tower) => {
    const type = TOWER_TYPES[tower.type];
    drawTower(tower, type);

    if (now - tower.lastShot >= type.speed) {
      // Find Target
      const target = findTarget(tower, type.range);
      if (target) {
        tower.lastShot = now;
        gameState.projectiles.push({
          x: tower.x,
          y: tower.y,
          targetId: target.id,
          targetX: target.x,
          targetY: target.y,
          damage: type.damage,
          color: type.color,
          speed: 8,
          type: tower.type,
          splashRadius: type.splashRadius,
        });
      }
    }
  }); // LOGIC PROJECTILES

  for (let i = gameState.projectiles.length - 1; i >= 0; i--) {
    const proj = gameState.projectiles[i];
    const target = gameState.troops.find((t) => t.id === proj.targetId);
    if (target) {
      proj.targetX = target.x;
      proj.targetY = target.y;
    }

    const dx = proj.targetX - proj.x;
    const dy = proj.targetY - proj.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < proj.speed) {
      // Hit
      if (proj.type === "splash") {
        gameState.troops.forEach((t) => {
          const d = Math.sqrt(
            (t.x - proj.targetX) ** 2 + (t.y - proj.targetY) ** 2
          );
          if (d <= proj.splashRadius) t.health -= proj.damage;
        });
      } else if (target) {
        target.health -= proj.damage;
      }
      gameState.projectiles.splice(i, 1);
    } else {
      proj.x += (dx / dist) * proj.speed;
      proj.y += (dy / dist) * proj.speed;
      ctx.fillStyle = proj.color;
      ctx.beginPath();
      ctx.arc(proj.x, proj.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  } // Cleanup Dead Troops

  for (let i = gameState.troops.length - 1; i >= 0; i--) {
    if (gameState.troops[i].health <= 0) {
      gameState.troops.splice(i, 1);
      if (playerRole === "defender") gameState.defenderGold += 5;
    }
  }
  updateGameUI();
}

function findTarget(tower, range) {
  let target = null;
  let maxProgress = -1;
  gameState.troops.forEach((troop) => {
    const dist = Math.sqrt((troop.x - tower.x) ** 2 + (troop.y - tower.y) ** 2);
    if (dist <= range) {
      // Simple priority: troop with highest lane progress (closer to base)
      const p = troop.lane * 10000 + troop.pathIndex * 1000 + troop.progress;
      if (p > maxProgress) {
        maxProgress = p;
        target = troop;
      }
    }
  });
  return target;
}

// DRAWING FUNCTIONS
function drawGameMap() {
  PATHS.forEach((path, idx) => {
    const colors = ["#a78bfa", "#f472b6", "#fb923c"];
    ctx.strokeStyle = colors[idx];
    ctx.lineWidth = 35;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
    ctx.stroke();
    ctx.fillStyle = "white";
    ctx.font = "bold 16px Arial";
    ctx.fillText(`Lane ${idx + 1}`, 10, path[0].y - 30);
  });
  ctx.fillStyle = "#3b82f6";
  ctx.beginPath();
  ctx.arc(BASE_POS.x, BASE_POS.y, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "white";
  ctx.font = "20px Arial";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("🏰", BASE_POS.x, BASE_POS.y); // HP BAR

  ctx.fillStyle = "#000";
  ctx.fillRect(BASE_POS.x - 40, BASE_POS.y - 50, 80, 8);
  const hpPct = Math.max(0, gameState.baseHP / 100);
  ctx.fillStyle = hpPct > 0.5 ? "#10b981" : hpPct > 0.2 ? "#fbbf24" : "#ef4444";
  ctx.fillRect(BASE_POS.x - 40, BASE_POS.y - 50, 80 * hpPct, 8);
}

function drawTroop(t, type) {
  ctx.fillStyle = type.color;
  ctx.beginPath();
  ctx.arc(t.x, t.y, type.size, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `${type.size + 4}px Arial`;
  ctx.fillText(type.emoji, t.x, t.y); // HP
  if (t.health < t.maxHealth) {
    ctx.fillStyle = "#000";
    ctx.fillRect(t.x - 15, t.y - type.size - 10, 30, 4);
    ctx.fillStyle = "green";
    ctx.fillRect(
      t.x - 15,
      t.y - type.size - 10,
      30 * (t.health / t.maxHealth),
      4
    );
  }
}

function drawTower(t, type) {
  ctx.fillStyle = type.color;
  ctx.beginPath();
  ctx.arc(t.x, t.y, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "16px Arial";
  ctx.fillText(type.emoji, t.x, t.y);
}

// WINDOW EXPORTS
window.toggleAuth = toggleAuth;
window.submitAuth = submitAuth;
window.requestDashboard = requestDashboard;
window.selectUnit = selectUnit;
window.sendChat = sendChat;
window.showCreateMatch = showCreateMatch;
window.showJoinMatch = showJoinMatch;
window.createMatch = createMatch;
window.joinMatch = joinMatch;
window.quickJoinMatch = quickJoinMatch;
window.backToDashboard = backToDashboard;
window.selectCreateRole = selectCreateRole;
window.cancelWaiting = cancelWaiting;
window.returnToMenu = returnToMenu;
window.confirmExit = confirmExit;
window.logout = logout;

// STARTUP
checkSessionAndStart(); // Panggil fungsi ini untuk cek sesi dan memulai
setInterval(gameLoop, 1000 / 60);
