import sys, time, numpy as np
import climate, setup_world
from grid import LatLonGrid
g = LatLonGrid(2, 2)
w = setup_world.restored_bed(sys.argv[1] if len(sys.argv) > 1 else "local")
frac, z = setup_world.climate_boundary(w["bed_free"], g)
land = frac >= 0.5
t = time.time()
c = climate.Climate(g, land, z)
yrs = int(sys.argv[2]) if len(sys.argv) > 2 else 3
t0 = sys.argv[3] if len(sys.argv) > 3 else 'warm'
out = c.run(years=yrs, T0=None if t0 == 'warm' else float(t0))
print("time", time.time() - t)
np.savez_compressed(sys.argv[4] if len(sys.argv) > 4 else "/tmp/clim_test.npz", land=land, z=z, frac=frac,
                    **{k: v for k, v in out.items() if k != 'state'}, **{'state_' + k: v for k, v in out['state'].items()})
