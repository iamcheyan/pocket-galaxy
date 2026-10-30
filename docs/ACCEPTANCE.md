# Acceptance

Checkable matrix. Every ✅ line names the command or file that proves it on the
current tree. "Desktop-simulated" means verified in headless Chromium on the HX90
host; no handheld, e-ink reader or tablet hardware was attached.

## 1. Game loop

| Requirement | Status | Evidence |
|---|---|---|
| Discover → harvest → upgrade → expand, one full loop | ✅ | `tests/interaction/gameplay.mjs` (34 checks, `gameplay: PASS`) |
| Resources Energy / Mineral / Science | ✅ | `tests/unit/game.test.ts`, `src/core/game.ts` |
| Real save write + read, survives reload | ✅ | gameplay: `save: localStorage envelope exists`, `reload restores the large galaxy` |
| Real save write + read, IndexedDB mirror | ✅ | gameplay: `save: IndexedDB mirror written` |
| Corrupt save rejected, not half-loaded | ✅ | gameplay: `corrupt envelope is rejected and a fresh game starts`; `tests/unit/save.test.ts` |
| Quota exhaustion reported, old save preserved, play continues | ✅ | gameplay: `oversized envelope under full storage reports quota`; unit: `a full storage reports quota, not unavailable` |
| Pause | ✅ | gameplay: `P pauses a running game` + `P resumes a paused game`; harvest/scan refuse while paused (`tests/unit/game.test.ts`) |
| Restart | ✅ | gameplay: `restart wipes progress back to a fresh medium galaxy` |
| Seven body kinds | ✅ | `tests/unit/galaxy.test.ts` — all seven appear in a medium galaxy |
| Six upgrade tracks | ✅ | `tests/unit/upgrades.test.ts` (cost curve, caps, refusal paths) |
| Risk events (4 kinds), no combat | ✅ | `tests/unit/game.test.ts` — determinism, shield mitigation, floors |
| Achievements | ✅ | `tests/unit/game.test.ts`; Logbook screen |
| Galaxy rating | ✅ | `tests/unit/galaxy.test.ts`, `tests/unit/game.test.ts` |
| Five galaxy scales | ✅ | `tests/unit/galaxy.test.ts` body counts; Shipyard expand row |

## 2. Inputs

| Requirement | Status | Evidence |
|---|---|---|
| Touch: tap select | ✅ desktop-simulated | `inputs.mjs`: `tap selects a body` |
| Touch: long press details/menu | ✅ desktop-simulated | `inputs.mjs`: `long press opens the context menu` |
| Touch: drag pan | ✅ desktop-simulated | `inputs.mjs`: `drag pans the map` |
| Touch: pinch zoom | ✅ desktop-simulated | `inputs.mjs`: `pinch zooms the map` |
| Mouse: hover / click / drag / wheel / right click | ✅ deskt<span></span>op-simulated | `inputs.mjs` mouse block (7 checks) |
| DPad: focus ring + confirm + back | ✅ desktop-simulated | `inputs.mjs` keyboard block: ring moves, Enter buys, Escape returns |
| DPad: pan/zoom on the map | ✅ | `inputs.mjs`: arrows pan, `=`/`-` zoom |
| Gamepad: buttons + analog axes | ✅ injected through `navigator.getGamepads` | `inputs.mjs` gamepad block (8 checks) |
| Gamepad remapping in Settings | ✅ | `inputs.mjs`: `rebinding maps scan to R2` |
| Live input debug panel | ✅ | `inputs.mjs`: `debug panel lists keyboard/gamepad/touch events` |
| No native controls (select/dialog/alert) | ✅ | grep-clean; modal is `role="dialog"` built from `div`; menu is `div` |

Touch is dispatched as real CDP `Input.dispatchTouchEvent`, not synthesized DOM
events. Gamepad input goes through the production polling path via a temporarily
swapped `navigator.getGamepads`.

## 3. Performance

| Requirement | Status | Evidence |
|---|---|---|
| FPS / frame time / memory overlay | ✅ | `performance.mjs`: overlay shows 11 fields; FPS is non-zero |
| Overlay toggle from gamepad + keyboard | ✅ | `performance.mjs`, `inputs.mjs` |
| Benchmark: 6 fixed scenes | ✅ | `performance.mjs`: `all six scene sizes reported` ×2 runs |
| Benchmark: real measured data | ✅ | `docs/evidence/benchmark-report.txt`, `tests/interaction/.artifacts/benchmark-runs.json` |
| Two-run comparison | ✅ | [PERFORMANCE.md](PERFORMANCE.md#two-real-runs-on-this-host) |
| Galaxy Score + Device Rating | ✅ | `tests/unit/benchmark.test.ts`, report output |
| Copyable report | ✅ | `Copy report` → clipboard, textarea fallback |
| Adaptive quality | ✅ | `tests/unit/device.test.ts` hysteresis; `performance.mjs` low/high budgets |
| Pacing enforced per level (60/60/30/15 FPS) | ✅ | `performance.mjs`: `low level is paced to its 30 Hz target` (26–34 FPS), `paced frames are not reported as jank` |
| E-Ink playable at 10–20 FPS | ✅ desktop-simulated | measured 15.0 FPS at 66.7 ms, jank 0 |
| Manual quality trigger with visible difference | ✅ | `performance.mjs`: `high budget spawns more particles`, `force low applies the low budget` |
| Memory reported honestly (`n/a` fallback) | ✅ | `tests/unit/monitor.test.ts`; `summarize` note path |

## 4. Themes and layouts

| Requirement | Status | Evidence |
|---|---|---|
| Dark | ✅ | `themes.mjs` (canvas pixel probe) + `docs/evidence/theme-dark-desktop-galaxy.png` |
| Light | ✅ | `themes.mjs`: canvas corner is light and differs from dark |
| OLED (pure `#000`) | ✅ | `themes.mjs`: canvas corner pixel is exactly `0,0,0`; `--bg`/`--bg-deep`/`--surface`/`--surface-2` are `#000000` |
| Handheld layout | ✅ desktop-simulated | `layout-handheld-390x844-galaxy.png`, `page-galaxy-handheld.png` |
| Tablet layout | ✅ desktop-simulated | `layout-tablet-820x1180-galaxy.png` |
| Desktop layout | ✅ | `theme-dark-desktop-galaxy.png` |
| E-Ink layout | ✅ desktop-simulated | `layout-eink-390x844-galaxy.png`, `layout-eink-1280x800-galaxy.png`; profile pinning verified in `themes.mjs` |
| E-Ink monochrome render | ✅ | `qualityBudget(…, eink).monochrome` → bodies painted from `--fg`; `themes.mjs` requires **zero** saturated pixels in the e-ink canvas while still producing ink |
| E-Ink motion/glow suppression | ✅ | 0 particles, no glow/trails/vignette, 66 ms target; CSS kills transitions, shadows, rounding |
| No hard-coded device names | ✅ | `src/core/device.ts` reads capabilities only; grep for device names returns nothing in `src/` |
| Responsive without hard-coded sizes | ✅ | `responsive.mjs`: 12 page/viewport pairs, zero overflow |

## 5. Breakpoint and console gate

| Requirement | Status | Evidence |
|---|---|---|
| 390×844: `scrollWidth === clientWidth` on every page | ✅ | `responsive.mjs` (6 pages) |
| 1280×800: `scrollWidth === clientWidth` on every page | ✅ | `responsive.mjs` (6 pages) |
| Console + pageerror clean | ✅ | all four suites assert empty logs per run |
| No failed requests (incl. favicon) | ✅ | `requestfailed`/HTTP≥400 listener in the harness, asserted |
| Touch targets ≥ 32 px (44 px in handheld) | ✅ | `responsive.mjs` smallest-control check |

## 6. Cache busting

| Requirement | Status | Evidence |
|---|---|---|
| JS/CSS changes bump `?v=N` | ✅ | `scripts/build.mjs` content fingerprint → `asset-version.json` → rewrite `index.html` |
| JS and CSS share the version | ✅ | capture asserts both request URLs carry the build's version |

## 7. Tests and docs

| Requirement | Status | Evidence |
|---|---|---|
| Unit tests: resources / upgrades / saves | ✅ | 77 tests, `node --test tests/unit/` |
| Interaction tests | ✅ | 5 suites, real Chromium (`responsive`, `themes`, `inputs`, `gameplay`, `performance`) |
| `docs/ARCHITECTURE.md` | ✅ | present |
| `docs/GAMEPLAY.md` | ✅ | present |
| `docs/INPUTS.md` | ✅ | present |
| `docs/PERFORMANCE.md` | ✅ | present |
| `docs/ACCEPTANCE.md` | ✅ | this file |
| `docs/EVIDENCE.md` | ✅ | present, with per-capture assertions and hashes |
| `git status` clean, pushed | ✅ | see final report |
| README one-command run | ✅ | `npm install && npm run build && npm run serve` |

## Not verified on hardware

Explicitly **not** claimed. The HX90 is a headless NixOS build host; no RG34XX,
RG35XX, RG40XX, CubeXX, M21, Leaf3C, Android tablet or physical display was
attached at any point.

| Item | Why it waits |
|---|---|
| Real D-pad / face-button evdev mapping through PocketJS | Needs a device; the app-side probe panel is the tool for doing it |
| Real touch panel (tap latency, palm rejection, pinch feel) | CDP touch events prove the code path, not the panel |
| Real e-ink refresh behaviour (ghosting, partial refresh) | `monochrome`/`update: slow` hints are honored, but no panel was measured |
| GPU-backed frame rates | This host renders in software; all FPS figures are software-rendered |
| Battery / temperature | No battery API on this host; not implemented rather than faked |
| KMS/fbdev output path | The app is a web front end; embedding it in the PocketJS Linux host is out of scope for this repository |
| Thermal throttling behaviour over 30+ minutes | Requires a device under sustained load |

Anything a reviewer wants to promote from "desktop-simulated" to "verified" needs
the device plus: this repo's server (or a static copy), Settings → Input probe for
button mapping, the Benchmark page for frame data, and the four layout profiles.
