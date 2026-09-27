"""Apply the Earth-trained v3 colouring rules to a planetary elevation grid.

The body raster is a 2048x1024 south-first array, with longitude -180..180.
There are no planetary teacher values. Earth targets are loaded only while
training; their fields are never copied into the planetary output.
"""
import argparse
import json
from pathlib import Path
import sys

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor

AK = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(AK / "stat"), str(AK / "model"), str(AK / "veg")]
import data
from grid import LatLonGrid, regrid_conservative
import features as FE
import fit_veg as VEG
from fetch_teacher import load_teacher


def earth_fields():
    meta = json.loads((AK / "results/display.json").read_text())
    blob = (AK / "results/fields.bin").read_bytes()
    out = {}
    for name, f in meta["fields"].items():
        dtype = {"i16": "<i2", "f32": "<f4"}[f["dtype"]]
        out[name] = np.frombuffer(blob, dtype=dtype, count=f["w"] * f["h"], offset=f["offset"]).reshape(f["h"], f["w"])
    return meta, out


def reg(mono=None):
    return HistGradientBoostingRegressor(max_iter=400, learning_rate=.05, max_leaf_nodes=31,
                                         min_samples_leaf=40, l2_regularization=1.,
                                         monotonic_cst=mono, random_state=0)


def classifier(iterations=300, leaf=40):
    return HistGradientBoostingClassifier(max_iter=iterations, learning_rate=.05,
                                          min_samples_leaf=leaf, l2_regularization=1., random_state=0)


def packed(output, arrays, source):
    offset = 0
    source["fields"] = {}
    with (output / "fields.bin").open("wb") as f:
        for key, arr in arrays.items():
            a = np.asarray(arr, dtype="<i2" if key == "bed" else "<f4")
            b = a.tobytes()
            f.write(b)
            source["fields"][key] = {"offset": offset, "w": a.shape[1], "h": a.shape[0],
                                      "dtype": "i16" if key == "bed" else "f32"}
            offset += len(b)
            padding = (-offset) % 4
            f.write(b"\0" * padding)
            offset += padding
    (output / "display.json").write_text(json.dumps(source, ensure_ascii=False))


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--body", choices=["mercury", "venus"], required=True)
    p.add_argument("--bed", type=Path, required=True, help="2048x1024 south-first float32 metres, lon -180..180")
    p.add_argument("--radius", type=float, required=True)
    p.add_argument("--obliquity", type=float, required=True)
    p.add_argument("--rotation", type=int, choices=[-1, 1], required=True)
    args = p.parse_args()
    planet = np.fromfile(args.bed, dtype="<f4").reshape(1024, 2048).astype(float)
    if not np.isfinite(planet).all():
        raise ValueError("Planetary DEM has missing cells; do not invent terrain")
    meta, earth = earth_fields()
    base = AK / "viewer/worlds" / args.body / "stages"
    base.mkdir(parents=True, exist_ok=True)
    g, gi = LatLonGrid(2, 2), LatLonGrid(.5, .5)
    ebed = data.bed_2048().astype(float)
    ef2 = FE.build(ebed, 0, g.ny, g.nx)
    pf2 = FE.build(planet, 0, g.ny, g.nx, args.obliquity, args.rotation, args.radius)
    names = [k for k in ef2 if not k.startswith("_")]
    xe = np.stack([ef2[k].ravel() for k in names], 1)
    xp = np.stack([pf2[k].ravel() for k in names], 1)
    w2 = g.area.ravel() / g.area.mean()
    T = reg([FE.MONOTONE.get(k, 0) for k in names]).fit(xe, earth["T_teacher"].ravel(), sample_weight=w2).predict(xp)
    xeE = np.column_stack([xe, earth["T_fit"].ravel()])
    xpE = np.column_stack([xp, T])
    E = np.exp(reg().fit(xeE, np.log(np.maximum(earth["E_teacher"].ravel(), .01)), sample_weight=w2).predict(xpE))
    xeP = np.column_stack([xeE, np.log(np.maximum(earth["E_fit"].ravel(), .01))])
    xpP = np.column_stack([xpE, np.log(E)])
    P = np.exp(reg().fit(xeP, np.log(np.maximum(earth["P_teacher"].ravel(), 10)), sample_weight=w2).predict(xpP))

    efi = FE.build(ebed, 0, gi.ny, gi.nx)
    pfi = FE.build(planet, 0, gi.ny, gi.nx, args.obliquity, args.rotation, args.radius)
    xei = np.stack([efi[k].ravel() for k in names], 1)
    xpi = np.stack([pfi[k].ravel() for k in names], 1)
    up = lambda a: np.repeat(np.repeat(a.reshape(90, 180), 4, 0), 4, 1).ravel()
    xei = np.column_stack([xei, up(earth["T_fit"]), up(np.log(np.maximum(earth["E_fit"], .01))),
                            up(np.log(np.maximum(earth["P_fit"], 10)))])
    xpi = np.column_stack([xpi, up(T), up(np.log(E)), up(np.log(P))])
    y = earth["H_teacher"].ravel()
    wi = gi.area.ravel() / gi.area.mean()
    present = classifier().fit(xei, y > 100, sample_weight=wi).predict_proba(xpi)[:, 1]
    on = y > 100
    thick = reg().fit(xei[on], y[on], sample_weight=wi[on]).predict(xpi)
    H = np.where(present > .5, np.maximum(thick, 0), 0)

    # Same 0.5-degree annual vegetation classifier, using modelled climate.
    eh = dict(np.load(AK / "handoff/interface_v3.npz"))
    yf = load_teacher().ravel().astype(int)
    ve = FE.build(eh["bed_m"].astype(float), 0, VEG.NY, VEG.NX)
    vp = FE.build(planet, 0, VEG.NY, VEG.NX, args.obliquity, args.rotation, args.radius)
    ze2 = FE.build(eh["bed_m"].astype(float), 0, 90, 180)["elev_land"]
    zp2 = pf2["elev_land"]
    ce = VEG.climate_features(eh, "fit", ve["elev_land"], VEG.bilinear_2deg(ze2))
    ph = {"t2m_c_fit": T.reshape(90, 180), "precip_mm_yr_fit": P.reshape(90, 180),
          "vapour_pressure_hpa_fit": E.reshape(90, 180)}
    cp = VEG.climate_features(ph, "fit", vp["elev_land"], VEG.bilinear_2deg(zp2))
    tn = [k for k in ve if not k.startswith("_")]
    xv = np.stack([ve[k].ravel() for k in tn] + [ce[k].ravel() for k in ce], 1)
    xpv = np.stack([vp[k].ravel() for k in tn] + [cp[k].ravel() for k in cp], 1)
    lab = (yf > 0) & (ve["land_frac"].ravel() >= .5)
    veg = classifier(400, 30).fit(xv[lab], yf[lab], sample_weight=VEG.area_weights().ravel()[lab]).predict(xpv)
    veg = (veg.reshape(360, 720) + 10).astype(np.uint8)

    edges_y = np.linspace(-90, 90, 1025)
    edges_x = np.linspace(-180, 180, 2049)
    bed = regrid_conservative(planet, edges_y, edges_x, np.linspace(-90, 90, 721), np.linspace(-180, 180, 1441))
    stage = {"bed": np.rint(bed).astype(np.int16)}
    for key, arr, shape in (("T", T, (90, 180)), ("E", E, (90, 180)),
                             ("P", P, (90, 180)), ("H", H, (360, 720))):
        stage[key + "_fit"] = arr.reshape(shape)
        stage[key + "_holdout"] = stage[key + "_fit"]
        # Bound to the shader but never shown as a teacher; all UI teacher
        # controls and teacher scores are disabled for these bodies.
        stage[key + "_teacher"] = np.zeros(shape, dtype=np.float32)
    meta["stages"]["bed"] = {"note": "探査機由来の地形（仮想の水・氷を置く前）。", "score": "教師なし"}
    meta["stages"]["sea"] = {"note": "天体の基準面0 mを仮想海面としたアプリ上の仮定。", "score": "教師なし"}
    for m in meta["vars"].values():
        m["score"] = {"fit": "教師なし", "holdout": "教師なし"}
        m["teacherNote"] = "この天体には教師データがありません。"
    meta["modeNote"] = {"fit": "地球で学習した規則を適用した試験的な塗り分け。", "holdout": "教師なし"}
    meta["bodyRadiusMetres"] = args.radius
    meta["terrainProcessing"] = json.loads((AK / "viewer/worlds" / args.body / "config.json").read_text())["terrain"]["processing"]
    packed(base, stage, meta)
    vmeta = json.loads((AK / "veg/results/veg_display.json").read_text())
    vmeta["fields"] = {}
    vmeta["scores"] = {"fit": {"accuracy": None, "kappa": None, "group": None, "iou": {}},
                       "holdout": {"accuracy": None, "kappa": None, "group": None, "iou": {}}}
    off = 0
    with (base / "veg_fields.bin").open("wb") as out:
        for k, a in (("veg_fit", veg), ("veg_holdout", veg), ("veg_teacher", np.zeros_like(veg))):
            b = a.tobytes()
            out.write(b)
            vmeta["fields"][k] = {"offset": off, "w": 720, "h": 360, "dtype": "u8"}
            off += len(b)
    (base / "veg_display.json").write_text(json.dumps(vmeta, ensure_ascii=False))
    print(args.body, "stage bytes", (base / "fields.bin").stat().st_size,
          "ice cells", int((H > 10).sum()), "vegetation classes", np.unique(veg).tolist())


if __name__ == "__main__":
    main()
