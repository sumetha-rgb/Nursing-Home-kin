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
