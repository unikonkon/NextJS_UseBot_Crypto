import { NextRequest, NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";

// yahoo-finance2 v3+ requires instantiation
const yf = new YahooFinance();

// Map our interval names (Binance-like) → Yahoo Finance intervals
const INTERVAL_MAP: Record<string, "1m" | "5m" | "15m" | "30m" | "60m" | "90m" | "1d" | "5d" | "1wk" | "1mo" | "3mo"> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "30m": "30m",
  "1h": "60m",
  "1d": "1d",
  "1w": "1wk",
  "1M": "1mo",
};

// Approx interval duration in ms — used to derive closeTime
const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "1d": 86_400_000,
  "1w": 7 * 86_400_000,
  "1M": 30 * 86_400_000,
};

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const symbol = searchParams.get("symbol");
  const interval = searchParams.get("interval");
  const limit = parseInt(searchParams.get("limit") || "200", 10);
  const endTime = searchParams.get("endTime");

  if (!symbol || !interval) {
    return NextResponse.json(
      { error: "symbol and interval are required" },
      { status: 400 }
    );
  }

  const yInterval = INTERVAL_MAP[interval];
  if (!yInterval) {
    return NextResponse.json(
      { error: `Unsupported interval "${interval}". Supported: ${Object.keys(INTERVAL_MAP).join(", ")}` },
      { status: 400 }
    );
  }

  const intervalMs = INTERVAL_MS[interval];
  const period2 = endTime ? new Date(parseInt(endTime, 10)) : new Date();
  const period1 = new Date(period2.getTime() - limit * intervalMs);

  try {
    const result = await yf.chart(symbol, {
      period1,
      period2,
      interval: yInterval,
      includePrePost: false,
    });

    const quotes = result.quotes || [];

    // Convert to Binance kline array format so existing parseKline() works.
    // [openTime, open, high, low, close, volume, closeTime, quoteVol, numTrades, takerBase, takerQuote]
    const out = quotes
      .filter(q => q.open != null && q.close != null && q.high != null && q.low != null)
      .map(q => {
        const openTime = q.date.getTime();
        const closeTime = openTime + intervalMs - 1;
        return [
          openTime,
          String(q.open),
          String(q.high),
          String(q.low),
          String(q.close),
          String(q.volume ?? 0),
          closeTime,
          "0",
          0,
          "0",
          "0",
        ];
      })
      .slice(-limit);

    return NextResponse.json(out, {
      headers: { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Yahoo Finance error: ${msg}` },
      { status: 502 }
    );
  }
}
