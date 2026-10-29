import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { RELATIONS, REVIEW_TAGS } from "@/lib/reviews";
import { FamilyLink, familyLinkOf } from "@/lib/familyLink";
import { carersOf } from "@/lib/carers";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * แบบฟอร์มรีวิวพนักงานสำหรับครอบครัว (ไม่ต้องเข้าสู่ระบบ · เข้าได้เฉพาะลิงก์ที่มีรหัสถูกต้อง)
 *  GET  ?t=รหัสลิงก์   ชื่อผู้รับบริการ สาขา และรายชื่อพนักงาน (คนที่เคยดูแลผู้รับบริการคนนี้ขึ้นก่อน)
 *  POST { t, rater?, relation?, reviews: [{ staffId, rating, tags?, comment? }] }
 * ลิงก์เดียวส่งได้ไม่เกิน 10 ครั้งต่อวัน · ช่อง website เป็นกับดักบอท
 */
const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const ipOf = (req: NextRequest) => (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.ip || "unknown";
const PER_DAY = 10;

type Link = FamilyLink;
const linkOf = familyLinkOf;
/** รีวิวได้เฉพาะ "ดูแลโดย" ของผู้รับบริการคนนี้ (lib/carers) */
async function staffOf(l: Link) {
  return (await carersOf(l.branch_name, l.resident_id, l.resident_name)).list.map((r) => ({ ...r, cared: true }));
}

export async function GET(req: NextRequest) {
  try {
    const l = await linkOf(text(req.nextUrl.searchParams.get("t"), 64));
    if (!l) return bad("ลิงก์นี้ใช้ไม่ได้แล้ว หรือหมดอายุ กรุณาขอลิงก์ใหม่จากสาขา", 404);
    return NextResponse.json({ resident: l.resident_name, branch: l.branch_name, staff: await staffOf(l), tags: REVIEW_TAGS, relations: RELATIONS });
  } catch (e) {
    console.error("[api/public/review]", e);
    return bad("database error", 500);
  }
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  if (text(b.website, 10)) return NextResponse.json({ ok: true }); // บอท: ทำเหมือนสำเร็จแต่ไม่บันทึก
  try {
    const l = await linkOf(text(b.t, 64));
    if (!l) return bad("ลิงก์นี้ใช้ไม่ได้แล้ว หรือหมดอายุ กรุณาขอลิงก์ใหม่จากสาขา", 404);
    const staff = await staffOf(l);
    const list = (Array.isArray(b.reviews) ? b.reviews : []).slice(0, 20) as { staffId?: string; rating?: number; tags?: string[]; comment?: string }[];
    const items = list
      .map((r) => ({ s: staff.find((x) => x.id === r.staffId), rating: Number(r.rating), tags: (Array.isArray(r.tags) ? r.tags : []).filter((t) => (REVIEW_TAGS as readonly string[]).includes(t)), comment: text(r.comment, 500) }))
      .filter((r) => r.s && Number.isInteger(r.rating) && r.rating >= 1 && r.rating <= 5);
    if (!items.length) return bad("กรุณาเลือกพนักงานและให้ดาวอย่างน้อย 1 คน");
    const [n] = await sql`SELECT count(DISTINCT submission_id)::int AS n FROM staff_reviews WHERE link_id = ${l.id} AND created_at > now() - interval '1 day'`;
    if ((n.n as number) >= PER_DAY) return bad("ลิงก์นี้ส่งรีวิวครบจำนวนของวันนี้แล้ว กรุณาลองใหม่พรุ่งนี้", 429);
    const sub = randomUUID();
    const rater = text(b.rater, 100) || null;
    const relation = (RELATIONS as readonly string[]).includes(b.relation) ? b.relation : null;
    const ip = ipOf(req);
    await sql.transaction(items.map((r) => sql`
      INSERT INTO staff_reviews (id, link_id, submission_id, branch_name, resident_id, resident_name, staff_id, staff_name, rating, tags, comment, rater_name, relation, source_ip)
      VALUES (${randomUUID()}, ${l.id}, ${sub}, ${l.branch_name}, ${l.resident_id}, ${l.resident_name}, ${r.s!.id}, ${r.s!.name}, ${r.rating}, ${r.tags}, ${r.comment || null}, ${rater}, ${relation}, ${ip})`));
    return NextResponse.json({ ok: true, count: items.length });
  } catch (e) {
    console.error("[api/public/review]", e);
    return bad("database error", 500);
  }
}
