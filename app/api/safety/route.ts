import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { currentUser, forbidden, unauthorized } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { SessionUser } from "@/lib/roles";
import { can } from "@/lib/perms";
import { pushTo } from "@/lib/push";
import { INCIDENT_KINDS, INCIDENT_LEVELS } from "@/lib/safety";

/**
 * ความปลอดภัยผู้รับบริการ: รายงานเหตุการณ์ไม่พึงประสงค์ และบันทึกแผลเป็นลำดับเวลา
 *  GET  ?op=incidents[&days=180]              รายการเหตุการณ์ (ไม่ส่งรูป) · ผู้จัดการ/หัวหน้าพยาบาล/ทีมดูแล ในสาขา
 *  GET  ?op=incident_photo&id=                 รูปของเหตุการณ์
 *  POST { op: "incident_report", residentId, kind, severity, detail, photo?, occurredAt? }  พยาบาลรายงาน (KinApp / ระบบจัดการ) · แจ้งหัวหน้าพยาบาลและผู้จัดการสาขาทันที
 *  POST { op: "incident_ack", id, action }     หัวหน้าพยาบาล/ผู้จัดการรับทราบพร้อมการแก้ไข/ป้องกัน
 *  POST { op: "incident_family", id }          บันทึกว่าแจ้งญาติแล้ว (เวลา + ผู้แจ้ง)
 *  GET  ?op=wounds&resident=                   บันทึกแผลของผู้รับบริการ เรียงล่าสุดก่อน (มีรูป)
 *  POST { op: "wound_add", residentId, site, stage?, length?, width?, photo?, note? }   บันทึกแผล 1 ครั้ง
 */
const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
const scoped = (me: SessionUser) => me.role !== "Global Admin";
const canSee = (me: SessionUser) => can(me, "app.staff") || can(me, "health_logs") || can(me, "residents") || can(me, "tasks.review") || can(me, "dashboard");
const canReport = (me: SessionUser) => can(me, "app.staff") || can(me, "health_logs") || can(me, "residents");
const isLead = (me: SessionUser) => me.role === "Global Admin" || me.role === "Branch Admin" || me.role === "Head Nurse";
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const photoOf = (v: unknown) => (typeof v === "string" && v.startsWith("data:image/") && v.length < 2_000_000 ? v : null);
const TH_AT = (col: string) => `to_char(${col} AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI')`;

async function residentOf(me: SessionUser, id: string) {
  const [r] = (await sql`SELECT id, full_name, branch_name, room FROM residents WHERE id = ${id}`) as { id: string; full_name: string; branch_name: string | null; room: string | null }[];
  if (!r) return { res: bad("ไม่พบผู้รับบริการ", 404) };
  if (scoped(me) && r.branch_name !== me.branch) return { res: forbidden() };
  return { r };
}

export async function GET(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (!canSee(me)) return forbidden();
  const q = req.nextUrl.searchParams;
  switch (q.get("op")) {
    case "incidents": {
      const days = Math.min(400, Math.max(1, Number(q.get("days")) || 180));
      const br = scoped(me) ? me.branch : q.get("branch") || null;
      const rows = await sql(`SELECT id, resident_id, resident_name, branch_name AS branch, kind, severity, coalesce(detail, '') AS detail, (photo IS NOT NULL) AS has_photo,
          ${TH_AT("occurred_at")} AS occurred, reported_by, ${TH_AT("created_at")} AS reported, ack_by, ${TH_AT("ack_at")} AS ack_at, coalesce(action, '') AS action,
          ${TH_AT("family_at")} AS family_at, family_by, floor(extract(epoch FROM now() - created_at) / 60)::int AS age_min
        FROM incidents WHERE created_at > now() - ($1 || ' days')::interval ${br ? "AND branch_name = $2" : ""} ORDER BY created_at DESC LIMIT 1000`, br ? [String(days), br] : [String(days)]);
      return NextResponse.json({ items: rows, canAck: isLead(me) });
    }
    case "incident_photo": {
      const [x] = (await sql`SELECT photo, branch_name FROM incidents WHERE id = ${q.get("id") ?? ""}`) as { photo: string | null; branch_name: string | null }[];
      if (!x?.photo) return bad("ไม่พบรูป", 404);
      if (scoped(me) && x.branch_name !== me.branch) return forbidden();
      return NextResponse.json({ photo: x.photo });
    }
    case "wounds": {
      const o = await residentOf(me, q.get("resident") ?? "");
      if (!o.r) return o.res;
      const rows = await sql`SELECT id, site, coalesce(stage, '') AS stage, length_cm::float AS length, width_cm::float AS width, photo, coalesce(note, '') AS note, author,
          to_char(created_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI') AS at
        FROM wound_logs WHERE resident_id = ${o.r.id} ORDER BY created_at DESC LIMIT 60`;
      return NextResponse.json({ items: rows });
    }
  }
  return bad("ไม่รู้จักคำสั่งนี้");
}

export async function POST(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  switch (b.op) {
    case "incident_report": {
      if (!canReport(me)) return forbidden("บัญชีนี้รายงานเหตุการณ์ไม่ได้");
      const o = await residentOf(me, String(b.residentId ?? ""));
      if (!o.r) return o.res;
      const kind = text(b.kind, 40), severity = text(b.severity, 40), detail = text(b.detail, 1000);
      if (!(INCIDENT_KINDS as readonly string[]).includes(kind)) return bad("กรุณาเลือกประเภทเหตุการณ์");
      if (!(INCIDENT_LEVELS as readonly string[]).includes(severity)) return bad("กรุณาเลือกความรุนแรง");
      if (!detail) return bad("กรุณาเล่าสิ่งที่เกิดขึ้นและสิ่งที่ทำไปแล้ว");
      const at = typeof b.occurredAt === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(b.occurredAt) ? `${b.occurredAt.slice(0, 16)}:00+07:00` : null;
      const id = randomUUID();
      await sql`INSERT INTO incidents (id, resident_id, resident_name, branch_name, kind, severity, detail, photo, occurred_at, reported_by)
        VALUES (${id}, ${o.r.id}, ${o.r.full_name}, ${o.r.branch_name}, ${kind}, ${severity}, ${detail}, ${photoOf(b.photo)}, coalesce(${at}::timestamptz, now()), ${me.name})`;
      await audit(req, me, [{ area: "incidents", action: "create", recordId: id, branch: o.r.branch_name, summary: `${kind} · ${severity} · ${o.r.full_name}` }]);
      // แจ้งหัวหน้าพยาบาลและผู้จัดการของสาขาทันที (ไม่รวมคนรายงานเอง)
      const ids = (await sql`SELECT id FROM staff_users WHERE coalesce(status, 'ทำงาน') = 'ทำงาน' AND branch_name = ${o.r.branch_name}
          AND access_level IN ('Head Nurse', 'Branch Admin') AND id <> ${me.id}`) as { id: string }[];
      await pushTo(ids.map((x) => x.id), { title: `เหตุการณ์: ${kind} · ${severity}`, body: `${o.r.full_name}${o.r.room ? ` · ห้อง ${o.r.room}` : ""} · รายงานโดย ${me.name}`, url: "/?view=health_logs", tag: `incident-${id}` }).catch(() => 0);
      return NextResponse.json({ ok: true, id, notified: ids.length });
    }
    case "incident_ack":
    case "incident_family": {
      const [x] = (await sql`SELECT id, branch_name, resident_name, kind, ack_by, family_at FROM incidents WHERE id = ${String(b.id ?? "")}`) as { id: string; branch_name: string | null; resident_name: string; kind: string; ack_by: string | null; family_at: string | null }[];
      if (!x) return bad("ไม่พบเหตุการณ์นี้", 404);
      if (scoped(me) && x.branch_name !== me.branch) return forbidden();
      if (b.op === "incident_ack") {
        if (!isLead(me)) return forbidden("รับทราบได้เฉพาะหัวหน้าพยาบาลหรือผู้จัดการสาขา");
        const action = text(b.action, 600);
        if (!action) return bad("กรุณาบันทึกการแก้ไข / ป้องกัน");
        await sql`UPDATE incidents SET ack_by = ${me.name}, ack_at = now(), action = ${action} WHERE id = ${x.id}`;
        await audit(req, me, [{ area: "incidents", action: "acknowledge", recordId: x.id, branch: x.branch_name, summary: `${x.kind} · ${x.resident_name} · ${action}` }]);
      } else {
        if (!canReport(me)) return forbidden();
        if (x.family_at) return NextResponse.json({ ok: true });
        await sql`UPDATE incidents SET family_at = now(), family_by = ${me.name} WHERE id = ${x.id}`;
        await audit(req, me, [{ area: "incidents", action: "update", recordId: x.id, branch: x.branch_name, summary: `แจ้งญาติแล้ว · ${x.kind} · ${x.resident_name}` }]);
      }
      return NextResponse.json({ ok: true });
    }
    case "wound_add": {
      if (!canReport(me)) return forbidden("บัญชีนี้บันทึกแผลไม่ได้");
      const o = await residentOf(me, String(b.residentId ?? ""));
      if (!o.r) return o.res;
      const site = text(b.site, 80), stage = text(b.stage, 40), note = text(b.note, 500);
      const num = (v: unknown) => { const n = Number(v); return v === "" || v === null || v === undefined || !Number.isFinite(n) ? null : n; };
      const len = num(b.length), wid = num(b.width);
      if (!site) return bad("กรุณาระบุตำแหน่งแผล");
      if ((len !== null && (len < 0 || len > 100)) || (wid !== null && (wid < 0 || wid > 100))) return bad("ขนาดแผลต้องอยู่ระหว่าง 0–100 ซม.");
      const photo = photoOf(b.photo);
      if (!photo && len === null) return bad("กรุณาถ่ายรูปหรือวัดขนาดแผลอย่างน้อย 1 อย่าง");
      const id = randomUUID();
      await sql`INSERT INTO wound_logs (id, resident_id, resident_name, branch_name, site, stage, length_cm, width_cm, photo, note, author)
        VALUES (${id}, ${o.r.id}, ${o.r.full_name}, ${o.r.branch_name}, ${site}, ${stage || null}, ${len}, ${wid}, ${photo}, ${note || null}, ${me.name})`;
      await audit(req, me, [{ area: "wounds", action: "create", recordId: id, branch: o.r.branch_name, summary: `แผล${site}${len !== null ? ` ${len}×${wid ?? "-"} ซม.` : ""} · ${o.r.full_name}` }]);
      return NextResponse.json({ ok: true, id });
    }
  }
  return bad("ไม่รู้จักคำสั่งนี้");
}
