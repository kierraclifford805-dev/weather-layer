"""Local-only visual QA server. Never deploy this process or its injected fixtures."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse
ROOT = Path(__file__).resolve().parents[2]
class PreviewHandler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(ROOT),**kwargs)
    def end_headers(self):
        self.send_header('Cache-Control','no-store')
        super().end_headers()
    def do_GET(self):
        if urlparse(self.path).path == '/weather-layer/__preview__/':
            html=(ROOT/'weather-layer/index.html').read_text().replace('<head>','<head><base href="/weather-layer/"><script src="./tests/visual-fixtures.js"></script>',1)
            payload=html.encode()
            self.send_response(200); self.send_header('Content-Type','text/html; charset=utf-8');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)
        else: super().do_GET()
if __name__ == '__main__':
    print('Local visual QA: http://127.0.0.1:8766/weather-layer/ (real weather) and /weather-layer/__preview__/ (labelled fixtures)',flush=True)
    ThreadingHTTPServer(('127.0.0.1',8766),PreviewHandler).serve_forever()
