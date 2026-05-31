import { NextRequest, NextResponse } from "next/server";
import {
  isStoreConfigured,
  getBots,
  upsertBot,
  getLastAlert,
  setLastAlert,
  getConfig,
} from "@/lib/store";
import { type Bot } from "@/lib/types/bot";
import {
  evaluateBots,
  isValidStrategy,
  type SignalCandidate,
} from "@/lib/scanner";
import { sendWebhookMessage } from "@/lib/discord/rest";
import { signalEmbed } from "@/lib/discord/components";
import { bumpUsage } from "@/lib/usage";
import type { StrategyId } from "@/lib/backtest";

// Node.js runtime (heavy indicator math) + อนุญาตถึง 60 วิ
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// ─── Tick scheduler ─────────────────────────────────────────────
// GitHub Actions ยิงทุก ~5 นาที → endpoint นี้เลือกเฉพาะ bot ที่ "ถึงรอบ"
// (now - lastPolledAt >= pollSec) มาดึงข้อมูล → เช็กสัญญาณ → ยิง Discord
// ถ้ายังไม่มีบอทใน Redis (หรือไม่ได้ตั้ง Upstash) จะ fallback ไปสแกนตาม env SCAN_*

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed
  const fromQuery = req.nextUrl.searchParams.get("secret");
  const fromHeader = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return fromQuery === secret || fromHeader === secret;
}

// สร้าง "pseudo-bot" จาก env (โหมด fallback ก่อนสร้างบอทผ่าน Discord)
function synthEnvBots(): Bot[] {
  const symbols = (process.env.SCAN_SYMBOLS || "")
    .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const interval = (process.env.SCAN_INTERVAL || "1h").trim();
  const strategies = (process.env.SCAN_STRATEGIES || "supertrend")
    .split(",").map((s) => s.trim()).filter(isValidStrategy) as StrategyId[];
  const bots: Bot[] = [];
  for (const symbol of symbols) {
    for (const strategyId of strategies) {
      bots.push({
        id: `env:${symbol}:${interval}:${strategyId}`,
        symbol,
        interval,
        pollSec: 0,
        strategyId,
        status: "running",
        lastPolledAt: 0,
        createdBy: "env",
        createdAt: 0,
      });
    }
  }
  return bots;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const cfg = await getConfig();
  const storeOn = isStoreConfigured();

  // 1) หา bot ที่ "ถึงรอบ"
  let due: Bot[] = [];
  let usingEnvFallback = false;
  if (storeOn) {
    const bots = await getBots();
    if (bots.length === 0) {
      due = synthEnvBots();
      usingEnvFallback = due.length > 0;
    } else {
      due = bots
        .filter((b) => b.status === "running")
        .filter((b) => now - (b.lastPolledAt || 0) >= b.pollSec * 1000);
    }
  } else {
    due = synthEnvBots();
    usingEnvFallback = due.length > 0;
  }

  if (due.length === 0) {
    return NextResponse.json({ ok: true, mode: storeOn ? "bots" : "env", due: 0, sent: 0 });
  }

  // 2) ประเมินสัญญาณ (จัดกลุ่ม symbol+interval ดึง klines ครั้งเดียวต่อกลุ่ม)
  const limit = Math.min(Math.max(cfg.limit, 100), 1000);
  const { candidates, errors, groupsFetched } = await evaluateBots(
    due,
    cfg.freshnessMin,
    limit,
  );

  // 3) กันยิงซ้ำ (เทียบ closeTime กับ lastAlert)
  const toSend: SignalCandidate[] = [];
  for (const c of candidates) {
    if (storeOn) {
      try {
        const la = await getLastAlert(c.bot.id);
        if (la && la.closeTime === c.closeTime) continue;
      } catch {
        /* ถ้าอ่าน lastAlert ไม่ได้ ก็ส่ง (freshness กันซ้ำในระดับหนึ่งแล้ว) */
      }
    }
    toSend.push(c);
  }

  // 4) จัดกลุ่มตาม webhook แล้วยิง (ทีละ ≤10 embeds)
  const byHook = new Map<string, SignalCandidate[]>();
  const fallbackHook = process.env.DISCORD_WEBHOOK_URL || "";
  for (const c of toSend) {
    const hook = c.bot.webhookUrl || fallbackHook;
    if (!hook) {
      errors.push(`${c.bot.id}: ไม่มี webhook ปลายทาง`);
      continue;
    }
    const arr = byHook.get(hook);
    if (arr) arr.push(c);
    else byHook.set(hook, [c]);
  }

  let sent = 0;
  for (const [hook, list] of byHook) {
    for (let k = 0; k < list.length; k += 10) {
      const batch = list.slice(k, k + 10);
      try {
        await sendWebhookMessage(hook, {
          username: "Crypto Signal Bot",
          embeds: batch.map((c) =>
            signalEmbed({
              symbol: c.bot.symbol,
              interval: c.bot.interval,
              signal: c.signal,
              price: c.price,
              strategyName: c.strategyName,
              closeTime: c.closeTime,
            }),
          ),
        });
        sent += batch.length;
        if (storeOn) {
          for (const c of batch) {
            try {
              await setLastAlert(c.bot.id, { closeTime: c.closeTime, signal: c.signal });
            } catch {
              /* ignore */
            }
          }
        }
      } catch (err) {
        errors.push(`discord: ${String(err)}`);
      }
    }
  }

  // 5) อัปเดต lastPolledAt ของ bot จริงที่ถึงรอบ (ไม่ใช่ env fallback)
  if (storeOn && !usingEnvFallback) {
    for (const b of due) {
      b.lastPolledAt = now;
      try {
        await upsertBot(b);
      } catch {
        /* ignore */
      }
    }
  }

  // 6) นับ usage
  await bumpUsage("scanTicks");
  await bumpUsage("klineFetches", groupsFetched);
  await bumpUsage("discordSends", sent);

  return NextResponse.json({
    ok: true,
    mode: usingEnvFallback ? "env" : "bots",
    due: due.length,
    candidates: candidates.length,
    sent,
    errors,
  });
}
