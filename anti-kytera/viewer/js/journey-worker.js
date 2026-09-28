// グレートジャーニー: the model (journey.js) run off the page's main thread,
// so the globe stays responsive while a journey is computed -- on a phone a
// journey on a small body takes several seconds. Same code, same numbers as
// running it in the page or in node (tools/journey_report.mjs).
//
// Messages: { id, kind: "env", inputs } -> { id, env } (a copy; the worker
// keeps its own for the runs), and { id, kind: "run", cell, seed } ->
// { id, journey }. Errors come back as { id, error }.
// 二集団（試作）: { id, kind: "twopop", inputs?, condition, weakLanguage,
// hybridization, sites, obs } -> { id, result } (frames transferred). inputs
// is sent only when the conditions changed; the grid is kept between runs.
import * as J from "./journey.js";
import * as TP from "./twopop.js";
import { makeEvaluator } from "./twopop-eval.js";

let env = null, tpGrid = null;
// typed arrays lose their .meta when posted, so fields arrive as { data, meta }
const unpack = (fields) => Object.fromEntries(Object.entries(fields).map(([k, { data, meta }]) => { data.meta = meta; return [k, data]; }));

self.onmessage = ({ data: m }) => {
  try {
    if (m.kind === "env") {
      env = J.buildEnvironment({ ...m.inputs, fields: unpack(m.inputs.fields) });
      self.postMessage({ id: m.id, env });
    } else if (m.kind === "twopop") {
      const t0 = performance.now();
      if (m.inputs) { tpGrid = TP.buildTwoPopGrid(J.buildEnvironment({ ...m.inputs, fields: unpack(m.inputs.fields) })); }
      const t1 = performance.now(), ev = makeEvaluator(m.obs);
      const r = TP.runTwoPop(tpGrid, { condition: m.condition, weakLanguage: m.weakLanguage, hybridization: m.hybridization, sites: m.sites, observe: ev.observe });
      const result = { ...r, summary: ev.summary(), ms: { grid: Math.round(t1 - t0), run: Math.round(performance.now() - t1) } };
      self.postMessage({ id: m.id, result }, r.frames.map((f) => f.buffer));
    } else if (m.kind === "run") {
      const journey = J.runJourney(env, m.cell, m.seed);
      self.postMessage({ id: m.id, journey },
        [journey.arrival.buffer, journey.settleStart.buffer, journey.settleEnd.buffer, journey.parent.buffer]);
    }
  } catch (e) {
    self.postMessage({ id: m.id, error: String(e && e.message || e) });
  }
};
