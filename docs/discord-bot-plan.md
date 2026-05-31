# แผนระบบ: Crypto Signal Bot (ควบคุมผ่าน Discord ทั้งหมด, Serverless, ฟรี)

> **เป้าหมาย:** ระบบ **ควบคุมผ่าน Discord ทั้งหมด ไม่มี web หน้าบ้าน**
> - ผู้ใช้สร้าง "bot" ได้หลายตัวผ่าน Discord โดยแต่ละ bot เลือก: **เหรียญ + ช่วงเวลาแท่ง (timeframe) +
>   ค่าเวลาการดึง polling + indicator 1 ตัว + (ออปชัน) channel แจ้งเตือน** (บอทสร้าง webhook ในช่องที่เลือกให้เอง)
>   (เลือกเหรียญอื่นเพิ่ม = สร้าง bot ใหม่)
> - แต่ละ bot ดึงข้อมูลตามรอบ polling (ปรับได้, ค่าเริ่มต้น **30 นาที**) → รันผ่าน `lib/indicators.ts`
>   (ผ่าน `lib/backtest.ts`) → ถ้ามีสัญญาณ **BUY/SELL** ส่งเข้า Discord
> - แต่ละ bot มีวงจรชีวิต **เริ่ม / หยุด / ลบ**
> - ทุกอย่างต้องอยู่บน **เงื่อนไขฟรี**
>
> **ทิศทางที่เลือก:** Discord **Slash Commands + Buttons** (HTTP Interactions) + **Upstash Redis**
> ทั้งหมดอยู่บน free tier เดิม (Vercel Hobby + GitHub Actions)

---

## 0. สรุปสิ่งที่ "มีอยู่แล้ว" ในโปรเจกต์

| ส่วน | ไฟล์ | สถานะ |
|---|---|---|
| เครื่องคำนวณ indicator (30+ ตัว) | `lib/indicators.ts` → `computeAll()` คืน `AllIndicators` (แต่ละตัวมี `.signal[]`) | ✅ พร้อม |
| Engine สัญญาณ + backtest | `lib/backtest.ts` → `STRATEGIES` (31 กลยุทธ์) + `runBacktest()` คืน `signals[]` (BUY/SELL/HOLD รายแท่ง) | ✅ พร้อม |
| Endpoint สแกน+ยิง Discord | `app/api/cron/scan/route.ts` (ยังไม่ commit) | ⚠️ ทำไว้ ~90% แต่ต้องปรับเป็น tick scheduler |
| GitHub Actions cron | `.github/workflows/signal-poll.yml` (ยังไม่ commit) | ✅ ทำไว้แล้ว |
| Discord webhook proxy | `app/api/discord/notify/route.ts` | ✅ พร้อม |
| ค่า env | `.env.local` มี `CRON_SECRET`, `DISCORD_WEBHOOK_URL`, `SCAN_*`, `SIGNAL_FRESHNESS_MIN` | ✅ พร้อม |

> **หมายเหตุ:** `app/discordBot/page.tsx` (~2,747 บรรทัด) **ไม่ใช่บอท Discord จริง** — เป็นหน้าเว็บ
> React (เก็บ watcher ใน localStorage). ตามโจทย์ที่ตัด web หน้าบ้านออก ตัวนี้จะ **ไม่ถูกใช้**
> (เก็บไว้เป็น reference หรือลบภายหลังได้)

---

## A. แนวคิดหลัก — "Bot" คือ 1 config

แต่ละ **bot** = ชุดตั้งค่า 1 ชุด ประกอบด้วย 4 ค่า:

| ค่า | ความหมาย | ตัวอย่าง |
|---|---|---|
| `symbol` | เหรียญ | `BTCUSDT` |
| `interval` | **ช่วงเวลาแท่งเทียน** (timeframe ของ klines/indicator) | `30m` |
| `pollSec` | **ค่าเวลาการดึง polling** (รอบที่กลับมาเช็กซ้ำ) | `1800` (30 นาที) |
| `strategyId` | **indicator 1 ตัว** | `supertrend` |
| `alertChannelId` *(ออปชัน)* | **ช่องแจ้งเตือนของ bot นี้** — เลือก channel ตอน `/bot create` แล้ว **บอทสร้าง webhook ในช่องนั้นให้เอง**; ไม่เลือก → fallback ไป `DISCORD_WEBHOOK_URL` ส่วนกลาง | `#alerts-btc` |

- สร้าง bot ได้หลายตัว (เลือกเหรียญอื่น = สร้าง bot ใหม่ ทับกันไม่ได้ถ้า 4 ค่าหลักซ้ำ)
- วงจรชีวิตต่อ bot: **เริ่ม (running) → หยุด (stopped) → ลบ (delete)**

> ⚠️ **สำคัญ: `interval` กับ `pollSec` เป็นคนละค่า**
> - `interval` = ขนาดแท่งเทียนที่ใช้คำนวณ indicator (30m candle)
> - `pollSec` = ความถี่ที่ระบบกลับมาดึงราคา/เช็กสัญญาณ (ทุก 30 นาที)
> ของเดิมรวมสองอย่างนี้เป็นตัวเดียว — ของใหม่ **ต้องแยก**

---

## A2. ภาพรวมโฟลว์

```
ขาเตือน (ออก) — tick scheduler:
  GitHub Actions (cron ทุก ~5 นาที) ──curl──► /api/cron/scan
     └ อ่าน bot ทั้งหมดที่ status=running จาก Redis
       → เลือกเฉพาะตัวที่ "ถึงรอบ" (now - lastPolledAt >= pollSec)
       → ดึง klines (Binance public) → computeAll + runBacktest
       → กันยิงซ้ำด้วย Redis (สัญญาณเปลี่ยนสถานะ) → ยิง Discord (ช่อง alert)
       → อัปเดต lastPolledAt ของ bot

ขาควบคุม (เข้า) — สั่งงานจาก Discord:
  /bot create | /bot list | /scan | /backtest | /config ──┐
  ปุ่ม ▶เริ่ม / ⏸หยุด / 🗑ลบ (ในช่องสถานะรวม) ──────────────┤──HTTP──► /api/discord/interactions
                                                            └ verify Ed25519 → อ่าน/เขียน bot ใน Redis
                                                              → แก้การ์ดสถานะใน Discord
```

---

## A3. การวิเคราะห์ข้อจำกัด (อ่านก่อนออกแบบ)

**1. polling per-bot บน serverless = "tick scheduler" ไม่ใช่ timer**
serverless ไม่มี process ค้าง → ตั้ง timer ต่อ bot ไม่ได้. วิธีเดียวที่ฟรี:
GitHub Actions ยิง cron ถี่คงที่ (เช่นทุก 5 นาที) แล้ว `/api/cron/scan` วนเช็กทุก bot ที่ `running`
ว่า `now - lastPolledAt >= pollSec*1000` ถ้าถึงรอบค่อยดึงข้อมูล → จึงรองรับ pollSec ต่างกันต่อ bot ได้
ด้วย cron เดียว

**2. ความละเอียด polling จริง = รอบ cron (~5 นาที)**
ดังนั้นตัวเลือก `pollSec` ควร **≥ 5 นาที** — sub-5min **ทำไม่ได้บนฟรี** (ต้องมีเครื่องเปิดค้าง 24 ชม.
ซึ่งฟรีไม่ได้บน Vercel). ค่าเริ่มต้น 30 นาทีปลอดภัย. ตัวเลือกแนะนำ:
`5m, 10m, 15m, 30m(default), 1h, 2h, 4h, 1d`

**3. ปุ่มกดควบคุมทำได้จริงบน HTTP Interactions**
คลิกปุ่ม = interaction `type 3 (MESSAGE_COMPONENT)`. การแก้การ์ดตอบกลับด้วย `type 7 (UPDATE_MESSAGE)`.
→ ช่องสถานะรวมมีปุ่ม เริ่ม/หยุด/ลบ ได้จริง แต่ต้องโพสต์ข้อความด้วย **Bot token** (ไม่ใช่ webhook)
จึงต้องมี env `DISCORD_STATUS_CHANNEL_ID`

**4. การ sync การ์ดสถานะ**
แต่ละ bot มี "การ์ดควบคุม" 1 ข้อความในช่องสถานะ → เก็บ `statusMessageId` ไว้แก้/ลบ
- create → โพสต์การ์ด, เก็บ messageId
- start/stop → แก้การ์ด (อัปเดตสถานะ + ปุ่ม)
- delete → ลบการ์ด + ลบ bot ออกจาก Redis

**5. กัน race เวลาเขียนพร้อมกัน**
หลาย tick / หลายคลิกอาจเขียนทับกัน → เก็บ bot เป็น **Redis hash `bot:bots` (field = botId)**
อัปเดตทีละ bot อะตอมมิก แทนการเขียน JSON array ทั้งก้อน

**6. กันสแปม (de-dup)**
ยิงเฉพาะเมื่อ "สัญญาณเปลี่ยนสถานะ" (เช่น HOLD→BUY) **และ** แท่ง `closeTime` นั้นยังไม่เคยยิง
(เทียบกับ `bot:lastAlert`) — กัน RSI ส่ง BUY ทุกแท่งที่ยัง oversold

---

## B. โครงสร้าง Data ใน Redis (Upstash)

| Key | ชนิด | เก็บอะไร |
|---|---|---|
| `bot:bots` | **hash** | field=`botId` → value=JSON `Bot` (อัปเดตทีละตัว, กัน race) |
| `bot:config` | string (JSON) | ค่า default ส่วนกลาง `{ defaultPollSec, limit, freshnessMin }` |
| `bot:lastAlert` | hash | field=`botId` → value=`closeTime|signal` (กันยิงซ้ำ) |

```ts
type BotStatus = "running" | "stopped";

interface Bot {
  id: string;              // = `${symbol}:${interval}:${pollSec}:${strategyId}` (composite, กันซ้ำ)
  symbol: string;          // "BTCUSDT"
  interval: string;        // ช่วงเวลาแท่งเทียน เช่น "30m"
  pollSec: number;         // ค่าเวลา polling วินาที (default 1800 = 30m)
  strategyId: StrategyId;  // indicator 1 ตัว
  status: BotStatus;       // running | stopped
  alertChannelId?: string; // (ออปชัน) channel ที่เลือกตอน create — บอทสร้าง webhook ในช่องนี้ให้เอง
  webhookUrl?: string;     // webhook URL ที่บอทสร้าง/หาเจอในช่อง alertChannelId — ไม่มี → ใช้ DISCORD_WEBHOOK_URL
  lastPolledAt: number;    // เวลาที่ดึงล่าสุด (ใช้ตัดสินว่าถึงรอบยัง)
  statusMessageId?: string;// id ข้อความการ์ดในช่องสถานะรวม
  createdBy: string;       // Discord user id
  createdAt: number;
}
```

---

## B2. ช่อง Discord (2–3 ช่อง)

| ช่อง | env | หน้าที่ |
|---|---|---|
| **ช่องสั่ง setting** | `DISCORD_COMMAND_CHANNEL_ID` (ออปชัน — ไว้จำกัดให้สั่งได้เฉพาะช่องนี้) | พิมพ์ `/bot create`, `/scan`, `/backtest`, `/config` — เลือกเหรียญ/ช่วงเวลา/poll/indicator |
| **ช่องสถานะรวม** | `DISCORD_STATUS_CHANNEL_ID` | (1) การ์ดควบคุมทุก bot ที่เปิดอยู่ + ปุ่ม ▶เริ่ม / ⏸หยุด / 🗑ลบ **(2) การ์ดสถานะระบบ/โควต้าฟรี** — ใช้ไป/เหลือ/ลิมิต ของแต่ละบริการ + ปุ่ม 🔄 รีเฟรช (ดู B3) |
| **ช่อง alert สัญญาณ** | `DISCORD_WEBHOOK_URL` (มีแล้ว) = **ค่า default ส่วนกลาง** | รับแจ้งเตือน BUY/SELL — **เลือก channel ต่อ bot ได้** ตอน `/bot create` (บอทสร้าง webhook ให้) |

> - ตอน `/bot create` ถ้าเลือก `channel` → บอทเรียก Discord REST สร้าง (หรือ reuse) webhook ในช่องนั้น
>   แล้วเก็บ `webhookUrl` ไว้กับ bot; ถ้าไม่เลือก → ใช้ `DISCORD_WEBHOOK_URL` ส่วนกลาง
>   → แยกเหรียญ/กลยุทธ์ไปคนละช่องได้ (เช่น BTC ช่องนึง, ETH อีกช่อง) โดยไม่ต้องพิมพ์ URL
> - ทั้ง 3 ใช้ช่องเดียวกันได้ ถ้าอยากเรียบง่าย — แค่ตั้ง id/URL ให้ชี้ช่องเดียวกัน

---

## B3. การ์ดสถานะระบบ + โควต้าฟรี (System / Quota card)

การ์ดเดียว (1 ข้อความปักหมุดในช่องสถานะรวม) ที่ดึง "การใช้งานของบริการที่รันอยู่ทั้งหมด" ออกมาแสดง:
**ใช้ไปเท่าไร / เหลือเท่าไร / ลิมิตฟรีอยู่ที่เท่าไร / กี่ %** มีปุ่ม 🔄 รีเฟรช (custom_id `sys:refresh`)

### สิ่งที่แสดง
| หมวด | ค่า | มาจาก |
|---|---|---|
| Bots | total / running / stopped | Redis `bot:bots` |
| Scan ticks (เดือนนี้) | จำนวนรอบ scheduler ที่รัน | self-count `usage:<YYYY-MM>` |
| Bot polls / Kline fetches (เดือนนี้) | จำนวนครั้งดึง Binance | self-count |
| Discord sends (เดือนนี้) | จำนวน alert ที่ยิง | self-count |
| Redis | keys (`DBSIZE`) + commands โดยประมาณ/เดือน | `DBSIZE` + self-count |
| GitHub Actions | นาทีที่ใช้ / included (เฉพาะ private repo) | GitHub billing API *(ออปชัน)* |
| Vercel | invocations โดยประมาณ (ข้อมูลประกอบ) | self-count |

แสดงเป็น progress bar ข้อความ เช่น `Redis cmds ███░░░░░░░ 32%  (160k / 500k)`

### แหล่งข้อมูล (สำคัญ — วิเคราะห์ความเป็นไปได้)
- **แหล่งความจริงหลัก = self-count ใน Redis**: เพิ่ม counter ทุกครั้งที่ทำงาน (scan tick, kline fetch,
  discord send, redis op) เก็บใน hash `usage:<YYYY-MM>` แล้วเทียบกับลิมิตฟรีที่ hardcode ไว้
  → แม่น, ฟรี, ไม่พึ่ง API ภายนอก, รีเซ็ตอัตโนมัติรายเดือนด้วย key ตามเดือน
- **เสริมจาก provider (ออปชัน)**:
  - GitHub Actions นาที: `GET /users/{user}/settings/billing/actions` (ต้องมี PAT `GITHUB_TOKEN`).
    *public repo = ไม่จำกัด/ไม่นับนาที → แสดง "unlimited"*
  - Upstash storage: คำสั่ง `DBSIZE` (จำนวน keys) ดึงได้ฟรีทันที
- **ดึงตรงไม่ได้**: Vercel Hobby ไม่มี API โควต้าคงเหลือที่สะอาด → ใช้ self-count invocations เป็น "ข้อมูลประกอบ"
  (ตัวเลขโดยประมาณ ไม่ใช่ค่าจริงจาก Vercel)

### ตารางลิมิตฟรี (อ้างอิง — hardcode ใน `lib/usage.ts`, ⚠️ ตรวจกับหน้า pricing เพราะเปลี่ยนได้)
| บริการ | ลิมิตฟรี (อ้างอิง) |
|---|---|
| Upstash Redis | **500,000 commands/เดือน**, **256 MB** storage |
| GitHub Actions | private: **2,000 นาที/เดือน** + 500 MB storage · public: **ไม่จำกัด** |
| Vercel Hobby | bandwidth ~**100 GB/เดือน**, fluid compute included (ไม่มี cap invocation ที่ประกาศชัด → ติดตามเชิงข้อมูล) |
| Discord | ไม่มีโควต้ารายเดือน (มีแค่ rate limit ~30 msg/นาที/webhook) |

---

## C. คำสั่ง & ปุ่ม (ควบคุมทั้งหมดผ่าน Discord)

### Slash commands
| คำสั่ง | ทำอะไร | ตอบแบบ |
|---|---|---|
| `/bot create symbol interval poll indicator [channel]` | สร้าง bot ใหม่ (status=stopped) → โพสต์การ์ดในช่องสถานะ; `channel` (ออปชัน) = เลือกช่องแจ้งเตือน → บอทสร้าง webhook ในช่องนั้นให้ | type 4 (ephemeral) + waitUntil โพสต์การ์ด |
| `/bot list` | ลิสต์ bot ทั้งหมด + สถานะ | type 4 |
| `/bot start id` / `/bot stop id` / `/bot delete id` | คุมจากคำสั่ง (ทำได้เหมือนปุ่ม) | type 4 |
| `/bot status` | รีเฟรช/โพสต์การ์ดควบคุม bot ทั้งหมด | type 4 |
| `/quota` | โพสต์/รีเฟรช **การ์ดสถานะระบบ + โควต้าฟรี** (ใช้ไป/เหลือ/ลิมิต) — ดู B3 | type 5 (deferred → PATCH ถ้าเรียก provider API) |
| `/scan [id]` | สั่งสแกนเดี๋ยวนี้ (manual) | type 5 (deferred) → PATCH |
| `/backtest symbol interval strategy` | backtest เฉพาะกิจ ดูสถิติ | type 5 (deferred) → PATCH |
| `/config show` / `/config set key value` | ค่า default ส่วนกลาง (default poll, freshness) | type 4 |
| `/help` | วิธีใช้ | type 4 |

- `interval` → ใช้ `choices` (16 ตัว < ลิมิต 25)
- `poll` → ใช้ `choices` (5m/10m/15m/30m/1h/2h/4h/1d)
- `indicator` (strategy 31 ตัว เกินลิมิต choices 25) → **autocomplete** (interaction type 4) หรือ string + validate กับ `STRATEGIES`
- `channel` *(ออปชัน)* → **CHANNEL option (type 7)** เลือกได้เฉพาะ text channel; handler นำ channel id ไป
  สร้าง/reuse webhook (ดู `lib/discord/rest.ts`) แล้วเก็บ `webhookUrl` กับ bot — ผู้ใช้ไม่ต้องเห็น/พิมพ์ URL เลย

### Buttons (ในช่องสถานะรวม) — interaction type 3
การ์ดต่อ bot: embed แสดง `symbol / interval / poll / indicator / status / สัญญาณล่าสุด` + แถวปุ่ม
- `custom_id = bot:start:<id>` → ▶ เริ่ม
- `custom_id = bot:stop:<id>` → ⏸ หยุด
- `custom_id = bot:delete:<id>` → 🗑 ลบ

คลิกแล้ว handler อัปเดต Redis → ตอบ `type 7 (UPDATE_MESSAGE)` เพื่อแก้การ์ดให้ตรงสถานะใหม่
(กรณีลบ → ลบ bot + ลบข้อความการ์ด)

**การ์ดสถานะระบบ (B3):** ปุ่ม `custom_id = sys:refresh` → ดึง usage ใหม่ → ตอบ `type 7 (UPDATE_MESSAGE)`
(ถ้าเรียก GitHub billing API ที่อาจช้า ใช้ `type 6 (DEFERRED_UPDATE_MESSAGE)` ก่อนแล้ว PATCH ตามหลัง)

---

## D. ไฟล์ที่ต้อง "สร้างใหม่"

### 1. `lib/store.ts` — ห่อ Upstash REST API ด้วย `fetch` ล้วน (zero-dep)
```ts
export async function getBots(): Promise<Bot[]>                 // HGETALL bot:bots
export async function getBot(id: string): Promise<Bot | null>  // HGET
export async function upsertBot(b: Bot): Promise<void>         // HSET (อะตอมมิกต่อ bot)
export async function deleteBot(id: string): Promise<void>     // HDEL + HDEL lastAlert
export async function getLastAlert(id: string): Promise<{ closeTime: number; signal: string } | null>
export async function setLastAlert(id: string, v): Promise<void>
export async function getConfig() / setConfig()
```
> ทางเลือก SDK `@upstash/redis` ก็ได้ แต่ fetch ล้วน = zero-dep ฟรีสนิท — **แนะนำ fetch ล้วน**

### 2. `lib/discord/verify.ts` — ตรวจลายเซ็น Ed25519 ด้วย Node `crypto` (built-in)
```ts
export function verifyDiscordRequest(rawBody, sigHeader, tsHeader, publicKeyHex): boolean
```

### 3. `lib/discord/rest.ts` — เรียก Discord REST ด้วย Bot token (การ์ดสถานะ + จัดการ webhook)
```ts
export async function postMessage(channelId, payload): Promise<{ id: string }>
export async function editMessage(channelId, messageId, payload): Promise<void>
export async function deleteMessage(channelId, messageId): Promise<void>

// สำหรับ alert channel ที่ผู้ใช้เลือกตอน /bot create:
// reuse webhook ที่แอปเราสร้างไว้ในช่องนั้น (GET แล้วกรองด้วย application_id) ถ้าไม่มีค่อยสร้างใหม่
export async function ensureChannelWebhook(channelId: string): Promise<string /* webhookUrl */>
//   ภายใน: GET  /channels/{id}/webhooks  → หา webhook ของแอปเรา
//          POST /channels/{id}/webhooks  { name: "Crypto Signal Bot" }  ถ้ายังไม่มี
//          คืน `${url}/{id}/{token}`  (ต้องมีสิทธิ์ Manage Webhooks ในช่องนั้น)
```

### 4. `lib/discord/components.ts` — ตัวสร้าง embed/ปุ่ม
- การ์ดควบคุม bot (embed + action row ปุ่ม start/stop/delete) + embed สัญญาณ
- **`buildSystemCard(usage, limits)`** — การ์ดสถานะระบบ/โควต้า (B3) พร้อม progress bar ข้อความ + ปุ่ม 🔄 `sys:refresh`

### 4b. `lib/usage.ts` — ตัวนับการใช้งาน + ลิมิตฟรี (สำหรับการ์ด B3)
```ts
export const FREE_LIMITS = { /* upstashCmds: 500_000, ghMinutes: 2000, ... (อ้างอิง B3) */ };
export async function bumpUsage(field, by = 1): Promise<void>  // HINCRBY usage:<YYYY-MM> field
export async function getUsage(month?): Promise<Record<string, number>>  // HGETALL
export async function getRedisKeyCount(): Promise<number>      // DBSIZE
export async function getGithubMinutes(): Promise<{ used: number; included: number } | null> // ออปชัน, ต้องมี GITHUB_TOKEN
```
> key ตามเดือน `usage:<YYYY-MM>` → รีเซ็ตเองอัตโนมัติทุกเดือน

### 5. `lib/discord/commands.ts` — นิยาม slash command (JSON) สำหรับ register

### 6. `app/api/discord/register/route.ts` — ลงทะเบียนคำสั่ง (ยิงครั้งเดียว, `?secret=CRON_SECRET`)
```ts
// PUT https://discord.com/api/v10/applications/{APP_ID}/commands   (Authorization: Bot <token>)
```

### 7. `app/api/discord/interactions/route.ts` — หัวใจฝั่งควบคุม
```ts
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  const raw = await req.text();                         // raw body สำหรับลายเซ็น
  if (!verifyDiscordRequest(raw, ...)) return 401;
  const body = JSON.parse(raw);

  if (body.type === 1) return json({ type: 1 });        // PING → PONG
  if (body.type === 2) {                                // APPLICATION_COMMAND
    switch (body.data.name) {
      case "bot":      /* create/list/start/stop/delete/status → Redis → type 4 (+waitUntil โพสต์การ์ด) */
      case "config":   /* type 4 */
      case "quota":    /* รวม usage (B3) → buildSystemCard → type 5 (deferred) → PATCH การ์ดสถานะระบบ */
      case "scan":     /* type 5 (deferred) → waitUntil(งานหนัก) → PATCH @original */
      case "backtest": /* type 5 */
    }
  }
  if (body.type === 3) {                                // MESSAGE_COMPONENT (ปุ่ม)
    // custom_id = "bot:start:<id>" | "bot:stop:<id>" | "bot:delete:<id>"
    //   → อัปเดต Redis → ตอบ type 7 (UPDATE_MESSAGE) แก้การ์ด / ลบข้อความ
    // custom_id = "sys:refresh"
    //   → รวม usage ใหม่ → ตอบ type 7 (UPDATE_MESSAGE) แก้การ์ดสถานะระบบ (B3)
  }
  if (body.type === 4) /* APPLICATION_COMMAND_AUTOCOMPLETE → ส่งรายชื่อ strategy ที่ match */
}
```
> งานหนัก (`/scan`, `/backtest`) ดึง Binance + คำนวณ อาจเกิน 3 วิ → ตอบ **deferred (type 5)** ก่อน
> แล้วใช้ `waitUntil()` จาก `@vercel/functions` รันต่อ แล้ว PATCH ข้อความเดิม
> (`PATCH /webhooks/{APP_ID}/{interaction.token}/messages/@original` — ใช้ interaction token ไม่ต้องใช้ bot token)

---

## E. ไฟล์ที่ต้อง "แก้"

### 8. `app/api/cron/scan/route.ts` → เปลี่ยนเป็น **tick scheduler**
- อ่าน bot ทั้งหมดจาก Redis เลือกเฉพาะ `status=running`
- คัดเฉพาะตัว **"ถึงรอบ"**: `now - lastPolledAt >= pollSec*1000`
- **จัดกลุ่มตาม `symbol+interval`** เพื่อดึง klines ครั้งเดียวต่อกลุ่ม (หลาย bot ใช้ klines ชุดเดียวกันได้)
- รัน `runBacktest` ต่อ strategy → ตรวจสัญญาณแท่งล่าสุด
- **De-dup "สัญญาณเปลี่ยนสถานะ"** ผ่าน `bot:lastAlert`
- ยิง Discord ไปยัง **`bot.webhookUrl ?? process.env.DISCORD_WEBHOOK_URL`** (per-bot webhook + fallback)
  → กลุ่มที่ดึง klines ร่วมกันได้ แต่ตอนยิง alert แยกตาม webhook ของแต่ละ bot
- อัปเดต `lastPolledAt`
- **นับ usage (B3):** `bumpUsage("scanTicks")` ต่อรอบ, `bumpUsage("klineFetches", n)`, `bumpUsage("discordSends", n)`
  → เป็นข้อมูลให้การ์ดสถานะระบบ

### 9. `.github/workflows/signal-poll.yml`
- ปรับ `cron` เป็น `*/5 * * * *` (tick ละเอียดสุด) — รอบ polling จริงของแต่ละ bot คุมที่ `pollSec` ใน Redis
- ไม่ต้องปลดคอมเมนต์ตาม timeframe อีก เพราะ scheduler จัดการ pollSec เอง

### 10. env (Vercel + `.env.local`) — เพิ่ม
```
DISCORD_PUBLIC_KEY=...          # Developer Portal → General Information
DISCORD_APPLICATION_ID=...      # = Client ID
DISCORD_BOT_TOKEN=...           # Bot → Reset Token (register + โพสต์การ์ดสถานะ)
DISCORD_STATUS_CHANNEL_ID=...   # ช่องสถานะรวม (การ์ด + ปุ่ม)
DISCORD_COMMAND_CHANNEL_ID=...  # (ออปชัน) จำกัดช่องสั่งคำสั่ง
KV_REST_API_URL=...             # Upstash inject ให้อัตโนมัติ
KV_REST_API_TOKEN=...           # Upstash inject ให้อัตโนมัติ
GITHUB_TOKEN=...                # (ออปชัน) PAT อ่าน Actions billing สำหรับการ์ดสถานะระบบ (B3)
GITHUB_BILLING_USER=...         # (ออปชัน) username/org เจ้าของ repo สำหรับ endpoint billing
# มีอยู่แล้ว: CRON_SECRET, DISCORD_WEBHOOK_URL
```

---

## F. ขั้นตอนตั้งค่า (ทำตามลำดับ)

1. **Discord Developer Portal** → New Application → เก็บ `Application ID` + `Public Key`;
   แท็บ Bot → Reset Token เก็บ `Bot Token`; เชิญบอทเข้า server ด้วย scope `bot` + `applications.commands`
   และให้สิทธิ์ **Send Messages + Manage Webhooks** (Manage Webhooks จำเป็นสำหรับสร้าง webhook ในช่องที่เลือก)
2. สร้าง **ช่องสถานะรวม** + **ช่องสั่ง setting** (+ ช่อง alert ถ้าจะแยก) → เก็บ channel id;
   ช่อง alert → สร้าง Webhook → `DISCORD_WEBHOOK_URL` (มีแล้ว)
3. **Upstash** → ใน Vercel project → Storage → Create → Upstash Redis (free) → auto-inject `KV_REST_API_*`
4. ใส่ env ที่เหลือใน Vercel แล้ว **deploy**
5. Developer Portal → ใส่ **Interactions Endpoint URL** = `https://<app>.vercel.app/api/discord/interactions`
   (Discord PING มา → ต้องตอบ PONG ถึงจะเซฟได้)
6. ยิง `https://<app>.vercel.app/api/discord/register?secret=<CRON_SECRET>` ครั้งเดียว → สร้าง slash commands
7. **GitHub repo** → Settings → Secrets → ใส่ `VERCEL_APP_URL` + `CRON_SECRET` → เปิด workflow
8. ทดสอบใน Discord:
   - ช่องสั่ง: `/bot create symbol:BTCUSDT interval:30m poll:30m indicator:supertrend`
   - ช่องสถานะ: เห็นการ์ด → กด ▶ เริ่ม
   - `/scan` ดูผลทันที → รอ tick cron ยิง alert จริง

---

## G. ยืนยันเงื่อนไข "ฟรี" ทุกจุด

| บริการ | ใช้ทำอะไร | ฟรี |
|---|---|---|
| Vercel Hobby | host endpoint + interactions | ✅ |
| GitHub Actions | tick scheduler (Vercel Cron บน Hobby = วันละครั้ง) | ✅ public ไม่จำกัด / private 2,000 นาที/เดือน |
| Upstash Redis | bot config + สถานะ + de-dup | ✅ 256MB / 500k cmd/เดือน |
| Binance public klines | ราคา (ไม่ต้องใช้ API key) | ✅ |
| Discord | คำสั่ง + ปุ่ม + แจ้งเตือน | ✅ |

> **dep ที่เพิ่ม:** อย่างมากแค่ `@vercel/functions` (เล็ก, มากับแพลตฟอร์ม) สำหรับ `waitUntil`
> ที่เหลือใช้ Node built-in (`crypto`) + `fetch` ล้วน → ไม่กระทบ free tier

---

## H. ข้อควรระวัง (สรุป)

- **polling per-bot บน serverless = tick scheduler** (ไม่ใช่ timer) — ความถี่จริงละเอียดสุด = รอบ cron (~5 นาที)
  → `pollSec` ควร ≥ 5 นาที, sub-5min ทำไม่ได้บนฟรี
- แยก `interval` (แท่งเทียน) กับ `pollSec` (รอบ polling) ให้ชัด
- Slash command ต้องตอบใน **3 วินาที** → `/scan`, `/backtest` ใช้ deferred (type 5) + `waitUntil`
- ปุ่มควบคุมต้องโพสต์ด้วย **Bot token** (ไม่ใช่ webhook) + ต้องมี `DISCORD_STATUS_CHANNEL_ID`
- **per-bot alert channel:** ผู้ใช้เลือก channel (ไม่พิมพ์ URL) → บอทสร้าง/reuse webhook ให้เอง
  ปลอดภัยกว่า (ไม่มี webhook token รั่วในแชต) แต่ **บอทต้องมีสิทธิ์ Manage Webhooks ในช่องนั้น**
  → ถ้าไม่มีสิทธิ์ ให้ handler แจ้ง error แบบ ephemeral แล้ว fallback ไป `DISCORD_WEBHOOK_URL`
- เก็บ bot เป็น **Redis hash field=botId** เพื่อกัน race
- de-dup ต้องเป็น **"สัญญาณเปลี่ยนสถานะ"** ไม่ใช่แค่ "มี BUY"
- `strategy` 31 ตัวเกินลิมิต choices 25 → ใช้ autocomplete
- Vercel function ฟรี = 60 วิ → tick เดียวสแกนได้หลายสิบ bot; ถ้าเยอะมากค่อยซอย
- **การ์ดสถานะระบบ/โควต้า (B3):** ตัวเลขหลักมาจาก **self-count** (เราเพิ่มเอง) จึงเป็น *ค่าโดยประมาณ*
  ไม่ใช่ค่าจริงจาก Vercel — provider ฟรีส่วนใหญ่ไม่เปิด API โควต้าคงเหลือ; GitHub billing/Upstash `DBSIZE`
  ใช้เสริมได้แต่เป็นออปชัน. ลิมิตฟรีที่ hardcode อาจเปลี่ยน ต้องตรวจกับหน้า pricing เป็นระยะ

---

## I. สรุปขอบเขตงาน

**8 ไฟล์ใหม่:** `lib/store.ts`, `lib/usage.ts`, `lib/discord/verify.ts`, `lib/discord/rest.ts`,
`lib/discord/components.ts`, `lib/discord/commands.ts`,
`app/api/discord/register/route.ts`, `app/api/discord/interactions/route.ts`

**3 ไฟล์แก้:** `app/api/cron/scan/route.ts` (→ tick scheduler + นับ usage), `.github/workflows/signal-poll.yml`, env

**8 ขั้นตอนตั้งค่า** ตามหัวข้อ F

### State machine ของ bot
```
        /bot create
            │
            ▼
        [stopped] ──▶เริ่ม (start / ปุ่ม)──▶ [running] ──(tick ถึงรอบ)──▶ ดึง+เช็ก→alert
            ▲                                   │
            └──────────⏸หยุด (stop / ปุ่ม)───────┘
            │                                   │
            └────────────🗑ลบ (delete / ปุ่ม)─────┴──▶ ลบออกจาก Redis + ลบการ์ด
```
