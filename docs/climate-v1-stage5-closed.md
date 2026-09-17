# Stage 5 closed — index and final conclusions

Stage 5 (humidity and moisture transport) is closed as **"complete within the
current annual-mean steady-state model and the current Stage 4 wind"**. That is
not a claim that Earth's humidity is reproduced. This file is an index and a
verdict; every measurement behind it is already written up in the documents
listed below, and nothing is repeated here.

## Production baseline (the fixed state)

- Stage 5B moisture transport, **explicit diffusion K = 0**
- **`moistureResidenceDays` = 8** (unchanged; not re-derived)
- the model's own **Stage 4 wind**
- **land ET = OFF** (`landEvapotranspirationWeight` 0)
- **evaporative cooling = OFF** (`evaporativeCoolingC` 0)
- `surfaceLapseRateCPerKm` = 5.2 upstream (Stage 2, closed separately)

## Index

| document | what it settles |
| --- | --- |
| `climate-v1-humidity-stage5a.md` | q_sat, surface pressure (Stage 5A) |
| `climate-v1-land-sea-stage5a5.md`, `climate-v1-water-surface-stage5a6.md` | the water boundary and where it sits |
| `climate-v1-moisture-stage5b.md` | the transport operator itself (Stage 5B) |
| `climate-v1-moisture-diagnosis-stage5b1.md`, `climate-v1-moisture-baseline-stage5b2.md` | K = 3e6 is excessive; K = 0 baseline |
| `climate-v1-dry-tail-diagnosis-stage5b.md` | the dry tail, and that it is not a boundary fault |
| `climate-v1-recycling-stage5c-alpha.md` | `f*q/tau` recycling degenerates to a tau relabel |
| `climate-v1-rh-diagnosis-stage5c.md` | RH-dependent recycling is not a physical threshold |
| `climate-v1-stage2-closed-and-humidity-rebaseline.md` | the current baselines, and A/B/C error decomposition (source/sink >= wind >> temperature) |
| `climate-v1-land-evapotranspiration.md` | the experimental ET term, and why it ships OFF |
| `climate-v1-oracle-wind-fix.md`, `climate-v1-wind-*.md` | the wind, frozen |

## The negative results Stage 5 established

1. **K = 3e6 explicit diffusion is excessive**; K = 0 is the baseline.
2. **A uniform tau cannot fix the wet/dry ratio** — no value reproduces both
   the tropics and the deserts.
3. **`f*q/tau` recycling is exactly `(1-f)/tau`** — algebraically a tau
   relabel, not a new mechanism.
4. **RH-dependent recycling is not a physical threshold** — it is a
   self-reference to the very field being solved for.
5. **The water boundary q is not short of water** (sea bias +0.41 g/kg,
   mid-latitudes exactly 0.00).
6. **Temperature and q_sat errors are not the main cause** — term A of the
   decomposition is 0.03-0.13 g/kg against 3.3-3.6 for wind and source/sink.
7. **Even with the observed (oracle) wind, a local land source is still
   missing** over 83% of land.
8. **An ET source itself is promising**: with the oracle wind, land mean
   5.081 -> 7.164 g/kg against a teacher of 7.806, and a wet/dry source ratio
   of 5.17x against the 5.07x required.
9. **RH availability is not adopted** — self-referential, amplifies wind
   error, bistable on a small area, over-wets the Sahara under the production
   wind, and does nothing where transport delivers zero.
10. **A bucket does not work in an annual-mean steady state** — soil water
    becomes a deterministic function of P and PET, every precipitation proxy
    built from the model's own atmosphere re-injects the wind's error
    (Amazon and Congo P = 0.00 mm/day), and the coupled solver stops
    converging in semi-arid regions.
11. **The final bottleneck is the moisture-carrying capacity of the current
    Stage 4 wind.** Every mechanism above is limited by it, and none of them
    can substitute for it.

## What must not follow from this

**Stage 4 is not reopened because of Stage 5.** The wind already has its own
negative results (`climate-v1-wind-negative-results.md`: Hadley, Gill,
friction, the tropical correction, the unified validator) and is frozen.
"Fix the wind again for humidity's sake" is the loop this closure exists to
prevent.

## Experimental code that stays

`js/climate-v1/moisture.js`'s land ET term and
`js/climate-v1/evaporative-cooling.js` both remain, both default to zero
weight, and both are proved bit-identical to their absence when off. They are
kept as mechanisms that may become useful **if a better moisture transport
field ever exists** — not as candidates awaiting a parameter.
