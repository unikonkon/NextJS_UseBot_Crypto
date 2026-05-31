# คู่มือใช้งาน + ตั้งค่า/Build — Crypto Signal Bot (ควบคุมผ่าน Discord)

ระบบดึงราคาเหรียญ → รันผ่าน `lib/indicators.ts` (ผ่าน `lib/backtest.ts`) แบบ polling →
ถ้ามีสัญญาณ **BUY/SELL** ส่งเข้า Discord — **ควบคุมทั้งหมดผ่าน Discord ไม่มี web หน้าบ้าน**
ทุกบริการอยู่บน **free tier** (Vercel Hobby + GitHub Actions + Upstash Redis)

> สถาปัตยกรรมแบบละเอียดดูที่ [`discord-bot-plan.md`](./discord-bot-plan.md)

---

## 1. ภาพรวมระบบ

```
ขาเตือน:  GitHub Actions (cron ทุก 5 นาที) ──curl──► /api/cron/scan
             └ อ่าน bot จาก Redis → เลือกตัวที่ถึงรอบ (pollSec)
               → ดึง klines (Binance public) → runBacktest
               → กันยิงซ้ำ → ยิง Discord webhook

ขาควบคุม: Discord /bot,/scan,/quota,... + ปุ่ม ──HTTP──► /api/discord/interactions
             └ verify Ed25519 → อ่าน/เขียน Redis → ตอบกลับ/แก้การ์ด
```

**ไฟล์หลักที่เกี่ยวข้อง**

| ไฟล์ | หน้าที่ |
|---|---|
| `lib/types/bot.ts` | ชนิดข้อมูล `Bot`, `BotConfig`, `makeBotId()` |
| `lib/store.ts` | อ่าน/เขียน Upstash Redis (REST, fetch ล้วน) |
| `lib/usage.ts` | ตัวนับการใช้งาน + `FREE_LIMITS` (การ์ดสถานะระบบ) |
| `lib/scanner.ts` | ดึง klines + ประเมินสัญญาณ (`evaluateBots`, `peekBots`) |
| `lib/discord/verify.ts` | ตรวจลายเซ็น Ed25519 ของ Discord |
| `lib/discord/rest.ts` | เรียก Discord REST (โพสต์/แก้/ลบการ์ด + สร้าง webhook) |
| `lib/discord/components.ts` | สร้าง embed/ปุ่ม (การ์ดบอท, สัญญาณ, การ์ดระบบ) |
| `lib/discord/commands.ts` | นิยาม slash commands |
| `app/api/discord/interactions/route.ts` | รับคำสั่ง/ปุ่ม/autocomplete จาก Discord |
| `app/api/discord/register/route.ts` | ลงทะเบียน slash commands (ยิงครั้งเดียว) |
| `app/api/cron/scan/route.ts` | tick scheduler — สแกน + ยิงแจ้งเตือน |
| `.github/workflows/signal-poll.yml` | ตัวจับเวลา cron ทุก 5 นาที |

---

## 2. สิ่งที่ต้องเตรียม (ฟรีทั้งหมด)

1. บัญชี **GitHub** (มี repo ของโปรเจกต์นี้)
2. บัญชี **Vercel** (Hobby) เชื่อมกับ GitHub
3. **Discord** server ที่เราเป็นแอดมิน + สิทธิ์สร้าง Application
4. **Upstash** (สมัครผ่าน Vercel Marketplace ได้เลย)

---

## 3. ตาราง Environment Variables

คัดลอก `.env.example` → ตั้งค่าใน **Vercel → Settings → Environment Variables**
(และ `.env.local` ถ้าจะรันในเครื่อง)

| ตัวแปร | จำเป็น | ใช้ทำอะไร |
|---|---|---|
| `CRON_SECRET` | ✅ | กันคนนอกยิง `/api/cron/scan` และ `/api/discord/register` |
| `DISCORD_PUBLIC_KEY` | ✅ | ตรวจลายเซ็น interaction |
| `DISCORD_APPLICATION_ID` | ✅ | register commands + follow-up + ตรวจ webhook ของแอป |
| `DISCORD_BOT_TOKEN` | ✅ | register + โพสต์/แก้/ลบการ์ด + สร้าง webhook |
| `DISCORD_STATUS_CHANNEL_ID` | ✅ | ช่องสถานะรวม (การ์ดควบคุม + ปุ่ม) |
| `DISCORD_WEBHOOK_URL` | ✅ | ช่องแจ้งเตือน "ค่าเริ่มต้น" (per-bot override ได้) |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | ✅ | Upstash Redis (Vercel inject ให้) |
| `DISCORD_GUILD_ID` | ⬜ | register แบบ guild = ใช้ได้ทันที (เหมาะตอนทดสอบ) |
| `DISCORD_COMMAND_CHANNEL_ID` | ⬜ | จำกัดช่องที่สั่งคำสั่งได้ |
| `GITHUB_TOKEN` / `GITHUB_BILLING_USER` | ⬜ | แสดงนาที Actions ในการ์ด `/quota` (private repo) |
| `SCAN_SYMBOLS` / `SCAN_INTERVAL` / `SCAN_STRATEGIES` / `SCAN_LIMIT` / `SIGNAL_FRESHNESS_MIN` | ⬜ | โหมด fallback ของ scan ก่อนสร้างบอทผ่าน Discord |

---

## 4. Build & รันในเครื่อง

```bash
# 1) ติดตั้ง dependency
npm install

# 2) สร้าง .env.local จากตัวอย่าง แล้วเติมค่า
cp .env.example .env.local
#   (อย่างน้อยใส่ค่า Discord + Upstash + CRON_SECRET)

# 3) dev (ทดสอบ build/route)
npm run dev          # http://localhost:3000

# 4) production build (ตรวจ type + lint + คอมไพล์)
npm run build
npm start
```

> ⚠️ ฝั่งควบคุม Discord ต้องมี **public URL** (Discord ยิง interaction เข้ามา) — รันในเครื่องเฉย ๆ
> Discord เข้าไม่ถึง ต้อง deploy ขึ้น Vercel หรือ tunnel (เช่น `ngrok`) เพื่อทดสอบ interaction

---

## 5. Deploy ขึ้น Vercel

1. Push โค้ดขึ้น GitHub
2. Vercel → **New Project** → เลือก repo → Deploy
3. หลัง deploy ครั้งแรก จดโดเมน เช่น `https://your-app.vercel.app`
4. (ภูมิภาค) `vercel.json` ตั้ง `sin1` (สิงคโปร์) ไว้แล้ว — เลี่ยงบล็อกของ Binance ในบาง region

---

## 6. ตั้งค่า Discord Application

> ทุกค่าที่ได้จากขั้นตอนนี้จะถูกนำไปใส่เป็น environment variable
> สรุป map ค่า → ตัวแปร → ไฟล์ ไว้ที่ **ข้อ 6.7** ด้านล่าง

### 6.1 สร้าง Application
1. ไป https://discord.com/developers/applications → **New Application** → ตั้งชื่อ → Create

### 6.2 General Information → เอา 2 ค่า
- คัดลอก **Application ID** → `DISCORD_APPLICATION_ID`
- คัดลอก **Public Key** → `DISCORD_PUBLIC_KEY`

> `Application ID` = "client_id" (ไม่ใช่ความลับ) · `Public Key` ใช้ตรวจลายเซ็น interaction

### 6.3 Bot → เอา Token
1. เมนูซ้าย **Bot** → **Reset Token** → ยืนยัน → คัดลอก → `DISCORD_BOT_TOKEN`
   - ⚠️ token โชว์ครั้งเดียว ถ้าพลาดให้ Reset ใหม่
2. **Privileged Gateway Intents** — ระบบนี้ใช้ HTTP Interactions ล้วน **ไม่ต้องเปิด intent ใด ๆ**
   (Presence / Server Members / Message Content = ปิดได้หมด)
3. แนะนำปิด **"Requires OAuth2 Code Grant"** (ต้องเป็น OFF) และจะปิด **"Public Bot"** ก็ได้
   ถ้าไม่อยากให้คนอื่นเชิญบอทของคุณ

### 6.4 OAuth2 → URL Generator (สร้างลิงก์เชิญบอท)
**"URL Generator" อยู่ที่ไหน:** เมนูซ้ายของ Application → **OAuth2** → หัวข้อ **URL Generator**
(เป็นเครื่องมือสร้างลิงก์ OAuth2 สำหรับเชิญบอทเข้า server พร้อมกำหนดสิทธิ์)

1. **SCOPES** — ติ๊ก 2 ช่อง:
   - ☑️ `bot` — ให้แอปมี "ตัวบอท" เข้า server (โพสต์ข้อความ/สร้าง webhook ได้)
   - ☑️ `applications.commands` — ให้ใช้/ลงทะเบียน **slash commands** ได้
   > ติ๊ก `bot` แล้วจะมีกล่อง **BOT PERMISSIONS** โผล่ขึ้นมาด้านล่าง

2. **BOT PERMISSIONS** — ติ๊ก 4 อย่าง (สิทธิ์ขั้นต่ำที่ระบบนี้ต้องใช้):
   | สิทธิ์ | ทำไมต้องมี |
   |---|---|
   | ☑️ **View Channels** | ให้บอทเห็นช่องที่จะโพสต์ |
   | ☑️ **Send Messages** | โพสต์การ์ดควบคุม + ข้อความ |
   | ☑️ **Embed Links** | ส่ง embed (การ์ด/สัญญาณ) ได้ |
   | ☑️ **Manage Webhooks** | สร้าง webhook ในช่องที่เลือกตอน `/bot create` |
   > รวมเป็นเลขสิทธิ์ `permissions=536890368`

3. **GENERATED URL** (ล่างสุด) → กด **Copy** จะได้ลิงก์หน้าตาแบบนี้:
   ```
   https://discord.com/api/oauth2/authorize?client_id=<DISCORD_APPLICATION_ID>&permissions=536890368&scope=bot+applications.commands
   ```
   ของโปรเจกต์นี้ (Application ID = `1509846133864796252`) ลิงก์พร้อมใช้คือ:
   ```
   https://discord.com/api/oauth2/authorize?client_id=1509846133864796252&permissions=536890368&scope=bot+applications.commands
   ```
   > สังเกต `client_id` ในลิงก์ = ค่าเดียวกับ `DISCORD_APPLICATION_ID` ใน `.env`

### 6.5 เปิดลิงก์ → เลือก server → Authorize
1. เปิด URL ที่ copy มา ในเบราว์เซอร์ที่ **ล็อกอิน Discord** อยู่ (บัญชีที่เป็นแอดมิน server)
2. หน้าจอ Discord จะเด้งกล่อง **"ADD TO SERVER"** → เลือก server ปลายทางจาก dropdown → **Continue**
3. หน้าถัดไปจะโชว์สิทธิ์ทั้ง 4 → กด **Authorize** → ผ่าน captcha
4. กลับไปที่ Discord จะเห็นบอทปรากฏใน member list (ออฟไลน์ได้ปกติ — เพราะใช้ HTTP ไม่ต้อง online)

### 6.6 สร้างช่อง + เอา Channel ID / Webhook
เปิด **Developer Mode** ก่อน (Discord → User Settings → Advanced → Developer Mode = ON)
แล้วคลิกขวาที่ชื่อช่อง → **Copy Channel ID**

- **ช่องสถานะรวม** → Copy Channel ID → `DISCORD_STATUS_CHANNEL_ID`
- **ช่อง alert** → Edit Channel → Integrations → Webhooks → **New Webhook** → Copy Webhook URL → `DISCORD_WEBHOOK_URL`
- (ออปชัน) **ช่องสั่ง setting** → Copy Channel ID → `DISCORD_COMMAND_CHANNEL_ID`
- จะใช้ช่องเดียวกันทั้งหมดก็ได้

### 6.7 สรุป: ค่าจาก Discord → ตัวแปร env → ไฟล์
| ได้จาก Discord | ตัวแปร env | ค่าในโปรเจกต์นี้ (ตัวอย่าง) |
|---|---|---|
| General Information → Application ID | `DISCORD_APPLICATION_ID` | `1509846133864796252` |
| General Information → Public Key | `DISCORD_PUBLIC_KEY` | `f3907b10…de2f66` |
| Bot → Token | `DISCORD_BOT_TOKEN` | (ความลับ — ดูคำเตือนด้านล่าง) |
| ช่องสถานะรวม → Channel ID | `DISCORD_STATUS_CHANNEL_ID` | `1509848846442827789` |
| ช่อง alert → Webhook URL | `DISCORD_WEBHOOK_URL` | *(ยังว่าง — ไปสร้าง webhook)* |
| (ออปชัน) ช่องสั่ง → Channel ID | `DISCORD_COMMAND_CHANNEL_ID` | *(เว้นว่างได้)* |
| (ออปชัน) Server (Guild) ID | `DISCORD_GUILD_ID` | *(ใส่เพื่อ register แบบ guild = เห็นคำสั่งทันที)* |

> **`.env.example` vs `.env.local` — ใส่ค่าจริงที่ไหน:**
> - `.env.example` = **แม่แบบ** (ค่าว่าง) ไว้ดูว่ามีตัวแปรอะไรบ้าง — **ห้ามใส่ค่าจริง** โดยเฉพาะ `DISCORD_BOT_TOKEN`
> - `.env.local` = **ค่าจริงสำหรับรันในเครื่อง** (ถูก `.gitignore` ครอบไว้แล้ว) — ที่นี่อยู่แล้ว: `CRON_SECRET`, `DISCORD_WEBHOOK_URL`
>   → เพิ่ม `DISCORD_PUBLIC_KEY` / `DISCORD_APPLICATION_ID` / `DISCORD_BOT_TOKEN` / `DISCORD_STATUS_CHANNEL_ID` ลงไฟล์นี้
> - **Production:** ใส่ค่าจริงใน **Vercel → Settings → Environment Variables** (ไม่ใช้ `.env.local` บน Vercel)
>
> ⚠️ **ความปลอดภัย:** ถ้าเผลอวาง `DISCORD_BOT_TOKEN` ลง `.env.example` (หรือที่ไหนที่อาจ commit) ให้ถือว่า token นั้น "หลุด"
> → ไป **Bot → Reset Token** ออก token ใหม่ แล้วเก็บไว้ใน `.env.local` / Vercel เท่านั้น

### 6.8 redeploy
หลังตั้ง env ครบ → **redeploy** บน Vercel เพื่อให้โหลดค่าใหม่

---

## 7. ตั้งค่า Upstash Redis (ฟรี)

1. Vercel → โปรเจกต์ → แท็บ **Storage** → **Create Database** → **Upstash Redis** (Free)
2. เชื่อมกับโปรเจกต์ → Vercel จะ inject `KV_REST_API_URL` + `KV_REST_API_TOKEN` อัตโนมัติ
3. redeploy

---

## 8. ตั้ง Interactions Endpoint URL (สำคัญ)

1. Developer Portal → แอปของเรา → **General Information**
2. ช่อง **Interactions Endpoint URL** ใส่:
   ```
   https://your-app.vercel.app/api/discord/interactions
   ```
3. กด **Save** — Discord จะส่ง PING มาตรวจ ถ้าโค้ด/`DISCORD_PUBLIC_KEY` ถูกต้อง จะเซฟผ่าน
   - ❌ เซฟไม่ผ่าน = `DISCORD_PUBLIC_KEY` ผิด หรือยังไม่ deploy โค้ด หรือ URL ผิด

---

## 9. ลงทะเบียน Slash Commands (ยิงครั้งเดียว)

เปิด URL นี้ในเบราว์เซอร์ (แทน `<...>` ด้วยค่าจริง):
```
https://your-app.vercel.app/api/discord/register?secret=<CRON_SECRET>
```
- ตั้ง `DISCORD_GUILD_ID` ไว้ → ลงแบบ **guild** เห็นทันที (เหมาะทดสอบ)
- ไม่ตั้ง → ลงแบบ **global** อาจรอถึง ~1 ชม.
- ต้องยิงซ้ำทุกครั้งที่ **เพิ่ม/แก้ชื่อคำสั่ง** ใน `lib/discord/commands.ts`

ผลลัพธ์ที่ถูกต้อง: `{"ok":true,"scope":"guild","count":6,...}`

---

## 10. ตั้งค่า GitHub Actions (ตัวจับเวลา)

1. GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**
   - `VERCEL_APP_URL` = `https://your-app.vercel.app` (ห้ามมี `/` ปิดท้าย)
   - `CRON_SECRET` = ค่าเดียวกับใน Vercel
2. แท็บ **Actions** → เปิดใช้งาน workflow `Crypto Signal Poll`
3. ทดสอบ: กด **Run workflow** เอง (workflow_dispatch) → ดู log ว่า HTTP 200

> cron ตั้งไว้ `*/5 * * * *` (ทุก 5 นาที). รอบ poll จริงของแต่ละบอทคุมด้วย `pollSec`
> เช่นบอท 30 นาที จะถูกดึงจริงทุก ~30 นาที แม้ cron จะเด้งทุก 5 นาที

---

## 11. คำสั่งใน Discord (วิธีใช้งานจริง)

### สร้างและคุมบอท
| คำสั่ง | ตัวอย่าง / คำอธิบาย |
|---|---|
| `/bot create` | `symbol:BTCUSDT interval:30m poll:30 นาที indicator:Supertrend [channel:#alerts]` — สร้างบอท (เริ่มสถานะ "หยุด") |
| `/bot list` | ดูบอททั้งหมด + สถานะ |
| `/bot start <id>` | เริ่มบอท (พิมพ์ id แล้วมี autocomplete ให้เลือก) |
| `/bot stop <id>` | หยุดบอท |
| `/bot delete <id>` | ลบบอท |
| `/bot status` | โพสต์/รีเฟรชการ์ดควบคุมทุกบอทในช่องสถานะ |

- **indicator** พิมพ์เพื่อค้นหา (autocomplete) — มีให้เลือก 31 กลยุทธ์
- **channel** (ออปชัน) เลือกช่อง → บอท **สร้าง webhook ในช่องนั้นให้เอง** (ไม่ต้องพิมพ์ URL)
  ถ้าบอทไม่มีสิทธิ์ Manage Webhooks จะ fallback ไปใช้ `DISCORD_WEBHOOK_URL`

### ดูสัญญาณ / ทดสอบ / ระบบ
| คำสั่ง | คำอธิบาย |
|---|---|
| `/scan [id]` | ดูสัญญาณปัจจุบันเดี๋ยวนี้ (ไม่ใส่ id = ทุกบอทที่กำลังทำงาน) |
| `/backtest symbol interval strategy` | ทดสอบกลยุทธ์ย้อนหลัง — โชว์ กำไร/Win rate/Profit factor/Max DD |
| `/quota` | การ์ดสถานะระบบ + โควต้าฟรี (กด 🔄 รีเฟรชได้) |
| `/config show` | ดูค่าเริ่มต้นส่วนกลาง |
| `/config set key value` | ตั้ง `defaultPollSec` / `limit` / `freshnessMin` |
| `/help` | สรุปคำสั่ง |

### ปุ่มในช่องสถานะรวม
แต่ละบอทมีการ์ด 1 ใบ พร้อมปุ่ม **▶️ เริ่ม / ⏸️ หยุด / 🗑️ ลบ** — กดควบคุมได้เลยไม่ต้องพิมพ์คำสั่ง
การ์ดสถานะระบบ (`/quota`) มีปุ่ม **🔄 รีเฟรช**

---

## 12. polling ทำงานยังไง (tick scheduler)

- serverless ไม่มี timer ค้าง → ใช้ cron ยิงถี่ (5 นาที) แล้ว endpoint เลือกบอทที่ "ถึงรอบ"
  (`now - lastPolledAt >= pollSec`)
- **`interval` (แท่งเทียน) ≠ `pollSec` (รอบดึง)** — เช่น interval 30m + poll 1 ชม. = ใช้แท่ง 30 นาที
  แต่กลับมาเช็กทุก 1 ชม.
- ความถี่จริงละเอียดสุด ≈ รอบ cron (5 นาที) → `pollSec` ขั้นต่ำ 5 นาที (sub-5min ทำไม่ได้บนฟรี)
- ยิงเตือนเฉพาะ **"สัญญาณเปลี่ยนสถานะ"** (HOLD→BUY/SELL หรือสลับฝั่ง) บนแท่งล่าสุดที่ยัง "สด"
  และยังไม่เคยยิงสำหรับแท่งนั้น (กันสแปม)

---

## 13. โควต้าฟรี (`/quota`)

ตัวเลขกิจกรรม (scan ticks / kline fetches / discord sends) มาจาก **การนับฝั่งเรา (self-count)**
ใน Redis รายเดือน → เป็นค่าโดยประมาณ ไม่ใช่ค่าจริงจาก Vercel

ลิมิตฟรีอ้างอิง (hardcode ใน `lib/usage.ts`, ⚠️ ตรวจกับหน้า pricing เป็นระยะ):

| บริการ | ลิมิตฟรี |
|---|---|
| Upstash Redis | 500,000 commands/เดือน · 256 MB |
| GitHub Actions | private 2,000 นาที/เดือน · public ไม่จำกัด |
| Vercel Hobby | bandwidth ~100 GB/เดือน |
| Discord | ไม่มีโควต้ารายเดือน (มี rate limit) |

---

## 14. ลำดับทดสอบแบบเร็ว (smoke test)

1. `/api/discord/register?secret=...` → ได้ `ok:true`
2. ใน Discord พิมพ์ `/help` → เห็นข้อความช่วยเหลือ = interaction ทำงาน
3. `/bot create symbol:BTCUSDT interval:5m poll:5 นาที indicator:Supertrend`
4. ดูช่องสถานะ → เห็นการ์ด → กด **▶️ เริ่ม**
5. `/scan` → เห็นสัญญาณปัจจุบัน
6. แท็บ GitHub Actions → Run workflow → ดู log `HTTP 200`
7. รอสัญญาณเปลี่ยนสถานะ → ได้ alert ในช่อง

---

## 15. แก้ปัญหา (Troubleshooting)

| อาการ | สาเหตุ/วิธีแก้ |
|---|---|
| เซฟ Interactions Endpoint URL ไม่ผ่าน | `DISCORD_PUBLIC_KEY` ผิด / ยังไม่ deploy / URL ผิด |
| พิมพ์ `/` แล้วไม่เห็นคำสั่ง | ยังไม่ register (ข้อ 9) หรือ global ยังไม่ propagate → ใช้ `DISCORD_GUILD_ID` |
| `/bot create` ตอบ "ยังไม่ได้ตั้งค่า Upstash" | ยังไม่มี `KV_REST_API_URL/TOKEN` (ข้อ 7) |
| สร้างบอทแล้วไม่มีการ์ด | ยังไม่ตั้ง `DISCORD_STATUS_CHANNEL_ID` หรือบอทไม่มีสิทธิ์ส่งข้อความในช่อง |
| เลือก channel แล้วไม่ได้ webhook | บอทไม่มีสิทธิ์ **Manage Webhooks** → fallback ไป `DISCORD_WEBHOOK_URL` |
| ไม่มี alert มาเลย | ตรวจ GitHub Actions log (HTTP 200?), บอท `status=running?`, ถึงรอบ `pollSec` ยัง, มีสัญญาณเปลี่ยนสถานะไหม |
| ยิง `/api/cron/scan` ได้ 401 | `CRON_SECRET` ไม่ตรงกันระหว่าง Vercel กับ GitHub secret |
| `/scan`/`/backtest` ขึ้น "คิดอยู่..." ค้าง | งานช้าเกิน — ดู Vercel Function Logs; ปกติ deferred แล้ว PATCH ผลตามมา |

---

## 16. หมายเหตุ

- หน้าเว็บเดิม `app/discordBot/page.tsx` ไม่ได้ใช้กับระบบนี้ (ตัด web หน้าบ้านออก) — ลบได้ถ้าต้องการ
- ค่า env กลุ่ม `SCAN_*` เป็นเพียง fallback ให้ `/api/cron/scan` ทำงานได้ก่อนสร้างบอทผ่าน Discord
- ปรับรายชื่อ interval/poll ที่เลือกได้ใน `lib/discord/commands.ts` (อย่าลืม register ใหม่)
