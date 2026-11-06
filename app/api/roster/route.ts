import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUser, forbidden, unauthorized } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { SessionUser } from "@/lib/roles";
import { can } from "@/lib/perms";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * ตารางเวรและการเช็คชื่อ (เห็นเฉพาะสาขาตัวเอง ยกเว้น Global Admin เลือกสาขาได้)
 *  GET  ?op=month&ym=2026-10[&branch=]  เวรทั้งเดือน + การเช็คชื่อ (พยาบาลเห็นการเช็คชื่อของตัวเองเท่านั้น) + รายชื่อทีม (ผู้จัดการ)
 *  GET  ?op=day&date=2026-10-28[&branch=] การเช็คชื่อของวันนั้นพร้อมรูป (ผู้จัดการ)
 *  GET  ?op=today                       เวรของฉันวันนี้ + การเช็คชื่อ
 *  POST { op: "assign", date, shift, staffIds, branch? }   ตั้งคนเข้าเวรของวันนั้น (แทนที่ของเดิม) · ผู้จัดการ
 *  POST { op: "assign_one", date, shift, staffId, on, branch? }  เพิ่ม (on=true) / เอาออก (on=false) ทีละคน · ผู้จัดการ
 *  POST { op: "checkin", kind: "in"|"out", photo }         เช็คชื่อด้วยรูปถ่ายสด · ทุกระดับ (ของตัวเอง)
 */
const SHIFT_START: Record<string, string> = { เช้า: "07:00", ดึก: "19:00" };
const LATE_GRACE = 15;
const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
/** จัดเวร/ดูการเช็คชื่อของทีม = มีเมนูตารางเวร (ไม่มี = เห็นเฉพาะของตัวเองใน KinApp) */
const isAdmin = (me: SessionUser) => can(me, "roster");
const branchOf = (me: SessionUser, q?: string | null) => (me.role === "Global Admin" ? (q || null) : me.branch);
const ymOk = (s: string) => /^\d{4}-\d{2}$/.test(s);
const dateOk = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
/** วันและเวลาปัจจุบันตามเวลาไทย (คิดที่ server ไม่ใช้เวลาจากเครื่องผู้ใช้) */
async function nowTh() {
  const [r] = await sql`SELECT to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') d, to_char(now() AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') t,
                               to_char((now() AT TIME ZONE 'Asia/Bangkok') - interval '1 day', 'YYYY-MM-DD') y`;
  return r as { d: string; t: string; y: string };
}
/** เช็คชื่อเข้าได้ก่อนเวลาเข้าเวร 60 นาที · เช็คชื่อออกได้ถึง 3 ชั่วโมงหลังเลิกเวร (เวรละ 12 ชั่วโมง) */
const EARLY_IN_MIN = 60, LATE_OUT_MIN = 180, SHIFT_HOURS = 12;
type ShiftRow = { id: string; date: string; shift: string };
/**
 * เวรที่การเช็คชื่อตอนนี้ผูกกับ (คิดเวลาไทยที่ server)
 *  kind "in"  : เวรที่ยังไม่เช็คชื่อเข้า และตอนนี้อยู่ระหว่าง 60 นาทีก่อนเข้าเวร ถึงเวลาเลิกเวร (เวรที่เริ่มล่าสุดก่อน)
 *  kind "out" : เวรที่เช็คชื่อเข้าแล้วยังไม่ออก (ถึง 3 ชม. หลังเลิกเวร) ก่อน · ไม่มี = เวรที่ยังไม่ออกในช่วงเวลาเดียวกัน
 *  ไม่ระบุ   : ใช้แสดงผล = เวรที่เข้าแล้วยังไม่ออก → เวรที่เช็คชื่อเข้าได้ตอนนี้ → เวรที่ยังอยู่ในช่วงเวลา
 *  next      : เวรที่ยังไม่ถึงช่วงเช็คชื่อของวันนี้ (แสดงว่า "วันนี้มีเวร" เท่านั้น ไม่ใช้ผูกการเช็คชื่อ)
 */
async function myShift(me: SessionUser, kind?: "in" | "out") {
  const n = await nowTh();
  const rows = (await sql`SELECT id, shift_date::text AS date, shift FROM staff_shifts WHERE staff_id = ${me.id} AND shift_date IN (${n.d}::date, ${n.y}::date) ORDER BY shift_date`) as ShiftRow[];
  const att = (await sql`SELECT work_date::text AS date, shift, kind FROM attendance WHERE staff_id = ${me.id} AND work_date IN (${n.d}::date, ${n.y}::date) AND shift IS NOT NULL`) as { date: string; shift: string; kind: string }[];
  // เวลาเทียบกันเป็นนาที (นาฬิกาไทย)
  const now = Date.parse(`${n.d}T${n.t}:00Z`) / 60e3;
  const startOf = (r: ShiftRow) => Date.parse(`${r.date}T${SHIFT_START[r.shift] ?? "07:00"}:00Z`) / 60e3;
  const endOf = (r: ShiftRow) => startOf(r) + SHIFT_HOURS * 60;
  const has = (r: ShiftRow, k: string) => att.some((a) => a.date === r.date && a.shift === r.shift && a.kind === k);
  const latest = (list: ShiftRow[]) => [...list].sort((a, b) => startOf(b) - startOf(a))[0];
  const inWin = rows.filter((r) => now >= startOf(r) - EARLY_IN_MIN && now < endOf(r));
  const anyWin = rows.filter((r) => now >= startOf(r) - EARLY_IN_MIN && now <= endOf(r) + LATE_OUT_MIN);
  const open = latest(anyWin.filter((r) => has(r, "in") && !has(r, "out")));
  const forIn = latest(inWin.filter((r) => !has(r, "in"))) ?? latest(inWin);
  const forOut = open ?? latest(anyWin.filter((r) => !has(r, "out"))) ?? latest(anyWin);
  const cur = kind === "in" ? forIn : kind === "out" ? forOut : (open ?? latest(inWin.filter((r) => !has(r, "in"))) ?? latest(anyWin));
  const next = rows.filter((r) => r.date === n.d && startOf(r) - EARLY_IN_MIN > now).sort((a, b) => startOf(a) - startOf(b))[0];
  return { now: n, shift: cur ?? null, next: next ?? null, today: rows.filter((r) => r.date === n.d) };
}

export async function GET(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const q = req.nextUrl.searchParams;
  try {
    switch (q.get("op")) {
      case "month": {
        const ym = q.get("ym") ?? "";
        if (!ymOk(ym)) return bad("รูปแบบเดือนไม่ถูกต้อง");
        const br = branchOf(me, q.get("branch"));
        const from = `${ym}-01`;
        const shifts = await sql(
          `SELECT id, branch_name, staff_id, staff_name, shift_date::text AS date, shift FROM staff_shifts
           WHERE shift_date >= $1::date AND shift_date < ($1::date + interval '1 month') ${br ? "AND branch_name = $2" : ""}
           ORDER BY shift_date, shift, staff_name`, br ? [from, br] : [from]);
        const att = await sql(
          `SELECT id, staff_id, staff_name, work_date::text AS date, shift, kind, to_char(at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS time, late_min
           FROM attendance WHERE work_date >= $1::date AND work_date < ($1::date + interval '1 month')
           ${isAdmin(me) ? (br ? "AND branch_name = $2" : "") : "AND staff_id = $2"} ORDER BY at`,
          isAdmin(me) ? (br ? [from, br] : [from]) : [from, me.id]);
        const team = isAdmin(me) && br
          ? await sql`SELECT id, full_name AS name, access_level AS role FROM staff_users WHERE branch_name = ${br} AND status = 'ทำงาน' ORDER BY access_level DESC, full_name`
          : [];
        return NextResponse.json({ shifts, attendance: att, team, branch: br, me: { id: me.id, name: me.name, role: me.role } });
      }
      case "day": {
        if (!isAdmin(me)) return forbidden();
        const d = q.get("date") ?? "";
        if (!dateOk(d)) return bad("รูปแบบวันที่ไม่ถูกต้อง");
        const br = branchOf(me, q.get("branch"));
        const rows = await sql(
          `SELECT id, staff_name, shift, kind, to_char(at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS time, late_min, photo
           FROM attendance WHERE work_date = $1::date ${br ? "AND branch_name = $2" : ""} ORDER BY at`, br ? [d, br] : [d]);
        return NextResponse.json({ attendance: rows });
      }
      case "today": {
        const m = await myShift(me);
        const att = m.shift ? await sql`SELECT kind, to_char(at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS time, late_min FROM attendance WHERE staff_id = ${me.id} AND work_date = ${m.shift.date}::date AND shift = ${m.shift.shift} ORDER BY at`
          : await sql`SELECT kind, to_char(at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS time, late_min FROM attendance WHERE staff_id = ${me.id} AND work_date = ${m.now.d}::date AND shift IS NULL ORDER BY at`;
        return NextResponse.json({ now: m.now, shift: m.shift, next: m.next, attendance: att });
      }
      default:
        return bad("unknown op");
    }
  } catch (e) {
    console.error("[api/roster]", e);
    return bad("database error", 500);
  }
}

export async function POST(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const b = await req.json().catch(() => ({}));
  try {
    if (b.op === "assign") {
      if (!isAdmin(me)) return forbidden("บัญชีนี้ไม่มีสิทธิ์จัดเวร");
      const br = branchOf(me, b.branch);
      if (!br) return bad("กรุณาเลือกสาขา");
      if (!dateOk(String(b.date)) || !(b.shift in SHIFT_START)) return bad("ข้อมูลเวรไม่ถูกต้อง");
      const ids = (Array.isArray(b.staffIds) ? b.staffIds : []).map(String);
      const team = (await sql`SELECT id, full_name FROM staff_users WHERE branch_name = ${br} AND id = ANY(${ids}) AND access_level IN ('Nurse', 'Head Nurse')`) as { id: string; full_name: string }[];
      const before = (await sql`SELECT staff_name FROM staff_shifts WHERE branch_name = ${br} AND shift_date = ${b.date}::date AND shift = ${b.shift}`) as { staff_name: string }[];
      await sql.transaction([
        sql`DELETE FROM staff_shifts WHERE branch_name = ${br} AND shift_date = ${b.date}::date AND shift = ${b.shift}`,
        ...team.map((t) => sql`INSERT INTO staff_shifts (id, branch_name, staff_id, staff_name, shift_date, shift, created_by) VALUES (${randomUUID()}, ${br}, ${t.id}, ${t.full_name}, ${b.date}::date, ${b.shift}, ${me.name}) ON CONFLICT DO NOTHING`),
      ]);
      await audit(req, me, [{ area: "roster", action: "update", recordId: `${b.date}:${b.shift}`, summary: `เวร${b.shift} ${b.date}`, branch: br,
        before: { staff: before.map((x) => x.staff_name).join(", ") || "-" }, after: { staff: team.map((x) => x.full_name).join(", ") || "-" } }]);
      return NextResponse.json({ ok: true, count: team.length });
    }
    if (b.op === "assign_one") {
      // เพิ่ม/เอาออกทีละคน (ไม่ลบแล้วใส่ใหม่ทั้งเวร) · กดหลายช่องติดกันเร็ว ๆ คนที่ตั้งไว้ก่อนไม่หาย
      if (!isAdmin(me)) return forbidden("บัญชีนี้ไม่มีสิทธิ์จัดเวร");
      const br = branchOf(me, b.branch);
      if (!br) return bad("กรุณาเลือกสาขา");
      if (!dateOk(String(b.date)) || !(b.shift in SHIFT_START)) return bad("ข้อมูลเวรไม่ถูกต้อง");
      const staffId = String(b.staffId ?? "");
      const on = b.on !== false;
      const [t] = (on
        ? await sql`SELECT id, full_name FROM staff_users WHERE branch_name = ${br} AND id = ${staffId} AND access_level IN ('Nurse', 'Head Nurse')`
        : await sql`SELECT id, full_name FROM staff_users WHERE branch_name = ${br} AND id = ${staffId}`) as { id: string; full_name: string }[];
      if (!t) return bad(on ? "ไม่พบพยาบาลคนนี้ในสาขา" : "ไม่พบพนักงานคนนี้ในสาขา", 404);
      const changed = on
        ? await sql`INSERT INTO staff_shifts (id, branch_name, staff_id, staff_name, shift_date, shift, created_by) VALUES (${randomUUID()}, ${br}, ${t.id}, ${t.full_name}, ${b.date}::date, ${b.shift}, ${me.name}) ON CONFLICT DO NOTHING RETURNING id`
        : await sql`DELETE FROM staff_shifts WHERE branch_name = ${br} AND shift_date = ${b.date}::date AND shift = ${b.shift} AND staff_id = ${t.id} RETURNING id`;
      if (changed.length) await audit(req, me, [{ area: "roster", action: "update", recordId: `${b.date}:${b.shift}`, summary: `เวร${b.shift} ${b.date} · ${on ? "เพิ่ม" : "เอาออก"} ${t.full_name}`, branch: br,
        ...(on ? { after: { staff: t.full_name } } : { before: { staff: t.full_name } }) }]);
      const [c] = (await sql`SELECT count(*)::int AS n FROM staff_shifts WHERE branch_name = ${br} AND shift_date = ${b.date}::date AND shift = ${b.shift}`) as { n: number }[];
      return NextResponse.json({ ok: true, changed: changed.length > 0, count: c?.n ?? 0 });
    }
    if (b.op === "checkin") {
      const kind = b.kind === "out" ? "out" : "in";
      const photo = typeof b.photo === "string" ? b.photo : "";
      if (!photo.startsWith("data:image/")) return bad("กรุณาถ่ายรูปก่อนเช็คชื่อ");
      if (photo.length > 600_000) return bad("รูปมีขนาดใหญ่เกินไป กรุณาถ่ายใหม่");
      const m = await myShift(me, kind);
      const date = m.shift?.date ?? m.now.d;
      const shift = m.shift?.shift ?? null;
      const done = (await sql`SELECT to_char(at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') t FROM attendance WHERE staff_id = ${me.id} AND work_date = ${date}::date AND kind = ${kind} AND shift IS NOT DISTINCT FROM ${shift}`) as { t: string }[];
      if (done.length) return bad(`เช็คชื่อ${kind === "in" ? "เข้างาน" : "ออกงาน"}ไปแล้วเมื่อ ${done[0].t} น.`, 409);
      let late: number | null = null;
      if (kind === "in" && m.shift) {
        const [r] = await sql`SELECT GREATEST(0, floor(extract(epoch FROM ((now() AT TIME ZONE 'Asia/Bangkok') - (${date}::date + ${SHIFT_START[m.shift.shift]}::time))) / 60))::int AS m`;
        late = (r.m as number) > LATE_GRACE ? (r.m as number) : 0;
      }
      const id = randomUUID();
      const [row] = await sql`INSERT INTO attendance (id, staff_id, staff_name, branch_name, work_date, shift, kind, late_min, photo)
        VALUES (${id}, ${me.id}, ${me.name}, ${me.branch}, ${date}::date, ${shift}, ${kind}, ${late}, ${photo})
        RETURNING to_char(at AT TIME ZONE 'Asia/Bangkok', 'DD/MM/YYYY HH24:MI:SS') AS at`;
      await audit(req, me, [{ area: "attendance", action: kind === "in" ? "checkin" : "checkout", recordId: id, summary: `${me.name} · ${shift ? `เวร${shift}` : "ไม่มีเวรในตาราง"}${late ? ` · สาย ${late} นาที` : ""}` }]);
      return NextResponse.json({ ok: true, at: row.at, shift, late });
    }
    return bad("unknown op");
  } catch (e) {
    console.error("[api/roster]", e);
    return bad("database error", 500);
  }
}
