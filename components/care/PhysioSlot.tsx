"use client";
import { useEffect, useState } from "react";
import { Modal } from "../ui";
import { useApp } from "@/lib/app";
import { clashes, dayLabel, dowOf, DAY_FULL, DAY_TH, PhysioCase, projectDates, Therapist, whoOn } from "@/lib/physio";

const TH_MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/**
 * นัดเดียว: ให้คนอื่นทำแทนเฉพาะวันนั้น (ลา / สลับเวร) · วันอื่นของคอร์สไม่เปลี่ยน
 *  เปิดจากการกดนัดที่ยังไม่ได้ทำในตารางสัปดาห์ · แก้วัน เวลา หรือทีมทั้งคอร์ส → ปุ่ม "แก้แผนทั้งคอร์ส"
 */
export default function PhysioSlot({ target, cases, therapists, today, doneToday = false, onClose, onSaved, onEditPlan }: {
  target: { c: PhysioCase; date: string } | null; cases: PhysioCase[]; therapists: Therapist[]; today: string; doneToday?: boolean;
  onClose: () => void; onSaved: () => void; onEditPlan: (c: PhysioCase) => void;
}) {
  const { toast } = useApp();
  const [pick, setPick] = useState("");
  /** หน้าต่างยืนยันยกเลิกนัด */
  const [ask, setAsk] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (target) { setPick(whoOn(target.c, target.date)?.id ?? ""); setAsk(false); } }, [target]);
  if (!target) return null;
  const { c, date } = target;
  const now = whoOn(c, date);
  /** คนประจำของวันนั้น (ไม่นับคนทำแทน) */
  const base = c.plan_slots?.dow?.[String(dowOf(date))] ?? (c.therapist_id ? { id: c.therapist_id, name: c.therapist_name ?? "-" } : null);
  const covered = !!c.plan_slots?.date?.[date];
  const others = cases.filter((x) => x.id !== c.id);
  const busyOf = (id: string) => (c.plan_time ? clashes(others, id, { dates: [date] }, c.plan_time, c.plan_minutes || 45) : []);
  // ทีมประจำเคสขึ้นก่อน (ส่งใครไปก็ได้) · แล้วคนอื่นในสาขา · สาขาอื่น
  const crewIds = new Set((c.plan_slots?.team ?? []).map((x) => x.id));
  const crew = therapists.filter((t) => crewIds.has(t.id));
  const local = therapists.filter((t) => !crewIds.has(t.id) && t.branch === c.branch_name), away = therapists.filter((t) => !crewIds.has(t.id) && t.branch !== c.branch_name);
  const save = async (tid: string) => {
    setBusy(true);
    const r = await fetch("/api/clinic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "slot_set", courseId: c.id, date, therapistId: tid }) }).catch(() => null);
    setBusy(false);
    const d = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) return toast(d.error || "บันทึกไม่สำเร็จ");
    const who = therapists.find((t) => t.id === tid)?.name ?? base?.name ?? "";
    toast(tid && tid !== base?.id ? `${who} ทำแทนนัด ${dayLabel(date)} แล้ว · แจ้งเตือนทั้งสองคนแล้ว` : `นัด ${dayLabel(date)} กลับเป็น ${base?.name ?? ""} แล้ว`);
    onSaved(); onClose();
  };
  /** ยกเลิกนัดนี้ (เลือกวันผิด / ผู้รับบริการไม่สะดวก) · ถามยืนยันในหน้าต่างของตัวเอง */
  const doCancel = async () => {
    setBusy(true);
    const r = await fetch("/api/clinic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "slot_cancel", courseId: c.id, date }) }).catch(() => null);
    setBusy(false);
    const d = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) return toast(d.error || "ยกเลิกนัดไม่สำเร็จ");
    toast(`ยกเลิกนัด ${dayLabel(date)} แล้ว · แจ้ง${now?.name ?? "นักกายภาพ"}แล้ว`); setAsk(false); onSaved(); onClose();
  };
  // ผลหลังยกเลิก: เลือกวันเอง = เหลือวันนัดกี่วัน · ทุกสัปดาห์ = ครั้งสุดท้ายเลื่อนไปวันไหน
  const explicitPlan = !!c.plan_dates?.length, left = c.total - c.used;
  const after = projectDates(explicitPlan ? { ...c, plan_dates: c.plan_dates!.filter((x) => x !== date) } : { ...c, plan_slots: { ...c.plan_slots, skip: [...(c.plan_slots?.skip ?? []), date] } }, today, doneToday);
  const unplanned = Math.max(0, left - after.length);
  const dd = `${DAY_FULL[dowOf(date)]}ที่ ${Number(date.slice(8, 10))} ${TH_MON[Number(date.slice(5, 7)) - 1]}`;
  return (<>
    <Modal open title={`นัดกายภาพ · ${c.resident_name}`} onClose={onClose}
      footer={<>
        <button type="button" className="btn-danger sm:mr-auto" disabled={busy} onClick={() => setAsk(true)}>ยกเลิกนัดนี้</button>
        <button type="button" className="btn-soft" onClick={() => { onClose(); onEditPlan(c); }}>แก้แผนทั้งคอร์ส</button>
        <button type="button" className="btn-soft" onClick={onClose}>ปิด</button>
        <button type="button" className="btn-primary" disabled={busy || !pick || pick === now?.id} onClick={() => save(pick === base?.id ? "" : pick)}>{busy ? "กำลังบันทึก…" : "บันทึก"}</button>
      </>}>
      <div className="space-y-3">
        <div className="pa-slothead">
          <b>{DAY_FULL[dowOf(date)]} {dayLabel(date).replace(/^\S+ /, "")} · {c.plan_time ?? "-"} น.</b>
          <span>{c.name}{/นาที/.test(c.name) ? "" : ` · ครั้งละ ${c.plan_minutes ?? 45} นาที`}</span>
          <span>คนทำนัดนี้: <b>{now?.name ?? "-"}</b>{covered ? ` (ทำแทน ${base?.name ?? ""})` : " (คนประจำ)"}</span>
        </div>
        {c.plan_slots?.req?.[date] && <p className="pk-vwarn"><b>{c.plan_slots.req[date].by.name} ขอคนแทน</b> · {c.plan_slots.req[date].reason} · ส่งเมื่อ {c.plan_slots.req[date].at} · เลือกคนทำแทนด้านล่าง หรือยกเลิกนัดนี้</p>}
        <ul className="pa-rule">
          <li>เปลี่ยนคนทำ หรือ <b>ยกเลิกนัดนี้</b> (เลือกวันผิด) ได้<b>เฉพาะนัดนี้</b> · นัดวันอื่นไม่เปลี่ยน</li>
          <li>เปลี่ยนเวลา นาทีต่อครั้ง หรือวันทั้งคอร์ส → ปุ่ม <b>แก้แผนทั้งคอร์ส</b></li>
          <li>คนทำแทนเห็นนัดนี้ในคิวกายภาพของ KinApp และได้แจ้งเตือนบนมือถือ</li>
          <li>ทำแล้วนับเป็นผลงานของคนทำแทน · ถ้าไม่ได้ทำ ติดตามการส่งงานจะขึ้นชื่อคนทำแทน</li>
        </ul>
        <section className="pa2-step"><h4><i>1</i>ส่งใครไปทำนัดนี้</h4>
          {[{ title: "ทีมประจำเคส", list: crew }, { title: crew.length ? `คนอื่นในสาขา${c.branch_name}` : `สาขา${c.branch_name}`, list: local }, { title: "สาขาอื่น · รับงานข้ามสาขา", list: away }].filter((g) => g.list.length).map((g) => (
            <div key={g.title} className="pa-group">
              <p className="pa-group-h">{g.title}</p>
              <div className="pa-team">{g.list.map((t) => {
                const b = t.id === now?.id ? [] : busyOf(t.id);
                return (
                  <label key={t.id} className={pick === t.id ? "is-on" : ""}>
                    <input type="radio" name="ps-t" checked={pick === t.id} onChange={() => setPick(t.id)} />
                    <b>{t.name}</b>
                    <small>{t.id === base?.id ? "คนประจำ" : ""}{t.id === now?.id && covered ? "ทำแทนอยู่" : ""}{b.length ? `${t.id === base?.id ? " · " : ""}ไม่ว่าง: ${b.map((x) => `${x.resident_name} ${x.plan_time}`).join(", ")}` : t.id === base?.id || t.id === now?.id ? "" : "ว่าง"}</small>
                  </label>
                );
              })}</div>
            </div>
          ))}
        </section>
      </div>
    </Modal>
    <Modal open={ask} title="ยกเลิกนัดกายภาพ" onClose={() => setAsk(false)}
      footer={<>
        <button type="button" className="btn-soft" disabled={busy} onClick={() => setAsk(false)}>เก็บนัดไว้</button>
        <button type="button" className="btn-cancelred" disabled={busy} onClick={doCancel}>{busy ? "กำลังยกเลิก…" : "ยืนยันยกเลิกนัด"}</button>
      </>}>
      <div className="pc-wrap">
        <div className="pc-ticket">
          <div className="pc-date"><small>{DAY_TH[dowOf(date)]}</small><b>{Number(date.slice(8, 10))}</b><span>{TH_MON[Number(date.slice(5, 7)) - 1]}</span></div>
          <div className="pc-info">
            <b>{c.resident_name}</b>
            <span>{c.plan_time ?? "-"} น. · {c.plan_minutes ?? 45} นาที</span>
            <span>นักกายภาพ: {now?.name ?? "-"}</span>
          </div>
          <em className="pc-tag">จะถูกยกเลิก</em>
        </div>
        <div>
          <p className="pc-h">หลังยกเลิก</p>
          <ul className="pc-after">
            <li>{explicitPlan ? <>นำ<b>{dd}</b> ออกจากตารางนัด</> : <>ข้ามเฉพาะ<b>{dd}</b> · ทุกวัน{DAY_FULL[dowOf(date)]}อื่นยังนัดตามเดิม</>}</li>
            <li>ไม่ตัดจำนวนครั้งของคอร์ส · ยังเหลือ <b>{left} ครั้ง</b> เท่าเดิม</li>
            {explicitPlan
              ? <li>เหลือวันนัด <b>{after.length} วัน</b>{unplanned > 0 ? <> · ยังไม่มีวันนัดอีก <b>{unplanned} ครั้ง</b> เพิ่มได้ที่ปุ่ม แก้แผนทั้งคอร์ส</> : null}</li>
              : after.length > 0 ? <li>นัดครั้งสุดท้ายของคอร์สเลื่อนไปเป็น <b>{dayLabel(after[after.length - 1].date)}</b></li> : null}
            <li>{now?.name ?? "นักกายภาพ"} ได้แจ้งเตือนบนมือถือ</li>
          </ul>
        </div>
      </div>
    </Modal>
    </>
  );
}
