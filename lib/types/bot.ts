import type { StrategyId } from "@/lib/backtest";

export type BotStatus = "running" | "stopped";

export interface Bot {
  id: string; // `${symbol}:${interval}:${pollSec}:${strategyId}` (composite, กันซ้ำ)
  symbol: string; // "BTCUSDT"
  interval: string; // ช่วงเวลาแท่งเทียน เช่น "30m"
  pollSec: number; // ค่าเวลา polling วินาที (default 1800 = 30m)
  strategyId: StrategyId; // indicator 1 ตัว
  status: BotStatus; // running | stopped
  alertChannelId?: string; // (ออปชัน) channel ที่เลือกตอน create
  webhookUrl?: string; // webhook URL ที่บอทสร้าง/หาเจอ — ไม่มี → ใช้ DISCORD_WEBHOOK_URL
  lastPolledAt: number; // เวลาที่ดึงล่าสุด (ใช้ตัดสินว่าถึงรอบยัง)
  statusMessageId?: string; // id ข้อความการ์ดในช่องสถานะรวม
  createdBy: string; // Discord user id (หรือ "env" สำหรับ pseudo-bot)
  createdAt: number;
}

export interface BotConfig {
  defaultPollSec: number; // รอบ polling เริ่มต้น (วินาที)
  limit: number; // จำนวนแท่งที่ดึงมาคำนวณ
  freshnessMin: number; // กรอบ "แท่งเพิ่งปิด" เป็นนาที
}

export const DEFAULT_BOT_CONFIG: BotConfig = {
  defaultPollSec: 1800,
  limit: 500,
  freshnessMin: 15,
};

// id แบบ composite — กันสร้างบอทซ้ำเมื่อ 4 ค่าหลักเหมือนกัน
export function makeBotId(
  symbol: string,
  interval: string,
  pollSec: number,
  strategyId: string,
): string {
  return `${symbol.toUpperCase()}:${interval}:${pollSec}:${strategyId}`;
}
