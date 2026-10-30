# DEVICE VERIFICATION — pocket-galaxy (RG34XX)

Status: **DEVICE-PARTIAL**. The PocketJS package ran on the real RG34XX and
produced real framebuffer frames; the run stopped when the device disappeared
from the USB bus, so the remaining apps and the restore step are unverified.

## Device

- Anbernic RG34XX, Base OS 1.5.2 (h700), kernel 4.9.170 aarch64.
- Access channel: Debian host → HX90 → USB ADB (device serial
  `5c0010894414c802512` while attached).
- Display: `/dev/fb0`, 720×960 virtual (two 720×480 pages), 32 bpp.

## Package

- Local package: `apps/pocket-galaxy/pocket/out.pocket`
- sha256: `087399335578ac0a96df9651481e670ad4e5f1f7120c50f0490396fa41fa72f9`
- Deployed to `/storage/pjs/pocket-galaxy/app.pocket` only.
- No writes to `/storage/System`, `/storage/pocketjs`, `/storage/baseos.conf`
  or `/storage/content`.
- Runtime: existing `/mnt/sdcard/System/pocketjs/bin/pocket-linux-kms`.
- Admission on device:
  `package admitted: /storage/pjs/pocket-galaxy/app.pocket (rocknix-h700-kms)`

## Run

The boot launcher was recorded before the run:

- pid `16570`
- cmdline `pocket-linux-kms --package /mnt/sdcard/System/pocketjs/apps/boot.pocket --fb /dev/fb0 --input /dev/input/event1 --input /dev/input/event0 --input /dev/input/event2`
- `boot.pocket` sha256 `b932d9dd77c326085b2343d54e836ca3cfc6253d8ec3b13b6eaba55b87bab2eb`

`docs/device/device-galaxy-fb-before.png` is the framebuffer before the run and
shows the boot launcher alive.

The launcher supervisor was paused (`kill -STOP` on its parent shell), the
launcher was stopped, and the galaxy package was started with the same runtime
and `/dev/fb0`. A virtual Nerd/FiiO-style input device was created through
`/dev/uinput` and the runtime was started with `--input /dev/input/event3` so
the host could drive the native view tree.

Frames captured from `/dev/fb0` through `dd` → base64 → PIL:

| file | state |
|---|---|
| `docs/device/device-galaxy-home.png` | Galaxy map, initial selection |
| `docs/device/device-galaxy-selected.png` | D-pad RIGHT moved the survey cursor |

Both are 720×480 and show the native PocketJS view tree, not a browser
screenshot. `device-galaxy-home.png` matches the local `docs/pocket/screen-galaxy.png`
layout, which confirms the 360×240 @2x pipeline on the panel.

## Why this is partial

After the two frames the RG34XX disappeared from the HX90 USB bus
(`adb devices` then listed only the unrelated FiiO JM21). The device was not
reachable again from this host, so:

- the remaining galaxy screens were not captured on device;
- the other ten apps were not deployed/run;
- the launcher supervisor/process was not restored and verified with a new pid;
- no post-run `fb-after.png` exists.

No PASS is claimed for device acceptance. The launcher package hash was not
modified; the device was only running the existing runtime with a package from
`/storage/pjs`.

## Host-side status

The host-side refactor for this app is complete and evidenced in
`apps/pocket-galaxy/POCKETJS-VERIFICATION.md` and `docs/POCKETJS-PORT-PATTERN.md`.
