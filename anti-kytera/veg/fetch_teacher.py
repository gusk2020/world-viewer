"""Fetch the potential-natural-vegetation teacher (Ramankutty & Foley 1999,
SAGE, 0.5 degree, 15 classes) and store it as a small PNG.

Out: veg/data/pnv_rf_0.5deg.png  uint8 720x360, pixel value = R&F class 1..15,
     0 = no class (water / no data). Image row 0 = NORTH (ordinary image
     orientation); load_teacher() flips it to the Anti-KyTerra south-first grid.
"""
import io
import os
import tarfile
import urllib.request

import numpy as np
from PIL import Image

URL = "https://sage-public-files.s3.amazonaws.com/global-potential-vegetation/potveg_nc.tar.gz"
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "data", "pnv_rf_0.5deg.png")


def main():
    import netCDF4
    raw = urllib.request.urlopen(URL, timeout=120).read()
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as t:
        nc = t.extractfile("vegtype_0.5.nc").read()
    d = netCDF4.Dataset("mem.nc", memory=nc)
    lat = d.variables["latitude"][:]
    lon = d.variables["longitude"][:]
    assert lat[0] > lat[-1] and abs(lon[0] + 179.75) < 1e-3, "unexpected grid orientation"
    a = np.squeeze(np.ma.filled(d.variables["vegtype"][:], 0))
    a = np.where((a >= 1) & (a <= 15), a, 0).astype(np.uint8)     # north-first
    assert a.shape == (360, 720)
    Image.fromarray(a).save(OUT, optimize=True)
    print(OUT, np.bincount(a.ravel(), minlength=16))


def load_teacher():
    """R&F classes on the south-first 0.5-degree grid (360x720)."""
    return np.asarray(Image.open(OUT))[::-1].copy()


if __name__ == "__main__":
    main()
