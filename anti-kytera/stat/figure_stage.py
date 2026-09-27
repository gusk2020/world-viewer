"""Comparison figure for the staged run: teacher | 地球適合 | 地域保留 | 地域保留−教師.
  python3 figure_stage.py [run-dir] [out.png]"""
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
from matplotlib.colors import LogNorm  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


def main(run=os.path.join(HERE, "..", "runs", "STAGE_v3"), out=os.path.join(HERE, "..", "results", "comparison_stage.png")):
    f = np.load(os.path.join(run, "fields.npz"))
    bed = f["bed"]
    ext = [-180, 180, -90, 90]
    rows = [("T", "Temperature (C)", dict(cmap="RdYlBu_r", vmin=-40, vmax=32), 15),
            ("E", "Vapour pressure (hPa)", dict(cmap="YlGnBu", vmin=0, vmax=32), 6),
            ("P", "Precipitation (mm/yr)", dict(cmap="YlGnBu", norm=LogNorm(50, 4000)), 1500),
            ("H", "Land ice (m)", dict(cmap="Blues", vmin=0, vmax=4000), 2500)]
    fig, ax = plt.subplots(4, 4, figsize=(18, 11))
    for r, (k, title, kw, dr) in enumerate(rows):
        panels = [(f[f"{k}_teacher"], "teacher", kw), (f[f"{k}_fit"], "Earth fit", kw),
                  (f[f"{k}_holdout"], "sector hold-out", kw),
                  (f[f"{k}_holdout"] - f[f"{k}_teacher"], "hold-out - teacher", dict(cmap="RdBu_r", vmin=-dr, vmax=dr))]
        for c, (fld, lab, kk) in enumerate(panels):
            if k == "H" and c < 3:
                fld = np.where(fld > 1, fld, np.nan)
            im = ax[r, c].imshow(fld, origin="lower", extent=ext, **kk)
            ax[r, c].contour(np.linspace(-180, 180, bed.shape[1]), np.linspace(-90, 90, bed.shape[0]), bed, [0],
                             colors="k", linewidths=0.3)
            ax[r, c].set_title(f"{title}: {lab}", fontsize=9)
            ax[r, c].set_xticks([]); ax[r, c].set_yticks([])
            fig.colorbar(im, ax=ax[r, c], shrink=0.75)
    fig.suptitle("Anti-KyTerra staged colouring from sub-ice bedrock + sea at 0 m (coastline = bed 0 m contour)", fontsize=11)
    fig.tight_layout()
    fig.savefig(out, dpi=70)
    print("wrote", out)


if __name__ == "__main__":
    main(*sys.argv[1:])
