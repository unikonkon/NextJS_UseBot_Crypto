// ─────────────────────────────────────────────────────────────────
// GET /api/smc-scan/detail
// คืนแท่งเทียนครบทุกแท่ง + เส้น/กล่องที่ SMC ตีไว้ สำหรับ 1 เหรียญ
// เรียกตอนผู้ใช้แตะดูรายละเอียดเท่านั้น — payload หนักเกินกว่าจะส่งมากับลิสต์
// ─────────────────────────────────────────────────────────────────
import { NextRequest } from "next/server";
import {
  WeightGate,
  fetchKlines,
  analyzeSmcDetail,
  smcVariant,
  type FetchPlan,
  type SmcVariantId,
} from "@/lib/smcScan";
import { INTERVALS, type Interval } from "@/lib/types/kline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;

  const symbol = (q.get("symbol") ?? "").toUpperCase().trim();
  if (!symbol) return Response.json({ error: "symbol is required" }, { status: 400 });

  const interval = (INTERVALS as readonly string[]).includes(q.get("interval") ?? "")
    ? (q.get("interval") as Interval)
    : "1h";
  const variant = smcVariant(q.get("variant") ?? "smc").id as SmcVariantId;
  const limit = Math.min(Math.max(parseInt(q.get("limit") ?? "500", 10) || 500, 50), 5000);
  const startTime = Number(q.get("startTime")) || undefined;
  const endTime = Number(q.get("endTime")) || undefined;

  const plan: FetchPlan = { interval, limit, startTime, endTime };

  try {
    const gate = new WeightGate();
    const klines = await fetchKlines(symbol, plan, gate, request.signal);
    if (klines.length === 0) {
      return Response.json({ error: "ไม่มีข้อมูลในช่วงที่เลือก" }, { status: 404 });
    }
    const detail = analyzeSmcDetail(symbol, interval, klines, variant);
    return Response.json(detail, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    if (request.signal.aborted) return new Response(null, { status: 499 });
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
