// v2 stages: assembles the three stage modules around one shared state, and
// is the only stage module main.js talks to.
//
//   stage-data.js   loading, raw (F) and drawing (D) arrays, ice/sea/veg judgement
//   stage-draw.js   palette and the one colour function used by 3D and 2D
//   stage-panel.js  legend/notes and the centre readout (元データ値)
//
// state: which stage (v), model/teacher/diff (src; teacher and diff exist on
// Earth only), mode (always "fit": 地球適合 is the adopted estimate), and
// the two display conditions that reach the colouring -- the sea level (the
// sea surface wins where it disagrees with the 0 m estimates) and the water
// opacity (2D tint). The mean-temperature slider reaches nothing here: every
// estimate is for present conditions and a 0 m sea, which main.js says on
// screen whenever a slider moves away from them.
import { loadStageData } from "./stage-data.js";
import { createStageDraw, colourScale, BED_LO, BED_HI } from "./stage-draw.js";
import { createStagePanel } from "./stage-panel.js";
import { createResponder, loadRules } from "./stage-respond.js";

// options.bedRange: the relief colour range for 岩盤/海/標高色 (Earth keeps
// -8000..6000); options.processing: the terrain record from config.json.
export async function loadStages(base, planetary = false, { bedRange = [BED_LO, BED_HI], processing = null, obliquity = 23.44, rulesUrl = "./rules/response_rules.json" } = {}) {
  const [data, rules] = await Promise.all([loadStageData(base, planetary), loadRules(rulesUrl)]);
  // dT: mean temperature minus the base 14 C; landShare: set when off base.
  const state = { v: "bed", src: "model", mode: "fit", seaLevel: 0, dT: 0, opacity: 0.4, vegStyle: "detailed", landShare: null };
  // Must come before the drawing: it swaps the fields for writable copies
  // that the textures and the readout then share.
  const responder = createResponder(data, rules, data.S.bodyRadiusMetres || 6.371e6, obliquity);
  const ctx = {
    ...data,
    state,
    bedRange,
    processing,
    drawnComposite: (which, lng, lat) => data.drawnComposite(which, lng, lat, state.seaLevel),
    isClimate: () => ["t2m", "hum", "precip", "ice"].includes(state.v),
    vm: () => data.S.vars[state.v],
    scale: () => colourScale(data.S, state),
    atBase: () => responder.atBase(),
  };
  const draw = createStageDraw(ctx);
  const panel = createStagePanel(ctx);
  return {
    hasTeacher: data.hasTeacher,
    bedRange,
    processing,
    state,
    apply: draw.apply,
    atBase: () => responder.atBase(),
    // Move the stages to new conditions (sea level in m, mean temperature
    // offset in K). Recomputes only when they actually changed.
    setConditions(sea, dT) {
      const c = responder.conditions();
      if (c.sea === sea && c.dT === dT) return null;
      const r = responder.update(sea, dT);
      state.dT = dT; state.landShare = r.landShare;
      draw.refreshFields();
      draw.apply();
      return r;
    },
    createMaterial: draw.createMaterial,
    createElevationMaterial: draw.createElevationMaterial,
    renderMercator: draw.renderMercator,
    legend: panel.legend,
    readout: panel.readout,
    isClimate: ctx.isClimate,
    bedMetresAt: (lng, lat) => data.bilinear("bed", lng, lat),   // the stage mesh's shape (drawing copy)
    rawBed: (lng, lat) => data.cell("bed", lng, lat),              // readout in 標準 (committed value)
  };
}
