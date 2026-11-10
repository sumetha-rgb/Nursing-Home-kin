import { NextResponse } from "next/server";

/** เวอร์ชันที่เซิร์ฟเวอร์ใช้อยู่ตอนนี้ (เทียบกับเวอร์ชันของหน้าเว็บที่เปิดค้างไว้ · ไม่มีข้อมูลส่วนตัว ไม่ต้องเข้าสู่ระบบ) */
export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json({ v: process.env.NEXT_PUBLIC_BUILD_ID ?? "" }, { headers: { "Cache-Control": "no-store" } });
}
