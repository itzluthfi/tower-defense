# 🏰 Multiplayer Tower Defense Game

Real-time multiplayer tower defense game menggunakan WebSocket, HTML5 Canvas, JavaScript, dan Tailwind CSS.

## 📁 Struktur Folder

```
tower-defense-multiplayer/
│
├── server.js                 # WebSocket server (Node.js + Express)
├── package.json              # Dependencies dan scripts
├── package-lock.json         # Lock file untuk dependencies
├── README.md                 # Dokumentasi ini
│
└── public/                   # Client-side files
    ├── index.html            # Main HTML file
    ├── game.js               # Game logic & WebSocket client
    └── assets/               # (Optional) Images, sounds, etc.
```

## 🚀 Cara Install & Menjalankan

### 1. Install Dependencies

```bash
# Install Node.js dependencies
npm install
```

### 2. Jalankan Server

```bash
# Development mode (auto-restart on changes)
npm run dev

# Production mode
npm start
```

Server akan berjalan di:
- **WebSocket Server**: `ws://localhost:8080`
- **Web Client**: `http://localhost:8080`

### 3. Buka Game di Browser

Buka browser dan akses:
```
http://localhost:8080
```

Untuk multiplayer, buka beberapa tab/window atau minta teman untuk akses URL yang sama di jaringan lokal.

## 🎮 Cara Bermain

### Objective
Pertahankan base dari gelombang musuh dengan menempatkan tower secara strategis!

### Controls
1. **Join Game**: Masukkan nama Anda
2. **Select Tower**: Klik tower di sidebar kiri
3. **Place Tower**: Klik di canvas (hindari path ungu)
4. **Start Wave**: Klik tombol "Start Wave"
5. **Chat**: Gunakan chat box untuk berkomunikasi dengan pemain lain

### Tower Types

| Tower | Cost | Damage | Range | Speed | Special |
|-------|------|--------|-------|-------|---------|
| ⚔️ Basic | 💰100 | 10 | Medium | 1s | Balanced tower |
| 🎯 Sniper | 💰200 | 50 | Long | 2s | High damage, long range |
| ⚡ Rapid | 💰150 | 5 | Short | 0.3s | Very fast attack |
| 💥 Splash | 💰250 | 15 | Medium | 1.5s | Area damage |

### Game Mechanics
- **Shared Gold**: Semua pemain berbagi pool gold yang sama
- **Lives**: Kehilangan 1 life setiap musuh mencapai base
- **Wave System**: Musuh menjadi lebih kuat setiap wave
- **Collaboration**: Koordinasi dengan pemain lain untuk strategi optimal

## 🛠️ Teknologi yang Digunakan

### Backend
- **Node.js** - Runtime JavaScript
- **Express** - Web framework
- **ws** - WebSocket library

### Frontend
- **HTML5 Canvas** - Game rendering
- **Vanilla JavaScript** - Game logic
- **Tailwind CSS** - Styling
- **WebSocket API** - Real-time communication

## 🌐 WebSocket Events

### Client → Server

| Event | Description |
|-------|-------------|
| `playerJoined` | Player bergabung ke game |
| `towerPlaced` | Player menempatkan tower |
| `startWave` | Memulai wave baru |
| `enemyDied` | Musuh terbunuh |
| `enemyReachedBase` | Musuh mencapai base |
| `waveComplete` | Wave selesai |
| `chat` | Pesan chat |
| `syncGameState` | Sync state dengan server |

### Server → Client

| Event | Description |
|-------|-------------|
| `gameState` | Full game state update |
| `playerJoined` | Notifikasi player baru |
| `playerLeft` | Notifikasi player keluar |
| `towerPlaced` | Notifikasi tower baru |
| `waveStarted` | Wave dimulai |
| `waveComplete` | Wave selesai |
| `enemyDied` | Musuh mati |
| `enemyReachedBase` | Musuh sampai base |
| `gameOver` | Game berakhir |
| `chat` | Pesan chat dari player lain |
| `gameReset` | Game direset |

## 🔧 Konfigurasi

### Port Configuration
Edit di `server.js`:
```javascript
const PORT = process.env.PORT || 8080;
```

### WebSocket URL
Edit di `public/game.js`:
```javascript
const wsUrl = 'ws://localhost:8080';
// Untuk production:
// const wsUrl = 'ws://your-domain.com';
```

### Game Balance
Edit constants di `public/game.js`:
```javascript
const TOWER_TYPES = {
    basic: { cost: 100, damage: 10, range: 120, speed: 1000 },
    // Adjust values as needed
};
```

## 📝 Development Tips

### Testing Multiplayer Locally
1. Buka `http://localhost:8080` di multiple browser tabs
2. Atau gunakan multiple browsers (Chrome, Firefox, etc.)
3. Atau test dengan teman di jaringan lokal

### Debugging
- Buka Browser DevTools (F12)
- Check Console untuk WebSocket messages
- Check Network tab untuk WebSocket connections

### Adding Features
Beberapa ide fitur tambahan:
- 🎵 Sound effects & background music
- 🏆 Leaderboard system
- 💾 Save/load game state
- 🎨 Different enemy types
- ⚡ Power-ups & special abilities
- 📊 Statistics & analytics
- 🌍 Multiple maps/levels

## 🐛 Troubleshooting

### WebSocket Connection Failed
- Pastikan server berjalan (`npm start`)
- Check firewall settings
- Verify port 8080 tidak digunakan aplikasi lain

### Canvas Not Rendering
- Check browser console for errors
- Verify canvas element exists in DOM
- Clear browser cache

### Players Not Syncing
- Check WebSocket connection status
- Verify both clients connected to same server
- Check server logs for errors

## 📄 License

MIT License - Feel free to use for your projects!

## 🤝 Contributing

Pull requests are welcome! For major changes, please open an issue first.

## 📧 Support

Jika ada pertanyaan atau masalah, silakan buat issue di repository ini.

---

**Happy Gaming! 🎮**