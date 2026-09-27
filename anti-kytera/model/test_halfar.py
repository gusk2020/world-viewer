"""Verification of the SIA solver against the Halfar (1981) similarity
solution for a spreading dome (n = 3, flat bed, zero SMB). Checks the dome
height against the analytic value and that volume is conserved.
  python3 test_halfar.py"""
import math

import numpy as np

import icesheet as I


def halfar(r, t, H0, R0, t0):
    s = (t0 / t)
    inner = 1 - (s ** (1 / 18) * r / R0) ** (4 / 3)
    return np.where(inner > 0, H0 * s ** (1 / 9) * np.maximum(inner, 0) ** (3 / 7), 0.0)


def run(dx):
    A = I.ICE["A_glen"]
    gam = 2 * A * (I.RHO_I * I.G) ** 3 / 5
    H0, R0 = 3600.0, 750e3
    t0 = 1 / (18 * gam) * (7 / 4) ** 3 * R0 ** 4 / H0 ** 7
    N = int(2.4 * R0 / dx) | 1
    xs = (np.arange(N) - (N - 1) / 2) * dx
    X, Y = np.meshgrid(xs, xs)
    r = np.hypot(X, Y)
    H = halfar(r, t0, H0, R0, t0)
    b = np.full_like(H, 1000.0)
    k = np.ones_like(H)
    inside = np.ones(H.shape, bool)
    area = np.full_like(H, dx * dx)
    smb = np.zeros_like(H)
    stats = np.zeros(4)
    V0 = H.sum() * dx * dx
    t = t0
    while t < 2 * t0:
        qx, qy = np.zeros_like(H), np.zeros_like(H)
        dmax = I._fluxes(H, b + H, k, dx, gam, qx, qy)
        dt = min(2 * t0 - t, 0.12 * dx * dx / dmax)
        H = I._update(H, b, smb, k, qx, qy, dx, dt, inside, area, stats, True)
        t += dt
    Ha = halfar(r, t, H0, R0, t0)
    c = N // 2
    return H[c, c], Ha[c, c], abs(H.sum() * dx * dx - V0) / V0, t0


if __name__ == "__main__":
    for dx in (50e3, 25e3):
        hn, ha, dv, t0 = run(dx)
        print(f"dx={dx/1e3:.0f} km  t0={t0:.0f} yr -> 2 t0: dome H model {hn:.1f} m, analytic {ha:.1f} m "
              f"(err {100*(hn-ha)/ha:+.2f} %), relative volume change {dv:.1e}")
