/**
 * เลขที่ใบเสร็จ / ใบกำกับภาษีของงวดรับเงิน (18 พ.ย. 2569): <ตัวหน้า>-RC + ปีเดือนวันที่รับเงิน (พ.ศ. 2 หลัก) + ลำดับของวัน 4 หลัก
 *  ตัวหน้าแยกตามบริษัท (เลขใบกำกับภาษีต้องเรียงต่อเนื่องของแต่ละบริษัท): คิน ออริจิ้นฯ = KO · ทีทรีฯ และอื่น ๆ = KN
 *  งวดที่รับก่อนเริ่มใช้เลขนี้ (receiptNo ว่าง) ใช้เลขเดิม: รับครั้งเดียวครบ = เลขใบแจ้งหนี้ · หลายงวด = เลขใบ-งวด
 */
export const receiptPrefix = (legal?: string | null) => (/ออริจิ้น/.test(legal ?? "") ? "KO" : "KN");

/** "2026-11-18" → "691118" */
export const thaiDateStamp = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split("-"); return `${String((Number(y) + 543) % 100).padStart(2, "0")}${m}${d}`; };

/** เลขที่ใบเสร็จที่แสดง: เลขใหม่ (ถ้ามี) หรือเลขเดิม */
export const receiptNoOf = (p: { receiptNo?: string | null } | undefined, invNo: string | null | undefined, n: number, single: boolean) =>
  p?.receiptNo || (single ? invNo ?? "-" : `${invNo ?? "-"}-${n}`);
