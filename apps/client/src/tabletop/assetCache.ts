const DB_NAME = 'ttrpg-assets';
const STORE = 'files';

let opening: Promise<IDBDatabase | null> | null = null;

function database(): Promise<IDBDatabase | null> {
  opening ??= new Promise(resolve => {
    try {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

export async function cachedAsset(key: string): Promise<Blob | null> {
  const db = await database();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function storeAsset(key: string, blob: Blob): Promise<void> {
  const db = await database();
  if (!db) return;
  await new Promise<void>(resolve => {
    try {
      const transaction = db.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put(blob, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
      transaction.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
