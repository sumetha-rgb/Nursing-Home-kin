/**
 * จัดบรรทัดในใบแจ้งหนี้เข้าหมวดของหน้า "ราคาสินค้าและบริการ" เพื่อดูยอดขายตามหมวด
 *  1) บรรทัดที่เลือกจากหน้าราคา เก็บรหัสไว้ (code เช่น NS-21-M) → หมวดตามรหัส
 *  2) ใบเก่า / พิมพ์เอง → จับคู่ชื่อกับรายการในหน้าราคา (ชื่อยาวสุดที่อยู่ในบรรทัด) → คำในชื่อ (ห้อง ยา เวชภัณฑ์ คอร์ส)
 * เงินประกันและเงินรับล่วงหน้าไม่ใช่รายได้ (หมวด DP) · บรรทัดหักเงินที่รับไว้แล้วไม่นับ
 */
import { BillItem, DRAFT, Invoice, lineNet, lineSign, parseItems, VOID } from "./billing";
import { CATS, CatId, PriceItem } from "./priceList";

export type SaleCat = CatId | "MD" | "SP" | "DP";
export const SALE_CATS: { id: SaleCat; name: string }[] = [
  ...(Object.keys(CATS) as CatId[]).filter((c) => c !== "OT").map((id) => ({ id: id as SaleCat, name: CATS[id].name })),
  { id: "MD", name: "ยา" }, { id: "SP", name: "เวชภัณฑ์" }, { id: "OT", name: "อื่น ๆ" },
];
export const DP_NAME = "เงินประกันและรับล่วงหน้า";
export type SaleLine = { cat: SaleCat; sub: string; item: string; code: string; amount: number; qty: number; date: string };

const flat = (s: string) => s.replace(/\s+/g, "").toLowerCase();

export function classify(i: BillItem, prices: PriceItem[]): Omit<SaleLine, "amount" | "qty" | "date"> | null {
  if (i.credit) return null;
  const d = i.desc.trim();
  const base = i.code?.match(/^([A-Z]{2}-\d{2})/)?.[1];
  const byCode = base && prices.find((x) => x.code === base || x.old?.includes(base));
  if (byCode) return { cat: byCode.cat, sub: byCode.sub, item: byCode.name, code: byCode.code };
  if (/^เงินประกัน|ล่วงหน้า$|^ชำระค่าบริการล่วงหน้า|มัดจำ/.test(d)) return { cat: "DP", sub: DP_NAME, item: d.replace(/\s*·.*$/, ""), code: "" };
  if (/^ยา:/.test(d)) return { cat: "MD", sub: "ยา", item: d.replace(/^ยา:\s*/, "").replace(/\s*·.*$/, ""), code: "" };
  if (/^เวชภัณฑ์:/.test(d)) return { cat: "SP", sub: "เวชภัณฑ์", item: d.replace(/^เวชภัณฑ์:\s*/, "").replace(/\s*·.*$/, ""), code: "" };
  const k = flat(d);
  const hit = prices.filter((x) => k.includes(flat(x.name))).sort((a, b) => b.name.length - a.name.length)[0];
  if (hit) return { cat: hit.cat, sub: hit.sub, item: hit.name, code: hit.code };
  // ค่าบริการรายเดือนตามสัญญา (ค่าห้องรวมค่าดูแล ราคาไม่ตรงห้องในใบราคา) · มีหรือไม่มีเลขห้องต่อท้ายก็หมวดเดียวกัน
  if (/^ค่าบริการรายเดือน/.test(d)) return { cat: "RM", sub: "ค่าบริการรายเดือนตามสัญญา", item: "ค่าบริการรายเดือน", code: "" };
  if (/ห้อง|room/i.test(d)) return { cat: "RM", sub: /เดี่ยว|deluxe|superior|suite/i.test(d) ? CATS.RM.subs[1][0] : /รวม|คู่|shared|twin/i.test(d) ? CATS.RM.subs[0][0] : "ห้องราคาพิเศษ", item: d.replace(/\s*·.*$/, "").replace(/\s*\(ล่วงหน้า.*\)$/, "").replace(/\s*ห้อง\s*[A-Za-z]*-?\d[\w-]*$/, ""), code: "" };
  if (/คอร์ส|กายภาพ/.test(d)) return { cat: "PT", sub: "คอร์สกายภาพ", item: d.replace(/\s*·.*$/, ""), code: "" };
  return { cat: "OT", sub: "อื่น ๆ", item: d.replace(/\s*·.*$/, "") || "ไม่ระบุ", code: "" };
}

/** ทุกบรรทัดขายของใบที่ออกแล้ว (ไม่นับใบรอตรวจสอบยอดและใบยกเลิก) · ยอด = หลังส่วนลด ก่อน VAT · วันที่ = วันที่ออกใบ */
export function saleLines(list: Invoice[], prices: PriceItem[]): SaleLine[] {
  return list.filter((x) => x.status !== VOID && x.status !== DRAFT).flatMap((x) => parseItems(x.items).flatMap((i) => {
    const c = classify(i, prices);
    return c ? [{ ...c, amount: lineSign(x) * lineNet(i), qty: lineSign(x) * i.qty, date: x.date }] : [];
  }));
}
