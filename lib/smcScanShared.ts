// ─────────────────────────────────────────────────────────────────
// SMC Scanner — ส่วนที่ client ใช้ได้ (types + constants + ranking)
//
// ห้าม import lib/indicators.ts ที่นี่ (4,300 บรรทัด) — ไม่งั้นจะถูกดึง
// เข้า bundle ฝั่งมือถือทั้งก้อน ทั้งที่การคำนวณจริงอยู่บน server
// การคำนวณอยู่ใน lib/smcScan.ts ซึ่ง re-export ไฟล์นี้ต่อ
// ─────────────────────────────────────────────────────────────────
import type { SMCBias } from "@/lib/indicators";
import type { Interval } from "@/lib/types/kline";

// ═══ SMC variants ════════════════════════════════════════════════
export type SmcVariantId =
  | "smc"
  | "price_action_smc"
  | "pasmc_scalper"
  | "smc_trend_pullback";

export interface SmcVariantConfig {
  id: SmcVariantId;
  name: string;
  shortName: string;
  descTh: string;
  /** จำนวนแท่งขั้นต่ำที่ควรมี เพื่อให้ pivot/structure ทำงานได้จริง */
  minBars: number;
  params: Record<string, number>;
}

export const SMC_VARIANTS: SmcVariantConfig[] = [
  {
    id: "smc",
    name: "Smart Money Concepts (LuxAlgo)",
    shortName: "SMC",
    descTh: "CHoCH/BOS ขาขึ้นในโซนส่วนลด → ซื้อ",
    minBars: 150,
    params: { swingSize: 50, internalSize: 5 },
  },
  {
    id: "smc_trend_pullback",
    name: "SMC Trend Pullback (LuxAlgo)",
    shortName: "Pullback",
    descTh: "รอ pullback เข้า OB/FVG ตามเทรนด์ swing แล้วค่อยเข้า",
    minBars: 80,
    params: { smcpSwing: 20, smcpInternal: 5, smcpUseOB: 1, smcpUseFvg: 1, smcpTpAtr: 4.0, smcpSlAtr: 2.0 },
  },
  {
    id: "price_action_smc",
    name: "Price Action SMC (BigBeluga)",
    shortName: "PA-SMC",
    descTh: "โครงสร้างราคา + OB/sweep กรองด้วยเทรนด์ swing",
    minBars: 150,
    params: { pasmcLen: 5, pasmcObLength: 5, pasmcBuildSweep: 1, pasmcSwing: 50, pasmcUseSwing: 1, pasmcUseOB: 1 },
  },
  {
    id: "pasmc_scalper",
    name: "PA-SMC Scalper (BigBeluga)",
    shortName: "Scalper",
    descTh: "โครงสร้างสั้น (mslen 3) + TP/SL ตาม ATR — สัญญาณถี่",
    minBars: 60,
    params: { pascLen: 3, pascObLen: 3, pascSweep: 1, pascUseOB: 1, pascTpAtr: 3.0, pascSlAtr: 1.5 },
  },
];

export function smcVariant(id: string): SmcVariantConfig {
  return SMC_VARIANTS.find((v) => v.id === id) ?? SMC_VARIANTS[0];
}

// ═══ Binance rate limit ══════════════════════════════════════════
/** REQUEST_WEIGHT limit ของ Binance Spot ต่อ 1 นาที */
export const BINANCE_WEIGHT_LIMIT_1M = 6000;

/**
 * weight ของ 1 call ไป /api/v3/klines
 *
 * Binance เปลี่ยนมาคิดแบบคงที่แล้ว — ไม่ใช่ตาราง 1/2/5/10 ตาม limit อีกต่อไป
 * ตรวจสอบจาก header x-mbx-used-weight-1m: limit 100/500/1000 ล้วนเพิ่มทีละ 2
 * (หน้า /klines เดิมยังใช้ตารางเก่าอยู่ ซึ่งประเมินสูงเกินจริง — ปลอดภัยแต่รอนานเกินจำเป็น)
 *
 * รับ limit ไว้เผื่อ Binance กลับไปคิดแบบขั้นบันไดอีก
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function klineWeight(limit: number): number {
  return 2;
}

export const INTERVAL_MS: Record<Interval, number> = {
  "1s": 1_000,
  "1m": 60_000,
  "3m": 180_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "2h": 7_200_000,
  "4h": 14_400_000,
  "6h": 21_600_000,
  "8h": 28_800_000,
  "12h": 43_200_000,
  "1d": 86_400_000,
  "3d": 259_200_000,
  "1w": 604_800_000,
  "1M": 2_592_000_000,
};

export interface FetchPlan {
  interval: Interval;
  /** โหมด "recent" = ดึงย้อนหลัง N แท่งจากปัจจุบัน */
  limit: number;
  /** โหมด "range" = ระบุช่วงเวลา (ms epoch) */
  startTime?: number;
  endTime?: number;
}

/** ประเมิน weight ของแผนการดึง 1 เหรียญ (ใช้โชว์ก่อนกดสแกน) */
export function estimateWeight(plan: FetchPlan, intervalMs: number): number {
  if (plan.startTime) {
    const end = plan.endTime ?? Date.now();
    const bars = Math.max(1, Math.ceil((end - plan.startTime) / intervalMs));
    return Math.ceil(bars / 1000) * klineWeight(1000);
  }
  if (plan.limit <= 1000) return klineWeight(plan.limit);
  return Math.ceil(plan.limit / 1000) * klineWeight(1000);
}

// ═══ Backtest summary ════════════════════════════════════════════
export interface QuickBacktest {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnlPct: number;
  avgPnlPct: number;
  profitFactor: number;
  maxDrawdownPct: number;
  avgBarsHeld: number;
  bestTradePct: number;
  worstTradePct: number;
  buyAndHoldPct: number;
  /** ไม้ล่าสุด 5 ไม้ (เก่า→ใหม่) สำหรับโชว์ในหน้า detail */
  lastTrades: { entryIdx: number; exitIdx: number; entryPrice: number; exitPrice: number; pnlPct: number; bars: number }[];
}

// ═══ Scan result types ═══════════════════════════════════════════
export interface SmcSignalDetail {
  barIndex: number;
  /** จำนวนแท่ง (ที่ปิดแล้ว) นับจากแท่งที่เกิดสัญญาณถึงแท่งล่าสุด — 0 = แท่งล่าสุด */
  barsAgo: number;
  /** closeTime ของแท่งที่เกิดสัญญาณ */
  time: number;
  price: number;
  structureType: string | null;
  structureLevel: number | null;
  zone: "premium" | "discount" | "equilibrium" | null;
  internalTrend: SMCBias | null;
  swingTrend: SMCBias | null;
  orderBlock: { high: number; low: number; mitigated: boolean } | null;
  fvg: { top: number; bottom: number; filled: boolean } | null;
  tp: number | null;
  sl: number | null;
  /** ป้ายจุดบรรจบ เช่น "CHoCH", "โซนส่วนลด", "อยู่ในกล่อง OB" */
  confluence: string[];
}

export interface CandleWindow {
  /** index ของแท่งแรกในหน้าต่างนี้ เทียบกับ klines เต็ม */
  offset: number;
  t: number[];
  o: number[];
  h: number[];
  l: number[];
  c: number[];
}

/**
 * ข้อมูลกราฟย่อสำหรับการ์ดในลิสต์ — ส่งเฉพาะราคาปิด
 *
 * เดิมส่ง OHLC ครบ (CandleWindow) ซึ่งกิน ~50% ของ payload ทั้งก้อน ทั้งที่
 * การ์ดวาดแค่เส้นราคาปิด พอสแกน 470 เหรียญเลยกลายเป็น 3MB โดยไม่จำเป็น
 * ส่วน OHLC เต็มยังมีอยู่ในหน้ารายละเอียดผ่าน /api/smc-scan/detail
 */
export interface SparkWindow {
  /** ช่วงเวลาของแท่งแรก–แท่งสุดท้าย (พอสำหรับป้ายกำกับ) */
  t0: number;
  t1: number;
  c: number[];
}

// ═══ Detail payload (กราฟเต็ม + เส้นที่ indicator ตี) ═══════════
// โหลดตอนผู้ใช้แตะดูรายละเอียดเท่านั้น เพื่อไม่ให้ payload ของลิสต์บวม

/** เส้นโครงสร้าง CHoCH/BOS — ลากแนวนอนจากแท่ง pivot ถึงแท่งที่ทะลุ */
export interface SmcStructureLine {
  fromIdx: number;
  toIdx: number;
  level: number;
  type: string;
  bias: SMCBias;
}

/** กล่อง Order Block / Fair Value Gap — ลากจากแท่งที่เกิดไปจนจบ (หรือจนถูกลบล้าง) */
export interface SmcZone {
  fromIdx: number;
  toIdx: number;
  top: number;
  bottom: number;
  bias: SMCBias;
  /** OB = mitigated, FVG = filled */
  closed: boolean;
}

/** ช่วงที่ระดับราคาหนึ่งมีผลต่อเนื่อง */
export interface SmcLevelRun {
  fromIdx: number;
  toIdx: number;
  value: number;
}

export interface SmcSwingLabel {
  idx: number;
  price: number;
  type: string;
}

export interface SmcDrawings {
  structures: SmcStructureLine[];
  orderBlocks: SmcZone[];
  fvgs: SmcZone[];
  swingPoints: SmcSwingLabel[];
  /**
   * เส้น TP/SL ที่ active (เฉพาะ variant ที่มี) เก็บแบบ run-length
   * ค่าคงที่ตลอดช่วงที่ถือโพซิชัน — ส่ง array เต็มความยาวจะเป็น null เกือบหมด
   * (5,000 แท่ง = ~50KB ของคำว่า null) run-length เหลือไม่กี่ร้อยไบต์
   */
  tp: SmcLevelRun[] | null;
  sl: SmcLevelRun[] | null;
}

export interface SmcSignalMark {
  idx: number;
  kind: "BUY" | "SELL";
}

export interface SmcDetail {
  symbol: string;
  interval: Interval;
  variant: SmcVariantId;
  bars: number;
  /** แท่งเทียนทั้งหมด (offset = 0 เสมอ) */
  candles: CandleWindow;
  drawings: SmcDrawings;
  signals: SmcSignalMark[];
}

export interface SmcScanRow {
  symbol: string;
  interval: Interval;
  variant: SmcVariantId;
  bars: number;
  lastPrice: number;
  lastCloseTime: number;
  /** สถานะล่าสุดของ SMC: BUY ยังเป็นสัญญาณล่าสุดอยู่ไหม */
  state: "BUY_ACTIVE" | "SELL_ACTIVE" | "NONE";
  buy: SmcSignalDetail | null;
  sell: SmcSignalDetail | null;
  /** % ที่ราคาวิ่งไปแล้วนับจากราคาตอนเกิดสัญญาณ (แยกตามฝั่ง) */
  changeSinceBuyPct: number | null;
  changeSinceSellPct: number | null;
  backtest: QuickBacktest | null;
  candles: SparkWindow | null;
  warning?: string;
}

// ═══ Ranking ═════════════════════════════════════════════════════
export type SignalSide = "buy" | "sell";

/** สัญญาณของฝั่งที่เลือก (null = เหรียญนี้ไม่เคยมีสัญญาณฝั่งนั้นในช่วงข้อมูล) */
export function signalOf(row: SmcScanRow, side: SignalSide): SmcSignalDetail | null {
  return side === "buy" ? row.buy : row.sell;
}

/** % ที่ราคาวิ่งไปนับจากสัญญาณฝั่งที่เลือก */
export function changeOf(row: SmcScanRow, side: SignalSide): number | null {
  return side === "buy" ? row.changeSinceBuyPct : row.changeSinceSellPct;
}

/** สัญญาณฝั่งนี้ยังเป็นสัญญาณล่าสุดอยู่ไหม (ยังไม่มีฝั่งตรงข้ามตามมา) */
export function isLatest(row: SmcScanRow, side: SignalSide): boolean {
  return row.state === (side === "buy" ? "BUY_ACTIVE" : "SELL_ACTIVE");
}

/**
 * เรียงอันดับ "สัญญาณสดใหม่ที่สุด" ของฝั่งที่เลือก — barsAgo น้อยสุดมาก่อน
 * เสมอกันตัดสินด้วยจำนวนจุดบรรจบ (confluence) แล้วตามด้วยเวลาจริง
 */
export function rankBySignal(
  rows: SmcScanRow[],
  side: SignalSide,
  latestOnly = false,
): SmcScanRow[] {
  return rows
    .filter((r) => signalOf(r, side) !== null && (!latestOnly || isLatest(r, side)))
    .sort((a, b) => {
      const A = signalOf(a, side) as SmcSignalDetail;
      const B = signalOf(b, side) as SmcSignalDetail;
      if (A.barsAgo !== B.barsAgo) return A.barsAgo - B.barsAgo;
      const c = B.confluence.length - A.confluence.length;
      if (c !== 0) return c;
      return B.time - A.time;
    });
}

// ═══ Stream protocol (NDJSON) ════════════════════════════════════
export type ScanEvent =
  | { type: "meta"; total: number; interval: Interval; variant: SmcVariantId; estWeight: number; startedAt: number }
  | { type: "progress"; done: number; total: number; symbol: string; usedWeight1m: number; waiting: boolean }
  | { type: "row"; row: SmcScanRow }
  | { type: "error"; symbol: string; message: string }
  | { type: "done"; done: number; total: number; failed: number; usedWeight1m: number; calls: number; elapsedMs: number };
