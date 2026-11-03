const DATABASE_NAME = 'jadhuman-local-data';
const DATABASE_VERSION = 1;
const STORE_NAME = 'key-value';

interface AppStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const values = new Map<string, string>();
let databasePromise: Promise<IDBDatabase> | null = null;
let initializationPromise: Promise<void> | null = null;
let initialized = false;
let persistenceUnavailable = false;
let writeQueue: Promise<void> = Promise.resolve();

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('IndexedDB request failed.'));
});

const transactionComplete = (transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted.'));
  transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed.'));
});

const openDatabase = (): Promise<IDBDatabase> => {
  if (databasePromise) return databasePromise;

  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this WebView.'));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => reject(request.error || new Error('Unable to open IndexedDB.'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade is blocked.'));
  }).catch((error) => {
    databasePromise = null;
    throw error;
  });

  databasePromise = promise;
  return promise;
};

const readLegacyStorage = (): Map<string, string> => {
  const legacyValues = new Map<string, string>();
  if (typeof window === 'undefined') return legacyValues;

  try {
    for (let index = 0; index < window.localStorage.length; index++) {
      const key = window.localStorage.key(index);
      if (!key) continue;
      const value = window.localStorage.getItem(key);
      if (value !== null) legacyValues.set(key, value);
    }
  } catch (error) {
    console.warn('[appStorage] Could not read legacy localStorage values:', error);
  }

  return legacyValues;
};

export const initializeAppStorage = (): Promise<void> => {
  if (initialized) return Promise.resolve();
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    try {
      const database = await openDatabase();
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const done = transactionComplete(transaction);
      const store = transaction.objectStore(STORE_NAME);
      const [keys, storedValues] = await Promise.all([
        requestResult(store.getAllKeys()),
        requestResult(store.getAll()),
      ]);
      await done;

      keys.forEach((key, index) => values.set(String(key), String(storedValues[index])));

      const legacyValues = readLegacyStorage();
      const entriesToMigrate = [...legacyValues].filter(([key]) => !values.has(key));
      if (entriesToMigrate.length > 0) {
        const migration = database.transaction(STORE_NAME, 'readwrite');
        const migrationDone = transactionComplete(migration);
        const store = migration.objectStore(STORE_NAME);
        entriesToMigrate.forEach(([key, value]) => store.put(value, key));
        await migrationDone;
        entriesToMigrate.forEach(([key, value]) => values.set(key, value));
      }

      legacyValues.forEach((_, key) => window.localStorage.removeItem(key));
    } catch (error) {
      console.error('[appStorage] IndexedDB initialization failed; using in-memory values:', error);
      persistenceUnavailable = true;
      readLegacyStorage().forEach((value, key) => values.set(key, value));
    } finally {
      initialized = true;
      if (typeof document !== 'undefined') {
        const savedTheme = values.get('theme');
        const isDark = savedTheme
          ? savedTheme === 'dark'
          : window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.documentElement.classList.toggle('dark', isDark);
        document.documentElement.classList.toggle('light', !isDark);
        if (document.body) document.body.style.background = isDark ? '#0B1120' : '#F8FAFC';
        const themeColor = document.getElementById('theme-color-meta');
        if (themeColor) themeColor.setAttribute('content', isDark ? '#0B1120' : '#F8FAFC');
      }
    }
  })();

  return initializationPromise;
};

const persistValue = (key: string, value: string | null): void => {
  if (persistenceUnavailable) return;

  writeQueue = writeQueue
    .then(async () => {
      await initializeAppStorage();
      if (persistenceUnavailable) return;

      const database = await openDatabase();
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      const done = transactionComplete(transaction);
      const store = transaction.objectStore(STORE_NAME);
      if (value === null) store.delete(key);
      else store.put(value, key);
      await done;
    })
    .catch((error) => {
      console.error('[appStorage] IndexedDB write failed:', error);
      persistenceUnavailable = true;
    });
};

export const flushAppStorage = (): Promise<void> => writeQueue;

export const appStorage: AppStorage = {
  getItem(key) {
    return values.get(String(key)) ?? null;
  },
  setItem(key, value) {
    const normalizedKey = String(key);
    const normalizedValue = String(value);
    values.set(normalizedKey, normalizedValue);
    persistValue(normalizedKey, normalizedValue);
  },
  removeItem(key) {
    const normalizedKey = String(key);
    values.delete(normalizedKey);
    persistValue(normalizedKey, null);
  },
};
