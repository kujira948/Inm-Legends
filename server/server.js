const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { getLocalIp } = require('./discovery');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const port = process.env.PORT || 3000;

// JSONボディパース
app.use(express.json());

// ===============================================================
// 📂 ユーザーデータ管理（サーバーサイド永続化: userdata.json）
// GitHubやサーバー再起動時でもデータ（レート、デッキ、図鑑）を安全に保持
// ===============================================================
const DATA_FILE = path.join(__dirname, 'userdata.json');
const userDataStore = new Map(); // token -> { elo, deck, discoveredChimeras, name }

// 起動時に保存済みデータをロード
function loadUserData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE, 'utf8');
            const parsed = JSON.parse(raw);
            for (const [token, data] of Object.entries(parsed)) {
                userDataStore.set(token, data);
            }
            console.log(`[データ管理] ${userDataStore.size} 件のユーザーデータを読み込みました`);
        }
    } catch (err) {
        console.error('[データ管理] データの読み込みに失敗しました:', err.message);
    }
}

// データをファイルに非同期保存
function saveUserData() {
    try {
        const obj = Object.fromEntries(userDataStore.entries());
        fs.writeFile(DATA_FILE, JSON.stringify(obj, null, 2), 'utf8', (err) => {
            if (err) console.error('[データ管理] 保存エラー:', err.message);
        });
    } catch (err) {
        console.error('[データ管理] データ変換エラー:', err.message);
    }
}

loadUserData();

function getUserToken(req) {
    return req.headers['x-user-token'] || null;
}

// ユーザーデータの取得
app.get('/api/userdata', (req, res) => {
    const token = getUserToken(req);
    if (!token) return res.status(400).json({ error: 'token required' });
    const data = userDataStore.get(token) || {
        elo: 1200,
        deck: null,
        discoveredChimeras: [],
        name: 'ゲスト'
    };
    res.json(data);
});

// ユーザーデータの保存（部分更新）
app.post('/api/userdata', (req, res) => {
    const token = getUserToken(req);
    if (!token) return res.status(400).json({ error: 'token required' });
    const existing = userDataStore.get(token) || { elo: 1200, deck: null, discoveredChimeras: [], name: 'ゲスト' };
    const { elo, deck, discoveredChimeras, name } = req.body;
    if (elo !== undefined && typeof elo === 'number') existing.elo = Math.max(0, Math.min(9999, elo));
    if (deck && Array.isArray(deck) && deck.length >= 1 && deck.length <= 10) existing.deck = deck;
    if (discoveredChimeras && Array.isArray(discoveredChimeras)) existing.discoveredChimeras = discoveredChimeras;
    if (name && typeof name === 'string') existing.name = name.slice(0, 20);
    userDataStore.set(token, existing);
    saveUserData(); // ファイルへ自動保存
    res.json({ ok: true, data: existing });
});

// ランキング上位20件
app.get('/api/ranking', (req, res) => {
    const ranking = Array.from(userDataStore.entries())
        .map(([, d]) => ({ name: d.name || 'ゲスト', elo: d.elo || 1200 }))
        .sort((a, b) => b.elo - a.elo)
        .slice(0, 20);
    res.json(ranking);
});

// ===============================================================
// 静的ファイルの配信 (clientフォルダ)
// ===============================================================
app.use(express.static(path.join(__dirname, '../client')));

app.get('/version.json', (req, res) => {
    const versionPath = path.join(__dirname, '../version.json');
    if (fs.existsSync(versionPath)) {
        res.sendFile(versionPath);
    } else {
        res.json({ version: '1.0.0' });
    }
});

// サーバー情報（IPアドレスなど）をクライアントに返す
app.get('/api/server-info', (req, res) => {
    const isCloud = !!process.env.RENDER || !!process.env.RAILWAY_ENVIRONMENT;
    const host = isCloud ? req.hostname : getLocalIp();
    res.json({
        hostIp: host,
        port: port,
        hostName: hostPlayerName,
        url: isCloud ? `https://${host}` : `http://${host}:${port}`,
        isCloud
    });
});

// ===============================================================
// マッチメイキング & ルーム管理
// ===============================================================
const rooms = new Map();
const matchmakingQueues = { rated: [], unrated: [] };

let hostPlayerName = process.env.HOST_NAME || 'いなむーレジェンズ サーバー';
let connectedPlayers = new Map(); // ws -> { id, name }

function broadcastOnlinePlayers() {
    const playersList = Array.from(connectedPlayers.values()).map(p => ({
        id: p.id,
        name: p.name || 'ゲスト'
    }));

    const updateMsg = JSON.stringify({
        type: 'online_players_update',
        hostName: hostPlayerName,
        players: playersList
    });

    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(updateMsg);
        }
    });
}

wss.on('connection', (ws) => {
    const playerId = 'player_' + Math.random().toString(36).substr(2, 9);
    ws.playerId = playerId;
    ws.playerName = '匿名プレイヤー';
    connectedPlayers.set(ws, { id: playerId, name: ws.playerName });

    broadcastOnlinePlayers();

    ws.on('message', (message) => {
        try {
            // 文字列として扱う（中継時もバイナリではなく文字で送り、受信側の変換の手間を省く）
            const text = message.toString();
            const data = JSON.parse(text);

            switch (data.type) {
                case 'register_player':
                    if (data.name && data.name.trim() !== '') {
                        ws.playerName = data.name.trim().slice(0, 20);
                    }
                    connectedPlayers.set(ws, { id: ws.playerId, name: ws.playerName });
                    broadcastOnlinePlayers();
                    break;

                case 'set_host_name':
                    if (data.name && data.name.trim() !== '') {
                        hostPlayerName = data.name.trim();
                        broadcastOnlinePlayers();
                    }
                    break;

                case 'find_match': {
                    // 前の試合の部屋が残っていれば片付け、二重登録も防ぐ
                    leaveCurrentRoom(ws);
                    removeFromQueues(ws);

                    ws.isRated = !!data.isRated;
                    const queueKey = ws.isRated ? 'rated' : 'unrated';
                    const queue = matchmakingQueues[queueKey];

                    // 切断済み・自分自身は対戦相手にしない
                    let opponent = null;
                    while (queue.length > 0) {
                        const candidate = queue.shift();
                        if (candidate !== ws && candidate.readyState === WebSocket.OPEN) {
                            opponent = candidate;
                            break;
                        }
                    }

                    if (opponent) {
                        const roomId = Math.floor(100000 + Math.random() * 900000).toString();

                        const roomData = { players: [opponent, ws], host: opponent };
                        rooms.set(roomId, roomData);

                        opponent.roomId = roomId;
                        ws.roomId = roomId;

                        opponent.send(JSON.stringify({
                            type: 'created',
                            roomId,
                            side: 'left',
                            opponentName: ws.playerName
                        }));
                        ws.send(JSON.stringify({
                            type: 'joined',
                            roomId,
                            side: 'right',
                            opponentName: opponent.playerName
                        }));

                        console.log(`Matched: ${roomId} (${queueKey}) - ${opponent.playerName} vs ${ws.playerName}`);
                    } else {
                        queue.push(ws);
                        ws.send(JSON.stringify({ type: 'matching_started' }));
                    }
                    break;
                }

                case 'cancel_match':
                    removeFromQueues(ws);
                    ws.send(JSON.stringify({ type: 'matching_cancelled' }));
                    break;

                case 'leave_room':
                    // 試合終了時にクライアントから送られる。部屋を解散する
                    leaveCurrentRoom(ws);
                    break;

                case 'signal': {
                    const currentRoom = rooms.get(ws.roomId);
                    if (currentRoom) {
                        const isState = data.action === 'state';
                        currentRoom.players.forEach(p => {
                            if (p === ws || p.readyState !== WebSocket.OPEN) return;
                            // 相手側の受信が詰まっているときは盤面情報だけ間引く（召喚・試合終了などは必ず届ける）
                            if (isState && p.bufferedAmount > MAX_RELAY_BUFFER) return;
                            p.send(text);
                        });
                    }
                    break;
                }
            }
        } catch (err) {
            console.error('Error handling message:', err);
        }
    });

    ws.on('close', () => {
        connectedPlayers.delete(ws);
        removeFromQueues(ws);
        leaveCurrentRoom(ws);
        broadcastOnlinePlayers();
    });
});

// 相手側の送信待ちがこれ以上溜まっていたら、盤面情報(state)の中継を見送る
const MAX_RELAY_BUFFER = 64 * 1024;

// ws が入っている部屋を解散する。同じ部屋に残っている相手には切断を知らせる
// （試合終了後なら、相手側は試合中ではないので無視される）
function leaveCurrentRoom(ws) {
    const roomId = ws.roomId;
    if (!roomId) return;
    ws.roomId = null;
    const room = rooms.get(roomId);
    if (!room) return;
    rooms.delete(roomId);
    room.players.forEach(p => {
        // 相手がすでに別の部屋へ移っていたら何もしない（新しい試合を邪魔しない）
        if (p === ws || p.roomId !== roomId) return;
        p.roomId = null;
        if (p.readyState === WebSocket.OPEN) {
            try { p.send(JSON.stringify({ type: 'signal', action: 'opponent_disconnected' })); } catch (e) {}
        }
    });
}

function removeFromQueues(ws) {
    matchmakingQueues.rated = matchmakingQueues.rated.filter(p => p !== ws);
    matchmakingQueues.unrated = matchmakingQueues.unrated.filter(p => p !== ws);
}

// ===============================================================
// サーバー起動
// ===============================================================
server.listen(port, '0.0.0.0', () => {
    console.log('==================================================');
    console.log('   いなむーレジェンズ サーバー起動');
    console.log('==================================================');
    console.log(`  http://localhost:${port}`);
    const isCloud = !!process.env.RENDER || !!process.env.RAILWAY_ENVIRONMENT;
    if (isCloud) {
        console.log('  ☁️  クラウド環境で動作中');
    }
});
