# แผนระบบ: Crypto Signal Bot (Discord-controlled, Serverless, ฟรี)

> เป้าหมาย: ดึงข้อมูลเหรียญ → รันผ่าน `lib/indicators.ts` (ผ่าน `lib/backtest.ts`) แบบ polling
> (ปรับรอบได้, ค่าเริ่มต้น 30 นาที) → ถ้ามีสัญญาณ BUY/SELL ส่งเข้า Discord
> ระบบ **ควบคุมผ่าน Discord ทั้งหมด ไม่มี web หน้าบ้าน** และต้องอยู่บน **เงื่อนไขฟรี**
>
> ทิศทางที่เลือก: **Discord Slash Commands (HTTP Interactions) + Upstash Redis**
> ทั้งหมดอยู่บน free tier เดิม (Vercel Hobby + GitHub Actions)

---

## 0. สรุปสิ่งที่ "มีอยู่แล้ว" ในโปรเจกต์

| ส่วน | ไฟล์ | สถานะ |
|---|---|---|
| เครื่องคำนวณ indicator (30+ ตัว) | `lib/indicators.ts` → `computeAll()` คืน `AllIndicators` (แต่ละตัวมี `.signal[]`) | ✅ พร้อม |
| Engine สัญญาณ + backtest | `lib/backtest.ts` → `STRATEGIES` (31 กลยุทธ์) + `runBacktest()` คืน `signals[]` (BUY/SELL/HOLD รายแท่ง) | ✅ พร้อม |
| Endpoint สแกน+ยิง Discord | `app/api/cron/scan/route.ts` (ยังไม่ commit) | ✅ ทำไว้ ~90% |
| GitHub Actions cron | `.github/workflows/signal-poll.yml` (ยังไม่ commit) | ✅ ทำไว้แล้ว |
| Discord webhook proxy | `app/api/discord/notify/route.ts` | ✅ พร้อม |
| ค่า env | `.env.local` มี `CRON_SECRET`, `DISCORD_WEBHOOK_URL`, `SCAN_*`, `SIGNAL_FRESHNESS_MIN` | ✅ พร้อม |

> **หมายเหตุ:** `app/discordBot/page.tsx` (~2,747 บรรทัด) **ไม่ใช่บอท Discord จริง** — เป็นหน้าเว็บ
> React (เก็บ watcher ใน localStorage). ตามโจทย์ที่ตัด web หน้าบ้านออก ตัวนี้จะ **ไม่ถูกใช้**
> (เก็บไว้เป็น reference หรือลบภายหลังได้)

---

## A. ภาพรวมโฟลว์

```
ขาเตือน (ออก):
  GitHub Actions (*/5 หรือ */30) ──curl──► /api/cron/scan
     └ อ่าน watcher จาก Redis → ดึง klines (Binance public)
       → computeAll + runBacktest → กันยิงซ้ำด้วย Redis → ยิง Discord webhook

ขาควบคุม (เข้า):
  Discord /watch,/config,/scan,/backtest ──HTTP──► /api/discord/interactions
     └ verify Ed25519 → อ่าน/เขียน watcher ใน Redis → ตอบกลับใน Discord
```

---

## B. โครงสร้าง Data ใน Redis (Upstash)

| Key | ชนิด | เก็บอะไร |
|---|---|---|
| `bot:watchers` | string (JSON) | `Watcher[]` — รายการที่จะสแกน |
| `bot:config` | string (JSON) | `{ freshnessMin, limit, webhookOverride? }` |
| `bot:lastAlert` | hash | field=`SYMBOL:INTERVAL:STRATEGY` → value=`closeTime|signal` (กันยิงซ้ำ) |

```ts
interface Watcher {
  id: string;          // = `${symbol}:${interval}:${strategyId}` (composite key → add ซ้ำไม่ได้)
  symbol: string;      // "BTCUSDT"
  interval: string;    // "30m"
  strategyId: StrategyId;
  enabled: boolean;
  createdBy: string;   // Discord user id
  createdAt: number;
}
```

> ใช้ `id` เป็น composite key ทำให้ `add` เป็น idempotent และ `remove` ง่าย — ไม่ต้องสุ่ม id

---

## C. ไฟล์ที่ต้อง "สร้างใหม่"

### 1. `lib/store.ts` — ห่อ Upstash REST API ด้วย `fetch` ล้วน (zero-dep)
ใช้ env `KV_REST_API_URL` + `KV_REST_API_TOKEN` (Vercel inject ให้อัตโนมัติ)
```ts
export async function getWatchers(): Promise<Watcher[]>
export async function saveWatchers(w: Watcher[]): Promise<void>
export async function addWatcher(w: Watcher): Promise<{ added: boolean }>
export async function removeWatcher(id: string): Promise<{ removed: boolean }>
export async function getLastAlert(key: string): Promise<{ closeTime: number; signal: string } | null>
export async function setLastAlert(key: string, v: { closeTime: number; signal: string }): Promise<void>
export async function getConfig(): Promise<BotConfig>
export async function setConfig(c: Partial<BotConfig>): Promise<void>
```
> ทางเลือก: ใช้ SDK `@upstash/redis` (อ่านง่ายกว่า) แต่ fetch ล้วน = zero-dep และฟรีสนิท — **แนะนำ fetch ล้วน**

### 2. `lib/discord/verify.ts` — ตรวจลายเซ็น Ed25519 ด้วย Node `crypto` (built-in, ไม่ต้องลง `tweetnacl`)
```ts
export function verifyDiscordRequest(
  rawBody: string, sigHeader: string, tsHeader: string, publicKeyHex: string
): boolean
```

### 3. `lib/discord/commands.ts` — นิยาม slash command (JSON)
```ts
export const COMMANDS = [
  { name: "watch",    options: [/* sub: add | remove | list | toggle */] },
  { name: "config",   options: [/* show | set */] },
  { name: "scan",     /* รันสแกนเดี๋ยวนี้ */ },
  { name: "backtest", options: [/* symbol, interval, strategy */] },
  { name: "help" },
];
```
> - `interval` ใช้ `choices` ได้ (16 ตัว < ลิมิต 25)
> - `strategy` มี 31 ตัว **เกิน** ลิมิต choices 25 → ใช้ **autocomplete** (HTTP interactions รองรับ)
>   หรือรับเป็น string แล้ว validate กับ `STRATEGIES`

### 4. `app/api/discord/register/route.ts` — route ลงทะเบียนคำสั่ง (ยิงครั้งเดียว, ป้องกันด้วย `?secret=CRON_SECRET`)
```ts
// PUT https://discord.com/api/v10/applications/{APP_ID}/commands   (Authorization: Bot <token>)
```

### 5. `app/api/discord/interactions/route.ts` — หัวใจฝั่งควบคุม
```ts
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  const raw = await req.text();                         // ต้องใช้ raw body สำหรับลายเซ็น
  if (!verifyDiscordRequest(raw, ...)) return 401;
  const body = JSON.parse(raw);

  if (body.type === 1) return json({ type: 1 });        // PING → PONG
  if (body.type === 2) {                                // APPLICATION_COMMAND
    switch (body.data.name) {
      case "watch":    /* add/remove/list → Redis → ตอบ type 4 ทันที (<3s) */
      case "config":   /* show/set        → ตอบ type 4 */
      case "scan":     /* ตอบ type 5 (deferred) → waitUntil(งานหนัก) → PATCH @original */
      case "backtest": /* เหมือน scan */
    }
  }
  if (body.type === 4) /* APPLICATION_COMMAND_AUTOCOMPLETE → ส่งรายชื่อ strategy ที่ match */
}
```
> งานหนัก (`/scan`, `/backtest`) ดึง Binance + คำนวณ อาจเกิน 3 วิ → ต้องตอบ **deferred (type 5)** ก่อน
> แล้วใช้ `waitUntil()` จาก `@vercel/functions` รันงานต่อ แล้ว PATCH ข้อความเดิม
> (`PATCH /webhooks/{APP_ID}/{interaction.token}/messages/@original` — ใช้ interaction token, ไม่ต้องใช้ bot token)

### (เสริม) `lib/discord/embeds.ts` — ตัวสร้าง embed ใช้ร่วมกันระหว่าง scan route กับ interactions

---

## D. ไฟล์ที่ต้อง "แก้"

### 6. `app/api/cron/scan/route.ts` (ปรับจากที่มี) — 3 จุด
- เปลี่ยนจากอ่าน `SCAN_*` env → **อ่าน `bot:watchers` จาก Redis** (ถ้า Redis ว่าง ใช้ env เป็น seed ครั้งแรกได้)
- **จัดกลุ่มตาม `symbol+interval`** เพื่อดึง klines ครั้งเดียวต่อกลุ่ม แล้วรันหลาย strategy บนชุดเดียว (ลดจำนวน fetch)
- **De-dup แบบ "สัญญาณเปลี่ยนสถานะ"**: ยิงเฉพาะเมื่อ `signals[last]` เป็น BUY/SELL **และ**
  `(SYMBOL:INTERVAL:STRATEGY, closeTime)` ยังไม่เคยยิง (เทียบกับ `bot:lastAlert`)
  → แก้ปัญหา RSI ส่ง BUY ทุกแท่งที่ยัง oversold (สแปม)

### 7. `.github/workflows/signal-poll.yml` — ปรับ `cron`
- โพล 30 นาที → `*/30 * * * *` (ตรงโจทย์) **หรือ**
- `*/5 * * * *` + `SIGNAL_FRESHNESS_MIN=10` เพื่อชน GitHub delay (กันสัญญาณตกหล่น) — Redis de-dup กันยิงซ้ำเอง

### 8. env (Vercel + `.env.local`) — เพิ่ม
```
DISCORD_PUBLIC_KEY=...        # Developer Portal → General Information
DISCORD_APPLICATION_ID=...    # = Client ID
DISCORD_BOT_TOKEN=...         # Bot → Reset Token (ใช้ตอน register)
KV_REST_API_URL=...           # Upstash inject ให้อัตโนมัติ
KV_REST_API_TOKEN=...         # Upstash inject ให้อัตโนมัติ
# มีอยู่แล้ว: CRON_SECRET, DISCORD_WEBHOOK_URL
```

---

## E. ขั้นตอนตั้งค่า (ทำตามลำดับ)

1. **Discord Developer Portal** → New Application → เก็บ `Application ID` + `Public Key`;
   แท็บ Bot → Reset Token เก็บ `Bot Token`; เชิญบอทเข้า server ด้วย scope `bot` + `applications.commands`
2. **Discord channel** → Integrations → สร้าง Webhook → เก็บ URL ลง `DISCORD_WEBHOOK_URL` (มีแล้ว)
3. **Upstash** → ใน Vercel project → Storage → Create → Upstash Redis (free) → auto-inject `KV_REST_API_*`
4. ใส่ env ที่เหลือใน Vercel แล้ว **deploy**
5. กลับ Developer Portal → ใส่ **Interactions Endpoint URL** = `https://<app>.vercel.app/api/discord/interactions`
   (Discord จะ PING มา → โค้ดต้องตอบ PONG → ผ่านถึงจะเซฟได้)
6. ยิง `https://<app>.vercel.app/api/discord/register?secret=<CRON_SECRET>` ครั้งเดียวเพื่อสร้าง slash commands
7. **GitHub repo** → Settings → Secrets → ใส่ `VERCEL_APP_URL` + `CRON_SECRET` → เปิด workflow
8. ทดสอบใน Discord: `/watch add BTCUSDT 30m supertrend` → `/watch list` → `/scan` → รอ cron ยิงเตือนจริง

---

## F. ยืนยันเงื่อนไข "ฟรี" ทุกจุด

| บริการ | ใช้ทำอะไร | ฟรี |
|---|---|---|
| Vercel Hobby | host 2 endpoint + interactions | ✅ |
| GitHub Actions | ตัวจับเวลา poll (เพราะ Vercel Cron บน Hobby = วันละครั้ง) | ✅ public ไม่จำกัด / private 2,000 นาที/เดือน |
| Upstash Redis | watcher + config + de-dup | ✅ 256MB / 500k cmd/เดือน |
| Binance public klines | ราคา (ไม่ต้องใช้ API key) | ✅ |
| Discord | คำสั่ง + แจ้งเตือน | ✅ |

> **dep ที่เพิ่ม:** อย่างมากแค่ `@vercel/functions` (เล็ก, มากับแพลตฟอร์ม) สำหรับ `waitUntil`
> ที่เหลือใช้ Node built-in (`crypto`) + `fetch` ล้วน → ไม่กระทบ free tier

---

## G. ข้อควรระวัง (สรุป)

- Slash command ต้องตอบใน **3 วินาที** → `/scan`, `/backtest` ใช้ deferred (type 5) + `waitUntil`
- **Vercel Hobby cron = วันละครั้ง** → poll 30 นาทีทำไม่ได้ด้วย Vercel cron จึงต้องใช้ GitHub Actions
- GitHub cron ดีเลย์ได้ **3–10 นาที** → ตั้ง freshness กว้าง + ใช้ Redis de-dup
- `strategy` 31 ตัว **เกิน** ลิมิต choices 25 → ใช้ autocomplete
- de-dup ควรเป็น **"สัญญาณเปลี่ยนสถานะ"** ไม่ใช่แค่ "มี BUY" เพื่อกันสแปม
- Vercel function ฟรี = 60 วิ → ต่อรอบสแกนได้หลายสิบเหรียญ; ถ้าเยอะมากค่อยซอยเป็นหลายรอบ

---

## H. สรุปขอบเขตงาน

**5 ไฟล์ใหม่:** `lib/store.ts`, `lib/discord/verify.ts`, `lib/discord/commands.ts`,
`app/api/discord/register/route.ts`, `app/api/discord/interactions/route.ts`
(+ เสริม `lib/discord/embeds.ts`)

**3 ไฟล์แก้:** `app/api/cron/scan/route.ts`, `.github/workflows/signal-poll.yml`, env

**8 ขั้นตอนตั้งค่า** ตามหัวข้อ E
