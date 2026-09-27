// v2 stages: assembles the three stage modules around one shared state, and
// is the only stage module main.js talks to.
//
//   stage-data.js   loading, raw (F) and drawing (D) arrays, ice/sea/veg judgement
//   stage-draw.js   palette and the one colour function used by 3D and 2D
//   stage-panel.js  legend/notes and the centre readout (元データ値)
//
// state: which stage (v), model/teacher/diff (src), fit/holdout (mode), and
// the two display conditions that reach the colouring -- the sea level (the
// sea surface wins where it disagrees with the 0 m estimates) and the water
// opacity (2D tint). The mean-temperature slider reaches nothing here: every
// estimate is for present conditions and a 0 m sea, which main.js says on
// screen whenever a slider moves away from them.
import { loadStageData } from "./stage-data.js";
import { createStageDraw, colourScale } from "./stage-draw.js";
import { createStagePanel } from "./stage-panel.js";

export async function loadStages(base, planetary = false) {
  const data = await loadStageData(base, planetary);
  const state = { v: "bed", src: "model", mode: "fit", seaLevel: 0, opacity: 0.4, vegStyle: "detailed" };
  const ctx = {
    ...data,
    state,
    drawnComposite: (which, lng, lat) => data.drawnComposite(which, lng, lat, state.seaLevel),
    isClimate: () => ["t2m", "hum", "precip", "ice"].includes(state.v),
    vm: () => data.S.vars[state.v],
    scale: () => colourScale(data.S, state),
  };
  const draw = createStageDraw(ctx);
  const panel = createStagePanel(ctx);
  return {
    hasTeacher: data.hasTeacher,
    state,
    apply: draw.apply,
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
