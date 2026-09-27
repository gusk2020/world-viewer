"""Save credited, phone-sized orbiter-image composites for the four dry bodies.

The source textures contain colour adjustments and sometimes fictional gap
fill. They are a viewing layer only: all terrain and climate use independent
DEM data, never the RGB values here.
"""
import io
import sys
import json
import time
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
BODIES = sys.argv[1:] or ["moon", "mars", "mercury", "venus"]
for body in BODIES:
    directory = ROOT / "anti-kytera/viewer/worlds" / body
    meta = json.loads((directory / "config.json").read_text())["image"]
    source = meta["source"]
    for attempt in range(5):
        try:
            req = urllib.request.Request(source, headers={"User-Agent": "Mozilla/5.0 Anti-KyTerra/2"})
            with urllib.request.urlopen(req, timeout=90) as response:
                raw = response.read()
            image = Image.open(io.BytesIO(raw)).convert("RGB")
            if image.width != 2 * image.height or image.width < 1024:
                raise ValueError(f"unexpected image shape {body}: {image.size}")
            # The distributed Venus map is drawn upside down and mirrored
            # (south up, longitude reversed) against the IAU frame the DEM
            # uses; config.json records the turn and the evidence for it.
            if meta.get("orientation") == "rotate180":
                image = image.transpose(Image.Transpose.ROTATE_180)
            elif meta.get("orientation", "as-distributed") != "as-distributed":
                raise ValueError(f"unknown orientation for {body}: {meta['orientation']}")
            image.thumbnail((2048, 1024), Image.Resampling.LANCZOS)
            image.save(directory / "photo.jpg", quality=87, optimize=True)
            print(body, source, image.size, (directory / "photo.jpg").stat().st_size)
            break
        except Exception:
            if attempt == 4:
                raise
            time.sleep(4 * (attempt + 1))
