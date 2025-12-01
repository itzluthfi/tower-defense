
require("dotenv").config();
const http = require("http");
const express = require("express");
const path = require("path");
const WebSocket = require("ws");

const db = require("./db"); 
const setupWsHandlers = require("./wsHandlers");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });


app.use(express.static(path.join(__dirname, "public")));

app.get("/config.js", (req, res) => {
  res.type("application/javascript");
  const wsHost = process.env.WS_HOST || req.hostname;
  const port = process.env.PORT || 8080;

  const wsUrl = `ws://${wsHost}:${port}`;

  res.send(`
        const CONFIG = {
            WS_URL: '${wsUrl}'
        };
    `);
});


async function startServer() {
  const pool = await db.initializeDatabase();
  
  setupWsHandlers(wss, pool);

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