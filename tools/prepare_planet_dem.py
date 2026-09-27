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
from scipy.ndimage import distance_transform_edt


def main():
    p = argparse.ArgumentParser()
    p.add_argument("body", choices=["mercury", "venus"])
    p.add_argument("raw", type=Path)
    p.add_argument("geojson", type=Path)
    a = p.parse_args()
    conf = Path("anti-kytera/viewer/worlds") / a.body
    geo = json.loads(a.geojson.read_text())
    gt = geo.get("geoTransform")
    if not gt or abs(gt[2]) > 1e-6 or abs(gt[4]) > 1e-6 or gt[1] <= 0 or gt[5] >= 0:
        raise ValueError("Expected north-up global DEM; inspect georeferencing")
    x0 = gt[0]
    span_x, span_y = gt[1] * geo["size"][0], -gt[5] * geo["size"][1]
    config = json.loads((conf / "config.json").read_text())
    source_radius = config["terrain"]["sourceReferenceRadiusMetres"]
    # USGS simple-cylindrical GeoTIFFs can store projected metres rather than
    # degrees. Both span checks correspond to a full 360 by 180 degree world.
    projected_width = 2 * np.pi * source_radius
    degrees = abs(span_x - 360) < 1 and abs(span_y - 180) < 1
    metres = abs(span_x / projected_width - 1) < .01 and abs(span_y / (projected_width / 2) - 1) < .01
    if not (degrees or metres):
        raise ValueError(f"Source is not a full simple-cylindrical world: {span_x} x {span_y}")
    if abs(x0 / span_x) < .01:
        shift = 1024  # source longitudes 0..360
    elif abs(x0 / span_x + .5) < .01:
        shift = 0     # source longitudes -180..180
    else:
        raise ValueError(f"Unexpected first longitude coordinate {x0}; inspect map")
    arr = np.fromfile(a.raw, dtype="<f4").reshape(1024, 2048)
    band = geo["bands"][0]
    scale, band_offset = float(band.get("scale", 1)), float(band.get("offset", 0))
    nodata = band.get("noDataValue")
    missing = ~np.isfinite(arr) | (np.abs(arr) > 30000)
    if nodata is not None:
        missing |= arr == float(nodata)
    missing_count = int(missing.sum())
    missing_latitude_bounds = None
    if missing_count:
        rows = np.flatnonzero(missing.any(axis=1))
        missing_latitude_bounds = [round(90 - (rows[-1] + .5) * 180 / 1024, 2),
                                   round(90 - (rows[0] + .5) * 180 / 1024, 2)]
    if missing_count:
        if missing_count > arr.size * .10:
            raise ValueError(f"DEM has {missing_count}/{arr.size} missing cells; inspect source")
        # A small unresolved region is explicitly identified in metadata and
        # filled by the closest observed cell. This adds no claimed detail.
        nearest = distance_transform_edt(missing, return_distances=False, return_indices=True)
        arr = arr[tuple(nearest)]
    arr = arr * scale + band_offset
    if not np.isfinite(arr).all() or np.any(np.abs(arr) > 30000):
        raise ValueError("Decoded DEM is invalid; inspect source scale and offset")
    display_radius = config["body"]["radiusMetres"]
    # Convert height above the product datum into height above the body's
    # displayed radius. This is one global datum shift, not a climate rule.
    arr += source_radius - display_radius
    if shift:
        arr = np.roll(arr, shift, axis=1)
    south = np.flipud(arr).copy()
    out = conf / "terrain"
    out.mkdir(exist_ok=True)
    south.astype("<f4").tofile(conf / "bed_2048x1024.f32")
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
        "sourceCoordinateUnits": "degrees" if degrees else "projected metres",
        "sourceValueScale": scale, "sourceValueOffsetMetres": band_offset,
        "sourceReferenceRadiusMetres": source_radius,
        "displayReferenceRadiusMetres": display_radius,
        "datumShiftMetres": source_radius - display_radius,
        "resampling": "GDAL average to 2048x1024, then 2x2 area means for lower levels",
        "outputMinMaxMetres": [float(south.min()), float(south.max())],
        "missingCellsAfterResampling": missing_count,
        "missingFractionAfterResampling": missing_count / arr.size,
        "missingLatitudeBoundsDegrees": missing_latitude_bounds,
        "missingPolicy": "nearest valid elevation on 2048x1024 grid; no new fine detail" if missing_count else "none",
    }
    (conf / "config.json").write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n")
    print(a.body, config["terrain"]["processing"])


if __name__ == "__main__":
    main()
