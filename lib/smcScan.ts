// ─────────────────────────────────────────────────────────────────
// SMC Scanner — ส่วนที่ต้องใช้ indicators (server-only ในทางปฏิบัติ)
// ใช้โดย app/api/smc-scan/route.ts
//
// จุดต่างจาก lib/backtest.ts: ที่นี่ "ไม่เรียก computeAll()"
// เพราะ computeAll คำนวณ indicator ทั้ง ~30 ตัวต่อ 1 เหรียญ ซึ่งแพงเกินไป
// เมื่อสแกนทั้งหมวด (สูงสุด 40 เหรียญ) — เรียกเฉพาะฟังก์ชัน SMC ที่ต้องใช้
//
// types/constants ที่ client ต้องใช้อยู่ใน lib/smcScanShared.ts
// ─────────────────────────────────────────────────────────────────
import {
  smartMoneyConcepts,
  priceActionSMC,
  priceActionSMCScalper,
  smcTrendPullback,
  type SMCBias,
} from "@/lib/indicators";
import type { KlineData, Interval } from "@/lib/types/kline";
import {
  BINANCE_WEIGHT_LIMIT_1M,
  klineWeight,
  smcVariant,
  type FetchPlan,
  type CandleWindow,
  type QuickBacktest,
  type SmcScanRow,
  type SmcSignalDetail,
  type SmcVariantId,
  type SmcDetail,
  type SmcStructureLine,
  type SmcSwingLabel,
  type SmcSignalMark,
  type SmcLevelRun,
  type SmcZone,
} from "@/lib/smcScanShared";

export * from "@/lib/smcScanShared";

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ═══ Binance rate limit gate ═════════════════════════════════════
/**
 * ตัวคุม rate limit ฝั่ง server — ใช้ค่า x-mbx-used-weight-1m ที่ Binance ส่งกลับ
 * เป็นแหล่งความจริง (นับรวมทุก request จาก IP นี้ ไม่ใช่แค่การสแกนรอบนี้)
 */
export class WeightGate {
  usedWeight1m = 0;
  lastUpdate = 0;
  calls = 0;
  sessionWeight = 0;
  /** เผื่อ headroom ไว้ให้ traffic อื่นของแอป (bot/หน้า trading) ใช้ */
  constructor(private readonly ceilingPct = 0.85) {}

  get ceiling(): number {
    return BINANCE_WEIGHT_LIMIT_1M * this.ceilingPct;
  }

  /** อ่าน header หลัง fetch สำเร็จ */
  observe(res: Response, costFallback: number): void {
    const h = parseInt(res.headers.get("x-mbx-used-weight-1m") ?? "", 10);
    this.usedWeight1m = Number.isFinite(h) ? h : this.usedWeight1m + costFallback;
    this.lastUpdate = Date.now();
    this.calls += 1;
    this.sessionWeight += costFallback;
  }

  /**
   * รอจนกว่าจะมี capacity พอสำหรับ cost — คืน ms ที่รอไปทั้งหมด
   * Binance รีเซ็ตตัวนับทุกต้นนาที ถ้าค่าที่เห็นเก่ากว่า 65s ถือว่ารีเซ็ตแล้ว
   */
  async wait(cost: number, signal?: AbortSignal, onWait?: (ms: number) => void): Promise<number> {
    let waited = 0;
    while (true) {
      if (signal?.aborted) throw new Error("aborted");
      if (this.lastUpdate === 0) return waited;
      if (Date.now() - this.lastUpdate > 65_000) return waited;
      if (this.usedWeight1m + cost <= this.ceiling) return waited;
      onWait?.(waited);
      await sleep(2000);
      waited += 2000;
    }
  }
}

// ═══ Kline fetching ══════════════════════════════════════════════
const BINANCE_BASE = "https://api.binance.com";

type BinanceRaw = [number, string, string, string, string, string, number, string, number, string, string];

function toKline(r: BinanceRaw): KlineData {
  return {
    openTime: r[0],
    open: r[1],
    high: r[2],
    low: r[3],
    close: r[4],
    volume: r[5],
    closeTime: r[6],
    quoteAssetVolume: r[7],
    numberOfTrades: r[8],
    takerBuyBaseVolume: r[9],
    takerBuyQuoteVolume: r[10],
  };
}

async function callKlines(
  params: URLSearchParams,
  gate: WeightGate,
  cost: number,
  signal?: AbortSignal,
  onWait?: (ms: number) => void,
): Promise<KlineData[]> {
  await gate.wait(cost, signal, onWait);
  const res = await fetch(`${BINANCE_BASE}/api/v3/klines?${params}`, {
    cache: "no-store",
    signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // 429/418 = โดน rate limit — โยนพร้อม Retry-After เพื่อให้ผู้เรียกรู้ว่าต้องพัก
    const retryAfter = res.headers.get("retry-after");
    throw new Error(
      `Binance ${res.status}${retryAfter ? ` (retry after ${retryAfter}s)` : ""}: ${body.slice(0, 160)}`,
    );
  }
  gate.observe(res, cost);
  return (await res.json() as BinanceRaw[]).map(toKline);
}

/**
 * ดึง klines ตามแผน — รองรับทั้ง limit > 1000 (paginate ย้อนหลัง)
 * และช่วงเวลา start–end (paginate ไปข้างหน้า)
 * คืนเฉพาะ "แท่งที่ปิดแล้ว" เพื่อไม่ให้สัญญาณกระพริบจากแท่งที่ยังก่อตัว
 */
export async function fetchKlines(
  symbol: string,
  plan: FetchPlan,
  gate: WeightGate,
  signal?: AbortSignal,
  onWait?: (ms: number) => void,
): Promise<KlineData[]> {
  let out: KlineData[] = [];

  if (plan.startTime) {
    const end = plan.endTime ?? Date.now();
    let cursor = plan.startTime;
    while (cursor < end) {
      const p = new URLSearchParams({
        symbol,
        interval: plan.interval,
        limit: "1000",
        startTime: String(cursor),
        endTime: String(end),
      });
      const page = await callKlines(p, gate, klineWeight(1000), signal, onWait);
      if (page.length === 0) break;
      out.push(...page);
      const last = page[page.length - 1].closeTime;
      if (last >= end || page.length < 1000) break;
      cursor = last + 1;
      await sleep(60);
    }
  } else if (plan.limit <= 1000) {
    const p = new URLSearchParams({ symbol, interval: plan.interval, limit: String(plan.limit) });
    out = await callKlines(p, gate, klineWeight(plan.limit), signal, onWait);
  } else {
    let endCursor: number | undefined;
    while (out.length < plan.limit) {
      const pageLimit = Math.min(1000, plan.limit - out.length);
      const p = new URLSearchParams({ symbol, interval: plan.interval, limit: String(pageLimit) });
      if (endCursor) p.set("endTime", String(endCursor));
      const page = await callKlines(p, gate, klineWeight(pageLimit), signal, onWait);
      if (page.length === 0) break;
      out = [...page, ...out];
      endCursor = page[0].openTime - 1;
      if (page.length < pageLimit) break;
      await sleep(60);
    }
  }

  // ตัดแท่งสุดท้ายถ้ายังไม่ปิด
  const now = Date.now();
  while (out.length && out[out.length - 1].closeTime > now) out.pop();
  return out;
}

// ═══ Normalized SMC output ═══════════════════════════════════════
interface NormalizedSmc {
  signal: ("BUY" | "SELL" | null)[];
  internalTrend: (SMCBias | null)[];
  swingTrend: (SMCBias | null)[] | null;
  zone: ("premium" | "discount" | "equilibrium" | null)[] | null;
  /** pivotIndex ใช้เป็นจุดเริ่มของเส้นโครงสร้างที่ลากมาถึงแท่งที่ทะลุ */
  structures: { index: number; pivotIndex: number; type: string; bias: SMCBias; level: number }[];
  orderBlocks: { startIndex: number; high: number; low: number; bias: SMCBias; mitigated: boolean; mitigatedIndex: number | null }[];
  fvgs: { index: number; top: number; bottom: number; bias: SMCBias; filled: boolean; filledIndex: number | null }[] | null;
  swingPoints: { index: number; price: number; type: string }[];
  tp: (number | null)[] | null;
  sl: (number | null)[] | null;
}

function runVariant(
  klines: KlineData[],
  variant: SmcVariantId,
  p: Record<string, number>,
): NormalizedSmc {
  switch (variant) {
    case "price_action_smc": {
      const r = priceActionSMC(
        klines,
        p.pasmcLen ?? 5,
        "Length",
        p.pasmcObLength ?? 5,
        (p.pasmcBuildSweep ?? 1) !== 0,
        p.pasmcSwing ?? 50,
        (p.pasmcUseSwing ?? 1) !== 0,
        (p.pasmcUseOB ?? 1) !== 0,
      );
      return {
        signal: r.signal,
        internalTrend: r.trend,
        swingTrend: r.swingTrend,
        zone: r.premiumDiscount,
        structures: r.structures.map((s) => ({ index: s.index, pivotIndex: s.pivotIndex, type: s.type, bias: s.bias, level: s.level })),
        orderBlocks: r.orderBlocks.map((b) => ({
          startIndex: b.startIndex, high: b.high, low: b.low, bias: b.bias,
          mitigated: b.mitigated, mitigatedIndex: b.mitigatedIndex,
        })),
        fvgs: null,
        swingPoints: r.swingPoints.map((sp) => ({ index: sp.index, price: sp.price, type: sp.type })),
        tp: null,
        sl: null,
      };
    }
    case "pasmc_scalper": {
      const r = priceActionSMCScalper(
        klines,
        p.pascLen ?? 3,
        p.pascObLen ?? 3,
        (p.pascSweep ?? 1) !== 0,
        (p.pascUseOB ?? 1) !== 0,
        p.pascTpAtr ?? 3.0,
        p.pascSlAtr ?? 1.5,
      );
      return {
        signal: r.signal,
        internalTrend: r.trend,
        swingTrend: null,
        zone: null,
        structures: r.structures.map((s) => ({ index: s.index, pivotIndex: s.pivotIndex, type: s.type, bias: s.bias, level: s.level })),
        orderBlocks: r.orderBlocks.map((b) => ({
          startIndex: b.startIndex, high: b.high, low: b.low, bias: b.bias,
          mitigated: b.mitigated, mitigatedIndex: b.mitigatedIndex,
        })),
        fvgs: null,
        swingPoints: r.swingPoints.map((sp) => ({ index: sp.index, price: sp.price, type: sp.type })),
        tp: r.tp,
        sl: r.sl,
      };
    }
    case "smc_trend_pullback": {
      const r = smcTrendPullback(
        klines,
        p.smcpSwing ?? 20,
        p.smcpInternal ?? 5,
        (p.smcpUseOB ?? 1) !== 0,
        (p.smcpUseFvg ?? 1) !== 0,
        p.smcpTpAtr ?? 4.0,
        p.smcpSlAtr ?? 2.0,
      );
      return {
        signal: r.signal,
        internalTrend: r.internalTrend,
        swingTrend: r.swingTrend,
        zone: r.premiumDiscount,
        structures: r.internalStructures.map((s) => ({ index: s.index, pivotIndex: s.pivotIndex, type: s.type, bias: s.bias, level: s.level })),
        orderBlocks: [...r.internalOrderBlocks, ...r.swingOrderBlocks].map((b) => ({
          startIndex: b.startIndex, high: b.high, low: b.low, bias: b.bias,
          mitigated: b.mitigated, mitigatedIndex: b.mitigatedIndex,
        })),
        fvgs: r.fairValueGaps.map((f) => ({
          index: f.index, top: f.top, bottom: f.bottom, bias: f.bias,
          filled: f.filled, filledIndex: f.filledIndex,
        })),
        swingPoints: r.swingPoints.map((sp) => ({ index: sp.index, price: sp.price, type: sp.type })),
        tp: r.tp,
        sl: r.sl,
      };
    }
    case "smc":
    default: {
      const r = smartMoneyConcepts(klines, p.swingSize ?? 50, p.internalSize ?? 5);
      return {
        signal: r.signal,
        internalTrend: r.internalTrend,
        swingTrend: r.swingTrend,
        zone: r.premiumDiscount,
        structures: r.internalStructures.map((s) => ({ index: s.index, pivotIndex: s.pivotIndex, type: s.type, bias: s.bias, level: s.level })),
        orderBlocks: [...r.internalOrderBlocks, ...r.swingOrderBlocks].map((b) => ({
          startIndex: b.startIndex, high: b.high, low: b.low, bias: b.bias,
          mitigated: b.mitigated, mitigatedIndex: b.mitigatedIndex,
        })),
        fvgs: r.fairValueGaps.map((f) => ({
          index: f.index, top: f.top, bottom: f.bottom, bias: f.bias,
          filled: f.filled, filledIndex: f.filledIndex,
        })),
        swingPoints: r.swingPoints.map((sp) => ({ index: sp.index, price: sp.price, type: sp.type })),
        tp: null,
        sl: null,
      };
    }
  }
}

// ═══ Quick backtest (ขับด้วย signal[] ที่คำนวณไว้แล้ว) ═══════════
// ตรรกะเดียวกับ runBacktest() โหมด spot / long-only:
// เข้าที่ราคาปิดเมื่อ BUY, ออกที่ราคาปิดเมื่อ SELL, หักค่าธรรมเนียมสองขา
// ต่างกันตรงที่ "ไม่เรียก computeAll ซ้ำ" — ใช้สัญญาณที่คำนวณไว้แล้ว
export function quickBacktest(
  klines: KlineData[],
  signals: ("BUY" | "SELL" | null)[],
  feesPct = 0.1,
): QuickBacktest {
  const c = klines.map((k) => +k.close);
  const closed: QuickBacktest["lastTrades"] = [];
  let entryIdx = -1;

  for (let i = 0; i < c.length; i++) {
    const sig = signals[i];
    if (sig === "BUY" && entryIdx < 0) {
      entryIdx = i;
    } else if (sig === "SELL" && entryIdx >= 0) {
      const entryPrice = c[entryIdx];
      const exitPrice = c[i];
      const gross = ((exitPrice - entryPrice) / entryPrice) * 100;
      closed.push({
        entryIdx, exitIdx: i, entryPrice, exitPrice,
        pnlPct: gross - feesPct * 2,
        bars: i - entryIdx,
      });
      entryIdx = -1;
    }
  }

  const wins = closed.filter((t) => t.pnlPct > 0);
  const losses = closed.filter((t) => t.pnlPct <= 0);
  const grossWin = wins.reduce((s, t) => s + t.pnlPct, 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlPct, 0));

  // equity แบบทบต้น เพื่อคิด max drawdown ให้ใกล้เคียงของจริง
  let eq = 1;
  let peak = 1;
  let maxDd = 0;
  for (const t of closed) {
    eq *= 1 + t.pnlPct / 100;
    peak = Math.max(peak, eq);
    maxDd = Math.max(maxDd, ((peak - eq) / peak) * 100);
  }

  return {
    totalTrades: closed.length,
    wins: wins.length,
    losses: losses.length,
    winRate: closed.length ? (wins.length / closed.length) * 100 : 0,
    totalPnlPct: (eq - 1) * 100,
    avgPnlPct: closed.length ? closed.reduce((s, t) => s + t.pnlPct, 0) / closed.length : 0,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    maxDrawdownPct: maxDd,
    avgBarsHeld: closed.length ? closed.reduce((s, t) => s + t.bars, 0) / closed.length : 0,
    bestTradePct: closed.length ? Math.max(...closed.map((t) => t.pnlPct)) : 0,
    worstTradePct: closed.length ? Math.min(...closed.map((t) => t.pnlPct)) : 0,
    buyAndHoldPct: c.length > 1 ? ((c[c.length - 1] - c[0]) / c[0]) * 100 : 0,
    lastTrades: closed.slice(-5),
  };
}

// ═══ Analysis ════════════════════════════════════════════════════
function round(n: number, dp = 8): number {
  return +n.toFixed(dp);
}

/** ปัดราคาให้พอดีกับขนาดของมัน เพื่อลดขนาด payload */
function px(n: number): number {
  const a = Math.abs(n);
  if (a >= 1000) return round(n, 2);
  if (a >= 1) return round(n, 4);
  return round(n, 8);
}

/**
 * รัน SMC บน klines ชุดเดียว แล้วสรุปเป็น 1 แถวของตารางอันดับ
 */
export function analyzeSmc(
  symbol: string,
  interval: Interval,
  klines: KlineData[],
  variantId: SmcVariantId,
  opts: {
    params?: Record<string, number>;
    feesPct?: number;
    withBacktest?: boolean;
    candleWindow?: number;
  } = {},
): SmcScanRow {
  const cfg = smcVariant(variantId);
  const params = { ...cfg.params, ...(opts.params ?? {}) };
  const len = klines.length;
  const r = runVariant(klines, variantId, params);
  const closes = klines.map((k) => +k.close);

  let lastBuy = -1;
  let lastSell = -1;
  for (let i = len - 1; i >= 0; i--) {
    if (lastBuy < 0 && r.signal[i] === "BUY") lastBuy = i;
    if (lastSell < 0 && r.signal[i] === "SELL") lastSell = i;
    if (lastBuy >= 0 && lastSell >= 0) break;
  }

  const detailAt = (idx: number, bias: SMCBias): SmcSignalDetail => {
    const struct = r.structures.find((s) => s.index === idx) ?? null;
    const zone = r.zone?.[idx] ?? null;
    const internalTrend = r.internalTrend[idx] ?? null;
    const swingTrend = r.swingTrend?.[idx] ?? null;

    // OB ล่าสุดฝั่งเดียวกับสัญญาณ ที่เกิดก่อน (หรือที่) แท่งสัญญาณ
    const ob = [...r.orderBlocks]
      .filter((b) => b.bias === bias && b.startIndex <= idx)
      .sort((a, b) => b.startIndex - a.startIndex)[0] ?? null;
    const fvg = r.fvgs
      ? [...r.fvgs].filter((f) => f.bias === bias && f.index <= idx).sort((a, b) => b.index - a.index)[0] ?? null
      : null;

    const price = closes[idx];
    // จุดบรรจบ — คิดทั้งสองฝั่ง (เดิมคำนวณเฉพาะฝั่งซื้อ ทำให้สัญญาณขายไม่มีป้ายอะไรเลย)
    const bullish = bias === "bullish";
    const confluence: string[] = [];
    if (struct) confluence.push(struct.type);
    if (bullish ? zone === "discount" : zone === "premium") {
      confluence.push(bullish ? "โซนส่วนลด" : "โซนพรีเมียม");
    } else if (zone === "equilibrium") {
      confluence.push("โซนสมดุล");
    }
    if (swingTrend === bias) confluence.push(bullish ? "เทรนด์ swing ขาขึ้น" : "เทรนด์ swing ขาลง");
    if (ob && !ob.mitigated && price >= ob.low && price <= ob.high) confluence.push("อยู่ในกล่อง OB");
    if (fvg && !fvg.filled) confluence.push(bullish ? "มี FVG รองรับ" : "มี FVG กดอยู่");

    return {
      barIndex: idx,
      barsAgo: len - 1 - idx,
      time: klines[idx].closeTime,
      price: px(price),
      structureType: struct?.type ?? null,
      structureLevel: struct ? px(struct.level) : null,
      zone,
      internalTrend,
      swingTrend,
      orderBlock: ob ? { high: px(ob.high), low: px(ob.low), mitigated: ob.mitigated } : null,
      fvg: fvg ? { top: px(fvg.top), bottom: px(fvg.bottom), filled: fvg.filled } : null,
      tp: r.tp?.[idx] != null ? px(r.tp[idx] as number) : null,
      sl: r.sl?.[idx] != null ? px(r.sl[idx] as number) : null,
      confluence,
    };
  };

  const buy = lastBuy >= 0 ? detailAt(lastBuy, "bullish") : null;
  const sell = lastSell >= 0 ? detailAt(lastSell, "bearish") : null;
  const state: SmcScanRow["state"] =
    lastBuy < 0 && lastSell < 0 ? "NONE" : lastBuy > lastSell ? "BUY_ACTIVE" : "SELL_ACTIVE";

  // หน้าต่างกราฟ — เลื่อนให้เห็นแท่งที่เกิดสัญญาณเสมอ
  const winSize = opts.candleWindow ?? 90;
  let candles: CandleWindow | null = null;
  const buyMarks: number[] = [];
  const sellMarks: number[] = [];
  if (winSize > 0 && len > 0) {
    const start = Math.max(0, Math.min(len - winSize, lastBuy >= 0 ? lastBuy - 20 : len - winSize));
    const slice = klines.slice(start);
    candles = {
      offset: start,
      t: slice.map((k) => k.closeTime),
      o: slice.map((k) => px(+k.open)),
      h: slice.map((k) => px(+k.high)),
      l: slice.map((k) => px(+k.low)),
      c: slice.map((k) => px(+k.close)),
    };
    for (let i = start; i < len; i++) {
      if (r.signal[i] === "BUY") buyMarks.push(i);
      else if (r.signal[i] === "SELL") sellMarks.push(i);
    }
  }

  const lastPrice = closes[len - 1];
  return {
    symbol,
    interval,
    variant: variantId,
    bars: len,
    lastPrice: px(lastPrice),
    lastCloseTime: klines[len - 1].closeTime,
    state,
    buy,
    sell,
    changeSinceBuyPct: buy ? round(((lastPrice - closes[lastBuy]) / closes[lastBuy]) * 100, 2) : null,
    changeSinceSellPct: sell ? round(((lastPrice - closes[lastSell]) / closes[lastSell]) * 100, 2) : null,
    backtest: opts.withBacktest === false ? null : quickBacktest(klines, r.signal, opts.feesPct ?? 0.1),
    candles,
    buyMarks,
    sellMarks,
    warning: len < cfg.minBars
      ? `มีแค่ ${len} แท่ง — ${cfg.shortName} ต้องการอย่างน้อย ~${cfg.minBars} แท่งจึงจะเชื่อถือได้`
      : undefined,
  };
}

/** ยุบ array ที่ค่าคงที่เป็นช่วง ๆ ให้เหลือเฉพาะช่วงที่มีค่า */
function runLength(arr: (number | null)[] | null): SmcLevelRun[] | null {
  if (!arr) return null;
  const out: SmcLevelRun[] = [];
  let cur: SmcLevelRun | null = null;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v == null) { cur = null; continue; }
    const rounded = px(v);
    if (cur && cur.value === rounded && cur.toIdx === i - 1) cur.toIdx = i;
    else { cur = { fromIdx: i, toIdx: i, value: rounded }; out.push(cur); }
  }
  return out;
}

// ═══ Detail: กราฟเต็ม + เส้นที่ indicator ตี ═════════════════════
/**
 * เตรียมข้อมูลสำหรับหน้ารายละเอียด — แท่งเทียนครบทุกแท่ง พร้อมเส้น/กล่อง
 * ที่ SMC ตีไว้ (โครงสร้าง CHoCH/BOS, Order Block, FVG, swing points)
 *
 * แยกจาก analyzeSmc() เพราะ payload หนักเกินกว่าจะส่งมากับลิสต์ทุกเหรียญ
 * — โหลดเฉพาะตอนผู้ใช้แตะดูรายละเอียด
 */
export function analyzeSmcDetail(
  symbol: string,
  interval: Interval,
  klines: KlineData[],
  variantId: SmcVariantId,
  params?: Record<string, number>,
): SmcDetail {
  const cfg = smcVariant(variantId);
  const r = runVariant(klines, variantId, { ...cfg.params, ...(params ?? {}) });
  const len = klines.length;
  const last = len - 1;

  const structures: SmcStructureLine[] = r.structures
    .filter((s) => s.index >= 0 && s.index < len && s.pivotIndex >= 0 && s.pivotIndex < len && s.pivotIndex !== s.index)
    .map((s) => ({
      fromIdx: s.pivotIndex,
      toIdx: s.index,
      level: px(s.level),
      type: s.type,
      bias: s.bias,
    }));

  const orderBlocks: SmcZone[] = r.orderBlocks
    .filter((b) => b.startIndex >= 0 && b.startIndex < len)
    .map((b) => ({
      fromIdx: b.startIndex,
      // ยังไม่ถูกลบล้าง → ลากยาวถึงแท่งล่าสุด (โซนยัง active)
      toIdx: b.mitigated && b.mitigatedIndex != null ? Math.min(b.mitigatedIndex, last) : last,
      top: px(b.high),
      bottom: px(b.low),
      bias: b.bias,
      closed: b.mitigated,
    }));

  const fvgs: SmcZone[] = (r.fvgs ?? [])
    .filter((f) => f.index >= 0 && f.index < len)
    .map((f) => ({
      fromIdx: f.index,
      toIdx: f.filled && f.filledIndex != null ? Math.min(f.filledIndex, last) : last,
      top: px(f.top),
      bottom: px(f.bottom),
      bias: f.bias,
      closed: f.filled,
    }));

  const swingPoints: SmcSwingLabel[] = r.swingPoints
    .filter((sp) => sp.index >= 0 && sp.index < len)
    .map((sp) => ({ idx: sp.index, price: px(sp.price), type: sp.type }));

  const signals: SmcSignalMark[] = [];
  for (let i = 0; i < len; i++) {
    const s = r.signal[i];
    if (s === "BUY" || s === "SELL") signals.push({ idx: i, kind: s });
  }

  return {
    symbol,
    interval,
    variant: variantId,
    bars: len,
    candles: {
      offset: 0,
      t: klines.map((k) => k.openTime),
      o: klines.map((k) => px(+k.open)),
      h: klines.map((k) => px(+k.high)),
      l: klines.map((k) => px(+k.low)),
      c: klines.map((k) => px(+k.close)),
    },
    drawings: {
      structures,
      orderBlocks,
      fvgs,
      swingPoints,
      tp: runLength(r.tp),
      sl: runLength(r.sl),
    },
    signals,
  };
}
