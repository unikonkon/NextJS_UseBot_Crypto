"use client";

import { cn } from "@/lib/utils";

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
