#!/usr/bin/env python3
import json
import os
import sys
import time

import dbus
import dbus.mainloop.glib
from gi.repository import GLib


PORTAL_DEST = "org.freedesktop.portal.Desktop"
PORTAL_OBJECT = "/org/freedesktop/portal/desktop"
PORTAL_IFACE = "org.freedesktop.portal.GlobalShortcuts"
REQUEST_IFACE = "org.freedesktop.portal.Request"
SESSION_IFACE = "org.freedesktop.portal.Session"
SHORTCUT_ID = "codex-global-dictation"


def emit(event_type, **kwargs):
    print(json.dumps({"type": event_type, **kwargs}, separators=(",", ":")), flush=True)


def token(prefix):
    return f"{prefix}_{os.getpid()}_{int(time.time() * 1000)}"


class PortalShortcut:
    def __init__(self, trigger):
        self.trigger = trigger
        self.loop = GLib.MainLoop()
        self.bus = dbus.SessionBus()
        self.portal = dbus.Interface(
            self.bus.get_object(PORTAL_DEST, PORTAL_OBJECT),
            dbus_interface=PORTAL_IFACE,
        )
        self.session_handle = None

    def wait_response(self, request_handle):
        result = {}

        def on_response(code, payload):
            result["code"] = int(code)
            result["payload"] = payload
            nested.quit()

        nested = GLib.MainLoop()
        self.bus.add_signal_receiver(
            on_response,
            signal_name="Response",
            dbus_interface=REQUEST_IFACE,
            path=request_handle,
        )
        GLib.timeout_add_seconds(30, lambda: (nested.quit(), False)[1])
        nested.run()
        if "code" not in result:
            raise TimeoutError(f"Timed out waiting for portal response: {request_handle}")
        return result["code"], result["payload"]

    def create_session(self):
        request = self.portal.CreateSession(
            dbus.Dictionary(
                {
                    "handle_token": dbus.String(token("codex_dictation_create")),
                    "session_handle_token": dbus.String(token("codex_dictation_session")),
                },
                signature="sv",
            )
        )
        code, payload = self.wait_response(request)
        if code != 0:
            raise RuntimeError(f"CreateSession denied with response code {code}")
        self.session_handle = str(payload["session_handle"])

    def bind_shortcuts(self):
        shortcuts = dbus.Array(
            [
                dbus.Struct(
                    (
                        dbus.String(SHORTCUT_ID),
                        dbus.Dictionary(
                            {
                                "description": dbus.String("Codex global dictation"),
                                "preferred_trigger": dbus.String(self.trigger),
                            },
                            signature="sv",
                        ),
                    ),
                    signature=None,
                )
            ],
            signature="(sa{sv})",
        )
        request = self.portal.BindShortcuts(
            dbus.ObjectPath(self.session_handle),
            shortcuts,
            dbus.String(""),
            dbus.Dictionary(
                {"handle_token": dbus.String(token("codex_dictation_bind"))},
                signature="sv",
            ),
        )
        code, _payload = self.wait_response(request)
        if code != 0:
            raise RuntimeError(f"BindShortcuts denied with response code {code}")

    def close_session(self):
        if not self.session_handle:
            return
        try:
            session = dbus.Interface(
                self.bus.get_object(PORTAL_DEST, self.session_handle),
                dbus_interface=SESSION_IFACE,
            )
            session.Close()
        except Exception:
            pass

    def run(self):
        self.create_session()
        self.bind_shortcuts()

        def on_activated(session_handle, shortcut_id, _timestamp, _options):
            if str(session_handle) == self.session_handle and str(shortcut_id) == SHORTCUT_ID:
                emit("activated")

        def on_deactivated(session_handle, shortcut_id, _timestamp, _options):
            if str(session_handle) == self.session_handle and str(shortcut_id) == SHORTCUT_ID:
                emit("deactivated")

        self.bus.add_signal_receiver(
            on_activated,
            signal_name="Activated",
            dbus_interface=PORTAL_IFACE,
        )
        self.bus.add_signal_receiver(
            on_deactivated,
            signal_name="Deactivated",
            dbus_interface=PORTAL_IFACE,
        )
        emit("ready", session_handle=self.session_handle, trigger=self.trigger)
        self.loop.run()


def main():
    dbus.mainloop.glib.DBusGMainLoop(set_as_default=True)
    trigger = sys.argv[1] if len(sys.argv) > 1 else ""
    if not trigger:
        emit("error", error="Missing shortcut trigger")
        return 2
    shortcut = PortalShortcut(trigger)
    try:
        shortcut.run()
    except KeyboardInterrupt:
        shortcut.close_session()
    except Exception as exc:
        emit("error", error=str(exc), error_type=type(exc).__name__)
        shortcut.close_session()
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
