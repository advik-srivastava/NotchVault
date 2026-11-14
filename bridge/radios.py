"""Wi-Fi / Bluetooth radio on-off and airplane mode watcher.

Polls once a second (a few microseconds of work) and only emits when something settles:
toggling airplane mode also flips Wi-Fi and Bluetooth, so changes are collected for a moment
and an airplane change wins over the radio changes that came with it.
"""
import asyncio
import threading
import time
import winreg

KINDS = {1: "wifi", 3: "bluetooth"}          # Windows.Devices.Radios.RadioKind
RADIO_SETTLE = 1.2


def airplane_on():
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SYSTEM\CurrentControlSet\Control\RadioManagement\SystemRadioState") as k:
            return winreg.QueryValueEx(k, "")[0] == 1
    except OSError:
        return None


class RadioWatcher(threading.Thread):
    def __init__(self, emit, log):
        super().__init__(daemon=True)
        self.emit, self.log = emit, log

    def run(self):
        try:
            asyncio.run(self.main())
        except Exception as e:
            self.log(f"radios stopped {e!r}")

    async def read(self, Radio):
        cur = {}
        try:
            for r in await Radio.get_radios_async():
                k = KINDS.get(int(r.kind))
                if k:
                    cur[k] = int(r.state) == 1          # RadioState.On
        except Exception as e:
            self.log(f"radios read {e!r}")
        a = airplane_on()
        if a is not None:
            cur["airplane"] = a
        return cur

    async def main(self):
        from winrt.windows.devices.radios import Radio
        last = await self.read(Radio)
        self.log(f"radios {last}")
        # Airplane mode is one registry value: read it 5x a second and announce it the moment it flips.
        # Wi-Fi / Bluetooth are read 2x a second; their changes wait a moment so the radios that
        # airplane mode switches along with it don't each pop up as well.
        changed, since, quiet_until, tick = {}, 0.0, 0.0, 0
        while True:
            await asyncio.sleep(0.2)
            tick += 1
            now = time.time()
            a = airplane_on()
            if a is not None and last.get("airplane") is not None and a != last["airplane"]:
                self.emit({"type": "radio", "data": {"kind": "airplane", "on": a}})
                self.log(f"radio change airplane={a}")
                quiet_until, changed = now + 4.0, {}
            if a is not None:
                last["airplane"] = a
            if tick % 3 == 0:
                cur = await self.read(Radio)
                cur.pop("airplane", None)
                for k, v in cur.items():
                    if k in last and last[k] != v and now >= quiet_until:
                        changed[k] = v
                        since = now
                    last[k] = v
            if changed and now - since >= RADIO_SETTLE:
                if now >= quiet_until:
                    for k, v in changed.items():
                        self.emit({"type": "radio", "data": {"kind": k, "on": v}})
                    self.log(f"radio change {changed}")
                changed = {}
