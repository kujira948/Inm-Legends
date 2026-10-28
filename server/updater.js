const http = require('http');
const fs = require('fs');
const path = require('path');

function checkAndUpdateFromHost(hostIp, hostPort) {
    return new Promise((resolve) => {
        const url = `http://${hostIp}:${hostPort}/version.json`;
        console.log(`[Auto-Sync] Checking host version at ${url}...`);

        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const hostVerObj = JSON.parse(data);
                    const localVerPath = path.join(__dirname, '../version.json');
                    let localVerObj = { version: '0.0.0' };

                    if (fs.existsSync(localVerPath)) {
                        localVerObj = JSON.parse(fs.readFileSync(localVerPath, 'utf8'));
                    }

                    console.log(`[Auto-Sync] Local version: ${localVerObj.version}, Host version: ${hostVerObj.version}`);

                    if (hostVerObj.version !== localVerObj.version) {
                        console.log(`[Auto-Sync] New version detected! Updating files...`);
                        downloadFile(hostIp, hostPort, 'main.js', () => {
                            downloadFile(hostIp, hostPort, 'index.html', () => {
                                // バージョン情報を同期更新
                                fs.writeFileSync(localVerPath, JSON.stringify(hostVerObj, null, 2));
                                console.log(`[Auto-Sync] Update completed to version ${hostVerObj.version}`);
                                resolve(true);
                            });
                        });
                    } else {
                        console.log(`[Auto-Sync] Files are up to date.`);
                        resolve(false);
                    }
                } catch (e) {
                    console.error('[Auto-Sync] Failed to parse version from host:', e);
                    resolve(false);
                }
            });
        }).on('error', (err) => {
            console.error('[Auto-Sync] Error connecting to host for update:', err.message);
            resolve(false);
        });
    });
}

function downloadFile(hostIp, hostPort, fileName, callback) {
    const fileUrl = `http://${hostIp}:${hostPort}/${fileName}`;
    const targetPath = path.join(__dirname, '../client', fileName);

    http.get(fileUrl, (res) => {
        if (res.statusCode === 200) {
            const fileStream = fs.createWriteStream(targetPath);
            res.pipe(fileStream);
            fileStream.on('finish', () => {
                fileStream.close();
                console.log(`[Auto-Sync] Updated: ${fileName}`);
                if (callback) callback();
            });
        } else {
            console.error(`[Auto-Sync] Failed to download ${fileName}: HTTP ${res.statusCode}`);
            if (callback) callback();
        }
    }).on('error', (err) => {
        console.error(`[Auto-Sync] Error downloading ${fileName}:`, err.message);
        if (callback) callback();
    });
}

module.exports = {
    checkAndUpdateFromHost
};
