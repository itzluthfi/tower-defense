# ⚔️ PvP Tower Defense - Attacker vs Defender

Real-time **2-player PvP Tower Defense game** dengan sistem **Attacker vs Defender** dan **3 jalur serangan**. Dibangun menggunakan WebSocket, HTML5 Canvas, JavaScript, dan Tailwind CSS.

## 🎮 Konsep Game

### 👥 2 Player Roles

**⚔️ ATTACKER (Penyerang)**
- Deploy troops ke 3 jalur berbeda
- Tujuan: Hancurkan base musuh (100 HP)
- Dapatkan gold dari waktu untuk deploy lebih banyak troops
- 4 tipe troops dengan kekuatan berbeda

**🛡️ DEFENDER (Pertahanan)**
- Bangun towers untuk menghentikan troops
- Tujuan: Pertahankan base sampai musuh kehabisan troops
- Dapatkan gold dari membunuh troops
- 4 tipe towers dengan kemampuan berbeda

### 🗺️ 3 Attack Lanes

Game memiliki **3 jalur serangan** yang berbeda:
1. **Top Lane** (Jalur Atas)
2. **Middle Lane** (Jalur Tengah)  
3. **Bottom Lane** (Jalur Bawah)

Semua jalur menuju ke **1 titik base** yang harus dipertahankan defender.

## 📁 Struktur Folder

```
tower-defense-pvp/
│
├── server.js                 # WebSocket server
├── package.json              # Dependencies
├── .env                      # Environment variables
├── .gitignore               # Git ignore
├── README.md                # Dokumentasi
│
└── public/                  # Client files
    ├── index.html           # Main HTML
    ├── game.js              # Game logic
    └── config.js            # Auto-generated config
```

## 🚀 Cara Install & Run

### 1. Install Dependencies

```bash
npm install
```

### 2. Setup Environment (Optional)

Buat file `.env`:
```env
PORT=8080
WS_HOST=localhost
```

### 3. Jalankan Server

```bash
# Development mode
npm run dev

# Production mode
npm start
```

Server akan berjalan di:
- **WebSocket**: `ws://localhost:8080`
- **Web Client**: `http://localhost:8080`

### 4. Bermain

1. Buka **2 browser/tab** di `http://localhost:8080`
2. **Tab 1**: Pilih **Attacker** role, masukkan nama
3. **Tab 2**: Pilih **Defender** role, masukkan nama
4. Game otomatis dimulai saat kedua pemain siap!

## 🎯 Cara Bermain

### Untuk ATTACKER (⚔️)

1. **Pilih Troop** dari sidebar kiri
2. **Klik salah satu jalur** (Top/Middle/Bottom) untuk deploy
3. **Strategi**: 
   - Deploy troops secara teratur
   - Gunakan kombinasi troops berbeda
   - Serang multiple lanes untuk membingungkan defender
   - Simpan gold untuk troops kuat

### Untuk DEFENDER (🛡️)

1. **Pilih Tower** dari sidebar kiri
2. **Klik di map** untuk menempatkan tower (TIDAK di jalur!)
3. **Strategi**:
   - Tempatkan towers di titik strategis
   - Kombinasikan tower types untuk coverage optimal
   - Prioritaskan lanes yang banyak troops
   - Gunakan gold dari kills untuk tower lebih kuat

## 🪖 Troop Types (Attacker)

| Troop | Cost | HP | Damage | Speed | Special |
|-------|------|----|----|-------|---------|
| 🪖 **Soldier** | 💰50 | 50 | 10 | Medium | Balanced unit |
| 🚚 **Tank** | 💰150 | 200 | 5 | Slow | High HP tank |
| 🏃 **Runner** | 💰80 | 30 | 8 | Fast | Speed unit |
| 💣 **Bomber** | 💰200 | 40 | 50 | Medium | Explosive damage |

## 🗼 Tower Types (Defender)

| Tower | Cost | Damage | Range | Speed | Special |
|-------|------|--------|-------|-------|---------|
| ⚔️ **Basic** | 💰100 | 15 | Medium | 1s | Balanced tower |
| 🎯 **Sniper** | 💰250 | 60 | Long | 2.5s | High damage, long range |
| ⚡ **Rapid** | 💰180 | 8 | Short | 0.4s | Very fast attack |
| 💥 **Splash** | 💰300 | 20 | Medium | 1.8s | Area damage |

## 🏆 Kondisi Menang

### Attacker Menang:
- Base HP mencapai 0 (berhasil menghancurkan base)

### Defender Menang:
- Attacker kehabisan gold dan semua troops mati
- Bertahan sampai waktu habis (jika ada timer)

### Draw:
- Salah satu player disconnect

## 🛠️ Teknologi Stack

### Backend
- **Node.js** - Runtime
- **Express** - Web server
- **ws** - WebSocket library
- **dotenv** - Environment config

### Frontend
- **HTML5 Canvas** - Game rendering
- **Vanilla JavaScript** - Game logic
- **Tailwind CSS** - UI styling
- **WebSocket API** - Real-time communication

## 🌐 WebSocket Events

### Client → Server

| Event | Description | Data |
|-------|-------------|------|
| `playerJoined` | Player join dengan role | `{playerId, playerName, role}` |
| `troopDeployed` | Deploy troop ke lane | `{playerId, troop, gold}` |
| `towerPlaced` | Place tower di map | `{playerId, tower, gold}` |
| `baseHit` | Base terkena damage | `{baseHP, damage}` |
| `gameOver` | Game selesai | `{winner, reason}` |
| `chat` | Kirim chat message | `{playerId, playerName, message}` |

### Server → Client

| Event | Description |
|-------|-------------|
| `gameState` | Full game state update |
| `playerJoined` | Notifikasi player baru join |
| `gameStarted` | Game dimulai (both players ready) |
| `troopDeployed` | Notifikasi troop baru |
| `towerPlaced` | Notifikasi tower baru |
| `baseHit` | Base terkena damage |
| `gameOver` | Game berakhir dengan winner |
| `playerLeft` | Player disconnect |
| `chat` | Chat message dari player lain |

## ⚙️ Konfigurasi

### Game Balance

Edit di `game.js` untuk adjust balance:

```javascript
// Troop stats
const TROOP_TYPES = {
    soldier: { cost: 50, health: 50, damage: 10, speed: 1.2 },
    // ... adjust as needed
};

// Tower stats
const TOWER_TYPES = {
    basic: { cost: 100, damage: 15, range: 120, speed: 1000 },
    // ... adjust as needed
};
```

### Starting Gold

Edit di `server.js`:

```javascript
let gameState = {
    attackerGold: 1000,  // Change this
    defenderGold: 1000,  // Change this
    baseHP: 100,         // Change base HP
    // ...
};
```

### Path Configuration

Edit di `game.js` untuk mengubah jalur:

```javascript
const PATHS = [
    // Top lane
    [{x: 0, y: 150}, {x: 300, y: 150}, ...],
    // Middle lane
    [{x: 0, y: 350}, {x: 200, y: 350}, ...],
    // Bottom lane
    [{x: 0, y: 550}, {x: 300, y: 550}, ...]
];
```

## 🎨 Features

✅ **Real-time PvP** - 2 player head-to-head  
✅ **3 Attack Lanes** - Multiple strategic paths  
✅ **4 Troop Types** - Varied attacker units  
✅ **4 Tower Types** - Different defense strategies  
✅ **Live Gold System** - Economy management  
✅ **Base HP System** - Clear win condition  
✅ **Visual Feedback** - Health bars, projectiles  
✅ **Live Chat** - Communication between players  
✅ **Auto-reconnect** - Connection reliability  
✅ **Responsive UI** - Modern gradient design  

## 🔧 Development

### Testing Multiplayer Locally

1. Buka 2 browser tabs/windows
2. Tab 1: Pilih Attacker
3. Tab 2: Pilih Defender
4. Game auto-start!

### Adding New Troops/Towers

1. Edit `TROOP_TYPES` atau `TOWER_TYPES` di `game.js`
2. Tambah button di `index.html`
3. Update balance di `server.js` jika perlu

### Debugging

- Browser Console (F12) untuk client logs
- Terminal untuk server logs
- Network tab untuk WebSocket messages

## 📝 Roadmap / Future Features

Ide pengembangan selanjutnya:

- [ ] 🎵 Sound effects & background music
- [ ] 🏆 Match history & statistics
- [ ] ⏱️ Time limit mode
- [ ] 💰 Income over time system
- [ ] 🎯 Tower upgrade system
- [ ] 🪖 Troop abilities & skills
- [ ] 🗺️ Multiple maps
- [ ] 👥 Spectator mode
- [ ] 🏅 Ranking system
- [ ] 🎮 Tournament mode

## 🐛 Troubleshooting

### WebSocket Not Connecting
- Pastikan server running (`npm start`)
- Check port 8080 available
- Verify firewall settings

### Role Already Taken
- Hanya 1 Attacker dan 1 Defender per game
- Refresh page untuk reconnect

### Troops Not Moving
- Check browser console for errors
- Verify game status is "playing"
- Try clicking different lanes

### Towers Not Shooting
- Ensure troops in tower range
- Check tower cooldown
- Verify game started

## 📄 License

MIT License - Free untuk digunakan dan dimodifikasi!

## 🤝 Contributing

Pull requests welcome! Silakan:
1. Fork repository
2. Create feature branch
3. Commit changes
4. Push dan create PR

## 💡 Credits

Game ini dibuat untuk demonstrasi WebSocket real-time gaming dengan konsep PvP Tower Defense yang unik.

---

**Have Fun Playing! ⚔️🛡️**

**Tips untuk Menang:**
- **Attacker**: Jangan rush! Save gold untuk troops kuat
- **Defender**: Prioritas coverage semua lanes sejak awal
- **Both**: Komunikasi via chat untuk mind games! 😉