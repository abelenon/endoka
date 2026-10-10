"""Local static server for endokalos-web, dev-only.

Plain `python -m http.server` sends no Cache-Control header, so browsers
apply their own heuristic caching and can silently keep serving an old
version of a .js/.css file after it's been edited -- confusing both here
and when testing on a phone. This just disables caching entirely.
"""

import http.server


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()


if __name__ == "__main__":
    http.server.test(HandlerClass=NoCacheHandler, port=8420)
