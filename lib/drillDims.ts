/**
 * แตกย่อยตัวชี้วัด % (หน้าภาพรวมและรายงาน › ตัวชี้วัดหลัก) · ใช้ร่วมกันทั้งหน้าจอและ server (lib/drill.ts)
 *  แต่ละตัวชี้วัดมี "แยกตาม" หลายแบบ · chain = ลำดับมิติเมื่อกดแถวลงลึก (หมด chain = รายการจริงที่ต้องตาม)
 *  share = แถวเป็นสัดส่วนของยอดรวม (เช่น อายุหนี้) ไม่ใช่อัตราต่อเป้า
 */
export type DrillKpi = "occ" | "collect" | "tasks" | "ontime" | "meds";
export type DrillDim = "branch" | "room_type" | "floor" | "company" | "kind" | "age" | "task" | "shift" | "who" | "meal" | "resident";

export const DIM_LABEL: Record<DrillDim, string> = {
  branch: "สาขา", room_type: "ประเภทห้อง", floor: "ชั้น", company: "บริษัท", kind: "ประเภทใบ", age: "อายุหนี้",
  task: "งาน", shift: "กะ", who: "คนทำ", meal: "มื้อ", resident: "ผู้รับบริการ",
};

type Def = {
  dims: { chain: DrillDim[]; share?: boolean }[];
  /** หน่วยของฐาน เช่น "เตียง" · money = ยอดเงิน (แสดง "รับ X จาก Y บาท") */
  unit: string; money?: boolean;
  /** ข้อความใต้แถว: num จาก den */
  numWord: string;
  recTitle: string; recHead: string[]; view: string; viewLabel: string;
  /** ช่วงเวลาที่ใช้ (occ = ณ วันนี้ ไม่ตามช่วงที่เลือก) */
  now?: boolean;
};

export const DRILL: Record<DrillKpi, Def> = {
  occ: {
    dims: [{ chain: ["branch", "room_type"] }, { chain: ["room_type", "branch"] }, { chain: ["floor", "branch"] }],
    unit: "เตียง", numWord: "มีคน", now: true,
    recTitle: "ห้องที่ยังมีเตียงว่าง", recHead: ["ห้อง", "สาขา", "ประเภท", "ชั้น", "เตียงว่าง"], view: "rooms", viewLabel: "ไปหน้าห้องพักและเตียง",
  },
  collect: {
    dims: [{ chain: ["branch", "kind"] }, { chain: ["company", "branch"] }, { chain: ["kind", "branch"] }, { chain: ["age"], share: true }],
    unit: "บาท", money: true, numWord: "รับ",
    recTitle: "ใบที่ออกในช่วงนี้และยังค้างชำระ", recHead: ["เลขที่ใบ", "ผู้รับบริการ", "สาขา", "ค้าง (บาท)", "ค้างนาน"], view: "billing", viewLabel: "ไปหน้าใบแจ้งหนี้และใบเสร็จ",
  },
  tasks: {
    dims: [{ chain: ["branch", "task"] }, { chain: ["task", "branch"] }, { chain: ["shift", "who"] }, { chain: ["who"] }],
    unit: "งาน", numWord: "ส่ง",
    recTitle: "งานที่ยังไม่ส่ง", recHead: ["วันที่", "งาน", "ผู้รับบริการ", "กะ", "ผู้รับผิดชอบ"], view: "tasks", viewLabel: "ไปหน้ามอบหมายและตรวจงาน",
  },
  ontime: {
    dims: [{ chain: ["branch", "shift"] }, { chain: ["shift", "who"] }, { chain: ["who"] }, { chain: ["task", "branch"] }],
    unit: "งานที่ส่ง", numWord: "ตรงเวลา",
    recTitle: "งานที่ส่งช้าเกิน 30 นาที", recHead: ["วันที่", "งาน", "ผู้รับบริการ", "คนทำ", "กำหนด → ส่งจริง"], view: "tasks", viewLabel: "ไปหน้ามอบหมายและตรวจงาน",
  },
  meds: {
    dims: [{ chain: ["branch", "meal"] }, { chain: ["meal", "branch"] }, { chain: ["resident"] }],
    unit: "มื้อ", numWord: "ให้แล้ว",
    recTitle: "มื้อที่ยังไม่ได้ให้ยา", recHead: ["วันที่", "ผู้รับบริการ", "มื้อ", "ยา", "ผู้จัดยา"], view: "", viewLabel: "",
  },
};

export const isDrillKpi = (k: string): k is DrillKpi => k in DRILL;
/** มิติที่ใช้ได้ของตัวชี้วัด (ตรวจค่าที่ส่งมาจากหน้าจอ) */
export const dimsOf = (k: DrillKpi) => new Set(DRILL[k].dims.flatMap((d) => d.chain));
