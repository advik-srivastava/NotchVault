// NotchVault — main process
// Made by Crazified Studios · https://crazifiedstudios.com
const {
  app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell, session,
  desktopCapturer, globalShortcut, nativeTheme,
} = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { parseICS, expandEvents } = require('./calendar');

const APP_NAME = 'NotchVault';
const APP_MAKER = 'Crazified Studios';
const APP_SITE = 'https://crazifiedstudios.com';
// keep the existing profile folder (to-dos, alarms, glass permission) after the rename
// development keeps its existing profile folder; the installed app uses %APPDATA%/NotchVault
if (!app.isPackaged) app.setPath('userData', path.join(app.getPath('appData'), 'dynamic-island-windows'));
app.setName(APP_NAME);
if (process.platform === 'win32') app.setAppUserModelId('com.crazifiedstudios.notchvault');

// lighter Electron: small JS heap, no spare renderer process, no spell-check dictionaries
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=96');
app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess,MediaRouter,Translate,AutofillServerCommunication');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('in-process-gpu');            // one process less (~60 MB)

const WIN_W = 1100;
const WIN_H = 640;
// installed: settings and data live in %APPDATA%/NotchVault (Program Files is read-only); dev: next to the code
const HOME_DIR = app.isPackaged ? app.getPath('userData') : __dirname;
const CONFIG_PATH = path.join(HOME_DIR, 'config.json');
const DATA_DIR = path.join(HOME_DIR, 'data');
const LOGIN_ARGS = app.isPackaged ? [] : [path.resolve(__dirname)];
const SHELF_PATH = path.join(DATA_DIR, 'shelf.json');

let win = null;
let settingsWin = null;
let tray = null;
let bridge = null;
let config = {};
let quitting = false;

// ---------------------------------------------------------------- config
const DEFAULT_CONFIG = {
  python: 'python',
  media: { apps: ['spotify', 'applemusic'], allowOtherMediaApps: false },
  notifications: { apps: ['YourPhone', 'Phone Link', 'Outlook'], ignore: [], durationMs: 6000, islandOnly: true },
  phoneLinkCalls: true,
  musicStyle: 'auto',            // auto = glass for Apple Music | glass | black
  musicCompact: 'pill',          // pill | line (music shrinks to a hairline so it never covers your tabs)
  glass: { opacity: 0.35, blur: 10, saturation: 1.8, everywhere: false },
  lyrics: { enabled: true, dynamic: true, onHover: true },
  calendars: [],
  localEvents: [],
  calendarAlertMinutes: 5,
  calendar: { weekStartsMonday: true, showDots: true },
  idleStyle: 'line',             // line | pill | mascot
  idleWidth: 200,
  size: 1,                       // 1, 1.15, 1.3, 1.5
  battery: { chargingAnimation: true, unplugAlert: true, lowAt: 20, criticalAt: 10 },
  bluetooth: { popups: true },
  hud: { volume: true, brightness: true },
  focus: { minutes: 25, breakMinutes: 5 },
  water: { enabled: false, everyMinutes: 60, goal: 8 },
  clipboard: { enabled: true, limit: 40 },
  shortcut: 'Control+Alt+T',
  agentStatus: true,
  radioPopups: true,
  welcomed: false,
  display: 'primary',
};

function deepMerge(a, b) {
  for (const k of Object.keys(b || {})) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) deepMerge(a[k], b[k]);
    else a[k] = b[k];
  }
  return a;
}

function loadConfig() {
  try {
    config = deepMerge(structuredClone(DEFAULT_CONFIG), JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
  } catch {
    config = structuredClone(DEFAULT_CONFIG);
  }
  saveConfig();
  return config;
}

function saveConfig() {
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2)); } catch (e) { console.log('config save failed', e.message); }
}

function applyConfig(prev = {}) {
  saveConfig();
  sendBridgeConfig();
  send('config', config);
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('config', config);
  if (win && prev.size !== config.size) win.webContents.setZoomFactor(Number(config.size) || 1);
  if (JSON.stringify(prev.calendars) !== JSON.stringify(config.calendars) || JSON.stringify(prev.localEvents) !== JSON.stringify(config.localEvents)) refreshCalendar();
  if (prev.shortcut !== config.shortcut) registerShortcut();
  if (tray) buildTray();
}

// ---------------------------------------------------------------- island window
function targetDisplay() { return screen.getPrimaryDisplay(); }

function placeWindow() {
  if (!win) return;
  const { x, y, width } = targetDisplay().bounds;
  win.setBounds({ x: Math.round(x + width / 2 - WIN_W / 2), y, width: WIN_W, height: WIN_H });
}

function createWindow() {
  win = new BrowserWindow({
    width: WIN_W, height: WIN_H, frame: false, transparent: true, resizable: false, movable: false,
    minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false,
    alwaysOnTop: true, show: false, focusable: false, backgroundColor: '#00000000', paintWhenInitiallyHidden: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false, enableWebSQL: false, zoomFactor: Number(config.size) || 1 },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  win.setIgnoreMouseEvents(true, { forward: true });
  placeWindow();
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(Number(config.size) || 1));
  // No first-frame glitch: the window stays invisible until the island has rendered its first
  // real frame, then fades in. (Showing on ready-to-show flashed a half-built frame on first launch.)
  win.setOpacity(0);
  let revealed = false;
  const reveal = () => {
    if (revealed || !win || win.isDestroyed()) return;
    revealed = true;
    win.showInactive();
    const t0 = Date.now();
    const step = () => {
      if (!win || win.isDestroyed()) return;
      const k = Math.min(1, (Date.now() - t0) / 260);
      win.setOpacity(1 - Math.pow(1 - k, 3));
      if (k < 1) setTimeout(step, 16);
    };
    setTimeout(step, 16);
  };
  ipcMain.once('island-ready', () => setTimeout(reveal, 30));
  setTimeout(reveal, 4000);   // never stay hidden if the renderer is slow
  win.on('close', (e) => { if (!quitting) e.preventDefault(); });
  setInterval(() => { if (win && !win.isDestroyed()) win.setAlwaysOnTop(true, 'screen-saver'); }, 4000);
  startCursorTracking();
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// The island reports its rectangle; the main process makes that area clickable whenever
// the cursor is over it (this also works mid drag-and-drop, which the Shelf needs).
let islandRect = { x: 0, y: 0, w: 0, h: 0 };
let holdMouse = false;
let mouseOn = false;
function setMouse(on) {
  if (on === mouseOn || !win || win.isDestroyed()) return;
  mouseOn = on;
  win.setIgnoreMouseEvents(!on, { forward: true });
}
// Adaptive: 40 ms checks only while the cursor is near the island, otherwise 4x per second.
function startCursorTracking() {
  let bounds = win.getBounds();
  win.on('move', () => { bounds = win.getBounds(); });
  const tick = () => {
    if (!win || win.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    const z = Number(config.size) || 1;
    const x = (p.x - bounds.x) / z, y = (p.y - bounds.y) / z;
    const r = islandRect;
    const pad = r.h <= 6 ? 14 : 8;
    const inside = x >= r.x - pad - 16 && x <= r.x + r.w + pad + 16 && y >= -2 && y <= r.y + r.h + pad;
    setMouse(inside || holdMouse);
    if (config.idleStyle === 'mascot') send('cursor', { x, y, inside });
    const near = y < r.y + r.h + 160 && x > r.x - 220 && x < r.x + r.w + 220;
    setTimeout(tick, near || holdMouse ? 40 : 250);
  };
  tick();
}

// ---------------------------------------------------------------- python bridge
function startBridge() {
  const env = { ...process.env, NOTCHVAULT_DATA: DATA_DIR, PYTHONIOENCODING: 'utf-8' };
  if (app.isPackaged) {
    // the installer ships the bridge frozen with PyInstaller, so users don't need Python
    const dir = path.join(process.resourcesPath, 'bridge');
    bridge = spawn(path.join(dir, 'bridge.exe'), [], { cwd: dir, windowsHide: true, env });
  } else {
    const script = path.join(__dirname, 'bridge', 'bridge.py');
    bridge = spawn(config.python || 'python', ['-u', '-W', 'ignore', script], { cwd: path.join(__dirname, 'bridge'), windowsHide: true, env });
  }
  let buf = '';
  bridge.stdout.setEncoding('utf8');
  bridge.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'log') {
          console.log('[bridge]', msg.msg);
          try {
            fs.mkdirSync(DATA_DIR, { recursive: true });
            const lp = path.join(DATA_DIR, 'bridge.log');
            if (fs.existsSync(lp) && fs.statSync(lp).size > 300000) fs.unlinkSync(lp);
            fs.appendFileSync(lp, `${new Date().toISOString()} ${msg.msg}\n`);
          } catch {}
        }
        else if (msg.type === 'ready') { sendBridgeConfig(); send('bridge', msg); }
        else {
          if (msg.type === 'clip-changed') { pollClipboard(); continue; }
          if (msg.type === 'bt-list') btList = msg.data;
          send('bridge', msg);
          if (settingsWin && !settingsWin.isDestroyed() && msg.type === 'bt-list') settingsWin.webContents.send('bt-list', msg.data);
        }
      } catch {
        console.log('[bridge raw]', line.slice(0, 200));
      }
    }
  });
  bridge.stderr.on('data', (d) => console.error('[bridge err]', d.toString()));
  bridge.on('exit', (code) => {
    console.log('bridge exited', code);
    bridge = null;
    if (!quitting) setTimeout(startBridge, 3000);
  });
}
let btList = [];

function toBridge(obj) {
  if (bridge && bridge.stdin.writable) bridge.stdin.write(JSON.stringify(obj) + '\n');
}

function sendBridgeConfig() {
  toBridge({
    cmd: 'config',
    data: {
      mediaApps: config.media.apps,
      allowOtherMediaApps: !!config.media.allowOtherMediaApps,
      notificationApps: config.notifications.apps || [],
      ignoreNotificationApps: config.notifications.ignore || [],
      phoneLinkCalls: config.phoneLinkCalls !== false,
      takeOverBanners: config.notifications.islandOnly !== false,
    },
  });
}

// ---------------------------------------------------------------- calendar
let calendarCache = [];
let calendarStatus = [];
async function refreshCalendar() {
  const events = [];
  calendarStatus = [];
  for (const src of config.calendars || []) {
    try {
      let text;
      if (/^https?:|^webcal:/i.test(src)) {
        const res = await fetch(src.replace(/^webcal:/i, 'https:'));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        text = await res.text();
      } else {
        text = fs.readFileSync(path.resolve(__dirname, src), 'utf8');
      }
      const evs = parseICS(text);
      events.push(...evs);
      calendarStatus.push({ src, ok: true, count: evs.length });
    } catch (e) {
      calendarStatus.push({ src, ok: false, error: e.message });
    }
  }
  for (const ev of config.localEvents || []) {
    events.push({ title: ev.title, start: new Date(ev.start), end: new Date(ev.end || ev.start), url: ev.url || '', color: ev.color, allDay: !!ev.allDay, exdates: [], local: true });
  }
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const to = new Date(now.getFullYear(), now.getMonth() + 3, 1);
  calendarCache = expandEvents(events, from, to).map((e) => ({ ...e, start: e.start.getTime(), end: e.end.getTime() }));
  send('calendar', calendarCache);
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('calendar-status', calendarStatus);
}

// ---------------------------------------------------------------- lyrics (LRCLIB, synced .lrc)
const lyricsCache = new Map();
function parseLRC(lrc) {
  const lines = [];
  for (const raw of String(lrc || '').split(/\r?\n/)) {
    const stamps = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!stamps.length) continue;
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const s of stamps) lines.push({ t: +s[1] * 60 + parseFloat(s[2]), text });
  }
  return lines.sort((a, b) => a.t - b.t);
}
async function fetchLyrics({ title, artist, album, duration }) {
  const key = `${title}|${artist}`.toLowerCase();
  if (lyricsCache.has(key)) return lyricsCache.get(key);
  const clean = (s) => String(s || '').replace(/\s*[([](feat|with|from)[^)\]]*[)\]]/ig, '').trim();
  const firstArtist = String(artist || '').split(/,|&| x | feat\.? /i)[0].trim();
  const headers = { 'User-Agent': `${APP_NAME}/${app.getVersion()} (desktop lyrics)` };
  let result = { synced: [], plain: '' };
  const tries = [
    `https://lrclib.net/api/get?${new URLSearchParams({ track_name: title, artist_name: artist, album_name: album || '', duration: String(Math.round(duration || 0)) })}`,
    `https://lrclib.net/api/search?${new URLSearchParams({ track_name: clean(title), artist_name: firstArtist })}`,
    `https://lrclib.net/api/search?${new URLSearchParams({ q: `${clean(title)} ${firstArtist}` })}`,
  ];
  for (const url of tries) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) continue;
      let data = await res.json();
      if (Array.isArray(data)) {
        data = data.filter((d) => d.syncedLyrics).sort((a, b) => Math.abs((a.duration || 0) - (duration || 0)) - Math.abs((b.duration || 0) - (duration || 0)))[0] || data[0];
      }
      if (data && (data.syncedLyrics || data.plainLyrics)) {
        result = { synced: parseLRC(data.syncedLyrics), plain: data.plainLyrics || '' };
        if (result.synced.length) break;
      }
    } catch { /* offline */ }
  }
  lyricsCache.set(key, result);
  return result;
}

// ---------------------------------------------------------------- shelf
function loadShelf() { try { return JSON.parse(fs.readFileSync(SHELF_PATH, 'utf8')).filter((f) => fs.existsSync(f.path)); } catch { return []; } }
function saveShelf(items) { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(SHELF_PATH, JSON.stringify(items, null, 2)); }
async function shelfItem(p) {
  const st = fs.statSync(p);
  let icon = null;
  try { icon = (await app.getFileIcon(p, { size: 'large' })).toDataURL(); } catch {}
  let thumb = null;
  if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(p) && st.size < 15 * 1024 * 1024) {
    try { thumb = nativeImage.createFromPath(p).resize({ width: 96 }).toDataURL(); } catch {}
  }
  return { path: p, name: path.basename(p), size: st.size, dir: st.isDirectory(), icon, thumb };
}

// ---------------------------------------------------------------- clipboard history (kept on this PC only)
const CLIP_PATH = path.join(DATA_DIR, 'clipboard.json');
const CLIP_IMG_DIR = path.join(DATA_DIR, 'clips');
let clips = [];
let lastClipSig = '';
let selfCopy = '';
function loadClips() { try { clips = JSON.parse(fs.readFileSync(CLIP_PATH, 'utf8')); } catch { clips = []; } }
function saveClips() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CLIP_PATH, JSON.stringify(clips));
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('clips', clips.length);
}
function clipLimit() { return Math.max(5, Math.min(200, Number((config.clipboard || {}).limit) || 40)); }
function pruneClips() {
  const keep = clips.filter((c) => c.pinned);
  const rest = clips.filter((c) => !c.pinned).slice(0, Math.max(0, clipLimit() - keep.length));
  const removed = clips.filter((c) => !keep.includes(c) && !rest.includes(c));
  for (const c of removed) if (c.file) fs.rm(path.join(CLIP_IMG_DIR, c.file), { force: true }, () => {});
  clips = [...keep, ...rest].sort((a, b) => (b.pinned - a.pinned) || (b.at - a.at));
}
function pollClipboard() {
  if (!config.clipboard || config.clipboard.enabled === false) return;
  try {
    const { clipboard } = require('electron');
    const text = clipboard.readText();
    const img = text ? null : clipboard.readImage();
    let sig = '';
    if (text) sig = `t:${text.length}:${text.slice(0, 200)}`;
    else if (img && !img.isEmpty()) { const s = img.getSize(); sig = `i:${s.width}x${s.height}:${img.resize({ width: 16, height: 16 }).toBitmap().toString('base64')}`; }
    if (!sig || sig === lastClipSig) return;
    lastClipSig = sig;
    if (text && text === selfCopy) return; // re-copied from the island itself
    const at = Date.now();
    if (text) {
      if (text.length > 20000) return;
      const dup = clips.find((c) => c.type === 'text' && c.text === text);
      if (dup) { dup.at = at; } else clips.unshift({ id: `c${at}`, type: 'text', text, at, pinned: false });
    } else {
      fs.mkdirSync(CLIP_IMG_DIR, { recursive: true });
      const file = `clip-${at}.png`;
      fs.writeFileSync(path.join(CLIP_IMG_DIR, file), img.toPNG());
      const s = img.getSize();
      const thumb = img.resize({ width: Math.min(220, s.width) }).toDataURL();
      clips.unshift({ id: `c${at}`, type: 'image', file, thumb, w: s.width, h: s.height, at, pinned: false });
    }
    pruneClips();
    saveClips();
    send('clips', clips);
  } catch (e) { console.log('clipboard', e.message); }
}

// ---------------------------------------------------------------- AI agent icons (real app icons, looked up once)
const AGENT_ICON_PATH = path.join(DATA_DIR, 'agent-icons.json');
const AGENT_SOURCES = {
  claude: { pkg: 'Claude', exe: [] },
  chatgpt: { pkg: 'OpenAI.ChatGPT-Desktop', exe: [] },
  copilot: { pkg: 'Microsoft.Copilot', exe: ['Programs\\Microsoft VS Code\\Code.exe'] },
  codex: { pkg: 'OpenAI.ChatGPT-Desktop', exe: [] },
  cursor: { pkg: '', exe: ['Programs\\cursor\\Cursor.exe'] },
  windsurf: { pkg: '', exe: ['Programs\\Windsurf\\Windsurf.exe'] },
  gemini: { pkg: '', exe: ['Programs\\Antigravity\\Antigravity.exe'] },
};
let agentIcons = null;
async function agentIcon(agent) {
  if (!agentIcons) { try { agentIcons = JSON.parse(fs.readFileSync(AGENT_ICON_PATH, 'utf8')); } catch { agentIcons = {}; } }
  if (agent in agentIcons) return agentIcons[agent];
  const src = AGENT_SOURCES[agent];
  let url = null;
  if (src) {
    for (const rel of src.exe) {
      const p = path.join(process.env.LOCALAPPDATA || '', rel);
      if (fs.existsSync(p)) { try { url = (await app.getFileIcon(p, { size: 'large' })).toDataURL(); break; } catch {} }
    }
    if (!url && src.pkg) url = await packageLogo(src.pkg);
  }
  agentIcons[agent] = url;
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(AGENT_ICON_PATH, JSON.stringify(agentIcons)); } catch {}
  return url;
}
// logo of an installed Store/MSIX app (Claude, ChatGPT, Copilot...), read from its package folder
function packageLogo(name) {
  return new Promise((resolve) => {
    const ps = `$p = Get-AppxPackage -Name '*${name.replace(/'/g, '')}*' | Select-Object -First 1; if ($p) { Get-ChildItem -Path $p.InstallLocation -Recurse -Include *Square44x44Logo*targetsize-48*.png,*Square44x44Logo*.png,*StoreLogo*.png,*Square150x150Logo*.png -ErrorAction SilentlyContinue | Sort-Object { if ($_.Name -match 'targetsize-48') {0} elseif ($_.Name -match 'Square44') {1} else {2} } | Select-Object -First 1 -ExpandProperty FullName }`;
    require('child_process').execFile('powershell.exe', ['-NoProfile', '-Command', ps], { windowsHide: true, timeout: 15000 }, (_err, out) => {
      const p = String(out || '').trim().split(/\r?\n/)[0];
      try { resolve(p && fs.existsSync(p) ? nativeImage.createFromPath(p).toDataURL() : null); } catch { resolve(null); }
    });
  });
}

// ---------------------------------------------------------------- agent status (e.g. Claude Code hooks)
let agentServer = null;
function startAgentServer() {
  if (agentServer || !config.agentStatus) return;
  agentServer = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/diag')) {
      win.webContents.executeJavaScript('JSON.stringify({hasFocus: document.hasFocus(), active: document.activeElement && document.activeElement.tagName, boot: window.__bootAt, timers: window.__S && window.__S.timers.length, keepOpen: window.__S && window.__S.keepOpen, minimized: window.__S && window.__S.config.minimized, media: window.__S && (window.__S.media || window.__S.lastMedia) && { title: (window.__S.media || window.__S.lastMedia).title, status: (window.__S.media || window.__S.lastMedia).status, live: !!window.__S.media, artUrl: (window.__S.media || window.__S.lastMedia).artUrl || null, artKey: (window.__S.media || window.__S.lastMedia).artKey }})').then((r) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ renderer: JSON.parse(r), lastPointer, focusable: win.isFocusable(), focused: win.isFocused() }));
      });
      return;
    }
    if (req.method === 'GET' && req.url.startsWith('/diag-old')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ lastPointer, focusable: win.isFocusable(), focused: win.isFocused(), mouseOn, holdMouse, islandRect, cursor: screen.getCursorScreenPoint(), bounds: win.getBounds() }));
      return;
    }
    if (req.method === 'POST' && req.url.startsWith('/demo')) {
      // local testing hook: /demo?kind=charge | page:calendar | click-day:16 ...
      const kind = new URL(req.url, 'http://x').searchParams.get('kind') || '';
      if (/^[\w:.-]{1,40}$/.test(kind)) send('demo', kind);
      res.writeHead(200); res.end('ok');
      return;
    }
    if (req.method !== 'POST' || !req.url.startsWith('/agent')) { res.writeHead(404); res.end(); return; }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e5) req.destroy(); });
    req.on('end', () => {
      try {
        const q = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
        const d = { ...q, ...(body.trim().startsWith('{') ? JSON.parse(body) : {}) };
        send('agent', { state: String(d.state || 'working').slice(0, 20), title: String(d.title || 'Agent').slice(0, 40), detail: String(d.detail || '').slice(0, 80), agent: String(d.agent || '').toLowerCase().slice(0, 20), at: Date.now() });
        res.writeHead(200); res.end('ok');
      } catch { res.writeHead(400); res.end(); }
    });
  });
  agentServer.on('error', (e) => console.log('agent server', e.message));
  agentServer.listen(47823, '127.0.0.1');
}

// ---------------------------------------------------------------- control panel window
function openSettings(section) {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show(); settingsWin.focus();
    if (section) settingsWin.webContents.send('section', section);
    return;
  }
  settingsWin = new BrowserWindow({
    icon: APP_ICON,
    width: 860, height: 600, minWidth: 720, minHeight: 480, show: false,
    title: `${APP_NAME} Settings`, backgroundColor: '#1c1c1e', autoHideMenuBar: true,
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#1c1c1e', symbolColor: '#e5e5ea', height: 36 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  settingsWin.loadFile(path.join(__dirname, 'src', 'settings.html'), section ? { hash: section } : undefined);
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => { settingsWin = null; });
}

// ---------------------------------------------------------------- tray (lives in "Hidden icons")
const ASSETS = path.join(__dirname, 'assets');
const APP_ICON = path.join(ASSETS, 'notchvault.ico');
function logoIcon() {
  try {
    const img = nativeImage.createFromPath(path.join(ASSETS, 'win-16.png'));
    img.addRepresentation({ scaleFactor: 2, buffer: fs.readFileSync(path.join(ASSETS, 'win-32.png')) });
    if (!img.isEmpty()) return img;
  } catch {}
  return trayIcon();
}
function trayIcon() {
  const s = 32;
  const buf = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const i = (y * s + x) * 4;
    const inPill = y > 9 && y < 23 && x > 3 && x < 28 && Math.hypot(Math.max(0, Math.abs(x - 15.5) - 7.5), y - 16) < 7;
    buf[i] = 255; buf[i + 1] = 255; buf[i + 2] = 255; buf[i + 3] = inPill ? 255 : 0;
  }
  return nativeImage.createFromBitmap(buf, { width: s, height: s, scaleFactor: 2 });
}

function buildTray() {
  if (!tray) {
    tray = new Tray(logoIcon());
    tray.setToolTip(`${APP_NAME} — click for settings`);
    tray.on('click', () => openSettings());
  }
  const loginItem = app.getLoginItemSettings({ args: LOGIN_ARGS });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: APP_NAME, enabled: false },
    { label: 'Settings…', click: () => openSettings() },
    { label: `About ${APP_NAME}`, click: () => openSettings('about') },
    { type: 'separator' },
    {
      label: 'Try it',
      submenu: [
        { label: 'Notification', click: () => send('demo', 'notif') },
        { label: 'Incoming call', click: () => send('demo', 'call') },
        { label: 'Calendar alert', click: () => send('demo', 'calendar') },
        { label: '1 minute timer', click: () => send('demo', 'timer') },
        { label: 'Music (sample track)', click: () => send('demo', 'music') },
        { label: 'Charging', click: () => send('demo', 'battery') },
        { label: 'Charger removed', click: () => send('demo', 'unplug') },
        { label: 'Low battery', click: () => send('demo', 'low') },
        { label: 'Bluetooth device', click: () => send('demo', 'bt') },
        { label: 'Volume', click: () => send('demo', 'volume') },
        { label: 'Brightness', click: () => send('demo', 'brightness') },
        { label: 'Water reminder', click: () => send('demo', 'water') },
        { label: 'AI agent status', click: () => send('demo', 'agent') },
      ],
    },
    {
      label: 'Show alerts only in the island', type: 'checkbox', checked: config.notifications.islandOnly !== false,
      click: (item) => { const prev = structuredClone(config); config.notifications.islandOnly = item.checked; applyConfig(prev); },
    },
    {
      label: 'Start with Windows', type: 'checkbox', checked: loginItem.openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, path: process.execPath, args: LOGIN_ARGS }),
    },
    { label: `Reload ${APP_NAME}`, click: () => win && win.reload() },
    { type: 'separator' },
    { label: `Quit ${APP_NAME}`, click: () => { quitting = true; app.quit(); } },
  ]));
}

function registerShortcut() {
  globalShortcut.unregisterAll();
  if (!config.shortcut) return;
  try { globalShortcut.register(config.shortcut, () => send('toggle-expand')); } catch (e) { console.log('shortcut', e.message); }
}

// ---------------------------------------------------------------- ipc
let lastPointer = null;
ipcMain.on('diag-pointer', (_e, d) => { lastPointer = { ...d, at: Date.now() }; });
ipcMain.on('island-rect', (_e, r) => { islandRect = r; });
ipcMain.on('hold-mouse', (_e, on) => { holdMouse = !!on; });
ipcMain.handle('app-info', () => ({ name: APP_NAME, version: app.getVersion(), maker: APP_MAKER, site: APP_SITE }));
ipcMain.on('mouse', () => {}); // legacy: the cursor poller owns click-through now
ipcMain.on('focus', (_e, want) => {
  if (!win) return;
  if (want) { win.setFocusable(true); win.focus(); win.webContents.focus(); } else if (win.isFocused()) { win.blur(); }
});
// pages with text fields make the island focusable *before* the click, so Windows activates it
// on mouse-down and keystrokes land in the field (everywhere else it never steals focus)
ipcMain.on('focusable', (_e, on) => {
  if (!win || win.isDestroyed()) return;
  win.setFocusable(!!on);
  if (!on && win.isFocused()) win.blur();
});
ipcMain.on('bridge', (_e, msg) => toBridge(msg));
ipcMain.handle('get-config', () => config);
ipcMain.handle('set-config', (_e, patch) => {
  const prev = structuredClone(config);
  deepMerge(config, patch || {});
  for (const k of ['calendars', 'localEvents']) if (patch && Array.isArray(patch[k])) config[k] = patch[k];
  if (patch && patch.notifications && Array.isArray(patch.notifications.apps)) config.notifications.apps = patch.notifications.apps;
  if (patch && patch.notifications && Array.isArray(patch.notifications.ignore)) config.notifications.ignore = patch.notifications.ignore;
  applyConfig(prev);
  return config;
});
ipcMain.handle('get-calendar', () => calendarCache);
ipcMain.handle('calendar-status', () => calendarStatus);
ipcMain.handle('refresh-calendar', async () => { await refreshCalendar(); return calendarStatus; });
ipcMain.handle('bt-list', () => btList);
ipcMain.handle('login-item', (_e, on) => {
  if (typeof on === 'boolean') app.setLoginItemSettings({ openAtLogin: on, path: process.execPath, args: LOGIN_ARGS });
  return app.getLoginItemSettings({ args: LOGIN_ARGS }).openAtLogin;
});
ipcMain.on('open-url', (_e, url) => { if (/^https?:|^zoommtg:|^msteams:/i.test(url)) shell.openExternal(url); });
ipcMain.on('open-calendar', () => shell.openExternal('outlookcal:').catch(() => {}));
ipcMain.on('open-sound', () => shell.openExternal('ms-settings:sound').catch(() => {}));
ipcMain.on('open-battery', () => shell.openExternal('ms-settings:batterysaver').catch(() => {}));
ipcMain.on('open-bluetooth', () => shell.openExternal('ms-settings:bluetooth').catch(() => {}));
ipcMain.on('open-settings', (_e, section) => openSettings(section));
ipcMain.on('open-app', (_e, aumid) => { if (/^[\w.!{}\\\- ]+$/.test(aumid || '')) toBridge({ cmd: 'open', aumid }); });
ipcMain.on('demo', (_e, kind) => send('demo', kind));
ipcMain.handle('lyrics', (_e, q) => (config.lyrics && config.lyrics.enabled ? fetchLyrics(q || {}) : { synced: [], plain: '' }));

ipcMain.handle('agent-icon', (_e, agent) => agentIcon(String(agent || '').toLowerCase()));
ipcMain.handle('clip-list', () => clips);
ipcMain.handle('clip-copy', (_e, id) => {
  const { clipboard } = require('electron');
  const c = clips.find((x) => x.id === id);
  if (!c) return clips;
  if (c.type === 'text') { selfCopy = c.text; clipboard.writeText(c.text); lastClipSig = `t:${c.text.length}:${c.text.slice(0, 200)}`; }
  else {
    const img = nativeImage.createFromPath(path.join(CLIP_IMG_DIR, c.file));
    clipboard.writeImage(img);
    const s = img.getSize(); lastClipSig = `i:${s.width}x${s.height}:${img.resize({ width: 16, height: 16 }).toBitmap().toString('base64')}`;
  }
  c.at = Date.now();
  pruneClips(); saveClips();
  return clips;
});
ipcMain.handle('clip-pin', (_e, id) => { const c = clips.find((x) => x.id === id); if (c) c.pinned = !c.pinned; pruneClips(); saveClips(); return clips; });
ipcMain.handle('clip-delete', (_e, id) => {
  const c = clips.find((x) => x.id === id);
  if (c && c.file) fs.rm(path.join(CLIP_IMG_DIR, c.file), { force: true }, () => {});
  clips = clips.filter((x) => x.id !== id); saveClips(); return clips;
});
ipcMain.handle('clip-clear', () => {
  for (const c of clips) if (c.file && !c.pinned) fs.rm(path.join(CLIP_IMG_DIR, c.file), { force: true }, () => {});
  clips = clips.filter((c) => c.pinned); saveClips(); send('clips', clips); return clips;
});

ipcMain.handle('shelf-list', async () => Promise.all(loadShelf().map((f) => shelfItem(f.path).catch(() => null))).then((a) => a.filter(Boolean)));
ipcMain.handle('shelf-add', async (_e, paths) => {
  const cur = loadShelf();
  for (const p of paths || []) if (p && fs.existsSync(p) && !cur.find((c) => c.path === p)) cur.push({ path: p });
  saveShelf(cur);
  return Promise.all(cur.map((f) => shelfItem(f.path).catch(() => null))).then((a) => a.filter(Boolean));
});
ipcMain.handle('shelf-remove', async (_e, p) => {
  const cur = loadShelf().filter((f) => (p ? f.path !== p : false));
  saveShelf(cur);
  return Promise.all(cur.map((f) => shelfItem(f.path).catch(() => null))).then((a) => a.filter(Boolean));
});
ipcMain.on('shelf-open', (_e, p) => { if (loadShelf().find((f) => f.path === p)) shell.openPath(p); });
ipcMain.on('shelf-drag', async (e, p) => {
  if (!loadShelf().find((f) => f.path === p)) return;
  let icon;
  try { icon = await app.getFileIcon(p, { size: 'normal' }); } catch { icon = trayIcon(); }
  e.sender.startDrag({ file: p, icon });
});

ipcMain.on('glass', (_e, on) => { if (win && !win.isDestroyed()) win.setContentProtection(!!on); });
ipcMain.handle('window-origin', () => (win ? win.getBounds() : { x: 0, y: 0 }));
ipcMain.handle('display-info', () => { const d = targetDisplay(); return { bounds: d.bounds, scaleFactor: d.scaleFactor }; });
ipcMain.handle('wallpaper', () => {
  try {
    const p = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Themes', 'TranscodedWallpaper');
    return `data:image/jpeg;base64,${fs.readFileSync(p).toString('base64')}`;
  } catch { return null; }
});

function setupGlassCapture() {
  session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      const primary = screen.getPrimaryDisplay();
      const src = sources.find((s) => String(s.display_id) === String(primary.id)) || sources[0];
      callback(src ? { video: src } : {});
    }).catch(() => callback({}));
  });
}

// ---------------------------------------------------------------- app
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => openSettings());
  app.whenReady().then(() => {
    nativeTheme.themeSource = 'dark';
    loadConfig();
    setupGlassCapture();
    createWindow();
    buildTray();
    startBridge();
    refreshCalendar();
    registerShortcut();
    startAgentServer();
    loadClips();
    pollClipboard();   // after that, only when the helper reports a copy (clip-changed)
    setInterval(refreshCalendar, 5 * 60 * 1000);
    screen.on('display-metrics-changed', placeWindow);
    screen.on('display-added', placeWindow);
    screen.on('display-removed', placeWindow);
  });
  app.on('before-quit', () => { quitting = true; if (bridge) bridge.kill(); globalShortcut.unregisterAll(); });
  app.on('window-all-closed', (e) => e.preventDefault());
}
