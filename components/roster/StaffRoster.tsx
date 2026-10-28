"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import PhotoPicker from "@/components/PhotoPicker";
import RosterCalendar from "@/components/roster/RosterCalendar";
import { Modal } from "@/components/ui";
import { useApp } from "@/lib/app";
import type { SessionUser } from "@/lib/roles";
import { checkIn, dayTitle, fetchMonth, fetchToday, isoDate, Month, SHIFTS, stampPhoto, ymOf } from "@/lib/roster";

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
export function CheckInCard({ user, onChange }: { user: SessionUser; onChange?: () => void }) {
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
    </section>
  );
}

/** แท็บตารางเวรใน KinApp: ดูเวรของทั้งสาขา หรือเฉพาะของฉัน */
export function StaffRoster({ user }: { user: SessionUser }) {
  const [ym, setYm] = useState(ymOf(new Date()));
  const [data, setData] = useState<Month | null>(null);
  const [mineOnly, setMineOnly] = useState(false);
  const [day, setDay] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const today = isoDate(new Date());
  const load = useCallback(() => { fetchMonth(ym).then((d) => { setData(d); setErr(""); }).catch((e) => setErr((e as Error).message)); }, [ym]);
  useEffect(load, [load]);

  const shifts = data?.shifts ?? [];
  const myNext = shifts.filter((s) => s.staff_id === user.id && s.date >= today).slice(0, 3);
  const dayList = day ? shifts.filter((s) => s.date === day) : [];

  return (
    <>
      <CheckInCard user={user} onChange={load} />
      <section className="rounded-3xl border border-cream-300/70 bg-white p-4 shadow-soft">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-gold-800"><Icon name="calendar" className="h-[18px] w-[18px] text-gold-500" />ตารางเวร สาขา{user.branch ?? "-"}</h2>
          <div className="seg" role="tablist">
            <button type="button" aria-pressed={!mineOnly} onClick={() => setMineOnly(false)}>ทั้งหมด</button>
            <button type="button" aria-pressed={mineOnly} onClick={() => setMineOnly(true)}>ของฉัน</button>
          </div>
        </div>
        {err && <p role="alert" className="form-error mb-3"><Icon name="alert" className="h-4 w-4 shrink-0" />{err}</p>}
        <RosterCalendar ym={ym} onMonth={setYm} shifts={shifts} attendance={data?.attendance} mineId={user.id} onlyMine={mineOnly} today={today} selected={day} onDay={setDay} compact />
        {day && (
          <div className="mt-3 rounded-2xl bg-cream-50 p-3 text-sm">
            <p className="mb-2 font-semibold text-gold-800">{dayTitle(day)}</p>
            {SHIFTS.map((s) => {
              const who = dayList.filter((x) => x.shift === s.key);
              return <p key={s.key} className="mb-1"><b className="text-gold-700">{s.label}</b> <small className="text-gold-500">{s.time}</small><br />{who.length ? who.map((x) => <span key={x.id} className={x.staff_id === user.id ? "font-semibold text-gold-800" : ""}>{x.staff_name}{x.staff_id === user.id ? " (ฉัน)" : ""}<br /></span>) : <span className="text-gold-500">ยังไม่มีคนเข้าเวร</span>}</p>;
            })}
          </div>
        )}
      </section>
      <section className="rounded-3xl border border-cream-300/70 bg-white p-4 shadow-soft">
        <h2 className="mb-3 text-[15px] font-semibold text-gold-800">เวรถัดไปของฉัน</h2>
        {myNext.length ? (
          <ul className="space-y-2">{myNext.map((s) => <li key={s.id} className="flex items-center justify-between rounded-2xl bg-cream-50 px-4 py-3 text-sm"><span>{dayTitle(s.date)}</span><b className="shrink-0 text-gold-700">เวร{s.shift} {shiftTime(s.shift)}</b></li>)}</ul>
        ) : <p className="rounded-2xl bg-cream-50 py-6 text-center text-sm text-gold-500">ยังไม่มีเวรในเดือนนี้ · ผู้จัดการสาขาจัดเวรได้ที่เมนู &quot;ตารางเวร&quot;</p>}
      </section>
    </>
  );
}
