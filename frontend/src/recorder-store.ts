import type { Draft } from "./useRecorder";
const database = new Promise<IDBDatabase>((resolve, reject) => {
  if (!globalThis.indexedDB) {
    reject(Error("IndexedDB недоступна"));
    return;
  }
  const r = indexedDB.open("slopemate-recorder", 1);
  r.onupgradeneeded = () => {
    r.result.createObjectStore("drafts");
    r.result.createObjectStore("points");
  };
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});
// Attach a rejection handler even before a user starts recording.
void database.catch(() => {});
function finished(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? Error("Запись отменена"));
  });
}
export async function loadDraft(key: string): Promise<Draft | null> {
  const db = await database,
    tx = db.transaction(["drafts", "points"], "readonly");
  const meta = tx.objectStore("drafts").get(key),
    points = tx
      .objectStore("points")
      .getAll(IDBKeyRange.bound([key, 0], [key, Number.MAX_VALUE]));
  await finished(tx);
  return meta.result ? { ...meta.result, points: points.result } : null;
}
export async function persistDraft(
  key: string,
  d: Draft | null,
  append?: Draft["points"][number],
) {
  const db = await database,
    tx = db.transaction(["drafts", "points"], "readwrite"),
    store = tx.objectStore("points");
  if (!d) {
    tx.objectStore("drafts").delete(key);
    store.delete(IDBKeyRange.bound([key, 0], [key, Number.MAX_VALUE]));
  } else {
    const { points, ...meta } = d;
    tx.objectStore("drafts").put(meta, key);
    for (const p of append ? [append] : points) store.put(p, [key, p.t]);
  }
  await finished(tx);
}
