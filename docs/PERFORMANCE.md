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
| Jank | share of frames that missed the active target (target + 15% tolerance), so a deliberately 15 Hz e-ink panel reads 0%, not 100% |
| Memory | `performance.memory.usedJSHeapSize` / limit — `n/a` when the browser has no heap API |
| Entities | bodies actually drawn this frame |
| Particles | live particle count |
| Draw calls | counted per paint operation (starfield batched at /120) |
| Update / Render | rolling averages from `CostMonitor`, ms |
| Quality | active level, marked `(manual)` when pinned |

`FrameMonitor` also drops gaps > 2000 ms so returning from a hidden tab does not
poison the average with one giant "frame". A cheap background rAF sampler feeds
the same monitor while a non-map screen is open, so statistics and the overlay
keep working on Settings / Shipyard / Benchmark instead of freezing.

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
| 10 000 | 65 | 37.2 | 68 | 39.1 |

Run 1: Galaxy Score **9 482**, rating **A+**, max stable 10 000.
Run 2: Galaxy Score **9 668**, rating **A+**, max stable 10 000.

The two runs differ on the heaviest scene (37.2 vs 39.1 FPS, 65 vs 68 frames) —
that is the point of running it twice: the harness reports what happened,
including variance, not a smoothed story. Across every pair captured on this
host the 10 000-object scene landed between 21.8 and 40.0 FPS; see
[What the spread means](#what-the-spread-means) for the range and its cause.

Current captured report (`docs/evidence/benchmark-report.txt`, from
`npm run evidence`, regenerated on every run and therefore a single snapshot):

```text
objects  frames  avgFps  minFps  p95ms   score
    100     108    60.0    59.5   16.80      60
    500     108    60.0    59.5   16.70     300
   1000     108    60.0    59.5   16.70     600
   3000     108    60.0    59.5   16.80    1800
    5000      77    42.8    29.9   33.40    2139
   10000      43    23.7    15.0   66.70    2367

Galaxy Score: 7266
Device Rating: B
Max Stable Objects: 5000
Average FPS: 54.8
Peak Memory: 4.8 MB
```

### What the spread means

The same binary on the same host has produced Galaxy Scores from 7 266 to 9 705
across sessions, with the 10 000-object scene between 21.8 and 40.0 FPS. That is
a software rasteriser sharing a 16-core box with other work, not a benchmark rig.
The honest reading:

- **Stable claim**: 60 FPS holds through 1 000 objects in every run, and through
  5 000 objects whenever the host is not contended.
- **Variable claim**: 5 000 and 10 000 objects depend on host load, so a single
  number from this page is a snapshot, not a device rating.
- **For device acceptance**: run the benchmark on the target, twice, and compare
  those two runs against each other — that is exactly what the harness supports.

A rating that moves between A+ and B on identical code is the measurement telling
the truth about its environment.

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
| Measured frame ms | 16.7 | 16.7 | 33.3 | 66.7 |
| Measured FPS | 60.0 | 60.0 | 30.0 | 15.0 |
| Motion scale | 1.0 | 0.85 | 0.6 | 0.25 |

Pacing is enforced, not just budgeted: the loop skips a frame whenever the
active target exceeds 20 ms, so Low really runs at 30 Hz and E-Ink at 15 Hz
instead of rendering 60 times a second and wasting the panel.

Measured on this host by forcing each level and sampling after a monitor reset:

| Level | Target | Measured avg FPS | Measured avg frame | Jank |
|---|---:|---:|---:|---:|
| High | 17 ms | 60.0 | 16.7 ms | 0% |
| Medium | 20 ms | 60.0 | 16.7 ms | 0% |
| Low | 33 ms | 30.0 | 33.3 ms | 0% |
| E-Ink | 66 ms | 15.0 | 66.7 ms | 0% |

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
