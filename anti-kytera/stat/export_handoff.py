"""Write handoff/interface_v3.npz for other prototypes (e.g. vegetation).
See handoff/INTERFACE.md for the contract.  python3 stat/export_handoff.py"""
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
RUN = os.path.join(HERE, "..", "runs", "STAGE_v3", "fields.npz")
OUT = os.path.join(HERE, "..", "handoff", "interface_v3.npz")
ICE_MASK_M = 10.0


def main():
    f = np.load(RUN)
    out = {
        "bed_m": np.round(f["bed"]).astype(np.int16),
        "land_mask": (f["bed"] >= 0).astype(np.uint8),
    }
    for mode in ("fit", "holdout"):
        out[f"ice_thickness_m_{mode}"] = f[f"H_{mode}"].astype(np.float32)
        out[f"ice_mask_{mode}"] = (f[f"H_{mode}"] > ICE_MASK_M).astype(np.uint8)
        out[f"t2m_c_{mode}"] = f[f"T_{mode}"].astype(np.float32)
        out[f"precip_mm_yr_{mode}"] = f[f"P_{mode}"].astype(np.float32)
        out[f"vapour_pressure_hpa_{mode}"] = f[f"E_{mode}"].astype(np.float32)
    out["ice_thickness_m_teacher"] = f["H_teacher"].astype(np.float32)
    out["t2m_c_teacher"] = f["T_teacher"].astype(np.float32)
    out["precip_mm_yr_teacher"] = f["P_teacher"].astype(np.float32)
    out["vapour_pressure_hpa_teacher"] = f["E_teacher"].astype(np.float32)
    for k, v in out.items():
        assert np.isfinite(v).all(), k
    np.savez_compressed(OUT, **out)
    for k, v in out.items():
        print(f"{k:30s} {v.shape} {v.dtype} min {v.min():.1f} max {v.max():.1f}")


if __name__ == "__main__":
    main()
