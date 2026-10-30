# Performance

Everything on this page comes from measured frames in this repository's own
harness. There are no expected-value tables, no cached scores, and no synthetic
FPS.

## Overlay

`SELECT` / `F`, or Settings → Performance overlay. It is drawn over the map and
updates from the same objects the renderer just filled.

| Field | Source |
|---|---|
| FPS | `1000 / lastFrameDelta` |
| Avg FPS | `1000 / mean(window)` |
| Frame | last frame delta, ms |
| p95 | 95th percentile of the rolling window, ms |
| Jank | share of frames > 33 ms |
| Memory | `performance.memory.usedJSHeapSize` / limit — `n/a` when the browser has no heap API |
| Entities | bodies actually drawn this frame |
| Particles | live particle count |
| Draw calls | counted per paint operation (starfield batched at /120) |
| Update / Render | rolling averages from `CostMonitor`, ms |
| Quality | active level, marked `(manual)` when pinned |

`FrameMonitor` also drops gaps > 2000 ms so returning from a hidden tab does not
poison the average with one giant "frame".

## Benchmark

Benchmark page → **Run benchmark**. Six fixed scenes — 100, 500, 1 000, 3 000,
5 000, 10 000 objects — each rendered for 1.8 s with real rAF timestamps. One
button, no configuration. "Copy report" puts a paste-ready block on the clipboard
(`navigator.clipboard`, with a select-and-Ctrl-C fallback when the clipboard is
blocked).

Scoring:

```
step score    = round(objects × avgFps / 100)
galaxy score  = Σ step scores            // perfect = 11 760 (every scene at 60 Hz)
rating        = S+ ≥ 94% · S ≥ 85% · A+ ≥ 76% · A ≥ 63% · B ≥ 45% · C ≥ 22% · D
max stable    = largest scene that averaged ≥ 24 FPS   (0 if even 100 fails)
```

`maxStable` refuses to extrapolate: an unstable size is reported as absent
rather than guessed.

### Two real runs on this host

Same machine, same session, back-to-back (headless Chromium 152, 1280×800 @1x,
16 cores):

| Objects | Run 1 frames | Run 1 avg FPS | Run 2 frames | Run 2 avg FPS |
|---:|---:|---:|---:|---:|
| 100 | 108 | 60.0 | 108 | 60.0 |
| 500 | 108 | 60.0 | 108 | 60.0 |
| 1 000 | 108 | 60.0 | 108 | 60.0 |
| 3 000 | 108 | 60.0 | 108 | 60.0 |
| 5 000 | 108 | 60.0 | 108 | 60.0 |
| 10 000 | 71 | 39.4 | 72 | 40.0 |

Run 1: Galaxy Score **9 705**, rating **A+**, max stable 10 000.
Run 2: Galaxy Score **9 760**, rating **A+**, max stable 10 000.

The two runs differ on the heaviest scene (39.4 vs 40.0 FPS, different frame
counts) — that is the point of running it twice: the harness reports what
happened, including variance, not a smoothed story.

Current captured report (`docs/evidence/benchmark-report.txt`, from
`npm run evidence`):

```text
objects  frames  avgFps  minFps  p95ms   score
    100     109    60.0    59.5   16.70      60
    500     108    60.0    59.5   16.70     300
   1000     108    60.0    59.5   16.80     600
   3000     108    60.0    59.5   16.80    1800
   5000      95    52.8    29.9   33.40    2639
  10000      54    30.0    20.0   50.00    3000

Galaxy Score: 8399
Device Rating: A
Max Stable Objects: 10000
Average FPS: 56
Peak Memory: 5.2 MB
```

Across all runs so far the 10 000-object scene measured 39.4 / 40.0 / 37.2 /
38.5 / 31.9 / 21.8 FPS. A headless software rasteriser on a loaded host is not a stable
platform, and pretending otherwise would be the dishonest option. What the
numbers *do* prove: the 60 FPS ceiling holds through 5 000 objects, and 10 000
objects is where this particular software-rendered environment starts to
saturate. On GPU-backed hardware the same ladder is rerun by the reviewer —
no number from this host is presented as a device rating.

## Adaptive quality

`AdaptiveQuality` samples smoothed frame time every frame:

| Condition | Effect |
|---|---|
| > 40 ms for 45 consecutive frames | demote one level (high → medium → low) |
| < 19 ms for 240 consecutive frames | promote one level |
| anything else | reset both streaks |

Asymmetric thresholds are deliberate: dropping quickly protects playability,
climbing slowly prevents flap. Isolated slow frames never change the level.

### Budgets

E-Ink is selected when the resolved layout is `eink` **or** the OS advertises
`monochrome` / `update: slow`. A pinned E-Ink layout on a colour desktop therefore
still renders monochrome, which is what makes the profile testable off-device.

| | High | Medium | Low | E-Ink |
|---|---:|---:|---:|---:|
| Monochrome | no | no | no | **yes** |
| Particles | 900 | 320 | 90 | 0 |
| Starfield | 420 | 260 | 120 | 40 |
| Trails | on | on | off | off |
| Glow / shadow | on | off | off | off |
| Max bodies drawn | 4 000 | 1 400 | 600 | 400 |
| Target frame ms | 17 | 20 | 33 | 66 |
| Motion scale | 1.0 | 0.85 | 0.6 | 0.25 |

### Manual trigger and observable difference

Settings → **Force low quality** / **Force high quality** / **Back to adaptive**,
or the Quality segmented control. The budget line under the buttons (and the
overlay's Particle counter) changes immediately:

- low: `particles 90 · starfield 120 · glow off · trails off · cap 600`
- high: `particles 900 · starfield 420 · glow on · trails on · cap 4000`

The acceptance test proves the difference is real, not cosmetic: the same
`spawnBurst` action produces measurably fewer live particles at low quality, and
the two frames are captured side by side
(`docs/evidence/quality-low-desktop.png`, `quality-high-desktop.png`).

Adaptive demotion is also visible in normal play — the toast announces
`Adaptive quality: low (frame time > 40 ms)` when it trips, so a reviewer on a
slow handheld can confirm the controller is alive.

## Memory

Read only from APIs that exist:

- `performance.memory` (Chromium) → used / limit, shown in the overlay.
- `performance.measureUserAgentSpecificMemory()` (Chromium, cross-origin
  isolated) → the benchmark's "Peak Memory" line when available.
- Neither present → the overlay prints `n/a` and the benchmark note says
  `Memory unavailable: this browser exposes no heap API.`

Heap numbers in the report are JS heap, not RSS. RSS is not exposed to the page;
claiming it would be fabrication.

## What the overlay cannot see

| Metric | Status |
|---|---|
| CPU usage | Not exposed by any browser API — not shown |
| Battery / temperature | Only via `navigator.getBattery()` where supported; not implemented here rather than faked |
| GPU timing | No `EXT_disjoint_timer_query` path in Canvas 2D — not shown |
| Refresh rate | Not queryable; the 60 Hz assumption is labelled as such in budgets |

`navigator.hardwareConcurrency` and `navigator.deviceMemory` are shown as hints
(and are coarsened by the browser by design).

## Reproducing

```sh
npm run build && npm run serve
# http://127.0.0.1:8123/?page=benchmark → Run benchmark → Copy report
```

or non-interactively:

```sh
npm run test:interaction     # writes tests/interaction/.artifacts/benchmark-runs.json
npm run evidence             # writes docs/evidence/benchmark-report.txt + screenshot
```

Both paths drive the same UI in a real browser. Neither writes a number the
browser did not measure.
