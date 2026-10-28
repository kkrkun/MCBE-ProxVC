/**
 * auth.js - MCBE ProxVC 認証APIモジュール
 * server/index.js の Express アプリに組み込んで使用する
 *
 * 使い方:
 *   const { setupAuthRoutes } = require('./auth');
 *   setupAuthRoutes(app, { webhookSecret: '...', botWebhookUrl: '...' });
 */

const crypto = require('crypto');
const { EventEmitter } = require('events');

const authEvents = new EventEmitter();

// ==================== 設定 ====================
const AUTH_CONFIG = {
    // トークン有効期限: 5分
    TOKEN_EXPIRE_MS: 5 * 60 * 1000,
    // 認証クールタイム: 1時間
    AUTH_COOLDOWN_MS: 60 * 60 * 1000,
    // Discord Bot の Webhook URL（認証完了通知先）
    BOT_WEBHOOK_URL: process.env.BOT_WEBHOOK_URL || 'http://localhost:8001/webhook/auth-complete',
    // Webhook Secret
    WEBHOOK_SECRET: process.env.WEBHOOK_SECRET || 'change_this_secret',
};

// ==================== ストレージ ====================
/**
 * pendingTokens: token -> { userId, guildId, channelId, roomId, expiresAt }
 * Discord Bot から登録されたトークンを管理
 */
const pendingTokens = new Map();

/**
 * 期限切れトークンのクリーンアップ（毎分実行）
 */
setInterval(() => {
    const now = Date.now();
    for (const [token, data] of pendingTokens.entries()) {
        if (data.expiresAt < now) {
            pendingTokens.delete(token);
        }
    }
}, 60 * 1000);

// ==================== ヘルパー ====================

function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

// ==================== ルート設定 ====================
/**
 * @param {object} app - Expressアプリ
 * @param {Function} [getAuthMod] - 常に最新のauthModuleを返すゲッター。
 *   Bot再起動後でも正しいpendingTokensを参照するために使用。
 *   指定されない場合はこのモジュールのpendingTokensを使用。
 */
function setupAuthRoutes(app, getAuthMod) {
    // 常に最新のauthモジュールのpendingTokensを取得するプロキシ関数
    const getPendingTokens = () => {
        if (typeof getAuthMod === 'function') {
            const mod = getAuthMod();
            if (mod && mod.pendingTokens) return mod.pendingTokens;
        }
        return pendingTokens;
    };
    /**
     * POST /api/auth/token
     * Discord Bot からトークン登録を受け付ける
     * Body: { token, userId, guildId, channelId, expiresAt, roomId }
     */
    app.post('/api/auth/token', (req, res) => {
        const secret = req.headers['x-webhook-secret'];
        if (secret !== AUTH_CONFIG.WEBHOOK_SECRET) {
            return res.status(403).json({ error: 'Forbidden' });
        }

        const { token, userId, guildId, channelId, expiresAt, roomId } = req.body;
        if (!token || !userId || !guildId || !channelId || !expiresAt) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        pendingTokens.set(token, { userId, guildId, channelId, roomId: roomId || 'default', expiresAt });
        console.log(`[Auth] トークン登録: user=${userId}, expires=${new Date(expiresAt).toISOString()}`);
        res.json({ success: true });
    });

    /**
     * GET /api/auth/verify?token=xxx
     * Webサイトからトークンの有効性を確認
     * Response: { valid: boolean, roomId?: string, userId?: string }
     */
    app.get('/api/auth/verify', (req, res) => {
        const { token } = req.query;
        if (!token) {
            return res.status(400).json({ valid: false, error: 'Token is required' });
        }

        const data = getPendingTokens().get(token);
        if (!data) {
            return res.json({ valid: false, error: 'Token not found' });
        }

        if (data.expiresAt < Date.now()) {
            getPendingTokens().delete(token);
            return res.json({ valid: false, error: 'Token expired' });
        }

        const remainingMs = data.expiresAt - Date.now();
        res.json({
            valid: true,
            roomId: data.roomId,
            remainingMs,
            remainingSec: Math.ceil(remainingMs / 1000),
        });
    });

    /**
     * POST /api/auth/complete
     * Webサイトから広告視聴完了の通知を受け取る
     * Body: { token }
     * → Discord Bot へ Webhook で通知
     */
    app.post('/api/auth/complete', async (req, res) => {
        const { token } = req.body;
        if (!token) {
            return res.status(400).json({ success: false, error: 'Token is required' });
        }

        const data = getPendingTokens().get(token);
        if (!data) {
            return res.status(404).json({ success: false, error: 'Token not found or already used' });
        }

        if (data.expiresAt < Date.now()) {
            getPendingTokens().delete(token);
            return res.status(410).json({ success: false, error: 'Token expired' });
        }

        const eventData = {
            ...data,
            token,
        };

        // トークンを無効化（1回限り使用可能）
        getPendingTokens().delete(token);

        console.log(`[Auth] 認証完了: user=${data.userId}, roomId=${data.roomId}`);

        // Discord Bot へイベント通知
        authEvents.emit('auth_complete', eventData);

        res.json({
            success: true,
            roomId: data.roomId,
            connectUrl: `/connect/?roomid=${encodeURIComponent(data.roomId)}`,
        });
    });

    /**
     * GET /api/auth/status
     * デバッグ用: 現在の有効トークン数を確認
     */
    app.get('/api/auth/status', (req, res) => {
        const secret = req.headers['x-webhook-secret'];
        if (secret !== AUTH_CONFIG.WEBHOOK_SECRET) {
            return res.status(403).json({ error: 'Forbidden' });
        }
        res.json({
            pendingTokenCount: pendingTokens.size,
            tokens: Array.from(pendingTokens.entries()).map(([t, d]) => ({
                tokenPrefix: t.substring(0, 8) + '...',
                userId: d.userId,
                expiresAt: new Date(d.expiresAt).toISOString(),
                valid: d.expiresAt > Date.now(),
            })),
        });
    });

    console.log('[Auth] 認証APIルートを設定しました');
}

module.exports = { setupAuthRoutes, pendingTokens, authEvents, generateToken, AUTH_CONFIG };
