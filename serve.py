"""Serve this local mockup; reuse an existing server for the same project."""

import argparse
import errno
import http.client
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def already_serving_project(host, port):
    """Confirm the occupied port serves this checkout, not merely any HTTP page."""
    probe_host = "127.0.0.1" if host in ("0.0.0.0", "::") else host
    try:
        for name in ("index.html", "app.mjs"):
            expected = (ROOT / name).read_bytes()
            connection = http.client.HTTPConnection(probe_host, port, timeout=2)
            try:
                connection.request("GET", "/" + name)
                response = connection.getresponse()
                if response.status != 200 or response.read(len(expected) + 1) != expected:
                    return False
            finally:
                connection.close()
    except (OSError, http.client.HTTPException):
        return False
    return True


def main(argv=None):
    parser = argparse.ArgumentParser(description="Serve the Atlas RAN Twin mockup")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args(argv)
    url = f"http://{args.host}:{args.port}/"
    handler = partial(SimpleHTTPRequestHandler, directory=str(ROOT))
    try:
        server = ThreadingHTTPServer((args.host, args.port), handler)
    except OSError as exc:
        if exc.errno == errno.EADDRINUSE:
            if already_serving_project(args.host, args.port):
                print(f"Atlas RAN Twin is already running at {url}", flush=True)
                return 0
            print(f"Port {args.port} is in use by another service. Try make run PORT={args.port + 1}.", file=sys.stderr)
            return 2
        print(f"Cannot start Atlas RAN Twin at {url}: {exc}", file=sys.stderr)
        return 2
    try:
        print(f"Atlas RAN Twin is serving at {url} (Ctrl+C to stop)", flush=True)
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nAtlas RAN Twin server stopped.", flush=True)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
