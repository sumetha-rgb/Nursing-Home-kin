import { randomUUID } from "node:crypto";
import { sql } from "@/lib/db";

/**
 * แพ็กเกจกายภาพในใบแจ้งหนี้ → คอร์สกายภาพ (นักกายภาพตัดครั้งได้ที่แท็บกายภาพ)
 *
 * ปัญหาเดิม (25 พ.ย. 2569): แพ็กเกจที่ใส่ในสัญญา/ใบแรกเข้า/ใบรายเดือน เช่น PT-22-P "ทีมฟื้นฟูวิชาชีพ 30 ครั้ง/เดือน"
 *  เก็บเงินแล้วแต่ไม่มีคอร์ส นักกายภาพจึงไม่มีครั้งให้ตัด (มีคอร์สเฉพาะที่ขายจากปุ่ม "ขายคอร์สกายภาพ")
 *
 * กติกา
 *  - บรรทัดที่นับ: รหัสแพ็กเกจกายภาพ PT-xx-P และชื่อมีจำนวนครั้ง (รวมทุกตัวเลข เช่น "วิชาชีพ 1 ครั้ง + พื้นฐาน 25 ครั้ง" = 26) × จำนวน
 *    ไม่นับบรรทัดคอร์สที่ขายจากปุ่มขายคอร์ส/ดึงเข้าใบ (ขึ้นต้น "คอร์ส" · มีคอร์สอยู่แล้ว) และกายภาพรายครั้ง
 *  - 1 บรรทัด = 1 คอร์ส ผูกกับใบนั้น (invoice_id) · ใบรายเดือนแต่ละเดือนได้คอร์สใหม่ ครั้งที่เหลือของเดือนก่อนยังใช้ต่อได้ (ไม่มีวันหมดอายุ)
 *  - แก้ใบที่ยังไม่รับเงิน: ปรับจำนวนครั้งตาม · เอาบรรทัดออก = ลบคอร์สที่ยังไม่ได้ตัดครั้ง (ตัดไปแล้วคงไว้)
 *  - ยกเลิกใบ: ลบคอร์สที่ยังไม่ได้ตัดครั้ง (ดู voidQuery) · ตัดไปแล้วคงไว้และกลับเป็น "ยังไม่เรียกเก็บ" ให้ดึงเข้าใบใหม่
 *  - คอร์สที่ระบบสร้าง: created_by ขึ้นต้น AUTO_BY ใช้แยกจากคอร์สที่คนสร้างเอง
 */
export const AUTO_BY = "จากใบ";

type Line = { desc?: string; qty?: number; price?: number; discount?: number; code?: string };
type Want = { code: string; name: string; total: number; price: number };

const r2 = (n: number) => Math.round(n * 100) / 100;
export const isPackageLine = (l: Line) => /^PT-\d+-P\d*$/.test(String(l.code ?? "")) && !/^\s*(คอร์ส|กายภาพรายครั้ง)/.test(String(l.desc ?? ""));
export const sessionsOf = (desc: string) => [...desc.matchAll(/(\d+)\s*ครั้ง/g)].reduce((t, m) => t + Number(m[1]), 0);

function wanted(itemsJson: unknown): Want[] {
  let lines: Line[] = [];
  try { const v = JSON.parse(String(itemsJson ?? "[]")); if (Array.isArray(v)) lines = v; } catch { return []; }
  return lines.filter(isPackageLine).flatMap((l) => {
    const qty = Math.max(1, Math.floor(Number(l.qty) || 1)), n = sessionsOf(String(l.desc));
    if (!(n > 0)) return [];
    const name = String(l.desc).replace(/\s*\((ล่วงหน้า|เดือน)[^)]*\)\s*$/, "").trim();
    return [{ code: String(l.code), name, total: n * qty, price: r2(qty * (Number(l.price) || 0) - (Number(l.discount) || 0)) }];
  });
}

/** สร้าง/ปรับคอร์สให้ตรงกับแพ็กเกจในใบ · เรียกหลังบันทึกใบ (ใบที่ยกเลิก/ใบลดหนี้ข้าม) · คืนข้อความสำหรับบันทึกการใช้งาน */
export async function syncPackageCourses(invoiceIds: string[]): Promise<{ id: string; branch: string | null; summary: string }[]> {
  if (!invoiceIds.length) return [];
  const invs = (await sql(`SELECT id, doc_no, resident_id, resident_name, branch_name, items_json, status, category FROM invoices WHERE id = ANY($1)`, [invoiceIds])) as
    { id: string; doc_no: string | null; resident_id: string | null; resident_name: string; branch_name: string | null; items_json: string; status: string | null; category: string | null }[];
  const out: { id: string; branch: string | null; summary: string }[] = [];
  for (const v of invs) {
    if (!v.resident_id || v.status === "ยกเลิก" || /ลดหนี้/.test(String(v.category ?? "")) || /ลดหนี้/.test(String(v.status ?? ""))) continue;
    const want = wanted(v.items_json);
    const have = (await sql(`SELECT id, price_code, total, used FROM physio_courses WHERE invoice_id = $1 AND created_by LIKE $2 ORDER BY created_at`, [v.id, `${AUTO_BY}%`])) as { id: string; price_code: string; total: number; used: number }[];
    if (!want.length && !have.length) continue;
    const left = [...have];
    for (const w of want) {
      const k = left.findIndex((h) => h.price_code === w.code);
      if (k >= 0) {
        const h = left.splice(k, 1)[0];
        if (h.total !== w.total) await sql(`UPDATE physio_courses SET total = GREATEST($2, used), name = $3, price = $4, status = CASE WHEN used >= GREATEST($2, used) THEN 'ครบแล้ว' ELSE 'ใช้งานอยู่' END WHERE id = $1`, [h.id, w.total, w.name, w.price]);
        continue;
      }
      const id = randomUUID();
      await sql(`INSERT INTO physio_courses (id, resident_id, resident_name, branch_name, name, total, price, created_by, price_code, invoice_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [id, v.resident_id, v.resident_name, v.branch_name, w.name, w.total, w.price, `${AUTO_BY} ${v.doc_no ?? ""}`.trim(), w.code, v.id]);
      out.push({ id, branch: v.branch_name, summary: `เพิ่มคอร์สกายภาพจากแพ็กเกจในใบ ${v.doc_no ?? ""} · ${w.name} ${w.total} ครั้ง · ${v.resident_name}` });
    }
    const drop = left.filter((h) => h.used === 0).map((h) => h.id);
    if (drop.length) await sql(`DELETE FROM physio_courses WHERE id = ANY($1) AND used = 0`, [drop]);
  }
  return out;
}

/** ยกเลิกใบ: คอร์สจากแพ็กเกจที่ยังไม่ได้ตัดครั้งลบทิ้ง (ต้องอยู่ก่อนคำสั่งคืน invoice_id = NULL ในชุดเดียวกัน) */
export const voidQuery = (voided: string[]) =>
  sql(`DELETE FROM physio_courses WHERE invoice_id = ANY($1) AND created_by LIKE $2 AND used = 0 AND EXISTS (SELECT 1 FROM invoices v WHERE v.id = physio_courses.invoice_id AND v.status = 'ยกเลิก')`, [voided, `${AUTO_BY}%`]);
