"use client";

import { useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { smcVariant, type SmcScanRow } from "@/lib/smcScanShared";
import { cn } from "@/lib/utils";
import { MiniChart } from "./mini-chart";
import {
  baseAsset, fmtBarsAgo, fmtPct, fmtPrice, fmtTime, pnlColor, TREND_LABEL, ZONE_LABEL,
} from "./format";

type Props = {
  row: SmcScanRow | null;
  rank: number | null;
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

export function DetailSheet({ row, rank, onClose }: Props) {
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

  if (!row) return null;
  const buy = row.buy;
  const bt = row.backtest;
  const cfg = smcVariant(row.variant);

  const levels = [
    buy?.structureLevel != null
      ? { price: buy.structureLevel, label: "โครงสร้าง", tone: "neutral" as const }
      : null,
    buy?.tp != null ? { price: buy.tp, label: "TP", tone: "buy" as const } : null,
    buy?.sl != null ? { price: buy.sl, label: "SL", tone: "sell" as const } : null,
  ].filter(Boolean) as { price: number; label: string; tone: "buy" | "sell" | "neutral" }[];

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

          {/* ─── กราฟย่อ ─── */}
          {row.candles && (
            <section className="mb-4">
              <div className="mb-1 flex items-baseline justify-between">
                <h3 className="text-[11px] font-semibold">กราฟ {row.candles.c.length} แท่งล่าสุด</h3>
                <span className="text-[10px] text-muted-foreground">
                  ▲ ซื้อ · ▼ ขาย
                </span>
              </div>
              <MiniChart
                candles={row.candles}
                buyMarks={row.buyMarks}
                sellMarks={row.sellMarks}
                levels={levels}
                height={160}
                className="ring-1 ring-foreground/10"
              />
              <div className="mt-1 flex justify-between text-[9px] text-muted-foreground tabular-nums">
                <span>{fmtTime(row.candles.t[0], row.interval)}</span>
                <span>{fmtTime(row.candles.t[row.candles.t.length - 1], row.interval)}</span>
              </div>
            </section>
          )}

          {/* ─── สัญญาณซื้อล่าสุด ─── */}
          <section className="mb-4">
            <h3 className="mb-1.5 text-[11px] font-semibold">สัญญาณซื้อล่าสุด</h3>
            {buy ? (
              <div className="bg-emerald-500/8 px-3 py-2 ring-1 ring-emerald-500/25">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-bold text-emerald-500">
                    {buy.barsAgo === 0 ? "แท่งล่าสุด" : `${buy.barsAgo} แท่งที่แล้ว`}
                  </span>
                  {row.changeSinceBuyPct != null && (
                    <span className={cn("text-sm font-bold tabular-nums", pnlColor(row.changeSinceBuyPct))}>
                      {fmtPct(row.changeSinceBuyPct)}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {fmtBarsAgo(buy.barsAgo, row.interval)} · ปิดแท่งเมื่อ {fmtTime(buy.time, row.interval)}
                </div>
                {buy.confluence.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {buy.confluence.map((c) => (
                      <Badge key={c} variant="secondary" className="h-5 px-1.5 text-[9px]">{c}</Badge>
                    ))}
                  </div>
                )}
                <div className="mt-2 divide-y divide-foreground/8 border-t border-foreground/8">
                  <Row label="ราคาตอนเกิดสัญญาณ">${fmtPrice(buy.price)}</Row>
                  <Row label="ราคาปัจจุบัน">${fmtPrice(row.lastPrice)}</Row>
                  {buy.structureType && (
                    <Row label="โครงสร้างที่ทะลุ">
                      {buy.structureType}
                      {buy.structureLevel != null && (
                        <span className="ml-1 text-muted-foreground">@ ${fmtPrice(buy.structureLevel)}</span>
                      )}
                    </Row>
                  )}
                  {buy.zone && <Row label="โซนราคา">{ZONE_LABEL[buy.zone] ?? buy.zone}</Row>}
                  {buy.internalTrend && (
                    <Row label="เทรนด์ภายใน">
                      <span className={buy.internalTrend === "bullish" ? "text-emerald-500" : "text-red-500"}>
                        {TREND_LABEL[buy.internalTrend]}
                      </span>
                    </Row>
                  )}
                  {buy.swingTrend && (
                    <Row label="เทรนด์ swing">
                      <span className={buy.swingTrend === "bullish" ? "text-emerald-500" : "text-red-500"}>
                        {TREND_LABEL[buy.swingTrend]}
                      </span>
                    </Row>
                  )}
                  {buy.orderBlock && (
                    <Row label="Order Block">
                      ${fmtPrice(buy.orderBlock.low)} – ${fmtPrice(buy.orderBlock.high)}
                      <span className="ml-1 text-muted-foreground">
                        {buy.orderBlock.mitigated ? "(ถูกทดสอบแล้ว)" : "(ยังไม่ถูกแตะ)"}
                      </span>
                    </Row>
                  )}
                  {buy.fvg && (
                    <Row label="Fair Value Gap">
                      ${fmtPrice(buy.fvg.bottom)} – ${fmtPrice(buy.fvg.top)}
                      <span className="ml-1 text-muted-foreground">
                        {buy.fvg.filled ? "(เติมแล้ว)" : "(ยังเปิดอยู่)"}
                      </span>
                    </Row>
                  )}
                  {buy.tp != null && (
                    <Row label="เป้าหมาย (TP)"><span className="text-emerald-500">${fmtPrice(buy.tp)}</span></Row>
                  )}
                  {buy.sl != null && (
                    <Row label="จุดตัดขาดทุน (SL)"><span className="text-red-500">${fmtPrice(buy.sl)}</span></Row>
                  )}
                </div>
              </div>
            ) : (
              <p className="bg-muted/40 px-3 py-3 text-center text-[11px] text-muted-foreground italic">
                ไม่พบสัญญาณซื้อในช่วงข้อมูลนี้
              </p>
            )}
          </section>

          {/* ─── สัญญาณขายที่มาทีหลัง (ถ้ามี) ─── */}
          {row.state === "SELL_ACTIVE" && row.sell && (
            <p className="mb-4 bg-red-500/8 px-3 py-2 text-[10px] leading-relaxed text-red-500 ring-1 ring-red-500/20">
              ไม้นี้ <span className="font-semibold">ปิดไปแล้ว</span> — มีสัญญาณขายตามมาเมื่อ{" "}
              {row.sell.barsAgo} แท่งที่แล้ว
              {buy && ` (ถือ ${buy.barsAgo - row.sell.barsAgo} แท่ง)`}
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
