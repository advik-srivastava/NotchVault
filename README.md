# Dynamic Island for Windows

A black island that sits at the top centre of your screen and morphs, with Apple-style spring physics and blur transitions, to show:

| Activity | Compact | Hover | Click / event |
|---|---|---|---|
| **Music** (Spotify, Apple Music) | album art + live waveform tinted from the artwork | scrolling "Title - Artist" marquee | full player: seek, shuffle, prev/play/next, favourite; scroll for the volume slider |
| **Notifications** (any app, live) | — | — | banner with sender, app badge and message; stacks up to 3; click opens the app |
| **Phone Link calls** | green call timer + waveform | end / mute | incoming call with decline / accept |
| **Calendar** (iCal links) | — | — | alert 5 min before and at start, live countdown, *Join Meeting* for Zoom/Meet/Teams links; calendar page with month grid |
| **Timer** | orange progress ring + countdown | pause / cancel each timer | ruler picker (drag or scroll), label, *Start Timer*; chime when done |

Click the island at any time to open the expanded view. Use the small tabs at the top to switch between music, calendar and timer.

## Also included (v3)

- **Control panel**: click the island's tray icon (in Hidden icons), or the ⚙ in the expanded island. Changes apply live.
- **Liquid Glass**: opacity, frost and vibrancy sliders, plus an option to use glass on every page.
- **Home dashboard**: Music, Focus and Up-next cards, plus battery, Bluetooth devices, water and to-do counts. Open it with **Ctrl+Alt+T**.
- **Synced lyrics** from LRCLIB: hover the music pill for 3–4 lines in the album's colours. *Dynamic lyrics* shows the current line in the pill. A lyrics button in the player opens a side column.
- **Music page is always there**: it shows the last track or "Not Playing" with Apple Music / Spotify buttons.
- **Battery**: charging animation (fill, bolt, glow), "Charger Disconnected", and low-battery warnings at 20% and 10% with a Battery Saver button.
- **Bluetooth**: when a device connects or disconnects, you get its name, an icon for its type and its battery ring.
- **Volume HUD**: appears whenever the system volume changes.
- **Focus (Pomodoro)**, **water reminders**, **to-do list**, **Shelf** (drag files onto the island).
- **Mascot** idle style (eyes that follow the cursor) as an alternative to the hairline.
- **AI agent status**: anything can `POST http://127.0.0.1:47823/agent?state=editing|done&title=…`; see the control panel for Claude Code hooks.

### v4 notes

- **Music as a line**: the mini × on the music hover card shrinks music to a hairline so it never covers your tabs; + brings the pill back (also in Settings → Music and lyrics).
- Clicking the album art or song title opens the player app.
- **Contact photos**: Phone Link notifications use the contact's photo from Phone Link's synced contacts (read-only); other apps show their own icon.
- **Phone Link calls**: Phone Link shows calls in its own window, which the island watches for Accept / Decline / End buttons. Each detected call window is logged to `data/phonelink-calls.log` (local only), to help tune detection.

## Run

Double-click **`Start Dynamic Island.bat`**, or run `npm start`.

A tray icon (a white pill) gives you:
- **Try it**: demo notification, call, calendar alert, timer and music
- **Open settings file** / **Reload settings**
- **Start with Windows**
- **Quit**

Requirements are already installed on this PC: Node + Electron, Python 3.12 with `winrt-*`, `pycaw` and `uiautomation`.

## Settings (`config.json`)

```jsonc
{
  "media": {
    "apps": ["spotify", "applemusic"],
    "allowOtherMediaApps": false        // true = also show browsers, VLC, etc.
  },
  "musicStyle": "auto",                 // auto = Liquid Glass for Apple Music, black for Spotify | "glass" | "black"
  "notifications": {
    "apps": ["YourPhone", "Phone Link", "Outlook"],  // Phone Link (all Android apps) + Outlook mail; [] = every app
    "ignore": [],                       // e.g. ["Truecaller"]
    "durationMs": 6000,
    "islandOnly": true                  // pull alerts out of Windows: no Windows pop-up, island only
  },
  "phoneLinkCalls": true,
  "calendars": [
    "https://calendar.google.com/calendar/ical/.../basic.ics"   // Google: Settings → calendar → "Secret address in iCal format"
                                                                 // Outlook: Settings → Calendar → Shared calendars → Publish → ICS link
  ],
  "localEvents": [
    { "title": "GYM", "start": "2026-11-15T17:00", "end": "2026-11-15T18:00" }
  ],
  "calendarAlertMinutes": 5,
  "hideIdlePill": false,               // true = island invisible when nothing is happening
  "idleWidth": 190
}
```

After editing, choose **Reload settings** from the tray menu.

## How it works

- `main.js`: Electron window. It's transparent, always on top and click-through everywhere except the island. It also hosts the tray menu and reads the calendar feeds.
- `src/`: the island UI. `spring.js` uses SwiftUI-style springs (response / damping) for width, height, corner radius and the concave "shoulders". Content cross-fades with blur and scale.
- `bridge/bridge.py`: talks to Windows:
  - **Media**: `GlobalSystemMediaTransportControls`. This is the same source as the Windows volume flyout, so Spotify and the Apple Music app both work.
  - **Notifications**: `UserNotificationListener`. Only toasts that arrive after the island starts are shown, and only from the apps you allow.
  - **Phone Link calls**: Phone Link "Incoming call" toasts are turned into the call UI. Accept / Decline / End are pressed for you through UI Automation. If that fails, Phone Link is brought to the front.
  - **Volume**: system master volume via Core Audio.

## Known limits

- Spotify / Apple Music don't let other apps "like" a song, so the ★ button is a local favourite list.
- With *Show alerts only in the island* on (tray menu), Phone Link / Outlook alerts are removed from Windows the moment the island picks them up (~150 ms). They stay in the Phone Link app's own feed but not in the Windows notification centre.
- While the Liquid Glass player is open, the island is hidden from screenshots and screen recordings. That is how it can "see" the screen behind itself without seeing itself.
- Calendar feeds are read every 5 minutes. Times with a `TZID` are treated as your local time.
- SF Pro is used from your installed fonts (not bundled). On another PC it falls back to Segoe UI.
