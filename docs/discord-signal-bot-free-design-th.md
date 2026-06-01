# เอกสารออกแบบระบบ: Discord Signal Bot (Binance) แบบ "รันฟรี"

> เวอร์ชัน 1.0 — มิ.ย. 2026
> โจทย์: รัน polling ดึงราคาเหรียญจาก Binance ตามรอบเวลา (เลือกได้ **ทุก 1 นาที ถึง 1 วัน**) → เก็บข้อมูลกราฟสะสมไปเรื่อย ๆ → ทุกครั้งที่ poll คำนวณ indicator ที่เขียนเอง → ถ้าได้สัญญาณซื้อ/ขาย → **ส่งเข้า Discord**
> เงื่อนไข: **ต้องรันฟรี** · คำถามหลัก: **ใช้ Vercel ได้ไหม?**
>
> เอกสารนี้เป็นคนละโหมดกับ [`trading-bot-system-design-th.md`](./trading-bot-system-design-th.md) (โหมดเทรดจริงบน VPS static IP) — โหมดนี้คือ **signal-only**

---

## 1. ความต่างสำคัญจากเอกสารเดิม (อ่านก่อน)

โหมดนี้ **ส่งสัญญาณเข้า Discord อย่างเดียว ไม่ยิงออเดอร์** → เปลี่ยนข้อจำกัดทั้งหมด:

| ประเด็น | โหมดเทรดจริง (เอกสารเดิม) | โหมด Signal → Discord (เอกสารนี้) |
|---|---|---|
| ใช้ Binance API Key | ✅ ต้องใช้ (ยิงออเดอร์) | ❌ **ไม่ต้อง** — klines เป็น public |
| ต้อง whitelist IP / static IP | ✅ จำเป็น | ❌ **ไม่จำเป็นเลย** |
| ต้องมี VPS / server เปิด 24/7 | ✅ ต้องมี | ❌ **ไม่ต้อง** — ใช้ serverless/cron ฟรีได้ |
| ความเสี่ยงเงิน | สูง (เงินจริง) | ต่ำ (แค่แจ้งเตือน) |
| รันฟรีได้ไหม | ยาก | ✅ **ได้** (เอกสารนี้อธิบายวิธี) |

> เพราะไม่ต้องใช้ key/whitelist/static IP → ปัญหาทั้งหมดของโหมดก่อนหน้าหายไป เหลือแค่โจทย์ทางเทคนิคของ serverless: **"ใครจะกดให้รันตามรอบ"** และ **"เก็บ state ไว้ที่ไหน"**

---

## 2. คำตอบตรง ๆ: ใช้ Vercel ฟรี ได้ไหม?

**ได้ — แต่มีเงื่อนไขสำคัญ 1 ข้อ:** Vercel เป็น **serverless** ไม่มี process ที่รันค้างไว้ตลอด และ **cron ของ Vercel แผนฟรี (Hobby) รันได้แค่ "วันละครั้ง"**

### 2.1 ลิมิต Cron ของ Vercel (Hobby / ฟรี)

| แผน | ความถี่ cron ต่ำสุด | หมายเหตุ |
|---|---|---|
| **Hobby (ฟรี)** | **วันละครั้งเท่านั้น** (daily) | ใส่ expression ถี่กว่าวัน เช่น `*/5 * * * *` → **deploy ไม่ผ่าน** ("Hobby accounts are limited to daily cron jobs") และต่อให้รายวัน Vercel อาจยิง **เวลาไหนก็ได้ภายในชั่วโมงนั้น** |
| Pro ($20/เดือน) | ระดับนาที | ปลดล็อกทุกนาที |

**แปลว่า:**
- ✅ ต้องการ **"ทุก 1 วัน"** → Vercel Cron ฟรี **ทำได้เลย** (native)
- ❌ ต้องการ **"ทุก 1 นาที / 5 นาที / รายชั่วโมง"** → Vercel Cron ฟรี **ทำไม่ได้** ต้องหา **"ตัวกระตุ้นภายนอก" (external trigger)** มายิง API route ของ Vercel แทน (ดูข้อ 4)

### 2.2 ข้อจำกัด serverless อีก 2 ข้อที่ต้องออกแบบรอบ

1. **Stateless + ephemeral** — ฟังก์ชันจบแล้วหน่วยความจำ/ไฟล์หายหมด เขียนไฟล์ลง disk เพื่อ "สะสมกราฟ" **ไม่ได้** → ต้องเก็บ state ที่ภายนอก (ข้อ 5)
2. **เวลารันจำกัดต่อครั้ง** — Hobby ฟังก์ชันรันได้สั้น (หลักวินาที–สูงสุด 60 วิ ถ้าตั้ง `maxDuration`) → งานเรา (fetch klines + คำนวณ indicator + ยิง Discord) เสร็จในไม่กี่วินาที จึง **พอดี** ไม่ติดปัญหานี้

> **สรุปแนวคิด:** Vercel ทำหน้าที่ "สมอง" (รับ trigger → fetch → คำนวณ → ส่ง Discord) ได้ดีและฟรี แต่ Vercel ฟรี **เป็นนาฬิกาปลุกความถี่สูงให้ตัวเองไม่ได้** ต้องมีนาฬิกาปลุกจากข้างนอก

---

## 3. หัวใจสถาปัตยกรรม (Serverless Polling)

```
   ┌──────────────────────┐   ทุก N นาที/วัน (เลือกได้)
   │  ตัวกระตุ้น (Trigger) │ ─────────────────────────────┐
   │  เลือก 1 อย่างจากข้อ4 │   ยิง HTTPS + secret          │
   └──────────────────────┘                               ▼
                                          ┌────────────────────────────────┐
                                          │   API Route (Vercel ฟรี)        │
                                          │   /api/cron/scan                │
                                          │  1) อ่าน config (คู่/timeframe)  │
   ┌───────────────────┐  GET klines       │  2) fetch klines (public)   ◀──┼──┐
   │ Binance public API│ ◀────────────────│  3) คำนวณ indicator (เขียนเอง)  │  │ ไม่ใช้ key
   │ /api/v3/klines    │ ─────────────────▶│  4) ได้สัญญาณ BUY/SELL?         │  │
   └───────────────────┘   candles         │  5) ใหม่จริง? (กันซ้ำ)          │  │
                                          │  6) ส่ง Discord webhook         │  │
                                          └──────┬───────────────┬─────────┘  │
                          เก็บ/อ่าน state         │               │            │
                       (lastAlert, กราฟ)          ▼               ▼            │
                                          ┌──────────────┐  ┌──────────────┐  │
                                          │ State store  │  │   Discord    │  │
                                          │ (Upstash/DB) │  │  (Webhook)   │  │
                                          └──────────────┘  └──────────────┘  │
                                                                              │
                            * ข้อมูลกราฟ: ดึงสดจาก Binance ทุกครั้งก็พอ ────────┘
                              (ไม่ต้องเก็บเองก็ได้ — ดูข้อ 5)
```

3 ชิ้นส่วนที่ต้องตัดสินใจ: **(A) ตัวกระตุ้น (ข้อ 4)** · **(B) ที่เก็บ state/กราฟ (ข้อ 5)** · **(C) ทางส่ง Discord (ข้อ 6)**

---

## 4. ตัวกระตุ้น (Trigger) แบบฟรี — ตัวไหนทำ "1 นาที–1 วัน" ได้

| ตัวเลือก (ฟรี) | ความถี่ต่ำสุด | รองรับ 1 นาที? | รองรับ 1 วัน? | หมายเหตุ |
|---|---|---|---|---|
| **Vercel Cron (Hobby)** | วันละครั้ง | ❌ | ✅ | native, ไม่ต้องพึ่งใคร แต่ถี่กว่าวันไม่ได้ + เวลาเพี้ยนได้ในชั่วโมง |
| **GitHub Actions cron** | ~5 นาที | ❌ (5 นาที) | ✅ | ฟรี (repo public ไม่จำกัดนาที, private 2,000 นาที/เดือน), อาจดีเลย์ 3–10 นาที — **คุณมี workflow นี้อยู่แล้ว** |
| **Cloudflare Workers Cron** | **1 นาที** | ✅ | ✅ | ฟรี 5 cron triggers + 100k req/วัน — ทำได้ทั้งเป็น "ตัวกระตุ้น" หรือทำงานทั้งหมดในตัวเอง |
| **cron-job.org** (external pinger) | **1 นาที** | ✅ | ✅ | บริการฟรี ยิง URL ตามรอบ → ใช้ "ปลุก" Vercel route ได้ (ตรวจลิมิตปัจจุบันอีกที) |

**วิธี map กับโจทย์ "เลือกได้ 1 นาที–1 วัน":**
- ถ้ายอมรับ **ขั้นต่ำ 5 นาที** → **GitHub Actions** ง่ายสุด (อยู่ในรีโปเดียวกับโค้ด, คุณตั้งไว้แล้ว)
- ถ้าต้องการ **1 นาทีจริง ๆ และฟรี** → ใช้ **Cloudflare Cron** หรือ **cron-job.org** เป็นตัวกระตุ้น
- เคล็ดลับ (แบบที่โค้ดคุณทำอยู่แล้ว): ตั้ง trigger ให้ "ถี่ที่สุดที่ทำได้" แล้วเก็บ **`pollSec` ของแต่ละบอท** ไว้ใน store → endpoint เลือกทำเฉพาะบอทที่ "ถึงรอบจริง" → ได้ความรู้สึกเหมือนเลือกความถี่ต่อบอทได้ 1 นาที–1 วัน โดยไม่ต้องมี cron หลายตัว

---

## 5. เก็บ "ข้อมูลกราฟ" + state ที่ไหน (serverless = ต้องเก็บนอกเครื่อง)

### 5.1 ข้อมูลกราฟ — ส่วนใหญ่ "ไม่ต้องเก็บเอง"
Binance ให้ดึงแท่งย้อนหลังได้ฟรีอยู่แล้ว: `GET /api/v3/klines?symbol=BTCUSDT&interval=1h&limit=500`
→ ทุกครั้งที่ poll **ดึง lookback window (เช่น 200–500 แท่ง) มาคำนวณ indicator สด ๆ** แล้วทิ้ง → **ไม่ต้องสะสม candle เองเลย** (Binance เป็นแหล่งข้อมูลจริง)
✅ นี่คือวิธีที่เบาสุด เหมาะกับ serverless ฟรี และตรงกับงาน indicator (ซึ่งต้องการแค่ N แท่งล่าสุด)

> เก็บกราฟเองเมื่อไหร่: เฉพาะเมื่ออยาก backtest/วิเคราะห์ย้อนหลังบนข้อมูล "ตามจริงที่บอทเห็น" หรืออยากโชว์กราฟสะสมบนแดชบอร์ด — ถ้ายังไม่ต้องการตอนนี้ ข้ามไปได้

### 5.2 ที่เก็บ state ที่ "ต้องมี" — กันส่งสัญญาณซ้ำ (lastAlert)
อันนี้ **จำเป็น** เพราะ poll ซ้ำ ๆ บนสัญญาณเดิมจะสแปม Discord → ต้องจำว่า "คู่นี้/กลยุทธ์นี้ alert สัญญาณล่าสุดอันไหนไปแล้ว" แล้ว **เตือนเฉพาะตอนสัญญาณเปลี่ยน/เกิดใหม่บนแท่งที่ปิดแล้ว**

### 5.3 ตัวเลือก store ฟรี

| Store ฟรี | เหมาะกับ | หมายเหตุ |
|---|---|---|
| **Upstash Redis** | lastAlert, config บอท, pollSec | ฟรี, serverless, latency ต่ำ — **คุณใช้อยู่แล้ว** (`lib/store`) |
| **Supabase / Neon (Postgres)** | เก็บประวัติสัญญาณ + กราฟสะสม | ฟรี tier, เป็น SQL เต็ม |
| **Turso (SQLite)** / **Vercel KV** | state เล็ก ๆ | ฟรี tier |
| **commit กลับเข้า repo** (ถ้าใช้ GitHub Actions) | snapshot สัญญาณ/ข้อมูลเล็ก | ฟรีล้วน ไม่ต้องมี DB |

---

## 6. ส่งเข้า Discord — ใช้ Webhook (ง่ายและฟรีสุด)

- **Discord Webhook** = สร้างใน Discord: Server Settings → Integrations → Webhooks → คัดลอก URL
- ส่งสัญญาณแค่ **POST JSON** ไปที่ URL นั้น (รองรับ embed สวย ๆ) → **ไม่ต้อง host bot, ไม่ต้องดูแล gateway connection** → เหมาะกับ serverless ที่สุด
- คุณมีอยู่แล้ว: `lib/discord/rest.ts` (`sendWebhookMessage`) + `lib/discord/components.ts` (`signalEmbed`) + route `app/api/discord/notify`
- ใช้ Discord **Bot (slash command/interactions)** เฉพาะเมื่ออยากให้ผู้ใช้ "สั่งเพิ่ม/ลบบอทจากใน Discord" — คุณก็มีโครงไว้แล้ว (`app/api/discord/interactions`, `register`)

---

## 7. สถาปัตยกรรมที่แนะนำ (3 แบบ ฟรีทั้งหมด) + เลือกให้

### แบบ A — Vercel route + External Trigger ✅ (ตรงกับของที่คุณมีอยู่)
```
GitHub Actions / cron-job.org / Cloudflare Cron  ──ยิงทุก N──▶  Vercel /api/cron/scan
                                                                  → fetch klines → indicator
                                                                  → Upstash (lastAlert/pollSec)
                                                                  → Discord webhook
```
- **ข้อดี:** โค้ดอยู่ในรีโป Next.js เดียวกับแดชบอร์ด, reuse กลยุทธ์/backtest ได้, deploy ง่าย
- **ความถี่:** 5 นาที (GitHub Actions, ที่คุณตั้งไว้) หรือ 1 นาที (cron-job.org/Cloudflare)
- **นี่คือสิ่งที่ repo คุณทำอยู่แล้ว** — แค่ "เปิดใช้งาน" workflow ที่ comment ไว้ หรือสลับไปใช้ trigger 1 นาที

### แบบ B — Cloudflare Workers all-in-one (ฟรี + 1 นาทีในตัว)
```
Cloudflare Cron (1 นาที) ──▶ Worker: fetch klines → indicator → Discord webhook
                                       state ใน Workers KV (ฟรี)
```
- **ข้อดี:** ได้ 1 นาทีฟรีในตัว ไม่ต้องพึ่ง trigger ภายนอก, ไม่ต้องใช้ Vercel
- **ข้อควรระวัง:** ต้องพอร์ตโค้ด indicator ไปรันบน Workers runtime (เป็น JS/TS ปกติ พอร์ตไม่ยาก แต่เป็นโปรเจกต์แยก) + ดู CPU time limit ต่อ invocation ของแผนฟรี

### แบบ C — GitHub Actions ล้วน (ไม่ต้องมี Vercel)
```
GitHub Actions cron (≥5 นาที) ──▶ รัน Node script ในรีโป:
                                   fetch klines → indicator → Discord webhook
                                   state: commit ไฟล์กลับ repo หรือ Upstash ฟรี
```
- **ข้อดี:** ฟรีล้วน ไม่ต้อง deploy เว็บ, ไม่มี endpoint สาธารณะให้ป้องกัน
- **ข้อจำกัด:** ขั้นต่ำ 5 นาที + อาจดีเลย์

### 👉 คำแนะนำ
- **อยากใช้ Vercel ตามที่ถาม + ยอมรับ 5 นาที** → **แบบ A ด้วย GitHub Actions** (เปิดใช้ของที่มีอยู่เลย) — ลงแรงน้อยสุด
- **ต้องการ 1 นาทีจริง ๆ ฟรี และอยากคงโค้ดบน Vercel** → **แบบ A ด้วย cron-job.org/Cloudflare Cron** เป็นตัวกระตุ้นแทน GitHub Actions
- **อยากสะอาดสุด ฟรีสุด ได้ 1 นาที ไม่ผูกกับ Vercel** → **แบบ B (Cloudflare Workers)**

> หมายเหตุ: **Vercel Cron ฟรี (native) เพียว ๆ ใช้ได้เฉพาะกรณี "ทุก 1 วัน"** เท่านั้น ถ้าต้องการถี่กว่านั้นต้องมี trigger ภายนอกเสมอ (หรืออัป Pro)

---

## 8. ของที่คุณมีอยู่แล้วในรีโป (ตรวจแล้ว ใช้ต่อได้เลย)

| ไฟล์ | บทบาท |
|---|---|
| `app/api/cron/scan/route.ts` | endpoint หลัก: auth ด้วย `CRON_SECRET` → เลือกบอทที่ถึงรอบ (`pollSec`) → ดึงข้อมูล → เช็กสัญญาณ → ยิง Discord (มี `maxDuration=60`, runtime `nodejs`) |
| `lib/store.ts` | Upstash Redis: `getBots`, `getLastAlert/setLastAlert` (กันซ้ำ), `getConfig` |
| `lib/scanner.ts` | `evaluateBots` — รัน indicator/กลยุทธ์ออกสัญญาณ |
| `lib/discord/rest.ts`, `components.ts` | `sendWebhookMessage`, `signalEmbed` |
| `app/api/discord/*` | webhook notify + bot interactions/register |
| `.github/workflows/signal-poll.yml` | GitHub Actions cron ทุก 5 นาที (ตอนนี้ **comment ไว้ทั้งไฟล์** — แค่ปลด comment + ตั้ง secrets ก็ทำงาน) |
| `lib/indicators.ts`, `lib/backtest.ts` | indicator/กลยุทธ์ reuse ร่วมกับ backtest |

**สิ่งที่ต้องทำเพื่อให้รันจริง (แบบ A):**
1. ปลด comment ใน `.github/workflows/signal-poll.yml`
2. ตั้ง GitHub Secrets: `VERCEL_APP_URL`, `CRON_SECRET`
3. ตั้ง env บน Vercel: `CRON_SECRET` (ให้ตรงกัน), ค่า Upstash (`UPSTASH_REDIS_REST_URL`/`TOKEN`), `DISCORD_WEBHOOK_URL`
4. (อยากได้ 1 นาที) สลับไปใช้ cron-job.org/Cloudflare ยิง `${VERCEL_APP_URL}/api/cron/scan?secret=...` แทน

---

## 9. โค้ด Skeleton อ้างอิง

**9.1 แกน scan (stateless re-fetch + dedup) — แนวเดียวกับ `api/cron/scan`**
```ts
export async function scanOnce() {
  const bots = await getBots();                 // จาก Upstash
  const now = Date.now();
  for (const bot of bots) {
    if (now - bot.lastPolledAt < bot.pollSec * 1000) continue;  // ยังไม่ถึงรอบ → ข้าม

    // ดึงแท่งสด ๆ (public, ไม่ใช้ key) — ไม่ต้องเก็บกราฟเอง
    const klines = await fetchKlines(bot.symbol, bot.interval, 300);
    const signal = runStrategy(bot.strategy, klines);           // BUY/SELL/HOLD (จากแท่งปิด)

    const key = `${bot.symbol}:${bot.interval}:${bot.strategy}`;
    const last = await getLastAlert(key);
    if (signal !== "HOLD" && signal !== last) {                 // เตือนเฉพาะ "สัญญาณใหม่"
      await sendWebhookMessage(bot.webhookUrl, signalEmbed(bot, signal, klines.at(-1)));
      await setLastAlert(key, signal);
    }
    await upsertBot({ ...bot, lastPolledAt: now });
  }
}
```

**9.2 Discord webhook (ไม่ต้อง host bot)**
```ts
export async function sendWebhookMessage(url: string, embed: object) {
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ embeds: [embed] }),
  });
}
```

**9.3 ตัวกระตุ้น — เลือกอย่างใดอย่างหนึ่ง**
```yaml
# (A) GitHub Actions — ทุก 5 นาที (ของเดิมในรีโป)
on:
  schedule:
    - cron: "*/5 * * * *"
# run: curl -H "Authorization: Bearer $CRON_SECRET" "$VERCEL_APP_URL/api/cron/scan"
```
```jsonc
// (B) Vercel native — เฉพาะ "ทุก 1 วัน" เท่านั้นบนแผนฟรี  (vercel.json)
{ "crons": [ { "path": "/api/cron/scan", "schedule": "0 0 * * *" } ] }
```
```
(C) cron-job.org / Cloudflare Cron — ตั้ง 1 นาที แล้วยิง URL เดียวกัน
    GET https://your-app.vercel.app/api/cron/scan?secret=XXXX   ทุก * * * * *
```

---

## 10. ลิมิตฟรีที่ต้องระวัง

- **Vercel Hobby:** cron native = วันละครั้ง; function duration จำกัด (ตั้ง `maxDuration` ได้ถึง 60 วิ); มีเพดาน execution/bandwidth รายเดือน — งาน signal เบามาก ปกติไม่ชน
- **GitHub Actions:** repo **public = ไม่จำกัด (ฟรีตลอด)**; repo **private = 2,000 นาที/เดือน** (รีเซ็ตรายเดือน) — ⚠️ **GitHub ปัดเวลาแต่ละครั้งขึ้นเป็น "นาทีเต็ม"** ต่อให้ curl เสร็จใน 10 วิก็นับ 1 นาที → ดูตารางข้อ 10.1; อาจดีเลย์ 3–10 นาที

### 10.1 ⚠️ GitHub Actions: โควต้า private repo ทะลุง่ายถ้า cron ถี่

เพราะปัดขึ้นเป็นนาทีเต็ม แต่ละรอบ cron = อย่างน้อย 1 นาทีที่ถูกหัก:

| รอบ cron | ครั้ง/เดือน | นาที/เดือน | อยู่ใน 2,000 ฟรี (private)? |
|---|---|---|---|
| ทุก 5 นาที | ~8,640 | 8,640 | ❌ **เกิน** (หมดราววันที่ 7) |
| ทุก 15 นาที | ~2,880 | 2,880 | ❌ เกิน |
| ทุก 30 นาที | ~1,440 | 1,440 | ✅ พอ |

→ บน **private repo** จะฟรีได้ต้องตั้ง cron **ห่าง ≥ ~30 นาที**
→ อยากได้ **5 นาที/1 นาที ฟรีจริง** ให้เลือก: **(ก) ทำ repo เป็น public** (Actions ไม่จำกัด) หรือ **(ข) ใช้ cron-job.org/Cloudflare Cron เป็นตัวยิงแทน** ซึ่ง **ไม่กิน GitHub minutes เลย** และได้ถึง 1 นาที (เก็บ repo private ได้)

> หมายเหตุ: GitHub Actions ที่นี่ทำหน้าที่ **"ยิง curl ปลุก endpoint Vercel ที่ deploy ไว้แล้ว"** เท่านั้น — ไม่ได้ build/deploy เว็บ (Vercel deploy เองตอน `git push` ผ่าน Git integration เป็นคนละส่วนกัน)
- **Cloudflare Workers (ฟรี):** 100k req/วัน, 5 cron triggers, มี CPU time limit ต่อ invocation — เช็กว่าการคำนวณ indicator ไม่เกิน
- **Upstash (ฟรี):** จำกัดจำนวน command/วัน — งานเราเรียกน้อย ปกติพอ
- **Binance public API:** มี rate limit แต่ 1–10 คู่ ดึงรอบละครั้ง ไม่ชน
- **กันสแปม Discord:** ต้องมี dedup (`lastAlert`) + เตือนเฉพาะ "แท่งปิด" และ "สัญญาณเปลี่ยน" เสมอ

---

## 11. สรุปการตัดสินใจ

| คำถาม | คำตอบ |
|---|---|
| ใช้ Vercel ฟรีได้ไหม | **ได้** สำหรับ "สมอง" (fetch+indicator+Discord) |
| Vercel ฟรี poll ทุก 1 นาทีเองได้ไหม | **ไม่ได้** — cron Hobby = วันละครั้ง ต้องมี trigger ภายนอก |
| ทำ "1 นาที" ฟรีได้ยังไง | external trigger: **cron-job.org / Cloudflare Cron** (1 นาที) หรือ GitHub Actions (5 นาที) |
| ทำ "1 วัน" ฟรีได้ยังไง | Vercel Cron native ได้เลย |
| เก็บข้อมูลกราฟยังไง | **ดึงสดจาก Binance ทุกรอบ** (ไม่ต้องเก็บเอง); อยากเก็บจริง → Upstash/Supabase ฟรี |
| ต้องมี static IP / API key ไหม | **ไม่ต้อง** (signal-only) |
| แนะนำสุดท้าย | **แบบ A**: เปิดใช้ `signal-poll.yml` (5 นาที) ที่มีอยู่แล้ว; อยากได้ 1 นาที → สลับ trigger เป็น cron-job.org/Cloudflare |

---

## แหล่งอ้างอิง
- [Vercel — Cron Jobs Usage & Pricing (Hobby = daily limit)](https://vercel.com/docs/cron-jobs/usage-and-pricing)
- [Vercel — Cron Jobs docs](https://vercel.com/docs/cron-jobs)
- [Cloudflare Workers — Cron Triggers (min 1 minute, free tier)](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [GitHub Actions — schedule (minimum 5 minutes, may be delayed)](https://cronbuilder.dev/blog/github-actions-cron-schedule.html)
- [Cron Schedule for Serverless: GitHub Actions, Vercel Cron, Cloudflare Workers](https://viadreams.cc/en/blog/cron-schedule-serverless-github-actions-vercel-cloudflare/)
