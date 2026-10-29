import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { familyLinkOf } from "@/lib/familyLink";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * สมุดภาพประจำวันสำหรับครอบครัว (ไม่ต้องเข้าสู่ระบบ · เข้าได้เฉพาะลิงก์ครอบครัวที่สาขาสร้างให้)
 *  GET ?t=รหัสลิงก์[&date=YYYY-MM-DD]  งานที่ทำแล้วของวันนั้น (รูปเฉพาะที่แชร์) การให้ยาตามมื้อ และวันที่มีบันทึกย้อนหลัง 14 วัน
 * ไม่ส่งสัญญาณชีพ คำสั่งงาน หรือรายการยา (เป็นข้อมูลภายในของทีมดูแล)
 */
const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
const MEALS = ["เช้า", "กลางวัน", "เย็น", "ก่อนนอน"];

export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams;
    const l = await familyLinkOf((q.get("t") ?? "").slice(0, 64));
    if (!l) return bad("ลิงก์นี้ใช้ไม่ได้แล้ว หรือหมดอายุ กรุณาขอลิงก์ใหม่จากสาขา", 404);
    const [{ today }] = (await sql`SELECT to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS today`) as { today: string }[];
    const want = q.get("date") ?? "";
    const date = /^\d{4}-\d{2}-\d{2}$/.test(want) && want <= today ? want : today;
    const mine = (alias = "") => `(${alias}resident_id = $1 OR (${alias}resident_id IS NULL AND ${alias}resident_name = $2))`;
    const p = [l.resident_id, l.resident_name];
    const tasks = await sql(`
      SELECT to_char(COALESCE(submitted_time, scheduled_time), 'HH24:MI') AS time, task_name AS title, NULLIF(note, '-') AS note,
             NULLIF(done_by, '-') AS by, CASE WHEN share_family THEN photo END AS photo
      FROM daily_tasks WHERE ${mine()} AND branch_name = $3 AND work_date = $4::date AND status IN ('เสร็จแล้ว', 'ตรวจแล้ว')
      ORDER BY COALESCE(submitted_time, scheduled_time)`, [...p, l.branch_name, date]);
    const ups = (await sql(`
      SELECT to_char(created_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS time, 'อัปเดตจากทีมดูแล' AS title, body AS note, posted_by AS by, photo
      FROM family_updates WHERE resident_id = $1 AND branch_name = $2 AND (created_at AT TIME ZONE 'Asia/Bangkok')::date = $3::date`, [l.resident_id, l.branch_name, date])) as typeof tasks;
    tasks.push(...ups);
    tasks.sort((a, b) => String(a.time ?? "").localeCompare(String(b.time ?? "")));
    const packs = (await sql(`
      SELECT meal, bool_or(given) AS given, to_char(max(given_at), 'HH24:MI') AS at
      FROM medication_packs WHERE ${mine()} AND pack_date = $3::date GROUP BY meal`, [...p, date])) as { meal: string; given: boolean; at: string | null }[];
    const meds = packs.sort((a, b) => MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal));
    const days = (await sql(`
      SELECT d FROM (
        SELECT DISTINCT work_date::text AS d FROM daily_tasks
        WHERE ${mine()} AND branch_name = $3 AND status IN ('เสร็จแล้ว', 'ตรวจแล้ว') AND work_date > $4::date - 14 AND work_date <= $4::date
        UNION
        SELECT DISTINCT (created_at AT TIME ZONE 'Asia/Bangkok')::date::text FROM family_updates
        WHERE resident_id = $1 AND branch_name = $3 AND (created_at AT TIME ZONE 'Asia/Bangkok')::date > $4::date - 14
      ) x ORDER BY d DESC`, [...p, l.branch_name, today])) as { d: string }[];
    return NextResponse.json({ resident: l.resident_name, branch: l.branch_name, date, today, days: days.map((x) => x.d), tasks, meds });
  } catch (e) {
    console.error("[api/public/family]", e);
    return bad("database error", 500);
  }
}
