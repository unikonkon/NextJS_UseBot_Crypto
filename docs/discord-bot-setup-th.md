# คู่มือตั้งค่า: ทำให้บอทส่งสัญญาณ Discord รัน 24/7 (แม้ปิดเว็บ)

> เวอร์ชัน 1.0 — มิ.ย. 2026
> เอกสารนี้คือ **ภาคปฏิบัติของ [`discord-bot-close-web-analysis-th.md`](./discord-bot-close-web-analysis-th.md) ข้อ 4**
> หลังทำตามนี้ บอทจะ **ดึงราคา → คำนวณ indicator → ส่ง Discord เองทุก ๆ รอบ บนเซิร์ฟเวอร์** โดยไม่ต้องเปิดเว็บค้างไว้

---

## 0. โค้ดที่ระบบนี้ใช้ (สร้างครบแล้วในรีโป)

> ⚠️ ก่อนหน้านี้เอกสารวิเคราะห์เขียนว่า "ของมีครบแล้ว" แต่จริง ๆ โมดูลฝั่ง server ที่ route เรียกใช้ **ยังไม่ถูกสร้าง** — ตอนนี้สร้างครบแล้วตามรายการด้านล่าง โปรเจกต์จึง build/deploy ได้

| ไฟล์ | บทบาท |
|---|---|
| `app/api/cron/scan/route.ts` | endpoint โหมด 24/7 (tick scheduler) — auth ด้วย `CRON_SECRET` |
| `app/api/discord/interactions/route.ts` | รับคำสั่ง/ปุ่มจาก Discord (สร้าง/เริ่ม/หยุด/ลบบอท) |
| `app/api/discord/register/route.ts` | ลงทะเบียน slash command (ยิงครั้งเดียว) |
| `lib/store.ts` | Upstash Redis (เก็บบอท/config/lastAlert) ผ่าน REST `fetch` ล้วน |
| `lib/scanner.ts` | ดึง klines (Binance public) + คำนวณสัญญาณ (reuse `lib/backtest.ts`) |
| `lib/usage.ts` | นับการใช้งาน + ลิมิตฟรี (การ์ดสถานะ) |
| `lib/discord/rest.ts` · `components.ts` · `verify.ts` · `commands.ts` | Discord REST / embed+ปุ่ม / ตรวจลายเซ็น Ed25519 / นิยามคำสั่ง |
| `lib/types/bot.ts` | type `Bot`, `BotConfig`, `makeBotId` |
| `.github/workflows/signal-poll.yml` | ตัวปลุก cron ทุก 5 นาที (เปิดใช้แล้ว) |

---

## 1. มี 2 โหมดให้เลือก — เลือกอย่างน้อย 1

| | โหมด A — env `SCAN_*` (ง่ายสุด) | โหมด B — สร้างบอทผ่าน Discord |
|---|---|---|
| ตั้งบอทยังไง | ใส่ตัวแปร `SCAN_SYMBOLS/INTERVAL/STRATEGIES` บน Vercel | พิมพ์ `/bot create` ใน Discord |
| ต้องมี Upstash | ไม่จำเป็น (แต่แนะนำ — กันส่งซ้ำ) | **จำเป็น** |
| ต้องมี Discord Bot Token | ไม่ต้อง (ใช้แค่ Webhook) | **ต้องมี** (+ ลงทะเบียนคำสั่ง) |
| ปรับ `pollSec` รายบอท | ไม่ได้ (ทุกรอบ cron สแกนหมด) | ได้ (5m–1d ต่อบอท) |
| เหมาะกับ | อยากให้รันเร็วสุด เฝ้าไม่กี่คู่ | อยากคุมหลายบอท/หลายช่องผ่าน Discord |

> เริ่มจาก **โหมด A** ให้เห็นสัญญาณเข้า Discord ก่อน แล้วค่อยต่อยอดโหมด B ทีหลังได้

---

## 2. ตัวแปรที่ต้อง set (env บน Vercel)

### 2.1 จำเป็นเสมอ (ทั้งสองโหมด)

| Env | ค่า | ทำไมต้องมี |
|---|---|---|
| `CRON_SECRET` | สตริงลับ เช่นจาก `openssl rand -hex 32` | `/api/cron/scan` **fail-closed** — ไม่ตั้ง = ตอบ 401 ตลอด · ต้องตรงกับ GitHub Secret |
| `DISCORD_WEBHOOK_URL` | `https://discord.com/api/webhooks/xxx/yyy` | ช่องปลายทางรับสัญญาณ (ค่าที่อยู่ใน localStorage ของหน้าเว็บ **ไม่ตามมา**) |

### 2.2 โหมด A — env fallback (เลือกบอทด้วยตัวแปร)

| Env | ตัวอย่าง | ความหมาย |
|---|---|---|
| `SCAN_SYMBOLS` | `BTCUSDT,ETHUSDT,SOLUSDT` | เหรียญที่จะเฝ้า (คั่นด้วย `,`) |
| `SCAN_INTERVAL` | `1h` | timeframe แท่งเทียน |
| `SCAN_STRATEGIES` | `supertrend,cdc_actionzone,smc` | กลยุทธ์ (id จาก `lib/backtest.ts`) |
| `SCAN_LIMIT` | `500` | จำนวนแท่งที่ดึงมาคำนวณ (100–1000; SMC ต้อง ≥100) |
| `SIGNAL_FRESHNESS_MIN` | `15` | เตือนเฉพาะแท่งที่ปิดภายในกี่นาที (กันสัญญาณเก่า + เผื่อ cron ดีเลย์) |

> โหมด A: ทุกรอบ cron จะสแกนทุกคู่ × ทุกกลยุทธ์ (`pollSec = 0` = ทำทุกรอบ ~5 นาที)

### 2.3 แนะนำ — Upstash Redis (กันสแปม + เก็บบอทโหมด B)

| Env | มาจาก |
|---|---|
| `KV_REST_API_URL` หรือ `UPSTASH_REDIS_REST_URL` | Vercel → Storage → Upstash Redis (inject อัตโนมัติ) หรือ console.upstash.com |
| `KV_REST_API_TOKEN` หรือ `UPSTASH_REDIS_REST_TOKEN` | เช่นเดียวกัน |

> โค้ดรองรับ **ทั้งสองชื่อ** — ใช้ชื่อไหนก็ได้ที่ provider ให้มา
> ไม่ตั้ง Upstash ก็รันโหมด A ได้ แต่จะ **ไม่มี dedup** (อาจส่งสัญญาณเดิมซ้ำทุกรอบจนกว่าสัญญาณจะเปลี่ยน)

### 2.4 โหมด B — Discord Bot (คุมผ่านคำสั่ง/ปุ่ม)

| Env | มาจาก | จำเป็น? |
|---|---|---|
| `DISCORD_PUBLIC_KEY` | Developer Portal → General Information | ✅ (ตรวจลายเซ็น interaction) |
| `DISCORD_APPLICATION_ID` | = Client ID | ✅ |
| `DISCORD_BOT_TOKEN` | Bot → Reset Token | ✅ (register + โพสต์การ์ด + สร้าง webhook) |
| `DISCORD_STATUS_CHANNEL_ID` | id ช่องสถานะรวม | ✅ (ที่อยู่ของการ์ดควบคุม + ปุ่ม) |
| `DISCORD_GUILD_ID` | id เซิร์ฟเวอร์ | ออปชัน — ใส่เพื่อให้คำสั่งใช้ได้ทันที (ไม่ใส่ = global ~1 ชม.) |
| `GITHUB_TOKEN` / `GITHUB_BILLING_USER` | PAT + username | ออปชัน — แสดงนาที Actions ที่ใช้ในการ์ด `/quota` |

---

## 3. GitHub Secrets (ตัวปลุก cron)

repo → **Settings → Secrets and variables → Actions**:

| Secret | ค่า |
|---|---|
| `VERCEL_APP_URL` | `https://your-app.vercel.app` (ไม่มี `/` ปิดท้าย) |
| `CRON_SECRET` | **ค่าเดียวกับ** env บน Vercel |

---

## 4. ขั้นตอนทำตามลำดับ

### โหมด A (เร็วสุด)
1. **Deploy ขึ้น Vercel** (รันแค่ `localhost` ปิดเครื่องก็หยุด)
2. ตั้ง env บน Vercel: `CRON_SECRET`, `DISCORD_WEBHOOK_URL`, `SCAN_SYMBOLS`, `SCAN_INTERVAL`, `SCAN_STRATEGIES`, `SCAN_LIMIT`, `SIGNAL_FRESHNESS_MIN` (+ Upstash ถ้ามี)
3. ตั้ง GitHub Secrets: `VERCEL_APP_URL`, `CRON_SECRET`
4. workflow `.github/workflows/signal-poll.yml` เปิดใช้แล้ว (cron ทุก 5 นาที) — push เข้า repo ให้ GitHub เห็น
5. ทดสอบ (ดูข้อ 5)

### โหมด B (เพิ่มจาก A)
6. **Discord Developer Portal** → New Application → เก็บ `Application ID` + `Public Key`; แท็บ Bot → Reset Token; เชิญบอทเข้า server ด้วย scope `bot` + `applications.commands` และสิทธิ์ **Send Messages + Manage Webhooks**
7. สร้าง **ช่องสถานะรวม** → เก็บ id ใส่ `DISCORD_STATUS_CHANNEL_ID`
8. สร้าง Upstash Redis แล้วใส่ env (ข้อ 2.3) → **redeploy**
9. ใส่ **Interactions Endpoint URL** ใน Portal = `https://<app>.vercel.app/api/discord/interactions` (Discord จะยิง PING มา → ต้องตอบ PONG ถึงเซฟได้)
10. ยิงครั้งเดียว: `https://<app>.vercel.app/api/discord/register?secret=<CRON_SECRET>` → สร้าง slash command
11. ใน Discord: `/bot create symbol:BTCUSDT interval:30m poll:30m indicator:supertrend` → ไปกด ▶️ เริ่ม ที่ช่องสถานะ

---

## 5. ทดสอบ

1. แท็บ **Actions** → workflow **Crypto Signal Poll** → กด **Run workflow** (`workflow_dispatch`)
2. ดู log ควรขึ้น `HTTP 200` + JSON เช่น:
   ```json
   { "ok": true, "mode": "env", "due": 3, "candidates": 1, "sent": 1, "errors": [] }
   ```
   - `mode`: `env` (โหมด A) หรือ `bots` (โหมด B)
   - `due`: จำนวนบอทที่ถึงรอบ · `sent`: จำนวน alert ที่ยิงเข้า Discord
3. เช็กว่ามีข้อความเข้า Discord channel
4. ทดสอบตรงก็ได้:
   ```bash
   curl -H "Authorization: Bearer <CRON_SECRET>" "https://<app>.vercel.app/api/cron/scan"
   ```

---

## 6. ความถี่ & โควต้าฟรี (สรุป)

| ต้องการ | ตัวปลุก | หมายเหตุ |
|---|---|---|
| ทุก ~5 นาที | GitHub Actions (ตั้งไว้แล้ว) | repo **public = ฟรีไม่จำกัด**; private 2,000 นาที/เดือน → cron 5 นาทีจะ**เกิน** ต้องห่าง ≥30 นาที หรือทำ public |
| ทุก 1 นาที | cron-job.org / Cloudflare Cron ยิง `GET .../api/cron/scan?secret=XXX` | ไม่กิน GitHub minutes |
| ทุก 1 วัน | Vercel Cron native (`vercel.json`) | ฟรีบน Hobby ได้แค่วันละครั้ง |

> `pollSec` รายบอท (โหมด B) จริง ๆ ละเอียดสุดได้เท่ารอบ cron — ตั้ง cron ถี่สุดที่ใช้ได้ แล้วให้ `pollSec` คุมรอบจริง

---

## 7. แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|---|---|
| `/api/cron/scan` ตอบ `401` | ไม่ได้ตั้ง `CRON_SECRET` บน Vercel หรือไม่ตรงกับที่ส่งมา |
| `due > 0` แต่ `sent = 0` | ยังไม่มีสัญญาณ BUY/SELL บนแท่งล่าสุด หรือไม่มี `DISCORD_WEBHOOK_URL`/`bot.webhookUrl` |
| ส่งสัญญาณเดิมซ้ำทุกรอบ | ยังไม่ได้ตั้ง Upstash → ไม่มี dedup (`lastAlert`) |
| Discord เซฟ Interactions URL ไม่ได้ | `DISCORD_PUBLIC_KEY` ผิด หรือยังไม่ deploy เวอร์ชันล่าสุด |
| `/bot create` ขึ้น "ยังไม่ได้ตั้งค่า Upstash" | โหมด B ต้องมี `KV_REST_API_URL/TOKEN` |
| คำสั่งไม่โผล่ใน Discord | ยังไม่ได้ยิง `/api/discord/register` หรือเป็น global (รอ ~1 ชม.) → ใส่ `DISCORD_GUILD_ID` เพื่อให้ทันที |
| scheduled workflow หยุดเอง | repo ไม่มี activity ติดต่อกัน 60 วัน → GitHub ปิดให้ ต้อง commit เป็นระยะ/กดเปิดใหม่ |

---

## 8. รายการ env แบบคัดลอกใช้ได้ (.env เทมเพลต)

```bash
# ── จำเป็นเสมอ ──
#CRON_SECRET=เปลี่ยนเป็นค่าสุ่มยาว ๆ
CRON_SECRET=897191ec-0f42-40e2-a50a-ca9a01057da3
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/1512163956381454546/FaZo-SmiLnyxLqqCo0FCtyFc9-ejDDIE52X67N46rEmsPstJRKLrVv6jJBTBQj8Zl854

# ── โหมด A (env fallback) ──
SCAN_SYMBOLS=BTCUSDT
SCAN_INTERVAL=1h
SCAN_STRATEGIES=smc
SCAN_LIMIT=500
SIGNAL_FRESHNESS_MIN=15

# ── Upstash (แนะนำ — กันส่งซ้ำ + เก็บบอทโหมด B) ──
KV_REST_API_URL=
KV_REST_API_TOKEN=

# ── โหมด B (Discord Bot) ──
DISCORD_PUBLIC_KEY=
DISCORD_APPLICATION_ID=
DISCORD_BOT_TOKEN=
DISCORD_STATUS_CHANNEL_ID=
DISCORD_GUILD_ID=

# ── ออปชัน: แสดงนาที GitHub Actions ในการ์ด /quota ──
GITHUB_TOKEN=
GITHUB_BILLING_USER=
```

> GitHub repo → ตั้ง **2 secrets** เพิ่ม: `VERCEL_APP_URL`, `CRON_SECRET` (ค่าเดียวกับ Vercel)
