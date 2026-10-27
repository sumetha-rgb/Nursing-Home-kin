/** ข้อมูลยาและซองยา ใช้ร่วมกันระหว่างแอปจัดยา (/pharmacy) และ KinApp (/staff) */

/* ---------- ชนิดข้อมูล ---------- */
export type Drug = {
  id: number; who: string; name: string; use: string; how: string; store: string; form: string;
  bulk: boolean; dose: number; timing: string; meals: string[]; days: string[]; warn: string[];
  stock: number; unit: string; fridge: boolean; hold: boolean; status: string;
};
export type Pack = {
  id: number; date: string; who: string; meal: string; items: string[]; qa: "รอตรวจ" | "ตรวจผ่าน" | "แจ้งจัดยาผิด"; reason?: string; given: boolean; by: string;
  /** ผู้ตรวจ QA · ผู้ให้ยา · เวลาที่ให้ยา (วว/ดด/ปปปป HH:MM) */
  qby?: string; gby?: string; gat?: string;
};
export type Page = "dashboard" | "inventory" | "master" | "templates" | "audit" | "dispense" | "qa" | "report" | "manual";

export const MEALS = ["เช้า", "กลางวัน", "เย็น", "ก่อนนอน"];
export const DAYS = ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."];
export const FORMS = ["ยาเม็ด / แคปซูล", "ยาน้ำ / ไซรัป", "ยาทา / ยาใช้ภายนอก", "ยาหยอด / พ่น", "ยาฉีด (เช่น อินซูลิน)"];
export const STORES = ["คลังยา (อุณหภูมิห้อง)", "ตู้เย็น", "กล่องยาฉุกเฉิน"];
export const TIMINGS = ["- ไม่ระบุ / ตามอาการ -", "หลังอาหาร (After)", "ก่อนอาหาร (Before)", "พร้อมอาหาร (With meal)", "ก่อนนอน (Bedtime)", "เมื่อมีอาการ (PRN)"];
export const AUDIT_STATUS = ["ปกติ", "ยาหมด / หมดสต๊อก", "ยาหมดอายุ", "ยางดใช้ (Discontinued)"];
export const ERR_5R = ["ผิดคน (Right Patient)", "ผิดชนิดยา (Right Drug)", "ผิดขนาด / จำนวนเม็ด (Right Dose)", "ผิดมื้อ / เวลา (Right Time)", "ผิดวิธีให้ยา (Right Route)"];
export const WARN_SUGGEST = ["ทานหลังอาหารทันที", "อาจทำให้ง่วงซึม", "ห้ามบด / ห้ามเคี้ยว", "ดื่มน้ำตามมากๆ", "หลีกเลี่ยงแอลกอฮอล์"];
export const RESIDENTS = ["คุณสุดา วงศ์สวัสดิ์", "คุณมาลี ศรีสุข", "คุณบุญช่วย แก้วมณี", "คุณสมศรี พิมพ์ทอง"];

export const d = (x: Partial<Drug> & Pick<Drug, "id" | "who" | "name">): Drug => ({
  use: "", how: "", store: STORES[0], form: FORMS[0], bulk: false, dose: 1, timing: TIMINGS[1], meals: ["เช้า"], days: [],
  warn: [], stock: 30, unit: "เม็ด", fridge: false, hold: false, status: "ปกติ", ...x,
});
export const DRUGS0: Drug[] = [
  d({ id: 1, who: RESIDENTS[0], name: "Metformin 500 mg", use: "ยาลดน้ำตาลในเลือด", how: "วันละ 2 ครั้ง หลังอาหาร เช้า-เย็น", meals: ["เช้า", "เย็น"], stock: 42, warn: ["ทานหลังอาหารทันที"] }),
  d({ id: 2, who: RESIDENTS[0], name: "Amlodipine 5 mg", use: "ยาลดความดันโลหิต", how: "วันละ 1 ครั้ง หลังอาหารเช้า", stock: 18 }),
  d({ id: 3, who: RESIDENTS[1], name: "Aspirin 81 mg", use: "ยาต้านเกล็ดเลือด", how: "วันละ 1 ครั้ง หลังอาหารเช้า", stock: 25 }),
  d({ id: 4, who: RESIDENTS[1], name: "Simvastatin 20 mg", use: "ยาลดไขมันในเลือด", how: "วันละ 1 ครั้ง ก่อนนอน", timing: TIMINGS[4], meals: ["ก่อนนอน"], stock: 2 }),
  d({ id: 5, who: RESIDENTS[1], name: "Lactulose syrup", use: "ยาระบาย", how: "15 ml ก่อนนอน", form: FORMS[1], bulk: true, unit: "ขวด", stock: 2, meals: ["ก่อนนอน"] }),
  d({ id: 6, who: RESIDENTS[2], name: "Glucosamine 1,500 mg", use: "บำรุงข้อ", how: "วันละ 1 ซอง ก่อนอาหารกลางวัน", timing: TIMINGS[2], meals: ["กลางวัน"], unit: "ซอง", stock: 20 }),
  d({ id: 7, who: RESIDENTS[2], name: "Calcium + Vit D", use: "เสริมแคลเซียม", how: "วันละ 1 เม็ด หลังอาหารเย็น จ. พ. ศ.", meals: ["เย็น"], days: ["จ.", "พ.", "ศ."], stock: 12 }),
  d({ id: 8, who: RESIDENTS[3], name: "Furosemide 40 mg", use: "ยาขับปัสสาวะ", how: "วันละ 1 ครั้ง หลังอาหารเช้า", stock: 9, warn: ["ดื่มน้ำตามมากๆ"] }),
];
export const MASTER0 = [
  ["Metformin 500 mg", "ยาลดน้ำตาลในเลือด"], ["Amlodipine 5 mg", "ยาลดความดันโลหิต"], ["Aspirin 81 mg", "ยาต้านเกล็ดเลือด"],
  ["Simvastatin 20 mg", "ยาลดไขมันในเลือด"], ["Atorvastatin 40 mg", "ยาลดไขมันในเลือด"], ["Furosemide 40 mg", "ยาขับปัสสาวะ"],
  ["Lactulose syrup", "ยาระบาย"], ["Glucosamine 1,500 mg", "บำรุงข้อ"], ["Calcium + Vit D", "เสริมแคลเซียม"],
];

export const iso = (x = new Date()) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
export const thai = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" });
export const dayOf = (s: string) => DAYS[(new Date(s + "T00:00:00").getDay() + 6) % 7];
/** ยาที่ต้องจัดลงซองในมื้อนั้นของวันนั้น (ไม่รวมยาขวด และยาที่งดชั่วคราว) */
export const drugsFor = (drugs: Drug[], who: string, meal: string, date: string) =>
  drugs.filter((x) => x.who === who && !x.bulk && !x.hold && x.status === "ปกติ" && x.meals.includes(meal) && (!x.days.length || x.days.includes(dayOf(date))));


/** วันเวลาปัจจุบันแบบที่บันทึกในระบบ: วว/ดด/ปปปป HH:MM (พ.ศ.) */
export const nowTh = (x = new Date()) => `${String(x.getDate()).padStart(2, "0")}/${String(x.getMonth() + 1).padStart(2, "0")}/${x.getFullYear() + 543} ${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}`;

/** จำนวนวันที่ยาเหลือพอใช้ (ยาเม็ดที่จัดลงซอง) · ไม่รู้ขนาดยา/มื้อ = null */
export const daysLeft = (x: Drug) => (x.bulk || !x.dose || !x.meals.length ? null : Math.floor(x.stock / (x.dose * x.meals.length)));
