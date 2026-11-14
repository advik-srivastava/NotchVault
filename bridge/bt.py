"""Bluetooth connect / disconnect watcher with battery levels.

Uses DeviceWatchers (event driven) because a one-shot FindAll over Bluetooth
association endpoints can take ~30 s while Windows runs an inquiry.
"""
import asyncio
import re
import time
import warnings

from winrt.system import unbox_boolean, unbox_uint8, unbox_guid
from winrt.windows.devices.enumeration import DeviceInformation, DeviceInformationKind

warnings.filterwarnings("ignore", category=DeprecationWarning)

PROTOCOLS = (
    "{e0cbf06c-cd8b-4647-bb8a-263b43f0f974}",  # classic
    "{bb7bb05e-5972-42b5-94fc-76eaa7084d49}",  # low energy
)
CONNECTED = "System.Devices.Aep.IsConnected"
AEP_CONTAINER = "System.Devices.Aep.ContainerId"
CONTAINER = "System.Devices.ContainerId"
BATTERY = "{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2"
SUFFIXES = re.compile(r"\s+(hands-free( ag| hf)?( audio)?|avrcp transport|stereo|a2dp.*)$", re.I)


def guess_kind(name):
    n = name.lower()
    if any(k in n for k in ("bud", "pods", "earbud", "earphone")):
        return "earbuds"
    if any(k in n for k in ("headphone", "tune", "wh-", "headset", "760", "studio", "max", "nc")):
        return "headphones"
    if "mouse" in n or "mx " in n or "flow" in n:
        return "mouse"
    if "keyboard" in n or "keys" in n:
        return "keyboard"
    if any(k in n for k in ("speaker", "boom", "flip", "charge", "soundlink", "go ")):
        return "speaker"
    if any(k in n for k in ("watch", "band")):
        return "watch"
    if any(k in n for k in ("controller", "xbox", "dualsense", "gamepad")):
        return "gamepad"
    if any(k in n for k in ("phone", "galaxy", "pixel", "iphone", "oneplus", "realme", "redmi")):
        return "phone"
    return "generic"


def _get(props, key):
    try:
        if props.has_key(key):
            return props.lookup(key)
    except Exception:
        pass
    return None


def _guid(props, key):
    v = _get(props, key)
    try:
        return str(unbox_guid(v)).lower() if v is not None else None
    except Exception:
        return None


def _bool(props):
    v = _get(props, CONNECTED)
    try:
        return bool(unbox_boolean(v)) if v is not None else None
    except Exception:
        return None


class Bluetooth:
    def __init__(self, emit, log):
        self.emit = emit
        self.log = log
        self.devices = {}        # id -> {"name", "connected"}
        self.ready = 0           # number of watchers that finished their first enumeration
        self.battery = {}
        self.battery_at = time.time()
        self.loop = None
        self.watchers = []
        self.pending = []        # (state, name) waiting for a battery refresh

    # ---------------------------------------------------------------- battery
    async def refresh_battery(self):
        try:
            devs = await DeviceInformation.find_all_async_with_kind_aqs_filter_and_additional_properties(
                "", [BATTERY, CONTAINER], DeviceInformationKind.DEVICE)
            levels, by_container = {}, {}
            for d in devs:
                v = _get(d.properties, BATTERY)
                if v is not None and d.name:
                    lvl = int(unbox_uint8(v))
                    levels[SUFFIXES.sub("", d.name).strip().lower()] = lvl
                    c = _guid(d.properties, CONTAINER)
                    if c:
                        by_container[c] = lvl
            self.battery = levels
            self.battery_by_container = by_container
            self.battery_at = time.time()
        except Exception as e:
            self.log(f"bt battery failed {e!r}")

    def level_for(self, name, container=None):
        if container and container in getattr(self, "battery_by_container", {}):
            return self.battery_by_container[container]
        key = name.strip().lower()
        if key in self.battery:
            return self.battery[key]
        for k, v in self.battery.items():
            if k.startswith(key) or key.startswith(k):
                return v
        return None

    def connected_list(self):
        src = getattr(self, "announced", None) or self.aggregate_connected()
        out = []
        for k, (name, on) in src.items():
            if on:
                out.append({"name": name, "battery": self.level_for(name, k if "-" in k else None), "kind": guess_kind(name)})
        return out

    # ---------------------------------------------------------------- watcher callbacks (WinRT threads)
    def _added(self, _w, info):
        self.loop.call_soon_threadsafe(self._on_added, info.id, info.name, _bool(info.properties), _guid(info.properties, AEP_CONTAINER))

    def _updated(self, _w, upd):
        self.loop.call_soon_threadsafe(self._on_updated, upd.id, _bool(upd.properties))

    def _removed(self, _w, upd):
        self.loop.call_soon_threadsafe(self._on_updated, upd.id, False)

    def _completed(self, _w, _arg):
        self.loop.call_soon_threadsafe(self._on_completed)

    def _on_added(self, did, name, connected, container=None):
        old = self.devices.get(did, {})
        self.devices[did] = {"name": name or old.get("name", ""), "connected": bool(connected), "container": container or old.get("container")}

    def _on_updated(self, did, connected):
        d = self.devices.get(did)
        if d is None or connected is None:
            return
        d["connected"] = connected

    def _on_completed(self):
        self.ready += 1
        if self.ready == len(PROTOCOLS):
            asyncio.ensure_future(self._initial())

    async def _initial(self):
        await self.refresh_battery()
        self.announced = self.aggregate_connected()      # what is connected at start is not "news"
        self.emit({"type": "bt-list", "data": self.connected_list()})

    # One entry per physical device: a phone is reachable over classic Bluetooth *and* LE,
    # and the LE link drops in and out every few seconds. A device counts as connected if any
    # of its links is up, and a change is only announced once it has held for STABLE seconds.
    STABLE = 4.0

    def _key(self, d):
        return d.get("container") or d["name"].strip().lower()

    def aggregate_connected(self):
        agg = {}
        for d in self.devices.values():
            if not d["name"]:
                continue
            k = self._key(d)
            name, on = agg.get(k, (d["name"], False))
            agg[k] = (name, on or d["connected"])
        return agg

    # ---------------------------------------------------------------- public
    def start(self):
        self.loop = asyncio.get_running_loop()
        self.ready = 0
        for w in self.watchers:
            try:
                w.stop()
            except Exception:
                pass
        self.watchers = []
        for proto in PROTOCOLS:
            aqs = f'System.Devices.Aep.ProtocolId:="{proto}" AND System.Devices.Aep.IsPaired:=System.StructuredQueryType.Boolean#True'
            w = DeviceInformation.create_watcher_with_kind_aqs_filter_and_additional_properties(
                aqs, [CONNECTED, AEP_CONTAINER], DeviceInformationKind.ASSOCIATION_ENDPOINT)
            w.add_added(self._added)
            w.add_updated(self._updated)
            w.add_removed(self._removed)
            w.add_enumeration_completed(self._completed)
            w.start()
            self.watchers.append(w)
        self.started_at = time.time()

    def _watchers_healthy(self):
        for w in self.watchers:
            try:
                if int(w.status) in (3, 4, 5):   # stopping / stopped / aborted (e.g. Bluetooth toggled)
                    return False
            except Exception:
                return False
        return True

    async def poll(self):
        now = time.time()
        if not self._watchers_healthy() and now - getattr(self, "started_at", 0) > 10:
            self.log("bt watcher stopped, restarting")
            self.start()
            return
        if self.ready < len(PROTOCOLS) or not hasattr(self, "announced"):
            return
        agg = self.aggregate_connected()
        changing = getattr(self, "changing", {})
        events = []
        for k, (name, on) in agg.items():
            was = self.announced.get(k, (name, False))[1]
            if on == was:
                changing.pop(k, None)
                continue
            first = changing.setdefault(k, now)
            if now - first >= self.STABLE:
                changing.pop(k, None)
                self.announced[k] = (name, on)
                events.append(("connected" if on else "disconnected", name, k))
        self.changing = changing
        if events:
            if any(e[0] == "connected" for e in events):
                await self.refresh_battery()
                self.recheck = [now + 6, now + 15, now + 30]
            for state, name, k in events:
                cont = k if "-" in k else None
                self.log(f"bt {state}: {name}")
                self.emit({"type": "bt", "data": {"state": state, "name": name,
                                                  "battery": self.level_for(name, cont), "kind": guess_kind(name)}})
            self.emit({"type": "bt-list", "data": self.connected_list()})
            return
        due = [t for t in getattr(self, "recheck", []) if t <= now]
        if due or now - self.battery_at > 20:
            self.recheck = [t for t in getattr(self, "recheck", []) if t > now]
            before = self.connected_list()
            await self.refresh_battery()
            after = self.connected_list()
            if after != before or not due:
                self.emit({"type": "bt-list", "data": after})
