import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUser, forbidden, unauthorized } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { SessionUser } from "@/lib/roles";
import { can } from "@/lib/perms";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * ข้อมูลงานดูแลรายบุคคล (ใช้ได้ทุกระดับ เห็นเฉพาะสาขาตัวเอง ยกเว้น Global Admin)
 *  GET  ?op=residents           รายชื่อผู้รับบริการ (KinApp / ตัวเลือกชื่อ)
 *  GET  ?op=profile&id=…        ประวัติรายบุคคล: สัญญาณชีพ ยา การให้ยา นัดหมาย งานดูแล ส่งเวร แจ้งเตือน
 *  GET  ?op=nurses              รายชื่อพยาบาล/ทีมดูแลของสาขา (ตัวเลือกผู้ดูแลในนัดหมาย)
 *  GET  ?op=family_updates&resident=…  อัปเดตที่ส่งถึงครอบครัวของผู้รับบริการคนนี้
 *  GET  ?op=family_updates_all    ข่าวที่ทีมส่งถึงญาติ ล่าสุด 150 รายการของสาขา (ผู้จัดการ/หัวหน้าพยาบาล ตรวจสอบ)
 *  GET  ?op=family_update_photo&id=…  รูปของข่าวนั้น
 *  POST { op: "family_update", residentId, text?, photo? }  พยาบาลส่งข้อความ/รูปถึงครอบครัว (ขึ้นในสมุดภาพของญาติ)
 *  POST { op: "family_update_delete", id }  ลบอัปเดตที่ส่งไป (คนส่งเอง หรือผู้ที่มีสิทธิ์ผู้รับบริการ)
 *  GET  ?op=alerts              แจ้งเตือนสัญญาณชีพที่ยังไม่มีคนรับทราบ
 *  POST { op: "ack", id, note } รับทราบแจ้งเตือน (บันทึกประวัติการแก้ไข)
 *  GET  ?op=routines            งานประจำ (ทำซ้ำทุกวัน) ที่ยังใช้อยู่
 *  POST { op: "routines_add", items: [{ resident, task, ins, shift, time }] }  เพิ่มงานประจำ (ผู้จัดการขึ้นไป)
 *  POST { op: "routine_stop", id }  หยุดทำซ้ำ
 *  GET  ?op=surveys[&branch=]       ผลประเมินความพึงพอใจจากครอบครัว (ผู้จัดการขึ้นไป)
 *  GET  ?op=task_photos&ids=a,b   รูปหลักฐานหลายงาน (ผลงานทีมใน KinApp)
 *  GET  ?op=task_photo&id=…      รูปหลักฐานของงานประจำวัน (ผู้จัดการเปิดตอนตรวจงาน)
 *  POST { op: "task_photo", id, photo, share? }  แนบรูปหลักฐานตอนส่งงานจาก KinApp (share = แชร์ให้ครอบครัว)
 *  POST { op: "task_review", id, stars, note? }  ผู้จัดการให้ดาวตอนตรวจงาน (ใช้คิด KPI)
 *  POST { op: "task_share", id, share }  ผู้จัดการซ่อน/แสดงรูปในสมุดภาพของครอบครัว
 */
const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
const scoped = (me: SessionUser) => me.role !== "Global Admin";
/** ตรวจสอบข่าวและลิงก์ที่ทีมส่งถึงญาติ: ผู้ที่มีเมนูผู้รับบริการ รีวิวพนักงาน หรือเสียงจากครอบครัว */
const isFamilyAdmin = (me: SessionUser) => can(me, "residents") || can(me, "reviews") || can(me, "feedbacks");

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
    !can(me, "contracts") ? Promise.resolve([]) : q(`SELECT id, contract_no, employer_name, monthly_fee, status, start_date::text AS start_date FROM contracts WHERE ${MINE} ORDER BY created_at DESC`),
    !can(me, "quotations") ? Promise.resolve([]) : q(`SELECT id, plan_name, relative_phone, estimated_price, note FROM care_assessments WHERE ${MINE}`),
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
      case "routines": {
        const rows = await sql(
          `SELECT id, resident_name, branch_name, task_name, instruction, shift, sched_time, created_by FROM care_routines
           WHERE active ${scoped(me) ? "AND branch_name = $1" : ""} ORDER BY branch_name, resident_name, sched_time`, scoped(me) ? [me.branch] : []);
        return NextResponse.json({ routines: rows });
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
    const [t] = (await sql`SELECT branch_name FROM daily_tasks WHERE id = ${String(b.id)}`) as Record<string, string>[];
    if (!t) return bad("ไม่พบงานนี้", 404);
    if (scoped(me) && t.branch_name !== me.branch) return forbidden();
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
    for (const it of items) {
      const r = res.find((x) => x.full_name === it.resident && (!scoped(me) || x.branch_name === me.branch));
      if (!r || !it.task || !it.shift || !/^\d{2}:\d{2}/.test(it.time ?? "")) continue;
      if (have.some((h) => h.resident_id === r.id && h.task_name === it.task && h.shift === it.shift)) continue;
      const id = crypto.randomUUID();
      await sql`INSERT INTO care_routines (id, resident_id, resident_name, branch_name, task_name, instruction, shift, sched_time, created_by)
                VALUES (${id}, ${r.id}, ${r.full_name}, ${r.branch_name}, ${it.task}, ${it.ins ?? "-"}, ${it.shift}, ${it.time.slice(0, 5)}, ${me.name})`;
      have.push({ resident_id: r.id, task_name: it.task, shift: it.shift });
      logs.push({ area: "routines", action: "create", recordId: id, summary: `${r.full_name} · ${it.task} · ${it.shift} ${it.time.slice(0, 5)}`, branch: r.branch_name });
      added++;
    }
    await audit(req, me, logs);
    return NextResponse.json({ ok: true, added });
  }
  if (b.op !== "ack") return bad("unknown op");
  const [a] = (await sql`SELECT id, branch_name, resident_name, summary, status FROM care_alerts WHERE id = ${String(b.id)}`) as Record<string, string>[];
  if (!a) return bad("ไม่พบแจ้งเตือนนี้", 404);
  if (scoped(me) && a.branch_name !== me.branch) return forbidden();
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 500) : "";
  await sql`UPDATE care_alerts SET status = 'acknowledged', ack_by = ${me.name}, ack_at = now(), ack_note = ${note || null} WHERE id = ${a.id}`;
  await audit(req, me, [{ area: "alerts", action: "acknowledge", recordId: a.id, summary: `${a.resident_name ?? ""} · ${a.summary ?? ""}`.slice(0, 200), branch: a.branch_name, after: { ack_note: note || null } }]);
  return NextResponse.json({ ok: true });
}
