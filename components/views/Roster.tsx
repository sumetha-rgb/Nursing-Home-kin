"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { MetricGrid, Modal, PageHeader, Section, Select } from "@/components/ui";
import RosterCalendar from "@/components/roster/RosterCalendar";
import { useApp } from "@/lib/app";
import { ROLE_INFO, Role } from "@/lib/roles";
import { useBranchNames } from "@/lib/branches";
import { assignShift, Attendance, dayTitle, fetchDay, fetchMonth, isoDate, Month, SHIFTS, ymOf } from "@/lib/roster";

/** ตารางเวรของสาขา: ผู้จัดการดูภาพรวมทั้งเดือน กดวันเพื่อจัดคนเข้าเวรและดูรูปเช็คชื่อ */
export function Roster() {
  const { toast } = useApp();
  const branches = useBranchNames();
  const today = isoDate(new Date());
  const [ym, setYm] = useState(ymOf(new Date()));
  const [branch, setBranch] = useState("");
  const [data, setData] = useState<Month | null>(null);
  const [error, setError] = useState("");
  const [day, setDay] = useState<string | null>(null);
  const [pick, setPick] = useState<Record<string, string[]>>({});
  const [att, setAtt] = useState<Attendance[]>([]);
  const [photo, setPhoto] = useState<Attendance | null>(null);
  const [busy, setBusy] = useState(false);

  const isGlobal = data?.me.role === "Global Admin";
  const load = useCallback(async () => {
    try { setData(await fetchMonth(ym, branch || undefined)); setError(""); }
    catch (e) { setError((e as Error).message); }
  }, [ym, branch]);
  useEffect(() => { load(); }, [load]);
  // ผู้บริหาร: เริ่มที่สาขาแรกเพื่อให้จัดเวรได้ทันที
  useEffect(() => { if (isGlobal && !branch && branches.length) setBranch(branches[0]); }, [isGlobal, branch, branches]);

  const openDay = async (d: string) => {
    if (!data) return;
    setDay(d);
    setPick(Object.fromEntries(SHIFTS.map((s) => [s.key, data.shifts.filter((x) => x.date === d && x.shift === s.key).map((x) => x.staff_id)])));
    setAtt([]);
    try { setAtt((await fetchDay(d, data.branch ?? undefined)).attendance); } catch { /* แสดงเฉพาะตารางเวร */ }
  };
  const save = async () => {
    if (!day || !data) return;
    setBusy(true);
    try {
      for (const s of SHIFTS) await assignShift(day, s.key, pick[s.key] ?? [], data.branch ?? undefined);
      toast(`บันทึกเวรวันที่ ${Number(day.slice(8))} แล้ว · พนักงานเห็นใน KinApp ทันที`);
      setDay(null); load();
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  };
  const toggle = (shift: string, id: string) => setPick((p) => ({ ...p, [shift]: p[shift]?.includes(id) ? p[shift].filter((x) => x !== id) : [...(p[shift] ?? []), id] }));
  const copyPrev = () => {
    if (!day || !data) return;
    const prev = isoDate(new Date(new Date(day + "T00:00:00").getTime() - 864e5));
    const src = Object.fromEntries(SHIFTS.map((s) => [s.key, data.shifts.filter((x) => x.date === prev && x.shift === s.key).map((x) => x.staff_id)]));
    if (!Object.values(src).some((v) => v.length)) return toast("วันก่อนหน้าไม่มีเวรให้คัดลอก");
    setPick(src);
  };

  const shifts = data?.shifts ?? [];
  const attendance = data?.attendance ?? [];
  const todays = shifts.filter((s) => s.date === today);
  const inToday = attendance.filter((a) => a.date === today && a.kind === "in");
  const lateMonth = attendance.filter((a) => a.kind === "in" && (a.late_min ?? 0) > 0).length;
  // จัดเวรเฉพาะพยาบาล (พนักงานพยาบาลและหัวหน้าพยาบาล)
  const team = (data?.team ?? []).filter((t) => t.role === "Nurse" || t.role === "Head Nurse");

  return (
    <>
      <PageHeader title="ตารางเวร" sub="ภาพรวมเวรเช้า/ดึกของทั้งเดือน กดวันที่เพื่อจัดคนเข้าเวร และดูรูปถ่ายตอนเช็คชื่อพร้อมวันเวลา" />
      {isGlobal && (
        <div className="mb-4 max-w-xs">
          <Select aria-label="เลือกสาขา" options={branches} value={branch} onChange={setBranch} />
        </div>
      )}
      <MetricGrid items={[
        { label: "เข้าเวรวันนี้", value: todays.length, unit: "คน", icon: "user" },
        { label: "เช็คชื่อแล้ววันนี้", value: inToday.length, unit: `/ ${todays.length}`, icon: "check", accent: true },
        { label: "เข้างานสายเดือนนี้", value: lateMonth, unit: "ครั้ง", icon: "history", note: "เกิน 15 นาทีจากเวลาเริ่มเวร" },
        { label: "เวรทั้งเดือน", value: shifts.length, unit: "เวร", icon: "calendar" },
      ]} />
      <Section title={`ตารางเวร${data?.branch ? ` · สาขา${data.branch}` : ""}`} sub="กดวันที่เพื่อจัดเวรหรือดูการเช็คชื่อ">
        {error && <p role="alert" className="form-error mb-3"><Icon name="alert" className="h-4 w-4 shrink-0" />{error}</p>}
        <RosterCalendar ym={ym} onMonth={setYm} shifts={shifts} attendance={attendance} today={today} selected={day} onDay={openDay} />
      </Section>

      <Modal open={!!day} wide title={day ? `จัดเวร · ${dayTitle(day)}` : ""} onClose={() => setDay(null)}
        footer={<>
          <button type="button" className="btn-soft mr-auto" onClick={copyPrev}><Icon name="files" className="h-4 w-4" /> คัดลอกจากวันก่อน</button>
          <button type="button" className="btn-soft" onClick={() => setDay(null)}>ยกเลิก</button>
          <button type="button" className="btn-primary" disabled={busy || !data?.branch} onClick={save}>{busy ? "กำลังบันทึก…" : "บันทึกเวร"}</button>
        </>}>
        {!data?.branch && <p role="alert" className="form-error mb-3"><Icon name="alert" className="h-4 w-4 shrink-0" />กรุณาเลือกสาขาก่อนจัดเวร</p>}
        <div className="grid gap-4 md:grid-cols-2">
          {SHIFTS.map((s) => (
            <div key={s.key}>
              <p className="label">{s.label} <small className="text-gold-500">{s.time} · {pick[s.key]?.length ?? 0} คน</small></p>
              <ul className="pick-list">{team.map((t) => <li key={t.id}><label><input type="checkbox" checked={pick[s.key]?.includes(t.id) ?? false} onChange={() => toggle(s.key, t.id)} /> <span>{t.name} <small className="text-gold-500">· {ROLE_INFO[t.role as Role]?.th ?? t.role}</small></span></label></li>)}</ul>
              {!team.length && <p className="text-sm text-gold-500">ยังไม่มีพยาบาลที่ทำงานอยู่ในสาขานี้</p>}
            </div>
          ))}
        </div>
        <p className="label mt-6">การเช็คชื่อของวันนี้</p>
        {att.length ? (
          <ul className="attend-list">
            {att.map((a) => (
              <li key={a.id}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {a.photo ? <button type="button" onClick={() => setPhoto(a)}><img src={a.photo} alt={`รูปเช็คชื่อ ${a.staff_name}`} /></button> : <span className="attend-nophoto" />}
                <div>
                  <b>{a.staff_name}</b>
                  <span>{a.kind === "in" ? "เข้างาน" : "ออกงาน"} {a.time} น. · {a.shift ? `เวร${a.shift}` : "ไม่มีเวรในตาราง"}</span>
                  {(a.late_min ?? 0) > 0 && <em className="is-late">สาย {a.late_min} นาที</em>}
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-gold-500">ยังไม่มีการเช็คชื่อ</p>}
      </Modal>

      <Modal open={!!photo} title={photo ? `${photo.staff_name} · ${photo.kind === "in" ? "เข้างาน" : "ออกงาน"} ${photo.time} น.` : ""} onClose={() => setPhoto(null)}
        footer={<button type="button" className="btn-primary" onClick={() => setPhoto(null)}>ปิด</button>}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {photo?.photo && <img src={photo.photo} alt="รูปเช็คชื่อ" className="w-full rounded-xl" />}
      </Modal>
    </>
  );
}
