# Teacher B: climate structure — build and self-verification

Follow-up to `docs/climate-model-diagnosis-after-stage7_5.md`. That document
found the four-class annual teacher (Teacher A) can barely see season,
monsoon, or a wet/dry cycle at all. This document covers building a second,
completely separate teacher built to see exactly that, and checking that it
actually does — before any climate-model mechanism is changed. Per the
user's instruction, no such change was made this round.

## 0. State at the start of this work

- Branch `claude/map-app-v0-1-az6aoa`, diagnosis commit `d28f7d3`.
- A safe restore point was pushed before any change: `safe-v0.8-stage7.5-diagnosed`.
- Teacher A / shipped model, unchanged by this work (confirmed identical
  before and after): 総合 63.4% (植生 57.4 / 乾燥地 62.9 / 雪氷 79.3 / 海氷 54.0).
- Stage 7.5's free search put every one of 20 top candidates'
  `seasonalSensitivityC` at 3.0–5.8 (of 0–120) and `itczFollowFraction` at
  exactly 0.000. The pin curve found a physically real season
  (`seasonalSensitivityC=25`, a 28°C swing at 45°N) costs Teacher A 4.3
  points, entirely in 雪氷 (79.3 → 65.7), with 植生 unchanged (57.4 → 57.5).

## 1–2. Data source and its license

Reference read: `research/prior-art/01-world-orogen.md` on
`origin/research/prior-art-review` (read-only, via `git show`; that branch
was never merged or checked out). World Orogen is GPLv3, so nothing here
uses its code, its optimisation script, or its file structure — only the
general, published idea of "score a generated climate against an observed
climate classification" (see the diagnosis doc, section 2, for the fuller
treatment).

The classification itself is built from **Beck, H.E., Zimmermann, N.E.,
McVicar, T.R., Vergopolan, N., Berg, A., Wood, E.F. (2018). "Present and
future Köppen-Geiger climate classification maps at 1-km resolution."
Scientific Data 5:180214**, the standard, most-cited modern Köppen-Geiger
product — an independent, peer-reviewed scientific dataset, unrelated to
World Orogen. Full provenance (source file, checksum, retrieval date,
license, citation) is written by the build tool into
`worlds/kasoku-sekai/teacher/koppen-structure-summary.json` on every run, so
it cannot go stale by hand-editing being forgotten.

- **Dataset**: Beck et al. (2018) present-day Köppen-Geiger classification.
- **Version/file**: `Beck_KG_V1_present_0p5.tif`, inside `Beck_KG_V1.zip`.
- **Resolution used**: 0.5° (720×360). Chosen deliberately over the 1 km
  product — climate *groups* are large-scale by construction, and the 1 km
  file would cost bandwidth this project's pipeline is built to avoid for
  detail this teacher has no use for (see `build-terrain.yml`'s own
  reasoning for the same call on GEBCO).
- **License**: CC BY 4.0. **Citation**: as above.
- **Retrieval**: figshare article `10.6084/m9.figshare.6396959`, via its
  public API, from a GitHub Actions runner — this sandbox's own network
  policy blocks figshare directly, the same situation `build-terrain.yml`
  already works around for GEBCO/CEDA.
- **Confirmed date**: 2026-09-09 (see the summary JSON's `retrievedAt` for
  the exact timestamp and the sha256 of the fetched file).

## 3. Reducing 30 classes to 8

The real Köppen-Geiger system needs monthly temperature and monthly
precipitation in real units (millimetres). This model has neither: only two
seasons (warm/cold) and a 0–1 moisture proxy that is never an absolute
depth of rain. Inventing monthly millimetres to force out a 30-class
answer would be inventing data in the one place this project has always
refused to (`build_teacher.py`'s own framing) — so per the user's own
instruction (section 8), a **simplified Köppen-type teacher** was designed
instead of a forced full reproduction, using only the standard published
Köppen group boundaries (Peel, Finlayson & McMahon 2007) rather than any
project's implementation of them:

| class | Köppen groups | boundary used |
| --- | --- | --- |
| 熱帯湿潤 (tropicalHumid) | Af | coldest season ≥ 18°C, no real dry season |
| 熱帯季節性 (tropicalSeasonal) | Am, Aw | coldest season ≥ 18°C, has a dry season |
| 乾燥 (arid) | BW*, BS* | overrides every temperature group (as in the real definition) |
| 温帯湿潤 (temperateHumid) | Cf* | −3°C < coldest season, warmest ≥ 10°C, no dry season |
| 温帯季節性 (temperateSeasonal) | Cs*, Cw* | same range, has a dry season |
| 寒冷湿潤 (coldHumid) | Df* | coldest season ≤ −3°C, warmest ≥ 10°C, no dry season |
| 寒冷季節性 (coldSeasonal) | Ds*, Dw* | same range, has a dry season |
| 極域 (polar) | ET, EF | warmest season < 10°C |

"Has a dry season" reuses the real definition's own 1/3 rule (driest month
under a third of the wettest), applied to this model's warm/cold *seasons*
in place of the real definition's twelve months — an explicit, disclosed
approximation, not the literal month-count rule.

**Full vs simplified was compared before building, per section 8's
instruction, and the answer was structural rather than a judgement call**:
this model has no absolute precipitation at all, so the real aridity index
(Peel et al.'s temperature-scaled P < 2T/2T+14/2T+28 mm test) cannot be
evaluated under any resolution of classes — a full 30-class reproduction was
never on the table without inventing millimetres. The simplified 8-group
scheme is the largest version of this teacher the model's actual output can
honestly support.

**The one number that is calibrated rather than derived directly** is the
arid/humid moisture threshold (`STRUCTURE_ARID_MOISTURE_THRESHOLD` in
`js/climate.js`, 0.3454). Per the user's explicit instruction (section 9:
"モデルの弱点を正しく見つける教師にしてください... 都合よく調整しないでくだ
さい"), it is calibrated against an **external, independent fact** — Peel
et al.'s own reported global land fraction for Köppen group B, 30.2% — not
against this model's own score, the same method already used for V0.5's
sea-level baseline. The real fetched data's own measured arid land fraction
(30.42%, see the summary JSON) landed almost exactly on that 30.2% target
by itself, which is a check on the calibration, not a circular one: the
threshold was fixed *before* this run against the literature figure, and
the real data's independent number confirms it rather than having been
used to produce it.

Two of the eight named-place checks failed on the first real run and were
fixed by moving the check, not the data — the same precedent
`build_teacher.py` already set ("moving the check to Borneo is the honest
fix"): Delhi is widely quoted as Cwa but Beck et al.'s own higher-resolution
data places it in BSh, a real refinement; Moscow's actual class is Dfb
(coldHumid), not the Dwb this file's own first draft wrongly expected. See
`tools/build_koppen_teacher.py`'s comments for both.

## 4. Auditing which internal variables Teacher B needs

| needed for Teacher B | status |
| --- | --- |
| annual mean temperature | **A** — `seaLevelC` minus lapse rate, already used by `classifyPoint` |
| warm/cold season temperature | **A** — `warmDeltaC`/`coldDeltaC`, added in Stage 7.5 |
| warm/cold season moisture | **A** — `computeClimate` already returns `warmMoisture`/`coldMoisture` separately |
| a dry-season test | **B** — approximated by the warm/cold ratio in place of 12 real months (see section 3) |
| an aridity test | **B** — approximated by a moisture threshold in place of an absolute-mm index (no absolute precipitation exists in this model at all) |
| absolute monthly precipitation (mm) | **C** — does not exist in this model; would need a new mechanism, not a parameter |
| the real 30-class Köppen letters (sub-splits by warmest-month temperature within C/D) | **D** — unnecessary for evaluating season/monsoon/precipitation structure, which is this teacher's whole purpose |

No new state was added to `computeClimate`. Every input Teacher B reads was
already being computed and returned; only a new, independent way of reading
it exists now.

## 6. Building the teacher data — Pixel 7a impact

`tools/build_koppen_teacher.py` runs only from
`.github/workflows/build-koppen-teacher.yml` (GitHub Actions), never on the
phone and never in this dev sandbox — the same rule the terrain pipeline
follows, for the same reason (a dedicated geo-data host, unreachable except
from a runner). Output: `worlds/kasoku-sekai/teacher/koppen-structure.png`
(720×360, paletted, **11 KB**) and a summary JSON (**2.9 KB**). The phone
only ever reads these two small committed files; it never touches the
source archive.

## 7. Scoring, kept separate from Teacher A

`js/climate.js` gained `STRUCTURE_CLASSES`, `classifyStructurePoint()` and
`scoreAgainstStructureTeacher()` — pure additions; `git diff` from the
diagnosis commit to this work shows **zero lines removed** from the file,
and `node tools/score_climate.mjs` (Teacher A) reports the identical 63.4%
before and after. `tools/score_koppen.mjs` is the CLI for Teacher B, and it
never combines its number with Teacher A's, per the user's instruction
(section 10).

## 11. Self-verification: does Teacher B actually see what Teacher A cannot?

Five conditions, run with `tools/score_koppen.mjs` against the real Beck et
al. data (720×360, full raster, no sampling step):

| condition | Teacher B 総合 (8-class IoU) | Teacher A 総合 (unchanged, for reference) |
| --- | --- | --- |
| A. 現状 (shipped, `seasonalSensitivityC=4`) | **10.2%** | 63.4% |
| B. 季節をほぼオフ (`seasonalSensitivityC=0`) | 9.8% | ~63.4%¹ |
| C. 季節を地球実値相当 (`seasonalSensitivityC=25`) | **17.6%** | 59.1%¹ |
| D. モンスーンを切る (`monsoonStrength=0`) | 10.2% | 63.4%¹ |
| D′. モンスーンを最大に (`monsoonStrength=2`) | 10.3% | — |
| E. 雨陰を切る | 9.9% | 63.2%¹ |

¹ Teacher A figures for B/D/E are the ablation values already measured in
the diagnosis doc's section 4, reproduced here for the side-by-side; C's
59.1% is the pin-curve value at `seasonalSensitivityC=25` from the same
document.

**What this answers, directly (section 17):**

1. **季節性 ON/OFF — Teacher B distinguishes it clearly, and Teacher A does
   not.** 0 → 4 → 25 gives 9.8% → 10.2% → 17.6%, monotonic and large (+7.8
   points end to end) — where Teacher A moves by at most a few points and
   only through its ice classes. This is the central result: the four-class
   annual teacher was never going to reward getting seasons right, and
   Teacher B does.
2. **モンスーン ON/OFF — neither teacher distinguishes it, because the
   mechanism itself is inert, not because Teacher B cannot see it.**
   10.2% → 10.3% at the shipped season strength, and 17.6% → 17.7% even at
   the physically real season strength. This confirms, from a second,
   independent scorer, the diagnosis doc's finding that the monsoon term
   is attached to a pathway too weak to move the picture (section 4, "the
   monsoon probe"). Teacher B is *ready* to reward a working monsoon
   mechanism — the per-class breakdown shows 熱帯季節性/温帯季節性/寒冷季節性
   all sitting at exactly 0% model area under every condition tried, which
   is the "seasonal" half of three of the four temperature groups producing
   nothing at all.
3. **雨陰 ON/OFF — a small, real, positive signal, consistent with Teacher A.**
   9.9% → 10.2% (+0.3), the same order of magnitude as Teacher A's own 0.23
   point.

**Where the shipped model actually stands against Teacher B**, per-class
(condition A above): 乾燥 34.3% and 極域 21.3% are its best classes; 熱帯湿潤
is a weak 16.7% despite 99.3% recall (it is *hugely* over-produced — 29.1%
of the model's land against the teacher's 4.9% — because near-zero seasonal
temperature swing means very little land ever cools enough in its "cold"
season to leave the tropical bucket); and **four of the eight classes score
exactly 0%**: 熱帯季節性, 温帯季節性, 寒冷湿潤, 寒冷季節性. The model currently
never produces a genuine "seasonal" climate at any temperature band, and
never produces a genuine continental-cold climate either (温帯湿潤 alone
absorbs almost everything that should split between 温帯湿潤/温帯季節性/寒冷湿
潤/寒冷季節性).

## 16. Regression check

No committed automated test suite exists in this project (confirmed by
search); the established method is the same Playwright-against-a-vendored-
test-site approach every prior stage used, reused here:

- `node tools/score_climate.mjs` — Teacher A: **identical**, 63.4% before
  and after every change in this round.
- Rendered 岩 (bare rock) texture hash: **`6dbc6304`**, matching the value
  recorded from Stage 4/7 onward.
- Panel heights: 標準 **137px**, 陸地塗り分け **186px** — both match the
  values recorded in "The panel move" section of `CLAUDE.md` exactly, i.e.
  Teacher B added zero pixels to the on-screen panel (nothing was added to
  the UI this round, per the user's own instruction to keep this a
  dev/CLI-only change).
- `git diff` from the diagnosis commit shows **zero lines removed** from
  `js/climate.js` — every change is additive.
- Canvas count after an Earth → Mars → Earth world switch: **1** throughout,
  no leaked WebGL context, no page errors — the specific failure mode the
  user hit and fixed in Stage 3 (see `CLAUDE.md`, "The world-switch bug the
  user hit").

Earth/Mars/Moon, 3D/2D, sea level, water opacity, 標準/岩/陸地塗り分け/教師
表示 — nothing in this round touched any file those depend on
(`globe3d.js`, `main.js`, `index.html`, `css/style.css` are all unmodified).

## 17 & 9. Is the next ITCZ experiment worth running?

Yes. The diagnosis doc named longitude-dependent ITCZ as the top candidate
because it is the mechanism the monsoon term needs in order to stop being
isotropic-in-disguise. Teacher B now gives a concrete, independent way to
confirm whether that experiment actually helps: watch whether 熱帯季節性 /
温帯季節性 / 寒冷季節性 move off 0%, and whether 総合 moves by more than the
noise floor this round established (roughly ±0.3–0.5 points on mechanisms
that do work, like rain shadow). Nothing about ITCZ itself was implemented
this round, per the user's explicit instruction.

## 19–20. What is standard, and where the provenance lives

The shipped standard model is unchanged: `seasonalSensitivityC` stays at
the Stage 7.5 search's own value (≈4), not the physically real 25 used only
as an experimental comparison point above. Teacher B's full provenance
(source, license, version, resolution, retrieval date, checksum, reduction
table, regeneration instructions) is written automatically into
`worlds/kasoku-sekai/teacher/koppen-structure-summary.json` by the build
tool on every run, so it cannot drift out of sync with what is actually
committed.
