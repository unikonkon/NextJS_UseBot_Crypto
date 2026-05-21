"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ThemeToggle } from "@/components/theme-toggle";
import { STRATEGIES, type StrategyId } from "@/lib/backtest";
import { GOLD_SYMBOLS } from "./constants";
import GoldWatcherRow, { type GoldWatcherConfig } from "./GoldWatcherRow";
import GoldBacktestPanel from "./GoldBacktestPanel";

const STORAGE_KEY = "discordBot.goldWatchers";

function makeNewGoldWatcher(): GoldWatcherConfig {
  const rsi = STRATEGIES.find(s => s.id === "rsi")!;
  return {
    id: `gw-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    symbol: GOLD_SYMBOLS[0].label,
    interval: "1h",
    strategyId: "rsi" as StrategyId,
    strategyParams: { ...rsi.params },
    pollSeconds: 300,
    webhookUrl: "",
    useEnvWebhook: false,
    alertsEnabled: true,
    klineLimit: 200,
  };
}

type Tab = "live" | "backtest";

export default function GoldDashboard() {
  const [tab, setTab] = useState<Tab>("live");
  const [watchers, setWatchers] = useState<GoldWatcherConfig[]>([]);
  const [pollingMap, setPollingMap] = useState<Record<string, boolean>>({});
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setWatchers(parsed);
      }
    } catch { /* ignore */ }
    setHydrated(true);
  }, []);

  // Persist on change
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(watchers)); } catch { /* ignore */ }
  }, [watchers, hydrated]);

  const addWatcher = useCallback(() => {
    setWatchers(prev => [...prev, makeNewGoldWatcher()]);
  }, []);

  const updateWatcher = useCallback((id: string, patch: Partial<GoldWatcherConfig>) => {
    setWatchers(prev => prev.map(w => w.id === id ? { ...w, ...patch } : w));
  }, []);

  const removeWatcher = useCallback((id: string) => {
    setWatchers(prev => prev.filter(w => w.id !== id));
    setPollingMap(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const setWatcherPolling = useCallback((id: string, polling: boolean) => {
    setPollingMap(prev => prev[id] === polling ? prev : { ...prev, [id]: polling });
  }, []);

  const activeCount = Object.values(pollingMap).filter(Boolean).length;

  return (
    <div className="container mx-auto px-4 py-6 space-y-4 max-w-7xl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href="/discordBot"
            className="text-[12px] text-muted-foreground hover:text-foreground transition-colors"
          >
            ← กลับ Crypto Bot
          </Link>
          <Separator orientation="vertical" className="h-5" />
          <h1 className="text-xl font-bold text-amber-500">🥇 XAU/USD + Forex Bot</h1>
          <Badge variant="outline" className="text-[10px] text-amber-500 border-amber-500/30">
            Yahoo Finance · Dukascopy
          </Badge>
        </div>
        <ThemeToggle />
      </div>

      {/* Tabs */}
      <div className="inline-flex items-center gap-1 rounded-md border border-border/40 p-1 bg-muted/30">
        <Button
          size="sm"
          variant={tab === "live" ? "default" : "ghost"}
          className={tab === "live" ? "bg-emerald-500 hover:bg-emerald-600 text-white" : ""}
          onClick={() => setTab("live")}
        >
          📡 Live Trading (Yahoo)
        </Button>
        <Button
          size="sm"
          variant={tab === "backtest" ? "default" : "ghost"}
          className={tab === "backtest" ? "bg-amber-500 hover:bg-amber-600 text-white" : ""}
          onClick={() => setTab("backtest")}
        >
          🧪 Backtest (Dukascopy)
        </Button>
      </div>

      {tab === "live" ? (
        <Card size="sm" className="border-emerald-500/30">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-emerald-400">Live Trading — Discord Alerts</CardTitle>
                <CardDescription>
                  ดึง OHLC จาก Yahoo Finance (delay 10-15 นาที) แล้วยิงสัญญาณเข้า Discord — Forex/Metals ปิดเสาร์-อาทิตย์
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={activeCount > 0 ? "text-emerald-500 border-emerald-500/40 animate-pulse" : "text-muted-foreground"}
                >
                  {activeCount} / {watchers.length} active
                </Badge>
                <Button
                  size="sm"
                  className="bg-emerald-500 hover:bg-emerald-600 text-white"
                  onClick={addWatcher}
                >
                  + เพิ่ม Watcher
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-3">
            {watchers.length === 0 ? (
              <div className="rounded-md border border-dashed border-border p-6 text-center space-y-2">
                <p className="text-sm text-muted-foreground">ยังไม่มี Gold Watcher</p>
                <p className="text-[11px] text-muted-foreground">
                  กดปุ่ม <span className="font-medium text-emerald-400">+ เพิ่ม Watcher</span> เพื่อเริ่มต้น
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-emerald-500/30 text-emerald-400"
                  onClick={addWatcher}
                >
                  + สร้าง Watcher แรก
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {watchers.map(w => (
                  <GoldWatcherRow
                    key={w.id}
                    config={w}
                    onUpdate={updateWatcher}
                    onRemove={removeWatcher}
                    onPollingChange={setWatcherPolling}
                  />
                ))}
              </div>
            )}

            <div className="rounded border border-amber-500/20 bg-amber-500/5 p-2 text-[10px] text-amber-500/80">
              <p className="font-medium">💡 หมายเหตุ Yahoo Finance:</p>
              <p>• ราคามี delay 10-15 นาที (futures `GC=F` ใกล้ real-time มากกว่า spot `XAUUSD=X`)</p>
              <p>• ตลาด Forex/Metals ปิดเสาร์-อาทิตย์ → ไม่มีแท่งใหม่</p>
              <p>• Interval 1m ดึงย้อนหลังได้แค่ 7 วัน, 5m-30m ได้ 60 วัน, 1h ได้ 730 วัน</p>
              <p>• ห้าม poll เร็วเกินไป — แนะนำ ≥ 60 วินาที เพื่อไม่ให้โดน rate limit</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <GoldBacktestPanel />
      )}
    </div>
  );
}
