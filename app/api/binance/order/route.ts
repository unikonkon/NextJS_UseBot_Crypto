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
  const { symbol, side, type, quantity, quoteOrderQty, price, testOrder, apiKey, secretKey } = body;

  const key = apiKey;
  const secret = secretKey;

  if (!key || !secret) {
    return NextResponse.json(
      { error: "API Key หรือ Secret Key ไม่ได้ตั้งค่า" },
      { status: 400 }
    );
  }

  const orderParams: Record<string, string | number> = {
    symbol: symbol.toUpperCase(),
    side,
    type,
    timestamp: Date.now(),
    recvWindow: 5000,
  };

  // MARKET order: ใช้ quoteOrderQty (จำนวน USDT) หรือ quantity (จำนวนเหรียญ)
  if (quoteOrderQty) {
    orderParams.quoteOrderQty = quoteOrderQty;
  } else if (quantity) {
    orderParams.quantity = quantity;
  }

  if (type === "LIMIT") {
    orderParams.price = price;
    orderParams.timeInForce = "GTC";
    if (quantity) orderParams.quantity = quantity;
  }

  const signedQuery = buildSignedParams(orderParams, secret);
  const endpoint = testOrder ? "/api/v3/order/test" : "/api/v3/order";

  try {
    const res = await fetch(`${BINANCE_BASE}${endpoint}`, {
      method: "POST",
      headers: {
        "X-MBX-APIKEY": key,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: signedQuery,
    });

    const data = await safeJson(res);

    if (!res.ok) {
      // ถ้าเป็น LOT_SIZE filter failure ลองดึง exchangeInfo มาแนบให้ FE แสดงค่า min/step
      if (
        data?.code === -1013 &&
        typeof data?.msg === "string" &&
        data.msg.includes("LOT_SIZE")
      ) {
        try {
          const infoRes = await fetch(
            `${BINANCE_BASE}/api/v3/exchangeInfo?symbol=${encodeURIComponent(
              orderParams.symbol as string
            )}`,
            { cache: "no-store" }
          );
          const infoData = await infoRes.json();
          const lotFilter = infoData?.symbols?.[0]?.filters?.find(
            (f: { filterType: string }) => f.filterType === "LOT_SIZE"
          );
          if (lotFilter) {
            data.filter = {
              minQty: lotFilter.minQty,
              maxQty: lotFilter.maxQty,
              stepSize: lotFilter.stepSize,
            };
          }
        } catch {
          // เงียบไว้ — ไม่อยากบดบัง error เดิม
        }
      }

      return NextResponse.json(
        { error: "Order failed", details: data },
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
