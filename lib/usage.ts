import { isStoreConfigured, redisCommand } from "@/lib/store";

// ─── ลิมิตฟรี (อ้างอิง — ตรวจกับหน้า pricing เป็นระยะ เพราะเปลี่ยนได้) ──
export const FREE_LIMITS = {
  upstashCmds: 500_000, // commands/เดือน
  upstashStorageMB: 256,
  ghMinutesPrivate: 2000, // นาที/เดือน (private repo; public = ไม่จำกัด)
  vercelBandwidthGB: 100,
} as const;

export type UsageField =
  | "scanTicks"
  | "klineFetches"
  | "discordSends"
  | "interactions";

function monthKey(month?: string): string {
  const m = month || new Date().toISOString().slice(0, 7); // YYYY-MM
  return `usage:${m}`;
}

// HINCRBY usage:<YYYY-MM> field by — เงียบถ้ายังไม่ได้ตั้ง store
export async function bumpUsage(field: UsageField, by = 1): Promise<void> {
  if (!isStoreConfigured() || by === 0) return;
  try {
    await redisCommand(["HINCRBY", monthKey(), field, by]);
  } catch {
    /* usage เป็นข้อมูลประกอบ — ห้ามทำงานหลักพัง */
  }
}

export async function getUsage(month?: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!isStoreConfigured()) return out;
  try {
    const raw = await redisCommand<unknown>(["HGETALL", monthKey(month)]);
    if (Array.isArray(raw)) {
      for (let i = 0; i + 1 < raw.length; i += 2) {
        out[String(raw[i])] = Number(raw[i + 1]) || 0;
      }
    } else if (raw && typeof raw === "object") {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        out[k] = Number(v) || 0;
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}

export async function getRedisKeyCount(): Promise<number> {
  if (!isStoreConfigured()) return 0;
  try {
    const n = await redisCommand<number>(["DBSIZE"]);
    return Number(n) || 0;
  } catch {
    return 0;
  }
}

// ออปชัน — ต้องตั้ง GITHUB_TOKEN (PAT) + GITHUB_BILLING_USER (username/org)
// public repo จะคืน null (Actions ไม่จำกัด/ไม่นับนาที → การ์ดแสดง "unlimited")
export async function getGithubMinutes(): Promise<{
  used: number;
  included: number;
} | null> {
  const token = process.env.GITHUB_TOKEN;
  const user = process.env.GITHUB_BILLING_USER;
  if (!token || !user) return null;
  try {
    const res = await fetch(
      `https://api.github.com/users/${user}/settings/billing/actions`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      total_minutes_used?: number;
      included_minutes?: number;
    };
    return {
      used: data.total_minutes_used ?? 0,
      included: data.included_minutes ?? FREE_LIMITS.ghMinutesPrivate,
    };
  } catch {
    return null;
  }
}
