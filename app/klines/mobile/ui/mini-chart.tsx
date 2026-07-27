"use client";

import { useMemo } from "react";
import type { CandleWindow } from "@/lib/smcScanShared";
import { cn } from "@/lib/utils";
import { fmtPrice } from "./format";

type Level = { price: number; label: string; tone: "buy" | "sell" | "neutral" };

type Props = {
  candles: CandleWindow;
  /** index เทียบ klines เต็ม (จะถูกลบด้วย candles.offset ให้เอง) */
  buyMarks?: number[];
  sellMarks?: number[];
  levels?: Level[];
  className?: string;
  height?: number;
};

const TONE_STROKE: Record<Level["tone"], string> = {
  buy: "rgb(16 185 129)",
  sell: "rgb(239 68 68)",
  neutral: "rgb(148 163 184)",
};

/**
 * กราฟแท่งเทียนย่อแบบ SVG — ตั้งใจไม่ใช้ KlineGraph (2,088 บรรทัด + lightweight-charts)
 * เพราะหน้านี้ต้องเบาพอจะเปิดบนมือถือและอาจแสดงหลายกราฟพร้อมกัน
 */
export function MiniChart({
  candles,
  buyMarks = [],
  sellMarks = [],
  levels = [],
  className,
  height = 150,
}: Props) {
  const n = candles.c.length;

  const geom = useMemo(() => {
    const lows = candles.l;
    const highs = candles.h;
    let min = Math.min(...lows);
    let max = Math.max(...highs);
    for (const lv of levels) {
      min = Math.min(min, lv.price);
      max = Math.max(max, lv.price);
    }
    const pad = (max - min) * 0.08 || Math.abs(max) * 0.01 || 1;
    min -= pad;
    max += pad;
    const range = max - min || 1;
    // แปลงราคา → % จากขอบบน (ใช้ได้ทั้งกับ SVG viewBox 0..100 และ CSS top)
    const yPct = (p: number) => ((max - p) / range) * 100;
    // กึ่งกลางแท่ง i เป็น % ของความกว้าง
    const xPct = (i: number) => ((i + 0.5) / n) * 100;
    return { min, max, yPct, xPct };
  }, [candles, levels, n]);

  const markers = useMemo(() => {
    const out: { i: number; kind: "buy" | "sell" }[] = [];
    for (const m of buyMarks) {
      const i = m - candles.offset;
      if (i >= 0 && i < n) out.push({ i, kind: "buy" });
    }
    for (const m of sellMarks) {
      const i = m - candles.offset;
      if (i >= 0 && i < n) out.push({ i, kind: "sell" });
    }
    return out;
  }, [buyMarks, sellMarks, candles.offset, n]);

  if (n === 0) return null;

  const bodyW = 100 / n;

  return (
    <div className={cn("relative w-full select-none", className)} style={{ height }}>
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
        aria-hidden
      >
        {levels.map((lv, k) => (
          <line
            key={`lv-${k}`}
            x1={0}
            x2={100}
            y1={geom.yPct(lv.price)}
            y2={geom.yPct(lv.price)}
            stroke={TONE_STROKE[lv.tone]}
            strokeWidth={1}
            strokeDasharray="3 3"
            opacity={0.7}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {candles.c.map((close, i) => {
          const open = candles.o[i];
          const up = close >= open;
          const color = up ? "rgb(16 185 129)" : "rgb(239 68 68)";
          const x = geom.xPct(i);
          const yTop = geom.yPct(Math.max(open, close));
          const yBot = geom.yPct(Math.min(open, close));
          return (
            <g key={i}>
              <line
                x1={x}
                x2={x}
                y1={geom.yPct(candles.h[i])}
                y2={geom.yPct(candles.l[i])}
                stroke={color}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <rect
                x={x - bodyW * 0.34}
                width={bodyW * 0.68}
                y={yTop}
                height={Math.max(yBot - yTop, 0.4)}
                fill={color}
              />
            </g>
          );
        })}
      </svg>

      {/* หมุดสัญญาณ — วางเป็น div ทับ SVG เพื่อไม่ให้รูปสามเหลี่ยมถูกยืดตาม viewBox */}
      {markers.map((m, k) => {
        const isBuy = m.kind === "buy";
        const price = isBuy ? candles.l[m.i] : candles.h[m.i];
        return (
          <span
            key={`mk-${k}`}
            className={cn(
              "pointer-events-none absolute h-0 w-0 -translate-x-1/2 border-x-[4px] border-x-transparent",
              isBuy
                ? "border-b-[6px] border-b-emerald-500 translate-y-1"
                : "border-t-[6px] border-t-red-500 -translate-y-[7px]",
            )}
            style={{ left: `${geom.xPct(m.i)}%`, top: `${geom.yPct(price)}%` }}
          />
        );
      })}

      {/* ป้ายราคาของเส้นระดับ */}
      {levels.map((lv, k) => (
        <span
          key={`lb-${k}`}
          className={cn(
            "pointer-events-none absolute right-0 -translate-y-1/2 bg-background/85 px-1 text-[9px] tabular-nums",
            lv.tone === "buy" ? "text-emerald-500" : lv.tone === "sell" ? "text-red-500" : "text-muted-foreground",
          )}
          style={{ top: `${geom.yPct(lv.price)}%` }}
        >
          {lv.label} {fmtPrice(lv.price)}
        </span>
      ))}
    </div>
  );
}

/** เส้นราคาปิดแบบบางสำหรับใช้ในการ์ดรายการ */
export function Sparkline({ closes, up, className }: { closes: number[]; up: boolean; className?: string }) {
  if (closes.length < 2) return <div className={cn("h-8 w-full bg-muted/30", className)} />;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const range = max - min || 1;
  const pts = closes
    .map((c, i) => `${((i / (closes.length - 1)) * 100).toFixed(2)},${(100 - ((c - min) / range) * 100).toFixed(2)}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className={cn("h-8 w-full", className)} aria-hidden>
      <polyline
        points={pts}
        fill="none"
        stroke={up ? "rgb(16 185 129)" : "rgb(239 68 68)"}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
