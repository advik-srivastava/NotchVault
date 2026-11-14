/* NotchVault — renderer · Crazified Studios */
(() => {
  // ------------------------------------------------------------------ host api (Electron or browser preview)
  const preview = !window.islandAPI;
  const noop = () => {};
  const api = window.islandAPI || {
    setMouse: noop, setRect: noop, holdMouse: noop, focus: noop, bridge: (m) => console.log('[bridge]', m), openUrl: (u) => window.open(u),
    openCalendar: noop, openSound: noop, openBattery: noop, openBluetooth: noop, openSettings: noop, openApp: noop, glass: noop, demo: noop,
    windowOrigin: async () => ({ x: 0, y: 0 }),
    displayInfo: async () => ({ bounds: { x: 0, y: 0, width: innerWidth, height: innerHeight }, scaleFactor: devicePixelRatio }),
    wallpaper: async () => null, getConfig: async () => ({}), getCalendar: async () => [], on: noop,
    lyrics: async () => ({ synced: DEMO_LYRICS, plain: '' }),
    clipList: async () => [{ id: 'c1', type: 'text', text: 'https://www.apple.com/macbook-pro/', at: Date.now() - 120000 }, { id: 'c2', type: 'text', text: 'Meeting notes: ship the island v5, record demo video, send to team', at: Date.now() - 900000, pinned: true }], clipCopy: async () => [], clipPin: async () => [], clipDelete: async () => [], clipClear: async () => [],
    shelfList: async () => [], shelfAdd: async () => [], shelfRemove: async () => [], shelfOpen: noop, shelfDrag: noop, filePath: () => '',
  };
  const DEMO_LYRICS = [
    [0, 'Paper birds above the bay'], [76, 'we fold the summer light'], [80, 'into paper birds tonight'], [84, 'and send them through the sky'],
    [88, 'to find you by the sea'], [92, 'over every town'], [96, 'and back to you, wherever you are'], [100, 'the night is ours to keep'],
    [104, 'hold on, hold on'], [108, 'we were young and free'],
  ].map(([t, text]) => ({ t, text }));
  if (preview) document.body.style.background = 'url("data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b3fd6"/><stop offset=".5" stop-color="#3c8fcf"/><stop offset="1" stop-color="#a9d8a6"/></linearGradient></defs><rect width="800" height="600" fill="url(#g)"/><path d="M0 120 C200 40 400 260 800 90 L800 0 L0 0Z" fill="#7fd0a0" opacity=".7"/><circle cx="420" cy="70" r="60" fill="#ffd36e" opacity=".8"/></svg>') + '") center/cover';

  // ------------------------------------------------------------------ state
  const S = {
    config: {
      idleWidth: 200, idleStyle: 'line', notifications: { durationMs: 6000 }, calendarAlertMinutes: 5, musicStyle: 'auto',
      glass: { opacity: 0.35, blur: 10, saturation: 1.8, everywhere: false }, lyrics: { enabled: true, dynamic: true, onHover: true },
      calendar: { weekStartsMonday: true, showDots: true }, battery: { chargingAnimation: true, unplugAlert: true, lowAt: 20, criticalAt: 10 },
      bluetooth: { popups: true }, hud: { volume: true }, focus: { minutes: 25, breakMinutes: 5 }, water: { enabled: false, everyMinutes: 60, goal: 8 },
    },
    media: null,
    lastMedia: loadJSON('lastMedia', null),
    demoMedia: false,
    favorites: new Set(loadJSON('favs', [])),
    lyrics: { key: '', synced: [], status: 'none' },
    playerLyrics: false,
    volume: 0.5,
    volumeKnown: false,
    volSetAt: 0,
    volShownUntil: 0,
    timers: [],
    call: null,
    calendar: [],
    calAlerted: new Set(),
    transient: null,
    hover: false,
    expanded: false,
    page: 'home',
    pinned: 0,
    calSel: null,
    calMonth: null,
    battery: null,
    btDevices: [],
    agent: null,
    todos: loadJSON('todos', []),
    water: loadJSON(`water-${new Date().toDateString()}`, 0),
    lastWater: Date.now(),
    shelf: [],
    clips: [],
    alarms: loadJSON('alarms', []),
    snoozes: [],
    timerTab: 'timer',
    keepOpen: false,
    brightness: 50,
    brightSetAt: 0,
    muted: false,
    shelfOver: false,
  };
  function loadJSON(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }
  function saveJSON(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  const C = () => S.config;

  // ------------------------------------------------------------------ dom helpers
  const $island = document.getElementById('island');
  const $content = document.getElementById('content');
  const $tabs = document.getElementById('tabs');
  const $glass = document.getElementById('glass');
  const $glassMedia = document.getElementById('glass-media');
  const $glassVideo = document.getElementById('glass-video');
  const $glassImg = document.getElementById('glass-img');
  const $rimLine = document.querySelector('#rim .line');
  const $rimGlow = document.querySelector('#rim .glow');
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (sec) => {
    sec = Math.max(0, Math.floor(sec || 0));
    const hh = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return hh ? `${hh}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  };
  const initials = (name) => {
    const parts = String(name || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '#';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  };
  const hue = (str) => { let x = 0; for (const c of String(str)) x = (x * 31 + c.charCodeAt(0)) >>> 0; return x % 360; };
  const avatarBg = (name) => { const hh = hue(name); return `linear-gradient(160deg,hsl(${hh} 45% 62%),hsl(${(hh + 30) % 360} 40% 42%))`; };
  const dataUrl = (b64) => (b64 ? `data:image/png;base64,${b64}` : '');
  const hhmm = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const EVENT_COLORS = ['#0a84ff', '#ff453a', '#30d158', '#ff9f0a', '#bf5af2', '#64d2ff'];
  const evColor = (e) => e.color || EVENT_COLORS[hue(e.title) % EVENT_COLORS.length];
  const sizeFmt = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : b > 1e3 ? `${Math.round(b / 1e3)} KB` : `${b} B`);

  function applyConfigVars() {
    const g = C().glass || {};
    $island.style.setProperty('--g-op', String(g.opacity ?? 0.35));
    $island.style.setProperty('--g-blur', `${g.blur ?? 10}px`);
    $island.style.setProperty('--g-sat', String(g.saturation ?? 1.8));
  }

  // ------------------------------------------------------------------ shape springs + glass geometry
  let winOrigin = { x: 0, y: 0 };
  let display = { bounds: { x: 0, y: 0, width: screen.width, height: screen.height } };
  const zoom = () => Number(C().size) || 1;
  const refreshGeometry = async () => {
    try { winOrigin = await api.windowOrigin(); } catch {}
    try { display = await api.displayInfo(); } catch {}
    sizeGlassMedia();
  };
  function islandPath(w, hh, r, e) {
    e = Math.max(0, Math.min(e, hh));
    r = Math.max(0, Math.min(r, hh, w / 2));
    const W = w + 2 * e;
    return `M0,0 L${W},0 Q${e + w},0 ${e + w},${e} L${e + w},${hh - r} A${r},${r} 0 0 1 ${e + w - r},${hh} L${e + r},${hh} A${r},${r} 0 0 1 ${e},${hh - r} L${e},${e} Q${e},0 0,0 Z`;
  }
  let lastShape = { w: 200, h: 3, r: 1.5, e: 0 };
  // Liquid Glass is drawn into a small canvas that only covers the island: we copy just the
  // part of the screen behind it, at half resolution, and blur that (instead of blurring a
  // full-screen video every frame, which was the main source of lag).
  const $gcanvas = document.getElementById('glass-canvas');
  const gctx = $gcanvas.getContext('2d', { alpha: false });
  const GLASS_RES = 0.5;
  function updateGlassGeometry(v) {
    if (!$island.classList.contains('glass') && !glassWanted) return;
    const p = islandPath(v.w, Math.max(0, v.h), v.r, v.e);
    $glass.style.clipPath = `path('${p}')`;
    $rimLine.setAttribute('d', p);
    $rimGlow.setAttribute('d', p);
    drawGlass();
  }
  function drawGlass() {
    const v = lastShape;
    const src = glassStream && $glassVideo.videoWidth ? $glassVideo : ($glassImg.naturalWidth ? $glassImg : null);
    if (!src) return;
    const z = zoom();
    const cssW = v.w + 2 * v.e, cssH = Math.max(1, v.h);
    const cw = Math.max(1, Math.ceil(cssW * GLASS_RES)), ch = Math.max(1, Math.ceil(cssH * GLASS_RES));
    if ($gcanvas.width !== cw) $gcanvas.width = cw;
    if ($gcanvas.height !== ch) $gcanvas.height = ch;
    const srcW = src.videoWidth || src.naturalWidth, srcH = src.videoHeight || src.naturalHeight;
    const k = srcW / display.bounds.width;                 // source px per screen DIP
    const kY = srcH / display.bounds.height;
    const sx = (winOrigin.x - display.bounds.x + (innerWidth / 2 - cssW / 2) * z) * k;
    const sy = (winOrigin.y - display.bounds.y) * kY;
    try { gctx.drawImage(src, sx, sy, cssW * z * k, cssH * z * kY, 0, 0, cw, ch); } catch {}
  }
  function glassFrameLoop() {
    if (!glassStream) return;
    drawGlass();
    if ($glassVideo.requestVideoFrameCallback) $glassVideo.requestVideoFrameCallback(glassFrameLoop);
    else setTimeout(glassFrameLoop, 40);
  }
  function sizeGlassMedia() { updateGlassGeometry(lastShape); }
  let rectT = 0;
  function reportRect(v) {
    const now = performance.now();
    if (now - rectT < 30) return;
    rectT = now;
    api.setRect({ x: innerWidth / 2 - v.w / 2 - v.e, y: 0, w: v.w + 2 * v.e, h: Math.max(3, v.h) });
  }
  const shape = new SpringGroup({ w: 200, h: 3, r: 1.5, e: 0, sh: 0 }, (v) => {
    const r = Math.max(0, Math.min(v.r, v.h / 2, v.w / 2));
    $island.style.width = `${v.w}px`;
    $island.style.height = `${Math.max(0, v.h)}px`;
    $island.style.setProperty('--r', `${r}px`);
    $island.style.setProperty('--e', `${Math.max(0, v.e)}px`);
    $island.style.setProperty('--sh-a', (0.45 * v.sh).toFixed(3));
    $island.style.setProperty('--sh-b', `${30 * v.sh}px`);
    $island.style.setProperty('--sh-y', `${10 * v.sh}px`);
    lastShape = { w: v.w, h: v.h, r, e: Math.max(0, v.e) };
    updateGlassGeometry(lastShape);
    reportRect(lastShape);
  });
  function sizeTo(w, hgt) {
    const cur = { w: shape.springs.w.target, h: shape.springs.h.target };
    const growing = w * hgt > cur.w * cur.h + 1;
    let r, e, sh;
    if (hgt <= 4) { r = 1.5; e = 0; sh = 0; }
    else { r = hgt <= 38 ? Math.min(12, hgt / 2.6) : hgt <= 70 ? 20 : hgt <= 110 ? 26 : 32; e = hgt <= 38 ? 7 : hgt <= 70 ? 11 : 14; sh = hgt > 42 ? 1 : 0; }
    // page → page: one calm, barely-bouncy morph; otherwise Apple-like bounce when growing
    const spring = pageSwitch ? { response: 0.48, damping: 0.86 } : growing ? { response: 0.5, damping: 0.74 } : { response: 0.42, damping: 0.9 };
    shape.to({ w, h: hgt, r, e, sh }, spring);
  }
  let pageSwitch = false;

  // ------------------------------------------------------------------ view manager
  let current = null;
  // shared elements (album art, waveform) glide from the old view to the new one (FLIP),
  // so the island looks like it grows rather than swapping content
  const SHARED = ['.art', '.wave'];
  const MORPH_FAMILY = (k) => (/^(media|lyric)/.test(k) ? 'media' : /^(idle)/.test(k) ? 'idle' : /^call/.test(k) ? 'call' : /^timer/.test(k) ? 'timer' : /^agent/.test(k) ? 'agent' : k);
  function mountView(key, view, dir = 0) {
    const el = view.el;
    el.classList.add('view');
    el.style.width = `${view.w}px`;
    const morph = current && !dir && MORPH_FAMILY(current.key) === MORPH_FAMILY(key);
    const from = {};
    if (current) {
      const old = current;
      if (morph) for (const sel of SHARED) { const n = old.el.querySelector(sel); if (n) { from[sel] = n.getBoundingClientRect(); n.style.visibility = 'hidden'; } }
      old.destroy && old.destroy();
      old.el.classList.remove('enter', 'enter-l', 'enter-r', 'enter-fade');
      old.el.classList.add(dir > 0 ? 'leave-l' : dir < 0 ? 'leave-r' : morph ? 'leave-fade' : 'leave');
      setTimeout(() => old.el.remove(), 320);
    }
    el.classList.add(dir > 0 ? 'enter-r' : dir < 0 ? 'enter-l' : morph ? 'enter-fade' : 'enter');
    $content.appendChild(el);
    current = { key, ...view };
    view.update && view.update(true);
    if (morph) {
      for (const sel of SHARED) {
        const n = el.querySelector(sel);
        const f = from[sel];
        if (!n || !f) continue;
        const t = n.getBoundingClientRect();
        if (!t.width || !t.height) continue;
        n.classList.add('flip');
        n.style.transformOrigin = '0 0';
        n.style.transform = `translate(${f.left - t.left}px, ${f.top - t.top}px) scale(${f.width / t.width}, ${f.height / t.height})`;
        void n.offsetWidth;
        n.style.transition = 'transform .52s cubic-bezier(.22,1,.36,1), border-radius .52s ease';
        n.style.transform = '';
        setTimeout(() => { n.style.transition = ''; n.classList.remove('flip'); }, 560);
      }
    }
    pageSwitch = !!dir;
    relayout();
    pageSwitch = false;
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => { if (current && current.el === el) relayout(); });
      ro.observe(el);
      const prevDestroy = current.destroy;
      current.destroy = () => { ro.disconnect(); prevDestroy && prevDestroy(); };
    }
  }
  function relayout() {
    if (!current) return;
    const w = typeof current.width === 'function' ? current.width() : current.w;
    if (w !== current.w) { current.w = w; current.el.style.width = `${w}px`; }
    sizeTo(w, current.h || current.el.offsetHeight || 32);
  }

  // ------------------------------------------------------------------ deciding what to show
  const mediaActive = () => S.media && (S.media.title || S.media.artist) && S.media.status !== 'stopped';
  const isPlaying = () => mediaActive() && S.media.status === 'playing';
  function liveKind() {
    if (isPlaying()) return 'media';
    if (S.agent && S.agent.state === 'editing') return 'agent';
    if (S.timers.length) return 'timer';
    if (mediaActive()) return 'media';
    return null;
  }
  // one switch for all lyrics: hover card, lyric line in the pill, column in the player
  const lyricsShown = () => !!(C().lyrics && C().lyrics.enabled && C().lyrics.show !== false);
  function setLyricsShown(v) {
    S.config.lyrics = { ...(S.config.lyrics || {}), show: v };
    if (api.setConfig) api.setConfig({ lyrics: { show: v } }).catch(() => {});
    // swap the hover card ⇄ plain music bar right away (same view key, so force a re-mount)
    if (current && current.key === 'mediaHover') current.key = 'mediaHover:swap';
    render();
  }
  const musicAsLine = () => C().musicCompact === 'line';
  function setMusicCompact(v) {
    S.config.musicCompact = v;
    if (api.setConfig) api.setConfig({ musicCompact: v }).catch(() => {});
    render();
  }
  const PAGES = ['home', 'music', 'calendar', 'timer', 'todo', 'clipboard', 'agents'];
  const pages = () => PAGES;

  function decide() {
    if (S.call && S.call.state === 'incoming') return 'call';
    if (S.welcome) return 'welcome';
    if (S.transient) return `t:${S.transient.kind}`;
    if (S.expanded) return `page:${S.page}`;
    if (S.call && S.call.state === 'active') return S.hover ? 'callHover' : 'callCompact';
    const live = liveKind();
    if (S.hover) return live ? `${live}Hover` : 'idleHover';
    if (C().minimized && live && !S.keepOpen) return 'mediaLine';
    if (live === 'media' && musicAsLine()) return 'mediaLine';
    if (live === 'media' && C().musicCompact === 'pinned') return 'mediaHover';   // pinned open
    if (live === 'media' && isPlaying() && lyricsShown() && C().lyrics.dynamic && currentLyric()) return 'lyricCompact';
    return live ? `${live}Compact` : 'idle';
  }

  let lastHold = null, lastFocusable = null;
  function render() {
    const key = decide();
    if (!current || current.key !== key) {
      let dir = 0;
      if (current && current.key.startsWith('page:') && key.startsWith('page:')) {
        dir = PAGES.indexOf(key.slice(5)) > PAGES.indexOf(current.key.slice(5)) ? 1 : -1;
      }
      const make = VIEWS[key.startsWith('page:') ? 'page' : key];
      mountView(key, make(key), dir);
    } else {
      current.update && current.update(false);
    }
    $island.classList.toggle('hairline', (key === 'idle' && (C().idleStyle || 'line') === 'line') || key === 'mediaLine');
    $island.classList.toggle('mascot-glow', key === 'idle' && C().idleStyle === 'mascot' && mascotGlow);
    $island.classList.toggle('expanded', key.startsWith('page:'));
    const mm = S.media || S.lastMedia;
    $island.classList.toggle('albwash', key === 'page:music' && !!mm && !glassStyleFor(mm));
    // AI agents: a slow wave in the agent's colour flows behind the island
    const agKey = key === 'agentCompact' || key === 'agentHover' ? (S.agent && S.agent.key)
      : (key === 't:agentDone' || key === 't:agentWait') ? (S.transient && S.transient.data && S.transient.data.key) : null;
    $island.classList.toggle('agentwave', !!agKey);
    if (agKey) $island.style.setProperty('--agc', agentMeta(agKey).color);
    const hold = S.pinned > 0 || S.keepOpen || (key.startsWith('page:') && expandedByShortcut);
    if (hold !== lastHold) { lastHold = hold; api.holdMouse(hold); }
    const typing = key === 'page:todo' || key === 'page:timer' || key === 'page:calendar';
    if (typing !== lastFocusable) { lastFocusable = typing; if (api.focusable) api.focusable(typing); }
    syncTabs();
    syncGlass(key);
  }

  // ------------------------------------------------------------------ persistent tabs + clock
  let tabsSig = '';
  let lightsSig = '';
  function syncTabs() {
    const sig = pages().join(',');
    if (sig !== tabsSig) {
      tabsSig = sig;
      const icons = { home: I.home(14), music: I.music(14), calendar: I.calendar(14), timer: I.timer(14), todo: I.todo(14), clipboard: I.clip(14), agents: I.sparkle(14) };
      $tabs.querySelectorAll('.tab, .when, .tlights').forEach((t) => t.remove());
      // macOS traffic lights at the top-left of the expanded island
      const tl = h('<div class="tlights"></div>');
      tl.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        e.stopPropagation();
        if (b.classList.contains('off')) return;
        const act = b.dataset.act;
        onMediaAct(e);

      });
      $tabs.appendChild(tl);
      lightsSig = '';
      for (const p of pages()) {
        const b = h(`<button class="tab" data-page="${p}" title="${p}">${icons[p]}</button>`);
        b.addEventListener('click', (e) => { e.stopPropagation(); goPage(p); });
        $tabs.appendChild(b);
      }
      const when = h(`<div class="when"><span class="ringmini"></span><span class="d"></span><button class="tab set" title="Settings">${I.gear(13)}</button></div>`);
      when.querySelector('.set').addEventListener('click', (e) => { e.stopPropagation(); api.openSettings(); });
      $tabs.appendChild(when);
    }
    // refresh the lights only when what they mean changes (player open? hidden? pinned?)
    const ls = [!!S.media, S.expanded, C().minimized, playerName(), S.keepOpen].join('|');
    if (ls !== lightsSig) {
      lightsSig = ls;
      const box = $tabs.querySelector('.tlights');
      box.innerHTML = sizeBtn();

    }
    const d = new Date();
    const w = $tabs.querySelector('.when .d');
    const txt = `${d.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })} <b>${hhmm(d)}</b>`;
    if (w.innerHTML !== txt) w.innerHTML = txt;
    const btns = [...$tabs.querySelectorAll('.tab[data-page]')];
    const active = btns.find((b) => b.dataset.page === S.page) || btns[0];
    btns.forEach((b) => b.classList.toggle('on', b === active));
    if (active) $tabs.querySelector('.ink').style.transform = `translateX(${active.offsetLeft}px)`;
  }
  function goPage(p) { if (p === S.page) return; S.page = p; render(); }
  let swipeAcc = 0, swipeLock = 0;
  $island.addEventListener('wheel', (e) => {
    if (!S.expanded || e.defaultPrevented) return;
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) && !e.shiftKey) return;
    if (Date.now() < swipeLock) return;
    swipeAcc += e.shiftKey ? e.deltaY : e.deltaX;
    if (Math.abs(swipeAcc) > 70) {
      const i = PAGES.indexOf(S.page) + Math.sign(swipeAcc);
      swipeAcc = 0; swipeLock = Date.now() + 480;
      if (i >= 0 && i < PAGES.length) goPage(PAGES[i]);
    }
  }, { passive: true });

  // ------------------------------------------------------------------ Liquid Glass
  let glassWanted = false, glassT = null, glassStopT = null, glassStream = null, glassStarting = null;
  function glassStyleFor(m) {
    const st = C().musicStyle || 'auto';
    if (st === 'glass') return true;
    if (st === 'black') return false;
    return !!m && m.source === 'applemusic';
  }
  async function startGlassSource() {
    if (glassStream || glassStarting) return glassStarting;
    glassStarting = (async () => {
      if (!preview && navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
        try {
          glassStream = await navigator.mediaDevices.getDisplayMedia({ video: { width: { max: 1280 }, height: { max: 800 }, frameRate: { ideal: 24, max: 30 } }, audio: false });
          $glassVideo.srcObject = glassStream;
          await $glassVideo.play().catch(() => {});
          glassFrameLoop();
          return;
        } catch (e) { console.log('glass capture unavailable, using wallpaper', e && e.message); }
      }
      let src = null;
      try { src = await api.wallpaper(); } catch {}
      if (!src && preview) { const bg = getComputedStyle(document.body).backgroundImage.match(/url\("?(.*?)"?\)$/); src = bg ? bg[1] : null; }
      if (src) { $glassImg.onload = drawGlass; $glassImg.src = src; }
    })();
    try { await glassStarting; } finally { glassStarting = null; }
  }
  function stopGlassSource() {
    if (glassStream) { glassStream.getTracks().forEach((t) => t.stop()); glassStream = null; $glassVideo.srcObject = null; }
  }
  function syncGlass(key) {
    const everywhere = C().glass && C().glass.everywhere;
    const want = (key === 'page:music' && glassStyleFor(S.media || S.lastMedia)) || (everywhere && key !== 'idle' && !key.endsWith('Compact') && key !== 'lyricCompact');
    if (want === glassWanted) return;
    glassWanted = want;
    clearTimeout(glassT);
    if (want) {
      clearTimeout(glassStopT);
      api.glass(true);
      refreshGeometry();
      startGlassSource();
      updateGlassGeometry(lastShape);
      glassT = setTimeout(() => $island.classList.add('glass'), 280);
    } else {
      $island.classList.remove('glass');
      glassStopT = setTimeout(() => { stopGlassSource(); api.glass(false); }, 3000);
    }
  }

  // ------------------------------------------------------------------ media helpers
  const blobCache = new Map();
  function blobUrl(b64) {
    const key = b64.length + ':' + b64.slice(0, 64) + b64.slice(-64);
    if (blobCache.has(key)) return blobCache.get(key);
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const type = bytes[0] === 0x89 ? 'image/png' : bytes[0] === 0xff ? 'image/jpeg' : bytes[0] === 0x47 ? 'image/gif' : bytes[0] === 0x52 ? 'image/webp' : 'image/jpeg';
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    blobCache.set(key, url);
    if (blobCache.size > 40) { const [k, u] = blobCache.entries().next().value; URL.revokeObjectURL(u); blobCache.delete(k); }
    return url;
  }
  const mediaPos = () => mediaPosOf(S.media);
  function mediaPosOf(m) {
    if (!m) return 0;
    let pos = m.position || 0;
    if (m.status === 'playing') pos += (Date.now() - (m.receivedAt || Date.now())) / 1000;
    if (m.duration) pos = Math.min(pos, m.duration);
    return pos;
  }
  function appName(m) {
    const a = String((m && m.app) || '').toLowerCase();
    if (/spotify/.test(a)) return 'Spotify';
    if (/applemusic/.test(a)) return 'Apple Music';
    if (/chrome/.test(a)) return 'Google Chrome';
    if (/msedge|microsoftedge/.test(a)) return 'Microsoft Edge';
    if (/opera/.test(a)) return 'Opera';
    if (/firefox/.test(a)) return 'Firefox';
    if (/brave/.test(a)) return 'Brave';
    if (/vlc/.test(a)) return 'VLC';
    return m && m.source === 'applemusic' ? 'Apple Music' : 'Music';
  }
  const accentFor = (src) => (src === 'spotify' ? '#1ed760' : '#fa2d48');
  const mediaKey = (m = S.media) => (m ? `${m.title}|${m.artist}` : '');
  const touchMedia = (m) => { m.receivedAt = Date.now(); };

  function mediaCmd(action, value) {
    const m = S.media;
    if (!m && S.lastMedia && (action === 'toggle' || action === 'play')) { if (S.lastMedia.app) api.openApp(S.lastMedia.app); return; }
    if (S.demoMedia) {
      if (!m) return;
      if (action === 'toggle') { m.position = mediaPos(); touchMedia(m); m.status = m.status === 'playing' ? 'paused' : 'playing'; }
      if (action === 'seek') { m.position = value; touchMedia(m); }
      if (action === 'shuffle') m.shuffle = !m.shuffle;
      if (action === 'next' || action === 'prev') { m.position = 0; touchMedia(m); }
      render();
      return;
    }
    api.bridge({ cmd: 'media', action, value });
    if (m && action === 'toggle') {
      m.position = mediaPos(); touchMedia(m); m.status = m.status === 'playing' ? 'paused' : 'playing';
      S.pendingStatus = { status: m.status, until: Date.now() + 1500 };
      render();
    }
    if (m && (action === 'next' || action === 'prev')) { m.position = 0; touchMedia(m); render(); }
    if (m && action === 'shuffle') { m.shuffle = !m.shuffle; render(); }
    if (m && action === 'seek') { m.position = value; touchMedia(m); render(); }
  }

  const colorCache = new Map();
  // Album palette, Apple Music style: the cover's two dominant colours (weighted by how much of
  // the cover they fill), turned into a dark, readable background gradient + a bright accent.
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (mx + mn) / 2;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  const hsl = (h, s, l) => `hsl(${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
  const NEUTRAL = { bright: '#ffffff', dark: '#1c1c1e', dark2: '#2c2c2e', c1: '#1c1c1e', c2: '#2c2c2e' };
  function artColors(url, cb) {
    if (!url) return cb(NEUTRAL);
    if (colorCache.has(url)) return cb(colorCache.get(url));
    const img = new Image();
    img.onload = () => {
      try {
        const N = 24;
        const c = document.createElement('canvas'); c.width = c.height = N;
        const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, N, N);
        const d = g.getImageData(0, 0, N, N).data;
        const bins = Array.from({ length: 12 }, () => ({ w: 0, r: 0, g: 0, b: 0, s: 0, l: 0, n: 0 }));
        let total = 0, sumL = 0, colorful = 0;
        for (let i = 0; i < d.length; i += 4) {
          const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
          total++; sumL += l;
          if (s < 0.18 || l < 0.08 || l > 0.94) continue;      // greys, blacks, whites don't vote
          colorful++;
          const w = s * (1 - Math.abs(l - 0.5));                 // vivid mid-tones weigh most
          const bin = bins[Math.floor(h / 30) % 12];
          bin.w += w; bin.r += d[i] * w; bin.g += d[i + 1] * w; bin.b += d[i + 2] * w; bin.s += s * w; bin.l += l * w; bin.n++;
        }
        let out;
        if (colorful / total < 0.06) {
          // a black & white cover gets a neutral, slightly lighter or darker grey palette
          const L = sumL / total;
          out = { bright: '#f2f2f7', c1: hsl(240, 0.04, 0.24 + L * 0.06), c2: hsl(240, 0.05, 0.12), dark: hsl(240, 0.04, 0.24 + L * 0.06), dark2: hsl(240, 0.05, 0.12) };
        } else {
          const ranked = bins.map((b, i) => ({ ...b, i })).filter((b) => b.w > 0).sort((a, b) => b.w - a.w);
          const avgOf = (b) => rgbToHsl(b.r / b.w, b.g / b.w, b.b / b.w);
          const first = ranked[0];
          const [h1, s1] = avgOf(first);
          // second colour: the next strong hue at least 2 bins away, otherwise a shifted shade of the first
          const second = ranked.find((b) => Math.min(Math.abs(b.i - first.i), 12 - Math.abs(b.i - first.i)) >= 2 && b.w > first.w * 0.18);
          const [h2, s2] = second ? avgOf(second) : [(h1 + 25) % 360, s1];
          const sat = (s) => Math.min(0.75, Math.max(0.35, s));
          out = {
            bright: hsl(h1, Math.max(0.55, Math.min(0.9, s1)), 0.68),
            c1: hsl(h1, sat(s1), 0.30),
            c2: hsl(h2, sat(s2), 0.17),
            dark: hsl(h1, sat(s1), 0.30),
            dark2: hsl(h2, sat(s2), 0.17),
          };
        }
        colorCache.set(url, out);
        cb(out);
      } catch { cb(NEUTRAL); }
    };
    img.onerror = () => cb(NEUTRAL);
    img.src = url;
  }
  function waveHtml(n = 5) {
    let s = '<div class="wave">';
    for (let i = 0; i < n; i++) {
      s += `<i style="--d:${(0.55 + Math.random() * 0.6).toFixed(2)}s;--dl:${(-Math.random()).toFixed(2)}s;--h1:${(0.5 + Math.random() * 0.5).toFixed(2)};--h2:${(0.2 + Math.random() * 0.5).toFixed(2)};--h3:${(0.4 + Math.random() * 0.6).toFixed(2)}"></i>`;
    }
    return s + '</div>';
  }
  // the last cover is kept on its own (key + small jpeg), so it survives the player closing and restarts
  let lastArt = loadJSON('lastArt', null);
  const artUrlOf = (m) => (m && (m.artUrl || m.artThumb || (lastArt && lastArt.key === mediaKey(m) ? lastArt.thumb : ''))) || '';
  // keep a small copy of the last cover, so the Home card still shows it after the player closes
  function saveArtThumb(m) {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement('canvas'); c.width = c.height = 160;
        c.getContext('2d').drawImage(img, 0, 0, 160, 160);
        const thumb = c.toDataURL('image/jpeg', 0.82);
        lastArt = { key: mediaKey(m), thumb };
        saveJSON('lastArt', lastArt);
        if (S.lastMedia && mediaKey(S.lastMedia) === mediaKey(m)) S.lastMedia.artThumb = thumb;
        saveJSON('lastMedia', { ...m, artUrl: null, artThumb: thumb });
      } catch {}
    };
    img.src = m.artUrl;
  }
  const artUrl = () => artUrlOf(S.media) || artUrlOf(S.lastMedia);
  function bindArt(el, sel = '.art') {
    const url = artUrl();
    el.querySelectorAll(sel).forEach((a) => {
      const bg = url ? `url("${url}")` : '';
      if (a.dataset.bg !== bg) {
        a.dataset.bg = bg;
        a.style.backgroundImage = bg;
        const ph = a.querySelector('.ph');
        if (!url && !ph) a.insertAdjacentHTML('afterbegin', `<div class="ph" style="display:grid;place-items:center;height:100%;color:#8e8e93">${I.music(12)}</div>`);
        if (url && ph) ph.remove();
      }
    });
    if (el.dataset.colorFor === url) return;
    el.dataset.colorFor = url;
    artColors(url, (c) => {
      el.style.setProperty('--wave', c.bright);
      el.style.setProperty('--alb1', c.c1); el.style.setProperty('--alb2', c.c2);
      $island.style.setProperty('--alb1', c.c1); $island.style.setProperty('--alb2', c.c2);
      el.style.setProperty('--lyr-bg', `linear-gradient(135deg, ${c.c1}, ${c.c2})`);
    });
  }
  function setWave(el, playing) { el.querySelectorAll('.wave').forEach((w) => w.classList.toggle('playing', !!playing)); }
  function setupMarquee(el, text) {
    const track = el.querySelector('.track');
    const wrap = el.querySelector('.marquee');
    el.querySelector('.a').textContent = text;
    el.querySelector('.b').textContent = text;
    requestAnimationFrame(() => {
      const span = el.querySelector('.a');
      const fits = span.offsetWidth < wrap.offsetWidth - 28;
      track.classList.toggle('still', fits);
      el.querySelector('.b').style.display = fits ? 'none' : '';
      const w = span.offsetWidth + 40;
      track.style.setProperty('--mx', `-${w}px`);
      track.style.setProperty('--md', `${Math.max(6, w / 32)}s`);
    });
  }
  function bindSeek(bar, getDur, onDrag) {
    let frac = null;
    const fracAt = (x) => { const r = bar.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)); };
    bar.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (!getDur()) return;
      bar.setPointerCapture(e.pointerId); bar.classList.add('drag'); S.pinned++;
      frac = fracAt(e.clientX); onDrag(frac);
    });
    bar.addEventListener('pointermove', (e) => { if (frac !== null) { frac = fracAt(e.clientX); onDrag(frac); } });
    const end = () => {
      if (frac === null) return;
      mediaCmd('seek', frac * getDur());
      frac = null; onDrag(null); bar.classList.remove('drag'); S.pinned = Math.max(0, S.pinned - 1);
    };
    bar.addEventListener('pointerup', end);
    bar.addEventListener('pointercancel', end);
    bar.addEventListener('click', (e) => e.stopPropagation());
  }

  // ------------------------------------------------------------------ lyrics
  async function loadLyrics() {
    const m = S.media;
    const key = mediaKey(m);
    if (!m || !key || key === S.lyrics.key || !(C().lyrics && C().lyrics.enabled)) return;
    S.lyrics = { key, synced: [], status: 'loading' };
    try {
      const r = S.demoMedia ? { synced: DEMO_LYRICS } : await api.lyrics({ title: m.title, artist: m.artist, album: m.album, duration: m.duration });
      if (S.lyrics.key !== key) return;
      S.lyrics = { key, synced: (r && r.synced) || [], status: r && r.synced && r.synced.length ? 'ok' : 'none' };
    } catch { if (S.lyrics.key === key) S.lyrics = { key, synced: [], status: 'none' }; }
    render();
  }
  function lyricIndex(offset = 0.25) {
    const L = S.lyrics.synced;
    if (!L.length || !S.media) return -1;
    const t = mediaPos() + offset;
    let lo = 0, hi = L.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (L[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  }
  function currentLyric() {
    if (S.lyrics.key !== mediaKey() || S.lyrics.status !== 'ok') return '';
    const i = lyricIndex();
    return i >= 0 ? S.lyrics.synced[i].text : '';
  }
  // a lyric column: 3–4 lines, current one bright, smoothly scrolled
  function lyricColumn() {
    const el = h('<div class="lyr-col"><div class="lines"></div><div class="msg" style="display:none"></div></div>');
    let sig = '', idx = -2;
    return {
      el,
      update() {
        const L = S.lyrics.synced;
        const msg = el.querySelector('.msg');
        const lines = el.querySelector('.lines');
        if (S.lyrics.key !== mediaKey() || S.lyrics.status !== 'ok') {
          msg.style.display = '';
          msg.textContent = S.lyrics.status === 'loading' ? 'Finding lyrics…' : 'No synced lyrics for this song';
          lines.innerHTML = ''; sig = ''; return;
        }
        msg.style.display = 'none';
        if (sig !== S.lyrics.key) { sig = S.lyrics.key; idx = -2; lines.innerHTML = L.map((l) => `<div class="ln">${esc(l.text || '♪')}</div>`).join(''); }
        const i = lyricIndex();
        if (i === idx) return;
        idx = i;
        const nodes = lines.children;
        for (let k = 0; k < nodes.length; k++) { nodes[k].classList.toggle('on', k === i); nodes[k].classList.toggle('near', k === i + 1); }
        const target = nodes[Math.max(0, i)];
        if (target) lines.style.transform = `translateY(${-(target.offsetTop - 26)}px)`;
      },
    };
  }

  // ------------------------------------------------------------------ views
  const VIEWS = {};

  // idle: hairline / pill / mascot
  let mascotGlow = false;
  VIEWS.idle = () => {
    const style = C().idleStyle || 'line';
    if (style === 'mascot') {
      const el = h('<div class="mascot"><i class="eye"></i><i class="eye"></i></div>');
      return { w: 150, h: 30, el };
    }
    if (style === 'pill') return { w: C().idleWidth || 190, h: 30, el: h('<div class="idle"></div>') };
    return { w: C().idleWidth || 200, h: 3, el: h('<div class="idle"></div>') };
  };
  // eyes follow the cursor and blink now and then
  api.on('cursor', (p) => {
    if (!current || current.key !== 'idle' || C().idleStyle !== 'mascot') return;
    const cx = innerWidth / 2;
    const dx = Math.max(-1, Math.min(1, (p.x - cx) / 500));
    const dy = Math.max(-1, Math.min(1, (p.y - 15) / 300));
    current.el.querySelectorAll('.eye').forEach((e) => { e.style.transform = `translate(${dx * 3}px, ${dy * 2}px)`; });
    const near = Math.abs(p.x - cx) < 260 && p.y < 120;
    if (near !== mascotGlow) { mascotGlow = near; render(); }
  });
  setInterval(() => {
    if (!current || current.key !== 'idle' || C().idleStyle !== 'mascot') return;
    const m = current.el;
    m.classList.remove('blink'); void m.offsetWidth; m.classList.add('blink');
  }, 3800);

  function nextEvent() {
    const now = Date.now();
    const end = dayStart(new Date()).getTime() + 2 * 864e5;
    return S.calendar.find((e) => !e.allDay && e.end > now && e.start < end) || null;
  }
  VIEWS.idleHover = () => {
    const el = h(`<div class="lake">${sizeBtn()}<div class="info clock"></div><div class="spacer"></div><div class="info ev"></div></div>`);
    el.addEventListener('click', onMediaAct);
    return {
      w: 460, h: 36, el,
      update() {
        const d = new Date();
        el.querySelector('.clock').innerHTML = `<span>${d.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short' })}</span><span class="dim tabular">${hhmm(d)}</span>`;
        const ev = nextEvent();
        const b = S.battery;
        el.querySelector('.ev').innerHTML = ev
          ? `<span class="dot" style="background:${esc(evColor(ev))}"></span><span class="ellipsis" style="max-width:170px">${esc(ev.title)}</span><span class="dim tabular">${hhmm(ev.start)} – ${hhmm(ev.end)}</span>`
          : b ? `<span class="dim tabular">${Math.round(b.level * 100)}%</span>${I.battery(b.level, b.charging ? '#30d158' : b.level <= 0.2 ? '#ff453a' : '#fff', b.charging)}` : '';
      },
    };
  };

  // ---- music compact / dynamic lyrics / hover
  // music shrunk to a plain line (so it never covers the tabs of whatever you're working in)
  VIEWS.mediaLine = () => ({ w: C().idleWidth || 200, h: 3, el: h('<div class="idle"></div>') });
  // macOS traffic lights: red = quit the player (asks first), yellow = hide to a line, green = pin open
  const playerName = () => { const m = S.media || S.lastMedia; return m && m.source === 'spotify' ? 'Spotify' : 'Apple Music'; };
  const sizeBtn = () => `<div class="lights">
      <button class="tl red ${S.media ? '' : 'off'}" data-act="quit-ask" title="${S.media ? `Quit ${playerName()}` : 'No music app is open'}"><svg viewBox="0 0 12 12"><path d="M3.5 3.5l5 5M8.5 3.5l-5 5"/></svg></button>
      <button class="tl yellow" data-act="${C().minimized ? 'restore' : 'minimize'}" title="${C().minimized ? 'Keep the island on screen' : 'Hide the island'}"><svg viewBox="0 0 12 12"><path d="${C().minimized ? 'M6 3v6M3 6h6' : 'M3 6h6'}"/></svg></button>
      <button class="tl green ${S.keepOpen ? 'on' : ''}" data-act="keep-open" title="${S.keepOpen ? 'Unpin: let the island close again' : 'Pin: keep the island open'}"><svg viewBox="0 0 12 12"><path d="M4 3.2h4.2v4.2M8.2 3.2 3.4 8"/></svg></button>
    </div>`;

  // yellow: hide the island to a hairline (calls, notifications and alarms still pop up)
  function minimizeIsland() {
    S.keepOpen = false;
    S.config.minimized = true;
    if (api.setConfig) api.setConfig({ minimized: true }).catch(() => {});
    S.hover = false; S.expanded = false; expandedByShortcut = false;
    render();
  }
  // yellow +: bring a hidden island back and keep it on screen
  function restoreIsland() {
    S.config.minimized = false;
    if (api.setConfig) api.setConfig({ minimized: false }).catch(() => {});
    render();
  }
  // green ↗: open the activity in the island; already open → open its app
  function openIsland() {
    if (C().minimized) restoreIsland();
    if (S.expanded) { if (S.media || S.lastMedia) openPlayerApp(); return; }
    const live = liveKind();
    S.page = live === 'agent' ? 'agents' : (S.media || live === 'media') ? 'music' : live === 'timer' ? 'timer' : 'home';
    S.expanded = true; S.hover = true;
    render();
  }
  // (kept for compatibility) keep the island on screen; also un-hides it
  function toggleKeepOpen() {
    S.keepOpen = !S.keepOpen;
    if (S.keepOpen && C().minimized) {
      S.config.minimized = false;
      if (api.setConfig) api.setConfig({ minimized: false }).catch(() => {});
    }
    if (S.keepOpen && !S.expanded && !S.hover) S.hover = true;
    if (!S.keepOpen && !insideIsland) { S.hover = false; S.expanded = false; }
    render();
  }
  VIEWS.mediaCompact = () => {
    const el = h(`<div class="compact"><div class="art"></div>${waveHtml()}</div>`);
    return { w: 300, h: 32, el, update() { bindArt(el); setWave(el, isPlaying()); } };
  };
  const measureCtx = document.createElement('canvas').getContext('2d');
  VIEWS.lyricCompact = () => {
    const el = h(`<div class="dynlyr"><span class="ico">${I.music(13)}</span><span class="txt"></span></div>`);
    let last = '';
    const view = {
      w: 300, h: 32, el,
      width() {
        measureCtx.font = '700 13px "SF Pro Display", "Segoe UI", sans-serif';
        return Math.round(Math.max(240, Math.min(620, measureCtx.measureText(last).width + 70)));
      },
      update() {
        bindArt(el);
        const line = currentLyric() || '♪';
        if (line !== last) {
          last = line;
          const t = el.querySelector('.txt');
          t.textContent = line;
          t.classList.remove('swap'); void t.offsetWidth; t.classList.add('swap');
          relayout();
        }
      },
    };
    return view;
  };
  VIEWS.mediaHover = () => {
    const lyr = C().lyrics || {};
    if (lyricsShown() && lyr.onHover !== false && S.lyrics.key === mediaKey() && S.lyrics.status === 'ok') return lyricsCard();
    return miniLake();
  };
  function miniLake() {
    const el = h(`<div class="lake">
      ${sizeBtn()}
      <div class="art"></div>
      <div class="marquee"><div class="track"><span class="a"></span><span class="b"></span></div></div>
      <span class="time tabular"></span>
      <div class="bar"><div class="rail"><div class="fill"></div></div></div>
      <button class="icon-btn" data-act="toggle"></button>
      <button class="icon-btn" data-act="next">${I.next(18)}</button>
      <button class="icon-btn lyrtog ${lyricsShown() ? 'on' : ''}" data-act="lyrics-toggle" title="Lyrics">${I.quote(14)}</button>
    </div>`);
    let lastKey = '', drag = null;
    el.querySelector('.art').dataset.act = 'open-app';
    el.addEventListener('click', onMediaAct);
    bindSeek(el.querySelector('.bar'), () => S.media && S.media.duration, (f) => { drag = f; upd(); });
    function upd() {
      const m = S.media;
      if (!m) return;
      bindArt(el);
      const k = mediaKey();
      if (k !== lastKey) { lastKey = k; setupMarquee(el, [m.artist, m.title].filter(Boolean).join(' - ')); }
      const pos = drag !== null ? drag * m.duration : mediaPos();
      el.querySelector('.time').textContent = fmt(pos);
      el.querySelector('.fill').style.width = `${m.duration ? (pos / m.duration) * 100 : 0}%`;
      const pp = el.querySelector('[data-act=toggle]');
      const playing = m.status === 'playing';
      if (pp.dataset.s !== String(playing)) { pp.dataset.s = String(playing); pp.innerHTML = playing ? I.pause(15) : I.play(15); }
    }
    return { w: 660, h: 36, el, update: upd };
  }
  // shared click handling for music controls in the bar, the lyrics card and the player
  function onMediaAct(e) {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (!['toggle', 'next', 'prev', 'shrink', 'grow', 'open-app', 'quit-ask', 'pin-toggle', 'lyrics-toggle', 'minimize', 'keep-open', 'restore', 'open-island'].includes(act)) return;
    e.stopPropagation();
    b.classList.remove('tap'); void b.offsetWidth; b.classList.add('tap');
    if (act === 'minimize') { minimizeIsland(); return; }
    if (act === 'restore') { restoreIsland(); return; }
    if (act === 'open-island') { openIsland(); return; }
    if (act === 'keep-open') { toggleKeepOpen(); return; }
    if (act === 'shrink') { setMusicCompact('line'); S.hover = false; render(); return; }
    if (act === 'grow') { setMusicCompact('pill'); return; }
    if (act === 'lyrics-toggle') { setLyricsShown(!lyricsShown()); return; }
    if (act === 'pin-toggle') { setMusicCompact(C().musicCompact === 'pinned' ? 'pill' : 'pinned'); return; }
    if (act === 'quit-ask' && b.classList.contains('off')) return;
    if (act === 'quit-ask') { const m = S.media || S.lastMedia; showTransient('confirmQuit', { app: m && m.app, name: playerName(), source: m && m.source }, 15000); return; }
    if (act === 'open-app') { openPlayerApp(); return; }
    mediaCmd(act);
  }
  function openPlayerApp() {
    const m = S.media || S.lastMedia;
    if (m && m.app) api.openApp(m.app);
    else api.openApp('AppleInc.AppleMusicWin_nzyj5cx40ttqa!App');
    collapse();
  }

  // hover card: lyrics in the album's colours (3–4 synced lines)
  function lyricsCard() {
    const col = lyricColumn();
    const el = h(`<div class="lyrcard"><div class="lyr-wrap">
      <div class="left">
        <div class="meta"><div class="art" data-act="open-app"></div><div style="min-width:0" data-act="open-app"><div class="t-title ellipsis" style="font-size:13.5px"></div><div class="t-sub ellipsis" style="font-size:12px;color:rgba(255,255,255,.7)"></div></div>${sizeBtn()}</div>
        <div class="row progress"><span class="time tabular el"></span><div class="bar"><div class="rail"><div class="fill"></div></div></div><span class="time tabular tot"></span></div>
        <div class="row controls"><button class="icon-btn" data-act="prev">${I.prev(18)}</button><button class="icon-btn" data-act="toggle"></button><button class="icon-btn" data-act="next">${I.next(18)}</button><button class="icon-btn lyrtog on" data-act="lyrics-toggle" title="Turn lyrics off">${I.quote(13)}</button></div>
      </div>
    </div></div>`);
    el.querySelector('.lyr-wrap').appendChild(col.el);
    el.addEventListener('click', onMediaAct);
    let drag = null;
    bindSeek(el.querySelector('.bar'), () => S.media && S.media.duration, (f) => { drag = f; upd(); });
    function upd() {
      const m = S.media;
      if (!m) return;
      bindArt(el);
      el.querySelector('.t-title').textContent = m.title;
      el.querySelector('.t-sub').textContent = m.artist;
      const pos = drag !== null ? drag * m.duration : mediaPos();
      el.querySelector('.el').textContent = fmt(pos);
      el.querySelector('.tot').textContent = `-${fmt(Math.max(0, (m.duration || 0) - pos))}`;
      el.querySelector('.fill').style.width = `${m.duration ? (pos / m.duration) * 100 : 0}%`;
      const pp = el.querySelector('[data-act=toggle]');
      const playing = m.status === 'playing';
      if (pp.dataset.s !== String(playing)) { pp.dataset.s = String(playing); pp.innerHTML = playing ? I.pause(18) : I.play(18); }
      col.update();
    }
    return { w: 540, el, update: upd };
  }

  // ---- timer compact / hover (focus timers are purple)
  function ringSvg(frac, color = '#ff9f0a') {
    const R = 7, C2 = 2 * Math.PI * R;
    return `<svg class="ring" viewBox="0 0 18 18"><circle cx="9" cy="9" r="${R}" fill="none" stroke="${color}" stroke-opacity=".28" stroke-width="2.4"/><circle cx="9" cy="9" r="${R}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="${C2}" stroke-dashoffset="${C2 * (1 - frac)}" transform="rotate(-90 9 9)"/></svg>`;
  }
  const timerLeft = (t) => (t.paused ? t.remaining : Math.max(0, (t.endsAt - Date.now()) / 1000));
  const timerColor = (t) => (t.kind === 'focus' ? '#bf5af2' : t.kind === 'break' ? '#30d158' : '#ff9f0a');
  VIEWS.timerCompact = () => {
    const el = h('<div class="compact timer-c"><div class="lead"></div><div class="tabular" style="font-size:13px;font-weight:600"></div></div>');
    return {
      w: 270, h: 32, el,
      update() {
        const t = S.timers[0];
        if (!t) return;
        const left = timerLeft(t);
        el.querySelector('.lead').innerHTML = ringSvg(left / t.total, timerColor(t)) + (t.kind === 'focus' ? '<span class="purple" style="font-size:12px">Focus</span>' : '');
        el.lastElementChild.textContent = fmt(Math.ceil(left));
        el.lastElementChild.style.color = timerColor(t);
      },
    };
  };
  VIEWS.timerHover = () => {
    const el = h(`<div class="timer-wrap">${sizeBtn()}<div class="timer-rows"></div></div>`);
    el.querySelector('.lights').addEventListener('click', onMediaAct);
    const rowsEl = el.querySelector('.timer-rows');
    let sig = '';
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      e.stopPropagation();
      const row = b.closest('.timer-row');
      if (!row) return;
      const t = S.timers.find((x) => x.id === +row.dataset.id);
      if (!t) return;
      if (b.dataset.act === 'pause') {
        if (t.paused) { t.paused = false; t.endsAt = Date.now() + t.remaining * 1000; } else { t.remaining = timerLeft(t); t.paused = true; }
      } else if (b.dataset.act === 'cancel') S.timers = S.timers.filter((x) => x !== t);
      sig = '';
      render();
    });
    return {
      w: 340, el,
      update() {
        const s = S.timers.map((t) => `${t.id}:${t.paused}`).join(',');
        if (s !== sig) {
          sig = s;
          rowsEl.innerHTML = S.timers.map((t) => `<div class="timer-row" data-id="${t.id}">
            <button class="round ${t.kind === 'focus' ? 'p' : 'o'}" data-act="pause">${t.paused ? I.play(13) : I.pause(13)}</button>
            <button class="round g" data-act="cancel">${I.x(11)}</button>
            <span class="lbl ellipsis" style="color:${timerColor(t)}">${esc(t.label)}</span><span class="big tabular" style="color:${timerColor(t)}"></span></div>`).join('');
        }
        rowsEl.querySelectorAll('.timer-row').forEach((row) => {
          const t = S.timers.find((x) => x.id === +row.dataset.id);
          if (t) row.querySelector('.big').textContent = fmt(Math.ceil(timerLeft(t)));
        });
      },
    };
  };

  // ---- song changed: short "Now Playing" pop-up (shown even when the island is hidden)
  VIEWS['t:nowPlaying'] = () => {
    const m = S.media || S.lastMedia || {};
    const el = h(`<div class="nowp"><div class="art"></div>
      <div class="grow" style="min-width:0"><div class="nplbl">${I.music(10)} Now Playing · ${esc(appName(m))}</div><div class="t-title ellipsis">${esc(m.title || '')}</div><div class="t-sub ellipsis">${esc(m.artist || '')}</div></div>
      ${waveHtml(5)}</div>`);
    el.addEventListener('click', (e) => { e.stopPropagation(); S.transient = null; if (C().minimized) restoreIsland(); S.page = 'music'; S.expanded = true; render(); });
    return { w: 400, h: 64, el, update() { bindArt(el); setWave(el, isPlaying()); } };
  };

  // ---- AI agents (Claude, ChatGPT, Codex, Copilot, Cursor, Gemini...): working / needs input / done
  const AGENT_META = {
    claude: { name: 'Claude', color: '#d97757' },
    chatgpt: { name: 'ChatGPT', color: '#10a37f' },
    codex: { name: 'Codex', color: '#7b8cff' },
    copilot: { name: 'Copilot', color: '#a371f7' },
    cursor: { name: 'Cursor', color: '#e5e5ea' },
    gemini: { name: 'Gemini', color: '#4f8cff' },
    perplexity: { name: 'Perplexity', color: '#20b8cd' },
    windsurf: { name: 'Windsurf', color: '#3ddc97' },
  };
  function agentKeyFrom(a) {
    const k = String(a.agent || '').toLowerCase();
    if (AGENT_META[k]) return k;
    const t = `${a.title || ''} ${a.app || ''}`.toLowerCase();
    return Object.keys(AGENT_META).find((x) => t.includes(x)) || (t.includes('anthropic') ? 'claude' : t.includes('openai') ? 'chatgpt' : 'agent');
  }
  const agentMeta = (k) => AGENT_META[k] || { name: 'Agent', color: '#ff9f0a' };
  S.agentIcons = S.agentIcons || {};
  function agentIcon(k, size = 22, given) {
    const url = given ? (String(given).startsWith('data:') ? given : blobUrl(given)) : S.agentIcons[k];
    if (!given && !(k in S.agentIcons) && api.agentIcon) {
      S.agentIcons[k] = null;
      api.agentIcon(k).then((u) => { if (u) { S.agentIcons[k] = u; render(); } }).catch(() => {});
    }
    const m = agentMeta(k);
    if (url) return `<span class="agico" style="width:${size}px;height:${size}px;background-image:url('${url}')"></span>`;
    return `<span class="agico glyph" style="width:${size}px;height:${size}px;--ac:${m.color}">${esc(m.name[0])}</span>`;
  }
  function agentBars(color) {
    let s = `<div class="agbars" style="--ac:${color}">`;
    for (let i = 0; i < 6; i++) s += `<i style="--d:${(0.5 + Math.random() * 0.5).toFixed(2)}s;--dl:${(-Math.random()).toFixed(2)}s"></i>`;
    return s + '</div>';
  }
  // compact: agent icon on the left, "working" bars on the right (in the agent's colour)
  function fmtDur(s) {
    s = Math.max(0, Math.round(s));
    const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    return hh ? `${hh}h ${String(mm).padStart(2, '0')}m` : mm ? `${mm}m ${String(ss).padStart(2, '0')}s` : `${ss}s`;
  }
  const workingAgents = () => Object.values(S.agents || {}).filter((x) => x.state === 'editing' || x.state === 'waiting');
  function openAgents(e) {
    if (e) e.stopPropagation();
    if (C().minimized) restoreIsland();
    S.transient = null; S.page = 'agents'; S.expanded = true; S.hover = true;
    render();
  }
  VIEWS.agentCompact = () => {
    const a = S.agent;
    const el = h(`<div class="compact agc">${agentIcon(a.key, 20)}<span class="grow"></span><span class="agt tabular"></span>${agentBars(agentMeta(a.key).color)}</div>`);
    el.addEventListener('click', openAgents);
    const upd = () => { if (S.agent) el.querySelector('.agt').textContent = fmtDur((Date.now() - S.agent.since) / 1000); };
    upd();
    return { w: 300, h: 32, el, update: upd };
  };
  VIEWS.agentHover = () => {
    const a = S.agent;
    const m = agentMeta(a.key);
    const others = workingAgents().filter((x) => x.key !== a.key);
    const el = h(`<div class="agh">${sizeBtn()}
      <div class="row" style="gap:10px;margin-top:6px">${agentIcon(a.key, 30)}
        <div class="grow" style="min-width:0"><div class="t-title ellipsis">${esc(m.name)}</div><div class="t-sub ellipsis" style="font-size:12px">${esc(a.detail || 'Working…')}</div></div>
        <div class="agclock"><span class="lbl">Working for</span><span class="tm tabular"></span></div>${agentBars(m.color)}</div>
      ${others.length ? `<div class="agmore">${others.map((o) => agentIcon(o.key, 16)).join('')}<span>+${others.length} more agent${others.length > 1 ? 's' : ''} working</span></div>` : ''}</div>`);
    // the traffic-light row is as wide as the bar: only its buttons act, a click anywhere else opens the island
    el.addEventListener('click', (e) => { if (e.target.closest('[data-act]')) onMediaAct(e); else openAgents(e); });
    const upd = () => { if (S.agent) el.querySelector('.tm').textContent = fmtDur((Date.now() - S.agent.since) / 1000); };
    upd();
    return { w: 420, el, update: upd };
  };
  // finished: icon top-left, "✳ Job is done" in the middle (like the reference)
  VIEWS['t:agentDone'] = () => {
    const a = S.transient.data;
    const m = agentMeta(a.key);
    const el = h(`<div class="agdone">
      <div class="agtop">${agentIcon(a.key, 22, a.icon)}<span class="agname">${esc(a.app || m.name)}</span>${a.took ? `<span class="agtook tabular">${fmt(a.took)}</span>` : ''}</div>
      <div class="agmsg"><span class="spark">${I.sparkle(12)}</span>${esc(a.headline || 'Job is done')}</div>
      ${a.detail ? `<div class="agdetail">${esc(a.detail)}</div>` : ''}
    </div>`);
    el.addEventListener('click', (e) => { e.stopPropagation(); S.transient = null; render(); });
    return { w: 400, el };
  };
  // needs your input / approval
  VIEWS['t:agentWait'] = () => {
    const a = S.transient.data;
    const el = h(`<div class="agdone wait">
      <div class="agtop">${agentIcon(a.key, 22, a.icon)}<span class="agname">${esc(agentMeta(a.key).name)}</span></div>
      <div class="agmsg"><span class="spark">${I.bell(12)}</span>${esc(a.headline || 'Needs your input')}</div>
      ${a.detail ? `<div class="agdetail">${esc(a.detail)}</div>` : ''}
    </div>`);
    el.addEventListener('click', (e) => { e.stopPropagation(); S.transient = null; render(); });
    return { w: 400, el };
  };

  // ---- calls
  function callAvatar(size) {
    const c = S.call || {};
    if (c.photo) return `<div class="avatar photo" style="width:${size}px;height:${size}px;background-image:url('${blobUrl(c.photo)}')"></div>`;
    return `<div class="avatar" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px;background:${avatarBg(c.name)}">${esc(initials(c.name))}</div>`;
  }
  const callElapsed = () => (S.call && S.call.startedAt ? (Date.now() - S.call.startedAt) / 1000 : 0);
  VIEWS.call = () => {
    const c = S.call;
    const el = h(`<div class="call">
      ${callAvatar(46)}
      <div class="grow who"><div class="t-sub">${c.video ? 'Video call' : 'from Phone'}</div><div class="name ellipsis">${esc(c.name || c.number || 'Unknown')}</div></div>
      <button class="round red" data-act="decline" title="Decline">${I.hangup(22)}</button>
      <button class="round green ring" data-act="accept" title="Accept">${I.phone(20)}</button>
    </div>`);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      e.stopPropagation();
      if (b.dataset.act === 'accept') { api.bridge({ cmd: 'call', action: 'accept' }); S.call.state = 'active'; S.call.startedAt = Date.now(); }
      else { api.bridge({ cmd: 'call', action: 'decline' }); S.call = null; }
      S.hover = false; S.expanded = false;
      render();
    });
    return { w: 440, h: 86, el };
  };
  VIEWS.callCompact = () => {
    const el = h(`<div class="compact"><div class="lead">${callAvatar(20)}<span class="green-text tabular t"></span></div>${waveHtml(7)}</div>`);
    el.style.setProperty('--wave', '#ffffff');
    return { w: 300, h: 32, el, update() { el.querySelector('.t').textContent = fmt(callElapsed()); setWave(el, !(S.call && S.call.muted)); } };
  };
  VIEWS.callHover = () => {
    const el = h(`<div class="callon">
      <div class="row" style="gap:12px">${callAvatar(40)}
        <div class="grow"><div class="t-sub tabular t" style="font-size:12px"></div><div class="t-title ellipsis" style="font-size:15px">${esc(S.call.name || S.call.number || 'Call')}</div></div>
        <button class="round red" data-act="end" style="width:36px;height:36px">${I.hangup(19)}</button>
      </div>
      <div class="controls2"><button class="pill-btn showwin" data-act="show" title="Open Phone Link's call window (keypad, hold, transfer)">Call window</button><button class="round white" data-act="mute"></button></div>
    </div>`);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      e.stopPropagation();
      if (b.dataset.act === 'end') { api.bridge({ cmd: 'call', action: 'end' }); S.call = null; S.hover = false; }
      if (b.dataset.act === 'mute') { api.bridge({ cmd: 'call', action: 'mute' }); S.call.muted = !S.call.muted; }
      if (b.dataset.act === 'show') { api.bridge({ cmd: 'call', action: 'show' }); S.hover = false; }
      render();
    });
    return {
      w: 360, el,
      update() {
        if (!S.call) return;
        el.querySelector('.t').textContent = fmt(callElapsed());
        const m = el.querySelector('[data-act=mute]');
        m.innerHTML = S.call.muted ? I.micOff(15) : I.mic(15);
        m.className = `round ${S.call.muted ? 'white' : 'dark'}`;
      },
    };
  };

  // ---- notifications
  function relTime(t) {
    const s = Date.now() / 1000 - (t || Date.now() / 1000);
    if (s < 60) return 'now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
  }
  // contact photo (from Phone Link's synced contacts) + app badge; otherwise the app's own icon
  function notifAvatar(n) {
    const badge = n.icon ? `<div class="appbadge" style="background-image:url('${blobUrl(n.icon)}');background-size:cover"></div>` : '';
    if (n.photo) return `<div class="avatar photo" style="background-image:url('${blobUrl(n.photo)}')">${badge}</div>`;
    if (n.icon && n.source === 'phonelink') return `<div class="avatar appicon" style="background-image:url('${blobUrl(n.icon)}')"></div>`;
    return `<div class="avatar" style="background:${avatarBg(n.title)}">${esc(initials(n.title))}${badge || `<div class="appbadge" style="display:grid;place-items:center;color:#fff">${I.bell(11)}</div>`}</div>`;
  }
  function dismissNotif(n) {
    if (!S.transient || S.transient.kind !== 'notif') return;
    S.transient.data = S.transient.data.filter((x) => x !== n);
    if (n && !String(n.id).startsWith('demo')) api.bridge({ cmd: 'notif-dismiss', id: n.id });
    if (!S.transient.data.length) S.transient = null;
    render();
  }
  VIEWS['t:notif'] = () => {
    const el = h('<div class="notif"></div>');
    let sig = '';
    el.addEventListener('click', (e) => {
      const item = e.target.closest('.item');
      if (!item || !S.transient) return;
      e.stopPropagation();
      const n = S.transient.data.find((x) => String(x.id) === item.dataset.id);
      if (e.target.closest('.close')) { dismissNotif(n); return; }
      if (n && n.aumid) api.bridge({ cmd: 'open', aumid: n.aumid });
      S.transient = null;
      render();
    });
    return {
      w: 440, el,
      update() {
        const list = S.transient && S.transient.kind === 'notif' ? S.transient.data : [];
        const s = list.map((n) => n.id).join(',');
        if (s !== sig) {
          sig = s;
          el.innerHTML = list.slice(0, 3).map((n, i) => `<div class="item ${i > 0 ? 'older' : ''}" data-id="${esc(n.id)}">
            ${notifAvatar(n)}
            <div class="grow">
              <div class="title-row"><span class="t-title ellipsis" style="font-size:15px">${esc(n.title)}</span><span class="appname">${esc(n.app || '')}</span><span class="when" data-t="${n.time || ''}"></span></div>
              <div class="body">${esc(n.body || n.app)}</div>
            </div>
            <button class="icon-btn close" title="Dismiss">${I.x(9)}</button>
          </div>`).join('');
        }
        el.querySelectorAll('.when').forEach((w) => { w.textContent = relTime(+w.dataset.t || undefined); });
      },
    };
  };

  // ---- calendar alert
  VIEWS['t:calendar'] = () => {
    const ev = S.transient.data;
    const d = new Date(ev.start);
    const el = h(`<div class="calalert">
      <div class="date"><div class="mon">${d.toLocaleString('en', { month: 'short' }).toUpperCase()}</div><div class="day">${d.getDate()}</div></div>
      <div class="vbar" style="background:${esc(evColor(ev))}"></div>
      <div class="grow info"><div class="t-title ellipsis">${esc(ev.title)}</div>
        <div class="in"><span class="cd tabular"></span>${ev.url ? '<button class="pill-btn" data-act="join">Join Meeting</button>' : ''}</div>
      </div>
    </div>`);
    el.addEventListener('click', (e) => { e.stopPropagation(); if (e.target.closest('[data-act=join]')) api.openUrl(ev.url); S.transient = null; render(); });
    return { w: ev.url ? 360 : 330, h: 64, el, update() { const left = (ev.start - Date.now()) / 1000; el.querySelector('.cd').textContent = left > 0 ? `In ${fmt(left)}` : 'Now'; } };
  };

  // ---- timer done
  VIEWS['t:timerDone'] = () => {
    const t = S.transient.data;
    const col = timerColor(t);
    const el = h(`<div class="done">
      <div class="ico" style="color:${col}">${I.timer(17)}</div>
      <div class="grow"><div class="t-sub" style="font-size:12px;color:${col}">${esc(t.label)}</div><div class="t-title" style="font-size:17px">${t.kind === 'focus' ? 'Focus done — take a break' : t.kind === 'break' ? 'Break over' : 'Done'}</div></div>
      <button class="round o" data-act="repeat" title="Repeat" style="width:34px;height:34px">${I.restart(15)}</button>
      <button class="round g" data-act="stop" title="Stop" style="width:34px;height:34px">${I.x(12)}</button>
    </div>`);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = e.target.closest('[data-act]');
      if (b && b.dataset.act === 'repeat') startTimer(t.total, t.label, t.kind);
      stopChime();
      S.transient = null;
      render();
    });
    return { w: 380, h: 66, el };
  };

  // ---- battery: charging (Apple-style fill + bolt + glow), unplugged, low
  function battEl(level, color, charging) {
    return `<div class="bigbatt ${charging ? 'charging' : ''}" style="--bc:${color}"><div class="shell"><div class="fill"></div></div><div class="cap"></div><span class="bolt">${I.bolt(16)}</span></div>`;
  }
  VIEWS['t:charge'] = () => {
    const b = S.transient.data;
    const devs = (S.btDevices || []).filter((d) => d.battery != null).slice(0, 3);
    const el = h(`<div class="chgwrap"><div class="chg">${battEl(b.level, '#30d158', true)}<span class="lbl green">${b.level >= 0.995 ? 'Fully Charged' : 'Charging'}</span><span class="pct tabular">0%</span></div>`
      + (devs.length ? `<div class="chgdevs">${devs.map((d) => `<span class="cdev">${devIcon(d.kind).replace(/width="22" height="22"/, 'width="14" height="14"')}<span class="n ellipsis">${esc(d.name)}</span><b class="tabular ${d.battery <= 20 ? 'lowb' : ''}">${d.battery}%</b></span>`).join('')}</div>` : '') + '</div>');
    const target = Math.round(b.level * 100);
    requestAnimationFrame(() => requestAnimationFrame(() => { el.querySelector('.fill').style.width = `calc(${b.level * 100}% - 4px)`; }));
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / 700);
      const eased = 1 - Math.pow(1 - k, 3);
      const from = Math.max(0, target - 15);
      el.querySelector('.pct').textContent = `${k >= 1 ? target : Math.round(from + (target - from) * eased)}%`;
      if (k < 1 && el.isConnected) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    flashGlow('green');
    return devs.length ? { w: 400, el } : { w: 360, h: 44, el };
  };
  VIEWS['t:unplug'] = () => {
    const b = S.transient.data;
    const low = b.level * 100 <= (C().battery.lowAt || 20);
    const col = low ? '#ff453a' : '#ffffff';
    const el = h(`<div class="chg">${I.plug(18)}<span class="lbl">Charger Disconnected<span class="sub">${low ? 'Battery is running low' : 'Running on battery'}</span></span><span class="pct tabular">${Math.round(b.level * 100)}%</span>${battEl(b.level, col, false)}</div>`);
    requestAnimationFrame(() => requestAnimationFrame(() => { el.querySelector('.fill').style.width = `calc(${b.level * 100}% - 4px)`; }));
    return { w: 400, h: 48, el };
  };
  VIEWS['t:low'] = () => {
    const b = S.transient.data;
    const el = h(`<div class="chg">${battEl(b.level, '#ff453a', false)}<span class="lbl red">Battery is running low<span class="sub">${Math.round(b.level * 100)}% remaining — plug in soon</span></span><button class="pill-btn" data-act="saver" style="margin-left:auto">Battery Saver</button></div>`);
    requestAnimationFrame(() => requestAnimationFrame(() => { el.querySelector('.fill').style.width = `calc(${b.level * 100}% - 4px)`; }));
    el.addEventListener('click', (e) => { if (e.target.closest('[data-act=saver]')) { e.stopPropagation(); api.openBattery(); S.transient = null; render(); } });
    flashGlow('red');
    return { w: 420, h: 50, el };
  };
  // the plug/unplug light fades in gently and fades out slowly (separate layer, opacity only)
  const $glow = document.getElementById('glow');
  let glowT = null;
  function flashGlow(c) {
    clearTimeout(glowT);
    $glow.style.setProperty('--glow', ({ red: '255,69,58', orange: '255,159,10', grey: '142,142,147' })[c] || '48,209,88');
    requestAnimationFrame(() => $glow.classList.add('on'));
    glowT = setTimeout(() => $glow.classList.remove('on'), 1700);
  }

  // ---- bluetooth device
  const devIcon = (kind) => ({ headphones: I.headphones, earbuds: I.earbuds, mouse: I.mouse, keyboard: I.keyboard, speaker: I.speakerDev, phone: I.phoneDev, gamepad: I.gamepad, watch: I.watch }[kind] || I.bluetooth)(22);
  VIEWS['t:bt'] = () => {
    const d = S.transient.data;
    const on = d.state === 'connected';
    const lvl = d.battery;
    const R = 17, CIRC = 2 * Math.PI * R;
    const col = lvl == null ? '#8e8e93' : lvl <= 20 ? '#ff453a' : '#30d158';
    const el = h(`<div class="btpop ${on ? '' : 'off'}">
      <div class="dev">${devIcon(d.kind)}</div>
      <div class="grow"><div class="t-sub">${on ? 'Connected' : 'Disconnected'}</div><div class="name ellipsis">${esc(d.name)}</div></div>
      ${lvl != null ? `<div class="bring"><svg viewBox="0 0 42 42"><circle cx="21" cy="21" r="${R}" fill="none" stroke="rgba(255,255,255,.14)" stroke-width="4"/><circle class="ring-fg" cx="21" cy="21" r="${R}" fill="none" stroke="${col}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}"/></svg><span class="p">${lvl}%</span></div>` : ''}
    </div>`);
    el.addEventListener('click', (e) => { e.stopPropagation(); api.openBluetooth(); S.transient = null; render(); });
    if (lvl != null) requestAnimationFrame(() => requestAnimationFrame(() => { el.querySelector('.ring-fg').style.strokeDashoffset = String(CIRC * (1 - lvl / 100)); }));
    return { w: 400, h: 68, el };
  };

  // ---- Wi-Fi / Bluetooth / airplane mode / battery saver
  const RADIO = {
    wifi: { name: 'Wi-Fi', col: '#0a84ff',
      icon: (on) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path class="a3" d="M2.5 9a14 14 0 0 1 19 0"/><path class="a2" d="M5.5 12.4a9.5 9.5 0 0 1 13 0"/><path class="a1" d="M8.6 15.7a5 5 0 0 1 6.8 0"/><circle class="a0" cx="12" cy="19" r="1.4" fill="currentColor" stroke="none"/>${on ? '' : '<path class="slash" d="M4 3l16 18"/>'}</svg>` },
    bluetooth: { name: 'Bluetooth', col: '#0a84ff',
      icon: (on) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7l10 10-5 4V3l5 4L7 17"/>${on ? '' : '<path class="slash" d="M4 3l16 18"/>'}</svg>` },
    airplane: { name: 'Airplane Mode', col: '#ff9f0a',
      icon: () => `<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M21 15.5v-1.7l-7.6-4.8V3.6A1.4 1.4 0 0 0 12 2.2a1.4 1.4 0 0 0-1.4 1.4V9L3 13.8v1.7l7.6-2.4v5.2l-2.1 1.6v1.4l3.5-1 3.5 1v-1.4l-2.1-1.6v-5.2z"/></svg>` },
    saver: { name: 'Battery Saver', col: '#ffd60a', icon: () => '' },
  };
  VIEWS['t:radio'] = () => {
    const d = S.transient.data;
    const R = RADIO[d.kind] || RADIO.wifi;
    const on = !!d.on;
    let ico;
    if (d.kind === 'saver') {
      const lvl = d.level != null ? d.level : (S.battery ? S.battery.level : 0.5);
      ico = battEl(lvl, on ? '#ffd60a' : '#ffffff', false);
    } else if (d.kind === 'airplane') {
      // a jet with its contrail flies the length of the island; on: it lands as the icon, off: it takes off from it
      ico = `<span class="flight"><i class="cloud c1"></i><i class="cloud c2"></i><i class="cloud c3"></i>
          <span class="jet"><span class="contrail"></span><span class="jplane">${R.icon(on)}</span></span></span>
        <span class="apico">${R.icon(on)}</span>`;
    } else {
      ico = `<span class="rico ${on ? 'on' : 'off'}" style="--rc:${R.col}">${R.icon(on)}</span>`;
    }
    const el = h(`<div class="rad ${d.kind} ${on ? 'on' : 'off'}" style="--rc:${R.col}">${ico}<span class="lbl">${R.name}</span><span class="st">${on ? 'On' : 'Off'}</span></div>`);
    if (d.kind === 'saver') requestAnimationFrame(() => requestAnimationFrame(() => { const f = el.querySelector('.fill'); if (f) f.style.width = `calc(${(d.level != null ? d.level : (S.battery ? S.battery.level : 0.5)) * 100}% - 4px)`; }));
    el.addEventListener('click', (e) => { e.stopPropagation(); S.transient = null; render(); });
    if (d.kind === 'airplane') flashGlow(on ? 'orange' : 'grey');
    return { w: d.kind === 'airplane' ? 380 : 330, h: 44, el };
  };

  // ---- first run: the logo, then "hello" in many languages (like a new iPhone), then Welcome
  // hello, written by hand in many languages (stroke traced, then ink flows in)
  const HELLOS = [
    ['hello', 'en'], ['नमस्ते', 'hi'], ['hola', 'es'], ['bonjour', 'fr'], ['こんにちは', 'ja'], ['안녕하세요', 'ko'],
    ['ciao', 'it'], ['привет', 'ru'], ['你好', 'zh'], ['olá', 'pt'], ['مرحبا', 'ar'], ['hallo', 'de'], ['hello', 'en'],
  ];
  const HW_FONT = { hi: "'Nirmala UI', 'Segoe Script'", ja: "'Yu Gothic UI', 'Segoe Script'", ko: "'Malgun Gothic', 'Segoe Script'", zh: "'Microsoft YaHei UI', 'Segoe Script'", ar: "'Segoe UI', 'Segoe Script'" };
  // the guide: every icon in the island, explained once
  const GUIDE = [
    { key: 'lights', title: 'Window buttons', body: '<b class="r">×</b> quits your music app &nbsp;·&nbsp; <b class="y">−</b> hides the island to a thin line, <b class="y">+</b> brings it back &nbsp;·&nbsp; <b class="g">↗</b> pins the island open' },
    { key: 'home', title: 'Home', body: 'Battery, Bluetooth devices, Focus and your day, at a glance.' },
    { key: 'music', title: 'Music', body: 'Apple Music, Spotify and more, with synced lyrics and a volume just for the player.' },
    { key: 'calendar', title: 'Calendar', body: 'Your upcoming events. Tap + to add one.' },
    { key: 'timer', title: 'Timers and alarms', body: 'Run several timers at once, set alarms and start Focus sessions.' },
    { key: 'todo', title: 'To-do', body: 'Quick tasks you can tick off without opening another app.' },
    { key: 'clipboard', title: 'Clipboard', body: 'Everything you copied, ready to paste again.' },
    { key: 'agents', title: 'AI agents', body: 'Claude, Codex, Copilot, ChatGPT and more: who is working, and for how long.' },
    { key: 'settings', title: 'Settings', body: 'Liquid Glass, pop-ups, shortcuts and everything else.' },
    { key: 'tip', title: 'You’re all set', body: '' },
  ];
  function startWelcome() {
    if (S.welcome) return;
    if (C().minimized) restoreIsland();
    S.transient = null; S.expanded = false; S.hover = false;
    S.welcome = { at: Date.now() };
    render();
  }
  function endWelcome() {
    if (!S.welcome) return;
    S.welcome = null;
    S.config.welcomed = true;
    if (api.setConfig) api.setConfig({ welcomed: true }).catch(() => {});
    render();
  }
  VIEWS.welcome = () => {
    const el = h(`<div class="welcome">
      <svg width="0" height="0" style="position:absolute"><defs><linearGradient id="hwInk" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#fff8ea"/><stop offset=".55" stop-color="#ecd08f"/><stop offset="1" stop-color="#fff8ea"/></linearGradient></defs></svg>
      <div class="wl-aura"><i class="b1"></i><i class="b2"></i><i class="b3"></i></div>
      <img class="wl-logo" src="../assets/logo.svg" alt="">
      <div class="wl-words"></div>
      <div class="wl-end">
        <div class="wl-title">Welcome to NotchVault</div>
        <div class="wl-sub">Music, calls, notifications and your AI agents, live at the top of your screen.</div>
        <button class="wl-go">Get Started</button>
      </div>
      <div class="wl-tour">
        <div class="tr-bar"><span class="tr-ink"></span></div>
        <div class="tr-card"></div>
        <div class="tr-foot"><div class="tr-dots"></div><button class="tr-back">Back</button><button class="tr-next">Next</button></div>
      </div>
      <button class="wl-skip">Skip</button>
    </div>`);
    const words = el.querySelector('.wl-words');
    const timers = [];
    const later = (ms, fn) => timers.push(setTimeout(fn, ms));

    // ---- 1 · handwriting
    let i = 0;
    function nextWord() {
      if (!el.isConnected) return;
      const [txt, lang] = HELLOS[i];
      const first = i === 0 || i === HELLOS.length - 1;
      const old = words.querySelector('.hw.cur');
      if (old) { old.classList.remove('cur'); old.classList.add('out'); setTimeout(() => old.remove(), 600); }
      const rtl = lang === 'ar';
      const font = HW_FONT[lang] || "'Segoe Script', 'Ink Free', cursive";
      const size = first ? 74 : /^(ja|ko|zh|hi)$/.test(lang) ? 52 : 62;
      const svg = `<svg class="hw cur ${rtl ? 'rtl' : ''} ${first ? 'first' : ''}" viewBox="0 0 560 96" lang="${lang}">
        <text class="trace" x="280" y="66" text-anchor="middle" style="font-family:${font};font-size:${size}px" ${rtl ? 'direction="rtl"' : ''}>${esc(txt)}</text>
        <text class="ink" x="280" y="66" text-anchor="middle" fill="url(#hwInk)" style="font-family:${font};font-size:${size}px" ${rtl ? 'direction="rtl"' : ''}>${esc(txt)}</text>
        <circle class="pen" cx="0" cy="58" r="3.2"/></svg>`;
      words.insertAdjacentHTML('beforeend', svg);
      // the pen tip travels exactly across this word
      try {
        const node = words.lastElementChild, bb = node.querySelector('.ink').getBBox();
        node.style.setProperty('--x0', `${bb.x}px`); node.style.setProperty('--x1', `${bb.x + bb.width}px`);
        node.querySelector('.pen').setAttribute('cy', String(bb.y + bb.height * 0.62));
      } catch {}
      i++;
      if (i < HELLOS.length) later(first ? 2300 : 1250, nextWord);
      else later(2300, () => el.classList.add('final'));
    }
    later(1500, () => { el.classList.add('words'); nextWord(); });

    // ---- 2 · the icon guide
    const bar = el.querySelector('.tr-bar');
    const lightsMini = '<span class="mini-lights"><i class="r"></i><i class="y"></i><i class="g"></i></span>';
    const iconFor = (k) => ({ lights: lightsMini, home: I.home(15), music: I.music(15), calendar: I.calendar(15), timer: I.timer(15), todo: I.todo(15), clipboard: I.clip(15), agents: I.sparkle(15), settings: I.gear(14), tip: I.check(15) }[k]);
    GUIDE.forEach((g, n) => bar.insertAdjacentHTML('beforeend', `<span class="tr-ic" data-n="${n}">${iconFor(g.key)}</span>`));
    el.querySelector('.tr-dots').innerHTML = GUIDE.map(() => '<i></i>').join('');
    let step = 0;
    function showStep(n, dir = 1) {
      step = Math.max(0, Math.min(GUIDE.length - 1, n));
      const g = GUIDE[step];
      const ics = [...bar.querySelectorAll('.tr-ic')];
      ics.forEach((x, k) => x.classList.toggle('on', k === step));
      const on = ics[step];
      const ink = bar.querySelector('.tr-ink');
      ink.style.width = `${on.offsetWidth + 8}px`;
      ink.style.transform = `translateX(${on.offsetLeft - 4}px)`;
      el.querySelectorAll('.tr-dots i').forEach((d, k) => d.classList.toggle('on', k === step));
      const sc = C().shortcut ? C().shortcut.replace(/Control/i, 'Ctrl') : '';
      const body = g.key === 'tip'
        ? `Move your pointer to the top of the screen to open the island${sc ? `, or press <kbd>${esc(sc)}</kbd>` : ''}. Replay this guide any time in Settings.`
        : g.body;
      const card = el.querySelector('.tr-card');
      card.innerHTML = `<div class="tr-in ${dir < 0 ? 'back' : ''}"><span class="tr-big ${g.key}">${g.key === 'lights' ? '<span class="big-lights"><i class="r">×</i><i class="y">−</i><i class="g">↗</i></span>' : iconFor(g.key)}</span>
        <div class="tr-txt"><div class="tr-t">${g.title}</div><div class="tr-b">${body}</div></div></div>`;
      el.querySelector('.tr-back').style.visibility = step ? 'visible' : 'hidden';
      el.querySelector('.tr-next').textContent = step === GUIDE.length - 1 ? 'Done' : 'Next';
    }
    el.querySelector('.wl-go').addEventListener('click', (e) => { e.stopPropagation(); el.classList.add('touring'); requestAnimationFrame(() => showStep(0)); });
    el.querySelector('.tr-next').addEventListener('click', (e) => { e.stopPropagation(); if (step === GUIDE.length - 1) endWelcome(); else showStep(step + 1, 1); });
    el.querySelector('.tr-back').addEventListener('click', (e) => { e.stopPropagation(); showStep(step - 1, -1); });
    bar.addEventListener('click', (e) => { const t = e.target.closest('.tr-ic'); if (t) { e.stopPropagation(); showStep(+t.dataset.n, +t.dataset.n >= step ? 1 : -1); } });
    el.querySelector('.wl-skip').addEventListener('click', (e) => { e.stopPropagation(); endWelcome(); });
    el.addEventListener('click', (e) => e.stopPropagation());
    el.__tour = (n) => { el.classList.add('final', 'touring'); showStep(n); };   // test hook
    return { w: 560, h: 236, el, destroy() { timers.forEach(clearTimeout); } };
  };

  // ---- volume HUD
  VIEWS['t:volume'] = () => {
    const el = h(`<div class="vhud"><span class="ic"></span><div class="bar"><div class="rail"><div class="fill"></div></div></div><span class="pct"></span></div>`);
    const bar = el.querySelector('.bar');
    const set = (e) => { const r = bar.getBoundingClientRect(); S.volume = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); S.volSetAt = Date.now(); api.bridge({ cmd: 'volume', value: S.volume }); S.transient.until = Date.now() + 1600; upd(); };
    let drag = false;
    bar.addEventListener('pointerdown', (e) => { e.stopPropagation(); drag = true; bar.setPointerCapture(e.pointerId); S.pinned++; set(e); });
    bar.addEventListener('pointermove', (e) => { if (drag) set(e); });
    bar.addEventListener('pointerup', () => { drag = false; S.pinned = Math.max(0, S.pinned - 1); });
    function upd() {
      el.querySelector('.fill').style.width = `${S.volume * 100}%`;
      el.querySelector('.pct').textContent = `${Math.round(S.volume * 100)}`;
      el.querySelector('.ic').innerHTML = S.muted || S.volume < 0.01 ? I.speakerMute(15) : S.volume < 0.5 ? I.speaker(15) : I.speakerLoud(16);
      el.classList.toggle('muted', !!S.muted);
    }
    return { w: 380, h: 36, el, update: upd };
  };

  // ---- alarm ringing (Snooze 9 min / Stop)
  VIEWS['t:alarm'] = () => {
    const a = S.transient.data;
    const el = h(`<div class="aring">
      <div class="abell">${I.alarm(20)}</div>
      <div class="grow"><div class="t-sub" style="font-size:12px;color:#ff9f0a">${esc(a.label)}</div><div class="atime2 tabular">${esc(a.time)}</div></div>
      <button class="pill-btn snz" data-act="snooze">Snooze</button>
      <button class="round g" data-act="stop" title="Stop" style="width:34px;height:34px">${I.x(12)}</button>
    </div>`);
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const b = e.target.closest('[data-act]');
      if (!b) return;
      stopChime();
      if (b.dataset.act === 'snooze') S.snoozes.push({ at: Date.now() + 9 * 60000, alarm: a });
      S.transient = null;
      render();
    });
    return { w: 400, h: 66, el };
  };

  // ---- Apple-style "Quit Apple Music?" alert
  VIEWS['t:confirmQuit'] = () => {
    const d = S.transient.data;
    const icon = d.source === 'spotify' ? I.spotify(40) : I.applemusic(40);
    const el = h(`<div class="alert">
      <div class="aicon">${icon}</div>
      <div class="atitle">Quit ${esc(d.name)}?</div>
      <div class="amsg">Music will stop playing and ${esc(d.name)} will close.</div>
      <div class="abtns"><button class="abtn" data-act="cancel">Cancel</button><button class="abtn destructive" data-act="quit">Quit</button></div>
    </div>`);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      e.stopPropagation();
      if (!b) return;
      b.classList.add('tap');
      if (b.dataset.act === 'quit') {
        api.bridge({ cmd: 'quit-app', app: d.app || d.source || '' });
        if (S.media) { S.lastMedia = { ...S.media, status: 'paused' }; S.media = null; }
      }
      S.transient = null;
      render();
    });
    return { w: 300, el };
  };

  // ---- brightness HUD (drag to change)
  VIEWS['t:brightness'] = () => {
    const el = h(`<div class="vhud"><span class="ic sun">${I.sun(16)}</span><div class="bar"><div class="rail"><div class="fill"></div></div></div><span class="pct"></span></div>`);
    const bar = el.querySelector('.bar');
    const set = (e) => {
      const r = bar.getBoundingClientRect();
      S.brightness = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * 100);
      S.brightSetAt = Date.now();
      api.bridge({ cmd: 'brightness', value: S.brightness });
      S.transient.until = Date.now() + 1800;
      upd();
    };
    let drag = false;
    bar.addEventListener('pointerdown', (e) => { e.stopPropagation(); drag = true; bar.setPointerCapture(e.pointerId); S.pinned++; set(e); });
    bar.addEventListener('pointermove', (e) => { if (drag) set(e); });
    bar.addEventListener('pointerup', () => { drag = false; S.pinned = Math.max(0, S.pinned - 1); });
    function upd() {
      el.querySelector('.fill').style.width = `${S.brightness}%`;
      el.querySelector('.pct').textContent = `${S.brightness}`;
      el.querySelector('.sun').style.transform = `rotate(${S.brightness * 0.9}deg) scale(${0.85 + S.brightness / 400})`;
    }
    return { w: 380, h: 36, el, update: upd };
  };

  // ---- water reminder
  VIEWS['t:water'] = () => {
    const goal = (C().water && C().water.goal) || 8;
    const el = h(`<div class="water"><div class="ico">${I.drop(18)}</div><div class="grow"><div class="t-title" style="font-size:14.5px">Time for some water</div><div class="t-sub" style="font-size:12px">${S.water} of ${goal} glasses today</div></div>
      <button class="pill-btn blue" data-act="drank">Drank</button><button class="pill-btn" data-act="later">Later</button></div>`);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return; e.stopPropagation();
      if (b.dataset.act === 'drank') addWater();
      S.transient = null; render();
    });
    return { w: 420, h: 66, el };
  };
  function addWater() { S.water++; saveJSON(`water-${new Date().toDateString()}`, S.water); S.lastWater = Date.now(); }

  // ------------------------------------------------------------------ expanded pages
  VIEWS.page = (key) => {
    const p = key.split(':')[1];
    return ({ home: pageHome, music: pageMusic, calendar: pageCalendar, timer: pageTimer, todo: pageTodo, clipboard: pageClipboard, agents: pageAgents }[p] || pageHome)();
  };

  // ---- home: iOS-style widgets (Now Playing · Calendar · Focus · Batteries)
  // one row of the Batteries widget: small ring with the device glyph, its name, its percent
  function batteryRing(level, icon, color, charging, name = '') {
    const R = 13, C2 = 2 * Math.PI * R;
    const pct = level == null ? null : Math.round(level);
    const off = pct == null ? C2 : C2 * (1 - pct / 100);
    return `<div class="bat">
      <div class="ring2"><svg viewBox="0 0 30 30"><circle cx="15" cy="15" r="${R}" fill="none" stroke="rgba(255,255,255,.13)" stroke-width="2.2"/>
        <circle class="arc" cx="15" cy="15" r="${R}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-dasharray="${C2}" stroke-dashoffset="${off}" transform="rotate(-90 15 15)"/></svg>
        <span class="ic">${icon}</span></div>
      <div class="btxt"><span class="bname ellipsis" title="${esc(name)}">${esc(name)}</span>
      <span class="pc">${charging ? `<span class="bolt3">${I.bolt(9)}</span>` : ''}<span class="pv">${pct == null ? '—' : `${pct}%`}</span></span></div></div>`;
  }
  function pageHome() {
    const el = h(`<div class="page homex">
      <div class="wgrid">
        <div class="w wmusic" data-go="music">
          <div class="bgart"></div><div class="shade"></div>
          <div class="wtop"><div class="cov" data-act="open-app"></div><span class="src"></span></div>
          <div class="wti ellipsis"></div><div class="war ellipsis"></div>
          <div class="wctl"><button class="icon-btn am" data-act="prev">${I.prev(20)}</button><button class="icon-btn am big" data-act="toggle"></button><button class="icon-btn am" data-act="next">${I.next(20)}</button></div>
          <div class="wpb"><i></i></div>
        </div>
        <div class="w wcal" data-go="calendar"><div class="dow"></div><div class="dnum"></div><div class="nev"></div></div>
        <div class="w wfocus" data-go="timer"><div class="fhead"><span class="flabel"></span><button class="fbtn" data-act="focus-btn"></button></div><div class="fring"></div><div class="fsub"></div></div>
        <div class="w wbat"></div>
      </div>
    </div>`);
    el.addEventListener('click', (e) => {
      const a = e.target.closest('[data-act]');
      if (a) {
        e.stopPropagation();
        const act = a.dataset.act;
        a.classList.remove('tap'); void a.offsetWidth; a.classList.add('tap');
        if (act === 'open-app') openPlayerApp();
        else if (act === 'focus') startTimer((C().focus.minutes || 25) * 60, 'Focus', 'focus');
        else if (act === 'focus-btn') {
          const ft = S.timers.find((x) => x.kind === 'focus') || S.timers[0];
          if (!ft) startTimer((C().focus.minutes || 25) * 60, 'Focus', 'focus');
          else if (ft.paused) { ft.paused = false; ft.endsAt = Date.now() + ft.remaining * 1000; }
          else { ft.remaining = timerLeft(ft); ft.paused = true; }
          render();
        }
        else mediaCmd(act);
        return;
      }
      const c = e.target.closest('[data-go]');
      if (c) { e.stopPropagation(); goPage(c.dataset.go); }
    });
    const $m = el.querySelector('.wmusic');
    let artSig = null, calSig = '', batSig = '';
    function upd() {
      // Now Playing
      const m = S.media || S.lastMedia;
      const url = artUrl();
      if (url !== artSig) {
        artSig = url;
        $m.querySelector('.bgart').style.backgroundImage = url ? `url("${url}")` : '';
        const cov = $m.querySelector('.cov');
        cov.style.backgroundImage = url ? `url("${url}")` : '';
        cov.innerHTML = url ? '' : I.music(20);
        artColors(url, (c) => { $m.style.setProperty('--c1', c.dark); $m.style.setProperty('--c2', c.dark2); });
      }
      const playing = isPlaying();
      $m.classList.toggle('playing', playing);
      $m.querySelector('.wti').textContent = m ? m.title : 'Not Playing';
      $m.querySelector('.war').textContent = m ? (m.artist || '') : 'Apple Music';
      $m.querySelector('.src').innerHTML = m && m.source === 'spotify' ? I.spotify(16) : I.applemusic(16);
      const tb = $m.querySelector('[data-act=toggle]');
      if (tb.dataset.s !== String(playing)) { tb.dataset.s = String(playing); tb.innerHTML = playing ? I.pause(24) : I.play(24); }
      const dur = S.media && S.media.duration;
      $m.querySelector('.wpb i').style.width = `${dur ? (mediaPos() / dur) * 100 : 0}%`;

      // Calendar
      const d = new Date();
      const ev = nextEvent();
      const cs = [d.toDateString(), ev && ev.title, ev && ev.start].join('|');
      if (cs !== calSig) {
        calSig = cs;
        el.querySelector('.dow').textContent = d.toLocaleString('en', { weekday: 'long' }).toUpperCase();
        el.querySelector('.dnum').textContent = d.getDate();
        el.querySelector('.nev').innerHTML = ev
          ? `<span class="bar3" style="background:${esc(evColor(ev))}"></span><div><div class="et ellipsis">${esc(ev.title)}</div><div class="es">${hhmm(ev.start)} – ${hhmm(ev.end)}</div></div>`
          : '<div class="es">No more events today</div>';
      }

      // Focus / timer ring
      const t = S.timers.find((x) => x.kind === 'focus') || S.timers[0];
      const R = 26, C2 = 2 * Math.PI * R;
      const total = t ? t.total : (C().focus.minutes || 25) * 60;
      const left = t ? timerLeft(t) : total;
      const col = t ? timerColor(t) : '#bf5af2';
      el.querySelector('.flabel').textContent = t ? (t.kind === 'focus' ? 'Focus' : t.label) : 'Focus';
      el.querySelector('.fring').innerHTML = `<svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="${R}" fill="none" stroke="${col}" stroke-opacity=".22" stroke-width="6"/>
        <circle cx="32" cy="32" r="${R}" fill="none" stroke="${col}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${C2}" stroke-dashoffset="${C2 * (1 - left / total)}" transform="rotate(-90 32 32)"/></svg>
        <span class="ft tabular" style="color:${col}">${fmt(Math.ceil(left))}</span>`;
      el.querySelector('.fsub').textContent = t ? (t.paused ? 'Paused' : 'Remaining') : `${C().focus.minutes || 25} min session`;
      const fb = el.querySelector('.fbtn');
      const fs = t ? (t.paused ? 'play' : 'pause') : 'start';
      if (fb.dataset.s !== fs) { fb.dataset.s = fs; fb.innerHTML = fs === 'pause' ? I.pause(10) : I.play(10); fb.title = fs === 'start' ? 'Start focus' : fs === 'pause' ? 'Pause' : 'Resume'; fb.style.color = col; }

      // Batteries (this PC + Bluetooth devices), like the iOS Batteries widget
      const b = S.battery;
      const items = [];
      if (b) items.push(batteryRing(b.level * 100, I.laptop(14), b.level <= 0.2 && !b.charging ? '#ff453a' : '#30d158', b.charging, 'This PC'));
      for (const dv of S.btDevices.slice(0, 3)) {
        items.push(batteryRing(dv.battery, devIcon(dv.kind).replace(/width="22" height="22"/, 'width="14" height="14"'), dv.battery != null && dv.battery <= 20 ? '#ff453a' : '#30d158', false, dv.name));
      }
      const extra = '';
      const bs = items.join('');
      if (bs !== batSig) { batSig = bs; el.querySelector('.wbat').innerHTML = `<div class="bhead">Batteries</div><div class="bats">${items.join('') || '<span class="bnone">No devices</span>'}</div>`; }
    }
    return { w: 556, el, update: upd };
  }

  // ---- music page (always available, even when nothing is playing)
  function pageMusic() {
    const m0 = S.media || S.lastMedia;
    const glassy = glassStyleFor(m0);
    if (!S.media) return pageMusicEmpty(glassy);
    const left = `<button class="icon-btn small" data-act="shuffle" title="Shuffle">${I.shuffle(16)}</button>`;
    const right = `<button class="icon-btn small spk" data-act="appvol" title="${esc(appName(S.media))} volume">${I.speakerLoud(16)}</button>`;
    const el = h(`<div class="page">
      <div class="player ${glassy ? 'glassy' : ''}" style="padding-top:4px">
        <div class="lyr-wrap"><div style="flex:1;min-width:0">
        <div class="row head">
          <div class="art big link" data-act="open-app" title="Open the player"><div class="badge"></div></div>
          <div class="grow meta link" data-act="open-app" title="Open the player"><div class="t-title ellipsis title"></div><div class="t-sub ellipsis artist"></div><div class="album ellipsis"></div></div>
          <div class="hright"><span class="srcname"></span><div class="row" style="gap:6px"><button class="icon-btn lyrbtn" data-act="lyrics" title="Lyrics" style="width:30px;height:30px">${I.quote(15)}</button>${waveHtml(6)}</div></div>
        </div>
        <div class="row progress"><span class="time tabular el"></span><div class="bar"><div class="rail"><div class="fill"></div></div></div><span class="time tabular tot"></span></div>
        <div class="row controls">
          ${left}
          <button class="icon-btn" data-act="prev" title="Previous">${I.prev(26)}</button>
          <button class="icon-btn main" data-act="toggle" title="Play/Pause"></button>
          <button class="icon-btn" data-act="next" title="Next">${I.next(26)}</button>
          ${right}
        </div>
        <div class="row volume hide" style="display:none">
          <span class="vlo" style="color:#c7c7cc">${I.speaker(14)}</span>
          <div class="bar vol"><div class="rail"><div class="fill"></div></div></div>
          <span class="vpct tabular">—</span>
        </div>
        </div></div>
      </div>
    </div>`);
    const col = lyricColumn();
    col.el.style.height = '150px';
    col.el.style.flex = '0 0 210px';
    const wrap = el.querySelector('.lyr-wrap');

    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      e.stopPropagation();
      const act = b.dataset.act;
      if (act === 'fav') {
        const k = mediaKey();
        if (S.favorites.has(k)) S.favorites.delete(k); else { S.favorites.add(k); b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }
        saveJSON('favs', [...S.favorites]); render(); return;
      }
      if (act === 'queue') { if (S.media && S.media.app) api.openApp(S.media.app); return; }
      if (act === 'output') { api.openSound(); return; }
      if (act === 'appvol') { S.appVolOpen = !S.appVolOpen; if (S.appVolOpen) api.bridge({ cmd: 'app-volume', app: S.media.app }); upd(); return; }
      if (['quit-ask', 'shrink', 'grow', 'pin-toggle', 'minimize', 'keep-open', 'restore', 'open-island'].includes(act)) { onMediaAct(e); return; }
      if (act === 'lyrics') { setLyricsShown(!lyricsShown()); upd(); relayout(); return; }
      if (act === 'open-app') { openPlayerApp(); return; }
      b.classList.remove('tap'); void b.offsetWidth; b.classList.add('tap');
      mediaCmd(act);
    });
    let dragFrac = null;
    bindSeek(el.querySelector('.progress .bar'), () => S.media && S.media.duration, (f) => { dragFrac = f; upd(); });
    const vrow = el.querySelector('.volume');
    const vbar = el.querySelector('.bar.vol');
    let vdrag = false;
    const fracAt = (x) => { const r = vbar.getBoundingClientRect(); return Math.max(0, Math.min(1, (x - r.left) / r.width)); };
    // volume here = only the music app's volume (Spotify / Apple Music / browser), not the whole PC
    const showVol = () => { S.volShownUntil = Date.now() + 2600; upd(); };
    let volSendT = 0;
    const sendAppVol = () => { const now = Date.now(); if (now - volSendT > 60) { volSendT = now; api.bridge({ cmd: 'app-volume', app: S.media.app, value: S.appVol }); } };
    el.addEventListener('wheel', (e) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey) return;
      e.preventDefault();
      if (S.appVol == null) S.appVol = 1;
      S.appVol = Math.max(0, Math.min(1, S.appVol - Math.sign(e.deltaY) * 0.04));
      sendAppVol();
      showVol();
    }, { passive: false });
    const setVol = (e) => { S.appVol = fracAt(e.clientX); sendAppVol(); showVol(); };
    if (S.media && S.media.app) api.bridge({ cmd: 'app-volume', app: S.media.app });
    vbar.addEventListener('pointerdown', (e) => { e.stopPropagation(); vdrag = true; vbar.setPointerCapture(e.pointerId); S.pinned++; setVol(e); });
    vbar.addEventListener('pointermove', (e) => { if (vdrag) setVol(e); });
    vbar.addEventListener('pointerup', () => { vdrag = false; S.pinned = Math.max(0, S.pinned - 1); });
    vbar.addEventListener('click', (e) => e.stopPropagation());

    let lastKey = '', volVisible = false, lyrShown = false;
    function upd() {
      const m = S.media;
      if (!m) return;
      el.style.setProperty('--accent', accentFor(m.source));
      bindArt(el);
      const badge = el.querySelector('.badge');
      const src = !glassy && m.source === 'spotify' ? I.spotify(18) : !glassy && m.source === 'applemusic' ? I.applemusic(18) : '';
      if (badge.dataset.src !== m.source) { badge.dataset.src = m.source; badge.innerHTML = src; badge.style.display = src ? '' : 'none'; }
      if (mediaKey() !== lastKey) {
        lastKey = mediaKey();
        el.querySelector('.title').textContent = m.title || 'Unknown';
        el.querySelector('.artist').textContent = m.artist || '';
        const alb = el.querySelector('.album');
        alb.innerHTML = m.album ? `${I.note(9)}<span class="ellipsis">${esc(m.album)}</span>` : '';
        alb.style.display = m.album ? '' : 'none';
      }
      const hasLyr = S.lyrics.key === mediaKey() && S.lyrics.status === 'ok';
      const lb = el.querySelector('.lyrbtn');
      lb.style.display = (C().lyrics && C().lyrics.enabled) ? '' : 'none';
      lb.classList.toggle('on', lyricsShown());
      lb.title = lyricsShown() ? 'Turn lyrics off' : 'Turn lyrics on';
      lb.style.color = lyricsShown() ? 'var(--accent)' : hasLyr ? '#fff' : '#636366';
      const wantLyr = lyricsShown();
      if (wantLyr !== lyrShown) {
        lyrShown = wantLyr;
        if (wantLyr) wrap.appendChild(col.el); else col.el.remove();
        relayout();
      }
      if (lyrShown) col.update();
      const playing = m.status === 'playing';
      setWave(el, playing);
      const pp = el.querySelector('[data-act=toggle]');
      if (pp.dataset.s !== String(playing)) { pp.dataset.s = String(playing); pp.innerHTML = playing ? I.pause(30) : I.play(30); }
      const sh = el.querySelector('[data-act=shuffle]');
      if (sh) sh.classList.toggle('on', !!m.shuffle);
      const fav = el.querySelector('[data-act=fav]');
      if (fav) {
        const isFav = S.favorites.has(mediaKey());
        if (fav.dataset.s !== String(isFav)) { fav.dataset.s = String(isFav); fav.innerHTML = I.star(17, isFav); fav.classList.toggle('on', isFav); }
      }
      const pos = dragFrac !== null ? dragFrac * m.duration : mediaPos();
      el.querySelector('.el').textContent = fmt(pos);
      el.querySelector('.tot').textContent = m.duration ? fmt(m.duration) : '--:--';
      el.querySelector('.progress .fill').style.width = `${m.duration ? (pos / m.duration) * 100 : 0}%`;
      const wantVol = S.appVolOpen || Date.now() < S.volShownUntil || vdrag;
      el.querySelector('.spk').classList.toggle('on', !!S.appVolOpen);
      el.querySelector('.srcname').textContent = appName(m);
      if (wantVol !== volVisible) {
        volVisible = wantVol;
        if (wantVol) { vrow.style.display = ''; requestAnimationFrame(() => vrow.classList.remove('hide')); }
        else { vrow.classList.add('hide'); setTimeout(() => { if (!volVisible) vrow.style.display = 'none'; }, 280); }
      }
      const av = S.appVol == null ? null : S.appVol;
      vbar.querySelector('.fill').style.width = `${(av == null ? 1 : av) * 100}%`;
      el.querySelector('.vpct').textContent = av == null ? '—' : `${Math.round(av * 100)}%`;
    }
    return { w: 470, width: () => (lyricsShown() ? 680 : 470), el, update: upd };
  }
  // ---- AI agents: everything that is working, waiting on you, or just finished
  function pageAgents() {
    const el = h(`<div class="page agpage"><div class="aghead"><span class="t">AI Agents</span><span class="cnt"></span><button class="pill-btn clr" style="display:none">Clear finished</button></div><div class="aglist"></div></div>`);
    const list = el.querySelector('.aglist');
    const rank = (x) => (x.state === 'waiting' ? 0 : x.state === 'editing' ? 1 : 2);
    const row = (x) => `<div class="agrow st-${x.state}" data-k="${x.key}">${agentIcon(x.key, 30)}
      <div class="grow" style="min-width:0"><div class="agn">${esc(x.name || agentMeta(x.key).name)}</div><div class="agd ellipsis">${esc(x.detail || (x.state === 'done' ? 'Finished' : x.state === 'waiting' ? 'Needs your input' : 'Working…'))}</div></div>
      <div class="agst">${x.state === 'editing' ? agentBars(agentMeta(x.key).color) : x.state === 'waiting' ? '<span class="agpill ap-wait">Needs input</span>' : '<span class="agpill ap-done">Done</span>'}<span class="agtime tabular"></span></div></div>`;
    let sig = null;
    function upd() {
      const arr = Object.values(S.agents || {}).sort((p, q) => rank(p) - rank(q) || q.updated - p.updated);
      const s2 = arr.map((x) => `${x.key}:${x.state}:${x.detail || ''}:${S.agentIcons[x.key] ? 1 : 0}`).join('|');
      if (s2 !== sig) {
        sig = s2;
        list.innerHTML = arr.length ? arr.map(row).join('')
          : `<div class="agempty"><span class="spark">${I.sparkle(18)}</span><b>No agents running</b><span>Claude, Codex, Copilot, ChatGPT and others appear here while they work</span></div>`;
        el.querySelector('.clr').style.display = arr.some((x) => x.state === 'done') ? '' : 'none';
      }
      list.querySelectorAll('[data-k]').forEach((r) => {
        const x = S.agents[r.dataset.k];
        if (!x) return;
        const t = x.state === 'done' ? `worked ${fmtDur(x.took || 0)}` : fmtDur((Date.now() - x.since) / 1000);
        const tm = r.querySelector('.agtime');
        if (tm.textContent !== t) tm.textContent = t;
      });
      const n = arr.filter((x) => x.state !== 'done').length;
      el.querySelector('.cnt').textContent = n ? `${n} working` : '';
    }
    el.querySelector('.clr').addEventListener('click', (e) => {
      e.stopPropagation();
      for (const [k, x] of Object.entries(S.agents)) if (x.state === 'done') delete S.agents[k];
      upd();
    });
    upd();
    return { w: 470, el, update: upd };
  }

  function pageMusicEmpty(glassy) {
    const lm = S.lastMedia;
    const el = h(`<div class="page"><div class="player ${glassy ? 'glassy' : ''}" style="padding-top:6px">
      <div class="empty"><div class="art big">${lm ? '' : I.music(22)}</div>
        <div class="grow meta" style="min-width:0"><div class="t-title ellipsis title" style="font-size:15px">${esc(lm ? lm.title : 'Not Playing')}</div>
        <div class="t-sub ellipsis">${esc(lm ? `${lm.artist} · paused` : 'Start something in Apple Music or Spotify')}</div></div>
        ${lm ? `<button class="icon-btn main" data-act="resume" style="width:44px;height:44px">${I.play(28)}</button>` : ''}</div>
      <div class="launch">
        <button class="pill-btn" data-open="AppleInc.AppleMusicWin_nzyj5cx40ttqa!App">${I.applemusic(14)} Apple Music</button>
        <button class="pill-btn" data-open="Spotify">${I.spotify(14)} Spotify</button>
      </div></div></div>`);
    if (lm) bindArt(el);
    el.addEventListener('click', (e) => {
      const o = e.target.closest('[data-open]');
      const r = e.target.closest('[data-act=resume]');
      if (o) { e.stopPropagation(); api.openApp(o.dataset.open); }
      if (r) { e.stopPropagation(); if (lm && lm.app) api.openApp(lm.app); }
    });
    return { w: 470, el };
  }

  // ---- calendar: sliding selection bubble, odometer roll (no overlap), sequential event swap
  function rollTo(box, text, dir) {
    if (box.dataset.v === String(text)) return;
    const first = box.dataset.v === undefined;
    box.dataset.v = String(text);
    // anything still animating out is removed right away, so fast clicks never stack up
    box.querySelectorAll('span.leaving').forEach((s) => s.remove());
    const old = box.querySelector('span.cur');
    const n = document.createElement('span');
    n.textContent = text;
    if (first) { n.className = 'cur'; box.appendChild(n); return; }
    n.className = dir >= 0 ? 'from-below' : 'from-above';
    box.appendChild(n);
    void n.offsetWidth;
    n.className = 'cur';
    if (old) {
      old.className = `leaving ${dir >= 0 ? 'to-above' : 'to-below'}`;
      setTimeout(() => old.remove(), 480);
    }
  }
  function eventsOn(day) {
    const a = day.getTime(), b = a + 864e5;
    return S.calendar.filter((e) => e.end > a && e.start < b).sort((x, y) => x.start - y.start);
  }
  function pageCalendar() {
    const today = dayStart(new Date());
    const monFirst = !C().calendar || C().calendar.weekStartsMonday !== false;
    if (!S.calSel) S.calSel = today;
    S.calMonth = { y: S.calSel.getFullYear(), m: S.calSel.getMonth() };
    const el = h(`<div class="page"><div class="cal2">
      <div class="left">
        <div class="wk roll2"></div>
        <div class="num roll2"></div>
        <div class="evs"></div>
      </div>
      <div class="right">
        <div class="mh"><span class="mn"></span><span class="yr"></span>
          <div class="nav"><button class="icon-btn addev" data-cact="add" title="New event">${I.plus(11)}</button><button class="icon-btn" data-nav="-1">${I.chevL(12)}</button><button class="icon-btn" data-nav="1">${I.chevR(12)}</button></div></div>
        <div class="gridwrap"><div class="bubble"></div></div>
      </div>
    </div></div>`);
    const $wk = el.querySelector('.wk');
    const $num = el.querySelector('.num');
    const $evs = el.querySelector('.evs');
    const $grid = el.querySelector('.gridwrap');
    const $bubble = el.querySelector('.bubble');

    function gridHtml(y, m, cls) {
      const first = new Date(y, m, 1);
      const lead = monFirst ? (first.getDay() + 6) % 7 : first.getDay();
      const days = new Date(y, m + 1, 0).getDate();
      const marks = new Set();
      if (C().calendar.showDots !== false) for (const e of S.calendar) { const d = new Date(e.start); if (d.getFullYear() === y && d.getMonth() === m) marks.add(d.getDate()); }
      const heads = monFirst ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
      const isWe = (col) => (monFirst ? col > 4 : col === 0 || col === 6);
      let s = `<div class="g ${cls || ''}">`;
      heads.forEach((d, i) => { s += `<div class="wd ${isWe(i) ? 'we' : ''}">${d}</div>`; });
      for (let i = 0; i < lead; i++) s += '<div class="d blank"><span></span></div>';
      for (let d = 1; d <= days; d++) {
        const dt = new Date(y, m, d);
        const col = (lead + d - 1) % 7;
        const isToday = dt.getTime() === today.getTime();
        const isSel = S.calSel && dt.getTime() === S.calSel.getTime();
        s += `<div class="d ${isWe(col) ? 'we' : ''} ${isToday ? 'today' : ''} ${isSel ? 'sel' : ''}" data-day="${d}"><span>${d}</span>${marks.has(d) ? '<i class="ed"></i>' : ''}</div>`;
      }
      return s + '</div>';
    }
    function liveGrid() { return $grid.querySelector('.g:not(.out-l):not(.out-r)'); }
    function placeBubble(animate = true) {
      const g = liveGrid();
      const cell = g && g.querySelector('.d.sel span');
      const isToday = g && g.querySelector('.d.sel.today');
      if (!cell || isToday) { $bubble.style.opacity = '0'; return; }
      const gr = $grid.getBoundingClientRect(), cr = cell.getBoundingClientRect();
      const z = gr.width / $grid.offsetWidth || 1;
      const x = (cr.left - gr.left) / z, y = (cr.top - gr.top) / z;
      if (!animate) { $bubble.style.transition = 'none'; }
      $bubble.style.transform = `translate(${x}px, ${y}px)`;
      $bubble.style.opacity = '1';
      if (!animate) { void $bubble.offsetWidth; $bubble.style.transition = ''; }
    }
    function drawGrid(dir = 0) {
      const { y, m } = S.calMonth;
      el.querySelector('.mn').textContent = new Date(y, m, 1).toLocaleString('en', { month: 'long' }).toUpperCase();
      el.querySelector('.yr').textContent = y;
      const old = liveGrid();
      if (old && dir) {
        $bubble.style.opacity = '0';
        old.classList.add(dir > 0 ? 'out-l' : 'out-r');
        setTimeout(() => old.remove(), 320);
        $grid.insertAdjacentHTML('beforeend', gridHtml(y, m, dir > 0 ? 'in-r' : 'in-l'));
        setTimeout(() => placeBubble(false), 460);
      } else {
        $grid.querySelectorAll('.g').forEach((g) => g.remove());
        $grid.insertAdjacentHTML('beforeend', gridHtml(y, m));
        requestAnimationFrame(() => placeBubble(false));
      }
    }
    let evToken = 0;
    function drawDay(dir = 0) {
      const d = S.calSel;
      rollTo($wk, d.toLocaleString('en', { weekday: 'long' }).toUpperCase(), dir);
      rollTo($num, d.getDate(), dir);
      const evs = eventsOn(d).slice(0, 3);
      const html = evs.length ? evs.map((e, i) => `<div class="card ${e.url ? 'link' : ''}" style="--c:${esc(evColor(e))};--i:${i}" ${e.url ? `data-url="${esc(e.url)}"` : ''}>
          <div class="bar2"></div><div class="grow"><div class="t ellipsis">${esc(e.title)}</div><div class="tm tabular">${e.allDay ? 'All day' : `${hhmm(e.start)} – ${hhmm(e.end)}`}</div></div>${e.local ? `<button class="icon-btn evdel" data-cact="del" data-start="${e.start}" data-title="${esc(e.title)}" title="Delete event">${I.x(8)}</button>` : ''}</div>`).join('')
        : `<div class="none">${d.getTime() === today.getTime() ? 'No events today' : 'No events'}</div>`;
      const token = ++evToken;
      const old = $evs.querySelector('.evlist');
      const swapIn = () => {
        if (token !== evToken) return;
        $evs.innerHTML = `<div class="evlist">${html}</div>`;
        // release the held height on the next frame: the island then morphs straight to the new size
        requestAnimationFrame(() => { if (token === evToken) $evs.style.minHeight = ''; });
      };
      if (old && dir) {
        $evs.style.minHeight = `${$evs.offsetHeight}px`; // hold the height so the island never dips mid-swap
        old.classList.add('fading');
        setTimeout(swapIn, 150);
      } else swapIn();
    }
    // ---- new event form (shown in the left column for the selected day)
    const EV_COLORS = ['#0a84ff', '#ff453a', '#30d158', '#ff9f0a', '#bf5af2'];
    function openForm() {
      const d = S.calSel;
      const now = new Date();
      const startH = d.toDateString() === now.toDateString() ? Math.min(23, now.getHours() + 1) : 9;
      const pad = (n) => String(n).padStart(2, '0');
      $evs.style.minHeight = '';
      $evs.innerHTML = `<div class="evform">
        <input class="evt" placeholder="Event title" maxlength="60" spellcheck="false" />
        <div class="evtimes"><input type="time" class="evs1" value="${pad(startH)}:00" /><span>–</span><input type="time" class="evs2" value="${pad(Math.min(23, startH + 1))}:00" /></div>
        <div class="evcolors">${EV_COLORS.map((c, i) => `<button class="evc ${i === 0 ? 'on' : ''}" data-color="${c}" style="background:${c}"></button>`).join('')}</div>
        <div class="evbtns"><button class="pill-btn" data-cact="cancel">Cancel</button><button class="start-btn evsave" data-cact="save">Add</button></div>
      </div>`;
      const t = $evs.querySelector('.evt');
      t.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); saveForm(); } if (ev.key === 'Escape') drawDay(); });
      setTimeout(() => t.focus(), 60);
    }
    function saveForm() {
      const title = ($evs.querySelector('.evt').value || '').trim();
      if (!title) { $evs.querySelector('.evt').classList.add('shake'); setTimeout(() => $evs.querySelector('.evt') && $evs.querySelector('.evt').classList.remove('shake'), 400); return; }
      const [h1, m1] = ($evs.querySelector('.evs1').value || '09:00').split(':').map(Number);
      const [h2, m2] = ($evs.querySelector('.evs2').value || '10:00').split(':').map(Number);
      const d = S.calSel;
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h1, m1);
      let end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h2, m2);
      if (end <= start) end = new Date(start.getTime() + 3600000);
      const color = ($evs.querySelector('.evc.on') || {}).dataset ? $evs.querySelector('.evc.on').dataset.color : '#0a84ff';
      const ev = { title, start: start.toISOString(), end: end.toISOString(), color };
      const list = [...(C().localEvents || []), ev];
      S.config.localEvents = list;
      if (api.setConfig) api.setConfig({ localEvents: list }).catch(() => {});
      // show it right away; the calendar refresh from disk follows
      S.calendar = [...S.calendar, { title, start: start.getTime(), end: end.getTime(), color, local: true }].sort((a, b) => a.start - b.start);
      drawGrid(); drawDay();
    }
    function deleteEvent(btn) {
      const start = +btn.dataset.start, title = btn.dataset.title;
      const list = (C().localEvents || []).filter((x) => !(x.title === title && new Date(x.start).getTime() === start));
      S.config.localEvents = list;
      if (api.setConfig) api.setConfig({ localEvents: list }).catch(() => {});
      S.calendar = S.calendar.filter((x) => !(x.local && x.title === title && x.start === start));
      drawGrid(); drawDay();
    }
    el.addEventListener('click', (e) => {
      const ca = e.target.closest('[data-cact]');
      const col = e.target.closest('.evc');
      if (col) { e.stopPropagation(); $evs.querySelectorAll('.evc').forEach((x) => x.classList.toggle('on', x === col)); return; }
      if (ca) {
        e.stopPropagation();
        const a = ca.dataset.cact;
        if (a === 'add') openForm();
        else if (a === 'cancel') drawDay();
        else if (a === 'save') saveForm();
        else if (a === 'del') deleteEvent(ca);
        return;
      }
      if (e.target.closest('.evform')) { e.stopPropagation(); return; }
      const nav = e.target.closest('[data-nav]');
      const day = e.target.closest('.d[data-day]');
      const card = e.target.closest('.card[data-url]');
      if (!nav && !day && !card) return;
      e.stopPropagation();
      if (card) { api.openUrl(card.dataset.url); return; }
      if (nav) {
        const step = +nav.dataset.nav;
        const nm = new Date(S.calMonth.y, S.calMonth.m + step, 1);
        S.calMonth = { y: nm.getFullYear(), m: nm.getMonth() };
        drawGrid(step);
        return;
      }
      const nd = new Date(S.calMonth.y, S.calMonth.m, +day.dataset.day);
      if (nd.getTime() === S.calSel.getTime()) return;
      const dir = nd > S.calSel ? 1 : -1;
      S.calSel = nd;
      liveGrid().querySelectorAll('.d.sel').forEach((x) => x.classList.remove('sel'));
      day.classList.add('sel');
      placeBubble(true);
      drawDay(dir);
    });
    drawGrid();
    drawDay();
    let calSig = S.calendar.length;
    return {
      w: 560, el,
      update() { if (S.calendar.length !== calSig) { calSig = S.calendar.length; drawGrid(); drawDay(); } },
      destroy() { S.calSel = null; },
    };
  }

  // ---- Timer page: [Timer | Alarms] — running timers are listed here too, so a Focus started
  //      from Home (or anywhere) shows up and can be paused / cancelled
  function pageTimer() {
    const el = h(`<div class="page tpage">
      <div class="tseg"><button data-tab="timer">Timer</button><button data-tab="alarm">Alarms</button><i class="tink"></i></div>
      <div class="tbody"></div>
    </div>`);
    const body = el.querySelector('.tbody');
    let sub = null;
    function show(tab, animate) {
      S.timerTab = tab;
      el.querySelectorAll('.tseg button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
      el.querySelector('.tink').style.transform = `translateX(${tab === 'alarm' ? 100 : 0}%)`;
      sub = tab === 'alarm' ? alarmBody() : timerBody();
      body.innerHTML = '';
      if (animate) sub.el.classList.add('swapin');
      body.appendChild(sub.el);
      sub.update && sub.update();
    }
    el.querySelector('.tseg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      e.stopPropagation();
      if (b.dataset.tab !== S.timerTab) show(b.dataset.tab, true);
    });
    show(S.timerTab || 'timer', false);
    return { w: 470, el, update() { sub && sub.update && sub.update(); } };
  }

  // running timers (pause / resume / cancel), shared by the Timer page
  function runningTimersEl() {
    const box = h('<div class="running"></div>');
    let sig = '';
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tact]');
      if (!b) return;
      e.stopPropagation();
      const t = S.timers.find((x) => x.id === +b.closest('.rt').dataset.id);
      if (!t) return;
      if (b.dataset.tact === 'pause') {
        if (t.paused) { t.paused = false; t.endsAt = Date.now() + t.remaining * 1000; } else { t.remaining = timerLeft(t); t.paused = true; }
      } else S.timers = S.timers.filter((x) => x !== t);
      sig = '';
      update();
      render();
    });
    function update() {
      const s = S.timers.map((t) => `${t.id}:${t.paused}`).join(',');
      if (s !== sig) {
        sig = s;
        box.innerHTML = S.timers.map((t) => `<div class="rt" data-id="${t.id}" style="--tc:${timerColor(t)}">
          <span class="rlbl">${esc(t.label)}</span><span class="rtime tabular"></span>
          <button class="round tbtn" data-tact="pause" title="${t.paused ? 'Resume' : 'Pause'}">${t.paused ? I.play(12) : I.pause(12)}</button>
          <button class="round g" data-tact="cancel" title="Cancel">${I.x(10)}</button>
          <i class="rbar"><b></b></i></div>`).join('');
        box.style.display = S.timers.length ? '' : 'none';
      }
      box.querySelectorAll('.rt').forEach((row) => {
        const t = S.timers.find((x) => x.id === +row.dataset.id);
        if (!t) return;
        const left = timerLeft(t);
        row.querySelector('.rtime').textContent = fmt(Math.ceil(left));
        row.querySelector('.rbar b').style.width = `${(1 - left / t.total) * 100}%`;
      });
    }
    return { el: box, update };
  }

  // ---- alarms (iPhone-style list with switches)
  const DAY_KEYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  function repeatText(days) {
    if (!days || !days.length) return 'Once';
    if (days.length === 7) return 'Every day';
    const set = [...days].sort().join(',');
    if (set === '1,2,3,4,5') return 'Weekdays';
    if (set === '0,6') return 'Weekends';
    return days.slice().sort().map((d) => DAY_KEYS[d]).join(' ');
  }
  function saveAlarms() { saveJSON('alarms', S.alarms); }
  function alarmBody() {
    const el = h(`<div class="alarms">
      <div class="alist"></div>
      <div class="aadd">
        <input type="time" class="atime" value="07:00" />
        <input class="alabel" placeholder="Alarm" maxlength="24" spellcheck="false" />
        <div class="adays">${[1, 2, 3, 4, 5, 6, 0].map((d) => `<button data-day="${d}">${DAY_KEYS[d][0]}</button>`).join('')}</div>
        <button class="start-btn aplus" data-aact="add">Add</button>
      </div>
    </div>`);
    const list = el.querySelector('.alist');
    let sig = '';
    function draw() {
      list.innerHTML = S.alarms.length ? S.alarms.map((a) => `<div class="arow ${a.on ? '' : 'off'}" data-id="${a.id}">
          <div class="atxt"><div class="abig tabular">${esc(a.time)}</div><div class="asub">${esc(a.label || 'Alarm')}, ${repeatText(a.days)}</div></div>
          <button class="icon-btn adel" data-aact="del" title="Delete">${I.x(9)}</button>
          <button class="aswitch ${a.on ? 'on' : ''}" data-aact="toggle" title="${a.on ? 'Turn off' : 'Turn on'}"></button>
        </div>`).join('')
        : '<div class="anone">No alarms yet</div>';
    }
    el.querySelector('.adays').addEventListener('click', (e) => { const b = e.target.closest('[data-day]'); if (b) { e.stopPropagation(); b.classList.toggle('on'); } });
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-aact]');
      if (!b) return;
      e.stopPropagation();
      if (b.dataset.aact === 'add') {
        const time = el.querySelector('.atime').value || '07:00';
        const label = el.querySelector('.alabel').value.trim() || 'Alarm';
        const days = [...el.querySelectorAll('.adays .on')].map((x) => +x.dataset.day);
        S.alarms.push({ id: Date.now(), time, label, days, on: true });
        S.alarms.sort((x, y) => x.time.localeCompare(y.time));
        el.querySelector('.alabel').value = '';
        el.querySelectorAll('.adays .on').forEach((x) => x.classList.remove('on'));
        saveAlarms(); sig = ''; draw();
        return;
      }
      const row = b.closest('.arow');
      const a = row && S.alarms.find((x) => x.id === +row.dataset.id);
      if (!a) return;
      if (b.dataset.aact === 'toggle') { a.on = !a.on; a.firedKey = ''; }
      if (b.dataset.aact === 'del') S.alarms = S.alarms.filter((x) => x !== a);
      saveAlarms(); sig = ''; draw();
    });
    return { el, update() { const s = JSON.stringify(S.alarms); if (s !== sig) { sig = s; draw(); } } };
  }

  // alarms fire on the minute (checked by the ticker); snooze = 9 minutes, like iPhone
  function checkAlarms() {
    const d = new Date();
    const hhmmNow = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const key = `${d.toDateString()} ${hhmmNow}`;
    for (const a of S.alarms) {
      if (!a.on || a.time !== hhmmNow || a.firedKey === key) continue;
      if (a.days && a.days.length && !a.days.includes(d.getDay())) continue;
      a.firedKey = key;
      if (!a.days || !a.days.length) a.on = false;     // "Once" alarms switch themselves off
      saveAlarms();
      ringAlarm({ time: a.time, label: a.label || 'Alarm' });
    }
    for (const s of [...S.snoozes]) {
      if (Date.now() >= s.at) { S.snoozes = S.snoozes.filter((x) => x !== s); ringAlarm(s.alarm); }
    }
  }
  function ringAlarm(alarm) {
    showTransient('alarm', alarm, 0);
    startChime(true);
  }

  // ---- Timer half: running timers + presets + ruler picker
  function timerBody() {
    const PPM = 9, MAX = 180, W = 442;
    const el = h(`<div class="tbodyin"><div class="presets">
        <button class="pill-btn focus" data-preset="focus">${I.timer(11)} Focus ${C().focus.minutes || 25}</button>
        <button class="pill-btn brk" data-preset="break">Break ${C().focus.breakMinutes || 5}</button>
      </div><div class="picker">
      <div class="ruler"><div class="strip"></div><div class="needle"></div><div class="caret"></div></div>
      <div class="foot"><button class="start-btn" data-act="start">Start Timer</button><input class="label" value="Timer" maxlength="24" spellcheck="false" /><span class="val tabular"></span></div>
    </div></div>`);
    const ruler = el.querySelector('.ruler');
    const strip = el.querySelector('.strip');
    let ticks = '';
    for (let m = 0; m <= MAX; m++) {
      ticks += `<div class="tick ${m % 5 === 0 ? 'major' : ''}" style="left:${m * PPM}px"></div>`;
      if (m % 5 === 0 && m) ticks += `<div class="num" data-m="${m}" style="left:${m * PPM}px">${m}</div>`;
    }
    strip.innerHTML = ticks;
    strip.style.width = `${MAX * PPM + 2}px`;
    let value = S.lastTimerMinutes || 10;
    let anim = null;
    function place() {
      strip.style.transform = `translateX(${W / 2 - value * PPM}px)`;
      const rounded = Math.round(value);
      el.querySelector('.val').textContent = `${rounded}:00`;
      strip.querySelectorAll('.num').forEach((n) => n.classList.toggle('sel', +n.dataset.m === rounded));
    }
    function snap() {
      const target = Math.max(1, Math.min(MAX, Math.round(value)));
      const sp = new Spring(value, { response: 0.35, damping: 0.85 });
      sp.target = target;
      cancelAnimationFrame(anim);
      let last = performance.now();
      const loop = (now) => { const dt = Math.min(0.05, (now - last) / 1000); last = now; for (let i = 0; i < 4; i++) sp.step(dt / 4); value = sp.value; place(); if (!sp.resting) anim = requestAnimationFrame(loop); else { value = target; place(); } };
      anim = requestAnimationFrame(loop);
    }
    let drag = null;
    ruler.addEventListener('pointerdown', (e) => { e.stopPropagation(); cancelAnimationFrame(anim); drag = { x: e.clientX, v: value }; ruler.setPointerCapture(e.pointerId); S.pinned++; });
    ruler.addEventListener('pointermove', (e) => { if (!drag) return; value = Math.max(1, Math.min(MAX, drag.v - (e.clientX - drag.x) / PPM)); place(); });
    const end = () => { if (!drag) return; drag = null; S.pinned = Math.max(0, S.pinned - 1); snap(); };
    ruler.addEventListener('pointerup', end);
    ruler.addEventListener('pointercancel', end);
    ruler.addEventListener('click', (e) => e.stopPropagation());
    let wheelT = null;
    ruler.addEventListener('wheel', (e) => {
      e.preventDefault(); cancelAnimationFrame(anim);
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      value = Math.max(1, Math.min(MAX, value + d / 40)); place();
      clearTimeout(wheelT); wheelT = setTimeout(snap, 140);
    }, { passive: false });
    const input = el.querySelector('input.label');
    input.addEventListener('focus', () => { S.pinned++; input.select(); });
    input.addEventListener('blur', () => { S.pinned = Math.max(0, S.pinned - 1); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } if (e.key === 'Escape') input.blur(); });
    input.addEventListener('click', (e) => e.stopPropagation());
    function go() {
      const mins = Math.max(1, Math.round(value));
      S.lastTimerMinutes = mins;
      input.blur();
      startTimer(mins * 60, input.value.trim() || 'Timer');
      collapse();
    }
    el.addEventListener('click', (e) => {
      const p = e.target.closest('[data-preset]');
      if (p) {
        e.stopPropagation();
        if (p.dataset.preset === 'focus') startTimer((C().focus.minutes || 25) * 60, 'Focus', 'focus');
        else startTimer((C().focus.breakMinutes || 5) * 60, 'Break', 'break');
        collapse();
      }
    });
    el.querySelector('[data-act=start]').addEventListener('click', (e) => { e.stopPropagation(); go(); });
    const running = runningTimersEl();
    el.insertBefore(running.el, el.firstChild);
    requestAnimationFrame(place);
    return { el, update() { running.update(); } };
  }

  // ---- to-do
  function pageTodo() {
    const el = h(`<div class="page todo"><div class="add">${I.plus(12)}<input placeholder="Add a to-do and press Enter" maxlength="120" spellcheck="false"></div><ul></ul></div>`);
    const input = el.querySelector('input');
    const ul = el.querySelector('ul');
    function draw() {
      ul.innerHTML = S.todos.length ? S.todos.map((t, i) => `<li class="${t.done ? 'done' : ''}" data-i="${i}" style="animation-delay:${i * 30}ms"><span class="cb">${t.done ? I.check(11) : ''}</span><span class="tx ellipsis">${esc(t.text)}</span><button class="icon-btn del" data-del="${i}">${I.x(9)}</button></li>`).join('')
        : '<div class="emptyt">Nothing to do. Nice.</div>';
    }
    input.addEventListener('focus', () => { S.pinned++; });
    input.addEventListener('blur', () => { S.pinned = Math.max(0, S.pinned - 1); });
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) { S.todos.unshift({ text: input.value.trim(), done: false }); saveJSON('todos', S.todos); input.value = ''; draw(); }
      if (e.key === 'Escape') input.blur();
    });
    ul.addEventListener('click', (e) => {
      e.stopPropagation();
      const del = e.target.closest('[data-del]');
      if (del) { S.todos.splice(+del.dataset.del, 1); saveJSON('todos', S.todos); draw(); return; }
      const li = e.target.closest('li');
      if (li) {
        const t = S.todos[+li.dataset.i]; t.done = !t.done; saveJSON('todos', S.todos);
        li.classList.toggle('done', t.done); li.querySelector('.cb').innerHTML = t.done ? I.check(11) : '';
      }
    });
    draw();
    return { w: 470, el };
  }

  // ---- shelf (drag files in, drag them out, click to open)
  function pageShelf() {
    const el = h(`<div class="page shelf"><div class="bar2"><span class="ttl">Shelf</span><button class="clear">Clear all</button></div><div class="zone"></div></div>`);
    const zone = el.querySelector('.zone');
    function draw() {
      zone.classList.toggle('over', S.shelfOver);
      zone.innerHTML = S.shelf.length ? S.shelf.map((f) => `<div class="file" draggable="true" data-p="${esc(f.path)}" title="${esc(f.path)}"><div class="im" style="background-image:url('${f.thumb || f.icon || ''}')"></div><div class="nm">${esc(f.name)}</div><div class="sz">${f.dir ? 'Folder' : sizeFmt(f.size)}</div></div>`).join('')
        : `<div class="hint">${I.tray(22)}<br>Drop files here<small>Drag out anytime · click to open</small></div>`;
      el.querySelector('.clear').style.display = S.shelf.length ? '' : 'none';
    }
    zone.addEventListener('click', (e) => { const f = e.target.closest('.file'); if (f) { e.stopPropagation(); api.shelfOpen(f.dataset.p); } });
    zone.addEventListener('dragstart', (e) => { const f = e.target.closest('.file'); if (f) { e.preventDefault(); api.shelfDrag(f.dataset.p); } });
    el.querySelector('.clear').addEventListener('click', async (e) => { e.stopPropagation(); S.shelf = await api.shelfRemove(null); draw(); });
    let sig = '';
    return { w: 520, el, update() { const s = S.shelf.map((f) => f.path).join('|') + S.shelfOver; if (s !== sig) { sig = s; draw(); } } };
  }

  // ---- clipboard history: everything you copy, click to copy it again
  function timeAgo(ms) {
    const s = (Date.now() - ms) / 1000;
    if (s < 60) return 'now';
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    if (s < 86400) return `${Math.floor(s / 3600)}h`;
    return `${Math.floor(s / 86400)}d`;
  }
  function pageClipboard() {
    const el = h(`<div class="page clipp"><div class="cliphead"><span class="ttl">Clipboard</span><span class="cnt"></span><button class="clear">Clear</button></div><div class="cliplist"></div></div>`);
    const list = el.querySelector('.cliplist');
    let sig = '';
    function draw() {
      const items = S.clips.slice(0, 40);
      el.querySelector('.cnt').textContent = items.length ? `${items.length}` : '';
      el.querySelector('.clear').style.display = items.some((c) => !c.pinned) ? '' : 'none';
      list.innerHTML = items.length ? items.map((c, i) => `<div class="clip ${c.pinned ? 'pinned' : ''}" data-id="${esc(c.id)}" style="--i:${Math.min(i, 8)}">
          ${c.type === 'image' ? `<div class="cimg" style="background-image:url('${c.thumb}')"></div><div class="cmeta"><div class="ctext">Image</div><div class="csub">${c.w}×${c.h}</div></div>`
            : `<div class="cicon">${/^https?:\/\//i.test(c.text.trim()) ? '🔗' : 'Aa'}</div><div class="cmeta"><div class="ctext">${esc(c.text.trim().slice(0, 300))}</div></div>`}
          <span class="ctime">${timeAgo(c.at)}</span>
          <button class="icon-btn cpin" data-act="pin" title="${c.pinned ? 'Unpin' : 'Pin'}">${I.pin(11, c.pinned)}</button>
          <button class="icon-btn cdel" data-act="del" title="Remove">${I.x(8)}</button>
          <span class="copied">Copied</span>
        </div>`).join('')
        : `<div class="clipempty">${I.clip(22)}<div>Nothing copied yet</div><small>Anything you copy shows up here — click to copy it again</small></div>`;
    }
    list.addEventListener('click', async (e) => {
      const row = e.target.closest('.clip');
      if (!row) return;
      e.stopPropagation();
      const b = e.target.closest('[data-act]');
      if (b && b.dataset.act === 'pin') { S.clips = await api.clipPin(row.dataset.id); draw(); return; }
      if (b && b.dataset.act === 'del') { row.classList.add('gone'); setTimeout(async () => { S.clips = await api.clipDelete(row.dataset.id); draw(); }, 200); return; }
      row.classList.add('flash');
      S.clips = await api.clipCopy(row.dataset.id);
      setTimeout(draw, 650);
    });
    el.querySelector('.clear').addEventListener('click', async (e) => { e.stopPropagation(); S.clips = await api.clipClear(); draw(); });
    return {
      w: 460, el,
      update() { const s = S.clips.map((c) => c.id + c.pinned + c.at).join('|') + Math.floor(Date.now() / 60000); if (s !== sig) { sig = s; draw(); } },
    };
  }
  api.on('clips', (c) => { S.clips = c || []; if (current && current.key === 'page:clipboard') current.update(); });

  // ------------------------------------------------------------------ timers + chime
  let timerSeq = 1;
  function startTimer(seconds, label = 'Timer', kind = 'timer') {
    S.timers.push({ id: timerSeq++, label, kind, total: seconds, endsAt: Date.now() + seconds * 1000, paused: false, remaining: seconds });
    render();
  }
  let chimeTimer = null, audioCtx = null;
  function chimeOnce() {
    try {
      audioCtx = audioCtx || new AudioContext();
      const t0 = audioCtx.currentTime;
      [[1318.5, 0], [1760, 0.16], [1318.5, 0.42], [1760, 0.58]].forEach(([f, dt]) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0 + dt);
        g.gain.exponentialRampToValueAtTime(0.22, t0 + dt + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.5);
        o.connect(g).connect(audioCtx.destination);
        o.start(t0 + dt); o.stop(t0 + dt + 0.55);
      });
    } catch {}
  }
  function startChime(long) { stopChime(); chimeOnce(); let n = 0; const max = long ? 66 : 15; chimeTimer = setInterval(() => { if (++n > max) stopChime(); else chimeOnce(); }, 1800); }
  function stopChime() { clearInterval(chimeTimer); chimeTimer = null; }

  // ------------------------------------------------------------------ transients
  function showTransient(kind, data, ms) {
    if (kind === 'notif' && S.transient && S.transient.kind === 'notif') {
      S.transient.data = [data, ...S.transient.data].slice(0, 3);
      S.transient.until = Date.now() + ms;
    } else if (kind === 'volume' && S.transient && S.transient.kind === 'volume') {
      S.transient.until = Date.now() + ms;
    } else {
      // same kind again (Wi-Fi off → on, another Bluetooth device…): re-mount so the new content shows
      if (S.transient && S.transient.kind === kind && current && current.key === `t:${kind}`) current.key = `t:${kind}:prev`;
      S.transient = { kind, data: kind === 'notif' ? [data] : data, until: ms ? Date.now() + ms : Infinity };
    }
    S.expanded = false;
    render();
  }
  function collapse() {
    if (S.keepOpen) return; S.expanded = false; S.hover = false; expandedByShortcut = false; render(); }

  // ------------------------------------------------------------------ battery
  let powerFromBridge = false;
  let lowWarned = new Set();
  function onPower(p) {
    const prev = S.battery; powerFromBridge = true;
    S.battery = { level: p.level, charging: p.charging, saver: !!p.saver };
    if (!prev) return;
    if (prev.saver !== undefined && !!p.saver !== !!prev.saver && C().radioPopups !== false) {
      showTransient('radio', { kind: 'saver', on: !!p.saver, level: p.level }, 3200);
      if (p.charging === prev.charging) return;
    }
    const bc = C().battery || {};
    if (p.charging !== prev.charging) {
      if (p.charging) { lowWarned = new Set(); if (bc.chargingAnimation !== false) showTransient('charge', S.battery, 4200); }
      else if (bc.unplugAlert !== false) {
        showTransient('unplug', S.battery, 3400);
        if (p.level * 100 <= (bc.lowAt || 20)) setTimeout(() => showTransient('low', S.battery, 6000), 3600);
      }
    } else if (!p.charging) {
      const pct = Math.round(p.level * 100);
      for (const th of [bc.lowAt || 20, bc.criticalAt || 10]) {
        if (pct <= th && !lowWarned.has(th)) { lowWarned.add(th); showTransient('low', S.battery, 7000); }
      }
    }
  }
  if (navigator.getBattery) {
    navigator.getBattery().then((b) => {
      const snap = () => ({ level: b.level, charging: b.charging });
      if (!powerFromBridge) S.battery = snap();
      let warned = new Set();
      b.addEventListener('chargingchange', () => {
        if (powerFromBridge) return;
        S.battery = snap();
        const bc = C().battery || {};
        if (b.charging) { warned = new Set(); if (bc.chargingAnimation !== false) showTransient('charge', S.battery, 3600); }
        else if (bc.unplugAlert !== false) {
          showTransient('unplug', S.battery, 3400);
          if (b.level * 100 <= (bc.lowAt || 20)) setTimeout(() => showTransient('low', snap(), 6000), 3600);
        }
      });
      b.addEventListener('levelchange', () => {
        if (powerFromBridge) return;
        S.battery = snap();
        const bc = C().battery || {};
        if (b.charging) return;
        const pct = Math.round(b.level * 100);
        for (const th of [bc.lowAt || 20, bc.criticalAt || 10]) {
          if (pct <= th && !warned.has(th)) { warned.add(th); showTransient('low', S.battery, 7000); }
        }
      });
    }).catch(() => {});
  }

  // ------------------------------------------------------------------ ticker
  // adaptive ticker: 4x/s while something is on screen, 1x/s when the island is just a line or pill
  const busy = () => !!(S.welcome || S.transient || S.expanded || S.hover || S.timers.length || S.call || S.pinned || (S.agent && S.agent.state === 'editing'));
  setTimeout(function tickLoop() { setTimeout(tickLoop, busy() ? 250 : 1000); (() => {
    const now = Date.now();
    for (const t of [...S.timers]) {
      if (!t.paused && t.endsAt <= now) {
        S.timers = S.timers.filter((x) => x !== t);
        showTransient('timerDone', t, 0);
        startChime();
        if (t.kind === 'focus') setTimeout(() => { if (!S.timers.length) startTimer((C().focus.breakMinutes || 5) * 60, 'Break', 'break'); }, 100);
      }
    }
    checkAlarms();
    const lead = (C().calendarAlertMinutes || 5) * 60000;
    for (const ev of S.calendar) {
      if (ev.allDay) continue;
      const k1 = `${ev.title}|${ev.start}|lead`, k2 = `${ev.title}|${ev.start}|now`;
      if (ev.start - now <= lead && ev.start - now > lead - 15000 && !S.calAlerted.has(k1)) { S.calAlerted.add(k1); showTransient('calendar', ev, 12000); }
      if (ev.start - now <= 0 && ev.start - now > -15000 && !S.calAlerted.has(k2)) { S.calAlerted.add(k2); showTransient('calendar', ev, 12000); }
    }
    const w = C().water || {};
    if (w.enabled && now - S.lastWater > (w.everyMinutes || 60) * 60000 && !S.transient) { S.lastWater = now; showTransient('water', null, 15000); }
    for (const [k, x] of Object.entries(S.agents)) if (x.state === 'done' && now - x.at > 30 * 60e3) delete S.agents[k];
    if (expandedByShortcut && !S.keepOpen && !insideIsland && now - expandedAt > 8000 && S.pinned === 0) collapse();
    if (S.transient && now > S.transient.until && !insideIsland) S.transient = null;
    if (isPlaying() && current && (current.key === 'lyricCompact' || current.key === 'mediaHover' || current.key === 'page:music')) { /* lyric updates run on the fast loop */ }
    render();
  })(); }, 250);
  // fast loop for lyric sync
  setInterval(() => {
    if (!current || !isPlaying()) return;
    if (current.key === 'lyricCompact' || current.key === 'mediaHover' || current.key === 'page:music') current.update && current.update(false);
    else if (lyricsShown() && C().lyrics.dynamic && currentLyric() && current.key === 'mediaCompact') render();
  }, 150);

  // ------------------------------------------------------------------ mouse / hover / click
  let insideIsland = false, hoverT = null, leaveT = null;
  let expandedByShortcut = false, expandedAt = 0;
  function hitTest(x, y) {
    const r = $island.getBoundingClientRect();
    if (lastShape.h <= 6) return x >= r.left - 30 && x <= r.right + 30 && y <= 12;
    const e = parseFloat($island.style.getPropertyValue('--e')) || 8;
    return x >= r.left - e && x <= r.right + e && y >= 0 && y <= r.bottom + 4;
  }
  function setInside(v) {
    if (v === insideIsland) return;
    insideIsland = v;
    if (v) {
      clearTimeout(leaveT);
      hoverT = setTimeout(() => { S.hover = true; render(); }, 60);
    } else {
      clearTimeout(hoverT);
      leaveT = setTimeout(() => {
        if (S.pinned > 0 || S.keepOpen) return;
        S.hover = false; S.expanded = false; expandedByShortcut = false;
        if (S.transient && Date.now() > S.transient.until) S.transient = null;
        render();
      }, 320);
    }
  }
  // typing: the island window never takes focus on its own, so a click into a text field asks
  // for focus first, then focuses the field (otherwise keystrokes go to the app underneath)
  document.addEventListener('pointerdown', (e) => {
    if (api.diagPointer) api.diagPointer({ x: e.clientX, y: e.clientY, target: (e.target.className && e.target.className.baseVal === undefined ? e.target.className : e.target.tagName) + '', focused: document.hasFocus() });
    const field = e.target.closest('input[type=text], input[type=time], input:not([type]), textarea');
    if (!field) return;
    e.stopPropagation();
    // the window is already focusable on pages with text fields, so Windows activates it on this click
    setTimeout(() => { field.focus(); if (field.select && field.classList.contains('label')) field.select(); }, 40);
  }, true);
  window.__focusLog = [];
  const flog = (s) => { window.__focusLog.push(`${Date.now() % 100000} ${s}`); if (window.__focusLog.length > 20) window.__focusLog.shift(); };
  window.addEventListener('focus', () => flog('window focus'));
  document.addEventListener('focusin', (e) => flog(`focusin ${e.target.tagName}`));
  document.addEventListener('focusout', (e) => flog(`focusout ${e.target.tagName}`));
  window.addEventListener('blur', () => { flog('window blur'); const a = document.activeElement; if (a && a.blur && /INPUT|TEXTAREA/.test(a.tagName)) a.blur(); });
  document.addEventListener('mousemove', (e) => setInside(hitTest(e.clientX, e.clientY)));
  document.addEventListener('mouseleave', () => setInside(false));
  document.addEventListener('pointerup', () => { if (S.pinned === 0 && !insideIsland) setInside(false); });

  $island.addEventListener('click', () => {
    if (S.transient && (S.transient.kind === 'timerDone' || S.transient.kind === 'alarm')) return;
    if (S.call && S.call.state === 'incoming') return;
    if (S.transient) { S.transient = null; render(); return; }
    if (S.call && S.call.state === 'active') return;
    if (!S.expanded) {
      S.expanded = true;
      const live = liveKind();
      S.page = live === 'media' ? 'music' : live === 'timer' ? 'timer' : live === 'agent' ? 'agents' : 'home';
      render();
    }
  });
  api.on('toggle-expand', () => {
    if (S.expanded) { collapse(); return; }
    S.transient = null;
    S.expanded = true; expandedByShortcut = true; expandedAt = Date.now();
    S.page = 'home';
    render();
  });

  // ------------------------------------------------------------------ bridge events
  api.on('bridge', (msg) => {
    switch (msg.type) {
      case 'media': {
        if (S.demoMedia && !msg.data) return;
        S.demoMedia = false;
        if (!msg.data) {
          if (S.media) { S.lastMedia = { ...S.media, status: 'paused' }; saveJSON('lastMedia', { ...S.lastMedia, artUrl: null }); }
          S.media = null; break;
        }
        const prev = S.media;
        // album art arrives once per track as base64: turn it into a tiny blob: URL right away,
        // so nothing ever copies or compares the big string again
        let artUrl = prev && prev.artKey === msg.data.artKey ? prev.artUrl : null;
        if (msg.data.art) artUrl = blobUrl(msg.data.art);
        const { art: _drop, ...rest } = msg.data;
        S.media = { ...rest, artUrl, receivedAt: Date.now() };
        // keep the optimistic play/pause state until the player catches up
        if (S.pendingStatus && Date.now() < S.pendingStatus.until && mediaKey(prev) === mediaKey(S.media) && S.media.status !== S.pendingStatus.status) {
          S.media.status = S.pendingStatus.status;
          S.media.position = prev ? mediaPosOf(prev) : S.media.position;
        } else S.pendingStatus = null;
        S.lastMedia = { ...S.media };
        if (!prev || mediaKey(prev) !== mediaKey(S.media)) {
          saveJSON('lastMedia', { ...S.media, artUrl: null }); loadLyrics();
          const onMusic = current && (current.key === 'page:music' || current.key === 'mediaHover');
          if (prev && S.media.status === 'playing' && !onMusic && !S.expanded && !(S.transient && S.transient.kind !== 'nowPlaying')) showTransient('nowPlaying', null, 4200);
        }
        if (msg.data.art) saveArtThumb(S.media);
        break;
      }
      case 'brightness': {
        const v = msg.value;
        const changed = !msg.initial && v !== S.brightness;
        S.brightness = v;
        if (changed && Date.now() - (S.brightSetAt || 0) > 1200 && C().hud && C().hud.brightness !== false && !S.expanded) showTransient('brightness', null, 1800);
        else if (current && current.key === 't:brightness') current.update();
        return;
      }
      case 'volume': {
        const v = msg.value;
        const changed = S.volumeKnown && (Math.abs(v - S.volume) > 0.004 || (msg.muted !== undefined && msg.muted !== S.muted));
        if (msg.muted !== undefined) S.muted = msg.muted;
        S.volume = v;
        if (changed && Date.now() - S.volSetAt > 1200 && C().hud && C().hud.volume !== false && !S.expanded) showTransient('volume', null, 1600);
        S.volumeKnown = true;
        break;
      }
      case 'notif': showTransient('notif', msg.data, (C().notifications && C().notifications.durationMs) || 6000); return;
      case 'notif-removed':
        if (S.transient && S.transient.kind === 'notif') {
          S.transient.data = S.transient.data.filter((n) => String(n.id) !== String(msg.id));
          if (!S.transient.data.length) S.transient = null;
        }
        break;
      case 'call': {
        const d = msg.data;
        if (d.state === 'incoming') { S.call = { ...d, state: 'incoming' }; S.expanded = false; S.transient = null; }
        else if (d.state === 'active') {
          // answered (on the phone, in Phone Link, or from the island)
          // Phone Link's own call timer is the source of truth (elapsed seconds), so both always match
          const synced = typeof d.elapsed === 'number' ? Date.now() - d.elapsed * 1000 : null;
          S.call = { ...(S.call || {}), ...d, photo: d.photo || (S.call && S.call.photo), state: 'active', startedAt: synced || (S.call && S.call.startedAt) || Date.now() };
        } else if (d.state === 'ended') S.call = null;
        // 'toast-gone' is ignored: the call watcher decides whether it was answered or ended
        break;
      }
      case 'app-volume': if (msg.value != null) S.appVol = msg.value; if (current && current.key === 'page:music') current.update(); return;
      case 'agent-notif': {
        const d = msg.data;
        const key = agentKeyFrom({ agent: d.agent, app: d.app });
        const wait = /approv|permission|input|waiting|needs/i.test(`${d.title} ${d.body}`);
        { const pr = S.agents[key], lv = pr && pr.state !== 'done', nw = Date.now();
          S.agents[key] = { key, name: agentMeta(key).name, updated: nw, since: lv ? pr.since : nw, at: nw, state: wait ? 'waiting' : 'done',
            took: lv ? (nw - pr.since) / 1000 : 0, detail: [d.title, d.body].filter(Boolean).join(' — ') };
          syncAgent(); }
        showTransient(wait ? 'agentWait' : 'agentDone', { key, app: d.app, icon: d.icon, headline: wait ? 'Needs your input' : 'Job is done', detail: [d.title, d.body].filter(Boolean).join(' — ') }, wait ? 15000 : 6000);
        return;
      }
      case 'bt':
        if (C().bluetooth && C().bluetooth.popups !== false) showTransient('bt', msg.data, 4200);
        return;
      case 'bt-list': {
        S.btDevices = msg.data || [];
        // a connect pop-up that went up before Windows knew the battery gets it as soon as it arrives
        const t = S.transient;
        if (t && t.kind === 'bt' && t.data.battery == null) {
          const d = S.btDevices.find((x) => x.name === t.data.name && x.battery != null);
          if (d) showTransient('bt', { ...t.data, battery: d.battery }, Math.max(2500, t.until - Date.now()));
        }
        break;
      }
      case 'power': onPower(msg.data); break;
      case 'radio': if (C().radioPopups !== false) showTransient('radio', msg.data, msg.data.kind === 'airplane' ? 3800 : 3200); break;
      default: break;
    }
    render();
  });
  S.agents = {};
  function syncAgent() {
    const w = Object.values(S.agents).filter((x) => x.state === 'editing').sort((p, q) => q.updated - p.updated);
    S.agent = w[0] || null;
  }
  function agentEvent(a) {
    if (C().agentStatus === false) return;
    const key = agentKeyFrom(a);
    const st = String(a.state || '').toLowerCase();
    const prev = S.agents[key];
    const live = prev && prev.state !== 'done';
    const now = Date.now();
    const name = agentMeta(key).name;
    const base = { key, name, updated: now, since: live ? prev.since : now };
    if (/^(editing|working|running|thinking|start)/.test(st)) {
      S.agents[key] = { ...base, state: 'editing', detail: a.detail || (live ? prev.detail : '') };
    } else if (/^(waiting|input|permission|approval|ask)/.test(st)) {
      S.agents[key] = { ...base, state: 'waiting', detail: a.detail || a.title || (live ? prev.detail : '') };
      showTransient('agentWait', { key, detail: a.detail || a.title }, 15000);
    } else if (/^(done|stop|complete|finished|success)/.test(st)) {
      const took = live ? (now - prev.since) / 1000 : 0;
      const detail = a.detail || (a.title && a.title !== name ? a.title : '') || (prev ? prev.detail : '');
      S.agents[key] = { ...base, state: 'done', took, at: now, detail };
      showTransient('agentDone', { key, app: name, detail, took }, 5000);
    } else delete S.agents[key];
    syncAgent();
    render();
  }
  api.on('agent', agentEvent);
  api.on('calendar', (events) => { S.calendar = events || []; render(); });
  api.on('config', (cfg) => {
    const prev = S.config;
    const strip = (c) => JSON.stringify({ ...c, glass: { everywhere: c.glass && c.glass.everywhere } });
    S.config = cfg;
    applyConfigVars(); // glass opacity / frost / vibrancy apply live, no rebuild
    if (cfg.size !== prev.size) setTimeout(refreshGeometry, 200);
    if (strip(cfg) !== strip(prev)) {
      if (current) { current.destroy && current.destroy(); current = null; $content.innerHTML = ''; }
      glassWanted = !glassWanted; syncGlass(decide()); // re-evaluate glass with the new style
      S.lyrics.key = ''; loadLyrics();
    }
    render();
  });

  // ------------------------------------------------------------------ demos (tray / settings → Try it)
  function demoArt() {
    const c = document.createElement('canvas'); c.width = c.height = 120;
    const g = c.getContext('2d');
    const gr = g.createLinearGradient(0, 0, 120, 120);
    gr.addColorStop(0, '#6ec3ff'); gr.addColorStop(0.55, '#bfe6ff'); gr.addColorStop(1, '#2f7de1');
    g.fillStyle = gr; g.fillRect(0, 0, 120, 120);
    g.fillStyle = '#e8463a'; g.beginPath(); g.ellipse(64, 58, 10, 22, -0.6, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#222'; g.beginPath(); g.arc(52, 40, 7, 0, Math.PI * 2); g.fill();
    return c.toDataURL('image/png');
  }
  function demo(kind) {
    const lvl = S.battery ? S.battery.level : 0.87;
    if (kind.startsWith('probe:')) {   // diagnostics: what element sits at a window point
      const [, x, y] = kind.split(':');
      const n = document.elementFromPoint(+x, +y);
      const v = n && n.closest('.view');
      const r = $island.getBoundingClientRect();
      api.diagPointer({ x: +x, y: +y, target: n ? `${n.tagName}.${n.className && n.className.baseVal === undefined ? n.className : ''}` : 'none', view: v ? v.className : '-', island: `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`, key: current && current.key, focused: false });
      return;
    }
    if (kind.startsWith('page:')) { S.transient = null; S.expanded = true; expandedByShortcut = true; expandedAt = Date.now(); S.page = kind.slice(5); render(); return; }
    if (kind.startsWith('click-day:')) { const d = [...document.querySelectorAll('.cal2 .g .d[data-day]')].reverse().find((x) => x.dataset.day === kind.slice(10)); if (d) d.click(); return; }
    if (kind === 'collapse') { S.transient = null; collapse(); return; }
    if (kind === 'reload') { location.reload(); return; }
    if (kind === 'alarms') { S.timerTab = 'alarm'; S.transient = null; S.expanded = true; expandedByShortcut = true; expandedAt = Date.now(); S.page = 'timer'; if (current && current.key === 'page:timer') { current.destroy && current.destroy(); current = null; $content.innerHTML = ''; } render(); return; }
    if (kind === 'cancel-timers') { S.timers = []; render(); return; }
    if (kind === 'cal-test-save') { const t = document.querySelector('.evform .evt'); if (t) { t.value = 'Test event'; document.querySelector('.evform [data-cact=save]').click(); } return; }
    if (kind === 'cal-test-del') { const b = [...document.querySelectorAll('.card [data-cact=del]')].find((x) => x.dataset.title === 'Test event'); if (b) b.click(); return; }
    if (kind === 'cal-add') { const b = document.querySelector('.view:not(.leave):not(.leave-l):not(.leave-r) [data-cact=add]'); if (b) b.click(); return; }
    if (kind === 'minimize') { minimizeIsland(); return; }
    if (kind === 'keep-open') { toggleKeepOpen(); return; }
    if (kind === 'lyrics-toggle') { const b = document.querySelector('.view:not(.leave):not(.leave-fade) [data-act=lyrics-toggle]'); if (b) b.click(); else setLyricsShown(!lyricsShown()); return; }
    if (kind === 'todo-clear-test') { S.todos = S.todos.filter((t) => t.text !== 'Test task'); saveJSON('todos', S.todos); render(); return; }
    if (kind.startsWith('settings')) { api.openSettings(kind.split(':')[1]); return; }
    if (kind === 'hover') { S.hover = true; render(); return; }
    switch (kind) {
      case 'notif': showTransient('notif', { id: `demo${Date.now()}`, app: 'WhatsApp', title: 'Wesley Tingey', body: "You won't believe what just happened.\nCall me when you see this", time: Date.now() / 1000 }, 6000); break;
      case 'call':
        S.call = { id: 'demo', state: 'incoming', name: 'Wesley Tingey', number: '' }; render();
        setTimeout(() => { if (S.call && S.call.id === 'demo' && S.call.state === 'incoming') { S.call = null; render(); } }, 20000);
        break;
      case 'calendar':
        if (!S.calendar.length) {
          const t = dayStart(new Date()).getTime();
          S.calendar = [
            { title: 'Boxing', start: t + 9 * 36e5, end: t + 11 * 36e5 },
            { title: 'Video Editing', start: t + 13 * 36e5, end: t + 14 * 36e5, color: '#ff453a' },
            { title: 'NRC Run', start: t + 864e5 * 2 + 9 * 36e5, end: t + 864e5 * 2 + 11 * 36e5, color: '#30d158' },
            { title: 'Record Audio', start: t + 864e5 * 2 + 12 * 36e5, end: t + 864e5 * 2 + 13 * 36e5, color: '#ff453a' },
          ];
        }
        showTransient('calendar', { title: 'ENT Specialist Check-up', start: Date.now() + 5 * 60000, end: Date.now() + 65 * 60000, url: 'https://meet.google.com/' }, 12000);
        break;
      case 'timer': startTimer(60, 'Timer'); break;
      case 'alarm': ringAlarm({ time: hhmm(Date.now()), label: 'Wake up' }); break;
      case 'music':
        S.demoMedia = true;
        S.media = { title: 'Paper Sky', artist: 'Lumen Coast', album: 'Summer Tapes', source: 'applemusic', status: 'playing', position: 74, duration: 196, receivedAt: Date.now(), artUrl: demoArt(), artKey: 'demo', app: '' };
        S.lastMedia = { ...S.media };
        S.lyrics = { key: '', synced: [], status: 'none' };
        loadLyrics(); render();
        break;
      case 'battery': showTransient('charge', { level: lvl, charging: true }, 3600); break;
      case 'unplug': showTransient('unplug', { level: lvl, charging: false }, 3400); break;
      case 'low': showTransient('low', { level: 0.2, charging: false }, 7000); break;
      case 'bt': showTransient('bt', { state: 'connected', name: (S.btDevices[0] && S.btDevices[0].name) || 'JBL TUNE760NC', battery: (S.btDevices[0] && S.btDevices[0].battery) ?? 40, kind: (S.btDevices[0] && S.btDevices[0].kind) || 'headphones' }, 4200); break;
      case 'volume': showTransient('volume', null, 2200); break;
      case 'nowplaying': showTransient('nowPlaying', null, 4200); break;
      case 'brightness': showTransient('brightness', null, 2200); break;
      case 'quit': showTransient('confirmQuit', { app: '', name: playerName(), source: (S.media || S.lastMedia || {}).source }, 15000); break;
      case 'water': showTransient('water', null, 15000); break;
      case 'welcome': startWelcome(); break;
      case 'welcome-tour': startWelcome(); setTimeout(() => { const w = document.querySelector('.welcome'); if (w && w.__tour) w.__tour(0); }, 200); break;
      case 'welcome-tour-next': { const w = document.querySelector('.welcome'); if (w) w.querySelector('.tr-next').click(); break; }
      case 'agent':
        agentEvent({ agent: 'claude', state: 'working', detail: 'Shipping the new landing page' });
        setTimeout(() => agentEvent({ agent: 'claude', state: 'done', detail: 'Landing page shipped' }), 6000);
        break;
      case 'agents':
        agentEvent({ agent: 'claude', state: 'working', detail: 'Refactoring the island renderer' });
        agentEvent({ agent: 'chatgpt', state: 'working', detail: 'Drafting release notes' });
        agentEvent({ agent: 'gemini', state: 'working', detail: 'Summarising the bug reports' });
        agentEvent({ agent: 'cursor', state: 'done', detail: 'Fixed the settings layout' });
        agentEvent({ agent: 'codex', state: 'working', detail: 'Writing unit tests' });
        agentEvent({ agent: 'copilot', state: 'waiting', detail: 'Approve running npm install?' });
        S.transient = null;
        break;
      case 'wifi-off': showTransient('radio', { kind: 'wifi', on: false }, 3200); break;
      case 'wifi-on': showTransient('radio', { kind: 'wifi', on: true }, 3200); break;
      case 'bt-off': showTransient('radio', { kind: 'bluetooth', on: false }, 3200); break;
      case 'bt-on': showTransient('radio', { kind: 'bluetooth', on: true }, 3200); break;
      case 'airplane-on': showTransient('radio', { kind: 'airplane', on: true }, 3800); break;
      case 'airplane-off': showTransient('radio', { kind: 'airplane', on: false }, 3800); break;
      case 'saver-on': showTransient('radio', { kind: 'saver', on: true }, 3200); break;
      case 'saver-off': showTransient('radio', { kind: 'saver', on: false }, 3200); break;
      default: break;
    }
  }
  api.on('demo', demo);
  window.__demo = demo;
  window.__S = S;
  window.__bootAt = Date.now();

  // ------------------------------------------------------------------ boot
  (async () => {
    try { S.config = deepMerge(S.config, (await api.getConfig()) || {}); } catch {}
    try { S.calendar = (await api.getCalendar()) || []; } catch {}
    try { S.clips = (await api.clipList()) || []; } catch { S.clips = []; }
    try { S.btDevices = (api.btList && (await api.btList())) || []; } catch {}
    applyConfigVars();
    await refreshGeometry();
    api.bridge({ cmd: 'refresh' });   // ask for the current track again, album art included
    ['claude', 'chatgpt', 'copilot', 'codex', 'cursor', 'gemini'].forEach((k) => agentIcon(k));   // warm the agent icons
    render();
    window.addEventListener('resize', refreshGeometry);
    // tell the main process once the first real frame is on screen, so the window can fade in cleanly
    requestAnimationFrame(() => requestAnimationFrame(() => { if (api.ready) api.ready(); }));
    if (!C().welcomed) setTimeout(startWelcome, 1100);   // first run: say hello
  })();
  function deepMerge(a, b) {
    for (const k of Object.keys(b || {})) {
      if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') deepMerge(a[k], b[k]); else a[k] = b[k];
    }
    return a;
  }
})();
