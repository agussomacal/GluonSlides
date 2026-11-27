"""HTTPS downloads that also work in the packaged app.

A packaged app carries its own Python, which may not know where this
system keeps its certificate authorities: then every HTTPS request fails
with a certificate error. open_url() tries Python's defaults, certifi's
bundle if present, then the system's certificate files.
"""

import os
import ssl
import urllib.error
import urllib.request

CA_FILES = ("/etc/ssl/certs/ca-certificates.crt",   # Debian, Ubuntu, Arch, Gentoo
            "/etc/pki/tls/certs/ca-bundle.crt",     # Fedora, RHEL
            "/etc/ssl/ca-bundle.pem",               # openSUSE
            "/etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem",
            "/etc/ssl/cert.pem")                    # macOS, Alpine


def ssl_contexts():
    """TLS settings to try in turn (None: Python's defaults)."""
    out = [None]
    try:
        import certifi
        out.append(ssl.create_default_context(cafile=certifi.where()))
    except Exception:
        pass
    for path in CA_FILES:
        if os.path.isfile(path):
            try:
                out.append(ssl.create_default_context(cafile=path))
            except Exception:
                pass
    return out


def _is_certificate_error(e):
    return isinstance(e, ssl.SSLError) or isinstance(getattr(e, "reason", None), ssl.SSLError)


def open_url(req, timeout):
    """urllib.request.urlopen(req), retried with other certificates when the
    certificate can't be checked. Use as a context manager."""
    from .desktop import debug
    last = None
    for context in ssl_contexts():
        try:
            return urllib.request.urlopen(req, timeout=timeout, context=context)
        except (ssl.SSLError, urllib.error.URLError) as e:
            last = e
            debug(f"[net] {getattr(req, 'full_url', req)}: {e}")
            if not _is_certificate_error(e):
                break  # offline, not found...: other certificates won't help
    raise last
