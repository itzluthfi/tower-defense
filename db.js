
const mysql = require("mysql2/promise");
const dotenv = require('dotenv');

dotenv.config();

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
    return pool; // Kembalikan koneksi pool
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

module.exports = {
  initializeDatabase,
  getPool: () => pool // Pool diakses melalui getter
};