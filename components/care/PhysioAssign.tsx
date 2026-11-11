"use client";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "../ui";
import { useApp } from "@/lib/app";
import { addMonth, clashes, DAY_FULL, DAY_TH, dayLabel, dowOf, leftOf, loadOf, monthCells, monthLabel, PhysioCase, projectDates, Sched, Therapist, TIME_SLOTS, WEEK } from "@/lib/physio";

const MINUTES = [30, 45, 60, 90];
/** ปุ่มลัดเลือกวัน */
const PRESETS: { label: string; days: number[] }[] = [
  { label: "จ. พ. ศ.", days: [1, 3, 5] },
  { label: "อ. พฤ.", days: [2, 4] },
  { label: "จ.–ศ.", days: [1, 2, 3, 4, 5] },
  { label: "ทุกวัน", days: [0, 1, 2, 3, 4, 5, 6] },
];
const same = (a: number[], b: number[]) => a.length === b.length && a.every((x) => b.includes(x));

/**
 * จ่ายเคสกายภาพ: 1 เลือกนักกายภาพ (เห็นภาระงาน) · 2 วัน (ปุ่มลัด) · 3 เวลา (ปุ่มเวลา ช่วงที่ไม่ว่างมีป้ายบอก) · 4 ครั้งละกี่นาที
 *  ด้านขวา = ปฏิทินทั้งเดือน บอกวันที่ทำครั้งที่ 1…N จนครบคอร์ส · กดวันที่ = เพิ่ม/ยกเลิกนัดทีละวัน (เปลี่ยนเป็น "เลือกวันเอง")
 *  cases = เคสทั้งหมดในสาขา (คิดภาระงานและเวลาชน) · today = วันนี้ (YYYY-MM-DD) · doneToday = บันทึกเคสนี้แล้ววันนี้
 */
export default function PhysioAssign({ c, cases, therapists, today, doneToday, onClose, onSaved }: {
  c: PhysioCase | null; cases: PhysioCase[]; therapists: Therapist[]; today: string; doneToday?: boolean; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useApp();
  const [tid, setTid] = useState("");
  const [days, setDays] = useState<number[]>([]);
  /** เลือกวันเอง (YYYY-MM-DD) · มีค่า = ใช้แทนวันในสัปดาห์ */
  const [dates, setDates] = useState<string[]>([]);
  const [time, setTime] = useState("");
  const [minutes, setMinutes] = useState(45);
  const [ym, setYm] = useState(today.slice(0, 7));
  const [busy, setBusy] = useState(false);
  /** คนทำประจำวัน: "0"–"6" → รหัสนักกายภาพ (ไม่มี = ผู้รับผิดชอบหลัก) */
  const [dowT, setDowT] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!c) return;
    const team = therapists.filter((t) => t.branch === c.branch_name); // ค่าเริ่มต้น: สาขานี้มีคนเดียว = เลือกให้
    // เคสใหม่ที่สาขามีนักกายภาพคนเดียว = เลือกให้เลย
    setTid(c.therapist_id ?? (team.length === 1 ? team[0].id : "")); setDays(c.plan_days ?? []); setDates(c.plan_dates ?? []); setTime(c.plan_time ?? "");
    setMinutes(c.plan_minutes ?? (Number(c.name.match(/(\d+)\s*นาที/)?.[1]) || 45)); setYm(today.slice(0, 7));
    setDowT(Object.fromEntries(Object.entries(c.plan_slots?.dow ?? {}).map(([k, v]) => [k, v.id])));
  }, [c]); // eslint-disable-line react-hooks/exhaustive-deps
  const plan = useMemo(() => (c ? projectDates({ used: c.used, total: c.total, plan_days: dates.length ? null : days, plan_dates: dates, plan_slots: dates.length ? null : c.plan_slots }, today, !!doneToday) : []), [c, days, dates, today, doneToday]);
  if (!c) return null;
  // สาขานี้ก่อน แล้วสาขาอื่น (รับงานข้ามสาขาได้ เฉพาะเคสที่ถูกจ่ายให้)
  const local = therapists.filter((t) => t.branch === c.branch_name), away = therapists.filter((t) => t.branch !== c.branch_name);
  const team = [...local, ...away];
  const others = cases.filter((x) => x.id !== c.id);
  const sched: Sched = dates.length ? { dates } : { days };
  /** วันในสัปดาห์ที่มีนัด (เรียงจันทร์ก่อน) · คนทำของแต่ละวัน (ไม่ได้แบ่ง = ผู้รับผิดชอบหลัก) */
  const planDow = WEEK.filter((x) => (dates.length ? dates.some((d) => dowOf(d) === x) : days.includes(x)));
  const doerOf = (x: number) => (dowT[String(x)] && dowT[String(x)] !== tid ? dowT[String(x)] : tid);
  /** ส่วนของแผนที่คน id ทำ (หาเวลาชนเฉพาะวันของคนนั้น) */
  const part = (id: string): Sched => (dates.length ? { dates: dates.filter((d) => doerOf(dowOf(d)) === id) } : { days: days.filter((x) => doerOf(x) === id) });
  const busyAt = (t: string) => clashes(others, tid, part(tid), t, minutes);
  const split = planDow.filter((x) => doerOf(x) !== tid);
  const clash = busyAt(time);
  // วันในสัปดาห์ / ปุ่มลัด = กลับเป็นแผนทุกสัปดาห์
  const toggle = (d: number) => { setDates([]); setDays(days.includes(d) && !dates.length ? days.filter((x) => x !== d) : dates.length ? [d] : [...days, d]); };
  const preset = (p: number[]) => { setDates([]); setDays(p); };
  /** กดวันในปฏิทิน: เพิ่ม/ยกเลิกนัดวันนั้น · ถ้าเป็นแผนทุกสัปดาห์อยู่ เอาวันนัดที่วางไว้มาเป็นชุดเริ่มต้นก่อน */
  const pickDate = (d: string) => {
    if (d < today || !tid) return;
    const cur = dates.length ? dates : plan.map((p) => p.date);
    if (cur.includes(d)) { setDates(cur.filter((x) => x !== d)); setDays([]); return; }
    if (cur.length >= leftOf(c)) return toast(`นัดครบ ${leftOf(c)} ครั้งที่เหลือแล้ว · กดวันที่มีนัดเพื่อยกเลิกก่อน`);
    setDates([...cur, d].sort()); setDays([]);
  };
  const need = tid ? [!days.length && !dates.length && "วัน", !time && "เวลา"].filter(Boolean) as string[] : [];
  const onDay = new Map(plan.map((p) => [p.date, p.n]));
  const save = async () => {
    if (need.length) return toast(`กรุณาเลือก${need.join("และ")}`);
    setBusy(true);
    const r = await fetch("/api/clinic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "course_plan", courseId: c.id, therapistId: tid, days: dates.length ? [] : days, dates, time, minutes, slots: { dow: Object.fromEntries(planDow.filter((x) => doerOf(x) !== tid).map((x) => [String(x), doerOf(x)])) } }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast(d.error || "บันทึกไม่สำเร็จ");
    toast(tid ? `จ่ายเคส${c.resident_name}ให้ ${[tid, ...new Set(split.map(doerOf))].map((id) => team.find((t) => t.id === id)?.name ?? "").join(", ")} แล้ว` : `${c.resident_name} กลับเป็นยังไม่มีผู้รับผิดชอบ`);
    onSaved(); onClose();
  };
  return (
    <Modal open wide title={`จ่ายเคสกายภาพ · ${c.resident_name}`} onClose={onClose}
      footer={<>
        {c.therapist_id && <button className="btn-soft pa-unassign" disabled={busy} onClick={() => { setTid(""); setDays([]); setDates([]); setTime(""); }}>ไม่ระบุผู้รับผิดชอบ</button>}
        {need.length > 0 && <span className="pa-need">ยังไม่ได้เลือก{need.join(" · ")}</span>}
        <button className="btn-soft" onClick={onClose}>ยกเลิก</button>
        <button className="btn-primary" disabled={busy || need.length > 0} onClick={save}>{busy ? "กำลังบันทึก…" : "บันทึก"}</button>
      </>}>
      <div className="pa2">
        <div className="pa2-form">
          <p className="pa-case">{c.name} · ใช้ไป {c.used}/{c.total} · <b>เหลือ {leftOf(c)} ครั้ง</b>{c.room ? ` · ห้อง ${c.room}${c.bed ? ` เตียง ${c.bed}` : ""}` : ""}</p>

          <section className="pa2-step">
            <h4><i>1</i>นักกายภาพผู้รับผิดชอบ</h4>
            {team.length === 0 ? <p className="pa-empty">ยังไม่มีบัญชีนักกายภาพ · สร้างบัญชีตำแหน่ง "นักกายภาพบำบัด" ที่เมนูทีมและสิทธิ์การใช้งาน</p> : <>
              {[{ title: `สาขา${c.branch_name}`, list: local }, { title: "สาขาอื่น · รับงานข้ามสาขา (เห็นเฉพาะเคสนี้)", list: away }].filter((g) => g.list.length).map((g) => (
                <div key={g.title} className="pa-group">
                  <p className="pa-group-h">{g.title}</p>
                  <div className="pa-team">{g.list.map((t) => {
                    const l = loadOf(others, t.id), all = t.cases_all ?? l.cases, mineHere = t.id === c.therapist_id ? 1 : 0;
                    return (
                      <label key={t.id} className={tid === t.id ? "is-on" : ""}>
                        <input type="radio" name="pa-t" checked={tid === t.id} onChange={() => setTid(t.id)} />
                        <b>{t.name}</b>
                        <small>{t.branch !== c.branch_name ? `📍 ${t.branch} · ` : ""}{all - mineHere > 0 ? `มีเคส ${all - mineHere} เคส${l.hours ? ` · ที่นี่ ${l.hours} ชม./สัปดาห์` : ""}` : "ยังไม่มีเคส"}</small>
                      </label>
                    );
                  })}</div>
                </div>
              ))}
              {c.therapist_id && tid && tid !== c.therapist_id && <p className="pa-movenote">เปลี่ยนผู้รับผิดชอบ: ย้ายเฉพาะ {c.total - c.used} ครั้งที่ยังไม่ได้ทำ{c.used ? ` · ${c.used} ครั้งที่ทำแล้วไม่ย้าย ยังเป็นผลงานของคนที่ทำ` : ""} · ประวัติการบันทึกยังอยู่กับเคส คนใหม่เปิดดูได้</p>}
            </>}
          </section>

          {tid && <>
            <section className={`pa2-step ${!days.length && !dates.length ? "is-need" : ""}`}>
              <h4><i>2</i>ทำวันไหน<small>ทุกสัปดาห์ หรือกดเลือกทีละวันในปฏิทิน</small></h4>
              {dates.length > 0 && <p className="pa-mode">เลือกวันเอง <b>{dates.length} วัน</b> จากปฏิทิน<button type="button" onClick={() => setDates([])}>กลับเป็นทุกสัปดาห์</button></p>}
              <div className="pa-days pa-presets">{PRESETS.map((p) => { const on = !dates.length && same(days, p.days); return <button key={p.label} type="button" aria-pressed={on} className={on ? "is-on" : ""} onClick={() => preset(p.days)}>{p.label}</button>; })}</div>
              <div className="pa-days">{WEEK.map((d) => { const on = !dates.length && days.includes(d); return (
                <button key={d} type="button" aria-pressed={on} aria-label={DAY_FULL[d]} className={on ? "is-on" : ""} onClick={() => toggle(d)}>{DAY_TH[d]}</button>
              ); })}</div>
            </section>

            <section className={`pa2-step ${!time ? "is-need" : ""}`}>
              <h4><i>3</i>เวลาเริ่ม</h4>
              <div className="pa-slots">{TIME_SLOTS.map((t) => {
                const b = days.length ? busyAt(t) : [];
                return (
                  <button key={t} type="button" aria-pressed={time === t} className={`${time === t ? "is-on" : ""} ${b.length ? "is-busy" : ""}`} title={b.length ? `ไม่ว่าง: ${b.map((x) => `${x.resident_name} ${x.plan_time}`).join(", ")}` : undefined} onClick={() => setTime(t)}>
                    {t}{b.length > 0 && <small>มีเคส</small>}
                  </button>
                );
              })}
                <label className={`pa-other ${time && !TIME_SLOTS.includes(time) ? "is-on" : ""}`}>เวลาอื่น<input type="time" step={900} value={TIME_SLOTS.includes(time) ? "" : time} onChange={(e) => setTime(e.target.value)} /></label>
              </div>
              {clash.length > 0 && <p role="alert" className="pa-warn">ชนกับเคส {clash.map((x) => `${x.resident_name} ${x.plan_time}`).join(", ")} · บันทึกได้ แต่ควรเลือกเวลาอื่น</p>}
            </section>

            <section className="pa2-step">
              <h4><i>4</i>ครั้งละ</h4>
              <div className="pa-days">{MINUTES.map((m) => <button key={m} type="button" aria-pressed={minutes === m} className={minutes === m ? "is-on" : ""} onClick={() => setMinutes(m)}>{m} นาที</button>)}</div>
            </section>

            {planDow.length > 0 && team.length > 1 && <section className="pa2-step">
              <h4><i>5</i>แบ่งให้คนอื่นบางวัน<small>ไม่บังคับ · ผู้รับบริการ 1 คน มีนักกายภาพหลายคนได้</small></h4>
              <p className="pa-hint">ทุก{planDow.length > 1 ? "วันที่มีนัด" : "นัด"}เป็นของ <b>{team.find((t) => t.id === tid)?.name ?? "-"}</b> ถ้าไม่เลือก · คนลาเฉพาะวัน ให้กดนัดวันนั้นในตารางสัปดาห์แทน</p>
              <div className="pa-dowteam">{planDow.map((x) => {
                const id = doerOf(x), b = time && id ? clashes(others, id, dates.length ? { dates: dates.filter((d) => dowOf(d) === x) } : { days: [x] }, time, minutes) : [];
                return (
                  <label key={x} className={id !== tid ? "is-split" : ""}>
                    <span>ทุกวัน{DAY_FULL[x]}</span>
                    <select aria-label={`คนทำวัน${DAY_FULL[x]}`} value={id === tid ? "" : id} onChange={(e) => setDowT({ ...dowT, [String(x)]: e.target.value })}>
                      <option value="">{team.find((t) => t.id === tid)?.name ?? "-"} (ผู้รับผิดชอบหลัก)</option>
                      {team.filter((t) => t.id !== tid).map((t) => <option key={t.id} value={t.id}>{t.name}{t.branch !== c.branch_name ? ` · ${t.branch}` : ""}</option>)}
                    </select>
                    {b.length > 0 && <small className="pa-busy">ไม่ว่าง: {b.map((k) => `${k.resident_name} ${k.plan_time}`).join(", ")}</small>}
                  </label>
                );
              })}</div>
            </section>}
          </>}
        </div>

        <aside className="pa2-cal" aria-label="วันที่จะทำกายภาพ">
          <div className="pa2-cal-h">
            <button type="button" aria-label="เดือนก่อน" onClick={() => setYm(addMonth(ym, -1))}>‹</button>
            <b>{monthLabel(ym)}</b>
            <button type="button" aria-label="เดือนถัดไป" onClick={() => setYm(addMonth(ym, 1))}>›</button>
          </div>
          <div className="pa2-grid">
            {WEEK.map((d) => <span key={d} className="pa2-dow">{DAY_TH[d]}</span>)}
            {monthCells(ym).map((d, k) => d === null ? <span key={k} /> : (
              <button key={d} type="button" disabled={d < today || !tid} aria-pressed={onDay.has(d)} aria-label={`${dayLabel(d)}${onDay.has(d) ? ` นัดครั้งที่ ${onDay.get(d)} · กดเพื่อยกเลิก` : " · กดเพื่อเพิ่มนัด"}`}
                className={`pa2-day ${onDay.has(d) ? "is-on" : ""} ${d === today ? "is-today" : ""} ${d < today ? "is-past" : ""}`} onClick={() => pickDate(d)}>
                {Number(d.slice(8, 10))}{onDay.has(d) && <small>ครั้ง {onDay.get(d)}</small>}
              </button>
            ))}
          </div>
          {tid && <p className="pa2-hint">กดวันที่เพื่อเพิ่มหรือยกเลิกนัดทีละวัน</p>}
          <p className="pa2-sum">{!tid ? "เลือกนักกายภาพ วัน และเวลา เพื่อดูวันนัด"
            : !plan.length ? "เลือกวันในสัปดาห์ หรือกดวันที่ในปฏิทิน"
            : <>นัด <b>{plan.length} ครั้ง</b>{time ? ` เวลา ${time}` : ""} · เริ่ม <b>{dayLabel(plan[0].date)}</b> · {plan.length >= leftOf(c) ? <>ครบครั้งที่ {c.total} ประมาณ <b>{dayLabel(plan[plan.length - 1].date)}</b></> : <>นัดไว้ถึง <b>{dayLabel(plan[plan.length - 1].date)}</b> · ยังเหลืออีก {leftOf(c) - plan.length} ครั้งที่ยังไม่ได้นัด</>}</>}</p>
          {plan.length > 0 && plan[plan.length - 1].date.slice(0, 7) !== ym && <button type="button" className="pa2-jump" onClick={() => setYm(plan[plan.length - 1].date.slice(0, 7))}>ดูเดือนที่ครบคอร์ส ›</button>}
        </aside>
      </div>
    </Modal>
  );
}
