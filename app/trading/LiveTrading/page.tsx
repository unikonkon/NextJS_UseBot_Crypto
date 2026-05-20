"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardAction,
} from "@/components/ui/card";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  ArrowUpIcon,
  ArrowDownIcon,
  PlayIcon,
  StopIcon,
  WarningIcon,
  ArrowsClockwiseIcon,
  LightningIcon,
  ClockIcon,
  WifiHighIcon,
  WifiSlashIcon,
  ArrowLeftIcon,
  TrashIcon,
  WalletIcon,
  SpinnerIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import type { KlineData, BinanceKlineRaw, Interval } from "@/lib/types/kline";
import { parseKline } from "@/lib/types/kline";
import { computeAll, type AllIndicators } from "@/lib/indicators";
import { runBacktest, STRATEGIES, type StrategyId, type BacktestResult, type Trade } from "@/lib/backtest";
import { Skeleton } from "@/components/ui/skeleton";
import KlineGraph from "@/app/klines/ui/graph";

// ─── Constants ────────────────────────────────────────────────
const POPULAR_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT",
  "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "DOTUSDT", "LINKUSDT",
  "MATICUSDT", "LTCUSDT", "ATOMUSDT", "NEARUSDT", "APTUSDT",
  "ARBUSDT", "OPUSDT", "SUIUSDT", "INJUSDT", "FETUSDT",
];

const INTERVAL_GROUPS: Record<string, Interval[]> = {
  "นาที": ["1m", "3m", "5m", "15m", "30m"],
  "ชั่วโมง": ["1h", "2h", "4h"],
  "วัน+": ["1d"],
};

// Default polling intervals in seconds based on kline interval
const DEFAULT_POLL_SEC: Record<string, number> = {
  "1m": 10, "3m": 15, "5m": 20, "15m": 30, "30m": 45,
  "1h": 60, "2h": 60, "4h": 120, "1d": 300,
};

const POLL_OPTIONS = [
  5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 300,
  600, 900, 1800, 3600, 7200, 14400, 86400,
];

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
function pnlColor(v: number): string {
  return v > 0 ? "text-emerald-500" : v < 0 ? "text-red-500" : "text-muted-foreground";
}
function pnlBg(v: number): string {
  return v > 0 ? "bg-emerald-500/10" : v < 0 ? "bg-red-500/10" : "bg-muted";
}

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
                <>
                  <div
                    className={`absolute w-1.5 h-1.5 rounded-full left-1/2 -translate-x-1/2 z-10 ${markers[markers.length - 1] >= 0 ? "bg-emerald-400" : "bg-red-400"}`}
                    style={{ top: isPos ? `${zeroY - (val / range) * 100 - 2}%` : `${zeroY + (Math.abs(val) / range) * 100}%` }}
                  />
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</label>
      {children}
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

// ─── Types ────────────────────────────────────────────────────
interface LiveTrade {
  id: string;
  time: number;
  symbol: string;
  side: "BUY" | "SELL";
  price: number;
  quantity: string;
  usdtAmount: string;
  strategy: string;
  status: "SUCCESS" | "TEST_OK" | "FAILED";
  error?: string;
  orderId?: number;
}

// ─── Component ────────────────────────────────────────────────
export default function LiveTradingPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-sm text-muted-foreground">กำลังโหลด...</p>
      </div>
    }>
      <LiveTradingContent />
    </Suspense>
  );
}

function LiveTradingContent() {
  const searchParams = useSearchParams();

  // Credentials จาก searchParams (ไม่เก็บลง localStorage)
  const [apiKey] = useState(() => searchParams?.get("apiKey") ?? "");
  const [secretKey] = useState(() => searchParams?.get("secretKey") ?? "");
  const hasCredentials = !!(apiKey && secretKey);

  // Control state
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [interval, setInterval_] = useState<Interval>("15m");
  const [strategyId, setStrategyId] = useState<StrategyId>("supertrend");
  const [usdtAmount, setUsdtAmount] = useState("");
  const [pollSec, setPollSec] = useState(() => DEFAULT_POLL_SEC["15m"]);
  const [isTestMode, setIsTestMode] = useState(true);
  const [isRunning, setIsRunning] = useState(false);

  // USDT balance state
  const [usdtBalance, setUsdtBalance] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const hasUsdt = usdtBalance !== null && usdtBalance > 0;

  // Data state
  const [klines, setKlines] = useState<KlineData[]>([]);
  const [indicators, setIndicators] = useState<AllIndicators | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Trade history (in-memory only — lost on refresh)
  const [trades, setTrades] = useState<LiveTrade[]>([]);
  const [lastSignal, setLastSignal] = useState<"BUY" | "SELL" | "HOLD" | null>(null);

  // Position tracking
  const [inPosition, setInPosition] = useState(false);
  const [entryPrice, setEntryPrice] = useState<number | null>(null);

  // Backtest state
  const [strategyParams, setStrategyParams] = useState<Record<string, number>>(
    () => ({ ...STRATEGIES.find(s => s.id === "supertrend")!.params })
  );
  const [feesPct, setFeesPct] = useState("0.1");
  const [btResult, setBtResult] = useState<BacktestResult | null>(null);
  const [btRunning, setBtRunning] = useState(false);
  const [allBtResults, setAllBtResults] = useState<{ strategyId: StrategyId; name: string; result: BacktestResult }[] | null>(null);
  const [allBtRunning, setAllBtRunning] = useState(false);
  const [allBtExpanded, setAllBtExpanded] = useState<Set<StrategyId>>(new Set());

  // Network status
  const [isOnline, setIsOnline] = useState(true);

  // Refs
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastProcessedTime = useRef<number>(0);

  // ─── Network listener ───────────────────────────────────────
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => {
      setIsOnline(false);
      stopTrading();
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Fetch USDT balance ─────────────────────────────────────
  const fetchUsdtBalance = useCallback(async () => {
    if (!hasCredentials) return;
    setLoadingBalance(true);
    try {
      const res = await fetch("/api/binance/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, secretKey }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.balances)) {
        const usdt = data.balances.find(
          (b: { asset: string; free: string }) => b.asset === "USDT"
        );
        setUsdtBalance(usdt ? parseFloat(usdt.free) : 0);
      } else {
        setUsdtBalance(null);
      }
    } catch {
      setUsdtBalance(null);
    } finally {
      setLoadingBalance(false);
    }
  }, [hasCredentials, apiKey, secretKey]);

  // Fetch balance on mount
  useEffect(() => {
    if (hasCredentials) fetchUsdtBalance();
  }, [hasCredentials, fetchUsdtBalance]);

  // ─── Warn before unload ────────────────────────────────────
  useEffect(() => {
    if (!isRunning) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isRunning]);

  // ─── Fetch klines ──────────────────────────────────────────
  const fetchKlines = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/klines?symbol=${symbol}&interval=${interval}&limit=500`
      );
      if (!res.ok) throw new Error(`Klines API error: ${res.status}`);
      const raw: BinanceKlineRaw[] = await res.json();
      const parsed = raw.map(parseKline);
      setKlines(parsed);
      setError("");
      return parsed;
    } catch (err) {
      setError(err instanceof Error ? err.message : "ดึงข้อมูลไม่สำเร็จ");
      return null;
    }
  }, [symbol, interval]);

  // ─── Get signal from strategy ──────────────────────────────
  const getLatestSignal = useCallback(
    (klinesData: KlineData[]): "BUY" | "SELL" | "HOLD" => {
      if (klinesData.length < 50) return "HOLD";

      const ind = computeAll(klinesData);
      setIndicators(ind);

      // ดึง signal จาก indicator ที่เลือก
      const strategyMap: Record<StrategyId, ("BUY" | "SELL" | null)[]> = {
        rsi: ind.rsi.map(v => {
          if (v === null) return null;
          if (v < 30) return "BUY";
          if (v > 70) return "SELL";
          return null;
        }),
        cdc_actionzone: ind.cdcActionZone.signal,
        smc: ind.smc.signal,
        cm_macd: ind.cmMacd.signal,
        supertrend: ind.supertrend.signal,
        squeeze_momentum: ind.squeezeMomentum.signal,
        msb_ob: ind.msbOb.signal,
        support_resistance: ind.supportResistance.signal,
        trendlines: ind.trendlines.signal,
        ut_bot: ind.utBot.signal,
      };

      const signals = strategyMap[strategyId];
      // ตรวจสัญญาณแท่งล่าสุด (index -2 เพราะแท่งสุดท้ายยังไม่ปิด)
      const checkIdx = klinesData.length - 2;
      if (checkIdx < 0) return "HOLD";

      const sig = signals[checkIdx];
      return sig ?? "HOLD";
    },
    [strategyId]
  );

  // ─── Execute order ─────────────────────────────────────────
  const executeOrder = useCallback(
    async (side: "BUY" | "SELL", price: number) => {
      if (!usdtAmount || !hasCredentials) return;

      // คำนวณจำนวนเหรียญโดยประมาณ (USDT / ราคา) สำหรับแสดงใน history
      const estimatedQty = price > 0 ? (parseFloat(usdtAmount) / price).toFixed(8) : "0";

      const trade: LiveTrade = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        time: Date.now(),
        symbol,
        side,
        price,
        quantity: estimatedQty,
        usdtAmount,
        strategy: STRATEGIES.find(s => s.id === strategyId)?.name || strategyId,
        status: "FAILED",
      };

      try {
        const orderBody: Record<string, string | boolean> = {
          apiKey,
          secretKey,
          symbol,
          side,
          type: "MARKET",
          quoteOrderQty: usdtAmount, // ส่งเป็นจำนวน USDT
          testOrder: isTestMode,
        };
        const res = await fetch("/api/binance/order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(orderBody),
        });
        const data = await res.json();

        if (!res.ok) {
          trade.status = "FAILED";
          trade.error = data.details?.msg || data.error || "Order failed";
        } else {
          trade.status = isTestMode ? "TEST_OK" : "SUCCESS";
          trade.orderId = data.orderId;
          // ใช้ executedQty จริงจาก Binance ถ้ามี
          if (data.executedQty) trade.quantity = data.executedQty;

          // Track position
          if (side === "BUY") {
            setInPosition(true);
            setEntryPrice(price);
          } else {
            setInPosition(false);
            setEntryPrice(null);
          }

          // อัพเดท balance หลังส่ง order สำเร็จ
          fetchUsdtBalance();
        }
      } catch (err) {
        trade.status = "FAILED";
        trade.error = err instanceof Error ? err.message : "Network error";
      }

      setTrades(prev => [trade, ...prev]);
    },
    [apiKey, secretKey, symbol, usdtAmount, strategyId, isTestMode, hasCredentials, fetchUsdtBalance]
  );

  // ─── Live polling cycle ────────────────────────────────────
  const runCycle = useCallback(async () => {
    const data = await fetchKlines();
    if (!data || data.length === 0) return;

    const latestTime = data[data.length - 2]?.openTime || 0;
    // ข้ามถ้าแท่งเดิม (ป้องกันส่ง order ซ้ำ)
    if (latestTime <= lastProcessedTime.current) return;
    lastProcessedTime.current = latestTime;

    const signal = getLatestSignal(data);
    setLastSignal(signal);

    const currentPrice = +data[data.length - 1].close;

    // ส่งคำสั่งซื้อขายตามสัญญาณ
    if (signal === "BUY" && !inPosition) {
      await executeOrder("BUY", currentPrice);
    } else if (signal === "SELL" && inPosition) {
      await executeOrder("SELL", currentPrice);
    }
  }, [fetchKlines, getLatestSignal, executeOrder, inPosition]);

  // ─── Start / Stop ──────────────────────────────────────────
  const startTrading = useCallback(async () => {
    if (!hasCredentials || !usdtAmount) return;
    setIsRunning(true);
    setError("");
    lastProcessedTime.current = 0;

    // รอบแรก
    setLoading(true);
    await runCycle();
    setLoading(false);

    // ตั้ง interval polling
    intervalRef.current = setInterval(runCycle, pollSec * 1000);
  }, [hasCredentials, usdtAmount, pollSec, runCycle]);

  const stopTrading = useCallback(() => {
    setIsRunning(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  // ─── Manual fetch (preview only) ──────────────────────────
  const previewChart = async () => {
    setLoading(true);
    const data = await fetchKlines();
    if (data) {
      const ind = computeAll(data);
      setIndicators(ind);
    }
    setLoading(false);
  };

  // ─── Run Backtest ───────────────────────────────────────────
  const runBt = useCallback(() => {
    if (klines.length < 50) { setError("ต้องมีอย่างน้อย 50 แท่งเทียนเพื่อรัน Backtest"); return; }
    setBtRunning(true);
    setError("");
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
    setError("");
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

  // ─── Stats ─────────────────────────────────────────────────
  const stats = useMemo(() => {
    const buys = trades.filter(t => t.side === "BUY" && t.status !== "FAILED");
    const sells = trades.filter(t => t.side === "SELL" && t.status !== "FAILED");
    const failed = trades.filter(t => t.status === "FAILED");
    let unrealizedPnl: number | null = null;
    if (inPosition && entryPrice && klines.length > 0) {
      const currentPrice = +klines[klines.length - 1].close;
      unrealizedPnl = ((currentPrice - entryPrice) / entryPrice) * 100;
    }
    return { buys: buys.length, sells: sells.length, failed: failed.length, unrealizedPnl };
  }, [trades, inPosition, entryPrice, klines]);

  // ─── Render ─────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="mx-auto max-w-6xl space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LightningIcon className="size-5 text-primary" weight="duotone" />
            <h1 className="text-lg font-semibold">Live Trading</h1>
            {isRunning && (
              <Badge variant="default" className="gap-1 animate-pulse bg-green-600">
                <span className="size-1.5 rounded-full bg-white" />
                กำลังทำงาน
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {isOnline ? (
              <Badge variant="outline" className="gap-1 text-green-600">
                <WifiHighIcon weight="bold" className="size-3" />
                Online
              </Badge>
            ) : (
              <Badge variant="destructive" className="gap-1">
                <WifiSlashIcon weight="bold" className="size-3" />
                Offline
              </Badge>
            )}
            <Button variant="outline" size="sm">
              <Link href="/trading/Binance" className="flex items-center gap-1">
                <ArrowLeftIcon weight="bold" className="size-3.5" />
                Binance Trading
              </Link>
            </Button>
          </div>
        </div>

        {/* คำอธิบาย + คำเตือน */}
        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-start gap-2">
              <LightningIcon weight="duotone" className="size-5 text-blue-500 mt-0.5 shrink-0" />
              <div className="text-sm space-y-1">
                <p className="font-semibold text-blue-500">
                  Live Trading คืออะไร?
                </p>
                <p className="text-muted-foreground">
                  &quot;Live Trading&quot; คือการ<strong>ส่งคำสั่งซื้อและขายจริง</strong>ไปยัง Binance โดยอัตโนมัติ
                  ระบบจะดึงข้อมูลราคาเหรียญตามช่วงเวลาที่เลือก วิเคราะห์สัญญาณจาก Indicator ที่เลือก
                  และเมื่อได้สัญญาณ BUY หรือ SELL จะส่งคำสั่งซื้อขายไปยัง Binance ให้โดยอัตโนมัติ
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="p-4 space-y-2">
            <div className="flex items-start gap-2">
              <WarningIcon weight="duotone" className="size-5 text-yellow-500 mt-0.5 shrink-0" />
              <div className="text-sm space-y-1">
                <p className="font-semibold text-yellow-500">
                  คำเตือนสำคัญ
                </p>
                <ul className="text-muted-foreground list-disc list-inside space-y-0.5">
                  <li>
                    API Key และ Secret Key <strong>ไม่ได้ถูกบันทึก</strong>ไว้ในเครื่อง
                    — ส่งผ่าน URL เท่านั้น
                  </li>
                  <li>
                    หาก<strong>รีเฟรชหน้าจอ (Refresh)</strong> API Key/Secret Key จะหายไป
                    ต้องกลับไปหน้า Binance Trading เพื่อเชื่อมต่อใหม่
                  </li>
                  <li>
                    หาก<strong>เน็ตหลุด (Offline)</strong> ระบบจะ<strong>หยุดการทำงานทันที</strong>
                    และไม่ส่งคำสั่งซื้อขายจนกว่าจะกลับมาออนไลน์และกด Start ใหม่
                  </li>
                  <li>
                    ประวัติการเทรดจะ<strong>หายไป</strong>เมื่อรีเฟรชหน้าจอ (เก็บใน Memory เท่านั้น)
                  </li>
                  <li>
                    แนะนำให้เริ่มด้วย <strong>Test Mode</strong> ก่อนเสมอ เพื่อทดสอบระบบโดยไม่เสียเงินจริง
                  </li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ไม่มี Credentials */}
        {!hasCredentials && (
          <Card className="border-red-500/30">
            <CardContent className="p-6 text-center space-y-3">
              <WarningIcon weight="duotone" className="size-10 text-red-500 mx-auto" />
              <p className="font-semibold text-red-500">ไม่พบ API Key</p>
              <p className="text-sm text-muted-foreground">
                กรุณากลับไปหน้า Binance Trading เพื่อเชื่อมต่อ API Key ก่อน
                แล้วกดปุ่ม &quot;Live Trading&quot; เพื่อเข้าหน้านี้พร้อม Key
              </p>
              <Button>
                <Link href="/trading/Binance">ไปหน้า Binance Trading</Link>
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Control Panel */}
        {hasCredentials && (
          <Card>
            <CardHeader className="border-b pb-3">
              <CardTitle className="text-sm">ตั้งค่า Live Trading</CardTitle>
              <CardDescription>เลือกเหรียญ, ช่วงเวลา, Strategy และจำนวนที่ต้องการเทรด</CardDescription>
            </CardHeader>
            <CardContent className="p-4 space-y-4">
              {/* Row 1: Symbol + Interval + Polling + Strategy */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                {/* Symbol */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">เหรียญ</label>
                  <Select value={symbol} onValueChange={v => { if (v) setSymbol(v); if (isRunning) stopTrading(); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {POPULAR_SYMBOLS.map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Interval */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">ช่วงเวลา</label>
                  <Select value={interval} onValueChange={v => { if (v) { setInterval_(v as Interval); setPollSec(DEFAULT_POLL_SEC[v] || 30); } if (isRunning) stopTrading(); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(INTERVAL_GROUPS).map(([group, intervals]) => (
                        <div key={group}>
                          <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground">{group}</div>
                          {intervals.map(iv => (
                            <SelectItem key={iv} value={iv}>{iv}</SelectItem>
                          ))}
                        </div>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Polling Interval */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Polling ดึงข้อมูลราคาอัพเดท (วินาที)
                  </label>
                  <Select
                    value={String(pollSec)}
                    onValueChange={v => { if (v) { setPollSec(Number(v)); if (isRunning) stopTrading(); } }}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {POLL_OPTIONS.map(sec => {
                        let label: string;
                        if (sec < 60) label = `${sec} วินาที`;
                        else if (sec < 3600) label = `${sec / 60} นาที`;
                        else if (sec < 86400) label = `${sec / 3600} ชั่วโมง`;
                        else label = `${sec / 86400} วัน`;
                        return (
                          <SelectItem key={sec} value={String(sec)}>
                            {label}
                            {sec === DEFAULT_POLL_SEC[interval] ? " (แนะนำ)" : ""}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                </div>

                {/* Strategy */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Strategy</label>
                  <Select value={strategyId} onValueChange={v => { if (v) setStrategyId(v as StrategyId); if (isRunning) stopTrading(); }}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent className="w-[270px]">
                      {STRATEGIES.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* USDT Balance */}
              <div className="flex items-center gap-3 rounded-md border p-3">
                <WalletIcon weight="duotone" className="size-5 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-muted-foreground">ยอด USDT ที่ใช้ได้</p>
                  {loadingBalance ? (
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <SpinnerIcon weight="bold" className="size-3.5 animate-spin" />
                      กำลังโหลด...
                    </div>
                  ) : usdtBalance !== null ? (
                    <p className={`text-sm font-bold font-mono ${hasUsdt ? "text-green-600" : "text-red-500"}`}>
                      {usdtBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                    </p>
                  ) : (
                    <p className="text-sm text-red-500">ไม่สามารถดึงยอดได้</p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={fetchUsdtBalance}
                  disabled={loadingBalance}
                >
                  <ArrowsClockwiseIcon weight="bold" className={`size-3.5 ${loadingBalance ? "animate-spin" : ""}`} />
                </Button>
              </div>

              {/* ไม่มี USDT */}
              {usdtBalance !== null && !hasUsdt && (
                <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 flex items-start gap-2">
                  <WarningIcon weight="fill" className="size-4 text-red-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-red-500 font-medium">
                    ไม่มียอด USDT ในบัญชี — ไม่สามารถซื้อขายได้ กรุณาฝาก USDT เข้าบัญชี Binance ก่อน
                  </p>
                </div>
              )}

              {/* Row 2: USDT Amount + Mode + Actions */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                {/* USDT Amount */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground">จำนวน (USDT)</label>
                    {hasUsdt && (
                      <button
                        type="button"
                        className="text-[10px] text-primary hover:underline"
                        onClick={() => setUsdtAmount(usdtBalance!.toFixed(2))}
                        disabled={isRunning}
                      >
                        ใช้ทั้งหมด
                      </button>
                    )}
                  </div>
                  <Input
                    type="number"
                    step="any"
                    min="0"
                    placeholder="เช่น 10, 50, 100"
                    value={usdtAmount}
                    onChange={e => setUsdtAmount(e.target.value)}
                    disabled={isRunning || !hasUsdt}
                  />
                  {usdtAmount && parseFloat(usdtAmount) > 0 && usdtBalance !== null && parseFloat(usdtAmount) > usdtBalance && (
                    <p className="text-[10px] text-red-500">จำนวนเกินยอด USDT ที่มี</p>
                  )}
                </div>

                {/* Test Mode Toggle */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">โหมด</label>
                  <Select
                    value={isTestMode ? "test" : "real"}
                    onValueChange={v => { if (v) setIsTestMode(v === "test"); if (isRunning) stopTrading(); }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="w-[230px]">
                      <SelectItem value="test">
                        Test Mode (ไม่ส่ง Order จริง)
                      </SelectItem>
                      <SelectItem value="real">
                        Real Mode (ส่ง Order จริง!)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">
                    {isTestMode
                      ? "ส่งสัญญาณอย่างเดียว — Binance ตรวจสอบคำสั่งแต่ไม่ส่ง Order จริง ไม่มีการซื้อขายเกิดขึ้น"
                      : "ส่งคำสั่งซื้อขายจริงไปยัง Binance — มีการใช้เงินจริง!"}
                  </p>
                </div>

                {/* Preview */}
                <Button
                  variant="outline"
                  onClick={previewChart}
                  disabled={loading || isRunning}
                >
                  <ArrowsClockwiseIcon weight="bold" className={`size-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
                  ดูกราฟ
                </Button>

                {/* Start / Stop */}
                {!isRunning ? (
                  <Button
                    onClick={startTrading}
                    disabled={!usdtAmount || !hasUsdt || !isOnline || loading || (usdtBalance !== null && parseFloat(usdtAmount) > usdtBalance)}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <PlayIcon weight="fill" className="size-3.5 mr-1" />
                    Start Trading
                  </Button>
                ) : (
                  <Button
                    variant="destructive"
                    onClick={stopTrading}
                  >
                    <StopIcon weight="fill" className="size-3.5 mr-1" />
                    Stop Trading
                  </Button>
                )}
              </div>

              {/* Real mode warning */}
              {!isTestMode && (
                <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 flex items-start gap-2">
                  <WarningIcon weight="fill" className="size-4 text-red-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-red-500 font-medium">
                    Real Mode — ระบบจะส่งคำสั่งซื้อขายจริงไปยัง Binance! กรุณาตรวจสอบจำนวนและ Strategy ให้ถูกต้องก่อนกด Start
                  </p>
                </div>
              )}

              {/* Strategy description */}
              <div className="text-xs text-muted-foreground bg-muted/50 rounded-md p-2.5">
                <span className="font-medium">
                  {STRATEGIES.find(s => s.id === strategyId)?.name}:
                </span>{" "}
                {STRATEGIES.find(s => s.id === strategyId)?.descriptionTh}
              </div>

              {error && (
                <div className="text-xs text-red-500 bg-red-500/5 rounded-md p-2">
                  {error}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Status Bar */}
        {isRunning && (
          <div className="flex items-center gap-4 text-xs bg-muted/50 rounded-md p-3">
            <div className="flex items-center gap-1.5">
              <ClockIcon weight="bold" className="size-3.5" />
              <span>Polling ทุก {pollSec < 60 ? `${pollSec}s` : pollSec < 3600 ? `${pollSec / 60}m` : pollSec < 86400 ? `${pollSec / 3600}h` : `${pollSec / 86400}d`}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span>สัญญาณล่าสุด:</span>
              {lastSignal === "BUY" && (
                <Badge className="bg-green-600 text-[10px] px-1.5 py-0">
                  <ArrowUpIcon weight="bold" className="size-2.5 mr-0.5" /> BUY
                </Badge>
              )}
              {lastSignal === "SELL" && (
                <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                  <ArrowDownIcon weight="bold" className="size-2.5 mr-0.5" /> SELL
                </Badge>
              )}
              {lastSignal === "HOLD" && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">HOLD</Badge>
              )}
              {lastSignal === null && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">รอข้อมูล...</Badge>
              )}
            </div>
            {inPosition && entryPrice && (
              <div className="flex items-center gap-1.5">
                <span>เข้า Position ที่:</span>
                <span className="font-mono font-medium">{entryPrice.toLocaleString()}</span>
                {stats.unrealizedPnl !== null && (
                  <Badge
                    variant={stats.unrealizedPnl >= 0 ? "default" : "destructive"}
                    className="text-[10px] px-1.5 py-0"
                  >
                    {stats.unrealizedPnl >= 0 ? "+" : ""}{stats.unrealizedPnl.toFixed(2)}%
                  </Badge>
                )}
              </div>
            )}
          </div>
        )}


        {/* Trade History */}
        {hasCredentials && (
          <Card>
            <CardHeader className="border-b pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">ประวัติคำสั่งซื้อขาย</CardTitle>
                {trades.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground"
                    onClick={() => setTrades([])}
                  >
                    <TrashIcon weight="bold" className="size-3 mr-1" />
                    ล้างประวัติ
                  </Button>
                )}
              </div>
              <CardDescription>
                ประวัติจะหายไปเมื่อรีเฟรชหน้าจอ (เก็บใน Memory เท่านั้น)
              </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {trades.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  ยังไม่มีประวัติ — กด Start Trading เพื่อเริ่ม
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-xs">เวลา</TableHead>
                        <TableHead className="text-xs">เหรียญ</TableHead>
                        <TableHead className="text-xs">Side</TableHead>
                        <TableHead className="text-xs">ราคา</TableHead>
                        <TableHead className="text-xs">USDT</TableHead>
                        <TableHead className="text-xs">จำนวนเหรียญ</TableHead>
                        <TableHead className="text-xs">Strategy</TableHead>
                        <TableHead className="text-xs">สถานะ</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {trades.map(trade => (
                        <TableRow key={trade.id}>
                          <TableCell className="text-xs font-mono">
                            {new Date(trade.time).toLocaleString("th-TH", {
                              hour: "2-digit",
                              minute: "2-digit",
                              second: "2-digit",
                              day: "2-digit",
                              month: "2-digit",
                            })}
                          </TableCell>
                          <TableCell className="text-xs font-medium">{trade.symbol}</TableCell>
                          <TableCell className="text-xs">
                            <Badge
                              variant={trade.side === "BUY" ? "default" : "destructive"}
                              className="text-[10px] px-1.5 py-0"
                            >
                              {trade.side === "BUY" ? (
                                <ArrowUpIcon weight="bold" className="size-2.5 mr-0.5" />
                              ) : (
                                <ArrowDownIcon weight="bold" className="size-2.5 mr-0.5" />
                              )}
                              {trade.side}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-xs font-mono">
                            {trade.price.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-xs font-mono">{trade.usdtAmount} USDT</TableCell>
                          <TableCell className="text-xs font-mono">{trade.quantity}</TableCell>
                          <TableCell className="text-xs">{trade.strategy}</TableCell>
                          <TableCell className="text-xs">
                            {trade.status === "SUCCESS" && (
                              <Badge className="bg-green-600 text-[10px] px-1.5 py-0">สำเร็จ</Badge>
                            )}
                            {trade.status === "TEST_OK" && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Test OK</Badge>
                            )}
                            {trade.status === "FAILED" && (
                              <Badge variant="destructive" className="text-[10px] px-1.5 py-0" title={trade.error}>
                                ล้มเหลว
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Chart */}
        {klines.length > 0 && (
          <Card>
            <CardContent className="p-2">
              <KlineGraph
                klines={klines}
                indicators={indicators}
                btResult={btResult}
                strategyId={strategyId}
              />
            </CardContent>
          </Card>
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
                <p className="text-xs text-muted-foreground text-center py-6">กดปุ่ม &quot;รัน Backtest ทั้งหมด&quot; เพื่อเปรียบเทียบทุกกลยุท��์</p>
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
                                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                                        <StatCard label="กำไรเฉลี่ย" value={`+${r.avgWinPct.toFixed(2)}%`} color="text-emerald-500" size="sm" />
                                        <StatCard label="ขาดทุนเ���ลี่ย" value={`${r.avgLossPct.toFixed(2)}%`} color="text-red-500" size="sm" />
                                        <StatCard label="เทรดที่ดีที่สุด" value={`+${r.bestTradePct.toFixed(2)}%`} color="text-emerald-500" size="sm" />
                                        <StatCard label="เทรดที่แย่ที่สุด" value={`${r.worstTradePct.toFixed(2)}%`} color="text-red-500" size="sm" />
                                      </div>
                                      <div className="grid grid-cols-3 gap-2">
                                        <StatCard label="แท่งเทียนถือเฉลี��ย" value={`${r.avgBarsHeld.toFixed(1)}`} size="sm" />
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

                  {/* Best vs Worst summary */}
                  {allBtResults.length >= 2 && (
                    <div className="flex gap-3">
                      <Card size="sm" className="flex-1 ring-emerald-500/20">
                        <CardContent className="py-2.5">
                          <p className="text-[10px] text-muted-foreground">กลยุทธ์��ี่ดีที่สุ���</p>
                          <p className="text-sm font-semibold text-emerald-500">{allBtResults[0].name}</p>
                          <p className="text-xs tabular-nums text-emerald-500">+{allBtResults[0].result.totalPnlPct.toFixed(2)}%</p>
                        </CardContent>
                      </Card>
                      <Card size="sm" className="flex-1 ring-red-500/20">
                        <CardContent className="py-2.5">
                          <p className="text-[10px] text-muted-foreground">กล���ุทธ์ที่แย่ที่สุด</p>
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
                {/* {Object.keys(strategyParams).length > 0 && (
                  <div className="flex flex-wrap items-end space-x-4">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground w-full">ปรับค่าพารามิเตอร���</p>
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
                              {key === "sellThreshold" && "ค่า RSI สูงกว่านี้ = สัญญาณขา���"}
                            </p>
                          )}
                          {strategyId === "smc" && (
                            <p className="text-[9px] text-muted-foreground/70">
                              {key === "swingSize" && "แท่งเทียนหา pivot หลัก (10-100) — ค่าน้อย=ไว ค่ามาก=จับเทรนด์ใหญ่"}
                              {key === "internalSize" && "แท่งเทียนหาโครงสร้างย่อย (2-15) — ค���าน้อย=สัญญาณเยอะ ค่ามาก=กรอง noise"}
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
                              {key === "atrPeriod" && "แท่งเทียนคำนวณ ATR (5-20) — ค่าน้อย=Band ไว ค่���มาก=Band เสถียร"}
                              {key === "multiplier" && "ตัวคูณ ATR (1.0-6.0) — ค่าน้อย=Band แคบ สัญญาณเยอะ ค่ามาก=Band กว้าง จับเทรนด์ใ���ญ่"}
                            </p>
                          )}
                          {strategyId === "squeeze_momentum" && (
                            <p className="text-[9px] text-muted-foreground/70">
                              {key === "bbLength" && "Bollinger Bands period (10-30) — ค่าน้อย=BB แคบ Squeeze บ่อย ���่ามาก=BB กว้าง"}
                              {key === "bbMult" && "BB Multiplier (1.0-3.0) — ค่าน้อย=BB แคบ ค่ามาก=BB กว้าง"}
                              {key === "kcLength" && "Keltner Channel period (10-30) — ค่าน้อย=KC ไว ค่ามาก=KC เสถียร"}
                              {key === "kcMult" && "KC Multiplier (1.0-3.0) — ค่���น้อย=Squeeze ง่าย ���่ามาก=Squeeze ยาก"}
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
                              {key === "rightBars" && "Right Bars (5-30) — ���ท่งขวาของ pivot ค่ามาก=ยืนยันชัดกว่าแต่ช้า"}
                              {key === "volumeThresh" && "Volume % (10-50) — Volume oscillator ขั้นต่ำสำหรับ break ที่มีนัย"}
                            </p>
                          )}
                          {strategyId === "trendlines" && (
                            <p className="text-[9px] text-muted-foreground/70">
                              {key === "trendLength" && "Swing Lookback (5-30) — ��่าน้อย=เส้นเทรนด์เปลี่ยนบ่อย ค่ามาก=เสถียร"}
                              {key === "trendMult" && "Slope Mult (0.5-3.0) — ��่ามาก=เส้นเทรนด์ชันขึ้น break ง่ายขึ้น"}
                            </p>
                          )}
                          {strategyId === "ut_bot" && (
                            <p className="text-[9px] text-muted-foreground/70">
                              {key === "keyValue" && "Key Value (0.5-5) — ตัวคู��� ATR ค่าน้อย=ไว ค่ามาก=กรอง noise"}
                              {key === "utAtrPeriod" && "ATR Period (5-20) — ค��าน้อย=trailing stop ไว ค่ามาก=เรียบกว่า"}
                            </p>
                          )}
                        </div>
                      </Field>
                    ))}
                  </div>
                )} */}

                {/* RSI explanation */}
                {strategyId === "rsi" && (
                  <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2.5 space-y-2">
                    <p className="text-[11px] font-medium text-foreground/90">RSI (Relative Strength Index) คืออะไร?</p>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      RSI เป็นตัวชี้วัดโมเมนตัม (Momentum Oscillator) ที่วัดความเร็วและขนาดของการเปลี่ยนแปลงราคา
                      โดยคำนวณจากอัตราส่วนของ <span className="text-emerald-500/80">ค่าเฉลี่ยของราคาที่เพิ่มขึ้น (Average Gain)</span> กับ <span className="text-red-500/80">ค่า���ฉลี่ยของราคาที่ลดลง (Average Loss)</span> ในช่วง Period ที่กำหนด
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
                      โดยตรวจจับจุดกลับตัวของราคา (Pivot Points) แล้ววิเคราะห์ว่าราคาทะลุจุดสำคัญอย่���งไร
                    </p>
                    <div className="space-y-1 text-[10px]">
                      <p className="font-medium text-foreground/80">สัญญาณ Backtest:</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <span className="text-emerald-500">BUY → Bullish CHoCH (กลับตัวขึ้น) หรือ Bullish BOS ใน Discount/Equilibrium Zone</span>
                        <span className="text-red-500">SELL → Bearish CHoCH (กลับตัวลง) หรือ Bearish BOS ใน Premium/Equilibrium Zone</span>
                      </div>
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
                    </p>
                    <div className="space-y-1 text-[10px]">
                      <p className="font-medium text-foreground/80">สัญญาณ:</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <span className="text-emerald-500">BUY → MACD ตัดขึ้นเหนือ Signal Line (Golden Cross)</span>
                        <span className="text-red-500">SELL → MACD ตัดลงใต�� Signal Line (Death Cross)</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Supertrend explanation */}
                {strategyId === "supertrend" && (
                  <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2.5 space-y-2">
                    <p className="text-[11px] font-medium text-foreground/90">Supertrend คืออะไร?</p>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      Supertrend เป็นตัวชี้วัดแบบ Trend-Following ที่ใช้ ATR สร้างแถบราคาบน-ล่าง
                      เมื่อราคาทะลุแถบจะเกิดสัญญาณเปลี่ยนเทรนด์
                    </p>
                    <div className="space-y-1 text-[10px]">
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <span className="text-emerald-500">BUY → เทรนด์เปลี่ยนจากขาลงเป็นขาข��้น</span>
                        <span className="text-red-500">SELL → เทรนด์เปลี่ยน��ากขาขึ้นเป็นขาลง</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Squeeze Momentum explanation */}
                {strategyId === "squeeze_momentum" && (
                  <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2.5 space-y-2">
                    <p className="text-[11px] font-medium text-foreground/90">Squeeze Momentum Indicator [LazyBear] คืออะไร?</p>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      เมื่อ Bollinger Bands หดตัวเข้าไปอยู่ภายใน Keltner Channels = ตลาดกำลังบีบตัว (Squeeze)
                      เมื่อ Squeeze คลายตัว ราคามักจะพุ่งแรงไปในทิศทางของ Momentum
                    </p>
                    <div className="space-y-1 text-[10px]">
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <span className="text-emerald-500">BUY → Momentum ข้ามขึ้นเหนือ 0</span>
                        <span className="text-red-500">SELL → Momentum ข้ามลงใต�� 0</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* MSB-OB explanation */}
                {strategyId === "msb_ob" && (
                  <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2.5 space-y-2">
                    <p className="text-[11px] font-medium text-foreground/90">Market Structure Break &amp; Order Block (MSB-OB) คื��อะไร?</p>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      ใช้ ZigZag ตรวจจับ Swing Points แล้ววิเคราะห์ว่าราคา Break โครงสร้างตลาดเมื่อไหร่ (MSB)
                    </p>
                    <div className="space-y-1 text-[10px]">
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <span className="text-emerald-500">BUY → Bullish MSB (โครงสร้างเปลี่ยนเป็นขาข���้น)</span>
                        <span className="text-red-500">SELL → Bearish MSB (โครงสร้���งเปลี่ยนเป็นขาลง)</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* S/R explanation */}
                {strategyId === "support_resistance" && (
                  <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2.5 space-y-2">
                    <p className="text-[11px] font-medium text-foreground/90">Support &amp; Resistance Levels with Breaks [LuxAlgo] คืออะไร?</p>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      ตรวจจับ Pivot High/Low เพื่อวาดเส้น Resistance และ Support
                      เมื่อราคาทะลุเส้นพร้อม Volume ที่สูง = สัญญาณ Break ที่มีนัยสำคัญ
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
                      <span className="text-emerald-500">BUY → ทะลุ Resistance + Volume สูง</span>
                      <span className="text-red-500">SELL → หลุด Support + Volume สูง</span>
                    </div>
                  </div>
                )}

                {/* Trendlines explanation */}
                {strategyId === "trendlines" && (
                  <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2.5 space-y-2">
                    <p className="text-[11px] font-medium text-foreground/90">Trendlines with Breaks [LuxAlgo] คือ���ะไร?</p>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      วาดเส้น Trendline แบบ Dynamic จาก Pivot Points โดยใช้ ATR/Stdev เป็นความชัน
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
                      <span className="text-emerald-500">BUY → ราคาทะลุขึ้นเหนือเส้นแนวต้าน (Upper Break)</span>
                      <span className="text-red-500">SELL �� ราคาหลุดลงใต้เส้นแนวรับ (Lower Break)</span>
                    </div>
                  </div>
                )}

                {/* UT Bot explanation */}
                {strategyId === "ut_bot" && (
                  <div className="rounded-md border border-border/50 bg-muted/30 px-3 py-2.5 space-y-2">
                    <p className="text-[11px] font-medium text-foreground/90">UT Bot Alerts ค��ออะไร?</p>
                    <p className="text-[10px] text-muted-foreground leading-relaxed">
                      ใช้ ATR Trailing Stop ที่ปรับตัวตามทิศทางราคา เมื่อราคาข้ามผ่าน trailing stop = สัญญาณเปลี่ยนเทรนด์
                    </p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
                      <span className="text-emerald-500">BUY → ราคาข้ามข���้นเหนือ ATR Trailing Stop</span>
                      <span className="text-red-500">SELL �� ราคาข้ามลงใต้ ATR Trailing Stop</span>
                    </div>
                  </div>
                )}

              </div>
            </CardContent>
          </Card>
        )}

        {/* Backtest Results */}
        {btResult && <BacktestResults result={btResult} />}

        {/* Stats */}
        {trades.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-[10px] text-muted-foreground">Orders ทั้งหมด</p>
                <p className="text-lg font-bold">{trades.length}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-[10px] text-muted-foreground">BUY สำเร็จ</p>
                <p className="text-lg font-bold text-green-600">{stats.buys}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-[10px] text-muted-foreground">SELL สำเร็จ</p>
                <p className="text-lg font-bold text-red-500">{stats.sells}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <p className="text-[10px] text-muted-foreground">ล้มเหลว</p>
                <p className="text-lg font-bold text-yellow-500">{stats.failed}</p>
              </CardContent>
            </Card>
          </div>
        )}

      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════

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
