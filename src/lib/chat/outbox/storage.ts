/**
 * Where the outbox keeps its text between page loads: IndexedDB first, localStorage when IndexedDB is missing or
 * refuses (a private window, a blocked profile), nothing at all when both refuse (the queue then lives for the
 * page only). Every access is inside try/catch: storage may be blocked, full or gone, and the screen must work the same.
 *
 * One value per person (`outboxKey(userId)`), a small JSON text. The adapters are tiny on purpose so the queue is
 * tested with an in-memory one (`memoryOutboxStorage`) and the fallback rule is tested with two fakes.
 */
export interface OutboxStorage {
  load(key: string): Promise<string | null>;
  save(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
  /** every key that starts with `prefix` (sign-out) */
  removeAll(prefix: string): Promise<void>;
}

/** In memory: tests, and the last resort when the browser offers nothing. */
export function memoryOutboxStorage(initial: Record<string, string> = {}): OutboxStorage & { dump(): Record<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    load: async (key) => map.get(key) ?? null,
    save: async (key, value) => void map.set(key, value),
    remove: async (key) => void map.delete(key),
    removeAll: async (prefix) => {
      for (const key of [...map.keys()]) if (key.startsWith(prefix)) map.delete(key);
    },
    dump: () => Object.fromEntries(map),
  };
}

/**
 * `primary` (IndexedDB) with `fallback` (localStorage) behind it. A write goes to the primary and removes the
 * fallback's copy; when the primary refuses, the fallback keeps it (and the primary's old copy is removed if it can be,
 * so a later read never answers with a stale one). A read asks the primary, then the fallback.
 */
export function composeOutboxStorage(primary: OutboxStorage | null, fallback: OutboxStorage | null): OutboxStorage {
  const quietly = async (fn: (() => Promise<unknown>) | undefined): Promise<boolean> => {
    if (!fn) return false;
    try {
      await fn();
      return true;
    } catch {
      return false;
    }
  };
  return {
    async load(key) {
      if (primary) {
        try {
          const v = await primary.load(key);
          if (v !== null) return v;
        } catch {
          /* fall through to localStorage */
        }
      }
      if (fallback) {
        try {
          return await fallback.load(key);
        } catch {
          return null;
        }
      }
      return null;
    },
    async save(key, value) {
      if (primary && (await quietly(() => primary.save(key, value)))) {
        await quietly(fallback ? () => fallback.remove(key) : undefined);
        return;
      }
      await quietly(primary ? () => primary.remove(key) : undefined);
      if (fallback) await fallback.save(key, value);
    },
    async remove(key) {
      await quietly(primary ? () => primary.remove(key) : undefined);
      await quietly(fallback ? () => fallback.remove(key) : undefined);
    },
    async removeAll(prefix) {
      await quietly(primary ? () => primary.removeAll(prefix) : undefined);
      await quietly(fallback ? () => fallback.removeAll(prefix) : undefined);
    },
  };
}

// ---------- the browser's own ----------

/** localStorage as an OutboxStorage, or null when there is none or it refuses to be touched. */
export function localStorageOutbox(): OutboxStorage | null {
  let ls: Storage;
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    ls = window.localStorage;
  } catch {
    return null;
  }
  return {
    load: async (key) => ls.getItem(key),
    save: async (key, value) => ls.setItem(key, value),
    remove: async (key) => ls.removeItem(key),
    removeAll: async (prefix) => {
      const keys: string[] = [];
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (k && k.startsWith(prefix)) keys.push(k);
      }
      for (const k of keys) ls.removeItem(k);
    },
  };
}

const DB_NAME = "zaki-outbox";
const STORE = "kv";

/** IndexedDB as an OutboxStorage, or null when the browser has none. */
export function indexedDbOutbox(): OutboxStorage | null {
  try {
    if (typeof indexedDB === "undefined" || !indexedDB) return null;
  } catch {
    return null;
  }
  let opened: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    opened ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => {
        opened = null;
        reject(req.error ?? new Error("indexeddb"));
      };
      req.onblocked = () => {
        opened = null;
        reject(new Error("indexeddb-blocked"));
      };
    });
    return opened;
  };
  const run = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> => {
    const db = await open();
    return new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = work(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error ?? new Error("indexeddb"));
      tx.onabort = () => reject(tx.error ?? new Error("indexeddb-abort"));
    });
  };
  return {
    load: async (key) => {
      const v = await run<unknown>("readonly", (s) => s.get(key));
      return typeof v === "string" ? v : null;
    },
    save: async (key, value) => void (await run("readwrite", (s) => s.put(value, key))),
    remove: async (key) => void (await run("readwrite", (s) => s.delete(key))),
    removeAll: async (prefix) => {
      await run("readwrite", (s) => {
        const range = IDBKeyRange.bound(prefix, `${prefix}￿`);
        return s.delete(range);
      });
    },
  };
}

/** The browser's storage for the outbox: IndexedDB, then localStorage behind it. */
export function browserOutboxStorage(): OutboxStorage {
  return composeOutboxStorage(indexedDbOutbox(), localStorageOutbox());
}
