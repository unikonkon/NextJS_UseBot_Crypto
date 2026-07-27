"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  BINANCE_WEIGHT_LIMIT_1M,
  INTERVAL_MS,
  SMC_VARIANTS,
  estimateWeight,
  rankByFreshBuy,
  smcVariant,
  type ScanEvent,
  type ScanFilter,
  type SmcScanRow,
  type SmcVariantId,
} from "@/lib/smcScanShared";
import { INTERVALS, type Interval } from "@/lib/types/kline";
import { cn } from "@/lib/utils";
import { CoinPicker } from "./ui/coin-picker";
import { ResultCard } from "./ui/result-card";
import { DetailSheet } from "./ui/detail-sheet";
import { fmtDuration } from "./ui/format";

type DataMode = "bars" | "range";

const BAR_PRESETS = [200, 500, 1000, 2000];
const QUICK_INTERVALS: Interval[] = ["5m", "15m", "1h", "4h", "1d"];

/** datetime-local string → ms epoch */
function toEpoch(dt: string): number | undefined {
  if (!dt) return undefined;
  const t = new Date(dt).getTime();
  return Number.isFinite(t) ? t : undefined;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h2>
      {children}
    </section>
  );
}

export default function SmcMobileScannerPage() {
  // ── ตั้งค่าการสแกน ──
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [interval, setIntervalState] = useState<Interval>("1h");
  const [showAllIntervals, setShowAllIntervals] = useState(false);
  const [dataMode, setDataMode] = useState<DataMode>("bars");
  const [limit, setLimit] = useState("500");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [variant, setVariant] = useState<SmcVariantId>("smc");
  const [settingsOpen, setSettingsOpen] = useState(true);

  // ── ผลลัพธ์ ──
  const [rows, setRows] = useState<Map<string, SmcScanRow>>(new Map());
  const [errors, setErrors] = useState<{ symbol: string; message: string }[]>([]);
  const [filter, setFilter] = useState<ScanFilter>("buy_active");
  const [filterTouched, setFilterTouched] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; symbol: string; usedWeight1m: number; waiting: boolean } | null>(null);
  const [summary, setSummary] = useState<Extract<ScanEvent, { type: "done" }> | null>(null);
  const [scanning, setScanning] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const [openSymbol, setOpenSymbol] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const numLimit = Math.min(Math.max(parseInt(limit, 10) || 500, 50), 5000);
  const plan = useMemo(() => ({
    interval,
    limit: numLimit,
    startTime: dataMode === "range" ? toEpoch(startTime) : undefined,
    endTime: dataMode === "range" ? toEpoch(endTime) : undefined,
  }), [interval, numLimit, dataMode, startTime, endTime]);

  const estWeight = useMemo(
    () => estimateWeight(plan, INTERVAL_MS[interval]) * Math.max(selected.size, 0),
    [plan, interval, selected.size],
  );
  const cfg = smcVariant(variant);
  const rangeInvalid = dataMode === "range" && !plan.startTime;

  // จำนวนแท่งโดยประมาณในโหมดช่วงเวลา — ใช้เตือนว่าพอสำหรับ SMC ไหม
  const estBars = useMemo(() => {
    if (dataMode === "bars") return numLimit;
    if (!plan.startTime) return 0;
    return Math.ceil(((plan.endTime ?? Date.now()) - plan.startTime) / INTERVAL_MS[interval]);
  }, [dataMode, numLimit, plan, interval]);

  // ─── สแกน: อ่าน NDJSON stream ทีละบรรทัด ───────────────────────
  const scan = useCallback(async () => {
    const symbols = Array.from(selected);
    if (symbols.length === 0 || rangeInvalid) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setScanning(true);
    setSettingsOpen(false);
    setRows(new Map());
    setErrors([]);
    setSummary(null);
    setFatal(null);
    setProgress({ done: 0, total: symbols.length, symbol: "", usedWeight1m: 0, waiting: false });

    try {
      const res = await fetch("/api/smc-scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          symbols,
          interval,
          limit: numLimit,
          startTime: plan.startTime,
          endTime: plan.endTime,
          variant,
          withBacktest: true,
          candleWindow: 90,
        }),
      });
      if (!res.ok || !res.body) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let evt: ScanEvent;
          try { evt = JSON.parse(line); } catch { continue; }
          switch (evt.type) {
            case "row":
              setRows((prev) => new Map(prev).set(evt.row.symbol, evt.row));
              break;
            case "progress":
              setProgress({
                done: evt.done, total: evt.total, symbol: evt.symbol,
                usedWeight1m: evt.usedWeight1m, waiting: evt.waiting,
              });
              break;
            case "error":
              setErrors((prev) => [...prev, { symbol: evt.symbol, message: evt.message }]);
              break;
            case "done":
              setSummary(evt);
              break;
          }
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) setFatal(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
      abortRef.current = null;
    }
  }, [selected, rangeInvalid, interval, numLimit, plan, variant]);

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const allRows = useMemo(() => Array.from(rows.values()), [rows]);
  const { activeOnly, anyBuy } = useMemo(() => ({
    activeOnly: rankByFreshBuy(allRows, "buy_active"),
    anyBuy: rankByFreshBuy(allRows, "any_buy"),
  }), [allRows]);

  // กลยุทธ์ที่มี TP/SL (Pullback, Scalper) มักปิดไม้ภายใน 1–3 แท่ง สถานะ "ยังเปิดอยู่"
  // จึงแทบไม่เกิด — ถ้าผู้ใช้ยังไม่เคยแตะตัวกรองเอง ให้สลับไปโหมด "ทั้งหมด" ให้อัตโนมัติ
  // แทนที่จะโชว์หน้าว่างเปล่า
  const autoSwitched = !filterTouched && activeOnly.length === 0 && anyBuy.length > 0;
  const effFilter: ScanFilter = autoSwitched ? "any_buy" : filter;
  const ranked = effFilter === "any_buy" ? anyBuy : activeOnly;
  const noBuyCount = allRows.length - anyBuy.length;
  const sellSideCount = anyBuy.length - activeOnly.length;
  const openRow = openSymbol ? rows.get(openSymbol) ?? null : null;
  const openRank = openRow ? ranked.findIndex((r) => r.symbol === openRow.symbol) + 1 : null;

  const pct = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0;
  const weightPct = progress ? (progress.usedWeight1m / BINANCE_WEIGHT_LIMIT_1M) * 100 : 0;

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col bg-background">
      {/* ─── หัวเรื่อง (ตรึงบน) ─── */}
      <header className="sticky top-0 z-30 border-b border-foreground/10 bg-background/95 backdrop-blur">
        <div className="flex h-12 items-center gap-2 px-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-bold">SMC Scanner</h1>
            <p className="truncate text-[10px] text-muted-foreground">
              หาเหรียญที่มีสัญญาณซื้อสดใหม่ที่สุด
            </p>
          </div>
          <Link href="/klines" className="text-[10px] text-muted-foreground underline decoration-dotted">
            หน้าเต็ม
          </Link>
          <ThemeToggle />
        </div>

        {/* แถบความคืบหน้า */}
        {(scanning || progress) && (
          <div className="px-3 pb-2">
            <div className="h-1 w-full bg-muted">
              <div
                className={cn("h-full transition-all", progress?.waiting ? "bg-amber-500" : "bg-primary")}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground tabular-nums">
              <span>
                {progress?.waiting
                  ? `⏸ รอโควตา Binance… (${progress.done}/${progress.total})`
                  : `${progress?.done ?? 0}/${progress?.total ?? 0} เหรียญ`}
                {progress?.symbol && !progress.waiting && <span className="ml-1 font-mono">{progress.symbol}</span>}
              </span>
              <span className={cn(weightPct > 80 && "text-amber-500")}>
                weight {progress?.usedWeight1m ?? 0}/{BINANCE_WEIGHT_LIMIT_1M}
              </span>
            </div>
          </div>
        )}
      </header>

      <main className="flex-1 space-y-4 px-3 py-3 pb-28">
        {/* ─── ตั้งค่า (ยุบได้) ─── */}
        <div className="ring-1 ring-foreground/10">
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
          >
            <span className="min-w-0">
              <span className="block text-xs font-semibold">ตั้งค่าการสแกน</span>
              <span className="block truncate text-[10px] text-muted-foreground tabular-nums">
                {selected.size} เหรียญ · {interval} ·{" "}
                {dataMode === "bars" ? `${numLimit} แท่ง` : "ช่วงเวลาที่กำหนด"} · {cfg.shortName}
              </span>
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">{settingsOpen ? "▲" : "▼"}</span>
          </button>

          {settingsOpen && (
            <div className="space-y-4 border-t border-foreground/10 px-3 py-3">
              <Section title="1 · เหรียญที่จะสแกน">
                <CoinPicker selected={selected} onChange={setSelected} />
              </Section>

              <Section title="2 · ช่วงเวลาแท่งเทียน">
                <div className="flex gap-1.5">
                  {QUICK_INTERVALS.map((iv) => (
                    <button
                      key={iv}
                      type="button"
                      onClick={() => setIntervalState(iv)}
                      className={cn(
                        "h-9 flex-1 text-xs font-medium ring-1 transition-colors",
                        interval === iv
                          ? "bg-foreground text-background ring-foreground"
                          : "bg-background ring-foreground/12",
                      )}
                    >
                      {iv}
                    </button>
                  ))}
                </div>
                {showAllIntervals ? (
                  <div className="grid grid-cols-6 gap-1">
                    {INTERVALS.map((iv) => (
                      <button
                        key={iv}
                        type="button"
                        onClick={() => setIntervalState(iv)}
                        className={cn(
                          "h-8 text-[11px] ring-1 transition-colors",
                          interval === iv
                            ? "bg-foreground text-background ring-foreground"
                            : "bg-background ring-foreground/12",
                        )}
                      >
                        {iv}
                      </button>
                    ))}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowAllIntervals(true)}
                    className="text-[10px] text-muted-foreground underline decoration-dotted"
                  >
                    ดูช่วงเวลาทั้งหมด ({INTERVALS.length})
                  </button>
                )}
              </Section>

              <Section title="3 · ปริมาณข้อมูล">
                <div className="grid grid-cols-2 gap-0 ring-1 ring-foreground/15">
                  {(["bars", "range"] as DataMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setDataMode(m)}
                      className={cn(
                        "h-9 text-xs font-medium transition-colors",
                        dataMode === m ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground",
                      )}
                    >
                      {m === "bars" ? "จำนวนแท่ง" : "ช่วงเวลาเริ่ม–สิ้นสุด"}
                    </button>
                  ))}
                </div>

                {dataMode === "bars" ? (
                  <>
                    <div className="flex gap-1.5">
                      {BAR_PRESETS.map((p) => (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setLimit(String(p))}
                          className={cn(
                            "h-9 flex-1 text-xs tabular-nums ring-1 transition-colors",
                            numLimit === p
                              ? "bg-foreground text-background ring-foreground"
                              : "bg-background ring-foreground/12",
                          )}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                    <Input
                      type="number"
                      value={limit}
                      onChange={(e) => setLimit(e.target.value)}
                      min={50}
                      max={5000}
                      className="h-8 text-xs"
                      inputMode="numeric"
                    />
                    <p className="text-[10px] text-muted-foreground">
                      ครอบคลุมย้อนหลัง {fmtDuration(numLimit * INTERVAL_MS[interval])} · เกิน 1000 แท่งจะดึงเป็นหลายหน้าอัตโนมัติ
                    </p>
                  </>
                ) : (
                  <div className="space-y-1.5">
                    <label className="block text-[10px] text-muted-foreground">
                      เริ่มต้น
                      <Input
                        type="datetime-local"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className="mt-0.5 h-9 text-xs"
                      />
                    </label>
                    <label className="block text-[10px] text-muted-foreground">
                      สิ้นสุด (เว้นว่าง = ถึงปัจจุบัน)
                      <Input
                        type="datetime-local"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className="mt-0.5 h-9 text-xs"
                      />
                    </label>
                    {plan.startTime && (
                      <p className="text-[10px] text-muted-foreground tabular-nums">
                        ≈ {estBars.toLocaleString()} แท่ง / เหรียญ
                      </p>
                    )}
                  </div>
                )}

                {estBars > 0 && estBars < cfg.minBars && (
                  <p className="bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-600 dark:text-amber-400">
                    ⚠ {cfg.shortName} ต้องการอย่างน้อย ~{cfg.minBars} แท่ง — ข้อมูลเท่านี้อาจให้สัญญาณไม่ครบ
                  </p>
                )}
              </Section>

              <Section title="4 · Indicator">
                <div className="space-y-1">
                  {SMC_VARIANTS.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setVariant(v.id)}
                      className={cn(
                        "flex w-full items-start gap-2 px-2.5 py-2 text-left ring-1 transition-colors",
                        variant === v.id ? "bg-primary/10 ring-primary/50" : "bg-background ring-foreground/12",
                      )}
                    >
                      <span
                        className={cn(
                          "mt-0.5 h-3 w-3 shrink-0 rounded-full ring-1",
                          variant === v.id ? "bg-primary ring-primary" : "ring-foreground/30",
                        )}
                      />
                      <span className="min-w-0">
                        <span className="block text-[11px] font-medium">{v.name}</span>
                        <span className="block text-[10px] text-muted-foreground">{v.descTh}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </Section>

              <div className="flex items-center justify-between border-t border-foreground/10 pt-2 text-[10px] text-muted-foreground tabular-nums">
                <span>ประเมิน weight ที่จะใช้</span>
                <span className={cn(estWeight > BINANCE_WEIGHT_LIMIT_1M * 0.85 && "text-amber-500")}>
                  ~{estWeight.toLocaleString()} / {BINANCE_WEIGHT_LIMIT_1M.toLocaleString()} ต่อนาที
                </span>
              </div>
              {estWeight > BINANCE_WEIGHT_LIMIT_1M * 0.85 && (
                <p className="text-[10px] text-amber-600 dark:text-amber-400">
                  เกินโควตา 1 นาที — ระบบจะหยุดรออัตโนมัติจนกว่า Binance จะรีเซ็ตตัวนับ (สแกนจะช้าลงแต่ไม่ล้มเหลว)
                </p>
              )}
            </div>
          )}
        </div>

        {/* ─── ข้อผิดพลาดระดับคำขอ ─── */}
        {fatal && (
          <p className="bg-destructive/10 px-3 py-2 text-[11px] text-destructive">สแกนล้มเหลว: {fatal}</p>
        )}

        {/* ─── ผลลัพธ์ ─── */}
        {allRows.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                อันดับสัญญาณซื้อสดใหม่ที่สุด
              </h2>
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px] tabular-nums">
                {ranked.length}
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-0 ring-1 ring-foreground/15">
              {([
                ["buy_active", `ไม้ยังเปิดอยู่ (${activeOnly.length})`],
                ["any_buy", `ทั้งหมด (${anyBuy.length})`],
              ] as [ScanFilter, string][]).map(([f, label]) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => { setFilter(f); setFilterTouched(true); }}
                  className={cn(
                    "h-8 text-[11px] font-medium tabular-nums transition-colors",
                    effFilter === f ? "bg-foreground text-background" : "bg-background text-muted-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>

            {autoSwitched && (
              <p className="bg-muted/40 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
                {cfg.shortName} มี TP/SL ในตัว ไม้จึงมักปิดภายในไม่กี่แท่ง — ไม่มีเหรียญไหน “ไม้ยังเปิดอยู่”
                จึงแสดงสัญญาณซื้อล่าสุดทั้งหมดแทน
              </p>
            )}

            {ranked.length === 0 ? (
              <p className="bg-muted/40 px-3 py-6 text-center text-[11px] text-muted-foreground italic">
                {scanning ? "กำลังสแกน…" : "ยังไม่พบเหรียญที่ตรงเงื่อนไข"}
              </p>
            ) : (
              <div className="space-y-1.5">
                {ranked.map((row, i) => (
                  <ResultCard
                    key={row.symbol}
                    row={row}
                    rank={i + 1}
                    onOpen={() => setOpenSymbol(row.symbol)}
                  />
                ))}
              </div>
            )}

            <p className="text-[10px] leading-relaxed text-muted-foreground">
              สแกนแล้ว {allRows.length} เหรียญ
              {effFilter === "buy_active" && sellSideCount > 0 && ` · ปิดไม้ไปแล้ว ${sellSideCount}`}
              {noBuyCount > 0 && ` · ไม่พบสัญญาณซื้อ ${noBuyCount}`}
              {errors.length > 0 && ` · ดึงไม่สำเร็จ ${errors.length}`}
              {summary && ` · ใช้เวลา ${(summary.elapsedMs / 1000).toFixed(1)} วิ (${summary.calls} calls)`}
            </p>

            <p className="text-[10px] leading-relaxed text-muted-foreground">
              หมายเหตุ: SMC ยืนยัน pivot ด้วยแท่งถัดไปหลายแท่ง สัญญาณที่สดที่สุดจึงมักอยู่ห่างจากแท่งปัจจุบัน
              ~{cfg.params.internalSize ?? cfg.params.smcpInternal ?? cfg.params.pasmcLen ?? cfg.params.pascLen ?? 5} แท่ง
              ไม่ใช่แท่งล่าสุดเสมอไป
            </p>
          </div>
        )}

        {errors.length > 0 && (
          <details className="ring-1 ring-destructive/25">
            <summary className="px-3 py-2 text-[11px] text-destructive">
              ดึงข้อมูลไม่สำเร็จ {errors.length} เหรียญ
            </summary>
            <div className="divide-y divide-foreground/8 border-t border-destructive/20">
              {errors.map((e, i) => (
                <p key={i} className="px-3 py-1.5 text-[10px]">
                  <span className="font-mono font-semibold">{e.symbol}</span>
                  <span className="ml-1 text-muted-foreground">{e.message}</span>
                </p>
              ))}
            </div>
          </details>
        )}

        {allRows.length === 0 && !scanning && !fatal && (
          <div className="px-3 py-10 text-center">
            <p className="text-3xl">📡</p>
            <p className="mt-2 text-xs font-medium">เลือกหมวดหรือเหรียญ แล้วกดสแกน</p>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              ระบบจะดึงข้อมูลจาก Binance ตามโควตา rate limit
              แล้วรัน {cfg.shortName} ให้ทันที จากนั้นเรียงลำดับเหรียญที่มีสัญญาณซื้อสดใหม่ที่สุด
            </p>
          </div>
        )}
      </main>

      {/* ─── ปุ่มหลัก (ตรึงล่าง) ─── */}
      <div className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-lg border-t border-foreground/10 bg-background/95 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur">
        {scanning ? (
          <Button variant="destructive" size="lg" className="h-12 w-full text-sm" onClick={stop}>
            หยุดสแกน ({progress?.done ?? 0}/{progress?.total ?? 0})
          </Button>
        ) : (
          <Button
            size="lg"
            className="h-12 w-full text-sm"
            disabled={selected.size === 0 || rangeInvalid}
            onClick={scan}
          >
            {selected.size === 0
              ? "เลือกเหรียญก่อน"
              : rangeInvalid
                ? "ระบุเวลาเริ่มต้นก่อน"
                : `สแกน ${selected.size} เหรียญ · ${interval} · ${cfg.shortName}`}
          </Button>
        )}
      </div>

      <DetailSheet row={openRow} rank={openRank} onClose={() => setOpenSymbol(null)} />
    </div>
  );
}
