# POCKETJS PORT PATTERN

This document is the working contract for porting a Pocket application from
React + Vite + DOM to a PocketJS program. `pocket-galaxy` is the reference
implementation; every later port copies the shape below and records its own
deviations in `POCKETJS-VERIFICATION.md`.

## 1. Directory shape

```text
<repo>/apps/<app>/
├── backend/                 # unchanged Go daemon; canonical data source
├── frontend/                # frozen React reference; never extended again
└── pocket/
    ├── pocket.json          # id/name/version/entry/capabilities/viewport
    ├── tsconfig.json        # aliases to the SDK under test
    ├── package.json         # @pocketjs/framework 0.15.0 (exact)
    ├── fonts.json           # symlink to src/fonts.json (shape convenience)
    └── src/
        ├── main.tsx         # mount(() => <App/>)
        ├── app.tsx          # screen switch, button map, data load
        ├── client.ts        # list()/get()/action() + fixture/http/bridge
        ├── ui.tsx           # shared native chrome (header/bar/footer)
        ├── fonts.json       # actual coverage + fallback faces
        ├── fonts/           # CJK/Nerd subsets committed with the app
        └── screens/*.tsx    # one native view tree per screen
```

The build reads `fonts.json` from the **entry's directory**, so the working
file is `pocket/src/fonts.json`. The `pocket/fonts.json` path required by the
product layout is a symlink to it.

## 2. `pocket.json` template

```json
{
  "$schema": "https://pocketjs.dev/schema/pocket-2.json",
  "pocket": 2,
  "id": "dev.<vendor>.<app>",
  "name": "<app>",
  "title": "<Title>",
  "version": "1.0.0",
  "engine": { "capabilities": { "requires": ["text.glyphs.baked", "input.buttons"] } },
  "app": {
    "entry": "src/main.tsx",
    "output": "<app>",
    "framework": "solid",
    "viewport": { "fixed": { "logical": [360, 240], "presentation": "native" } }
  }
}
```

RG34XX is 720×480. The logical canvas is **360×240 at 2x**; the compiler bakes
the 2x font atlas and `renderScaled(2)` produces the 720×480 frame. Never put
720 into layout code.

Only declare what the `rocknix-h700-kms` profile actually has:
`text.glyphs.baked` and `input.buttons`. The device profile has no `net.*`,
no `display.auxiliary`, and no browser.

## 3. Components that exist

Import from `@pocketjs/framework/solid/components`:

| Component | Use |
|---|---|
| `View`, `Text`, `Image` | the only layout/text/image primitives |
| `FocusScope` | owns focus for the active screen; `autoFocus` on entry |
| `FocusGrid` | d-pad traversal over a wrapping tile grid (`columns`, `wrap`) |
| `Focusable` | one focusable tile; `onPress` fires on the confirm button |
| `Modal` | portal overlay that blocks background button handlers while open |
| `Gallery` | full-screen L/R paged strip; pages are lazily mounted |
| `Grid` | flex-wrap tiles plus optional focus traversal |
| `ActionBar` | floating bottom bar in a portal |
| `ActionHandler` | inline button handler attached to a native subtree |
| `For` | **keyed** list; `by` is required and keys must be unique |

`Screen` exists but defaults to a light background; the ports use a plain
`View` so both themes are explicit.

### `<For>` vs `<Index>`

Use the SDK's `For` with `by`. It keeps the row owner by key and gives the
child a stable accessor, so focus and animations survive list updates.
`solid-js`'s `Index` is index-keyed: it reuses the row when the item changes,
which loses row identity in the native focus/press dispatch. The SDK does not
provide an index-keyed component; do not import `Index` for lists.

### Conditional class and style

`class` must be a **full literal**. These are valid:

```tsx
<View class={active() ? "bg-emerald-800 text-white" : "bg-slate-900 text-slate-400"} />
```

These fail at runtime (`unknown class …`):

```tsx
<View class={"bg-" + color + " w-[10]"} />      // concatenation
<View class={`w-[${width}]`} />                  // templated width
```

Two full literals returned from a helper also work; the compiler records each
literal site. Avoid building a class from a map at runtime.

`style` accepts **spec PROP names only** (`insetL`, `insetT`, `marginT`,
`width`, `bgColor`, `translateX`, `opacity`, …), not CSS names. Numeric layout
values are logical pixels. `left`/`top`/`margin-top` are not PROP names and
will not type-check; use `insetL`/`insetT`/`marginT`.

A conditional style object is evaluated **once** where the expression is read.
If the value must follow a signal, use a getter:

```tsx
style={{ get width() { return props.value(); } }}
```

or use a ternary of full classes. For static sizes prefer an inline number.

### Unsupported Tailwind utilities

The compiler supports the documented subset only. In particular:

- `border-b`, `border-t`, `border-l`, `border-r` are **not** supported.
  Use `border` / `border-2` / `border-[N]` for a uniform border, or a 1px
  `View` as a rule.
- `font-mono` only has **12/14/16 px** slots. `font-mono text-xs|sm|base`.
- `rounded-full` requires both `w-N` and `h-N` on the same node.
- Any unknown token makes the whole literal fail to compile; the build prints
  the utility names. Treat those warnings as errors before generating frames.

## 4. Focus and buttons

```tsx
<FocusScope autoFocus>
  <FocusGrid columns={3} wrap class="flex-row flex-wrap gap-[4]">
    <For each={items} by={(item) => item.id}>
      {(item) => (
        <Focusable class="… focus:bg-slate-800 focus:border-emerald-300"
                    onPress={() => open(item())}>
          <Text class="text-xs text-white">{item().title}</Text>
        </Focusable>
      )}
    </For>
  </FocusGrid>
</FocusScope>
```

- `FocusScope autoFocus` gives the screen an initial focus.
- `FocusGrid columns` drives traversal only; visible columns come from tile
  width. Passing `wrap` enables row wrapping.
- Use `focus:` variants for the ring (`focus:border-emerald-300`) so the core
  paints it natively. Do not fake a ring with a timer.
- Global actions use `onButtonPress(BTN.X, fn)` from
  `@pocketjs/framework/lifecycle`; these handlers are blocked while a `Modal`
  is open.
- Handlers fire on the **down edge**. Scripted tapes pulse a button for one
  frame. `latched` is for a screen that mounts under a held button.

Port convention used by every app:

| Input | Action |
|---|---|
| D-PAD | move focus / move the map cursor |
| CIRCLE | confirm / harvest / buy |
| CROSS | back |
| SQUARE | secondary action (scan, mark, search) |
| LTRIGGER / RTRIGGER | previous / next screen |

Document any deviation in the app's verification file.

## 5. Animation and time

```tsx
import { animate, spring } from "@pocketjs/framework/animation";
import { virtualFrame, virtualNow } from "@pocketjs/framework/clock";
import { onFrame } from "@pocketjs/framework/lifecycle";

animate(node, "translateX", targetX, { dur: 140, easing: "out" });
spring(node, "scale", 1.04, { stiffness: 220, damping: 18 });
onFrame((buttons) => { if (virtualFrame() > deadline) setToast(""); });
```

- `animate`/`spring` write a core animation track; the core ticks it. Do not
  move nodes in a `setInterval`/`setTimeout` or with `performance.now()`.
- `onFrame(callback)` receives the current button mask. It is the app frame
  hook; the callback is component-scoped.
- Deadlines use `virtualFrame()`/`virtualNow()`, never wall time. Two runs of
  the same input tape produce the same pixels.

## 6. Fonts and icons

- Text literals are scanned for codepoints automatically; `fonts.json`
  `characters` declares runtime data that never appears in source.
- `fallback` lists faces tried when Inter has no glyph. The ports commit two
  small subsets built from the app's own characters:
  `src/fonts/cjk-subset.otf` (Noto Sans CJK JP) and
  `src/fonts/nerd-subset.ttf` (JetBrainsMono Nerd Font).
- Japanese/Chinese labels must hit the CJK subset. `tools/make-font-subset.py`
  in `pocket-verify` regenerates both files from the source tree; run it after
  adding labels.
- Icons are Nerd Font codepoints in `Text` (`\uF005`, `\uF013`, …), never
  images. The subset script picks up the literal characters declared in
  `fonts.json`; escapes in TS source are extracted by the compiler but not by
  the raw-text subsetter, so keep the icon characters listed in
  `fonts.json.characters`.
- Use the 12 px type grid: `text-2xs` (10), `text-xs` (12), `text-sm` (14),
  `text-base` (16), `text-lg` (18), `text-2xl` (24), `text-4xl` (36).
  `text-2xs` is the dense label size used in these ports.

## 7. Data boundary (`client.ts`)

Every port exports the same functions:

```ts
export interface AppClient {
  readonly source: "fixture" | "http" | "bridge";
  list(): Promise<Item[]>;
  get(id: string): Promise<Item | null>;
  action(name: string, payload?: Record<string, unknown>): Promise<ActionReport>;
}
```

- **fixture** — data baked into the bundle. This is the only adapter used for
  frame generation, and the UI labels it `fixture`.
- **http** — `@pocketjs/framework/net-api` `fetch`. Only valid in the host dev
  profile; the device profile has no `net` capability.
- **bridge** — `host.__pvc?.(JSON.stringify(request))`. The runtime forwards
  the request to the Go daemon on `127.0.0.1:<port>` with a hard timeout.

Components import only `client.ts`; they never import fixture arrays. The
client chooses the adapter once at module init (bridge → http → fixture).

For this round the bridge itself is runtime work. Each verification file states
which adapter the app uses and what the device still needs.

## 8. Build and frames

From `pocket-verify` (SDK at `$SDK`,
`bun` at `$HOME/.bun/bin/bun`):

```sh
export PATH="$HOME/.bun/bin:$PATH"
SDK=$SDK

# admission + TypeScript
bun $SDK/tools/pocket.ts check \
  --runtime-config pjs/profiles/pocket.runtime-config.ts \
  --target rocknix-h700-kms \
  --manifest repos/<repo>/apps/<app>/pocket/pocket.json

# package
bun $SDK/tools/pocket.ts compile \
  --runtime-config pjs/profiles/pocket.runtime-config.ts \
  --target rocknix-h700-kms \
  --manifest repos/<repo>/apps/<app>/pocket/pocket.json \
  --output repos/<repo>/apps/<app>/pocket/out.pocket

# real wasm frames (720x480 PNG, no browser)
bun tools/render-pocket.ts \
  --dir repos/<repo>/apps/<app>/pocket \
  --script repos/<repo>/apps/<app>/pocket/frames.json \
  --out repos/<repo>/docs/pocket
```

`frames.json` is a portable input tape:

```json
{ "frames": 150,
  "events": [{ "frame": 20, "button": "DOWN" }],
  "captures": [{ "frame": 28, "name": "map-selected" }] }
```

Button names come from `BTN` in `contracts/spec/spec.ts`. The renderer uses
`platforms/web/wasm-ops.js` (the same HostOps the browser host installs) and the
SDK's deterministic PNG encoder. It fails if two captures have identical bytes,
which catches a screen that did not change.

## 9. Hard rules

- No iframe, no screenshot-as-texture, no `dangerouslySetInnerHTML`, no DOM.
- No `fetch` in components; only `client.ts` talks to the outside.
- No `performance.now()`, `Date.now()`, `setInterval`, or `setTimeout` for
  product timing.
- No `capabilities` entry the profile does not provide, even to pass a build.
- No PASS without a rendered PNG frame; use BLOCKED and name the missing piece.
- Do not modify the Go daemon's paths or fields during the port. Record a
  needed change as an open question in the app's verification file.
- `frontend/` stays in the repo as the design reference. The README says the
  product target is `pocket/`.
