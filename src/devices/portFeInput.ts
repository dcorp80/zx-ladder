import type { Device, IoClaim } from "../machine/devices";

/** FE idle wiring: D5/D7 high, EAR (D6) low; keyboard owns D0–D4. */
export class PortFeInputDevice implements Device {
  readonly id = "port-fe-input";
  readonly io: readonly IoClaim[] = [
    {
      lowMask: 1,
      lowValue: 0,
      readMask: 0xe0,
      read: () => 0xa0,
    },
  ];
}
