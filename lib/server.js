const { WebSocketServer } = require('ws');
const { randomUUID } = require('crypto');
const EventEmitter = require('events');

// socket-be互換のイベント定義
const ServerEvent = {
    Open: 'open',
    Close: 'close',
    WorldAdd: 'connect',
    WorldRemove: 'disconnect',
    PlayerChat: 'chat',
    PlayerLoad: 'join',
    PlayerLeave: 'leave',
    SlashCommandExecuted: 'command_executed',
    // ★追加: 位置同期と移動イベント
    PlayerTransform: 'player_transform',
    PlayerTravelled: 'player_travelled'
};

// ★追加: ServerEvent と Minecraftの生イベント名の対応表
// server.on() でこれらが指定されたら、自動的に subscribe します
const MC_EVENT_MAP = {
    [ServerEvent.PlayerChat]: 'PlayerMessage',
    [ServerEvent.SlashCommandExecuted]: 'SlashCommandExecuted',
    [ServerEvent.PlayerTransform]: 'PlayerTransform',
    [ServerEvent.PlayerTravelled]: 'PlayerTravelled'
};

class Player {
    constructor(connection, name) {
        this.connection = connection;
        this.name = name;
    }

    async sendMessage(message) {
        const safeMsg = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        // tellrawはrunCommand側で高速化されます
        return this.connection.runCommand(`tellraw "${this.name}" {"rawtext":[{"text":"${safeMsg}"}]}`);
    }
}

// 新しい Connection クラス
class Connection {
    constructor(server, ws, req) {
        this.server = server;
        this.ws = ws;
        this.req = req;
        this.commandQueue = new Map();
        this.players = new Map();
        this.playerCheckInterval = null;
        this.subscribedEvents = new Set(['PlayerMessage']);

        // セッションIDの抽出
        const pvcSessionId = req && req.headers ? req.headers['x-proxvc-session'] : undefined;
        // ドメイン（Host）情報の抽出
        const pvcDomain = req && req.headers ? (req.headers['x-proxvc-domain'] || req.headers['host']) : undefined;

        this.world = {
            name: 'Bedrock World',
            localPlayer: { name: 'Unidentified Host' },
            runCommand: this.runCommand.bind(this),
            sendMessage: this.broadcast.bind(this),
            getPlayers: async () => {
                const res = await this.runCommand('list');
                if (res.statusCode === 0 && res.players) {
                    return res.players.split(', ');
                }
                return [];
            },
            pvcSessionId: pvcSessionId,
            pvcDomain: pvcDomain
        };

        this.init();
    }

    init() {
        this.server.emit(ServerEvent.WorldAdd, { world: this.world });

        // 自動購読
        this.server.subscribedEvents.forEach(eventName => {
            this.subscribe(eventName);
        });

        this.identifyHost();
        this.startPlayerPolling();

        this.ws.on('message', (data) => this._handleMessage(data));
        this.ws.on('close', () => {
            this.stopPlayerPolling();
            this.players.clear();
            this.server.emit(ServerEvent.WorldRemove, { world: this.world });
            this.server.connections.delete(this);
        });
        this.ws.on('error', (e) => console.error('[Connection] WebSocket Error:', e.message));
    }

    async identifyHost() {
        try {
            const res = await this.runCommand('getlocalplayername');
            if (res && res.localplayername) {
                this.world.localPlayer.name = res.localplayername;
            } else {
                const res2 = await this.runCommand('testfor @s');
                if (res2 && res2.victim && res2.victim.length > 0) {
                    this.world.localPlayer.name = res2.victim[0];
                }
            }
        } catch (e) { }
    }

    startPlayerPolling() {
        if (this.playerCheckInterval) clearInterval(this.playerCheckInterval);

        this.playerCheckInterval = setInterval(async () => {
            if (this.ws.readyState !== 1) return;
            try {
                const res = await this.runCommand('list');
                let currentNames = new Set();

                if (res.statusCode === 0 && res.players) {
                    const names = res.players.split(', ');
                    names.forEach(name => currentNames.add(name));
                }

                for (const [name, player] of this.players) {
                    if (name === '外部') continue;
                    if (!currentNames.has(name)) {
                        this.players.delete(name);
                        this.server.emit(ServerEvent.PlayerLeave, { player, world: this.world });
                    }
                }

                for (const name of currentNames) {
                    if (!this.players.has(name)) {
                        const player = new Player(this, name);
                        this.players.set(name, player);
                        this.server.emit(ServerEvent.PlayerLoad, { player, world: this.world });
                    }
                }
            } catch (e) { }
        }, 1000);
    }

    stopPlayerPolling() {
        if (this.playerCheckInterval) {
            clearInterval(this.playerCheckInterval);
            this.playerCheckInterval = null;
        }
    }

    async runCommand(command) {
        if (this.ws.readyState !== 1) return { statusCode: -1 };

        const requestId = randomUUID();
        const packet = {
            header: {
                requestId,
                messagePurpose: 'commandRequest',
                version: 1,
                messageType: 'commandRequest'
            },
            body: {
                origin: { type: 'player' },
                commandLine: command,
                version: 1
            }
        };
        if (command.startsWith('tellraw') || command.startsWith('titleraw')) {
            this.ws.send(JSON.stringify(packet));
            return Promise.resolve({ statusCode: 0 });
        }

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.commandQueue.delete(requestId);
                resolve({ statusCode: -1, statusMessage: 'Timeout' });
            }, 10000);

            this.commandQueue.set(requestId, { resolve, timeout });

            if (this.ws.readyState === 1) {
                this.ws.send(JSON.stringify(packet));
            } else {
                clearTimeout(timeout);
                this.commandQueue.delete(requestId);
                resolve({ statusCode: -1 });
            }
        });
    }

    async subscribe(eventName) {
        if (this.ws.readyState !== 1) return;

        // 既に購読済みならスキップ (Connection単位で管理)
        if (this.subscribedEvents.has(eventName)) {
            // 重複リクエストは送らない、または再送してもよいが今回は簡略化
        } else {
            this.subscribedEvents.add(eventName);
        }

        const requestId = randomUUID();
        const packet = {
            header: {
                version: 1,
                requestId: requestId,
                messageType: 'commandRequest',
                messagePurpose: 'subscribe'
            },
            body: { eventName: eventName }
        };

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.commandQueue.delete(requestId);
                resolve({ statusCode: -1 });
            }, 2000);

            this.commandQueue.set(requestId, {
                resolve: (res) => {
                    if (res.statusCode !== 0) {
                        console.error(`[Subscribe Error] ${eventName}: ${res.statusMessage}`);
                    }
                    resolve(res);
                },
                timeout
            });

            this.ws.send(JSON.stringify(packet));
        });
    }

    async broadcast(message) {
        const safeMsg = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        return this.runCommand(`tellraw @a {"rawtext":[{"text":"${safeMsg}"}]}`);
    }

    _handleMessage(data) {
        try {
            // if (Buffer.isBuffer(data)) console.log(`[BedrockServer] Buffer Hex: ${data.slice(0, 20).toString('hex')}...`);

            const msg = JSON.parse(data.toString());
            const header = msg.header;
            const body = msg.body;
            const purpose = header.messagePurpose;
            const reqId = header.requestId;

            if (purpose === 'commandResponse') {
                const requestId = header.requestId;
                if (this.commandQueue.has(requestId)) {
                    const { resolve, timeout } = this.commandQueue.get(requestId);
                    clearTimeout(timeout);
                    this.commandQueue.delete(requestId);
                    resolve(body);
                }
            }
            else if (purpose === 'event') {
                const eventName = header.eventName;

                if (eventName === 'PlayerMessage') {
                    const senderName = body.sender;
                    const message = body.message;
                    if (!senderName || !message) return;

                    let player = this.players.get(senderName);
                    if (!player) {
                        player = new Player(this, senderName);
                        this.players.set(senderName, player);
                    }

                    this.server.emit(ServerEvent.PlayerChat, {
                        sender: player,
                        message: message,
                        world: this.world
                    });
                }
                else if (eventName === 'SlashCommandExecuted') {
                    this.server.emit(ServerEvent.SlashCommandExecuted, { ...body, world: this.world }); // worldを追加
                }
                else if (eventName === 'PlayerTransform') {
                    this.server.emit(ServerEvent.PlayerTransform, { ...body, world: this.world }); // worldを追加 (重要)
                }
                else if (eventName === 'PlayerTravelled') {
                    this.server.emit(ServerEvent.PlayerTravelled, { ...body, world: this.world }); // worldを追加
                }
            }
        } catch (e) {
            console.error('JSON Parse Error:', e);
        }
    }
}

class BedrockServer extends EventEmitter {
    constructor(options = {}) {
        super();
        this.options = options;
        this.wss = null;
        this.connections = new Set(); // 複数の Connection を保持

        // 自動購読するイベントのリスト (サーバー全体設定)
        this.subscribedEvents = new Set(['PlayerMessage']);

        const port = options.port || 19132;
        if (options.webSocketOptions && options.webSocketOptions.server) {
            this.wss = new WebSocketServer({ server: options.webSocketOptions.server });
        } else {
            this.wss = new WebSocketServer({ port });
        }
        this.setupWss();
    }

    on(eventName, listener) {
        super.on(eventName, listener);

        const mcEventName = MC_EVENT_MAP[eventName];
        if (mcEventName) {
            this.subscribedEvents.add(mcEventName);
            // 既存の全接続に対して購読リクエストを送る
            this.connections.forEach(conn => conn.subscribe(mcEventName));
        }
        return this;
    }

    setupWss() {
        setTimeout(() => this.emit(ServerEvent.Open), 10);

        this.wss.on('connection', (ws, req) => {
            const connection = new Connection(this, ws, req);
            this.connections.add(connection);
        });
    }
}

module.exports = { Server: BedrockServer, ServerEvent, Player };