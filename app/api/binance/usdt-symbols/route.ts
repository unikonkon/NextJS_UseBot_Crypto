// ─────────────────────────────────────────────────────────────────
// GET /api/binance/usdt-symbols
// รายชื่อคู่ USDT spot ที่ "เทรดได้จริงตอนนี้" พร้อมวอลุ่ม 24 ชม.
//
// ใช้แทนการ hard-code รายชื่อเหรียญ เพราะ Binance เพิ่ม/ถอดเหรียญตลอด
// (ตอนเขียนนี้ 30 จาก 148 เหรียญใน list เดิมถูกถอดไปแล้ว) และเหรียญที่ถูก
// ถอดยังคืน klines ปกติแบบข้อมูลค้าง ซึ่งทำให้ผลสแกนเพี้ยนโดยไม่มี error
// ─────────────────────────────────────────────────────────────────
import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const revalidate = 300;

const BINANCE_BASE = "https://api.binance.com";

export interface UsdtSymbol {
  /** คู่เต็ม เช่น BTCUSDT */
  symbol: string;
  /** เหรียญฐาน เช่น BTC */
  base: string;
  /** มูลค่าซื้อขาย 24 ชม. (USDT) */
  quoteVolume: number;
  /** % เปลี่ยนแปลง 24 ชม. */
  changePct: number;
}

type CacheEntry = { at: number; data: UsdtSymbol[] };
let cache: CacheEntry | null = null;
const TTL_MS = 5 * 60_000;

async function load(signal?: AbortSignal): Promise<UsdtSymbol[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.data;

  const [eiRes, tickRes] = await Promise.all([
    // exchangeInfo เต็มก้อนคือ ~17MB — จำกัด permissions ให้เหลือเฉพาะ SPOT
    fetch(`${BINANCE_BASE}/api/v3/exchangeInfo?permissions=SPOT`, { cache: "no-store", signal }),
    fetch(`${BINANCE_BASE}/api/v3/ticker/24hr`, { cache: "no-store", signal }),
  ]);
  if (!eiRes.ok) throw new Error(`exchangeInfo ${eiRes.status}`);
  if (!tickRes.ok) throw new Error(`ticker/24hr ${tickRes.status}`);

  const ei = await eiRes.json() as {
    symbols: { symbol: string; baseAsset: string; quoteAsset: string; status: string; isSpotTradingAllowed: boolean }[];
  };
  const ticks = await tickRes.json() as { symbol: string; quoteVolume: string; priceChangePercent: string }[];
  const tickBy = new Map(ticks.map((t) => [t.symbol, t]));

  const data = ei.symbols
    .filter((s) => s.quoteAsset === "USDT" && s.status === "TRADING" && s.isSpotTradingAllowed)
    .map((s) => {
      const t = tickBy.get(s.symbol);
      return {
        symbol: s.symbol,
        base: s.baseAsset,
        quoteVolume: t ? +t.quoteVolume : 0,
        changePct: t ? +t.priceChangePercent : 0,
      };
    })
    .sort((a, b) => b.quoteVolume - a.quoteVolume);

  cache = { at: Date.now(), data };
  return data;
}

export async function GET(request: NextRequest) {
  try {
    const all = await load(request.signal);
    return Response.json(
      { updatedAt: cache?.at ?? Date.now(), total: all.length, symbols: all },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } },
    );
  } catch (err) {
    // ถ้า Binance ล่ม ยังคืนของเก่าดีกว่าพังทั้งหน้า
    if (cache) {
      return Response.json(
        { updatedAt: cache.at, total: cache.data.length, symbols: cache.data, stale: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    );
  }
}
