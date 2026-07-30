const DATABASE_NAME = "pack-phase0-file-system-access";
const STORE_NAME = "handles";
const HANDLE_KEY = "destination";

export async function putStoredDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const database = await openDatabase();
  try {
    await request(
      database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(handle, HANDLE_KEY),
    );
  } finally {
    database.close();
  }
}

export async function getStoredDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  const database = await openDatabase();
  try {
    const value = await request(
      database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(HANDLE_KEY),
    );
    return isDirectoryHandle(value) ? value : null;
  } finally {
    database.close();
  }
}

export async function clearStoredDirectoryHandle(): Promise<void> {
  const database = await openDatabase();
  try {
    await request(database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).clear());
  } finally {
    database.close();
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DATABASE_NAME, 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE_NAME))
        open.result.createObjectStore(STORE_NAME);
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("IndexedDB open failed"));
  });
}

function request<T>(idbRequest: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    idbRequest.onsuccess = () => resolve(idbRequest.result);
    idbRequest.onerror = () => reject(idbRequest.error ?? new Error("IndexedDB request failed"));
  });
}

function isDirectoryHandle(value: unknown): value is FileSystemDirectoryHandle {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "directory"
  );
}
