"use client";
import { useEffect, useState } from "react";
import { Field, Modal } from "../ui";

/**
 * ฟอร์มเพิ่ม/แก้ข้อมูลสาขา (ผู้บริหาร) · กรอกได้ในหน้าเดียวไม่ต้องเลื่อน (จอคอม) · 3 คอลัมน์: สาขา · ติดต่อและที่ตั้ง · บริษัทและบัญชีรับโอน
 *  แถวข้อมูล (lib/schema branches · components/views/Admin BRANCH_FIELDS) 17 ช่อง:
 *  0 รหัส · 1 ชื่อสาขา · 2 นิติบุคคล · 3 เบอร์ · 4 ที่อยู่ · 5 เตียง · 6 ประเภทเจ้าของ · 7 ประเภทสาขา · 8 จุดเด่น · 9 อีเมล · 10 สถานะ
 *  11 พิกัด · 12 ลิงก์ภาพ · 13 ใบอนุญาต · 14 ธนาคารและชื่อบัญชี · 15 บัญชีหลัก · 16 บัญชีสำรอง
 *  ชื่อสาขาเป็นตัวผูกข้อมูลทุกอย่าง (ผู้รับบริการ สัญญา ใบแจ้งหนี้ ตารางเวร) จึงแก้ไม่ได้หลังสร้าง
 */
export const OWNER_TYPES = ["HQ", "F (Franchise)", "B (NJY GROUP)"];
export const BRANCH_TYPES = ["ศูนย์ดูแลผู้สูงอายุ (Nursing Home)", "ศูนย์บริการจัดส่งพนักงาน (Central Services)", "จุดบริการหน้าร้าน (POS/Retail)", "สำนักงานส่วนกลาง (HQ/Backoffice)"];
export const BRANCH_STATUS = ["เปิด", "เตรียมเปิด", "ปิด", "ภายใน"];

export default function BranchDialog({ open, mode, value, names, companies, bedsFromRooms, onClose, onSave }: {
  open: boolean; mode: "add" | "edit"; value?: string[];
  /** ชื่อสาขาที่มีอยู่แล้ว (กันชื่อซ้ำ) */
  names: string[];
  /** บริษัทที่สาขาอื่นใช้อยู่ (เลือกได้เลย ไม่ต้องพิมพ์ชื่อเต็ม) */
  companies: string[];
  /** มีห้องในเมนูห้องพักและเตียงแล้ว: จำนวนเตียงนับให้เอง แก้ไม่ได้ */
  bedsFromRooms: boolean;
  onClose: () => void; onSave: (v: string[]) => void;
}) {
  const blank = () => { const v = Array(17).fill(""); v[6] = "HQ"; v[7] = BRANCH_TYPES[0]; v[10] = "เตรียมเปิด"; v[2] = companies.find((c) => /ทีทรี/.test(c)) ?? companies[0] ?? ""; return v; };
  const [v, setV] = useState<string[]>(blank);
  const [err, setErr] = useState("");
  useEffect(() => { if (open) { setV(value ? Array.from({ length: 17 }, (_, i) => value[i] ?? "") : blank()); setErr(""); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (i: number, x: string) => { setV((p) => { const n = [...p]; n[i] = x; return n; }); setErr(""); };
  const edit = mode === "edit";
  const input = (i: number, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => <input value={v[i] ?? ""} onChange={(e) => set(i, e.target.value)} {...props} />;
  const select = (i: number, opts: string[]) => <select value={v[i] ?? ""} onChange={(e) => set(i, e.target.value)}>{!opts.includes(v[i]) && v[i] && <option value={v[i]}>{v[i]}</option>}{opts.map((o) => <option key={o} value={o}>{o}</option>)}</select>;
  const save = () => {
    const name = v[1].trim();
    if (!name) return setErr("กรุณากรอกชื่อสาขา");
    if (!edit && names.some((n) => n.trim() === name)) return setErr(`มีสาขาชื่อ "${name}" อยู่แล้ว`);
    if (!v[10]) return setErr("กรุณาเลือกสถานะ");
    onSave(v.map((x, i) => (i === 1 ? name : x.trim())));
  };
  return (
    <Modal open={open} title={edit ? `แก้ไขข้อมูลสาขา · ${v[1]}` : "เพิ่มสาขาใหม่"} onClose={onClose}
      footer={<>{err && <p role="alert" className="bf-err">{err}</p>}<button type="button" className="btn-soft" onClick={onClose}>ยกเลิก</button><button type="button" className="btn-primary" onClick={save}>{edit ? "บันทึก" : "เพิ่มสาขา"}</button></>}>
      <div className="bf">
        <section>
          <h4>ข้อมูลสาขา</h4>
          <Field label="ชื่อสาขา" required>{edit ? <p className="field-view">{v[1]}</p> : input(1, { placeholder: "เช่น อ้อมกอด พระราม 3", autoFocus: true })}</Field>
          <p className="bf-hint">{edit ? "เปลี่ยนชื่อไม่ได้ ข้อมูลทุกอย่างของสาขาผูกกับชื่อนี้" : "ขึ้นทุกหน้า เช่น สาขาอ้อมกอด พระราม 3 · ตั้งแล้วเปลี่ยนไม่ได้"}</p>
          <div className="bf-2">
            <Field label="รหัสสาขา">{input(0, { placeholder: "เช่น KIN-RM3" })}</Field>
            <Field label="สถานะ" required>{select(10, BRANCH_STATUS)}</Field>
          </div>
          <Field label="ประเภทสาขา">{select(7, BRANCH_TYPES)}</Field>
          <div className="bf-2">
            <Field label="ประเภทเจ้าของ">{select(6, OWNER_TYPES)}</Field>
            <Field label="จำนวนเตียง">{bedsFromRooms ? <p className="field-view" title="นับจากห้องพักและเตียง">{v[5] || "0"}</p> : input(5, { type: "number", min: 0, placeholder: "0" })}</Field>
          </div>
        </section>
        <section>
          <h4>ติดต่อและที่ตั้ง</h4>
          <div className="bf-2">
            <Field label="เบอร์ติดต่อศูนย์">{input(3, { type: "tel", placeholder: "02-xxx-xxxx" })}</Field>
            <Field label="อีเมล">{input(9, { type: "email" })}</Field>
          </div>
          <Field label="ที่อยู่ศูนย์"><textarea rows={2} value={v[4]} onChange={(e) => set(4, e.target.value)} placeholder="เลขที่ ถนน แขวง เขต จังหวัด รหัสไปรษณีย์" /></Field>
          <Field label="พิกัด (ละติจูด, ลองจิจูด)">{input(11, { placeholder: "13.6912, 100.5420" })}</Field>
          <Field label="ลิงก์ภาพสาขา">{input(12, { placeholder: "https://…" })}</Field>
        </section>
        <section>
          <h4>บริษัทและบัญชีรับโอน</h4>
          <Field label="บริษัทที่ออกเอกสาร (นิติบุคคล)">
            <input list="bf-companies" value={v[2]} onChange={(e) => set(2, e.target.value)} placeholder="เลือกหรือพิมพ์ชื่อบริษัท" />
          </Field>
          <datalist id="bf-companies">{companies.map((c) => <option key={c} value={c} />)}</datalist>
          <p className="bf-hint">ใบแจ้งหนี้ ใบเสร็จ สัญญา ออกในนามบริษัทนี้</p>
          <Field label="เลขที่ใบอนุญาตประกอบกิจการ">{input(13)}</Field>
          <Field label="ธนาคารและชื่อบัญชี">{input(14, { placeholder: "เช่น กสิกรไทย · บจก. …" })}</Field>
          <div className="bf-2">
            <Field label="เลขบัญชีหลัก">{input(15)}</Field>
            <Field label="เลขบัญชีสำรอง">{input(16)}</Field>
          </div>
        </section>
        <Field label="จุดเด่นของสาขา" className="bf-wide"><textarea rows={2} value={v[8]} onChange={(e) => set(8, e.target.value)} placeholder="เช่น ใกล้โรงพยาบาล มีนักกายภาพประจำ" /></Field>
      </div>
    </Modal>
  );
}
