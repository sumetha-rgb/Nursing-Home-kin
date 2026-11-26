"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import CsvIcon from "@/components/CsvIcon";
import Icon from "@/components/Icon";
import { MenuButton, Modal, PageHeader, Section, Select, Tabs, TimeInput } from "@/components/ui";
import { downloadCsv } from "@/lib/store";
import RosterCalendar from "@/components/roster/RosterCalendar";
import { TH_MONTHS } from "@/lib/appointments";
import { useApp } from "@/lib/app";
import { useAutoRefresh } from "@/lib/autoRefresh";
import { ROLE_INFO, Role } from "@/lib/roles";
import { useBranchNames } from "@/lib/branches";
import { assignOne, assignShift, Attendance, dayTitle, fetchDay, fetchMonth, isoDate, Month, Shift, shortName, SHIFTS, WEEKDAYS, ymOf } from "@/lib/roster";
import { hm, hourOf, lenText, shiftError, shiftLength, shiftRange, shiftStartHour } from "@/lib/shifts";
import { reloadShiftStarts, useShiftCfg } from "@/lib/shiftsClient";

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
  /** รายชื่อเวรตอนเปิดหน้าต่าง (บันทึกเฉพาะคนที่เพิ่ม/เอาออก ไม่ทับคนที่คนอื่นเพิ่งจัด) */
  const [orig, setOrig] = useState<Record<string, string[]>>({});
  const [att, setAtt] = useState<Attendance[]>([]);
  const [photo, setPhoto] = useState<Attendance | null>(null);
  const [busy, setBusy] = useState(false);
  /** มุมมอง: รายสัปดาห์ (แถว = คน · กดช่องแล้วเลือกเวรจากเมนู) หรือทั้งเดือน (ปฏิทินเดิม) */
  const [view, setView] = useState<"สัปดาห์" | "ทั้งเดือน">("สัปดาห์");
  const [week, setWeek] = useState(() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoDate(d); });
  const [nextData, setNextData] = useState<Month | null>(null);

  const isGlobal = data?.me.role === "Global Admin";
  /** เวลากะของสาขาที่เปิดอยู่ (ชั่วโมงเริ่มกะเช้า · กะดึก +12) · ผู้จัดการสาขา/ผู้บริหารตั้งได้ที่ปุ่ม ตั้งเวลากะ */
  const shStart = useShiftCfg(data?.branch ?? branch);
  const canSetShift = data?.me.role === "Branch Admin" || isGlobal;
  /** หน้าต่างตั้งเวลากะ: เวลาเริ่มกะเช้า / กะดึก "HH:MM" */
  const [shiftDlg, setShiftDlg] = useState<{ d: string; n: string } | null>(null);
  const dlgCfg = shiftDlg ? { d: hourOf(shiftDlg.d), n: hourOf(shiftDlg.n) } : null;
  const dlgErr = dlgCfg ? shiftError(dlgCfg) : "";
  const dlgSame = !!dlgCfg && dlgCfg.d === shStart.d && dlgCfg.n === shStart.n;
  const saveShift = async () => {
    if (!shiftDlg || !dlgCfg || !data?.branch) return;
    if (dlgErr) return toast(dlgErr);
    setBusy(true);
    const r = await fetch("/api/roster", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "shift_start", branch: data.branch, day: shiftDlg.d, night: shiftDlg.n }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast(d.error || "บันทึกเวลากะไม่สำเร็จ");
    await reloadShiftStarts();
    setShiftDlg(null);
    toast(`ตั้งเวลากะ สาขา${data.branch} แล้ว · เช้า ${shiftRange(dlgCfg, false)} · ดึก ${shiftRange(dlgCfg, true)}`);
  };
  const weekDays = Array.from({ length: 7 }, (_, i) => { const d = new Date(week + "T00:00:00"); d.setDate(d.getDate() + i); return isoDate(d); });
  const loadYm = view === "สัปดาห์" ? week.slice(0, 7) : ym;
  const crossYm = view === "สัปดาห์" && weekDays[6].slice(0, 7) !== loadYm ? weekDays[6].slice(0, 7) : "";
  const load = useCallback(async () => {
    try {
      setData(await fetchMonth(loadYm, branch || undefined)); setError("");
      setNextData(crossYm ? await fetchMonth(crossYm, branch || undefined) : null);
    } catch (e) { setError((e as Error).message); }
  }, [loadYm, crossYm, branch]);
  useEffect(() => { load(); }, [load]);
  useAutoRefresh(load); // การเช็คชื่อของพยาบาลขึ้นเองระหว่างเปิดหน้าค้างไว้
  // ผู้บริหาร: เริ่มที่สาขาแรกเพื่อให้จัดเวรได้ทันที
  useEffect(() => { if (isGlobal && !branch && branches.length) setBranch(branches[0]); }, [isGlobal, branch, branches]);

  const openDay = async (d: string) => {
    if (!data) return;
    setDay(d);
    const cur = Object.fromEntries(SHIFTS.map((s) => [s.key, data.shifts.filter((x) => x.date === d && x.shift === s.key).map((x) => x.staff_id)]));
    setPick(cur); setOrig(cur);
    setAtt([]);
    try { setAtt((await fetchDay(d, data.branch ?? undefined)).attendance); } catch { /* แสดงเฉพาะตารางเวร */ }
  };
  /** บันทึกเฉพาะส่วนต่างทีละคน (เพิ่ม/เอาออก) · คนที่ไม่ได้แตะในหน้าจอนี้ไม่ถูกลบ แม้ข้อมูลในหน้าจอจะเก่า */
  const applyDiff = async (d: string, sh: string, from: string[], to: string[]) => {
    const br = data?.branch ?? undefined;
    for (const id of to.filter((x) => !from.includes(x))) await assignOne(d, sh, id, true, br);
    for (const id of from.filter((x) => !to.includes(x))) await assignOne(d, sh, id, false, br);
  };
  const save = async () => {
    if (!day || !data) return;
    setBusy(true);
    try {
      for (const s of SHIFTS) await applyDiff(day, s.key, orig[s.key] ?? [], pick[s.key] ?? []);
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
  // สรุปการมาทำงานรายคน: นับเฉพาะเวรที่ถึงเวลาเข้างานแล้ว (+ผ่อนผัน 15 นาที) · ขาด 2 ครั้งขึ้นไปชื่อเป็นสีแดง
  const nowHm = new Date().toTimeString().slice(0, 5);
  const due = (s: { date: string; shift: string }) => s.date < today || (s.date === today && nowHm >= hm(shiftStartHour(shStart, s.shift === "ดึก") + 0.25));
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
  const team = (data?.team ?? []).filter((t) => t.role === "Nurse" || t.role === "Nurse Aide" || t.role === "Head Nurse");

  // ---------- รายสัปดาห์ ----------
  const weekShifts: Shift[] = [...shifts, ...(nextData?.shifts ?? [])];
  const weekAtt: Attendance[] = [...attendance, ...(nextData?.attendance ?? [])];
  const cellOf = (id: string, d: string) => SHIFTS.filter((sh) => weekShifts.some((x) => x.staff_id === id && x.date === d && x.shift === sh.key)).map((sh) => sh.key);
  const [saving, setSaving] = useState("");
  /** เมนูของช่อง: กดช่องแล้วเลือก เช้า / ดึก / เช้า+ดึก / เอาออก · บันทึกครั้งเดียว (ไม่มีสถานะระหว่างทาง) */
  const [menu, setMenu] = useState<{ id: string; name: string; d: string; x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /** เลือกคนทั้งกะ: กดแถว "คนเช้า / คนดึก" ของวันนั้น แล้วติ๊กพนักงาน · บันทึกครั้งเดียว */
  const [crew, setCrew] = useState<{ d: string; sh: string; x: number; y: number; sel: string[] } | null>(null);
  useEffect(() => {
    if (!menu && !crew) return;
    if (crew) menuRef.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    else (menuRef.current?.querySelector<HTMLButtonElement>("button[aria-checked='true']") ?? menuRef.current?.querySelector<HTMLButtonElement>("button"))?.focus({ preventScroll: true });
    const shut = () => { setMenu(null); setCrew(null); };
    const close = (e: Event) => { if (!(e.target as HTMLElement)?.closest?.(".wk-menu")) shut(); };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") shut();
      if (menu && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
        e.preventDefault();
        const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }
    };
    document.addEventListener("mousedown", close); window.addEventListener("keydown", key); window.addEventListener("scroll", close, true);
    return () => { document.removeEventListener("mousedown", close); window.removeEventListener("keydown", key); window.removeEventListener("scroll", close, true); };
  }, [menu, !!crew]); // eslint-disable-line react-hooks/exhaustive-deps
  const onShift = (d: string, sh: string) => weekShifts.filter((x) => x.date === d && x.shift === sh).map((x) => x.staff_id);
  const openCrew = (e: React.MouseEvent<HTMLButtonElement>, d: string, sh: string) => {
    if (!data?.branch) return toast("กรุณาเลือกสาขาก่อนจัดเวร");
    setMenu(null);
    const r = e.currentTarget.getBoundingClientRect(), H = Math.min(team.length * 44, 300) + 130;
    setCrew({ d, sh, sel: onShift(d, sh), x: Math.max(8, Math.min(r.left + r.width / 2 - 140, window.innerWidth - 290)), y: r.bottom + H > window.innerHeight ? Math.max(8, r.top - H - 4) : r.bottom + 4 });
  };
  /** บันทึกรายชื่อทั้งกะ: ส่งเฉพาะคนที่ติ๊กเพิ่ม/เอาออก (ไม่แทนที่ทั้งกะ คนที่คนอื่นเพิ่งจัดไม่หาย) */
  const saveCrew = async () => {
    if (!crew || !data?.branch) return;
    const { d, sh, sel } = crew, cur = onShift(d, sh);
    setCrew(null);
    if (cur.length === sel.length && cur.every((x) => sel.includes(x))) return;
    setSaving(`cov|${d}|${sh}`);
    try { await applyDiff(d, sh, cur, sel); toast(`บันทึกเวร${sh} ${dm(d)} แล้ว`); }
    catch (e) { toast((e as Error).message); }
    finally { await load(); setSaving(""); }
  };
  const openMenu = (e: React.MouseEvent<HTMLButtonElement>, id: string, name: string, d: string) => {
    if (!data?.branch) return toast("กรุณาเลือกสาขาก่อนจัดเวร");
    if (d < today) return toast("วันที่ผ่านมาแล้ว · แก้ได้ที่มุมมองทั้งเดือน (กดวันที่)");
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ id, name, d, x: Math.min(r.left, window.innerWidth - 230), y: r.bottom + 230 > window.innerHeight ? r.top - 222 : r.bottom + 4 });
  };
  /** ตั้งเวรของคนนั้นในวันนั้น · บันทึกเฉพาะกะที่เปลี่ยน เพิ่ม/เอาออกคนนี้คนเดียว (ไม่แตะคนอื่นในกะ) */
  const setCell = async (id: string, d: string, next: string[]) => {
    setMenu(null);
    if (!data?.branch) return;
    const cur = cellOf(id, d);
    if (cur.length === next.length && cur.every((x) => next.includes(x))) return;
    setSaving(`${id}|${d}`);
    try {
      for (const sh of SHIFTS) {
        if (cur.includes(sh.key) === next.includes(sh.key)) continue;
        await assignOne(d, sh.key, id, next.includes(sh.key), data.branch ?? undefined);
      }
    } catch (e) { toast((e as Error).message); }
    finally { await load(); setSaving(""); }
  };
  // ตัวกรองและกลุ่ม: ค้นหาชื่อ · เฉพาะคนที่มีกะสัปดาห์นี้ · กลุ่มตามตำแหน่ง ย่อ/ขยายได้
  const [who, setWho] = useState("");
  const [onlyOn, setOnlyOn] = useState(false);
  const [folded, setFolded] = useState<string[]>([]);
  /** โทรศัพท์: วันที่เลือกในแถบวันที่ (ไม่อยู่ในสัปดาห์ที่ดู = วันนี้ หรือวันแรกของสัปดาห์) */
  const [mDay, setMDay] = useState("");
  const ROLE_ORDER = ["Head Nurse", "Nurse", "Nurse Aide"];
  const shownTeam = team.filter((t) => (!who || t.name.toLowerCase().includes(who.trim().toLowerCase())) && (!onlyOn || weekDays.some((d) => cellOf(t.id, d).length)));
  const groups = ROLE_ORDER.map((r) => ({ role: r, label: ROLE_INFO[r as Role]?.th ?? r, list: shownTeam.filter((t) => t.role === r) })).filter((g) => g.list.length);
  const MENU_OPTS: { k: string[]; t: string; sub: string; c: string }[] = [
    { k: ["เช้า"], t: "กะเช้า", sub: shiftRange(shStart, false), c: "is-d" },
    { k: ["ดึก"], t: "กะดึก", sub: shiftRange(shStart, true), c: "is-n" },
    { k: ["เช้า", "ดึก"], t: "ควบ 2 กะ (เช้า + ดึก)", sub: "24 ชั่วโมง", c: "is-dn" },
  ];
  /** ข้อความในช่องของพนักงาน */
  const cellText = (c: string[]) => (c.length === 2 ? "ควบ 2 กะ" : c[0] === "เช้า" ? "กะเช้า" : c[0] === "ดึก" ? "กะดึก" : "");
  /** คัดลอกเวรของสัปดาห์ก่อนหน้า มาใส่วันที่ยังไม่ผ่านของสัปดาห์นี้ (แทนที่ของเดิม) */
  const copyWeek = async () => {
    if (!data?.branch) return toast("กรุณาเลือกสาขาก่อนจัดเวร");
    const prevStart = (() => { const x = new Date(week + "T00:00:00"); x.setDate(x.getDate() - 7); return isoDate(x); })();
    setBusy(true);
    try {
      const months = await Promise.all([...new Set([prevStart.slice(0, 7), weekDays[0].slice(0, 7)])].map((m) => fetchMonth(m, data.branch ?? undefined)));
      const src = months.flatMap((m) => m.shifts);
      const days = weekDays.filter((d) => d >= today);
      if (!days.length) { toast("สัปดาห์นี้ผ่านไปแล้ว"); return; }
      let n = 0;
      for (const d of days) {
        const from = (() => { const x = new Date(d + "T00:00:00"); x.setDate(x.getDate() - 7); return isoDate(x); })();
        for (const sh of SHIFTS) { const ids = src.filter((x) => x.date === from && x.shift === sh.key).map((x) => x.staff_id); await assignShift(d, sh.key, ids, data.branch ?? undefined); n += ids.length; }
      }
      toast(n ? `คัดลอกเวรจากสัปดาห์ก่อนแล้ว · ${days.length} วัน ${n} เวร · ตรวจแล้วแก้เฉพาะช่องที่ต่าง` : "สัปดาห์ก่อนไม่มีเวรให้คัดลอก");
      await load();
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  };
  const moveWeek = (n: number) => { const x = new Date(week + "T00:00:00"); x.setDate(x.getDate() + n * 7); setWeek(isoDate(x)); };
  /** วันที่แบบไทย เช่น "5 พ.ย." · ช่วงสัปดาห์ "2 – 8 พ.ย. 2569" (ข้ามเดือน "27 ต.ค. – 2 พ.ย. 2569") */
  const dm = (d: string) => `${Number(d.slice(8, 10))} ${TH_MONTHS[Number(d.slice(5, 7)) - 1]}`;
  const weekRange = (a: string, b: string) => `${a.slice(0, 7) === b.slice(0, 7) ? Number(a.slice(8, 10)) : dm(a)} – ${dm(b)} ${Number(b.slice(0, 4)) + 543}`;
  const DAY_FULL = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"];
  // โทรศัพท์: ตาราง 7 วันกว้างเกินจอ (เห็นแค่ 2 วัน) → แถบเลือกวัน + เวรของวันนั้นเป็นรายการ · ปุ่มและเมนูเดียวกับตาราง
  const mD = weekDays.includes(mDay) ? mDay : weekDays.includes(today) ? today : weekDays[0];
  const mobileWeek = (
    <div className="wk-m">
      <div className="wk-m-days" role="tablist" aria-label="เลือกวัน">
        {weekDays.map((x, j) => <button key={x} type="button" role="tab" aria-selected={x === mD} className={`${x === mD ? "is-on" : ""} ${x === today ? "is-today" : ""} ${x < today ? "is-past" : ""}`} onClick={() => setMDay(x)}>
          <small>{WEEKDAYS[j]}</small><b>{Number(x.slice(8, 10))}</b></button>)}
      </div>
      <p className="wk-m-title">{DAY_FULL[weekDays.indexOf(mD)]} {dm(mD)}{mD === today ? " · วันนี้" : ""}</p>
      {SHIFTS.map((sh) => {
        const ids = onShift(mD, sh.key), n = ids.length, open = crew?.d === mD && crew.sh === sh.key, names = team.filter((t) => ids.includes(t.id)).map((t) => shortName(t.name));
        return <div key={sh.key} className={`wk-m-shift ${!n && mD >= today ? "is-gap" : ""}`}>
          <span className="min-w-0"><b>กะ{sh.key}</b> <small>{shiftRange(shStart, sh.key === "ดึก")}</small><small className="wk-m-names">{names.length ? names.join(", ") : "ยังไม่มีคน"}</small></span>
          {mD < today ? <em>{n} คน</em> : <button type="button" className={`wk-covb ${open ? "is-open" : ""}`} aria-haspopup="dialog" aria-expanded={open}
            aria-label={`เลือกพนักงานกะ${sh.key} ${dm(mD)} · ตอนนี้ ${n} คน`} onClick={(e) => (open ? setCrew(null) : openCrew(e, mD, sh.key))}>
            {saving === `cov|${mD}|${sh.key}` ? "…" : n ? `${n} คน` : "ยังไม่มีคน"}<Icon name="plus" className="h-3 w-3" /></button>}
        </div>;
      })}
      <ul className="wk-m-list">
        {ROLE_ORDER.flatMap((r) => shownTeam.filter((t) => t.role === r)).map((t) => {
          const c = cellOf(t.id, mD), k = c.length === 2 ? "dn" : c[0] === "เช้า" ? "d" : c[0] === "ดึก" ? "n" : "o";
          const ins = c.filter((sh) => weekAtt.some((a) => a.staff_id === t.id && a.date === mD && a.shift === sh && a.kind === "in"));
          const missed = c.length > ins.length && due({ date: mD, shift: c[c.length - 1] });
          const open = menu?.id === t.id && menu.d === mD;
          return <li key={t.id}>
            <span className="min-w-0"><b title={t.name}>{shortName(t.name)}</b><small>{ROLE_INFO[t.role as Role]?.th ?? t.role}</small></span>
            <button type="button" className={`wk-c is-${k} ${mD < today ? "is-past" : ""} ${open ? "is-open" : ""}`} disabled={saving === `${t.id}|${mD}`} aria-haspopup="menu" aria-expanded={open}
              aria-label={`${t.name} วันที่ ${Number(mD.slice(8, 10))} ${c.length ? cellText(c) : "ยังไม่ได้จัดกะ"}`} onClick={(e) => (open ? setMenu(null) : openMenu(e, t.id, t.name, mD))}>
              {saving === `${t.id}|${mD}` ? "…" : c.length ? cellText(c) : mD < today ? "–" : "+ จัดกะ"}{ins.length > 0 && <i className="ok" title="เช็คชื่อแล้ว">✓</i>}{missed && <i className="bad" title="ไม่ได้เช็คชื่อ">ขาด</i>}
            </button>
          </li>;
        })}
      </ul>
      {!shownTeam.length && <p className="px-4 py-6 text-center text-sm text-gold-500">ไม่พบพนักงานตามตัวกรอง</p>}
    </div>
  );

  return (
    <>
      <PageHeader title="ตารางเวร" sub={view === "สัปดาห์" ? "กดช่องของพนักงานเพื่อเลือกกะเช้า / กะดึก · กดแถว กะเช้า / กะดึก ด้านบน เพื่อเลือกหลายคนพร้อมกัน" : "กดวันที่เพื่อจัดกะหรือดูการเช็คชื่อ"}
        actions={<>
          <Tabs tabs={["สัปดาห์", "ทั้งเดือน"]} value={view} onChange={(v) => setView(v as "สัปดาห์" | "ทั้งเดือน")} />
          {canSetShift && data?.branch && <button type="button" className="btn-soft" onClick={() => setShiftDlg({ d: hm(shStart.d), n: hm(shStart.n) })}><Icon name="clock" className="h-4 w-4" /> ตั้งเวลากะ <small className="text-gold-500">{hm(shStart.d)} / {hm(shStart.n)}</small></button>}
          <MenuButton label="ส่งออก CSV" icon={<CsvIcon />} items={[
            { label: "ตารางเวรของเดือน", hint: "เวลาเช็คชื่อ สาย ขาด", onClick: exportShifts },
            { label: "สรุปการมาทำงานรายคน", onClick: exportReport },
          ]} />
        </>} />
      {isGlobal && (
        <div className="mb-4 max-w-xs">
          <Select aria-label="เลือกสาขา" options={branches} value={branch} onChange={setBranch} />
        </div>
      )}
      {view === "สัปดาห์" && <Section title={`สัปดาห์ ${weekRange(weekDays[0], weekDays[6])}${data?.branch ? ` · สาขา${data.branch}` : ""}`}
        actions={<div className="flex flex-wrap items-center gap-2">
          <button type="button" className="icon-button" aria-label="สัปดาห์ก่อน" onClick={() => moveWeek(-1)}><Icon name="chevron" className="h-4 w-4 rotate-90" /></button>
          <button type="button" className="btn-soft !min-h-0 !py-2" onClick={() => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); setWeek(isoDate(d)); }}>สัปดาห์นี้</button>
          <button type="button" className="icon-button" aria-label="สัปดาห์หน้า" onClick={() => moveWeek(1)}><Icon name="chevron" className="h-4 w-4 -rotate-90" /></button>
          <button type="button" className="btn-primary !min-h-0 !py-2" disabled={busy || weekDays[6] < today} onClick={copyWeek}><Icon name="files" className="h-4 w-4" /> {busy ? "กำลังคัดลอก…" : "คัดลอกสัปดาห์ก่อน"}</button>
        </div>}>
        {error && <p role="alert" className="form-error mb-3"><Icon name="alert" className="h-4 w-4 shrink-0" />{error}</p>}
        {team.length > 0 && <div className="wk-tools">
          <div className="relative min-w-0 flex-1 basis-48">
            <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold-400" />
            <input type="search" value={who} onChange={(e) => setWho(e.target.value)} className="!pl-9" placeholder="ค้นหาชื่อพนักงาน" aria-label="ค้นหาชื่อพนักงาน" />
          </div>
          <label className="wk-only"><input type="checkbox" checked={onlyOn} onChange={(e) => setOnlyOn(e.target.checked)} /> เฉพาะคนที่มีกะสัปดาห์นี้</label>
          <span className="text-sm text-gold-500">{shownTeam.length} จาก {team.length} คน</span>
        </div>}
        {!team.length ? <p className="rounded-xl bg-cream-50 px-4 py-6 text-center text-sm text-gold-600">ยังไม่มีพยาบาลที่ทำงานอยู่ในสาขานี้</p> : <><div className="sm:hidden">{mobileWeek}</div><div className="wk-wrap hidden sm:block">
          <table className="wk">
            <thead>
              <tr><th scope="col">พนักงาน</th>{weekDays.map((d, i) => <th key={d} scope="col" className={d === today ? "is-today" : d < today ? "is-past" : ""}>{DAY_FULL[i]}{d === today && <em>วันนี้</em>}<b>{dm(d)}</b></th>)}<th scope="col">รวม</th></tr>
              {SHIFTS.map((sh) => <tr key={sh.key} className="wk-cov"><th scope="row">กะ{sh.key}<small>{shiftRange(shStart, sh.key === "ดึก")}</small></th>{weekDays.map((d) => {
                const ids = onShift(d, sh.key), n = ids.length, open = crew?.d === d && crew.sh === sh.key, names = team.filter((t) => ids.includes(t.id)).map((t) => shortName(t.name));
                return <td key={d} className={!n && d >= today ? "is-gap" : ""}>{d < today ? (n || "-")
                  : <button type="button" className={`wk-covb ${open ? "is-open" : ""}`} aria-haspopup="dialog" aria-expanded={open} title={names.length ? names.join(", ") : undefined}
                    aria-label={`เลือกพนักงานกะ${sh.key} ${dm(d)} · ตอนนี้ ${n} คน`} onClick={(e) => (open ? setCrew(null) : openCrew(e, d, sh.key))}>
                    {saving === `cov|${d}|${sh.key}` ? "…" : n ? `${n} คน` : "ยังไม่มีคน"}<Icon name="plus" className="h-3 w-3" /></button>}</td>;
              })}<td /></tr>)}
            </thead>
            {groups.map((g) => {
              const shut = folded.includes(g.role);
              return (
                <tbody key={g.role}>
                  <tr className="wk-grp"><th colSpan={9}><button type="button" aria-expanded={!shut} onClick={() => setFolded(shut ? folded.filter((x) => x !== g.role) : [...folded, g.role])}>
                    <Icon name="chevron" className={`h-3.5 w-3.5 transition ${shut ? "-rotate-90" : ""}`} />{g.label} <span>{g.list.length} คน</span></button></th></tr>
                  {!shut && g.list.map((t) => (
                    <tr key={t.id}>
                      <th scope="row" title={t.name}>{shortName(t.name)}</th>
                      {weekDays.map((d) => {
                        const c = cellOf(t.id, d), k = c.length === 2 ? "dn" : c[0] === "เช้า" ? "d" : c[0] === "ดึก" ? "n" : "o";
                        const ins = c.filter((sh) => weekAtt.some((a) => a.staff_id === t.id && a.date === d && a.shift === sh && a.kind === "in"));
                        const missed = c.length > ins.length && due({ date: d, shift: c[c.length - 1] });
                        const open = menu?.id === t.id && menu.d === d;
                        return <td key={d}><button type="button" className={`wk-c is-${k} ${d < today ? "is-past" : ""} ${open ? "is-open" : ""}`} disabled={saving === `${t.id}|${d}`} aria-haspopup="menu" aria-expanded={open}
                          aria-label={`${t.name} วันที่ ${Number(d.slice(8, 10))} ${c.length ? cellText(c) : "ยังไม่ได้จัดกะ"}`} onClick={(e) => (open ? setMenu(null) : openMenu(e, t.id, t.name, d))}>
                          {saving === `${t.id}|${d}` ? "…" : c.length ? cellText(c) : d < today ? "–" : "+"}{ins.length > 0 && <i className="ok" title="เช็คชื่อแล้ว">✓</i>}{missed && <i className="bad" title="ไม่ได้เช็คชื่อ">ขาด</i>}
                        </button></td>;
                      })}
                      <td className="wk-tot">{weekDays.reduce((n, d) => n + cellOf(t.id, d).length, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
          {!shownTeam.length && <p className="px-4 py-6 text-center text-sm text-gold-500">ไม่พบพนักงานตามตัวกรอง</p>}
        </div></>}
        <div className="wk-leg">
          <p><b>สี</b><span><i className="is-d" />กะเช้า {shiftRange(shStart, false)}</span><span><i className="is-n" />กะดึก {shiftRange(shStart, true)}</span><span><i className="is-o" />ช่อง + = ยังไม่ได้จัดกะ</span><span className="is-gapk">ช่องแดงแถวบน = กะนั้นยังไม่มีคน</span></p>
          <p><b>วิธีใช้</b><span>กดช่องของพนักงาน = เลือกกะของคนนั้น</span><span>กดแถว กะเช้า / กะดึก = เลือกหลายคนพร้อมกัน</span><span>✓ = เช็คชื่อเข้างานแล้ว</span><span>ขาด = ถึงเวลาแล้วยังไม่เช็คชื่อ</span></p>
        </div>
        {menu && createPortal(<div ref={menuRef} className="wk-menu" role="menu" aria-label={`เวรของ ${menu.name}`} style={{ left: menu.x, top: menu.y }}>
          <p>{shortName(menu.name)} · {WEEKDAYS[weekDays.indexOf(menu.d)]} {dm(menu.d)}</p>
          {MENU_OPTS.map((o) => {
            const cur = cellOf(menu.id, menu.d), on = cur.length === o.k.length && o.k.every((x) => (cur as string[]).includes(x));
            return <button key={o.t} type="button" role="menuitemradio" aria-checked={on} onClick={() => setCell(menu.id, menu.d, o.k)}><i className={o.c} />{o.t}<small>{o.sub}</small>{on && <b>✓</b>}</button>;
          })}
          <hr />
          <button type="button" role="menuitem" className="is-del" disabled={!cellOf(menu.id, menu.d).length} onClick={() => setCell(menu.id, menu.d, [])}>เอาออก</button>
        </div>, document.body)}
        {crew && createPortal(<div ref={menuRef} className="wk-menu wk-pick" role="dialog" aria-label={`เลือกพนักงานเวร${crew.sh} ${dm(crew.d)}`} style={{ left: crew.x, top: crew.y }}>
          <p><b>เวร{crew.sh}</b> · {WEEKDAYS[weekDays.indexOf(crew.d)]} {dm(crew.d)}<small>{shiftRange(shStart, crew.sh === "ดึก")}</small></p>
          <ul>{ROLE_ORDER.flatMap((r) => team.filter((t) => t.role === r)).map((t) => {
            const on = crew.sel.includes(t.id), other = SHIFTS.find((x) => x.key !== crew.sh && cellOf(t.id, crew.d).includes(x.key));
            return <li key={t.id}><label className={on ? "is-on" : ""}>
              <input type="checkbox" checked={on} onChange={() => setCrew({ ...crew, sel: on ? crew.sel.filter((x) => x !== t.id) : [...crew.sel, t.id] })} />
              <span>{shortName(t.name)}<small>{ROLE_INFO[t.role as Role]?.th ?? t.role}</small></span>
              {other && <em title={`มีเวร${other.key}วันนี้อยู่แล้ว`}>{on ? "ควบกะ" : `มีเวร${other.key}`}</em>}
            </label></li>;
          })}</ul>
          <div className="wk-pick-f"><span>เลือก {crew.sel.length} คน</span><button type="button" className="btn-soft" onClick={() => setCrew(null)}>ยกเลิก</button><button type="button" className="btn-primary" onClick={saveCrew}>บันทึก</button></div>
        </div>, document.body)}
      </Section>}

      {view === "ทั้งเดือน" && <Section title={`ตารางเวร${data?.branch ? ` · สาขา${data.branch}` : ""}`}
        actions={data && monthDays.length > 0 ? <span className={`rounded-full px-3 py-1 text-sm font-semibold ${gapDays ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}>{gapDays ? `ยังจัดเวรไม่ครบ ${gapDays} วัน` : "จัดเวรครบทุกวันแล้ว"}</span> : undefined}>
        {error && <p role="alert" className="form-error mb-3"><Icon name="alert" className="h-4 w-4 shrink-0" />{error}</p>}
        <RosterCalendar ym={ym} onMonth={setYm} shifts={shifts} attendance={attendance} today={today} selected={day} onDay={openDay} gaps={!!data} start={shStart} />
      </Section>}

      <Section title="สรุปการมาทำงานรายคน" sub="ชื่อสีแดง = ขาด 2 ครั้งขึ้นไปในเดือนนี้">
        {report.length ? <>
        <ul className="grid gap-2 sm:hidden">{report.map((r) => <li key={r.name} className="rounded-xl border border-cream-300 bg-white px-3 py-2.5">
          <div className="flex items-center justify-between gap-2"><b className={r.missed >= 2 ? "text-red-700" : r.missed === 1 ? "text-amber-800" : "text-gold-900"}>{r.name}</b>
            {r.missed > 0 && <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${r.missed >= 2 ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>ขาด {r.missed}</span>}</div>
          <p className="mt-0.5 text-xs leading-relaxed text-gold-600">ถึงเวลาแล้ว {r.due} เวร · ตรงเวลา {r.ontime} · สาย {r.late ? `${r.late} ครั้ง (รวม ${r.lateMin} นาที)` : "-"} · เช็คชื่อนอกตาราง {r.extra || "-"}</p>
        </li>)}</ul>
        <div className="hidden overflow-x-auto rounded-2xl border border-cream-300 sm:block">
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
        </div></> : <p className="rounded-xl bg-cream-50 px-4 py-6 text-center text-sm text-gold-600">ยังไม่มีเวรที่ถึงเวลาเข้างานในเดือนนี้</p>}
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
              <p className="label">{s.label} <small className="text-gold-500">{shiftRange(shStart, s.key === "ดึก")} · {pick[s.key]?.length ?? 0} คน</small></p>
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
      {/* ตั้งเวลากะของสาขา: 2 กะ กะละ 12 ชม. เลือกเวลาเริ่มกะเช้า · กะดึกเริ่มหลังจากนั้น 12 ชม. (lib/shifts) */}
      <Modal open={shiftDlg !== null} title={`ตั้งเวลากะ · สาขา${data?.branch ?? ""}`} onClose={() => setShiftDlg(null)}
        footer={<><button type="button" className="btn-soft" onClick={() => setShiftDlg(null)}>ยกเลิก</button><button type="button" className="btn-primary" disabled={busy || dlgSame || !!dlgErr} onClick={saveShift}>{busy ? "กำลังบันทึก…" : "บันทึกเวลากะ"}</button></>}>
        {shiftDlg && dlgCfg && <div className="space-y-4">
          <p className="form-intro">ทุกสาขามี 2 กะต่อกันครบ 24 ชั่วโมง · ตั้งเวลาเริ่มของแต่ละกะได้เอง (ชั่วโมงและนาที) · กะเช้าจบเมื่อกะดึกเริ่ม กะดึกจบเมื่อกะเช้าวันถัดไปเริ่ม</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div><p className="label">เวลาเริ่มกะเช้า</p><TimeInput value={shiftDlg.d} onChange={(v) => setShiftDlg({ ...shiftDlg, d: v })} /></div>
            <div><p className="label">เวลาเริ่มกะดึก</p><TimeInput value={shiftDlg.n} onChange={(v) => setShiftDlg({ ...shiftDlg, n: v })} /></div>
          </div>
          {dlgErr ? <p role="alert" className="form-error"><Icon name="alert" className="h-4 w-4 shrink-0" />{dlgErr}</p> : <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl bg-cream-50 px-4 py-3"><small className="text-gold-600">กะเช้า · {lenText(shiftLength(dlgCfg, false))}</small><p className="text-lg font-semibold text-gold-900">{shiftRange(dlgCfg, false)}</p></div>
            <div className="rounded-xl bg-cream-50 px-4 py-3"><small className="text-gold-600">กะดึก · {lenText(shiftLength(dlgCfg, true))}</small><p className="text-lg font-semibold text-gold-900">{shiftRange(dlgCfg, true)}</p></div>
          </div>}
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">ใช้ทันทีกับทั้งสาขา: เวลาเช็คชื่อเข้างานและการนับสาย · รอบวัดสัญญาณชีพเวรเช้า/ดึก · การตัดวันของงานประจำวันและ KinApp · เวลางานแนะนำตอนมอบหมาย (1 ชม. หลังเริ่มกะ) · งานที่มอบหมายไปแล้วยังอยู่กะเดิม</p>
        </div>}
      </Modal>
    </>
  );
}
