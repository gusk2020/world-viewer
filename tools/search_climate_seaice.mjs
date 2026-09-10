// Large-scale Pareto search over season + longitude-ITCZ + land-snow-budget +
// sea-ice-budget together (the sea-ice-seasonal-balance experiment).
//
// **This script is prepared and ready to run, but has NOT been run at scale
// in this round.** Per the user's explicit instruction, the 10,000-trial-class
// search across multiple shards is not to be executed until the user reviews
// this round's small-scale (2,000-trial) result and decides whether to
// proceed, or have the design audited first. See
// docs/sea-ice-seasonal-balance-experiment.md for that result and for why
// this design looks the way it does.
//
// Unlike tools/search_climate.mjs (Stage 7), this is deliberately NOT a
// single-objective search. The user's standing rule for this round: never
// collapse Teacher A and Teacher B into one number. So this keeps a genuine
// two-objective Pareto front (Teacher A's mean IoU, Teacher B's mean IoU) and
// records every other metric (per-class IoU, region term, seasonal-class sum,
// longitudinal share, sea-ice precision/recall) alongside each front member
// without ever using them to rank candidates against each other.
//
//   node tools/search_climate_seaice.mjs [worlds/kasoku-sekai] [options]
//     --shard N        this shard's id, used only to seed its RNG (default 0)
//     --trials N       stop after N evaluations (default 10000)
//     --hours H        stop after H hours (default 6)
//     --patience N     stop after N trials with no front improvement (default 500)
//     --step N         score every Nth pixel (default 2)
//     --seed N         base random seed; the shard id is mixed in
//     --keep N         front size cap, during the search and at merge (default 40)
//     --out FILE       checkpoint path (default ./search-seaice-shard<N>.json)
//     --resume         continue from that checkpoint instead of starting over
//     --seedFrom FILE  warm-start candidates (default the world's own
//                      sea-ice-candidates.json, skipped if absent)
//     --merge A B ..   combine finished shard checkpoints, dedupe, print/save
//
// Stop condition is whichever of the three limits is reached first, exactly
// as the user specified: 6 hours, 10,000 trials, or 500 consecutive trials
// with no front improvement. Two details of that third one were both wrong
// before the audit and are worth stating precisely: "improvement" means the
// front's hypervolume actually grew (see hypervolume() for why the obvious
// definition never fires), and the 500 counts only trials that passed the
// hard constraints (see the loop for why counting rejections would make a
// shard stop before it had found anything).
//
// The search space and the hard constraints below were both revised by the
// pre-large-search audit, which measured that the original ones let three
// separate degenerate families through -- two of them scoring *better* than
// the known-good candidate, so they would have owned the front. The full
// write-up, including the numbers each bound is derived from, is in
// docs/pre-large-search-audit.md.
//
// Checkpoints are written every ten seconds to a temp file and renamed, so
// killing the process loses at most a few seconds of work, and --resume
// continues from exactly where it left off (front, rng state, trial count,
// elapsed time so far).
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readPng } from "./png.mjs";
import {
  computeClimate,
  computeGeography,
  resolveClimateSets,
  scoreAgainstTeacher,
  scoreAgainstStructureTeacher,
} from "../js/climate.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoPath = (url) => path.join(REPO, url.replace(/^\.\//, ""));

// ---------------------------------------------------------------------------
// Search space. Season, ITCZ and land-snow ranges are carried over unchanged
// from the ITCZ and snow-balance rounds' own searches (docs/itcz-longitude-
// experiment.md, docs/snow-ice-balance-experiment.md) rather than re-derived,
// so this search explores the same space those did, now with sea ice joined
// to it. The three sea-ice parameters use the schema's own min/max
// (js/climate.js CLIMATE_PARAMETERS) except where a floor is added below for
// the same reason as the other floors: this round's whole point is a
// realistic season with all four mechanisms actually engaged, not a search
// that is free to switch any of them back off (Step 24's degenerate-solution
// exclusion, made structural rather than post-hoc).
// ---------------------------------------------------------------------------
const SPACE = {
  seasonalSensitivityC: [15, 30],
  itczLandPullDeg: [15, 30],
  itczPullRangeDeg: [5, 60],
  itczSmoothDeg: [2, 60],
  itczElevationPullM: [1000, 40000],
  snowBalanceWeight: [0.2, 1],
  snowMeltDegreeDay: [0, 1],
  snowBalanceRequiredM: [-0.5, 1],
  // Capped at 0 by the pre-search audit, and that cap is the whole point of
  // the bound. This is the *old* warm-season snow threshold, which survives
  // as the other half of the mixture whenever snowBalanceWeight < 1 -- and
  // with its old range reaching +15 the search could rebuild the exact design
  // the snow-balance round rejected: a "melt point" of +6 C, which has no
  // physical meaning and only ever meant "whatever makes Earth come out
  // right". Measured during the audit, that reconstruction *beats* the
  // known-good candidate on both objectives (Teacher A 54.43 -> 55.01, land
  // ice 62.7 -> 65.2, Teacher B identical), so a 10,000-trial search would
  // have found it immediately and filled the front with it. A melt point
  // above freezing is unphysical for *permanent* snow, so the cap is at the
  // real freezing point and nothing below it is lost -- every known-good
  // candidate sits at -23 to -25. See docs/pre-large-search-audit.md.
  snowSummerMeltC: [-30, 0],
  seaIceBalanceWeight: [0.2, 1],
  seaIceMeltDegreeDay: [0, 1],
  seaIceBalanceRequired: [-0.5, 1],
};
const NAMES = Object.keys(SPACE);

// Parameters the search never touches, because they are `physical` (a fact
// about salt water or fresh water, not a knob) or already fixed by an earlier
// round's own measurement (Stage 7's `polarExtraC`, `coriolisStrength`, etc.).
// Everything not in SPACE and not overridden here comes from the world's own
// resolved default climate set, unchanged.

// ---------------------------------------------------------------------------
// Hard constraints: a trial that fails these is rejected before it can ever
// reach the front, rather than discovered to be degenerate after the search
// has already spent its budget chasing it.
//
// **The pre-search audit measured that the original two floors were not
// enough**, and not in a subtle way -- three separate degenerate families
// passed them, and two of those *beat* the known-good candidate on Teacher A,
// so they would have taken over the front rather than merely appearing on it:
//
//   - an ITCZ neutered while its own headline knob still reads 30 (a wide
//     pull window plus heavy longitude smoothing): Teacher A 54.43 -> 56.37
//     while the seasonal classes collapse 17.0 -> 1.2 and the longitudinal
//     structure falls 27.4% -> 22.2%, i.e. most of the way back to the purely
//     zonal model this whole line of work exists to escape;
//   - a season at the space's own floor with the seasonal classes at exactly
//     0.0 (this one the small search actually produced, at the top of its
//     front);
//   - a melt rate of zero, which paints 11.00% of the globe in land ice
//     against the teacher's 3.33% -- an *upper* bound problem that a floor on
//     area cannot see at all.
//
// So the guards below are on **outcomes**, not on parameter values, because
// every one of those families keeps its parameters inside the space's floors
// and switches the mechanism off downstream instead. Each number is taken
// from measurement rather than chosen: the area bands are the teacher's own
// area scaled loosely both ways, the IoU floors sit at roughly a third of
// what is actually achieved, the seasonal floor sits inside an empty gap
// (the zonal model scores exactly 0.0 and anything genuinely seasonal scores
// 4.8 or more), and the longitudinal floor is the bottom of the measured
// "ITCZ genuinely on" range (24.5-27.4%) against a zonal baseline of 19%.
//
// None of these is a scoring term: they cannot pull the search toward the
// teacher, only stop it walking off the edge. `lon` is computed from the
// model's own moisture field and involves no teacher at all.
// ---------------------------------------------------------------------------
const CONSTRAINTS = {
  iceAreaMin: 0.003,      // teacher 3.33% of the globe; ~1/10th of it
  iceAreaMax: 0.10,       // ~3x the teacher: catches "ice everywhere"
  iceIouMin: 0.20,        // achieved 62.7-71%
  seaIceAreaMin: 0.001,   // teacher 1.01%
  seaIceAreaMax: 0.030,   // ~3x the teacher
  seaIceIouMin: 0.15,     // achieved 52.7-53.7%
  seasonalMin: 0.02,      // zonal model 0.0; anything real >= 4.8%
  lonMin: 0.24,           // zonal 19%; ITCZ genuinely on 24.5-27.4%
};

// How much the front's hypervolume must gain, relatively, before a trial
// counts as an improvement for the patience clock.
const HYPERVOLUME_EPSILON = 1e-4;

function makeRandom(seed) {
  let state = (seed >>> 0) || 1;
  return () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
}

function parseArgs(argv) {
  const out = { shard: 0, trials: 10000, hours: 6, patience: 500, step: 2, seed: 1, keep: 40, merge: [] };
  let world = "worlds/kasoku-sekai";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--shard") out.shard = Number(argv[++i]);
    else if (a === "--trials") out.trials = Number(argv[++i]);
    else if (a === "--hours") out.hours = Number(argv[++i]);
    else if (a === "--patience") out.patience = Number(argv[++i]);
    else if (a === "--step") out.step = Number(argv[++i]);
    else if (a === "--seed") out.seed = Number(argv[++i]);
    else if (a === "--keep") out.keep = Number(argv[++i]);
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--resume") out.resume = true;
    else if (a === "--seedFrom") out.seedFrom = argv[++i];
    else if (a === "--merge") { while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) out.merge.push(argv[++i]); }
    else if (!a.startsWith("--")) world = a;
  }
  out.world = path.isAbsolute(world) ? world : path.join(REPO, world);
  return out;
}

function loadWorld(worldDir) {
  const config = JSON.parse(readFileSync(path.join(worldDir, "config.json"), "utf8"));
  const level = config.terrain.levels.reduce((a, b) => (b.width > a.width && b.width <= 2048 ? b : a));
  const png = readPng(repoPath(level.url));
  const offset = config.terrain.encoding.offsetMetres;
  const metres = new Int16Array(png.width * png.height);
  for (let i = 0; i < metres.length; i++) metres[i] = png.data[i * 3] * 256 + png.data[i * 3 + 1] - offset;
  const elevation = { width: png.width, height: png.height, metres };

  const eraSpec = config.teacher;
  const era = eraSpec.eras.find((e) => e.id === eraSpec.default) || eraSpec.eras[0];
  const teacherAMap = readPng(repoPath(era.map));
  const teacherA = { width: teacherAMap.width, height: teacherAMap.height, data: teacherAMap.data };

  const teacherBMap = readPng(repoPath(config.teacherStructure.map));
  const teacherB = { width: teacherBMap.width, height: teacherBMap.height, data: teacherBMap.data };

  const geography = computeGeography({ elevation, seaLevelMetres: 0, radiusMetres: config.body.radiusMetres });
  return { config, elevation, teacherA, teacherB, geography };
}

function longitudinalShare(climate, geography) {
  const cw = climate.width, ch = climate.height;
  let within = 0, total = 0, gm = 0, gw = 0;
  const rows = [];
  for (let y = 0; y < ch; y++) {
    const lat = (0.5 - (y + 0.5) / ch) * 180;
    const w = Math.cos((lat * Math.PI) / 180);
    if (w <= 0) continue;
    const vals = [];
    for (let x = 0; x < cw; x++) if (!geography.isSea[y * cw + x]) vals.push(climate.moisture[y * cw + x]);
    if (vals.length < 8) continue;
    rows.push({ w, vals });
    for (const v of vals) { gm += w * v; gw += w; }
  }
  gm /= gw;
  for (const r of rows) {
    let m = 0; for (const v of r.vals) m += v; m /= r.vals.length;
    for (const v of r.vals) { total += r.w * (v - gm) ** 2; within += r.w * (v - m) ** 2; }
  }
  return total > 0 ? within / total : 0;
}

function makeEvaluator(world, step) {
  const { config, elevation, teacherA, teacherB, geography } = world;
  // By id, not by position: a world that grows a second climate set would
  // otherwise silently have the search optimising from the wrong base.
  const sets = resolveClimateSets(config);
  const base = sets.sets.find((s) => s.id === sets.defaultId) || sets.sets[0];
  const body = config.body;
  let count = 0;
  return {
    base,
    get count() { return count; },
    run(overrides) {
      count++;
      const params = { ...base.values, ...overrides };
      const climate = computeClimate({
        elevation, seaLevelMetres: 0,
        axialTiltDegrees: body.axialTiltDegrees, radiusMetres: body.radiusMetres,
        dayLengthHours: body.dayLengthHours, rotationDirection: body.rotationDirection,
        params, geography,
      });
      const a = scoreAgainstTeacher({ elevation, climate, teacher: teacherA, seaLevelMetres: 0, params, step });
      const b = scoreAgainstStructureTeacher({ elevation, climate, teacher: teacherB, seaLevelMetres: 0, params, step });
      const ca = a.classes;
      const seasonal = ["tropicalSeasonal", "temperateSeasonal", "coldSeasonal"]
        .reduce((s, k) => s + (b.classes[k]?.iou ?? 0), 0);
      const iceArea = ca.landIce.modelArea / a.totalWeight;
      const seaIceArea = ca.seaIce.modelArea / a.totalWeight;
      const lon = longitudinalShare(climate, geography);
      return {
        params, a: a.meanIou, b: b.meanIou, region: 1 - a.regionPenalty,
        veg: ca.vegetation.iou, arid: ca.arid.iou, ice: ca.landIce.iou, seaIce: ca.seaIce.iou,
        iceRecall: ca.landIce.recall, icePrecision: ca.landIce.precision, iceArea,
        seaIceRecall: ca.seaIce.recall, seaIcePrecision: ca.seaIce.precision, seaIceArea,
        seasonal, lon,
        valid:
          iceArea >= CONSTRAINTS.iceAreaMin && iceArea <= CONSTRAINTS.iceAreaMax &&
          ca.landIce.iou >= CONSTRAINTS.iceIouMin &&
          seaIceArea >= CONSTRAINTS.seaIceAreaMin && seaIceArea <= CONSTRAINTS.seaIceAreaMax &&
          ca.seaIce.iou >= CONSTRAINTS.seaIceIouMin &&
          seasonal >= CONSTRAINTS.seasonalMin &&
          lon >= CONSTRAINTS.lonMin,
      };
    },
  };
}

// Two-objective Pareto dominance on (Teacher A, Teacher B) -- no combined
// score anywhere in this file.
const dominates = (x, y) => (x.a >= y.a && x.b >= y.b) && (x.a > y.a || x.b > y.b);

// The front's hypervolume against the origin, which is a valid reference here
// because both objectives are mean IoU and so cannot go below 0.
//
// **This exists because "500 trials with no improvement" was not measuring
// what it says.** Patience used to reset whenever anything was added to the
// front at all -- and in two continuous objectives almost any small jitter
// off a front member lands somewhere non-dominated, so the clock reset
// perpetually and the run could only ever stop on the trial cap or the wall
// clock. Hypervolume moves only when the front actually covers more ground,
// so a front that is merely shuffling its interior no longer counts as
// progress.
function hypervolume(front) {
  if (!front.length) return 0;
  const pts = [...front].sort((x, y) => y.a - x.a);
  let hv = 0;
  let bestB = 0;
  for (const p of pts) {
    if (p.b > bestB) {
      hv += p.a * (p.b - bestB);
      bestB = p.b;
    }
  }
  return hv;
}

// Crowding distance in (a, b), the standard NSGA-II measure, used only to
// decide which interior point to drop when the front is over its cap. The two
// extremes are never droppable -- losing them would quietly shrink the range
// of trade-offs the run reports.
function dropMostCrowded(front) {
  const idx = front.map((_, i) => i).sort((i, j) => front[i].a - front[j].a);
  let worst = -1;
  let worstDistance = Infinity;
  for (let k = 1; k < idx.length - 1; k++) {
    const prev = front[idx[k - 1]];
    const next = front[idx[k + 1]];
    const distance = (next.a - prev.a) + (prev.b - next.b);
    if (distance < worstDistance) {
      worstDistance = distance;
      worst = idx[k];
    }
  }
  if (worst >= 0) front.splice(worst, 1);
}

// Dedup: drop a point within 5% of parameter-space distance of one already on
// the front, same rule Stage 7's search used, so twenty near-copies of one
// basin cannot crowd out real diversity.
function tooClose(p, q) {
  let d2 = 0;
  for (const n of NAMES) {
    const [lo, hi] = SPACE[n];
    const range = hi - lo || 1;
    d2 += ((p[n] - q[n]) / range) ** 2;
  }
  return Math.sqrt(d2 / NAMES.length) < 0.05;
}

function sample(random) {
  return Object.fromEntries(NAMES.map((n) => {
    const [lo, hi] = SPACE[n];
    return [n, lo + random() * (hi - lo)];
  }));
}
function jitter(random, p, sigma) {
  const q = { ...p };
  for (const n of NAMES) {
    if (random() > 0.4) continue;
    const [lo, hi] = SPACE[n];
    q[n] = Math.min(hi, Math.max(lo, p[n] + (random() * 2 - 1) * sigma * (hi - lo)));
  }
  return q;
}

function loadCheckpoint(outPath) {
  if (!existsSync(outPath)) return null;
  return JSON.parse(readFileSync(outPath, "utf8"));
}
function saveCheckpoint(outPath, state) {
  const tmp = outPath + ".tmp";
  writeFileSync(tmp, JSON.stringify(state, null, 1));
  renameSync(tmp, outPath);
}

/**
 * Known-good starting points, so the search begins inside the feasible region
 * instead of hunting for it.
 *
 * **The audit's smoke test found this missing and it matters more than it
 * sounds.** Sampling 12 dimensions uniformly and then asking eight outcome
 * constraints to all hold at once succeeds roughly once in two hundred
 * tries -- 100 random trials in a row produced nothing at all -- so a cold
 * start spends its first few hundred trials merely locating the region, and
 * every front member after that descends from whichever one or two seeds it
 * stumbled on. Stage 7 recorded this same failure in almost the same words
 * ("no progress at all over 200 trials in four independent shards") and
 * fixed it the same way: start near an answer that already works, and keep
 * random sampling alongside it for exploration.
 *
 * The file is this line of work's own committed Pareto candidates, so nothing
 * is invented here; entries that do not satisfy the constraints (the shipped
 * default, the pre-fix baseline) are simply skipped.
 */
function seedFront(world, args, evaluate) {
  const file = args.seedFrom || path.join(args.world, "sea-ice-candidates.json");
  if (!existsSync(file)) return [];
  let entries;
  try {
    entries = JSON.parse(readFileSync(file, "utf8")).entries || [];
  } catch {
    console.log(`could not read seeds from ${file}; starting cold`);
    return [];
  }
  const seeded = [];
  for (const entry of entries) {
    if (!entry.params) continue;
    const p = {};
    for (const n of NAMES) {
      const [lo, hi] = SPACE[n];
      const v = entry.params[n];
      p[n] = v === undefined ? evaluate.base.values[n] : Math.min(hi, Math.max(lo, v));
    }
    const c = evaluate.run(p);
    if (c.valid) seeded.push(c);
  }
  console.log(`seeded ${seeded.length} of ${entries.length} candidates from ${path.basename(file)}`);
  return seeded;
}

function search(world, args) {
  const evaluate = makeEvaluator(world, args.step);
  const outPath = args.out || path.join(process.cwd(), `search-seaice-shard${args.shard}.json`);
  const seed = (args.seed * 2654435761 + args.shard * 40503) >>> 0;
  const random = makeRandom(seed);

  // Two shards whose seeds differ by a small amount are two nearby *values*,
  // not two nearby positions on xorshift's cycle -- but nothing guarantees
  // they are far apart either, so each shard walks its own stream forward a
  // shard-dependent distance before the search starts. Cheap, and it removes
  // the question entirely.
  for (let i = 0; i < 1013 * (args.shard + 1); i++) random();

  let front = [];
  let trial = 0;
  let rejected = 0;
  let sinceImprovement = 0;
  let elapsedMs = 0;
  let bestHypervolume = 0;

  if (args.resume) {
    const cp = loadCheckpoint(outPath);
    if (cp) {
      front = cp.front; trial = cp.trial; rejected = cp.rejected || 0;
      sinceImprovement = cp.sinceImprovement || 0; elapsedMs = cp.elapsedMs || 0;
      bestHypervolume = cp.bestHypervolume || hypervolume(front);
      console.log(`resumed shard ${args.shard} from ${outPath}: trial ${trial}, front ${front.length}`);
    }
  }

  // A fresh run starts from the committed candidates; a resumed one already
  // has its own front and must not have them injected a second time.
  if (!front.length) {
    for (const c of seedFront(world, args, evaluate)) {
      if (front.some((f) => dominates(f, c) || tooClose(f.params, c.params))) continue;
      for (let i = front.length - 1; i >= 0; i--) if (dominates(c, front[i])) front.splice(i, 1);
      front.push(c);
    }
    bestHypervolume = hypervolume(front);
  }

  const start = Date.now();
  const deadlineMs = args.hours * 3600 * 1000;
  let lastCheckpoint = Date.now();

  while (true) {
    if (trial >= args.trials) { console.log(`shard ${args.shard}: stopping at trial cap ${args.trials}`); break; }
    if (elapsedMs + (Date.now() - start) >= deadlineMs) { console.log(`shard ${args.shard}: stopping at ${args.hours}h wall clock`); break; }
    if (sinceImprovement >= args.patience) { console.log(`shard ${args.shard}: stopping at patience ${args.patience}`); break; }

    const p = (front.length && random() < 0.55)
      ? jitter(random, front[Math.floor(random() * front.length)].params, 0.10)
      : sample(random);
    const c = evaluate.run(p);
    trial++;

    // Only trials that actually got past the hard constraints count toward
    // patience. With the audit's revised guards about seven trials in ten are
    // rejected, so counting them would make "500 trials with no improvement"
    // mean roughly 150 real attempts -- and a shard could then stop before it
    // had found anything at all. The trial cap and the wall clock still bound
    // a run that is rejecting everything.
    if (!c.valid) { rejected++; }
    else { sinceImprovement++; }

    if (c.valid && !front.some((f) => dominates(f, c))) {
      for (let i = front.length - 1; i >= 0; i--) if (dominates(c, front[i])) front.splice(i, 1);
      if (!front.some((f) => tooClose(f.params, c.params))) {
        front.push(c);
        while (front.length > args.keep) dropMostCrowded(front);
        // Only a real gain in coverage counts as progress; see hypervolume().
        const hv = hypervolume(front);
        if (hv > bestHypervolume * (1 + HYPERVOLUME_EPSILON)) {
          bestHypervolume = hv;
          sinceImprovement = 0;
        }
      }
    }

    if (Date.now() - lastCheckpoint > 10000) {
      saveCheckpoint(outPath, {
        shard: args.shard, trial, rejected, sinceImprovement, bestHypervolume,
        constraints: CONSTRAINTS, space: SPACE,
        elapsedMs: elapsedMs + (Date.now() - start), front,
      });
      lastCheckpoint = Date.now();
      console.log(`shard ${args.shard}: trial ${trial}/${args.trials}, front ${front.length}, rejected ${rejected}`);
    }
  }
  saveCheckpoint(outPath, {
    shard: args.shard, trial, rejected, sinceImprovement, bestHypervolume,
    constraints: CONSTRAINTS, space: SPACE,
    elapsedMs: elapsedMs + (Date.now() - start), front,
  });
  console.log(`shard ${args.shard} done: trial ${trial}, front ${front.length}, rejected ${rejected}. Wrote ${outPath}`);
}

function merge(files, keep) {
  let all = [];
  for (const f of files) all.push(...JSON.parse(readFileSync(f, "utf8")).front);
  all.sort((x, y) => y.a - x.a);
  const front = [];
  for (const c of all) {
    if (front.some((f) => dominates(f, c))) continue;
    for (let i = front.length - 1; i >= 0; i--) if (dominates(c, front[i])) front.splice(i, 1);
    if (front.some((f) => tooClose(f.params, c.params))) continue;
    front.push(c);
  }
  front.sort((x, y) => y.a - x.a);
  return front.slice(0, keep);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.merge.length) {
    const front = merge(args.merge, args.keep);
    console.log(JSON.stringify({ mergedFrom: args.merge, front }, null, 1));
    return;
  }
  const world = loadWorld(args.world);
  search(world, args);
}

main();
