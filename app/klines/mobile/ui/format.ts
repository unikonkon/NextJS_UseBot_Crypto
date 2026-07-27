import { INTERVAL_MS } from "@/lib/smcScanShared";
import type { Interval } from "@/lib/types/kline";

export function fmtPrice(n: number): string {
  const a = Math.abs(n);
  if (a >= 1000) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (a >= 1) return n.toFixed(4);
  if (a >= 0.0001) return n.toFixed(6);
  return n.toFixed(8);
}

export function fmtPct(n: number, dp = 2): string {
  return `${n > 0 ? "+" : ""}${n.toFixed(dp)}%`;
}

export function pnlColor(n: number): string {
  return n > 0 ? "text-emerald-500" : n < 0 ? "text-red-500" : "text-muted-foreground";
}

/** "6 แท่ง · ~6 ชม." — บอกทั้งหน่วยแท่งและเวลาจริง เพราะแต่ละ TF ยาวไม่เท่ากัน */
export function fmtBarsAgo(barsAgo: number, interval: Interval): string {
  const bars = barsAgo === 0 ? "แท่งล่าสุด" : `${barsAgo} แท่งที่แล้ว`;
  if (barsAgo === 0) return bars;
  return `${bars} · ${fmtDuration(barsAgo * INTERVAL_MS[interval])}`;
}

export function fmtDuration(ms: number): string {
  const min = ms / 60_000;
  if (min < 60) return `~${Math.round(min)} นาที`;
  const hr = min / 60;
  if (hr < 48) return `~${hr < 10 ? hr.toFixed(1) : Math.round(hr)} ชม.`;
  const d = hr / 24;
  if (d < 60) return `~${d < 10 ? d.toFixed(1) : Math.round(d)} วัน`;
  return `~${Math.round(d / 30)} เดือน`;
}

export function fmtTime(ts: number, interval: Interval): string {
  const d = new Date(ts);
  const long = INTERVAL_MS[interval] >= INTERVAL_MS["1d"];
  return d.toLocaleString("th-TH", {
    day: "2-digit",
    month: "short",
    ...(long ? {} : { hour: "2-digit", minute: "2-digit" }),
    hour12: false,
  });
}

/** ตัด USDT ท้ายออกเพื่อประหยัดพื้นที่บนจอแคบ */
export function baseAsset(pair: string): string {
  return pair.replace(/USDT$/, "");
}

export const ZONE_LABEL: Record<string, string> = {
  discount: "ส่วนลด (Discount)",
  premium: "พรีเมียม (Premium)",
  equilibrium: "สมดุล (Equilibrium)",
};

export const TREND_LABEL: Record<string, string> = {
  bullish: "ขาขึ้น",
  bearish: "ขาลง",
};
