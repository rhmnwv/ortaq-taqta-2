"""Generate the join QR for the laptop's current classroom address."""
import json
import sys
from pathlib import Path
from reportlab.graphics.barcode.qrencoder import QRCode, QRErrorCorrectLevel

url = sys.argv[1]
code = QRCode(None, QRErrorCorrectLevel.M)
code.addData(url)
code.make()
size = code.getModuleCount()
path = "".join(
    f"M{x+4},{y+4}h1v1h-1z"
    for y in range(size) for x in range(size) if code.isDark(y, x)
)
width = size + 8
svg = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {width}" shape-rendering="crispEdges"><rect width="{width}" height="{width}" fill="white"/><path d="{path}" fill="black"/></svg>'
Path(__file__).with_name("join-qr.json").write_text(json.dumps({"url": url, "svg": svg}), encoding="utf-8")

