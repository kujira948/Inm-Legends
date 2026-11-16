const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const BoardGamesServer = require('./boardgames-server'); // ♟ ☗ 将棋・チェス

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
    const prevElo = existing.elo;
    const { elo, deck, discoveredChimeras, name } = req.body;
    if (elo !== undefined && typeof elo === 'number') existing.elo = Math.max(0, Math.min(9999, elo));
    if (deck && Array.isArray(deck) && deck.length >= 1 && deck.length <= 10) existing.deck = deck;
    if (discoveredChimeras && Array.isArray(discoveredChimeras)) existing.discoveredChimeras = discoveredChimeras;
    if (name && typeof name === 'string') existing.name = name.slice(0, 20);
    // レートが動いた = レート戦をした人（ランキングにはこの人たちだけを出す）
    if (existing.elo !== prevElo) existing.ratedGames = (existing.ratedGames || 0) + 1;
    userDataStore.set(token, existing);
    saveUserData(); // ファイルへ自動保存
    if (existing.elo !== prevElo) broadcastOnlinePlayers(); // ホーム画面のレート表示を更新
    res.json({ ok: true, data: existing });
});

// ランキング上位20件
app.get('/api/ranking', (req, res) => {
    const ranking = Array.from(userDataStore.entries())
        // レート戦をしたことがある人だけ（遊びに来ただけの人で埋まらないように）
        .filter(([, d]) => (d.ratedGames || 0) > 0 || (typeof d.elo === 'number' && d.elo !== 1200))
        .map(([, d]) => ({ name: d.name || 'ゲスト', elo: d.elo || 1200 }))
        .sort((a, b) => b.elo - a.elo)
        .slice(0, 20);
    res.json(ranking);
});

// ===============================================================
// 静的ファイルの配信 (clientフォルダ)
// ===============================================================
app.use(express.static(path.join(__dirname, '../client')));

// ===============================================================
// マッチメイキング & ルーム管理
// ===============================================================
const rooms = new Map();
const matchmakingQueues = { rated: [], unrated: [] };

const hostPlayerName = process.env.HOST_NAME || 'いなむーレジェンズ サーバー';
let connectedPlayers = new Map(); // ws -> { id, name }

// 各プレイヤーのいまの状態（対戦中 / 対戦待ち / 待機中）
function playerStatus(ws) {
    if (ws.roomId && rooms.has(ws.roomId)) return 'playing';
    if (BoardGamesServer.isInBgRoom(ws)) return 'playing';
    if (BoardGamesServer.isInBgQueue(ws)) return 'waiting';
    if (matchmakingQueues.rated.includes(ws) || matchmakingQueues.unrated.includes(ws)) return 'waiting';
    return 'idle';
}

function playerElo(ws) {
    const d = ws.userToken ? userDataStore.get(ws.userToken) : null;
    return d && typeof d.elo === 'number' ? d.elo : 1200;
}

// オンライン一覧・対戦待ち人数を全員に送る。
// 短い間に何度も呼ばれても、まとめて1回だけ送る（0.2秒）
let onlineBroadcastTimer = null;
function broadcastOnlinePlayers() {
    if (onlineBroadcastTimer) return;
    onlineBroadcastTimer = setTimeout(() => {
        onlineBroadcastTimer = null;
        const playersList = Array.from(connectedPlayers.entries()).map(([ws, p]) => ({
            id: p.id,
            name: p.name || 'ゲスト',
            elo: playerElo(ws),
            status: playerStatus(ws)
        }));
        const isOpen = p => p.readyState === WebSocket.OPEN;
        const updateMsg = JSON.stringify({
            type: 'online_players_update',
            hostName: hostPlayerName,
            players: playersList,
            waiting: {
                rated: matchmakingQueues.rated.filter(isOpen).length,
                unrated: matchmakingQueues.unrated.filter(isOpen).length
            }
        });
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) client.send(updateMsg);
        });
    }, 200);
}

// ===============================================================
// 💬 全体チャット（ホーム画面）。履歴は chat_history.json に保存
// ※ Render無料プランではサーバーが休止・再起動するとファイルが消えます
// ===============================================================
const CHAT_FILE = path.join(__dirname, 'chat_history.json');
const CHAT_MAX_SAVED = 500;      // 保存する件数（古いものから消える）
const CHAT_SEND_ON_JOIN = 100;   // 接続したときに送る件数
const CHAT_MAX_LENGTH = 50;      // 1回の文字数
const CHAT_INTERVAL_MS = 2000;   // 同じ人が続けて送れる間隔
let lobbyChat = [];

try {
    if (fs.existsSync(CHAT_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(CHAT_FILE, 'utf8'));
        if (Array.isArray(parsed)) lobbyChat = parsed.slice(-CHAT_MAX_SAVED);
        console.log(`[全体チャット] ${lobbyChat.length} 件の履歴を読み込みました`);
    }
} catch (err) {
    console.error('[全体チャット] 履歴の読み込みに失敗しました:', err.message);
}

let chatSaveTimer = null;
function saveLobbyChat() {
    if (chatSaveTimer) return;
    chatSaveTimer = setTimeout(() => {
        chatSaveTimer = null;
        fs.writeFile(CHAT_FILE, JSON.stringify(lobbyChat), 'utf8', (err) => {
            if (err) console.error('[全体チャット] 保存エラー:', err.message);
        });
    }, 1000);
}

function handleLobbyChat(ws, data) {
    const now = Date.now();
    if (typeof data.text !== 'string') return;
    // 改行などの見えない文字は消す
    const text = data.text.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, CHAT_MAX_LENGTH);
    if (!text) return;
    if (ws.lastLobbyChat && now - ws.lastLobbyChat < CHAT_INTERVAL_MS) {
        ws.send(JSON.stringify({ type: 'lobby_chat_error', reason: '連続で送信できません。少し待ってください。' }));
        return;
    }
    ws.lastLobbyChat = now;
    const msg = { id: now.toString(36) + Math.random().toString(36).slice(2, 6), name: ws.playerName, elo: playerElo(ws), text, time: now };
    lobbyChat.push(msg);
    if (lobbyChat.length > CHAT_MAX_SAVED) lobbyChat = lobbyChat.slice(-CHAT_MAX_SAVED);
    saveLobbyChat();
    const out = JSON.stringify({ type: 'lobby_chat', message: msg });
    wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) client.send(out);
    });
}

wss.on('connection', (ws) => {
    const playerId = 'player_' + Math.random().toString(36).substr(2, 9);
    ws.playerId = playerId;
    ws.playerName = '匿名プレイヤー';
    connectedPlayers.set(ws, { id: playerId, name: ws.playerName });

    // 自分のID（一覧で「あなた」を見分ける用）と、全体チャットの履歴を送る
    ws.send(JSON.stringify({ type: 'welcome', playerId }));
    ws.send(JSON.stringify({ type: 'lobby_chat_history', messages: lobbyChat.slice(-CHAT_SEND_ON_JOIN) }));

    broadcastOnlinePlayers();

    ws.on('message', (message) => {
        try {
            // 文字列として扱う（中継時もバイナリではなく文字で送り、受信側の変換の手間を省く）
            const text = message.toString();
            const data = JSON.parse(text);

            // ♟ ☗ 将棋・チェス
            if (typeof data.type === 'string' && data.type.startsWith('bg_')) {
                BoardGamesServer.handle(ws, data);
                broadcastOnlinePlayers();
                return;
            }

            switch (data.type) {
                case 'register_player':
                    if (data.name && data.name.trim() !== '') {
                        ws.playerName = data.name.trim().slice(0, 20);
                    }
                    // レート表示用。トークンは他の人には送らない
                    if (typeof data.token === 'string' && /^[\w-]{1,64}$/.test(data.token)) {
                        ws.userToken = data.token;
                    }
                    connectedPlayers.set(ws, { id: ws.playerId, name: ws.playerName });
                    broadcastOnlinePlayers();
                    break;

                case 'lobby_chat':
                    handleLobbyChat(ws, data);
                    break;

                case 'find_match': {
                    // 前の試合の部屋が残っていれば片付け、二重登録も防ぐ
                    leaveCurrentRoom(ws);
                    removeFromQueues(ws);
                    BoardGamesServer.removeFromBgQueues(ws);

                    ws.isRated = true; // オンライン対戦はすべてレート戦（ノーマル戦は廃止）
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
                    broadcastOnlinePlayers(); // 対戦待ち人数・状態が変わった
                    break;
                }

                case 'cancel_match':
                    removeFromQueues(ws);
                    ws.send(JSON.stringify({ type: 'matching_cancelled' }));
                    broadcastOnlinePlayers();
                    break;

                case 'leave_room':
                    // 試合終了時にクライアントから送られる。部屋を解散する
                    leaveCurrentRoom(ws);
                    broadcastOnlinePlayers();
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
        BoardGamesServer.onClose(ws);
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
