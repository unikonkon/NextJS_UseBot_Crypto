// ─────────────────────────────────────────────────────────────────
// POST /api/smc-scan
// ดึง klines จาก Binance ตาม rate limit แล้วรัน SMC ให้ทันที
// ส่งผลกลับเป็น NDJSON stream (1 event ต่อ 1 บรรทัด) เพื่อให้มือถือ
// เห็นผลทีละเหรียญโดยไม่ต้องรอทั้งชุด
// ─────────────────────────────────────────────────────────────────
import { NextRequest } from "next/server";
import {
  WeightGate,
  fetchKlines,
  analyzeSmc,
  estimateWeight,
  smcVariant,
  INTERVAL_MS,
  type ScanEvent,
  type SmcVariantId,
  type FetchPlan,
} from "@/lib/smcScan";
import { INTERVALS, type Interval } from "@/lib/types/kline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** ดึงพร้อมกันกี่เหรียญ — สูงไปจะชน rate limit เร็ว ต่ำไปจะช้า */
const CONCURRENCY = 4;
const MAX_SYMBOLS = 120;

interface ScanBody {
  symbols?: string[];
  interval?: string;
  limit?: number;
  startTime?: number;
  endTime?: number;
  variant?: string;
  params?: Record<string, number>;
  feesPct?: number;
  withBacktest?: boolean;
  candleWindow?: number;
}

export async function POST(request: NextRequest) {
  let body: ScanBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const symbols = Array.from(
    new Set((body.symbols ?? []).map((s) => String(s).toUpperCase().trim()).filter(Boolean)),
  ).slice(0, MAX_SYMBOLS);
  if (symbols.length === 0) {
    return Response.json({ error: "symbols is required" }, { status: 400 });
  }

  const interval = (INTERVALS as readonly string[]).includes(body.interval ?? "")
    ? (body.interval as Interval)
    : "1h";
  const variantId = smcVariant(body.variant ?? "smc").id as SmcVariantId;
  const limit = Math.min(Math.max(Math.floor(body.limit ?? 500), 50), 5000);

  const plan: FetchPlan = {
    interval,
    limit,
    startTime: body.startTime && body.startTime > 0 ? body.startTime : undefined,
    endTime: body.endTime && body.endTime > 0 ? body.endTime : undefined,
  };

  const gate = new WeightGate();
  const encoder = new TextEncoder();
  const startedAt = Date.now();
  const estWeight = estimateWeight(plan, INTERVAL_MS[interval]) * symbols.length;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (e: ScanEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
        } catch {
          closed = true;
        }
      };

      const abort = request.signal;
      send({ type: "meta", total: symbols.length, interval, variant: variantId, estWeight, startedAt });

      let done = 0;
      let failed = 0;
      let cursor = 0;

      const worker = async () => {
        while (!abort.aborted) {
          const i = cursor++;
          if (i >= symbols.length) return;
          const symbol = symbols[i];
          try {
            const klines = await fetchKlines(symbol, plan, gate, abort, () => {
              send({
                type: "progress", done, total: symbols.length, symbol,
                usedWeight1m: gate.usedWeight1m, waiting: true,
              });
            });
            if (klines.length === 0) throw new Error("ไม่มีข้อมูลในช่วงที่เลือก");

            const row = analyzeSmc(symbol, interval, klines, variantId, {
              params: body.params,
              feesPct: body.feesPct ?? 0.1,
              withBacktest: body.withBacktest !== false,
              candleWindow: body.candleWindow ?? 90,
            });
            done++;
            send({ type: "row", row });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (message === "aborted" || abort.aborted) return;
            failed++;
            done++;
            send({ type: "error", symbol, message });
          }
          send({
            type: "progress", done, total: symbols.length, symbol,
            usedWeight1m: gate.usedWeight1m, waiting: false,
          });
        }
      };

      try {
        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, symbols.length) }, worker));
        send({
          type: "done",
          done, total: symbols.length, failed,
          usedWeight1m: gate.usedWeight1m,
          calls: gate.calls,
          elapsedMs: Date.now() - startedAt,
        });
      } finally {
        closed = true;
        try { controller.close(); } catch { /* client ปิดไปแล้ว */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
