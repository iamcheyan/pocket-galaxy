# Pocket Galaxy

**Pocket Galaxy is the PocketJS showcase game and the PJOS performance/input
probe.** One app that is simultaneously a playable galaxy exploration game, a
live PocketJS capability demo, a frame-time/benchmark harness, an input
verification panel for device sign-off, and a cross-device layout matrix.

No framework, no engine, no build server: TypeScript + Canvas 2D + DOM, bundled
with esbuild.

```text
Explore → Harvest → Upgrade → Expand → Higher galaxy rating
```

## Run it

```sh
npm install          # esbuild + typescript + puppeteer-core (dev only)
npm run build        # dist/app.js + dist/app.css, ?v= cache-bust written to index.html
npm run serve        # http://127.0.0.1:8123/   (PORT=… to change)
```

Open the URL and play. `npm run dev` rebuilds on change and serves.

Nothing is fetched at runtime: no CDN, no fonts, no telemetry. It works from
`file://`-style static hosting as long as `dist/`, `styles/`, `index.html` and
`favicon.svg` are served.

## Verify it

```sh
npm run check              # tsc --noEmit (strict) + native-control guard
npm run check:assets       # ?v= cache-buster matches the built fingerprint
npm test                   # 76 unit tests (node --test)
npm run test:interaction   # real Chromium: responsive, themes, inputs, gameplay, performance
npm run evidence           # regenerates every screenshot in docs/evidence/
npm run verify             # check + unit + build + cache-bust + interaction
```

The interaction suites launch one Chromium, assert every page keeps
`scrollWidth === clientWidth` at 390×844 and 1280×800, require an empty
console/page-error log, and drive the four input sources plus a full gameplay
loop and two benchmarks.

## What is in the box

| Area | Where | What it does |
|---|---|---|
| Game | `src/core/*` | Seeded galaxy generation, harvest/scan, six upgrade tracks, risk events, achievements, idle income |
| Map | `src/render/canvas.ts` | DPR-correct canvas, themed palette from CSS tokens, quality-budgeted stars/glow/trails/particles |
| Screens | `src/screens/*` | Galaxy, Shipyard, Benchmark, Showcase, Logbook, Settings — all self-drawn controls |
| Performance | `src/perf/*` | rAF frame monitor (FPS, p95, jank), cost monitor, six-scene benchmark, paste-ready report |
| Input | `src/ui/input.ts` | Touch / mouse / DPad-keyboard / gamepad → one `ActionId` enum + debug log; rebindable pad map |
| Adaptation | `src/core/device.ts` | Capability detection, four layout profiles, quality budgets, hysteresis controller |
| Persistence | `src/core/save.ts` | Versioned localStorage envelope + IndexedDB mirror, quota fallback, validated reads |

## Controls

| | Touch | Mouse | DPad / keyboard | Gamepad |
|---|---|---|---|---|
| Select | tap | click | arrows + confirm | D-pad / stick + A |
| Inspect | long press | right click | Y | Y / Triangle |
| Harvest | Select → Harvest | Select → Harvest | A / Enter | A / Cross |
| Scan | Scan button | Scan button | X | X / Square |
| Zoom | pinch / double tap | wheel | `=` / `-` | R1 / L1 |
| Pan | drag | drag | arrows on the map | D-pad / stick |
| Pause | Pause button | Pause button | P / START | START |
| Perf overlay | Settings switch | Settings switch | F / SELECT | SELECT |

Every action is also reachable with the focus ring (`Tab`-order = DOM order), so
Settings, Shipyard and Benchmark are fully operable with a D-pad alone.

## Documentation

- [ARCHITECTURE](docs/ARCHITECTURE.md) — module boundaries, data flow, render loop
- [GAMEPLAY](docs/GAMEPLAY.md) — loop, resources, bodies, upgrades, risk, rating
- [INPUTS](docs/INPUTS.md) — the four input sources, mapping, rebinding, probe panel
- [PERFORMANCE](docs/PERFORMANCE.md) — overlay, benchmark, adaptive quality, measured numbers
- [ACCEPTANCE](docs/ACCEPTANCE.md) — the checkable acceptance matrix
- [EVIDENCE](docs/EVIDENCE.md) — every screenshot with its assertions and hash

## Scope honesty

Everything here runs in Chromium on the HX90 development host. Handheld, e-ink
and tablet layouts are **emulated** through viewport + capability overrides; no
RG34XX / M21 / Leaf3C hardware was attached. What still needs a physical device
is listed in [ACCEPTANCE](docs/ACCEPTANCE.md#not-verified-on-hardware).

Device names never appear in gameplay or layout code: layout is chosen from
measured capabilities (viewport, pointer type, touch points, e-ink hints,
prefers-reduced-motion, core count).
