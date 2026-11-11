"use client";
import { useEffect, useState } from "react";
import { Modal } from "../ui";
import PhotoPicker from "../PhotoPicker";
import { useApp } from "@/lib/app";
import { useSession } from "@/lib/session";
import { stampPhoto } from "@/lib/roster";
import { ACTIVITIES, bmiOf, canEditRec, editLeft, EDIT_DAYS, MAX_PHOTOS, MOBILITY, PhysioHistory, PhysioVisit, VITAL_FIELDS, Vitals, vitalsText, vitalWarnings } from "@/lib/physio";

/** เคสที่จะบันทึก (ใช้ได้ทั้ง KinApp และโปรไฟล์ผู้รับบริการในระบบจัดการ) */
export type RecordTarget = {
  courseId: string; courseName: string; used: number; total: number; residentName: string; hn?: string | null; room?: string | null;
  /** ค่าจากครั้งก่อน (ดึงมาเป็นค่าเริ่มต้น) */
  last?: { cc?: string | null; dx?: string | null; pain?: string | null; mobility?: string | null };
  /** เช็คอินแล้ว (KinApp) = บังคับรูปงาน · ไม่มี = บันทึกจากระบบจัดการ ไม่มีส่วนรูป */
  visit?: PhysioVisit;
  /** บันทึกแทนนักกายภาพคนนี้ */
  forName?: string | null;
  /** แก้ไขบันทึกเดิม (ภายใน 7 วัน) · ไม่ตัดคอร์สเพิ่ม ไม่เปลี่ยนรูป */
  edit?: PhysioHistory;
};
type F = { activities: string[]; pain: string; mobility: string; photos: string[]; vit: Record<string, string>; cc: string; pe: string; dx: string; plan: string; showVit: boolean; minutes: string };

/** ท้ายรายการประวัติ: ตัวหนังสือแดงบอกเวลาที่ยังแก้ได้ + ปุ่มแก้ไข (ผู้บันทึก / ผู้จัดการสาขา) */
export function EditNote({ h, onEdit }: { h: PhysioHistory; onEdit: () => void }) {
  const { user } = useSession();
  const left = editLeft(h);
  return <>
    {h.edited && <p className="pk-edited">แก้ไขล่าสุด {h.edited.slice(8, 10)}/{h.edited.slice(5, 7)} {h.edited.slice(11)} น.{h.edited_by ? ` · ${h.edited_by}` : ""}</p>}
    {left && canEditRec(user, h) && (left.open
      ? <div className="pk-editrow"><p className="pk-editwarn">แก้ไขได้อีก {left.days} วัน (ถึง {left.until}) · เกิน {EDIT_DAYS} วันแก้ไม่ได้</p><button type="button" className="btn-soft !min-h-0 !py-1.5 !text-sm" onClick={onEdit}>แก้ไข</button></div>
      : <p className="pk-editwarn is-off">เกิน {EDIT_DAYS} วันหลังบันทึก · แก้ไขไม่ได้แล้ว</p>)}
  </>;
}
const nowTh = () => new Date().toLocaleString("th-TH", { day: "numeric", month: "short", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const since = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));

/** รูปทดสอบ (บัญชีทดลองบนคอมที่ไม่มีกล้อง) */
export function testPhoto(label: string) {
  const c = document.createElement("canvas");
  c.width = 640; c.height = 480;
  const g = c.getContext("2d")!;
  g.fillStyle = "#e9dcc3"; g.fillRect(0, 0, 640, 480);
  g.strokeStyle = "#b89560"; g.lineWidth = 6; g.strokeRect(14, 14, 612, 452);
  g.fillStyle = "#6b4f1e"; g.textAlign = "center";
  g.font = '700 44px "Noto Sans Thai", Tahoma, sans-serif'; g.fillText("รูปทดสอบ", 320, 170);
  g.font = '26px "Noto Sans Thai", Tahoma, sans-serif'; g.fillText(label, 320, 220);
  return c.toDataURL("image/jpeg", 0.8);
}
/** ประทับหัวข้อ ชื่อผู้รับบริการ ห้อง ผู้ถ่าย และเวลาลงรูป */
export const stampFor = (u: string, title: string, resident: string, room: string | null | undefined, who: string) =>
  stampPhoto(u, [title, `${resident}${room ? ` · ห้อง ${room}` : ""}`, `${who} · ${nowTh()} น.`]);

/**
 * ฟอร์มบันทึกกายภาพ (ตัดคอร์ส 1 ครั้ง): 1 สัญญาณชีพ (เตือนค่าที่เป็นไปไม่ได้) · 2 บันทึกการตรวจรักษา · 3 ผลการทำกายภาพ · 4 รูปงาน (เฉพาะเมื่อเช็คอิน)
 *  อาการสำคัญ/วินิจฉัยดึงจากครั้งก่อน · onSaved ได้ { used, total } จาก server
 */
export default function PhysioRecordModal({ target, testMode = false, onClose, onSaved }: {
  target: RecordTarget | null; testMode?: boolean; onClose: () => void; onSaved: (x: { used: number; total: number }) => void;
}) {
  const { toast, confirm } = useApp();
  const { user } = useSession();
  const [f, setF] = useState<F | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!target) { setF(null); return; }
    const e = target.edit;
    if (e) {
      // แก้ไข: ค่าเดิมทั้งหมด · บันทึกแบบเก่าที่มีแต่ข้อความรวม = ใส่ไว้ช่องตรวจร่างกาย
      const plain = !(e.cc || e.pe || e.dx || e.plan);
      setF({ activities: e.activities ?? [], pain: e.pain ?? "", mobility: e.mobility ?? "", photos: [], cc: e.cc ?? "", pe: e.pe ?? (plain ? e.body ?? "" : ""), dx: e.dx ?? "", plan: e.plan ?? "",
        vit: Object.fromEntries(Object.entries(e.vitals ?? {}).filter(([k]) => k !== "bmi").map(([k, v]) => [k, String(v)])), showVit: true, minutes: e.minutes != null ? String(e.minutes) : "" });
      return;
    }
    setF({ activities: [], pain: target.last?.pain ?? "", mobility: target.last?.mobility ?? "", photos: [], vit: {}, cc: target.last?.cc ?? "", pe: "", dx: target.last?.dx ?? "", plan: "", showVit: true, minutes: "" });
  }, [target]);
  if (!target || !f) return null;
  const t = target, ed = t.edit, needPhoto = !!t.visit && !ed, left = ed ? editLeft(ed) : null;
  const set = (p: Partial<F>) => setF({ ...f, ...p });
  const stamp = (u: string) => stampFor(u, "กายภาพ", t.residentName, t.room, user?.name ?? "");
  const vitals = (): Vitals => {
    const o: Vitals = {};
    for (const x of VITAL_FIELDS) { const n = Number(f.vit[x.k]); if (x.k !== "bmi" && f.vit[x.k]?.trim() && Number.isFinite(n) && n > 0) o[x.k] = n; }
    const b = bmiOf(o.bw, o.ht); if (b) o.bmi = b;
    return o;
  };
  const warn = vitalWarnings(vitals());
  const txDone = [f.cc, f.pe, f.dx, f.plan].some((x) => x.trim());
  const miss = [needPhoto && !f.photos.length && "รูปงาน", !txDone && "บันทึกการตรวจรักษา"].filter(Boolean) as string[];

  const send = async () => {
    const v = vitals();
    // ข้อความรวม (แสดงในตาราง Progress note ของโปรไฟล์ผู้รับบริการ)
    const body = [f.cc && `อาการสำคัญ: ${f.cc}`, f.pe && `ตรวจร่างกาย: ${f.pe}`, f.dx && `วินิจฉัย: ${f.dx}`, f.plan && `แผนการรักษา: ${f.plan}`, vitalsText(v) && `สัญญาณชีพ: ${vitalsText(v)}`].filter(Boolean).join("\n");
    setBusy(true);
    if (ed) {
      const r = await fetch("/api/clinic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        op: "physio_edit", id: ed.id, body, data: { pain: f.pain, plan: f.plan, mobility: f.mobility, activities: f.activities, vitals: v, cc: f.cc, pe: f.pe, dx: f.dx, minutes: f.minutes.trim() ? Number(f.minutes) : null },
      }) });
      const x = await r.json().catch(() => ({}));
      setBusy(false);
      if (!r.ok) return toast(x.error || "แก้ไขไม่สำเร็จ");
      toast(`แก้ไข${ed.title ?? "บันทึกกายภาพ"}แล้ว · เก็บประวัติการแก้ไขไว้`);
      return onSaved({ used: t.used, total: t.total });
    }
    const r = await fetch("/api/clinic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
      op: "course_use", courseId: t.courseId, ...(t.visit ? { visitId: t.visit.id, photos: f.photos } : {}), body,
      data: { pain: f.pain, plan: f.plan, mobility: f.mobility, minutes: t.visit ? since(t.visit.iso) || null : null, activities: f.activities, vitals: v, cc: f.cc, pe: f.pe, dx: f.dx },
    }) });
    const x = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast(x.error || "บันทึกไม่สำเร็จ");
    toast(`บันทึก${t.residentName} ครั้งที่ ${x.used}/${x.total} แล้ว${x.total - x.used <= 2 ? ` · เหลือ ${x.total - x.used} ครั้ง แจ้งญาติ/ฝ่ายขาย` : ""}`);
    onSaved(x);
  };
  const save = () => {
    if (miss.length) return toast(`กรุณากรอก${miss.join("และ")}`);
    // ค่าสัญญาณชีพที่เป็นไปไม่ได้ → ถามยืนยันก่อน (กันพิมพ์ผิด)
    if (warn.length) return confirm({ title: "ตรวจสอบค่าสัญญาณชีพ", message: `ค่าเหล่านี้ผิดปกติมาก อาจพิมพ์ผิด: ${warn.join(" · ")} · ยืนยันบันทึกตามนี้?`, okLabel: "ยืนยันบันทึก", onOk: send });
    send();
  };

  const num = (k: string, label: string, unit: string, step = "1") => (
    <label className="pk-num"><span>{label}</span><span className="pk-num-in"><input type="number" inputMode="decimal" step={step} min={0} value={f.vit[k] ?? ""} onChange={(e) => set({ vit: { ...f.vit, [k]: e.target.value } })} aria-label={`${label} (${unit})`} /><em>{unit}</em></span></label>
  );
  const filled = VITAL_FIELDS.filter((x) => x.k !== "bmi" && f.vit[x.k]?.trim()).length;
  const bmi = bmiOf(Number(f.vit.bw) || undefined, Number(f.vit.ht) || undefined);
  const step = (n: number, done: boolean) => <i className={done ? "is-done" : ""}>{done ? "✓" : n}</i>;
  return (
    <Modal open title={`${ed ? "แก้ไขบันทึกกายภาพ" : "บันทึกกายภาพ"} · ${t.residentName || t.courseName}`} onClose={onClose}
      footer={<>{miss.length > 0 && <span className="pk-miss">ยังขาด: {miss.join(" · ")}</span>}
        <button className="btn-soft" onClick={onClose}>ยกเลิก</button>
        <button className="btn-primary" disabled={busy || miss.length > 0 || (!!ed && !left?.open)} onClick={save}>{busy ? "กำลังบันทึก…" : ed ? "บันทึกการแก้ไข" : "บันทึก · ตัดคอร์ส 1 ครั้ง"}</button></>}>
      <div className="pk-form pk-rec">
        {ed ? <>
          <p className="pk-who-line"><b>{ed.title ?? t.courseName}</b> · บันทึกเมื่อ {ed.at}{ed.author ? ` โดย ${ed.author}` : ""}</p>
          <p className="pk-editwarn is-box">{left?.open ? `แก้ไขได้อีก ${left.days} วัน (ถึง ${left.until}) · ` : ""}แก้ไขได้ภายใน {EDIT_DAYS} วันหลังบันทึกเท่านั้น · ทุกการแก้ไขเก็บค่าก่อน-หลังไว้ในบันทึกการใช้งาน · จำนวนครั้งและรูปไม่เปลี่ยน</p>
        </> : <p className="pk-who-line"><b>{t.residentName || t.courseName}</b>{t.hn ? ` · ${t.hn}` : ""} · ครั้งที่ {t.used + 1}/{t.total}{t.visit ? ` · เช็คอิน ${t.visit.at} น.` : ""}{t.forName ? ` · บันทึกแทน ${t.forName}` : ""}</p>}

        <section className="pk-step is-opt">
          <button type="button" className="pk-step-h" aria-expanded={f.showVit} onClick={() => set({ showVit: !f.showVit })}>
            <h4>{step(1, filled > 0)}สัญญาณชีพ / ข้อมูลร่างกาย<small>{filled ? `กรอกแล้ว ${filled} ค่า · ` : ""}วัดได้ช่องไหนกรอกช่องนั้น · BMI คำนวณให้เอง</small></h4>
            <span aria-hidden>{f.showVit ? "−" : "+"}</span>
          </button>
          {f.showVit && <div className="pk-vit3">
            {num("bw", "น้ำหนัก", "kg", "0.1")}{num("ht", "ส่วนสูง", "cm", "0.1")}
            <label className="pk-num"><span>BMI</span><span className="pk-num-in is-auto"><input value={bmi ?? ""} readOnly tabIndex={-1} placeholder="อัตโนมัติ" aria-label="BMI คำนวณอัตโนมัติ" /></span></label>
            {num("bt", "อุณหภูมิ", "°C", "0.1")}{num("pr", "ชีพจร", "/นาที")}{num("rr", "หายใจ", "/นาที")}
            {num("o2", "O₂sat", "%")}
            <label className="pk-num pk-bp"><span>ความดัน</span><span className="pk-num-in">
              <input type="number" inputMode="numeric" min={0} value={f.vit.sys ?? ""} onChange={(e) => set({ vit: { ...f.vit, sys: e.target.value } })} aria-label="BP Systolic (mmHg)" placeholder="บน" />
              <b>/</b>
              <input type="number" inputMode="numeric" min={0} value={f.vit.dia ?? ""} onChange={(e) => set({ vit: { ...f.vit, dia: e.target.value } })} aria-label="BP Diastolic (mmHg)" placeholder="ล่าง" /><em>mmHg</em></span></label>
          </div>}
          {warn.length > 0 && <p role="alert" className="pk-vwarn">ตรวจสอบค่าอีกครั้ง · {warn.join(" · ")}</p>}
        </section>

        <section className="pk-step">
          <h4>{step(2, txDone)}บันทึกการตรวจรักษา<small>กรอกอย่างน้อย 1 ช่อง</small></h4>
          {(t.last?.cc || t.last?.dx) && <p className="pk-carry">อาการสำคัญและวินิจฉัยดึงจากครั้งก่อนให้แล้ว · แก้ได้</p>}
          <label className="pk-full">อาการสำคัญ (Chief Complaint)<textarea rows={2} value={f.cc} onChange={(e) => set({ cc: e.target.value })} placeholder="เช่น ปวดเข่าขวาเวลาเดิน" /></label>
          <label className="pk-full">ตรวจร่างกาย<textarea rows={2} value={f.pe} onChange={(e) => set({ pe: e.target.value })} placeholder="เช่น ROM เข่าขวา 0–110° · กำลังกล้ามเนื้อ 4/5" /></label>
          <label className="pk-full">วินิจฉัย<input value={f.dx} onChange={(e) => set({ dx: e.target.value })} placeholder="เช่น Knee OA (R)" /></label>
          <label className="pk-full">แผนการรักษา<textarea rows={2} value={f.plan} onChange={(e) => set({ plan: e.target.value })} placeholder="เช่น ฝึกเดิน 30 เมตร · เพิ่มกำลังกล้ามเนื้อต้นขา" /></label>
        </section>

        <section className="pk-step">
          <h4>{step(3, !!(f.activities.length || f.pain || f.mobility))}ผลการทำกายภาพ<small>กดเลือก</small></h4>
          <div className="pk-chips">{ACTIVITIES.map((x) => (
            <button key={x} type="button" aria-pressed={f.activities.includes(x)} className={f.activities.includes(x) ? "is-on" : ""} onClick={() => set({ activities: f.activities.includes(x) ? f.activities.filter((y) => y !== x) : [...f.activities, x] })}>{x}</button>
          ))}</div>
          <p className="pk-sub">การเคลื่อนไหวตอนนี้</p>
          <div className="pk-chips">{MOBILITY.map((m) => (
            <button key={m} type="button" aria-pressed={f.mobility === m} className={f.mobility === m ? "is-on" : ""} onClick={() => set({ mobility: f.mobility === m ? "" : m })}>{m}</button>
          ))}</div>
          {ed && <label className="pk-num pk-mins"><span>ระยะเวลาที่ทำ</span><span className="pk-num-in"><input type="number" inputMode="numeric" min={1} max={300} value={f.minutes} onChange={(e) => set({ minutes: e.target.value })} aria-label="ระยะเวลาที่ทำ (นาที)" /><em>นาที</em></span></label>}
          <p className="pk-sub">ความปวด (0 = ไม่ปวด · 10 = ปวดมากที่สุด)</p>
          <div className="pk-pain">{Array.from({ length: 11 }, (_, i) => String(i)).map((v) => (
            <button key={v} type="button" aria-pressed={f.pain === v} className={f.pain === v ? "is-on" : ""} onClick={() => set({ pain: f.pain === v ? "" : v })}>{v}</button>
          ))}</div>
        </section>

        {needPhoto && <section className="pk-step">
          <h4>{step(4, f.photos.length > 0)}แนบรูปภาพ<small>{f.photos.length}/{MAX_PHOTOS} · อย่างน้อย 1 รูป</small></h4>
          {f.photos.length > 0 && <div className="pk-photos">{f.photos.map((ph, i) => (
            <span key={i}><img src={ph} alt={`รูปงาน ${i + 1}`} /><button type="button" aria-label={`ลบรูปที่ ${i + 1}`} onClick={() => set({ photos: f.photos.filter((_, k) => k !== i) })}>×</button></span>
          ))}</div>}
          {f.photos.length < MAX_PHOTOS && <>
            {testMode && <button type="button" className="pk-test" onClick={async () => set({ photos: [...f.photos, await stamp(testPhoto(`รูปงาน ${f.photos.length + 1}`))] })}>เพิ่มรูปทดสอบ · บัญชีทดลองเท่านั้น</button>}
            <PhotoPicker key={f.photos.length} value="" allowFile={false} label={f.photos.length ? "เพิ่มรูป" : "ถ่ายรูประหว่างทำกายภาพ"} hint="ระบบประทับชื่อและเวลาลงรูป"
              onChange={async (u) => { if (u) { const ph = await stamp(u); setF((x) => (x ? { ...x, photos: [...x.photos, ph].slice(0, MAX_PHOTOS) } : x)); } }} />
          </>}
        </section>}
      </div>
    </Modal>
  );
}
