"""Screen brightness (built-in laptop panel) via WMI: change events + set."""
import threading
import time


class Brightness(threading.Thread):
    def __init__(self, emit, log):
        super().__init__(daemon=True)
        self.emit, self.log = emit, log
        self.level = None
        self.pending = None
        self.lock = threading.Lock()

    def _svc(self):
        import comtypes.client as cc
        loc = cc.CreateObject("WbemScripting.SWbemLocator")
        return loc.ConnectServer(".", "root\\WMI")

    def _read(self, svc):
        for o in svc.ExecQuery("SELECT * FROM WmiMonitorBrightness"):
            return int(o.Properties_("CurrentBrightness").Value)
        return None

    def set(self, value):
        with self.lock:
            self.pending = max(0, min(100, int(round(value))))

    def _apply(self, svc, value):
        try:
            cls = svc.Get("WmiMonitorBrightnessMethods")
            inp = cls.Methods_.Item("WmiSetBrightness").InParameters.SpawnInstance_()
            inp.Properties_.Item("Timeout").Value = 0
            inp.Properties_.Item("Brightness").Value = value
            for m in svc.ExecQuery("SELECT * FROM WmiMonitorBrightnessMethods"):
                m.ExecMethod_("WmiSetBrightness", inp)
                self.level = value          # set by the island: no popup echo needed
                return True
        except Exception as e:
            self.log(f"brightness set failed {e!r}")
        return False

    def run(self):
        import comtypes
        comtypes.CoInitializeEx(comtypes.COINIT_MULTITHREADED)
        try:
            svc = self._svc()
            self.level = self._read(svc)
        except Exception as e:
            self.log(f"brightness unavailable {e!r}")
            return
        if self.level is None:
            self.log("no built-in display brightness (external monitor only)")
            return
        self.emit({"type": "brightness", "value": self.level, "initial": True})
        try:
            events = svc.ExecNotificationQuery("SELECT * FROM WmiMonitorBrightnessEvent")
        except Exception as e:
            self.log(f"brightness events unavailable {e!r}")
            events = None
        while True:
            with self.lock:
                want, self.pending = self.pending, None
            if want is not None and want != self.level:
                self._apply(svc, want)
            try:
                if events is not None:
                    ev = events.NextEvent(200)          # blocks (no CPU) up to 200 ms waiting for a change
                    lvl = int(ev.Properties_("Brightness").Value)
                else:
                    time.sleep(0.4)
                    lvl = self._read(svc)
            except Exception:
                continue                                # timeout: nothing changed
            if lvl is not None and lvl != self.level:
                self.level = lvl
                self.emit({"type": "brightness", "value": lvl})
