# Changelog

## Unreleased

- Bundle the separately copyrighted 48K ROM with its redistribution notice.
  First visit saves it to browser storage; existing selected ROMs take priority.
- Add project inspirations and hardware-like simulation attribution to README.

## 0.1.0 — 2026-10-30

Initial release of ZX Ladder.

### Added

- Clock-edge Z80 emulation with 48K RAM, user-supplied 16 KiB ROM, warm reset,
  cold boot, frame stepping, live CPU turbo, and maximum-speed free run.
- Pentagon and Lviv video presets with timed pixel/attribute fetches, full-raster
  border capture, FLASH, FPS display, and an orange INT activity overlay.
- FE bit-4 beeper through AudioWorklet, with volume and mute controls. Default
  volume is 20%; free run and pause mute playback.
- MacBook Pro ISO and full-size PC host keyboard layouts, Spectrum legends,
  combined keys, extended sequences, and 48K ROM Caps Lock synchronization.
- Compact 40-key mobile keyboard with Normal, CS, SS, Extended, and Extended + SS
  selectors, plus independent keyboard color preferences.
- Persistent ROM and TAP/TZX file library, ZIP import, overwrite confirmation,
  and flash loading through ROM interception without restoring CPU state.
- System/light/dark themes, saved configuration, persistent section folding,
  and paused startup when restoring a saved ROM.
- Visible application version and build identifier.
- GitHub CI checks and tag-triggered/manual GitHub Pages deployment.

### Current scope

- Late INT is experimental and disabled in the UI for both presets.
- No memory contention, 128K paging, disk controller, snapshots, AY sound,
  or tape pulse playback. TZX support covers the documented flash-load subset.
- ROM and tape images are not bundled.
