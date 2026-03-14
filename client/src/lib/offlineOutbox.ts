const DB_NAME = "ucm_outbox";
const DB_VERSION = 1;
const STORE_NAME = "outbox";
const MAX_STATUS_ITEMS = 200;
const MAX_LOCATION_ITEMS = 2000;
const MAX_PHARMACY_ITEMS = 500;

export type OutboxItemType = "trip_status" | "location" | "pharmacy_delivery";
export type OutboxItemStatus = "pending" | "sending" | "failed";

export interface OutboxItem {
  id?: number;
  type: OutboxItemType;
  createdAt: number;
  payload: any;
  attempts: number;
  nextRetryAt: number;
  lastError: string | null;
  orderingKey: string | null;
  sentAt: number | null;
  status: OutboxItemStatus;
}

const RETRY_DELAYS = [2000, 5000, 15000, 45000, 120000, 300000];

function getRetryDelay(attempts: number): number {
  return RETRY_DELAYS[Math.min(attempts, RETRY_DELAYS.length - 1)];
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
        store.createIndex("type", "type", { unique: false });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("orderingKey", "orderingKey", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };
  });
  return dbPromise;
}

function txStore(mode: IDBTransactionMode): Promise<{ store: IDBObjectStore; tx: IDBTransaction }> {
  return openDb().then((db) => {
    const tx = db.transaction(STORE_NAME, mode);
    return { store: tx.objectStore(STORE_NAME), tx };
  });
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function enqueue(type: OutboxItemType, payload: any, orderingKey?: string): Promise<number> {
  const { store } = await txStore("readwrite");
  const item: Omit<OutboxItem, "id"> = {
    type,
    createdAt: Date.now(),
    payload,
    attempts: 0,
    nextRetryAt: 0,
    lastError: null,
    orderingKey: orderingKey || null,
    sentAt: null,
    status: "pending",
  };
  const id = await promisify(store.add(item));
  await enforceMaxItems(type);
  return id as number;
}

async function enforceMaxItems(type: OutboxItemType) {
  const max = type === "trip_status" ? MAX_STATUS_ITEMS : type === "pharmacy_delivery" ? MAX_PHARMACY_ITEMS : MAX_LOCATION_ITEMS;
  const { store } = await txStore("readwrite");
  const index = store.index("type");
  const all: OutboxItem[] = [];
  const request = index.openCursor(IDBKeyRange.only(type));
  await new Promise<void>((resolve) => {
    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        all.push({ ...cursor.value, id: cursor.primaryKey as number });
        cursor.continue();
      } else resolve();
    };
  });
  if (all.length <= max) return;
  all.sort((a, b) => a.createdAt - b.createdAt);
  const toRemove = all.slice(0, all.length - max);
  const sentOnly = toRemove.filter((i) => i.sentAt !== null || i.type === "location");
  for (const item of sentOnly) {
    if (item.id != null) {
      const { store: s2 } = await txStore("readwrite");
      await promisify(s2.delete(item.id));
    }
  }
}

export async function getPendingItems(): Promise<OutboxItem[]> {
  const { store } = await txStore("readonly");
  const all = await promisify(store.getAll());
  const now = Date.now();
  return (all as OutboxItem[])
    .filter((i) => i.sentAt === null && i.nextRetryAt <= now)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export async function markSending(id: number): Promise<void> {
  const { store } = await txStore("readwrite");
  const item = await promisify(store.get(id));
  if (!item) return;
  item.status = "sending";
  await promisify(store.put(item));
}

export async function markSent(id: number): Promise<void> {
  const { store } = await txStore("readwrite");
  const item = await promisify(store.get(id));
  if (!item) return;
  item.sentAt = Date.now();
  item.status = "pending";
  await promisify(store.put(item));
}

export async function markFailed(id: number, error: string, is4xx: boolean): Promise<void> {
  const { store } = await txStore("readwrite");
  const item = await promisify(store.get(id));
  if (!item) return;
  item.attempts += 1;
  item.lastError = error;
  item.status = "failed";
  if (is4xx) {
    item.sentAt = Date.now();
    item.lastError = `PERMANENT: ${error}`;
  } else {
    item.nextRetryAt = Date.now() + getRetryDelay(item.attempts);
  }
  await promisify(store.put(item));
}

export async function getQueuedCount(): Promise<number> {
  const { store } = await txStore("readonly");
  const all = await promisify(store.getAll());
  return (all as OutboxItem[]).filter((i) => i.sentAt === null).length;
}

export async function clearSent(): Promise<void> {
  const { store } = await txStore("readwrite");
  const all = await promisify(store.getAll());
  for (const item of all as OutboxItem[]) {
    if (item.sentAt !== null && item.id != null) {
      const { store: s2 } = await txStore("readwrite");
      await promisify(s2.delete(item.id));
    }
  }
}

type SendFn = (item: OutboxItem) => Promise<{ ok: boolean; status?: number; error?: string }>;

let flushRunning = false;
let flushTimer: ReturnType<typeof setInterval> | null = null;

export async function flushQueue(sendFn: SendFn): Promise<{ sent: number; failed: number; remaining: number }> {
  if (flushRunning) return { sent: 0, failed: 0, remaining: await getQueuedCount() };
  flushRunning = true;

  let sent = 0;
  let failed = 0;
  try {
    const pending = await getPendingItems();

    const statusItems = pending.filter((i) => i.type === "trip_status" || i.type === "pharmacy_delivery");
    const locationItems = pending.filter((i) => i.type === "location");

    const groupedByTrip = new Map<string, OutboxItem[]>();
    for (const item of statusItems) {
      const key = item.orderingKey || "none";
      if (!groupedByTrip.has(key)) groupedByTrip.set(key, []);
      groupedByTrip.get(key)!.push(item);
    }

    for (const [, items] of groupedByTrip) {
      items.sort((a, b) => a.createdAt - b.createdAt);
      for (const item of items) {
        if (!item.id) continue;
        await markSending(item.id);
        const result = await sendFn(item);
        if (result.ok) {
          await markSent(item.id);
          sent++;
        } else {
          const is4xx = result.status != null && result.status >= 400 && result.status < 500 && result.status !== 429;
          await markFailed(item.id, result.error || "Unknown error", is4xx);
          failed++;
          if (!is4xx) break;
        }
      }
    }

    for (const item of locationItems) {
      if (!item.id) continue;
      await markSending(item.id);
      const result = await sendFn(item);
      if (result.ok) {
        await markSent(item.id);
        sent++;
      } else {
        const is4xx = result.status != null && result.status >= 400 && result.status < 500 && result.status !== 429;
        await markFailed(item.id, result.error || "Unknown error", is4xx);
        failed++;
      }
    }
  } finally {
    flushRunning = false;
  }

  return { sent, failed, remaining: await getQueuedCount() };
}

export function startPeriodicFlush(sendFn: SendFn, intervalMs = 30000): void {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    if (navigator.onLine) flushQueue(sendFn).catch(() => {});
  }, intervalMs);

  window.addEventListener("online", () => {
    flushQueue(sendFn).catch(() => {});
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && navigator.onLine) {
      flushQueue(sendFn).catch(() => {});
    }
  });
}

export function stopPeriodicFlush(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
}
