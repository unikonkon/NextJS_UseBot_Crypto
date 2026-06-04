// ─── นิยาม Slash Commands (JSON) สำหรับ /api/discord/register ───
// option types: SUB_COMMAND=1, STRING=3, INTEGER=4, CHANNEL=7

const INTERVAL_CHOICES = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "6h",
  "12h",
  "1d",
  "3d",
  "1w",
  "1M",
].map((v) => ({ name: v, value: v }));

// pollSec (วินาที) — ขั้นต่ำ 5 นาที เพราะ tick cron ละเอียดสุด ~5 นาที
const POLL_CHOICES: { name: string; value: number }[] = [
  { name: "5m", value: 300 },
  { name: "10m", value: 600 },
  { name: "15m", value: 900 },
  { name: "30m", value: 1800 },
  { name: "1h", value: 3600 },
  { name: "2h", value: 7200 },
  { name: "4h", value: 14400 },
  { name: "1d", value: 86400 },
];

export const ALLOWED_INTERVALS = new Set<string>(
  INTERVAL_CHOICES.map((c) => c.value),
);
export const ALLOWED_POLLS = new Set<number>(POLL_CHOICES.map((c) => c.value));

const symbolOption = {
  name: "symbol",
  description: "เหรียญ เช่น BTCUSDT",
  type: 3,
  required: true,
};
const intervalOption = {
  name: "interval",
  description: "ช่วงเวลาแท่งเทียน (timeframe)",
  type: 3,
  required: true,
  choices: INTERVAL_CHOICES,
};
const idOption = {
  name: "id",
  description: "bot id",
  type: 3,
  required: true,
  autocomplete: true,
};

export const COMMANDS = [
  {
    name: "bot",
    description: "จัดการบอทสัญญาณ",
    type: 1,
    options: [
      {
        name: "create",
        description: "สร้างบอทใหม่",
        type: 1,
        options: [
          symbolOption,
          intervalOption,
          {
            name: "poll",
            description: "รอบ polling (ขั้นต่ำ 5 นาที)",
            type: 4,
            required: true,
            choices: POLL_CHOICES,
          },
          {
            name: "indicator",
            description: "อินดิเคเตอร์/กลยุทธ์ (พิมพ์เพื่อค้นหา)",
            type: 3,
            required: true,
            autocomplete: true,
          },
          {
            name: "channel",
            description: "(ออปชัน) ช่องแจ้งเตือนของบอทนี้",
            type: 7,
            required: false,
            channel_types: [0], // GUILD_TEXT
          },
        ],
      },
      { name: "list", description: "ดูบอททั้งหมด", type: 1 },
      {
        name: "start",
        description: "เริ่มบอท",
        type: 1,
        options: [idOption],
      },
      {
        name: "stop",
        description: "หยุดบอท",
        type: 1,
        options: [idOption],
      },
      {
        name: "delete",
        description: "ลบบอท",
        type: 1,
        options: [idOption],
      },
      {
        name: "status",
        description: "รีเฟรชการ์ดควบคุมในช่องสถานะ",
        type: 1,
      },
    ],
  },
  {
    name: "scan",
    description: "สแกนสัญญาณตอนนี้ (manual)",
    type: 1,
    options: [
      {
        name: "id",
        description: "(ออปชัน) เฉพาะบอทนี้",
        type: 3,
        required: false,
        autocomplete: true,
      },
    ],
  },
  {
    name: "backtest",
    description: "ทดสอบกลยุทธ์ย้อนหลัง",
    type: 1,
    options: [
      symbolOption,
      intervalOption,
      {
        name: "strategy",
        description: "กลยุทธ์ (พิมพ์เพื่อค้นหา)",
        type: 3,
        required: true,
        autocomplete: true,
      },
    ],
  },
  { name: "quota", description: "สถานะระบบ + โควต้าฟรี", type: 1 },
  {
    name: "config",
    description: "ค่าเริ่มต้นส่วนกลาง",
    type: 1,
    options: [
      { name: "show", description: "ดูค่าปัจจุบัน", type: 1 },
      {
        name: "set",
        description: "ตั้งค่า",
        type: 1,
        options: [
          {
            name: "key",
            description: "ค่าที่จะตั้ง",
            type: 3,
            required: true,
            choices: [
              { name: "defaultPollSec", value: "defaultPollSec" },
              { name: "limit", value: "limit" },
              { name: "freshnessMin", value: "freshnessMin" },
            ],
          },
          {
            name: "value",
            description: "ค่าตัวเลข",
            type: 4,
            required: true,
          },
        ],
      },
    ],
  },
  { name: "help", description: "วิธีใช้", type: 1 },
];
