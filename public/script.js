// ============================================================
// STATE
// ============================================================
var _state = {
  lang: 'en',
  proximity: true,
  spectator: true,
  specListen: true,
  specDim: false,
  verify: false,
  output: true,
  distance: 10,
  sub_domain: '',
  app_id: '',
  secret_key: '',
  username: '',
  ssh_password: '',
  sessionId: null,
  roomId: null,
  connectCommand: null,
  useRelay: true, // デフォルトはリレー利用扱い
  polling: null,
};

var _hasTcpExposer = false;
var _configLoaded = false; // config.jsonが存在するか (個人用モード判定)

var API_BASE = location.origin;
var TRANSLATIONS = {};

// ============================================================
// TRANSLATION
// ============================================================
function t(key) {
  return TRANSLATIONS[key] || key;
}

function applyTranslations() {
  if (document.documentElement) document.documentElement.lang = _state.lang || 'en';
  Object.keys(TRANSLATIONS).forEach(function (k) {
    var el = document.getElementById('t-' + k);
    if (el) el.textContent = TRANSLATIONS[k];
  });
  ['prox-col', 'pass-col', 'dis-col', 'spec-col', 'output-col', 'specListen-col', 'specDim-col'].forEach(function (k) {
    var icon = document.getElementById('desc-' + k);
    if (icon) {
      icon.dataset.tooltip = TRANSLATIONS['desc-' + k] || '';
      icon.removeAttribute('title');
    }
  });
  var ls = document.getElementById('lang-select');
  if (ls) ls.value = _state.lang;
  var ci = document.getElementById('chat-input');
  if (ci) ci.placeholder = TRANSLATIONS['chat-placeholder'] || '';
  var gk = document.getElementById('gemini-api-key');
  if (gk) gk.placeholder = TRANSLATIONS['api-key-label'] || 'Gemini API Key';
  var mcconn = document.getElementById('t-mc-connect');
  if (mcconn) mcconn.textContent = TRANSLATIONS['mc-connect'] || 'Connect from Minecraft';
  var vcconn = document.getElementById('t-vc-url');
  if (vcconn) vcconn.textContent = TRANSLATIONS['vc-url'] || 'Participants URL';
  var olen = document.getElementById('t-open-link');
  if (olen) olen.textContent = TRANSLATIONS['open-link'] || 'Open in browser';
  var mcalways = document.getElementById('t-mc-always-connect');
  if (mcalways) mcalways.textContent = TRANSLATIONS['mc-always-connect'] || 'Connect from Minecraft (Persistent)';
}

function fetchTranslations(lang) {
  var target = lang || 'en';
  // /public/locales フォルダ内に該当ファイルがあるかチェックして取得
  return fetch('/locales/' + encodeURIComponent(target) + '.json')
    .then(function (res) {
      if (!res.ok) throw new Error('Locale file not found');
      return res.json();
    })
    .catch(function () {
      return apiGet('/locales/' + encodeURIComponent(target)).then(function (data) {
        if (!data || Object.keys(data).length === 0) throw new Error('Empty locale data');
        return data;
      });
    })
    .then(function (data) {
      _state.lang = target;
      TRANSLATIONS = data;
      applyTranslations();
      return data;
    })
    .catch(function () {
      // /public/locales内にファイルが無ければ英語(en)にフォールバック
      if (target !== 'en') {
        return fetchTranslations('en');
      }
    });
}

// ============================================================
// LANGUAGE DETECTION
// ============================================================
function detectLang() {
  var langs = [];
  if (navigator.languages && navigator.languages.length) {
    langs = navigator.languages;
  } else if (navigator.language) {
    langs = [navigator.language];
  } else if (navigator.userLanguage) {
    langs = [navigator.userLanguage];
  }

  for (var i = 0; i < langs.length; i++) {
    var raw = (langs[i] || '').toLowerCase().trim();
    if (!raw) continue;

    // 日本語
    if (raw === 'ja' || raw.indexOf('ja-') === 0 || raw.indexOf('ja_') === 0) {
      return 'ja';
    }

    // 簡体字中国語 (zhで始まり、繁体字tw/hk/mo/hantではないもの)
    if (raw === 'zh' || raw.indexOf('zh-') === 0 || raw.indexOf('zh_') === 0) {
      var isTraditional = raw.indexOf('tw') !== -1 ||
                          raw.indexOf('hk') !== -1 ||
                          raw.indexOf('mo') !== -1 ||
                          raw.indexOf('hant') !== -1;
      if (!isTraditional) {
        return 'zh';
      }
      // 繁体字は簡体字ではないためスキップ
    }
  }

  // 日本語、簡体字、それ以外は英語
  return 'en';
}

// ============================================================
// LOCALSTORAGE
// ============================================================
var LS_SETTINGS = 'prox_settings_v2';
var LS_SESSION = 'prox_session_v1';

function saveSettings() {
  var keys = ['lang', 'proximity', 'spectator', 'specListen', 'specDim', 'verify', 'output', 'distance', 'sub_domain', 'app_id', 'secret_key', 'username', 'ssh_password'];
  var obj = {};
  keys.forEach(function (k) { obj[k] = _state[k]; });
  localStorage.setItem(LS_SETTINGS, JSON.stringify(obj));
}

function loadSettings() {
  try {
    var s = JSON.parse(localStorage.getItem(LS_SETTINGS) || 'null');
    if (s) Object.keys(s).forEach(function (k) { if (k in _state) _state[k] = s[k]; });
  } catch (e) { }
}

function saveSession(data) { localStorage.setItem(LS_SESSION, JSON.stringify(data)); }
function clearSession() { localStorage.removeItem(LS_SESSION); }
function loadSavedSession() {
  try { return JSON.parse(localStorage.getItem(LS_SESSION) || 'null'); } catch (e) { return null; }
}

// ============================================================
// UI SYNC
// ============================================================
function syncUI() {
  ['proximity', 'spectator', 'specListen', 'specDim', 'verify', 'output'].forEach(function (k) {
    var btn = document.getElementById('toggle-' + k);
    if (!btn) return;
    if (_state[k]) btn.classList.add('on'); else btn.classList.remove('on');
  });
  var dEl = document.getElementById('input-distance'); if (dEl) dEl.value = parseFloat(_state.distance).toFixed(2);
  var sdEl = document.getElementById('input-sub-domain'); if (sdEl) sdEl.value = _state.sub_domain || '';
  var aiEl = document.getElementById('input-app-id'); if (aiEl) aiEl.value = _state.app_id || '';
  var skEl = document.getElementById('input-secret-key'); if (skEl) skEl.value = _state.secret_key || '';
  var usEl = document.getElementById('input-username'); if (usEl) usEl.value = _state.username || '';
  var spEl = document.getElementById('input-ssh-password'); if (spEl) spEl.value = _state.ssh_password || '';

  var slEl = document.getElementById('toggle-specListen');
  var sdBt = document.getElementById('toggle-specDim');
  var soEl = document.getElementById('spec-options');
  if (slEl) slEl.disabled = !_state.spectator;
  if (sdBt) sdBt.disabled = !_state.spectator;
  if (soEl) soEl.style.opacity = _state.spectator ? '1' : '0.4';

  applyTranslations();
}

// ============================================================
// GLOBAL HANDLERS
// ============================================================
function switchTab(tab) {
  document.getElementById('panel-server').style.display = tab === 'server' ? '' : 'none';
  document.getElementById('panel-ai').style.display = tab === 'ai' ? '' : 'none';
  document.getElementById('tab-server').className = 'tab-btn' + (tab === 'server' ? ' active' : '');
  document.getElementById('tab-ai').className = 'tab-btn' + (tab === 'ai' ? ' active' : '');
}

var _notifyTimer = null;
function notifyServerOfConfigUpdate() {
  if (_state.sessionId) {
    if (_notifyTimer) clearTimeout(_notifyTimer);
    _notifyTimer = setTimeout(function () {
      var payload = getConfigFromUI();
      payload.type = 'data_update';
      payload.sessionId = _state.sessionId;
      apiPost('/', payload).catch(function () { });
    }, 500);
  }
}

function toggleSetting(key) {
  _state[key] = !_state[key];
  saveSettings();
  syncUI();
  notifyServerOfConfigUpdate();
}

function changeDistance(delta) {
  var el = document.getElementById('input-distance');
  var val = parseFloat(el.value) || 0;
  var newVal = Math.max(0, val + delta);
  _state.distance = parseFloat(newVal.toFixed(2));
  el.value = _state.distance.toFixed(2);
  saveSettings();
  notifyServerOfConfigUpdate();
}

function updateDistanceInput() {
  var el = document.getElementById('input-distance');
  var val = parseFloat(el.value) || 0;
  var newVal = Math.max(0, val);
  _state.distance = parseFloat(newVal.toFixed(2));
  el.value = _state.distance.toFixed(2);
  saveSettings();
  notifyServerOfConfigUpdate();
}

function changeLang(val) {
  _state.lang = val;
  saveSettings();
  fetchTranslations(val);
  notifyServerOfConfigUpdate();
}

function copyText(id) {
  var el = document.getElementById(id);
  var text = '';
  for (var i = 0; i < el.childNodes.length; i++) {
    if (el.childNodes[i].nodeType === 3) text += el.childNodes[i].textContent;
  }
  text = text.trim();
  navigator.clipboard.writeText(text).then(function () { showFlash(t('copied'), 'success'); });
}

// ============================================================
// FLASH MESSAGE
// ============================================================
function showFlash(msg, type) {
  var el = document.getElementById('flash-msg');
  el.textContent = msg;
  el.style.display = 'block';
  var colors = {
    success: { bg: 'rgba(22,101,52,.3)', border: 'rgba(74,222,128,.3)', color: '#4ade80' },
    error: { bg: 'rgba(127,29,29,.3)', border: 'rgba(248,113,113,.3)', color: '#f87171' },
    warning: { bg: 'rgba(120,53,15,.3)', border: 'rgba(251,191,36,.3)', color: '#fbbf24' },
    info: { bg: 'rgba(30,64,175,.2)', border: 'rgba(147,197,253,.2)', color: '#93c5fd' },
  };
  var c = colors[type] || colors.info;
  el.style.background = c.bg;
  el.style.border = '1px solid ' + c.border;
  el.style.color = c.color;
  setTimeout(function () { el.style.display = 'none'; }, 4000);
}

// ============================================================
// API
// ============================================================
function apiPost(path, body) {
  return fetch(API_BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(function (r) { return r.json(); });
}
function apiGet(path) {
  return fetch(API_BASE + path).then(function (r) { return r.json(); });
}

// ============================================================
// SESSION STATE
// ============================================================
function setActive(roomId, connectCommand, useRelay) {
  _state.roomId = roomId;
  _state.connectCommand = connectCommand;
  if (useRelay !== undefined) _state.useRelay = useRelay;

  document.getElementById('start-section').style.display = 'none';
  document.getElementById('stop-section').style.display = 'block';
  document.getElementById('session-panel').style.display = 'block';

  var icon = document.getElementById('status-icon');
  icon.style.color = '#22c55e';
  var badge = document.getElementById('status-badge');
  badge.className = 'status-badge status-active';
  badge.textContent = 'ACTIVE';
  document.getElementById('t-status-label').textContent = 'ACTIVE';
  document.getElementById('status-sub').textContent = roomId || '--';

  if (roomId) {
    var vcUrl = 'https://mcproxvc.ovh/connect/?roomid=' + roomId;

    document.getElementById('room-id-section').style.display = 'block';
    var ridEl = document.getElementById('room-id-display');
    ridEl.innerHTML = roomId + '<button class="copy-btn" onclick="copyText(\'room-id-display\')" title="Copy"><i class="fa-solid fa-copy"></i></button>';

    if (connectCommand) {
      document.getElementById('cmd-section').style.display = 'block';
      var cmdEl = document.getElementById('cmd-display');
      cmdEl.innerHTML = connectCommand + '<button class="copy-btn" onclick="copyText(\'cmd-display\')" title="Copy"><i class="fa-solid fa-copy"></i></button>';
    }

    // ★ 判定方法を変更:
    // connectCommand または サーバーログ出力内容に "tcpexposer.com" が含まれている場合のみ、常時接続コマンドを表示
    var alwaysCmdSection = document.getElementById('cmd-always-section');
    var alwaysCmdEl = document.getElementById('cmd-always-display');
    var targetSubdomain = _state.sub_domain || roomId;

    var isTcpExposer = connectCommand && connectCommand.indexOf('tcpexposer.com') !== -1;

    if (isTcpExposer && alwaysCmdSection && alwaysCmdEl && targetSubdomain) {
      var alwaysConnectCmd = '/pvc:connect "' + targetSubdomain + '.tcpexposer.com"';
      alwaysCmdEl.innerHTML = alwaysConnectCmd + '<button class="copy-btn" onclick="copyText(\'cmd-always-display\')" title="Copy"><i class="fa-solid fa-copy"></i></button>';
      alwaysCmdSection.style.display = 'block';
    } else if (alwaysCmdSection) {
      alwaysCmdSection.style.display = 'none';
    }

    document.getElementById('vc-url-section').style.display = 'block';
    var vuEl = document.getElementById('vc-url-display');
    vuEl.innerHTML = vcUrl + '<button class="copy-btn" onclick="copyText(\'vc-url-display\')" title="Copy"><i class="fa-solid fa-copy"></i></button>';
    document.getElementById('vc-url-link').href = vcUrl;
  }
}

function setIdle(msg, type) {
  _state.sessionId = null;
  _state.roomId = null;
  _state.connectCommand = null;
  _state.useRelay = true;
  clearSession();
  stopPolling();

  document.getElementById('start-section').style.display = 'block';
  document.getElementById('stop-section').style.display = 'none';
  document.getElementById('session-panel').style.display = 'none';
  document.getElementById('room-id-section').style.display = 'none';
  document.getElementById('cmd-section').style.display = 'none';
  var alwaysCmdSection = document.getElementById('cmd-always-section');
  if (alwaysCmdSection) alwaysCmdSection.style.display = 'none';
  document.getElementById('vc-url-section').style.display = 'none';

  document.getElementById('status-icon').style.color = '#374151';
  var badge = document.getElementById('status-badge');
  badge.className = 'status-badge status-idle';
  badge.textContent = 'IDLE';
  document.getElementById('t-status-label').textContent = t('status-label');
  document.getElementById('status-sub').textContent = '--';

  var btnStart = document.getElementById('btn-start');
  if (btnStart) {
    btnStart.disabled = false;
    btnStart.innerHTML = '<i class="fa-solid fa-play"></i> ' + t('start');
  }

  if (msg) showFlash(msg, type || 'info');
}

// ============================================================
// SESSION START / STOP
// ============================================================
function getConfigFromUI() {
  _state.distance = parseFloat(document.getElementById('input-distance').value) || 10;
  _state.sub_domain = document.getElementById('input-sub-domain').value.trim();
  _state.app_id = document.getElementById('input-app-id').value.trim();
  _state.secret_key = document.getElementById('input-secret-key').value.trim();
  _state.username = document.getElementById('input-username').value.trim();
  _state.ssh_password = document.getElementById('input-ssh-password').value.trim();
  return {
    proximity: _state.proximity, spectator: _state.spectator,
    specListen: _state.specListen, specDim: _state.specDim,
    verify: _state.verify, password: _state.verify,
    output: _state.output, distance: _state.distance, lang: _state.lang,
    sub_domain: _state.sub_domain, app_id: _state.app_id,
    secret_key: _state.secret_key, username: _state.username,
    ssh_password: _state.ssh_password,
  };
}

function startSession() {
  var btn = document.getElementById('btn-start');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> ' + t('starting');
  saveSettings();

  var uiConfig = getConfigFromUI();

  // 個人用モード (config.jsonあり) の場合、セッション開始前にconfig.jsonへ書き戻す
  var savePromise = _configLoaded
    ? apiPost('/api/save_config', uiConfig).catch(function () { })
    : Promise.resolve();

  savePromise.then(function () {
    apiPost('/api/start_session', { config: uiConfig })
      .then(function (data) {
        if (data.sessionId) {
          _state.sessionId = data.sessionId;

          // ★ 開始時点では結果が確定していないため useRelay = undefined（または true）で表示を保留
          // 直後の pollStatus (3秒毎のポーリング) でサーバーの実際の接続状態(useRelay: false/true)を取得して反映します
          _state.useRelay = undefined;

          setActive(data.roomId, data.connectCommand, undefined);
          saveSession({ session_id: data.sessionId, room_id: data.roomId, cmd: data.connectCommand });

          // 即時ポーリングを実行して実際の useRelay 状態を取得
          startPolling();
          pollStatus();
        } else {
          showFlash(t('start-failed') + (data.error || 'unknown'), 'error');
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-play"></i> ' + t('start');
        }
      })
      .catch(function (e) {
        showFlash(t('ai-error') + e.message, 'error');
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-play"></i> ' + t('start');
      });
  }); // end savePromise.then
}

function stopSession() {
  var btn = document.getElementById('btn-stop');
  btn.disabled = true;
  apiPost('/api/stop_session', { sessionId: _state.sessionId })
    .catch(function () { })
    .then(function () {
      setIdle(t('stopped'), 'success');
      btn.disabled = false;
    });
}

// ============================================================
// POLLING
// ============================================================
function startPolling() {
  stopPolling();
  _state.polling = setInterval(pollStatus, 3000);
}
function stopPolling() {
  if (_state.polling) { clearInterval(_state.polling); _state.polling = null; }
}
function pollStatus() {
  if (!_state.sessionId) return;
  apiGet('/api/session_status/' + _state.sessionId)
    .then(function (data) {
      if (data.status === 'active') {
        // ★ ポーリング時にサーバー側の useRelay 状態を取得してUIへ適用
        if (data.useRelay !== undefined && _state.useRelay !== data.useRelay) {
          _state.useRelay = data.useRelay;
          setActive(_state.roomId, _state.connectCommand, data.useRelay);
        }

        if (data.config) {
          var changed = false;
          ['proximity', 'spectator', 'specListen', 'specDim', 'verify', 'output', 'distance', 'lang'].forEach(function (k) {
            var serverVal = k === 'verify' && data.config.password !== undefined ? data.config.password : data.config[k];
            if (serverVal !== undefined && _state[k] !== serverVal) {
              _state[k] = serverVal;
              changed = true;
            }
          });
          if (changed) {
            saveSettings();
            syncUI();
          }
        }
        return;
      }
      var reason = data.reason || '';
      var msg = t('session-ended');
      var type = 'info';
      if (reason.indexOf('timeout') !== -1 || reason.indexOf('maxRuntime') !== -1) { msg = t('session-timed-out'); type = 'warning'; }
      else if (reason.indexOf('success') !== -1) { msg = t('session-ended'); type = 'success'; }
      else if (reason.indexOf('disconnect') !== -1) { msg = t('disconnected'); type = 'warning'; }
      else if (data.status === 'not_found') { msg = t('session-not-found'); type = 'warning'; }
      setIdle(msg, type);
    })
    .catch(function () { });
}

// ============================================================
// RESTORE SESSION
// ============================================================
function tryRestoreSession() {
  var saved = loadSavedSession();
  if (!saved || !saved.session_id) return;
  apiGet('/api/session_status/' + saved.session_id)
    .then(function (data) {
      if (data.status === 'active') {
        _state.sessionId = saved.session_id;
        setActive(saved.room_id, saved.cmd, data.useRelay);
        startPolling();
        showFlash(t('restored'), 'success');
      } else {
        clearSession();
      }
    })
    .catch(function () { clearSession(); });
}

// ... 後略 (CONFIG UPLOAD/DOWNLOAD, AI SUPPORT, INIT は変更なし) ...

// ============================================================
// CONFIG UPLOAD / DOWNLOAD
// ============================================================
function handleConfigUpload(event) {
  var file = event.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function (e) {
    try {
      var text = e.target.result;
      // Strip // and /* */ comments for JSONC support
      text = text.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      var cfg = JSON.parse(text);
      var keyMap = {
        verify: 'verify', password: 'verify', proximity: 'proximity', spectator: 'spectator',
        specListen: 'specListen', specDim: 'specDim', output: 'output', distance: 'distance',
        sub_domain: 'sub_domain', app_id: 'app_id', secret_key: 'secret_key',
        username: 'username', ssh_password: 'ssh_password', lang: 'lang'
      };
      Object.keys(keyMap).forEach(function (src) {
        if (cfg[src] !== undefined) _state[keyMap[src]] = cfg[src];
      });
      if (cfg.lang) {
        _state.lang = cfg.lang;
        fetchTranslations(cfg.lang).then(function () {
          syncUI();
        });
      } else {
        syncUI();
      }
      saveSettings();
      showFlash(t('config-loaded'), 'success');
      notifyServerOfConfigUpdate();
    } catch (err) {
      showFlash('Parse error: ' + err.message, 'error');
    }
    event.target.value = '';
  };
  reader.readAsText(file);
}

function downloadConfig() {
  _state.distance = parseFloat(document.getElementById('input-distance').value) || 10;
  _state.sub_domain = document.getElementById('input-sub-domain').value.trim();
  _state.app_id = document.getElementById('input-app-id').value.trim();
  _state.secret_key = document.getElementById('input-secret-key').value.trim();
  _state.username = document.getElementById('input-username').value.trim();
  _state.ssh_password = document.getElementById('input-ssh-password').value.trim();
  var cfg = {
    app_id: _state.app_id, secret_key: _state.secret_key,
    username: _state.username, sub_domain: _state.sub_domain,
    ssh_password: _state.ssh_password, port: 19132, web_port: 8000,
    proximity: _state.proximity, spectator: _state.spectator,
    specListen: _state.specListen, specDim: _state.specDim,
    verify: _state.verify, password: _state.verify,
    output: _state.output, distance: _state.distance, lang: _state.lang,
  };
  var blob = new Blob([JSON.stringify(cfg, null, 4)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'config.json';
  a.click();
}

// ============================================================
// AI SUPPORT
// ============================================================
var chatHistory = [];
var _wikiCache = {};

function fetchWikiDoc(lang) {
  var file = (lang === 'ja') ? '/md/wiki_full.md' : '/md/wiki_full_en.md';
  if (_wikiCache[file]) {
    return Promise.resolve(_wikiCache[file]);
  }
  return fetch(file)
    .then(function (r) {
      if (!r.ok) throw new Error('Failed to load wiki doc');
      return r.text();
    })
    .then(function (text) {
      _wikiCache[file] = text;
      return text;
    })
    .catch(function () {
      return '';
    });
}

function sendChat() {
  var input = document.getElementById('chat-input');
  var msg = input.value.trim();
  if (!msg) return;

  var apiKey = document.getElementById('gemini-api-key').value.trim();
  if (!apiKey) { showFlash(t('enter-api-key'), 'warning'); return; }

  localStorage.setItem('gemini_api_key', apiKey);
  input.value = '';

  addChatMsg(msg, 'user');
  chatHistory.push({ role: 'user', parts: [{ text: msg }] });

  var ph = document.getElementById('chat-placeholder');
  if (ph) ph.remove();

  var typingId = 'typing-' + Date.now();
  addChatMsg('<span class="spinner"></span>', 'ai', typingId);

  var lang = _state.lang || 'en';
  fetchWikiDoc(lang).then(function (wikiDoc) {
    var sysPrompt = 'You are the AI support assistant for MCBE ProxVC, a proximity voice chat tool for Minecraft Bedrock Edition. Answer questions about setup, configuration, commands, and troubleshooting based on the provided official documentation. Respond in the same language the user uses.';
    if (wikiDoc) {
      sysPrompt += '\n\n[OFFICIAL DOCUMENTATION]\n' + wikiDoc;
    }

    var body = {
      contents: chatHistory.slice(-10),
      system_instruction: { parts: [{ text: sysPrompt }] },
      generationConfig: { temperature: 0.4, maxOutputTokens: 2048 }
    };

    var models = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
    var attempt = 0;

    function tryModel() {
      if (attempt >= models.length) {
        var tel = document.getElementById(typingId); if (tel) tel.remove();
        addChatMsg(t('ai-no-response'), 'ai');
        return;
      }
      var model = models[attempt++];
      fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
        .then(function (r) { return r.json(); })
        .then(function (resp) {
          if (resp.error) {
            var c = resp.error.code;
            if (c === 429 || c === 503) { tryModel(); return; }
            throw new Error(resp.error.message);
          }
          var tel = document.getElementById(typingId); if (tel) tel.remove();
          if (resp.candidates && resp.candidates[0]) {
            var text = resp.candidates[0].content.parts[0].text;
            chatHistory.push({ role: 'model', parts: [{ text: text }] });
            addChatMsg(formatMarkdown(text), 'ai');
          } else {
            addChatMsg(t('ai-no-response'), 'ai');
          }
        })
        .catch(function (e) {
          tryModel();
        });
    }
    tryModel();
  });
}

function addChatMsg(html, role, id) {
  var area = document.getElementById('chat-area');
  var div = document.createElement('div');
  div.className = 'chat-msg chat-' + role;
  if (id) div.id = id;
  div.innerHTML = html;
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
}

function formatMarkdown(text) {
  if (typeof marked !== 'undefined' && typeof marked.parse === 'function') {
    return marked.parse(text);
  }
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\`\`\`[\w]*\n([\s\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>')
    .replace(/\`([^\`]+)\`/g, '<code style="background:#0f172a;padding:0 3px;border-radius:3px;font-family:monospace">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');
}

// ============================================================
// INIT
// ============================================================
(function init() {
  // ============================================================
  // 設定の読み込み優先順位:
  //   config.json あり (個人用) → サーバー設定で全項目を上書き (localStorageは無視)
  //   config.json なし (サーバー用) → localStorageがあればそれを使用、なければデフォルト
  // ============================================================

  // 1. Detect language (browser pref: ja -> ja, simplified zh -> zh, other -> en)
  // サイトアクセス時にユーザーの言語に応じて自動判定し、即座に翻訳ファイルを取得
  _state.lang = detectLang();
  fetchTranslations(_state.lang);

  // 2. Load server config, then decide how to initialize state
  apiGet('/api/config').then(function (cfg) {
    if (!cfg) {
      // APIが失敗した場合はlocalStorageにフォールバック
      loadSettings();
      _state.lang = detectLang();
      fetchTranslations(_state.lang).then(function () { syncUI(); });
      return;
    }

    // configLoadedフラグをグローバルにキャッシュ
    _configLoaded = !!cfg.configLoaded;

    if (cfg.configLoaded) {
      // ── 個人用モード: config.json あり ──
      // config.json の値でstateを全上書き (localStorageは参照しない)
      var cfgKeys = ['proximity', 'spectator', 'specListen', 'specDim', 'output', 'distance'];
      cfgKeys.forEach(function (k) {
        if (cfg[k] !== undefined) _state[k] = cfg[k];
      });
      _state.verify = cfg.verify !== undefined ? cfg.verify : false;
      _state.sub_domain = cfg.sub_domain || '';
      _state.app_id = cfg.app_id || '';
      _state.secret_key = cfg.secret_key || '';
      _state.username = cfg.username || '';
      _state.ssh_password = cfg.ssh_password || '';
    } else {
      // ── サーバー用モード: config.json なし ──
      // localStorageがあればそれを使用、なければデフォルトのまま
      loadSettings();
      // サーバーから認証情報のみ補完 (localStorageに値がない場合のみ)
      if (!_state.sub_domain && cfg.sub_domain) _state.sub_domain = cfg.sub_domain;
      if (!_state.app_id && cfg.app_id) _state.app_id = cfg.app_id;
      if (!_state.secret_key && cfg.secret_key) _state.secret_key = cfg.secret_key;
      if (!_state.username && cfg.username) _state.username = cfg.username;
      if (!_state.ssh_password && cfg.ssh_password) _state.ssh_password = cfg.ssh_password;
    }

    // アクセス時はユーザーのブラウザ言語に応じた言語を優先設定
    _state.lang = detectLang();

    // Gemini APIキー (config.jsonで設定されていれば入力欄を非表示)
    if (cfg.gemini_api_key) {
      var keyInput = document.getElementById('gemini-api-key');
      if (keyInput) {
        keyInput.value = cfg.gemini_api_key;
        if (keyInput.parentElement) keyInput.parentElement.style.display = 'none';
      }
    }

    // tcpexposerの有無を判定
    _hasTcpExposer = !!cfg.tcpExposerExists;
    if (_hasTcpExposer) {
      var usernameCol = document.getElementById('container-username-col');
      var sshCol = document.getElementById('container-ssh-col');
      if (usernameCol) usernameCol.style.display = 'block';
      if (sshCol) sshCol.style.display = 'block';
    }

    // 言語に合わせた翻訳を取得してUI同期
    fetchTranslations(_state.lang).then(function () { syncUI(); });
  }).catch(function () {
    // APIエラー時はlocalStorageにフォールバック
    loadSettings();
    fetchTranslations(_state.lang).then(function () { syncUI(); });
  });

  // 3. Restore Gemini key from localStorage (config.jsonで非表示にする前に適用)
  var savedKey = localStorage.getItem('gemini_api_key');
  if (savedKey) document.getElementById('gemini-api-key').value = savedKey;

  // 4. Try to restore active session
  tryRestoreSession();

  // 5. Setup tab visibility & focus listeners to check status immediately when user returns
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && _state.sessionId) {
      pollStatus();
    }
  });
  window.addEventListener('focus', function () {
    if (_state.sessionId) {
      pollStatus();
    }
  });

  // 7. Setup Custom Tooltip Event Listeners
  document.addEventListener('mouseover', function (e) {
    var target = e.target.closest('[data-tooltip]');
    if (target) {
      var tooltip = document.getElementById('custom-tooltip');
      if (!tooltip || !target.dataset.tooltip) return;
      tooltip.textContent = target.dataset.tooltip;
      tooltip.classList.add('visible');
    }
  });

  document.addEventListener('mousemove', function (e) {
    var target = e.target.closest('[data-tooltip]');
    if (target) {
      var tooltip = document.getElementById('custom-tooltip');
      if (!tooltip) return;
      var x = e.clientX + 15;
      var y = e.clientY + 15;
      var rect = tooltip.getBoundingClientRect();
      if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 10;
      if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 10;
      tooltip.style.left = x + 'px';
      tooltip.style.top = y + 'px';
    }
  });

  document.addEventListener('mouseout', function (e) {
    var target = e.target.closest('[data-tooltip]');
    if (target) {
      var tooltip = document.getElementById('custom-tooltip');
      if (tooltip) tooltip.classList.remove('visible');
    }
  });
})();