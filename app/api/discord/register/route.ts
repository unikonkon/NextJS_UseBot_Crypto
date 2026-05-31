import { NextRequest, NextResponse } from "next/server";
import { COMMANDS } from "@/lib/discord/commands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── ลงทะเบียน Slash Commands (ยิงครั้งเดียวหลัง deploy) ───
// GET /api/discord/register?secret=<CRON_SECRET>
//   - ถ้าตั้ง DISCORD_GUILD_ID → ลงทะเบียนแบบ guild (ใช้ได้ทันที เหมาะกับทดสอบ)
//   - ไม่งั้น → ลงทะเบียนแบบ global (อาจใช้เวลาถึง ~1 ชม. กว่าจะเห็นครบทุก server)

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const fromQuery = req.nextUrl.searchParams.get("secret");
  const fromHeader = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return fromQuery === secret || fromHeader === secret;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const appId = process.env.DISCORD_APPLICATION_ID;
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!appId || !token) {
    return NextResponse.json(
      { error: "ต้องตั้ง DISCORD_APPLICATION_ID และ DISCORD_BOT_TOKEN ก่อน" },
      { status: 500 },
    );
  }

  const guildId = process.env.DISCORD_GUILD_ID;
  const path = guildId
    ? `/applications/${appId}/guilds/${guildId}/commands`
    : `/applications/${appId}/commands`;

  const res = await fetch(`https://discord.com/api/v10${path}`, {
    method: "PUT",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(COMMANDS),
    cache: "no-store",
  });

  const body = await res.text();
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, status: res.status, scope: guildId ? "guild" : "global", details: body },
      { status: 502 },
    );
  }

  let registered: unknown[] = [];
  try {
    registered = JSON.parse(body) as unknown[];
  } catch {
    /* ignore */
  }

  return NextResponse.json({
    ok: true,
    scope: guildId ? "guild" : "global",
    count: Array.isArray(registered) ? registered.length : 0,
    note: guildId
      ? "ลงทะเบียนแบบ guild — ใช้ได้ทันที"
      : "ลงทะเบียนแบบ global — อาจใช้เวลาถึง ~1 ชม.",
  });
}
