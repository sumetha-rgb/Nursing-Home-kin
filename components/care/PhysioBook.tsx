"use client";
import { useEffect, useMemo, useState } from "react";
import { Field, Modal } from "../ui";
import { useApp } from "@/lib/app";
import { blockHit, blockText, dayLabel, hoursOn, leftOf, onDate, PhysioBlock, PhysioCase, PhysioHours, schedOf, teamOf, Therapist, timeOn, whoOn } from "@/lib/physio";

/**
 * วางนัด / ย้ายนัดกายภาพ (ปฏิทินกายภาพ · 26 พ.ย. 2569)
 *  เพิ่ม: กดช่องว่างวัน+เวลาในปฏิทิน → แตะนักกายภาพ (บอกว่าง/ไม่ว่างตอนนั้น) → เลือกผู้รับบริการ → นัดครั้งเดียว (POST slot_add)
 *  ย้าย: กดนัดแล้ว "ย้ายวัน / เวลา" หรือกดค้างลากนัดไปช่องใหม่ → เปลี่ยนวัน เวลา คนทำ เฉพาะนัดนั้น (POST slot_move)
 *  วันอื่นของคอร์สไม่เปลี่ยน · ติดตามการส่งงาน KinApp แจ้งเตือน และสถานะ ใช้วันเวลาใหม่
 */
export type BookTarget =
  | { mode: "add"; date: string; time: string; /** เลือกไว้แล้ว (จากตารางว่าง) */ cid?: string; tid?: string }
  | { mode: "move"; c: PhysioCase; from: string; date: string; time: string };

const TIMES = Array.from({ length: (21 - 6) * 4 + 1 }, (_, i) => { const m = 6 * 60 + i * 15; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; });
const toMin = (t: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(t ?? ""); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
const hm = (n: number) => `${String(Math.floor(n / 60) % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;

export default function PhysioBook({ target, cases, therapists, today, blocks = [], hours = [], onClose, onSaved }: {
  target: BookTarget | null; cases: PhysioCase[]; therapists: Therapist[]; today: string; /** ช่วงไม่ว่าง (ลา ป่วย ประชุม) */ blocks?: PhysioBlock[]; /** เวลางานรายคน */ hours?: PhysioHours[]; onClose: () => void; onSaved: () => void;
}) {
  const { toast, confirm } = useApp();
  const [cid, setCid] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [tid, setTid] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!target) return;
    setDate(target.date); setTime(target.time);
    if (target.mode === "move") { setCid(target.c.id); setTid(whoOn(target.c, target.from)?.id ?? ""); }
    else { setCid(target.cid ?? ""); setTid(target.tid ?? ""); }
  }, [target]);
  const c = useMemo(() => (target?.mode === "move" ? target.c : cases.find((x) => x.id === cid) ?? null), [target, cases, cid]);
  if (!target) return null;
  const isMove = target.mode === "move";
  const minutes = c?.plan_minutes || 45;
  /** นัดของนักกายภาพคนนี้ที่ทับช่วงเวลาที่เลือก (ตามวันเวลาจริงของแต่ละนัด รวมนัดที่ย้ายแล้ว) */
  const busyOf = (id: string) => {
    const a = toMin(time); if (!date || Number.isNaN(a)) return [];
    return cases.filter((k) => k.id !== c?.id && onDate(schedOf(k), date) && whoOn(k, date)?.id === id).filter((k) => {
      const s = toMin(timeOn(k, date)); return !Number.isNaN(s) && s < a + minutes && a < s + (k.plan_minutes || 45);
    });
  };
  // นักกายภาพ: ทีมของเคสก่อน · สาขาเดียวกัน · ที่ว่างก่อนไม่ว่าง
  const crew = c ? teamOf(c).map((t) => t.id) : [];
  const branch = c?.branch_name ?? therapists[0]?.branch;
  const a0 = toMin(time);
  /** นอกเวลางาน / ไม่เข้างานวันนั้น (ข้อความ) */
  const outOf = (tid: string) => { if (!date) return ""; const h = hoursOn(hours, tid, date); if (!h) return "ไม่เข้างานวันนี้"; if (Number.isNaN(a0)) return ""; const f = (n: number) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`; return a0 < h.s || a0 + minutes > h.e ? `นอกเวลางาน (${f(h.s)}–${f(h.e)})` : ""; };
  const list = [...therapists].map((t) => ({ t, b: busyOf(t.id), o: outOf(t.id), k: date ? blockHit(blocks, t.id, date, Number.isNaN(a0) ? undefined : a0, Number.isNaN(a0) ? undefined : a0 + minutes) : [] }))
    .sort((x, y) => Number(!crew.includes(x.t.id)) - Number(!crew.includes(y.t.id)) || Number(x.t.branch !== branch) - Number(y.t.branch !== branch) || (x.b.length + x.k.length + Number(!!x.o)) - (y.b.length + y.k.length + Number(!!y.o)) || x.t.name.localeCompare(y.t.name, "th"));
  // ผู้รับบริการ: เคสของนักกายภาพที่เลือกก่อน · ยังไม่มีผู้รับผิดชอบ · ที่เหลือ
  const open = cases.filter((x) => leftOf(x) > 0).map((x) => ({ x, mine: !!tid && teamOf(x).some((t) => t.id === tid), free: !x.therapist_id }))
    .sort((p, q) => Number(q.mine) - Number(p.mine) || Number(q.free) - Number(p.free) || p.x.resident_name.localeCompare(q.x.resident_name, "th"));
  const problem = !date || date < today ? "เลือกวันนี้หรือวันข้างหน้า" : !time ? "เลือกเวลา" : !tid ? "แตะเลือกนักกายภาพ" : !c ? "เลือกผู้รับบริการ" : "";
  const same = isMove && date === target.from && time === timeOn(target.c, target.from) && tid === (whoOn(target.c, target.from)?.id ?? "");
  const save = async () => {
    if (problem || busy || !c) return;
    setBusy(true);
    const body = isMove ? { op: "slot_move", courseId: c.id, from: target.from, to: date, time, therapistId: tid } : { op: "slot_add", courseId: c.id, date, time, therapistId: tid };
    const r = await fetch("/api/clinic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    // นักกายภาพไม่ว่าง (ลา · นอกเวลางาน · มีนัดอื่นทับ) = ลงไม่ได้ ไม่มีปุ่มลงทับ
    if (!r?.ok) return toast(d.error || "บันทึกไม่สำเร็จ");
    const who = therapists.find((t) => t.id === tid)?.name ?? "";
    toast(`${isMove ? "ย้ายนัด" : "วางนัด"} ${c.resident_name} ${dayLabel(date)} ${time} น. แล้ว · แจ้ง ${who} ใน KinApp`);
    onSaved(); onClose();
  };
  const timeOpts = TIMES.includes(time) || !time ? TIMES : [...TIMES, time].sort();
  const end = Number.isNaN(toMin(time)) ? "" : hm(toMin(time) + minutes);
  return (
    <Modal open title={isMove ? `ย้ายนัด · ${target.c.resident_name}` : "วางนัดกายภาพ"} onClose={onClose}
      footer={<>{problem && <span className="pb-miss">{problem}</span>}<button className="btn-soft" onClick={onClose}>ยกเลิก</button>
        <button className="btn-primary" disabled={!!problem || busy || same} onClick={() => save()}>{busy ? "กำลังบันทึก…" : isMove ? "ย้ายนัด" : "วางนัด"}</button></>}>
      <div className="pb-form">
        {isMove && <p className="pb-from">จาก <b>{dayLabel(target.from)} {timeOn(target.c, target.from)} น.</b> · {whoOn(target.c, target.from)?.name ?? "-"}{target.from < today ? " · ไม่ได้ทำ (ย้ายเป็นนัดชดเชย)" : ""}</p>}
        <div className="pb-row">
          <Field label="วันที่" required><input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} aria-label="วันที่นัด" /></Field>
          <Field label={`เวลา${end ? ` · ถึง ${end} น.` : ""}`} required><select value={time} onChange={(e) => setTime(e.target.value)} aria-label="เวลานัด"><option value="">— เวลา —</option>{timeOpts.map((t) => <option key={t} value={t}>{t}</option>)}</select></Field>
        </div>
        <div className="pb-sec">
          <p className="pb-h">นักกายภาพ <small>แตะเลือก · บอกว่าว่างไหมช่วง {time || "-"}{end ? `–${end}` : ""}</small></p>
          <div className="pb-tiles" role="radiogroup" aria-label="นักกายภาพ">
            {list.map(({ t, b, k: kb, o }) => (
              <button key={t.id} type="button" role="radio" aria-checked={tid === t.id} className={`pb-tile ${b.length || kb.length || o ? "is-busy" : "is-free"}`} onClick={() => setTid(t.id)}>
                <b>{t.name}</b>
                <small>{o ? `ไม่ว่าง · ${o}` : kb.length ? `ไม่ว่าง · ${kb.map(blockText).join(", ")}` : b.length ? `ไม่ว่าง · ${b.map((k) => `${k.resident_name.replace(/^(คุณ|นาย|นางสาว|นาง)\s*/, "")} ${timeOn(k, date)}`).join(", ")}` : "ว่าง"}</small>
                {crew.includes(t.id) && <em>ทีมของเคส</em>}{t.branch !== branch && <em>{t.branch}</em>}
              </button>
            ))}
            {!list.length && <p className="pb-hint">ยังไม่มีบัญชีนักกายภาพ</p>}
          </div>
        </div>
        {!isMove && <Field label="ผู้รับบริการ / คอร์ส" required>
          <select value={cid} onChange={(e) => setCid(e.target.value)} aria-label="เลือกคอร์ส">
            <option value="">— เลือก —</option>
            {open.map(({ x, mine, free }) => <option key={x.id} value={x.id}>{mine ? "● " : ""}{x.resident_name} · {x.name} · เหลือ {leftOf(x)}/{x.total}{free ? " · ยังไม่มีผู้รับผิดชอบ" : ""}</option>)}
          </select>
        </Field>}
        {!isMove && tid && <p className="pb-hint">● = เคสของนักกายภาพที่เลือก{c && !c.therapist_id ? " · คนที่เลือกจะเป็นผู้รับผิดชอบเคสนี้" : ""}</p>}
        <p className="pb-hint">{isMove ? "ย้ายเฉพาะนัดนี้ · นัดวันอื่นของคอร์สเหมือนเดิม" : "นัดครั้งเดียว · นัดตามแผนเดิมของคอร์สเหมือนเดิม"} · ติดตามการส่งงานและ KinApp ใช้วันเวลาใหม่ · แจ้งนักกายภาพให้เอง</p>
      </div>
    </Modal>
  );
}
