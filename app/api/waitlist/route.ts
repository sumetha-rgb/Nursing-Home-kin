import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";
import { currentUser, forbidden, unauthorized } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { SessionUser } from "@/lib/roles";
import { can } from "@/lib/perms";

/**
 * คนรอเข้าพัก (ห้องเต็ม) ต่อจากใบเสนอราคา · เรียงตามลำดับที่ขอ
 *  GET  [?branch=]                                   รายชื่อที่ยังรอ (ผู้บริหารเลือกสาขาได้)
 *  POST { op: "add", branch?, name, phone?, roomType?, quoteNo?, note? }
 *  POST { op: "status", id, status: "ได้ห้องแล้ว" | "ยกเลิก" }
 */
const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
const allowed = (me: SessionUser) => can(me, "quotations") || can(me, "contracts") || can(me, "rooms");
const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const STATUSES = ["ได้ห้องแล้ว", "ยกเลิก"];

export async function GET(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (!allowed(me)) return forbidden();
  const br = me.role === "Global Admin" ? req.nextUrl.searchParams.get("branch") || null : me.branch;
  const rows = await sql(`SELECT id, branch_name AS branch, name, coalesce(phone, '') AS phone, coalesce(room_type, '') AS "roomType", coalesce(quote_no, '') AS "quoteNo",
      coalesce(note, '') AS note, created_by AS by, to_char(created_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS since
    FROM waitlist WHERE status = 'รอ' ${br ? "AND branch_name = $1" : ""} ORDER BY created_at`, br ? [br] : []);
  return NextResponse.json({ items: rows });
}

export async function POST(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (!allowed(me)) return forbidden();
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (b.op === "add") {
    const branch = me.role === "Global Admin" ? text(b.branch, 80) : me.branch;
    const name = text(b.name, 120);
    if (!branch) return bad("กรุณาเลือกสาขา");
    if (!name) return bad("กรุณาระบุชื่อผู้สนใจ");
    const id = randomUUID();
    await sql`INSERT INTO waitlist (id, branch_name, name, phone, room_type, quote_no, note, created_by)
      VALUES (${id}, ${branch}, ${name}, ${text(b.phone, 30) || null}, ${text(b.roomType, 60) || null}, ${text(b.quoteNo, 40) || null}, ${text(b.note, 300) || null}, ${me.name})`;
    await audit(req, me, [{ area: "waitlist", action: "create", recordId: id, branch, summary: `${name}${b.roomType ? ` · ${text(b.roomType, 60)}` : ""}${b.quoteNo ? ` · ${text(b.quoteNo, 40)}` : ""}` }]);
    return NextResponse.json({ ok: true, id });
  }
  if (b.op === "status") {
    const status = text(b.status, 20);
    if (!STATUSES.includes(status)) return bad("สถานะไม่ถูกต้อง");
    const [x] = (await sql`SELECT id, branch_name, name FROM waitlist WHERE id = ${text(b.id, 80)}`) as { id: string; branch_name: string; name: string }[];
    if (!x) return bad("ไม่พบรายการนี้", 404);
    if (me.role !== "Global Admin" && x.branch_name !== me.branch) return forbidden();
    await sql`UPDATE waitlist SET status = ${status}, done_at = now() WHERE id = ${x.id}`;
    await audit(req, me, [{ area: "waitlist", action: "update", recordId: x.id, branch: x.branch_name, summary: `${x.name} · ${status}` }]);
    return NextResponse.json({ ok: true });
  }
  return bad("ไม่รู้จักคำสั่งนี้");
}
