# คู่มือ Indicators ที่เพิ่มเข้ามาในระบบ

เอกสารนี้สรุปรายละเอียดของ Indicators ทั้งหมด 17 ตัวที่ถูกแปลงจาก PineScript เป็น TypeScript และเชื่อมต่อกับระบบ Backtest + UI ของ `app/klines` พร้อม chart overlay เต็มรูปแบบ ครอบคลุมจากการ port จาก `.pine` ไฟล์ในโฟลเดอร์ [`lib/`](../) ทั้งหมด

แบ่งเป็น 4 กลุ่ม (G1-G4) ตามลำดับที่พัฒนา:

| Batch | กลุ่ม | จำนวน |
|---|---|---|
| **G1** | Trend / Stop indicators | 5 |
| **G2** | Breakouts | 3 |
| **G3** | New versions ของ duplicates | 4 |
| **G4** | Patterns + Detection | 5 |
| **รวม** | | **17** |

ทุก indicator export function ใน [`lib/indicators.ts`](../indicators.ts) คืน object ที่มี field `signal: ("BUY" | "SELL" | null)[]` พร้อมใช้กับ backtest engine ใน [`lib/backtest.ts`](../backtest.ts) ได้ทันที

---

## สารบัญ

- [G1: Trend / Stop Indicators](#g1-trend--stop-indicators)
  - [1. Chandelier Exit](#1-chandelier-exit)
  - [2. Tony's EMA Scalper](#2-tonys-ema-scalper)
  - [3. SuperTrend STRATEGY (Kivanc)](#3-supertrend-strategy-kivanc)
  - [4. Turtle Trade Channels](#4-turtle-trade-channels)
  - [5. Scalping PullBack Tool (JustUncleL)](#5-scalping-pullback-tool-justunclel)
- [G2: Breakout Indicators](#g2-breakout-indicators)
  - [6. Trendline Breakouts With Targets (ChartPrime)](#6-trendline-breakouts-with-targets-chartprime)
  - [7. Smart Money Breakout Channels (AlgoAlpha)](#7-smart-money-breakout-channels-algoalpha)
  - [8. Support & Resistance High Volume Boxes (ChartPrime)](#8-support--resistance-high-volume-boxes-chartprime)
- [G3: New Versions ของ Duplicates](#g3-new-versions-ของ-duplicates)
  - [9. CDC ActionZone V.2 (Piriya 2016)](#9-cdc-actionzone-v2-piriya-2016)
  - [10. ZigZag++ (DevLucem-style)](#10-zigzag-devlucem-style)
  - [11. Price Action SMC (BigBeluga)](#11-price-action-smc-bigbeluga)
  - [12. Price Action S&R (DGT)](#12-price-action-sr-dgt)
- [G4: Patterns + Detection](#g4-patterns--detection)
  - [13. Candlestick Patterns Identified](#13-candlestick-patterns-identified)
  - [14. Pivot Points HL (LuxAlgo)](#14-pivot-points-hl-luxalgo)
  - [15. TMA Overlay](#15-tma-overlay)
  - [16. Auto Chart Patterns (Trendoscope)](#16-auto-chart-patterns-trendoscope)
  - [17. DIY Custom Strategy Builder (ZP)](#17-diy-custom-strategy-builder-zp)
- [การใช้งานร่วมกัน](#การใช้งานร่วมกัน)

---

# G1: Trend / Stop Indicators

กลุ่มแรกเป็น indicator สาย trend-following และ trailing stop เป็นหลัก signal เกิดจากการกลับทิศของ band/stop หรือการ cross ระหว่างราคากับ MA

## 1. Chandelier Exit

**Author:** Alex Orekhov (everget) — ต้นฉบับ: [`Chandelier Exit.pine`](../Chandelier%20Exit.pine)

**แนวคิด:** ATR Trailing Stop ทั้งสองฝั่ง — ขึ้นและลง โดยอิง Highest High / Lowest Low ในช่วง N แท่งย้อนหลัง ทิศ (dir) จะกลับเมื่อราคา close ผ่าน stop ของฝั่งตรงข้าม

**Function:**
```ts
chandelierExit(klines, length = 22, mult = 3.0, useClose = true)
```

**Parameters:**
- `length` — ATR period และ Highest/Lowest lookback (default 22)
- `mult` — ATR multiplier (default 3.0)
- `useClose` — ใช้ close หา highest/lowest แทน high/low (กรอง wick)

**Output:**
- `longStop`, `shortStop` — ค่าระดับ stop ทั้งสองฝั่ง
- `dir` — ทิศปัจจุบัน (1 = ขาขึ้น, -1 = ขาลง)
- `signal` — BUY เมื่อ dir พลิกเป็น 1, SELL เมื่อพลิกเป็น -1

**Signal Logic:**
- Long stop = Highest(N) − ATR × mult (sticky upward)
- Short stop = Lowest(N) + ATR × mult (sticky downward)
- close > shortStop_prev → flip dir = 1 → BUY
- close < longStop_prev → flip dir = -1 → SELL

**จุดเด่น:** สัญญาณชัด ราคาเข้าหา stop ที่ปรับตัวตาม volatility — เหมาะกับเทรนด์ใหญ่ ๆ
**ข้อจำกัด:** False signals เยอะใน sideways

---

## 2. Tony's EMA Scalper

**Author:** TUX — ต้นฉบับ: [`Tony's EMA Scalper - Buy Sell.pine`](../Tony's%20EMA%20Scalper%20-%20Buy%20Sell.pine)

**แนวคิด:** ระบบ scalp ง่ายมาก ใช้ EMA เป็นเส้นหลัก เมื่อราคา cross EMA + ทิศการเคลื่อนของแท่งบ่งบอกทิศของสัญญาณ มีช่อง Highest/Lowest Close 8 แท่งเป็นเส้นอ้างอิงด้านบน/ล่าง

**Function:**
```ts
tonyEmaScalper(klines, length = 20, channelLength = 8)
```

**Parameters:**
- `length` — EMA period (default 20)
- `channelLength` — Highest/Lowest Close lookback (default 8)

**Output:**
- `emaLine` — เส้น EMA หลัก
- `highChannel`, `lowChannel` — Highest/Lowest Close
- `signal` — BUY/SELL ที่ cross

**Signal Logic:**
- BUY: close cross ขึ้นเหนือ EMA (`prev close < prev EMA && current close ≥ current EMA`)
- SELL: close cross ลงใต้ EMA (กลับกัน)

**จุดเด่น:** สั้น เข้าใจง่าย scalp ได้
**ข้อจำกัด:** whipsaw ใน choppy market

---

## 3. SuperTrend STRATEGY (Kivanc)

**Author:** KivancOzbilgic — ต้นฉบับ: [`SuperTrend STRATEGY.pine`](../SuperTrend%20STRATEGY.pine)

**แนวคิด:** เวอร์ชันของ Supertrend ที่เปิดให้เลือกวิธีคำนวณ ATR ได้ระหว่าง RMA (Wilder smoothing) มาตรฐาน หรือ SMA ของ True Range ที่ราบเรียบกว่า ใช้ src = hl2 เป็นตัวอ้างอิง

**Function:**
```ts
superTrendStrategy(klines, atrPeriod = 10, multiplier = 3.0, changeATR = true)
```

**Parameters:**
- `atrPeriod` — ATR period
- `multiplier` — ATR multiplier
- `changeATR` — true = RMA (Wilder), false = SMA ของ TR

**Output:**
- `supertrend` — เส้นแสดงค่าจริง (ตามทิศ)
- `trend` — 1 หรือ -1
- `upperBand`, `lowerBand` — ค่า band ทั้งสองฝั่ง
- `signal` — BUY/SELL ที่ trend พลิก

**Signal Logic:**
- band ขยับได้ทางเดียว: up (lower band) ขยับขึ้นได้อย่างเดียว, dn (upper band) ขยับลงได้อย่างเดียว
- trend = -1 → 1 เมื่อ close > prev dn → BUY
- trend = 1 → -1 เมื่อ close < prev up → SELL

**จุดเด่น:** เป็น Supertrend variant ที่ใช้กันมาก
**ข้อจำกัด:** เหมือน Supertrend ทั่วไป — ไม่เหมาะกับ sideways

---

## 4. Turtle Trade Channels

**Author:** KivancOzbilgic — ต้นฉบับ: [`Turtle Trade Channels Indicator.pine`](../Turtle%20Trade%20Channels%20Indicator.pine)

**แนวคิด:** Donchian Channel Breakout (สไตล์ Turtle Traders ดั้งเดิม) — เข้าเทรดเมื่อราคาทะลุสูงสุด/ต่ำสุดของ Entry Length และออกเมื่อราคาหลุดช่องที่แคบกว่า (Exit Length)

**Function:**
```ts
turtleChannels(klines, entryLength = 20, exitLength = 10)
```

**Parameters:**
- `entryLength` — N สำหรับ entry channel
- `exitLength` — M สำหรับ exit channel (M < N)

**Output:**
- `upper`, `lower` — entry channel
- `exitUpper`, `exitLower` — exit channel
- `trendLine` — K1: เส้นเทรนด์ปัจจุบัน (down ในเทรนด์ขึ้น / up ในเทรนด์ลง)
- `exitLine` — K2: เส้นที่ใช้สำหรับ exit
- `signal` — BUY/SELL

**Signal Logic (long-only state machine):**
- ไม่ถือ และ `high ≥ prev upper` → BUY (เข้า long)
- ถือ long และ `low ≤ prev exitLower` → SELL (ออก)

**จุดเด่น:** เทรดเทรนด์ใหญ่ ทำกำไรได้ดีในตลาด trending
**ข้อจำกัด:** drawdown สูงใน sideways

---

## 5. Scalping PullBack Tool (JustUncleL)

**Author:** JustUncleL R1.1 — ต้นฉบับ: [`Scalping PullBack Tool R1.1 by JustUncleL.pine`](../Scalping%20PullBack%20Tool%20R1.1%20by%20JustUncleL.pine)

**แนวคิด:** ระบบที่ผสม EMA ribbon (fast/medium/slow) กับ Price Action Channel (PAC) — เทรนด์เป็นขาขึ้นเมื่อ fast EMA + PAC low อยู่เหนือ medium EMA สัญญาณเกิดเมื่อราคาย่อ (pullback) ผ่าน PAC ฝั่งตรงข้าม แล้วกลับมาฝั่งเดิมตามเทรนด์หลัก

**Function:**
```ts
scalpingPullBack(klines, pacLength = 34, fastEMALength = 89, mediumEMALength = 200, slowEMALength = 600, lookback = 3)
```

**Parameters:**
- `pacLength` — PAC EMA period (default 34)
- `fastEMALength`, `mediumEMALength`, `slowEMALength` — EMA ribbon
- `lookback` — จำนวนแท่งย้อนเช็คการ cross PAC

**Output:**
- `pacU`, `pacL`, `pacC` — PAC channel (upper/lower/close-based)
- `fastEMA`, `mediumEMA`, `slowEMA` — EMA ribbon
- `trendDirection` — -1 / 0 / 1
- `signal` — BUY/SELL จาก state machine

**Signal Logic:**
- bullish trend: fastEMA > mediumEMA AND pacL > mediumEMA → td=1
- bearish trend: fastEMA < mediumEMA AND pacU < mediumEMA → td=-1
- pacExitU: open < pacU AND close > pacU AND lookback แท่งล่าสุดมี close < pacC → pullback กลับขึ้น
- BUY: td=1 + pacExitU + tradeDirection กำลังเปลี่ยนจาก 0 เป็น 1

**จุดเด่น:** หา pullback entry ในเทรนด์ที่แข็งแกร่ง
**ข้อจำกัด:** ต้องมีเทรนด์ชัด — ใน sideways แทบไม่ส่งสัญญาณ

---

# G2: Breakout Indicators

กลุ่ม breakout — channels/trendlines/boxes ที่ตรวจจับการทะลุของราคา ใช้ volatility หรือ volume เป็น filter

## 6. Trendline Breakouts With Targets (ChartPrime)

**Author:** ChartPrime — ต้นฉบับ: [`Trendline Breakouts With Targets [ Chartprime ].pine`](../Trendline%20Breakouts%20With%20Targets%20[%20Chartprime%20].pine)

**แนวคิด:** สร้างเส้นเทรนด์จาก pivot 2 จุดต่อเนื่อง — เส้นบน (resistance) จาก pivot highs, เส้นล่าง (support) จาก pivot lows เข้าเทรดเมื่อราคาทะลุเส้นที่ลาดทวนทิศ พร้อม TP/SL จาก Zband (ATR-based)

**Function:**
```ts
trendlineBreakouts(klines, period = 10, useWicks = true)
```

**Parameters:**
- `period` — leftBars สำหรับ pivot (rightBars = period/2)
- `useWicks` — true = ใช้ high/low, false = ใช้ open/close

**Output:**
- `upperTrendline`, `lowerTrendline` — ค่า trendline ที่ทุกบาร์
- `upperSlope`, `lowerSlope` — slope ปัจจุบัน
- `targets[]` — รายการ TP/SL เป้าหมายของแต่ละ trade
- `signal` — BUY เมื่อทะลุ resistance ที่ลาดลง, SELL เมื่อ TP/SL hit

**Signal Logic:**
- เมื่อมี pivot ใหม่ → อัปเดต trendline จาก 2 pivots ล่าสุด (slope)
- BUY: resistance slope < 0 AND close[i-1] < prev trendline AND close[i] > current trendline
- ขณะถือ long: SELL เมื่อ high ≥ TP หรือ close ≤ SL
- Zband = min(ATR(30) × 0.3, close × 0.003) / 2 (delayed 20 bars)
- TP = high_entry + 20×Zband, SL = low_entry − 20×Zband

**จุดเด่น:** entry + exit ครบในตัว เหมาะกับ classical TA breakout
**ข้อจำกัด:** lag จาก rightBars=period/2 ของ pivot

---

## 7. Smart Money Breakout Channels (AlgoAlpha)

**Author:** AlgoAlpha — ต้นฉบับ: [`Smart Money Breakout Channels [AlgoAlpha].pine`](../Smart%20Money%20Breakout%20Channels%20[AlgoAlpha].pine)

**แนวคิด:** ตรวจจับช่วง consolidation ด้วยการ normalize ราคาแล้วใช้ stdev เป็นตัววัด — เมื่อเข้าสู่ช่วง compression ได้นานพอจะวาด channel ครอบช่วงนั้น เมื่อราคาทะลุกรอบ = สัญญาณ breakout

**Function:**
```ts
smartMoneyBreakoutChannels(klines, normLength = 100, boxLength = 14, strongCloses = true, allowOverlap = false)
```

**Parameters:**
- `normLength` — bars สำหรับ normalize ราคา (0..1)
- `boxLength` — period สำหรับหาตำแหน่ง max/min ของ vol
- `strongCloses` — ใช้ avg(open, close) แทน close ในการเช็ค breakout
- `allowOverlap` — อนุญาตให้ channel ซ้อนกัน

**Output:**
- `channels[]` — รายการ channel boxes (top/bottom/broken)
- `upbreak`, `downbreak` — ค่าระดับที่ถูก break
- `signal` — BUY/SELL

**Signal Logic:**
- normalize: `(close − lowest100) / (highest100 − lowest100)`
- vol = stdev(normalized, 14)
- upper/lower position = highestBars/lowestBars ของ vol
- เมื่อ upper cross above lower + duration > 10 → สร้าง channel
- breakout: avg(open,close) > box.top → BUY; < box.bottom → SELL

**จุดเด่น:** จับ accumulation/distribution zone ก่อน breakout
**ข้อจำกัด:** delayed signal — ต้องรอ channel form ก่อน

---

## 8. Support & Resistance High Volume Boxes (ChartPrime)

**Author:** ChartPrime — ต้นฉบับ: [`Support and Resistance (High Volume Boxes) [ChartPrime].pine`](../Support%20and%20Resistance%20(High%20Volume%20Boxes)%20[ChartPrime].pine)

**แนวคิด:** S/R box จาก pivot ที่กรองด้วย Delta Volume — Support = pivot low + buying pressure (vol+), Resistance = pivot high + selling pressure (vol−) ขยายเป็น box ด้วย ATR(200) × Width

**Function:**
```ts
srHighVolumeBoxes(klines, lookbackPeriod = 20, volLen = 2, boxWidth = 1.0)
```

**Parameters:**
- `lookbackPeriod` — pivot left/right bars
- `volLen` — Volume filter length
- `boxWidth` — box height = ATR(200) × boxWidth

**Output:**
- `supportLevel`, `resistanceLevel` — ค่าระดับล่าสุด
- `boxes[]` — รายการ S/R boxes (type, broken)
- `signal` — BUY/SELL

**Signal Logic:**
- delta volume per bar = sign(close − open) × volume (sticky on doji)
- support: pivot_low + vol > volHi (positive buying)
- resistance: pivot_high + vol < volLo (negative selling)
- BUY: low cross ขึ้นเหนือ (resLevel + width)
- SELL: high cross ลงใต้ (supLevel − width)

**จุดเด่น:** S/R ที่กรองด้วย volume = significant levels
**ข้อจำกัด:** ตลาดที่ volume เพี้ยน (crypto บางคู่) อาจไม่แม่นยำ

---

# G3: New Versions ของ Duplicates

กลุ่มที่มาเสริม indicator ที่มีอยู่แล้วในรูปแบบใหม่ — แยกฟังก์ชันออกชัดเจน

## 9. CDC ActionZone V.2 (Piriya 2016)

**Author:** Piriya33 (CDC ดั้งเดิม) — ต้นฉบับ: [`CDC Action Zone V.2.pine`](../CDC%20Action%20Zone%20V.2.pine)

**แนวคิด:** เวอร์ชันต้นแบบของ CDC ActionZone — ใช้ <code>ohlc4</code> เป็น source แล้วทำ pre-smoothing ด้วย EMA(2) ก่อนนำไปคำนวณ Fast/Slow EMA ระบบโซน 4 สี (green/red/yellow/blue) แทน V3 ที่มี 6 สี

**Function:**
```ts
cdcActionZoneV2(klines, fastPeriod = 12, slowPeriod = 26)
```

**Output:**
- `ap` — pre-smoothed source (EMA2 ของ ohlc4)
- `fast`, `slow` — Fast/Slow EMA
- `zone` — "green" | "red" | "yellow" | "blue" | null
- `signal` — BUY/SELL ที่ Fast cross Slow

**Zone definitions:**
- **Green** = Bullish (Fast>Slow) AND ap > Fast
- **Red** = Bearish AND ap < Fast
- **Yellow** = Bullish AND ap < Fast (pullback ในเทรนด์ขึ้น)
- **Blue** = Bearish AND ap > Fast (rally ในเทรนด์ลง)

**Signal Logic:**
- BUY: Fast cross ขึ้นเหนือ Slow (bullish cross)
- SELL: Fast cross ลงใต้ Slow (bearish cross)

**ต่างจาก V3 อย่างไร:**
- V3 ใช้ close แทน ohlc4 และ smoothing=1 (ไม่ smooth)
- V3 มี 6 zone (green/red/yellow/orange/blue/lightblue) แยกตาม slow MA
- V3 signal เกิดจาก zone change (first green/red), V2 signal เกิดจาก Fast/Slow cross เท่านั้น

---

## 10. ZigZag++ (DevLucem-style)

**Author:** DevLucem (ต้นฉบับเรียก library `ZigLib`) — ต้นฉบับ: [`ZigZag.pine`](../ZigZag.pine)

**แนวคิด:** ZigZag classic ที่ติดป้าย swing ด้วย HH/LH/HL/LL — กลับทิศเมื่อราคา retrace เกิน Deviation % จากจุด extreme ปัจจุบัน Backstep บังคับระยะห่างขั้นต่ำระหว่าง swing

**Function:**
```ts
zigzagPlusPlus(klines, depth = 12, deviationPct = 5, backstep = 2)
```

**Parameters:**
- `depth` — bars สำหรับ seed ทิศเริ่มต้น
- `deviationPct` — % retrace ขั้นต่ำเพื่อนับเป็น swing ใหม่
- `backstep` — bars ขั้นต่ำระหว่าง 2 swings

**Output:**
- `direction` — 1 / -1
- `swingPoints[]` — { index, price, type, direction }
- `signal` — BUY เมื่อทิศกลับขึ้น, SELL เมื่อทิศกลับลง

**Signal Logic (state machine):**
- uptrend: track extreme high; ถ้า low < extPrice × (1 − dev%) AND แท่งห่างพอ → confirm swing high, flip ลง
- downtrend: track extreme low; ถ้า high > extPrice × (1 + dev%) AND แท่งห่างพอ → confirm swing low, flip ขึ้น

**Note:** ZigZag เป็น lagging indicator โดยธรรมชาติ — signal จะเกิดที่บาร์ที่ยืนยัน swing แล้ว ไม่ใช่ที่ swing เอง

---

## 11. Price Action SMC (BigBeluga)

**Author:** BigBeluga — ต้นฉบับ: [`Price Action - Smart Money Concepts.pine`](../Price%20Action%20-%20Smart%20Money%20Concepts.pine) (1670+ บรรทัด)

**แนวคิด:** Smart Money Concepts variant ของ BigBeluga — ตรวจ pivot ด้วย mslen แล้วบันทึก BOS/CHoCH, สร้าง Order Block จากแท่งฝั่งตรงข้ามก่อนเกิด break ส่วน Sweep ตรวจจับ false break (ทะลุแต่ปิดกลับ)

**Function:**
```ts
priceActionSMC(klines, mslen = 5, obLengthMode = "Length", obLength = 5, buildSweep = true)
```

**Parameters:**
- `mslen` — pivot leftBars/rightBars
- `obLengthMode` — "Length" (จำกัด OB ด้วย ATR×obLength) หรือ "Full" (ใช้ทั้ง candle body)
- `buildSweep` — เปิด/ปิดการตรวจ Sweep

**Output:**
- `trend` — "bullish" | "bearish" | null
- `structures[]` — BOS/CHoCH/Sweep events
- `orderBlocks[]` — bullish/bearish OBs พร้อม mitigation tracking
- `swingPoints[]` — HH/LH/HL/LL labels
- `signal` — BUY บน Bullish CHoCH, SELL บน Bearish CHoCH

**Event Types:**
- **BOS (Break of Structure)** — ราคาทะลุ pivot ในทิศเดียวกับเทรนด์ (ยืนยันเทรนด์)
- **CHoCH (Change of Character)** — ทะลุ pivot ในทิศตรงข้ามเทรนด์เดิม (เปลี่ยนเทรนด์) → emit signal
- **Sweep** — ราคาแตะ pivot แต่ปิดกลับ (ดูดทุน stop loss แล้วเด้ง)

**ต่างจาก smartMoneyConcepts (เดิม) อย่างไร:**
- มี Sweep detection
- Order block สามารถปรับขนาดได้ (Length/Full)
- pivot detection แบบ left=right=mslen

---

## 12. Price Action S&R (DGT)

**Author:** dgtrd — ต้นฉบับ: [`Price Action - Support & Resistance.pine`](../Price%20Action%20-%20Support%20%26%20Resistance.pine) (700+ บรรทัด)

**แนวคิด:** ตรวจหา 3 แท่งติดต่อ (bull/bear) พร้อม volume เพิ่ม = S/R ที่มีนัยสำคัญ พร้อมตรวจ Volume Spike (🚦) และ High Volatility (⚡) เป็น marker เสริม

**Function:**
```ts
priceActionSR(klines, volMaLength = 89, volSpikeThresh = 4.669, atrLength = 11, atrMult = 2.718, useVolume = true)
```

**Parameters:**
- `volMaLength` — volume MA baseline (default 89)
- `volSpikeThresh` — volume ต้อง > thresh × MA จึงเป็น spike (default 4.669)
- `atrLength`, `atrMult` — ATR สำหรับ filter high volatility
- `useVolume` — true = ใช้ volume confirm, false = ใช้แค่ price direction

**Output:**
- `supportLevel`, `resistanceLevel` — ค่าระดับล่าสุด
- `lines[]` — รายการเส้น (support/resistance/spike/volatility)
- `volumeSpikes[]`, `highVolatility[]` — bar indices ของ marker
- `signal` — BUY/SELL

**Detection Logic:**
- **rising sequence**: 3 bull candles ติด + (volume > MA AND increasing) → resistance ที่ highestHigh
- **falling sequence**: 3 bear candles ติด + (volume > MA AND increasing) → support ที่ lowestLow
- **volume spike**: vol > 4.669 × volMA
- **high volatility**: range > 2.718 × ATR

**Signal Logic:**
- BUY: close cross ขึ้นเหนือ resistance ล่าสุด
- SELL: close cross ลงใต้ support ล่าสุด

**ต่างจาก supportResistance (เดิม) อย่างไร:**
- เดิมใช้ pivot + volume oscillator
- DGT ใช้ 3-bar consecutive sequence + volume MA
- DGT มี volume spike + high volatility markers แยก (เพิ่มข้อมูลเชิงบริบท)

---

# G4: Patterns + Detection

กลุ่ม indicator ที่เป็นการตรวจจับ pattern หรือเหตุการณ์ — Heuristic signal ใส่ในตัว

## 13. Candlestick Patterns Identified

**Author:** repo32 — ต้นฉบับ: [`Candlestick Patterns Identified.pine`](../Candlestick%20Patterns%20Identified.pine)

**แนวคิด:** ตรวจจับแพทเทิร์น Candlestick คลาสสิก 15 แบบ ใช้ trend filter (open[trendBars] เทียบกับ open[0]) เพื่อยืนยันบริบทเทรนด์

**Function:**
```ts
candlestickPatterns(klines, trendBars = 5, dojiSize = 0.05)
```

**Parameters:**
- `trendBars` — ดูแท่งย้อนหลังเพื่อกำหนด trend context
- `dojiSize` — body/range ratio ที่จะนับเป็น Doji

**Output:**
- `hits[]` — { index, pattern, bias }
- `signal` — BUY (bullish) / SELL (bearish) / null (Doji)

**Patterns ที่ตรวจจับ:**

| Bullish | Bearish | Neutral |
|---|---|---|
| Bullish Harami | Bearish Harami | Doji |
| Bullish Engulfing | Bearish Engulfing | |
| Piercing Line | Hanging Man | |
| Bullish Belt | Evening Star | |
| Bullish Kicker | Bearish Kicker | |
| Morning Star | Shooting Star | |
| Hammer | | |
| Inverted Hammer | | |

**ตัวอย่างเงื่อนไข (Bullish Engulfing):**
- prev candle bearish (o1 > c1)
- current candle bullish (c > o)
- current body ครอบ prev body (c ≥ o1 AND c1 ≥ o AND c−o > o1−c1)
- trend context: open[5] > current open (อยู่ในแนว downtrend ก่อน)

---

## 14. Pivot Points HL (LuxAlgo)

**Author:** LuxAlgo — ต้นฉบับ: [`Pivot Points High Low & Missed Reversal Levels [LuxAlgo].pine`](../Pivot%20Points%20High%20Low%20%26%20Missed%20Reversal%20Levels%20[LuxAlgo].pine)

**แนวคิด:** ตรวจจับ pivot high/low ปกติ + missed pivots (👻) — Missed pivot คือจุดที่ราคาขึ้น/ลงไปถึงแต่ไม่มี pivot สลับฝั่งคั่นกลาง

**Function:**
```ts
pivotPointsHL(klines, length = 50)
```

**Parameters:**
- `length` — ใช้ทั้ง leftBars และ rightBars (default 50)

**Output:**
- `pivots[]` — { index, price, type: "regular_high" | "regular_low" | "missed_high" | "missed_low" }
- `zigzag[]` — points สำหรับวาดเส้น zigzag
- `ghostLevelStart`, `ghostLevelPrice` — จุด ghost ล่าสุด
- `signal` — BUY เมื่อยืนยัน pivot low, SELL เมื่อยืนยัน pivot high

**Signal Logic:**
- pivot ถูก confirm ที่บาร์ปัจจุบัน (i) โดย pivot จริงอยู่ที่ (i − length)
- BUY: pivot low ถูกยืนยัน (คาดเด้งขึ้น)
- SELL: pivot high ถูกยืนยัน (คาดถอยลง)
- ระหว่างสอง pivot เดียวกัน → ใส่ missed pivot คั่น (👻)

**Note:** สัญญาณ lagging ตามจำนวน length (rightBars) เพราะต้องรอ confirm

---

## 15. TMA Overlay

**Author:** JustUncleL / FXBuoy — ต้นฉบับ: [`TMA Overlay.pine`](../TMA%20Overlay.pine)

**แนวคิด:** ระบบ Forex/Scalping ดั้งเดิม — 4 SMMA (21/50/100/200) ดูเทรนด์, 3-Line Strike จับจุดกลับเทรนด์, Big-Body Engulfing ยืนยันแรงเข้า ใช้ EMA(2) vs SMMA(200) เป็นตัวกำหนดเทรนด์หลัก

**Function:**
```ts
tmaOverlay(klines)
```

**Parameters:** ไม่มี — fixed lengths (21/50/100/200)

**Output:**
- `smma21`, `smma50`, `smma100`, `smma200` — Smoothed MAs
- `ema2` — EMA(2) สำหรับ trend
- `trend` — "bullish" | "bearish" | null (EMA2 vs SMMA200)
- `threeLineStrikeBull[]`, `threeLineStrikeBear[]` — bar indices
- `bullishEngulfing[]`, `bearishEngulfing[]` — bar indices
- `signal` — BUY/SELL filtered ด้วย trend

**Signal Logic:**
- 3-Line Strike Bull: 3 bear candles ติด + bull candle ปิดเหนือ prev[1] open
- 3-Line Strike Bear: 3 bull candles ติด + bear candle ปิดใต้ prev[1] open
- Big-Body Engulfing: current candle ครอบ prev body
- BUY: bull pattern เกิด AND trend = "bullish"
- SELL: bear pattern เกิด AND trend = "bearish"

**Note:** SMMA = Smoothed MA = `(prev × (n−1) + current) / n` (seed ด้วย SMA)

---

## 16. Auto Chart Patterns (Trendoscope)

**Author:** Trendoscope (ใช้ library `abstractchartpatterns`) — ต้นฉบับ: [`Auto Chart Patterns [Trendoscope].pine`](../Auto%20Chart%20Patterns%20[Trendoscope].pine)

**แนวคิด:** ใช้ pivot 5-6 จุดล่าสุดสร้าง trend lines บน/ล่าง แล้วจำแนกแพทเทิร์น 13 ชนิด — Channels, Wedges, Triangles ทุกแบบ Generate signal ที่บาร์ที่ราคา breakout

**Function:**
```ts
autoChartPatterns(klines, zigzagLength = 8, flatThreshold = 0.20, numberOfPivots = 5, avoidOverlap = true)
```

**Parameters:**
- `zigzagLength` — leftBars/rightBars สำหรับ pivot
- `flatThreshold` — slope ratio ที่ใต้ค่านี้ถือว่าเส้นแนวนอน (0-1, default 0.20)
- `numberOfPivots` — 5 หรือ 6
- `avoidOverlap` — ไม่สร้าง pattern ที่ทับซ้อนกับอันก่อน

**Output:**
- `patterns[]` — รายการแพทเทิร์น (type, pivots, upperLine, lowerLine, bias, broken, brokenDirection)
- `signal` — BUY/SELL บน breakout

**Pattern Types (13 ชนิด):**

| ทิศตรง | Contracting | Expanding | Parallel |
|---|---|---|---|
| ขึ้น | Ascending Triangle (Contracting), Rising Wedge (Contracting) | Ascending Triangle (Expanding), Rising Wedge (Expanding) | Ascending Channel |
| ลง | Descending Triangle (Contracting), Falling Wedge (Contracting) | Descending Triangle (Expanding), Falling Wedge (Expanding) | Descending Channel |
| ไม่ตรง | Converging Triangle | Diverging Triangle | Ranging Channel |

**Bias:**
- Bullish: Ascending Channel/Triangle, Falling Wedge
- Bearish: Descending Channel/Triangle, Rising Wedge
- Neutral: Ranging Channel, Converging/Diverging Triangle

**Classification Algorithm:**
- ดึง upper/lower slopes จาก 2 pivot ของแต่ละฝั่ง
- เปรียบเทียบ slope กับ flat threshold (× avgPrice)
- เปรียบเทียบ distance ระหว่างเส้นที่จุดเริ่ม vs จุดท้าย:
  - end < 0.85 × start → contracting
  - end > 1.15 × start → expanding
  - else → parallel

**Signal Logic:**
- หลัง pattern ก่อตัวเสร็จ → ดู forward 50 bars
- close > upperTrendline value ที่บาร์นั้น → BUY (breakout up)
- close < lowerTrendline value → SELL (breakout down)

---

## 17. DIY Custom Strategy Builder (ZP)

**Author:** ZPayab — ต้นฉบับ: [`DIY Custom Strategy Builder  [ZP] - v1.pine`](../DIY%20Custom%20Strategy%20Builder%20%20[ZP]%20-%20v1.pine) (4400+ บรรทัด)

**แนวคิด:** Meta-composer ที่ผสมระหว่าง <code>leading indicator</code> (ตัวที่ส่งสัญญาณหลัก) กับ <code>confirmation filters</code> (ตัวกรองที่ต้องเห็นด้วย) ผู้ใช้ปรับ on/off แต่ละ filter ได้อิสระ

**Function:**
```ts
diyStrategyBuilder(klines, ind, options)
```

**Parameters (in options):**
- `leading` — `"supertrend" | "cdc" | "trendlines" | "rsi" | "ut_bot"`
- `signalExpiry` — กี่บาร์ให้ filter อื่นยืนยัน (default 3)
- `useEma200Filter` — filter ราคาเทียบ EMA200 (close > EMA200 สำหรับ long)
- `useEmaCrossFilter` — EMA50/EMA200 cross ต้องตรงทิศ
- `useCdcZoneFilter` — CDC zone (green=long, red=short)
- `useTrendlinesFilter` — Trendlines breakout ตรงทิศใน lookback window
- `useRsi50Filter` — RSI > 50 (long) / < 50 (short)

**Mapping ใน computeAll (สำหรับ UI params):**
- `diyLeading`: 0=supertrend, 1=cdc, 2=trendlines, 3=rsi, 4=ut_bot

**Output:**
- `leadingSignal[]` — สัญญาณดิบจาก leading
- `filtersAgree[]` — boolean ว่า filters ผ่านหรือไม่
- `signal[]` — final BUY/SELL (ผ่านทุก filter ที่เปิด)

**Signal Logic:**
1. ดึง signal[] จาก leading indicator
2. ที่ทุกบาร์ที่ leading ส่ง BUY/SELL → เช็คทุก filter ที่ enable
3. หากทุก filter "agree" → ผ่าน, signal[i] = leading[i]
4. หาก filter ใด disagree → signal[i] = null

**ต้นฉบับ Pine มีอะไรมาก:**
- 30+ leading indicators ให้เลือก (Range Filter, RQK, SuperTrend, Half Trend, Ichimoku, SuperIchi, TSI, TDFI, Trendline Breakout, Range Detector, HACOLT, Donchian Ribbon, Stochastic, RSI, ROC, VWAP, CCI, 2/3 EMA Cross, B-Xtrender, BB Power Trend, DPO, BB Oscillator, Chandelier Exit, DMI, PSAR, MACD, SSL Channel, Waddah Attar, CMF, Vortex, STC, AO, Volatility, Wolfpack, QQE Mod, Hull Suite)
- หลายตัวเป็น filters เพิ่มเติม
- เวอร์ชัน TS port ให้ 5 leading + 5 filters ที่ใช้ indicator ที่มีอยู่แล้วในระบบ

**ใช้งานยังไง:**
1. เลือก leading (เช่น Supertrend) — ตัวที่ส่งสัญญาณหลัก
2. เปิด filters ทีละตัวเพื่อกรอง — เริ่มจาก EMA200 + RSI50 (default)
3. ทดสอบ backtest แล้วปรับ — ปิด filter ที่กรอง trade ดี ๆ ทิ้งออก

---

# การใช้งานร่วมกัน

## วิธีเรียกใช้ใน Backtest

ทุก indicator ถูก register ใน [`backtest.ts`](../backtest.ts) — เรียก `runBacktest(klines, strategyId, params)` ได้ทันที:

```ts
import { runBacktest } from "@/lib/backtest";

const result = runBacktest(klines, "chandelier_exit", {
  ceLength: 22,
  ceMult: 3.0,
  ceUseClose: 1,
});
```

หรือผ่าน UI หน้า `/klines` — เลือกจาก dropdown strategy + ปรับ params ใน slider

## วิธีดู Chart Overlay

หน้า `/klines` มี toggle overlay buttons ในแถบ Legend — เมื่อเลือก strategy ใหม่ overlay ที่เกี่ยวข้องจะถูกเปิดอัตโนมัติ (เช่น เลือก "Chandelier Exit" → toggle "Chandelier" เปิดเอง แสดง long/short stop lines)

## โครงสร้างของผลลัพธ์

ทุก indicator function คืน object ที่มี:
- `signal: ("BUY" | "SELL" | null)[]` — array ขนาดเท่า klines, ใช้กับ backtest engine
- field อื่น ๆ เฉพาะตัว — สำหรับ chart visualization และ analysis

ตัวอย่างใน `runBacktest` engine — เริ่ม long เมื่อเจอ BUY signal, ปิด long เมื่อเจอ SELL signal, fees 0.1% ต่อขา

## ข้อจำกัดทั่วไป

- **lagging** — ทุก indicator pivot-based / MA-based มี delay ตามธรรมชาติ
- **whipsaw** — sideways market ทำให้เกิด false signals
- **ไม่มี slippage** — engine จำลองที่ราคา close ตรง ๆ ไม่ใส่ realistic slippage
- **long-only** — backtest ปัจจุบันรองรับเฉพาะ long, SELL = exit long ไม่ใช่ short

---

## ภาพรวมไฟล์ที่เกี่ยวข้อง

```
lib/
├── indicators.ts              ← ทุก indicator function + helpers
├── backtest.ts                ← STRATEGIES + STRATEGY_FNS + engine
├── types/
│   └── kline.ts               ← KlineData interface
└── *.pine                     ← ต้นฉบับ PineScript

app/klines/
├── page.tsx                   ← UI หลัก (params, info panels, backtest results)
└── ui/
    └── graph.tsx              ← Chart + overlays สำหรับทุก strategy

app/trading/LiveTrading/
└── page.tsx                   ← strategyMap สำหรับ live signal
```
