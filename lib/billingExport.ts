"use client";
// ส่งออกข้อมูลการเงินเป็น CSV สำหรับฝ่ายบัญชี (หน้าใบแจ้งหนี้และใบเสร็จ และแท็บการเงินในภาพรวมและรายงาน)
import { useEffect, useState } from "react";
import { docDate, Invoice, lineAmount, lineDiscount, lineNet, money, parseItems, BillItem } from "./billing";
import { downloadCsv } from "./store";

/** ยอดรับเงินจริงต่อวันต่อสาขา (รวมทุกงวดที่รับในวันนั้น · ไม่นับใบที่ยกเลิก) จาก /api/billing?op=paid_days */
export type PaidDay = { branch: string; date: string; amount: number };
/**
 * ยอดรับเงินรายวันตั้งแต่วันที่ from (YYYY-MM-DD) · ใช้รวมเป็น "รับเดือนนี้" / รายรับรายเดือน ตามวันที่รับของแต่ละงวด
 *  sig = ค่าที่เปลี่ยนเมื่อมีการรับชำระ (เช่น ยอดชำระสะสมของทุกใบ) ให้ดึงใหม่ · คืน null ระหว่างโหลดหรือดึงไม่ได้ (ให้ผู้เรียกใช้ยอดประมาณแบบเดิม)
 */
export function usePaidDays(from: string, sig: unknown): PaidDay[] | null {
  const [rows, setRows] = useState<PaidDay[] | null>(null);
  useEffect(() => {
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

/** ทุกบรรทัดของทุกใบ: เห็นว่าแต่ละใบเป็นค่าห้อง คอร์ส ยา หรือเวชภัณฑ์เท่าไร · บรรทัดหักเงินที่รับไว้แล้วเป็นยอดติดลบ */
export function exportInvoiceLines(list: Invoice[], branchOf: (x: Invoice) => string, name: string) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const rows = [...list].sort((a, b) => b.date.localeCompare(a.date) || (b.no ?? "").localeCompare(a.no ?? "")).flatMap((x) =>
    parseItems(x.items).map((i, k) => {
      if (i.credit) {
        const amt = lineAmount(i);
        return [x.no ?? "", docDate(x.date), branchOf(x), x.who, x.hn || "", x.kind, x.status, String(k + 1), i.desc, itemCategory(i), String(i.qty), money(i.price), money(-amt), "0.00", money(-amt), "0", "0.00", money(-amt)];
      }
      const base = lineNet(i), vat = r2((base * (i.vat ?? 0)) / 100);
      return [x.no ?? "", docDate(x.date), branchOf(x), x.who, x.hn || "", x.kind, x.status, String(k + 1), i.desc, itemCategory(i), String(i.qty), money(i.price), money(lineAmount(i)), money(lineDiscount(i)), money(base), String(i.vat ?? 0), money(vat), money(base + vat)];
    }));
  downloadCsv(name, ["เลขที่เอกสาร", "วันที่", "สาขา", "ผู้รับบริการ", "HN", "ประเภทใบ", "สถานะใบ", "บรรทัด", "รายการ", "หมวด", "จำนวน", "ราคาต่อหน่วย", "ยอดก่อนส่วนลด", "ส่วนลด", "ก่อน VAT", "VAT (%)", "VAT", "สุทธิ"], rows);
  return rows.length;
}

type PayRow = { date: string; no: string | null; n: number; branch: string; who: string; hn: string | null; payer: string | null; kind: string; status: string; cash: number; transfer: number; credit: number; amount: number; cashier: string; note: string; slip: boolean };

/** การรับเงินทุกงวด: กระทบยอดเงินสด / เงินโอน / บัตร กับบัญชีธนาคารรายวัน */
export async function exportPayments(branch: string, name: string) {
  const r = await fetch(`/api/billing?op=payments${branch ? `&branch=${encodeURIComponent(branch)}` : ""}`, { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "ดึงข้อมูลการรับเงินไม่สำเร็จ");
  const items = (d.items ?? []) as PayRow[];
  downloadCsv(name, ["วันที่รับเงิน", "เลขที่เอกสาร", "งวดที่", "สาขา", "ผู้รับบริการ", "HN", "ผู้ชำระ", "ประเภทใบ", "สถานะใบ", "เงินสด", "เงินโอน", "บัตรเครดิต", "รวมรับงวดนี้", "ผู้รับเงิน", "มีสลิป", "หมายเหตุ"],
    items.map((p) => [docDate(p.date), p.no ?? "", String(p.n), p.branch ?? "", p.who ?? "", p.hn ?? "", p.payer ?? "", p.kind ?? "", p.status ?? "", money(p.cash), money(p.transfer), money(p.credit), money(p.amount), p.cashier, p.slip ? "มี" : "", p.note]));
  return items.length;
}
