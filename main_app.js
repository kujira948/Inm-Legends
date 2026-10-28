const { discoverHost, startDiscoveryResponder, getLocalIp } = require('./server/discovery');
const { checkAndUpdateFromHost } = require('./server/updater');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

async function init() {
    console.log('==================================================');
    console.log('   いなむーレジェンズ ネットワーク自動接続＆起動');
    console.log('==================================================');

    console.log('[1/3] ローカルネットワーク内のホストを検索中...');
    const hostInfo = await discoverHost(1500);

    if (hostInfo) {
        console.log(`\n[2/3] 既存ホストを発見しました！ (${hostInfo.hostIp}:${hostInfo.port} - ${hostInfo.hostName})`);
        
        // 自動アップデートチェック
        await checkAndUpdateFromHost(hostInfo.hostIp, hostInfo.port);

        const targetUrl = `http://${hostInfo.hostIp}:${hostInfo.port}`;
        console.log(`\n[3/3] ゲームサーバー (${targetUrl}) に接続します...`);
        openBrowser(targetUrl);
    } else {
        console.log('\n[2/3] 既存ホストが見つかりません。自分が最初のホストとしてサーバーを起動します。');

        const serverProcess = spawn(process.execPath, [path.join(__dirname, 'server/server.js')], {
            stdio: 'inherit',
            env: { ...process.env, HOST_NAME: 'ホストプレイヤー' }
        });

        // バージョン取得
        let version = '1.0.0';
        try {
            const verData = JSON.parse(fs.readFileSync(path.join(__dirname, 'version.json'), 'utf8'));
            version = verData.version;
        } catch (e) {}

        // UDPレスポンダー開始
        startDiscoveryResponder({
            port: 3000,
            hostName: 'ホストプレイヤー',
            version: version
        });

        setTimeout(() => {
            const targetUrl = `http://localhost:3000`;
            console.log(`\n[3/3] サーバーが立ち上がりました。ブラウザを開きます: ${targetUrl}`);
            openBrowser(targetUrl);
        }, 1200);
    }
}

function openBrowser(url) {
    const startCmd = process.platform === 'win32' ? 'start' : (process.platform === 'darwin' ? 'open' : 'xdg-open');
    spawn(startCmd, [url], { shell: true });
}

init().catch(console.error);
