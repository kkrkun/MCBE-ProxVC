/**
 * Proximity VC Discord Bot
 * 
 * Discord上でProximity VCを制御するBot。
 * unobfuscator_prox_vc.js から startDiscordBot() で呼び出される。
 */
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const {
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder,
    ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder,
    TextInputStyle, SlashCommandBuilder, PermissionFlagsBits, REST, Routes, AttachmentBuilder, Events, MessageFlags, ActivityType
} = require('discord.js');
const {
    joinVoiceChannel, createAudioPlayer, createAudioResource,
    StreamType, VoiceConnectionStatus, entersState,
    AudioPlayerStatus, EndBehaviorType, NoSubscriberBehavior, getVoiceConnection
} = require('@discordjs/voice');
const { getGuildSettings, updateGuildSetting } = require('./guild_settings');
const DC_LOCALES = require('./locales');
const WebSocket = require('ws');
const msgpack = require('msgpack-lite');
const zlib = require('zlib');
const JSON5 = require('json5');

// --- 認証モジュール (server/auth.js) ---
let authMod = null;
try {
    authMod = require('./auth');
} catch (e) {
    console.warn('[Discord] Auth module not found. Authentication flow disabled.', e.message);
}

// --- 定数 ---
const EMBED_COLOR = 0x5865F2;        // Discord Blurple
const EMBED_COLOR_SUCCESS = 0x22c55e; // Green
const EMBED_COLOR_ERROR = 0xef4444;   // Red
const EMBED_COLOR_WARNING = 0xf59e0b; // Amber

/**
 * Discord Botを起動する
 * @param {string} token - Discord Bot Token
 * @param {object} proxvc - unobfuscator_prox_vc.jsから渡されるオブジェクト
 * @param {number} [botIndex=1] - Bot番号 (1〜5)
 * @param {object} [statusManager=null] - StatusManager インスタンス
 */
function startDiscordBot(token, proxvc, botIndex = 1, statusManager = null, region = 'jp') {
    const { sessions, pendingSessions, Session, INITIAL_CONFIG, updateConfigFile, locales } = proxvc;
    const logTag = `\x1b[35m[Discord #${botIndex}]\x1b[0m`;

    // --- 認証クールタイム管理 ---
    const AUTH_COOLDOWN_MS = 60 * 60 * 1000; // 1時間
    const AUTH_REGION = region;
    const AUTH_BASE_URL = proxvc.INITIAL_CONFIG?.auth_base_url || 'https://auth.mcproxvc.ovh';
    const authCooldowns = new Map(); // userId -> lastAuthTimestamp

    function isInAuthCooldown(userId) {
        const last = authCooldowns.get(userId);
        if (!last) return false;
        return (Date.now() - last) < AUTH_COOLDOWN_MS;
    }

    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildVoiceStates,
        ],
    });

    function updateActivity() {
        if (!client.user) return;
        const serverCount = client.guilds.cache.size;
        const targetMax = 100;
        client.user.setActivity({
            name: `${serverCount}/${targetMax} Servers`,
            type: ActivityType.Competing
        });
        if (statusManager) {
            statusManager.updateBot(botIndex, {
                online: true,
                status: 'online',
                bot_id: client.user.id,
                name: client.user.username,
                tag: client.user.tag,
                server_count: serverCount,
                max_servers: targetMax
            });
        }
    }

    // ギルドごとの状態管理
    const guildSessions = new Map();
    const guildLocales = new Map();

    // --- ヘルパー ---

    function getDiscordLocaleMatch(locale) {
        if (!locale) return null;
        if (locale.startsWith('ja')) return 'ja';
        if (locale.startsWith('zh')) return 'zh';
        if (locale.startsWith('en')) return 'en';
        return null;
    }

    function t(guildId, key, params = {}) {
        const settings = getGuildSettings(guildId);
        let lang = settings.lang;

        if (!lang) {
            const rawLocale = guildLocales.get(guildId);
            lang = getDiscordLocaleMatch(rawLocale) || 'en';
        }

        const loc = DC_LOCALES[lang] || DC_LOCALES['en'];
        let text = loc[key] || DC_LOCALES['en']?.[key] || key;
        for (const [k, v] of Object.entries(params)) {
            text = text.replace(`{${k}}`, v);
        }
        return text;
    }

    function makeEmbed(gid, title, description, color = EMBED_COLOR, fields = null) {
        const embed = new EmbedBuilder()
            .setColor(color)
            .setTimestamp();

        embed.setFooter({ text: 'MCBE ProxVC', iconURL: 'attachment://icon.png' });
        if (title) embed.setTitle(title);
        if (description) embed.setDescription(description);
        if (fields) embed.addFields(fields);
        return embed;
    }

    function hasBanPermission(member) {
        if (!member) return false;
        return member.permissions.has(PermissionFlagsBits.ManageGuild) || member.permissions.has(PermissionFlagsBits.Administrator);
    }

    function canStart(interaction) {
        if (!interaction.member) return false;
        const settings = getGuildSettings(interaction.guildId);
        const roles = settings.perm_start;
        if (Array.isArray(roles) && roles.length > 0) {
            return roles.some(roleId => interaction.member.roles.cache.has(roleId)) || interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        }
        return true;
    }

    function canAdmin(interaction, requireHost = false, gs = null) {
        if (!interaction.member) return false;
        if (requireHost && gs && gs.hostId === interaction.user.id) return true;
        const settings = getGuildSettings(interaction.guildId);
        const roles = settings.perm_admin;
        if (Array.isArray(roles) && roles.length > 0) {
            return roles.some(roleId => interaction.member.roles.cache.has(roleId)) || interaction.member.permissions.has(PermissionFlagsBits.Administrator);
        }
        return hasBanPermission(interaction.member);
    }

    async function verifyRoomExists(roomId) {
        for (const session of sessions.values()) {
            if (session.roomId === roomId) return true;
        }
        for (const session of pendingSessions.values()) {
            if (session.roomId === roomId) return true;
        }
        return false;
    }

    /**
     * リモートセッション用のデータWebSocketに3段階リトライ付きで接続する。
     * Web版 (website_proximity_vc/src/connect/main.js) と同様に、
     * 単なるハンドシェイク (open) ではなく、サーバーからの初期メッセージ受信を成功判定とする。
     * ルームが存在しない場合（全ステージ失敗）は例外 (ROOM_NOT_FOUND) をスローする。
     * @param {string} address - ルームID
     * @param {object} gs - guildSession オブジェクト
     * @param {string} gid - guildId
     * @returns {Promise<WebSocket>} 確立された WebSocket インスタンス
     */
    function connectRemoteWsWithRetry(address, gs, gid) {
        if (gs && gs.remoteWs && gs.remoteWs.readyState === WebSocket.OPEN) {
            return Promise.resolve(gs.remoteWs);
        }

        const relayServerDomain = "mcproxvc.fly.dev";
        const oldServerDomain = "mcproxvc.tcpexposer.com";

        const STAGES = [
            { url: `wss://${address}.tcpexposer.com/?clientType=vc`, name: 'プライマリURL' },
            { url: `wss://${relayServerDomain}/room/${address}/?clientType=vc`, name: '代替URL' },
            { url: `wss://${oldServerDomain}/room/${address}/?clientType=vc`, name: '旧URL' }
        ];

        return new Promise((resolve, reject) => {
            const tryStage = (stageIndex) => {
                if (stageIndex >= STAGES.length) {
                    return reject(new Error('ROOM_NOT_FOUND'));
                }

                const { url, name: attemptType } = STAGES[stageIndex];

                let ws;
                try {
                    ws = new WebSocket(url, { handshakeTimeout: 4000 });
                } catch (e) {
                    return tryStage(stageIndex + 1);
                }

                let isSettled = false;

                // 4秒以内にサーバーから初期メッセージが届かない場合はタイムアウトして次のステージへ
                const timer = setTimeout(() => {
                    if (isSettled) return;
                    isSettled = true;
                    try { ws.terminate(); } catch (e) { }
                    tryStage(stageIndex + 1);
                }, 4000);

                const handleError = (err) => {
                    if (isSettled) return;
                    isSettled = true;
                    clearTimeout(timer);
                    try { ws.terminate(); } catch (e) { }
                    tryStage(stageIndex + 1);
                };

                ws.on('open', () => {
                });

                ws.on('message', (message) => {
                    let data = null;
                    try {
                        let processed = message;
                        if (Buffer.isBuffer(message) && message.length > 2 && message[0] === 0x1f && message[1] === 0x8b) {
                            processed = zlib.gunzipSync(message);
                        }
                        if (processed.length > 0 && (processed[0] === 0x7b || processed[0] === 0x5b)) {
                            data = JSON.parse(processed.toString());
                        } else {
                            data = msgpack.decode(processed);
                        }
                    } catch (e) {
                        /* ignore decode error */
                    }

                    if (!data) return;

                    // ★ Web版と同様: サーバーから有効な初期データを受信して初めて「接続成功」と判定
                    if (!isSettled) {
                        isSettled = true;
                        clearTimeout(timer);
                        if (gs) gs.remoteWs = ws;
                        resolve(ws);
                    }

                    // 停止シグナル等のメッセージ処理
                    if (data && data.t === 'stop') {
                        const reasonMap = {
                            'server_shutdown': 'reason_world_closed',
                            'world_closed': 'reason_world_closed',
                            'console_closed': 'reason_console_closed',
                            'password_mismatch': 'reason_password_mismatch',
                            'connection_lost': 'reason_connection_lost'
                        };
                        const reasonKey = reasonMap[data.type] || 'session_ended';
                        if (gs) gs._sessionEndedReason = t(gid, reasonKey);
                        if (gs && gs.voiceBridges) {
                            for (const vb of gs.voiceBridges.values()) {
                                if (vb.bridge) vb.bridge.disconnect().catch(() => { });
                            }
                        }
                    }
                });

                ws.on('close', (code, reason) => {
                    if (!isSettled) {
                        handleError(new Error(`Closed before initial data received (code=${code})`));
                    } else {
                        if (gs && gs.remoteWs === ws) {
                            gs.remoteWs = null;
                        }
                    }
                });

                ws.on('error', (err) => {
                    if (!isSettled) {
                        handleError(err);
                    } else {
                        console.warn(`[Discord Bot] remoteWs active error (${attemptType}):`, err.message);
                    }
                });
            };

            tryStage(0);
        });
    }

    function findActiveSession(guildId = null) {
        if (guildId) {
            const gs = guildSessions.get(guildId);
            if (gs && (gs.session || gs.hostSession)) {
                return gs.session || gs.hostSession;
            }
        }
        const first = sessions.values().next().value || pendingSessions.values().next().value;
        return first || null;
    }

    function findSession(roomId = null, guildId = null) {
        if (roomId) {
            for (const s of proxvc.sessions.values()) {
                if (s.roomId === roomId) return s;
            }
            for (const s of proxvc.pendingSessions.values()) {
                if (s.roomId === roomId) return s;
            }
        }
        return findActiveSession(guildId);
    }

    function getGuildSession(guildId) {
        return guildSessions.get(guildId) || null;
    }

    // --- セッション終了時のグローバル検知 ---
    if (Session && !Session.prototype._discordBotHooked) {
        Session.prototype._discordBotHooked = true;
        const originalDestroy = Session.prototype.destroy;
        Session.prototype.destroy = function (reason) {
            console.log(`\x1b[33m Session.prototype.destroy called: reason=${reason}, roomId=${this.roomId}, sessionId=${this.id}\x1b[0m`);
            const result = originalDestroy.apply(this, arguments);

            for (const [gid, gs] of guildSessions.entries()) {
                if (gs.roomId === this.roomId || gs.sessionId === this.id) {
                    if (!gs._stoppedByCommand) {
                        cleanupGuildVoiceBridges(gid).catch(console.error);
                        guildSessions.delete(gid);

                        if (gs.channelId) {
                            client.channels.fetch(gs.channelId).then(channel => {
                                if (channel) {
                                    const fields = [
                                        { name: t(gid, 'field_room'), value: gs.roomId || t(gid, 'reason_unknown'), inline: true }
                                    ];
                                    const embed = makeEmbed(gid,
                                        t(gid, 'session_ended'),
                                        `${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`,
                                        EMBED_COLOR_WARNING,
                                        fields
                                    );
                                    channel.send({ files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))], embeds: [embed] }).catch(e => console.error('[Discord] Failed to send session end embed:', e.message));
                                }
                            }).catch(e => console.error('[Discord] Failed to fetch channel for session end:', e.message));
                        }
                    }
                }
            }
            return result;
        };
    }

    async function cleanupGuildVoiceBridges(guildId) {
        const gs = guildSessions.get(guildId);
        if (!gs) return;

        for (const [userId, bridgeInfo] of gs.voiceBridges) {
            try {
                if (bridgeInfo.sendDcIconToMc) {
                    try { bridgeInfo.sendDcIconToMc('unconnected:dc', true); } catch (e) { /* ignore */ }
                }
                if (bridgeInfo.positionForwarder && gs.session && gs.session.positionUpdateCallbacks) {
                    gs.session.positionUpdateCallbacks.delete(bridgeInfo.positionForwarder);
                }
                if (bridgeInfo.iconChangeForwarder && gs.session && gs.session.iconChangeCallbacks) {
                    gs.session.iconChangeCallbacks.delete(bridgeInfo.iconChangeForwarder);
                }
                if (bridgeInfo.volumeChangeForwarder && gs.session && gs.session.volumeChangeCallbacks) {
                    gs.session.volumeChangeCallbacks.delete(bridgeInfo.volumeChangeForwarder);
                }
                if (bridgeInfo.posInterval) clearInterval(bridgeInfo.posInterval);
                if (bridgeInfo.debugMonitorInterval) clearInterval(bridgeInfo.debugMonitorInterval);
                if (bridgeInfo.clearIdleDebounceTimer) {
                    try { bridgeInfo.clearIdleDebounceTimer(); } catch (e) { /* ignore */ }
                }
                if (bridgeInfo.getCurrentOutEncoder) {
                    try { bridgeInfo.getCurrentOutEncoder()?.destroy(); } catch (e) { /* ignore */ }
                }
                if (bridgeInfo.bridge) await bridgeInfo.bridge.disconnect(true); // onDisconnectedを呼ばない
            } catch (e) { /* ignore */ }
        }
        gs.voiceBridges.clear();

        const connection = getVoiceConnection(guildId);
        if (connection) {
            try { connection.destroy(); } catch (e) { /* ignore */ }
        }
    }

    // --- スラッシュコマンド登録 ---
    async function registerCommands() {
        const commands = [
            new SlashCommandBuilder()
                .setName('help')
                .setDescription(DC_LOCALES.en.cmd_help_desc)
                .setDescriptionLocalizations({
                    ja: DC_LOCALES.ja.cmd_help_desc,
                    'zh-CN': DC_LOCALES.zh.cmd_help_desc,
                }),

            new SlashCommandBuilder()
                .setName('join')
                .setDescription(DC_LOCALES.en.cmd_join_desc)
                .setDescriptionLocalizations({
                    ja: DC_LOCALES.ja.cmd_join_desc,
                    'zh-CN': DC_LOCALES.zh.cmd_join_desc,
                })
                .addStringOption(opt => opt.setName('room_id').setDescription(DC_LOCALES.en.cmd_join_opt_room).setDescriptionLocalizations({
                    ja: DC_LOCALES.ja.cmd_join_opt_room,
                    'zh-CN': DC_LOCALES.zh.cmd_join_opt_room,
                }).setRequired(true))
                .addStringOption(opt => opt.setName('name').setDescription(DC_LOCALES.en.cmd_join_opt_name).setDescriptionLocalizations({
                    ja: DC_LOCALES.ja.cmd_join_opt_name,
                    'zh-CN': DC_LOCALES.zh.cmd_join_opt_name,
                }).setRequired(true)),

            new SlashCommandBuilder()
                .setName('leave')
                .setDescription(DC_LOCALES.en.cmd_leave_desc)
                .setDescriptionLocalizations({
                    ja: DC_LOCALES.ja.cmd_leave_desc,
                    'zh-CN': DC_LOCALES.zh.cmd_leave_desc,
                }),

            new SlashCommandBuilder()
                .setName('start')
                .setDescription(DC_LOCALES.en.cmd_start_desc)
                .setDescriptionLocalizations({
                    ja: DC_LOCALES.ja.cmd_start_desc,
                    'zh-CN': DC_LOCALES.zh.cmd_start_desc,
                })
                .addNumberOption(opt => opt.setName('distance').setDescription(DC_LOCALES.en.cmd_start_opt_distance).setDescriptionLocalizations({
                    ja: DC_LOCALES.ja.cmd_start_opt_distance,
                    'zh-CN': DC_LOCALES.zh.cmd_start_opt_distance,
                }).setRequired(false))
                .addStringOption(opt => opt.setName('room_id').setDescription(DC_LOCALES.en.cmd_start_opt_room).setDescriptionLocalizations({
                    ja: DC_LOCALES.ja.cmd_start_opt_room,
                    'zh-CN': DC_LOCALES.zh.cmd_start_opt_room,
                }).setRequired(false))
                .addAttachmentOption(opt => opt.setName('config').setDescription(DC_LOCALES.en.cmd_start_opt_config).setDescriptionLocalizations({
                    ja: DC_LOCALES.ja.cmd_start_opt_config,
                    'zh-CN': DC_LOCALES.zh.cmd_start_opt_config,
                }).setRequired(false)),

            new SlashCommandBuilder()
                .setName('stop')
                .setDescription(DC_LOCALES.en.cmd_stop_desc)
                .setDescriptionLocalizations({
                    ja: DC_LOCALES.ja.cmd_stop_desc,
                    'zh-CN': DC_LOCALES.zh.cmd_stop_desc,
                }),

            new SlashCommandBuilder()
                .setName('bot')
                .setDescription(DC_LOCALES.en.cmd_bot_desc)
                .setDescriptionLocalizations({
                    ja: DC_LOCALES.ja.cmd_bot_desc,
                    'zh-CN': DC_LOCALES.zh.cmd_bot_desc,
                })
                .addSubcommand(sub => sub
                    .setName('lang')
                    .setDescription(DC_LOCALES.en.cmd_bot_lang_desc)
                    .setDescriptionLocalizations({
                        ja: DC_LOCALES.ja.cmd_bot_lang_desc,
                        'zh-CN': DC_LOCALES.zh.cmd_bot_lang_desc,
                    })
                    .addStringOption(opt =>
                        opt.setName('language')
                            .setDescription(DC_LOCALES.en.cmd_lang_opt_lang)
                            .setDescriptionLocalizations({
                                ja: DC_LOCALES.ja.cmd_lang_opt_lang,
                                'zh-CN': DC_LOCALES.zh.cmd_lang_opt_lang,
                            })
                            .setRequired(true)
                            .addChoices(
                                { name: '日本語', value: 'ja' },
                                { name: 'English', value: 'en' },
                                { name: '简体中文', value: 'zh' },
                            )
                    )
                )
                .addSubcommandGroup(group => group
                    .setName('permission_start')
                    .setDescription(DC_LOCALES.en.cmd_bot_perm_start_desc)
                    .setDescriptionLocalizations({
                        ja: DC_LOCALES.ja.cmd_bot_perm_start_desc,
                        'zh-CN': DC_LOCALES.zh.cmd_bot_perm_start_desc,
                    })
                    .addSubcommand(sub => sub
                        .setName('add')
                        .setDescription(DC_LOCALES.en.cmd_bot_action_add)
                        .setDescriptionLocalizations({
                            ja: DC_LOCALES.ja.cmd_bot_action_add,
                            'zh-CN': DC_LOCALES.zh.cmd_bot_action_add,
                        })
                        .addRoleOption(opt => opt.setName('role')
                            .setDescription(DC_LOCALES.en.cmd_bot_opt_role)
                            .setDescriptionLocalizations({
                                ja: DC_LOCALES.ja.cmd_bot_opt_role,
                                'zh-CN': DC_LOCALES.zh.cmd_bot_opt_role,
                            }).setRequired(true)
                        )
                    )
                    .addSubcommand(sub => sub
                        .setName('remove')
                        .setDescription(DC_LOCALES.en.cmd_bot_action_remove)
                        .setDescriptionLocalizations({
                            ja: DC_LOCALES.ja.cmd_bot_action_remove,
                            'zh-CN': DC_LOCALES.zh.cmd_bot_action_remove,
                        })
                        .addRoleOption(opt => opt.setName('role')
                            .setDescription(DC_LOCALES.en.cmd_bot_opt_role)
                            .setDescriptionLocalizations({
                                ja: DC_LOCALES.ja.cmd_bot_opt_role,
                                'zh-CN': DC_LOCALES.zh.cmd_bot_opt_role,
                            }).setRequired(true)
                        )
                    )
                    .addSubcommand(sub => sub
                        .setName('reset')
                        .setDescription(DC_LOCALES.en.cmd_bot_action_reset)
                        .setDescriptionLocalizations({
                            ja: DC_LOCALES.ja.cmd_bot_action_reset,
                            'zh-CN': DC_LOCALES.zh.cmd_bot_action_reset,
                        })
                    )
                    .addSubcommand(sub => sub
                        .setName('list')
                        .setDescription(DC_LOCALES.en.cmd_bot_action_list)
                        .setDescriptionLocalizations({
                            ja: DC_LOCALES.ja.cmd_bot_action_list,
                            'zh-CN': DC_LOCALES.zh.cmd_bot_action_list,
                        })
                    )
                )
                .addSubcommandGroup(group => group
                    .setName('permission_admin')
                    .setDescription(DC_LOCALES.en.cmd_bot_perm_admin_desc)
                    .setDescriptionLocalizations({
                        ja: DC_LOCALES.ja.cmd_bot_perm_admin_desc,
                        'zh-CN': DC_LOCALES.zh.cmd_bot_perm_admin_desc,
                    })
                    .addSubcommand(sub => sub
                        .setName('add')
                        .setDescription(DC_LOCALES.en.cmd_bot_action_add)
                        .setDescriptionLocalizations({
                            ja: DC_LOCALES.ja.cmd_bot_action_add,
                            'zh-CN': DC_LOCALES.zh.cmd_bot_action_add,
                        })
                        .addRoleOption(opt => opt.setName('role')
                            .setDescription(DC_LOCALES.en.cmd_bot_opt_role)
                            .setDescriptionLocalizations({
                                ja: DC_LOCALES.ja.cmd_bot_opt_role,
                                'zh-CN': DC_LOCALES.zh.cmd_bot_opt_role,
                            }).setRequired(true)
                        )
                    )
                    .addSubcommand(sub => sub
                        .setName('remove')
                        .setDescription(DC_LOCALES.en.cmd_bot_action_remove)
                        .setDescriptionLocalizations({
                            ja: DC_LOCALES.ja.cmd_bot_action_remove,
                            'zh-CN': DC_LOCALES.zh.cmd_bot_action_remove,
                        })
                        .addRoleOption(opt => opt.setName('role')
                            .setDescription(DC_LOCALES.en.cmd_bot_opt_role)
                            .setDescriptionLocalizations({
                                ja: DC_LOCALES.ja.cmd_bot_opt_role,
                                'zh-CN': DC_LOCALES.zh.cmd_bot_opt_role,
                            }).setRequired(true)
                        )
                    )
                    .addSubcommand(sub => sub
                        .setName('reset')
                        .setDescription(DC_LOCALES.en.cmd_bot_action_reset)
                        .setDescriptionLocalizations({
                            ja: DC_LOCALES.ja.cmd_bot_action_reset,
                            'zh-CN': DC_LOCALES.zh.cmd_bot_action_reset,
                        })
                    )
                    .addSubcommand(sub => sub
                        .setName('list')
                        .setDescription(DC_LOCALES.en.cmd_bot_action_list)
                        .setDescriptionLocalizations({
                            ja: DC_LOCALES.ja.cmd_bot_action_list,
                            'zh-CN': DC_LOCALES.zh.cmd_bot_action_list,
                        })
                    )
                ),

            new SlashCommandBuilder()
                .setName('config')
                .setDescription(DC_LOCALES.en.cmd_config_desc)
                .setDescriptionLocalizations({
                    ja: DC_LOCALES.ja.cmd_config_desc,
                    'zh-CN': DC_LOCALES.zh.cmd_config_desc,
                }),

            new SlashCommandBuilder()
                .setName('status')
                .setDescription(DC_LOCALES.en.cmd_status_desc)
                .setDescriptionLocalizations({
                    ja: DC_LOCALES.ja.cmd_status_desc,
                    'zh-CN': DC_LOCALES.zh.cmd_status_desc,
                })
                .addStringOption(opt => opt.setName('room_id').setDescription(DC_LOCALES.en.cmd_status_opt_room).setDescriptionLocalizations({
                    ja: DC_LOCALES.ja.cmd_status_opt_room,
                    'zh-CN': DC_LOCALES.zh.cmd_status_opt_room,
                }).setRequired(false)),
        ];

        const rest = new REST({ version: '10' }).setToken(token);
        try {
            await rest.put(Routes.applicationCommands(client.user.id), {
                body: commands.map(c => c.toJSON()),
            });
            //console.log('\x1b[35m[Discord]\x1b[0m Registered slash commands successfully');
        } catch (e) {
            console.error('[Discord] Command registration error:', e.message);
        }
    }

    // --- コマンドハンドラ ---

    async function handleHelp(interaction) {
        const gid = interaction.guildId;
        const settings = getGuildSettings(gid);

        let helpAdminTitle = t(gid, 'help_admin');
        const adminRoles = settings.perm_admin;
        if (Array.isArray(adminRoles) && adminRoles.length > 0) {
            const rolesText = adminRoles.map(id => `<@&${id}>`).join(', ');
            helpAdminTitle = t(gid, 'help_admin_role', { roles: rolesText });
        }

        let startCmdStr = t(gid, 'help_cmd_start_plain');
        const startRoles = settings.perm_start;
        if (Array.isArray(startRoles) && startRoles.length > 0) {
            const rolesText = startRoles.map(id => `<@&${id}>`).join(', ');
            startCmdStr = t(gid, 'help_cmd_start_role', { roles: rolesText });
        }

        const helpGeneralList = t(gid, 'help_general_list', { start_cmd: startCmdStr });

        const embed = makeEmbed(gid, t(gid, 'help_title'), t(gid, 'help_desc'))
            .addFields(
                { name: t(gid, 'help_general'), value: helpGeneralList },
                { name: helpAdminTitle, value: t(gid, 'help_admin_list') },
            );
        await interaction.reply({ files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))], embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    async function handleStart(interaction) {
        const gid = interaction.guildId;

        if (!canStart(interaction)) {
            await interaction.reply({
                files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))],
                embeds: [makeEmbed(gid, '', t(gid, 'no_permission'), EMBED_COLOR_ERROR)],
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const existingGs = guildSessions.get(gid);

        // ★ 修正: Discordから/startで作成されたホストセッションが既に稼働中の場合のみ start_already を返す
        if (existingGs && existingGs._isHostSession) {
            await interaction.reply({
                files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))],
                embeds: [makeEmbed(gid, '', t(gid, 'start_already'), EMBED_COLOR_ERROR)],
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        await interaction.deferReply();

        try {
            const configAttachment = interaction.options.getAttachment('config');
            let customConfig = null;
            let configWarningMessage = null;

            if (configAttachment) {
                try {
                    const res = await fetch(configAttachment.url);
                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                    const text = await res.text();

                    let parsed = null;
                    try {
                        parsed = JSON5.parse(text);
                    } catch (_) {
                        parsed = JSON.parse(text);
                    }

                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                        throw new Error('Not an object');
                    }

                    const validKeys = [
                        'app_id', 'secret_key', 'username', 'sub_domain', 'sub_domain2', 'ssh_password',
                        'port', 'web_port', 'proximity', 'spectator', 'specListen', 'specDim',
                        'verify', 'password', 'output', 'distance', 'lang'
                    ];
                    const parsedKeys = Object.keys(parsed);
                    const matchedKeys = parsedKeys.filter(k => validKeys.includes(k));
                    const invalidMarkers = ['dependencies', 'devDependencies', 'compilerOptions', 'scripts'];
                    const hasInvalidMarkers = parsedKeys.some(k => invalidMarkers.includes(k));

                    if (matchedKeys.length === 0 || hasInvalidMarkers) {
                        throw new Error('Schema mismatch');
                    }

                    customConfig = parsed;
                } catch (err) {
                    console.warn(`[Discord] Uploaded file (${configAttachment.name}) is not a valid config.json:`, err.message);
                    configWarningMessage = t(gid, 'start_config_invalid', { filename: configAttachment.name });
                }
            }

            let startLang = getDiscordLocaleMatch(interaction.locale);
            if (!startLang) {
                const settings = getGuildSettings(gid);
                startLang = settings.lang || getDiscordLocaleMatch(interaction.guildLocale);
            }
            if (!startLang || !['ja', 'en', 'zh'].includes(startLang)) {
                startLang = 'en';
            }

            const configOverride = {
                app_id: "",
                secret_key: "",
                username: "",
                sub_domain: "",
                ssh_password: "",
                proximity: true,
                spectator: true,
                specListen: true,
                specDim: false,
                verify: false,
                password: false,
                output: true,
                distance: 10,
                lang: startLang,
            };

            if (customConfig) {
                if (typeof customConfig.app_id === 'string') configOverride.app_id = customConfig.app_id;
                if (typeof customConfig.secret_key === 'string') configOverride.secret_key = customConfig.secret_key;
                if (typeof customConfig.username === 'string') configOverride.username = customConfig.username;
                if (typeof customConfig.sub_domain === 'string') configOverride.sub_domain = customConfig.sub_domain;
                if (typeof customConfig.sub_domain2 === 'string') configOverride.sub_domain2 = customConfig.sub_domain2;
                if (typeof customConfig.ssh_password === 'string') configOverride.ssh_password = customConfig.ssh_password;
                if (typeof customConfig.port === 'number') configOverride.port = customConfig.port;
                if (typeof customConfig.web_port === 'number') configOverride.web_port = customConfig.web_port;
                if (typeof customConfig.proximity === 'boolean') configOverride.proximity = customConfig.proximity;
                if (typeof customConfig.spectator === 'boolean') configOverride.spectator = customConfig.spectator;
                if (typeof customConfig.specListen === 'boolean') configOverride.specListen = customConfig.specListen;
                if (typeof customConfig.specDim === 'boolean') configOverride.specDim = customConfig.specDim;
                if (typeof customConfig.verify === 'boolean') {
                    configOverride.verify = customConfig.verify;
                    configOverride.password = customConfig.verify;
                } else if (typeof customConfig.password === 'boolean') {
                    configOverride.password = customConfig.password;
                    configOverride.verify = customConfig.password;
                }
                if (typeof customConfig.output === 'boolean') configOverride.output = customConfig.output;
                if (typeof customConfig.distance === 'number' && !isNaN(customConfig.distance) && customConfig.distance >= 0) {
                    configOverride.distance = customConfig.distance;
                }
                if (typeof customConfig.lang === 'string' && ['ja', 'en', 'zh'].includes(customConfig.lang)) {
                    configOverride.lang = customConfig.lang;
                }
            }

            const optDistance = interaction.options.getNumber('distance');
            if (optDistance !== null && optDistance !== undefined) {
                configOverride.distance = optDistance;
            }
            const roomId = interaction.options.getString('room_id') || '';
            if (roomId) {
                configOverride.sub_domain = roomId;
            }

            // ダウンロード用 config.json の sub_domain 決定 (優先順: 1. room_id 2. アップロードされたconfigのsub_domain 3. 空文字)
            let originalSubDomain = "";
            if (roomId) {
                originalSubDomain = roomId;
            } else if (customConfig && typeof customConfig.sub_domain === 'string') {
                originalSubDomain = customConfig.sub_domain;
            } else {
                originalSubDomain = "";
            }

            const session = new Session(null, configOverride);
            session._originalSubDomain = originalSubDomain;
            await session.startWebSession();
            pendingSessions.set(session.id, session);
            session.startTimer();

            // ★ 修正: 既に /join 等による guildSession (existingGs) が存在する場合は既存データを維持しつつ更新
            if (existingGs) {
                existingGs.session = session;
                existingGs.hostSession = session; // 追加: ホストセッションを明示的に保持
                existingGs.sessionId = session.id;
                existingGs.roomId = session.roomId;
                existingGs.originalSubDomain = originalSubDomain;
                existingGs.channelId = interaction.channelId;
                existingGs._stoppedByCommand = false;
                existingGs._isHostSession = true;
                existingGs.hostId = interaction.user.id;
            } else {
                guildSessions.set(gid, {
                    session,
                    hostSession: session, // 追加: ホストセッションを明示的に保持
                    sessionId: session.id,
                    roomId: session.roomId,
                    originalSubDomain,
                    channelId: interaction.channelId,
                    voiceBridges: new Map(),
                    _stoppedByCommand: false,
                    _isHostSession: true,
                    hostId: interaction.user.id,
                });
            }

            let description = '';
            let embedColor = EMBED_COLOR_SUCCESS;

            if (configWarningMessage) {
                description = configWarningMessage;
                embedColor = EMBED_COLOR_WARNING;
            } else if (customConfig) {
                description = t(gid, 'start_config_loaded', { filename: configAttachment.name });
            }

            const embed = makeEmbed(gid, t(gid, 'start_success'), description, embedColor)
                .addFields(
                    { name: t(gid, 'status_room'), value: session.roomId || 'N/A', inline: true },
                    { name: t(gid, 'status_distance'), value: `${session.config.distance ?? configOverride.distance}`, inline: true },
                );

            if (session.connectCommand) {
                embed.addFields({ name: 'Minecraft', value: `\`${session.connectCommand}\`` });
            }
            if (session.roomId) {
                embed.addFields({ name: 'VC URL', value: `https://mcproxvc.ovh/connect/?roomid=${session.roomId}` });
            }

            await interaction.editReply({ files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))], embeds: [embed] });
        } catch (e) {
            console.error('[Discord] Start error:', e);
            await interaction.editReply({
                files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))], embeds: [makeEmbed(gid, t(gid, 'start_fail'), e.message || '', EMBED_COLOR_ERROR)]
            });
        }
    }

    async function handleStop(interaction) {
        const gid = interaction.guildId;
        const gs = guildSessions.get(gid);

        // 1. 管理権限チェック
        if (!canAdmin(interaction, true, gs)) {
            await interaction.reply({
                files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))],
                embeds: [makeEmbed(gid, '', t(gid, 'no_permission'), EMBED_COLOR_ERROR)],
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // 2. ギルドセッションが存在しない場合
        if (!gs) {
            await interaction.reply({
                files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))],
                embeds: [makeEmbed(gid, '', t(gid, 'stop_not_running'), EMBED_COLOR_ERROR)],
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // 3. Discordから/startで作成されたホストセッションでない場合
        if (!gs._isHostSession || !gs.hostSession) {
            await interaction.reply({
                files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))],
                embeds: [makeEmbed(gid, '', t(gid, 'config_not_host'), EMBED_COLOR_ERROR)],
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const hostSessionToStop = gs.hostSession;
        const stoppedRoomId = hostSessionToStop.roomId || t(gid, 'reason_unknown');

        // ★★★ 追加: ホストセッション停止時に、リモート/直結しているクライアントに向けて 'stop' 信号を送信する ★★★
        if (hostSessionToStop) {
            const shutdownMsg = msgpack.encode({ t: 'stop', type: 'world_closed' });

            // Direct VC クライアントへ通知
            hostSessionToStop.directVcClients.forEach(ws => {
                if (ws.readyState === WebSocket.OPEN) ws.send(shutdownMsg);
            });
            // リレーサーバー経由で接続しているクライアントへ通知
            if (hostSessionToStop.relayWs && hostSessionToStop.relayWs.readyState === WebSocket.OPEN) {
                hostSessionToStop.relayWs.send(shutdownMsg);
            }
        }

        // 4. 正当なホストセッションの停止処理
        gs._stoppedByCommand = true;

        // Botが現在VC接続しているセッションが、停止しようとしているホストセッションと同じか判定
        const isConnectedToHostSession = (gs.session === hostSessionToStop);

        // 同じセッションにVC接続している場合のみ切断処理を行う
        if (isConnectedToHostSession) {
            await cleanupGuildVoiceBridges(gid);
        }

        // /start で起動したセッションを破棄
        if (hostSessionToStop) {
            hostSessionToStop.destroy('stopped by discord');
        }

        // /join による別セッションへの接続が存在する場合は、情報とVCを維持する
        if (gs.session && !isConnectedToHostSession) {
            gs._isHostSession = false;
            gs.hostId = null;
            gs.hostSession = null;
            gs._stoppedByCommand = false;
        } else {
            guildSessions.delete(gid);
        }

        const fields = [
            { name: t(gid, 'field_room'), value: stoppedRoomId, inline: true }
        ];
        await interaction.reply({
            files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))],
            embeds: [makeEmbed(gid, t(gid, 'stop_success'), null, EMBED_COLOR_SUCCESS, fields)]
        });
    }

    async function handleLeave(interaction) {
        const gid = interaction.guildId;
        const gs = guildSessions.get(gid);
        const userId = interaction.member.id;

        // --- 近接VCに参加していない場合はエラーを表示 ---
        if (!gs || !gs.voiceBridges || !gs.voiceBridges.has(userId)) {
            await interaction.reply({
                files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))],
                embeds: [makeEmbed(gid, null, t(gid, 'err_leave_not_connected'), EMBED_COLOR_ERROR)],
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        let roomId = gs.roomId || t(gid, 'reason_unknown');
        let userName = interaction.member.nickname || interaction.member.user.username;

        const bridgeInfo = gs.voiceBridges.get(userId);
        if (bridgeInfo && bridgeInfo.userName) {
            userName = bridgeInfo.userName;
        }

        if (bridgeInfo) {
            bridgeInfo.isLeaving = true;
            if (bridgeInfo.bridge) {
                bridgeInfo.bridge.onDisconnected = null;
            }
        }

        // 個別切断用のクリーンアップ処理
        try {
            if (bridgeInfo.sendDcIconToMc) {
                try { bridgeInfo.sendDcIconToMc('unconnected:dc', true); } catch (e) { /* ignore */ }
            }
            if (gs.session) {
                if (bridgeInfo.positionForwarder && gs.session.positionUpdateCallbacks) {
                    gs.session.positionUpdateCallbacks.delete(bridgeInfo.positionForwarder);
                }
                if (bridgeInfo.iconChangeForwarder && gs.session.iconChangeCallbacks) {
                    gs.session.iconChangeCallbacks.delete(bridgeInfo.iconChangeForwarder);
                }
                if (bridgeInfo.volumeChangeForwarder && gs.session.volumeChangeCallbacks) {
                    gs.session.volumeChangeCallbacks.delete(bridgeInfo.volumeChangeForwarder);
                }
                if (bridgeInfo.syncIconForwarder && gs.session.requestDcIconSyncCallbacks) {
                    gs.session.requestDcIconSyncCallbacks.delete(bridgeInfo.syncIconForwarder);
                }
            }
            if (bridgeInfo.posInterval) clearInterval(bridgeInfo.posInterval);
            if (bridgeInfo.debugMonitorInterval) clearInterval(bridgeInfo.debugMonitorInterval);
            if (bridgeInfo.clearIdleDebounceTimer) {
                try { bridgeInfo.clearIdleDebounceTimer(); } catch (e) { /* ignore */ }
            }
            if (bridgeInfo.getCurrentOutEncoder) {
                try { bridgeInfo.getCurrentOutEncoder()?.destroy(); } catch (e) { /* ignore */ }
            }
            if (bridgeInfo.bridge) await bridgeInfo.bridge.disconnect(true); // onDisconnectedを呼ばない（leaveコマンド自身がクリーンアップ済み）
            if (bridgeInfo.connection) {
                try { bridgeInfo.connection.destroy(); } catch (e) { /* ignore */ }
            }
        } catch (e) {
            console.error('[Discord] Leave cleanup error:', e);
        }

        gs.voiceBridges.delete(userId);
        if (gs.skywayUsers) gs.skywayUsers.delete(userName);

        if (gs.voiceBridges.size === 0 && !gs.session) {
            guildSessions.delete(gid);
        }

        const fields = [
            { name: t(gid, 'field_room'), value: roomId, inline: true },
            { name: t(gid, 'field_name'), value: userName.replace(/_/g, ' '), inline: true }
        ];
        await interaction.reply({ files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))], embeds: [makeEmbed(gid, t(gid, 'leave_success'), null, EMBED_COLOR_SUCCESS, fields)] });
    }

    async function handleJoin(interaction) {
        const gid = interaction.guildId;
        const member = interaction.member;

        if (!member.voice.channel) {
            await interaction.reply({ files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))], embeds: [makeEmbed(gid, '', t(gid, 'join_not_in_vc'), EMBED_COLOR_ERROR)], flags: MessageFlags.Ephemeral });
            return;
        }

        const voiceChannel = member.voice.channel;
        const botMember = interaction.guild.members.me || await interaction.guild.members.fetch(interaction.client.user.id).catch(() => null);
        if (botMember) {
            const permissions = voiceChannel.permissionsFor(botMember);
            // チャンネルを見る権限、接続する権限、発言する権限のいずれかが欠けている場合
            if (!permissions || !permissions.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) {
                await interaction.reply({
                    files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))],
                    embeds: [makeEmbed(gid, '', t(gid, 'join_failed_err_vc'), EMBED_COLOR_ERROR)],
                    flags: MessageFlags.Ephemeral
                });
                return;
            }
        }

        const roomId = interaction.options.getString('room_id');
        let userName = interaction.options.getString('name');

        if (userName) {
            userName = userName.replace(/ /g, '_');
        }

        if (!/^[a-zA-Z0-9_ ]+$/.test(userName)) {
            await interaction.reply({ files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))], embeds: [makeEmbed(gid, null, t(gid, 'err_name'), EMBED_COLOR_ERROR)], flags: MessageFlags.Ephemeral });
            return;
        }

        // セッションを検索
        let targetSession = findSession(roomId, gid);

        // ★ パスワードが必要な設定になっているかチェック
        if (targetSession && targetSession.config && (targetSession.config.password || targetSession.config.verify)) {
            // Modalに渡すため、CustomIDに roomId と userName を埋め込む
            const customId = `jpwd_${roomId}_###_${userName}`;
            if (customId.length > 100) {
                await interaction.reply({
                    files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))],
                    embeds: [makeEmbed(gid, null, t(gid, 'err_customid_length'), EMBED_COLOR_ERROR)],
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            // モーダル（入力パネル）の作成
            const modal = new ModalBuilder()
                .setCustomId(customId)
                .setTitle(t(gid, 'pwd_modal_title'));

            const pwdInput = new TextInputBuilder()
                .setCustomId('password_value')
                .setLabel(t(gid, 'pwd_modal_label'))
                .setStyle(TextInputStyle.Short)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(pwdInput));

            // 入力パネルを表示してこの関数の処理は終了（ModalSubmitイベントへ続く）
            await interaction.showModal(modal);
            return;
        }

        // ★ パスワード不要な場合はそのまま接続処理（新しい関数）へ
        await processJoinLogic(interaction, roomId, userName);
    }

    async function handleJoinPasswordModal(interaction) {
        const gid = interaction.guildId;

        // CustomIDから roomId と userName を復元
        const parts = interaction.customId.split('_###_');
        if (parts.length !== 2) return;

        const roomId = parts[0].replace('jpwd_', '');
        const userName = parts[1];

        // ユーザーが入力したパスコードを取得
        const inputPassword = interaction.fields.getTextInputValue('password_value');

        // セッションの再検索
        let targetSession = findSession(roomId, gid);

        if (!targetSession) {
            await interaction.reply({
                files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))],
                embeds: [makeEmbed(gid, null, t(gid, 'err_room_not_found'), EMBED_COLOR_ERROR)],
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // パスコードの照合
        const passwordsFromServer = targetSession.passwords || targetSession.pssws || {};
        if (passwordsFromServer[userName] !== inputPassword) {
            await interaction.reply({
                files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))],
                embeds: [makeEmbed(gid, null, t(gid, 'err_passcode_incorrect'), EMBED_COLOR_ERROR)],
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // 照合成功時はそのまま接続処理へ
        await processJoinLogic(interaction, roomId, userName);
    }

    // 実際にVC接続を開始する内部関数
    async function processJoinLogic(interaction, roomId, userName) {
        const gid = interaction.guildId;
        const member = interaction.member;

        let gs = guildSessions.get(gid);
        if (!gs) {
            gs = {
                session: null,
                sessionId: null,
                roomId: roomId,
                channelId: interaction.channelId,
                voiceBridges: new Map(),
                _stoppedByCommand: false,
                _isHost: false,
            };
            guildSessions.set(gid, gs);
        }

        let foundSession = findSession(roomId, gid);
        if (foundSession) {
            gs.session = foundSession;
            if (foundSession.roomId) gs.roomId = foundSession.roomId;
        } else if (roomId) {
            gs.roomId = roomId;
        }
        gs.channelId = interaction.channelId;

        if (gs.voiceBridges.has(member.id)) {
            await interaction.reply({ files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))], embeds: [makeEmbed(gid, null, t(gid, 'join_already'), EMBED_COLOR_ERROR)], flags: MessageFlags.Ephemeral });
            return;
        }

        if (!/^[a-zA-Z0-9_ ]+$/.test(userName)) {
            await interaction.reply({ files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))], embeds: [makeEmbed(gid, null, t(gid, 'err_name'), EMBED_COLOR_ERROR)], flags: MessageFlags.Ephemeral });
            return;
        }

        userName = userName.replace(/ /g, '_');

        if (gs && gs.skywayUsers && gs.skywayUsers.has(userName)) {
            await interaction.reply({ files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))], embeds: [makeEmbed(gid, null, t(gid, 'err_name_used'), EMBED_COLOR_ERROR)], flags: MessageFlags.Ephemeral });
            return;
        }

        // ==================== 認証フロー ====================
        const userId = member.id;

        if (!authMod || isInAuthCooldown(userId)) {
            await interaction.reply({ files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))], embeds: [makeEmbed(gid, null, t(gid, 'join_connecting'), EMBED_COLOR)] }).catch((e) => {
                console.warn('[Discord] Interaction reply timed out or failed (proceeding with VC join):', e.message);
            });
        } else {
            const { pendingTokens, generateToken, AUTH_CONFIG } = authMod;
            const authToken = generateToken();
            const tokenExpireMs = AUTH_CONFIG?.TOKEN_EXPIRE_MS || 5 * 60 * 1000;
            const expiresAt = Date.now() + tokenExpireMs;

            pendingTokens.set(authToken, {
                userId,
                guildId: gid,
                channelId: member.voice.channel.id,
                textChannelId: interaction.channelId,
                roomId,
                userName,
                voiceChannelId: member.voice.channel.id,
                expiresAt,
                _botContext: { gid, member, roomId, userName, interaction },
                interaction,
                botIndex: botIndex,
                botId: client.user ? client.user.id : null
            });

            const authUrl = `${AUTH_BASE_URL}/auth/?token=${authToken}&region=${AUTH_REGION}`;
            const expiresMin = Math.ceil(tokenExpireMs / 60000);

            const authEmbed = makeEmbed(gid,
                t(gid, 'auth_required_title'),
                t(gid, 'auth_required_desc', { minutes: expiresMin }),
                EMBED_COLOR_WARNING,
                [
                    { name: t(gid, 'field_room'), value: `\`${roomId}\``, inline: true },
                    { name: t(gid, 'field_name'), value: userName.replace(/_/g, ' '), inline: true }
                ]
            );

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setLabel(t(gid, 'auth_button'))
                    .setURL(authUrl)
                    .setStyle(ButtonStyle.Link)
                    .setEmoji('🎙️')
            );

            // fetchReply: true を指定して送信済みメッセージの参照を取得する
            const replyMsg = await interaction.reply({
                files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))],
                embeds: [authEmbed],
                components: [row],
                flags: MessageFlags.Ephemeral,
                withResponse: true
            });

            // --- 5分経過（有効期限切れ）後の失敗通知処理 ---
            setTimeout(async () => {
                // トークンがまだ存在している（＝期限内に認証が完了しなかった）場合のみ編集
                if (pendingTokens.has(authToken)) {
                    pendingTokens.delete(authToken);

                    const failedEmbed = makeEmbed(gid,
                        t(gid, 'auth_complete_not_in_vc_title') || '認証に失敗しました',
                        null,
                        EMBED_COLOR_ERROR,
                        [
                            { name: t(gid, 'field_room'), value: `\`${roomId}\``, inline: true },
                            { name: t(gid, 'field_name'), value: userName.replace(/_/g, ' '), inline: true }
                        ]
                    );

                    try {
                        // ボタンを無効化してEmbedを書き換える
                        await interaction.editReply({
                            embeds: [failedEmbed],
                            components: []
                        });
                    } catch (e) {
                        /* ユーザーがメッセージを閉じるなどして編集できない場合は無視 */
                    }
                }
            }, tokenExpireMs);

            return;
        }

        if (gs && gs.session) {
            const isRoomValid = await verifyRoomExists(roomId);
            if (!isRoomValid) {
                await interaction.editReply({ files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))], embeds: [makeEmbed(gid, null, t(gid, 'err_room_not_found'), EMBED_COLOR_ERROR)] });
                if (gs && gs.voiceBridges && gs.voiceBridges.size === 0) {
                    guildSessions.delete(gid);
                }
                return;
            }
        }

        let connection;
        let bridge;
        try {
            const VoiceBridge = require('./voice_bridge');

            bridge = new VoiceBridge({
                roomId: roomId,
                userName: userName,
                appId: gs.session?.config?.app_id || INITIAL_CONFIG.app_id,
                secretKey: gs.session?.config?.secret_key || INITIAL_CONFIG.secret_key,
            });

            // ★ 問題2修正: bridge.connect()より前にonDisconnectedを設定しておく
            //   (connect()中に切断が発生した場合でも正しく処理できるよう)
            let _disconnectHandled = false; // 二重発火防止フラグ
            let dcIconState = null;
            let speakingTimer = null;
            const SPEAKING_COOLDOWN_MS = 250;

            bridge.onMemberJoined = (msg) => {
                if (gs && gs.skywayUsers) gs.skywayUsers.add(msg.name);
            };
            bridge.onMemberLeft = (msg) => {
                if (gs && gs.skywayUsers) gs.skywayUsers.delete(msg.name);
            };

            bridge.onData = async (data) => {
                if (data && data.t === 'stop') {
                    console.log(`\x1b[33m[Discord Bot] bridge.onData received stop signal: type=${data.type}, room=${roomId}\x1b[0m`);
                    const reasonMap = {
                        'server_shutdown': 'reason_world_closed',
                        'world_closed': 'reason_world_closed',
                        'console_closed': 'reason_console_closed',
                        'password_mismatch': 'reason_password_mismatch',
                        'connection_lost': 'reason_connection_lost'
                    };
                    const reasonKey = reasonMap[data.type] || 'session_ended';
                    if (gs) gs._sessionEndedReason = t(gid, reasonKey);
                    try { await bridge.disconnect(); } catch (e) { }
                }
            };

            // onDisconnected内で参照するため先行宣言
            let positionForwarder = null;
            let iconChangeForwarder = null;
            let volumeChangeForwarder = null;
            let syncIconForwarder = null;

            bridge.onDisconnected = async () => {
                if (_disconnectHandled) return; // 二重発火防止
                _disconnectHandled = true;

                const currentBridgeInfo = gs ? gs.voiceBridges.get(member.id) : null;
                if (currentBridgeInfo && currentBridgeInfo.isLeaving) return;

                console.log(`\x1b[33m[Discord Bot] bridge.onDisconnected called for user: ${userName} (reason: ${gs?._sessionEndedReason || 'none'}, bridges: ${gs?.voiceBridges?.size})\x1b[0m`);
                dcIconState = 'dc_disconnected';
                if (speakingTimer) { clearTimeout(speakingTimer); speakingTimer = null; }

                // データ用WebSocketのクリーンアップ
                if (gs && gs.remoteWs) {
                    try { gs.remoteWs.close(); } catch (e) { }
                    gs.remoteWs = null;
                }

                if (positionForwarder && gs.session && gs.session.positionUpdateCallbacks) {
                    gs.session.positionUpdateCallbacks.delete(positionForwarder);
                }
                const bridgeInfo = gs ? gs.voiceBridges.get(member.id) : null;
                if (bridgeInfo) {
                    if (bridgeInfo.iconChangeForwarder && gs.session && gs.session.iconChangeCallbacks) {
                        gs.session.iconChangeCallbacks.delete(bridgeInfo.iconChangeForwarder);
                    }
                    if (bridgeInfo.volumeChangeForwarder && gs.session && gs.session.volumeChangeCallbacks) {
                        gs.session.volumeChangeCallbacks.delete(bridgeInfo.volumeChangeForwarder);
                    }
                    if (bridgeInfo.syncIconForwarder && gs.session && gs.session.requestDcIconSyncCallbacks) {
                        gs.session.requestDcIconSyncCallbacks.delete(bridgeInfo.syncIconForwarder);
                    }
                }

                if ((bridgeInfo && bridgeInfo.isLeaving) || (gs && gs._stoppedByCommand)) return;

                gs.voiceBridges.delete(member.id);
                if (gs && gs.skywayUsers) gs.skywayUsers.delete(userName);

                // 最後のユーザーが切断された場合
                if (gs && gs.voiceBridges.size === 0) {
                    try { if (connection) connection.destroy(); } catch (e) { /* ignore */ }

                    const isExplicitSessionEnd = !!(gs._sessionEndedReason || (gs.session && gs.session._destroying));
                    const rId = gs.roomId || t(gid, 'reason_unknown');
                    const targetChannelId = gs.channelId || interaction.channelId;

                    if (isExplicitSessionEnd) {
                        const endReasonTitle = gs._sessionEndedReason || t(gid, 'session_ended');
                        guildSessions.delete(gid);

                        try {
                            const channel = await client.channels.fetch(targetChannelId);
                            if (channel) {
                                const fields = [{ name: t(gid, 'field_room'), value: rId, inline: true }];
                                await channel.send({
                                    files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))],
                                    embeds: [makeEmbed(gid, endReasonTitle, `${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`, EMBED_COLOR_WARNING, fields)]
                                });
                            }
                        } catch (e) { /* ignore */ }
                    } else {
                        // セッション終了理由が無い通常の退出の場合（単にユーザーが全員抜けた）
                        if (!gs.session) {
                            guildSessions.delete(gid);
                        }
                        try {
                            const channel = await client.channels.fetch(interaction.channelId);
                            if (channel) {
                                const fields = [
                                    { name: t(gid, 'field_room'), value: rId, inline: true },
                                    { name: t(gid, 'field_name'), value: userName.replace(/_/g, ' '), inline: true }
                                ];
                                await channel.send({
                                    files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))],
                                    embeds: [makeEmbed(gid, t(gid, 'join_disconnected'), null, EMBED_COLOR_WARNING, fields)]
                                });
                            }
                        } catch (e) { /* ignore */ }
                    }
                    return;
                }

                // まだ他のユーザーが同じVCに残っている場合の個別切断通知
                try {
                    const channel = await client.channels.fetch(interaction.channelId);
                    if (channel) {
                        const rId = gs ? gs.roomId || t(gid, 'reason_unknown') : t(gid, 'reason_unknown');
                        const fields = [
                            { name: t(gid, 'field_room'), value: rId, inline: true },
                            { name: t(gid, 'field_name'), value: userName.replace(/_/g, ' '), inline: true }
                        ];
                        await channel.send({
                            files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))],
                            embeds: [makeEmbed(gid, t(gid, 'join_disconnected'), null, EMBED_COLOR_WARNING, fields)]
                        });
                    }
                } catch (e) { /* ignore */ }
            };

            connection = joinVoiceChannel({
                channelId: member.voice.channel.id,
                guildId: gid,
                adapterCreator: interaction.guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: false,
            });

            connection.on('stateChange', (oldState, newState) => {
                //console.log(`\x1b[35m[Discord]\x1b[0m Voice connection: ${oldState.status} \u2192 ${newState.status}`);
            });

            connection.on('debug', (message) => {
                //console.log(`\x1b[35m[Discord Voice Debug]\x1b[0m ${message}`);
            });

            connection.on('error', (error) => {
                console.error('[Discord] Voice connection error:', error.message);
                // ネットワークエラー(ENOTFOUND等)によるプロセス落ちは防止し、安全に切断する
                try {
                    connection.destroy();
                } catch (e) { /* ignore */ }
            });

            // 15秒以内に Ready 状態にならなかった（権限不足やネットワークエラー等）場合は例外をスロー
            try {
                await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
                //console.log('\x1b[35m[Discord]\x1b[0m Voice connection successfully reached Ready state!');
            } catch (e) {
                console.error('\x1b[31m[Discord]\x1b[0m Failed to reach Ready state within timeout:', e.message);
                throw new Error('VC_JOIN_FAILED');
            }

            // 既存のコード
            if (!gs.skywayUsers) gs.skywayUsers = new Set();

            // ★★★ リモートセッション（ローカルにセッションがない場合）のみデータWebSocketに接続 (3段階リトライ付き) ★★★
            if (!gs.session) {
                await connectRemoteWsWithRetry(roomId, gs, gid);
            }
            // ★★★ ここまで ★★★

            await bridge.connect();

            if (gs && gs.skywayUsers) gs.skywayUsers.add(userName);

            const discordInMetrics = {
                packets: 0,
                bytes: 0,
                lastPktTime: 0,
                latencySpikes: 0,
                maxGapMs: 0,
            };

            const receiver = connection.receiver;

            const opusStream = receiver.subscribe(member.id, {
                end: { behavior: EndBehaviorType.Manual },
            });

            // ★ 低遅延化: Raw Opusパケットをそのまま sendOpusToSkyWay() に渡す。
            // prism.opus.Decoder (Opus→PCM) を経由するとデコーダーの内部バッファが
            // 徐々に積み上がり、数秒後に1.5秒近い遅延が生じる問題を排除する。
            const sendDcIconToMc = (iconType, force = false) => {
                if (!force && dcIconState === iconType) return;
                dcIconState = iconType;
                const session = gs?.session;
                if (session && !bridge.destroyed) {
                    session.processVcData({ type: 'icon_change', name: userName, icon: iconType }).catch(() => { });
                }
            };

            if (!gs.activeSpeakers) gs.activeSpeakers = new Map();

            let _lastOpusPacketMs = 0;
            let discordToSkywayBytes = 0;
            // Opus CNフレーム (Comfort Noise, type=13): 無音を表す最小パケット
            // SFU/weriftに「ストリームは生きている」と認識させてジッターバッファ拡張を防ぐ
            const OPUS_CN_PACKET = Buffer.from([0xd8]); // Opus CN (コンフォートノイズ) 最小パケット

            opusStream.on('data', (packet) => {
                discordToSkywayBytes += packet.length;
                discordInMetrics.packets++;
                discordInMetrics.bytes += packet.length;
                const now = Date.now();
                if (discordInMetrics.lastPktTime > 0) {
                    const gap = now - discordInMetrics.lastPktTime;
                    if (gap > 50) discordInMetrics.latencySpikes++;
                    if (gap > discordInMetrics.maxGapMs) discordInMetrics.maxGapMs = gap;
                }
                discordInMetrics.lastPktTime = now;
                _lastOpusPacketMs = now;

                gs.activeSpeakers.set(userName, {
                    name: userName,
                    t1: now,
                    bridge: bridge,
                });

                // Raw Opus → SkyWay (PCMへのデコード・再エンコード不要)
                bridge.sendOpusToSkyWay(packet);

                if (dcIconState !== 'muted:dc' && dcIconState !== 'speaker_muted:dc') {
                    sendDcIconToMc('speaking:dc');
                }

                if (speakingTimer) clearTimeout(speakingTimer);
                speakingTimer = setTimeout(() => {
                    speakingTimer = null;
                    if (dcIconState !== 'muted:dc' && dcIconState !== 'speaker_muted:dc' && !bridge.destroyed) {
                        sendDcIconToMc('unmuted:dc');
                    }
                }, SPEAKING_COOLDOWN_MS);
            });

            // ★ 無音キープアライブ: DiscordのVADで音声が来ない期間もOpus CNパケットを
            // 20ms間隔で送り続け、SFUがRTPギャップを「無音」と正しく解釈できるようにする。
            // これがないと数秒でジッターバッファが拡張され1.5秒超の遅延が蓄積する。
            const _silenceKeepalive = setInterval(() => {
                if (bridge.destroyed) { clearInterval(_silenceKeepalive); return; }
                const now = Date.now();
                // 最後のパケットから25ms以上経過していたら無音パケットを送信
                if (now - _lastOpusPacketMs >= 25) {
                    bridge.sendOpusToSkyWay(OPUS_CN_PACKET);
                }
            }, 20);

            opusStream.on('error', (e) => {
                console.warn('[Discord] opusStream error:', e.message);
            });

            // SkyWay出力用にのみ prism を使用（受信方向は変更なし）
            let prism;
            try {
                prism = require('prism-media');
            } catch (e) {
                throw new Error('prism-media module not found');
            }

            const player = createAudioPlayer({
                behaviors: {
                    // デフォルトのバッファリング挙動を最適化
                    noSubscriberBehavior: NoSubscriberBehavior.Play,
                    maxMissedFrames: 1,
                },
            });

            let _currentOutEncoder = null;

            const playSkyWayAudio = () => {
                if (bridge.destroyed) return;
                const skyWayAudioStream = bridge.recreateAudioStream();

                if (_currentOutEncoder) {
                    try { _currentOutEncoder.destroy(); } catch (e) { /* ignore */ }
                    _currentOutEncoder = null;
                }

                _currentOutEncoder = new prism.opus.Encoder({ rate: 48000, channels: 2, frameSize: 960 });
                const outOpusStream = skyWayAudioStream.pipe(_currentOutEncoder);

                const resource = createAudioResource(outOpusStream, {
                    inputType: StreamType.Opus,
                    inlineVolume: false,
                });

                player.play(resource);
            };

            playSkyWayAudio();
            connection.subscribe(player);

            // 注: 以前はSkyWayからの受信ごとにplayer.state.status === Idleを見て
            // playSkyWayAudio()（PassThrough/Opusエンコーダ/AudioResourceの再生成＋player.play）
            // を毎回呼んでいたが、これがAudioPlayerのBuffering遷移＋ネイティブOpusエンコーダ
            // 再初期化のコストを発話の立ち上がりごとに発生させ、遅延の主因になっていた。
            // voice_bridge.js側のジッターバッファが常時（無音時も）フレームを書き込み続けるように
            // なったため、player は一度play()すれば継続的にPlaying状態を保てる。
            // そのため onAudioData でのリビルドは行わない。
            bridge.onAudioData = null;

            player.on(AudioPlayerStatus.Idle, () => {
                // 通常はストリームが常時流れているため到達しないはずだが、
                // 何らかの理由でIdleになった場合は自動復帰させる
                if (!bridge.destroyed) {
                    console.warn('[Discord] Audio player went Idle unexpectedly, restarting playback');
                    playSkyWayAudio();
                }
            });

            // Discordの発話中インジケーター(緑の輪)は @discordjs/voice が
            // AudioPlayerの内部状態に応じて自動でON/OFFする。常時パケットを流す
            // 実装にしたことで、Node側の一瞬のスケジューリング遅延（イベントループの
            // 混雑等）でも「一瞬だけデータが読めない」→自動でspeaking=false→
            // 次のtickで復帰、という点滅が起きやすくなる。
            // ここでは speaking 状態を明示的に true へ固定し続けることで点滅を防ぐ。
            connection.setSpeaking(true);
            const speakingKeepAliveInterval = setInterval(() => {
                if (bridge.destroyed) return;
                try { connection.setSpeaking(true); } catch (e) { }
            }, 1000);

            player.on('error', (e) => {
                console.error('[Discord] Audio player error:', e.message);
                if (!bridge.destroyed) {
                    setTimeout(playSkyWayAudio, 100);
                }
            });

            const debugMonitorInterval = speakingKeepAliveInterval;

            positionForwarder = (payloadObj) => {
                bridge.updatePosition(payloadObj);
            };

            const session = gs.session;

            if (session) {
                if (!session.positionUpdateCallbacks) {
                    session.positionUpdateCallbacks = new Set();
                }
                session.positionUpdateCallbacks.add(positionForwarder);

                if (!session.iconChangeCallbacks) {
                    session.iconChangeCallbacks = new Set();
                }
                iconChangeForwarder = ({ name, icon }) => {
                    if (!bridge.destroyed) bridge.sendIconChange(name, icon);
                };
                session.iconChangeCallbacks.add(iconChangeForwarder);

                if (!session.volumeChangeCallbacks) {
                    session.volumeChangeCallbacks = new Set();
                }
                volumeChangeForwarder = (state) => {
                    if (!bridge.destroyed) bridge.sendVolumeChange(state);
                };
                session.volumeChangeCallbacks.add(volumeChangeForwarder);

                if (!session.requestDcIconSyncCallbacks) {
                    session.requestDcIconSyncCallbacks = new Set();
                }
                syncIconForwarder = () => {
                    if (!bridge.destroyed && dcIconState) {
                        sendDcIconToMc(dcIconState, true);
                    }
                };
                session.requestDcIconSyncCallbacks.add(syncIconForwarder);
            }

            gs.voiceBridges.set(member.id, {
                bridge,
                connection,
                player,
                opusStream,
                posInterval: _silenceKeepalive,
                debugMonitorInterval,
                positionForwarder,
                iconChangeForwarder,
                volumeChangeForwarder,
                syncIconForwarder,
                sendDcIconToMc,
                getIdleDebounceTimer: () => null,
                clearIdleDebounceTimer: () => { },
                getCurrentOutEncoder: () => _currentOutEncoder,
                userId: member.id,
                userName: userName,
            });

            const fields = [
                { name: t(gid, 'field_room'), value: roomId, inline: true },
                { name: t(gid, 'field_name'), value: userName.replace(/_/g, ' '), inline: true }
            ];
            await interaction.editReply({
                files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))], embeds: [makeEmbed(gid, t(gid, 'join_success'), null, EMBED_COLOR_SUCCESS, fields)]
            });

            if (member.voice.deaf) {
                sendDcIconToMc('speaker_muted:dc');
            } else if (member.voice.mute) {
                sendDcIconToMc('muted:dc');
            } else {
                sendDcIconToMc('unmuted:dc');
            }

        } catch (e) {
            if (!e.message.includes("同じNameのMemberが存在します")) {
                console.error('[Discord] Join error:', e.message || e);
            }

            // --- SkyWay / VC 接続失敗時のクリーンアップ ---
            if (typeof bridge !== 'undefined' && bridge) {
                try { await bridge.disconnect(true); } catch (err) { }
            }
            if (gs && gs.voiceBridges) {
                gs.voiceBridges.delete(member.id);
                if (gs.skywayUsers) gs.skywayUsers.delete(userName);
            }
            // Discord VC から確実に退出する
            if (typeof connection !== 'undefined' && connection) {
                if (!gs || !gs.voiceBridges || gs.voiceBridges.size === 0) {
                    try { connection.destroy(); } catch (err) { }
                }
            }

            // --- エラーメッセージのマッピング ---
            const errMsg = e.message || '';
            let errorMessage;

            if (errMsg === 'VC_JOIN_FAILED' || e.code === 'DISCORD_WS_4014') {
                errorMessage = t(gid, 'err_vc_join_failed');
            } else if (errMsg === 'ROOM_NOT_FOUND' || errMsg.includes('ROOM_NOT_FOUND')) {
                errorMessage = t(gid, 'err_room_not_found');
            } else if (
                errMsg.includes('channelNotFound') ||
                errMsg.includes('channel not found') ||
                errMsg.includes('Failed to join SkyWay room') ||
                errMsg.includes('Could not obtain SkyWay token')
            ) {
                // ルームが存在しない / SkyWay参加失敗
                errorMessage = t(gid, 'err_skyway_room_not_found');
            } else if (errMsg.includes("同じNameのMemberが存在します")) {
                errorMessage = t(gid, 'err_name_used');
            } else {
                errorMessage = errMsg || t(gid, 'join_fail');
            }

            const errorEmbed = makeEmbed(gid, t(gid, 'join_fail'), errorMessage, EMBED_COLOR_ERROR);
            const iconAttachment = [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))];

            // --- Discord へのエラー通知（editReply → channel.send にフォールバック）---
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.editReply({ files: iconAttachment, embeds: [errorEmbed] });
                } else {
                    await interaction.reply({ files: iconAttachment, embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
                }
            } catch (replyErr) {
                // Interaction がタイムアウトしている場合は channel.send にフォールバック
                try {
                    const targetChannelId = gs?.channelId || interaction.channelId;
                    const channel = await client.channels.fetch(targetChannelId);
                    if (channel) {
                        await channel.send({ files: iconAttachment, embeds: [errorEmbed] });
                    }
                } catch (sendErr) {
                    console.error('[Discord] エラー通知の送信にも失敗しました:', sendErr.message);
                }
            }
        }
    }

    async function handleBot(interaction) {
        const gid = interaction.guildId;
        const gs = guildSessions.get(gid);
        const settings = getGuildSettings(gid);

        if (!canAdmin(interaction, false, gs)) {
            await interaction.reply({ files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))], embeds: [makeEmbed(gid, '', t(gid, 'no_permission'), EMBED_COLOR_ERROR)], flags: MessageFlags.Ephemeral });
            return;
        }

        const subCommandGroup = interaction.options.getSubcommandGroup(false);
        const subCommand = interaction.options.getSubcommand();

        if (!subCommandGroup && subCommand === 'lang') {
            const lang = interaction.options.getString('language');
            updateGuildSetting(gid, 'lang', lang);

            const langNames = { ja: '日本語', en: 'English', zh: '简体中文' };
            await interaction.reply({ files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))], embeds: [makeEmbed(gid, '', t(gid, 'lang_changed', { lang: langNames[lang] || lang }), EMBED_COLOR_SUCCESS)] });
            return;
        }

        const handlePermissionUpdate = async (settingKey, baseLocaleKey) => {
            const role = interaction.options.getRole('role');
            let currentList = settings[settingKey] || [];
            if (!Array.isArray(currentList)) currentList = [];

            let msg = '';
            let color = EMBED_COLOR_SUCCESS;

            if (subCommand === 'add') {
                if (role && !currentList.includes(role.id)) {
                    currentList.push(role.id);
                    updateGuildSetting(gid, settingKey, currentList);
                }
                msg = t(gid, `perm_add_${baseLocaleKey}`, { role: role ? role.id : 'unknown' });
            } else if (subCommand === 'remove') {
                if (role && currentList.includes(role.id)) {
                    currentList = currentList.filter(id => id !== role.id);
                    updateGuildSetting(gid, settingKey, currentList);
                    msg = t(gid, `perm_remove_${baseLocaleKey}`, { role: role.id });
                } else {
                    msg = t(gid, 'perm_not_found');
                    color = EMBED_COLOR_ERROR;
                }
            } else if (subCommand === 'reset') {
                updateGuildSetting(gid, settingKey, []);
                msg = t(gid, `perm_reset_${baseLocaleKey}`);
            } else if (subCommand === 'list') {
                const rolesText = currentList.length > 0 ? currentList.map(id => `<@&${id}>`).join(', ') : (baseLocaleKey === 'start' ? t(gid, 'perm_default_start') : t(gid, 'perm_default_admin'));
                msg = t(gid, `perm_list_${baseLocaleKey}`, { roles: rolesText });
            }

            await interaction.reply({ files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))], embeds: [makeEmbed(gid, '', msg, color)] });
        };

        if (subCommandGroup === 'permission_start') {
            await handlePermissionUpdate('perm_start', 'start');
        } else if (subCommandGroup === 'permission_admin') {
            await handlePermissionUpdate('perm_admin', 'admin');
        }
    }

    async function handleConfig(interaction) {
        const gid = interaction.guildId;
        const gs = guildSessions.get(gid);

        // 1. 管理権限チェック
        if (!canAdmin(interaction, true, gs)) {
            await interaction.reply({
                files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))],
                embeds: [makeEmbed(gid, '', t(gid, 'no_permission'), EMBED_COLOR_ERROR)],
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // 2. ギルドセッションが存在しない場合
        if (!gs) {
            await interaction.reply({
                files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))],
                embeds: [makeEmbed(gid, '', t(gid, 'stop_not_running'), EMBED_COLOR_ERROR)],
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        // ★ 3. Discordから/startで作成されたホストセッションでない場合（コンソール/Web起動、または/joinのみ）
        if (!gs._isHostSession) {
            await interaction.reply({
                files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))],
                embeds: [makeEmbed(gid, '', t(gid, 'config_not_host'), EMBED_COLOR_ERROR)],
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const targetSession = gs.hostSession || gs.session;
        const config = targetSession.config;
        const on = (v) => v ? t(gid, 'config_enabled') : t(gid, 'config_disabled');
        const langNames = { ja: '日本語', en: 'English', zh: '简体中文' };
        const currentLang = config.lang || 'en';

        const embed = new EmbedBuilder()
            .setTitle(t(gid, 'config_title'))
            .setColor(EMBED_COLOR)
            .addFields(
                { name: t(gid, 'field_room'), value: targetSession.roomId || gs.roomId, inline: false },
                { name: t(gid, 'config_proximity'), value: on(config.proximity), inline: true },
                { name: t(gid, 'config_distance'), value: `**${config.distance}**`, inline: true },
                { name: t(gid, 'config_verify'), value: on(config.password || config.verify), inline: true },
                { name: t(gid, 'config_spectator'), value: on(config.spectator), inline: true },
                { name: config.spectator ? t(gid, 'config_specListen') : `~~${t(gid, 'config_specListen')}~~`, value: config.spectator ? on(config.specListen) : `~~${on(config.specListen)}~~`, inline: true },
                { name: config.spectator ? t(gid, 'config_specDim') : `~~${t(gid, 'config_specDim')}~~`, value: config.spectator ? on(config.specDim) : `~~${on(config.specDim)}~~`, inline: true },
                { name: t(gid, 'config_output'), value: on(config.output), inline: true },
                { name: 'Language', value: langNames[currentLang] || currentLang, inline: true }
            )
            .setTimestamp();

        embed.setFooter({ text: 'MCBE ProxVC', iconURL: 'attachment://icon.png' });

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('cfg_proximity').setLabel(t(gid, 'btn_proximity')).setStyle(config.proximity ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('cfg_verify').setLabel(t(gid, 'btn_verify')).setStyle((config.password || config.verify) ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('cfg_output').setLabel(t(gid, 'btn_output')).setStyle(config.output ? ButtonStyle.Success : ButtonStyle.Secondary),
        );

        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('cfg_spectator').setLabel(t(gid, 'btn_spectator')).setStyle(config.spectator ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('cfg_specListen').setLabel(t(gid, 'btn_specListen')).setStyle(config.specListen ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(!config.spectator),
            new ButtonBuilder().setCustomId('cfg_specDim').setLabel(t(gid, 'btn_specDim')).setStyle(config.specDim ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(!config.spectator),
        );

        const row3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('cfg_distance_btn').setLabel(`${t(gid, 'config_distance')}: ${config.distance}`).setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('cfg_lang').setLabel(`🌐 ${langNames[currentLang] || currentLang}`).setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('cfg_download').setLabel(t(gid, 'btn_download_config')).setStyle(ButtonStyle.Secondary).setEmoji('📥'),
        );

        await interaction.reply({ files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))], embeds: [embed], components: [row1, row2, row3] });
    }

    async function handleStatus(interaction) {
        const gid = interaction.guildId;
        const requestedRoomId = interaction.options.getString('room_id');
        let targetSession = null;
        const gs = guildSessions.get(gid);

        const searchRoomId = requestedRoomId || (gs ? gs.roomId : null);

        if (searchRoomId) {
            // ★ 修正: active な sessions と pendingSessions の両方から roomId を検索
            for (const s of proxvc.sessions.values()) {
                if (s.roomId === searchRoomId) {
                    targetSession = s;
                    break;
                }
            }
            if (!targetSession) {
                for (const s of proxvc.pendingSessions.values()) {
                    if (s.roomId === searchRoomId) {
                        targetSession = s;
                        break;
                    }
                }
            }

            if (requestedRoomId && !targetSession) {
                await interaction.reply({ files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))], embeds: [makeEmbed(gid, null, t(gid, 'err_room_not_found'), EMBED_COLOR_ERROR)], flags: MessageFlags.Ephemeral });
                return;
            }
        } else {
            if (gs && gs.session) {
                targetSession = gs.session;
            }
        }

        const isRunning = !!targetSession;

        const embed = new EmbedBuilder()
            .setTitle(t(gid, 'status_title'))
            .setColor(isRunning ? EMBED_COLOR_SUCCESS : EMBED_COLOR)
            .addFields(
                { name: 'Status', value: isRunning ? t(gid, 'status_running') : t(gid, 'status_idle'), inline: true },
            )
            .setTimestamp();

        embed.setFooter({ text: 'MCBE ProxVC', iconURL: 'attachment://icon.png' });

        if (isRunning) {
            embed.addFields(
                { name: t(gid, 'status_room'), value: targetSession.roomId || 'N/A', inline: true },
                { name: t(gid, 'status_distance'), value: `${targetSession.config.distance}`, inline: true },
            );
            const { peekRoomMembers } = require('./voice_bridge');
            const userSet = new Set();
            try {
                const names = await peekRoomMembers({
                    roomId: targetSession.roomId,
                    appId: targetSession.config?.app_id || INITIAL_CONFIG.app_id,
                    secretKey: targetSession.config?.secret_key || INITIAL_CONFIG.secret_key,
                });
                for (const name of names) {
                    userSet.add(`• ${name.replace(/_/g, ' ')}`);
                }
            } catch (e) {
                console.error('[Status] Failed to peek SkyWay room members:', e);
            }
            const users = Array.from(userSet);
            const userCount = users.length;
            embed.addFields({
                name: `${t(gid, 'status_users')} (${userCount})`,
                value: users.length > 0 ? users.join('\n') : t(gid, 'status_no_users'),
            });

            if (targetSession.connectCommand) {
                embed.addFields({ name: 'Minecraft', value: `\`${targetSession.connectCommand}\`` });
            }
            if (targetSession.roomId) {
                embed.addFields({ name: 'VC URL', value: `https://mcproxvc.ovh/connect/?roomid=${targetSession.roomId}` });
            }
        }

        await interaction.reply({ files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))], embeds: [embed] });
    }

    // --- ボタン/セレクトメニュー ハンドラ ---
    async function handleConfigInteraction(interaction) {
        const gid = interaction.guildId;
        const gs = guildSessions.get(gid);

        if (!canAdmin(interaction, true, gs)) {
            await interaction.reply({ files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))], embeds: [makeEmbed(gid, '', t(gid, 'no_permission'), EMBED_COLOR_ERROR)], flags: MessageFlags.Ephemeral });
            return;
        }

        if (!gs || !gs.session) {
            await interaction.reply({ files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))], embeds: [makeEmbed(gid, '', t(gid, 'config_no_session'), EMBED_COLOR_ERROR)], flags: MessageFlags.Ephemeral });
            return;
        }

        const targetSession = gs.hostSession || gs.session;
        const config = targetSession.config;
        const customId = interaction.customId;

        if (customId === 'cfg_download') {
            const exportSubDomain = (typeof targetSession._originalSubDomain === 'string')
                ? targetSession._originalSubDomain
                : ((gs && typeof gs.originalSubDomain === 'string') ? gs.originalSubDomain : "");

            const exportConfig = {
                app_id: config.app_id || "",
                secret_key: config.secret_key || "",
                username: config.username || "",
                sub_domain: exportSubDomain,
                sub_domain2: config.sub_domain2 || "",
                ssh_password: config.ssh_password || "",
                port: config.port || 19132,
                web_port: config.web_port || 8000,
                proximity: config.proximity ?? true,
                spectator: config.spectator ?? true,
                specListen: config.specListen ?? true,
                specDim: config.specDim ?? false,
                verify: config.verify ?? config.password ?? false,
                output: config.output ?? true,
                distance: config.distance ?? 10,
                lang: config.lang || "en"
            };

            const configBuffer = Buffer.from(JSON.stringify(exportConfig, null, 4), 'utf8');
            const fileAttachment = new AttachmentBuilder(configBuffer, { name: 'config.json' });

            await interaction.reply({
                content: t(gid, 'config_download_msg'),
                files: [fileAttachment],
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        if (customId === 'cfg_distance_btn') {
            const modal = new ModalBuilder()
                .setCustomId('cfg_distance_modal')
                .setTitle(t(gid, 'config_distance'));

            const distInput = new TextInputBuilder()
                .setCustomId('distance_value')
                .setLabel(t(gid, 'modal_distance_label'))
                .setStyle(TextInputStyle.Short)
                .setPlaceholder(`${config.distance}`)
                .setValue(`${config.distance}`)
                .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(distInput));
            await interaction.showModal(modal);
            return;
        }

        if (customId === 'cfg_lang') {
            const currentLang = config.lang || 'en';
            const nextLang = currentLang === 'ja' ? 'en' : (currentLang === 'en' ? 'zh' : 'ja');
            if (typeof targetSession.dataUpdate === 'function') {
                targetSession.dataUpdate({ lang: nextLang });
            } else {
                config.lang = nextLang;
                if (updateConfigFile) updateConfigFile('lang', nextLang);
                if (targetSession.world && typeof targetSession.t === 'function') {
                    targetSession.world.sendMessage(targetSession.t('lang_set')).catch(() => { });
                }
                if (typeof targetSession.syncSettings === 'function') {
                    targetSession.syncSettings();
                }
            }
        } else if (customId.startsWith('cfg_')) {
            const keyMap = {
                'cfg_proximity': 'proximity',
                'cfg_verify': 'verify',
                'cfg_spectator': 'spectator',
                'cfg_specListen': 'specListen',
                'cfg_specDim': 'specDim',
                'cfg_output': 'output',
            };
            const key = keyMap[customId];
            if (key) {
                const nextVal = !config[key];
                if (typeof targetSession.dataUpdate === 'function') {
                    targetSession.dataUpdate({ [key]: nextVal });
                } else {
                    config[key] = nextVal;
                    if (key === 'verify') config.password = nextVal;
                    if (updateConfigFile) updateConfigFile(key, nextVal);
                    if (targetSession.world && typeof targetSession.t === 'function') {
                        let msg = '';
                        const prefix = targetSession.t('prefix');
                        switch (key) {
                            case 'output': msg = nextVal ? targetSession.t('output_enabled') : targetSession.t('output_disabled'); break;
                            case 'verify': msg = nextVal ? targetSession.t('verify_enabled') : targetSession.t('verify_disabled'); break;
                            case 'proximity': msg = nextVal ? targetSession.t('proximity_enabled') : targetSession.t('proximity_disabled'); break;
                            case 'spectator': msg = nextVal ? targetSession.t('spectator_separated') : targetSession.t('spectator_common'); break;
                            case 'specListen': msg = nextVal ? targetSession.t('speclisten_enabled') : targetSession.t('speclisten_disabled'); break;
                            case 'specDim': msg = nextVal ? targetSession.t('specdim_separated') : targetSession.t('specdim_common'); break;
                        }
                        if (msg) {
                            const finalMsg = msg.startsWith(prefix) ? msg : (prefix + ' ' + msg);
                            if (config.output || key === 'output') {
                                targetSession.world.sendMessage(finalMsg).catch(() => { });
                            }
                        }
                    }
                    if (typeof targetSession.syncSettings === 'function') {
                        targetSession.syncSettings();
                    }
                }
            }
        }

        await interaction.deferUpdate();
        await handleConfigRefresh(interaction, gid, gs);
    }

    async function handleConfigRefresh(interaction, gid, gs) {
        const targetSession = gs.hostSession || gs.session;
        const config = targetSession.config;
        const on = (v) => v ? t(gid, 'config_enabled') : t(gid, 'config_disabled');

        const langNames = { ja: '日本語', en: 'English', zh: '简体中文' };
        const currentLang = config.lang || 'en';

        const embed = new EmbedBuilder()
            .setTitle(t(gid, 'config_title'))
            .setColor(EMBED_COLOR)
            .setDescription(`**${t(gid, 'config_updated')}**`)
            .addFields(
                { name: t(gid, 'field_room'), value: targetSession.roomId || gs.roomId, inline: false },
                { name: t(gid, 'config_proximity'), value: on(config.proximity), inline: true },
                { name: t(gid, 'config_distance'), value: `**${config.distance}**`, inline: true },
                { name: t(gid, 'config_verify'), value: on(config.password || config.verify), inline: true },
                { name: t(gid, 'config_spectator'), value: on(config.spectator), inline: true },
                { name: config.spectator ? t(gid, 'config_specListen') : `~~${t(gid, 'config_specListen')}~~`, value: config.spectator ? on(config.specListen) : `~~${on(config.specListen)}~~`, inline: true },
                { name: config.spectator ? t(gid, 'config_specDim') : `~~${t(gid, 'config_specDim')}~~`, value: config.spectator ? on(config.specDim) : `~~${on(config.specDim)}~~`, inline: true },
                { name: t(gid, 'config_output'), value: on(config.output), inline: true },
                { name: 'Language', value: langNames[currentLang] || currentLang, inline: true }
            )
            .setTimestamp();

        embed.setFooter({ text: 'MCBE ProxVC', iconURL: 'attachment://icon.png' });

        const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('cfg_proximity').setLabel(t(gid, 'btn_proximity')).setStyle(config.proximity ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('cfg_verify').setLabel(t(gid, 'btn_verify')).setStyle((config.password || config.verify) ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('cfg_output').setLabel(t(gid, 'btn_output')).setStyle(config.output ? ButtonStyle.Success : ButtonStyle.Secondary),
        );

        const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('cfg_spectator').setLabel(t(gid, 'btn_spectator')).setStyle(config.spectator ? ButtonStyle.Success : ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('cfg_specListen').setLabel(t(gid, 'btn_specListen')).setStyle(config.specListen ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(!config.spectator),
            new ButtonBuilder().setCustomId('cfg_specDim').setLabel(t(gid, 'btn_specDim')).setStyle(config.specDim ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(!config.spectator),
        );

        const row3 = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('cfg_distance_btn').setLabel(`${t(gid, 'config_distance')}: ${config.distance}`).setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('cfg_lang').setLabel(`🌐 ${langNames[currentLang] || currentLang}`).setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('cfg_download').setLabel(t(gid, 'btn_download_config')).setStyle(ButtonStyle.Secondary).setEmoji('📥'),
        );

        try {
            await interaction.editReply({ files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))], embeds: [embed], components: [row1, row2, row3] });
        } catch (e) { /* ignore */ }
    }

    // --- 距離入力Modal ハンドラ ---
    async function handleDistanceModal(interaction) {
        const gid = interaction.guildId;
        const gs = guildSessions.get(gid);

        if (!canAdmin(interaction, true, gs)) {
            await interaction.reply({ files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))], embeds: [makeEmbed(gid, null, t(gid, 'no_permission'), EMBED_COLOR_ERROR)], flags: MessageFlags.Ephemeral });
            return;
        }

        if (!gs || !gs.session) {
            await interaction.reply({ files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))], embeds: [makeEmbed(gid, null, t(gid, 'config_no_session'), EMBED_COLOR_ERROR)], flags: MessageFlags.Ephemeral });
            return;
        }

        const input = interaction.fields.getTextInputValue('distance_value');
        const newDist = parseFloat(input);

        if (isNaN(newDist) || newDist < 0) {
            await interaction.reply({ files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))], embeds: [makeEmbed(gid, null, t(gid, 'err_distance_invalid'), EMBED_COLOR_ERROR)], flags: MessageFlags.Ephemeral });
            return;
        }

        const targetSession = gs.hostSession || gs.session;
        if (typeof targetSession.dataUpdate === 'function') {
            targetSession.dataUpdate({ distance: newDist });
        } else {
            targetSession.config.distance = newDist;
            if (updateConfigFile) updateConfigFile('distance', newDist);
            if (targetSession.world && typeof targetSession.t === 'function') {
                const msg = targetSession.t('distance_changed', { distance: newDist });
                if (targetSession.config.output) {
                    targetSession.world.sendMessage(msg).catch(() => { });
                }
            }
            if (typeof targetSession.syncSettings === 'function') {
                targetSession.syncSettings();
            }
        }

        await interaction.deferUpdate();
        await handleConfigRefresh(interaction, gid, gs);
    }

    // --- イベントハンドラ ---

    client.once(Events.ClientReady, async () => {
        console.log(`${logTag} Login successful: ${client.user.tag}`);
        updateActivity();
        setInterval(updateActivity, 60 * 1000);
        await registerCommands();
        if (botIndex === 1) {
            // Browser pre-launch is no longer needed with SkyWay Node.js SDK
        }
    });

    client.on(Events.GuildCreate, () => updateActivity());
    client.on(Events.GuildDelete, () => updateActivity());

    client.on('error', (err) => {
        console.error(`${logTag} Error:`, err.message);
        if (statusManager) {
            statusManager.updateBot(botIndex, { status: 'error', error: err.message });
        }
    });

    client.on('shardDisconnect', () => {
        console.warn(`${logTag} Disconnected`);
        if (statusManager) {
            statusManager.updateBot(botIndex, { online: false, status: 'offline' });
        }
    });

    client.on('shardResume', () => {
        updateActivity();
    });

    client.on('interactionCreate', async (interaction) => {
        try {
            if (interaction.guildId && interaction.locale) {
                guildLocales.set(interaction.guildId, interaction.locale);
            }

            if (interaction.isChatInputCommand()) {
                switch (interaction.commandName) {
                    case 'help': await handleHelp(interaction); break;
                    case 'start': await handleStart(interaction); break;
                    case 'stop': await handleStop(interaction); break;
                    case 'join': await handleJoin(interaction); break;
                    case 'leave': await handleLeave(interaction); break;
                    case 'bot': await handleBot(interaction); break;
                    case 'config': await handleConfig(interaction); break;
                    case 'status': await handleStatus(interaction); break;
                }
            } else if (interaction.isButton()) {
                if (interaction.customId.startsWith('cfg_')) {
                    await handleConfigInteraction(interaction);
                }
            } else if (interaction.isModalSubmit()) {
                if (interaction.customId === 'cfg_distance_modal') {
                    await handleDistanceModal(interaction);
                }
                // ★ 以下を追加: パスワード入力モーダルが送信された時の処理
                else if (interaction.customId.startsWith('jpwd_')) {
                    await handleJoinPasswordModal(interaction);
                }
            }
        } catch (e) {
            console.error('[Discord] Interaction error:', e);
            try {
                const errorEmbed = makeEmbed(interaction.guildId, '', `❌ ${e.message}`, EMBED_COLOR_ERROR);
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))], embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.reply({ files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))], embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
                }
            } catch (replyError) { /* ignore */ }
        }
    });

    // --- VC切断検知 ---
    client.on('voiceStateUpdate', async (oldState, newState) => {
        const gid = oldState.guild?.id || newState.guild?.id;
        const userId = oldState.member?.id || newState.member?.id;
        if (!gid || !userId) return;
        const gs = guildSessions.get(gid);
        const bridgeInfo = gs?.voiceBridges.get(userId);

        if (bridgeInfo && gs?.session && bridgeInfo.sendDcIconToMc) {
            if (oldState.selfDeaf !== newState.selfDeaf) {
                if (newState.selfDeaf) {
                    bridgeInfo.sendDcIconToMc('speaker_muted:dc');
                } else if (newState.selfMute) {
                    bridgeInfo.sendDcIconToMc('muted:dc');
                } else {
                    bridgeInfo.sendDcIconToMc('unmuted:dc');
                }
            }
            else if (oldState.selfMute !== newState.selfMute && !newState.selfDeaf) {
                if (newState.selfMute) {
                    bridgeInfo.sendDcIconToMc('muted:dc');
                } else {
                    bridgeInfo.sendDcIconToMc('unmuted:dc');
                }
            }
        }

        if (oldState.channelId && oldState.channelId !== newState.channelId) {
            if (gs && gs.voiceBridges.has(userId)) {
                const bridgeInfo2 = gs.voiceBridges.get(userId);
                if (bridgeInfo2) {
                    bridgeInfo2.isLeaving = true;
                    if (bridgeInfo2.bridge) bridgeInfo2.bridge.onDisconnected = null;
                }
                //console.log(`\x1b[35m[Discord]\x1b[0m VC disconnect detected: ${oldState.member.user.tag}`);

                try {
                    // アイコン通知の送信
                    if (bridgeInfo2.sendDcIconToMc) {
                        try { bridgeInfo2.sendDcIconToMc('unconnected:dc', true); } catch (e) { /* ignore */ }
                    }

                    // セッション側のコールバックリスナーを解除
                    if (gs.session) {
                        if (bridgeInfo2.positionForwarder && gs.session.positionUpdateCallbacks) {
                            gs.session.positionUpdateCallbacks.delete(bridgeInfo2.positionForwarder);
                        }
                        if (bridgeInfo2.iconChangeForwarder && gs.session.iconChangeCallbacks) {
                            gs.session.iconChangeCallbacks.delete(bridgeInfo2.iconChangeForwarder);
                        }
                        if (bridgeInfo2.volumeChangeForwarder && gs.session.volumeChangeCallbacks) {
                            gs.session.volumeChangeCallbacks.delete(bridgeInfo2.volumeChangeForwarder);
                        }
                        if (bridgeInfo2.syncIconForwarder && gs.session.requestDcIconSyncCallbacks) {
                            gs.session.requestDcIconSyncCallbacks.delete(bridgeInfo2.syncIconForwarder);
                        }
                    }

                    // タイマーやエンコーダーの停止・破壊
                    if (bridgeInfo2.posInterval) clearInterval(bridgeInfo2.posInterval);
                    if (bridgeInfo2.debugMonitorInterval) clearInterval(bridgeInfo2.debugMonitorInterval);
                    if (bridgeInfo2.clearIdleDebounceTimer) {
                        try { bridgeInfo2.clearIdleDebounceTimer(); } catch (e) { /* ignore */ }
                    }
                    if (bridgeInfo2.getCurrentOutEncoder) {
                        try { bridgeInfo2.getCurrentOutEncoder()?.destroy(); } catch (e) { /* ignore */ }
                    }

                    // SkyWay Bridgeの切断（onDisconnectedは呼ばない：voiceStateUpdateが直接クリーンアップ済み）
                    if (bridgeInfo2.bridge) await bridgeInfo2.bridge.disconnect(true);

                    // Discord VC接続の切断・破棄
                    if (bridgeInfo2.connection) {
                        try { bridgeInfo2.connection.destroy(); } catch (e) { /* ignore */ }
                    }
                } catch (e) {
                    console.error('[Discord] Error during voice disconnect cleanup:', e);
                }

                // 管理データからの削除
                gs.voiceBridges.delete(userId);
                if (gs.skywayUsers) gs.skywayUsers.delete(bridgeInfo2.userName);

                // 他にアクティブなブリッジがなく、セッションも無ければギルドセッションを削除
                if (gs.voiceBridges.size === 0 && !gs.session) {
                    guildSessions.delete(gid);
                }
            }
        }
    });

    process.on('unhandledRejection', (reason) => {
        if (reason && reason.code === 'InteractionAlreadyReplied') return;
        if (reason && typeof reason.message === 'string' && reason.message.includes('Unknown interaction')) return;
        console.error('[Discord] Unhandled rejection:', reason);
    });

    // ==================== 認証完了イベントリスナー ====================
    // ==================== 認証完了イベントリスナー ====================
    if (authMod && authMod.authEvents) {
        authMod.authEvents.on('auth_complete', async (authData) => {
            // 他のBotインスタンス向けの認証ならスキップ
            if (authData.botIndex !== undefined && authData.botIndex !== botIndex) {
                return;
            }
            if (authData.botId && client.user && authData.botId !== client.user.id) {
                return;
            }
            // 複数インスタンスによる二重処理を完全に防止
            if (authData.token) {
                if (!authMod._processingTokens) authMod._processingTokens = new Set();
                if (authMod._processingTokens.has(authData.token)) return;
                authMod._processingTokens.add(authData.token);
                setTimeout(() => {
                    if (authMod._processingTokens) authMod._processingTokens.delete(authData.token);
                }, 60000);
            }

            let connection;
            let bridge;
            const { userId, guildId, channelId: vcChannelId, roomId, userName: aUserName, token } = authData;
            const savedInteraction = authData.interaction || authData._botContext?.interaction;

            // エラーメッセージの送信/編集ヘルパー関数
            // 認証用Embed（savedInteraction）が存在する場合はそれをエラー状態に編集し、
            // メッセージが削除されている等で編集に失敗した場合は従来のテキストチャンネル送信へフォールバック
            async function sendOrEditErrorMessage(errorEmbed, targetTextChannelId) {
                let edited = false;
                if (savedInteraction) {
                    try {
                        await savedInteraction.editReply({
                            embeds: [errorEmbed],
                            components: []
                        });
                        edited = true;
                    } catch (e) {
                        console.warn('[Discord] Failed to edit auth reply to error embed, falling back to channel message:', e.message);
                    }
                }
                if (!edited && targetTextChannelId) {
                    try {
                        const ch = await client.channels.fetch(targetTextChannelId);
                        if (ch) {
                            await ch.send({
                                files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))],
                                embeds: [errorEmbed]
                            });
                        }
                    } catch (e) {
                        console.error('[Discord] Failed to send fallback error message to channel:', e.message);
                    }
                }
            }

            try {
                authCooldowns.set(userId, Date.now());

                let guild;
                try { guild = await client.guilds.fetch(guildId); } catch (e) { return; }

                let member;
                try { member = await guild.members.fetch(userId); } catch (e) { return; }

                // コマンドが実行されたテキストチャンネルIDを決定
                const targetTextChannelId =
                    authData.textChannelId ||
                    authData._botContext?.interaction?.channelId ||
                    guildSessions.get(guildId)?.channelId;

                const vcChannel = member.voice.channel;
                if (!vcChannel) {
                    const errorEmbed = makeEmbed(guildId, t(guildId, 'auth_complete_not_in_vc_title'), t(guildId, 'auth_complete_not_in_vc_desc'), EMBED_COLOR_ERROR);
                    await sendOrEditErrorMessage(errorEmbed, targetTextChannelId);
                    return;
                }

                const botMember = await guild.members.fetch(client.user.id);
                const permissions = vcChannel.permissionsFor(botMember);
                if (!permissions || !permissions.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) {
                    const errorEmbed = makeEmbed(guildId, '', t(guildId, 'join_failed_err_vc'), EMBED_COLOR_ERROR);
                    await sendOrEditErrorMessage(errorEmbed, targetTextChannelId);
                    return;
                }

                let currentGs = guildSessions.get(guildId);
                if (!currentGs) {
                    currentGs = {
                        session: null, sessionId: null, roomId, channelId: targetTextChannelId,
                        voiceBridges: new Map(), _stoppedByCommand: false, _isHost: false,
                    };
                    guildSessions.set(guildId, currentGs);
                } else if (targetTextChannelId) {
                    currentGs.channelId = targetTextChannelId;
                }

                if (currentGs.voiceBridges.has(userId)) return;

                // 同名ユーザーが既にSkyWayに存在するかチェック
                const targetName = aUserName || userId;
                if (currentGs.skywayUsers && currentGs.skywayUsers.has(targetName)) {
                    const errorEmbed = makeEmbed(guildId, null, t(guildId, 'err_name_used'), EMBED_COLOR_ERROR);
                    await sendOrEditErrorMessage(errorEmbed, targetTextChannelId);
                    return;
                }

                let foundSession = findSession(roomId, guildId);
                currentGs.session = foundSession || currentGs.session;
                if (foundSession && foundSession.roomId) {
                    currentGs.roomId = foundSession.roomId;
                } else if (roomId) {
                    currentGs.roomId = roomId;
                }

                const VoiceBridge = require('./voice_bridge');
                bridge = new VoiceBridge({
                    roomId,
                    userName: targetName,
                    appId: currentGs.session?.config?.app_id || INITIAL_CONFIG.app_id,
                    secretKey: currentGs.session?.config?.secret_key || INITIAL_CONFIG.secret_key,
                });

                connection = joinVoiceChannel({
                    channelId: vcChannel.id,
                    guildId: guild.id,
                    adapterCreator: guild.voiceAdapterCreator,
                    selfDeaf: false,
                    selfMute: false,
                });

                connection.on('error', (error) => {
                    console.error('[Discord(Auth)] Voice connection error:', error.message);
                    try {
                        connection.destroy();
                    } catch (e) { /* ignore */ }
                });

                try {
                    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
                } catch (e) {
                    console.warn('[Discord] Auth VC connection: Ready state timeout', e.message);
                }

                if (!currentGs.skywayUsers) currentGs.skywayUsers = new Set();

                // ★ 問題2修正: bridge.connect()より前にonDisconnectedを設定しておく
                let _disconnectHandled = false;
                let dcIconState = null;
                let speakingTimer = null;
                const SPEAKING_COOLDOWN_MS = 250;

                bridge.onMemberJoined = (msg) => {
                    if (currentGs && currentGs.skywayUsers) currentGs.skywayUsers.add(msg.name);
                };
                bridge.onMemberLeft = (msg) => {
                    if (currentGs && currentGs.skywayUsers) currentGs.skywayUsers.delete(msg.name);
                };

                bridge.onData = async (data) => {
                    if (data && data.t === 'stop') {
                        //console.log(`\x1b[33m[Discord Bot(Auth)] bridge.onData received stop signal: type=${data.type}, room=${roomId}\x1b[0m`);
                        const reasonMap = {
                            'server_shutdown': 'reason_world_closed',
                            'world_closed': 'reason_world_closed',
                            'console_closed': 'reason_console_closed',
                            'password_mismatch': 'reason_password_mismatch',
                            'connection_lost': 'reason_connection_lost'
                        };
                        const reasonKey = reasonMap[data.type] || 'session_ended';
                        if (currentGs) currentGs._sessionEndedReason = t(guildId, reasonKey);
                        try { await bridge.disconnect(); } catch (e) { }
                    }
                };

                let positionForwarder = null;
                let iconChangeForwarder = null;
                let volumeChangeForwarder = null;
                let syncIconForwarder = null;

                bridge.onDisconnected = async () => {
                    if (_disconnectHandled) return;
                    _disconnectHandled = true;
                    const gsAtDisconnect = guildSessions.get(guildId);
                    const currentBridgeInfo = gsAtDisconnect ? gsAtDisconnect.voiceBridges.get(userId) : null;
                    if (currentBridgeInfo && currentBridgeInfo.isLeaving) return;

                    //console.log(`\x1b[33m[Discord Bot(Auth)] bridge.onDisconnected for user: ${targetName} (reason: ${gsAtDisconnect?._sessionEndedReason || 'none'}, bridges: ${gsAtDisconnect?.voiceBridges?.size})\x1b[0m`);
                    dcIconState = 'dc_disconnected';
                    if (speakingTimer) { clearTimeout(speakingTimer); speakingTimer = null; }

                    if (positionForwarder && gsAtDisconnect && gsAtDisconnect.session && gsAtDisconnect.session.positionUpdateCallbacks) {
                        gsAtDisconnect.session.positionUpdateCallbacks.delete(positionForwarder);
                    }

                    if (gsAtDisconnect) {
                        const bridgeInfo = gsAtDisconnect.voiceBridges.get(userId);
                        if (bridgeInfo) {
                            if (bridgeInfo.iconChangeForwarder && gsAtDisconnect.session && gsAtDisconnect.session.iconChangeCallbacks) {
                                gsAtDisconnect.session.iconChangeCallbacks.delete(bridgeInfo.iconChangeForwarder);
                            }
                            if (bridgeInfo.volumeChangeForwarder && gsAtDisconnect.session && gsAtDisconnect.session.volumeChangeCallbacks) {
                                gsAtDisconnect.session.volumeChangeCallbacks.delete(bridgeInfo.volumeChangeForwarder);
                            }
                            if (bridgeInfo.syncIconForwarder && gsAtDisconnect.session && gsAtDisconnect.session.requestDcIconSyncCallbacks) {
                                gsAtDisconnect.session.requestDcIconSyncCallbacks.delete(bridgeInfo.syncIconForwarder);
                            }
                        }

                        gsAtDisconnect.voiceBridges.delete(userId);
                        if (gsAtDisconnect.skywayUsers) gsAtDisconnect.skywayUsers.delete(targetName);

                        if (gsAtDisconnect.voiceBridges.size === 0) {
                            try { connection.destroy(); } catch (e) { /* ignore */ }

                            const isExplicitSessionEnd = !!(gsAtDisconnect._sessionEndedReason || (gsAtDisconnect.session && gsAtDisconnect.session._destroying));
                            const rId = gsAtDisconnect.roomId || t(guildId, 'reason_unknown');

                            if (isExplicitSessionEnd) {
                                const endReasonTitle = gsAtDisconnect._sessionEndedReason || t(guildId, 'session_ended');
                                guildSessions.delete(guildId);

                                try {
                                    const channel = await client.channels.fetch(targetTextChannelId);
                                    if (channel) {
                                        const fields = [{ name: t(guildId, 'field_room'), value: rId, inline: true }];
                                        await channel.send({
                                            files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))],
                                            embeds: [makeEmbed(guildId, endReasonTitle, `${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`, EMBED_COLOR_WARNING, fields)]
                                        });
                                    }
                                } catch (e) { /* ignore */ }
                            } else {
                                if (!gsAtDisconnect.session) {
                                    guildSessions.delete(guildId);
                                }
                            }
                        }
                    }
                };

                // ★ リモートセッション（ローカルにセッションがない場合）のみデータWebSocketに接続 (3段階リトライ付き)
                if (!currentGs.session) {
                    await connectRemoteWsWithRetry(roomId, currentGs, guildId);
                }

                // 1. SkyWayへ接続を試行
                await bridge.connect();
                currentGs.skywayUsers.add(targetName);

                const receiver = connection.receiver;
                const opusStream = receiver.subscribe(userId, {
                    end: { behavior: EndBehaviorType.Manual },
                });

                // ★ 低遅延化: Raw Opusパケットをそのまま sendOpusToSkyWay() に渡す。
                // prism.opus.Decoderを経由するとデコーダー内部バッファの経時的處理で遅延が累積する問題を排除する。
                const sendDcIconToMc = (iconType, force = false) => {
                    if (!force && dcIconState === iconType) return;
                    dcIconState = iconType;
                    const session = currentGs?.session;
                    if (session && !bridge.destroyed) {
                        session.processVcData({ type: 'icon_change', name: targetName, icon: iconType }).catch(() => { });
                    }
                };

                opusStream.on('data', (packet) => {
                    // Raw Opus → SkyWay (PCMへのデコード・再エンコード不要)
                    bridge.sendOpusToSkyWay(packet);
                    if (dcIconState !== 'muted:dc' && dcIconState !== 'speaker_muted:dc') {
                        sendDcIconToMc('speaking:dc');
                    }
                    if (speakingTimer) clearTimeout(speakingTimer);
                    speakingTimer = setTimeout(() => {
                        speakingTimer = null;
                        if (dcIconState !== 'muted:dc' && dcIconState !== 'speaker_muted:dc' && !bridge.destroyed) {
                            sendDcIconToMc('unmuted:dc');
                        }
                    }, SPEAKING_COOLDOWN_MS);
                });

                // SkyWay出力用にのみ prism を使用（受信方向は変更なし）
                let prism;
                try {
                    prism = require('prism-media');
                } catch (e) {
                    throw new Error('prism-media module not found');
                }

                const player = createAudioPlayer({
                    behaviors: {
                        noSubscriberBehavior: NoSubscriberBehavior.Play,
                    },
                });

                let _currentOutEncoder = null;

                const playSkyWayAudio = () => {
                    if (bridge.destroyed) return;
                    const skyWayAudioStream = bridge.recreateAudioStream();

                    if (_currentOutEncoder) {
                        try { _currentOutEncoder.destroy(); } catch (e) { /* ignore */ }
                        _currentOutEncoder = null;
                    }

                    _currentOutEncoder = new prism.opus.Encoder({ rate: 48000, channels: 2, frameSize: 960 });
                    const outOpusStream = skyWayAudioStream.pipe(_currentOutEncoder);

                    const resource = createAudioResource(outOpusStream, {
                        inputType: StreamType.Opus,
                        inlineVolume: false,
                    });
                    player.play(resource);
                };

                playSkyWayAudio();
                connection.subscribe(player);

                // 注: onAudioDataでの毎回リビルドが遅延の主因だったため廃止。
                // voice_bridge.js側が無音時も常時フレームを書き込み続けるようになったので、
                // player は一度play()すれば継続してPlaying状態を保てる。
                bridge.onAudioData = null;
                player.on(AudioPlayerStatus.Idle, () => {
                    if (!bridge.destroyed) {
                        console.warn('[Discord] auth Audio player went Idle unexpectedly, restarting playback');
                        playSkyWayAudio();
                    }
                });

                // speaking状態を明示的にtrue固定して点滅を防ぐ（詳細は通常フロー側コメント参照）
                connection.setSpeaking(true);
                const speakingKeepAliveInterval = setInterval(() => {
                    if (bridge.destroyed) return;
                    try { connection.setSpeaking(true); } catch (e) { }
                }, 1000);
                player.on('error', (e) => {
                    console.error('[Discord] auth Audio player error:', e.message);
                    if (!bridge.destroyed) setTimeout(playSkyWayAudio, 100);
                });

                positionForwarder = (payloadObj) => { bridge.updatePosition(payloadObj); };

                const session = currentGs.session;
                if (session) {
                    if (!session.positionUpdateCallbacks) session.positionUpdateCallbacks = new Set();
                    session.positionUpdateCallbacks.add(positionForwarder);

                    if (!session.iconChangeCallbacks) session.iconChangeCallbacks = new Set();
                    iconChangeForwarder = ({ name, icon }) => {
                        if (!bridge.destroyed) bridge.sendIconChange(name, icon);
                    };
                    session.iconChangeCallbacks.add(iconChangeForwarder);

                    if (!session.volumeChangeCallbacks) session.volumeChangeCallbacks = new Set();
                    volumeChangeForwarder = (state) => {
                        if (!bridge.destroyed) bridge.sendVolumeChange(state);
                    };
                    session.volumeChangeCallbacks.add(volumeChangeForwarder);

                    if (!session.requestDcIconSyncCallbacks) session.requestDcIconSyncCallbacks = new Set();
                    syncIconForwarder = () => {
                        if (!bridge.destroyed && dcIconState) sendDcIconToMc(dcIconState, true);
                    };
                    session.requestDcIconSyncCallbacks.add(syncIconForwarder);
                }

                currentGs.voiceBridges.set(userId, {
                    bridge, connection, player, opusStream,
                    userName: targetName, userId,
                    positionForwarder, iconChangeForwarder, volumeChangeForwarder, syncIconForwarder,
                    sendDcIconToMc,
                    getIdleDebounceTimer: () => null,
                    clearIdleDebounceTimer: () => { },
                    getCurrentOutEncoder: () => _currentOutEncoder,
                    debugMonitorInterval: speakingKeepAliveInterval,
                });
                
                if (member.voice.deaf) {
                    sendDcIconToMc('speaker_muted:dc');
                } else if (member.voice.mute) {
                    sendDcIconToMc('muted:dc');
                } else {
                    sendDcIconToMc('unmuted:dc');
                }

                // 2. 接続成功後に元のEphemeralメッセージを編集
                if (savedInteraction) {
                    try {
                        const successEmbed = makeEmbed(
                            guildId,
                            t(guildId, 'auth_success_title'),
                            t(guildId, 'auth_success_desc', { name: `<@${userId}>` }),
                            EMBED_COLOR_SUCCESS,
                        );

                        // ボタン(components)を空配列にして消去し、Embedを成功状態に編集
                        await savedInteraction.editReply({
                            embeds: [successEmbed],
                            components: []
                        });
                    } catch (e) {
                        console.error('[Discord] Auth completion reply edit failed:', e.message);
                    }
                }
                // 2. 接続成功後に成功メッセージを送信
                if (targetTextChannelId) {
                    try {
                        const ch = await client.channels.fetch(targetTextChannelId);
                        if (ch) {
                            const fields = [
                                { name: t(guildId, 'field_room'), value: roomId, inline: true },
                                { name: t(guildId, 'field_name'), value: targetName.replace(/_/g, ' '), inline: true }
                            ];
                            await ch.send({
                                files: [new AttachmentBuilder(require('path').join(__dirname, 'icon.png'))],
                                embeds: [
                                    makeEmbed(guildId, t(guildId, 'join_success'),
                                        null, EMBED_COLOR_SUCCESS,
                                        fields)
                                ]
                            });
                        }
                    } catch (e) { console.error('[Discord] Auth completion notification failed:', e.message); }
                }

                //console.log(`[Discord] VC connection via auth complete: userId=${userId} roomId=${roomId}`);
            } catch (e) {
                if (!e.message.includes("同じNameのMemberが存在します")) {
                }

                // 3. エラー時の適切なクリーンアップ処理 (ReferenceErrorを出さないよう安全に取得)
                const gsOnErr = guildSessions.get(guildId);

                if (bridge) {
                    try { await bridge.disconnect(); } catch (err) { }
                }
                if (gsOnErr) {
                    gsOnErr.voiceBridges.delete(userId);
                    if (gsOnErr.skywayUsers && aUserName) gsOnErr.skywayUsers.delete(aUserName);
                }
                if (connection) {
                    if (!gsOnErr || !gsOnErr.voiceBridges || gsOnErr.voiceBridges.size === 0) {
                        try { connection.destroy(); } catch (err) { }
                    }
                }

                // 4. テキストチャンネルへエラー通知を編集/送信
                const targetTextChannelId =
                    authData.textChannelId ||
                    authData._botContext?.interaction?.channelId ||
                    gsOnErr?.channelId;

                let errorMessage = e.message || '';
                if (e.message === 'VC_JOIN_FAILED' || e.code === 'DISCORD_WS_4014') {
                    errorMessage = t(guildId, 'err_vc_join_failed');
                } else if (e.message === 'ROOM_NOT_FOUND' || (typeof e.message === 'string' && e.message.includes('ROOM_NOT_FOUND'))) {
                    errorMessage = t(guildId, 'err_room_not_found');
                } else if (
                    typeof e.message === 'string' && (
                        e.message.includes('channelNotFound') ||
                        e.message.includes('channel not found') ||
                        e.message.includes('Failed to join SkyWay room') ||
                        e.message.includes('Could not obtain SkyWay token')
                    )
                ) {
                    errorMessage = t(guildId, 'err_skyway_room_not_found');
                } else if (typeof e.message === 'string' && e.message.includes("同じNameのMemberが存在します")) {
                    errorMessage = t(guildId, 'err_name_used');
                }

                const errorEmbed = makeEmbed(guildId, t(guildId, 'join_fail'), errorMessage || '', EMBED_COLOR_ERROR);
                await sendOrEditErrorMessage(errorEmbed, targetTextChannelId);
            }
        });
    }

    // --- ログイン ---
    client.login(token).catch((e) => {
        console.error(`${logTag} Login failed:`, e.message);
        if (statusManager) {
            statusManager.updateBot(botIndex, { online: false, status: 'error', error: e.message });
        }
    });

    return client;
}

module.exports = { startDiscordBot };