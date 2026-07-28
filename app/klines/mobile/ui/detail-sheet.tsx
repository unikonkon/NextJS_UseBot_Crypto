"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { changeOf, isLatest, signalOf, smcVariant, type SignalSide, type SmcDetail, type SmcScanRow } from "@/lib/smcScanShared";
import { cn } from "@/lib/utils";
import { Sparkline } from "./mini-chart";
import {
  baseAsset, fmtBarsAgo, fmtPct, fmtPrice, fmtTime, pnlColor, TREND_LABEL, ZONE_LABEL,
} from "./format";

// lightweight-charts ~45KB — โหลดตอนเปิด sheet เท่านั้น ไม่ให้ถ่วงหน้าลิสต์
const SmcChart = dynamic(() => import("./smc-chart").then(m => m.SmcChart), {
  ssr: false,
  loading: () => <Skeleton className="h-[320px] w-full" />,
});

/** พารามิเตอร์ที่ใช้ตอนสแกน — ต้องส่งซ้ำเพื่อให้กราฟรายละเอียดได้ข้อมูลชุดเดียวกัน */
export type DetailQuery = {
  interval: string;
  limit: number;
  startTime?: number;
  endTime?: number;
  variant: string;
};

type Props = {
  row: SmcScanRow | null;
  rank: number | null;
  /** ฝั่งที่ผู้ใช้กำลังดูในลิสต์ — หน้ารายละเอียดจะเน้นฝั่งนั้น */
  side: SignalSide;
  query: DetailQuery;
  onClose: () => void;
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <span className="text-right text-[11px] font-medium tabular-nums">{children}</span>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-muted/40 px-2 py-1.5">
      <div className="text-[9px] text-muted-foreground">{label}</div>
      <div className={cn("text-xs font-semibold tabular-nums", tone)}>{value}</div>
    </div>
  );
}

export function DetailSheet({ row, rank, side, query, onClose }: Props) {
  // เก็บผลผูกกับ key ของคำขอ แทนการล้าง state ตรง ๆ ตอนเปิด effect
  // (setState ใน effect body ทำให้ render ซ้อน — และผลของเหรียญก่อนหน้าจะค้างให้เห็นแวบหนึ่ง)
  const [fetched, setFetched] = useState<{ key: string; data: SmcDetail | null; err: string | null } | null>(null);

  // ล็อกการเลื่อนพื้นหลังขณะเปิด sheet
  useEffect(() => {
    if (!row) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [row, onClose]);

  // โหลดแท่งเทียนครบชุด + เส้นที่ indicator ตี (payload หนักเกินกว่าจะส่งมากับลิสต์)
  const symbol = row?.symbol;
  const reqKey = symbol
    ? [symbol, query.interval, query.limit, query.variant, query.startTime ?? "", query.endTime ?? ""].join("|")
    : null;

  useEffect(() => {
    if (!symbol || !reqKey) return;
    const ctrl = new AbortController();
    const p = new URLSearchParams({
      symbol,
      interval: query.interval,
      limit: String(query.limit),
      variant: query.variant,
    });
    if (query.startTime) p.set("startTime", String(query.startTime));
    if (query.endTime) p.set("endTime", String(query.endTime));

    fetch(`/api/smc-scan/detail?${p}`, { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
        return res.json() as Promise<SmcDetail>;
      })
      .then((data) => setFetched({ key: reqKey, data, err: null }))
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setFetched({ key: reqKey, data: null, err: e instanceof Error ? e.message : String(e) });
      });

    return () => ctrl.abort();
  }, [symbol, reqKey, query.interval, query.limit, query.variant, query.startTime, query.endTime]);

  // ใช้ผลเฉพาะเมื่อตรงกับคำขอปัจจุบัน — กันข้อมูลของเหรียญก่อนหน้าโผล่
  const detail = fetched && fetched.key === reqKey ? fetched.data : null;
  const detailErr = fetched && fetched.key === reqKey ? fetched.err : null;

  if (!row) return null;
  const isBuy = side === "buy";
  const sideLabel = isBuy ? "ซื้อ" : "ขาย";
  const sig = signalOf(row, side);
  const opposite = signalOf(row, isBuy ? "sell" : "buy");
  const chg = changeOf(row, side);
  const stillLatest = isLatest(row, side);
  const bt = row.backtest;
  const cfg = smcVariant(row.variant);

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label="ปิด"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[1px]"
      />

      <div className="relative flex max-h-[88vh] flex-col bg-background ring-1 ring-foreground/15">
        {/* ที่จับ + หัวเรื่อง (ตรึงไว้) */}
        <div className="shrink-0 border-b border-foreground/10">
          <div className="flex justify-center py-2">
            <span className="h-1 w-10 rounded-full bg-foreground/25" />
          </div>
          <div className="flex items-start justify-between gap-2 px-4 pb-3">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                {rank != null && (
                  <Badge variant="default" className="h-5 px-1.5 text-[10px] tabular-nums">
                    #{rank}
                  </Badge>
                )}
                <span className="truncate font-mono text-base font-bold">{baseAsset(row.symbol)}</span>
                <span className="text-xs text-muted-foreground">/USDT</span>
                <Badge variant="outline" className="h-5 px-1.5 text-[10px]">{row.interval}</Badge>
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {cfg.name} · {row.bars} แท่ง
              </div>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="ปิด">✕</Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          {row.warning && (
            <p className="mb-3 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-600 dark:text-amber-400">
              ⚠ {row.warning}
            </p>
          )}

          {/* ─── กราฟ ─── */}
          <section className="mb-4">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <h3 className="text-[11px] font-semibold">
                กราฟ {detail ? `${detail.bars.toLocaleString()} แท่ง (ทั้งหมด)` : `${row.bars.toLocaleString()} แท่ง`}
              </h3>
              {!detail && !detailErr && (
                <span className="text-[10px] text-muted-foreground animate-pulse">กำลังโหลดกราฟเต็ม…</span>
              )}
            </div>

            {detail ? (
              <SmcChart detail={detail} focusSide={side} height={320} />
            ) : (
              <>
                {/* ระหว่างรอ ใช้กราฟย่อจากผลสแกนไปก่อน เพื่อไม่ให้จอว่าง */}
                {row.candles && (
                  <div className="h-40 opacity-60 ring-1 ring-foreground/10">
                    <Sparkline
                      className="h-full"
                      closes={row.candles.c}
                      up={(chg ?? 0) >= 0}
                    />
                  </div>
                )}
                {detailErr && (
                  <p className="mt-1 bg-destructive/10 px-2 py-1.5 text-[10px] text-destructive">
                    โหลดกราฟเต็มไม่สำเร็จ: {detailErr} — แสดงกราฟย่อจากผลสแกนแทน
                  </p>
                )}
              </>
            )}

            {row.candles && !detail && (
              <div className="mt-1 flex justify-between text-[9px] text-muted-foreground tabular-nums">
                <span>{fmtTime(row.candles.t0, row.interval)}</span>
                <span>{fmtTime(row.candles.t1, row.interval)}</span>
              </div>
            )}
          </section>

          {/* ─── สัญญาณล่าสุดของฝั่งที่เลือก ─── */}
          <section className="mb-4">
            <h3 className="mb-1.5 text-[11px] font-semibold">สัญญาณ{sideLabel}ล่าสุด</h3>
            {sig ? (
              <div className={cn("px-3 py-2 ring-1", isBuy ? "bg-emerald-500/8 ring-emerald-500/25" : "bg-red-500/8 ring-red-500/25")}>
                <div className="flex items-baseline justify-between">
                  <span className={cn("text-sm font-bold", isBuy ? "text-emerald-500" : "text-red-500")}>
                    {sig.barsAgo === 0 ? "แท่งล่าสุด" : `${sig.barsAgo} แท่งที่แล้ว`}
                  </span>
                  {chg != null && (
                    <span className={cn("text-sm font-bold tabular-nums", pnlColor(isBuy ? chg : -chg))}>
                      {fmtPct(chg)}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {fmtBarsAgo(sig.barsAgo, row.interval)} · ปิดแท่งเมื่อ {fmtTime(sig.time, row.interval)}
                </div>
                {sig.confluence.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {sig.confluence.map((c) => (
                      <Badge key={c} variant="secondary" className="h-5 px-1.5 text-[9px]">{c}</Badge>
                    ))}
                  </div>
                )}
                <div className="mt-2 divide-y divide-foreground/8 border-t border-foreground/8">
                  <Row label="ราคาตอนเกิดสัญญาณ">${fmtPrice(sig.price)}</Row>
                  <Row label="ราคาปัจจุบัน">${fmtPrice(row.lastPrice)}</Row>
                  {sig.structureType && (
                    <Row label="โครงสร้างที่ทะลุ">
                      {sig.structureType}
                      {sig.structureLevel != null && (
                        <span className="ml-1 text-muted-foreground">@ ${fmtPrice(sig.structureLevel)}</span>
                      )}
                    </Row>
                  )}
                  {sig.zone && <Row label="โซนราคา">{ZONE_LABEL[sig.zone] ?? sig.zone}</Row>}
                  {sig.internalTrend && (
                    <Row label="เทรนด์ภายใน">
                      <span className={sig.internalTrend === "bullish" ? "text-emerald-500" : "text-red-500"}>
                        {TREND_LABEL[sig.internalTrend]}
                      </span>
                    </Row>
                  )}
                  {sig.swingTrend && (
                    <Row label="เทรนด์ swing">
                      <span className={sig.swingTrend === "bullish" ? "text-emerald-500" : "text-red-500"}>
                        {TREND_LABEL[sig.swingTrend]}
                      </span>
                    </Row>
                  )}
                  {sig.orderBlock && (
                    <Row label="Order Block">
                      ${fmtPrice(sig.orderBlock.low)} – ${fmtPrice(sig.orderBlock.high)}
                      <span className="ml-1 text-muted-foreground">
                        {sig.orderBlock.mitigated ? "(ถูกทดสอบแล้ว)" : "(ยังไม่ถูกแตะ)"}
                      </span>
                    </Row>
                  )}
                  {sig.fvg && (
                    <Row label="Fair Value Gap">
                      ${fmtPrice(sig.fvg.bottom)} – ${fmtPrice(sig.fvg.top)}
                      <span className="ml-1 text-muted-foreground">
                        {sig.fvg.filled ? "(เติมแล้ว)" : "(ยังเปิดอยู่)"}
                      </span>
                    </Row>
                  )}
                  {sig.tp != null && (
                    <Row label="เป้าหมาย (TP)"><span className="text-emerald-500">${fmtPrice(sig.tp)}</span></Row>
                  )}
                  {sig.sl != null && (
                    <Row label="จุดตัดขาดทุน (SL)"><span className="text-red-500">${fmtPrice(sig.sl)}</span></Row>
                  )}
                </div>
              </div>
            ) : (
              <p className="bg-muted/40 px-3 py-3 text-center text-[11px] text-muted-foreground italic">
                ไม่พบสัญญาณ{sideLabel}ในช่วงข้อมูลนี้
              </p>
            )}
          </section>

          {/* ─── สัญญาณฝั่งตรงข้ามที่ตามมาทีหลัง (ถ้ามี) ─── */}
          {!stillLatest && sig && opposite && (
            <p
              className={cn(
                "mb-4 px-3 py-2 text-[10px] leading-relaxed ring-1",
                isBuy ? "bg-red-500/8 text-red-500 ring-red-500/20" : "bg-emerald-500/8 text-emerald-500 ring-emerald-500/20",
              )}
            >
              สัญญาณนี้ <span className="font-semibold">ถูกกลบไปแล้ว</span> — มีสัญญาณ
              {isBuy ? "ขาย" : "ซื้อ"}ตามมาเมื่อ {opposite.barsAgo} แท่งที่แล้ว
              {` (ห่างกัน ${sig.barsAgo - opposite.barsAgo} แท่ง)`}
              {(cfg.id === "pasmc_scalper" || cfg.id === "smc_trend_pullback") && " ซึ่งเป็นการออกตาม TP/SL ของกลยุทธ์"}
            </p>
          )}

          {/* ─── สถิติ backtest ─── */}
          {bt && (
            <section className="mb-4">
              <h3 className="mb-1.5 text-[11px] font-semibold">
                สถิติย้อนหลังของ {cfg.shortName} บนเหรียญนี้
                <span className="ml-1 font-normal text-muted-foreground">({row.bars} แท่ง)</span>
              </h3>
              {bt.totalTrades === 0 ? (
                <p className="bg-muted/40 px-3 py-3 text-center text-[11px] text-muted-foreground italic">
                  ยังไม่มีไม้ที่ปิดครบในช่วงนี้
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-1">
                    <Stat label="กำไรรวม" value={fmtPct(bt.totalPnlPct)} tone={pnlColor(bt.totalPnlPct)} />
                    <Stat label="ชนะ" value={`${bt.winRate.toFixed(0)}%`} />
                    <Stat label="จำนวนไม้" value={`${bt.totalTrades}`} />
                    <Stat
                      label="Profit Factor"
                      value={Number.isFinite(bt.profitFactor) ? bt.profitFactor.toFixed(2) : "∞"}
                      tone={bt.profitFactor >= 1 ? "text-emerald-500" : "text-red-500"}
                    />
                    <Stat
                      label="Max DD"
                      value={bt.maxDrawdownPct > 0 ? `-${bt.maxDrawdownPct.toFixed(1)}%` : "0%"}
                      tone={bt.maxDrawdownPct > 0 ? "text-red-500" : "text-muted-foreground"}
                    />
                    <Stat label="ถือเฉลี่ย" value={`${bt.avgBarsHeld.toFixed(0)} แท่ง`} />
                  </div>
                  <div className="mt-1.5 divide-y divide-foreground/8 border-t border-foreground/8">
                    <Row label="ไม้ดีสุด / แย่สุด">
                      <span className={pnlColor(bt.bestTradePct)}>{fmtPct(bt.bestTradePct)}</span>
                      <span className="mx-1 text-muted-foreground">/</span>
                      <span className={pnlColor(bt.worstTradePct)}>{fmtPct(bt.worstTradePct)}</span>
                    </Row>
                    <Row label="เทียบกับซื้อแล้วถือ">
                      <span className={pnlColor(bt.buyAndHoldPct)}>{fmtPct(bt.buyAndHoldPct)}</span>
                    </Row>
                  </div>

                  <h4 className="mt-3 mb-1 text-[10px] font-semibold text-muted-foreground">
                    ไม้ล่าสุด {bt.lastTrades.length} ไม้
                  </h4>
                  <div className="divide-y divide-foreground/8 ring-1 ring-foreground/10">
                    {bt.lastTrades.map((t, i) => (
                      <div key={i} className="flex items-center justify-between px-2 py-1.5 text-[10px] tabular-nums">
                        <span className="text-muted-foreground">
                          ${fmtPrice(t.entryPrice)} → ${fmtPrice(t.exitPrice)}
                        </span>
                        <span className="text-muted-foreground">{t.bars} แท่ง</span>
                        <span className={cn("font-semibold", pnlColor(t.pnlPct))}>{fmtPct(t.pnlPct)}</span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[9px] leading-relaxed text-muted-foreground">
                    คิดแบบ spot ฝั่งซื้ออย่างเดียว เข้า/ออกที่ราคาปิด หักค่าธรรมเนียม 0.1% ต่อขา —
                    เป็นผลย้อนหลัง ไม่ใช่การรับประกันผลในอนาคต
                  </p>
                </>
              )}
            </section>
          )}

          <a
            href={`https://www.binance.com/en/trade/${baseAsset(row.symbol)}_USDT?type=spot`}
            target="_blank"
            rel="noreferrer"
            className="block w-full bg-muted/50 py-2.5 text-center text-[11px] underline decoration-dotted"
          >
            เปิดกราฟ {baseAsset(row.symbol)}/USDT บน Binance ↗
          </a>
        </div>
      </div>
    </div>
  );
}
