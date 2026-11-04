/**
 * ส่งข้อมูลข้ามหน้าในระบบจัดการ (หน้าเดียวกัน ไม่ต้องรีโหลด) เช่น ใบเสนอราคา → เปิดสัญญา
 * ค่าหายเมื่อรีเฟรชหน้า ซึ่งตั้งใจไว้ (ไม่เก็บข้อมูลส่วนบุคคลค้างในเครื่อง)
 */
export type QuoteHandoff = { prefill: string[]; quoteId: string; quoteNo: string };
let pending: QuoteHandoff | null = null;
export const handoff = {
  set: (h: QuoteHandoff) => { pending = h; },
  take: () => { const h = pending; pending = null; return h; },
};

/**
 * สัญญา → การเงิน: เปิดฟอร์มใบแจ้งหนี้ (เก็บ id ของสัญญา)
 *  dc = ใบสรุปค่าใช้จ่ายก่อนกลับบ้าน: ไม่ใส่ค่าบริการรายเดือน ดึงรายการที่ยังไม่เรียกเก็บทั้งหมดเข้าใบให้
 */
/** หน้าแรก → มอบหมายและตรวจงาน: เปิดตัวกรองสถานะไว้ให้ (เช่น "late" = งานเลยเวลา) */
let taskFilter: string | null = null;
export const taskHandoff = {
  set: (f: string) => { taskFilter = f; },
  take: () => { const h = taskFilter; taskFilter = null; return h; },
};

/** หน้าแรก → การเงิน: เปิดหน้าต่างปิดยอดรายวันให้ทันที */
let cashOpen = false;
export const cashHandoff = {
  set: () => { cashOpen = true; },
  take: () => { const h = cashOpen; cashOpen = false; return h; },
};

let bill: { id: string; dc?: boolean } | null = null;
export const billHandoff = {
  set: (contractId: string, dc = false) => { bill = { id: contractId, dc }; },
  take: () => { const h = bill; bill = null; return h; },
};
