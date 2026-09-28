// 二集団（試作）mode: the controls and what they drive. The model is
// twopop.js (run in the worker, journey-worker.js), its evaluation
// twopop-eval.js, the colours the stage shader (stage "twopop", so 3D and 2D
// match). main.js calls in here only in this mode.
//
// One run = one fixed environment (the stage fields at the sliders'
// conditions), one condition (競争のみ / 交雑のみ / 両方) and the
// weak-language hypothesis on or off. Earth only: the starting distribution
// is data (twopop/initial_sites_earth.json), and only Earth has it.
import * as TP from "./twopop.js";
import { makeEvaluator } from "./twopop-eval.js";
import { buildEnvironment } from "./journey.js";
import { TWOPOP_RGB } from "./stage-draw.js";
import { centreText } from "./stage-panel.js";
import { decodeElevationGrid } from "./elevation.js";

export const TWOPOP_DEFAULT = { seaMetres: -80, tempC: 10 };
const PLAY_SECONDS = 24;
const CONDITION_LABELS = { compete: "競争のみ", hybrid: "交雑のみ", both: "両方" };
const FIELDS = ["bed", "T_fit", "P_fit", "E_fit", "H_fit", "veg_fit", "seaice"];
const fmtYears = (y) => `${Math.round(y).toLocaleString("ja-JP")}年`;
const fmtPeople = (n) => (n >= 1e4 ? `約${Math.round(n / 1e4).toLocaleString("ja-JP")}万人` : `約${Math.round(n).toLocaleString("ja-JP")}人`);
const pct = (x, d = 1) => (Number.isFinite(x) ? `${(100 * x).toFixed(d)}%` : "–");

// host: { $, stages(), globe(), worldConfig(), isEarth(), is2d(), refresh2d(), refreshLegend(), conditions() }
export function createTwoPopUI(host) {
  const { $ } = host;
  let condition = "both", weakLanguage = false, layer = "dist";
  let data = null, result = null, t = 0, playing = false, message = "", lastLegend = 0, last2d = 0, shownFrame = -1;
  const els = {
    panel: $("twopop-panel"), play: $("twopop-play"), time: $("twopop-time"), timeText: $("twopop-time-readout"),
    lang: $("twopop-lang"), layer: $("twopop-layer"), status: $("twopop-status"), conds: [...document.querySelectorAll("#twopop-panel [data-tp-cond]")],
  };

  // ------------------------------------------------ inputs (fetched once)
  async function loadData() {
    if (data) return data;
    const get = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(u); return r.json(); };
    const [sites, obs, fitted] = await Promise.all([get("./twopop/initial_sites_earth.json"), get("./twopop/observations.json"), get("./twopop/fitted.json")]);
    return (data = { sites, obs, fitted });
  }
  const bedrockCache = new Map();
  function bedrockFor(config) {
    const spec = config.terrain.journeyBedrock;
    if (!spec) return Promise.resolve(host.globe().getElevation());
    if (!bedrockCache.has(spec.url)) bedrockCache.set(spec.url, new Promise((resolve, reject) => {
      const image = new Image(); image.crossOrigin = "anonymous";
      image.onload = () => resolve(decodeElevationGrid(image, config.terrain.encoding));
      image.onerror = () => { bedrockCache.delete(spec.url); reject(new Error(spec.url)); };
      image.src = spec.url;
    }));
    return bedrockCache.get(spec.url);
  }

  // ------------------------------------------------ the worker (fallback: in the page)
  let worker = null, seq = 0, localGrid = null;
  const pending = new Map();
  function local(msg) {
    if (msg.inputs) localGrid = TP.buildTwoPopGrid(buildEnvironment(msg.inputs));
    const ev = makeEvaluator(msg.obs), t0 = performance.now();
    const r = TP.runTwoPop(localGrid, { condition: msg.condition, weakLanguage: msg.weakLanguage, hybridization: msg.hybridization, sites: msg.sites, observe: ev.observe });
    return { result: { ...r, summary: ev.summary(), ms: { grid: 0, run: Math.round(performance.now() - t0) } } };
  }
  try {
    worker = new Worker(new URL("./journey-worker.js", import.meta.url), { type: "module" });
    worker.onmessage = ({ data: d }) => { const p = pending.get(d.id); if (!p) return; pending.delete(d.id); d.error ? p.reject(new Error(d.error)) : p.resolve(d); };
    worker.onerror = () => {
      worker = null;
      const left = [...pending.values()]; pending.clear();
      for (const p of left) { try { p.resolve(local(p.local)); } catch (e) { p.reject(e); } }
    };
  } catch { worker = null; }
  function calc(msg) {
    if (!worker) { try { return Promise.resolve(local(msg)); } catch (e) { return Promise.reject(e); } }
    const id = ++seq;
    let wire = { id, kind: "twopop", ...msg };
    if (msg.inputs) {
      const F = msg.inputs.fields, fields = {};
      for (const k of FIELDS) if (F[k]) fields[k] = { data: F[k].slice(), meta: F[k].meta };
      wire = { ...wire, inputs: { ...msg.inputs, fields } };
    }
    return new Promise((resolve, reject) => { pending.set(id, { resolve, reject, local: msg }); worker.postMessage(wire); });
  }

  // ------------------------------------------------ running
  let token = 0, envKey = "";
  async function rebuild() { envKey = ""; return run(); }
  async function run() {
    const stages = host.stages(), config = host.worldConfig();
    if (!stages || !config) return;
    pause(); result = null; t = 0; shownFrame = -1; stages.setTwoPopFrame(null);
    if (!host.isEarth()) { message = "この試作は地球だけで動く（初期分布の資料が地球にしかないため）。"; render(); return; }
    const my = ++token;
    message = "計算中…（1回 数秒〜十数秒）"; render();
    try {
      const d = await loadData(), fine = await bedrockFor(config);
      if (my !== token) return;
      const c = host.conditions(), key = `${config.id}|${c.sea}|${c.temp}`;
      const inputs = key !== envKey ? { ...stages.journeyInputs(), fine } : null;
      const fitKey = `${condition}${weakLanguage ? "+weakLanguage" : ""}`;
      const r = await calc({ inputs, condition, weakLanguage, hybridization: d.fitted[fitKey]?.h ?? 0, sites: d.sites, obs: d.obs });
      if (my !== token) return;
      envKey = key; result = r.result; message = "";
      window.__akTwoPopMs = result.ms;
      setTime(0); play();
    } catch (e) { if (my === token) { message = "計算できませんでした。通信状況を確認してください。"; render(); } }
  }

  // ------------------------------------------------ time
  const endYear = () => (result ? result.times[result.times.length - 1] : 0);
  function setTime(years) {
    t = Math.max(0, Math.min(endYear(), years));
    const f = result ? Math.min(result.frames.length - 1, Math.round(t / (result.times[1] - result.times[0]))) : -1;
    if (f !== shownFrame && result) { shownFrame = f; host.stages()?.setTwoPopFrame(result.frames[f]); }
    render();
    const now = performance.now();
    if (host.is2d() && (now - last2d > 250 || !playing)) { last2d = now; host.refresh2d(); }
  }
  let raf = 0, prev = 0;
  function frame(now) {
    if (!playing) return;
    setTime(t + endYear() / PLAY_SECONDS * Math.min(0.1, (now - prev) / 1000));
    prev = now;
    if (!result || t >= endYear()) { pause(); return; }
    raf = requestAnimationFrame(frame);
  }
  function play() { if (!result) return; if (t >= endYear()) setTime(0); playing = true; prev = performance.now(); raf = requestAnimationFrame(frame); render(); }
  function pause() { playing = false; cancelAnimationFrame(raf); if (host.is2d()) host.refresh2d(); render(); }

  // ------------------------------------------------ what is on screen
  function checksText() {
    if (!result) return "";
    return result.summary.checks.map((c) => {
      const mark = c.pass == null ? "–" : c.pass ? "○" : "×";
      const v = c.measure === "europeOverlapYears" ? fmtYears(c.value) : /Ratio/.test(c.measure) ? (Number.isFinite(c.value) ? c.value.toFixed(1) + "倍" : "–") : pct(c.value, 2);
      return `${c.id}${c.kind === "fit" ? "(合わせ込み)" : ""} ${mark} ${v}${c.contested ? "（議論あり）" : ""}`;
    }).join("　");
  }
  function render() {
    els.play.textContent = playing ? "❚❚ 停止" : "▶ 再生";
    els.play.disabled = !result;
    els.time.max = String(Math.max(500, endYear())); els.time.value = String(Math.round(t)); els.time.disabled = !result;
    els.timeText.textContent = `出発から ${fmtYears(t)}`;
    els.conds.forEach((b) => b.classList.toggle("selected", b.dataset.tpCond === condition));
    els.lang.textContent = `言語差仮説 ${weakLanguage ? "オン" : "オフ"}`;
    els.lang.classList.toggle("selected", weakLanguage);
    els.layer.textContent = layer === "dist" ? "表示 分布" : "表示 由来の割合";
    host.stages()?.setTwoPopLayer(layer === "dist" ? "dist" : "ancestry");
    els.status.textContent = message || (result ? `照合：${checksText()}` : "");
    els.status.hidden = !els.status.textContent;
    const now = performance.now();
    if (!playing || now - lastLegend > 400) { lastLegend = now; host.refreshLegend(); }
  }

  // ------------------------------------------------ controls
  els.play.addEventListener("click", () => (playing ? pause() : play()));
  els.time.addEventListener("input", () => { pause(); setTime(Number(els.time.value)); });
  els.conds.forEach((b) => b.addEventListener("click", () => { if (condition !== b.dataset.tpCond) { condition = b.dataset.tpCond; run(); } }));
  els.lang.addEventListener("click", () => { weakLanguage = !weakLanguage; run(); });
  els.layer.addEventListener("click", () => { layer = layer === "dist" ? "ancestry" : "dist"; render(); if (host.is2d()) host.refresh2d(); });

  // ------------------------------------------------ readout and legend
  function readout(lng, lat) {
    const head = `${centreText(lng, lat)}　<span class="k">二集団（試作）</span>`;
    if (!result || shownFrame < 0) return `${head}<br>${message || "計算を待っています"}`;
    const f = result.frames[shownFrame], M = TP.TP_W * TP.TP_H, c = TP.tpCell(lng, lat);
    const s = f[c] / 255, n = f[M + c] / 255, a = f[2 * M + c] / 2550;
    const what = s < 0.03 && n < 0.03 ? "どちらもいない" : `サピエンス 密度 ${pct(s, 0)}・ネアンデルタール 密度 ${pct(n, 0)}`;
    return `${head}<br><b class="m">${what}</b>${s >= 0.03 ? `<br><span class="k">サピエンス内のネアンデルタール由来 ${pct(a, 2)}</span>` : ""}`;
  }
  function legend() {
    const c = host.conditions(), row = result?.summary.series[Math.min(result.summary.series.length - 1, Math.max(0, shownFrame))];
    const classes = layer === "dist"
      ? [[TWOPOP_RGB.sapiens, "サピエンス"], [TWOPOP_RGB.neanderthal, "ネアンデルタール人"],
         [TWOPOP_RGB.sapiens.map((x, i) => (x + TWOPOP_RGB.neanderthal[i]) / 2), "両方がいる"]]
      : null;
    const bar = layer === "dist" ? null : {
      colours: Array.from({ length: 256 }, (_, i) => TWOPOP_RGB.ancestryLo.map((lo, j) => lo + (TWOPOP_RGB.ancestryHi[j] - lo) * Math.sqrt(i / 255))),
      lo: "0%", hi: "10%以上", unit: "（サピエンス内のネアンデルタール由来）",
    };
    const p = TP.TWOPOP_PARAMS, fitKey = `${condition}${weakLanguage ? "+weakLanguage" : ""}`, h = data?.fitted[fitKey]?.h ?? 0;
    return {
      bar, classes,
      score: row ? `出発から ${fmtYears(t)}・サピエンス ${fmtPeople(row.S)}・ネアンデルタール ${fmtPeople(row.N)}・アフリカの外のサピエンスが持つ由来 ${pct(row.anc, 2)}` : (message || "計算を待っています"),
      note: `条件：${CONDITION_LABELS[condition]}、言語差仮説 ${weakLanguage ? "オン" : "オフ"}。旅の環境は固定（海面 ${c.sea} m・平均気温 ${c.temp}℃、MIS3相当として仮定）で、時刻は「出発からの年」。環境が変わらないので、暦年（何万年前）とは直接比べられず、比べるのは期間の長さや順序だけ。` +
        ` 各集団のパラメータは独立：移動（拡散 ${p.sapiens.dispersalKm2}／${p.neanderthal.dispersalKm2} km²/世代、渡海 ${p.sapiens.seaHopKm}／${p.neanderthal.seaHopKm} km）、耐寒（寒さの限界 ${p.sapiens.coldShiftC}／${p.neanderthal.coldShiftC}℃ずらす）、増え方（${p.sapiens.growthPerGen}／${p.neanderthal.growthPerGen}/世代、維持の閾値 ${p.sapiens.allee}／${p.neanderthal.allee}）。数字は サピエンス／ネアンデルタール。競争の強さ ${p.competitionOnSapiens}／${p.competitionOnNeanderthal}、交雑率 ${h.toExponential(1)}（非アフリカ集団の約2.2%に合わせた値、条件ごと）。` +
        ` 仮説は切り替え：「言語差」オンでネアンデルタールの収容力 ×${TP.HYPOTHESES.weakLanguage.neanderthalCapacity}、サピエンスから受ける競争 ×${TP.HYPOTHESES.weakLanguage.neanderthalCrowding}。「交雑のみ」は競争を切り、吸収だけで消えるかを試す。` +
        ` 初期分布は化石・遺跡の位置（資料）から置き、移動規則とは別。照合のF1は合わせ込みに使った資料、I1〜I5は独立確認だけに使う資料（古代DNA・化石の年代と分布）。地名・経度による移動や勝敗の特例はない。`,
    };
  }

  let shown = false;
  function show(on) {
    els.panel.hidden = !on;
    if (on === shown) return;
    shown = on;
    if (!on) { pause(); host.stages()?.setTwoPopFrame(null); }
  }
  return {
    rebuild, run, show, readout, legend, pause, play, setTime,
    state: () => ({ condition, weakLanguage, layer, t, playing, endYear: endYear(), message, frames: result?.frames.length ?? 0, ms: result?.ms, checks: result?.summary.checks.map((c) => [c.id, c.pass, c.value]) }),
    set: (o) => { if (o.condition) condition = o.condition; if (o.weakLanguage != null) weakLanguage = o.weakLanguage; return run(); },
  };
}
