/** ใบแจ้งหนี้ / ใบเสร็จรับเงิน (ชุดข้อมูล "invoices") ใช้ได้ทั้งหน้าเว็บและ server */

/** discount = ส่วนลดเป็นบาท · pct = ส่วนลดเป็น % ของยอดบรรทัด (ใช้ได้ทั้งสองอย่างพร้อมกัน) */
export type BillItem = { desc: string; qty: number; price: number; discount: number; pct?: number };
export type Invoice = {
  id: string; no?: string; date: string; who: string; hn: string; payer: string; address: string;
  kind: string; contract: string; items: string; total: number; discount: number; net: number;
  status: string; paid?: number; cash?: number; credit?: number; transfer?: number; paidDate?: string; cashier?: string; note?: string; slip?: boolean;
};

export const BILL_KINDS = ["มัดจำ / แรกเข้า", "ค่าบริการรายเดือน", "ค่าหัตถการ", "คอร์สกายภาพ", "เวชภัณฑ์และอื่น ๆ", "สรุปค่าใช้จ่ายก่อนกลับบ้าน (D/C)"];
export const UNPAID = "ค้างชำระ", PARTIAL = "ชำระบางส่วน", PAID = "ชำระแล้ว", VOID = "ยกเลิก";
/** ยังเก็บเงินไม่ครบ (ยังไม่ได้รับชำระ หรือรับแล้วบางส่วน) */
export const isOpen = (x: { status: string }) => x.status === UNPAID || x.status === PARTIAL;
/** ยอดที่ยังค้างอยู่ */
export const balanceOf = (x: { net: number; paid?: number }) => Math.max(0, Math.round((x.net - (x.paid ?? 0)) * 100) / 100);
/** รายการรับชำระ 1 งวด (จาก /api/billing) */
export type Payment = { id: string; n: number; date: string; cash: number; credit: number; transfer: number; amount: number; cashier: string; note: string; slip: string | null; slipAt: string | null; paidBefore: number };

export const parseItems = (json: string): BillItem[] => {
  try { const x = JSON.parse(json || "[]"); return Array.isArray(x) ? x.map((i) => ({ desc: String(i.desc ?? ""), qty: Number(i.qty) || 0, price: Number(i.price) || 0, discount: Number(i.discount) || 0, pct: Number(i.pct) || 0 })) : []; }
  catch { return []; }
};
export const lineAmount = (i: BillItem) => i.qty * i.price;
/** ส่วนลดรวมของบรรทัด = บาท + % ของยอดบรรทัด (ปัดเป็นสตางค์) */
export const lineDiscount = (i: BillItem) => Math.round((i.discount + (lineAmount(i) * (i.pct ?? 0)) / 100) * 100) / 100;
export function totals(items: BillItem[]) {
  const total = items.reduce((n, i) => n + lineAmount(i), 0);
  const discount = items.reduce((n, i) => n + lineDiscount(i), 0);
  return { total, discount, net: Math.max(0, total - discount) };
}

export const money = (n: number | undefined) => (n ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** 2026-10-28 → 28-10-2569 (รูปแบบวันที่ในใบเสร็จ) */
export const docDate = (iso?: string) => { if (!iso) return "-"; const [y, m, d] = iso.slice(0, 10).split("-"); return `${d}-${m}-${Number(y) + 543}`; };
export const todayIso = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);

/* ---------- จำนวนเงินเป็นตัวอักษร ---------- */
const DIGIT = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const PLACE = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];
function readInt(n: number): string {
  if (n === 0) return "";
  if (n >= 1_000_000) return readInt(Math.floor(n / 1_000_000)) + "ล้าน" + readInt(n % 1_000_000);
  const s = String(n);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const d = Number(s[i]), p = s.length - i - 1;
    if (d === 0) continue;
    if (p === 1 && d === 1) out += "สิบ";
    else if (p === 1 && d === 2) out += "ยี่สิบ";
    else if (p === 0 && d === 1 && s.length > 1) out += "เอ็ด";
    else out += DIGIT[d] + PLACE[p];
  }
  return out;
}
/** 1500 → "หนึ่งพันห้าร้อยบาทถ้วน" · 1500.25 → "หนึ่งพันห้าร้อยบาทยี่สิบห้าสตางค์" */
export function bahtText(amount: number) {
  const satang = Math.round(amount * 100);
  const baht = Math.floor(satang / 100), st = satang % 100;
  if (!baht && !st) return "ศูนย์บาทถ้วน";
  return (baht ? readInt(baht) + "บาท" : "") + (st ? readInt(st) + "สตางค์" : "ถ้วน");
}
