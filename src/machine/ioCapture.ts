/** Longest standard raster; longer custom frames are split at this boundary. */
export const IO_MAX_BATCH_TICKS = 143_360;
/** Four CPU clocks per I/O cycle at maximum turbo, plus a boundary carry-in. */
export const IO_EVENT_CAPACITY = Math.ceil(IO_MAX_BATCH_TICKS / 4) + 1;
