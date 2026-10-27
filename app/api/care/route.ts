import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUser, forbidden, unauthorized } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { SessionUser } from "@/lib/roles";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * ข้อมูลงานดูแลรายบุคคล (ใช้ได้ทุกระดับ เห็นเฉพาะสาขาตัวเอง ยกเว้น Global Admin)
 *  GET  ?op=residents           รายชื่อผู้รับบริการ (KinApp / ตัวเลือกชื่อ)
 *  GET  ?op=profile&id=…        ประวัติรายบุคคล: สัญญาณชีพ ยา การให้ยา นัดหมาย งานดูแล ส่งเวร แจ้งเตือน
 *  GET  ?op=alerts              แจ้งเตือนสัญญาณชีพที่ยังไม่มีคนรับทราบ
 *  POST { op: "ack", id, note } รับทราบแจ้งเตือน (บันทึกประวัติการแก้ไข)
 */
const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
const scoped = (me: SessionUser) => me.role !== "Global Admin";

/** รายการของผู้รับบริการคนนี้: ผูกด้วยรหัส หรือข้อมูลเก่าที่ยังไม่มีรหัสแต่ชื่อตรงกัน */
const MINE = `(resident_id = $1 OR (resident_id IS NULL AND resident_name = $2))`;

async function profile(me: SessionUser, id: string) {
  const [r] = (await sql`SELECT id, full_name, age, room, branch_name, chronic_diseases, status FROM residents WHERE id = ${id}`) as Record<string, unknown>[];
  if (!r) return null;
  if (scoped(me) && r.branch_name !== me.branch) return "forbidden";
  const p = [r.id, r.full_name];
  const q = (text: string) => sql(text, p) as Promise<Record<string, unknown>[]>;
  const [health, daily, meds, packs, appts, tasks, handovers, alerts, contracts, plans] = await Promise.all([
    q(`SELECT id, recorded_at::text AS at, vital_signs, o2_sat, dtx, weight_height, note, recorded_by FROM health_logs WHERE ${MINE} ORDER BY recorded_at DESC NULLS LAST LIMIT 90`),
    q(`SELECT id, work_date::text AS work_date, scheduled_time::text AS time, task_name, assignee, shift, status, vital_signs FROM daily_tasks WHERE ${MINE} ORDER BY work_date DESC, scheduled_time DESC LIMIT 40`),
    q(`SELECT id, drug_name, indication, dose, unit, timing, meals, stock, on_hold, status, warnings, needs_fridge FROM resident_medications WHERE ${MINE} ORDER BY on_hold, drug_name`),
    q(`SELECT id, pack_date::text AS date, meal, items, qa_status, given, given_by, given_at::text AS given_at, packed_by, checked_by FROM medication_packs WHERE ${MINE} ORDER BY pack_date DESC, created_at DESC LIMIT 40`),
    q(`SELECT id, appt_date::text AS date, appt_time::text AS time, purpose, caregiver FROM appointments WHERE ${MINE} ORDER BY appt_date DESC NULLS LAST LIMIT 20`),
    q(`SELECT id, work_date::text AS date, category, task_name, performed_by, status, submitted_at::text AS time FROM task_logs WHERE ${MINE} ORDER BY work_date DESC NULLS LAST LIMIT 20`),
    q(`SELECT id, topic_type, detail, written_by, written_at FROM shift_handovers WHERE ${MINE} ORDER BY created_at DESC LIMIT 20`),
    q(`SELECT id, level, summary, vital_text, created_by, to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at, status, ack_by, to_char(ack_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS ack_at, ack_note FROM care_alerts WHERE ${MINE} ORDER BY created_at DESC LIMIT 20`),
    // สัญญาและแผนดูแล (มีราคา) เฉพาะผู้จัดการขึ้นไป
    me.role === "Operation" ? Promise.resolve([]) : q(`SELECT id, contract_no, employer_name, monthly_fee, status FROM contracts WHERE ${MINE}`),
    me.role === "Operation" ? Promise.resolve([]) : q(`SELECT id, plan_name, relative_phone, estimated_price, note FROM care_assessments WHERE ${MINE}`),
  ]);
  return { resident: r, health, daily, meds, packs, appts, tasks, handovers, alerts, contracts, plans };
}

export async function GET(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const qs = req.nextUrl.searchParams;
  try {
    switch (qs.get("op")) {
      case "residents": {
        const rows = scoped(me)
          ? await sql`SELECT id, full_name, age, room, branch_name, status, chronic_diseases FROM residents WHERE branch_name = ${me.branch} ORDER BY sort_order DESC, created_at DESC`
          : await sql`SELECT id, full_name, age, room, branch_name, status, chronic_diseases FROM residents ORDER BY sort_order DESC, created_at DESC`;
        return NextResponse.json({ residents: rows });
      }
      case "profile": {
        const p = await profile(me, String(qs.get("id") ?? ""));
        if (!p) return bad("ไม่พบผู้รับบริการ", 404);
        if (p === "forbidden") return forbidden("ดูได้เฉพาะผู้รับบริการในสาขาของคุณ");
        return NextResponse.json(p);
      }
      case "alerts": {
        const rows = await sql(
          `SELECT id, area, record_id, resident_id, resident_name, branch_name, level, summary, vital_text, created_by,
                  to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at
           FROM care_alerts WHERE status = 'open' ${scoped(me) ? "AND branch_name = $1" : ""}
           ORDER BY (level = 'critical') DESC, created_at DESC LIMIT 100`, scoped(me) ? [me.branch] : []);
        return NextResponse.json({ alerts: rows });
      }
      default:
        return bad("unknown op");
    }
  } catch (e) {
    console.error("[api/care]", e);
    return bad("database error", 500);
  }
}

export async function POST(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const b = await req.json().catch(() => ({}));
  if (b.op !== "ack") return bad("unknown op");
  const [a] = (await sql`SELECT id, branch_name, resident_name, summary, status FROM care_alerts WHERE id = ${String(b.id)}`) as Record<string, string>[];
  if (!a) return bad("ไม่พบแจ้งเตือนนี้", 404);
  if (scoped(me) && a.branch_name !== me.branch) return forbidden();
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) : "";
  await sql`UPDATE care_alerts SET status = 'acknowledged', ack_by = ${me.name}, ack_at = now(), ack_note = ${note || null} WHERE id = ${a.id}`;
  await audit(req, me, [{ area: "alerts", action: "acknowledge", recordId: a.id, summary: `${a.resident_name ?? ""} · ${a.summary ?? ""}`.slice(0, 200), branch: a.branch_name, after: { ack_note: note || null } }]);
  return NextResponse.json({ ok: true });
}
