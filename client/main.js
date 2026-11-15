/**
 * いなむーレジェンズ - メインロジック
 */

const CONFIG = {
    SCREEN_WIDTH: 576, // 18 cols * 32px
    SCREEN_HEIGHT: 288, // 9 rows * 32px
    GRID_ROWS: 9,
    GRID_COLS: 18,
    FPS: 30,
    TILE_SIZE: 32,
    PLAYER_SPEED: 4, // px per frame
    BULLET_SPEED_RATE: 2 / 3, // 弾の速さの倍率（全体的に3分の2に調整）
};

// ゲーム全体で使うフォント（ドット絵風の DotGothic16。読み込めないときは代わりのフォント）
const GAME_FONT = '"DotGothic16", "Courier New", sans-serif';

// ===============================================================
// ☁️ クラウドデータ同期システム
// ユーザートークンを使ってサーバーとELO・デッキ・図鑑を同期
// ===============================================================
const CloudSyncManager = {
    token: null,

    // トークンの初期化（localStorage から取得、なければ生成）
    initToken() {
        let t = localStorage.getItem('inamu_user_token');
        if (!t) {
            t = 'u_' + Math.random().toString(36).substr(2, 12) + Date.now().toString(36);
            localStorage.setItem('inamu_user_token', t);
        }
        this.token = t;
    },

    // サーバーからユーザーデータを読み込み
    async load() {
        this.initToken();
        try {
            const res = await fetch('/api/userdata', {
                headers: { 'x-user-token': this.token }
            });
            if (!res.ok) return null;
            const data = await res.json();
            return data;
        } catch (e) {
            return null; // サーバー未接続時はローカルデータを使用
        }
    },

    // サーバーにユーザーデータを保存
    async save(patch) {
        if (!this.token) this.initToken();
        try {
            await fetch('/api/userdata', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-user-token': this.token
                },
                body: JSON.stringify(patch)
            });
        } catch (e) {
            // サーバー未接続時は無視（ローカルに保存済み）
        }
    },

    // ELOの更新（ローカル + サーバー）
    async updateElo(delta) {
        let elo = parseInt(localStorage.getItem('inamu_elo') || '1200');
        elo = Math.max(0, Math.min(9999, elo + delta));
        localStorage.setItem('inamu_elo', elo.toString());
        updateMyEloDisplay();
        const name = localStorage.getItem('inamu_player_name') || 'ゲスト';
        await this.save({ elo, name });
        this.updateRankingDisplay();
        return elo;
    },

    // デッキの保存（ローカル + サーバー）
    async saveDeck(deck) {
        localStorage.setItem('inamu_deck', JSON.stringify(deck));
        await this.save({ deck });
    },

    // 発見済みキメラの保存（ローカル + サーバー）
    async saveDiscoveredChimeras(list) {
        localStorage.setItem('inamu_discovered_chimeras', JSON.stringify(list));
        await this.save({ discoveredChimeras: list });
    },

    // 起動時にクラウドからデータをロードしてローカルとマージ
    async syncOnStart() {
        this.initToken();
        const cloudData = await this.load();
        if (!cloudData) return; // ローカルモード

        // サーバーのデータでローカルをアップデート（サーバー優先）
        const localElo = parseInt(localStorage.getItem('inamu_elo') || '1200');
        const cloudElo = cloudData.elo || 1200;
        // より高いELOを採用（どちらかを失わないように）
        const bestElo = Math.max(localElo, cloudElo);
        localStorage.setItem('inamu_elo', bestElo.toString());
        updateMyEloDisplay();
        // サーバー側の記録が低いときは合わせておく（オンライン一覧・ランキングに正しいレートを出すため）
        if (bestElo !== cloudElo) {
            this.save({ elo: bestElo, name: localStorage.getItem('inamu_player_name') || 'ゲスト' });
        }

        if (cloudData.deck && Array.isArray(cloudData.deck) && cloudData.deck.length === 6) {
            localStorage.setItem('inamu_deck', JSON.stringify(cloudData.deck));
        }
        if (cloudData.discoveredChimeras && Array.isArray(cloudData.discoveredChimeras)) {
            const local = JSON.parse(localStorage.getItem('inamu_discovered_chimeras') || '[]');
            const merged = [...new Set([...local, ...cloudData.discoveredChimeras])];
            localStorage.setItem('inamu_discovered_chimeras', JSON.stringify(merged));
        }

        // ランキングUIを更新
        this.updateRankingDisplay();
    },

    // ランキング取得・表示
    async updateRankingDisplay() {
        try {
            const res = await fetch('/api/ranking');
            if (!res.ok) return;
            const ranking = await res.json();
            const el = document.getElementById('ranking-list');
            if (!el) return;
            el.innerHTML = '';
            if (!Array.isArray(ranking) || ranking.length === 0) {
                el.innerHTML = '<div class="home-empty">まだ記録がありません</div>';
                return;
            }
            const medal = ['#ffd700', '#c0c0c0', '#cd7f32'];
            ranking.slice(0, 10).forEach((r, i) => {
                // 名前は「ただの文字」として表示する
                const row = document.createElement('div');
                row.className = 'home-list-row';
                const name = document.createElement('span');
                name.className = 'name';
                name.style.color = medal[i] || '#fff';
                name.textContent = `${i + 1}. ${r.name}`;
                const elo = document.createElement('span');
                elo.className = 'elo';
                elo.textContent = r.elo;
                row.append(name, elo);
                el.appendChild(row);
            });
        } catch (e) {}
    }
};

const SoundManager = {
    ctx: null,
    masterGain: null,
    volume: 0.8,
    muted: false,
    init() {
        if (this.ctx) return;
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
            this.masterGain = this.ctx.createGain();
            this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime);
            this.masterGain.connect(this.ctx.destination);
        } catch (e) {}
    },
    setVolume(val) {
        this.volume = Math.max(0, Math.min(1, val));
        if (this.masterGain && this.ctx) {
            this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime);
        }
    },
    setMute(mute) {
        this.muted = !!mute;
        if (this.masterGain && this.ctx) {
            this.masterGain.gain.setValueAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime);
        }
    },
    resume() {
        if (this.ctx && this.ctx.state === 'suspended') {
            try { this.ctx.resume(); } catch (e) {}
        }
    },
    getDest() {
        this.init();
        return this.masterGain || (this.ctx ? this.ctx.destination : null);
    },
    playSummon() {
        this.init(); this.resume();
        if (!this.ctx || this.muted) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, this.ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.1);
        osc.connect(gain); gain.connect(this.getDest());
        osc.start(); osc.stop(this.ctx.currentTime + 0.1);
    },
    playFire() {
        this.init(); this.resume();
        if (!this.ctx || this.muted) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(150, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(40, this.ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.05, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.1);
        osc.connect(gain); gain.connect(this.getDest());
        osc.start(); osc.stop(this.ctx.currentTime + 0.1);
    },
    playHit() {
        this.init(); this.resume();
        if (!this.ctx || this.muted) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(1200, this.ctx.currentTime);
        gain.gain.setValueAtTime(0.03, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.05);
        osc.connect(gain); gain.connect(this.getDest());
        osc.start(); osc.stop(this.ctx.currentTime + 0.05);
    },
    playExplosion() {
        this.init(); this.resume();
        if (!this.ctx || this.muted) return;
        const bufferSize = this.ctx.sampleRate * 0.3;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass'; filter.frequency.setValueAtTime(600, this.ctx.currentTime);
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.2, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);
        noise.connect(filter); filter.connect(gain); gain.connect(this.getDest());
        noise.start(); noise.stop(this.ctx.currentTime + 0.3);
    },
    playVictory() {
        this.init(); this.resume();
        if (!this.ctx || this.muted) return;
        [440, 554, 659, 880].forEach((f, i) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.frequency.setValueAtTime(f, this.ctx.currentTime + i * 0.1);
            gain.gain.setValueAtTime(0, this.ctx.currentTime + i * 0.1);
            gain.gain.linearRampToValueAtTime(0.1, this.ctx.currentTime + i * 0.1 + 0.05);
            gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + i * 0.1 + 0.3);
            osc.connect(gain); gain.connect(this.getDest());
            osc.start(this.ctx.currentTime + i * 0.1); osc.stop(this.ctx.currentTime + i * 0.1 + 0.3);
        });
    }
};

// アセット (プログラム生成)
const ASSETS = {};

// ユニット定義を先に宣言（スプライト生成で使うため）
// ユニット定義（稲は全体的にマイルドに弱体化、新種を多数追加）
const UNIT_TYPES = {
    // 🌾 稲（タレット型・弱体化調整）
    RICE_BASIC: { id: 'rice_1', name: 'ライス プリムス', cost: 7, hp: 29, type: 'rice', cooldown: 2.6, fireType: '8dir', power: 4, desc: '基本となる稲。周囲8方向に米粒を放つ。' },
    RICE_SPREAD: { id: 'rice_2', name: 'フェッヒャー ライス', cost: 8, hp: 27, type: 'rice', cooldown: 3.0, fireType: 'circle6', power: 6, desc: '円形に6発の弾を放つ扇の稲。広範囲をカバー。' },
    RICE_SEEKER: { id: 'rice_3', name: 'イェーガー ライス', cost: 9, hp: 25, type: 'rice', cooldown: 2.2, fireType: 'single', action: 'homing', power: 12, desc: '敵を追尾する狩人の稲。' },
    RICE_BURST: { id: 'rice_4', name: 'シュトゥルム ライス', cost: 10, hp: 27, type: 'rice', cooldown: 1.5, fireType: 'burst', power: 4, desc: '3連射を放つ嵐の稲。' },
    RICE_LASER: { id: 'rice_5', name: 'ルクス ライス', cost: 12, hp: 29, type: 'rice', cooldown: 3.8, fireType: 'single', action: 'laser', power: 20, desc: '【新種】一直線に貫く光の稲。高速レーザーを照射。' },
    RICE_POISON: { id: 'rice_p', name: 'ギフト ライス', cost: 9, hp: 32, type: 'rice', cooldown: 3.2, fireType: 'circle6', action: 'poison', power: 5, desc: '【新種】毒胞子を撒き散らす稲。当たった場所に3秒間「毒の霧」を残す。霧の中の敵ユニットは毎秒ダメージ、霧を通る敵の弾は威力が半分。' },
    RICE_FROST: { id: 'rice_f', name: 'フロスト ライス', cost: 11, hp: 32, type: 'rice', cooldown: 3.0, fireType: '8dir', action: 'frost', power: 9, desc: '【新種】氷結の冷気を放つ稲。冷気弾で敵弾を相殺。' },
    RICE_SNIPER: { id: 'rice_s', name: 'プレツィザ ライス', cost: 13, hp: 22, type: 'rice', cooldown: 4.5, fireType: 'single', action: 'sniper', power: 30, desc: '【新種】敵本体を遠距離から直接撃ち抜く狙撃の稲。' },

    // 🛡️ 稲・盾（個性豊かな特殊能力を付与）
    RICE_SHIELD_WOOD: {
        id: 'rice_6', name: 'ホルツ シルト', cost: 5, hp: 117, type: 'rice', cooldown: 999, fireType: 'none', special: 'wood_regen',
        desc: '【特殊能力: 芽吹き再生】低コスト木盾。自らのHPを毎秒+2自然回復し、破壊時に周囲味方HPを回復。'
    },
    RICE_SHIELD_IRON: {
        id: 'rice_7', name: 'アイゼン シルト', cost: 10, hp: 216, type: 'rice', cooldown: 999, fireType: 'none', special: 'iron_reflect',
        desc: '【特殊能力: 鉄壁反射】重厚鉄盾。被弾ダメージ25%軽減＋3回被弾ごとに棘スパイク弾を前方へ跳弾反射！'
    },
    RICE_SHIELD_MAGIC: {
        id: 'rice_8', name: 'アウラ シルト', cost: 16, hp: 342, type: 'rice', cooldown: 999, fireType: 'none', special: 'aura_absorb',
        desc: '【特殊能力: 魔力変換】神秘の障壁。敵弾を受けるたびに自軍マナへ変換し、戦線を支え続ける！'
    },

    // 🥤 コーラ（手動投擲・新種追加）
    COLA_STRAIGHT: { id: 'cola_1', name: 'コーラ ブリッツ', cost: 5, hp: 117, type: 'cola', action: 'straight', power: 25, desc: '直線的に突き進む電撃のコーラ。当たると近くの敵ユニット2体に電撃が連鎖し、半分のダメージを与える。' },
    COLA_BOUNCE: { id: 'cola_2', name: 'コーラ ジャンパー', cost: 8, hp: 105, type: 'cola', action: 'bounce', power: 26, desc: '壁を跳ね回る跳躍のコーラ。' },
    COLA_SPLIT: { id: 'cola_3', name: 'コーラ フラグメント', cost: 9, hp: 94, type: 'cola', action: 'split', power: 18, desc: '分裂して降り注ぐ砕片のコーラ。' },
    COLA_CHARGE: { id: 'cola_5', name: 'コーラ バルカン', cost: 11, hp: 129, type: 'cola', action: 'charge', power: 35, desc: '力を溜めて爆発させる火山のコーラ。' },
    COLA_PIERCE: { id: 'cola_6', name: 'コーラ ランツェ', cost: 12, hp: 105, type: 'cola', action: 'pierce', power: 24, desc: '全てを貫く槍のコーラ。' },
    COLA_SPREAD: { id: 'cola_7', name: 'コーラ ノヴァ', cost: 11, hp: 112, type: 'cola', action: 'spread', power: 20, desc: '着弾時に弾け飛ぶ新星のコーラ。' },
    COLA_MEGATON: { id: 'cola_m', name: 'コーラ ギガント', cost: 15, hp: 164, type: 'cola', action: 'megaton', power: 50, desc: '【新種】超巨大な重量級コーラ。前線を圧殺する。' },
    COLA_BLACK: { id: 'cola_b', name: 'コーラ ネビュラ', cost: 13, hp: 117, type: 'cola', action: 'blackhole', power: 28, desc: '【新種】すぐ近くの敵弾を引き込み消滅させ、マナに変える重力コーラ。' },
    COLA_MENTOS: { id: 'cola_g', name: 'コーラ ゲイザー', cost: 10, hp: 105, type: 'cola', action: 'geyser', power: 28, desc: '【新種】炭酸噴射で大きくうねりながら、相手本体へぐいっと曲がって急加速する暴走コーラ。敵の弾や氷結・毒・吸い込み・コーラの衝突で消されそうになっても70%でかわす。' },
    COLA_ZERO: { id: 'cola_z', name: 'コーラ ゼロ', cost: 4, hp: 82, type: 'cola', action: 'zero', power: 16, desc: '【新種】超低コストで高速回転する零式コーラ。' },

    // 🫧 ソーダ（個性豊かな特殊能力を付与）
    SODA_SMALL: {
        id: 'soda_1', name: 'ソーダ ブリーゼ', cost: 8, hp: 63, type: 'soda', manaGen: 0.025, special: 'breeze_haste',
        desc: '【特殊能力: 追い風エール】微量マナ生成に加え、同列にいる味方稲の攻撃速度を15%加速させる！'
    },
    SODA_MEDIUM: {
        id: 'soda_2', name: 'ソーダ クヴェレ', cost: 15, hp: 99, type: 'soda', manaGen: 0.05, special: 'quelle_bubble',
        desc: '【特殊能力: 泡の防護膜】中マナ生成。6秒ごとに最も弱った味方に敵弾を無効化するバブルシールド付与！'
    },
    SODA_LARGE: {
        id: 'soda_3', name: 'ソーダ オツェアーン', cost: 23, hp: 153, type: 'soda', manaGen: 0.09, special: 'ocean_heal',
        desc: '【特殊能力: 満潮ヒーリング】大量マナ生成に加え、自軍プレイヤー本体のHPを毎秒+2回復する！'
    }
};

// シークレット特殊進化（キメラ合体）全20種の定義（厳格レシピ：最低3素材・2種類以上・個数指定）
const SECRET_CHIMERAS = {
    GATLING_SPRITE: {
        id: 'chimera_gatling', name: 'GATLING', displayName: '機神 ガトリング・スプライト',
        pairHint: 'シュトゥルム ライス×2 ＋ コーラ ジャンパー (計3体)',
        recipe: (t, s) => (
            t.typeKey === 'RICE_BURST' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.filter(k => k === 'RICE_BURST').length >= 1 &&
            s.typeKey === 'COLA_BOUNCE'
        ),
        hp: 198, power: 16, cooldown: 0.5, fireTypes: ['burst'], actions: ['bounce'],
        desc: '【No.001 シークレット】連射稲2体に跳弾コーラを合成。秒間8連射の超高速跳弾マシンガンを乱射する機神。'
    },
    CLUSTER_METEOR: {
        id: 'chimera_meteor', name: 'METEOR', displayName: '彗星 クラスター・ミーティア',
        pairHint: 'フェッヒャー ライス×2 ＋ コーラ ノヴァ (計3体)',
        recipe: (t, s) => (
            t.typeKey === 'RICE_SPREAD' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.filter(k => k === 'RICE_SPREAD').length >= 1 &&
            s.typeKey === 'COLA_SPREAD'
        ),
        hp: 189, power: 25, cooldown: 1.4, fireTypes: ['circle6'], actions: ['spread'],
        desc: '【No.002 シークレット】拡散稲2体に爆散コーラを合成。着弾時に周囲へ超大爆発を起こす彗星弾を円形発射。'
    },
    PHANTOM_HUNTER: {
        id: 'chimera_phantom', name: 'PHANTOM', displayName: '亡霊 イェーガー・アサシン',
        pairHint: 'イェーガー ライス ＋ コーラ ランツェ ＋ コーラ ジャンパー (計3体)',
        recipe: (t, s) => (
            t.typeKey === 'RICE_SEEKER' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.includes('COLA_PIERCE') &&
            s.typeKey === 'COLA_BOUNCE'
        ),
        hp: 171, power: 20, cooldown: 1.1, fireTypes: ['homing2'], actions: ['pierce', 'bounce', 'homing'], pierceCount: 4,
        desc: '【No.003 シークレット】追尾稲に貫通と跳弾コーラを合成。壁を跳ね敵前線をすり抜け本体を執拗に追尾。'
    },
    VOLCANO_FORTRESS: {
        id: 'chimera_volcano', name: 'VOLCANO', displayName: '超要塞 インフェルノ・フォートレス',
        pairHint: 'ホルツ シルト ＋ アイゼン シルト ＋ コーラ バルカン (計3体)',
        recipe: (t, s) => (
            t.typeKey === 'RICE_SHIELD_WOOD' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.includes('RICE_SHIELD_IRON') &&
            s.typeKey === 'COLA_CHARGE'
        ),
        hp: 576, power: 30, cooldown: 1.6, fireTypes: ['circle6'], actions: ['charge', 'spread'],
        desc: '【No.004 シークレット】木盾に鉄盾と火山コーラを合成。HP320の砦。周囲に超高威力の火砕流弾を噴出。'
    },
    NEBULA_HARVESTER: {
        id: 'chimera_nebula', name: 'NEBULA', displayName: '特異点 ネビュラ・ハーベスター',
        pairHint: 'ギフト ライス×2 ＋ コーラ ネビュラ (計3体)',
        recipe: (t, s) => (
            t.typeKey === 'RICE_POISON' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.filter(k => k === 'RICE_POISON').length >= 1 &&
            s.typeKey === 'COLA_BLACK'
        ),
        hp: 198, power: 18, cooldown: 1.5, fireTypes: ['8dir'], actions: ['blackhole', 'poison'], manaGen: 0.12,
        desc: '【No.005 シークレット】毒稲2体に黒コーラを合成。敵弾を吸い込んで消滅させマナへ変換し、敵弾を腐食。'
    },
    ZERO_DRAGOON: {
        id: 'chimera_dragoon', name: 'DRAGOON', displayName: '超電磁砲 零式ドラグーン・カイザー',
        pairHint: 'プレツィザ ライス ＋ コーラ ゼロ ＋ コーラ ブリッツ (計3体)',
        recipe: (t, s) => (
            t.typeKey === 'RICE_SNIPER' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.includes('COLA_ZERO') &&
            s.typeKey === 'COLA_STRAIGHT'
        ),
        hp: 180, power: 35, cooldown: 1.2, fireTypes: ['single'], actions: ['pierce', 'sniper', 'straight'], pierceCount: 8,
        desc: '【No.006 シークレット】狙撃稲に零式と電撃コーラを合成。一直線に敵陣を貫通する超高速プラズマレールガン。'
    },
    MEGALITH_TITAN: {
        id: 'chimera_titan', name: 'TITAN', displayName: '超巨神 ギガント・メガリス・タイタン',
        pairHint: 'アイゼン シルト×2 ＋ コーラ ギガント (計3体)',
        recipe: (t, s) => (
            t.typeKey === 'RICE_SHIELD_IRON' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.filter(k => k === 'RICE_SHIELD_IRON').length >= 1 &&
            s.typeKey === 'COLA_MEGATON'
        ),
        hp: 630, power: 32, cooldown: 2.0, fireTypes: ['burst'], actions: ['megaton'],
        desc: '【No.007 シークレット】鉄盾2体に巨大コーラを合成。HP350。敵前線を圧殺する超重量級メガトン砲撃。'
    },
    FROST_NOVA: {
        id: 'chimera_frost', name: 'FROST', displayName: '極光 フロスト・ノヴァ',
        pairHint: 'フロスト ライス×2 ＋ コーラ ゲイザー (計3体)',
        recipe: (t, s) => (
            t.typeKey === 'RICE_FROST' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.filter(k => k === 'RICE_FROST').length >= 1 &&
            s.typeKey === 'COLA_MENTOS'
        ),
        hp: 189, power: 18, cooldown: 1.3, fireTypes: ['8dir'], actions: ['frost', 'geyser'],
        desc: '【シークレットキメラ】氷結稲2体にゲイザーコーラを合成。急加速する8方向冷気弾で敵弾を相殺。'
    },
    ZERO_FROST: {
        id: 'chimera_zero_frost', name: 'ZERO-FROST', displayName: '絶対零度 アブソリュート・フロスト',
        pairHint: 'フロスト ライス ＋ コーラ ノヴァ ＋ コーラ ゲイザー (計3体)',
        recipe: (t, s) => (
            t.typeKey === 'RICE_FROST' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.includes('COLA_SPREAD') &&
            s.typeKey === 'COLA_MENTOS'
        ),
        hp: 207, power: 24, cooldown: 1.3, fireTypes: ['circle6'], actions: ['frost', 'spread', 'geyser'],
        desc: '【No.008 シークレット】氷結稲に爆散とゲイザーを合成。敵弾を相殺した瞬間に周囲へカウンター大爆散を起こす！'
    },
    AURA_GENESIS: {
        id: 'chimera_genesis', name: 'GENESIS', displayName: '世界樹 ユグドラシル・ジェネシス',
        pairHint: 'アウラ シルト ＋ ソーダ クヴェレ ＋ ソーダ オツェアーン (計3体)',
        recipe: (t, s) => (
            t.typeKey === 'RICE_SHIELD_MAGIC' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.includes('SODA_MEDIUM') &&
            s.typeKey === 'SODA_LARGE'
        ),
        hp: 396, power: 0, cooldown: 2.0, fireTypes: ['none'], isManaProducer: true, manaGen: 0.22,
        desc: '【No.009 シークレット】魔力盾に中ソーダと大ソーダを合成。味方HPを持続リジェネ(+4/s)し大量マナ生成。'
    },
    // ===============================================================
    // ❄️ 第2弾: 氷結・極冷・絶対零度系シークレット (No.011〜020)
    // ===============================================================
    VALKYRIE_BLIZZARD: {
        id: 'chimera_valkyrie', name: 'VALKYRIE', displayName: '氷槍 ヴァルキリー・ブリザード',
        pairHint: 'フロスト ライス×2 ＋ コーラ ジャンパー (計3体)',
        recipe: (t, s) => (
            t.typeKey === 'RICE_FROST' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.filter(k => k === 'RICE_FROST').length >= 1 &&
            s.typeKey === 'COLA_BOUNCE'
        ),
        hp: 198, power: 22, cooldown: 0.9, fireTypes: ['single'], actions: ['frost', 'bounce'],
        desc: '【No.011 シークレット】氷結稲2体に跳弾コーラを合成。壁を反射しながら触れた敵弾を相殺消滅させる極冷の跳弾氷槍！'
    },
    GLACIA_FORTRESS: {
        id: 'chimera_glacia', name: 'GLACIA', displayName: '氷壁 グレイシア・フォートレス',
        pairHint: 'アイゼン シルト ＋ フロスト ライス ＋ ソーダ クヴェレ (計3体)',
        recipe: (t, s) => (
            t.typeKey === 'RICE_SHIELD_IRON' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.includes('RICE_FROST') &&
            s.typeKey === 'SODA_MEDIUM'
        ),
        hp: 504, power: 16, cooldown: 1.8, fireTypes: ['circle6'], actions: ['frost', 'iron_reflect'], special: 'iron_reflect',
        desc: '【No.012 シークレット】鉄盾に氷結稲と源泉ソーダを合成。被弾ダメージ軽減＆敵弾を相殺反射する絶対防御の氷壁要塞！'
    },
    ICICLE_SNIPER: {
        id: 'chimera_icicle', name: 'ICICLE', displayName: '零式 アイシクル・スナイパー',
        pairHint: 'プレツィザ ライス ＋ フロスト ライス ＋ コーラ ゼロ (計3体)',
        recipe: (t, s) => (
            t.typeKey === 'RICE_SNIPER' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.includes('RICE_FROST') &&
            s.typeKey === 'COLA_ZERO'
        ),
        hp: 171, power: 36, cooldown: 1.3, fireTypes: ['single'], actions: ['frost', 'sniper', 'zero'], pierceCount: 4,
        desc: '【No.013 シークレット】狙撃稲に氷結稲と零式コーラを合成。敵弾をすり抜け相殺しながら敵プレイヤーを射抜く氷柱弾！'
    },
    DIAMOND_METEOR: {
        id: 'chimera_diamond', name: 'DIAMOND', displayName: '星屑 ダイヤモンドダスト・ミーティア',
        pairHint: 'フェッヒャー ライス ＋ フロスト ライス ＋ コーラ ノヴァ (計3体)',
        recipe: (t, s) => (
            t.typeKey === 'RICE_SPREAD' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.includes('RICE_FROST') &&
            s.typeKey === 'COLA_SPREAD'
        ),
        hp: 189, power: 26, cooldown: 1.4, fireTypes: ['circle6'], actions: ['frost', 'spread'],
        desc: '【No.014 シークレット】拡散稲に氷結稲と爆散コーラを合成。相殺した瞬間に周囲全域へダイヤモンドダスト大爆散を起こす！'
    },
    AVALANCHE_TITAN: {
        id: 'chimera_avalanche', name: 'AVALANCHE', displayName: '雪嶺 アバランチ・タイタン',
        pairHint: 'アイゼン シルト ＋ フロスト ライス ＋ コーラ ギガント (計3体)',
        recipe: (t, s) => (
            t.typeKey === 'RICE_SHIELD_IRON' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.includes('RICE_FROST') &&
            s.typeKey === 'COLA_MEGATON'
        ),
        hp: 612, power: 34, cooldown: 2.0, fireTypes: ['burst'], actions: ['frost', 'megaton'],
        desc: '【No.015 シークレット】鉄盾に氷結稲と超巨大コーラを合成。敵弾を相殺しながら敵前線を押し潰す巨大雪崩キャノン！'
    },
    COCYTUS_DRAKE: {
        id: 'chimera_cocytus', name: 'COCYTUS', displayName: '氷竜 コキュートス・ドレイク',
        pairHint: 'シュトゥルム ライス ＋ フロスト ライス ＋ コーラ ランツェ (計3体)',
        recipe: (t, s) => (
            t.typeKey === 'RICE_BURST' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.includes('RICE_FROST') &&
            s.typeKey === 'COLA_PIERCE'
        ),
        hp: 180, power: 20, cooldown: 0.7, fireTypes: ['burst'], actions: ['frost', 'pierce'], pierceCount: 5,
        desc: '【No.016 シークレット】連射稲に氷結稲と貫通コーラを合成。敵弾を消滅させながら敵列を貫く氷竜の3連凍結レーザー！'
    },
    FREEZE_NEBULA: {
        id: 'chimera_freeze_nebula', name: 'FREEZE', displayName: '凍穴 フリージング・ネビュラ',
        pairHint: 'ギフト ライス ＋ フロスト ライス ＋ コーラ ネビュラ (計3体)',
        recipe: (t, s) => (
            t.typeKey === 'RICE_POISON' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.includes('RICE_FROST') &&
            s.typeKey === 'COLA_BLACK'
        ),
        hp: 207, power: 18, cooldown: 1.5, fireTypes: ['8dir'], actions: ['frost', 'blackhole'], manaGen: 0.15,
        desc: '【No.017 シークレット】毒稲に氷結稲と重力黒コーラを合成。敵弾を凍らせて吸い込み消滅させ、自軍マナに大変換！'
    },
    AURORA_PHANTOM: {
        id: 'chimera_aurora', name: 'AURORA', displayName: '極光 オーロラ・ファントム',
        pairHint: 'イェーガー ライス ＋ フロスト ライス ＋ コーラ ジャンパー (計3体)',
        recipe: (t, s) => (
            t.typeKey === 'RICE_SEEKER' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.includes('RICE_FROST') &&
            s.typeKey === 'COLA_BOUNCE'
        ),
        hp: 171, power: 22, cooldown: 1.1, fireTypes: ['homing2'], actions: ['frost', 'bounce', 'homing'],
        desc: '【No.018 シークレット】追尾稲に氷結稲と跳弾コーラを合成。壁を反射しながら敵弾を相殺し、相手本体へ迫る幻影氷弾！'
    },
    FROST_GENESIS: {
        id: 'chimera_frost_genesis', name: 'FROST-GEN', displayName: '氷聖樹 フロスト・ジェネシス',
        pairHint: 'アウラ シルト ＋ フロスト ライス ＋ ソーダ オツェアーン (計3体)',
        recipe: (t, s) => (
            t.typeKey === 'RICE_SHIELD_MAGIC' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.includes('RICE_FROST') &&
            s.typeKey === 'SODA_LARGE'
        ),
        hp: 432, power: 0, cooldown: 2.0, fireTypes: ['none'], isManaProducer: true, manaGen: 0.25, actions: ['frost'],
        desc: '【No.019 シークレット】魔力盾に氷結稲と大海ソーダを合成。触れた敵弾を完全凍結相殺しつつ味方リジェネ＆マナ超生成！'
    },
    NIFLHEIM_GOD: {
        id: 'chimera_niflheim', name: 'NIFLHEIM', displayName: '氷獄神 ニヴルヘイム',
        pairHint: 'フロスト ライス×2 ＋ コーラ バルカン (計3体)',
        recipe: (t, s) => (
            t.typeKey === 'RICE_FROST' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.filter(k => k === 'RICE_FROST').length >= 1 &&
            s.typeKey === 'COLA_CHARGE'
        ),
        hp: 234, power: 35, cooldown: 1.3, fireTypes: ['circle6'], actions: ['frost', 'charge', 'spread'],
        desc: '【No.020 シークレット】氷結稲2体に火山コーラを合成。敵弾相殺時に周囲へ極大の絶対零度カウンター氷爆を炸裂！'
    },

    // ===============================================================
    // ⚡ 既存厳格キメラ (追加強化枠)
    // ===============================================================
    VOLTEC_LASER: {
        id: 'chimera_voltec', name: 'VOLTEC', displayName: '迅雷 ルクス・ヴォルテック',
        pairHint: 'ルクス ライス×2 ＋ コーラ ブリッツ (計3体)',
        recipe: (t, s) => (
            t.typeKey === 'RICE_LASER' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.filter(k => k === 'RICE_LASER').length >= 1 &&
            s.typeKey === 'COLA_STRAIGHT'
        ),
        hp: 171, power: 28, cooldown: 1.0, fireTypes: ['single'], actions: ['laser', 'straight'], pierceCount: 5,
        desc: '【シークレットキメラ】光の稲2体に電撃コーラを合成。全てを貫く極太の高圧雷光レーザーを一閃照射。'
    },
    HADES_POISON: {
        id: 'chimera_hades', name: 'HADES', displayName: '冥府 ハデス・ポイズン',
        pairHint: 'ギフト ライス ＋ コーラ ランツェ ＋ コーラ ネビュラ (計3体)',
        recipe: (t, s) => (
            t.typeKey === 'RICE_POISON' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.includes('COLA_PIERCE') &&
            s.typeKey === 'COLA_BLACK'
        ),
        hp: 180, power: 22, cooldown: 1.2, fireTypes: ['circle6'], actions: ['poison', 'pierce', 'blackhole'], pierceCount: 4,
        desc: '【シークレットキメラ】毒稲に貫通と黒コーラを合成。敵列を貫き敵弾を弱体化＆吸引する冥界の弾幕。'
    },
    TYPHOON_GEYSER: {
        id: 'chimera_typhoon', name: 'TYPHOON', displayName: '暴風 タイフーン・ゲイザー',
        pairHint: 'シュトゥルム ライス ＋ コーラ ゲイザー ＋ コーラ ジャンパー (計3体)',
        recipe: (t, s) => (
            t.typeKey === 'RICE_BURST' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.includes('COLA_MENTOS') &&
            s.typeKey === 'COLA_BOUNCE'
        ),
        hp: 171, power: 19, cooldown: 0.7, fireTypes: ['burst'], actions: ['geyser', 'bounce'],
        desc: '【シークレットキメラ】連射稲にゲイザーと跳弾コーラを合成。激しく跳ね回る暴走炭酸弾を乱れ撃つ。'
    },
    EMPEROR_SHIELD: {
        id: 'chimera_emperor', name: 'EMPEROR', displayName: '天帝 エンペラー・シルト',
        pairHint: 'アウラ シルト ＋ アイゼン シルト ＋ コーラ ギガント (計3体)',
        recipe: (t, s) => (
            t.typeKey === 'RICE_SHIELD_MAGIC' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.includes('RICE_SHIELD_IRON') &&
            s.typeKey === 'COLA_MEGATON'
        ),
        hp: 612, power: 26, cooldown: 2.0, fireTypes: ['burst'], actions: ['megaton', 'spread'],
        desc: '【シークレットキメラ】魔力盾に鉄盾と巨大コーラを合成。前線で不動の要塞となり着弾時に巨大衝撃波を炸裂。'
    },
    MIRAGE_SNIPER: {
        id: 'chimera_mirage', name: 'MIRAGE', displayName: '幻影 ミラージュ・スナイパー',
        pairHint: 'プレツィザ ライス×2 ＋ コーラ ジャンパー (計3体)',
        recipe: (t, s) => (
            t.typeKey === 'RICE_SNIPER' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.filter(k => k === 'RICE_SNIPER').length >= 1 &&
            s.typeKey === 'COLA_BOUNCE'
        ),
        hp: 162, power: 30, cooldown: 1.4, fireTypes: ['single'], actions: ['sniper', 'bounce'],
        desc: '【シークレットキメラ】狙撃稲2体に跳弾コーラを合成。壁を反射しながら敵プレイヤーの死角を突く幻影狙撃。'
    },
    FLORA_FRAGMENT: {
        id: 'chimera_flora', name: 'FLORA', displayName: '百花 プリムス・フラグメント',
        pairHint: 'ライス プリムス×2 ＋ コーラ フラグメント (計3体)',
        recipe: (t, s) => (
            t.typeKey === 'RICE_BASIC' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.filter(k => k === 'RICE_BASIC').length >= 1 &&
            s.typeKey === 'COLA_SPLIT'
        ),
        hp: 171, power: 18, cooldown: 1.1, fireTypes: ['8dir'], actions: ['split'],
        desc: '【シークレットキメラ】基本稲2体に分裂コーラを合成。放たれた全方向米粒が空中で一斉に花咲くように分裂。'
    },
    VORTEX_QUELLE: {
        id: 'chimera_vortex', name: 'VORTEX', displayName: '深淵 ボルテックス・クヴェレ',
        pairHint: 'ソーダ クヴェレ ＋ ソーダ ブリーゼ ＋ コーラ ネビュラ (計3体)',
        recipe: (t, s) => (
            t.typeKey === 'SODA_MEDIUM' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.includes('SODA_SMALL') &&
            s.typeKey === 'COLA_BLACK'
        ),
        hp: 270, power: 0, cooldown: 2.0, fireTypes: ['none'], isManaProducer: true, manaGen: 0.20,
        desc: '【シークレットキメラ】源泉ソーダに小ソーダと黒コーラを合成。敵弾を吸い込んで即座に大量マナへ変換。'
    },
    PROMINENCE_VULCAN: {
        id: 'chimera_prominence', name: 'PROMINENCE', displayName: '紅蓮 プロミネンス・バルカン',
        pairHint: 'ルクス ライス ＋ コーラ バルカン ＋ コーラ ノヴァ (計3体)',
        recipe: (t, s) => (
            t.typeKey === 'RICE_LASER' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.includes('COLA_CHARGE') &&
            s.typeKey === 'COLA_SPREAD'
        ),
        hp: 189, power: 34, cooldown: 1.6, fireTypes: ['single'], actions: ['laser', 'charge', 'spread'],
        desc: '【シークレットキメラ】光の稲に火山と爆散コーラを合成。チャージエネルギーを解き放つ極大の熱線ブラスター。'
    },
    GAIA_HARVEST: {
        id: 'chimera_gaia', name: 'GAIA', displayName: '豊穣 ガイア・ハーベスト',
        pairHint: 'ホルツ シルト×2 ＋ ソーダ ブリーゼ (計3体)',
        recipe: (t, s) => (
            t.typeKey === 'RICE_SHIELD_WOOD' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.filter(k => k === 'RICE_SHIELD_WOOD').length >= 1 &&
            s.typeKey === 'SODA_SMALL'
        ),
        hp: 360, power: 0, cooldown: 2.0, fireTypes: ['none'], isManaProducer: true, manaGen: 0.12,
        desc: '【シークレットキメラ】木盾2体に微風ソーダを合成。前線を強固に守りながらマナを継続供給。'
    },
    INAMU_THE_END: {
        id: 'chimera_the_end', name: 'SOL', displayName: '太陽神 アルティメット・いなむー・ソル',
        pairHint: '基本稲 → ①電撃コーラ → ②微風ソーダ → ③光の稲 の順で合成 (計4体)',
        recipe: (t, s) => (
            t.typeKey === 'RICE_BASIC' &&
            Array.isArray(t.extractionHistory) &&
            t.extractionHistory.length === 2 &&
            t.extractionHistory[0] === 'COLA_STRAIGHT' &&
            t.extractionHistory[1] === 'SODA_SMALL' &&
            s.typeKey === 'RICE_LASER'
        ),
        hp: 360, power: 32, cooldown: 0.7, fireTypes: ['8dir', 'burst'], actions: ['bounce', 'spread', 'laser'],
        desc: '【No.010 太陽神】基本稲に電撃コーラ・ソーダ・光の稲を完全な順番で合成した時降臨する黄金の最高神。'
    }
};



function generateSprites() {
    const types = ['bullet', 'player_left', 'player_right', 'scarecrow', ...Object.keys(UNIT_TYPES)];

    types.forEach(type => {
        const c = document.createElement('canvas');
        c.width = 32; c.height = 32;
        const x = c.getContext('2d');
        x.imageSmoothingEnabled = false;

        if (type === 'bullet') {
            x.fillStyle = '#fff'; x.beginPath(); x.arc(16, 16, 4, 0, Math.PI * 2); x.fill();
        } else if (type === 'player_left') {
            // 32x32 高精細ドット絵: いなむー戦士（緑/金）
            // 影/オーラ
            x.fillStyle = 'rgba(0, 255, 120, 0.2)';
            x.beginPath(); x.ellipse(16, 30, 10, 3, 0, 0, Math.PI * 2); x.fill();
            
            // クローク/体 (32x32)
            x.fillStyle = '#1e7b34';
            x.fillRect(9, 14, 14, 14); // 胴体
            x.fillStyle = '#2ecc71';
            x.fillRect(11, 15, 10, 12); // 服のハイライト
            x.fillStyle = '#f1c40f';
            x.fillRect(15, 15, 2, 12); // 金の縦ライン飾り

            // 頭/帽子
            x.fillStyle = '#ffeaa7';
            x.fillRect(11, 7, 10, 8); // 顔
            x.fillStyle = '#2d3436';
            x.fillRect(13, 10, 2, 3); // 左目
            x.fillRect(17, 10, 2, 3); // 右目
            x.fillStyle = '#fff';
            x.fillRect(13, 10, 1, 1); // 目のハイライト
            x.fillRect(17, 10, 1, 1);

            // 稲の飾り羽帽子
            x.fillStyle = '#27ae60';
            x.fillRect(8, 4, 16, 4); // 帽子のつば
            x.fillStyle = '#f39c12';
            x.beginPath();
            x.moveTo(20, 4); x.lineTo(26, -2); x.lineTo(24, 6); x.fill(); // 金の稲穂飾り

            // 腕/手
            x.fillStyle = '#27ae60';
            x.fillRect(6, 16, 4, 8); // 左腕
            x.fillRect(22, 16, 4, 8); // 右腕
            x.fillStyle = '#ffeaa7';
            x.fillRect(6, 23, 4, 3); // 手
            x.fillRect(22, 23, 4, 3);

            // 足/ブーツ
            x.fillStyle = '#2c3e50';
            x.fillRect(10, 27, 4, 5);
            x.fillRect(18, 27, 4, 5);
            x.fillStyle = '#f39c12';
            x.fillRect(9, 29, 5, 3);
            x.fillRect(18, 29, 5, 3);

        } else if (type === 'player_right') {
            // 32x32 高精細ドット絵: コーラ戦士（赤/濃茶）
            // 影/オーラ
            x.fillStyle = 'rgba(255, 50, 50, 0.2)';
            x.beginPath(); x.ellipse(16, 30, 10, 3, 0, 0, Math.PI * 2); x.fill();

            // クローク/体 (32x32)
            x.fillStyle = '#8b0000';
            x.fillRect(9, 14, 14, 14); // 胴体
            x.fillStyle = '#e74c3c';
            x.fillRect(11, 15, 10, 12); // 服
            x.fillStyle = '#fff';
            x.fillRect(12, 19, 8, 3); // コーラ風ロゴ白ライン

            // 頭
            x.fillStyle = '#ffeaa7';
            x.fillRect(11, 7, 10, 8); // 顔
            x.fillStyle = '#2d3436';
            x.fillRect(13, 10, 2, 3); // 左目
            x.fillRect(17, 10, 2, 3); // 右目
            x.fillStyle = '#ff7675';
            x.fillRect(13, 11, 2, 1); // 鋭い目つき

            // 王冠/キャップ
            x.fillStyle = '#c0392b';
            x.fillRect(8, 4, 16, 4); // つば
            x.fillStyle = '#bdc3c7';
            x.fillRect(12, 1, 8, 4); // 王冠/キャップ
            x.fillStyle = '#f1c40f';
            x.fillRect(14, 2, 4, 2); // 金のエンブレム

            // 腕/手
            x.fillStyle = '#c0392b';
            x.fillRect(6, 16, 4, 8);
            x.fillRect(22, 16, 4, 8);
            x.fillStyle = '#ffeaa7';
            x.fillRect(6, 23, 4, 3);
            x.fillRect(22, 23, 4, 3);

            // 足/ブーツ
            x.fillStyle = '#2c3e50';
            x.fillRect(10, 27, 4, 5);
            x.fillRect(18, 27, 4, 5);
            x.fillStyle = '#962d22';
            x.fillRect(9, 29, 5, 3);
            x.fillRect(18, 29, 5, 3);

        } else if (type === 'scarecrow') {
            // 32x32 高精細ドット絵: 練習場のカカシ (Scarecrow)
            // 影
            x.fillStyle = 'rgba(0, 0, 0, 0.3)';
            x.beginPath(); x.ellipse(16, 30, 8, 3, 0, 0, Math.PI * 2); x.fill();

            // 木の支柱 (十字架)
            x.fillStyle = '#5c3a18';
            x.fillRect(14, 4, 4, 28); // 縦の柱
            x.fillRect(4, 13, 24, 4); // 横の柱
            x.fillStyle = '#7a4f24';
            x.fillRect(15, 4, 2, 28);
            x.fillRect(4, 14, 24, 2);

            // 麻袋の頭
            x.fillStyle = '#d7b884';
            x.beginPath(); x.arc(16, 10, 6, 0, Math.PI * 2); x.fill();
            x.fillStyle = '#222';
            // × × の目
            x.fillRect(13, 9, 2, 2); x.fillRect(17, 9, 2, 2);
            // 縫い目の口
            x.fillRect(14, 13, 4, 1);

            // 麦わら帽子
            x.fillStyle = '#f39c12';
            x.beginPath(); x.ellipse(16, 5, 11, 3, 0, 0, Math.PI * 2); x.fill();
            x.fillStyle = '#d35400';
            x.fillRect(11, 2, 10, 4); // 頭頂部
            x.fillStyle = '#c0392b';
            x.fillRect(11, 5, 10, 1); // 赤いリボン

            // 服 (青いボロ布)
            x.fillStyle = '#2980b9';
            x.fillRect(10, 15, 12, 12);
            x.fillStyle = '#3498db';
            x.fillRect(11, 16, 5, 6);
            // つぎはぎパッチ
            x.fillStyle = '#e67e22';
            x.fillRect(17, 19, 4, 4);
            x.strokeStyle = '#fff'; x.lineWidth = 0.5; x.strokeRect(17, 19, 4, 4);

            // 藁の飛び出し
            x.fillStyle = '#f1c40f';
            x.fillRect(3, 14, 3, 2);
            x.fillRect(26, 14, 3, 2);
            x.fillRect(13, 26, 6, 3);

        } else if (UNIT_TYPES[type]) {
            const u = UNIT_TYPES[type];

            if (type.includes('SHIELD')) {
                if (type.includes('WOOD')) {
                    x.fillStyle = '#8b5a2b'; x.fillRect(6, 6, 20, 24);
                    x.strokeStyle = '#5c3a18'; x.lineWidth = 2; x.strokeRect(6, 6, 20, 24);
                    x.fillStyle = '#5c3a18'; x.fillRect(6, 14, 20, 2); x.fillRect(6, 22, 20, 2);
                } else if (type.includes('IRON')) {
                    x.fillStyle = '#888'; x.beginPath(); x.moveTo(6, 4); x.lineTo(26, 4); x.lineTo(28, 20); x.lineTo(16, 30); x.lineTo(4, 20); x.closePath(); x.fill();
                    x.strokeStyle = '#444'; x.lineWidth = 2; x.stroke();
                    x.fillStyle = '#aaa'; x.beginPath(); x.arc(16, 14, 6, 0, Math.PI * 2); x.fill();
                } else if (type.includes('MAGIC')) {
                    x.fillStyle = 'rgba(0, 200, 255, 0.4)'; x.beginPath(); x.arc(16, 16, 14, 0, Math.PI * 2); x.fill();
                    x.strokeStyle = '#0ff'; x.lineWidth = 2; x.beginPath(); x.arc(16, 16, 14, 0, Math.PI * 2); x.stroke();
                    x.fillStyle = '#fff'; x.beginPath(); x.moveTo(16, 8); x.lineTo(24, 16); x.lineTo(16, 24); x.lineTo(8, 16); x.closePath(); x.fill();
                    x.strokeStyle = '#fff'; x.stroke();
                }
            } else if (u.type === 'rice') {
                x.fillStyle = '#8b5a2b'; x.fillRect(15, 6, 2, 22); // 茎
                x.fillStyle = '#228b22';

                if (type.includes('SPREAD')) {
                    x.beginPath(); x.moveTo(16, 26); x.lineTo(4, 10); x.lineTo(28, 10); x.fill(); // ワイド
                    x.fillStyle = '#f80'; x.beginPath(); x.arc(16, 10, 6, 0, Math.PI); x.fill();
                } else if (type.includes('SEEKER')) {
                    x.fillRect(12, 18, 8, 4); x.fillStyle = '#0df'; x.beginPath(); x.arc(16, 8, 6, 0, Math.PI * 2); x.fill(); // レーダー調
                    x.strokeStyle = '#fff'; x.lineWidth = 1; x.stroke();
                } else if (type.includes('BURST')) {
                    x.fillRect(10, 15, 12, 6); x.fillStyle = '#f00'; x.fillRect(12, 6, 3, 12); x.fillRect(17, 6, 3, 12); // 重武装
                } else if (type.includes('LASER')) {
                    // ルクス ライス（クリスタル光線）
                    x.fillStyle = '#0ff'; x.fillRect(14, 4, 4, 20);
                    x.fillStyle = '#fff'; x.beginPath(); x.moveTo(16, 2); x.lineTo(22, 12); x.lineTo(16, 22); x.lineTo(10, 12); x.fill();
                    x.strokeStyle = '#0df'; x.lineWidth = 1; x.stroke();
                } else if (type.includes('POISON')) {
                    // ギフト ライス（毒胞子）
                    x.fillStyle = '#8e44ad'; x.beginPath(); x.arc(16, 10, 8, 0, Math.PI * 2); x.fill();
                    x.fillStyle = '#2ecc71'; x.fillRect(12, 8, 3, 3); x.fillRect(18, 12, 3, 3);
                    x.fillStyle = '#9b59b6'; x.fillRect(13, 18, 6, 8);
                } else if (type.includes('FROST')) {
                    // フロスト ライス（氷結）
                    x.fillStyle = '#74b9ff'; x.beginPath(); x.moveTo(16, 2); x.lineTo(24, 14); x.lineTo(16, 26); x.lineTo(8, 14); x.fill();
                    x.fillStyle = '#dfe6e9'; x.fillRect(14, 6, 4, 16);
                    x.strokeStyle = '#0984e3'; x.lineWidth = 1; x.stroke();
                } else if (type.includes('SNIPER')) {
                    // プレツィザ ライス（狙撃）
                    x.fillStyle = '#2d3436'; x.fillRect(14, 2, 4, 24); // ロングバレル
                    x.fillStyle = '#f1c40f'; x.fillRect(12, 16, 8, 10); // 金の台座
                    x.fillStyle = '#ff7675'; x.fillRect(15, 4, 2, 2); // 照準スコープ
                } else {
                    x.fillRect(12, 18, 8, 4); x.fillStyle = '#fd0';
                    x.beginPath(); x.moveTo(16, 4); x.lineTo(10, 14); x.lineTo(22, 14); x.fill(); // スタンダード穂
                }
            } else if (u.type === 'cola') {
                let liquidColor = '#410'; let labelColor = '#f00'; let capColor = '#ccc';
                if (type.includes('BOUNCE')) { liquidColor = '#050'; labelColor = '#0f0'; capColor = '#afa'; }
                else if (type.includes('SPLIT')) { liquidColor = '#005'; labelColor = '#00f'; capColor = '#aaf'; }
                else if (type.includes('CHARGE')) { liquidColor = '#600'; labelColor = '#ff0'; capColor = '#ff8'; }
                else if (type.includes('PIERCE')) { liquidColor = '#530'; labelColor = '#f90'; capColor = '#fca'; }
                else if (type.includes('SPREAD')) { liquidColor = '#055'; labelColor = '#0ff'; capColor = '#bff'; }
                else if (type.includes('MEGATON')) { liquidColor = '#111'; labelColor = '#c0392b'; capColor = '#7f8c8d'; }
                else if (type.includes('BLACK')) { liquidColor = '#0a001a'; labelColor = '#8e44ad'; capColor = '#9b59b6'; }
                else if (type.includes('MENTOS')) { liquidColor = '#00cec9'; labelColor = '#ffffff'; capColor = '#e17055'; }
                else if (type.includes('ZERO')) { liquidColor = '#2d3436'; labelColor = '#dfe6e9'; capColor = '#b2bec3'; }

                if (type.includes('MEGATON')) {
                    // ギガント（巨大重厚缶）
                    x.fillStyle = 'rgba(255, 255, 255, 0.5)'; x.fillRect(6, 6, 20, 24);
                    x.fillStyle = liquidColor; x.fillRect(7, 8, 18, 20);
                    x.fillStyle = labelColor; x.fillRect(7, 13, 18, 10);
                    x.fillStyle = '#ffd700'; x.font = `8px ${GAME_FONT}`; x.fillText('G', 13, 21);
                    x.fillStyle = capColor; x.fillRect(10, 4, 12, 3);
                    x.strokeStyle = '#fff'; x.lineWidth = 1; x.strokeRect(6, 6, 20, 24);
                } else if (type.includes('BLACK')) {
                    // ネビュラ（重力黒コーラ）
                    x.fillStyle = 'rgba(100, 0, 150, 0.4)'; x.fillRect(10, 10, 12, 18);
                    x.fillStyle = liquidColor; x.fillRect(11, 12, 10, 15);
                    x.fillStyle = '#8e44ad'; x.beginPath(); x.arc(16, 19, 4, 0, Math.PI * 2); x.fill();
                    x.fillStyle = '#000'; x.beginPath(); x.arc(16, 19, 2, 0, Math.PI * 2); x.fill();
                    x.fillStyle = capColor; x.fillRect(13, 7, 6, 3);
                    x.strokeStyle = '#a29bfe'; x.lineWidth = 1; x.strokeRect(10, 10, 12, 18);
                } else if (type.includes('MENTOS')) {
                    // ゲイザー（メントスコーラ・噴射）
                    x.fillStyle = 'rgba(255, 255, 255, 0.5)'; x.fillRect(10, 12, 12, 16);
                    x.fillStyle = liquidColor; x.fillRect(11, 13, 10, 14);
                    x.fillStyle = '#fff'; x.fillRect(11, 17, 10, 6);
                    // 噴き出す泡
                    x.fillStyle = 'rgba(255, 255, 255, 0.8)';
                    x.beginPath(); x.arc(16, 8, 4, 0, Math.PI * 2); x.fill();
                    x.beginPath(); x.arc(14, 4, 3, 0, Math.PI * 2); x.fill();
                    x.beginPath(); x.arc(18, 5, 2, 0, Math.PI * 2); x.fill();
                    x.strokeStyle = '#00cec9'; x.lineWidth = 1; x.strokeRect(10, 12, 12, 16);
                } else {
                    x.fillStyle = 'rgba(255, 255, 255, 0.4)'; x.fillRect(10, 10, 12, 18); // ボトル本体
                    x.fillStyle = liquidColor; x.fillRect(11, 12, 10, 15); // 中身
                    x.fillStyle = labelColor; x.fillRect(11, 16, 10, 6); // ラベル
                    x.fillStyle = capColor; x.fillRect(13, 7, 6, 3); // キャップ
                    x.strokeStyle = '#fff'; x.lineWidth = 1; x.strokeRect(10, 10, 12, 18);
                }
            } else if (u.type === 'soda') {
                let baseColor = 'rgba(100, 200, 255, 0.4)';
                if (type.includes('MEDIUM')) baseColor = 'rgba(100, 255, 200, 0.4)';
                if (type.includes('LARGE')) baseColor = 'rgba(200, 200, 255, 0.5)';

                x.fillStyle = baseColor; x.beginPath(); x.ellipse(16, 18, 8, 12, 0, 0, Math.PI * 2); x.fill(); // 缶/瓶
                x.fillStyle = '#fff'; x.globalAlpha = 0.6;
                x.fillRect(14, 12, 2, 2); x.fillRect(18, 18, 2, 2); x.fillRect(14, 24, 2, 2); // 泡
                x.globalAlpha = 1.0;
                x.fillStyle = '#05f'; x.fillRect(12, 6, 8, 3); // プルタブ
            }
        }
        // すべてのスプライト（プレイヤー・カカシ・弾・各ユニット）を登録
        ASSETS[type] = c;
    });

    // 🌟 シークレット特殊進化キメラ (全10種) の32x32ピクセルアート生成
    Object.keys(SECRET_CHIMERAS).forEach(k => {
        const chimera = SECRET_CHIMERAS[k];
        const c = document.createElement('canvas');
        c.width = 32; c.height = 32;
        const x = c.getContext('2d');
        x.imageSmoothingEnabled = false;

        // 背景オーラ
        x.fillStyle = 'rgba(255, 215, 0, 0.25)';
        x.beginPath(); x.arc(16, 16, 15, 0, Math.PI * 2); x.fill();

        if (chimera.id === 'chimera_gatling') {
            // ガトリング・スプライト (重機関銃＋稲)
            x.fillStyle = '#2c3e50'; x.fillRect(8, 10, 16, 14);
            x.fillStyle = '#7f8c8d'; x.fillRect(4, 12, 8, 3); x.fillRect(4, 17, 8, 3); x.fillRect(4, 22, 8, 3);
            x.fillStyle = '#2ecc71'; x.beginPath(); x.moveTo(16, 2); x.lineTo(24, 10); x.lineTo(16, 10); x.fill();
            x.fillStyle = '#f1c40f'; x.fillRect(18, 6, 8, 6);
        } else if (chimera.id === 'chimera_meteor') {
            // クラスター・ミーティア (彗星爆破)
            x.fillStyle = '#e74c3c'; x.beginPath(); x.arc(16, 16, 11, 0, Math.PI * 2); x.fill();
            x.fillStyle = '#f39c12'; x.beginPath(); x.arc(16, 16, 7, 0, Math.PI * 2); x.fill();
            x.fillStyle = '#fff'; x.beginPath(); x.arc(14, 13, 3, 0, Math.PI * 2); x.fill();
            x.strokeStyle = '#c0392b'; x.lineWidth = 2; x.stroke();
        } else if (chimera.id === 'chimera_phantom') {
            // イェーガー・ファントム (幽霊狙撃)
            x.fillStyle = 'rgba(155, 89, 182, 0.8)';
            x.beginPath(); x.moveTo(16, 3); x.lineTo(28, 25); x.lineTo(16, 20); x.lineTo(4, 25); x.closePath(); x.fill();
            x.fillStyle = '#00ffff'; x.fillRect(14, 10, 4, 4);
        } else if (chimera.id === 'chimera_volcano') {
            // ヴォルケイノ・フォートレス (要塞)
            x.fillStyle = '#4a235a'; x.fillRect(4, 4, 24, 24);
            x.fillStyle = '#e67e22'; x.fillRect(8, 8, 16, 16);
            x.fillStyle = '#e74c3c'; x.fillRect(12, 12, 8, 8);
            x.strokeStyle = '#f39c12'; x.lineWidth = 2; x.strokeRect(4, 4, 24, 24);
        } else if (chimera.id === 'chimera_nebula') {
            // ネビュラ・ハーベスター (特異点)
            x.fillStyle = '#0b0c10'; x.beginPath(); x.arc(16, 16, 12, 0, Math.PI * 2); x.fill();
            x.fillStyle = '#66fcf1'; x.beginPath(); x.arc(16, 16, 6, 0, Math.PI * 2); x.fill();
            x.strokeStyle = '#c5a880'; x.lineWidth = 2; x.beginPath(); x.ellipse(16, 16, 14, 4, Math.PI / 4, 0, Math.PI * 2); x.stroke();
        } else if (chimera.id === 'chimera_dragoon') {
            // 零式ドラグーン (レールガン竜)
            x.fillStyle = '#bdc3c7'; x.beginPath(); x.moveTo(16, 2); x.lineTo(30, 26); x.lineTo(16, 18); x.lineTo(2, 26); x.closePath(); x.fill();
            x.fillStyle = '#3498db'; x.fillRect(14, 4, 4, 18);
            x.fillStyle = '#f1c40f'; x.fillRect(12, 10, 8, 3);
        } else if (chimera.id === 'chimera_titan') {
            // メガリス・タイタン (巨神)
            x.fillStyle = '#34495e'; x.fillRect(4, 4, 24, 24);
            x.fillStyle = '#7f8c8d'; x.fillRect(7, 7, 18, 18);
            x.fillStyle = '#e74c3c'; x.fillRect(12, 10, 8, 4); // バイザー
            x.strokeStyle = '#f1c40f'; x.lineWidth = 2; x.strokeRect(4, 4, 24, 24);
        } else if (chimera.id === 'chimera_frost') {
            // フロスト・ノヴァ (極光)
            x.fillStyle = 'rgba(116, 185, 255, 0.9)';
            for (let i = 0; i < 6; i++) {
                const ang = (Math.PI * 2 / 6) * i;
                x.beginPath(); x.moveTo(16, 16); x.lineTo(16 + Math.cos(ang) * 14, 16 + Math.sin(ang) * 14);
                x.lineWidth = 3; x.strokeStyle = '#74b9ff'; x.stroke();
            }
            x.fillStyle = '#fff'; x.beginPath(); x.arc(16, 16, 5, 0, Math.PI * 2); x.fill();
        } else if (chimera.id === 'chimera_genesis') {
            // アウラ・ジェネシス (生命樹)
            x.fillStyle = '#27ae60'; x.beginPath(); x.arc(16, 12, 10, 0, Math.PI * 2); x.fill();
            x.fillStyle = '#f1c40f'; x.fillRect(13, 8, 6, 6);
            x.fillStyle = '#795548'; x.fillRect(13, 20, 6, 10);
            x.strokeStyle = '#2ecc71'; x.lineWidth = 2; x.beginPath(); x.arc(16, 12, 12, 0, Math.PI * 2); x.stroke();
        } else if (chimera.id === 'chimera_the_end') {
            // 太陽神 いなむー・ソル (神話の太陽神)
            const grad = x.createRadialGradient(16, 16, 2, 16, 16, 15);
            grad.addColorStop(0, '#ffffff');
            grad.addColorStop(0.4, '#ffd700');
            grad.addColorStop(1, '#ff4500');
            x.fillStyle = grad;
            x.beginPath(); x.arc(16, 16, 14, 0, Math.PI * 2); x.fill();
            x.fillStyle = '#fff'; x.font = `12px ${GAME_FONT}`; x.fillText('☀', 10, 20);
            x.strokeStyle = '#ffd700'; x.lineWidth = 2; x.stroke();
        } else if (chimera.id === 'chimera_zero_frost') {
            // 絶対零度 アブソリュート・ゼロ
            x.fillStyle = '#0984e3'; x.beginPath(); x.arc(16, 16, 12, 0, Math.PI * 2); x.fill();
            x.fillStyle = '#dfe6e9'; x.fillRect(10, 10, 12, 12);
            x.strokeStyle = '#00cec9'; x.lineWidth = 2; x.strokeRect(10, 10, 12, 12);
        } else if (chimera.id === 'chimera_voltec') {
            // 迅雷 ルクス・ヴォルテック
            x.fillStyle = '#00cec9'; x.fillRect(12, 4, 8, 24);
            x.fillStyle = '#ffeaa7'; x.fillRect(14, 2, 4, 28);
            x.strokeStyle = '#fdcb6e'; x.lineWidth = 2; x.stroke();
        } else if (chimera.id === 'chimera_hades') {
            // 冥府 ハデス・ポイズン
            x.fillStyle = '#2d3436'; x.beginPath(); x.arc(16, 16, 12, 0, Math.PI * 2); x.fill();
            x.fillStyle = '#6c5ce7'; x.fillRect(13, 6, 6, 20);
            x.fillStyle = '#a29bfe'; x.fillRect(8, 14, 16, 4);
        } else if (chimera.id === 'chimera_typhoon') {
            // 暴風 タイフーン・ゲイザー
            x.fillStyle = '#81ecec'; x.beginPath(); x.ellipse(16, 16, 14, 8, Math.PI / 4, 0, Math.PI * 2); x.fill();
            x.fillStyle = '#00cec9'; x.beginPath(); x.arc(16, 16, 6, 0, Math.PI * 2); x.fill();
        } else if (chimera.id === 'chimera_emperor') {
            // 天帝 エンペラー・シルト
            x.fillStyle = '#f1c40f'; x.fillRect(4, 4, 24, 24);
            x.fillStyle = '#2c3e50'; x.fillRect(7, 7, 18, 18);
            x.fillStyle = '#e74c3c'; x.fillRect(12, 10, 8, 8);
            x.strokeStyle = '#fff'; x.lineWidth = 2; x.strokeRect(4, 4, 24, 24);
        } else if (chimera.id === 'chimera_mirage') {
            // 幻影 ミラージュ・スナイパー
            x.fillStyle = 'rgba(108, 92, 231, 0.7)'; x.beginPath(); x.moveTo(16, 2); x.lineTo(28, 28); x.lineTo(4, 28); x.closePath(); x.fill();
            x.fillStyle = '#00d2d3'; x.fillRect(14, 6, 4, 16);
        } else if (chimera.id === 'chimera_flora') {
            // 百花 プリムス・フラグメント
            x.fillStyle = '#ff7675'; x.beginPath(); x.arc(16, 16, 10, 0, Math.PI * 2); x.fill();
            x.fillStyle = '#55efc4'; x.fillRect(14, 12, 4, 12);
            x.fillStyle = '#ffeaa7'; x.beginPath(); x.arc(16, 16, 4, 0, Math.PI * 2); x.fill();
        } else if (chimera.id === 'chimera_vortex') {
            // 深淵 ボルテックス・クヴェレ
            x.fillStyle = '#0984e3'; x.beginPath(); x.arc(16, 16, 13, 0, Math.PI * 2); x.fill();
            x.fillStyle = '#2d3436'; x.beginPath(); x.arc(16, 16, 7, 0, Math.PI * 2); x.fill();
            x.strokeStyle = '#74b9ff'; x.lineWidth = 2; x.beginPath(); x.arc(16, 16, 14, 0, Math.PI); x.stroke();
        } else if (chimera.id === 'chimera_prominence') {
            // 紅蓮 プロミネンス・バルカン
            x.fillStyle = '#d63031'; x.beginPath(); x.arc(16, 16, 13, 0, Math.PI * 2); x.fill();
            x.fillStyle = '#e17055'; x.fillRect(10, 10, 12, 12);
            x.fillStyle = '#ffeaa7'; x.fillRect(13, 13, 6, 6);
        } else if (chimera.id === 'chimera_gaia') {
            // 豊穣 ガイア・ハーベスト
            x.fillStyle = '#27ae60'; x.fillRect(6, 6, 20, 20);
            x.fillStyle = '#795548'; x.fillRect(10, 10, 12, 12);
            x.fillStyle = '#2ecc71'; x.beginPath(); x.arc(16, 16, 4, 0, Math.PI * 2); x.fill();
        } else if (chimera.id === 'chimera_valkyrie') {
            // No.011 ヴァルキリー・ブリザード (氷槍翼)
            x.fillStyle = '#74b9ff'; x.beginPath(); x.moveTo(16, 2); x.lineTo(26, 22); x.lineTo(16, 17); x.lineTo(6, 22); x.closePath(); x.fill();
            x.fillStyle = '#dfe6e9'; x.fillRect(14, 6, 4, 18);
            x.strokeStyle = '#0984e3'; x.lineWidth = 1.5; x.stroke();
        } else if (chimera.id === 'chimera_glacia') {
            // No.012 グレイシア・フォートレス (氷壁鉄砦)
            x.fillStyle = '#0984e3'; x.fillRect(4, 4, 24, 24);
            x.fillStyle = '#74b9ff'; x.fillRect(7, 7, 18, 18);
            x.fillStyle = '#ffffff'; x.fillRect(11, 11, 10, 10);
            x.strokeStyle = '#00cec9'; x.lineWidth = 2; x.strokeRect(4, 4, 24, 24);
        } else if (chimera.id === 'chimera_icicle') {
            // No.013 アイシクル・スナイパー (氷柱狙撃)
            x.fillStyle = '#2d3436'; x.fillRect(13, 2, 6, 26);
            x.fillStyle = '#00cec9'; x.beginPath(); x.moveTo(16, 0); x.lineTo(22, 10); x.lineTo(10, 10); x.fill();
            x.fillStyle = '#74b9ff'; x.fillRect(12, 14, 8, 8);
        } else if (chimera.id === 'chimera_diamond') {
            // No.014 ダイヤモンドダスト・ミーティア (星屑氷晶)
            x.fillStyle = '#81ecec'; x.beginPath(); x.arc(16, 16, 12, 0, Math.PI * 2); x.fill();
            x.fillStyle = '#ffffff'; x.beginPath(); x.moveTo(16, 6); x.lineTo(24, 16); x.lineTo(16, 26); x.lineTo(8, 16); x.closePath(); x.fill();
            x.strokeStyle = '#0984e3'; x.lineWidth = 1.5; x.stroke();
        } else if (chimera.id === 'chimera_avalanche') {
            // No.015 アバランチ・タイタン (雪嶺巨神)
            x.fillStyle = '#2c3e50'; x.fillRect(4, 4, 24, 24);
            x.fillStyle = '#dfe6e9'; x.fillRect(6, 6, 20, 20);
            x.fillStyle = '#0984e3'; x.fillRect(10, 10, 12, 12);
            x.strokeStyle = '#74b9ff'; x.lineWidth = 2; x.strokeRect(4, 4, 24, 24);
        } else if (chimera.id === 'chimera_cocytus') {
            // No.016 コキュートス・ドレイク (氷竜)
            x.fillStyle = '#0984e3'; x.beginPath(); x.moveTo(16, 2); x.lineTo(28, 16); x.lineTo(22, 28); x.lineTo(10, 28); x.lineTo(4, 16); x.closePath(); x.fill();
            x.fillStyle = '#00cec9'; x.fillRect(13, 8, 6, 16);
            x.fillStyle = '#fff'; x.fillRect(14, 4, 4, 4);
        } else if (chimera.id === 'chimera_freeze_nebula') {
            // No.017 フリージング・ネビュラ (凍穴)
            x.fillStyle = '#0a3d62'; x.beginPath(); x.arc(16, 16, 13, 0, Math.PI * 2); x.fill();
            x.fillStyle = '#60a3bc'; x.beginPath(); x.arc(16, 16, 8, 0, Math.PI * 2); x.fill();
            x.fillStyle = '#fff'; x.beginPath(); x.arc(16, 16, 3, 0, Math.PI * 2); x.fill();
        } else if (chimera.id === 'chimera_aurora') {
            // No.018 オーロラ・ファントム (極光幻影)
            x.fillStyle = 'rgba(0, 206, 201, 0.8)'; x.beginPath(); x.ellipse(16, 16, 14, 7, Math.PI / 4, 0, Math.PI * 2); x.fill();
            x.fillStyle = 'rgba(108, 92, 231, 0.8)'; x.beginPath(); x.ellipse(16, 16, 14, 7, -Math.PI / 4, 0, Math.PI * 2); x.fill();
            x.fillStyle = '#fff'; x.fillRect(14, 14, 4, 4);
        } else if (chimera.id === 'chimera_frost_genesis') {
            // No.019 フロスト・ジェネシス (氷聖樹)
            x.fillStyle = '#74b9ff'; x.beginPath(); x.arc(16, 12, 11, 0, Math.PI * 2); x.fill();
            x.fillStyle = '#0984e3'; x.fillRect(13, 18, 6, 12);
            x.fillStyle = '#fff'; x.beginPath(); x.arc(16, 12, 5, 0, Math.PI * 2); x.fill();
            x.strokeStyle = '#dfe6e9'; x.lineWidth = 2; x.beginPath(); x.arc(16, 12, 13, 0, Math.PI * 2); x.stroke();
        } else if (chimera.id === 'chimera_niflheim') {
            // No.020 氷獄神 ニヴルヘイム (絶対零度極神)
            x.fillStyle = '#0c2461'; x.beginPath(); x.arc(16, 16, 14, 0, Math.PI * 2); x.fill();
            x.fillStyle = '#4a69bd'; x.fillRect(8, 8, 16, 16);
            x.fillStyle = '#e55039'; x.beginPath(); x.arc(16, 16, 5, 0, Math.PI * 2); x.fill();
            x.strokeStyle = '#60a3bc'; x.lineWidth = 2; x.strokeRect(8, 8, 16, 16);
        }

        ASSETS[chimera.id] = c;
    });
}
generateSprites();

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
canvas.width = CONFIG.SCREEN_WIDTH;
canvas.height = CONFIG.SCREEN_HEIGHT;
ctx.imageSmoothingEnabled = false;

// 🖼 高解像度描画: キャンバスの中身を「画面に表示されている大きさ」で描く。
// （576×288の小さい絵を引き伸ばすと、拡大率によってドットの太さがそろわず画質が上下していた）
// ゲーム内の座標は今までどおり 576×288 のまま。描くときだけ RENDER_SCALE 倍する
let RENDER_SCALE = 1;
function fitCanvasResolution() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1) return; // 非表示中
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.max(1, Math.min(6, (rect.width * dpr) / CONFIG.SCREEN_WIDTH));
    const w = Math.round(CONFIG.SCREEN_WIDTH * scale);
    const h = Math.round(CONFIG.SCREEN_HEIGHT * scale);
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
    }
    RENDER_SCALE = canvas.width / CONFIG.SCREEN_WIDTH;
    ctx.imageSmoothingEnabled = false; // 大きさを変えると元に戻るので毎回設定
}

// 📷 カメラシステム（拡大・縮小・カメラ移動）
const Camera = {
    x: 0,
    y: 0,
    zoom: 1.0,
    minZoom: 0.5,
    maxZoom: 2.2,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    cameraStartX: 0,
    cameraStartY: 0,

    reset() {
        this.x = 0;
        this.y = 0;
        this.zoom = 1.0;
    },

    zoomIn() {
        this.setZoom(this.zoom * 1.15);
    },

    zoomOut() {
        this.setZoom(this.zoom * 0.87);
    },

    zoomBy(factor) {
        this.setZoom(this.zoom * factor);
    },

    setZoom(val) {
        this.zoom = Math.min(this.maxZoom, Math.max(this.minZoom, val));
    },

    screenToWorld(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = CONFIG.SCREEN_WIDTH / rect.width;
        const scaleY = CONFIG.SCREEN_HEIGHT / rect.height;
        const cssX = (clientX - rect.left) * scaleX;
        const cssY = (clientY - rect.top) * scaleY;

        // キャンバス中心を基準とした逆変換
        const cx = CONFIG.SCREEN_WIDTH / 2;
        const cy = CONFIG.SCREEN_HEIGHT / 2;
        const worldX = (cssX - cx) / this.zoom + cx - this.x;
        const worldY = (cssY - cy) / this.zoom + cy - this.y;
        return { x: worldX, y: worldY };
    },

    // 画面上で1px動かしたとき、ゲーム内で何px動くか（カメラ移動用）
    clientToWorldScale() {
        const rect = canvas.getBoundingClientRect();
        return rect.width > 0 ? CONFIG.SCREEN_WIDTH / rect.width / this.zoom : 1 / this.zoom;
    }
};

const bgCanvas = document.getElementById('bg-canvas');
const bgCtx = bgCanvas.getContext('2d');
let bgParticles = [];

function resizeBg() {
    bgCanvas.width = window.innerWidth;
    bgCanvas.height = window.innerHeight;
}
window.addEventListener('resize', resizeBg);
resizeBg();

class Particle {
    constructor() {
        this.reset();
        this.y = Math.random() * bgCanvas.height;
    }
    reset() {
        this.x = Math.random() * bgCanvas.width;
        this.y = -40;
        this.speed = 1 + Math.random() * 2;
        this.rot = Math.random() * Math.PI * 2;
        this.rotSpeed = (Math.random() - 0.5) * 0.05;
        this.scale = 0.5 + Math.random() * 0.8;
        const keys = Object.keys(ASSETS).filter(k => k !== 'bullet' && !k.startsWith('player_'));
        this.typeKey = keys[Math.floor(Math.random() * keys.length)];
    }
    update() {
        this.y += this.speed;
        this.rot += this.rotSpeed;
        if (this.y > bgCanvas.height + 40) this.reset();
    }
    draw() {
        const spr = ASSETS[this.typeKey];
        if (!spr) return;
        bgCtx.save();
        bgCtx.translate(this.x, this.y);
        bgCtx.rotate(this.rot);
        bgCtx.scale(this.scale, this.scale);
        bgCtx.globalAlpha = 0.6; // 透明度を上げる
        bgCtx.drawImage(spr, -16, -16);
        bgCtx.restore();
    }
}

// DPS 計測システム
const DPSManager = {
    totalDamage: 0,
    startTime: null,
    lastHitTime: null,
    peakDPS: 0,
    recentHits: [], // { time, damage }
    
    reset() {
        this.totalDamage = 0;
        this.startTime = null;
        this.lastHitTime = null;
        this.peakDPS = 0;
        this.recentHits = [];
        this.updateUI(0);
    },
    
    recordDamage(amount) {
        if (amount <= 0) return;
        const now = performance.now();
        if (!this.startTime) this.startTime = now;
        this.lastHitTime = now;
        this.totalDamage += amount;
        this.recentHits.push({ time: now, damage: amount });
        
        // 3秒より古い履歴を削除
        const cutoff = now - 3000;
        this.recentHits = this.recentHits.filter(h => h.time >= cutoff);
        
        // 瞬間DPS計算（直近3秒）
        const recentSum = this.recentHits.reduce((acc, h) => acc + h.damage, 0);
        const windowDuration = Math.min(3, Math.max(0.2, (now - this.recentHits[0].time) / 1000));
        const currentDPS = recentSum / windowDuration;
        
        if (currentDPS > this.peakDPS) {
            this.peakDPS = currentDPS;
        }
        
        this.updateUI(currentDPS);
    },
    
    tick() {
        if (!this.startTime) return;
        const now = performance.now();
        
        // 直近ヒットから4秒以上経過したら0にする
        if (this.lastHitTime && now - this.lastHitTime > 4000) {
            this.recentHits = [];
            this.updateUI(0);
            return;
        }

        const cutoff = now - 3000;
        this.recentHits = this.recentHits.filter(h => h.time >= cutoff);
        
        let currentDPS = 0;
        if (this.recentHits.length > 0) {
            const recentSum = this.recentHits.reduce((acc, h) => acc + h.damage, 0);
            const windowDuration = Math.min(3, Math.max(0.2, (now - this.recentHits[0].time) / 1000));
            currentDPS = recentSum / windowDuration;
        }
        
        this.updateUI(currentDPS);
    },
    
    updateUI(currentDPS = 0) {
        const dpsValEl = document.getElementById('dps-value');
        const dpsPeakEl = document.getElementById('dps-peak');
        const dpsTotalEl = document.getElementById('dps-total-dmg');
        const dpsTimeEl = document.getElementById('dps-time');
        
        if (dpsValEl) dpsValEl.textContent = currentDPS.toFixed(1);
        if (dpsPeakEl) dpsPeakEl.textContent = this.peakDPS.toFixed(1);
        if (dpsTotalEl) dpsTotalEl.textContent = Math.floor(this.totalDamage).toLocaleString();
        
        if (dpsTimeEl) {
            const elapsed = this.startTime ? Math.floor((performance.now() - this.startTime) / 1000) : 0;
            dpsTimeEl.textContent = `${elapsed}s`;
        }
    }
};

// 🎴 デッキ管理システム (最大10枠まで拡張)
const MAX_DECK_SIZE = 10;
const DEFAULT_DECK = ['RICE_BASIC', 'RICE_SEEKER', 'RICE_SHIELD_WOOD', 'COLA_STRAIGHT', 'COLA_BOUNCE', 'SODA_SMALL'];

const DeckManager = {
    currentDeck: [...DEFAULT_DECK],
    tempDeck: [...DEFAULT_DECK],

    init() {
        try {
            const saved = localStorage.getItem('inamu_deck');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length >= 1 && parsed.length <= MAX_DECK_SIZE && parsed.every(k => UNIT_TYPES[k])) {
                    this.currentDeck = parsed;
                }
            }
        } catch (e) {
            this.currentDeck = [...DEFAULT_DECK];
        }
        gameState.deck = this.currentDeck;
        gameState.selectedUnit = this.currentDeck[0] || 'RICE_BASIC';
    },

    openModal() {
        this.tempDeck = [...this.currentDeck];
        this.renderModal();
        const modal = document.getElementById('deck-modal');
        if (modal) modal.classList.remove('hidden');
    },

    closeModal() {
        const modal = document.getElementById('deck-modal');
        if (modal) modal.classList.add('hidden');
    },

    save() {
        if (this.tempDeck.length < 1 || this.tempDeck.length > MAX_DECK_SIZE) {
            alert(`デッキは1〜${MAX_DECK_SIZE}枚で選択してください！`);
            return;
        }
        this.currentDeck = [...this.tempDeck];
        localStorage.setItem('inamu_deck', JSON.stringify(this.currentDeck));
        gameState.deck = this.currentDeck;
        if (!this.currentDeck.includes(gameState.selectedUnit)) {
            gameState.selectedUnit = this.currentDeck[0];
        }
        // ☁️ クラウドにもデッキを同期
        CloudSyncManager.saveDeck(this.currentDeck);
        updateUnitUI();
        this.closeModal();
    },

    reset() {
        this.tempDeck = [...DEFAULT_DECK];
        this.renderModal();
    },

    toggleUnit(key) {
        const idx = this.tempDeck.indexOf(key);
        if (idx >= 0) {
            this.tempDeck.splice(idx, 1);
        } else {
            if (this.tempDeck.length >= MAX_DECK_SIZE) {
                alert(`デッキ枠は最大${MAX_DECK_SIZE}枚です。入れ替えるカードをクリックして外してください。`);
                return;
            }
            this.tempDeck.push(key);
        }
        this.renderModal();
    },

    removeAt(idx) {
        if (this.tempDeck[idx]) {
            this.tempDeck.splice(idx, 1);
            this.renderModal();
        }
    },

    renderModal() {
        const slotsEl = document.getElementById('deck-current-slots');
        const countEl = document.getElementById('deck-count');
        const allEl = document.getElementById('deck-all-units');
        if (!slotsEl || !allEl) return;

        if (countEl) countEl.textContent = this.tempDeck.length;

        // 現在の10スロット描画 (MAX_DECK_SIZE=10枠すべて表示)
        slotsEl.innerHTML = '';
        for (let i = 0; i < MAX_DECK_SIZE; i++) {
            const key = this.tempDeck[i];
            const slot = document.createElement('div');
            slot.className = 'deck-modal-slot';
            slot.style.cssText = 'width: 58px; height: 58px; border: 2px solid ' + (key ? '#0df' : '#444') + '; border-radius: 6px; display: flex; flex-direction: column; align-items: center; justify-content: center; background: ' + (key ? 'rgba(0,100,200,0.3)' : 'rgba(0,0,0,0.3)') + '; cursor: pointer; position: relative; flex-shrink: 0;';

            const numLabel = i === 9 ? '0' : `${i + 1}`;
            if (key && UNIT_TYPES[key]) {
                const u = UNIT_TYPES[key];
                const spr = ASSETS[key];
                let imgTag = spr ? `<img src="${spr.toDataURL()}" style="width: 26px; height: 26px; image-rendering: pixelated;">` : '';
                const nameShort = u.name.replace(/ライス|コーラ|ソーダ|シールド|盾/g, '').trim();
                slot.innerHTML = `
                    <span style="position: absolute; top: 1px; left: 3px; font-size: 0.6rem; color: #ff0; font-weight: bold;">[${numLabel}]</span>
                    <span style="position: absolute; top: 1px; right: 3px; font-size: 0.65rem; color: #f55; font-weight: bold;">✕</span>
                    ${imgTag}
                    <div style="font-size: 0.52rem; color: #fff; margin-top: 1px; white-space: nowrap; overflow: hidden; max-width: 52px; text-overflow: ellipsis;">${nameShort}</div>
                `;
                slot.onclick = () => this.removeAt(i);
            } else {
                slot.innerHTML = `<span style="font-size: 0.65rem; color: #666;">枠[${numLabel}]</span>`;
            }
            slotsEl.appendChild(slot);
        }

        // 全ユニット一覧描画
        allEl.innerHTML = '';
        Object.keys(UNIT_TYPES).forEach(key => {
            const u = UNIT_TYPES[key];
            const inDeck = this.tempDeck.includes(key);
            const card = document.createElement('div');
            card.style.cssText = 'width: 100px; padding: 6px; border: 2px solid ' + (inDeck ? '#0f0' : '#555') + '; border-radius: 6px; background: ' + (inDeck ? 'rgba(0, 100, 0, 0.4)' : '#222') + '; cursor: pointer; display: flex; flex-direction: column; align-items: center; text-align: center; position: relative; transition: transform 0.1s;';

            const spr = ASSETS[key];
            let imgTag = spr ? `<img src="${spr.toDataURL()}" style="width: 32px; height: 32px; image-rendering: pixelated; margin-bottom: 3px;">` : '';

            card.innerHTML = `
                ${inDeck ? '<span style="position: absolute; top: 2px; right: 4px; font-size: 0.65rem; color: #0f0; font-weight: bold;">✔ 選択中</span>' : ''}
                ${imgTag}
                <div style="font-size: 0.7rem; font-weight: bold; color: #fff; line-height: 1.1;">${u.name}</div>
                <div style="font-size: 0.65rem; color: #fb0; margin-top: 2px;">Cost: ${u.cost}</div>
                <div style="font-size: 0.6rem; color: #aaa; margin-top: 2px; line-height: 1;">${u.type === 'rice' ? 'HP: '+u.hp : (u.type === 'cola' ? '威力: '+u.power : 'マナ: '+u.manaGen)}</div>
            `;
            card.onclick = () => this.toggleUnit(key);
            allEl.appendChild(card);
        });
    }
};

// 🌋 ステージ中央エリアのギミック（削除・無効化済み）
const FieldGimmickManager = {
    fountains: [],
    goldenSheaf: { active: false, hp: 0 },
    portals: [],
    particles: [],
    reset() {},
    update() {},
    draw(ctx) {}
};

// 状態管理
let gameState = {
    isPlaying: false, // 試合中フラグ（false の間はゲーム計算・送信・勝敗判定を止める）
    isHost: false,
    roomId: null,
    playerSide: 'left', // 'left' or 'right'
    players: {
        left: { name: 'Player 1', y: 80, hp: 2000, maxHp: 2000, mana: 100, targetY: 80, throwTimer: 0 },
        right: { name: 'Player 2', y: 80, hp: 2000, maxHp: 2000, mana: 100, targetY: 80, throwTimer: 0 }
    },
    isPractice: false,
    isBotMatch: false, // 強化Bot対戦モード
    cpuDifficulty: 2, // CPU難易度 (1=易しい, 2=普通, 3=難しい, 4=超難, 5=鬼)
    deck: [...DEFAULT_DECK],
    units: [],
    summoningEffects: [], // 召喚アニメーション用
    bullets: [],
    manaTimer: 0,
    selectedUnit: 'RICE_BASIC',
    selectedCola: null, // 発射待機のコーラ
    interactionMode: 'none', // 'place_rice', 'throw_cola'
    mousePos: { x: 0, y: 0 },
    isMatching: false,
    matchTimeoutTimer: null, // スマートマッチング用
    prepTimer: 450, // 15秒 (30FPS * 15)
    spaceFireCooldown: 0, // スペース発射クールダウン（フレーム数）
    extractionMode: false,
    extractionSelections: [], // 選択中のユニット: [target?, source?]
    previewedUnit: null // プレビュー表示中のユニット
};

// オブジェクトプール (弾用)
const bulletPool = [];

// ネットワーク
let socket = null;

// UI 要素
const menuOverlay = document.getElementById('menu');
const gameUI = document.getElementById('game-ui');
const statusMsg = document.getElementById('status-message');


let keysPressed = {};
let suppressCanvasClickUntil = 0; // この時刻まではキャンバスのクリックを無視（タッチの二重処理防止）

// ===============================================================
// 🤖 CPU対戦 AI
// 難易度(1〜5)ごとに「弾よけ・移動・召喚・コーラの狙い・合成」の動きを変える
// ※ CPUはシークレット・最終形態を作らない（processExtraction 側でも止めている）
// ===============================================================
const BOT_LEVELS = {
    // dodge    : 弾よけ (late=気づくのが遅く半分見逃す / react=近い弾を見てよける / predict=弾の進む先を読む)
    // moveSpeed: 移動の速さ (px/フレーム。プレイヤーは4)
    // maxUnits : 盤面に置けるユニット数の上限
    // aimError : コーラの狙いのズレ(px)  lead: 動く先を予測  volley: まとめ撃ち
    // summon   : 召喚の作戦 (basic=盾→ソーダ→攻撃役 / counter=相手の盤面を見て守る行・攻める行を決める)
    // extract  : 合成の作戦 (general=ふつうの強化 / stack=強い攻撃役にまとめる)
    // timers   : 行動の間隔 [召喚, コーラ発射, 合成] (フレーム数。30フレーム = 1秒)
    1: { dodge: 'late',    moveSpeed: 2.5, maxUnits: 10, aimError: 30, lead: false, volley: false, summon: 'basic',   extract: 'general', timers: [45, 60, 80] },
    2: { dodge: 'react',   moveSpeed: 3.0, maxUnits: 13, aimError: 12, lead: false, volley: false, summon: 'basic',   extract: 'stack',   timers: [35, 45, 60] },
    3: { dodge: 'predict', moveSpeed: 3.5, maxUnits: 16, aimError: 0,  lead: true,  volley: false, summon: 'counter', extract: 'stack',   timers: [25, 32, 45], lookahead: 40 },
    4: { dodge: 'predict', moveSpeed: 4.0, maxUnits: 18, aimError: 0,  lead: true,  volley: true,  summon: 'counter', extract: 'stack',   timers: [18, 24, 32], lookahead: 60 },
    5: { dodge: 'predict', moveSpeed: 4.0, maxUnits: 20, aimError: 0,  lead: true,  volley: true,  summon: 'counter', extract: 'stack',   timers: [12, 16, 24], lookahead: 80 }
};
// 鬼より上の5段階: 動きは鬼と同じで、シークレットを使わない代わりにバフが付く
//   unitMul : CPUのユニットのHP・攻撃力の倍率   manaRate: マナ回復の倍率
//   costMul : CPUの召喚コストの倍率            bodyHp  : CPU本体のHP
const BOT_EXTRA_LEVELS = [
    { level: 6,  name: '修羅',   bot: '🤖 修羅Bot',   buff: { unitMul: 1.2, manaRate: 1.2, costMul: 1.0,  bodyHp: 2000 } },
    { level: 7,  name: '羅刹',   bot: '🤖 羅刹Bot',   buff: { unitMul: 1.4, manaRate: 1.4, costMul: 1.0,  bodyHp: 2000 } },
    { level: 8,  name: '魔王',   bot: '🤖 魔王Bot',   buff: { unitMul: 1.6, manaRate: 1.6, costMul: 0.85, bodyHp: 2000 } },
    { level: 9,  name: '破壊神', bot: '🤖 破壊神Bot', buff: { unitMul: 1.8, manaRate: 1.8, costMul: 0.75, bodyHp: 3000 } },
    { level: 10, name: '無限',   bot: '🤖 無限Bot',   buff: { unitMul: 2.0, manaRate: 2.0, costMul: 0.65, bodyHp: 4000 } }
];
BOT_EXTRA_LEVELS.forEach(x => { BOT_LEVELS[x.level] = { ...BOT_LEVELS[5], buff: x.buff }; });
const CPU_LEVEL_NAMES = ['', '易しい', '普通', '難しい', '超難', '鬼', ...BOT_EXTRA_LEVELS.map(x => x.name)];
const CPU_BOT_NAMES = ['', '🤖 よわよわBot', '🤖 普通Bot', '🤖 強化Bot', '🤖 超強Bot', '🤖 鬼Bot', ...BOT_EXTRA_LEVELS.map(x => x.bot)];

// 今のCPUのバフ（なければ null）。side を渡すと、その陣営がCPUのときだけ返す
function cpuBuff(side) {
    const active = gameState.isBotMatch || (typeof Sandbox !== 'undefined' && Sandbox.cpuActive());
    if (!active) return null;
    if (side && side !== BotAI.side) return null;
    const lv = gameState.isBotMatch ? gameState.cpuDifficulty : Sandbox.settings.cpuLevel;
    return (BOT_LEVELS[lv] && BOT_LEVELS[lv].buff) || null;
}
// 召喚コスト（CPUのバフで安くなる）
function summonCost(unitDef, side) {
    const b = cpuBuff(side);
    return b ? Math.max(1, Math.round(unitDef.cost * b.costMul)) : unitDef.cost;
}

const botPickOne = (arr) => arr[Math.floor(Math.random() * arr.length)];
const botShuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
};
// 弾が1フレームで実際に進む量（弾の速さの倍率・跳弾の加速を含む）
const botBulletVel = (b) => {
    const m = CONFIG.BULLET_SPEED_RATE * (b.action === 'bounce' ? 1.6 : 1);
    return { vx: (b.vx || 0) * m, vy: (b.vy || 0) * m };
};

const BotAI = {
    side: 'right',
    thinkTimer: 0,
    fireTimer: 0,
    extractTimer: 0,
    prevHumanY: null,
    humanVy: 0,
    noticed: new Map(), // 易しい: 弾ごとに「気づいたか」を1回だけ決める
    dodgeY: 0,          // 易しい・普通: よける先
    dodgeTimer: 0,
    holdCount: 0,       // 超難・鬼: コーラをためている回数

    reset() {
        this.thinkTimer = 0;
        this.fireTimer = 0;
        this.extractTimer = 0;
        this.prevHumanY = null;
        this.humanVy = 0;
        this.noticed.clear();
        this.dodgeY = 0;
        this.dodgeTimer = 0;
        this.holdCount = 0;
    },

    level() {
        const lv = Sandbox.cpuActive() ? Sandbox.settings.cpuLevel : gameState.cpuDifficulty;
        return BOT_LEVELS[lv] || BOT_LEVELS[2];
    },

    update() {
        if (!gameState.isBotMatch && !Sandbox.cpuActive()) return;
        const L = this.level();
        const [thinkBase, fireBase, extractBase] = L.timers;
        const bot = gameState.players[this.side];
        const human = gameState.players.left;

        // プレイヤーの上下の動きを記録（予測撃ち用）
        if (this.prevHumanY !== null) this.humanVy = this.humanVy * 0.7 + (human.y - this.prevHumanY) * 0.3;
        this.prevHumanY = human.y;

        // 1. 移動・弾よけ
        this.updateMovement(L, bot, human);

        // 2. 召喚（準備時間中は少し速く）
        this.thinkTimer++;
        const thinkInterval = gameState.prepTimer > 0 ? Math.floor(thinkBase * 0.6) : thinkBase;
        if (this.thinkTimer >= thinkInterval) {
            this.thinkTimer = 0;
            this.trySummon(L, bot);
        }

        // 3. コーラ発射
        this.fireTimer++;
        if (this.fireTimer >= fireBase && gameState.prepTimer <= 0) {
            this.fireTimer = 0;
            this.tryFireCola(L, human);
        }

        // 4. 合成
        this.extractTimer++;
        if (this.extractTimer >= extractBase) {
            this.extractTimer = 0;
            this.tryExtract(L, bot);
        }
    },

    // ---------------- 便利関数 ----------------
    isShield(u) {
        return typeof u.typeKey === 'string' && u.typeKey.startsWith('RICE_SHIELD');
    },
    canExtract(u) {
        return !u.isFinalForm && (u.extractionCount || 0) < EXTRACTION_LIMIT;
    },
    isFreshMaterial(u) {
        return !u.isSecretChimera && !(u.extractionCount > 0);
    },
    myUnits() {
        return gameState.units.filter(u => u.side === this.side && u.hp > 0 && !u.fired);
    },
    incomingSummons() {
        return gameState.summoningEffects.filter(ef => ef.side === this.side && ef.unitDef);
    },

    // ---------------- 移動・弾よけ ----------------
    updateMovement(L, bot, human) {
        const maxY = CONFIG.SCREEN_HEIGHT - 32;
        const homeY = human.y;
        let targetY = homeY;
        if (L.dodge === 'late' || L.dodge === 'react') {
            const d = this.reactiveDodge(L, bot);
            if (d !== null) targetY = d;
        } else if (L.dodge === 'predict') {
            targetY = this.planDodge(L, bot, homeY);
        }

        const dy = targetY - bot.y;
        if (Math.abs(dy) > 1) bot.y += Math.sign(dy) * Math.min(Math.abs(dy), L.moveSpeed);
        bot.y = Math.max(0, Math.min(maxY, bot.y));
    },

    // 易しい・普通: 近くまで来た弾を見てからよける
    reactiveDodge(L, bot) {
        const startX = L.dodge === 'late' ? 420 : 380;
        const cy = bot.y + 16;
        const maxY = CONFIG.SCREEN_HEIGHT - 32;
        if (this.noticed.size > 500) this.noticed.clear();
        // よけ始めたら少しのあいだ、その場所へ動き切る（途中で戻って当たらないように）
        if (this.dodgeTimer > 0) {
            this.dodgeTimer--;
            return this.dodgeY;
        }
        for (const b of gameState.bullets) {
            if (b.side !== 'left' || !(b.vx > 0) || b.x < startX) continue;
            if (Math.abs(b.y - cy) >= 24) continue;
            if (L.dodge === 'late') {
                // 易しい: 半分くらいの弾には気づかない
                if (!this.noticed.has(b.uid)) this.noticed.set(b.uid, Math.random() < 0.5);
                if (!this.noticed.get(b.uid)) continue;
            }
            const dir = b.y > cy ? -1 : 1;
            let ty = bot.y + dir * 40;
            if (ty < 0 || ty > maxY) ty = bot.y - dir * 40; // 壁ぎわなら反対へ
            this.dodgeY = ty;
            this.dodgeTimer = 15;
            return ty;
        }
        return null;
    },

    // 難しい〜鬼: 弾がいつ・どの高さに来るかを計算して、当たらない場所へ動く
    planDodge(L, bot, homeY) {
        const W = CONFIG.SCREEN_WIDTH;
        const H = CONFIG.SCREEN_HEIGHT;
        const maxY = H - 32;
        const zoneL = W - 32, zoneR = W; // 自分の本体に当たる横の範囲

        const threats = [];
        for (const b of gameState.bullets) {
            if (b.side !== 'left') continue;
            const v = botBulletVel(b);
            if (!(v.vx > 0.3)) continue;
            const tIn = (zoneL - b.x) / v.vx;
            const tOut = (zoneR - b.x) / v.vx;
            if (tOut < 0 || tIn > L.lookahead) continue;
            threats.push({ b, v, tIn: Math.max(0, tIn), tOut, power: b.power || 5 });
        }
        if (threats.length === 0) return homeY;

        const yAt = (th, t) => {
            let y = th.b.y + th.v.vy * t;
            if (th.b.bounce) { // 上下の壁で跳ね返る弾
                const p = 2 * H;
                y = ((y % p) + p) % p;
                if (y > H) y = p - y;
            }
            return y;
        };

        let bestY = bot.y;
        let bestCost = Infinity;
        for (let cand = 0; cand <= maxY; cand += 4) {
            const d = cand - bot.y;
            let cost = Math.abs(cand - homeY) * 0.01 + Math.abs(d) * 0.005;
            for (const th of threats) {
                for (const t of [th.tIn, (th.tIn + th.tOut) / 2, th.tOut]) {
                    const by = yAt(th, t);
                    if (by < 0 || by > H) continue; // 画面外に出て消える弾
                    const py = bot.y + Math.sign(d) * Math.min(Math.abs(d), L.moveSpeed * t);
                    if (Math.abs(by - (py + 16)) < 22) {
                        cost += th.power * (2 - th.tIn / L.lookahead); // 近い弾ほど危険
                        break;
                    }
                }
            }
            if (cost < bestCost) {
                bestCost = cost;
                bestY = cand;
            }
        }
        return bestY;
    },

    // ---------------- 召喚 ----------------
    trySummon(L, bot) {
        if (bot.mana < 4) return;
        const units = this.myUnits();
        const incoming = this.incomingSummons();
        if (units.length + incoming.length >= L.maxUnits) return;

        const pick = L.summon === 'counter' ? this.pickSmart(L, units, incoming, bot) : this.pickBasic(units, bot);
        if (!pick) return;

        const def = UNIT_TYPES[pick.key];
        if (!def || bot.mana < summonCost(def, this.side)) return; // 足りないときはマナを貯める

        const cell = this.findCell(units, incoming, pick);
        if (cell) processSummon({ unitId: def.id, row: cell.row, col: cell.col, side: this.side });
    },

    findCell(units, incoming, pick) {
        const busy = (c, r) => units.some(u => u.col === c && u.row === r) ||
            incoming.some(ef => ef.col === c && ef.row === r);
        const prefer = (pick.rows || []).filter(r => r >= 0 && r < CONFIG.GRID_ROWS);
        const others = botShuffle([...Array(CONFIG.GRID_ROWS).keys()].filter(r => !prefer.includes(r)));
        for (const r of prefer.concat(others)) {
            for (const c of pick.cols) {
                if (!busy(c, r)) return { col: c, row: r };
            }
        }
        return null;
    },

    // 易しい・普通: 盾 → ソーダ → 攻撃役 の基本作戦
    pickBasic(units, bot) {
        const from = (start) => [start, start + 1, start + 2];
        const count = (k) => units.filter(u => u.typeKey === k).length;
        const hasShield = units.some(u => this.isShield(u));
        const sodaCount = units.filter(u => u.type === 'soda').length;

        if (!hasShield && bot.mana >= 17) {
            return { key: Math.random() < 0.6 ? 'RICE_SHIELD_IRON' : 'RICE_SHIELD_WOOD', cols: from(9) };
        }
        if (sodaCount < 2 && bot.mana >= 13) {
            return { key: Math.random() < 0.5 ? 'SODA_MEDIUM' : 'SODA_LARGE', cols: from(15) };
        }
        if (count('RICE_BURST') < 2 && Math.random() < 0.4) return { key: 'RICE_BURST', cols: from(12) };
        if (count('RICE_SPREAD') < 2 && Math.random() < 0.35) return { key: 'RICE_SPREAD', cols: from(12) };
        if (Math.random() < 0.45) {
            return { key: botPickOne(['COLA_BOUNCE', 'COLA_SPREAD', 'COLA_MENTOS', 'COLA_PIERCE']), cols: botShuffle([11, 12, 13, 14]) };
        }
        return { key: botPickOne(['RICE_FROST', 'RICE_SNIPER', 'RICE_BURST', 'RICE_SPREAD']), cols: from(12) };
    },

    // 難しい〜鬼: 相手の盤面を見て、守る行・攻める行を決める
    pickSmart(L, units, incoming, bot) {
        const rows = CONFIG.GRID_ROWS;
        const threat = new Array(rows).fill(0);   // 相手の攻撃の強さ（行ごと）
        const enemyDef = new Array(rows).fill(0); // 相手の守りの厚さ（行ごと）
        gameState.units.forEach(u => {
            if (u.side === this.side || u.hp <= 0 || u.fired) return;
            if (this.isShield(u)) enemyDef[u.row] += 2;
            else if (u.type !== 'soda') {
                threat[u.row] += (u.power || 5) * (u.type === 'cola' ? 1.5 : 1);
                enemyDef[u.row] += 1;
            }
        });

        // 1) 守り: 相手の攻撃役が多い行に、まだ盾がなければ盾を置く
        const shieldRows = new Set(units.filter(u => this.isShield(u)).map(u => u.row));
        incoming.forEach(ef => { if (this.isShield(ef)) shieldRows.add(ef.row); });
        let worstRow = -1, worst = 0;
        threat.forEach((t, r) => {
            if (!shieldRows.has(r) && t > worst) { worst = t; worstRow = r; }
        });
        const maxShields = Math.floor(L.maxUnits / 4);
        if (worstRow >= 0 && worst >= 8 && shieldRows.size < maxShields) {
            const key = worst >= 30 && bot.mana >= 16 ? 'RICE_SHIELD_MAGIC' : 'RICE_SHIELD_IRON';
            return { key, cols: [9, 10], rows: [worstRow, worstRow - 1, worstRow + 1] };
        }

        // 2) マナを増やすソーダ（強い難易度ほど多めに）
        const sodaGoal = L.maxUnits >= 18 ? 3 : 2;
        const sodaCount = units.filter(u => u.type === 'soda').length + incoming.filter(ef => ef.unitDef.type === 'soda').length;
        if (sodaCount < sodaGoal) return { key: sodaCount === 0 ? 'SODA_MEDIUM' : 'SODA_LARGE', cols: [17, 16, 15] };

        // 3) 攻め: 相手の守りが薄い行に攻撃役を置く
        const weakRows = botShuffle([...Array(rows).keys()]).sort((a, b) => enemyDef[a] - enemyDef[b]);
        const colaCount = units.filter(u => u.type === 'cola').length;
        const colaCap = L.volley ? 6 : 4; // 超難・鬼はコーラを多めに持つ
        if (colaCount < colaCap && Math.random() < (L.volley ? 0.6 : 0.5)) {
            return { key: botPickOne(['COLA_PIERCE', 'COLA_SPREAD', 'COLA_MEGATON', 'COLA_BOUNCE', 'COLA_CHARGE']), cols: [12, 13, 11, 14], rows: weakRows.slice(0, 3) };
        }
        return { key: botPickOne(['RICE_BURST', 'RICE_SNIPER', 'RICE_SPREAD', 'RICE_FROST', 'RICE_LASER', 'RICE_SEEKER']), cols: [12, 13, 14], rows: weakRows.slice(0, 3) };
    },

    // ---------------- コーラ発射 ----------------
    tryFireCola(L, human) {
        const colas = this.myUnits().filter(u => u.type === 'cola');
        if (colas.length === 0) { this.holdCount = 0; return; }

        // 超難・鬼: 2本以上たまるまで少し待ってから、まとめて撃つ
        if (L.volley && colas.length < 2 && this.holdCount < 2) { this.holdCount++; return; }
        this.holdCount = 0;

        const H = CONFIG.SCREEN_HEIGHT;
        const tx = 16;
        colas.forEach((u, i) => {
            let ty = human.y + 16;
            if (L.lead) {
                // 弾が届くまでの時間に、プレイヤーがどこまで動くかを予測
                const speed = (u.action === 'zero' ? 9 : 6) * CONFIG.BULLET_SPEED_RATE;
                const t = Math.hypot(tx - u.x, ty - u.y) / speed;
                ty += this.humanVy * t;
            }
            if (L.volley && colas.length >= 2) ty += [0, -20, 20][i % 3]; // ばらして逃げ道をふさぐ
            if (L.aimError) ty += (Math.random() * 2 - 1) * L.aimError;
            ty = Math.max(16, Math.min(H - 16, ty));
            u.fired = true;
            u.hp = -1;
            fireColaTarget(u, tx, ty);
        });
    },

    // ---------------- 合成 ----------------
    extract(target, src) {
        if (!target || !src || target === src || getExtractionBlockReason(target, src)) return false;
        this.extracting = true; // この合成ではシークレットにしない
        try { processExtraction(target.col, target.row, src.col, src.row, this.side); }
        finally { this.extracting = false; }
        return true;
    },

    tryExtract(L, bot) {
        if (L.extract === 'none') return;
        const units = this.myUnits();
        if (units.length < 2) return;

        // 易しい: ふつうの強化合成（融合度3未満どうし）
        if (L.extract === 'general') {
            const cand = units.filter(u => (u.extractionCount || 0) < 3 && !u.isSecretChimera);
            if (cand.length >= 2) this.extract(cand[0], cand[1]);
            return;
        }

        // 普通〜鬼: ある程度ユニットがそろったら、安いユニットを強い攻撃役にまとめる
        // （まとめた攻撃役が相手本体まで届く弾を撃つので、CPUの火力の中心になる）
        if (units.length < Math.min(12, L.maxUnits - 3) && bot.mana < 50) return;
        const targets = units
            .filter(u => this.canExtract(u) && u.type === 'rice' && !this.isShield(u))
            .sort((a, b) => ((b.extractionCount || 0) - (a.extractionCount || 0)) || ((b.power || 0) - (a.power || 0)));
        const target = targets[0];
        if (!target) return;
        // 素材は安い稲から。コーラは相手本体を撃つ大事な攻撃なので、ほかに素材がないときだけ使う
        const mats = units.filter(u => u !== target && this.isFreshMaterial(u) && u.type !== 'soda' && !this.isShield(u));
        const byCost = (a, b) => (a.cost || 0) - (b.cost || 0);
        const src = mats.filter(u => u.type !== 'cola').sort(byCost)[0] || (L.volley ? null : mats.sort(byCost)[0]);
        this.extract(target, src);
    }
};

function startBotMatch() {
    if (socket) {
        try { socket.send(JSON.stringify({ type: 'cancel_match' })); } catch (e) {}
    }
    if (gameState.matchTimeoutTimer) {
        clearTimeout(gameState.matchTimeoutTimer);
        gameState.matchTimeoutTimer = null;
    }

    const difficultyEl = document.getElementById('cpu-difficulty');
    const difficulty = difficultyEl ? parseInt(difficultyEl.value) : 2;
    gameState.cpuDifficulty = difficulty;
    BotAI.reset();

    const diffNames = CPU_LEVEL_NAMES;
    const botNames = CPU_BOT_NAMES;

    gameState.roomId = 'CPU_BOT';
    gameState.isHost = true;
    gameState.isMatching = false;
    gameState.isPractice = false;
    gameState.isBotMatch = true;
    gameState.playerSide = 'left';

    savePlayerName();
    gameState.players.left.name = localStorage.getItem('inamu_player_name') || 'Player 1';
    gameState.players.right.name = botNames[difficulty] || '🤖 強化AI いなむー';
    gameState.players.left.hp = 2000;
    gameState.players.left.maxHp = 2000;
    gameState.players.right.hp = 2000;
    gameState.players.right.maxHp = 2000;
    gameState.players.left.mana = 100;
    gameState.players.right.mana = 100;
    gameState.units = [];
    gameState.bullets = [];
    gameState.summoningEffects = [];

    const roomDisp = document.getElementById('room-display');
    if (roomDisp) roomDisp.innerText = `VS CPU [${diffNames[difficulty]}]`;

    Camera.reset();
    startGame();
    // 鬼より上の難易度: CPU本体のHPもバフ
    const buff = cpuBuff();
    if (buff) {
        gameState.players.right.maxHp = buff.bodyHp;
        gameState.players.right.hp = buff.bodyHp;
    }
    statusMsg.innerText = `CPU対戦開始！ 難易度: ${diffNames[difficulty]}`;
}

// 初期化
function init() {
    const savedName = localStorage.getItem('inamu_player_name');
    if (savedName) document.getElementById('player-name').value = savedName;

    const nameInput = document.getElementById('player-name');
    if (nameInput) {
        nameInput.addEventListener('input', () => {
            savePlayerName();
            sendRegisterPlayerName();
        });
        // 名前を決め終わったら、ランキングの名前も更新する
        nameInput.addEventListener('change', () => {
            CloudSyncManager.save({ name: localStorage.getItem('inamu_player_name') || 'ゲスト' })
                .then(() => CloudSyncManager.updateRankingDisplay());
        });
    }

    // 🏠 ホーム画面: 自分のレート・ランキング・全体チャット
    updateMyEloDisplay();
    setInterval(() => {
        if (!menuOverlay.classList.contains('hidden')) CloudSyncManager.updateRankingDisplay();
    }, 30000);
    const lobbyInput = document.getElementById('lobby-chat-input');
    const lobbySend = document.getElementById('btn-lobby-chat-send');
    if (lobbyInput && lobbySend) {
        lobbySend.addEventListener('click', sendLobbyChat);
        lobbyInput.addEventListener('keydown', (e) => {
            e.stopPropagation(); // 入力中のキーをゲーム操作として扱わない
            if (e.key === 'Enter' && !e.isComposing) sendLobbyChat();
        });
    }

    // デッキ初期化
    DeckManager.init();

    // ☁️ クラウドデータ同期（ELO・デッキ・キメラ図鑑）
    CloudSyncManager.syncOnStart().then(() => {
        // 同期後にデッキを再初期化（クラウドから更新された可能性があるため）
        DeckManager.init();
        updateUnitUI();
    });

    for (let i = 0; i < 50; i++) bgParticles.push(new Particle()); // 粒子を増やす

    setupEventListeners();

    // 📱 スマホ判定: タッチ端末のみ操作ボタンを表示
    const mobileControls = document.getElementById('mobile-controls');
    const isMobileDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0) || (window.innerWidth < 768);
    if (mobileControls) {
        mobileControls.style.display = isMobileDevice ? 'flex' : 'none';
    }

    // 練習場の設定パネル
    Sandbox.bindUI();

    // パーティクルのON/OFF設定（最初はON）
    const checkParticles = document.getElementById('check-particles');
    if (checkParticles) {
        checkParticles.checked = Particles.enabled();
        checkParticles.addEventListener('change', () => {
            try { localStorage.setItem('inamu_particles', checkParticles.checked ? '1' : '0'); } catch (e) {}
        });
    }
    layoutGameScreen();

    // ダメージ表示のON/OFF設定の復元（最初はON）
    const checkDamage = document.getElementById('check-damage-numbers');
    if (checkDamage) {
        checkDamage.checked = DamageNumbers.enabled();
        checkDamage.addEventListener('change', () => {
            try { localStorage.setItem('inamu_damage_numbers', checkDamage.checked ? '1' : '0'); } catch (e) {}
        });
    }

    // チャットのON/OFF設定の復元
    const checkChat = document.getElementById('check-chat-enabled');
    if (checkChat) {
        checkChat.checked = isChatEnabled();
        checkChat.addEventListener('change', () => {
            try { localStorage.setItem('inamu_chat_enabled', checkChat.checked ? '1' : '0'); } catch (e) {}
            applyChatVisibility();
        });
    }
    applyChatVisibility();

    connectToServer(); // 起動時に自動接続してホスト・他プレイヤー名を取得
    gameLoop();
}


function setupEventListeners() {
    const btnFindMatch = document.getElementById('btn-find-match');

    if (btnFindMatch) {
        btnFindMatch.onclick = () => {
            if (gameState.isMatching) {
                cancelMatch();
            } else {
                savePlayerName();
                gameState.isRated = true; // オンライン対戦はすべてレート戦
                startMatchmaking();
            }
        };
    }

    // 🤖 CPU対戦（強化Bot）ボタン
    const btnBotMatch = document.getElementById('btn-bot-match');
    if (btnBotMatch) {
        btnBotMatch.onclick = () => {
            startBotMatch();
        };
    }

    // デッキ編成ボタン
    const btnDeckBuilder = document.getElementById('btn-deck-builder');
    if (btnDeckBuilder) {
        btnDeckBuilder.addEventListener('click', () => DeckManager.openModal());
    }
    const btnSaveDeck = document.getElementById('btn-save-deck');
    if (btnSaveDeck) {
        btnSaveDeck.addEventListener('click', () => DeckManager.save());
    }
    const btnResetDeck = document.getElementById('btn-reset-deck');
    if (btnResetDeck) {
        btnResetDeck.addEventListener('click', () => DeckManager.reset());
    }
    const btnCloseDeck = document.getElementById('btn-close-deck');
    if (btnCloseDeck) {
        btnCloseDeck.addEventListener('click', () => DeckManager.closeModal());
    }

    window.addEventListener('keydown', (e) => {
        keysPressed[e.key] = true;
        handleInput(e);
    });
    window.addEventListener('keyup', (e) => {
        keysPressed[e.key] = false;
    });

    // タッチ直後の「おまけのクリック」や、長押しでカメラを動かした後のクリックは無視する
    canvas.addEventListener('click', (e) => { if (Date.now() < suppressCanvasClickUntil) return; handleCanvasClick(e); });

    // 📱 スマホ用 コーラ発射ボタン
    const btnFireColaMobile = document.getElementById('btn-fire-cola-mobile');
    if (btnFireColaMobile) {
        btnFireColaMobile.addEventListener('click', (e) => {
            e.preventDefault();
            attemptFireCola(true);
        });
        btnFireColaMobile.addEventListener('touchend', (e) => {
            e.preventDefault();
            attemptFireCola(true);
        });
    }

    // 📱 スマホ用 バーチャル移動ボタン (▲ / ▼)
    const btnMobileUp = document.getElementById('btn-mobile-up');
    const btnMobileDown = document.getElementById('btn-mobile-down');

    const bindDirBtn = (btn, key) => {
        if (!btn) return;
        const press = (e) => {
            e.preventDefault();
            keysPressed[key] = true;
        };
        const release = (e) => {
            e.preventDefault();
            keysPressed[key] = false;
        };
        btn.addEventListener('pointerdown', press);
        btn.addEventListener('pointerup', release);
        btn.addEventListener('pointerleave', release);
        btn.addEventListener('pointercancel', release);
    };

    bindDirBtn(btnMobileUp, 'ArrowUp');
    bindDirBtn(btnMobileDown, 'ArrowDown');

    // 合成モードボタン
    const btnToggleExtraction = document.getElementById('btn-toggle-fusion-mode');
    if (btnToggleExtraction) {
        btnToggleExtraction.addEventListener('click', toggleExtractionMode);
    }

    // プレビューパネル閉じるボタン
    const btnPreviewClose = document.getElementById('unit-preview-close');
    if (btnPreviewClose) {
        btnPreviewClose.addEventListener('click', hideUnitPreview);
    }

    // Help menu
    const btnHelp = document.getElementById('btn-help');
    const helpMenu = document.getElementById('help-menu');
    const btnCloseHelp = document.getElementById('btn-close-help');
    if (btnHelp && helpMenu) {
        btnHelp.addEventListener('click', () => helpMenu.classList.remove('hidden'));
        btnCloseHelp.addEventListener('click', () => helpMenu.classList.add('hidden'));
    }

    // 統一された退出ボタン（通常戦・練習場共通）
    const btnLeaveGame = document.getElementById('btn-leave-game');
    if (btnLeaveGame) {
        btnLeaveGame.addEventListener('click', () => {
            if (gameState.isPractice) {
                exitPracticeMode();
            } else {
                leaveRoom();
            }
        });
    }

    const btnEncyclopedia = document.getElementById('btn-encyclopedia');
    const encyclopediaMenu = document.getElementById('encyclopedia-menu');
    const btnCloseEncyclopedia = document.getElementById('btn-close-encyclopedia');
    if (btnEncyclopedia && encyclopediaMenu) {
        btnEncyclopedia.addEventListener('click', () => {
            populateEncyclopedia();
            encyclopediaMenu.classList.remove('hidden');
        });
        btnCloseEncyclopedia.addEventListener('click', () => encyclopediaMenu.classList.add('hidden'));
    }

    // 🍔 ハンバーガーメニュー & サイドバードロワー
    const btnHamburger = document.getElementById('btn-hamburger');
    const sidebarDrawer = document.getElementById('sidebar-drawer');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const btnCloseSidebar = document.getElementById('btn-close-sidebar');

    const toggleSidebar = (open) => {
        if (!sidebarDrawer) return;
        const willOpen = open !== undefined ? open : !sidebarDrawer.classList.contains('open');
        sidebarDrawer.classList.toggle('open', willOpen);
        if (sidebarOverlay) sidebarOverlay.classList.toggle('open', willOpen);
    };

    if (btnHamburger) btnHamburger.addEventListener('click', () => toggleSidebar());
    if (btnCloseSidebar) btnCloseSidebar.addEventListener('click', () => toggleSidebar(false));
    if (sidebarOverlay) sidebarOverlay.addEventListener('click', () => toggleSidebar(false));

    // サイドバー内の操作方法・図鑑ボタン
    const btnSidebarHelp = document.getElementById('btn-sidebar-help');
    if (btnSidebarHelp && helpMenu) {
        btnSidebarHelp.addEventListener('click', () => {
            helpMenu.classList.remove('hidden');
            toggleSidebar(false);
        });
    }
    const btnSidebarEnc = document.getElementById('btn-sidebar-encyclopedia');
    if (btnSidebarEnc && encyclopediaMenu) {
        btnSidebarEnc.addEventListener('click', () => {
            populateEncyclopedia();
            encyclopediaMenu.classList.remove('hidden');
            toggleSidebar(false);
        });
    }

    // ⚙️ 設定（音量・ミュート）
    const volumeSlider = document.getElementById('volume-se');
    if (volumeSlider) {
        volumeSlider.addEventListener('input', (e) => {
            SoundManager.setVolume(parseFloat(e.target.value) / 100);
        });
    }
    const checkMute = document.getElementById('check-mute-sound');
    if (checkMute) {
        checkMute.addEventListener('change', (e) => {
            SoundManager.setMute(e.target.checked);
        });
    }

    // 📷 カメラ操作ミニUI
    const btnZoomIn = document.getElementById('btn-camera-zoom-in');
    const btnZoomOut = document.getElementById('btn-camera-zoom-out');
    const btnResetCam = document.getElementById('btn-camera-reset');
    if (btnZoomIn) btnZoomIn.addEventListener('click', () => Camera.zoomIn());
    if (btnZoomOut) btnZoomOut.addEventListener('click', () => Camera.zoomOut());
    if (btnResetCam) btnResetCam.addEventListener('click', () => Camera.reset());

    // DPS リセットボタン
    const btnResetDPS = document.getElementById('btn-reset-dps');
    if (btnResetDPS) {
        btnResetDPS.addEventListener('click', () => {
            DPSManager.reset();
        });
    }

    const btnPracticeLocal = document.getElementById('btn-practice');
    if (btnPracticeLocal) {
        btnPracticeLocal.onclick = () => {
            if (socket) {
                try { socket.close(); } catch (e) {}
                socket = null;
            }
            gameState.roomId = null;
            gameState.isHost = false;
            gameState.isMatching = false;

            gameState.isPractice = true;
            gameState.playerSide = 'left';
            savePlayerName();
            gameState.players.left.name = localStorage.getItem('inamu_player_name') || 'Player 1';
            gameState.players.right.name = 'カカシ';
            gameState.players.left.hp = 2000;
            gameState.players.left.maxHp = 2000;
            gameState.players.left.mana = 100;
            gameState.players.right.mana = 100;
            gameState.units = [];
            gameState.bullets = [];
            if (Sandbox.settings.cpuLevel > 0) gameState.cpuDifficulty = Sandbox.settings.cpuLevel;
            BotAI.reset();

            DPSManager.reset();
            const dpsPanel = document.getElementById('dps-panel');
            if (dpsPanel) dpsPanel.classList.remove('hidden');

            const roomDisp = document.getElementById('room-display');
            if (roomDisp) roomDisp.innerText = `Room: Practice`;

            Camera.reset(); // 練習場開始時にカメラ位置リセット
            startGame();
            Sandbox.applyEnemyHp(); // 相手のHP（無限なら100万）
            Sandbox.showUI(true);
            updateUnitUI();
        };
    }

    // ===============================================================
    // 📷 カメラ操作
    //  - 長押し(0.4秒)してから動かすとカメラ移動（指・マウス左ボタン）
    //  - 右クリック / 中クリック / Shift+左クリック のドラッグでもカメラ移動
    //  - ホイール / 2本指ピンチで拡大・縮小
    //  - 1回のタップは1回だけ処理する（タッチの後に来る「おまけのクリック」は無視）
    // ===============================================================
    const LONG_PRESS_MS = 400;
    const MOVE_TOLERANCE = 10; // これ以上動いたら「タップ」ではない(px)
    let pressTimer = null;
    let pressStartX = 0, pressStartY = 0;
    let pressMoved = false;      // 長押し前に動いた
    let longPressPan = false;    // 長押しでカメラ移動中

    const beginPan = (clientX, clientY) => {
        Camera.isDragging = true;
        Camera.dragStartX = clientX;
        Camera.dragStartY = clientY;
        Camera.cameraStartX = Camera.x;
        Camera.cameraStartY = Camera.y;
    };
    const updatePan = (clientX, clientY) => {
        const s = Camera.clientToWorldScale();
        Camera.x = Camera.cameraStartX + (clientX - Camera.dragStartX) * s;
        Camera.y = Camera.cameraStartY + (clientY - Camera.dragStartY) * s;
    };
    const updateAim = (clientX, clientY) => {
        const wpos = Camera.screenToWorld(clientX, clientY);
        gameState.mousePos.x = wpos.x;
        gameState.mousePos.y = wpos.y;
    };
    const startPress = (clientX, clientY) => {
        clearTimeout(pressTimer);
        pressStartX = clientX;
        pressStartY = clientY;
        pressMoved = false;
        longPressPan = false;
        pressTimer = setTimeout(() => {
            if (pressMoved) return;
            longPressPan = true;
            beginPan(pressStartX, pressStartY);
            canvas.style.cursor = 'grabbing';
            if (navigator.vibrate) { try { navigator.vibrate(15); } catch (e) {} }
        }, LONG_PRESS_MS);
    };
    const movePress = (clientX, clientY) => {
        if (longPressPan) { updatePan(clientX, clientY); return; }
        if (Math.hypot(clientX - pressStartX, clientY - pressStartY) > MOVE_TOLERANCE) {
            pressMoved = true;
            clearTimeout(pressTimer);
        }
    };
    const endPress = () => {
        clearTimeout(pressTimer);
        const wasPan = longPressPan;
        longPressPan = false;
        Camera.isDragging = false;
        canvas.style.cursor = '';
        return wasPan;
    };

    // マウス
    canvas.addEventListener('mousemove', (e) => {
        if (Camera.isDragging) updatePan(e.clientX, e.clientY);
        else if (e.buttons === 1) movePress(e.clientX, e.clientY);
        updateAim(e.clientX, e.clientY);
    });

    canvas.addEventListener('mousedown', (e) => {
        if (e.button === 2 || e.button === 1 || (e.button === 0 && e.shiftKey)) {
            beginPan(e.clientX, e.clientY);
            e.preventDefault();
        } else if (e.button === 0) {
            startPress(e.clientX, e.clientY);
        }
    });

    window.addEventListener('mouseup', () => {
        if (endPress()) suppressCanvasClickUntil = Date.now() + 300; // 長押し移動のあとのクリックは召喚しない
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // ホイールで拡大・縮小
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.15 : 0.87;
        Camera.zoomBy(factor);
    }, { passive: false });

    // 📱 タッチ（1本指タップ=召喚・選択、長押し+移動=カメラ、2本指=ピンチズーム）
    let isPinching = false;
    let initialPinchDist = 0;
    let initialPinchZoom = 1.0;

    canvas.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1 && !isPinching) {
            const t = e.touches[0];
            startPress(t.clientX, t.clientY);
            updateAim(t.clientX, t.clientY);
        } else if (e.touches.length === 2) {
            endPress();
            isPinching = true;
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            initialPinchDist = Math.hypot(dx, dy);
            initialPinchZoom = Camera.zoom;
        }
    }, { passive: true });

    canvas.addEventListener('touchmove', (e) => {
        if (e.touches.length === 1 && !isPinching) {
            const t = e.touches[0];
            movePress(t.clientX, t.clientY);
            updateAim(t.clientX, t.clientY);
            if (longPressPan && e.cancelable) e.preventDefault(); // カメラ移動中は画面ごと動かさない
        } else if (e.touches.length === 2 && initialPinchDist > 0) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            Camera.setZoom(initialPinchZoom * Math.hypot(dx, dy) / initialPinchDist);
        }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        const wasPan = endPress();
        if (!wasPan && !pressMoved && !isPinching && e.changedTouches.length > 0) {
            // タップ: マス目の召喚・選択を実行
            const t = e.changedTouches[0];
            handleCanvasClick({ clientX: t.clientX, clientY: t.clientY });
        }
        // このタッチから作られる「おまけのクリック」で二重に処理しない
        suppressCanvasClickUntil = Date.now() + 600;
        if (e.cancelable) e.preventDefault();
        if (e.touches.length === 0) {
            isPinching = false;
            initialPinchDist = 0;
        }
    }, { passive: false });

    canvas.addEventListener('touchcancel', () => {
        endPress();
        isPinching = false;
        initialPinchDist = 0;
    });

    updateUnitUI();
}

// チャット設定（初期値はON。OFFのときだけ '0' を保存）
function isChatEnabled() {
    try { return localStorage.getItem('inamu_chat_enabled') !== '0'; } catch (e) { return true; }
}

// ホーム画面の全体チャットを出すかどうか（試合中のチャットは廃止）
function applyChatVisibility() {
    const lobby = document.getElementById('lobby-chat');
    if (lobby) lobby.style.display = isChatEnabled() ? '' : 'none';
}

function savePlayerName() {
    const nameInput = document.getElementById('player-name').value || 'いなむー';
    localStorage.setItem('inamu_player_name', nameInput);
    gameState.players[gameState.playerSide].name = nameInput;
}

function updateUnitUI() {
    const selector = document.getElementById('unit-selector');
    if (!selector) return;
    selector.innerHTML = '';

    const deck = Sandbox.selectableKeys();

    deck.forEach((key, idx) => {
        // 練習場のシークレット
        if (String(key).startsWith('SECRET:')) {
            const ck = key.slice(7), c = SECRET_CHIMERAS[ck], def = sandboxSecretDef(ck);
            if (!c || !def) return;
            const div = document.createElement('div');
            div.className = `unit-slot ${gameState.selectedUnit === key ? 'selected' : ''}`;
            div.style.borderColor = '#ffd700';
            const spr = ASSETS[c.id] || ASSETS[def.baseKey];
            div.innerHTML = `${spr ? `<img src="${spr.toDataURL()}" style="width: 26px; height: 26px; image-rendering: pixelated; margin-bottom: 2px; flex-shrink: 0;">` : ''}
                <div style="font-size: 0.45rem; line-height: 1; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 2px; color: #ffd700;">${c.name}</div>
                <div style="font-size: 0.55rem; color: #fb0;">${def.base.cost}</div>`;
            div.onclick = () => { gameState.selectedUnit = key; updateUnitUI(); };
            selector.appendChild(div);
            return;
        }
        const u = UNIT_TYPES[key];
        if (!u) return;

        const div = document.createElement('div');
        div.className = `unit-slot ${gameState.selectedUnit === key ? 'selected' : ''}`;
        div.style.position = 'relative';

        const spr = ASSETS[key];
        let imgHtml = '';
        if (spr) {
            imgHtml = `<img src="${spr.toDataURL()}" style="width: 26px; height: 26px; image-rendering: pixelated; margin-bottom: 2px; flex-shrink: 0;">`;
        }

        // 表示名を抜粋 (不要な接頭辞を削除)
        const displayName = u.name.replace(/ライス|コーラ|ソーダ|シールド|盾|アイゼン|アウラ/g, '').trim();
        const shortcutKey = idx < 9 ? (idx + 1) : 0; // 1〜9, 0

        div.innerHTML = `
            <span style="position: absolute; top: 1px; left: 3px; font-size: 0.55rem; color: #0df; font-weight: bold;">${shortcutKey}</span>
            ${imgHtml}
            <div style="font-size: 0.45rem; line-height: 1; width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0 2px;">${displayName}</div>
            <div style="font-size: 0.55rem; color: #fb0;">${u.cost}</div>
        `;
        div.onclick = () => {
            gameState.selectedUnit = key;
            updateUnitUI();
            showUnitPreview({ ...u, typeKey: key });
        };
        selector.appendChild(div);
    });
}

function handleCanvasClick(e) {
    if (gameUI.classList.contains('hidden')) return;

    // 📷 カメラのズーム・オフセットを考慮したワールド座標を取得
    const pos = Camera.screenToWorld(e.clientX, e.clientY);
    const x = pos.x;
    const y = pos.y;

    const cell = CONFIG.TILE_SIZE;
    const col = Math.floor(x / cell);
    const row = Math.floor(y / cell);

    if (col < 0 || col >= CONFIG.GRID_COLS || row < 0 || row >= CONFIG.GRID_ROWS) return;

    // 合成モードの処理
    if (gameState.extractionMode) {
        const occupied = gameState.units.some(u => u.col === col && u.row === row && u.hp > 0) ||
            gameState.summoningEffects.some(ef => ef.unitDef && ef.col === col && ef.row === row);
        if (occupied) {
            handleExtractionClick(row, col);
            return;
        }
        // 何もないマスを押したら、合成モードを終えてそのまま設置する
        toggleExtractionMode();
    }

    // グリッド範囲内かチェック。範囲外でも発射先にはなり得る
    const inGrid = col >= 0 && col < CONFIG.GRID_COLS && row >= 0 && row < CONFIG.GRID_ROWS;

    // クリックしたマスにユニットがいればプレビュー表示（コーラ選択中でなければ）
    if (inGrid && !gameState.selectedCola) {
        const unitAtCell = gameState.units.find(u => u.col === col && u.row === row && u.hp > 0);
        if (unitAtCell) {
            // すでに同じユニットをプレビュー中ならパネルを閉じる
            if (gameState.previewedUnit === unitAtCell) {
                hideUnitPreview();
            } else {
                showUnitPreview(unitAtCell);
            }
            // コーラは選択に進むためreturnしない（以降のcolaクリック判定もある）
            if (unitAtCell.type !== 'cola') return;
        } else if (gameState.previewedUnit) {
            // 空きマスをクリックしたらパネルを閉じる
            hideUnitPreview();
        }
    }

    // 選択済みのコーラがある場合は発射処理
    if (gameState.selectedCola && gameState.selectedCola.hp > 0 && !gameState.selectedCola.fired) {
        attemptFireColaTarget(gameState.selectedCola, x, y);
        gameState.selectedCola = null;
        return;
    }

    // 自分のコーラをクリックしたか判定（選択処理）
    // 当たり判定は「そのコーラがいる1マス」だけ（以前は2マス分あり、隣のマスを押しても選ばれていた）
    const clickedCola = gameState.units.find(u => {
        return u.side === gameState.playerSide && u.type === 'cola' && !u.fired && u.hp > 0 &&
            Math.abs(u.x - x) < cell / 2 && Math.abs(u.y - y) < cell / 2;
    });

    if (clickedCola) {
        gameState.selectedCola = clickedCola;
        return;
    }

    // グリッド範囲外なら以降の召喚処理はしない
    if (!inGrid) return;

    attemptSummon(row, col);
}

function attemptSummon(row, col) {
    // 練習場で「両方の陣地に置ける」がONなら、相手の陣地にも置ける（相手側のユニットになる）
    const sandboxBoth = gameState.isPractice && Sandbox.settings.bothSides;
    // 自分の陣地チェック (左なら 0~8, 右なら 9~17)
    const isMySide = gameState.playerSide === 'left' ? col < 9 : col >= 9;
    if (!isMySide && !sandboxBoth) {
        statusMsg.innerText = "自分の陣地にのみ召喚できます！";
        return;
    }
    const placeSide = sandboxBoth ? (col < 9 ? 'left' : 'right') : gameState.playerSide;

    // 練習場: 発見済みシークレットを直接置く
    if (gameState.isPractice && String(gameState.selectedUnit).startsWith('SECRET:')) {
        const key = gameState.selectedUnit.slice(7);
        const def = sandboxSecretDef(key);
        if (!def || isCellOccupied(col, row)) { if (def) statusMsg.innerText = "そこには既にユニットがいます！"; return; }
        if (gameState.players[placeSide].mana < def.base.cost) return;
        processSummon({ unitId: def.base.id, row, col, side: placeSide, secretKey: key });
        return;
    }

    // 重ね置き防止 (既にいるユニット ＋ 現在飛んで向かっている召喚エフェクトの両方をチェック)
    const isOccupied = gameState.units.some(u => u.col === col && u.row === row && u.hp > 0) ||
        gameState.summoningEffects.some(ef => ef.col === col && ef.row === row);

    if (isOccupied) {
        statusMsg.innerText = "そこには既にユニットがいます！";
        return;
    }

    const unitType = UNIT_TYPES[gameState.selectedUnit];
    if (!unitType) return;
    const side = placeSide;

    if (gameState.players[side].mana >= unitType.cost) {
        if (gameState.isPractice) {
            processSummon({ unitId: unitType.id, row, col, side });
            return;
        }

        // ホストなら自分でも即座に処理する（レスポンス向上）
        if (gameState.isHost) {
            processSummon({ unitId: unitType.id, row, col, side });
        }

        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'signal',
                action: 'summon',
                unitId: unitType.id,
                row, col,
                side
            }));
        }
    }
}

function startMatchmaking() {
    gameState.isMatching = true;
    const btnFindMatch = document.getElementById('btn-find-match');
    if (btnFindMatch) btnFindMatch.innerText = 'キャンセル';
    statusMsg.innerText = 'レート戦の相手を探しています...';

    // 🕒 スマートマッチング: 6秒以内に人間が見つからなければ、強化Botとの対戦を提案・自動開始
    if (gameState.matchTimeoutTimer) clearTimeout(gameState.matchTimeoutTimer);
    gameState.matchTimeoutTimer = setTimeout(() => {
        if (gameState.isMatching) {
            statusMsg.innerText = "対戦相手が見つからないため、強化AI（Bot）との対戦を開始します！";
            setTimeout(() => {
                if (gameState.isMatching) {
                    cancelMatch();
                    startBotMatch();
                }
            }, 1000);
        }
    }, 6000);

    if (!socket || socket.readyState !== WebSocket.OPEN) {
        connectToServer();
    } else {
        sendFindMatch();
    }
}

function sendFindMatch() {
    socket.send(JSON.stringify({
        type: 'find_match',
        isRated: gameState.isRated
    }));
}

function cancelMatch() {
    gameState.isMatching = false;
    if (gameState.matchTimeoutTimer) {
        clearTimeout(gameState.matchTimeoutTimer);
        gameState.matchTimeoutTimer = null;
    }
    const btnFindMatch = document.getElementById('btn-find-match');
    if (btnFindMatch) btnFindMatch.innerText = '対戦相手を探す';
    statusMsg.innerText = '';
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'cancel_match' }));
    }
}

function sendRegisterPlayerName() {
    const nameInput = document.getElementById('player-name');
    const name = (nameInput && nameInput.value.trim()) ? nameInput.value.trim() : 'プレイヤー';
    if (!CloudSyncManager.token) CloudSyncManager.initToken();
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'register_player',
            name: name,
            token: CloudSyncManager.token // レート表示用（サーバーは他の人には送らない）
        }));
    }
}

// ===============================================================
// 🏠 ホーム画面（自分のレート・オンライン一覧・対戦待ち人数・全体チャット）
// ===============================================================
let myPlayerId = null;

function updateMyEloDisplay() {
    const el = document.getElementById('my-elo');
    if (el) el.textContent = parseInt(localStorage.getItem('inamu_elo') || '1200', 10);
}

const PLAYER_STATUS_LABEL = { idle: '待機中', waiting: '対戦待ち', playing: '対戦中' };

function updateOnlinePlayersUI(hostName, players, waiting) {
    const countElem = document.getElementById('online-count');
    const listElem = document.getElementById('online-players-list');
    if (countElem) countElem.innerText = players ? players.length : 0;

    if (listElem) {
        listElem.innerHTML = '';
        if (!players || players.length === 0) {
            listElem.innerHTML = '<li class="home-empty">オンラインプレイヤーなし</li>';
        } else {
            // 自分を一番上に、そのあとはレートの高い順
            const sorted = players.slice().sort((a, b) =>
                ((b.id === myPlayerId) - (a.id === myPlayerId)) || ((b.elo || 0) - (a.elo || 0)));
            sorted.forEach(p => {
                const li = document.createElement('li');
                li.className = 'home-list-row' + (p.id === myPlayerId ? ' me' : '');
                const name = document.createElement('span');
                name.className = 'name';
                name.textContent = p.name + (p.id === myPlayerId ? '（あなた）' : '');
                const right = document.createElement('span');
                right.style.display = 'flex';
                right.style.gap = '5px';
                right.style.alignItems = 'center';
                const badge = document.createElement('span');
                const st = PLAYER_STATUS_LABEL[p.status] ? p.status : 'idle';
                badge.className = 'status-badge status-' + st;
                badge.textContent = PLAYER_STATUS_LABEL[st];
                const elo = document.createElement('span');
                elo.className = 'elo';
                elo.textContent = typeof p.elo === 'number' ? p.elo : '-';
                right.append(badge, elo);
                li.append(name, right);
                listElem.appendChild(li);
            });
        }
    }

    if (waiting) {
        const w = document.getElementById('waiting-count');
        if (w) w.textContent = (waiting.rated || 0) + (waiting.unrated || 0);
    }
}

// 全体チャットに1件追加（名前・文字は「ただの文字」として表示）
function appendLobbyChatMessage(m) {
    const box = document.getElementById('lobby-chat-messages');
    if (!box || !m) return;
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 30;
    const row = document.createElement('div');
    const myName = (document.getElementById('player-name') || {}).value || '';
    row.className = 'lobby-chat-msg' + (m.name && m.name === myName.trim() ? ' me' : '');
    const time = document.createElement('span');
    time.className = 'lobby-chat-time';
    const d = new Date(m.time || Date.now());
    const sameDay = d.toDateString() === new Date().toDateString();
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    time.textContent = sameDay ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
    const name = document.createElement('span');
    name.className = 'lobby-chat-name';
    name.textContent = String(m.name ?? '') + (typeof m.elo === 'number' ? `(${m.elo})` : '') + ':';
    row.append(time, name, document.createTextNode(' ' + String(m.text ?? '')));
    box.appendChild(row);
    while (box.children.length > 200) box.removeChild(box.firstChild); // 画面に出すのは200件まで
    if (atBottom) box.scrollTop = box.scrollHeight;
}

function showLobbyChatNote(text) {
    const note = document.getElementById('lobby-chat-note');
    if (!note) return;
    note.textContent = text;
    clearTimeout(showLobbyChatNote.timer);
    showLobbyChatNote.timer = setTimeout(() => { note.textContent = ''; }, 3000);
}

function sendLobbyChat() {
    const input = document.getElementById('lobby-chat-input');
    if (!input || !isChatEnabled()) return;
    const text = input.value.trim();
    if (!text) return;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
        showLobbyChatNote('サーバーにつながっていません。');
        return;
    }
    socket.send(JSON.stringify({ type: 'lobby_chat', text }));
    input.value = '';
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, function(m) {
        return {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        }[m];
    });
}

function connectToServer() {
    let host = window.location.host;
    let protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    if (!host || window.location.protocol === 'file:') {
        host = 'localhost:3000';
        protocol = 'ws:';
    }

    try {
        socket = new WebSocket(`${protocol}//${host}`);

        socket.onopen = () => {
            sendRegisterPlayerName();
            if (gameState.isMatching) {
                sendFindMatch();
            }
        };

        socket.onmessage = async (event) => {
            try {
                let text;
                if (event.data instanceof Blob) {
                    text = await event.data.text();
                } else {
                    text = event.data;
                }
                const data = JSON.parse(text);
                handleServerMessage(data);
            } catch (err) {}
        };

        socket.onerror = () => {
            console.log('サーバー未起動（オフライン／練習場モードでプレイ可能）');
        };

        // 切れたら5秒後につなぎ直す（サーバーの再起動・スリープ明けでもホーム画面が復活する）
        socket.onclose = () => {
            updateOnlinePlayersUI(null, [], { rated: 0, unrated: 0 });
            clearTimeout(connectToServer.retryTimer);
            connectToServer.retryTimer = setTimeout(connectToServer, 5000);
        };
    } catch (err) {
        console.log('WebSocket接続待機（オフライン）:', err.message);
    }
}

function handleServerMessage(data) {
    switch (data.type) {
        case 'online_players_update':
            updateOnlinePlayersUI(data.hostName, data.players, data.waiting);
            break;
        case 'welcome':
            myPlayerId = data.playerId;
            break;
        case 'lobby_chat_history': {
            const box = document.getElementById('lobby-chat-messages');
            if (box) box.innerHTML = '';
            (data.messages || []).forEach(appendLobbyChatMessage);
            if (box) box.scrollTop = box.scrollHeight;
            break;
        }
        case 'lobby_chat':
            appendLobbyChatMessage(data.message);
            break;
        case 'lobby_chat_error':
            showLobbyChatNote(data.reason || '送信できませんでした。');
            break;
        case 'matching_started':
            // サーバー側で待ち行列に入った
            break;
        case 'matching_cancelled':
            statusMsg.innerText = 'マッチングをキャンセルしました';
            break;
        case 'created':
            if (gameState.matchTimeoutTimer) { clearTimeout(gameState.matchTimeoutTimer); gameState.matchTimeoutTimer = null; }
            gameState.isMatching = false;
            gameState.isHost = true;
            gameState.isBotMatch = false;
            gameState.roomId = data.roomId;
            gameState.playerSide = data.side || 'left';
            gameState.isPractice = false;
            statusMsg.innerText = `マッチ成功！ ルーム: ${data.roomId}`;
            document.getElementById('room-display').innerText = `Room: ${data.roomId}`;
            startGame();
            break;
        case 'joined':
            if (gameState.matchTimeoutTimer) { clearTimeout(gameState.matchTimeoutTimer); gameState.matchTimeoutTimer = null; }
            gameState.isMatching = false;
            gameState.isHost = false;
            gameState.isBotMatch = false;
            gameState.roomId = data.roomId;
            gameState.playerSide = data.side || 'right';
            gameState.isPractice = false;
            statusMsg.innerText = `マッチ成功！ ルーム: ${data.roomId}`;
            document.getElementById('room-display').innerText = `Room: ${data.roomId}`;
            startGame();
            break;
        case 'signal':
            if (data.action === 'state') {
                // ホストからの盤面情報（一番多く届くので最初に判定）
                if (!gameState.isHost && gameState.isPlaying && data.s) NetSync.apply(data.s);
            } else if (data.action === 'sync_name') {
                gameState.players[data.side].name = data.name;
            } else if (data.action === 'summon') {
                processSummon(data);
            } else if (data.action === 'move') {
                gameState.players[data.side].y = data.y;
            } else if (data.action === 'fire_cola') {
                processFireCola(data.side);
            } else if (data.action === 'fire_cola_target') {
                processFireColaTarget(data.colaIdX, data.colaIdY, data.tx, data.ty, data.side);
            } else if (data.action === 'fire_cola_all') {
                processFireColaTargetAll(data.tx, data.ty, data.side);
            } else if (data.action === 'extraction_process') {
                processExtraction(data.targetCol, data.targetRow, data.srcCol, data.srcRow, data.side);
            } else if (data.action === 'game_over') {
                endGame(data.winner);
            } else if (data.action === 'opponent_disconnected') {
                // 試合中に相手が抜けたときだけ勝利扱い（試合後の部屋解散通知は無視）
                if (gameState.isPlaying) {
                    endGame(gameState.playerSide);
                    statusMsg.innerText = "相手が切断しました。あなたの勝利です！";
                }
            }
            break;
    }
}

// そのマスに、もうユニットか召喚中のものがあるか（陣営に関係なく）
function isCellOccupied(col, row) {
    return gameState.units.some(u => u.col === col && u.row === row && u.hp > 0 && !u.fired) ||
        gameState.summoningEffects.some(ef => ef.unitDef && ef.col === col && ef.row === row);
}

function processSummon(data) {
    const typeKey = Object.keys(UNIT_TYPES).find(k => UNIT_TYPES[k].id === data.unitId);
    const unitDef = UNIT_TYPES[typeKey];
    if (!unitDef) return;
    // どこから来た召喚でも、同じマスには置かない（CPU・通信・練習場すべて。マナも減らない）
    if (isCellOccupied(data.col, data.row)) return;

    SoundManager.playSummon();

    // マナ消費（CPUのバフでコストが下がることがある）
    gameState.players[data.side].mana -= summonCost(unitDef, data.side);

    const cell = CONFIG.TILE_SIZE;
    const targetX = data.col * cell + cell / 2;
    const targetY = data.row * cell + cell / 2;

    // 召喚者の投げる動作タイマーセット
    gameState.players[data.side].throwTimer = 10; // 10フレーム程度

    const effect = {
        unitDef,
        side: data.side,
        row: data.row,
        col: data.col,
        typeKey: typeKey, // キーを保存しておく
        secretKey: data.secretKey, // 練習場でシークレットを直接置いたとき
        x: 0, // Will be calculated in update
        y: 0, // Will be calculated in update
        targetX,
        targetY,
        progress: 0,
        duration: 20 // フレーム数
    };
    gameState.summoningEffects.push(effect);
}

function finalizeSummon(effect) {
    const unit = {
        ...effect.unitDef,
        uid: Math.random().toString(36).substr(2, 9),
        typeKey: effect.typeKey,
        row: effect.row,
        col: effect.col,
        x: effect.targetX,
        y: effect.targetY,
        side: effect.side,
        hp: effect.unitDef.hp,
        maxHp: effect.unitDef.hp,
        lastFire: 0
    };
    // 練習場: シークレットを直接置いたとき
    if (effect.secretKey && SECRET_CHIMERAS[effect.secretKey]) {
        const c = SECRET_CHIMERAS[effect.secretKey];
        Object.assign(unit, {
            isSecretChimera: true, chimeraId: c.id, name: c.name, spriteKey: c.id,
            hp: c.hp, maxHp: c.hp, power: c.power, cooldown: c.cooldown,
            fireTypes: [...c.fireTypes], actions: [...(c.actions || [])], extractionCount: 0
        });
        if (c.isManaProducer) unit.isManaProducer = true;
        if (c.manaGen) unit.manaGen = c.manaGen;
        if (c.pierceCount) unit.pierceCount = c.pierceCount;
    }
    // CPUのバフ（鬼より上の難易度）: HP・攻撃力を強くする
    const buff = cpuBuff(unit.side);
    if (buff && buff.unitMul !== 1) {
        unit.maxHp = Math.round(unit.maxHp * buff.unitMul);
        unit.hp = unit.maxHp;
        if (unit.power) unit.power = Math.round(unit.power * buff.unitMul);
        unit.powerMul = buff.unitMul; // 撃つ弾の威力にも掛ける
    }
    gameState.units.push(unit);
    Particles.summon(unit.x, unit.y, unit.side);
}

function processFireCola(side) {
    // 設置済みのコーラを探して発射する
    gameState.units.forEach(u => {
        if (u.side === side && u.type === 'cola' && !u.fired) {
            u.fired = true;
            u.hp = -1; // 発射フラグとしてHPをマイナスに
            fireCola(u);
        }
    });
}

// コーラの攻撃力（大幅強化: 元の数字 × COLA_POWER_RATE）
const COLA_POWER_RATE = 1.5;
const COLA_BASE_POWER = {
    straight: 25, bounce: 26, split: 18, charge: 35, pierce: 22, spread: 20,
    megaton: 38, blackhole: 24, geyser: 28, zero: 16, default: 15
};
function colaPower(action) {
    return Math.round((COLA_BASE_POWER[action] || COLA_BASE_POWER.default) * COLA_POWER_RATE);
}

// ユニットに powerMul（CPUのバフ）があれば、その関数で出た弾の威力に掛ける
function withPowerBuff(fn) {
    return function (u, ...rest) {
        const n = gameState.bullets.length;
        const r = fn.call(this, u, ...rest);
        const m = u && u.powerMul;
        if (m && m !== 1) {
            for (let i = n; i < gameState.bullets.length; i++) {
                const b = gameState.bullets[i];
                b.power = Math.round((b.power || 0) * m);
            }
        }
        return r;
    };
}

// 図鑑・詳細表示の攻撃力も、実際に撃つ強さに合わせる
Object.values(UNIT_TYPES).forEach(d => { if (d.type === 'cola') d.power = colaPower(d.action); });

function fireCola(u) {
    const spd = 6.0; // 打ったコーラは超高速
    const vx = u.side === 'left' ? spd : -spd;
    const extra = { spriteKey: u.typeKey, size: 16 };

    if (u.actions && u.actions.includes('homing')) extra.homing = true;
    if (u.actions && u.actions.includes('split')) u.action = 'split';
    if (u.actions && u.actions.includes('bounce')) u.action = 'bounce';
    
    let pCount = extra.pierceCount || 0;
    if (u.action === 'pierce' || (u.actions && u.actions.includes('pierce'))) {
        pCount = 1 + (u.extractionCount || 0);
    }
    extra.pierceCount = pCount;

    extra.isCola = true;
    if (u.action === 'straight') {
        spawnBullet(u.x, u.y, vx, 0, u.side, { power: colaPower('straight'), chain: true, ...extra });
    } else if (u.action === 'bounce') {
        spawnBullet(u.x, u.y, vx, 1 * spd, u.side, { bounce: 3, power: colaPower('bounce'), ...extra });
    } else if (u.action === 'split') {
        spawnBullet(u.x, u.y, vx, 0, u.side, { split: true, power: colaPower('split'), ...extra });
    } else if (u.action === 'glide') {
        spawnBullet(u.x, u.y, vx * 0.3, 0, u.side, { power: colaPower('default'), lifetime: 200, ...extra });
    } else if (u.action === 'charge') {
        spawnBullet(u.x, u.y, vx * 1.5, 0, u.side, { power: colaPower('charge'), ...extra });
    } else {
        spawnBullet(u.x, u.y, vx, 0, u.side, { power: colaPower(u.action), ...extra });
    }
    // ユニットリストから削除 (fired=true にしたので update で消す)
}

function startGame() {
    menuOverlay.classList.add('hidden');
    gameUI.classList.remove('hidden');

    // 練習場のみDPSパネルを表示
    const dpsPanel = document.getElementById('dps-panel');
    if (dpsPanel) {
        if (gameState.isPractice) {
            dpsPanel.classList.remove('hidden');
        } else {
            dpsPanel.classList.add('hidden');
        }
    }

    // ゲーム状態のリセット
    gameState.isPlaying = true;
    NetSync.reset();
    DamageNumbers.reset();
    Particles.reset();
    Sandbox.showUI(gameState.isPractice);
    requestAnimationFrame(layoutGameScreen);
    BattleFx.reset();
    PoisonMist.reset();
    applyChatVisibility();
    gameState.units = [];
    gameState.bullets = [];
    gameState.summoningEffects = [];
    gameState.players.left.hp = 2000;
    gameState.players.left.maxHp = 2000;
    gameState.players.left.mana = 100;

    // 練習場の場合は右側のかかしHPを100万、対戦時は2000に設定
    if (gameState.isPractice) {
        gameState.players.right.hp = 1000000;
        gameState.players.right.maxHp = 1000000;
        gameState.players.right.name = 'カカシ';
    } else {
        gameState.players.right.hp = 2000;
        gameState.players.right.maxHp = 2000;
    }
    gameState.players.right.mana = 100;
    gameState.prepTimer = 450; // 15秒 (30FPS * 15)
    gameState.selectedCola = null;
    gameState.spaceFireCooldown = 0;
    gameState.extractionMode = false;
    gameState.extractionSelections = [];
    hideUnitPreview();

    // 名前の同期 (両クライアントが相手に送る)
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'signal', action: 'sync_name',
            side: gameState.playerSide,
            name: gameState.players[gameState.playerSide].name
        }));
    }

    if (!gameState.isPractice) {
        const btnExitP = document.getElementById('btn-exit-practice');
        if (btnExitP) btnExitP.classList.add('hidden');
    }
}

function attemptFireCola(autoAim = false) {
    // スペース連射防止: クールダウン中は発射しない
    if (gameState.spaceFireCooldown > 0) return;

    // マウスカーソル位置をターゲットにする（スマホ等で未操作の場合は相手プレイヤー本陣を自動照準）
    const otherSide = gameState.playerSide === 'left' ? 'right' : 'left';
    let tx = gameState.mousePos.x;
    let ty = gameState.mousePos.y;

    // スマホの発射ボタンは「最後にタップした場所（ふつうは自分の陣地）」ではなく相手本体を自動で狙う
    if (autoAim || (!tx && !ty)) {
        tx = gameState.playerSide === 'left' ? CONFIG.SCREEN_WIDTH - 16 : 16;
        ty = (gameState.players[otherSide] ? gameState.players[otherSide].y : 80) + 16;
    }

    // クールダウンをセット (30フレーム = 1秒)
    gameState.spaceFireCooldown = 30;

    if (gameState.isPractice || gameState.isBotMatch) {
        processFireColaTargetAll(tx, ty, gameState.playerSide);
        return;
    }

    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'signal',
            action: 'fire_cola_all',
            tx: tx,
            ty: ty,
            side: gameState.playerSide
        }));
        // ホストなら自分でも即座に実行
        if (gameState.isHost) {
            processFireColaTargetAll(tx, ty, gameState.playerSide);
        }
    } else {
        processFireColaTargetAll(tx, ty, gameState.playerSide);
    }
}

function processFireColaTargetAll(tx, ty, side) {
    if (gameState.prepTimer > 0) return; // 準備中は撃てない（以前はコーラだけ消えていた）
    gameState.units.forEach(u => {
        if (u.side === side && u.type === 'cola' && !u.fired) {
            u.fired = true;
            u.hp = -1;
            fireColaTarget(u, tx, ty);
        }
    });
}

function handleInput(e) {
    if (gameUI.classList.contains('hidden')) return;
    // スペース: 自分の陣地にいるコーラユニットを一斉発射（稲は発射しない）
    if (e.key === ' ') attemptFireCola();
    // E: 合成モードのトグル
    if (e.key === 'e' || e.key === 'E') toggleExtractionMode();

    // 1〜9キー、0キー: デッキユニットのショートカット選択（10枠対応）
    if (['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].includes(e.key)) {
        const slotIdx = e.key === '0' ? 9 : (parseInt(e.key, 10) - 1);
        const deck = Sandbox.selectableKeys();
        if (deck[slotIdx]) {
            const k = deck[slotIdx];
            gameState.selectedUnit = k;
            updateUnitUI();
            if (UNIT_TYPES[k]) showUnitPreview({ ...UNIT_TYPES[k], typeKey: k });
        }
    }
}

function updatePlayerMovement() {
    const side = gameState.playerSide;
    let oldY = gameState.players[side].y;

    if (keysPressed['ArrowUp'] || keysPressed['w'] || keysPressed['W']) {
        gameState.players[side].y = Math.max(0, gameState.players[side].y - CONFIG.PLAYER_SPEED);
    }
    if (keysPressed['ArrowDown'] || keysPressed['s'] || keysPressed['S']) {
        gameState.players[side].y = Math.min(CONFIG.SCREEN_HEIGHT - 32, gameState.players[side].y + CONFIG.PLAYER_SPEED);
    }

    if (oldY !== gameState.players[side].y && !gameState.isPractice && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'signal',
            action: 'move',
            side: side,
            y: gameState.players[side].y
        }));
    }
}

// ===============================================================
// 📡 オンライン同期（ホスト → 参加者）の軽量化
// 以前は gameState 全体を毎フレーム(30回/秒)送っていたため、参加者側で受信が詰まり
// 遅延がどんどん溜まっていた。必要な情報だけを短い形で 15回/秒 送る。
// ===============================================================
const NetSync = {
    SEND_EVERY: 2,             // 2フレームに1回送信（30FPS → 15回/秒）
    KEYFRAME_EVERY: 30,        // 30回送るごと（約2秒）にユニットの全情報を送り直す
    MAX_BUFFERED: 32 * 1024,   // 送信待ちがこれ以上溜まっていたら今回は送らない（遅延の積み重なり防止）

    // 試合中に頻繁に変わる／参加者側では不要なユニット項目（全情報の比較から外す）
    DYNAMIC_KEYS: new Set([
        'hp', 'x', 'y', 'charge', 'fired', 'hasBubbleShield',
        'lastFire', 'aiFireTimer', 'healTick', 'bubbleTick', 'woodRegenTick',
        'reflectHits', 'hasBeenHitBy', 'markedForDestruction', 'woodBursted'
    ]),

    frame: 0,
    sendCount: 0,
    sentUnitSig: new Map(), // ホスト用: uid → 最後に送ったユニット全情報(JSON文字列)
    unitCache: new Map(),   // 参加者用: uid → ユニット（同じオブジェクトを使い続ける）

    reset() {
        this.frame = 0;
        this.sendCount = 0;
        this.sentUnitSig.clear();
        this.unitCache.clear();
        this.seenEvolution.clear();
    },

    // 参加者用: シークレット・最終形態の誕生に気づいたら、図鑑登録とカットインを行う
    // （計算はホストがするので、以前は参加者が作ったシークレットが図鑑に登録されなかった）
    seenEvolution: new Map(), // uid → 'secret' | 'final'
    noticeEvolution(u) {
        const state = u.isFinalForm ? 'final' : (u.isSecretChimera && u.chimeraId ? 'secret' : null);
        if (!state || this.seenEvolution.get(u.uid) === state) return;
        this.seenEvolution.set(u.uid, state);
        const isMine = u.side === gameState.playerSide;
        if (state === 'final') {
            showSecretEvolutionCutin('？？？', 'FINAL EVOLUTION');
            statusMsg.innerText = isMine ? '最終進化！「？？？」が誕生した……' : '⚠ 相手が最終形態「？？？」を誕生させた……';
            return;
        }
        const chimera = Object.values(SECRET_CHIMERAS).find(c => c.id === u.chimeraId);
        if (!chimera) return;
        if (isMine) {
            try {
                const disc = JSON.parse(localStorage.getItem('inamu_discovered_chimeras') || '[]');
                if (!disc.includes(chimera.id)) {
                    disc.push(chimera.id);
                    CloudSyncManager.saveDiscoveredChimeras(disc);
                }
            } catch (e) {}
        }
        showSecretEvolutionCutin(chimera.name);
        statusMsg.innerText = isMine ? `シークレット進化！「${chimera.name}」が誕生した！` : `⚠ 相手がシークレット「${chimera.name}」を誕生させた！`;
    },

    r1(v) { return Math.round((v || 0) * 10) / 10; },
    r2(v) { return Math.round((v || 0) * 100) / 100; },

    staticPart(u) {
        const o = {};
        for (const k in u) {
            if (!this.DYNAMIC_KEYS.has(k) && typeof u[k] !== 'function') o[k] = u[k];
        }
        return o;
    },

    // ホスト: 送信用の短いデータを作る
    buildPacket(keyframe) {
        const L = gameState.players.left, R = gameState.players.right;
        const p = [this.r1(L.y), this.r1(L.hp), this.r1(L.mana), this.r1(R.y), this.r1(R.hp), this.r1(R.mana), L.throwTimer || 0, R.throwTimer || 0];

        // ユニット: 毎回は「変わる値」だけ。全情報は新規・変化時・キーフレーム時のみ
        const ud = [], uf = [];
        const alive = new Set();
        for (const u of gameState.units) {
            if (!u.uid) continue;
            alive.add(u.uid);
            const sig = JSON.stringify(this.staticPart(u));
            if (keyframe || this.sentUnitSig.get(u.uid) !== sig) {
                uf.push(JSON.parse(sig));
                this.sentUnitSig.set(u.uid, sig);
            }
            ud.push([u.uid, this.r1(u.hp), this.r1(u.x), this.r1(u.y), this.r2(u.charge), u.fired ? 1 : 0, u.hasBubbleShield ? 1 : 0]);
        }
        for (const uid of this.sentUnitSig.keys()) {
            if (!alive.has(uid)) this.sentUnitSig.delete(uid);
        }

        // 弾: 描画に必要な [x, y, vx, vy, 見た目, 種類] だけ
        const b = gameState.bullets.map(bl => [this.r1(bl.x), this.r1(bl.y), this.r2(bl.vx), this.r2(bl.vy), bl.spriteKey || 0, bl.action || 0]);

        // 召喚・吸収エフェクト: unitDef は参加者側で typeKey から復元する
        const e = gameState.summoningEffects.map(ef => {
            const o = { ...ef, x: this.r1(ef.x), y: this.r1(ef.y), progress: this.r2(ef.progress) };
            delete o.unitDef;
            return o;
        });

        // ダメージ数字（参加者の画面にも出す）
        const d = DamageNumbers.takePending();

        return { p, ud, uf, b, e, d, fx: BattleFx.pack() };
    },

    // ホスト: ゲームループから毎フレーム呼ぶ
    trySend() {
        this.frame++;
        if (this.frame % this.SEND_EVERY !== 0) return;
        if (socket.bufferedAmount > this.MAX_BUFFERED) return; // 回線が詰まっているときは見送る
        const keyframe = this.sendCount % this.KEYFRAME_EVERY === 0;
        socket.send(JSON.stringify({ type: 'signal', action: 'state', s: this.buildPacket(keyframe) }));
        this.sendCount++;
    },

    // 参加者: 受け取ったデータを盤面に反映する
    apply(s) {
        const P = gameState.players;
        const otherSide = gameState.playerSide === 'left' ? 'right' : 'left';
        const [ly, lhp, lm, ry, rhp, rm, lt, rt] = s.p;
        // 自分の位置は自分で動かしているので、相手の位置だけ反映
        if (otherSide === 'left') P.left.y = ly; else P.right.y = ry;
        P.left.hp = lhp; P.left.mana = lm; P.left.throwTimer = lt;
        P.right.hp = rhp; P.right.mana = rm; P.right.throwTimer = rt;

        // ユニット全情報の更新（オブジェクトは使い回して、詳細表示中の参照が切れないようにする）
        for (const full of (s.uf || [])) {
            const ex = this.unitCache.get(full.uid);
            if (ex) {
                for (const k of Object.keys(ex)) {
                    if (!this.DYNAMIC_KEYS.has(k)) delete ex[k];
                }
                Object.assign(ex, full);
            } else {
                this.unitCache.set(full.uid, full);
                Particles.summon(full.x, full.y, full.side);
            }
        }
        const units = [];
        const alive = new Set();
        for (const d of (s.ud || [])) {
            const u = this.unitCache.get(d[0]);
            if (!u) continue; // 全情報がまだ届いていない（次のキーフレームで届く）
            u.hp = d[1]; u.x = d[2]; u.y = d[3]; u.charge = d[4];
            u.fired = !!d[5]; u.hasBubbleShield = !!d[6];
            units.push(u);
            this.noticeEvolution(u);
            alive.add(d[0]);
        }
        for (const [uid, u] of this.unitCache) {
            if (alive.has(uid)) continue;
            // 発射したコーラ・合成の素材以外で、弱っていたユニットが消えた → やられた
            if (!u.fired && u.hp < (u.maxHp || u.hp) * 0.6) Particles.debris(u.x, u.y, u.type);
            this.unitCache.delete(uid);
        }
        gameState.units = units;

        gameState.bullets = (s.b || []).map(a => ({
            x: a[0], y: a[1], vx: a[2], vy: a[3],
            spriteKey: a[4] || undefined, action: a[5] || undefined
        }));

        BattleFx.unpack(s.fx);
        (s.d || []).forEach(a => DamageNumbers.spawn(a[0], a[1], a[2], a[3] === 1 ? 'player' : 'unit', a[4]));

        gameState.summoningEffects = (s.e || []).map(ef => (
            ef.typeKey && UNIT_TYPES[ef.typeKey] ? { ...ef, unitDef: UNIT_TYPES[ef.typeKey] } : ef
        ));
    }
};

// ゲームループ (30FPS 制限)
let lastTime = 0;
const interval = 1000 / CONFIG.FPS;

function gameLoop(timestamp = 0) {
    const deltaTime = timestamp - lastTime;

    if (deltaTime >= interval) {
        lastTime = timestamp - (deltaTime % interval);
        // 試合中だけゲームを進める（試合後に勝敗判定や送信が繰り返されるのを防ぐ）
        if (gameState.isPlaying) update();
        draw();
        DPSManager.tick();

        // オンライン対戦のホストだけ、盤面を相手へ送る
        if (gameState.isPlaying && gameState.isHost && !gameState.isBotMatch && !gameState.isPractice &&
            socket && socket.readyState === WebSocket.OPEN) {
            NetSync.trySend();
        }
    }

    // 背景アニメーション (滑らかに)
    bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
    bgParticles.forEach(p => {
        p.update();
        p.draw();
    });

    requestAnimationFrame(gameLoop);
}

function update() {
    updatePlayerMovement();

    // 🤖 CPUの思考ルーチン実行（CPU対戦・練習場でかかしをCPUにしたとき）
    if (gameState.isBotMatch || Sandbox.cpuActive()) {
        BotAI.update();
    }
    // 🧪 練習場の無限設定
    Sandbox.tick();

    // 🌋 フィールドギミックの更新 (炭酸ファウンテン加速・黄金稲穂リスポーン・ポータル)
    FieldGimmickManager.update();

    // 準備時間のカウントダウン
    if (gameState.prepTimer > 0) gameState.prepTimer--;

    gameState.manaTimer += 1 / CONFIG.FPS;
    if (gameState.manaTimer >= 0.4) { // 0.4秒に1回復（従来の2.5倍）
        gameState.manaTimer = 0;
        gameState.players.left.mana = Math.min(100, gameState.players.left.mana + 1);
        const rb = cpuBuff('right');
        gameState.players.right.mana = Math.min(100, gameState.players.right.mana + (rb ? rb.manaRate : 1));
    }
    if (gameState.players.left.throwTimer > 0) gameState.players.left.throwTimer--;
    if (gameState.players.right.throwTimer > 0) gameState.players.right.throwTimer--;

    // ソーダ＆シールドの特殊能力・マナ生成の更新
    gameState.units.forEach(u => {
        if (u.hp <= 0) return;

        // マナ生成
        if (u.manaGen > 0) {
            gameState.players[u.side].mana = Math.min(100, gameState.players[u.side].mana + u.manaGen);
        }

        // 🫧 ソーダ オツェアーン【満潮ヒーリング】: プレイヤー本体HPを毎秒+2回復
        if (u.special === 'ocean_heal' || u.actions?.includes('ocean_heal')) {
            u.healTick = (u.healTick || 0) + 1;
            if (u.healTick >= CONFIG.FPS) {
                u.healTick = 0;
                const p = gameState.players[u.side];
                if (p) p.hp = Math.min(p.maxHp || 2000, p.hp + 2);
            }
        }

        // 🫧 ソーダ クヴェレ【泡の防護膜】: 6秒ごとに最も弱った味方にバブルシールド付与
        if (u.special === 'quelle_bubble' || u.actions?.includes('quelle_bubble')) {
            u.bubbleTick = (u.bubbleTick || 0) + 1;
            if (u.bubbleTick >= CONFIG.FPS * 6) {
                u.bubbleTick = 0;
                // 同陣地でバブル未所持のユニットを探す
                const candidates = gameState.units.filter(target => target.side === u.side && target.hp > 0 && !target.hasBubbleShield);
                if (candidates.length > 0) {
                    // HP割合が最も低いユニットを優先
                    candidates.sort((a, b) => (a.hp / (a.maxHp || a.hp || 1)) - (b.hp / (b.maxHp || b.hp || 1)));
                    candidates[0].hasBubbleShield = true;
                }
            }
        }

        // 🛡️ ホルツ シルト【芽吹き再生】: 毎秒自分のHPを+2自然回復
        if (u.special === 'wood_regen' || u.actions?.includes('wood_regen')) {
            u.woodRegenTick = (u.woodRegenTick || 0) + 1;
            if (u.woodRegenTick >= CONFIG.FPS) {
                u.woodRegenTick = 0;
                const maxHp = u.maxHp || 117;
                if (u.hp < maxHp) {
                    u.hp = Math.min(maxHp, u.hp + 4); // HP1.8倍に合わせて回復量も増やす
                }
            }
        }
    });

    // スペース発射クールダウンのデクリメント
    if (gameState.spaceFireCooldown > 0) gameState.spaceFireCooldown--;

    const isAuthority = gameState.isHost || gameState.isPractice || gameState.isBotMatch;

    if (isAuthority) {
        gameState.units.forEach(u => {
            // シークレット・最終形態は合成回数が0でも、合体した能力で撃つ
            const usesMergedAbilities = u.extractionCount > 0 || u.isSecretChimera;
            if (u.type === 'rice' || usesMergedAbilities) {
                // 🫧 ソーダ ブリーゼ【追い風エール】: 同列(同じrow)にブリーゼがいる場合、攻撃速度+25%加速！
                const hasBreeze = gameState.units.some(s => s.side === u.side && s.hp > 0 && s.row === u.row && (s.special === 'breeze_haste' || s.actions?.includes('breeze_haste')));
                const fireInc = hasBreeze ? 1.25 : 1.0;
                u.lastFire = (u.lastFire || 0) + fireInc;
                if (u.lastFire >= (u.cooldown || 2) * CONFIG.FPS) {
                    u.lastFire = 0;
                    if (usesMergedAbilities) {
                        // （以前はシークレット誕生で回数を0に戻した結果、元のユニットの撃ち方に戻っていた）
                        fireExtractionUnit(u);
                    } else if (u.type === 'rice') {
                        fireUnit(u);
                    }
                }
            }
            if (u.type === 'cola' && u.action === 'charge' && !u.fired) {
                u.charge = Math.min(1, (u.charge || 0) + 1 / (8 * CONFIG.FPS));
            }

            // 練習場専用の敵AI: コーラを発射する
            if (gameState.isPractice && !Sandbox.cpuActive() && u.side === 'right' && u.type === 'cola' && !u.fired && u.hp > 0) {
                u.aiFireTimer = (u.aiFireTimer || 0) + 1 / CONFIG.FPS;
                if (u.aiFireTimer >= 3.0) {
                    u.aiFireTimer = 0;
                    const targetX = 16;
                    const targetY = gameState.players.left.y + 16;
                    processFireColaTarget(u.x, u.y, targetX, targetY, 'right');
                }
            }
        });
    }

    // 物理・弾の移動および当たり判定（ホスト／練習場／Bot戦が一元計算）
    if (isAuthority) {
        PoisonMist.update();
        for (let i = gameState.bullets.length - 1; i >= 0; i--) {
            const b = gameState.bullets[i];
            let speedMult = CONFIG.BULLET_SPEED_RATE;
            if (b.action === 'bounce') speedMult *= 1.6;
            b.x += b.vx * speedMult; b.y += b.vy * speedMult;

            // 💥 コーラ同士の衝突: 攻撃力の大きい方が残り、相手の分だけ攻撃力が減る（同じなら両方消える）
            if (b.isCola) {
                let destroyedSelf = false;
                for (let k = gameState.bullets.length - 1; k >= 0; k--) {
                    const eb = gameState.bullets[k];
                    if (eb === b || !eb.isCola || eb.side === b.side) continue;
                    const reach = ((b.size || 16) + (eb.size || 16)) / 2 - 2;
                    if (Math.abs(b.x - eb.x) > reach || Math.abs(b.y - eb.y) > reach) continue;
                    // ゲイザーは70%で衝突をかわす（同じ相手には1回だけ判定）
                    if (geyserEvades(b, eb) || geyserEvades(eb, b)) continue;
                    const pb = b.power || 0, pe = eb.power || 0;
                    addCollisionSpark((b.x + eb.x) / 2, (b.y + eb.y) / 2);
                    if (pb > pe) {
                        b.power = pb - pe;
                        removeBullet(k);
                        if (k < i) i--;
                    } else if (pe > pb) {
                        eb.power = pe - pb;
                        destroyedSelf = true;
                    } else {
                        removeBullet(k);
                        if (k < i) i--;
                        destroyedSelf = true;
                    }
                    break;
                }
                if (destroyedSelf) { removeBullet(i); continue; }
            }

            // 重力黒コーラ（ネビュラ）: 近くの敵弾を引き寄せて消し、マナに変える（弱体化: 範囲45→30、引く力0.9→0.35）
            if (b.action === 'blackhole') {
                for (let k = gameState.bullets.length - 1; k >= 0; k--) {
                    const eb = gameState.bullets[k];
                    if (eb.side !== b.side && eb !== b) {
                        const edx = b.x - eb.x; const edy = b.y - eb.y;
                        const edist = Math.hypot(edx, edy);
                        if (edist < BLACKHOLE_RANGE && edist > 0) {
                            if (geyserEvades(eb, b)) continue; // ゲイザーは70%で吸い込みをかわす
                            eb.vx += (edx / edist) * BLACKHOLE_PULL;
                            eb.vy += (edy / edist) * BLACKHOLE_PULL;
                            if (edist < 14) {
                                removeBullet(k);
                                if (k < i) i--;
                                const myP = gameState.players[b.side];
                                if (myP) myP.mana = Math.min(100, myP.mana + 0.8);
                            }
                        }
                    }
                }
            }

            // ☠ 毒の霧: 霧を通る敵の弾は威力が半分になる（1発につき1回）
            if (!b.mistSlowed && PoisonMist.list.length > 0) {
                const mist = PoisonMist.list.find(m => m.side !== b.side && Math.hypot(b.x - m.x, b.y - m.y) < m.r);
                if (mist && !geyserEvades(b, mist)) {
                    b.mistSlowed = true;
                    b.power = Math.max(1, Math.floor((b.power || 5) * 0.5));
                }
            }

            // フロスト ライス（氷結）: 敵弾と相殺（両方消滅）
            if (b.action === 'frost' || b.actions?.includes('frost')) {
                let hitFrost = false;
                for (let k = gameState.bullets.length - 1; k >= 0; k--) {
                    const eb = gameState.bullets[k];
                    if (eb.side !== b.side && eb !== b) {
                        if (Math.hypot(b.x - eb.x, b.y - eb.y) < 14) {
                            if (geyserEvades(eb, b)) continue; // ゲイザーは70%で相殺をかわす
                            removeBullet(k);
                            if (k < i) i--;
                            hitFrost = true;
                            break;
                        }
                    }
                }
                if (hitFrost) {
                    if (b.action === 'spread' || b.actions?.includes('spread') || b.spread) {
                        handleSpreadEffect({ x: b.x, y: b.y, side: b.side });
                    }
                    removeBullet(i);
                    continue;
                }
            }

            // コーラ ゲイザー: 相手本体の方へぐいっと曲がりながら、大きく蛇行して急加速
            if (b.action === 'geyser') {
                b.geyserTimer = (b.geyserTimer || 0) + 1;
                // 進む向き（headAng）は相手本体へ向かって曲がる
                if (b.headAng === undefined) b.headAng = Math.atan2(b.vy, b.vx);
                const target = gameState.players[b.side === 'left' ? 'right' : 'left'];
                const gx = (b.side === 'left' ? CONFIG.SCREEN_WIDTH - 16 : 16) - b.x;
                const gy = (target.y + 16) - b.y;
                let turn = Math.atan2(gy, gx) - b.headAng;
                while (turn > Math.PI) turn -= Math.PI * 2;
                while (turn < -Math.PI) turn += Math.PI * 2;
                b.headAng += Math.max(-0.12, Math.min(0.12, turn)); // 1フレームに曲がれる角度
                // 実際の向きは、進む向きを中心に大きくうねる（読まれにくい）
                const ang = b.headAng + Math.sin(b.geyserTimer * 0.3) * 0.65;
                const spdNow = Math.min(10.5, Math.hypot(b.vx, b.vy) * 1.02);
                b.vx = Math.cos(ang) * spdNow;
                b.vy = Math.sin(ang) * spdNow;
            }
            if (b.homing) {
                const target = b.side === 'left' ? gameState.players.right : gameState.players.left;
                const targetX = b.side === 'left' ? CONFIG.SCREEN_WIDTH - 16 : 16;
                const targetY = target.y + 16;
                const dx = targetX - b.x; const dy = targetY - b.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist > 0) {
                    b.vx += (dx / dist) * 0.1; b.vy += (dy / dist) * 0.1;
                    const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
                    if (speed > 3) { b.vx = (b.vx / speed) * 3; b.vy = (b.vy / speed) * 3; }
                }
            }
            if (b.lifetime !== undefined) {
                b.lifetime--;
                if (b.lifetime <= 0) {
                    if (b.split) {
                        const angle = Math.atan2(b.vy, b.vx); const spd = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
                        spawnBullet(b.x, b.y, Math.cos(angle + 0.2) * spd, Math.sin(angle + 0.2) * spd, b.side, { power: b.power, spriteKey: b.spriteKey, size: b.size });
                        spawnBullet(b.x, b.y, Math.cos(angle - 0.2) * spd, Math.sin(angle - 0.2) * spd, b.side, { power: b.power, spriteKey: b.spriteKey, size: b.size });
                        b.lifetime = 1000; b.split = false;
                    } else { removeBullet(i); continue; }
                }
            }
            const leftP = gameState.players.left; const rightP = gameState.players.right;
            let hitPlayer = false;
            if (b.side === 'right' && Math.abs(b.x - 16) < 16 && Math.abs(b.y - (leftP.y + 16)) < 16) {
                if (!b.hitPlayers?.includes('left')) {
                    leftP.hp -= (b.power || 5);
                    DamageNumbers.add(16, leftP.y, b.power || 5, 'player', 'P_left');
                    if (b.action === 'poison') PoisonMist.spawn(b.x, b.y, b.side);
                    SoundManager.playHit();
                    if (!b.hitPlayers) b.hitPlayers = [];
                    b.hitPlayers.push('left');
                    hitPlayer = true;
                }
            }
            if (b.side === 'left' && Math.abs(b.x - (CONFIG.SCREEN_WIDTH - 16)) < 16 && Math.abs(b.y - (rightP.y + 16)) < 16) {
                if (!b.hitPlayers?.includes('right')) {
                    const dmg = (b.power || 5);
                    rightP.hp -= dmg;
                    DamageNumbers.add(CONFIG.SCREEN_WIDTH - 16, rightP.y, dmg, 'player', 'P_right');
                    if (b.action === 'poison') PoisonMist.spawn(b.x, b.y, b.side);
                    DPSManager.recordDamage(dmg);
                    SoundManager.playHit();
                    if (!b.hitPlayers) b.hitPlayers = [];
                    b.hitPlayers.push('right');
                    hitPlayer = true;
                }
            }
            if (hitPlayer) {
                if (b.pierceCount && b.pierceCount > 0) {
                    b.pierceCount--;
                } else {
                    if (b.action === 'spread') {
                        const spreadX = b.x - b.vx * 0.5;
                        const spreadY = b.y - b.vy * 0.5;
                        handleSpreadEffect({ x: spreadX, y: spreadY, side: b.side });
                    }
                    removeBullet(i); continue;
                }
            }
            let hitUnit = false;
            for (let j = 0; j < gameState.units.length; j++) {
                const u = gameState.units[j];
                if (u.side !== b.side && u.hp > 0 && u.fireType !== 'mine' && !u.hasBeenHitBy?.includes(b.uid)) {
                    if (Math.abs(b.x - u.x) < 20 && Math.abs(b.y - u.y) < 20) {
                        // 🫧 ソーダ クヴェレの「泡の防護膜（バブルシールド）」判定
                        if (u.hasBubbleShield) {
                            u.hasBubbleShield = false;
                            SoundManager.playHit();
                            hitUnit = true;
                            break; // ダメージ完全無効化
                        }

                        let dmg = (b.power || 5);

                        // 🛡️ アイゼン シルト（鉄盾）: ダメージ25%軽減＋3回被弾で反射弾を射出
                        if (u.special === 'iron_reflect' || u.actions?.includes('iron_reflect')) {
                            dmg = Math.max(1, Math.floor(dmg * 0.75));
                            u.reflectHits = (u.reflectHits || 0) + 1;
                            if (u.reflectHits >= 3) {
                                u.reflectHits = 0;
                                const refVx = u.side === 'left' ? 4.5 : -4.5;
                                spawnBullet(u.x + (u.side === 'left' ? 16 : -16), u.y, refVx, (Math.random() - 0.5) * 1.5, u.side, { power: 12, bounce: 2, spriteKey: 'bullet' });
                                SoundManager.playFire();
                            }
                        }

                        // 🛡️ アウラ シルト（魔力盾）: 被弾ダメージを自軍マナへ変換
                        if (u.special === 'aura_absorb' || u.actions?.includes('aura_absorb')) {
                            const p = gameState.players[u.side];
                            if (p) p.mana = Math.min(100, p.mana + dmg * 0.2);
                        }

                        u.hp -= dmg;
                        DamageNumbers.add(u.x, u.y - 12, dmg, 'unit', u.uid);
                        // ⚡ 電撃チェーン（コーラ ブリッツ）: 最初に当たったときだけ連鎖
                        if (b.chain) { b.chain = false; chainLightning(u, dmg); }
                        // ☠ 毒の霧（ギフト ライス）
                        if (b.action === 'poison') PoisonMist.spawn(u.x, u.y, b.side);

                        // 🛡️ ホルツ シルト（木盾）破壊時: 周囲の味方HPを小回復
                        if (u.hp <= 0 && (u.special === 'wood_regen' || u.actions?.includes('wood_regen')) && !u.woodBursted) {
                            u.woodBursted = true;
                            gameState.units.forEach(adj => {
                                if (adj.side === u.side && adj.hp > 0 && adj !== u && Math.hypot(adj.x - u.x, adj.y - u.y) < 60) {
                                    adj.hp = Math.min(adj.maxHp || adj.hp, adj.hp + 27); // HP1.8倍に合わせて回復量も増やす
                                }
                            });
                        }

                        if (b.side === 'left') {
                            DPSManager.recordDamage(dmg);
                        }
                        SoundManager.playHit();
                        hitUnit = true;
                        if (b.pierceCount !== undefined) {
                            if (!b.hitTargets) b.hitTargets = [];
                            if (!u.hasBeenHitBy) u.hasBeenHitBy = [];
                            b.hitTargets.push(u.uid);
                            u.hasBeenHitBy.push(b.uid);
                        }
                        break;
                    }
                }
            }
            if (hitUnit) {
                if (b.pierceCount && b.pierceCount > 0) {
                    b.pierceCount--;
                } else {
                    if (b.action === 'spread') {
                        const spreadX = b.x - b.vx * 0.5;
                        const spreadY = b.y - b.vy * 0.5;
                        handleSpreadEffect({ x: spreadX, y: spreadY, side: b.side });
                    }
                    removeBullet(i); continue;
                }
            }

            // 壁際での拡散
            if (b.action === 'spread' && (b.x < 0 || b.x > CONFIG.SCREEN_WIDTH || b.y < 0 || b.y > CONFIG.SCREEN_HEIGHT)) {
                const spreadX = Math.max(0, Math.min(CONFIG.SCREEN_WIDTH, b.x));
                const spreadY = Math.max(0, Math.min(CONFIG.SCREEN_HEIGHT, b.y));
                handleSpreadEffect({ x: spreadX, y: spreadY, side: b.side });
                removeBullet(i); continue;
            }
            if (b.x < 0 || b.x > CONFIG.SCREEN_WIDTH || b.y < 0 || b.y > CONFIG.SCREEN_HEIGHT) {
                if (b.bounce && b.bounce > 0) { b.vy *= -1; b.bounce--; continue; }
                removeBullet(i); continue;
            }
        }
    } else {
        // 参加者側: ホストから届くのは15回/秒なので、間のフレームは弾を見た目だけ進めて滑らかにする
        // （当たり判定はホストが行い、次に届いたデータで正しい位置に上書きされる）
        for (const b of gameState.bullets) {
            const speedMult = (b.action === 'bounce' ? 1.6 : 1.0) * CONFIG.BULLET_SPEED_RATE;
            b.x += b.vx * speedMult; b.y += b.vy * speedMult;
        }
    }
    for (let i = gameState.summoningEffects.length - 1; i >= 0; i--) {
        const ef = gameState.summoningEffects[i];
        ef.progress += 1 / ef.duration;

        if (ef.type === 'absorption') {
            const t = ef.progress;
            ef.x = ef.startX + (ef.targetX - ef.startX) * t;
            ef.y = ef.startY + (ef.targetY - ef.startY) * t;
            if (ef.progress >= 1.0) {
                gameState.summoningEffects.splice(i, 1);
            }
            continue;
        }

        const startX = ef.side === 'left' ? 16 : CONFIG.SCREEN_WIDTH - 16;
        const startY = gameState.players[ef.side].y + 16;
        const t = ef.progress;
        ef.x = startX + (ef.targetX - startX) * t;
        const peakHeight = 120;
        ef.y = startY + (ef.targetY - startY) * t - peakHeight * 4 * (t - t * t);
        if (ef.progress >= 1.0) { finalizeSummon(ef); gameState.summoningEffects.splice(i, 1); }
    }
    // ユニット破壊時の音
    gameState.units.forEach(u => {
        if (u.hp <= 0 && !u.markedForDestruction) {
            u.markedForDestruction = true;
            SoundManager.playExplosion();
            if (!u.fired) Particles.debris(u.x, u.y, u.type);
        }
    });
    gameState.units = gameState.units.filter(u => u.hp > 0);
    if (gameState.isHost || gameState.isPractice || gameState.isBotMatch) {
        if (gameState.players.left.hp <= 0 || gameState.players.right.hp <= 0) {
            const winner = gameState.players.left.hp <= 0 ? 'right' : 'left';
            if (gameState.isBotMatch) {
                endGame(winner);
            } else if (!gameState.isPractice) {
                if (socket && socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: 'signal', action: 'game_over', winner }));
                }
                endGame(winner);
            } else {
                statusMsg.innerText = "練習場：リセット！";
                // 練習場ではHPを戻して続行
                gameState.players.left.hp = gameState.players.left.maxHp || 2000;
                gameState.players.right.hp = gameState.players.right.maxHp || 2000;
            }
        }
    }
}

function fireUnit(u) {
    if (gameState.prepTimer > 0) return; // 準備時間は撃たない
    SoundManager.playFire();
    const unitDef = UNIT_TYPES[u.typeKey];
    if (!unitDef) return;
    let spd = 2.0;
    let actExt = {};
    if (u.action === 'bounce') actExt.bounce = 3;
    if (u.action === 'split') { actExt.split = true; actExt.lifetime = 40; }
    if (u.action === 'pierce') { actExt.pierce = true; u.power = 22; }
    if (u.action === 'charge') actExt.powerBonus = 25;
    if (u.action === 'glide') { actExt.lifetime = 200; spd *= 0.4; actExt.power = 20; }
    if (u.action === 'straight') actExt.power = 25;

    // 新種アクションの能力付与
    if (u.action === 'laser') {
        actExt.action = 'laser';
        actExt.pierce = true;
        actExt.pierceCount = 3; // 3体貫通
        spd *= 2.8; // 高速レーザー
    }
    if (u.action === 'poison') {
        actExt.action = 'poison'; // 触れた敵弾を弱体化
    }
    if (u.action === 'frost') {
        actExt.action = 'frost'; // 敵弾と相殺
    }
    if (u.action === 'sniper') {
        actExt.action = 'sniper';
        actExt.pierce = true;
        actExt.pierceCount = 4; // 前線の敵を貫いて本体を撃ち抜く
        spd *= 2.5;
    }

    const fire = (x, y, vx, vy, side, extra = {}) => {
        let p = extra.power || u.power || unitDef.power || 5;
        if (extra.homing || actExt.homing) p = Math.max(2, Math.floor(p * 0.6));
        if (actExt.powerBonus) p += actExt.powerBonus;
        
        let pCount = extra.pierceCount || actExt.pierceCount || 0;
        if (actExt.pierce || (u.actions && u.actions.includes('pierce')) || u.action === 'pierce') {
            pCount = Math.max(pCount, 1 + (u.extractionCount || 0));
        }

        spawnBullet(x, y, vx, vy, side, { ...extra, ...actExt, power: p, pierceCount: pCount });
    };

    const ft = u.fireType;
    if (!ft || ft === 'none') return;
    
    // アクションの複合化（homing がアクションにある場合は全弾に付与）
    if ((u.actions && u.actions.includes('homing')) || u.action === 'homing') actExt.homing = true;

    // 狙撃稲（プレツィザ ライス）は敵プレイヤー本体を正確に狙い撃つ
    if (u.action === 'sniper') {
        const targetSide = u.side === 'left' ? 'right' : 'left';
        const targetP = gameState.players[targetSide];
        const targetX = u.side === 'left' ? CONFIG.SCREEN_WIDTH - 16 : 16;
        const targetY = (targetP ? targetP.y : 80) + 16;
        const dx = targetX - u.x;
        const dy = targetY - u.y;
        const dist = Math.hypot(dx, dy) || 1;
        fire(u.x, u.y, (dx / dist) * spd, (dy / dist) * spd, u.side);
        return;
    }

    if (ft === '8dir' && u.id === 'rice_1') {
        // ライス プリムスは前方3方向射撃
        const baseAng = u.side === 'left' ? 0 : Math.PI;
        fire(u.x, u.y, Math.cos(baseAng) * 2.5 * spd, Math.sin(baseAng) * 2.5 * spd, u.side);
        fire(u.x, u.y, Math.cos(baseAng + 0.3) * 2.2 * spd, Math.sin(baseAng + 0.3) * 2.2 * spd, u.side);
        fire(u.x, u.y, Math.cos(baseAng - 0.3) * 2.2 * spd, Math.sin(baseAng - 0.3) * 2.2 * spd, u.side);
    } else if (ft === '8dir') {
        for (let ang = 0; ang < Math.PI * 2; ang += Math.PI / 4) fire(u.x, u.y, Math.cos(ang) * 2 * spd, Math.sin(ang) * 2 * spd, u.side);
    } else if (ft === 'circle6') {
        for (let ang = 0; ang < Math.PI * 2; ang += Math.PI / 3) fire(u.x, u.y, Math.cos(ang) * 1.5 * spd, Math.sin(ang) * 1.5 * spd, u.side);
    } else if (ft === 'burst') {
        const baseAng = u.side === 'left' ? 0 : Math.PI;
        fire(u.x, u.y, Math.cos(baseAng) * 4 * spd, Math.sin(baseAng) * 4 * spd, u.side);
        fire(u.x, u.y - 8, Math.cos(baseAng) * 3.5 * spd, Math.sin(baseAng) * 3.5 * spd, u.side);
        fire(u.x, u.y + 8, Math.cos(baseAng) * 3.5 * spd, Math.sin(baseAng) * 3.5 * spd, u.side);
    } else if (ft === 'homing2') {
        fire(u.x, u.y, u.side === 'left' ? 2 * spd : -2 * spd, 0, u.side, { homing: true });
        fire(u.x, u.y, u.side === 'left' ? 2 * spd : -2 * spd, 0.5 * spd, u.side, { homing: true });
    } else if (ft === 'single') {
        fire(u.x, u.y, u.side === 'left' ? 2.5 * spd : -2.5 * spd, 0, u.side);
    }
}

function spawnBullet(x, y, vx, vy, side, extra = {}) {
    const b = bulletPool.pop() || { x, y, vx, vy, side };
    b.hp = 1; b.x = x; b.y = y; b.vx = vx; b.vy = vy; b.side = side;
    b.uid = Math.random().toString(36).substr(2, 9); // バグ修正: 貫通判定のためにuidを付与
    // リセット
    b.bounce = undefined; b.homing = false; b.split = false; b.spriteKey = undefined;
    b.size = undefined; b.power = undefined; b.lifetime = undefined; b.pierce = false;
    b.action = undefined; // アクションもリセット
    b.hitTargets = undefined; b.hitPlayers = undefined; b.hasBeenHitBy = undefined;
    b.isCola = false; b.chain = false; b.evadedFrom = undefined; b.mistSlowed = false; b.geyserTimer = 0; b.headAng = undefined;
    Object.assign(b, { x, y, vx, vy, side, ...extra });
    // 弾が遅くなった分、寿命(フレーム数)を延ばして届く距離は今までと同じにする
    if (extra.lifetime !== undefined) b.lifetime = Math.round(extra.lifetime / CONFIG.BULLET_SPEED_RATE);
    gameState.bullets.push(b);
}

function processFireColaTarget(cx, cy, tx, ty, side) {
    if (gameState.prepTimer > 0) return; // 準備中は撃てない（以前はコーラだけ消えていた）
    const u = gameState.units.find(u => u.side === side && u.type === 'cola' && !u.fired && u.x === cx && u.y === cy);
    if (u) { u.fired = true; u.hp = -1; fireColaTarget(u, tx, ty); }
}

function fireColaTarget(u, tx, ty) {
    if (gameState.prepTimer > 0) return; // 準備期間中は不可
    SoundManager.playFire();
    let spd = 6.0;
    // 零式コーラは超高速初速
    if (u.action === 'zero') spd = 9.0;

    const dx = tx - u.x; const dy = ty - u.y;
    const dist = Math.sqrt(dx * dx + dy * dy); let vx = 0; let vy = 0;
    if (dist > 0) { vx = (dx / dist) * spd; vy = (dy / dist) * spd; } else { vx = u.side === 'left' ? spd : -spd; }
    
    const extra = { spriteKey: u.typeKey, size: 16, action: u.action };
    if (u.actions && u.actions.includes('homing')) extra.homing = true;
    if (u.actions && u.actions.includes('split')) u.action = 'split';
    if (u.actions && u.actions.includes('bounce')) u.action = 'bounce';
    
    let pCount = extra.pierceCount || 0;
    if (u.action === 'pierce' || (u.actions && u.actions.includes('pierce'))) {
        pCount = 1 + (u.extractionCount || 0);
    }
    
    // 超巨大コーラ（ギガント）は前線を貫通して圧殺
    if (u.action === 'megaton') {
        extra.size = 24;
        pCount = 2;
    }
    extra.pierceCount = pCount;
    extra.isCola = true; // コーラ同士の衝突の判定に使う

    if (u.action === 'straight') spawnBullet(u.x, u.y, vx, vy, u.side, { power: colaPower('straight'), chain: true, ...extra }); // 電撃チェーン
    else if (u.action === 'bounce') spawnBullet(u.x, u.y, vx, vy, u.side, { bounce: 3, power: colaPower('bounce'), ...extra });
    else if (u.action === 'split') spawnBullet(u.x, u.y, vx, vy, u.side, { split: true, power: colaPower('split'), lifetime: 40, ...extra });
    else if (u.action === 'charge') {
        const bonus = Math.round((u.charge || 0) * 40 * COLA_POWER_RATE);
        spawnBullet(u.x, u.y, vx * (1.5 + (u.charge || 0)), vy * (1.5 + (u.charge || 0)), u.side, { power: colaPower('charge') + bonus, ...extra });
    } else if (u.action === 'blackhole') spawnBullet(u.x, u.y, vx * 0.7, vy * 0.7, u.side, { power: colaPower('blackhole'), ...extra });
    else spawnBullet(u.x, u.y, vx, vy, u.side, { power: colaPower(u.action), ...extra });
}

// ────────────────────────────────────────────────
// ユニットプレビューパネル
// ────────────────────────────────────────────────

const TYPE_LABEL = { rice: '稲', cola: 'コーラ', soda: 'ソーダ', extraction: '合成' };
const TYPE_COLOR = { rice: '#4a8', cola: '#c54', soda: '#48f', extraction: '#0cf' };

const ACTION_JP = {
    'straight': '直進・電撃チェーン', 'bounce': '跳弾', 'split': '分裂', 'charge': '溜め撃ち',
    'pierce': '貫通', 'spread': '爆散', 'glide': '滑空', 'homing': '追尾弾を撃つ',
    'laser': '高速レーザー照射', 'poison': '毒の霧', 'frost': '氷結弾相殺',
    'sniper': '本体直接狙撃', 'megaton': '超巨大重量圧殺', 'blackhole': '重力弾吸引変換',
    'geyser': '暴走カーブ・70%回避', 'zero': '零式高速投擲'
};

const FIRE_TYPE_JP = {
    '8dir': '8方向弾', 'circle6': '円形6発', 'homing2': '追尾弾×2',
    'burst': '3連射', 'single': '単発弾', 'none': 'なし'
};

function showUnitPreview(unit) {
    if (!unit || unit.hp <= 0) return;
    gameState.previewedUnit = unit;

    const panel = document.getElementById('unit-preview-panel');
    if (!panel) return;

    // ── スプライト ──
    const sprCanvas = document.getElementById('unit-preview-sprite');
    const sCtx = sprCanvas.getContext('2d');
    sCtx.clearRect(0, 0, 64, 64);

    // 最終形態は名前・ステータス・能力をすべて「？？？」にする
    if (unit.isFinalForm) {
        const g = sCtx.createRadialGradient(32, 32, 2, 32, 32, 28);
        g.addColorStop(0, 'rgba(0,0,0,0.95)');
        g.addColorStop(0.7, 'rgba(25,0,40,0.6)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        sCtx.fillStyle = g;
        sCtx.beginPath(); sCtx.arc(32, 32, 28, 0, Math.PI * 2); sCtx.fill();
        sCtx.fillStyle = 'rgba(255,40,60,0.8)';
        sCtx.fillRect(25, 29, 4, 4); sCtx.fillRect(35, 29, 4, 4);

        document.getElementById('unit-preview-name').textContent = '？？？';
        const fBadge = document.getElementById('unit-preview-type-badge');
        fBadge.textContent = '？？？';
        fBadge.style.background = '#22222255';
        fBadge.style.border = '1px solid #66666688';
        fBadge.style.color = '#aaa';
        const fStats = document.getElementById('unit-preview-stats');
        fStats.innerHTML = '';
        ['体力', '攻撃力', '攻撃速度'].forEach(label => {
            const row = document.createElement('div');
            row.className = 'preview-stat-row';
            row.innerHTML = `<span class="preview-stat-label">${label}</span><span class="preview-stat-value">？？？</span>`;
            fStats.appendChild(row);
        });
        const fSkills = document.getElementById('unit-preview-skills');
        fSkills.innerHTML = '';
        const tag = document.createElement('div');
        tag.className = 'preview-skill-tag';
        tag.textContent = '？？？';
        fSkills.appendChild(tag);
        document.getElementById('unit-preview-desc').textContent = '？？？';
        panel.classList.remove('hidden');
        return;
    }

    if (unit.type === 'extraction') {
        // 合成ユニットはキャンバスにそのままミニ描画
        sCtx.save();
        sCtx.translate(32, 32);
        const hue = unit.side === 'left' ? 180 : 30;
        const grad = sCtx.createRadialGradient(0, 0, 2, 0, 0, 22);
        grad.addColorStop(0, `hsla(${hue}, 100%, 80%, 0.6)`);
        grad.addColorStop(1, `hsla(${hue}, 100%, 50%, 0)`);
        sCtx.fillStyle = grad;
        sCtx.beginPath(); sCtx.arc(0, 0, 22, 0, Math.PI * 2); sCtx.fill();
        sCtx.strokeStyle = `hsla(${hue}, 100%, 85%, 0.9)`;
        sCtx.lineWidth = 2;
        sCtx.fillStyle = `hsla(${hue}, 80%, 40%, 0.8)`;
        sCtx.beginPath();
        for (let i = 0; i < 6; i++) {
            const ang = (Math.PI / 3) * i;
            i === 0 ? sCtx.moveTo(Math.cos(ang)*14, Math.sin(ang)*14)
                    : sCtx.lineTo(Math.cos(ang)*14, Math.sin(ang)*14);
        }
        sCtx.closePath(); sCtx.fill(); sCtx.stroke();
        sCtx.fillStyle = `hsla(${hue}, 100%, 90%, 1)`;
        sCtx.beginPath(); sCtx.arc(0, 0, 5, 0, Math.PI * 2); sCtx.fill();
        sCtx.restore();
    } else {
        const spr = ASSETS[unit.typeKey];
        if (spr) {
            sCtx.imageSmoothingEnabled = false;
            sCtx.drawImage(spr, 0, 0, 64, 64);
        }
    }

    // ── 名前・タイプ ──
    document.getElementById('unit-preview-name').textContent = unit.name;

    const badge = document.getElementById('unit-preview-type-badge');
    const typeKey = unit.type;
    badge.textContent = TYPE_LABEL[typeKey] || typeKey;
    badge.style.background = (TYPE_COLOR[typeKey] || '#888') + '33';
    badge.style.border = `1px solid ${TYPE_COLOR[typeKey] || '#888'}88`;
    badge.style.color = TYPE_COLOR[typeKey] || '#eee';

    // ── ステータス ──
    const statsDiv = document.getElementById('unit-preview-stats');
    statsDiv.innerHTML = '';

    const hpCurrent = Math.max(0, Math.floor(unit.hp));
    const hpMax = unit.maxHp || unit.hp;
    const hpRatio = Math.max(0, Math.min(1, hpCurrent / hpMax));
    const hpColor = hpRatio > 0.5 ? '#0f0' : hpRatio > 0.25 ? '#ff0' : '#f44';

    const rows = [];
    rows.push({ label: '体力', value: `${hpCurrent} / ${Math.floor(hpMax)}`, bar: { ratio: hpRatio, color: hpColor } });
    if (unit.power) rows.push({ label: '攻撃力', value: unit.power });
    if (unit.cooldown && unit.cooldown < 900) rows.push({ label: '攻撃速度', value: `${(1.0/unit.cooldown).toFixed(2)} 発/秒` });
    if (unit.cost) rows.push({ label: 'コスト', value: unit.cost });
    if (unit.manaGen > 0) rows.push({ label: 'マナ生成', value: `+${unit.manaGen}/f` });
    
    // 倍率（合成回数による強化の合算表示）
    if (unit.extractionCount > 0) {
        const mult = (1.0 + unit.extractionCount * 0.2).toFixed(1);
        rows.push({ label: '倍率(合成)', value: `×${mult} (強化済)` });
    }

    rows.forEach(r => {
        const row = document.createElement('div');
        row.className = 'preview-stat-row';
        row.innerHTML = `<span class="preview-stat-label">${r.label}</span><span class="preview-stat-value">${r.value}</span>`;
        statsDiv.appendChild(row);
        if (r.bar) {
            const wrap = document.createElement('div');
            wrap.className = 'preview-hp-bar-wrap';
            const fill = document.createElement('div');
            fill.className = 'preview-hp-bar-fill';
            fill.style.width = `${r.bar.ratio * 100}%`;
            fill.style.background = r.bar.color;
            wrap.appendChild(fill);
            statsDiv.appendChild(wrap);
        }
    });

    // ── スキル表示 ──
    const skillsDiv = document.getElementById('unit-preview-skills');
    skillsDiv.innerHTML = '';

    const fireTypes = unit.fireTypes || (unit.fireType ? [unit.fireType] : []);
    const actions = unit.actions || (unit.action ? [unit.action] : []);

    if (fireTypes.length > 0) {
        const label = document.createElement('div');
        label.style.cssText = 'font-size:0.5rem;color:#668;margin-bottom:1px;';
        label.textContent = '── スキル (射撃) ──';
        skillsDiv.appendChild(label);
        fireTypes.filter(ft => ft !== 'none').forEach(ft => {
            const tag = document.createElement('div');
            tag.className = 'preview-skill-tag';
            tag.textContent = FIRE_TYPE_JP[ft] || ft;
            skillsDiv.appendChild(tag);
        });
    }

    if (actions.length > 0) {
        const label = document.createElement('div');
        label.style.cssText = 'font-size:0.5rem;color:#668;margin-bottom:1px;margin-top:3px;';
        label.textContent = '── スキル (アクション) ──';
        skillsDiv.appendChild(label);
        actions.forEach(act => {
            const tag = document.createElement('div');
            tag.className = 'preview-skill-tag action-tag';
            tag.textContent = ACTION_JP[act] || act;
            skillsDiv.appendChild(tag);
        });
    }

    // 合成ユニットの素材名
    if (unit.extractionCount > 0 && unit.sourceNames && unit.sourceNames.length > 0) {
        const label = document.createElement('div');
        label.style.cssText = 'font-size:0.5rem;color:#668;margin-bottom:1px;margin-top:3px;';
        label.textContent = '── 吸収履歴 ──';
        skillsDiv.appendChild(label);
        unit.sourceNames.forEach(nm => {
            const tag = document.createElement('div');
            tag.className = 'preview-skill-tag';
            tag.style.cssText = 'background:rgba(100,60,160,0.2);border-color:rgba(150,100,220,0.4);color:#c8f;';
            tag.textContent = nm;
            skillsDiv.appendChild(tag);
        });
    }

    // ── 説明文 ──
    document.getElementById('unit-preview-desc').textContent = unit.desc || '';

    panel.classList.remove('hidden');
}

function hideUnitPreview() {
    gameState.previewedUnit = null;
    const panel = document.getElementById('unit-preview-panel');
    if (panel) panel.classList.add('hidden');
}

// ────────────────────────────────────────────────
// 合成システム
// ────────────────────────────────────────────────

function toggleExtractionMode() {
    gameState.extractionMode = !gameState.extractionMode;
    gameState.extractionSelections = [];
    const btn = document.getElementById('btn-toggle-fusion-mode');
    if (gameState.extractionMode) {
        statusMsg.innerText = "【合成モードON】合体させたい2つのユニットを順番にクリックしてください！（空いているマスを押すと合成モードを終えてユニットを置きます）";
        if (btn) { btn.style.background = '#0aa'; btn.innerText = 'キャンセル(E)'; }
    } else {
        statusMsg.innerText = "";
        if (btn) { btn.style.background = '#066'; btn.innerText = '合成(E)'; }
    }
}

function handleExtractionClick(row, col) {
    // 範囲内の自分のユニットを検索
    // 押したマスにいる自分のユニット（隣のマスのユニットは選ばない）
    const u = gameState.units.find(u => u.side === gameState.playerSide && u.hp > 0 && u.row === row && u.col === col);

    if (!u) {
        statusMsg.innerText = "合体させる自分のユニットをクリックしてください。";
        return;
    }

    const sel = gameState.extractionSelections;

    // 1体目を選択済み ➔ 2体目をクリックして融合実行
    if (sel.length === 1) {
        if (sel[0] === u) {
            // 同じユニットをクリックしたら選択解除
            gameState.extractionSelections = [];
            statusMsg.innerText = "選択を解除しました。";
            return;
        }

        const src = sel[0];    // 素材ユニット（消滅）
        const target = u;       // 基盤ユニット（強化＆スキル継承）

        // 合成できるか（回数の上限・最終形態など）
        const blockReason = getExtractionBlockReason(target, src);
        if (blockReason) {
            statusMsg.innerText = blockReason;
            gameState.extractionSelections = [];
            return;
        }

        // 融合処理を実行（練習場・CPU戦・ホストは自分で計算。CPU戦はサーバーにつながっていなくても動く）
        if (isLocalAuthority()) {
            processExtraction(target.col, target.row, src.col, src.row, gameState.playerSide);
        }
        if (!gameState.isPractice && !gameState.isBotMatch && socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'signal', action: 'extraction_process',
                targetCol: target.col, targetRow: target.row,
                srcCol: src.col, srcRow: src.row,
                side: gameState.playerSide
            }));
        }

        gameState.extractionSelections = [];
        return;
    }

    // 1体目の選択
    gameState.extractionSelections = [u];
    statusMsg.innerText = `1体目「${u.name}」を選択。次に合体先となる2体目のユニットをクリック！`;
}

// 🌟 カットイン演出の表示
function showSecretEvolutionCutin(name, title = 'SECRET EVOLUTION') {
    const cutin = document.getElementById('secret-evolution-cutin');
    const nameEl = document.getElementById('cutin-evolution-name');
    if (!cutin || !nameEl) return;
    nameEl.textContent = name;
    const titleEl = document.getElementById('cutin-evolution-title');
    if (titleEl) titleEl.textContent = title;
    cutin.classList.remove('hidden');
    SoundManager.playVictory();
    setTimeout(() => {
        cutin.classList.add('hidden');
    }, 2500);
}

// ===============================================================
// ⚡ 弾の特殊効果（コーラ同士の衝突・電撃チェーン・毒の霧・ゲイザーの回避・ネビュラ）
// ===============================================================
const BLACKHOLE_RANGE = 30;   // ネビュラが敵弾を引き寄せる範囲（弱体化: 45 → 30）
const BLACKHOLE_PULL = 0.35;  // ネビュラが敵弾を引き寄せる力（弱体化: 0.9 → 0.35）
const GEYSER_EVADE_RATE = 0.7; // ゲイザーの弾が消されそうになったとき、かわす確率

// ゲイザーの弾が source（敵の弾・霧など）をかわすか。同じ相手には1回だけ判定して結果を覚える
function geyserEvades(bullet, source) {
    if (!bullet || bullet.action !== 'geyser') return false;
    const key = source.uid || source.id;
    if (!bullet.evadedFrom) bullet.evadedFrom = new Map();
    if (!bullet.evadedFrom.has(key)) bullet.evadedFrom.set(key, Math.random() < GEYSER_EVADE_RATE);
    return bullet.evadedFrom.get(key);
}

// 見た目だけの効果（オンラインでは参加者にも送る）
const BattleFx = {
    sparks: [],    // [x, y, life] コーラ同士の衝突
    bolts: [],     // [x1, y1, x2, y2, life] 電撃チェーン
    reset() { this.sparks = []; this.bolts = []; },
    pack() {
        const r = v => Math.round(v);
        return {
            k: this.sparks.map(s => [r(s[0]), r(s[1]), s[2]]),
            z: this.bolts.map(z => [r(z[0]), r(z[1]), r(z[2]), r(z[3]), z[4]]),
            m: PoisonMist.list.map(m => [r(m.x), r(m.y), m.r, m.life, m.side === 'left' ? 0 : 1])
        };
    },
    unpack(fx) {
        if (!fx) return;
        this.sparks = (fx.k || []).map(a => a.slice());
        this.bolts = (fx.z || []).map(a => a.slice());
        PoisonMist.list = (fx.m || []).map(a => ({ x: a[0], y: a[1], r: a[2], life: a[3], side: a[4] ? 'right' : 'left', id: 'm' + a[0] + '_' + a[1] }));
    },
    draw(c) {
        // 毒の霧
        PoisonMist.list.forEach(m => {
            const a = Math.min(1, m.life / 20) * 0.55;
            const t = Date.now() / 400;
            for (let i = 0; i < 4; i++) {
                const ox = Math.cos(t + i * 1.6) * m.r * 0.35, oy = Math.sin(t * 1.3 + i * 2.1) * m.r * 0.3;
                const g = c.createRadialGradient(m.x + ox, m.y + oy, 0, m.x + ox, m.y + oy, m.r * 0.75);
                g.addColorStop(0, `rgba(170, 60, 220, ${a})`);
                g.addColorStop(1, 'rgba(90, 20, 140, 0)');
                c.fillStyle = g;
                c.beginPath(); c.arc(m.x + ox, m.y + oy, m.r * 0.75, 0, Math.PI * 2); c.fill();
            }
        });
        // 電撃チェーン（ギザギザの線）
        this.bolts.forEach(z => {
            const [x1, y1, x2, y2, life] = z;
            c.save();
            c.globalAlpha = Math.min(1, life / 6);
            c.strokeStyle = '#bff6ff';
            c.shadowColor = '#4fd8ff';
            c.shadowBlur = 8;
            c.lineWidth = 2;
            c.beginPath();
            c.moveTo(x1, y1);
            const steps = 5;
            for (let i = 1; i < steps; i++) {
                const px = x1 + (x2 - x1) * i / steps + (Math.random() - 0.5) * 8;
                const py = y1 + (y2 - y1) * i / steps + (Math.random() - 0.5) * 8;
                c.lineTo(px, py);
            }
            c.lineTo(x2, y2);
            c.stroke();
            c.restore();
        });
        // 衝突の火花
        this.sparks.forEach(s => {
            const [x, y, life] = s;
            const p = 1 - life / 12;
            c.save();
            c.globalAlpha = Math.max(0, 1 - p);
            c.strokeStyle = '#ffdd55';
            c.lineWidth = 2;
            for (let i = 0; i < 8; i++) {
                const ang = i * Math.PI / 4;
                c.beginPath();
                c.moveTo(x + Math.cos(ang) * 4 * p, y + Math.sin(ang) * 4 * p);
                c.lineTo(x + Math.cos(ang) * (6 + 14 * p), y + Math.sin(ang) * (6 + 14 * p));
                c.stroke();
            }
            c.restore();
        });
        this.tick();
    },
    // 寿命を減らす（描くたびに1つ進める。参加者も同じ）
    tick() {
        this.sparks.forEach(s => s[2]--);
        this.bolts.forEach(z => z[4]--);
        this.sparks = this.sparks.filter(s => s[2] > 0);
        this.bolts = this.bolts.filter(z => z[4] > 0);
    }
};

function addCollisionSpark(x, y) {
    BattleFx.sparks.push([x, y, 12]);
    SoundManager.playHit();
}

// ⚡ コーラ ブリッツの電撃チェーン: 当たった相手の近くの敵ユニット2体に、半分のダメージが連鎖する
function chainLightning(hitUnit, dmg) {
    const half = Math.max(1, Math.round(dmg / 2));
    let from = hitUnit;
    const done = new Set([hitUnit]);
    for (let n = 0; n < 2; n++) {
        let best = null, bestD = 80;
        gameState.units.forEach(t => {
            if (t.side !== hitUnit.side || t.hp <= 0 || t.fired || done.has(t)) return;
            const d = Math.hypot(t.x - from.x, t.y - from.y);
            if (d < bestD) { bestD = d; best = t; }
        });
        if (!best) break;
        best.hp -= half;
        DamageNumbers.add(best.x, best.y - 12, half, 'unit', best.uid);
        BattleFx.bolts.push([from.x, from.y, best.x, best.y, 10]);
        done.add(best);
        from = best;
    }
}

// ☠ ギフト ライスの毒の霧: 当たった場所に3秒残る。霧の中の敵ユニットは毎秒ダメージ、通る敵の弾は威力半分
const PoisonMist = {
    list: [],
    LIFE: 90,       // 3秒
    RADIUS: 26,
    DPS: 6,         // 霧の中の敵ユニットが1秒に受けるダメージ
    seq: 0,
    spawn(x, y, side) {
        // 近くに同じ陣営の霧があれば、新しく作らず時間を延ばす（霧だらけにならないように）
        const near = this.list.find(m => m.side === side && Math.hypot(m.x - x, m.y - y) < this.RADIUS * 0.8);
        if (near) { near.life = this.LIFE; return; }
        this.list.push({ id: 'mist' + (++this.seq), x, y, r: this.RADIUS, life: this.LIFE, side });
        if (this.list.length > 40) this.list.shift();
    },
    // 計算する側だけが呼ぶ
    update() {
        for (const m of this.list) {
            m.life--;
            if (m.life % CONFIG.FPS !== 0) continue; // 1秒ごとにダメージ
            gameState.units.forEach(u => {
                if (u.side === m.side || u.hp <= 0 || u.fired) return;
                if (Math.hypot(u.x - m.x, u.y - m.y) > m.r) return;
                u.hp -= this.DPS;
                DamageNumbers.add(u.x, u.y - 12, this.DPS, 'unit', u.uid);
            });
        }
        this.list = this.list.filter(m => m.life > 0);
    },
    reset() { this.list = []; }
};

// ===============================================================
// 🧪 練習場サンドボックス
// ===============================================================
const Sandbox = {
    settings: { v: 2, cpuLevel: 0, infMana: false, infHpMe: false, infHpEnemy: true, bothSides: true, allUnits: false },

    load() {
        let saved = {};
        try { saved = JSON.parse(localStorage.getItem('inamu_sandbox') || '{}'); } catch (e) {}
        // 古い保存データ（v1）は「両方の陣地に置ける」を一度ONにする
        if (!(saved.v >= 2)) { saved.bothSides = true; saved.v = 2; }
        delete saved.autoTargets;
        Object.assign(this.settings, saved);
    },
    save() {
        try { localStorage.setItem('inamu_sandbox', JSON.stringify(this.settings)); } catch (e) {}
    },
    active() { return gameState.isPractice; },
    // かかしをCPUとして動かしているか
    cpuActive() { return gameState.isPractice && this.settings.cpuLevel > 0; },

    // 相手（かかし）の体力の最大値
    applyEnemyHp() {
        const R = gameState.players.right;
        R.maxHp = this.settings.infHpEnemy ? 1000000 : 2000;
        R.hp = R.maxHp;
    },

    // 毎フレーム: 無限設定を反映
    tick() {
        if (!this.active()) return;
        const st = this.settings, L = gameState.players.left, R = gameState.players.right;
        if (st.infMana) { L.mana = 100; R.mana = 100; }
        if (st.infHpMe) L.hp = L.maxHp;
        if (st.infHpEnemy) R.hp = R.maxHp;
    },

    clearBoard() {
        gameState.units = [];
        gameState.bullets = [];
        gameState.summoningEffects = [];
        gameState.selectedCola = null;
        gameState.extractionSelections = [];
        PoisonMist.reset();
        BattleFx.reset();
        Particles.reset();
        DPSManager.reset();
    },

    restart() {
        this.clearBoard();
        const L = gameState.players.left, R = gameState.players.right;
        L.maxHp = 2000; L.hp = 2000; L.mana = 100; L.y = 80;
        R.mana = 100; R.y = 80;
        this.applyEnemyHp();
        gameState.prepTimer = 450;
        BotAI.reset();
        Camera.reset();
        statusMsg.innerText = '練習場：最初からやり直しました';
    },

    // 置けるユニット（全ユニット＋発見済みシークレット、またはデッキ）
    selectableKeys() {
        if (this.active() && this.settings.allUnits) {
            let disc = [];
            try { disc = JSON.parse(localStorage.getItem('inamu_discovered_chimeras') || '[]'); } catch (e) {}
            const secrets = Object.keys(SECRET_CHIMERAS).filter(k => disc.includes(SECRET_CHIMERAS[k].id)).map(k => 'SECRET:' + k);
            return Object.keys(UNIT_TYPES).concat(secrets);
        }
        return (gameState.deck && gameState.deck.length > 0) ? gameState.deck : DEFAULT_DECK;
    },

    // 画面の設定パネルとつなぐ
    bindUI() {
        // 設定は this.settings をその都度見る（設定データが入れ替わっても正しく動くように）
        const byId = id => document.getElementById(id);
        const cpu = byId('sb-cpu');
        if (cpu) {
            cpu.value = String(this.settings.cpuLevel);
            cpu.addEventListener('change', () => {
                this.settings.cpuLevel = parseInt(cpu.value, 10) || 0;
                if (this.settings.cpuLevel > 0) gameState.cpuDifficulty = this.settings.cpuLevel;
                BotAI.reset();
                this.save();
            });
        }
        const toggles = { 'sb-inf-mana': 'infMana', 'sb-inf-hp-me': 'infHpMe', 'sb-inf-hp-enemy': 'infHpEnemy', 'sb-both-sides': 'bothSides', 'sb-all-units': 'allUnits' };
        Object.entries(toggles).forEach(([id, key]) => {
            const el = byId(id);
            if (!el) return;
            el.checked = !!this.settings[key];
            el.addEventListener('change', () => {
                this.settings[key] = el.checked;
                if (key === 'infHpEnemy' && this.active()) this.applyEnemyHp();
                if (key === 'allUnits') updateUnitUI();
                this.save();
            });
        });
        const on = (id, fn) => { const el = byId(id); if (el) el.addEventListener('click', fn); };
        on('btn-sandbox', () => byId('sandbox-panel').classList.toggle('hidden'));
        on('btn-sandbox-close', () => byId('sandbox-panel').classList.add('hidden'));
        on('sb-skip-prep', () => { gameState.prepTimer = 0; });
        on('sb-clear-bullets', () => { gameState.bullets = []; });
        on('sb-reset-board', () => { this.clearBoard(); statusMsg.innerText = '練習場：盤をリセットしました'; });
        on('sb-restart', () => this.restart());
    },

    // 練習場に入る・出るときの表示
    showUI(show) {
        const btn = document.getElementById('btn-sandbox');
        const panel = document.getElementById('sandbox-panel');
        if (btn) btn.classList.toggle('hidden', !show);
        if (panel && !show) panel.classList.add('hidden');
    }
};
Sandbox.load();

// 練習場でシークレットを直接置く（発見済みのものだけ）
function sandboxSecretDef(chimeraKey) {
    const parts = getRecipeParts(chimeraKey);
    const base = parts && UNIT_TYPES[parts.base];
    return base ? { baseKey: parts.base, base } : null;
}

// ===============================================================
// ✨ パーティクル（当たったときの火花・置いたときの光・やられたときの破片）。設定で ON/OFF
// ===============================================================
const Particles = {
    list: [],
    MAX: 400,
    enabled() {
        try { return localStorage.getItem('inamu_particles') !== '0'; } catch (e) { return true; }
    },
    add(p) {
        if (!this.enabled()) return;
        this.list.push(p);
        if (this.list.length > this.MAX) this.list.splice(0, this.list.length - this.MAX);
    },
    // 弾が当たった: 火花
    hit(x, y, amount, kind) {
        const n = Math.min(10, 3 + Math.floor(amount / 8));
        const color = kind === 'player' ? '#ff6a3d' : (amount >= 25 ? '#ffb347' : '#fff2a8');
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 2.5;
            this.add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.6, life: 14 + Math.random() * 8, max: 22, size: 1.5 + Math.random() * 1.5, color, gravity: 0.12 });
        }
    },
    // ユニットを置いた: 光の輪と粒
    summon(x, y, side) {
        const color = side === 'left' ? '#6fd3ff' : '#ff8a8a';
        this.add({ ring: true, x, y, r: 4, life: 14, max: 14, color });
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            this.add({ x, y, vx: Math.cos(a) * 1.4, vy: Math.sin(a) * 1.4, life: 16, max: 16, size: 2, color, gravity: 0 });
        }
    },
    // ユニットがやられた: 破片
    debris(x, y, type) {
        const color = type === 'cola' ? '#c0392b' : type === 'soda' ? '#5dade2' : '#d4ac0d';
        for (let i = 0; i < 14; i++) {
            const a = Math.random() * Math.PI * 2, sp = 1 + Math.random() * 3;
            this.add({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5, life: 24 + Math.random() * 12, max: 36, size: 2 + Math.random() * 2, color, gravity: 0.18, square: true });
        }
    },
    reset() { this.list = []; },
    draw(c) {
        if (!this.enabled()) { this.list = []; return; }
        for (let i = this.list.length - 1; i >= 0; i--) {
            const p = this.list[i];
            p.life--;
            if (p.life <= 0) { this.list.splice(i, 1); continue; }
            const a = Math.max(0, p.life / p.max);
            c.save();
            c.globalAlpha = a;
            if (p.ring) {
                p.r += 1.6;
                c.strokeStyle = p.color;
                c.lineWidth = 2;
                c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.stroke();
            } else {
                p.x += p.vx; p.y += p.vy; p.vy += p.gravity || 0;
                c.fillStyle = p.color;
                if (p.square) c.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
                else { c.beginPath(); c.arc(p.x, p.y, p.size, 0, Math.PI * 2); c.fill(); }
            }
            c.restore();
        }
    }
};

// ===============================================================
// 📐 画面の高さに合わせてゲーム画面を収める（ブラウザのアドレスバーなどで下が見切れないように）
// ===============================================================
function layoutGameScreen() {
    if (!gameUI) return;
    gameUI.style.height = window.innerHeight + 'px';
    if (gameUI.classList.contains('hidden')) return;
    const top = gameUI.querySelector('.top-bar');
    const bottom = gameUI.querySelector('.bottom-bar');
    const availH = window.innerHeight - (top ? top.offsetHeight : 0) - (bottom ? bottom.offsetHeight : 0) - 6;
    const availW = window.innerWidth * 0.98;
    const w = Math.max(160, Math.floor(Math.min(availW, availH * 2)));
    canvas.style.width = w + 'px';
    canvas.style.height = Math.floor(w / 2) + 'px';
}
window.addEventListener('resize', layoutGameScreen);
window.addEventListener('orientationchange', () => setTimeout(layoutGameScreen, 200));

// ===============================================================
// 💥 ダメージ数字（当たった場所に数字がふわっと浮かぶ）。設定で ON/OFF できる（最初は ON）
// ===============================================================
const DamageNumbers = {
    list: [],
    pending: [], // オンラインのホスト: 参加者に送る分
    LIFE: 36,    // 表示する長さ（フレーム）

    enabled() {
        try { return localStorage.getItem('inamu_damage_numbers') !== '0'; } catch (e) { return true; }
    },

    // 計算する側（ホスト・CPU戦・練習場）がダメージを与えたときに呼ぶ
    add(x, y, amount, kind, key) {
        if (!(amount > 0)) return;
        this.spawn(x, y, amount, kind, key);
        if (gameState.isHost && !gameState.isBotMatch && !gameState.isPractice) {
            this.pending.push([Math.round(x), Math.round(y), Math.round(amount * 10) / 10, kind === 'player' ? 1 : 0, key]);
            if (this.pending.length > 200) this.pending.splice(0, this.pending.length - 200);
        }
    },

    takePending() {
        const out = this.pending;
        this.pending = [];
        return out;
    },

    spawn(x, y, amount, kind, key) {
        Particles.hit(x, y + 10, amount, kind);
        // 同じ相手に続けて当たったときは、数字をまとめて足していく（画面が数字だらけにならないように）
        const recent = this.list.find(n => n.key === key && n.life > this.LIFE - 12);
        if (recent) {
            recent.amount += amount;
            recent.life = this.LIFE;
            recent.age = 0; // もう一度「ポンッ」と出す
            recent.y = y;
            return;
        }
        this.list.push({
            x: x + (Math.random() - 0.5) * 8, y, amount, kind, key,
            life: this.LIFE, age: 0,
            vx: (Math.random() - 0.5) * 0.6 // 少し横に流れる
        });
        if (this.list.length > 120) this.list.shift();
    },

    reset() {
        this.list = [];
        this.pending = [];
    },

    // ダメージの大きさで色と大きさを変える
    style(n) {
        const a = n.amount;
        if (n.kind === 'player') return { fill: '#ff4b2b', fill2: '#ffd36b', size: 15 + Math.min(9, a / 12), glow: '#ff2200' };
        if (a >= 50) return { fill: '#ff3b3b', fill2: '#ffb3a1', size: 15, glow: '#ff0000' };
        if (a >= 25) return { fill: '#ff9f1c', fill2: '#ffe3a3', size: 13, glow: '#ff7a00' };
        if (a >= 10) return { fill: '#ffe066', fill2: '#fffbe0', size: 11, glow: null };
        return { fill: '#ffffff', fill2: '#ffffff', size: 9, glow: null };
    },

    draw(c) {
        const show = this.enabled();
        for (let i = this.list.length - 1; i >= 0; i--) {
            const n = this.list[i];
            n.life--;
            n.age++;
            // ふわっと上がりながら、だんだん止まる
            n.y -= 0.9 * (n.life / this.LIFE) + 0.15;
            n.x += n.vx || 0;
            if (n.life <= 0) { this.list.splice(i, 1); continue; }
            if (!show) continue;

            const st = this.style(n);
            // 出た瞬間は大きく、すぐ元の大きさに縮む（ポンッ）
            const pop = n.age < 6 ? 1.8 - (n.age / 6) * 0.8 : 1;
            // 大ダメージは少し揺れる
            const shake = (st.glow && n.age < 10) ? (Math.random() - 0.5) * 2 : 0;
            const text = (n.kind === 'player' ? '-' : '') + Math.round(n.amount);

            c.save();
            c.translate(n.x + shake, n.y);
            c.scale(pop, pop);
            c.globalAlpha = Math.min(1, n.life / 10);
            c.font = `${Math.round(st.size)}px ${GAME_FONT}`;
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            // 光（大ダメージだけ）
            if (st.glow) {
                c.shadowColor = st.glow;
                c.shadowBlur = 8;
            }
            // 太い黒の縁取り
            c.lineJoin = 'round';
            c.lineWidth = 3.5;
            c.strokeStyle = 'rgba(0, 0, 0, 0.9)';
            c.strokeText(text, 0, 0);
            c.shadowBlur = 0;
            // 上が明るく下が濃いグラデーション
            const h = st.size / 2;
            const g = c.createLinearGradient(0, -h, 0, h);
            g.addColorStop(0, st.fill2);
            g.addColorStop(0.55, st.fill);
            g.addColorStop(1, st.fill);
            c.fillStyle = g;
            c.fillText(text, 0, 0);
            c.restore();
        }
    }
};

// 合成できる回数。シークレットは誕生した時点で0に戻り、また5回まで合成できる
const EXTRACTION_LIMIT = 5;
// 最終形態（シークレット同士の合成）の強さ: 2体の合計 × この倍率
const FINAL_FORM_RATE = 0.8;

// 合成できない理由（できるなら null）
function getExtractionBlockReason(target, src) {
    if (!target || !src || target === src) return '合成できません。';
    if (target.isFinalForm || src.isFinalForm) return '「？？？」はこれ以上合成できません！';
    if (target.isSecretChimera && src.isSecretChimera) return null; // シークレット同士は回数に関係なく最終進化できる
    if ((target.extractionCount || 0) >= EXTRACTION_LIMIT) {
        return `「${target.name}」は既に最大合成数（${EXTRACTION_LIMIT}回）に達しています！`;
    }
    return null;
}

// シークレット同士の合成 → 最終形態「？？？」（黒い靄）。それぞれの合成は消え、これ以上合成できない
function processFinalFusion(target, src, side, isMine) {
    const list = (arr, single) => (Array.isArray(arr) ? arr : (single ? [single] : []));
    const union = (...lists) => [...new Set([].concat(...lists))].filter(v => v && v !== 'none');
    const tMax = target.maxHp || target.hp, sMax = src.maxHp || src.hp;
    const hpRatio = Math.max(0.2, (Math.max(0, target.hp) + Math.max(0, src.hp)) / (tMax + sMax));

    const fireTypes = union(list(target.fireTypes, target.fireType), list(src.fireTypes, src.fireType));
    target.fireTypes = fireTypes.length > 0 ? fireTypes : ['none'];
    target.actions = union(list(target.actions, target.action), list(src.actions, src.action), [target.special, src.special]);
    target.maxHp = Math.floor((tMax + sMax) * FINAL_FORM_RATE);
    target.hp = Math.floor(target.maxHp * hpRatio);
    target.power = Math.floor(((target.power || 0) + (src.power || 0)) * FINAL_FORM_RATE);
    target.cooldown = Math.min(target.cooldown || 2, src.cooldown || 2);
    target.pierceCount = Math.max(target.pierceCount || 0, src.pierceCount || 0) || undefined;
    target.manaGen = ((target.manaGen || 0) + (src.manaGen || 0)) * FINAL_FORM_RATE || undefined;
    if (target.isManaProducer || src.isManaProducer) target.isManaProducer = true;

    target.isSecretChimera = true;
    target.isFinalForm = true;
    target.name = '？？？';
    target.chimeraId = 'final_form';
    target.spriteKey = 'final_form';
    target.desc = '？？？';
    target.extractionCount = 0;      // それぞれの合成は消滅
    target.extractionLog = [];
    target.sourceNames = [];
    target.extractionHistory = [];

    SoundManager.playSummon();
    showSecretEvolutionCutin('？？？', 'FINAL EVOLUTION');
    statusMsg.innerText = isMine ? '最終進化！「？？？」が誕生した……' : '⚠ 相手が最終形態「？？？」を誕生させた……';

    gameState.summoningEffects.push({
        type: 'absorption', side,
        startX: src.x, startY: src.y, targetX: target.x, targetY: target.y,
        progress: 0, duration: 18
    });
    src.hp = 0; // 素材消費（消滅）
}

// 最終形態の見た目: うごめく黒い靄
function drawBlackMist(u) {
    const t = Date.now() / 300;
    ctx.save();
    ctx.translate(u.x, u.y);
    for (let i = 0; i < 7; i++) {
        const a = t * (0.6 + i * 0.13) + i * 2.1;
        const r = 5 + 3 * Math.sin(t * 1.3 + i);
        const ox = Math.cos(a) * r, oy = Math.sin(a * 1.2) * r * 0.8;
        const size = 9 + 3 * Math.sin(t * 2 + i * 1.7);
        const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, size);
        g.addColorStop(0, 'rgba(0, 0, 0, 0.85)');
        g.addColorStop(0.6, 'rgba(20, 0, 30, 0.5)');
        g.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(ox, oy, size, 0, Math.PI * 2);
        ctx.fill();
    }
    // かすかに光る赤い目
    ctx.fillStyle = `rgba(255, 40, 60, ${0.5 + 0.4 * Math.sin(t * 2)})`;
    ctx.fillRect(-4, -2, 2, 2);
    ctx.fillRect(2, -2, 2, 2);
    ctx.restore();
}

// ---------------------------------------------------------------
// 合成の記録とシークレット誕生時の受け継ぎ
// ---------------------------------------------------------------
function snapshotForExtraction(u) {
    return {
        maxHp: u.maxHp || u.hp || 0,
        power: u.power || 0,
        cooldown: u.cooldown || 2,
        manaGen: u.manaGen || 0,
        fireTypes: [...(u.fireTypes || [])],
        actions: [...(u.actions || [])]
    };
}

// 1回の合成で増えたもの（能力・ステータス）を target.extractionLog に残す
function recordExtraction(target, src, before) {
    if (!target.extractionLog) target.extractionLog = [];
    target.extractionLog.push({
        key: src.typeKey || src.id,
        name: src.name,
        srcHp: src.maxHp || src.hp || 0,
        srcPower: src.power || 0,
        hpGain: (target.maxHp || 0) - before.maxHp,
        powerGain: (target.power || 0) - before.power,
        cdMul: (target.cooldown || 2) / (before.cooldown || 2),
        manaGain: (target.manaGen || 0) - before.manaGen,
        addFire: (target.fireTypes || []).filter(f => !before.fireTypes.includes(f)),
        addActions: (target.actions || []).filter(a => !before.actions.includes(a))
    });
}

// シークレットのレシピ（土台と素材の順番）を判定式から調べる（1回だけ）
const _recipePartsCache = {};
function getRecipeParts(chimeraKey) {
    if (_recipePartsCache[chimeraKey] !== undefined) return _recipePartsCache[chimeraKey];
    const c = SECRET_CHIMERAS[chimeraKey];
    const keys = Object.keys(UNIT_TYPES);
    const test = (base, hist, last) => {
        try { return !!c.recipe({ typeKey: base, extractionHistory: hist }, { typeKey: last }); } catch (e) { return false; }
    };
    let found = null;
    outer2: for (const base of keys) for (const h of keys) for (const last of keys) {
        if (test(base, [h], last)) { found = { base, mats: [h, last] }; break outer2; }
    }
    if (!found) {
        outer3: for (const base of keys) for (const h1 of keys) for (const h2 of keys) for (const last of keys) {
            if (test(base, [h1, h2], last)) { found = { base, mats: [h1, h2, last] }; break outer3; }
        }
    }
    _recipePartsCache[chimeraKey] = found;
    return found;
}

function applySecretInheritance(target, src, chimera, chimeraKey) {
    const parts = getRecipeParts(chimeraKey);
    const log = target.extractionLog || [];
    // レシピで使った素材（最後の素材＝今回の src 以外）を、合成の記録から1つずつ探す
    const used = new Set();
    (parts ? parts.mats.slice(0, -1) : []).forEach(m => {
        const idx = log.findIndex((e, i) => !used.has(i) && e.key === m);
        if (idx >= 0) used.add(idx);
    });
    const consumed = log.filter((e, i) => used.has(i));
    const kept = log.filter((e, i) => !used.has(i));
    const sum = (arr, f) => arr.reduce((a, e) => a + (f(e) || 0), 0);

    // レシピで使ったもの（土台の元の強さ＋素材＋今回の素材）の合計の半分
    const baseDef = UNIT_TYPES[target.typeKey] || {};
    const halfHp = 0.5 * ((baseDef.hp || 0) + sum(consumed, e => e.srcHp) + (src.maxHp || src.hp || 0));
    const halfPower = 0.5 * ((baseDef.power || 0) + sum(consumed, e => e.srcPower) + (src.power || 0));

    target.maxHp = Math.round(chimera.hp + halfHp + sum(kept, e => e.hpGain));
    target.hp = target.maxHp;
    target.power = Math.round((chimera.power || 0) + halfPower + sum(kept, e => e.powerGain));
    target.cooldown = Math.max(0.3, chimera.cooldown * kept.reduce((a, e) => a * (e.cdMul || 1), 1));

    // 能力: シークレットの能力 ＋ レシピに使わなかった合成で付いた能力
    const union = (...lists) => [...new Set([].concat(...lists))];
    let fireTypes = union(chimera.fireTypes, ...kept.map(e => e.addFire || []));
    if (fireTypes.some(f => f !== 'none')) fireTypes = fireTypes.filter(f => f !== 'none');
    target.fireTypes = fireTypes;
    target.actions = union(chimera.actions || [], ...kept.map(e => e.addActions || []));
    if (chimera.isManaProducer) target.isManaProducer = true;
    const mana = (chimera.manaGen || 0) + sum(kept, e => e.manaGain);
    target.manaGen = mana > 0 ? mana : undefined;
    if (chimera.pierceCount) target.pierceCount = Math.max(chimera.pierceCount, target.pierceCount || 0);

    // 合成回数: レシピに使わなかった分だけ残る（残りの回数だけまた合成できる）
    target.extractionLog = kept;
    target.extractionCount = kept.length;
    target.extractionHistory = kept.map(e => e.key);
    target.sourceNames = kept.map(e => e.name);
}

function processExtraction(targetCol, targetRow, srcCol, srcRow, side) {
    const target = gameState.units.find(u => u.col === targetCol && u.row === targetRow && u.side === side && u.hp > 0);
    const src = gameState.units.find(u => u.col === srcCol && u.row === srcRow && u.side === side && u.hp > 0);
    if (!target || !src || target === src) return;

    // 合成できるか（回数の上限・最終形態など）。CPUや通信で届いた合成もここで必ずチェックする
    if (getExtractionBlockReason(target, src)) return;

    // 自分の合成かどうか（相手の合成で自分の図鑑が埋まらないようにする）
    const isMine = side === gameState.playerSide;

    // シークレット同士 → 最終形態「？？？」へ
    if (target.isSecretChimera && src.isSecretChimera) {
        processFinalFusion(target, src, side, isMine);
        return;
    }

    SoundManager.playSummon();

    // 融合データ初期化
    if (!target.extractionCount) target.extractionCount = 0;
    if (!target.sourceNames) target.sourceNames = [];
    if (!target.extractionHistory) target.extractionHistory = [];
    
    // 元の射撃タイプの保全
    if (!target.fireTypes) {
        target.fireTypes = target.fireType && target.fireType !== 'none' ? [target.fireType] : [];
    }
    // 元のアクション特性の保全
    if (!target.actions) {
        target.actions = [];
        if (target.action) target.actions.push(target.action);
        if (target.bounce) target.actions.push('bounce');
        if (target.split) target.actions.push('split');
        if (target.pierce) target.actions.push('pierce');
        if (target.homing) target.actions.push('homing');
    }

    // 合成前の状態（この合成で何が増えたかを記録するため）
    const before = snapshotForExtraction(target);

    // 素材側のスキル・特性を合成
    const srcFireTypes = src.fireTypes || (src.fireType && src.fireType !== 'none' ? [src.fireType] : []);
    const srcActions = src.actions || [];
    if (src.action && !srcActions.includes(src.action)) srcActions.push(src.action);
    if (src.bounce && !srcActions.includes('bounce')) srcActions.push('bounce');
    if (src.split && !srcActions.includes('split')) srcActions.push('split');
    if (src.pierce && !srcActions.includes('pierce')) srcActions.push('pierce');
    if (src.homing && !srcActions.includes('homing')) srcActions.push('homing');

    // 射撃タイプを統合（素材の弾も撃てるように追加）
    srcFireTypes.forEach(ft => {
        if (ft && ft !== 'none' && !target.fireTypes.includes(ft)) {
            target.fireTypes.push(ft);
        }
    });

    // どちらかがコーラや弾撃ちで、まだfireTypesがない場合は通常単発を追加
    if (target.fireTypes.length === 0 && (target.type === 'cola' || src.type === 'cola' || srcFireTypes.length > 0)) {
        target.fireTypes.push('single');
    }

    // アクション特性を追加（跳弾・分裂・貫通・爆散・毒・氷結・吸い込み等）
    srcActions.forEach(act => {
        if (act && !target.actions.includes(act)) {
            target.actions.push(act);
        }
    });

    // 貫通カウントの合算
    if (src.pierceCount || src.pierce) {
        target.pierceCount = Math.max(target.pierceCount || 0, src.pierceCount || 2) + 1;
    }

    // マナ生成能力の合算（ソーダを吸収した場合もマナ生成が付く）
    if (src.manaGen > 0) {
        target.manaGen = (target.manaGen || 0) + src.manaGen * 0.7;
    }

    target.extractionCount++;
    target.sourceNames.push(src.name);

    // シークレット特殊進化（キメラ合体）の判定
    //  - すでにシークレットのユニットは再進化しない（以前は同じレシピでHPが満タンに戻っていた）
    //  - CPU対戦のCPUはシークレットを作らない
    const isCpuSide = BotAI.extracting === true || (gameState.isBotMatch && side === BotAI.side);
    let matchedChimera = null, matchedKey = null;
    if (!target.isSecretChimera && !isCpuSide) for (const key of Object.keys(SECRET_CHIMERAS)) {
        const chimera = SECRET_CHIMERAS[key];
        try {
            if (chimera.recipe(target, src)) {
                matchedChimera = chimera;
                matchedKey = key;
                break;
            }
        } catch (e) {}
    }

    // 合成履歴に素材のtypeKeyを記録
    target.extractionHistory.push(src.typeKey || src.id);

    // 正しい順番・組み合わせに合致した時のみ100%シークレット進化
    if (matchedChimera) {
        target.isSecretChimera = true;
        target.chimeraId = matchedChimera.id;
        target.name = matchedChimera.name;
        target.spriteKey = matchedChimera.id;
        // 受け継ぎ: レシピで使ったユニット（土台＋素材）の合計の半分 ＋ レシピに使わなかった合成はそのまま
        applySecretInheritance(target, src, matchedChimera, matchedKey);

        // 図鑑アンロック記録（ローカル + クラウド同期）※自分が作ったときだけ
        if (isMine) {
            try {
                let disc = JSON.parse(localStorage.getItem('inamu_discovered_chimeras') || '[]');
                if (!disc.includes(matchedChimera.id)) {
                    disc.push(matchedChimera.id);
                    CloudSyncManager.saveDiscoveredChimeras(disc);
                }
            } catch (e) {}
        }

        // カットイン表示
        showSecretEvolutionCutin(matchedChimera.name);
        statusMsg.innerText = isMine
            ? `シークレット進化！「${matchedChimera.name}」が誕生した！`
            : `⚠ 相手がシークレット「${matchedChimera.name}」を誕生させた！`;
    } else if (target.isSecretChimera) {
        // すでにシークレットであるユニットへの追加合成（能力をさらに上乗せ強化！）
        const hpRatio = target.hp / (target.maxHp || target.hp || 1);
        target.maxHp = Math.floor((target.maxHp || target.hp) + (src.maxHp || src.hp) * 0.4);
        target.hp = Math.floor(target.maxHp * Math.max(0.2, hpRatio));
        target.power = (target.power || 15) + Math.max(2, Math.floor((src.power || 5) * 0.3));
        target.cooldown = Math.max(0.4, (target.cooldown || 1.5) * 0.9);
        if (src.manaGen > 0) target.manaGen = (target.manaGen || 0) + src.manaGen * 0.6;

        recordExtraction(target, src, before);
        if (isMine) statusMsg.innerText = `シークレット「${target.name}」が「${src.name}」を吸収して超強化！ (合成: ${target.extractionCount}/${EXTRACTION_LIMIT})`;
    } else {
        // 通常の融合ステータス強化
        const hpRatio = target.hp / (target.maxHp || target.hp || 1);
        target.maxHp = Math.floor((target.maxHp || target.hp) + (src.maxHp || src.hp) * 0.3);
        target.hp = Math.floor(target.maxHp * Math.max(0.2, hpRatio));
        target.power = (target.power || 5) + Math.max(1, Math.floor((src.power || 5) * 0.25));
        target.cooldown = Math.max(0.6, (target.cooldown || 2.0) * 0.85);

        recordExtraction(target, src, before);
        if (isMine) statusMsg.innerText = `「${src.name}」と「${target.name}」が合成！ (合成: ${target.extractionCount}/${EXTRACTION_LIMIT})`;
    }

    // 吸収エフェクト用に光の球パーティクルを生成
    gameState.summoningEffects.push({
        type: 'absorption',
        side: side,
        startX: src.x, startY: src.y,
        targetX: target.x, targetY: target.y,
        progress: 0,
        duration: 18
    });

    src.hp = 0; // 素材消費（消滅）
}

// 融合ユニットの発射処理
function fireExtractionUnit(u) {
    if (gameState.prepTimer > 0) return;

    // マナ専任キメラ（fireTypesに'none'を含むもの、または射撃タイプを持たないもの）は弾を撃たない
    const isPureManaProducer = (u.isManaProducer && (!u.fireTypes || u.fireTypes.includes('none'))) ||
        (!u.fireTypes || u.fireTypes.length === 0 || u.fireTypes.every(ft => ft === 'none'));

    if (isPureManaProducer) {
        // 生命樹のリジェネ能力のみ実行
        if (u.isSecretChimera && (u.chimeraId === 'chimera_genesis' || u.id === 'chimera_genesis')) {
            const p = gameState.players[u.side];
            if (p) p.hp = Math.min(p.maxHp || 2000, p.hp + 4);
        }
        return;
    }

    SoundManager.playFire();

    const spd = 2.5;
    const power = u.power || 20;

    // 融合されたアクション特性をすべて弾丸に付加
    const actExt = {};
    if (u.actions) {
        if (u.actions.includes('homing')) actExt.homing = true;
        if (u.actions.includes('split')) actExt.split = true;
        if (u.actions.includes('bounce')) actExt.bounce = 3;
        if (u.actions.includes('spread')) actExt.action = 'spread';
        if (u.actions.includes('poison')) actExt.action = 'poison';
        if (u.actions.includes('frost')) actExt.action = 'frost';
        if (u.actions.includes('blackhole')) actExt.action = 'blackhole';
        if (u.actions.includes('megaton')) { actExt.size = 12; actExt.power = power * 1.5; }
        if (u.actions.includes('pierce')) {
            actExt.pierce = true;
            actExt.pierceCount = u.pierceCount || (1 + (u.extractionCount || 1));
        }
    }

    const fire = (x, y, vx, vy, side, extra = {}) => {
        let pCount = extra.pierceCount || actExt.pierceCount || 0;
        spawnBullet(x, y, vx, vy, side, { power, pierceCount: pCount, ...actExt, ...extra });
    };

    // リジェネ能力（アウラ・ジェネシス等: リバランスで毎発射HP+2回復）
    if (u.isSecretChimera && u.chimeraId === 'chimera_genesis') {
        const p = gameState.players[u.side];
        if (p) p.hp = Math.min(p.maxHp || 2000, p.hp + 2);
    }

    u.fireTypes.forEach(ft => {
        if (ft === 'none') return;
        if (ft === '8dir' && u.id === 'rice_1') {
            const baseAng = u.side === 'left' ? 0 : Math.PI;
            fire(u.x, u.y, Math.cos(baseAng) * 2.8 * spd, Math.sin(baseAng) * 2.8 * spd, u.side);
            fire(u.x, u.y, Math.cos(baseAng + 0.3) * 2.5 * spd, Math.sin(baseAng + 0.3) * 2.5 * spd, u.side);
            fire(u.x, u.y, Math.cos(baseAng - 0.3) * 2.5 * spd, Math.sin(baseAng - 0.3) * 2.5 * spd, u.side);
        } else if (ft === '8dir') {
            for (let ang = 0; ang < Math.PI * 2; ang += Math.PI / 4)
                fire(u.x, u.y, Math.cos(ang) * 2.2 * spd, Math.sin(ang) * 2.2 * spd, u.side);
        } else if (ft === 'circle6') {
            for (let ang = 0; ang < Math.PI * 2; ang += Math.PI / 3)
                fire(u.x, u.y, Math.cos(ang) * 1.8 * spd, Math.sin(ang) * 1.8 * spd, u.side);
        } else if (ft === 'burst') {
            const baseAng = u.side === 'left' ? 0 : Math.PI;
            fire(u.x, u.y, Math.cos(baseAng) * 4.2 * spd, Math.sin(baseAng) * 4.2 * spd, u.side);
            fire(u.x, u.y - 8, Math.cos(baseAng) * 3.8 * spd, Math.sin(baseAng) * 3.8 * spd, u.side);
            fire(u.x, u.y + 8, Math.cos(baseAng) * 3.8 * spd, Math.sin(baseAng) * 3.8 * spd, u.side);
        } else if (ft === 'homing2') {
            fire(u.x, u.y, u.side === 'left' ? 2.5 * spd : -2.5 * spd, 0, u.side, { homing: true });
            fire(u.x, u.y, u.side === 'left' ? 2.5 * spd : -2.5 * spd, 0.6 * spd, u.side, { homing: true });
        } else if (ft === 'single') {
            const baseSpd = u.action === 'laser' || u.action === 'sniper' ? 4.8 * spd : 3.0 * spd;
            fire(u.x, u.y, u.side === 'left' ? baseSpd : -baseSpd, 0, u.side);
        }
    });
}

function populateEncyclopedia() {
    const list = document.getElementById('encyclopedia-list');
    if (!list) return;
    list.innerHTML = '';

    // 通常ユニットセクション見出し
    const normalHeader = document.createElement('div');
    normalHeader.style.cssText = 'width: 100%; color: #0df; font-size: 1.1rem; font-weight: bold; border-bottom: 2px solid #0df; padding-bottom: 5px; margin-bottom: 10px;';
    normalHeader.textContent = '通常ユニット一覧';
    list.appendChild(normalHeader);

    // 全通常ユニットのキーを取得してソート
    const allKeys = Object.keys(UNIT_TYPES).sort((a, b) => {
        const typeOrder = { 'rice': 0, 'soda': 1, 'cola': 2 };
        return (typeOrder[UNIT_TYPES[a].type] ?? 9) - (typeOrder[UNIT_TYPES[b].type] ?? 9);
    });

    allKeys.forEach(key => {
        const u = UNIT_TYPES[key];
        const div = document.createElement('div');
        div.style.cssText = 'background: #333; border: 1px solid #777; padding: 10px; width: 220px; text-align: left; position: relative; border-radius: 6px;';

        const spr = ASSETS[key];
        let imgTag = '';
        if (spr) {
            imgTag = `<img src="${spr.toDataURL()}" style="width: 40px; height: 40px; image-rendering: pixelated; margin-right: 8px;">`;
        }

        let stats = '';
        if (u.type === 'rice') stats = `HP: ${u.hp} / Cost: ${u.cost}`;
        else if (u.type === 'cola') stats = `Power: ${u.power} / Cost: ${u.cost}`;
        else if (u.type === 'soda') stats = `Mana回復: ${u.manaGen}/s / Cost: ${u.cost}`;

        div.innerHTML = `
            <div style="display: flex; align-items: center; margin-bottom: 5px;">
                ${imgTag}
                <div>
                    <strong style="color: #fb0; font-size: 0.95rem;">${u.name}</strong><br>
                    <small style="color: #0df;">${stats}</small>
                </div>
            </div>
            <p style="font-size: 0.75rem; margin-top: 5px; border-top: 1px solid #555; padding-top: 5px; line-height: 1.3; color: #ddd;">${u.desc || '説明はありません。'}</p>
        `;
        list.appendChild(div);
    });

    // シークレット特殊進化（キメラ合体）セクション
    const chimeraHeader = document.createElement('div');
    chimeraHeader.style.cssText = 'width: 100%; color: #ffd700; font-size: 1.1rem; font-weight: bold; border-bottom: 2px solid #ffd700; padding-bottom: 5px; margin: 20px 0 10px 0;';
    chimeraHeader.textContent = `シークレット特殊進化キメラ (全${Object.keys(SECRET_CHIMERAS).length}種)`;
    list.appendChild(chimeraHeader);

    const discovered = JSON.parse(localStorage.getItem('inamu_discovered_chimeras') || '[]');

    Object.keys(SECRET_CHIMERAS).forEach(k => {
        const chimera = SECRET_CHIMERAS[k];
        const isDiscovered = discovered.includes(chimera.id);
        const div = document.createElement('div');
        div.style.cssText = 'background: ' + (isDiscovered ? '#2a1a3a' : '#1e1e24') + '; border: 1px solid ' + (isDiscovered ? '#ffd700' : '#444') + '; padding: 10px; width: 220px; text-align: left; position: relative; border-radius: 6px;';

        const spr = ASSETS[chimera.id];
        let imgTag = '';
        if (isDiscovered && spr) {
            imgTag = `<img src="${spr.toDataURL()}" style="width: 40px; height: 40px; image-rendering: pixelated; margin-right: 8px;">`;
        } else {
            imgTag = `<div style="width: 40px; height: 40px; background: #111; border: 1px dashed #555; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; color: #555; margin-right: 8px;">？</div>`;
        }

        if (isDiscovered) {
            div.innerHTML = `
                <div style="display: flex; align-items: center; margin-bottom: 5px;">
                    ${imgTag}
                    <div>
                        <strong style="color: #ffd700; font-size: 0.95rem;">${chimera.name}</strong><br>
                        <small style="color: #0df;">HP: ${chimera.hp} / 攻: ${chimera.power || '-'}</small>
                    </div>
                </div>
                <div style="font-size: 0.72rem; color: #f39c12; margin-bottom: 3px; font-weight: bold;">配合レシピ: ${chimera.pairHint}</div>
                <p style="font-size: 0.75rem; margin-top: 3px; border-top: 1px solid #555; padding-top: 3px; line-height: 1.3; color: #ddd;">${chimera.desc}</p>
            `;
        } else {
            div.innerHTML = `
                <div style="display: flex; align-items: center; margin-bottom: 5px;">
                    ${imgTag}
                    <div>
                        <strong style="color: #777; font-size: 0.95rem;">？？？ (未発見)</strong><br>
                        <small style="color: #555;">シークレット進化</small>
                    </div>
                </div>
                <div style="font-size: 0.7rem; color: #555; margin-bottom: 3px;">配合レシピ: ？？？？？？？？？？</div>
                <p style="font-size: 0.75rem; margin-top: 3px; border-top: 1px solid #333; padding-top: 3px; line-height: 1.3; color: #666;">まだ発見されていない未知のシークレットキメラです。戦場で特殊な合成を成功させると配合レシピが解放されます。</p>
            `;
        }
        list.appendChild(div);
    });
}


// 自分の画面で計算する立場か（練習場・CPU戦・オンラインのホスト）
function isLocalAuthority() {
    return gameState.isPractice || gameState.isBotMatch || gameState.isHost;
}

function attemptFireColaTarget(cola, tx, ty) {
    // 練習場・CPU戦・ホストは自分で発射する（以前はサーバーに送るだけで、CPU戦では何も起きなかった）
    if (isLocalAuthority()) processFireColaTarget(cola.x, cola.y, tx, ty, gameState.playerSide);
    if (gameState.isPractice || gameState.isBotMatch) return;
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
            type: 'signal', action: 'fire_cola_target',
            colaIdX: cola.x, colaIdY: cola.y, tx, ty, side: gameState.playerSide
        }));
    }
}

function endGame(winner) {
    // 1試合につき1回だけ実行（以前は試合後も毎フレーム呼ばれ、レートが何度も変動していた）
    if (!gameState.isPlaying) return;
    gameState.isPlaying = false;

    // オンライン対戦なら、サーバーに部屋を出ることを伝えてホスト役を解除する
    const wasOnline = !gameState.isBotMatch && !gameState.isPractice;
    if (wasOnline && socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'leave_room' }));
    }
    gameState.isHost = false;
    gameState.roomId = null;
    gameState.isMatching = false;
    // マッチ成立時に「キャンセル」のまま残っていたボタン表示を元に戻す
    const btnFindMatch = document.getElementById('btn-find-match');
    if (btnFindMatch) btnFindMatch.innerText = '対戦相手を探す';

    SoundManager.playVictory();
    const winnerName = (gameState.players[winner] && gameState.players[winner].name)
        ? gameState.players[winner].name
        : (winner === 'left' ? 'P1' : 'P2');
    statusMsg.innerText = `ゲーム終了！ 勝者: 【${winnerName}】！`;
    menuOverlay.classList.remove('hidden');
    gameUI.classList.add('hidden');
    gameState.isBotMatch = false;
    gameState.isPractice = false;
    const dpsPanel = document.getElementById('dps-panel');
    if (dpsPanel) dpsPanel.classList.add('hidden');

    // ELO 計算 (簡易版)。オンライン対戦（すべてレート戦）だけ変わる。CPU対戦・練習場では変わらない
    if (wasOnline) {
        updateElo(winner === gameState.playerSide ? 32 : -32);
    }
}

function updateElo(delta) {
    // CloudSyncManagerを通じてローカル+サーバー両方に保存
    CloudSyncManager.updateElo(delta).then(elo => {
        console.log(`ELO更新: ${elo > 0 ? '+' : ''}${delta} → 合計: ${elo}`);
    });
}

function removeBullet(index) {
    const b = gameState.bullets.splice(index, 1)[0];
    bulletPool.push(b);
}

function draw() {
    fitCanvasResolution();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // ここから先は 576×288 の座標で描く（高解像度への拡大は RENDER_SCALE で行う）
    ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);

    ctx.save();
    // 📷 カメラの拡大・縮小＆位置移動をキャンバス全体に適用
    const W = CONFIG.SCREEN_WIDTH, H = CONFIG.SCREEN_HEIGHT;
    ctx.translate(W / 2, H / 2);
    ctx.scale(Camera.zoom, Camera.zoom);
    ctx.translate(-W / 2 + Camera.x, -H / 2 + Camera.y);

    // 陣地の色分け（自分の陣地=薄い青、相手の陣地=薄い赤）
    {
        const half = (CONFIG.GRID_COLS / 2) * CONFIG.TILE_SIZE;
        const h = CONFIG.GRID_ROWS * CONFIG.TILE_SIZE;
        const mineLeft = gameState.playerSide === 'left';
        ctx.fillStyle = mineLeft ? 'rgba(70, 150, 255, 0.10)' : 'rgba(255, 80, 80, 0.10)';
        ctx.fillRect(0, 0, half, h);
        ctx.fillStyle = mineLeft ? 'rgba(255, 80, 80, 0.10)' : 'rgba(70, 150, 255, 0.10)';
        ctx.fillRect(half, 0, half, h);
    }

    // グリッド描画 (網目をわかりやすく)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    const tile = CONFIG.TILE_SIZE;

    for (let i = 0; i <= CONFIG.GRID_COLS; i++) {
        ctx.beginPath();
        ctx.moveTo(i * tile, 0);
        ctx.lineTo(tile * i, CONFIG.GRID_ROWS * tile);
        ctx.stroke();
    }
    for (let j = 0; j <= CONFIG.GRID_ROWS; j++) {
        ctx.beginPath();
        ctx.moveTo(0, j * tile);
        ctx.lineTo(CONFIG.SCREEN_WIDTH, j * tile);
        ctx.stroke();
    }

    // 🌋 フィールドギミックの描画 (炭酸ファウンテン・黄金稲穂・ポータル)
    FieldGimmickManager.draw(ctx);

    // プレイヤー描画
    drawPlayer('left', 'player_left');
    drawPlayer('right', 'player_right');

    // ユニット描画
    gameState.units.forEach(u => {
        // キメラの場合はキメラスプライト、通常はtypeKeyのスプライトを使用
        const sprKey = (u.isSecretChimera && u.chimeraId) ? u.chimeraId : u.typeKey;
        const sprite = ASSETS[sprKey] || ASSETS[u.typeKey];
        if (u.isFinalForm) {
            drawBlackMist(u);
        } else if (sprite) {
            ctx.drawImage(sprite, u.x - 16, u.y - 16);
            // 溜めゲージの描画
            if (u.action === 'charge' && !u.fired) {
                const gx = u.x - 12; const gy = u.y + 14;
                ctx.fillStyle = '#444'; ctx.fillRect(gx, gy, 24, 4);
                ctx.fillStyle = '#ff0'; ctx.fillRect(gx, gy, 24 * (u.charge || 0), 4);
            }
        }

        // 🫧 バブルシールド描画（クヴェレの泡バリア）
        if (u.hasBubbleShield) {
            ctx.save();
            ctx.strokeStyle = 'rgba(0, 220, 255, 0.85)';
            ctx.fillStyle = 'rgba(0, 200, 255, 0.2)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(u.x, u.y, 18, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        }

        // 合成されている場合・シークレットの追加エフェクト（オーラとバッジ）※最終形態は何も出さない
        if ((u.extractionCount > 0 || u.isSecretChimera) && !u.isFinalForm) {
            const count = u.extractionCount;
            const t = Date.now() / 400;
            const pulse = 0.5 + Math.sin(t * 3) * 0.5;
            // キメラは金色のオーラ
            const hue = u.isSecretChimera ? 45 : (u.side === 'left' ? 180 : 30);

            ctx.save();
            ctx.translate(u.x, u.y);
            
            // 下部のオーラ
            ctx.fillStyle = u.isSecretChimera
                ? `rgba(255, 215, 0, ${0.4 * pulse})`
                : `hsla(${hue}, 100%, 70%, ${0.3 * pulse})`;
            ctx.beginPath();
            ctx.ellipse(0, 12, 16 + count, 6, 0, 0, Math.PI * 2);
            ctx.fill();

            // 合成回数バッジ
            ctx.fillStyle = `hsla(${hue}, 100%, 70%, 0.9)`;
            ctx.font = `9px ${GAME_FONT}`;
            ctx.textAlign = 'center';
            if (count > 0) ctx.fillText(`×${count}`, 0, -18);
            ctx.restore();
        }

        // 合成モード中のハイライト
        if (gameState.extractionMode && u.side === gameState.playerSide && u.hp > 0) {
            const isSelected = gameState.extractionSelections.some(s => s === u);
            // 選択されている場合は青枠、まだ選択されていない場合は緑枠
            ctx.strokeStyle = isSelected ? '#0ff' : '#0a8';
            ctx.lineWidth = isSelected ? 3 : 1.5;
            ctx.strokeRect(u.col * tile, u.row * tile, tile, tile);
            if (isSelected) {
                ctx.fillStyle = 'rgba(0, 200, 255, 0.15)';
                ctx.fillRect(u.col * tile, u.row * tile, tile, tile);
            }
        }
    });

    // 召喚・吸収演出の描画
    gameState.summoningEffects.forEach(ef => {
        if (ef.type === 'absorption') {
            ctx.fillStyle = '#0ff';
            ctx.beginPath();
            ctx.arc(ef.x, ef.y, 6 + Math.random() * 4, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.strokeStyle = '#fff';
            ctx.beginPath();
            ctx.moveTo(ef.x - 4 + Math.random() * 8, ef.y - 4 + Math.random() * 8);
            ctx.lineTo(ef.x - 4 + Math.random() * 8, ef.y - 4 + Math.random() * 8);
            ctx.stroke();
            return;
        }

        const sprite = ASSETS[ef.typeKey];
        if (sprite) {
            ctx.save();
            ctx.globalAlpha = 0.7;
            ctx.translate(ef.x, ef.y);
            // 飛んでる間は回転させる演出
            ctx.rotate(ef.progress * Math.PI * 4);
            ctx.drawImage(sprite, -16, -16);
            ctx.restore();
        }
    });

    // コーラ選択状態の表示
    if (gameState.selectedCola && gameState.selectedCola.hp > 0 && !gameState.selectedCola.fired) {
        ctx.strokeStyle = '#0f0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(gameState.selectedCola.x, gameState.selectedCola.y, 20, 0, Math.PI * 2);
        ctx.stroke();
    }

    // プレビュー中ユニットのハイライト枠
    if (gameState.previewedUnit && gameState.previewedUnit.hp > 0) {
        const pu = gameState.previewedUnit;
        const t2 = Date.now() / 500;
        const alpha = 0.5 + Math.sin(t2) * 0.35;
        ctx.strokeStyle = `rgba(255, 240, 80, ${alpha})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(pu.col * tile + 1, pu.row * tile + 1, tile - 2, tile - 2);
    }

    // 弾描画
    gameState.bullets.forEach(b => {
        if (b.spriteKey && ASSETS[b.spriteKey]) {
            // コーラ自身が飛んでいく演出（回転しながら）
            ctx.save();
            ctx.translate(b.x, b.y);
            ctx.rotate(Math.atan2(b.vy, b.vx) + Math.PI / 2);
            ctx.drawImage(ASSETS[b.spriteKey], -16, -16); // 32x32画像
            ctx.restore();
        } else {
            // 特殊弾丸および米粒のドット絵を描画する
            ctx.save();
            ctx.translate(b.x, b.y);
            ctx.rotate(Math.atan2(b.vy, b.vx));

            if (b.action === 'laser') {
                // ルクス ライス: 高速シアンレーザー光線
                ctx.fillStyle = '#0ff';
                ctx.fillRect(-10, -1.5, 20, 3);
                ctx.fillStyle = '#fff';
                ctx.fillRect(-6, -0.5, 12, 1);
            } else if (b.action === 'poison') {
                // ギフト ライス: 紫色の毒胞子
                ctx.fillStyle = '#9b59b6';
                ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#2ecc71';
                ctx.fillRect(-1, -1, 2, 2);
            } else if (b.action === 'frost') {
                // フロスト ライス: 水色の氷結晶
                ctx.fillStyle = '#74b9ff';
                ctx.beginPath(); ctx.arc(0, 0, 4, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#fff';
                ctx.fillRect(-3, -0.5, 6, 1); ctx.fillRect(-0.5, -3, 1, 6);
            } else if (b.action === 'sniper') {
                // プレツィザ ライス: 赤い徹甲狙撃弾
                ctx.fillStyle = '#ff7675';
                ctx.fillRect(-8, -1.5, 16, 3);
                ctx.fillStyle = '#fdcb6e';
                ctx.fillRect(4, -1, 3, 2);
            } else {
                // 通常の米粒
                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.ellipse(0, 0, 4, 2, 0, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = '#ddd';
                ctx.beginPath();
                ctx.ellipse(0, 1, 3, 1, 0, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.restore();
        }
    });

    // ⚡ 衝突の火花・電撃チェーン・毒の霧
    BattleFx.draw(ctx);

    // ✨ パーティクル
    Particles.draw(ctx);

    // 💥 ダメージ数字
    DamageNumbers.draw(ctx);

    ctx.restore();

    // UI 更新 (バー描画用)
    updateStatusBars();
}

function updateStatusBars() {
    const p1 = gameState.players.left;
    const p2 = gameState.players.right;
    const myMana = gameState.players[gameState.playerSide].mana;

    const maxHp1 = p1.maxHp || 2000;
    const maxHp2 = p2.maxHp || (gameState.isPractice ? 1000000 : 2000);

    const hitPointRatio1 = Math.max(0, p1.hp) / maxHp1 * 100;
    const hitPointRatio2 = Math.max(0, p2.hp) / maxHp2 * 100;
    const manaRatio = Math.max(0, myMana) / 100 * 100;

    document.getElementById('p1-hp-fill').style.width = `${hitPointRatio1}%`;
    document.getElementById('p2-hp-fill').style.width = `${hitPointRatio2}%`;
    document.getElementById('mana-fill').style.width = `${manaRatio}%`;

    document.getElementById('p1-hp-text').innerText = `${p1.name} HP: ${Math.floor(p1.hp).toLocaleString()} / ${maxHp1.toLocaleString()}`;
    document.getElementById('p2-hp-text').innerText = `${p2.name} HP: ${Math.floor(p2.hp).toLocaleString()} / ${maxHp2.toLocaleString()}`;
    document.getElementById('mana-text').innerText = `Mana: ${Math.floor(myMana)}`;

    // 準備時間の表示
    if (gameState.prepTimer > 0) {
        ctx.fillStyle = '#fff';
        ctx.font = `20px ${GAME_FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText(`準備中... ${Math.ceil(gameState.prepTimer / CONFIG.FPS)}`, CONFIG.SCREEN_WIDTH / 2, 30);
    }
}

// drawExtractionUnit は削除されました（既存ユニットの見た目を維持するため）

function drawPlayer(side, spriteKey) {
    const p = gameState.players[side];
    const baseX = side === 'left' ? 16 : CONFIG.SCREEN_WIDTH - 16;
    const baseY = p.y + 16; // 中心Y座標

    // 練習場のかかし判定
    const isScarecrow = gameState.isPractice && side === 'right';
    const key = isScarecrow ? 'scarecrow' : (side === 'left' ? 'player_left' : 'player_right');
    const spr = ASSETS[key];

    ctx.save();
    
    // 生き生きとした呼吸・バウンスアニメーション
    const t = Date.now() / 150;
    const bounce = Math.sin(t) * 1.5;
    const tilt = isScarecrow ? Math.sin(t * 0.5) * 0.04 : (side === 'left' ? 0.05 : -0.05);

    ctx.translate(baseX, baseY + bounce);

    // 投擲アクション（少し前傾して光る魔力エフェクト）
    if (p.throwTimer > 0) {
        const lean = (side === 'left' ? 1 : -1) * 0.3 * (p.throwTimer / 10);
        ctx.rotate(lean);
        
        // 投擲時の魔法エフェクト
        ctx.fillStyle = side === 'left' ? 'rgba(46, 204, 113, 0.4)' : 'rgba(231, 76, 60, 0.4)';
        ctx.beginPath();
        ctx.arc(side === 'left' ? 12 : -12, -4, 10 * (p.throwTimer / 10), 0, Math.PI * 2);
        ctx.fill();
    } else {
        ctx.rotate(tilt);
    }

    if (spr) {
        // 32x32 ドット絵スプライトの高品質描画
        // 左プレイヤーは右向き、右プレイヤーは左向き
        if (side === 'right' && !isScarecrow) {
            ctx.scale(-1, 1);
        }
        ctx.drawImage(spr, -16, -16, 32, 32);
    }

    ctx.restore();
}

function exitPracticeMode() {
    gameState.isPlaying = false;
    gameState.isPractice = false;
    Sandbox.showUI(false);
    updateUnitUI();
    menuOverlay.classList.remove('hidden');
    gameUI.classList.add('hidden');
    const btnExitP = document.getElementById('btn-exit-practice');
    if (btnExitP) btnExitP.classList.add('hidden');
    const dpsPanel = document.getElementById('dps-panel');
    if (dpsPanel) dpsPanel.classList.add('hidden');
}

function leaveRoom() {
    if (gameState.isMatching) {
        cancelMatch();
    }
    if (gameState.matchTimeoutTimer) {
        clearTimeout(gameState.matchTimeoutTimer);
        gameState.matchTimeoutTimer = null;
    }
    if (socket && !gameState.isBotMatch) {
        socket.close();
        socket = null;
    }
    gameState.isPlaying = false;
    gameState.roomId = null;
    gameState.isHost = false;
    gameState.isMatching = false;
    gameState.isBotMatch = false;
    gameState.isPractice = false;

    menuOverlay.classList.remove('hidden');
    gameUI.classList.add('hidden');
    const rd = document.getElementById('room-display');
    if (rd) rd.innerText = `Room: -`;
    const btnFindMatch = document.getElementById('btn-find-match');
    if (btnFindMatch) btnFindMatch.innerText = '対戦相手を探す';
    const dpsPanel = document.getElementById('dps-panel');
    if (dpsPanel) dpsPanel.classList.add('hidden');
}

function handleSpreadEffect(b) {
    const num = 12; // 8から12に増やして豪華に
    for (let i = 0; i < num; i++) {
        const angle = (Math.PI * 2 / num) * i;
        const spd = 5;
        // 微小なオフセットを加えて即時再衝突を防ぐ
        const ox = Math.cos(angle) * 10;
        const oy = Math.sin(angle) * 10;
        spawnBullet(b.x + ox, b.y + oy, Math.cos(angle) * spd, Math.sin(angle) * spd, b.side, { power: 10, spriteKey: 'bullet', size: 4 });
    }
}

init();

// 🤖 CPUのバフ: 撃つ関数を包んで、弾の威力に倍率を掛ける（関数がすべて定義された後に行う）
fireUnit = withPowerBuff(fireUnit);
fireExtractionUnit = withPowerBuff(fireExtractionUnit);
fireColaTarget = withPowerBuff(fireColaTarget);
fireCola = withPowerBuff(fireCola);
