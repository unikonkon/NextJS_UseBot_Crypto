// ─── Discord REST helpers ───────────────────────────────────────
// แยกสองโหมด: (1) Bot token สำหรับโพสต์/แก้การ์ด + จัดการ webhook
//             (2) interaction token / webhook URL (ไม่ต้องใช้ bot token)
const API = "https://discord.com/api/v10";
const WEBHOOK_NAME = "Crypto Signal Bot";

function botToken(): string {
  const t = process.env.DISCORD_BOT_TOKEN;
  if (!t) throw new Error("ยังไม่ได้ตั้ง DISCORD_BOT_TOKEN");
  return t;
}

async function botFetch(
  path: string,
  init: RequestInit & { method: string },
): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bot ${botToken()}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  return res;
}

// โพสต์ข้อความ (การ์ดควบคุม/สถานะ) ลงช่องด้วย Bot token
export async function postMessage(
  channelId: string,
  payload: Record<string, unknown>,
): Promise<{ id: string }> {
  const res = await botFetch(`/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`postMessage ${res.status}: ${await res.text()}`);
  }
  return (await res.json()) as { id: string };
}

export async function editMessage(
  channelId: string,
  messageId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const res = await botFetch(`/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`editMessage ${res.status}: ${await res.text()}`);
  }
}

export async function deleteMessage(
  channelId: string,
  messageId: string,
): Promise<void> {
  const res = await botFetch(`/channels/${channelId}/messages/${messageId}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`deleteMessage ${res.status}: ${await res.text()}`);
  }
}

// reuse webhook ที่แอปเราสร้างไว้ในช่อง (กรองด้วย application_id) ถ้าไม่มี → สร้างใหม่
// ต้องมีสิทธิ์ Manage Webhooks ในช่องนั้น
export async function ensureChannelWebhook(channelId: string): Promise<string> {
  const appId = process.env.DISCORD_APPLICATION_ID;
  const list = await botFetch(`/channels/${channelId}/webhooks`, {
    method: "GET",
  });
  if (list.ok) {
    const hooks = (await list.json()) as {
      id: string;
      token?: string;
      application_id?: string | null;
      url?: string;
    }[];
    const mine = hooks.find(
      (h) => h.token && (!appId || h.application_id === appId),
    );
    if (mine?.token) return `https://discord.com/api/webhooks/${mine.id}/${mine.token}`;
  }
  const created = await botFetch(`/channels/${channelId}/webhooks`, {
    method: "POST",
    body: JSON.stringify({ name: WEBHOOK_NAME }),
  });
  if (!created.ok) {
    throw new Error(`ensureChannelWebhook ${created.status}: ${await created.text()}`);
  }
  const hook = (await created.json()) as { id: string; token: string };
  return `https://discord.com/api/webhooks/${hook.id}/${hook.token}`;
}

// แก้ข้อความตอบกลับเดิมของ interaction (ใช้ interaction token, ไม่ต้องใช้ bot token)
export async function editOriginalInteraction(
  interactionToken: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const appId = process.env.DISCORD_APPLICATION_ID;
  const res = await fetch(
    `${API}/webhooks/${appId}/${interactionToken}/messages/@original`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    },
  );
  if (!res.ok) {
    throw new Error(`editOriginalInteraction ${res.status}: ${await res.text()}`);
  }
}

// ยิงข้อความผ่าน Discord webhook URL (ขา alert สัญญาณ — ไม่ต้องใช้ bot token)
export async function sendWebhookMessage(
  webhookUrl: string,
  payload: { content?: string; username?: string; embeds?: unknown[] },
): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`webhook ${res.status}: ${await res.text()}`);
  }
}
