"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  WalletIcon,
  LinkSimpleIcon,
  LinkBreakIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  EyeIcon,
  EyeSlashIcon,
  SpinnerIcon,
  XCircleIcon,
  CheckCircleIcon,
  WarningIcon,
  ArrowsClockwiseIcon,
  TrashIcon,
  TestTubeIcon,
  GlobeIcon,
  CopyIcon,
  CaretDownIcon,
  CaretUpIcon,
  KeyIcon,
  ShieldCheckIcon,
  LockIcon,
  LightningIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import Image from "next/image";

// ─── Types ────────────────────────────────────────────────────
interface Balance {
  asset: string;
  free: string;
  locked: string;
}

interface OpenOrder {
  symbol: string;
  orderId: number;
  side: string;
  type: string;
  price: string;
  origQty: string;
  status: string;
  time: number;
}

interface TradeHistory {
  symbol: string;
  id: number;
  orderId: number;
  price: string;
  qty: string;
  quoteQty: string;
  commission: string;
  commissionAsset: string;
  time: number;
  isBuyer: boolean;
  isMaker: boolean;
}

interface OrderResult {
  symbol?: string;
  orderId?: number;
  status?: string;
  side?: string;
  type?: string;
  origQty?: string;
  executedQty?: string;
  cummulativeQuoteQty?: string;
  error?: string;
  details?: {
    msg: string;
    code: number;
    filter?: {
      minQty?: string;
      maxQty?: string;
      stepSize?: string;
      minNotional?: string;
    };
  };
}

type ConnectionSource = "manual" | null;

// ─── Component ────────────────────────────────────────────────
export default function BinanceTradingPage() {
  // Setup guide state
  const [showGuide, setShowGuide] = useState(false);

  // IP check state
  const [myIp, setMyIp] = useState("");
  const [serverIp, setServerIp] = useState("");
  const [loadingIp, setLoadingIp] = useState(false);
  const [ipCopied, setIpCopied] = useState(false);
  const [serverIpCopied, setServerIpCopied] = useState(false);

  // Connection state
  const [connected, setConnected] = useState(false);
  const [connectionSource, setConnectionSource] =
    useState<ConnectionSource>(null);
  const [manualApiKey, setManualApiKey] = useState("");
  const [manualSecretKey, setManualSecretKey] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState("");

  // Wallet state
  const [balances, setBalances] = useState<Balance[]>([]);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [loadingBalances, setLoadingBalances] = useState(false);
  const [assetPrices, setAssetPrices] = useState<Record<string, string>>({});
  const [loadingPriceAsset, setLoadingPriceAsset] = useState<string | null>(null);

  // ─── Fetch asset price (vs USDT) ──────────────────────────
  const fetchAssetPrice = async (asset: string) => {
    if (asset === "USDT") {
      setAssetPrices((prev) => ({ ...prev, [asset]: "1" }));
      return;
    }
    setLoadingPriceAsset(asset);
    try {
      const res = await fetch(
        `/api/binance/price?symbol=${encodeURIComponent(asset + "USDT")}`
      );
      const data = await res.json();
      if (res.ok && data.price) {
        setAssetPrices((prev) => ({ ...prev, [asset]: data.price }));
      } else {
        setAssetPrices((prev) => ({ ...prev, [asset]: "N/A" }));
      }
    } catch {
      setAssetPrices((prev) => ({ ...prev, [asset]: "N/A" }));
    } finally {
      setLoadingPriceAsset(null);
    }
  };

  // Order state
  const [orderCoin, setOrderCoin] = useState("BTC");
  const [orderQuote, setOrderQuote] = useState("USDT");
  const [orderSide, setOrderSide] = useState<"BUY" | "SELL">("BUY");
  const [orderType, setOrderType] = useState<"MARKET" | "LIMIT">("MARKET");
  const [orderInputMode, setOrderInputMode] = useState<"qty" | "usdt">("qty");
  const [orderQuantity, setOrderQuantity] = useState("");
  const [orderUsdtAmount, setOrderUsdtAmount] = useState("");
  const [orderPrice, setOrderPrice] = useState("");
  const [calcPrice, setCalcPrice] = useState("");
  const [calcUsdt, setCalcUsdt] = useState("");
  const [showCalc, setShowCalc] = useState(false);
  const [isTestOrder, setIsTestOrder] = useState(true);
  const [submittingOrder, setSubmittingOrder] = useState(false);
  const [orderResult, setOrderResult] = useState<OrderResult | null>(null);

  // Open orders state
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [cancellingId, setCancellingId] = useState<number | null>(null);

  // Trade history state
  const [trades, setTrades] = useState<TradeHistory[]>([]);
  const [loadingTrades, setLoadingTrades] = useState(false);
  const [tradeSymbol, setTradeSymbol] = useState("BTCUSDT");
  const [tradeLimit, setTradeLimit] = useState("50");
  const [tradeError, setTradeError] = useState("");

  // ─── Helpers ──────────────────────────────────────────────
  const getCredentials = useCallback(() => {
    return {
      apiKey: manualApiKey,
      secretKey: manualSecretKey,
    };
  }, [manualApiKey, manualSecretKey]);

  // ─── Check IP ─────────────────────────────────────────────
  const checkIp = async () => {
    setLoadingIp(true);
    try {
      // ดึง Client IP
      const clientRes = await fetch("https://api.ipify.org?format=json");
      const clientData = await clientRes.json();
      setMyIp(clientData.ip);

      // ดึง Server IP (IP ที่ Binance เห็นจริง)
      const serverRes = await fetch("/api/server-ip");
      const serverData = await serverRes.json();
      setServerIp(serverData.serverIp || "ไม่สามารถดึงได้");
    } catch {
      setMyIp("ไม่สามารถดึง IP ได้");
      setServerIp("ไม่สามารถดึง IP ได้");
    } finally {
      setLoadingIp(false);
    }
  };

  const copyIp = (ip: string, type: "client" | "server") => {
    navigator.clipboard.writeText(ip);
    if (type === "client") {
      setIpCopied(true);
      setTimeout(() => setIpCopied(false), 2000);
    } else {
      setServerIpCopied(true);
      setTimeout(() => setServerIpCopied(false), 2000);
    }
  };

  // ─── Connect wallet ───────────────────────────────────────
  const connectWallet = async () => {
    if (!manualApiKey || !manualSecretKey) {
      setConnectionError("กรุณากรอก API Key และ Secret Key");
      return;
    }
    setConnecting(true);
    setConnectionError("");

    try {
      const res = await fetch("/api/binance/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: manualApiKey, secretKey: manualSecretKey }),
      });
      const data = await res.json();

      if (!res.ok) {
        setConnectionError(
          data.details?.msg || data.error || "เชื่อมต่อไม่สำเร็จ"
        );
        setConnecting(false);
        return;
      }

      setBalances(data.balances || []);
      setPermissions(data.permissions || []);
      setConnected(true);
      setConnectionSource("manual");
    } catch {
      setConnectionError("ไม่สามารถเชื่อมต่อ Binance API ได้");
    } finally {
      setConnecting(false);
    }
  };

  // ─── Refresh balances ─────────────────────────────────────
  const refreshBalances = async () => {
    setLoadingBalances(true);
    try {
      const res = await fetch("/api/binance/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(getCredentials()),
      });
      const data = await res.json();
      if (res.ok) {
        setBalances(data.balances || []);
      }
    } catch {
      // silent
    } finally {
      setLoadingBalances(false);
    }
  };

  // ─── Submit order ─────────────────────────────────────────
  const submitOrder = async () => {
    const isUsdtMode = orderInputMode === "usdt" && orderType === "MARKET";
    const hasValue = isUsdtMode ? !!orderUsdtAmount : !!orderQuantity;
    if (!hasValue) return;
    setSubmittingOrder(true);
    setOrderResult(null);

    try {
      const orderPayload: Record<string, unknown> = {
        ...getCredentials(),
        symbol: `${orderCoin}${orderQuote}`,
        side: orderSide,
        type: orderType,
        testOrder: isTestOrder,
      };

      if (isUsdtMode) {
        orderPayload.quoteOrderQty = orderUsdtAmount;
      } else {
        orderPayload.quantity = orderQuantity;
      }

      if (orderType === "LIMIT") {
        orderPayload.price = orderPrice;
      }

      const res = await fetch("/api/binance/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orderPayload),
      });
      const data = await res.json();

      if (!res.ok) {
        setOrderResult({
          error: data.details?.msg || data.error || "Order failed",
          details: data.details,
        });
      } else {
        if (isTestOrder && Object.keys(data).length === 0) {
          setOrderResult({
            status: "TEST_OK",
            symbol: `${orderCoin}${orderQuote}`,
            side: orderSide,
            type: orderType,
            origQty: isUsdtMode ? `${orderUsdtAmount} USDT` : orderQuantity,
          });
        } else {
          setOrderResult(data);
        }
        refreshBalances();
      }
    } catch {
      setOrderResult({ error: "ไม่สามารถส่ง Order ได้" });
    } finally {
      setSubmittingOrder(false);
    }
  };

  // ─── Fetch open orders ────────────────────────────────────
  const fetchOpenOrders = async () => {
    setLoadingOrders(true);
    try {
      const res = await fetch("/api/binance/order/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(getCredentials()),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data)) {
        setOpenOrders(data);
      }
    } catch {
      // silent
    } finally {
      setLoadingOrders(false);
    }
  };

  // ─── Cancel order ─────────────────────────────────────────
  const cancelOrder = async (symbol: string, orderId: number) => {
    setCancellingId(orderId);
    try {
      const res = await fetch("/api/binance/order/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...getCredentials(), symbol, orderId }),
      });
      if (res.ok) {
        setOpenOrders((prev) => prev.filter((o) => o.orderId !== orderId));
      }
    } catch {
      // silent
    } finally {
      setCancellingId(null);
    }
  };

  // ─── Fetch trade history ───────────────────────────────────
  const fetchTrades = async () => {
    if (!tradeSymbol) {
      setTradeError("กรุณาระบุ Symbol");
      return;
    }
    setLoadingTrades(true);
    setTradeError("");
    try {
      const res = await fetch("/api/binance/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...getCredentials(),
          symbol: tradeSymbol,
          limit: Number(tradeLimit) || 50,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTradeError(data.details?.msg || data.error || "ดึงประวัติไม่สำเร็จ");
        setTrades([]);
      } else if (Array.isArray(data)) {
        setTrades(data);
      }
    } catch {
      setTradeError("ไม่สามารถเชื่อมต่อ Binance ได้");
    } finally {
      setLoadingTrades(false);
    }
  };

  // ─── Disconnect ───────────────────────────────────────────
  const disconnect = () => {
    setConnected(false);
    setConnectionSource(null);
    setBalances([]);
    setPermissions([]);
    setOpenOrders([]);
    setTrades([]);
    setOrderResult(null);
    setManualApiKey("");
    setManualSecretKey("");
  };

  // ─── Render ───────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <WalletIcon className="size-5 text-primary" weight="duotone" />
            <h1 className="text-lg font-semibold">Binance Trading</h1>
            <Button variant="outline" size="sm">
              <Link href="/klines">Back Test</Link>
            </Button>
            {connected && (
              <Button variant="outline" size="sm">
                <Link
                  href={`/trading/LiveTrading?apiKey=${encodeURIComponent(
                    manualApiKey
                  )}&secretKey=${encodeURIComponent(
                    manualSecretKey
                  )}`}
                  className="flex items-center gap-1"
                >
                  <LightningIcon weight="duotone" className="size-3.5" />
                  Live Trading
                </Link>
              </Button>
            )}
          </div>
          {connected && (
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="gap-1">
                <span className="size-1.5 rounded-full bg-green-500 animate-pulse" />
                เชื่อมต่อแล้ว
              </Badge>
              <Button variant="ghost" size="icon-sm" onClick={disconnect}>
                <LinkBreakIcon weight="bold" />
              </Button>
            </div>
          )}
        </div>

        {/* ─── Not Connected ─────────────────────────────── */}
        {!connected && (
          <Card>
            <CardHeader className="border-b">
              <CardTitle className="flex items-center gap-2">
                <LinkSimpleIcon weight="duotone" className="size-4" />
                เชื่อมต่อกระเป๋า Binance
              </CardTitle>
              <CardDescription>
                กรอก API Key และ Secret Key จาก Binance เพื่อเชื่อมต่อกระเป๋า
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Setup Guide */}
              <div className="rounded-md border border-yellow-500/30 bg-yellow-500/5">
                <button
                  type="button"
                  onClick={() => setShowGuide(!showGuide)}
                  className="flex w-full items-center justify-between p-3 text-left"
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-yellow-500">
                    <KeyIcon weight="duotone" className="size-4" />
                    ขั้นตอนการสร้าง API Key จาก Binance
                  </div>
                  {showGuide ? (
                    <CaretUpIcon className="size-4 text-yellow-500" />
                  ) : (
                    <CaretDownIcon className="size-4 text-yellow-500" />
                  )}
                </button>

                {showGuide && (
                  <div className="space-y-4 border-t border-yellow-500/20 p-4">
                    {/* Link to Binance API Management */}
                    <a
                      href="https://www.binance.com/en/my/settings/api-management"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs font-medium text-yellow-500 hover:bg-yellow-500/20 transition-colors w-fit"
                    >
                      <KeyIcon weight="bold" className="size-3.5" />
                      ไปหน้าสร้าง API Key ที่ Binance
                      <LinkSimpleIcon weight="bold" className="size-3.5" />
                    </a>

                    {/* Step 1: Choose API Key type */}
                    <div className="space-y-2">
                      <h3 className="flex items-center gap-1.5 text-xs font-semibold">
                        <Badge variant="outline" className="size-5 justify-center rounded-full text-[10px]">1</Badge>
                        Choose API Key type — เลือก System generated
                      </h3>
                      <p className="text-xs text-muted-foreground pl-7">
                        ใช้ HMAC symmetric encryption — Binance จะสร้าง API Key และ Secret Key ให้อัตโนมัติ
                        เก็บ Key เหล่านี้ให้ปลอดภัยเหมือนรหัสผ่าน อย่าแชร์ให้บุคคลที่สาม
                      </p>
                      <div className="pl-7">
                        <Image
                          src="/trading/Binance/set.png"
                          alt="Choose API Key type - System generated"
                          width={480}
                          height={480}
                          className="rounded-md border"
                        />
                      </div>
                    </div>

                    {/* Step 2: API restrictions */}
                    <div className="space-y-2">
                      <h3 className="flex items-center gap-1.5 text-xs font-semibold">
                        <Badge variant="outline" className="size-5 justify-center rounded-full text-[10px]">2</Badge>
                        ตั้งค่า API restrictions
                      </h3>
                      <div className="pl-7 space-y-2">
                        <div className="grid gap-1.5 text-xs">
                          <div className="flex items-start gap-2">
                            <ShieldCheckIcon weight="duotone" className="size-4 text-green-500 shrink-0 mt-0.5" />
                            <div>
                              <span className="font-medium">Enable Reading</span>
                              <Badge variant="secondary" className="text-[10px] ml-1.5">แนะนำ</Badge>
                              <p className="text-muted-foreground mt-0.5">ดูข้อมูลบัญชี ยอดคงเหลือ และประวัติการเทรด</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2">
                            <ShieldCheckIcon weight="duotone" className="size-4 text-green-500 shrink-0 mt-0.5" />
                            <div>
                              <span className="font-medium">Enable Spot & Margin Trading</span>
                              <Badge variant="secondary" className="text-[10px] ml-1.5">สำหรับเทรด</Badge>
                              <p className="text-muted-foreground mt-0.5">ส่งคำสั่งซื้อ/ขาย Spot และ Margin ได้</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2 text-muted-foreground">
                            <ShieldCheckIcon weight="duotone" className="size-4 shrink-0 mt-0.5" />
                            <div>
                              <span>Enable Margin Loan, Repay & Transfer</span>
                              <p className="mt-0.5">กู้ยืม ชำระคืน และโอนเงิน Margin</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2 text-muted-foreground">
                            <ShieldCheckIcon weight="duotone" className="size-4 shrink-0 mt-0.5" />
                            <div>
                              <span>Enable Futures</span>
                              <p className="mt-0.5">เทรดสัญญา Futures (USDⓈ-M / COIN-M)</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2 text-muted-foreground">
                            <ShieldCheckIcon weight="duotone" className="size-4 shrink-0 mt-0.5" />
                            <div>
                              <span>Enable Internal Transfer</span>
                              <p className="mt-0.5">โอนสินทรัพย์ระหว่างบัญชีภายใน เช่น Spot ↔ Futures</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2 text-muted-foreground">
                            <ShieldCheckIcon weight="duotone" className="size-4 shrink-0 mt-0.5" />
                            <div>
                              <span>Permits Universal Transfer</span>
                              <p className="mt-0.5">โอนสินทรัพย์ข้ามบัญชีทุกประเภท (Spot, Margin, Futures, Funding ฯลฯ)</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2 text-muted-foreground">
                            <ShieldCheckIcon weight="duotone" className="size-4 shrink-0 mt-0.5" />
                            <div>
                              <span>Enable Withdrawals</span>
                              <p className="mt-0.5">ถอนสินทรัพย์ออกจาก Binance ไปยังกระเป๋าภายนอก</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2 text-muted-foreground">
                            <ShieldCheckIcon weight="duotone" className="size-4 shrink-0 mt-0.5" />
                            <div>
                              <span>Enable European Options</span>
                              <p className="mt-0.5">เทรดออปชัน (European-style Options)</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-2 text-muted-foreground">
                            <ShieldCheckIcon weight="duotone" className="size-4 shrink-0 mt-0.5" />
                            <div>
                              <span>Enable Symbol Whitelist</span>
                              <p className="mt-0.5">จำกัดให้ API เทรดได้เฉพาะคู่เหรียญที่กำหนดเท่านั้น</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Step 3: IP access restrictions */}
                    <div className="space-y-2">
                      <h3 className="flex items-center gap-1.5 text-xs font-semibold">
                        <Badge variant="outline" className="size-5 justify-center rounded-full text-[10px]">3</Badge>
                        ตั้งค่า IP access restrictions
                      </h3>
                      <div className="pl-7 space-y-2">
                        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs">
                          <div className="flex items-center gap-2 font-medium text-destructive">
                            <WarningIcon weight="bold" className="size-3.5 shrink-0" />
                            Unrestricted (Less Secure)
                          </div>
                          <p className="mt-1 text-muted-foreground pl-5.5">
                            API Key สามารถเข้าถึงจาก IP ใดก็ได้ — ไม่แนะนำ
                            หากไม่จำกัด IP และเปิดสิทธิ์อื่นนอกจาก Reading API Key จะถูกลบอัตโนมัติ
                          </p>
                        </div>
                        <div className="rounded-md border border-green-500/30 bg-green-500/5 p-2.5 text-xs">
                          <div className="flex items-center gap-2 font-medium text-green-500">
                            <LockIcon weight="bold" className="size-3.5 shrink-0" />
                            Restrict access to trusted IPs only (Recommended)
                            <Badge variant="secondary" className="text-[10px]">แนะนำ</Badge>
                          </div>
                          <p className="mt-1 text-muted-foreground pl-5.5">
                            จำกัดเฉพาะ IP ที่เชื่อถือได้เท่านั้น — ใช้ปุ่ม &quot;ดู IP ของฉัน&quot; ด้านล่างเพื่อดู IP ของคุณ
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* IP Check */}
              <div className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={checkIp}
                  disabled={loadingIp}
                >
                  {loadingIp ? (
                    <SpinnerIcon className="size-3.5 animate-spin" />
                  ) : (
                    <GlobeIcon weight="duotone" className="size-3.5" />
                  )}
                  ดู IP
                </Button>
                {(myIp || serverIp) && (
                  <div className="space-y-1.5 rounded-md border p-2.5">
                    {/* Server IP — ต้องใช้ตัวนี้ตั้งค่าที่ Binance */}
                    {serverIp && (
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <span className="text-[10px] font-semibold text-primary whitespace-nowrap">Server IP:</span>
                          <code className="rounded bg-primary/10 border border-primary/20 px-2 py-0.5 text-xs font-mono font-bold text-primary">
                            {serverIp}
                          </code>
                          <button
                            type="button"
                            onClick={() => copyIp(serverIp, "server")}
                            className="text-primary hover:text-primary/80"
                            title="คัดลอก Server IP"
                          >
                            {serverIpCopied ? (
                              <CheckCircleIcon weight="bold" className="size-3.5 text-green-500" />
                            ) : (
                              <CopyIcon weight="bold" className="size-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                    <p className="text-[10px] text-primary font-medium">
                      Server IP คือ IP ของ Vercel Server ที่ส่งคำสั่งไปยัง Binance จริง — ใช้ IP นี้ตั้งค่าที่ Binance API Management
                    </p>
                    {/* Client IP */}
                    {myIp && (
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">Client IP:</span>
                          <code className="rounded bg-muted px-2 py-0.5 text-xs font-mono text-muted-foreground">
                            {myIp}
                          </code>
                          <button
                            type="button"
                            onClick={() => copyIp(myIp, "client")}
                            className="text-muted-foreground hover:text-foreground"
                            title="คัดลอก Client IP"
                          >
                            {ipCopied ? (
                              <CheckCircleIcon weight="bold" className="size-3.5 text-green-500" />
                            ) : (
                              <CopyIcon weight="bold" className="size-3.5" />
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                    <p className="text-[10px] text-muted-foreground">
                      Client IP คือ IP ของเบราว์เซอร์คุณ — ไม่ใช่ IP ที่ Binance เห็นเมื่อส่งคำสั่ง ไม่ต้องใช้ตั้งค่าที่ Binance
                    </p>
                    {/* หมายเหตุ */}
                    <div className="mt-1.5 rounded border border-yellow-500/30 bg-yellow-500/5 p-2 flex items-start gap-1.5">
                      <WarningIcon weight="fill" className="size-3.5 text-yellow-500 mt-0.5 shrink-0" />
                      <p className="text-[10px] text-yellow-600 dark:text-yellow-400">
                        <strong>หมายเหตุ:</strong> Vercel Serverless อาจเปลี่ยน Server IP ได้เมื่อ deploy ใหม่
                        หากไม่ต้องการตั้ง IP ซ้ำทุกครั้ง แนะนำให้ตั้งค่า API Key ที่ Binance เป็น
                        <strong> Unrestricted (ไม่จำกัด IP)</strong> แทน
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">API Key</label>
                  <Input
                    placeholder="กรอก Binance API Key"
                    value={manualApiKey}
                    onChange={(e) => setManualApiKey(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Secret Key</label>
                  <div className="relative">
                    <Input
                      type={showSecret ? "text" : "password"}
                      placeholder="กรอก Binance Secret Key"
                      value={manualSecretKey}
                      onChange={(e) => setManualSecretKey(e.target.value)}
                      className="pr-8"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSecret(!showSecret)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showSecret ? (
                        <EyeSlashIcon className="size-4" />
                      ) : (
                        <EyeIcon className="size-4" />
                      )}
                    </button>
                  </div>
                </div>
                <Button
                  onClick={connectWallet}
                  disabled={connecting}
                  className="w-full"
                >
                  {connecting ? (
                    <SpinnerIcon className="size-4 animate-spin" />
                  ) : (
                    <LinkSimpleIcon weight="bold" className="size-4" />
                  )}
                  เชื่อมต่อ
                </Button>
              </div>

              {connectionError && (
                <div className="flex items-center gap-2 rounded-none border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                  <XCircleIcon weight="bold" className="size-4 shrink-0" />
                  {connectionError}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* ─── Connected Dashboard ───────────────────────── */}
        {connected && (
          <>
            {/* Balances */}
            <Card>
              <CardHeader className="border-b">
                <CardTitle className="flex items-center gap-2">
                  <div className="flex items-center justify-between gap-2 w-full">
                    <div className="flex items-center gap-2">
                      <WalletIcon weight="duotone" className="size-4" />
                      ยอดคงเหลือ
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={refreshBalances}
                      disabled={loadingBalances}
                    >
                      {loadingBalances ? (
                        <SpinnerIcon className="size-3.5 animate-spin" />
                      ) : (
                        <ArrowsClockwiseIcon className="size-3.5" />
                      )}
                      Refresh
                    </Button>
                  </div>
                </CardTitle>
                <div className="flex items-center gap-1.5">
                  {permissions.map((p) => (
                    <Badge key={p} variant="outline" className="text-[10px]">
                      {p}
                    </Badge>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                {balances.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-4 text-center">
                    ไม่พบยอดคงเหลือ
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Asset</TableHead>
                        <TableHead className="text-right">Free</TableHead>
                        <TableHead className="text-right">Locked</TableHead>
                        <TableHead className="text-right">Price (USDT)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {balances.map((b) => (
                        <TableRow key={b.asset}>
                          <TableCell className="font-medium">
                            {b.asset}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {parseFloat(b.free).toFixed(8)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {parseFloat(b.locked) > 0 ? (
                              <span className="text-yellow-500">
                                {parseFloat(b.locked).toFixed(8)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">0</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {assetPrices[b.asset] !== undefined ? (
                              <div className="flex items-center justify-end gap-1.5">
                                <span
                                  className={`font-mono text-xs ${
                                    assetPrices[b.asset] === "N/A"
                                      ? "text-muted-foreground"
                                      : "text-green-500"
                                  }`}
                                >
                                  {assetPrices[b.asset] === "N/A"
                                    ? "N/A"
                                    : parseFloat(assetPrices[b.asset]).toLocaleString(undefined, {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 8,
                                      })}
                                </span>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 w-6 p-0"
                                  onClick={() => fetchAssetPrice(b.asset)}
                                  disabled={loadingPriceAsset === b.asset}
                                >
                                  {loadingPriceAsset === b.asset ? (
                                    <SpinnerIcon className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <ArrowsClockwiseIcon className="h-3 w-3" />
                                  )}
                                </Button>
                              </div>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 text-[10px] px-2"
                                onClick={() => fetchAssetPrice(b.asset)}
                                disabled={loadingPriceAsset === b.asset}
                              >
                                {loadingPriceAsset === b.asset ? (
                                  <SpinnerIcon className="h-3 w-3 animate-spin" />
                                ) : (
                                  "ดูราคา"
                                )}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
              <CardFooter>

              </CardFooter>
            </Card>

            {/* Order Form + Open Orders in tabs */}
            <Tabs defaultValue="order">
              <TabsList>
                <TabsTrigger value="order">ส่ง Order</TabsTrigger>
                <TabsTrigger value="open">Open Orders</TabsTrigger>
                <TabsTrigger value="trades">ประวัติเทรด</TabsTrigger>
              </TabsList>

              {/* ─── Order Form ─────────────────────────── */}
              <TabsContent value="order">
                <Card>
                  <CardContent className="space-y-4 pt-4">
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {/* Symbol = Coin + Quote */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium">Symbol</label>
                        <div className="flex gap-1">
                          <Input
                            placeholder="BTC"
                            value={orderCoin}
                            onChange={(e) =>
                              setOrderCoin(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))
                            }
                            className="flex-1"
                          />
                          <Select
                            value={orderQuote}
                            onValueChange={(v) => v && setOrderQuote(v)}
                          >
                            <SelectTrigger className="w-[80px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="USDT">USDT</SelectItem>
                              <SelectItem value="USDC">USDC</SelectItem>
                              <SelectItem value="BTC">BTC</SelectItem>
                              <SelectItem value="BNB">BNB</SelectItem>
                              <SelectItem value="ETH">ETH</SelectItem>
                              <SelectItem value="FDUSD">FDUSD</SelectItem>
                              <SelectItem value="TRY">TRY</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          คู่เทรด: <span className="font-mono font-bold">{orderCoin}{orderQuote}</span>
                        </p>
                      </div>

                      {/* Side */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium">Side</label>
                        <div className="flex gap-1">
                          <Button
                            variant={
                              orderSide === "BUY" ? "default" : "outline"
                            }
                            size="lg"
                            className={
                              orderSide === "BUY"
                                ? "flex-1 bg-green-600 hover:bg-green-700 text-white"
                                : "flex-1"
                            }
                            onClick={() => setOrderSide("BUY")}
                          >
                            <ArrowUpIcon weight="bold" className="size-3" />
                            BUY
                          </Button>
                          <Button
                            variant={
                              orderSide === "SELL" ? "default" : "outline"
                            }
                            size="lg"
                            className={
                              orderSide === "SELL"
                                ? "flex-1 bg-red-600 hover:bg-red-700 text-white"
                                : "flex-1"
                            }
                            onClick={() => setOrderSide("SELL")}
                          >
                            <ArrowDownIcon weight="bold" className="size-3" />
                            SELL
                          </Button>
                        </div>
                      </div>

                      {/* Type */}
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium">Type</label>
                        <Select
                          value={orderType}
                          onValueChange={(v) =>
                            setOrderType(v as "MARKET" | "LIMIT")
                          }
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="MARKET">MARKET</SelectItem>
                            <SelectItem value="LIMIT">LIMIT</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {/* Quantity / USDT toggle */}
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <label className="text-xs font-medium">
                            {orderInputMode === "usdt" && orderType === "MARKET" ? "USDT" : "Quantity"}
                          </label>
                        </div>
                        <div className="flex items-center gap-1.5">

                          {orderInputMode === "usdt" && orderType === "MARKET" ? (
                            <Input
                              type="number"
                              placeholder="10"
                              value={orderUsdtAmount}
                              onChange={(e) => setOrderUsdtAmount(e.target.value)}
                              step="any"
                            />
                          ) : (
                            <Input
                              type="number"
                              placeholder="0.001"
                              value={orderQuantity}
                              onChange={(e) => setOrderQuantity(e.target.value)}
                              step="any"
                            />
                          )}

                          {orderType === "MARKET" && (
                            <div className="flex rounded-xs border text-[14px] overflow-hidden ml-auto w-[145px] h-[33px]">
                              <button
                                type="button"
                                onClick={() => setOrderInputMode("qty")}
                                className={`px-1.5 py-0.5 transition-colors ${orderInputMode === "qty" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                              >
                                Qty
                              </button>
                              <button
                                type="button"
                                onClick={() => setOrderInputMode("usdt")}
                                className={`px-1.5 py-0.5 transition-colors ${orderInputMode === "usdt" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                              >
                                USDT
                              </button>
                            </div>
                          )}
                        </div>

                        {orderInputMode === "usdt" && orderType === "MARKET" && (
                          <p className="text-[10px] text-muted-foreground">
                            ระบุจำนวน USDT ที่ต้องการ{orderSide === "BUY" ? "ซื้อ" : "ขาย"} — ระบบคำนวณจำนวนเหรียญให้อัตโนมัติ
                          </p>
                        )}

                        {orderInputMode === "qty" && orderType === "MARKET" && (
                          <p className="text-[10px] text-muted-foreground">
                            ระบุจำนวนเหรียญที่ต้องการ
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Limit price */}
                    {orderType === "LIMIT" && (
                      <div className="space-y-1.5 max-w-xs">
                        <label className="text-xs font-medium">
                          Price (LIMIT)
                        </label>
                        <Input
                          type="number"
                          placeholder="65000"
                          value={orderPrice}
                          onChange={(e) => setOrderPrice(e.target.value)}
                          step="any"
                        />
                      </div>
                    )}

                    {/* USDT Calculator — optional helper */}
                    <div className="rounded-md border border-dashed p-3 space-y-2">
                      <button
                        type="button"
                        onClick={() => setShowCalc(!showCalc)}
                        className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
                      >
                        {showCalc ? (
                          <CaretUpIcon className="size-3.5" />
                        ) : (
                          <CaretDownIcon className="size-3.5" />
                        )}
                        คำนวณ USDT → Quantity (เพื่อซื้อขาย)
                      </button>
                      {showCalc && (
                        <div className="space-y-2 pt-1">
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <label className="text-[10px] text-muted-foreground">
                                ราคาเหรียญ ({orderQuote})
                              </label>
                              <Input
                                type="number"
                                placeholder="0.15"
                                value={orderType === "LIMIT" && orderPrice ? orderPrice : calcPrice}
                                onChange={(e) => {
                                  setCalcPrice(e.target.value);
                                  if (calcUsdt && e.target.value && parseFloat(e.target.value) > 0) {
                                    setOrderQuantity((parseFloat(calcUsdt) / parseFloat(e.target.value)).toFixed(8));
                                  }
                                }}
                                disabled={orderType === "LIMIT" && !!orderPrice}
                                step="any"
                              />
                              {orderType === "LIMIT" && orderPrice && (
                                <p className="text-[10px] text-muted-foreground">ใช้ราคา LIMIT อัตโนมัติ</p>
                              )}
                            </div>
                            <div className="space-y-1">
                              <label className="text-[10px] text-muted-foreground">
                                จำนวน {orderQuote} ที่ต้องการใช้
                              </label>
                              <Input
                                type="number"
                                placeholder="10"
                                value={calcUsdt}
                                onChange={(e) => {
                                  setCalcUsdt(e.target.value);
                                  const price = orderType === "LIMIT" && orderPrice ? orderPrice : calcPrice;
                                  if (price && e.target.value && parseFloat(price) > 0) {
                                    setOrderQuantity((parseFloat(e.target.value) / parseFloat(price)).toFixed(8));
                                  }
                                }}
                                step="any"
                              />
                            </div>
                          </div>
                          {orderQuantity && (calcUsdt || calcPrice) && (
                            <div className="flex items-center gap-2 rounded bg-muted/50 px-2 py-1.5">
                              <CheckCircleIcon weight="bold" className="size-3.5 text-green-500 shrink-0" />
                              <p className="text-[11px]">
                                <span className="text-muted-foreground">Quantity =</span>{" "}
                                <span className="font-mono font-bold">{orderQuantity}</span>{" "}
                                <span className="text-muted-foreground">{orderCoin}</span>
                                {(() => {
                                  const price = orderType === "LIMIT" && orderPrice ? orderPrice : calcPrice;
                                  if (price && orderQuantity) {
                                    const total = parseFloat(orderQuantity) * parseFloat(price);
                                    return (
                                      <span className="text-muted-foreground">
                                        {" "}≈ {total.toFixed(4)} {orderQuote}
                                      </span>
                                    );
                                  }
                                  return null;
                                })()}
                              </p>
                            </div>
                          )}
                        </div>
                      )}{" "}
                    </div>

                    {/* Test order toggle */}
                    <div className="flex items-center gap-3">
                      <Button
                        variant={isTestOrder ? "default" : "outline"}
                        size="xs"
                        onClick={() => setIsTestOrder(true)}
                      >
                        <TestTubeIcon weight="bold" className="size-3" />
                        Test Order
                      </Button>
                      <Button
                        variant={!isTestOrder ? "default" : "outline"}
                        size="xs"
                        onClick={() => setIsTestOrder(false)}
                      >
                        Live Order
                      </Button>
                      {isTestOrder && (
                        <span className="text-xs text-muted-foreground">
                          Validate เท่านั้น ไม่ส่ง Order จริง
                        </span>
                      )}
                      {!isTestOrder && (
                        <span className="text-xs text-destructive flex items-center gap-1">
                          <WarningIcon weight="bold" className="size-3" />
                          ส่ง Order จริง ใช้เงินจริง!
                        </span>
                      )}
                    </div>

                    {/* Submit */}
                    <Button
                      onClick={submitOrder}
                      disabled={submittingOrder || (orderInputMode === "usdt" && orderType === "MARKET" ? !orderUsdtAmount : !orderQuantity)}
                      className={`w-full ${orderSide === "BUY"
                        ? "bg-green-600 hover:bg-green-700"
                        : "bg-red-600 hover:bg-red-700"
                        } text-white`}
                    >
                      {submittingOrder ? (
                        <SpinnerIcon className="size-4 animate-spin" />
                      ) : orderSide === "BUY" ? (
                        <ArrowUpIcon weight="bold" className="size-4" />
                      ) : (
                        <ArrowDownIcon weight="bold" className="size-4" />
                      )}
                      {isTestOrder ? "Test" : ""} {orderSide} {`${orderCoin}${orderQuote}`}
                    </Button>

                    {/* Order result */}
                    {orderResult && (
                      <div
                        className={`rounded-none border p-3 text-xs space-y-1 ${orderResult.error
                          ? "border-destructive/30 bg-destructive/5 text-destructive"
                          : "border-green-500/30 bg-green-500/5 text-green-400"
                          }`}
                      >
                        {orderResult.error ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <XCircleIcon
                                weight="bold"
                                className="size-4 shrink-0"
                              />
                              <span>{orderResult.error}</span>
                              {orderResult.details && (
                                <span className="text-muted-foreground">
                                  (code: {orderResult.details.code})
                                </span>
                              )}
                            </div>
                            {orderResult.details?.code === -1013 && orderResult.details?.msg?.includes("NOTIONAL") && (
                              <p className="pl-6 text-muted-foreground">
                                มูลค่า Order ต่ำกว่าขั้นต่ำที่ Binance กำหนด (ประมาณ 5 USDT) — ต้องเพิ่มจำนวนเหรียญหรือใช้คู่เทรดอื่น
                              </p>
                            )}
                            {orderResult.details?.code === -1013 && orderResult.details?.msg?.includes("LOT_SIZE") && (
                              <div className="pl-6 text-muted-foreground space-y-1">
                                <p>
                                  จำนวนเหรียญไม่ผ่านเงื่อนไข <span className="font-mono">LOT_SIZE</span> ของคู่เทรดนี้ — Binance กำหนดให้:
                                </p>
                                <ul className="list-disc pl-4 space-y-0.5">
                                  <li>
                                    จำนวนต้อง <b>ไม่ต่ำกว่า minQty</b> (ขั้นต่ำที่ส่งได้)
                                  </li>
                                  <li>
                                    จำนวนต้อง <b>ไม่เกิน maxQty</b> (ขั้นสูงสุดที่ส่งได้)
                                  </li>
                                  <li>
                                    จำนวนต้องเป็น <b>ผลคูณของ stepSize</b> (เช่น stepSize 0.001 ส่ง 0.0015 ไม่ได้ ต้องเป็น 0.001, 0.002, ...)
                                  </li>
                                </ul>
                                {orderResult.details &&
                                  "filter" in orderResult.details &&
                                  (orderResult.details as { filter?: { minQty?: string; maxQty?: string; stepSize?: string } }).filter && (
                                    <p className="font-mono text-[11px] pt-1">
                                      ของคู่นี้: minQty={(orderResult.details as { filter: { minQty?: string } }).filter.minQty}
                                      {" "}stepSize={(orderResult.details as { filter: { stepSize?: string } }).filter.stepSize}
                                      {" "}maxQty={(orderResult.details as { filter: { maxQty?: string } }).filter.maxQty}
                                    </p>
                                  )}
                                <p className="text-[11px]">
                                  วิธีแก้: ปัดจำนวนให้ลงตัวกับ stepSize (เช่นใช้ <span className="font-mono">Math.floor(qty / step) * step</span>) หรือเปลี่ยนไปใช้โหมด USDT (Market) แทน
                                </p>
                              </div>
                            )}
                            {orderResult.details?.code === -1121 && (
                              <p className="pl-6 text-muted-foreground">
                                คู่เทรดไม่ถูกต้อง — ตรวจสอบชื่อเหรียญและคู่เทรดอีกครั้ง
                              </p>
                            )}
                            {orderResult.details?.code === -2010 && (
                              <p className="pl-6 text-muted-foreground">
                                ยอดคงเหลือไม่เพียงพอ — ตรวจสอบยอดในกระเป๋า
                              </p>
                            )}
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <CheckCircleIcon
                                weight="bold"
                                className="size-4 shrink-0"
                              />
                              <span className="font-medium">
                                {orderResult.status === "TEST_OK"
                                  ? "Test Order สำเร็จ (ไม่ได้ส่งจริง)"
                                  : `Order ${orderResult.status}`}
                              </span>
                            </div>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-muted-foreground pl-6">
                              <span>Symbol: {orderResult.symbol}</span>
                              <span>Side: {orderResult.side}</span>
                              <span>Type: {orderResult.type}</span>
                              <span>Qty: {orderResult.origQty}</span>
                              {orderResult.executedQty && (
                                <span>
                                  Executed: {orderResult.executedQty}
                                </span>
                              )}
                              {orderResult.orderId && (
                                <span>Order ID: {orderResult.orderId}</span>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ─── Open Orders ────────────────────────── */}
              <TabsContent value="open">
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs text-muted-foreground">
                        {openOrders.length} open order(s)
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={fetchOpenOrders}
                        disabled={loadingOrders}
                      >
                        {loadingOrders ? (
                          <SpinnerIcon className="size-3.5 animate-spin" />
                        ) : (
                          <ArrowsClockwiseIcon className="size-3.5" />
                        )}
                        Refresh
                      </Button>
                    </div>

                    {openOrders.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-8 text-center">
                        ไม่มี Open Orders —{" "}
                        <button
                          onClick={fetchOpenOrders}
                          className="underline hover:text-foreground"
                        >
                          กดโหลด
                        </button>
                      </p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Symbol</TableHead>
                            <TableHead>Side</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead className="text-right">Price</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead className="text-right"></TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {openOrders.map((order) => (
                            <TableRow key={order.orderId}>
                              <TableCell className="font-medium">
                                {order.symbol}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={
                                    order.side === "BUY"
                                      ? "default"
                                      : "destructive"
                                  }
                                  className={
                                    order.side === "BUY"
                                      ? "bg-green-600/20 text-green-400"
                                      : ""
                                  }
                                >
                                  {order.side}
                                </Badge>
                              </TableCell>
                              <TableCell>{order.type}</TableCell>
                              <TableCell className="text-right font-mono">
                                {order.price}
                              </TableCell>
                              <TableCell className="text-right font-mono">
                                {order.origQty}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">{order.status}</Badge>
                              </TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="destructive"
                                  size="icon-xs"
                                  onClick={() =>
                                    cancelOrder(order.symbol, order.orderId)
                                  }
                                  disabled={cancellingId === order.orderId}
                                >
                                  {cancellingId === order.orderId ? (
                                    <SpinnerIcon className="size-3 animate-spin" />
                                  ) : (
                                    <TrashIcon
                                      weight="bold"
                                      className="size-3"
                                    />
                                  )}
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>

              {/* ─── Trade History ──────────────────────── */}
              <TabsContent value="trades">
                <Card>
                  <CardContent className="pt-4 space-y-4">
                    {/* Search controls */}
                    <div className="flex flex-wrap items-end gap-5">
                      <div className="space-x-1.5">
                        <label className="text-xs font-medium">Symbol</label>
                        <Input
                          placeholder="BTCUSDT"
                          value={tradeSymbol}
                          onChange={(e) => setTradeSymbol(e.target.value.toUpperCase())}
                          className="w-[140px]"
                        />
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <label className="text-xs font-medium">จำนวน</label>
                        <Select
                          value={tradeLimit}
                          onValueChange={(v) => v && setTradeLimit(v)}
                        >
                          <SelectTrigger className="w-[90px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="10">10</SelectItem>
                            <SelectItem value="25">25</SelectItem>
                            <SelectItem value="50">50</SelectItem>
                            <SelectItem value="100">100</SelectItem>
                            <SelectItem value="500">500</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        onClick={fetchTrades}
                        disabled={loadingTrades}
                        size="sm"
                      >
                        {loadingTrades ? (
                          <SpinnerIcon className="size-3.5 animate-spin" />
                        ) : (
                          <ArrowsClockwiseIcon className="size-3.5" />
                        )}
                        โหลดประวัติ
                      </Button>
                    </div>

                    {/* Error */}
                    {tradeError && (
                      <div className="flex items-center gap-2 rounded-none border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                        <XCircleIcon weight="bold" className="size-4 shrink-0" />
                        {tradeError}
                      </div>
                    )}

                    {/* Results */}
                    {trades.length === 0 && !loadingTrades && !tradeError ? (
                      <p className="text-xs text-muted-foreground py-8 text-center">
                        ยังไม่มีข้อมูล — เลือก Symbol แล้วกด &quot;โหลดประวัติ&quot;
                      </p>
                    ) : trades.length > 0 && (
                      <>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">
                            {trades.length} รายการ — {tradeSymbol}
                          </span>
                          {/* Summary */}
                          {(() => {
                            const totalBuyQty = trades.filter(t => t.isBuyer).reduce((s, t) => s + parseFloat(t.quoteQty), 0);
                            const totalSellQty = trades.filter(t => !t.isBuyer).reduce((s, t) => s + parseFloat(t.quoteQty), 0);
                            const totalCommission = trades.reduce((s, t) => s + parseFloat(t.commission), 0);
                            return (
                              <div className="flex gap-3 text-[10px]">
                                <span className="text-green-500">BUY: {totalBuyQty.toFixed(4)}</span>
                                <span className="text-red-500">SELL: {totalSellQty.toFixed(4)}</span>
                                <span className="text-muted-foreground">Fee: {totalCommission.toFixed(6)}</span>
                              </div>
                            );
                          })()}
                        </div>
                        <div className="overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>เวลา</TableHead>
                                <TableHead>Side</TableHead>
                                <TableHead className="text-right">ราคา</TableHead>
                                <TableHead className="text-right">จำนวน</TableHead>
                                <TableHead className="text-right">มูลค่า</TableHead>
                                <TableHead className="text-right">ค่าธรรมเนียม</TableHead>
                                <TableHead>Role</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {trades.slice().reverse().map((t) => (
                                <TableRow key={t.id}>
                                  <TableCell className="text-xs whitespace-nowrap">
                                    {new Date(t.time).toLocaleString("th-TH", {
                                      day: "2-digit",
                                      month: "short",
                                      hour: "2-digit",
                                      minute: "2-digit",
                                      second: "2-digit",
                                    })}
                                  </TableCell>
                                  <TableCell>
                                    <Badge
                                      variant={t.isBuyer ? "default" : "destructive"}
                                      className={t.isBuyer ? "bg-green-600/20 text-green-400" : ""}
                                    >
                                      {t.isBuyer ? "BUY" : "SELL"}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-xs">
                                    {t.price}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-xs">
                                    {t.qty}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-xs">
                                    {parseFloat(t.quoteQty).toFixed(4)}
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-xs text-muted-foreground">
                                    {parseFloat(t.commission).toFixed(6)} {t.commissionAsset}
                                  </TableCell>
                                  <TableCell>
                                    <Badge variant="outline" className="text-[10px]">
                                      {t.isMaker ? "Maker" : "Taker"}
                                    </Badge>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </div>
  );
}
