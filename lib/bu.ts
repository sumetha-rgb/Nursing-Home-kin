/**
 * ฝ่าย (BU) และบริษัทที่เป็นรายได้ของแต่ละรายการในใบ · ใช้กับรายงาน "รายได้ตาม BU" (รายงานภายใน ไม่กระทบเอกสารลูกค้า)
 *  รายการ → หมวด (จากรหัสในใบราคา) → ฝ่าย (ตั้งค่า bu_divisions) → บริษัท (ของฝ่าย หรือบริษัทของสาขาที่ออกใบ)
 *  เงินประกัน / มัดจำ ไม่นับเป็นรายได้ · บรรทัดหักเงินที่รับไว้แล้วไม่นับ
 */
import { BillItem, groupOf } from "./billing";
import { lineCode } from "./priceList";

/** หมวดที่ผูกกับฝ่ายได้ · MD = ค่าบริการทางการแพทย์ (RM-MD) แยกจากค่าห้อง */
export const BU_CATS: [string, string][] = [["RM", "ห้องพัก"], ["MD", "ค่าบริการทางการแพทย์ (RM-MD)"], ["NS", "งานพยาบาล"], ["CR", "ดูแลและบุคลากร"], ["EQ", "อุปกรณ์"], ["PT", "กายภาพและฟื้นฟู"], ["OT", "อื่น ๆ / ไม่มีรหัส"]];
export const BU_CAT_TH = Object.fromEntries(BU_CATS) as Record<string, string>;

export type Division = { id: string; name: string; cats: string[]; company?: string | null; active: boolean; sort?: number | null };
/** ค่าตั้งต้น (ยังไม่ได้ตั้งค่า) · บริษัทว่าง = บริษัทของสาขา */
export const DEFAULT_DIVISIONS: Division[] = [
  { id: "bu-room", name: "ฝ่ายที่พักและดูแล", cats: ["RM", "CR"], company: "", active: true },
  { id: "bu-med", name: "ฝ่ายการแพทย์และพยาบาล", cats: ["MD", "NS"], company: "", active: true },
  { id: "bu-pt", name: "ฝ่ายกายภาพและฟื้นฟู", cats: ["PT"], company: "", active: true },
  { id: "bu-eq", name: "ฝ่ายอุปกรณ์", cats: ["EQ"], company: "", active: true },
  { id: "bu-ot", name: "ฝ่ายอื่น ๆ", cats: ["OT"], company: "", active: true },
];
export const NO_DIV = "ยังไม่ได้กำหนดฝ่าย";

/** หมวดของรายการ · "dep" = เงินประกัน/มัดจำ (ไม่ใช่รายได้) */
export function buCatOf(i: BillItem): string {
  if (groupOf(i) === "dep") return "dep";
  const code = lineCode(i);
  if (code === "RM-MD" || /^ค่าบริการทางการแพทย์/.test(i.desc.trim())) return "MD";
  const p = code.slice(0, 2);
  return ["RM", "NS", "CR", "EQ", "PT", "OT"].includes(p) ? p : "OT";
}
/** ฝ่ายของหมวด: ฝ่ายแรกที่เปิดใช้และมีหมวดนี้ */
export const divisionOf = (divs: Division[], cat: string) => divs.find((d) => d.active && d.cats.includes(cat)) ?? null;
