"""Regression tests for the Makefile's localhost server boundary."""

import subprocess
import threading
import unittest
from functools import partial
from http.server import BaseHTTPRequestHandler, SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class ForeignHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"Another application")

    def log_message(self, format, *args):
        pass


class ServerCommandTests(unittest.TestCase):
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
        handler = partial(SimpleHTTPRequestHandler, directory=str(ROOT))
        self.check_occupied_port(handler, 0, "already running")

    def test_foreign_service_has_actionable_port_error(self):
        self.check_occupied_port(ForeignHandler, 2, "make run PORT=")


if __name__ == "__main__":
    unittest.main()
