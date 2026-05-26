import type { KlineData } from "@/lib/types/kline";

// ─── Helper ────────────────────────────────────────────────────
function closes(k: KlineData[]): number[] { return k.map(x => +x.close); }
function highs(k: KlineData[]): number[]  { return k.map(x => +x.high); }
function lows(k: KlineData[]): number[]   { return k.map(x => +x.low); }
function volumes(k: KlineData[]): number[] { return k.map(x => +x.volume); }

// ─── SMA ───────────────────────────────────────────────────────
export function sma(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    result.push(sum / period);
  }
  return result;
}

// ─── EMA ───────────────────────────────────────────────────────
export function ema(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    if (prev === null) {
      // seed with SMA
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += data[j];
      prev = sum / period;
    } else {
      prev = data[i] * k + prev * (1 - k);
    }
    result.push(prev);
  }
  return result;
}

// ─── RSI ───────────────────────────────────────────────────────
export function rsi(data: number[], period = 14): (number | null)[] {
  const result: (number | null)[] = [];
  if (data.length < period + 1) return data.map(() => null);

  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = data[i] - data[i - 1];
    if (diff > 0) avgGain += diff; else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = 0; i < period; i++) result.push(null);
  result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));

  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i] - data[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return result;
}

// ─── ATR ───────────────────────────────────────────────────────
export function atr(klines: KlineData[], period = 14): (number | null)[] {
  const h = highs(klines), l = lows(klines), c = closes(klines);
  const tr: number[] = [];
  for (let i = 0; i < klines.length; i++) {
    if (i === 0) { tr.push(h[i] - l[i]); continue; }
    tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  }
  const result: (number | null)[] = [];
  let prev: number | null = null;
  for (let i = 0; i < tr.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    if (prev === null) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += tr[j];
      prev = sum / period;
    } else {
      prev = (prev * (period - 1) + tr[i]) / period;
    }
    result.push(prev);
  }
  return result;
}

// ─── OBV ───────────────────────────────────────────────────────
export function obv(klines: KlineData[]): number[] {
  const c = closes(klines), v = volumes(klines);
  const result: number[] = [0];
  for (let i = 1; i < klines.length; i++) {
    if (c[i] > c[i - 1]) result.push(result[i - 1] + v[i]);
    else if (c[i] < c[i - 1]) result.push(result[i - 1] - v[i]);
    else result.push(result[i - 1]);
  }
  return result;
}

// ─── VWAP ──────────────────────────────────────────────────────
export function vwap(klines: KlineData[]): number[] {
  const result: number[] = [];
  let cumTPV = 0, cumVol = 0;
  for (let i = 0; i < klines.length; i++) {
    const tp = (+klines[i].high + +klines[i].low + +klines[i].close) / 3;
    const vol = +klines[i].volume;
    cumTPV += tp * vol;
    cumVol += vol;
    result.push(cumVol === 0 ? tp : cumTPV / cumVol);
  }
  return result;
}

// ─── CDC ActionZone V3 2020 ──────────────────────────────────────
// Based on piriya33's PineScript indicator — EMA crossover zones
export type CDCZone = "green" | "blue" | "lightblue" | "red" | "orange" | "yellow" | null;

export interface CDCActionZoneResult {
  fastMA: (number | null)[];
  slowMA: (number | null)[];
  zone: CDCZone[];
  bull: (boolean | null)[];    // FastMA > SlowMA
  signal: ("BUY" | "SELL" | null)[];  // first green / first red
  trend: ("bullish" | "bearish" | null)[];
}

export function cdcActionZone(
  data: number[],
  fastPeriod = 12,
  slowPeriod = 26,
  smoothPeriod = 1,
): CDCActionZoneResult {
  // xPrice = EMA(close, smooth) — smooth=1 means just close
  const xPrice = smoothPeriod <= 1 ? data : ema(data, smoothPeriod).map((v, i) => v ?? data[i]);

  const fastMA = ema(xPrice as number[], fastPeriod);
  const slowMA = ema(xPrice as number[], slowPeriod);

  const len = data.length;
  const zone: CDCZone[] = [];
  const bullArr: (boolean | null)[] = [];
  const signalArr: ("BUY" | "SELL" | null)[] = [];
  const trendArr: ("bullish" | "bearish" | null)[] = [];

  // Track last buy/sell for trend determination
  let lastBuyBar = -Infinity;
  let lastSellBar = -Infinity;

  for (let i = 0; i < len; i++) {
    const f = fastMA[i];
    const s = slowMA[i];
    const p = xPrice[i];

    if (f === null || s === null || p === undefined) {
      zone.push(null);
      bullArr.push(null);
      signalArr.push(null);
      trendArr.push(null);
      continue;
    }

    const isBull = f > s;
    const isBear = f < s;
    bullArr.push(isBull);

    // Define zones
    let z: CDCZone;
    if (isBull && p > f) z = "green";          // Buy zone
    else if (isBear && p > f && p > s) z = "blue";    // Pre Buy 2
    else if (isBear && p > f && p < s) z = "lightblue"; // Pre Buy 1
    else if (isBear && p < f) z = "red";              // Sell zone
    else if (isBull && p < f && p < s) z = "orange";  // Pre Sell 2
    else if (isBull && p < f && p > s) z = "yellow";  // Pre Sell 1
    else z = null; // edge case (equal)
    zone.push(z);

    // Buy/Sell signals: first green after non-green, first red after non-red
    const prevZone = i > 0 ? zone[i - 1] : null;
    const isGreen = z === "green";
    const wasGreen = prevZone === "green";
    const isRed = z === "red";
    const wasRed = prevZone === "red";

    const buyCond = isGreen && !wasGreen;
    const sellCond = isRed && !wasRed;

    // Use prevTrend BEFORE updating lastBuyBar/lastSellBar (matches Pine: bearish[1])
    const prevTrend = trendArr[i - 1] ?? null;

    // Actual buy = bearish[1] and buyCond, sell = bullish[1] and sellCond
    // Pine Script requires strict bearish/bullish — no null fallback
    if (buyCond && prevTrend === "bearish") {
      signalArr.push("BUY");
    } else if (sellCond && prevTrend === "bullish") {
      signalArr.push("SELL");
    } else {
      signalArr.push(null);
    }

    // Update trend tracking AFTER signal check
    if (buyCond) lastBuyBar = i;
    if (sellCond) lastSellBar = i;

    const isBullish = lastBuyBar > lastSellBar;
    const isBearish = lastSellBar > lastBuyBar;
    trendArr.push(isBullish ? "bullish" : isBearish ? "bearish" : null);
  }

  return { fastMA, slowMA, zone, bull: bullArr, signal: signalArr, trend: trendArr };
}

// ─── CM MacD Ultimate MTF ────────────────────────────────────────
// Based on ChrisMoody's PineScript — Enhanced MACD with 4-color histogram
// showing momentum direction above/below zero line.

export type CMHistColor = "aqua" | "blue" | "red" | "maroon";

export interface CMMAcDResult {
  macdLine: (number | null)[];
  signalLine: (number | null)[];
  histogram: (number | null)[];
  histColor: (CMHistColor | null)[];     // 4-color histogram
  macdAboveSignal: (boolean | null)[];   // MACD >= Signal
  crossUp: boolean[];                    // MACD crosses above Signal
  crossDown: boolean[];                  // MACD crosses below Signal
  signal: ("BUY" | "SELL" | null)[];     // trading signals
}

export function cmMacdUltMTF(
  data: number[],
  fastLength = 12,
  slowLength = 26,
  signalLength = 9,
): CMMAcDResult {
  const len = data.length;
  const fastMA = ema(data, fastLength);
  const slowMA = ema(data, slowLength);

  const macdLine: (number | null)[] = [];
  for (let i = 0; i < len; i++) {
    if (fastMA[i] !== null && slowMA[i] !== null) {
      macdLine.push(fastMA[i]! - slowMA[i]!);
    } else {
      macdLine.push(null);
    }
  }

  // Signal line = SMA of MACD (like in the PineScript: sma(macd, signalLength))
  const nonNullMacd = macdLine.filter(v => v !== null) as number[];
  const sigSMA = sma(nonNullMacd, signalLength);

  const signalLine: (number | null)[] = [];
  const histogram: (number | null)[] = [];
  let idx = 0;
  for (let i = 0; i < len; i++) {
    if (macdLine[i] === null) {
      signalLine.push(null);
      histogram.push(null);
    } else {
      const s = sigSMA[idx] ?? null;
      signalLine.push(s);
      histogram.push(s !== null ? macdLine[i]! - s : null);
      idx++;
    }
  }

  // 4-color histogram logic
  // histA_IsUp   = hist > hist[1] and hist > 0   → aqua  (เพิ่มขึ้น เหนือศูนย์)
  // histA_IsDown = hist < hist[1] and hist > 0   → blue  (ลดลง แต่ยังเหนือศูนย์)
  // histB_IsDown = hist < hist[1] and hist <= 0  → red   (ลดลง ใต้ศูนย์)
  // histB_IsUp   = hist > hist[1] and hist <= 0  → maroon (เพิ่มขึ้น แต่ยังใต้ศูนย์)
  const histColor: (CMHistColor | null)[] = [];
  const macdAboveSignal: (boolean | null)[] = [];
  const crossUp: boolean[] = [];
  const crossDown: boolean[] = [];
  const signal: ("BUY" | "SELL" | null)[] = [];

  for (let i = 0; i < len; i++) {
    const h = histogram[i];
    const hPrev = i > 0 ? histogram[i - 1] : null;
    const m = macdLine[i];
    const s = signalLine[i];

    if (h === null || hPrev === null) {
      histColor.push(null);
      macdAboveSignal.push(null);
      crossUp.push(false);
      crossDown.push(false);
      signal.push(null);
      continue;
    }

    // 4-color
    if (h > hPrev && h > 0) histColor.push("aqua");
    else if (h < hPrev && h > 0) histColor.push("blue");
    else if (h < hPrev && h <= 0) histColor.push("red");
    else if (h > hPrev && h <= 0) histColor.push("maroon");
    else histColor.push("blue"); // equal case

    // MACD vs Signal
    const isAbove = m !== null && s !== null ? m >= s : null;
    macdAboveSignal.push(isAbove);

    // Cross detection
    const prevM = i > 0 ? macdLine[i - 1] : null;
    const prevS = i > 0 ? signalLine[i - 1] : null;
    const prevAbove = prevM !== null && prevS !== null ? prevM >= prevS : null;
    const currAbove = m !== null && s !== null ? m >= s : null;

    const isCrossUp = prevAbove === false && currAbove === true;
    const isCrossDown = prevAbove === true && currAbove === false;
    crossUp.push(isCrossUp);
    crossDown.push(isCrossDown);

    // Trading signals
    if (isCrossUp) signal.push("BUY");
    else if (isCrossDown) signal.push("SELL");
    else signal.push(null);
  }

  return { macdLine, signalLine, histogram, histColor, macdAboveSignal, crossUp, crossDown, signal };
}

// ─── Smart Money Concepts (SMC) ─────────────────────────────────
// Converted from LuxAlgo PineScript — detects market structure,
// order blocks, fair value gaps, and premium/discount zones.

export type SMCStructureType = "BOS" | "CHoCH";
export type SMCBias = "bullish" | "bearish";

export interface SMCStructureBreak {
  index: number;        // bar where break happened
  type: SMCStructureType;
  bias: SMCBias;
  level: number;        // price level that was broken
  pivotIndex: number;   // bar index of the pivot that was broken
}

export interface SMCOrderBlock {
  startIndex: number;
  high: number;
  low: number;
  bias: SMCBias;
  mitigated: boolean;
  mitigatedIndex: number | null;
}

export interface SMCFairValueGap {
  index: number;        // middle candle index
  top: number;
  bottom: number;
  bias: SMCBias;
  filled: boolean;
  filledIndex: number | null;
}

export interface SMCSwingPoint {
  index: number;
  price: number;
  type: "HH" | "HL" | "LH" | "LL" | "H" | "L";
}

export interface SMCResult {
  swingTrend: (SMCBias | null)[];
  internalTrend: (SMCBias | null)[];
  swingStructures: SMCStructureBreak[];
  internalStructures: SMCStructureBreak[];
  swingOrderBlocks: SMCOrderBlock[];
  internalOrderBlocks: SMCOrderBlock[];
  fairValueGaps: SMCFairValueGap[];
  swingPoints: SMCSwingPoint[];
  premiumDiscount: ("premium" | "discount" | "equilibrium" | null)[];
  signal: ("BUY" | "SELL" | null)[];
}

/**
 * Detect swing legs — a pivot high occurs when high[size] > highest(size bars after)
 * and pivot low when low[size] < lowest(size bars after).
 */
function detectPivots(
  h: number[], l: number[], size: number
): { pivotHighs: (number | null)[]; pivotLows: (number | null)[] } {
  const len = h.length;
  const pivotHighs: (number | null)[] = new Array(len).fill(null);
  const pivotLows: (number | null)[] = new Array(len).fill(null);

  for (let i = size; i < len - size; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= size; j++) {
      if (h[i] <= h[i - j] || h[i] <= h[i + j]) isHigh = false;
      if (l[i] >= l[i - j] || l[i] >= l[i + j]) isLow = false;
    }
    if (isHigh) pivotHighs[i] = h[i];
    if (isLow) pivotLows[i] = l[i];
  }
  return { pivotHighs, pivotLows };
}

/**
 * Detect market structure (BOS/CHoCH) from pivot points.
 * - BOS: price breaks above a pivot high in an uptrend (or below pivot low in downtrend)
 * - CHoCH: price breaks above a pivot high in a downtrend (trend reversal) or vice versa
 */
function detectStructure(
  c: number[], _h: number[], _l: number[],
  pivotHighs: (number | null)[], pivotLows: (number | null)[],
): { structures: SMCStructureBreak[]; trend: (SMCBias | null)[] } {
  const len = c.length;
  const structures: SMCStructureBreak[] = [];
  const trend: (SMCBias | null)[] = new Array(len).fill(null);

  let currentTrend: SMCBias | null = null;
  let lastPivotHigh: { price: number; index: number; crossed: boolean } | null = null;
  let lastPivotLow: { price: number; index: number; crossed: boolean } | null = null;

  for (let i = 0; i < len; i++) {
    // Update pivots
    if (pivotHighs[i] !== null) {
      lastPivotHigh = { price: pivotHighs[i]!, index: i, crossed: false };
    }
    if (pivotLows[i] !== null) {
      lastPivotLow = { price: pivotLows[i]!, index: i, crossed: false };
    }

    // Check bullish break (close crosses above pivot high)
    if (lastPivotHigh && !lastPivotHigh.crossed && c[i] > lastPivotHigh.price) {
      const type: SMCStructureType = currentTrend === "bearish" ? "CHoCH" : "BOS";
      structures.push({
        index: i,
        type,
        bias: "bullish",
        level: lastPivotHigh.price,
        pivotIndex: lastPivotHigh.index,
      });
      lastPivotHigh.crossed = true;
      currentTrend = "bullish";
    }

    // Check bearish break (close crosses below pivot low)
    if (lastPivotLow && !lastPivotLow.crossed && c[i] < lastPivotLow.price) {
      const type: SMCStructureType = currentTrend === "bullish" ? "CHoCH" : "BOS";
      structures.push({
        index: i,
        type,
        bias: "bearish",
        level: lastPivotLow.price,
        pivotIndex: lastPivotLow.index,
      });
      lastPivotLow.crossed = true;
      currentTrend = "bearish";
    }

    trend[i] = currentTrend;
  }

  return { structures, trend };
}

/**
 * Detect Order Blocks — the last opposite candle before a structure break.
 * Bullish OB: last bearish candle before a bullish break
 * Bearish OB: last bullish candle before a bearish break
 */
function detectOrderBlocks(
  c: number[], o: number[], h: number[], l: number[],
  structures: SMCStructureBreak[],
): SMCOrderBlock[] {
  const orderBlocks: SMCOrderBlock[] = [];
  const len = c.length;

  for (const s of structures) {
    // Search backward from the pivot for the last opposite candle
    const searchEnd = s.pivotIndex;
    const searchStart = Math.max(0, searchEnd - 20);

    if (s.bias === "bullish") {
      // Find last bearish candle before the bullish break
      for (let j = searchEnd; j >= searchStart; j--) {
        if (c[j] < o[j]) {
          orderBlocks.push({
            startIndex: j,
            high: h[j],
            low: l[j],
            bias: "bullish",
            mitigated: false,
            mitigatedIndex: null,
          });
          break;
        }
      }
    } else {
      // Find last bullish candle before the bearish break
      for (let j = searchEnd; j >= searchStart; j--) {
        if (c[j] > o[j]) {
          orderBlocks.push({
            startIndex: j,
            high: h[j],
            low: l[j],
            bias: "bearish",
            mitigated: false,
            mitigatedIndex: null,
          });
          break;
        }
      }
    }
  }

  // Check mitigation (price returns into the OB)
  for (const ob of orderBlocks) {
    for (let i = ob.startIndex + 1; i < len; i++) {
      if (ob.bias === "bullish" && l[i] <= ob.low) {
        ob.mitigated = true;
        ob.mitigatedIndex = i;
        break;
      }
      if (ob.bias === "bearish" && h[i] >= ob.high) {
        ob.mitigated = true;
        ob.mitigatedIndex = i;
        break;
      }
    }
  }

  return orderBlocks;
}

/**
 * Detect Fair Value Gaps — a 3-candle pattern where there's a gap
 * between candle 1 and candle 3 (candle 2 doesn't fill the gap).
 */
function detectFairValueGaps(
  h: number[], l: number[], _c: number[], _o: number[],
  atrValues: (number | null)[],
): SMCFairValueGap[] {
  const fvgs: SMCFairValueGap[] = [];
  const len = h.length;

  for (let i = 2; i < len; i++) {
    const atrVal = atrValues[i];
    // Bullish FVG: candle3 low > candle1 high (gap up)
    if (l[i] > h[i - 2]) {
      const gapSize = l[i] - h[i - 2];
      // Filter by ATR threshold (gap must be meaningful)
      if (atrVal === null || gapSize > atrVal * 0.1) {
        const fvg: SMCFairValueGap = {
          index: i - 1,
          top: l[i],
          bottom: h[i - 2],
          bias: "bullish",
          filled: false,
          filledIndex: null,
        };
        // Check if FVG is filled later
        for (let j = i + 1; j < len; j++) {
          if (l[j] <= fvg.bottom) {
            fvg.filled = true;
            fvg.filledIndex = j;
            break;
          }
        }
        fvgs.push(fvg);
      }
    }

    // Bearish FVG: candle3 high < candle1 low (gap down)
    if (h[i] < l[i - 2]) {
      const gapSize = l[i - 2] - h[i];
      if (atrVal === null || gapSize > atrVal * 0.1) {
        const fvg: SMCFairValueGap = {
          index: i - 1,
          top: l[i - 2],
          bottom: h[i],
          bias: "bearish",
          filled: false,
          filledIndex: null,
        };
        for (let j = i + 1; j < len; j++) {
          if (h[j] >= fvg.top) {
            fvg.filled = true;
            fvg.filledIndex = j;
            break;
          }
        }
        fvgs.push(fvg);
      }
    }
  }

  return fvgs;
}

/**
 * Detect swing point labels (HH, HL, LH, LL)
 */
function detectSwingPoints(
  pivotHighs: (number | null)[], pivotLows: (number | null)[],
): SMCSwingPoint[] {
  const points: SMCSwingPoint[] = [];
  let lastHigh: number | null = null;
  let lastLow: number | null = null;

  for (let i = 0; i < pivotHighs.length; i++) {
    if (pivotHighs[i] !== null) {
      const price = pivotHighs[i]!;
      let type: SMCSwingPoint["type"];
      if (lastHigh === null) type = "H";
      else type = price > lastHigh ? "HH" : "LH";
      points.push({ index: i, price, type });
      lastHigh = price;
    }
    if (pivotLows[i] !== null) {
      const price = pivotLows[i]!;
      let type: SMCSwingPoint["type"];
      if (lastLow === null) type = "L";
      else type = price > lastLow ? "HL" : "LL";
      points.push({ index: i, price, type });
      lastLow = price;
    }
  }

  return points;
}

/**
 * Determine premium/discount zones based on trailing swing high/low
 */
function detectPremiumDiscount(
  c: number[], h: number[], l: number[],
  pivotHighs: (number | null)[], pivotLows: (number | null)[],
): ("premium" | "discount" | "equilibrium" | null)[] {
  const len = c.length;
  const result: ("premium" | "discount" | "equilibrium" | null)[] = new Array(len).fill(null);

  let trailingHigh = -Infinity;
  let trailingLow = Infinity;

  for (let i = 0; i < len; i++) {
    if (pivotHighs[i] !== null) trailingHigh = pivotHighs[i]!;
    if (pivotLows[i] !== null) trailingLow = pivotLows[i]!;

    // Also update with price action
    if (h[i] > trailingHigh) trailingHigh = h[i];
    if (l[i] < trailingLow) trailingLow = l[i];

    if (trailingHigh === -Infinity || trailingLow === Infinity) continue;

    const range = trailingHigh - trailingLow;
    if (range <= 0) continue;

    const equilibrium = (trailingHigh + trailingLow) / 2;
    const premiumThreshold = equilibrium + range * 0.25;
    const discountThreshold = equilibrium - range * 0.25;

    if (c[i] >= premiumThreshold) result[i] = "premium";
    else if (c[i] <= discountThreshold) result[i] = "discount";
    else result[i] = "equilibrium";
  }

  return result;
}

/**
 * Generate SMC trading signals
 * BUY: Bullish CHoCH or BOS in discount zone, or bullish OB retest
 * SELL: Bearish CHoCH or BOS in premium zone, or bearish OB retest
 */
function generateSMCSignals(
  len: number,
  structures: SMCStructureBreak[],
  premiumDiscount: ("premium" | "discount" | "equilibrium" | null)[],
  _trend: (SMCBias | null)[],
): ("BUY" | "SELL" | null)[] {
  const signals: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);

  // Structure-based signals
  for (const s of structures) {
    if (s.type === "CHoCH") {
      // CHoCH is a stronger signal (trend reversal)
      if (s.bias === "bullish") {
        signals[s.index] = "BUY";
      } else {
        signals[s.index] = "SELL";
      }
    } else if (s.type === "BOS") {
      // BOS in favorable zone
      const zone = premiumDiscount[s.index];
      if (s.bias === "bullish" && (zone === "discount" || zone === "equilibrium")) {
        signals[s.index] = "BUY";
      } else if (s.bias === "bearish" && (zone === "premium" || zone === "equilibrium")) {
        signals[s.index] = "SELL";
      }
    }
  }

  return signals;
}

export function smartMoneyConcepts(
  klines: KlineData[],
  swingSize = 50,
  internalSize = 5,
): SMCResult {
  const c = closes(klines);
  const h = highs(klines);
  const l = lows(klines);
  const o = klines.map(x => +x.open);
  const len = klines.length;

  // ATR for filtering
  const atrValues = atr(klines, 200);

  // Detect pivots at both swing and internal levels
  const swingPivots = detectPivots(h, l, swingSize);
  const internalPivots = detectPivots(h, l, internalSize);

  // Detect structure
  const swingResult = detectStructure(c, h, l, swingPivots.pivotHighs, swingPivots.pivotLows);
  const internalResult = detectStructure(c, h, l, internalPivots.pivotHighs, internalPivots.pivotLows);

  // Order Blocks
  const swingOBs = detectOrderBlocks(c, o, h, l, swingResult.structures);
  const internalOBs = detectOrderBlocks(c, o, h, l, internalResult.structures);

  // Fair Value Gaps
  const fvgs = detectFairValueGaps(h, l, c, o, atrValues);

  // Swing Points
  const swingPoints = detectSwingPoints(swingPivots.pivotHighs, swingPivots.pivotLows);

  // Premium/Discount
  const premiumDiscount = detectPremiumDiscount(c, h, l, swingPivots.pivotHighs, swingPivots.pivotLows);

  // Signals
  const signal = generateSMCSignals(len, internalResult.structures, premiumDiscount, internalResult.trend);

  return {
    swingTrend: swingResult.trend,
    internalTrend: internalResult.trend,
    swingStructures: swingResult.structures,
    internalStructures: internalResult.structures,
    swingOrderBlocks: swingOBs,
    internalOrderBlocks: internalOBs,
    fairValueGaps: fvgs,
    swingPoints,
    premiumDiscount,
    signal,
  };
}

// ─── Supertrend ──────────────────────────────────────────────────
// Based on PineScript v4 Supertrend indicator — trend-following
// overlay using ATR bands that flip on trend change.

export interface SupertrendResult {
  supertrend: (number | null)[];  // supertrend line value
  trend: (1 | -1 | null)[];      // 1 = uptrend, -1 = downtrend
  upperBand: (number | null)[];   // upper ATR band (dn line)
  lowerBand: (number | null)[];   // lower ATR band (up line)
  signal: ("BUY" | "SELL" | null)[];
}

export function supertrend(
  klines: KlineData[],
  atrPeriod = 10,
  multiplier = 3.0,
): SupertrendResult {
  const h = highs(klines);
  const l = lows(klines);
  const c = closes(klines);
  const len = klines.length;

  // ATR calculation (true ATR with EMA-style smoothing)
  const tr: number[] = [];
  for (let i = 0; i < len; i++) {
    if (i === 0) { tr.push(h[i] - l[i]); continue; }
    tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  }

  const atrArr: (number | null)[] = [];
  let atrPrev: number | null = null;
  for (let i = 0; i < len; i++) {
    if (i < atrPeriod - 1) { atrArr.push(null); continue; }
    if (atrPrev === null) {
      let sum = 0;
      for (let j = i - atrPeriod + 1; j <= i; j++) sum += tr[j];
      atrPrev = sum / atrPeriod;
    } else {
      atrPrev = (atrPrev * (atrPeriod - 1) + tr[i]) / atrPeriod;
    }
    atrArr.push(atrPrev);
  }

  // Supertrend calculation
  // src = hl2 = (high + low) / 2
  // up = src - (Multiplier * atr)    → lower band (support in uptrend)
  // dn = src + (Multiplier * atr)    → upper band (resistance in downtrend)
  const supertrendArr: (number | null)[] = new Array(len).fill(null);
  const trendArr: (1 | -1 | null)[] = new Array(len).fill(null);
  const upperBand: (number | null)[] = new Array(len).fill(null);
  const lowerBand: (number | null)[] = new Array(len).fill(null);
  const signalArr: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);

  let prevUp = 0;
  let prevDn = Infinity;
  let prevTrend: 1 | -1 = 1;

  for (let i = 0; i < len; i++) {
    const a = atrArr[i];
    if (a === null) continue;

    const src = (h[i] + l[i]) / 2;
    let up = src - multiplier * a;
    let dn = src + multiplier * a;

    // Adjust bands: up can only go up, dn can only go down (like PineScript)
    // up := close[1] > up1 ? max(up, up1) : up
    if (i > 0 && c[i - 1] > prevUp) {
      up = Math.max(up, prevUp);
    }
    // dn := close[1] < dn1 ? min(dn, dn1) : dn
    if (i > 0 && c[i - 1] < prevDn) {
      dn = Math.min(dn, prevDn);
    }

    // Trend determination
    // trend := trend == -1 and close > dn1 ? 1 : trend == 1 and close < up1 ? -1 : trend
    let trend: 1 | -1 = prevTrend;
    if (prevTrend === -1 && c[i] > prevDn) {
      trend = 1;
    } else if (prevTrend === 1 && c[i] < prevUp) {
      trend = -1;
    }

    lowerBand[i] = up;
    upperBand[i] = dn;
    trendArr[i] = trend;
    supertrendArr[i] = trend === 1 ? up : dn;

    // Buy/Sell signals: trend change
    if (trend === 1 && prevTrend === -1) {
      signalArr[i] = "BUY";
    } else if (trend === -1 && prevTrend === 1) {
      signalArr[i] = "SELL";
    }

    prevUp = up;
    prevDn = dn;
    prevTrend = trend;
  }

  return {
    supertrend: supertrendArr,
    trend: trendArr,
    upperBand,
    lowerBand,
    signal: signalArr,
  };
}

// ─── Squeeze Momentum Indicator [LazyBear] ─────────────────────
// Bollinger Bands squeeze on Keltner Channels — momentum histogram
// with 4-color logic + squeeze on/off detection.

export type SqzMomColor = "lime" | "green" | "red" | "maroon";

export interface SqueezeMomentumResult {
  value: (number | null)[];               // momentum histogram value
  histColor: (SqzMomColor | null)[];      // lime/green/red/maroon
  sqzOn: boolean[];                       // squeeze is active (BB inside KC)
  sqzOff: boolean[];                      // squeeze released (BB outside KC)
  noSqz: boolean[];                       // no squeeze
  signal: ("BUY" | "SELL" | null)[];      // trading signals
}

/**
 * Standard deviation helper (population stdev matching PineScript stdev())
 */
function stdev(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += data[j];
    const mean = sum / period;
    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) sqSum += (data[j] - mean) ** 2;
    result.push(Math.sqrt(sqSum / period));
  }
  return result;
}

/**
 * Highest high over lookback period
 */
function highest(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let max = -Infinity;
    for (let j = i - period + 1; j <= i; j++) if (data[j] > max) max = data[j];
    result.push(max);
  }
  return result;
}

/**
 * Lowest low over lookback period
 */
function lowest(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let min = Infinity;
    for (let j = i - period + 1; j <= i; j++) if (data[j] < min) min = data[j];
    result.push(min);
  }
  return result;
}

/**
 * Linear regression value (like PineScript linreg(source, length, offset))
 */
function linreg(data: number[], period: number, offset: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    const end = i - offset;
    const start = end - period + 1;
    if (start < 0 || end < 0 || end >= data.length) { result.push(null); continue; }
    // Linear regression: y = a + b*x, return value at x = period-1
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    for (let j = 0; j < period; j++) {
      const x = j;
      const y = data[start + j];
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }
    const n = period;
    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) { result.push(null); continue; }
    const b = (n * sumXY - sumX * sumY) / denom;
    const a = (sumY - b * sumX) / n;
    result.push(a + b * (period - 1 - offset));
  }
  return result;
}

export function squeezeMomentum(
  klines: KlineData[],
  bbLength = 20,
  bbMult = 2.0,
  kcLength = 20,
  kcMult = 1.5,
): SqueezeMomentumResult {
  const c = closes(klines);
  const h = highs(klines);
  const l = lows(klines);
  const len = klines.length;

  // True Range for KC
  const tr: number[] = [];
  for (let i = 0; i < len; i++) {
    if (i === 0) { tr.push(h[i] - l[i]); continue; }
    tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  }

  // BB: basis = SMA(close, length), dev = mult * stdev(close, length)
  const basis = sma(c, bbLength);
  const dev = stdev(c, bbLength);

  // KC: ma = SMA(close, kcLength), rangema = SMA(TR, kcLength)
  const kcMa = sma(c, kcLength);
  const rangema = sma(tr, kcLength);

  // Squeeze detection + momentum value
  const value: (number | null)[] = [];
  const histColor: (SqzMomColor | null)[] = [];
  const sqzOn: boolean[] = [];
  const sqzOff: boolean[] = [];
  const noSqz: boolean[] = [];
  const signal: ("BUY" | "SELL" | null)[] = [];

  // Precompute highest/lowest/SMA for momentum calculation
  const highestHigh = highest(h, kcLength);
  const lowestLow = lowest(l, kcLength);

  // Momentum source: close - avg(avg(highest(high,KC), lowest(low,KC)), sma(close,KC))
  const momSource: number[] = [];
  for (let i = 0; i < len; i++) {
    const hh = highestHigh[i];
    const ll = lowestLow[i];
    const ma = kcMa[i];
    if (hh === null || ll === null || ma === null) {
      momSource.push(c[i]); // fallback
    } else {
      momSource.push(c[i] - ((hh + ll) / 2 + ma) / 2);
    }
  }

  // linreg(momSource, kcLength, 0)
  const valArr = linreg(momSource, kcLength, 0);

  for (let i = 0; i < len; i++) {
    const b = basis[i];
    const d = dev[i];
    const km = kcMa[i];
    const rm = rangema[i];

    if (b === null || d === null || km === null || rm === null) {
      value.push(null);
      histColor.push(null);
      sqzOn.push(false);
      sqzOff.push(false);
      noSqz.push(true);
      signal.push(null);
      continue;
    }

    const upperBB = b + bbMult * d;
    const lowerBB = b - bbMult * d;
    const upperKC = km + kcMult * rm;
    const lowerKC = km - kcMult * rm;

    const isOn = lowerBB > lowerKC && upperBB < upperKC;
    const isOff = lowerBB < lowerKC && upperBB > upperKC;
    sqzOn.push(isOn);
    sqzOff.push(isOff);
    noSqz.push(!isOn && !isOff);

    const val = valArr[i];
    value.push(val);

    // 4-color: lime = up & positive, green = down & positive, red = down & negative, maroon = up & negative
    if (val !== null) {
      const prevVal = i > 0 ? valArr[i - 1] : null;
      if (prevVal !== null) {
        if (val > 0) {
          histColor.push(val > prevVal ? "lime" : "green");
        } else {
          histColor.push(val < prevVal ? "red" : "maroon");
        }
      } else {
        histColor.push(val > 0 ? "lime" : "red");
      }
    } else {
      histColor.push(null);
    }

    // Signal: momentum crosses zero + squeeze release
    // BUY: val crosses above 0 (or squeeze off + positive momentum increasing)
    // SELL: val crosses below 0 (or squeeze off + negative momentum increasing)
    if (val !== null && i > 0) {
      const prevVal2 = valArr[i - 1];
      if (prevVal2 !== null) {
        if (prevVal2 <= 0 && val > 0) signal.push("BUY");
        else if (prevVal2 >= 0 && val < 0) signal.push("SELL");
        else signal.push(null);
      } else {
        signal.push(null);
      }
    } else {
      signal.push(null);
    }
  }

  return { value, histColor, sqzOn, sqzOff, noSqz, signal };
}

// ─── Market Structure Break & Order Block (MSB-OB) ─────────────
// ZigZag-based market structure detection with Order Blocks and
// Breaker Blocks. Converted from EmreKb PineScript v5.

export interface MSBOrderBlock {
  startIndex: number;
  high: number;
  low: number;
  type: "Bu-OB" | "Be-OB" | "Bu-BB" | "Be-BB" | "Bu-MB" | "Be-MB";
  broken: boolean;
}

export interface MSBSwingPoint {
  index: number;
  price: number;
  type: "high" | "low";
}

export interface MSBResult {
  trend: (1 | -1 | null)[];          // zigzag trend
  market: (1 | -1 | null)[];         // market structure (1=bull, -1=bear)
  msbSignals: { index: number; bias: "bullish" | "bearish"; level: number }[];
  orderBlocks: MSBOrderBlock[];
  swingPoints: MSBSwingPoint[];       // zigzag swing points for drawing
  signal: ("BUY" | "SELL" | null)[];
}

export function msbOrderBlock(
  klines: KlineData[],
  zigzagLen = 9,
  fibFactor = 0.33,
): MSBResult {
  const h = highs(klines);
  const l = lows(klines);
  const c = closes(klines);
  const o = klines.map(k => +k.open);
  const len = klines.length;

  // ZigZag trend detection
  const highestArr = highest(h, zigzagLen);
  const lowestArr = lowest(l, zigzagLen);

  const trend: (1 | -1 | null)[] = new Array(len).fill(null);
  const market: (1 | -1 | null)[] = new Array(len).fill(null);
  const signal: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);
  const msbSignals: MSBResult["msbSignals"] = [];
  const orderBlocks: MSBOrderBlock[] = [];
  const swingPoints: MSBSwingPoint[] = [];

  // Track swing points
  const highPoints: { price: number; index: number }[] = [];
  const lowPoints: { price: number; index: number }[] = [];

  let curTrend: 1 | -1 = 1;
  let curMarket: 1 | -1 = 1;

  for (let i = zigzagLen; i < len; i++) {
    const toUp = h[i] >= (highestArr[i] ?? 0);
    const toDown = l[i] <= (lowestArr[i] ?? Infinity);

    const prevTrend: 1 | -1 = curTrend;
    if (curTrend === 1 && toDown) curTrend = -1;
    else if (curTrend === -1 && toUp) curTrend = 1;
    trend[i] = curTrend;

    // Record swing points on trend change
    if (curTrend !== prevTrend) {
      if (curTrend === 1) {
        // Find lowest low since last trend change
        let minVal = Infinity, minIdx = i;
        for (let j = Math.max(0, i - zigzagLen * 2); j <= i; j++) {
          if (l[j] < minVal) { minVal = l[j]; minIdx = j; }
        }
        lowPoints.push({ price: minVal, index: minIdx });
        swingPoints.push({ index: minIdx, price: minVal, type: "low" });
      } else {
        let maxVal = -Infinity, maxIdx = i;
        for (let j = Math.max(0, i - zigzagLen * 2); j <= i; j++) {
          if (h[j] > maxVal) { maxVal = h[j]; maxIdx = j; }
        }
        highPoints.push({ price: maxVal, index: maxIdx });
        swingPoints.push({ index: maxIdx, price: maxVal, type: "high" });
      }

      // Check for MSB (market structure break)
      if (highPoints.length >= 2 && lowPoints.length >= 1) {
        const h0 = highPoints[highPoints.length - 1];
        const h1 = highPoints.length >= 2 ? highPoints[highPoints.length - 2] : null;
        const l0 = lowPoints[lowPoints.length - 1];
        const l1 = lowPoints.length >= 2 ? lowPoints[lowPoints.length - 2] : null;

        const prevMarket: 1 | -1 = curMarket;

        // Bullish MSB: new high breaks previous high with fib confirmation
        if (h1 && l0 && curMarket === -1 && h0.price > h1.price &&
            h0.price > h1.price + Math.abs(h1.price - l0.price) * fibFactor) {
          curMarket = 1;
        }
        // Bearish MSB: new low breaks previous low
        if (l1 && h0 && curMarket === 1 && l0.price < l1.price &&
            l0.price < l1.price - Math.abs(h0.price - l1.price) * fibFactor) {
          curMarket = -1;
        }

        if (curMarket !== prevMarket) {
          msbSignals.push({
            index: i,
            bias: curMarket === 1 ? "bullish" : "bearish",
            level: curMarket === 1 ? (h1?.price ?? h0.price) : (l1?.price ?? l0.price),
          });

          // Generate order block
          if (curMarket === 1 && h1) {
            // Bullish OB: last bearish candle between h1 and l0
            for (let j = h1.index; j <= l0.index; j++) {
              if (o[j] > c[j]) {
                orderBlocks.push({ startIndex: j, high: h[j], low: l[j], type: "Bu-OB", broken: false });
                break;
              }
            }
          } else if (curMarket === -1 && l1) {
            // Bearish OB: last bullish candle between l1 and h0
            for (let j = l1.index; j <= h0.index; j++) {
              if (o[j] < c[j]) {
                orderBlocks.push({ startIndex: j, high: h[j], low: l[j], type: "Be-OB", broken: false });
                break;
              }
            }
          }

          signal[i] = curMarket === 1 ? "BUY" : "SELL";
        }
      }
    }

    market[i] = curMarket;
  }

  // Check OB mitigation
  for (const ob of orderBlocks) {
    for (let i = ob.startIndex + 1; i < len; i++) {
      if (ob.type.startsWith("Bu") && c[i] < ob.low) { ob.broken = true; break; }
      if (ob.type.startsWith("Be") && c[i] > ob.high) { ob.broken = true; break; }
    }
  }

  return { trend, market, msbSignals, orderBlocks, swingPoints, signal };
}

// ─── Support and Resistance Levels with Breaks [LuxAlgo] ───────
// Pivot-based S/R detection with volume-confirmed breakouts.

export interface SupportResistanceResult {
  resistance: (number | null)[];    // resistance level at each bar
  support: (number | null)[];       // support level at each bar
  breakUp: boolean[];               // resistance break with volume
  breakDown: boolean[];             // support break with volume
  bullWick: boolean[];              // bull wick break
  bearWick: boolean[];              // bear wick break
  signal: ("BUY" | "SELL" | null)[];
}

export function supportResistance(
  klines: KlineData[],
  leftBars = 15,
  rightBars = 15,
  volumeThresh = 20,
): SupportResistanceResult {
  const h = highs(klines);
  const l = lows(klines);
  const c = closes(klines);
  const o = klines.map(k => +k.open);
  const v = volumes(klines);
  const len = klines.length;

  // Pivot detection
  const pivotHighs: (number | null)[] = new Array(len).fill(null);
  const pivotLows: (number | null)[] = new Array(len).fill(null);

  for (let i = leftBars; i < len - rightBars; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= leftBars; j++) {
      if (h[i] <= h[i - j]) isHigh = false;
      if (l[i] >= l[i - j]) isLow = false;
    }
    for (let j = 1; j <= rightBars; j++) {
      if (h[i] <= h[i + j]) isHigh = false;
      if (l[i] >= l[i + j]) isLow = false;
    }
    if (isHigh) pivotHighs[i] = h[i];
    if (isLow) pivotLows[i] = l[i];
  }

  // fixnan — carry forward last non-null pivot, shifted by 1
  const resistance: (number | null)[] = new Array(len).fill(null);
  const support: (number | null)[] = new Array(len).fill(null);
  let lastPivotHigh: number | null = null;
  let lastPivotLow: number | null = null;

  for (let i = 0; i < len; i++) {
    if (pivotHighs[i] !== null) lastPivotHigh = pivotHighs[i];
    if (pivotLows[i] !== null) lastPivotLow = pivotLows[i];
    resistance[i] = lastPivotHigh;
    support[i] = lastPivotLow;
  }

  // Volume oscillator: 100 * (EMA5 - EMA10) / EMA10
  const volShort = ema(v, 5);
  const volLong = ema(v, 10);
  const volOsc: (number | null)[] = volShort.map((s, i) => {
    const lg = volLong[i];
    return s !== null && lg !== null && lg !== 0 ? 100 * (s - lg) / lg : null;
  });

  const breakUp: boolean[] = new Array(len).fill(false);
  const breakDown: boolean[] = new Array(len).fill(false);
  const bullWick: boolean[] = new Array(len).fill(false);
  const bearWick: boolean[] = new Array(len).fill(false);
  const signal: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);

  for (let i = 1; i < len; i++) {
    const res = resistance[i];
    const sup = support[i];
    const osc = volOsc[i] ?? 0;

    // Break down (support break)
    if (sup !== null && c[i - 1] >= sup && c[i] < sup) {
      const isBearWick = (o[i] - c[i]) < (h[i] - o[i]);
      if (isBearWick) {
        bearWick[i] = true;
      }
      if (!isBearWick && osc > volumeThresh) {
        breakDown[i] = true;
        signal[i] = "SELL";
      }
    }

    // Break up (resistance break)
    if (res !== null && c[i - 1] <= res && c[i] > res) {
      const isBullWick = (o[i] - l[i]) > (c[i] - o[i]);
      if (isBullWick) {
        bullWick[i] = true;
      }
      if (!isBullWick && osc > volumeThresh) {
        breakUp[i] = true;
        signal[i] = "BUY";
      }
    }
  }

  return { resistance, support, breakUp, breakDown, bullWick, bearWick, signal };
}

// ─── Trendlines with Breaks [LuxAlgo] ──────────────────────────
// Pivot-based dynamic trendlines with slope from ATR/Stdev.

export interface TrendlinesResult {
  upper: (number | null)[];       // down-trendline (resistance)
  lower: (number | null)[];       // up-trendline (support)
  breakUp: boolean[];             // price breaks above upper trendline
  breakDown: boolean[];           // price breaks below lower trendline
  signal: ("BUY" | "SELL" | null)[];
}

export function trendlinesWithBreaks(
  klines: KlineData[],
  length = 14,
  mult = 1.0,
  calcMethod: "Atr" | "Stdev" = "Atr",
): TrendlinesResult {
  const h = highs(klines);
  const l = lows(klines);
  const c = closes(klines);
  const len = klines.length;

  // Pivot detection
  const pivotHighs: (number | null)[] = new Array(len).fill(null);
  const pivotLows: (number | null)[] = new Array(len).fill(null);

  for (let i = length; i < len - length; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= length; j++) {
      if (h[i] <= h[i - j] || h[i] <= h[i + j]) isHigh = false;
      if (l[i] >= l[i - j] || l[i] >= l[i + j]) isLow = false;
    }
    if (isHigh) pivotHighs[i] = h[i];
    if (isLow) pivotLows[i] = l[i];
  }

  // Slope calculation
  const atrArr = atr(klines, length);
  const stdevArr = stdev(c, length);

  function getSlope(i: number): number {
    if (calcMethod === "Stdev") {
      return ((stdevArr[i] ?? 0) / length) * mult;
    }
    return ((atrArr[i] ?? 0) / length) * mult;
  }

  // Calculate trendlines
  const upper: (number | null)[] = new Array(len).fill(null);
  const lower: (number | null)[] = new Array(len).fill(null);
  const breakUpArr: boolean[] = new Array(len).fill(false);
  const breakDownArr: boolean[] = new Array(len).fill(false);
  const signal: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);

  let curUpper = 0;
  let curLower = 0;
  let slopePh = 0;
  let slopePl = 0;
  let upos = 0;
  let dnos = 0;

  for (let i = 0; i < len; i++) {
    const slope = getSlope(i);

    if (pivotHighs[i] !== null) {
      curUpper = pivotHighs[i]!;
      slopePh = slope;
      upos = 0;
    } else {
      curUpper = curUpper - slopePh;
    }

    if (pivotLows[i] !== null) {
      curLower = pivotLows[i]!;
      slopePl = slope;
      dnos = 0;
    } else {
      curLower = curLower + slopePl;
    }

    upper[i] = curUpper;
    lower[i] = curLower;

    // Break detection
    const prevUpos = upos;
    const prevDnos = dnos;

    if (pivotHighs[i] !== null) {
      upos = 0;
    } else if (c[i] > curUpper) {
      upos = 1;
    }

    if (pivotLows[i] !== null) {
      dnos = 0;
    } else if (c[i] < curLower) {
      dnos = 1;
    }

    if (upos > prevUpos) {
      breakUpArr[i] = true;
      signal[i] = "BUY";
    }
    if (dnos > prevDnos) {
      breakDownArr[i] = true;
      signal[i] = "SELL";
    }
  }

  return { upper, lower, breakUp: breakUpArr, breakDown: breakDownArr, signal };
}

// ─── UT Bot Alerts ─────────────────────────────────────────────
// ATR trailing stop based trend detection.
// Buy when price crosses above trailing stop, Sell when below.

export interface UTBotResult {
  trailingStop: (number | null)[];
  pos: (1 | -1 | 0)[];             // 1=long, -1=short, 0=neutral
  signal: ("BUY" | "SELL" | null)[];
}

export function utBot(
  klines: KlineData[],
  keyValue = 1,
  atrPeriod = 10,
): UTBotResult {
  const c = closes(klines);
  const len = klines.length;

  const atrArr = atr(klines, atrPeriod);

  const trailingStop: (number | null)[] = new Array(len).fill(null);
  const pos: (1 | -1 | 0)[] = new Array(len).fill(0);
  const signal: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);

  let prevStop = 0;
  let prevPos = 0;

  for (let i = 0; i < len; i++) {
    const xATR = atrArr[i];
    if (xATR === null) continue;

    const nLoss = keyValue * xATR;
    const src = c[i];
    const prevSrc = i > 0 ? c[i - 1] : src;

    // ATR Trailing Stop
    let stop: number;
    if (src > prevStop && prevSrc > prevStop) {
      stop = Math.max(prevStop, src - nLoss);
    } else if (src < prevStop && prevSrc < prevStop) {
      stop = Math.min(prevStop, src + nLoss);
    } else if (src > prevStop) {
      stop = src - nLoss;
    } else {
      stop = src + nLoss;
    }

    trailingStop[i] = stop;

    // Position
    let curPos: 1 | -1 | 0 = 0;
    if (prevSrc < prevStop && src > prevStop) curPos = 1;
    else if (prevSrc > prevStop && src < prevStop) curPos = -1;
    else curPos = prevPos as (1 | -1 | 0);

    pos[i] = curPos;

    // Signal: crossover/crossunder with EMA(src,1) ≈ src
    const above = src > stop && prevSrc <= prevStop;
    const below = src < stop && prevSrc >= prevStop;
    const buy = src > stop && above;
    const sell = src < stop && below;

    if (buy) signal[i] = "BUY";
    else if (sell) signal[i] = "SELL";

    prevStop = stop;
    prevPos = curPos;
  }

  return { trailingStop, pos, signal };
}

// ─── Chandelier Exit ───────────────────────────────────────────
// ATR-based trailing stop by Alex Orekhov. Direction flips when
// price closes above shortStop[prev] or below longStop[prev].

export interface ChandelierExitResult {
  longStop: (number | null)[];
  shortStop: (number | null)[];
  dir: (1 | -1 | null)[];
  signal: ("BUY" | "SELL" | null)[];
}

export function chandelierExit(
  klines: KlineData[],
  length = 22,
  mult = 3.0,
  useClose = true,
): ChandelierExitResult {
  const c = closes(klines);
  const h = highs(klines);
  const l = lows(klines);
  const len = klines.length;

  const atrArr = atr(klines, length);

  const longStop: (number | null)[] = new Array(len).fill(null);
  const shortStop: (number | null)[] = new Array(len).fill(null);
  const dir: (1 | -1 | null)[] = new Array(len).fill(null);
  const signal: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);

  let prevLongStop: number | null = null;
  let prevShortStop: number | null = null;
  let prevDir: 1 | -1 = 1;
  let started = false;

  for (let i = 0; i < len; i++) {
    const a = atrArr[i];
    if (a === null) continue;

    // Highest / lowest over [i-length+1, i]
    const start = Math.max(0, i - length + 1);
    let hi = -Infinity, lo = Infinity;
    for (let j = start; j <= i; j++) {
      const hv = useClose ? c[j] : h[j];
      const lv = useClose ? c[j] : l[j];
      if (hv > hi) hi = hv;
      if (lv < lo) lo = lv;
    }

    const atrVal = mult * a;
    let curLong = hi - atrVal;
    let curShort = lo + atrVal;

    // Sticky adjustment using close[1]
    const prevC = i > 0 ? c[i - 1] : c[i];
    const lStopPrev = prevLongStop ?? curLong;
    const sStopPrev = prevShortStop ?? curShort;

    if (prevC > lStopPrev) curLong = Math.max(curLong, lStopPrev);
    if (prevC < sStopPrev) curShort = Math.min(curShort, sStopPrev);

    longStop[i] = curLong;
    shortStop[i] = curShort;

    let curDir: 1 | -1 = prevDir;
    if (c[i] > sStopPrev) curDir = 1;
    else if (c[i] < lStopPrev) curDir = -1;

    dir[i] = curDir;

    if (started) {
      if (curDir === 1 && prevDir === -1) signal[i] = "BUY";
      else if (curDir === -1 && prevDir === 1) signal[i] = "SELL";
    }

    prevLongStop = curLong;
    prevShortStop = curShort;
    prevDir = curDir;
    started = true;
  }

  return { longStop, shortStop, dir, signal };
}

// ─── Tony's EMA Scalper ────────────────────────────────────────
// Price-vs-EMA cross with a directional filter: close crossing the
// EMA upward fires BUY; crossing downward fires SELL. Two extra
// reference channels (highest/lowest close over 8 bars) are kept
// for the chart overlay.

export interface TonyEmaScalperResult {
  emaLine: (number | null)[];
  highChannel: (number | null)[];
  lowChannel: (number | null)[];
  signal: ("BUY" | "SELL" | null)[];
}

export function tonyEmaScalper(
  klines: KlineData[],
  length = 20,
  channelLength = 8,
): TonyEmaScalperResult {
  const c = closes(klines);
  const len = klines.length;

  const emaLine = ema(c, length);
  const highChannel = highest(c, channelLength);
  const lowChannel = lowest(c, channelLength);

  const signal: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);

  for (let i = 1; i < len; i++) {
    const e = emaLine[i];
    const ePrev = emaLine[i - 1];
    if (e === null || ePrev === null) continue;

    const prevDiff = c[i - 1] - ePrev;
    const currDiff = c[i] - e;
    const crossUp = prevDiff < 0 && currDiff >= 0;
    const crossDown = prevDiff > 0 && currDiff <= 0;

    if (crossUp) signal[i] = "BUY";
    else if (crossDown) signal[i] = "SELL";
  }

  return { emaLine, highChannel, lowChannel, signal };
}

// ─── SuperTrend STRATEGY (KivancOzbilgic variant) ──────────────
// Same band logic as the original Supertrend but with the
// "Change ATR Calculation Method" flag: when true uses RMA (Wilder)
// ATR; when false uses SMA-of-TR. Source defaults to hl2.

export interface SuperTrendStrategyResult {
  supertrend: (number | null)[];
  trend: (1 | -1 | null)[];
  upperBand: (number | null)[];
  lowerBand: (number | null)[];
  signal: ("BUY" | "SELL" | null)[];
}

export function superTrendStrategy(
  klines: KlineData[],
  atrPeriod = 10,
  multiplier = 3.0,
  changeATR = true,
): SuperTrendStrategyResult {
  const h = highs(klines);
  const l = lows(klines);
  const c = closes(klines);
  const len = klines.length;

  const tr: number[] = [];
  for (let i = 0; i < len; i++) {
    if (i === 0) { tr.push(h[i] - l[i]); continue; }
    tr.push(Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1])));
  }

  const atrArr: (number | null)[] = [];
  if (changeATR) {
    let atrPrev: number | null = null;
    for (let i = 0; i < len; i++) {
      if (i < atrPeriod - 1) { atrArr.push(null); continue; }
      if (atrPrev === null) {
        let sum = 0;
        for (let j = i - atrPeriod + 1; j <= i; j++) sum += tr[j];
        atrPrev = sum / atrPeriod;
      } else {
        atrPrev = (atrPrev * (atrPeriod - 1) + tr[i]) / atrPeriod;
      }
      atrArr.push(atrPrev);
    }
  } else {
    for (let i = 0; i < len; i++) {
      if (i < atrPeriod - 1) { atrArr.push(null); continue; }
      let sum = 0;
      for (let j = i - atrPeriod + 1; j <= i; j++) sum += tr[j];
      atrArr.push(sum / atrPeriod);
    }
  }

  const supertrendArr: (number | null)[] = new Array(len).fill(null);
  const trendArr: (1 | -1 | null)[] = new Array(len).fill(null);
  const upperBand: (number | null)[] = new Array(len).fill(null);
  const lowerBand: (number | null)[] = new Array(len).fill(null);
  const signal: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);

  let prevUp = 0;
  let prevDn = Infinity;
  let prevTrend: 1 | -1 = 1;
  let started = false;

  for (let i = 0; i < len; i++) {
    const a = atrArr[i];
    if (a === null) continue;

    const src = (h[i] + l[i]) / 2;
    let up = src - multiplier * a;
    let dn = src + multiplier * a;

    if (i > 0 && c[i - 1] > prevUp) up = Math.max(up, prevUp);
    if (i > 0 && c[i - 1] < prevDn) dn = Math.min(dn, prevDn);

    let trend: 1 | -1 = prevTrend;
    if (prevTrend === -1 && c[i] > prevDn) trend = 1;
    else if (prevTrend === 1 && c[i] < prevUp) trend = -1;

    lowerBand[i] = up;
    upperBand[i] = dn;
    trendArr[i] = trend;
    supertrendArr[i] = trend === 1 ? up : dn;

    if (started) {
      if (trend === 1 && prevTrend === -1) signal[i] = "BUY";
      else if (trend === -1 && prevTrend === 1) signal[i] = "SELL";
    }

    prevUp = up;
    prevDn = dn;
    prevTrend = trend;
    started = true;
  }

  return { supertrend: supertrendArr, trend: trendArr, upperBand, lowerBand, signal };
}

// ─── Turtle Trade Channels Indicator ───────────────────────────
// Donchian-style channel breakout (entryLength) with a tighter
// channel (exitLength) used for the opposite-side exit.

export interface TurtleChannelsResult {
  upper: (number | null)[];
  lower: (number | null)[];
  exitUpper: (number | null)[];
  exitLower: (number | null)[];
  trendLine: (number | null)[];
  exitLine: (number | null)[];
  signal: ("BUY" | "SELL" | null)[];
}

export function turtleChannels(
  klines: KlineData[],
  entryLength = 20,
  exitLength = 10,
): TurtleChannelsResult {
  const h = highs(klines);
  const l = lows(klines);
  const len = klines.length;

  const upper = highest(h, entryLength);
  const lower = lowest(l, entryLength);
  const exitUpper = highest(h, exitLength);
  const exitLower = lowest(l, exitLength);

  const trendLine: (number | null)[] = new Array(len).fill(null);
  const exitLine: (number | null)[] = new Array(len).fill(null);
  const signal: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);

  let lastUpBreakBar = -Infinity;
  let lastDownBreakBar = -Infinity;
  let inLong = false;

  for (let i = 1; i < len; i++) {
    const pu = upper[i - 1];
    const pl = lower[i - 1];
    const pel = exitLower[i - 1];
    if (pu === null || pl === null || pel === null) continue;

    if (h[i] >= pu) lastUpBreakBar = i;
    if (l[i] <= pl) lastDownBreakBar = i;

    const longInCharge = lastUpBreakBar >= lastDownBreakBar;
    trendLine[i] = longInCharge ? lower[i] : upper[i];
    exitLine[i] = longInCharge ? exitLower[i] : exitUpper[i];

    if (!inLong && h[i] >= pu) {
      signal[i] = "BUY";
      inLong = true;
    } else if (inLong && l[i] <= pel) {
      signal[i] = "SELL";
      inLong = false;
    }
  }

  return { upper, lower, exitUpper, exitLower, trendLine, exitLine, signal };
}

// ─── Scalping PullBack Tool (JustUncleL) ───────────────────────
// Price Action Channel (PAC) + EMA ribbon. Trend is bullish when
// fast EMA and PAC low are above the medium EMA, bearish on the
// mirror condition. A signal fires when price pulls back through
// the PAC after a brief excursion to the opposite side.

export interface ScalpingPullBackResult {
  pacU: (number | null)[];
  pacL: (number | null)[];
  pacC: (number | null)[];
  fastEMA: (number | null)[];
  mediumEMA: (number | null)[];
  slowEMA: (number | null)[];
  trendDirection: (-1 | 0 | 1 | null)[];
  signal: ("BUY" | "SELL" | null)[];
}

export function scalpingPullBack(
  klines: KlineData[],
  pacLength = 34,
  fastEMALength = 89,
  mediumEMALength = 200,
  slowEMALength = 600,
  lookback = 3,
): ScalpingPullBackResult {
  const c = closes(klines);
  const h = highs(klines);
  const l = lows(klines);
  const o = klines.map(k => +k.open);
  const len = klines.length;

  const pacC = ema(c, pacLength);
  const pacU = ema(h, pacLength);
  const pacL = ema(l, pacLength);
  const fastEMA = ema(c, fastEMALength);
  const mediumEMA = ema(c, mediumEMALength);
  const slowEMA = ema(c, slowEMALength);

  const trendDirection: (-1 | 0 | 1 | null)[] = new Array(len).fill(null);
  const signal: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);

  let lastBelowPacC = -Infinity;
  let lastAbovePacC = -Infinity;
  let tradeDirection: -1 | 0 | 1 = 0;

  for (let i = 0; i < len; i++) {
    const fe = fastEMA[i];
    const me = mediumEMA[i];
    const pl = pacL[i];
    const pu = pacU[i];
    const pc = pacC[i];

    if (fe === null || me === null || pl === null || pu === null || pc === null) continue;

    const td: -1 | 0 | 1 =
      fe > me && pl > me ? 1 :
      fe < me && pu < me ? -1 : 0;
    trendDirection[i] = td;

    const sinceBelow = i - lastBelowPacC;
    const sinceAbove = i - lastAbovePacC;

    const pacExitU = o[i] < pu && c[i] > pu && sinceBelow <= lookback;
    const pacExitL = o[i] > pl && c[i] < pl && sinceAbove <= lookback;

    const buy = td === 1 && pacExitU;
    const sell = td === -1 && pacExitL;

    const prevTD = tradeDirection;
    if (tradeDirection === 1 && c[i] < pc) tradeDirection = 0;
    else if (tradeDirection === -1 && c[i] > pc) tradeDirection = 0;
    else if (tradeDirection === 0 && buy) tradeDirection = 1;
    else if (tradeDirection === 0 && sell) tradeDirection = -1;

    if (prevTD === 0 && tradeDirection === 1) signal[i] = "BUY";
    else if (prevTD === 0 && tradeDirection === -1) signal[i] = "SELL";

    if (c[i] < pc) lastBelowPacC = i;
    if (c[i] > pc) lastAbovePacC = i;
  }

  return { pacU, pacL, pacC, fastEMA, mediumEMA, slowEMA, trendDirection, signal };
}

// ─── Trendline Breakouts With Targets (ChartPrime) ─────────────
// Two dynamic trendlines built between consecutive pivot highs
// (resistance, sloping down → bullish break setup) and pivot lows
// (support, sloping up → bearish break setup). A long trade fires
// when close crosses above a downward-sloping resistance trendline;
// short when close crosses below an upward-sloping support
// trendline. TP/SL = ±20 × Zband around the entry bar's extremes.

export interface TrendlineBreakoutTarget {
  index: number;
  direction: 1 | -1;
  entry: number;
  tp: number;
  sl: number;
  hit: "tp" | "sl" | null;
  hitIndex: number | null;
}

export interface TrendlineBreakoutsResult {
  upperTrendline: (number | null)[];
  lowerTrendline: (number | null)[];
  upperSlope: (number | null)[];
  lowerSlope: (number | null)[];
  targets: TrendlineBreakoutTarget[];
  signal: ("BUY" | "SELL" | null)[];
}

export function trendlineBreakouts(
  klines: KlineData[],
  period = 10,
  useWicks = true,
): TrendlineBreakoutsResult {
  const c = closes(klines);
  const h = highs(klines);
  const l = lows(klines);
  const o = klines.map(k => +k.open);
  const len = klines.length;

  const leftBars = period;
  const rightBars = Math.max(1, Math.floor(period / 2));

  const phSrc = useWicks ? h : klines.map((_, i) => (c[i] > o[i] ? c[i] : o[i]));
  const plSrc = useWicks ? l : klines.map((_, i) => (c[i] > o[i] ? o[i] : c[i]));

  const pivotHighs: (number | null)[] = new Array(len).fill(null);
  const pivotLows: (number | null)[] = new Array(len).fill(null);
  for (let i = leftBars; i < len - rightBars; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= leftBars; j++) {
      if (phSrc[i] <= phSrc[i - j]) isHigh = false;
      if (plSrc[i] >= plSrc[i - j]) isLow = false;
    }
    for (let j = 1; j <= rightBars; j++) {
      if (phSrc[i] <= phSrc[i + j]) isHigh = false;
      if (plSrc[i] >= plSrc[i + j]) isLow = false;
    }
    if (isHigh) pivotHighs[i] = phSrc[i];
    if (isLow) pivotLows[i] = plSrc[i];
  }

  const atrArr = atr(klines, 30);

  const upperTrendline: (number | null)[] = new Array(len).fill(null);
  const lowerTrendline: (number | null)[] = new Array(len).fill(null);
  const upperSlope: (number | null)[] = new Array(len).fill(null);
  const lowerSlope: (number | null)[] = new Array(len).fill(null);
  const signal: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);
  const targets: TrendlineBreakoutTarget[] = [];

  let prevPHBar = -1, prevPHPrice = 0;
  let prevPLBar = -1, prevPLPrice = 0;
  let phSlope = 0, plSlope = 0;
  let phStartBar = -1, phStartPrice = 0;
  let plStartBar = -1, plStartPrice = 0;

  let inLong = false;
  let entryTP = 0, entrySL = 0;
  let activeTargetIdx = -1;

  for (let i = 0; i < len; i++) {
    // Confirm pivots after rightBars delay (no look-ahead)
    const confirmIdx = i - rightBars;
    if (confirmIdx >= 0) {
      if (pivotHighs[confirmIdx] !== null) {
        const newBar = confirmIdx;
        const newPrice = pivotHighs[confirmIdx]!;
        if (prevPHBar >= 0) {
          phSlope = (newPrice - prevPHPrice) / (newBar - prevPHBar);
          phStartBar = prevPHBar;
          phStartPrice = prevPHPrice;
        }
        prevPHBar = newBar;
        prevPHPrice = newPrice;
      }
      if (pivotLows[confirmIdx] !== null) {
        const newBar = confirmIdx;
        const newPrice = pivotLows[confirmIdx]!;
        if (prevPLBar >= 0) {
          plSlope = (newPrice - prevPLPrice) / (newBar - prevPLBar);
          plStartBar = prevPLBar;
          plStartPrice = prevPLPrice;
        }
        prevPLBar = newBar;
        prevPLPrice = newPrice;
      }
    }

    const upTL = phStartBar >= 0 ? phStartPrice + phSlope * (i - phStartBar) : null;
    const lowTL = plStartBar >= 0 ? plStartPrice + plSlope * (i - plStartBar) : null;
    upperTrendline[i] = upTL;
    lowerTrendline[i] = lowTL;
    upperSlope[i] = phStartBar >= 0 ? phSlope : null;
    lowerSlope[i] = plStartBar >= 0 ? plSlope : null;

    // Zband — volatility filter (delayed by 20 bars per Pine)
    const refIdx = i - 20;
    const refA = refIdx >= 0 ? (atrArr[refIdx] ?? 0) : 0;
    const refC = refIdx >= 0 ? c[refIdx] : c[i];
    const zband = Math.min(refA * 0.3, refC * 0.003) / 2;

    if (inLong) {
      // Long exit when TP or SL hit
      if (h[i] >= entryTP || c[i] <= entrySL) {
        signal[i] = "SELL";
        if (activeTargetIdx >= 0) {
          targets[activeTargetIdx].hit = h[i] >= entryTP ? "tp" : "sl";
          targets[activeTargetIdx].hitIndex = i;
        }
        inLong = false;
        activeTargetIdx = -1;
      }
    } else if (i > 0) {
      const prevUp = phStartBar >= 0 ? phStartPrice + phSlope * (i - 1 - phStartBar) : null;
      const prevLow = plStartBar >= 0 ? plStartPrice + plSlope * (i - 1 - plStartBar) : null;

      // Long: resistance trendline sloping down, close crosses above
      if (upTL !== null && prevUp !== null && phSlope < 0
          && c[i - 1] < prevUp && c[i] > upTL) {
        signal[i] = "BUY";
        const tp = h[i] + zband * 20;
        const sl = l[i] - zband * 20;
        targets.push({ index: i, direction: 1, entry: c[i], tp, sl, hit: null, hitIndex: null });
        activeTargetIdx = targets.length - 1;
        entryTP = tp;
        entrySL = sl;
        inLong = true;
      } else if (lowTL !== null && prevLow !== null && plSlope > 0
          && c[i - 1] > prevLow - zband * 0.1 && c[i] < lowTL - zband * 0.1) {
        // Short signal — informational only (long-only backtest)
        targets.push({ index: i, direction: -1, entry: c[i], tp: l[i] - zband * 20, sl: h[i] + zband * 20, hit: null, hitIndex: null });
      }
    }
  }

  return { upperTrendline, lowerTrendline, upperSlope, lowerSlope, targets, signal };
}

// ─── Smart Money Breakout Channels (AlgoAlpha) ─────────────────
// Volatility-based channel detection: normalize close into [0,1]
// over normLength, take stdev to get vol, then use position of
// vol's max vs min over (boxLength+1) bars. When upper crosses
// above lower with sufficient duration, a channel is drawn around
// the highest/lowest of that duration. Breakouts above/below the
// channel produce BUY/SELL.

export interface BreakoutChannel {
  startIndex: number;
  endIndex: number;
  top: number;
  bottom: number;
  broken: boolean;
  breakDirection: "bullish" | "bearish" | null;
  breakIndex: number | null;
}

export interface SmartMoneyBreakoutResult {
  channels: BreakoutChannel[];
  upbreak: (number | null)[];
  downbreak: (number | null)[];
  signal: ("BUY" | "SELL" | null)[];
}

function highestBarsOffset(data: (number | null)[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let bestIdx = -1, bestVal = -Infinity;
    for (let j = 0; j < period; j++) {
      const v = data[i - j];
      if (v === null) continue;
      if (v > bestVal) { bestVal = v; bestIdx = i - j; }
    }
    result.push(bestIdx < 0 ? null : bestIdx - i);
  }
  return result;
}

function lowestBarsOffset(data: (number | null)[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    let bestIdx = -1, bestVal = Infinity;
    for (let j = 0; j < period; j++) {
      const v = data[i - j];
      if (v === null) continue;
      if (v < bestVal) { bestVal = v; bestIdx = i - j; }
    }
    result.push(bestIdx < 0 ? null : bestIdx - i);
  }
  return result;
}

export function smartMoneyBreakoutChannels(
  klines: KlineData[],
  normLength = 100,
  boxLength = 14,
  strongCloses = true,
  allowOverlap = false,
): SmartMoneyBreakoutResult {
  const c = closes(klines);
  const h = highs(klines);
  const l = lows(klines);
  const o = klines.map(k => +k.open);
  const len = klines.length;

  const hh = highest(h, normLength);
  const ll = lowest(l, normLength);

  const norm: number[] = new Array(len).fill(0.5);
  for (let i = 0; i < len; i++) {
    const hi = hh[i], lo = ll[i];
    if (hi !== null && lo !== null && hi !== lo) {
      norm[i] = (c[i] - lo) / (hi - lo);
    }
  }
  const volArr = stdev(norm, 14);

  const upperBars = highestBarsOffset(volArr, boxLength + 1);
  const lowerBars = lowestBarsOffset(volArr, boxLength + 1);

  const upper: (number | null)[] = new Array(len).fill(null);
  const lower: (number | null)[] = new Array(len).fill(null);
  for (let i = 0; i < len; i++) {
    const ub = upperBars[i];
    const lb = lowerBars[i];
    if (ub !== null) upper[i] = (ub + boxLength) / boxLength;
    if (lb !== null) lower[i] = (lb + boxLength) / boxLength;
  }

  // duration since lower crossed above upper
  let lastLowerCrossUp = -1;
  const duration: number[] = new Array(len).fill(1);
  for (let i = 1; i < len; i++) {
    const lo = lower[i], up = upper[i];
    const loPrev = lower[i - 1], upPrev = upper[i - 1];
    if (lo !== null && up !== null && loPrev !== null && upPrev !== null) {
      if (loPrev <= upPrev && lo > up) lastLowerCrossUp = i;
    }
    duration[i] = lastLowerCrossUp >= 0 ? i - lastLowerCrossUp : 1;
  }

  const channels: BreakoutChannel[] = [];
  const upbreak: (number | null)[] = new Array(len).fill(null);
  const downbreak: (number | null)[] = new Array(len).fill(null);
  const signal: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);

  for (let i = 1; i < len; i++) {
    const lo = lower[i], up = upper[i];
    const loPrev = lower[i - 1], upPrev = upper[i - 1];

    // crossover(upper, lower)
    const crossUp = up !== null && lo !== null && upPrev !== null && loPrev !== null
      && upPrev <= loPrev && up > lo;

    if (crossUp && duration[i] > 10) {
      const dur = duration[i];
      const startIdx = Math.max(0, i - dur);
      let boxHigh = -Infinity, boxLow = Infinity;
      for (let j = startIdx; j <= i; j++) {
        if (h[j] > boxHigh) boxHigh = h[j];
        if (l[j] < boxLow) boxLow = l[j];
      }
      let canCreate = true;
      if (!allowOverlap) {
        for (const a of channels) {
          if (a.broken) continue;
          if (boxHigh > a.bottom && boxLow < a.top) { canCreate = false; break; }
        }
      }
      if (canCreate) {
        channels.push({
          startIndex: startIdx,
          endIndex: i,
          top: boxHigh,
          bottom: boxLow,
          broken: false,
          breakDirection: null,
          breakIndex: null,
        });
      }
    }

    const checkPrice = strongCloses ? (c[i] + o[i]) / 2 : c[i];
    for (const ch of channels) {
      if (ch.broken) continue;
      if (checkPrice > ch.top) {
        ch.broken = true;
        ch.breakDirection = "bullish";
        ch.breakIndex = i;
        upbreak[i] = ch.bottom;
        signal[i] = "BUY";
      } else if (checkPrice < ch.bottom) {
        ch.broken = true;
        ch.breakDirection = "bearish";
        ch.breakIndex = i;
        downbreak[i] = ch.top;
        signal[i] = "SELL";
      } else {
        ch.endIndex = i;
      }
    }
  }

  return { channels, upbreak, downbreak, signal };
}

// ─── Support and Resistance (High Volume Boxes) [ChartPrime] ───
// Pivot-based S/R levels filtered by directional (delta) volume.
// Support = pivot low with strong positive volume; resistance =
// pivot high with strong negative volume. Boxes extend by ATR(200)
// × boxWidth. Breakouts: low crossing above (resistance + width) =
// BUY, high crossing below (support − width) = SELL.

export interface SRHighVolumeBox {
  startIndex: number;
  endIndex: number;
  level: number;
  top: number;
  bottom: number;
  type: "support" | "resistance";
  volume: number;
  broken: boolean;
  brokenAtIndex: number | null;
}

export interface SRHighVolumeResult {
  supportLevel: (number | null)[];
  resistanceLevel: (number | null)[];
  boxes: SRHighVolumeBox[];
  signal: ("BUY" | "SELL" | null)[];
}

export function srHighVolumeBoxes(
  klines: KlineData[],
  lookbackPeriod = 20,
  volLen = 2,
  boxWidth = 1.0,
): SRHighVolumeResult {
  const c = closes(klines);
  const h = highs(klines);
  const l = lows(klines);
  const o = klines.map(k => +k.open);
  const v = volumes(klines);
  const len = klines.length;

  // Delta volume: sign sticky on doji
  const deltaVol: number[] = new Array(len).fill(0);
  let lastSign: 1 | -1 = 1;
  for (let i = 0; i < len; i++) {
    if (c[i] > o[i]) lastSign = 1;
    else if (c[i] < o[i]) lastSign = -1;
    deltaVol[i] = lastSign * v[i];
  }

  const scaled = deltaVol.map(x => x / 2.5);
  const volHi = highest(scaled, volLen);
  const volLo = lowest(scaled, volLen);

  const pivotHighs: (number | null)[] = new Array(len).fill(null);
  const pivotLows: (number | null)[] = new Array(len).fill(null);
  for (let i = lookbackPeriod; i < len - lookbackPeriod; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= lookbackPeriod; j++) {
      if (h[i] <= h[i - j] || h[i] <= h[i + j]) isHigh = false;
      if (l[i] >= l[i - j] || l[i] >= l[i + j]) isLow = false;
    }
    if (isHigh) pivotHighs[i] = h[i];
    if (isLow) pivotLows[i] = l[i];
  }

  const atrArr = atr(klines, 200);

  const supportLevel: (number | null)[] = new Array(len).fill(null);
  const resistanceLevel: (number | null)[] = new Array(len).fill(null);
  const signal: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);
  const boxes: SRHighVolumeBox[] = [];

  let supLevel: number | null = null;
  let supBottom: number | null = null;
  let resLevel: number | null = null;
  let resTop: number | null = null;

  for (let i = 0; i < len; i++) {
    // Pivot confirmation is delayed by lookbackPeriod — use confirmIdx
    const confirmIdx = i - lookbackPeriod;
    const a = atrArr[i] ?? 0;
    const width = a * boxWidth;
    const vol = deltaVol[i];
    const vh = volHi[i] ?? 0;
    const vl = volLo[i] ?? 0;

    if (confirmIdx >= 0) {
      if (pivotLows[confirmIdx] !== null && vol > vh) {
        supLevel = pivotLows[confirmIdx]!;
        supBottom = supLevel - width;
        boxes.push({
          startIndex: Math.max(0, confirmIdx - lookbackPeriod),
          endIndex: i,
          level: supLevel,
          top: supLevel,
          bottom: supBottom,
          type: "support",
          volume: vol,
          broken: false,
          brokenAtIndex: null,
        });
      }
      if (pivotHighs[confirmIdx] !== null && vol < vl) {
        resLevel = pivotHighs[confirmIdx]!;
        resTop = resLevel + width;
        boxes.push({
          startIndex: Math.max(0, confirmIdx - lookbackPeriod),
          endIndex: i,
          level: resLevel,
          top: resTop,
          bottom: resLevel,
          type: "resistance",
          volume: vol,
          broken: false,
          brokenAtIndex: null,
        });
      }
    }

    supportLevel[i] = supLevel;
    resistanceLevel[i] = resLevel;

    if (i > 0) {
      // BUY: low crosses above resistance top (resistance + width)
      if (resLevel !== null && resTop !== null
          && l[i - 1] < resTop && l[i] >= resTop) {
        signal[i] = "BUY";
        for (let bi = boxes.length - 1; bi >= 0; bi--) {
          if (boxes[bi].type === "resistance" && !boxes[bi].broken) {
            boxes[bi].broken = true;
            boxes[bi].brokenAtIndex = i;
            break;
          }
        }
      }
      // SELL: high crosses below support bottom (support − width)
      if (supLevel !== null && supBottom !== null
          && h[i - 1] > supBottom && h[i] <= supBottom) {
        signal[i] = "SELL";
        for (let bi = boxes.length - 1; bi >= 0; bi--) {
          if (boxes[bi].type === "support" && !boxes[bi].broken) {
            boxes[bi].broken = true;
            boxes[bi].brokenAtIndex = i;
            break;
          }
        }
      }
    }

    // Extend last unbroken box endIndex
    for (let bi = boxes.length - 1; bi >= 0; bi--) {
      if (!boxes[bi].broken) boxes[bi].endIndex = i;
    }
  }

  return { supportLevel, resistanceLevel, boxes, signal };
}

// ─── CDC Action Zone V.2 ───────────────────────────────────────
// Piriya's 2016 version: ohlc4 source pre-smoothed by EMA(2), then
// two EMAs (fast/slow). Four zones (green/red/yellow/blue) and a
// signal on simple bullish/bearish crossover.

export type CDCV2Zone = "green" | "red" | "yellow" | "blue" | null;

export interface CDCActionZoneV2Result {
  ap: (number | null)[];
  fast: (number | null)[];
  slow: (number | null)[];
  zone: CDCV2Zone[];
  signal: ("BUY" | "SELL" | null)[];
}

export function cdcActionZoneV2(
  klines: KlineData[],
  fastPeriod = 12,
  slowPeriod = 26,
): CDCActionZoneV2Result {
  const len = klines.length;
  const src = klines.map(k => (+k.open + +k.high + +k.low + +k.close) / 4);
  const ap = ema(src, 2);
  const apFilled = ap.map((v, i) => v ?? src[i]);
  const fast = ema(apFilled, fastPeriod);
  const slow = ema(apFilled, slowPeriod);

  const zone: CDCV2Zone[] = [];
  const signal: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);

  let prevBull: boolean | null = null;

  for (let i = 0; i < len; i++) {
    const f = fast[i], s = slow[i], p = apFilled[i];
    if (f === null || s === null) {
      zone.push(null);
      continue;
    }
    const bullish = f > s;
    const bearish = f < s;
    let z: CDCV2Zone = null;
    if (bullish && p > f) z = "green";
    else if (bearish && p < f) z = "red";
    else if (bullish && p < f) z = "yellow";
    else if (bearish && p > f) z = "blue";
    zone.push(z);

    if (prevBull !== null) {
      if (bullish && prevBull === false) signal[i] = "BUY";
      else if (bearish && prevBull === true) signal[i] = "SELL";
    }
    if (bullish) prevBull = true;
    else if (bearish) prevBull = false;
  }

  return { ap, fast, slow, zone, signal };
}

// ─── ZigZag++ (DevLucem-style) ─────────────────────────────────
// Percent-deviation ZigZag: tracks current trend extreme, flips
// direction when price retraces deviationPct from the extreme.
// Backstep enforces minimum bars between adjacent swings.

export interface ZigZagPoint {
  index: number;
  price: number;
  type: "HH" | "LH" | "HL" | "LL" | "H" | "L";
  direction: 1 | -1;
}

export interface ZigZagPPResult {
  direction: (1 | -1 | null)[];
  swingPoints: ZigZagPoint[];
  signal: ("BUY" | "SELL" | null)[];
}

export function zigzagPlusPlus(
  klines: KlineData[],
  depth = 12,
  deviationPct = 5,
  backstep = 2,
): ZigZagPPResult {
  const h = highs(klines);
  const l = lows(klines);
  const len = klines.length;

  const swingPoints: ZigZagPoint[] = [];
  const direction: (1 | -1 | null)[] = new Array(len).fill(null);
  const signal: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);

  if (len === 0) return { direction, swingPoints, signal };

  // Seed: scan first `depth` bars to pick initial direction
  let startIdx = Math.min(depth, len - 1);
  let dir: 1 | -1 = 1;
  let extIdx = 0, extPrice = h[0];
  for (let i = 0; i <= startIdx; i++) {
    if (h[i] > extPrice) { extPrice = h[i]; extIdx = i; }
  }
  let lastSwingBar = extIdx;

  for (let i = startIdx + 1; i < len; i++) {
    if (dir === 1) {
      if (h[i] > extPrice) {
        extPrice = h[i];
        extIdx = i;
      }
      const flipLevel = extPrice * (1 - deviationPct / 100);
      if (l[i] < flipLevel && (i - lastSwingBar) >= backstep) {
        const prevH = [...swingPoints].reverse().find(sp => sp.direction === 1);
        const t: ZigZagPoint["type"] = prevH ? (extPrice > prevH.price ? "HH" : "LH") : "H";
        swingPoints.push({ index: extIdx, price: extPrice, type: t, direction: 1 });
        signal[i] = "SELL";
        dir = -1;
        lastSwingBar = extIdx;
        extIdx = i;
        extPrice = l[i];
      }
    } else {
      if (l[i] < extPrice) {
        extPrice = l[i];
        extIdx = i;
      }
      const flipLevel = extPrice * (1 + deviationPct / 100);
      if (h[i] > flipLevel && (i - lastSwingBar) >= backstep) {
        const prevL = [...swingPoints].reverse().find(sp => sp.direction === -1);
        const t: ZigZagPoint["type"] = prevL ? (extPrice > prevL.price ? "HL" : "LL") : "L";
        swingPoints.push({ index: extIdx, price: extPrice, type: t, direction: -1 });
        signal[i] = "BUY";
        dir = 1;
        lastSwingBar = extIdx;
        extIdx = i;
        extPrice = h[i];
      }
    }
    direction[i] = dir;
  }

  return { direction, swingPoints, signal };
}

// ─── Price Action - Smart Money Concepts (BigBeluga) ───────────
// Pivot-based market structure (mslen) with BOS, CHoCH, optional
// Sweep events (false break that closes back inside). Bullish CHoCH
// emits BUY, bearish CHoCH emits SELL.

export type PASMCEvent = "BOS" | "CHoCH" | "Sweep";

export interface PASMCStructure {
  index: number;
  type: PASMCEvent;
  bias: SMCBias;
  level: number;
  pivotIndex: number;
}

export interface PASMCOrderBlock {
  startIndex: number;
  endIndex: number;
  high: number;
  low: number;
  mid: number;
  bias: SMCBias;
  volume: number;
  mitigated: boolean;
  mitigatedIndex: number | null;
}

export interface PriceActionSMCResult {
  trend: (SMCBias | null)[];
  swingTrend: (SMCBias | null)[];                                   // dominant trend from swingLen pivots
  premiumDiscount: ("premium" | "discount" | "equilibrium" | null)[];
  structures: PASMCStructure[];
  orderBlocks: PASMCOrderBlock[];
  swingPoints: SMCSwingPoint[];
  signal: ("BUY" | "SELL" | null)[];
}

export function priceActionSMC(
  klines: KlineData[],
  mslen = 5,
  obLengthMode: "Length" | "Full" = "Length",
  obLength = 5,
  buildSweep = true,
  swingLen = 50,
  useSwingFilter = true,
  useOBConfluence = true,
): PriceActionSMCResult {
  const c = closes(klines);
  const h = highs(klines);
  const l = lows(klines);
  const o = klines.map(k => +k.open);
  const v = volumes(klines);
  const len = klines.length;

  const atrArr = atr(klines, 200);

  // Swing-level structure (bigger pivots) — dominant trend + premium/discount
  // zone + fair-value gaps. This is what makes swingLen actually affect the
  // signals (internal CHoCH alone ignores it → identical to plain SMC).
  const swingPivots = detectPivots(h, l, swingLen);
  const swingTrend = detectStructure(c, h, l, swingPivots.pivotHighs, swingPivots.pivotLows).trend;
  const premiumDiscount = detectPremiumDiscount(c, h, l, swingPivots.pivotHighs, swingPivots.pivotLows);
  const fvgs = detectFairValueGaps(h, l, c, o, atrArr);
  const confWindow = Math.max(5, mslen * 2);

  // Pivots
  const pivotHighs: (number | null)[] = new Array(len).fill(null);
  const pivotLows: (number | null)[] = new Array(len).fill(null);
  for (let i = mslen; i < len - mslen; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= mslen; j++) {
      if (h[i] <= h[i - j] || h[i] <= h[i + j]) isHigh = false;
      if (l[i] >= l[i - j] || l[i] >= l[i + j]) isLow = false;
    }
    if (isHigh) pivotHighs[i] = h[i];
    if (isLow) pivotLows[i] = l[i];
  }

  // Swing points labelled HH/LH/HL/LL
  const swingPoints: SMCSwingPoint[] = [];
  let lastHigh: number | null = null;
  let lastLow: number | null = null;
  for (let i = 0; i < len; i++) {
    if (pivotHighs[i] !== null) {
      const price = pivotHighs[i]!;
      const t: SMCSwingPoint["type"] = lastHigh === null ? "H" : price > lastHigh ? "HH" : "LH";
      swingPoints.push({ index: i, price, type: t });
      lastHigh = price;
    }
    if (pivotLows[i] !== null) {
      const price = pivotLows[i]!;
      const t: SMCSwingPoint["type"] = lastLow === null ? "L" : price > lastLow ? "HL" : "LL";
      swingPoints.push({ index: i, price, type: t });
      lastLow = price;
    }
  }

  const trend: (SMCBias | null)[] = new Array(len).fill(null);
  const structures: PASMCStructure[] = [];
  const orderBlocks: PASMCOrderBlock[] = [];
  const signal: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);

  let curTrend: SMCBias | null = null;
  let lastPH: { price: number; index: number; crossed: boolean } | null = null;
  let lastPL: { price: number; index: number; crossed: boolean } | null = null;

  const addOB = (pivotIdx: number, bias: SMCBias) => {
    const searchEnd = pivotIdx;
    const searchStart = Math.max(0, searchEnd - 20);
    for (let j = searchEnd; j >= searchStart; j--) {
      const isBullCandle = c[j] > o[j];
      const isBearCandle = c[j] < o[j];
      if (bias === "bullish" && isBearCandle) {
        const a = atrArr[j] ?? 0;
        const top = obLengthMode === "Length"
          ? Math.min(h[j], l[j] + (obLength / 5) * a)
          : h[j];
        orderBlocks.push({
          startIndex: j,
          endIndex: j,
          high: top,
          low: l[j],
          mid: (top + l[j]) / 2,
          bias: "bullish",
          volume: v[j],
          mitigated: false,
          mitigatedIndex: null,
        });
        return;
      }
      if (bias === "bearish" && isBullCandle) {
        const a = atrArr[j] ?? 0;
        const bottom = obLengthMode === "Length"
          ? Math.max(l[j], h[j] - (obLength / 5) * a)
          : l[j];
        orderBlocks.push({
          startIndex: j,
          endIndex: j,
          high: h[j],
          low: bottom,
          mid: (h[j] + bottom) / 2,
          bias: "bearish",
          volume: v[j],
          mitigated: false,
          mitigatedIndex: null,
        });
        return;
      }
    }
  };

  // price tapped a bullish OB or unfilled bullish FVG within the confluence window
  const tappedBullishZone = (i: number): boolean => {
    const winStart = Math.max(0, i - confWindow);
    for (const ob of orderBlocks) {
      if (ob.bias !== "bullish" || ob.startIndex > i) continue;
      if (ob.mitigatedIndex !== null && winStart >= ob.mitigatedIndex) continue;
      for (let k = Math.max(winStart, ob.startIndex + 1); k <= i; k++) {
        if (l[k] <= ob.high && h[k] >= ob.low) return true;
      }
    }
    for (const f of fvgs) {
      if (f.bias !== "bullish" || f.index >= i) continue;
      if (f.filledIndex !== null && winStart >= f.filledIndex) continue;
      for (let k = winStart; k <= i; k++) {
        if (l[k] <= f.top && h[k] >= f.bottom) return true;
      }
    }
    return false;
  };

  for (let i = 0; i < len; i++) {
    if (pivotHighs[i] !== null) lastPH = { price: pivotHighs[i]!, index: i, crossed: false };
    if (pivotLows[i] !== null) lastPL = { price: pivotLows[i]!, index: i, crossed: false };

    // Sweep detection: high pokes above pivot but close back below
    if (buildSweep && lastPH && !lastPH.crossed
        && h[i] > lastPH.price && c[i] <= lastPH.price) {
      structures.push({ index: i, type: "Sweep", bias: "bearish", level: lastPH.price, pivotIndex: lastPH.index });
    }
    if (buildSweep && lastPL && !lastPL.crossed
        && l[i] < lastPL.price && c[i] >= lastPL.price) {
      structures.push({ index: i, type: "Sweep", bias: "bullish", level: lastPL.price, pivotIndex: lastPL.index });
    }

    // Bullish break: close above last pivot high
    if (lastPH && !lastPH.crossed && c[i] > lastPH.price) {
      const t: PASMCEvent = curTrend === "bearish" ? "CHoCH" : "BOS";
      structures.push({ index: i, type: t, bias: "bullish", level: lastPH.price, pivotIndex: lastPH.index });
      addOB(lastPH.index, "bullish");
      // BUY on bullish CHoCH that aligns with the dominant swing trend, sits in
      // the discount zone, and has OB/FVG confluence (filters make swingLen matter)
      if (t === "CHoCH") {
        const zone = premiumDiscount[i];
        const swingOK = !useSwingFilter || swingTrend[i] === "bullish";
        const zoneOK = !useSwingFilter || zone === "discount" || zone === "equilibrium";
        const confOK = !useOBConfluence || tappedBullishZone(i);
        if (swingOK && zoneOK && confOK) signal[i] = "BUY";
      }
      lastPH.crossed = true;
      curTrend = "bullish";
    }
    // Bearish break: close below last pivot low
    if (lastPL && !lastPL.crossed && c[i] < lastPL.price) {
      const t: PASMCEvent = curTrend === "bullish" ? "CHoCH" : "BOS";
      structures.push({ index: i, type: t, bias: "bearish", level: lastPL.price, pivotIndex: lastPL.index });
      addOB(lastPL.index, "bearish");
      if (t === "CHoCH") signal[i] = "SELL";
      lastPL.crossed = true;
      curTrend = "bearish";
    }

    // Exit longs when the dominant swing trend flips bearish
    if (useSwingFilter && signal[i] === null && i > 0
        && swingTrend[i] === "bearish" && swingTrend[i - 1] !== "bearish") {
      signal[i] = "SELL";
    }

    trend[i] = curTrend;

    // Mitigate OBs (close back into the block)
    for (const ob of orderBlocks) {
      if (ob.mitigated) continue;
      if (ob.bias === "bullish" && l[i] <= ob.low && i > ob.startIndex) {
        ob.mitigated = true;
        ob.mitigatedIndex = i;
      } else if (ob.bias === "bearish" && h[i] >= ob.high && i > ob.startIndex) {
        ob.mitigated = true;
        ob.mitigatedIndex = i;
      } else if (!ob.mitigated) {
        ob.endIndex = i;
      }
    }
  }

  return { trend, swingTrend, premiumDiscount, structures, orderBlocks, swingPoints, signal };
}

// ─── Price Action - Support & Resistance (DGT) ─────────────────
// Detects 3-bar consecutive bull/bear sequences as S/R levels.
// Bull sequences produce resistance (highestHigh), bear sequences
// produce support (lowestLow). Also flags volume spikes (vol >
// threshold × volSMA) and high-volatility bars (range > mult ×
// ATR). Signal: BUY when close breaks above last resistance, SELL
// when close breaks below last support.

export interface PASRLine {
  startIndex: number;
  endIndex: number;
  level: number;
  type: "support" | "resistance" | "spike" | "volatility";
  broken: boolean;
  brokenAtIndex: number | null;
}

export interface PriceActionSRResult {
  supportLevel: (number | null)[];
  resistanceLevel: (number | null)[];
  lines: PASRLine[];
  volumeSpikes: number[];      // bar indices flagged as volume spike
  highVolatility: number[];    // bar indices flagged as high volatility
  signal: ("BUY" | "SELL" | null)[];
}

export function priceActionSR(
  klines: KlineData[],
  volMaLength = 89,
  volSpikeThresh = 4.669,
  atrLength = 11,
  atrMult = 2.718,
  useVolume = true,
): PriceActionSRResult {
  const c = closes(klines);
  const h = highs(klines);
  const l = lows(klines);
  const o = klines.map(k => +k.open);
  const v = volumes(klines);
  const len = klines.length;

  const volSMA = sma(v, volMaLength);
  const atrArr = atr(klines, atrLength);

  const supportLevel: (number | null)[] = new Array(len).fill(null);
  const resistanceLevel: (number | null)[] = new Array(len).fill(null);
  const signal: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);
  const lines: PASRLine[] = [];
  const volumeSpikes: number[] = [];
  const highVolatility: number[] = [];

  let sup: number | null = null;
  let res: number | null = null;
  let lastLine: PASRLine | null = null;
  let lastDirState: "rising" | "falling" | null = null;

  for (let i = 2; i < len; i++) {
    const bull = c[i] > o[i];
    const bear = c[i] < o[i];
    const bullPrev = c[i - 1] > o[i - 1];
    const bearPrev = c[i - 1] < o[i - 1];
    const bull2 = c[i - 2] > o[i - 2];
    const bear2 = c[i - 2] < o[i - 2];
    const vsma = volSMA[i] ?? 0;
    const a = atrArr[i] ?? 0;

    const risingVol = v[i] >= v[i - 1];
    const risingVolPrev = v[i - 1] >= v[i - 2];
    const aboveAvg = v[i] > vsma;
    const risingPrice = c[i] > c[i - 1];
    const risingPricePrev = c[i - 1] > c[i - 2];
    const risingPrice2 = c[i - 2] > c[i - 3 >= 0 ? i - 3 : i - 2];
    const fallingPrice = c[i] < c[i - 1];
    const fallingPricePrev = c[i - 1] < c[i - 2];
    const fallingPrice2 = c[i - 2] < c[i - 3 >= 0 ? i - 3 : i - 2];

    const rising = useVolume
      ? bull && bullPrev && bull2 && aboveAvg && risingVol && risingVolPrev
      : bull && bullPrev && bull2 && risingPrice && risingPricePrev && risingPrice2;

    const falling = useVolume
      ? bear && bearPrev && bear2 && aboveAvg && risingVol && risingVolPrev
      : bear && bearPrev && bear2 && fallingPrice && fallingPricePrev && fallingPrice2;

    const lwst = Math.min(l[i], l[i - 1], l[i - 2]);
    const hst = Math.max(h[i], h[i - 1], h[i - 2]);

    if (rising) {
      res = hst;
      if (lastDirState !== "rising" || !lastLine) {
        lastLine = {
          startIndex: i - 2,
          endIndex: i,
          level: hst,
          type: "resistance",
          broken: false,
          brokenAtIndex: null,
        };
        lines.push(lastLine);
      } else {
        lastLine.endIndex = i;
        lastLine.level = hst;
      }
      lastDirState = "rising";
    } else if (falling) {
      sup = lwst;
      if (lastDirState !== "falling" || !lastLine) {
        lastLine = {
          startIndex: i - 2,
          endIndex: i,
          level: lwst,
          type: "support",
          broken: false,
          brokenAtIndex: null,
        };
        lines.push(lastLine);
      } else {
        lastLine.endIndex = i;
        lastLine.level = lwst;
      }
      lastDirState = "falling";
    } else {
      // Extend last line's right edge
      if (lastLine && !lastLine.broken) lastLine.endIndex = i;
      lastDirState = null;
    }

    // Volume spike
    if (useVolume && vsma > 0 && v[i] > volSpikeThresh * vsma) {
      volumeSpikes.push(i);
      lines.push({
        startIndex: i,
        endIndex: Math.min(i + 30, len - 1),
        level: bull ? h[i] : l[i],
        type: "spike",
        broken: false,
        brokenAtIndex: null,
      });
    }

    // High volatility
    const range = Math.abs(h[i] - l[i]);
    if (a > 0 && range > atrMult * a) {
      highVolatility.push(i);
      lines.push({
        startIndex: i,
        endIndex: Math.min(i + 30, len - 1),
        level: bull ? h[i] : l[i],
        type: "volatility",
        broken: false,
        brokenAtIndex: null,
      });
    }

    // Signal: break of S/R level
    if (i > 0) {
      if (res !== null && c[i - 1] <= res && c[i] > res) {
        signal[i] = "BUY";
        // Mark resistance line broken
        for (let li = lines.length - 1; li >= 0; li--) {
          if (lines[li].type === "resistance" && !lines[li].broken) {
            lines[li].broken = true;
            lines[li].brokenAtIndex = i;
            break;
          }
        }
        res = null;
      } else if (sup !== null && c[i - 1] >= sup && c[i] < sup) {
        signal[i] = "SELL";
        for (let li = lines.length - 1; li >= 0; li--) {
          if (lines[li].type === "support" && !lines[li].broken) {
            lines[li].broken = true;
            lines[li].brokenAtIndex = i;
            break;
          }
        }
        sup = null;
      }
    }

    supportLevel[i] = sup;
    resistanceLevel[i] = res;
  }

  return { supportLevel, resistanceLevel, lines, volumeSpikes, highVolatility, signal };
}

// ─── Candlestick Patterns Identified (repo32) ──────────────────
// 15 classic Japanese candlestick patterns with the trend filter
// from the original — patterns require open[trend] above/below open.

export type CandlestickPatternType =
  | "Doji" | "BullishHarami" | "BearishHarami"
  | "BullishEngulfing" | "BearishEngulfing"
  | "Piercing" | "BullishBelt" | "BullishKicker" | "BearishKicker"
  | "HangingMan" | "EveningStar" | "MorningStar"
  | "ShootingStar" | "Hammer" | "InvertedHammer";

export interface CandlestickPatternHit {
  index: number;
  pattern: CandlestickPatternType;
  bias: "bullish" | "bearish" | "neutral";
}

export interface CandlestickPatternsResult {
  hits: CandlestickPatternHit[];
  signal: ("BUY" | "SELL" | null)[];
}

export function candlestickPatterns(
  klines: KlineData[],
  trendBars = 5,
  dojiSize = 0.05,
): CandlestickPatternsResult {
  const c = closes(klines);
  const h = highs(klines);
  const l = lows(klines);
  const o = klines.map(k => +k.open);
  const len = klines.length;

  const hits: CandlestickPatternHit[] = [];
  const signal: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);

  for (let i = 2; i < len; i++) {
    const opn = o[i], cls = c[i], hi = h[i], lo = l[i];
    const o1 = o[i - 1], c1 = c[i - 1], h1 = h[i - 1], l1 = l[i - 1];
    const o2 = o[i - 2], c2 = c[i - 2];
    const ot = o[Math.max(0, i - trendBars)];

    const range = hi - lo;
    const body = Math.abs(opn - cls);

    let curHit: CandlestickPatternHit | null = null;

    // Doji
    if (body <= range * dojiSize) {
      curHit = { index: i, pattern: "Doji", bias: "neutral" };
    }
    // Bearish Harami
    else if (c1 > o1 && opn > cls && opn <= c1 && o1 <= cls
        && (opn - cls) < (c1 - o1) && ot < opn) {
      curHit = { index: i, pattern: "BearishHarami", bias: "bearish" };
      signal[i] = "SELL";
    }
    // Bullish Harami
    else if (o1 > c1 && cls > opn && cls <= o1 && c1 <= opn
        && (cls - opn) < (o1 - c1) && ot > opn) {
      curHit = { index: i, pattern: "BullishHarami", bias: "bullish" };
      signal[i] = "BUY";
    }
    // Bearish Engulfing
    else if (c1 > o1 && opn > cls && opn >= c1 && o1 >= cls
        && (opn - cls) > (c1 - o1) && ot < opn) {
      curHit = { index: i, pattern: "BearishEngulfing", bias: "bearish" };
      signal[i] = "SELL";
    }
    // Bullish Engulfing
    else if (o1 > c1 && cls > opn && cls >= o1 && c1 >= opn
        && (cls - opn) > (o1 - c1) && ot > opn) {
      curHit = { index: i, pattern: "BullishEngulfing", bias: "bullish" };
      signal[i] = "BUY";
    }
    // Piercing
    else if (c1 < o1 && opn < l1 && cls > c1 + (o1 - c1) / 2 && cls < o1 && ot > opn) {
      curHit = { index: i, pattern: "Piercing", bias: "bullish" };
      signal[i] = "BUY";
    }
    // Bullish Belt
    else if (i >= 10) {
      let lo10 = Infinity;
      for (let j = i - 10; j < i; j++) if (l[j] < lo10) lo10 = l[j];
      if (lo === opn && opn < lo10 && opn < cls
          && cls > (h1 - l1) / 2 + l1 && ot > opn) {
        curHit = { index: i, pattern: "BullishBelt", bias: "bullish" };
        signal[i] = "BUY";
      }
    }

    // Bullish Kicker
    if (!curHit && o1 > c1 && opn >= o1 && cls > opn && ot > opn) {
      curHit = { index: i, pattern: "BullishKicker", bias: "bullish" };
      signal[i] = "BUY";
    }
    // Bearish Kicker
    if (!curHit && o1 < c1 && opn <= o1 && cls <= opn && ot < opn) {
      curHit = { index: i, pattern: "BearishKicker", bias: "bearish" };
      signal[i] = "SELL";
    }
    // Hanging Man
    if (!curHit && i >= 2 && range > 4 * body
        && (cls - lo) / (0.001 + range) >= 0.75
        && (opn - lo) / (0.001 + range) >= 0.75
        && ot < opn && h1 < opn && h[i - 2] < opn) {
      curHit = { index: i, pattern: "HangingMan", bias: "bearish" };
      signal[i] = "SELL";
    }
    // Evening Star
    if (!curHit && c2 > o2 && Math.min(o1, c1) > c2
        && opn < Math.min(o1, c1) && cls < opn) {
      curHit = { index: i, pattern: "EveningStar", bias: "bearish" };
      signal[i] = "SELL";
    }
    // Morning Star
    if (!curHit && c2 < o2 && Math.max(o1, c1) < c2
        && opn > Math.max(o1, c1) && cls > opn) {
      curHit = { index: i, pattern: "MorningStar", bias: "bullish" };
      signal[i] = "BUY";
    }
    // Shooting Star
    if (!curHit && o1 < c1 && opn > c1
        && hi - Math.max(opn, cls) >= body * 3
        && Math.min(cls, opn) - lo <= body) {
      curHit = { index: i, pattern: "ShootingStar", bias: "bearish" };
      signal[i] = "SELL";
    }
    // Hammer
    if (!curHit && range > 3 * body
        && (cls - lo) / (0.001 + range) > 0.6
        && (opn - lo) / (0.001 + range) > 0.6) {
      curHit = { index: i, pattern: "Hammer", bias: "bullish" };
      signal[i] = "BUY";
    }
    // Inverted Hammer
    if (!curHit && range > 3 * body
        && (hi - cls) / (0.001 + range) > 0.6
        && (hi - opn) / (0.001 + range) > 0.6) {
      curHit = { index: i, pattern: "InvertedHammer", bias: "bullish" };
      signal[i] = "BUY";
    }

    if (curHit) hits.push(curHit);
  }

  return { hits, signal };
}

// ─── Pivot Points High Low (LuxAlgo) ───────────────────────────
// Regular pivots + "missed" pivots (a pivot in the same direction
// where the price never produced an opposite pivot in between).
//
// Signal timing — realistic for live/real trading:
//   The signal is placed at the *detection* bar (= confirmation
//   bar = pivot bar + `length`), NOT at the historical pivot bar.
//   At the moment the signal fires, a live bot has actually had
//   time to observe the pivot since it's `length` bars in the
//   past — no look-ahead bias.
//
// Chart markers — at the historical pivot bar:
//   `pivots[]` and `zigzag[]` still store the historical pivot
//   bar, so chart overlay (graph.tsx) draws the marker at its
//   natural location. The overlay reads from `pivots[]`, not
//   `signal[]`, so chart visuals are independent of signal timing.
//
// Missed pivots (👻): drawn on the chart but do NOT emit signals
//   — they describe a past missed opportunity we only knew about
//   retroactively. Acting on a missed_low at the bar where it's
//   detected would mean buying *after* price has already moved
//   well above that low; the same detection bar already carries
//   the actionable signal from the new regular pivot.

export type PPHLPivotType = "regular_high" | "regular_low" | "missed_high" | "missed_low";

export interface PPHLPivot {
  index: number;
  price: number;
  type: PPHLPivotType;
}

export interface PivotPointsHLResult {
  pivots: PPHLPivot[];
  zigzag: { index: number; price: number }[];
  ghostLevelStart: number | null;   // start index of last "ghost" level
  ghostLevelPrice: number | null;   // price of last "ghost" level
  signal: ("BUY" | "SELL" | null)[];
}

export function pivotPointsHL(
  klines: KlineData[],
  length = 50,
): PivotPointsHLResult {
  const h = highs(klines);
  const l = lows(klines);
  const len = klines.length;

  const pivots: PPHLPivot[] = [];
  const zigzag: { index: number; price: number }[] = [];
  const signal: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);

  let osDir: 0 | 1 = 0;  // 1 = up (last was pivot high), 0 = down (last was pivot low)
  let maxRun = -Infinity, maxRunIdx = -1;
  let minRun = Infinity, minRunIdx = -1;
  let followMax = -Infinity, followMaxIdx = -1;
  let followMin = Infinity, followMinIdx = -1;
  let lastZigZagIdx = -1, lastZigZagPrice = 0;

  for (let i = 0; i < len; i++) {
    // Reference value at bar (i - length), like time[length]
    const refIdx = i - length;
    if (refIdx >= 0) {
      if (h[refIdx] > maxRun) {
        maxRun = h[refIdx];
        maxRunIdx = refIdx;
        followMin = l[refIdx];
        followMinIdx = refIdx;
      }
      if (l[refIdx] < minRun) {
        minRun = l[refIdx];
        minRunIdx = refIdx;
        followMax = h[refIdx];
        followMaxIdx = refIdx;
      }
      if (l[refIdx] < followMin) {
        followMin = l[refIdx];
        followMinIdx = refIdx;
      }
      if (h[refIdx] > followMax) {
        followMax = h[refIdx];
        followMaxIdx = refIdx;
      }
    }

    // Pivot detection at bar (i - length)
    if (refIdx >= length && refIdx + length < len) {
      let isHigh = true, isLow = true;
      for (let j = 1; j <= length; j++) {
        if (h[refIdx] <= h[refIdx - j] || h[refIdx] <= h[refIdx + j]) isHigh = false;
        if (l[refIdx] >= l[refIdx - j] || l[refIdx] >= l[refIdx + j]) isLow = false;
      }

      if (isHigh) {
        if (osDir === 1) {
          // Missed pivot low between two highs — chart marker only,
          // no signal (regular_high SELL fires at this same bar i).
          if (minRunIdx >= 0) {
            pivots.push({ index: minRunIdx, price: minRun, type: "missed_low" });
            zigzag.push({ index: minRunIdx, price: minRun });
            lastZigZagIdx = minRunIdx;
            lastZigZagPrice = minRun;
          }
        } else if (h[refIdx] < maxRun && maxRunIdx >= 0) {
          // High didn't break previous max — mark missed (chart only).
          pivots.push({ index: maxRunIdx, price: maxRun, type: "missed_high" });
          zigzag.push({ index: maxRunIdx, price: maxRun });
          if (followMinIdx >= 0) {
            pivots.push({ index: followMinIdx, price: followMin, type: "missed_low" });
            zigzag.push({ index: followMinIdx, price: followMin });
            lastZigZagIdx = followMinIdx;
            lastZigZagPrice = followMin;
          }
        }
        pivots.push({ index: refIdx, price: h[refIdx], type: "regular_high" });
        zigzag.push({ index: refIdx, price: h[refIdx] });
        signal[i] = "SELL";  // Detection-bar signal — no look-ahead.
        lastZigZagIdx = refIdx;
        lastZigZagPrice = h[refIdx];
        maxRun = h[refIdx];
        minRun = h[refIdx];
        osDir = 1;
      } else if (isLow) {
        if (osDir === 0) {
          // Missed pivot high between two lows — chart marker only.
          if (maxRunIdx >= 0) {
            pivots.push({ index: maxRunIdx, price: maxRun, type: "missed_high" });
            zigzag.push({ index: maxRunIdx, price: maxRun });
          }
        } else if (l[refIdx] > minRun && minRunIdx >= 0) {
          pivots.push({ index: followMaxIdx, price: followMax, type: "missed_high" });
          zigzag.push({ index: followMaxIdx, price: followMax });
          pivots.push({ index: minRunIdx, price: minRun, type: "missed_low" });
          zigzag.push({ index: minRunIdx, price: minRun });
        }
        pivots.push({ index: refIdx, price: l[refIdx], type: "regular_low" });
        zigzag.push({ index: refIdx, price: l[refIdx] });
        signal[i] = "BUY";  // Detection-bar signal — no look-ahead.
        lastZigZagIdx = refIdx;
        lastZigZagPrice = l[refIdx];
        maxRun = l[refIdx];
        minRun = l[refIdx];
        osDir = 0;
      }
    }
  }

  return {
    pivots,
    zigzag,
    ghostLevelStart: lastZigZagIdx >= 0 ? lastZigZagIdx : null,
    ghostLevelPrice: lastZigZagIdx >= 0 ? lastZigZagPrice : null,
    signal,
  };
}

// ─── TMA Overlay (JustUncleL / FXBuoy) ─────────────────────────
// 4 Smoothed MAs (21, 50, 100, 200) + Trend Fill from EMA(2) vs
// SMMA(200) + 3-Line Strike + Big-Body Engulfing detection.

export interface TMAOverlayResult {
  smma21: (number | null)[];
  smma50: (number | null)[];
  smma100: (number | null)[];
  smma200: (number | null)[];
  ema2: (number | null)[];
  trend: ("bullish" | "bearish" | null)[];
  threeLineStrikeBull: number[];
  threeLineStrikeBear: number[];
  bullishEngulfing: number[];
  bearishEngulfing: number[];
  signal: ("BUY" | "SELL" | null)[];
}

function smma(data: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  const seedSma = sma(data, period);
  let prev: number | null = null;
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    if (prev === null) {
      prev = seedSma[i] ?? data[i];
    } else {
      prev = (prev * (period - 1) + data[i]) / period;
    }
    result.push(prev);
  }
  return result;
}

export function tmaOverlay(klines: KlineData[]): TMAOverlayResult {
  const c = closes(klines);
  const o = klines.map(k => +k.open);
  const len = klines.length;

  const smma21 = smma(c, 21);
  const smma50 = smma(c, 50);
  const smma100 = smma(c, 100);
  const smma200 = smma(c, 200);
  const ema2 = ema(c, 2);

  const trend: ("bullish" | "bearish" | null)[] = new Array(len).fill(null);
  const threeLineStrikeBull: number[] = [];
  const threeLineStrikeBear: number[] = [];
  const bullishEngulfing: number[] = [];
  const bearishEngulfing: number[] = [];
  const signal: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);

  for (let i = 0; i < len; i++) {
    const e = ema2[i], s200 = smma200[i];
    if (e !== null && s200 !== null) {
      trend[i] = e > s200 ? "bullish" : e < s200 ? "bearish" : null;
    }

    if (i >= 3) {
      // 3-Line Strike Bull: 3 bearish then 1 bullish that closes above prev-1 open
      const bearStrike = c[i - 3] < o[i - 3] && c[i - 2] < o[i - 2] && c[i - 1] < o[i - 1] && c[i] > o[i - 1];
      const bullStrike = c[i - 3] > o[i - 3] && c[i - 2] > o[i - 2] && c[i - 1] > o[i - 1] && c[i] < o[i - 1];
      if (bearStrike) {
        threeLineStrikeBull.push(i);
        if (trend[i] === "bullish") signal[i] = "BUY";
      }
      if (bullStrike) {
        threeLineStrikeBear.push(i);
        if (trend[i] === "bearish") signal[i] = "SELL";
      }
    }

    if (i >= 1) {
      // Big-body Engulfing
      const opnP = o[i - 1], clsP = c[i - 1];
      const bullEng = o[i] <= clsP && o[i] < opnP && c[i] > opnP;
      const bearEng = o[i] >= clsP && o[i] > opnP && c[i] < opnP;
      if (bullEng) {
        bullishEngulfing.push(i);
        if (signal[i] === null && trend[i] === "bullish") signal[i] = "BUY";
      }
      if (bearEng) {
        bearishEngulfing.push(i);
        if (signal[i] === null && trend[i] === "bearish") signal[i] = "SELL";
      }
    }
  }

  return {
    smma21, smma50, smma100, smma200, ema2, trend,
    threeLineStrikeBull, threeLineStrikeBear,
    bullishEngulfing, bearishEngulfing, signal,
  };
}

// ─── Auto Chart Patterns (Trendoscope) ─────────────────────────
// Detects geometric chart patterns from the last 5 zigzag pivots:
// channels, wedges, triangles. Bias derived from slopes; signal on
// breakout above upper trendline (BUY) or below lower (SELL).

export type ChartPatternType =
  | "Ascending Channel" | "Descending Channel" | "Ranging Channel"
  | "Rising Wedge (Contracting)" | "Rising Wedge (Expanding)"
  | "Falling Wedge (Contracting)" | "Falling Wedge (Expanding)"
  | "Ascending Triangle (Contracting)" | "Ascending Triangle (Expanding)"
  | "Descending Triangle (Contracting)" | "Descending Triangle (Expanding)"
  | "Converging Triangle" | "Diverging Triangle";

export interface ChartPattern {
  startIndex: number;
  endIndex: number;
  type: ChartPatternType;
  pivots: { index: number; price: number; direction: 1 | -1 }[];
  upperLine: { x1: number; y1: number; x2: number; y2: number };
  lowerLine: { x1: number; y1: number; x2: number; y2: number };
  bias: "bullish" | "bearish" | "neutral";
  broken: boolean;
  brokenAtIndex: number | null;
  brokenDirection: "up" | "down" | null;
}

export interface AutoChartPatternsResult {
  patterns: ChartPattern[];
  signal: ("BUY" | "SELL" | null)[];
}

function lineFrom2Points(x1: number, y1: number, x2: number, y2: number): { slope: number; intercept: number } {
  if (x2 === x1) return { slope: 0, intercept: y1 };
  const slope = (y2 - y1) / (x2 - x1);
  const intercept = y1 - slope * x1;
  return { slope, intercept };
}

function classifyPattern(
  pivots: { index: number; price: number; direction: 1 | -1 }[],
  flatRatio: number,
): ChartPatternType | null {
  if (pivots.length < 5) return null;
  const highs = pivots.filter(p => p.direction === 1);
  const lows = pivots.filter(p => p.direction === -1);
  if (highs.length < 2 || lows.length < 2) return null;

  const upper = lineFrom2Points(highs[0].index, highs[0].price, highs[highs.length - 1].index, highs[highs.length - 1].price);
  const lower = lineFrom2Points(lows[0].index, lows[0].price, lows[lows.length - 1].index, lows[lows.length - 1].price);

  const avgPrice = pivots.reduce((s, p) => s + p.price, 0) / pivots.length;
  const span = pivots[pivots.length - 1].index - pivots[0].index;
  const upperRise = upper.slope * span;
  const lowerRise = lower.slope * span;
  const flatBound = avgPrice * flatRatio;

  const upperFlat = Math.abs(upperRise) < flatBound;
  const lowerFlat = Math.abs(lowerRise) < flatBound;
  const upperUp = upperRise > 0 && !upperFlat;
  const upperDown = upperRise < 0 && !upperFlat;
  const lowerUp = lowerRise > 0 && !lowerFlat;
  const lowerDown = lowerRise < 0 && !lowerFlat;

  // Distance between lines at start vs end
  const startDist = Math.abs(highs[0].price - lows[0].price);
  const endUpperY = upper.slope * pivots[pivots.length - 1].index + upper.intercept;
  const endLowerY = lower.slope * pivots[pivots.length - 1].index + lower.intercept;
  const endDist = Math.abs(endUpperY - endLowerY);
  const isContracting = endDist < startDist * 0.85;
  const isExpanding = endDist > startDist * 1.15;
  const isParallel = !isContracting && !isExpanding;

  // Channels (parallel)
  if (isParallel) {
    if (upperUp && lowerUp) return "Ascending Channel";
    if (upperDown && lowerDown) return "Descending Channel";
    if (upperFlat && lowerFlat) return "Ranging Channel";
  }

  // Wedges (both lines same direction)
  if (upperUp && lowerUp) {
    return isContracting ? "Rising Wedge (Contracting)" : "Rising Wedge (Expanding)";
  }
  if (upperDown && lowerDown) {
    return isContracting ? "Falling Wedge (Contracting)" : "Falling Wedge (Expanding)";
  }

  // Triangles (lines diverge in direction)
  if (upperFlat && lowerUp) {
    return isContracting ? "Ascending Triangle (Contracting)" : "Ascending Triangle (Expanding)";
  }
  if (upperUp && lowerFlat) {
    return isContracting ? "Ascending Triangle (Contracting)" : "Ascending Triangle (Expanding)";
  }
  if (upperDown && lowerFlat) {
    return isContracting ? "Descending Triangle (Contracting)" : "Descending Triangle (Expanding)";
  }
  if (upperFlat && lowerDown) {
    return isContracting ? "Descending Triangle (Contracting)" : "Descending Triangle (Expanding)";
  }
  if (upperDown && lowerUp) return "Converging Triangle";
  if (upperUp && lowerDown) return "Diverging Triangle";

  return null;
}

function patternBias(type: ChartPatternType): "bullish" | "bearish" | "neutral" {
  if (type.startsWith("Ascending") || type.startsWith("Falling Wedge")) return "bullish";
  if (type.startsWith("Descending") || type.startsWith("Rising Wedge")) return "bearish";
  return "neutral";
}

export function autoChartPatterns(
  klines: KlineData[],
  zigzagLength = 8,
  flatThreshold = 0.20,
  numberOfPivots: 5 | 6 = 5,
  avoidOverlap = true,
): AutoChartPatternsResult {
  const h = highs(klines);
  const l = lows(klines);
  const c = closes(klines);
  const len = klines.length;

  // Bars-based pivot detection (left/right = zigzagLength)
  const phArr: (number | null)[] = new Array(len).fill(null);
  const plArr: (number | null)[] = new Array(len).fill(null);
  for (let i = zigzagLength; i < len - zigzagLength; i++) {
    let isHigh = true, isLow = true;
    for (let j = 1; j <= zigzagLength; j++) {
      if (h[i] <= h[i - j] || h[i] <= h[i + j]) isHigh = false;
      if (l[i] >= l[i - j] || l[i] >= l[i + j]) isLow = false;
    }
    if (isHigh) phArr[i] = h[i];
    if (isLow) plArr[i] = l[i];
  }

  // Compose zigzag pivots in chronological order
  const allPivots: { index: number; price: number; direction: 1 | -1 }[] = [];
  for (let i = 0; i < len; i++) {
    if (phArr[i] !== null) allPivots.push({ index: i, price: phArr[i]!, direction: 1 });
    if (plArr[i] !== null) allPivots.push({ index: i, price: plArr[i]!, direction: -1 });
  }
  // Remove same-direction consecutive (keep extreme)
  const pivots: typeof allPivots = [];
  for (const p of allPivots) {
    const last = pivots[pivots.length - 1];
    if (last && last.direction === p.direction) {
      if ((p.direction === 1 && p.price > last.price) || (p.direction === -1 && p.price < last.price)) {
        pivots[pivots.length - 1] = p;
      }
    } else {
      pivots.push(p);
    }
  }

  const patterns: ChartPattern[] = [];
  const signal: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);

  for (let pi = numberOfPivots - 1; pi < pivots.length; pi++) {
    const window = pivots.slice(pi - numberOfPivots + 1, pi + 1);
    const type = classifyPattern(window, flatThreshold);
    if (!type) continue;

    const startIdx = window[0].index;
    const confirmIdx = window[window.length - 1].index;

    if (avoidOverlap) {
      const lastPattern = patterns[patterns.length - 1];
      if (lastPattern && startIdx < lastPattern.endIndex) continue;
    }

    const highsW = window.filter(p => p.direction === 1);
    const lowsW = window.filter(p => p.direction === -1);
    if (highsW.length < 2 || lowsW.length < 2) continue;

    const upperLine = {
      x1: highsW[0].index, y1: highsW[0].price,
      x2: highsW[highsW.length - 1].index, y2: highsW[highsW.length - 1].price,
    };
    const lowerLine = {
      x1: lowsW[0].index, y1: lowsW[0].price,
      x2: lowsW[lowsW.length - 1].index, y2: lowsW[lowsW.length - 1].price,
    };

    patterns.push({
      startIndex: startIdx,
      endIndex: confirmIdx,
      type,
      pivots: window,
      upperLine,
      lowerLine,
      bias: patternBias(type),
      broken: false,
      brokenAtIndex: null,
      brokenDirection: null,
    });
  }

  // Detect breakouts and emit signals
  for (const p of patterns) {
    const upper = lineFrom2Points(p.upperLine.x1, p.upperLine.y1, p.upperLine.x2, p.upperLine.y2);
    const lower = lineFrom2Points(p.lowerLine.x1, p.lowerLine.y1, p.lowerLine.x2, p.lowerLine.y2);
    const lookForward = Math.min(50, len - p.endIndex - 1);
    for (let j = p.endIndex + 1; j <= p.endIndex + lookForward; j++) {
      const upY = upper.slope * j + upper.intercept;
      const loY = lower.slope * j + lower.intercept;
      if (c[j] > upY) {
        p.broken = true;
        p.brokenAtIndex = j;
        p.brokenDirection = "up";
        if (signal[j] === null) signal[j] = "BUY";
        break;
      }
      if (c[j] < loY) {
        p.broken = true;
        p.brokenAtIndex = j;
        p.brokenDirection = "down";
        if (signal[j] === null) signal[j] = "SELL";
        break;
      }
    }
  }

  return { patterns, signal };
}

// ─── DIY Custom Strategy Builder (ZP) ──────────────────────────
// Composes a leading indicator + optional confirmation filters. A
// long entry fires when the leading indicator emits BUY and every
// enabled filter agrees within signalExpiry bars. Same for short.

export type DIYLeadingKind = "supertrend" | "cdc" | "trendlines" | "rsi" | "ut_bot";

export interface DIYBuilderOptions {
  leading: DIYLeadingKind;
  signalExpiry: number;
  useEma200Filter: boolean;
  useEmaCrossFilter: boolean;     // EMA50 cross EMA200
  useCdcZoneFilter: boolean;      // CDC zone must match
  useTrendlinesFilter: boolean;   // Trendlines breakout in same direction
  useRsi50Filter: boolean;        // RSI > 50 for long, < 50 for short
}

export interface DIYBuilderResult {
  leadingSignal: ("BUY" | "SELL" | null)[];
  filtersAgree: (boolean | null)[];
  signal: ("BUY" | "SELL" | null)[];
}

export function diyStrategyBuilder(
  klines: KlineData[],
  ind: {
    rsi: (number | null)[];
    cdcActionZone: CDCActionZoneResult;
    supertrend: SupertrendResult;
    trendlines: TrendlinesResult;
    utBot: UTBotResult;
  },
  options: DIYBuilderOptions,
): DIYBuilderResult {
  const c = closes(klines);
  const len = klines.length;

  const ema50 = ema(c, 50);
  const ema200 = ema(c, 200);

  let leading: ("BUY" | "SELL" | null)[];
  switch (options.leading) {
    case "cdc": leading = ind.cdcActionZone.signal; break;
    case "trendlines": leading = ind.trendlines.signal; break;
    case "rsi": leading = ind.rsi.map(v => v === null ? null : v < 30 ? "BUY" : v > 70 ? "SELL" : null); break;
    case "ut_bot": leading = ind.utBot.signal; break;
    case "supertrend":
    default: leading = ind.supertrend.signal;
  }

  const filtersAgree: (boolean | null)[] = new Array(len).fill(null);
  const signal: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);

  for (let i = 0; i < len; i++) {
    const sig = leading[i];
    if (sig === null) continue;

    let ok = true;
    const isBuy = sig === "BUY";

    if (options.useEma200Filter) {
      const e = ema200[i];
      if (e === null) ok = false;
      else if (isBuy && c[i] < e) ok = false;
      else if (!isBuy && c[i] > e) ok = false;
    }

    if (ok && options.useEmaCrossFilter) {
      const e50 = ema50[i], e200 = ema200[i];
      if (e50 === null || e200 === null) ok = false;
      else if (isBuy && e50 < e200) ok = false;
      else if (!isBuy && e50 > e200) ok = false;
    }

    if (ok && options.useCdcZoneFilter) {
      const z = ind.cdcActionZone.zone[i];
      if (isBuy && z !== "green") ok = false;
      else if (!isBuy && z !== "red") ok = false;
    }

    if (ok && options.useTrendlinesFilter) {
      // Look back signalExpiry bars for a matching trendlines breakout
      let foundMatch = false;
      const start = Math.max(0, i - options.signalExpiry);
      for (let j = start; j <= i; j++) {
        if (ind.trendlines.signal[j] === sig) {
          foundMatch = true;
          break;
        }
      }
      if (!foundMatch) ok = false;
    }

    if (ok && options.useRsi50Filter) {
      const r = ind.rsi[i];
      if (r === null) ok = false;
      else if (isBuy && r <= 50) ok = false;
      else if (!isBuy && r >= 50) ok = false;
    }

    filtersAgree[i] = ok;
    if (ok) signal[i] = sig;
  }

  return { leadingSignal: leading, filtersAgree, signal };
}

// ─── Compute all indicators for klines ─────────────────────────
// ─── Price Action SMC Scalper (BigBeluga) — reversal ───────────
// Short-term reversal play on the BigBeluga structure engine. Enters
// long on a bullish liquidity sweep + reclaim, a bullish CHoCH, or a
// reaction off an active bullish order block. Exits on ATR take-profit /
// stop-loss, a bearish sweep/CHoCH, or order-block invalidation.
// Reuses priceActionSMC() for structure/OB detection — only the signal
// logic is new, so the original strategy is left untouched.
export interface PASMCScalperResult {
  trend: (SMCBias | null)[];
  structures: PASMCStructure[];
  orderBlocks: PASMCOrderBlock[];
  swingPoints: SMCSwingPoint[];
  tp: (number | null)[];   // active take-profit level while in a position
  sl: (number | null)[];   // active stop-loss level while in a position
  signal: ("BUY" | "SELL" | null)[];
}

export function priceActionSMCScalper(
  klines: KlineData[],
  mslen = 3,
  obLength = 3,
  buildSweep = true,
  useOB = true,
  atrTpMult = 3.0,
  atrSlMult = 1.5,
  atrLen = 14,
): PASMCScalperResult {
  const base = priceActionSMC(klines, mslen, "Length", obLength, buildSweep);
  const c = closes(klines);
  const h = highs(klines);
  const l = lows(klines);
  const len = klines.length;
  const atrArr = atr(klines, atrLen);

  // Map reversal structure events to bars (BOS = continuation → skipped)
  const bullEntry = new Array<boolean>(len).fill(false);  // bullish sweep / CHoCH
  const bearExit = new Array<boolean>(len).fill(false);   // bearish sweep / CHoCH
  for (const s of base.structures) {
    if (s.type === "BOS") continue;
    if (s.bias === "bullish") bullEntry[s.index] = true;
    else bearExit[s.index] = true;
  }

  const signal: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);
  const tp = new Array<number | null>(len).fill(null);
  const sl = new Array<number | null>(len).fill(null);

  let inPos = false;
  let tpLevel = 0;
  let slLevel = 0;
  let entryOB: PASMCOrderBlock | null = null;

  for (let i = 0; i < len; i++) {
    const a = atrArr[i];
    if (!inPos) {
      // Bullish OB reaction: tap an active bullish OB and close above its mid
      let reactOB: PASMCOrderBlock | null = null;
      if (useOB) {
        for (const ob of base.orderBlocks) {
          if (ob.bias !== "bullish" || ob.startIndex >= i) continue;
          if (ob.mitigatedIndex !== null && i >= ob.mitigatedIndex) continue;
          if (l[i] <= ob.high && l[i] >= ob.low && c[i] > ob.mid) { reactOB = ob; break; }
        }
      }
      if (a !== null && (bullEntry[i] || reactOB)) {
        inPos = true;
        tpLevel = c[i] + atrTpMult * a;
        slLevel = c[i] - atrSlMult * a;
        entryOB = reactOB;
        signal[i] = "BUY";
      }
    } else {
      const slHit = l[i] <= slLevel;
      const tpHit = h[i] >= tpLevel;
      const obInvalid = entryOB !== null && c[i] < entryOB.low;
      if (slHit || tpHit || bearExit[i] || obInvalid) {
        signal[i] = "SELL";
        inPos = false;
        entryOB = null;
      }
    }
    if (inPos) { tp[i] = tpLevel; sl[i] = slLevel; }
  }

  return {
    trend: base.trend,
    structures: base.structures,
    orderBlocks: base.orderBlocks,
    swingPoints: base.swingPoints,
    tp,
    sl,
    signal,
  };
}

// ─── SMC Trend Pullback (LuxAlgo) — trend-following ────────────
// Uses the swing structure as the dominant-trend filter, then enters
// long only on an internal bullish break inside the discount zone with
// order-block / fair-value-gap confluence. Exits on ATR take-profit /
// stop-loss, an internal bearish CHoCH, a swing-trend flip, or price
// reaching the premium zone. Reuses smartMoneyConcepts() for detection —
// only the signal logic is new, so the original strategy is untouched.
export interface SMCTrendPullbackResult {
  swingTrend: (SMCBias | null)[];
  internalTrend: (SMCBias | null)[];
  swingStructures: SMCStructureBreak[];
  internalStructures: SMCStructureBreak[];
  swingOrderBlocks: SMCOrderBlock[];
  internalOrderBlocks: SMCOrderBlock[];
  fairValueGaps: SMCFairValueGap[];
  swingPoints: SMCSwingPoint[];
  premiumDiscount: ("premium" | "discount" | "equilibrium" | null)[];
  tp: (number | null)[];
  sl: (number | null)[];
  signal: ("BUY" | "SELL" | null)[];
}

export function smcTrendPullback(
  klines: KlineData[],
  swingSize = 20,
  internalSize = 5,
  useOB = true,
  useFvg = true,
  atrTpMult = 4.0,
  atrSlMult = 2.0,
  atrLen = 14,
): SMCTrendPullbackResult {
  const base = smartMoneyConcepts(klines, swingSize, internalSize);
  const c = closes(klines);
  const h = highs(klines);
  const l = lows(klines);
  const len = klines.length;
  const atrArr = atr(klines, atrLen);

  // internal break events
  const bullBreak = new Array<boolean>(len).fill(false);  // bullish CHoCH or BOS
  const bearCHoCH = new Array<boolean>(len).fill(false);
  for (const s of base.internalStructures) {
    if (s.bias === "bullish") bullBreak[s.index] = true;
    else if (s.type === "CHoCH") bearCHoCH[s.index] = true;
  }

  const confWindow = Math.max(3, internalSize);
  // price overlapped an active bullish OB within the confluence window
  const tappedBullOB = (i: number): boolean => {
    for (const ob of base.internalOrderBlocks) {
      if (ob.bias !== "bullish" || ob.startIndex >= i) continue;
      if (ob.mitigatedIndex !== null && i >= ob.mitigatedIndex) continue;
      for (let k = Math.max(0, i - confWindow); k <= i; k++) {
        if (l[k] <= ob.high && h[k] >= ob.low) return true;
      }
    }
    return false;
  };
  // price overlapped an unfilled bullish FVG within the window
  const tappedBullFVG = (i: number): boolean => {
    for (const f of base.fairValueGaps) {
      if (f.bias !== "bullish" || f.index >= i) continue;
      if (f.filledIndex !== null && i >= f.filledIndex) continue;
      for (let k = Math.max(0, i - confWindow); k <= i; k++) {
        if (l[k] <= f.top && h[k] >= f.bottom) return true;
      }
    }
    return false;
  };

  const signal: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);
  const tp = new Array<number | null>(len).fill(null);
  const sl = new Array<number | null>(len).fill(null);

  let inPos = false;
  let tpLevel = 0;
  let slLevel = 0;

  for (let i = 0; i < len; i++) {
    const a = atrArr[i];
    if (!inPos) {
      const trendOK = base.swingTrend[i] === "bullish";
      const zone = base.premiumDiscount[i];
      const zoneOK = zone === "discount" || zone === "equilibrium";
      const confluence = (!useOB && !useFvg)
        ? true
        : ((useOB && tappedBullOB(i)) || (useFvg && tappedBullFVG(i)));
      if (a !== null && bullBreak[i] && trendOK && zoneOK && confluence) {
        inPos = true;
        tpLevel = c[i] + atrTpMult * a;
        slLevel = c[i] - atrSlMult * a;
        signal[i] = "BUY";
      }
    } else {
      const slHit = l[i] <= slLevel;
      const tpHit = h[i] >= tpLevel;
      const trendFlip = base.swingTrend[i] === "bearish";
      const premium = base.premiumDiscount[i] === "premium";
      if (slHit || tpHit || bearCHoCH[i] || trendFlip || premium) {
        signal[i] = "SELL";
        inPos = false;
      }
    }
    if (inPos) { tp[i] = tpLevel; sl[i] = slLevel; }
  }

  return {
    swingTrend: base.swingTrend,
    internalTrend: base.internalTrend,
    swingStructures: base.swingStructures,
    internalStructures: base.internalStructures,
    swingOrderBlocks: base.swingOrderBlocks,
    internalOrderBlocks: base.internalOrderBlocks,
    fairValueGaps: base.fairValueGaps,
    swingPoints: base.swingPoints,
    premiumDiscount: base.premiumDiscount,
    tp,
    sl,
    signal,
  };
}

// ─── RSI Divergence Indicator ──────────────────────────────────
// RSI oscillator + pivot-based divergence detection (regular & hidden,
// bullish & bearish). Long-only like the source strategy: BUY on bullish
// divergence, SELL when RSI crosses above the take-profit level or a
// bearish divergence forms. Pivots in the oscillator are confirmed `lbR`
// bars after they actually occur (no lookahead).
export interface RSIDivergenceResult {
  osc: (number | null)[];          // RSI oscillator
  regularBull: boolean[];          // regular bullish divergence (at confirm bar)
  hiddenBull: boolean[];           // hidden bullish divergence
  regularBear: boolean[];          // regular bearish divergence
  hiddenBear: boolean[];           // hidden bearish divergence
  pivotLow: boolean[];             // bar where an osc pivot low is confirmed
  pivotHigh: boolean[];            // bar where an osc pivot high is confirmed
  signal: ("BUY" | "SELL" | null)[];
}

export function rsiDivergence(
  klines: KlineData[],
  rsiPeriod = 9,
  lbL = 1,
  lbR = 3,
  takeProfitRSILevel = 80,
  rangeLower = 5,
  rangeUpper = 60,
  plotHiddenBull = true,
  plotHiddenBear = false,
): RSIDivergenceResult {
  const c = closes(klines);
  const h = highs(klines);
  const l = lows(klines);
  const len = klines.length;
  const osc = rsi(c, rsiPeriod);

  const regularBull = new Array<boolean>(len).fill(false);
  const hiddenBull = new Array<boolean>(len).fill(false);
  const regularBear = new Array<boolean>(len).fill(false);
  const hiddenBear = new Array<boolean>(len).fill(false);
  const pivotLow = new Array<boolean>(len).fill(false);
  const pivotHigh = new Array<boolean>(len).fill(false);
  const signal: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);

  // previous confirmed pivots: oscillator value + price extreme + confirm bar
  let prevLowOsc: number | null = null;
  let prevLowPrice = 0;
  let prevLowIdx = -1;
  let prevHighOsc: number | null = null;
  let prevHighPrice = 0;
  let prevHighIdx = -1;

  // strict pivot in the osc series at bar p (lbL left, lbR right)
  const isPivotLow = (p: number): boolean => {
    const v = osc[p];
    if (v === null) return false;
    for (let j = 1; j <= lbL; j++) { const x = osc[p - j]; if (x === null || v >= x) return false; }
    for (let j = 1; j <= lbR; j++) { const x = osc[p + j]; if (x === null || v >= x) return false; }
    return true;
  };
  const isPivotHigh = (p: number): boolean => {
    const v = osc[p];
    if (v === null) return false;
    for (let j = 1; j <= lbL; j++) { const x = osc[p - j]; if (x === null || v <= x) return false; }
    for (let j = 1; j <= lbR; j++) { const x = osc[p + j]; if (x === null || v <= x) return false; }
    return true;
  };

  for (let i = 0; i < len; i++) {
    let bullCond = false, hiddenBullCond = false, bearCond = false, hiddenBearCond = false;

    const p = i - lbR; // candidate pivot bar, confirmed at bar i
    if (p - lbL >= 0) {
      // ── pivot low → bullish divergence (price vs osc lows) ──
      if (isPivotLow(p)) {
        pivotLow[i] = true;
        const curOsc = osc[p] as number;
        const curLow = l[p];
        if (prevLowOsc !== null) {
          const bars = i - prevLowIdx;
          const inRange = bars >= rangeLower && bars <= rangeUpper;
          const oscHL = curOsc > prevLowOsc && inRange; // higher low in osc
          const priceLL = curLow < prevLowPrice;        // lower low in price
          const oscLL = curOsc < prevLowOsc && inRange;
          const priceHL = curLow > prevLowPrice;
          bullCond = priceLL && oscHL;
          hiddenBullCond = plotHiddenBull && priceHL && oscLL;
        }
        prevLowOsc = curOsc;
        prevLowPrice = curLow;
        prevLowIdx = i;
      }
      // ── pivot high → bearish divergence (price vs osc highs) ──
      if (isPivotHigh(p)) {
        pivotHigh[i] = true;
        const curOsc = osc[p] as number;
        const curHigh = h[p];
        if (prevHighOsc !== null) {
          const bars = i - prevHighIdx;
          const inRange = bars >= rangeLower && bars <= rangeUpper;
          const oscLH = curOsc < prevHighOsc && inRange; // lower high in osc
          const priceHH = curHigh > prevHighPrice;       // higher high in price
          const oscHH = curOsc > prevHighOsc && inRange;
          const priceLH = curHigh < prevHighPrice;
          bearCond = priceHH && oscLH;
          hiddenBearCond = plotHiddenBear && priceLH && oscHH;
        }
        prevHighOsc = curOsc;
        prevHighPrice = curHigh;
        prevHighIdx = i;
      }
    }

    regularBull[i] = bullCond;
    hiddenBull[i] = hiddenBullCond;
    regularBear[i] = bearCond;
    hiddenBear[i] = hiddenBearCond;

    // take-profit: RSI crosses above the TP level
    const crossTP = i > 0 && osc[i - 1] !== null && osc[i] !== null &&
      (osc[i - 1] as number) <= takeProfitRSILevel && (osc[i] as number) > takeProfitRSILevel;

    if (bullCond || hiddenBullCond) signal[i] = "BUY";
    else if (crossTP || bearCond) signal[i] = "SELL";
  }

  return { osc, regularBull, hiddenBull, regularBear, hiddenBear, pivotLow, pivotHigh, signal };
}

// ─── Trend Strength Signals [AlgoAlpha] ────────────────────────
// An SMA basis ± standard-deviation envelope. Trend flips to +1 when price
// closes above both basis and upper band, to -1 when it closes below both
// basis and lower band, otherwise it persists. BUY on a bullish trend shift
// (crossover of trend over 0), SELL on a bearish shift. The wider `mult`
// bands (upper1/lower1) mark take-profit crosses.
export interface TrendStrengthResult {
  basis: (number | null)[];     // SMA(period)
  upper: (number | null)[];     // basis + stdev
  lower: (number | null)[];     // basis - stdev
  upperTP: (number | null)[];   // basis + stdev * mult (Long TP band)
  lowerTP: (number | null)[];   // basis - stdev * mult (Short TP band)
  trend: (1 | -1 | 0)[];
  longTP: boolean[];            // close crosses under upperTP
  shortTP: boolean[];           // close crosses over lowerTP
  signal: ("BUY" | "SELL" | null)[];
}

export function trendStrengthSignals(
  klines: KlineData[],
  period = 20,
  mult = 2.5,
): TrendStrengthResult {
  const c = closes(klines);
  const len = klines.length;
  const basisArr = sma(c, period);
  const sd = stdev(c, period); // population stdev — matches ta.stdev(src, len, true)

  const basis = new Array<number | null>(len).fill(null);
  const upper = new Array<number | null>(len).fill(null);
  const lower = new Array<number | null>(len).fill(null);
  const upperTP = new Array<number | null>(len).fill(null);
  const lowerTP = new Array<number | null>(len).fill(null);
  const trend = new Array<1 | -1 | 0>(len).fill(0);
  const longTP = new Array<boolean>(len).fill(false);
  const shortTP = new Array<boolean>(len).fill(false);
  const signal: ("BUY" | "SELL" | null)[] = new Array(len).fill(null);

  let prevTrend: 1 | -1 | 0 = 0;
  let prevUpperTP: number | null = null;
  let prevLowerTP: number | null = null;
  let prevClose: number | null = null;

  for (let i = 0; i < len; i++) {
    const b = basisArr[i];
    const s = sd[i];
    if (b === null || s === null) {
      trend[i] = prevTrend;
      prevClose = c[i];
      continue;
    }
    const up = b + s;
    const lo = b - s;
    const upTP = b + s * mult;
    const loTP = b - s * mult;
    basis[i] = b; upper[i] = up; lower[i] = lo; upperTP[i] = upTP; lowerTP[i] = loTP;

    let t: 1 | -1 | 0 = prevTrend;
    if (c[i] > b && c[i] > up) t = 1;
    if (c[i] < b && c[i] < lo) t = -1;
    trend[i] = t;

    // trend crossover / crossunder zero → trading signals
    if (t > 0 && prevTrend <= 0) signal[i] = "BUY";
    else if (t < 0 && prevTrend >= 0) signal[i] = "SELL";

    // take-profit crosses (chart markers)
    if (prevClose !== null && prevUpperTP !== null && prevClose >= prevUpperTP && c[i] < upTP) longTP[i] = true;
    if (prevClose !== null && prevLowerTP !== null && prevClose <= prevLowerTP && c[i] > loTP) shortTP[i] = true;

    prevTrend = t;
    prevUpperTP = upTP;
    prevLowerTP = loTP;
    prevClose = c[i];
  }

  return { basis, upper, lower, upperTP, lowerTP, trend, longTP, shortTP, signal };
}

export interface AllIndicators {
  rsi: (number | null)[];
  atr: (number | null)[];
  obv: number[];
  vwap: number[];
  cdcActionZone: CDCActionZoneResult;
  smc: SMCResult;
  cmMacd: CMMAcDResult;
  supertrend: SupertrendResult;
  squeezeMomentum: SqueezeMomentumResult;
  msbOb: MSBResult;
  supportResistance: SupportResistanceResult;
  trendlines: TrendlinesResult;
  utBot: UTBotResult;
  chandelierExit: ChandelierExitResult;
  tonyEmaScalper: TonyEmaScalperResult;
  superTrendStrategy: SuperTrendStrategyResult;
  turtleChannels: TurtleChannelsResult;
  scalpingPullBack: ScalpingPullBackResult;
  trendlineBreakouts: TrendlineBreakoutsResult;
  smartMoneyBreakout: SmartMoneyBreakoutResult;
  srHighVolume: SRHighVolumeResult;
  cdcActionZoneV2: CDCActionZoneV2Result;
  zigzagPlusPlus: ZigZagPPResult;
  priceActionSMC: PriceActionSMCResult;
  priceActionSR: PriceActionSRResult;
  candlestickPatterns: CandlestickPatternsResult;
  pivotPointsHL: PivotPointsHLResult;
  tmaOverlay: TMAOverlayResult;
  autoChartPatterns: AutoChartPatternsResult;
  diyStrategyBuilder: DIYBuilderResult;
  rsiDivergence: RSIDivergenceResult;
  trendStrength: TrendStrengthResult;
  pasmcScalper: PASMCScalperResult;
  smcTrendPullback: SMCTrendPullbackResult;
}

export function computeAll(klines: KlineData[], overrides?: {
  rsiPeriod?: number;
  smcSwingSize?: number;
  smcInternalSize?: number;
  cmMacdFast?: number;
  cmMacdSlow?: number;
  cmMacdSignal?: number;
  supertrendPeriod?: number;
  supertrendMultiplier?: number;
  sqzMomBBLength?: number;
  sqzMomBBMult?: number;
  sqzMomKCLength?: number;
  sqzMomKCMult?: number;
  msbZigzagLen?: number;
  msbFibFactor?: number;
  srLeftBars?: number;
  srRightBars?: number;
  srVolumeThresh?: number;
  trendLength?: number;
  trendMult?: number;
  trendCalcMethod?: "Atr" | "Stdev";
  utBotKey?: number;
  utBotAtrPeriod?: number;
  ceLength?: number;
  ceMult?: number;
  ceUseClose?: number;       // 0 = false, 1 = true
  tonyEmaLength?: number;
  tonyChannelLength?: number;
  stsAtrPeriod?: number;
  stsMultiplier?: number;
  stsChangeATR?: number;     // 0 = false, 1 = true
  turtleEntryLength?: number;
  turtleExitLength?: number;
  spPacLength?: number;
  spFastEMA?: number;
  spMediumEMA?: number;
  spSlowEMA?: number;
  spLookback?: number;
  tbPeriod?: number;
  tbUseWicks?: number;       // 0 = body, 1 = wicks
  smcboNormLength?: number;
  smcboBoxLength?: number;
  smcboStrongCloses?: number; // 0/1
  smcboOverlap?: number;      // 0/1
  srhvLookback?: number;
  srhvVolLen?: number;
  srhvBoxWidth?: number;
  cdcV2Fast?: number;
  cdcV2Slow?: number;
  zzDepth?: number;
  zzDeviation?: number;
  zzBackstep?: number;
  pasmcLen?: number;
  pasmcObMode?: number;       // 0 = Length, 1 = Full
  pasmcObLength?: number;
  pasmcBuildSweep?: number;
  pasmcSwing?: number;        // swing-structure pivot length (dominant trend filter)
  pasmcUseSwing?: number;     // 0/1 — gate by swing trend + discount/premium zone
  pasmcUseOB?: number;        // 0/1 — require OB/FVG confluence on entry
  pasrVolMaLength?: number;
  pasrVolSpikeThresh?: number;
  pasrAtrLength?: number;
  pasrAtrMult?: number;
  pasrUseVolume?: number;
  cpTrendBars?: number;
  cpDojiSize?: number;
  pphlLength?: number;
  acpZigzagLength?: number;
  acpFlatThreshold?: number;
  acpNumberOfPivots?: number;
  acpAvoidOverlap?: number;
  diyLeading?: number;          // 0=supertrend, 1=cdc, 2=trendlines, 3=rsi, 4=ut_bot
  diySignalExpiry?: number;
  diyUseEma200?: number;
  diyUseEmaCross?: number;
  diyUseCdcZone?: number;
  diyUseTrendlines?: number;
  diyUseRsi50?: number;
  rsiDivPeriod?: number;
  rsiDivLbL?: number;
  rsiDivLbR?: number;
  rsiDivTakeProfit?: number;
  tssPeriod?: number;
  tssMult?: number;
  pascLen?: number;
  pascObLen?: number;
  pascSweep?: number;     // 0/1
  pascUseOB?: number;     // 0/1
  pascTpAtr?: number;
  pascSlAtr?: number;
  smcpSwing?: number;
  smcpInternal?: number;
  smcpUseOB?: number;     // 0/1
  smcpUseFvg?: number;    // 0/1
  smcpTpAtr?: number;
  smcpSlAtr?: number;
}): AllIndicators {
  const c = closes(klines);
  return {
    rsi: rsi(c, overrides?.rsiPeriod ?? 14),
    atr: atr(klines, 14),
    obv: obv(klines),
    vwap: vwap(klines),
    cdcActionZone: cdcActionZone(c, 12, 26, 1),
    smc: smartMoneyConcepts(klines, overrides?.smcSwingSize ?? 50, overrides?.smcInternalSize ?? 5),
    cmMacd: cmMacdUltMTF(c, overrides?.cmMacdFast ?? 12, overrides?.cmMacdSlow ?? 26, overrides?.cmMacdSignal ?? 9),
    supertrend: supertrend(klines, overrides?.supertrendPeriod ?? 10, overrides?.supertrendMultiplier ?? 3.0),
    squeezeMomentum: squeezeMomentum(klines, overrides?.sqzMomBBLength ?? 20, overrides?.sqzMomBBMult ?? 2.0, overrides?.sqzMomKCLength ?? 20, overrides?.sqzMomKCMult ?? 1.5),
    msbOb: msbOrderBlock(klines, overrides?.msbZigzagLen ?? 9, overrides?.msbFibFactor ?? 0.33),
    supportResistance: supportResistance(klines, overrides?.srLeftBars ?? 15, overrides?.srRightBars ?? 15, overrides?.srVolumeThresh ?? 20),
    trendlines: trendlinesWithBreaks(klines, overrides?.trendLength ?? 14, overrides?.trendMult ?? 1.0, overrides?.trendCalcMethod ?? "Atr"),
    utBot: utBot(klines, overrides?.utBotKey ?? 1, overrides?.utBotAtrPeriod ?? 10),
    chandelierExit: chandelierExit(klines, overrides?.ceLength ?? 22, overrides?.ceMult ?? 3.0, (overrides?.ceUseClose ?? 1) !== 0),
    tonyEmaScalper: tonyEmaScalper(klines, overrides?.tonyEmaLength ?? 20, overrides?.tonyChannelLength ?? 8),
    superTrendStrategy: superTrendStrategy(klines, overrides?.stsAtrPeriod ?? 10, overrides?.stsMultiplier ?? 3.0, (overrides?.stsChangeATR ?? 1) !== 0),
    turtleChannels: turtleChannels(klines, overrides?.turtleEntryLength ?? 20, overrides?.turtleExitLength ?? 10),
    scalpingPullBack: scalpingPullBack(klines, overrides?.spPacLength ?? 34, overrides?.spFastEMA ?? 89, overrides?.spMediumEMA ?? 200, overrides?.spSlowEMA ?? 600, overrides?.spLookback ?? 3),
    trendlineBreakouts: trendlineBreakouts(klines, overrides?.tbPeriod ?? 10, (overrides?.tbUseWicks ?? 1) !== 0),
    smartMoneyBreakout: smartMoneyBreakoutChannels(klines, overrides?.smcboNormLength ?? 100, overrides?.smcboBoxLength ?? 14, (overrides?.smcboStrongCloses ?? 1) !== 0, (overrides?.smcboOverlap ?? 0) !== 0),
    srHighVolume: srHighVolumeBoxes(klines, overrides?.srhvLookback ?? 20, overrides?.srhvVolLen ?? 2, overrides?.srhvBoxWidth ?? 1.0),
    cdcActionZoneV2: cdcActionZoneV2(klines, overrides?.cdcV2Fast ?? 12, overrides?.cdcV2Slow ?? 26),
    zigzagPlusPlus: zigzagPlusPlus(klines, overrides?.zzDepth ?? 12, overrides?.zzDeviation ?? 5, overrides?.zzBackstep ?? 2),
    priceActionSMC: priceActionSMC(klines, overrides?.pasmcLen ?? 5, (overrides?.pasmcObMode ?? 0) === 1 ? "Full" : "Length", overrides?.pasmcObLength ?? 5, (overrides?.pasmcBuildSweep ?? 1) !== 0, overrides?.pasmcSwing ?? 50, (overrides?.pasmcUseSwing ?? 1) !== 0, (overrides?.pasmcUseOB ?? 1) !== 0),
    priceActionSR: priceActionSR(klines, overrides?.pasrVolMaLength ?? 89, overrides?.pasrVolSpikeThresh ?? 4.669, overrides?.pasrAtrLength ?? 11, overrides?.pasrAtrMult ?? 2.718, (overrides?.pasrUseVolume ?? 1) !== 0),
    candlestickPatterns: candlestickPatterns(klines, overrides?.cpTrendBars ?? 5, overrides?.cpDojiSize ?? 0.05),
    pivotPointsHL: pivotPointsHL(klines, overrides?.pphlLength ?? 50),
    tmaOverlay: tmaOverlay(klines),
    autoChartPatterns: autoChartPatterns(klines, overrides?.acpZigzagLength ?? 8, (overrides?.acpFlatThreshold ?? 20) / 100, (overrides?.acpNumberOfPivots ?? 5) === 6 ? 6 : 5, (overrides?.acpAvoidOverlap ?? 1) !== 0),
    diyStrategyBuilder: (() => {
      const leadingMap: DIYLeadingKind[] = ["supertrend", "cdc", "trendlines", "rsi", "ut_bot"];
      const leadingIdx = overrides?.diyLeading ?? 0;
      const stRes = supertrend(klines, overrides?.supertrendPeriod ?? 10, overrides?.supertrendMultiplier ?? 3.0);
      const cdcRes = cdcActionZone(closes(klines), 12, 26, 1);
      const tlRes = trendlinesWithBreaks(klines, overrides?.trendLength ?? 14, overrides?.trendMult ?? 1.0, overrides?.trendCalcMethod ?? "Atr");
      const utRes = utBot(klines, overrides?.utBotKey ?? 1, overrides?.utBotAtrPeriod ?? 10);
      const rsiArr = rsi(closes(klines), overrides?.rsiPeriod ?? 14);
      return diyStrategyBuilder(klines, {
        rsi: rsiArr,
        cdcActionZone: cdcRes,
        supertrend: stRes,
        trendlines: tlRes,
        utBot: utRes,
      }, {
        leading: leadingMap[Math.min(Math.max(leadingIdx, 0), 4)],
        signalExpiry: overrides?.diySignalExpiry ?? 3,
        useEma200Filter: (overrides?.diyUseEma200 ?? 0) !== 0,
        useEmaCrossFilter: (overrides?.diyUseEmaCross ?? 0) !== 0,
        useCdcZoneFilter: (overrides?.diyUseCdcZone ?? 0) !== 0,
        useTrendlinesFilter: (overrides?.diyUseTrendlines ?? 0) !== 0,
        useRsi50Filter: (overrides?.diyUseRsi50 ?? 1) !== 0,
      });
    })(),
    rsiDivergence: rsiDivergence(klines, overrides?.rsiDivPeriod ?? 9, overrides?.rsiDivLbL ?? 1, overrides?.rsiDivLbR ?? 3, overrides?.rsiDivTakeProfit ?? 80),
    trendStrength: trendStrengthSignals(klines, overrides?.tssPeriod ?? 20, overrides?.tssMult ?? 2.5),
    pasmcScalper: priceActionSMCScalper(klines, overrides?.pascLen ?? 3, overrides?.pascObLen ?? 3, (overrides?.pascSweep ?? 1) !== 0, (overrides?.pascUseOB ?? 1) !== 0, overrides?.pascTpAtr ?? 3.0, overrides?.pascSlAtr ?? 1.5),
    smcTrendPullback: smcTrendPullback(klines, overrides?.smcpSwing ?? 20, overrides?.smcpInternal ?? 5, (overrides?.smcpUseOB ?? 1) !== 0, (overrides?.smcpUseFvg ?? 1) !== 0, overrides?.smcpTpAtr ?? 4.0, overrides?.smcpSlAtr ?? 2.0),
  };
}
