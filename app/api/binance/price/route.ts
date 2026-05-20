import { NextRequest, NextResponse } from "next/server";

const BINANCE_BASE = "https://api.binance.com";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol");

  if (!symbol) {
    return NextResponse.json(
      { error: "symbol is required" },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(
      `${BINANCE_BASE}/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`,
      { cache: "no-store" }
    );
    const data = await res.json();

    if (!res.ok) {
      return NextResponse.json(
        { error: data.msg || "Failed to fetch price", details: data },
        { status: res.status }
      );
    }

    return NextResponse.json({ symbol: data.symbol, price: data.price });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "เชื่อมต่อ Binance ไม่ได้" },
      { status: 502 }
    );
  }
}
