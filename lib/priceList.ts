/**
 * ใบราคาและรหัสสินค้า/บริการ (ราคากลางทุกสาขา)
 * ราคาจริงอยู่ในตาราง price_items แก้ได้ที่หน้า "ราคาสินค้าและบริการ" (ผู้จัดการสาขาและผู้บริหาร)
 * DEFAULT_ITEMS = ใบราคาเดิม ใช้ตั้งต้นตารางครั้งแรก และแสดงระหว่างรอโหลด · ใช้ได้ทั้งหน้าเว็บและ server
 * ราคาที่เลือกลงเอกสารแล้วแก้ในเอกสารได้ (เช่น ให้ส่วนลด) และเอกสารที่ออกไปแล้วไม่เปลี่ยนตามใบราคา
 */
export type RateUnit = "ครั้ง" | "วัน" | "เดือน" | "แพ็กเกจ";
export const RATE_UNITS: RateUnit[] = ["ครั้ง", "วัน", "เดือน", "แพ็กเกจ"];
/** ราคาแต่ละหน่วย · หน่วยเดียวมีได้หลายราคา เช่น รายเดือน 12,000 / 8,000 · label = คำอธิบายราคานั้น · next = ราคาใหม่ที่ตั้งล่วงหน้า */
export type Rate = { unit: RateUnit; price: number; label?: string; next?: { price: number; from: string } | null };
export type CatId = "RM" | "NS" | "CR" | "EQ" | "PT" | "OT";
export type PriceItem = {
  id?: string; code: string; cat: CatId; sub: string; name: string; rates: Rate[];
  /** รหัสที่เคยใช้ (ค้นหาเจอ) */ old?: string[];
  active?: boolean; updatedBy?: string; updatedAt?: string;
  /** ชื่อหมวด (ใช้จัดกลุ่มในช่องเลือกค่าบริการ) */ group: string;
};

/** หมวดหลักและหมวดย่อย · ตัวเลขคือเลขเริ่มต้นของรหัสในหมวดย่อยนั้น (NS-2x = ทางเดินหายใจ) */
export const CATS: Record<CatId, { name: string; subs: [string, number][] }> = {
  RM: { name: "ห้องพัก", subs: [["ห้องรวมและห้องคู่", 1], ["ห้องเดี่ยว", 3]] },
  NS: { name: "งานพยาบาล", subs: [["สายยางและอาหาร", 1], ["แผล", 10], ["ทางเดินหายใจ", 20], ["ทางเดินปัสสาวะ", 30], ["ตรวจและเจาะเลือด", 40]] },
  CR: { name: "ดูแลและบุคลากร", subs: [["ระดับการดูแล", 1], ["ผู้ดูแลและผู้เฝ้า", 10], ["แพทย์", 20]] },
  EQ: { name: "อุปกรณ์", subs: [["เช่าและค่าไฟอุปกรณ์", 1]] },
  PT: { name: "กายภาพและฟื้นฟู", subs: [["รายครั้ง", 1], ["แพ็กเกจเสริมความแข็งแรง (25 นาที)", 11], ["Package Extra (60 นาที)", 21]] },
  OT: { name: "อื่น ๆ", subs: [["อื่น ๆ", 1]] },
};
export const CAT_IDS = Object.keys(CATS) as CatId[];
export const isCat = (c: unknown): c is CatId => typeof c === "string" && c in CATS;

/** รหัสหลัก เช่น NS-21 */
export const CODE_RE = /^([A-Z]{2})-(\d{2})$/;
const UNIT_LETTER: Record<RateUnit, string> = { ครั้ง: "S", วัน: "D", เดือน: "M", แพ็กเกจ: "P" };
const isPromo = (r: Rate) => /โปรโมชัน/.test(r.label ?? "");
/** ท้ายรหัสของราคาที่ i: S ครั้ง · D วัน · M เดือน · P แพ็กเกจ · MP โปรโมชัน · M2 ราคาที่ 2 ของหน่วยเดียวกัน */
export function rateSuffix(rates: Rate[], i: number) {
  const r = rates[i], b = UNIT_LETTER[r.unit] ?? "S";
  if (isPromo(r)) return `${b}P`;
  const n = rates.slice(0, i).filter((x) => !isPromo(x) && (UNIT_LETTER[x.unit] ?? "S") === b).length;
  return n ? `${b}${n + 1}` : b;
}
export const rateCode = (x: { code: string; rates: Rate[] }, i: number) => `${x.code}-${rateSuffix(x.rates, i)}`;

/** รหัสถัดไปที่ว่างในหมวดย่อย (ไม่ซ้ำรหัสปัจจุบันและรหัสเดิมของทุกรายการ) */
export function suggestCode(items: PriceItem[], cat: CatId, sub: string) {
  const used = new Set(items.flatMap((x) => [x.code, ...(x.old ?? [])]));
  const start = CATS[cat].subs.find((s) => s[0] === sub)?.[1] ?? 1;
  for (let n = start; n <= 99; n++) { const c = `${cat}-${String(n).padStart(2, "0")}`; if (!used.has(c)) return c; }
  return "";
}
/** ตรวจรหัสหลัก · คืนข้อความปัญหา หรือ null ถ้าใช้ได้ */
export function codeProblem(items: PriceItem[], code: string, cat: CatId, selfId?: string) {
  const m = code.match(CODE_RE);
  if (!m) return "รหัสต้องเป็นตัวอักษร 2 ตัว ขีด และเลข 2 หลัก เช่น NS-24";
  if (m[1] !== cat) return `รหัสในหมวด${CATS[cat].name}ต้องขึ้นต้นด้วย ${cat}-`;
  const other = items.find((x) => x.id !== selfId && x.code === code);
  if (other) return `รหัสนี้ใช้กับ "${other.name}" อยู่แล้ว`;
  const was = items.find((x) => x.id !== selfId && x.old?.includes(code));
  if (was) return `รหัสนี้เคยใช้กับ "${was.name}" · ตั้งรหัสอื่นเพื่อไม่ให้รายงานเก่าปนกัน`;
  return null;
}

const R = (unit: RateUnit, price: number, label?: string): Rate => (label ? { unit, price, label } : { unit, price });
const item = (code: string, sub: string, name: string, rates: Rate[], old: string): PriceItem => {
  const cat = code.slice(0, 2) as CatId;
  return { code, cat, sub, name, rates, old: [old], active: true, group: CATS[cat].name };
};
const [RM1, RM2] = CATS.RM.subs.map((s) => s[0]);
const [NS0, NS1, NS2, NS3, NS4] = CATS.NS.subs.map((s) => s[0]);
const [CR0, CR1, CR2] = CATS.CR.subs.map((s) => s[0]);
const [PT0, PT1, PT2] = CATS.PT.subs.map((s) => s[0]);
const EQ0 = CATS.EQ.subs[0][0];
const room = (code: string, sub: string, name: string, day: number, month: number, promo: number, old: string) =>
  item(code, sub, name, [R("วัน", day), R("เดือน", month), R("เดือน", promo, "โปรโมชัน")], old);

/** ใบราคาเดิม (ใบอัตราค่าบริการ / ค่าบริการเพิ่มเติม / แพ็กเกจฟื้นฟู) พร้อมรหัสใหม่ · รหัสเดิม R1–R5, X01–X29, P01–P06 */
export const DEFAULT_ITEMS: PriceItem[] = [
  room("RM-01", RM1, "ห้องรวม 6 ท่าน (Shared Room)", 2500, 43000, 35000, "R1"),
  room("RM-02", RM1, "ห้องคู่ (Twin Room)", 3000, 50000, 40000, "R2"),
  room("RM-03", RM2, "ห้องเดี่ยว (Deluxe Room)", 3500, 57000, 47000, "R3"),
  room("RM-04", RM2, "ห้องเดี่ยว (Superior Room)", 4000, 71000, 58000, "R4"),
  room("RM-05", RM2, "ห้องเดี่ยว (Grand Suite Room)", 5000, 90000, 70000, "R5"),
  item("NS-01", NS0, "ค่าบริการอาหารทางสายยางสูตรมาตรฐาน พร้อมอุปกรณ์", [R("วัน", 500), R("เดือน", 12000), R("เดือน", 8000, "ราคาที่ 2")], "X01"),
  item("NS-02", NS0, "ค่าบริการให้นมทางสายยาง พร้อมอุปกรณ์ (นำนมมาเอง)", [R("วัน", 300), R("เดือน", 7500), R("เดือน", 4000, "ราคาที่ 2")], "X02"),
  item("NS-04", NS0, "ค่าบริการใส่สายให้อาหารทางจมูก (สายเดิม)", [R("ครั้ง", 300)], "X14"),
  item("NS-05", NS0, "ค่าบริการใส่สายให้อาหารทางจมูก (สายใหม่แบบธรรมดา)", [R("ครั้ง", 1000)], "X15"),
  item("NS-06", NS0, "ค่าบริการใส่สายให้อาหารทางจมูก (สายใหม่แบบ Silicone)", [R("ครั้ง", 1200)], "X16"),
  item("NS-10", NS1, "ค่าดูแลแผลเจาะคอ", [R("วัน", 300), R("เดือน", 3000)], "X04"),
  item("NS-11", NS1, "ค่าดูแลแผลเจาะคอ และแผลหน้าท้อง", [R("วัน", 600), R("เดือน", 9000)], "X05"),
  item("NS-12", NS1, "ค่าดูแลแผลหน้าท้อง", [R("วัน", 300), R("เดือน", 3000, "เริ่มต้น"), R("เดือน", 6000, "สูงสุด")], "X06"),
  item("NS-13", NS1, "ค่าทำแผลขนาดเล็ก พร้อมอุปกรณ์", [R("ครั้ง", 200)], "X08"),
  item("NS-14", NS1, "ค่าทำแผลขนาดกลาง พร้อมอุปกรณ์", [R("ครั้ง", 400)], "X09"),
  item("NS-15", NS1, "ค่าทำแผลขนาดใหญ่ พร้อมอุปกรณ์", [R("ครั้ง", 600)], "X10"),
  item("NS-20", NS2, "ค่าบริการให้ออกซิเจน", [R("วัน", 400), R("เดือน", 6000)], "X07"),
  item("NS-21", NS2, "ค่าบริการพ่นยา พร้อมอุปกรณ์", [R("ครั้ง", 300), R("วัน", 400), R("เดือน", 6000)], "X21"),
  item("NS-22", NS2, "บริการให้ออกซิเจน และพ่นยา (พร้อมอุปกรณ์ ไม่รวมยา)", [R("วัน", 600), R("เดือน", 9000)], "X29"),
  item("NS-23", NS2, "ค่าบริการดูดเสมหะ พร้อมอุปกรณ์", [R("ครั้ง", 150), R("เดือน", 9000), R("เดือน", 6000, "ราคาที่ 2")], "X03"),
  item("NS-30", NS3, "สวนปัสสาวะแบบสวนทิ้ง", [R("ครั้ง", 550)], "X17"),
  item("NS-31", NS3, "สวนปัสสาวะแบบคาสาย", [R("ครั้ง", 800)], "X18"),
  item("NS-40", NS4, "ค่าบริการตรวจน้ำตาลปลายนิ้ว DTX (พร้อมอุปกรณ์)", [R("ครั้ง", 100)], "X19"),
  item("NS-41", NS4, "ค่าบริการตรวจน้ำตาลปลายนิ้ว DTX (นำอุปกรณ์มาเอง)", [R("เดือน", 2500)], "X20"),
  item("NS-42", NS4, "ค่าบริการเจาะเลือด (ไม่รวมค่า Lab)", [R("ครั้ง", 200)], "X22"),
  item("CR-01", CR0, "ค่าดูแลผู้ป่วยติดเตียง", [R("เดือน", 7000)], "X24"),
  item("CR-02", CR0, "ค่าดูแลผู้ป่วยที่สามารถช่วยเหลือตัวเองได้บางส่วน", [R("เดือน", 5000)], "X25"),
  item("CR-10", CR1, "ค่าบริการผู้เฝ้า (กรณีผู้เฝ้ามาด้วย)", [R("วัน", 300), R("เดือน", 6000)], "X11"),
  item("CR-11", CR1, "ค่านักบริบาลเฝ้าพิเศษ (เวรละ 12 ชั่วโมง)", [R("ครั้ง", 1600, "ต่อเวร")], "X23"),
  item("CR-20", CR2, "ค่าบริการแพทย์ตรวจประเมิน (เข้าตรวจสัปดาห์ละ 1 ครั้ง)", [R("เดือน", 1000)], "X28"),
  item("EQ-01", EQ0, "ค่าบริการเตียงลม (ใช้ของทางศูนย์)", [R("วัน", 150), R("เดือน", 3000)], "X12"),
  item("EQ-02", EQ0, "ค่าไฟเตียงลม (นำอุปกรณ์มาเอง)", [R("วัน", 50), R("เดือน", 1000)], "X13"),
  item("PT-01", PT0, "ค่าบริการกายภาพพื้นฐาน", [R("ครั้ง", 200)], "X26"),
  item("PT-02", PT0, "ค่าบริการทีมฟื้นฟูวิชาชีพ (กายภาพบำบัด กิจกรรมบำบัด อรรถบำบัด นักจิตวิทยา แพทย์แผนจีน วิทยาศาสตร์การกีฬา ธาราบำบัด)", [R("ครั้ง", 1600)], "X27"),
  item("PT-11", PT1, "แพ็กเกจเสริมความแข็งแรง: กายภาพพื้นฐาน 15 ครั้ง", [R("แพ็กเกจ", 3000)], "P01"),
  item("PT-12", PT1, "แพ็กเกจเสริมความแข็งแรง: กายภาพบำบัดวิชาชีพ 1 ครั้ง + กายภาพพื้นฐาน 25 ครั้ง/เดือน", [R("แพ็กเกจ", 4500)], "P02"),
  item("PT-13", PT1, "แพ็กเกจเสริมความแข็งแรง: กายภาพบำบัดวิชาชีพ 4 ครั้ง + กายภาพพื้นฐาน 22 ครั้ง/เดือน", [R("แพ็กเกจ", 5500)], "P03"),
  item("PT-21", PT2, "ทีมฟื้นฟูวิชาชีพ 15 ครั้ง/เดือน", [R("แพ็กเกจ", 23000)], "P04"),
  item("PT-22", PT2, "ทีมฟื้นฟูวิชาชีพ 30 ครั้ง/เดือน", [R("แพ็กเกจ", 36000)], "P05"),
  item("PT-23", PT2, "ทีมฟื้นฟูวิชาชีพ 60 ครั้ง/เดือน", [R("แพ็กเกจ", 66000)], "P06"),
];

/** เรียงตามหมวด (ห้องพัก พยาบาล ดูแล อุปกรณ์ กายภาพ อื่น ๆ) แล้วตามรหัส · ใส่ชื่อหมวดให้ */
export function sortItems<T extends Omit<PriceItem, "group">>(list: T[]): (T & { group: string })[] {
  return list.map((x) => ({ ...x, group: CATS[x.cat]?.name ?? x.cat }))
    .sort((a, b) => CAT_IDS.indexOf(a.cat) - CAT_IDS.indexOf(b.cat) || a.code.localeCompare(b.code));
}

// ---------- ใบราคาปัจจุบันในหน้าเว็บ (โหลดจาก /api/prices ด้วย usePriceList) ----------
let current: PriceItem[] = DEFAULT_ITEMS;
const listeners = new Set<() => void>();
export const priceSnapshot = () => current;
export const subscribePrices = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export function setPrices(list: Omit<PriceItem, "group">[]) { current = sortItems(list); listeners.forEach((f) => f()); }

/** รายการที่ใช้อยู่ (ไม่รวมที่ปิดใช้) */
export const priceList = () => current.filter((x) => x.active !== false);
/** ชื่อที่ลงเอกสารเมื่อเลือกจากใบราคา */
export const pickName = (x: PriceItem) => (x.cat === "RM" ? `บริการ${x.name}` : x.name);

type Room = { code: string; name: string; day: number; month: number; promo: number };
const roomOf = (x: PriceItem): Room => {
  const p = (f: (r: Rate) => boolean) => x.rates.find(f)?.price ?? 0;
  const month = p((r) => r.unit === "เดือน" && !isPromo(r));
  return { code: x.code, name: x.name, day: p((r) => r.unit === "วัน"), month, promo: p((r) => r.unit === "เดือน" && isPromo(r)) || month };
};
/** ห้องพัก: ราคาปกติรายวัน/รายเดือน และราคาโปรโมชันรายเดือน */
export const rooms = (): Room[] => priceList().filter((x) => x.cat === "RM").map(roomOf);
const DEFAULT_ROOMS = DEFAULT_ITEMS.filter((x) => x.cat === "RM").map(roomOf);
/** ห้องจากราคาต่อเดือน · ใช้ตั้งชื่อบรรทัดค่าห้องในใบแจ้งหนี้จากราคาที่เลือกในสัญญา · สัญญาที่ทำก่อนเปลี่ยนราคาห้องเทียบกับราคาเดิม */
export function roomByPrice(price: number): { name: string; promo: boolean } | null {
  const r = rooms().find((x) => x.month === price || x.promo === price) ?? DEFAULT_ROOMS.find((x) => x.month === price || x.promo === price);
  return r ? { name: r.name, promo: r.promo === price && r.month !== price } : null;
}
/** บริการที่รวมในค่าห้อง (ใบอัตราค่าบริการ) */
export const ROOM_SERVICES = ["การพยาบาลขั้นพื้นฐาน", "กิจกรรมสันทนาการ", "กิจกรรมกลุ่มโดยนักกิจกรรมบำบัด 4 ครั้ง/เดือน", "พลิกตะแคงตัว", "วัด V/S ทุก 4 ชม.", "ดูแลด้านอาหารให้เหมาะสมตามโรคโดยนักโภชนาการ"];
const isPackage = (x: PriceItem) => x.rates.length > 0 && x.rates.every((r) => r.unit === "แพ็กเกจ");
/** ค่าบริการเพิ่มเติม (ตารางอัตราในสัญญา) */
export const extraServices = () => priceList().filter((x) => x.cat !== "RM" && !isPackage(x));
/** แพ็กเกจฟื้นฟู */
export const packages = () => priceList().filter((x) => x.cat !== "RM" && isPackage(x));

/** หน่วยที่แสดงในเอกสาร: แพ็กเกจคิดเป็นครั้งเดียว */
export const unitText = (u: string) => (u === "แพ็กเกจ" ? "แพ็กเกจ" : u);
export const rateText = (r: Rate) => `${r.price.toLocaleString("en-US")}/${r.unit}${r.label ? ` (${r.label})` : ""}`;

const flat = (s: string) => s.replace(/\s+/g, "").toLowerCase();
/** ค้นหาชื่อ หมวด หรือรหัส (รวมรหัสเดิม) แบบไม่สนช่องว่างและตัวพิมพ์ · ต้องพิมพ์อย่างน้อย 2 ตัวอักษร */
export function searchPrices(q: string, limit = 12) {
  const k = flat(q);
  if (k.length < 2) return [];
  return priceList().filter((x) => flat(x.name + x.group + x.sub + x.code + (x.old ?? []).join("")).includes(k)).slice(0, limit);
}

/** ตารางอัตราค่าบริการเพิ่มเติมในสัญญา: ราคารายครั้ง / รายวัน / รายเดือน (หลายราคาแสดงคั่นด้วย /) */
export function rateColumns(x: PriceItem) {
  const col = (u: RateUnit) => x.rates.filter((r) => r.unit === u).map((r) => r.price.toLocaleString("en-US")).join(" / ") || "-";
  return { once: col("ครั้ง"), day: col("วัน"), month: col("เดือน") };
}

/** รหัสคงที่ของบรรทัดที่ไม่ได้อยู่ในหน้าราคา (เงินที่รับไว้ ไม่ใช่รายได้ · ค่าห้องราคาพิเศษตามสัญญา) */
const FIXED_CODES: [RegExp, string][] = [
  [/^เงินประกัน/, "DP-01"], [/^มัดจำห้อง/, "DP-02"], [/^หัก\s*มัดจำ/, "AD-01"], [/^ค่าบริการรายเดือน/, "RM-99"],
];
/**
 * รหัสของบรรทัดในเอกสาร (ใบแจ้งหนี้ ใบเสนอราคา สัญญา)
 *  มีรหัสที่เก็บไว้ตอนเลือกจากหน้าราคา = ใช้รหัสนั้น
 *  เอกสารเก่า / ออกจากสัญญา = จับคู่ชื่อกับหน้าราคา (ชื่อยาวสุดที่อยู่ในบรรทัด) ราคาตรงกับราคาไหน = รหัสราคานั้น เช่น NS-01-M · ราคาไม่ตรง = รหัสหลัก NS-01
 *  ค่าห้องที่ไม่ตรงห้องในหน้าราคา = RM-99 (ห้องราคาพิเศษ) · ยา เวชภัณฑ์ และรายการพิมพ์เอง = ไม่มีรหัส
 */
export function lineCode(l: { desc: string; price: number; code?: string }, items: PriceItem[] = current) {
  if (l.code) return l.code;
  const d = l.desc.trim();
  const fixed = FIXED_CODES.find(([re]) => re.test(d));
  if (fixed) return fixed[1];
  if (/^(ยา|เวชภัณฑ์):/.test(d)) return "";
  const k = flat(d);
  const hit = items.filter((x) => k.includes(flat(x.name))).sort((a, b) => b.name.length - a.name.length)[0];
  if (hit) { const i = hit.rates.findIndex((r) => r.price === l.price); return i >= 0 ? rateCode(hit, i) : hit.code; }
  return /ห้อง|room/i.test(d) ? "RM-99" : "";
}
