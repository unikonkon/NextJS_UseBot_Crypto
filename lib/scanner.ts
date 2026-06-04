import {
  parseKline,
  type BinanceKlineRaw,
  type KlineData,
} from "@/lib/types/kline";
import {
  runBacktest,
  STRATEGIES,
  type SignalAction,
  type StrategyId,
} from "@/lib/backtest";
import type { Bot } from "@/lib/types/bot";

const BINANCE_BASE = "https://api.binance.com";

// ─── strategy helpers ───────────────────────────────────────────
const STRATEGY_IDS = new Set<string>(STRATEGIES.map((s) => s.id));

export function isValidStrategy(id: string): id is StrategyId {
  return STRATEGY_IDS.has(id);
}

export function defaultParamsFor(id: StrategyId): Record<string, number> {
  const s = STRATEGIES.find((x) => x.id === id);
  return s ? { ...s.params } : {};
}

export function strategyDisplayName(id: string): string {
  return STRATEGIES.find((x) => x.id === id)?.name ?? id;
}

// ─── klines (Binance public, ไม่ใช้ key) ────────────────────────
// คืนเฉพาะ "แท่งที่ปิดแล้ว" — ตัดแท่งสุดท้าย (กำลังก่อตัว) ออก
export async function fetchClosedKlines(
  symbol: string,
  interval: string,
  limit: number,
): Promise<KlineData[]> {
  const lim = Math.min(Math.max(Math.floor(limit) || 200, 50), 1000);
  const params = new URLSearchParams({
    symbol: symbol.toUpperCase(),
    interval,
    limit: String(lim + 1), // ดึงเผื่อ 1 แท่งสำหรับตัดแท่งที่ยังไม่ปิด
  });
  const res = await fetch(`${BINANCE_BASE}/api/v3/klines?${params.toString()}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Binance ${symbol} ${interval}: ${res.status} ${detail}`);
  }
  const raw = (await res.json()) as BinanceKlineRaw[];
  const parsed = raw.map(parseKline);
  // ตัดแท่งสุดท้ายถ้ายังไม่ปิด (closeTime > now)
  const now = Date.now();
  if (parsed.length && parsed[parsed.length - 1].closeTime > now) {
    parsed.pop();
  }
  return parsed;
}

// ─── evaluation ─────────────────────────────────────────────────
export interface SignalCandidate {
  bot: Bot;
  signal: SignalAction; // BUY | SELL (HOLD ถูกกรองออก)
  price: number;
  strategyName: string;
  closeTime: number; // closeTime ของแท่งปิดล่าสุด (ใช้กันยิงซ้ำ)
}

export interface PeekRow {
  bot: Bot;
  signal: SignalAction;
  price: number;
  strategyName: string;
}

// key จัดกลุ่ม: หลาย bot ที่ symbol+interval เดียวกัน ดึง klines ครั้งเดียว
function groupKey(bot: Bot): string {
  return `${bot.symbol.toUpperCase()}|${bot.interval}`;
}

// คำนวณสัญญาณแท่งปิดล่าสุดของ bot จากชุด klines ที่ให้มา
function lastSignal(
  klines: KlineData[],
  bot: Bot,
): { signal: SignalAction; price: number; closeTime: number } | null {
  if (klines.length < 2) return null;
  const { signals } = runBacktest(
    klines,
    bot.strategyId,
    defaultParamsFor(bot.strategyId),
  );
  const idx = signals.length - 1;
  const last = klines[idx];
  if (!last) return null;
  return {
    signal: signals[idx],
    price: Number(last.close),
    closeTime: last.closeTime,
  };
}

// ดึง klines เป็นกลุ่มเพื่อลดจำนวนครั้งที่ยิง Binance
async function fetchGroups(
  bots: Bot[],
  limit: number,
): Promise<{
  klinesByGroup: Map<string, KlineData[]>;
  errors: string[];
  groupsFetched: number;
}> {
  const klinesByGroup = new Map<string, KlineData[]>();
  const errors: string[] = [];
  const groups = new Map<string, Bot>();
  for (const b of bots) groups.set(groupKey(b), b);

  await Promise.all(
    [...groups.entries()].map(async ([key, sample]) => {
      try {
        const k = await fetchClosedKlines(sample.symbol, sample.interval, limit);
        klinesByGroup.set(key, k);
      } catch (err) {
        errors.push(String(err));
      }
    }),
  );
  return { klinesByGroup, errors, groupsFetched: klinesByGroup.size };
}

// ใช้โดย /api/cron/scan — คืนเฉพาะสัญญาณ BUY/SELL บนแท่งที่ "เพิ่งปิด"
export async function evaluateBots(
  bots: Bot[],
  freshnessMin: number,
  limit: number,
): Promise<{
  candidates: SignalCandidate[];
  errors: string[];
  groupsFetched: number;
}> {
  const candidates: SignalCandidate[] = [];
  if (!bots.length) return { candidates, errors: [], groupsFetched: 0 };

  const { klinesByGroup, errors, groupsFetched } = await fetchGroups(bots, limit);
  const now = Date.now();
  const freshMs = (freshnessMin > 0 ? freshnessMin : 1) * 60_000;

  for (const bot of bots) {
    const klines = klinesByGroup.get(groupKey(bot));
    if (!klines) continue;
    try {
      const r = lastSignal(klines, bot);
      if (!r || r.signal === "HOLD") continue;
      // เตือนเฉพาะแท่งที่ปิดไม่นาน (กันยิงสัญญาณเก่าตอนบอทเพิ่งเริ่ม)
      if (now - r.closeTime > freshMs) continue;
      candidates.push({
        bot,
        signal: r.signal,
        price: r.price,
        strategyName: strategyDisplayName(bot.strategyId),
        closeTime: r.closeTime,
      });
    } catch (err) {
      errors.push(`${bot.id}: ${String(err)}`);
    }
  }
  return { candidates, errors, groupsFetched };
}

// ใช้โดย /scan (manual) — คืนทุก bot รวม HOLD, ไม่กรอง freshness
export async function peekBots(
  bots: Bot[],
  limit: number,
): Promise<{ rows: PeekRow[]; errors: string[] }> {
  const rows: PeekRow[] = [];
  if (!bots.length) return { rows, errors: [] };

  const { klinesByGroup, errors } = await fetchGroups(bots, limit);
  for (const bot of bots) {
    const klines = klinesByGroup.get(groupKey(bot));
    if (!klines) continue;
    try {
      const r = lastSignal(klines, bot);
      if (!r) continue;
      rows.push({
        bot,
        signal: r.signal,
        price: r.price,
        strategyName: strategyDisplayName(bot.strategyId),
      });
    } catch (err) {
      errors.push(`${bot.id}: ${String(err)}`);
    }
  }
  return { rows, errors };
}
