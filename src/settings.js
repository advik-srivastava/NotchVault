/* Island control panel */
(() => {
  const api = window.islandAPI || {
    getConfig: async () => JSON.parse(localStorage.getItem('cfg') || '{}'),
    setConfig: async (p) => { const c = { ...(JSON.parse(localStorage.getItem('cfg') || '{}')), ...p }; localStorage.setItem('cfg', JSON.stringify(c)); return c; },
    calendarStatus: async () => [], refreshCalendar: async () => [], btList: async () => [], loginItem: async () => false,
    demo() {}, shelfRemove: async () => [], on() {},
  };
  let C = {};
  const $nav = document.getElementById('nav');
  const $main = document.getElementById('main');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = (path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), C);
  const patchFor = (path, value) => path.split('.').reverse().reduce((acc, k) => ({ [k]: acc }), value);
  async function set(path, value) { C = await api.setConfig(patchFor(path, value)); }

  const SVG = {
    gear: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm9 2.2-2-.4a7 7 0 0 0-.7-1.7l1.1-1.7-1.8-1.8-1.7 1.1a7 7 0 0 0-1.7-.7L13.8 3h-2.6l-.4 2a7 7 0 0 0-1.7.7L7.4 4.6 5.6 6.4l1.1 1.7a7 7 0 0 0-.7 1.7l-2 .4v2.6l2 .4c.2.6.4 1.2.7 1.7l-1.1 1.7 1.8 1.8 1.7-1.1c.5.3 1.1.5 1.7.7l.4 2h2.6l.4-2c.6-.2 1.2-.4 1.7-.7l1.7 1.1 1.8-1.8-1.1-1.7c.3-.5.5-1.1.7-1.7l2-.4z"/></svg>',
    glass: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm0 2a7 7 0 0 1 0 14z"/></svg>',
    music: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3.3v12.2a3 3 0 1 1-2-2.8V7.6l-8 1.8v8.1a3 3 0 1 1-2-2.8V6.3c0-.6.4-1.1 1-1.2l9.8-2.2c.6-.1 1.2.3 1.2.9z"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5a6 6 0 0 0-6 6v4.2L4.3 15.6c-.4.7.1 1.4.9 1.4h13.6c.8 0 1.3-.8.9-1.4L18 12.7V8.5a6 6 0 0 0-6-6zM9.5 18.5a2.5 2.5 0 0 0 5 0z"/></svg>',
    batt: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="2" y="7" width="17" height="10" rx="2.5"/><rect x="20" y="10" width="2" height="4" rx="1"/></svg>',
    hud: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 9.2c0-.7.5-1.2 1.2-1.2H7l4.6-3.9c.6-.5 1.4-.1 1.4.7v14.4c0 .8-.8 1.2-1.4.7L7 16H4.2c-.7 0-1.2-.5-1.2-1.2z"/><path d="M16 9a4 4 0 0 1 0 6" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
    focus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><circle cx="12" cy="13" r="8"/><path d="M12 13V9"/></svg>',
    shelf: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 4h6l2 2h8a1 1 0 0 1 1 1v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a1 1 0 0 1 1-1z"/></svg>',
    agent: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.6c0-1.2 1.3-1.9 2.3-1.3l11 6.9c1 .6 1 2 0 2.6l-11 6.9C8.3 20.3 7 19.6 7 18.4z"/></svg>',
  };
  const SECTIONS = [
    ['general', 'General', '#8e8e93', SVG.gear],
    ['glass', 'Liquid Glass', '#5e5ce6', SVG.glass],
    ['music', 'Music and lyrics', '#fa2d48', SVG.music],
    ['calendar', 'Calendar', '#ff453a', SVG.cal],
    ['notifications', 'Notifications', '#ff9f0a', SVG.bell],
    ['battery', 'Battery and Bluetooth', '#30d158', SVG.batt],
    ['hud', 'HUD and popups', '#0a84ff', SVG.hud],
    ['focus', 'Focus and water', '#bf5af2', SVG.focus],
    ['clipboard', 'Clipboard', '#ffd60a', SVG.shelf],
    ['agent', 'AI agent status', '#ff6b35', SVG.agent],
    ['try', 'Try it', '#64d2ff', SVG.play],
  ];
  let current = (location.hash || '#general').slice(1);

  // ---------------------------------------------------------------- controls
  const sw = (path, title, desc = '') => `<div class="row"><div class="lbl"><div class="t">${title}</div>${desc ? `<div class="d">${desc}</div>` : ''}</div><button class="switch ${get(path) ? 'on' : ''}" data-sw="${path}"></button></div>`;
  const seg = (path, title, opts, desc = '') => `<div class="row"><div class="lbl"><div class="t">${title}</div>${desc ? `<div class="d">${desc}</div>` : ''}</div><div class="seg" data-seg="${path}">${opts.map(([v, l]) => `<button data-v='${JSON.stringify(v)}' class="${JSON.stringify(get(path)) === JSON.stringify(v) ? 'on' : ''}">${l}</button>`).join('')}</div></div>`;
  const slider = (path, title, min, max, step, fmt, desc = '') => `<div class="row"><div class="lbl"><div class="t">${title}</div>${desc ? `<div class="d">${desc}</div>` : ''}</div><div class="slider"><input type="range" min="${min}" max="${max}" step="${step}" value="${get(path)}" data-range="${path}" data-fmt="${fmt}"><span class="v">${fmtVal(get(path), fmt)}</span></div></div>`;
  const num = (path, title, min, max, desc = '') => `<div class="row"><div class="lbl"><div class="t">${title}</div>${desc ? `<div class="d">${desc}</div>` : ''}</div><input type="number" min="${min}" max="${max}" value="${get(path)}" data-num="${path}"></div>`;
  function fmtVal(v, f) { v = Number(v); return f === 'pct' ? `${Math.round(v * 100)}%` : f === 'px' ? `${v}px` : f === 'x' ? `${v.toFixed(1)}×` : f === 'min' ? `${v} min` : String(v); }

  // ---------------------------------------------------------------- sections
  const V = {};
  V.general = async () => {
    const login = await api.loginItem();
    return `<h1>General</h1>
    <h2>Startup</h2><div class="card"><div class="row"><div class="lbl"><div class="t">Start with Windows</div></div><button class="switch ${login ? 'on' : ''}" id="login"></button></div></div>
    <h2>Island</h2><div class="card">
      ${seg('size', 'Size', [[1, '100%'], [1.15, '115%'], [1.3, '130%'], [1.5, '150%']], 'Scales everything in the island')}
      ${seg('idleStyle', 'When nothing is happening', [['line', 'Line'], ['pill', 'Pill'], ['mascot', 'Mascot']], 'Line keeps only a hairline on the top edge; Mascot is a little friend with eyes')}
      <div class="row"><div class="lbl"><div class="t">Keyboard shortcut</div><div class="d">Opens the island from anywhere</div></div><input type="text" value="${esc(C.shortcut || '')}" data-text="shortcut" style="width:170px"></div>
    </div>`;
  };
  V.glass = async () => `<h1>Liquid Glass</h1>
    <div class="preview"><div class="sun"></div><div class="glassbox"><div class="blur" id="pvblur"></div><div class="tint" id="pvtint"></div><div class="txt">PASSENGER<span>Alex Warren</span></div><div class="rim"></div></div></div>
    <h2>Style</h2><div class="card">
      ${seg('musicStyle', 'Music player', [['auto', 'Auto'], ['glass', 'Glass'], ['black', 'Black']], 'Auto uses glass for Apple Music and black for Spotify')}
      ${sw('glass.everywhere', 'Glass on every page', 'Calendar, timer and the rest use Liquid Glass too')}
    </div>
    <h2>Glass</h2><div class="card">
      ${slider('glass.opacity', 'Opacity', 0, 0.9, 0.01, 'pct', 'How dark the glass is — lower is clearer')}
      ${slider('glass.blur', 'Frost', 0, 30, 1, 'px', 'How much the background is blurred')}
      ${slider('glass.saturation', 'Vibrancy', 1, 2.5, 0.1, 'x', 'Colour boost of what shows through')}
    </div>`;
  V.music = async () => `<h1>Music and lyrics</h1>
    <h2>Players</h2><div class="card">
      <div class="row"><div class="lbl"><div class="t">Apple Music</div></div><button class="switch ${C.media.apps.includes('applemusic') ? 'on' : ''}" data-app="applemusic"></button></div>
      <div class="row"><div class="lbl"><div class="t">Spotify</div></div><button class="switch ${C.media.apps.includes('spotify') ? 'on' : ''}" data-app="spotify"></button></div>
      ${sw('media.allowOtherMediaApps', 'Other players', 'Browsers, VLC, YouTube and anything else that reports media to Windows')}
    </div>
    <h2>While playing</h2><div class="card">
      ${seg('musicCompact', 'Show music as', [['pill', 'Pill'], ['line', 'Line'], ['pinned', 'Pinned']], 'Pill is the default. Line hides it to a hairline (yellow button). Pinned keeps the music bar open (green button).')}
    </div>
    <h2>Lyrics</h2><div class="card">
      ${sw('lyrics.enabled', 'Synced lyrics', 'Time-synced lines from LRCLIB (only the song title and artist are sent)')}
      ${sw('lyrics.onHover', 'Lyrics on hover', 'Hovering the music pill shows 3–4 lines in the album’s colours')}
      ${sw('lyrics.dynamic', 'Dynamic lyrics', 'While playing, the pill shows the current line and resizes to fit it')}
    </div>`;
  V.calendar = async () => {
    const status = await api.calendarStatus();
    const st = (src) => status.find((s) => s.src === src);
    return `<h1>Calendar</h1>
    <h2>Calendars (iCal links)</h2><div class="card list">
      ${(C.calendars || []).map((c, i) => { const s = st(c); return `<div class="li"><span class="dot" style="background:${s ? (s.ok ? 'var(--green)' : 'var(--red)') : 'var(--sub)'}"></span><span class="grow">${esc(c)}</span><span class="muted">${s ? (s.ok ? `${s.count} events` : esc(s.error)) : ''}</span><button class="btn red" data-delcal="${i}">Remove</button></div>`; }).join('') || '<div class="li muted">No calendars yet. Google: Settings → your calendar → “Secret address in iCal format”. Outlook: Settings → Calendar → Shared calendars → Publish → ICS.</div>'}
      <div class="li"><input type="url" id="calurl" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" class="grow"><button class="btn blue" id="addcal">Add</button><button class="btn" id="refcal">Refresh</button></div>
    </div>
    <h2>Behaviour</h2><div class="card">
      ${num('calendarAlertMinutes', 'Alert before events', 0, 120, 'Minutes before an event the island shows a countdown')}
      ${sw('calendar.weekStartsMonday', 'Week starts on Monday')}
      ${sw('calendar.showDots', 'Show event dots in the month')}
    </div>
    <h2>Quick events</h2><div class="card list">
      ${(C.localEvents || []).map((e, i) => `<div class="li"><span class="dot" style="background:${esc(e.color || 'var(--blue)')}"></span><span class="grow">${esc(e.title)} <span class="muted">· ${new Date(e.start).toLocaleString()}</span></span><button class="btn red" data-delev="${i}">Remove</button></div>`).join('')}
      <div class="li"><input type="text" id="evtitle" placeholder="Title" style="width:160px"><input type="datetime-local" id="evstart"><input type="number" id="evdur" value="60" title="minutes"><span class="muted">min</span><button class="btn blue" id="addev">Add</button></div>
    </div>`;
  };
  V.notifications = async () => `<h1>Notifications</h1>
    <h2>Behaviour</h2><div class="card">
      ${sw('notifications.islandOnly', 'Show alerts only in the island', 'Takes Phone Link / Outlook alerts out of Windows so they never pop up twice')}
      ${sw('phoneLinkCalls', 'Phone Link calls', 'Incoming calls from your phone show the call screen')}
      ${num('notifications.durationMs', 'Show for (ms)', 1500, 20000)}
    </div>
    <h2>Apps that can notify</h2><div class="card"><div class="row"><div class="chips">${(C.notifications.apps || []).map((a, i) => `<span class="chip">${esc(a)}<button data-delapp="${i}">✕</button></span>`).join('') || '<span class="muted">Every app</span>'}</div></div>
      <div class="row"><input type="text" id="appname" placeholder="e.g. Outlook, YourPhone, WhatsApp" style="flex:1"><button class="btn blue" id="addapp">Add</button></div></div>
    <h2>Never show</h2><div class="card"><div class="row"><div class="chips">${(C.notifications.ignore || []).map((a, i) => `<span class="chip">${esc(a)}<button data-delign="${i}">✕</button></span>`).join('') || '<span class="muted">Nothing blocked</span>'}</div></div>
      <div class="row"><input type="text" id="ignname" placeholder="e.g. Truecaller" style="flex:1"><button class="btn" id="addign">Block</button></div></div>`;
  V.battery = async () => {
    const bt = await api.btList();
    return `<h1>Battery and Bluetooth</h1>
    <h2>Battery</h2><div class="card">
      ${sw('battery.chargingAnimation', 'Charging animation', 'Plugging in shows the Apple-style charging pill')}
      ${sw('battery.unplugAlert', 'Charger removed', 'Unplugging shows that the charger was disconnected')}
      ${num('battery.lowAt', 'Low battery warning at (%)', 5, 50)}
      ${num('battery.criticalAt', 'Critical warning at (%)', 1, 30)}
    </div>
    <h2>Bluetooth</h2><div class="card">${sw('bluetooth.popups', 'Device connected popups', 'Shows the device name and its battery when it connects')}</div>
    <h2>Connected now</h2><div class="card list">${bt.length ? bt.map((d) => `<div class="li"><span class="grow">${esc(d.name)} <span class="muted">· ${esc(d.kind)}</span></span><span class="muted">${d.battery != null ? `${d.battery}%` : '—'}</span></div>`).join('') : '<div class="li muted">No Bluetooth devices connected (the first scan can take ~30 s after start)</div>'}</div>`;
  };
  V.hud = async () => `<h1>HUD and popups</h1><div class="card">
      ${sw('hud.volume', 'Volume HUD', 'Changing the system volume shows a bar in the island')}
      ${sw('hud.brightness', 'Brightness HUD', 'Changing the screen brightness shows a bar you can drag')}
    </div>`;
  V.focus = async () => `<h1>Focus and water</h1>
    <h2>Pomodoro</h2><div class="card">${num('focus.minutes', 'Focus length (min)', 5, 120)}${num('focus.breakMinutes', 'Break length (min)', 1, 60)}</div>
    <h2>Water</h2><div class="card">${sw('water.enabled', 'Water reminders')}${num('water.everyMinutes', 'Remind every (min)', 10, 240)}${num('water.goal', 'Daily goal (glasses)', 1, 20)}</div>`;
  V.clipboard = async () => `<h1>Clipboard</h1><div class="card">
      ${sw('clipboard.enabled', 'Keep clipboard history', 'Text and images you copy are listed on the island’s Clipboard page. Stored only on this PC.')}
      ${num('clipboard.limit', 'Items to keep', 5, 200)}
      <div class="row"><div class="lbl"><div class="t">Clear history</div><div class="d">Pinned items are kept</div></div><button class="btn red" id="clearclips">Clear</button></div>
    </div>`;
  V.agent = async () => `<h1>AI agent status</h1><div class="card">
      ${sw('agentStatus', 'Show agent status', 'Shows “Editing…” / “Done” from Claude Code or any tool that posts to the island')}
    </div>
    <h2>How to connect</h2><div class="card"><div class="row"><div class="lbl"><div class="d">Anything can send <code>POST http://127.0.0.1:47823/agent?state=editing&amp;title=Claude+Code</code> (states: editing, done, idle). For Claude Code, add hooks like these to <code>~/.claude/settings.json</code>:</div></div></div>
<pre>"hooks": {
  "UserPromptSubmit": [{ "hooks": [{ "type": "command",
    "command": "curl -s -X POST \\"http://127.0.0.1:47823/agent?state=editing&amp;title=Claude+Code\\"" }] }],
  "Stop": [{ "hooks": [{ "type": "command",
    "command": "curl -s -X POST \\"http://127.0.0.1:47823/agent?state=done&amp;title=Claude+Code\\"" }] }]
}</pre></div>`;
  V.try = async () => `<h1>Try it</h1><div class="card"><div class="demo-grid">
    ${[['music', 'Music'], ['notif', 'Notification'], ['call', 'Incoming call'], ['calendar', 'Calendar alert'], ['timer', '1 min timer'], ['battery', 'Charging'], ['unplug', 'Charger removed'], ['low', 'Low battery'], ['bt', 'Bluetooth'], ['volume', 'Volume HUD'], ['brightness', 'Brightness HUD'], ['quit', 'Quit confirmation'],['water', 'Water'], ['agent', 'Agent status']].map(([k, l]) => `<button class="btn" data-demo="${k}">${l}</button>`).join('')}
  </div></div>`;

  // ---------------------------------------------------------------- render + events
  function nav() {
    $nav.innerHTML = SECTIONS.map(([id, label, color, svg]) => `<div class="item ${id === current ? 'on' : ''}" data-sec="${id}"><span class="ico" style="background:${color}">${svg}</span>${label}</div>`).join('');
  }
  async function show(id) {
    current = id;
    nav();
    $main.innerHTML = `<div class="section">${await V[id]()}</div>`;
    preview();
  }
  function preview() {
    const blur = document.getElementById('pvblur');
    if (!blur) return;
    blur.style.filter = `blur(${get('glass.blur')}px) saturate(${get('glass.saturation')})`;
    document.getElementById('pvtint').style.background = `rgba(12,12,16,${get('glass.opacity')})`;
  }

  $nav.addEventListener('click', (e) => { const it = e.target.closest('[data-sec]'); if (it) show(it.dataset.sec); });
  $main.addEventListener('click', async (e) => {
    const t = e.target;
    const s = t.closest('[data-sw]');
    if (s) { s.classList.toggle('on'); await set(s.dataset.sw, s.classList.contains('on')); return; }
    const b = t.closest('.seg button');
    if (b) {
      const segEl = b.parentElement;
      segEl.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      await set(segEl.dataset.seg, JSON.parse(b.dataset.v));
      return;
    }
    if (t.id === 'login') { t.classList.toggle('on'); await api.loginItem(t.classList.contains('on')); return; }
    const appSw = t.closest('[data-app]');
    if (appSw) {
      appSw.classList.toggle('on');
      const apps = new Set(C.media.apps);
      if (appSw.classList.contains('on')) apps.add(appSw.dataset.app); else apps.delete(appSw.dataset.app);
      await set('media.apps', [...apps]);
      return;
    }
    if (t.id === 'addcal') { const v = document.getElementById('calurl').value.trim(); if (v) { C = await api.setConfig({ calendars: [...(C.calendars || []), v] }); await api.refreshCalendar(); show('calendar'); } return; }
    if (t.id === 'refcal') { t.textContent = '…'; await api.refreshCalendar(); show('calendar'); return; }
    if (t.dataset.delcal) { const list = [...C.calendars]; list.splice(+t.dataset.delcal, 1); C = await api.setConfig({ calendars: list }); show('calendar'); return; }
    if (t.id === 'addev') {
      const title = document.getElementById('evtitle').value.trim();
      const start = document.getElementById('evstart').value;
      const dur = +document.getElementById('evdur').value || 60;
      if (!title || !start) return;
      const st = new Date(start);
      C = await api.setConfig({ localEvents: [...(C.localEvents || []), { title, start: st.toISOString(), end: new Date(st.getTime() + dur * 60000).toISOString() }] });
      show('calendar');
      return;
    }
    if (t.dataset.delev) { const list = [...C.localEvents]; list.splice(+t.dataset.delev, 1); C = await api.setConfig({ localEvents: list }); show('calendar'); return; }
    if (t.id === 'addapp' || t.id === 'addign') {
      const input = document.getElementById(t.id === 'addapp' ? 'appname' : 'ignname');
      const v = input.value.trim(); if (!v) return;
      const key = t.id === 'addapp' ? 'apps' : 'ignore';
      C = await api.setConfig({ notifications: { [key]: [...(C.notifications[key] || []), v] } });
      show('notifications');
      return;
    }
    if (t.dataset.delapp || t.dataset.delign) {
      const key = t.dataset.delapp ? 'apps' : 'ignore';
      const list = [...C.notifications[key]]; list.splice(+(t.dataset.delapp || t.dataset.delign), 1);
      C = await api.setConfig({ notifications: { [key]: list } });
      show('notifications');
      return;
    }
    if (t.id === 'clearclips') { await api.clipClear(); t.textContent = 'Cleared'; return; }
    if (t.dataset.demo) api.demo(t.dataset.demo);
  });
  let rangeT = null;
  $main.addEventListener('input', (e) => {
    const r = e.target.closest('[data-range]');
    if (!r) return;
    r.nextElementSibling.textContent = fmtVal(r.value, r.dataset.fmt);
    const path = r.dataset.range;
    const v = Number(r.value);
    path.split('.').reduce((o, k, i, a) => (i === a.length - 1 ? (o[k] = v) : o[k]), C);
    preview();
    clearTimeout(rangeT);
    rangeT = setTimeout(() => set(path, v), 60);
  });
  $main.addEventListener('change', async (e) => {
    const n = e.target.closest('[data-num]');
    if (n) { await set(n.dataset.num, Number(n.value)); return; }
    const tx = e.target.closest('[data-text]');
    if (tx) await set(tx.dataset.text, tx.value.trim());
  });
  api.on('config', (c) => { C = c; });
  api.on('section', (s) => show(s));
  api.on('bt-list', () => { if (current === 'battery') show('battery'); });

  (async () => { C = await api.getConfig(); if (!SECTIONS.find((s) => s[0] === current)) current = 'general'; show(current); })();
})();
