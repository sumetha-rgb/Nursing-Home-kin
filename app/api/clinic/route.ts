import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUser, forbidden, unauthorized } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { can } from "@/lib/perms";
import { attention } from "@/lib/attention";
import type { SessionUser } from "@/lib/roles";
import { NOTE_KINDS } from "@/lib/clinic";
import { pushTo } from "@/lib/push";
import { dowOf, onDate, schedOf, teamOf, thNowText, whoOn, type PlanSlots } from "@/lib/physio";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * งานพยาบาลและกายภาพรายบุคคล (เห็นเฉพาะสาขาตัวเอง ยกเว้นผู้บริหาร)
 *  GET  ?op=resident&id=…           ประเมินแรกรับ บันทึกทางคลินิก คอร์สกายภาพ เวชภัณฑ์ที่เบิก
 *  GET  ?op=supplies                 รายการเวชภัณฑ์ในคลังของสาขา
 *  GET  ?op=courses&branch=…         คอร์สกายภาพที่ขายไปทั้งหมด (ผู้ซื้อ ใช้แล้ว คงเหลือ ใช้ล่าสุด) · แดชบอร์ด
 *  GET  ?op=unbilled&resident=…      เวชภัณฑ์และคอร์สกายภาพที่ยังไม่ออกใบแจ้งหนี้ (หน้าใบแจ้งหนี้และใบเสร็จ)
 *  GET  ?op=doc_file&id=…          ไฟล์แนบของเอกสารระเบียบ
 *  POST { op: "doc_file", id, name, data }   แนบ/เปลี่ยนไฟล์ (data URL ไม่เกิน 4 MB · รูปหรือ PDF)
 *  GET  ?op=doc_settings             ข้อความในเอกสาร (เช่น ข้อสัญญา)
 *  POST { op: "admission", residentId, data }             บันทึกประวัติและประเมินแรกรับ
 *  POST { op: "note", residentId, kind, title?, body?, data?, status? }   เพิ่มบันทึก
 *  POST { op: "note_status", id, status }                  ปิด/เปิดปัญหาใน Problem list
 *  POST { op: "note_delete", id }                          ลบบันทึก (ผู้เขียน หรือผู้มีสิทธิ์ผู้รับบริการ)
 *  POST { op: "course", residentId, name, total, price, freeReason? }   ซื้อคอร์สกายภาพ · ราคา 0 = ให้ฟรี (ผู้จัดการขึ้นไป ต้องมีเหตุผล)
 *  POST { op: "course_use", courseId, body?, data? }        ใช้คอร์ส 1 ครั้ง + Progress note (ทำได้ทันทีหลังซื้อ ไม่ต้องรอใบแจ้งหนี้ · เดิม: คอร์สที่มีราคาต้องออกใบแจ้งหนี้แล้ว)
 *  POST { op: "course_cancel", courseId }                  ยกเลิกคอร์สที่ยังไม่ได้ใช้และยังไม่ออกใบแจ้งหนี้ (เช่น กดซ้ำ)
 *  GET  ?op=physio_board[&branch=]  ตารางกายภาพ: คอร์สที่ยังเหลือครั้ง + ผู้รับผิดชอบ/แผน · นักกายภาพในสาขา · ทำแล้ววันนี้ · จำนวนครั้งเดือนนี้ต่อคน
 *  GET  ?op=physio_today            บันทึกกายภาพของวันนี้ในสาขา (KinApp พยาบาลเห็นว่าใครทำแล้ว)
 *  GET  ?op=physio_history&course=  ประวัติการทำกายภาพทุกครั้งของคอร์ส + เวลาเช็คอิน/บันทึก/ระยะเวลาจริง (ไม่ส่งรูป)
 *  GET  ?op=physio_photo&visit=&kind=checkin|work   รูปเช็คอิน / รูปงาน (ไฟล์รูป ใส่ใน <img src> ได้)
 *  POST { op: "course_reassign", fromId, toId }     ย้ายเคสทั้งหมด (ที่ยังเหลือครั้ง) ของนักกายภาพคนหนึ่งไปให้อีกคน (สิทธิ์ จ่ายเคสกายภาพ · เฉพาะสาขาที่ดูแล)
 *  จ่ายเคส / เปลี่ยนแผน / ย้ายเคส → แจ้งเตือนบนมือถือของนักกายภาพที่เกี่ยวข้อง
 *  POST { op: "physio_checkin", courseId, photo }    เช็คอินข้างเตียงพร้อมรูป (เวลาจาก server) · เช็คอินซ้ำ = ถ่ายรูปใหม่
 *  POST { op: "physio_checkin_cancel", visitId }     ยกเลิกเช็คอินที่ยังไม่ได้บันทึก (ของตัวเอง)
 *  นักกายภาพ (ตำแหน่ง Physio) บันทึก course_use ต้องส่ง visitId (เช็คอินแล้ว) + photo (รูปงาน)
 *  รับงานข้ามสาขา: นักกายภาพที่อยู่ในทีมของเคส (ผู้รับผิดชอบหลัก / คนทำประจำวัน / คนทำแทน · plan_slots) เห็น/เช็คอิน/บันทึก/ดูประวัติเคสนั้นได้แม้อยู่ต่างสาขา (เฉพาะเคสนั้น)
 *  POST { op: "course_close", courseId, reason }     ปิดคอร์สที่ใช้ไปแล้วแต่ไม่ทำต่อ (ผู้จัดการสาขา/ผู้บริหาร/ฝ่ายขาย · ต้องมีเหตุผล · เก็บผู้ปิด วันเวลาไทย) · ครั้งที่เหลือยกเลิก ประวัติคงไว้ · เงินคืนทำใบลดหนี้แยก
 *  POST { op: "slot_request", courseId, date, reason, cancel? }  นักกายภาพขอคนแทนนัดของตัวเอง · แจ้งผู้จัดการ/ฝ่ายขายของสาขา · ล้างเองเมื่อจัดคนแทนหรือยกเลิกนัด
 *  นักกายภาพ (onlyMine): เห็นเฉพาะเคสในทีมของตัวเอง · เช็คอินได้เฉพาะนัดวันนี้ที่ตัวเองเป็นคนทำ
 *  POST { op: "slot_cancel", courseId, date }        ยกเลิกนัดวันนั้น (เลือกวันเอง = เอาวันออก · ทุกสัปดาห์ = ข้ามเฉพาะวันนั้น) · สิทธิ์ จ่ายเคสกายภาพ
 *  POST { op: "physio_edit", id, body, data }         แก้ไขบันทึกกายภาพภายใน 7 วันหลังบันทึก (ผู้บันทึก หรือผู้จัดการสาขา) · ไม่เปลี่ยนจำนวนครั้ง/รูป · เก็บก่อน-หลังในบันทึกการใช้งาน
 *  POST { op: "slot_set", courseId, date, therapistId }  คนทำแทนเฉพาะนัดวันนั้น (therapistId ว่าง = กลับเป็นคนประจำ) · สิทธิ์ จ่ายเคสกายภาพ
 *  POST { op: "course_plan", courseId, therapistId, days | dates, time, minutes }   จ่ายเคส/เปลี่ยนผู้รับผิดชอบ (สิทธิ์ จ่ายเคสกายภาพ) · dates = เลือกวันเอง (YYYY-MM-DD)
 *  บันทึกกายภาพ (course_use · note kind physio) ต้องมีสิทธิ์ บันทึกกายภาพ · คนอื่นอ่านได้อย่างเดียว
 *  POST { op: "physio_free" }                              ปิดแล้ว · ต้องซื้อคอร์สก่อนบันทึกกายภาพ
 *  POST { op: "supply_item", id?, name, unit, price, stock } เพิ่ม/แก้เวชภัณฑ์ในคลัง
 *  POST { op: "supply_issue", residentId, itemId, qty }     เบิกเวชภัณฑ์ให้ผู้รับบริการ (ตัดสต็อก)
 *  POST { op: "supply_bill", ids, courseIds?, invoiceId }   ทำเครื่องหมายว่าออกใบแจ้งหนี้แล้ว
 *  POST { op: "doc_settings", key, value }                 ตั้งข้อความในเอกสาร (ผู้จัดการขึ้นไป)
 */
const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
const scoped = (me: SessionUser) => me.role !== "Global Admin";
const canRead = (me: SessionUser) => can(me, "residents") || can(me, "health_logs") || can(me, "app.staff") || can(me, "careplan");
const canManage = (me: SessionUser) => can(me, "residents");
/** ดูตารางกายภาพได้: เมนูตารางกายภาพ จ่ายเคส หรือบันทึกกายภาพ (นักกายภาพ) */
const canPhysio = (me: SessionUser) => can(me, "physio") || can(me, "physio.assign") || can(me, "physio.record");
const BKK_TODAY = "(now() AT TIME ZONE 'Asia/Bangkok')::date";
/** รูปถ่ายจากเครื่อง (data URL ย่อแล้ว) ไม่เกิน ~500KB · ไม่ถูกต้อง = "" */
const imgOf = (v: unknown) => (typeof v === "string" && v.length <= 700_000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v) ? v : "");
/** จำนวนรูปงาน (JSON array หรือรูปเดียวแบบเดิม) */
const WORK_N = (col: string) => `(CASE WHEN ${col} IS NULL THEN 0 WHEN left(${col}, 1) = '[' THEN json_array_length(${col}::json) ELSE 1 END)`;
const HM = (col: string) => `to_char(${col} AT TIME ZONE 'Asia/Bangkok', 'HH24:MI')`;
/** ผู้จัดการสาขาขึ้นไป (อนุมัติคอร์สฟรี) */
const isBoss = (me: SessionUser) => me.role === "Branch Admin" || me.role === "Global Admin";
const TH_AT = (col: string) => `to_char(${col} AT TIME ZONE 'Asia/Bangkok', 'DD/MM/') || (extract(year FROM ${col} AT TIME ZONE 'Asia/Bangkok')::int + 543) || to_char(${col} AT TIME ZONE 'Asia/Bangkok', ' HH24:MI')`;
/** อยู่ในทีมของคอร์ส (ผู้รับผิดชอบหลัก หรือคนทำประจำวัน/ทำแทน) · ใช้กับสิทธิ์รับงานข้ามสาขา */
const inTeam = (c: { therapist_id?: unknown; plan_slots?: unknown }, id: string) => c.therapist_id === id || JSON.stringify(c.plan_slots ?? {}).includes(`"${id}"`);
/** SQL: ทีมของคอร์ส (plan_slots) มีรหัสนี้ · รหัสเป็น UUID ไม่มีอักขระพิเศษของ LIKE */
const slotHas = (col: string, p: string) => `coalesce(${col}::text, '') LIKE '%"' || ${p} || '"%'`;
/** เห็น/ทำได้เฉพาะงานของตัวเอง: นักกายภาพ (หรือพนักงานที่มีแค่สิทธิ์บันทึกกายภาพ) · ไม่ใช่ผู้ดูภาพรวมหรือผู้จ่ายเคส */
const onlyMine = (me: SessionUser) => !can(me, "physio") && !can(me, "physio.assign");
const text = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
/** ยังไม่ได้เรียกเก็บ = ไม่ผูกใบแจ้งหนี้ หรือผูกกับใบที่ยกเลิกแล้ว (ข้อมูลเก่าก่อนที่การยกเลิกใบจะคืนรายการให้เอง) */
const unbilledSql = (col: string) => `(${col} IS NULL OR EXISTS (SELECT 1 FROM invoices v WHERE v.id = ${col} AND v.status = 'ยกเลิก'))`;
/** invoice_id ที่ส่งให้หน้าเว็บ: ผูกกับใบที่ยกเลิกแล้ว = ว่าง (ยังไม่เรียกเก็บ) */
const billedId = `CASE WHEN ${unbilledSql("invoice_id")} THEN NULL ELSE invoice_id END`;

async function residentOf(me: SessionUser, id: string) {
  const [r] = (await sql`SELECT id, full_name, branch_name FROM residents WHERE id = ${id}`) as { id: string; full_name: string; branch_name: string }[];
  if (!r) return { res: bad("ไม่พบผู้รับบริการ", 404) };
  if (scoped(me) && r.branch_name !== me.branch) return { res: forbidden("ดูได้เฉพาะผู้รับบริการในสาขาของคุณ") };
  return { r };
}

export async function GET(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const q = req.nextUrl.searchParams;
  try {
    switch (q.get("op")) {
      case "physio_board": {
        if (!canPhysio(me)) return forbidden();
        const br = scoped(me) ? me.branch : q.get("branch") || null;
        const p = br ? [br] : [];
        const w = (col: string) => (br ? `AND ${col} = $1` : "");
        // สาขานี้ หรือของฉัน (เคสข้ามสาขาที่ถูกจ่ายให้ · บันทึก/เช็คอินที่ฉันทำ) · $1 = สาขา, $2 = รหัส/ชื่อฉัน
        const pm = br ? [br, me.id] : [me.id], pn = br ? [br, me.name] : [me.name];
        const wOr = (col: string, mine: string) => (br ? `AND (${col} = $1 OR ${mine} = $2)` : "");
        const [cases, therapists, today, month] = await Promise.all([
          sql(`SELECT c.id, c.resident_id, c.resident_name, c.branch_name, nullif(trim(r.hn), '') AS hn, nullif(trim(r.room), '-') AS room, nullif(nullif(trim(r.bed), '-'), '') AS bed, c.name, c.total, c.used, coalesce(c.price, 0)::float AS price,
                NOT ${unbilledSql("c.invoice_id")} AS billed, coalesce((SELECT v.status = 'ชำระแล้ว' FROM invoices v WHERE v.id = c.invoice_id), false) AS paid, c.therapist_id, c.therapist_name, c.plan_days, c.plan_time, c.plan_minutes, c.plan_dates, c.plan_slots,
                coalesce((SELECT json_agg(x) FROM (SELECT ${TH_AT("n.created_at")} AS at, n.author, n.title, n.body, n.data->>'pain' AS pain, n.data->>'plan' AS plan, n.data->>'mobility' AS mobility, n.data->>'cc' AS cc, n.data->>'dx' AS dx
                  FROM clinical_notes n WHERE n.kind = 'physio' AND n.data->>'course_id' = c.id ORDER BY n.created_at DESC LIMIT 3) x), '[]') AS recent
              FROM physio_courses c LEFT JOIN residents r ON r.id = c.resident_id
              WHERE c.used < c.total AND coalesce(r.status, '') NOT LIKE 'ย้ายออก%' ${br ? `AND (c.branch_name = $1 OR c.therapist_id = $2 OR ${slotHas("c.plan_slots", "$2")})` : "AND $1::text IS NOT NULL"}
              ORDER BY c.resident_name, c.created_at`, pm),
          // นักกายภาพ = ตำแหน่งนักกายภาพ หรือคนที่ติ๊กสิทธิ์บันทึกกายภาพรายคน (ผู้บริหาร/ผู้จัดการไม่นับ แม้มีสิทธิ์)
          // ทุกสาขา (จ่ายเคสข้ามสาขาได้) + ภาระงานรวมทุกสาขา (จำนวนเคสที่ยังเหลือครั้ง)
          sql(`SELECT s.id, s.full_name AS name, coalesce(s.branch_name, '') AS branch, s.access_level AS role,
                (SELECT count(*)::int FROM physio_courses c WHERE (c.therapist_id = s.id OR ${slotHas("c.plan_slots", "s.id")}) AND c.used < c.total) AS cases_all
              FROM staff_users s
              WHERE coalesce(s.status, 'ทำงาน') = 'ทำงาน' AND (s.access_level = 'Physio' OR (s.access_level IN ('Nurse', 'Head Nurse') AND 'physio.record' = ANY(coalesce(s.permissions, '{}'))))
              ORDER BY s.full_name`),
          sql(`SELECT n.data->>'course_id' AS course_id, n.resident_name, n.author, to_char(n.created_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS at, n.data->>'pain' AS pain
              FROM clinical_notes n WHERE n.kind = 'physio' AND (n.created_at AT TIME ZONE 'Asia/Bangkok')::date = ${BKK_TODAY} ${wOr("n.branch_name", "n.author")} ${br ? "" : "AND $1::text IS NOT NULL"} ORDER BY n.created_at`, pn),
          sql(`SELECT coalesce(n.author, '-') AS author, count(*)::int AS n FROM clinical_notes n
              WHERE n.kind = 'physio' AND date_trunc('month', n.created_at AT TIME ZONE 'Asia/Bangkok') = date_trunc('month', now() AT TIME ZONE 'Asia/Bangkok') ${wOr("n.branch_name", "n.author")} ${br ? "" : "AND $1::text IS NOT NULL"} GROUP BY 1 ORDER BY 2 DESC`, pn),
        ]);
        const [{ d }] = (await sql(`SELECT ${BKK_TODAY}::text AS d`)) as { d: string }[];
        // เช็คอินวันนี้ที่ยังไม่ได้บันทึก (กำลังทำ)
        const visits = await sql(`SELECT id, course_id, therapist_id, therapist_name, ${HM("checkin_at")} AS at, to_char(checkin_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS iso
            FROM physio_visits WHERE note_id IS NULL AND (checkin_at AT TIME ZONE 'Asia/Bangkok')::date = ${BKK_TODAY} ${wOr("branch_name", "therapist_id")} ${br ? "" : "AND $1::text IS NOT NULL"} ORDER BY checkin_at`, pm);
        // บันทึกกายภาพของฉัน 90 วันล่าสุด (ปฏิทินใน KinApp: วันที่ผ่านมาบันทึกเคสไหนไปแล้ว)
        const mylog = await sql(`SELECT n.data->>'course_id' AS course_id, ((n.created_at AT TIME ZONE 'Asia/Bangkok')::date)::text AS date, ${HM("n.created_at")} AS at, n.title, n.resident_name
            FROM clinical_notes n WHERE n.kind = 'physio' AND n.author = $1 AND n.created_at > now() - interval '90 days' ORDER BY n.created_at`, [me.name]);
        // ติดตามการส่งงาน (42 วันล่าสุด): บันทึกจริง · เช็คอินที่ไม่ได้บันทึก (วันก่อน ๆ) · วันที่จ่ายเคส/แก้แผนล่าสุด (จากบันทึกการใช้งาน · อ่านอย่างเดียว)
        const ids = (cases as { id: string }[]).map((c) => c.id);
        const [log, stale, assigned] = await Promise.all([
          // by_id = นักกายภาพที่เช็คอินทำครั้งนั้นจริง (ไม่ใช่ผู้รับผิดชอบเคสปัจจุบัน · ย้ายเคสแล้วผลงานเดิมยังเป็นของคนเดิม)
          sql(`SELECT n.id, n.data->>'course_id' AS course_id, n.resident_name, n.author, ((n.created_at AT TIME ZONE 'Asia/Bangkok')::date)::text AS date, ${HM("n.created_at")} AS at, n.title,
                (SELECT v.therapist_id FROM physio_visits v WHERE v.note_id = n.id LIMIT 1) AS by_id
              FROM clinical_notes n WHERE n.kind = 'physio' AND n.created_at > now() - interval '42 days' ${wOr("n.branch_name", "n.author")} ${br ? "" : "AND $1::text IS NOT NULL"} ORDER BY n.created_at`, pn),
          sql(`SELECT course_id, resident_name, therapist_name, ((checkin_at AT TIME ZONE 'Asia/Bangkok')::date)::text AS date, ${HM("checkin_at")} AS at
              FROM physio_visits WHERE note_id IS NULL AND checkin_at > now() - interval '42 days' AND (checkin_at AT TIME ZONE 'Asia/Bangkok')::date < ${BKK_TODAY}
                ${wOr("branch_name", "therapist_id")} ${br ? "" : "AND $1::text IS NOT NULL"}`, pm),
          ids.length ? sql(`SELECT record_id AS course_id, ((max(at) AT TIME ZONE 'Asia/Bangkok')::date)::text AS date FROM audit_logs
              WHERE area = 'physio' AND action = 'update' AND summary LIKE 'จ่ายเคสกายภาพ%' AND record_id = ANY($1) GROUP BY record_id`, [ids]) : Promise.resolve([]),
        ]);
        if (onlyMine(me)) {
          // นักกายภาพ: เฉพาะเคสที่อยู่ในทีมของตัวเอง และบันทึก/เช็คอินของเคสเหล่านั้น · ไม่เห็นงานของคนอื่น
          const mineCases = (cases as Record<string, unknown>[]).filter((c) => inTeam(c, me.id));
          const ids2 = new Set(mineCases.map((c) => c.id as string));
          const by = (x: Record<string, unknown>) => ids2.has(x.course_id as string);
          return NextResponse.json({ cases: mineCases, therapists, today: (today as Record<string, unknown>[]).filter(by), month: (month as { author: string }[]).filter((m) => m.author === me.name),
            visits: (visits as Record<string, unknown>[]).filter((v) => v.therapist_id === me.id), mylog, log: (log as Record<string, unknown>[]).filter(by), stale: (stale as Record<string, unknown>[]).filter(by),
            assigned: (assigned as Record<string, unknown>[]).filter(by), date: d });
        }
        return NextResponse.json({ cases, therapists, today, month, visits, mylog, log, stale, assigned, date: d });
      }
      case "physio_history": {
        if (!canRead(me) && !canPhysio(me)) return forbidden();
        const [c] = (await sql`SELECT id, branch_name, therapist_id, plan_slots FROM physio_courses WHERE id = ${q.get("course") ?? ""}`) as { id: string; branch_name: string; therapist_id: string | null; plan_slots: unknown }[];
        if (!c) return bad("ไม่พบคอร์ส", 404);
        if (scoped(me) && c.branch_name !== me.branch && !inTeam(c, me.id)) return forbidden();
        if (onlyMine(me) && !inTeam(c, me.id)) return forbidden("ดูได้เฉพาะเคสของคุณ");
        const items = await sql(`SELECT n.id, n.title, n.body, n.author, ${TH_AT("n.created_at")} AS at, n.data->>'pain' AS pain, n.data->>'mobility' AS mobility, n.data->>'plan' AS plan,
              n.data->'activities' AS activities, n.data->'vitals' AS vitals, n.data->>'cc' AS cc, n.data->>'pe' AS pe, n.data->>'dx' AS dx,
              v.id AS visit_id, ${HM("v.checkin_at")} AS checkin, ${HM("v.done_at")} AS done,
              coalesce((n.data->>'minutes_fixed')::int, round(extract(epoch FROM v.done_at - v.checkin_at) / 60)::int, (n.data->>'minutes')::int) AS minutes, ${WORK_N("v.work_photo")} AS work_n,
              n.data->>'edited_at' AS edited, n.data->>'edited_by' AS edited_by,
              to_char(n.created_at + interval '7 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS edit_until
            FROM clinical_notes n LEFT JOIN physio_visits v ON v.note_id = n.id
            WHERE n.kind = 'physio' AND n.data->>'course_id' = $1 ORDER BY n.created_at DESC`, [c.id]);
        return NextResponse.json({ items });
      }
      case "physio_photo": {
        if (!canRead(me) && !canPhysio(me)) return forbidden();
        const work = q.get("kind") === "work";
        const [v] = (await sql`SELECT v.branch_name, v.checkin_photo, v.work_photo, v.therapist_id, c.therapist_id AS owner, c.plan_slots AS slots FROM physio_visits v LEFT JOIN physio_courses c ON c.id = v.course_id WHERE v.id = ${q.get("visit") ?? ""}`) as { branch_name: string; checkin_photo: string; work_photo: string | null; therapist_id: string | null; owner: string | null; slots: unknown }[];
        if (!v) return bad("ไม่พบรูป", 404);
        if (scoped(me) && v.branch_name !== me.branch && v.therapist_id !== me.id && !inTeam({ therapist_id: v.owner, plan_slots: v.slots }, me.id)) return forbidden();
        // รูปงาน: JSON array (หลายรูป) หรือ data URL เดียว (แบบเดิม) · i = ลำดับรูป
        let src = String((work ? v.work_photo : v.checkin_photo) ?? "");
        if (work && src.startsWith("[")) { try { src = String((JSON.parse(src) as string[])[Math.max(0, Number(q.get("i")) || 0)] ?? ""); } catch { src = ""; } }
        const m = src.match(/^data:(image\/[a-z]+);base64,(.+)$/);
        if (!m) return bad("ไม่พบรูป", 404);
        return new NextResponse(Buffer.from(m[2], "base64"), { headers: { "Content-Type": m[1], "Cache-Control": "private, max-age=86400" } });
      }
      case "physio_today": {
        if (!canRead(me) && !canPhysio(me)) return forbidden();
        const br = scoped(me) ? me.branch : q.get("branch") || null;
        const today = await sql(`SELECT n.resident_name, n.author, to_char(n.created_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS at, n.data->>'pain' AS pain
            FROM clinical_notes n WHERE n.kind = 'physio' AND (n.created_at AT TIME ZONE 'Asia/Bangkok')::date = ${BKK_TODAY} ${br ? "AND n.branch_name = $1" : ""} ORDER BY n.created_at`, br ? [br] : []);
        return NextResponse.json({ today });
      }
      case "resident": {
        // ผู้มีสิทธิ์งานกายภาพแต่ไม่ได้ดูข้อมูลการดูแล (ฝ่ายขาย/แคชเชียร์): เฉพาะส่วนกายภาพ = คอร์ส บันทึกกายภาพ และการเช็คอิน · ไม่ส่งแบบประเมิน บันทึกอื่น หรือเวชภัณฑ์
        const physioOnly = !canRead(me) && canPhysio(me);
        if (!canRead(me) && !physioOnly) return forbidden();
        const o = await residentOf(me, q.get("id") ?? "");
        if (!o.r) return o.res;
        const id = o.r.id;
        if (physioOnly) {
          const [notes, courses, visits] = await Promise.all([
            sql(`SELECT id, kind, title, body, data, status, author, ${TH_AT("created_at")} AS at FROM clinical_notes WHERE resident_id = $1 AND kind = 'physio' ORDER BY created_at DESC LIMIT 300`, [id]),
            sql(`SELECT id, name, total, used, price::float, status, created_by, ${billedId} AS invoice_id, ${TH_AT("created_at")} AS at, therapist_id, therapist_name, plan_days, plan_time, plan_minutes, plan_dates, plan_slots, coalesce((SELECT v.status = 'ชำระแล้ว' FROM invoices v WHERE v.id = physio_courses.invoice_id), false) AS paid FROM physio_courses WHERE resident_id = $1 ORDER BY created_at DESC`, [id]),
            sql(`SELECT id, note_id, ${HM("checkin_at")} AS checkin, ${HM("done_at")} AS done, round(extract(epoch FROM done_at - checkin_at) / 60)::int AS minutes, ${WORK_N("work_photo")} AS work_n
                FROM physio_visits WHERE resident_id = $1 AND note_id IS NOT NULL`, [id]),
          ]);
          return NextResponse.json({ admission: null, notes, courses, supplies: [], visits, contractAllergy: null, physioOnly: true });
        }
        const [adm] = (await sql(`SELECT data, assessed_by, ${TH_AT("updated_at")} AS at FROM resident_admissions WHERE resident_id = $1`, [id])) as Record<string, unknown>[];
        const notes = await sql(`SELECT id, kind, title, body, data, status, author, ${TH_AT("created_at")} AS at FROM clinical_notes WHERE resident_id = $1 ORDER BY created_at DESC LIMIT 300`, [id]);
        const courses = await sql(`SELECT id, name, total, used, price::float, status, created_by, ${billedId} AS invoice_id, ${TH_AT("created_at")} AS at, therapist_id, therapist_name, plan_days, plan_time, plan_minutes, plan_dates, plan_slots, coalesce((SELECT v.status = 'ชำระแล้ว' FROM invoices v WHERE v.id = physio_courses.invoice_id), false) AS paid FROM physio_courses WHERE resident_id = $1 ORDER BY created_at DESC`, [id]);
        const supplies = await sql(`SELECT id, item_name, unit, qty, price::float, issued_by, ${billedId} AS invoice_id, ${TH_AT("created_at")} AS at FROM supply_issues WHERE resident_id = $1 ORDER BY created_at DESC LIMIT 200`, [id]);
        // เช็คอิน/รูปงานของบันทึกกายภาพ (ไม่ส่งรูป · เปิดดูทีละรูป)
        const visits = await sql(`SELECT id, note_id, ${HM("checkin_at")} AS checkin, ${HM("done_at")} AS done, round(extract(epoch FROM done_at - checkin_at) / 60)::int AS minutes, ${WORK_N("work_photo")} AS work_n
            FROM physio_visits WHERE resident_id = $1 AND note_id IS NOT NULL`, [id]);
        // ค่าเริ่มต้นช่องแพ้ยา/แพ้อาหารในแบบประเมินแรกรับ จากสัญญาล่าสุด
        const [fromContract] = (await sql(`SELECT drug_allergy, food_allergy FROM contracts WHERE (resident_id = $1 OR (resident_id IS NULL AND resident_name = $2)) AND coalesce(status, '') <> 'ยกเลิกสัญญา' ORDER BY created_at DESC LIMIT 1`, [id, o.r.full_name])) as { drug_allergy: string | null; food_allergy: string | null }[];
        return NextResponse.json({ admission: adm ?? null, notes, courses, supplies, visits, contractAllergy: fromContract ?? null });
      }
      case "courses": {
        if (!canRead(me) && !can(me, "billing") && !can(me, "dashboard")) return forbidden();
        const br = scoped(me) ? me.branch : q.get("branch") || null;
        const rows = await sql(`SELECT c.id, c.resident_name, c.branch_name, c.name, c.total, c.used, coalesce(c.price, 0)::float AS price, c.status, c.created_by,
            NOT ${unbilledSql("c.invoice_id")} AS billed, to_char(c.created_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS day,
            (SELECT to_char(max(n.created_at) AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') FROM clinical_notes n WHERE n.kind = 'physio' AND n.data->>'course_id' = c.id) AS last_used
          FROM physio_courses c ${br ? "WHERE c.branch_name = $1" : ""} ORDER BY c.created_at DESC LIMIT 500`, br ? [br] : []);
        return NextResponse.json({ items: rows });
      }
      case "supplies": {
        if (!canRead(me) && !can(me, "app.pharmacy")) return forbidden();
        const rows = scoped(me)
          ? await sql`SELECT id, branch_name, name, unit, price::float, stock FROM supply_items WHERE branch_name = ${me.branch} ORDER BY name`
          : await sql`SELECT id, branch_name, name, unit, price::float, stock FROM supply_items ORDER BY branch_name, name`;
        return NextResponse.json({ items: rows });
      }
      case "home": {
        // การ์ด "สิ่งที่ต้องทำวันนี้" หน้าแรก · ชุดเดียวกับแถบ "ต้องจัดการ" ในภาพรวมและรายงาน (lib/attention.ts) · ผู้บริหารนับทุกสาขา
        return NextResponse.json(await attention(me, scoped(me) ? me.branch : null));
      }
      case "unbilled": {
        if (!can(me, "billing") && !can(me, "contracts")) return forbidden();
        const o = await residentOf(me, q.get("resident") ?? "");
        if (!o.r) return o.res;
        const rows = await sql(`SELECT id, item_name, unit, qty, price::float, ${TH_AT("created_at")} AS at FROM supply_issues WHERE resident_id = $1 AND ${unbilledSql("invoice_id")} ORDER BY created_at`, [o.r.id]);
        const courses = await sql(`SELECT id, name, total, price::float, ${TH_AT("created_at")} AS at FROM physio_courses WHERE resident_id = $1 AND ${unbilledSql("invoice_id")} AND coalesce(price, 0) > 0 ORDER BY created_at`, [o.r.id]);
        // ยาจากคลังยากลางที่เบิกให้ผู้ป่วยแล้วยังไม่เรียกเก็บ · ยาที่ยังไม่มีราคาขายขึ้นเป็นราคา 0 ให้แคชเชียร์กำหนดราคา (ไม่หายเงียบ)
        const meds = await sql(`SELECT m.id, d.name || CASE WHEN m.price IS NULL THEN ' (ยังไม่มีราคา)' ELSE '' END AS name, d.unit, (-m.delta)::float AS qty, coalesce(m.price, 0)::float AS price, ${TH_AT("m.created_at")} AS at
          FROM stock_moves m JOIN stock_drugs d ON d.id = m.drug_id
          WHERE m.resident_id = $1 AND m.reason = 'เบิกให้ผู้ป่วย' AND ${unbilledSql("m.invoice_id")} ORDER BY m.created_at`, [o.r.id]);
        // กายภาพที่ทำโดยยังไม่มีคอร์ส: แคชเชียร์กำหนดราคาตอนออกใบแจ้งหนี้
        const sessions = await sql(`SELECT id, ${TH_AT("created_at")} AS at FROM clinical_notes WHERE resident_id = $1 AND kind = 'physio' AND data->>'nocourse' = 'true' AND ${unbilledSql("invoice_id")} ORDER BY created_at`, [o.r.id]);
        return NextResponse.json({ items: rows, courses, meds, sessions });
      }
      case "doc_file": {
        if (!can(me, "official-docs")) return forbidden();
        const [d] = (await sql`SELECT file_name, file_data, branch_name FROM official_documents WHERE id = ${q.get("id") ?? ""}`) as Record<string, string>[];
        if (!d?.file_data) return bad("ยังไม่มีไฟล์แนบ", 404);
        if (scoped(me) && d.branch_name && d.branch_name !== me.branch) return forbidden();
        return NextResponse.json({ name: d.file_name, data: d.file_data });
      }
      case "doc_settings": {
        const rows = (await sql`SELECT key, value FROM doc_settings`) as { key: string; value: string }[];
        return NextResponse.json({ settings: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
      }
      default:
        return bad("unknown op");
    }
  } catch (e) {
    console.error("[api/clinic]", e);
    return bad("database error", 500);
  }
}

export async function POST(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    switch (b.op) {
      case "admission": {
        if (!canRead(me)) return forbidden();
        const o = await residentOf(me, String(b.residentId ?? ""));
        if (!o.r) return o.res;
        const data = JSON.stringify(obj(b.data)).slice(0, 60000);
        await sql`INSERT INTO resident_admissions (resident_id, branch_name, data, assessed_by, updated_at) VALUES (${o.r.id}, ${o.r.branch_name}, ${data}::jsonb, ${me.name}, now())
                  ON CONFLICT (resident_id) DO UPDATE SET data = EXCLUDED.data, assessed_by = EXCLUDED.assessed_by, updated_at = now()`;
        await audit(req, me, [{ area: "admissions", action: "update", recordId: o.r.id, summary: `ประวัติและประเมินแรกรับ · ${o.r.full_name}`, branch: o.r.branch_name }]);
        return NextResponse.json({ ok: true });
      }
      case "note": {
        if (!canRead(me)) return forbidden();
        const kind = String(b.kind ?? "");
        if (!(NOTE_KINDS as readonly string[]).includes(kind)) return bad("ประเภทบันทึกไม่ถูกต้อง");
        if (kind === "physio" && !can(me, "physio.record")) return forbidden("บันทึกกายภาพได้เฉพาะนักกายภาพ (สิทธิ์ บันทึกกายภาพ)");
        const o = await residentOf(me, String(b.residentId ?? ""));
        if (!o.r) return o.res;
        const title = text(b.title, 200), body = text(b.body, 4000);
        if (!title && !body) return bad("กรุณากรอกรายละเอียดบันทึก");
        const id = randomUUID();
        await sql`INSERT INTO clinical_notes (id, resident_id, resident_name, branch_name, kind, title, body, data, status, author)
                  VALUES (${id}, ${o.r.id}, ${o.r.full_name}, ${o.r.branch_name}, ${kind}, ${title || null}, ${body || null}, ${JSON.stringify(obj(b.data))}::jsonb, ${text(b.status, 40) || null}, ${me.name})`;
        await audit(req, me, [{ area: "clinical", action: "create", recordId: id, summary: `${kind} · ${o.r.full_name}${title ? ` · ${title}` : ""}`, branch: o.r.branch_name }]);
        return NextResponse.json({ ok: true, id });
      }
      case "note_status": case "note_delete": {
        if (!canRead(me)) return forbidden();
        const [n] = (await sql`SELECT id, resident_name, branch_name, author, kind FROM clinical_notes WHERE id = ${String(b.id ?? "")}`) as Record<string, string>[];
        if (!n) return bad("ไม่พบบันทึก", 404);
        if (scoped(me) && n.branch_name !== me.branch) return forbidden();
        if (b.op === "note_delete") {
          if (n.author !== me.name && !canManage(me)) return forbidden("ลบได้เฉพาะบันทึกที่ตัวเองเขียน");
          await sql`DELETE FROM clinical_notes WHERE id = ${n.id}`;
          await audit(req, me, [{ area: "clinical", action: "delete", recordId: n.id, summary: `${n.kind} · ${n.resident_name}`, branch: n.branch_name }]);
        } else {
          await sql`UPDATE clinical_notes SET status = ${text(b.status, 40)}, updated_at = now() WHERE id = ${n.id}`;
        }
        return NextResponse.json({ ok: true });
      }
      case "course": {
        // ขายคอร์ส = ผู้มีสิทธิ์ใบแจ้งหนี้และใบเสร็จ (ผู้จัดการสาขา ผู้บริหาร ฝ่ายขาย/แคชเชียร์) · ซื้อแล้วออกใบแจ้งหนี้ต่อได้ทันที
        if (!can(me, "billing")) return forbidden("ขายคอร์สได้เฉพาะผู้จัดการสาขาหรือฝ่ายขาย");
        const o = await residentOf(me, String(b.residentId ?? ""));
        if (!o.r) return o.res;
        const total = Math.floor(Number(b.total)), price = Math.max(0, Number(b.price) || 0), why = text(b.freeReason, 200);
        let name = text(b.name, 120);
        if (!name || !(total > 0 && total <= 500)) return bad("กรุณากรอกชื่อคอร์สและจำนวนครั้ง (1–500)");
        // คอร์สฟรีปลดล็อกการบันทึกกายภาพโดยไม่ต้องออกใบแจ้งหนี้ · อนุญาตเฉพาะผู้จัดการพร้อมเหตุผล
        if (!price) {
          if (!isBoss(me)) return bad("กรุณากรอกราคาคอร์ส · คอร์สฟรีต้องให้ผู้จัดการสาขาเป็นผู้บันทึก");
          if (!why) return bad("กรุณาระบุเหตุผลที่ให้คอร์สฟรี");
          name = `${name} (ฟรี: ${why})`.slice(0, 200);
        }
        const id = randomUUID();
        await sql`INSERT INTO physio_courses (id, resident_id, resident_name, branch_name, name, total, price, created_by) VALUES (${id}, ${o.r.id}, ${o.r.full_name}, ${o.r.branch_name}, ${name}, ${total}, ${price}, ${me.name})`;
        await audit(req, me, [{ area: "physio", action: "create", recordId: id, summary: `คอร์ส ${name} ${total} ครั้ง · ${o.r.full_name}`, branch: o.r.branch_name }]);
        return NextResponse.json({ ok: true, id });
      }
      case "course_use": {
        if (!can(me, "physio.record")) return forbidden("บันทึกกายภาพได้เฉพาะนักกายภาพ (สิทธิ์ บันทึกกายภาพ)");
        const [c] = (await sql(`SELECT *, ${unbilledSql("invoice_id")} AS unbilled FROM physio_courses WHERE id = $1`, [String(b.courseId ?? "")])) as Record<string, string & number>[];
        if (!c) return bad("ไม่พบคอร์ส", 404);
        if (scoped(me) && c.branch_name !== me.branch && !inTeam(c, me.id)) return forbidden();
        // นักกายภาพ: ต้องเช็คอิน (รูปข้างเตียง) ก่อน และส่งรูปงานตอนบันทึก · ผู้จัดการที่บันทึกจากระบบจัดการไม่บังคับ
        // รูปงาน 1–10 รูป (เก็บเป็น JSON array ในช่อง work_photo)
        const photos = (Array.isArray(b.photos) ? b.photos : [b.photo]).map(imgOf).filter(Boolean).slice(0, 10);
        const visitId = text(b.visitId, 80), workPhoto = photos.length ? JSON.stringify(photos) : "";
        if (me.role === "Physio" || visitId) {
          const [v] = (await sql`SELECT id FROM physio_visits WHERE id = ${visitId} AND course_id = ${c.id} AND note_id IS NULL AND therapist_id = ${me.id}`) as { id: string }[];
          if (!v) return bad("กรุณาเช็คอิน (ถ่ายรูปข้างเตียง) ก่อนบันทึกกายภาพ");
          if (!workPhoto) return bad("กรุณาถ่ายรูปงานก่อนบันทึก");
        }
        // ซื้อคอร์สแล้วทำกายภาพได้ทันที ไม่ต้องรอใบแจ้งหนี้ (หน้าจอบอกสถานะ: ยังไม่ออกใบ / รอชำระ / ชำระแล้ว)
        // ตัดครั้งในคำสั่งเดียว กันสองเครื่องกดพร้อมกันจนเกินจำนวน
        const done = (await sql`UPDATE physio_courses SET used = used + 1, status = CASE WHEN used + 1 >= total THEN 'ครบแล้ว' ELSE status END
                                WHERE id = ${c.id} AND used < total RETURNING used, total`) as { used: number; total: number }[];
        if (!done.length) return bad("คอร์สนี้ใช้ครบจำนวนครั้งแล้ว", 409);
        const id = randomUUID();
        await sql`INSERT INTO clinical_notes (id, resident_id, resident_name, branch_name, kind, title, body, data, author)
                  VALUES (${id}, ${c.resident_id}, ${c.resident_name}, ${c.branch_name}, 'physio', ${`${c.name} ครั้งที่ ${done[0].used}/${done[0].total}`}, ${text(b.body, 4000) || null},
                          ${JSON.stringify({ ...obj(b.data), course_id: c.id, session: done[0].used })}::jsonb, ${me.name})`;
        if (visitId) await sql`UPDATE physio_visits SET note_id = ${id}, work_photo = ${workPhoto}, done_at = now() WHERE id = ${visitId} AND note_id IS NULL`;
        await audit(req, me, [{ area: "physio", action: "update", recordId: c.id, summary: `ใช้คอร์ส ${c.name} ครั้งที่ ${done[0].used}/${done[0].total} · ${c.resident_name}`, branch: c.branch_name }]);
        return NextResponse.json({ ok: true, used: done[0].used, total: done[0].total });
      }
      case "physio_checkin": {
        if (!can(me, "physio.record")) return forbidden("เช็คอินกายภาพได้เฉพาะนักกายภาพ");
        const [c] = (await sql`SELECT id, resident_id, resident_name, branch_name, name, used, total, therapist_id, plan_slots, plan_days, plan_dates FROM physio_courses WHERE id = ${String(b.courseId ?? "")}`) as Record<string, string & number>[];
        if (!c) return bad("ไม่พบคอร์ส", 404);
        if (scoped(me) && c.branch_name !== me.branch && !inTeam(c, me.id)) return forbidden("เคสนี้อยู่ต่างสาขาและไม่ได้จ่ายให้คุณ");
        if (onlyMine(me)) {
          const cc = c as unknown as { therapist_id: string | null; plan_slots: PlanSlots | null; plan_days: number[] | null; plan_dates: string[] | null };
          const [{ d: todayIso }] = (await sql(`SELECT ${BKK_TODAY}::text AS d`)) as { d: string }[];
          if (!onDate(schedOf(cc), todayIso) || whoOn({ ...cc, therapist_name: null }, todayIso)?.id !== me.id)
            return forbidden("วันนี้ไม่ใช่นัดของคุณ · ถ้าต้องทำแทน ให้ผู้จัดการหรือฝ่ายขายจัดคนทำแทนให้ก่อน");
        }
        if (Number(c.used) >= Number(c.total)) return bad("คอร์สนี้ใช้ครบจำนวนครั้งแล้ว", 409);
        const photo = imgOf(b.photo);
        if (!photo) return bad("กรุณาถ่ายรูปเช็คอิน");
        // เช็คอินซ้ำวันเดียวกัน (ยังไม่บันทึก) = ถ่ายรูปใหม่และเริ่มเวลาใหม่
        const again = (await sql(`UPDATE physio_visits SET checkin_photo = $1, checkin_at = now() WHERE course_id = $2 AND therapist_id = $3 AND note_id IS NULL
            AND (checkin_at AT TIME ZONE 'Asia/Bangkok')::date = ${BKK_TODAY} RETURNING id, ${HM("checkin_at")} AS at`, [photo, c.id, me.id])) as { id: string; at: string }[];
        const row = again[0] ?? ((await sql(`INSERT INTO physio_visits (id, course_id, resident_id, resident_name, branch_name, therapist_id, therapist_name, checkin_photo)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, ${HM("checkin_at")} AS at`, [randomUUID(), c.id, c.resident_id, c.resident_name, c.branch_name, me.id, me.name, photo])) as { id: string; at: string }[])[0];
        await audit(req, me, [{ area: "physio", action: "update", recordId: c.id, summary: `เช็คอินกายภาพ ${c.resident_name} · ${c.name} ครั้งที่ ${Number(c.used) + 1}/${c.total} · ${row.at}`, branch: c.branch_name }]);
        return NextResponse.json({ ok: true, visitId: row.id, at: row.at });
      }
      case "physio_checkin_cancel": {
        if (!can(me, "physio.record")) return forbidden();
        const gone = (await sql`DELETE FROM physio_visits WHERE id = ${text(b.visitId, 80)} AND therapist_id = ${me.id} AND note_id IS NULL RETURNING course_id, resident_name, branch_name`) as { course_id: string; resident_name: string; branch_name: string }[];
        if (!gone.length) return bad("ไม่พบเช็คอินที่ยกเลิกได้", 404);
        await audit(req, me, [{ area: "physio", action: "delete", recordId: gone[0].course_id, summary: `ยกเลิกเช็คอินกายภาพ ${gone[0].resident_name}`, branch: gone[0].branch_name }]);
        return NextResponse.json({ ok: true });
      }
      case "course_reassign": {
        if (!can(me, "physio.assign")) return forbidden("บัญชีนี้ไม่มีสิทธิ์จ่ายเคสกายภาพ");
        const from = text(b.fromId, 80), to = text(b.toId, 80);
        if (!from || !to || from === to) return bad("กรุณาเลือกนักกายภาพที่จะรับเคสแทน");
        const [t] = (await sql`SELECT full_name FROM staff_users WHERE id = ${to}`) as { full_name: string }[];
        if (!t) return bad("ไม่พบนักกายภาพที่จะรับเคส", 404);
        // ย้ายเฉพาะเคสที่ยังเหลือครั้ง · ผู้ที่ไม่ใช่ผู้บริหาร = เฉพาะสาขาตัวเอง · ผู้บริหารเลือกสาขาได้ (ว่าง = ทุกสาขา)
        // ผู้รับผิดชอบหลัก = from → to · คนทำประจำวัน/ทำแทน (plan_slots) ที่เป็น from → to · คนที่กลายเป็นคนเดียวกับผู้รับผิดชอบหลักไม่ต้องเก็บซ้ำ
        const rbr = scoped(me) ? me.branch : text(b.branch, 80) || null;
        const list = (await sql(`SELECT id, name, resident_name, branch_name, therapist_id, therapist_name, plan_slots FROM physio_courses
            WHERE used < total AND (therapist_id = $1 OR ${slotHas("plan_slots", "$1")}) ${rbr ? "AND branch_name = $2" : ""}`, rbr ? [from, rbr] : [from])) as { id: string; name: string; resident_name: string; branch_name: string; therapist_id: string | null; therapist_name: string | null; plan_slots: PlanSlots | null }[];
        const swap = (m: Record<string, { id: string; name: string }> | undefined, owner: string | null) => {
          const out = Object.fromEntries(Object.entries(m ?? {}).map(([k, v]) => [k, v.id === from ? { id: to, name: t.full_name } : v]).filter(([, v]) => (v as { id: string }).id !== owner));
          return Object.keys(out).length ? out : undefined;
        };
        const moved: typeof list = [];
        for (const k of list) {
          const owner = k.therapist_id === from ? to : k.therapist_id, oname = k.therapist_id === from ? t.full_name : k.therapist_name;
          const dow = swap(k.plan_slots?.dow, owner), date = swap(k.plan_slots?.date, owner);
          const skip = k.plan_slots?.skip?.length ? k.plan_slots.skip : undefined;
          const rqk = Object.fromEntries(Object.entries(k.plan_slots?.req ?? {}).filter(([, v]) => v.by.id !== from));
          const req = Object.keys(rqk).length ? rqk : undefined;
          const tm = (k.plan_slots?.team ?? []).map((v) => (v.id === from ? { id: to, name: t.full_name } : v)).filter((v, i, arr) => arr.findIndex((y) => y.id === v.id) === i);
          const team = tm.length > 1 ? tm : undefined;
          const slots = dow || date || skip || req || team ? { ...(dow ? { dow } : {}), ...(date ? { date } : {}), ...(skip ? { skip } : {}), ...(req ? { req } : {}), ...(team ? { team } : {}) } : null;
          await sql`UPDATE physio_courses SET therapist_id = ${owner}, therapist_name = ${oname}, plan_slots = ${slots ? JSON.stringify(slots) : null}::jsonb WHERE id = ${k.id}`;
          moved.push(k);
        }
        if (!moved.length) return bad("ไม่มีเคสที่ย้ายได้", 404);
        const [f0] = (await sql`SELECT full_name FROM staff_users WHERE id = ${from}`) as { full_name: string }[];
        await audit(req, me, moved.map((m) => ({ area: "physio", action: "update", recordId: m.id, branch: m.branch_name,
          summary: `จ่ายเคสกายภาพ ${m.name} · ${m.resident_name}: ย้ายจาก ${f0?.full_name ?? "-"} → ${t.full_name} (ย้ายเคสทั้งหมด)` })));
        await Promise.all([
          pushTo([to], { title: `ได้รับเคสกายภาพเพิ่ม ${moved.length} เคส`, body: `ย้ายมาจาก ${f0?.full_name ?? "-"} · ${moved.slice(0, 3).map((m) => m.resident_name).join(", ")}${moved.length > 3 ? " …" : ""}`, url: "/staff", tag: "physio-reassign" }),
          pushTo([from], { title: `เคสกายภาพถูกย้าย ${moved.length} เคส`, body: `ย้ายไปให้ ${t.full_name}`, url: "/staff", tag: "physio-reassign" }),
        ]);
        return NextResponse.json({ ok: true, moved: moved.length });
      }
      case "course_close": {
        // ปิดคอร์ส: total = ครั้งที่ใช้ไปแล้ว (หายจากทุกรายการคอร์สที่ยังเหลือครั้ง) · เก็บจำนวนเดิมและเหตุผลไว้ในชื่อคอร์ส (แบบเดียวกับคอร์สฟรี) · ล้างนัดและทีม
        // ผู้จัดการสาขา ผู้บริหาร ฝ่ายขาย/แคชเชียร์ (สิทธิ์ใบแจ้งหนี้และใบเสร็จ) · เก็บชื่อผู้ปิด วันที่ไทย และเวลาไว้กับคอร์ส
        if (!can(me, "billing")) return forbidden("ปิดคอร์สได้เฉพาะผู้จัดการสาขาหรือฝ่ายขาย");
        const why = text(b.reason, 200);
        if (!why) return bad("กรุณาระบุเหตุผลที่ปิดคอร์ส");
        const [c] = (await sql`SELECT id, name, resident_name, branch_name, used, total, therapist_id, therapist_name, plan_slots, plan_days, plan_dates, plan_time, plan_minutes FROM physio_courses WHERE id = ${String(b.courseId ?? "")}`) as { id: string; name: string; resident_name: string; branch_name: string; used: number; total: number; therapist_id: string | null; therapist_name: string | null; plan_slots: PlanSlots | null; plan_days: number[] | null; plan_dates: string[] | null; plan_time: string | null; plan_minutes: number | null }[];
        if (!c) return bad("ไม่พบคอร์ส", 404);
        if (scoped(me) && c.branch_name !== me.branch) return forbidden();
        if (c.used >= c.total) return bad("คอร์สนี้ใช้ครบหรือปิดไปแล้ว", 409);
        if (c.used === 0) return bad("คอร์สนี้ยังไม่เคยใช้ · ใช้ปุ่ม ยกเลิกคอร์ส แทน (ถ้าออกใบแจ้งหนี้แล้ว ให้แคชเชียร์ยกเลิกใบก่อน)", 409);
        const left = c.total - c.used;
        const name = `${c.name} (ปิดคอร์ส: ${why.replace(/[()]/g, "")} · ซื้อ ${c.total} ครั้ง ใช้ ${c.used} · ปิดโดย ${me.name} ${thNowText()})`.slice(0, 400);
        const done = (await sql`UPDATE physio_courses SET total = used, status = 'ปิดคอร์ส', name = ${name}, plan_days = NULL, plan_dates = NULL, plan_slots = NULL, plan_time = NULL, plan_minutes = NULL
            WHERE id = ${c.id} AND used < total AND used = ${c.used} RETURNING id`) as { id: string }[];
        if (!done.length) return bad("คอร์สเพิ่งมีการบันทึก · กรุณาเปิดใหม่แล้วลองอีกครั้ง", 409);
        const team = teamOf(c);
        if (team.length) await pushTo(team.map((t) => t.id), { title: "ปิดคอร์สกายภาพ", body: `${c.resident_name} · ยกเลิกนัดที่เหลือ ${left} ครั้ง · ${why}`, url: "/staff", tag: `physio-${c.id}` });
        await audit(req, me, [{ area: "physio", action: "update", recordId: c.id, branch: c.branch_name,
          summary: `ปิดคอร์ส ${c.name} · ${c.resident_name}: ใช้ ${c.used}/${c.total} · ยกเลิก ${left} ครั้ง · เหตุผล ${why}`,
          before: { name: c.name, total: c.total, used: c.used, therapist: c.therapist_name, days: c.plan_days, dates: c.plan_dates, time: c.plan_time, team: c.plan_slots }, after: { name, total: c.used, status: "ปิดคอร์ส" } }]);
        return NextResponse.json({ ok: true, left });
      }
      case "slot_request": {
        // นักกายภาพขอคนแทนนัดของตัวเอง (ป่วย ลา ติดงาน) · แจ้งผู้จัดการ/ฝ่ายขายของสาขา · cancel = ถอนคำขอของตัวเอง
        if (!can(me, "physio.record")) return forbidden("ขอคนแทนได้เฉพาะนักกายภาพ");
        const [c] = (await sql`SELECT id, name, resident_name, branch_name, therapist_id, therapist_name, plan_days, plan_dates, plan_time, plan_slots FROM physio_courses WHERE id = ${String(b.courseId ?? "")} AND used < total`) as { id: string; name: string; resident_name: string; branch_name: string; therapist_id: string | null; therapist_name: string | null; plan_days: number[] | null; plan_dates: string[] | null; plan_time: string | null; plan_slots: PlanSlots | null }[];
        if (!c || !c.therapist_id) return bad("ไม่พบนัดนี้", 404);
        const date = String(b.date ?? ""), cancel = b.cancel === true;
        const [{ d: todayIso }] = (await sql(`SELECT ${BKK_TODAY}::text AS d`)) as { d: string }[];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < todayIso || !onDate(schedOf(c), date)) return bad("ขอคนแทนได้เฉพาะนัดวันนี้หรือวันข้างหน้า");
        const rq = { ...(c.plan_slots?.req ?? {}) };
        if (cancel) {
          if (rq[date]?.by.id !== me.id) return forbidden("ถอนได้เฉพาะคำขอของคุณ");
          delete rq[date];
        } else {
          if (whoOn(c, date)?.id !== me.id) return forbidden("ขอคนแทนได้เฉพาะนัดของคุณ");
          const reason = text(b.reason, 200);
          if (!reason) return bad("กรุณาระบุเหตุผลที่ขอคนแทน");
          rq[date] = { by: { id: me.id, name: me.name }, reason, at: thNowText() };
        }
        const { req: _old, ...rest } = c.plan_slots ?? {};
        const slots = { ...rest, ...(Object.keys(rq).length ? { req: rq } : {}) };
        await sql`UPDATE physio_courses SET plan_slots = ${Object.keys(slots).length ? JSON.stringify(slots) : null}::jsonb WHERE id = ${c.id}`;
        const when = `${["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."][dowOf(date)]} ${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))} ${c.plan_time ?? ""} น.`;
        if (!cancel) {
          // คนที่จัดคนแทนได้ในสาขา: ผู้จัดการสาขา ฝ่ายขาย/แคชเชียร์ หรือคนที่ได้สิทธิ์จ่ายเคสรายคน
          const boss = (await sql`SELECT id FROM staff_users WHERE coalesce(status, 'ทำงาน') = 'ทำงาน' AND branch_name = ${c.branch_name}
              AND (access_level IN ('Branch Admin', 'Cashier') OR 'physio.assign' = ANY(coalesce(permissions, '{}')))`) as { id: string }[];
          if (boss.length) await pushTo(boss.map((x) => x.id), { title: "ขอคนแทนกายภาพ", body: `${me.name} · ${c.resident_name} · ${when} · ${rq[date].reason}`, url: "/", tag: `physio-req-${c.id}-${date}` });
        }
        await audit(req, me, [{ area: "physio", action: "update", recordId: c.id, branch: c.branch_name,
          summary: cancel ? `ถอนคำขอคนแทนกายภาพ ${c.resident_name} วันที่ ${date}` : `ขอคนแทนกายภาพ ${c.resident_name} วันที่ ${date}: ${rq[date].reason}` }]);
        return NextResponse.json({ ok: true });
      }
      case "slot_cancel": {
        // ยกเลิกนัดวันเดียว (เลือกวันผิด / ผู้รับบริการไม่สะดวก) · วันอื่นไม่เปลี่ยน · ไม่นับเป็นการจ่ายเคสใหม่
        if (!can(me, "physio.assign")) return forbidden("บัญชีนี้ไม่มีสิทธิ์จ่ายเคสกายภาพ");
        const [c] = (await sql`SELECT id, name, resident_name, branch_name, therapist_id, therapist_name, plan_days, plan_dates, plan_time, plan_slots FROM physio_courses WHERE id = ${String(b.courseId ?? "")} AND used < total`) as { id: string; name: string; resident_name: string; branch_name: string; therapist_id: string | null; therapist_name: string | null; plan_days: number[] | null; plan_dates: string[] | null; plan_time: string | null; plan_slots: PlanSlots | null }[];
        if (!c || !c.therapist_id) return bad("ไม่พบคอร์สที่จ่ายเคสแล้ว", 404);
        if (scoped(me) && c.branch_name !== me.branch) return forbidden();
        const date = String(b.date ?? "");
        const [{ d: todayIso }] = (await sql(`SELECT ${BKK_TODAY}::text AS d`)) as { d: string }[];
        const explicitPlan = !!c.plan_dates?.length;
        const onPlan = explicitPlan ? c.plan_dates!.includes(date) : !!c.plan_days?.includes(dowOf(date)) && !c.plan_slots?.skip?.includes(date);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < todayIso || !onPlan) return bad("ยกเลิกได้เฉพาะนัดวันนี้หรือวันข้างหน้า");
        const who = whoOn(c, date);
        const dmap = { ...(c.plan_slots?.date ?? {}) }; delete dmap[date];
        const skip = explicitPlan ? (c.plan_slots?.skip ?? []) : [...new Set([...(c.plan_slots?.skip ?? []), date])].filter((d) => d >= todayIso).sort();
        const rq = { ...(c.plan_slots?.req ?? {}) }; delete rq[date];
        const slots = { ...(c.plan_slots?.dow ? { dow: c.plan_slots.dow } : {}), ...(Object.keys(dmap).length ? { date: dmap } : {}), ...(skip.length ? { skip } : {}), ...(Object.keys(rq).length ? { req: rq } : {}), ...(c.plan_slots?.team?.length ? { team: c.plan_slots.team } : {}) };
        const dates = explicitPlan ? c.plan_dates!.filter((d) => d !== date) : null;
        await sql`UPDATE physio_courses SET plan_dates = ${explicitPlan ? (dates!.length ? dates : null) : c.plan_dates}, plan_slots = ${Object.keys(slots).length ? JSON.stringify(slots) : null}::jsonb WHERE id = ${c.id}`;
        const when = `${["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."][dowOf(date)]} ${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))} ${c.plan_time ?? ""} น.`;
        if (who) await pushTo([who.id], { title: "ยกเลิกนัดกายภาพ", body: `${c.resident_name} · ${when}`, url: "/staff", tag: `physio-${c.id}-${date}` });
        await audit(req, me, [{ area: "physio", action: "update", recordId: c.id, branch: c.branch_name,
          summary: `ยกเลิกนัดกายภาพ ${c.resident_name} วันที่ ${date} (${who?.name ?? "-"})`, before: { date, therapist: who?.name ?? null }, after: { date, cancelled: true } }]);
        return NextResponse.json({ ok: true });
      }
      case "physio_edit": {
        // แก้ไขบันทึกกายภาพ: ผู้บันทึก หรือผู้จัดการสาขา · แก้เนื้อหา สัญญาณชีพ ผลการทำ และนาทีที่ทำ · จำนวนครั้ง รูป และเวลาบันทึกเดิมไม่เปลี่ยน
        const [n] = (await sql`SELECT id, resident_name, branch_name, author, title, body, data, created_at > now() - interval '7 days' AS fresh FROM clinical_notes WHERE id = ${text(b.id, 80)} AND kind = 'physio'`) as { id: string; resident_name: string; branch_name: string; author: string | null; title: string | null; body: string | null; data: Record<string, unknown>; fresh: boolean }[];
        if (!n) return bad("ไม่พบบันทึกกายภาพ", 404);
        if (!n.fresh) return bad("แก้ไขได้ภายใน 7 วันหลังบันทึกเท่านั้น", 409);
        if (n.author !== me.name && !isBoss(me)) return forbidden("แก้ไขได้เฉพาะผู้บันทึก หรือผู้จัดการสาขา");
        if (scoped(me) && n.branch_name !== me.branch && n.author !== me.name) return forbidden();
        const d = obj(b.data), KEYS = ["pain", "plan", "mobility", "activities", "vitals", "cc", "pe", "dx"] as const;
        const changed: Record<string, unknown> = Object.fromEntries(KEYS.filter((k) => k in d).map((k) => [k, d[k]]));
        const mins = Number(d.minutes);
        if (d.minutes !== undefined && d.minutes !== null && d.minutes !== "") {
          if (!(Number.isInteger(mins) && mins > 0 && mins <= 300)) return bad("ระยะเวลาที่ทำต้องเป็น 1–300 นาที");
          changed.minutes_fixed = mins;
        }
        const stamp = new Date(Date.now() + 7 * 36e5).toISOString().slice(0, 16).replace("T", " ");
        const next = { ...(n.data ?? {}), ...changed, edited_at: stamp, edited_by: me.name };
        const body = text(b.body, 4000) || null;
        await sql`UPDATE clinical_notes SET body = ${body}, data = ${JSON.stringify(next)}::jsonb, updated_at = now() WHERE id = ${n.id}`;
        const before = Object.fromEntries(Object.keys(changed).map((k) => [k, (n.data ?? {})[k] ?? null]));
        await audit(req, me, [{ area: "physio", action: "update", recordId: n.id, branch: n.branch_name,
          summary: `แก้ไขบันทึกกายภาพ ${n.title ?? ""} · ${n.resident_name}${n.author && n.author !== me.name ? ` (บันทึกโดย ${n.author})` : ""}`, before: { ...before, body: n.body }, after: { ...changed, body } }]);
        return NextResponse.json({ ok: true });
      }
      case "slot_set": {
        // คนทำแทนเฉพาะนัดวันนั้น (ลา / สลับเวร) · ไม่เปลี่ยนแผนทั้งคอร์ส · ไม่นับเป็นการจ่ายเคสใหม่ (วันเริ่มนับ "ไม่ได้ทำ" คงเดิม)
        if (!can(me, "physio.assign")) return forbidden("บัญชีนี้ไม่มีสิทธิ์จ่ายเคสกายภาพ");
        const [c] = (await sql`SELECT id, name, resident_name, branch_name, therapist_id, therapist_name, plan_days, plan_dates, plan_time, plan_slots FROM physio_courses WHERE id = ${String(b.courseId ?? "")} AND used < total`) as { id: string; name: string; resident_name: string; branch_name: string; therapist_id: string | null; therapist_name: string | null; plan_days: number[] | null; plan_dates: string[] | null; plan_time: string | null; plan_slots: PlanSlots | null }[];
        if (!c || !c.therapist_id) return bad("ไม่พบคอร์สที่จ่ายเคสแล้ว", 404);
        if (scoped(me) && c.branch_name !== me.branch) return forbidden();
        const date = String(b.date ?? "");
        const [{ d: todayIso }] = (await sql(`SELECT ${BKK_TODAY}::text AS d`)) as { d: string }[];
        const onPlan = c.plan_dates?.length ? c.plan_dates.includes(date) : !!c.plan_days?.includes(dowOf(date));
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < todayIso || !onPlan) return bad("เลือกได้เฉพาะนัดวันนี้หรือวันข้างหน้า");
        const tid = text(b.therapistId, 80);
        const base = c.plan_slots?.dow?.[String(dowOf(date))] ?? { id: c.therapist_id, name: c.therapist_name ?? "-" };
        const prev = c.plan_slots?.date?.[date] ?? base;
        let next = base;
        if (tid && tid !== base.id) {
          const [t] = (await sql`SELECT full_name FROM staff_users WHERE id = ${tid}`) as { full_name: string }[];
          if (!t) return bad("ไม่พบนักกายภาพ", 404);
          next = { id: tid, name: t.full_name };
        }
        const dmap = { ...(c.plan_slots?.date ?? {}) };
        if (next.id === base.id) delete dmap[date]; else dmap[date] = next;
        // จัดคนทำแทนแล้ว (หรือกลับเป็นคนประจำ) = ปิดคำขอคนแทนของวันนั้น
        const rq = { ...(c.plan_slots?.req ?? {}) }; delete rq[date];
        const slots = { ...(c.plan_slots?.dow ? { dow: c.plan_slots.dow } : {}), ...(Object.keys(dmap).length ? { date: dmap } : {}), ...(c.plan_slots?.skip?.length ? { skip: c.plan_slots.skip } : {}), ...(Object.keys(rq).length ? { req: rq } : {}), ...(c.plan_slots?.team?.length ? { team: c.plan_slots.team } : {}) };
        await sql`UPDATE physio_courses SET plan_slots = ${Object.keys(slots).length ? JSON.stringify(slots) : null}::jsonb WHERE id = ${c.id}`;
        if (prev.id !== next.id) {
          const when = `${["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."][dowOf(date)]} ${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))} ${c.plan_time ?? ""} น.`;
          await Promise.all([
            pushTo([next.id], { title: next.id === base.id ? "กลับมาทำนัดกายภาพ" : "ทำแทนกายภาพ", body: `${c.resident_name} · ${when}`, url: "/staff", tag: `physio-${c.id}-${date}` }),
            pushTo([prev.id], { title: "นัดกายภาพมีคนทำแทน", body: `${c.resident_name} · ${when} · ${next.name} ทำแทน`, url: "/staff", tag: `physio-${c.id}-${date}` }),
          ]);
          await audit(req, me, [{ area: "physio", action: "update", recordId: c.id, branch: c.branch_name,
            summary: `ทำแทนกายภาพ ${c.resident_name} วันที่ ${date}: ${prev.name} → ${next.name}`, before: { date, therapist: prev.name }, after: { date, therapist: next.name } }]);
        }
        return NextResponse.json({ ok: true });
      }
      case "course_plan": {
        if (!can(me, "physio.assign")) return forbidden("บัญชีนี้ไม่มีสิทธิ์จ่ายเคสกายภาพ");
        const [c] = (await sql`SELECT id, resident_name, branch_name, name, total, used, therapist_id, therapist_name, plan_days, plan_time, plan_minutes, plan_dates, plan_slots FROM physio_courses WHERE id = ${String(b.courseId ?? "")}`) as Record<string, unknown>[];
        if (!c) return bad("ไม่พบคอร์ส", 404);
        if (scoped(me) && c.branch_name !== me.branch) return forbidden();
        const tid = text(b.therapistId, 80);
        let tname: string | null = null;
        if (tid) {
          const [t] = (await sql`SELECT full_name, branch_name FROM staff_users WHERE id = ${tid}`) as { full_name: string; branch_name: string | null }[];
          if (!t) return bad("ไม่พบนักกายภาพ", 404);
          tname = t.full_name;
        }
        const days = [...new Set((Array.isArray(b.days) ? b.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
        const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.time ?? "")) ? String(b.time) : null;
        const minutes = Math.min(180, Math.max(15, Math.round(Number(b.minutes) || 45)));
        // เลือกวันเอง: วันที่ YYYY-MM-DD ไม่ซ้ำ เรียงตามวัน ไม่เกินจำนวนครั้งที่เหลือ (เกินตัดท้าย) · มีวันที่ = ไม่ใช้แผนรายสัปดาห์
        const left = Math.max(0, Number(c.total) - Number(c.used));
        const dates = [...new Set((Array.isArray(b.dates) ? b.dates : []).map(String).filter((d) => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d) && !Number.isNaN(Date.parse(d))))].sort().slice(0, Math.min(100, left || 100));
        const weekly = dates.length ? [] : days;
        if (tid && ((!weekly.length && !dates.length) || !time)) return bad("กรุณาเลือกวันและเวลาที่ทำกายภาพ");
        // ทีม: คนทำประจำวัน (dow "0"–"6" → รหัส) เฉพาะวันที่อยู่ในแผน และไม่ใช่ผู้รับผิดชอบหลัก · คนทำแทนเฉพาะวัน (date) ที่ยังไม่ถึงและยังอยู่ในแผน = คงไว้
        const planDow = new Set((dates.length ? dates.map(dowOf) : weekly).map(String));
        const want = tid ? Object.entries((b.slots && typeof b.slots === "object" ? (b.slots as { dow?: Record<string, unknown> }).dow : null) ?? {})
          .map(([k, v]) => [k, text(v, 80)] as const).filter(([k, v]) => planDow.has(k) && v && v !== tid) : [];
        // ทีมประจำเคส (ติ๊กหลายคน · รวมผู้รับผิดชอบหลัก) ไม่เกิน 8 คน
        const crewIds = tid ? [...new Set([tid, ...(Array.isArray((b.slots as { team?: unknown })?.team) ? ((b.slots as { team: unknown[] }).team.map((x) => text(x, 80)).filter(Boolean)) : [])])].slice(0, 8) : [];
        const lookup = [...new Set([...want.map(([, v]) => v), ...crewIds.filter((x) => x !== tid)])];
        const names = lookup.length ? new Map(((await sql`SELECT id, full_name FROM staff_users WHERE id = ANY(${lookup})`) as { id: string; full_name: string }[]).map((x) => [x.id, x.full_name])) : new Map<string, string>();
        if (lookup.some((v) => !names.has(v))) return bad("ไม่พบนักกายภาพบางคนในทีม", 404);
        const crew = crewIds.map((id) => ({ id, name: id === tid ? tname ?? "-" : names.get(id)! }));
        const oldSlots = (c.plan_slots ?? null) as PlanSlots | null;
        const [{ d: todayIso }] = (await sql(`SELECT ${BKK_TODAY}::text AS d`)) as { d: string }[];
        const keepDate = Object.fromEntries(Object.entries(oldSlots?.date ?? {}).filter(([d]) => tid && d >= todayIso && (dates.length ? dates.includes(d) : weekly.includes(dowOf(d)))));
        const dow = Object.fromEntries(want.map(([k, v]) => [k, { id: v, name: names.get(v)! }]));
        const keepSkip = (oldSlots?.skip ?? []).filter((d) => tid && !dates.length && d >= todayIso && weekly.includes(dowOf(d)));
        const keepReq = Object.fromEntries(Object.entries(oldSlots?.req ?? {}).filter(([d]) => tid && d >= todayIso && (dates.length ? dates.includes(d) : weekly.includes(dowOf(d)))));
        const slots: PlanSlots | null = Object.keys(dow).length || Object.keys(keepDate).length || keepSkip.length || Object.keys(keepReq).length || crew.length > 1
          ? { ...(Object.keys(dow).length ? { dow } : {}), ...(Object.keys(keepDate).length ? { date: keepDate } : {}), ...(keepSkip.length ? { skip: keepSkip } : {}), ...(Object.keys(keepReq).length ? { req: keepReq } : {}), ...(crew.length > 1 ? { team: crew } : {}) } : null;
        await sql`UPDATE physio_courses SET therapist_id = ${tid || null}, therapist_name = ${tname}, plan_days = ${weekly.length ? weekly : null}, plan_dates = ${tid && dates.length ? dates : null},
                  plan_time = ${time}, plan_minutes = ${tid ? minutes : null}, plan_slots = ${slots ? JSON.stringify(slots) : null}::jsonb WHERE id = ${c.id as string}`;
        const DAY = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
        const was = c.therapist_name ? `${c.therapist_name}` : "ยังไม่มีผู้รับผิดชอบ";
        const teamNote = `${Object.keys(dow).length ? ` · ประจำวัน: ${Object.entries(dow).map(([k, v]) => `${DAY[Number(k)]} ${v.name}`).join(", ")}` : ""}${crew.length > 1 ? ` · ทีมประจำเคส: ${crew.map((x) => x.name).join(", ")}` : ""}`;
        const now = tname ? `${tname} · ${dates.length ? `เลือกวันเอง ${dates.length} วัน (${dates[0]} ถึง ${dates[dates.length - 1]})` : weekly.map((d) => DAY[d]).join(" ")} ${time} (${minutes} นาที)${teamNote}` : "ยังไม่มีผู้รับผิดชอบ";
        // แจ้งเตือนมือถือ (ข้อความสั้น เห็นบนหน้าจอล็อก): คนที่เพิ่งเข้าทีม = ได้เคส · คนเดิมที่ยังอยู่ = เปลี่ยนนัด · คนที่ออกจากทีม = เคสถูกย้าย
        const oldTeam = teamOf({ therapist_id: c.therapist_id as string | null, therapist_name: c.therapist_name as string | null, plan_slots: oldSlots });
        const newTeam = tid ? teamOf({ therapist_id: tid, therapist_name: tname, plan_slots: slots }) : [];
        const daysOf = (id: string) => { if (dates.length) { const n = dates.filter((d) => (keepDate[d]?.id ?? dow[String(dowOf(d))]?.id ?? tid) === id).length; return n ? `${n} วันที่เลือก` : ""; } return weekly.filter((x) => (dow[String(x)]?.id ?? tid) === id).map((x) => DAY[x]).join(" "); };
        const pushes: Promise<number>[] = [];
        for (const t of newTeam) {
          const fresh = !oldTeam.some((o) => o.id === t.id);
          pushes.push(pushTo([t.id], { title: fresh ? "ได้รับเคสกายภาพใหม่" : "เปลี่ยนนัดกายภาพ", body: daysOf(t.id) ? `${c.resident_name} · ${daysOf(t.id)} ${time ?? ""} น.` : `${c.resident_name} · เข้าทีมประจำเคส (ผู้จัดการจะส่งไปเป็นรายนัด)`, url: "/staff", tag: `physio-${c.id}` }));
        }
        for (const o of oldTeam) if (!newTeam.some((t) => t.id === o.id)) pushes.push(pushTo([o.id], { title: "เคสกายภาพถูกย้าย", body: `${c.resident_name} · ย้ายไปให้ ${tname ?? "ผู้อื่น"}`, url: "/staff", tag: `physio-${c.id}` }));
        await Promise.all(pushes);
        await audit(req, me, [{ area: "physio", action: "update", recordId: c.id as string, branch: c.branch_name as string,
          summary: `จ่ายเคสกายภาพ ${c.name} · ${c.resident_name}: ${was} → ${now}`,
          before: { therapist: c.therapist_name, days: c.plan_days, dates: c.plan_dates, time: c.plan_time, minutes: c.plan_minutes, team: c.plan_slots ?? null }, after: { therapist: tname, days: weekly, dates, time, minutes: tid ? minutes : null, team: slots } }]);
        return NextResponse.json({ ok: true });
      }
      case "course_cancel": {
        if (!can(me, "billing")) return forbidden("ยกเลิกคอร์สได้เฉพาะผู้จัดการสาขาหรือฝ่ายขาย");
        const gone = (await sql(`DELETE FROM physio_courses WHERE id = $1 AND used = 0 AND ${unbilledSql("invoice_id")} ${scoped(me) ? "AND branch_name = $2" : ""}
                                 RETURNING id, name, resident_name, branch_name`, scoped(me) ? [String(b.courseId ?? ""), me.branch] : [String(b.courseId ?? "")])) as { id: string; name: string; resident_name: string; branch_name: string }[];
        if (!gone.length) return bad("ยกเลิกไม่ได้ · คอร์สนี้ใช้ไปแล้วหรือออกใบแจ้งหนี้แล้ว", 409);
        await audit(req, me, [{ area: "physio", action: "delete", recordId: gone[0].id, summary: `ยกเลิกคอร์ส ${gone[0].name} · ${gone[0].resident_name}`, branch: gone[0].branch_name }]);
        return NextResponse.json({ ok: true });
      }
      case "physio_free":
        // ปิดแล้ว: ต้องซื้อคอร์สก่อนจึงจะบันทึกกายภาพได้ (กันทำกายภาพให้ก่อนลูกค้าซื้อ) · บันทึกรายครั้งเดิมยังเรียกเก็บได้ที่หน้าใบแจ้งหนี้และใบเสร็จ
        return bad("ต้องซื้อคอร์สกายภาพก่อนจึงจะบันทึกการทำกายภาพได้", 409);
      case "supply_item": {
        if (!canManage(me)) return forbidden("บัญชีนี้ไม่มีสิทธิ์จัดการคลังเวชภัณฑ์");
        const name = text(b.name, 120);
        if (!name) return bad("กรุณากรอกชื่อเวชภัณฑ์");
        const price = Math.max(0, Number(b.price) || 0), stock = Math.max(0, Math.floor(Number(b.stock) || 0)), unit = text(b.unit, 30) || "ชิ้น";
        const branch = scoped(me) ? me.branch : text(b.branch, 120) || me.branch;
        const id = typeof b.id === "string" && b.id ? b.id : randomUUID();
        if (b.id) {
          const [it] = (await sql`SELECT branch_name FROM supply_items WHERE id = ${id}`) as { branch_name: string }[];
          if (!it) return bad("ไม่พบรายการ", 404);
          if (scoped(me) && it.branch_name !== me.branch) return forbidden();
          await sql`UPDATE supply_items SET name = ${name}, unit = ${unit}, price = ${price}, stock = ${stock} WHERE id = ${id}`;
        } else {
          await sql`INSERT INTO supply_items (id, branch_name, name, unit, price, stock) VALUES (${id}, ${branch}, ${name}, ${unit}, ${price}, ${stock})`;
        }
        await audit(req, me, [{ area: "supplies", action: b.id ? "update" : "create", recordId: id, summary: `เวชภัณฑ์ ${name} คงเหลือ ${stock} ${unit}`, branch }]);
        return NextResponse.json({ ok: true, id });
      }
      case "supply_issue": {
        if (!canRead(me)) return forbidden();
        const o = await residentOf(me, String(b.residentId ?? ""));
        if (!o.r) return o.res;
        const qty = Math.floor(Number(b.qty));
        if (!(qty > 0 && qty <= 1000)) return bad("กรุณาระบุจำนวนที่เบิก");
        // ตัดสต็อกในคำสั่งเดียว: ของไม่พอ = ไม่ตัด (กันสองเครื่องเบิกพร้อมกันจนติดลบ)
        const left = (await sql(`UPDATE supply_items SET stock = stock - $1 WHERE id = $2 AND stock >= $1 ${scoped(me) ? "AND branch_name = $3" : ""}
                                RETURNING id, name, unit, price::float, stock, branch_name`, scoped(me) ? [qty, String(b.itemId ?? ""), me.branch] : [qty, String(b.itemId ?? "")])) as { id: string; name: string; unit: string; price: number; stock: number; branch_name: string }[];
        if (!left.length) return bad("เวชภัณฑ์ในคลังไม่พอ หรือไม่พบรายการ", 409);
        const it = left[0];
        const id = randomUUID();
        await sql`INSERT INTO supply_issues (id, branch_name, resident_id, resident_name, item_id, item_name, unit, qty, price, issued_by)
                  VALUES (${id}, ${o.r.branch_name}, ${o.r.id}, ${o.r.full_name}, ${it.id}, ${it.name}, ${it.unit}, ${qty}, ${it.price}, ${me.name})`;
        await audit(req, me, [{ area: "supplies", action: "update", recordId: id, summary: `เบิก ${it.name} ${qty} ${it.unit} · ${o.r.full_name}`, branch: o.r.branch_name }]);
        return NextResponse.json({ ok: true, id, stock: it.stock });
      }
      case "supply_bill": {
        if (!can(me, "billing") && !can(me, "contracts")) return forbidden();
        const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).slice(0, 200);
        const cids = (Array.isArray(b.courseIds) ? b.courseIds : []).map(String).slice(0, 50);
        if (cids.length) await sql(`UPDATE physio_courses SET invoice_id = $1 WHERE id = ANY($2) AND ${unbilledSql("invoice_id")} ${scoped(me) ? "AND branch_name = $3" : ""}`,
          scoped(me) ? [String(b.invoiceId ?? ""), cids, me.branch] : [String(b.invoiceId ?? ""), cids]);
        const nids = (Array.isArray(b.noteIds) ? b.noteIds : []).map(String).slice(0, 200);
        if (nids.length) await sql(`UPDATE clinical_notes SET invoice_id = $1 WHERE id = ANY($2) AND ${unbilledSql("invoice_id")} ${scoped(me) ? "AND branch_name = $3" : ""}`,
          scoped(me) ? [String(b.invoiceId ?? ""), nids, me.branch] : [String(b.invoiceId ?? ""), nids]);
        const mids = (Array.isArray(b.medIds) ? b.medIds : []).map(String).slice(0, 200);
        if (mids.length) await sql(`UPDATE stock_moves SET invoice_id = $1 WHERE id = ANY($2) AND ${unbilledSql("invoice_id")} ${scoped(me) ? "AND branch_name = $3" : ""}`,
          scoped(me) ? [String(b.invoiceId ?? ""), mids, me.branch] : [String(b.invoiceId ?? ""), mids]);
        if (!ids.length) return NextResponse.json({ ok: true });
        await sql(`UPDATE supply_issues SET invoice_id = $1 WHERE id = ANY($2) AND ${unbilledSql("invoice_id")} ${scoped(me) ? "AND branch_name = $3" : ""}`,
          scoped(me) ? [String(b.invoiceId ?? ""), ids, me.branch] : [String(b.invoiceId ?? ""), ids]);
        return NextResponse.json({ ok: true });
      }
      case "doc_file": {
        if (!can(me, "official-docs")) return forbidden();
        const data = typeof b.data === "string" ? b.data : "";
        if (!/^data:(image\/(png|jpeg|webp)|application\/pdf);base64,/.test(data) || data.length > 5_600_000) return bad("แนบได้เฉพาะรูปหรือ PDF ขนาดไม่เกิน 4 MB");
        const [d] = (await sql`SELECT id, title, branch_name FROM official_documents WHERE id = ${String(b.id ?? "")}`) as Record<string, string>[];
        if (!d) return bad("ไม่พบเอกสาร", 404);
        if (scoped(me) && d.branch_name && d.branch_name !== me.branch) return forbidden();
        await sql`UPDATE official_documents SET file_name = ${text(b.name, 200) || "ไฟล์แนบ"}, file_data = ${data}, updated_at = now() WHERE id = ${d.id}`;
        await audit(req, me, [{ area: "docs", action: "update", recordId: d.id, summary: `แนบไฟล์ · ${d.title}`, branch: d.branch_name }]);
        return NextResponse.json({ ok: true });
      }
      case "doc_settings": {
        if (me.role !== "Global Admin" && me.role !== "Branch Admin") return forbidden("ตั้งข้อความเอกสารได้เฉพาะผู้จัดการขึ้นไป");
        const key = text(b.key, 60);
        if (!/^[a-z_]+$/.test(key)) return bad("ชื่อการตั้งค่าไม่ถูกต้อง");
        const value = typeof b.value === "string" ? b.value.slice(0, 20000) : "";
        await sql`INSERT INTO doc_settings (key, value, updated_by, updated_at) VALUES (${key}, ${value}, ${me.name}, now())
                  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
        await audit(req, me, [{ area: "doc_settings", action: "update", recordId: key, summary: `ข้อความเอกสาร · ${key}`, branch: null }]);
        return NextResponse.json({ ok: true });
      }
      default:
        return bad("unknown op");
    }
  } catch (e) {
    console.error("[api/clinic]", e);
    return bad("database error", 500);
  }
}
