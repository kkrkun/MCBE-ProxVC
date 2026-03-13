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

const cleanName = (name) => name.replace(/[\uE000-\uF8FF]/g, "");

class Player {
    constructor(connection, name, displayName) {
        this.connection = connection;
        this.name = cleanName(name);
        this.displayName = displayName || this.name;
    }

    async sendMessage(message) {
        const safeMsg = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        const safeName = this.displayName.replace(/"/g, '\\"');
        // tellrawはrunCommand側で高速化されます
        return this.connection.runCommand(`tellraw @a[name="${safeName}"] {"rawtext":[{"text":"${safeMsg}"}]}`);
    }

    async runCommand(command) {
        const safeName = this.displayName.replace(/"/g, '\\"');
        return this.connection.runCommand(`execute as @a[name="${safeName}"] run ${command}`);
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
                const res = await this.runCommand('testfor @a');
                if (res.statusCode === 0 && res.victim) {
                    return res.victim;
                }
                return [];
            },
            getPlayer: (name) => {
                const p = this.players.get(cleanName(name));
                return p;
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
            const res2 = await this.runCommand('testfor @s');
            if (res2 && res2.victim && res2.victim.length > 0) {
                this.world.localPlayer.name = cleanName(res2.victim[0]);
            }
        } catch (e) { }
    }

    startPlayerPolling() {
        if (this.playerCheckInterval) clearInterval(this.playerCheckInterval);

        this.playerCheckInterval = setInterval(async () => {
            if (this.ws.readyState !== 1) return;
            try {
                const res = await this.runCommand('testfor @a');
                let currentCleanedNames = new Set();
                let rawNames = new Map(); // clean -> raw

                if (res.statusCode === 0 && res.victim) {
                    const names = res.victim;
                    names.forEach(name => {
                        const clean = cleanName(name);
                        currentCleanedNames.add(clean);
                        rawNames.set(clean, name);
                    });
                }

                for (const [cName, player] of this.players) {
                    if (cName === '外部') continue;
                    // Check if cleaned name still exists in the current list
                    if (!currentCleanedNames.has(cName)) {
                        this.players.delete(cName);
                        this.server.emit(ServerEvent.PlayerLeave, { player, world: this.world });
                    } else {
                        // Update display name if changed
                        const newRaw = rawNames.get(cName);
                        if (newRaw && player.displayName !== newRaw) {
                            player.displayName = newRaw;
                        }
                    }
                }

                for (const cName of currentCleanedNames) {
                    if (!this.players.has(cName)) {
                        const raw = rawNames.get(cName);
                        const player = new Player(this, cName, raw);
                        this.players.set(cName, player);
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
        if (this.ws.readyState !== 1) {
            return { statusCode: -1 };
        }

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
                version: 17039360
            }
        };
        if (command.includes('tellraw') || command.includes('titleraw') || command.includes('scriptevent') || (command.includes('tag') && (command.includes('add') || command.includes('remove')))) {
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

                    const cSenderName = cleanName(senderName);
                    let player = this.players.get(cSenderName);
                    if (!player) {
                        player = new Player(this, cSenderName);
                        this.players.set(cSenderName, player);
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
                    // body.player.name contains the display name (name tag), not the actual GamerTag
                    const displayName = cleanName(body.player.name);
                    let actualPlayerName = displayName; // Default fallback

                    // Find the player by display name
                    for (const [cName, p] of this.players) {
                        if (p.displayName === displayName) {
                            actualPlayerName = cName;
                            break;
                        }
                    }

                    // Replace the name in the body with the actual gamer tag before emitting
                    const transformedBody = { ...body };
                    transformedBody.player.name = actualPlayerName;

                    this.server.emit(ServerEvent.PlayerTransform, { ...transformedBody, world: this.world }); // worldを追加 (重要)
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