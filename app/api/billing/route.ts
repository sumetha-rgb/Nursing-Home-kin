import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUser, forbidden, unauthorized } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { can } from "@/lib/perms";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * รับชำระใบแจ้งหนี้ (รับได้หลายงวด) และหลักฐานการโอนเงิน (เก็บแยกจากรายการ เพราะรูปใหญ่) · ผู้มีสิทธิ์การเงินหรือสัญญา
 *  GET  ?id=…                          รายการรับชำระทั้งหมดของใบนี้ (งวด วันที่ วิธี ยอด สลิป)
 *  POST { op: "pay", id, cash, credit, transfer, date, slip?, note? }  รับชำระ 1 งวด · ยอดรวมต้องไม่เกินยอดคงเหลือ
 *                                       ครบยอด = ชำระแล้ว (เป็นใบเสร็จ) · ยังไม่ครบ = ชำระบางส่วน
 *  POST { id, slip }                   แนบ/เปลี่ยนรูปของใบที่รับชำระครั้งเดียว (slip = "" ลบรูป)
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

export async function GET(req: NextRequest) {
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
  const o = await owned(req, String(b.id ?? ""));
  if (!o.inv) return o.res;
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
