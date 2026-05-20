import { NextRequest, NextResponse } from "next/server";

interface NotifyBody {
  webhookUrl?: string;
  content?: string;
  username?: string;
  embeds?: unknown[];
}

export async function POST(request: NextRequest) {
  let body: NotifyBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const webhookUrl =
    (body.webhookUrl && body.webhookUrl.trim()) || process.env.DISCORD_WEBHOOK_URL || "";

  if (!webhookUrl) {
    return NextResponse.json(
      { error: "ยังไม่ได้ตั้ง Discord Webhook URL (env DISCORD_WEBHOOK_URL หรือใส่ผ่าน body.webhookUrl)" },
      { status: 400 }
    );
  }

  if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(webhookUrl)) {
    return NextResponse.json(
      { error: "Webhook URL ไม่ใช่รูปแบบของ Discord (ต้องขึ้นต้นด้วย https://discord.com/api/webhooks/...)" },
      { status: 400 }
    );
  }

  const payload: Record<string, unknown> = {};
  if (body.content) payload.content = body.content;
  if (body.username) payload.username = body.username;
  if (body.embeds && Array.isArray(body.embeds)) payload.embeds = body.embeds;

  if (!payload.content && !payload.embeds) {
    return NextResponse.json(
      { error: "ต้องมี content หรือ embeds อย่างน้อยหนึ่งอย่าง" },
      { status: 400 }
    );
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json(
        { error: `Discord error: ${res.status}`, details: detail },
        { status: res.status }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: "ส่ง Discord webhook ไม่สำเร็จ", details: String(err) },
      { status: 502 }
    );
  }
}
