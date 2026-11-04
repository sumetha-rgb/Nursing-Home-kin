"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { MetricGrid, Modal, PageHeader, Section, Select } from "@/components/ui";
import { downloadCsv } from "@/lib/store";
import RosterCalendar from "@/components/roster/RosterCalendar";
import { useApp } from "@/lib/app";
import { useAutoRefresh } from "@/lib/autoRefresh";
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
  useAutoRefresh(load); // การเช็คชื่อของพยาบาลขึ้นเองระหว่างเปิดหน้าค้างไว้
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
      toast(`บันทึกเวรแล้ว · วันที่ ${Number(day.slice(8))} · พยาบาลเห็นใน KinApp ทันที`);
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
  // สรุปการมาทำงานรายคน: นับเฉพาะเวรที่ถึงเวลาเข้างานแล้ว (+ผ่อนผัน 15 นาที) · ขาด 2 ครั้งขึ้นไปชื่อเป็นสีแดง
  const nowHm = new Date().toTimeString().slice(0, 5);
  const due = (s: { date: string; shift: string }) => s.date < today || (s.date === today && nowHm >= (s.shift === "ดึก" ? "19:15" : "07:15"));
  const report = (() => {
    const by = new Map<string, { name: string; due: number; ontime: number; late: number; lateMin: number; missed: number; extra: number }>();
    const row = (id: string, name: string) => { if (!by.has(id)) by.set(id, { name, due: 0, ontime: 0, late: 0, lateMin: 0, missed: 0, extra: 0 }); return by.get(id)!; };
    for (const s of shifts) {
      const a = attendance.find((x) => x.staff_id === s.staff_id && x.date === s.date && x.shift === s.shift && x.kind === "in");
      if (!a && !due(s)) continue;
      const r = row(s.staff_id, s.staff_name); r.due++;
      if (!a) r.missed++; else if ((a.late_min ?? 0) > 0) { r.late++; r.lateMin += a.late_min ?? 0; } else r.ontime++;
    }
    for (const a of attendance) if (a.kind === "in" && !a.shift) row(a.staff_id, a.staff_name).extra++;
    return [...by.values()].sort((a, b) => b.missed - a.missed || b.late - a.late || a.name.localeCompare(b.name));
  })();
  const missedMonth = report.reduce((n, r) => n + r.missed, 0);
  // วันนี้และวันข้างหน้าของเดือนที่ดู ที่ยังไม่มีคนเข้าเวรครบทั้งเช้าและดึก
  const [yy, mm] = ym.split("-").map(Number);
  const monthDays = Array.from({ length: new Date(yy, mm, 0).getDate() }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`).filter((d) => d >= today);
  const gapDays = monthDays.filter((d) => SHIFTS.some((sh) => !shifts.some((s) => s.date === d && s.shift === sh.key))).length;
  // ส่งออก CSV ของเดือนที่ดู: ทุกเวร (เช็คชื่อ สาย ขาด) และสรุปรายคน
  const fileTag = `${ym}${data?.branch ? `-${data.branch}` : ""}`;
  const exportShifts = () => {
    const rows = [...shifts].sort((a, b) => a.date.localeCompare(b.date) || a.shift.localeCompare(b.shift) || a.staff_name.localeCompare(b.staff_name)).map((s) => {
      const a = attendance.find((x) => x.staff_id === s.staff_id && x.date === s.date && x.shift === s.shift && x.kind === "in");
      const out = attendance.find((x) => x.staff_id === s.staff_id && x.date === s.date && x.shift === s.shift && x.kind === "out");
      const st = a ? ((a.late_min ?? 0) > 0 ? "สาย" : "ตรงเวลา") : due(s) ? "ขาด (ไม่ได้เช็คชื่อ)" : "ยังไม่ถึงเวลา";
      return [((d) => `${d[2]}/${d[1]}/${Number(d[0]) + 543}`)(s.date.split("-")), `เวร${s.shift}`, s.staff_name, a?.time ?? "", out?.time ?? "", a && (a.late_min ?? 0) > 0 ? String(a.late_min) : "", st];
    });
    downloadCsv(`ตารางเวร-${fileTag}`, ["วันที่", "เวร", "พนักงาน", "เช็คชื่อเข้า", "เช็คชื่อออก", "สาย (นาที)", "สถานะ"], rows);
    toast(`ส่งออกตารางเวรแล้ว ${rows.length} เวร`);
  };
  const exportReport = () => {
    downloadCsv(`สรุปการมาทำงาน-${fileTag}`, ["พนักงาน", "เวรที่ถึงเวลาแล้ว", "ตรงเวลา", "สาย (ครั้ง)", "สายรวม (นาที)", "ขาด (ครั้ง)", "เช็คชื่อนอกตาราง"],
      report.map((r) => [r.name, String(r.due), String(r.ontime), String(r.late), String(r.lateMin), String(r.missed), String(r.extra)]));
    toast(`ส่งออกสรุปรายคนแล้ว ${report.length} คน`);
  };
  // จัดเวรเฉพาะพยาบาล (พนักงานพยาบาลและหัวหน้าพยาบาล)
  const team = (data?.team ?? []).filter((t) => t.role === "Nurse" || t.role === "Head Nurse");

  return (
    <>
      <PageHeader title="ตารางเวร" sub="กดวันที่เพื่อจัดเวรหรือดูการเช็คชื่อ"
        actions={<>
          <button className="btn-soft" disabled={!shifts.length} title="ทุกเวรของเดือนที่ดู พร้อมเวลาเช็คชื่อ สาย ขาด" onClick={exportShifts}><Icon name="download" className="h-4 w-4" /> ส่งออกตารางเวร</button>
          <button className="btn-soft" disabled={!report.length} title="สรุปการมาทำงานรายคนของเดือนที่ดู" onClick={exportReport}><Icon name="download" className="h-4 w-4" /> ส่งออกสรุปรายคน</button>
        </>} />
      {isGlobal && (
        <div className="mb-4 max-w-xs">
          <Select aria-label="เลือกสาขา" options={branches} value={branch} onChange={setBranch} />
        </div>
      )}
      <MetricGrid items={[
        { label: "เข้าเวรวันนี้", value: todays.length, unit: "คน", icon: "user" },
        { label: "เช็คชื่อแล้ววันนี้", value: inToday.length, unit: `/ ${todays.length}`, icon: "check", accent: true },
        { label: "เข้างานสายเดือนนี้", value: lateMonth, unit: "ครั้ง", icon: "history", note: "เกิน 15 นาทีจากเวลาเริ่มเวร" },
        { label: "ขาดงานเดือนนี้", value: missedMonth, unit: "ครั้ง", icon: "alert", note: "ถึงเวลาเข้าเวรแล้วไม่ได้เช็คชื่อ" },
      ]} />
      <Section title={`ตารางเวร${data?.branch ? ` · สาขา${data.branch}` : ""}`}
        actions={data && monthDays.length > 0 ? <span className={`rounded-full px-3 py-1 text-sm font-semibold ${gapDays ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{gapDays ? `ยังจัดเวรไม่ครบ ${gapDays} วัน` : "จัดเวรครบทุกวันแล้ว"}</span> : undefined}>
        {error && <p role="alert" className="form-error mb-3"><Icon name="alert" className="h-4 w-4 shrink-0" />{error}</p>}
        <RosterCalendar ym={ym} onMonth={setYm} shifts={shifts} attendance={attendance} today={today} selected={day} onDay={openDay} gaps={!!data} />
      </Section>

      <Section title="สรุปการมาทำงานรายคน" sub="ชื่อสีแดง = ขาด 2 ครั้งขึ้นไปในเดือนนี้">
        {report.length ? <div className="overflow-x-auto rounded-2xl border border-cream-300">
          <table className="data-table w-full min-w-[640px]">
            <thead><tr><th scope="col">พนักงาน</th><th scope="col">เวรที่ถึงเวลาแล้ว</th><th scope="col">ตรงเวลา</th><th scope="col">สาย</th><th scope="col">ขาด</th><th scope="col">เช็คชื่อนอกตาราง</th></tr></thead>
            <tbody>{report.map((r) => <tr key={r.name}>
              <td className={r.missed >= 2 ? "font-semibold text-red-700" : r.missed === 1 ? "font-medium text-amber-800" : ""}>{r.name}</td>
              <td>{r.due}</td><td>{r.ontime}</td>
              <td className={r.late ? "text-amber-800" : ""}>{r.late ? `${r.late} ครั้ง · รวม ${r.lateMin} นาที` : "-"}</td>
              <td className={r.missed >= 2 ? "font-semibold text-red-700" : r.missed ? "text-amber-800" : ""}>{r.missed || "-"}</td>
              <td>{r.extra || "-"}</td>
            </tr>)}</tbody>
          </table>
        </div> : <p className="rounded-xl bg-cream-50 px-4 py-6 text-center text-sm text-gold-600">ยังไม่มีเวรที่ถึงเวลาเข้างานในเดือนนี้</p>}
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
