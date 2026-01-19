// src/ssh_handler.js
const { Client } = require('ssh2');
const net = require('net');

/**
 * SSHトンネルを開始する関数
 * @param {Object} session - セッションオブジェクト
 * @param {string} remoteAddr - 接続先アドレス (tcpexposerのサブドメイン)
 * @param {number} localPort - ローカルポート
 * @returns {Promise<Client>} SSHクライアントインスタンス
 */
function startTcpexposer(session, remoteAddr, localPort) {
    return new Promise((resolve) => {
        const { username, ssh_password, lang } = session.config;
        if (!remoteAddr || !username || !ssh_password) {
            resolve(null);
            return;
        }

        const sshConfig = { host: 'tcpexposer.com', port: 22, username, password: ssh_password };
        const forwardConfig = { remoteAddr, remotePort: 80, localAddr: 'localhost', localPort };

        const client = new Client();
        let solved = false;

        const handleFail = async (err) => {
            if (solved) return;
            solved = true;
            console.error(`❌ SSH Error (${remoteAddr}):`, err.message);
            session.sshError = 'ssh_failed';
            session.logInfo(`[SSH]接続失敗: ${err.message}. リレーサーバーへ切り替えます。`);

            // SSH失敗時にリレーサーバーへフォールバックするロジック
            session.roomId = "";
            await session.connectToRelayServer('mc');

            client.end();
            resolve(null);
        };

        client.on('ready', () => {
            client.forwardIn(forwardConfig.remoteAddr, forwardConfig.remotePort, async (err) => {
                if (err) {
                    console.error(`[SSH]❌ ポートフォワーディング失敗 (${remoteAddr}):`, err.message);
                    await handleFail(err);
                    return;
                }

                // Connection Successful
                console.log("\n=======================================================");
                session.useRelay = false;
                session.vc_connected = true;

                session.logInfo(`Room ID: ${remoteAddr}`);
                if (session.config.lang === "ja") session.logInfo("参加者はこのURLにアクセスしてください:");
                else session.logInfo("Participants should access this URL");
                session.logInfo(`https://mcproxvc.ovh/connect/?roomid=${remoteAddr}`);

                if (session.config.lang === "ja") session.logInfo("Minecraftから以下のコマンドで接続してください:");
                else session.logInfo("Connect from Minecraft with the following command:");
                session.logInfo(`/connect ${remoteAddr}.tcpexposer.com`);
                session.connectCommand = `/connect ${remoteAddr}.tcpexposer.com`;
                if (lang === "ja") session.logInfo("常時接続する場合は以下のコマンドを実行してください:");
                else session.logInfo("For a persistent connection, run the following command:");
                session.logInfo(`/pvc:connect "${remoteAddr}.tcpexposer.com"`);

                console.log("=======================================================\n");

                if (!solved) { solved = true; resolve(client); }
            });

            client.on('tcp connection', (info, accept) => {
                const sshStream = accept();
                const localSocket = net.createConnection({ host: forwardConfig.localAddr, port: forwardConfig.localPort });
                localSocket.on('connect', () => sshStream.pipe(localSocket).pipe(sshStream));
                localSocket.on('error', () => sshStream.close());
                sshStream.on('close', () => localSocket.end());
            });
        }).on('error', (err) => {
            handleFail(err);
        });

        client.on('close', () => {
            if (!solved) { solved = true; resolve(null); }
        });

        client.connect(sshConfig);
    });
}

/**
 * Minecraftプロキシ用のTCPアップグレード処理（SSH接続環境専用）
 * @param {Object} request - HTTPリクエスト
 * @param {Object} socket - ソケット
 * @param {Buffer} head - 先頭バッファ
 * @param {number} targetPort - 転送先のローカルポート(INITIAL_CONFIG.port)
 */
function handleTcpUpgrade(request, socket, head, targetPort) {
    // Minecraft Proxy -> Local MC Server via RAW TCP Pipe
    const backendSocket = net.createConnection({ port: targetPort, host: 'localhost' });

    backendSocket.on('connect', () => {
        const requestHost = request.headers['host'];
        const method = request.method;
        const url = request.url;
        const httpVersion = request.httpVersion;

        let headers = `${method} ${url} HTTP/${httpVersion}\r\n`;
        for (const [key, value] of Object.entries(request.headers)) {
            headers += `${key}: ${value}\r\n`;
        }
        // Inject Session Header
        headers += `x-proxvc-domain: ${requestHost}\r\n`;
        headers += '\r\n'; // End of headers

        backendSocket.write(headers);

        if (head && head.length > 0) {
            backendSocket.write(head);
        }

        socket.pipe(backendSocket);
        backendSocket.pipe(socket);
    });

    backendSocket.on('error', (err) => {
        socket.end();
    });

    backendSocket.on('close', () => {
        socket.end();
    });

    socket.on('error', (err) => {
        backendSocket.end();
    });

    socket.on('close', () => {
        backendSocket.end();
    });
}

module.exports = { startTcpexposer, handleTcpUpgrade };