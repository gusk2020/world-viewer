// 南北収容補正案（候補）。v10 で利用者に提示した値を固定して保持する（v11 のデータ追加で勝手に再計算しない）。
// 再計算したい場合は `node tools/fit_overhang.mjs --refit`（別ファイル src/fit-candidate.refit.json に出力するだけで、この値は上書きしない）。
window.SHIP_FIT_CANDIDATE = {"centerYKm":3.775671200000006,"ryukyuSpacingPercent":55,"islandOffsetsNorthKm":{"okinotori":5.6112},"islandOffsetsKm":{"ne12926_2813":-0.41474,"sc12528_2493":-0.02757}};
