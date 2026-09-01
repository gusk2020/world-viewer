# world-viewer — project notes for future sessions

## What this is

A phone-first web map viewer for fictional worlds. The user (gusk2020) is a
non-programmer on an Android phone (Pixel 7a) only — no PC, no terminal.
Do all coding, testing, and GitHub file management yourself. Keep
explanations to the user short, jargon-free, and phrased as easy A/B
preference questions when input is needed.

Ultimate goal: one shared map app, swappable per-world data (start: 過速世界
only; later: 碧き海狼, 罅間). Do not build support for worlds beyond
過速世界 until asked — avoid speculative generalization.

## Stack decisions

- **MapLibre GL JS v6** (ESM only as of v6 — no UMD/global build). Loaded
  directly via `<script type="module">` + CDN import, no bundler/build step,
  so the user never needs to run anything locally.
  - CDN: `https://cdn.jsdelivr.net/npm/maplibre-gl@6/dist/maplibre-gl.mjs`
    (and matching `.css`). `@6` (major-only) lets jsdelivr resolve the latest
    v6.x automatically.
  - **Important gotcha**: v6's `.mjs` has **no default export**. Import
    named exports, e.g. `import { MapLibreMap, NavigationControl,
    GlobeControl } from ...`. (`MapLibreMap` is the library's own alias for
    `Map`, used here to avoid shadowing the JS built-in `Map`.)
  - Globe/2D switch uses the library's built-in `GlobeControl` (a single
    button, official MapLibre UI) rather than a custom toggle — less code,
    already touch-friendly.
  - Touch rotate/pan/zoom is MapLibre's default handler behavior; nothing
    custom was needed for that.
- **Base map data**: `https://demotiles.maplibre.org/style.json`, MapLibre's
  own public demo vector style (real-world country borders/coastlines, no
  API key, no usage limits). This is a **placeholder basemap**, standing in
  for 過速世界's real terrain/border data until that's built. Swapping it
  is a one-line change (see below).
- **Hosting**: GitHub Pages serving straight from this repo's branch (no
  build/CI step — it's plain static HTML/CSS/JS). See README.md for the
  exact Settings→Pages steps already given to the user.

## World-data structure (the "common app, swappable data" seam)

`worlds/<world-id>/config.json` holds only what's needed today:
`styleUrl`, `center`, `zoom`, `minZoom`, `maxZoom`, `defaultProjection`.
`js/app.js` fetches one hardcoded world config
(`worlds/kasoku-sekai/config.json`) and initializes the map from it — it
does not know anything world-specific beyond that path. When a second world
is added later, the natural next step is a small world-picker that changes
which config path is fetched; do not build that picker now.

Do not add fields to config.json speculatively (e.g. sea level, era/date)
until the feature that uses them is actually being implemented.

## Version 0.1 scope (done)

1. Globe/world map displays.
2. Touch rotate/pan/pinch-zoom works (MapLibre default handlers).
3. 2D/3D switch via GlobeControl button.
4. Mobile-usable layout: fullscreen map, `100dvh`, safe-area insets for
   controls, enlarged control tap targets, no page scroll/bounce.

Explicitly out of scope for v0.1 (per user instructions): sea level
slider/flooding, era selection, city labels, any second world.

## How this was tested (no browser on the dev side either)

Real basemap/library CDN hosts (jsdelivr, demotiles.maplibre.org) are
blocked by this environment's own egress policy — that's a sandbox
restriction, not a real-world problem; the user's phone has normal
internet. To verify the code anyway: installed `maplibre-gl` from npm
(registry.npmjs.org is allowed) into a scratch copy, substituted a local
stand-in style.json, served it over a local static server, and drove it
with Playwright/Chromium (software WebGL via swiftshader) — confirmed the
canvas renders, both MapLibre controls attach, the loading overlay hides on
`load`, and clicking the GlobeControl button visibly switches globe↔flat
projection (screenshots compared). That's how the ESM-no-default-export
gotcha above was actually caught before it could reach the user's phone.
If you change the map init code again, re-verify the same way before
telling the user it's ready — don't rely on reading the code alone.

## Working conventions

- Develop on branch `claude/map-app-v0-1-az6aoa` (already the checked-out
  branch); push there. Don't open a PR unless asked.
- No build step, no `node_modules` committed — keep it deployable as
  plain static files.
- Give the user Settings/Pages-button-level instructions, never git/CLI
  instructions — they cannot run commands.
