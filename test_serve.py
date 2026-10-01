"""Regression tests for the Makefile's localhost server boundary."""

import http.client
import errno
import io
import shutil
import subprocess
import tempfile
import threading
import unittest
from functools import partial
from http.server import BaseHTTPRequestHandler, SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import Mock, call, patch
import serve
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
        self.assertIn('href="/favicon.ico"', html)
        self.assertIn('href="/favicon.svg"', html)

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
            connection.request("GET", "/favicon.svg")
            first = connection.getresponse()
            modified = first.getheader("Last-Modified")
            first.read()
            self.assertIsNotNone(modified)
            connection.request("GET", "/favicon.svg", headers={"If-Modified-Since": modified})
            refreshed = connection.getresponse()
            body = refreshed.read()
            self.assertEqual(refreshed.status, 200)
            self.assertEqual(refreshed.getheader("Cache-Control"), "no-store")
            self.assertIn(b"<svg", body)
        finally:
            connection.close()
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)

    def test_react_workspace_uses_built_assets_at_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            legacy_root = Path(temporary) / "legacy"
            legacy_root.mkdir()
            (legacy_root / "src").mkdir()
            (legacy_root / "assets").mkdir()
            (legacy_root / "index.html").write_text('<h1>Legacy UI</h1>', encoding="utf-8")
            (legacy_root / "src" / "main.tsx").write_text("window.legacySource = true;", encoding="utf-8")
            (legacy_root / "assets" / "legacy.js").write_text("window.legacyAsset = true;", encoding="utf-8")
            build = Path(temporary) / "dist"
            (build / "frontend-preview" / "assets").mkdir(parents=True)
            (build / "index.html").write_text("<h1>React workspace</h1>", encoding="utf-8")
            (build / "frontend-preview" / "assets" / "app.js").write_text("window.reactPreview = true;", encoding="utf-8")
            with patch.object(serve, "FRONTEND_BUILD_ROOT", build):
                server = ThreadingHTTPServer(("127.0.0.1", 0), partial(LocalDevRequestHandler, directory=str(legacy_root)))
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=3)
                try:
                    connection.request("GET", "/")
                    root = connection.getresponse()
                    root_body = root.read()
                    self.assertEqual(root.status, 200)
                    self.assertEqual(root.getheader("Cache-Control"), "no-store")
                    self.assertIn(b"React workspace", root_body)

                    for path, expected in (
                        ("/index.html", b"React workspace"),
                        ("/frontend-preview.html", b"React workspace"),
                        ("/frontend-preview/assets/app.js", b"window.reactPreview"),
                        ("/src/main.tsx", b"window.legacySource"),
                        ("/assets/legacy.js", b"window.legacyAsset"),
                    ):
                        connection.request("GET", path)
                        response = connection.getresponse()
                        body = response.read()
                        self.assertEqual(response.status, 200, path)
                        self.assertIn(expected, body, path)

                    connection.request("GET", "/frontend-preview/assets/../../../README.md")
                    traversal = connection.getresponse()
                    self.assertEqual(traversal.status, 404)
                    self.assertNotIn(b"Atlas RAN Twin", traversal.read())
                finally:
                    connection.close()
                    server.shutdown()
                    server.server_close()
                    thread.join(timeout=3)

    def test_react_workspace_is_not_served_from_unbuilt_source(self):
        with tempfile.TemporaryDirectory() as temporary:
            with patch.object(serve, "FRONTEND_BUILD_ROOT", Path(temporary) / "missing"):
                server = ThreadingHTTPServer(("127.0.0.1", 0), partial(LocalDevRequestHandler, directory=str(ROOT)))
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                connection = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=3)
                try:
                    connection.request("GET", "/")
                    response = connection.getresponse()
                    response.read()
                    self.assertEqual(response.status, 404)
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

    def test_fallback_skips_old_and_foreign_servers(self):
        server = Mock(server_port=8767)
        server.serve_forever.side_effect = KeyboardInterrupt
        occupied = OSError(errno.EADDRINUSE, "Address already in use")
        with patch("serve.LocalDevHTTPServer", side_effect=[occupied, occupied, server]) as bind, \
                patch("serve.existing_server_status", side_effect=["stale", "foreign"]) as probe, \
                patch.object(LocalDevRequestHandler.store, "interrupt_incomplete_runs") as interrupt, \
                patch("sys.stdout", new_callable=io.StringIO) as output:
            self.assertEqual(serve.main(["--port", "8765", "--port-fallback"]), 0)
        self.assertEqual([entry.args[0] for entry in bind.call_args_list],
                         [("127.0.0.1", 8765), ("127.0.0.1", 8766), ("127.0.0.1", 8767)])
        self.assertEqual(probe.call_args_list, [call("127.0.0.1", 8765), call("127.0.0.1", 8766)])
        self.assertIn("serving at http://127.0.0.1:8767/", output.getvalue())
        interrupt.assert_called_once()
        server.server_close.assert_called_once()

    def test_fallback_reuses_current_server_before_starting_another(self):
        occupied = OSError(errno.EADDRINUSE, "Address already in use")
        with patch("serve.LocalDevHTTPServer", side_effect=occupied) as bind, \
                patch("serve.existing_server_status", side_effect=["stale", "current"]), \
                patch.object(LocalDevRequestHandler.store, "interrupt_incomplete_runs") as interrupt, \
                patch("sys.stdout", new_callable=io.StringIO) as output:
            self.assertEqual(serve.main(["--port", "8765", "--port-fallback"]), 0)
        self.assertEqual(bind.call_count, 2)
        interrupt.assert_not_called()
        self.assertIn("already running at http://127.0.0.1:8766/", output.getvalue())

    def test_fallback_is_bounded_and_respects_port_limit(self):
        for port, attempts in ((8765, 11), (65535, 1)):
            with self.subTest(port=port), \
                    patch("serve.LocalDevHTTPServer", side_effect=OSError(errno.EADDRINUSE, "busy")) as bind, \
                    patch("serve.existing_server_status", return_value="foreign"), \
                    patch("sys.stdout", new_callable=io.StringIO), \
                    patch("sys.stderr", new_callable=io.StringIO) as error:
                self.assertEqual(serve.main(["--port", str(port), "--port-fallback"]), 2)
                self.assertEqual(bind.call_count, attempts)
                self.assertIn("No available port", error.getvalue())

    def test_fallback_does_not_retry_other_bind_errors(self):
        with patch("serve.LocalDevHTTPServer", side_effect=OSError(errno.EACCES, "denied")) as bind, \
                patch("serve.existing_server_status") as probe, \
                patch("sys.stderr", new_callable=io.StringIO):
            self.assertEqual(serve.main(["--port-fallback"]), 2)
        bind.assert_called_once()
        probe.assert_not_called()

    @unittest.skipUnless(shutil.which("make"), "Make is optional; npm provides the Windows launcher")
    def test_make_fallback_only_defaults_for_an_unspecified_port(self):
        for overrides, fallback in (([], True), (["PORT=8766"], False),
                                    (["AUTO_PORT=0"], False), (["PORT=8766", "AUTO_PORT=1"], True)):
            with self.subTest(overrides=overrides):
                result = subprocess.run(["make", "--no-print-directory", "-n", "run", *overrides],
                                        cwd=ROOT, text=True, capture_output=True, check=True)
                self.assertEqual("--port-fallback" in result.stdout, fallback)


if __name__ == "__main__":
    unittest.main()
