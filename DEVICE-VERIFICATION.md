# DEVICE VERIFICATION — pocket-galaxy

Status: **DEVICE-PASS** for the captured states. Local host verification is in
`apps/pocket-galaxy/POCKETJS-VERIFICATION.md`.

## Device

- Anbernic RG34XX, Base OS 1.5.2 (h700), kernel 4.9.170 aarch64.
- Access: Debian host -> HX90 -> USB ADB.
- Display: `/dev/fb0`, 720x480 visible page, 32 bpp.
- Runtime: `/mnt/sdcard/System/pocketjs/bin/pocket-linux-kms` (existing boot runtime, not rebuilt or replaced).
- Package: `pocket-galaxy` sha256 `e885b976fa0fc6fa189146fed90162336564d5631d2adcac007c18b4806a5e6c`.
- Deployed to `/storage/pjs/pocket-galaxy/app.pocket` only.

## Procedure

1. Recorded boot launcher pid `1506` and `boot.pocket`
   sha256 `6ed41612bce1723d1eda64b5a0ee9333a105ed498b7085c03267539cf6c1b32d`.
2. Paused the launcher supervisor, stopped the launcher, and started the
   package with the same runtime and `/dev/fb0`.
3. Created a virtual keyboard with `/dev/uinput` and drove the native view
   tree through a FIFO (`uinputd-c`); no host browser and no HTML.
4. Captured `/dev/fb0` with `dd` -> base64 -> PIL.
5. Killed the package, restored the launcher, and read the pid
   `25379` and boot hash back.

Result: launcher pid changed, boot package sha256 stayed
`6ed41612bce1723d1eda64b5a0ee9333a105ed498b7085c03267539cf6c1b32d`. No write to `/storage/System`, `/storage/pocketjs`,
`/storage/baseos.conf` or `/storage/content`.

## Frames

The images are the device framebuffer. The UI was rasterized by the PocketJS
native renderer on the RG34XX, not by host Chrome.

| file | sha256 (first 16) |
|---|---|
| `docs/device/device-galaxy-action.png` | `c2c62029822a92a1` |
| `docs/device/device-galaxy-fb-after.png` | `6a0f63b10301f33b` |
| `docs/device/device-galaxy-fb-before.png` | `d59130e3329b8496` |
| `docs/device/device-galaxy-home.png` | `a34703c746166b2c` |
| `docs/device/device-galaxy-logbook.png` | `027017c3aca57328` |
| `docs/device/device-galaxy-selected.png` | `f9156e234e8d0279` |
| `docs/device/device-galaxy-settings-toggled.png` | `21d224fb07a3b872` |
| `docs/device/device-galaxy-settings.png` | `f92e07d72b1c8338` |
| `docs/device/device-galaxy-shipyard.png` | `bf03176083d1c7c1` |

`device-galaxy-fb-before.png` and `device-galaxy-fb-after.png` are the boot
launcher before and after; they are byte-identical here, which is the intended
restore evidence.

Captured states: 7 states: map, selection, harvest action, shipyard, logbook, settings, settings toggle.
