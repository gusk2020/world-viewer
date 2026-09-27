"""Write results/display.json + results/fields.bin for the staged globe.
Bedrock always; the climate stages only if runs/STAGE_v3/fields.npz exists.
  python3 export_stage.py"""
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "model"))
import data  # noqa: E402
from grid import regrid_conservative  # noqa: E402
from fit_stage import BED_CORRECTION_M  # noqa: E402

RES = os.path.join(HERE, "..", "results")
RUN = os.path.join(HERE, "..", "runs", "STAGE_v3")


def main():
    arrays, dtypes = {}, {}
    bed = data.bed_2048() + BED_CORRECTION_M
    bed_d = regrid_conservative(bed, np.linspace(-90, 90, 1025), np.linspace(-180, 180, 2049),
                                np.linspace(-90, 90, 721), np.linspace(-180, 180, 1441))
    arrays["bed"] = np.round(bed_d).astype(np.int16); dtypes["bed"] = "i16"
    from grid import LatLonGrid
    gh = LatLonGrid(180 / 1024, 360 / 2048)
    land = float((gh.area * (bed >= 0)).sum() / gh.area.sum())
    land_now = float((gh.area * (data.surface_2048() >= 0)).sum() / gh.area.sum())
    meta = {
        "stages": {
            "bed": {"note": "岩盤だけの地球（水・氷なし）。GEBCO_2026 氷床下地形（岩盤）、補正 "
                    f"{BED_CORRECTION_M:+.0f} m（アプリ用の仮定）。現在の氷床表面は使っていない。"},
            "sea": {"note": "海抜0 mを固定境界として、岩盤が0 m未満の所に海を置いた。氷床の下で海面下にある岩盤"
                    "（西南極など）も海になる。"},
        },
        "modeNote": {"fit": "地球適合＝地球全体で学習し地球に当てはめた値（見たことのある場所）。",
                     "holdout": "地域保留＝経度60°ごとに、その帯を学習から外したモデルで予測した値。"},
        "vars": {}, "fields": {},
    }
    if os.path.exists(os.path.join(RUN, "fields.npz")):
        f = np.load(os.path.join(RUN, "fields.npz"))
        sc = json.load(open(os.path.join(RUN, "summary.json")))["scores"]
        for mode in ("fit", "holdout"):
            for v in ("T", "E", "P", "H"):
                arrays[f"{v}_{mode}"] = f[f"{v}_{mode}"]
        for v in ("T", "E", "P", "H"):
            arrays[f"{v}_teacher"] = f[f"{v}_teacher"]

        def s(mode, fmt):
            return fmt(sc[mode])
        meta["vars"] = {
            "t2m": {"key": "T", "unit": "°C", "ramp": "temp", "lo": -40, "hi": 32, "diffRange": 15, "digits": 1,
                    "modelNote": "モデル: 年平均地表気温（2°格子）。岩盤地形・海陸・日射から推定。",
                    "teacherNote": "教師: Berkeley Earth 観測解析 1991–2020（同じ2°格子、実際の地表＝氷床表面を含む）。",
                    "score": {m: s(m, lambda d: f"誤差(RMSE) {d['temperature_rmse_K']:.1f} K・相関 {d['temperature_corr']:.3f}")
                              for m in ("fit", "holdout")}},
            "hum": {"key": "E", "unit": "hPa", "ramp": "hum", "lo": 0, "hi": 32, "diffRange": 6, "digits": 1,
                    "modelNote": "モデル: 年平均の地表付近水蒸気圧（2°格子）。気温の推定値と地形・海からの距離から推定。",
                    "teacherNote": "教師: ERA5 再解析 2 m露点から計算（4年抽出、2°格子）。観測そのものではない。",
                    "score": {m: s(m, lambda d: f"誤差 {d['humidity_rmse_hPa']:.1f} hPa・相関 {d['humidity_corr']:.3f}")
                              for m in ("fit", "holdout")}},
            "precip": {"key": "P", "unit": "mm/年", "ramp": "precip", "lo": 50, "hi": 4000, "log": True,
                       "diffRange": 1500, "digits": 0,
                       "modelNote": "モデル: 年降水量（2°格子）。気温・湿度の推定値と地形から推定。",
                       "teacherNote": "教師: GPCP v2.3 観測解析 1991–2020（同じ2°格子）。",
                       "score": {m: s(m, lambda d: f"相関(対数) {d['precip_corr_log']:.2f}・砂漠 {100*d['desert_hit']:.0f}%・熱帯雨林 {100*d['rainforest_hit']:.0f}%")
                                 for m in ("fit", "holdout")}},
            "ice": {"key": "H", "unit": "m", "ramp": "ice", "lo": 0, "hi": 4000, "diffRange": 2500, "digits": 0,
                    "modelNote": "モデル: 接地した陸氷の厚さ（0.5°格子）。海面下の岩盤の上にも置ける（西南極のように）。",
                    "teacherNote": "教師: GEBCO_2026 氷表面−岩盤の接地氷厚（同じ0.5°格子）。山岳氷河は含まない。",
                    "score": {m: s(m, lambda d: f"一致(IoU) {d['ice_iou']:.2f}・南極 {d['ice_area_Mkm2']['Antarctica'][0]:.1f}/{d['ice_area_Mkm2']['Antarctica'][1]:.1f}・"
                                             f"グリーンランド {d['ice_area_Mkm2']['Greenland'][0]:.2f}/{d['ice_area_Mkm2']['Greenland'][1]:.2f}・他 {d['ice_area_Mkm2']['other land'][0]:.2f} 百万km²")
                              for m in ("fit", "holdout")}},
        }
    meta["stages"]["bed"]["score"] = f"岩盤の標高 −8000〜+6000 m を色分け（陰影つき）"
    meta["stages"]["sea"]["score"] = f"陸の面積 {100*land:.1f}%（現在の地表で数えると {100*land_now:.1f}%）"
    os.makedirs(RES, exist_ok=True)
    off = 0
    with open(os.path.join(RES, "fields.bin"), "wb") as fh:
        for k, a in arrays.items():
            dt = dtypes.get(k, "f32")
            a = np.asarray(a, np.int16 if dt == "i16" else np.float32)
            meta["fields"][k] = {"offset": off, "w": a.shape[1], "h": a.shape[0], "dtype": dt}
            fh.write(a.tobytes())
            off += a.nbytes
            pad = (-off) % 4
            fh.write(b"\0" * pad); off += pad
    json.dump(meta, open(os.path.join(RES, "display.json"), "w"), ensure_ascii=False, indent=1)
    print("fields", list(arrays), "bytes", off)


if __name__ == "__main__":
    main()
