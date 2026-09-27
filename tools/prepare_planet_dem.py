"""Validate a USGS global DEM and create the small phone rasters.

The GDAL input is north-first ENVI Float32, downsampled to 2048x1024 with
area averaging. The source GeoTIFF's geographic bounds are checked by the
workflow; this script converts longitude 0..360 to -180..180 if needed.
"""
import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image


def main():
    p = argparse.ArgumentParser()
    p.add_argument("body", choices=["mercury", "venus"])
    p.add_argument("raw", type=Path)
    p.add_argument("geojson", type=Path)
    a = p.parse_args()
    conf = Path("anti-kytera/viewer/worlds") / a.body
    geo = json.loads(a.geojson.read_text())
    gt = geo.get("geoTransform")
    if not gt or abs(abs(gt[1]) * geo["size"][0] - 360) > 1 or abs(abs(gt[5]) * geo["size"][1] - 180) > 1:
        raise ValueError("Source is not a global 360x180 geographic map; inspect projection before conversion")
    x0 = gt[0]
    if min(abs(x0), abs(x0 - 360)) < 1:
        shift = 1024
    elif abs(x0 + 180) < 1:
        shift = 0
    else:
        raise ValueError(f"Unexpected first longitude {x0}; inspect map before conversion")
    arr = np.fromfile(a.raw, dtype="<f4").reshape(1024, 2048)
    if not np.isfinite(arr).all() or np.any(np.abs(arr) > 30000):
        raise ValueError("Missing/invalid DEM samples; no unstated infilling is allowed")
    if shift:
        arr = np.roll(arr, shift, axis=1)
    south = np.flipud(arr).copy()
    out = conf / "terrain"
    out.mkdir(exist_ok=True)
    south.astype("<f4").tofile(conf / "bed_2048x1024.f32")
    config = json.loads((conf / "config.json").read_text())
    offset = config["terrain"]["encoding"]["offsetMetres"]
    levels = []
    for w in (512, 1024, 2048):
        h, step = w // 2, 2048 // w
        down = arr.reshape(h, step, w, step).mean(axis=(1, 3))
        elevation = np.rint(down).astype(np.int32)
        enc = elevation + offset
        if enc.min() < 0 or enc.max() > 65535:
            raise ValueError("Elevation outside RG16 encoding range")
        rgb = np.zeros((h, w, 3), np.uint8)
        rgb[:, :, 0] = enc >> 8
        rgb[:, :, 1] = enc & 255
        dest = out / f"{a.body}_{w}x{h}.png"
        Image.fromarray(rgb).save(dest, optimize=True)
        levels.append({"url": f"./worlds/{a.body}/terrain/{dest.name}", "width": w, "height": h})
    config["terrain"]["levels"] = levels
    config["terrain"]["processing"] = {
        "sourceDimensions": geo["size"], "sourceFirstLongitude": x0,
        "resampling": "GDAL average to 2048x1024, then 2x2 area means for lower levels",
        "outputMinMaxMetres": [float(south.min()), float(south.max())],
        "missingCellsAfterResampling": 0,
    }
    (conf / "config.json").write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n")
    print(a.body, config["terrain"]["processing"])


if __name__ == "__main__":
    main()
