/**
 * VoiceBridge - @shinyoshiaki/skyway-nodejs-sdk を使った SkyWay ↔ Discord 音声ブリッジ
 *
 * Chromeプロセスを使わず、Node.js上で直接SkyWayに接続する。
 * werift (Pure Node.js WebRTC) をバックエンドとして使用。
 *
 * 音声パイプライン:
 *   Discord→SkyWay: PCM(s16le stereo 48kHz) → Opusエンコード → RTP → UDP → SkyWay
 *   SkyWay→Discord: SkyWay → RTP受信 → Opusデコード → 空間音響ゲイン計算 → PCMミックス → PassThrough
 *
 * 外部インターフェースは旧実装(Puppeteer版)と完全互換を維持する。
 */
'use strict';

// --- 立体音響 (距離減衰) 用のグローバル変数 ---
// 開発者コンソールなどから直接上書きして即座にテストできるように let で宣言しています
let SPATIAL_FULL_VOL_RATIO = 0.10;       // 最大距離の10%以下は音量100%固定 (デフォルト: 0.10 = 10%)
let SPATIAL_FULL_VOL_MAX_METERS = 3.0;  // 音量100%固定の上限距離 (デフォルト: 3.0m)
let SPATIAL_LOW_VOL_START_RATIO = 0.80;  // 最大距離の80%以上 (残り20%以下) は音量20%固定 (デフォルト: 0.80 = 80%)
let SPATIAL_LOW_VOL_LEVEL = 0.20;        // 最遠エリアでの固定音量 (デフォルト: 0.20 = 20%)
const dgram = require('dgram');
const { PassThrough } = require('stream');

// --- SkyWay Node.js SDK (lazy require でエラーを遅延) ---
let SkyWaySdk = null;
function getSkyWaySdk() {
    if (!SkyWaySdk) {
        try {
            SkyWaySdk = require('@shinyoshiaki/skyway-nodejs-sdk');
            if (SkyWaySdk?.Logger) {
                SkyWaySdk.Logger.level = 'disable';
            }
        } catch (e) {
            throw new Error('@shinyoshiaki/skyway-nodejs-sdk が見つかりません。npm install @shinyoshiaki/skyway-nodejs-sdk を実行してください。');
        }
    }
    return SkyWaySdk;
}

// --- Opusコーデック (lazy require) ---
let OpusEncoder = null;
function getOpusEncoder() {
    if (!OpusEncoder) {
        try {
            // @discordjs/opus (Nativeバインディング) を優先
            const opus = require('@discordjs/opus');
            OpusEncoder = opus.OpusEncoder;
        } catch (e) {
            try {
                // フォールバック: opusscript
                const opusscript = require('opusscript');
                // opusscript を OpusEncoder ライクなラッパーに変換
                OpusEncoder = class {
                    constructor(rate, channels) {
                        this._enc = new opusscript(rate, channels, opusscript.Application.AUDIO);
                        this._rate = rate;
                        this._channels = channels;
                    }
                    encode(pcm, frameSize) { return Buffer.from(this._enc.encode(pcm, frameSize)); }
                    decode(opus, frameSize) { return Buffer.from(this._enc.decode(opus, frameSize)); }
                    destroy() { if (this._enc.delete) this._enc.delete(); }
                };
            } catch (e2) {
                throw new Error('@discordjs/opus または opusscript が必要です。');
            }
        }
    }
    return OpusEncoder;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms) =>
    Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

// 「ルームが存在しない」ことを表すエラーの判定（実際のエラー名はログで確認して調整してください）
const NOT_FOUND_RE = /not.?found|not.?exist|見つかり|存在しない/i;

/**
 * Find を1回実行する。
 * 戻り値: Room（見つかった）/ null（存在しない確定）
 * 例外  : 判定不能（一時エラー・引数形式の不一致など）
 */
async function findOnce(RoomAPI, context, roomName, type) {
    let lastError;
    // v2系はオブジェクト形式、v1系は文字列形式
    for (const arg of [{ type }, type]) {
        try {
            const room = await withTimeout(RoomAPI.Find(context, { name: roomName }, arg), 8000);
            return room || null;
        } catch (e) {
            if (NOT_FOUND_RE.test(`${e?.name || ''} ${e?.message || ''}`)) return null;
            lastError = e;
        }
    }
    throw lastError;
}

/**
 * 一時エラーをリトライしつつ Find する。
 * 戻り値: Room / null（存在しない確定）/ undefined（リトライしても判定不能）
 */
async function findWithRetry(RoomAPI, context, roomName, type, tries = 3) {
    for (let i = 0; i < tries; i++) {
        try {
            return await findOnce(RoomAPI, context, roomName, type);
        } catch (e) {
            console.warn(`Find(${type}) 失敗 (${i + 1}/${tries}):`, e?.name, e?.message);
            if (i < tries - 1) await sleep(300 * 2 ** i);
        }
    }
    return undefined;
}

/**
 * SFU/P2Pの自動判定および重複・競合対策を行った SkyWay ルーム取得・作成関数
 * SFU優先。SFUが使えない場合のみP2P。既存ルームがあれば種類を問わず合流する。
 * @param {Object} sdkOrSkyWay - SkyWay SDKオブジェクト（SkyWayRoomを含む親オブジェクト）
 * @param {Object} context - SkyWayContext
 * @param {string} roomName - ルーム名
 * @returns {Promise<Object>} SkyWayRoom インスタンス
 */
async function findOrCreateRoom(sdkOrSkyWay, context, roomName) {
    const RoomAPI = sdkOrSkyWay.SkyWayRoom || sdkOrSkyWay;

    // 既存の SFU → P2P を検索して、あれば返す（SFU優先）
    const findExisting = async (tries) => {
        const sfu = await findWithRetry(RoomAPI, context, roomName, 'sfu', tries);
        if (sfu) return { room: sfu };
        const p2p = await findWithRetry(RoomAPI, context, roomName, 'p2p', tries);
        if (p2p) return { room: p2p };
        return { room: null, unknown: sfu === undefined || p2p === undefined };
    };

    // 1. 既存ルームを検索（一時エラーはリトライ）
    const first = await findExisting(3);
    if (first.room) {
        console.log(`既存の ${first.room.type} ルーム（名前: ${roomName}）を取得しました`);
        return first.room;
    }
    if (first.unknown) {
        console.warn('既存ルームの有無を確認できませんでした。Find が動作しているか確認してください');
    }

    // 2. SFUで取得・作成。一時エラーはリトライし、失敗のたびに既存ルームを再検索する
    for (let i = 0; i < 4; i++) {
        try {
            return await withTimeout(
                RoomAPI.FindOrCreate(context, { type: 'sfu', name: roomName }),
                10000
            );
        } catch (sfuError) {
            console.warn(`SFUでの取得・作成に失敗しました (${i + 1}/4):`, sfuError?.name, sfuError?.message || sfuError);

            // タッチの差で別ユーザーが作成した場合などに備え、SFU / P2P を再検索して合流する
            const existing = await findExisting(1);
            if (existing.room) {
                //console.log(`競合・重複発生により既存の ${existing.room.type} ルームへ合流しました`);
                return existing.room;
            }
            if (i < 3) await sleep(400 * 2 ** i);
        }
    }

    // 3. SFUが使えないと判断してP2Pへ。作成直前にも既存ルームを再確認する
    const last = await findExisting(2);
    if (last.room) return last.room;

    let p2pError;
    for (let i = 0; i < 3; i++) {
        try {
            const p2pRoom = await withTimeout(
                RoomAPI.FindOrCreate(context, { type: 'p2p', name: roomName }),
                10000
            );
            // P2P作成中に他のユーザーがSFUを作っていないか確認し、あればSFUを優先する
            const sfuNow = await findWithRetry(RoomAPI, context, roomName, 'sfu', 2);
            return sfuNow || p2pRoom;
        } catch (e) {
            p2pError = e;
            //console.warn(`P2Pでの作成にも失敗しました (${i + 1}/3):`, e?.message || e);

            // P2P作成失敗時も既存ルームを再検索する
            const existing = await findExisting(1);
            if (existing.room) return existing.room;
            if (i < 2) await sleep(400 * 2 ** i);
        }
    }

    // それでも取得できない場合はエラーを投げる
    throw p2pError;
}

// --- RTPパケットヘルパー ---
// 最小限のRTPパケット生成・解析
class RtpHelper {
    static buildPacket({ payloadType, sequenceNumber, timestamp, ssrc, payload }) {
        const header = Buffer.allocUnsafe(12);
        header[0] = 0x80; // V=2, P=0, X=0, CC=0
        header[1] = payloadType & 0x7F;
        header.writeUInt16BE(sequenceNumber & 0xFFFF, 2);
        header.writeUInt32BE(timestamp >>> 0, 4);
        header.writeUInt32BE(ssrc >>> 0, 8);
        return Buffer.concat([header, payload]);
    }

    static parsePacket(buf) {
        if (!buf || buf.length < 12) return null;
        const v = (buf[0] >> 6) & 0x3;
        if (v !== 2) return null;
        const payloadType = buf[1] & 0x7F;
        const sequenceNumber = buf.readUInt16BE(2);
        const timestamp = buf.readUInt32BE(4);
        const ssrc = buf.readUInt32BE(8);
        // CSRCやExtensionをスキップ
        const cc = buf[0] & 0x0F;
        const x = (buf[0] >> 4) & 0x1;
        let offset = 12 + cc * 4;
        if (x && buf.length > offset + 4) {
            const extLen = buf.readUInt16BE(offset + 2);
            offset += 4 + extLen * 4;
        }
        const payload = buf.subarray(offset);
        return { payloadType, sequenceNumber, timestamp, ssrc, payload };
    }
}

// --- メインクラス ---
class VoiceBridge {
    /**
     * 互換メソッド: 旧Puppeteer版ではブラウザを事前起動していたが、
     * Node.js SDK版では何もしない（接続はconnect()時に行う）。
     */
    static async initBrowser() {
        // no-op: Node.js SDKはブラウザ不要
        console.log('\x1b[34m[VoiceBridge]\x1b[0m initBrowser() called (no-op in Node.js SDK mode)');
    }

    /**
     * @param {object} options
     * @param {string} options.roomId    - SkyWayルームID
     * @param {string} options.userName  - SkyWay表示名
     * @param {string} options.appId     - SkyWay App ID
     * @param {string} options.secretKey - SkyWay Secret Key
     */
    constructor(options) {
        this.roomId = options.roomId;
        this.userName = options.userName;
        this.appId = options.appId;
        this.secretKey = options.secretKey;

        this.connected = false;
        this.destroyed = false;

        // SkyWay SDK オブジェクト
        this._context = null;
        this._room = null;
        this._member = null;
        this._publication = null;

        // 送信側: UDP ソケット (Discord PCM → Opus → RTP → SkyWay)
        this._sendSocket = null;   // Node.jsからSkyWayへRTPを送るUDPソケット
        this._sendPort = 0;        // MediaStreamTrackFactory.rtpSource()が返すUDPポート
        this._sendTrack = null;    // MediaStreamTrackFactory.rtpSource()が返すTrack
        this._opusEncoder = null;
        this._rtpSeq = Math.floor(Math.random() * 65535);
        this._rtpTs = Math.floor(Math.random() * 0xFFFFFFFF);
        this._rtpSsrc = Math.floor(Math.random() * 0xFFFFFFFF);
        // Opus payload type (RFC 7587: 動的PT 96-127を使う)
        this._opusPayloadType = 111;

        // 受信側: 各SkyWayメンバーのOpusデコーダー
        this._remoteDecoders = new Map();  // ssrc/publicationId → { decoder, lastSeq, gain, pan }

        // 空間音響パラメータ
        this._positions = {};
        this._yRots = {};
        this._dimensions = {};
        this._spectators = {};
        this._serverDistance = 10;
        this._proximity = true;
        this._spectatorSetting = true;
        this._specListen = true;
        this._specDim = false;
        this._myName = options.userName;
        this._userVolumes = {}; // 個別プレイヤー音量 (0.0~2.0)
        const VOLUME_BOOST = 1.5;
        this._masterVolume = VOLUME_BOOST;

        // ジッターバッファ
        this._jitterBuf = null;
        this._jitterLen = 0;
        this._jitterInterval = null;
        this._lastDataTime = 0;

        // PCM出力ストリーム (SkyWay → Discord)
        this._outputStream = null;

        // 診断メトリクス
        this.jitterMetrics = {
            underRuns: 0, overFlows: 0, catchups: 0, prebuffers: 0,
            curLenMs: 0, minLenMs: 9999, maxLenMs: 0,
        };
        this.latencyMetrics = { d1_2: 0, d3_4: 0 };
        this._tsT2 = 0;
        this._tsT3 = 0;
        this._tsT4 = 0;
        this._lastT3 = 0;
        this.browserStats = null; // 互換用（Node.js版ではnull）

        // イベントハンドラ (bot.jsから設定される)
        this.onConnected = null;
        this.onDisconnected = null;
        this.onError = null;
        this.onMemberJoined = null;
        this.onMemberLeft = null;
        this.onAudioData = null;
        this.onData = null;

        // 内部タイマー
        this._reconnectTimer = null;

        // --- 自動退出・終了ハンドラーの初期化 ---
        this._exitHandler = async (signal) => {
            console.log(`\n\x1b[33m[VoiceBridge(${this.userName})]\x1b[0m Process exit detected (${signal}). Leaving SkyWay room...`);
            await this.disconnect(true);
            process.exit(0);
        };

        // プロセス終了イベントのリスナー登録
        this._bindExitEvents();
    }

    /**
     * プロセス終了イベントリスナーの登録
     * @private
     */
    _bindExitEvents() {
        this._onSigInt = () => this._exitHandler('SIGINT');
        this._onSigTerm = () => this._exitHandler('SIGTERM');
        this._onUncaught = async (err) => {
            console.error(`\x1b[31m[VoiceBridge(${this.userName})]\x1b[0m Uncaught Exception:`, err);
            // ネットワークエラー(ENOTFOUND等)の場合はプロセスを終了せず、ブリッジの切断処理のみ行う
            if (err && (err.code === 'ENOTFOUND' || err.syscall === 'getaddrinfo')) {
                await this.disconnect(true);
                return;
            }
            await this._exitHandler('uncaughtException');
        };

        process.once('SIGINT', this._onSigInt);
        process.once('SIGTERM', this._onSigTerm);
        process.once('uncaughtException', this._onUncaught);
    }

    /**
     * プロセス終了イベントリスナーの解除
     * @private
     */
    _unbindExitEvents() {
        if (this._onSigInt) process.removeListener('SIGINT', this._onSigInt);
        if (this._onSigTerm) process.removeListener('SIGTERM', this._onSigTerm);
        if (this._onUncaught) process.removeListener('uncaughtException', this._onUncaught);
    }

    // =========================================================================
    // 公開API (bot.jsから呼ばれる)
    // =========================================================================

    /**
     * SkyWayに接続してセッションを開始する
     */
    async connect() {
        if (this.destroyed) return;

        try {
            const sdk = getSkyWaySdk();
            const Opus = getOpusEncoder();

            // --- Opusエンコーダー初期化 ---
            this._opusEncoder = new Opus(48000, 2);

            // --- トークン生成とSkyWayContext作成 ---
            const { SkyWayAuthToken, uuidV4, nowInSec } = sdk;
            let token;
            let contextCreated = false;

            if (this.appId && this.secretKey) {
                try {
                    token = new SkyWayAuthToken({
                        jti: uuidV4(),
                        iat: nowInSec ? nowInSec() : Math.floor(Date.now() / 1000),
                        exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24,
                        version: 3,
                        scope: {
                            appId: this.appId,
                            rooms: [{
                                id: '*',
                                methods: ['create', 'close', 'updateMetadata'],
                                member: { id: '*', methods: ['publish', 'subscribe', 'updateMetadata'] },
                                sfu: { enabled: true },
                            }],
                            turn: { enabled: true },
                            analytics: { enabled: true }
                        },
                    }).encode(this.secretKey);

                    //console.log(`\x1b[34m[VoiceBridge(${this.userName})]\x1b[0m Connecting to SkyWay (Node.js SDK)...`);

                    this._context = await sdk.SkyWayContext.Create(token, {
                        log: { level: 'disable' },
                        codecCapabilities: [
                            {
                                kind: 'audio',
                                mimeType: 'audio/opus',
                                clockRate: 48000,
                                channels: 2
                            }
                        ],
                    });
                    contextCreated = true;
                } catch (e) {
                    console.warn(`\x1b[33m[VoiceBridge(${this.userName})]\x1b[0m Local token creation/context failed, trying fallback:`, e.message);
                }
            }

            if (!contextCreated) {
                //console.log(`\x1b[34m[VoiceBridge(${this.userName})]\x1b[0m Fetching fallback SkyWay token from Cloudflare Worker...`);
                const response = await fetch("https://hidden-waterfall-b30f.kkr1212.workers.dev/skyway-token", {
                    headers: {
                        "Origin": "https://mcproxvc.ovh"
                    }
                });
                const data = await response.json();
                if (!data || !data.token) {
                    throw new Error('Could not obtain SkyWay token from fallback server');
                }
                token = data.token;
                this._context = await sdk.SkyWayContext.Create(token, {
                    log: { level: 'disable' },
                    codecCapabilities: [
                        {
                            kind: 'audio',
                            mimeType: 'audio/opus',
                            clockRate: 48000,
                            channels: 2
                        }
                    ],
                });
            }

            // --- ルーム参加 ---
            this._room = await findOrCreateRoom(sdk, this._context, this.roomId);
            this._member = await this._room.join({ name: this.userName });

            if (!this._member) {
                throw new Error('Failed to join SkyWay room');
            }

            // --- 送信用UDPポートを取得 ---
            const [sendTrack, sendPort] = await sdk.MediaStreamTrackFactory.rtpSource({ kind: 'audio' });
            this._sendTrack = sendTrack;
            this._sendPort = sendPort;

            // --- UDPソケットを開いてRTPを送信できる状態にする ---
            this._sendSocket = dgram.createSocket('udp4');
            await new Promise((resolve, reject) => {
                this._sendSocket.bind(0, '127.0.0.1', (err) => err ? reject(err) : resolve());
            });

            // --- localAudioStreamを作成してpublish ---
            sdk.SkyWayStreamFactory.registerMediaDevices({ audio: sendTrack });
            const localStream = await sdk.SkyWayStreamFactory.createMicrophoneAudioStream();
            this._publication = await this._member.publish(localStream, {
                codecCapabilities: [
                    {
                        mimeType: 'audio/opus',
                        clockRate: 48000,
                        channels: 2,
                        // dtx: false → 無音時もパケットを送り続け、受信側SFUがギャップと誤検知して
                        // ジッターバッファを拡張するのを防ぐ（遅延蓄積の主因を排除）
                        parameters: { 'usedtx': 0, 'useinbandfec': 1 }
                    }
                ],
                encodings: [{ maxBitrate: 32000, dtx: false }],
            });

            //console.log(`\x1b[34m[VoiceBridge(${this.userName})]\x1b[0m Published stream. Subscribing to existing members...`);

            // --- 既存メンバーをsubscribe ---
            for (const pub of this._room.publications) {
                if (pub.publisher && pub.publisher.id !== this._member.id && pub.contentType === 'audio') {
                    await this._subscribeRemoteMember(pub);
                }
            }

            // --- 新しいpublicationのsubscribeを設定 ---
            this._room.onStreamPublished.add(async (e) => {
                if (this.destroyed || !this._member) return;
                const pub = e.publication;
                // pub.publisher が null でないかチェック (?.id)
                if (pub?.publisher?.id && pub.publisher.id !== this._member.id && pub.contentType === 'audio') {
                    // SFUサーバー側でProducer/Codecの準備が完了するまで十分に待機 (1500ms)
                    setTimeout(async () => {
                        if (!this.destroyed && this._member) {
                            const latestPub = this._room?.publications?.find(p => p.id === pub.id) || pub;
                            await this._subscribeRemoteMember(latestPub);
                        }
                    }, 1500);
                }
            });

            // --- メンバー退出ハンドラ ---
            this._room.onMemberLeft.add((e) => {
                const id = e?.member?.id;
                if (!id) return;
                this._remoteDecoders.delete(id);
                this._cancelledMembers?.add(id)
                //console.log(`\x1b[34m[VoiceBridge(${this.userName})]\x1b[0m Member left: ${e.member.name}`);
                if (this.onMemberLeft) {
                    this.onMemberLeft({ name: e.member.name, id });
                }
            });

            // ★ 追加: 相手のストリームがUnpublishされた時に明示的にローカルのSubscriptionを解除
            this._room.onStreamUnpublished.add(async (e) => {
                // disconnect() 中/後は this._member が null になる。
                // 退出時に全員分のUnpublishイベントが飛んでくるので、ここで弾く
                const member = this._member;
                if (this.destroyed || !member) return;

                const pub = e?.publication;
                if (!pub?.publisher || pub.publisher.id === member.id) return;

                try {
                    const allSubs = this._room?.subscriptions || this._room?.channel?.subscriptions;
                    const existing = allSubs?.find(s => s.publication?.id === pub.id && s.subscriber?.id === member.id);
                    if (existing) {
                        await member.unsubscribe(existing.id);
                    }
                } catch (err) { /* 無視 */ }
            });

            // --- ジッターバッファ開始 ---
            this._startJitterBuffer();

            this.connected = true;
            //console.log(`\x1b[32m[VoiceBridge(${this.userName})]\x1b[0m Connected to SkyWay room: ${this.roomId}`);

            if (this.onConnected) {
                this.onConnected({ roomId: this.roomId, userName: this.userName });
            }

        } catch (e) {
            await this.disconnect(true);
            throw e;
        }
    }

    /**
     * 現在SkyWayルームに参加しているメンバー名の一覧を取得する
     * @returns {string[]} メンバー名の配列
     */
    getRoomMembers() {
        if (!this._room || !this._room.members) return [];
        return Array.from(this._room.members).map(m => m.name);
    }

    /**
     * Discord音声（PCM Int16 LE interleaved stereo 48kHz）をSkyWayへ送信
     * @param {Buffer} pcmBuffer - s16le stereo 48kHz PCM
     */
    sendAudioToSkyWay(pcmBuffer) {
        if (!pcmBuffer || this.destroyed) return;

        if (!this._sendSocket || !this._opusEncoder || this._sendPort === 0) return;

        if (this._sendAudioTimeout) clearTimeout(this._sendAudioTimeout);
        this._sendAudioTimeout = setTimeout(() => {
            this._isSendingAudio = false;
        }, 250);

        try {
            // PCM Int16 → Opus エンコード
            const FRAME_SAMPLES = 960;
            const FRAME_BYTES = FRAME_SAMPLES * 2 * 2; // stereo * s16

            let offset = 0;
            while (offset + FRAME_BYTES <= pcmBuffer.length) {
                const frame = pcmBuffer.subarray(offset, offset + FRAME_BYTES);
                offset += FRAME_BYTES;

                // Opusエンコード
                const opusData = this._opusEncoder.encode(frame, FRAME_SAMPLES);
                if (!opusData || opusData.length === 0) continue;

                // RTPパケット生成
                const rtpPacket = RtpHelper.buildPacket({
                    payloadType: this._opusPayloadType,
                    sequenceNumber: this._rtpSeq++,
                    timestamp: this._rtpTs,
                    ssrc: this._rtpSsrc,
                    payload: Buffer.from(opusData),
                });
                this._rtpTs = (this._rtpTs + FRAME_SAMPLES) >>> 0;

                // UDPでlocalhost:_sendPortへ送信
                this._sendSocket.send(rtpPacket, this._sendPort, '127.0.0.1');
            }
        } catch (e) {
            // ignore encode errors
        }
    }

    /**
     * DiscordのRaw Opusパケットを直接SkyWayへ送信（PCMデコード→再エンコードを省略）
     * prism.opus.Decoder を経由しないためデコーダーのバッファリング遅延を排除できる。
     * @param {Buffer} opusPacket - Discordから受信したRaw Opusパケット（20ms / 960samples想定）
     */
    sendOpusToSkyWay(opusPacket) {
        if (!opusPacket || opusPacket.length === 0 || this.destroyed) return;
        if (!this._sendSocket || this._sendPort === 0) return;

        if (this._sendAudioTimeout) clearTimeout(this._sendAudioTimeout);
        this._sendAudioTimeout = setTimeout(() => {
            this._isSendingAudio = false;
        }, 250);

        try {
            const FRAME_SAMPLES = 960;   // 20ms @ 48kHz
            const SAMPLE_RATE   = 48000;

            // ★ 壁時計ベースでRTPタイムスタンプを計算する
            // Discord VAD により無音期間にパケットが来ない場合でも、
            // タイムスタンプを実経過時間に追従させることで
            // 受信側ジッターバッファのギャップ誤検知による遅延蓄積を防ぐ。
            const nowMs = Date.now();
            if (this._rtpTsOriginMs === undefined) {
                // 初回: 現在の _rtpTs を起点として壁時計を記録
                this._rtpTsOriginMs = nowMs;
                this._rtpTsOrigin = this._rtpTs;
            }
            const elapsedSamples = Math.round((nowMs - this._rtpTsOriginMs) * SAMPLE_RATE / 1000);
            this._rtpTs = (this._rtpTsOrigin + elapsedSamples) >>> 0;

            const rtpPacket = RtpHelper.buildPacket({
                payloadType: this._opusPayloadType,
                sequenceNumber: this._rtpSeq++,
                timestamp: this._rtpTs,
                ssrc: this._rtpSsrc,
                payload: Buffer.isBuffer(opusPacket) ? opusPacket : Buffer.from(opusPacket),
            });
            // 次回送信用にタイムスタンプを1フレーム分進める
            this._rtpTs = (this._rtpTs + FRAME_SAMPLES) >>> 0;
            this._sendSocket.send(rtpPacket, this._sendPort, '127.0.0.1');
        } catch (e) {
            // ignore send errors
        }
    }

    /**
     * SkyWayからの音声をPCM Readable Streamとして取得
     * @returns {Readable}
     */
    getAudioStream() {
        if (this._outputStream && !this._outputStream.destroyed) {
            return this._outputStream;
        }
        const { PassThrough } = require('stream');
        this._outputStream = new PassThrough({
            highWaterMark: 3840 * 2,
        });
        return this._outputStream;
    }

    /**
     * 音声ストリームを再作成
     * @returns {Readable}
     */
    recreateAudioStream() {
        if (this._outputStream) {
            try { this._outputStream.destroy(); } catch (e) { }
            this._outputStream = null;
        }
        return this.getAudioStream();
    }

    /**
     * 位置データを更新（bot.jsから呼ばれる）
     * @param {object} posData
     */
    updatePosition(posData) {
        if (posData.pos) this._positions = posData.pos;
        if (posData.yr) this._yRots = posData.yr;
        if (posData.dim) this._dimensions = posData.dim;
        if (posData.spPos) this._spectators = posData.spPos;
        if (posData.dis !== undefined) this._serverDistance = posData.dis;
        if (posData.prox !== undefined) this._proximity = !!posData.prox;
        if (posData.spec !== undefined) this._spectatorSetting = posData.spec;
        if (posData.spLis !== undefined) this._specListen = posData.spLis;
        if (posData.spDim !== undefined) this._specDim = posData.spDim;
        if (posData.myName) this._myName = posData.myName;
    }

    /**
     * アイコン変更を受け取る（互換API）
     */
    sendIconChange(name, icon) { }

    /**
     * 音量変更を受け取る（互換API）
     * @param {object} state
     */
    sendVolumeChange(state) {
        if (state && typeof state.masterVolume === 'number') {
            const VOLUME_BOOST = 1.25;
            this._masterVolume = Math.max(0, Math.min(4, (state.masterVolume / 100) * VOLUME_BOOST));
        }
        if (state && state.name && typeof state.volume === 'number') {
            this._userVolumes[state.name] = Math.max(0, Math.min(2, state.volume / 100));
        }
    }

    /**
     * 診断情報取得
     */
    getDiagnostics() {
        const FRAME_BYTES = 3840;
        const jitterMs = Math.round((this._jitterLen / FRAME_BYTES) * 20 * 10) / 10;
        const diag = {
            userName: this.userName,
            roomId: this.roomId,
            connected: this.connected,
            jitter: {
                curLenMs: jitterMs,
                minLenMs: this.jitterMetrics.minLenMs === 9999 ? jitterMs : this.jitterMetrics.minLenMs,
                maxLenMs: this.jitterMetrics.maxLenMs,
                underRuns: this.jitterMetrics.underRuns,
                overFlows: this.jitterMetrics.overFlows,
                catchups: this.jitterMetrics.catchups,
                prebuffers: this.jitterMetrics.prebuffers,
            },
            browser: {
                ringBufMs: jitterMs,
                outVadActive: this._lastDataTime > 0 && (Date.now() - this._lastDataTime) < 500,
                d1_2: this.latencyMetrics.d1_2 || 0,
            },
            latency: {
                d1_2: this.latencyMetrics.d1_2 || 0,
                d3_4: this.latencyMetrics.d3_4 || 0,
            },
            timestamps: {
                t2: this._tsT2,
                t3: this._tsT3,
                t4: this._tsT4,
            },
        };

        this.jitterMetrics.minLenMs = jitterMs;
        this.jitterMetrics.maxLenMs = jitterMs;
        this.jitterMetrics.underRuns = 0;
        this.jitterMetrics.overFlows = 0;
        this.jitterMetrics.catchups = 0;
        this.jitterMetrics.prebuffers = 0;

        return diag;
    }

    /**
     * 切断・クリーンアップ
     * @param {boolean} [suppressCallback=false]
     */
    async disconnect(suppressCallback = false) {
        if (this.destroyed) return;
        this.destroyed = true;
        this.connected = false;

        // 終了イベントハンドラーの登録を解除
        this._unbindExitEvents();

        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }

        if (this._jitterInterval) {
            clearInterval(this._jitterInterval);
            this._jitterInterval = null;
        }

        this._jitterBuf = null;
        this._jitterLen = 0;

        if (this._outputStream) {
            try { this._outputStream.push(null); } catch (e) { }
            this._outputStream = null;
        }

        // Opusエンコーダー破棄
        if (this._opusEncoder) {
            try { if (this._opusEncoder.destroy) this._opusEncoder.destroy(); } catch (e) { }
            this._opusEncoder = null;
        }

        // 受信側デコーダー破棄
        for (const [, info] of this._remoteDecoders) {
            try { if (info.decoder && info.decoder.destroy) info.decoder.destroy(); } catch (e) { }
        }
        this._remoteDecoders.clear();

        // UDPソケット閉じる
        if (this._sendSocket) {
            try { this._sendSocket.close(); } catch (e) { }
            this._sendSocket = null;
        }

        // ★ 追加: Unpublishがサーバーに反映されるまで少し待機
        await new Promise(r => setTimeout(r, 200));

        if (this._member) {
            try { await this._member.leave(); } catch (e) { }
            this._member = null;
        }

        // ★ 追加: Leaveが反映されるまで少し待機
        await new Promise(r => setTimeout(r, 200));

        if (this._context) {
            try { await this._context.dispose(); } catch (e) { }
            this._context = null;
        }
        this._room = null;

        //console.log(`\x1b[34m[VoiceBridge(${this.userName})]\x1b[0m Disconnected from SkyWay`);

        if (!suppressCallback && this.onDisconnected) {
            try { await this.onDisconnected(); } catch (e) { }
        }
    }

    // =========================================================================
    // 内部メソッド
    // =========================================================================

    /**
     * リモートメンバーをsubscribeして音声受信を開始する
     */
    async _subscribeRemoteMember(pub, retryCount = 0) {
        if (this.destroyed) return;
        try {
            const sdk = getSkyWaySdk();
            const Opus = getOpusEncoder();

            const { subscription, stream: remoteStream } = await this._member.subscribe(pub.id);

            const memberId = pub?.publisher?.id;
            const memberName = pub?.publisher?.name || 'Unknown';
            if (!memberId) return;
            const decoder = new Opus(48000, 2);

            this._remoteDecoders.set(memberId, {
                decoder, subscription, memberName,
                gain: 1.0, panL: 0.5, panR: 0.5,
            });

            //console.log(`\x1b[34m[VoiceBridge(${this.userName})]\x1b[0m Subscribed to ${memberName}`);
            if (this.onMemberJoined) this.onMemberJoined({ name: memberName, id: memberId });

            remoteStream.track.onReceiveRtp.subscribe((rtp) => {
                if (this.destroyed) return;
                this._handleRemoteRtp(memberId, rtp.payload);
            });

        } catch (e) {
            // 切断済みなら失敗して当然なのでログもリトライも不要
            if (this.destroyed) return;
            const msg = String(e?.message || e);
            if (msg.includes('canceled') || msg.includes('timeout')) return;

            const isRetryable =
                msg.includes('unsupported codec') ||
                msg.includes('consume failed') ||
                msg.includes('ForwardingからのConsume許可') ||
                msg.includes('すでにSubscribeした');

            if (isRetryable && retryCount < 3) {
                // room/channel全体のSubscription一覧から、自分がこのpublicationに対して
                // 中途半端に持っている(壊れた)Subscriptionを探して片付ける
                try {
                    const allSubs = this._room?.subscriptions || this._room?.channel?.subscriptions;
                    const existing = allSubs?.find(
                        s => s.publication?.id === pub.id && s.subscriber?.id === this._member.id
                    );

                    if (existing) {
                        await this._member.unsubscribe(existing.id).catch(() => {});
                    }
                } catch (cleanupErr) {
                    // 後片付けエラーは無視
                }

                const delay = 600 * (retryCount + 1);
                // 初回はSFUルーティングの同期待ちで発生することが多いため、詳しいエラー内容は出さず簡潔にリトライする
                const targetPub = this._room?.publications?.find(p => p.id === pub.id) || pub;
                setTimeout(() => this._subscribeRemoteMember(targetPub, retryCount + 1), delay);
                return;
            }

            console.error(`\x1b[31m[VoiceBridge(${this.userName})]\x1b[0m Subscribeに失敗しました`);
        }
    }

    /**
     * リモートメンバーのRTPパケット(Opusペイロード)を受信してユーザー別のキューに書き込む
     */
    _handleRemoteRtp(memberId, opusPayload) {
        if (!opusPayload || opusPayload.length === 0) return;

        const info = this._remoteDecoders.get(memberId);
        if (!info) return;

        try {
            const FRAME_SAMPLES = 960;
            const pcmBuf = info.decoder.decode(Buffer.from(opusPayload), FRAME_SAMPLES);
            if (!pcmBuf || pcmBuf.length === 0) return;

            this._lastDataTime = Date.now();

            if (this._receiveAudioTimeout) clearTimeout(this._receiveAudioTimeout);
            this._receiveAudioTimeout = setTimeout(() => {
                this._isReceivingAudio = false;
            }, 250);

            if (!info.pcmQueue) info.pcmQueue = [];
            info.pcmQueue.push(pcmBuf);

            if (info.pcmQueue.length > 2) {
                info.pcmQueue.shift();
            }

            if (this.onAudioData) {
                try { this.onAudioData(); } catch (e) { }
            }

        } catch (e) {
            // ignore decode errors
        }
    }

    /**
     * 位置情報に基づいてゲインとステレオパンを計算する
     */
    _calcSpatialGain(memberName) {
        const hasPositions = Object.keys(this._positions).length > 0;
        const mySpectator = this._spectators[this._myName];
        const memberSpectator = this._spectators[memberName];
        const myDim = this._dimensions[this._myName];
        const memberDim = this._dimensions[memberName];
        const differentDimension = myDim !== memberDim;

        const isMuted = hasPositions && (
            (this._spectatorSetting && this._specDim && differentDimension) ||
            (!mySpectator && ((this._spectatorSetting && memberSpectator) || differentDimension)) ||
            (this._spectatorSetting && !this._specListen && mySpectator && !memberSpectator)
        );
        if (isMuted) return { gain: 0, panL: 0.5, panR: 0.5 };

        if (!this._proximity || !hasPositions ||
            (this._spectatorSetting && !this._specDim && mySpectator && memberSpectator) ||
            (this._spectatorSetting && this._specDim && !differentDimension && mySpectator && memberSpectator)) {
            return { gain: 1.0, panL: 0.5, panR: 0.5 };
        }

        const myPos = this._parsePosition(this._positions[this._myName]);
        const memberPos = this._parsePosition(this._positions[memberName]);

        if (!myPos || !memberPos || memberPos.y === 30000) {
            return { gain: 1.0, panL: 0.5, panR: 0.5 };
        }

        const dx = memberPos.x - myPos.x;
        const dy = memberPos.y - myPos.y;
        const dz = memberPos.z - myPos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        const effectiveMaxDist = this._serverDistance;
        if (dist > effectiveMaxDist) {
            return { gain: 0, panL: 0.5, panR: 0.5 };
        }

        // --- 立体音響 (距離減衰) 計算 (main.js の calculateDistanceAttenuation と同等) ---
        const maxDist = effectiveMaxDist > 0 ? effectiveMaxDist : 100;
        const fullVolDist = Math.max(0.1, Math.min(maxDist * SPATIAL_FULL_VOL_RATIO, SPATIAL_FULL_VOL_MAX_METERS));
        let gain;
        if (dist <= fullVolDist) {
            // 近距離エリア: 音量100%固定
            gain = 1.0;
        } else {
            const lowVolDist = maxDist * SPATIAL_LOW_VOL_START_RATIO;
            if (dist >= lowVolDist) {
                // 最遠エリア: 音量 SPATIAL_LOW_VOL_LEVEL (20%) 固定
                gain = SPATIAL_LOW_VOL_LEVEL;
            } else if (lowVolDist <= fullVolDist) {
                gain = SPATIAL_LOW_VOL_LEVEL;
            } else {
                // 中間エリア: 1.0 (100%) から SPATIAL_LOW_VOL_LEVEL (20%) へ線形減衰
                const t = (dist - fullVolDist) / (lowVolDist - fullVolDist);
                gain = Math.max(0, 1.0 - t * (1.0 - SPATIAL_LOW_VOL_LEVEL));
            }
        }

        const myYRot = this._yRots[this._myName] || 0;
        const rad = (myYRot * Math.PI) / 180;
        const lookX = -Math.sin(rad);
        const lookZ = Math.cos(rad);
        const relX = dx * (-lookZ) + dz * lookX;
        const panPos = Math.max(-1, Math.min(1, relX / Math.max(1, effectiveMaxDist)));
        const panL = 0.5 - panPos * 0.4;
        const panR = 0.5 + panPos * 0.4;

        return { gain, panL, panR };
    }

    _parsePosition(raw) {
        if (!raw) return null;
        if (Array.isArray(raw)) return { x: raw[0], y: raw[1], z: raw[2] };
        return raw;
    }

    _startJitterBuffer() {
        const FRAME_BYTES = 3840;
        const silenceFrame = Buffer.alloc(FRAME_BYTES);
        for (let i = 0; i < FRAME_BYTES; i += 2) {
            silenceFrame.writeInt16LE((i / 2) % 2 === 0 ? 1 : -1, i);
        }

        const BUFFER_TARGET_MS = 40;
        let nextFrameTime = Date.now() + BUFFER_TARGET_MS;

        this._jitterInterval = setInterval(() => {
            if (!this._outputStream || this._outputStream.destroyed) return;

            const now = Date.now();

            // 【対策1】プロセスの負荷等で時間が飛んだ際、一気に大量書き込みをして遅延を生むのを防ぐ
            if (now > nextFrameTime + 100) {
                nextFrameTime = now - 20;
            }

            while (nextFrameTime <= now + BUFFER_TARGET_MS) {
                const timeSinceLastData = this._lastDataTime > 0 ? (now - this._lastDataTime) : 999999;

                // 【対策2】ストリーム内に滞留しているデータ量をチェック
                // 3フレーム(60ms)分以上滞留している場合は書き込みをスキップし、あふれた遅延を削り落とす
                const bufferedBytes = this._outputStream.readableLength || this._outputStream.writableLength || 0;
                const canWrite = bufferedBytes < FRAME_BYTES * 3;

                if (timeSinceLastData > 200) {
                    this.latencyMetrics.d3_4 = 0;
                    for (const info of this._remoteDecoders.values()) {
                        if (info.pcmQueue) info.pcmQueue.length = 0;
                    }
                    if (canWrite) this._outputStream.write(silenceFrame);
                } else {
                    let hasAudio = false;
                    let maxQueueLen = 0;

                    for (const info of this._remoteDecoders.values()) {
                        if (info.pcmQueue && info.pcmQueue.length > 0) {
                            hasAudio = true;
                            if (info.pcmQueue.length > maxQueueLen) maxQueueLen = info.pcmQueue.length;
                        }
                    }

                    if (!hasAudio) {
                        if (canWrite) this._outputStream.write(silenceFrame);
                    } else {
                        const mixedPcm = new Int32Array(FRAME_BYTES / 2);

                        for (const [memberId, info] of this._remoteDecoders.entries()) {
                            if (!info.pcmQueue || info.pcmQueue.length === 0) continue;

                            // canWrite(書き込み可否)に関わらずキューからは必ず取り出し、古い音声を捨てる
                            const pcmBuf = info.pcmQueue.shift();

                            const { gain, panL, panR } = this._calcSpatialGain(info.memberName);
                            const userVol = this._userVolumes[info.memberName] !== undefined ? this._userVolumes[info.memberName] : 1.0;
                            const totalGain = gain * userVol * this._masterVolume;

                            if (totalGain <= 0) continue;

                            const samples = pcmBuf.length / 2;
                            for (let i = 0; i < samples; i += 2) {
                                const srcL = pcmBuf.readInt16LE(i * 2);
                                const srcR = pcmBuf.readInt16LE((i + 1) * 2);
                                mixedPcm[i] += Math.round(srcL * totalGain * panL * 2);
                                mixedPcm[i + 1] += Math.round(srcR * totalGain * panR * 2);
                            }
                        }

                        if (canWrite) {
                            const outBuf = Buffer.allocUnsafe(FRAME_BYTES);
                            for (let i = 0; i < mixedPcm.length; i++) {
                                const val = Math.max(-32768, Math.min(32767, mixedPcm[i]));
                                outBuf.writeInt16LE(val, i * 2);
                            }
                            this._outputStream.write(outBuf);
                        }
                    }
                }

                nextFrameTime += 20;
            }
        }, 10);
    }
}

async function peekRoomMembers({ roomId, appId, secretKey }) {
    const sdk = getSkyWaySdk();
    let context;
    try {
        const { SkyWayAuthToken, uuidV4, nowInSec } = sdk;
        let token;
        let contextCreated = false;

        if (appId && secretKey) {
            try {
                token = new SkyWayAuthToken({
                    jti: uuidV4(),
                    iat: nowInSec ? nowInSec() : Math.floor(Date.now() / 1000),
                    exp: Math.floor(Date.now() / 1000) + 60,
                    version: 3,
                    scope: {
                        appId,
                        rooms: [{ id: '*', methods: ['create'], member: { id: '*', methods: [] } }],
                    },
                }).encode(secretKey);

                context = await sdk.SkyWayContext.Create(token, { log: { level: 'disable' } });
                contextCreated = true;
            } catch (e) {
                console.warn(`\x1b[33m[VoiceBridge]\x1b[0m peekRoomMembers: local token failed, trying fallback:`, e.message);
            }
        }

        if (!contextCreated) {
            const response = await fetch("https://hidden-waterfall-b30f.kkr1212.workers.dev/skyway-token", {
                headers: { "Origin": "https://mcproxvc.ovh" }
            });
            const data = await response.json();
            if (!data || !data.token) {
                throw new Error('Could not obtain SkyWay token from fallback server');
            }
            token = data.token;
            context = await sdk.SkyWayContext.Create(token, { log: { level: 'disable' } });
        }

        let room;
        try {
            room = await sdk.SkyWayRoom.Find(context, { name: roomId }, 'sfu');
        } catch (e) { }

        if (!room) {
            try {
                room = await sdk.SkyWayRoom.Find(context, { name: roomId }, 'p2p');
            } catch (e) { }
        }

        if (room) {
            return Array.from(room.members).map(m => m.name);
        }
        return [];
    } finally {
        if (context) await context.dispose();
    }
}

module.exports = VoiceBridge;
module.exports.peekRoomMembers = peekRoomMembers;