"use client";

import { useMemo, useState } from "react";
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
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import {
  GOLD_SYMBOLS,
  findGoldSymbol,
  GOLD_BACKTEST_INTERVALS,
  type GoldBacktestInterval,
} from "./constants";

// Lazy-load TradingView chart — avoids pulling lightweight-charts (~600KB)
// into the initial Gold page bundle.
const KlineGraph = dynamic(() => import("@/app/klines/ui/graph"), {
  ssr: false,
  loading: () => (
    <div className="h-64 flex items-center justify-center text-xs text-muted-foreground border border-dashed rounded">
      กำลังโหลดกราฟ...
    </div>
  ),
});

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function pnlColor(v: number): string {
  return v > 0 ? "text-emerald-500" : v < 0 ? "text-red-500" : "text-muted-foreground";
}

function fmtDateTime(ts: number): string {
  return new Date(ts).toLocaleString("en-US", { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

// ─── Equity Chart (cumulative P&L %) ─────────────────────────────
function EquityChart({ curve, trades }: { curve: number[]; trades: Trade[] }) {
  if (curve.length === 0) return null;
  const step = Math.max(1, Math.floor(curve.length / 240));
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
    <div className="relative h-48 w-full">
      <div className="absolute left-0 right-0 border-t border-dashed border-muted-foreground/30" style={{ top: `${zeroY}%` }} />
      <div className="absolute left-1 text-[9px] text-muted-foreground" style={{ top: `${Math.max(zeroY - 5, 0)}%` }}>0%</div>
      <div className="flex h-full items-end gap-px">
        {sampled.map((val, i) => {
          const h = Math.abs(val) / range * 100;
          const isPos = val >= 0;
          const markers = markerMap.get(i);
          return (
            <div key={i} className="flex-1 flex flex-col justify-end h-full relative">
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
      <div className="absolute top-0 right-1 text-[9px] text-emerald-500 tabular-nums">+{max.toFixed(2)}%</div>
      <div className="absolute bottom-0 right-1 text-[9px] text-red-500 tabular-nums">{min.toFixed(2)}%</div>
    </div>
  );
}

// datetime-local format: YYYY-MM-DDTHH:mm
function fmtDateTimeLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Default backtest date range: last 90 days
function defaultDateRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 90 * 86_400_000);
  return { from: fmtDateTimeLocal(from), to: fmtDateTimeLocal(to) };
}

const DAY_PRESETS = [10, 20, 30, 60, 90] as const;

const TRADES_PAGE_SIZE = 10;

export default function GoldBacktestPanel() {
  // ── Section 1: Settings ──
  const [symbol, setSymbol] = useState<string>(GOLD_SYMBOLS[0].label);
  const [interval, setInterval] = useState<GoldBacktestInterval>("1h");
  const initialRange = useMemo(defaultDateRange, []);
  const [fromDate, setFromDate] = useState(initialRange.from);
  const [toDate, setToDate] = useState(initialRange.to);
  const [feesPct, setFeesPct] = useState("0.1");

  // ── Section 2: Fetch data ──
  const [klines, setKlines] = useState<KlineData[]>([]);
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  // ── Section 3: All Indicators ──
  const [allResults, setAllResults] = useState<{ strategyId: StrategyId; name: string; result: BacktestResult }[] | null>(null);
  const [allRunning, setAllRunning] = useState(false);

  // ── Section 4: Single Indicator ──
  const [strategyId, setStrategyId] = useState<StrategyId>("rsi");
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [running, setRunning] = useState(false);

  // ── Section 6: Trade history pagination ──
  const [tradesPage, setTradesPage] = useState(0);

  const symMeta = findGoldSymbol(symbol);
  const decimals = symMeta?.decimals ?? 2;

  // Compute indicators for the chart (only when we have enough data)
  const indicators = useMemo<AllIndicators | null>(
    () => klines.length >= 15 ? computeAll(klines) : null,
    [klines]
  );

  const handleFetch = async () => {
    if (!symMeta) return;
    setFetching(true);
    setFetchError(null);
    setKlines([]);
    setAllResults(null);
    setResult(null);
    try {
      const from = new Date(fromDate).getTime();
      const to = new Date(toDate).getTime();
      if (isNaN(from) || isNaN(to) || to <= from) {
        throw new Error("ช่วงวันที่ไม่ถูกต้อง (to ต้องหลัง from)");
      }
      const params = new URLSearchParams({
        instrument: symMeta.dukascopy,
        interval,
        from: String(from),
        to: String(to),
      });
      const res = await fetch(`/api/klines-dukascopy?${params}`);
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      const raw: BinanceKlineRaw[] = await res.json();
      const parsed = raw.map(parseKline);
      setKlines(parsed);
    } catch (err) {
      setFetchError(String(err));
    } finally {
      setFetching(false);
    }
  };

  const handleRunAll = async () => {
    if (klines.length < 50) return;
    setAllRunning(true);
    setAllResults(null);
    try {
      const fees = parseFloat(feesPct) || 0.1;
      // Defer to next tick so UI updates "running" state
      await new Promise(r => setTimeout(r, 10));
      const results = STRATEGIES.map(s => ({
        strategyId: s.id,
        name: s.name,
        result: runBacktest(klines, s.id, { ...s.params }, fees),
      })).sort((a, b) => b.result.totalPnlPct - a.result.totalPnlPct);
      setAllResults(results);
    } finally {
      setAllRunning(false);
    }
  };

  const handleRunSingle = async () => {
    if (klines.length < 50) return;
    setRunning(true);
    setResult(null);
    setTradesPage(0);
    try {
      await new Promise(r => setTimeout(r, 10));
      const strat = STRATEGIES.find(s => s.id === strategyId);
      if (!strat) return;
      const fees = parseFloat(feesPct) || 0.1;
      setResult(runBacktest(klines, strategyId, { ...strat.params }, fees));
    } finally {
      setRunning(false);
    }
  };

  const handleReset = () => {
    const range = defaultDateRange();
    setSymbol(GOLD_SYMBOLS[0].label);
    setInterval("1h");
    setFromDate(range.from);
    setToDate(range.to);
    setFeesPct("0.1");
    setKlines([]);
    setFetchError(null);
    setAllResults(null);
    setStrategyId("rsi");
    setResult(null);
    setTradesPage(0);
  };

  return (
    <Card size="sm" className="border-amber-500/30">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-amber-500">🧪 Backtest กลยุทธ์ — Dukascopy</CardTitle>
            <CardDescription>
              ดึงข้อมูลย้อนหลังจาก Dukascopy (ฟรี ไม่ต้อง API key) → ทดสอบกลยุทธ์ → ดูกราฟเงินทุน + ประวัติเทรด
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="text-amber-500 border-amber-500/30 hover:bg-amber-500/10 shrink-0"
            onClick={handleReset}
            title="รีเซ็ตค่าทั้งหมด (symbol, TF, date range, klines, backtest results)"
          >
            ↺ Reset
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* ─── Section 1: Settings ─── */}
        <div className="rounded-md border border-sky-500/20 bg-sky-500/5 p-3 space-y-2">
          <p className="text-[12px] font-semibold text-sky-400">1️⃣ ตั้งค่า — เลือกคู่และช่วงเวลา</p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Field label="คู่ (Symbol)">
              <Select value={symbol} onValueChange={v => { if (v) setSymbol(v); }}>
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
              <Select value={interval} onValueChange={v => { if (v) setInterval(v as GoldBacktestInterval); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GOLD_BACKTEST_INTERVALS.map(i => <SelectItem key={i} value={i}>{i}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="จากวันที่">
              <Input type="datetime-local" value={fromDate} onChange={e => setFromDate(e.target.value)} />
            </Field>
            <Field label="ถึงวันที่">
              <Input type="datetime-local" value={toDate} onChange={e => setToDate(e.target.value)} />
            </Field>
            <Field label="ค่าธรรมเนียม %">
              <Input type="number" step="0.01" value={feesPct} onChange={e => setFeesPct(e.target.value)} />
            </Field>
          </div>
        </div>

        {/* ─── Section 2: Fetch klines ─── */}
        <div className="rounded-md border border-blue-500/20 bg-blue-500/5 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-semibold text-blue-400">2️⃣ ดึงข้อมูลแท่งเทียน (Dukascopy)</p>
            <div className="flex items-center gap-2">
              {klines.length > 0 && (
                <Badge variant="outline" className="text-[10px] text-blue-400 border-blue-500/30">
                  {klines.length.toLocaleString()} แท่ง
                </Badge>
              )}
              <Button size="sm" disabled={fetching} onClick={handleFetch} className="bg-blue-500 hover:bg-blue-600 text-white">
                {fetching ? "⌛ กำลังดึง..." : "▼ ดึงข้อมูล"}
              </Button>
            </div>
          </div>

          {/* Quick day-range presets — set fromDate = toDate - N days (links to Section 1) */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">เลือกช่วงเวลาเร็ว:</span>
            {DAY_PRESETS.map(n => {
              const baseTo = new Date(toDate);
              const validBase = !isNaN(baseTo.getTime()) ? baseTo : new Date();
              const presetFromMs = validBase.getTime() - n * 86_400_000;
              const presetFromStr = fmtDateTimeLocal(new Date(presetFromMs));
              const isActive = fromDate === presetFromStr;
              return (
                <Button
                  key={n}
                  size="xs"
                  variant={isActive ? "default" : "outline"}
                  className={`h-6 px-2 text-[10px] ${isActive ? "bg-blue-500 hover:bg-blue-600 text-white" : "border-blue-500/30 text-blue-500 hover:bg-blue-500/10"}`}
                  onClick={() => setFromDate(presetFromStr)}
                  title={`ตั้ง "จากวันที่" เป็น ${n} วันก่อน "ถึงวันที่"`}
                >
                  {n} วัน
                </Button>
              );
            })}
          </div>

          {fetchError && <p className="text-[11px] text-red-500">{fetchError}</p>}
          {klines.length > 0 && (
            <p className="text-[10px] text-muted-foreground">
              ช่วง: {fmtDateTime(klines[0].openTime)} → {fmtDateTime(klines[klines.length - 1].closeTime)}
            </p>
          )}
          {klines.length === 0 && !fetching && !fetchError && (
            <p className="text-[10px] text-muted-foreground">
              💡 ครั้งแรกอาจใช้เวลา (โหลด .bi5 จาก Dukascopy server) — แนะนำเริ่มจากช่วง 30-90 วันก่อน
            </p>
          )}
        </div>

        {/* ─── Section Graph (TradingView chart with indicators + BUY/SELL markers) ─── */}
        <div className="rounded-md border border-green-500/20 bg-green-500/5 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-semibold text-green-400">📊 กราฟแท่งเทียน + Indicator + สัญญาณซื้อขาย</p>
            {klines.length > 0 && (
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span>{symbol} • {interval}</span>
                {result && (
                  <Badge variant="outline" className={`text-[9px] ${result.totalPnlPct >= 0 ? "text-emerald-500 border-emerald-500/30" : "text-red-500 border-red-500/30"}`}>
                    {result.totalPnlPct >= 0 ? "+" : ""}{result.totalPnlPct.toFixed(2)}% · {result.totalTrades} trades
                  </Badge>
                )}
              </div>
            )}
          </div>

          {klines.length === 0 ? (
            <p className="text-[11px] text-muted-foreground text-center py-6">
              ยังไม่มีข้อมูล — กด &quot;▼ ดึงข้อมูล&quot; ในส่วนที่ 2 ก่อน
            </p>
          ) : (
            <>
              <KlineGraph
                klines={klines}
                indicators={indicators}
                btResult={result}
                strategyId={strategyId}
              />
              <p className="text-[10px] text-muted-foreground">
                💡 ใช้ปุ่ม Overlay/Panel บนกราฟเพื่อเปิด-ปิด indicator แต่ละตัว · BUY/SELL markers จะแสดงหลังจากรัน Backtest ในส่วนที่ 4
              </p>
            </>
          )}
        </div>

        {/* ─── Section 3: All Indicators ─── */}
        <div className="rounded-md border border-purple-500/20 bg-purple-500/5 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-semibold text-purple-400">3️⃣ ทดสอบกลยุทธ์ย้อนหลัง — ทุก Indicator (เปรียบเทียบ)</p>
            <Button
              size="sm"
              disabled={allRunning || klines.length < 50}
              onClick={handleRunAll}
              className="bg-purple-500 hover:bg-purple-600 text-white"
            >
              {allRunning ? "กำลังรัน..." : "▶ รันทั้งหมด"}
            </Button>
          </div>

          {klines.length < 50 && (
            <p className="text-[10px] text-muted-foreground">⚠️ ต้องมีอย่างน้อย 50 แท่งเทียน — ดึงข้อมูลก่อน</p>
          )}

          {allResults && (
            <div className="rounded border border-border/40 overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px]">#</TableHead>
                    <TableHead className="text-[10px]">กลยุทธ์</TableHead>
                    <TableHead className="text-[10px] text-right">P&amp;L รวม</TableHead>
                    <TableHead className="text-[10px] text-right">เทรด</TableHead>
                    <TableHead className="text-[10px] text-right">Win Rate</TableHead>
                    <TableHead className="text-[10px] text-right">Max DD</TableHead>
                    <TableHead className="text-[10px] text-right">PF</TableHead>
                    <TableHead className="text-[10px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {allResults.map((item, idx) => (
                    <TableRow key={item.strategyId} className={idx === 0 ? "bg-emerald-500/4" : ""}>
                      <TableCell className="text-[10px] text-muted-foreground">{idx + 1}</TableCell>
                      <TableCell className="text-[11px] font-medium">{item.name}</TableCell>
                      <TableCell className={`text-[11px] text-right tabular-nums font-medium ${pnlColor(item.result.totalPnlPct)}`}>
                        {item.result.totalPnlPct >= 0 ? "+" : ""}{item.result.totalPnlPct.toFixed(2)}%
                      </TableCell>
                      <TableCell className="text-[10px] text-right tabular-nums">{item.result.totalTrades}</TableCell>
                      <TableCell className="text-[10px] text-right tabular-nums">{item.result.winRate.toFixed(0)}%</TableCell>
                      <TableCell className="text-[10px] text-right tabular-nums text-red-500/80">{item.result.maxDrawdownPct.toFixed(1)}%</TableCell>
                      <TableCell className="text-[10px] text-right tabular-nums">{item.result.profitFactor.toFixed(2)}</TableCell>
                      <TableCell>
                        <Button
                          size="xs"
                          variant="outline"
                          className="text-[9px] h-6 px-2"
                          onClick={() => { setStrategyId(item.strategyId); setResult(item.result); setTradesPage(0); }}
                        >
                          ใช้ตัวนี้ →
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* ─── Section 4: Single Indicator deep dive ─── */}
        <div className="rounded-md border border-violet-500/20 bg-violet-500/5 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-[12px] font-semibold text-violet-400">4️⃣ ทดสอบกลยุทธ์ย้อนหลัง — กับ Indicator ที่เลือก</p>
            <div className="flex items-center gap-2">
              <Select value={strategyId} onValueChange={v => { if (v) setStrategyId(v as StrategyId); }}>
                <SelectTrigger className="w-56 h-8 text-[11px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STRATEGIES.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                disabled={running || klines.length < 50}
                onClick={handleRunSingle}
                className="bg-violet-500 hover:bg-violet-600 text-white"
              >
                {running ? "กำลังรัน..." : "▶ รัน"}
              </Button>
            </div>
          </div>

          {result && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              <div className="rounded border border-border/40 bg-background/50 p-2">
                <p className="text-muted-foreground text-[9px] uppercase tracking-wider">P&amp;L รวม</p>
                <p className={`font-semibold tabular-nums ${pnlColor(result.totalPnlPct)}`}>
                  {result.totalPnlPct >= 0 ? "+" : ""}{result.totalPnlPct.toFixed(2)}%
                </p>
              </div>
              <div className="rounded border border-border/40 bg-background/50 p-2">
                <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Win Rate</p>
                <p className="font-semibold tabular-nums">{result.winRate.toFixed(1)}% ({result.wins}/{result.totalTrades})</p>
              </div>
              <div className="rounded border border-border/40 bg-background/50 p-2">
                <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Max Drawdown</p>
                <p className="font-semibold tabular-nums text-red-500/80">{result.maxDrawdownPct.toFixed(2)}%</p>
              </div>
              <div className="rounded border border-border/40 bg-background/50 p-2">
                <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Profit Factor</p>
                <p className="font-semibold tabular-nums">{result.profitFactor.toFixed(2)}</p>
              </div>
              <div className="rounded border border-border/40 bg-background/50 p-2">
                <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Sharpe</p>
                <p className="font-semibold tabular-nums">{result.sharpeRatio.toFixed(2)}</p>
              </div>
              <div className="rounded border border-border/40 bg-background/50 p-2">
                <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Buy &amp; Hold</p>
                <p className={`font-semibold tabular-nums ${pnlColor(result.buyAndHoldPct)}`}>
                  {result.buyAndHoldPct >= 0 ? "+" : ""}{result.buyAndHoldPct.toFixed(2)}%
                </p>
              </div>
              <div className="rounded border border-border/40 bg-background/50 p-2">
                <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Best / Worst Trade</p>
                <p className="font-semibold tabular-nums">
                  <span className="text-emerald-500">+{result.bestTradePct.toFixed(1)}%</span> / <span className="text-red-500">{result.worstTradePct.toFixed(1)}%</span>
                </p>
              </div>
              <div className="rounded border border-border/40 bg-background/50 p-2">
                <p className="text-muted-foreground text-[9px] uppercase tracking-wider">Avg Hold (bars)</p>
                <p className="font-semibold tabular-nums">{result.avgBarsHeld.toFixed(1)}</p>
              </div>
            </div>
          )}
        </div>

        {/* ─── Section 5: Equity curve ─── */}
        <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-2">
          <p className="text-[12px] font-semibold text-emerald-400">5️⃣ กราฟเงินทุน (กำไร/ขาดทุนสะสม %)</p>
          {result ? (
            <>
              <EquityChart curve={result.equityCurve} trades={result.trades} />
              <p className="text-[10px] text-muted-foreground">
                จุดวงกลม = จุดที่ปิดเทรด (เขียว = กำไร, แดง = ขาดทุน)
              </p>
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground text-center py-6">
              รัน Backtest ในส่วนที่ 4 ก่อน เพื่อแสดงกราฟ
            </p>
          )}
        </div>

        {/* ─── Section 6: Trades table ─── */}
        <div className="rounded-md border border-pink-500/20 bg-pink-500/5 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-semibold text-pink-400">6️⃣ ประวัติการเทรด</p>
            {result && (
              <Badge variant="outline" className="text-[10px] text-pink-400 border-pink-500/30">
                {result.trades.length} trades
              </Badge>
            )}
          </div>

          {!result || result.trades.length === 0 ? (
            <p className="text-[11px] text-muted-foreground text-center py-3">
              {result ? "ไม่มีการเทรดในช่วงนี้" : "รัน Backtest ก่อนเพื่อแสดงประวัติ"}
            </p>
          ) : (() => {
            const trades = result.trades;
            const totalPages = Math.max(1, Math.ceil(trades.length / TRADES_PAGE_SIZE));
            const currentPage = Math.min(tradesPage, totalPages - 1);
            const startIdx = currentPage * TRADES_PAGE_SIZE;
            const pageItems = trades.slice(startIdx, startIdx + TRADES_PAGE_SIZE);
            return (
              <div className="space-y-2">
                <div className="overflow-x-auto rounded border border-border/40">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[10px]">#</TableHead>
                        <TableHead className="text-[10px]">เวลาเข้า</TableHead>
                        <TableHead className="text-[10px] text-right">ราคาเข้า</TableHead>
                        <TableHead className="text-[10px]">เวลาออก</TableHead>
                        <TableHead className="text-[10px] text-right">ราคาออก</TableHead>
                        <TableHead className="text-[10px] text-right">Bars</TableHead>
                        <TableHead className="text-[10px] text-right">P&amp;L%</TableHead>
                        <TableHead className="text-[10px]">เหตุผล</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pageItems.map((t, i) => (
                        <TableRow key={t.entryIdx} className={t.pnlPct >= 0 ? "bg-emerald-500/4" : "bg-red-500/4"}>
                          <TableCell className="text-[10px] text-muted-foreground">{startIdx + i + 1}</TableCell>
                          <TableCell className="text-[10px] tabular-nums whitespace-nowrap">{fmtDateTime(t.entryTime)}</TableCell>
                          <TableCell className="text-[10px] text-right tabular-nums">{t.entryPrice.toFixed(decimals)}</TableCell>
                          <TableCell className="text-[10px] tabular-nums whitespace-nowrap">{fmtDateTime(t.exitTime)}</TableCell>
                          <TableCell className="text-[10px] text-right tabular-nums">{t.exitPrice.toFixed(decimals)}</TableCell>
                          <TableCell className="text-[10px] text-right tabular-nums">{t.bars}</TableCell>
                          <TableCell className={`text-[10px] text-right tabular-nums font-medium ${pnlColor(t.pnlPct)}`}>
                            {t.pnlPct >= 0 ? "+" : ""}{t.pnlPct.toFixed(2)}%
                          </TableCell>
                          <TableCell className="text-[10px] text-muted-foreground">{t.reason}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between gap-2 text-[10px]">
                    <span className="text-muted-foreground">
                      แสดง {startIdx + 1}-{Math.min(startIdx + TRADES_PAGE_SIZE, trades.length)} จาก {trades.length}
                    </span>
                    <div className="flex items-center gap-1">
                      <Button size="xs" variant="outline" disabled={currentPage === 0} onClick={() => setTradesPage(0)} className="h-6 px-2">« แรก</Button>
                      <Button size="xs" variant="outline" disabled={currentPage === 0} onClick={() => setTradesPage(p => Math.max(0, p - 1))} className="h-6 px-2">‹ ก่อน</Button>
                      <span className="px-2 tabular-nums text-muted-foreground">หน้า {currentPage + 1} / {totalPages}</span>
                      <Button size="xs" variant="outline" disabled={currentPage >= totalPages - 1} onClick={() => setTradesPage(p => Math.min(totalPages - 1, p + 1))} className="h-6 px-2">ถัดไป ›</Button>
                      <Button size="xs" variant="outline" disabled={currentPage >= totalPages - 1} onClick={() => setTradesPage(totalPages - 1)} className="h-6 px-2">ท้ายสุด »</Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        <Separator />
        <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2 text-[10px] text-amber-500/80">
          <p className="font-medium">💡 หมายเหตุ Dukascopy:</p>
          <p>• ฟรี ไม่จำกัด ย้อนหลังถึงปี 2003 (ขึ้นกับ instrument)</p>
          <p>• ครั้งแรกอาจช้า — server โหลด .bi5 files แล้วประมวลผล</p>
          <p>• Data delay ~1 วัน (ไม่เหมาะ live แต่เหมาะ backtest มาก)</p>
        </div>
      </CardContent>
    </Card>
  );
}
