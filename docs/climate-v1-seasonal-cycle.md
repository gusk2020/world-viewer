# Climate v1: the seasonal cycle (minimum stage)

The first time anything in this project carries a time axis. Scope is
deliberately one step: **insolation -> seasonal surface-temperature anomaly ->
surface temperature at any orbital phase.** Wind, pressure, humidity,
moisture, ET, precipitation, soil water, snow, sea ice and the UI are all
untouched, and nothing in the shipped pipeline imports this module.

Files: `js/climate-v1/season.js`, `tools/validate_season.mjs`. One pure
addition to `js/climate.js` (`dailyMeanInsolationFactor`) — see "Regression".

## The definition

    T(lat, lng, phase) = T_annual(lat, lng) + deltaT(lat, surfaceType, phase)

`T_annual` is Stage 2's field, used exactly as it stands; `temperature.js` is
unchanged. `deltaT` is a sum of harmonics **with no constant term**, so its
annual mean is zero by construction rather than by tuning — measured at
1.45e-14 C as the worst row, and averaging 48 phases of the real 2048x1024
grid returns Stage 2's own field to 3.6e-7 C per cell.

`orbitalPhase` runs [0, 1) over one orbit. Phase 0 is the ascending equinox,
so 0.25 is the northern solstice on any world. **No calendar is hardcoded** —
Earth's months exist only if a UI chooses to label phases with them.

## The physics

Declination `d = asin(sin(tilt) * sin(2*pi*phase))`, then the daily-mean
insolation kernel already in `js/climate.js`. Polar night and midnight sun
need no special case: the sunrise hour angle clamps to 0 or pi. Measured at
85N, 156.7 days of each (the real figure is about 161), and exactly equal to
one another on a circular orbit, as they must be. Eccentricity stays 0.

Forcing is **real W/m2**: `absorbed * S0 * (I(lat,phase) - I_annual(lat))`.
Stage 2's `insolationSensitivityC` is deliberately not reused — it is a
regression coefficient for the annual-mean equator-to-pole contrast and
carries feedbacks and meridional transport. Measured: reusing it puts 45N's
half-amplitude at **42 C** against an observed 12-15.

One layer, solved analytically for its periodic steady state:

    C dT'/dt = F(t) - lambda*T'
    per harmonic n:  k = n*w*tau,  gain = 1/sqrt(1+k^2),  lag = atan(k)/(n*w)

so amplitude *and* phase lag both fall out of the geometry. No time stepping
runs, at build time or at sample time.

## The constants, and what they are not

| | value | status |
| --- | --- | --- |
| `seasonalDampingWPerM2K` | 8 | **empirical representative value**, the only genuinely free number |
| soil depth | 4 m | representative physical value (annual damping depth in soil) |
| mixed-layer depth | 30 m | representative physical value |
| atmospheric column | 1.0e7 J/m2/K | ~1e4 kg/m2 x c_p |
| absorbed fraction | 0.70 | representative scalar — **no albedo map, no snow/ice feedback, no geography** |
| S0, year length | 1361 W/m2, 365.2422 d | Earth's, used only as defaults; they belong to the body |

None of these is a universal constant and all are meant to be replaced per
planet and per surface. `lambda` = 8 is far above the global radiative
feedback (~2 W/m2/K) because that one describes the whole planet's balance,
not one patch of ground.

**`oceanModeration` is not touched and must not be mixed in.** That term
compresses the *annual-mean* sea temperature toward the global mean and stands
in for meridional ocean heat transport; the sea's smaller, later seasonal
swing here comes from its heat capacity alone.

## What it produces

`C_land` 1.88e7 J/m2/K (tau 27 d), `C_sea` 1.30e8 (tau 188 d).

| lat | land half-amp | land lag | sea half-amp | sea/land | sea-land lag |
| --- | --- | --- | --- | --- | --- |
| 0N | 1.2 C | (semi-annual) | 0.3 | 0.22 | +19 d |
| 15N | 5.5 | +36 d | 1.8 | 0.33 | +52 d |
| 30N | 10.7 | +26 d | 3.5 | 0.33 | +52 d |
| 45N | **15.1** | **+25 d** | **4.9** | 0.33 | **+48 d** |
| 60N | 18.6 | +24 d | 6.1 | 0.33 | +45 d |
| 85N | 21.6 | +26 d | 7.5 | 0.35 | +35 d |

Lags are measured from that hemisphere's own solstice. Every structural
requirement is checked by the validator and passes: hemispheric antiphase
(r = -1.000), a small equatorial swing that is genuinely **semi-annual** (two
maxima a year, the second harmonic 1.14 C against the first's 0.07), amplitude
monotone in latitude, identical amplitudes at +/-30, +/-45, +/-60, sea below
land everywhere, and sea peaking later than land everywhere.

Obliquity sweep at 60N land: **0.00 C at tilt 0**, 8.07 at 10 deg, 18.49 at
23.44, 30.09 at 40, 46.22 at 80.

On the real grid, 35-55N, equinox to northern solstice: land 20.5 C, sea 6.1 C.

## Storage, cost, and the one assumption behind both

**The anomaly has no longitude**, because at this stage heat capacity depends
on nothing but land-or-sea. So the table is (row x surface x harmonic), not a
third dimension of the grid: **32 KB** for 512 rows, built in **44 ms** (node)
and only when the world or its obliquity changes. One sample costs ~100 ns and
needs no interpolation, because four harmonics are evaluated directly.

Four harmonics were measured against a 64-harmonic reference: max error
**0.00 C at 0/30/45/60 deg and 0.23 C at +/-85**, where the forcing is sharply
non-sinusoidal. Storing 24 phase samples instead would cost 96 KB for a worse
0.66 C.

**That assumption is exactly what stops holding when state memory arrives.**
`heatCapacityJPerM2K(surfaceType)` is its own exported function for that
reason: once soil water, snow or sea ice carry state, capacity becomes a
per-cell array, the analytic solution no longer applies, and
`solvePeriodicResponse` is replaced by a forward integration over the same
`SEASONAL_TIME_AXIS`. Nothing else about the axis should have to move.

## Not V0.8's season

V0.8's `seasonalSensitivityC` / `seaSeasonalDamping` compute two states as an
instantaneous linear response to the solstice insolation anomaly — no heat
capacity, no time derivative, **no phase lag** — and each latitude takes the
max and min of the two solstices, so that field is a composite of two
different calendar moments rather than the surface at any one time. It is a
drawing correction. Neither parameter is read here and neither should ever be.

## Regression

`js/climate.js` gained one exported function, `dailyMeanInsolationFactor`, and
its two existing insolation functions now call it instead of each carrying the
same formula inline. The arithmetic is identical and it was checked rather than
assumed: `score_climate.mjs` and `score_koppen.mjs` print **byte-identical**
output before and after (63.4% / 10.2%), and all ten existing Climate v1 test
and validator outputs are byte-identical too (178 assertions).

Nothing imports `season.js` except its validator, so every existing output is
unchanged by construction as well as by measurement.

## On the phone: one row, temperature only

The UI is deliberately one 30 px row inside the existing bottom panel, shown
**only while 気温モデル is selected**:

    [年間][季節]  ◀  [───────]  ▶  [再生]

- **年間** shows Stage 2's own array, not a copy, so returning from 季節
  cannot leave a seasonal value behind. Verified: the rendered frame after one
  and after three 年間↔季節 round trips is **byte-identical** to the frame
  before the season existed.
- **The slider carries 1440 steps per orbit** (about a quarter of a day on
  Earth) and reads `orbitalPhase = value / 1440`. The arrows step 1/24 of a
  year. **Play** advances the phase from real elapsed time, one orbit per 12
  seconds, so a slow device plays the year at the right speed with fewer
  frames rather than in slow motion.
- **The label is a label.** The readout's heading line reads e.g.
  `季節気温（気温のみ）位相0.750（274日目 冬至（北半球））` -- the day number is
  derived from the phase and the body's own year length, and the four region
  temperatures beside it are read from **the phase actually drawn**, so the
  numbers cannot contradict the picture (サハラ 30.5 C at phase 0.25 against
  15.4 C at 0.75, while アマゾン goes the other way, 29.2 -> 31.2).
- **Hidden wherever it would imply something untrue**: the temperature teacher
  is an annual mean, humidity is not seasonal in this model, and the 2D map
  and the other bodies have no preview -- in every one of those the row is
  hidden and playback stops.

**Moving the phase runs no climate stage.** It is one pass adding a
row-constant anomaly to Stage 2's field (into a reused buffer) plus the same
texture repaint every preview view already does. Measured in the browser:
**10-20 ms per phase**, against 640-710 ms before the repaint was fixed --
see below.

### The repaint had to get 30x cheaper first, and the fix is exact

`showScalarField` coloured every one of the texture's two million pixels
through a callback. Because its sampling is *nearest*, every texture row that
maps to the same field row is byte-for-byte the same row, so the colour is now
worked out once per **field** cell and each row is filled by typed-array copy.
Proved identical rather than assumed, two ways: the run boundaries
`[ceil(fx*w/fw), ceil((fx+1)*w/fw))` are the exact inverse of the old
`floor(x*fw/w)` (checked over seven size pairs including a field wider than
the texture), and the rendered annual frame hashes the same **1799c75758ce**
before and after. 650 ms -> 26 ms, which the teacher and humidity views get
for free.

### Measured on a 412x892 viewport (software renderer)

| | |
| --- | --- |
| phase change | **10-20 ms** |
| first 気温モデル paint | 3.0 s (unchanged -- the Climate v1 pipeline, not the season) |
| season table build | 43 ms, 32 KB, once per world |
| frame rate, photo surface / 年間 / 季節 / playing | **2 / 2 / 2 / 2 fps** |
| playback speed | 0.265 of a year in 3 s = 11.3 s per orbit |
| panel height | **unchanged**: 41 px top, 182 px bottom, both annual and seasonal |

The 2 fps is swiftshader drawing a 393k-vertex globe and is **the same with
the season off, on, and playing** -- i.e. the season costs no frame rate here.
Real on-device feel still needs the phone.

### Representative points, off the real grid

| | annual | warmest | coldest | half-amp | peak after solstice |
| --- | --- | --- | --- | --- | --- |
| 45N land (France) | 10.4 C | 25.6 | -4.7 | **15.1** | +27 d |
| 45N sea (N Pacific) | 12.1 C | 17.0 | 7.1 | **4.9** | +72 d |
| 45S land (Chile) | 7.5 C | 22.8 | -7.7 | 15.2 | +27 d |

### Regression

Earth's 標準 surface and the whole V0.8 pipeline are untouched (the two
scorers print byte-identical output, 63.4% / 10.2%), all four Climate v1 test
suites pass (178 assertions), land ET and evaporative cooling are still OFF by
default, exactly one canvas exists in `#app` before and after a full tour of
2D, both other bodies and back, and the page logs no errors beyond the
sandbox's own blocked OpenStreetMap tiles.

## Orbital eccentricity and the direction of periapsis

Two physical inputs on the body, and nothing else: `orbitalEccentricity` (e)
and `periapsisLongitudeDeg` (ϖ, the angle from the ascending equinox to
periapsis, measured along the orbit in the direction of motion -- the standard
palaeoclimate convention). Earth today is e = 0.0167, ϖ ≈ 283; Mars e = 0.0934,
ϖ ≈ 251. **No calendar, month or place name is reachable from the model.**
Both default to 0, so a world's config that predates them means exactly what
it always meant.

### What was added

    M(φ) = M₀ + 2πφ          M₀ = meanAnomalyFromTrueAnomaly(−ϖ, e)
    M = E − e sin E          solved for E (Newton)
    ν = 2 atan2(√(1+e) sin(E/2), √(1−e) cos(E/2))
    λs = ν + ϖ               solar longitude out of the equinox
    sin δ = sin(tilt) sin λs
    (a/r)² = 1/(1 − e cos E)²

and the forcing line becomes `distanceFactor[s] * dailyMeanInsolationFactor(lat, δ)`.
That is the whole change to the physics; the harmonic solver, the sampling and
everything downstream are untouched.

**`orbitalPhase` stays equally spaced in time.** The true anomaly is never the
clock. That is not a convenience: the sea-ice state integrator steps at a
constant `yearSeconds / steps`, which is only correct on a uniform-in-time
axis, and the plain arithmetic mean of the sampled forcing is only the true
time mean on one too -- which is what keeps the seasonal anomaly's annual mean
at exactly zero.

**Kepler is solved once per phase** (360 times per table build), never per
latitude and never per cell, because both outputs depend on the phase alone.
e = 0 bypasses the solver entirely, so the circular case is bit-identical by
construction rather than to within rounding.

### Verified against two exact identities

Both are in `tools/validate_season.mjs`, and they check the whole
M → E → ν → r chain rather than any one step:

- **phase 0 is the ascending equinox at every e and every ϖ** — worst
  |λs(0)| = 3.8e-15 rad over 8 eccentricities × 6 periapsis directions.
- **the time mean of (a/r)² is 1/√(1−e²)** — worst relative error 5.3e-15.

Newton converges to 1e-13 in at most **5** iterations up to e = 0.6, and
`solveEccentricAnomaly(M, 0)` reports 0 iterations.

### The harmonic count is derived from e, and it had to be

A fixed four harmonics breaks badly once the orbit is eccentric: measured
against a 96-harmonic reference, the error is 0.5 C at e = 0 but **17 C at
e = 0.5**, because the periapsis passage becomes a spike that is narrow in
time. Sampling is *not* the problem — 360 phase samples agree with 1440 to
0.07 C even at e = 0.8.

So `harmonicsForEccentricity(e) = min(48, ceil(4/(1−e)^1.6) + 2)`, with e = 0
special-cased to exactly 4. **This is a numerical-accuracy setting, not a
fitted parameter**, and the bar it is set against is not invented: it is the
accuracy the circular case already delivers (0.504 C worst over all rows),
because that is the picture the user has looked at and accepted.

| e | H | max error (C) | table | build |
| --- | --- | --- | --- | --- |
| 0 | 4 | 0.504 | 32 KB | 33 ms |
| 0.0167 | 7 | 0.263 | 56 KB | 49 ms |
| 0.093 | 7 | 0.228 | 56 KB | 51 ms |
| 0.2 | 8 | 0.233 | 64 KB | 55 ms |
| 0.3 | 10 | 0.202 | 80 KB | 69 ms |
| 0.4 | 12 | 0.220 | 96 KB | 78 ms |
| 0.5 | 15 | 0.231 | 120 KB | 96 ms |
| 0.6 | 20 | 0.277 | 160 KB | 125 ms |

### e ≤ 0.6 is the supported range, and above it the model refuses

At e = 0.7 the requirement is 32 harmonics and at e = 0.8 it is past 48 with
53 C of error, so `sampleOrbit` **throws** rather than clamping. A silently
reduced eccentricity would draw a plausible season for a planet nobody asked
for, which is the worst of the available failures.

### What the orbit produces (land, half-amplitude °C @ phase of maximum)

| case | 45N | 45S | equator | N−S |
| --- | --- | --- | --- | --- |
| circular | 15.1 @0.319 | 15.2 @0.819 | 1.2 | −0.09 |
| Earth-like e=0.0167 ϖ=283 | 14.3 @0.321 | **16.0** @0.827 | 1.9 | **−1.68** |
| Mars-like e=0.0934 ϖ=251 | 11.1 | **19.8** | 6.3 | **−8.70** |
| N summer at periapsis e=0.3 ϖ=90 | **34.2** | 3.7 | 22.0 | **+30.5** |
| S summer at periapsis e=0.3 ϖ=270 | 3.6 | **34.3** | 22.2 | **−30.7** |
| equinox at periapsis e=0.3 ϖ=0 | 23.7 | 24.4 | 22.8 | −0.72 |
| high e=0.5 ϖ=283 | 16.3 | 58.2 | 47.6 | −41.9 |

The hemispheric asymmetry falls out of the geometry and **its sign is set by
ϖ alone** — nothing was fitted and no hemisphere is named anywhere in the
code. Earth's own orbit makes the southern summer the stronger one, which is
what the real Earth does, and Mars's well-known strong southern-summer bias
appears unprompted. Note the equator's 47.6 C at e = 0.5: at high
eccentricity the 1/r² term becomes a *global* annual cycle that dominates the
tilt-driven hemispheric contrast, which is physically right and not what
"season" usually means.

### Two limitations, both stated rather than hidden

- **Stage 2's annual mean does not know about eccentricity.** The orbit-mean
  insolation itself rises as 1/√(1−e²) — +0.01% at Earth, +0.4% at Mars,
  **+15.5% at e = 0.5** — and Stage 2's annual-mean temperature field never
  reads e. So on a high-e world the seasonal *departure* is
  eccentricity-aware while the annual mean it is added to is not. Stage 2 was
  deliberately not changed this round; the factor is reported as
  `table.orbit.meanInsolationScale` so nobody has to rediscover it.
- **Sea ice's 48 steps/year has not been re-checked at high e.** That
  convergence (within 0.017 m of an 8760-step reference) was measured on a
  circular orbit. A high-e melt season is sharper in time, so 48 steps may no
  longer resolve it. No sea-ice setting was touched here; this needs its own
  diagnosis before any eccentric world is taken seriously.

### The Moon, which is the one trap here

The Moon's seasonal insolation follows the **Earth–Moon system's orbit around
the Sun**, not the Moon's own e = 0.055 orbit around the Earth. Nothing in the
code infers an eccentricity from anything, and no world's config carries these
fields yet, so the Moon is circular like everything else — but a future
settings screen must not offer "the Moon's eccentricity" and mean 0.055.

### Nothing in any world's config changed

Every world still resolves to e = 0, so the app draws exactly what it drew.
Entering Earth's real 0.0167 / 283 would move the seasonal picture (45N
15.1 → 14.3 C, 45S 15.2 → 16.0 C) and that is a content decision for the
planet-settings screen, not something to slip in with the capability.
