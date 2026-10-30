# ZX Ladder

Hardware-like ZX Spectrum emulator built with Solid and the half-cycle
`@dcorp80/z80cpu` core.

Version **0.1.0** — see [CHANGELOG](CHANGELOG.md). The header displays the package
version; hover over it to see the build commit.

Use Node.js 24. Run `npm ci`, then `npm run dev` and open http://localhost:3000.
On first visit, the bundled **48K ROM** is loaded and saved in IndexedDB.
Press **Run** to start. A previously saved 16 KiB ROM takes precedence and is
restored paused; the Machine section’s file selector can replace it as before.
If the bundled download fails, select your own ROM to continue.

Video preset, Turbo, Free run, border visibility, and theme are saved in
localStorage and restored with the saved ROM. Press Run or Step frame to begin. **System** is the
default theme and follows OS light/dark changes live; **Light** and **Dark**
override it. The theme cache is applied before the first paint.

- **Pause / Step frame** stop execution or finish the next raster frame.
- **Cold boot** recreates the CPU and devices with RAM filled with FFh.
- **Reset** holds the CPU's `nRESET` pin low while pressed (mouse, touch,
  Space, or Enter), for at least six CPU half-cycles. Execution and video
  timing continue. A tap while paused is applied when execution resumes.
- **Turbo** selects 7 MHz CPU operation; the video clock stays at 7 MHz.
  It can be changed while running. The requested divider is latched on the
  next `nM1` low-to-high transition and used from the following pixel slot.
- **Free run** removes real-time pacing and runs as much emulation as fits
  in a 16 ms work budget per RAF, presenting the latest completed frame.
  It switches live without resetting the machine and is independent of CPU
  turbo. FPS reports the resulting emulation speed. Turning it off restores
  real-time pacing without a catch-up burst.
- **Video preset** selects Pentagon or Lviv raster timing on the same machine.
  Switching starts a fresh raster while preserving CPU, RAM, border, turbo,
  and accumulated clocks; a running emulator continues running.
- **Show border** overlays the sampled border latch on captured symbols.
  Turning it off exposes the symbol data captured outside the paper area.

The Pentagon video preset uses 448 × 320 pixels, 71,680 base CPU ticks per
frame, and a derived rate of 48.828125 Hz. Lviv uses 448 × 312 pixels,
69,888 base CPU ticks, and approximately 50.080128 Hz. Rendering includes
sync and blanking. Both use the same uncontended 48K machine and 7 MHz
memory-slot clock. Video presets define raster counters, signal windows,
INT timing, and FLASH advancement/bit selection independently of that clock.
The machine captures pixel and attribute latches as execution progresses,
including the FLASH phase at capture time, and samples border colour per
pixel. RAF controls elapsed-time pacing and presents completed frames.
The FPS indicator measures completed emulator frames against wall-clock
time and updates every 16 frames. Pausing or hiding the tab clears the sample
so inactive time does not lower the next reading.

Memory and I/O devices register their address claims with the bus. Video
registers a clock hook and shares memory slots with CPU MREQ transitions.
The CPU, previous pin state, fetch latches, and counters survive frame
boundaries. RAM uses three plain 16 KiB arrays plus one protected ROM array.

The Keyboard section uses MacBook Pro ISO geometry with Spectrum legends.
Click the screen or keyboard surface to type; configuration controls keep
their normal input. Control maps to Caps Shift, Option to Symbol Shift,
and letters/digits/Return/Space map directly. Ivory keycaps hold Spectrum combinations for arrows, Backspace, and punctuation
(− = ; " # , . /), using ZX-M8XXX mappings. CS means Caps Shift and SS means
Symbol Shift. Host Shift selects punctuation and number-row symbols using the host character
(with positional fallback). Shift-clicks use the positional mapping. The pipe
character uses Caps+Symbol for two emulated frames, then Symbol+S until released;
brackets, braces, and backslash use the same sequence with their corresponding ZX keys. Mouse and touch keys stay down
until released, and multiple input sources can hold the same switch.
Leaving both input areas, hiding the tab, or losing window focus releases
held keys. Only layout/profile choices are saved, never pressed keys.

Keyboard reads drive D0–D4 on even I/O addresses, with A8–A15 selecting
active-low rows. Machine FE input wiring grounds D5–D7, so an idle even-port
read returns `0x1F`; unclaimed odd ports still return `0xFF`. The bus supports disjoint read masks and explicit priority
inhibition for shared ports. State-changing I/O commit notifications and a
general device/UI adapter registry remain future work.

This version supports the FE bit-4 beeper. Tape pulse playback, AY audio, contention, and 128K paging are not implemented. Beeper volume defaults to 20%; saved preferences are preserved.
The initial video wiring uses two V-sync lines for Pentagon and four for
Lviv, and ignores V8 in screen RAM
addressing; off-screen wiring and border-effect alignment remain to be
checked against the intended hardware.

Checks: `npm run typecheck`, `npm test -- --run`, `npm run lint`, and
`npm run build`.

Host Caps Lock state is observed on keyboard and pointer events. The 48K ROM
adapter compares it with FLAGS2 bit 3 at 0x5C6A while the known KEY_INPUT routine
is polling. If different and no user keys are held, it applies a hidden CS+2
matrix chord for up to four emulated frames, waits four release frames, and
rechecks before retrying. It never writes FLAGS2. Focus loss and reset cancel
the chord; the observed host target survives reset. The browser cannot supply
the initial lock state until an input event reports it.

The adapter recognizes the 48K ROM Caps Lock handler byte sequence and is
inactive for unsupported ROMs. 128K needs a separate compatibility review.
The ivory Caps Lock keycap changes the target locally until the next host
Caps Lock state change. Uppercase host letters do not directly add Caps Shift.

Keyboard presets include MacBook Pro ISO and PC full-size (tall Return, separate
arrow cluster and numeric keypad). Automatic selection uses the host platform
as a suggestion; an explicit selection is persisted. Unmapped function/media
and navigation keys are omitted. Numpad digits remain numeric regardless of
Num Lock, operators use Spectrum Symbol Shift chords, and Numpad Enter shares
the ZX Enter switch. PC Quote maps to SS+7, with Shift selecting SS+P; the Mac
preset retains its double-quote mapping.


## Files and flash loading

The Files section stores TAP and TZX files in IndexedDB. Add accepts multiple TAP/TZX/ZIP
files; files can also be dropped anywhere in the emulator window. ZIPs retain
only TAP/TZX members, grouped by archive name with full member paths. Replacements
require confirmation. Archive reimports merge members; deleting a stored file
does not alter the copy already mounted in the machine.

Load performs a warm reset, preserves RAM, resumes execution, waits for the
standard 48K ROM keyboard-input routine, and types `LOAD ""` plus Enter through
the keyboard matrix. Loading is accelerated by intercepting the standard ROM
routine: data goes directly to writable RAM, then the CPU executes temporary
instructions and returns through the real stack, to either ROM cleanup or a
custom RAM loader. No CPU state is restored
and no CPU registers are assigned directly. VERIFY compares RAM and reports
failure on mismatch. Block length/flag/checksum failures return carry clear.

The library is restored after browser restart; tapes are not automatically
mounted or loaded. The ROM remains independently persistent. Unsupported ROMs
are rejected before reset. Custom tape routines requiring pulse playback, snapshots, and saving are
not implemented. ZIP supports stored and deflated entries in modern browsers
with DecompressionStream; encrypted, nested, multi-volume and ZIP64 archives
are not supported. Import limits: 32 MiB per input, 16 MiB per ZIP member,
64 MiB extracted tape data per batch, and 2048 directory entries per ZIP.




TZX flash loading accepts standard, turbo, and pure-data blocks containing whole
Spectrum flag/payload/checksum bytes. Metadata, tones, pulse sequences, and
positive pauses do not consume data blocks. Signed jumps, finite loops and call
sequences determine load order; execution and output limits prevent malformed
control flow from hanging the browser. Stop markers (including stop-in-48K)
end the current flash sequence; resuming beyond a stop is not implemented.
Direct/CSW/generalized recordings, partial-byte data, selection menus, embedded
snapshots and unknown block types are rejected before reset. Accepting turbo
block data does not emulate a custom loader's pulses: the program must still
call the supported ROM entry. TZX parsing follows the
[format specification](https://worldofspectrum.net/TZXformat.html).

## Late INT

The Video section's experimental Late INT checkbox is disabled and off for
both presets. Previously saved opt-ins are ignored. The alternate timing
implementation remains in the core for later investigation.
Horizontal values below are 3.5 MHz counter ticks, not pixel offsets.

| Video preset | Late INT off | Late INT on           |
| ------------ | ------------ | --------------------- |
| Pentagon     | V=240, H=64  | V=242, H=112          |
| Lviv         | V=248, H=160 | V=0 (312 wrap), H=160 |

INT stays active for one line unless acknowledged sooner. FLASH timing is
independent. Changing the option affects future trigger positions and does not
truncate an already active pulse.


## Keyboard and layout preferences

Below 761 CSS pixels, the keyboard uses a compact 40-key Spectrum layout with
Normal, CS, SS, Extended and Extended + SS selectors. Modifiers apply to held virtual
keys; Extended sends CS+SS for two emulated frames before the unshifted key.
Extended + SS holds Symbol Shift with the final key and shows its matching legends.
Release cancels the sequence. Physical keyboard mappings remain unchanged.
Desktop widths retain the selected host keyboard layout.

Keyboard color can follow the page theme or remain Light/Dark independently.
Color and section collapsed/expanded states persist in this browser. Actions
that focus the screen expand Video and save that expanded state. A loaded ROM
with no completed frame displays a Run/Step prompt, including after changing
video preset while paused.

## CI and GitHub Pages

The workflow in `.github/workflows/pages.yml` uses Node 24 and `npm ci`, then
runs lint, typecheck, tests, and the production build for pull requests and
pushes to `main`. Deployment follows Explorer's release-tag/manual pattern:

- Push a `ladder-v*` release tag (for example `ladder-v0.1.0`, after updating
  `package.json` and its lockfile) to publish that revision.
- Alternatively, run **CI and deploy Ladder to GitHub Pages** manually from
  GitHub Actions and select the revision to publish.

Ordinary branch pushes and pull requests validate without publishing. The
workflow uploads only `dist`, enables Pages using the repository's Pages
permission, and publishes through the `github-pages` environment. Deployments
are serialized without cancelling an upload in progress. Repository or
organization policy may require enabling Pages/Actions or approving that
protected environment in GitHub settings.

Vite builds assets under `/zx-ladder/`, matching the expected project URL
`https://dcorp80.github.io/zx-ladder/`. The site includes the AudioWorklet, the separately licensed 48K ROM, and its
notice. Tape images are not bundled. A different repository path
or custom domain requires updating Vite's production `base`. Browser-stored
files and preferences are local to the site's origin, so localhost data does
not automatically appear on the deployed site.


## License and bundled firmware

The emulator source uses the [GNU GPL v3](LICENSE). The bundled firmware is
separately copyrighted and is not covered by that source-code license.

“Amstrad have kindly given their permission for the redistribution of their
copyrighted material but retain that copyright.”

The [ROM notice](public/roms/NOTICE.txt) includes provenance and a link to the
[Amstrad permission statement preserved by Debian](https://sources.debian.org/src/fbzx/3.1.0-1/AMSTRAD/).
The notice is also shipped alongside the ROM on the deployed site.

## Acknowledgments

This project is inspired by [**ZX-M8XXX**](https://github.com/Bedazzle/ZX-M8XXX)
and [**jsspeccy3**](https://github.com/gasman/jsspeccy3).
The idea of hardware-like simulation — **dcorp80**.
