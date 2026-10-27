import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUser, forbidden, unauthorized } from "@/lib/auth";
import { ACTION_GROUPS } from "@/lib/auditLabels";

export const dynamic = "force-dynamic";

const PAGE = 50;

/**
 * ประวัติการแก้ไข
 *  Global Admin : ทุกสาขา (กรองตามสาขาได้) รวมข้อมูลส่วนกลาง
 *  Branch Admin : เฉพาะรายการของสาขาตัวเอง (ข้อมูลที่เป็นของสาขา หรือผู้ทำรายการอยู่สาขานี้และไม่ระบุสาขาของข้อมูล)
 *  Operation    : ไม่มีสิทธิ์
 * ตัวกรอง: ?group= &area= &branch= &q= &date=YYYY-MM-DD &before=<id>
 */
export async function GET(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (me.role === "Operation") return forbidden();
  const q = req.nextUrl.searchParams;

  const parts: string[] = [];
  const params: unknown[] = [];
  const add = (cond: (p: string) => string, v: unknown) => { params.push(v); parts.push(cond(`$${params.length}`)); };

  if (me.role !== "Global Admin") add((p) => `(branch_name = ${p} OR (branch_name IS NULL AND actor_branch = ${p}))`, me.branch);
  else if (q.get("branch")) add((p) => `branch_name = ${p}`, q.get("branch"));
  const scope = [...parts];
  const scopeParams = [...params];

  const group = ACTION_GROUPS[q.get("group") ?? ""];
  if (group) add((p) => `action = ANY(${p})`, group);
  if (q.get("area") === "daily") parts.push(`area LIKE 'daily-%'`);
  else if (q.get("area")) add((p) => `area = ${p}`, q.get("area"));
  if (q.get("q")) add((p) => `(summary ILIKE ${p} OR actor_name ILIKE ${p} OR record_id = trim(both '%' from ${p}))`, `%${q.get("q")}%`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(q.get("date") ?? "")) add((p) => `(at AT TIME ZONE 'Asia/Bangkok')::date = ${p}::date`, q.get("date"));
  if (/^\d+$/.test(q.get("before") ?? "")) add((p) => `id < ${p}`, Number(q.get("before")));

  const w = (list: string[]) => (list.length ? `WHERE ${list.join(" AND ")}` : "");
  const items = await sql(
    `SELECT id::text, to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at, actor_name, actor_role, actor_branch, branch_name, area, action, record_id, summary, before, after, ip
     FROM audit_logs ${w(parts)} ORDER BY audit_logs.id DESC LIMIT ${PAGE + 1}`, params);

  // สรุปวันนี้ (ตามขอบเขตที่มองเห็น ไม่ขึ้นกับตัวกรองอื่น)
  const today = `(at AT TIME ZONE 'Asia/Bangkok')::date = (now() AT TIME ZONE 'Asia/Bangkok')::date`;
  const [stats] = await sql(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE action IN ('create','update','delete','clear','replace','approve','register'))::int AS changes,
            count(*) FILTER (WHERE action IN ('delete','clear'))::int AS deletes,
            count(*) FILTER (WHERE action = 'login')::int AS logins,
            count(*) FILTER (WHERE action = 'login_failed')::int AS failed
     FROM audit_logs ${w([...scope, today])}`, scopeParams);

  const branches = me.role === "Global Admin"
    ? ((await sql`SELECT DISTINCT branch_name FROM audit_logs WHERE branch_name IS NOT NULL ORDER BY 1`) as { branch_name: string }[]).map((r) => r.branch_name)
    : [];

  return NextResponse.json({
    items: items.slice(0, PAGE),
    more: items.length > PAGE,
    stats,
    branches,
    scope: { role: me.role, branch: me.role === "Global Admin" ? null : me.branch },
  });
}
