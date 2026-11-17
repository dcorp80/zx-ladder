# ZX Ladder

Hardware-like ZX Spectrum emulator built with Solid and the half-cycle
`@dcorp80/z80cpu` core.

**[Run ZX Ladder in your browser](https://dcorp80.github.io/zx-ladder/)**

Version **0.7.0** — see [CHANGELOG](CHANGELOG.md). The header displays the package
version; hover over it to see the build commit.

**New in 0.7.0: ROM slots, automatic media loading and master sound controls.**
Manage ROM0 and ROM1 independently and choose a saved 48K startup mode. Machine
controls remain available when folded, including Cold boot while running.
Host Shift produces uppercase letters, and mobile CS/SS/Extended controls toggle.

Add or drop one supported media file, directly or inside a ZIP, to load it
automatically. Media Run can jump to the screen while focusing the keyboard;
disable jumping in Settings. Tape and TR-DOS keep their folded state and expose
mounted names and eligible Run buttons in their headers. Reset rewinds tape.
Sound gains header Mute/master volume controls, AY works in either memory mode,
and fresh settings use 10% beeper volume. Pentagon with technical fields hidden
is the default display.

TR-DOS disks support basic TRD and SCL loading without a TR-DOS ROM. A single
imported disk loads into A; Files also offers Mount A, Mount B, or Load for
explicit media selection.
[Disk support and compatibility](#tr-dos-disks).

Use Node.js 24. Run `npm ci`, then `npm run dev` and open the local URL printed by Vite.
On first visit, the bundled **128K ROM pair** is loaded and saved in IndexedDB.
Press **Run** to start. A previously saved ROM takes precedence and is
restored paused; the Machine section's ROM controls can replace either page.
If the bundled download fails, select your own ROM to continue.

Machine has two 16 KiB slots, **ROM0** and **ROM1**, each with its own file
selector and source filename. **Use bundled 128K ROM** replaces both slots,
shown as `128.rom (1/2)` and `128.rom (2/2)`. **Use bundled 48K ROM** replaces
only ROM1 with `48.rom` and leaves ROM0 intact.

- Choosing a 16 KiB file through ROM0 replaces ROM0 only.
- Choosing a 32 KiB file through ROM0 replaces both pages in file order.
- Choosing a 16 or 32 KiB file through ROM1 replaces only ROM1, using the first
  16 KiB. A 32 KiB source is labelled `(1/2)` in that slot.

Other sizes are rejected before either slot changes. Replacing firmware cold
boots the machine, clearing RAM while preserving the running/paused state and
mounted disks, including modifications. ROM changes leave **48K mode** unchanged.
The 128K image contains a modified 48K BASIC ROM1. For 128K startup, ROM0 needs
a compatible ROM1; **Use bundled 128K ROM** restores
the matching pair. Standalone `48.rom` in ROM1 boots directly with **48K mode**
checked. Combining it with the bundled 128K ROM0 while that mode is unchecked
can send execution into the TR-DOS entry area during startup.
Both pages and their separate source filenames save together, so mixed pairs
restore without additional downloads. Old saved 32 KiB images split into their
two pages; old saved 16 KiB images occupy ROM1, leaving ROM0 labelled **Empty**.
Empty slots contain FFh, and restoring an old image leaves the mode setting unchanged.

Machine also shows the current RAM page at C000–FFFF, ROM page at 0000–3FFF,
and physical screen RAM page (5 or 7). These follow the live machine status and
return to RAM 0 / screen 5 after reset, with ROM selected by **48K mode**.

**48K mode** is saved and applies on Reset or Cold boot. It
initializes the 7FFD latch to `30h`: ROM 1 (48K BASIC), RAM 0, screen RAM 5 and
paging locked until reset. Unchecked (the default), reset selects ROM 0 and
unlocks paging. ROM0 and ROM1 remain installed in either mode.
The Machine subtitle follows the active mode; changing the checkbox takes
effect there after Reset or Cold boot.
Paging always uses standard 128K decoding (A15=0 and A1=0). Bits 0–2 select
top RAM, bit 3 selects screen RAM 5/7, bit 4 selects ROM, and bit 5 locks
further paging until reset. Warm reset preserves RAM; cold boot clears RAM.
Video fetches physical screen RAM independently of CPU mappings and CPU address
interceptors, retaining the existing slot arbitration and captured fetch latches.
Flash loading supports the bundled 128K Tape Loader menu and the standard 48K
loader. AY sound remains available in 48K mode; tape pulse playback remains unavailable.


**Gluk RTC** is enabled by default, with a saved checkbox below 48K mode in
Machine. Spectrum software selects a register through DFF7h and reads/writes
data through BFF7h after enabling access with EFF7h bit 7. The 128-byte array
refreshes host local time before data reads and supports BCD/binary and 12/24-hour
formats. User RAM at 0Eh–7Fh saves to IndexedDB on writes, survives Reset, and
restores asynchronously on cold start. Time, alarm and control registers are not
persisted; alarm interrupts and guest-set clock offsets are not emulated.


**384×304 mode (EFF7 bit 6)** in Video reflects the live mode bit. Clicking
it changes the bit; subsequent software writes to EFF7 can set or clear it again.
The latest change wins. Reset and Cold boot clear the mode; changing video
preset preserves it. The mode is not saved between sessions.
While active, **Show border over captured symbols** is disabled and the extended
screen supplies border-region pixels. With technical fields shown, that checkbox
is unchecked; hiding technical fields keeps it checked. Its saved normal-mode
preference returns when those overrides end. The selected canvas view retains
its dimensions when extended mode changes. Pentagon uses the extended screen layout; Lviv applies
the same wiring to its own counters, so software written for Pentagon can look
irregular there. The bit also operates in 48K mode, where software cannot
populate the companion RAM page through normal CPU mappings.

Video preset, Turbo, Free run, technical-field and border visibility, and theme are saved in
localStorage and restored with the saved ROM. Press Run or Step frame to begin. **System** is the
default theme and follows OS light/dark changes live; **Light** and **Dark**
override it. The theme cache is applied before the first paint.

Run/Pause, Step frame, Reset and Cold boot stay in the Machine header and remain
accessible when the section is folded.

- **Run** opens and focuses the visible keyboard after starting. **Pause**
  stops execution without moving focus; **Step frame** finishes the next raster frame.
- **Cold boot** recreates the CPU and devices with RAM filled with FFh. It is
  available while running and preserves the running or paused state.
- **Reset** holds the CPU's `nRESET` pin low while pressed (mouse, touch,
  Space, or Enter), for at least six CPU half-cycles. Execution and video
  timing continue. A tap while paused is applied when execution resumes.
  Releasing Reset while running opens and focuses the keyboard; paused Reset
  leaves focus on its button.
- **Turbo** selects 7 MHz CPU operation; the video clock stays at 7 MHz.
  It can be changed while running. The requested divider is latched on the
  next `nM1` low-to-high transition and used from the following pixel slot.
- **Free run** removes real-time pacing and runs continuous worker batches,
  yielding after a bounded 4 ms work budget and presenting the latest completed frame.
  It switches live without resetting the machine and is independent of CPU
  turbo. FPS reports the resulting emulation speed. Turning it off restores
  real-time pacing without a catch-up burst.
- **Video preset** selects Pentagon (the default) or Lviv raster timing on the same machine.
  While running in a worker, switching takes effect at the next frame boundary.
  The new raster preserves CPU, RAM, border, turbo,
  and accumulated clocks; a running emulator continues running.
- **Show border** overlays the sampled border latch on captured symbols.
  Turning it off exposes the symbol data captured outside the paper area.
- **Show technical fields** is off by default. With it off, the canvas displays only the
  visible screen and border, surrounded by a black frame (8 px on desktop,
  4 px on mobile). Sync, blanking
  and the orange INT overlay are hidden; the border checkbox is checked and
  disabled. Video skips memory reads for hidden symbols, with eligibility
  cached once per eight-slot group. Normal mode skips data reads under the
  border; extended mode retains its visible border data. An EFF7 mode change
  can take until the next complete frame to refresh newly visible data.

The Pentagon video preset uses 448 × 320 pixels, 71,680 base CPU ticks per
frame, and a derived rate of 48.828125 Hz. Lviv uses 448 × 312 pixels,
69,888 base CPU ticks, and approximately 50.080128 Hz. The full view includes
sync and blanking; the visible-only view is 370 × 304 for Pentagon and
352 × 288 for Lviv. Both use the same uncontended machine and 7 MHz
memory-slot clock. Video presets define raster counters, signal windows,
INT timing, and FLASH advancement/bit selection independently of that clock.
The machine captures pixel and attribute latches as execution progresses.
Normal timed capture retains raw attributes with the completed frame's FLASH
phase; rendering applies the inversion. Custom timing that changes FLASH within
visible content retains capture-time resolution. Border colour is reconstructed from
timed FE events. Pixel/attribute latches are captured at the opening of each
eight-slot group across the full raster, including blanking and border regions.
Host extended-mode changes apply at the next frame boundary while
running; guest EFF7 writes affect subsequent memory fetches immediately.
The worker follows elapsed wall time; RAF presents completed frames.
The FPS indicator measures completed emulator frames against wall-clock
time and updates every 16 frames. Pausing or hiding the tab clears the sample
so inactive time does not lower the next reading.

Memory and I/O devices register their address claims with the bus. Video
registers a clock hook and shares memory slots with CPU MREQ transitions.
The CPU, previous pin state, fetch latches, and counters survive frame
boundaries. Memory uses plain 16 KiB physical pages and four cached CPU slot
references. In 128K mode the map is selected ROM / RAM 5 / RAM 2 / selected RAM;
paging swaps references without copying bytes. Writes to CPU slot zero are gated.
Memory pages fully covered by one owner and without interceptors dispatch directly
to that owner. Conditional memory interceptors run in priority order, checking
exact address ranges before handling an access or passing it through to backing
memory. ROM protection stays in the memory handler; I/O decoding is separate.

The Keyboard section places the keyboard first, followed by Cursor keys,
Keyboard layout and Keyboard color selectors, then the legend. Host-key captions
such as `caps lock` and `delete` use lowercase alongside uppercase Spectrum
legends. Changing Cursor keys returns focus to the visible keyboard, including
the compact keyboard on narrow screens. Click the screen or keyboard surface to
type; the layout and color selectors keep their normal input. Control maps to Caps Shift, Option to Symbol Shift,
and unshifted letters/digits/Return/Space map directly. Ivory keycaps hold Spectrum combinations for arrows, Backspace, and punctuation
(− = ; " # , . /), using ZX-M8XXX mappings. CS means Caps Shift and SS means
Symbol Shift. Host Shift + letter sends Caps Shift with that letter, using
the browser's Shift state. The chord remains held until the letter is released.
Host Shift selects punctuation and number-row symbols using the host character
(with positional fallback). Shift-clicks use the positional mapping. The pipe
character uses Caps+Symbol for two emulated frames, then Symbol+S until released;
brackets, braces, and backslash use the same sequence with their corresponding ZX keys. Mouse and touch keys stay down
until released, and multiple input sources can hold the same switch.
Leaving both input areas, hiding the tab, or losing window focus releases
held keys. Layout and input preferences are saved, never pressed keys. Joystick keyboard
modes return to Cursor on Reset and Cold boot.

Keyboard reads drive D0–D4 on even I/O addresses, with A8–A15 selecting
active-low rows. Machine FE input wiring holds unused D5/D7 high and EAR D6 low,
so an idle even-port read returns `0xBF`; idle Kempston joystick reads return `0x00`, and unclaimed
odd ports return `0xFF`. The bus supports disjoint read masks and explicit priority
inhibition for shared ports. Ordinary CPU I/O reads and writes commit once on
the qualified nIORQ transition. A general device/UI adapter registry remains
future work.

Sound supports the FE bit-4 beeper and AY-3-8912 independently of 48K mode. AY uses
FFFD register selection/readback and BFFD data writes (including aliases decoded
with mask C002; even-port reads retain FE/keyboard priority), with a fixed 1.75 MHz clock
independent of CPU turbo. Sound controls include independent Beeper/AY enable and
volume, ABC/ACB/Mono routing, and middle-channel contribution to each speaker.
Beeper volume defaults to 10% and AY volume to 20%; middle contribution defaults
to 50%. Existing saved volume settings are retained.
Unchecking AY enabled disables its port reads/writes and audio contribution;
re-enabling it retains its registers and synthesis state. Reset still resets AY.
The Sound header lists the enabled sources and keeps a Mute checkbox and master
volume slider accessible when folded. Mute and master volume affect only final
playback, leaving source settings, AY ports and emulated state unchanged. Master
volume defaults to 100% and Mute is off; these preferences persist alongside the
source settings. The master control uses one browser audio gain stage.
Gain and routing changes are smoothed. Volume levels use an ideal logarithmic
approximation rather than a measured analog output model. Pause, stepping,
hidden tabs and Free run mute playback. Slow or uneven execution can still
leave gaps; the playback queue fades out and back in instead of switching
abruptly. Tape pulse playback and memory contention remain unimplemented.
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
inactive for unsupported ROMs. Compatibility is cached per physical ROM page;
paging to another ROM cancels pending Caps Lock activity. Tape sessions survive
normal ROM paging, with injected instructions confined to their active ROM.
The ivory Caps Lock keycap changes the target locally until the next host
Caps Lock state change. Uppercase host characters without Host Shift do not
add Caps Shift; Caps Lock keeps its separate synchronization behavior.

Keyboard presets include MacBook Pro ISO and PC full-size (tall Return, separate
arrow cluster and numeric keypad). Automatic selection uses the host platform
as a suggestion; an explicit selection is persisted. Unmapped function/media
and navigation keys are omitted. Numpad digits remain numeric regardless of
Num Lock, operators use Spectrum Symbol Shift chords, and Numpad Enter shares
the ZX Enter switch. PC Quote maps to SS+7, with Shift selecting SS+P; the Mac
preset retains its double-quote mapping.


## Kempston mouse and joystick

The **Kempston** section sits above **Settings**, which is last. **Sound** sits
directly below Keyboard; **Files** follows Tape and TR-DOS. Both Kempston devices are inaccessible while DOS is active; the disk
controller retains its ports.

Below the keyboard, choose **Cursor**, **Sinclair I (67890)**,
**Sinclair II (12345)** or **Kempston**. Cursor preserves normal arrow-key chords
(Caps Shift + 5/6/7/8 for left/down/up/right) and ordinary typing. Reset and Cold
boot restore Cursor. The Sinclair modes map left/right/down/up/fire to
6/7/8/9/0 and 1/2/3/4/5 respectively. Kempston drives port `0x1F`, with active-high
right/left/down/up/fire bits 0–4 and an idle value of zero.

In Kempston's Joystick group, choose **Space**, **Enter** or **0** as the keyboard
fire key. **Suppress Spectrum key** defaults to checked; uncheck it to send both
fire and the key's normal Spectrum input. These settings apply to Sinclair and
Kempston keyboard modes; Cursor keeps normal typing.

Gamepads are enabled by default. Connect a controller and interact with the page
if the browser has not exposed it yet. Click the screen or keyboard to play:
the D-pad or left stick moves and the primary button fires. With one controller,
its name and **Enable gamepad** appear; with several, a selector lets you choose.
With none, gamepad controls are hidden. Selecting keyboard Kempston takes
exclusive ownership of the port. **Use gamepad** returns arrows to Cursor and
restores the enabled controller; choosing Cursor or either Sinclair mode also
returns Kempston ownership to the enabled gamepad. Keyboard and gamepad inputs
are not combined.

Mouse input starts disabled. With **Enable mouse** checked, screen clicks capture
only after the program has read a mouse port since the last Reset or Cold boot.
Until then, clicking the screen only gives it keyboard focus. Press **Capture
mouse** to enable and capture directly at any time. Capture hides the host
cursor and supplies relative movement; mouse-aware Spectrum programs draw their
own cursor. Use the browser's standard release gesture, usually **Escape**, to
release it. Reset, Cold boot, disabling mouse input and leaving the window also
release capture. **Swap left/right buttons** is saved. Wheel extensions are not
implemented.

The mouse exposes wrapping X/Y counters at `0xFBDF`/`0xFFDF` and active-low
buttons at `0xFADF`; unused button bits stay high, so idle buttons read `0xFF`.
**Program accessed Kempston mouse** is a port-access hint, not proof of mouse
support, and never captures automatically.

## Files and flash loading

The Files section stores TAP, TZX, TRD and SCL files in IndexedDB. Add accepts multiple TAP/TZX/TRD/SCL/ZIP
files; files can also be dropped anywhere in the emulator window. ZIPs retain
only TAP/TZX/TRD/SCL members, grouped by archive name with full member paths. Replacements
require confirmation. Archive reimports merge members; deleting a stored file
does not alter a mounted tape. Deleting the mounted TRD or SCL also ejects it.

After saving and any replacement confirmation, an Add/drop operation containing
exactly one supported media file automatically uses **Load**. This includes a
standalone file or the sole supported member of a ZIP; disks use drive A and the
existing boot/sole-BASIC selection. Multiple media files are added to the library
without choosing one. Skipped replacements and failed saves never start loading.

Successful media Run and autorun open Video, scroll to the screen and focus the
keyboard. **Jump to screen on media Run** in Settings defaults to checked;
unchecking it stops the scroll and leaves Video's folded state alone, while
keyboard focus still moves. Machine Run/resume does not scroll.

For tapes, **Mount** inserts the selected TAP or TZX without resetting, running,
or typing into the machine. Enter `LOAD ""` in BASIC to read it. The **Tape**
section shows the mounted filename, Spectrum headers, data blocks, sizes,
checksum warnings and the next block to read. **Select** positions the tape at
that block; **Rewind** returns to the beginning, and **Eject** removes the mounted
copy while retaining the stored file. Reset keeps the mounted tape and rewinds it;
cold boot, ROM replacement and browser restart clear them. Disk startup uses a
separate temporary tape and retains the mounted user tape. TZX catalogs show the
resolved flash-load sequence, including repeated data blocks from loops, rather
than waveform or metadata blocks.
The header shows the mounted filename while folded and offers Run when the tape
contains exactly one runnable BASIC program.
Mounting, loading and Run preserve the Tape and TR-DOS sections' folded state.
TR-DOS still opens for a modified-disk decision or a ROM-required recovery.

**Run**, beside Select on complete BASIC programs, resets and starts loading
from that program's header. It uses the mounted copy, even if the library file
was replaced or deleted. Saved autostart lines are honored; programs saved
without an autostart line run from their first line. Run uses a temporary header
for that load and preserves the original tape. CODE and array blocks have no Run
button because they do not specify a standalone execution entry point.

Load validates the tape before changing the machine. With the bundled 128K ROM
and 48K mode unchecked, it resets to the main menu, waits for its verified keyboard
polling loop, and presses Enter through the keyboard matrix to select Tape Loader.
With 48K mode checked and a supported ROM1, it resets, waits for BASIC, and types
`LOAD ""` plus Enter. Reset itself preserves RAM, but the 128K firmware's boot
routine clears RAM. Ordinary ROM paging retains the tape cursor, and flash copies use
the currently selected RAM pages, including banked loads above C000.

Loading is accelerated by intercepting the standard ROM
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
64 MiB extracted media data per batch, and 2048 directory entries per ZIP.




TZX flash loading accepts standard, turbo, and pure-data blocks containing whole
Spectrum flag/payload/checksum bytes. Metadata, tones, pulse sequences, and
positive pauses do not consume data blocks. Signed jumps, finite loops and call
sequences determine load order; execution and output limits prevent malformed
control flow from hanging the browser. Unconditional stop markers end the current
flash sequence; resuming beyond a stop is not implemented. Stop-in-48K markers
end the sequence only on a 48K machine and are skipped on a 128K machine. Library
validation follows the 128K path so that 128K-only tapes can be imported; loading
applies the actual machine mode.
Direct/CSW/generalized recordings, partial-byte data, selection menus, embedded
snapshots and unknown block types are rejected before reset. Accepting turbo
block data does not emulate a custom loader's pulses: the program must still
call the supported ROM entry. TZX parsing follows the
[format specification](https://worldofspectrum.net/TZXformat.html).

## TR-DOS disks

**Basic TRD and SCL support works without a TR-DOS ROM**, on both 48K and 128K
machines. Ladder handles standard BASIC disk loading and common sector-loading
calls, including banked multiloaders. Programs using unsupported DOS routines
pause with a clear ROM-required message; add your own TR-DOS ROM to continue.
The TR-DOS ROM is optional and is never bundled.

Files offers **Mount A** and **Mount B** for TRD and SCL images. Mounting inserts
the disk without resetting or starting the machine. Each drive has its own
catalog, Run, Eject and Download TRD controls. The two drive panels sit side by
side in rounded panels on wide screens; drive B appears below drive A on narrow screens. Tape and
TR-DOS use the same catalog typography, row dividers and action spacing.
The folded header shows the mounted A/B filenames and a Run button for each drive
with an eligible boot/sole-BASIC program. ROM selection and its quiet status note
sit below the drive panels, matching the Spectrum ROM status presentation.

**Load** retains the drive A autoload workflow: `boot.B`, or the sole BASIC file
when no boot exists, runs automatically. Running a BASIC file in either drive
resets and starts the machine; subsequent unprefixed disk loads use that drive.
Loading a disk without a boot candidate leaves execution intact.
Full-size and shortened 40/80-track single/double-sided TRD images are supported.
Images must contain complete 256-byte sectors and fit the geometry
declared in the system sector. Omitted trailing sectors read as zero; writes
extend the runtime image as needed without changing the imported original.

SCL files are kept in Files in their original form and converted to a standard
640 KiB TRD only when loaded. Conversion preserves every file descriptor and
sector payload, including embedded machine code and the current relaxed BASIC
handling. Catalog, boot selection, writes, eject and ROM-free loading share the
TRD path. **Download TRD** exports the writable disk as `.trd`, even when the
source was SCL. SCL export is not implemented. A conversion cannot recover the
original disk positions omitted by SCL, so hardcoded sector loaders may fail.
SCL checksum bytes may be little- or big-endian; both are accepted. Missing or
mismatched checksums are warnings. Truncated descriptors/payloads, more than 128
files or data exceeding disk capacity are rejected before mounting.

Select a 16 KiB ROM in TR-DOS when needed; it persists independently of Spectrum
firmware. **Remove ROM** clears the active
and saved TR-DOS ROM while retaining both mounted disks and their changes. Execution
pauses if DOS currently owns ROM space. Without it, Ladder implements
`#3D03` BASIC LOAD/RUN with literal filenames (including `B:name`), `*"B"` drive
selection, and optional decimal CODE address
and length (including literal `VAL "25088"` forms), plus a limited `#3D13` API:
functions 00–06, 08, 0A, 0E, 13, 14, 17, 18 (hexadecimal), and workspace
initialization at `#3D21`. Unsupported syntax, services, ROM data access and
entry through `#3D00`/`#3D2F` pause with
“You need to provide TR-DOS ROM” in the main error banner and Machine status;
the TR-DOS section expands to show recovery actions. Run/Step repeat that
explanation while blocked. Select a ROM and press Run to retry the pending
fetch; programs relying on earlier ROM-free state may need reset and reload.
Reset and Cold boot are offered if no ROM is supplied. ROM-free BASIC loading
checks file bounds and program/variables lengths, but permits missing autostart
trailers and embedded machine code. A missing or unrecognized trailer defaults
Run to the beginning of the program.
A supplied ROM interprets the original metadata itself.

The Beta Disk controller implements sector reads/writes, seek/step, multisector
transfers, force interrupt and synthetic read-address data. Seek is immediate,
bytes transfer on demand, and index pulses follow emulated time. Raw-track
formatting and timing/protection tricks are unsupported. DOS paging changes on
opcode-fetch MREQ assertion before supplying the same opcode. Standalone 48K
BASIC is eligible; 128K entry requires 7FFD bit 4. Fetching RAM exits DOS. DOS port
claims use this latch even without media; tape/Caps Lock overlays are suppressed.
All ordinary CPU port reads/writes latch once at qualified IORQ assertion.

Each drive owns an independent writable session copy, even when both mount the
same Files entry. **Download TRD** exports that drive without overwriting the
Files original. Modified eject/replacement/deletion offers Download, Discard or
Cancel for the affected drive. Deleting a library entry mounted in both drives
confirms any changes in each before ejecting either copy. Reset, Cold boot and
Spectrum ROM replacement retain both mounted disks and
modifications; browser restart does not retain unsaved runtime changes.

An optional integration check uses your own firmware without redistributing it:
`TRDOS_ROM=/absolute/path/trdos.rom npx vitest run src/rom/trdos.test.ts src/rom/driveB.test.ts`.

## Interrupt timing

Each video preset has a fixed INT trigger position.
Horizontal values below are 3.5 MHz counter ticks, not pixel offsets.

| Video preset | INT trigger  |
| ------------ | ------------ |
| Pentagon     | V=240, H=64  |
| Lviv         | V=248, H=160 |

INT stays active for one line unless acknowledged sooner. FLASH timing is
independent.


## Keyboard and layout preferences

Below 761 CSS pixels, the keyboard uses a compact 40-key Spectrum layout with
three toggles: **CS**, **SS** and **Extended**. All off means normal typing.
Tap CS then SS, or SS then CS, to enter Extended with both shifts cleared.
In Extended, SS toggles Symbol Shift for the final key; CS leaves Extended
and selects Caps Shift. The Extended button turns Extended on or off and
clears both shifts. Each virtual key press uses the current selection; changing
a toggle leaves already-held keys unchanged. Extended sends CS+SS for two
emulated frames before the selected key. Releasing the key cancels the sequence.
Physical keyboard mappings remain unchanged. Desktop widths retain the selected
host keyboard layout.

Keyboard color can follow the page theme or remain Light/Dark independently.
Color and section collapsed/expanded states persist in this browser. Actions
that focus the screen expand Video and save that expanded state. A loaded ROM
with no completed frame displays a Run/Step prompt, including after changing
video preset while paused.

## CI and GitHub Pages

The workflow in `.github/workflows/pages.yml` uses Node 24 and `npm ci`, then
runs lint, typecheck, tests, and the production build for pull requests and
pushes to `main`. Deployment follows Explorer's release-tag/manual pattern:

- Push a `ladder-v*` release tag (for example `ladder-v0.5.0`, after updating
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
`https://dcorp80.github.io/zx-ladder/`. The site includes the AudioWorklet, the separately licensed 48K and 128K ROMs, and their
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

## Worker execution

Browsers with Web Worker support run CPU, memory, devices and timed raster
capture in a dedicated module worker. The UI sends ordered commands and receives
status snapshots and completed raw captures. The main thread expands captured
pixels, attributes, FE border events, mode transitions and INT endpoints directly
into reusable canvas ImageData. Packed palette writes and static raster spans
reduce expansion work. Machine-side video storage uses plain arrays; capture
views and output buffers are reused. Mode histories grow when needed and retain
their storage across frames. Without Worker support, the synchronous adapter
remains available.

Worker frame packets contain only the pixel/attribute planes and active event
records, with dense data retained when needed. Transfer and receive buffers
start small, grow for larger packets and reuse their capacity. The packet view
and receive copy cover only used bytes; machine capture timing stays unchanged.

The default eight-slot video clock keeps its countdown local to each execution
chunk; custom clock hooks retain the generic scheduler. Pixel and attribute
address tables switch when extended mode changes, preserving fetch order and
shared memory arbitration.

Execution yields between bounded 4 ms batches. Free run uses a MessageChannel
scheduler to yield without nested-timer clamping. Normal mode uses the same
prompt continuations until a frame is complete, then waits for its accumulated
presentation deadline. A timer wakes 3 ms early, followed by yielding task checks
until the frame is due. Late frames publish immediately with bounded catch-up.
Tab visibility pauses execution without losing run intent. Run,
Pause, frame stepping, reset, turbo, presets, keyboard and tape loading remain
available. Worker failures stop execution and display an error; Cold boot can
create a fresh worker.

The CPU load meter shows the percentage of 7 MHz raster slots outside HALT in
the last 16-frame sampling window (0% continuously halted, 100% continuously active).
It measures emulated activity, not host CPU usage; busy-wait loops count as active.
It samples once per 16 frames (about 0.32 seconds at normal speed) and shows an
em dash until the first full window after cold boot or a preset change.
Machine meters refresh at most once every 320 ms while running; video remains
unthrottled. Pausing immediately publishes the acknowledged stopped counters,
PC and position, while CPU load retains its latest completed-window average.

The Ticks meter counts elapsed 7 MHz raster slots, independently of CPU turbo.
Execution chunks report processed-slot deltas; the UI adds each delta once,
including work from discarded video frames. Video-preset changes and warm reset
preserve the total; cold boot clears it. A separate machine-local monotonic slot counter timestamps audio capture across
raster rephasing.

One reusable display buffer is transferred at a time; missed presentation frames
are skipped while emulation continues. The worker integrates beeper and AY on a
shared sample clock and mixes stereo PCM. Pools of 32 reusable 256-frame buffers
bound each audio transport stage; unavailable buffers drop PCM, never chip events.
FE and AY write capture use preallocated ordinary arrays; reset intervals may
allocate. FE keeps one shared full-byte time/value history for beeper and border.
Audio integrates bit-4 transitions; rendering expands colour changes into border
spans, with no per-pixel FE sampling or dense audio scan. Writes after a slot's
border sampling point become effective in the next slot, preserving timing.
The UI retains its reusable canvas ImageData, browser storage and AudioContext;
a stereo AudioWorklet removes DC at 20 Hz before its bounded playback queue,
preserving the previous filter response. Filter state carries across PCM blocks
and underruns; an explicit playback reset initializes it from the next input.
The queue uses 128-sample fades at stops and restarts, finishing a fade-out before
resuming playback. The beeper retains its separate 8 kHz low-pass. Browser sample
rates from 8 to 192 kHz are supported. No SharedArrayBuffer or cross-origin-isolation headers are needed.

The worker adapter exposes acknowledged pause, raster-slot stepping and coherent
memory inspection. CPU instruction/half-cycle stepping, breakpoints and a
visible debugger are future work. Status displayed while running is a snapshot,
not direct access to live worker memory.

## Acknowledgments

This project is inspired by [**ZX-M8XXX**](https://github.com/Bedazzle/ZX-M8XXX)
and [**jsspeccy3**](https://github.com/gasman/jsspeccy3).
The idea of hardware-like simulation — **dcorp80**.
