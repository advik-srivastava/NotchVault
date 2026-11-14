"""
NotchVault bridge (Crazified Studios).

Talks to Windows on behalf of the Electron UI over stdin/stdout (one JSON
object per line):

  out -> {"type": "media",  "data": {...} | null}
         {"type": "notif",  "data": {...}}
         {"type": "call",   "data": {...}}
         {"type": "volume", "value": 0..1}
         {"type": "log",    "msg": "..."}
  in  <- {"cmd": "media", "action": "toggle|next|prev|shuffle|repeat|seek", "value": seconds}
         {"cmd": "volume", "value": 0..1}
         {"cmd": "open", "aumid": "..."}
         {"cmd": "call", "action": "accept|decline|end|mute"}
         {"cmd": "config", "data": {...}}
"""
import sys
# pycaw/comtypes must not put the main thread into a single-threaded apartment,
# otherwise WinRT async calls never complete (no message pump). Use MTA.
sys.coinit_flags = 0

import asyncio
import base64
import json
import os
import re
import phonelink
import appvolume
import subprocess
import sys
import threading
import time

from winrt.windows.media.control import (
    GlobalSystemMediaTransportControlsSessionManager as SessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as PlaybackStatus,
)
from winrt.windows.storage.streams import Buffer, InputStreamOptions, DataReader
from winrt.windows.ui.notifications.management import UserNotificationListener
from winrt.windows.ui.notifications import NotificationKinds, KnownNotificationBindings
from winrt.windows.foundation import Size

sys.stdout.reconfigure(encoding="utf-8")

CONFIG = {
    "mediaApps": ["spotify", "applemusic"],
    "allowOtherMediaApps": False,
    "notificationApps": [],          # empty = every app
    "ignoreNotificationApps": [],
    "phoneLinkCalls": True,
    "takeOverBanners": True,
    "agentAlerts": True,
}

OUT_LOCK = threading.Lock()


def emit(obj):
    with OUT_LOCK:
        sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
        sys.stdout.flush()


def log(msg):
    emit({"type": "log", "msg": str(msg)})


# --------------------------------------------------------------------------- helpers
async def read_stream_b64(stream_ref, limit=4 * 1024 * 1024):
    """Read an IRandomAccessStreamReference into base64."""
    if stream_ref is None:
        return None
    try:
        stream = await stream_ref.open_read_async()
        size = min(int(stream.size), limit)
        if size <= 0:
            return None
        buf = Buffer(size)
        await stream.read_async(buf, size, InputStreamOptions.READ_AHEAD)
        reader = DataReader.from_buffer(buf)
        data = bytearray(buf.length)
        reader.read_bytes(data)
        return base64.b64encode(bytes(data)).decode("ascii")
    except Exception as e:  # noqa
        log(f"stream read failed: {e!r}")
        return None


def _safe(fn, default):
    """Some players expose fields others don't; never let one odd field stop detection."""
    try:
        v = fn()
        return default if v is None else v
    except Exception:
        return default


def classify_media(aumid: str) -> str:
    a = (aumid or "").lower()
    if "spotify" in a:
        return "spotify"
    if "applemusic" in a or "apple music" in a or "itunes" in a or "appleinc" in a:
        return "applemusic"
    return "other"


# --------------------------------------------------------------------------- media
class Media:
    def __init__(self):
        self.mgr = None
        self.session = None
        self.last_key = None
        self.last_art_key = None
        self.art_cache = None
        self.last_sent = None

    async def init(self):
        self.mgr = await SessionManager.request_async()

    def pick_session(self):
        sessions = list(self.mgr.get_sessions())
        allowed = []
        for s in sessions:
            kind = classify_media(s.source_app_user_model_id)
            if kind in CONFIG["mediaApps"] or (kind == "other" and CONFIG["allowOtherMediaApps"]):
                allowed.append(s)
        if not allowed:
            return None
        # prefer one that is playing, then Spotify / Apple Music, then whatever
        def score(s):
            st = s.get_playback_info().playback_status
            playing = 2 if st == PlaybackStatus.PLAYING else (1 if st == PlaybackStatus.PAUSED else 0)
            pref = 1 if classify_media(s.source_app_user_model_id) != "other" else 0
            return (playing, pref)
        allowed.sort(key=score, reverse=True)
        return allowed[0]

    async def poll(self):
        try:
            s = self.pick_session()
        except Exception as e:
            log(f"session pick failed {e!r}")
            s = None
        self.session = s
        if s is None:
            if self.last_sent is not None:
                emit({"type": "media", "data": None})
                self.last_sent = None
            return
        try:
            props = await s.try_get_media_properties_async()
        except Exception:
            return
        info = s.get_playback_info()
        tl = s.get_timeline_properties()
        status = {
            PlaybackStatus.PLAYING: "playing",
            PlaybackStatus.PAUSED: "paused",
            PlaybackStatus.STOPPED: "stopped",
        }.get(info.playback_status, "unknown")

        art_key = f"{s.source_app_user_model_id}|{props.title}|{props.artist}|{props.album_title}"
        if art_key != self.last_art_key:
            self.last_art_key = art_key
            self.art_cache = await read_stream_b64(props.thumbnail)
            if self.art_cache is None:
                # Spotify sometimes publishes the thumbnail a moment after the title
                self.last_art_key = None if props.title else art_key

        def secs(td):
            try:
                return td.total_seconds()
            except Exception:
                return float(td.duration) / 1e7 if td else 0.0

        pos = secs(tl.position)
        dur = secs(tl.end_time) - secs(tl.start_time)
        updated = tl.last_updated_time
        try:
            upd_ts = updated.timestamp()
        except Exception:
            upd_ts = time.time()

        ctrls = info.controls
        artist = props.artist or ""
        album = props.album_title or ""
        # Apple Music for Windows reports "Artist — Album" in the artist field
        if not album and " — " in artist:
            artist, album = artist.split(" — ", 1)
            album = re.sub(r"\s+-\s+(Single|EP)$", "", album.strip())
        data = {
            "app": s.source_app_user_model_id,
            "source": classify_media(s.source_app_user_model_id),
            "title": props.title or "",
            "artist": artist.strip(),
            "album": album.strip(),
            "status": status,
            "position": pos,
            "duration": dur if dur > 0 else 0,
            "updated": upd_ts,
            "shuffle": _safe(lambda: bool(info.is_shuffle_active), False),
            "repeat": _safe(lambda: int(info.auto_repeat_mode), 0),
            "canShuffle": bool(ctrls.is_shuffle_enabled),
            "canSeek": bool(ctrls.is_playback_position_enabled),
            "artKey": art_key,
        }
        # Only resend when something meaningful changed. Position moves every poll, so it
        # is compared against where the UI would have extrapolated it (a jump = a seek).
        stable = {k: v for k, v in data.items() if k not in ("position", "updated")}
        key = json.dumps(stable, sort_keys=True)
        seeked = False
        prev = self.last_sent
        if prev is not None and key == self.last_key:
            expected = prev["position"] + ((time.time() - prev["now"]) if prev["status"] == "playing" else 0)
            seeked = abs(expected - pos) > 2.5
        if key != self.last_key or seeked:
            self.last_key = key
            out = dict(data)
            out["position"] = pos
            out["updated"] = time.time()
            out["now"] = time.time()
            if art_key != getattr(self, "sent_art_key", None) or self.art_cache and not getattr(self, "sent_art", False):
                out["art"] = self.art_cache
                self.sent_art_key = art_key
                self.sent_art = bool(self.art_cache)
            emit({"type": "media", "data": out})
            self.last_sent = out

    async def command(self, action, value=None):
        s = self.session
        if s is None:
            return
        try:
            if action == "toggle":
                await s.try_toggle_play_pause_async()
            elif action == "play":
                await s.try_play_async()
            elif action == "pause":
                await s.try_pause_async()
            elif action == "next":
                await s.try_skip_next_async()
            elif action == "prev":
                await s.try_skip_previous_async()
            elif action == "shuffle":
                cur = s.get_playback_info().is_shuffle_active
                await s.try_change_shuffle_active_async(not bool(cur))
            elif action == "repeat":
                cur = s.get_playback_info().auto_repeat_mode or 0
                await s.try_change_auto_repeat_mode_async((int(cur) + 1) % 3)
            elif action == "seek" and value is not None:
                await s.try_change_playback_position_async(int(float(value) * 1e7))
        except Exception as e:
            log(f"media cmd {action} failed {e!r}")
        self.last_key = None  # force resend


# --------------------------------------------------------------------------- volume
class Volume:
    def __init__(self):
        self.ep = None
        self.last = None

    def _endpoint(self):
        if self.ep is None:
            from pycaw.pycaw import AudioUtilities
            dev = AudioUtilities.GetSpeakers()
            self.ep = dev.EndpointVolume
            try:
                import volume_events

                def changed(v, muted):
                    self.last = v
                    emit({"type": "volume", "value": v, "muted": muted})
                self.cb = volume_events.register(self.ep, changed)   # instant, event-driven
            except Exception as e:
                log(f"volume events unavailable {e!r}")
        return self.ep

    def get(self):
        try:
            return float(self._endpoint().GetMasterVolumeLevelScalar())
        except Exception:
            self.ep = None
            return None

    def set(self, v):
        try:
            self._endpoint().SetMasterVolumeLevelScalar(max(0.0, min(1.0, float(v))), None)
        except Exception as e:
            self.ep = None
            log(f"volume set failed {e!r}")

    def poll(self):
        v = self.get()
        if v is not None and (self.last is None or abs(v - self.last) > 0.005):
            self.last = v
            emit({"type": "volume", "value": v})


# --------------------------------------------------------------------------- notifications
CALL_RE = re.compile(r"\b(incoming (voice |video )?call|is calling|calling you|incoming call)\b", re.I)
PHONE_LINK_AUMID = "Microsoft.YourPhone_8wekyb3d8bbwe!App"
PL_ICON_DIR = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Packages", "Microsoft.YourPhone_8wekyb3d8bbwe", "TempState", "app_icons")

KNOWN_APPS = {
    "com.whatsapp": "WhatsApp", "com.whatsapp.w4b": "WhatsApp Business", "com.instagram.android": "Instagram",
    "com.truecaller": "Truecaller", "com.google.android.youtube": "YouTube", "com.google.android.gm": "Gmail",
    "com.google.android.calendar": "Google Calendar", "com.linkedin.android": "LinkedIn", "org.telegram.messenger": "Telegram",
    "com.snapchat.android": "Snapchat", "com.facebook.katana": "Facebook", "com.facebook.orca": "Messenger",
    "com.twitter.android": "X", "com.spotify.music": "Spotify", "com.google.android.apps.nbu.paisa.user": "Google Pay",
    "net.one97.paytm": "Paytm", "com.phonepe.app": "PhonePe", "com.microsoft.office.outlook": "Outlook",
    "com.openai.chatgpt": "ChatGPT", "in.startv.hotstar": "Hotstar", "com.amazon.dee.app": "Alexa",
    "com.coloros.weather2": "Weather", "com.android.systemui": "System", "com.google.android.gms": "Google",
}


def phone_link_source(aumid):
    """Return (android_package, friendly_name) for Phone Link senders, (None, None) otherwise."""
    a = aumid or ""
    if "YourPhoneNotifications_" in a:
        pkg = a.split("YourPhoneNotifications_", 1)[1]
        if pkg in KNOWN_APPS:
            return pkg, KNOWN_APPS[pkg]
        parts = [p for p in pkg.split(".") if p not in ("com", "android", "app", "in", "net", "org", "co", "apps")]
        return pkg, (parts[0] if parts else pkg).replace("_", " ").title()
    if "YourPhoneMessages_" in a:
        return "sms", "Messages"
    if "YourPhoneCall" in a:
        return "calls", "Phone"
    if "YourPhone" in a:
        return "", "Phone Link"
    return None, None


NAME_TO_PKG = {v.lower(): k for k, v in KNOWN_APPS.items()}


def installed_pkg_for(app_name):
    """Match an Android app name to a package that Phone Link cached an icon for."""
    try:
        want = re.sub(r"[^a-z0-9]", "", app_name.lower())
        if len(want) < 3 or not os.path.isdir(PL_ICON_DIR):
            return None
        for f in os.listdir(PL_ICON_DIR):
            m = re.match(r"app_icon_([a-zA-Z0-9_.]+?)\d", f)
            if m and want in m.group(1).lower().replace(".", "").replace("_", ""):
                return m.group(1).rstrip(".")
    except Exception:
        pass
    return None


def phone_link_icon(pkg):
    """Phone Link caches every Android app icon as app_icon_<package><version>.png"""
    if not pkg or not os.path.isdir(PL_ICON_DIR):
        return None
    try:
        prefix = f"app_icon_{pkg}"
        best = None
        for f in os.listdir(PL_ICON_DIR):
            if f.startswith(prefix) and f.lower().endswith(".png"):
                rest = f[len(prefix):]
                # version must follow directly (so com.whatsapp doesn't match com.whatsapp.w4b)
                if rest[:1].isdigit():
                    best = f
        if best:
            with open(os.path.join(PL_ICON_DIR, best), "rb") as fh:
                return base64.b64encode(fh.read()).decode("ascii")
    except Exception as e:
        log(f"icon read failed {e!r}")
    return None


class Notifications:
    def __init__(self, contacts=None):
        self.contacts = contacts
        self.listener = None
        self.seen = set()
        self.ok = False
        self.icon_cache = {}
        self.active_call = None   # notification id of current incoming call
        self.live = set()         # ids shown in the island that still exist in Windows

    async def init(self):
        self.listener = UserNotificationListener.current
        st = await self.listener.request_access_async()
        self.ok = int(st) == 1
        if not self.ok:
            log("Notification access denied. Enable it in Settings > Privacy > Notifications.")
            return
        # Everything already in the notification centre is history; only new ones are shown.
        for n in await self.listener.get_notifications_async(NotificationKinds.TOAST):
            self.seen.add(n.id)

    async def icon_for(self, app_info, pkg=None):
        key = pkg or app_info.app_user_model_id
        if self.icon_cache.get(key):
            return self.icon_cache[key]
        b64 = phone_link_icon(pkg) if pkg else None
        if b64 is None:
            try:
                ref = app_info.display_info.get_logo(Size(64, 64))
                b64 = await read_stream_b64(ref)
            except Exception:
                pass
        self.icon_cache[key] = b64
        return b64

    def allowed(self, name, aumid, friendly):
        hay = f"{name} {aumid} {friendly or ''}".lower()
        if any(x.lower() in hay for x in CONFIG["ignoreNotificationApps"]):
            return False
        apps = CONFIG["notificationApps"]
        return not apps or any(x.lower() in hay for x in apps)

    def remove(self, nid):
        try:
            self.listener.remove_notification(int(nid))
        except Exception as e:
            log(f"remove failed {e!r}")
        self.live.discard(int(nid))

    async def poll(self):
        if not self.ok:
            return
        try:
            items = list(await self.listener.get_notifications_async(NotificationKinds.TOAST))
        except Exception as e:
            log(f"notif poll failed {e!r}")
            return
        ids = {n.id for n in items}

        # incoming call toast vanished -> answered elsewhere / missed / declined
        if self.active_call is not None and self.active_call not in ids:
            emit({"type": "call", "data": {"id": self.active_call, "state": "toast-gone"}})
            self.active_call = None

        # sync: cleared in Windows / Phone Link -> clear in the island too
        for nid in list(self.live):
            if nid not in ids:
                self.live.discard(nid)
                emit({"type": "notif-removed", "id": nid})

        for n in items:
            if n.id in self.seen:
                continue
            self.seen.add(n.id)
            try:
                app = n.app_info
                name = app.display_info.display_name
                aumid = app.app_user_model_id
            except Exception:
                name, aumid = "App", ""
            texts = []
            try:
                b = n.notification.visual.get_binding(KnownNotificationBindings.toast_generic)
                if b:
                    texts = [t.text.strip() for t in b.get_text_elements() if t.text and t.text.strip()]
            except Exception:
                pass
            title = texts[0] if texts else name
            body = "\n".join(texts[1:]) if len(texts) > 1 else ""
            try:
                created = n.creation_time.timestamp()
            except Exception:
                created = time.time()
            if time.time() - created > 120:   # stale / re-synced history
                continue

            agent = appvolume.detect_agent(name, aumid) if CONFIG.get("agentAlerts", True) else None
            if agent:
                emit({"type": "agent-notif", "data": {
                    "agent": agent, "app": name, "title": title, "body": body,
                    "icon": await self.icon_for(app), "time": created}})
                if CONFIG.get("takeOverBanners"):
                    self.remove(n.id)
                continue
            pkg, friendly = phone_link_source(aumid)
            # Phone Link often posts under its generic id with the Android app name as the first line,
            # e.g. ["WhatsApp", "Papa", "Hi"]  ->  app WhatsApp, sender Papa, message Hi
            if pkg == "" and len(texts) >= 2:
                lead = texts[0].strip()
                hit = NAME_TO_PKG.get(lead.lower()) or installed_pkg_for(lead)
                if hit or (len(texts) >= 3 and len(lead) <= 24 and not re.search(r"incoming|missed|call", " ".join(texts), re.I)):
                    pkg, friendly = (hit or ""), lead
                    title = texts[1]
                    body = "\n".join(texts[2:])
            is_phone_link = pkg is not None
            joined = " ".join(texts)
            if CONFIG["phoneLinkCalls"] and is_phone_link and (pkg == "calls" or CALL_RE.search(joined)):
                caller = title
                if CALL_RE.search(caller) and len(texts) > 1:
                    caller = texts[1]
                number = ""
                for t in texts:
                    if re.fullmatch(r"[+\d][\d\s\-()]{5,}", t):
                        number = t
                self.active_call = n.id   # keep the toast: its Accept/Decline buttons are used
                if getattr(self, "calls", None):
                    self.calls.toast_signal(caller, number)
                emit({"type": "call", "data": {
                    "id": n.id, "state": "incoming", "name": caller, "number": number,
                    "video": "video" in joined.lower(), "icon": await self.icon_for(app),
                    "photo": phonelink.latest_call_photo() or (self.contacts.photo_for(caller, number) if self.contacts else None),
                }})
                continue

            if not self.allowed(name, aumid, friendly):
                continue

            source = "phonelink" if is_phone_link else ("outlook" if "outlook" in aumid.lower() else "windows")
            emit({"type": "notif", "data": {
                "id": n.id, "app": friendly or name, "source": source,
                "aumid": PHONE_LINK_AUMID if is_phone_link else aumid,
                "title": title, "body": body, "icon": await self.icon_for(app, pkg or None), "time": created,
                "photo": (self.contacts.photo_for(title) if (self.contacts and is_phone_link) else None),
            }})
            if CONFIG.get("takeOverBanners"):
                # pull it out of Windows: the banner vanishes and the island owns it
                self.remove(n.id)
            else:
                self.live.add(n.id)


# --------------------------------------------------------------------------- Phone Link UI automation
def _click_phone_link_button(names):
    """Best effort: find a button with one of `names` in a toast or Phone Link window."""
    try:
        import uiautomation as auto
    except Exception:
        return False
    auto.SetGlobalSearchTimeout(1.5)
    roots = []
    try:
        for w in auto.GetRootControl().GetChildren():
            nm = (w.Name or "").lower()
            cls = (w.ClassName or "").lower()
            if "notification" in nm or "phone link" in nm or "coreWindow".lower() in cls:
                roots.append(w)
    except Exception:
        return False
    wanted = [x.lower() for x in names]
    for root in roots:
        try:
            for ctrl, _depth in auto.WalkControl(root, maxDepth=12):
                if ctrl.ControlTypeName == "ButtonControl" and (ctrl.Name or "").lower() in wanted:
                    try:
                        ctrl.GetInvokePattern().Invoke()
                    except Exception:
                        ctrl.Click(simulateMove=False)
                    return True
        except Exception:
            continue
    return False


def call_action(action):
    names = {
        "accept": ["Accept", "Answer", "Accept call", "Answer call"],
        "decline": ["Decline", "Reject", "Decline call", "Ignore"],
        "end": ["End call", "Hang up", "End"],
        "mute": ["Mute", "Unmute", "Mute microphone"],
    }.get(action, [])
    ok = _click_phone_link_button(names)
    if not ok and action == "accept":
        # fall back to bringing Phone Link forward so the user can answer there
        subprocess.Popen(["explorer.exe", "shell:AppsFolder\\Microsoft.YourPhone_8wekyb3d8bbwe!App"])
    emit({"type": "callAction", "action": action, "ok": ok})


# --------------------------------------------------------------------------- quit a player app
def quit_app(app_id):
    import ctypes, ctypes.wintypes as wt
    a = (app_id or "").lower()
    exe = "applemusic.exe" if "applemusic" in a else "spotify.exe" if "spotify" in a else None
    if not exe:
        return
    from phonelink import _proc_name
    user32 = ctypes.windll.user32
    proc = ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)
    closed = []

    def cb(hwnd, _l):
        pid = wt.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if _proc_name(pid.value) == exe and user32.IsWindowVisible(hwnd):
            user32.PostMessageW(hwnd, 0x0010, 0, 0)  # WM_CLOSE: let the app shut down normally
            closed.append(pid.value)
        return True

    user32.EnumWindows(proc(cb), 0)

    def finish():
        time.sleep(2.5)
        subprocess.run(["taskkill", "/IM", exe, "/F"], capture_output=True)   # Spotify only hides on close
    threading.Thread(target=finish, daemon=True).start()
    log(f"quit {exe} (windows closed: {len(closed)})")


# --------------------------------------------------------------------------- main loop
async def main():
    media = Media()
    vol = Volume()
    contacts = phonelink.Contacts(log)
    try:
        contacts.load()
    except Exception as e:
        log(f"contacts unavailable {e!r}")
    notifs = Notifications(contacts)
    import calls as calls_mod
    calls = calls_mod.CallWatcher(emit, log, contacts)
    calls.start()
    try:
        import radios as radios_mod
        radios_mod.RadioWatcher(emit, log).start()
    except Exception as e:
        log(f"radios unavailable {e!r}")
    try:
        import brightness as brightness_mod
        bright = brightness_mod.Brightness(emit, log)
        bright.start()
    except Exception as e:
        bright = None
        log(f"brightness unavailable {e!r}")
    notifs.calls = calls
    await media.init()
    try:
        await notifs.init()
    except Exception as e:
        log(f"notification init failed {e!r}")

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def reader():
        import os
        pending = b""
        while True:
            try:
                chunk = os.read(0, 65536)
            except OSError:
                chunk = b""
            if not chunk:
                break
            pending += chunk
            while b"\n" in pending:
                raw, pending = pending.split(b"\n", 1)
                line = raw.decode("utf-8", "replace").strip()
                if line:
                    loop.call_soon_threadsafe(queue.put_nowait, line)
        loop.call_soon_threadsafe(queue.put_nowait, None)

    threading.Thread(target=reader, daemon=True).start()

    async def handle(line):
        try:
            msg = json.loads(line)
        except Exception:
            return
        cmd = msg.get("cmd")
        if cmd == "media":
            await media.command(msg.get("action"), msg.get("value"))
            await asyncio.sleep(0.35)
            await media.poll()
        elif cmd == "app-volume":
            app_id = msg.get("app", "")
            if msg.get("value") is not None:
                appvolume.set_(app_id, msg["value"])
            v = appvolume.get(app_id)
            emit({"type": "app-volume", "app": app_id, "value": v})
        elif cmd == "brightness":
            if bright:
                bright.set(msg.get("value", 50))
        elif cmd == "quit-app":
            quit_app(msg.get("app", ""))
        elif cmd == "volume":
            vol.set(msg.get("value", 0.5))
            vol.poll()
        elif cmd == "open" and msg.get("aumid"):
            aumid = msg["aumid"]
            if aumid.lower().endswith(".exe") or aumid.lower() == "spotify":
                exe = os.path.join(os.environ.get("APPDATA", ""), "Spotify", "Spotify.exe")
                if "spotify" in aumid.lower() and os.path.exists(exe):
                    subprocess.Popen([exe])
                else:
                    os.startfile(aumid)
            else:
                subprocess.Popen(["explorer.exe", "shell:AppsFolder\\" + aumid])
        elif cmd == "notif-dismiss" and msg.get("id") is not None:
            notifs.remove(msg["id"])
        elif cmd == "call":
            calls.request(msg.get("action"))   # pressed in Phone Link's own UI by the watcher thread
        elif cmd == "config":
            CONFIG.update(msg.get("data") or {})
            calls.enabled = bool(CONFIG.get("phoneLinkCalls", True))
            media.last_key = None
        elif cmd == "refresh":
            media.last_key = None
            media.force_power = True
            media.sent_art_key = None      # resend the album art too (the UI may have just loaded)
            media.sent_art = False
            await media.poll()

    async def commands():
        while True:
            line = await queue.get()
            if line is None:
                # parent went away
                loop.stop()
                return
            await handle(line)

    asyncio.ensure_future(commands())
    emit({"type": "ready", "notifications": notifs.ok})

    async def bt_loop():
        try:
            from bt import Bluetooth
            bt = Bluetooth(emit, log)
            bt.start()
        except Exception as e:
            log(f"bluetooth unavailable {e!r}")
            return
        while True:
            try:
                await bt.poll()
            except Exception as e:
                log(f"bt poll error {e!r}")
            await asyncio.sleep(1.0)

    asyncio.ensure_future(bt_loop())

    # clipboard: Windows bumps a sequence number on every copy; reading it is nearly free,
    # so the app only touches the clipboard when something was actually copied
    import ctypes
    get_clip_seq = ctypes.windll.user32.GetClipboardSequenceNumber
    clip_seq = get_clip_seq()

    # Budget (idle): notifications ~3x/s (fast enough to catch banners), media ~1x/s,
    # volume is event-driven (this poll is only a safety net).
    # battery: the exact percentage Windows shows (GetSystemPowerStatus), sent whenever it changes
    class _SPS(ctypes.Structure):
        _fields_ = [('ac', ctypes.c_ubyte), ('flag', ctypes.c_ubyte), ('pct', ctypes.c_ubyte), ('saver', ctypes.c_ubyte),
                    ('life', ctypes.c_ulong), ('full', ctypes.c_ulong)]
    sps = _SPS()
    last_power = [None]
    def poll_power(force=False):
        if not ctypes.windll.kernel32.GetSystemPowerStatus(ctypes.byref(sps)) or sps.pct == 255 or sps.flag & 128:
            return
        cur = (sps.pct, sps.ac == 1, sps.saver == 1)
        if force or cur != last_power[0]:
            last_power[0] = cur
            emit({'type': 'power', 'data': {'level': sps.pct / 100, 'charging': sps.ac == 1, 'saver': sps.saver == 1}})

    tick = 0
    while True:
        try:
            await notifs.poll()
            if tick % 2 == 0 or getattr(media, 'force_power', False):
                force = getattr(media, 'force_power', False); media.force_power = False
                poll_power(force)
            if tick % 3 == 0:
                await media.poll()
            if tick % 40 == 0:
                vol.poll()
            seq = get_clip_seq()
            if seq != clip_seq:
                clip_seq = seq
                emit({"type": "clip-changed"})
        except Exception as e:
            log(f"loop error {e!r}")
        tick += 1
        await asyncio.sleep(0.33)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, RuntimeError):
        pass
