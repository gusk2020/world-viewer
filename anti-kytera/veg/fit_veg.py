"""Anti-KyTerra vegetation layer: one map of the representative (all-year)
potential natural vegetation, from the PR #12 hand-off only.

Inputs (anti-kytera/handoff/interface_v3.npz, see INTERFACE.md):
  bed_m, land_mask            0.25 deg  (terrain; land = bed >= 0 m)
  ice_mask_{fit,holdout}      0.5 deg   (predicted grounded ice)
  t2m / precip / vapour_{fit,holdout}   2 deg  (predicted annual means)
The *_teacher climate and ice fields are used ONLY for comparison, never as
inputs. The vegetation teacher (Ramankutty & Foley 1999) is only the label.

Grids are aligned by cell centre: the 2-degree climate is interpolated
bilinearly (longitude wraps) to 0.5-degree cell centres, then temperature is
moved to the 0.5-degree mean land height with one fixed lapse rate; terrain
features are area-averaged from the 0.25-degree bed. No place names, no
longitude as a feature. Latitude enters only through insolation (from the
obliquity), as in PR #12.

Modes, kept separate as in PR #12:
  fit     : trained on all labelled land, applied to all of Earth, using the
            *_fit climate
  holdout : six 60-degree longitude sectors, each predicted by a model trained
            on the other five, using the *_holdout climate
"""
import json
import os
import sys

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier as HGC

HERE = os.path.dirname(os.path.abspath(__file__))
AK = os.path.join(HERE, "..")
sys.path.insert(0, os.path.join(AK, "stat"))
sys.path.insert(0, os.path.join(AK, "model"))
import features as FE  # noqa: E402
from fetch_teacher import load_teacher  # noqa: E402

SECTORS = 6
LAPSE_K_PER_M = -6.5e-3      # standard atmosphere; used only to move T within a 2-degree cell
HOLDRIDGE_PET = 58.93        # mm/yr per degC of biotemperature (Holdridge 1967)
NY, NX = 360, 720

# Display / class codes. 0-9 base, 1x vegetation (= R&F class + 10), 3x-5x are
# RESERVED for future layers and not produced here.
CLASSES = [  # code, R&F id, Japanese label, English, colour
    (11, 1, "熱帯常緑林", "Tropical evergreen forest", [22, 100, 40]),
    (12, 2, "熱帯落葉林", "Tropical deciduous forest", [120, 160, 40]),
    (13, 3, "温帯常緑広葉樹林", "Temperate broadleaf evergreen", [60, 150, 90]),
    (14, 4, "温帯常緑針葉樹林", "Temperate needleleaf evergreen", [30, 110, 100]),
    (15, 5, "温帯落葉樹林", "Temperate deciduous forest", [140, 190, 70]),
    (16, 6, "北方常緑林", "Boreal evergreen forest", [40, 80, 70]),
    (17, 7, "北方落葉林", "Boreal deciduous forest", [110, 130, 80]),
    (18, 8, "混交林", "Mixed forest", [80, 140, 60]),
    (19, 9, "サバンナ", "Savanna", [205, 190, 80]),
    (20, 10, "草原・ステップ", "Grassland / steppe", [225, 215, 130]),
    (21, 11, "密な低木地", "Dense shrubland", [170, 120, 70]),
    (22, 12, "疎な低木地", "Open shrubland", [210, 170, 120]),
    (23, 13, "ツンドラ", "Tundra", [150, 160, 150]),
    (24, 14, "砂漠", "Desert", [240, 225, 185]),
    (25, 15, "極地荒原・岩", "Polar desert / rock", [175, 170, 175]),
]
SPECIAL = {0: ("海", "sea", [20, 60, 130]), 1: ("陸氷", "land ice", [235, 245, 255]),
           255: ("教師なし", "no teacher class", [90, 90, 90])}
RESERVED = {30: "川・湖 (inland water)", 40: "農地 (cropland)", 41: "灌漑地 (irrigated cropland)",
            50: "街 (urban)"}
# Bottom -> top. Higher layers hide lower ones where both are present.
DRAW_ORDER = ["sea(0)", "vegetation(11-25)", "cropland(40-41)", "inland water(30)", "urban(50)", "land ice(1)"]
GROUPS = {  # coarse biome groups for a second, more forgiving score
    "森林": [1, 2, 3, 4, 5, 6, 7, 8], "サバンナ・草原": [9, 10], "低木・砂漠": [11, 12, 14], "ツンドラ・極地": [13, 15]}


def centres(n, lo, hi):
    e = np.linspace(lo, hi, n + 1)
    return 0.5 * (e[1:] + e[:-1])


def bilinear_2deg(f2):
    """2-degree cell values -> 0.5-degree cell centres (south-first,
    lon -180..180, lon wraps, lat clamps at the outermost centres)."""
    ny2, nx2 = f2.shape
    lat, lon = centres(NY, -90, 90), centres(NX, -180, 180)
    fy = (lat + 90) / 180 * ny2 - 0.5
    fx = (lon + 180) / 360 * nx2 - 0.5
    y0 = np.clip(np.floor(fy).astype(int), 0, ny2 - 1)
    y1 = np.clip(y0 + 1, 0, ny2 - 1)
    wy = np.clip(fy - y0, 0, 1)
    wy = np.where(fy < 0, 0, wy)
    x0 = np.floor(fx).astype(int)
    wx = fx - x0
    x0 %= nx2
    x1 = (x0 + 1) % nx2
    a = f2[y0][:, x0] * (1 - wx) + f2[y0][:, x1] * wx
    b = f2[y1][:, x0] * (1 - wx) + f2[y1][:, x1] * wx
    return a * (1 - wy[:, None]) + b * wy[:, None]


def es_hpa(t):
    return 6.112 * np.exp(17.67 * t / (t + 243.5))


def climate_features(H, mode, z05, z2_on05):
    T2 = bilinear_2deg(H[f"t2m_c_{mode}"].astype(float))
    P = np.maximum(bilinear_2deg(H[f"precip_mm_yr_{mode}"].astype(float)), 1.0)
    E = np.maximum(bilinear_2deg(H[f"vapour_pressure_hpa_{mode}"].astype(float)), 0.01)
    T = T2 + LAPSE_K_PER_M * (z05 - z2_on05)
    es = es_hpa(T)
    bio = np.clip(T, 0, 30)
    pet = HOLDRIDGE_PET * np.maximum(bio, 0.1)
    return {
        "T_local": T, "logP": np.log(P), "logE": np.log(E),
        "RH": np.clip(E / es, 0, 1.5), "VPD": np.maximum(es - E, 0),
        "biotemp": bio, "log_P_over_PET": np.log(P / pet),
    }


def area_weights():
    lat = centres(NY, -90, 90)
    return np.repeat(np.cos(np.radians(lat))[:, None], NX, 1)


def fit_predict(X, y, w, lab, sec, mode):
    """Probabilities for every cell (rows of X). Trained on labelled cells only."""
    out = np.zeros((len(y), 15))
    groups = range(SECTORS) if mode == "holdout" else [None]
    for s in groups:
        tr = lab & ((sec != s) if s is not None else True)
        te = (sec == s) if s is not None else np.ones(len(y), bool)
        c = HGC(max_iter=400, learning_rate=0.06, max_leaf_nodes=31, min_samples_leaf=30,
                l2_regularization=1.0, random_state=0)
        c.fit(X[tr], y[tr], sample_weight=w[tr])
        p = c.predict_proba(X[te])
        out[np.ix_(te, c.classes_ - 1)] = p
    return out


def scores(pred, teach, w, lab):
    m = lab
    W = w[m].sum()
    acc = float((w[m] * (pred[m] == teach[m])).sum() / W)
    # Cohen's kappa (area weighted)
    po = acc
    pe = sum(float(w[m][pred[m] == k].sum() / W) * float(w[m][teach[m] == k].sum() / W) for k in range(1, 16))
    kappa = (po - pe) / (1 - pe)
    g = np.zeros(16, int)
    for gi, (_, ids) in enumerate(GROUPS.items()):
        g[ids] = gi
    gacc = float((w[m] * (g[pred[m]] == g[teach[m]])).sum() / W)
    per = {}
    for k in range(1, 16):
        a, b = (pred[m] == k), (teach[m] == k)
        inter, union = (w[m] * (a & b)).sum(), (w[m] * (a | b)).sum()
        per[k] = dict(iou=float(inter / union) if union > 0 else None,
                      teach_share=float(w[m][b].sum() / W), model_share=float(w[m][a].sum() / W))
    return dict(accuracy=acc, kappa=kappa, group_accuracy=gacc, per_class=per)


def confusions(pred, teach, cell_km2, lab, top=8):
    m = lab & (pred != teach)
    pairs = {}
    for t, p, a in zip(teach[m], pred[m], cell_km2[m]):
        pairs[(t, p)] = pairs.get((t, p), 0.0) + a
    lst = sorted(pairs.items(), key=lambda kv: -kv[1])[:top]
    return [dict(teacher=int(t), model=int(p), mkm2=round(a / 1e6, 2)) for (t, p), a in lst]


def main():
    H = dict(np.load(os.path.join(AK, "handoff", "interface_v3.npz")))
    bed = H["bed_m"].astype(float)
    F = FE.build(bed, 0.0, NY, NX)            # terrain features on 0.5 deg (from the 0.25-deg bed)
    F2 = FE.build(bed, 0.0, 90, 180)
    z05 = F["elev_land"]
    z2_on05 = bilinear_2deg(F2["elev_land"])
    tnames = [k for k in F if not k.startswith("_")]
    teach = load_teacher().astype(int)       # R&F 1..15, 0 = none
    landfrac = F["land_frac"]
    lab2 = (teach > 0) & (landfrac >= 0.5)   # labelled land on the bed-derived coast
    w = area_weights().ravel()
    R = 6371.0
    cell_km2 = (np.radians(0.5) * R) ** 2 * area_weights().ravel()
    lon = np.repeat(centres(NX, -180, 180)[None, :], NY, 0).ravel()
    sec = ((lon + 180) // (360 / SECTORS)).astype(int)
    y, lab = teach.ravel(), lab2.ravel()
    res, out = {}, {}
    for mode in ("fit", "holdout"):
        C = climate_features(H, mode, z05, z2_on05)
        names = tnames + list(C)
        X = np.stack([F[k].ravel() for k in tnames] + [C[k].ravel() for k in C], 1)
        prob = fit_predict(X, y, w, lab, sec, mode)
        pred = prob.argmax(1) + 1
        out[mode] = pred.reshape(NY, NX).astype(np.uint8)
        res[mode] = scores(pred, y, w, lab)
        res[mode]["confusions"] = confusions(pred, y, cell_km2, lab)
        res[mode]["features"] = names
        # sector-by-sector accuracy (holdout generalisation per region)
        res[mode]["by_sector"] = [float((w[lab & (sec == s)] * (pred == y)[lab & (sec == s)]).sum()
                                        / w[lab & (sec == s)].sum()) for s in range(SECTORS)]
    # No output here ever uses the *_teacher climate. (VEG.md quotes one
    # separate diagnostic run with teacher climate, to split the holdout error
    # into classifier and climate parts; it is not shipped or displayed.)
    os.makedirs(os.path.join(HERE, "results"), exist_ok=True)
    np.savez_compressed(os.path.join(HERE, "results", "veg_classes.npz"),
                        veg_fit=out["fit"], veg_holdout=out["holdout"], veg_teacher=teach.astype(np.uint8))
    meta = dict(classes=[dict(code=c, rf=r, ja=j, en=e, rgb=rgb) for c, r, j, e, rgb in CLASSES],
                special={str(k): dict(ja=v[0], en=v[1], rgb=v[2]) for k, v in SPECIAL.items()},
                reserved={str(k): v for k, v in RESERVED.items()}, draw_order=DRAW_ORDER,
                groups=GROUPS, scores=res, labelled_land_cells=int(lab.sum()))
    with open(os.path.join(HERE, "results", "summary.json"), "w") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    for mode in ("fit", "holdout"):
        r = res[mode]
        print(mode, "acc %.3f kappa %.3f group %.3f" % (r["accuracy"], r["kappa"], r["group_accuracy"]),
              "sectors", [round(x, 2) for x in r["by_sector"]])
        print("  IoU", {k: (round(v["iou"], 2) if v["iou"] is not None else None) for k, v in r["per_class"].items()})
        print("  top confusions", r["confusions"][:6])


if __name__ == "__main__":
    main()
