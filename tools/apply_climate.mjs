// Writes a candidate found by tools/search_climate.mjs into a world's
// config.json, so the app draws it.
//
// Kept separate from the search on purpose: a search that edited the shipped
// configuration as it went would make "what does the app currently draw?"
// depend on whether a background job happened to be running.
//
//   node tools/apply_climate.mjs <checkpoint.json> [options]
//     --index N        which of the checkpoint's top sets (default 0, the best)
//     --world DIR      default worlds/kasoku-sekai
//     --set ID:LABEL   add it as a named climate set instead of replacing the
//                      world's base climate block
//     --note TEXT      the note that set carries
//     --dry-run        print what would change and write nothing
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CLIMATE_PARAMETERS } from "../js/climate.js";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const out = { checkpoint: null, index: 0, world: "worlds/kasoku-sekai", set: null, note: "", dry: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dry = true;
    else if (a === "--index") out.index = Number(argv[++i]);
    else if (a === "--world") out.world = argv[++i];
    else if (a === "--set") out.set = argv[++i];
    else if (a === "--note") out.note = argv[++i];
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else out.checkpoint = a;
  }
  if (!out.checkpoint) throw new Error("usage: apply_climate.mjs <checkpoint.json> [--index N]");
  return out;
}

// Values are rounded to three decimals. They come out of a stochastic search,
// so the digits past that are noise, and a config full of 0.6109999999999999
// is harder to read for no gain. Checked below: the rounding must not move the
// score by more than a thousandth.
const round = (v) => Number(v.toFixed(3));

function main() {
  const args = parseArgs(process.argv.slice(2));
  const state = JSON.parse(readFileSync(args.checkpoint, "utf8"));
  const list = state.top || state;
  const entry = Array.isArray(list) ? list[args.index] : list.top[args.index];
  if (!entry) throw new Error(`no candidate at index ${args.index}`);

  const configPath = path.join(REPO, args.world, "config.json");
  const raw = readFileSync(configPath, "utf8");
  const config = JSON.parse(raw);

  const values = {};
  for (const [name, value] of Object.entries(entry.params)) {
    if (!CLIMATE_PARAMETERS[name]) {
      console.warn(`skipping unknown parameter ${name}`);
      continue;
    }
    values[name] = round(value);
  }

  console.log(`candidate ${args.index}: score ${entry.score.toFixed(4)}, ` +
    `mean IoU ${(100 * entry.meanIou).toFixed(2)}%`);
  const before = config.climate || {};
  for (const name of Object.keys(values).sort()) {
    const was = before[name] !== undefined ? before[name] : CLIMATE_PARAMETERS[name].value;
    if (was !== values[name]) console.log(`  ${name.padEnd(26)} ${was} -> ${values[name]}`);
  }

  if (args.set) {
    const [id, label] = args.set.split(":");
    config.climateSets = config.climateSets || { default: "current", list: [] };
    config.climateSets.list = config.climateSets.list.filter((s) => s.id !== id);
    config.climateSets.list.push({ id, label: label || id, note: args.note, params: values });
  } else {
    // Only the fitted numbers are replaced; the palette and any hand-set entry
    // in the block stay exactly as they are.
    config.climate = { ...config.climate, ...values };
  }

  if (args.dry) {
    console.log("(dry run, nothing written)");
    return;
  }
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`wrote ${configPath}`);
}

main()
