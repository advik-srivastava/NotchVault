"""Per-app volume for the music player (only that app, not the whole PC)."""
import re

# media app id (from Windows' media session) -> process name of the app that plays the audio
KNOWN = [
    (r"spotify", "spotify.exe"),
    (r"applemusic", "applemusic.exe"),
    (r"chrome", "chrome.exe"),
    (r"msedge|microsoftedge", "msedge.exe"),
    (r"opera", "opera.exe"),
    (r"firefox", "firefox.exe"),
    (r"brave", "brave.exe"),
    (r"vlc", "vlc.exe"),
    (r"zunemusic|groove|media.?player", "microsoft.media.player.exe"),
]


def process_for(app_id):
    a = (app_id or "").lower()
    for pat, exe in KNOWN:
        if re.search(pat, a):
            return exe
    if a.endswith(".exe"):
        return a.rsplit("\\", 1)[-1]
    return None


def _sessions(exe):
    from pycaw.pycaw import AudioUtilities
    out = []
    for s in AudioUtilities.GetAllSessions():
        p = s.Process
        try:
            if p and p.name().lower() == exe:
                out.append(s)
        except Exception:
            pass
    return out


def get(app_id):
    exe = process_for(app_id)
    if not exe:
        return None
    for s in _sessions(exe):
        try:
            return float(s.SimpleAudioVolume.GetMasterVolume())
        except Exception:
            pass
    return None


def set_(app_id, value):
    exe = process_for(app_id)
    if not exe:
        return False
    v = max(0.0, min(1.0, float(value)))
    ok = False
    for s in _sessions(exe):          # an app can have several audio sessions; set them all
        try:
            s.SimpleAudioVolume.SetMasterVolume(v, None)
            ok = True
        except Exception:
            pass
    return ok


# ---------------------------------------------------------------- AI agents (from Windows notifications)
AGENTS = [
    ("claude", r"\bclaude\b|anthropic"),
    ("chatgpt", r"chatgpt|openai"),
    ("codex", r"\bcodex\b"),
    ("copilot", r"copilot"),
    ("cursor", r"\bcursor\b"),
    ("gemini", r"gemini"),
    ("perplexity", r"perplexity"),
    ("windsurf", r"windsurf|codeium"),
]


def detect_agent(*fields):
    hay = " ".join(f or "" for f in fields).lower()
    for key, pat in AGENTS:
        if re.search(pat, hay):
            return key
    return None
