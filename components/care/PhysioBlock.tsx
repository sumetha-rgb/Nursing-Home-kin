"use client";
import { useEffect, useState } from "react";
import { Field, Modal } from "../ui";
import { useApp } from "@/lib/app";
import { addDays, blockText, dayLabel, DAY_TH, dowOf, PhysioBlock } from "@/lib/physio";

/**
 * ตั้งนักกายภาพไม่ว่าง (26 พ.ย. 2569) · ลา ลาป่วย ประชุม/อบรม ไปสาขาอื่น · ทั้งวัน หรือช่วงเวลา
 *  ไม่ว่าง = ตารางว่างไม่ขึ้นชื่อคนนี้ · หน้าต่างวางนัดขึ้นว่า ไม่ว่าง · วางนัดทับระบบเตือนก่อน
 *  เปิดจากตารางว่าง (กดช่อง → ตั้งไม่ว่าง) · ลบช่วงไม่ว่างของวันนั้นได้ในหน้าต่างเดียวกัน
 *  ตั้งล่วงหน้าเป็นช่วง: ถึงวันที่ (ถึงสิ้นสัปดาห์ / สิ้นเดือน / ทั้งเดือนหน้า) · เลือกเฉพาะบางวันในสัปดาห์ได้ (เช่น ทุกวันเสาร์ของเดือน)
 */
export type BlockTarget = { tid: string; tname: string; date: string };
const REASONS = ["ลา", "ลาป่วย", "ประชุม / อบรม", "ไปสาขาอื่น", "อื่น ๆ"];
const TIMES = Array.from({ length: (21 - 6) * 2 + 1 }, (_, i) => { const m = 6 * 60 + i * 30; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; });

export default function PhysioBlockDialog({ target, blocks, today, onClose, onSaved }: {
  target: BlockTarget | null; blocks: PhysioBlock[]; today: string; onClose: () => void; onSaved: () => void;
}) {
  const { toast, confirm } = useApp();
  const [date, setDate] = useState("");
  const [whole, setWhole] = useState(true);
  const [s, setS] = useState("13:00");
  const [e, setE] = useState("15:00");
  const [why, setWhy] = useState("ลา");
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  /** ถึงวันที่ (ว่าง = วันเดียว) · เฉพาะวันในสัปดาห์ (ว่าง = ทุกวัน) */
  const [to, setTo] = useState("");
  const [dows, setDows] = useState<number[]>([]);
  useEffect(() => { if (target) { setDate(target.date); setTo(""); setDows([]); setWhole(true); setS("13:00"); setE("15:00"); setWhy("ลา"); setOther(""); } }, [target]);
  if (!target) return null;
  const mine = blocks.filter((b) => b.therapist_id === target.tid && b.date === date);
  const reason = why === "อื่น ๆ" ? other.trim() : why;
  // วันที่จะตั้ง (ช่วง + เฉพาะวันในสัปดาห์)
  const span: string[] = [];
  if (date) for (let x = date; x <= (to && to > date ? to : date) && span.length < 400; x = addDays(x, 1)) if (!dows.length || dows.includes(dowOf(x))) span.push(x);
  const monthEnd = (d: string) => { const [y, m] = d.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };
  const nextMonth = (d: string) => { const [y, m] = d.split("-").map(Number); const f = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10); return [f, monthEnd(f)] as const; };
  const problem = !date ? "เลือกวันที่" : to && to < date ? "วันสิ้นสุดต้องไม่ก่อนวันเริ่ม" : !span.length ? "ไม่มีวันที่ตรงกับวันที่เลือก" : !whole && e <= s ? "เวลาสิ้นสุดต้องหลังเวลาเริ่ม" : !reason ? "พิมพ์เหตุผล" : "";
  const post = async (body: Record<string, unknown>) => {
    setBusy(true);
    const r = await fetch("/api/clinic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (r?.status === 409 && Array.isArray(d.booked)) return "booked:" + d.error;
    if (!r?.ok) { toast(d.error || "บันทึกไม่สำเร็จ"); return false; }
    return true;
  };
  const save = async () => {
    if (problem || busy) return;
    const body = { op: "block_add", therapistId: target.tid, date, ...(to && to > date ? { to } : {}), ...(dows.length ? { days: dows } : {}), reason, ...(whole ? {} : { start: s, end: e }) };
    const ok = await post(body);
    // มีนัดอยู่แล้วในช่วงนั้น: ถามก่อน · ตั้งต่อได้ แต่นัดเดิมไม่หาย (ปฏิทินขึ้นแดง "ชนวันลา" ให้ย้าย)
    if (typeof ok === "string") return confirm({ title: "มีนัดอยู่แล้วในช่วงนี้", message: `${ok.slice(7)}\n\nตั้งไม่ว่างต่อหรือไม่? นัดเดิมยังอยู่ ในตารางงานจะขึ้นสีแดงว่า "ชนวันลา" ให้ย้ายหรือหาคนทำแทน`, okLabel: "ตั้งไม่ว่างต่อ",
      onOk: async () => { if ((await post({ ...body, force: true })) === true) { toast(`ตั้ง ${target.tname} ไม่ว่างแล้ว · อย่าลืมย้ายนัดที่ชน`); onSaved(); onClose(); } } });
    if (ok) {
      toast(`ตั้ง ${target.tname} ไม่ว่าง ${span.length > 1 ? `${dayLabel(span[0])} – ${dayLabel(span[span.length - 1])} (${span.length} วัน)` : dayLabel(date)} ${whole ? "ทั้งวัน" : `${s}–${e}`} (${reason}) แล้ว`);
      onSaved(); onClose();
    }
  };
  const del = (b: PhysioBlock) => confirm({ title: "ยกเลิกไม่ว่าง", message: `${target.tname} · ${dayLabel(b.date)} · ${blockText(b)} · กลับมาว่างช่วงนี้`, okLabel: "ยกเลิกไม่ว่าง",
    onOk: async () => { if ((await post({ op: "block_del", id: b.id })) === true) { toast("ยกเลิกแล้ว · กลับมาว่าง"); onSaved(); } } });
  return (
    <Modal open title={`ตั้งไม่ว่าง · ${target.tname}`} onClose={onClose}
      footer={<>{problem && <span className="pb-miss">{problem}</span>}<button className="btn-soft" onClick={onClose}>ปิด</button><button className="btn-primary" disabled={!!problem || busy} onClick={save}>{busy ? "กำลังบันทึก…" : "ตั้งไม่ว่าง"}</button></>}>
      <div className="pb-form">
        <div className="pb-row">
          <Field label="ตั้งแต่วันที่" required><input type="date" value={date} min={today} onChange={(x) => setDate(x.target.value)} aria-label="วันที่เริ่มไม่ว่าง" /></Field>
          <Field label={`ถึงวันที่ · ${span.length > 1 ? `รวม ${span.length} วัน` : "วันเดียว"}`}><input type="date" value={to} min={date} onChange={(x) => setTo(x.target.value)} aria-label="ถึงวันที่" /></Field>
        </div>
        <div className="pbk-quick">
          <span>ตั้งเร็ว:</span>
          <button type="button" aria-pressed={!to || to === date} onClick={() => setTo("")}>วันเดียว</button>
          <button type="button" onClick={() => setTo(addDays(date, (7 - dowOf(date)) % 7))}>ถึงสิ้นสัปดาห์</button>
          <button type="button" aria-pressed={!!to && to === monthEnd(date)} onClick={() => setTo(monthEnd(date))}>ถึงสิ้นเดือน</button>
          <button type="button" onClick={() => { const [f, l] = nextMonth(date); setDate(f); setTo(l); }}>ทั้งเดือนหน้า</button>
        </div>
        {to && to > date && <div className="pb-sec">
          <p className="pb-h">เฉพาะบางวัน <small>ไม่เลือก = ทุกวันในช่วง · เช่น ทุกวันเสาร์ของเดือน</small></p>
          <div className="pbk-days">{[1, 2, 3, 4, 5, 6, 0].map((d) => { const on = dows.includes(d); return <button key={d} type="button" aria-pressed={on} onClick={() => setDows(on ? dows.filter((x) => x !== d) : [...dows, d])}>{DAY_TH[d]}</button>; })}</div>
        </div>}
        <div className="pb-row">
          <Field label="ช่วงเวลา">
            <span className="pbk-seg" role="group" aria-label="ช่วงเวลา">
              <button type="button" aria-pressed={whole} onClick={() => setWhole(true)}>ทั้งวัน</button>
              <button type="button" aria-pressed={!whole} onClick={() => setWhole(false)}>บางช่วง</button>
            </span>
          </Field>
        </div>
        {!whole && <div className="pb-row">
          <Field label="ตั้งแต่"><select value={s} onChange={(x) => setS(x.target.value)} aria-label="เวลาเริ่ม">{TIMES.map((t) => <option key={t}>{t}</option>)}</select></Field>
          <Field label="ถึง"><select value={e} onChange={(x) => setE(x.target.value)} aria-label="เวลาสิ้นสุด">{TIMES.map((t) => <option key={t}>{t}</option>)}</select></Field>
        </div>}
        <div className="pb-sec">
          <p className="pb-h">เหตุผล</p>
          <div className="pbk-chips">{REASONS.map((r) => <button key={r} type="button" aria-pressed={why === r} onClick={() => setWhy(r)}>{r}</button>)}</div>
          {why === "อื่น ๆ" && <input value={other} onChange={(x) => setOther(x.target.value)} maxLength={60} placeholder="พิมพ์เหตุผล เช่น พาผู้ป่วยไปโรงพยาบาล" aria-label="เหตุผลอื่น" />}
        </div>
        {mine.length > 0 && <div className="pb-sec">
          <p className="pb-h">ไม่ว่างวันนี้อยู่แล้ว</p>
          <ul className="pbk-list">{mine.map((b) => <li key={b.id}><span>{blockText(b)}{b.by ? <small> · ตั้งโดย {b.by}</small> : null}</span><button type="button" className="row-action danger" onClick={() => del(b)}>ยกเลิก</button></li>)}</ul>
        </div>}
        <p className="pb-hint">{span.length > 1 ? `จะตั้ง ${span.length} วัน: ${dayLabel(span[0])} – ${dayLabel(span[span.length - 1])} · ` : ""}ตั้งแล้ว ตารางว่างไม่ขึ้นชื่อคนนี้ช่วงนั้น · หน้าต่างวางนัดขึ้นว่า ไม่ว่าง · ถ้าวางนัดทับ ระบบเตือนก่อน</p>
      </div>
    </Modal>
  );
}
