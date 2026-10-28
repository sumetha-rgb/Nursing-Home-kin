import { randomBytes, randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUser, forbidden, unauthorized } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { LINK_DAYS, SCORE_DAYS } from "@/lib/reviews";
import type { SessionUser } from "@/lib/roles";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * รีวิวพนักงานจากครอบครัว (ต้องเข้าสู่ระบบ · เห็นเฉพาะสาขาตัวเอง ยกเว้น Global Admin)
 *  GET  ?op=scores[&branch=]        คะแนนเฉลี่ยรายพนักงาน (KPI) ย้อนหลัง SCORE_DAYS วัน + รีวิวล่าสุด · ผู้จัดการขึ้นไป
 *  GET  ?op=mine                    คะแนนและรีวิวของฉัน (พนักงานทุกระดับ)
 *  GET  ?op=links&resident=…        ลิงก์รีวิวของผู้รับบริการคนนี้ · ผู้จัดการขึ้นไป
 *  POST { op: "create", residentId } สร้างลิงก์ใหม่ (รหัสสุ่ม หมดอายุใน LINK_DAYS วัน)
 *  POST { op: "revoke", id }         ยกเลิกลิงก์
 */
const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
const scoped = (me: SessionUser) => me.role !== "Global Admin";
const isAdmin = (me: SessionUser) => me.role !== "Operation";
const TH_AT = (col: string) => `to_char(${col} AT TIME ZONE 'Asia/Bangkok', 'DD/MM/') || (extract(year FROM ${col} AT TIME ZONE 'Asia/Bangkok')::int + 543) || to_char(${col} AT TIME ZONE 'Asia/Bangkok', ' HH24:MI')`;
const REVIEW_COLS = `id, staff_id, staff_name, branch_name, resident_name, rating, tags, comment, rater_name, relation, ${TH_AT("created_at")} AS at`;

export async function GET(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const qs = req.nextUrl.searchParams;
  try {
    switch (qs.get("op")) {
      case "scores": {
        if (!isAdmin(me)) return forbidden();
        const br = scoped(me) ? me.branch : qs.get("branch") || null;
        const p = br ? [SCORE_DAYS, br] : [SCORE_DAYS];
        const scores = await sql(`
          SELECT staff_id, max(staff_name) AS staff_name, max(branch_name) AS branch_name, count(*)::int AS reviews,
                 round(avg(rating)::numeric, 2)::float AS avg, count(*) FILTER (WHERE rating = 5)::int AS five,
                 COALESCE((SELECT array_agg(t ORDER BY c DESC) FROM (SELECT t, count(*) c FROM staff_reviews r2, unnest(r2.tags) t
                   WHERE r2.staff_id = r.staff_id AND r2.created_at > now() - make_interval(days => $1) GROUP BY t ORDER BY c DESC LIMIT 3) x), '{}') AS top_tags
          FROM staff_reviews r WHERE created_at > now() - make_interval(days => $1) ${br ? "AND branch_name = $2" : ""}
          GROUP BY staff_id ORDER BY avg DESC, reviews DESC`, p);
        const recent = await sql(`SELECT ${REVIEW_COLS} FROM staff_reviews ${br ? "WHERE branch_name = $1" : ""} ORDER BY created_at DESC LIMIT 100`, br ? [br] : []);
        return NextResponse.json({ scores, recent, days: SCORE_DAYS });
      }
      case "mine": {
        const [s] = await sql(`SELECT count(*)::int AS reviews, round(avg(rating)::numeric, 2)::float AS avg FROM staff_reviews WHERE staff_id = $1 AND created_at > now() - make_interval(days => $2)`, [me.id, SCORE_DAYS]);
        const recent = await sql(`SELECT ${REVIEW_COLS} FROM staff_reviews WHERE staff_id = $1 ORDER BY created_at DESC LIMIT 20`, [me.id]);
        return NextResponse.json({ reviews: s.reviews, avg: s.avg, recent, days: SCORE_DAYS });
      }
      case "links": {
        if (!isAdmin(me)) return forbidden();
        const rid = qs.get("resident") ?? "";
        const rows = await sql(`
          SELECT l.id, l.token, l.resident_id, l.resident_name, l.branch_name, l.created_by, l.active,
                 ${TH_AT("l.expires_at")} AS expires, (l.expires_at IS NOT NULL AND l.expires_at < now()) AS expired, ${TH_AT("l.created_at")} AS at,
                 (SELECT count(DISTINCT submission_id) FROM staff_reviews r WHERE r.link_id = l.id)::int AS reviews
          FROM review_links l WHERE l.resident_id = $1 ${scoped(me) ? "AND l.branch_name = $2" : ""} ORDER BY l.created_at DESC`, scoped(me) ? [rid, me.branch] : [rid]);
        return NextResponse.json({ links: rows });
      }
      default:
        return bad("unknown op");
    }
  } catch (e) {
    console.error("[api/reviews]", e);
    return bad("database error", 500);
  }
}

export async function POST(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (!isAdmin(me)) return forbidden("สร้างลิงก์รีวิวได้เฉพาะผู้จัดการสาขาและผู้บริหาร");
  const b = await req.json().catch(() => ({}));
  try {
    if (b.op === "create") {
      const [r] = (await sql`SELECT id, full_name, branch_name FROM residents WHERE id = ${String(b.residentId ?? "")}`) as Record<string, string>[];
      if (!r) return bad("ไม่พบผู้รับบริการ", 404);
      if (scoped(me) && r.branch_name !== me.branch) return forbidden();
      if (!r.branch_name) return bad("ผู้รับบริการยังไม่มีสาขา");
      const id = randomUUID();
      const token = randomBytes(18).toString("base64url");
      await sql`INSERT INTO review_links (id, token, resident_id, resident_name, branch_name, created_by, expires_at)
                VALUES (${id}, ${token}, ${r.id}, ${r.full_name}, ${r.branch_name}, ${me.name}, now() + make_interval(days => ${LINK_DAYS}))`;
      await audit(req, me, [{ area: "review_links", action: "create", recordId: id, summary: `ลิงก์รีวิวพนักงาน · ${r.full_name}`, branch: r.branch_name }]);
      return NextResponse.json({ ok: true, id, token });
    }
    if (b.op === "revoke") {
      const [l] = (await sql`SELECT id, resident_name, branch_name FROM review_links WHERE id = ${String(b.id ?? "")}`) as Record<string, string>[];
      if (!l) return bad("ไม่พบลิงก์", 404);
      if (scoped(me) && l.branch_name !== me.branch) return forbidden();
      await sql`UPDATE review_links SET active = false WHERE id = ${l.id}`;
      await audit(req, me, [{ area: "review_links", action: "delete", recordId: l.id, summary: `ยกเลิกลิงก์รีวิว · ${l.resident_name}`, branch: l.branch_name }]);
      return NextResponse.json({ ok: true });
    }
    return bad("unknown op");
  } catch (e) {
    console.error("[api/reviews]", e);
    return bad("database error", 500);
  }
}
