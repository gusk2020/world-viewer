"""Drive the ice-sheet model to equilibrium from ZERO ice, with a fixed
climate from climate.py. Stops at practical convergence (see CONVERGE) or
t_max; 35 Myr is the specification's upper bound and is never approached."""
import json
import sys
import time

import numpy as np

import icesheet

CONVERGE = dict(window_yr=10000.0, rel_change=0.005, t_min=30000.0)


def run(bed_free, clim, dx=40e3, t_max=300e3, p=None, init_H=None, verbose=True, label=""):
    sheets = [icesheet.IceSheet(h, dx, bed_free, clim, p) for h in (1, -1)]
    if init_H is not None:
        for sh in sheets:
            land = (sh.b_eq > 0) & sh.inside
            sh.H = np.where(land, init_H, 0.0)
            sh.update_smb()
    V0 = [sh.volume() for sh in sheets]
    hist = []
    t0 = time.time()
    next_rec, next_smb = 0.0, 0.0
    t = 0.0
    converged = False
    while t < t_max:
        for sh in sheets:
            while sh.t <= t:
                sh.step()
        t = min(sh.t for sh in sheets)
        if t >= next_smb:
            for sh in sheets:
                sh.update_smb()
            next_smb = t + 50.0
        if t >= next_rec:
            V = sum(sh.volume() for sh in sheets)
            A = sum(sh.grounded_area() for sh in sheets)
            hist.append((t, V, A))
            next_rec = t + 1000.0
            if verbose and int(t) % 10000 < 1000:
                print(f"  {label} t={t/1000:6.1f} kyr  V={V/1e15:7.3f} Mkm3  A={A/1e12:6.2f} Mkm2  ({time.time()-t0:.0f}s)", flush=True)
            h = np.array(hist)
            if t >= CONVERGE["t_min"] and len(h) > 11:
                Vold = h[-11, 1]
                if abs(V - Vold) <= CONVERGE["rel_change"] * max(V, 1e12):
                    converged = True
                    break
    for sh in sheets:
        sh.update_smb()
    budget = []
    for sh, v0 in zip(sheets, V0):
        V = sh.volume()
        realised, calved, boundary, clipped = sh.stats
        budget.append(dict(V0=v0, V=V, smb=realised, calving=calved, boundary=boundary, clip_created=clipped,
                           residual=V - v0 - (realised - calved - boundary + clipped)))
    return sheets, np.array(hist), converged, budget
