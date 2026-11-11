# Changelog

## 0.5.1 — 2026-11-11

### Added

- Gluk RTC through DFF7/BFF7 with EFF7 bit-7 access gating, host local time
  refreshed on reads, and BCD/binary and 12/24-hour formats.
- Persist CMOS user RAM (0E–7F) to IndexedDB on writes and restore it on cold
  start; retain it across Reset. Enable RTC by default with a saved Machine
  checkbox below Decode paging.

### Fixed

- Keep TR-DOS catalog Run buttons attached during worker updates so clicks
  complete while emulation is running.
- Reset before starting a disk BASIC program, including expanded-memory
  configurations without the 128K Tape Loader menu.

## 0.5.0 — 2026-11-09

### Added

- Kempston joystick and mouse support.
- Cursor, Sinclair I (67890), Sinclair II (12345) and Kempston keyboard modes.
  Reset and Cold boot restore Cursor. Choose Space, Enter or 0 for fire, with
  optional suppression of the normal Spectrum key.
- Gamepad input enabled by default, with D-pad/left-stick movement and primary
  button fire. Choose a controller when several are connected; hide gamepad
  controls when none are connected. Keyboard Kempston takes exclusive ownership;
  Use gamepad restores Cursor and returns ownership to the selected controller.
- Explicit mouse enable and capture, Capture the mouse on screen clicks only
  when mouse input is enabled and the program has read a mouse port since the
  last Reset or Cold boot. Otherwise, screen clicks only give keyboard focus.
  Explicit Capture mouse remains available, the browser's standard release
  gesture, and a saved left/right button swap option.
- A mouse-port access hint without automatic capture.

## 0.4.0 — 2026-11-06

### Added

- Beta Disk disk emulation on 48K and 128K machines, with drive A, sector
  reads/writes, seek/step, multisector transfers and DOS ROM paging.
- **Basic TRD and SCL loading without a TR-DOS ROM.** Support BASIC disk LOAD/RUN
  through `#3D03`, decimal and literal VAL CODE arguments, and a subset of the
  `#3D13` API for common loaders, including banked RAM loads.
- Import TRD and SCL files directly or inside ZIPs through Files and drag-and-drop.
  Support shortened TRDs; convert SCL to TRD on loading while retaining the
  original archive bytes in the library.
- TR-DOS section with disk catalog, automatic `boot.B` or sole-BASIC startup,
  per-file Run, Eject and TRD download. Writes change a session copy; modified
  eject/replacement/deletion offers Download, Discard or Cancel.
- Select, persist and remove a user-provided TR-DOS ROM independently of Spectrum
  firmware. Unsupported ROM-free operations pause with a visible ROM-required
  message and recovery actions. TR-DOS firmware is not bundled.

### Changed

- Latch all ordinary CPU port reads and writes once on the qualified nIORQ
  high-to-low transition. Hold read data on the CPU bus through sampling and WAIT.
- Retain mounted disk data and modifications across Reset, Cold boot and Spectrum
  ROM replacement. Deleting a mounted disk's Files entry also ejects it.
- Allow ROM-free BASIC files with missing autostart trailers and embedded machine
  code while retaining file bounds checks. Accept either SCL checksum byte order;
  missing or mismatched checksums produce warnings.

### Fixed

- Match TR-DOS next-sector pointers for packed BASIC allocations and exact-sector
  file lengths, allowing Atarin and AcrossTheEdge fix3 loaders to progress without
  a TR-DOS ROM.
- Keep tape and Caps Lock instruction overlays inactive while DOS owns ROM space.
- Make ROM-required stops visible in the main error banner and Machine status,
  expand TR-DOS recovery controls, and explain blocked Run/Step actions.

## 0.3.0 — 2026-11-05

### Added

- Expand the 48K machine with 128K RAM paging, two ROM pages, independent screen
  RAM selection, paging lock, and reset with RAM retention. Keep 48K mode available.
- Bundle the 128K ROM. Accept complete 32 KiB ROM pairs or pair a selected
  16 KiB 128K ROM with the bundled 48K firmware; persist both pages together.
- Show the selected RAM page, ROM page, and screen page in Machine.
- Support flash loading from the bundled 128K Tape Loader menu through keyboard
  input and CPU-executed returns. Preserve the tape cursor across ROM paging,
  load into the selected RAM bank, and honor TZX 48K-only stops by machine mode.
- Add AY-3-8912 sound on 128K machines: register readback, tone, noise, envelopes,
  and timestamped write/reset capture, running at a fixed 1.75 MHz independently
  of CPU turbo.
- Add AY enable, volume, ABC/ACB/Mono stereo routing, and middle-channel mix
  controls. Mix AY and beeper in the worker and deliver pooled stereo PCM through
  AudioWorklet; retain chip state when playback is muted.

### Changed

- Decode paging with A15=0 and A1=0 by default, and accept AY port aliases.
  Retain the saved low-byte FD paging override; even-port reads retain
  FE/keyboard priority.
- Commit CPU I/O writes once on nWR assertion, preserving repeated identical
  writes and their timestamps.
- Replace per-pixel FE capture/audio scanning with one shared, preallocated
  time/value history. Expand colour changes into border spans and integrate
  bit-4 changes for beeper audio while preserving sampling phase.

### Fixed

- Support the paging and AY aliases used by Rage and EyeAche, allowing both demos
  to advance beyond their previous failures.
- Align the cold-start 3.5 MHz CPU clock with raster boundaries, removing the
  one-pixel border-to-paper gap in pent128.tap.

## 0.2.2 — 2026-11-04

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
