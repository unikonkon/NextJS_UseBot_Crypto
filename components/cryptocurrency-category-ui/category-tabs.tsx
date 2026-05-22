"use client";

import { useState, useMemo } from "react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CRYPTO_CATEGORIES, type CryptoCoin } from "./data";

type Props = {
  onCoinSelect: (binancePair: string) => void;
  activeSymbol?: string;
};

export function CryptoCategoryTabs({ onCoinSelect, activeSymbol }: Props) {
  const [activeTab, setActiveTab] = useState<string>(CRYPTO_CATEGORIES[0]?.id ?? "");
  const activeCategory = CRYPTO_CATEGORIES.find((c) => c.id === activeTab);



  const handleClick = (coin: CryptoCoin) => {
    onCoinSelect(`${coin.symbol}USDT`);
  };

  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <CardTitle>หมวดหมู่เหรียญคริปโต</CardTitle>
            <CardDescription>
              เลือกหมวดและคลิกชื่อเหรียญเพื่อตั้งเป็น symbol — ข้อมูลจาก CoinMarketCap (กรองเฉพาะที่ซื้อขายบน Binance USDT)
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
          
            {activeCategory && (
              <a
                href={activeCategory.url}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-muted-foreground underline decoration-dotted hover:text-foreground"
              >
                ดูบน CMC ↗
              </a>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={(v) => v && setActiveTab(v)}>
          <TabsList variant="line" className="flex-wrap h-auto">
            {CRYPTO_CATEGORIES.map((cat) => (
              <TabsTrigger key={cat.id} value={cat.id} className="text-[11px] gap-1 px-2">
                <span>{cat.emoji}</span>
                <span>{cat.name}</span>
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[9px] tabular-nums">
                  {cat.coins.length}
                </Badge>
              </TabsTrigger>
            ))}
          </TabsList>

          {CRYPTO_CATEGORIES.map((cat) => (
            <TabsContent key={cat.id} value={cat.id} className="pt-2">
              <p className="text-[10px] text-muted-foreground mb-2">{cat.description}</p>
              {cat.coins.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-4 text-center">
                  ไม่มีเหรียญในหมวดนี้ที่ซื้อขายบน Binance
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {cat.coins.map((coin) => {
                    const pair = `${coin.symbol}USDT`;
                    const isActive = activeSymbol === pair;
                    return (
                      <Button
                        key={`${cat.id}-${coin.symbol}`}
                        variant={isActive ? "default" : "outline"}
                        size="sm"
                        onClick={() => handleClick(coin)}
                        className="h-7 px-2 text-[11px] gap-1"
                        title={`${coin.name} → ${pair}`}
                      >
                        <span className="font-mono font-semibold">{coin.symbol}</span>
                        <span className="text-muted-foreground font-normal hidden sm:inline">
                          {coin.name}
                        </span>
                      </Button>
                    );
                  })}
                </div>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}
