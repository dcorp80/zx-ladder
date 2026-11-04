/** Float64 slots stay exact beyond the signed 32-bit range. */
export const Counter = {
  cpuEdges: 0,
  frames: 1,
  flash: 2,
  h: 3,
  v: 4,
} as const;
export interface CounterHandle {
  readonly box: Float64Array;
  readonly index: number;
}
export const createCounters = () => new Float64Array(5);
