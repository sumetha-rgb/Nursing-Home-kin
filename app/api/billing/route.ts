import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUser, forbidden, unauthorized } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { can } from "@/lib/perms";
import { readOnlyRole, seesAllBranches } from "@/lib/roles";
import { canSalesTax } from "@/lib/settingsAccess";
import { receiptPrefix, thaiDateStamp } from "@/lib/receiptNo";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * รับชำระใบแจ้งหนี้ (รับได้หลายงวด) และหลักฐานการโอนเงิน (เก็บแยกจากรายการ เพราะรูปใหญ่)
 *  ดูประวัติรับชำระ: ผู้มีสิทธิ์การเงินหรือสัญญา · รับชำระ / แนบสลิป: ต้องมีสิทธิ์การเงิน (billing)
 *  GET  ?id=…                          รายการรับชำระทั้งหมดของใบนี้ (งวด วันที่ วิธี ยอด สลิป)
 *  GET  ?op=payments[&branch=]          การรับเงินทุกงวด (ส่งออก CSV กระทบยอดเงินสด/โอน) · ไม่ส่งรูปสลิป
 *  GET  ?op=paid_days[&from=][&branch=] ยอดรับเงินรายวันต่อสาขา (รวมเป็นรายรับรายเดือนตามวันที่รับของแต่ละงวด)
 *  POST { op: "pay", id, cash, credit, transfer, date, slip?, note?, transferRef?, transferAccount?, cardAccount?, edc?, edcAccount? } · edc = ส่วนที่รูดเครื่อง EDC (นับรวมในยอดบัตร)  รับชำระ 1 งวด · ยอดรวมต้องไม่เกินยอดคงเหลือ
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
  if (!seesAllBranches(me.role) && inv.branch_name !== me.branch) return { res: forbidden() };
  return { me, inv };
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
  const br = seesAllBranches(me.role) ? q.get("branch") || null : me.branch;
  const fromQ = q.get("from") ?? "";
  const from = /^\d{4}-\d{2}-\d{2}$/.test(fromQ) ? fromQ : new Date(Date.now() + 7 * 3600e3 - 400 * 864e5).toISOString().slice(0, 10);
  const rows = await sql(`SELECT coalesce(i.branch_name, '') AS branch, p.pay_date::text AS date, sum(p.cash + p.credit + p.transfer)::float AS amount
      FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
      WHERE p.pay_date >= $1::date AND coalesce(i.status, '') <> 'ยกเลิก' ${br ? "AND i.branch_name = $2" : ""}
      GROUP BY 1, 2 ORDER BY 2`, br ? [from, br] : [from]);
  return NextResponse.json({ items: rows });
}

/**
 * ยอดค้างชำระ ณ วันที่ date (YYYY-MM-DD): ใบที่ออกถึงวันนั้น (ไม่นับใบยกเลิก ใบรอตรวจสอบยอด ใบลดหนี้) − เงินที่รับและหักด้วยใบลดหนี้ถึงวันนั้น
 *  ใช้กับภาพรวม/แท็บการเงินเมื่อเลือกเดือนที่ผ่านมา (ค้างชำระ ณ สิ้นเดือน) · ใบที่ยกเลิกภายหลังไม่นับ (ไม่มีวันที่ยกเลิก)
 */
async function owingAt(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (!can(me, "billing") && !can(me, "dashboard")) return forbidden();
  const q = req.nextUrl.searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q.get("date") ?? "") ? q.get("date")! : "";
  if (!date) return bad("วันที่ไม่ถูกต้อง");
  const br = seesAllBranches(me.role) ? q.get("branch") || null : me.branch;
  const [r] = (await sql(`SELECT count(*)::int AS n, coalesce(sum(bal), 0)::float AS sum, min(doc_date)::text AS oldest FROM (
      SELECT i.doc_date, i.net - coalesce((SELECT sum(p.amount) FROM invoice_payments p WHERE p.invoice_id = i.id AND p.pay_date <= $1::date), 0) AS bal
      FROM invoices i WHERE i.doc_date <= $1::date AND coalesce(i.status, '') NOT IN ('ยกเลิก', 'รอตรวจสอบยอด') AND coalesce(i.category, '') <> $2
        ${br ? "AND i.branch_name = $3" : ""}
    ) x WHERE bal > 0.005`, br ? [date, CN_KIND, br] : [date, CN_KIND])) as { n: number; sum: number; oldest: string | null }[];
  return NextResponse.json({ date, n: r?.n ?? 0, sum: Math.round((r?.sum ?? 0) * 100) / 100, oldest: r?.oldest ?? null });
}

/**
 * รายงานภาษีขายของเดือน (YYYY-MM): ใบกำกับภาษีที่ออกในเดือน = งวดรับเงิน (ไม่รวมใบลดหนี้หักยอด) + ใบลดหนี้ที่ออกในเดือน
 *  หน้าเว็บแบ่ง VAT ของแต่ละงวดตามลำดับตัดชำระ (lib/billing payTake) และจัดกลุ่มตามบริษัทของสาขา
 *  n = งวดที่ (นับเฉพาะงวดรับเงิน) · realN = จำนวนงวดรับเงินทั้งหมดของใบ · paidBefore = ยอดที่ตัดไปก่อนงวดนี้ (รวมใบลดหนี้หักยอด)
 */
async function salesTax(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (!canSalesTax(me)) return forbidden("รายงานภาษีขายดูได้เฉพาะผู้บริหาร ผู้จัดการสาขา และการเงิน");
  const q = req.nextUrl.searchParams;
  const month = /^\d{4}-\d{2}$/.test(q.get("month") ?? "") ? q.get("month")! : "";
  if (!month) return bad("เดือนไม่ถูกต้อง");
  const from = `${month}-01`, to = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const br = seesAllBranches(me.role) ? q.get("branch") || null : me.branch;
  const pays = await sql(`SELECT p.id, p.pay_date::text AS date, p.amount::float, i.id AS "invId", i.doc_no AS no, p.receipt_no AS "receiptNo", i.items_json AS items, i.net::float,
      i.payer_name AS payer, i.resident_name AS who, coalesce(i.payer_tax_id, '') AS "taxId", coalesce(i.payer_branch, '') AS "payerBranch", i.branch_name AS branch, i.status,
      (SELECT count(*) FROM invoice_payments q WHERE q.invoice_id = i.id AND coalesce(q.kind, 'pay') <> 'credit')::int AS "realN",
      (SELECT count(*) FROM invoice_payments q WHERE q.invoice_id = i.id AND coalesce(q.kind, 'pay') <> 'credit' AND (q.created_at, q.id) <= (p.created_at, p.id))::int AS n,
      coalesce((SELECT sum(q.amount) FROM invoice_payments q WHERE q.invoice_id = i.id AND (q.created_at, q.id) < (p.created_at, p.id)), 0)::float AS "paidBefore"
    FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
    WHERE coalesce(p.kind, 'pay') <> 'credit' AND p.pay_date BETWEEN $1::date AND $2::date
      AND coalesce(i.status, '') <> 'ยกเลิก' AND coalesce(i.category, '') <> $3 ${br ? "AND i.branch_name = $4" : ""}
    ORDER BY p.pay_date, p.created_at, p.id`, br ? [from, to, CN_KIND, br] : [from, to, CN_KIND]);
  const cns = await sql(`SELECT i.id, i.doc_date::text AS date, i.doc_no AS no, i.items_json AS items, i.net::float, i.payer_name AS payer, i.resident_name AS who,
      coalesce(i.payer_tax_id, '') AS "taxId", coalesce(i.payer_branch, '') AS "payerBranch", i.branch_name AS branch, coalesce(i.ref_no, '') AS ref
    FROM invoices i WHERE i.category = $3 AND i.doc_date BETWEEN $1::date AND $2::date AND coalesce(i.status, '') <> 'ยกเลิก' ${br ? "AND i.branch_name = $4" : ""}
    ORDER BY i.doc_date, i.doc_no`, br ? [from, to, CN_KIND, br] : [from, to, CN_KIND]);
  return NextResponse.json({ month, from, to, pays, cns });
}

/**
 * รายได้ตาม BUของเดือน: invs = ใบที่ออกในเดือน (ไม่รวมยกเลิก/ร่าง · ใบลดหนี้เป็นยอดลบ) · pays = งวดรับเงินในเดือน (ไม่รวมใบลดหนี้หักยอด)
 *  หน้าเว็บแบ่งลงรายการ → ฝ่าย → บริษัท (lib/bu) · paid = ยอดที่ตัดแล้วถึงตอนนี้ (ใช้คิดค้างรับของแต่ละรายการ)
 */
async function revenue(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (!canSalesTax(me)) return forbidden("รายงานนี้ดูได้เฉพาะผู้บริหาร ผู้จัดการสาขา และการเงิน");
  const q = req.nextUrl.searchParams;
  const month = /^\d{4}-\d{2}$/.test(q.get("month") ?? "") ? q.get("month")! : "";
  if (!month) return bad("เดือนไม่ถูกต้อง");
  // from/to (ไม่บังคับ) = ช่วงวันที่ที่เลือกเอง (หน้าภาพรวม › การเงิน) แทนทั้งเดือน
  const okd = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const qf = okd(q.get("from")), qt = okd(q.get("to"));
  const from = qf && qt && qf <= qt ? qf : `${month}-01`, to = qf && qt && qf <= qt ? qt : new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const br = seesAllBranches(me.role) ? q.get("branch") || null : me.branch;
  const invs = await sql(`SELECT i.id, i.doc_no AS no, i.doc_date::text AS date, i.items_json AS items, i.net::float, coalesce(i.paid_total, 0)::float AS paid,
      i.branch_name AS branch, i.status, (coalesce(i.category, '') = $3) AS cn
    FROM invoices i WHERE i.doc_date BETWEEN $1::date AND $2::date AND coalesce(i.status, '') NOT IN ('ยกเลิก', 'รอตรวจสอบยอด') ${br ? "AND i.branch_name = $4" : ""}`, br ? [from, to, CN_KIND, br] : [from, to, CN_KIND]);
  const pays = await sql(`SELECT p.id, p.pay_date::text AS date, p.amount::float, i.items_json AS items, i.branch_name AS branch,
      coalesce((SELECT sum(q.amount) FROM invoice_payments q WHERE q.invoice_id = i.id AND (q.created_at, q.id) < (p.created_at, p.id)), 0)::float AS "paidBefore"
    FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
    WHERE coalesce(p.kind, 'pay') <> 'credit' AND p.pay_date BETWEEN $1::date AND $2::date AND coalesce(i.status, '') <> 'ยกเลิก' AND coalesce(i.category, '') <> $3
      ${br ? "AND i.branch_name = $4" : ""}`, br ? [from, to, CN_KIND, br] : [from, to, CN_KIND]);
  return NextResponse.json({ month, invs, pays });
}

/**
 * เงินเข้าบัญชี: งวดรับเงินในช่วงวันที่ (ตามวันที่รับเงิน) พร้อมช่องทาง/บัญชี เลขอ้างอิง และรายการในใบ (ให้หน้าเว็บตัดตามลำดับชำระว่าเป็นค่าอะไร)
 *  ไม่นับงวดที่เป็นการหักด้วยใบลดหนี้ (kind = credit) และใบที่ยกเลิก · เห็นเฉพาะผู้บริหาร ผู้จัดการสาขา (สาขาตัวเอง) และการเงิน
 */
async function deposits(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (!canSalesTax(me)) return forbidden("รายงานนี้ดูได้เฉพาะผู้บริหาร ผู้จัดการสาขา และการเงิน");
  const q = req.nextUrl.searchParams;
  const ok = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const from = ok(q.get("from")), to = ok(q.get("to"));
  if (!from || !to || to < from) return bad("ช่วงวันที่ไม่ถูกต้อง");
  if (Date.parse(to) - Date.parse(from) > 400 * 864e5) return bad("เลือกช่วงได้ไม่เกิน 13 เดือน");
  const br = seesAllBranches(me.role) ? q.get("branch") || null : me.branch;
  const rows = await sql(`SELECT p.id, p.pay_date::text AS date, to_char(p.created_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS time,
      coalesce(p.receipt_no, '') AS "receiptNo", i.doc_no AS no, row_number() OVER (PARTITION BY p.invoice_id ORDER BY p.created_at, p.id)::int AS n,
      coalesce((SELECT sum(x.amount) FROM invoice_payments x WHERE x.invoice_id = p.invoice_id AND (x.created_at, x.id) < (p.created_at, p.id)), 0)::float AS "paidBefore",
      i.items_json AS items, coalesce(i.branch_name, '') AS branch, coalesce(nullif(nullif(trim(b.legal_entity), ''), '-'), '') AS legal,
      coalesce(i.resident_name, '-') AS who, p.cash::float, p.transfer::float, p.credit::float, p.edc::float, p.wht::float, p.amount::float,
      coalesce(p.transfer_ref, '') AS "transferRef", coalesce(p.transfer_account, '') AS "transferAccount", coalesce(p.card_account, '') AS "cardAccount",
      coalesce(p.edc_account, '') AS "edcAccount", coalesce(p.cashier, '') AS cashier
    FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id LEFT JOIN branches b ON b.name = i.branch_name
    WHERE p.pay_date BETWEEN $1::date AND $2::date AND coalesce(p.kind, 'pay') <> 'credit' AND coalesce(i.status, '') <> $3 ${br ? "AND i.branch_name = $4" : ""}
    ORDER BY p.pay_date, p.created_at, p.id LIMIT 5000`, br ? [from, to, "ยกเลิก", br] : [from, to, "ยกเลิก"]);
  return NextResponse.json({ from, to, rows });
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("op") === "deposits") return deposits(req);
  if (req.nextUrl.searchParams.get("op") === "paid_days") return paidDays(req);
  if (req.nextUrl.searchParams.get("op") === "revenue") return revenue(req);
  if (req.nextUrl.searchParams.get("op") === "sales_tax") return salesTax(req);
  if (req.nextUrl.searchParams.get("op") === "owing_at") return owingAt(req);
  if (req.nextUrl.searchParams.get("op") === "payments") {
    const me = await currentUser(req);
    if (!me) return unauthorized();
    if (!can(me, "billing")) return forbidden();
    const br = seesAllBranches(me.role) ? req.nextUrl.searchParams.get("branch") || null : me.branch;
    // items + paidBefore: ให้หน้าเว็บแบ่งยอดแต่ละงวดตามลำดับตัดชำระ (รายการที่มี VAT ก่อน · lib/billing payTake)
    const rows = await sql(`SELECT p.pay_date::text AS date, i.doc_no AS no, row_number() OVER (PARTITION BY p.invoice_id ORDER BY p.created_at, p.id)::int AS n,
        coalesce(sum(p.amount) OVER (PARTITION BY p.invoice_id ORDER BY p.created_at, p.id ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0)::float AS "paidBefore", i.items_json AS items,
        i.branch_name AS branch, i.resident_name AS who, i.hn, i.payer_name AS payer, i.category AS kind, i.status,
        p.cash::float, p.transfer::float, p.credit::float, p.amount::float, p.wht::float, p.kind AS pkind, coalesce(p.cashier, '') AS cashier, coalesce(p.note, '') AS note, (p.slip IS NOT NULL AND p.slip <> '') AS slip,
        coalesce(p.transfer_ref, '') AS "transferRef", coalesce(p.transfer_account, '') AS "transferAccount", coalesce(p.card_account, '') AS "cardAccount", p.edc::float, coalesce(p.edc_account, '') AS "edcAccount", coalesce(p.receipt_no, '') AS "receiptNo"
      FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id ${br ? "WHERE i.branch_name = $1" : ""}
      ORDER BY p.pay_date DESC NULLS LAST, p.created_at DESC LIMIT 5000`, br ? [br] : []);
    return NextResponse.json({ items: rows });
  }
  const o = await owned(req, req.nextUrl.searchParams.get("id") ?? "");
  if (!o.inv) return o.res;
  const payments = await sql`
    SELECT id, pay_date::text AS date, cash::float, credit::float, transfer::float, amount::float, wht::float, kind, coalesce(cashier, '') AS cashier, coalesce(note, '') AS note, slip,
           transfer_ref AS "transferRef", transfer_account AS "transferAccount", card_account AS "cardAccount", edc::float, edc_account AS "edcAccount", receipt_no AS "receiptNo",
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
  // รับชำระ / แนบหลักฐานการโอน = งานการเงิน: ต้องมีสิทธิ์ใบแจ้งหนี้และใบเสร็จ (สิทธิ์สัญญาอย่างเดียวดูได้แต่รับเงินไม่ได้)
  if (!can(o.me, "billing")) return forbidden("บัญชีนี้ไม่มีสิทธิ์รับชำระเงิน (ต้องมีสิทธิ์ใบแจ้งหนี้และใบเสร็จ)");
  if (readOnlyRole(o.me.role)) return forbidden("บัญชีการเงิน/บัญชี ดูและส่งออกข้อมูลได้อย่างเดียว");
  if (b.op === "pay") return pay(req, o.me, o.inv.id, b);
  if (b.op === "credit_note") return creditNote(req, o.me, o.inv.id, b);
  if (b.op === "refund_done") return refundDone(req, o.me, o.inv.id, b);
  const slip = typeof b.slip === "string" ? b.slip : "";
  if (slip && (!slip.startsWith("data:image/") || slip.length > 900_000)) return bad("รูปไม่ถูกต้องหรือมีขนาดใหญ่เกินไป");
  await sql`UPDATE invoices SET slip = ${slip || null}, slip_at = ${slip ? new Date().toISOString() : null}, has_slip = ${!!slip}, updated_at = now() WHERE id = ${o.inv.id}`;
  await audit(req, o.me, [{ area: "invoices", action: "update", recordId: o.inv.id, summary: `${o.inv.doc_no ?? ""} · ${slip ? "แนบหลักฐานการโอน" : "ลบหลักฐานการโอน"}`, branch: o.inv.branch_name }]);
  return NextResponse.json({ ok: true });
}

const money = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : NaN; };

async function pay(req: NextRequest, me: import("@/lib/roles").SessionUser, id: string, b: Record<string, unknown>) {
  // edc = รูดบัตรผ่านเครื่อง EDC (แยกจากบัตรเครดิตช่องทางอื่น) · เก็บในยอดบัตร (credit) รวมด้วย รายงานเดิมที่นับยอดบัตรไม่เปลี่ยน
  const cash = money(b.cash || 0), card = money(b.credit || 0), edc = money(b.edc || 0), transfer = money(b.transfer || 0), wht = money(b.wht || 0);
  if ([cash, card, edc, transfer, wht].some(Number.isNaN)) return bad("ยอดเงินไม่ถูกต้อง");
  const credit = Math.round((card + edc) * 100) / 100;
  // ภาษีหัก ณ ที่จ่าย ตัดยอดค้างด้วย (ผู้ชำระนำส่งสรรพากรแทน) แต่ไม่ใช่เงินที่รับเข้า · ต้องมีเงินรับจริงในงวดเดียวกัน
  const amount = Math.round((cash + credit + transfer + wht) * 100) / 100;
  if (cash + credit + transfer <= 0) return bad("กรุณาระบุยอดรับชำระ");
  const slip = typeof b.slip === "string" && b.slip ? b.slip : null;
  if (slip && (!slip.startsWith("data:image/") || slip.length > 900_000)) return bad("รูปไม่ถูกต้องหรือมีขนาดใหญ่เกินไป");
  if (transfer > 0 && !slip) return bad("กรุณาแนบหลักฐานการโอนเงิน");
  const date = typeof b.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.date) ? b.date : null;
  const note = typeof b.note === "string" ? b.note.trim().slice(0, 200) || null : null;
  // เลขอ้างอิงการโอน (ไม่บังคับ) · เก็บเฉพาะเมื่อมียอดโอน
  const transferRef = transfer > 0 && typeof b.transferRef === "string" ? b.transferRef.replace(/\s+/g, " ").trim().slice(0, 40) || null : null;
  // เงินเข้าบัญชีไหน: มียอดโอนต้องเลือกบัญชีรับโอน · มียอดบัตรต้องเลือกเครื่องรูดบัตร/ช่องทางบัตร (เงินสดไม่ต้องเลือก)
  const acct = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 80) : "");
  const transferAccount = transfer > 0 ? acct(b.transferAccount) || null : null;
  const cardAccount = card > 0 ? acct(b.cardAccount) || null : null;
  const edcAccount = edc > 0 ? acct(b.edcAccount) || null : null;
  if (transfer > 0 && !transferAccount) return bad("กรุณาเลือกบัญชีที่เงินโอนเข้า");
  if (edc > 0 && !edcAccount) return bad("กรุณาเลือกเครื่อง EDC ที่รูดบัตร");
  if (card > 0 && !cardAccount) return bad("กรุณาเลือกช่องทางบัตรเครดิต");
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
      INSERT INTO invoice_payments (id, invoice_id, pay_date, cash, credit, transfer, amount, wht, cashier, note, slip, slip_at, transfer_ref, transfer_account, card_account, edc, edc_account)
      SELECT ${pid}, id, coalesce(${date}::date, (now() AT TIME ZONE 'Asia/Bangkok')::date), ${cash}, ${credit}, ${transfer}, ${amount}, ${wht}, ${me.name}, ${note}, ${slip}, ${slip ? new Date().toISOString() : null}, ${transferRef}, ${transferAccount}, ${cardAccount}, ${edc}, ${edcAccount}
      FROM u RETURNING id
    )
    SELECT u.* FROM u, p`) as { doc_no: string | null; status: string; net: number; paid_total: number; resident_name: string; branch_name: string | null }[];
  if (!done.length) {
    const [cur] = (await sql`SELECT status, net, paid_total FROM invoices WHERE id = ${id}`) as { status: string; net: number; paid_total: number }[];
    if (cur && !["ค้างชำระ", "ชำระบางส่วน"].includes(cur.status)) return bad(`รับชำระไม่ได้ เอกสารนี้สถานะ "${cur.status}"`, 409);
    return bad(`ยอดรับชำระเกินยอดคงเหลือ (คงเหลือ ${(Number(cur?.net ?? 0) - Number(cur?.paid_total ?? 0)).toFixed(2)} บาท) กรุณาตรวจสอบ`, 409);
  }
  const d = done[0];
  // ออกเลขไม่สำเร็จ ห้ามทำให้การรับเงินที่บันทึกแล้วดูเหมือนล้มเหลว (แคชเชียร์จะกดรับซ้ำ) · ใบเสร็จใช้เลขเดิมแทน
  const receiptNo = await numberReceipt(pid, d.branch_name).catch((e) => { console.error("numberReceipt", e); return null; });
  await audit(req, me, [{ area: "invoices", action: "update", recordId: id, summary: `${d.doc_no ?? ""}${receiptNo ? ` · ใบเสร็จ ${receiptNo}` : ""} · รับชำระ ${(amount - wht).toFixed(2)} บาท${wht ? ` · หัก ณ ที่จ่าย ${wht.toFixed(2)} บาท` : ""}${transferAccount ? ` · โอนเข้า ${transferAccount}` : ""}${edcAccount ? ` · EDC ${edcAccount}` : ""}${cardAccount ? ` · บัตร ${cardAccount}` : ""}${d.status === "ชำระแล้ว" ? " (ครบ)" : " (บางส่วน)"}`, branch: d.branch_name }]);
  return NextResponse.json({ ok: true, status: d.status, paid: Number(d.paid_total), net: Number(d.net), receiptNo });
}

/** เลขที่ใบเสร็จของงวด: <KN|KO>-RC + ปีเดือนวันที่รับเงิน + ลำดับของวัน (ตัวหน้าตามบริษัทของสาขา) · ชนกับอีกเครื่อง = ลองใหม่ */
async function numberReceipt(payId: string, branch: string | null): Promise<string | null> {
  const [b] = (await sql`SELECT legal_entity FROM branches WHERE name = ${branch ?? ""} LIMIT 1`) as { legal_entity: string | null }[];
  const [p] = (await sql`SELECT pay_date::text AS d FROM invoice_payments WHERE id = ${payId}`) as { d: string }[];
  if (!p) return null;
  const prefix = `${receiptPrefix(b?.legal_entity)}-RC${thaiDateStamp(p.d)}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [r] = (await sql(`UPDATE invoice_payments SET receipt_no = $2 || lpad((SELECT coalesce(max(right(receipt_no, 4)::int), 0) + 1 FROM invoice_payments WHERE receipt_no LIKE $2 || '%')::text, 4, '0')
          WHERE id = $1 AND receipt_no IS NULL RETURNING receipt_no`, [payId, prefix])) as { receipt_no: string }[];
      return r?.receipt_no ?? null;
    } catch (e) { if (attempt === 4) throw e; }
  }
  return null;
}

/* ---------- ใบลดหนี้ ---------- */
const CN_KIND = "ใบลดหนี้", CN_DONE = "ลดหนี้แล้ว", CN_REFUND = "รอคืนเงิน", CN_REFUNDED = "คืนเงินแล้ว";
type Item = { desc: string; qty: number; price: number; discount: number; vat?: number; credit?: boolean; pct?: number };
const r2 = (n: number) => Math.round(n * 100) / 100;
/** เลขที่ใบลดหนี้: KN-CN + ปีเดือนวัน + ลำดับของวัน 4 หลัก */
const cnPrefix = () => { const d = new Date(Date.now() + 7 * 3600e3); return `KN-CN${String((d.getUTCFullYear() + 543) % 100).padStart(2, "0")}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`; };

/**
 * ออกใบลดหนี้อ้างอิงใบเดิม { amount (รวม VAT), reason }
 *  ยอดลดหนี้แบ่ง VAT ตามสัดส่วนของใบเดิม (มูลค่าที่มี VAT ต่ออัตรา / มูลค่าไม่มี VAT)
 *  ใบเดิมยังค้างอยู่ = หักยอดค้างให้ (บันทึกงวด kind 'credit' ไม่มีเงินเข้า) · ส่วนที่เกินยอดค้าง = ต้องคืนเงินลูกค้า (สถานะ รอคืนเงิน)
 */
async function creditNote(req: NextRequest, me: import("@/lib/roles").SessionUser, id: string, b: Record<string, unknown>) {
  if (!can(me, "invoices.void")) return forbidden("ออกใบลดหนี้ได้เฉพาะผู้มีสิทธิ์ยกเลิกใบแจ้งหนี้ / ใบเสร็จ (ผู้จัดการสาขา ผู้บริหาร)");
  const amount = money(b.amount), reason = typeof b.reason === "string" ? b.reason.trim().slice(0, 200) : "";
  if (Number.isNaN(amount) || amount <= 0) return bad("กรุณาระบุยอดลดหนี้");
  if (!reason) return bad("กรุณาระบุเหตุผลที่ลดหนี้");
  const [o] = (await sql`SELECT * FROM invoices WHERE id = ${id}`) as Record<string, unknown>[];
  if (!o) return bad("ไม่พบเอกสาร", 404);
  if (o.category === CN_KIND) return bad("ออกใบลดหนี้ซ้อนจากใบลดหนี้ไม่ได้");
  if (!["ค้างชำระ", "ชำระบางส่วน", "ชำระแล้ว"].includes(String(o.status))) return bad(`ออกใบลดหนี้ไม่ได้ เอกสารนี้สถานะ "${o.status}"`, 409);
  const net = Number(o.net) || 0, paid = Number(o.paid_total) || 0;
  const [prev] = (await sql`SELECT coalesce(sum(net), 0)::float AS n FROM invoices WHERE category = ${CN_KIND} AND ref_no = ${String(o.doc_no ?? "")}`) as { n: number }[];
  const room = r2(net - (prev?.n ?? 0));
  if (amount > room + 0.005) return bad(`ยอดลดหนี้เกินยอดที่ลดได้ (ลดได้อีก ${room.toFixed(2)} บาท)`, 409);
  // แบ่ง VAT ตามสัดส่วนของใบเดิม (หลังส่วนลด) · บรรทัดหักเงินที่รับไว้แล้วไม่นับ
  let items: Item[] = [];
  try { items = JSON.parse(String(o.items_json ?? "[]")); } catch { items = []; }
  // ลดจากค่าบริการก่อน ไม่ลดเงินประกัน (เงินประกันคืนแยกตอนกลับบ้าน) · ใบที่มีแต่เงินประกันจึงใช้บรรทัดนั้น
  const all = items.filter((i) => !i.credit), svc = all.filter((i) => !/^เงินประกัน/.test(String(i.desc ?? "").trim()));
  const sale = svc.length ? svc : all;
  const lineNet = (i: Item) => Math.max(0, i.qty * i.price - (Number(i.discount) || 0) - (i.qty * i.price * (Number(i.pct) || 0)) / 100);
  const groups = new Map<number, number>();
  for (const i of sale) groups.set(Number(i.vat) || 0, (groups.get(Number(i.vat) || 0) ?? 0) + lineNet(i));
  const gross = [...groups].reduce((n, [rate, base]) => n + base * (1 + rate / 100), 0) || 1;
  const reasonDesc = `ลดหนี้ตามใบ ${o.doc_no ?? ""}: ${reason}`;
  let left = amount;
  const cnItems = [...groups].filter(([, base]) => base > 0).sort((a, b2) => b2[0] - a[0]).map(([rate, base], k, arr) => {
    const share = k === arr.length - 1 ? left : r2((amount * base * (1 + rate / 100)) / gross);
    left = r2(left - share);
    return { desc: rate ? reasonDesc : `${reasonDesc} (ไม่มี VAT)`, qty: 1, price: r2(share / (1 + rate / 100)), discount: 0, vat: rate };
  });
  if (!cnItems.length) cnItems.push({ desc: reasonDesc, qty: 1, price: amount, discount: 0, vat: 0 });
  // ปัดเศษ VAT ให้ยอดรวมตรงกับยอดลดหนี้
  const vatSum = cnItems.reduce((n, i) => n + r2((i.price * i.vat) / 100), 0), base = cnItems.reduce((n, i) => n + i.price, 0);
  const diff = r2(amount - (base + vatSum));
  if (diff) cnItems[cnItems.length - 1].price = r2(cnItems[cnItems.length - 1].price + diff);
  const applied = Math.min(amount, r2(net - paid)), refund = r2(amount - Math.max(0, applied));
  const cid = crypto.randomUUID(), prefix = cnPrefix();
  const status = refund > 0.005 ? CN_REFUND : CN_DONE;
  const note = `${reason}${refund > 0.005 ? ` · ต้องคืนเงินลูกค้า ${refund.toFixed(2)} บาท` : ""}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await sql`INSERT INTO invoices (id, sort_order, doc_no, doc_date, branch_name, resident_id, resident_name, hn, payer_name, payer_address, payer_tax_id, payer_branch, category, contract_no, items_json, total, discount, net, status, paid_total, cashier, note, ref_no, updated_at)
        SELECT ${cid}, ${Date.now()}, ${prefix} || lpad((SELECT count(*) + 1 FROM invoices WHERE doc_no LIKE ${prefix} || '%')::text, 4, '0'), (now() AT TIME ZONE 'Asia/Bangkok')::date, branch_name, resident_id, resident_name, hn, payer_name, payer_address, payer_tax_id, payer_branch,
          ${CN_KIND}, contract_no, ${JSON.stringify(cnItems)}, ${r2(base + diff)}, 0, ${amount}, ${status}, 0, ${me.name}, ${note}, doc_no
        FROM invoices WHERE id = ${id}`;
      break;
    } catch (e) { if (attempt === 4) throw e; }
  }
  if (applied > 0.005) {
    // หักยอดค้างของใบเดิม (ไม่มีเงินเข้า จึงไม่นับเป็นเงินรับ)
    await sql`WITH u AS (UPDATE invoices SET paid_total = paid_total + ${applied}, updated_at = now(),
        status = CASE WHEN paid_total + ${applied} >= net - 0.005 THEN 'ชำระแล้ว' ELSE 'ชำระบางส่วน' END WHERE id = ${id} RETURNING id)
      INSERT INTO invoice_payments (id, invoice_id, pay_date, cash, credit, transfer, amount, wht, kind, cashier, note)
      SELECT ${crypto.randomUUID()}, id, (now() AT TIME ZONE 'Asia/Bangkok')::date, 0, 0, 0, ${applied}, 0, 'credit', ${me.name}, ${`ลดหนี้ ${reason}`} FROM u`;
  }
  const [cn] = (await sql`SELECT doc_no FROM invoices WHERE id = ${cid}`) as { doc_no: string }[];
  await audit(req, me, [{ area: "invoices", action: "create", recordId: cid, branch: o.branch_name as string | null,
    summary: `ใบลดหนี้ ${cn?.doc_no ?? ""} อ้างอิง ${o.doc_no ?? ""} · ${amount.toFixed(2)} บาท · ${reason}${applied > 0.005 ? ` · หักยอดค้าง ${applied.toFixed(2)}` : ""}${refund > 0.005 ? ` · ต้องคืนเงิน ${refund.toFixed(2)}` : ""}` }]);
  return NextResponse.json({ ok: true, id: cid, no: cn?.doc_no, applied: Math.max(0, applied), refund });
}

/** บันทึกว่าคืนเงินตามใบลดหนี้แล้ว { method, note } */
async function refundDone(req: NextRequest, me: import("@/lib/roles").SessionUser, id: string, b: Record<string, unknown>) {
  if (!can(me, "invoices.void")) return forbidden("บันทึกการคืนเงินได้เฉพาะผู้มีสิทธิ์ยกเลิกใบแจ้งหนี้ / ใบเสร็จ");
  const method = typeof b.method === "string" ? b.method.trim().slice(0, 60) : "";
  if (!method) return bad("กรุณาระบุวิธีคืนเงิน");
  const done = (await sql`UPDATE invoices SET status = ${CN_REFUNDED}, note = coalesce(note, '') || ${` · คืนเงินแล้ว (${method}) โดย ${me.name} ${new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)}`}, updated_at = now()
    WHERE id = ${id} AND category = ${CN_KIND} AND status = ${CN_REFUND} RETURNING doc_no, branch_name, net`) as { doc_no: string; branch_name: string | null; net: number }[];
  if (!done.length) return bad("บันทึกไม่ได้ ใบนี้ไม่ได้อยู่ในสถานะรอคืนเงิน", 409);
  await audit(req, me, [{ area: "invoices", action: "update", recordId: id, branch: done[0].branch_name, summary: `${done[0].doc_no} · คืนเงินลูกค้าแล้ว (${method})` }]);
  return NextResponse.json({ ok: true });
}
