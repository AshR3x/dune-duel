"""Local dev server: serves the game (never cached) and lets the menu's weapon adjuster save to assets/hold.json."""
import http.server
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
HOLD = os.path.join(ROOT, "assets", "hold.json")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


def valid(data):
    return isinstance(data, dict) and len(data) < 200 and all(
        re.fullmatch(r"[a-z0-9_]{1,24}", k)
        and isinstance(v, dict)
        and all(isinstance(n, (int, float)) and not isinstance(n, bool) and abs(n) < 100 for n in v.values())
        and all(re.fullmatch(r"[a-z]{1,2}", f) for f in v)
        for k, v in data.items()
    )


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_POST(self):
        origin = self.headers.get("Origin")
        same = origin is None or origin in (f"http://localhost:{PORT}", f"http://127.0.0.1:{PORT}")
        size = int(self.headers.get("Content-Length") or 0)
        if self.path != "/__save_hold" or not same or self.headers.get("Content-Type") != "application/json" or not 0 < size <= 200000:
            self.send_error(400)
            return
        try:
            data = json.loads(self.rfile.read(size))
        except ValueError:
            self.send_error(400)
            return
        if not valid(data):
            self.send_error(400)
            return
        with open(HOLD, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=1, sort_keys=True)
            f.write("\n")
        self.send_response(204)
        self.end_headers()


if __name__ == "__main__":
    print(f"Dune Duel on http://localhost:{PORT}")
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
