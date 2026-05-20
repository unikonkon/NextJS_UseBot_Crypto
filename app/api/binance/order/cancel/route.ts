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
  const body = await request.json();
  const { symbol, orderId, apiKey, secretKey } = body;

  const key = apiKey;
  const secret = secretKey;

  if (!key || !secret) {
    return NextResponse.json(
      { error: "API Key หรือ Secret Key ไม่ได้ตั้งค่า" },
      { status: 400 }
    );
  }

  const signedQuery = buildSignedParams(
    { symbol: symbol.toUpperCase(), orderId, timestamp: Date.now() },
    secret
  );

  try {
    const res = await fetch(`${BINANCE_BASE}/api/v3/order`, {
      method: "DELETE",
      headers: {
        "X-MBX-APIKEY": key,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: signedQuery,
    });

    const data = await safeJson(res);

    if (!res.ok) {
      return NextResponse.json(
        { error: "Cancel failed", details: data },
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
