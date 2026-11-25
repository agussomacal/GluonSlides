"""Native file dialogs via pywebview."""

import os

import webview


def initial_dir(override=None):
    """Dialog start directory: given override or the user's home."""
    return override or os.path.expanduser("~")


def ask_path(dialog_type, **kwargs):
    """Open a dialog on the main window and return a single path, or None if cancelled."""
    result = webview.windows[0].create_file_dialog(dialog_type, **kwargs)
    if not result:
        return None
    if isinstance(result, (list, tuple)):
        result = result[0]
    return result or None


def ask_folder():
    return ask_path(webview.FOLDER_DIALOG)


def ask_open(file_types):
    return ask_path(webview.OPEN_DIALOG, allow_multiple=False, file_types=file_types)


def ask_save(default_filename, file_types, start_dir=None):
    return ask_path(
        webview.SAVE_DIALOG,
        directory=initial_dir(start_dir),
        save_filename=default_filename,
        file_types=file_types,
    )
