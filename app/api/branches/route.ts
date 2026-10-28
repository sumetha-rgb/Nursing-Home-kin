import { NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * รายชื่อสาขา (ชื่อและสถานะเท่านั้น) สำหรับช่องเลือกสาขา
 * ไม่ต้องเข้าสู่ระบบ เพราะหน้าสมัครสมาชิกต้องให้เลือกสาขาก่อนมีบัญชี · ข้อมูลอื่นของสาขาดูผ่าน /api/data/branches ตามสิทธิ์
 */
export async function GET() {
  try {
    const rows = await sql`SELECT name, status FROM branches WHERE name IS NOT NULL AND name <> '' ORDER BY sort_order DESC, created_at`;
    return NextResponse.json({ branches: rows });
  } catch (e) {
    console.error("[api/branches]", e);
    return NextResponse.json({ error: "database error" }, { status: 500 });
  }
}
