"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesPrimitive,
  type IPrimitivePaneRenderer,
  type IPrimitivePaneView,
  type Logical,
  type SeriesAttachedParameter,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { SignalSide, SmcDetail } from "@/lib/smcScanShared";
import { cn } from "@/lib/utils";

// ─── สิ่งที่วาดทับกราฟ (พิกัดเป็น index ของแท่ง + ราคา) ─────────
type BoxSpec = { fromIdx: number; toIdx: number; top: number; bottom: number; fill: string; stroke: string };
type LineSpec = { fromIdx: number; toIdx: number; price: number; color: string; dashed: boolean; label?: string };

interface OverlayData {
  boxes: BoxSpec[];
  lines: LineSpec[];
}

/**
 * วาดกล่อง OB/FVG และเส้นโครงสร้างทั้งหมดในแคนวาสเดียว
 *
 * ทางเลือกเดิม (แบบหน้า /klines) คือสร้าง LineSeries ต่อ 1 เส้น ซึ่งบน
 * ข้อมูล 2,000 แท่งจะกลายเป็นหลายร้อย series — หน่วงบนมือถือและวาดกล่อง
 * ทึบไม่ได้ Primitive ตัวเดียวจึงทั้งเร็วกว่าและอ่านง่ายกว่าบนจอเล็ก
 */
class SmcOverlay implements ISeriesPrimitive<Time> {
  private attachedTo: SeriesAttachedParameter<Time> | null = null;
  private data: OverlayData = { boxes: [], lines: [] };
  private readonly view: IPrimitivePaneView;

  constructor() {
    // ใช้ arrow function เพื่อให้ `this` เป็นตัว class เอง (ไม่ต้อง alias)
    this.view = {
      // ใต้แท่งเทียน เพื่อไม่ให้กล่องบังราคา
      zOrder: () => "bottom",
      renderer: (): IPrimitivePaneRenderer | null => {
        const p = this.attachedTo;
        if (!p) return null;
        return {
          draw: (target) => {
            target.useMediaCoordinateSpace((scope) => {
              const ctx = scope.context;
              const ts = p.chart.timeScale();
              const series = p.series;
              const x = (idx: number) => ts.logicalToCoordinate(idx as Logical);
              const y = (price: number) => series.priceToCoordinate(price);
              const { boxes, lines } = this.data;

              for (const b of boxes) {
                const x1 = x(b.fromIdx), x2 = x(b.toIdx);
                const yTop = y(b.top), yBot = y(b.bottom);
                if (x1 == null || x2 == null || yTop == null || yBot == null) continue;
                // ตัดกล่องที่อยู่นอกจอทิ้ง เพื่อไม่ให้เสียเวลาวาด
                if (x2 < 0 || x1 > scope.mediaSize.width) continue;
                const w = Math.max(x2 - x1, 1);
                const h = Math.max(yBot - yTop, 1);
                ctx.fillStyle = b.fill;
                ctx.fillRect(x1, yTop, w, h);
                ctx.strokeStyle = b.stroke;
                ctx.lineWidth = 1;
                ctx.strokeRect(x1, yTop, w, h);
              }

              for (const l of lines) {
                const x1 = x(l.fromIdx), x2 = x(l.toIdx);
                const yy = y(l.price);
                if (x1 == null || x2 == null || yy == null) continue;
                if (x2 < 0 || x1 > scope.mediaSize.width) continue;
                ctx.save();
                ctx.strokeStyle = l.color;
                ctx.lineWidth = l.dashed ? 1 : 1.5;
                ctx.setLineDash(l.dashed ? [4, 3] : []);
                ctx.beginPath();
                ctx.moveTo(x1, yy);
                ctx.lineTo(x2, yy);
                ctx.stroke();
                if (l.label && x2 - x1 > 26) {
                  ctx.setLineDash([]);
                  ctx.fillStyle = l.color;
                  ctx.font = "9px ui-monospace, monospace";
                  ctx.textBaseline = "bottom";
                  ctx.fillText(l.label, x1 + 2, yy - 1);
                }
                ctx.restore();
              }
            });
          },
        };
      },
    };
  }

  attached(p: SeriesAttachedParameter<Time>) { this.attachedTo = p; }
  detached() { this.attachedTo = null; }
  updateAllViews() { /* พิกัดคำนวณสดตอน draw อยู่แล้ว */ }
  paneViews() { return [this.view]; }

  /** เปลี่ยนสิ่งที่จะวาดแล้วสั่งให้กราฟ repaint ผ่าน API ของ library เอง */
  setData(d: OverlayData) {
    this.data = d;
    this.attachedTo?.requestUpdate();
  }
}

// ─── Toggle chip ────────────────────────────────────────────────
function Chip({ on, onClick, color, children }: {
  on: boolean; onClick: () => void; color?: string; children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex h-7 shrink-0 items-center gap-1 px-2 text-[10px] font-medium whitespace-nowrap ring-1 transition-colors",
        on ? "bg-foreground/10 text-foreground ring-foreground/25" : "text-muted-foreground/60 ring-foreground/10",
      )}
    >
      {color && (
        <span
          className="inline-block h-0.5 w-2.5 rounded-full"
          style={{ backgroundColor: on ? color : "currentColor" }}
        />
      )}
      {children}
    </button>
  );
}

type Props = {
  detail: SmcDetail;
  /** ฝั่งที่ผู้ใช้กำลังดูอยู่ — ใช้เลื่อนมุมมองไปที่สัญญาณล่าสุดของฝั่งนั้น */
  focusSide?: SignalSide;
  height?: number;
};

export function SmcChart({ detail, focusSide = "buy", height = 320 }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const overlayRef = useRef<SmcOverlay | null>(null);
  // React รัน cleanup ตามลำดับที่ประกาศ effect — effect สร้างกราฟอยู่ก่อน cleanup ของมัน
  // (chart.remove()) จึงรันก่อน cleanup ของ effect หมุดสัญญาณ ทำให้ setMarkers() ไปแตะ
  // series ที่ถูกทำลายแล้วและโยน "Object is disposed" ธงนี้กันเคสนั้น
  const chartAliveRef = useRef(false);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== "light";

  const [showStruct, setShowStruct] = useState(true);
  const [showOb, setShowOb] = useState(true);
  const [showFvg, setShowFvg] = useState(false);
  const [showSwing, setShowSwing] = useState(false);
  const [showSignals, setShowSignals] = useState(true);
  const [showTpSl, setShowTpSl] = useState(false);
  const [activeOnly, setActiveOnly] = useState(true);

  const hasFvg = detail.drawings.fvgs.length > 0;
  const hasTpSl = !!detail.drawings.tp || !!detail.drawings.sl;

  // ── คำนวณสิ่งที่จะวาด ตาม toggle ──
  const overlay = useMemo<OverlayData>(() => {
    const d = detail.drawings;
    const boxes: BoxSpec[] = [];
    const lines: LineSpec[] = [];

    if (showOb) {
      const obs = activeOnly ? d.orderBlocks.filter((z) => !z.closed) : d.orderBlocks;
      // จำกัดจำนวนกล่องเพื่อไม่ให้จอเละ — เอาอันใหม่สุดก่อน
      for (const z of obs.slice(-14)) {
        const bull = z.bias === "bullish";
        boxes.push({
          fromIdx: z.fromIdx, toIdx: z.toIdx, top: z.top, bottom: z.bottom,
          fill: bull ? "rgba(16,185,129,0.13)" : "rgba(239,68,68,0.13)",
          stroke: bull ? "rgba(16,185,129,0.45)" : "rgba(239,68,68,0.45)",
        });
      }
    }

    if (showFvg) {
      const fs = activeOnly ? d.fvgs.filter((z) => !z.closed) : d.fvgs;
      for (const z of fs.slice(-20)) {
        const bull = z.bias === "bullish";
        boxes.push({
          fromIdx: z.fromIdx, toIdx: z.toIdx, top: z.top, bottom: z.bottom,
          fill: bull ? "rgba(56,189,248,0.10)" : "rgba(244,114,182,0.10)",
          stroke: bull ? "rgba(56,189,248,0.35)" : "rgba(244,114,182,0.35)",
        });
      }
    }

    if (showStruct) {
      for (const s of d.structures.slice(-45)) {
        const bull = s.bias === "bullish";
        lines.push({
          fromIdx: s.fromIdx, toIdx: s.toIdx, price: s.level,
          color: bull ? "#10b981" : "#ef4444",
          dashed: s.type !== "BOS",   // BOS = ทึบ, CHoCH = ประ (เหมือนหน้าเดสก์ท็อป)
          label: s.type,
        });
      }
    }

    if (showTpSl) {
      for (const [runs, color] of [
        [d.tp, "#10b981"] as const,
        [d.sl, "#ef4444"] as const,
      ]) {
        for (const run of runs ?? []) {
          lines.push({ fromIdx: run.fromIdx, toIdx: run.toIdx, price: run.value, color, dashed: true });
        }
      }
    }

    if (showSwing) {
      for (const sp of d.swingPoints.slice(-40)) {
        lines.push({
          fromIdx: sp.idx, toIdx: Math.min(sp.idx + 3, detail.bars - 1), price: sp.price,
          color: isDark ? "rgba(148,163,184,0.75)" : "rgba(71,85,105,0.75)",
          dashed: false,
          label: sp.type,
        });
      }
    }

    return { boxes, lines };
  }, [detail, showOb, showFvg, showStruct, showSwing, showTpSl, activeOnly, isDark]);

  // ── สร้าง/ทำลายกราฟ ──
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;

    const grid = isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.05)";
    const border = isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.12)";
    const text = isDark ? "#9ca3af" : "#6b7280";

    const chart = createChart(el, {
      width: el.clientWidth,
      height,
      layout: { background: { color: "transparent" }, textColor: text, fontSize: 10 },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      rightPriceScale: { borderColor: border, scaleMargins: { top: 0.12, bottom: 0.12 } },
      timeScale: { borderColor: border, timeVisible: true, secondsVisible: false, rightOffset: 4 },
      crosshair: { mode: 0 },
      // แนวตั้งปล่อยให้เป็นการเลื่อนหน้าจอ ไม่งั้นผู้ใช้จะติดอยู่ในกราฟ เลื่อนอ่านต่อไม่ได้
      handleScroll: { vertTouchDrag: false, horzTouchDrag: true, mouseWheel: true, pressedMouseMove: true },
      handleScale: { pinch: true, mouseWheel: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
    });
    chartRef.current = chart;
    chartAliveRef.current = true;

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: "#10b981", downColor: "#ef4444",
      borderUpColor: "#10b981", borderDownColor: "#ef4444",
      wickUpColor: "#10b981", wickDownColor: "#ef4444",
      priceLineVisible: false,
    });
    candleRef.current = candles;

    const c = detail.candles;
    candles.setData(c.t.map((t, i) => ({
      time: (t / 1000) as UTCTimestamp,
      open: c.o[i], high: c.h[i], low: c.l[i], close: c.c[i],
    })));

    const overlayPrim = new SmcOverlay();
    candles.attachPrimitive(overlayPrim);
    overlayRef.current = overlayPrim;

    const ro = new ResizeObserver(() => {
      if (el.clientWidth > 0) chart.applyOptions({ width: el.clientWidth });
    });
    ro.observe(el);

    chart.timeScale().fitContent();

    return () => {
      ro.disconnect();
      chartAliveRef.current = false;
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      overlayRef.current = null;
    };
    // สร้างใหม่เมื่อเปลี่ยนเหรียญ/ธีม/ความสูงเท่านั้น — toggle ไม่ต้องสร้างใหม่
  }, [detail, height, isDark]);

  // ── หมุดสัญญาณซื้อ/ขาย ──
  useEffect(() => {
    const candles = candleRef.current;
    if (!candles) return;
    // โชว์ข้อความบนหมุดเฉพาะตอนที่มีสัญญาณไม่กี่อัน ไม่งั้นป้ายจะทับกันเละ
    const denseLabels = detail.signals.length <= 8;
    const t = detail.candles.t;
    const markers: SeriesMarker<Time>[] = showSignals
      ? detail.signals
          .filter((s) => s.idx >= 0 && s.idx < t.length)
          .map((s) => ({
            time: (t[s.idx] / 1000) as UTCTimestamp,
            position: s.kind === "BUY" ? "belowBar" : "aboveBar",
            color: s.kind === "BUY" ? "#10b981" : "#ef4444",
            shape: s.kind === "BUY" ? "arrowUp" : "arrowDown",
            ...(denseLabels ? { text: s.kind === "BUY" ? "ซื้อ" : "ขาย" } : {}),
          }))
      : [];
    const handle = createSeriesMarkers(candles, markers);
    return () => { if (chartAliveRef.current) handle.setMarkers([]); };
  }, [detail, showSignals]);

  // ── ป้อนสิ่งที่จะวาดให้ primitive (มันจะสั่ง repaint เอง) ──
  useEffect(() => {
    overlayRef.current?.setData(overlay);
  }, [overlay]);

  // หา index จาก detail.signals ของ payload นี้เอง — ห้ามใช้ barIndex จากผลสแกน
  // เพราะกราฟดึงข้อมูลคนละรอบ ถ้ามีแท่งปิดเพิ่มระหว่างนั้น หน้าต่าง limit แท่งจะเลื่อน
  // ทำให้ index เดิมชี้ผิดแท่งทั้งชุด
  const focusIdx = useMemo(() => {
    const want = focusSide === "buy" ? "BUY" : "SELL";
    for (let i = detail.signals.length - 1; i >= 0; i--) {
      if (detail.signals[i].kind === want) return detail.signals[i].idx;
    }
    return null;
  }, [detail.signals, focusSide]);

  const fitAll = useCallback(() => chartRef.current?.timeScale().fitContent(), []);

  // เลื่อนไปให้เห็นแท่งที่เกิดสัญญาณ พร้อมบริบทรอบ ๆ
  const focusSignal = useCallback(() => {
    const chart = chartRef.current;
    if (!chart || focusIdx == null) return;
    const pad = 60;
    chart.timeScale().setVisibleLogicalRange({
      from: Math.max(0, focusIdx - pad) as Logical,
      to: Math.min(detail.bars - 1, focusIdx + pad) as Logical,
    });
  }, [focusIdx, detail.bars]);

  return (
    <div className="space-y-1.5">
      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Chip on={showStruct} onClick={() => setShowStruct(v => !v)} color="#10b981">CHoCH/BOS</Chip>
        <Chip on={showOb} onClick={() => setShowOb(v => !v)} color="#10b981">Order Block</Chip>
        {hasFvg && <Chip on={showFvg} onClick={() => setShowFvg(v => !v)} color="#38bdf8">FVG</Chip>}
        <Chip on={showSwing} onClick={() => setShowSwing(v => !v)} color="#94a3b8">Swing</Chip>
        <Chip on={showSignals} onClick={() => setShowSignals(v => !v)} color="#10b981">สัญญาณ</Chip>
        {hasTpSl && <Chip on={showTpSl} onClick={() => setShowTpSl(v => !v)} color="#10b981">TP/SL</Chip>}
        <Chip on={activeOnly} onClick={() => setActiveOnly(v => !v)}>
          {activeOnly ? "เฉพาะโซนที่ยังไม่ถูกแตะ" : "โซนทั้งหมด"}
        </Chip>
      </div>

      {/*
        touchAction: "pan-y" สำคัญมากบนมือถือ — lightweight-charts ไม่ตั้ง touch-action
        ให้เอง พอเป็น auto เบราว์เซอร์จะยึดท่าทางแนวนอนไปเลื่อนหน้าจอ แล้วยิง touchcancel
        ทำให้กราฟเลื่อนไม่ได้เลย ตั้ง pan-y แล้ว: ลากแนวนอน = เลื่อนกราฟ, แนวตั้ง = เลื่อน sheet
      */}
      <div
        ref={boxRef}
        role="application"
        aria-label={`กราฟแท่งเทียน ${detail.symbol} ${detail.interval} พร้อมเส้น Smart Money Concepts — ลากเพื่อเลื่อน`}
        className="w-full touch-pan-y ring-1 ring-foreground/10"
        style={{ height, touchAction: "pan-y" }}
      />

      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 text-[9px] leading-tight text-muted-foreground">
          ลากเพื่อเลื่อน · หุบนิ้วเพื่อซูม
        </span>
        <div className="flex shrink-0 gap-1">
          {focusIdx != null && (
            <button type="button" onClick={focusSignal} className="h-6 shrink-0 px-2 text-[9px] whitespace-nowrap ring-1 ring-foreground/15">
              ไปที่สัญญาณ{focusSide === "buy" ? "ซื้อ" : "ขาย"}
            </button>
          )}
          <button type="button" onClick={fitAll} className="h-6 shrink-0 px-2 text-[9px] whitespace-nowrap ring-1 ring-foreground/15">
            ทั้งหมด {detail.bars} แท่ง
          </button>
        </div>
      </div>
    </div>
  );
}

export default SmcChart;
