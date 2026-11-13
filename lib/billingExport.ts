"use client";
// ส่งออกข้อมูลการเงินเป็น CSV สำหรับฝ่ายบัญชี (หน้าใบแจ้งหนี้และใบเสร็จ และแท็บการเงินในภาพรวมและรายงาน)
import { useEffect, useState } from "react";
import { BILL_GROUPS, docDate, groupOf, Invoice, lineAmount, lineDiscount, lineNet, lineSign, money, parseItems, BillItem } from "./billing";
import { downloadCsv } from "./store";
import { lineCode } from "./priceList";

/** ยอดรับเงินจริงต่อวันต่อสาขา (รวมทุกงวดที่รับในวันนั้น · ไม่นับใบที่ยกเลิก) จาก /api/billing?op=paid_days */
export type PaidDay = { branch: string; date: string; amount: number };
/**
 * ยอดรับเงินรายวันตั้งแต่วันที่ from (YYYY-MM-DD) · ใช้รวมเป็น "รับเดือนนี้" / รายรับรายเดือน ตามวันที่รับของแต่ละงวด
 *  sig = ค่าที่เปลี่ยนเมื่อมีการรับชำระ (เช่น ยอดชำระสะสมของทุกใบ) ให้ดึงใหม่ · คืน null ระหว่างโหลดหรือดึงไม่ได้ (ให้ผู้เรียกใช้ยอดประมาณแบบเดิม)
 */
export function usePaidDays(from: string, sig: unknown): PaidDay[] | null {
  const [rows, setRows] = useState<PaidDay[] | null>(null);
  useEffect(() => {
    // sig = undefined: ใบแจ้งหนี้ยังโหลดไม่เสร็จ รอก่อน (กันดึงซ้ำ 2 รอบตอนเปิดหน้า)
    if (sig === undefined) return;
    let live = true;
    fetch(`/api/billing?op=paid_days&from=${encodeURIComponent(from)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live) setRows(d ? ((d.items ?? []) as PaidDay[]).map((x) => ({ branch: x.branch ?? "", date: String(x.date ?? ""), amount: Number(x.amount) || 0 })) : null); })
      .catch(() => { if (live) setRows(null); });
    return () => { live = false; };
  }, [from, JSON.stringify(sig)]); // eslint-disable-line react-hooks/exhaustive-deps
  return rows;
}

/** หมวดของบรรทัดในใบแจ้งหนี้ (ใช้รวมยอดขายตามหมวด) */
export function itemCategory(i: BillItem) {
  const d = i.desc.trim();
  if (i.credit) return "หักเงินที่รับไว้แล้ว";
  if (/^เงินประกัน/.test(d)) return "เงินประกัน";
  if (/^ยา:/.test(d)) return "ยา";
  if (/^เวชภัณฑ์:/.test(d)) return "เวชภัณฑ์";
  if (/คอร์ส|กายภาพ/.test(d)) return "คอร์สกายภาพ / กายภาพ";
  if (/ห้อง|room/i.test(d)) return "ค่าห้อง";
  if (/ล่วงหน้า|ค่าบริการรายเดือน|โปรแกรม/.test(d)) return "ค่าบริการรายเดือน / ล่วงหน้า";
  return "บริการอื่น";
}

/** ยอดสุทธิของบรรทัด (หลังส่วนลด รวม VAT) · บรรทัดหักเงินที่รับไว้แล้วเป็นยอดติดลบ */
export function lineTotal(i: BillItem) {
  if (i.credit) return -lineAmount(i);
  return Math.round(lineNet(i) * (100 + (i.vat ?? 0))) / 100;
}
/** ชื่อรายการสำหรับรวมยอด: ตัดวงเล็บท้ายที่มีวันที่ (เช่น "(เบิก 30/10/2569)" "(ซื้อ 30/10/2569)") ให้รายการเดียวกันรวมเป็นแถวเดียว */
export const itemName = (desc: string) => desc.replace(/\s*\([^()]*\d{1,2}\/\d{1,2}\/\d{2,4}[^()]*\)\s*$/, "").trim();
/** หมวดที่ไม่นับเป็นยอดขาย: เงินประกันคืนเมื่อกลับบ้าน · บรรทัดหักเงินเป็นการหักยอด ไม่ใช่การขาย */
export const NOT_SALES = ["เงินประกัน", "หักเงินที่รับไว้แล้ว"];

/**
 * รหัสหมวดของบรรทัด: ตามหน้าราคา (RM ห้องพัก · NS งานพยาบาล · CR ดูแลและบุคลากร · EQ อุปกรณ์ · PT กายภาพ · OT อื่น ๆ)
 *  ไม่มีรหัสสินค้า: MD ยา · SP เวชภัณฑ์ · DP เงินประกัน/มัดจำ · AD หักเงินที่รับไว้แล้ว · OT อื่น ๆ
 */
export function catCode(i: BillItem) {
  const c = lineCode(i).match(/^([A-Z]{2})-/)?.[1];
  if (c) return c;
  const d = i.desc.trim();
  return i.credit ? "AD" : /^ยา:/.test(d) ? "MD" : /^เวชภัณฑ์:/.test(d) ? "SP" : /^เงินประกัน|มัดจำ/.test(d) ? "DP" : "OT";
}
/** หมวดที่แสดงในใบเสร็จ (หน้าแรก) */
const receiptGroup = (i: BillItem) => { if (i.credit) return "หักเงินที่รับไว้แล้ว"; const g = groupOf(i); return g === "dep" ? "เงินประกัน / มัดจำ" : BILL_GROUPS.find(([k]) => k === g)?.[1] ?? ""; };
/** ทุกบรรทัดของทุกใบ: เห็นว่าแต่ละใบเป็นค่าห้อง คอร์ส ยา หรือเวชภัณฑ์เท่าไร · บรรทัดหักเงินที่รับไว้แล้วเป็นยอดติดลบ */
export function exportInvoiceLines(list: Invoice[], branchOf: (x: Invoice) => string, name: string) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const rows = [...list].sort((a, b) => b.date.localeCompare(a.date) || (b.no ?? "").localeCompare(a.no ?? "")).flatMap((x) =>
    parseItems(x.items).map((i, k) => {
      if (i.credit) {
        const amt = lineAmount(i);
        return [x.no ?? "", docDate(x.date), branchOf(x), x.who, x.hn || "", x.kind, x.status, String(k + 1), "", i.desc, catCode(i), receiptGroup(i), itemCategory(i), String(i.qty), money(i.price), money(-amt), "0.00", money(-amt), "0", "0.00", money(-amt)];
      }
      // ใบลดหนี้: ยอดทุกช่องเป็นลบ
      const sg = lineSign(x), base = lineNet(i), vat = r2((base * (i.vat ?? 0)) / 100);
      return [x.no ?? "", docDate(x.date), branchOf(x), x.who, x.hn || "", x.kind, x.status, String(k + 1), lineCode(i), i.desc, catCode(i), receiptGroup(i), itemCategory(i), String(i.qty), money(i.price), money(sg * lineAmount(i)), money(sg * lineDiscount(i)), money(sg * base), String(i.vat ?? 0), money(sg * vat), money(sg * (base + vat))];
    }));
  downloadCsv(name, ["เลขที่เอกสาร", "วันที่", "สาขา", "ผู้รับบริการ", "HN", "ประเภทใบ", "สถานะใบ", "บรรทัด", "รหัสสินค้า", "รายการ", "รหัสหมวด", "หมวดในใบเสร็จ", "หมวด", "จำนวน", "ราคาต่อหน่วย", "ยอดก่อนส่วนลด", "ส่วนลด", "ก่อน VAT", "VAT (%)", "VAT", "สุทธิ"], rows);
  return rows.length;
}

type PayRow = { date: string; no: string | null; n: number; branch: string; who: string; hn: string | null; payer: string | null; kind: string; status: string; cash: number; transfer: number; credit: number; amount: number; wht?: number; pkind?: string; cashier: string; note: string; slip: boolean; transferRef?: string };

/** การรับเงินทุกงวด: กระทบยอดเงินสด / เงินโอน / บัตร กับบัญชีธนาคารรายวัน */
export async function exportPayments(branch: string, name: string, inRange: (d: string) => boolean = () => true) {
  const r = await fetch(`/api/billing?op=payments${branch ? `&branch=${encodeURIComponent(branch)}` : ""}`, { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "ดึงข้อมูลการรับเงินไม่สำเร็จ");
  const items = ((d.items ?? []) as PayRow[]).filter((p) => inRange(String(p.date ?? "").slice(0, 10)));
  downloadCsv(name, ["วันที่รับเงิน", "เลขที่เอกสาร", "งวดที่", "สาขา", "ผู้รับบริการ", "HN", "ผู้ชำระ", "ประเภทใบ", "สถานะใบ", "ประเภทรายการ", "เงินสด", "เงินโอน", "บัตรเครดิต", "รวมรับเงิน", "ภาษีหัก ณ ที่จ่าย", "ตัดยอดค้างรวม", "เลขอ้างอิงการโอน", "ผู้รับเงิน", "มีสลิป", "หมายเหตุ"],
    items.map((p) => [docDate(p.date), p.no ?? "", String(p.n), p.branch ?? "", p.who ?? "", p.hn ?? "", p.payer ?? "", p.kind ?? "", p.status ?? "", p.pkind === "credit" ? "ใบลดหนี้หักยอด" : "รับเงิน", money(p.cash), money(p.transfer), money(p.credit), money(p.cash + p.transfer + p.credit), money(p.wht ?? 0), money(p.amount), p.transferRef ?? "", p.cashier, p.slip ? "มี" : "", p.note]));
  return items.length;
}
