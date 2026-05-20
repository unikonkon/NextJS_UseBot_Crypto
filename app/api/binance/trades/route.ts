import { NextRequest, NextResponse } from "next/server";
import { buildSignedParams } from "@/lib/binanceSign";

const BINANCE_BASE = "https://api.binance.com";

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Binance returned non-JSON (status ${res.status}): ${text.slice(0, 200)}`
    );
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { apiKey, secretKey, symbol, startTime, endTime, limit } = body;

  if (!apiKey || !secretKey) {
    return NextResponse.json(
      { error: "API Key หรือ Secret Key ไม่ได้ตั้งค่า" },
      { status: 400 }
    );
  }

  if (!symbol) {
    return NextResponse.json(
      { error: "กรุณาระบุ Symbol เช่น BTCUSDT" },
      { status: 400 }
    );
  }

  const queryParams: Record<string, string | number> = {
    symbol: symbol.toUpperCase(),
    timestamp: Date.now(),
    recvWindow: 5000,
  };

  if (limit) queryParams.limit = Math.min(Number(limit), 1000);
  if (startTime) queryParams.startTime = startTime;
  if (endTime) queryParams.endTime = endTime;

  const params = buildSignedParams(queryParams, secretKey);

  try {
    const res = await fetch(`${BINANCE_BASE}/api/v3/myTrades?${params}`, {
      headers: { "X-MBX-APIKEY": apiKey },
      cache: "no-store",
    });

    const data = await safeJson(res);

    if (!res.ok) {
      return NextResponse.json(
        { error: "Failed to fetch trades", details: data },
        { status: res.status }
      );
    }

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "เชื่อมต่อ Binance ไม่ได้" },
      { status: 502 }
    );
  }
}
