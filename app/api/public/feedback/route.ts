import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * ช่องทางของครอบครัว/ญาติ (ไม่ต้องเข้าสู่ระบบ · เปิดจากลิงก์หรือ QR ของแต่ละสาขา)
 *  GET  ?branch=…   ตรวจว่าสาขามีอยู่จริง
 *  POST { type: "survey", branch, name?, relation?, resident?, overall, care?, staff?, food?, clean?, comment?, phone? }
 *  POST { type: "complaint", branch, category, detail, name?, phone }
 * กันส่งรัว: IP เดียวกันส่งได้ไม่เกิน 5 ครั้งต่อชั่วโมงต่อประเภท · ช่อง website เป็นกับดักบอท
 */
const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
const LIMIT = 5;
const CATEGORIES = ["การดูแลผู้สูงอายุ", "อาหาร", "ความสะอาด", "พนักงาน", "ค่าบริการ", "อื่น ๆ"];
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const score = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null; };
const ipOf = (req: NextRequest) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.ip || "unknown";

async function branchOk(name: string) {
  if (!name) return false;
  const [b] = await sql`SELECT name FROM branches WHERE name = ${name} AND COALESCE(status, '') <> 'ปิด' LIMIT 1`;
  return !!b;
}

export async function GET(req: NextRequest) {
  try {
    const name = text(req.nextUrl.searchParams.get("branch"), 100);
    return NextResponse.json({ ok: await branchOk(name), branch: name, categories: CATEGORIES });
  } catch (e) {
    console.error("[api/public/feedback]", e);
    return bad("database error", 500);
  }
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  if (text(b.website, 10)) return NextResponse.json({ ok: true }); // บอท: ทำเหมือนสำเร็จแต่ไม่บันทึก
  const branch = text(b.branch, 100);
  const ip = ipOf(req);
  try {
    if (!(await branchOk(branch))) return bad("ไม่พบสาขานี้ กรุณาสแกน QR หรือเปิดลิงก์จากสาขาอีกครั้ง");
    if (b.type === "survey") {
      const overall = score(b.overall);
      if (!overall) return bad("กรุณาให้คะแนนความพึงพอใจโดยรวม");
      const [n] = await sql`SELECT count(*)::int AS n FROM satisfaction_surveys WHERE source_ip = ${ip} AND created_at > now() - interval '1 hour'`;
      if ((n.n as number) >= LIMIT) return bad("ส่งแบบประเมินบ่อยเกินไป กรุณาลองใหม่ภายหลัง", 429);
      await sql`INSERT INTO satisfaction_surveys (id, branch_name, rater_name, relation, resident_name, score_overall, score_care, score_staff, score_food, score_clean, comment, contact_phone, source_ip)
        VALUES (${randomUUID()}, ${branch}, ${text(b.name, 100) || null}, ${text(b.relation, 50) || null}, ${text(b.resident, 100) || null}, ${overall},
                ${score(b.care)}, ${score(b.staff)}, ${score(b.food)}, ${score(b.clean)}, ${text(b.comment, 1000) || null}, ${text(b.phone, 20) || null}, ${ip})`;
      return NextResponse.json({ ok: true });
    }
    if (b.type === "complaint") {
      const detail = text(b.detail, 1000);
      const phone = text(b.phone, 20);
      const category = CATEGORIES.includes(b.category) ? b.category : "อื่น ๆ";
      if (detail.length < 5) return bad("กรุณาเล่ารายละเอียดของเรื่องที่ต้องการแจ้ง");
      if (!/^[0-9+\-\s]{9,20}$/.test(phone)) return bad("กรุณากรอกเบอร์โทรศัพท์สำหรับติดต่อกลับ");
      const [n] = await sql`SELECT count(*)::int AS n FROM complaints WHERE source_ip = ${ip} AND created_at > now() - interval '1 hour'`;
      if ((n.n as number) >= LIMIT) return bad("ส่งเรื่องบ่อยเกินไป กรุณาโทรติดต่อสาขาโดยตรง", 429);
      const name = text(b.name, 100);
      await sql`INSERT INTO complaints (id, reported_at, branch_name, issue, contact_phone, status, reporter, category, source_ip, sort_order)
        VALUES (${randomUUID()}, now() AT TIME ZONE 'Asia/Bangkok', ${branch}, ${`[${category}] ${detail}${name ? ` · ผู้แจ้ง: ${name}` : ""}`}, ${phone}, 'รอดำเนินการ',
                ${name || null}, ${category}, ${ip}, extract(epoch FROM now()) * 1000)`;
      return NextResponse.json({ ok: true });
    }
    return bad("unknown type");
  } catch (e) {
    console.error("[api/public/feedback]", e);
    return bad("database error", 500);
  }
}
