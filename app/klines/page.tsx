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

const PARAM_LABELS: Record<string, string> = {
  period: "RSI Period",
  buyThreshold: "ซื้อเมื่อ RSI <",
  sellThreshold: "ขายเมื่อ RSI >",
  fastPeriod: "Fast EMA",
  slowPeriod: "Slow EMA",
  swingSize: "Swing Size",
  internalSize: "Internal Size",
  fastLength: "Fast EMA",
  slowLength: "Slow EMA",
  signalLength: "Signal SMA",
  atrPeriod: "ATR Period",
  multiplier: "ATR Multiplier",
  bbLength: "BB Length",
  bbMult: "BB MultFactor",
  kcLength: "KC Length",
  kcMult: "KC MultFactor",
  zigzagLen: "ZigZag Length",
  fibFactor: "Fib Factor",
  leftBars: "Left Bars",
  rightBars: "Right Bars",
  volumeThresh: "Volume Threshold",
  trendLength: "Swing Lookback",
  trendMult: "Slope Mult",
  keyValue: "Key Value",
  utAtrPeriod: "ATR Period",
};

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

// ─── Strategy Description with colored Buy/Sell ───────────────
function StrategyDesc({ text }: { text: string }) {
  const parts = text.split(/(Buy|Sell|ซื้อ|ขาย)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part === "Buy" || part === "ซื้อ") return <span key={i} className="text-emerald-500 font-medium">{part}</span>;
        if (part === "Sell" || part === "ขาย") return <span key={i} className="text-red-500 font-medium">{part}</span>;
        return <span key={i}>{part}</span>;
      })}
    </>
  );
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

// ─── Equity Chart (pure CSS bars) ──────────────────────────────
function EquityChart({ curve, trades }: { curve: number[]; trades: Trade[] }) {
  const step = Math.max(1, Math.floor(curve.length / 200));
  const sampled = curve.filter((_, i) => i % step === 0 || i === curve.length - 1);
  const max = Math.max(...sampled, 0.01);
  const min = Math.min(...sampled, -0.01);
  const range = max - min || 1;
  const zeroY = ((max - 0) / range) * 100;

  // Map trade exit indices to sampled bar indices
  const tradeMarkers: { barIdx: number; pnlPct: number }[] = [];
  for (const t of trades) {
    const sampledIdx = Math.round(t.exitIdx / step);
    const clampedIdx = Math.min(sampledIdx, sampled.length - 1);
    tradeMarkers.push({ barIdx: clampedIdx, pnlPct: t.pnlPct });
  }

  // Group markers by barIdx (multiple trades may map to same sampled bar)
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
                <div
                  className="w-full bg-emerald-500/60 absolute"
                  style={{ bottom: `${100 - zeroY}%`, height: `${Math.max(h, 0.5)}%` }}
                />
              ) : (
                <div
                  className="w-full bg-red-500/60 absolute"
                  style={{ top: `${zeroY}%`, height: `${Math.max(h, 0.5)}%` }}
                />
              )}
              {markers && (
                <>
                  {/* Trade marker dot */}
                  <div
                    className={`absolute w-1.5 h-1.5 rounded-full left-1/2 -translate-x-1/2 z-10 ${markers[markers.length - 1] >= 0 ? "bg-emerald-400" : "bg-red-400"}`}
                    style={{
                      top: isPos
                        ? `${zeroY - (val / range) * 100 - 2}%`
                        : `${zeroY + (Math.abs(val) / range) * 100}%`,
                    }}
                  />
                  {/* Tooltip on hover */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block z-20 pointer-events-none">
                    <div className="bg-popover border border-border rounded px-1.5 py-0.5 shadow-md whitespace-nowrap">
                      {markers.map((pnl, mi) => (
                        <div key={mi} className={`text-[9px] font-medium tabular-nums ${pnl >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                          {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}%
                        </div>
                      ))}
                      <div className="text-[8px] text-muted-foreground tabular-nums">สะสม: {val >= 0 ? "+" : ""}{val.toFixed(2)}%</div>
                    </div>
                  </div>
                </>
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

// ═══════════════════════════════════════════════════════════════
// Main Page
// ═══════════════════════════════════════════════════════════════
export default function KlinesPage() {
  // Data state
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
  const [backtestProgress, setBacktestProgress] = useState<{ current: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Indicator state
  const [indicators, setIndicators] = useState<AllIndicators | null>(null);

  // Backtest state
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

  // dataShowUI state
  const [csvFiles, setCsvFiles] = useState<string[]>([]);
  const [csvLoading, setCsvLoading] = useState(false);

  const activeSymbol = customSymbol.trim().toUpperCase() || symbol;

  // Fetch available CSV files on mount
  useEffect(() => {
    fetch("/api/dataShowUI")
      .then(res => res.json())
      .then((files: string[]) => setCsvFiles(Array.isArray(files) ? files : []))
      .catch(() => setCsvFiles([]));
  }, []);

  // Load CSV file into klines
  const loadCsvFile = useCallback(async (filename: string) => {
    setCsvLoading(true);
    setError(null);
    setKlines([]);
    setIndicators(null);
    setBtResult(null);
    setAllBtResults(null);
    setBacktestProgress(null);
    try {
      const res = await fetch(`/api/dataShowUI?file=${encodeURIComponent(filename)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const lines = text.trim().split("\n");
      // skip header
      const data: KlineData[] = lines.slice(1).map(line => {
        const cols = line.split(",");
        return {
          openTime: new Date(cols[0]).getTime(),
          open: cols[1],
          high: cols[2],
          low: cols[3],
          close: cols[4],
          volume: cols[5],
          closeTime: new Date(cols[6]).getTime(),
          quoteAssetVolume: cols[7],
          numberOfTrades: parseInt(cols[8], 10),
          takerBuyBaseVolume: cols[9],
          takerBuyQuoteVolume: cols[10],
        };
      });
      setKlines(data);
      setLastFetch(new Date());
    } catch (err) { setError(String(err)); }
    finally { setCsvLoading(false); }
  }, []);

  // Compute indicators when klines change
  useEffect(() => {
    if (klines.length >= 15) {
      setIndicators(computeAll(klines));
    } else {
      setIndicators(null);
    }
  }, [klines]);

  // ─── Fetch Real-time ────────────────────────────────────────
  const fetchRealtime = useCallback(async () => {
    setLoading(true);
    setError(null);
    setKlines([]);
    setIndicators(null);
    setBtResult(null);
    setAllBtResults(null);
    setBacktestProgress(null);
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

  // ─── Download (ตาม mode: Realtime หรือ Historical) ──────────
  const downloadRealtime = useCallback(async () => {
    setLoading(true);
    setError(null);
    setKlines([]);
    setIndicators(null);
    setBtResult(null);
    setAllBtResults(null);
    setBacktestProgress(startTime ? { current: 0 } : null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      let all: KlineData[] = [];

      if (startTime) {
        // ── Historical mode: ดึงข้อมูลย้อนหลัง ──
        const st = new Date(startTime).getTime();
        const et = endTime ? new Date(endTime).getTime() : Date.now();
        let cur = st;
        while (cur < et) {
          if (controller.signal.aborted) break;
          setBacktestProgress({ current: all.length });
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
      } else {
        // ── Realtime mode: ดึงข้อมูลล่าสุดตาม limit ──
        const params = new URLSearchParams({ symbol: activeSymbol, interval, limit });
        const res = await fetch(`/api/klines?${params}`, { signal: controller.signal });
        if (!res.ok) { const b = await res.json(); throw new Error(b.error || `HTTP ${res.status}`); }
        const raw: BinanceKlineRaw[] = await res.json();
        all = raw.map(parseKline);
      }

      // ── set klines ให้ UI แสดงผล ──
      setKlines(all);
      setLastFetch(new Date());

      // ── สร้าง CSV และดาวน์โหลด ──
      const header = "OpenTime,Open,High,Low,Close,Volume,CloseTime,QuoteAssetVolume,NumberOfTrades,TakerBuyBaseVolume,TakerBuyQuoteVolume";
      const rows = all.map(k =>
        `${new Date(k.openTime).toISOString()},${k.open},${k.high},${k.low},${k.close},${k.volume},${new Date(k.closeTime).toISOString()},${k.quoteAssetVolume},${k.numberOfTrades},${k.takerBuyBaseVolume},${k.takerBuyQuoteVolume}`
      );
      const csv = [header, ...rows].join("\n");

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const suffix = startTime ? "historical" : "realtime";
      a.download = `${activeSymbol}_${interval}_${all.length}_${suffix}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (!controller.signal.aborted) setError(String(err));
    } finally {
      setLoading(false); setBacktestProgress(null); abortRef.current = null;
    }
  }, [activeSymbol, interval, limit, startTime, endTime]);

  // ─── Fetch Historical ──────────────────────────────────────
  const fetchHistorical = useCallback(async () => {
    if (!startTime) { setError("กรุณาระบุเวลาเริ่มต้น"); return; }
    setLoading(true); setError(null); setKlines([]); setIndicators(null); setBtResult(null); setAllBtResults(null);
    setBacktestProgress({ current: 0 });
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const st = new Date(startTime).getTime();
      const et = endTime ? new Date(endTime).getTime() : Date.now();
      let cur = st;
      const all: KlineData[] = [];
      while (cur < et) {
        if (controller.signal.aborted) break;
        setBacktestProgress({ current: all.length });
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
      setLoading(false); setBacktestProgress(null); abortRef.current = null;
    }
  }, [activeSymbol, interval, startTime, endTime]);

  // ─── Run Backtest ───────────────────────────────────────────
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

  // Summary stats
  const summary = useMemo(() => {
    if (klines.length === 0) return null;
    const c = klines.map(k => +k.close);
    const h = klines.map(k => +k.high);
    const l = klines.map(k => +k.low);
    const v = klines.map(k => +k.volume);
    return {
      lastClose: c[c.length - 1],
      pctChange: ((c[c.length - 1] - c[0]) / c[0]) * 100,
      highest: Math.max(...h),
      lowest: Math.min(...l),
      totalVol: v.reduce((a, b) => a + b, 0),
      avgVol: v.reduce((a, b) => a + b, 0) / v.length,
    };
  }, [klines]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-[1400px] px-4 py-6 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Binance Klines & Backtest</h1>
              <p className="text-xs text-muted-foreground">ตัวชี้วัดการเทรด + ทดสอบกลยุทธ์ย้อนหลังพร้อมกำไร/ขาดทุน</p>
            </div>
            <Button variant="outline" size="sm" className="border border-yellow-500/30 bg-yellow-500/10 text-[11px] font-medium text-yellow-500 hover:bg-yellow-500/20">
              <Link href="/trading/Binance">Binance Trading</Link>
            </Button>
          </div>

          <div className="flex items-center gap-2">
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

        {/* ═══ CONFIG ═══ */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_650px]">
          <Card size="sm">
            <CardHeader>
              <CardTitle>ตั้งค่า</CardTitle>
              <CardDescription>เลือกคู่เหรียญและช่วงเวลา แล้วดึงข้อมูลแบบเรียลไทม์หรือย้อนหลัง</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Shared: Symbol / Custom / Interval */}
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
                <Field label="">
                  <p className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">กำหนดเอง</p>
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
            <CardHeader><CardTitle>ดึงข้อมูล</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {/* Real-time fetch */}
              <div className="space-y-2">
                <div className="flex items-end gap-2">
                  <Field label="ดึงข้อมูลเรียลไทม์ จำนวนแท่งเทียน">
                    <Select value={limit} onValueChange={(v) => { if (v) setLimit(v); }}>
                      <SelectTrigger className="w-42"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["50", "100", "200", "500", "1000"].map(l => <SelectItem key={l} value={l}>{l}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Button onClick={fetchRealtime} disabled={loading} className="h-9">
                    {loading ? "กำลังดึง..." : "ดึงข้อมูลล่าสุด"}
                  </Button>

                  <Field label="ดาวโหลดไฟล์ ข้อมูลเรียลไทม์ จำนวนแท่งเทียน">
                    <Button onClick={downloadRealtime} disabled={loading} className="h-9">
                      {loading ? "กำลังดาวโหลด..." : "ดาวโหลดไฟล์"}
                    </Button>
                  </Field>

                </div>
              </div>

              <Separator />

              {/* Historical fetch */}
              <div className="space-y-2">
                <div className="flex flex-wrap items-end gap-2">
                  <Field label="ข้อมูลย้อนหลัง เริ่มต้น">
                    <Input type="datetime-local" value={startTime} onChange={e => setStartTime(e.target.value)} className="w-44 ml-1" />
                  </Field>
                  <Field label="สิ้นสุด">
                    <Input type="datetime-local" value={endTime} onChange={e => setEndTime(e.target.value)} className="w-44 ml-1" />
                  </Field>
                  <Button onClick={fetchHistorical} disabled={loading} className="h-9">
                    {loading ? "กำลังดึง..." : "ดึงข้อมูลย้อนหลัง"}
                  </Button>
                  {loading && (
                    <Button variant="destructive" size="sm" onClick={() => abortRef.current?.abort()}>ยกเลิก</Button>
                  )}
                </div>
                {backtestProgress && (
                  <span className="text-[10px] text-muted-foreground animate-pulse">
                    {backtestProgress.current.toLocaleString()} แท่งเทียน...
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ═══ dataShowUI: Load from saved CSV files ═══ */}
        {csvFiles.length > 0 && (
          <Card size="sm">
            <CardHeader>
              <CardTitle>โหลดข้อมูลจากไฟล์ที่บันทึกไว้ ({csvFiles.length} ไฟล์)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5">
                {csvFiles.map(f => {
                  const label = f.replace("_historical_realtime.csv", "").replace(/_/g, " ");
                  return (
                    <Button
                      key={f}
                      variant="outline"
                      size="sm"
                      className="text-[11px] h-8 px-3"
                      disabled={csvLoading || loading}
                      onClick={() => loadCsvFile(f)}
                    >
                      {csvLoading ? "กำลังโหลด..." : label}
                    </Button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Error */}
        {error && <ErrorCard message={error} />}

        {/* Price Chart (lightweight-charts) */}
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
                  {/* Summary table */}
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
                                      {/* Strategy description */}
                                      {(() => {
                                        const strat = STRATEGIES.find(s => s.id === item.strategyId);
                                        if (!strat) return null;
                                        return (
                                          <div className="space-y-0.5 mb-2">
                                            <p className="text-[10px] text-muted-foreground"><StrategyDesc text={strat.descriptionEn} /></p>
                                            <p className="text-[10px] text-muted-foreground"><StrategyDesc text={strat.descriptionTh} /></p>
                                          </div>
                                        );
                                      })()}
                                      {/* Stats grid */}
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
                                      {/* Trade P&L pills */}
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

                  {/* Best vs Worst summary */}
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
              <CardDescription>รันกลยุทธ์ทดสอบบนข้อมูล {klines.length.toLocaleString()} แท่งเทียนที่โหลดไว้</CardDescription>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="space-y-3">
                {/* Strategy buttons */}
                <div>
                  <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-2">เลือกกลยุทธ์ Indicator</p>
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

                {/* Run controls + PnL */}
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
                {/* Strategy description */}
                {(() => {
                  const strat = STRATEGIES.find(s => s.id === strategyId);
                  if (!strat) return null;
                  return (
                    <div className="space-y-0.5">
                      <p className="text-[10px] text-muted-foreground">
                        <StrategyDesc text={strat.descriptionEn} />
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        <StrategyDesc text={strat.descriptionTh} />
                      </p>
                    </div>
                  );
                })()}

                {/* Strategy-specific parameter inputs */}
                {Object.keys(strategyParams).length > 0 && (
                  <div className="flex flex-wrap items-end space-x-4">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground w-full">ปรับค่าพารามิเตอร์</p>
                    {Object.entries(strategyParams).map(([key, val]) => (
                      <Field key={key} label={PARAM_LABELS[key] ?? key}>
                        <div className="space-y-0.5">
                          <Input
                            type="number"
                            step={key === "period" ? 1 : 1}
                            min={1}
                            value={val}
                            onChange={e => setStrategyParams(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                            className="w-24"
                          />
                          {strategyId === "rsi" && (
                            <p className="text-[9px] text-muted-foreground/70">
                              {key === "period" && "จำนวนแท่งเทียนที่ใช้คำนวณ (ค่าทั่วไป: 7, 14, 21)"}
                              {key === "buyThreshold" && "ค่า RSI ต่ำกว่านี้ = สัญญาณซื้อ"}
                              {key === "sellThreshold" && "ค่า RSI สูงกว่านี้ = สัญญาณขาย"}
                            </p>
                          )}
                          {strategyId === "smc" && (
                            <p className="text-[9px] text-muted-foreground/70">
                              {key === "swingSize" && "แท่งเทียนหา pivot หลัก (10-100) — ค่าน้อย=ไว ค่ามาก=จับเทรนด์ใหญ่"}
                              {key === "internalSize" && "แท่งเทียนหาโครงสร้างย่อย (2-15) — ค่าน้อย=สัญญาณเยอะ ค่ามาก=กรอง noise"}
                            </p>
                          )}
                          {strategyId === "cm_macd" && (
                            <p className="text-[9px] text-muted-foreground/70">
                              {key === "fastLength" && "EMA สั้น (6-21) — ค่าน้อย=ไว ค่ามาก=ช้าแต่แม่นยำ"}
                              {key === "slowLength" && "EMA ยาว (15-50) — ห่างจาก Fast มาก=Histogram แกว่งแรง"}
                              {key === "signalLength" && "SMA กรองสัญญาณ (3-20) — ค่าน้อย=cross บ่อย ค่ามาก=กรอง noise"}
                            </p>
                          )}
                          {strategyId === "supertrend" && (
                            <p className="text-[9px] text-muted-foreground/70">
                              {key === "atrPeriod" && "แท่งเทียนคำนวณ ATR (5-20) — ค่าน้อย=Band ไว ค่ามาก=Band เสถียร"}
                              {key === "multiplier" && "ตัวคูณ ATR (1.0-6.0) — ค่าน้อย=Band แคบ สัญญาณเยอะ ค่ามาก=Band กว้าง จับเทรนด์ใหญ่"}
                            </p>
                          )}
                          {strategyId === "squeeze_momentum" && (
                            <p className="text-[9px] text-muted-foreground/70">
                              {key === "bbLength" && "Bollinger Bands period (10-30) — ค่าน้อย=BB แคบ Squeeze บ่อย ค่ามาก=BB กว้าง"}
                              {key === "bbMult" && "BB Multiplier (1.0-3.0) — ค่าน้อย=BB แคบ ค่ามาก=BB กว้าง"}
                              {key === "kcLength" && "Keltner Channel period (10-30) — ค่าน้อย=KC ไว ค่ามาก=KC เสถียร"}
                              {key === "kcMult" && "KC Multiplier (1.0-3.0) — ค่าน้อย=Squeeze ง่าย ค่ามาก=Squeeze ยาก"}
                            </p>
                          )}
                          {strategyId === "msb_ob" && (
                            <p className="text-[9px] text-muted-foreground/70">
                              {key === "zigzagLen" && "ZigZag period (5-20) — ค่าน้อย=swing points บ่อย ค่ามาก=จับเทรนด์ใหญ่"}
                              {key === "fibFactor" && "Fib confirmation (0.1-0.5) — ค่ามาก=ต้อง break แรงกว่าจึงนับเป็น MSB"}
                            </p>
                          )}
                          {strategyId === "support_resistance" && (
                            <p className="text-[9px] text-muted-foreground/70">
                              {key === "leftBars" && "Left Bars (5-30) — แท่งซ้ายของ pivot ค่ามาก=S/R แข็งแกร่งกว่า"}
                              {key === "rightBars" && "Right Bars (5-30) — แท่งขวาของ pivot ค่ามาก=ยืนยันชัดกว่าแต่ช้า"}
                              {key === "volumeThresh" && "Volume % (10-50) — Volume oscillator ขั้นต่ำสำหรับ break ที่มีนัย"}
                            </p>
                          )}
                          {strategyId === "trendlines" && (
                            <p className="text-[9px] text-muted-foreground/70">
                              {key === "trendLength" && "Swing Lookback (5-30) — ค่าน้อย=เส้นเทรนด์เปลี่ยนบ่อย ค่ามาก=เสถียร"}
                              {key === "trendMult" && "Slope Mult (0.5-3.0) — ค่ามาก=เส้นเทรนด์ชันขึ้น break ง่ายขึ้น"}
                            </p>
                          )}
                          {strategyId === "ut_bot" && (
                            <p className="text-[9px] text-muted-foreground/70">
                              {key === "keyValue" && "Key Value (0.5-5) — ตัวคูณ ATR ค่าน้อย=ไว ค่ามาก=กรอง noise"}
                              {key === "utAtrPeriod" && "ATR Period (5-20) — ค่าน้อย=trailing stop ไว ค่ามาก=เรียบกว่า"}
                            </p>
                          )}
                        </div>
                      </Field>
                    ))}
                  </div>
                )}

                {/* RSI explanation */}
                {strategyId === "rsi" && (
                  <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2.5 space-y-2">
                    <p className="text-[11px] font-medium text-foreground/90">RSI (Relative Strength Index) คืออะไร?</p>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      RSI เป็นตัวชี้วัดโมเมนตัม (Momentum Oscillator) ที่วัดความเร็วและขนาดของการเปลี่ยนแปลงราคา
                      โดยคำนวณจากอัตราส่วนของ <span className="text-emerald-500/80">ค่าเฉลี่ยของราคาที่เพิ่มขึ้น (Average Gain)</span> กับ <span className="text-red-500/80">ค่าเฉลี่ยของราคาที่ลดลง (Average Loss)</span> ในช่วง Period ที่กำหนด
                      ค่า RSI อยู่ในช่วง 0-100
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
                      <span className="text-emerald-500">RSI &lt; {strategyParams.buyThreshold ?? 30} = Oversold (ขายมากเกินไป) → สัญญาณซื้อ</span>
                      <span className="text-red-500">RSI &gt; {strategyParams.sellThreshold ?? 70} = Overbought (ซื้อมากเกินไป) → สัญญาณขาย</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      สูตร: RSI = 100 - 100 / (1 + AG/AL) โดย AG = ค่าเฉลี่ยกำไร, AL = ค่าเฉลี่ยขาดทุน ในช่วง Period แท่ง
                    </p>
                  </div>
                )}

                {/* SMC explanation */}
                {strategyId === "smc" && (
                  <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2.5 space-y-2">
                    <p className="text-[11px] font-medium text-foreground/90">Smart Money Concepts (SMC) [LuxAlgo] คืออะไร?</p>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      SMC เป็นแนวคิดการวิเคราะห์โครงสร้างตลาด (Market Structure) ตามทฤษฎี ICT/Smart Money
                      โดยตรวจจับจุดกลับตัวของราคา (Pivot Points) แล้ววิเคราะห์ว่าราคาทะลุจุดสำคัญอย่างไร
                    </p>

                    <div className="space-y-1.5 text-[10px]">
                      <p className="font-medium text-foreground/80">โครงสร้างตลาด (Market Structure) — แสดงบนกราฟ:</p>
                      <div className="space-y-1">
                        <div className="flex items-start gap-2">
                          <span className="text-emerald-500 font-medium whitespace-nowrap">BOS (เส้นทึบ เขียว/แดง + ลูกศร)</span>
                          <span className="text-muted-foreground">Break of Structure — ราคาทะลุ pivot ตามเทรนด์เดิม → ยืนยันว่าเทรนด์ยังคงอยู่</span>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="text-amber-500 font-medium whitespace-nowrap">CHoCH (เส้นประ เขียว/แดง + ลูกศร)</span>
                          <span className="text-muted-foreground">Change of Character — ราคาทะลุ pivot สวนเทรนด์ → สัญญาณกลับตัว (สำคัญมาก!)</span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5 text-[10px]">
                      <p className="font-medium text-foreground/80">องค์ประกอบอื่นบนกราฟ:</p>
                      <div className="space-y-0.5 text-muted-foreground">
                        <p><span className="text-emerald-500/60">โซนเขียว (เส้นคู่บน-ล่าง)</span> = Bullish Internal OB — แนวรับจากแท่งเทียนขาลงสุดท้ายก่อน break ขึ้น</p>
                        <p><span className="text-red-500/60">โซนแดง (เส้นคู่บน-ล่าง)</span> = Bearish Internal OB — แนวต้านจากแท่งเทียนขาขึ้นสุดท้ายก่อน break ลง</p>
                        <p><span className="text-blue-500/60">โซนน้ำเงิน (เส้นหนา)</span> = Swing OB — Order Block ระดับ Swing (แนวรับ/ต้านหลัก)</p>
                        <p>Fair Value Gap (FVG) = ช่องว่างราคาระหว่าง 3 แท่งเทียน → ราคามักย้อนกลับมาเติม</p>
                        <p>Premium/Discount Zone = ราคาสูงกว่าจุดสมดุล → เหมาะขาย | ต่ำกว่า → เหมาะซื้อ</p>
                      </div>
                    </div>

                    <Separator className="my-1.5" />

                    <div className="space-y-1.5 text-[10px]">
                      <p className="font-medium text-foreground/80">ความหมายของพารามิเตอร์:</p>
                      <div className="space-y-2">
                        <div className="rounded border border-border/30 bg-background/50 p-2">
                          <p className="font-medium text-blue-400">Swing Size (ค่าปัจจุบัน: {strategyParams.swingSize ?? 50})</p>
                          <p className="text-muted-foreground mt-0.5">
                            จำนวนแท่งเทียนที่ใช้หา Swing Point (จุดกลับตัวหลัก) — เป็นจำนวนแท่งซ้าย-ขวาที่ต้องต่ำ/สูงกว่าจุด pivot
                          </p>
                          <div className="mt-1 space-y-0.5">
                            <p className="text-emerald-500/80">ค่าน้อย (10-20) → เจอ swing points บ่อย → สัญญาณเยอะ → ไวต่อการเปลี่ยนแปลง แต่อาจเจอสัญญาณหลอก (false signals) มากขึ้น</p>
                            <p className="text-red-500/80">ค่ามาก (50-100) → เจอ swing points น้อย → สัญญาณน้อย → จับเทรนด์ใหญ่ได้ดี แต่ช้าในการเข้า/ออก</p>
                            <p className="text-muted-foreground/70">ค่าทั่วไป: 20-50 สำหรับ Day Trading, 50-100 สำหรับ Swing Trading</p>
                          </div>
                        </div>
                        <div className="rounded border border-border/30 bg-background/50 p-2">
                          <p className="font-medium text-purple-400">Internal Size (ค่าปัจจุบัน: {strategyParams.internalSize ?? 5})</p>
                          <p className="text-muted-foreground mt-0.5">
                            จำนวนแท่งเทียนที่ใช้หา Internal Structure (โครงสร้างย่อยภายในเทรนด์) — ใช้สร้างสัญญาณ BUY/SELL
                          </p>
                          <div className="mt-1 space-y-0.5">
                            <p className="text-emerald-500/80">ค่าน้อย (2-3) → จับการเคลื่อนไหวเล็กๆ → เทรดบ่อย → เหมาะ Scalping แต่ค่าธรรมเนียมสูง</p>
                            <p className="text-red-500/80">ค่ามาก (7-15) → กรอง noise ออก → เทรดน้อยลง → สัญญาณมีคุณภาพมากขึ้น แต่อาจพลาดจังหวะ</p>
                            <p className="text-muted-foreground/70">ค่าทั่วไป: 3-5 สำหรับ Intraday, 5-10 สำหรับ Swing</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <Separator className="my-1.5" />

                    <div className="space-y-1 text-[10px]">
                      <p className="font-medium text-foreground/80">สัญญาณ Backtest:</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <span className="text-emerald-500">BUY → Bullish CHoCH (กลับตัวขึ้น) หรือ Bullish BOS ใน Discount/Equilibrium Zone</span>
                        <span className="text-red-500">SELL → Bearish CHoCH (กลับตัวลง) หรือ Bearish BOS ใน Premium/Equilibrium Zone</span>
                      </div>
                    </div>

                    <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2 text-[9px] text-amber-500/80">
                      <p className="font-medium">ผลกระทบเมื่อเปลี่ยนค่า:</p>
                      <p>Swing Size มีผลต่อ Premium/Discount Zone (โซนราคา) และ Swing Trend — ค่ามากจะทำให้โซนกว้างขึ้น เทรนด์เปลี่ยนช้าลง</p>
                      <p>Internal Size มีผลโดยตรงต่อจำนวนสัญญาณ BUY/SELL — ค่าน้อย = สัญญาณเยอะ, ค่ามาก = สัญญาณน้อยแต่แม่นยำกว่า</p>
                      <p>ทั้งสองค่ามีผลต่อ Order Blocks และ Fair Value Gaps ที่ตรวจพบ</p>
                    </div>
                  </div>
                )}

                {/* CM MacD Ultimate MTF explanation */}
                {strategyId === "cm_macd" && (
                  <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2.5 space-y-2">
                    <p className="text-[11px] font-medium text-foreground/90">CM MacD Ultimate MTF คืออะไร?</p>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      CM MacD Ultimate MTF เป็น MACD เวอร์ชันปรับปรุงโดย ChrisMoody
                      ที่เพิ่ม <span className="font-medium text-foreground/80">Histogram 4 สี</span> แสดงทิศทางและความแรงของโมเมนตัม
                      ทั้งเหนือและใต้เส้นศูนย์ ช่วยให้เห็นการเปลี่ยนแปลงโมเมนตัมก่อนเกิดสัญญาณ crossover
                    </p>

                    <div className="space-y-1.5 text-[10px]">
                      <p className="font-medium text-foreground/80">Histogram 4 สี:</p>
                      <div className="grid grid-cols-2 gap-1">
                        <span className="text-cyan-400">Aqua = เพิ่มขึ้น &amp; เหนือ 0 → แรงซื้อเพิ่มขึ้น (Bullish แรง)</span>
                        <span className="text-blue-500">Blue = ลดลง &amp; เหนือ 0 → แรงซื้ออ่อนตัว (Bullish อ่อน)</span>
                        <span className="text-red-500">Red = ลดลง &amp; ใต้ 0 → แรงขายเพิ่มขึ้น (Bearish แรง)</span>
                        <span className="text-red-800">Maroon = เพิ่มขึ้น &amp; ใต้ 0 → แรงขายอ่อนตัว (Bearish อ่อน)</span>
                      </div>
                    </div>

                    <div className="space-y-1 text-[10px]">
                      <p className="font-medium text-foreground/80">สัญญาณ:</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <span className="text-emerald-500">BUY → MACD ตัดขึ้นเหนือ Signal Line (Golden Cross)</span>
                        <span className="text-red-500">SELL → MACD ตัดลงใต้ Signal Line (Death Cross)</span>
                      </div>
                    </div>

                    <div className="space-y-1 text-[10px]">
                      <p className="font-medium text-foreground/80">การอ่านสีล่วงหน้า:</p>
                      <p className="text-muted-foreground">
                        เมื่อ Histogram เปลี่ยนจาก <span className="text-cyan-400">Aqua</span> → <span className="text-blue-500">Blue</span> = แรงซื้ออ่อนลง เตรียมตัวขาย |
                        เปลี่ยนจาก <span className="text-red-500">Red</span> → <span className="text-red-800">Maroon</span> = แรงขายอ่อนลง เตรียมตัวซื้อ
                      </p>
                    </div>

                    <Separator className="my-1.5" />

                    <div className="space-y-1.5 text-[10px]">
                      <p className="font-medium text-foreground/80">ความหมายของพารามิเตอร์:</p>
                      <div className="space-y-2">
                        <div className="rounded border border-border/30 bg-background/50 p-2">
                          <p className="font-medium text-blue-400">Fast EMA (ค่าปัจจุบัน: {strategyParams.fastLength ?? 12})</p>
                          <p className="text-muted-foreground mt-0.5">
                            EMA ระยะสั้น — ตอบสนองต่อราคาเร็วกว่า ใช้คำนวณ MACD Line (Fast EMA - Slow EMA)
                          </p>
                          <div className="mt-1 space-y-0.5">
                            <p className="text-emerald-500/80">ค่าน้อย (6-9) → ไวต่อการเปลี่ยนแปลงราคา → สัญญาณเร็วขึ้น แต่ false signals มากขึ้น</p>
                            <p className="text-red-500/80">ค่ามาก (15-21) → ช้าลง → สัญญาณน้อยแต่แม่นยำกว่า อาจเข้าช้า/ออกช้า</p>
                            <p className="text-muted-foreground/70">ค่าทั่วไป: 12 (มาตรฐาน), 8 (ไว), 17 (ช้า)</p>
                          </div>
                        </div>
                        <div className="rounded border border-border/30 bg-background/50 p-2">
                          <p className="font-medium text-purple-400">Slow EMA (ค่าปัจจุบัน: {strategyParams.slowLength ?? 26})</p>
                          <p className="text-muted-foreground mt-0.5">
                            EMA ระยะยาว — เป็นเส้นฐานที่ราคาเฉลี่ยช้ากว่า ใช้คู่กับ Fast EMA
                          </p>
                          <div className="mt-1 space-y-0.5">
                            <p className="text-emerald-500/80">ค่าน้อย (15-20) → ระยะห่างระหว่าง Fast/Slow น้อย → Histogram เล็ก สัญญาณบ่อย</p>
                            <p className="text-red-500/80">ค่ามาก (30-50) → ระยะห่างมาก → Histogram ใหญ่ สัญญาณน้อย จับเทรนด์ใหญ่</p>
                            <p className="text-muted-foreground/70">ค่าทั่วไป: 26 (มาตรฐาน), 21 (ไว), 35 (ช้า)</p>
                          </div>
                        </div>
                        <div className="rounded border border-border/30 bg-background/50 p-2">
                          <p className="font-medium text-amber-400">Signal SMA (ค่าปัจจุบัน: {strategyParams.signalLength ?? 9})</p>
                          <p className="text-muted-foreground mt-0.5">
                            SMA ของ MACD Line — เป็นตัวกรองสัญญาณ เมื่อ MACD ตัด Signal = สัญญาณเทรด
                          </p>
                          <div className="mt-1 space-y-0.5">
                            <p className="text-emerald-500/80">ค่าน้อย (3-5) → Signal Line ไวมาก → cross บ่อย สัญญาณเยอะ แต่มี noise มาก</p>
                            <p className="text-red-500/80">ค่ามาก (12-20) → Signal Line เรียบ → cross น้อย สัญญาณมีคุณภาพ แต่ช้า</p>
                            <p className="text-muted-foreground/70">ค่าทั่วไป: 9 (มาตรฐาน), 5 (ไว), 14 (ช้า)</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2 text-[9px] text-amber-500/80">
                      <p className="font-medium">ผลกระทบเมื่อเปลี่ยนค่า:</p>
                      <p>Fast EMA &amp; Slow EMA: ผลต่างของทั้งคู่กำหนดขนาด MACD Line — ถ้าห่างกันมาก = MACD แกว่งแรง, ห่างน้อย = MACD แกว่งเบา</p>
                      <p>Signal Length: มีผลโดยตรงต่อจำนวน crossover (สัญญาณ BUY/SELL) — ค่าน้อย = cross บ่อย, ค่ามาก = cross น้อย</p>
                      <p>Histogram 4 สีจะเปลี่ยนตามโดยอัตโนมัติ — ช่วยอ่านโมเมนตัมก่อนเกิดสัญญาณจริง</p>
                    </div>
                  </div>
                )}

                {/* Supertrend explanation */}
                {strategyId === "supertrend" && (
                  <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2.5 space-y-2">
                    <p className="text-[11px] font-medium text-foreground/90">Supertrend คืออะไร?</p>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      Supertrend เป็นตัวชี้วัดแบบ <span className="font-medium text-foreground/80">Trend-Following (ติดตามเทรนด์)</span> ที่ใช้ ATR (Average True Range)
                      สร้างแถบราคาบน-ล่างรอบๆ ราคา เมื่อราคาทะลุแถบจะเกิดสัญญาณเปลี่ยนเทรนด์
                      เหมาะสำหรับตลาดที่มีเทรนด์ชัดเจน (Trending Market)
                    </p>

                    <div className="space-y-1.5 text-[10px]">
                      <p className="font-medium text-foreground/80">หลักการทำงาน:</p>
                      <div className="space-y-0.5 text-muted-foreground">
                        <p>1. คำนวณ ATR เพื่อวัดความผันผวนของราคา</p>
                        <p>2. สร้าง <span className="text-emerald-500">Lower Band</span> = HL2 - (Multiplier × ATR) → แนวรับในขาขึ้น</p>
                        <p>3. สร้าง <span className="text-red-500">Upper Band</span> = HL2 + (Multiplier × ATR) → แนวต้านในขาลง</p>
                        <p>4. เมื่อราคาปิดทะลุ Band → เทรนด์เปลี่ยน → สัญญาณ BUY/SELL</p>
                      </div>
                    </div>

                    <div className="space-y-1 text-[10px]">
                      <p className="font-medium text-foreground/80">สัญญาณ:</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <span className="text-emerald-500">BUY → เทรนด์เปลี่ยนจากขาลงเป็นขาขึ้น (ราคาทะลุ Upper Band)</span>
                        <span className="text-red-500">SELL → เทรนด์เปลี่ยนจากขาขึ้นเป็นขาลง (ราคาหลุด Lower Band)</span>
                      </div>
                    </div>

                    <Separator className="my-1.5" />

                    <div className="space-y-1.5 text-[10px]">
                      <p className="font-medium text-foreground/80">ความหมายของพารามิเตอร์:</p>
                      <div className="space-y-2">
                        <div className="rounded border border-border/30 bg-background/50 p-2">
                          <p className="font-medium text-blue-400">ATR Period (ค่าปัจจุบัน: {strategyParams.atrPeriod ?? 10})</p>
                          <p className="text-muted-foreground mt-0.5">
                            จำนวนแท่งเทียนที่ใช้คำนวณ ATR (Average True Range) — วัดความผันผวนเฉลี่ยของราคา
                          </p>
                          <div className="mt-1 space-y-0.5">
                            <p className="text-emerald-500/80">ค่าน้อย (5-7) → ATR ไวต่อความผันผวนระยะสั้น → Band แคบขึ้น → สัญญาณเปลี่ยนเทรนด์เร็ว แต่ Whipsaw (สัญญาณหลอก) มากขึ้น</p>
                            <p className="text-red-500/80">ค่ามาก (14-20) → ATR เรียบขึ้น → Band กว้างขึ้น → ทนต่อ noise ดี แต่เข้า/ออกช้า</p>
                            <p className="text-muted-foreground/70">ค่าทั่วไป: 10 (มาตรฐาน), 7 (ไว), 14 (ช้าแต่แม่นยำ)</p>
                          </div>
                        </div>
                        <div className="rounded border border-border/30 bg-background/50 p-2">
                          <p className="font-medium text-purple-400">ATR Multiplier (ค่าปัจจุบัน: {strategyParams.multiplier ?? 3.0})</p>
                          <p className="text-muted-foreground mt-0.5">
                            ตัวคูณ ATR เพื่อกำหนดระยะห่างของ Band จากราคา — ยิ่งมาก Band ยิ่งห่างจากราคา
                          </p>
                          <div className="mt-1 space-y-0.5">
                            <p className="text-emerald-500/80">ค่าน้อย (1.0-2.0) → Band แคบ ใกล้ราคา → เปลี่ยนเทรนด์บ่อย สัญญาณเยอะ → เหมาะ Scalping แต่ Whipsaw มาก</p>
                            <p className="text-red-500/80">ค่ามาก (4.0-6.0) → Band กว้าง ห่างราคา → เปลี่ยนเทรนด์ยาก สัญญาณน้อย → จับเทรนด์ใหญ่ แต่ Drawdown อาจมาก</p>
                            <p className="text-muted-foreground/70">ค่าทั่วไป: 3.0 (มาตรฐาน), 2.0 (ไว), 4.0 (ช้า)</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2 text-[9px] text-amber-500/80">
                      <p className="font-medium">ผลกระทบเมื่อเปลี่ยนค่า:</p>
                      <p>ATR Period: มีผลต่อความเรียบของ ATR — ค่าน้อย ATR แกว่งเร็ว Band ปรับตัวเร็ว, ค่ามาก ATR เสถียร Band เปลี่ยนช้า</p>
                      <p>Multiplier: มีผลโดยตรงต่อความกว้างของ Band — ค่ามาก = ต้องราคาเคลื่อนที่มากกว่าจึงจะเปลี่ยนเทรนด์ ลด false signals แต่เข้า/ออกช้าลง</p>
                      <p>ทั้งสองค่าร่วมกัน: Period น้อย + Multiplier น้อย = ไวมาก (เหมาะ Scalp) | Period มาก + Multiplier มาก = ช้ามาก (เหมาะ Swing/Position)</p>
                    </div>

                    <div className="rounded border border-blue-500/20 bg-blue-500/5 p-2 text-[9px] text-blue-500/80">
                      <p className="font-medium">ข้อควรระวัง:</p>
                      <p>Supertrend ทำงานได้ดีในตลาดที่มีเทรนด์ (Trending Market) แต่จะให้สัญญาณหลอกมากในตลาด Sideways (ราคาเคลื่อนไปข้าง)</p>
                      <p>แนะนำใช้ร่วมกับ ADX เพื่อกรอง — ถ้า ADX &gt; 25 แสดงว่ามีเทรนด์ชัดเจน Supertrend จะน่าเชื่อถือมากขึ้น</p>
                    </div>
                  </div>
                )}

                {/* Squeeze Momentum explanation */}
                {strategyId === "squeeze_momentum" && (
                  <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2.5 space-y-2">
                    <p className="text-[11px] font-medium text-foreground/90">Squeeze Momentum Indicator [LazyBear] คืออะไร?</p>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      Squeeze Momentum เป็นตัวชี้วัดที่รวม <span className="font-medium text-foreground/80">Bollinger Bands Squeeze</span> กับ <span className="font-medium text-foreground/80">Momentum</span> เข้าด้วยกัน
                      เมื่อ Bollinger Bands หดตัวเข้าไปอยู่ภายใน Keltner Channels แสดงว่าตลาดกำลัง &quot;บีบตัว&quot; (Squeeze)
                      — เมื่อ Squeeze คลายตัว ราคามักจะพุ่งแรงไปในทิศทางของ Momentum
                    </p>

                    <div className="space-y-1.5 text-[10px]">
                      <p className="font-medium text-foreground/80">Histogram 4 สี (Momentum):</p>
                      <div className="grid grid-cols-2 gap-1">
                        <span className="text-lime-400">Lime = เพิ่มขึ้น &amp; เหนือ 0 → Momentum ขาขึ้นแรง</span>
                        <span className="text-green-600">Green = ลดลง &amp; เหนือ 0 → Momentum ขาขึ้นอ่อน</span>
                        <span className="text-red-500">Red = ลดลง &amp; ใต้ 0 → Momentum ขาลงแรง</span>
                        <span className="text-red-800">Maroon = เพิ่มขึ้น &amp; ใต้ 0 → Momentum ขาลงอ่อน</span>
                      </div>
                    </div>

                    <div className="space-y-1.5 text-[10px]">
                      <p className="font-medium text-foreground/80">จุดตรง Squeeze (จุดกลาง):</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <span className="text-foreground/70">จุดดำ = Squeeze กำลังบีบ (BB อยู่ภายใน KC) → เตรียมตัว!</span>
                        <span className="text-muted-foreground">จุดเทา = Squeeze ปลดปล่อย (BB อยู่นอก KC) → ราคากำลังวิ่ง</span>
                      </div>
                    </div>

                    <div className="space-y-1 text-[10px]">
                      <p className="font-medium text-foreground/80">สัญญาณ:</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <span className="text-emerald-500">BUY → Momentum ข้ามขึ้นเหนือ 0 (เปลี่ยนจากลบเป็นบวก)</span>
                        <span className="text-red-500">SELL → Momentum ข้ามลงใต้ 0 (เปลี่ยนจากบวกเป็นลบ)</span>
                      </div>
                    </div>

                    <Separator className="my-1.5" />

                    <div className="space-y-1.5 text-[10px]">
                      <p className="font-medium text-foreground/80">ความหมายของพารามิเตอร์:</p>
                      <div className="space-y-2">
                        <div className="rounded border border-border/30 bg-background/50 p-2">
                          <p className="font-medium text-blue-400">BB Length (ค่าปัจจุบัน: {strategyParams.bbLength ?? 20})</p>
                          <p className="text-muted-foreground mt-0.5">
                            ความยาว Bollinger Bands — กำหนดขนาดของ BB ที่ใช้เทียบกับ Keltner Channel
                          </p>
                          <div className="mt-1 space-y-0.5">
                            <p className="text-emerald-500/80">ค่าน้อย (10-15) → BB แคบลง → Squeeze เกิดบ่อยขึ้น</p>
                            <p className="text-red-500/80">ค่ามาก (25-30) → BB กว้างขึ้น → Squeeze เกิดยากขึ้น แต่มีนัยสำคัญมากขึ้น</p>
                          </div>
                        </div>
                        <div className="rounded border border-border/30 bg-background/50 p-2">
                          <p className="font-medium text-purple-400">BB MultFactor (ค่าปัจจุบัน: {strategyParams.bbMult ?? 2.0})</p>
                          <p className="text-muted-foreground mt-0.5">
                            ตัวคูณ Standard Deviation ของ Bollinger Bands
                          </p>
                          <div className="mt-1 space-y-0.5">
                            <p className="text-emerald-500/80">ค่าน้อย (1.0-1.5) → BB แคบมาก → Squeeze ง่าย สัญญาณเยอะ</p>
                            <p className="text-red-500/80">ค่ามาก (2.5-3.0) → BB กว้างมาก → Squeeze ยาก สัญญาณน้อยแต่แม่นยำ</p>
                            <p className="text-muted-foreground/70">ค่ามาตรฐาน: 2.0</p>
                          </div>
                        </div>
                        <div className="rounded border border-border/30 bg-background/50 p-2">
                          <p className="font-medium text-amber-400">KC Length (ค่าปัจจุบัน: {strategyParams.kcLength ?? 20})</p>
                          <p className="text-muted-foreground mt-0.5">
                            ความยาว Keltner Channel — ใช้เป็น &quot;กรอบอ้างอิง&quot; สำหรับ Squeeze
                          </p>
                        </div>
                        <div className="rounded border border-border/30 bg-background/50 p-2">
                          <p className="font-medium text-cyan-400">KC MultFactor (ค่าปัจจุบัน: {strategyParams.kcMult ?? 1.5})</p>
                          <p className="text-muted-foreground mt-0.5">
                            ตัวคูณ ATR ของ Keltner Channel — ค่าน้อย=KC แคบ (Squeeze ง่ายขึ้น) ค่ามาก=KC กว้าง (Squeeze ยากขึ้น)
                          </p>
                          <p className="text-muted-foreground/70 mt-0.5">ค่ามาตรฐาน: 1.5</p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2 text-[9px] text-amber-500/80">
                      <p className="font-medium">วิธีใช้:</p>
                      <p>1. สังเกตจุดดำ (Squeeze On) — แสดงว่าตลาดกำลังสะสมแรง</p>
                      <p>2. เมื่อจุดเปลี่ยนเป็นเทา (Squeeze Off) + Histogram เปลี่ยนสี → สัญญาณเข้าเทรด</p>
                      <p>3. Histogram สีเข้ม (Lime/Red) = โมเมนตัมแรง, สีอ่อน (Green/Maroon) = โมเมนตัมอ่อนลง → เตรียมออก</p>
                    </div>
                  </div>
                )}

                {/* MSB-OB explanation */}
                {strategyId === "msb_ob" && (
                  <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2.5 space-y-2">
                    <p className="text-[11px] font-medium text-foreground/90">Market Structure Break &amp; Order Block (MSB-OB) คืออะไร?</p>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      ใช้ ZigZag ตรวจจับ Swing Points (จุดกลับตัว) แล้ววิเคราะห์ว่าราคา Break โครงสร้างตลาดเมื่อไหร่ (MSB)
                      เมื่อ Low ใหม่ทำ Lower Low = Bearish MSB, เมื่อ High ใหม่ทำ Higher High = Bullish MSB
                      พร้อมระบุ Order Block — แท่งเทียนสุดท้ายก่อน break ที่เป็นโซนแนวรับ/ต้าน
                    </p>

                    <div className="space-y-1.5 text-[10px]">
                      <p className="font-medium text-foreground/80">องค์ประกอบบนกราฟ:</p>
                      <div className="space-y-0.5 text-muted-foreground">
                        <p><span className="text-slate-400">เส้น ZigZag (สีเทา)</span> — เชื่อม Swing High ↔ Swing Low แสดงโครงสร้างราคา</p>
                        <p><span className="text-emerald-500">เส้นเขียว + ลูกศร MSB</span> — Bullish MSB ราคาทะลุ High เดิม → โครงสร้างเปลี่ยนเป็นขาขึ้น</p>
                        <p><span className="text-red-500">เส้นแดง + ลูกศร MSB</span> — Bearish MSB ราคาหลุด Low เดิม → โครงสร้างเปลี่ยนเป็นขาลง</p>
                        <p><span className="text-emerald-500/70">โซนเขียว (Bu-OB)</span> — Bullish Order Block แนวรับ (แท่งเทียนขาลงสุดท้ายก่อน break ขึ้น)</p>
                        <p><span className="text-red-500/70">โซนแดง (Be-OB)</span> — Bearish Order Block แนวต้าน (แท่งเทียนขาขึ้นสุดท้ายก่อน break ลง)</p>
                      </div>
                    </div>

                    <div className="space-y-1 text-[10px]">
                      <p className="font-medium text-foreground/80">สัญญาณ:</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <span className="text-emerald-500">BUY → Bullish MSB (โครงสร้างเปลี่ยนเป็นขาขึ้น)</span>
                        <span className="text-red-500">SELL → Bearish MSB (โครงสร้างเปลี่ยนเป็นขาลง)</span>
                      </div>
                    </div>

                    <Separator className="my-1.5" />

                    <div className="space-y-1.5 text-[10px]">
                      <p className="font-medium text-foreground/80">ความหมายของพารามิเตอร์:</p>
                      <div className="space-y-2">
                        <div className="rounded border border-border/30 bg-background/50 p-2">
                          <p className="font-medium text-blue-400">ZigZag Length (ค่าปัจจุบัน: {strategyParams.zigzagLen ?? 9})</p>
                          <p className="text-muted-foreground mt-0.5">
                            จำนวนแท่งเทียนที่ใช้ตรวจจับ Swing Point — กำหนดว่าราคาต้องเป็น Highest/Lowest กี่แท่งถึงนับเป็นจุดกลับตัว
                          </p>
                          <div className="mt-1 space-y-0.5">
                            <p className="text-emerald-500/80">ค่าน้อย (3-5) → เจอ Swing Point บ่อย → MSB เกิดถี่ → สัญญาณเยอะแต่อาจมี noise</p>
                            <p className="text-red-500/80">ค่ามาก (12-20) → เจอ Swing Point น้อย → MSB เกิดยาก → จับเทรนด์ใหญ่ได้ดีกว่า</p>
                            <p className="text-muted-foreground/70">ค่าทั่วไป: 9 (มาตรฐาน), 5 (ไว), 14 (ช้า)</p>
                          </div>
                        </div>
                        <div className="rounded border border-border/30 bg-background/50 p-2">
                          <p className="font-medium text-purple-400">Fib Factor (ค่าปัจจุบัน: {strategyParams.fibFactor ?? 0.33})</p>
                          <p className="text-muted-foreground mt-0.5">
                            สัดส่วน Fibonacci ที่ใช้ยืนยัน MSB — ราคาต้อง break เกินระดับนี้ถึงจะนับเป็น MSB จริง
                          </p>
                          <div className="mt-1 space-y-0.5">
                            <p className="text-emerald-500/80">ค่าน้อย (0.1-0.2) → ยืนยัน break ง่าย → MSB เกิดบ่อย</p>
                            <p className="text-red-500/80">ค่ามาก (0.4-0.5) → ต้อง break แรงกว่า → MSB เกิดยาก แต่มีนัยสำคัญมากขึ้น</p>
                            <p className="text-muted-foreground/70">ค่าทั่วไป: 0.33 (ระดับ Fib 33%)</p>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2 text-[9px] text-amber-500/80">
                      <p className="font-medium">วิธีใช้:</p>
                      <p>1. สังเกต ZigZag — เมื่อ High ใหม่สูงกว่า High เก่า = โครงสร้าง Bullish</p>
                      <p>2. เมื่อเกิด MSB (ลูกศร) → ดูว่าราคากลับมาเข้าโซน Order Block หรือไม่ = จุดเข้าเทรดที่ดี</p>
                      <p>3. OB ที่ยังไม่ถูก break (ยังแสดงอยู่) = โซนแนวรับ/ต้านที่ยังใช้ได้</p>
                    </div>
                  </div>
                )}

                {/* S/R explanation */}
                {strategyId === "support_resistance" && (
                  <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2.5 space-y-2">
                    <p className="text-[11px] font-medium text-foreground/90">Support &amp; Resistance Levels with Breaks [LuxAlgo] คืออะไร?</p>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      ตรวจจับ Pivot High/Low เพื่อวาดเส้น Resistance (แนวต้าน) และ Support (แนวรับ)
                      เมื่อราคาทะลุเส้นพร้อม Volume ที่สูง (Volume Oscillator &gt; Threshold) = สัญญาณ Break ที่มีนัยสำคัญ
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
                      <span className="text-emerald-500">BUY → ทะลุ Resistance + Volume สูง</span>
                      <span className="text-red-500">SELL → หลุด Support + Volume สูง</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      Bull Wick = ทะลุ Resistance แต่มี wick ยาว (สัญญาณอ่อน) | Bear Wick = หลุด Support แต่มี wick ยาว
                    </div>
                  </div>
                )}

                {/* Trendlines explanation */}
                {strategyId === "trendlines" && (
                  <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2.5 space-y-2">
                    <p className="text-[11px] font-medium text-foreground/90">Trendlines with Breaks [LuxAlgo] คืออะไร?</p>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      วาดเส้น Trendline แบบ Dynamic จาก Pivot Points โดยใช้ ATR/Stdev เป็นความชัน (slope)
                      เส้นบน = เส้นแนวต้านจาก Pivot High, เส้นล่าง = เส้นแนวรับจาก Pivot Low
                      เมื่อราคาทะลุเส้น = สัญญาณ Break
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
                      <span className="text-emerald-500">BUY → ราคาทะลุขึ้นเหนือเส้นแนวต้าน (Upper Break)</span>
                      <span className="text-red-500">SELL → ราคาหลุดลงใต้เส้นแนวรับ (Lower Break)</span>
                    </div>
                  </div>
                )}

                {/* UT Bot explanation */}
                {strategyId === "ut_bot" && (
                  <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2.5 space-y-2">
                    <p className="text-[11px] font-medium text-foreground/90">UT Bot Alerts คืออะไร?</p>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      ใช้ ATR Trailing Stop ที่ปรับตัวตามทิศทางราคา — เมื่อราคาขึ้น stop จะยกตัวตาม,
                      เมื่อราคาลง stop จะลดลงตาม เมื่อราคาข้ามผ่าน trailing stop = สัญญาณเปลี่ยนเทรนด์
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
                      <span className="text-emerald-500">BUY → ราคาข้ามขึ้นเหนือ ATR Trailing Stop</span>
                      <span className="text-red-500">SELL → ราคาข้ามลงใต้ ATR Trailing Stop</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      Key Value ยิ่งมาก = Trailing Stop ห่างจากราคามากขึ้น = กรอง noise ได้ดี แต่เข้า/ออกช้ากว่า
                    </div>
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

function ErrorCard({ message }: { message: string }) {
  return (
    <Card size="sm" className="border-destructive/30 bg-destructive/5">
      <CardContent className="py-2 text-xs text-destructive">{message}</CardContent>
    </Card>
  );
}

// ─── Indicator Panel ───────────────────────────────────────────
function IndicatorPanel({ indicators, klines }: { indicators: AllIndicators; klines: KlineData[] }) {
  const last = klines.length - 1;
  const c = +klines[last].close;

  const rows: { name: string; value: string; signal: string; color: string }[] = [];

  // RSI
  const rsiVal = indicators.rsi[last];
  if (rsiVal !== null) {
    const sig = rsiVal < 30 ? "ขายมากเกินไป (ซื้อ)" : rsiVal > 70 ? "ซื้อมากเกินไป (ขาย)" : "ปกติ";
    rows.push({ name: "RSI(14)", value: rsiVal.toFixed(2), signal: sig, color: rsiVal < 30 ? "text-emerald-500" : rsiVal > 70 ? "text-red-500" : "text-muted-foreground" });
  }

  // ATR
  const atrVal = indicators.atr[last];
  if (atrVal !== null) rows.push({ name: "ATR(14)", value: fmtPrice(atrVal), signal: `ความผันผวน ${((atrVal / c) * 100).toFixed(2)}%`, color: "text-muted-foreground" });

  // OBV
  const obvVal = indicators.obv[last];
  const obvPrev = last > 0 ? indicators.obv[last - 1] : obvVal;
  rows.push({ name: "OBV", value: fmtNum(obvVal), signal: obvVal > obvPrev ? "เพิ่มขึ้น" : "ลดลง", color: obvVal > obvPrev ? "text-emerald-500" : "text-red-500" });

  // VWAP
  const vwapVal = indicators.vwap[last];
  rows.push({ name: "VWAP", value: fmtPrice(vwapVal), signal: c > vwapVal ? "อยู่เหนือ (ขาขึ้น)" : "อยู่ใต้ (ขาลง)", color: c > vwapVal ? "text-emerald-500" : "text-red-500" });

  // CDC ActionZone
  const cdc = indicators.cdcActionZone;
  const cdcZone = cdc.zone[last];
  const cdcTrend = cdc.trend[last];
  const cdcSignal = cdc.signal[last];
  if (cdcZone !== null) {
    const zoneLabels: Record<string, string> = {
      green: "เขียว (โซนซื้อ)",
      blue: "น้ำเงิน (เตรียมซื้อ 2)",
      lightblue: "ฟ้าอ่อน (เตรียมซื้อ 1)",
      red: "แดง (โซนขาย)",
      orange: "ส้ม (เตรียมขาย 2)",
      yellow: "เหลือง (เตรียมขาย 1)",
    };
    const zoneColors: Record<string, string> = {
      green: "text-emerald-500",
      blue: "text-blue-500",
      lightblue: "text-cyan-400",
      red: "text-red-500",
      orange: "text-orange-500",
      yellow: "text-yellow-500",
    };
    const zoneLabel = zoneLabels[cdcZone] ?? cdcZone;
    const zoneColor = zoneColors[cdcZone] ?? "text-muted-foreground";
    const trendLabel = cdcTrend ? `${cdcTrend.charAt(0).toUpperCase() + cdcTrend.slice(1)}` : "N/A";
    const sigLabel = cdcSignal ? cdcSignal : trendLabel;
    rows.push({
      name: "CDC ActionZone",
      value: `Fast:${cdc.fastMA[last] !== null ? fmtPrice(cdc.fastMA[last]!) : "-"} Slow:${cdc.slowMA[last] !== null ? fmtPrice(cdc.slowMA[last]!) : "-"}`,
      signal: `${zoneLabel} | ${sigLabel}`,
      color: zoneColor,
    });
  }

  // Smart Money Concepts (SMC)
  const smc = indicators.smc;
  const smcSwingTrend = smc.swingTrend[last];
  const smcInternalTrend = smc.internalTrend[last];
  const smcZone = smc.premiumDiscount[last];
  const lastSmcSignal = smc.signal[last];

  // Find most recent structure break
  const recentStructure = smc.internalStructures.length > 0
    ? smc.internalStructures[smc.internalStructures.length - 1]
    : null;

  // Count active (unmitigated) OBs
  const activeOBs = smc.internalOrderBlocks.filter(ob => !ob.mitigated).length;
  const activeFVGs = smc.fairValueGaps.filter(fvg => !fvg.filled).length;

  if (smcSwingTrend !== null) {
    rows.push({
      name: "SMC Swing Trend",
      value: smcSwingTrend === "bullish" ? "Bullish" : "Bearish",
      signal: smcSwingTrend === "bullish" ? "ขาขึ้น" : "ขาลง",
      color: smcSwingTrend === "bullish" ? "text-emerald-500" : "text-red-500",
    });
  }

  if (smcInternalTrend !== null) {
    rows.push({
      name: "SMC Internal Trend",
      value: smcInternalTrend === "bullish" ? "Bullish" : "Bearish",
      signal: recentStructure ? `${recentStructure.type} ${recentStructure.bias}` : "N/A",
      color: smcInternalTrend === "bullish" ? "text-emerald-500" : "text-red-500",
    });
  }

  if (smcZone !== null) {
    const zoneMap: Record<string, { label: string; color: string }> = {
      premium: { label: "Premium Zone (แพง)", color: "text-red-500" },
      discount: { label: "Discount Zone (ถูก)", color: "text-emerald-500" },
      equilibrium: { label: "Equilibrium (สมดุล)", color: "text-yellow-500" },
    };
    const z = zoneMap[smcZone] ?? { label: smcZone, color: "text-muted-foreground" };
    rows.push({
      name: "SMC Zone",
      value: z.label,
      signal: lastSmcSignal ?? "HOLD",
      color: z.color,
    });
  }

  rows.push({
    name: "SMC Order Blocks",
    value: `Active: ${activeOBs}`,
    signal: `OB: ${activeOBs} | FVG: ${activeFVGs}`,
    color: "text-muted-foreground",
  });

  // CM MacD Ultimate MTF
  const cm = indicators.cmMacd;
  const cmMacd = cm.macdLine[last];
  const cmSignal = cm.signalLine[last];
  const cmHist = cm.histogram[last];
  const cmColor = cm.histColor[last];
  const cmAbove = cm.macdAboveSignal[last];
  const cmSig = cm.signal[last];

  if (cmMacd !== null && cmSignal !== null) {
    const histColorLabels: Record<string, { label: string; color: string }> = {
      aqua: { label: "เพิ่มขึ้น เหนือ 0 (แรงซื้อเพิ่ม)", color: "text-cyan-400" },
      blue: { label: "ลดลง เหนือ 0 (แรงซื้ออ่อน)", color: "text-blue-500" },
      red: { label: "ลดลง ใต้ 0 (แรงขายเพิ่ม)", color: "text-red-500" },
      maroon: { label: "เพิ่มขึ้น ใต้ 0 (แรงขายอ่อน)", color: "text-red-800" },
    };
    const hc = cmColor ? histColorLabels[cmColor] : null;

    rows.push({
      name: "CM MacD",
      value: `M:${cmMacd.toFixed(2)} S:${cmSignal.toFixed(2)}`,
      signal: cmAbove ? "MACD เหนือ Signal (ขาขึ้น)" : "MACD ใต้ Signal (ขาลง)",
      color: cmAbove ? "text-emerald-500" : "text-red-500",
    });

    if (cmHist !== null && hc) {
      rows.push({
        name: "CM Histogram",
        value: cmHist.toFixed(4),
        signal: `${hc.label}${cmSig ? ` | สัญญาณ: ${cmSig}` : ""}`,
        color: hc.color,
      });
    }
  }

  // Supertrend
  const st = indicators.supertrend;
  const stTrend = st.trend[last];
  const stValue = st.supertrend[last];
  const stSignal = st.signal[last];

  if (stTrend !== null && stValue !== null) {
    const isUp = stTrend === 1;
    rows.push({
      name: "Supertrend",
      value: fmtPrice(stValue),
      signal: `${isUp ? "Uptrend (ขาขึ้น)" : "Downtrend (ขาลง)"}${stSignal ? ` | ${stSignal}` : ""}`,
      color: isUp ? "text-emerald-500" : "text-red-500",
    });

    // Show distance from price to supertrend
    const distance = ((c - stValue) / stValue) * 100;
    rows.push({
      name: "ST Distance",
      value: `${distance >= 0 ? "+" : ""}${distance.toFixed(2)}%`,
      signal: isUp
        ? `ราคาอยู่เหนือ Supertrend ${Math.abs(distance).toFixed(2)}%`
        : `ราคาอยู่ใต้ Supertrend ${Math.abs(distance).toFixed(2)}%`,
      color: distance >= 0 ? "text-emerald-500" : "text-red-500",
    });
  }

  // Squeeze Momentum
  const sqz = indicators.squeezeMomentum;
  const sqzVal = sqz.value[last];
  const sqzColor = sqz.histColor[last];
  const sqzIsOn = sqz.sqzOn[last];
  const sqzSignal = sqz.signal[last];

  if (sqzVal !== null) {
    const sqzColorLabels: Record<string, { label: string; color: string }> = {
      lime: { label: "Momentum ขึ้น เหนือ 0 (ขาขึ้นแรง)", color: "text-lime-400" },
      green: { label: "Momentum ลง เหนือ 0 (ขาขึ้นอ่อน)", color: "text-green-600" },
      red: { label: "Momentum ลง ใต้ 0 (ขาลงแรง)", color: "text-red-500" },
      maroon: { label: "Momentum ขึ้น ใต้ 0 (ขาลงอ่อน)", color: "text-red-800" },
    };
    const sc = sqzColor ? sqzColorLabels[sqzColor] : null;

    rows.push({
      name: "Squeeze Mom",
      value: sqzVal.toFixed(4),
      signal: `${sc?.label ?? "N/A"} | ${sqzIsOn ? "SQUEEZE ON (บีบตัว)" : "SQUEEZE OFF"}${sqzSignal ? ` | ${sqzSignal}` : ""}`,
      color: sc?.color ?? "text-muted-foreground",
    });
  }

  // MSB-OB
  const msb = indicators.msbOb;
  const msbMarket = msb.market[last];
  const msbSignal = msb.signal[last];
  const activeOBsMsb = msb.orderBlocks.filter(ob => !ob.broken);
  const lastMsb = msb.msbSignals.length > 0 ? msb.msbSignals[msb.msbSignals.length - 1] : null;
  rows.push({
    name: "MSB-OB",
    value: msbMarket === 1 ? "Bullish" : msbMarket === -1 ? "Bearish" : "N/A",
    signal: `${lastMsb ? `${lastMsb.bias} MSB` : "N/A"} | OB: ${activeOBsMsb.length}${msbSignal ? ` | ${msbSignal}` : ""}`,
    color: msbMarket === 1 ? "text-emerald-500" : msbMarket === -1 ? "text-red-500" : "text-muted-foreground",
  });

  // Support & Resistance
  const sr = indicators.supportResistance;
  const srRes = sr.resistance[last];
  const srSup = sr.support[last];
  const srSignal = sr.signal[last];
  if (srRes !== null || srSup !== null) {
    rows.push({
      name: "S/R Levels",
      value: `R:${srRes !== null ? fmtPrice(srRes) : "-"} S:${srSup !== null ? fmtPrice(srSup) : "-"}`,
      signal: `${c > (srRes ?? Infinity) ? "เหนือ Resistance" : c < (srSup ?? 0) ? "ใต้ Support" : "ระหว่าง S/R"}${srSignal ? ` | ${srSignal}` : ""}`,
      color: sr.breakUp[last] ? "text-emerald-500" : sr.breakDown[last] ? "text-red-500" : "text-muted-foreground",
    });
  }

  // Trendlines
  const tl = indicators.trendlines;
  const tlUpper = tl.upper[last];
  const tlLower = tl.lower[last];
  const tlSignal = tl.signal[last];
  if (tlUpper !== null || tlLower !== null) {
    rows.push({
      name: "Trendlines",
      value: `U:${tlUpper !== null ? fmtPrice(tlUpper) : "-"} L:${tlLower !== null ? fmtPrice(tlLower) : "-"}`,
      signal: `${tl.breakUp[last] ? "Break Up!" : tl.breakDown[last] ? "Break Down!" : "ภายในเทรนด์"}${tlSignal ? ` | ${tlSignal}` : ""}`,
      color: tl.breakUp[last] ? "text-emerald-500" : tl.breakDown[last] ? "text-red-500" : "text-muted-foreground",
    });
  }

  // UT Bot
  const ub = indicators.utBot;
  const ubStop = ub.trailingStop[last];
  const ubPos = ub.pos[last];
  const ubSignal = ub.signal[last];
  if (ubStop !== null) {
    const dist = ((c - ubStop) / ubStop) * 100;
    rows.push({
      name: "UT Bot",
      value: fmtPrice(ubStop),
      signal: `${ubPos === 1 ? "Long (ขาขึ้น)" : ubPos === -1 ? "Short (ขาลง)" : "Neutral"} | Stop ${dist >= 0 ? "+" : ""}${dist.toFixed(2)}%${ubSignal ? ` | ${ubSignal}` : ""}`,
      color: ubPos === 1 ? "text-emerald-500" : ubPos === -1 ? "text-red-500" : "text-muted-foreground",
    });
  }

  return (
    <Card size="sm">
      <CardHeader className="border-b"><CardTitle>ค่าตัวชี้วัด</CardTitle></CardHeader>
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
      {/* P&L Summary */}
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

      {/* Strategy vs Buy&Hold comparison */}
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

      {/* Equity Curve */}
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
          {/* Trade P&L legend */}
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

      {/* Trade History */}
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

// ─── Kline Table ───────────────────────────────────────────────
function KlineTable({ klines, loading, signals }: { klines: KlineData[]; loading: boolean; signals?: import("@/lib/backtest").SignalAction[] }) {
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
          ยังไม่มีข้อมูล ตั้งค่าพารามิเตอร์แล้วกดดึงข้อมูล
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
