# Use Crypto Trading Indicator & Live Trading Platform

ระบบวิเคราะห์สัญญาณซื้อขายเหรียญคริปโต พร้อม Backtest และ Live Trading ผ่าน Binance API

สร้างด้วย **Next.js 16** + **React 19** + **TypeScript** + **Tailwind CSS 4** + **TradingView Lightweight Charts**

---

## สารบัญ

- [ภาพรวมระบบ](#ภาพรวมระบบ)
- [หน้าเว็บและการทำงาน](#หน้าเว็บและการทำงาน)
- [API Routes](#api-routes)
- [Technical Indicators (14 ตัว)](#technical-indicators)
- [Trading Strategies (10 กลยุทธ์)](#trading-strategies)
- [Backtest Engine](#backtest-engine)
- [โครงสร้างโปรเจค](#โครงสร้างโปรเจค)
- [Data Flow](#data-flow)
- [เทคโนโลยีที่ใช้](#เทคโนโลยีที่ใช้)
- [การติดตั้งและรัน](#การติดตั้งและรัน)
- [การ Deploy บน Vercel](#การ-deploy-บน-vercel)
- [หมายเหตุ](#หมายเหตุ)

---

## ภาพรวมระบบ

```
┌───────────────────────────────────────────────────────────────┐
│                     Next.js 16 Application                    │
│                                                               │
│  ┌─────────────┐  ┌──────────────────┐  ┌──────────────────┐ │
│  │  /klines    │  │ /trading/Binance │  │ /trading/        │ │
│  │  วิเคราะห์   │  │  เชื่อมต่อ Binance │  │  LiveTrading     │ │
│  │  + Backtest │  │  + สั่ง Order     │  │  เทรดอัตโนมัติ    │ │
│  └──────┬──────┘  └────────┬─────────┘  └────────┬─────────┘ │
│         │                  │                      │           │
│         ▼                  ▼                      ▼           │
│  ┌──────────────────────────────────────────────────────────┐ │
│  │                    API Routes (/api)                     │ │
│  │  klines │ binance/account │ binance/order │ server-ip    │ │
│  └──────────────────────┬───────────────────────────────────┘ │
└─────────────────────────┼─────────────────────────────────────┘
                          ▼
              ┌───────────────────────┐
              │    External APIs      │
              │  - Binance REST API   │
              │  - Twelve Data (Forex)│
              │  - ipify (IP Check)   │
              └───────────────────────┘
```

---

## หน้าเว็บและการทำงาน

### 1. `/klines` — วิเคราะห์ Indicator + Backtest

หน้าหลักสำหรับวิเคราะห์เหรียญคริปโต

- **เลือกเหรียญ**: 20 เหรียญยอดนิยม (BTCUSDT, ETHUSDT, SOLUSDT, ...)
- **เลือกช่วงเวลา**: 1s, 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M
- **เลือก Strategy**: 10 กลยุทธ์ที่รองรับ พร้อมปรับ Parameter ได้
- **ดึงข้อมูล**: จาก Binance API หรือโหลดจาก CSV ที่บันทึกไว้
- **แสดงกราฟ**: TradingView Lightweight Charts พร้อม
  - Candlestick + Volume
  - Indicator Overlays (VWAP, CDC EMA, Supertrend, SMC Order Blocks, S/R, Trendlines, UT Bot)
  - Sub-charts (RSI, MACD, Squeeze Momentum)
  - Buy/Sell Markers จาก Backtest
- **ผลลัพธ์ Backtest**: Win Rate, Total PnL%, Sharpe Ratio, Max Drawdown, Equity Curve

### 2. `/trading/Binance` — เชื่อมต่อ Binance + สั่ง Order

หน้าจัดการกระเป๋า Binance

- **เชื่อมต่อ**: กรอก API Key + Secret Key เพื่อเชื่อมต่อบัญชี
- **ดู IP**:
  - **Server IP** — IP ที่ Binance เห็นจริง (ใช้ตั้งค่าที่ Binance API Management)
  - **Client IP** — IP ของเบราว์เซอร์ (ไม่เกี่ยวกับ Binance)
- **คำแนะนำ**: ขั้นตอนการสร้าง API Key จาก Binance พร้อมรูปประกอบ
- **Wallet**: แสดงยอดเหรียญทั้งหมดในบัญชี
- **ส่ง Order**: Market / Limit, BUY / SELL พร้อม Test Mode
- **Open Orders**: ดูและยกเลิก Orders ที่เปิดอยู่
- **ปุ่ม Live Trading**: ส่ง API Key ผ่าน URL ไปหน้า Live Trading

### 3. `/trading/LiveTrading` — เทรดอัตโนมัติ

หน้าสำหรับ Live Trading แบบ Real-time

- **การทำงาน**: ดึงข้อมูลราคาตาม Polling ที่ตั้งไว้ → คำนวณ Indicator → ตรวจสัญญาณ → ส่งคำสั่งซื้อขายอัตโนมัติ
- **ตั้งค่า**:
  - เหรียญ, ช่วงเวลา, Strategy
  - Polling interval (5 วินาที ถึง 1 วัน)
  - จำนวน USDT ที่ต้องการใช้ (แสดงยอด USDT คงเหลือ)
  - โหมด Test (ไม่ส่ง Order จริง) หรือ Real (ส่ง Order จริง)
- **สถานะ**: แสดง Polling interval, สัญญาณล่าสุด (BUY/SELL/HOLD), Position, Unrealized PnL
- **กราฟ**: แสดง Chart เรียลไทม์พร้อม Indicator
- **ประวัติ**: ตาราง Order ที่ส่ง (เวลา, เหรียญ, Side, ราคา, USDT, จำนวนเหรียญ, Strategy, สถานะ)
- **คำเตือน**:
  - API Key ไม่ได้บันทึกไว้ — รีเฟรชหน้าจอจะหาย
  - เน็ตหลุด — ระบบจะหยุดทำงานทันที
  - ประวัติเทรดเก็บใน Memory เท่านั้น

---

## API Routes

| Route | Method | คำอธิบาย | External API |
|-------|--------|----------|-------------|
| `/api/klines` | GET | ดึง Candlestick data | `https://api.binance.com/api/v3/klines` |
| `/api/binance/account` | POST | ดึงยอดเงิน + Permissions | `https://api.binance.com/api/v3/account` |
| `/api/binance/order` | POST | ส่งคำสั่งซื้อขาย | `https://api.binance.com/api/v3/order` |
| `/api/binance/order/open` | POST | ดู Open Orders | `https://api.binance.com/api/v3/openOrders` |
| `/api/binance/order/cancel` | POST | ยกเลิก Order | `https://api.binance.com/api/v3/order` (DELETE) |
| `/api/server-ip` | GET | ดึง Server IP | `https://api.ipify.org?format=json` |
| `/api/forex` | GET | ดึงข้อมูล Forex | `https://api.twelvedata.com/time_series` |
| `/api/dataShowUI` | GET | จัดการไฟล์ CSV | Local filesystem |

### การ Authentication กับ Binance

ทุก API route ที่เรียก Binance ใช้ **HMAC-SHA256 Signature**:
1. Client ส่ง `apiKey` + `secretKey` ใน request body
2. Server สร้าง signed query string ด้วย `buildSignedParams()` (เพิ่ม `timestamp` + `recvWindow: 5000`)
3. ส่ง request ไป Binance พร้อม Header `X-MBX-APIKEY`

**ไม่มีการเก็บ Key ไว้ในเซิร์ฟเวอร์** — ต้องส่ง Key มาทุกครั้ง

---

### 1. `GET /api/klines` — ดึง Candlestick Data

ดึงข้อมูลแท่งเทียนจาก Binance

**Query Parameters:**

| Parameter | Type | Required | Default | คำอธิบาย |
|-----------|------|----------|---------|----------|
| `symbol` | string | ใช่ | - | ชื่อเหรียญ เช่น `BTCUSDT` |
| `interval` | string | ใช่ | - | ช่วงเวลา เช่น `1m`, `5m`, `1h`, `1d` |
| `limit` | string | ไม่ | `"200"` | จำนวนแท่งเทียน |
| `startTime` | string | ไม่ | - | เวลาเริ่มต้น (milliseconds) |
| `endTime` | string | ไม่ | - | เวลาสิ้นสุด (milliseconds) |

**ตัวอย่างการเรียก:**

```
GET /api/klines?symbol=BTCUSDT&interval=1h&limit=500
GET /api/klines?symbol=ETHUSDT&interval=15m
```

**Response สำเร็จ (200):**

```json
[
  [1710000000000, "65000.00", "65500.00", "64800.00", "65200.00", "1234.56", 1710003599999, "80234567.89", 15000, "617.28", "40117283.94"],
  ...
]
```

แต่ละ array คือ: `[openTime, open, high, low, close, volume, closeTime, quoteAssetVolume, numberOfTrades, takerBuyBaseVolume, takerBuyQuoteVolume]`

**Response Error:**

```json
// 400 — ไม่ส่ง parameter
{ "error": "symbol and interval are required" }

// 500 — เชื่อมต่อ Binance ไม่ได้
{ "error": "Failed to fetch from Binance", "details": "..." }
```

**Cache:** `Cache-Control: public, s-maxage=5, stale-while-revalidate=10`

---

### 2. `POST /api/binance/account` — ดึงยอดเงิน

ดึงข้อมูลบัญชี Binance (ยอดเงิน + สิทธิ์)

**Request Body:**

| Parameter | Type | Required | คำอธิบาย |
|-----------|------|----------|----------|
| `apiKey` | string | ใช่ | Binance API Key |
| `secretKey` | string | ใช่ | Binance Secret Key |

**ตัวอย่างการเรียก:**

```bash
curl -X POST /api/binance/account \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "xxx", "secretKey": "yyy"}'
```

**Response สำเร็จ (200):**

```json
{
  "balances": [
    { "asset": "USDT", "free": "1500.50", "locked": "0.00" },
    { "asset": "BTC", "free": "0.05", "locked": "0.00" }
  ],
  "permissions": ["SPOT", "MARGIN"]
}
```

แสดงเฉพาะเหรียญที่มียอด > 0

**Response Error:**

```json
// 400 — ไม่ส่ง Key
{ "error": "API Key หรือ Secret Key ไม่ได้ตั้งค่า" }

// 4xx — Binance reject
{ "error": "Failed to fetch account", "details": { "code": -2015, "msg": "Invalid API-key, IP, or permissions for action." } }

// 502 — เชื่อมต่อไม่ได้
{ "error": "เชื่อมต่อ Binance ไม่ได้" }
```

---

### 3. `POST /api/binance/order` — ส่งคำสั่งซื้อขาย

ส่ง Order ไปยัง Binance (รองรับ MARKET / LIMIT และ Test Mode)

**Request Body:**

| Parameter | Type | Required | คำอธิบาย |
|-----------|------|----------|----------|
| `apiKey` | string | ใช่ | Binance API Key |
| `secretKey` | string | ใช่ | Binance Secret Key |
| `symbol` | string | ใช่ | เหรียญ เช่น `BTCUSDT` |
| `side` | string | ใช่ | `"BUY"` หรือ `"SELL"` |
| `type` | string | ใช่ | `"MARKET"` หรือ `"LIMIT"` |
| `quantity` | string | ไม่* | จำนวนเหรียญ เช่น `"0.001"` |
| `quoteOrderQty` | string | ไม่* | จำนวน USDT เช่น `"100"` |
| `price` | string | ถ้า LIMIT | ราคาที่ต้องการ |
| `testOrder` | boolean | ไม่ | `true` = ทดสอบ (ไม่ส่ง Order จริง) |

*สำหรับ MARKET order: ส่ง `quoteOrderQty` (จำนวน USDT) หรือ `quantity` (จำนวนเหรียญ) อย่างใดอย่างหนึ่ง

**Binance Endpoint:**
- Test Mode: `POST https://api.binance.com/api/v3/order/test`
- Real Mode: `POST https://api.binance.com/api/v3/order`

**ตัวอย่างการเรียก:**

```bash
# MARKET order ด้วย USDT (ซื้อ BTC ด้วย 100 USDT)
curl -X POST /api/binance/order \
  -H "Content-Type: application/json" \
  -d '{
    "apiKey": "xxx", "secretKey": "yyy",
    "symbol": "BTCUSDT", "side": "BUY", "type": "MARKET",
    "quoteOrderQty": "100", "testOrder": true
  }'

# LIMIT order (ขาย 0.001 BTC ที่ราคา 70000)
curl -X POST /api/binance/order \
  -H "Content-Type: application/json" \
  -d '{
    "apiKey": "xxx", "secretKey": "yyy",
    "symbol": "BTCUSDT", "side": "SELL", "type": "LIMIT",
    "quantity": "0.001", "price": "70000"
  }'
```

**Response สำเร็จ (200):**

```json
{
  "symbol": "BTCUSDT",
  "orderId": 123456789,
  "status": "FILLED",
  "side": "BUY",
  "type": "MARKET",
  "origQty": "0.00150",
  "executedQty": "0.00150",
  "cummulativeQuoteQty": "100.00"
}
```

Test Mode สำเร็จจะตอบ `{}` (object ว่าง)

**Response Error:**

```json
// 400 — ไม่ส่ง Key
{ "error": "API Key หรือ Secret Key ไม่ได้ตั้งค่า" }

// 4xx — Order ล้มเหลว
{ "error": "Order failed", "details": { "code": -1013, "msg": "Filter failure: LOT_SIZE" } }

// 502 — เชื่อมต่อไม่ได้
{ "error": "เชื่อมต่อ Binance ไม่ได้" }
```

**หมายเหตุ:** LIMIT order จะตั้ง `timeInForce: "GTC"` (Good-Til-Canceled) อัตโนมัติ

---

### 4. `POST /api/binance/order/open` — ดู Open Orders

ดึง Orders ที่เปิดอยู่

**Request Body:**

| Parameter | Type | Required | คำอธิบาย |
|-----------|------|----------|----------|
| `apiKey` | string | ใช่ | Binance API Key |
| `secretKey` | string | ใช่ | Binance Secret Key |
| `symbol` | string | ไม่ | กรองเฉพาะเหรียญนี้ |

**ตัวอย่างการเรียก:**

```bash
curl -X POST /api/binance/order/open \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "xxx", "secretKey": "yyy", "symbol": "BTCUSDT"}'
```

**Response สำเร็จ (200):**

```json
[
  {
    "symbol": "BTCUSDT",
    "orderId": 123456789,
    "side": "BUY",
    "type": "LIMIT",
    "price": "60000.00",
    "origQty": "0.001",
    "status": "NEW",
    "time": 1710000000000
  }
]
```

---

### 5. `POST /api/binance/order/cancel` — ยกเลิก Order

ยกเลิก Order ที่เปิดอยู่

**Request Body:**

| Parameter | Type | Required | คำอธิบาย |
|-----------|------|----------|----------|
| `apiKey` | string | ใช่ | Binance API Key |
| `secretKey` | string | ใช่ | Binance Secret Key |
| `symbol` | string | ใช่ | เหรียญ เช่น `BTCUSDT` |
| `orderId` | number | ใช่ | Order ID ที่ต้องการยกเลิก |

**Binance Endpoint:** `DELETE https://api.binance.com/api/v3/order`

**ตัวอย่างการเรียก:**

```bash
curl -X POST /api/binance/order/cancel \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "xxx", "secretKey": "yyy", "symbol": "BTCUSDT", "orderId": 123456789}'
```

**Response สำเร็จ (200):**

```json
{
  "symbol": "BTCUSDT",
  "orderId": 123456789,
  "status": "CANCELED"
}
```

---

### 6. `GET /api/server-ip` — ดึง Server IP

ดึง IP ของ Vercel Serverless Function (สำหรับตั้งค่า Binance IP Whitelist)

**ไม่ต้องส่ง Parameter**

**ตัวอย่างการเรียก:**

```
GET /api/server-ip
```

**Response สำเร็จ (200):**

```json
{
  "serverIp": "13.250.xxx.xxx",
  "note": "นี่คือ IP ของ Vercel Server — ใช้ IP นี้ตั้งค่าที่ Binance API Management"
}
```

---

### 7. `GET /api/forex` — ดึงข้อมูล Forex

ดึงข้อมูลราคา Forex จาก Twelve Data API แล้วแปลงเป็นรูปแบบ Binance Kline

**Query Parameters:**

| Parameter | Type | Required | Default | คำอธิบาย |
|-----------|------|----------|---------|----------|
| `symbol` | string | ใช่ | - | คู่เงิน เช่น `EUR/USD`, `XAU/USD`, `USD/THB` |
| `interval` | string | ใช่ | - | ช่วงเวลา เช่น `1m`, `5m`, `1h`, `1d` |
| `limit` | string | ไม่ | `"200"` | จำนวนแท่งเทียน |
| `startTime` | string | ไม่ | - | เวลาเริ่มต้น (ISO format) |
| `endTime` | string | ไม่ | - | เวลาสิ้นสุด (ISO format) |

**Interval Mapping (ระบบแปลงอัตโนมัติ):**

| ส่งมา | แปลงเป็น (Twelve Data) |
|-------|----------------------|
| `1m` | `1min` |
| `3m` | `3min` |
| `5m` | `5min` |
| `15m` | `15min` |
| `30m` | `30min` |
| `1h` | `1h` |
| `2h` | `2h` |
| `4h` | `4h` |
| `1d` | `1day` |
| `1w` | `1week` |
| `1M` | `1month` |

**ตัวอย่างการเรียก:**

```
GET /api/forex?symbol=EUR/USD&interval=1h&limit=100
GET /api/forex?symbol=XAU/USD&interval=1d
```

**Response สำเร็จ (200):**

ข้อมูลถูกแปลงเป็นรูปแบบเดียวกับ Binance Kline:

```json
[
  [1710000000000, "1.0850", "1.0870", "1.0840", "1.0860", "0", 1710003599999, "0", 0, "0", "0"],
  ...
]
```

**หมายเหตุ:** Forex ไม่มี volume จริง → ค่า volume จะเป็น `"0"`

**ต้องการ ENV:** `TWELVE_DATA_API_KEY` ใน `.env.local`

---

### 8. `GET /api/dataShowUI` — จัดการไฟล์ CSV

จัดการไฟล์ CSV ในโฟลเดอร์ `app/getData/data/dataShowUI/`

**โหมดที่ 1 — ดูรายชื่อไฟล์ (ไม่ส่ง parameter):**

```
GET /api/dataShowUI
```

```json
["BTCUSDT_1h_2024.csv", "ETHUSDT_4h_2024.csv"]
```

**โหมดที่ 2 — อ่านไฟล์ CSV:**

```
GET /api/dataShowUI?file=BTCUSDT_1h_2024.csv
```

ตอบกลับเป็น plain text CSV:
```
Content-Type: text/csv; charset=utf-8

openTime,open,high,low,close,volume,...
1710000000000,65000.00,65500.00,...
```

**Security:** ใช้ `path.basename()` ป้องกัน directory traversal

---

## Technical Indicators

ทั้งหมดเขียนด้วย TypeScript ล้วน (ไม่ใช้ library ภายนอก) แปลงมาจาก PineScript

| # | Indicator | คำอธิบาย | ไฟล์ |
|---|-----------|----------|------|
| 1 | **SMA** | Simple Moving Average | `lib/indicators.ts` |
| 2 | **EMA** | Exponential Moving Average | `lib/indicators.ts` |
| 3 | **RSI** | Relative Strength Index (default 14) | `lib/indicators.ts` |
| 4 | **ATR** | Average True Range | `lib/indicators.ts` |
| 5 | **OBV** | On-Balance Volume | `lib/indicators.ts` |
| 6 | **VWAP** | Volume Weighted Average Price | `lib/indicators.ts` |
| 7 | **CDC ActionZone V3** | EMA Crossover Zones (6 สี) | `lib/indicators.ts` |
| 8 | **CM MACD Ultimate MTF** | Enhanced MACD 4-Color Histogram | `lib/indicators.ts` |
| 9 | **Supertrend** | ATR-based Trend Follower | `lib/indicators.ts` |
| 10 | **Squeeze Momentum** | BB + KC Squeeze Detector [LazyBear] | `lib/indicators.ts` |
| 11 | **Smart Money Concepts** | BOS/CHoCH, Order Blocks, FVG [LuxAlgo] | `lib/indicators.ts` |
| 12 | **Support & Resistance** | Pivot S/R + Volume Confirmation | `lib/indicators.ts` |
| 13 | **Trendlines** | Dynamic Trendline Detection [LuxAlgo] | `lib/indicators.ts` |
| 14 | **UT Bot Alerts** | ATR Trailing Stop System | `lib/indicators.ts` |

ใช้ `computeAll(klines)` เพื่อคำนวณทุก Indicator พร้อมกัน → ได้ `AllIndicators` object

---

## Trading Strategies

แต่ละ Strategy มีสัญญาณ BUY / SELL / HOLD

| # | Strategy | สัญญาณซื้อ | สัญญาณขาย |
|---|----------|-----------|-----------|
| 1 | **RSI Overbought/Oversold** | RSI < 30 | RSI > 70 |
| 2 | **CDC ActionZone V3** | แท่งเขียวแรก (หลังไม่ใช่เขียว) | แท่งแดงแรก (หลังไม่ใช่แดง) |
| 3 | **Smart Money Concepts** | CHoCH/BOS ขาขึ้น (โซนส่วนลด) | CHoCH/BOS ขาลง (โซนพรีเมียม) |
| 4 | **CM MACD Ultimate** | MACD ตัดขึ้นเหนือ Signal | MACD ตัดลงใต้ Signal |
| 5 | **Supertrend** | เทรนด์เปลี่ยนเป็นขาขึ้น | เทรนด์เปลี่ยนเป็นขาลง |
| 6 | **Squeeze Momentum** | Momentum ข้ามเหนือ 0 | Momentum ข้ามใต้ 0 |
| 7 | **MSB & Order Block** | Bullish MSB + Order Block | Bearish MSB + Order Block |
| 8 | **Support & Resistance** | ทะลุแนวต้าน + Volume ยืนยัน | หลุดแนวรับ + Volume ยืนยัน |
| 9 | **Trendlines with Breaks** | ทะลุเส้นแนวต้าน | หลุดเส้นแนวรับ |
| 10 | **UT Bot Alerts** | ราคาข้ามขึ้นเหนือ Trailing Stop | ราคาข้ามลงใต้ Trailing Stop |

---

## Backtest Engine

ระบบจำลองการเทรดย้อนหลัง (`lib/backtest.ts`)

### ขั้นตอนการทำงาน

```
1. รับ KlineData[] + StrategyId + Params
   ↓
2. คำนวณ Indicators ด้วย computeAll()
   ↓
3. สร้าง Signal Array (BUY/SELL/HOLD ทุกแท่ง)
   ↓
4. จำลองการเทรด
   - BUY signal → เปิด Position
   - SELL signal → ปิด Position
   - คิดค่าธรรมเนียม 0.1% ต่อรอบ (เข้า + ออก)
   ↓
5. คำนวณผลลัพธ์
```

### ผลลัพธ์ที่ได้ (BacktestResult)

| Metric | คำอธิบาย |
|--------|----------|
| `totalPnlPct` | กำไร/ขาดทุนรวม (%) |
| `winRate` | อัตราชนะ (%) |
| `wins` / `losses` | จำนวนรอบชนะ / แพ้ |
| `totalTrades` | จำนวนรอบเทรดทั้งหมด |
| `maxDrawdownPct` | Drawdown สูงสุด (%) |
| `sharpeRatio` | Sharpe Ratio |
| `profitFactor` | Profit Factor (กำไรรวม / ขาดทุนรวม) |
| `avgWinPct` / `avgLossPct` | กำไรเฉลี่ย / ขาดทุนเฉลี่ย ต่อรอบ |
| `avgBarsHeld` | จำนวนแท่งเฉลี่ยที่ถือ |
| `equityCurve` | Equity Curve (กำไรสะสมทุกแท่ง) |
| `buyAndHoldPct` | ผลตอบแทนถ้าถือเฉยๆ (เปรียบเทียบ) |

---

## โครงสร้างโปรเจค

```
├── app/
│   ├── api/
│   │   ├── binance/
│   │   │   ├── account/route.ts       ดึงยอดเงิน
│   │   │   └── order/
│   │   │       ├── route.ts           ส่ง Order
│   │   │       ├── open/route.ts      ดู Open Orders
│   │   │       └── cancel/route.ts    ยกเลิก Order
│   │   ├── klines/route.ts            ดึง Kline data
│   │   ├── forex/route.ts             ดึง Forex data
│   │   ├── server-ip/route.ts         ดึง Server IP
│   │   └── dataShowUI/route.ts        จัดการ CSV
│   ├── klines/
│   │   ├── page.tsx                   หน้าวิเคราะห์ + Backtest
│   │   └── ui/graph.tsx               TradingView Chart Component
│   ├── trading/
│   │   ├── Binance/page.tsx           หน้าเชื่อมต่อ Binance
│   │   └── LiveTrading/page.tsx       หน้า Live Trading
│   ├── layout.tsx                     Root Layout + Theme
│   └── page.tsx                       Redirect → /klines
├── lib/
│   ├── indicators.ts                  Indicator ทั้ง 14 ตัว + computeAll()
│   ├── backtest.ts                    Backtest Engine + 10 Strategies
│   ├── binanceSign.ts                 HMAC-SHA256 Signing
│   ├── executeSignal.ts               Order Execution Helper
│   ├── types/kline.ts                 TypeScript Types
│   ├── utils.ts                       Tailwind cn() Utility
│   └── forex/positionCalculator.ts    Forex Position Sizing
├── components/
│   ├── ui/                            shadcn/ui Components
│   ├── theme-provider.tsx             Dark/Light Theme
│   └── theme-toggle.tsx               Theme Switcher
├── next.config.ts                     Next.js Config
├── vercel.json                        Vercel Deploy (region: sin1)
├── package.json                       Dependencies
└── tsconfig.json                      TypeScript Config
```

---

## Data Flow

### Flow 1: วิเคราะห์ + Backtest

```
ผู้ใช้เลือกเหรียญ + ช่วงเวลา + Strategy
        │
        ▼
GET /api/klines?symbol=BTCUSDT&interval=1h&limit=500
        │
        ▼
BinanceKlineRaw[] → parseKline() → KlineData[]
        │
        ▼
computeAll(klines) → AllIndicators
        │
        ▼
runBacktest(klines, strategyId, params)
        │
        ▼
BacktestResult { trades, winRate, totalPnlPct, equityCurve, ... }
        │
        ▼
KlineGraph แสดง Candlestick + Indicators + Trade Markers
```

### Flow 2: Live Trading

```
ผู้ใช้กรอก API Key → เลือกเหรียญ + Strategy + USDT → กด Start
        │
        ▼
    ┌── Polling Loop (ทุก N วินาที) ──┐
    │                                  │
    │  GET /api/klines (200 แท่ง)      │
    │         │                        │
    │         ▼                        │
    │  computeAll() → ดูสัญญาณแท่งล่าสุด │
    │         │                        │
    │    BUY? ──→ POST /api/binance/order (BUY)
    │    SELL? ─→ POST /api/binance/order (SELL)
    │    HOLD? ─→ ไม่ทำอะไร             │
    │         │                        │
    │  บันทึกลง Trade History           │
    │  อัพเดทยอด USDT                   │
    │                                  │
    └──────── วนรอบ ──────────────────┘
```

---

## เทคโนโลยีที่ใช้

### Frontend
| เทคโนโลยี | เวอร์ชัน | ใช้ทำอะไร |
|-----------|---------|----------|
| Next.js | 16.1.6 | Framework หลัก (App Router) |
| React | 19.2.3 | UI Library |
| TypeScript | 5.x | Type Safety |
| Tailwind CSS | 4.x | Styling |
| shadcn/ui | - | UI Components (Button, Card, Table, Select, ...) |
| Lightweight Charts | 5.1.0 | TradingView Charting |
| Phosphor Icons | 2.1.10 | Icon Library |
| next-themes | 0.4.6 | Dark/Light Mode |

### Backend
| เทคโนโลยี | ใช้ทำอะไร |
|-----------|----------|
| Next.js API Routes | Proxy ไปยัง Binance / Twelve Data |
| HMAC-SHA256 | Signing Binance API Requests |
| Vercel Serverless | Hosting (Singapore Region) |

### External APIs
| API | ใช้ทำอะไร |
|-----|----------|
| Binance REST API | ดึงราคา, ดูยอดเงิน, ส่ง Order |
| Twelve Data API | ดึงข้อมูล Forex |
| ipify.org | ตรวจ Server IP |

---

## การติดตั้งและรัน

### Prerequisites

- Node.js 18+
- npm หรือ yarn

### ติดตั้ง

```bash
git clone <repository-url>
cd NextJS_Bot_Crypto_trading-indicator
npm install
```

### รัน Development

```bash
npm run dev
```

เปิด [http://localhost:3000](http://localhost:3000)

### Build

```bash
npm run build
npm start
```

### Environment Variables (ไม่จำเป็น)

สร้างไฟล์ `.env.local`:

```env
# Forex data (ถ้าต้องการใช้ Forex)
TWELVE_DATA_API_KEY=your_twelve_data_api_key
```

**หมายเหตุ**: Binance API Key ไม่ได้เก็บใน env แล้ว — ผู้ใช้กรอกผ่านหน้าเว็บทุกครั้ง

---

## การ Deploy บน Vercel

### ตั้งค่า

- **Region**: Singapore (`sin1`) — ตั้งใน `vercel.json` เพื่อให้ Binance API ใช้งานได้ (Binance บล็อก US region)

### ขั้นตอน

1. Push code ไปยัง GitHub
2. เชื่อมต่อ Repository กับ Vercel
3. Deploy

### IP Whitelist

- ไปหน้า `/trading/Binance` → กดปุ่ม "ดู IP"
- คัดลอก **Server IP** (IP ของ Vercel Server)
- ตั้งค่าที่ [Binance API Management](https://www.binance.com/en/my/settings/api-management) → ใส่ Server IP
- **หมายเหตุ**: Vercel Serverless อาจเปลี่ยน IP เมื่อ deploy ใหม่ — แนะนำตั้ง Unrestricted ถ้าไม่ต้องการแก้ IP ซ้ำ

---

## หมายเหตุ

### ความปลอดภัย
- API Key/Secret Key ไม่ได้เก็บไว้ในเซิร์ฟเวอร์หรือ localStorage
- Key ส่งผ่าน URL (searchParams) ไปหน้า Live Trading — รีเฟรชแล้วหาย
- Binance API Signing ทำฝั่ง Server เท่านั้น (Key ไม่โดน expose ในฝั่ง Client)

### ข้อจำกัด
- ไม่มีระบบ Authentication / Login
- ไม่มีฐานข้อมูล — ข้อมูลทั้งหมดอยู่ใน Memory (หายเมื่อรีเฟรช)
- ใช้ Binance REST API (ไม่มี WebSocket) — ดึงข้อมูลแบบ Polling
- Indicator ทั้งหมดเขียนเอง (ไม่ใช้ ta-lib หรือ library ภายนอก)

### Performance
- Indicator คำนวณ O(n) ต่อตัว
- Chart รองรับ 1000+ แท่งเทียน
- Kline data มี Cache 5 วินาที
