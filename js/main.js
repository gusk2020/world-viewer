import { initGlobe3D } from "./globe3d.js";
import { initMap2D } from "./map2d.js";
// Climate v1 preview -- EXPERIMENTAL. This is the first time the app imports
// anything from js/climate-v1/, and it is deliberately one-way: nothing in
// the existing 地表 colouring calls into it, and with the preview switched
// off not a line of it runs.
import { buildTerrainField } from "./climate-v1/terrain.js";
import { buildClimateV1Preview, PREVIEW_GRID } from "./climate-v1/preview.js";
import { EVAPORATIVE_COOLING_PREVIEW_C } from "./climate-v1/evaporative-cooling.js";
import { buildOracleWind } from "./climate-v1/oracle-wind.js";
import { CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION } from "./climate-v1/earth-temperature-calibration.js";
import {
  SEASONAL_TIME_AXIS, buildSeasonalTemperatureTable, buildTemperatureFieldAtPhase,
} from "./climate-v1/season.js";
import { resolveClimateSets } from "./climate.js";

// Which worlds exist, and which one opens first. Everything else about a
// world -- its radius, its terrain data, its colours, its sea-level range --
// lives in that world's own config.json, so adding a body is adding data.
const WORLD_INDEX_URL = "./worlds/index.json";

async function main() {
  const index = await (await fetch(WORLD_INDEX_URL)).json();

  const appEl = document.getElementById("app");
  const map2dEl = document.getElementById("map2d");
  const toggleButton = document.getElementById("view-toggle");
  const controlPanel = document.getElementById("sea-level-control");
  const seaLevelLabel = document.getElementById("sea-level-label");
  const seaLevelSlider = document.getElementById("sea-level-slider");
  const seaLevelReadout = document.getElementById("sea-level-readout");
  const waterOpacitySlider = document.getElementById("water-opacity-slider");
  const waterOpacityReadout = document.getElementById("water-opacity-readout");
  const seabedRow = document.getElementById("seabed-row");
  const surfaceRow = document.getElementById("surface-row");
  const climateSetRow = document.getElementById("climate-set-row");
  const climateSetButtons = document.getElementById("climate-set");
  const teacherButton = document.getElementById("teacher-button");
  const climateTempRow = document.getElementById("climate-temp-row");
  const climateTempSlider = document.getElementById("climate-temp-slider");
  const climateTempReadout = document.getElementById("climate-temp-readout");
  const climateScoreLine = document.getElementById("climate-score");
  const climateCompareLine = document.getElementById("climate-compare-score");
  const axisRow = document.getElementById("axis-row");
  const axisButton = document.getElementById("axis-toggle");
  const axisReadout = document.getElementById("axis-readout");
  const graticuleButton = document.getElementById("graticule-toggle");
  const scaleBar = document.getElementById("scale-bar");
  const scaleBarLine = document.getElementById("scale-bar-line");
  const scaleBarLabel = document.getElementById("scale-bar-label");
  const climateV1Row = document.getElementById("climatev1-row");
  const climateV1Options = document.getElementById("climatev1-options");
  const climateV1Readout = document.getElementById("climatev1-readout");
  const seasonRow = document.getElementById("season-row");
  const seasonPrev = document.getElementById("season-prev");
  const seasonNext = document.getElementById("season-next");
  const seasonPlay = document.getElementById("season-play");
  const seasonSlider = document.getElementById("season-phase");
  const worldCycleButton = document.getElementById("world-cycle");
  const virtualNote = document.getElementById("virtual-sea-note");
  const loading = document.getElementById("loading");

  // The 2D map is created lazily, the first time the user actually switches
  // to it -- OpenLayers measures its container's size at construction time,
  // and #map2d starts out hidden (display:none) since the app opens in 3D
  // mode; constructing it only once it's visible avoids that entirely,
  // rather than working around a 0x0-sized map.
  let map2d = null;
  let mode = "3d";

  let globe3d = null;
  let world = null;

  // A posture button, not just a tilt. Both of its positions put the body
  // back into the same reference pose -- equator horizontal and lng/lat 0,0
  // dead centre, facing the viewer -- and differ only in whether the spin
  // axis stands vertical or leans at the body's real obliquity (23.4 degrees
  // for Earth, 25.2 for Mars, 6.7 for the Moon, each from its own config and
  // measured against its own orbital plane). So one press straightens and
  // re-centres the globe however far it has been dragged, and a second press
  // tilts it from that same known pose.
  //
  // Zoom is deliberately left alone: how far in you are is not part of the
  // orientation, and throwing away a close-up view would make the button
  // annoying to press.
  let axisUpright = true;

  // Four states in a cycle, in the order the user asked for: press once for
  // parallels, again to add meridians, again for meridians alone, again to
  // clear them.
  // Short labels because these two controls share one row now; the row is
  // only ~350px wide on a phone.
  const GRATICULE_STATES = [
    { mode: "off", label: "なし" },
    { mode: "parallels", label: "緯度" },
    { mode: "both", label: "緯度+経度" },
    { mode: "meridians", label: "経度" },
  ];
  let graticuleIndex = 0;

  function applyMode() {
    appEl.hidden = mode !== "3d";
    map2dEl.hidden = mode !== "2d";
    // The sea-level and seabed controls only apply to the 3D view; the 2D
    // map has no sea-level concept.
    controlPanel.hidden = mode !== "3d";
    // The 天体 row stays reachable in 2D -- picking Mars from there is
    // meaningful, and switching away from Earth forces the view back to 3D.
    // The axis and graticule are 3D-only, so that row goes with the panel.
    // Hidden for now at the user's request. The tilt and graticule still work
    // and applyAxis/applyGraticule still run; only the row is off screen.
    axisRow.hidden = true;
    // The nav row stays in 2D -- that is where the 2D/3D button lives now --
    // so the panel itself does not hide; only its 3D-only rows do.
    // The preview paints the 3D globe, so it goes away with the 3D view --
    // same rule as the axis/graticule row beside it.
    climateV1Row.hidden = mode !== "3d" || !(globe3d && globe3d.supportsClimate);
    if (mode !== "3d") { climateV1Options.hidden = true; climateV1Readout.hidden = true; stopSeasonPlay(); seasonRow.hidden = true; }
    // The scale bar is derived from the 3D camera, so it would be quietly
    // wrong sitting on top of the 2D map -- which draws its own.
    scaleBar.hidden = mode !== "3d" || GRATICULE_STATES[graticuleIndex].mode === "off";
    toggleButton.textContent = mode === "3d" ? "2Dに切替" : "3Dに切替";
  }

  // The slider carries steps, not metres, because the two directions can
  // want very different resolution and an <input type="range"> only has one
  // step. On Earth, up is where the interesting numbers are close together
  // (every ice sheet melting is about +65 m) so it runs in 2 m steps, while
  // down spans the shelves and abyssal plains in 20 m steps. Mars and the
  // Moon have their own ranges in their own configs -- Earth's -6000 m
  // would be meaningless on a body whose relief is shaped nothing like it.
  function seaLevelSettings() {
    return world.config.display.seaLevel;
  }

  function seaLevelMetres() {
    const steps = Number(seaLevelSlider.value);
    const sea = seaLevelSettings();
    return steps * (steps >= 0 ? sea.upStepMetres : sea.downStepMetres);
  }

  function applySeaLevel() {
    const metres = seaLevelMetres();
    globe3d.setSeaLevel(metres);
    seaLevelReadout.textContent =
      metres === 0 ? "±0m" : `${metres > 0 ? "+" : ""}${metres}m`;
  }

  function applyWaterOpacity() {
    const percent = Number(waterOpacitySlider.value);
    globe3d.setWaterOpacity(percent / 100);
    waterOpacityReadout.textContent = `${percent}%`;
  }

  // Painting the surface -- bare rock or the climate model -- runs over every
  // pixel of the elevation raster, so let the pressed state paint first,
  // exactly as the seabed buttons do.
  const surfaceButtons = document.querySelectorAll("#surface-mode button");
  let surfaceMode = "standard";
  surfaceButtons.forEach((button) => {
    button.addEventListener("click", () => {
      surfaceMode = button.dataset.surface;
      if (v1Mode !== "off") { v1Mode = "off"; applyV1Buttons(); climateV1Options.hidden = true; climateV1Readout.hidden = true; stopSeasonPlay(); seasonRow.hidden = true; }
      applySurfaceButtons();
      requestAnimationFrame(() => {
        globe3d.setSurfaceMode(surfaceMode);
        applyClimateScore();
      });
    });
  });

  function applySurfaceButtons() {
    surfaceButtons.forEach((b) => b.classList.toggle("selected", b.dataset.surface === surfaceMode));
    // The climate sets only mean anything while the climate colouring is what
    // is on screen, so the row appears with it and goes away again. The user
    // has twice said the panel is too tall; a row that is only there when it
    // is useful costs nothing the rest of the time.
    const sets = globe3d && globe3d.supportsClimate ? globe3d.climateSets : [];
    const showsClimate = surfaceMode === "climate" && Boolean(globe3d && globe3d.supportsClimate);
    climateSetRow.hidden = !showsClimate || sets.length < 2;
    climateTempRow.hidden = true; // hidden for now, see loadWorld
    applyClimateScore();
    applyClimateCompareLine(climateSetRow.hidden ? null : globe3d.getClimateSet());
  }

  // ---------------------------------------------------------------------
  // Climate v1 preview (EXPERIMENTAL)
  //
  // A second, independent pipeline: terrain -> temperature -> humidity ->
  // wind -> moisture, with an experimental evaporative cooling that can be
  // switched on and off from the phone. It paints its own field onto the
  // globe through globe3d.showScalarField, so the 地表 colouring above is
  // untouched and pressing 標準 restores the photograph.
  //
  // Everything here is lazy: no mask is fetched and no field is computed
  // until 気温 or 湿度 is pressed for the first time.
  // ---------------------------------------------------------------------
  // One exclusive state for the whole preview: off, or one of the four
  // variable x source combinations. The two internal axes are derived from
  // it, so nothing downstream had to change.
  let v1Mode = "off";           // off | {temperature,humidity}-{model,teacher}
  let v1Cooling = "off";        // off | on
  let v1Wind = "model";         // model | observed
  let v1Teacher = null;         // { temperature, humidity } on the preview grid
  let v1TerrainField = null;    // built once per world
  let v1OracleWind = null;      // fetched once, only if 観測風 is asked for
  let v1Cache = new Map();      // "cooling|wind" -> preview
  let v1Busy = false;

  // --- the seasonal cycle (EXPERIMENTAL, temperature only) -----------------
  //
  // Everything here is a *display* of js/climate-v1/season.js: Stage 2's
  // annual field is never written to, no climate stage is re-run when the
  // phase moves, and the season table is built once per world. Humidity,
  // wind, ET, precipitation, soil water, snow, sea ice and vegetation are all
  // still annual means -- the row's own label says so, and the readout
  // repeats it, because a globe whose temperature moves with the year would
  // otherwise look like the whole model had become seasonal.
  const SEASON_PHASE_STEPS = 1440;     // slider steps per orbit; ~0.25 day on Earth
  const SEASON_NUDGE = SEASON_PHASE_STEPS / 24;   // what a press of the arrows moves
  const SEASON_PLAY_SECONDS = 12;      // one orbit per this many real seconds
  let v1Season = "annual";             // annual | seasonal
  let v1Phase = 0.25;                  // orbitalPhase in [0,1)
  let v1SeasonTable = null;            // rebuilt per world
  let v1PhaseBuffer = null;            // reused across phases, never the annual field
  let v1SeasonPreview = null;          // the preview the phase is drawn from
  let seasonPlayHandle = null;
  let seasonPlayLast = 0;
  const seasonButtons = document.querySelectorAll("#season-mode button");

  // The phase names are a *label*, not a model input: season.js knows only
  // orbitalPhase in [0,1), so nothing here can leak a calendar into the
  // physics. Phase 0 is season.js's own definition -- the ascending equinox.
  function seasonPhaseLabel(phase) {
    const marks = [
      [0, "春分（北半球）"], [0.25, "夏至（北半球）"], [0.5, "秋分（北半球）"], [0.75, "冬至（北半球）"],
    ];
    const near = marks.find(([p]) => Math.abs(((phase - p + 1.5) % 1) - 0.5) < 0.01);
    // A day number is honest here because it is derived from the phase and
    // the body's own year length, not from any month table.
    const yearDays = Number.isFinite(world.config.body.yearLengthDays)
      ? world.config.body.yearLengthDays : 365.2422;
    const day = Math.round(phase * yearDays);
    return `位相${phase.toFixed(3)}（${day}日目${near ? " " + near[1] : ""}）`;
  }

  // Built once per world, at the temperature field's own row count so the two
  // line up without resampling. 32 KB and about a tenth of a second.
  function ensureSeasonTable(rows) {
    if (v1SeasonTable && v1SeasonTable.rows === rows) return v1SeasonTable;
    v1SeasonTable = buildSeasonalTemperatureTable({ rows, body: world.config.body });
    return v1SeasonTable;
  }

  function stopSeasonPlay() {
    if (seasonPlayHandle !== null) cancelAnimationFrame(seasonPlayHandle);
    seasonPlayHandle = null;
    seasonPlay.textContent = "再生";
  }

  function applySeasonButtons() {
    seasonButtons.forEach((b) => b.classList.toggle("selected", b.dataset.season === v1Season));
    const seasonal = v1Season === "seasonal";
    seasonPrev.hidden = !seasonal;
    seasonNext.hidden = !seasonal;
    seasonPlay.hidden = !seasonal;
    seasonSlider.hidden = !seasonal;
    seasonSlider.value = String(Math.round(v1Phase * SEASON_PHASE_STEPS) % SEASON_PHASE_STEPS);
  }

  // Draw one phase. This is the whole per-frame cost: one pass adding a
  // row-constant anomaly to Stage 2's field, then the same texture repaint
  // every other preview view already does. No climate stage runs.
  function drawSeasonPhase(preview) {
    const t = preview.temperatureField;
    const values = buildTemperatureFieldAtPhase({
      temperatureField: t, terrainField: preview.terrainField,
      seasonTable: ensureSeasonTable(t.height), orbitalPhase: v1Phase, out: v1PhaseBuffer,
    });
    v1PhaseBuffer = values;
    globe3d.showScalarField({
      width: t.width, height: t.height, values, colourAt: temperatureColour,
    });
  }

  const v1Buttons = document.querySelectorAll("#climatev1-mode button");
  const v1CoolingButtons = document.querySelectorAll("#climatev1-cooling button");
  const v1WindButtons = document.querySelectorAll("#climatev1-wind button");
  const v1Variable = () => (v1Mode.startsWith("temperature") ? "temperature" : "humidity");
  const v1Source = () => (v1Mode.endsWith("teacher") ? "teacher" : "model");

  // Two small masks the Climate v1 land/sea rule already uses offline. Both
  // are paletted PNGs, and a canvas hands back colours rather than palette
  // indices, so each is matched by its own distinctive colour -- magenta for
  // Köppen's "no data" (i.e. ocean) and blue for water in the surface mask.
  async function loadMaskByColour(url, matches) {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`failed to load ${url}`));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const out = new Uint8Array(canvas.width * canvas.height);
    for (let i = 0; i < out.length; i++) {
      out[i] = matches(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) ? 1 : 0;
    }
    return { width: canvas.width, height: canvas.height, mask: out };
  }

  // The preview runs Climate v1 on a halved height raster. The pipeline's
  // fine-grid stages (the land/sea flood, the distance transform, temperature
  // and saturation) are all O(cells), so halving each side is roughly four
  // times faster -- measured 4.6 s -> 1.4 s in the browser -- and a preview
  // whose transport grid is 256x128 anyway cannot show the difference. It is
  // a preview setting, not a change to Climate v1: every command-line tool
  // still runs at the full 2048x1024.
  const V1_PREVIEW_WIDTH = 1024;

  function coarsenElevation(elevation, targetWidth) {
    const { width, height, metres } = elevation;
    if (width <= targetWidth) return { width, height, metres };
    const factor = Math.round(width / targetWidth);
    const w = Math.floor(width / factor), h = Math.floor(height / factor);
    const out = new Int16Array(w * h);
    const per = factor * factor;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0;
        for (let dy = 0; dy < factor; dy++) {
          const row = (y * factor + dy) * width + x * factor;
          for (let dx = 0; dx < factor; dx++) sum += metres[row + dx];
        }
        // Area-averaged, the same rule the terrain pipeline itself uses when
        // it builds a coarser level -- never point decimation, which drops
        // peaks and trenches outright.
        out[y * w + x] = Math.round(sum / per);
      }
    }
    return { width: w, height: h, metres: out };
  }

  async function ensureV1Terrain() {
    if (v1TerrainField) return v1TerrainField;
    const elevation = globe3d.getElevation();
    const config = world.config;
    let oceanMask = null, waterSurfaceMask = null;
    // Optional: without them Climate v1 falls back to connectivity alone,
    // which loses the Black Sea and the lakes but still works.
    try {
      if (config.teacherStructure && config.teacherStructure.map) {
        const m = await loadMaskByColour(config.teacherStructure.map, (r, g, b) => r > 200 && g < 60 && b > 200);
        oceanMask = { width: m.width, height: m.height, isOcean: m.mask, source: config.teacherStructure.map };
      }
    } catch (error) { console.warn("Climate v1: no ocean mask", error); }
    try {
      if (config.terrain.waterSurfaceMask) {
        const m = await loadMaskByColour(config.terrain.waterSurfaceMask, (r, g, b) => b > 128 && r < 128);
        waterSurfaceMask = { width: m.width, height: m.height, isWater: m.mask, source: config.terrain.waterSurfaceMask };
      }
    } catch (error) { console.warn("Climate v1: no water-surface mask", error); }
    v1TerrainField = buildTerrainField({
      elevationGrid: coarsenElevation(elevation, V1_PREVIEW_WIDTH),
      seaLevelMetres: elevation.seaLevelMetres,
      oceanMask, waterSurfaceMask,
    });
    return v1TerrainField;
  }

  // The observed wind is a DIAGNOSTIC teacher, never the model. It is only
  // downloaded if the user actually asks for 観測風.
  async function ensureV1OracleWind() {
    if (v1OracleWind) return v1OracleWind;
    const summary = await (await fetch("./worlds/kasoku-sekai/teacher/wind-summary.json")).json();
    const spec = summary.grids.level850hPa;
    const read = async (file) => new Float32Array(
      await (await fetch(`./worlds/kasoku-sekai/teacher/${file}`)).arrayBuffer()
    );
    const [u, v] = await Promise.all([read(spec.files.u), read(spec.files.v)]);
    v1OracleWind = buildOracleWind({
      u, v, width: spec.width, height: spec.height,
      latitudes: spec.latitudes, longitudes: spec.longitudes,
      targetWidth: PREVIEW_GRID.width, targetHeight: PREVIEW_GRID.height,
    });
    return v1OracleWind;
  }

  // The teacher fields, resampled onto the preview grid FOR DISPLAY ONLY --
  // the committed .bin files are read and never written. Same units and the
  // same colour ramp as the model, so the two can be compared by eye:
  // temperature in °C, humidity in g/kg.
  async function ensureV1Teacher() {
    if (v1Teacher) return v1Teacher;
    const dir = "./worlds/kasoku-sekai/teacher";
    const nearest = (axis, v, wrap) => {
      let best = 0, bd = Infinity;
      for (let i = 0; i < axis.length; i++) {
        let d = Math.abs(axis[i] - v);
        if (wrap) d = Math.min(d, 360 - d);
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    };
    const resample = (values, sw, sh, lats, lons) => {
      const out = new Float32Array(PREVIEW_GRID.width * PREVIEW_GRID.height);
      for (let y = 0; y < PREVIEW_GRID.height; y++) {
        const j = nearest(lats, 90 - ((y + 0.5) * 180) / PREVIEW_GRID.height);
        for (let x = 0; x < PREVIEW_GRID.width; x++) {
          const i = nearest(lons, -180 + ((x + 0.5) * 360) / PREVIEW_GRID.width, true);
          out[y * PREVIEW_GRID.width + x] = values[j * sw + i];
        }
      }
      return out;
    };
    const [tSummary, hSummary] = await Promise.all([
      (await fetch(`${dir}/temperature-summary.json`)).json(),
      (await fetch(`${dir}/humidity-summary.json`)).json(),
    ]);
    const tGrid = tSummary.grid;
    const tValues = new Float32Array(await (await fetch(`${dir}/${tGrid.valuesFile}`)).arrayBuffer());
    // A plain 1-degree cell-centred grid; its own summary states row 0 is the
    // north pole's cell centre and column 0 is about -179.5.
    const tLats = Array.from({ length: tGrid.height }, (_, j) => 90 - (j + 0.5) * (180 / tGrid.height));
    const tLons = Array.from({ length: tGrid.width }, (_, i) => -180 + (i + 0.5) * (360 / tGrid.width));
    const hGrid = hSummary.grids.specificHumidityKgPerKg;
    const hValues = new Float32Array(await (await fetch(`${dir}/${hGrid.file}`)).arrayBuffer());
    const hLons = hGrid.longitudes.map((l) => (l > 180 ? l - 360 : l));
    const humidity = resample(hValues, hGrid.width, hGrid.height, hGrid.latitudes, hLons);
    for (let i = 0; i < humidity.length; i++) humidity[i] *= 1000; // kg/kg -> g/kg
    v1Teacher = {
      temperature: resample(tValues, tGrid.width, tGrid.height, tLats, tLons),
      humidity,
    };
    return v1Teacher;
  }

  const V1_REGIONS = [
    ["アマゾン", -70, -55, -8, 2], ["コンゴ", 15, 28, -5, 5],
    ["インドネシア", 100, 130, -8, 6], ["サハラ", -8, 28, 18, 28],
  ];

  // The same four regions, read off two coarse fields. Used for the teacher,
  // where there is no preview object to read a fine temperature grid from.
  function v1RegionLineFromFields(temperatureGPerCell, humidityGPerKg, heading) {
    const W = PREVIEW_GRID.width, H = PREVIEW_GRID.height;
    const parts = V1_REGIONS.map(([name, l0, l1, a0, a1]) => {
      let sT = 0, wT = 0, sQ = 0, wQ = 0;
      for (let y = 0; y < H; y++) {
        const lat = 90 - ((y + 0.5) * 180) / H;
        if (lat < a0 || lat > a1) continue;
        const w = Math.cos((lat * Math.PI) / 180);
        for (let x = 0; x < W; x++) {
          const lng = -180 + ((x + 0.5) * 360) / W;
          if (lng < l0 || lng > l1) continue;
          const t = temperatureGPerCell[y * W + x], q = humidityGPerKg[y * W + x];
          if (Number.isFinite(t)) { sT += w * t; wT += w; }
          if (Number.isFinite(q)) { sQ += w * q; wQ += w; }
        }
      }
      return `${name} ${wT > 0 ? (sT / wT).toFixed(1) : "-"}℃ ${wQ > 0 ? (sQ / wQ).toFixed(1) : "-"}g/kg`;
    });
    return `${heading}\n${parts.join(" ／ ")}`;
  }

  // `temperatures` lets the caller pass the field it actually drew -- under
  // 季節 the four regions have to read that phase, or the numbers would
  // contradict the picture beside them.
  function v1RegionLine(preview, heading = "実験表示（本番の地表色には影響しません）", temperatures = null) {
    const t = preview.temperatureField, m = preview.moistureField;
    const tValues = temperatures || t.annualMeanTemperatureC;
    const parts = V1_REGIONS.map(([name, l0, l1, a0, a1]) => {
      let sT = 0, wT = 0, sQ = 0, wQ = 0;
      for (let y = 0; y < t.height; y++) {
        const lat = 90 - ((y + 0.5) * 180) / t.height;
        if (lat < a0 || lat > a1) continue;
        const w = Math.cos((lat * Math.PI) / 180);
        for (let x = 0; x < t.width; x++) {
          const lng = -180 + ((x + 0.5) * 360) / t.width;
          if (lng < l0 || lng > l1) continue;
          const i = y * t.width + x;
          if (preview.terrainField.isSea[i]) continue;
          sT += w * tValues[i]; wT += w;
        }
      }
      for (let y = 0; y < m.height; y++) {
        const lat = 90 - ((y + 0.5) * 180) / m.height;
        if (lat < a0 || lat > a1) continue;
        const w = Math.cos((lat * Math.PI) / 180);
        for (let x = 0; x < m.width; x++) {
          const lng = -180 + ((x + 0.5) * 360) / m.width;
          if (lng < l0 || lng > l1) continue;
          sQ += w * m.specificHumidityKgPerKg[y * m.width + x] * 1000; wQ += w;
        }
      }
      return `${name} ${wT > 0 ? (sT / wT).toFixed(1) : "-"}℃ ${wQ > 0 ? (sQ / wQ).toFixed(1) : "-"}g/kg`;
    });
    return `${heading}\n${parts.join(" ／ ")}`;
  }

  // Colour ramps. Both are deliberately coarse and readable rather than
  // pretty: this is an instrument, not a picture.
  function temperatureColour(celsius, rgb) {
    if (!Number.isFinite(celsius)) { rgb[0] = 90; rgb[1] = 90; rgb[2] = 96; return; }
    const t = Math.min(1, Math.max(0, (celsius + 40) / 80));
    // cold blue -> pale -> warm red, through a light middle so a coastline
    // stays legible against it.
    const r = t < 0.5 ? 40 + 380 * t * 0.5 : 235;
    const g = t < 0.5 ? 70 + 300 * t : 235 - 300 * (t - 0.5);
    const b = t < 0.5 ? 200 - 60 * t : 220 - 380 * (t - 0.5);
    rgb[0] = Math.max(0, Math.min(255, r | 0));
    rgb[1] = Math.max(0, Math.min(255, g | 0));
    rgb[2] = Math.max(0, Math.min(255, b | 0));
  }
  function humidityColour(gPerKg, rgb) {
    if (!Number.isFinite(gPerKg)) { rgb[0] = 90; rgb[1] = 90; rgb[2] = 96; return; }
    const t = Math.min(1, Math.max(0, gPerKg / 22));
    rgb[0] = Math.max(0, Math.min(255, (232 - 210 * t) | 0));
    rgb[1] = Math.max(0, Math.min(255, (220 - 80 * t) | 0));
    rgb[2] = Math.max(0, Math.min(255, (170 + 70 * t) | 0));
  }

  async function applyClimateV1() {
    const showsV1 = v1Mode !== "off" && Boolean(globe3d && globe3d.supportsClimate);
    // The cooling and wind buttons describe how the MODEL was run, so they
    // mean nothing while the teacher is on screen.
    climateV1Options.hidden = !showsV1 || v1Source() !== "model";
    climateV1Readout.hidden = !showsV1;
    // The season is temperature-model only: the teacher is an annual mean and
    // humidity is not seasonal here, so offering the control beside either
    // would imply a seasonality that does not exist.
    const showsSeason = showsV1 && v1Mode === "temperature-model";
    seasonRow.hidden = !showsSeason;
    if (!showsSeason) stopSeasonPlay();
    if (showsSeason) applySeasonButtons();
    if (!showsV1) {
      if (surfaceMode) globe3d.setSurfaceMode(surfaceMode);
      return;
    }
    if (v1Busy) return;
    v1Busy = true;
    climateV1Readout.textContent = "計算中…";
    try {
      const colourAt = v1Variable() === "temperature" ? temperatureColour : humidityColour;
      if (v1Source() === "teacher") {
        const teacher = await ensureV1Teacher();
        const values = v1Variable() === "temperature" ? teacher.temperature : teacher.humidity;
        globe3d.showScalarField({
          width: PREVIEW_GRID.width, height: PREVIEW_GRID.height, values, colourAt,
        });
        climateV1Readout.textContent =
          v1RegionLineFromFields(teacher.temperature, teacher.humidity, "教師データ（実測）");
        return;
      }
      const terrain = await ensureV1Terrain();
      const oracleWind = v1Wind === "observed" ? await ensureV1OracleWind() : null;
      const key = `${v1Cooling}|${v1Wind}`;
      let preview = v1Cache.get(key);
      if (!preview) {
        const sets = resolveClimateSets(world.config);
        const values = sets.sets.find((set) => set.id === sets.defaultId).values;
        preview = buildClimateV1Preview({
          terrainField: terrain, body: world.config.body,
          // Climate v1 carries its own Earth temperature calibration; it is
          // internal to v1 and never touches the shipped v0.8 parameters.
          params: { ...values, ...CLIMATE_V1_EARTH_TEMPERATURE_CALIBRATION },
          oracleWind,
          evaporativeCooling: v1Cooling === "on"
            ? { evaporativeCoolingC: EVAPORATIVE_COOLING_PREVIEW_C } : {},
        });
        v1Cache.set(key, preview);
      }
      if (v1Variable() === "temperature") {
        const t = preview.temperatureField;
        if (v1Season === "seasonal") {
          v1SeasonPreview = preview;
          drawSeasonPhase(preview);
        } else {
          // 年間 shows Stage 2's own array, not a copy of it -- so returning
          // from 季節 cannot leave a seasonal value behind.
          globe3d.showScalarField({
            width: t.width, height: t.height, values: t.annualMeanTemperatureC, colourAt,
          });
        }
      } else {
        const m = preview.moistureField;
        const g = new Float32Array(m.specificHumidityKgPerKg.length);
        for (let i = 0; i < g.length; i++) g[i] = m.specificHumidityKgPerKg[i] * 1000;
        globe3d.showScalarField({ width: m.width, height: m.height, values: g, colourAt });
      }
      climateV1Readout.textContent = v1Season === "seasonal" && v1Mode === "temperature-model"
        ? v1RegionLine(preview, `季節気温（気温のみ）${seasonPhaseLabel(v1Phase)}`, v1PhaseBuffer)
        : v1RegionLine(preview);
    } catch (error) {
      console.error("Climate v1 preview failed", error);
      climateV1Readout.textContent = "実験表示の計算に失敗しました";
    } finally {
      v1Busy = false;
    }
  }

  function applyV1Buttons() {
    v1Buttons.forEach((b) => b.classList.toggle("selected", b.dataset.v1 === v1Mode));
    v1CoolingButtons.forEach((b) => b.classList.toggle("selected", b.dataset.cooling === v1Cooling));
    v1WindButtons.forEach((b) => b.classList.toggle("selected", b.dataset.wind === v1Wind));
  }

  v1Buttons.forEach((button) => {
    button.addEventListener("click", () => {
      v1Mode = button.dataset.v1;
      applyV1Buttons();
      requestAnimationFrame(() => { applyClimateV1(); });
    });
  });
  v1CoolingButtons.forEach((button) => {
    button.addEventListener("click", () => {
      v1Cooling = button.dataset.cooling;
      applyV1Buttons();
      requestAnimationFrame(() => { applyClimateV1(); });
    });
  });
  v1WindButtons.forEach((button) => {
    button.addEventListener("click", () => {
      v1Wind = button.dataset.wind;
      applyV1Buttons();
      requestAnimationFrame(() => { applyClimateV1(); });
    });
  });

  // --- the season row's own handlers --------------------------------------
  //
  // None of these re-runs a climate stage. Moving the phase costs one pass
  // adding a row-constant anomaly plus the texture repaint the preview
  // already does for every view.
  function setSeasonPhase(phase, { fromSlider = false } = {}) {
    v1Phase = SEASONAL_TIME_AXIS.normalise(phase);
    if (!fromSlider) {
      seasonSlider.value = String(Math.round(v1Phase * SEASON_PHASE_STEPS) % SEASON_PHASE_STEPS);
    }
    if (v1Season !== "seasonal" || !v1SeasonPreview || !globe3d) return;
    drawSeasonPhase(v1SeasonPreview);
    climateV1Readout.textContent =
      v1RegionLine(v1SeasonPreview, `季節気温（気温のみ）${seasonPhaseLabel(v1Phase)}`, v1PhaseBuffer);
  }

  seasonButtons.forEach((button) => {
    button.addEventListener("click", () => {
      v1Season = button.dataset.season;
      if (v1Season !== "seasonal") stopSeasonPlay();
      applySeasonButtons();
      requestAnimationFrame(() => { applyClimateV1(); });
    });
  });
  seasonSlider.addEventListener("input", () => {
    stopSeasonPlay();
    setSeasonPhase(Number(seasonSlider.value) / SEASON_PHASE_STEPS, { fromSlider: true });
  });
  seasonPrev.addEventListener("click", () => {
    stopSeasonPlay();
    setSeasonPhase(v1Phase - SEASON_NUDGE / SEASON_PHASE_STEPS);
  });
  seasonNext.addEventListener("click", () => {
    stopSeasonPlay();
    setSeasonPhase(v1Phase + SEASON_NUDGE / SEASON_PHASE_STEPS);
  });
  seasonPlay.addEventListener("click", () => {
    if (seasonPlayHandle !== null) { stopSeasonPlay(); return; }
    seasonPlay.textContent = "停止";
    seasonPlayLast = performance.now();
    // Real time, not a fixed step per frame, so a slower device plays the
    // year at the same speed with fewer frames rather than in slow motion.
    const tick = (now) => {
      const elapsed = (now - seasonPlayLast) / 1000;
      seasonPlayLast = now;
      setSeasonPhase(v1Phase + elapsed / SEASON_PLAY_SECONDS);
      seasonPlayHandle = requestAnimationFrame(tick);
    };
    seasonPlayHandle = requestAnimationFrame(tick);
  });

  // The temporary comparison feature's own precomputed A/B numbers (see
  // js/globe3d.js's "sea-ice-round comparison feature" block). Static
  // numbers straight from the candidate's own committed JSON entry, not a
  // live recomputation -- this row already shows the live Teacher A score,
  // and adding a second live Teacher B pass to every repaint is well beyond
  // what a temporary comparison view needs.
  function applyClimateCompareLine(id) {
    const set = id && globe3d ? globe3d.climateSets.find((s) => s.id === id) : null;
    if (!set || !set.compareInfo) {
      climateCompareLine.hidden = true;
      return;
    }
    climateCompareLine.textContent = set.compareInfo;
    climateCompareLine.hidden = false;
  }

  // The agreement with the teacher data, in one line. Worked out by the same
  // code the command-line scorer uses, so what the phone shows and what the
  // parameter search optimises cannot drift apart.
  function applyClimateScore() {
    const result = globe3d && globe3d.getClimateScore ? globe3d.getClimateScore() : null;
    if (!result) {
      climateScoreLine.hidden = true;
      return;
    }
    const pc = (v) => (v === null ? "-" : Math.round(v * 100));
    const c = result.classes;
    climateScoreLine.textContent =
      `教師データとの一致度 総合${pc(result.meanIou)}% ／ ` +
      `植生${pc(c.vegetation.iou)} 乾燥地${pc(c.arid.iou)} ` +
      `雪氷${pc(c.landIce.iou)} 海氷${pc(c.seaIce.iou)}`;
    climateScoreLine.hidden = false;
  }

  // Mean temperature. The readout follows the finger, but a repaint is a pass
  // over every pixel of the raster -- roughly a second on a phone -- so the
  // model is only re-run when the finger lifts ("change"), which is what makes
  // a 1-degree step usable rather than 20 repaints per drag.
  function applyClimateTempReadout() {
    climateTempReadout.textContent = `${Number(climateTempSlider.value)}℃`;
  }

  climateTempSlider.addEventListener("input", applyClimateTempReadout);
  climateTempSlider.addEventListener("change", () => {
    applyClimateTempReadout();
    const celsius = Number(climateTempSlider.value);
    requestAnimationFrame(() => {
      globe3d.setMeanTemperature(celsius);
      applyClimateScore();
    });
  });

  // Rebuilt per world, because each one carries its own sets.
  function buildClimateSetButtons() {
    climateSetButtons.textContent = "";
    if (!globe3d.supportsClimate) return;
    globe3d.climateSets.forEach((set) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = set.label;
      button.dataset.set = set.id;
      if (set.note) button.title = set.note;
      button.addEventListener("click", () => {
        if (globe3d.getClimateSet() === set.id) return;
        applyClimateSetButtons(set.id);
        applyClimateCompareLine(set.id);
        // Same as the other repaint buttons: let the pressed state paint
        // before the pass over every pixel blocks the thread.
        requestAnimationFrame(() => {
          globe3d.setClimateSet(set.id);
          syncClimateTemp();
          applyClimateScore();
        });
      });
      climateSetButtons.appendChild(button);
    });
    applyClimateSetButtons(globe3d.getClimateSet());
    syncClimateTemp();
  }

  // The slider shows whatever the active set says until the user moves it.
  function syncClimateTemp() {
    if (!globe3d.supportsClimate) return;
    climateTempSlider.value = String(Math.round(globe3d.getMeanTemperature()));
    applyClimateTempReadout();
  }

  function applyClimateSetButtons(id) {
    climateSetButtons.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("selected", b.dataset.set === id);
    });
  }

  // Repainting the seabed takes a fraction of a second, so let the pressed
  // state paint first -- otherwise the button appears not to respond until
  // the work is already finished.
  const seabedButtons = document.querySelectorAll("#seabed-style button");
  seabedButtons.forEach((button) => {
    button.addEventListener("click", () => {
      seabedButtons.forEach((other) => other.classList.toggle("selected", other === button));
      requestAnimationFrame(() => globe3d.setSeabedStyle(button.dataset.style));
    });
  });

  seaLevelSlider.addEventListener("input", applySeaLevel);
  waterOpacitySlider.addEventListener("input", applyWaterOpacity);

  function applyAxis({ recentre }) {
    const tilt = axisUpright ? 0 : world.config.body.axialTiltDegrees;
    const zoom = globe3d.getView().zoom;
    globe3d.setAxisTilt(tilt);
    // Only on a press. Doing it on load too would move the opening view,
    // which sits at lng -90 and which the user has already signed off on.
    if (recentre) globe3d.setView({ lng: 0, lat: 0, zoom });
    axisButton.textContent = axisUpright ? "軸 垂直" : `軸 ${tilt}°`;
    axisButton.classList.toggle("active", !axisUpright);
  }
  // Not a plain toggle. "One press returns to the zero pose from any
  // orientation, a second press tilts from there" only holds if a press
  // that finds the globe dragged away snaps it back rather than advancing
  // to the other state -- otherwise the very first press on a freshly
  // loaded (already upright) globe would tilt it instead of resetting it.
  function atZeroPose() {
    if (!axisUpright) return false;
    const view = globe3d.getView();
    return Math.abs(view.lng) < 0.5 && Math.abs(view.lat) < 0.5;
  }
  axisButton.addEventListener("click", () => {
    axisUpright = !atZeroPose();
    applyAxis({ recentre: true });
  });

  function applyGraticule() {
    const state = GRATICULE_STATES[graticuleIndex];
    globe3d.setGraticule(state.mode);
    graticuleButton.textContent = `線 ${state.label}`;
    graticuleButton.classList.toggle("active", state.mode !== "off");
    // The scale is only shown alongside a graticule, as asked -- the two
    // answer the same question, "how big is what I am looking at".
    scaleBar.hidden = mode !== "3d" || state.mode === "off";
  }
  graticuleButton.addEventListener("click", () => {
    graticuleIndex = (graticuleIndex + 1) % GRATICULE_STATES.length;
    applyGraticule();
  });

  // Both readouts are driven from the render loop, because both answer to
  // dragging rather than to any control. Each only touches the DOM when its
  // displayed value actually changes -- writing text every frame would cost
  // far more than the numbers do.
  let shownAxis = null;
  let shownScale = null;

  function onFrame() {
    const rounded = Math.round(globe3d.getAxisAngle());
    if (rounded !== shownAxis) {
      shownAxis = rounded;
      axisReadout.textContent = `${rounded}°`;
    }
    if (!scaleBar.hidden) {
      const bar = scaleBarFor(globe3d.getMetresPerPixel());
      if (bar.text !== shownScale) {
        shownScale = bar.text;
        scaleBarLine.style.width = `${bar.pixels}px`;
        scaleBarLabel.textContent = bar.text;
      }
    }
  }

  // Which switch is the current one. A tap while another world is still
  // loading used to let two `loadWorld` calls interleave, and whichever
  // finished second could dispose the globe the other had just installed --
  // leaving every control wired to a dead view.
  let loadSequence = 0;

  async function loadWorld(entry) {
    const token = ++loadSequence;
    loading.classList.remove("hidden");
    loading.textContent = `${entry.label}を読み込み中…`;

    // OpenStreetMap is a map of Earth, so the 2D view only makes sense for
    // Earth; leaving 2D mode selected while switching to Mars would show
    // the wrong planet.
    if (mode !== "3d") {
      mode = "3d";
      applyMode();
    }

    // **Build the replacement before destroying what works.** This used to
    // dispose first, so anything that went wrong afterwards -- a failed
    // texture download, most likely on a phone -- left `globe3d` pointing at
    // a disposed view. The panel still responded, but the animation loop was
    // stopped, so the axis readout froze, the posture button moved a scene
    // nobody was rendering, and the graticule's lines went into it unseen
    // while the scale bar (plain DOM, and owned here) still appeared. Every
    // symptom the user reported, and only a page reload cleared it.
    let config;
    let next;
    try {
      config = await (await fetch(entry.config)).json();
      next = await initGlobe3D("app", config, onFrame);
    } catch (err) {
      console.error("Failed to switch world:", err);
      // Nothing was disposed, so the globe already on screen is untouched and
      // still running. Say what happened, then get out of the way rather than
      // sitting on top of a working app for ever.
      if (token === loadSequence) {
        loading.textContent = "読み込みに失敗しました。通信状況を確認してください。";
        setTimeout(() => {
          if (token === loadSequence) loading.classList.add("hidden");
        }, 2500);
      }
      return;
    }

    // A newer switch started while this one was loading: this globe is
    // already obsolete, so throw it away rather than installing it over the
    // one the user actually asked for.
    if (token !== loadSequence) {
      next.dispose();
      return;
    }

    if (globe3d) globe3d.dispose();
    globe3d = next;
    shownAxis = null;
    shownScale = null;
    world = { entry, config };

    const sea = config.display.seaLevel;
    seaLevelLabel.textContent = sea.label;
    seaLevelSlider.min = String(Math.round(sea.downToMetres / sea.downStepMetres));
    seaLevelSlider.max = String(Math.round(sea.upToMetres / sea.upStepMetres));
    seaLevelSlider.value = "0";

    // Earth's seabed colours repaint a satellite photograph. Mars and the
    // Moon have no photograph -- they are already coloured by height -- so
    // the control would do nothing and is hidden rather than left dead.
    const hasPhoto = Boolean(config.globeTexture);
    // The climate colouring needs a map-shaped texture, which today means the
    // body drawn from a photograph; Mars and the Moon index their colours by
    // height instead. Hidden rather than dead, same as the seabed buttons.
    surfaceRow.hidden = !globe3d.supportsClimate;
    // 教師 shows what this world's surface really looks like, so the model's
    // colouring can be compared with it by eye on the phone. Only worlds
    // that carry teacher data offer it.
    teacherButton.hidden = !globe3d.hasTeacher;
    // A newly built globe always starts on its own standard surface, and the
    // experimental preview starts off -- its terrain field and cached runs
    // belong to the world that has just been replaced.
    surfaceMode = "standard";
    v1Mode = "off";
    v1TerrainField = null;
    v1Cache = new Map();
    // The season table is this body's obliquity and year, and the phase
    // buffer is this body's grid -- both belong to the world being replaced.
    stopSeasonPlay();
    v1Season = "annual";
    v1SeasonTable = null;
    v1SeasonPreview = null;
    v1PhaseBuffer = null;
    seasonRow.hidden = true;
    applySeasonButtons();
    climateV1Row.hidden = !globe3d.supportsClimate;
    applyV1Buttons();
    climateV1Options.hidden = true;
    climateV1Readout.hidden = true;
    buildClimateSetButtons();
    applySurfaceButtons();
    // Hidden for now at the user's request -- not removed. They come back
    // when the standard conditions reproduce the real Earth well enough for
    // adjusting them to mean something.
    seabedRow.hidden = true;
    toggleButton.hidden = !hasPhoto;
    // Say plainly that these oceans are not real. The point of the slider on
    // an airless body is "if there were water up to here, where would the
    // coast be" -- worth stating rather than implying.
    virtualNote.hidden = hasPhoto;

    worldCycleButton.textContent = `天体 ${entry.label}`;

    applySeaLevel();
    applyWaterOpacity();
    applyAxis({ recentre: false });
    applyGraticule();
    applyMode();
    loading.classList.add("hidden");
  }

  // One button that cycles through worlds/index.json in the order that file
  // lists them -- 地球 -> 月 -> 火星 -> 地球 -- rather than a row of three. It
  // shows the body currently drawn, which is what a corner button has room
  // to say.
  worldCycleButton.addEventListener("click", () => {
    if (!world) return;
    const at = index.worlds.findIndex((entry) => entry.id === world.entry.id);
    const next = index.worlds[(at + 1) % index.worlds.length];
    if (!next || next.id === world.entry.id) return;
    // Let the loading overlay paint before the mesh build blocks the thread.
    requestAnimationFrame(() => {
      // loadWorld handles its own failures -- it has to, because it is the
      // only place that knows whether anything was disposed yet.
      loadWorld(next);
    });
  });

  toggleButton.addEventListener("click", () => {
    if (mode === "3d") {
      const view = globe3d.getView();
      mode = "2d";
      applyMode();
      if (!map2d) {
        map2d = initMap2D("map2d");
      } else {
        map2d.map.updateSize();
      }
      map2d.setView(view);
    } else {
      const view = map2d.getView();
      mode = "3d";
      applyMode();
      globe3d.setView(view);
    }
  });

  const first = index.worlds.find((entry) => entry.id === index.default) || index.worlds[0];
  await loadWorld(first);
}

// Picks a round distance whose bar lands near a comfortable width on a
// phone, then reports both the pixels to draw and the label to print.
// 1/2/5 x 10^n is the usual ladder because those are the numbers people read
// off a map without doing arithmetic.
function scaleBarFor(metresPerPixel) {
  const TARGET_PIXELS = 96;
  const target = metresPerPixel * TARGET_PIXELS;
  const magnitude = Math.pow(10, Math.floor(Math.log10(target)));
  const metres = [1, 2, 5, 10].reduce((best, step) =>
    Math.abs(step * magnitude - target) < Math.abs(best * magnitude - target) ? step : best
  ) * magnitude;
  return {
    pixels: Math.round(metres / metresPerPixel),
    text: metres >= 1000 ? `${Math.round(metres / 1000)} km` : `${Math.round(metres)} m`,
  };
}

main().catch((err) => {
  console.error("Failed to start map:", err);
  const loading = document.getElementById("loading");
  if (loading) {
    loading.textContent = "地図の読み込みに失敗しました。通信状況を確認してください。";
  }
});
