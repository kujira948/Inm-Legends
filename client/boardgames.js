// =====================================================================
// ♟ ☗ 将棋・チェスの画面（2人・3人・4人）
//   対戦方法: オンライン（人数がそろうまで待つ）／CPUと対戦／同じ画面で交代
//   ルールは boardgames-engine.js（BoardEngine）
// =====================================================================
(function () {
    'use strict';
    const E = window.BoardEngine;
    const GAME_JP = { chess: 'チェス', shogi: '将棋' };
    const SEAT_JP = ['下', '左', '上', '右'];
    const CHESS2_COLORS = ['#f5f5f5', '#222'];
    const MULTI_COLORS = ['#e74c3c', '#3498db', '#f1c40f', '#2ecc71'];
    const MULTI_COLOR_JP = ['赤', '青', '黄', '緑'];
    const CPU_JP = ['', 'よわい', 'ふつう', 'つよい'];
    const SHOGI_HAND_ORDER = ['R', 'B', 'G', 'S', 'N', 'L', 'P'];

    const BG = {
        game: 'chess', n: 2,
        mode: null,          // 'online' | 'cpu' | 'local'
        state: null,
        seats: [],           // [{ kind: 'me'|'human'|'cpu'|'online', name, level }]
        mySeat: 0,           // オンライン・CPU戦での自分の席
        sel: null,           // 選んだ駒 { x, y } または { hand: 'P' }
        targets: [],         // 選んだ駒の指せる手
        cpuTimer: null,
        online: { matching: false, startedAt: 0, timer: null, room: null, need: 0, count: 0 },
        el: {},

        isOpen() { return !!(this.el.root && !this.el.root.hidden); },

        // ---------------- 画面づくり ----------------
        init() {
            const root = document.createElement('div');
            root.id = 'bg-root';
            root.hidden = true;
            root.innerHTML = `
                <div id="bg-setup" class="bg-panel">
                    <h2 id="bg-setup-title">チェス</h2>
                    <div class="bg-row"><span class="bg-label">人数</span>
                        <div class="bg-choice" id="bg-n">
                            <button data-n="2">2人</button><button data-n="3">3人</button><button data-n="4">4人</button>
                        </div></div>
                    <div class="bg-row"><span class="bg-label">持ち時間</span>
                        <div class="bg-choice" id="bg-tc-main">
                            <button data-v="0">なし</button><button data-v="60">1分</button><button data-v="180">3分</button><button data-v="300">5分</button><button data-v="600">10分</button><button data-v="1800">30分</button>
                        </div></div>
                    <div class="bg-row"><span class="bg-label">秒読み・加算</span>
                        <div class="bg-choice" id="bg-tc-extra">
                            <button data-m="none" data-v="0">なし</button>
                            <button data-m="byoyomi" data-v="10">秒読み10秒</button><button data-m="byoyomi" data-v="30">秒読み30秒</button><button data-m="byoyomi" data-v="60">秒読み60秒</button>
                            <button data-m="increment" data-v="2">加算+2秒</button><button data-m="increment" data-v="5">加算+5秒</button><button data-m="increment" data-v="10">加算+10秒</button>
                        </div></div>
                    <div class="bg-note" id="bg-tc-note"></div>
                    <div class="bg-rule" id="bg-rule"></div>
                    <div class="bg-modes">
                        <div class="bg-mode">
                            <button id="bg-btn-online" class="bg-big">🌐 オンラインで対戦</button>
                            <div class="bg-note">同じ人数・同じ時間の決まりを選んだ人がそろうと始まります。</div>
                            <div id="bg-online-status" class="bg-status"></div>
                        </div>
                        <div class="bg-mode">
                            <button id="bg-btn-cpu" class="bg-big">🤖 CPUと対戦</button>
                            <div class="bg-row"><span class="bg-label">CPUの強さ</span>
                                <div class="bg-choice" id="bg-cpu-level">
                                    <button data-lv="1">よわい</button><button data-lv="2">ふつう</button><button data-lv="3">つよい</button>
                                </div></div>
                        </div>
                        <div class="bg-mode">
                            <button id="bg-btn-local" class="bg-big">👥 同じ画面で交代</button>
                            <div class="bg-note">1台の画面を回して指します。席ごとにCPUにもできます。</div>
                            <div id="bg-local-seats"></div>
                        </div>
                    </div>
                    <button id="bg-btn-close" class="bg-back">← ホームにもどる</button>
                </div>
                <div id="bg-game" hidden>
                    <div id="bg-top">
                        <div id="bg-title"></div>
                        <div id="bg-turn"></div>
                        <div class="bg-top-btns">
                            <button id="bg-btn-resign">投了</button>
                            <button id="bg-btn-exit">ホームへ</button>
                        </div>
                    </div>
                    <div id="bg-players"></div>
                    <div id="bg-board-wrap"><div id="bg-board"></div></div>
                    <div id="bg-hands"></div>
                    <div id="bg-msg"></div>
                </div>
                <div id="bg-dialog" hidden><div class="bg-panel" id="bg-dialog-body"></div></div>`;
            document.body.appendChild(root);
            const $ = id => root.querySelector('#' + id);
            this.el = { root, setup: $('bg-setup'), game: $('bg-game'), board: $('bg-board'), wrap: $('bg-board-wrap'), turn: $('bg-turn'), title: $('bg-title'),
                players: $('bg-players'), hands: $('bg-hands'), msg: $('bg-msg'), dialog: $('bg-dialog'), dialogBody: $('bg-dialog-body'),
                onlineStatus: $('bg-online-status'), localSeats: $('bg-local-seats'), rule: $('bg-rule') };
            this.cpuLevel = 2;
            this.tc = { main: 0, mode: 'none', extra: 0 };
            $('bg-tc-main').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; this.tc = E.normalizeTc({ ...this.tc, main: +b.dataset.v }); this.renderSetup(); });
            $('bg-tc-extra').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.disabled) return; this.tc = E.normalizeTc({ ...this.tc, mode: b.dataset.m, extra: +b.dataset.v }); this.renderSetup(); });
            this.clockTimer = setInterval(() => this.tickClock(), 250);
            $('bg-n').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; this.n = +b.dataset.n; this.renderSetup(); });
            $('bg-cpu-level').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; this.cpuLevel = +b.dataset.lv; this.renderSetup(); });
            $('bg-btn-online').onclick = () => this.online.matching ? this.cancelOnline() : this.findOnline();
            $('bg-btn-cpu').onclick = () => this.startLocal('cpu');
            $('bg-btn-local').onclick = () => this.startLocal('local');
            $('bg-btn-close').onclick = () => this.close();
            $('bg-btn-resign').onclick = () => this.askResign();
            $('bg-btn-exit').onclick = () => this.askExit();
            this.el.board.addEventListener('click', e => { const c = e.target.closest('.bg-cell'); if (c) this.clickCell(+c.dataset.x, +c.dataset.y); });
            this.el.hands.addEventListener('click', e => { const h = e.target.closest('.bg-hand-piece'); if (h) this.clickHand(h.dataset.t, +h.dataset.seat); });
            window.addEventListener('resize', () => { if (this.isOpen() && this.state) this.render(); });
            this.localKinds = ['human', 'human', 'human', 'human'];
        },

        open(game) {
            if (!this.el.root) this.init();
            if (typeof cancelMatch === 'function' && gameState && gameState.isMatching) cancelMatch(); // いなむーのマッチングは止める
            this.game = game;
            this.el.root.hidden = false;
            this.el.setup.hidden = false;
            this.el.game.hidden = true;
            this.renderSetup();
        },
        close() {
            this.cancelOnline();
            this.stopCpu();
            this.state = null;
            this.mode = null;
            if (this.el.root) this.el.root.hidden = true;
        },

        renderSetup() {
            const r = this.el.root;
            r.querySelector('#bg-setup-title').textContent = (this.game === 'chess' ? '♟ ' : '☗ ') + GAME_JP[this.game];
            r.querySelectorAll('#bg-n button').forEach(b => b.classList.toggle('on', +b.dataset.n === this.n));
            r.querySelectorAll('#bg-cpu-level button').forEach(b => b.classList.toggle('on', +b.dataset.lv === this.cpuLevel));
            r.querySelectorAll('#bg-tc-main button').forEach(b => b.classList.toggle('on', +b.dataset.v === this.tc.main));
            r.querySelectorAll('#bg-tc-extra button').forEach(b => {
                b.classList.toggle('on', b.dataset.m === this.tc.mode && (+b.dataset.v === this.tc.extra || b.dataset.m === 'none'));
                b.disabled = b.dataset.m === 'increment' && this.tc.main === 0; // 持ち時間なしでは加算は使えない
            });
            r.querySelector('#bg-tc-note').textContent = tcText(this.tc) + '。' + (E.clockOn(this.tc)
                ? (this.tc.mode === 'byoyomi' ? '持ち時間を使い切ったら、1手を秒読みの時間内に指す。' : this.tc.mode === 'increment' ? '1手指すたびに持ち時間が増える。' : '') + '時間切れは負け（3・4人はその人だけ脱落）。CPUの考える時間は数えない。'
                : '時間制限なし。');
            this.el.rule.textContent = this.n === 2
                ? (this.game === 'chess' ? '8×8の盤・正式ルール（チェックメイトで勝ち。キャスリング・アンパッサン・プロモーションあり）' : '9×9の盤・正式ルール（詰みで勝ち。二歩・打ち歩詰め・千日手あり）')
                : `十字形の盤（${this.game === 'chess' ? '14×14' : '15×15'}）・${this.n}人で順番に指す。王を取られた人は脱落し、最後に残った人の勝ち。${this.game === 'shogi' ? '取った駒は持ち駒。自分以外の陣地に入ると成れる。' : 'ポーンは真ん中の線（8段目）でプロモーション。'}`;
            // 同じ画面で交代: 席ごとに人／CPU
            const ls = this.el.localSeats;
            ls.innerHTML = '';
            for (let i = 0; i < this.n; i++) {
                const row = document.createElement('div');
                row.className = 'bg-seat-row';
                const lab = document.createElement('span');
                lab.textContent = `${this.seatLabel(i)}`;
                const sel = document.createElement('select');
                ['human', 'cpu'].forEach(k => { const o = document.createElement('option'); o.value = k; o.textContent = k === 'human' ? '人' : 'CPU'; sel.appendChild(o); });
                sel.value = this.localKinds[i];
                sel.onchange = () => { this.localKinds[i] = sel.value; };
                row.append(lab, sel);
                ls.appendChild(row);
            }
            this.renderOnlineStatus();
        },
        seatLabel(i, n) {
            n = n || this.n;
            const pos = SEAT_JP[[0, 2][i] !== undefined && n === 2 ? [0, 2][i] : i];
            if (this.game === 'chess' && n === 2) return i === 0 ? '白（下）' : '黒（上）';
            if (n === 2) return i === 0 ? '先手（下）' : '後手（上）';
            return `${MULTI_COLOR_JP[i]}（${pos}）`;
        },
        // 「席の名前 + プレイヤー名」（名前がないときは席の名前だけ）
        who(i, n) { const nm = (this.seats[i] || {}).name; return this.seatLabel(i, n) + (nm ? ' ' + nm : ''); },
        seatColor(i) { return this.state && this.state.n === 2 ? (this.game === 'chess' ? CHESS2_COLORS[i] : '#c8a96b') : MULTI_COLORS[i]; },

        // ---------------- 対局の開始 ----------------
        startLocal(mode) {
            this.cancelOnline();
            this.mode = mode;
            const name = (document.getElementById('player-name') || {}).value || 'あなた';
            this.seats = [];
            for (let i = 0; i < this.n; i++) {
                if (mode === 'cpu') this.seats.push(i === 0 ? { kind: 'me', name } : { kind: 'cpu', name: `CPU（${CPU_JP[this.cpuLevel]}）`, level: this.cpuLevel });
                else this.seats.push(this.localKinds[i] === 'cpu' ? { kind: 'cpu', name: `CPU（${CPU_JP[this.cpuLevel]}）`, level: this.cpuLevel } : { kind: 'human', name: '' });
            }
            this.mySeat = 0;
            this.begin(E.create(this.game, this.n));
        },
        begin(state, clock) {
            this.state = state;
            if (this.mode !== 'online') this.clock = E.clockOn(this.tc) ? E.clockCreate(this.tc, state.n, Date.now()) : null;
            else this.clock = clock || null;
            this.sel = null; this.targets = [];
            this.el.setup.hidden = true;
            this.el.game.hidden = false;
            this.el.title.textContent = `${this.game === 'chess' ? '♟' : '☗'} ${GAME_JP[this.game]} ${this.n}人` + (this.mode === 'online' ? '（オンライン）' : this.mode === 'cpu' ? '（CPU）' : '（交代）') + (E.clockOn(this.tc) ? ` ⏱${tcText(this.tc)}` : '');
            this.render();
            this.afterMove();
        },

        // ---------------- 盤の表示 ----------------
        viewRot() {
            if (this.mode === 'local') return 0;
            return this.state.rot[this.mySeat] || 0;
        },
        render() {
            const s = this.state, N = s.N, k = this.viewRot();
            const top = this.el.game.querySelector('#bg-top').offsetHeight + this.el.players.offsetHeight + this.el.hands.offsetHeight + this.el.msg.offsetHeight + 24;
            const avail = Math.min(window.innerWidth - 24, Math.max(200, window.innerHeight - top - 8));
            const cell = Math.max(18, Math.floor(avail / N));
            const b = this.el.board;
            b.style.setProperty('--cell', cell + 'px');
            b.style.gridTemplateColumns = `repeat(${N}, ${cell}px)`;
            b.className = 'bg-board-' + s.game;
            const tgt = new Map();
            this.targets.forEach(m => tgt.set(m.t[0] + ',' + m.t[1], m));
            const last = s.last;
            const checkK = [];
            for (let i = 0; i < s.n; i++) if (s.alive[i] && E.inCheck(s, i)) { const kp = E.kingPos(s, i); if (kp) checkK.push(kp.join(',')); }
            const frag = document.createDocumentFragment();
            for (let vy = 0; vy < N; vy++) for (let vx = 0; vx < N; vx++) {
                const [x, y] = rotP(vx, vy, k, N); // 画面のマス → 盤のマス
                const d = document.createElement('div');
                d.className = 'bg-cell';
                if (!s.valid[y * N + x]) { d.classList.add('bg-void'); frag.appendChild(d); continue; }
                d.dataset.x = x; d.dataset.y = y;
                if (s.game === 'chess') d.classList.add((x + y) % 2 ? 'bg-dark' : 'bg-light');
                else if (s.game === 'shogi' && s.n > 2) {
                    // 3・4人の将棋: 各自の陣地（腕）にうすく色をつける
                    const arm = s.arm;
                    const zoneOf = (x < arm) ? 1 : (x >= N - arm) ? 3 : (y < arm) ? 2 : (y >= N - arm) ? 0 : -1;
                    const seat = s.rot.indexOf(zoneOf);
                    if (seat >= 0) d.style.background = `color-mix(in srgb, ${MULTI_COLORS[seat]} 14%, #e3c27a)`;
                }
                if (this.sel && !this.sel.hand && this.sel.x === x && this.sel.y === y) d.classList.add('bg-sel');
                if (last && ((last.f && last.f[0] === x && last.f[1] === y) || (last.t[0] === x && last.t[1] === y))) d.classList.add('bg-last');
                if (checkK.includes(x + ',' + y)) d.classList.add('bg-check');
                const p = s.board[y * N + x];
                if (p) {
                    const pe = document.createElement('div');
                    pe.className = 'bg-piece bg-piece-' + s.game;
                    pe.textContent = E.label(s, p);
                    const ang = ((s.rot[p.o] - k + 4) % 4) * 90;
                    if (s.game === 'shogi') {
                        pe.style.transform = `rotate(${ang}deg)`;
                        if (p.pr) pe.classList.add('bg-promoted');
                        if (s.n > 2) pe.style.boxShadow = `inset 0 -4px 0 ${MULTI_COLORS[p.o]}`;
                    } else {
                        pe.style.color = this.seatColor(p.o);
                        pe.style.textShadow = s.n === 2 && p.o === 0 ? '0 0 2px #000, 0 0 2px #000' : '0 0 2px #fff';
                    }
                    d.appendChild(pe);
                }
                if (tgt.has(x + ',' + y)) d.classList.add(p ? 'bg-target-cap' : 'bg-target');
                frag.appendChild(d);
            }
            b.innerHTML = '';
            b.appendChild(frag);
            this.renderPlayers();
            this.renderHands();
            this.renderTurn();
            this.renderClocks();
        },
        renderPlayers() {
            const s = this.state, P = this.el.players;
            P.innerHTML = '';
            for (let i = 0; i < s.n; i++) {
                const d = document.createElement('div');
                d.className = 'bg-player' + (s.turn === i && s.winner === null ? ' bg-player-turn' : '') + (!s.alive[i] && s.n > 2 ? ' bg-player-out' : '');
                const dot = document.createElement('span');
                dot.className = 'bg-dot';
                dot.style.background = this.seatColor(i);
                const nm = document.createElement('span');
                const seat = this.seats[i] || {};
                nm.textContent = `${this.seatLabel(i, s.n)} ${seat.name || ''}${(this.mode !== 'local' && i === this.mySeat) ? '（あなた）' : ''}${!s.alive[i] && s.n > 2 ? ' ✖脱落' : ''}`;
                d.append(dot, nm);
                if (this.clock && seat.kind !== 'cpu') {
                    const ck = document.createElement('span');
                    ck.className = 'bg-clock';
                    ck.dataset.seat = i;
                    d.appendChild(ck);
                }
                P.appendChild(d);
            }
        },
        renderHands() {
            const s = this.state, H = this.el.hands;
            H.innerHTML = '';
            if (s.game !== 'shogi') { H.hidden = true; return; }
            H.hidden = false;
            for (let i = 0; i < s.n; i++) {
                if (!s.alive[i]) continue;
                const row = document.createElement('div');
                row.className = 'bg-hand-row';
                const lab = document.createElement('span');
                lab.className = 'bg-hand-label';
                lab.style.borderColor = this.seatColor(i);
                lab.textContent = `${this.seatLabel(i, s.n)}の持ち駒:`;
                row.appendChild(lab);
                const h = s.hands[i];
                let any = false;
                SHOGI_HAND_ORDER.forEach(t => {
                    if (!h[t]) return;
                    any = true;
                    const b = document.createElement('button');
                    b.className = 'bg-hand-piece' + (this.sel && this.sel.hand === t && this.sel.seat === i ? ' bg-sel' : '');
                    b.dataset.t = t; b.dataset.seat = i;
                    b.textContent = E.SHOGI_NAME[t] + (h[t] > 1 ? '×' + h[t] : '');
                    row.appendChild(b);
                });
                if (!any) { const e = document.createElement('span'); e.className = 'bg-hand-none'; e.textContent = 'なし'; row.appendChild(e); }
                H.appendChild(row);
            }
        },
        renderTurn() {
            const s = this.state;
            let t;
            if (s.winner !== null) t = s.winner === -1 ? `引き分け（${s.reason}）` : `🏆 ${this.who(s.winner, s.n)} の勝ち！（${s.reason}）`;
            else {
                const who = this.seats[s.turn] || {};
                t = `${this.who(s.turn, s.n)} の番`;
                if (this.isMyTurn()) t = '▶ あなたの番です' + (this.mode === 'local' ? `（${this.seatLabel(s.turn, s.n)}）` : '');
                if (who.kind === 'cpu') t += ' 🤖 考え中…';
                if (s.n === 2 && E.inCheck(s, s.turn)) t += s.game === 'chess' ? '　⚠ チェック！' : '　⚠ 王手！';
            }
            this.el.turn.textContent = t;
            this.el.root.querySelector('#bg-btn-resign').disabled = s.winner !== null || !this.canResign();
        },
        say(t) { this.el.msg.textContent = t || ''; },

        // ---------------- 操作 ----------------
        isMyTurn() {
            const s = this.state;
            if (!s || s.winner !== null) return false;
            const seat = this.seats[s.turn] || {};
            if (this.mode === 'local') return seat.kind === 'human';
            return s.turn === this.mySeat && (seat.kind === 'me' || seat.kind === 'online');
        },
        canResign() {
            if (this.mode === 'local') return this.isMyTurn();
            return this.state.alive[this.mySeat];
        },
        clickCell(x, y) {
            const s = this.state;
            if (!this.isMyTurn()) return;
            const tm = this.targets.filter(m => m.t[0] === x && m.t[1] === y);
            if (tm.length) { this.choose(tm); return; }
            const p = s.board[y * s.N + x];
            if (p && p.o === s.turn) {
                this.sel = { x, y };
                this.targets = E.legalMoves(s).filter(m => m.f && m.f[0] === x && m.f[1] === y);
                if (!this.targets.length) this.say('その駒は動かせません。');
                else this.say('');
            } else { this.sel = null; this.targets = []; }
            this.render();
        },
        clickHand(t, seat) {
            const s = this.state;
            if (!this.isMyTurn() || seat !== s.turn) return;
            this.sel = { hand: t, seat };
            this.targets = E.legalMoves(s).filter(m => m.d === t);
            this.say(this.targets.length ? `${E.SHOGI_NAME[t]}を打つ場所を選んでください。` : 'そこには打てません。');
            this.render();
        },
        // 同じマスに複数の手（成る・成らない／プロモーション）があるときは選ぶ
        choose(ms) {
            if (ms.length === 1) { this.submit(ms[0]); return; }
            const body = this.el.dialogBody;
            body.innerHTML = '';
            const h = document.createElement('h3');
            h.textContent = this.state.game === 'chess' ? 'プロモーション' : '成りますか？';
            body.appendChild(h);
            const row = document.createElement('div');
            row.className = 'bg-choice';
            const name = m => this.state.game === 'chess' ? ({ Q: '♛ クイーン', R: '♜ ルーク', B: '♝ ビショップ', N: '♞ ナイト' })[m.pr] : (m.pr ? '成る' : '成らない');
            ms.forEach(m => { const b = document.createElement('button'); b.textContent = name(m); b.onclick = () => { this.el.dialog.hidden = true; this.submit(m); }; row.appendChild(b); });
            body.appendChild(row);
            const c = document.createElement('button'); c.className = 'bg-back'; c.textContent = 'やめる'; c.onclick = () => { this.el.dialog.hidden = true; };
            body.appendChild(c);
            this.el.dialog.hidden = false;
        },
        submit(m) {
            this.sel = null; this.targets = [];
            if (this.mode === 'online') {
                // サーバーが確かめてから全員に配る（自分の画面にもサーバーから届いたときに反映）
                if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'bg_move', move: m }));
                this.say('送信中…');
                this.render();
                return;
            }
            this.applyMove(m);
        },
        applyMove(m, clockMsg) {
            const legal = E.findLegal(this.state, m);
            if (!legal) { this.say('その手は指せません。'); this.render(); return; }
            const before = this.state;
            this.state = E.play(this.state, legal);
            if (this.mode === 'online') { if (clockMsg) this.setClockFromServer(clockMsg); }
            else if (this.clock) {
                // CPUが考えた時間は数えない
                const now = Date.now();
                const c = (this.seats[before.turn] || {}).kind === 'cpu' ? { ...this.clock, turnStart: now } : this.clock;
                this.clock = E.clockAfterMove(this.tc, c, this.state.turn, now);
            }
            this.announce(before, this.state);
            this.render();
            this.afterMove();
        },
        setClockFromServer(c) { this.clock = c ? { left: c.left.slice(), seat: c.seat, turnStart: Date.now() } : null; },
        // 残り時間の表示（0.25秒ごと）。CPU戦・交代は、時間切れもここで決める
        tickClock() {
            if (!this.isOpen() || !this.state || !this.clock) return;
            const s = this.state;
            if (s.winner === null && this.mode !== 'online') {
                const seat = this.seats[this.clock.seat] || {};
                if (seat.kind === 'cpu') this.clock = { ...this.clock, turnStart: Date.now() }; // CPUの番は時計を止める
                else if (Date.now() > E.clockDeadline(this.tc, this.clock)) { this.timeUp(this.clock.seat); return; }
            }
            this.renderClocks();
        },
        timeUp(seat) {
            const before = this.state;
            this.state = E.resign(this.state, seat, '時間切れ');
            const now = Date.now();
            this.clock = E.clockSwitch(this.clock, this.state.turn, now);
            this.clock.left = this.clock.left.slice(); this.clock.left[seat] = 0;
            this.sel = null; this.targets = [];
            this.announce(before, this.state);
            this.say(`⏱ ${this.who(seat, this.state.n)} が時間切れ！`);
            this.render();
            this.afterMove();
        },
        renderClocks() {
            if (!this.clock || !this.state) return;
            const now = Date.now(), s = this.state;
            const frozen = s.winner !== null;
            this.el.players.querySelectorAll('.bg-clock').forEach(el => {
                const i = +el.dataset.seat;
                const c = frozen ? { ...this.clock, turnStart: now } : this.clock;
                const v = E.clockView(this.tc, c, i, now);
                const txt = v.byo !== null && v.ms <= 0 ? `秒読み ${Math.ceil(v.byo / 1000)}` : fmtClock(v.ms);
                const low = (v.byo !== null && v.ms <= 0 ? v.byo : v.ms) <= 10000 && s.alive[i] && !frozen;
                if (el.textContent !== '⏱' + txt) el.textContent = '⏱' + txt;
                el.classList.toggle('bg-clock-low', low);
                el.classList.toggle('bg-clock-run', !frozen && this.clock.seat === i && s.alive[i]);
            });
        },
        announce(before, after) {
            const out = [];
            for (let i = 0; i < after.n; i++) if (before.alive[i] && !after.alive[i] && after.n > 2) out.push(`${this.who(i, after.n)} が脱落！`);
            this.say(out.join(' '));
        },
        afterMove() {
            const s = this.state;
            if (!s) return;
            if (s.winner !== null) { this.showResult(); return; }
            const seat = this.seats[s.turn] || {};
            if (seat.kind === 'cpu') this.runCpu();
        },
        runCpu() {
            this.stopCpu();
            const s = this.state, lv = (this.seats[s.turn] || {}).level || 2;
            this.cpuTimer = setTimeout(() => {
                if (this.state !== s) return;
                const m = E.aiMove(s, lv);
                if (!m) { this.state = E.resign(s, s.turn, '指せる手がない'); this.render(); this.afterMove(); return; }
                this.applyMove(m);
            }, 450);
        },
        stopCpu() { if (this.cpuTimer) { clearTimeout(this.cpuTimer); this.cpuTimer = null; } },

        // ---------------- 投了・終わり ----------------
        confirm(text, yes) {
            const body = this.el.dialogBody;
            body.innerHTML = '';
            const p = document.createElement('p'); p.textContent = text; body.appendChild(p);
            const row = document.createElement('div'); row.className = 'bg-choice';
            const y = document.createElement('button'); y.textContent = 'はい'; y.onclick = () => { this.el.dialog.hidden = true; yes(); };
            const n = document.createElement('button'); n.textContent = 'いいえ'; n.onclick = () => { this.el.dialog.hidden = true; };
            row.append(y, n); body.appendChild(row);
            this.el.dialog.hidden = false;
        },
        askResign() {
            if (!this.state || this.state.winner !== null) return;
            this.confirm('投了しますか？', () => {
                if (this.mode === 'online') { if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'bg_resign' })); return; }
                const seat = this.mode === 'local' ? this.state.turn : this.mySeat;
                const before = this.state;
                this.state = E.resign(this.state, seat, '投了');
                if (this.clock) this.clock = E.clockSwitch(this.clock, this.state.turn, Date.now());
                this.announce(before, this.state);
                this.render();
                this.afterMove();
            });
        },
        askExit() {
            const playing = this.state && this.state.winner === null;
            const go = () => {
                if (this.mode === 'online' && socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'bg_leave' }));
                this.stopCpu();
                this.state = null;
                this.el.game.hidden = true;
                this.el.setup.hidden = false;
                this.mode = null;
                this.renderSetup();
            };
            if (playing) this.confirm(this.mode === 'online' ? '対局を抜けますか？（投了あつかいになります）' : '対局をやめますか？', go); else go();
        },
        showResult() {
            this.stopCpu();
            const s = this.state;
            const body = this.el.dialogBody;
            body.innerHTML = '';
            const h = document.createElement('h3');
            const meWin = this.mode !== 'local' && s.winner === this.mySeat;
            h.textContent = s.winner === -1 ? '引き分け' : (this.mode === 'local' ? `${this.seatLabel(s.winner, s.n)} の勝ち！` : (meWin ? '🏆 あなたの勝ち！' : `${this.who(s.winner, s.n)} の勝ち`));
            const p = document.createElement('p'); p.textContent = s.reason || '';
            const row = document.createElement('div'); row.className = 'bg-choice';
            const again = document.createElement('button'); again.textContent = 'もう一度';
            again.onclick = () => { this.el.dialog.hidden = true; if (this.mode === 'online') { this.askExit(); this.findOnline(); } else this.startLocal(this.mode); };
            const ok = document.createElement('button'); ok.textContent = '盤を見る';
            ok.onclick = () => { this.el.dialog.hidden = true; };
            row.append(again, ok);
            body.append(h, p, row);
            this.el.dialog.hidden = false;
            this.renderTurn();
        },

        // ---------------- オンライン ----------------
        findOnline() {
            if (!socket || socket.readyState !== WebSocket.OPEN) {
                if (typeof connectToServer === 'function') connectToServer();
                this.online.status = 'サーバーにつないでいます…もう一度押してください。';
                this.renderOnlineStatus();
                return;
            }
            if (typeof savePlayerName === 'function') { try { savePlayerName(); sendRegisterPlayerName(); } catch (e) {} }
            this.online.matching = true;
            this.online.startedAt = Date.now();
            this.online.count = 1; this.online.need = this.n;
            socket.send(JSON.stringify({ type: 'bg_find', game: this.game, players: this.n, tc: this.tc }));
            clearInterval(this.online.timer);
            this.online.timer = setInterval(() => this.renderOnlineStatus(), 1000);
            this.renderOnlineStatus();
        },
        cancelOnline() {
            if (!this.online.matching) return;
            this.online.matching = false;
            clearInterval(this.online.timer);
            if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'bg_cancel' }));
            this.renderOnlineStatus();
        },
        renderOnlineStatus() {
            const btn = this.el.root && this.el.root.querySelector('#bg-btn-online');
            if (!btn) return;
            if (this.online.matching) {
                const t = typeof formatElapsed === 'function' ? formatElapsed(Date.now() - this.online.startedAt) : '';
                btn.textContent = `キャンセル（${t}）`;
                this.el.onlineStatus.textContent = `⏳ マッチング中… ${t}　（${this.online.count}/${this.online.need}人）`;
            } else {
                btn.textContent = '🌐 オンラインで対戦';
                this.el.onlineStatus.textContent = this.online.status || '';
                this.online.status = '';
            }
        },
        // サーバーからのメッセージ（main.js の handleServerMessage から呼ばれる）
        onServer(d) {
            switch (d.type) {
                case 'bg_queue':
                    this.online.count = d.count; this.online.need = d.need;
                    this.renderOnlineStatus();
                    break;
                case 'bg_start': {
                    this.online.matching = false;
                    clearInterval(this.online.timer);
                    if (!this.el.root) this.init();
                    this.el.root.hidden = false;
                    this.game = d.game; this.n = d.n;
                    this.mode = 'online';
                    this.mySeat = d.seat;
                    this.seats = d.names.map((nm, i) => ({ kind: 'online', name: nm }));
                    this.tc = E.normalizeTc(d.tc);
                    this.begin(E.create(d.game, d.n), d.clock ? { left: d.clock.left.slice(), seat: d.clock.seat, turnStart: Date.now() } : null);
                    this.say(`対局開始！ あなたは ${this.seatLabel(d.seat, d.n)} です。`);
                    break;
                }
                case 'bg_move':
                    if (this.mode !== 'online' || !this.state) return;
                    this.applyMove(d.move, d.clock);
                    break;
                case 'bg_resign':
                    if (this.mode !== 'online' || !this.state) return;
                    { const before = this.state; this.state = E.resign(this.state, d.seat, d.reason || '投了'); if (d.clock) this.setClockFromServer(d.clock);
                      this.announce(before, this.state); if (d.reason === '時間切れ') this.say(`⏱ ${this.who(d.seat, this.state.n)} が時間切れ！`);
                      this.render(); this.afterMove(); }
                    break;
                case 'bg_error':
                    this.say(d.reason || 'その手は指せません。');
                    if (this.state) this.render();
                    break;
            }
        }
    };

    // 時間の決まりの文（例: 3分＋秒読み30秒）
    function tcText(tc) {
        if (!E.clockOn(tc)) return '時間制限なし';
        const m = tc.main ? (tc.main >= 60 ? tc.main / 60 + '分' : tc.main + '秒') : '持ち時間なし';
        return m + (tc.mode === 'byoyomi' ? `＋秒読み${tc.extra}秒` : tc.mode === 'increment' ? `＋1手ごとに${tc.extra}秒加算` : '');
    }
    function fmtClock(ms) {
        const t = Math.ceil(ms / 1000);
        return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
    }
    function rotP(x, y, k, N) { for (let i = 0; i < k; i++) [x, y] = [N - 1 - y, x]; return [x, y]; }

    window.BoardGames = BG;
})();
