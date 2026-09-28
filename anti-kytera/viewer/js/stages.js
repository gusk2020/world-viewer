// v2 stages: assembles the stage modules around one shared state, and is
// the only stage module main.js talks to.
//
//   stage-data.js     loading, raw (F) and drawing (D) arrays, ice/sea/veg judgement
//   stage-respond.js  the stages at other sea levels and mean temperatures
//   stage-draw.js     palette and the one colour function used by 3D and 2D
//   stage-panel.js    legend/notes and the centre readout
// (グレートジャーニー mode draws through the same colour function as stage
// "journey"; its model and controls are journey.js / journey-ui.js.)
//
// state: which stage (v), model/teacher/diff (src; teacher and diff exist on
// Earth at the base conditions only), vegetation style, and the display
// conditions: the sea level (applied to the colouring at once, per pixel),
// the mean-temperature offset dT and the land share (set by setConditions,
// which also recomputes the fields), and the 2D water opacity. The model
// side is always 地球適合, the adopted estimate.
import { loadStageData } from "./stage-data.js";
import { createStageDraw, colourScale, BED_LO, BED_HI } from "./stage-draw.js";
import { createStagePanel } from "./stage-panel.js";
import { createResponder, loadRules } from "./stage-respond.js";

// options.bedRange: the relief colour range for 岩盤/海/標高色 (Earth keeps
// -8000..6000); options.processing: the terrain record from config.json.
export async function loadStages(base, planetary = false, { bedRange = [BED_LO, BED_HI], processing = null, obliquity = 23.44, rulesUrl = "./rules/response_rules.json" } = {}) {
  const [data, rules] = await Promise.all([loadStageData(base, planetary), loadRules(rulesUrl)]);
  // dT: mean temperature minus the base 14 C; landShare: set when off base.
  const state = { v: "bed", src: "model", seaLevel: 0, dT: 0, opacity: 0.4, vegStyle: "detailed", landShare: null };
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
    atBase: responder.atBase,
  };
  const draw = createStageDraw(ctx);
  const panel = createStagePanel(ctx);
  return {
    bedRange,
    state,
    apply: draw.apply,
    atBase: responder.atBase,
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
    bedMetresAt: (lng, lat) => data.bilinear("bed", lng, lat),   // the stage mesh's shape (drawing copy)
    // グレートジャーニー: the fields at the current conditions (journey.js reads
    // them, never writes), and the journey shown by the "journey" stage.
    journeyInputs: () => ({ fields: data.F, radiusMetres: data.S.bodyRadiusMetres || 6.371e6, seaLevel: responder.conditions().sea }),
    setJourney: draw.setJourney,
    setJourneyTime: draw.setJourneyTime,
    setJourneyFill: draw.setJourneyFill,
  };
}
