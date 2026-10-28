const dgram = require('dgram');
const os = require('os');

const UDP_PORT = 41234;

function getLocalIp() {
    const interfaces = os.networkInterfaces();
    const candidates = [];

    for (const devName in interfaces) {
        const iface = interfaces[devName];
        const lowerName = devName.toLowerCase();
        // 仮想アダプタ（VMware, VirtualBox, vEthernet, loopback, bluetooth）を後回しにする
        const isVirtual = lowerName.includes('virtual') || lowerName.includes('vmware') || 
                          lowerName.includes('vethernet') || lowerName.includes('loopback') || 
                          lowerName.includes('bluetooth') || lowerName.includes('wsl');

        for (let i = 0; i < iface.length; i++) {
            const alias = iface[i];
            if (alias.family === 'IPv4' && !alias.internal && alias.address !== '127.0.0.1') {
                candidates.push({
                    address: alias.address,
                    isVirtual: isVirtual,
                    isWifiOrEth: lowerName.includes('wi-fi') || lowerName.includes('wireless') || lowerName.includes('ethernet') || lowerName.includes('イーサネット')
                });
            }
        }
    }

    // 優先順位: 1. 物理Wi-Fi/Ethernet 2. 非仮想アダプタ 3. その他
    candidates.sort((a, b) => {
        if (a.isWifiOrEth && !b.isWifiOrEth) return -1;
        if (!a.isWifiOrEth && b.isWifiOrEth) return 1;
        if (!a.isVirtual && b.isVirtual) return -1;
        if (a.isVirtual && !b.isVirtual) return 1;
        return 0;
    });

    return candidates.length > 0 ? candidates[0].address : '127.0.0.1';
}

function getBroadcastAddresses() {
    const addresses = ['255.255.255.255'];
    const interfaces = os.networkInterfaces();
    for (const devName in interfaces) {
        const iface = interfaces[devName];
        for (let i = 0; i < iface.length; i++) {
            const alias = iface[i];
            if (alias.family === 'IPv4' && !alias.internal && alias.address !== '127.0.0.1') {
                try {
                    const ipParts = alias.address.split('.').map(Number);
                    const maskParts = (alias.netmask || '255.255.255.0').split('.').map(Number);
                    const bcastParts = ipParts.map((part, idx) => (part & maskParts[idx]) | (~maskParts[idx] & 255));
                    addresses.push(bcastParts.join('.'));
                } catch (e) {}
            }
        }
    }
    return Array.from(new Set(addresses));
}

function discoverHost(timeoutMs = 2000) {
    return new Promise((resolve) => {
        const client = dgram.createSocket('udp4');
        let resolved = false;

        client.on('error', (err) => {
            console.error('[Discovery] Error:', err);
            if (!resolved) {
                resolved = true;
                client.close();
                resolve(null);
            }
        });

        client.on('message', (msg, rinfo) => {
            try {
                const data = JSON.parse(msg.toString());
                if (data.type === 'HOST_OFFER' && !resolved) {
                    resolved = true;
                    client.close();
                    resolve({
                        hostIp: rinfo.address,
                        port: data.port || 3000,
                        hostName: data.hostName || 'ホストプレイヤー',
                        version: data.version || '1.0.0'
                    });
                }
            } catch (e) {
                // Ignore invalid packets
            }
        });

        client.bind(() => {
            client.setBroadcast(true);
            const packet = Buffer.from(JSON.stringify({ type: 'DISCOVER_HOST' }));

            // すべてのブロードキャスト宛先（255.255.255.255 & サブネットブロードキャスト）へ送信
            const bcastAddrs = getBroadcastAddresses();
            bcastAddrs.forEach(addr => {
                client.send(packet, 0, packet.length, UDP_PORT, addr, () => {});
            });
        });

        setTimeout(() => {
            if (!resolved) {
                resolved = true;
                client.close();
                resolve(null);
            }
        }, timeoutMs);
    });
}

function startDiscoveryResponder(serverInfo) {
    const server = dgram.createSocket('udp4');

    server.on('error', (err) => {
        console.error('[Discovery Responder] Error:', err);
        server.close();
    });

    server.on('message', (msg, rinfo) => {
        try {
            const data = JSON.parse(msg.toString());
            if (data.type === 'DISCOVER_HOST') {
                const response = Buffer.from(JSON.stringify({
                    type: 'HOST_OFFER',
                    port: serverInfo.port || 3000,
                    hostName: serverInfo.hostName || 'ホストプレイヤー',
                    version: serverInfo.version || '1.0.0'
                }));
                server.send(response, 0, response.length, rinfo.port, rinfo.address);
            }
        } catch (e) {
            // Ignore
        }
    });

    server.bind(UDP_PORT, () => {
        console.log(`[Discovery Responder] Listening on UDP port ${UDP_PORT}`);
    });

    return server;
}

module.exports = {
    getLocalIp,
    discoverHost,
    startDiscoveryResponder
};
