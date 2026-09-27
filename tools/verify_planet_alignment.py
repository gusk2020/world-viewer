"""Check that each planetary layer points at the same place.

For every body the committed terrain PNG, the Anti-KyTerra stage bedrock
(fields.bin) and the viewing image must agree:

  * named landmarks sit where the literature puts them, in both the terrain
    PNG and the stage bedrock (Rachmaninoff basin, the lowest point on
    Mercury; Maxwell Montes, the highest on Venus; Maat Mons; Olympus Mons;
    Hellas; the lunar high point on the far side);
  * the viewing image lines up with the terrain better as distributed-and-
    placed than shifted in longitude, turned 180 degrees or mirrored.

Exits non-zero on any failure, so a workflow cannot publish a mismatch.
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

ROOT = Path(__file__).resolve().parents[1]
V = ROOT / "anti-kytera/viewer/worlds"

# (kind, lat, lon, search radius deg, allowed distance deg, extra)
LANDMARKS = {
    "mercury": [("min", 27.6, 57.6, 12, 2.0, "Rachmaninoff basin (lowest point)")],
    "venus": [("max", 65.2, 3.3, 12, 2.0, "Maxwell Montes (highest point)"),
              ("max", 0.5, -165.4, 8, 2.0, "Maat Mons")],
    "mars": [("max", 18.65, -133.8, 10, 2.0, "Olympus Mons"),
             ("min", -32.8, 62.1, 15, 3.0, "deepest point, NW Hellas (lowest point)")],
    "moon": [("max", 5.4, -158.6, 12, 3.0, "lunar high point (far side)")],
}


def terrain(body):
    c = json.loads((V / body / "config.json").read_text())
    level = next(x for x in c["terrain"]["levels"] if x["width"] == 2048)
    path = (V.parent / "index.html").parent / level["url"]
    rgb = np.asarray(Image.open(path.resolve()).convert("RGB"), dtype=np.int32)
    return (rgb[:, :, 0] * 256 + rgb[:, :, 1] - c["terrain"]["encoding"]["offsetMetres"]).astype(float)  # north-first


def stage_bed(body):
    d = json.loads((V / body / "stages/display.json").read_text())
    f = d["fields"]["bed"]
    blob = (V / body / "stages/fields.bin").read_bytes()
    return np.frombuffer(blob, "<i2", f["w"] * f["h"], f["offset"]).reshape(f["h"], f["w"])[::-1].astype(float)


def extreme(z, kind, lat, lon, r):
    h, w = z.shape
    lats = 90 - (np.arange(h) + .5) * 180 / h
    lons = -180 + (np.arange(w) + .5) * 360 / w
    dl = (lons[None, :] - lon + 180) % 360 - 180
    near = (np.abs(lats[:, None] - lat) <= r) & (np.abs(dl) <= r / max(np.cos(np.radians(lat)), .2))
    masked = np.where(near, z, np.nan)
    i = np.nanargmax(masked) if kind == "max" else np.nanargmin(masked)
    y, x = divmod(int(i), w)
    # the same kind of extreme over the whole globe, for the "is it THE point" check
    g = np.argmax(z) if kind == "max" else np.argmin(z)
    return lats[y], lons[x], z[y, x], z.flat[g]


def image_alignment(body, z):
    L = np.asarray(Image.open(V / body / "photo.jpg").convert("L").resize((1024, 512), Image.BILINEAR), float)
    zz = np.asarray(Image.fromarray(z.astype(np.float32)).resize((1024, 512), Image.BILINEAR), float)
    rows = slice(40, 472)
    ez = np.hypot(*np.gradient(gaussian_filter(zz, 1, mode="wrap")))[rows]
    out = {}
    for name, img in (("placed", L), ("rot180", L[::-1, ::-1]), ("flipNS", L[::-1]), ("flipEW", L[:, ::-1])):
        el = np.hypot(*np.gradient(gaussian_filter(img, 1, mode="wrap")))[rows]
        r = [np.corrcoef(ez.ravel(), np.roll(el, k, 1).ravel())[0, 1] for k in range(0, 1024, 4)]
        k = int(np.argmax(r)) * 4
        out[name] = (max(r), (k if k < 512 else k - 1024) * 360 / 1024, r[0])
    return out


def main():
    bodies = sys.argv[1:] or ["mercury", "venus", "mars", "moon"]
    failed = []
    for body in bodies:
        z, b = terrain(body), stage_bed(body)
        for kind, lat, lon, r, tol, name in LANDMARKS[body]:
            for label, grid in (("terrain", z), ("stage bed", b)):
                la, lo, v, g = extreme(grid, kind, lat, lon, r)
                dist = np.hypot(la - lat, ((lo - lon + 180) % 360 - 180) * np.cos(np.radians(lat)))
                ok = dist <= tol and ("point)" not in name or abs(v - g) < 1)
                print(f"{body:8s} {label:9s} {name}: found {la:.1f},{lo:.1f} ({v:.0f} m; global {kind} {g:.0f} m) "
                      f"expected {lat},{lon} -> {'OK' if ok else 'FAIL'} ({dist:.1f} deg)")
                if not ok:
                    failed.append(f"{body} {label} {name}")
        a = image_alignment(body, z)
        best, shift, at0 = a["placed"]
        others = max(v[0] for k, v in a.items() if k != "placed")
        ok = abs(shift) <= 2 and best > others + .05
        print(f"{body:8s} image     edge correlation placed {at0:.3f} (best shift {shift:+.1f} deg), "
              f"best other orientation {others:.3f} -> {'OK' if ok else 'FAIL'}")
        if not ok:
            failed.append(f"{body} image")
    if failed:
        print("FAILED:", "; ".join(failed))
        sys.exit(1)
    print("All layers agree.")


if __name__ == "__main__":
    main()
