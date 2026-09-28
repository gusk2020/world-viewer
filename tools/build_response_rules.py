"""Build the common climate-response rules used when the sliders move.

One pair of lookup tables, learnt from Earth's adopted 地球適合 fields and
applied unchanged to every body (no place or body names anywhere):

  ice[T][P]   the share of land cells carrying land ice (> 10 m) and their
              mean thickness, by annual temperature and precipitation bin;
  veg[T][P]   the share of each vegetation class among ice-free land cells in
              the same bins, and the most common one.

The viewer only uses them as *differences*: a cell keeps its adopted class
until the new climate clearly stops supporting it (its share in the new bin
falls below half its share in the base bin, by at least 0.05), and ice only
melts or forms when the ice share moves by more than 0.2 across 0.5. At the
base conditions every cell therefore keeps its adopted value.
Cells that become land (seabed exposed by a lower sea) take the table's
answer directly. Empty bins take the nearest filled bin.
"""
import json
from pathlib import Path

import numpy as np
from scipy.ndimage import distance_transform_edt

ROOT = Path(__file__).resolve().parents[1]
AK = ROOT / "anti-kytera"
T_LO, T_STEP, T_N = -60.0, 2.0, 50          # -60 .. +40 C
P_LO, P_STEP, P_N = 1.0, 0.1, 30            # log10 mm/yr: 10 .. 10000
ICE_MIN_M = 10


def fields(meta_path, bin_path):
    meta = json.loads(meta_path.read_text()); blob = bin_path.read_bytes()
    out = {}
    for k, f in meta["fields"].items():
        dt = {"i16": "<i2", "f32": "<f4", "u8": "u1"}[f["dtype"]]
        out[k] = np.frombuffer(blob, dt, f["w"] * f["h"], f["offset"]).reshape(f["h"], f["w"]).astype(float)
    return out


def up2to05(a):   # 2-degree (90x180) -> 0.5-degree (360x720), bilinear on cell centres, lon wraps
    h, w = a.shape
    lat = (np.arange(360) + .5) / 360 * h - .5
    lon = (np.arange(720) + .5) / 720 * w - .5
    y0 = np.clip(np.floor(lat).astype(int), 0, h - 1); y1 = np.clip(y0 + 1, 0, h - 1); wy = np.clip(lat - y0, 0, 1)
    x0 = np.floor(lon).astype(int); wx = lon - x0; x0 %= w; x1 = (x0 + 1) % w
    top = a[y0][:, x0] * (1 - wx) + a[y0][:, x1] * wx
    bot = a[y1][:, x0] * (1 - wx) + a[y1][:, x1] * wx
    return top * (1 - wy[:, None]) + bot * wy[:, None]


def fill_nearest(table, filled):
    idx = distance_transform_edt(~filled, return_distances=False, return_indices=True)
    return table[tuple(idx)]


def main():
    F = fields(AK / "results/display.json", AK / "results/fields.bin")
    V = fields(AK / "veg/results/veg_display.json", AK / "veg/results/veg_fields.bin")
    bed05 = F["bed"].reshape(360, 2, 720, 2).mean(axis=(1, 3))
    land = bed05 >= 0
    T = up2to05(F["T_fit"]); P = up2to05(F["P_fit"])
    H = F["H_fit"]; veg = V["veg_fit"].astype(int)
    ti = np.clip(((T - T_LO) / T_STEP).astype(int), 0, T_N - 1)
    pi = np.clip(((np.log10(np.maximum(P, 10)) - P_LO) / P_STEP).astype(int), 0, P_N - 1)
    area = np.cos(np.radians(-90 + (np.arange(360) + .5) * .5))[:, None] * np.ones((1, 720))
    n = np.zeros((T_N, P_N)); ice = np.zeros((T_N, P_N)); thick = np.zeros((T_N, P_N))
    np.add.at(n, (ti[land], pi[land]), area[land])
    iced = land & (H > ICE_MIN_M)
    np.add.at(ice, (ti[iced], pi[iced]), area[iced])
    np.add.at(thick, (ti[iced], pi[iced]), (area * H)[iced])
    has = n > 0
    frac = fill_nearest(np.where(has, ice / np.maximum(n, 1e-12), 0), has)
    has_t = ice > 0
    mean_t = fill_nearest(np.where(has_t, thick / np.maximum(ice, 1e-12), 0), has_t)
    vc = np.zeros((T_N, P_N, 15))
    ok = land & ~iced & (veg >= 11) & (veg <= 25)
    np.add.at(vc, (ti[ok], pi[ok], veg[ok] - 11), area[ok])
    # 3x3 smoothing of the counts, so neighbouring bins agree and a small
    # change of climate cannot flip a class by landing in a noisy bin.
    def smooth(a):
        p = np.pad(a, ((1, 1), (1, 1)) + ((0, 0),) * (a.ndim - 2), mode="edge")
        return sum(p[1 + dy:1 + dy + a.shape[0], 1 + dx:1 + dx + a.shape[1]] for dy in (-1, 0, 1) for dx in (-1, 0, 1))
    frac = smooth(frac) / 9
    vs = smooth(vc)
    has_v = vs.sum(2) > 0
    share = vs / np.maximum(vs.sum(2, keepdims=True), 1e-12)
    share = fill_nearest(np.where(has_v[..., None], share, 0).reshape(T_N, P_N, 15), has_v)
    vtab = share.argmax(2) + 11
    rules = {
        "_note": "Built by tools/build_response_rules.py from Earth's adopted 地球適合 fields. Common to every body; used only as differences from each body's base.",
        "tBins": {"lo": T_LO, "step": T_STEP, "n": T_N},
        "pBins": {"log10lo": P_LO, "step": P_STEP, "n": P_N},
        "iceMinM": ICE_MIN_M,
        "iceShare": np.round(frac, 3).tolist(),
        "iceThicknessM": np.round(mean_t).astype(int).tolist(),
        "vegClass": vtab.astype(int).tolist(),
        "vegShare": np.round(share, 3).tolist(),
        "vegCodes": list(range(11, 26)),
        "physics": {
            "humidityPerK": 0.064, "precipPerK": 0.02, "coastScaleKm": 1000,
            "moistureFactorRange": [0.25, 2.5],
            "_note": "Humidity follows saturation at fixed relative humidity (about 6.4 %/K at 14 C); precipitation 2 %/K; both scale by exp(-(d_new - d_base)/coastScaleKm) with d the distance to the nearest sea.",
        },
    }
    out = AK / "viewer/rules/response_rules.json"
    out.write_text(json.dumps(rules, separators=(",", ":")))
    print(out, out.stat().st_size, "bytes; ice bins", int((frac >= .5).sum()), "veg classes", sorted(set(vtab.ravel().tolist())))


if __name__ == "__main__":
    main()
