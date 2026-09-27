// v2 stage panel: the legend/notes and the centre readout (元データ値).
// Text only -- main.js puts it on screen. The readout reads the committed
// arrays (F) through cell(); the drawing copies are consulted only to say
// when the screen and the raw cell disagree.
import { ICE_MIN_M, POLAR_AVERAGE_LAT, MODE_JA } from "./stage-data.js";
import { ramp, seaColour, AGREE, EXPOSED, SIMPLE_VEG, simpleVeg } from "./stage-draw.js";

// The terrain's missing-data record (config.json terrain.processing), in the
// same words wherever it is shown: the score line (always visible) carries
// the short form, the 説明 note the long one. main.js uses the same two for
// 標準 and 標高色, so the record and the screen cannot disagree.
export function gapShort(p) {
  return p?.missingCellsAfterResampling ? `地形の欠損${(100 * p.missingFractionAfterResampling).toFixed(2)}%を補完` : "";
}
export function gapNote(p) {
  return p?.missingCellsAfterResampling
    ? `地形の欠損 ${(100 * p.missingFractionAfterResampling).toFixed(2)}%（2048×1024格子の${p.missingCellsAfterResampling.toLocaleString()}セル）は、最も近い観測済みの高さで埋めた。埋めた所は平らな段状に見え、観測された細部はない。`
    : "";
}

export function createStagePanel(ctx) {
  const { S, V, vcol, vlab, state, cell, bilinear, drawnComposite, rawComposite, isClimate, vm, scale, hasTeacher, bedRange } = ctx;
  const [BED_LO, BED_HI] = bedRange;
  // ------------------------------------------------ legend and notes
  const pct = (x) => (x * 100).toFixed(0) + "%";
  function legend() {
    const veg = state.v === "veg";
    const out = { bar: null, classes: null, score: "", note: "" };
    if (veg) {
      const items = [];
      const sc = V.scores[state.mode];
      if (state.src === "diff") {
        items.push([AGREE.same, "一致"], [AGREE.veg, "植生が不一致"], [AGREE.ice, "氷の有無が不一致"],
          [AGREE.none, "教師なし"], [AGREE.sea, "海"]);
      } else {
        for (const c of state.vegStyle === "simple" ? SIMPLE_VEG : V.classes) {
          const iou = hasTeacher ? sc.iou[String(c.code)] : null;
          items.push([c.rgb, c.ja, state.src === "model" && iou != null ? Math.round(iou * 100) : null]);
        }
        items.push([vcol[1], "陸氷"], [seaColour(-3000), "海"]);
        if (state.src === "teacher") items.push([vcol[255], "教師なし"]);
      }
      if (state.seaLevel < 0) items.push([EXPOSED, "干上がった海底（推定なし）"]);
      out.classes = items;
      out.score = hasTeacher ? state.vegStyle === "simple" ? `${MODE_JA[state.mode]}：簡略5区分（表示用に統合・一致率未集計）` : `${MODE_JA[state.mode]}：15区分 一致 ${pct(sc.accuracy)}・κ ${sc.kappa.toFixed(2)}・大区分 ${pct(sc.group)}` : "地球で学習した規則による試験的な塗り分け・教師なし";
      out.note = {
        model: "モデル：年平均の気温・降水・水蒸気圧（3〜5段階と同じ推定値）と岩盤地形から分類した、通年の代表的な自然植生。15区分の数字は種類ごとの一致度（%）。",
        teacher: "教師：Ramankutty & Foley (1999) 潜在自然植生（人の土地利用が無い場合）。南極は教師に区分が無い。",
        diff: "差：モデルと教師を、氷＞海＞植生の順に重ねた最終表示どうしで比べた一致・不一致。",
      }[state.src] + (state.vegStyle === "simple" ? " 簡略表示は元の15区分を5色へ統合しただけで、再学習はしていません。" : "") + " 重ね順は 氷＞海＞植生。限界：年平均だけなので季節性（常緑/落葉、雨季の有無）は区別できない。";
    } else {
      let rp, lo, hi, unit;
      if (!isClimate()) { rp = "rock"; lo = BED_LO; hi = BED_HI; unit = "m"; }
      else { const sc = scale(); rp = sc.ramp; lo = sc.lo; hi = sc.hi; unit = vm().unit; }
      const colours = [];
      for (let i = 0; i < 256; i++) colours.push(state.v === "sea" && BED_LO + (i / 255) * (BED_HI - BED_LO) < 0 ? seaColour(BED_LO + (i / 255) * (BED_HI - BED_LO)) : ramp(rp, i / 255));
      out.bar = { colours, lo, hi, unit: unit + (state.src === "diff" && isClimate() ? "（差）" : "") };
      if (!isClimate()) {
        out.score = hasTeacher ? S.stages[state.v].score : `地形の標高 ${BED_LO}〜${BED_HI} m を色分け・教師なし`;
        out.note = S.stages[state.v].note;
      }
      else {
        out.score = hasTeacher ? `${MODE_JA[state.mode]}：${vm().score[state.mode]}` : "地球で学習した規則による試験的な塗り分け・教師なし";
        out.note = (state.src === "teacher" ? vm().teacherNote : state.src === "model" ? vm().modelNote : "差 = モデル − 教師。") +
          " " + S.modeNote[state.mode];
      }
    }
    if (!hasTeacher) out.note = "探査機の地形に地球で学習した規則を当てた試験表示。実際の天体環境ではない。教師なし。" + (gapNote(ctx.processing) ? " " + gapNote(ctx.processing) : "");
    if (gapNote(ctx.processing)) out.score += `・${gapShort(ctx.processing)}`;
    out.note += " 画面の色：緯度60°より極側は、極付近の細いセルの筋を抑えるため東西に平均した値で描く（描画だけ）。" +
      "海岸線・氷の縁は隣のセルとの間を補間した線。中央の数値は常に平均前の元データのセルの値。" +
      (hasTeacher ? " 形は Anti-KyTerra の岩盤（GEBCO_2026 氷床下地形）、光と海面は v1s と同じ。" : " 地形は探査機の地形図、海面は仮想。日射は地球と同じ強さ、重力1G、大気組成は地球と同じ、放射線は無視。");
    return out;
  }

  // ------------------------------------------------ the centre readout: raw data values
  const SEA_JA = (z) => (z < 0 ? "海" : "陸");
  function readout(lng, lat) {
    const pos = `中央 ${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lng).toFixed(1)}°${lng >= 0 ? "E" : "W"}`;
    const polar = Math.abs(lat) >= POLAR_AVERAGE_LAT ? "（この緯度の画面の色は東西平均）" : "";
    const head = `${pos}　<span class="k">元データ値</span>${polar}`;
    const z = cell("bed", lng, lat);
    const tag = `モデル（${MODE_JA[state.mode]}）`;
    if (!hasTeacher) {
      const sl = state.seaLevel;
      if (state.v === "bed" || state.v === "sea")
        return `${head}<br><b class="m">地形</b> ${z.toFixed(0)} m${state.v === "sea" ? `・${z < sl ? "仮想海" : "陸"}` : ""}　<b class="t">教師</b> なし`;
      if (state.v === "veg") {
        const c = rawComposite("fit", lng, lat);
        return `${head}<br><b class="m">モデル</b> ${state.vegStyle === "simple" ? simpleVeg(c)?.ja || vlab[c] : vlab[c] || "推定なし"}　<b class="t">教師</b> なし`;
      }
      const key = vm().key, value = cell(`${key}_fit`, lng, lat);
      const label = state.v === "ice" && value <= ICE_MIN_M ? "氷なし" : `${value.toFixed(vm().digits)} ${vm().unit}`;
      return `${head}<br><b class="m">モデル</b> ${label}　<b class="t">教師</b> なし`;
    }
    const warn = (drawn, raw) => drawn === raw ? "" :
      `<br><span class="w">※画面の塗りは「${drawn}」、元データのセルは「${raw}」（境界付近の補間・平均による差）</span>`;
    // the moved sea surface wins over the 0 m estimates
    const sl = state.seaLevel;
    const seaNote = sl !== 0 && ((z < sl) !== (z < 0))
      ? `<br><span class="w">※海面 ${sl > 0 ? "+" : ""}${sl} m ではここは${z < sl ? "海" : "陸（干上がった海底）"}。塗り分けの推定は海面0 mのまま</span>` : "";
    if (state.v === "bed" || state.v === "sea") {
      const what = state.v === "sea" ? `・${SEA_JA(z)}（海面0 m）` : "";
      const drawnSea = bilinear("bed", lng, lat) < 0, rawSea = z < 0;
      const w = state.v === "sea" && sl === 0 ? warn(drawnSea ? "海" : "陸", rawSea ? "海" : "陸") : "";
      return `${head}<br><b class="m">入力</b> 岩盤 ${z.toFixed(0)} m${what}　<b class="t">教師</b> なし（入力データの段階）${w}${state.v === "sea" ? seaNote : ""}`;
    }
    if (state.v === "veg") {
      const m = rawComposite(state.mode, lng, lat), t = rawComposite("teacher", lng, lat);
      const shown = state.src === "teacher" ? "teacher" : state.mode;
      let w = "";
      if (sl === 0) {
        const dc = (c) => (c === -1 ? "干上がった海底" : vlab[c]);
        w = state.src === "diff"
          ? (drawnComposite(state.mode, lng, lat) !== m || drawnComposite("teacher", lng, lat) !== t
            ? `<br><span class="w">※この地点の画面の塗りは、境界付近の補間・平均で元データのセルと異なる</span>` : "")
          : warn(dc(drawnComposite(shown, lng, lat)), vlab[shown === "teacher" ? t : m]);
      }
      const label = (c) => state.vegStyle === "simple" && simpleVeg(c) ? `${simpleVeg(c).ja}（元: ${vlab[c]}）` : vlab[c];
      return `${head}<br><b class="m">${tag}</b> ${label(m)}　<b class="t">教師</b> ${label(t)}${w}${seaNote}`;
    }
    const m0 = vm(), key = m0.key;
    const mod = cell(`${key}_${state.mode}`, lng, lat), tea = cell(`${key}_teacher`, lng, lat);
    const f = (x) => Number.isFinite(x) ? x.toFixed(m0.digits) : null;
    const iceTxt = (x) => x > ICE_MIN_M ? `${f(x)} m` : "氷なし";
    const mv = state.v === "ice" ? iceTxt(mod) : `${f(mod)} ${m0.unit}`;
    const tv = f(tea) == null ? "教師なし" : state.v === "ice" ? iceTxt(tea) : `${f(tea)} ${m0.unit}`;
    const dv = f(tea) == null ? "" : `　差 ${mod - tea >= 0 ? "+" : ""}${f(mod - tea)}`;
    let w = "";
    if (state.v === "ice" && state.src !== "diff") {
      const which = state.src === "teacher" ? "teacher" : state.mode;
      const ice = (x) => (x > ICE_MIN_M ? "氷" : "氷なし");
      w = warn(ice(bilinear(`H_${which}`, lng, lat)), ice(which === "teacher" ? tea : mod));
    }
    return `${head}<br><b class="m">${tag}</b> ${mv}　<b class="t">教師</b> ${tv}${dv}${w}${seaNote}`;
  }

  return { legend, readout };
}
