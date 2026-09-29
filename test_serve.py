"""Regression tests for the Makefile's localhost server boundary."""

import http.client
import subprocess
import threading
import unittest
from functools import partial
from http.server import BaseHTTPRequestHandler, SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from serve import LocalDevRequestHandler

ROOT = Path(__file__).resolve().parent


class ForeignHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"Another application")

    def log_message(self, format, *args):
        pass


class OldAtlasHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        pass


class ServerCommandTests(unittest.TestCase):
    def test_favicon_is_linked_and_served(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn('<link rel="icon" type="image/x-icon" href="favicon.ico"/>', html)
        self.assertIn('<link rel="icon" type="image/svg+xml" href="favicon.svg"/>', html)

        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(LocalDevRequestHandler, directory=str(ROOT)))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=3)
        try:
            connection.request("GET", "/favicon.svg")
            response = connection.getresponse()
            body = response.read()
            self.assertEqual(response.status, 200)
            self.assertEqual(response.getheader("Content-type"), "image/svg+xml")
            self.assertIn(b"<svg", body)
            connection.request("GET", "/favicon.ico")
            response = connection.getresponse()
            body = response.read()
            self.assertEqual(response.status, 200)
            self.assertTrue(response.getheader("Content-type", "").startswith("image/"))
            self.assertTrue(body.startswith(b"\x00\x00\x01\x00"))
        finally:
            connection.close()
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_local_asset_refresh_ignores_stale_conditional_cache(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(LocalDevRequestHandler, directory=str(ROOT)))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=3)
        try:
            connection.request("GET", "/app.mjs")
            first = connection.getresponse()
            modified = first.getheader("Last-Modified")
            first.read()
            self.assertIsNotNone(modified)
            connection.request("GET", "/app.mjs", headers={"If-Modified-Since": modified})
            refreshed = connection.getresponse()
            body = refreshed.read()
            self.assertEqual(refreshed.status, 200)
            self.assertEqual(refreshed.getheader("Cache-Control"), "no-store")
            self.assertIn(b"document.addEventListener('click'", body)
        finally:
            connection.close()
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def check_occupied_port(self, handler, expected_code, expected_text):
        server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            result = subprocess.run(
                ["make", "--no-print-directory", "run", f"PORT={server.server_port}"],
                cwd=ROOT,
                text=True,
                capture_output=True,
                timeout=5,
                check=False,
            )
            self.assertEqual(result.returncode, expected_code, result.stdout + result.stderr)
            self.assertIn(expected_text, result.stdout + result.stderr)
            self.assertNotIn("Traceback", result.stderr)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_running_project_is_reused(self):
        handler = partial(LocalDevRequestHandler, directory=str(ROOT))
        self.check_occupied_port(handler, 0, "already running")

    def test_foreign_service_has_actionable_port_error(self):
        self.check_occupied_port(ForeignHandler, 2, "make run PORT=")

    def test_old_server_must_restart_for_rt_api(self):
        self.check_occupied_port(OldAtlasHandler, 2, "older Atlas RAN Twin server")


if __name__ == "__main__":
    unittest.main()
