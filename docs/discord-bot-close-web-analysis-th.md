# เอกสารวิเคราะห์: ปิดเว็บแล้ว Discord Signal Bot ยังรันอยู่ไหม?

> เวอร์ชัน 1.0 — มิ.ย. 2026
> คำถาม: เปิดหน้า `/discordBot` ตั้งค่าทุกอย่างตามเอกสาร [`discord-signal-bot-free-design-th.md`](./discord-signal-bot-free-design-th.md) แล้วบอทส่งสัญญาณเข้า Discord ได้ → **ถ้าปิดเว็บทิ้ง บอทยังจะรัน/คำนวณ indicator/ส่ง Discord ต่อไหม?**
> คำตอบสั้น: **ไม่ — ปิดเว็บแล้วบอทหยุดทันที** เพราะนาฬิกาทั้งหมดรันอยู่ในเบราว์เซอร์ ไม่ใช่บนเซิร์ฟเวอร์
> เอกสารนี้วิเคราะห์จาก **โค้ดจริงในรีโป** (ไม่ใช่ทฤษฎี) + วิธีแก้ให้รัน 24/7 แบบฟรี

---

## 1. คำตอบตรง ๆ

| คำถาม | คำตอบ |
|---|---|
| ปิดแท็บ/ปิดเบราว์เซอร์ → บอทยังส่ง Discord ไหม | ❌ **หยุดทันที** |
| ปิดแค่จอ แต่เครื่อง sleep | ❌ หยุด (timer ในแท็บถูก freeze) |
| Deploy บน Vercel แล้ว ปิดเบราว์เซอร์ → ยังรันไหม | ❌ ก็ยังหยุด — Vercel เป็นแค่ "คนรับสาย" ไม่มี process เดินเองตามเวลา |
| ค่าที่ตั้งไว้ในหน้า `/discordBot` หายไหม | ไม่หาย (อยู่ใน `localStorage`) **แต่ใช้ได้เฉพาะตอนเปิดหน้านั้นในเบราว์เซอร์เครื่องเดิมเท่านั้น** |
| ทำให้รัน 24/7 แม้ปิดเว็บได้ไหม | ✅ ได้ และของในรีโปมีครบแล้ว — แค่ "เปิดสวิตช์" (ดูข้อ 4) |

---

## 2. ทำไมถึงหยุด — วิเคราะห์จากโค้ดจริง

### 2.1 หน้า `/discordBot` เป็น client component: ทุกอย่างรันใน "แท็บเบราว์เซอร์"

| สิ่งที่บอททำ | รันที่ไหน | หลักฐานในโค้ด |
|---|---|---|
| ตัวจับเวลา poll (รอบดึงราคา) | **แท็บเบราว์เซอร์** | `pollTimerRef` + `window.setInterval` — `app/discordBot/page.tsx:1791,2030` |
| config watcher / webhook URL | **localStorage ของเบราว์เซอร์** | `page.tsx:290,302` และ UI เขียนไว้เองว่า *"เก็บ URL ใน localStorage ของเบราว์เซอร์เท่านั้น — ไม่ส่งเข้าฐานข้อมูล"* (`page.tsx:1277`) |
| ประวัติเทรด/สัญญาณ | **IndexedDB** (ในเครื่อง) | `getTradesByWatcher` — `page.tsx:1822` |
| คำนวณ indicator | **เบราว์เซอร์** (`computeAll`) | `page.tsx:1805-1810` |
| ส่งเข้า Discord | เบราว์เซอร์ → `fetch("/api/discord/notify")` | `page.tsx:1837` |

**ลำดับการทำงานตอนนี้:**

```
แท็บเบราว์เซอร์ (setInterval ทุก pollSec)
   │ 1) fetch /api/klines        ← เซิร์ฟเวอร์แค่ proxy ไป Binance
   │ 2) คำนวณ indicator ในเบราว์เซอร์
   │ 3) ได้สัญญาณ → fetch /api/discord/notify → Discord webhook
   ▼
ปิดแท็บ = ข้อ 1–3 หายหมด ❌
```

เซิร์ฟเวอร์ (Vercel หรือ `next dev`) **ตอบเฉพาะตอนมี request เข้ามา** — ไม่มีตัวจับเวลา ไม่มี background process ฝั่ง server เลย → ตัวที่ "กดปุ่มทุกรอบ" คือแท็บเบราว์เซอร์ ปิดแท็บก็ไม่มีใครกด

### 2.2 จุดที่คนเข้าใจผิดบ่อย: "ตั้งค่าในเว็บไปแล้ว" ≠ "เซิร์ฟเวอร์รู้ค่านั้น"

รีโปมีเส้นทางที่รันได้โดยไม่ต้องเปิดเว็บอยู่แล้วคือ `app/api/cron/scan/route.ts` **แต่มันอ่านบอทจากคนละที่กับหน้าเว็บ:**

| | หน้า `/discordBot` (ปัจจุบัน) | เส้นทาง cron `/api/cron/scan` |
|---|---|---|
| ที่เก็บ config บอท | `localStorage` ในเบราว์เซอร์ | **Upstash Redis** (`getBots`) หรือ **env `SCAN_*`** (`route.ts:40-63,77-90`) |
| webhook URL | `localStorage` | `bot.webhookUrl` ใน Redis หรือ env `DISCORD_WEBHOOK_URL` (`route.ts:120-122`) |
| กันส่งสัญญาณซ้ำ | state ในหน้าเว็บ | `lastAlert` ใน Redis (`route.ts:104-116`) |

> ⚠️ **เซิร์ฟเวอร์เข้าถึง localStorage ของเบราว์เซอร์ไม่ได้** → การตั้งค่าทั้งหมดที่ทำในหน้า `/discordBot` **ไม่ติดไปกับเส้นทาง cron** ต้องตั้งใหม่ฝั่ง server (ข้อ 4)

### 2.3 ตัวปลุกภายนอกก็ยังปิดอยู่

`.github/workflows/signal-poll.yml` (GitHub Actions cron ทุก 5 นาที ที่ออกแบบไว้ให้ยิง `/api/cron/scan`) ตอนนี้ **comment ไว้ทั้งไฟล์** → ยังไม่มีอะไรปลุก endpoint นี้เลย

---

## 3. สรุปสถาปัตยกรรม "ตอนนี้" vs "เป้าหมาย"

```
ตอนนี้ (browser-driven):
  เบราว์เซอร์ (setInterval) ──▶ /api/klines + /api/discord/notify
  ปิดแท็บ = บอทตาย ❌

เป้าหมาย (server-driven, แบบ A ในเอกสารออกแบบ):
  GitHub Actions cron (ทุก 5 นาที)
        │  curl + CRON_SECRET
        ▼
  Vercel /api/cron/scan ──▶ ดึง klines สดจาก Binance (public, ไม่ใช้ key)
        │                   ──▶ คำนวณ indicator (lib/scanner.ts → evaluateBots)
        │                   ──▶ กันซ้ำด้วย lastAlert (Upstash Redis)
        ▼
  Discord webhook  ← รัน 24/7 ไม่เกี่ยวกับเบราว์เซอร์ ✅ ฟรี
```

---

## 4. วิธีทำให้รันแม้ปิดเว็บ (Checklist)

> 📘 **คู่มือตั้งค่าฉบับเต็ม (env/secrets ทุกตัว + ขั้นตอน + แก้ปัญหา):** [`discord-bot-setup-th.md`](./discord-bot-setup-th.md)
> ⚠️ **แก้ไขข้อเท็จจริง:** ตอนเขียนเอกสารนี้ครั้งแรกเข้าใจว่า "โค้ดมีครบแล้ว" แต่จริง ๆ โมดูลฝั่ง server ที่ `route.ts` เรียกใช้ (`lib/store`, `lib/scanner`, `lib/usage`, `lib/discord/*`, `lib/types/bot`) **ยังไม่ถูกสร้าง** — ตอนนี้สร้างครบแล้ว (typecheck/lint ผ่าน) โปรเจกต์จึง build/deploy ได้ เหลือแค่ตั้งค่าตาม checklist ด้านล่าง

### ขั้นที่ 1 — Deploy ขึ้น Vercel
ถ้ายังรันแค่ `localhost` (`next dev`) ปิดเครื่องเซิร์ฟเวอร์ก็หายเหมือนกัน → ต้อง deploy ก่อน

### ขั้นที่ 2 — ปลด comment workflow
เปิดไฟล์ `.github/workflows/signal-poll.yml` แล้วปลด comment ทั้งไฟล์ (cron `*/5 * * * *` + `workflow_dispatch` สำหรับกดทดสอบ)

### ขั้นที่ 3 — ตั้ง GitHub Secrets
ที่ repo → Settings → Secrets and variables → Actions:

| Secret | ค่า |
|---|---|
| `VERCEL_APP_URL` | เช่น `https://your-app.vercel.app` (ไม่มี `/` ปิดท้าย) |
| `CRON_SECRET` | สตริงลับ ต้องตรงกับ env บน Vercel |

### ขั้นที่ 4 — ตั้ง env บน Vercel

| Env | ทำไมต้องมี |
|---|---|
| `CRON_SECRET` | route นี้ **fail-closed** — ไม่ตั้ง = ตอบ 401 ตลอด (`route.ts:33`) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | เก็บ `lastAlert` กันสแปม Discord + เก็บบอท |
| `DISCORD_WEBHOOK_URL` | webhook ปลายทาง — เพราะค่าที่อยู่ใน localStorage **ไม่ตามมา** |

### ขั้นที่ 5 — บอกเซิร์ฟเวอร์ว่ามีบอทอะไรบ้าง (เลือก 1 ทาง)

**ทาง ก. (ง่ายสุด) — env fallback** ที่โค้ดรองรับอยู่แล้ว (`route.ts:40-63`):

```
SCAN_SYMBOLS=BTCUSDT,ETHUSDT
SCAN_INTERVAL=1h
SCAN_STRATEGIES=supertrend
```

→ ทุกรอบ cron จะสแกนคู่/กลยุทธ์เหล่านี้เสมอ (pollSec=0 คือทำทุกรอบ)

**ทาง ข. — สร้างบอทจริงลง Upstash** (ผ่าน Discord interactions ที่มีโครงไว้ใน `app/api/discord/*`)
→ ได้ `pollSec` รายบอท (เลือกความถี่ 1 นาที–1 วันต่อบอทได้ตามเอกสารออกแบบข้อ 4)

### ขั้นที่ 6 — ทดสอบ
1. กด **Run workflow** เองจากแท็บ Actions (`workflow_dispatch`)
2. ดู response ของ `/api/cron/scan`: `{ ok: true, mode: "env"|"bots", due, candidates, sent, errors }`
3. เช็กว่ามีข้อความเข้า Discord

---

## 5. ข้อจำกัด/ข้อระวังของเส้นทางฟรี

| ประเด็น | รายละเอียด |
|---|---|
| ความถี่ขั้นต่ำของ GitHub Actions | ~5 นาที + อาจดีเลย์ 3–10 นาที (dedup ใน Redis กันเตือนซ้ำให้แล้ว) |
| repo **public** | ✅ **ไม่จำกัดนาที (ฟรีตลอด)** บน standard runner — ดูตารางข้อ 5.1 |
| repo **private** | โควต้า 2,000 นาที/เดือน — cron ทุก 5 นาทีจะ**เกิน** (GitHub ปัดขึ้นเป็นนาทีเต็มต่อรอบ) → ต้องห่าง ≥30 นาที หรือทำ repo public หรือใช้ตัวปลุกอื่น (ดูเอกสารออกแบบข้อ 10.1) |
| ต้องการ 1 นาทีจริง | สลับตัวปลุกเป็น **cron-job.org / Cloudflare Cron** ยิง `GET ${VERCEL_APP_URL}/api/cron/scan?secret=XXXX` — ไม่กิน GitHub minutes |
| Vercel Cron native (ฟรี) | ได้แค่ **วันละครั้ง** — ใช้ได้เฉพาะโจทย์ "ทุก 1 วัน" |
| หน้า `/discordBot` เดิม | ยังใช้ได้ตามปกติเป็น **แดชบอร์ดดู/ทดลองสด** — แต่ให้เข้าใจว่ามันคือโหมด "เปิดจอเฝ้า" ไม่ใช่โหมด 24/7 |

### 5.1 ถ้าทำ repo เป็น **public** — โควต้า GitHub Actions ยิงได้เท่าไร?

**คำตอบ: ไม่จำกัดนาที — ฟรีตลอด** สำหรับ repo public บน GitHub-hosted **standard runner** (`ubuntu-latest` ที่ workflow นี้ใช้) → cron ถี่แค่ไหนก็ไม่โดนคิดเงิน:

| รอบ cron | ครั้ง/เดือน (~) | นาทีที่ถูกนับ/เดือน (ปัดขึ้นเป็นนาทีเต็มต่อรอบ) | repo public ฟรีไหม? | repo private (2,000 นาทีฟรี) |
|---|---|---|---|---|
| ทุก 5 นาที (ขั้นต่ำของ Actions) | ~8,640 | ~8,640 | ✅ **ฟรี ไม่จำกัด** | ❌ เกิน (หมดราววันที่ 7) |
| ทุก 15 นาที | ~2,880 | ~2,880 | ✅ ฟรี | ❌ เกิน |
| ทุก 30 นาที | ~1,440 | ~1,440 | ✅ ฟรี | ✅ พอ (พอดี ๆ) |
| ทุก 1 ชั่วโมง | ~720 | ~720 | ✅ ฟรี | ✅ พอ |
| ทุก 1 วัน | ~30 | ~30 | ✅ ฟรี | ✅ พอ |

**ลิมิตที่ "ยังมีอยู่" แม้ repo จะ public** (เป็นลิมิตการใช้งาน ไม่ใช่ค่าเงิน):

| ลิมิต | ค่า | กระทบงานเราไหม? |
|---|---|---|
| ความถี่ cron ขั้นต่ำ | **5 นาที** (`*/5 * * * *`) | ✅ คือเพดานความถี่จริง — อยากได้ 1 นาทีต้องใช้ cron-job.org/Cloudflare |
| เวลารันสูงสุดต่อ job | 6 ชั่วโมง | ไม่กระทบ (curl เสร็จในไม่กี่วินาที) |
| เวลารันสูงสุดต่อ workflow run | 35 วัน | ไม่กระทบ |
| Concurrent jobs (แผน Free) | 20 jobs พร้อมกัน | ไม่กระทบ (รอบละ 1 job + มี `concurrency` กันรันซ้อนใน workflow แล้ว) |
| API rate / scheduling delay | cron อาจดีเลย์ 3–10 นาทีช่วงที่ระบบ GitHub โหลดสูง | มี dedup (`lastAlert`) ใน Redis กันเตือนซ้ำ/ข้ามรอบให้แล้ว |
| ⚠️ repo ไม่เคลื่อนไหว | GitHub **ปิด scheduled workflow อัตโนมัติ** ถ้า repo ไม่มี activity ติดต่อกัน **60 วัน** | ต้องมี commit/activity เป็นระยะ หรือกดเปิดใหม่เมื่อได้อีเมลเตือน |

**ข้อแลกเปลี่ยนก่อนทำ public:** โค้ดทั้งหมดในรีโปจะเปิดเผย — ตรวจให้แน่ใจว่า**ไม่มี secret ใด ๆ hard-code อยู่ในโค้ดหรือใน git history** (`CRON_SECRET`, webhook URL, Upstash token ต้องอยู่ใน GitHub Secrets / Vercel env เท่านั้น ซึ่งโครงสร้างปัจจุบันทำถูกแล้ว)

> สรุป: ทำ repo เป็น public → cron ทุก 5 นาที **ฟรีไม่จำกัด ไม่ต้องนับโควต้าเลย** เหลือข้อจำกัดเดียวคือความถี่ขั้นต่ำ 5 นาทีของตัว GitHub Actions เอง

---

## 6. สรุปการตัดสินใจ

| คำถาม | คำตอบ |
|---|---|
| ปิดเว็บแล้วบอทยังรันไหม | **ไม่** — ตัวจับเวลา + indicator + การส่ง Discord รันในแท็บเบราว์เซอร์ทั้งหมด |
| ค่าที่ set ในหน้าเว็บไปแล้วใช้กับ cron ได้ไหม | **ไม่ได้** — อยู่ใน localStorage ซึ่งเซิร์ฟเวอร์มองไม่เห็น ต้องตั้ง env/Redis ใหม่ |
| ทำให้รัน 24/7 ฟรียังไง | เปิดใช้ `signal-poll.yml` + ตั้ง secrets/env + กำหนดบอทผ่าน `SCAN_*` หรือ Upstash (ข้อ 4) |
| ต้องเขียนโค้ดเพิ่มไหม | **แทบไม่ต้อง** — `app/api/cron/scan/route.ts`, `lib/scanner.ts`, `lib/store.ts`, `lib/discord/rest.ts` มีครบแล้ว |

---

## ไฟล์ที่เกี่ยวข้อง

| ไฟล์ | บทบาท |
|---|---|
| `app/discordBot/page.tsx` | หน้าเว็บโหมด "เปิดจอเฝ้า" (browser-driven) — จุดที่บอทหยุดเมื่อปิดเว็บ |
| `app/api/cron/scan/route.ts` | endpoint โหมด 24/7 (server-driven) — auth ด้วย `CRON_SECRET`, อ่านบอทจาก Redis/env |
| `.github/workflows/signal-poll.yml` | ตัวปลุกทุก 5 นาที (ตอนนี้ comment ไว้ทั้งไฟล์) |
| `lib/scanner.ts` / `lib/store.ts` / `lib/discord/rest.ts` | indicator engine / Upstash state / Discord webhook |
| [`discord-signal-bot-free-design-th.md`](./discord-signal-bot-free-design-th.md) | เอกสารออกแบบระบบรันฟรี (แบบ A/B/C) ที่เอกสารนี้อ้างถึง |
