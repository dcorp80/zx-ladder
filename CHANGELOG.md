# Changelog

## 0.2.0 — 2026-10-30

### Performance

- Move CPU execution, devices, tape loading, raster capture and rendering into a
  dedicated Web Worker, keeping the UI responsive during emulation and free run.
- Bound execution batches and reuse display/audio transfer buffers. Reject stale
  presentation data after reset or configuration changes and keep message queues
  bounded.
- Reuse canvas ImageData and skip uploads when no completed frame or display
  setting has changed. Present only the latest available frame during catch-up.
- Retain the synchronous adapter when Worker is unavailable. Worker failures stop
  execution and report an error without silently replacing the machine state.

### Added

- Acknowledged pause, raster-slot stepping and memory inspection as foundations
  for a future debugger; debugger UI and breakpoints are not included yet.
- Repeatable browser profiling tool for throughput, worker/main-thread CPU
  samples, canvas upload cost and command round trips. Performance results depend
  on the host, browser and emulated workload; no universal speedup is claimed.
- Bundled, separately copyrighted 48K ROM with its redistribution notice.
  First visit saves it to browser storage; existing selected ROMs take priority.
- Published demo link, project inspirations and hardware-like simulation
  attribution in README.

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
