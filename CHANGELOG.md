# Changelog

## 0.2.2 — 2026-11-04

- Support flash loading from the bundled 128K Tape Loader menu through real
  keyboard input and CPU returns. Preserve mounted tape position across ROM
  paging and load into the selected RAM bank. Honor TZX 48K-only stops by model.

- Add 128K memory paging with cached page references, protected ROM slots,
  independent screen RAM selection, paging lock, and reset with RAM retention.
- Add a saved Machine checkbox selecting exact 7FFD or low-byte FD decoding.
- Bundle the 128K ROM; accept complete 32 KiB ROM pairs or pair a selected
  16 KiB 128K ROM with the bundled 48K firmware. Keep 48K imports supported.

- Compile direct memory dispatch for fully covered pages without interceptors.
  Support conditional, prioritized memory interceptors with pass-through reads
  and writes, retaining backing-memory ROM protection and partial-page decoding.

- Smooth CPU load over 16 frames and throttle running Machine meters to 320 ms.
  Pause bypasses the display throttle and publishes the acknowledged stopped state.

- Flatten raster execution to one resumable frame-position loop and precompute
  INT/FLASH trigger positions when video timing changes.
- Replace full-raster INT capture planes with preallocated start/end intervals,
  preserving ACK timing, frame-boundary clipping and the orange overlay.
- Add CPU load to Machine: the percentage of 7 MHz slots outside HALT in the
  last 16-frame window, independent of host CPU usage and free-run speed.

- Cache stable machine references during execution chunks.
- Accumulate the Ticks meter from processed-slot deltas outside the inner loop.
  Preserve totals through video-preset changes, warm reset, and rejected video
  frames; clear them on cold boot. Update browser profiling to use these deltas.
- Name the worker execution-budget and scheduling-delay constants.

## 0.2.1 — 2026-11-03

### Maintenance

- Updated dependencies to their latest compatible versions including latest CPU
  core fixes.

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
- tape images are not bundled.
