#!/usr/bin/env python3
"""Video Cut resolver — turns an X (Twitter) / Facebook (or direct) link into
a video file the StreamForge editor can trim and export.

Uses yt-dlp with curl_cffi impersonation to defeat TLS-fingerprint 403s.
YouTube and Rumble are intentionally not handled — both IP-block hosted
downloaders (YouTube outright; Rumble via Cloudflare datacenter-IP reputation,
which even impersonation + a proxy didn't reliably clear).

IMPORTANT: only resolve videos you have the rights to.

Env: PORT (8787), ALLOW_ORIGIN (*), MAX_DURATION_SECONDS (3600),
     YTDLP_IMPERSONATE (chrome; "" to disable), YTDLP_PROXY, YTDLP_COOKIES_B64,
     YTDLP_COOKIES_FILE, YTDLP_EXTRA_ARGS.
"""
import base64
import html
import json
import os
import re
import shutil
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", "8787"))
ALLOW_ORIGIN = os.environ.get("ALLOW_ORIGIN", "*")
MAX_DURATION = int(os.environ.get("MAX_DURATION_SECONDS", "3600"))
# Bump on each change so /health confirms which build is actually live.
BUILD = "vc-2026-07-08-suno2"

# Impersonate a browser's TLS handshake — defeats Cloudflare fingerprint 403s.
IMPERSONATE = os.environ.get("YTDLP_IMPERSONATE", "chrome")
PROXY = os.environ.get("YTDLP_PROXY", "")
EXTRA_ARGS = os.environ.get("YTDLP_EXTRA_ARGS", "").split()

# Cookies: a file path, or base64 of a cookies.txt (easier as a Render secret).
COOKIES_FILE = os.environ.get("YTDLP_COOKIES_FILE", "")
if not COOKIES_FILE and os.environ.get("YTDLP_COOKIES_B64"):
    try:
        COOKIES_FILE = os.path.join(tempfile.gettempdir(), "yt-cookies.txt")
        with open(COOKIES_FILE, "wb") as fh:
            fh.write(base64.b64decode(os.environ["YTDLP_COOKIES_B64"]))
        print("Loaded cookies from YTDLP_COOKIES_B64")
    except Exception as exc:  # noqa: BLE001
        print("Failed to load cookies:", exc)
        COOKIES_FILE = ""

# Prefer same-container video+audio so the merge is a stream-copy (no transcode),
# then fall back to a single progressive file. We report the ACTUAL container.
FORMATS = {
    "mp4": "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
    "webm": "bestvideo[ext=webm]+bestaudio[ext=webm]/best[ext=webm]/best",
}
CTYPE = {"mp4": "video/mp4", "webm": "video/webm", "mkv": "video/x-matroska",
         "mov": "video/quicktime", "m4v": "video/mp4"}


def common_args():
    """Args shared by every yt-dlp call (impersonation / auth / proxy)."""
    a = ["--no-warnings"]
    if IMPERSONATE:
        a += ["--impersonate", IMPERSONATE]
    if COOKIES_FILE:
        a += ["--cookies", COOKIES_FILE]
    if PROXY:
        a += ["--proxy", PROXY]
    a += EXTRA_ARGS
    return a


def run(cmd, timeout):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


# --- Suno resolver ---------------------------------------------------------
# Suno has no public API, so we read PUBLIC share pages the user already has a
# link to. A /s/<code> short link redirects to /song/<uuid>; a /playlist/<uuid>
# page embeds its clips as JSON. We extract {title, audioUrl} — the browser then
# fetches the CDN mp3 directly (it sends Access-Control-Allow-Origin: *).
UUID_RE = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
SUNO_HOST_RE = re.compile(r"^https://(?:suno\.com|app\.suno\.ai)/(?:s|song|playlist)/", re.I)


def _suno_fetch(url):
    """GET a Suno page with a browser TLS fingerprint; return (final_url, text)."""
    from curl_cffi import requests as cffi  # available in the image
    imp = IMPERSONATE or "chrome"
    r = cffi.get(url, impersonate=imp, timeout=30, allow_redirects=True,
                 proxies={"http": PROXY, "https": PROXY} if PROXY else None)
    return str(r.url), r.text


def _og_title(text, fallback):
    tm = re.search(r'<meta[^>]+property="og:title"[^>]+content="([^"]*)"', text, re.I)
    if not tm:
        return fallback
    # Suno appends " | Suno" (and sometimes "… by @user | Suno") to page titles.
    return re.sub(r"\s*\|\s*Suno\s*$", "", html.unescape(tm.group(1))).strip() or fallback


def _suno_song_track(final_url, text):
    """A single {title, id, audioUrl} from a song page (or None)."""
    m = re.search(UUID_RE, final_url) or re.search(UUID_RE, text)
    if not m:
        return None
    uuid = m.group(0)
    return {"id": uuid, "title": _og_title(text, "Suno song"),
            "audioUrl": f"https://cdn1.suno.ai/{uuid}.mp3"}


def _suno_playlist_tracks(text):
    """Ordered, de-duped clips from a playlist page's embedded JSON."""
    doc = text.replace('\\"', '"')  # unescape the flight/JSON blob
    tracks, seen = [], set()
    # Within one clip object, "title" precedes "audio_url"; fields between are
    # flat (no braces), so a non-greedy [^{}] bridge stays inside the clip.
    for m in re.finditer(
        r'"title":"([^"]+)"[^{}]*?"audio_url":"(https://cdn1\.suno\.ai/(' + UUID_RE + r')\.mp3)"',
        doc,
    ):
        title, audio_url, uuid = m.group(1), m.group(2), m.group(3)
        if uuid in seen:
            continue
        seen.add(uuid)
        tracks.append({"id": uuid, "title": html.unescape(title), "audioUrl": audio_url})
    return tracks


def resolve_suno(url):
    """Return {"type": "song"|"playlist", "name", "tracks": [...]} or raises."""
    if not isinstance(url, str) or not SUNO_HOST_RE.match(url.strip()):
        raise ValueError("Not a Suno song, share, or playlist link.")
    final_url, text = _suno_fetch(url.strip())
    if "/playlist/" in final_url:
        tracks = _suno_playlist_tracks(text)
        if not tracks:
            slug = final_url.rstrip("/").rsplit("/", 1)[-1].split("?")[0].lower()
            if slug in ("liked", "me", "library") or not re.fullmatch(UUID_RE, slug):
                raise ValueError(
                    "That looks like your Liked or a private playlist, which needs a "
                    "Suno login this tool doesn't have. On Suno, make it public / use its "
                    "Share link, or paste individual song links.")
            raise ValueError("Couldn't read any songs from that playlist (is it public?).")
        return {"type": "playlist", "name": _og_title(text, "Suno playlist"),
                "tracks": tracks[:100]}
    track = _suno_song_track(final_url, text)
    if not track:
        raise ValueError("Couldn't find the song on that page.")
    return {"type": "song", "name": track["title"], "tracks": [track]}


def hint(msg):
    """Append proxy guidance to IP-block errors (403 / bot / forbidden)."""
    low = msg.lower()
    if "403" in msg or "forbidden" in low or "sign in to confirm" in low:
        return (msg + "  — the site is IP-blocking this server. Set YTDLP_PROXY to a "
                "residential proxy so requests come from a home IP.")
    return msg


# --- startup diagnostics (reported by /health) -----------------------------
YTDLP_VERSION = "unknown"
IMPERSONATE_OK = False
try:
    YTDLP_VERSION = run(["yt-dlp", "--version"], 30).stdout.strip() or "unknown"
except Exception:  # noqa: BLE001
    pass
try:
    _r = run(["yt-dlp", "--list-impersonate-targets"], 30)
    IMPERSONATE_OK = _r.returncode == 0 and bool(_r.stdout.strip())
except Exception:  # noqa: BLE001
    IMPERSONATE_OK = False
print(f"yt-dlp {YTDLP_VERSION} | impersonate "
      f"{'available' if IMPERSONATE_OK else 'MISSING'} | build {BUILD}")


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", ALLOW_ORIGIN)
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS, GET")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, status, obj):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path.split("?")[0] in ("/health", "/"):
            self._json(200, {"ok": True, "build": BUILD, "ytdlp": YTDLP_VERSION,
                             "impersonate": IMPERSONATE_OK, "proxy": bool(PROXY)})
        else:
            self._json(404, {"error": "not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or "0")
        if length > 100_000:
            return self._json(413, {"error": "body too large"})
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
        except Exception:  # noqa: BLE001
            return self._json(400, {"error": "Invalid JSON body"})
        url = data.get("url")
        if not url or not isinstance(url, str):
            return self._json(400, {"error": 'Missing "url"'})

        # Suno: return track metadata (browser fetches the CDN mp3 itself).
        if self.path.split("?")[0] == "/suno":
            try:
                return self._json(200, {"ok": True, **resolve_suno(url)})
            except ValueError as exc:
                return self._json(400, {"error": str(exc)})
            except Exception as exc:  # noqa: BLE001
                return self._json(502, {"error": hint("Suno resolve failed: " + str(exc)[:300])})

        pref = data.get("format") if data.get("format") in FORMATS else "mp4"

        # Reject over-long videos before downloading.
        try:
            r = run(["yt-dlp", *common_args(), "--no-playlist",
                     "--print", "%(duration)s", url], 120)
            if r.returncode != 0:
                return self._json(400, {"error": hint("Could not read that link: "
                                        + (r.stderr.strip()[:400] or "unknown"))})
            try:
                dur = float((r.stdout.strip().splitlines() or ["0"])[0] or 0)
                if dur > MAX_DURATION:
                    return self._json(413, {"error": f"Video is too long "
                                            f"({int(dur)}s > {MAX_DURATION}s limit)."})
            except ValueError:
                pass  # unknown duration — proceed
        except subprocess.TimeoutExpired:
            return self._json(504, {"error": "Timed out reading the link."})

        d = tempfile.mkdtemp(prefix="vcut-")
        started = False  # once True, headers are sent — can't switch to a JSON error
        try:
            r = run(["yt-dlp", *common_args(), "--no-playlist", "-f", FORMATS[pref],
                     "--merge-output-format", pref,
                     "-o", os.path.join(d, "out.%(ext)s"), url], 600)
            if r.returncode != 0:
                return self._json(500, {"error": hint(r.stderr.strip()[:400] or "download failed")})
            files = os.listdir(d)
            if not files:
                return self._json(500, {"error": "Download produced no file."})
            name = files[0]
            path = os.path.join(d, name)
            ext = (name.rsplit(".", 1)[-1] if "." in name else "mp4").lower()

            started = True
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", CTYPE.get(ext, "application/octet-stream"))
            self.send_header("Content-Length", str(os.path.getsize(path)))
            self.send_header("Content-Disposition", f'inline; filename="video-cut.{ext}"')
            self.end_headers()
            with open(path, "rb") as fh:
                shutil.copyfileobj(fh, self.wfile, 65536)
        except subprocess.TimeoutExpired:
            if not started:
                self._json(504, {"error": "Download timed out."})
        except Exception as exc:  # noqa: BLE001
            if not started:
                self._json(500, {"error": str(exc)[:400]})
        finally:
            shutil.rmtree(d, ignore_errors=True)

    def log_message(self, *_a):
        pass  # keep logs quiet


if __name__ == "__main__":
    print(f"Video Cut resolver on :{PORT} (origin {ALLOW_ORIGIN})")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
