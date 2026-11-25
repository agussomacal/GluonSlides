"""Undo environment leaked by snap-packaged launchers.

Terminals opened from snap apps (e.g. the VSCode/VSCodium snaps) inherit
GTK/GIO/locale/XDG paths pointing inside the snap. With them, WebKitGTK's
helper processes load the snap's core20 libraries and crash
(`undefined symbol: __libc_pthread_init`), and GLib aborts on the snap's
outdated GSettings schemas.

Call `sanitize_snap_environment()` before the GUI toolkit is initialised
(i.e. before `webview.start()`). It is a no-op in a normal environment.
"""

import os

_ORIG_SUFFIX = "_VSCODE_SNAP_ORIG"

# Toolkit/loader variables to drop when they point inside a snap.
_SNAP_PATH_VARS = (
    "GTK_PATH", "GTK_EXE_PREFIX", "GTK_IM_MODULE_FILE", "GTK_MODULES",
    "GIO_MODULE_DIR", "GIO_EXTRA_MODULES",
    "GDK_PIXBUF_MODULE_FILE", "GDK_PIXBUF_MODULEDIR",
    "GSETTINGS_SCHEMA_DIR", "LOCPATH", "LD_LIBRARY_PATH", "LD_PRELOAD",
    # Snap-private XDG homes (e.g. ~/snap/codium/495/.local/share) hold
    # outdated compiled GSettings schemas that make GLib abort.
    "XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME",
)


def sanitize_snap_environment(environ=os.environ):
    # The integrated terminal may drop $SNAP itself while keeping the leaked
    # paths, so detect by value rather than by the presence of $SNAP.

    # VSCode/VSCodium snaps save the original values as *_VSCODE_SNAP_ORIG.
    for key in [k for k in environ if k.endswith(_ORIG_SUFFIX)]:
        orig = environ.pop(key)
        target = key[: -len(_ORIG_SUFFIX)]
        if orig:
            environ[target] = orig
        else:
            environ.pop(target, None)

    for key in _SNAP_PATH_VARS:
        if "/snap/" in environ.get(key, ""):
            environ.pop(key, None)

    # Leftover SNAP_* vars make GLib think it is sandboxed (proxy/portal errors).
    for key in [k for k in environ if k.startswith("SNAP")]:
        environ.pop(key, None)
