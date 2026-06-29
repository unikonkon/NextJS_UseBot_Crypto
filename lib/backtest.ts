import type { KlineData } from "@/lib/types/kline";
import { computeAll, type AllIndicators } from "@/lib/indicators";

// ─── Types ─────────────────────────────────────────────────────
export type SignalAction = "BUY" | "SELL" | "HOLD";

export interface Trade {
  entryIdx: number;
  entryTime: number;
  entryPrice: number;
  exitIdx: number;
  exitTime: number;
  exitPrice: number;
  pnl: number;       // absolute (price diff)
  pnlPct: number;    // percentage
  bars: number;       // holding period
  reason: string;     // why entered / exited
  // ── Position sizing (เงินจริง — ตรรกะเดียวกับหน้า trading/Binance: qty = ทุน ÷ ราคา) ──
  // optional เพื่อให้ผู้สร้าง Trade แบบ synthetic ที่อื่น (discordBot/Gold) ยังใช้ได้
  qty?: number;          // จำนวนเหรียญที่ซื้อ (ปัด 8 ตำแหน่ง)
  positionValue?: number; // มูลค่าสัญญา (notional) USDT ที่เปิดในไม้นี้ (qty × entryPrice)
  feesUsd?: number;       // ค่าธรรมเนียมรวมสองขา (USDT)
  pnlUsd?: number;        // กำไร/ขาดทุนสุทธิเป็นเงิน (USDT)
  equityAfter?: number;   // เงินทุนคงเหลือหลังปิดไม้นี้ (USDT)
  // ── Futures ──
  side?: "long" | "short"; // ทิศทางของไม้ (default long สำหรับ spot)
  marginUsd?: number;      // เงิน margin จริงที่ใช้ต่อไม้ (USDT) = notional ÷ leverage
}

// ── โหมดคิดขนาดการลงทุนต่อไม้ ──
export type SizingMode = "all_in" | "fixed" | "pct" | "risk";

// ── ประเภทตลาด: Spot (1x, long-only) หรือ Futures (มี leverage + short ได้) ──
export type MarketType = "spot" | "futures";

// ── ทิศทางที่อนุญาตในโหมด Futures ──
//   long  = เปิดเฉพาะ buy (ซื้อ)
//   short = เปิดเฉพาะ sell (ขาย/short)
//   both  = เปิดได้ทั้งสองทาง แบบกลับโพซิชัน (always in market)
export type FuturesDirection = "long" | "short" | "both";

// ── หน่วยวัดของ Stop Loss / Take Profit ──
//   price_pct   = % ของราคาเหรียญ (ราคาวิ่งไปกี่ %)
//   capital_pct = % ของทุน (margin) ที่ลงต่อไม้  → รวมผลของ leverage แล้ว
//   usdt        = กำไร/ขาดทุนเป็นเงิน USDT ของไม้นั้น
export type SlTpUnit = "price_pct" | "capital_pct" | "usdt";

export interface SizingConfig {
  mode: SizingMode;
  initialCapital: number; // ทุนเริ่มต้น (USDT)
  fixedAmount?: number;   // mode "fixed": เงินคงที่ต่อไม้ (USDT)
  pctOfCapital?: number;  // mode "pct": % ของทุนปัจจุบันต่อไม้ (0–100)
  riskPct?: number;       // mode "risk": % ความเสี่ยงของทุนต่อไม้ (0–100)
  stopLossPct?: number;   // mode "risk": ระยะ stop loss เป็น % ของราคา (>0)
  // ── Futures (optional; ถ้าไม่ระบุ = spot long-only 1x เหมือนเดิม) ──
  market?: MarketType;        // "spot" (default) | "futures"
  direction?: FuturesDirection; // default "long"
  leverage?: number;          // เลเวอเรจ (>=1), ใช้เฉพาะ futures; default 1
  // Stop Loss / Take Profit — เปิด/ปิดได้อิสระ ตรวจที่ราคาปิด (close)
  slEnabled?: boolean;
  slUnit?: SlTpUnit;
  slValue?: number;
  tpEnabled?: boolean;
  tpUnit?: SlTpUnit;
  tpValue?: number;
}

export const DEFAULT_SIZING: SizingConfig = {
  mode: "fixed",
  initialCapital: 1000,
  fixedAmount: 100,
  pctOfCapital: 10,
  riskPct: 2,
  stopLossPct: 2,
  market: "spot",
  direction: "long",
  leverage: 1,
};

export interface BacktestResult {
  trades: Trade[];
  totalPnlPct: number;
  winRate: number;
  wins: number;
  losses: number;
  totalTrades: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  profitFactor: number;
  avgWinPct: number;
  avgLossPct: number;
  avgBarsHeld: number;
  bestTradePct: number;
  worstTradePct: number;
  equityCurve: number[];   // cumulative % at each bar
  signals: SignalAction[];  // signal at each bar
  buyAndHoldPct: number;
  // ── สรุปเป็นเงินจริง (USDT) — optional เพื่อให้ synthetic result ที่อื่นยังใช้ได้ ──
  sizingMode?: SizingMode;
  initialCapital?: number;  // ทุนเริ่มต้น (USDT)
  finalCapital?: number;    // ทุนสุดท้าย (USDT)
  totalPnlUsd?: number;     // กำไร/ขาดทุนรวมเป็นเงิน (USDT)
  totalReturnPct?: number;  // ผลตอบแทนรวมเทียบทุนเริ่มต้น (%)
  totalFeesUsd?: number;    // ค่าธรรมเนียมรวม (USDT)
  maxDrawdownUsd?: number;  // drawdown สูงสุดเป็นเงิน (USDT)
  equityCurveUsd?: number[]; // ทุนคงเหลือ (USDT) ที่แต่ละแท่ง
  // ── Futures metadata (optional) ──
  market?: MarketType;        // "spot" | "futures"
  direction?: FuturesDirection; // ทิศทางที่ใช้ (futures)
  leverage?: number;          // เลเวอเรจที่ใช้
}

export type StrategyId =
  | "rsi"
  | "cdc_actionzone"
  | "smc"
  | "cm_macd"
  | "supertrend"
  | "squeeze_momentum"
  | "msb_ob"
  | "support_resistance"
  | "trendlines"
  | "ut_bot"
  | "chandelier_exit"
  | "tony_ema_scalper"
  | "supertrend_strategy"
  | "turtle_channels"
  | "scalping_pullback"
  | "trendline_breakouts"
  | "smart_money_breakout"
  | "sr_high_volume"
  | "cdc_actionzone_v2"
  | "zigzag_pp"
  | "price_action_smc"
  | "price_action_sr"
  | "candlestick_patterns"
  | "pivot_points_hl"
  | "tma_overlay"
  | "auto_chart_patterns"
  | "diy_strategy_builder"
  | "rsi_divergence"
  | "trend_strength"
  | "pasmc_scalper"
  | "smc_trend_pullback";

export interface StrategyConfig {
  id: StrategyId;
  name: string;
  descriptionEn: string;
  descriptionTh: string;
  params: Record<string, number>;
}

export const STRATEGIES: StrategyConfig[] = [
  {
    id: "smc",
    name: "Smart Money Concepts (SMC)",
    descriptionEn: "Buy on Bullish CHoCH/BOS (discount zone), Sell on Bearish CHoCH/BOS (premium zone)",
    descriptionTh: "ซื้อ เมื่อ CHoCH/BOS ขาขึ้น (โซนส่วนลด), ขาย เมื่อ CHoCH/BOS ขาลง (โซนพรีเมียม)",
    params: { swingSize: 50, internalSize: 5 },
  },
  {
    id: "pivot_points_hl",
    name: "Pivot Points HL (LuxAlgo)",
    descriptionEn: "Regular + missed pivots — Buy on pivot low confirm (expect bounce), Sell on pivot high confirm",
    descriptionTh: "Pivot ปกติ + missed pivot — ซื้อ เมื่อยืนยัน pivot low (คาดเด้ง), ขาย เมื่อยืนยัน pivot high",
    params: { pphlLength: 50 },
  },
  {
    id: "price_action_sr",
    name: "Price Action S&R (DGT)",
    descriptionEn: "3-bar consecutive sequences as S/R + volume/volatility spikes. Buy on resistance break, Sell on support break",
    descriptionTh: "ลำดับ 3 แท่งติด = S/R + Volume/Volatility spike. ซื้อ เมื่อทะลุแนวต้าน, ขาย เมื่อหลุดแนวรับ",
    params: { pasrVolMaLength: 89, pasrVolSpikeThresh: 4.669, pasrAtrLength: 11, pasrAtrMult: 2.718 },
  },
  {
    id: "rsi",
    name: "RSI Overbought/Oversold",
    descriptionEn: "Buy when RSI < 30, Sell when RSI > 70",
    descriptionTh: "ซื้อ เมื่อ RSI < 30, ขาย เมื่อ RSI > 70",
    params: { period: 14, buyThreshold: 30, sellThreshold: 70 },
  },
  {
    id: "cdc_actionzone",
    name: "CDC ActionZone V3",
    descriptionEn: "EMA crossover zones — Buy on first Green bar, Sell on first Red bar",
    descriptionTh: "โซน EMA ตัดกัน — ซื้อ เมื่อแท่งเขียวแรก, ขาย เมื่อแท่งแดงแรก",
    params: { fastPeriod: 12, slowPeriod: 26 },
  },
  {
    id: "squeeze_momentum",
    name: "Squeeze Momentum [LazyBear]",
    descriptionEn: "BB Squeeze + Momentum — Buy when momentum crosses above 0, Sell when crosses below 0",
    descriptionTh: "BB Squeeze + โมเมนตัม — ซื้อ เมื่อโมเมนตัมข้ามเหนือ 0, ขาย เมื่อข้ามใต้ 0",
    params: { bbLength: 20, bbMult: 2.0, kcLength: 20, kcMult: 1.5 },
  },
  {
    id: "cm_macd",
    name: "CM MacD Ultimate MTF",
    descriptionEn: "Enhanced MACD 4-Color — Buy when MACD crosses above Signal, Sell when crosses below Signal",
    descriptionTh: "MACD 4 สี — ซื้อ เมื่อ MACD ตัดขึ้นเหนือ Signal, ขาย เมื่อ MACD ตัดลงใต้ Signal",
    params: { fastLength: 12, slowLength: 26, signalLength: 9 },
  },
  {
    id: "supertrend",
    name: "Supertrend",
    descriptionEn: "ATR-based trend follower — Buy when trend turns bullish, Sell when turns bearish",
    descriptionTh: "ตามเทรนด์ด้วย ATR — ซื้อ เมื่อเทรนด์เปลี่ยนเป็นขาขึ้น, ขาย เมื่อเปลี่ยนเป็นขาลง",
    params: { atrPeriod: 10, multiplier: 3.0 },
  },
  {
    id: "msb_ob",
    name: "Market Structure Break & OB",
    descriptionEn: "ZigZag MSB — Buy on Bullish MSB with Order Block, Sell on Bearish MSB with Order Block",
    descriptionTh: "ZigZag MSB — ซื้อ เมื่อ Bullish MSB พร้อม Order Block, ขาย เมื่อ Bearish MSB พร้อม Order Block",
    params: { zigzagLen: 9, fibFactor: 0.33 },
  },
  {
    id: "support_resistance",
    name: "Support & Resistance Breaks",
    descriptionEn: "Pivot S/R + Volume — Buy when breaking Resistance, Sell when breaking Support with Volume",
    descriptionTh: "Pivot S/R + Volume — ซื้อ เมื่อทะลุแนวต้าน, ขาย เมื่อหลุดแนวรับ พร้อม Volume ยืนยัน",
    params: { leftBars: 15, rightBars: 15, volumeThresh: 20 },
  },
  {
    id: "trendlines",
    name: "Trendlines with Breaks [LuxAlgo]",
    descriptionEn: "Dynamic trendlines — Buy when breaking resistance line, Sell when breaking support line",
    descriptionTh: "เส้นเทรนด์ไดนามิก — ซื้อ เมื่อทะลุเส้นแนวต้าน, ขาย เมื่อหลุดเส้นแนวรับ",
    params: { trendLength: 14, trendMult: 1.0 },
  },
  {
    id: "ut_bot",
    name: "UT Bot Alerts",
    descriptionEn: "ATR Trailing Stop — Buy when price crosses above trailing stop, Sell when crosses below",
    descriptionTh: "ATR Trailing Stop — ซื้อ เมื่อราคาข้ามขึ้นเหนือ trailing stop, ขาย เมื่อราคาข้ามลง",
    params: { keyValue: 1, utAtrPeriod: 10 },
  },
  {
    id: "chandelier_exit",
    name: "Chandelier Exit",
    descriptionEn: "ATR trailing stops — Buy on direction flip up, Sell on direction flip down",
    descriptionTh: "ATR Trailing Stop ทั้งสองฝั่ง — ซื้อ เมื่อทิศกลับขึ้น, ขาย เมื่อทิศกลับลง",
    params: { ceLength: 22, ceMult: 3.0, ceUseClose: 1 },
  },
  {
    id: "tony_ema_scalper",
    name: "Tony's EMA Scalper",
    descriptionEn: "EMA cross with direction filter — Buy on bullish cross, Sell on bearish cross",
    descriptionTh: "ราคาตัด EMA พร้อมกรองทิศ — ซื้อ เมื่อราคาตัดขึ้นเหนือ EMA, ขาย เมื่อราคาตัดลงใต้ EMA",
    params: { tonyEmaLength: 20, tonyChannelLength: 8 },
  },
  {
    id: "supertrend_strategy",
    name: "SuperTrend STRATEGY (Kivanc)",
    descriptionEn: "Supertrend with selectable ATR method — Buy on trend flip up, Sell on trend flip down",
    descriptionTh: "Supertrend (เลือกวิธี ATR ได้) — ซื้อ เมื่อเทรนด์เปลี่ยนเป็นขาขึ้น, ขาย เมื่อเปลี่ยนเป็นขาลง",
    params: { stsAtrPeriod: 10, stsMultiplier: 3.0, stsChangeATR: 1 },
  },
  {
    id: "turtle_channels",
    name: "Turtle Trade Channels",
    descriptionEn: "Donchian channel breakout — Buy on new N-bar high, Sell on N-bar low exit",
    descriptionTh: "Channel Breakout แบบ Turtle — ซื้อ เมื่อทะลุ High N แท่ง, ขาย เมื่อหลุด Low N แท่ง",
    params: { turtleEntryLength: 20, turtleExitLength: 10 },
  },
  {
    id: "scalping_pullback",
    name: "Scalping PullBack Tool (JustUncleL)",
    descriptionEn: "EMA ribbon + PAC pullback — Buy on bullish pullback recovery, Sell on bearish pullback recovery",
    descriptionTh: "EMA Ribbon + PAC Pullback — ซื้อ เมื่อ pullback กลับขึ้นในเทรนด์ขาขึ้น, ขาย เมื่อ pullback กลับลงในเทรนด์ขาลง",
    params: { spPacLength: 34, spFastEMA: 89, spMediumEMA: 200, spLookback: 3 },
  },
  {
    id: "trendline_breakouts",
    name: "Trendline Breakouts w/ Targets (ChartPrime)",
    descriptionEn: "Pivot trendline breakouts with ATR-based TP/SL — Buy on resistance break, Sell on TP/SL hit",
    descriptionTh: "Trendline จาก Pivot + เป้าหมาย ATR — ซื้อ เมื่อทะลุเส้นแนวต้านที่ลาดลง, ขาย เมื่อชน TP หรือ SL",
    params: { tbPeriod: 10, tbUseWicks: 1 },
  },
  {
    id: "smart_money_breakout",
    name: "Smart Money Breakout Channels (AlgoAlpha)",
    descriptionEn: "Volatility-based channel detection — Buy on bullish channel breakout, Sell on bearish channel breakout",
    descriptionTh: "Channel จากความผันผวน — ซื้อ เมื่อราคาทะลุขึ้นเหนือ channel, ขาย เมื่อราคาหลุดลงใต้ channel",
    params: { smcboNormLength: 100, smcboBoxLength: 14, smcboStrongCloses: 1, smcboOverlap: 0 },
  },
  {
    id: "sr_high_volume",
    name: "S/R High Volume Boxes (ChartPrime)",
    descriptionEn: "Volume-confirmed pivot S/R boxes — Buy on resistance break with high vol, Sell on support break",
    descriptionTh: "S/R Boxes กรองด้วยปริมาณการซื้อขาย — ซื้อ เมื่อทะลุแนวต้านพร้อม Volume สูง, ขาย เมื่อหลุดแนวรับ",
    params: { srhvLookback: 20, srhvVolLen: 2, srhvBoxWidth: 1.0 },
  },
  {
    id: "cdc_actionzone_v2",
    name: "CDC ActionZone V.2",
    descriptionEn: "Piriya 2016 — ohlc4 + EMA(2) pre-smooth + Fast/Slow EMA cross. Buy on bullish cross, Sell on bearish",
    descriptionTh: "Piriya 2016 — ohlc4 + EMA(2) แล้วตัดด้วย Fast/Slow EMA ซื้อ เมื่อ Fast ตัดขึ้นเหนือ Slow, ขาย เมื่อตัดลง",
    params: { cdcV2Fast: 12, cdcV2Slow: 26 },
  },
  {
    id: "zigzag_pp",
    name: "ZigZag++ (DevLucem)",
    descriptionEn: "Percent-deviation ZigZag — Buy on direction flip up, Sell on direction flip down",
    descriptionTh: "ZigZag ตามเปอร์เซ็นต์การ pullback — ซื้อ เมื่อทิศกลับขึ้น, ขาย เมื่อทิศกลับลง",
    params: { zzDepth: 12, zzDeviation: 5, zzBackstep: 2 },
  },
  {
    id: "price_action_smc",
    name: "Price Action SMC (BigBeluga)",
    descriptionEn: "Internal CHoCH filtered by swing trend + discount zone + OB/FVG confluence — Buy on Bullish CHoCH aligned with the dominant swing uptrend in discount with OB/FVG, Sell on Bearish CHoCH or swing-trend flip",
    descriptionTh: "CHoCH ภายในกรองด้วย swing trend + โซน discount + OB/FVG — ซื้อ เมื่อ CHoCH ขาขึ้นตรงกับเทรนด์หลัก (swing) ในโซนส่วนลด พร้อม OB/FVG, ขาย เมื่อ CHoCH ขาลง หรือ swing trend พลิก",
    params: { pasmcLen: 5, pasmcObLength: 5, pasmcBuildSweep: 1, pasmcSwing: 50, pasmcUseSwing: 1, pasmcUseOB: 1 },
  },

  {
    id: "candlestick_patterns",
    name: "Candlestick Patterns Identified",
    descriptionEn: "Classic Japanese candlestick patterns — Buy on bullish patterns, Sell on bearish",
    descriptionTh: "แพทเทิร์น Candlestick คลาสสิก — ซื้อ เมื่อแพทเทิร์น bullish, ขาย เมื่อแพทเทิร์น bearish",
    params: { cpTrendBars: 5, cpDojiSize: 0.05 },
  },

  {
    id: "tma_overlay",
    name: "TMA Overlay",
    descriptionEn: "4 SMMA + 3-Line Strike + Engulfing — Buy on bull strike/engulf in uptrend, Sell on bear in downtrend",
    descriptionTh: "4 SMMA + 3-Line Strike + Engulfing — ซื้อ เมื่อมีสัญญาณ bull ในเทรนด์ขึ้น, ขาย เมื่อ bear ในเทรนด์ลง",
    params: {},
  },
  {
    id: "auto_chart_patterns",
    name: "Auto Chart Patterns (Trendoscope)",
    descriptionEn: "Channels/Wedges/Triangles from pivots — Buy on bullish breakout above upper, Sell on bearish below lower",
    descriptionTh: "Channels/Wedges/Triangles จาก pivot — ซื้อ เมื่อทะลุเส้นบน, ขาย เมื่อหลุดเส้นล่าง",
    params: { acpZigzagLength: 8, acpFlatThreshold: 20, acpNumberOfPivots: 5 },
  },
  {
    id: "diy_strategy_builder",
    name: "DIY Strategy Builder (ZP)",
    descriptionEn: "Compose leading + filters — Buy when leading signal passes all enabled filters, Sell symmetric",
    descriptionTh: "ผสม leading + ตัวกรอง — ซื้อ เมื่อ leading signal ผ่านทุกตัวกรองที่เปิด, ขาย แบบเดียวกัน",
    params: { diyLeading: 0, diySignalExpiry: 3, diyUseEma200: 1, diyUseRsi50: 1 },
  },
  {
    id: "rsi_divergence",
    name: "RSI Divergence Indicator",
    descriptionEn: "RSI pivot divergence (long-only) — Buy on Bullish Divergence, Sell on RSI take-profit cross or Bearish Divergence",
    descriptionTh: "Divergence ของ RSI (ฝั่ง Long) — ซื้อ เมื่อเกิด Bullish Divergence, ขาย เมื่อ RSI ตัดขึ้นเหนือ TP Level หรือเกิด Bearish Divergence",
    params: { rsiDivPeriod: 9, rsiDivLbL: 1, rsiDivLbR: 3, rsiDivTakeProfit: 80 },
  },
  {
    id: "trend_strength",
    name: "Trend Strength Signals [AlgoAlpha]",
    descriptionEn: "SMA ± Std Dev envelope — Buy when price breaks above the upper band (trend flips up), Sell when it breaks below the lower band",
    descriptionTh: "กรอบ SMA ± Std Dev — ซื้อ เมื่อราคาทะลุแถบบน (เทรนด์เปลี่ยนเป็นขาขึ้น), ขาย เมื่อราคาหลุดแถบล่าง",
    params: { tssPeriod: 20, tssMult: 2.5 },
  },
  {
    id: "pasmc_scalper",
    name: "PA-SMC Scalper (BigBeluga)",
    descriptionEn: "Reversal scalper (30m/1h) — Buy on bullish Liquidity Sweep + reclaim / Order Block reaction / CHoCH. Exit on ATR TP/SL, bearish sweep/CHoCH, or OB invalidation",
    descriptionTh: "สแกลป์สวนกลับ (30m/1h) — ซื้อ เมื่อเกิด Liquidity Sweep ขาขึ้น + reclaim / เด้งจาก Order Block / CHoCH ออก เมื่อชน ATR TP/SL, sweep/CHoCH ขาลง หรือหลุด OB",
    params: { pascLen: 3, pascObLen: 3, pascSweep: 1, pascUseOB: 1, pascTpAtr: 3.0, pascSlAtr: 1.5 },
  },
  {
    id: "smc_trend_pullback",
    name: "SMC Trend Pullback (LuxAlgo)",
    descriptionEn: "Trend-following pullback (30m/1h) — Buy on internal bullish break in discount zone with OB/FVG confluence while swing trend is up. Exit on ATR TP/SL, bearish CHoCH, swing-trend flip, or premium zone",
    descriptionTh: "ตามเทรนด์เข้า pullback (30m/1h) — ซื้อ เมื่อ internal break ขาขึ้นในโซน discount + มี OB/FVG ยืนยัน ขณะ swing trend เป็นขาขึ้น ออก เมื่อชน ATR TP/SL, CHoCH ขาลง, swing trend พลิก หรือถึงโซน premium",
    params: { smcpSwing: 20, smcpInternal: 5, smcpUseOB: 1, smcpUseFvg: 1, smcpTpAtr: 4.0, smcpSlAtr: 2.0 },
  },
];

// ─── Signal Generators ─────────────────────────────────────────
type SignalFn = (klines: KlineData[], ind: AllIndicators, params: Record<string, number>) => SignalAction[];

function rsiStrategy(_klines: KlineData[], ind: AllIndicators, params: Record<string, number>): SignalAction[] {
  const buyTh = params.buyThreshold ?? 30;
  const sellTh = params.sellThreshold ?? 70;
  return ind.rsi.map((v) => {
    if (v === null) return "HOLD";
    if (v < buyTh) return "BUY";
    if (v > sellTh) return "SELL";
    return "HOLD";
  });
}

function cdcActionZoneStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  const cdc = ind.cdcActionZone;
  return cdc.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function smcStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.smc.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function cmMacdStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.cmMacd.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function supertrendStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.supertrend.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function squeezeMomentumStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.squeezeMomentum.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function msbObStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.msbOb.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function supportResistanceStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.supportResistance.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function trendlinesStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.trendlines.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function utBotStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.utBot.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function chandelierExitStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.chandelierExit.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function tonyEmaScalperStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.tonyEmaScalper.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function superTrendStrategyFn(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.superTrendStrategy.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function turtleChannelsStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.turtleChannels.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function scalpingPullBackStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.scalpingPullBack.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function trendlineBreakoutsStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.trendlineBreakouts.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function smartMoneyBreakoutStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.smartMoneyBreakout.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function srHighVolumeStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.srHighVolume.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function cdcActionZoneV2Strategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.cdcActionZoneV2.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function zigzagPPStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.zigzagPlusPlus.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function priceActionSMCStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.priceActionSMC.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function priceActionSRStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.priceActionSR.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function candlestickPatternsStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.candlestickPatterns.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function pivotPointsHLStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.pivotPointsHL.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function tmaOverlayStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.tmaOverlay.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function autoChartPatternsStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.autoChartPatterns.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function diyStrategyBuilderStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.diyStrategyBuilder.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function rsiDivergenceStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.rsiDivergence.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function trendStrengthStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.trendStrength.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function pasmcScalperStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.pasmcScalper.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

function smcTrendPullbackStrategy(_k: KlineData[], ind: AllIndicators): SignalAction[] {
  return ind.smcTrendPullback.signal.map((sig) => {
    if (sig === "BUY") return "BUY";
    if (sig === "SELL") return "SELL";
    return "HOLD";
  });
}

const STRATEGY_FNS: Record<StrategyId, SignalFn> = {
  rsi: rsiStrategy,
  cdc_actionzone: cdcActionZoneStrategy,
  smc: smcStrategy,
  cm_macd: cmMacdStrategy,
  supertrend: supertrendStrategy,
  squeeze_momentum: squeezeMomentumStrategy,
  msb_ob: msbObStrategy,
  support_resistance: supportResistanceStrategy,
  trendlines: trendlinesStrategy,
  ut_bot: utBotStrategy,
  chandelier_exit: chandelierExitStrategy,
  tony_ema_scalper: tonyEmaScalperStrategy,
  supertrend_strategy: superTrendStrategyFn,
  turtle_channels: turtleChannelsStrategy,
  scalping_pullback: scalpingPullBackStrategy,
  trendline_breakouts: trendlineBreakoutsStrategy,
  smart_money_breakout: smartMoneyBreakoutStrategy,
  sr_high_volume: srHighVolumeStrategy,
  cdc_actionzone_v2: cdcActionZoneV2Strategy,
  zigzag_pp: zigzagPPStrategy,
  price_action_smc: priceActionSMCStrategy,
  price_action_sr: priceActionSRStrategy,
  candlestick_patterns: candlestickPatternsStrategy,
  pivot_points_hl: pivotPointsHLStrategy,
  tma_overlay: tmaOverlayStrategy,
  auto_chart_patterns: autoChartPatternsStrategy,
  diy_strategy_builder: diyStrategyBuilderStrategy,
  rsi_divergence: rsiDivergenceStrategy,
  trend_strength: trendStrengthStrategy,
  pasmc_scalper: pasmcScalperStrategy,
  smc_trend_pullback: smcTrendPullbackStrategy,
};

// ─── Backtest Engine ───────────────────────────────────────────
export function runBacktest(
  klines: KlineData[],
  strategyId: StrategyId,
  params: Record<string, number> = {},
  feesPct = 0.1, // 0.1% per trade (Binance default)
  sizing: SizingConfig = DEFAULT_SIZING,
): BacktestResult {
  const indicators = computeAll(klines, {
    rsiPeriod: strategyId === "rsi" ? (params.period ?? 14) : undefined,
    smcSwingSize: strategyId === "smc" ? (params.swingSize ?? 50) : undefined,
    smcInternalSize: strategyId === "smc" ? (params.internalSize ?? 5) : undefined,
    cmMacdFast: strategyId === "cm_macd" ? (params.fastLength ?? 12) : undefined,
    cmMacdSlow: strategyId === "cm_macd" ? (params.slowLength ?? 26) : undefined,
    cmMacdSignal: strategyId === "cm_macd" ? (params.signalLength ?? 9) : undefined,
    supertrendPeriod: strategyId === "supertrend" ? (params.atrPeriod ?? 10) : undefined,
    supertrendMultiplier: strategyId === "supertrend" ? (params.multiplier ?? 3.0) : undefined,
    sqzMomBBLength: strategyId === "squeeze_momentum" ? (params.bbLength ?? 20) : undefined,
    sqzMomBBMult: strategyId === "squeeze_momentum" ? (params.bbMult ?? 2.0) : undefined,
    sqzMomKCLength: strategyId === "squeeze_momentum" ? (params.kcLength ?? 20) : undefined,
    sqzMomKCMult: strategyId === "squeeze_momentum" ? (params.kcMult ?? 1.5) : undefined,
    msbZigzagLen: strategyId === "msb_ob" ? (params.zigzagLen ?? 9) : undefined,
    msbFibFactor: strategyId === "msb_ob" ? (params.fibFactor ?? 0.33) : undefined,
    srLeftBars: strategyId === "support_resistance" ? (params.leftBars ?? 15) : undefined,
    srRightBars: strategyId === "support_resistance" ? (params.rightBars ?? 15) : undefined,
    srVolumeThresh: strategyId === "support_resistance" ? (params.volumeThresh ?? 20) : undefined,
    trendLength: strategyId === "trendlines" ? (params.trendLength ?? 14) : undefined,
    trendMult: strategyId === "trendlines" ? (params.trendMult ?? 1.0) : undefined,
    utBotKey: strategyId === "ut_bot" ? (params.keyValue ?? 1) : undefined,
    utBotAtrPeriod: strategyId === "ut_bot" ? (params.utAtrPeriod ?? 10) : undefined,
    ceLength: strategyId === "chandelier_exit" ? (params.ceLength ?? 22) : undefined,
    ceMult: strategyId === "chandelier_exit" ? (params.ceMult ?? 3.0) : undefined,
    ceUseClose: strategyId === "chandelier_exit" ? (params.ceUseClose ?? 1) : undefined,
    tonyEmaLength: strategyId === "tony_ema_scalper" ? (params.tonyEmaLength ?? 20) : undefined,
    tonyChannelLength: strategyId === "tony_ema_scalper" ? (params.tonyChannelLength ?? 8) : undefined,
    stsAtrPeriod: strategyId === "supertrend_strategy" ? (params.stsAtrPeriod ?? 10) : undefined,
    stsMultiplier: strategyId === "supertrend_strategy" ? (params.stsMultiplier ?? 3.0) : undefined,
    stsChangeATR: strategyId === "supertrend_strategy" ? (params.stsChangeATR ?? 1) : undefined,
    turtleEntryLength: strategyId === "turtle_channels" ? (params.turtleEntryLength ?? 20) : undefined,
    turtleExitLength: strategyId === "turtle_channels" ? (params.turtleExitLength ?? 10) : undefined,
    spPacLength: strategyId === "scalping_pullback" ? (params.spPacLength ?? 34) : undefined,
    spFastEMA: strategyId === "scalping_pullback" ? (params.spFastEMA ?? 89) : undefined,
    spMediumEMA: strategyId === "scalping_pullback" ? (params.spMediumEMA ?? 200) : undefined,
    spLookback: strategyId === "scalping_pullback" ? (params.spLookback ?? 3) : undefined,
    tbPeriod: strategyId === "trendline_breakouts" ? (params.tbPeriod ?? 10) : undefined,
    tbUseWicks: strategyId === "trendline_breakouts" ? (params.tbUseWicks ?? 1) : undefined,
    smcboNormLength: strategyId === "smart_money_breakout" ? (params.smcboNormLength ?? 100) : undefined,
    smcboBoxLength: strategyId === "smart_money_breakout" ? (params.smcboBoxLength ?? 14) : undefined,
    smcboStrongCloses: strategyId === "smart_money_breakout" ? (params.smcboStrongCloses ?? 1) : undefined,
    smcboOverlap: strategyId === "smart_money_breakout" ? (params.smcboOverlap ?? 0) : undefined,
    srhvLookback: strategyId === "sr_high_volume" ? (params.srhvLookback ?? 20) : undefined,
    srhvVolLen: strategyId === "sr_high_volume" ? (params.srhvVolLen ?? 2) : undefined,
    srhvBoxWidth: strategyId === "sr_high_volume" ? (params.srhvBoxWidth ?? 1.0) : undefined,
    cdcV2Fast: strategyId === "cdc_actionzone_v2" ? (params.cdcV2Fast ?? 12) : undefined,
    cdcV2Slow: strategyId === "cdc_actionzone_v2" ? (params.cdcV2Slow ?? 26) : undefined,
    zzDepth: strategyId === "zigzag_pp" ? (params.zzDepth ?? 12) : undefined,
    zzDeviation: strategyId === "zigzag_pp" ? (params.zzDeviation ?? 5) : undefined,
    zzBackstep: strategyId === "zigzag_pp" ? (params.zzBackstep ?? 2) : undefined,
    pasmcLen: strategyId === "price_action_smc" ? (params.pasmcLen ?? 5) : undefined,
    pasmcObLength: strategyId === "price_action_smc" ? (params.pasmcObLength ?? 5) : undefined,
    pasmcBuildSweep: strategyId === "price_action_smc" ? (params.pasmcBuildSweep ?? 1) : undefined,
    pasmcSwing: strategyId === "price_action_smc" ? (params.pasmcSwing ?? 50) : undefined,
    pasmcUseSwing: strategyId === "price_action_smc" ? (params.pasmcUseSwing ?? 1) : undefined,
    pasmcUseOB: strategyId === "price_action_smc" ? (params.pasmcUseOB ?? 1) : undefined,
    pasrVolMaLength: strategyId === "price_action_sr" ? (params.pasrVolMaLength ?? 89) : undefined,
    pasrVolSpikeThresh: strategyId === "price_action_sr" ? (params.pasrVolSpikeThresh ?? 4.669) : undefined,
    pasrAtrLength: strategyId === "price_action_sr" ? (params.pasrAtrLength ?? 11) : undefined,
    pasrAtrMult: strategyId === "price_action_sr" ? (params.pasrAtrMult ?? 2.718) : undefined,
    cpTrendBars: strategyId === "candlestick_patterns" ? (params.cpTrendBars ?? 5) : undefined,
    cpDojiSize: strategyId === "candlestick_patterns" ? (params.cpDojiSize ?? 0.05) : undefined,
    pphlLength: strategyId === "pivot_points_hl" ? (params.pphlLength ?? 50) : undefined,
    acpZigzagLength: strategyId === "auto_chart_patterns" ? (params.acpZigzagLength ?? 8) : undefined,
    acpFlatThreshold: strategyId === "auto_chart_patterns" ? (params.acpFlatThreshold ?? 20) : undefined,
    acpNumberOfPivots: strategyId === "auto_chart_patterns" ? (params.acpNumberOfPivots ?? 5) : undefined,
    diyLeading: strategyId === "diy_strategy_builder" ? (params.diyLeading ?? 0) : undefined,
    diySignalExpiry: strategyId === "diy_strategy_builder" ? (params.diySignalExpiry ?? 3) : undefined,
    diyUseEma200: strategyId === "diy_strategy_builder" ? (params.diyUseEma200 ?? 0) : undefined,
    diyUseEmaCross: strategyId === "diy_strategy_builder" ? (params.diyUseEmaCross ?? 0) : undefined,
    diyUseCdcZone: strategyId === "diy_strategy_builder" ? (params.diyUseCdcZone ?? 0) : undefined,
    diyUseTrendlines: strategyId === "diy_strategy_builder" ? (params.diyUseTrendlines ?? 0) : undefined,
    diyUseRsi50: strategyId === "diy_strategy_builder" ? (params.diyUseRsi50 ?? 1) : undefined,
    rsiDivPeriod: strategyId === "rsi_divergence" ? (params.rsiDivPeriod ?? 9) : undefined,
    rsiDivLbL: strategyId === "rsi_divergence" ? (params.rsiDivLbL ?? 1) : undefined,
    rsiDivLbR: strategyId === "rsi_divergence" ? (params.rsiDivLbR ?? 3) : undefined,
    rsiDivTakeProfit: strategyId === "rsi_divergence" ? (params.rsiDivTakeProfit ?? 80) : undefined,
    tssPeriod: strategyId === "trend_strength" ? (params.tssPeriod ?? 20) : undefined,
    tssMult: strategyId === "trend_strength" ? (params.tssMult ?? 2.5) : undefined,
    pascLen: strategyId === "pasmc_scalper" ? (params.pascLen ?? 3) : undefined,
    pascObLen: strategyId === "pasmc_scalper" ? (params.pascObLen ?? 3) : undefined,
    pascSweep: strategyId === "pasmc_scalper" ? (params.pascSweep ?? 1) : undefined,
    pascUseOB: strategyId === "pasmc_scalper" ? (params.pascUseOB ?? 1) : undefined,
    pascTpAtr: strategyId === "pasmc_scalper" ? (params.pascTpAtr ?? 3.0) : undefined,
    pascSlAtr: strategyId === "pasmc_scalper" ? (params.pascSlAtr ?? 1.5) : undefined,
    smcpSwing: strategyId === "smc_trend_pullback" ? (params.smcpSwing ?? 20) : undefined,
    smcpInternal: strategyId === "smc_trend_pullback" ? (params.smcpInternal ?? 5) : undefined,
    smcpUseOB: strategyId === "smc_trend_pullback" ? (params.smcpUseOB ?? 1) : undefined,
    smcpUseFvg: strategyId === "smc_trend_pullback" ? (params.smcpUseFvg ?? 1) : undefined,
    smcpTpAtr: strategyId === "smc_trend_pullback" ? (params.smcpTpAtr ?? 4.0) : undefined,
    smcpSlAtr: strategyId === "smc_trend_pullback" ? (params.smcpSlAtr ?? 2.0) : undefined,
  });
  const signals = STRATEGY_FNS[strategyId](klines, indicators, params);

  const closes = klines.map(k => +k.close);
  const trades: Trade[] = [];

  // ── Position sizing — เงินทุนเดินเป็นเงินจริง (USDT) ──
  const initialCapital = sizing.initialCapital > 0 ? sizing.initialCapital : 1000;
  let equity = initialCapital; // ทุนคงเหลือปัจจุบัน
  const round8 = (x: number) => +x.toFixed(8); // ปัด qty 8 ตำแหน่ง (เหมือนหน้า trading/Binance)

  // ── โหมดตลาด/ทิศทาง/เลเวอเรจ (default = spot long-only 1x เหมือนเดิม) ──
  const isFutures = sizing.market === "futures";
  const leverage = isFutures ? Math.max(1, sizing.leverage ?? 1) : 1;
  const direction: FuturesDirection = isFutures ? (sizing.direction ?? "long") : "long";
  // SL/TP ใช้เฉพาะเมื่อเปิดใช้งาน (ตรวจที่ราคาปิดเท่านั้น)
  const slOn = !!sizing.slEnabled && (sizing.slValue ?? 0) > 0;
  const tpOn = !!sizing.tpEnabled && (sizing.tpValue ?? 0) > 0;

  // เลือก "เงิน margin" ที่จะลงในไม้นี้ตามโหมด — notional = margin × leverage, qty = notional ÷ ราคาเข้า
  const planEntry = (price: number) => {
    if (equity <= 0 || price <= 0) return { qty: 0, notional: 0, margin: 0 };
    let target: number;
    switch (sizing.mode) {
      case "all_in":
        target = equity;
        break;
      case "fixed":
        target = sizing.fixedAmount ?? 100;
        break;
      case "pct":
        target = equity * ((sizing.pctOfCapital ?? 10) / 100);
        break;
      case "risk": {
        const riskAmount = equity * ((sizing.riskPct ?? 2) / 100);
        const sl = (sizing.stopLossPct ?? 2) / 100;
        target = sl > 0 ? riskAmount / sl : equity;
        break;
      }
      default:
        target = equity;
    }
    const margin = Math.min(target, equity); // margin ลงเกินทุนคงเหลือไม่ได้
    const notional = margin * leverage;      // มูลค่าสัญญา (spot: leverage = 1)
    const qty = round8(notional / price);
    return { qty, notional: qty * price, margin };
  };

  // ปิดไม้: คิดกำไร/ขาดทุนเป็นเงินจริง (รองรับ long/short + leverage) + อัปเดตทุน แล้ว push trade
  const closeTrade = (
    side: "long" | "short",
    qty: number, notional: number, margin: number,
    eIdx: number, ePrice: number, eReason: string,
    exitIdx: number, exitPrice: number, reason: string,
  ) => {
    const dir = side === "long" ? 1 : -1;
    const grossPnlPct = dir * ((exitPrice - ePrice) / ePrice) * 100; // % การวิ่งของราคา (ตามทิศ)
    const exitValue = qty * exitPrice;
    const feesUsd = (notional + exitValue) * (feesPct / 100); // ค่าธรรมเนียมสองขา (คิดบน notional)
    let pnlUsd = dir * (exitValue - notional) - feesUsd;       // กำไร/ขาดทุนเป็นเงิน (USDT)
    // Futures (isolated margin): เสียได้ไม่เกิน margin ที่วางไว้ — จำลอง liquidation กันทุนติดลบ
    if (isFutures && pnlUsd < -margin) pnlUsd = -margin;
    equity += pnlUsd;
    // pnlPct = ผลตอบแทนต่อ margin ที่ลง (รวมผลของ leverage แล้ว) — สำหรับ spot จะ ≈ % ราคาเดิม
    const netPnlPct = margin > 0 ? (pnlUsd / margin) * 100 : grossPnlPct - feesPct * 2;
    trades.push({
      entryIdx: eIdx,
      entryTime: klines[eIdx].openTime,
      entryPrice: ePrice,
      exitIdx,
      exitTime: klines[exitIdx].openTime,
      exitPrice,
      pnl: dir * (exitPrice - ePrice),
      pnlPct: netPnlPct,
      bars: exitIdx - eIdx,
      reason: `${eReason}${reason}`,
      qty,
      positionValue: notional,
      feesUsd,
      pnlUsd,
      equityAfter: equity,
      side,
      marginUsd: margin,
    });
  };

  // โพซิชันที่เปิดอยู่
  type OpenPos = {
    side: "long" | "short";
    entryIdx: number; entryPrice: number;
    qty: number; notional: number; margin: number; reason: string;
  };

  // สร้างโพซิชันใหม่ (คืน null ถ้าทุนหมด/เปิดไม่ได้)
  const buildPos = (side: "long" | "short", i: number, price: number, reason: string): OpenPos | null => {
    const plan = planEntry(price);
    if (plan.qty <= 0) return null;
    return { side, entryIdx: i, entryPrice: price, qty: plan.qty, notional: plan.notional, margin: plan.margin, reason };
  };

  // ปิดโพซิชัน p ที่ราคา exitPrice
  const doClose = (p: OpenPos, exitIdx: number, exitPrice: number, reason: string) => {
    closeTrade(p.side, p.qty, p.notional, p.margin, p.entryIdx, p.entryPrice, p.reason, exitIdx, exitPrice, reason);
  };

  // ตรวจ SL/TP ที่ราคาปิด — คืนค่าเหตุผลที่ต้องปิด ถ้าไม่ถึงคืน null
  const checkSlTp = (p: OpenPos, price: number): string | null => {
    if (!slOn && !tpOn) return null;
    const dir = p.side === "long" ? 1 : -1;
    const grossPnlUsd = dir * p.qty * (price - p.entryPrice);   // ก่อนหักค่าธรรมเนียม
    const pricePct = dir * ((price - p.entryPrice) / p.entryPrice) * 100;
    const capitalPct = p.margin > 0 ? (grossPnlUsd / p.margin) * 100 : 0;
    const metric = (unit: SlTpUnit) =>
      unit === "price_pct" ? pricePct : unit === "capital_pct" ? capitalPct : grossPnlUsd;
    // SL ก่อน (อนุรักษ์นิยม) แล้วค่อย TP
    if (slOn && metric(sizing.slUnit ?? "price_pct") <= -(sizing.slValue ?? 0)) return " → Stop Loss";
    if (tpOn && metric(sizing.tpUnit ?? "price_pct") >= (sizing.tpValue ?? 0)) return " → Take Profit";
    return null;
  };

  let pos: OpenPos | null = null;

  // Generate trades
  for (let i = 0; i < klines.length; i++) {
    const price = closes[i];

    // 1) ตรวจ SL/TP ที่ราคาปิดก่อน
    if (pos) {
      const exitReason = checkSlTp(pos, price);
      if (exitReason) {
        doClose(pos, i, price, exitReason);
        pos = null;
        continue; // ปิดด้วย SL/TP แล้ว ไม่เปิดไม้ใหม่ในแท่งเดียวกัน
      }
    }

    const sig = signals[i];

    // 2) จัดการสัญญาณตามทิศทางที่เลือก
    if (direction === "long") {
      if (!pos && sig === "BUY") pos = buildPos("long", i, price, "BUY signal");
      else if (pos && sig === "SELL") { doClose(pos, i, price, " → SELL signal"); pos = null; }
    } else if (direction === "short") {
      if (!pos && sig === "SELL") pos = buildPos("short", i, price, "SELL signal");
      else if (pos && sig === "BUY") { doClose(pos, i, price, " → BUY signal (cover)"); pos = null; }
    } else {
      // both — กลับโพซิชัน (always in market)
      if (sig === "BUY" && (!pos || pos.side === "short")) {
        if (pos) doClose(pos, i, price, " → reverse to long");
        pos = buildPos("long", i, price, "BUY signal");
      } else if (sig === "SELL" && (!pos || pos.side === "long")) {
        if (pos) doClose(pos, i, price, " → reverse to short");
        pos = buildPos("short", i, price, "SELL signal");
      }
    }
  }

  // Close any open position at last bar
  if (pos) {
    doClose(pos, klines.length - 1, closes[closes.length - 1], " → Force close (end)");
    pos = null;
  }

  // Stats
  const wins = trades.filter(t => t.pnlPct > 0);
  const losses = trades.filter(t => t.pnlPct <= 0);
  const totalPnlPct = trades.reduce((sum, t) => sum + t.pnlPct, 0);
  const winRate = trades.length === 0 ? 0 : (wins.length / trades.length) * 100;
  const avgWinPct = wins.length === 0 ? 0 : wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length;
  const avgLossPct = losses.length === 0 ? 0 : losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length;
  const avgBarsHeld = trades.length === 0 ? 0 : trades.reduce((s, t) => s + t.bars, 0) / trades.length;
  const bestTradePct = trades.length === 0 ? 0 : Math.max(...trades.map(t => t.pnlPct));
  const worstTradePct = trades.length === 0 ? 0 : Math.min(...trades.map(t => t.pnlPct));

  const grossWins = wins.reduce((s, t) => s + t.pnlPct, 0);
  const grossLosses = Math.abs(losses.reduce((s, t) => s + t.pnlPct, 0));
  const profitFactor = grossLosses === 0 ? (grossWins > 0 ? Infinity : 0) : grossWins / grossLosses;

  // Equity curve (cumulative %) + เงินจริง (USDT) แบบขนานกัน
  const equityCurve: number[] = [];
  const equityCurveUsd: number[] = [];
  let cumPnl = 0;
  let curEquityUsd = initialCapital;
  let tradeIdx = 0;
  for (let i = 0; i < klines.length; i++) {
    while (tradeIdx < trades.length && i === trades[tradeIdx].exitIdx) {
      cumPnl += trades[tradeIdx].pnlPct;
      curEquityUsd = trades[tradeIdx].equityAfter ?? curEquityUsd;
      tradeIdx++;
    }
    equityCurve.push(cumPnl);
    equityCurveUsd.push(curEquityUsd);
  }

  // Max drawdown (%)
  let peak = 0, maxDD = 0;
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    const dd = peak - eq;
    if (dd > maxDD) maxDD = dd;
  }

  // Max drawdown (เงินจริง — peak-to-valley ของทุน USDT)
  let peakUsd = initialCapital, maxDDUsd = 0;
  for (const eq of equityCurveUsd) {
    if (eq > peakUsd) peakUsd = eq;
    const dd = peakUsd - eq;
    if (dd > maxDDUsd) maxDDUsd = dd;
  }

  // สรุปเงินจริง
  const finalCapital = equity;
  const totalPnlUsd = finalCapital - initialCapital;
  const totalReturnPct = initialCapital > 0 ? (totalPnlUsd / initialCapital) * 100 : 0;
  const totalFeesUsd = trades.reduce((s, t) => s + (t.feesUsd ?? 0), 0);

  // Sharpe (simplified — using trade returns)
  const tradePnls = trades.map(t => t.pnlPct);
  const meanRet = tradePnls.length === 0 ? 0 : tradePnls.reduce((a, b) => a + b, 0) / tradePnls.length;
  const variance = tradePnls.length <= 1 ? 0 : tradePnls.reduce((s, r) => s + (r - meanRet) ** 2, 0) / (tradePnls.length - 1);
  const sharpe = variance === 0 ? 0 : meanRet / Math.sqrt(variance);

  // Buy & hold
  const buyAndHoldPct = closes.length >= 2
    ? ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100
    : 0;

  return {
    trades,
    totalPnlPct,
    winRate,
    wins: wins.length,
    losses: losses.length,
    totalTrades: trades.length,
    maxDrawdownPct: maxDD,
    sharpeRatio: sharpe,
    profitFactor,
    avgWinPct,
    avgLossPct,
    avgBarsHeld,
    bestTradePct,
    worstTradePct,
    equityCurve,
    signals,
    buyAndHoldPct,
    sizingMode: sizing.mode,
    initialCapital,
    finalCapital,
    totalPnlUsd,
    totalReturnPct,
    totalFeesUsd,
    maxDrawdownUsd: maxDDUsd,
    equityCurveUsd,
    market: isFutures ? "futures" : "spot",
    direction,
    leverage,
  };
}
