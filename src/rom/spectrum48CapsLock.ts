import type { KeyboardDevice } from "../devices/keyboard";
import type { BankedMemory } from "../devices/memory";

/** Optional 48K ROM convention, not part of the Spectrum keyboard hardware.
 * FLAGS2 bit 3: https://www.skoolkit.ca/disassemblies/rom/hex/asm/5C6A.html
 * KEY_INPUT handles CS+2 at 0x10DD. Never write the ROM's flag directly.
 */
export class Spectrum48CapsLock {
  readonly supported: boolean;
  private polled = false;
  private pulseFrames = 0;
  private cooldown = 0;
  constructor(
    private readonly memory: BankedMemory,
    private readonly keyboard: KeyboardDevice,
  ) {
    this.supported = [0x21, 0x6a, 0x5c, 0x3e, 0x08, 0xae, 0x77].every(
      (value, offset) => memory.read(0x10dd + offset) === value,
    );
  }
  keyboardPoll(): void {
    this.polled = true;
  }
  reset(): void {
    this.polled = false;
    this.pulseFrames = 0;
    this.cooldown = 0;
    this.keyboard.setHiddenCapsLock(false);
    this.keyboard.romCapsLock = undefined;
  }
  advanceFrame(): void {
    const polled = this.polled;
    this.polled = false;
    const k = this.keyboard;
    if (
      !this.supported ||
      !k.capsSyncActive ||
      k.desiredCapsLock === undefined
    ) {
      this.reset();
      return;
    }
    // Only trust the flag while the known ROM keyboard-input routine runs.
    if (polled) k.romCapsLock = (this.memory.read(0x5c6a) & 8) !== 0;
    if (this.pulseFrames > 0) {
      if (
        k.hasInputSources ||
        --this.pulseFrames === 0 ||
        (polled && k.romCapsLock === k.desiredCapsLock)
      ) {
        k.setHiddenCapsLock(false);
        this.pulseFrames = 0;
        this.cooldown = 4;
      }
      return;
    }
    if (this.cooldown > 0) {
      this.cooldown--;
      return;
    }
    if (!polled || k.hasInputSources || k.romCapsLock === k.desiredCapsLock)
      return;
    k.setHiddenCapsLock(true);
    this.pulseFrames = 4;
  }
}
