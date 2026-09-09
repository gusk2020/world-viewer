// Automatic parameter search for the climate colouring (Stage 7).
//
// The user's rule for this stage is explicit: **Claude writes the search
// program; Claude does not run thousands of trials by inference.** So this is
// an ordinary program. It consumes no conversation while it runs, it
// checkpoints often enough that killing it loses at most a few seconds, and it
// stops on whichever of the three limits it reaches first: six hours, ten
// thousand trials, or five hundred trials with no improvement.
//
// It optimises `scoreAgainstTeacher(...).score` from js/climate.js -- the same
// function the app shows on the phone and the same one tools/score_climate.mjs
// reports, so there is exactly one definition of "better".
//
//   node tools/search_climate.mjs [worlds/kasoku-sekai] [options]
//     --trials N     stop after N evaluations (default 10000)
//     --hours H      stop after H hours (default 6)
//     --patience N   stop after N trials with no new best (default 500)
//     --step N       score every Nth pixel (default 2; 1 is the full raster)
//     --seed N       random seed, so a run is reproducible
//     --keep N       how many top sets to carry in the checkpoint (default 20)
//     --out FILE     checkpoint path (default ./search-<world>.json)
//     --resume       continue from that checkpoint instead of starting over
//     --screen       measure each parameter's influence and stop (see below)
//     --pin NAME=V   hold a parameter at V and search the rest. For asking
//                    what a mechanism costs when the search is not allowed to
//                    switch it off -- which is the only way to tell "this does
//                    not help" from "the objective cannot see it".
//     --merge A B .. combine finished checkpoints and print the top sets
//
// The algorithm is a (mu + lambda) evolutionary search with per-parameter step
// sizes that adapt as it goes. Chosen over a plain grid because twenty
// dimensions make a grid hopeless, and over anything heavier (a Gaussian
// process, say) because it has no dependencies, restarts trivially from a
// checkpoint, and this objective is cheap enough -- about a quarter of a
// second -- that the sample efficiency of a fancier method buys little.
import { readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readPng } from "./png.mjs";
import {
  CLIMATE_PARAMETERS,
  computeClimate,
  computeGeography,
  resolveClimateParams,
  resolveClimateSets,
  scoreAgainstTeacher,
  searchableParameters,
} from "../js/climate.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoPath = (url) => path.join(REPO, url.replace(/^\.\//, ""));

// ---------------------------------------------------------------------------
// A seeded generator, so a run can be repeated exactly and two shards can be
// given genuinely different streams. Math.random() offers neither.
// ---------------------------------------------------------------------------
function makeRandom(seed) {
  let state = (seed >>> 0) || 1;
  const next = () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5; state >>>= 0;
    return state / 4294967296;
  };
  // Box-Muller, for the mutation steps.
  return {
    next,
    normal() {
      const u = Math.max(next(), 1e-12);
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
    },
  };
}

function parseArgs(argv) {
  const out = {
    world: "worlds/kasoku-sekai", trials: 10000, hours: 6, patience: 500,
    step: 2, seed: 1, keep: 20, out: null, resume: false, screen: false, merge: [], pin: {},
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--resume") out.resume = true;
    else if (a === "--screen") out.screen = true;
    else if (a === "--merge") { while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) out.merge.push(argv[++i]); }
    else if (a === "--pin") { const [k, v] = argv[++i].split("="); out.pin[k] = Number(v); }
    else if (a === "--trials") out.trials = Number(argv[++i]);
    else if (a === "--hours") out.hours = Number(argv[++i]);
    else if (a === "--patience") out.patience = Number(argv[++i]);
    else if (a === "--step") out.step = Number(argv[++i]);
    else if (a === "--seed") out.seed = Number(argv[++i]);
    else if (a === "--keep") out.keep = Number(argv[++i]);
    else if (a === "--out") out.out = argv[++i];
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else out.world = a;
  }
  return out;
}

function loadWorld(worldDir) {
  const config = JSON.parse(readFileSync(path.join(worldDir, "config.json"), "utf8"));
  const level = config.terrain.levels.reduce((a, b) => (b.width > a.width && b.width <= 2048 ? b : a));
  const png = readPng(repoPath(level.url));
  const offset = config.terrain.encoding.offsetMetres;
  const metres = new Int16Array(png.width * png.height);
  for (let i = 0; i < metres.length; i++) {
    metres[i] = png.data[i * 3] * 256 + png.data[i * 3 + 1] - offset;
  }
  const elevation = { width: png.width, height: png.height, metres };

  const spec = config.teacher;
  const era = spec.eras.find((e) => e.id === spec.default) || spec.eras[0];
  const map = readPng(repoPath(era.map));
  const teacher = { width: map.width, height: map.height, data: map.data };

  // The land mask and the coarse height grid depend on the elevation raster
  // and the sea level, never on the parameters, so they come out of the trial
  // loop entirely -- that is what computeGeography exists for.
  const geography = computeGeography({
    elevation, seaLevelMetres: 0, radiusMetres: config.body.radiusMetres,
  });
  return { config, elevation, teacher, geography, era };
}

// ---------------------------------------------------------------------------
// One evaluation. Everything the search does goes through here, so the thing
// being optimised is provably the thing the app draws and the phone reports.
// ---------------------------------------------------------------------------
function makeEvaluator(world, step, pinnedValues = {}) {
  const { config, elevation, teacher, geography } = world;
  const base = resolveClimateSets(config).sets[0];
  const body = config.body;
  let count = 0;
  return {
    base,
    get count() { return count; },
    run(overrides) {
      count++;
      const params = { ...base.values, ...overrides, ...pinnedValues };
      const climate = computeClimate({
        elevation, seaLevelMetres: 0,
        axialTiltDegrees: body.axialTiltDegrees, radiusMetres: body.radiusMetres,
        dayLengthHours: body.dayLengthHours, rotationDirection: body.rotationDirection,
        params, geography,
      });
      return scoreAgainstTeacher({
        elevation, climate, teacher, seaLevelMetres: 0, params, step,
      });
    },
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------------------
// The screening pass the user asked for before the real search: "事前に小規模
// 探索を行い、無意味な探索範囲を削ってください". Each parameter is moved on its
// own across its range while the rest stay put, and the swing in the score is
// how much that parameter is worth. A term that moves nothing is a term the
// search would spend trials on for no reason.
// ---------------------------------------------------------------------------
function screen(world, evaluate) {
  const params = searchableParameters();
  const baseline = evaluate.run({});
  const rows = [];
  console.log(`baseline score ${baseline.score.toFixed(4)} (mean IoU ${(100 * baseline.meanIou).toFixed(2)}%)`);
  console.log("");
  console.log("  parameter                    worst    best   swing   best value");
  for (const p of params) {
    let best = { score: Infinity, value: null };
    let worst = -Infinity;
    // Five points across the range, plus where it sits today.
    const probes = [0, 0.25, 0.5, 0.75, 1].map((t) => p.min + t * (p.max - p.min));
    probes.push(evaluate.base.values[p.name]);
    for (const value of probes) {
      const r = evaluate.run({ [p.name]: value });
      if (r.score < best.score) best = { score: r.score, value };
      if (r.score > worst) worst = r.score;
    }
    rows.push({ name: p.name, best: best.score, worst, swing: worst - best.score, at: best.value });
  }
  rows.sort((a, b) => b.swing - a.swing);
  for (const r of rows) {
    console.log(
      `  ${r.name.padEnd(26)} ${r.worst.toFixed(4)}  ${r.best.toFixed(4)}  ` +
      `${r.swing.toFixed(4)}   ${Number(r.at.toFixed(3))}`
    );
  }
  console.log("");
  console.log(`${evaluate.count} evaluations`);
  return rows;
}

// ---------------------------------------------------------------------------
// The search itself.
// ---------------------------------------------------------------------------
function search(world, evaluate, args) {
  const pinned = args.pin || {};
  const params = searchableParameters().filter((p) => !(p.name in pinned));
  if (Object.keys(pinned).length) {
    console.log(`pinned: ${Object.entries(pinned).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  }
  const random = makeRandom(args.seed);
  const outPath = args.out || path.join(process.cwd(), `search-${world.config.id}.json`);

  // A candidate is a plain object of overrides. The population is the mu best
  // seen; each generation makes lambda children from them.
  const MU = 8;
  const LAMBDA = 16;
  // Step size, as a fraction of each parameter's range, adapted as the search
  // goes. **This started at 0.25 and the search made no progress at all over
  // 200 trials in four independent shards** -- with twenty dimensions, moving
  // every one of them a quarter of its range makes each child an essentially
  // random point, so nothing is ever a small improvement on its parent. The
  // two fixes are below and they belong together.
  let sigma = 0.08;
  const SIGMA_MIN = 0.005;
  const SIGMA_MAX = 0.3;
  // Only a few parameters move per child. In high dimensions this is what
  // makes a local step local: mutating all twenty at once is a jump, and a
  // jump can only be accepted or rejected, never followed.
  const MUTATE_FRACTION = 0.25;
  // The step shrinks quickly once it finds a basin, and then the search is
  // just polishing one point with most of its budget unspent. When it has
  // gone a quarter of the patience with nothing to show, the step is
  // re-inflated and the population reseeded around the best -- a restart, not
  // a stop. The user's three stopping conditions still decide when it ends.
  const RESTART_AFTER = Math.max(50, Math.round(args.patience / 4));

  let state = {
    world: world.config.id, era: world.era.id, seed: args.seed, step: args.step,
    trials: 0, startedAt: new Date().toISOString(), elapsedMs: 0,
    baseline: null, best: null, top: [], sigma, stopped: null,
  };
  if (args.resume && existsSync(outPath)) {
    state = JSON.parse(readFileSync(outPath, "utf8"));
    sigma = state.sigma || sigma;
    console.log(`resuming from ${outPath} at trial ${state.trials}, best ${state.best.score.toFixed(4)}`);
  }

  const startedMs = Date.now() - (state.elapsedMs || 0);
  const deadline = startedMs + args.hours * 3600 * 1000;
  let sinceImprovement = 0;

  const record = (overrides, result) => {
    const entry = {
      score: result.score,
      meanIou: result.meanIou,
      classes: Object.fromEntries(
        Object.entries(result.classes).map(([k, v]) => [k, v.iou])
      ),
      landAccuracy: result.landAccuracy,
      regionPenalty: result.regionPenalty,
      trial: state.trials,
      params: overrides,
    };
    state.top.push(entry);
    state.top.sort((a, b) => a.score - b.score);
    // Keep the top N, but never two entries that are effectively the same
    // point -- a list of twenty copies of one optimum is worth one entry, and
    // Stage 8 wants a spread.
    const kept = [];
    for (const candidate of state.top) {
      if (kept.some((k) => distance(k.params, candidate.params, params) < 0.05)) continue;
      kept.push(candidate);
      if (kept.length >= args.keep) break;
    }
    state.top = kept;
    if (!state.best || result.score < state.best.score) {
      state.best = entry;
      sinceImprovement = 0;
      return true;
    }
    sinceImprovement++;
    return false;
  };

  const save = () => {
    state.sigma = sigma;
    state.elapsedMs = Date.now() - startedMs;
    // Written to a temporary file and renamed, so a kill in the middle of a
    // write cannot leave a truncated checkpoint behind.
    writeFileSync(`${outPath}.tmp`, JSON.stringify(state, null, 1));
    renameSync(`${outPath}.tmp`, outPath);
  };

  // Seed the population: where the model stands today, plus random points, so
  // the search can neither be trapped by the current answer nor lose it.
  let population = [];
  const seedTrial = (overrides) => {
    const r = evaluate.run(overrides);
    record(overrides, r);
    population.push({ overrides, score: r.score });
    state.trials++;
  };
  if (!state.top.length) {
    // What the model scores today, kept for comparison but not entered as a
    // candidate: one of its values (evaporationHalfC) sits outside the range
    // the search is allowed to use, and a "best" nobody may reproduce would be
    // worse than useless.
    const reference = evaluate.run({});
    state.baseline = { score: reference.score, meanIou: reference.meanIou };
    console.log(`the shipped parameters score ${reference.score.toFixed(4)} ` +
      `(mean IoU ${(100 * reference.meanIou).toFixed(2)}%)`);
    // The same point, pulled inside the search's own bounds: the honest
    // starting position, so the search can neither be trapped by today's
    // answer nor throw it away.
    const start = {};
    for (const p of params) start[p.name] = clamp(evaluate.base.values[p.name], p.min, p.max);
    seedTrial(start);
    // The rest of the population starts near that point rather than uniformly
    // at random. A population of random twenty-dimensional points is a
    // population of very bad points, and children drawn from them are worse
    // than useless -- two are still drawn at random so the search is not
    // simply a local polish of today's answer.
    for (let i = 0; i < MU - 1; i++) {
      const o = {};
      for (const p of params) {
        o[p.name] = i < 2
          ? p.min + random.next() * (p.max - p.min)
          : clamp(start[p.name] + random.normal() * 0.1 * (p.max - p.min), p.min, p.max);
      }
      seedTrial(o);
    }
  } else {
    population = state.top.slice(0, MU).map((e) => ({ overrides: e.params, score: e.score }));
  }
  population.sort((a, b) => a.score - b.score);

  let lastSave = Date.now();
  let lastReport = 0;
  while (true) {
    if (state.trials >= args.trials) { state.stopped = "trials"; break; }
    if (Date.now() >= deadline) { state.stopped = "hours"; break; }
    if (sinceImprovement >= args.patience) { state.stopped = "patience"; break; }

    let improved = false;
    const children = [];
    for (let i = 0; i < LAMBDA; i++) {
      const parent = population[Math.floor(random.next() * population.length)];
      const child = {};
      for (const p of params) {
        const from = parent.overrides[p.name] !== undefined
          ? parent.overrides[p.name] : evaluate.base.values[p.name];
        child[p.name] = random.next() < MUTATE_FRACTION
          ? clamp(from + random.normal() * sigma * (p.max - p.min), p.min, p.max)
          : from;
      }
      const r = evaluate.run(child);
      state.trials++;
      if (record(child, r)) improved = true;
      children.push({ overrides: child, score: r.score, parent: parent.score });
      if (state.trials >= args.trials) break;
    }

    // The 1/5th rule, in its usual plain form: if children are beating their
    // *own parents* often, the step is too small to be worth this much
    // caution; if they almost never are, it is too big. (Comparing against the
    // worst of the population instead, as this first did, is no test at all
    // while the population still holds a random point.)
    const better = children.filter((c) => c.score < c.parent).length;
    sigma = clamp(better / children.length > 0.2 ? sigma * 1.15 : sigma * 0.9, SIGMA_MIN, SIGMA_MAX);

    population = [...population, ...children].sort((a, b) => a.score - b.score).slice(0, MU);

    if (sinceImprovement > 0 && sinceImprovement % RESTART_AFTER === 0 && sigma < 0.03) {
      sigma = 0.08;
      state.restarts = (state.restarts || 0) + 1;
      population = [{ overrides: state.best.params, score: state.best.score }];
      for (let i = 1; i < MU; i++) {
        const o = {};
        for (const p of params) {
          o[p.name] = clamp(
            state.best.params[p.name] + random.normal() * 0.12 * (p.max - p.min), p.min, p.max
          );
        }
        const r = evaluate.run(o);
        state.trials++;
        record(o, r);
        population.push({ overrides: o, score: r.score });
      }
      population.sort((a, b) => a.score - b.score);
    }

    if (Date.now() - lastSave > 10000 || improved) { save(); lastSave = Date.now(); }
    if (state.trials - lastReport >= 200) {
      lastReport = state.trials;
      const mins = ((Date.now() - startedMs) / 60000).toFixed(1);
      console.log(
        `trial ${state.trials}  best ${state.best.score.toFixed(4)} ` +
        `(IoU ${(100 * state.best.meanIou).toFixed(2)}%)  sigma ${sigma.toFixed(3)}  ` +
        `${sinceImprovement} since improvement  ${mins} min`
      );
    }
  }

  save();
  console.log("");
  console.log(`stopped on ${state.stopped} after ${state.trials} trials, ` +
    `${((Date.now() - startedMs) / 60000).toFixed(1)} min`);
  console.log(`best score ${state.best.score.toFixed(4)} (mean IoU ${(100 * state.best.meanIou).toFixed(2)}%) ` +
    `found at trial ${state.best.trial}`);
  console.log(`${state.top.length} distinct sets kept in ${outPath}`);
  return state;
}

// Normalised distance between two candidates, used to keep the top list
// genuinely varied rather than twenty copies of one point.
function distance(a, b, params) {
  let total = 0;
  for (const p of params) {
    const span = p.max - p.min;
    total += ((a[p.name] - b[p.name]) / span) ** 2;
  }
  return Math.sqrt(total / params.length);
}

function merge(files, keep) {
  const params = searchableParameters();
  let all = [];
  for (const file of files) {
    const state = JSON.parse(readFileSync(file, "utf8"));
    all = all.concat(state.top.map((e) => ({ ...e, from: path.basename(file) })));
  }
  all.sort((a, b) => a.score - b.score);
  const kept = [];
  for (const candidate of all) {
    if (kept.some((k) => distance(k.params, candidate.params, params) < 0.05)) continue;
    kept.push(candidate);
    if (kept.length >= keep) break;
  }
  console.log(JSON.stringify({ kept: kept.length, top: kept }, null, 1));
  return kept;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.merge.length) { merge(args.merge, args.keep); return; }

  const world = loadWorld(path.join(REPO, args.world));
  const evaluate = makeEvaluator(world, args.step, args.pin);
  if (args.screen) { screen(world, evaluate); return; }
  search(world, evaluate, args);
}

main()
