# POCKETJS VERIFICATION — pocket-galaxy

Round: PocketJS refactor (R0 reference implementation). Device acceptance is a
separate later pass.

## Shape

- Pocket app: `apps/pocket-galaxy/pocket/`
- Frozen design reference: repository root `src/` (TypeScript + Canvas 2D). It
  is kept for layout/gameplay reference and is not extended.
- TSX files in the port: **7** (`main.tsx`, `app.tsx`, `ui.tsx`,
  `screens/{galaxy,shipyard,logbook,settings}.tsx`).
- Native tree only: `View`/`Text` from
  `@pocketjs/framework/solid/components`; no DOM, iframe, texture screenshot,
  or `dangerouslySetInnerHTML`.

## Manifest

- id: `dev.pocket-galaxy.galaxy`
- entry: `src/main.tsx`
- output: `pocket-galaxy`
- viewport: `360×240 @2x` → physical `720×480`
- capabilities required: `text.glyphs.baked`, `input.buttons`
- target: `rocknix-h700-kms` (profile file
  `pocket-verify/pjs/profiles/profile-h700-360.ts`)

## Admission / compile

```sh
cd apps/pocket-galaxy/pocket
bun <SDK>/tools/pocket.ts check \
  --runtime-config $POCKET_VERIFY/pjs/profiles/pocket.runtime-config.ts \
  --target rocknix-h700-kms --manifest pocket.json
bun <SDK>/tools/pocket.ts compile \
  --runtime-config $POCKET_VERIFY/pjs/profiles/pocket.runtime-config.ts \
  --target rocknix-h700-kms --manifest pocket.json --output out.pocket
```

Admission output:

```text
✓ pocket.json v2
✓ rocknix-h700-kms satisfies pocket.json capabilities
✓ TypeScript (71 app module(s))
✓ ResolvedBuildPlan sha256:677a102fbd178e6ce5009a9b177eb50c8e79981982127bb407da9a7dfdd05ac2
```

Compiler tail:

```text
  tailwind: 88 style record(s), 0 baked timeline(s), 88 literal(s)
  fonts: 2 fallback face(s)
  pak: 10 entries
  pass 2: dist/pocket-galaxy.js
✓ Package: out.pocket
```

- Package: `out.pocket`
- sha256: `087399335578ac0a96df9651481e670ad4e5f1f7120c50f0490396fa41fa72f9`
- bytes: 2.4 MiB

## Frames

Generated with the SDK wasm core and the deterministic PNG encoder at
`renderScaled(2)` (720×480):

```sh
cd $POCKET_VERIFY
bun tools/render-pocket.ts \
  --dir repos/pocket-galaxy/apps/pocket-galaxy/pocket \
  --script repos/pocket-galaxy/apps/pocket-galaxy/pocket/frames.json \
  --out repos/pocket-galaxy/docs/pocket
```

| file | view | sha256 (first 16) |
|---|---|---|
| `docs/pocket/screen-galaxy.png` | Galaxy map, body 1 | `eae27011a2e16d4b` |
| `docs/pocket/screen-galaxy-selected.png` | D-pad moved to body 2 | `465dd68cd62274d8` |
| `docs/pocket/screen-galaxy-scanned.png` | SQUARE scanned body 2 | `da3552b27cb474c1` |
| `docs/pocket/screen-shipyard.png` | RTRIGGER → shipyard, focus ring | `02a4f1697e0d166b` |
| `docs/pocket/screen-shipyard-focus.png` | d-pad moved on the grid | `02a21a5dff978977` |
| `docs/pocket/screen-logbook.png` | RTRIGGER → logbook | `38aeeb3d2f88a824` |
| `docs/pocket/screen-settings.png` | RTRIGGER → settings | `c1ba26a6dffa27f9` |
| `docs/pocket/screen-settings-toggled.png` | CIRCLE toggled a row | `3c6bcc7d943c8c76` |

All eight files have distinct bytes; the renderer fails on a duplicate. Full
hashes are in `docs/pocket/frames.json`.

Visual checks (720×480 frames): text is sharp at 2x, no clipped title bars, no
overlapping cards, the `focus:border-emerald-300` ring is visible on the
shipyard/settings tiles, D-pad movement changes the selected body and the
detail panel, and the scan action changes the science counter and the scan
state.

## Adapter

- **fixture** — the app is pure front end. `client.ts` bakes the same bodies,
  upgrades, achievements and state into the package and labels the header
  `fixture: local`.
- `http` and `bridge` adapters exist behind the same `list()/get()/action()`
  surface. `http` uses `@pocketjs/framework/net-api`; `bridge` uses
  `host.__pvc(json)`. Neither is used for these frames.
- Device gap: Galaxy has no daemon. A real device build keeps the fixture
  adapter; persistence is a future runtime capability, not an HTTP endpoint.

## Interactions implemented

- D-pad moves the survey cursor; the selected body drives the detail panel.
- CIRCLE harvests (resources increase), SQUARE scans (science + scan state).
- L/R switches Galaxy / Shipyard / Logbook / Settings.
- Shipyard: 3-column `FocusGrid` over repair + six upgrades; CIRCLE buys.
- Settings: focusable rows cycle values; scale updates the galaxy state.
- Toast deadline uses `virtualFrame()`, not wall time.
- Selection ring and screen opacity use `animate` tracks, not timers.

## Not done / open questions

- No device run in this round (per objective).
- No save file: the React app uses localStorage/IndexedDB, which the device
  profile does not provide. Needs a runtime storage capability or a host bridge
  command; do not add an HTTP route to the Go daemon for this.
- Benchmark/showcase screens from the React app are not ported; the four
  product screens above are the R0 scope.
- The React root `src/` remains the design reference and still has its own
  build/tests. It is intentionally not wired into the pocket package.
