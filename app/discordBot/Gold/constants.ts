// Gold/Forex symbol & interval constants used by the Gold dashboard.
// Two symbol sets:
// - YAHOO_SYMBOLS: for live trading (yahoo-finance2 → /api/klines-yahoo)
// - DUKASCOPY_SYMBOLS: for backtest (dukascopy-node → /api/klines-dukascopy)
//
// Both reference the SAME logical instrument (display name).
// label is shown in UI, yahoo/dukascopy are the underlying symbols sent to each API.

export interface GoldSymbol {
  /** display label, e.g., "XAU/USD" */
  label: string;
  /** Yahoo Finance ticker for live polling (some labels intentionally have no live symbol — backtest-only) */
  yahoo?: string;
  /** Dukascopy instrument id (always lowercase) */
  dukascopy: string;
  /** Group for select UI */
  group: "Metals" | "Forex Majors";
  /** Display price precision (decimals) for nicer rendering */
  decimals: number;
}

export const GOLD_SYMBOLS: GoldSymbol[] = [
  // ─── Metals ───
  { label: "XAU/USD", yahoo: "GC=F",    dukascopy: "xauusd", group: "Metals", decimals: 2 }, // Gold
  { label: "XAG/USD", yahoo: "SI=F",    dukascopy: "xagusd", group: "Metals", decimals: 3 }, // Silver
  { label: "XPT/USD", yahoo: "PL=F",    dukascopy: "xptusd", group: "Metals", decimals: 2 }, // Platinum
  { label: "XPD/USD", yahoo: "PA=F",    dukascopy: "xpdusd", group: "Metals", decimals: 2 }, // Palladium
  // ─── Forex Majors ───
  { label: "EUR/USD", yahoo: "EURUSD=X", dukascopy: "eurusd", group: "Forex Majors", decimals: 5 },
  { label: "GBP/USD", yahoo: "GBPUSD=X", dukascopy: "gbpusd", group: "Forex Majors", decimals: 5 },
  { label: "USD/JPY", yahoo: "USDJPY=X", dukascopy: "usdjpy", group: "Forex Majors", decimals: 3 },
  { label: "USD/CHF", yahoo: "USDCHF=X", dukascopy: "usdchf", group: "Forex Majors", decimals: 5 },
  { label: "AUD/USD", yahoo: "AUDUSD=X", dukascopy: "audusd", group: "Forex Majors", decimals: 5 },
  { label: "NZD/USD", yahoo: "NZDUSD=X", dukascopy: "nzdusd", group: "Forex Majors", decimals: 5 },
  { label: "USD/CAD", yahoo: "USDCAD=X", dukascopy: "usdcad", group: "Forex Majors", decimals: 5 },
];

export function findGoldSymbol(label: string): GoldSymbol | undefined {
  return GOLD_SYMBOLS.find(s => s.label === label);
}

// Yahoo Finance live intervals we expose (subset that works on free tier)
export const GOLD_LIVE_INTERVALS = [
  "1m", "5m", "15m", "30m", "1h", "1d",
] as const;
export type GoldLiveInterval = (typeof GOLD_LIVE_INTERVALS)[number];

export const GOLD_LIVE_INTERVAL_GROUPS: Record<string, GoldLiveInterval[]> = {
  "นาที": ["1m", "5m", "15m", "30m"],
  "ชั่วโมง": ["1h"],
  "วัน": ["1d"],
};

// Yahoo intraday history limits — used for UI hints, not enforced server-side
export const YAHOO_INTERVAL_LIMITS_HINT: Record<GoldLiveInterval, string> = {
  "1m":  "ย้อนได้ 7 วัน",
  "5m":  "ย้อนได้ 60 วัน",
  "15m": "ย้อนได้ 60 วัน",
  "30m": "ย้อนได้ 60 วัน",
  "1h":  "ย้อนได้ 730 วัน",
  "1d":  "ไม่จำกัด",
};

// Dukascopy backtest intervals
export const GOLD_BACKTEST_INTERVALS = [
  "1m", "5m", "15m", "30m", "1h", "4h", "1d",
] as const;
export type GoldBacktestInterval = (typeof GOLD_BACKTEST_INTERVALS)[number];

// Polling options (seconds) — same shape as crypto bot
export const GOLD_POLL_OPTIONS: { value: number; label: string }[] = [
  { value: 30,   label: "30 วินาที" },
  { value: 60,   label: "1 นาที" },
  { value: 300,  label: "5 นาที" },
  { value: 900,  label: "15 นาที" },
  { value: 3600, label: "1 ชั่วโมง" },
];
