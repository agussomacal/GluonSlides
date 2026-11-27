"""How far the running import is, for the Import dialog's progress bar.

The importers call report(stage, done, total) as they go; the page polls
Api.import_progress() (pywebview runs each API call on its own thread,
so polling works while import_talk is busy).
"""

import threading

_lock = threading.Lock()
_state = {"stage": "", "done": 0, "total": 0}


def report(stage, done=0, total=0):
    with _lock:
        _state.update(stage=stage, done=int(done), total=int(total))


def reset():
    report("", 0, 0)


def get():
    with _lock:
        return dict(_state)
