import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUser, forbidden, unauthorized } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { SessionUser } from "@/lib/roles";
import { can } from "@/lib/perms";
import { SHARED_BRANCHES } from "@/lib/schema";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * ข้อมูลงานดูแลรายบุคคล (ใช้ได้ทุกระดับ เห็นเฉพาะสาขาตัวเอง ยกเว้น Global Admin)
 *  GET  ?op=residents           รายชื่อผู้รับบริการ (KinApp / ตัวเลือกชื่อ)
 *  GET  ?op=profile&id=…        ประวัติรายบุคคล: สัญญาณชีพ ยา การให้ยา นัดหมาย งานดูแล ส่งเวร แจ้งเตือน
 *  GET  ?op=nurses              รายชื่อพยาบาล/ทีมดูแลของสาขา (ตัวเลือกผู้ดูแลในนัดหมาย)
 *  GET  ?op=allergies           ประวัติแพ้ยา/อาหารจากสัญญาล่าสุดของแต่ละคน (ป้าย "แพ้ยา" ในทะเบียนผู้รับบริการ) · ไม่มีข้อมูลอื่นของสัญญา
 *  GET  ?op=family_updates&resident=…  อัปเดตที่ส่งถึงครอบครัวของผู้รับบริการคนนี้
 *  GET  ?op=family_updates_all    ข่าวที่ทีมส่งถึงญาติ ล่าสุด 150 รายการของสาขา (ผู้จัดการ/หัวหน้าพยาบาล ตรวจสอบ)
 *  GET  ?op=family_update_photo&id=…  รูปของข่าวนั้น
 *  POST { op: "family_update", residentId, text?, photo? }  พยาบาลส่งข้อความ/รูปถึงครอบครัว (ขึ้นในสมุดภาพของญาติ)
 *  POST { op: "family_update_delete", id }  ลบอัปเดตที่ส่งไป (คนส่งเอง หรือผู้ที่มีสิทธิ์ผู้รับบริการ)
 *  GET  ?op=alerts              แจ้งเตือนสัญญาณชีพที่ยังไม่มีคนรับทราบ
 *  POST { op: "ack", id, note } รับทราบแจ้งเตือน (บันทึกประวัติการใช้งาน)
 *  GET  ?op=routines            งานประจำ (ทำซ้ำทุกวัน) ที่ยังใช้อยู่
 *  GET  ?op=turning_risk        ผู้เสี่ยงแผลกดทับ (Braden < 13 หรือติดเตียง) สำหรับตารางพลิกตัวทุก 2 ชม.
 *  POST { op: "routines_add", items: [{ resident, task, ins, shift, time }], skipDate? }  เพิ่มงานประจำ (ผู้จัดการขึ้นไป)
 *       ใส่งานให้วันที่ระบบสร้างไปแล้ว (วันนี้ถึง +14 วัน) ด้วย ยกเว้น skipDate (วันที่หน้าจอมอบหมายเองแล้ว)
 *  POST { op: "routine_stop", id }  หยุดทำซ้ำ
 *  GET  ?op=surveys[&branch=]       ผลประเมินความพึงพอใจจากครอบครัว (ผู้จัดการขึ้นไป)
 *  GET  ?op=task_photos&ids=a,b   รูปหลักฐานหลายงาน (ผลงานทีมใน KinApp)
 *  GET  ?op=task_photo&id=…      รูปหลักฐานของงานประจำวัน (ผู้จัดการเปิดตอนตรวจงาน)
 *  POST { op: "task_photo", id, photo, share? }  แนบรูปหลักฐานตอนส่งงานจาก KinApp (share = แชร์ให้ครอบครัว)
 *  POST { op: "task_review", id, stars, note? }  ผู้จัดการให้ดาวตอนตรวจงาน (ใช้คิด KPI)
 *  GET  ?op=my_reviews          ผลตรวจงานที่ฉันส่ง ย้อนหลัง 7 วัน (ดาว ความเห็น ผู้ตรวจ) · KinApp
 *  POST { op: "task_share", id, share }  ผู้จัดการซ่อน/แสดงรูปในสมุดภาพของครอบครัว
 *  GET  ?op=facility[&mine=1]    งานส่วนกลางของสาขา + ทำล่าสุด + ถึงรอบหรือยัง (ทุกวัน / ทุกสัปดาห์ / ทุกเดือน)
 *                                mine=1 (KinApp): งานแบบมอบหมายขึ้นเฉพาะคนที่ได้รับมอบหมาย
 *  GET  ?op=facility_photo&id=…  รูปหลักฐานงานส่วนกลาง (บันทึกนั้น)
 *  GET  ?op=facility_history&id=…&month=YYYY-MM  ทุกครั้งที่ทำงานนี้ในเดือนนั้น (ผู้มีสิทธิ์เมนูงานส่วนกลางของสาขา)
 *  POST { op: "facility_done", taskId, photo, note? }  พยาบาลทำงานส่วนกลางแล้ว (รอบละครั้ง · นับใน KPI)
 *  POST { op: "facility_assign", taskId, assignee, branch? }  มอบหมายคนรับผิดชอบงานแบบมอบหมายของสาขา (assignee ว่าง = ยกเลิก)
 */
/** รอบของงานส่วนกลางจากข้อความความถี่ เช่น "07:00 / ทุกวัน", "ทุกเดือน วันที่ 1", "กะเช้า / ทุกสัปดาห์" */
const PERIOD_SQL = `CASE WHEN f.schedule LIKE '%ทุกเดือน%' THEN date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok'))::date
  WHEN f.schedule LIKE '%ทุกสัปดาห์%' THEN date_trunc('week', (now() AT TIME ZONE 'Asia/Bangkok'))::date
  ELSE (now() AT TIME ZONE 'Asia/Bangkok')::date END`;
const canFacility = (me: SessionUser) => can(me, "app.staff") || can(me, "facility_tasks");
/** งานแบบมอบหมายคนรับผิดชอบ (ค่าเดิม "จ่ายเอง (Manual)" หรือค่าใหม่ที่มีคำว่า Manual) */
const isManual = (mode: unknown) => /Manual|มอบหมาย/.test(String(mode ?? ""));
const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
const scoped = (me: SessionUser) => me.role !== "Global Admin";
/** ตรวจสอบข่าวและลิงก์ที่ทีมส่งถึงญาติ: ผู้ที่มีเมนูผู้รับบริการ รีวิวพนักงาน หรือเสียงจากครอบครัว */
const isFamilyAdmin = (me: SessionUser) => can(me, "residents") || can(me, "reviews") || can(me, "feedbacks");

/**
 * รายการของผู้รับบริการคนนี้: ผูกด้วยรหัส หรือข้อมูลเก่าที่ยังไม่มีรหัสแต่ชื่อตรงกัน
 *  ข้อมูลเก่าที่ผูกด้วยชื่อ ต้องอยู่สาขาเดียวกัน (หรือข้อมูลส่วนกลาง) · กันคนชื่อซ้ำต่างสาขาปนเข้าประวัติ
 */
const SHARED_SQL = SHARED_BRANCHES.map((b) => `'${b.replace(/'/g, "''")}'`).join(", "); // ค่าคงที่ใน lib/schema (ไม่ใช่ข้อมูลจากผู้ใช้)
const MINE = `(resident_id = $1 OR (resident_id IS NULL AND resident_name = $2 AND (branch_name IS NULL OR branch_name = $3 OR branch_name IN (${SHARED_SQL}))))`;

async function profile(me: SessionUser, id: string) {
  const [r] = (await sql`SELECT id, full_name, age, room, branch_name, chronic_diseases, status, hn FROM residents WHERE id = ${id}`) as Record<string, unknown>[];
  if (!r) return null;
  if (scoped(me) && r.branch_name !== me.branch) return "forbidden";
  const p = [r.id, r.full_name, r.branch_name];
  const q = (text: string) => sql(text, p) as Promise<Record<string, unknown>[]>;
  const [health, daily, meds, packs, appts, tasks, handovers, alerts, contracts, plans, stockMeds, care] = await Promise.all([
    q(`SELECT id, recorded_at::text AS at, vital_signs, o2_sat, dtx, weight_height, note, recorded_by FROM health_logs WHERE ${MINE} ORDER BY recorded_at DESC NULLS LAST LIMIT 90`),
    q(`SELECT id, work_date::text AS work_date, scheduled_time::text AS time, task_name, assignee, shift, status, vital_signs FROM daily_tasks WHERE ${MINE} ORDER BY work_date DESC, scheduled_time DESC LIMIT 40`),
    q(`SELECT id, drug_name, indication, dose, unit, timing, meals, stock, on_hold, status, warnings, needs_fridge, source FROM resident_medications WHERE ${MINE} ORDER BY on_hold, drug_name`),
    q(`SELECT id, pack_date::text AS date, meal, items, qa_status, given, given_by, given_at::text AS given_at, packed_by, checked_by FROM medication_packs WHERE ${MINE} ORDER BY pack_date DESC, created_at DESC LIMIT 40`),
    q(`SELECT id, appt_date::text AS date, appt_time::text AS time, purpose, caregiver FROM appointments WHERE ${MINE} ORDER BY appt_date DESC NULLS LAST LIMIT 20`),
    q(`SELECT id, work_date::text AS date, category, task_name, performed_by, status, submitted_at::text AS time FROM task_logs WHERE ${MINE} ORDER BY work_date DESC NULLS LAST LIMIT 20`),
    q(`SELECT id, topic_type, detail, written_by, written_at FROM shift_handovers WHERE ${MINE} ORDER BY created_at DESC LIMIT 20`),
    q(`SELECT id, level, summary, vital_text, created_by, to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at, status, ack_by, to_char(ack_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"') AS ack_at, ack_note FROM care_alerts WHERE ${MINE} ORDER BY created_at DESC LIMIT 20`),
    // สัญญาและแผนดูแล (มีราคา) เฉพาะผู้จัดการขึ้นไป
    !can(me, "contracts") ? Promise.resolve([]) : q(`SELECT id, contract_no, employer_name, monthly_fee, status, start_date::text AS start_date FROM contracts WHERE ${MINE} ORDER BY created_at DESC`),
    !can(me, "quotations") ? Promise.resolve([]) : q(`SELECT id, plan_name, relative_phone, estimated_price, note FROM care_assessments WHERE ${MINE}`),
    // ยาที่เบิกจากคลังกลางของศูนย์ (การเบิกครั้งเดียวกันหลายล็อตรวมเป็นแถวเดียว)
    sql(`SELECT d.name, d.unit, (-sum(m.delta))::float AS qty, m.moved_by, m.note, m.med_id IS NOT NULL AS basket, bool_and(m.invoice_id IS NOT NULL) AS billed, max(m.price) IS NOT NULL AS priced,
        to_char(m.created_at AT TIME ZONE 'Asia/Bangkok', 'DD/MM/') || (extract(year FROM m.created_at AT TIME ZONE 'Asia/Bangkok')::int + 543) || to_char(m.created_at AT TIME ZONE 'Asia/Bangkok', ' HH24:MI') AS at
      FROM stock_moves m JOIN stock_drugs d ON d.id = m.drug_id WHERE m.resident_id = $1 AND m.reason = 'เบิกให้ผู้ป่วย'
      GROUP BY m.created_at, d.name, d.unit, m.moved_by, m.note, m.med_id ORDER BY m.created_at DESC LIMIT 60`, [r.id]) as Promise<Record<string, unknown>[]>,
    // ข้อมูลสำคัญสำหรับการดูแลจากสัญญาล่าสุด (ทีมดูแลทุกคนเห็น) · ไม่ส่งเลขบัตร ที่อยู่ หรือยอดเงิน
    q(`SELECT drug_allergy, food_allergy, regular_meds, hospital, hospital_alt, employer_name, relationship, employer_phone FROM contracts
        WHERE ${MINE} AND coalesce(status, '') <> 'ยกเลิกสัญญา' ORDER BY (status IN ('ใช้งานอยู่', 'รอชำระเงินมัดจำ')) DESC NULLS LAST, created_at DESC LIMIT 1`),
  ]);
  return { resident: r, health, daily, meds, packs, appts, tasks, handovers, alerts, contracts, plans, stockMeds, careInfo: care[0] ?? null };
}

export async function GET(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const qs = req.nextUrl.searchParams;
  try {
    switch (qs.get("op")) {
      case "facility": {
        if (!canFacility(me)) return forbidden();
        const rows = await sql(`SELECT f.id, f.task_name AS name, f.category, f.schedule, f.dispatch_mode,
            ${scoped(me) ? "(SELECT assignee FROM facility_assignees WHERE task_id = f.id AND branch_name = $1)" : "(SELECT string_agg(branch_name || ': ' || assignee, ', ') FROM facility_assignees WHERE task_id = f.id)"} AS assignee, to_char(${PERIOD_SQL}, 'YYYY-MM-DD') AS period_start,
            l.id AS log_id, l.done_by, to_char(l.done_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI') AS done_at, l.work_date::text AS done_date, l.note,
            (SELECT count(*)::int FROM facility_logs x WHERE x.task_id = f.id ${scoped(me) ? "AND x.branch_name = $1" : ""} AND x.work_date >= date_trunc('month', (now() AT TIME ZONE 'Asia/Bangkok'))::date) AS month_count
          FROM facility_tasks f LEFT JOIN LATERAL (SELECT * FROM facility_logs WHERE task_id = f.id ${scoped(me) ? "AND branch_name = $1" : ""} ORDER BY done_at DESC LIMIT 1) l ON true
          ${scoped(me) ? "WHERE (f.branch_name = $1 OR f.branch_name = 'ทุกสาขา' OR f.branch_name IS NULL)" : ""} ORDER BY f.sort_order DESC, f.created_at`, scoped(me) ? [me.branch] : []) as Record<string, string | number | null>[];
        const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
        const items = rows.map((r) => {
          const start = String(r.period_start).slice(0, 10);
          const done = !!r.done_date && String(r.done_date) >= start;
          const sched = String(r.schedule ?? "");
          // เลยเวลา: งานรายวันที่ระบุเวลา เลยไป 2 ชั่วโมงแล้ว · งานรายเดือน "วันที่ N" เลยไป 2 วันแล้ว
          const hm = sched.match(/(\d{1,2}):(\d{2})/), day = sched.match(/วันที่\s*(\d{1,2})/);
          const nowMin = new Date(Date.now() + 7 * 3600e3).getUTCHours() * 60 + new Date(Date.now() + 7 * 3600e3).getUTCMinutes();
          const late = !done && (sched.includes("ทุกเดือน") ? !!day && Number(today.slice(8)) > Number(day[1]) + 2 : !sched.includes("ทุกสัปดาห์") && !!hm && nowMin > Number(hm[1]) * 60 + Number(hm[2]) + 120);
          const manual = isManual(r.dispatch_mode);
          return { id: r.id, name: r.name, category: r.category, schedule: sched, manual, assignee: manual ? (r.assignee as string | null) || null : null, done, late, last: r.log_id ? { id: r.log_id, by: r.done_by, at: r.done_at, note: r.note } : null, monthCount: r.month_count };
        });
        // KinApp: งานมอบหมายขึ้นเฉพาะคนรับผิดชอบ · งานทั่วไปขึ้นให้ทุกคน
        return NextResponse.json({ items: qs.get("mine") ? items.filter((x) => !x.manual || x.assignee === me.name) : items });
      }
      case "facility_history": {
        if (!can(me, "facility_tasks")) return forbidden();
        const month = /^\d{4}-\d{2}$/.test(qs.get("month") ?? "") ? qs.get("month")! : new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7);
        const [task] = (await sql`SELECT id, task_name AS name, schedule FROM facility_tasks WHERE id = ${qs.get("id") ?? ""}`) as Record<string, string>[];
        if (!task) return bad("ไม่พบงานนี้", 404);
        const logs = await sql(`SELECT id, branch_name AS branch, done_by AS by, note, work_date::text AS date, to_char(done_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS time
          FROM facility_logs WHERE task_id = $1 AND work_date >= $2::date AND work_date < $2::date + interval '1 month' ${scoped(me) ? "AND branch_name = $3" : ""}
          ORDER BY done_at DESC`, scoped(me) ? [task.id, `${month}-01`, me.branch] : [task.id, `${month}-01`]);
        return NextResponse.json({ task, month, logs, today: new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10) });
      }
      case "facility_photo": {
        if (!canFacility(me)) return forbidden();
        const [r] = (await sql`SELECT photo, branch_name FROM facility_logs WHERE id = ${qs.get("id") ?? ""}`) as { photo: string | null; branch_name: string }[];
        if (!r) return bad("ไม่พบบันทึก", 404);
        if (scoped(me) && r.branch_name !== me.branch) return forbidden();
        return NextResponse.json({ photo: r.photo });
      }
      case "my_reviews": {
        const rows = await sql(`SELECT id, work_date::text AS date, task_name AS task, resident_name AS name, review_stars AS stars, review_note AS note, reviewed_by AS by,
            to_char(reviewed_at AT TIME ZONE 'Asia/Bangkok', 'DD/MM HH24:MI') AS at
          FROM daily_tasks WHERE done_by = $1 AND review_stars IS NOT NULL AND work_date >= (now() AT TIME ZONE 'Asia/Bangkok')::date - 6
          ORDER BY (review_stars <= 2) DESC, reviewed_at DESC NULLS LAST LIMIT 30`, [me.name]);
        return NextResponse.json({ items: rows });
      }
      case "allergies": {
        // KinApp ต้องเห็นประวัติแพ้ยาตอนจ่ายยาและวัดสัญญาณชีพ (อ่านอย่างเดียว เฉพาะสาขาตัวเอง)
        if (!can(me, "residents") && !can(me, "app.staff")) return forbidden();
        const rows = await sql(`SELECT DISTINCT ON (resident_name, branch_name) resident_name AS name, branch_name AS branch, drug_allergy AS drug, food_allergy AS food
            FROM contracts WHERE coalesce(status, '') <> 'ยกเลิกสัญญา' ${scoped(me) ? "AND branch_name = $1" : ""}
            ORDER BY resident_name, branch_name, created_at DESC`, scoped(me) ? [me.branch] : []);
        return NextResponse.json({ items: rows });
      }
      case "residents": {
        const rows = scoped(me)
          ? await sql`SELECT id, full_name, age, room, branch_name, status, chronic_diseases, hn FROM residents WHERE branch_name = ${me.branch} ORDER BY sort_order DESC, created_at DESC`
          : await sql`SELECT id, full_name, age, room, branch_name, status, chronic_diseases, hn FROM residents ORDER BY sort_order DESC, created_at DESC`;
        return NextResponse.json({ residents: rows });
      }
      case "family_updates_all": {
        if (!isFamilyAdmin(me)) return forbidden();
        const rows = await sql(`SELECT id, resident_id, resident_name, branch_name, body, (photo IS NOT NULL) AS has_photo, posted_by,
            to_char(created_at AT TIME ZONE 'Asia/Bangkok', 'DD/MM/') || (extract(year FROM created_at AT TIME ZONE 'Asia/Bangkok')::int + 543) || to_char(created_at AT TIME ZONE 'Asia/Bangkok', ' HH24:MI') AS at
          FROM family_updates ${scoped(me) ? "WHERE branch_name = $1" : ""} ORDER BY created_at DESC LIMIT 150`, scoped(me) ? [me.branch] : []);
        return NextResponse.json({ updates: rows });
      }
      case "family_update_photo": {
        if (!isFamilyAdmin(me)) return forbidden();
        const [u] = (await sql`SELECT photo, branch_name FROM family_updates WHERE id = ${String(qs.get("id") ?? "")}`) as Record<string, string>[];
        if (!u) return bad("ไม่พบรายการ", 404);
        if (scoped(me) && u.branch_name !== me.branch) return forbidden();
        return NextResponse.json({ photo: u.photo });
      }
      case "family_updates": {
        if (!can(me, "app.staff") && !can(me, "residents")) return forbidden();
        const [r] = (await sql`SELECT id, branch_name FROM residents WHERE id = ${String(qs.get("resident") ?? "")}`) as Record<string, string>[];
        if (!r) return bad("ไม่พบผู้รับบริการ", 404);
        if (scoped(me) && r.branch_name !== me.branch) return forbidden();
        const rows = await sql`SELECT id, body, (photo IS NOT NULL) AS has_photo, posted_by,
            to_char(created_at AT TIME ZONE 'Asia/Bangkok', 'DD/MM/') || (extract(year FROM created_at AT TIME ZONE 'Asia/Bangkok')::int + 543) || to_char(created_at AT TIME ZONE 'Asia/Bangkok', ' HH24:MI') AS at
          FROM family_updates WHERE resident_id = ${r.id} ORDER BY created_at DESC LIMIT 20`;
        return NextResponse.json({ updates: rows });
      }
      case "nurses": {
        const rows = scoped(me)
          ? await sql`SELECT full_name FROM staff_users WHERE branch_name = ${me.branch} AND status = 'ทำงาน' AND access_level IN ('Nurse','Head Nurse') ORDER BY full_name`
          : await sql`SELECT full_name FROM staff_users WHERE status = 'ทำงาน' AND access_level IN ('Nurse','Head Nurse') ORDER BY full_name`;
        return NextResponse.json({ nurses: rows.map((r) => r.full_name) });
      }
      case "profile": {
        const p = await profile(me, String(qs.get("id") ?? ""));
        if (!p) return bad("ไม่พบผู้รับบริการ", 404);
        if (p === "forbidden") return forbidden("ดูได้เฉพาะผู้รับบริการในสาขาของคุณ");
        return NextResponse.json(p);
      }
      case "surveys": {
        // ผลประเมินความพึงพอใจจากครอบครัว (ผู้จัดการขึ้นไป · เห็นเฉพาะสาขาตัวเอง)
        if (!can(me, "feedbacks")) return forbidden();
        const br = scoped(me) ? me.branch : qs.get("branch") || null;
        const rows = await sql(
          `SELECT id, branch_name, rater_name, relation, resident_name, score_overall, score_care, score_staff, score_food, score_clean, comment, contact_phone,
                  to_char(created_at AT TIME ZONE 'Asia/Bangkok', 'DD/MM/') || (extract(year FROM created_at AT TIME ZONE 'Asia/Bangkok')::int + 543) || to_char(created_at AT TIME ZONE 'Asia/Bangkok', ' HH24:MI') AS at
           FROM satisfaction_surveys ${br ? "WHERE branch_name = $1" : ""} ORDER BY created_at DESC LIMIT 200`, br ? [br] : []);
        return NextResponse.json({ surveys: rows });
      }
      case "task_photos": {
        // รูปหลักฐานหลายงานพร้อมกัน (หน้าผลงานทีมใน KinApp) · สูงสุด 50 งาน · เฉพาะสาขาตัวเอง
        const ids = (qs.get("ids") ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 50);
        if (!ids.length) return NextResponse.json({ photos: {} });
        const rows = (await sql(`SELECT id, photo FROM daily_tasks WHERE id = ANY($1) AND photo IS NOT NULL ${scoped(me) ? "AND branch_name = $2" : ""}`, scoped(me) ? [ids, me.branch] : [ids])) as { id: string; photo: string }[];
        return NextResponse.json({ photos: Object.fromEntries(rows.map((r) => [r.id, r.photo])) });
      }
      case "task_photo": {
        const [t] = (await sql`SELECT branch_name, photo, share_family AS share, review_stars AS stars, review_note AS rnote, reviewed_by AS rby, to_char(photo_at AT TIME ZONE 'Asia/Bangkok', 'DD/MM/') || (extract(year FROM photo_at AT TIME ZONE 'Asia/Bangkok')::int + 543) || to_char(photo_at AT TIME ZONE 'Asia/Bangkok', ' HH24:MI') AS at FROM daily_tasks WHERE id = ${qs.get("id") ?? ""}`) as Record<string, string | null>[];
        if (!t) return bad("ไม่พบงานนี้", 404);
        if (scoped(me) && t.branch_name !== me.branch) return forbidden();
        return NextResponse.json({ photo: t.photo, at: t.at, share: t.share, stars: t.stars, note: t.rnote, by: t.rby });
      }
      case "turning_risk": {
        // เสี่ยงแผลกดทับ: Braden ต่ำกว่า 13 หรือติดเตียง (ประเมินแรกรับ) · ยังพักอยู่
        const rows = await sql(
          `SELECT r.full_name AS name, r.room, r.branch_name AS branch, a.data->>'braden' AS braden, a.data->>'mobility' AS mobility
           FROM residents r JOIN resident_admissions a ON a.resident_id = r.id
           WHERE coalesce(r.status, '') NOT LIKE 'ย้ายออก%' AND coalesce(r.status, '') NOT LIKE 'มัดจำ%'
             AND (a.data->>'mobility' = 'ติดเตียง' OR (a.data->>'braden' ~ '^[0-9]{1,2}$' AND (a.data->>'braden')::int < 13))
             ${scoped(me) ? "AND r.branch_name = $1" : ""} ORDER BY r.branch_name, r.room NULLS LAST, r.full_name`, scoped(me) ? [me.branch] : []);
        return NextResponse.json({ items: rows });
      }
      case "routines": {
        const rows = await sql(
          `SELECT id, resident_name, branch_name, task_name, instruction, shift, sched_time, created_by FROM care_routines
           WHERE active ${scoped(me) ? "AND branch_name = $1" : ""} ORDER BY branch_name, resident_name, sched_time`, scoped(me) ? [me.branch] : []);
        return NextResponse.json({ routines: rows });
      }
      case "alerts": {
        // นักกายภาพไม่รับแจ้งเตือนสัญญาณชีพ (งานพยาบาล) · กระดิ่งของนักกายภาพแสดงเฉพาะงานกายภาพของตัวเอง
        if (me.role === "Physio") return NextResponse.json({ alerts: [] });
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
  if (b.op === "facility_done") {
    if (!can(me, "app.staff") && !can(me, "facility_tasks")) return forbidden();
    const photo = typeof b.photo === "string" ? b.photo : "";
    if (!photo.startsWith("data:image/") || photo.length > 900_000) return bad("กรุณาถ่ายรูปหลักฐาน (รูปต้องไม่ใหญ่เกินไป)");
    const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) : "";
    const [f] = (await sql(`SELECT f.id, f.task_name, f.branch_name, f.schedule, f.dispatch_mode, to_char(${PERIOD_SQL}, 'YYYY-MM-DD') AS period_start FROM facility_tasks f WHERE f.id = $1`, [String(b.taskId ?? "")])) as Record<string, string>[];
    if (!f) return bad("ไม่พบงานนี้", 404);
    // งานที่ตั้งไว้ "ทุกสาขา" บันทึกแยกตามสาขาของคนทำ
    const shared = !f.branch_name || f.branch_name === "ทุกสาขา";
    if (scoped(me) && !shared && f.branch_name !== me.branch) return forbidden();
    const branch = scoped(me) || !shared ? (scoped(me) ? me.branch : f.branch_name) : me.branch;
    // งานแบบมอบหมาย: ส่งได้เฉพาะคนที่สาขามอบหมายไว้
    if (isManual(f.dispatch_mode)) {
      const [a] = (await sql`SELECT assignee FROM facility_assignees WHERE task_id = ${f.id} AND branch_name = ${branch}`) as { assignee: string }[];
      if (!a) return bad("งานนี้ยังไม่ได้มอบหมายคนรับผิดชอบ แจ้งหัวหน้าพยาบาลให้มอบหมายก่อน");
      if (a.assignee !== me.name) return forbidden(`งานนี้มอบหมายให้ ${a.assignee} เป็นผู้ส่ง`);
    }
    const [dup] = (await sql`SELECT done_by FROM facility_logs WHERE task_id = ${f.id} AND branch_name IS NOT DISTINCT FROM ${branch} AND work_date >= ${String(f.period_start).slice(0, 10)}::date LIMIT 1`) as { done_by: string }[];
    if (dup) {
      // บอกรอบถัดไป: รายเดือน = วันที่ 1 เดือนหน้า · รายสัปดาห์ = วันจันทร์หน้า · รายวัน = พรุ่งนี้
      const sched = String(f.schedule ?? "");
      const TH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
      const m = Number(String(f.period_start).slice(5, 7));
      const [when, next] = sched.includes("ทุกเดือน") ? ["เดือนนี้", `วันที่ 1 ${TH[m % 12]}`] : sched.includes("ทุกสัปดาห์") ? ["สัปดาห์นี้", "วันจันทร์หน้า"] : ["วันนี้", "พรุ่งนี้"];
      return bad(`งานนี้ทำแล้ว${when}โดย ${dup.done_by} · ส่งได้อีกครั้ง${next}`, 409);
    }
    const id = crypto.randomUUID();
    await sql`INSERT INTO facility_logs (id, task_id, task_name, branch_name, done_by, done_by_id, work_date, photo, note)
              VALUES (${id}, ${f.id}, ${f.task_name}, ${branch}, ${me.name}, ${me.id}, (now() AT TIME ZONE 'Asia/Bangkok')::date, ${photo}, ${note || null})`;
    await audit(req, me, [{ area: "facility", action: "update", recordId: f.id, summary: `ทำงานส่วนกลางแล้ว · ${f.task_name}`, branch }]);
    return NextResponse.json({ ok: true, id });
  }
  if (b.op === "facility_assign") {
    if (!can(me, "facility_tasks")) return forbidden("มอบหมายได้เฉพาะผู้ที่มีสิทธิ์เมนูงานส่วนกลางของสาขา");
    const branch = scoped(me) ? me.branch : String(b.branch ?? "").trim();
    if (!branch || branch === "ทุกสาขา") return bad("กรุณาเลือกสาขา");
    const [f] = (await sql`SELECT id, task_name, branch_name FROM facility_tasks WHERE id = ${String(b.taskId ?? "")}`) as Record<string, string>[];
    if (!f) return bad("ไม่พบงานนี้", 404);
    if (f.branch_name && f.branch_name !== "ทุกสาขา" && f.branch_name !== branch) return forbidden();
    const who = typeof b.assignee === "string" ? b.assignee.trim() : "";
    if (who) {
      const [n] = (await sql`SELECT 1 FROM staff_users WHERE full_name = ${who} AND branch_name = ${branch} AND status = 'ทำงาน'`) as unknown[];
      if (!n) return bad("ไม่พบพยาบาลคนนี้ในสาขา");
      await sql`INSERT INTO facility_assignees (task_id, branch_name, assignee, assigned_by) VALUES (${f.id}, ${branch}, ${who}, ${me.name})
                ON CONFLICT (task_id, branch_name) DO UPDATE SET assignee = EXCLUDED.assignee, assigned_by = EXCLUDED.assigned_by, updated_at = now()`;
    } else await sql`DELETE FROM facility_assignees WHERE task_id = ${f.id} AND branch_name = ${branch}`;
    await audit(req, me, [{ area: "facility", action: "update", recordId: f.id, summary: who ? `มอบหมายงานส่วนกลาง ${f.task_name} ให้ ${who}` : `ยกเลิกการมอบหมาย ${f.task_name}`, branch }]);
    return NextResponse.json({ ok: true });
  }
  if (b.op === "family_update") {
    if (!can(me, "app.staff") && !can(me, "residents")) return forbidden("บัญชีนี้ไม่มีสิทธิ์ส่งอัปเดตถึงครอบครัว");
    const text = typeof b.text === "string" ? b.text.trim().slice(0, 1000) : "";
    const photo = typeof b.photo === "string" && b.photo ? b.photo : null;
    if (!text && !photo) return bad("กรุณาพิมพ์ข้อความหรือแนบรูปอย่างน้อยหนึ่งอย่าง");
    if (photo && (!photo.startsWith("data:image/") || photo.length > 800_000)) return bad("รูปไม่ถูกต้องหรือมีขนาดใหญ่เกินไป");
    const [r] = (await sql`SELECT id, full_name, branch_name FROM residents WHERE id = ${String(b.residentId ?? "")}`) as Record<string, string>[];
    if (!r) return bad("ไม่พบผู้รับบริการ", 404);
    if (scoped(me) && r.branch_name !== me.branch) return forbidden();
    const id = crypto.randomUUID();
    await sql`INSERT INTO family_updates (id, resident_id, resident_name, branch_name, body, photo, posted_by)
              VALUES (${id}, ${r.id}, ${r.full_name}, ${r.branch_name}, ${text || null}, ${photo}, ${me.name})`;
    await audit(req, me, [{ area: "family_updates", action: "create", recordId: id, summary: `อัปเดตถึงครอบครัว · ${r.full_name}${photo ? " (มีรูป)" : ""}`, branch: r.branch_name }]);
    return NextResponse.json({ ok: true, id });
  }
  if (b.op === "family_update_delete") {
    const [u] = (await sql`SELECT id, resident_name, branch_name, posted_by FROM family_updates WHERE id = ${String(b.id ?? "")}`) as Record<string, string>[];
    if (!u) return bad("ไม่พบรายการ", 404);
    if (scoped(me) && u.branch_name !== me.branch) return forbidden();
    if (u.posted_by !== me.name && !can(me, "residents")) return forbidden("ลบได้เฉพาะรายการที่ตัวเองส่ง");
    await sql`DELETE FROM family_updates WHERE id = ${u.id}`;
    await audit(req, me, [{ area: "family_updates", action: "delete", recordId: u.id, summary: `ลบอัปเดตถึงครอบครัว · ${u.resident_name}`, branch: u.branch_name }]);
    return NextResponse.json({ ok: true });
  }
  if (b.op === "task_photo") {
    const photo = typeof b.photo === "string" ? b.photo : "";
    if (!photo.startsWith("data:image/") || photo.length > 600_000) return bad("รูปไม่ถูกต้องหรือมีขนาดใหญ่เกินไป");
    const [t] = (await sql`SELECT branch_name, done_by FROM daily_tasks WHERE id = ${String(b.id)}`) as Record<string, string>[];
    if (!t) return bad("ไม่พบงานนี้", 404);
    if (scoped(me) && t.branch_name !== me.branch) return forbidden();
    // งานที่คนอื่นส่งไปแล้ว: ห้ามรูปของคนที่ส่งไม่ทันทับรูปหลักฐานเดิม
    if (t.done_by && t.done_by !== "-" && t.done_by !== me.name && !can(me, "tasks.review")) return bad(`งานนี้ส่งไปแล้วโดย ${t.done_by} · ไม่ต้องส่งรูปซ้ำ`, 409);
    // share = แชร์รูปนี้ในสมุดภาพของครอบครัว (พนักงานเลือกตอนส่งงาน ค่าเริ่มต้นแชร์)
    await sql`UPDATE daily_tasks SET photo = ${photo}, photo_at = now(), share_family = ${b.share !== false} WHERE id = ${String(b.id)}`;
    return NextResponse.json({ ok: true });
  }
  if (b.op === "task_review") {
    // ผู้จัดการให้ดาวและความเห็นตอนตรวจงาน (KPI ส่วน "ดาวจากผู้จัดการ")
    if (!can(me, "tasks.review")) return forbidden("บัญชีนี้ไม่มีสิทธิ์ตรวจงาน");
    const stars = Number(b.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) return bad("กรุณาให้ดาว 1–5");
    const [t] = (await sql`SELECT branch_name, resident_name, task_name, done_by FROM daily_tasks WHERE id = ${String(b.id)}`) as Record<string, string>[];
    if (!t) return bad("ไม่พบงานนี้", 404);
    if (scoped(me) && t.branch_name !== me.branch) return forbidden();
    const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) : "";
    await sql`UPDATE daily_tasks SET review_stars = ${stars}, review_note = ${note || null}, reviewed_by = ${me.name}, reviewed_at = now() WHERE id = ${String(b.id)}`;
    await audit(req, me, [{ area: "daily", action: "update", recordId: String(b.id), summary: `ตรวจงาน ${stars} ดาว · ${t.done_by ?? "-"} · ${t.resident_name} · ${t.task_name}`, branch: t.branch_name, after: { review_stars: stars, review_note: note || null } }]);
    return NextResponse.json({ ok: true });
  }
  if (b.op === "task_share") {
    // ผู้จัดการซ่อน/แสดงรูปในสมุดภาพของครอบครัว
    if (!can(me, "tasks.review")) return forbidden("บัญชีนี้ไม่มีสิทธิ์ซ่อนรูปจากครอบครัว");
    const [t] = (await sql`SELECT branch_name, resident_name, task_name FROM daily_tasks WHERE id = ${String(b.id)}`) as Record<string, string>[];
    if (!t) return bad("ไม่พบงานนี้", 404);
    if (scoped(me) && t.branch_name !== me.branch) return forbidden();
    await sql`UPDATE daily_tasks SET share_family = ${b.share === true} WHERE id = ${String(b.id)}`;
    await audit(req, me, [{ area: "family_photos", action: "update", recordId: String(b.id), summary: `${b.share === true ? "แสดง" : "ซ่อน"}รูปในสมุดภาพครอบครัว · ${t.resident_name} · ${t.task_name}`, branch: t.branch_name }]);
    return NextResponse.json({ ok: true });
  }
  if (b.op === "routines_add" || b.op === "routine_stop") {
    if (!can(me, "tasks.review")) return forbidden("บัญชีนี้ไม่มีสิทธิ์ตั้งงานประจำ");
    if (b.op === "routine_stop") {
      const [r] = (await sql`SELECT id, branch_name, resident_name, task_name FROM care_routines WHERE id = ${String(b.id)}`) as Record<string, string>[];
      if (!r) return bad("ไม่พบงานประจำนี้", 404);
      if (scoped(me) && r.branch_name !== me.branch) return forbidden();
      await sql`UPDATE care_routines SET active = false WHERE id = ${r.id}`;
      await audit(req, me, [{ area: "routines", action: "delete", recordId: r.id, summary: `${r.resident_name} · ${r.task_name}`, branch: r.branch_name }]);
      return NextResponse.json({ ok: true });
    }
    const items = (Array.isArray(b.items) ? b.items : []) as { resident: string; task: string; ins?: string; shift: string; time: string }[];
    const res = (await sql`SELECT id, full_name, branch_name FROM residents`) as Record<string, string>[];
    const have = (await sql`SELECT resident_id, task_name, shift FROM care_routines WHERE active`) as Record<string, string>[];
    let added = 0;
    const logs = [];
    const made: { resident_id: string; resident_name: string; branch_name: string; task_name: string; instruction: string; shift: string; sched_time: string }[] = [];
    for (const it of items) {
      const r = res.find((x) => x.full_name === it.resident && (!scoped(me) || x.branch_name === me.branch));
      if (!r || !it.task || !it.shift || !/^\d{2}:\d{2}/.test(it.time ?? "")) continue;
      if (have.some((h) => h.resident_id === r.id && h.task_name === it.task && h.shift === it.shift)) continue;
      const id = crypto.randomUUID();
      await sql`INSERT INTO care_routines (id, resident_id, resident_name, branch_name, task_name, instruction, shift, sched_time, created_by)
                VALUES (${id}, ${r.id}, ${r.full_name}, ${r.branch_name}, ${it.task}, ${it.ins ?? "-"}, ${it.shift}, ${it.time.slice(0, 5)}, ${me.name})`;
      have.push({ resident_id: r.id, task_name: it.task, shift: it.shift });
      made.push({ resident_id: r.id, resident_name: r.full_name, branch_name: r.branch_name, task_name: it.task, instruction: it.ins ?? "-", shift: it.shift, sched_time: it.time.slice(0, 5) });
      logs.push({ area: "routines", action: "create", recordId: id, summary: `${r.full_name} · ${it.task} · ${it.shift} ${it.time.slice(0, 5)}`, branch: r.branch_name });
      added++;
    }
    // วันที่ระบบสร้างงานประจำไปแล้ว (วันนี้ถึงล่วงหน้า 14 วัน) ใส่งานประจำใหม่ให้ด้วย แถวแบบเดียวกับที่ระบบสร้างเอง
    // ข้ามวันที่หน้าจอมอบหมายให้อยู่แล้ว (skipDate) และงานที่มีอยู่แล้ว (ผู้รับบริการ + งาน + กะ เดียวกัน) · เรียกซ้ำไม่เพิ่มซ้ำ
    if (made.length) {
      const skip = typeof b.skipDate === "string" ? b.skipDate : "";
      const dates = ((await sql`SELECT substring(collection from 7) AS d FROM app_seed
        WHERE collection LIKE 'daily-____-__-__'
          AND substring(collection from 7)::date BETWEEN (now() AT TIME ZONE 'Asia/Bangkok')::date AND (now() AT TIME ZONE 'Asia/Bangkok')::date + 14`) as { d: string }[])
        .map((x) => x.d).filter((d) => d !== skip);
      const top = Date.now();
      const q = dates.flatMap((d) => made.map((r, i) => sql`
        INSERT INTO daily_tasks (id, sort_order, work_date, branch_name, resident_id, resident_name, task_name, assignee, scheduled_time, shift, status, instruction)
        SELECT ${crypto.randomUUID()}, ${top - i}::float8, ${d}::date, ${r.branch_name}, ${r.resident_id}, ${r.resident_name}, ${r.task_name}, '-', ${r.sched_time}::time, ${r.shift}, 'รอทำ', ${r.instruction}
        WHERE NOT EXISTS (SELECT 1 FROM daily_tasks WHERE work_date = ${d}::date AND branch_name IS NOT DISTINCT FROM ${r.branch_name}
          AND (resident_id = ${r.resident_id} OR resident_name = ${r.resident_name}) AND task_name = ${r.task_name} AND shift = ${r.shift})`));
      if (q.length) await sql.transaction(q);
    }
    await audit(req, me, logs);
    return NextResponse.json({ ok: true, added });
  }
  if (b.op !== "ack") return bad("unknown op");
  if (me.role === "Physio") return forbidden("การรับทราบสัญญาณชีพผิดปกติเป็นงานของพยาบาล");
  const [a] = (await sql`SELECT id, branch_name, resident_name, summary, status FROM care_alerts WHERE id = ${String(b.id)}`) as Record<string, string>[];
  if (!a) return bad("ไม่พบแจ้งเตือนนี้", 404);
  if (scoped(me) && a.branch_name !== me.branch) return forbidden();
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) : "";
  await sql`UPDATE care_alerts SET status = 'acknowledged', ack_by = ${me.name}, ack_at = now(), ack_note = ${note || null} WHERE id = ${a.id}`;
  await audit(req, me, [{ area: "alerts", action: "acknowledge", recordId: a.id, summary: `${a.resident_name ?? ""} · ${a.summary ?? ""}`.slice(0, 200), branch: a.branch_name, after: { ack_note: note || null } }]);
  return NextResponse.json({ ok: true });
}
