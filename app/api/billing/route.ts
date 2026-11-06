import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUser, forbidden, unauthorized } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { can } from "@/lib/perms";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * รับชำระใบแจ้งหนี้ (รับได้หลายงวด) และหลักฐานการโอนเงิน (เก็บแยกจากรายการ เพราะรูปใหญ่)
 *  ดูประวัติรับชำระ: ผู้มีสิทธิ์การเงินหรือสัญญา · รับชำระ / แนบสลิป: ต้องมีสิทธิ์การเงิน (billing)
 *  GET  ?id=…                          รายการรับชำระทั้งหมดของใบนี้ (งวด วันที่ วิธี ยอด สลิป)
 *  GET  ?op=payments[&branch=]          การรับเงินทุกงวด (ส่งออก CSV กระทบยอดเงินสด/โอน) · ไม่ส่งรูปสลิป
 *  GET  ?op=paid_days[&from=][&branch=] ยอดรับเงินรายวันต่อสาขา (รวมเป็นรายรับรายเดือนตามวันที่รับของแต่ละงวด)
 *  POST { op: "pay", id, cash, credit, transfer, date, slip?, note? }  รับชำระ 1 งวด · ยอดรวมต้องไม่เกินยอดคงเหลือ
 *                                       ครบยอด = ชำระแล้ว (เป็นใบเสร็จ) · ยังไม่ครบ = ชำระบางส่วน
 *  POST { id, slip }                   แนบ/เปลี่ยนรูปของใบที่รับชำระครั้งเดียว (slip = "" ลบรูป)
 *  GET  ?op=closes[&branch=]            ปิดยอดรายวัน 60 วันล่าสุด + ยอดรับชำระจริงของแต่ละวัน (เทียบว่ามีรับเพิ่มหลังปิดยอดไหม)
 *  POST { op: "close", date, branch?, counted, note? }  ปิดยอดวันนั้น (ปิดซ้ำได้ = ปิดใหม่ ล้างการตรวจรับรอง) · เงินสดไม่ตรงต้องมีหมายเหตุ
 *  POST { op: "close_approve", id }     ผู้จัดการสาขา / ผู้บริหาร ตรวจรับรองการปิดยอด
 * ใบแจ้งหนี้อื่น ๆ บันทึกผ่าน /api/data/invoices
 */
const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });

async function owned(req: NextRequest, id: string) {
  const me = await currentUser(req);
  if (!me) return { res: unauthorized() };
  if (!can(me, "billing") && !can(me, "contracts")) return { res: forbidden() };
  const [inv] = (await sql`SELECT id, doc_no, branch_name, slip, to_char(slip_at AT TIME ZONE 'Asia/Bangkok', 'DD-MM-') || (extract(year FROM slip_at AT TIME ZONE 'Asia/Bangkok')::int + 543) AS at FROM invoices WHERE id = ${id}`) as { id: string; doc_no: string | null; branch_name: string | null; slip: string | null; at: string | null }[];
  if (!inv) return { res: bad("ไม่พบเอกสาร", 404) };
  if (me.role !== "Global Admin" && inv.branch_name !== me.branch) return { res: forbidden() };
  return { me, inv };
}

/** ยอดรับชำระของวันนั้นในสาขานั้น (จาก invoice_payments) */
const DAY_SUM = `SELECT count(*)::int AS payments, coalesce(sum(p.cash), 0)::float AS cash, coalesce(sum(p.transfer), 0)::float AS transfer, coalesce(sum(p.credit), 0)::float AS credit
  FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.branch_name = $1 AND p.pay_date = $2::date`;
const noTable = (e: unknown) => /cash_closes/.test(String((e as Error)?.message ?? "")) && /does not exist/.test(String((e as Error)?.message ?? ""));
const NO_TABLE = "ยังไม่ได้สร้างตารางปิดยอดในฐานข้อมูล · ให้ผู้ดูแลระบบรัน npm run db:setup ก่อน";

async function closes(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (!can(me, "billing")) return forbidden();
  const br = me.role === "Global Admin" ? req.nextUrl.searchParams.get("branch") || null : me.branch;
  try {
    const rows = await sql(`SELECT c.id, c.branch_name AS branch, c.close_date::text AS date, c.payments, c.system_cash::float AS cash, c.system_transfer::float AS transfer, c.system_credit::float AS credit,
        c.counted_cash::float AS counted, coalesce(c.note, '') AS note, c.closed_by AS "closedBy", to_char(c.closed_at AT TIME ZONE 'Asia/Bangkok', 'DD/MM HH24:MI') AS "closedAt",
        c.approved_by AS "approvedBy", to_char(c.approved_at AT TIME ZONE 'Asia/Bangkok', 'DD/MM HH24:MI') AS "approvedAt"
      FROM cash_closes c WHERE c.close_date >= (now() AT TIME ZONE 'Asia/Bangkok')::date - 60 ${br ? "AND c.branch_name = $1" : ""} ORDER BY c.close_date DESC, c.branch_name`, br ? [br] : []);
    return NextResponse.json({ items: rows, canApprove: me.role === "Branch Admin" || me.role === "Global Admin" });
  } catch (e) {
    if (noTable(e)) return NextResponse.json({ items: [], missing: NO_TABLE, canApprove: false });
    throw e;
  }
}

async function closeDay(req: NextRequest, b: Record<string, unknown>) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (!can(me, "billing")) return forbidden();
  const branch = me.role === "Global Admin" ? String(b.branch ?? "") : me.branch;
  const date = typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : "";
  if (!branch) return bad("กรุณาเลือกสาขา");
  if (!date) return bad("วันที่ไม่ถูกต้อง");
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  if (date > today) return bad("ปิดยอดล่วงหน้าไม่ได้");
  const counted = money(b.counted ?? 0);
  if (Number.isNaN(counted)) return bad("ยอดเงินสดที่นับได้ไม่ถูกต้อง");
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 300) : "";
  const [s] = (await sql(DAY_SUM, [branch, date])) as { payments: number; cash: number; transfer: number; credit: number }[];
  const diff = Math.round((counted - s.cash) * 100) / 100;
  if (diff !== 0 && !note) return bad(`เงินสดที่นับได้${diff > 0 ? "เกิน" : "ขาด"} ${Math.abs(diff).toLocaleString("en-US", { minimumFractionDigits: 2 })} บาท · กรุณาใส่หมายเหตุ`);
  try {
    // ปิดซ้ำ = ปิดใหม่ด้วยยอดล่าสุด และต้องให้ผู้จัดการตรวจรับรองใหม่
    await sql(`INSERT INTO cash_closes (id, branch_name, close_date, payments, system_cash, system_transfer, system_credit, counted_cash, note, closed_by)
        VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (branch_name, close_date) DO UPDATE SET payments = EXCLUDED.payments, system_cash = EXCLUDED.system_cash, system_transfer = EXCLUDED.system_transfer,
        system_credit = EXCLUDED.system_credit, counted_cash = EXCLUDED.counted_cash, note = EXCLUDED.note, closed_by = EXCLUDED.closed_by, closed_at = now(), approved_by = NULL, approved_at = NULL`,
      [crypto.randomUUID(), branch, date, s.payments, s.cash, s.transfer, s.credit, counted, note || null, me.name]);
  } catch (e) {
    if (noTable(e)) return bad(NO_TABLE, 503);
    throw e;
  }
  await audit(req, me, [{ area: "invoices", action: "update", recordId: null, branch,
    summary: `ปิดยอดรายวัน ${date} · รับ ${s.payments} รายการ · เงินสดในระบบ ${s.cash.toFixed(2)} นับได้ ${counted.toFixed(2)}${diff ? ` (${diff > 0 ? "เกิน" : "ขาด"} ${Math.abs(diff).toFixed(2)})` : " ตรงยอด"}` }]);
  return NextResponse.json({ ok: true, diff });
}

async function approveClose(req: NextRequest, b: Record<string, unknown>) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (me.role !== "Branch Admin" && me.role !== "Global Admin") return forbidden();
  try {
    const [c] = (await sql`SELECT id, branch_name, close_date::text AS date FROM cash_closes WHERE id = ${String(b.id ?? "")}`) as { id: string; branch_name: string; date: string }[];
    if (!c) return bad("ไม่พบการปิดยอดนี้", 404);
    if (me.role !== "Global Admin" && c.branch_name !== me.branch) return forbidden();
    await sql`UPDATE cash_closes SET approved_by = ${me.name}, approved_at = now() WHERE id = ${c.id}`;
    await audit(req, me, [{ area: "invoices", action: "update", recordId: null, branch: c.branch_name, summary: `ตรวจรับรองการปิดยอดรายวัน ${c.date}` }]);
  } catch (e) {
    if (noTable(e)) return bad(NO_TABLE, 503);
    throw e;
  }
  return NextResponse.json({ ok: true });
}

/**
 * ยอดรับเงินจริงรายวันต่อสาขา (รวมจาก invoice_payments ตามวันที่รับของแต่ละงวด) · ไม่นับใบที่ยกเลิก
 *  ใช้รวมเป็น "รับเดือนนี้" และรายรับรายเดือน (ไม่ใช่ยอดสะสมของใบไปลงเดือนที่รับงวดล่าสุด) · from = YYYY-MM-DD (ค่าเริ่มต้น 13 เดือนก่อน)
 *  ผู้มีสิทธิ์การเงิน หรือภาพรวมและรายงาน · ระดับอื่นที่ไม่ใช่ผู้บริหารเห็นเฉพาะสาขาตัวเอง
 */
async function paidDays(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (!can(me, "billing") && !can(me, "dashboard")) return forbidden();
  const q = req.nextUrl.searchParams;
  const br = me.role === "Global Admin" ? q.get("branch") || null : me.branch;
  const fromQ = q.get("from") ?? "";
  const from = /^\d{4}-\d{2}-\d{2}$/.test(fromQ) ? fromQ : new Date(Date.now() + 7 * 3600e3 - 400 * 864e5).toISOString().slice(0, 10);
  const rows = await sql(`SELECT coalesce(i.branch_name, '') AS branch, p.pay_date::text AS date, sum(p.amount)::float AS amount
      FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
      WHERE p.pay_date >= $1::date AND coalesce(i.status, '') <> 'ยกเลิก' ${br ? "AND i.branch_name = $2" : ""}
      GROUP BY 1, 2 ORDER BY 2`, br ? [from, br] : [from]);
  return NextResponse.json({ items: rows });
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("op") === "closes") return closes(req);
  if (req.nextUrl.searchParams.get("op") === "paid_days") return paidDays(req);
  if (req.nextUrl.searchParams.get("op") === "payments") {
    const me = await currentUser(req);
    if (!me) return unauthorized();
    if (!can(me, "billing")) return forbidden();
    const br = me.role === "Global Admin" ? req.nextUrl.searchParams.get("branch") || null : me.branch;
    const rows = await sql(`SELECT p.pay_date::text AS date, i.doc_no AS no, row_number() OVER (PARTITION BY p.invoice_id ORDER BY p.created_at, p.id)::int AS n,
        i.branch_name AS branch, i.resident_name AS who, i.hn, i.payer_name AS payer, i.category AS kind, i.status,
        p.cash::float, p.transfer::float, p.credit::float, p.amount::float, coalesce(p.cashier, '') AS cashier, coalesce(p.note, '') AS note, (p.slip IS NOT NULL AND p.slip <> '') AS slip
      FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id ${br ? "WHERE i.branch_name = $1" : ""}
      ORDER BY p.pay_date DESC NULLS LAST, p.created_at DESC LIMIT 5000`, br ? [br] : []);
    return NextResponse.json({ items: rows });
  }
  const o = await owned(req, req.nextUrl.searchParams.get("id") ?? "");
  if (!o.inv) return o.res;
  const payments = await sql`
    SELECT id, pay_date::text AS date, cash::float, credit::float, transfer::float, amount::float, coalesce(cashier, '') AS cashier, coalesce(note, '') AS note, slip,
           to_char(slip_at AT TIME ZONE 'Asia/Bangkok', 'DD-MM-') || (extract(year FROM slip_at AT TIME ZONE 'Asia/Bangkok')::int + 543) AS "slipAt"
    FROM invoice_payments WHERE invoice_id = ${o.inv.id} ORDER BY created_at, id`;
  let before = 0;
  const list = (payments as Record<string, unknown>[]).map((p, i) => { const r = { ...p, n: i + 1, paidBefore: before }; before += Number(p.amount); return r; });
  return NextResponse.json({ slip: o.inv.slip, at: o.inv.at, payments: list });
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  if (b.op === "close") return closeDay(req, b);
  if (b.op === "close_approve") return approveClose(req, b);
  const o = await owned(req, String(b.id ?? ""));
  if (!o.inv) return o.res;
  // รับชำระ / แนบหลักฐานการโอน = งานการเงิน: ต้องมีสิทธิ์ใบแจ้งหนี้และใบเสร็จ (สิทธิ์สัญญาอย่างเดียวดูได้แต่รับเงินไม่ได้)
  if (!can(o.me, "billing")) return forbidden("บัญชีนี้ไม่มีสิทธิ์รับชำระเงิน (ต้องมีสิทธิ์ใบแจ้งหนี้และใบเสร็จ)");
  if (b.op === "pay") return pay(req, o.me, o.inv.id, b);
  const slip = typeof b.slip === "string" ? b.slip : "";
  if (slip && (!slip.startsWith("data:image/") || slip.length > 900_000)) return bad("รูปไม่ถูกต้องหรือมีขนาดใหญ่เกินไป");
  await sql`UPDATE invoices SET slip = ${slip || null}, slip_at = ${slip ? new Date().toISOString() : null}, has_slip = ${!!slip}, updated_at = now() WHERE id = ${o.inv.id}`;
  await audit(req, o.me, [{ area: "invoices", action: "update", recordId: o.inv.id, summary: `${o.inv.doc_no ?? ""} · ${slip ? "แนบหลักฐานการโอน" : "ลบหลักฐานการโอน"}`, branch: o.inv.branch_name }]);
  return NextResponse.json({ ok: true });
}

const money = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN; };

async function pay(req: NextRequest, me: import("@/lib/roles").SessionUser, id: string, b: Record<string, unknown>) {
  const cash = money(b.cash || 0), credit = money(b.credit || 0), transfer = money(b.transfer || 0);
  if ([cash, credit, transfer].some(Number.isNaN)) return bad("ยอดเงินไม่ถูกต้อง");
  const amount = Math.round((cash + credit + transfer) * 100) / 100;
  if (amount <= 0) return bad("กรุณาระบุยอดรับชำระ");
  const slip = typeof b.slip === "string" && b.slip ? b.slip : null;
  if (slip && (!slip.startsWith("data:image/") || slip.length > 900_000)) return bad("รูปไม่ถูกต้องหรือมีขนาดใหญ่เกินไป");
  if (transfer > 0 && !slip) return bad("กรุณาแนบหลักฐานการโอนเงิน");
  const date = typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : null;
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 200) || null : null;
  const pid = crypto.randomUUID();
  // ปรับยอดสะสมและบันทึกงวดในคำสั่งเดียว: ถ้ามีอีกเครื่องรับพร้อมกันจนยอดเกิน คำสั่งนี้จะไม่ทำอะไร
  const done = (await sql`
    WITH u AS (
      UPDATE invoices SET paid_total = paid_total + ${amount}, pay_cash = coalesce(pay_cash, 0) + ${cash}, pay_credit = coalesce(pay_credit, 0) + ${credit},
        pay_transfer = coalesce(pay_transfer, 0) + ${transfer}, paid_date = coalesce(${date}::date, (now() AT TIME ZONE 'Asia/Bangkok')::date), cashier = ${me.name},
        has_slip = has_slip OR ${!!slip}, updated_at = now(),
        status = CASE WHEN paid_total + ${amount} >= net - 0.005 THEN 'ชำระแล้ว' ELSE 'ชำระบางส่วน' END
      WHERE id = ${id} AND status IN ('ค้างชำระ', 'ชำระบางส่วน') AND paid_total + ${amount} <= net + 0.005
      RETURNING id, doc_no, status, net, paid_total, resident_name, branch_name
    ), p AS (
      INSERT INTO invoice_payments (id, invoice_id, pay_date, cash, credit, transfer, amount, cashier, note, slip, slip_at)
      SELECT ${pid}, id, coalesce(${date}::date, (now() AT TIME ZONE 'Asia/Bangkok')::date), ${cash}, ${credit}, ${transfer}, ${amount}, ${me.name}, ${note}, ${slip}, ${slip ? new Date().toISOString() : null}
      FROM u RETURNING id
    )
    SELECT u.* FROM u, p`) as { doc_no: string | null; status: string; net: number; paid_total: number; resident_name: string; branch_name: string | null }[];
  if (!done.length) {
    const [cur] = (await sql`SELECT status, net, paid_total FROM invoices WHERE id = ${id}`) as { status: string; net: number; paid_total: number }[];
    if (cur && !["ค้างชำระ", "ชำระบางส่วน"].includes(cur.status)) return bad(`รับชำระไม่ได้ เอกสารนี้สถานะ "${cur.status}"`, 409);
    return bad(`ยอดรับชำระเกินยอดคงเหลือ (คงเหลือ ${(Number(cur?.net ?? 0) - Number(cur?.paid_total ?? 0)).toFixed(2)} บาท) กรุณาตรวจสอบ`, 409);
  }
  const d = done[0];
  await audit(req, me, [{ area: "invoices", action: "update", recordId: id, summary: `${d.doc_no ?? ""} · รับชำระ ${amount.toFixed(2)} บาท${d.status === "ชำระแล้ว" ? " (ครบ)" : " (บางส่วน)"}`, branch: d.branch_name }]);
  return NextResponse.json({ ok: true, status: d.status, paid: Number(d.paid_total), net: Number(d.net) });
}
