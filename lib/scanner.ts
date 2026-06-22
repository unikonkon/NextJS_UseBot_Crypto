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

// สถานะปัจจุบันของบอท (ใช้ทำ heartbeat สรุป — ส่งได้แม้แท่งล่าสุดเป็น HOLD)
export type PositionState = "LONG" | "FLAT" | "NONE";

export interface BotStatusRow {
  bot: Bot;
  state: PositionState; // ทิศ/โพสิชันปัจจุบัน (จากสัญญาณพลิกล่าสุดในชุดข้อมูล)
  lastSignal: SignalAction; // สัญญาณของแท่งปิดล่าสุด (มักเป็น HOLD)
  price: number;
  closeTime: number; // closeTime ของแท่งปิดล่าสุด
  lastFlipSignal: SignalAction | null; // สัญญาณพลิกล่าสุด (BUY/SELL) ที่เจอ
  lastFlipTime: number | null; // closeTime ของแท่งที่เกิดการพลิกล่าสุด
  strategyName: string;
}

// key จัดกลุ่ม: หลาย bot ที่ symbol+interval เดียวกัน ดึง klines ครั้งเดียว
function groupKey(bot: Bot): string {
  return `${bot.symbol.toUpperCase()}|${bot.interval}`;
}

// รันอินดิเคเตอร์ใหม่ทุกครั้ง (computeAll ภายใน runBacktest) แล้วสรุป:
//   - สัญญาณของแท่งปิดล่าสุด (ใช้ขา alert "พลิก")
//   - สถานะ/โพสิชันปัจจุบัน จากสัญญาณพลิกล่าสุดในชุดข้อมูล (ใช้ขา heartbeat)
interface BotAnalysis {
  lastSignal: SignalAction;
  price: number;
  closeTime: number;
  state: PositionState;
  lastFlipSignal: SignalAction | null;
  lastFlipTime: number | null;
}

function analyzeBot(klines: KlineData[], bot: Bot): BotAnalysis | null {
  if (klines.length < 2) return null;
  const { signals } = runBacktest(
    klines,
    bot.strategyId,
    defaultParamsFor(bot.strategyId),
  );
  const idx = signals.length - 1;
  const last = klines[idx];
  if (!last) return null;

  // ไล่ย้อนหาสัญญาณพลิกล่าสุด (BUY/SELL) เพื่อสรุปทิศปัจจุบัน
  let lastFlipSignal: SignalAction | null = null;
  let lastFlipTime: number | null = null;
  for (let i = idx; i >= 0; i--) {
    if (signals[i] === "BUY" || signals[i] === "SELL") {
      lastFlipSignal = signals[i];
      lastFlipTime = klines[i].closeTime;
      break;
    }
  }
  const state: PositionState =
    lastFlipSignal === "BUY" ? "LONG" : lastFlipSignal === "SELL" ? "FLAT" : "NONE";

  return {
    lastSignal: signals[idx],
    price: Number(last.close),
    closeTime: last.closeTime,
    state,
    lastFlipSignal,
    lastFlipTime,
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

// ใช้โดย /api/cron/scan — คืน 2 ชุดจากการรันอินดิเคเตอร์ครั้งเดียวกัน:
//   - candidates: สัญญาณ BUY/SELL บนแท่งที่ "เพิ่งปิด" (ขา alert พลิก)
//   - statuses:   สถานะปัจจุบันของทุกบอท (ขา heartbeat สรุป — รวมที่เป็น HOLD)
export async function evaluateBots(
  bots: Bot[],
  freshnessMin: number,
  limit: number,
): Promise<{
  candidates: SignalCandidate[];
  statuses: BotStatusRow[];
  errors: string[];
  groupsFetched: number;
}> {
  const candidates: SignalCandidate[] = [];
  const statuses: BotStatusRow[] = [];
  if (!bots.length) return { candidates, statuses, errors: [], groupsFetched: 0 };

  const { klinesByGroup, errors, groupsFetched } = await fetchGroups(bots, limit);
  const now = Date.now();
  const freshMs = (freshnessMin > 0 ? freshnessMin : 1) * 60_000;

  for (const bot of bots) {
    const klines = klinesByGroup.get(groupKey(bot));
    if (!klines) continue;
    try {
      const r = analyzeBot(klines, bot);
      if (!r) continue;
      const strategyName = strategyDisplayName(bot.strategyId);

      // ขา heartbeat: เก็บสถานะปัจจุบันของทุกบอทที่ประเมินได้
      statuses.push({
        bot,
        state: r.state,
        lastSignal: r.lastSignal,
        price: r.price,
        closeTime: r.closeTime,
        lastFlipSignal: r.lastFlipSignal,
        lastFlipTime: r.lastFlipTime,
        strategyName,
      });

      // ขา alert: เฉพาะแท่งล่าสุดที่ "พลิก" BUY/SELL และยังสด
      if (r.lastSignal === "HOLD") continue;
      if (now - r.closeTime > freshMs) continue;
      candidates.push({
        bot,
        signal: r.lastSignal,
        price: r.price,
        strategyName,
        closeTime: r.closeTime,
      });
    } catch (err) {
      errors.push(`${bot.id}: ${String(err)}`);
    }
  }
  return { candidates, statuses, errors, groupsFetched };
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
      const r = analyzeBot(klines, bot);
      if (!r) continue;
      rows.push({
        bot,
        signal: r.lastSignal,
        price: r.price,
        strategyName: strategyDisplayName(bot.strategyId),
      });
    } catch (err) {
      errors.push(`${bot.id}: ${String(err)}`);
    }
  }
  return { rows, errors };
}
