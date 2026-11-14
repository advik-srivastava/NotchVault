"""Phone Link call detection and control.

Signals, strongest first:
  * a window (Phone Link or the Windows notification pop-up) with answer / decline / end buttons
  * Phone Link writing the caller photo (TempState/<ts>/contact_thmb_Calling_*.jpg) = a call started
  * Phone Link's calling.db being written after that = the call was logged, i.e. it is over

Answer / Decline / End from the island press the real buttons in Phone Link's own UI, so the
call is actually answered or rejected on the phone.
"""
import ctypes
import ctypes.wintypes as wt
import glob
import os
import re
import subprocess
import threading
import time

from phonelink import PKG, TEMP_STATE, DATA_DIR, latest_call_photo, _proc_name

LOG_PATH = os.path.join(DATA_DIR, "phonelink-calls.log")
user32 = ctypes.windll.user32
EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)

# Phone Link without PC call audio offers "Use mobile device" (= answer on the phone) instead of "Answer"
ACCEPT_RE = re.compile(r"\b(accept|answer|pick ?up|receive|use mobile device|use (your )?phone|answer on)\b", re.I)
DECLINE_RE = re.compile(r"\b(decline|reject|ignore|dismiss)\b", re.I)
END_RE = re.compile(r"\b(end call|end|hang ?up|disconnect)\b", re.I)
MUTE_RE = re.compile(r"\b(mute|unmute|microphone)\b", re.I)
NOT_END_RE = re.compile(r"\b(send|weekend|append|legend)\b", re.I)
NOISE_RE = re.compile(r"(phone link|incoming|calling|call|transfer|hold|on mobile device|mute|unmute|keypad|speaker|accept|decline|answer|hang|message|minimi[sz]e|close|maximi[sz]e|restore|settings|audio|bluetooth|notification|^\d{1,2}:\d{2}(:\d{2})?$)", re.I)
NUMBER_RE = re.compile(r"^\+?[\d][\d\s\-()]{6,}$")
PHONE_PROCS = ("phoneexperiencehost.exe", "yourphone.exe", "yourphoneappproxyhost.exe")
TOAST_PROCS = ("shellexperiencehost.exe", "explorer.exe", "startmenuexperiencehost.exe")


def newest_call_thumb():
    try:
        files = glob.glob(os.path.join(TEMP_STATE, "*", "contact_thmb_Calling_*.jpg"))
        return max((os.path.getmtime(f) for f in files), default=0)
    except Exception:
        return 0


def calling_db_mtime():
    try:
        dbs = glob.glob(os.path.join(PKG, "LocalCache", "Indexed", "*", "System", "Database", "calling.db*"))
        return max((os.path.getmtime(f) for f in dbs), default=0)
    except Exception:
        return 0


def top_windows():
    out, names = [], {}

    def cb(hwnd, _l):
        if not user32.IsWindowVisible(hwnd):
            return True
        pid = wt.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        p = pid.value
        if p not in names:
            names[p] = _proc_name(p)
        r = wt.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(r))
        n = user32.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(n + 1)
        user32.GetWindowTextW(hwnd, buf, n + 1)
        out.append({"hwnd": hwnd, "proc": names[p], "title": buf.value, "w": r.right - r.left, "h": r.bottom - r.top})
        return True

    user32.EnumWindows(EnumWindowsProc(cb), 0)
    return out


def open_phone_link():
    subprocess.Popen(["explorer.exe", "shell:AppsFolder\\Microsoft.YourPhone_8wekyb3d8bbwe!App"])


class CallWatcher(threading.Thread):
    def __init__(self, emit, log, contacts):
        super().__init__(daemon=True)
        self.emit, self.log, self.contacts = emit, log, contacts
        self.enabled = True
        self.state = None              # None | incoming | active
        self.info = {}
        self.signal_at = 0
        self.thumb_seen = newest_call_thumb()
        self.db_seen = calling_db_mtime()
        self.buttons = {}
        self.buttons_ever = False
        self.no_buttons_since = None
        self.requests = []
        self.lock = threading.Lock()
        self.call_hwnd = None
        self.user_showed = False
        self.hide_window = True
        self.sync_el, self.sync_at = 0, 0

    # ---------------------------------------------------------------- from the bridge thread
    def request(self, action):
        with self.lock:
            self.requests.append(action)

    # ---------------------------------------------------------------- helpers
    def _log(self, line):
        try:
            os.makedirs(DATA_DIR, exist_ok=True)
            if os.path.exists(LOG_PATH) and os.path.getsize(LOG_PATH) > 300_000:
                os.remove(LOG_PATH)
            with open(LOG_PATH, "a", encoding="utf-8") as fh:
                fh.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {line}\n")
        except Exception:
            pass

    def toast_signal(self, name="", number=""):
        """Called when the bridge sees Phone Link's 'Incoming Call' notification."""
        self.signal_at = time.time()
        if name:
            self.info["name"] = name
        if number:
            self.info["number"] = number

    def _scan_toasts(self, auto):
        """Phone Link puts Answer / Decline on its Windows notification pop-up ('New notification').
        Those pop-ups are not normal top-level windows, so they are found through the UIA root."""
        logging = self.signal_at and time.time() - self.signal_at < 120
        try:
            roots = auto.GetRootControl().GetChildren()
        except Exception:
            return {}, []
        for w in roots:
            nm = (w.Name or "").lower()
            if "notification" not in nm or w.ClassName != "Windows.UI.Core.CoreWindow":
                continue
            buttons, texts = {}, []
            try:
                for c, _d in auto.WalkControl(w, maxDepth=22):
                    name = (c.Name or "").strip()
                    if not name:
                        continue
                    if c.ControlTypeName == "ButtonControl":
                        buttons.setdefault(name, c)
                    else:
                        texts.append(name)
            except Exception:
                continue
            joined = " ".join(texts).lower()
            # only ever touch Phone Link's call notification (never other apps' Dismiss buttons)
            if not ("phone link" in joined or "incoming call" in joined or "calling" in joined):
                continue
            roles = {}
            for name, c in buttons.items():
                if ACCEPT_RE.search(name):
                    roles.setdefault("accept", c)
                elif DECLINE_RE.search(name):
                    roles.setdefault("decline", c)
                elif END_RE.search(name) and not NOT_END_RE.search(name):
                    roles.setdefault("end", c)
                elif MUTE_RE.search(name):
                    roles.setdefault("mute", c)
            if logging:
                self._log(f"toast {w.Name!r} buttons={list(buttons)[:12]} texts={texts[:10]}")
            if "accept" in roles or "end" in roles or "decline" in roles:
                return roles, texts
        return {}, []

    def _scan(self, auto, wins, deep):
        if deep:
            roles, texts = self._scan_toasts(auto)
            if roles:
                return roles, texts
        logging = self.signal_at and time.time() - self.signal_at < 120
        for w in wins:
            is_phone = w["proc"] in PHONE_PROCS
            is_toast = w["proc"] in TOAST_PROCS and ("notification" in w["title"].lower() or (0 < w["w"] < 520 and 0 < w["h"] < 400))
            if not (is_phone or is_toast):
                continue
            big = w["w"] >= 760 or w["h"] >= 560
            if big and not deep:
                continue
            try:
                ctl = auto.ControlFromHandle(w["hwnd"])
                buttons, texts = {}, []
                for c, _d in auto.WalkControl(ctl, maxDepth=30 if big else 16):
                    name = (c.Name or "").strip()
                    if not name:
                        continue
                    if c.ControlTypeName == "ButtonControl":
                        buttons.setdefault(name, c)
                    elif c.ControlTypeName in ("TextControl", "PaneControl", "GroupControl", "WindowControl", "ListItemControl"):
                        texts.append(name)
            except Exception:
                continue
            roles = {}
            for name, c in buttons.items():
                if ACCEPT_RE.search(name):
                    roles.setdefault("accept", c)
                elif DECLINE_RE.search(name):
                    roles.setdefault("decline", c)
                elif END_RE.search(name) and not NOT_END_RE.search(name):
                    roles.setdefault("end", c)
                elif MUTE_RE.search(name):
                    roles.setdefault("mute", c)
            if logging:
                self._log(f"scan proc={w['proc']} title={w['title']!r} size={w['w']}x{w['h']} buttons={list(buttons)[:16]} texts={texts[:10]}")
            if "accept" in roles or "end" in roles or "decline" in roles:
                if is_phone and "end" in roles:
                    self.call_hwnd = w["hwnd"]
                return roles, texts
        return {}, []

    # ---------------------------------------------------------------- Phone Link's own call window
    TIMER_RE = re.compile(r"\b(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\b")

    def _elapsed(self, texts):
        for t in texts:
            m = self.TIMER_RE.search(t)
            if m:
                h, mnt, sec = int(m.group(1) or 0), int(m.group(2)), int(m.group(3))
                return h * 3600 + mnt * 60 + sec
        return None

    def _hide_call_window(self):
        """Move Phone Link's call window off-screen: the island shows the call instead.
        It stays alive (and its End / Mute buttons keep working) so nothing changes for Phone Link."""
        hwnd = getattr(self, "call_hwnd", None)
        if not hwnd or self.user_showed or not self.hide_window:
            return
        r = wt.RECT()
        if not user32.GetWindowRect(hwnd, ctypes.byref(r)):
            return
        if r.left <= -20000:
            return
        self.saved_rect = (r.left, r.top)
        # SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE
        user32.SetWindowPos(hwnd, 0, -32000, -32000, 0, 0, 0x0001 | 0x0004 | 0x0010)
        self._log("moved Phone Link call window off-screen")

    def _show_call_window(self):
        hwnd = getattr(self, "call_hwnd", None)
        if not hwnd:
            return False
        self.user_showed = True
        x, y = getattr(self, "saved_rect", None) or (200, 120)
        user32.SetWindowPos(hwnd, 0, x, y, 0, 0, 0x0001 | 0x0004)
        user32.ShowWindow(hwnd, 9)          # SW_RESTORE
        user32.SetForegroundWindow(hwnd)
        return True

    def _caller(self, texts):
        number = next((t for t in texts if NUMBER_RE.match(t)), "")
        name = next((t for t in texts if not NOISE_RE.search(t) and not NUMBER_RE.match(t) and 1 < len(t) < 60), "")
        if not name and number:
            name = self.contacts.name_for_number(number) or number
        return name, number

    def _press(self, role):
        c = self.buttons.get(role)
        if c is None:
            return False
        try:
            try:
                c.GetInvokePattern().Invoke()
            except Exception:
                c.Click(simulateMove=False)
            self._log(f"pressed {role}")
            return True
        except Exception as e:
            self._log(f"press {role} failed {e!r}")
            return False

    def _emit_state(self, state, **info):
        self.state = state
        self.info.update({k: v for k, v in info.items() if v})
        self.emit({"type": "call", "data": {"id": "phonelink-call", "state": state, **self.info}})

    # ---------------------------------------------------------------- loop
    def run(self):
        try:
            import uiautomation as auto
        except Exception as e:
            self.log(f"call watcher unavailable {e!r}")
            return
        with auto.UIAutomationInitializerInThread(debug=False):
            while True:
                in_call = bool(self.state) or (time.time() - self.signal_at < 90)
                time.sleep(0.35 if in_call else 1.0)
                if not self.enabled:
                    continue
                try:
                    self._tick(auto, in_call)
                except Exception as e:
                    self._log(f"tick error {e!r}")

    def _tick(self, auto, in_call):
        now = time.time()
        thumb = newest_call_thumb()
        if thumb > self.thumb_seen + 0.5:
            self.thumb_seen = thumb
            self.signal_at = now
            self.db_seen = calling_db_mtime()
            self._log("signal: Phone Link wrote a caller photo (call started)")
            in_call = True

        if not in_call and not self.requests:
            return          # idle: no window scanning at all until a call starts (toast or caller photo)
        found, texts = self._scan(auto, top_windows(), deep=in_call)
        self.buttons = found
        if found:
            self.buttons_ever = True

        with self.lock:
            reqs, self.requests = self.requests, []
        for action in reqs:
            if action == "show":
                self.emit({"type": "callAction", "action": action, "ok": self._show_call_window()})
                continue
            ok = self._press(action)
            if not ok and action == "decline":
                ok = self._press("end")
            if not ok and action == "end":
                ok = self._press("decline")
            if not ok and action in ("accept", "decline", "end"):
                self._log(f"no {action} button visible")
                pass  # never pop Phone Link open; the island tells you to use the phone instead
            self.emit({"type": "callAction", "action": action, "ok": ok})
            if ok and action in ("decline", "end"):
                self._end("pressed " + action)
                return
            if ok and action == "accept":
                self._emit_state("active")
                self.no_buttons_since = now

        if found:
            self.no_buttons_since = None
            kind = "incoming" if ("accept" in found or "decline" in found) and "end" not in found else "active"
            if self.state == "active" and kind == "incoming":
                return          # the ringing pop-up can linger for a moment after answering
            if kind != self.state:
                name, number = self._caller(texts)
                photo = latest_call_photo(180) or self.contacts.photo_for(name, number)
                self._emit_state(kind, name=name or self.info.get("name") or "Incoming call", number=number, photo=photo)
            if kind == "active":
                self._hide_call_window()
                # keep the island's call timer in step with Phone Link's own timer
                el = self._elapsed(texts)
                if el is not None:
                    expected = (self.sync_el + (now - self.sync_at)) if self.sync_at else None
                    if expected is None or abs(expected - el) > 1.2:
                        self.sync_el, self.sync_at = el, now
                        self.emit({"type": "call", "data": {"id": "phonelink-call", "state": "active", **self.info, "elapsed": el}})
            return

        if not self.state and self.signal_at and now - self.signal_at < 45:
            # a call started but no window with buttons is visible (e.g. Phone Link minimised)
            self._emit_state("incoming", name=self.info.get("name") or "Incoming call", photo=latest_call_photo(180))
            return

        if self.state:
            if self.no_buttons_since is None:
                self.no_buttons_since = now
            db = calling_db_mtime()
            logged = db > self.db_seen + 0.5        # Phone Link writes the call record when a call is over
            if logged:
                self.db_seen = db
                self._end("call logged")
                return
            quiet = now - self.no_buttons_since
            if self.state == "incoming" and self.buttons_ever and quiet > 3:
                # the ringing notification went away and no call record appeared -> it was answered
                self._emit_state("active")
                return
            if quiet > (3 * 3600 if self.state == "active" else 75):
                self._end("timed out")

    def _end(self, why):
        self.call_hwnd = None
        self.user_showed = False
        self.sync_el, self.sync_at = 0, 0
        self._log(f"call ended ({why})")
        self.emit({"type": "call", "data": {"id": "phonelink-call", "state": "ended"}})
        self.state, self.info, self.signal_at = None, {}, 0
        self.buttons_ever = False
        self.no_buttons_since = None
