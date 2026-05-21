"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type KlineData,
  type BinanceKlineRaw,
  parseKline,
} from "@/lib/types/kline";
import { runBacktest, STRATEGIES, type StrategyId } from "@/lib/backtest";
import {
  addGoldTrade,
  getGoldTradesByWatcher,
  deleteGoldTrade,
  deleteGoldAllByWatcher,
  type GoldTradeRecord,
} from "@/lib/goldTradeHistoryDB";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import {
  GOLD_SYMBOLS,
  findGoldSymbol,
  GOLD_LIVE_INTERVAL_GROUPS,
  GOLD_POLL_OPTIONS,
  YAHOO_INTERVAL_LIMITS_HINT,
  type GoldLiveInterval,
} from "./constants";

export interface GoldWatcherConfig {
  id: string;
  symbol: string;          // label, e.g. "XAU/USD"
  interval: GoldLiveInterval;
  strategyId: StrategyId;
  strategyParams: Record<string, number>;
  pollSeconds: number;
  webhookUrl: string;
  useEnvWebhook: boolean;
  alertsEnabled: boolean;
  klineLimit: number;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function fmtPrice(val: number, decimals: number): string {
  return val.toFixed(decimals);
}
function fmtFullDate(ts: number): string {
  return new Date(ts).toLocaleString("en-US", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

// Merge new klines into existing, dedupe by openTime, sort, keep last N
function mergeKlines(prev: KlineData[], fresh: KlineData[]): KlineData[] {
  const map = new Map<number, KlineData>();
  for (const k of prev) map.set(k.openTime, k);
  for (const k of fresh) map.set(k.openTime, k);
  return Array.from(map.values()).sort((a, b) => a.openTime - b.openTime).slice(-500);
}

const TRADE_HISTORY_PAGE_SIZE = 10;

export default function GoldWatcherRow({
  config,
  onUpdate: onUpdateProp,
  onRemove: onRemoveProp,
  onPollingChange: onPollingChangeProp,
}: {
  config: GoldWatcherConfig;
  onUpdate: (id: string, patch: Partial<GoldWatcherConfig>) => void;
  onRemove: (id: string) => void;
  onPollingChange: (id: string, polling: boolean) => void;
}) {
  const id = config.id;
  const onUpdate = (patch: Partial<GoldWatcherConfig>) => onUpdateProp(id, patch);
  const onRemove = () => onRemoveProp(id);
  const onPollingChange = (polling: boolean) => onPollingChangeProp(id, polling);

  const [klines, setKlines] = useState<KlineData[]>([]);
  const [polling, setPolling] = useState(false);
  const [lastPolledAt, setLastPolledAt] = useState<Date | null>(null);
  const [tickSeconds, setTickSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [lastSignal, setLastSignal] = useState<"BUY" | "SELL" | null>(null);
  const [tradeHistory, setTradeHistory] = useState<GoldTradeRecord[]>([]);
  const [tradeHistoryReloadKey, setTradeHistoryReloadKey] = useState(0);
  const [tradeHistoryPage, setTradeHistoryPage] = useState(0);
  const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);

  const lastAlertBarRef = useRef<number>(0);
  const lastBuyRef = useRef<{ price: number; time: number } | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cfgRef = useRef(config);

  useEffect(() => { cfgRef.current = config; }, [config]);
  useEffect(() => { onPollingChange(polling); }, [polling, onPollingChange]);

  const symMeta = findGoldSymbol(config.symbol);
  const decimals = symMeta?.decimals ?? 2;

  // Load trade history
  useEffect(() => {
    let cancelled = false;
    getGoldTradesByWatcher(config.id)
      .then(records => { if (!cancelled) setTradeHistory(records); })
      .catch(() => { /* ignore */ });
    return () => { cancelled = true; };
  }, [config.id, tradeHistoryReloadKey]);

  // Send Discord
  const send = useCallback(async (payload: { content?: string; embeds?: unknown[]; username?: string; }): Promise<{ ok: boolean; message?: string }> => {
    const c = cfgRef.current;
    try {
      const res = await fetch("/api/discord/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          webhookUrl: c.useEnvWebhook ? undefined : c.webhookUrl,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return { ok: false, message: data.error || `HTTP ${res.status}` };
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, message: String(err) };
    }
  }, []);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestMsg(null);
    const result = await send({
      username: "Gold Bot Test",
      content: `🔔 ทดสอบ Webhook สำหรับ ${config.symbol} (${config.interval})`,
    });
    setTestMsg(result.ok ? "✓ ส่งทดสอบสำเร็จ" : `✗ ${result.message}`);
    setTesting(false);
    setTimeout(() => setTestMsg(null), 4000);
  }, [send, config.symbol, config.interval]);

  const sendSignal = useCallback(async (action: "BUY" | "SELL", bar: KlineData, strategyName: string, sym: string, intv: string) => {
    const price = +bar.close;
    const isBuy = action === "BUY";
    const emoji = isBuy ? "🟢" : "🔴";
    const prevBuy = !isBuy ? lastBuyRef.current : null;
    const entryPrice = prevBuy?.price;
    const entryTime = prevBuy?.time;
    const pnlPct = entryPrice != null ? ((price - entryPrice) / entryPrice) * 100 : undefined;

    let color: number;
    if (isBuy) color = 0x10b981;
    else if (pnlPct != null && pnlPct >= 0) color = 0xf59e0b;
    else color = 0xef4444;

    const fields: { name: string; value: string; inline?: boolean }[] = [
      { name: "ราคา", value: fmtPrice(price, decimals), inline: false },
    ];

    if (!isBuy) {
      const pnlStr = pnlPct != null ? `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%` : "-";
      const pnlEmoji = pnlPct == null ? "⚪" : pnlPct >= 0 ? "🟢" : "🔴";
      fields.push(
        { name: "─── อ้างอิงราคา BUY ก่อนหน้า ───", value: "​", inline: false },
        { name: "🟢 ราคา BUY", value: entryPrice != null ? fmtPrice(entryPrice, decimals) : "-", inline: true },
        { name: "🕒 เวลา BUY", value: entryTime != null ? fmtFullDate(entryTime) : "-", inline: true },
        { name: `${pnlEmoji} กำไร/ขาดทุน`, value: pnlStr, inline: true },
      );
    }

    const result = await send({
      username: "Gold Signal Bot",
      embeds: [{
        title: `${emoji} ${action} Signal — ${sym}`,
        description: `**กลยุทธ์:** ${strategyName}\n**Timeframe:** ${intv}`,
        color,
        fields,
        timestamp: new Date().toISOString(),
      }],
    });

    if (isBuy) lastBuyRef.current = { price, time: bar.openTime };
    else lastBuyRef.current = null;
    setLastSignal(action);

    const tradeId = `${cfgRef.current.id}-${bar.openTime}-${action}`;
    const tradeRecord: GoldTradeRecord = {
      id: tradeId,
      watcherId: cfgRef.current.id,
      time: Date.now(),
      symbol: sym,
      interval: intv,
      strategyName,
      action,
      price,
      barOpenTime: bar.openTime,
      entryPrice,
      entryTime,
      pnlPct,
      status: result.ok ? "ok" : "error",
      message: result.message,
    };

    addGoldTrade(tradeRecord)
      .then(() => setTradeHistoryReloadKey(k => k + 1))
      .catch(() => { /* ignore */ });
  }, [send, decimals]);

  // Poll tick
  const pollTick = useCallback(async () => {
    const c = cfgRef.current;
    const meta = findGoldSymbol(c.symbol);
    if (!meta?.yahoo) {
      setError(`Symbol ${c.symbol} ไม่มี Yahoo Finance ticker — backtest-only`);
      return;
    }
    try {
      const params = new URLSearchParams({
        symbol: meta.yahoo,
        interval: c.interval,
        limit: String(c.klineLimit),
      });
      const res = await fetch(`/api/klines-yahoo?${params}`);
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      const raw: BinanceKlineRaw[] = await res.json();
      const fresh = raw.map(parseKline);
      setKlines(prev => mergeKlines(prev, fresh));
      setLastPolledAt(new Date());
      setError(null);

      if (c.alertsEnabled && fresh.length >= 50) {
        const result = runBacktest(fresh, c.strategyId, c.strategyParams, 0.1);
        const checkIdx = fresh.length - 2;
        if (checkIdx >= 0) {
          const sig = result.signals[checkIdx];
          const bar = fresh[checkIdx];
          if ((sig === "BUY" || sig === "SELL") && bar.openTime > lastAlertBarRef.current) {
            lastAlertBarRef.current = bar.openTime;
            const strat = STRATEGIES.find(s => s.id === c.strategyId);
            sendSignal(sig, bar, strat?.name ?? c.strategyId, c.symbol, c.interval);
          }
        }
      }
    } catch (err) {
      setError(`Polling error: ${String(err)}`);
    }
  }, [sendSignal]);

  // Polling loop
  useEffect(() => {
    if (!polling) {
      if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null; }
      return;
    }
    let cancelled = false;
    const runLoop = async () => {
      await pollTick();
      if (cancelled) return;
      const delay = Math.max(30, cfgRef.current.pollSeconds) * 1000;
      pollTimerRef.current = setTimeout(runLoop, delay);
    };
    runLoop();
    return () => {
      cancelled = true;
      if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null; }
    };
  }, [polling, pollTick]);

  // Tick counter
  useEffect(() => {
    if (!polling) { setTickSeconds(0); return; }
    setTickSeconds(0);
    const id = window.setInterval(() => setTickSeconds(s => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [polling, lastPolledAt]);

  const togglePolling = () => {
    if (polling) { setPolling(false); return; }
    if (!config.useEnvWebhook && !config.webhookUrl.trim() && config.alertsEnabled) {
      setError("กรุณาตั้ง Webhook URL ก่อน หรือเปิดใช้ env webhook หรือปิด alerts");
      return;
    }
    lastBuyRef.current = null;
    setPolling(true);
  };

  const remaining = Math.max(0, config.pollSeconds - tickSeconds);
  const progressPct = Math.min(100, (tickSeconds / Math.max(1, config.pollSeconds)) * 100);
  const lastClose = klines.length > 0 ? +klines[klines.length - 1].close : null;

  return (
    <div className={`rounded-md border ${polling ? "border-emerald-500/40 bg-emerald-500/5" : "border-border/50 bg-muted/10"} overflow-hidden`}>
      {/* Compact row */}
      <div className="flex flex-wrap items-center gap-3 p-3">
        <div className="flex flex-col min-w-[140px]">
          <span className="font-semibold text-sm">{config.symbol}</span>
          <span className="text-[12px] text-muted-foreground">TF: {config.interval}</span>
        </div>

        <div className="flex flex-col min-w-[120px]">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">กลยุทธ์</span>
          <span className="text-[12px] font-medium">{STRATEGIES.find(s => s.id === config.strategyId)?.name ?? config.strategyId}</span>
        </div>

        <div className="flex flex-col min-w-[80px]">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Polling</span>
          <span className="text-[12px] font-medium tabular-nums">
            {config.pollSeconds < 60 ? `${config.pollSeconds}s` : `${(config.pollSeconds / 60).toFixed(0)}m`}
          </span>
        </div>

        <div className="flex flex-col min-w-[100px]">
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">ราคาล่าสุด</span>
          <span className="text-[12px] font-medium tabular-nums">
            {lastClose != null ? fmtPrice(lastClose, decimals) : "—"}
          </span>
        </div>

        {lastSignal && (
          <Badge variant="outline" className={`text-[10px] ${lastSignal === "BUY" ? "text-emerald-500 border-emerald-500/30" : "text-red-500 border-red-500/30"}`}>
            ล่าสุด: {lastSignal}
          </Badge>
        )}

        <div className="flex flex-col min-w-[120px]">
          {polling ? (
            <>
              <span className="text-[12px] text-emerald-500 animate-pulse">● LIVE</span>
              <span className="text-[11px] tabular-nums text-muted-foreground">
                {tickSeconds}s / {config.pollSeconds}s ({remaining}s)
              </span>
              <div className="h-1 w-full rounded-full bg-muted overflow-hidden mt-0.5">
                <div className="h-full bg-emerald-500 transition-all duration-1000 ease-linear" style={{ width: `${progressPct}%` }} />
              </div>
            </>
          ) : (
            <span className="text-[12px] text-muted-foreground">○ ปิดอยู่</span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <Button
            size="sm"
            className={polling ? "bg-red-500 hover:bg-red-600 text-white" : "bg-emerald-500 hover:bg-emerald-600 text-white"}
            onClick={togglePolling}
          >
            {polling ? "■ หยุด" : "▶ เริ่ม"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setExpanded(v => !v)}>
            {expanded ? "▲ ย่อ" : "▼ แก้ไข"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-red-500 border-red-500/30 hover:bg-red-500/10"
            onClick={() => setShowRemoveConfirm(true)}
          >
            ✕
          </Button>
        </div>
      </div>

      {error && (
        <div className="px-3 pb-2">
          <p className="text-[12px] text-red-500">{error}</p>
        </div>
      )}

      {/* Expanded edit panel */}
      {expanded && (
        <div className="border-t border-border/40 bg-background/40 p-3 space-y-3">
          {/* Step 1: Symbol + TF + Poll */}
          <details className="group">
            <summary className="flex items-center gap-1 cursor-pointer list-none text-[12px] font-semibold text-sky-400 hover:text-sky-300 select-none">
              <span className="inline-block transition-transform group-open:rotate-90">▶</span>
              <span>ขั้นตอนที่ 1 · เลือกคู่ + Timeframe + Polling</span>
              <span className="text-[10px] font-normal text-muted-foreground">(คลิกดูคำอธิบาย)</span>
            </summary>
            <div className="mt-2 rounded-md border border-sky-500/20 bg-sky-500/5 p-3">
              <ul className="text-[10px] text-muted-foreground space-y-0.5 list-disc pl-4">
                <li><span className="text-foreground/80">คู่</span> — Metals (XAU/XAG/...) หรือ Forex Majors (EUR/USD, ...)</li>
                <li><span className="text-foreground/80">Timeframe</span> — Yahoo รองรับ 1m, 5m, 15m, 30m, 1h, 1d (มีข้อจำกัดย้อนหลัง — ดู badge ใต้ select)</li>
                <li><span className="text-foreground/80">Polling</span> — แนะนำ ≥ 60s เพื่อไม่กิน rate limit</li>
              </ul>
            </div>
          </details>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label="คู่ (Symbol)">
              <Select value={config.symbol} onValueChange={v => { if (v) onUpdate({ symbol: v }); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Metals</SelectLabel>
                    {GOLD_SYMBOLS.filter(s => s.group === "Metals").map(s => (
                      <SelectItem key={s.label} value={s.label}>{s.label}</SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel>Forex Majors</SelectLabel>
                    {GOLD_SYMBOLS.filter(s => s.group === "Forex Majors").map(s => (
                      <SelectItem key={s.label} value={s.label}>{s.label}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Timeframe">
              <Select value={config.interval} onValueChange={v => { if (v) onUpdate({ interval: v as GoldLiveInterval }); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(GOLD_LIVE_INTERVAL_GROUPS).map(([g, ints]) => (
                    <SelectGroup key={g}><SelectLabel>{g}</SelectLabel>
                      {ints.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[9px] text-muted-foreground mt-0.5">{YAHOO_INTERVAL_LIMITS_HINT[config.interval]}</p>
            </Field>
            <Field label="Polling ทุก">
              <Select value={String(config.pollSeconds)} onValueChange={v => { if (v) onUpdate({ pollSeconds: parseInt(v, 10) || 60 }); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GOLD_POLL_OPTIONS.map(o => <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {/* Step 2: Strategy */}
          <details className="group">
            <summary className="flex items-center gap-1 cursor-pointer list-none text-[12px] font-semibold text-violet-400 hover:text-violet-300 select-none">
              <span className="inline-block transition-transform group-open:rotate-90">▶</span>
              <span>ขั้นตอนที่ 2 · เลือกกลยุทธ์</span>
              <span className="text-[10px] font-normal text-muted-foreground">(คลิกดูคำอธิบาย)</span>
            </summary>
            <div className="mt-2 rounded-md border border-violet-500/20 bg-violet-500/5 p-3">
              <ul className="text-[10px] text-muted-foreground space-y-0.5 list-disc pl-4">
                <li>เลือก Indicator ที่จะใช้คำนวณสัญญาณ BUY/SELL</li>
                <li>ลอง Backtest tab ก่อนเปิด live เพื่อดูว่ากลยุทธ์เหมาะกับคู่+TF ที่เลือก</li>
              </ul>
            </div>
          </details>
          <Field label="กลยุทธ์ (Indicator)">
            <Select
              value={config.strategyId}
              onValueChange={v => {
                if (!v) return;
                const next = v as StrategyId;
                const strat = STRATEGIES.find(s => s.id === next);
                if (!strat) return;
                onUpdate({ strategyId: next, strategyParams: { ...strat.params } });
              }}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>เลือก Indicator</SelectLabel>
                  {STRATEGIES.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          {/* Step 3: Webhook */}
          <details className="group">
            <summary className="flex items-center gap-1 cursor-pointer list-none text-[12px] font-semibold text-pink-400 hover:text-pink-300 select-none">
              <span className="inline-block transition-transform group-open:rotate-90">▶</span>
              <span>ขั้นตอนที่ 3 · ตั้งค่า Discord Webhook</span>
              <span className="text-[10px] font-normal text-muted-foreground">(คลิกดูคำอธิบาย)</span>
            </summary>
            <div className="mt-2 rounded-md border border-pink-500/20 bg-pink-500/5 p-3">
              <ul className="text-[10px] text-muted-foreground space-y-0.5 list-disc pl-4">
                <li>URL ขึ้นต้นด้วย <code>https://discord.com/api/webhooks/...</code></li>
                <li>ใน Discord: Server Settings → Integrations → Webhooks → New Webhook → Copy URL</li>
                <li>กดปุ่ม &quot;ใช้ env&quot; เพื่อใช้ DISCORD_WEBHOOK_URL จาก .env แทน</li>
              </ul>
            </div>
          </details>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 items-end">
            <Field label="Discord Webhook URL">
              <Input
                type="password"
                placeholder="https://discord.com/api/webhooks/..."
                value={config.webhookUrl}
                onChange={e => onUpdate({ webhookUrl: e.target.value })}
                disabled={config.useEnvWebhook}
                autoComplete="off"
              />
            </Field>
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={testing || (!config.useEnvWebhook && !config.webhookUrl.trim())}
            >
              {testing ? "ทดสอบ..." : "ทดสอบ"}
            </Button>
            <Button
              variant={config.useEnvWebhook ? "default" : "outline"}
              size="sm"
              onClick={() => onUpdate({ useEnvWebhook: !config.useEnvWebhook })}
            >
              {config.useEnvWebhook ? "● ใช้ env" : "○ ใช้ URL"}
            </Button>
          </div>
          {testMsg && (
            <p className={`text-[11px] ${testMsg.startsWith("✓") ? "text-emerald-500" : "text-red-500"}`}>
              {testMsg}
            </p>
          )}

          {/* Toggle alerts */}
          <Field label="แจ้งเตือน Discord">
            <Button
              variant={config.alertsEnabled ? "default" : "outline"}
              size="sm"
              className={config.alertsEnabled ? "bg-emerald-500/90 text-white" : ""}
              onClick={() => onUpdate({ alertsEnabled: !config.alertsEnabled })}
            >
              {config.alertsEnabled ? "● เปิด" : "○ ปิด"}
            </Button>
          </Field>

          {lastPolledAt && (
            <p className="text-[10px] text-muted-foreground">
              อัพเดทล่าสุด: {lastPolledAt.toLocaleTimeString()} | klines โหลด: {klines.length}
            </p>
          )}

          {/* Trade history */}
          <div className="rounded-md border border-purple-500/20 bg-purple-500/5 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[12px] font-semibold text-purple-400">📜 ประวัติการซื้อขาย (Watcher นี้)</p>
                <p className="text-[10px] text-muted-foreground">
                  เก็บใน IndexedDB (goldDiscordBotDB) • {tradeHistory.length} รายการ
                </p>
              </div>
              <p className="text-[14px] text-muted-foreground">
                P&amp;L รวม: <span className={tradeHistory.reduce((a, t) => a + (t.pnlPct || 0), 0) >= 0 ? "text-emerald-500" : "text-red-500"}>
                  {tradeHistory.reduce((a, t) => a + (t.pnlPct || 0), 0).toFixed(2)}%
                </span>
              </p>
              {tradeHistory.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-500 border-red-500/30 hover:bg-red-500/10"
                  onClick={async () => {
                    if (!confirm(`ลบประวัติทั้งหมดของ ${config.symbol} (${tradeHistory.length} รายการ)?`)) return;
                    await deleteGoldAllByWatcher(config.id).catch(() => {});
                    setTradeHistoryReloadKey(k => k + 1);
                  }}
                >
                  🗑 ลบทั้งหมด
                </Button>
              )}
            </div>

            {tradeHistory.length === 0 ? (
              <p className="text-[11px] text-muted-foreground text-center py-3">
                ยังไม่มีประวัติ — จะเริ่มบันทึกเมื่อ Watcher นี้ส่งสัญญาณ BUY/SELL
              </p>
            ) : (() => {
              const totalPages = Math.max(1, Math.ceil(tradeHistory.length / TRADE_HISTORY_PAGE_SIZE));
              const currentPage = Math.min(tradeHistoryPage, totalPages - 1);
              const startIdx = currentPage * TRADE_HISTORY_PAGE_SIZE;
              const pageItems = tradeHistory.slice(startIdx, startIdx + TRADE_HISTORY_PAGE_SIZE);
              return (
                <div className="space-y-2">
                  <div className="overflow-x-auto rounded border border-border/40">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-[10px]">เวลา</TableHead>
                          <TableHead className="text-[10px]">สัญญาณ</TableHead>
                          <TableHead className="text-[10px]">กลยุทธ์</TableHead>
                          <TableHead className="text-[10px] text-center">TF</TableHead>
                          <TableHead className="text-[10px] text-right">ราคา</TableHead>
                          <TableHead className="text-[10px] text-right">ราคา BUY ก่อน</TableHead>
                          <TableHead className="text-[10px] text-right">P&amp;L%</TableHead>
                          <TableHead className="text-[10px]">สถานะ</TableHead>
                          <TableHead className="text-[10px] w-8"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pageItems.map(t => (
                          <TableRow key={t.id} className={t.action === "BUY" ? "bg-emerald-500/4" : "bg-red-500/4"}>
                            <TableCell className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                              {new Date(t.time).toLocaleString()}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              <Badge variant="outline" className={`text-[9px] ${t.action === "BUY" ? "text-emerald-500 border-emerald-500/30" : "text-red-500 border-red-500/30"}`}>
                                {t.action} — {t.symbol}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-[10px] whitespace-nowrap">{t.strategyName}</TableCell>
                            <TableCell className="text-[10px] text-center font-medium">{t.interval}</TableCell>
                            <TableCell className="text-[10px] text-right tabular-nums">{fmtPrice(t.price, decimals)}</TableCell>
                            <TableCell className="text-[10px] text-right tabular-nums">
                              {t.action === "SELL"
                                ? (t.entryPrice != null ? <span className="text-emerald-500/80">{fmtPrice(t.entryPrice, decimals)}</span> : <span className="text-muted-foreground">-</span>)
                                : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-[10px] text-right tabular-nums">
                              {t.action === "SELL"
                                ? (t.pnlPct != null
                                  ? <span className={`font-medium ${t.pnlPct >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                                    {t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(2)}%
                                  </span>
                                  : <span className="text-muted-foreground">-</span>)
                                : <span className="text-muted-foreground">—</span>}
                            </TableCell>
                            <TableCell className="text-[10px]">
                              {t.status === "ok"
                                ? <span className="text-emerald-500">✓</span>
                                : <span className="text-red-500" title={t.message}>✗</span>}
                            </TableCell>
                            <TableCell>
                              <Button
                                size="xs"
                                variant="outline"
                                className="h-5 w-5 p-0 text-red-500 border-red-500/30 hover:bg-red-500/10"
                                title="ลบรายการนี้"
                                onClick={async () => {
                                  await deleteGoldTrade(t.id).catch(() => {});
                                  setTradeHistoryReloadKey(k => k + 1);
                                }}
                              >
                                ✕
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="text-muted-foreground">
                        แสดง {startIdx + 1}-{Math.min(startIdx + TRADE_HISTORY_PAGE_SIZE, tradeHistory.length)} จาก {tradeHistory.length}
                      </span>
                      <div className="flex items-center gap-1">
                        <Button size="xs" variant="outline" disabled={currentPage === 0} onClick={() => setTradeHistoryPage(0)} className="h-6 px-2">« แรก</Button>
                        <Button size="xs" variant="outline" disabled={currentPage === 0} onClick={() => setTradeHistoryPage(p => Math.max(0, p - 1))} className="h-6 px-2">‹ ก่อน</Button>
                        <span className="px-2 tabular-nums text-muted-foreground">หน้า {currentPage + 1} / {totalPages}</span>
                        <Button size="xs" variant="outline" disabled={currentPage >= totalPages - 1} onClick={() => setTradeHistoryPage(p => Math.min(totalPages - 1, p + 1))} className="h-6 px-2">ถัดไป ›</Button>
                        <Button size="xs" variant="outline" disabled={currentPage >= totalPages - 1} onClick={() => setTradeHistoryPage(totalPages - 1)} className="h-6 px-2">ท้ายสุด »</Button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Confirm remove modal */}
      {showRemoveConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowRemoveConfirm(false)}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-red-500/30 bg-background shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">⚠️</span>
                <h3 className="text-sm font-semibold">ยืนยันการลบ Watcher</h3>
              </div>
              <p className="text-[13px] text-muted-foreground">
                คุณต้องการลบ Watcher <span className="font-semibold text-foreground">{config.symbol}</span> (TF: {config.interval}) ใช่หรือไม่?
              </p>
              <p className="text-[11px] text-amber-500">
                การลบนี้จะหยุด polling และนำ Watcher ออกจากรายการ (ประวัติเทรดใน IndexedDB จะยังอยู่)
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => setShowRemoveConfirm(false)}>ยกเลิก</Button>
                <Button
                  size="sm"
                  className="bg-red-500 hover:bg-red-600 text-white"
                  onClick={() => { setShowRemoveConfirm(false); onRemove(); }}
                >
                  ✕ ลบ Watcher
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
