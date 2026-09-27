"""Write the phone preview's data: veg/results/veg_display.json + veg_fields.bin.

Fields (all south-first, lon -180..180):
  bed        i16 1440x720  bedrock (m); land = bed >= 0 (the hand-off land mask)
  veg_*      u8  720x360   vegetation code 11..25 (0 = no teacher class) for fit/holdout/teacher
  ice_*      u8  720x360   grounded ice 1/0 for fit/holdout (hand-off masks) and teacher (thickness > 10 m)
The composite shown is ice > sea > vegetation.
"""
import json
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
AK = os.path.join(HERE, "..")


def main():
    H = np.load(os.path.join(AK, "handoff", "interface_v3.npz"))
    V = np.load(os.path.join(HERE, "results", "veg_classes.npz"))
    S = json.load(open(os.path.join(HERE, "results", "summary.json")))
    arrs = {"bed": H["bed_m"].astype(np.int16)}
    for m in ("fit", "holdout", "teacher"):
        v = V[f"veg_{m}"].astype(np.uint8)
        arrs[f"veg_{m}"] = np.where(v > 0, v + 10, 0).astype(np.uint8)
    arrs["ice_fit"] = H["ice_mask_fit"].astype(np.uint8)
    arrs["ice_holdout"] = H["ice_mask_holdout"].astype(np.uint8)
    arrs["ice_teacher"] = (H["ice_thickness_m_teacher"] > 10).astype(np.uint8)
    blob, fields, off = bytearray(), {}, 0
    for k, a in arrs.items():
        b = a.tobytes()
        fields[k] = dict(offset=off, w=a.shape[1], h=a.shape[0], dtype="i16" if a.dtype == np.int16 else "u8")
        blob += b
        off += len(b)
        pad = (-off) % 4
        blob += b"\0" * pad
        off += pad
    meta = {k: S[k] for k in ("classes", "special", "reserved", "draw_order")}
    meta["fields"] = fields
    sc = {}
    for m in ("fit", "holdout"):
        r = S["scores"][m]
        sc[m] = dict(accuracy=r["accuracy"], kappa=r["kappa"], group=r["group_accuracy"],
                     iou={str(int(k) + 10): v["iou"] for k, v in r["per_class"].items()})
    meta["scores"] = sc
    with open(os.path.join(HERE, "results", "veg_fields.bin"), "wb") as f:
        f.write(bytes(blob))
    with open(os.path.join(HERE, "results", "veg_display.json"), "w") as f:
        json.dump(meta, f, ensure_ascii=False)
    print(off, "bytes")


if __name__ == "__main__":
    main()
