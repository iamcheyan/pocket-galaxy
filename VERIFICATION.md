# Verification — pocket-galaxy @ 2026-10-31

- Verdict: PASS
- Commit: `__COMMIT__` (test-script fix + evidence; this document is the following commit)
- Remote: `__REMOTE__`
- Runtime: static `dist/` served by `node scripts/serve.mjs` on `http://127.0.0.1:8123`, driven in headless Chrome; production bundle from `npm run build`
- Toolchain: node v22.23.3, Chrome 155.0.8059.84, TypeScript 5.9.3, esbuild 0.27.1

## Test gate
| command | result | notes |
|---|---|---|
| `npm run check` | PASS | `tsc --noEmit` strict + native-control guard |
| `npm test` | PASS | 77 unit tests (node --test), 0 failures |
| `npm run build` | PASS | `dist/app.js` + `dist/app.css`, `?v=` cache-bust rewritten |
| `npm run check:assets` | PASS | cache-buster matches the built fingerprint |
| `npm run test:interaction` | PASS | 5 suites — responsive, themes, inputs, gameplay, performance — all PASS |
| `npm run evidence` | PASS | 27 captures, each asserting its own layout/theme state |

`npm run verify` chains check → unit → build → asset-version → interaction; the full run passed
in ~87 s. The interaction suites require an empty console/page-error log, `scrollWidth ===
clientWidth` at 390×844 and 1280×800, and drive touch/mouse/keyboard/gamepad plus a full
gameplay loop and two benchmark runs.

## Screenshot matrix
All 27 files under `docs/evidence/` were regenerated this run by the repo's
`npm run evidence` script against the live static build; `manifest.json` records the capture
time (`2026-10-30T17:16:35Z`) and the SHA-256 prefix of every file.

| screen | viewport | theme/layout | file | note |
|---|---|---|---|---|
| theme-dark-desktop-galaxy.png | 1280×800 | dark/desktop | `docs/evidence/theme-dark-desktop-galaxy.png` | sha256 609c7c9c7969 |
| theme-light-desktop-galaxy.png | 1280×800 | light/desktop | `docs/evidence/theme-light-desktop-galaxy.png` | sha256 a0070e0fadd0 |
| theme-oled-desktop-galaxy.png | 1280×800 | oled/desktop | `docs/evidence/theme-oled-desktop-galaxy.png` | sha256 30a1861f4312 |
| layout-handheld-390x844-galaxy.png | 390×844 | dark/handheld | `docs/evidence/layout-handheld-390x844-galaxy.png` | sha256 8ced623cac53 |
| layout-tablet-820x1180-galaxy.png | 820×1180 | dark/tablet | `docs/evidence/layout-tablet-820x1180-galaxy.png` | sha256 c691447f6ded |
| layout-eink-390x844-galaxy.png | 390×844 | light/eink | `docs/evidence/layout-eink-390x844-galaxy.png` | sha256 43dac87c9ca9 |
| layout-eink-1280x800-galaxy.png | 1280×800 | light/eink | `docs/evidence/layout-eink-1280x800-galaxy.png` | sha256 fa6096b8a92c |
| page-galaxy-desktop.png | 1280×800 | dark/desktop | `docs/evidence/page-galaxy-desktop.png` | sha256 59f8e9d0d272 |
| page-galaxy-handheld.png | 390×844 | dark/handheld | `docs/evidence/page-galaxy-handheld.png` | sha256 05068f86d66f |
| page-shipyard-desktop.png | 1280×800 | dark/desktop | `docs/evidence/page-shipyard-desktop.png` | sha256 7a8bcca4575a |
| page-shipyard-handheld.png | 390×844 | dark/handheld | `docs/evidence/page-shipyard-handheld.png` | sha256 e3946a6dca20 |
| page-benchmark-desktop.png | 1280×800 | dark/desktop | `docs/evidence/page-benchmark-desktop.png` | sha256 afc449c5cd55 |
| page-showcase-desktop.png | 1280×800 | dark/desktop | `docs/evidence/page-showcase-desktop.png` | sha256 6db2531dfc3a |
| page-showcase-handheld.png | 390×844 | dark/handheld | `docs/evidence/page-showcase-handheld.png` | sha256 8c2383cf91df |
| page-logbook-desktop.png | 1280×800 | dark/desktop | `docs/evidence/page-logbook-desktop.png` | sha256 008da4384e18 |
| page-settings-desktop.png | 1280×800 | dark/desktop | `docs/evidence/page-settings-desktop.png` | sha256 4d62388c4ecc |
| page-settings-handheld.png | 390×844 | dark/handheld | `docs/evidence/page-settings-handheld.png` | sha256 98527436c5c5 |
| page-settings-eink.png | 1280×800 | light/eink | `docs/evidence/page-settings-eink.png` | sha256 cdba40db9e37 |
| perf-overlay-desktop.png | 1280×800 | dark/desktop | `docs/evidence/perf-overlay-desktop.png` | sha256 3d00b29d7ee9 |
| benchmark-desktop.png | 1280×800 | dark/desktop | `docs/evidence/benchmark-desktop.png` | sha256 617a65978da2 |
| quality-low-desktop.png | 1280×800 | dark/desktop | `docs/evidence/quality-low-desktop.png` | sha256 ef3127713560 |
| quality-high-desktop.png | 1280×800 | dark/desktop | `docs/evidence/quality-high-desktop.png` | sha256 06dafc24ce5c |
| input-keyboard-debug.png | 1280×800 | dark/desktop | `docs/evidence/input-keyboard-debug.png` | sha256 f125872e0316 |
| input-gamepad-debug.png | 1280×800 | dark/desktop | `docs/evidence/input-gamepad-debug.png` | sha256 7636a2c37069 |
| loop-1-before-expand.png | 1280×800 | dark/desktop | `docs/evidence/loop-1-before-expand.png` | sha256 c5788cf88309 |
| loop-2-expand-confirm.png | 1280×800 | dark/desktop | `docs/evidence/loop-2-expand-confirm.png` | sha256 b90e73417d06 |
| loop-3-after-expand.png | 1280×800 | dark/desktop | `docs/evidence/loop-3-after-expand.png` | sha256 a6f3f8ef8405 |

Count: 27 screenshots, 27 unique hashes (0 duplicates). `tools/check_shots.py`: all PNGs valid,
dimensions match, minimum per-image RGB stddev 31.29 (game renders), no blank frames.

## Fixed
- `npm test` failed on this Node (v22.23.3): the script `node --test tests/unit/` treats the
  directory path as a module and aborts with `Cannot find module …/tests/unit`, so 0 of the
  documented 77 unit tests ran. → run the explicit glob
  `node --test "tests/unit/*.test.ts"` → `package.json` → `npm test` now runs all **77/77**
  tests, and `npm run verify` passes end to end.
- `docs/EVIDENCE.md` hash column was stale after the deterministic renderer changed (all 27
  prefixes differed from the fresh manifest) and it still claimed Chromium 152. → refreshed every
  SHA-256 prefix from this run's `manifest.json` and updated the toolchain line to Chrome 155
  → `docs/EVIDENCE.md`.

## Blocked / open questions
- Handheld/e-ink/tablet layouts are emulated through viewport + capability overrides; no
  physical RG34XX / M21 / Leaf3C hardware was attached (documented in ACCEPTANCE).

## Not verified here
- 掌机真机（RG34XX / PJOS-LINUX）未验证；本轮只在本机 headless Chrome 里跑真实进程。
- Real gamepad hardware, touch hardware and e-ink ghosting; benchmarks measure this workstation.
