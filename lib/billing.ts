/** ใบแจ้งหนี้ / ใบเสร็จรับเงิน (ชุดข้อมูล "invoices") ใช้ได้ทั้งหน้าเว็บและ server */
import { lineCode, roomByPrice } from "./priceList";

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
/**
 * ราคารวม VAT → ราคาก่อน VAT (ค่าห้องรายเดือนในใบราคาเป็นราคารวม VAT แล้ว · สัญญาเก็บค่าห้องก่อน VAT)
 *  ปัดสตางค์ให้ ก่อน VAT + VAT (ปัดสตางค์แบบใบแจ้งหนี้) = ราคาเดิมพอดี · rate 0 = ไม่มี VAT คืนราคาเดิม
 */
export function baseOfIncl(price: number, rate: number) {
  if (!(rate > 0) || !(price > 0)) return price;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const b0 = r2((price * 100) / (100 + rate));
  for (const d of [0, 0.01, -0.01, 0.02, -0.02]) { const b = r2(b0 + d); if (r2(b + Math.round(b * rate) / 100) === price) return b; }
  return b0;
}
/** ราคาก่อน VAT → ราคารวม VAT (ปัดสตางค์แบบใบแจ้งหนี้) */
export const inclOf = (base: number, rate: number) => (rate > 0 ? Math.round((base + Math.round(base * rate) / 100) * 100) / 100 : base);
export type Invoice = {
  id: string; no?: string; date: string; who: string; hn: string; payer: string; address: string;
  kind: string; contract: string; items: string; total: number; discount: number; net: number;
  status: string; paid?: number; cash?: number; credit?: number; transfer?: number; paidDate?: string; cashier?: string; note?: string; slip?: boolean;
  /** เลขผู้เสียภาษีของผู้ชำระที่เป็นบริษัท 13 หลัก · payerBranch = "สำนักงานใหญ่" หรือ "สาขาที่ 00001" (ว่าง = บุคคลธรรมดา) */
  payerTaxId?: string; payerBranch?: string;
  /** ใบลดหนี้: เลขที่ใบเดิมที่อ้างอิง (server ใส่ให้) */
  ref?: string;
};

export const BILL_KINDS = ["มัดจำ / แรกเข้า", "ค่าบริการรายเดือน", "ค่าหัตถการ", "คอร์สกายภาพ", "เวชภัณฑ์และอื่น ๆ", "สรุปค่าใช้จ่ายก่อนกลับบ้าน (D/C)"];
export const UNPAID = "ค้างชำระ", PARTIAL = "ชำระบางส่วน", PAID = "ชำระแล้ว", VOID = "ยกเลิก";
/**
 * ใบลดหนี้ (ออกจาก /api/billing op "credit_note" เท่านั้น) · ลดยอดของใบเดิมที่ออกใบกำกับภาษีไปแล้ว
 *  ลดหนี้แล้ว = หักยอดค้างของใบเดิมครบ · รอคืนเงิน = ใบเดิมชำระไปแล้ว ต้องคืนเงินลูกค้า · คืนเงินแล้ว = บันทึกการคืนเงินแล้ว
 *  ยอดของใบลดหนี้เป็นบวกในฐานข้อมูล · ทุกรายงานต้องนับเป็นลบ (signedNet / lineSign)
 */
export const CN_KIND = "ใบลดหนี้", CN_DONE = "ลดหนี้แล้ว", CN_REFUND = "รอคืนเงิน", CN_REFUNDED = "คืนเงินแล้ว";
export const CN_STATUSES = [CN_DONE, CN_REFUND, CN_REFUNDED];
export const isCN = (x: { kind?: string }) => x.kind === CN_KIND;
/** ยอดสุทธิที่ใช้รวมในรายงาน: ใบลดหนี้เป็นยอดลบ */
export const signedNet = (x: { kind?: string; net: number }) => (isCN(x) ? -x.net : x.net);
/** ตัวคูณยอดบรรทัดในรายงาน: บรรทัดของใบลดหนี้เป็นลบ */
export const lineSign = (x: { kind?: string }) => (isCN(x) ? -1 : 1);
/** ใบที่ระบบออกให้จากสัญญาที่ไม่ได้ระบุยอดล่วงหน้า · ยังรับชำระไม่ได้จนกว่าการเงินกดยืนยันยอด (เป็นค้างชำระ) */
export const DRAFT = "รอตรวจสอบยอด";
/** ยังเก็บเงินไม่ครบ (ยังไม่ได้รับชำระ หรือรับแล้วบางส่วน) */
export const isOpen = (x: { status: string }) => x.status === UNPAID || x.status === PARTIAL;
/** ยอดที่ยังค้างอยู่ */
export const balanceOf = (x: { net: number; paid?: number; kind?: string }) => (x.kind === CN_KIND ? 0 : Math.max(0, Math.round((x.net - (x.paid ?? 0)) * 100) / 100));
/** รายการรับชำระ 1 งวด (จาก /api/billing) */
/** amount = ยอดที่ตัดจากยอดค้าง (เงินที่รับ + ภาษีหัก ณ ที่จ่าย) · wht = ภาษีหัก ณ ที่จ่าย · kind: pay = รับเงิน · credit = ใบลดหนี้หักยอด */
export type Payment = { id: string; n: number; date: string; cash: number; credit: number; transfer: number; amount: number; wht?: number; kind?: string; cashier: string; note: string; slip: string | null; slipAt: string | null; paidBefore: number };
/** เลขผู้เสียภาษี 13 หลักถูกต้องตามเลขตรวจสอบ */
export const validTaxId = (v: string) => { const d = v.replace(/\D/g, ""); if (d.length !== 13) return false; let s = 0; for (let i = 0; i < 12; i++) s += Number(d[i]) * (13 - i); return (11 - (s % 11)) % 10 === Number(d[12]); };

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

/* ---------- ค่าบริการต่อเดือนตามสัญญา (ใช้ร่วมกัน: หน้าใบแจ้งหนี้ ทะเบียนสัญญา เอกสารพิมพ์สัญญา) ---------- */
const numOf = (v?: string | null) => Number(String(v ?? "").replace(/,/g, "")) || 0;
const filled = (v?: string | null) => (!v || v === "-" ? "" : v);
/** room = ชื่อห้องที่ตั้งเองเมื่อกำหนดค่าห้องเอง (เก็บใน items_json ไม่ใช่รายการค่าบริการ) */
export type ContractLine = { desc: string; qty: number; unit: string; price: number; discount?: number; pct?: number; room?: boolean; code?: string; meta?: ContractMeta;
  /** ค่าห้องคิดรายวัน/รายสัปดาห์ (พักระยะสั้น): n = จำนวนวัน/สัปดาห์ · rate = ราคาต่อหน่วยรวม VAT · price = ยอดก่อน VAT ทั้งช่วง (qty 1) */
  stay?: "วัน" | "สัปดาห์"; n?: number; rate?: number;
  /** ส่วนหนึ่งของราคาห้อง (ค่าบริการทางการแพทย์ ไม่มี VAT) ระบบใส่ให้จากค่าห้องที่เลือก ไม่ใช่รายการที่กรอกเอง · part = ส่วนค่าห้อง (มี VAT) ต่อหน่วย */
  pkg?: boolean; part?: number };
/**
 * ข้อตกลงการชำระของสัญญา (เก็บเป็นบรรทัด meta ใน items_json ไม่ใช่รายการค่าบริการ)
 *  prepaidPct = ส่วนลดค่าห้อง (%) เมื่อชำระล่วงหน้าตั้งแต่ 2 เดือน · ใช้กับใบแรกเข้าเท่านั้น
 *  installments = แบ่งชำระใบแรกเข้ากี่งวด (1 = จ่ายครั้งเดียว)
 */
export type ContractMeta = { prepaidPct?: number; installments?: number;
  /** ส่วนลดค่าห้องชำระล่วงหน้าเป็นบาท (รวม VAT · ใช้แทน prepaidPct) */
  prepaidOff?: number };
const rawLines = (r: string[]): ContractLine[] | null => { try { const x = JSON.parse(r[23] || "[]"); if (Array.isArray(x)) return x; } catch { /* สัญญาเก่า */ } return null; };
/** รายการค่าบริการของสัญญา · สัญญาเก่าที่ยังไม่มีรายการ: แปลงจากค่าบริการเพิ่มเติมรายเดือนเดิม */
export function contractLines(r: string[]): ContractLine[] {
  const x = rawLines(r);
  if (x) return x.filter((l) => !l.room && !l.meta);
  const extra = numOf(r[16]);
  return extra ? [{ desc: filled(r[15]) ? `ค่าบริการเพิ่มเติม (${r[15]})` : "ค่าบริการเพิ่มเติม", qty: 1, unit: "เดือน", price: extra }] : [];
}
/** ชื่อห้องที่ตั้งเอง (ค่าห้องกำหนดเอง) */
export const contractRoomName = (r: string[]) => rawLines(r)?.find((l) => l.room)?.desc?.trim() ?? "";
/** ข้อตกลงการชำระของสัญญา (ส่วนลดค่าห้องชำระล่วงหน้า · จำนวนงวด) */
/** สัญญาแบบเดิม: ค่าห้องในสัญญาบวก VAT เพิ่ม และยังไม่แยกค่าบริการทางการแพทย์ */
export const isOldRoomPricing = (r: string[]) => numOf(r[4]) > 0 && contractVat(r) > 0 && !rawLines(r)?.some((l) => l.pkg || l.stay);
/**
 * ปรับสัญญาแบบเดิมเป็นแบบใหม่: ค่าห้องเดิมถือเป็นราคารวม VAT แล้ว (ไม่บวก VAT เพิ่ม)
 *  แยกเป็นค่าห้อง (มี VAT · ไม่เกิน part เช่น 15,000) + ค่าบริการทางการแพทย์ (ส่วนที่เหลือ ไม่มี VAT) · คืนแถวสัญญาใหม่
 */
export function splitOldRoom(r: string[], part: number) {
  const total = numOf(r[4]), rate = contractVat(r), p = Math.min(part, total), med = Math.round((total - p) * 100) / 100;
  const lines = rawLines(r) ?? [];
  const next = [...(med > 0 ? [{ desc: "ค่าบริการทางการแพทย์", qty: 1, unit: "เดือน", price: med, code: "RM-MD", pkg: true }] : []), ...lines];
  return { row: r.map((x, k) => (k === 4 ? String(baseOfIncl(p, rate)) : k === 23 ? JSON.stringify(next) : x)), total, part: p, med, rate };
}
/**
 * ปรับบรรทัดค่าห้อง (มี VAT) ในใบที่ยังไม่ชำระแบบเดียวกัน: ยอดเดิมของบรรทัด (หลังส่วนลด) = ราคารวม VAT
 *  แยกเป็นค่าห้อง (part × จำนวนเดือนในบรรทัด) + ค่าบริการทางการแพทย์ · บรรทัดอื่นไม่เปลี่ยน
 */
export function splitOldRoomLines(items: BillItem[], part: number) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return items.flatMap((l) => {
    if (l.credit || !l.vat || !isRoomLine(l.desc) || /^ค่าบริการทางการแพทย์/.test(l.desc)) return [l];
    const months = Number(l.desc.match(/\(ล่วงหน้า (\d+) เดือน\)/)?.[1] ?? 1) || 1;
    const total = r2(l.qty * l.price - (l.discount ?? 0) - (l.pct ? (l.qty * l.price * l.pct) / 100 : 0));
    const p = Math.min(total, part * months), med = r2(total - p);
    const room = { ...l, qty: 1, price: baseOfIncl(p, l.vat), discount: 0, pct: 0 };
    return med > 0 ? [room, { desc: `ค่าบริการทางการแพทย์${months > 1 ? ` (ล่วงหน้า ${months} เดือน)` : ""}`, qty: 1, price: med, discount: 0, code: "RM-MD" }] : [room];
  });
}
/** สัญญาพักระยะสั้น (ค่าห้องรายวัน/รายสัปดาห์): ไม่สร้างใบค่าบริการรายเดือนให้อัตโนมัติ */
export const isStayContract = (r: string[]) => !!rawLines(r)?.some((l) => l.stay);
export const contractMeta = (r: string[]): ContractMeta => rawLines(r)?.find((l) => l.meta)?.meta ?? {};
/** แบ่งยอดเป็น n งวด: งวดละเท่ากัน (ปัดสตางค์) งวดสุดท้ายรับเศษ */
export function splitInstallments(total: number, n: number) {
  const k = Math.max(1, Math.floor(n)), per = Math.floor((total / k) * 100) / 100;
  return Array.from({ length: k }, (_, i) => (i < k - 1 ? per : Math.round((total - per * (k - 1)) * 100) / 100));
}
/** หมายเหตุใบแจ้งหนี้ที่แบ่งชำระ: "แบ่งชำระ 3 งวด" · อ่านกลับด้วย installmentsOf */
export const installmentsOf = (note?: string) => Number(String(note ?? "").match(/แบ่งชำระ (\d+) งวด/)?.[1] ?? 0) || 0;
/** บรรทัดค่าห้อง (คิด VAT ค่าห้อง) */
export const isRoomLine = (d: string) => /ห้อง|room/i.test(d);

/**
 * ค่าบริการต่อเดือนตามสัญญา (แจกแจงรายการ)
 *  มีรายการค่าห้องในสัญญา = ค่าห้องรวมค่าดูแลแล้ว ไม่ใส่ราคาโปรแกรมซ้ำ · ไม่มี = ราคาโปรแกรม + รายการอื่น
 *  VAT ค่าห้อง (contractVat) บวกเพิ่มที่ราคาโปรแกรม/ค่าห้อง และบรรทัดที่เป็นค่าห้อง
 */
export function contractMonthLines(r: string[]): BillItem[] {
  const no = r[6] && r[6] !== "-" ? r[6] : "";
  const items = contractLines(r).filter((x) => x.price > 0);
  const hasRoom = items.some((x) => isRoomLine(x.desc));
  const rate = contractVat(r);
  const fee = numOf(r[4]), kind = roomByPrice(fee), own = contractRoomName(r);
  // ชื่อห้องที่ตั้งเอง (ค่าห้องกำหนดเอง) > ประเภทห้องจากราคาในใบราคา > ชื่อโปรแกรม
  const feeDesc = own ? (/^ห้อง/.test(own) ? `ค่า${own}` : `ค่าห้อง ${own}`) : kind ? `ค่า${kind.name}${kind.promo ? " ราคาโปรโมชัน" : ""}` : r[21] && r[21] !== "-" ? r[21] : "ค่าบริการรายเดือน";
  return [
    ...(!hasRoom && fee ? [{ desc: `${feeDesc}${no ? ` · ห้อง ${no}` : ""}`, qty: 1, price: fee, discount: 0, vat: rate, code: lineCode({ desc: feeDesc, price: fee }) }] : []),
    ...items.map((x) => {
      const room = isRoomLine(x.desc);
      return { desc: no && room && !x.desc.includes(no) ? `${x.desc} · ห้อง ${no}` : x.desc, qty: x.qty, price: x.price, discount: Number(x.discount) || 0, pct: Number(x.pct) || 0, vat: room ? rate : 0, ...(lineCode(x) ? { code: lineCode(x) } : {}) };
    }),
  ];
}
/**
 * ยอดต่อเดือนของสัญญา (จาก contractMonthLines · ตรงกับใบแจ้งหนี้และ "ต่อเดือน (รวม VAT)" ในทะเบียนสัญญา)
 *  feeIn = คิดราคาโปรแกรมเป็นบรรทัดค่าห้อง (สัญญาไม่มีรายการค่าห้อง) · base = ก่อน VAT · vat = ภาษี · total = รวม VAT
 */
export function contractMonthSum(r: string[]) {
  const items = contractMonthLines(r);
  const feeIn = !contractLines(r).some((x) => x.price > 0 && isRoomLine(x.desc));
  return { feeIn, rate: contractVat(r), base: r2(items.reduce((n, i) => n + lineNet(i), 0)), vat: vatOf(items).vat, total: totals(items).net };
}

/**
 * สาขาของใบแจ้งหนี้ (ใบไม่มีช่องสาขาฝั่งหน้าจอ): สาขาของสัญญาของใบ → สาขาของผู้รับบริการชื่อนั้น → สาขาของผู้ใช้
 *  contracts / residents = แถวของ useCrud("contracts") / useCrud("residents")
 */
export const invoiceBranch = (inv: Invoice, contracts: string[][], residents: string[][], userBranch?: string | null) =>
  (inv.contract ? contracts.find((c) => c[0] === inv.contract)?.[1] : undefined) ?? residents.find((r) => r[0] === inv.who)?.[3] ?? userBranch ?? "";

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

/**
 * หมวดในใบแจ้งหนี้ (หน้าแรกแสดงยอดตามหมวด · หน้า 2 แจกแจงรายการ)
 *  room = ค่าห้อง (มี VAT) · med = ค่าบริการทางการแพทย์ (ส่วนแยกจากราคาห้อง + งานพยาบาล + แพทย์/บุคลากร)
 *  goods = ยา เวชภัณฑ์ อุปกรณ์ อื่น ๆ · extra = กายภาพ แพ็กเกจ คอร์ส · dep = เงินประกัน / มัดจำ (แสดงเป็นบรรทัดของตัวเอง)
 */
export type BillGrp = "room" | "med" | "goods" | "extra" | "dep";
export const BILL_GROUPS: [Exclude<BillGrp, "dep">, string, string][] = [["room", "ค่าบริการห้องพัก", "ROOM CHARGE"], ["med", "ค่าบริการทางการแพทย์", "MEDICAL SERVICES"],
  ["goods", "ค่าสินค้าและบริการอื่น ๆ", "GOODS & OTHER SERVICES"], ["extra", "ค่าบริการเสริม", "ADDITIONAL SERVICES"]];
export function groupOf(i: BillItem): BillGrp {
  const d = i.desc.trim(), code = lineCode(i);
  if (code === "DP-01" || code === "DP-02" || /^เงินประกัน|^มัดจำห้อง/.test(d)) return "dep";
  if (code === "RM-MD" || /^(NS|CR)-/.test(code) || /^ค่าบริการทางการแพทย์/.test(d)) return "med";
  if (/^RM-/.test(code) || isRoomLine(d) || /^ค่าบริการรายเดือน|^ชำระค่าบริการล่วงหน้า/.test(d)) return "room";
  if (/^PT-/.test(code) || /คอร์ส|กายภาพ|แพ็กเกจ/.test(d)) return "extra";
  return "goods";
}
/** ยอดบรรทัดรวม VAT (หลังส่วนลด) */
export const inclNet = (i: BillItem) => (i.vat ? Math.round(lineNet(i) * (100 + i.vat)) / 100 : lineNet(i));
