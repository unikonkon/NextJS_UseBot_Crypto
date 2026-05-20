// app/api/forex/route.ts
import { NextRequest, NextResponse } from "next/server";

const TWELVE_BASE = "https://api.twelvedata.com";

// Mapping Binance interval → Twelve Data interval
const INTERVAL_MAP: Record<string, string> = {
  "1m": "1min",  "3m": "3min",  "5m": "5min",
  "15m": "15min", "30m": "30min", "1h": "1h",
  "2h": "2h",   "4h": "4h",   "1d": "1day",
  "1w": "1week", "1M": "1month",
};

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;

  const symbol   = searchParams.get("symbol");   // e.g. "EUR/USD"
  const interval = searchParams.get("interval"); // e.g. "1h"
  const limit    = searchParams.get("limit") || "200";
  const startTime = searchParams.get("startTime"); // ISO string optional
  const endTime   = searchParams.get("endTime");

  if (!symbol || !interval) {
    return NextResponse.json(
      { error: "symbol and interval are required" },
      { status: 400 }
    );
  }

  const tdInterval = INTERVAL_MAP[interval] ?? interval;

  const params = new URLSearchParams({
    symbol:   symbol.toUpperCase(),   // EUR/USD, USD/THB, XAU/USD
    interval: tdInterval,
    outputsize: limit,
    format:   "JSON",
    apikey:   process.env.TWELVE_DATA_API_KEY!,
  });

  if (startTime) params.set("start_date", startTime);
  if (endTime)   params.set("end_date", endTime);

  try {
    const res = await fetch(
      `${TWELVE_BASE}/time_series?${params.toString()}`,
      { next: { revalidate: 0 } }
    );

    if (!res.ok) {
      const errorBody = await res.text();
      return NextResponse.json(
        { error: `Twelve Data API error: ${res.status}`, details: errorBody },
        { status: res.status }
      );
    }

    const data = await res.json();

    // Twelve Data error ส่ง status 200 แต่มี code: 400 ใน body
    if (data.code && data.code !== 200) {
      return NextResponse.json(
        { error: data.message },
        { status: data.code }
      );
    }

    // ── แปลง format ให้เหมือน Binance klines ──────────────────────
    // Binance: [openTime, open, high, low, close, volume, closeTime, ...]
    // Twelve Data: { datetime, open, high, low, close, volume }
    const klines = (data.values as any[]).reverse().map((v) => [
      new Date(v.datetime).getTime(), // openTime (ms)
      v.open,
      v.high,
      v.low,
      v.close,
      v.volume ?? "0",               // forex ไม่มี volume จริง
      new Date(v.datetime).getTime(), // closeTime (ใช้เดียวกันก่อน)
      "0", "0", "0", "0", "0",       // padding ให้ตรง KlineData type
    ]);

    return NextResponse.json(klines, {
      headers: {
        "Cache-Control": "public, s-maxage=5, stale-while-revalidate=10",
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: "Failed to fetch from Twelve Data", details: String(err) },
      { status: 500 }
    );
  }
}