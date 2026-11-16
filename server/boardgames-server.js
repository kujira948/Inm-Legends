// =====================================================================
// ♟ ☗ 将棋・チェスのオンライン対戦（2人・3人・4人）
//   同じゲーム・同じ人数を選んだ人がそろったら部屋を作る。
//   手はサーバーがルール（client/boardgames-engine.js）で確かめてから、部屋の全員に配る。
// =====================================================================
const WebSocket = require('ws');
const E = require('../client/boardgames-engine.js');

const GAMES = ['chess', 'shogi'];
const queues = new Map();   // 'chess:4' -> [ws, ...]
const rooms = new Map();    // roomId -> { game, n, players: [ws], names, state }

const send = (ws, o) => { if (ws && ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify(o)); } catch (e) {} } };

function removeFromBgQueues(ws) {
    for (const [key, q] of queues) {
        const i = q.indexOf(ws);
        if (i >= 0) { q.splice(i, 1); notifyQueue(key); }
    }
}
function notifyQueue(key) {
    const q = queues.get(key) || [];
    const need = +key.split(':')[1];
    q.forEach(ws => send(ws, { type: 'bg_queue', count: q.length, need }));
}
function isInBgQueue(ws) { for (const q of queues.values()) if (q.includes(ws)) return true; return false; }
function isInBgRoom(ws) { return !!(ws.bgRoom && rooms.has(ws.bgRoom)); }

function find(ws, data) {
    const game = GAMES.includes(data.game) ? data.game : null;
    const n = [2, 3, 4].includes(+data.players) ? +data.players : null;
    if (!game || !n) return send(ws, { type: 'bg_error', reason: 'ゲームか人数がおかしいです。' });
    leave(ws, '退出');
    removeFromBgQueues(ws);
    const key = game + ':' + n;
    if (!queues.has(key)) queues.set(key, []);
    const q = queues.get(key).filter(p => p.readyState === WebSocket.OPEN && p !== ws);
    q.push(ws);
    queues.set(key, q);
    if (q.length >= n) {
        const players = q.splice(0, n);
        const roomId = 'bg' + Math.random().toString(36).slice(2, 9);
        const room = { game, n, players, names: players.map(p => p.playerName || 'プレイヤー'), state: E.create(game, n) };
        rooms.set(roomId, room);
        players.forEach((p, seat) => {
            p.bgRoom = roomId; p.bgSeat = seat;
            send(p, { type: 'bg_start', roomId, game, n, seat, names: room.names });
        });
    }
    notifyQueue(key);
}

function move(ws, data) {
    const room = rooms.get(ws.bgRoom);
    if (!room) return send(ws, { type: 'bg_error', reason: '対局が見つかりません。' });
    const s = room.state;
    if (s.winner !== null) return send(ws, { type: 'bg_error', reason: '対局は終わっています。' });
    if (s.turn !== ws.bgSeat) return send(ws, { type: 'bg_error', reason: 'あなたの番ではありません。' });
    const m = data && data.move;
    const legal = m && typeof m === 'object' ? E.findLegal(s, m) : null;
    if (!legal) return send(ws, { type: 'bg_error', reason: 'その手は指せません。' });
    room.state = E.play(s, legal);
    room.players.forEach(p => send(p, { type: 'bg_move', seat: ws.bgSeat, move: legal }));
    cleanupIfOver(ws.bgRoom);
}

// 投了・退出・切断: 2人なら相手の勝ち、3・4人ならその人だけ脱落
function resign(ws, reason) {
    const room = rooms.get(ws.bgRoom);
    if (!room) return;
    const seat = ws.bgSeat;
    if (room.state.winner === null && room.state.alive[seat]) {
        room.state = E.resign(room.state, seat, reason);
        room.players.forEach(p => send(p, { type: 'bg_resign', seat, reason }));
    }
    cleanupIfOver(ws.bgRoom);
}
function leave(ws, reason) {
    if (!ws.bgRoom) return;
    resign(ws, reason);
    const room = rooms.get(ws.bgRoom);
    if (room) {
        room.players = room.players.map(p => p === ws ? null : p);
        if (room.players.every(p => !p || p.bgRoom !== ws.bgRoom)) rooms.delete(ws.bgRoom);
    }
    ws.bgRoom = null; ws.bgSeat = null;
}
// 決着した部屋は、全員が抜けたら消す（決着後も盤を見られるように、すぐには消さない）
function cleanupIfOver(roomId) {
    const room = rooms.get(roomId);
    if (!room || room.state.winner === null) return;
    if (!room.players.some(p => p && p.readyState === WebSocket.OPEN && p.bgRoom === roomId)) rooms.delete(roomId);
}

// server.js の message から呼ぶ。ボードゲームのメッセージなら true
function handle(ws, data) {
    switch (data.type) {
        case 'bg_find': find(ws, data); return true;
        case 'bg_cancel': removeFromBgQueues(ws); return true;
        case 'bg_move': move(ws, data); return true;
        case 'bg_resign': resign(ws, '投了'); return true;
        case 'bg_leave': leave(ws, '退出'); return true;
    }
    return false;
}
function onClose(ws) {
    removeFromBgQueues(ws);
    leave(ws, '切断');
}

module.exports = { handle, onClose, isInBgQueue, isInBgRoom, removeFromBgQueues, _rooms: rooms, _queues: queues };
