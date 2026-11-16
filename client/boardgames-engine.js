// =====================================================================
// ♟ ☗ 将棋・チェスのルール（2人・3人・4人）
//   ブラウザ（window.BoardEngine）とサーバー（require）の両方で使う
//   - 2人: 正式ルール（将棋: 王手・詰み・二歩・打ち歩詰め・行き所のない駒・千日手 / チェス: チェック・
//          チェックメイト・ステイルメイト・キャスリング・アンパッサン・プロモーション・50手・3回同じ局面・駒不足）
//   - 3人・4人: 十字形の盤。王を取られた人は脱落し、最後に残った人の勝ち（王手の決まりはない）
//   座席は時計回り: 0=下, 1=左, 2=上, 3=右（2人は下と上、3人は下・左・上）
// =====================================================================
(function (root) {
    'use strict';

    // ---- 向き: 盤を時計回りに k 回まわす ----
    const rotV = (v, k) => { let [x, y] = v; for (let i = 0; i < k; i++) [x, y] = [-y, x]; return [x, y]; };
    const rotP = (x, y, k, N) => { for (let i = 0; i < k; i++) [x, y] = [N - 1 - y, x]; return [x, y]; };

    const QUIET_LIMIT_PER_PLAYER = 50; // 3・4人: 1人あたりこの手数のあいだ駒を取らなければ引き分け
    const CHESS_VALUE = { P: 1, N: 3, B: 3.2, R: 5, Q: 9, K: 200 };
    const SHOGI_VALUE = { P: 1, L: 3, N: 4, S: 5, G: 6, B: 8, R: 10, K: 200 };
    const SHOGI_PROMOTED_VALUE = { P: 6, L: 6, N: 6, S: 6, B: 11, R: 13 };
    const SHOGI_PROMOTABLE = { P: 1, L: 1, N: 1, S: 1, B: 1, R: 1 };
    const KING_DIRS = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
    const ORTHO = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const DIAG = [[1, -1], [1, 1], [-1, 1], [-1, -1]];
    const GOLD = [[0, -1], [-1, -1], [1, -1], [-1, 0], [1, 0], [0, 1]];
    const SILVER = [[0, -1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
    const KNIGHT_C = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
    const KNIGHT_S = [[-1, -2], [1, -2]];

    // ---- 盤の形 ----
    function layout(game, n) {
        if (n === 2) return game === 'chess' ? { N: 8, arm: 0 } : { N: 9, arm: 0 };
        return game === 'chess' ? { N: 14, arm: 3 } : { N: 15, arm: 3 };
    }
    const SEAT_ROT = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };

    function create(game, n) {
        const { N, arm } = layout(game, n);
        const valid = new Array(N * N).fill(true);
        if (arm) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
            const cx = x < arm || x >= N - arm, cy = y < arm || y >= N - arm;
            if (cx && cy) valid[y * N + x] = false;
        }
        const s = {
            game, n, N, arm, valid,
            board: new Array(N * N).fill(null),
            hands: Array.from({ length: n }, () => ({})),
            rot: SEAT_ROT[n].slice(),
            alive: new Array(n).fill(true),
            turn: 0, ply: 0, half: 0, ep: null,
            winner: null, reason: '', last: null, reps: {}, log: []
        };
        const put = (lx, ly, t, seat) => {
            const [x, y] = rotP(lx, ly, s.rot[seat], N);
            s.board[y * N + x] = { t, o: seat, pr: false, mv: false };
        };
        for (let seat = 0; seat < n; seat++) {
            const off = arm; // 腕の中の左端
            const back = N - 1; // 下の席から見た、いちばん手前の行
            if (game === 'chess') {
                // 向かい合う王が向かい合うように、上と右の席は王と女王を入れ替える
                const k = s.rot[seat];
                const row = (k === 2 || k === 3) ? 'RNBKQBNR' : 'RNBQKBNR';
                for (let i = 0; i < 8; i++) { put(off + i, back, row[i], seat); put(off + i, back - 1, 'P', seat); }
            } else {
                const row = 'LNSGKGSNL';
                for (let i = 0; i < 9; i++) { put(off + i, back, row[i], seat); put(off + i, back - 2, 'P', seat); }
                put(off + 1, back - 1, 'B', seat);
                put(off + 7, back - 1, 'R', seat);
            }
        }
        s.reps[posKey(s)] = 1;
        return s;
    }

    // ---- 便利関数 ----
    const inB = (s, x, y) => x >= 0 && y >= 0 && x < s.N && y < s.N && s.valid[y * s.N + x];
    const at = (s, x, y) => s.board[y * s.N + x];
    const fwdOf = (s, seat) => rotV([0, -1], s.rot[seat]);
    // 自分の陣（手前）から数えた段（0 = いちばん手前）
    function rankFromBack(s, seat, x, y) {
        const k = s.rot[seat], N = s.N;
        return k === 0 ? N - 1 - y : k === 1 ? x : k === 2 ? y : N - 1 - x;
    }
    // 将棋の成れる場所: 2人は奥の3段、3・4人は自分以外の腕（空いた腕もふくむ）
    function inZone(s, seat, x, y) {
        if (s.n === 2) return rankFromBack(s, seat, x, y) >= s.N - 3;
        const own = s.rot[seat];
        for (let k = 0; k < 4; k++) {
            if (k === own) continue;
            const r = k === 0 ? s.N - 1 - y : k === 1 ? x : k === 2 ? y : s.N - 1 - x;
            if (r <= s.arm - 1) return true;
        }
        return false;
    }
    // その場所から、もう動けない駒（歩・香・桂）か
    function deadEnd(s, seat, t, x, y) {
        const k = s.rot[seat];
        if (t === 'P' || t === 'L') { const [dx, dy] = rotV([0, -1], k); return !inB(s, x + dx, y + dy); }
        if (t === 'N') return KNIGHT_S.every(v => { const [dx, dy] = rotV(v, k); return !inB(s, x + dx, y + dy); });
        return false;
    }

    // ---- 駒の利き（その駒が動ける先。味方のいるマスはのぞく） ----
    function pieceTargets(s, x, y, p, out) {
        const k = s.rot[p.o];
        const step = (v) => { const [dx, dy] = rotV(v, k); const tx = x + dx, ty = y + dy; if (!inB(s, tx, ty)) return; const q = at(s, tx, ty); if (!q || q.o !== p.o) out.push([tx, ty]); };
        const slide = (v) => {
            const [dx, dy] = rotV(v, k);
            let tx = x + dx, ty = y + dy;
            while (inB(s, tx, ty)) {
                const q = at(s, tx, ty);
                if (q) { if (q.o !== p.o) out.push([tx, ty]); break; }
                out.push([tx, ty]);
                tx += dx; ty += dy;
            }
        };
        if (s.game === 'chess') {
            switch (p.t) {
                case 'K': KING_DIRS.forEach(step); break;
                case 'Q': KING_DIRS.forEach(slide); break;
                case 'R': ORTHO.forEach(slide); break;
                case 'B': DIAG.forEach(slide); break;
                case 'N': KNIGHT_C.forEach(step); break;
                case 'P': { // 取る方向だけ（前進は別に作る）
                    [[-1, -1], [1, -1]].forEach(v => { const [dx, dy] = rotV(v, k); const tx = x + dx, ty = y + dy; if (inB(s, tx, ty)) { const q = at(s, tx, ty); if (q && q.o !== p.o) out.push([tx, ty]); } });
                    break;
                }
            }
        } else {
            if (p.pr) {
                if (p.t === 'R') { ORTHO.forEach(slide); DIAG.forEach(step); }
                else if (p.t === 'B') { DIAG.forEach(slide); ORTHO.forEach(step); }
                else GOLD.forEach(step);
                return out;
            }
            switch (p.t) {
                case 'K': KING_DIRS.forEach(step); break;
                case 'G': GOLD.forEach(step); break;
                case 'S': SILVER.forEach(step); break;
                case 'N': KNIGHT_S.forEach(step); break;
                case 'L': slide([0, -1]); break;
                case 'P': step([0, -1]); break;
                case 'R': ORTHO.forEach(slide); break;
                case 'B': DIAG.forEach(slide); break;
            }
        }
        return out;
    }

    // マス (x, y) を seat 以外のだれかが攻めているか（attacker を返す。いなければ -1）
    function attackedBy(s, x, y, seat) {
        const N = s.N;
        for (let i = 0; i < s.board.length; i++) {
            const p = s.board[i];
            if (!p || p.o === seat || !s.alive[p.o]) continue;
            const px = i % N, py = (i - px) / N;
            // ざっくり絞り込み: 飛び道具でなければ近くの駒だけ
            if ((Math.abs(px - x) > 2 || Math.abs(py - y) > 2) && !'QRBL'.includes(p.t)) continue;
            if (s.game === 'chess' && p.t === 'P') {
                // チェスの歩は、空いているマスも斜め前を攻めている（キャスリングで通るマスの判定に必要）
                const k = s.rot[p.o];
                for (const v of [[-1, -1], [1, -1]]) { const [dx, dy] = rotV(v, k); if (px + dx === x && py + dy === y) return p.o; }
                continue;
            }
            const t = pieceTargets(s, px, py, p, []);
            for (const [tx, ty] of t) if (tx === x && ty === y) return p.o;
        }
        return -1;
    }
    function kingPos(s, seat) {
        for (let i = 0; i < s.board.length; i++) { const p = s.board[i]; if (p && p.o === seat && p.t === 'K') return [i % s.N, Math.floor(i / s.N)]; }
        return null;
    }
    function inCheck(s, seat) {
        const k = kingPos(s, seat);
        return !!k && attackedBy(s, k[0], k[1], seat) >= 0;
    }

    // ---- 手を作る（王手の決まりを考えない手） ----
    function pseudoMoves(s, seat) {
        const N = s.N, moves = [];
        for (let i = 0; i < s.board.length; i++) {
            const p = s.board[i];
            if (!p || p.o !== seat) continue;
            const x = i % N, y = (i - x) / N;
            if (s.game === 'chess') chessPieceMoves(s, x, y, p, moves);
            else shogiPieceMoves(s, x, y, p, moves);
        }
        if (s.game === 'shogi') shogiDrops(s, seat, moves);
        return moves;
    }

    function chessPieceMoves(s, x, y, p, moves) {
        const k = s.rot[p.o];
        const promoRank = 7;
        const add = (tx, ty) => {
            if (p.t === 'P' && rankFromBack(s, p.o, tx, ty) >= promoRank) {
                for (const q of ['Q', 'R', 'B', 'N']) moves.push({ f: [x, y], t: [tx, ty], pr: q });
            } else moves.push({ f: [x, y], t: [tx, ty] });
        };
        if (p.t === 'P') {
            const [fx, fy] = rotV([0, -1], k);
            const x1 = x + fx, y1 = y + fy;
            if (inB(s, x1, y1) && !at(s, x1, y1)) {
                add(x1, y1);
                const x2 = x1 + fx, y2 = y1 + fy;
                if (!p.mv && rankFromBack(s, p.o, x, y) === 1 && inB(s, x2, y2) && !at(s, x2, y2)) moves.push({ f: [x, y], t: [x2, y2] });
            }
            for (const [tx, ty] of pieceTargets(s, x, y, p, [])) add(tx, ty);
            // アンパッサン（2人だけ）
            if (s.ep && s.n === 2) {
                [[-1, -1], [1, -1]].forEach(v => { const [dx, dy] = rotV(v, k); if (x + dx === s.ep[0] && y + dy === s.ep[1]) moves.push({ f: [x, y], t: [s.ep[0], s.ep[1]], ep: 1 }); });
            }
            return;
        }
        for (const [tx, ty] of pieceTargets(s, x, y, p, [])) moves.push({ f: [x, y], t: [tx, ty] });
        // キャスリング（2人だけ）
        if (p.t === 'K' && !p.mv && s.n === 2) {
            for (const dir of [-1, 1]) {
                let rx = x + dir;
                while (inB(s, rx, y) && !at(s, rx, y)) rx += dir;
                if (!inB(s, rx, y)) continue;
                const r = at(s, rx, y);
                if (!r || r.o !== p.o || r.t !== 'R' || r.mv) continue;
                moves.push({ f: [x, y], t: [x + 2 * dir, y], castle: dir });
            }
        }
    }

    function shogiPieceMoves(s, x, y, p, moves) {
        for (const [tx, ty] of pieceTargets(s, x, y, p, [])) {
            const canPr = !p.pr && SHOGI_PROMOTABLE[p.t] && (inZone(s, p.o, x, y) || inZone(s, p.o, tx, ty));
            const mustPr = !p.pr && deadEnd(s, p.o, p.t, tx, ty);
            if (mustPr && !canPr) continue; // 行き所のない駒になる手は指せない
            if (canPr) moves.push({ f: [x, y], t: [tx, ty], pr: true });
            if (!mustPr) moves.push({ f: [x, y], t: [tx, ty], pr: false });
        }
    }

    function shogiDrops(s, seat, moves) {
        const hand = s.hands[seat];
        const types = Object.keys(hand).filter(t => hand[t] > 0);
        if (!types.length) return;
        const N = s.N, k = s.rot[seat];
        // 二歩: 自分の成っていない歩がある筋（自分から見た縦の列）
        const pawnFiles = new Set();
        if (hand.P) for (let i = 0; i < s.board.length; i++) {
            const p = s.board[i];
            if (p && p.o === seat && p.t === 'P' && !p.pr) { const x = i % N, y = (i - x) / N; pawnFiles.add(k % 2 === 0 ? x : y); }
        }
        for (let i = 0; i < s.board.length; i++) {
            if (!s.valid[i] || s.board[i]) continue;
            const x = i % N, y = (i - x) / N;
            for (const t of types) {
                if (deadEnd(s, seat, t, x, y)) continue;
                if (t === 'P' && pawnFiles.has(k % 2 === 0 ? x : y)) continue;
                moves.push({ d: t, t: [x, y] });
            }
        }
    }

    // ---- 手を指した後の局面（元の局面は変えない） ----
    function doMove(s0, m) {
        const s = Object.assign({}, s0);
        s.board = s0.board.slice();
        s.hands = s0.hands.map(h => Object.assign({}, h));
        s.alive = s0.alive.slice();
        const N = s.N, seat = s0.turn;
        let captured = null;
        s.ep = null;
        s.half = s0.half + 1;
        s.quiet = (s0.quiet || 0) + 1; // 駒を取らずに続いた手の数（3・4人の引き分け用）
        if (m.d) {
            s.board[m.t[1] * N + m.t[0]] = { t: m.d, o: seat, pr: false, mv: true };
            s.hands[seat][m.d]--;
        } else {
            const [fx, fy] = m.f, [tx, ty] = m.t;
            const p = s.board[fy * N + fx];
            captured = s.board[ty * N + tx];
            s.board[fy * N + fx] = null;
            let np = { t: p.t, o: p.o, pr: p.pr, mv: true };
            if (s.game === 'chess') {
                if (p.t === 'P' || captured) s.half = 0;
                if (m.ep) { // アンパッサン: 横の歩を取る
                    const [bx, by] = rotV([0, 1], s.rot[seat]);
                    captured = s.board[(ty + by) * N + tx + bx];
                    s.board[(ty + by) * N + tx + bx] = null;
                }
                if (p.t === 'P' && Math.abs(tx - fx) + Math.abs(ty - fy) === 2 && (tx === fx || ty === fy)) s.ep = [(fx + tx) / 2, (fy + ty) / 2];
                if (m.pr) np.t = m.pr;
                if (m.castle) { // ルークも動かす
                    let rx = fx + m.castle;
                    while (!s.board[fy * N + rx]) rx += m.castle;
                    const r = s.board[fy * N + rx];
                    s.board[fy * N + rx] = null;
                    s.board[fy * N + tx - m.castle] = { t: 'R', o: r.o, pr: false, mv: true };
                }
            } else if (m.pr) np.pr = true;
            s.board[ty * N + tx] = np;
            if (captured && s.game === 'shogi' && captured.t !== 'K') s.hands[seat][captured.t] = (s.hands[seat][captured.t] || 0) + 1;
        }
        if (captured) s.quiet = 0;
        s.last = m;
        s.ply = s0.ply + 1;
        // 王を取った → その人は脱落（3・4人）
        if (captured && captured.t === 'K') eliminate(s, captured.o, '王を取られた');
        s.turn = nextTurn(s, seat);
        return s;
    }

    function eliminate(s, seat, why) {
        if (!s.alive[seat]) return;
        s.alive[seat] = false;
        // 脱落した人の駒は盤から消える
        for (let i = 0; i < s.board.length; i++) if (s.board[i] && s.board[i].o === seat) s.board[i] = null;
        s.hands[seat] = {};
        s.log = (s.log || []).concat([{ seat, why }]);
        const left = s.alive.map((a, i) => a ? i : -1).filter(i => i >= 0);
        if (left.length === 1) { s.winner = left[0]; s.reason = why; }
    }
    function nextTurn(s, seat) {
        for (let i = 1; i <= s.n; i++) { const t = (seat + i) % s.n; if (s.alive[t]) return t; }
        return seat;
    }

    // ---- 指せる手（2人は王手を放っておく手をのぞく） ----
    function legalMoves(s, seat) {
        if (seat === undefined) seat = s.turn;
        if (s.winner !== null || !s.alive[seat]) return [];
        const ms = pseudoMoves(s, seat);
        if (s.n !== 2) return ms;
        const out = [];
        for (const m of ms) {
            if (m.castle) { // 王手のとき・通るマスが攻められているときはできない
                if (inCheck(s, seat)) continue;
                const midX = m.f[0] + m.castle;
                if (attackedBy(s, midX, m.f[1], seat) >= 0) continue;
            }
            const t = doMoveRaw(s, m, seat);
            if (inCheck(t, seat)) continue;
            // 打ち歩詰め（将棋）
            if (s.game === 'shogi' && m.d === 'P') {
                const foe = 1 - seat;
                const kp = kingPos(t, foe);
                const [fx, fy] = fwdOf(s, seat);
                if (kp && kp[0] === m.t[0] + fx && kp[1] === m.t[1] + fy) {
                    const t2 = Object.assign({}, t, { turn: foe });
                    if (!hasLegal(t2, foe)) continue;
                }
            }
            out.push(m);
        }
        return out;
    }
    // 手番を進めずに指す（王手の確認用）
    function doMoveRaw(s, m, seat) { return doMove(Object.assign({}, s, { turn: seat }), m); }
    function hasLegal(s, seat) {
        const ms = pseudoMoves(s, seat);
        for (const m of ms) {
            if (m.castle) continue;
            if (!inCheck(doMoveRaw(s, m, seat), seat)) return true;
        }
        return false;
    }

    // ---- 局面のキー（千日手・3回同じ局面） ----
    function posKey(s) {
        let k = s.turn + '|';
        for (let i = 0; i < s.board.length; i++) { const p = s.board[i]; k += p ? (p.o + p.t + (p.pr ? '+' : '')) : '.'; }
        if (s.game === 'shogi') k += '|' + s.hands.map(h => Object.keys(h).sort().map(t => h[t] ? t + h[t] : '').join('')).join('/');
        if (s.game === 'chess' && s.ep) k += '|e' + s.ep.join(',');
        return k;
    }

    // ---- 手を指して、勝ち負けまで決める（ゲームで使うのはこれ） ----
    function play(s0, m) {
        const s = doMove(s0, m);
        if (s.winner !== null) return s;
        s.reps = Object.assign({}, s0.reps);
        const key = posKey(s);
        s.reps[key] = (s.reps[key] || 0) + 1;
        if (s.n === 2) {
            const me = s.turn;
            const any = hasLegal(s, me);
            if (!any) {
                if (s.game === 'chess' && !inCheck(s, me)) { s.winner = -1; s.reason = 'ステイルメイト（引き分け）'; }
                else { s.winner = 1 - me; s.reason = s.game === 'chess' ? 'チェックメイト' : '詰み'; }
                return s;
            }
            if (s.game === 'chess') {
                if (s.half >= 100) { s.winner = -1; s.reason = '50手ルール（引き分け）'; }
                else if (s.reps[key] >= 3) { s.winner = -1; s.reason = '同じ局面が3回（引き分け）'; }
                else if (insufficient(s)) { s.winner = -1; s.reason = '駒が足りない（引き分け）'; }
            } else if (s.reps[key] >= 4) { s.winner = -1; s.reason = '千日手（引き分け）'; }
        } else {
            // 3・4人: 指せる手がない人は、その番を飛ばす
            let guard = 0;
            while (pseudoMoves(s, s.turn).length === 0 && guard++ < s.n) s.turn = nextTurn(s, s.turn);
            // 同じ局面が何度もくり返したら・長いあいだだれも駒を取らなければ引き分け
            const alive = s.alive.filter(Boolean).length;
            if (s.reps[key] >= 5) { s.winner = -1; s.reason = '同じ局面のくり返し（引き分け）'; }
            else if (s.quiet >= QUIET_LIMIT_PER_PLAYER * alive) { s.winner = -1; s.reason = `${QUIET_LIMIT_PER_PLAYER}手のあいだだれも駒を取らなかった（引き分け）`; }
        }
        return s;
    }
    function insufficient(s) {
        const ps = s.board.filter(Boolean).filter(p => p.t !== 'K');
        if (ps.length === 0) return true;
        return ps.length === 1 && (ps[0].t === 'B' || ps[0].t === 'N');
    }
    function resign(s0, seat, why) {
        const s = Object.assign({}, s0, { board: s0.board.slice(), hands: s0.hands.map(h => Object.assign({}, h)), alive: s0.alive.slice() });
        if (s.n === 2) { s.alive[seat] = false; s.winner = 1 - seat; s.reason = why || '投了'; return s; }
        eliminate(s, seat, why || '投了');
        if (s.winner === null && s.turn === seat) s.turn = nextTurn(s, seat);
        return s;
    }
    const sameMove = (a, b) => !!a && !!b && (a.d || '') === (b.d || '') && String(a.f) === String(b.f) && String(a.t) === String(b.t) && String(a.pr === undefined ? '' : a.pr) === String(b.pr === undefined ? '' : b.pr);
    function findLegal(s, m) { return legalMoves(s).find(x => sameMove(x, m)) || null; }

    // ---- 評価（CPU） ----
    function pieceValue(s, p) {
        if (s.game === 'chess') return CHESS_VALUE[p.t];
        return p.pr ? SHOGI_PROMOTED_VALUE[p.t] : SHOGI_VALUE[p.t];
    }
    function material(s, seat) {
        let v = 0;
        const N = s.N, c = (N - 1) / 2;
        for (let i = 0; i < s.board.length; i++) {
            const p = s.board[i];
            if (!p || p.o !== seat) continue;
            v += pieceValue(s, p);
            if (p.t !== 'K') { const x = i % N, y = (i - x) / N; v += 0.04 * (c - Math.max(Math.abs(x - c), Math.abs(y - c))) / c; } // 真ん中ほど少し良い
        }
        if (s.game === 'shogi') { const h = s.hands[seat]; for (const t in h) v += (SHOGI_VALUE[t] || 0) * 1.1 * h[t]; }
        return v;
    }
    function evalFor(s, seat) {
        if (s.winner !== null) return s.winner === seat ? 10000 : s.winner === -1 ? 0 : -10000;
        if (!s.alive[seat]) return -10000;
        const mine = material(s, seat);
        let others = 0, cnt = 0;
        for (let i = 0; i < s.n; i++) if (i !== seat && s.alive[i]) { others += material(s, i); cnt++; }
        return mine - (cnt ? others / cnt : 0);
    }
    // 2人: アルファベータ探索
    function negamax(s, depth, alpha, beta, seat, budget) {
        if (s.winner !== null || depth === 0 || budget.n <= 0) return evalFor(s, seat);
        budget.n--;
        let ms = legalMoves(s);
        if (!ms.length) return evalFor(s, seat);
        ms = orderMoves(s, ms);
        let best = -Infinity;
        for (const m of ms) {
            const t = play(s, m);
            const v = -negamax(t, depth - 1, -beta, -alpha, 1 - seat, budget);
            if (v > best) best = v;
            if (v > alpha) alpha = v;
            if (alpha >= beta) break;
        }
        return best;
    }
    function orderMoves(s, ms) {
        const N = s.N;
        const score = m => { if (m.d) return 0; const q = s.board[m.t[1] * N + m.t[0]]; return (q ? 10 * pieceValue(s, q) : 0) + (m.pr ? 5 : 0); };
        return ms.map(m => [score(m), m]).sort((a, b) => b[0] - a[0]).map(x => x[1]);
    }
    // 3・4人: 1手先＋「次にだれかに取られる駒」を見る
    function danger(s, seat) {
        let worst = 0;
        const N = s.N;
        for (let i = 0; i < s.board.length; i++) {
            const p = s.board[i];
            if (!p || p.o !== seat) continue;
            const x = i % N, y = (i - x) / N;
            if (attackedBy(s, x, y, seat) >= 0) worst = Math.max(worst, pieceValue(s, p));
        }
        return worst;
    }
    // 3・4人: 動かした駒がほかの人の王に近いほど・王手をかけているほど良い（攻めないと決着しないため）
    function kingPressure(s, seat, to) {
        let best = 0;
        for (let i = 0; i < s.n; i++) {
            if (i === seat || !s.alive[i]) continue;
            const k = kingPos(s, i);
            if (!k) continue;
            const d = Math.max(Math.abs(k[0] - to[0]), Math.abs(k[1] - to[1]));
            let v = Math.max(0, 8 - d);
            if (attackedBy(s, k[0], k[1], i) === seat) v += 6;
            best = Math.max(best, v);
        }
        return best;
    }
    // level: 1=よわい 2=ふつう 3=つよい
    function aiMove(s, level, rnd) {
        rnd = rnd || Math.random;
        const seat = s.turn;
        const ms = legalMoves(s);
        if (!ms.length) return null;
        if (s.n === 2) {
            const depth = s.game === 'chess' ? [1, 2, 3][level - 1] : [1, 2, 2][level - 1];
            const budget = { n: s.game === 'chess' ? 20000 : 4000 };
            const noise = level === 1 ? 2.5 : level === 2 ? 0.3 : 0.05;
            let best = null, bestV = -Infinity;
            const ordered = orderMoves(s, ms);
            for (const m of ordered) {
                const t = play(s, m);
                const jitter = (rnd() - 0.5) * noise;
                const v = -negamax(t, depth - 1, -Infinity, -(bestV - jitter), 1 - seat, budget) + jitter;
                if (v > bestV) { bestV = v; best = m; }
            }
            return best;
        }
        let best = null, bestV = -Infinity;
        for (const m of ms) {
            const t = play(s, m);
            let v = evalFor(t, seat);
            if (t.winner === seat) v = 1e6;
            v += 0.12 * kingPressure(t, seat, m.t);
            if (level >= 2) v -= danger(t, seat) * (level === 3 ? 0.9 : 0.6);
            v += (rnd() - 0.5) * (level === 1 ? 3 : level === 2 ? 0.4 : 0.1);
            if (v > bestV) { bestV = v; best = m; }
        }
        return best;
    }

    // ---- 表示用の名前 ----
    const CHESS_GLYPH = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟' };
    const SHOGI_NAME = { K: '玉', R: '飛', B: '角', G: '金', S: '銀', N: '桂', L: '香', P: '歩' };
    const SHOGI_PROMOTED_NAME = { R: '竜', B: '馬', S: '全', N: '圭', L: '杏', P: 'と' };
    function label(s, p) {
        if (s.game === 'chess') return CHESS_GLYPH[p.t];
        if (p.pr) return SHOGI_PROMOTED_NAME[p.t];
        if (p.t === 'K' && s.n === 2 && p.o === 1) return '王';
        return SHOGI_NAME[p.t];
    }

    const api = {
        create, legalMoves, play, resign, findLegal, sameMove, inCheck, kingPos, aiMove, posKey, label,
        inZone, rankFromBack, rotV, SHOGI_NAME, SHOGI_PROMOTED_NAME, CHESS_GLYPH, pseudoMoves, evalFor
    };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.BoardEngine = api;
})(typeof window !== 'undefined' ? window : this);
