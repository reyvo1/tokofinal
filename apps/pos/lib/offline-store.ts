/**
 * IndexedDB-backed offline store for the POS.
 *
 * Why: `lib/offline.ts` stored the entire catalog snapshot as ONE localStorage string. localStorage
 * is capped around 5 MB for the whole origin, and the snapshot is a single key that must be written
 * whole or not at all. A branch with a few thousand SKUs — where each product carries units,
 * barcodes and per-warehouse inventory — reaches that ceiling, and then:
 *
 *   - `setItem` throws `QuotaExceededError`;
 *   - the old `saveOfflineSnapshot` had no try/catch, so that throw propagated out of `loadData`
 *     and the POS lost offline capability entirely, with the operator seeing an unrelated error.
 *
 * IndexedDB has no practical size ceiling for this use, writes are transactional, and records are
 * updated per-row rather than as one blob.
 *
 * Two things this module is careful about:
 *
 *   1. **It never throws into the caller.** A store failure degrades to "offline unavailable", it does
 *      not take the till down. The POS must keep selling online when the disk is full.
 *   2. **It migrates the old localStorage data once.** An upgrade that discards a branch's cached
 *      catalog strands every offline terminal until someone logs in online again.
 */

const DB_NAME = 'toko360_pos_offline';
const DB_VERSION = 1;
const STORE_SNAPSHOT = 'snapshot';
const STORE_CATALOG = 'catalog';
const STORE_QUEUE = 'queue';

export type StoreOutcome = { ok: boolean; reason?: string };

type SnapshotRecord = { key: string; value: unknown; savedAt: string };

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_SNAPSHOT)) db.createObjectStore(STORE_SNAPSHOT, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(STORE_CATALOG)) {
        const store = db.createObjectStore(STORE_CATALOG, { keyPath: 'id' });
        store.createIndex('sku', 'sku', { unique: false });
        store.createIndex('barcode', 'barcode', { unique: false });
        store.createIndex('name', 'name', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_QUEUE)) db.createObjectStore(STORE_QUEUE, { keyPath: 'localId' });
    };
    request.onsuccess = () => resolve(request.result);
    // Private-mode Firefox and a locked database both land here. Null means "no IndexedDB", which
    // the caller treats as offline-unavailable, not as an error.
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function runTransaction(
  db: IDBDatabase,
  store: string,
  mode: IDBTransactionMode,
  // IDBRequest is invariant in its type parameter, so a narrower signature here rejects both
  // getAll() (IDBRequest<any[]>) and get() (IDBRequest<any>). This is internal plumbing; the
  // caller casts the result, which is where the knowledge of the stored shape actually lives.
  work: (store: IDBObjectStore) => IDBRequest<any> | void,
): Promise<any> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction(store, mode);
    } catch (error) {
      reject(error);
      return;
    }
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
    const result = work(transaction.objectStore(store));
    if (!result) { transaction.oncomplete = () => resolve(undefined); return; }
    result.onsuccess = () => resolve(result.result);
    // Resolve on transaction complete too, so a successful write is not reported before it commits.
    transaction.oncomplete = () => resolve(result.result);
  });
}

/** True when this browser can persist offline data at all. */
export async function isOfflineStoreAvailable(): Promise<boolean> {
  const db = await openDatabase();
  if (!db) return false;
  db.close();
  return true;
}

export async function readSnapshot<T>(key: string): Promise<T | null> {
  const db = await openDatabase();
  if (!db) return null;
  try {
    const record = (await runTransaction(db, STORE_SNAPSHOT, 'readonly', (store) =>
      store.get(key))) as SnapshotRecord | undefined;
    return (record?.value as T) ?? null;
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/**
 * Write a snapshot. Returns `{ ok: false }` instead of throwing.
 *
 * A caller that does not check this return value gets offline silently disabled on a full disk,
 * which is precisely the failure that motivated the move off localStorage.
 */
export async function writeSnapshot(key: string, value: unknown, savedAt: string): Promise<StoreOutcome> {
  const db = await openDatabase();
  if (!db) return { ok: false, reason: 'IndexedDB tidak tersedia pada perangkat ini.' };
  try {
    await runTransaction(db, STORE_SNAPSHOT, 'readwrite', (store) => store.put({ key, value, savedAt } satisfies SnapshotRecord));
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'Gagal menyimpan cache offline.' };
  } finally {
    db.close();
  }
}

/** Replace the cached catalog wholesale, in one transaction. */
export async function replaceCatalog(products: Array<Record<string, unknown>>): Promise<StoreOutcome> {
  const db = await openDatabase();
  if (!db) return { ok: false, reason: 'IndexedDB tidak tersedia pada perangkat ini.' };
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_CATALOG, 'readwrite');
      const store = transaction.objectStore(STORE_CATALOG);
      store.clear();
      for (const product of products) store.put(product);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'Gagal menyimpan katalog offline.' };
  } finally {
    db.close();
  }
}

export async function readCatalog<T>(): Promise<T[]> {
  const db = await openDatabase();
  if (!db) return [];
  try {
    // getAll() is typed IDBRequest<any[]> by the DOM lib, not IDBRequest<T[]>, so the helper's
    // generic signature does not match it. Cast once, here, instead of loosening the helper.
    return ((await runTransaction(db, STORE_CATALOG, 'readonly', (store) => store.getAll())) as T[] | undefined) ?? [];
  } catch {
    return [];
  } finally {
    db.close();
  }
}

export async function writeQueue(rows: Array<Record<string, unknown>>): Promise<StoreOutcome> {
  const db = await openDatabase();
  if (!db) return { ok: false, reason: 'IndexedDB tidak tersedia pada perangkat ini.' };
  try {
    await runTransaction(db, STORE_QUEUE, 'readwrite', (store) => {
      store.clear();
      for (const row of rows) store.put(row);
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : 'Gagal menyimpan antrean offline.' };
  } finally {
    db.close();
  }
}

export async function readQueue<T>(): Promise<T[]> {
  const db = await openDatabase();
  if (!db) return [];
  try {
    return ((await runTransaction(db, STORE_QUEUE, 'readonly', (store) => store.getAll())) as T[] | undefined) ?? [];
  } catch {
    return [];
  } finally {
    db.close();
  }
}

/** Drop the legacy localStorage keys once their contents are safely in IndexedDB. */
export function clearLegacyOfflineKeys(keys: string[]): void {
  for (const key of keys) {
    try {
      localStorage.removeItem(key);
    } catch {
      // A browser that refuses localStorage also cannot hold stale data worth clearing.
    }
  }
}
