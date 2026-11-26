"use client";
import { useEffect, useState } from "react";
import { Field, Modal } from "../ui";
import { useApp } from "@/lib/app";
import { DAY_TH, DEFAULT_HOURS, PhysioHours } from "@/lib/physio";

/**
 * เวลางานนักกายภาพรายคน (26 พ.ย. 2569) · เวลาเข้า–ออกงาน และวันที่เข้างาน (จ–อา)
 *  ยังไม่ตั้ง = 08:00–19:00 ทุกวัน · ตารางว่างนับชั่วโมงว่างจากเวลานี้ · วันที่ไม่เข้างาน = "ไม่เข้างาน"
 *  วางนัดนอกเวลางาน / วันที่ไม่เข้างาน ระบบเตือนก่อน (ยืนยันแล้วลงได้)
 */
export type HoursTarget = { tid: string; tname: string };
const TIMES = Array.from({ length: (22 - 5) * 2 + 1 }, (_, i) => { const m = 5 * 60 + i * 30; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; });
const hm = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const ORDER = [1, 2, 3, 4, 5, 6, 0];

export default function PhysioHoursDialog({ target, hours, onClose, onSaved }: {
  target: HoursTarget | null; hours: PhysioHours[]; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useApp();
  const [s, setS] = useState(hm(DEFAULT_HOURS.s));
  const [e, setE] = useState(hm(DEFAULT_HOURS.e));
  const [days, setDays] = useState<number[]>(ORDER);
  const [busy, setBusy] = useState(false);
  const cur = target ? hours.find((h) => h.therapist_id === target.tid) : undefined;
  useEffect(() => {
    if (!target) return;
    setS(hm(cur?.s ?? DEFAULT_HOURS.s)); setE(hm(cur?.e ?? DEFAULT_HOURS.e)); setDays(cur?.days?.length ? cur.days : ORDER);
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!target) return null;
  const problem = e <= s ? "เวลาออกงานต้องหลังเวลาเข้างาน" : !days.length ? "เลือกวันที่เข้างานอย่างน้อย 1 วัน" : "";
  const post = async (body: Record<string, unknown>, msg: string) => {
    setBusy(true);
    const r = await fetch("/api/clinic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "hours_set", therapistId: target.tid, ...body }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r?.ok) return toast(d.error || "บันทึกไม่สำเร็จ");
    toast(msg); onSaved(); onClose();
  };
  const sumH = (() => { const [a, b] = [s, e].map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))); return b > a ? `${Math.floor((b - a) / 60)} ชม.${(b - a) % 60 ? ` ${(b - a) % 60} นาที` : ""}` : "-"; })();
  return (
    <Modal open title={`เวลางาน · ${target.tname}`} onClose={onClose}
      footer={<>{problem && <span className="pb-miss">{problem}</span>}
        {cur && <button className="btn-soft sm:mr-auto" disabled={busy} onClick={() => post({ reset: true }, `${target.tname} กลับเป็น 08:00–19:00 ทุกวันแล้ว`)}>ใช้ค่าเริ่มต้น</button>}
        <button className="btn-soft" onClick={onClose}>ยกเลิก</button>
        <button className="btn-primary" disabled={!!problem || busy} onClick={() => post({ start: s, end: e, days }, `ตั้งเวลางาน ${target.tname} ${s}–${e} แล้ว`)}>{busy ? "กำลังบันทึก…" : "บันทึก"}</button></>}>
      <div className="pb-form">
        <div className="pb-row">
          <Field label="เข้างาน"><select value={s} onChange={(x) => setS(x.target.value)} aria-label="เวลาเข้างาน">{TIMES.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label={`ออกงาน · ${sumH}`}><select value={e} onChange={(x) => setE(x.target.value)} aria-label="เวลาออกงาน">{TIMES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        </div>
        <div className="pb-sec">
          <p className="pb-h">วันที่เข้างาน <small>แตะเพื่อเลือก / เอาออก</small></p>
          <div className="pbk-days">{ORDER.map((d) => { const on = days.includes(d); return <button key={d} type="button" aria-pressed={on} onClick={() => setDays(on ? days.filter((x) => x !== d) : [...days, d])}>{DAY_TH[d]}</button>; })}</div>
        </div>
        <p className="pb-hint">{cur ? "" : "ตอนนี้ใช้ค่าเริ่มต้น 08:00–19:00 ทุกวัน · "}ตารางว่างนับชั่วโมงว่างจากเวลานี้ · วันที่ไม่เข้างานขึ้นว่า "ไม่เข้างาน" · วางนัดนอกเวลางานระบบเตือนก่อน · ลาเฉพาะวันใช้ "ตั้งไม่ว่าง"</p>
      </div>
    </Modal>
  );
}
