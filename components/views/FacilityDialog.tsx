"use client";
import { useEffect, useState } from "react";
import { Field, Modal } from "../ui";

/**
 * ฟอร์มงานส่วนกลางของสาขา (26 พ.ย. 2569 · แบบใหม่)
 *  งานส่วนกลาง = งานสถานที่และความสะอาด (ไม่ใช่งานดูแลผู้ป่วย) · พนักงานส่งรูปใน KinApp
 *  ชื่องาน: พิมพ์เอง (มีชื่อที่ใช้บ่อยให้แตะ) · หมวดหมู่ / ความถี่ / วิธีจ่ายงาน: ปุ่มกด · เวลา: เลือก ชม. : นาที (ไม่บังคับ)
 *  ผู้รับผิดชอบขึ้นเฉพาะเมื่อเลือก มอบหมายคนรับผิดชอบ · คำแนะนำเพิ่มเติมบันทึกจริง (พนักงานเห็นใน KinApp ตอนส่งงาน)
 *  แถว [ชื่องาน, หมวดหมู่, เวลา / ความถี่, วิธีจ่ายงาน, คำแนะนำ] · เวลา / ความถี่ เช่น "07:00 / ทุกวัน" "วันที่ 1 / ทุกเดือน"
 */
export type FacValue = { name: string; cat: string; freq: string; day: string; hh: string; mm: string; manual: boolean; who: string; note: string };
const FREQ = ["ทุกวัน", "ทุกสัปดาห์", "ทุกเดือน"];
const COMMON = ["ทำความสะอาดห้องโถงส่วนกลาง", "ตรวจสอบอุปกรณ์ดับเพลิง", "เช็ดทำความสะอาดโซฟาส่วนกลาง", "ฆ่าเชื้อราวจับและลูกบิดประตู", "ล้างแอร์ห้องโถง", "ตรวจไฟฉุกเฉินและทางหนีไฟ", "ตรวจอุณหภูมิตู้เย็นเก็บยา", "ทิ้งขยะติดเชื้อ"];

/** แถวเดิม → ค่าในฟอร์ม (รองรับค่าเดิม "07:00 / ทุกวัน (Daily)" "ทุกเดือน วันที่ 1" "กะเช้า / ทุกสัปดาห์") */
export function facFromRow(r: string[] | undefined, assignee = ""): FacValue {
  const s = String(r?.[2] ?? "");
  const t = /(\d{1,2}):(\d{2})/.exec(s), d = /วันที่\s*(\d{1,2})/.exec(s);
  return {
    name: r?.[0] ?? "", cat: r?.[1] ?? "",
    freq: s.includes("ทุกเดือน") ? "ทุกเดือน" : s.includes("ทุกสัปดาห์") ? "ทุกสัปดาห์" : "ทุกวัน",
    day: d ? d[1] : "", hh: t ? t[1].padStart(2, "0") : "", mm: t ? t[2] : "00",
    manual: /Manual|มอบหมาย/.test(r?.[3] ?? ""), who: assignee, note: r?.[4] && r[4] !== "-" ? r[4] : "",
  };
}
/** ค่าในฟอร์ม → ข้อความ เวลา / ความถี่ */
export const facSchedule = (v: FacValue) => [v.freq === "ทุกเดือน" && v.day ? `วันที่ ${v.day}` : "", v.hh ? `${v.hh}:${v.mm || "00"}` : "", v.freq].filter(Boolean).join(" / ");

export default function FacilityDialog({ open, edit, value, cats, names, nurses, global, onClose, onSave }: {
  open: boolean; edit: boolean; value: FacValue;
  /** หมวดหมู่ (ตั้งค่าตัวเลือก) · ชื่องานส่วนกลางที่มีอยู่แล้ว (ไว้แนะนำ) · รายชื่อพยาบาล/ผู้ช่วยพยาบาล */
  cats: string[]; names: string[]; nurses: string[]; global: boolean;
  onClose: () => void; onSave: (v: FacValue) => void;
}) {
  const [v, setV] = useState(value);
  const [err, setErr] = useState("");
  useEffect(() => { if (open) { setV(value); setErr(""); } }, [open, value]);
  const set = (p: Partial<FacValue>) => { setErr(""); setV((x) => ({ ...x, ...p })); };
  const sug = [...new Set([...names, ...COMMON])].filter((n) => n !== v.name && (!v.name.trim() || n.includes(v.name.trim()))).slice(0, 4);
  const save = () => {
    if (!v.name.trim()) return setErr("กรุณาพิมพ์ชื่องาน");
    if (v.manual && !global && v.who && !nurses.includes(v.who)) return setErr("ผู้รับผิดชอบ: เลือกชื่อจากรายการ");
    onSave({ ...v, name: v.name.trim(), note: v.note.trim(), cat: v.cat || cats[0] || "" });
  };
  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  return (
    <Modal open={open} title={edit ? "แก้ไขงานส่วนกลาง" : "เพิ่มงานส่วนกลางของสาขา"} onClose={onClose}
      footer={<><button type="button" className="btn-soft" onClick={onClose}>ยกเลิก</button><button type="button" className="btn-primary" onClick={save}>บันทึก</button></>}>
      <div className="fx">
        <Field label="ชื่องาน" required>
          <input value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="พิมพ์ชื่องาน เช่น ล้างแอร์ห้องโถง" aria-label="ชื่องาน" />
        </Field>
        {sug.length > 0 && <div className="fx-sug">{sug.map((n) => <button key={n} type="button" onClick={() => set({ name: n })}>{n}</button>)}</div>}
        <div className="fx-row">
          <span className="fx-l">หมวดหมู่</span>
          <div className="fx-chips" role="group" aria-label="หมวดหมู่">{(v.cat && !cats.includes(v.cat) ? [...cats, v.cat] : cats).map((c) => <button key={c} type="button" aria-pressed={(v.cat || cats[0]) === c} onClick={() => set({ cat: c })}>{c.replace(/\s*NA$/, "")}</button>)}</div>
        </div>
        <div className="fx-grid">
          <div className="fx-row">
            <span className="fx-l">ความถี่ <i>*</i></span>
            <div className="fx-chips" role="group" aria-label="ความถี่">{FREQ.map((f) => <button key={f} type="button" aria-pressed={v.freq === f} onClick={() => set({ freq: f })}>{f}</button>)}</div>
          </div>
          <div className="fx-row">
            <span className="fx-l">เวลา <small>ไม่บังคับ</small></span>
            <div className="fx-time">
              {v.freq === "ทุกเดือน" && <select value={v.day} onChange={(e) => set({ day: e.target.value })} aria-label="วันที่ของเดือน"><option value="">วันไหนก็ได้</option>{Array.from({ length: 28 }, (_, i) => <option key={i} value={String(i + 1)}>วันที่ {i + 1}</option>)}</select>}
              <span className="fx-hm">
              <select value={v.hh} onChange={(e) => set({ hh: e.target.value })} aria-label="ชั่วโมง"><option value="">ไม่ระบุ</option>{hours.map((h) => <option key={h} value={h}>{h}</option>)}</select>
              <span>:</span>
              <select value={v.mm} disabled={!v.hh} onChange={(e) => set({ mm: e.target.value })} aria-label="นาที">{["00", "15", "30", "45"].map((m) => <option key={m} value={m}>{m}</option>)}</select>
              <span>น.</span>
              </span>
            </div>
          </div>
        </div>
        <div className="fx-row">
          <span className="fx-l">วิธีจ่ายงาน <i>*</i></span>
          <div className="fx-mode" role="group" aria-label="วิธีจ่ายงาน">
            <button type="button" aria-pressed={!v.manual} onClick={() => set({ manual: false })}><b>ขึ้นให้ทุกคน</b><small>ใครทำก่อน ส่งรูปใน KinApp</small></button>
            <button type="button" aria-pressed={v.manual} onClick={() => set({ manual: true })}><b>มอบหมายคนรับผิดชอบ</b><small>ขึ้นเฉพาะคนที่เลือก</small></button>
          </div>
        </div>
        {v.manual && (global
          ? <p className="fx-note">ผู้บริหาร: บันทึกงานแล้วเลือกสาขาและคนรับผิดชอบที่ปุ่ม มอบหมาย ในตาราง</p>
          : <Field label="ผู้รับผิดชอบ (พยาบาล / ผู้ช่วยพยาบาล)">
              <input list="fx-nurses" value={v.who} onChange={(e) => set({ who: e.target.value })} placeholder={nurses.length ? "พิมพ์ค้นหาชื่อ · ว่าง = ยังไม่มอบหมาย" : "กำลังโหลดรายชื่อ…"} aria-label="ผู้รับผิดชอบ" />
              <datalist id="fx-nurses">{nurses.map((n) => <option key={n} value={n} />)}</datalist>
            </Field>)}
        <Field label="คำแนะนำเพิ่มเติม" optional>
          <textarea rows={2} value={v.note} onChange={(e) => set({ note: e.target.value })} placeholder="เช่น ใช้น้ำยาฆ่าเชื้อสีฟ้า เช็ดลูกบิดประตูด้วย · ขึ้นใน KinApp ตอนเปิดงาน" aria-label="คำแนะนำเพิ่มเติม" />
        </Field>
        {err && <p role="alert" className="form-error">{err}</p>}
      </div>
    </Modal>
  );
}
