import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUser, forbidden, unauthorized } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { DEFAULT_WEIGHTS, KPI_PARTS, KpiRow, totalOf, Weights } from "@/lib/kpi";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * KPI พนักงานรายเดือน (ดาวครอบครัว / ดาวผู้จัดการ / งานที่ส่ง / มาตรงเวลา)
 *  GET  ?month=YYYY-MM[&branch=]   ผู้จัดการ: ทุกคนในสาขาพร้อมรายละเอียด · พนักงาน: อันดับในสาขา (รายละเอียดเฉพาะของตัวเอง)
 *  POST { family, manager, tasks, punctual }  ตั้งน้ำหนัก (ผู้บริหารเท่านั้น · รวมต้องเท่ากับ 100)
 */
const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
const pct = (v: number) => Math.round(v * 10) / 10;

async function weightsOf(): Promise<Weights> {
  const [w] = (await sql`SELECT w_family, w_manager, w_tasks, w_punctual FROM kpi_settings WHERE id = 'default'`) as Record<string, number>[];
  return w ? { family: w.w_family, manager: w.w_manager, tasks: w.w_tasks, punctual: w.w_punctual } : DEFAULT_WEIGHTS;
}

export async function GET(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const q = req.nextUrl.searchParams;
  const month = /^\d{4}-\d{2}$/.test(q.get("month") ?? "") ? q.get("month")! : null;
  if (!month) return bad("รูปแบบเดือนไม่ถูกต้อง");
  const br = me.role === "Global Admin" ? q.get("branch") || null : me.branch;
  try {
    const w = await weightsOf();
    const from = `${month}-01`;
    const bp = br ? [br] : [];
    const bw = (col: string, n: number) => (br ? `AND ${col} = $${n}` : "");
    const staff = (await sql(`SELECT id, full_name AS name, branch_name AS branch, access_level AS role FROM staff_users WHERE status = 'ทำงาน' ${bw("branch_name", 1)} ORDER BY full_name`, bp)) as { id: string; name: string; branch: string; role: string }[];
    const fam = (await sql(`SELECT staff_id, avg(rating)::float AS avg, count(*)::int AS n FROM staff_reviews
      WHERE created_at >= $1::date AND created_at < $1::date + interval '1 month' ${bw("branch_name", 2)} GROUP BY staff_id`, [from, ...bp])) as { staff_id: string; avg: number; n: number }[];
    const tasks = (await sql(`SELECT done_by AS name, branch_name AS branch, count(*)::int AS n, avg(review_stars)::float AS mavg, count(review_stars)::int AS mn
      FROM daily_tasks WHERE work_date >= $1::date AND work_date < $1::date + interval '1 month' AND status IN ('เสร็จแล้ว', 'ตรวจแล้ว') AND done_by IS NOT NULL AND done_by <> '-' ${bw("branch_name", 2)}
      GROUP BY done_by, branch_name`, [from, ...bp])) as { name: string; branch: string; n: number; mavg: number | null; mn: number }[];
    // เวรในตารางที่ถึงวันแล้ว เทียบกับการเช็คชื่อเข้างานของเวรนั้น
    const shifts = (await sql(`SELECT s.staff_id, count(*)::int AS scheduled,
        count(a.id) FILTER (WHERE COALESCE(a.late_min, 0) = 0)::int AS ontime, count(a.id) FILTER (WHERE a.late_min > 0)::int AS late
      FROM staff_shifts s LEFT JOIN attendance a ON a.staff_id = s.staff_id AND a.work_date = s.shift_date AND a.shift = s.shift AND a.kind = 'in'
      WHERE s.shift_date >= $1::date AND s.shift_date < $1::date + interval '1 month' AND s.shift_date <= (now() AT TIME ZONE 'Asia/Bangkok')::date ${bw("s.branch_name", 2)}
      GROUP BY s.staff_id`, [from, ...bp])) as { staff_id: string; scheduled: number; ontime: number; late: number }[];

    const taskOf = (s: { name: string; branch: string }) => tasks.find((t) => t.name === s.name && t.branch === s.branch);
    const maxTasks = new Map<string, number>();
    for (const t of tasks) maxTasks.set(t.branch, Math.max(maxTasks.get(t.branch) ?? 0, t.n));
    const isAdmin = me.role !== "Operation";
    let rows: KpiRow[] = staff.map((s) => {
      const f = fam.find((x) => x.staff_id === s.id);
      const t = taskOf(s);
      const sh = shifts.find((x) => x.staff_id === s.id);
      const family = f ? { avg: pct(f.avg), n: f.n, score: pct((f.avg / 5) * 100) } : { avg: null, n: 0, score: null };
      const manager = t?.mn ? { avg: pct(t.mavg!), n: t.mn, score: pct((t.mavg! / 5) * 100) } : { avg: null, n: 0, score: null };
      const max = maxTasks.get(s.branch) ?? 0;
      const taskPart = { n: t?.n ?? 0, score: max ? pct(((t?.n ?? 0) / max) * 100) : null };
      const punctual = sh ? { ontime: sh.ontime, late: sh.late, missed: sh.scheduled - sh.ontime - sh.late, scheduled: sh.scheduled, score: pct((sh.ontime / sh.scheduled) * 100) }
        : { ontime: 0, late: 0, missed: 0, scheduled: 0, score: null };
      const total = totalOf({ family: family.score, manager: manager.score, tasks: taskPart.score, punctual: punctual.score }, w);
      return { id: s.id, name: s.name, branch: s.branch, role: s.role, rank: 0, total, family, manager, tasks: taskPart, punctual };
    });
    rows.sort((a, b) => (b.total ?? -1) - (a.total ?? -1) || a.name.localeCompare(b.name, "th"));
    rows.forEach((r, i) => { r.rank = r.total == null ? 0 : i + 1; });
    // พนักงาน: เห็นอันดับและคะแนนรวมของทีม แต่รายละเอียดแยกส่วนเห็นเฉพาะของตัวเอง
    if (!isAdmin) rows = rows.map((r) => (r.id === me.id ? r : { ...r, family: null, manager: null, tasks: null, punctual: null }));
    return NextResponse.json({ month, branch: br, weights: w, rows, me: me.id, canEdit: me.role === "Global Admin" });
  } catch (e) {
    console.error("[api/kpi]", e);
    return bad("database error", 500);
  }
}

export async function POST(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (me.role !== "Global Admin") return forbidden("ตั้งน้ำหนัก KPI ได้เฉพาะผู้บริหาร");
  const b = await req.json().catch(() => ({}));
  const w = Object.fromEntries(KPI_PARTS.map((p) => [p.key, Number(b[p.key])])) as Weights;
  if (Object.values(w).some((v) => !Number.isInteger(v) || v < 0 || v > 100)) return bad("น้ำหนักต้องเป็นจำนวนเต็ม 0–100");
  if (Object.values(w).reduce((a, v) => a + v, 0) !== 100) return bad("น้ำหนักรวมต้องเท่ากับ 100%");
  try {
    const before = await weightsOf();
    await sql`UPDATE kpi_settings SET w_family = ${w.family}, w_manager = ${w.manager}, w_tasks = ${w.tasks}, w_punctual = ${w.punctual}, updated_by = ${me.name}, updated_at = now() WHERE id = 'default'`;
    await audit(req, me, [{ area: "kpi", action: "update", recordId: "default", summary: "น้ำหนัก KPI พนักงาน", before, after: w }]);
    return NextResponse.json({ ok: true, weights: w });
  } catch (e) {
    console.error("[api/kpi]", e);
    return bad("database error", 500);
  }
}
