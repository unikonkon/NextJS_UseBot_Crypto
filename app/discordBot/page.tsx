"use client";

import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  type KlineData,
  type BinanceKlineRaw,
  type Interval,
  parseKline,
} from "@/lib/types/kline";
import { computeAll, type AllIndicators } from "@/lib/indicators";
import {
  runBacktest,
  STRATEGIES,
  type StrategyId,
  type BacktestResult,
  type Trade,
  type SignalAction,
} from "@/lib/backtest";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardAction } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import KlineGraph from "@/app/klines/ui/graph";
import { ThemeToggle } from "@/components/theme-toggle";
import Link from "next/link";

// ─── Constants ─────────────────────────────────────────────────
const POPULAR_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
  "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "DOTUSDT", "LINKUSDT",
  "MATICUSDT", "LTCUSDT", "ATOMUSDT", "NEARUSDT", "APTUSDT",
  "ARBUSDT", "OPUSDT", "SUIUSDT", "INJUSDT", "FETUSDT",
];

const INTERVAL_GROUPS: Record<string, Interval[]> = {
  "วินาที": ["1s"],
  "นาที": ["1m", "3m", "5m", "15m", "30m"],
  "ชั่วโมง": ["1h", "2h", "4h", "6h", "8h", "12h"],
  "วัน+": ["1d", "3d", "1w", "1M"],
};

const POLL_OPTIONS: { value: number; label: string }[] = [
  { value: 5, label: "5 วินาที" },
  { value: 10, label: "10 วินาที" },
  { value: 15, label: "15 วินาที" },
  { value: 30, label: "30 วินาที" },
  { value: 60, label: "1 นาที" },
  { value: 120, label: "2 นาที" },
  { value: 300, label: "5 นาที" },
  { value: 600, label: "10 นาที" },
  { value: 900, label: "15 นาที" },
  { value: 1200, label: "20 นาที" },
  { value: 1800, label: "30 นาที" },
  { value: 3600, label: "1 ชั่วโมง" },
  { value: 7200, label: "2 ชั่วโมง" },
  { value: 10800, label: "3 ชั่วโมง" },
  { value: 14400, label: "4 ชั่วโมง" },
  { value: 86400, label: "1 วัน" },
];

const WATCHERS_STORAGE_KEY = "discordBot.watchers";

// ─── Formatting ────────────────────────────────────────────────
function fmtNum(val: string | number, dec = 2): string {
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(dec);
}
function fmtPrice(val: string | number): string {
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (n >= 1000) return n.toFixed(2);
  if (n >= 1) return n.toFixed(4);
  return n.toFixed(6);
}
function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
function fmtFullDate(ts: number): string {
  return new Date(ts).toLocaleString("en-US", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
function pnlColor(v: number): string {
  return v > 0 ? "text-emerald-500" : v < 0 ? "text-red-500" : "text-muted-foreground";
}
function pnlBg(v: number): string {
  return v > 0 ? "bg-emerald-500/10" : v < 0 ? "bg-red-500/10" : "bg-muted";
}

// ─── Mini Candle ───────────────────────────────────────────────
function MiniCandle({ kline }: { kline: KlineData }) {
  const o = +kline.open, c = +kline.close, h = +kline.high, l = +kline.low;
  const isUp = c >= o;
  const range = h - l;
  if (range === 0) return <div className="h-6 w-2" />;
  const bodyTop = ((h - Math.max(o, c)) / range) * 100;
  const bodyHeight = (Math.abs(c - o) / range) * 100;
  const color = isUp ? "bg-emerald-500" : "bg-red-500";
  return (
    <div className="relative h-6 w-2 mx-auto">
      <div className={`absolute left-1/2 w-px -translate-x-1/2 ${color}`} style={{ top: 0, height: "100%" }} />
      <div className={`absolute left-0 w-full ${color}`} style={{ top: `${bodyTop}%`, height: `${Math.max(bodyHeight, 4)}%` }} />
    </div>
  );
}

// ─── Equity Chart ──────────────────────────────────────────────
function EquityChart({ curve, trades }: { curve: number[]; trades: Trade[] }) {
  const step = Math.max(1, Math.floor(curve.length / 200));
  const sampled = curve.filter((_, i) => i % step === 0 || i === curve.length - 1);
  const max = Math.max(...sampled, 0.01);
  const min = Math.min(...sampled, -0.01);
  const range = max - min || 1;
  const zeroY = ((max - 0) / range) * 100;

  const tradeMarkers: { barIdx: number; pnlPct: number }[] = [];
  for (const t of trades) {
    const sampledIdx = Math.round(t.exitIdx / step);
    const clampedIdx = Math.min(sampledIdx, sampled.length - 1);
    tradeMarkers.push({ barIdx: clampedIdx, pnlPct: t.pnlPct });
  }

  const markerMap = new Map<number, number[]>();
  for (const m of tradeMarkers) {
    const arr = markerMap.get(m.barIdx) || [];
    arr.push(m.pnlPct);
    markerMap.set(m.barIdx, arr);
  }

  return (
    <div className="relative h-40 w-full">
      <div className="absolute left-0 right-0 border-t border-dashed border-muted-foreground/30" style={{ top: `${zeroY}%` }} />
      <div className="absolute left-1 text-[9px] text-muted-foreground" style={{ top: `${Math.max(zeroY - 5, 0)}%` }}>0%</div>
      <div className="flex h-full items-end gap-px">
        {sampled.map((val, i) => {
          const h = Math.abs(val) / range * 100;
          const isPos = val >= 0;
          const markers = markerMap.get(i);
          return (
            <div key={i} className="flex-1 flex flex-col justify-end h-full relative group">
              {isPos ? (
                <div className="w-full bg-emerald-500/60 absolute" style={{ bottom: `${100 - zeroY}%`, height: `${Math.max(h, 0.5)}%` }} />
              ) : (
                <div className="w-full bg-red-500/60 absolute" style={{ top: `${zeroY}%`, height: `${Math.max(h, 0.5)}%` }} />
              )}
              {markers && (
                <div
                  className={`absolute w-1.5 h-1.5 rounded-full left-1/2 -translate-x-1/2 z-10 ${markers[markers.length - 1] >= 0 ? "bg-emerald-400" : "bg-red-400"}`}
                  style={{
                    top: isPos
                      ? `${zeroY - (val / range) * 100 - 2}%`
                      : `${zeroY + (Math.abs(val) / range) * 100}%`,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="absolute top-0 right-1 text-[9px] text-emerald-500 tabular-nums">+{max.toFixed(1)}%</div>
      <div className="absolute bottom-0 right-1 text-[9px] text-red-500 tabular-nums">{min.toFixed(1)}%</div>
    </div>
  );
}

// ─── Watcher Config (per-symbol polling) ──────────────────────
interface WatcherConfig {
  id: string;
  symbol: string;
  customSymbol: string;
  interval: Interval;
  strategyId: StrategyId;
  strategyParams: Record<string, number>;
  pollSeconds: number;
  webhookUrl: string;
  useEnvWebhook: boolean;
  alertsEnabled: boolean;
  klineLimit: number;
}

function makeNewWatcher(seed?: Partial<WatcherConfig>): WatcherConfig {
  const rsi = STRATEGIES.find(s => s.id === "rsi")!;
  return {
    id: `w-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    symbol: "BTCUSDT",
    customSymbol: "",
    interval: "1h",
    strategyId: "rsi",
    strategyParams: { ...rsi.params },
    pollSeconds: 60,
    webhookUrl: "",
    useEnvWebhook: false,
    alertsEnabled: true,
    klineLimit: 200,
    ...seed,
  };
}

// Binance request weight by limit (per /api/v3/klines docs)
function binanceKlineWeight(limit: number): number {
  if (limit <= 100) return 1;
  if (limit <= 500) return 2;
  if (limit <= 1000) return 5;
  return 10;
}

// ─── Discord Alert Entry ───────────────────────────────────────
interface DiscordAlert {
  id: string;
  time: number;
  symbol: string;
  interval: string;
  strategyName: string;
  action: "BUY" | "SELL";
  price: number;
  barOpenTime: number;
  status: "ok" | "error";
  message?: string;
  // For SELL: reference to the previous BUY (price + bar openTime), and P&L %
  entryPrice?: number;
  entryTime?: number;
  pnlPct?: number;
}

// ═══════════════════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════════════════
export default function DiscordBotPage() {
  // ── Data state ──
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [customSymbol, setCustomSymbol] = useState("");
  const [interval, setInterval] = useState<Interval>("1h");
  const [limit, setLimit] = useState("200");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [klines, setKlines] = useState<KlineData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [historicalProgress, setHistoricalProgress] = useState<{ current: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── Indicator + Backtest state ──
  const [indicators, setIndicators] = useState<AllIndicators | null>(null);
  const [strategyId, setStrategyId] = useState<StrategyId>("rsi");
  const [strategyParams, setStrategyParams] = useState<Record<string, number>>(
    () => ({ ...STRATEGIES.find(s => s.id === "rsi")!.params })
  );
  const [feesPct, setFeesPct] = useState("0.1");
  const [btResult, setBtResult] = useState<BacktestResult | null>(null);
  const [btRunning, setBtRunning] = useState(false);
  const [allBtResults, setAllBtResults] = useState<{ strategyId: StrategyId; name: string; result: BacktestResult }[] | null>(null);
  const [allBtRunning, setAllBtRunning] = useState(false);
  const [allBtExpanded, setAllBtExpanded] = useState<Set<StrategyId>>(new Set());

  // ── Discord global state ──
  const [alerts, setAlerts] = useState<DiscordAlert[]>([]);

  // ── Watchers (multi-symbol Discord alerts) ──
  const [watchers, setWatchers] = useState<WatcherConfig[]>([]);
  // Map<watcherId, isPolling> — child rows report up; used for rate-limit calc
  const [pollingMap, setPollingMap] = useState<Record<string, boolean>>({});

  const activeSymbol = customSymbol.trim().toUpperCase() || symbol;

  // ── Load watchers from localStorage on mount ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    const saved = localStorage.getItem(WATCHERS_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as WatcherConfig[];
        if (Array.isArray(parsed)) setWatchers(parsed);
      } catch { /* ignore corrupt JSON */ }
    }
  }, []);

  // ── Persist watchers ──
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (watchers.length > 0) localStorage.setItem(WATCHERS_STORAGE_KEY, JSON.stringify(watchers));
    else localStorage.removeItem(WATCHERS_STORAGE_KEY);
  }, [watchers]);

  // ── Compute indicators when klines change ──
  useEffect(() => {
    if (klines.length >= 15) setIndicators(computeAll(klines));
    else setIndicators(null);
  }, [klines]);

  // ─── Fetch one-shot realtime ───────────────────────────────
  const fetchRealtime = useCallback(async () => {
    setLoading(true);
    setError(null);
    setKlines([]);
    setIndicators(null);
    setBtResult(null);
    setAllBtResults(null);
    setHistoricalProgress(null);
    try {
      const params = new URLSearchParams({ symbol: activeSymbol, interval, limit });
      const res = await fetch(`/api/klines?${params}`);
      if (!res.ok) { const b = await res.json(); throw new Error(b.error || `HTTP ${res.status}`); }
      const raw: BinanceKlineRaw[] = await res.json();
      setKlines(raw.map(parseKline));
      setLastFetch(new Date());
    } catch (err) { setError(String(err)); }
    finally { setLoading(false); }
  }, [activeSymbol, interval, limit]);

  // ─── Fetch historical ──────────────────────────────────────
  const fetchHistorical = useCallback(async () => {
    if (!startTime) { setError("กรุณาระบุเวลาเริ่มต้น"); return; }
    setLoading(true); setError(null); setKlines([]); setIndicators(null); setBtResult(null); setAllBtResults(null);
    setHistoricalProgress({ current: 0 });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const st = new Date(startTime).getTime();
      const et = endTime ? new Date(endTime).getTime() : Date.now();
      let cur = st;
      const all: KlineData[] = [];
      while (cur < et) {
        if (controller.signal.aborted) break;
        setHistoricalProgress({ current: all.length });
        const params = new URLSearchParams({
          symbol: activeSymbol, interval, limit: "1000",
          startTime: cur.toString(), endTime: et.toString(),
        });
        const res = await fetch(`/api/klines?${params}`, { signal: controller.signal });
        if (!res.ok) { const b = await res.json(); throw new Error(b.error || `HTTP ${res.status}`); }
        const raw: BinanceKlineRaw[] = await res.json();
        if (raw.length === 0) break;
        const parsed = raw.map(parseKline);
        all.push(...parsed);
        const last = parsed[parsed.length - 1].closeTime;
        if (last >= et || raw.length < 1000) break;
        cur = last + 1;
        await new Promise(r => setTimeout(r, 100));
      }
      setKlines(all);
      setLastFetch(new Date());
    } catch (err) {
      if (!controller.signal.aborted) setError(String(err));
    } finally {
      setLoading(false); setHistoricalProgress(null); abortRef.current = null;
    }
  }, [activeSymbol, interval, startTime, endTime]);

  // ─── Append alert to global log (called by WatcherRow) ────
  const appendAlert = useCallback((alert: DiscordAlert) => {
    setAlerts(prev => [alert, ...prev].slice(0, 100));
  }, []);

  // ─── Track per-watcher polling state from child rows ──────
  const setWatcherPolling = useCallback((id: string, polling: boolean) => {
    setPollingMap(prev => {
      if (!!prev[id] === polling) return prev;
      return { ...prev, [id]: polling };
    });
  }, []);

  // ─── Watcher CRUD ──────────────────────────────────────────
  const addWatcher = useCallback(() => {
    setWatchers(prev => [...prev, makeNewWatcher({
      symbol: activeSymbol,
      interval,
      strategyId,
      strategyParams: { ...strategyParams },
      klineLimit: parseInt(limit, 10) || 200,
    })]);
  }, [activeSymbol, interval, strategyId, strategyParams, limit]);

  const updateWatcher = useCallback((id: string, patch: Partial<WatcherConfig>) => {
    setWatchers(prev => prev.map(w => w.id === id ? { ...w, ...patch } : w));
  }, []);

  const removeWatcher = useCallback((id: string) => {
    setWatchers(prev => prev.filter(w => w.id !== id));
    setPollingMap(prev => {
      const { [id]: _drop, ...rest } = prev;
      return rest;
    });
  }, []);

  // ─── Run single Backtest ───────────────────────────────────
  const runBt = useCallback(() => {
    if (klines.length < 50) { setError("ต้องมีอย่างน้อย 50 แท่งเทียนเพื่อรัน Backtest"); return; }
    setBtRunning(true);
    setError(null);
    setTimeout(() => {
      try {
        const result = runBacktest(klines, strategyId, strategyParams, parseFloat(feesPct) || 0.1);
        setBtResult(result);
      } catch (err) { setError(String(err)); }
      finally { setBtRunning(false); }
    }, 10);
  }, [klines, strategyId, strategyParams, feesPct]);

  // ─── Run All Backtests ─────────────────────────────────────
  const runAllBt = useCallback(() => {
    if (klines.length < 50) { setError("ต้องมีอย่างน้อย 50 แท่งเทียนเพื่อรัน Backtest"); return; }
    setAllBtRunning(true);
    setError(null);
    setAllBtResults(null);
    setTimeout(() => {
      try {
        const fees = parseFloat(feesPct) || 0.1;
        const results = STRATEGIES.map(s => ({
          strategyId: s.id,
          name: s.name,
          result: runBacktest(klines, s.id, { ...s.params }, fees),
        }));
        results.sort((a, b) => b.result.totalPnlPct - a.result.totalPnlPct);
        setAllBtResults(results);
        setAllBtExpanded(new Set());
      } catch (err) { setError(String(err)); }
      finally { setAllBtRunning(false); }
    }, 10);
  }, [klines, feesPct]);


  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1400px] px-4 py-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Discord Bot — Real-time Signal Alerts</h1>
              <p className="text-xs text-muted-foreground">ดึงข้อมูลแท่งเทียน → คำนวณ Indicator → ส่งสัญญาณ BUY/SELL เข้า Discord อัตโนมัติ</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="border border-blue-500/30 bg-blue-500/10 text-[11px] font-medium text-blue-500 hover:bg-blue-500/20">
                <Link href="/klines">Klines & Backtest</Link>
              </Button>
              <Button variant="outline" size="sm" className="border border-yellow-500/30 bg-yellow-500/10 text-[11px] font-medium text-yellow-500 hover:bg-yellow-500/20">
                <Link href="/trading/Binance">Binance Trading</Link>
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {(() => {
              const activeCount = Object.values(pollingMap).filter(Boolean).length;
              if (activeCount === 0) return null;
              return (
                <Badge variant="outline" className="text-[10px] text-emerald-500 border-emerald-500/40 animate-pulse">
                  ● LIVE {activeCount} watchers
                </Badge>
              );
            })()}
            {lastFetch && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                ล่าสุด: {lastFetch.toLocaleTimeString()}
              </Badge>
            )}
            {klines.length > 0 && (
              <Badge variant="secondary">{klines.length.toLocaleString()} แท่งเทียน</Badge>
            )}
            <ThemeToggle />
          </div>
        </div>
        <Separator />

        {/* ═══ DISCORD WATCHERS (MULTI-SYMBOL) ═══ */}
        <Card size="sm" className="border-indigo-500/30">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <StepBadge n={3} done={watchers.length > 0 && Object.values(pollingMap).some(Boolean)} />
                <div>
                  <CardTitle className="text-indigo-400">Discord Webhook + Real-time Alerts (Multi-Symbol)</CardTitle>
                  <CardDescription>
                    แต่ละคู่เหรียญรัน polling + ส่งแจ้งเตือนแยกกัน — เพิ่มได้หลายคู่ แต่ละคู่มี webhook URL ของตัวเอง
                  </CardDescription>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={Object.values(pollingMap).some(Boolean) ? "text-emerald-500 border-emerald-500/40 animate-pulse" : "text-muted-foreground"}
                >
                  {Object.values(pollingMap).filter(Boolean).length} / {watchers.length} active
                </Badge>
                <Button
                  size="sm"
                  className="bg-indigo-500 hover:bg-indigo-600 text-white"
                  onClick={addWatcher}
                >
                  + เพิ่มคู่เหรียญ
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Rate limit info */}
            <RateLimitInfo watchers={watchers} pollingMap={pollingMap} />

            {/* Watchers list */}
            {watchers.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-6 text-center space-y-2">
                <p className="text-sm text-muted-foreground">ยังไม่มี Watcher</p>
                <p className="text-[11px] text-muted-foreground">
                  กดปุ่ม <span className="font-medium text-indigo-400">+ เพิ่มคู่เหรียญ</span> ด้านบนเพื่อสร้าง Watcher ตัวแรก
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-indigo-500/30 text-indigo-400"
                  onClick={addWatcher}
                >
                  + สร้าง Watcher แรก
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {watchers.map(w => (
                  <WatcherRow
                    key={w.id}
                    config={w}
                    onUpdate={(patch) => updateWatcher(w.id, patch)}
                    onRemove={() => removeWatcher(w.id)}
                    onPollingChange={(p) => setWatcherPolling(w.id, p)}
                    onAlert={appendAlert}
                  />
                ))}
              </div>
            )}

            <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2 text-[10px] text-amber-500/80">
              <p className="font-medium">วิธีทำงาน:</p>
              <p>1. แต่ละ watcher poll /api/klines ของตัวเอง ทุก N วินาที (ช่วงเวลาตั้งได้แยก)</p>
              <p>2. รัน Backtest engine บนข้อมูลของ watcher นั้น → ตรวจสัญญาณที่ &quot;แท่งปิดล่าสุด&quot;</p>
              <p>3. ส่ง embed เข้า webhook URL ของ watcher นั้น (deduplicate ด้วย openTime) — SELL จะแนบราคา BUY ก่อนหน้า + P&amp;L%</p>
            </div>

            <DiscordHelpPanel />
          </CardContent>
        </Card>

        {/* ═══ CONFIG ═══ */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_650px]">
          <Card size="sm">
            <CardHeader>
              <div className="flex items-center gap-3">
                <StepBadge n={1} done={!!activeSymbol && !!interval} />
                <div>
                  <CardTitle>ตั้งค่า — เลือกคู่เหรียญและช่วงเวลา</CardTitle>
                  <CardDescription>เลือกเหรียญและ Timeframe ที่ต้องการ — เริ่มที่นี่</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-3 items-center">
                <Field label="คู่เหรียญ">
                  <Select value={symbol} onValueChange={(v) => { if (v) { setSymbol(v); setCustomSymbol(""); } }}>
                    <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectGroup><SelectLabel>ยอดนิยม</SelectLabel>
                        {POPULAR_SYMBOLS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="กำหนดเอง">
                  <Input placeholder="เช่น PEPEUSDT" value={customSymbol} onChange={e => setCustomSymbol(e.target.value)} className="w-36" />
                </Field>
                <Field label="ช่วงเวลา">
                  <Select value={interval} onValueChange={(v) => { if (v) setInterval(v as Interval); }}>
                    <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(INTERVAL_GROUPS).map(([g, ints]) => (
                        <SelectGroup key={g}><SelectLabel>{g}</SelectLabel>
                          {ints.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </CardContent>
          </Card>

          {/* Fetch Data */}
          <Card size="sm">
            <CardHeader>
              <div className="flex items-center gap-3">
                <StepBadge n={2} done={klines.length > 0} />
                <div>
                  <CardTitle>ดึงข้อมูลแท่งเทียน</CardTitle>
                  <CardDescription>โหลด snapshot ครั้งเดียว หรือดึงย้อนหลัง — เป็นข้อมูลเริ่มต้นสำหรับ Indicator + Realtime</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-end gap-2 flex-wrap">
                  <Field label="โหลดข้อมูล จำนวนแท่งเทียน">
                    <Select value={limit} onValueChange={(v) => { if (v) setLimit(v); }}>
                      <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["50", "100", "200", "500", "1000"].map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Button onClick={fetchRealtime} disabled={loading} className="h-9">
                    {loading ? "กำลังโหลด..." : "โหลดข้อมูล"}
                  </Button>
                </div>
                <p className="text-[10px] text-muted-foreground">โหลด snapshot ครั้งเดียว — ใช้สำหรับเริ่มต้น แล้วเปิดโหมด Realtime เพื่อเติมข้อมูลต่อเนื่อง</p>
              </div>

              <Separator />

              {/* Historical fetch */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="ดึงข้อมูลย้อนหลัง เริ่มต้น">
                    <Input type="datetime-local" value={startTime} onChange={e => setStartTime(e.target.value)} className="w-44" />
                  </Field>
                  <Field label="สิ้นสุด">
                    <Input type="datetime-local" value={endTime} onChange={e => setEndTime(e.target.value)} className="w-44" />
                  </Field>
                  <Button onClick={fetchHistorical} disabled={loading} className="h-9">
                    {loading ? "กำลังดึง..." : "ดึงย้อนหลัง"}
                  </Button>
                  {loading && (
                    <Button variant="destructive" size="sm" onClick={() => abortRef.current?.abort()}>ยกเลิก</Button>
                  )}
                </div>
                {historicalProgress && (
                  <span className="text-[10px] text-muted-foreground animate-pulse">
                    {historicalProgress.current.toLocaleString()} แท่งเทียน...
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ═══ ALERTS LOG ═══ */}
        {alerts.length > 0 && (
          <Card size="sm">
            <CardHeader className="border-b">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>ประวัติการแจ้งเตือน Discord</CardTitle>
                  <CardDescription>{alerts.length} รายการล่าสุด (เก็บใน memory)</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={() => setAlerts([])}>ล้างประวัติ</Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>เวลาส่ง</TableHead>
                    <TableHead>คู่เหรียญ</TableHead>
                    <TableHead>TF</TableHead>
                    <TableHead>กลยุทธ์</TableHead>
                    <TableHead className="text-center">สัญญาณ</TableHead>
                    <TableHead className="text-right">ราคา</TableHead>
                    <TableHead className="text-right">ราคา BUY ก่อนหน้า</TableHead>
                    <TableHead className="text-right">กำไร/ขาดทุน</TableHead>
                    <TableHead>เวลาแท่ง</TableHead>
                    <TableHead>สถานะ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alerts.map(a => (
                    <TableRow key={a.id} className={a.action === "BUY" ? "bg-emerald-500/[0.04]" : "bg-red-500/[0.04]"}>
                      <TableCell className="text-muted-foreground tabular-nums text-[10px]">{new Date(a.time).toLocaleTimeString()}</TableCell>
                      <TableCell className="font-medium">{a.symbol}</TableCell>
                      <TableCell className="text-muted-foreground">{a.interval}</TableCell>
                      <TableCell className="text-[10px]">{a.strategyName}</TableCell>
                      <TableCell className="text-center">
                        <Badge variant="outline" className={a.action === "BUY" ? "text-emerald-500 border-emerald-500/30" : "text-red-500 border-red-500/30"}>
                          {a.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{fmtPrice(a.price)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {a.action === "SELL"
                          ? (a.entryPrice != null
                            ? <span className="text-emerald-500/80">{fmtPrice(a.entryPrice)}</span>
                            : <span className="text-muted-foreground">-</span>)
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {a.action === "SELL"
                          ? (a.pnlPct != null
                            ? <span className={`font-semibold ${a.pnlPct >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                              {a.pnlPct >= 0 ? "+" : ""}{a.pnlPct.toFixed(2)}%
                            </span>
                            : <span className="text-muted-foreground">-</span>)
                          : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-[10px]">{fmtFullDate(a.barOpenTime)}</TableCell>
                      <TableCell>
                        {a.status === "ok"
                          ? <Badge variant="outline" className="text-emerald-500 border-emerald-500/30">ส่งสำเร็จ</Badge>
                          : <Badge variant="outline" className="text-red-500 border-red-500/30" title={a.message}>ผิดพลาด</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {/* Error */}
        {error && <ErrorCard message={error} />}

        {/* Price Chart */}
        {klines.length > 0 && (
          <KlineGraph
            klines={klines}
            indicators={indicators}
            btResult={btResult}
            strategyId={strategyId}
          />
        )}

        {/* ═══ BACKTEST All Indicator and Strategy ═══ */}
        {klines.length > 0 && (
          <Card size="sm">
            <CardHeader className="border-b">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>ทดสอบกลยุทธ์ย้อนหลัง ทุก Indicator</CardTitle>
                  <CardDescription>รันทุกกลยุทธ์ ({STRATEGIES.length} ตัว) บนข้อมูล {klines.length.toLocaleString()} แท่งเทียน — เรียงตามกำไรสูงสุด</CardDescription>
                </div>
                <Button onClick={runAllBt} disabled={allBtRunning || klines.length < 50} className="h-9 shrink-0">
                  {allBtRunning ? "กำลังรัน..." : "รัน Backtest ทั้งหมด"}
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-3">
              {!allBtResults && !allBtRunning && (
                <p className="text-xs text-muted-foreground text-center py-6">กดปุ่ม &quot;รัน Backtest ทั้งหมด&quot; เพื่อเปรียบเทียบทุกกลยุทธ์</p>
              )}
              {allBtRunning && (
                <div className="space-y-2 py-4">
                  {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                </div>
              )}
              {allBtResults && (
                <div className="space-y-2">
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-8 text-center">#</TableHead>
                          <TableHead>กลยุทธ์</TableHead>
                          <TableHead className="text-right">กำไร/ขาดทุน</TableHead>
                          <TableHead className="text-right">อัตราชนะ</TableHead>
                          <TableHead className="text-right">จำนวนเทรด</TableHead>
                          <TableHead className="text-right">Drawdown</TableHead>
                          <TableHead className="text-right">Profit Factor</TableHead>
                          <TableHead className="text-right">Sharpe</TableHead>
                          <TableHead className="text-right">vs ซื้อถือ</TableHead>
                          <TableHead className="w-10"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {allBtResults.map((item, idx) => {
                          const r = item.result;
                          const isExpanded = allBtExpanded.has(item.strategyId);
                          const diff = r.totalPnlPct - r.buyAndHoldPct;
                          return (
                            <React.Fragment key={item.strategyId}>
                              <TableRow
                                className="cursor-pointer hover:bg-muted/50"
                                onClick={() => setAllBtExpanded(prev => {
                                  const next = new Set(prev);
                                  if (next.has(item.strategyId)) next.delete(item.strategyId);
                                  else next.add(item.strategyId);
                                  return next;
                                })}
                              >
                                <TableCell className="text-center text-muted-foreground text-xs">{idx + 1}</TableCell>
                                <TableCell className="font-medium text-xs">{item.name}</TableCell>
                                <TableCell className={`text-right tabular-nums font-semibold ${pnlColor(r.totalPnlPct)}`}>
                                  {r.totalPnlPct >= 0 ? "+" : ""}{r.totalPnlPct.toFixed(2)}%
                                </TableCell>
                                <TableCell className={`text-right tabular-nums text-xs ${r.winRate >= 50 ? "text-emerald-500" : "text-red-500"}`}>
                                  {r.winRate.toFixed(1)}%
                                </TableCell>
                                <TableCell className="text-right tabular-nums text-xs">
                                  {r.totalTrades} <span className="text-muted-foreground">({r.wins}W/{r.losses}L)</span>
                                </TableCell>
                                <TableCell className="text-right tabular-nums text-xs text-red-500">
                                  -{r.maxDrawdownPct.toFixed(2)}%
                                </TableCell>
                                <TableCell className={`text-right tabular-nums text-xs ${r.profitFactor > 1 ? "text-emerald-500" : "text-red-500"}`}>
                                  {r.profitFactor === Infinity ? "INF" : r.profitFactor.toFixed(2)}
                                </TableCell>
                                <TableCell className={`text-right tabular-nums text-xs ${r.sharpeRatio > 0 ? "text-emerald-500" : "text-red-500"}`}>
                                  {r.sharpeRatio.toFixed(3)}
                                </TableCell>
                                <TableCell className={`text-right tabular-nums text-xs font-medium ${diff >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                                  {diff >= 0 ? "+" : ""}{diff.toFixed(2)}%
                                </TableCell>
                                <TableCell className="text-center text-muted-foreground text-xs">
                                  {isExpanded ? "▲" : "▼"}
                                </TableCell>
                              </TableRow>
                              {isExpanded && (
                                <TableRow>
                                  <TableCell colSpan={10} className="p-0">
                                    <div className="border-t bg-muted/20 px-4 py-3 space-y-3">
                                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                        <StatCard label="กำไรเฉลี่ย" value={`+${r.avgWinPct.toFixed(2)}%`} color="text-emerald-500" size="sm" />
                                        <StatCard label="ขาดทุนเฉลี่ย" value={`${r.avgLossPct.toFixed(2)}%`} color="text-red-500" size="sm" />
                                        <StatCard label="เทรดที่ดีที่สุด" value={`+${r.bestTradePct.toFixed(2)}%`} color="text-emerald-500" size="sm" />
                                        <StatCard label="เทรดที่แย่ที่สุด" value={`${r.worstTradePct.toFixed(2)}%`} color="text-red-500" size="sm" />
                                      </div>
                                      <div className="grid grid-cols-3 gap-2">
                                        <StatCard label="แท่งเทียนถือเฉลี่ย" value={`${r.avgBarsHeld.toFixed(1)}`} size="sm" />
                                        <StatCard label="ซื้อแล้วถือ" value={`${r.buyAndHoldPct >= 0 ? "+" : ""}${r.buyAndHoldPct.toFixed(2)}%`} color={pnlColor(r.buyAndHoldPct)} size="sm" />
                                        <StatCard label={diff >= 0 ? "กลยุทธ์ชนะซื้อถือ" : "ซื้อถือชนะกลยุทธ์"} value={`${diff >= 0 ? "+" : ""}${diff.toFixed(2)}%`} color={diff >= 0 ? "text-emerald-500" : "text-red-500"} size="sm" />
                                      </div>
                                      <div className="flex flex-wrap gap-1">
                                        {r.trades.map((t, i) => (
                                          <span
                                            key={i}
                                            className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-medium tabular-nums ${t.pnlPct >= 0 ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"}`}
                                          >
                                            #{i + 1} {t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(2)}%
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  {allBtResults.length >= 2 && (
                    <div className="flex gap-3">
                      <Card size="sm" className="flex-1 ring-emerald-500/20">
                        <CardContent className="py-2.5">
                          <p className="text-[10px] text-muted-foreground">กลยุทธ์ที่ดีที่สุด</p>
                          <p className="text-sm font-semibold text-emerald-500">{allBtResults[0].name}</p>
                          <p className="text-xs tabular-nums text-emerald-500">+{allBtResults[0].result.totalPnlPct.toFixed(2)}%</p>
                        </CardContent>
                      </Card>
                      <Card size="sm" className="flex-1 ring-red-500/20">
                        <CardContent className="py-2.5">
                          <p className="text-[10px] text-muted-foreground">กลยุทธ์ที่แย่ที่สุด</p>
                          <p className="text-sm font-semibold text-red-500">{allBtResults[allBtResults.length - 1].name}</p>
                          <p className="text-xs tabular-nums text-red-500">{allBtResults[allBtResults.length - 1].result.totalPnlPct.toFixed(2)}%</p>
                        </CardContent>
                      </Card>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ═══ BACKTEST 1 : Indicator ═══ */}
        {klines.length > 0 && (
          <Card size="sm">
            <CardHeader className="border-b">
              <CardTitle>ทดสอบกลยุทธ์ย้อนหลัง กับ Indicator</CardTitle>
              <CardDescription>เลือกกลยุทธ์ที่จะใช้สำหรับ Real-time Alerts + ปรับ Parameter + รัน Backtest บน {klines.length.toLocaleString()} แท่งเทียน</CardDescription>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="space-y-3">
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">เลือกกลยุทธ์ (ใช้สำหรับ Real-time Alerts ด้วย)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {STRATEGIES.map(s => (
                      <Button
                        key={s.id}
                        variant={strategyId === s.id ? "default" : "outline"}
                        size="sm"
                        className={`text-[11px] h-8 px-3 ${strategyId === s.id ? "" : "text-muted-foreground hover:text-foreground"}`}
                        onClick={() => {
                          setStrategyId(s.id);
                          setStrategyParams({ ...s.params });
                          setBtResult(null);
                        }}
                      >
                        {s.name}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <Field label="ค่าธรรมเนียม (%)">
                      <Input type="number" step="0.01" value={feesPct} onChange={e => setFeesPct(e.target.value)} className="w-20" />
                    </Field>
                    <Button onClick={runBt} disabled={btRunning || klines.length < 50} className="h-9">
                      {btRunning ? "กำลังรัน..." : "รัน Backtest"}
                    </Button>
                  </div>
                  {btResult ? (
                    <span className={`text-lg font-bold tabular-nums ${btResult.totalPnlPct >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                      กำไรรวม: {btResult.totalPnlPct >= 0 ? "+" : ""}{btResult.totalPnlPct.toFixed(2)}%
                    </span>
                  ) : (
                    <span className="text-sm text-muted-foreground">กำไรรวม หลัง backtest : —</span>
                  )}
                </div>

                {(() => {
                  const strat = STRATEGIES.find(s => s.id === strategyId);
                  if (!strat) return null;
                  return (
                    <div className="space-y-0.5">
                      <p className="text-[10px] text-muted-foreground">{strat.descriptionEn}</p>
                      <p className="text-[10px] text-muted-foreground">{strat.descriptionTh}</p>
                    </div>
                  );
                })()}

                {Object.keys(strategyParams).length > 0 && (
                  <div className="flex flex-wrap items-end space-x-4">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground w-full">ปรับค่าพารามิเตอร์</p>
                    {Object.entries(strategyParams).map(([key, val]) => (
                      <Field key={key} label={key}>
                        <Input
                          type="number"
                          step={1}
                          min={0}
                          value={val}
                          onChange={e => setStrategyParams(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                          className="w-24"
                        />
                      </Field>
                    ))}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Backtest Results */}
        {btResult && <BacktestResults result={btResult} />}

        {/* Indicator Values */}
        {indicators && klines.length > 0 && <IndicatorPanel indicators={indicators} klines={klines} />}

        {/* Kline Table */}
        <KlineTable klines={klines} loading={loading} signals={btResult?.signals} />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

// Merge fresh klines into existing array — replaces overlapping bars (by openTime), appends new ones
function mergeKlines(prev: KlineData[], fresh: KlineData[]): KlineData[] {
  if (prev.length === 0) return fresh;
  if (fresh.length === 0) return prev;

  const map = new Map<number, KlineData>();
  for (const k of prev) map.set(k.openTime, k);
  for (const k of fresh) map.set(k.openTime, k); // fresh wins on overlap
  return Array.from(map.values()).sort((a, b) => a.openTime - b.openTime);
}

// ═══════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

// ─── Step Badge (vertical stepper indicator) ──────────────────
function StepBadge({ n, done, label }: { n: number; done: boolean; label?: string }) {
  return (
    <div className="inline-flex items-center gap-2">
      <span
        className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-[12px] font-bold border-2 transition-colors ${done
            ? "bg-emerald-500/20 border-emerald-500 text-emerald-500"
            : "bg-muted border-border text-muted-foreground"
          }`}
        title={done ? "ทำขั้นนี้แล้ว" : "ยังไม่ได้ทำ"}
      >
        {done ? "✓" : n}
      </span>
      {label && (
        <span className={`text-[10px] font-medium ${done ? "text-emerald-500" : "text-muted-foreground"}`}>
          {done ? "เสร็จแล้ว" : label}
        </span>
      )}
    </div>
  );
}

// ─── Discord Help Panel ────────────────────────────────────────
function DiscordHelpPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded border border-indigo-500/20 bg-indigo-500/5">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-[11px] font-medium text-indigo-400 hover:bg-indigo-500/10 transition-colors"
      >
        <span>📘 วิธีตั้งค่า Discord Webhook + ข้อจำกัด + API ที่ใช้</span>
        <span className="text-[10px]">{open ? "▲ ซ่อน" : "▼ ขยาย"}</span>
      </button>

      {open && (
        <div className="border-t border-indigo-500/20 px-3 py-3 space-y-3 text-[10px]">

          {/* Section 1: Setup steps */}
          <div className="space-y-1.5">
            <p className="font-medium text-foreground/90 text-[11px]">ขั้นตอนสร้าง Discord Webhook</p>
            <ol className="space-y-1 text-muted-foreground list-decimal list-inside">
              <li>เปิด Discord เลือก server ที่ต้องการรับการแจ้งเตือน</li>
              <li>คลิกขวาที่ <span className="text-foreground/80">channel</span> ที่ต้องการ → <span className="text-foreground/80">Edit Channel</span></li>
              <li>เลือกแท็บ <span className="text-foreground/80">Integrations</span> → <span className="text-foreground/80">Webhooks</span></li>
              <li>กด <span className="text-foreground/80">New Webhook</span> → ตั้งชื่อ + เลือกรูป + เลือก channel</li>
              <li>กด <span className="text-emerald-500 font-medium">Copy Webhook URL</span></li>
              <li>วาง URL ลงในช่อง &quot;Discord Webhook URL&quot; ด้านบน → กด <span className="text-foreground/80">ทดสอบ Webhook</span></li>
              <li>เมื่อทดสอบสำเร็จ (เห็นข้อความใน Discord) → เลือก Polling interval + กลยุทธ์ → กด <span className="text-emerald-500 font-medium">▶ เริ่มดึงข้อมูลเรียลไทม์</span></li>
            </ol>
            <p className="text-[9px] text-muted-foreground/70 mt-1">
              Path: Channel → ⚙ Edit Channel → Integrations → Webhooks → New Webhook → Copy Webhook URL
            </p>
          </div>

          <Separator />

          {/* Section 2: Rate limits */}
          <div className="space-y-1.5">
            <p className="font-medium text-foreground/90 text-[11px]">ข้อจำกัด (ฟรี แต่มี Rate Limit)</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="rounded border border-border/40 bg-background/50 p-2">
                <p className="font-medium text-emerald-500">Webhook</p>
                <p className="text-muted-foreground mt-0.5">
                  <span className="text-foreground/80">~30 ข้อความ / 60 วินาที</span> ต่อ channel
                </p>
                <p className="text-muted-foreground/70 mt-0.5">เกินจะได้ HTTP 429 (rate limited) ชั่วคราว</p>
              </div>
              <div className="rounded border border-border/40 bg-background/50 p-2">
                <p className="font-medium text-blue-400">Bot API</p>
                <p className="text-muted-foreground mt-0.5">
                  Rate limit ตาม endpoint (ปกติพอใช้)
                </p>
                <p className="text-muted-foreground/70 mt-0.5">ระบบนี้ใช้ Webhook อย่างเดียว ไม่กระทบ</p>
              </div>
            </div>
            <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2 text-[10px] text-amber-500/80 mt-1">
              <p className="font-medium">คำแนะนำ Polling interval:</p>
              <p>• ตั้ง interval ให้ &gt;= timeframe ของแท่งเทียน — เช่น TF = 1h ก็ poll ทุก 5-15 นาทีก็พอ ไม่ต้อง 5 วินาที</p>
              <p>• ระบบมี deduplicate ด้วย openTime อยู่แล้ว — ไม่ส่งซ้ำสัญญาณเดียวกัน 2 ครั้ง</p>
              <p>• Polling เร็วเกินไป = เปลือง API call ของ Binance (มี rate limit ของตัวเอง) แต่ไม่กระทบ Discord เพราะส่งเฉพาะตอนมีสัญญาณใหม่</p>
            </div>
          </div>

          <Separator />

          {/* Section 3: API ที่ระบบใช้ */}
          <div className="space-y-1.5">
            <p className="font-medium text-foreground/90 text-[11px]">API ที่ระบบใช้</p>
            <div className="space-y-1.5">
              <div className="rounded border border-border/40 bg-background/50 p-2 space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[9px] text-emerald-500 border-emerald-500/30">POST</Badge>
                  <code className="text-foreground/90 text-[10px]">/api/discord/notify</code>
                </div>
                <p className="text-muted-foreground">
                  Server-side proxy → ส่ง payload เข้า Discord Webhook URL (รับจาก body หรือ <code className="text-foreground/70">process.env.DISCORD_WEBHOOK_URL</code>)
                </p>
                <p className="text-muted-foreground/80">
                  Body: <code className="text-foreground/70">{`{ webhookUrl?, content?, username?, embeds? }`}</code>
                </p>
                <p className="text-muted-foreground/70 text-[9px]">
                  ระบบ validate ว่า URL ขึ้นต้นด้วย <code>https://discord.com/api/webhooks/</code> เท่านั้น
                </p>
              </div>

              <div className="rounded border border-border/40 bg-background/50 p-2 space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[9px] text-blue-400 border-blue-400/30">GET</Badge>
                  <code className="text-foreground/90 text-[10px]">/api/klines?symbol=...&interval=...&limit=...</code>
                </div>
                <p className="text-muted-foreground">
                  ดึง Candlestick data จาก Binance — ระบบใช้ตอน polling ทุก N วินาที
                </p>
              </div>

              <div className="rounded border border-border/40 bg-background/50 p-2 space-y-1">
                <p className="font-medium text-foreground/80">📤 ตัวอย่าง Payload ที่ส่งเข้า Discord:</p>
                <pre className="text-[9px] text-muted-foreground/90 bg-background/70 rounded p-1.5 overflow-x-auto">
                  {`{
  "username": "Crypto Signal Bot",
  "embeds": [{
    "title": "🟢 BUY Signal — BTCUSDT",
    "description": "กลยุทธ์: RSI Overbought/Oversold\\nTimeframe: 1h",
    "color": 1098907,
    "fields": [
      { "name": "ราคา", "value": "65432.10" },
      { "name": "Open/High/Low", ... },
      { "name": "Volume", ... },
      { "name": "เวลาแท่ง", ... }
    ],
    "timestamp": "2026-05-20T..."
  }]
}`}
                </pre>
              </div>
            </div>
          </div>

          <Separator />

          {/* Section 4: Security notes */}
          <div className="space-y-1.5">
            <p className="font-medium text-foreground/90 text-[11px]">ความปลอดภัย</p>
            <ul className="space-y-0.5 text-muted-foreground list-disc list-inside">
              <li>Webhook URL = ตัวยืนยันตัวตน ใครได้ไปก็ส่งเข้า channel ได้ → <span className="text-red-400">อย่าแชร์ในที่สาธารณะ</span></li>
              <li>ระบบเก็บ URL ใน <code className="text-foreground/70">localStorage</code> ของเบราว์เซอร์เท่านั้น — ไม่ส่งเข้าฐานข้อมูล</li>
              <li>ทุก request ส่งผ่าน <code className="text-foreground/70">/api/discord/notify</code> ฝั่ง server เพื่อหลีกเลี่ยง CORS และไม่เปิดเผย URL ใน Network tab ของผู้อื่น</li>
              <li>ถ้า URL หลุด → ไปที่ Discord channel → Integrations → Webhooks → กด <span className="text-red-400">Delete</span> แล้วสร้างใหม่</li>
            </ul>
          </div>

        </div>
      )}
    </div>
  );
}

function ErrorCard({ message }: { message: string }) {
  return (
    <Card size="sm" className="border-destructive/30 bg-destructive/5">
      <CardContent className="py-2 text-xs text-destructive">{message}</CardContent>
    </Card>
  );
}

function StatCard({ label, value, color = "", bg = "", size = "default" }: { label: string; value: string; color?: string; bg?: string; size?: string }) {
  return (
    <Card size="sm" className={bg}>
      <CardContent className={size === "sm" ? "pt-2 pb-2" : "pt-3"}>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className={`${size === "sm" ? "text-xs" : "text-sm"} font-semibold tabular-nums ${color}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

// ─── Indicator Panel ───────────────────────────────────────────
function IndicatorPanel({ indicators, klines }: { indicators: AllIndicators; klines: KlineData[] }) {
  const last = klines.length - 1;

  // Guard: when polling updates klines, indicators may be one render behind.
  // Skip rendering if indicator arrays don't cover the latest bar.
  if (last < 0 || indicators.rsi.length <= last) return null;

  const c = +klines[last].close;

  const rows: { name: string; value: string; signal: string; color: string }[] = [];

  const rsiVal = indicators.rsi[last];
  if (rsiVal != null) {
    const sig = rsiVal < 30 ? "ขายมากเกินไป (ซื้อ)" : rsiVal > 70 ? "ซื้อมากเกินไป (ขาย)" : "ปกติ";
    rows.push({ name: "RSI(14)", value: rsiVal.toFixed(2), signal: sig, color: rsiVal < 30 ? "text-emerald-500" : rsiVal > 70 ? "text-red-500" : "text-muted-foreground" });
  }

  const atrVal = indicators.atr[last];
  if (atrVal != null) rows.push({ name: "ATR(14)", value: fmtPrice(atrVal), signal: `ความผันผวน ${((atrVal / c) * 100).toFixed(2)}%`, color: "text-muted-foreground" });

  const obvVal = indicators.obv[last];
  if (obvVal != null) {
    const obvPrev = last > 0 ? (indicators.obv[last - 1] ?? obvVal) : obvVal;
    rows.push({ name: "OBV", value: fmtNum(obvVal), signal: obvVal > obvPrev ? "เพิ่มขึ้น" : "ลดลง", color: obvVal > obvPrev ? "text-emerald-500" : "text-red-500" });
  }

  const vwapVal = indicators.vwap[last];
  if (vwapVal != null) {
    rows.push({ name: "VWAP", value: fmtPrice(vwapVal), signal: c > vwapVal ? "อยู่เหนือ (ขาขึ้น)" : "อยู่ใต้ (ขาลง)", color: c > vwapVal ? "text-emerald-500" : "text-red-500" });
  }

  const st = indicators.supertrend;
  const stTrend = st.trend[last];
  const stValue = st.supertrend[last];
  if (stTrend != null && stValue != null) {
    const isUp = stTrend === 1;
    rows.push({
      name: "Supertrend",
      value: fmtPrice(stValue),
      signal: isUp ? "Uptrend (ขาขึ้น)" : "Downtrend (ขาลง)",
      color: isUp ? "text-emerald-500" : "text-red-500",
    });
  }

  const ub = indicators.utBot;
  const ubStop = ub.trailingStop[last];
  const ubPos = ub.pos[last];
  if (ubStop != null) {
    rows.push({
      name: "UT Bot",
      value: fmtPrice(ubStop),
      signal: ubPos === 1 ? "Long" : ubPos === -1 ? "Short" : "Neutral",
      color: ubPos === 1 ? "text-emerald-500" : ubPos === -1 ? "text-red-500" : "text-muted-foreground",
    });
  }

  return (
    <Card size="sm">
      <CardHeader className="border-b"><CardTitle>ค่าตัวชี้วัด (สรุป)</CardTitle></CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ตัวชี้วัด</TableHead>
              <TableHead>ค่า</TableHead>
              <TableHead>สัญญาณ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(r => (
              <TableRow key={r.name}>
                <TableCell className="font-medium">{r.name}</TableCell>
                <TableCell className="tabular-nums">{r.value}</TableCell>
                <TableCell className={r.color}>{r.signal}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// ─── Backtest Results ──────────────────────────────────────────
function BacktestResults({ result }: { result: BacktestResult }) {
  const [tradePage, setTradePage] = useState(0);
  const tradePageSize = 20;
  const totalTradePages = Math.ceil(result.trades.length / tradePageSize);
  const displayedTrades = result.trades.slice(tradePage * tradePageSize, (tradePage + 1) * tradePageSize);

  const strategyBetter = result.totalPnlPct > result.buyAndHoldPct;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="กำไร/ขาดทุนรวม" value={`${result.totalPnlPct >= 0 ? "+" : ""}${result.totalPnlPct.toFixed(2)}%`} color={pnlColor(result.totalPnlPct)} bg={pnlBg(result.totalPnlPct)} />
        <StatCard label="ซื้อแล้วถือ" value={`${result.buyAndHoldPct >= 0 ? "+" : ""}${result.buyAndHoldPct.toFixed(2)}%`} color={pnlColor(result.buyAndHoldPct)} bg={pnlBg(result.buyAndHoldPct)} />
        <StatCard label="อัตราชนะ" value={`${result.winRate.toFixed(1)}%`} color={result.winRate >= 50 ? "text-emerald-500" : "text-red-500"} />
        <StatCard label="จำนวนเทรด" value={`${result.totalTrades} (ชนะ:${result.wins} แพ้:${result.losses})`} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="กำไรเฉลี่ย" value={`+${result.avgWinPct.toFixed(2)}%`} color="text-emerald-500" size="sm" />
        <StatCard label="ขาดทุนเฉลี่ย" value={`${result.avgLossPct.toFixed(2)}%`} color="text-red-500" size="sm" />
        <StatCard label="เทรดที่ดีที่สุด" value={`+${result.bestTradePct.toFixed(2)}%`} color="text-emerald-500" size="sm" />
        <StatCard label="เทรดที่แย่ที่สุด" value={`${result.worstTradePct.toFixed(2)}%`} color="text-red-500" size="sm" />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-3">
        <StatCard label="Profit Factor" value={result.profitFactor === Infinity ? "INF" : result.profitFactor.toFixed(2)} color={result.profitFactor > 1 ? "text-emerald-500" : "text-red-500"} />
        <StatCard label="Drawdown สูงสุด" value={`-${result.maxDrawdownPct.toFixed(2)}%`} color="text-red-500" size="sm" />
        <StatCard label="Sharpe" value={result.sharpeRatio.toFixed(3)} color={result.sharpeRatio > 0 ? "text-emerald-500" : "text-red-500"} size="sm" />
      </div>

      <Card size="sm" className={strategyBetter ? "ring-emerald-500/30" : "ring-red-500/30"}>
        <CardContent className="py-3">
          <div className="flex items-center gap-3 text-xs">
            <span className={`text-sm font-semibold ${strategyBetter ? "text-emerald-500" : "text-red-500"}`}>
              {strategyBetter ? "กลยุทธ์ชนะ ซื้อแล้วถือ" : "ซื้อแล้วถือ ชนะกลยุทธ์"}
            </span>
            <span className="text-muted-foreground">
              กลยุทธ์: {result.totalPnlPct >= 0 ? "+" : ""}{result.totalPnlPct.toFixed(2)}% vs ซื้อถือ: {result.buyAndHoldPct >= 0 ? "+" : ""}{result.buyAndHoldPct.toFixed(2)}%
              (ต่าง {strategyBetter ? "+" : ""}{(result.totalPnlPct - result.buyAndHoldPct).toFixed(2)}%)
            </span>
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader className="border-b">
          <div className="flex items-center justify-between">
            <CardTitle>กราฟเงินทุน (กำไร/ขาดทุนสะสม %)</CardTitle>
            <span className={`text-lg font-bold tabular-nums ${pnlColor(result.totalPnlPct)}`}>
              กำไรรวม: {result.totalPnlPct >= 0 ? "+" : ""}{result.totalPnlPct.toFixed(2)}%
            </span>
          </div>
        </CardHeader>
        <CardContent className="pt-3">
          <EquityChart curve={result.equityCurve} trades={result.trades} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {result.trades.map((t, i) => (
              <span
                key={i}
                className={`inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-medium tabular-nums ${t.pnlPct >= 0
                  ? "bg-emerald-500/10 text-emerald-500"
                  : "bg-red-500/10 text-red-500"
                  }`}
              >
                #{i + 1} {t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(2)}%
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader className="border-b">
          <CardTitle>ประวัติการเทรด</CardTitle>
          <CardDescription>ทั้งหมด {result.trades.length} รายการ</CardDescription>
          {totalTradePages > 1 && (
            <CardAction>
              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="xs" onClick={() => setTradePage(p => Math.max(0, p - 1))} disabled={tradePage === 0}>ก่อนหน้า</Button>
                <span className="text-[10px] tabular-nums text-muted-foreground">{tradePage + 1}/{totalTradePages}</span>
                <Button variant="outline" size="xs" onClick={() => setTradePage(p => Math.min(totalTradePages - 1, p + 1))} disabled={tradePage >= totalTradePages - 1}>ถัดไป</Button>
              </div>
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>เวลาเข้า</TableHead>
                <TableHead className="text-right">ราคาเข้า</TableHead>
                <TableHead>เวลาออก</TableHead>
                <TableHead className="text-right">ราคาออก</TableHead>
                <TableHead className="text-right">กำไร/ขาดทุน %</TableHead>
                <TableHead className="text-right">แท่ง</TableHead>
                <TableHead>เหตุผล</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {displayedTrades.map((t, i) => (
                <TableRow key={i} className={t.pnlPct > 0 ? "bg-emerald-500/[0.03]" : t.pnlPct < 0 ? "bg-red-500/[0.03]" : ""}>
                  <TableCell className="text-muted-foreground tabular-nums">{tradePage * tradePageSize + i + 1}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(t.entryTime)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPrice(t.entryPrice)}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(t.exitTime)}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPrice(t.exitPrice)}</TableCell>
                  <TableCell className={`text-right tabular-nums font-medium ${pnlColor(t.pnlPct)}`}>
                    {t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(2)}%
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{t.bars}</TableCell>
                  <TableCell className="text-[10px] text-muted-foreground max-w-40 truncate">{t.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Kline Table ───────────────────────────────────────────────
function KlineTable({ klines, loading, signals }: { klines: KlineData[]; loading: boolean; signals?: SignalAction[] }) {
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const totalPages = Math.ceil(klines.length / pageSize);
  useEffect(() => { setPage(0); }, [klines]);

  const reversed = useMemo(() => klines.slice().reverse(), [klines]);
  const reversedSignals = useMemo(() => signals?.slice().reverse(), [signals]);
  const displayed = reversed.slice(page * pageSize, (page + 1) * pageSize);
  const displayedSigs = reversedSignals?.slice(page * pageSize, (page + 1) * pageSize);

  if (loading && klines.length === 0) {
    return (
      <Card size="sm">
        <CardContent className="space-y-2 py-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}
        </CardContent>
      </Card>
    );
  }
  if (klines.length === 0) {
    return (
      <Card size="sm">
        <CardContent className="py-12 text-center text-xs text-muted-foreground">
          ยังไม่มีข้อมูล — กดโหลดข้อมูลก่อน หรือเริ่มโหมด Real-time
        </CardContent>
      </Card>
    );
  }

  return (
    <Card size="sm">
      <CardHeader className="border-b">
        <CardTitle>ข้อมูลแท่งเทียน</CardTitle>
        <CardDescription>{klines.length.toLocaleString()} แท่ง — {fmtFullDate(klines[0].openTime)} ถึง {fmtFullDate(klines[klines.length - 1].closeTime)}</CardDescription>
        <CardAction>
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="xs" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>ก่อนหน้า</Button>
            <span className="text-[10px] tabular-nums text-muted-foreground">{page + 1}/{totalPages}</span>
            <Button variant="outline" size="xs" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>ถัดไป</Button>
          </div>
        </CardAction>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">#</TableHead>
              <TableHead>เวลาเปิด</TableHead>
              <TableHead className="w-6"></TableHead>
              <TableHead className="text-right">เปิด</TableHead>
              <TableHead className="text-right">สูงสุด</TableHead>
              <TableHead className="text-right">ต่ำสุด</TableHead>
              <TableHead className="text-right">ปิด</TableHead>
              <TableHead className="text-right">เปลี่ยนแปลง</TableHead>
              <TableHead className="text-right">ปริมาณ</TableHead>
              {signals && <TableHead className="text-center">สัญญาณ</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayed.map((k, i) => {
              const isUp = +k.close >= +k.open;
              const pct = ((+k.close - +k.open) / +k.open) * 100;
              const sig = displayedSigs?.[i];
              return (
                <TableRow key={k.openTime} className={sig === "BUY" ? "bg-emerald-500/[0.04]" : sig === "SELL" ? "bg-red-500/[0.04]" : ""}>
                  <TableCell className="text-muted-foreground tabular-nums">{klines.length - (page * pageSize + i)}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(k.openTime)}</TableCell>
                  <TableCell><MiniCandle kline={k} /></TableCell>
                  <TableCell className="text-right tabular-nums">{fmtPrice(k.open)}</TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-500/80">{fmtPrice(k.high)}</TableCell>
                  <TableCell className="text-right tabular-nums text-red-500/80">{fmtPrice(k.low)}</TableCell>
                  <TableCell className={`text-right tabular-nums font-medium ${isUp ? "text-emerald-500" : "text-red-500"}`}>{fmtPrice(k.close)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${pct >= 0 ? "text-emerald-500" : "text-red-500"}`}>{pct >= 0 ? "+" : ""}{pct.toFixed(2)}%</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{fmtNum(k.volume)}</TableCell>
                  {signals && (
                    <TableCell className="text-center">
                      {sig === "BUY" && <Badge variant="outline" className="text-[9px] text-emerald-500 border-emerald-500/30">BUY</Badge>}
                      {sig === "SELL" && <Badge variant="outline" className="text-[9px] text-red-500 border-red-500/30">SELL</Badge>}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </CardContent>
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t px-4 py-2">
          <span className="text-[10px] text-muted-foreground">
            {page * pageSize + 1}-{Math.min((page + 1) * pageSize, klines.length)} of {klines.length.toLocaleString()}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="xs" onClick={() => setPage(0)} disabled={page === 0}>แรก</Button>
            <Button variant="outline" size="xs" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>ก่อนหน้า</Button>
            <Button variant="outline" size="xs" onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}>ถัดไป</Button>
            <Button variant="outline" size="xs" onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}>สุดท้าย</Button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════
// Watcher Components (multi-symbol Discord alerts)
// ═══════════════════════════════════════════════════════════════

// ─── Mini sparkline (last N close prices) ─────────────────────
function MiniSparkline({ values, width = 100, height = 28 }: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length < 2) {
    return <div style={{ width, height }} className="rounded bg-muted/30" />;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = width / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / range) * height).toFixed(1)}`)
    .join(" ");
  const isUp = values[values.length - 1] >= values[0];
  const stroke = isUp ? "#10b981" : "#ef4444";
  const fill = isUp ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)";
  // Area polygon
  const areaPoints = `0,${height} ${points} ${width},${height}`;
  return (
    <svg width={width} height={height} className="block">
      <polygon fill={fill} points={areaPoints} />
      <polyline fill="none" stroke={stroke} strokeWidth="1.5" points={points} />
    </svg>
  );
}

// ─── Rate Limit Info Panel ────────────────────────────────────
function RateLimitInfo({ watchers, pollingMap }: {
  watchers: WatcherConfig[];
  pollingMap: Record<string, boolean>;
}) {
  const active = watchers.filter(w => pollingMap[w.id]);
  if (active.length === 0) {
    return (
      <div className="rounded border border-border/40 bg-muted/20 p-2 text-[10px] text-muted-foreground">
        💤 ยังไม่มี watcher ที่กำลังทำงาน — กดปุ่ม ▶ ใน watcher ใดสักตัวเพื่อเริ่ม
      </div>
    );
  }

  // Binance request weight per minute
  let totalWeight = 0;
  let totalReq = 0;
  for (const w of active) {
    const reqPerMin = 60 / Math.max(1, w.pollSeconds);
    totalReq += reqPerMin;
    totalWeight += reqPerMin * binanceKlineWeight(w.klineLimit);
  }

  // Discord messages per channel — worst case = once per poll if every bar triggers signal
  // realistic case = ~few per hour. We show "max possible" rate.
  const perChannel = new Map<string, number>();
  for (const w of active.filter(w => w.alertsEnabled)) {
    const key = w.useEnvWebhook ? "ENV" : (w.webhookUrl || "(empty)");
    const reqPerMin = 60 / Math.max(1, w.pollSeconds);
    perChannel.set(key, (perChannel.get(key) ?? 0) + reqPerMin);
  }

  const binanceSafe = totalWeight < 100;
  const binanceWarn = totalWeight >= 100 && totalWeight < 400;
  const binanceDanger = totalWeight >= 400;
  const maxChannelRate = perChannel.size > 0 ? Math.max(...Array.from(perChannel.values())) : 0;
  const discordSafe = maxChannelRate < 20;
  const discordDanger = maxChannelRate >= 30;

  return (
    <div className="rounded-md border border-border/50 bg-muted/10 p-3 space-y-2 text-[11px]">
      <p className="font-semibold text-foreground/90">📊 Rate Limit Status ({active.length} watcher ทำงาน)</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {/* Binance */}
        <div className={`rounded border p-2 ${binanceDanger ? "border-red-500/40 bg-red-500/5" : binanceWarn ? "border-amber-500/40 bg-amber-500/5" : "border-emerald-500/40 bg-emerald-500/5"}`}>
          <div className="flex items-center justify-between">
            <span className="font-medium">Binance API</span>
            <span className={binanceDanger ? "text-red-500" : binanceWarn ? "text-amber-500" : "text-emerald-500"}>
              {binanceSafe ? "✓ ปลอดภัย" : binanceWarn ? "⚠ ระวัง" : "🚫 อันตราย"}
            </span>
          </div>
          <p className="tabular-nums">
            ~{totalReq.toFixed(1)} req/min — weight {totalWeight.toFixed(1)} / 1200 ต่อนาที
          </p>
          <p className="text-[9px] text-muted-foreground">
            จำกัด: 1200 weight/นาที (ทุก endpoint รวมกัน)
          </p>
        </div>

        {/* Discord */}
        <div className={`rounded border p-2 ${discordDanger ? "border-red-500/40 bg-red-500/5" : !discordSafe ? "border-amber-500/40 bg-amber-500/5" : "border-emerald-500/40 bg-emerald-500/5"}`}>
          <div className="flex items-center justify-between">
            <span className="font-medium">Discord Webhook</span>
            <span className={discordDanger ? "text-red-500" : !discordSafe ? "text-amber-500" : "text-emerald-500"}>
              {discordSafe ? "✓ ปลอดภัย" : discordDanger ? "🚫 อันตราย" : "⚠ ระวัง"}
            </span>
          </div>
          <p className="tabular-nums">
            สูงสุด {maxChannelRate.toFixed(1)} msg/min ต่อ channel ({perChannel.size} channel)
          </p>
          <p className="text-[9px] text-muted-foreground">
            จำกัด: ~30 msg/นาที ต่อ channel
          </p>
        </div>
      </div>

      {!binanceSafe && (
        <p className="text-[10px] text-amber-500/90">
          💡 แนะนำ: เพิ่ม Polling interval หรือลดจำนวน watchers — เช่น 5 watchers ที่ poll ทุก 30s = {(5 * 2).toFixed(0)} req/min (ปลอดภัย)
        </p>
      )}
    </div>
  );
}

// ─── Watcher Row (one self-contained polling unit) ────────────
function WatcherRow({ config, onUpdate, onRemove, onPollingChange, onAlert }: {
  config: WatcherConfig;
  onUpdate: (patch: Partial<WatcherConfig>) => void;
  onRemove: () => void;
  onPollingChange: (polling: boolean) => void;
  onAlert: (alert: DiscordAlert) => void;
}) {
  const [klines, setKlines] = useState<KlineData[]>([]);
  const [polling, setPolling] = useState(false);
  const [lastPolledAt, setLastPolledAt] = useState<Date | null>(null);
  const [tickSeconds, setTickSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [lastSignal, setLastSignal] = useState<"BUY" | "SELL" | null>(null);

  const lastAlertBarRef = useRef<number>(0);
  const lastBuyRef = useRef<{ price: number; time: number } | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cfgRef = useRef(config);

  // Keep cfgRef updated so pollTick reads latest config
  useEffect(() => { cfgRef.current = config; }, [config]);

  // Report polling state up
  useEffect(() => { onPollingChange(polling); }, [polling, onPollingChange]);

  const activeSymbol = (config.customSymbol.trim().toUpperCase()) || config.symbol;
  const sparkline = useMemo(() => klines.slice(-50).map(k => +k.close), [klines]);

  // ─── Send Discord (per-watcher) ───────────────────────────
  const send = useCallback(async (payload: {
    content?: string;
    embeds?: unknown[];
    username?: string;
  }): Promise<{ ok: boolean; message?: string }> => {
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

  // ─── Test webhook ─────────────────────────────────────────
  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestMsg(null);
    const result = await send({
      username: "Crypto Bot Test",
      content: `🔔 ทดสอบ Webhook สำหรับ ${activeSymbol} (${config.interval})`,
    });
    setTestMsg(result.ok ? "✓ ส่งทดสอบสำเร็จ" : `✗ ${result.message}`);
    setTesting(false);
    setTimeout(() => setTestMsg(null), 4000);
  }, [send, activeSymbol, config.interval]);

  // ─── Send signal alert ────────────────────────────────────
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
      { name: "ราคา", value: fmtPrice(price), inline: true },
      { name: "Open", value: fmtPrice(bar.open), inline: true },
      { name: "High", value: fmtPrice(bar.high), inline: true },
      { name: "Low", value: fmtPrice(bar.low), inline: true },
      { name: "Volume", value: fmtNum(bar.volume), inline: true },
      { name: "เวลาแท่ง", value: fmtFullDate(bar.openTime), inline: false },
    ];

    if (!isBuy) {
      const pnlStr = pnlPct != null ? `${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%` : "-";
      const pnlEmoji = pnlPct == null ? "⚪" : pnlPct >= 0 ? "🟢" : "🔴";
      fields.push(
        { name: "─── อ้างอิงราคา BUY ก่อนหน้า ───", value: "​", inline: false },
        { name: "🟢 ราคา BUY", value: entryPrice != null ? fmtPrice(entryPrice) : "-", inline: true },
        { name: "🕒 เวลา BUY", value: entryTime != null ? fmtFullDate(entryTime) : "-", inline: true },
        { name: `${pnlEmoji} กำไร/ขาดทุน`, value: pnlStr, inline: true },
      );
    }

    const result = await send({
      username: "Crypto Signal Bot",
      embeds: [{
        title: `${emoji} ${action} Signal — ${sym}`,
        description: `**กลยุทธ์:** ${strategyName}\n**Timeframe:** ${intv}`,
        color,
        fields,
        timestamp: new Date().toISOString(),
        footer: { text: `${sym} • ${intv} • Crypto Indicator Bot` },
      }],
    });

    if (isBuy) lastBuyRef.current = { price, time: bar.openTime };
    else lastBuyRef.current = null;

    setLastSignal(action);

    onAlert({
      id: `${bar.openTime}-${action}-${Date.now()}`,
      time: Date.now(),
      symbol: sym,
      interval: intv,
      strategyName,
      action,
      price,
      barOpenTime: bar.openTime,
      status: result.ok ? "ok" : "error",
      message: result.message,
      entryPrice,
      entryTime,
      pnlPct,
    });
  }, [send, onAlert]);

  // ─── Polling tick ─────────────────────────────────────────
  const pollTick = useCallback(async () => {
    const c = cfgRef.current;
    const sym = (c.customSymbol.trim().toUpperCase()) || c.symbol;
    try {
      const params = new URLSearchParams({
        symbol: sym,
        interval: c.interval,
        limit: String(c.klineLimit),
      });
      const res = await fetch(`/api/klines?${params}`);
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
            sendSignal(sig, bar, strat?.name ?? c.strategyId, sym, c.interval);
          }
        }
      }
    } catch (err) {
      setError(`Polling error: ${String(err)}`);
    }
  }, [sendSignal]);

  // ─── Polling loop ─────────────────────────────────────────
  useEffect(() => {
    if (!polling) {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      return;
    }
    let cancelled = false;
    const runLoop = async () => {
      await pollTick();
      if (cancelled) return;
      const delay = Math.max(3, cfgRef.current.pollSeconds) * 1000;
      pollTimerRef.current = setTimeout(runLoop, delay);
    };
    runLoop();
    return () => {
      cancelled = true;
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current);
        pollTimerRef.current = null;
      }
    };
  }, [polling, pollTick]);

  // ─── Tick counter (1s, resets on each poll) ───────────────
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
    setError(null);
    if (klines.length > 0) {
      lastAlertBarRef.current = klines[klines.length - 1].openTime;
    }
    lastBuyRef.current = null;
    setPolling(true);
  };

  const remaining = Math.max(0, config.pollSeconds - tickSeconds);
  const progressPct = Math.min(100, (tickSeconds / Math.max(1, config.pollSeconds)) * 100);

  return (
    <div className={`rounded-md border ${polling ? "border-emerald-500/40 bg-emerald-500/5" : "border-border/50 bg-muted/10"} overflow-hidden`}>
      {/* Compact row */}
      <div className="flex flex-wrap items-center gap-3 p-3">
        {/* Symbol + TF */}
        <div className="flex flex-col min-w-[140px]">
          <span className="font-semibold text-sm">{activeSymbol}</span>
          <span className="text-[14px] text-muted-foreground">TF: {config.interval}</span>
        </div>

        {/* Strategy */}
        <div className="flex flex-col min-w-[120px]">
          <span className="text-[14px] text-muted-foreground uppercase tracking-wider">กลยุทธ์</span>
          <span className="text-[13px] font-medium">{STRATEGIES.find(s => s.id === config.strategyId)?.name ?? config.strategyId}</span>
        </div>

        {/* Poll interval */}
        <div className="flex flex-col min-w-[80px]">
          <span className="text-[14px] text-muted-foreground uppercase tracking-wider">Polling</span>
          <span className="text-[13px] font-medium tabular-nums">
            {config.pollSeconds < 60 ? `${config.pollSeconds}s` : config.pollSeconds < 3600 ? `${(config.pollSeconds / 60).toFixed(0)}m` : `${(config.pollSeconds / 3600).toFixed(0)}h`}
          </span>
        </div>

        {/* Mini chart */}
        <div className="flex flex-col items-center">
          <span className="text-[13px] text-muted-foreground">Last {sparkline.length} bars</span>
          <MiniSparkline values={sparkline} />
        </div>

        {/* Last price + signal */}
        <div className="flex flex-col min-w-[100px]">
          <span className="text-[13px] text-muted-foreground">ราคาล่าสุด</span>
          {klines.length > 0 ? (
            <span className="text-[12px] font-semibold tabular-nums">{fmtPrice(klines[klines.length - 1].close)}</span>
          ) : (
            <span className="text-[13px] text-muted-foreground">—</span>
          )}
          {lastSignal && (
            <Badge variant="outline" className={`text-[13px] mt-0.5 ${lastSignal === "BUY" ? "text-emerald-500 border-emerald-500/30" : "text-red-500 border-red-500/30"}`}>
              ล่าสุด: {lastSignal}
            </Badge>
          )}
        </div>

        {/* Status + countdown */}
        <div className="flex flex-col min-w-[120px]">
          {polling ? (
            <>
              <span className="text-[13px] text-emerald-500 animate-pulse">● LIVE</span>
              <span className="text-[13px] tabular-nums text-muted-foreground">
                {tickSeconds}s / {config.pollSeconds}s ({remaining}s left)
              </span>
              <div className="h-1 w-full rounded-full bg-muted overflow-hidden mt-0.5">
                <div className="h-full bg-emerald-500 transition-all duration-1000 ease-linear" style={{ width: `${progressPct}%` }} />
              </div>
            </>
          ) : (
            <span className="text-[13px] text-muted-foreground">○ ปิดอยู่</span>
          )}
        </div>

        {/* Actions */}
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
          <Button size="sm" variant="outline" className="text-red-500 border-red-500/30 hover:bg-red-500/10" onClick={onRemove}>
            ✕
          </Button>
        </div>
      </div>

      {error && (
        <div className="px-3 pb-2">
          <p className="text-[13px] text-red-500">{error}</p>
        </div>
      )}

      {/* Expanded edit panel */}
      {expanded && (
        <div className="border-t border-border/40 bg-background/40 p-3 space-y-3">
          {/* Symbol + TF + Strategy + Poll */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label="คู่เหรียญ">
              <Select value={config.symbol} onValueChange={(v) => { if (v) onUpdate({ symbol: v, customSymbol: "" }); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>ยอดนิยม</SelectLabel>
                    {POPULAR_SYMBOLS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field label="กำหนดเอง">
              <Input
                placeholder="เช่น PEPEUSDT"
                value={config.customSymbol}
                onChange={e => onUpdate({ customSymbol: e.target.value })}
              />
            </Field>
            <Field label="ช่วงเวลา">
              <Select value={config.interval} onValueChange={(v) => { if (v) onUpdate({ interval: v as Interval }); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(INTERVAL_GROUPS).map(([g, ints]) => (
                    <SelectGroup key={g}><SelectLabel>{g}</SelectLabel>
                      {ints.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Polling ทุก">
              <Select value={String(config.pollSeconds)} onValueChange={v => { if (v) onUpdate({ pollSeconds: parseInt(v, 10) || 30 }); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {POLL_OPTIONS.map(o => <SelectItem key={o.value} value={String(o.value)}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {/* Strategy */}
          <Field label="กลยุทธ์ (Indicator)">
            <Select
              value={config.strategyId}
              onValueChange={(v) => {
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

          {/* Webhook */}
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
            <p className={`text-[10px] ${testMsg.startsWith("✓") ? "text-emerald-500" : "text-red-500"}`}>
              {testMsg}
            </p>
          )}

          {/* Toggles */}
          <div className="flex flex-wrap items-center gap-3">
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
            <Field label="จำนวนแท่งเทียน">
              <Select value={String(config.klineLimit)} onValueChange={v => { if (v) onUpdate({ klineLimit: parseInt(v, 10) || 200 }); }}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[50, 100, 200, 500, 1000].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {lastPolledAt && (
            <p className="text-[10px] text-muted-foreground">
              อัพเดทล่าสุด: {lastPolledAt.toLocaleTimeString()} | klines โหลด: {klines.length}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
