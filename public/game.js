
if (typeof CONFIG === "undefined") {
  console.warn("⚠️ Config gagal dimuat. Fallback ke localhost.");
  var CONFIG = { };
}

let gameState = {
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

let currentUser = null;
let ws = null;
let reconnectInterval = null;
const GAME_DURATION_SEC = 60;

let playerId = null;
let matchesInterval = null; 
let playerRole = null;
let roomCode = null;
let selectedUnit = null;
let selectedUnitRange = 0; 

let goldInterval = null;

let mouseX = 0;
let mouseY = 0;

const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");


let authMode = "login";

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

  if (storedUsername && storedId) {
    currentUser = { id: storedId, username: storedUsername };
    document.getElementById("authScreen").classList.add("hidden");
    document.getElementById("dashboardScreen").classList.remove("hidden");
    document.getElementById("dashboardScreen").classList.add("flex");
    connectWebSocket(requestDashboard);
  } else {
    document.getElementById("authScreen").classList.remove("hidden");
    connectWebSocket();
  }
}

function toggleAuth(mode) {
  authMode = mode;
  const btnText = mode === "login" ? "Login" : "Register";
  document.getElementById("btnSubmitAuth").textContent = btnText;

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
  }

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    connectWebSocket(() => {
      sendAuthRequest(username, password);
    });
  } else {
    sendAuthRequest(username, password);
  }
}

function sendAuthRequest(username, password) {
  sendToServer({ type: authMode, username: username, password: password });
}

function requestDashboard() {
  sendToServer({ type: "getDashboard" });
}

function requestAvailableMatches() {
  sendToServer({ type: "getAvailableMatches" });
}

function updateLeaderboardOnly(leaderboard) {
  const tbody = document.getElementById("leaderboardBody");
  if (!tbody) return;

  tbody.innerHTML = ""; 

  if (!leaderboard || leaderboard.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="3" class="p-4 text-center text-gray-500">No players yet.</td></tr>';
  } else {
    leaderboard.forEach((player, index) => {
      const row = document.createElement("tr");
      row.className = "hover:bg-white/5 transition border-b border-white/5";

      let rankDisplay = index + 1;
      let rankColor = "text-gray-400";

      if (index === 0) {
        rankDisplay = "🥇";
        rankColor = "text-yellow-400";
      }
      if (index === 1) {
        rankDisplay = "🥈";
        rankColor = "text-gray-300";
      }
      if (index === 2) {
        rankDisplay = "🥉";
        rankColor = "text-orange-400";
      }

      row.innerHTML = `
        <td class="p-3 font-bold ${rankColor}">${rankDisplay}</td>
        <td class="p-3 font-semibold text-white">${player.username}</td>
        <td class="p-3 text-right font-bold text-yellow-400">${player.trophies} 🏆</td>
      `;
      tbody.appendChild(row);
    });
  }
}

function updateDashboardUI(stats, leaderboard) {
  document.getElementById("dashUsername").textContent = currentUser.username;
  document.getElementById("dashTrophies").textContent = stats.trophies || 0;
  document.getElementById("dashWins").textContent = stats.wins || 0;
  document.getElementById("dashLosses").textContent = stats.losses || 0;
  document.getElementById("dashMatches").textContent =
    stats.matches_played || 0;

  const tbody = document.getElementById("leaderboardBody");
  tbody.innerHTML = "";

  if (!leaderboard || leaderboard.length === 0) {
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

function updateAvailableMatchesUI(matches) {
  const tbody = document.getElementById("availableMatchesBody");
  tbody.innerHTML = "";

  if (!matches || matches.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="p-4 text-center text-gray-500">No available matches</td></tr>';
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
          <button onclick="quickJoinMatch('${match.room_code}')" class="bg-green-600 hover:bg-green-700 text-white px-4 py-1 rounded-lg text-sm font-bold transition">Join</button>
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
// ---  WEBSOCKET CONNECTION & HANDLERS ---
// -------------------------------------------------------

function connectWebSocket(callback) {
  const wsUrl = CONFIG.WS_URL;
  ws = new WebSocket(wsUrl);
  const storedId = localStorage.getItem("td_session_id");

  ws.onopen = () => {
    console.log("WS Connected");
    if (reconnectInterval) clearInterval(reconnectInterval);
    if (storedId) {
      sendToServer({ type: "reauth", id: storedId });
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
    console.log("WS Disconnected");
    updateConnectionStatus(false);
    if (!reconnectInterval) {
      reconnectInterval = setInterval(() => {
        console.log("Reconnecting...");
        connectWebSocket(() => {
          // Callback: Jika berhasil connect lagi, coba reauth
          const storedId = localStorage.getItem("td_session_id");
          if (storedId) sendToServer({ type: "reauth", id: storedId });
        });
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
  switch (data.type) {
    case "registerSuccess":
      document.getElementById("authMessage").className =
        "text-center text-green-400 text-sm mt-4";
      document.getElementById("authMessage").textContent = data.message;
      setTimeout(() => toggleAuth("login"), 1500);
      break;

    case "loginSuccess":
      currentUser = { id: data.id, username: data.username };
      saveSession(currentUser);
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
      if (data.roomCode && data.role) {
        rejoinMatch(data.roomCode);
      } else {
        requestDashboard();
      }
      break;

    case "leaderboardUpdate":
      updateLeaderboardOnly(data.leaderboard);
      break;

    case "dashboardData":
      updateDashboardUI(data.stats, data.leaderboard);
      requestAvailableMatches(); // Request pertama kali

      if (matchesInterval) clearInterval(matchesInterval);

      matchesInterval = setInterval(() => {
        if (
          !document
            .getElementById("dashboardScreen")
            .classList.contains("hidden")
        ) {
          requestAvailableMatches();
        }
      }, 3000);
      break;

    case "availableMatches":
      updateAvailableMatchesUI(data.matches);
      break;

    case "roomCreated":
    case "roomJoined":
      if (matchesInterval) clearInterval(matchesInterval);

      roomCode = data.roomCode;
      playerId = data.playerId;
      playerRole = data.role;
      gameState = { ...gameState, ...data.data };

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
      startGoldGeneration();
      updateGameUI();
      break;

    case "playerJoined":
      if (data.role === "attacker")
        gameState.attacker = { id: data.playerId, name: data.playerName };
      else gameState.defender = { id: data.playerId, name: data.playerName };
      addMessage(`${data.playerName} joined.`, "system");
      updateGameUI();
      break;

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
    case "updateGold":
      if (data.role === "attacker") gameState.attackerGold = data.gold;
      else gameState.defenderGold = data.gold;
      updateGameUI();
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
// ---  UI HELPER FUNCTIONS ---
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
  if (!gameContainer || gameContainer.classList.contains("hidden")) return;

  const attackerGoldEl = document.getElementById("attackerGold");
  const defenderGoldEl = document.getElementById("defenderGold");
  const defenderHPEl = document.getElementById("defenderHP");
  const attackerNameEl = document.getElementById("attackerName");
  const defenderNameEl = document.getElementById("defenderName");
  const countdownEl = document.getElementById("countdown");

  if (!attackerGoldEl) return;

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
    const elapsedSec = Math.floor(
      (Date.now() - gameState.gameStartTime) / 1000
    );

    let remainingSec = GAME_DURATION_SEC - elapsedSec;

    if (remainingSec < 0) remainingSec = 0;

    const mins = Math.floor(remainingSec / 60);
    const secs = remainingSec % 60;

    if (remainingSec <= 10) {
      countdownEl.parentElement.className =
        "bg-red-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 border border-red-700 animate-pulse";
    } else {
      countdownEl.parentElement.className =
        "bg-gray-800 px-4 py-2 rounded-lg flex items-center gap-2 border border-gray-700";
    }

    countdownEl.textContent = `${mins}:${secs.toString().padStart(2, "0")}`;
  }
}

function addMessage(text, type) {
  const log = document.getElementById("messageLog");
  const div = document.createElement("div");
  div.textContent = text;
  div.className =
    type === "chat" ? "text-white font-bold" : "text-gray-400 italic";
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
// ---  MENU & BUTTON ACTIONS ---
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

function createMatch() {
  if (!selectedCreateRoleValue) return alert("Select a role first!");
  sendToServer({ type: "createRoom", role: selectedCreateRoleValue });
}

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

  if (ws && ws.readyState === WebSocket.OPEN) {
    sendToServer({ type: "leaveMatch" });
  } else {
    console.log("Connection lost, reconnecting for dashboard...");
    connectWebSocket(requestDashboard);
  }

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

  if (matchesInterval) {
    clearInterval(matchesInterval);
    matchesInterval = null;
  }
  stopGoldGeneration();

  roomCode = null;
  playerId = null;
  playerRole = null;
  // if (reconnectInterval) {
  //   clearInterval(reconnectInterval);
  //   reconnectInterval = null;
  // }

  document.getElementById("gameContainer").classList.add("hidden");
  document.getElementById("gameOverModal").classList.add("hidden");
  document.getElementById("waitingModal").classList.add("hidden");
  document.getElementById("authScreen").classList.add("hidden");
  document.getElementById("dashboardScreen").classList.remove("hidden");
  document.getElementById("dashboardScreen").classList.add("flex");

  // Refresh data dan nyalakan lagi interval
  setTimeout(() => {
    requestDashboard();
    requestAvailableMatches();

    // Nyalakan lagi interval refresh room
    matchesInterval = setInterval(() => {
      if (
        !document.getElementById("dashboardScreen").classList.contains("hidden")
      ) {
        requestAvailableMatches();
      }
    }, 3000);
  }, 200);
}

function confirmExit() {
  if (confirm("Exit game? You will return to dashboard.")) {
    stopGoldGeneration();
    if (
      gameState.gameStatus === "playing" &&
      ws &&
      ws.readyState === WebSocket.OPEN
    )
      sendToServer({ type: "leaveMatch" });
    window.location.reload();
  }
}

function logout() {
  if (confirm("Are you sure you want to logout?")) {
    clearSession();
    window.location.reload();
  }
}

// -------------------------------------------------------
// ---  GAME LOGIC & CANVAS ---
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

const BASE_POS = { x: 900, y: 350 };
const PATHS = [
  [
    { x: 0, y: 150 },
    { x: 300, y: 150 },
    { x: 300, y: 100 },
    { x: 600, y: 100 },
    { x: 600, y: 150 },
    { x: 800, y: 150 },
    { x: 800, y: 350 },
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
    { x: 800, y: 550 },
    { x: 800, y: 350 },
  ],
];

function selectUnit(type) {
  selectedUnit = type;
  document
    .querySelectorAll(".unit-btn")
    .forEach((btn) => btn.classList.remove("selected"));
  document.getElementById("unit-" + type).classList.add("selected");
  if (playerRole === "defender" && TOWER_TYPES[type])
    selectedUnitRange = TOWER_TYPES[type].range;
  else selectedUnitRange = 0;
}

function sendChat() {
  const input = document.getElementById("chatInput");
  const message = input.value.trim();
  if (message) {
    sendToServer({ type: "chat", message: message });
    input.value = "";
  }
}

function startGoldGeneration() {
  if (goldInterval) clearInterval(goldInterval);
  goldInterval = setInterval(() => {
    if (gameState.gameStatus !== "playing" || !playerRole) return;
    const goldGain = 50;
    if (playerRole === "attacker") {
      gameState.attackerGold += goldGain;
      sendToServer({
        type: "updateGold",
        role: "attacker",
        gold: gameState.attackerGold,
      });
    } else {
      gameState.defenderGold += goldGain;
      sendToServer({
        type: "updateGold",
        role: "defender",
        gold: gameState.defenderGold,
      });
    }
    updateGameUI();
  }, 5000);
}

function stopGoldGeneration() {
  if (goldInterval) clearInterval(goldInterval);
  goldInterval = null;
}

function drawRangeCircle(x, y) {
  if (selectedUnitRange > 0) {
    ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, selectedUnitRange, 0, Math.PI * 2);
    ctx.stroke();
  }
}

canvas.addEventListener("click", (e) => {
  if (!selectedUnit || gameState.gameStatus !== "playing") return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top) * scaleY;
  if (playerRole === "attacker") deployTroop(x, y);
  else if (playerRole === "defender") placeTower(x, y);
});

canvas?.addEventListener("mousemove", (e) => {
  if (playerRole !== "defender" || gameState.gameStatus !== "playing") return;
  const rect = canvas.getBoundingClientRect();
  mouseX = (e.clientX - rect.left) * (canvas.width / rect.width);
  mouseY = (e.clientY - rect.top) * (canvas.height / rect.height);
});

canvas?.addEventListener("mouseout", () => {
  selectedUnitRange = 0;
});

function deployTroop(x, y) {
  const type = TROOP_TYPES[selectedUnit];
  if (gameState.attackerGold < type.cost) {
    addMessage("Not enough gold!", "error");
    return;
  }
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
    health: type.health,
    maxHealth: type.maxHealth,
    lane: lane,
    pathIndex: 0,
    progress: 0,
    x: path[0].x,
    y: path[0].y,
  };
  gameState.troops.push(troop);
  gameState.attackerGold -= type.cost;
  sendToServer({
    type: "troopDeployed",
    troop: troop,
    gold: gameState.attackerGold,
  });
  addMessage(`Deployed ${type.name}`, "tower");
  updateGameUI();
}

function placeTower(x, y) {
  const type = TOWER_TYPES[selectedUnit];
  if (gameState.defenderGold < type.cost) {
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
  gameState.defenderGold -= type.cost;
  sendToServer({
    type: "towerPlaced",
    tower: tower,
    gold: gameState.defenderGold,
  });
  addMessage(`Placed ${type.name}`, "tower");
  updateGameUI();
}

function isTooCloseToOtherTowers(x, y, min) {
  return gameState.towers.some(
    (t) => Math.sqrt((t.x - x) ** 2 + (t.y - y) ** 2) < min
  );
}

function isOnAnyPath(x, y, thres) {
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
      if (dist < thres) return true;
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
  drawGameMap();

  for (let i = gameState.troops.length - 1; i >= 0; i--) {
    const t = gameState.troops[i];
    const type = TROOP_TYPES[t.type];
    const path = PATHS[t.lane];
    if (t.pathIndex < path.length - 1) {
      const curr = path[t.pathIndex];
      const next = path[t.pathIndex + 1];
      const dist = Math.sqrt((next.x - curr.x) ** 2 + (next.y - curr.y) ** 2);
      t.progress += type.speed;
      if (dist > 0 && t.progress >= dist) {
        t.progress -= dist;
        t.pathIndex++;
      }
      const p1 = path[t.pathIndex];
      const p2 = path[t.pathIndex + 1] || BASE_POS;
      const d = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2) || 1;
      const r = t.progress / d;
      t.x = p1.x + (p2.x - p1.x) * r;
      t.y = p1.y + (p2.y - p1.y) * r;
    } else {
      if (Math.abs(t.x - BASE_POS.x) < 5) {
        gameState.troops.splice(i, 1);
        gameState.baseHP -= type.damage;
        if (playerRole === "attacker")
          sendToServer({
            type: "baseHit",
            baseHP: gameState.baseHP,
            damage: type.damage,
          });
        continue;
      } else {
        const dx = BASE_POS.x - t.x;
        const dy = BASE_POS.y - t.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        t.x += (dx / d) * type.speed;
        t.y += (dy / d) * type.speed;
      }
    }
    drawTroop(t, type);
  }

  const now = Date.now();
  gameState.towers.forEach((tower) => {
    const type = TOWER_TYPES[tower.type];
    drawTower(tower, type);
    if (now - tower.lastShot >= type.speed) {
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
  });

  for (let i = gameState.projectiles.length - 1; i >= 0; i--) {
    const p = gameState.projectiles[i];
    const target = gameState.troops.find((t) => t.id === p.targetId);
    if (target) {
      p.targetX = target.x;
      p.targetY = target.y;
    }
    const dx = p.targetX - p.x;
    const dy = p.targetY - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < p.speed) {
      if (p.type === "splash") {
        gameState.troops.forEach((t) => {
          if (
            Math.sqrt((t.x - p.targetX) ** 2 + (t.y - p.targetY) ** 2) <=
            p.splashRadius
          )
            t.health -= p.damage;
        });
      } else if (target) target.health -= p.damage;
      gameState.projectiles.splice(i, 1);
    } else {
      p.x += (dx / dist) * p.speed;
      p.y += (dy / dist) * p.speed;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (let i = gameState.troops.length - 1; i >= 0; i--) {
    if (gameState.troops[i].health <= 0) {
      gameState.troops.splice(i, 1);
      if (playerRole === "defender") gameState.defenderGold += 5;
    }
  }

  if (selectedUnitRange > 0 && playerRole === "defender") {
    drawRangeCircle(mouseX, mouseY);
  }

  updateGameUI();
}

function findTarget(tower, range) {
  let target = null;
  let maxP = -1;
  gameState.troops.forEach((t) => {
    if (Math.sqrt((t.x - tower.x) ** 2 + (t.y - tower.y) ** 2) <= range) {
      const p = t.lane * 10000 + t.pathIndex * 1000 + t.progress;
      if (p > maxP) {
        maxP = p;
        target = t;
      }
    }
  });
  return target;
}

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
  ctx.fillText("🏰", BASE_POS.x, BASE_POS.y);
  ctx.fillStyle = "#000";
  ctx.fillRect(BASE_POS.x - 40, BASE_POS.y - 50, 80, 8);
  const hp = Math.max(0, gameState.baseHP / 100);
  ctx.fillStyle = hp > 0.5 ? "#10b981" : hp > 0.2 ? "#fbbf24" : "#ef4444";
  ctx.fillRect(BASE_POS.x - 40, BASE_POS.y - 50, 80 * hp, 8);
}

function drawTroop(t, type) {
  ctx.fillStyle = type.color;
  ctx.beginPath();
  ctx.arc(t.x, t.y, type.size, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = `${type.size + 4}px Arial`;
  ctx.fillText(type.emoji, t.x - 5, t.y + 4);
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
  ctx.fillText(type.emoji, t.x - 8, t.y + 5);
}

window.toggleAuth = toggleAuth;
window.submitAuth = submitAuth;
window.requestDashboard = requestDashboard;
window.requestAvailableMatches = requestAvailableMatches; 
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

checkSessionAndStart();
setInterval(gameLoop, 1000 / 60);
