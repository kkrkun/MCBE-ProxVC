/**
 * Guild Settings Manager
 * ギルドごとの設定をJSONファイルで永続化するモジュール
 */
const fs = require('fs');
const path = require('path');

const GUILD_DATA_DIR = path.join(__dirname, 'guild_data');

// デフォルト設定
const DEFAULT_SETTINGS = {
    lang: undefined,
    perm_start: [],
    perm_admin: [],
};

// キャッシュ
const settingsCache = new Map();

/**
 * guild_data ディレクトリが存在しなければ作成
 */
function ensureDir() {
    if (!fs.existsSync(GUILD_DATA_DIR)) {
        fs.mkdirSync(GUILD_DATA_DIR, { recursive: true });
    }
}

/**
 * ギルド設定ファイルのパスを返す
 */
function getFilePath(guildId) {
    return path.join(GUILD_DATA_DIR, `${guildId}.json`);
}

/**
 * ギルドの設定を取得（キャッシュ優先）
 * @param {string} guildId 
 * @returns {object}
 */
function getGuildSettings(guildId) {
    if (settingsCache.has(guildId)) {
        const cached = settingsCache.get(guildId);
        if (typeof cached.perm_start === 'string') cached.perm_start = [cached.perm_start];
        if (typeof cached.perm_admin === 'string') cached.perm_admin = [cached.perm_admin];
        return { ...DEFAULT_SETTINGS, ...cached };
    }

    ensureDir();
    const filePath = getFilePath(guildId);

    try {
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (data) {
                if (typeof data.perm_start === 'string') data.perm_start = [data.perm_start];
                if (typeof data.perm_admin === 'string') data.perm_admin = [data.perm_admin];
            }
            settingsCache.set(guildId, data);
            return { ...DEFAULT_SETTINGS, ...data };
        }
    } catch (e) {
        console.error(`[GuildSettings] Error reading ${guildId}:`, e.message);
    }

    return { ...DEFAULT_SETTINGS };
}

/**
 * ギルドの設定を更新
 * @param {string} guildId 
 * @param {string} key 
 * @param {*} value 
 */
function updateGuildSetting(guildId, key, value) {
    ensureDir();
    const current = getGuildSettings(guildId);
    current[key] = value;

    // DEFAULT_SETTINGS に含まれるキーのみ保存
    const toSave = {};
    for (const k of Object.keys(DEFAULT_SETTINGS)) {
        if (current[k] !== undefined) toSave[k] = current[k];
    }

    settingsCache.set(guildId, toSave);

    try {
        fs.writeFileSync(getFilePath(guildId), JSON.stringify(toSave, null, 2), 'utf8');
    } catch (e) {
        console.error(`[GuildSettings] Error writing ${guildId}:`, e.message);
    }
}

module.exports = { getGuildSettings, updateGuildSetting };
