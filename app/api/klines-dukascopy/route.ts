import { NextRequest, NextResponse } from "next/server";
import { getHistoricalRates } from "dukascopy-node";

// Map our interval names (Binance-like) → Dukascopy timeframes
const TIMEFRAME_MAP: Record<string, "m1" | "m5" | "m15" | "m30" | "h1" | "h4" | "d1" | "mn1"> = {
  "1m": "m1",
  "5m": "m5",
  "15m": "m15",
  "30m": "m30",
  "1h": "h1",
  "4h": "h4",
  "1d": "d1",
  "1M": "mn1",
};

const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "30m": 1_800_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
  "1M": 30 * 86_400_000,
};

// Whitelist of supported Dukascopy instruments (metals + forex majors)
const ALLOWED_INSTRUMENTS = new Set([
  "xauusd", "xagusd", "xptusd", "xpdusd",
  "eurusd", "gbpusd", "usdjpy", "usdchf", "audusd", "nzdusd", "usdcad",
]);

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const instrument = (searchParams.get("instrument") || "").toLowerCase();
  const interval = searchParams.get("interval");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!instrument || !interval || !from || !to) {
    return NextResponse.json(
      { error: "instrument, interval, from, to are required (from/to are ms timestamps or ISO dates)" },
      { status: 400 }
    );
  }

  if (!ALLOWED_INSTRUMENTS.has(instrument)) {
    return NextResponse.json(
      { error: `Unsupported instrument "${instrument}". Allowed: ${Array.from(ALLOWED_INSTRUMENTS).join(", ")}` },
      { status: 400 }
    );
  }

  const timeframe = TIMEFRAME_MAP[interval];
  if (!timeframe) {
    return NextResponse.json(
      { error: `Unsupported interval "${interval}". Supported: ${Object.keys(TIMEFRAME_MAP).join(", ")}` },
      { status: 400 }
    );
  }

  const fromDate = new Date(isNaN(Number(from)) ? from : Number(from));
  const toDate = new Date(isNaN(Number(to)) ? to : Number(to));
  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
    return NextResponse.json({ error: "Invalid from/to date" }, { status: 400 });
  }
  if (toDate <= fromDate) {
    return NextResponse.json({ error: "`to` must be after `from`" }, { status: 400 });
  }

  const intervalMs = INTERVAL_MS[interval];

  try {
    const raw = (await getHistoricalRates({
      instrument: instrument as Parameters<typeof getHistoricalRates>[0]["instrument"],
      dates: { from: fromDate, to: toDate },
      timeframe,
      format: "json",
      priceType: "bid",
    })) as Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>;

    // Convert to Binance kline array format → reuse parseKline() on client
    const out = raw.map(r => [
      r.timestamp,
      String(r.open),
      String(r.high),
      String(r.low),
      String(r.close),
      String(r.volume ?? 0),
      r.timestamp + intervalMs - 1,
      "0",
      0,
      "0",
      "0",
    ]);

    return NextResponse.json(out, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Dukascopy error: ${msg}` },
      { status: 502 }
    );
  }
}
