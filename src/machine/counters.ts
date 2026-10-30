/** Float64 slots stay exact beyond the signed 32-bit range. */
export const Counter = {
  pixels: 0,
  cpuEdges: 1,
  frames: 2,
  flash: 3,
  h: 4,
  v: 5,
} as const;
export interface CounterHandle {
  readonly box: Float64Array;
  readonly index: number;
}
export const createCounters = () => new Float64Array(6);
