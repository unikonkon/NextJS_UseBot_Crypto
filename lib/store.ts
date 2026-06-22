import {
  type Bot,
  type BotConfig,
  DEFAULT_BOT_CONFIG,
} from "@/lib/types/bot";

// ─── Upstash Redis ผ่าน REST API (fetch ล้วน, zero-dep) ──────────
// รองรับทั้งชื่อ env แบบ Vercel KV (KV_REST_API_*) และ Upstash ตรง ๆ (UPSTASH_REDIS_REST_*)
function restUrl(): string | undefined {
  return process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
}
function restToken(): string | undefined {
  return process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
}

export function isStoreConfigured(): boolean {
  return Boolean(restUrl() && restToken());
}

const KEY_BOTS = "bot:bots"; // hash: field=botId → JSON Bot
const KEY_CONFIG = "bot:config"; // string: JSON BotConfig
const KEY_LAST_ALERT = "bot:lastAlert"; // hash: field=botId → "closeTime|signal"
const KEY_LAST_HEARTBEAT = "bot:lastHeartbeat"; // hash: field=botId → timestamp(ms)

type RedisArg = string | number;

// เรียกคำสั่ง Redis คำสั่งเดียวผ่าน Upstash REST
async function redis<T = unknown>(command: RedisArg[]): Promise<T> {
  const url = restUrl();
  const token = restToken();
  if (!url || !token) {
    throw new Error("Upstash REST ยังไม่ได้ตั้งค่า (KV_REST_API_URL / KV_REST_API_TOKEN)");
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Upstash error ${res.status}: ${detail}`);
  }
  const data = (await res.json()) as { result?: T; error?: string };
  if (data.error) throw new Error(`Upstash: ${data.error}`);
  return data.result as T;
}

// export ให้ lib/usage.ts เรียกคำสั่ง Redis (DBSIZE/HINCRBY/HGETALL) ใช้ร่วมกันได้
export async function redisCommand<T = unknown>(command: RedisArg[]): Promise<T> {
  return redis<T>(command);
}

// HGETALL คืน array สลับ [field, value, field, value, ...] → object
function flatToObject(flat: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(flat)) {
    for (let i = 0; i + 1 < flat.length; i += 2) {
      out[String(flat[i])] = String(flat[i + 1]);
    }
  } else if (flat && typeof flat === "object") {
    // Upstash บางเวอร์ชันคืนเป็น object ตรง ๆ
    for (const [k, v] of Object.entries(flat as Record<string, unknown>)) {
      out[k] = String(v);
    }
  }
  return out;
}

// ─── Bots ───────────────────────────────────────────────────────
export async function getBots(): Promise<Bot[]> {
  if (!isStoreConfigured()) return [];
  const raw = await redis<unknown>(["HGETALL", KEY_BOTS]);
  const obj = flatToObject(raw);
  const bots: Bot[] = [];
  for (const v of Object.values(obj)) {
    try {
      bots.push(JSON.parse(v) as Bot);
    } catch {
      /* ข้าม record ที่ parse ไม่ได้ */
    }
  }
  return bots;
}

export async function getBot(id: string): Promise<Bot | null> {
  if (!isStoreConfigured()) return null;
  const v = await redis<string | null>(["HGET", KEY_BOTS, id]);
  if (!v) return null;
  try {
    return JSON.parse(v) as Bot;
  } catch {
    return null;
  }
}

export async function upsertBot(bot: Bot): Promise<void> {
  await redis(["HSET", KEY_BOTS, bot.id, JSON.stringify(bot)]);
}

export async function deleteBot(id: string): Promise<void> {
  await redis(["HDEL", KEY_BOTS, id]);
  try {
    await redis(["HDEL", KEY_LAST_ALERT, id]);
    await redis(["HDEL", KEY_LAST_HEARTBEAT, id]);
  } catch {
    /* ignore */
  }
}

// ─── lastAlert (กันยิงซ้ำ) ───────────────────────────────────────
export interface LastAlert {
  closeTime: number;
  signal: string;
}

export async function getLastAlert(id: string): Promise<LastAlert | null> {
  if (!isStoreConfigured()) return null;
  const v = await redis<string | null>(["HGET", KEY_LAST_ALERT, id]);
  if (!v) return null;
  const [closeTime, signal] = v.split("|");
  return { closeTime: Number(closeTime), signal: signal ?? "" };
}

export async function setLastAlert(id: string, v: LastAlert): Promise<void> {
  await redis(["HSET", KEY_LAST_ALERT, id, `${v.closeTime}|${v.signal}`]);
}

// ─── lastHeartbeat (คุมรอบ heartbeat สรุปสถานะ) ──────────────────
export async function getLastHeartbeat(id: string): Promise<number> {
  if (!isStoreConfigured()) return 0;
  const v = await redis<string | null>(["HGET", KEY_LAST_HEARTBEAT, id]);
  return v ? Number(v) : 0;
}

export async function setLastHeartbeat(id: string, ts: number): Promise<void> {
  await redis(["HSET", KEY_LAST_HEARTBEAT, id, String(ts)]);
}

// ─── Config (ค่า default ส่วนกลาง) ───────────────────────────────
function envConfig(): BotConfig {
  // heartbeatMin รองรับค่า 0 (=ปิด) จึงไม่ใช้ `|| default` ที่จะกลืน 0
  const hbRaw = process.env.HEARTBEAT_MIN;
  const heartbeatMin =
    hbRaw !== undefined && hbRaw.trim() !== ""
      ? Number(hbRaw)
      : DEFAULT_BOT_CONFIG.heartbeatMin;
  return {
    defaultPollSec: DEFAULT_BOT_CONFIG.defaultPollSec,
    limit: Number(process.env.SCAN_LIMIT) || DEFAULT_BOT_CONFIG.limit,
    freshnessMin:
      Number(process.env.SIGNAL_FRESHNESS_MIN) || DEFAULT_BOT_CONFIG.freshnessMin,
    heartbeatMin: Number.isFinite(heartbeatMin)
      ? heartbeatMin
      : DEFAULT_BOT_CONFIG.heartbeatMin,
  };
}

export async function getConfig(): Promise<BotConfig> {
  const base = envConfig();
  if (!isStoreConfigured()) return base;
  try {
    const v = await redis<string | null>(["GET", KEY_CONFIG]);
    if (!v) return base;
    return { ...base, ...(JSON.parse(v) as Partial<BotConfig>) };
  } catch {
    return base;
  }
}

export async function setConfig(patch: Partial<BotConfig>): Promise<BotConfig> {
  const next = { ...(await getConfig()), ...patch };
  await redis(["SET", KEY_CONFIG, JSON.stringify(next)]);
  return next;
}
