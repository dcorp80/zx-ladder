/** Separate database keeps RTC writes independent of the ROM/library schema. */
let database: Promise<IDBDatabase> | undefined;
let pending: Promise<unknown> = Promise.resolve();
function open(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("zx-ladder-rtc", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("cmos");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}
export async function loadRtcRam(): Promise<number[] | undefined> {
  await pending;
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction("cmos").objectStore("cmos").get("ram");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export function saveRtcRam(bytes: number[]): Promise<unknown> {
  const snapshot = bytes.slice();
  pending = pending
    .catch(() => {})
    .then(async () => {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("cmos", "readwrite");
        tx.objectStore("cmos").put(snapshot, "ram");
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    });
  return pending;
}
