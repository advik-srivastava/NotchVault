"""Instant system-volume change notifications (Core Audio callback)."""
from pycaw.callbacks import AudioEndpointVolumeCallback


class VolumeNotifier(AudioEndpointVolumeCallback):
    def __init__(self, on_change):
        super().__init__()
        self.on_change = on_change

    def on_notify(self, new_volume, new_mute, event_context, channels, channel_volumes):
        try:
            self.on_change(float(new_volume), bool(new_mute))
        except Exception:
            pass


def register(endpoint, on_change):
    cb = VolumeNotifier(on_change)
    endpoint.RegisterControlChangeNotify(cb)
    return cb  # keep a reference so it is not garbage-collected
