"""Write results/display.json + results/fields.bin for the comparison globe,
and results/comparison.png, from one experiment in runs/<name>/.

  python3 export_display.py <experiment-name>
"""
import json
import os
import sys

import numpy as np

import data
import diag_climate
from grid import LatLonGrid, regrid_conservative

HERE = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(HERE, "..", "results")


def main(runs):
    """runs: list of (key, experiment-name, Japanese label). The last one is
    the default view and gets the comparison figure."""
    Tt, Pt = diag_climate.teacher()
    T_t = diag_climate.annual(Tt)
    P_t = diag_climate.annual(Pt) * 365.25
    # present-day coastline at 0.5 deg, for orientation only
    s = data.surface_2048()
    land = regrid_conservative((s > 0).astype(float), np.linspace(-90, 90, 1025), np.linspace(-180, 180, 2049),
                               np.linspace(-90, 90, 361), np.linspace(-180, 180, 721))
    arrays = {"t2m_teacher": T_t, "precip_teacher": P_t, "land": land}
    meta = {"fields": {}, "runs": []}
    for key, name, label in runs:
        run = os.path.join(HERE, "..", "runs", name)
        f = np.load(os.path.join(run, "fields.npz"))
        summ = json.load(open(os.path.join(run, "summary.json")))
        arrays["t2m_model_" + key] = diag_climate.annual(f["Ts_model"])
        arrays["precip_model_" + key] = diag_climate.annual(f["P_model"]) * 365.25
        arrays["ice_model_" + key] = f["H_model"]
        arrays["ice_teacher_" + key] = f["H_obs"]
        meta["runs"].append({"key": key, "experiment": name, "label": label})
    keys = [r[0] for r in runs]
    meta["default"] = keys[0]
    os.makedirs(RES, exist_ok=True)
    off = 0
    with open(os.path.join(RES, "fields.bin"), "wb") as fh:
        for k, a in arrays.items():
            a = np.asarray(a, np.float32)
            meta["fields"][k] = {"offset": off, "w": a.shape[1], "h": a.shape[0]}
            fh.write(a.tobytes())
            off += a.nbytes
    meta["vars"] = {
        "t2m": {"model": "t2m_model_", "teacher": "t2m_teacher", "unit": "°C", "ramp": "temp",
                "lo": -40, "hi": 32, "diffRange": 15, "digits": 1,
                "modelNote": "モデル: 年平均地表気温（2°格子）。統計版は、その経度帯を学習から外して予測した値。",
                "teacherNote": "教師: Berkeley Earth 観測解析 1991–2020 年平均（同じ2°格子）。"},
        "precip": {"model": "precip_model_", "teacher": "precip_teacher", "unit": "mm/年", "ramp": "precip",
                   "lo": 50, "hi": 4000, "log": True, "diffRange": 1500, "digits": 0,
                   "modelNote": "モデル: 年降水量（2°格子）。統計版は経度帯を外した予測。",
                   "teacherNote": "教師: GPCP v2.3 観測解析（衛星＋雨量計）1991–2020（同じ2°格子）。"},
        "ice": {"model": "ice_model_", "teacher": "ice_teacher_", "teacherPerRun": True, "unit": "m", "ramp": "ice",
                "lo": 0, "hi": 4000, "diffRange": 2500, "digits": 0,
                "modelNote": "モデル: 陸氷の厚さ。統計版は無氷の岩盤地形から経度帯を外して予測（0.5°）、物理版は氷ゼロから形成（60 km）。",
                "teacherNote": "教師: GEBCO_2026 氷表面−氷床下岩盤の接地氷厚（モデルと同じ格子）。山岳氷河・小氷帽は含まない。"},
    }
    meta["caveat"] = ("統計版は地形・海陸・日射から教師に合わせた色分けで、物理計算ではない。"
                      "物理版は無氷から計算した参考。")
    json.dump(meta, open(os.path.join(RES, "display.json"), "w"), ensure_ascii=False, indent=1)
    for key, name, label in runs:
        a = dict(arrays)
        for v in ("t2m", "precip", "ice"):
            a[v + "_model"] = arrays[f"{v}_model_{key}"]
        a["ice_teacher"] = arrays["ice_teacher_" + key]
        figure(a, os.path.join(RES, f"comparison_{name}.png"), json.load(open(os.path.join(HERE, "..", "runs", name, "summary.json"))))
    print("wrote", RES)


def figure(a, path, summ):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import LogNorm
    fig, ax = plt.subplots(3, 3, figsize=(15, 9.5))
    ext = [-180, 180, -90, 90]
    rows = [("t2m", "Temperature (C)", dict(cmap="RdYlBu_r", vmin=-40, vmax=32), 15),
            ("precip", "Precipitation (mm/yr)", dict(cmap="YlGnBu", norm=LogNorm(50, 4000)), 1500),
            ("ice", "Land ice thickness (m)", dict(cmap="Blues", vmin=0, vmax=4000), 2500)]
    for r, (k, title, kw, dr) in enumerate(rows):
        m, t = a[k + "_model"], a[k + "_teacher"]
        for c, (fld, lab) in enumerate([(m, "model"), (t, "teacher"), (m - t, "model - teacher")]):
            kk = kw if c < 2 else dict(cmap="RdBu_r", vmin=-dr, vmax=dr)
            if k == "ice" and c < 2:
                fld = np.where(fld > 1, fld, np.nan)
            im = ax[r, c].imshow(fld, origin="lower", extent=ext, **kk)
            ax[r, c].contour(np.linspace(-180, 180, a["land"].shape[1]), np.linspace(-90, 90, a["land"].shape[0]),
                             a["land"], [0.5], colors="k", linewidths=0.4)
            ax[r, c].set_title(f"{title}: {lab}", fontsize=10)
            ax[r, c].set_xticks([]); ax[r, c].set_yticks([])
            fig.colorbar(im, ax=ax[r, c], shrink=0.8)
    kind = ("statistical colouring from terrain features, longitude-sector hold-out predictions"
            if "method" in summ else "physical model: ice-free start, fixed present-Earth conditions")
    fig.suptitle(f"Anti-KyTerra {summ['experiment']}: {kind} (teacher = observed present Earth)", fontsize=11)
    fig.tight_layout()
    fig.savefig(path, dpi=80)


if __name__ == "__main__":
    # usage: export_display.py key:experiment:label [...]
    main([tuple(a.split(":", 2)) for a in sys.argv[1:]])
