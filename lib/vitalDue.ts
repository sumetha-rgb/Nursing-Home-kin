// ใช้ฝั่ง server เท่านั้น: รอบการวัดรายบุคคล + ครั้งล่าสุดที่วัดแต่ละรายการ
//  ใช้ทั้ง GET /api/care?op=vital_due (หน้าเว็บคิดสถานะเอง) และแถบ "ต้องจัดการ" (lib/attention · นับคนที่ถึงรอบ)
import { sql } from "@/lib/db";
import { needOf, planOf, type VitalDueRow } from "@/lib/vitalPlan";

/** branch = สาขา (null = ทุกสาขา) · id / name = คนเดียว */
export async function vitalDueRows(q: { branch?: string | null; id?: string | null; name?: string | null }): Promise<VitalDueRow[]> {
  const p: string[] = [];
  const where = [`coalesce(status, '') NOT LIKE 'ย้ายออก%'`, `coalesce(status, '') NOT LIKE 'มัดจำ%'`];
  if (q.branch) { p.push(q.branch); where.push(`branch_name = $${p.length}`); }
  if (q.id) { p.push(q.id); where.push(`id = $${p.length}`); } else if (q.name) { p.push(q.name); where.push(`full_name = $${p.length}`); }
  // regex ไม่ใช้ backslash (กันปัญหา escape) · "BP 120/80" "PR: 76" · "52 กก. / 148 ซม."
  const VS = `~* '(BP|PR|RR|BT)[ :]*[0-9]'`, T = (c: string) => `to_char(${c}, 'YYYY-MM-DD HH24:MI')`;
  const rows = (await sql(`
    WITH r AS (SELECT id, full_name, room, branch_name FROM residents WHERE ${where.join(" AND ")}),
    h AS (SELECT r.id, max(h.recorded_at) FILTER (WHERE h.vital_signs ${VS}) AS vs, max(h.recorded_at) FILTER (WHERE h.o2_sat ~ '[0-9]') AS o2,
            max(h.recorded_at) FILTER (WHERE h.dtx ~ '[0-9]') AS dtx, max(h.recorded_at) FILTER (WHERE h.weight_height ~ '[0-9][ .]*กก') AS wt,
            max(h.recorded_at) FILTER (WHERE h.weight_height ~ '[0-9][ .]*ซม') AS ht
          FROM r JOIN health_logs h ON h.resident_id = r.id OR (h.resident_id IS NULL AND h.resident_name = r.full_name AND (h.branch_name IS NULL OR h.branch_name = r.branch_name))
          WHERE h.recorded_at > (now() AT TIME ZONE 'Asia/Bangkok') - interval '120 days' GROUP BY r.id),
    d AS (SELECT r.id, max(t.work_date + coalesce(t.submitted_time, t.scheduled_time, '00:00'::time)) AS vs
          FROM r JOIN daily_tasks t ON t.resident_id = r.id OR (t.resident_id IS NULL AND t.resident_name = r.full_name AND t.branch_name = r.branch_name)
          WHERE t.vital_signs ${VS} AND t.work_date > (now() AT TIME ZONE 'Asia/Bangkok')::date - 30 GROUP BY r.id)
    SELECT r.id, r.full_name AS name, r.room, r.branch_name AS branch, vp.plan, vp.updated_by AS by,
      ${T("greatest(h.vs, d.vs)")} AS vs, ${T("h.o2")} AS o2, ${T("h.dtx")} AS dtx, ${T("h.wt")} AS wt, ${T("h.ht")} AS ht
    FROM r LEFT JOIN h ON h.id = r.id LEFT JOIN d ON d.id = r.id LEFT JOIN vital_plans vp ON vp.resident_id = r.id
    ORDER BY r.room NULLS LAST, r.full_name`, p).catch(async (e) => {
      // ยังไม่ได้รัน db:setup (ไม่มีตาราง vital_plans) = ทุกคนใช้ค่าเริ่มต้น
      if (!String((e as Error).message).includes("vital_plans")) throw e;
      return [];
    })) as Record<string, unknown>[];
  return rows.map((r) => ({ id: String(r.id), name: String(r.name), room: (r.room as string) ?? null, branch: (r.branch as string) ?? null, plan: planOf(r.plan), custom: !!r.plan, by: (r.by as string) ?? null,
    last: { vs: (r.vs as string) ?? null, o2: (r.o2 as string) ?? null, dtx: (r.dtx as string) ?? null, wt: (r.wt as string) ?? null, ht: (r.ht as string) ?? null } }));
}

/** จำนวนคนที่ถึงรอบวัดตอนนี้ (มีอย่างน้อย 1 รายการที่ถึงรอบหรือเลยกำหนด) · over = คนที่มีรายการเลยกำหนด · names = ชื่อตัวอย่าง (เลยกำหนดก่อน) */
export async function vitalDueSummary(branch: string | null) {
  const rows = await vitalDueRows({ branch });
  const need = rows.map((r) => ({ name: r.name, items: needOf(r) })).filter((x) => x.items.length);
  const over = need.filter((x) => x.items.some((i) => i.due.cls === "over"));
  return { n: need.length, over: over.length, names: [...over, ...need.filter((x) => !over.includes(x))].slice(0, 5).map((x) => x.name) };
}
