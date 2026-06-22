import { STRATEGIES, type SignalAction } from "@/lib/backtest";
import type { Bot } from "@/lib/types/bot";
import { FREE_LIMITS } from "@/lib/usage";

const GREEN = 0x22c55e;
const RED = 0xef4444;
const GRAY = 0x94a3b8;
const BLUE = 0x3b82f6;

export function strategyName(id: string): string {
  return STRATEGIES.find((s) => s.id === id)?.name ?? id;
}

export function pollLabel(pollSec: number): string {
  if (pollSec <= 0) return "ทุกรอบ";
  if (pollSec % 86400 === 0) return `${pollSec / 86400}d`;
  if (pollSec % 3600 === 0) return `${pollSec / 3600}h`;
  if (pollSec % 60 === 0) return `${pollSec / 60}m`;
  return `${pollSec}s`;
}

// ─── embed สัญญาณ (ขา alert) ────────────────────────────────────
export function signalEmbed(p: {
  symbol: string;
  interval: string;
  signal: SignalAction;
  price: number;
  strategyName: string;
  closeTime: number;
}): Record<string, unknown> {
  const isBuy = p.signal === "BUY";
  return {
    title: `${isBuy ? "🟢 BUY" : "🔴 SELL"} · ${p.symbol} (${p.interval})`,
    color: isBuy ? GREEN : RED,
    fields: [
      { name: "กลยุทธ์", value: p.strategyName, inline: false },
      { name: "ราคา", value: `\`${p.price}\``, inline: true },
      { name: "สัญญาณ", value: `**${p.signal}**`, inline: true },
    ],
    footer: { text: "แท่งปิดเมื่อ" },
    timestamp: new Date(p.closeTime).toISOString(),
  };
}

// ─── embed heartbeat (สรุปสถานะปัจจุบันของบอทที่ถึงรอบ) ──────────
// ส่งทุกรอบ poll เพื่อยืนยันว่า bot ยังทำงาน แม้แท่งล่าสุดจะไม่มีสัญญาณพลิก
export function heartbeatEmbed(
  rows: {
    symbol: string;
    interval: string;
    strategyName: string;
    state: "LONG" | "FLAT" | "NONE";
    price: number;
    lastFlipSignal: "BUY" | "SELL" | "HOLD" | null;
    lastFlipTime: number | null;
  }[],
): Record<string, unknown> {
  const stateIcon = (s: "LONG" | "FLAT" | "NONE") =>
    s === "LONG" ? "🟢" : s === "FLAT" ? "🔴" : "⚪";
  const stateLabel = (s: "LONG" | "FLAT" | "NONE") =>
    s === "LONG" ? "ถือ (ขาขึ้น)" : s === "FLAT" ? "ออก (ขาลง)" : "ยังไม่มีสัญญาณ";

  const fields = rows.slice(0, 25).map((r) => {
    const flip =
      r.lastFlipSignal && r.lastFlipTime
        ? `${r.lastFlipSignal} · <t:${Math.floor(r.lastFlipTime / 1000)}:R>`
        : "—";
    return {
      name: `${stateIcon(r.state)} ${r.symbol} (${r.interval})`,
      value: [
        `กลยุทธ์: ${r.strategyName}`,
        `สถานะ: **${stateLabel(r.state)}**`,
        `ราคา: \`${r.price}\``,
        `พลิกล่าสุด: ${flip}`,
      ].join("\n"),
      inline: true,
    };
  });

  return {
    title: "💓 สรุปสถานะบอท (heartbeat)",
    color: BLUE,
    description: `กำลังทำงาน · ตรวจ ${rows.length} บอทรอบนี้`,
    fields,
    footer: { text: "สถานะปัจจุบันจากการรันอินดิเคเตอร์ใหม่ทุกรอบ" },
    timestamp: new Date().toISOString(),
  };
}

// ─── การ์ดควบคุม bot (embed + ปุ่ม) ─────────────────────────────
function button(
  customId: string,
  label: string,
  style: number,
  emoji?: string,
): Record<string, unknown> {
  const b: Record<string, unknown> = { type: 2, style, label, custom_id: customId };
  if (emoji) b.emoji = { name: emoji };
  return b;
}

export function botControlCard(bot: Bot): Record<string, unknown> {
  const running = bot.status === "running";
  const embed = {
    title: `${running ? "🟢" : "⚪"} ${bot.symbol} · ${bot.interval}`,
    color: running ? GREEN : GRAY,
    fields: [
      { name: "อินดิเคเตอร์", value: strategyName(bot.strategyId), inline: false },
      { name: "Polling", value: pollLabel(bot.pollSec), inline: true },
      { name: "สถานะ", value: running ? "กำลังทำงาน" : "หยุด", inline: true },
      {
        name: "แจ้งเตือน",
        value: bot.alertChannelId ? `<#${bot.alertChannelId}>` : "ช่องกลาง",
        inline: true,
      },
    ],
    footer: { text: `id: ${bot.id}` },
  };
  const row = {
    type: 1,
    components: running
      ? [
          button(`bot:stop:${bot.id}`, "หยุด", 2, "⏸️"),
          button(`bot:delete:${bot.id}`, "ลบ", 4, "🗑️"),
        ]
      : [
          button(`bot:start:${bot.id}`, "เริ่ม", 3, "▶️"),
          button(`bot:delete:${bot.id}`, "ลบ", 4, "🗑️"),
        ],
  };
  return { embeds: [embed], components: [row] };
}

// ─── การ์ดสถานะระบบ + โควต้าฟรี (B3) ────────────────────────────
function bar(used: number, limit: number, width = 10): string {
  if (limit <= 0) return "—";
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const filled = Math.round((pct / 100) * width);
  return `${"█".repeat(filled)}${"░".repeat(width - filled)} ${pct}%`;
}

export function systemCard(data: {
  bots: { total: number; running: number; stopped: number };
  usage: Record<string, number>;
  redisKeys: number;
  github: { used: number; included: number } | null;
}): Record<string, unknown> {
  const u = data.usage;
  const redisCmds =
    (u.scanTicks || 0) +
    (u.klineFetches || 0) +
    (u.discordSends || 0) +
    (u.interactions || 0);

  const lines = [
    `**Bots:** ${data.bots.total} (🟢 ${data.bots.running} / ⚪ ${data.bots.stopped})`,
    `**Scan ticks:** ${u.scanTicks || 0} · **Kline fetches:** ${u.klineFetches || 0}`,
    `**Discord sends:** ${u.discordSends || 0} · **Interactions:** ${u.interactions || 0}`,
    `**Redis keys:** ${data.redisKeys}`,
    `**Redis cmds (ประมาณ):** ${bar(redisCmds, FREE_LIMITS.upstashCmds)} (${redisCmds} / ${FREE_LIMITS.upstashCmds})`,
    `**GitHub Actions:** ${
      data.github
        ? `${bar(data.github.used, data.github.included)} (${data.github.used} / ${data.github.included} นาที)`
        : "unlimited (public repo / ไม่ได้ตั้ง GITHUB_TOKEN)"
    }`,
  ];

  const embed = {
    title: "📊 สถานะระบบ + โควต้าฟรี",
    color: BLUE,
    description: lines.join("\n"),
    footer: { text: `เดือน ${new Date().toISOString().slice(0, 7)} · ตัวเลข self-count = ค่าโดยประมาณ` },
  };
  const row = {
    type: 1,
    components: [button("sys:refresh", "รีเฟรช", 2, "🔄")],
  };
  return { embeds: [embed], components: [row] };
}
