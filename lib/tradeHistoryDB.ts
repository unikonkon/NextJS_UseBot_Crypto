// IndexedDB wrapper for Discord Bot trade history
// Each WatcherRow saves BUY/SELL alerts here for persistence + history view

const DB_NAME = "discordBotDB";
const DB_VERSION = 1;
const STORE_NAME = "trades";

export interface TradeRecord {
  id: string;             // unique id e.g., `${watcherId}-${barOpenTime}-${action}`
  watcherId: string;
  time: number;           // ms timestamp when saved
  symbol: string;
  interval: string;
  strategyName: string;
  action: "BUY" | "SELL";
  price: number;
  barOpenTime: number;
  entryPrice?: number;
  entryTime?: number;
  pnlPct?: number;
  status: "ok" | "error";
  message?: string;
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isBrowser()) {
      reject(new Error("IndexedDB not available (SSR or unsupported browser)"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("watcherId", "watcherId", { unique: false });
        store.createIndex("time", "time", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function addTrade(trade: TradeRecord): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(trade);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function getTradesByWatcher(watcherId: string): Promise<TradeRecord[]> {
  if (!isBrowser()) return [];
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const idx = tx.objectStore(STORE_NAME).index("watcherId");
    const req = idx.getAll(watcherId);
    req.onsuccess = () => {
      db.close();
      const sorted = (req.result as TradeRecord[]).sort((a, b) => b.time - a.time);
      resolve(sorted);
    };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

export async function deleteTrade(id: string): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function deleteAllByWatcher(watcherId: string): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const idx = tx.objectStore(STORE_NAME).index("watcherId");
    const req = idx.openCursor(IDBKeyRange.only(watcherId));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function deleteAllTrades(): Promise<void> {
  if (!isBrowser()) return;
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}
