import { NextRequest, NextResponse } from "next/server";
import { parseKline, type BinanceKlineRaw, type KlineData } from "@/lib/types/kline";
import { runBacktest, STRATEGIES, type StrategyId, type SignalAction } from "@/lib/backtest";

// Run on the Node.js runtime (crypto / heavy indicator math) and allow up to 60s.
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const BINANCE_BASE = "https://api.binance.com";

// Approximate duration of one candle in milliseconds — used to decide whether the
// last *closed* candle is fresh enough to alert on (Approach A: no DB, the external
// cron is expected to fire roughly once per closed candle).
const INTERVAL_MS: Record<string, number> = {
  "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000,
  "1h": 3_600_000, "2h": 7_200_000, "4h": 14_400_000, "6h": 21_600_000,
  "8h": 28_800_000, "12h": 43_200_000, "1d": 86_400_000, "3d": 259_200_000,
  "1w": 604_800_000,
};

const VALID_STRATEGY_IDS = new Set(STRATEGIES.map((s) => s.id));

function defaultParamsFor(id: StrategyId): Record<string, number> {
  return STRATEGIES.find((s) => s.id === id)?.params ?? {};
}

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed if not configured
  const fromQuery = req.nextUrl.searchParams.get("secret");
  const fromHeader = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  return fromQuery === secret || fromHeader === secret;
}

async function fetchClosedKlines(symbol: string, interval: string, limit: number): Promise<KlineData[]> {
  const url = `${BINANCE_BASE}/api/v3/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Binance ${res.status}: ${await res.text()}`);
  }
  const raw = (await res.json()) as BinanceKlineRaw[];
  const now = Date.now();
  // Drop the in-progress candle (its closeTime is still in the future).
  return raw.map(parseKline).filter((k) => k.closeTime < now);
}

interface Alert {
  symbol: string;
  interval: string;
  strategyId: StrategyId;
  strategyName: string;
  signal: "BUY" | "SELL";
  price: string;
  candleCloseTime: number;
}

async function sendDiscord(webhookUrl: string, alerts: Alert[]): Promise<void> {
  // Discord allows up to 10 embeds per webhook message.
  for (let i = 0; i < alerts.length; i += 10) {
    const batch = alerts.slice(i, i + 10);
    const embeds = batch.map((a) => ({
      title: `${a.signal === "BUY" ? "🟢 BUY" : "🔴 SELL"} — ${a.symbol} (${a.interval})`,
      description: `กลยุทธ์: **${a.strategyName}**\nราคาปิด: \`${a.price}\``,
      color: a.signal === "BUY" ? 0x22c55e : 0xef4444,
      timestamp: new Date(a.candleCloseTime).toISOString(),
      footer: { text: `แท่งปิด ${new Date(a.candleCloseTime).toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}` },
    }));

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Crypto Signal Bot", embeds }),
    });
    if (!res.ok) {
      throw new Error(`Discord ${res.status}: ${await res.text()}`);
    }
  }
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL || "";
  if (!/^https:\/\/(discord|discordapp)\.com\/api\/webhooks\//.test(webhookUrl)) {
    return NextResponse.json({ error: "DISCORD_WEBHOOK_URL not set or invalid" }, { status: 500 });
  }

  const symbols = (process.env.SCAN_SYMBOLS || "BTCUSDT")
    .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const interval = (process.env.SCAN_INTERVAL || "1h").trim();
  const strategies = (process.env.SCAN_STRATEGIES || "supertrend")
    .split(",").map((s) => s.trim()).filter(Boolean)
    .filter((id): id is StrategyId => VALID_STRATEGY_IDS.has(id as StrategyId));
  const limit = Math.min(Math.max(parseInt(process.env.SCAN_LIMIT || "500", 10) || 500, 100), 1000);

  if (strategies.length === 0) {
    return NextResponse.json({ error: "SCAN_STRATEGIES has no valid strategy id" }, { status: 400 });
  }

  // Freshness window: only alert on a candle that closed recently. Defaults to one
  // candle duration (so two scans within the same candle don't double-fire), capped
  // by SIGNAL_FRESHNESS_MIN if provided.
  const intervalMs = INTERVAL_MS[interval] ?? 3_600_000;
  const freshnessMs = process.env.SIGNAL_FRESHNESS_MIN
    ? Math.min(parseInt(process.env.SIGNAL_FRESHNESS_MIN, 10) * 60_000, intervalMs)
    : intervalMs;

  const now = Date.now();
  const alerts: Alert[] = [];
  const errors: string[] = [];

  for (const symbol of symbols) {
    let klines: KlineData[];
    try {
      klines = await fetchClosedKlines(symbol, interval, limit);
    } catch (err) {
      errors.push(`${symbol}: ${String(err)}`);
      continue;
    }
    if (klines.length < 2) {
      errors.push(`${symbol}: not enough closed candles`);
      continue;
    }

    const lastClosed = klines[klines.length - 1];
    const fresh = now - lastClosed.closeTime <= freshnessMs;
    if (!fresh) continue; // candle closed too long ago → likely already alerted

    for (const strategyId of strategies) {
      try {
        const { signals } = runBacktest(klines, strategyId, defaultParamsFor(strategyId));
        const sig: SignalAction = signals[signals.length - 1];
        if (sig === "BUY" || sig === "SELL") {
          alerts.push({
            symbol,
            interval,
            strategyId,
            strategyName: STRATEGIES.find((s) => s.id === strategyId)?.name ?? strategyId,
            signal: sig,
            price: lastClosed.close,
            candleCloseTime: lastClosed.closeTime,
          });
        }
      } catch (err) {
        errors.push(`${symbol}/${strategyId}: ${String(err)}`);
      }
    }
  }

  if (alerts.length > 0) {
    try {
      await sendDiscord(webhookUrl, alerts);
    } catch (err) {
      return NextResponse.json(
        { ok: false, sent: 0, alerts, errors: [...errors, `discord: ${String(err)}`] },
        { status: 502 }
      );
    }
  }

  return NextResponse.json({
    ok: true,
    scanned: { symbols, interval, strategies, limit },
    sent: alerts.length,
    alerts,
    errors,
  });
}
