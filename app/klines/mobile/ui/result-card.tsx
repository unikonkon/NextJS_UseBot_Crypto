"use client";

import { Badge } from "@/components/ui/badge";
import type { SmcScanRow } from "@/lib/smcScanShared";
import { cn } from "@/lib/utils";
import { Sparkline } from "./mini-chart";
import { baseAsset, fmtBarsAgo, fmtPct, fmtPrice, pnlColor } from "./format";

type Props = {
  row: SmcScanRow;
  rank: number;
  onOpen: () => void;
};

export function ResultCard({ row, rank, onOpen }: Props) {
  const buy = row.buy!;
  const bt = row.backtest;
  const active = row.state === "BUY_ACTIVE";
  const chg = row.changeSinceBuyPct;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "w-full px-3 py-2.5 text-left ring-1 transition-colors active:bg-muted/50",
        active ? "bg-emerald-500/6 ring-emerald-500/25" : "bg-background ring-foreground/10",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center text-[11px] font-bold tabular-nums",
            rank <= 3 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          {rank}
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-sm font-bold">
          {baseAsset(row.symbol)}
          <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">/USDT</span>
        </span>
        <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px]">{row.interval}</Badge>
        <Badge
          variant={active ? "default" : "secondary"}
          className={cn("h-5 shrink-0 px-1.5 text-[10px]", active && "bg-emerald-500 text-white")}
        >
          {active ? "เปิดอยู่" : "ปิดแล้ว"}
        </Badge>
      </div>

      <div className="mt-1.5 flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-bold text-emerald-500">
            {buy.barsAgo === 0 ? "แท่งล่าสุด" : `${buy.barsAgo} แท่งที่แล้ว`}
          </div>
          <div className="text-[10px] text-muted-foreground">{fmtBarsAgo(buy.barsAgo, row.interval)}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-xs font-semibold tabular-nums">${fmtPrice(row.lastPrice)}</div>
          {chg != null && (
            <div className={cn("text-[11px] font-semibold tabular-nums", pnlColor(chg))}>
              {fmtPct(chg)} <span className="font-normal text-muted-foreground">ตั้งแต่สัญญาณ</span>
            </div>
          )}
        </div>
      </div>

      {row.candles && (
        <Sparkline
          className="mt-1.5"
          closes={row.candles.c}
          up={(chg ?? 0) >= 0}
        />
      )}

      {buy.confluence.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {buy.confluence.map((c) => (
            <Badge key={c} variant="secondary" className="h-4 px-1.5 text-[9px] font-normal">{c}</Badge>
          ))}
        </div>
      )}

      {bt && bt.totalTrades > 0 && (
        <div className="mt-1.5 flex items-center gap-2 border-t border-foreground/8 pt-1.5 text-[10px] text-muted-foreground tabular-nums">
          <span>ย้อนหลัง {bt.totalTrades} ไม้</span>
          <span>·</span>
          <span>ชนะ {bt.winRate.toFixed(0)}%</span>
          <span>·</span>
          <span className={pnlColor(bt.totalPnlPct)}>{fmtPct(bt.totalPnlPct)}</span>
          <span className="ml-auto underline decoration-dotted">รายละเอียด</span>
        </div>
      )}
    </button>
  );
}
