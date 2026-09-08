import { initGlobe3D } from "./globe3d.js";
import { initMap2D } from "./map2d.js";

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
  const axisButton = document.getElementById("axis-toggle");
  const axisReadout = document.getElementById("axis-readout");
  const graticuleButton = document.getElementById("graticule-toggle");
  const scaleBar = document.getElementById("scale-bar");
  const scaleBarLine = document.getElementById("scale-bar-line");
  const scaleBarLabel = document.getElementById("scale-bar-label");
  const worldButtons = document.getElementById("world-switch");
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
      applySurfaceButtons();
      requestAnimationFrame(() => globe3d.setSurfaceMode(surfaceMode));
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
    climateTempRow.hidden = !showsClimate;
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
    requestAnimationFrame(() => globe3d.setMeanTemperature(celsius));
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
        // Same as the other repaint buttons: let the pressed state paint
        // before the pass over every pixel blocks the thread.
        requestAnimationFrame(() => {
          globe3d.setClimateSet(set.id);
          syncClimateTemp();
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
    // A newly built globe always starts on its own standard surface.
    surfaceMode = "standard";
    buildClimateSetButtons();
    applySurfaceButtons();
    seabedRow.hidden = !hasPhoto;
    toggleButton.hidden = !hasPhoto;
    // Say plainly that these oceans are not real. The point of the slider on
    // an airless body is "if there were water up to here, where would the
    // coast be" -- worth stating rather than implying.
    virtualNote.hidden = hasPhoto;

    worldButtons.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("selected", button.dataset.world === entry.id);
    });

    applySeaLevel();
    applyWaterOpacity();
    applyAxis({ recentre: false });
    applyGraticule();
    applyMode();
    loading.classList.add("hidden");
  }

  index.worlds.forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = entry.label;
    button.dataset.world = entry.id;
    button.addEventListener("click", () => {
      if (world && world.entry.id === entry.id) return;
      // Let the pressed state and the loading overlay paint before the mesh
      // build blocks the thread for a moment.
      requestAnimationFrame(() => {
        // loadWorld handles its own failures -- it has to, because it is the
        // only place that knows whether anything was disposed yet.
        loadWorld(entry);
      });
    });
    worldButtons.appendChild(button);
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
