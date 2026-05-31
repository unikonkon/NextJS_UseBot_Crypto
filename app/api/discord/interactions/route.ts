import { after } from "next/server";
import { verifyDiscordRequest } from "@/lib/discord/verify";
import {
  isStoreConfigured,
  getBot,
  getBots,
  upsertBot,
  deleteBot,
  getConfig,
  setConfig,
} from "@/lib/store";
import {
  type Bot,
  type BotConfig,
  type BotStatus,
  makeBotId,
} from "@/lib/types/bot";
import {
  botControlCard,
  systemCard,
  strategyName,
  pollLabel,
} from "@/lib/discord/components";
import {
  postMessage,
  editMessage,
  deleteMessage,
  ensureChannelWebhook,
  editOriginalInteraction,
} from "@/lib/discord/rest";
import {
  getUsage,
  getRedisKeyCount,
  getGithubMinutes,
  bumpUsage,
} from "@/lib/usage";
import { ALLOWED_INTERVALS, ALLOWED_POLLS } from "@/lib/discord/commands";
import {
  peekBots,
  fetchClosedKlines,
  isValidStrategy,
  defaultParamsFor,
  strategyDisplayName,
} from "@/lib/scanner";
import { runBacktest, STRATEGIES, type StrategyId } from "@/lib/backtest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── Discord interaction / response types ───
// Interaction.type: PING=1, APPLICATION_COMMAND=2, MESSAGE_COMPONENT=3, AUTOCOMPLETE=4
// Response.type: PONG=1, MESSAGE=4, DEFERRED_MESSAGE=5, DEFERRED_UPDATE=6, UPDATE_MESSAGE=7, AUTOCOMPLETE_RESULT=8
const EPHEMERAL = 64;
const SYMBOL_RE = /^[A-Z0-9]{5,20}$/;

interface DOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: DOption[];
  focused?: boolean;
}
interface DData {
  name?: string;
  options?: DOption[];
  custom_id?: string;
}
interface Interaction {
  type: number;
  data?: DData;
  token: string;
  channel_id?: string;
  message?: { id: string };
  member?: { user?: { id: string; username?: string } };
  user?: { id: string; username?: string };
}

// ─── response helpers ───
function json(obj: Record<string, unknown>): Response {
  return Response.json(obj);
}
function ephemeral(content: string): Response {
  return json({ type: 4, data: { content, flags: EPHEMERAL } });
}
function deferred(isEphemeral: boolean): Response {
  return json({ type: 5, data: isEphemeral ? { flags: EPHEMERAL } : {} });
}
function deferredUpdate(): Response {
  return json({ type: 6 });
}
function updateMessage(data: Record<string, unknown>): Response {
  return json({ type: 7, data });
}
function autocomplete(choices: { name: string; value: string }[]): Response {
  return json({ type: 8, data: { choices } });
}

// ─── option helpers ───
function userId(i: Interaction): string {
  return i.member?.user?.id ?? i.user?.id ?? "unknown";
}
function subcommand(data?: DData): DOption | null {
  const o = data?.options?.[0];
  return o && o.type === 1 ? o : null;
}
function optVal(
  options: DOption[] | undefined,
  name: string,
): string | number | boolean | undefined {
  return options?.find((o) => o.name === name)?.value;
}
function findFocused(options?: DOption[]): DOption | null {
  if (!options) return null;
  for (const o of options) {
    if (o.focused) return o;
    const nested = findFocused(o.options);
    if (nested) return nested;
  }
  return null;
}

const HELP_TEXT = [
  "**🤖 Crypto Signal Bot — วิธีใช้**",
  "`/bot create` — สร้างบอท (เลือก เหรียญ · ช่วงเวลา · polling · อินดิเคเตอร์ · [ช่องแจ้งเตือน])",
  "`/bot list` — ดูบอททั้งหมด",
  "`/bot start|stop|delete <id>` — เริ่ม/หยุด/ลบบอท (หรือกดปุ่มที่ช่องสถานะ)",
  "`/bot status` — รีเฟรชการ์ดควบคุมในช่องสถานะ",
  "`/scan [id]` — ดูสัญญาณตอนนี้",
  "`/backtest <symbol> <interval> <strategy>` — ทดสอบย้อนหลัง",
  "`/quota` — สถานะระบบ + โควต้าฟรี",
  "`/config show|set` — ค่าเริ่มต้นส่วนกลาง",
].join("\n");

// ─── main handler ───
export async function POST(req: Request): Promise<Response> {
  const raw = await req.text();
  const sig = req.headers.get("x-signature-ed25519");
  const ts = req.headers.get("x-signature-timestamp");
  if (!verifyDiscordRequest(raw, sig, ts, process.env.DISCORD_PUBLIC_KEY)) {
    return new Response("invalid request signature", { status: 401 });
  }

  let interaction: Interaction;
  try {
    interaction = JSON.parse(raw) as Interaction;
  } catch {
    return new Response("bad request", { status: 400 });
  }

  switch (interaction.type) {
    case 1:
      return json({ type: 1 }); // PING → PONG
    case 2:
      return handleCommand(interaction);
    case 3:
      return handleComponent(interaction);
    case 4:
      return handleAutocomplete(interaction);
    default:
      return json({ type: 1 });
  }
}

// ─── slash command router ───
async function handleCommand(i: Interaction): Promise<Response> {
  await bumpUsage("interactions");
  if (!i.data?.name) return ephemeral("คำสั่งไม่ถูกต้อง");
  switch (i.data.name) {
    case "bot":
      return handleBot(i);
    case "quota":
      return handleQuota(i);
    case "scan":
      return handleScan(i);
    case "backtest":
      return handleBacktest(i);
    case "config":
      return handleConfig(i);
    case "help":
      return ephemeral(HELP_TEXT);
    default:
      return ephemeral("ไม่รู้จักคำสั่งนี้");
  }
}

async function handleBot(i: Interaction): Promise<Response> {
  const s = subcommand(i.data);
  if (!s) return ephemeral("คำสั่งไม่ถูกต้อง");
  switch (s.name) {
    case "create":
      return botCreate(i, s);
    case "list":
      return botList();
    case "start":
      return botToggle(s, "running");
    case "stop":
      return botToggle(s, "stopped");
    case "delete":
      return botDelete(s);
    case "status":
      return botStatus(i);
    default:
      return ephemeral("คำสั่งย่อยไม่ถูกต้อง");
  }
}

async function botCreate(i: Interaction, s: DOption): Promise<Response> {
  if (!isStoreConfigured()) {
    return ephemeral("⚠️ ยังไม่ได้ตั้งค่า Upstash (KV_REST_API_URL / KV_REST_API_TOKEN)");
  }
  const symbol = String(optVal(s.options, "symbol") ?? "").toUpperCase().trim();
  const interval = String(optVal(s.options, "interval") ?? "");
  const pollSec = Number(optVal(s.options, "poll"));
  const strategyId = String(optVal(s.options, "indicator") ?? "");
  const channelId = optVal(s.options, "channel") as string | undefined;

  if (!SYMBOL_RE.test(symbol)) return ephemeral("❌ symbol ไม่ถูกต้อง (เช่น BTCUSDT)");
  if (!ALLOWED_INTERVALS.has(interval)) return ephemeral("❌ interval ไม่ถูกต้อง");
  if (!ALLOWED_POLLS.has(pollSec)) return ephemeral("❌ ค่า poll ไม่ถูกต้อง");
  if (!isValidStrategy(strategyId)) return ephemeral(`❌ ไม่รู้จักอินดิเคเตอร์ \`${strategyId}\``);

  const id = makeBotId(symbol, interval, pollSec, strategyId);
  if (await getBot(id)) return ephemeral(`⚠️ มีบอทนี้อยู่แล้ว: \`${id}\``);

  const bot: Bot = {
    id,
    symbol,
    interval,
    pollSec,
    strategyId: strategyId as StrategyId,
    status: "stopped",
    alertChannelId: channelId,
    lastPolledAt: 0,
    createdBy: userId(i),
    createdAt: Date.now(),
  };
  await upsertBot(bot);

  // งานช้า (สร้าง webhook ในช่อง + โพสต์การ์ด) ทำหลังตอบ ack
  after(async () => {
    try {
      if (channelId) {
        try {
          bot.webhookUrl = await ensureChannelWebhook(channelId);
        } catch {
          // ไม่มีสิทธิ์ Manage Webhooks → ใช้ webhook กลาง (env)
        }
      }
      const statusCh = process.env.DISCORD_STATUS_CHANNEL_ID;
      if (statusCh) {
        const msg = await postMessage(statusCh, botControlCard(bot));
        bot.statusMessageId = msg.id;
      }
      await upsertBot(bot);
    } catch {
      // เพิกเฉย — บอทถูกบันทึกไว้แล้ว
    }
  });

  const chNote = channelId ? ` · แจ้งเตือนที่ <#${channelId}>` : "";
  return ephemeral(
    `✅ สร้างบอท \`${id}\` แล้ว${chNote}\nไปกด ▶️ เริ่ม ที่ช่องสถานะ หรือใช้ \`/bot start\``,
  );
}

async function botList(): Promise<Response> {
  if (!isStoreConfigured()) return ephemeral("⚠️ ยังไม่ได้ตั้งค่า Upstash");
  const bots = await getBots();
  if (!bots.length) return ephemeral("ยังไม่มีบอท — ใช้ `/bot create` เพื่อสร้าง");
  const lines = bots.map(
    (b) =>
      `${b.status === "running" ? "🟢" : "⚪"} \`${b.id}\` · ${strategyName(b.strategyId)} · poll ${pollLabel(b.pollSec)}`,
  );
  return ephemeral(lines.join("\n").slice(0, 1900));
}

async function botToggle(s: DOption, status: BotStatus): Promise<Response> {
  if (!isStoreConfigured()) return ephemeral("⚠️ ยังไม่ได้ตั้งค่า Upstash");
  const id = String(optVal(s.options, "id") ?? "");
  const bot = await getBot(id);
  if (!bot) return ephemeral(`❌ ไม่พบบอท \`${id}\``);
  bot.status = status;
  if (status === "running") bot.lastPolledAt = 0; // ให้ดึงรอบถัดไปทันที
  await upsertBot(bot);
  after(() => refreshCard(bot));
  return ephemeral(`${status === "running" ? "▶️ เริ่ม" : "⏸️ หยุด"} \`${id}\``);
}

async function botDelete(s: DOption): Promise<Response> {
  if (!isStoreConfigured()) return ephemeral("⚠️ ยังไม่ได้ตั้งค่า Upstash");
  const id = String(optVal(s.options, "id") ?? "");
  const bot = await getBot(id);
  if (!bot) return ephemeral(`❌ ไม่พบบอท \`${id}\``);
  await deleteBot(id);
  after(async () => {
    const statusCh = process.env.DISCORD_STATUS_CHANNEL_ID;
    if (statusCh && bot.statusMessageId) {
      await deleteMessage(statusCh, bot.statusMessageId);
    }
  });
  return ephemeral(`🗑️ ลบบอท \`${id}\` แล้ว`);
}

async function botStatus(i: Interaction): Promise<Response> {
  if (!isStoreConfigured()) return ephemeral("⚠️ ยังไม่ได้ตั้งค่า Upstash");
  if (!process.env.DISCORD_STATUS_CHANNEL_ID) {
    return ephemeral("⚠️ ยังไม่ได้ตั้ง DISCORD_STATUS_CHANNEL_ID");
  }
  after(async () => {
    const bots = await getBots();
    for (const b of bots) await refreshCard(b);
    try {
      await editOriginalInteraction(i.token, {
        content: `🔄 รีเฟรชการ์ด ${bots.length} บอทแล้ว`,
      });
    } catch {
      /* ignore */
    }
  });
  return deferred(true);
}

async function refreshCard(bot: Bot): Promise<void> {
  const statusCh = process.env.DISCORD_STATUS_CHANNEL_ID;
  if (!statusCh) return;
  try {
    if (bot.statusMessageId) {
      await editMessage(statusCh, bot.statusMessageId, botControlCard(bot));
    } else {
      const msg = await postMessage(statusCh, botControlCard(bot));
      bot.statusMessageId = msg.id;
      await upsertBot(bot);
    }
  } catch {
    /* ignore */
  }
}

async function handleQuota(i: Interaction): Promise<Response> {
  after(async () => {
    try {
      await editOriginalInteraction(i.token, await buildSystemCard());
    } catch {
      /* ignore */
    }
  });
  return deferred(false); // public → การ์ดอยู่ในช่องพร้อมปุ่มรีเฟรช
}

async function buildSystemCard(): Promise<Record<string, unknown>> {
  const bots = isStoreConfigured() ? await getBots() : [];
  const [usage, redisKeys, github] = await Promise.all([
    getUsage(),
    getRedisKeyCount(),
    getGithubMinutes(),
  ]);
  const running = bots.filter((b) => b.status === "running").length;
  return systemCard({
    bots: { total: bots.length, running, stopped: bots.length - running },
    usage,
    redisKeys,
    github,
  });
}

async function handleScan(i: Interaction): Promise<Response> {
  const id = optVal(i.data?.options, "id") as string | undefined;
  after(async () => {
    try {
      let bots: Bot[] = [];
      if (isStoreConfigured()) {
        const all = await getBots();
        bots = id
          ? all.filter((b) => b.id === id)
          : all.filter((b) => b.status === "running");
      }
      if (!bots.length) {
        await editOriginalInteraction(i.token, {
          content: id ? `❌ ไม่พบบอท \`${id}\`` : "ไม่มีบอทที่กำลังทำงาน",
        });
        return;
      }
      const cfg = await getConfig();
      const { rows, errors } = await peekBots(bots, cfg.limit);
      await bumpUsage("klineFetches");
      const lines = rows.map((r) => {
        const emoji = r.signal === "BUY" ? "🟢" : r.signal === "SELL" ? "🔴" : "⚪";
        return `${emoji} \`${r.bot.symbol} ${r.bot.interval}\` · ${r.strategyName}: **${r.signal}** @ \`${r.price}\``;
      });
      const content =
        (lines.join("\n") || "ไม่มีผล") +
        (errors.length ? `\n\n⚠️ ${errors.length} error` : "");
      await editOriginalInteraction(i.token, { content: content.slice(0, 1900) });
    } catch (err) {
      try {
        await editOriginalInteraction(i.token, {
          content: `❌ ${String(err)}`.slice(0, 1900),
        });
      } catch {
        /* ignore */
      }
    }
  });
  return deferred(true);
}

async function handleBacktest(i: Interaction): Promise<Response> {
  const opts = i.data?.options;
  const symbol = String(optVal(opts, "symbol") ?? "").toUpperCase().trim();
  const interval = String(optVal(opts, "interval") ?? "");
  const strategy = String(optVal(opts, "strategy") ?? "");
  after(async () => {
    try {
      if (
        !SYMBOL_RE.test(symbol) ||
        !ALLOWED_INTERVALS.has(interval) ||
        !isValidStrategy(strategy)
      ) {
        await editOriginalInteraction(i.token, { content: "❌ พารามิเตอร์ไม่ถูกต้อง" });
        return;
      }
      const klines = await fetchClosedKlines(symbol, interval, 500);
      await bumpUsage("klineFetches");
      const r = runBacktest(
        klines,
        strategy as StrategyId,
        defaultParamsFor(strategy as StrategyId),
      );
      const embed = {
        title: `📈 Backtest — ${symbol} (${interval})`,
        description: `กลยุทธ์: **${strategyDisplayName(strategy)}**`,
        color: r.totalPnlPct >= 0 ? 0x22c55e : 0xef4444,
        fields: [
          { name: "กำไรรวม (สุทธิ)", value: `${r.totalPnlPct.toFixed(2)}%`, inline: true },
          { name: "Buy & Hold", value: `${r.buyAndHoldPct.toFixed(2)}%`, inline: true },
          { name: "จำนวนเทรด", value: `${r.totalTrades}`, inline: true },
          { name: "Win rate", value: `${r.winRate.toFixed(1)}%`, inline: true },
          {
            name: "Profit factor",
            value: Number.isFinite(r.profitFactor) ? r.profitFactor.toFixed(2) : "∞",
            inline: true,
          },
          { name: "Max DD", value: `${r.maxDrawdownPct.toFixed(2)}%`, inline: true },
        ],
        footer: { text: `${klines.length} แท่ง` },
      };
      await editOriginalInteraction(i.token, { embeds: [embed] });
    } catch (err) {
      try {
        await editOriginalInteraction(i.token, {
          content: `❌ ${String(err)}`.slice(0, 1900),
        });
      } catch {
        /* ignore */
      }
    }
  });
  return deferred(true);
}

async function handleConfig(i: Interaction): Promise<Response> {
  if (!isStoreConfigured()) return ephemeral("⚠️ ยังไม่ได้ตั้งค่า Upstash");
  const s = subcommand(i.data);
  if (!s) return ephemeral("คำสั่งไม่ถูกต้อง");
  if (s.name === "show") {
    const cfg = await getConfig();
    return ephemeral(
      `⚙️ ค่าปัจจุบัน:\n• defaultPollSec: \`${cfg.defaultPollSec}\`\n• limit: \`${cfg.limit}\`\n• freshnessMin: \`${cfg.freshnessMin}\``,
    );
  }
  if (s.name === "set") {
    const key = String(optVal(s.options, "key") ?? "");
    const value = Number(optVal(s.options, "value"));
    const allowed = ["defaultPollSec", "limit", "freshnessMin"];
    if (!allowed.includes(key) || !Number.isFinite(value)) {
      return ephemeral("❌ key/value ไม่ถูกต้อง");
    }
    const next = await setConfig({ [key]: value } as Partial<BotConfig>);
    return ephemeral(
      `✅ ตั้ง \`${key}\` = \`${value}\`\nค่าปัจจุบัน: \`${JSON.stringify(next)}\``,
    );
  }
  return ephemeral("คำสั่งย่อยไม่ถูกต้อง");
}

// ─── component (ปุ่ม) ───
async function handleComponent(i: Interaction): Promise<Response> {
  await bumpUsage("interactions");
  const customId = i.data?.custom_id ?? "";
  const parts = customId.split(":");
  const ns = parts[0];

  if (ns === "sys" && parts[1] === "refresh") {
    after(async () => {
      try {
        await editOriginalInteraction(i.token, await buildSystemCard());
      } catch {
        /* ignore */
      }
    });
    return deferredUpdate();
  }

  if (ns === "bot") {
    const action = parts[1];
    const id = parts.slice(2).join(":");
    if (!isStoreConfigured()) return ephemeral("⚠️ ยังไม่ได้ตั้งค่า Upstash");
    const bot = await getBot(id);

    if (action === "delete") {
      if (bot) await deleteBot(id);
      const ch = i.channel_id;
      const msgId = i.message?.id;
      after(async () => {
        if (ch && msgId) await deleteMessage(ch, msgId);
      });
      return deferredUpdate();
    }
    if (!bot) {
      return updateMessage({
        content: `❌ ไม่พบบอท \`${id}\` (อาจถูกลบไปแล้ว)`,
        embeds: [],
        components: [],
      });
    }
    if (action === "start" || action === "stop") {
      bot.status = action === "start" ? "running" : "stopped";
      if (action === "start") bot.lastPolledAt = 0;
      if (i.message?.id) bot.statusMessageId = i.message.id;
      await upsertBot(bot);
      return updateMessage(botControlCard(bot));
    }
  }
  return deferredUpdate();
}

// ─── autocomplete ───
async function handleAutocomplete(i: Interaction): Promise<Response> {
  const focused = findFocused(i.data?.options);
  if (!focused) return autocomplete([]);
  const q = String(focused.value ?? "").toLowerCase();

  if (focused.name === "indicator" || focused.name === "strategy") {
    const choices = STRATEGIES.filter(
      (s) => s.id.includes(q) || s.name.toLowerCase().includes(q),
    )
      .slice(0, 25)
      .map((s) => ({ name: s.name.slice(0, 100), value: s.id }));
    return autocomplete(choices);
  }
  if (focused.name === "id") {
    if (!isStoreConfigured()) return autocomplete([]);
    const bots = await getBots();
    const choices = bots
      .filter((b) => b.id.toLowerCase().includes(q))
      .slice(0, 25)
      .map((b) => ({
        name: `${b.status === "running" ? "🟢" : "⚪"} ${b.id}`.slice(0, 100),
        value: b.id,
      }));
    return autocomplete(choices);
  }
  return autocomplete([]);
}
