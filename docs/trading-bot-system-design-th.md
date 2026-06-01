# เอกสารออกแบบระบบ: Crypto Trading Bot (Binance Spot) บน VPS ไทย Static IP

> เวอร์ชัน 1.0 — มิ.ย. 2026
> โจทย์: รัน Node.js เป็น API ดึงราคาเหรียญจาก `https://api.binance.com` มาคำนวณ indicator ที่เขียนเอง เก็บข้อมูลแบบ polling ต่อเนื่อง และเมื่อมีสัญญาณ → ส่งคำสั่งเทรด **Spot จริง** ออกจาก **IP คงที่ (fixed IP)** ที่ whitelist ไว้บน Binance
> สเปกที่ตกลง: เทรดจริง Spot · 1–10 คู่ · งบ hosting+DB **< 1,000 บาท/เดือน** · ให้แนะนำผู้ให้บริการให้

---

## 1. หัวใจของปัญหา (อ่านก่อน)

Binance ให้ผูก **API Key กับ IP whitelist** ได้ (แนะนำอย่างยิ่งสำหรับเทรดจริง) เพื่อให้คำสั่งเทรดส่งได้เฉพาะจากเซิร์ฟเวอร์ของเราเท่านั้น เงื่อนไขคือ **IP ขาออก (egress IP) ของเครื่องที่ยิงคำสั่งต้องคงที่**

| สถาปัตยกรรม | IP ขาออก | Whitelist บน Binance ได้ไหม |
|---|---|---|
| Vercel / Netlify / Serverless (ปัจจุบันของคุณ) | เปลี่ยนตลอด (shared pool) | ❌ ไม่ได้ |
| PaaS ฟรี/แชร์ (Render free, Railway) | dynamic/shared | ❌ ส่วนใหญ่ไม่ได้ |
| **VPS / Cloud instance ที่มี dedicated public IP** | **คงที่** | ✅ **ได้** |
| AWS EC2 + Elastic IP / NAT Gateway | คงที่ | ✅ ได้ |

> **ข้อสรุปสถาปัตยกรรม:** ส่วนที่ "ยิงคำสั่งเทรด" (ใช้ API Key) **ต้องอยู่บน VPS ที่มี static IP** เท่านั้น
> NextJS app บน Vercel ที่คุณมีอยู่ ให้เปลี่ยนบทบาทเป็น **แดชบอร์ด/หน้าควบคุม (control plane)** ไม่ใช่ตัวยิงออเดอร์
>
> หมายเหตุสำคัญ: **ข้อมูลราคา (klines/WebSocket) เป็น public ไม่ต้องใช้ API Key** ดังนั้นการ "ดึงข้อมูล" ทำที่ไหนก็ได้ — แต่ "ส่งออเดอร์" ต้องออกจาก IP ที่ whitelist เท่านั้น

---

## 2. ผู้ให้บริการในไทยที่ตอบโจทย์ (VPS + Static IP + รัน Node.js เพียวๆ ได้)

ทุกเจ้าด้านล่างให้ **VPS Linux + dedicated public IPv4 (static)** ซึ่งใช้ whitelist บน Binance ได้ และรัน Node.js เพียวๆ (PM2/systemd/Docker) ได้หมด

| ผู้ให้บริการ | ประเภท | จุดเด่น | เหมาะกับ |
|---|---|---|---|
| **NIPA Cloud** (nipa.cloud) | Thai cloud แท้ (OpenStack), pay-as-you-go | self-service portal, external IP ซื้อแยกได้, มาตรฐานองค์กร | งานจริงจัง ต้องการ cloud ไทยแท้ |
| **CloudHM** (cloudhm.co.th) | Thai enterprise cloud (VMware) | เสถียร เน้นองค์กร ซัพพอร์ตไทย | องค์กร/ต้องการ SLA |
| **True IDC / TrueCloud** (trueidc.com) | Data center + cloud รายใหญ่ | โครงข่ายใหญ่, Tier III DC | สเกลใหญ่ในอนาคต |
| **VPS HiSpeed** (vpshispeed.com) | VPS ไทย DC ที่ CAT Tower บางรัก | ทุก VPS มี IP ของตัวเอง, ราคาเป็นมิตร | **งบประหยัด** |
| **KSC** (ksc.net) | Thai cloud (KSC) | Public IP, Pay-As-You-Go ปรับขนาดได้ | ยืดหยุ่นตามใช้งาน |
| **LightNode – Bangkok** (lightnode.com) | VPS ระดับภูมิภาค มี node กรุงเทพ | static IP, NVMe, เริ่ม ~$7.7/เดือน คิดรายชั่วโมง | **งบประหยัด เปิด/ปิดง่าย** |
| **AWS Asia Pacific (Thailand)** | Cloud ระดับโลก ภูมิภาคไทย `ap-southeast-7` (GA ม.ค. 2025, 3 AZ) | EC2 + **Elastic IP** (static), managed, scale ดี, NAT Gateway | ขยายระบบ/ต้องการ ecosystem (แต่แพงกว่า งบ <1,000 อาจเกิน) |

### ข้อควรรู้เรื่อง latency (สำคัญต่อการเทรด)
ระบบจับคู่คำสั่งของ Binance ตั้งอยู่บน **AWS Tokyo (ap-northeast-1)** ดังนั้น:
- VPS ไทย → Binance ราว **~50–80 ms** ซึ่ง **เพียงพอมากสำหรับกลยุทธ์อิง indicator/แท่งเทียนปิด** (ไม่ใช่ HFT) — โจทย์คุณ (1–10 คู่, สัญญาณจากแท่งปิด) ไม่ต้องกังวลเรื่องนี้
- ถ้าในอนาคตทำ scalping ความถี่สูงมาก ค่อยพิจารณาวาง "ตัวยิงออเดอร์" ไว้ที่ Tokyo/Singapore แล้ว whitelist IP นั้นเพิ่ม

---

## 3. คำแนะนำสำหรับงบ < 1,000 บาท/เดือน (เลือกให้แล้ว)

**เลือก: VPS ไทย 1 ตัว ที่มี static IP รันทุกอย่างในเครื่องเดียว**

- **สเปกแนะนำ:** 2 vCPU / 2–4 GB RAM / 40–80 GB SSD-NVMe + 1 dedicated public IPv4
- **ตัวเลือกหลัก (งบประหยัด):** **VPS HiSpeed** หรือ **LightNode (Bangkok node)** — ราคาประมาณ **270–700 บาท/เดือน** เหลือ buffer สำหรับ snapshot/backup
- **ตัวเลือกถ้าต้องการ Thai cloud แท้ + โตต่อ:** **NIPA Cloud** (จ่ายตามใช้จริง เปิด instance เล็กได้)
- **DB:** ใช้ **PostgreSQL** ติดตั้งในเครื่องเดียวกัน (Docker) → **ไม่มีค่าใช้จ่ายเพิ่ม** ข้อมูล 1–10 คู่เล็กมาก พอสบายในงบนี้

> ทำไมไม่แยกเครื่อง/ไม่ใช้ managed DB ตอนนี้: ที่สเกล 1–10 คู่ ข้อมูลเล็กมาก (ดูข้อ 6) แยกเครื่องคือจ่ายเพิ่มโดยไม่จำเป็น เริ่มเครื่องเดียวก่อน แล้วค่อยแยกเมื่อโต

**ต้นทุนรวมโดยประมาณ: ~300–700 บาท/เดือน** (อยู่ในงบ)

---

## 4. สถาปัตยกรรมระบบ (ภาพรวม)

```
                         ┌────────────────────────────────────────────────┐
                         │            Binance (api.binance.com)            │
                         │   REST: /api/v3/klines, /order, /account, ...   │
                         │   WS:   stream.binance.com (kline streams)      │
                         └──────▲───────────────────────────▲──────────────┘
        public market data      │                           │  signed orders
        (ไม่ใช้ API key)         │                           │  (ใช้ API key + ต้องมาจาก IP whitelist)
                                 │                           │
   ┌─────────────────────────────┴───────────────────────────┴───────────────────┐
   │                       VPS ไทย — STATIC IP (Execution Plane)                   │
   │                       (whitelist IP นี้บน Binance API Key)                     │
   │                                                                              │
   │   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌─────────────┐   │
   │   │  Collector   │──▶│   Strategy   │──▶│   Executor   │──▶│ Risk/Position│  │
   │   │ (WS+REST)    │   │   Engine     │   │ (signed REST)│   │   Manager    │  │
   │   └──────┬───────┘   └──────┬───────┘   └──────┬───────┘   └──────┬──────┘   │
   │          │ candles          │ signals          │ orders/fills     │ state    │
   │          ▼                  ▼                  ▼                  ▼          │
   │   ┌──────────────────────────────────────────────────────────────────────┐ │
   │   │                    PostgreSQL (candles, signals, orders, positions)    │ │
   │   └──────────────────────────────────────────────────────────────────────┘ │
   │          │                                                       │           │
   │   ┌──────▼───────┐                                        ┌──────▼──────┐    │
   │   │  Admin API   │  (Fastify/Express, อ่าน state, สั่ง   │  Notifier   │    │
   │   │  + Auth      │   start/stop, ปรับ config)            │ Line/Telegram│   │
   │   └──────▲───────┘                                        └─────────────┘    │
   │          │ HTTPS (token)                                                      │
   └──────────┼──────────────────────────────────────────────────────────────────┘
              │
   ┌──────────┴───────────┐
   │  NextJS Dashboard    │  (Control Plane — รันบน Vercel ต่อได้, ฟรี)
   │  - ดูสถานะ/PNL/log    │  *ไม่ยิงออเดอร์เอง* เรียกผ่าน Admin API ของ VPS
   │  - เปิด/ปิดบอท        │  *backtest/วิจัยกลยุทธ์ ทำที่นี่ได้*
   └──────────────────────┘
```

**แยกหน้าที่ชัดเจน:**
- **Execution Plane (VPS, static IP):** ดึงข้อมูล + คำนวณ indicator + ยิงออเดอร์ + เก็บ state → ส่วนนี้ทำงาน 24/7 ไม่พึ่งเบราว์เซอร์
- **Control Plane (NextJS/Vercel):** UI สำหรับดู/ควบคุม/วิจัย ไม่แตะ API key, ไม่ยิงออเดอร์

---

## 5. องค์ประกอบหลัก (Services) บน VPS

ทั้งหมดเป็น **Node.js เพียวๆ** รันเป็น process ผ่าน **PM2** (หรือ systemd/Docker Compose) แนะนำใช้ **TypeScript** เพื่อ reuse โค้ดกลยุทธ์/indicator จากโปรเจกต์ NextJS เดิม (`lib/indicators.ts`, `lib/backtest.ts`)

### 5.1 Collector (ตัวดึงข้อมูล + polling)
- **เชื่อม WebSocket kline streams** ของ Binance สำหรับ 1–10 คู่ → ได้ราคาเรียลไทม์ ไม่ชน rate limit
  - `wss://stream.binance.com:9443/stream?streams=btcusdt@kline_1m/ethusdt@kline_1m`
  - ฟิลด์ `k.x === true` = แท่งปิดแล้ว → เป็นจังหวะ "เก็บลง DB + ส่งให้ Strategy"
- **Backfill ตอนสตาร์ท** ด้วย REST `GET /api/v3/klines?symbol=&interval=&limit=1000` เพื่อเติม lookback ให้ indicator คำนวณได้ทันที
- **Auto-reconnect** เมื่อ WS หลุด + ตรวจ gap แล้วเติมด้วย REST
- เก็บ ring buffer ในหน่วยความจำ (N แท่งล่าสุดต่อคู่/timeframe) เพื่อคำนวณเร็ว + persist ลง DB เพื่อกู้คืนหลังรีสตาร์ท

> ทางเลือก REST polling ล้วน: ถ้าไม่อยากใช้ WS ใช้ `node-cron` ดึง klines ทุก X วินาที/นาทีก็ได้ (1–10 คู่ ไม่ชน rate limit) — แต่ WS ดีกว่าเรื่องความสด/โหลด

### 5.2 Strategy / Indicator Engine
- ทำงานทุกครั้งที่ "แท่งปิด" → คำนวณ indicator ที่เขียนเอง (reuse `lib/indicators.ts`) → ออก **signal** `BUY` / `SELL` / `HOLD`
- เก็บสัญญาณลงตาราง `signals` ทุกครั้ง (ไว้ audit/วิเคราะห์ย้อนหลัง)
- **ใช้โค้ดชุดเดียวกับ backtest** เพื่อให้ผล live ตรงกับ backtest (avoid look-ahead bias: คำนวณจากแท่งที่ปิดแล้วเท่านั้น)

### 5.3 Executor (ตัวยิงออเดอร์ — ส่วนที่ต้องอยู่บน static IP)
- รับ signal → แปลงเป็นออเดอร์ Spot จริง: `POST /api/v3/order` (signed HMAC-SHA256, header `X-MBX-APIKEY`)
- reuse ตัวเซ็นที่คุณมีอยู่แล้ว `lib/binanceSign.ts` (`buildSignedParams`)
- **Idempotency:** ส่ง `newClientOrderId` ที่ deterministic (เช่น `bot-{symbol}-{candleCloseTime}-{side}`) เพื่อกัน "ยิงซ้ำ" เวลารีสตาร์ท/รีทราย
- **เคารพ filters ของแต่ละคู่** จาก `GET /api/v3/exchangeInfo`: `LOT_SIZE.stepSize` (ปัดจำนวน), `MIN_NOTIONAL` (มูลค่าขั้นต่ำ), `PRICE_FILTER`
- MARKET BUY ใช้ `quoteOrderQty` (กำหนดเงินที่จะใช้ซื้อ เช่น 200 USDT) ก็สะดวก; SELL ใช้ `quantity`

### 5.4 Risk / Position Manager
- เก็บสถานะ position ปัจจุบันต่อคู่ (qty, ราคาเฉลี่ยเข้า, SL/TP)
- กฎความปลอดภัยขั้นต่ำ: ขนาดไม้ต่อคำสั่ง, จำนวน position พร้อมกันสูงสุด, daily max loss / kill-switch, กันเปิดซ้ำคู่เดิม
- คุมว่าจะ "ซื้อเมื่อยังไม่มีของ / ขายเมื่อมีของ" เท่านั้น (สำหรับ Spot)

### 5.5 Admin API + Notifier
- **Admin API** (Fastify/Express) ป้องกันด้วย token: endpoint ดูสถานะ/PNL/log, start/stop bot, แก้ config → ให้ NextJS dashboard เรียก
- **Notifier:** แจ้งเตือนสัญญาณ/ออเดอร์/error ไป Line Notify หรือ Telegram bot

---

## 6. ชั้นเก็บข้อมูล (Storage) + Schema

**เลือก PostgreSQL** (ถ้าจะเล็กสุด SQLite ก็ได้ แต่ Postgres รองรับ concurrency + โตง่ายกว่า)
ถ้าข้อมูลย้อนหลังเยอะในอนาคต ค่อยเปิด extension **TimescaleDB** ทำ hypertable

**ขนาดข้อมูลจริง (เล็กมาก):** 1 คู่ timeframe 1 นาที = 1,440 แท่ง/วัน ≈ 525,600 แท่ง/ปี; 10 คู่ ≈ 5.2 ล้านแถว/ปี ราว ๆ ไม่กี่ร้อย MB — Postgres บน VPS เล็กสบายมาก

```sql
-- แท่งเทียน (เก็บเฉพาะแท่งที่ปิดแล้ว)
CREATE TABLE candles (
  symbol      TEXT        NOT NULL,
  interval    TEXT        NOT NULL,           -- '1m','5m','1h',...
  open_time   BIGINT      NOT NULL,           -- ms epoch
  open        NUMERIC     NOT NULL,
  high        NUMERIC     NOT NULL,
  low         NUMERIC     NOT NULL,
  close       NUMERIC     NOT NULL,
  volume      NUMERIC     NOT NULL,
  PRIMARY KEY (symbol, interval, open_time)
);

-- สัญญาณที่กลยุทธ์สร้าง (audit ทุกครั้ง)
CREATE TABLE signals (
  id         BIGSERIAL PRIMARY KEY,
  ts         BIGINT  NOT NULL,
  symbol     TEXT    NOT NULL,
  interval   TEXT    NOT NULL,
  strategy   TEXT    NOT NULL,
  side       TEXT    NOT NULL,                -- BUY/SELL/HOLD
  price      NUMERIC,
  meta       JSONB                            -- ค่า indicator ตอนนั้น
);

-- ออเดอร์ที่ยิงไป Binance
CREATE TABLE orders (
  id               BIGSERIAL PRIMARY KEY,
  client_order_id  TEXT UNIQUE NOT NULL,      -- idempotency key
  binance_order_id BIGINT,
  symbol           TEXT NOT NULL,
  side             TEXT NOT NULL,
  type             TEXT NOT NULL,             -- MARKET/LIMIT
  qty              NUMERIC,
  quote_qty        NUMERIC,
  price            NUMERIC,
  status           TEXT NOT NULL,             -- NEW/FILLED/REJECTED/ERROR
  raw              JSONB,                     -- response ดิบจาก Binance
  created_at       BIGINT NOT NULL
);

-- สถานะ position ปัจจุบัน
CREATE TABLE positions (
  symbol     TEXT PRIMARY KEY,
  qty        NUMERIC NOT NULL DEFAULT 0,
  avg_entry  NUMERIC,
  stop_loss  NUMERIC,
  take_profit NUMERIC,
  opened_at  BIGINT,
  status     TEXT NOT NULL DEFAULT 'FLAT'     -- FLAT/LONG
);
```

---

## 7. ความปลอดภัย (สำคัญที่สุดเพราะเป็นเงินจริง)

1. **IP Whitelist บน Binance API Key** — ตั้งใน Binance: API Management → Edit restrictions → Restrict access to trusted IPs only → ใส่ **static IP ของ VPS**
2. **สิทธิ์ของ API Key ให้น้อยที่สุด** — เปิดเฉพาะ **Enable Spot & Margin Trading**; **ปิด Enable Withdrawals เด็ดขาด** (ป้องกันการถอนแม้คีย์รั่ว)
3. **เก็บ key/secret เป็น secret บน VPS** — ใส่ใน `.env` (chmod 600) หรือ secret manager; **อย่า** commit ลง git, **อย่า** ส่งให้ฝั่ง client/NextJS
   - ⚠️ โค้ดเดิม `executeSignal.ts`/หน้า trading ส่ง key จาก client → **ต้องเลิก** ในระบบ live; key อยู่บน VPS เท่านั้น
4. **Time sync (NTP)** — ติดตั้ง `chrony`/`systemd-timesyncd` บน VPS; นาฬิกาเพี้ยนทำให้ Binance ตอบ `-1021 timestamp` และคำสั่งถูกปฏิเสธ
5. **Firewall (ufw):** เปิดเฉพาะ SSH (จำกัด IP), และพอร์ต Admin API ผ่าน HTTPS/reverse proxy เท่านั้น
6. **Admin API ต้องมี auth** (bearer token/secret) — ห้ามเปิด endpoint ควบคุมบอทแบบ public
7. **Kill-switch + daily max loss** — มีปุ่ม/กลไกหยุดบอททันที และเพดานขาดทุนต่อวัน

---

## 8. Deployment (รันจริงบน VPS)

```bash
# บน Ubuntu VPS (static IP)
sudo apt update && sudo apt install -y git chrony ufw
# ติดตั้ง Node.js LTS (ผ่าน nvm หรือ nodesource)
# ติดตั้ง Docker (สำหรับ Postgres) หรือ apt install postgresql

# Postgres ด้วย Docker
docker run -d --name pg --restart=always \
  -e POSTGRES_PASSWORD=... -p 127.0.0.1:5432:5432 \
  -v pgdata:/var/lib/postgresql/data postgres:16

# Deploy bot
git clone <repo> && cd bot && npm ci && npm run build

# จัดการ process ด้วย PM2 (รัน 24/7 + auto-restart + boot)
npm i -g pm2
pm2 start dist/main.js --name crypto-bot
pm2 startup && pm2 save

# Firewall
sudo ufw allow OpenSSH && sudo ufw enable
```

**โครงสร้างโปรเจกต์ที่แนะนำ (แยก worker ออกจาก NextJS, แต่ share โค้ดกลยุทธ์):**

```
/bot                      # โปรเจกต์ Node.js ใหม่ที่ deploy บน VPS
  src/
    main.ts               # bootstrap: เชื่อม WS, ตั้ง schedule, start admin api
    collector/binanceWs.ts
    collector/backfill.ts
    strategy/engine.ts    # import indicator จาก shared
    execution/executor.ts # ใช้ binanceSign
    execution/exchangeInfo.ts  # ดึง LOT_SIZE/MIN_NOTIONAL
    risk/positionManager.ts
    db/pool.ts  db/schema.sql
    api/adminServer.ts    # Fastify + auth
    notify/telegram.ts
  .env                    # BINANCE_API_KEY, BINANCE_SECRET, DB_URL, ...
/shared                   # โค้ดที่ใช้ร่วมกับ NextJS (indicators, types)
  indicators.ts           # ← ย้าย/แชร์จาก lib/indicators.ts เดิม
```

> reuse ของเดิมได้เลย: `lib/binanceSign.ts`, `lib/indicators.ts`, `lib/backtest.ts`, `lib/types/kline.ts`

---

## 9. โค้ด Skeleton (อ้างอิงให้เห็นภาพ)

**9.1 Collector — WebSocket + เก็บแท่งปิด**
```ts
import WebSocket from "ws";
const symbols = ["btcusdt", "ethusdt"];        // 1-10 คู่
const interval = "1m";
const streams = symbols.map(s => `${s}@kline_${interval}`).join("/");
const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);

ws.on("message", async (raw) => {
  const { data } = JSON.parse(raw.toString());
  const k = data.k;
  if (!k.x) return;                            // เอาเฉพาะแท่งปิด
  const candle = {
    symbol: k.s, interval: k.i, openTime: k.t,
    open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v,
  };
  await saveCandle(candle);                    // upsert ลง DB + ring buffer
  await onClosedCandle(candle);                // → Strategy engine
});
ws.on("close", () => scheduleReconnect());     // auto-reconnect + gap fill
```

**9.2 Executor — ยิงออเดอร์ Spot จริง (idempotent)**
```ts
import { buildSignedParams } from "../../shared/binanceSign"; // reuse ของเดิม
const BASE = "https://api.binance.com";

export async function placeSpotMarket(opts: {
  symbol: string; side: "BUY" | "SELL";
  quantity?: string; quoteOrderQty?: string; clientOrderId: string;
}) {
  const params = buildSignedParams({
    symbol: opts.symbol, side: opts.side, type: "MARKET",
    ...(opts.quantity ? { quantity: opts.quantity } : {}),
    ...(opts.quoteOrderQty ? { quoteOrderQty: opts.quoteOrderQty } : {}),
    newClientOrderId: opts.clientOrderId,      // ← กันยิงซ้ำ
    timestamp: Date.now(), recvWindow: 5000,
  }, process.env.BINANCE_SECRET!);

  const res = await fetch(`${BASE}/api/v3/order?${params}`, {
    method: "POST",
    headers: { "X-MBX-APIKEY": process.env.BINANCE_API_KEY! },
  });
  return res.json();   // เก็บ raw ลงตาราง orders
}
```

**9.3 จุดเชื่อม Strategy → Executor (พร้อม risk + idempotency)**
```ts
async function onClosedCandle(c: Candle) {
  const signal = runStrategy(getBuffer(c.symbol, c.interval)); // BUY/SELL/HOLD
  await saveSignal(c, signal);
  if (signal === "HOLD") return;

  if (!risk.allow(c.symbol, signal)) return;   // เช็คกฎความเสี่ยง/position
  const qty = sizing.compute(c.symbol, signal); // ปัดตาม stepSize/minNotional
  const clientOrderId = `bot-${c.symbol}-${c.openTime}-${signal}`; // deterministic
  const order = await placeSpotMarket({ symbol: c.symbol, side: signal, quantity: qty, clientOrderId });
  await saveOrder(order);
  await risk.update(c.symbol, order);
  await notify(`${signal} ${c.symbol} @ ${c.close}`);
}
```

---

## 10. ขั้นตอนทำจริง (Roadmap)

1. **เปิด VPS ไทย** (VPS HiSpeed / LightNode BKK / NIPA) → จด **static IP**
2. ตั้ง Binance API Key: เปิด Spot trading, ปิด withdrawal, **whitelist IP ของ VPS**
3. ติดตั้ง Node.js + Postgres + chrony + ufw + PM2 บน VPS
4. แยกโค้ดกลยุทธ์/indicator เป็น `/shared` แล้วสร้างโปรเจกต์ `/bot`
5. ทำ **Collector** (WS + backfill) → เก็บ candle ลง DB ให้ครบก่อน
6. ต่อ **Strategy engine** (reuse backtest) → log signal อย่างเดียวก่อน (ยังไม่ยิงจริง)
7. **ทดสอบบน Binance Spot Testnet** (`https://testnet.binance.vision`) ให้ครบ flow
8. เปิด **Executor + Risk** → เริ่มเทรดจริง **ไม้เล็กสุด** ก่อน
9. ต่อ **Admin API + Notifier** และให้ NextJS dashboard อ่านสถานะ
10. เฝ้าดู log/PNL, เพิ่ม kill-switch, ค่อยขยายจำนวนคู่

---

## 11. สรุปการตัดสินใจ (ตามสเปกที่ให้)

| หัวข้อ | สิ่งที่เลือก | เหตุผล |
|---|---|---|
| Hosting | **VPS ไทย 1 ตัว + static IP** (VPS HiSpeed/LightNode BKK; โตต่อ → NIPA) | จำเป็นต้องมี fixed IP เพื่อ whitelist; งบ <1,000 ทำได้สบาย |
| Data ingestion | **WebSocket kline + REST backfill** | สด, ไม่ชน rate limit ที่ 1–10 คู่ |
| DB | **PostgreSQL ในเครื่องเดียวกัน** | ข้อมูลเล็ก, ไม่มีค่าใช้จ่ายเพิ่ม, โตเป็น TimescaleDB ได้ |
| Execution | **Executor บน VPS เท่านั้น (signed REST + idempotency)** | คำสั่งต้องออกจาก IP ที่ whitelist |
| NextJS เดิม | **เปลี่ยนเป็น Dashboard/Control plane** (เลิกยิงออเดอร์จาก client) | Vercel IP ไม่คงที่ + ความปลอดภัยของ key |
| งบรวม | **~300–700 บาท/เดือน** | อยู่ในงบ <1,000 |

---

## 12. รันบนเครื่องตัวเอง (localhost) แทน VPS ได้ไหม? — IP จะคงที่หรือไม่

**คำถาม:** ถ้าเปิดคอมทิ้งไว้ รันโปรแกรมที่ `localhost` IP จะเป็น fixed IP ไหม และใช้แทน server จริงได้ไหม

### 12.1 ทำความเข้าใจ "IP" ให้ตรงก่อน (จุดที่คนเข้าใจผิดบ่อย)
`localhost` / `127.0.0.1` คือ **IP ภายในเครื่องตัวเอง** ไม่เกี่ยวกับสิ่งที่ Binance เห็น
สิ่งที่ Binance ใช้ทำ whitelist คือ **Public IP (egress IP)** ที่ ISP แจกให้เน็ตบ้าน/ออฟฟิศของคุณ — คือ IP ที่เห็นเวลาเข้าเว็บเช็ค "what is my IP"

```
[คอมคุณ 127.0.0.1] ──▶ [Router ที่บ้าน] ──▶ [ISP: Public IP เช่น 183.89.x.x] ──▶ Binance เห็น IP นี้
        ^ localhost                                ^ ตัวนี้ต่างหากที่ต้อง whitelist และตัวนี้แหละที่ "ไม่คงที่"
```

### 12.2 แล้ว Public IP ของเน็ตบ้านคงที่ไหม? — **ส่วนใหญ่ "ไม่คงที่"**

| ประเภทการเชื่อมต่อ | Public IP คงที่ไหม | หมายเหตุ |
|---|---|---|
| เน็ตบ้านทั่วไป (True/AIS/3BB Fiber แพ็กเกจปกติ) | ❌ **Dynamic** | เปลี่ยนเมื่อรีบูตเราเตอร์ / ต่อใหม่ / ISP หมุน lease (เป็นวัน–สัปดาห์) |
| เน็ตมือถือ / 4G / 5G / pocket WiFi | ❌ **ไม่มี public IP ของตัวเองเลย** | อยู่หลัง **CGNAT** แชร์ IP กับคนอื่นเป็นพันราย — whitelist ไม่ได้ |
| แพ็กเกจ **Fixed/Static IP** ของ ISP (มักเป็น Business) | ✅ คงที่ | ต้องสมัครเพิ่ม มีค่าใช้จ่ายรายเดือน |

> สรุป: เปิดคอมรัน localhost ทิ้งไว้เฉย ๆ → **IP ไม่คงที่** → พอ ISP เปลี่ยน IP เมื่อไหร่ คำสั่งเทรดจะถูก Binance ปฏิเสธทันที (`-2015 / Invalid API-key, IP, or permissions`) จนกว่าจะไปแก้ whitelist ใหม่เอง

⚠️ Dynamic DNS (no-ip/DuckDNS) **ช่วยไม่ได้** เพราะ Binance whitelist รับเป็น "IP" ไม่ใช่ชื่อโดเมน

### 12.3 ใช้ localhost แทน server จริงได้ไหม? — ได้/ไม่ได้ ขึ้นกับกรณี

**✅ เหมาะมากสำหรับ:**
- **พัฒนา + ทดสอบกลยุทธ์ + backtest** (ทำบนเครื่องตัวเองได้เต็มที่)
- **รันบน Binance Spot Testnet** (`testnet.binance.vision`) — Testnet **ไม่บังคับ whitelist IP** จึงรัน localhost ได้สบาย ใช้ซ้อมทั้ง flow ก่อนขึ้นจริง
- **โหมดสัญญาณ/แจ้งเตือนอย่างเดียว** (ไม่ยิงออเดอร์ → ไม่ต้อง whitelist เลย)

**⚠️ เทรดจริงด้วย localhost ทำได้ แต่ติด 2 ปัญหาใหญ่:**
1. **IP ไม่คงที่** (ข้อ 12.2) — ต้องแก้ด้วยวิธีในข้อ 12.4
2. **ความเสถียร 24/7** — บอทเทรดต้องไม่ดับ แต่เครื่องบ้านมีความเสี่ยง:
   - ไฟดับ / เน็ตหลุด → บอทหยุด อาจ "ค้าง position" โดยไม่มีใครคุม SL/TP
   - เครื่อง sleep / หน้าจอดับ / Windows-macOS update รีบูตเอง → process ตาย
   - คอมร้อน/แรม/อัปเดตแอป → หลุดกลางทาง
   - ออกจากบ้าน/ปิดคอม = บอทตาย

### 12.4 ถ้าจะรัน localhost จริง ๆ ต้องทำให้ครบ

**แก้ปัญหา IP ไม่คงที่ (เลือกอย่างใดอย่างหนึ่ง):**
1. **สมัคร Fixed/Static IP กับ ISP** (มักเป็นแพ็กเกจ Business + ค่าบริการรายเดือน) → ได้ public IP คงที่ → whitelist IP นั้น ✅ ตรงไปตรงมาที่สุด
2. **ส่งคำสั่งเทรดผ่าน Proxy/VPN ที่มี static IP** — ให้ "เฉพาะ request ที่ยิงออเดอร์" วิ่งออกผ่าน proxy ที่ IP คงที่ แล้ว whitelist IP ของ proxy
   - แต่ proxy static IP ที่ถูกสุดมักคือ **VPS เล็ก ๆ ตัวหนึ่ง** → ถ้าต้องจ่าย VPS เป็น proxy อยู่แล้ว **เอาบอทไปรันบน VPS นั้นเลยคุ้มกว่า** (กลับไปข้อ 3)
3. **ไม่เปิด IP whitelist เลย** (ใช้ key แบบไม่จำกัด IP) — *ทำได้แต่ไม่แนะนำอย่างยิ่งกับเงินจริง* เพราะถ้า key รั่ว ใครก็ใช้ได้ (ยังควรปิด withdrawal ไว้เสมอ)

**แก้ปัญหาความเสถียร (ถ้ายืนยันรันที่บ้าน):**
- ต่อ **UPS** กันไฟดับ
- ตั้ง **ปิด sleep/hibernate** + ให้โปรแกรม **auto-start ตอนบูต** (PM2 `startup` / Task Scheduler / launchd)
- เน็ตสำรอง (เช่น 4G ต่อเมื่อ fiber ล่ม)
- มี **kill-switch + แจ้งเตือน** เมื่อบอทหลุด เพื่อเข้าไปคุม position เองได้ทัน

### 12.5 เปรียบเทียบ localhost vs VPS (สำหรับเทรด Spot จริง)

| ประเด็น | รันที่ localhost (เครื่องบ้าน) | VPS ไทย static IP (~300–700 บาท/ด.) |
|---|---|---|
| Public IP คงที่ | ❌ ส่วนใหญ่ dynamic / CGNAT | ✅ คงที่ในตัว |
| Whitelist Binance | ต้องสมัคร static IP เพิ่ม หรือผ่าน proxy | ✅ ใช้ได้เลย |
| ทำงาน 24/7 | เสี่ยงไฟ/เน็ต/sleep/รีบูต | ✅ ออกแบบมาให้รันต่อเนื่อง |
| ค่าไฟ + ต้องเปิดคอมทิ้ง | มี (เปิดคอมตลอด) | ไม่มี |
| เหมาะกับ | dev / backtest / **Testnet** / โหมดสัญญาณ | **เทรดจริง 24/7** |

> **ข้อแนะนำสุดท้าย:** ใช้ **localhost สำหรับพัฒนา + ทดสอบบน Testnet** ให้ครบก่อน แล้วค่อยย้าย "ตัวยิงออเดอร์จริง" ขึ้น **VPS static IP** เพื่อเทรดจริง 24/7
> ถ้าจะรันที่บ้านจริง ๆ ทางที่สะอาดสุดคือ **สมัคร Fixed IP กับ ISP** แต่เมื่อรวมค่า Fixed-IP ของ ISP + ค่าไฟ + ความเสี่ยงเครื่องดับ มักจะ **ไม่คุ้มกว่า** VPS ไทยตัวเล็กที่ ~300–700 บาท/เดือนซึ่งได้ static IP + uptime มาในตัว

---

## แหล่งอ้างอิง
- [AWS — Announcing the new AWS Asia Pacific (Thailand) Region](https://aws.amazon.com/blogs/aws/announcing-the-new-aws-asia-pacific-thailand-region/)
- [NIPA Cloud](https://nipa.cloud/) · [NIPA Cloud External IP pricing](https://nipa.cloud/pricing/nipa-space/external-ip)
- [True IDC](https://www.trueidc.com/en/)
- [VPS HiSpeed (Thailand)](https://www.vpshispeed.com/en/)
- [KSC Virtual Service (Thai Cloud)](https://www.ksc.net/en/products-cloud-virtual-service.aspx)
- [LightNode — Thailand (Bangkok) VPS](https://go.lightnode.com/thailand-vps)
- [9 Best Thailand VPS Hosting Providers](https://hostadvice.com/vps/thailand/)
```
