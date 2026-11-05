/** ใบแจ้งหนี้ / ใบเสร็จรับเงิน (ชุดข้อมูล "invoices") ใช้ได้ทั้งหน้าเว็บและ server */

/**
 * discount = ส่วนลดเป็นบาท · pct = ส่วนลดเป็น % ของยอดบรรทัด (ใช้ได้ทั้งสองอย่างพร้อมกัน)
 * vat = อัตราภาษีมูลค่าเพิ่ม (%) ที่บวกเพิ่มจากยอดหลังส่วนลด · 0 / ไม่มี = ไม่มี VAT · เก็บอัตราไว้ในบรรทัด ใบเก่าไม่เปลี่ยนเมื่อปรับอัตรา
 */
/** code = รหัสจากหน้าราคา (เช่น NS-21-M) เมื่อเลือกจากหน้าราคา · ใช้ดูยอดขายตามหมวด */
export type BillItem = { desc: string; qty: number; price: number; discount: number; pct?: number; vat?: number; credit?: boolean; code?: string };
/** อัตรา VAT เริ่มต้นของใบใหม่ (%) · แก้ได้ในฟอร์มใบแจ้งหนี้และสัญญา */
export const DEFAULT_VAT = 7;
/** อัตรา VAT ค่าห้องของสัญญา (คอลัมน์ room_vat) บวกเพิ่มจากค่าห้อง · ว่าง (สัญญาเก่า) = อัตราเริ่มต้น · 0 = ไม่คิด VAT */
export const contractVat = (r: string[]) => { const v = r[30]; return v === undefined || v === "" || v === "-" ? DEFAULT_VAT : Math.max(0, Number(v) || 0); };
export type Invoice = {
  id: string; no?: string; date: string; who: string; hn: string; payer: string; address: string;
  kind: string; contract: string; items: string; total: number; discount: number; net: number;
  status: string; paid?: number; cash?: number; credit?: number; transfer?: number; paidDate?: string; cashier?: string; note?: string; slip?: boolean;
};

export const BILL_KINDS = ["มัดจำ / แรกเข้า", "ค่าบริการรายเดือน", "ค่าหัตถการ", "คอร์สกายภาพ", "เวชภัณฑ์และอื่น ๆ", "สรุปค่าใช้จ่ายก่อนกลับบ้าน (D/C)"];
export const UNPAID = "ค้างชำระ", PARTIAL = "ชำระบางส่วน", PAID = "ชำระแล้ว", VOID = "ยกเลิก";
/** ใบที่ระบบออกให้จากสัญญาที่ไม่ได้ระบุยอดล่วงหน้า · ยังรับชำระไม่ได้จนกว่าการเงินกดยืนยันยอด (เป็นค้างชำระ) */
export const DRAFT = "รอตรวจสอบยอด";
/** ยังเก็บเงินไม่ครบ (ยังไม่ได้รับชำระ หรือรับแล้วบางส่วน) */
export const isOpen = (x: { status: string }) => x.status === UNPAID || x.status === PARTIAL;
/** ยอดที่ยังค้างอยู่ */
export const balanceOf = (x: { net: number; paid?: number }) => Math.max(0, Math.round((x.net - (x.paid ?? 0)) * 100) / 100);
/** รายการรับชำระ 1 งวด (จาก /api/billing) */
export type Payment = { id: string; n: number; date: string; cash: number; credit: number; transfer: number; amount: number; cashier: string; note: string; slip: string | null; slipAt: string | null; paidBefore: number };

export const parseItems = (json: string): BillItem[] => {
  try { const x = JSON.parse(json || "[]"); return Array.isArray(x) ? x.map((i) => ({ desc: String(i.desc ?? ""), qty: Number(i.qty) || 0, price: Number(i.price) || 0, discount: Number(i.discount) || 0, pct: Number(i.pct) || 0, vat: i.vat === true ? DEFAULT_VAT : Number(i.vat) || 0, ...(i.credit ? { credit: true } : {}), ...(typeof i.code === "string" && i.code ? { code: i.code } : {}) })) : []; }
  catch { return []; }
};
export const lineAmount = (i: BillItem) => i.qty * i.price;
/** ส่วนลดของบรรทัดค่าบริการในสัญญา / ใบเสนอราคา (บาท) = % ของยอดบรรทัด + ส่วนลดเป็นบาท (ข้อมูลเดิม) */
export const svcDiscount = (x: { qty: number; price: number; discount?: number; pct?: number }) => Math.round(x.qty * x.price * (Number(x.pct) || 0)) / 100 + (Number(x.discount) || 0);
/** ยอดบรรทัด = จำนวน × ราคาต่อหน่วย − ส่วนลด */
export const svcNet = (x: { qty: number; price: number; discount?: number; pct?: number }) => Math.max(0, x.qty * x.price - svcDiscount(x));
/** ส่วนลดรวมของบรรทัด = บาท + % ของยอดบรรทัด (ปัดเป็นสตางค์) */
export const lineDiscount = (i: BillItem) => Math.round((i.discount + (lineAmount(i) * (i.pct ?? 0)) / 100) * 100) / 100;
/** บรรทัดหักเงินที่รับไว้แล้ว (เช่น มัดจำห้องตอนจอง) · หักหลังรวม VAT ไม่ใช่ส่วนลด */
export const isCredit = (i: BillItem) => !!i.credit;
/** ยอดหักเงินที่รับไว้แล้วของใบ */
export const creditOf = (items: BillItem[]) => r2(items.filter(isCredit).reduce((n, i) => n + lineAmount(i), 0));
/**
 * ยอดของใบ: total = ก่อนส่วนลด · discount = ส่วนลด · grand = หลังส่วนลด + VAT · net = ยอดที่ต้องชำระ (grand − เงินที่รับไว้แล้ว)
 * VAT คิดแบบบวกเพิ่มจากยอดหลังส่วนลดของบรรทัดที่ติ๊ก vat (ปัดเป็นสตางค์) · บรรทัดหักเงินที่รับไว้แล้วไม่นับใน total / ส่วนลด / VAT
 */
export function totals(items: BillItem[]) {
  const sale = items.filter((i) => !isCredit(i));
  const total = sale.reduce((n, i) => n + lineAmount(i), 0);
  const discount = sale.reduce((n, i) => n + lineDiscount(i), 0);
  const grand = r2(total - discount + vatOf(sale).vat);
  return { total, discount, net: Math.max(0, r2(grand - creditOf(items))) };
}
/** ยอดรวมทั้งสิ้นรวม VAT ก่อนหักเงินที่รับไว้แล้ว */
export const grandOf = (items: BillItem[]) => { const sale = items.filter((i) => !isCredit(i)); return r2(sale.reduce((n, i) => n + lineNet(i), 0) + vatOf(sale).vat); };
/** ยอดบรรทัดหลังส่วนลด (ก่อน VAT) */
export const lineNet = (i: BillItem) => Math.max(0, lineAmount(i) - lineDiscount(i));
function r2(n: number) { return Math.round(n * 100) / 100; }
/**
 * แยกยอด VAT ของใบ: rates = แต่ละอัตรา {rate, base, vat} · base / vat = รวมทุกอัตรา · exempt = มูลค่าที่ไม่มี VAT (หลังส่วนลด)
 * ภาษีคิดรวมต่ออัตราแล้วปัดเป็นสตางค์
 */
export function vatOf(all: BillItem[]) {
  const items = all.filter((i) => !i.credit);
  const rates = [...new Set(items.filter((i) => i.vat).map((i) => i.vat!))].sort((a, b) => a - b).map((rate) => {
    const base = r2(items.filter((i) => i.vat === rate).reduce((n, i) => n + lineNet(i), 0));
    return { rate, base, vat: r2((base * rate) / 100) };
  });
  return { rates, base: r2(rates.reduce((n, x) => n + x.base, 0)), vat: r2(rates.reduce((n, x) => n + x.vat, 0)), exempt: r2(items.filter((i) => !i.vat).reduce((n, i) => n + lineNet(i), 0)) };
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
