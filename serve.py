"""Local static preview. Does not change or start LunaServer."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import threading
import webbrowser

ROOT = Path(__file__).resolve().parent

class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.webmanifest': 'application/manifest+json'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404)
        return None

def main():
    parser = argparse.ArgumentParser(description='Optional LunaGPT web preview')
    parser.add_argument('--port', type=int, default=8788)
    parser.add_argument('--lan', action='store_true', help='Allow other devices on the local network')
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    address = '0.0.0.0' if args.lan else '127.0.0.1'
    try:
        server = ThreadingHTTPServer((address, args.port), partial(Handler, directory=str(ROOT)))
    except OSError as error:
        print(f'Could not start on port {args.port}: {error}\nAlready running? Open http://localhost:{args.port}')
        return 1
    url = f'http://localhost:{args.port}'
    print(f'LunaGPT: {url}\nKeep this window open. Ctrl+C stops the preview.\nLunaServer must run separately. You can also open index.html directly on your PC.')
    if not args.no_browser:
        threading.Timer(0.5, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0

if __name__ == '__main__':
    raise SystemExit(main())
