"""Phone Link helpers: contact photos and call detection.

* Contact photos come from Phone Link's own synced contacts database (read-only).
* During a call Phone Link writes the caller's picture to TempState/<ts>/contact_thmb_Calling_*.jpg.
* Calls are shown by Phone Link in its own window (not a Windows notification), so a watcher
  looks for Phone Link windows that contain Accept / Decline / End-call buttons.
"""
import base64
import ctypes
import ctypes.wintypes as wt
import glob
import os
import re
import sqlite3
import threading
import time
import unicodedata

PKG = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Packages", "Microsoft.YourPhone_8wekyb3d8bbwe")
TEMP_STATE = os.path.join(PKG, "TempState")
DATA_DIR = os.environ.get("NOTCHVAULT_DATA") or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
os.makedirs(DATA_DIR, exist_ok=True)
LOG_PATH = os.path.join(DATA_DIR, "phonelink-calls.log")


def _norm(s):
    s = unicodedata.normalize("NFKD", str(s or ""))
    s = "".join(ch for ch in s if ch.isalnum() or ch.isspace())
    return re.sub(r"\s+", " ", s).strip().lower()


def _digits(s):
    d = re.sub(r"\D", "", str(s or ""))
    return d[-10:] if len(d) >= 7 else ""


class Contacts:
    def __init__(self, log):
        self.log = log
        self.by_name = {}
        self.by_number = {}
        self.loaded_at = 0
        self.lock = threading.Lock()

    def _db_path(self):
        dbs = glob.glob(os.path.join(PKG, "LocalCache", "Indexed", "*", "System", "Database", "contacts.db"))
        dbs.sort(key=lambda p: os.path.getmtime(p), reverse=True)
        return dbs[0] if dbs else None

    def load(self):
        path = self._db_path()
        if not path:
            return
        by_name, by_number = {}, {}
        try:
            con = sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=2)
            rows = con.execute("select contact_id, display_name, thumbnail from contact").fetchall()
            photos = {}
            for cid, name, thumb in rows:
                if thumb and len(thumb) > 100:
                    photos[cid] = base64.b64encode(thumb).decode("ascii")
                if name:
                    by_name.setdefault(_norm(name), (name, photos.get(cid)))
            for cid, num in con.execute("select contact_id, phone_number from phonenumber"):
                key = _digits(num)
                if key:
                    name = next((r[1] for r in rows if r[0] == cid), None)
                    by_number.setdefault(key, (name, photos.get(cid)))
            con.close()
        except Exception as e:
            self.log(f"contacts load failed {e!r}")
            return
        with self.lock:
            self.by_name, self.by_number = by_name, by_number
            self.loaded_at = time.time()

    def refresh_if_stale(self):
        if time.time() - self.loaded_at > 600:
            self.load()

    def photo_for(self, title="", number=""):
        """Best-effort match of a notification title / caller to a contact photo."""
        self.refresh_if_stale()
        with self.lock:
            if number and _digits(number) in self.by_number:
                return self.by_number[_digits(number)][1]
            if _digits(title) and _digits(title) in self.by_number:
                return self.by_number[_digits(title)][1]
            t = _norm(title)
            if not t:
                return None
            if t in self.by_name:
                return self.by_name[t][1]
            # WhatsApp group style "Group: Person" / "Person (3 messages)" / "Person @ Group"
            for part in re.split(r"[:@(]| - ", title):
                p = _norm(part)
                if p and p in self.by_name and self.by_name[p][1]:
                    return self.by_name[p][1]
        return None

    def name_for_number(self, number):
        self.refresh_if_stale()
        with self.lock:
            hit = self.by_number.get(_digits(number))
        return hit[0] if hit else None


def latest_call_photo(max_age=120):
    try:
        files = glob.glob(os.path.join(TEMP_STATE, "*", "contact_thmb_Calling_*.jpg"))
        if not files:
            return None
        newest = max(files, key=os.path.getmtime)
        if time.time() - os.path.getmtime(newest) > max_age:
            return None
        with open(newest, "rb") as fh:
            return base64.b64encode(fh.read()).decode("ascii")
    except Exception:
        return None


# ------------------------------------------------------------------ window enumeration (ctypes)
user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32
EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wt.HWND, wt.LPARAM)


def _proc_name(pid):
    h = kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return ""
    try:
        buf = ctypes.create_unicode_buffer(512)
        size = wt.DWORD(512)
        if kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)):
            return os.path.basename(buf.value).lower()
    finally:
        kernel32.CloseHandle(h)
    return ""


def phone_link_windows():
    out = []
    names = {}

    def cb(hwnd, _l):
        if not user32.IsWindowVisible(hwnd):
            return True
        pid = wt.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        p = pid.value
        if p not in names:
            names[p] = _proc_name(p)
        if names[p] not in ("phoneexperiencehost.exe", "yourphone.exe", "yourphoneappproxyhost.exe"):
            return True
        r = wt.RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(r))
        n = user32.GetWindowTextLengthW(hwnd)
        buf = ctypes.create_unicode_buffer(n + 1)
        user32.GetWindowTextW(hwnd, buf, n + 1)
        out.append({"hwnd": hwnd, "title": buf.value, "w": r.right - r.left, "h": r.bottom - r.top})
        return True

    user32.EnumWindows(EnumWindowsProc(cb), 0)
    return out


ACCEPT_RE = re.compile(r"^(accept|answer)( call)?$", re.I)
DECLINE_RE = re.compile(r"^(decline|reject|ignore)( call)?$", re.I)
END_RE = re.compile(r"^(end call|hang up|end)$", re.I)
NOISE_RE = re.compile(r"(phone link|incoming|calling|call|mute|unmute|keypad|speaker|accept|decline|answer|hang|message|minimi[sz]e|close|maximi[sz]e|settings|audio|bluetooth|^\d{1,2}:\d{2}(:\d{2})?$)", re.I)
NUMBER_RE = re.compile(r"^\+?[\d][\d\s\-()]{6,}$")


class CallWatcher(threading.Thread):
    """Watches Phone Link's call windows and reports incoming / active / ended."""

    def __init__(self, emit, log, contacts):
        super().__init__(daemon=True)
        self.emit, self.log, self.contacts = emit, log, contacts
        self.state = None        # None | "incoming" | "active"
        self.hwnd = None
        self.info = {}
        self.missing = 0
        self.enabled = True

    def _read(self, hwnd):
        import uiautomation as auto
        ctl = auto.ControlFromHandle(hwnd)
        buttons, texts = [], []
        for c, _d in auto.WalkControl(ctl, maxDepth=14):
            name = (c.Name or "").strip()
            if not name:
                continue
            if c.ControlTypeName == "ButtonControl":
                buttons.append(name)
            elif c.ControlTypeName in ("TextControl", "PaneControl", "GroupControl", "WindowControl"):
                texts.append(name)
        return buttons, texts

    def _log(self, title, buttons, texts):
        try:
            os.makedirs(DATA_DIR, exist_ok=True)
            if os.path.exists(LOG_PATH) and os.path.getsize(LOG_PATH) > 200_000:
                os.remove(LOG_PATH)
            with open(LOG_PATH, "a", encoding="utf-8") as fh:
                fh.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} title={title!r} buttons={buttons[:12]} texts={texts[:12]}\n")
        except Exception:
            pass

    def _classify(self, buttons, texts):
        if any(ACCEPT_RE.match(b) for b in buttons):
            return "incoming"
        if any(END_RE.match(b) for b in buttons):
            return "active"
        return None

    def _caller(self, title, texts):
        number = next((t for t in texts if NUMBER_RE.match(t)), "")
        name = next((t for t in texts if not NOISE_RE.search(t) and not NUMBER_RE.match(t) and 1 < len(t) < 60), "")
        if not name and number:
            name = self.contacts.name_for_number(number) or number
        return name or title or "Unknown", number

    def run(self):
        try:
            import uiautomation as auto
        except Exception as e:
            self.log(f"call watcher unavailable {e!r}")
            return
        with auto.UIAutomationInitializerInThread(debug=False):
            last_seen = {}
            while True:
                time.sleep(0.7)
                if not self.enabled:
                    continue
                try:
                    wins = phone_link_windows()
                except Exception:
                    continue
                found = None
                for w in wins:
                    # call popups are small windows; the big main window is never walked (too heavy)
                    if not (40 < w["w"] < 760 and 40 < w["h"] < 560):
                        continue
                    key = (w["hwnd"], w["title"], w["w"], w["h"])
                    if (time.time() - last_seen.get(key, 0)) < 1.0 and w["hwnd"] != self.hwnd:
                        continue
                    last_seen[key] = time.time()
                    try:
                        buttons, texts = self._read(w["hwnd"])
                    except Exception:
                        continue
                    kind = self._classify(buttons, texts)
                    if kind:
                        self._log(w["title"], buttons, texts)
                        found = (w, kind, texts)
                        break
                if found:
                    w, kind, texts = found
                    self.missing = 0
                    if kind != self.state or w["hwnd"] != self.hwnd:
                        name, number = self._caller(w["title"], texts)
                        photo = latest_call_photo() or self.contacts.photo_for(name, number)
                        self.state, self.hwnd = kind, w["hwnd"]
                        self.info = {"name": name, "number": number}
                        self.emit({"type": "call", "data": {
                            "id": f"pl-{w['hwnd']}", "state": kind, "name": name, "number": number,
                            "photo": photo, "source": "phonelink-window"}})
                elif self.state:
                    self.missing += 1
                    if self.missing >= 2:
                        self.emit({"type": "call", "data": {"id": f"pl-{self.hwnd}", "state": "ended", **self.info}})
                        self.state, self.hwnd, self.info = None, None, {}
