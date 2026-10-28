/**
 * Status Manager for Discord Bots
 * 
 * 5つのDiscord Botのオンライン状況、参加サーバー数、最大参加可能数を管理し、
 * status.jsonのローカル保存およびGitHub Gistへの自動アップロードを行うモジュール。
 * リージョン単位でマージ更新（GET -> PATCH）を行い、他リージョンのデータを上書き消去しない設計。
 */

const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

const DEFAULT_GIST_ID = '3a2586374fc8e9b75064ed49465b9cb2';
const STATUS_FILE_PATH = path.join(__dirname, '..', 'status.json');
const MAX_SERVERS_PER_BOT = 100;

class StatusManager {
    /**
     * @param {object} options
     * @param {string} [options.githubToken] - GitHub Personal Access Token
     * @param {string} [options.gistId] - 対象のGitHub Gist ID
     * @param {number} [options.totalBots=5] - 管理するBotの総数
     * @param {string} [options.region='jp'] - 実行環境のリージョン ('jp', 'us', etc.)
     */
    constructor(options = {}) {
        this.githubToken = (options.githubToken || '').trim();
        this.gistId = (options.gistId || DEFAULT_GIST_ID).trim();
        this.totalBots = options.totalBots || 5;
        this.statusFilePath = STATUS_FILE_PATH;
        this.region = (options.region || 'jp').toLowerCase().trim();

        /** @type {Map<number, object>} */
        this.bots = new Map();

        // 1〜5の初期データを設定
        for (let i = 1; i <= this.totalBots; i++) {
            this.bots.set(i, {
                id: i,
                bot_id: null,
                name: `Bot ${i}`,
                tag: null,
                online: false,
                status: 'offline', // 'online' | 'offline' | 'error' | 'not_configured'
                server_count: 0,
                max_servers: MAX_SERVERS_PER_BOT,
                last_updated: null,
            });
        }

        this.syncTimeout = null;
        this.isSyncing = false;
        this.lastSyncTime = 0;
        this.minSyncIntervalMs = 5000;
        this.lastUploadedData = null;

        // トークン認証状態をチェックしてログ出力
        this.checkTokenAuth();
    }

    /**
     * GitHub Token の認証状況およびAPIレート制限をチェックしてログに出力
     */
    async checkTokenAuth() {
        if (!this.githubToken) {
            console.warn('\x1b[33m[StatusManager]\x1b[0m GITHUB_TOKEN が設定されていません (.env に GITHUB_TOKEN を設定するとGist同期が有効になります)');
            return;
        }

        const maskedToken = this.githubToken.length > 8
            ? `${this.githubToken.substring(0, 4)}...${this.githubToken.substring(this.githubToken.length - 4)}`
            : '****';
        console.log(`\x1b[36m[StatusManager]\x1b[0m GITHUB_TOKEN を検出 (${maskedToken})。GitHub API 認証を確認中...`);

        try {
            const res = await fetch('https://api.github.com/rate_limit', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.githubToken}`,
                    'Accept': 'application/vnd.github+json',
                    'User-Agent': 'MCBE-ProxVC-StatusManager'
                }
            });

            if (res.ok) {
                const data = await res.json();
                const core = (data.resources && data.resources.core) ? data.resources.core : data.rate;
                const resetTime = new Date(core.reset * 1000).toLocaleTimeString();

                let userDetail = '';
                try {
                    const userRes = await fetch('https://api.github.com/user', {
                        headers: {
                            'Authorization': `Bearer ${this.githubToken}`,
                            'Accept': 'application/vnd.github+json',
                            'User-Agent': 'MCBE-ProxVC-StatusManager'
                        }
                    });
                    if (userRes.ok) {
                        const u = await userRes.json();
                        userDetail = ` [ユーザー: ${u.login} (ID: ${u.id})]`;
                    }
                } catch (e) { /* ignore */ }

                console.log(`\x1b[32m[StatusManager]\x1b[0m GitHub API 認証成功!${userDetail}`);
                console.log(`\x1b[32m[StatusManager]\x1b[0m API レート制限: 残り ${core.remaining} / 上限 ${core.limit} 回 (リセット時刻: ${resetTime})`);

                if (core.limit <= 60) {
                    console.warn(`\x1b[33m[StatusManager] 警告: API上限が ${core.limit} 回/時 になっています。Personal Access Token (PAT) が未適用または無効で、IP制限(未認証)扱いになっている可能性があります。\x1b[0m`);
                }
            } else if (res.status === 401) {
                console.error(`\x1b[31m[StatusManager] GitHub API 認証失敗 (401 Unauthorized): GITHUB_TOKEN が無効、または有効期限が切れています。\x1b[0m`);
            } else if (res.status === 403) {
                const errJson = await res.json().catch(() => ({}));
                console.error(`\x1b[31m[StatusManager] GitHub API レート制限超過 (403 Forbidden):\x1b[0m`, errJson.message || 'Rate limit exceeded');
            } else {
                console.warn(`\x1b[33m[StatusManager] GitHub API 認証確認レスポンス (${res.status})\x1b[0m`);
            }
        } catch (e) {
            console.error('\x1b[31m[StatusManager] GitHub API 接続確認エラー:\x1b[0m', e.message);
        }
    }

    /**
     * 前回のアップロード内容と比較して実質的な変更があるか判定
     * @param {object} newData
     * @returns {boolean}
     */
    hasDataChanged(newData) {
        if (!this.lastUploadedData) return true;

        const clean = (data) => {
            if (!data) return {};
            const clone = { ...data };
            delete clone.updated_at;
            if (Array.isArray(clone.bots)) {
                clone.bots = clone.bots.map(b => {
                    const cb = { ...b };
                    delete cb.last_updated;
                    return cb;
                });
            }
            return clone;
        };

        return JSON.stringify(clean(newData)) !== JSON.stringify(clean(this.lastUploadedData));
    }

    /**
     * Botのステータス情報を更新（メモリ上の保持のみ、Gist同期はindex.jsが一元管理）
     * @param {number} botIndex - Bot番号 (1〜5)
     * @param {object} patch - 更新データ
     */
    updateBot(botIndex, patch) {
        if (!this.bots.has(botIndex)) return;
        const current = this.bots.get(botIndex);
        const updated = {
            ...current,
            ...patch,
            last_updated: new Date().toISOString()
        };
        this.bots.set(botIndex, updated);
    }

    /**
     * 現在の自リージョンの全Botステータスオブジェクトを取得
     * @returns {object}
     */
    getStatusData() {
        const botList = [];
        let onlineCount = 0;
        let totalServers = 0;

        for (let i = 1; i <= this.totalBots; i++) {
            const bot = this.bots.get(i);
            botList.push(bot);
            if (bot.online) {
                onlineCount++;
            }
            totalServers += (bot.server_count || 0);
        }

        return {
            updated_at: new Date().toISOString(),
            total_bots: this.totalBots,
            online_bots: onlineCount,
            total_servers: totalServers,
            region: this.region,
            bots: botList
        };
    }

    /**
     * status.json をローカルに保存
     * @param {object} data
     */
    saveLocalStatus(data) {
        try {
            fs.writeFileSync(this.statusFilePath, JSON.stringify(data, null, 2), 'utf8');
        } catch (e) {
            console.error('[StatusManager] status.json の保存に失敗しました:', e.message);
        }
    }

    /**
     * Gist へ status.json をアップロード（既存のリージョン情報を保持してマージ更新）
     * @param {object} myRegionData
     */
    async uploadToGist(myRegionData, force = false) {
        if (!this.githubToken) {
            console.warn('[StatusManager] GITHUB_TOKEN が設定されていないため、Gistへのアップロードをスキップします');
            return;
        }

        // 差分チェック: 前回アップロードデータから変化がなければ外部API通信をスキップ
        if (!force && !this.hasDataChanged(myRegionData)) {
            // ローカルファイルのみ念のため更新
            const localData = { ...myRegionData };
            this.saveLocalStatus({ [this.region || 'jp']: localData, updated_at: new Date().toISOString() });
            return;
        }

        const url = `https://api.github.com/gists/${this.gistId}`;
        const myRegion = this.region || 'jp';

        let mergedStatus = {};

        // 1. 既存のGistデータを取得（GET）
        try {
            const getRes = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.githubToken}`,
                    'Accept': 'application/vnd.github+json',
                    'User-Agent': 'MCBE-ProxVC-StatusManager'
                }
            });

            if (getRes.ok) {
                const gistData = await getRes.json();
                const rawContent = gistData.files && gistData.files['status.json'] ? gistData.files['status.json'].content : null;
                if (rawContent) {
                    const parsed = JSON.parse(rawContent);
                    if (parsed && typeof parsed === 'object') {
                        mergedStatus = parsed;
                    }
                }
            } else {
                console.warn(`[StatusManager] 既存Gist取得レスポンス (${getRes.status})`);
            }
        } catch (e) {
            console.warn('[StatusManager] 既存Gistの取得エラー (新規形式でマージします):', e.message);
        }

        // 古いフラット形式（botsプロパティが直下にある場合）のマイグレーション
        if (mergedStatus.bots && !mergedStatus[myRegion]) {
            const oldRegion = (mergedStatus.region || 'jp').toLowerCase();
            mergedStatus[oldRegion] = { ...mergedStatus };
            delete mergedStatus.bots;
            delete mergedStatus.online_bots;
            delete mergedStatus.total_servers;
            delete mergedStatus.total_bots;
            delete mergedStatus.region;
        }

        // 2. 自分のリージョンデータをマージ
        mergedStatus[myRegion] = myRegionData;
        mergedStatus.updated_at = new Date().toISOString();

        // ローカルの status.json にも全体状態を反映
        this.saveLocalStatus(mergedStatus);

        // 3. マージしたデータでGistを更新（PATCH）
        const content = JSON.stringify(mergedStatus, null, 2);

        try {
            const res = await fetch(url, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${this.githubToken}`,
                    'Accept': 'application/vnd.github+json',
                    'User-Agent': 'MCBE-ProxVC-StatusManager',
                    'X-GitHub-Api-Version': '2022-11-28',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    description: 'mcbe proxvc discord bot status',
                    files: {
                        'status.json': {
                            content: content
                        }
                    }
                })
            });

            if (res.ok) {
                this.lastUploadedData = JSON.parse(JSON.stringify(myRegionData));
                const activeRegions = Object.keys(mergedStatus).filter(k => k !== 'updated_at');
                console.log(`\x1b[32m[StatusManager]\x1b[0m status.json を Gist (${this.gistId}) に同期しました (Region: ${myRegion}, Active Regions: [${activeRegions.join(', ')}])`);
            } else {
                const errText = await res.text();
                console.error(`[StatusManager] Gist アップロードエラー (${res.status}):`, errText);
            }
        } catch (e) {
            console.error('[StatusManager] Gist 通信エラー:', e.message);
        }
    }

    /**
     * デバウンス付き同期要求
     */
    requestSync() {
        if (this.syncTimeout) {
            clearTimeout(this.syncTimeout);
        }
        const now = Date.now();
        const delay = Math.max(0, this.minSyncIntervalMs - (now - this.lastSyncTime));

        this.syncTimeout = setTimeout(() => {
            this.syncStatus();
        }, delay);
    }

    /**
     * 同期実行（ローカル保存＋Gistアップロード）
     * @param {boolean} [force=false] - 差分がなくても強制的にアップロードするかどうか
     */
    async syncStatus(force = false) {
        if (this.isSyncing) return;
        this.isSyncing = true;
        this.lastSyncTime = Date.now();

        try {
            const data = this.getStatusData();
            await this.uploadToGist(data, force);
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * 終了時のクリーンアップ
     */
    destroy() {
        if (this.periodicInterval) {
            clearInterval(this.periodicInterval);
        }
        if (this.syncTimeout) {
            clearTimeout(this.syncTimeout);
        }
    }
}

module.exports = { StatusManager, DEFAULT_GIST_ID, MAX_SERVERS_PER_BOT };
