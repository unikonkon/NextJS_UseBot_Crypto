# Binance Trading API — เชื่อมต่อกระเป๋า + ส่งสัญญาณซื้อขาย

> **Stack:** Next.js (App Router) · TypeScript · HMAC-SHA256  
> **Updated:** April 2026 — verified against Binance Changelog 2026-03-30

---

## Changelog 2026 — สิ่งที่เปลี่ยนจากเดิม

| วันที่ | การเปลี่ยนแปลง | กระทบโค้ด |
|--------|----------------|-----------|
| **2026-01-15** | Signature ต้อง **percent-encode payload ก่อน sign** ไม่เช่นนั้นได้ `-1022 INVALID_SIGNATURE` | แก้แล้วใน `binanceSign.ts` |
| **2026-02-20** | `/api/v3/userDataStream` ถูกลบแล้ว | ไม่กระทบ (ไม่ได้ใช้) |
| **2026-04-02** | `POST /api/v3/order` weight = **0** เมื่อสำเร็จ (rate limit ผ่อนคลายลง) | อัปเดต note แล้ว |

---

| หมวด | URL |
|------|-----|
| Spot REST API (หลัก) | https://developers.binance.com/docs/binance-spot-api-docs/rest-api |
| Trading Endpoints | https://developers.binance.com/docs/binance-spot-api-docs/rest-api/trading-endpoints |
| Account Endpoints | https://developers.binance.com/docs/binance-spot-api-docs/rest-api/account-endpoints |
| GitHub Source | https://github.com/binance/binance-spot-api-docs |

---

## Step 1 — สร้าง API Key (System Generated / HMAC-SHA256)

1. เข้า Binance → **Profile → API Management**
2. กด **Create API** → ตั้งชื่อ
3. เลือก **System Generated** (ใช้ HMAC symmetric encryption)
4. เปิด Permission: **Enable Spot & Margin Trading**
5. ผูก **IP Whitelist** (แนะนำมาก เพื่อความปลอดภัย)
6. จดเก็บ `API_KEY` และ `SECRET_KEY` ไว้ใน `.env.local`

```env
BINANCE_API_KEY=xxxxxxxxxxxxxxxxxxxx
BINANCE_SECRET_KEY=xxxxxxxxxxxxxxxxxxxx
```

IP Whitelist กรณีที่รัน http://localhost/ ใช้เว็บ https://api.ipify.org/ เพื่อดู ip 
แล้วนำมาใส่ใน IP Whitelist 

> **อย่าเปิดเผย Secret Key ให้ใคร** และห้าม commit ไฟล์ `.env.local` ขึ้น Git โดยเด็ดขาด

---

## Step 2 — Sign Request (HMAC-SHA256)

Endpoint ที่เกี่ยวกับการเทรดทุกตัวต้องการ **SIGNED request** — ต้องแนบ signature ที่สร้างจาก HMAC-SHA256

```typescript
// lib/binanceSign.ts
import crypto from "crypto";

export function signQuery(queryString: string, secret: string): string {
  return crypto
    .createHmac("sha256", secret)
    .update(queryString)
    .digest("hex");
}

export function buildSignedParams(
  params: Record<string, string | number>,
  secret: string
): string {
  const query = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  ).toString();

  const signature = signQuery(query, secret);

  return `${query}&signature=${signature}`;
}
```

---

## Step 3 — Endpoints หลักที่ต้องใช้

| Endpoint | Method | Security | หน้าที่ |
|----------|--------|----------|---------|
| `/api/v3/account` | GET | USER_DATA | ดู Balance กระเป๋า |
| `/api/v3/order` | POST | TRADE | ส่ง Order ซื้อ/ขาย |
| `/api/v3/order` | GET | USER_DATA | ดูสถานะ Order |
| `/api/v3/order` | DELETE | TRADE | ยกเลิก Order |
| `/api/v3/order/test` | POST | TRADE | ทดสอบ Order (ไม่ส่งจริง) |
| `/api/v3/openOrders` | GET | USER_DATA | ดู Open Orders ทั้งหมด |

---

## Step 4 — Next.js API Routes

### 4.1 ดู Balance กระเป๋า

```typescript
// app/api/binance/account/route.ts
import { NextRequest, NextResponse } from "next/server";
import { buildSignedParams } from "@/lib/binanceSign";

const BINANCE_BASE = "https://api.binance.com";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const apiKey = body.apiKey || process.env.BINANCE_API_KEY!;
  const secretKey = body.secretKey || process.env.BINANCE_SECRET_KEY!;
  const base = BINANCE_BASE;

  const params = buildSignedParams(
    { timestamp: Date.now(), recvWindow: 5000 },
    secretKey
  );

  const res = await fetch(`${base}/api/v3/account?${params}`, {
    headers: { "X-MBX-APIKEY": apiKey },
    cache: "no-store",
  });

  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json(
      { error: "Failed to fetch account", details: data },
      { status: res.status }
    );
  }

  const balances = data.balances?.filter(
    (b: { free: string; locked: string }) =>
      parseFloat(b.free) > 0 || parseFloat(b.locked) > 0
  );

  return NextResponse.json({ balances, permissions: data.permissions });
}
```

**Response ตัวอย่าง:**
```json
[
  { "asset": "USDT", "free": "500.00000000", "locked": "0.00000000" },
  { "asset": "BTC",  "free": "0.00150000",  "locked": "0.00000000" }
]
```

---

### 4.2 ส่ง Order ซื้อ/ขาย

```typescript
// app/api/binance/order/route.ts
import { NextRequest, NextResponse } from "next/server";
import { buildSignedParams } from "@/lib/binanceSign";

const BINANCE_BASE = "https://api.binance.com";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { symbol, side, type, quantity, price, testOrder, apiKey, secretKey } = body;

  const key = apiKey || process.env.BINANCE_API_KEY!;
  const secret = secretKey || process.env.BINANCE_SECRET_KEY!;
  const base = BINANCE_BASE;

  const orderParams: Record<string, string | number> = {
    symbol: symbol.toUpperCase(),
    side,
    type,
    quantity,
    timestamp: Date.now(),
    recvWindow: 5000,
  };

  if (type === "LIMIT") {
    orderParams.price = price;
    orderParams.timeInForce = "GTC";
  }

  const signedQuery = buildSignedParams(orderParams, secret);
  const endpoint = testOrder ? "/api/v3/order/test" : "/api/v3/order";

  const res = await fetch(`${base}${endpoint}`, {
    method: "POST",
    headers: {
      "X-MBX-APIKEY": key,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: signedQuery,
  });

  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json(
      { error: "Order failed", details: data },
      { status: res.status }
    );
  }

  return NextResponse.json(data);
}
```

**Response ตัวอย่าง (MARKET BUY):**
```json
{
  "symbol":           "BTCUSDT",
  "orderId":          28,
  "status":           "FILLED",
  "side":             "BUY",
  "type":             "MARKET",
  "origQty":          "0.001",
  "executedQty":      "0.001",
  "cummulativeQuoteQty": "65.123",
  "transactTime":     1712000000000
}
```

---

### 4.3 ดู Open Orders

```typescript
// app/api/binance/order/open/route.ts
import { NextRequest, NextResponse } from "next/server";
import { buildSignedParams } from "@/lib/binanceSign";

const BINANCE_BASE = "https://api.binance.com";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const apiKey = body.apiKey || process.env.BINANCE_API_KEY!;
  const secretKey = body.secretKey || process.env.BINANCE_SECRET_KEY!;
  const base = BINANCE_BASE;

  const queryParams: Record<string, string | number> = {
    timestamp: Date.now(),
    recvWindow: 5000,
  };

  if (body.symbol) {
    queryParams.symbol = body.symbol.toUpperCase();
  }

  const params = buildSignedParams(queryParams, secretKey);

  const res = await fetch(`${base}/api/v3/openOrders?${params}`, {
    headers: { "X-MBX-APIKEY": apiKey },
    cache: "no-store",
  });

  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json(
      { error: "Failed to fetch open orders", details: data },
      { status: res.status }
    );
  }

  return NextResponse.json(data);
}
```

---

### 4.4 ยกเลิก Order

```typescript
// app/api/binance/order/cancel/route.ts
import { NextRequest, NextResponse } from "next/server";
import { buildSignedParams } from "@/lib/binanceSign";

const BINANCE_BASE = "https://api.binance.com";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { symbol, orderId, apiKey, secretKey } = body;

  const key = apiKey || process.env.BINANCE_API_KEY!;
  const secret = secretKey || process.env.BINANCE_SECRET_KEY!;
  const base = BINANCE_BASE;

  const signedQuery = buildSignedParams(
    { symbol: symbol.toUpperCase(), orderId, timestamp: Date.now() },
    secret
  );

  const res = await fetch(`${base}/api/v3/order`, {
    method: "DELETE",
    headers: {
      "X-MBX-APIKEY": key,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: signedQuery,
  });

  const data = await res.json();

  if (!res.ok) {
    return NextResponse.json(
      { error: "Cancel failed", details: data },
      { status: res.status }
    );
  }

  return NextResponse.json(data);
}
```

---

## Step 5 — เชื่อมกับ Strategy Signal

```typescript
// lib/executeSignal.ts

export async function executeSignal(
  symbol:   string,
  signal:   "BUY" | "SELL" | "HOLD",
  quantity: string
) {
  if (signal === "HOLD") return null;

  const res = await fetch("/api/binance/order", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      symbol,
      side:     signal,
      type:     "MARKET",
      quantity,
    }),
  });

  return res.json();
}
```

**ตัวอย่างเรียกใช้กับ Strategy:**
```typescript
import { executeSignal } from "@/lib/executeSignal";

// สมมุติ Strategy ส่ง signal มา
const signal = computeRSI(candles); // "BUY" | "SELL" | "HOLD"

const result = await executeSignal("BTCUSDT", signal, "0.001");
console.log(result);
```

---

## Step 6 — ทดสอบด้วย Test Order

ก่อน live trading ควรทดสอบด้วย `/api/v3/order/test` ก่อนเสมอ — Validate ทุกอย่าง แต่**ไม่ส่ง Order จริง**

```typescript
// ส่ง testOrder: true ใน request body จะใช้ endpoint /api/v3/order/test อัตโนมัติ
const res = await fetch("/api/binance/order", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    symbol: "BTCUSDT",
    side: "BUY",
    type: "MARKET",
    quantity: "0.001",
    testOrder: true,  // ← ทดสอบเท่านั้น ไม่ส่งจริง
  }),
});
// Response: {} หมายถึง Order ถูกต้อง
```

---

## File Structure

```
app/
├── trading/
│   └── Binance/
│       └── page.tsx            ← UI หน้าเทรด (เชื่อมจาก ENV / กรอก Key เอง)
└── api/
    └── binance/
        ├── account/
        │   └── route.ts        ← POST balance
        ├── order/
        │   ├── route.ts        ← POST new order / test order
        │   ├── open/
        │   │   └── route.ts    ← POST open orders
        │   └── cancel/
        │       └── route.ts    ← POST cancel order
        └── klines/
            └── route.ts        ← GET candlestick data

lib/
├── binanceSign.ts              ← HMAC-SHA256 signing utility
└── executeSignal.ts            ← Strategy signal executor
```

---

## สิ่งสำคัญที่ต้องระวัง

| เรื่อง | รายละเอียด |
|--------|-----------|
| **Key Type** | ใช้ **System Generated (HMAC-SHA256)** เท่านั้น เลือกตอนสร้าง API Key บน Binance |
| **recvWindow** | timestamp ที่ส่งต้องห่างจาก Binance server ไม่เกิน ±5000ms |
| **LOT_SIZE** | `quantity` ต้องตรงตาม `minQty` / `stepSize` ของแต่ละ symbol (ดูจาก `/api/v3/exchangeInfo`) |
| **MARKET vs LIMIT** | MARKET ใช้ราคาตลาดทันที / LIMIT ต้องระบุ `price` + `timeInForce` |
| **Rate Limit** | ตั้งแต่ **2026-04-02** `POST /api/v3/order` มี weight = **0** เมื่อสำเร็จ (failed requests ยังถูกคิด weight ปกติ) |
| **IP Whitelist** | ผูก IP Server กับ API Key เสมอ อย่าใช้กับ public IP ที่เปลี่ยนได้ |
| **Test ก่อน** | ใช้ `testOrder: true` หรือ `/api/v3/order/test` validate ก่อน go-live เสมอ |
| **ENV Security** | ไม่ commit `.env.local` ขึ้น Git / ใช้ environment variable จาก hosting provider |

---

## Order Status Reference

| Status | ความหมาย |
|--------|---------|
| `NEW` | Order ถูกรับแล้ว รอ match |
| `PARTIALLY_FILLED` | match บางส่วนแล้ว |
| `FILLED` | match ครบแล้ว |
| `CANCELED` | ถูกยกเลิก |
| `REJECTED` | ถูกปฏิเสธ (เช่น balance ไม่พอ) |
| `EXPIRED` | หมดอายุ (เช่น IOC/FOK ที่ match ไม่ได้) |

---

## Quick Reference

```
Base URL:        https://api.binance.com

Header ที่ต้องใส่ทุก request:
  X-MBX-APIKEY: <your_api_key>

Params ที่ต้องมีทุก SIGNED request:
  timestamp:   Date.now()          ← Unix ms
  recvWindow:  5000                ← ms tolerance (optional, default 5000)
  signature:   HMAC-SHA256(query)  ← ต่อท้ายสุด

UI Page:         /trading/Binance
  - เชื่อมต่อจาก .env.local หรือกรอก API Key + Secret Key จากหน้าบ้าน
  - ดูยอดคงเหลือ, ส่ง Order (Test/Live), ดู Open Orders, ยกเลิก Order
```
