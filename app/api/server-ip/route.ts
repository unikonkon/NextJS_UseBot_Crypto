import { NextResponse } from "next/server";

// ดึง IP ฝั่ง Server (Vercel serverless function)
// IP นี้คือ IP ที่ Binance เห็นเมื่อ API ถูกเรียก
export async function GET() {
  try {
    const res = await fetch("https://api.ipify.org?format=json", {
      cache: "no-store",
    });
    const data = await res.json();
    return NextResponse.json({
      serverIp: data.ip,
      note: "นี่คือ IP ของ Vercel Server — ใช้ IP นี้ตั้งค่าที่ Binance API Management",
    });
  } catch {
    return NextResponse.json(
      { error: "ไม่สามารถดึง Server IP ได้" },
      { status: 500 }
    );
  }
}
