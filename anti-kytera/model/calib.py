"""Quick climate test with restart: python3 calib.py out.npz restart.npz years key=val ..."""
import sys, numpy as np, climate, setup_world, diag_climate
from grid import LatLonGrid
g = LatLonGrid(2, 2)
w = setup_world.restored_bed("local")
frac, z = setup_world.climate_boundary(w["bed_free"], g)
land = frac >= 0.5
over = dict(a.split("=") for a in sys.argv[4:])
p = climate.params(**{k: float(v) for k, v in over.items()})
st = None
if sys.argv[2] != "none":
    r = np.load(sys.argv[2])
    st = {k: r["state_" + k] for k in ("T", "hice", "snow", "soil")}
out = climate.Climate(g, land, z, p).run(years=int(sys.argv[3]), state=st, verbose=True)
np.savez_compressed(sys.argv[1], land=land, z=z, **{k: v for k, v in out.items() if k != "state"},
                    **{"state_" + k: v for k, v in out["state"].items()})
diag_climate.diagnose(out["Ts"], out["P"] * 86400, land, g)
o = out
for j in range(2, 90, 6):
    print("%+3d u %5.1f v %5.1f W %5.1f" % (g.lat[j], o["u"].mean((0, 2))[j], o["v"].mean((0, 2))[j], o["W"].mean((0, 2))[j]))
