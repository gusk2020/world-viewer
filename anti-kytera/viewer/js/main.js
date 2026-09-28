// v2 entry: loads the worlds, wires the on-screen controls, owns the 3D/2D
// switch and puts the stage panel (legend, centre readout) on screen.
//   3D view   globe3d.js      2D view   map2d.js
//   stages    stages.js (-> stage-data / stage-respond / stage-draw / stage-panel)
// World loading, the 3D/2D switch, sea sliders, axis and graticule behave as
// in v1s (climate-v1-stable-ui js/main.js).
import { initGlobe3D } from "./globe3d.js";
import { initMap2D } from "./map2d.js";
import { loadStages } from "./stages.js";
import { ramp } from "./stage-draw.js";
import { gapShort, gapNote, centreText } from "./stage-panel.js";
import { BASE_MEAN_C } from "./stage-respond.js";

const WORLD_INDEX_URL = "./worlds/index.json";
const AK_BASE = "../";                 // anti-kytera/, where results/ and veg/results/ live
const GRATICULE_STATES = [
  { mode: "off", label: "なし" },
  { mode: "parallels", label: "緯度" },
  { mode: "both", label: "緯度+経度" },
  { mode: "meridians", label: "経度" },
];
const $ = (id) => document.getElementById(id);

async function main() {
  const index = await (await fetch(WORLD_INDEX_URL)).json();
  // Earth's stages load once and are shared by every visit to Earth. A failed
  // download is forgotten, so the next visit tries again instead of failing
  // for the rest of the session.
  let earthStagesPromise = null;
  const earthStages = () => (earthStagesPromise ??= loadStages(AK_BASE).catch((err) => { earthStagesPromise = null; throw err; }));
  earthStages().catch(() => {});
  let stages = null;

  const appEl = $("app"), map2dEl = $("map2d"), loading = $("loading");
  const toggleButton = $("view-toggle"), worldSelect = $("world-select");
  const seaLevelSlider = $("sea-level-slider"), seaLevelReadout = $("sea-level-readout"), seaLevelLabel = $("sea-level-label");
  const waterOpacitySlider = $("water-opacity-slider"), waterOpacityReadout = $("water-opacity-readout");
  const surfaceRow = $("surface-row"), srcRow = $("stage-src-row");
  const tempRow = $("climate-temp-row"), tempSlider = $("climate-temp-slider"), tempReadout = $("climate-temp-readout");
  const condition = $("ak-condition"), info = $("ak-info");
  const axisButton = $("axis-toggle"), axisReadout = $("axis-readout");
  const graticuleButton = $("graticule-toggle"), colorButton = $("graticule-color");
  const scaleBar = $("scale-bar"), scaleBarLine = $("scale-bar-line"), scaleBarLabel = $("scale-bar-label");
  const virtualNote = $("virtual-sea-note");

  let mode = "3d";
  let globe3d = null, map2d = null, world = null;
  let axisUpright = true, graticuleIndex = 0, lineWhite = false;
  // 教師 and 差 exist on Earth at the base conditions only and are put back
  // to モデル on every world switch (the model side is always 地球適合).
  let surface = "standard", src = "model", vegStyle = "detailed";
  let legendOpen = true;

  const isEarth = () => world?.entry.id === "kasoku-sekai";
  const hasStages = () => Boolean(world && globe3d && globe3d.supportsStages && stages);
  const inStage = () => surface !== "standard" && surface !== "elevation";
  for (const [name, entries] of [["惑星", index.worlds.filter(e => e.id !== "moon")], ["衛星", index.worlds.filter(e => e.id === "moon")]]) {
    const group = document.createElement("optgroup"); group.label = name;
    for (const entry of entries) { const option = document.createElement("option"); option.value = entry.id; option.textContent = entry.label; group.appendChild(option); }
    worldSelect.appendChild(group);
  }

  // ------------------------------------------------ 3D / 2D
  function applyMode() {
    appEl.hidden = mode !== "3d";
    map2dEl.hidden = mode !== "2d";
    axisButton.hidden = mode !== "3d";
    axisReadout.hidden = mode !== "3d";
    scaleBar.hidden = mode !== "3d" || GRATICULE_STATES[graticuleIndex].mode === "off";
    toggleButton.textContent = mode === "3d" ? "2Dに切替" : "3Dに切替";
  }
  function draw2d(extent, w, h) {
    return stages.renderMercator(globe3d.renderer, extent, w, h, {
      photo: surface === "standard" && Boolean(globe3d.photoTexture), elevationColor: surface === "elevation",
      photoTexture: globe3d.photoTexture, elevation: globe3d.getElevation(),
    });
  }
  let refreshQueued = false;
  function refresh2d() {
    if (!map2d || mode !== "2d" || refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => { refreshQueued = false; map2d.refresh(); });
  }

  // ------------------------------------------------ sliders
  function seaLevelMetres() {
    const steps = Number(seaLevelSlider.value), sea = world.config.display.seaLevel;
    return steps * (steps >= 0 ? sea.upStepMetres : sea.downStepMetres);
  }
  function applySeaLevel() {
    const metres = seaLevelMetres();
    globe3d.setSeaLevel(metres);
    seaLevelReadout.textContent = metres === 0 ? "±0m" : `${metres > 0 ? "+" : ""}${metres}m`;
    if (stages) { stages.state.seaLevel = metres; stages.apply(); }
    updateCondition(); refresh2d(); lastReadout = "";
    scheduleConditions();
  }
  // The seven stages follow both sliders (stage-respond.js). The work runs a
  // moment after the finger stops, and at once on release, so a drag does
  // not recompute every step.
  let conditionTimer = null;
  function scheduleConditions() {
    clearTimeout(conditionTimer);
    conditionTimer = setTimeout(applyConditions, 150);
  }
  function applyConditions() {
    clearTimeout(conditionTimer);
    if (!stages || !world) return;
    const r = stages.setConditions(seaLevelMetres(), Number(tempSlider.value) - BASE_MEAN_C);
    if (!r) return;
    window.__akConditionMs = r.ms;
    applySurface();
  }
  function applyWaterOpacity() {
    const percent = Number(waterOpacitySlider.value);
    globe3d.setWaterOpacity(percent / 100);
    waterOpacityReadout.textContent = `${percent}%`;
    if (stages) stages.state.opacity = percent / 100;
    refresh2d();
  }
  function applyTemp() {
    tempReadout.textContent = `${tempSlider.value}℃`;
    updateCondition();
    scheduleConditions();
  }
  // Say what follows the sliders the moment they leave the base conditions.
  function updateCondition() {
    if (!hasStages()) { condition.hidden = true; return; }
    const sea = seaLevelMetres(), temp = Number(tempSlider.value);
    const moved = sea !== 0 || temp !== BASE_MEAN_C;
    condition.hidden = !moved;
    if (!moved) return;
    condition.textContent = inStage()
      ? `7段階は海面・平均気温に追従（海陸→気温→湿度→降水→陸氷→植生を共通の簡易規則で更新、教師なし）。${isEarth() ? `教師・差と一致率は海面0 m・${BASE_MEAN_C}℃のときだけ。` : ""}`
      : `${surface === "elevation" ? "標高色" : "標準画像"}は地形・画像が固定で、${sea !== 0 ? "海面だけが動く。" : "平均気温では変わらない。"}7段階（岩盤〜植生）は追従する。`;
  }

  // ------------------------------------------------ surface: 標準 or a stage
  function selectButtons(sel, attr, value) {
    document.querySelectorAll(sel).forEach((b) => b.classList.toggle("selected", b.dataset[attr] === value));
  }
  function applySurface() {
    selectButtons("#surface-mode button", "surface", surface);
    selectButtons("#stage-src button", "src", src);
    selectButtons("#veg-style button", "vegStyle", vegStyle);
    $("veg-style-row").hidden = surface !== "veg";
    const teacherHere = isEarth() && stages?.atBase();
    srcRow.hidden = !teacherHere || !inStage() || surface === "bed" || surface === "sea";
    if (!teacherHere) src = "model";   // no teacher here or under changed conditions; never draw an empty one
    document.getElementById("cross").hidden = !hasStages();
    if (!hasStages()) { globe3d.setStage(null); info.hidden = true; return; }
    info.hidden = false;
    if (stages) {
      Object.assign(stages.state, { v: inStage() ? surface : "bed", src, vegStyle });
      stages.apply();
    }
    globe3d.setElevationMode(stages, surface === "elevation");
    if (inStage()) globe3d.setStage(stages, surface === "bed");
    else globe3d.setStage(null);
    renderLegend();
    updateCondition();
    refresh2d();
    lastReadout = "";
  }
  // the colour bar: 256 colours and its end labels
  function drawBar(colours, lo, hi, unit) {
    const bc = $("ak-bar").getContext("2d");
    colours.forEach((c, i) => { bc.fillStyle = `rgb(${c.map(Math.round).join(",")})`; bc.fillRect(i, 0, 1, 1); });
    $("ak-lo").textContent = lo; $("ak-hi").textContent = hi; $("ak-unit").textContent = unit;
  }
  function renderLegend() {
    const bar = $("ak-bar-wrap"), cls = $("ak-classes");
    if (!inStage() || !stages) {
      bar.hidden = surface !== "elevation"; cls.hidden = true;
      if (surface === "elevation")
        drawBar(Array.from({ length: 256 }, (_, i) => ramp("rock", i / 255)), stages.bedRange[0], stages.bedRange[1], "m");
      const gap = gapShort(world?.config.terrain.processing);
      $("ak-score").textContent = (surface === "elevation" ? "標高色：地表の高さだけ（推定値ではない）" : "標準：探査画像・地球写真（推定値ではない）") + (gap ? `・${gap}` : "");
      if (surface === "elevation") $("ak-note").textContent = `標高色は地表の標高を着色（地球は現在の氷表面を含むGEBCO、他の天体は探査機の地形）。色の両端は ${stages.bedRange[0]}〜${stages.bedRange[1]} m。海面を変えても高さ自体は変わらない。` + (gap ? " " + gapNote(world.config.terrain.processing) : "");
      else if (world?.config.image) $("ak-note").innerHTML = (gap ? gapNote(world.config.terrain.processing) + '<br>' : '') + '画像：<a href="https://www.solarsystemscope.com/textures/" target="_blank" rel="noopener">Solar System Scope / INOVE</a>、<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>。2048×1024以下に縮小' + (world.config.image.orientation === 'rotate180' ? '、地形図の向きに合わせて180°回転' : '') + '。探査画像に基づく合成・彩色で未観測域の創作的補完あり。金星はレーダー由来。';
      else $("ak-note").textContent = "標準：地球の衛星画像。";
      return;
    }
    const L = stages.legend();
    $("ak-score").textContent = L.score;
    $("ak-note").textContent = L.note;
    if (L.bar) {
      cls.hidden = true; bar.hidden = !legendOpen;
      const fmt = (x) => Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(Math.abs(x) >= 10 ? 0 : 1);
      drawBar(L.bar.colours, fmt(L.bar.lo), fmt(L.bar.hi), L.bar.unit);
    } else {
      bar.hidden = true; cls.hidden = !legendOpen;
      cls.innerHTML = "";
      for (const [rgb, text, n] of L.classes) {
        const div = document.createElement("div");
        div.innerHTML = `<i style="background:rgb(${rgb.map(Math.round).join(",")})"></i><span>${text}</span>` + (n != null ? `<span class="n">${n}</span>` : "");
        cls.appendChild(div);
      }
    }
  }
  document.querySelectorAll("#surface-mode button").forEach((b) => b.addEventListener("click", () => {
    surface = b.dataset.surface; requestAnimationFrame(applySurface);
  }));
  document.querySelectorAll("#stage-src button").forEach((b) => b.addEventListener("click", () => { src = b.dataset.src; applySurface(); }));
  document.querySelectorAll("#veg-style button").forEach((b) => b.addEventListener("click", () => { vegStyle = b.dataset.vegStyle; applySurface(); }));
  $("legend-toggle").addEventListener("click", (e) => { legendOpen = !legendOpen; e.target.classList.toggle("active", legendOpen); renderLegend(); });
  $("note-toggle").addEventListener("click", (e) => { const n = $("ak-note"); n.hidden = !n.hidden; e.target.classList.toggle("active", !n.hidden); });

  // ------------------------------------------------ the centre readout (both views)
  let lastReadout = "";
  function centre() {
    if (mode === "2d" && map2d) { const v = map2d.getView(); return { lng: v.lng, lat: v.lat }; }
    return globe3d.getCentre();
  }
  function updateReadout() {
    if (!hasStages()) return;
    const c = centre();
    let html;
    if (!c) html = "中央: 地球の外";
    else if (!inStage()) {
      html = `${centreText(c.lng, c.lat)}　<span class="k">${surface === "elevation" ? "標高色" : "標準画像"}</span><br><b class="m">地表</b> 標高 ${globe3d.sampleElevation(c.lng, c.lat).toFixed(0)} m　<b class="t">教師</b> なし`;
    } else html = stages.readout(c.lng, c.lat);
    if (html !== lastReadout) { $("ak-readout").innerHTML = html; lastReadout = html; }
  }

  // ------------------------------------------------ axis, graticule, scale bar (v1s)
  function applyAxis({ recentre }) {
    const tilt = axisUpright ? 0 : world.config.body.axialTiltDegrees;
    const zoom = globe3d.getView().zoom;
    globe3d.setAxisTilt(tilt);
    if (recentre) globe3d.setView({ lng: 0, lat: 0, zoom });
    axisButton.textContent = axisUpright ? "軸 垂直" : `軸 ${tilt}°`;
    axisButton.classList.toggle("active", !axisUpright);
  }
  function atZeroPose() {
    if (!axisUpright) return false;
    const view = globe3d.getView();
    return Math.abs(view.lng) < 0.5 && Math.abs(view.lat) < 0.5;
  }
  axisButton.addEventListener("click", () => { axisUpright = !atZeroPose(); applyAxis({ recentre: true }); });
  function applyGraticule() {
    const state = GRATICULE_STATES[graticuleIndex];
    globe3d.setGraticule(state.mode);
    if (map2d) map2d.setGraticule(state.mode);
    graticuleButton.textContent = `線 ${state.label}`;
    graticuleButton.classList.toggle("active", state.mode !== "off");
    scaleBar.hidden = mode !== "3d" || state.mode === "off";
  }
  graticuleButton.addEventListener("click", () => { graticuleIndex = (graticuleIndex + 1) % GRATICULE_STATES.length; applyGraticule(); });
  function applyLineColor() {
    globe3d.setGraticuleColor(lineWhite ? 0xffffff : 0x000000);
    if (map2d) map2d.setGraticuleColor(lineWhite ? "#ffffff" : "#000000");
    colorButton.textContent = `線色 ${lineWhite ? "白" : "黒"}`;
  }
  colorButton.addEventListener("click", () => { lineWhite = !lineWhite; applyLineColor(); });

  let shownAxis = null, shownScale = null, frame = 0;
  function onFrame() {
    if (!globe3d) return;
    const rounded = Math.round(globe3d.getAxisAngle());
    if (rounded !== shownAxis) { shownAxis = rounded; axisReadout.textContent = `${rounded}°`; }
    if (!scaleBar.hidden) {
      scaleBar.style.bottom = `${$("bottom-controls").offsetHeight + 24}px`;
      const bar = scaleBarFor(globe3d.getMetresPerPixel());
      if (bar.text !== shownScale) { shownScale = bar.text; scaleBarLine.style.width = `${bar.pixels}px`; scaleBarLabel.textContent = bar.text; }
    }
    if (mode === "3d" && frame++ % 6 === 0) updateReadout();
  }

  seaLevelSlider.addEventListener("input", applySeaLevel);
  waterOpacitySlider.addEventListener("input", applyWaterOpacity);
  tempSlider.addEventListener("input", applyTemp);
  seaLevelSlider.addEventListener("change", applyConditions);
  tempSlider.addEventListener("change", applyConditions);

  // ------------------------------------------------ worlds (v1s's safe switch)
  let loadSequence = 0;
  // A failed switch leaves the body that was already showing untouched, so
  // the message only has to get out of the way: a button to go back to it
  // (or, if nothing loaded yet, to retry), and it also clears by itself.
  function showLoadFailure(entry) {
    const back = Boolean(world);
    window.__akWorldId = world?.entry.id ?? null;
    worldSelect.value = world?.entry.id || entry.id;
    loading.replaceChildren(
      Object.assign(document.createElement("div"), { textContent: `${entry.label}を読み込めませんでした。通信状況を確認してください。` }),
      Object.assign(document.createElement("button"), {
        type: "button", className: "pill", id: "loading-dismiss",
        textContent: back ? `${world.entry.label}の表示に戻る` : "もう一度読み込む",
        onclick: () => (back ? loading.classList.add("hidden") : loadWorld(entry)),
      }));
    if (back) {
      const token = loadSequence;
      setTimeout(() => { if (token === loadSequence) loading.classList.add("hidden"); }, 6000);
    }
  }
  async function loadWorld(entry) {
    const token = ++loadSequence;
    window.__akWorldId = null;
    loading.classList.remove("hidden");
    loading.textContent = `${entry.label}を読み込み中…`;
    if (mode !== "3d") { mode = "3d"; applyMode(); }
    let config, next, nextStages;
    try {
      config = await (await fetch(entry.config)).json();
      // Download and prepare the model before allocating a second WebGL
      // context. Switching bodies on a software-rendered phone can otherwise
      // keep two large renderers alive throughout the data preparation.
      nextStages = config.globeTexture || config.antiKyTerraStages
        ? entry.id === "kasoku-sekai" ? await earthStages() :
          await loadStages(`./worlds/${entry.id}/`, true, {
            bedRange: config.display.reliefColourRangeMetres, processing: config.terrain.processing,
            obliquity: config.body.axialTiltDegrees })
        : null;
      next = await initGlobe3D("app", config, onFrame);
    } catch (err) {
      if (next) next.dispose();
      console.error("Failed to switch world:", err);
      if (token === loadSequence) showLoadFailure(entry);
      return;
    }
    if (token !== loadSequence) { next.dispose(); return; }
    if (globe3d) globe3d.dispose();
    globe3d = next;
    stages = nextStages;
    shownAxis = null; shownScale = null;
    world = { entry, config };
    const sea = config.display.seaLevel;
    seaLevelLabel.textContent = sea.label;
    seaLevelSlider.min = String(Math.round(sea.downToMetres / sea.downStepMetres));
    seaLevelSlider.max = String(Math.round(sea.upToMetres / sea.upStepMetres));
    seaLevelSlider.value = "0";
    const enabled = globe3d.supportsStages;
    surfaceRow.hidden = !enabled;
    tempRow.hidden = !enabled;
    toggleButton.hidden = !enabled;
    virtualNote.hidden = isEarth();
    surface = "standard";
    src = "model";
    worldSelect.value = entry.id;
    applySeaLevel();
    clearTimeout(conditionTimer);   // this body starts at the sliders' current conditions, before its first frame
    if (stages) stages.setConditions(seaLevelMetres(), Number(tempSlider.value) - BASE_MEAN_C);
    applyWaterOpacity();
    applyAxis({ recentre: false });
    applyGraticule();
    applyLineColor();
    applySurface();
    applyMode();
    loading.classList.add("hidden");
    window.__akReady = true;
    window.__akWorldId = entry.id;
  }
  worldSelect.addEventListener("change", () => {
    const next = index.worlds.find(e => e.id === worldSelect.value);
    if (next && next.id !== world?.entry.id) requestAnimationFrame(() => loadWorld(next));
  });
  toggleButton.addEventListener("click", () => {
    if (mode === "3d") {
      const view = globe3d.getView();
      mode = "2d";
      applyMode();
      if (!map2d) {
        map2d = initMap2D("map2d", draw2d);
        map2d.map.on("moveend", updateReadout);
        map2d.map.on("postrender", updateReadout);
      } else map2d.map.updateSize();
      map2d.setGraticule(GRATICULE_STATES[graticuleIndex].mode);
      map2d.setGraticuleColor(lineWhite ? "#ffffff" : "#000000");
      map2d.setView(view);
      map2d.refresh();
    } else {
      const view = map2d.getView();
      mode = "3d";
      applyMode();
      globe3d.setView(view);
    }
    lastReadout = "";
    updateReadout();
  });

  // test hook: look at (lng, lat) at a zoom, in whichever view is showing
  window.__ak = {
    look: (lng, lat, zoom) => (mode === "2d" ? map2d.setView({ lng, lat, zoom }) : globe3d.setView({ lng, lat, zoom })),
    view: () => (mode === "2d" ? map2d.getView() : globe3d.getView()),
    mode: () => mode,
  };

  const first = index.worlds.find((e) => e.id === index.default) || index.worlds[0];
  await loadWorld(first);
}

function scaleBarFor(metresPerPixel) {
  const TARGET_PIXELS = 96;
  const target = metresPerPixel * TARGET_PIXELS;
  const magnitude = Math.pow(10, Math.floor(Math.log10(target)));
  const metres = [1, 2, 5, 10].reduce((best, step) =>
    Math.abs(step * magnitude - target) < Math.abs(best * magnitude - target) ? step : best) * magnitude;
  return {
    pixels: Math.round(metres / metresPerPixel),
    text: metres >= 1000 ? `${Math.round(metres / 1000)} km` : `${Math.round(metres)} m`,
  };
}

main().catch((err) => {
  console.error("Failed to start map:", err);
  const loading = document.getElementById("loading");
  if (loading) loading.textContent = "読み込みに失敗しました: " + err.message;
});
