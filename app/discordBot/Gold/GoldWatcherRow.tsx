"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  type KlineData,
  type BinanceKlineRaw,
  parseKline,
} from "@/lib/types/kline";
import {
  runBacktest,
  STRATEGIES,
  type StrategyId,
  type BacktestResult,
  type Trade,
} from "@/lib/backtest";
import { computeAll, type AllIndicators } from "@/lib/indicators";
import {
  addGoldTrade,
  getGoldTradesByWatcher,
  deleteGoldTrade,
  deleteGoldAllByWatcher,
  type GoldTradeRecord,
} from "@/lib/goldTradeHistoryDB";

// Lazy-load chart (~600KB) — only fetched when user opens the chart panel
const KlineGraph = dynamic(() => import("@/app/klines/ui/graph"), {
  ssr: false,
  loading: () => (
    <div className="h-64 flex items-center justify-center text-xs text-muted-foreground border border-dashed rounded">
      กำลังโหลดกราฟ...
    </div>
  ),
});
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import {
  GOLD_SYMBOLS,
  findGoldSymbol,
  GOLD_LIVE_INTERVAL_GROUPS,
  YAHOO_INTERVAL_LIMITS_HINT,
  pollOptionsForInterval,
  defaultPollSecondsForInterval,
  MIN_BARS_FOR_POLLING,
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
  return Array.from(map.values()).sort((a, b) => a.openTime - b.openTime).slice(-5000);
}

// Yahoo Finance practical per-interval max bars (free, no key).
// Yahoo enforces interval-specific lookback windows: 1m → 7 days, 5m–30m → 60 days,
// 1h → 730 days, 1d → unlimited. These caps stay within those limits.
const YAHOO_MAX_LIMIT: Record<GoldLiveInterval, number> = {
  "1m":  5000,
  "5m":  5000,
  "15m": 3000,
  "30m": 2000,
  "1h":  5000,
  "1d":  5000,
};

// Convert persisted trade history → synthetic BacktestResult so KlineGraph
// can draw BUY/SELL markers from real Discord-sent trades (not from a backtest).
// Only `trades`, `totalPnlPct`, and `totalTrades` are read by KlineGraph.
function tradeHistoryToBacktestResult(
  history: GoldTradeRecord[],
  klines: KlineData[],
): BacktestResult | null {
  if (history.length === 0 || klines.length === 0) return null;

  const indexByOpenTime = new Map<number, number>();
  klines.forEach((k, i) => indexByOpenTime.set(k.openTime, i));

  const sorted = [...history].sort((a, b) => a.time - b.time);
  const trades: Trade[] = [];
  let openBuy: GoldTradeRecord | null = null;

  for (const rec of sorted) {
    if (rec.action === "BUY") {
      if (openBuy) {
        const entryIdx = indexByOpenTime.get(openBuy.barOpenTime);
        if (entryIdx != null) {
          trades.push({
            entryIdx,
            entryTime: openBuy.barOpenTime,
            entryPrice: openBuy.price,
            exitIdx: -1,
            exitTime: 0,
            exitPrice: 0,
            pnl: 0,
            pnlPct: 0,
            bars: 0,
            reason: "Open position (no SELL yet)",
          });
        }
      }
      openBuy = rec;
    } else if (rec.action === "SELL" && openBuy) {
      const entryIdx = indexByOpenTime.get(openBuy.barOpenTime);
      const exitIdx = indexByOpenTime.get(rec.barOpenTime);
      const pnlPct = rec.pnlPct ?? ((rec.price - openBuy.price) / openBuy.price) * 100;
      if (exitIdx != null) {
        trades.push({
          entryIdx: entryIdx ?? -1,
          entryTime: openBuy.barOpenTime,
          entryPrice: openBuy.price,
          exitIdx,
          exitTime: rec.barOpenTime,
          exitPrice: rec.price,
          pnl: rec.price - openBuy.price,
          pnlPct,
          bars: entryIdx != null ? exitIdx - entryIdx : 0,
          reason: rec.strategyName,
        });
      }
      openBuy = null;
    }
  }

  if (openBuy) {
    const entryIdx = indexByOpenTime.get(openBuy.barOpenTime);
    if (entryIdx != null) {
      trades.push({
        entryIdx,
        entryTime: openBuy.barOpenTime,
        entryPrice: openBuy.price,
        exitIdx: -1,
        exitTime: 0,
        exitPrice: 0,
        pnl: 0,
        pnlPct: 0,
        bars: 0,
        reason: "Open position (no SELL yet)",
      });
    }
  }

  const closed = trades.filter(t => t.exitIdx >= 0);
  const totalPnlPct = closed.reduce((s, t) => s + t.pnlPct, 0);

  return {
    trades,
    totalPnlPct,
    winRate: 0,
    wins: 0,
    losses: 0,
    totalTrades: closed.length,
    maxDrawdownPct: 0,
    sharpeRatio: 0,
    profitFactor: 0,
    avgWinPct: 0,
    avgLossPct: 0,
    avgBarsHeld: 0,
    bestTradePct: 0,
    worstTradePct: 0,
    equityCurve: [],
    signals: [],
    buyAndHoldPct: 0,
  };
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
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Chart panel state
  const [showLiveChart, setShowLiveChart] = useState(false);
  const [histLimit, setHistLimit] = useState<number>(500);
  const [histEnd, setHistEnd] = useState<string>("");
  const [histLoading, setHistLoading] = useState(false);
  const [histError, setHistError] = useState<string | null>(null);

  // Initial-data loader (must run before polling can start, so the strategy has
  // enough bars to compute the first signal).
  const [loadingInitial, setLoadingInitial] = useState(false);

  const lastAlertBarRef = useRef<number>(0);
  const lastBuyRef = useRef<{ price: number; time: number } | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cfgRef = useRef(config);

  useEffect(() => { cfgRef.current = config; }, [config]);
  useEffect(() => { onPollingChange(polling); }, [polling, onPollingChange]);

  // One-time auto-snap: if a saved watcher has pollSeconds that doesn't match
  // the new TF-aware options (e.g., interval=1h with pollSeconds=300 from old data),
  // snap to the default for that TF. Runs once per (id + interval) combo.
  const didSnapPollRef = useRef<string>("");
  useEffect(() => {
    const key = `${config.id}:${config.interval}`;
    if (didSnapPollRef.current === key) return;
    didSnapPollRef.current = key;
    const validValues = pollOptionsForInterval(config.interval).map(o => o.value);
    if (!validValues.includes(config.pollSeconds)) {
      onUpdateProp(config.id, { pollSeconds: defaultPollSecondsForInterval(config.interval) });
    }
  }, [config.id, config.interval, config.pollSeconds, onUpdateProp]);

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

  // Indicators for the chart — only compute when chart is visible (saves CPU)
  const liveIndicators = useMemo<AllIndicators | null>(
    () => showLiveChart && klines.length >= 15 ? computeAll(klines) : null,
    [showLiveChart, klines]
  );

  // Convert trade history → BUY/SELL markers for the chart
  const liveTradeMarkers = useMemo<BacktestResult | null>(
    () => showLiveChart ? tradeHistoryToBacktestResult(tradeHistory, klines) : null,
    [showLiveChart, tradeHistory, klines]
  );

  // Backfill historical klines into the chart (calls /api/klines-yahoo with limit + endTime)
  const maxLimit = YAHOO_MAX_LIMIT[config.interval];
  const handleBackfill = useCallback(async () => {
    const meta = findGoldSymbol(config.symbol);
    if (!meta?.yahoo) {
      setHistError(`${config.symbol} ไม่มี Yahoo ticker — backtest-only`);
      return;
    }
    const clamped = Math.max(50, Math.min(maxLimit, histLimit || 500));
    setHistLoading(true);
    setHistError(null);
    try {
      const params = new URLSearchParams({
        symbol: meta.yahoo,
        interval: config.interval,
        limit: String(clamped),
      });
      if (histEnd) {
        const endMs = new Date(histEnd).getTime();
        if (isNaN(endMs)) throw new Error("วันที่สิ้นสุดไม่ถูกต้อง");
        params.set("endTime", String(endMs));
      }
      const res = await fetch(`/api/klines-yahoo?${params}`);
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      const raw: BinanceKlineRaw[] = await res.json();
      const fresh = raw.map(parseKline);
      if (fresh.length === 0) {
        setHistError("ไม่มีข้อมูลในช่วงที่ขอ (อาจอยู่นอกช่วงที่ Yahoo รองรับ)");
        return;
      }
      setKlines(prev => mergeKlines(prev, fresh));
    } catch (err) {
      setHistError(String(err));
    } finally {
      setHistLoading(false);
    }
  }, [config.symbol, config.interval, histLimit, histEnd, maxLimit]);

  // Whether enough bars are loaded for the backtest engine to produce signals.
  const dataLoaded = klines.length >= MIN_BARS_FOR_POLLING;

  // Load initial historical klines so the strategy has enough data to compute signals.
  // Called before user can start polling.
  const handleLoadInitialData = useCallback(async () => {
    const meta = findGoldSymbol(config.symbol);
    if (!meta?.yahoo) {
      setError(`Symbol ${config.symbol} ไม่มี Yahoo ticker — backtest-only`);
      return;
    }
    setLoadingInitial(true);
    setError(null);
    try {
      const limit = Math.max(MIN_BARS_FOR_POLLING, Math.min(maxLimit, config.klineLimit || 200));
      const params = new URLSearchParams({
        symbol: meta.yahoo,
        interval: config.interval,
        limit: String(limit),
      });
      const res = await fetch(`/api/klines-yahoo?${params}`);
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      const raw: BinanceKlineRaw[] = await res.json();
      const fresh = raw.map(parseKline);
      if (fresh.length === 0) {
        setError("Yahoo ไม่มีข้อมูลในช่วงที่ขอ (อาจอยู่นอกช่วงที่รองรับ)");
        return;
      }
      setKlines(prev => mergeKlines(prev, fresh));
      setLastPolledAt(new Date());
    } catch (err) {
      setError(`โหลดข้อมูลเริ่มต้นล้มเหลว: ${String(err)}`);
    } finally {
      setLoadingInitial(false);
    }
  }, [config.symbol, config.interval, config.klineLimit, maxLimit]);

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
    if (!dataLoaded) {
      setError(`กรุณากด "📥 ดึงข้อมูล" ก่อน — ต้องการอย่างน้อย ${MIN_BARS_FOR_POLLING} แท่ง เพื่อให้ Indicator คำนวณได้`);
      return;
    }
    if (!config.useEnvWebhook && !config.webhookUrl.trim() && config.alertsEnabled) {
      setError("กรุณาตั้ง Webhook URL ก่อน หรือเปิดใช้ env webhook หรือปิด alerts");
      return;
    }
    lastBuyRef.current = null;
    setPolling(true);
  };

  // Reset config to defaults + clear chart data (also stops polling).
  const doReset = () => {
    setShowResetConfirm(false);
    setPolling(false);
    const rsi = STRATEGIES.find(s => s.id === "rsi")!;
    const defaultInterval: GoldLiveInterval = "1h";
    onUpdate({
      symbol: GOLD_SYMBOLS[0].label,
      interval: defaultInterval,
      strategyId: "rsi" as StrategyId,
      strategyParams: { ...rsi.params },
      pollSeconds: defaultPollSecondsForInterval(defaultInterval),
      webhookUrl: "",
      useEnvWebhook: false,
      alertsEnabled: true,
      klineLimit: 200,
    });
    setKlines([]);
    setLastPolledAt(null);
    setTickSeconds(0);
    setError(null);
    setLastSignal(null);
    setShowLiveChart(false);
    setHistLimit(500);
    setHistEnd("");
    setHistError(null);
    lastAlertBarRef.current = 0;
    lastBuyRef.current = null;
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
          {/* Step A: must press this before Start to load enough bars for indicators */}
          <Button
            size="sm"
            variant={dataLoaded ? "outline" : "default"}
            disabled={loadingInitial || polling}
            className={
              dataLoaded
                ? "text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/10"
                : "bg-amber-500 hover:bg-amber-600 text-white animate-pulse"
            }
            onClick={handleLoadInitialData}
            title={dataLoaded ? `โหลดแล้ว ${klines.length} แท่ง — กดเพื่อ refresh` : "ต้องโหลดข้อมูลก่อนเริ่ม polling"}
          >
            {loadingInitial ? "⌛ กำลังโหลด..." : dataLoaded ? `✓ ${klines.length} แท่ง` : "📥 ดึงข้อมูล"}
          </Button>
          <Button
            size="sm"
            disabled={!polling && !dataLoaded}
            className={polling ? "bg-red-500 hover:bg-red-600 text-white" : "bg-emerald-500 hover:bg-emerald-600 text-white"}
            onClick={togglePolling}
            title={!polling && !dataLoaded ? "กด 📥 ดึงข้อมูล ก่อน" : ""}
          >
            {polling ? "■ หยุด" : "▶ เริ่ม"}
          </Button>
          <Button
            size="sm"
            variant={showLiveChart ? "default" : "outline"}
            className={showLiveChart ? "bg-blue-500 hover:bg-blue-600 text-white" : "text-blue-500 border-blue-500/30 hover:bg-blue-500/10"}
            onClick={() => setShowLiveChart(v => !v)}
          >
            {showLiveChart ? "▲ ปิดกราฟ" : "📊 ดูกราฟ"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setExpanded(v => !v)}>
            {expanded ? "▲ ย่อ" : "▼ แก้ไข"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="text-red-500 border-red-500/30 hover:bg-red-500/10"
            onClick={() => setShowRemoveConfirm(true)}
            disabled={polling}
            title={polling ? "หยุด polling ก่อนถึงจะลบได้" : "ลบ Watcher"}
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

      {/* Live chart panel — toggled by "📊 ดูกราฟ" */}
      {showLiveChart && (
        <div className="border-t border-border/40 bg-background/40 p-3 space-y-2">
          {/* Backfill toolbar */}
          <div className="rounded-md border border-blue-500/20 bg-blue-500/5 p-2 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-[12px] font-semibold text-blue-400">
                📥 ดึงข้อมูลย้อนหลังเพิ่ม (เพื่อคำนวณ Indicator)
              </p>
              <span className="text-[10px] text-muted-foreground">
                Yahoo {config.interval} • <span className="text-foreground/80">max {maxLimit.toLocaleString()} แท่ง</span> ({YAHOO_INTERVAL_LIMITS_HINT[config.interval]})
              </span>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <Field label="จำนวนแท่ง (50 - max)">
                <Input
                  type="number"
                  min={50}
                  max={maxLimit}
                  step={50}
                  value={histLimit}
                  onChange={e => {
                    const n = parseInt(e.target.value, 10);
                    if (!isNaN(n)) setHistLimit(n);
                  }}
                  className="w-28 h-8 text-[11px]"
                />
              </Field>
              <Field label="วันที่สิ้นสุด (optional)">
                <Input
                  type="datetime-local"
                  value={histEnd}
                  onChange={e => setHistEnd(e.target.value)}
                  className="w-44 h-8 text-[11px]"
                />
              </Field>
              {histLimit > maxLimit && (
                <Badge variant="outline" className="text-[10px] text-amber-500 border-amber-500/40">
                  ⚠ เกิน max — จะถูก clamp เป็น {maxLimit.toLocaleString()}
                </Badge>
              )}
              <Button
                size="sm"
                disabled={histLoading}
                className="bg-blue-500 hover:bg-blue-600 text-white h-8"
                onClick={handleBackfill}
              >
                {histLoading ? "⌛ กำลังดึง..." : "▼ ดึงข้อมูล"}
              </Button>
              {histEnd && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-[11px]"
                  onClick={() => setHistEnd("")}
                  title="ล้างวันที่สิ้นสุด (กลับมาดึงล่าสุด)"
                >
                  ล้างวันที่
                </Button>
              )}
            </div>
            {histError && <p className="text-[10px] text-red-500">{histError}</p>}
            <p className="text-[10px] text-muted-foreground">
              💡 ข้อมูลที่ดึงมาจะรวมกับ klines ที่มีอยู่ (deduplicate ตาม openTime) — มากกว่า = indicator แม่นกว่า แต่ใช้ memory เยอะกว่า
            </p>
          </div>

          {/* Chart */}
          {klines.length === 0 ? (
            <p className="text-[11px] text-muted-foreground text-center py-6 border border-dashed rounded">
              ยังไม่มีข้อมูล — กด ▶ เริ่ม เพื่อ poll หรือกด &quot;▼ ดึงข้อมูล&quot; ด้านบนเพื่อ backfill
            </p>
          ) : (
            <>
              <p className="text-[10px] text-muted-foreground">
                📍 Markers: ประวัติการซื้อขายของ Watcher นี้ ({tradeHistory.length} รายการใน history) — เฉพาะ trade ที่ตรงกับช่วง klines ที่โหลด
              </p>
              <KlineGraph
                klines={klines}
                indicators={liveIndicators}
                btResult={liveTradeMarkers}
                strategyId={config.strategyId}
              />
            </>
          )}
        </div>
      )}

      {/* Expanded edit panel */}
      {expanded && (
        <div className="border-t border-border/40 bg-background/40 p-3 space-y-3">
          {/* Lock notice + Reset action */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {polling ? (
              <p className="text-[11px] text-amber-500 font-medium flex items-center gap-1">
                🔒 หยุด polling ก่อนเพื่อแก้ไขค่าใน ขั้นตอน 1-3
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                ✏️ แก้ไขค่าใน ขั้นตอน 1-3 ได้ (ยังไม่ polling)
              </p>
            )}
            <Button
              size="sm"
              variant="outline"
              className="text-amber-500 border-amber-500/30 hover:bg-amber-500/10"
              onClick={() => setShowResetConfirm(true)}
              title="รีเซ็ตค่าทั้งหมด — ขั้นตอน 1-3 + กราฟ + klines"
            >
              ↺ Reset ค่า
            </Button>
          </div>

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
                <li><span className="text-foreground/80">Polling</span> — เลือกได้เฉพาะค่าที่ตรงกับ TF (1× = ทุกแท่งใหม่, 2-4× = เช็คน้อยลง)</li>
              </ul>
            </div>
          </details>

          <fieldset disabled={polling} className={`grid grid-cols-2 md:grid-cols-3 gap-3 ${polling ? "opacity-60" : ""}`}>
            <Field label="คู่ (Symbol)">
              <Select value={config.symbol} onValueChange={v => { if (v) onUpdate({ symbol: v }); }} disabled={polling}>
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
              <Select
                value={config.interval}
                onValueChange={v => {
                  if (!v) return;
                  const nextTf = v as GoldLiveInterval;
                  // Auto-sync pollSeconds to default (1× TF) when timeframe changes,
                  // so polling always matches the new TF cadence.
                  onUpdate({
                    interval: nextTf,
                    pollSeconds: defaultPollSecondsForInterval(nextTf),
                  });
                }}
                disabled={polling}
              >
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
            <Field label="Polling ทุก (= TF)">
              <Select
                value={String(config.pollSeconds)}
                onValueChange={v => { if (v) onUpdate({ pollSeconds: parseInt(v, 10) || defaultPollSecondsForInterval(config.interval) }); }}
                disabled={polling}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {pollOptionsForInterval(config.interval).map(o => (
                    <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[9px] text-muted-foreground mt-0.5">ตัวเลือกผูกกับ Timeframe</p>
            </Field>
          </fieldset>

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
          <fieldset disabled={polling} className={polling ? "opacity-60" : ""}>
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
                disabled={polling}
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
          </fieldset>

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
          <fieldset disabled={polling} className={`space-y-2 ${polling ? "opacity-60" : ""}`}>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_auto] gap-2 items-end">
              <Field label="Discord Webhook URL">
                <Input
                  type="password"
                  placeholder="https://discord.com/api/webhooks/..."
                  value={config.webhookUrl}
                  onChange={e => onUpdate({ webhookUrl: e.target.value })}
                  disabled={config.useEnvWebhook || polling}
                  autoComplete="off"
                />
              </Field>
              <Button
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={testing || polling || (!config.useEnvWebhook && !config.webhookUrl.trim())}
              >
                {testing ? "ทดสอบ..." : "ทดสอบ"}
              </Button>
              <Button
                variant={config.useEnvWebhook ? "default" : "outline"}
                size="sm"
                onClick={() => onUpdate({ useEnvWebhook: !config.useEnvWebhook })}
                disabled={polling}
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
                disabled={polling}
              >
                {config.alertsEnabled ? "● เปิด" : "○ ปิด"}
              </Button>
            </Field>
          </fieldset>

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

      {/* Confirm reset modal */}
      {showResetConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={() => setShowResetConfirm(false)}
        >
          <div
            className="w-full max-w-md rounded-lg border border-amber-500/30 bg-background shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">↺</span>
                <h3 className="text-sm font-semibold">ยืนยันการ Reset ค่า Watcher</h3>
              </div>
              <p className="text-[13px] text-muted-foreground">
                จะรีเซ็ตค่าทั้งหมดของ <span className="font-semibold text-foreground">{config.symbol}</span> (TF: {config.interval}) กลับเป็นค่าเริ่มต้น
              </p>
              <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2 space-y-1 text-[11px]">
                <p className="font-medium text-amber-500">รายการที่จะถูก reset:</p>
                <ul className="text-muted-foreground space-y-0.5 list-disc pl-4">
                  <li>ขั้นตอน 1 — Symbol, Timeframe, Polling → กลับเป็น <code>XAU/USD · 1h · 1× TF</code></li>
                  <li>ขั้นตอน 2 — กลยุทธ์ → กลับเป็น <code>RSI</code></li>
                  <li>ขั้นตอน 3 — Webhook URL + toggle → ล้างค่า</li>
                  <li>กราฟ + ข้อมูลแท่งเทียนที่โหลด → เคลียร์ทั้งหมด</li>
                  <li>หยุด polling อัตโนมัติ (ถ้ายังทำงานอยู่)</li>
                </ul>
              </div>
              <p className="text-[11px] text-emerald-500">
                ✓ ประวัติเทรดใน IndexedDB จะยังอยู่ (ไม่ถูกลบ)
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <Button size="sm" variant="outline" onClick={() => setShowResetConfirm(false)}>
                  ยกเลิก
                </Button>
                <Button
                  size="sm"
                  className="bg-amber-500 hover:bg-amber-600 text-white"
                  onClick={doReset}
                >
                  ↺ Reset ทั้งหมด
                </Button>
              </div>
            </div>
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
