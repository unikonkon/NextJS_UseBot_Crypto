"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { CRYPTO_CATEGORIES, type CryptoCategory } from "@/components/cryptocurrency-category-ui";
import { cn } from "@/lib/utils";

type Mode = "category" | "coin";

type LiveSymbol = { symbol: string; base: string; quoteVolume: number; changePct: number };

type Props = {
  /** คู่เหรียญที่เลือก เช่น "BTCUSDT" */
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
};

const pairOf = (symbol: string) => `${symbol}USDT`;

/** หมวดที่สร้างจากรายชื่อสดของ Binance — ไม่ต้องดูแล list เอง */
function buildLiveCategories(live: LiveSymbol[]): CryptoCategory[] {
  if (live.length === 0) return [];
  const byVol = live; // route เรียงตามวอลุ่มมาแล้ว
  const mk = (id: string, emoji: string, name: string, description: string, list: LiveSymbol[]): CryptoCategory => ({
    id, emoji, name, description,
    url: "https://www.binance.com/en/markets/overview",
    coins: list.map((s) => ({ name: s.base, symbol: s.base })),
  });

  const out: CryptoCategory[] = [];
  for (const n of [50, 100, 200]) {
    if (byVol.length > n) {
      out.push(mk(
        `live-top${n}`, "🔥", `วอลุ่มสูงสุด ${n}`,
        `${n} คู่ USDT ที่มีมูลค่าซื้อขาย 24 ชม. สูงสุด — สภาพคล่องดี สัญญาณน่าเชื่อถือกว่า`,
        byVol.slice(0, n),
      ));
    }
  }
  out.push(mk(
    "live-all", "🌐", `ทั้งหมด ${byVol.length}`,
    "ทุกคู่ USDT ที่เทรดได้บน Binance ตอนนี้ — เหรียญท้าย ๆ วอลุ่มบางมาก สัญญาณอาจไม่น่าเชื่อถือ",
    byVol,
  ));
  return out;
}

/**
 * เลือกเหรียญ 2 โหมด:
 *  - "ทั้งหมวด" — แตะหมวด = ใช้ทุกเหรียญในหมวดนั้น (เลือกได้หลายหมวด)
 *  - "รายเหรียญ" — เลือกหมวดที่จะดู แล้วติ๊กเหรียญเอง
 * ทั้งสองโหมดเขียนลง Set เดียวกัน จึงสลับไปมาได้โดยไม่เสียของที่เลือกไว้
 */
export function CoinPicker({ selected, onChange }: Props) {
  const [mode, setMode] = useState<Mode>("category");
  const [viewCat, setViewCat] = useState(CRYPTO_CATEGORIES[0].id);
  const [search, setSearch] = useState("");
  const [live, setLive] = useState<LiveSymbol[]>([]);
  const [liveErr, setLiveErr] = useState<string | null>(null);

  // ดึงรายชื่อคู่ USDT ที่เทรดได้จริงตอนนี้ (cache ฝั่ง server 5 นาที)
  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/binance/usdt-symbols", { signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ symbols: LiveSymbol[] }>;
      })
      .then((d) => setLive(d.symbols ?? []))
      .catch((e) => { if (!ctrl.signal.aborted) setLiveErr(e instanceof Error ? e.message : String(e)); });
    return () => ctrl.abort();
  }, []);

  const categories = useMemo(
    () => [...buildLiveCategories(live), ...CRYPTO_CATEGORIES],
    [live],
  );

  const catState = useMemo(() => {
    const m = new Map<string, { total: number; picked: number }>();
    for (const cat of categories) {
      const picked = cat.coins.filter((c) => selected.has(pairOf(c.symbol))).length;
      m.set(cat.id, { total: cat.coins.length, picked });
    }
    return m;
  }, [selected, categories]);

  const toggleCategory = (id: string) => {
    const cat = categories.find((c) => c.id === id);
    if (!cat) return;
    const st = catState.get(id);
    const next = new Set(selected);
    // เลือกครบแล้ว → เอาออกทั้งหมวด, ไม่ครบ → เติมให้ครบ
    if (st && st.picked === st.total) cat.coins.forEach((c) => next.delete(pairOf(c.symbol)));
    else cat.coins.forEach((c) => next.add(pairOf(c.symbol)));
    onChange(next);
  };

  const toggleCoin = (symbol: string) => {
    const next = new Set(selected);
    const pair = pairOf(symbol);
    if (next.has(pair)) next.delete(pair);
    else next.add(pair);
    onChange(next);
  };

  const active = categories.find((c) => c.id === viewCat) ?? categories[0];
  const visibleCoins = !active
    ? []
    : search.trim()
      ? active.coins.filter((c) => `${c.symbol} ${c.name}`.toLowerCase().includes(search.trim().toLowerCase()))
      : active.coins;
  const activeState = active ? catState.get(active.id) : undefined;
  const allPicked = !!activeState && activeState.picked === activeState.total;

  return (
    <div className="space-y-2.5">
      {/* สลับโหมด */}
      <div className="grid grid-cols-2 gap-0 ring-1 ring-foreground/15">
        {(["category", "coin"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "h-9 text-xs font-medium transition-colors",
              mode === m ? "bg-primary text-primary-foreground" : "bg-background text-muted-foreground",
            )}
          >
            {m === "category" ? "เลือกทั้งหมวด" : "เลือกรายเหรียญ"}
          </button>
        ))}
      </div>

      {liveErr && (
        <p className="bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-600 dark:text-amber-400">
          ดึงรายชื่อเหรียญสดจาก Binance ไม่ได้ ({liveErr}) — ใช้ได้เฉพาะหมวดที่คัดไว้ล่วงหน้า
        </p>
      )}

      {mode === "category" ? (
        <div className="max-h-88 space-y-1.5 overflow-y-auto overscroll-contain pr-0.5">
          <div className="grid grid-cols-2 gap-1.5">
            {categories.map((cat) => {
              const st = catState.get(cat.id)!;
              const full = st.picked === st.total;
              const partial = st.picked > 0 && !full;
              const isLive = cat.id.startsWith("live-");
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => toggleCategory(cat.id)}
                  className={cn(
                    "flex min-h-11 items-center gap-1.5 px-2.5 py-2 text-left text-[11px] ring-1 transition-colors",
                    full
                      ? "bg-primary text-primary-foreground ring-primary"
                      : partial
                        ? "bg-primary/10 ring-primary/40"
                        : isLive
                          ? "bg-sky-500/8 ring-sky-500/30"
                          : "bg-background ring-foreground/12",
                  )}
                >
                  <span className="text-sm leading-none">{cat.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{cat.name}</span>
                    <span className={cn("block tabular-nums", full ? "opacity-80" : "text-muted-foreground")}>
                      {st.picked}/{st.total}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {/* แถบหมวดแบบเลื่อนแนวนอน */}
          <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {categories.map((cat) => {
              const st = catState.get(cat.id)!;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => { setViewCat(cat.id); setSearch(""); }}
                  className={cn(
                    "flex h-9 shrink-0 items-center gap-1 px-2.5 text-[11px] whitespace-nowrap ring-1 transition-colors",
                    viewCat === cat.id
                      ? "bg-foreground text-background ring-foreground"
                      : "bg-background ring-foreground/12",
                  )}
                >
                  <span>{cat.emoji}</span>
                  <span>{cat.name}</span>
                  {st.picked > 0 && (
                    <Badge
                      variant={viewCat === cat.id ? "secondary" : "default"}
                      className="ml-0.5 h-4 px-1 text-[9px] tabular-nums"
                    >
                      {st.picked}
                    </Badge>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex gap-1.5">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={`ค้นหาใน ${active?.name ?? ""}…`}
              className="h-8 text-xs"
              inputMode="search"
            />
            <Button
              variant={allPicked ? "secondary" : "outline"}
              size="sm"
              className="h-8 shrink-0"
              onClick={() => active && toggleCategory(active.id)}
            >
              {allPicked ? "ล้างหมวด" : "เลือกทั้งหมด"}
            </Button>
          </div>

          {/* หมวดสดมีได้ถึง ~470 เหรียญ — จำกัดความสูงแล้วให้เลื่อนแทนการดันหน้ายาว */}
          <div className="max-h-72 overflow-y-auto overscroll-contain pr-0.5">
            <div className="grid grid-cols-3 gap-1.5 xs:grid-cols-4">
              {visibleCoins.map((coin) => {
                const on = selected.has(pairOf(coin.symbol));
                return (
                  <button
                    key={coin.symbol}
                    type="button"
                    onClick={() => toggleCoin(coin.symbol)}
                    title={coin.name}
                    className={cn(
                      "flex h-10 items-center justify-center px-1 font-mono text-[11px] font-semibold ring-1 transition-colors",
                      on
                        ? "bg-primary text-primary-foreground ring-primary"
                        : "bg-background text-foreground ring-foreground/12",
                    )}
                  >
                    {coin.symbol}
                  </button>
                );
              })}
              {visibleCoins.length === 0 && (
                <p className="col-span-full py-4 text-center text-[11px] text-muted-foreground italic">
                  {search ? `ไม่พบเหรียญที่ตรงกับ “${search}”` : "ไม่มีเหรียญในหมวดนี้"}
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {selected.size > 0 && (
        <div className="flex items-center justify-between border-t border-foreground/10 pt-2">
          <span className="text-[11px] text-muted-foreground">
            เลือกแล้ว <span className="font-semibold text-foreground tabular-nums">{selected.size}</span> เหรียญ
          </span>
          <Button variant="ghost" size="xs" onClick={() => onChange(new Set())}>
            ล้างทั้งหมด
          </Button>
        </div>
      )}
    </div>
  );
}
