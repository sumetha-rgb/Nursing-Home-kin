"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import PhotoPicker from "@/components/PhotoPicker";
import RosterCalendar from "@/components/roster/RosterCalendar";
import { Modal } from "@/components/ui";
import { useApp } from "@/lib/app";
import type { SessionUser } from "@/lib/roles";
import { checkIn, dayTitle, fetchMonth, fetchToday, isoDate, Month, shortName, SHIFTS, stampPhoto, WEEKDAYS, ymOf } from "@/lib/roster";

type Today = Awaited<ReturnType<typeof fetchToday>>;
const thNow = () => new Date().toLocaleString("th-TH", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
const shiftTime = (s?: string) => SHIFTS.find((x) => x.key === s)?.time ?? "";

/** นาฬิกาที่เดินทุกวินาที (แสดงในหน้าถ่ายรูปเช็คชื่อ) */
function useClock(on: boolean) {
  const [t, setT] = useState(thNow);
  useEffect(() => { if (!on) return; setT(thNow()); const h = setInterval(() => setT(thNow()), 1000); return () => clearInterval(h); }, [on]);
  return t;
}

/** การ์ดเช็คชื่อเข้า/ออกงาน: ต้องถ่ายรูปสดจากกล้อง ระบบประทับวันเวลาลงรูปและบันทึกเวลาของ server */
/** compact = แถบบรรทัดเดียวบนหน้างานวันนี้ · เช็คชื่อครบทั้งเข้าและออกแล้วซ่อนตัวเอง */
export function CheckInCard({ user, onChange, compact = false }: { user: SessionUser; onChange?: () => void; compact?: boolean }) {
  const { toast } = useApp();
  const [today, setToday] = useState<Today | null>(null);
  const [kind, setKind] = useState<"in" | "out" | null>(null);
  const [raw, setRaw] = useState("");
  const [shot, setShot] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const clock = useClock(!!kind);

  const load = useCallback(() => { fetchToday().then(setToday).catch(() => setToday(null)); }, []);
  useEffect(load, [load]);

  const cin = today?.attendance.find((a) => a.kind === "in");
  const cout = today?.attendance.find((a) => a.kind === "out");
  const shift = today?.shift;
  const label = kind === "out" ? "ออกงาน" : "เข้างาน";

  const onPhoto = async (u: string) => {
    setRaw(u); setErr("");
    if (!u) return setShot("");
    const d = new Date();
    try {
      setShot(await stampPhoto(u, [
        `${label} ${d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" })} น.`,
        d.toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" }),
        `${user.name} · สาขา${user.branch ?? "-"}${shift ? ` · เวร${shift.shift}` : ""}`,
      ]));
    } catch (e) { setErr((e as Error).message); }
  };
  const close = () => { setKind(null); setRaw(""); setShot(""); setErr(""); };
  const submit = async () => {
    if (!kind) return;
    if (!shot) return setErr("กรุณาเปิดกล้องและถ่ายรูปตัวเองก่อนเช็คชื่อ");
    setBusy(true); setErr("");
    try {
      const r = await checkIn(kind, shot);
      toast(`เช็คชื่อ${label}แล้ว ${r.at} น.${r.late ? ` · สาย ${r.late} นาที` : ""}`);
      close(); load(); onChange?.();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const dialog = (
      <Modal open={!!kind} title={`เช็คชื่อ${label}`} onClose={close}
        footer={<>
          <button type="button" className="btn-soft" onClick={close}>ยกเลิก</button>
          <button type="button" className="btn-primary" disabled={busy} onClick={submit}>{busy ? "กำลังบันทึก…" : `ยืนยันเช็คชื่อ${label}`}</button>
        </>}>
        <div className="checkin-clock"><Icon name="history" className="h-4 w-4" /><span>{clock}</span></div>
        <p className="mb-3 text-sm text-gold-700">{user.name} · สาขา{user.branch ?? "-"}{shift ? ` · เวร${shift.shift} ${shiftTime(shift.shift)}` : ""}</p>
        <PhotoPicker value={shot || raw} onChange={onPhoto} allowFile={false} front invalid={!!err && !shot}
          label="ถ่ายรูปตัวเองเพื่อยืนยันตัวตน" hint="ต้องถ่ายสดจากกล้องเท่านั้น ระบบประทับวันที่และเวลาลงในรูป และบันทึกเวลาจากเซิร์ฟเวอร์" />
        {err && <p role="alert" className="form-error mt-3"><Icon name="alert" className="h-4 w-4 shrink-0" />{err}</p>}
      </Modal>
  );
  if (compact) {
    if (!today || (cin && cout)) return dialog;
    return (
      <section className={`ka-checkin ${cin ? "is-in" : ""}`}>
        <Icon name="camera" className="h-5 w-5 shrink-0" />
        <span className="ka-t">
          <b>{cin ? `เข้างานแล้ว ${cin.time} น.` : "ยังไม่เช็คชื่อเข้างาน"}{(cin?.late_min ?? 0) > 0 && <em className="ka-flag warn">สาย {cin!.late_min} นาที</em>}</b>
          <small>{shift ? `เวร${shift.shift} ${shiftTime(shift.shift)}` : "ไม่มีเวรในตาราง · บันทึกเป็นนอกตาราง"}</small>
        </span>
        <button type="button" className={cin ? "btn-soft ka-btn-sm" : "btn-primary ka-btn-sm"} onClick={() => setKind(cin ? "out" : "in")}>{cin ? "เช็คชื่อออก" : "เช็คชื่อ"}</button>
        {dialog}
      </section>
    );
  }

  return (
    <section className="checkin-card">
      <div className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gold-100 text-gold-700"><Icon name="camera" /></span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-gold-800">เช็คชื่อเข้างาน</p>
          <p className="text-xs text-gold-600">{shift ? `เวร${shift.shift} ${shiftTime(shift.shift)} · ${dayTitle(shift.date)}` : "วันนี้ไม่มีเวรของคุณในตาราง (เช็คชื่อได้ ระบบจะบันทึกว่านอกตาราง)"}</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className={`checkin-slot ${cin ? "is-done" : ""}`}><small>เข้างาน</small><b>{cin ? `${cin.time} น.` : "ยังไม่เช็คชื่อ"}</b>{(cin?.late_min ?? 0) > 0 && <em>สาย {cin!.late_min} นาที</em>}</div>
        <div className={`checkin-slot ${cout ? "is-done" : ""}`}><small>ออกงาน</small><b>{cout ? `${cout.time} น.` : "-"}</b></div>
      </div>
      {!cin && <button type="button" className="btn-primary mt-3 w-full" onClick={() => setKind("in")}><Icon name="camera" className="h-4 w-4" /> ถ่ายรูปเช็คชื่อเข้างาน</button>}
      {cin && !cout && <button type="button" className="btn-soft mt-3 w-full" onClick={() => setKind("out")}><Icon name="camera" className="h-4 w-4" /> ถ่ายรูปเช็คชื่อออกงาน</button>}
      {dialog}
    </section>
  );
}

const SHIFT_START: Record<string, number> = { เช้า: 7, ดึก: 19 };
const at = (date: string, h: number) => new Date(`${date}T${String(h).padStart(2, "0")}:00:00`).getTime();
const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return isoDate(d); };
/** วันจันทร์ของสัปดาห์ที่มีวันนั้น (แถบสัปดาห์เริ่มวันจันทร์ ตรงกับปฏิทินเดือน) */
const mondayOf = (iso: string) => { const d = new Date(`${iso}T00:00:00`); return addDays(iso, -((d.getDay() + 6) % 7)); };
const shortDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short" });

/**
 * แท็บตารางเวรใน KinApp
 *  บนสุด = เวรถัดไปของฉันและคนที่เข้าเวรด้วย · แถบสัปดาห์ (แตะวัน = ดูว่าใครอยู่เวรวันนั้น)
 *  การมาทำงานของฉันเดือนนี้ · ปุ่ม "ทั้งเดือน" เปิดปฏิทินเต็มเดือน · การ์ดเช็คชื่ออยู่ที่หน้างานวันนี้
 */
export function StaffRoster({ user }: { user: SessionUser }) {
  const today = isoDate(new Date());
  const [months, setMonths] = useState<Record<string, Month>>({});
  const [err, setErr] = useState("");
  const [day, setDay] = useState(today);
  const [full, setFull] = useState(false);
  const [fullYm, setFullYm] = useState(ymOf(new Date()));
  const [mineOnly, setMineOnly] = useState(true);
  const week = Array.from({ length: 7 }, (_, i) => addDays(mondayOf(day), i));
  // โหลดเดือนของแถบสัปดาห์ เดือนนี้ เดือนถัดไป (หาเวรถัดไป) และเดือนที่เปิดในปฏิทินเต็ม · โหลดแล้วไม่โหลดซ้ำ
  const need = [...new Set([...week.map((d) => d.slice(0, 7)), today.slice(0, 7), addDays(today, 31).slice(0, 7), fullYm])].sort().join(",");
  useEffect(() => {
    need.split(",").forEach((ym) => {
      if (months[ym]) return;
      fetchMonth(ym).then((d) => { setMonths((m) => ({ ...m, [ym]: d })); setErr(""); }).catch((e) => setErr((e as Error).message));
    });
  }, [need]); // eslint-disable-line react-hooks/exhaustive-deps

  const all = Object.values(months);
  const shifts = all.flatMap((m) => m.shifts);
  const attendance = all.flatMap((m) => m.attendance);
  const checkedIn = (staffId: string, date: string, shift: string) => attendance.find((a) => a.staff_id === staffId && a.date === date && a.kind === "in" && (!a.shift || a.shift === shift));
  const now = Date.now();
  const startOf = (s: { date: string; shift: string }) => at(s.date, SHIFT_START[s.shift] ?? 7);
  // เวรถัดไปของฉัน: เวรที่ยังไม่จบ (เวรละ 12 ชั่วโมง) ที่เริ่มเร็วที่สุด
  const next = shifts.filter((s) => s.staff_id === user.id && startOf(s) + 12 * 3600e3 > now).sort((a, b) => startOf(a) - startOf(b))[0];
  const nextStart = next ? startOf(next) : 0;
  const hoursTo = Math.round((nextStart - now) / 3600e3);
  const mates = next ? shifts.filter((s) => s.date === next.date && s.shift === next.shift && s.staff_id !== user.id) : [];
  const dayWord = (d: string) => (d === today ? "วันนี้" : d === addDays(today, 1) ? "พรุ่งนี้" : "");
  const myOn = (d: string) => shifts.find((s) => s.date === d && s.staff_id === user.id);
  // การมาทำงานของฉันเดือนนี้ · นับเฉพาะเวรที่ถึงเวลาเข้างานแล้ว · ขาด = วันที่ผ่านไปแล้วไม่ได้เช็คชื่อ
  const monthShifts = (months[today.slice(0, 7)]?.shifts ?? []).filter((s) => s.staff_id === user.id);
  const begun = monthShifts.filter((s) => startOf(s) <= now);
  const ins = begun.map((s) => checkedIn(user.id, s.date, s.shift));
  const onTime = ins.filter((a) => a && !(a.late_min ?? 0)).length;
  const late = ins.filter((a) => a && (a.late_min ?? 0) > 0).length;
  const absent = begun.filter((s, i) => !ins[i] && s.date < today).length;

  return (
    <>
      <div className="ka-head">
        <div><h1>ตารางเวร</h1><p>{new Date().toLocaleDateString("th-TH", { month: "short", year: "numeric" })} · ของฉัน {monthShifts.length} เวร</p></div>
        <button type="button" className="ka-pill" onClick={() => { setFullYm(day.slice(0, 7)); setFull(true); }}><Icon name="calendar" className="h-4 w-4" />ทั้งเดือน</button>
      </div>
      {err && <p role="alert" className="form-error"><Icon name="alert" className="h-4 w-4 shrink-0" />{err}</p>}

      <section className="ka-next-shift">
        <small>เวรถัดไปของฉัน</small>
        {next ? <>
          <b>{dayWord(next.date) ? `${dayWord(next.date)} ` : ""}{shortDay(next.date)} · เวร{next.shift}</b>
          <span>{shiftTime(next.shift)} · {nextStart <= now ? "กำลังอยู่เวร" : hoursTo < 1 ? "เริ่มในไม่ถึง 1 ชั่วโมง" : `อีก ${hoursTo} ชั่วโมง`}</span>
          {mates.length > 0 && <p className="ka-mates">{mates.slice(0, 4).map((m) => <i key={m.id}>{shortName(m.staff_name).slice(0, 2)}</i>)}<span>เข้าเวรด้วย: {mates.map((m) => shortName(m.staff_name)).join(" ")}</span></p>}
        </> : <b className="!text-base">ยังไม่มีเวรของคุณ · ผู้จัดการสาขาจัดเวรได้ที่เมนู &quot;ตารางเวร&quot;</b>}
      </section>

      <div className="ka-week">
        <button type="button" className="ka-week-nav" aria-label="สัปดาห์ก่อน" onClick={() => setDay(addDays(week[0], -7))}><Icon name="chevron" className="h-4 w-4 rotate-90" /></button>
        <div className="ka-week-days" role="radiogroup" aria-label="เลือกวัน">
          {week.map((d) => {
            const m = myOn(d);
            return (
              <button key={d} type="button" role="radio" aria-checked={d === day} onClick={() => setDay(d)} className={`${d === today ? "is-today" : ""} ${d === day ? "is-on" : ""}`}>
                <small>{WEEKDAYS[(new Date(`${d}T00:00:00`).getDay() + 6) % 7]}</small><b>{Number(d.slice(8))}</b>
                <i className={m ? (m.shift === "ดึก" ? "is-night" : "is-day") : ""}>{m ? (m.shift === "ดึก" ? "ด" : "ช") : ""}</i>
              </button>
            );
          })}
        </div>
        <button type="button" className="ka-week-nav" aria-label="สัปดาห์ถัดไป" onClick={() => setDay(addDays(week[0], 7))}><Icon name="chevron" className="h-4 w-4 -rotate-90" /></button>
      </div>

      <p className="ka-h">{day === today ? "วันนี้ใครอยู่เวร" : "ใครอยู่เวร"} · {shortDay(day)}</p>
      <ul className="ka-list">
        {SHIFTS.map((sh) => {
          const who = shifts.filter((s) => s.date === day && s.shift === sh.key);
          const started = at(day, SHIFT_START[sh.key] ?? 7) <= now;
          const inCount = who.filter((s) => checkedIn(s.staff_id, s.date, s.shift)).length;
          return (
            <li key={sh.key} className="ka-row">
              <span className={`ka-shift ${sh.key === "ดึก" ? "is-night" : ""}`}>{sh.key}</span>
              <span className="ka-t">
                {who.length ? <b>{who.map((s, i) => {
                  const a = started ? checkedIn(s.staff_id, s.date, s.shift) : undefined;
                  return <span key={s.id} className={s.staff_id === user.id ? "is-me" : ""}>{i ? " · " : ""}{s.staff_id === user.id ? "คุณ" : shortName(s.staff_name)}
                    {a && (a.late_min ?? 0) > 0 ? <em className="ka-flag warn">สาย {a.late_min} นาที</em> : started && !a && day < today ? <em className="ka-flag bad">ขาด</em> : null}</span>;
                })}</b> : <b><em className="ka-flag warn">ยังไม่มีคนเข้าเวร</em></b>}
                <small>{sh.time}{started && who.length ? ` · เช็คชื่อแล้ว ${inCount} จาก ${who.length} คน` : who.length ? ` · ${who.length} คน` : ""}</small>
              </span>
            </li>
          );
        })}
      </ul>

      <p className="ka-h">การมาทำงานของฉันเดือนนี้</p>
      <div className="ka-stats">
        <span><b>{onTime}</b>ตรงเวลา</span>
        <span className={late ? "is-warn" : ""}><b>{late}</b>สาย</span>
        <span className={absent ? "is-bad" : ""}><b>{absent}</b>ขาด</span>
      </div>

      <Modal open={full} title="ตารางเวรทั้งเดือน" onClose={() => setFull(false)}>
        <div className="seg mb-3" role="radiogroup" aria-label="แสดงเวร">
          <button type="button" aria-pressed={mineOnly} onClick={() => setMineOnly(true)}>เวรของฉัน</button>
          <button type="button" aria-pressed={!mineOnly} onClick={() => setMineOnly(false)}>ทุกคน</button>
        </div>
        <RosterCalendar ym={fullYm} onMonth={setFullYm} shifts={months[fullYm]?.shifts ?? []} attendance={months[fullYm]?.attendance} mineId={user.id} onlyMine={mineOnly}
          today={today} selected={day} onDay={(d) => { setDay(d); setFull(false); }} compact gaps={!mineOnly} />
        <p className="mt-3 text-xs text-gold-500">แตะวันที่เพื่อดูว่าใครอยู่เวรวันนั้น</p>
      </Modal>
    </>
  );
}
