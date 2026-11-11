"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable, PageHeader, Section, Select, Tabs } from "@/components/ui";
import CsvIcon from "@/components/CsvIcon";
import PhysioAssign from "@/components/care/PhysioAssign";
import PhysioHistoryModal from "@/components/care/PhysioHistoryModal";
import PhysioReassign from "@/components/care/PhysioReassign";
import PhysioSlot from "@/components/care/PhysioSlot";
import ResidentProfile from "@/components/care/ResidentProfile";
import PhysioCloseCourse, { CloseTarget } from "@/components/care/PhysioCloseCourse";
import { teamOf, teamText, whoOn } from "@/lib/physio";
import { useSession } from "@/lib/session";
import { can } from "@/lib/perms";
import { useBranchNames } from "@/lib/branches";
import { downloadCsv } from "@/lib/store";
import { addMonth, DAY_FULL, DAY_TH, dowOf, leftOf, loadOf, monthCells, monthLabel, onDate, PhysioBoard, PhysioCase, projectDates, payOf, recBy, PayState, schedOf, schedText, TRACK_TEXT, trackRows, TrackRow, TrackStatus, WEEK, weekDates, addDays, dayLabel } from "@/lib/physio";

/**
 * ตารางกายภาพ (เมนูงานดูแล): จ่ายเคสให้นักกายภาพ · ตารางสัปดาห์รายคน · ภาระงาน · ผลงานเดือนนี้
 *  ข้อมูลจาก /api/clinic?op=physio_board · จ่ายเคสได้เมื่อมีสิทธิ์ "จ่ายเคสกายภาพ"
 */
/** ใบแจ้งหนี้ของคอร์ส (คอลัมน์ในตารางเคสทั้งหมด) */
const PAY_SHORT: Record<PayState, string> = { free: "คอร์สฟรี", none: "ยังไม่ออกใบ", open: "ออกใบแล้ว · รอชำระ", paid: "ชำระแล้ว" };

export function Physio() {
  const { user } = useSession();
  const global = user?.role === "Global Admin";
  const canAssign = can(user, "physio.assign");
  const branches = useBranchNames();
  const [branch, setBranch] = useState("");
  const br = global ? branch : user?.branch ?? "";
  const [d, setD] = useState<PhysioBoard | null>(null);
  const [pick, setPick] = useState<PhysioCase | null>(null);
  const [view, setView] = useState("สัปดาห์");
  const [ym, setYm] = useState(() => new Date(Date.now() + 7 * 36e5).toISOString().slice(0, 7));
  const [who, setWho] = useState("");
  /** ติดตามการส่งงาน: ช่วงวัน · นักกายภาพ · สถานะ · ประวัติที่เปิดดู */
  const [trk, setTrk] = useState("สัปดาห์นี้");
  const [trkWho, setTrkWho] = useState("");
  const [trkSt, setTrkSt] = useState("");
  /** กรองตามผู้รับบริการ (ชื่อ) */
  const [trkRes, setTrkRes] = useState("");
  /** โปรไฟล์ผู้รับบริการ (เปิดที่แท็บกายภาพ) */
  const [prof, setProf] = useState<string | null>(null);
  /** ปิดคอร์ส (ผู้จัดการสาขา/ผู้บริหาร) */
  const [closeT, setCloseT] = useState<CloseTarget | null>(null);
  /** ปิดคอร์สได้: ผู้จัดการสาขา ผู้บริหาร ฝ่ายขาย/แคชเชียร์ */
  const boss = can(user, "billing");
  const [hist, setHist] = useState<{ id: string; name: string } | null>(null);
  /** หน้าต่างย้ายเคส (ปุ่มบนหัวหน้า) */
  const [mv, setMv] = useState(false);
  /** นัดเดียว (คนทำแทนเฉพาะวัน) */
  const [slot, setSlot] = useState<{ c: PhysioCase; date: string } | null>(null);
  const load = useCallback(() => {
    fetch(`/api/clinic?op=physio_board${br ? `&branch=${encodeURIComponent(br)}` : ""}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)).then((x) => setD(x ?? { cases: [], therapists: [], today: [], month: [], date: "" })).catch(() => {});
  }, [br]);
  useEffect(() => { load(); }, [load]);

  const cases = useMemo(() => d?.cases ?? [], [d]);
  const today = d?.date ? dowOf(d.date) : -1;
  const doneIds = new Set((d?.today ?? []).map((x) => x.course_id));
  const open = cases.filter((c) => !c.therapist_id);
  const low = cases.filter((c) => leftOf(c) <= 2);
  const unpaid = cases.filter((c) => payOf(c) === "none");
  const tIso = d?.date ?? new Date(Date.now() + 7 * 36e5).toISOString().slice(0, 10);
  const todayPlan = cases.filter((c) => c.therapist_id && onDate(schedOf(c), tIso));
  /** วันจันทร์–อาทิตย์ของสัปดาห์นี้ (ตารางสัปดาห์ใช้วันที่จริง รองรับนัดแบบเลือกวันเอง) */
  const wk = weekDates(tIso);
  // แถวของตาราง = นักกายภาพในสาขา + คนที่มีเคสอยู่แต่ไม่อยู่ในรายชื่อแล้ว (ย้ายสาขา/ลาออก)
  // แถวของตาราง = นักกายภาพของสาขาที่เลือก (ทุกสาขา = ทุกคน) + คนสาขาอื่นที่มาทำเคสที่นี่ + คนที่ไม่อยู่ในทีมแล้วแต่ยังมีเคส
  const withCase = new Set(cases.flatMap((c) => teamOf(c).map((t) => t.id)));
  const rows = [...(d?.therapists ?? []).filter((t) => !br || t.branch === br || withCase.has(t.id)).map((t) => ({ id: t.id, name: br && t.branch !== br ? `${t.name} · 📍${t.branch}` : t.name, branch: t.branch })),
    ...[...new Map(cases.filter((c) => c.therapist_id && !d?.therapists.some((t) => t.id === c.therapist_id)).map((c) => [c.therapist_id!, { id: c.therapist_id!, name: `${c.therapist_name} (ไม่อยู่ในทีมแล้ว)`, branch: c.branch_name }])).values()]];
  // ตารางสัปดาห์: นัดพร้อมสถานะจริง (ทำแล้ว / ไม่ได้ทำ / รอทำ / นัดไว้) ของแต่ละนักกายภาพ
  const wkRows = d ? trackRows(d, wk[0], wk[6]) : [];
  const cell = (tid: string, date: string) => wkRows.filter((x) => x.therapistId === tid && x.date === date);
  /** รหัสผู้รับบริการของแถวติดตาม (จากคอร์ส · คอร์สที่ครบแล้วเทียบชื่อ) */
  const residentOf = (x: TrackRow) => cases.find((c) => c.id === x.caseId)?.resident_id ?? cases.find((c) => c.resident_name === x.resident)?.resident_id ?? null;
  const openRow = (x: TrackRow) => {
    const c = cases.find((k) => k.id === x.caseId);
    if (["done", "noRecord"].includes(x.status) && x.caseId) return setHist({ id: x.caseId, name: x.resident });
    // นัดวันนี้/ข้างหน้าที่ยังไม่ทำ = หน้าต่างนัดเดียว (ให้คนอื่นทำแทนเฉพาะวันนั้น) · นัดที่ผ่านไปแล้ว = แผนทั้งคอร์ส
    if (c && canAssign) { if (x.date >= (d?.date ?? "")) setSlot({ c, date: x.date }); else setPick(c); }
  };
  // เดือน: วันนัดที่เหลือของทุกคอร์สตามแผน (เริ่มวันนี้ · บันทึกวันนี้แล้วเริ่มพรุ่งนี้) + ที่บันทึกแล้ววันนี้
  const todayIso = d?.date ?? new Date(Date.now() + 7 * 36e5).toISOString().slice(0, 10);
  const byDay = useMemo(() => {
    const m = new Map<string, { c: PhysioCase; n: number; done?: boolean }[]>();
    const put = (date: string, x: { c: PhysioCase; n: number; done?: boolean }) => m.set(date, [...(m.get(date) ?? []), x]);
    // ทำแล้ววันนี้ = ของคนที่ทำจริง · นัดที่เหลือ = ของผู้รับผิดชอบปัจจุบัน
    const doneBy = new Map((d?.log ?? []).filter((r) => r.date === todayIso && r.course_id).map((r) => [r.course_id!, d ? recBy(d, r) : null]));
    for (const c of cases) {
      if (!c.therapist_id) continue;
      if (doneIds.has(c.id) && (!who || doneBy.get(c.id) === who)) put(todayIso, { c, n: c.used, done: true });
      for (const p of projectDates(c, todayIso, doneIds.has(c.id))) if (!who || whoOn(c, p.date)?.id === who) put(p.date, { c, n: p.n });
    }
    m.forEach((l) => l.sort((a, b) => (a.c.plan_time ?? "").localeCompare(b.c.plan_time ?? "")));
    return m;
  }, [cases, who, todayIso, d]); // eslint-disable-line react-hooks/exhaustive-deps
  /** สถานะเคส (แยกจากใบแจ้งหนี้): ยังไม่มีผู้รับผิดชอบ / ใกล้หมด / อยู่ระหว่างคอร์ส */
  const caseState = (c: PhysioCase) => !c.therapist_id ? "ยังไม่มีผู้รับผิดชอบ" : leftOf(c) <= 2 ? `ใกล้หมด · เหลือ ${leftOf(c)} ครั้ง` : "อยู่ระหว่างคอร์ส";
  const statusOf = (c: PhysioCase) => payOf(c) === "none" ? "ยังไม่ออกใบแจ้งหนี้" : leftOf(c) <= 2 ? `ใกล้หมด (เหลือ ${leftOf(c)})` : !c.therapist_id ? "ยังไม่มีผู้รับผิดชอบ" : "อยู่ระหว่างคอร์ส";

  const exportMonth = () => {
    downloadCsv(`กายภาพ-ผลงานเดือนนี้${br ? `-${br}` : ""}`, ["นักกายภาพ / ผู้บันทึก", "จำนวนครั้งที่บันทึกเดือนนี้", "เคสที่รับผิดชอบ", "ชั่วโมงตามแผนต่อสัปดาห์"],
      [...new Set([...rows.map((r) => r.name), ...(d?.month ?? []).map((m) => m.author)])].map((name) => {
        const r = rows.find((x) => x.name === name), l = r ? loadOf(cases, r.id) : { cases: 0, hours: 0 };
        return [name, String(d?.month.find((m) => m.author === name)?.n ?? 0), String(l.cases), String(l.hours)];
      }));
  };
  const exportCases = () => downloadCsv(`กายภาพ-เคสทั้งหมด${br ? `-${br}` : ""}`, ["ผู้รับบริการ", "สาขา", "ห้อง", "คอร์ส", "ใช้ไป", "ทั้งหมด", "เหลือ", "นักกายภาพ", "วัน", "เวลา", "นาที", "สถานะ"],
    cases.map((c) => [c.resident_name, c.branch_name, c.room ?? "-", c.name, String(c.used), String(c.total), String(leftOf(c)), c.therapist_name ?? "-", schedText(c) || "-", c.plan_time ?? "-", String(c.plan_minutes ?? "-"), statusOf(c)]));

  return (
    <>
      <PageHeader title="ตารางกายภาพ" sub={canAssign ? "จ่ายเคสให้นักกายภาพ · กดเคสในตารางเพื่อเปลี่ยนคน วัน หรือเวลา" : "เคสและตารางของนักกายภาพ"}
        actions={<>
          {canAssign && <button className="btn-soft" title="ย้ายเคสทั้งหมดของนักกายภาพคนหนึ่งไปให้อีกคน (ลา ลาออก ย้ายสาขา)" onClick={() => setMv(true)}>⇄ ย้ายเคส</button>}
          <button className="btn-soft" onClick={exportCases}><CsvIcon /> เคสทั้งหมด</button>
          <button className="btn-soft" onClick={exportMonth}><CsvIcon /> ผลงานเดือนนี้</button>
        </>} />
      {global && <div className="mb-4 max-w-xs"><Select aria-label="เลือกสาขา" placeholder="ทุกสาขา" options={branches} value={branch} onChange={setBranch} /></div>}
      {!d ? <p className="py-10 text-center text-sm text-gold-500">กำลังโหลด…</p> : <div className="space-y-5">
        <div className="pt-stats">
          <div className={open.length ? "is-warn" : ""}><b>{open.length}</b><span>เคสยังไม่มีผู้รับผิดชอบ</span></div>
          <div className={low.length ? "is-warn" : ""}><b>{low.length}</b><span>คอร์สใกล้หมด (เหลือ ≤ 2) · แจ้งญาติ</span></div>
          <div className={unpaid.length ? "is-warn" : ""}><b>{unpaid.length}</b><span>คอร์สที่แคชเชียร์ยังไม่ออกใบแจ้งหนี้ · ทำได้แล้ว</span></div>
          <div className="is-good"><b>{d.today.length}<small> / {todayPlan.length}</small></b><span>ทำแล้ววันนี้ / ตามแผนวัน{DAY_FULL[today] ?? ""}</span></div>
        </div>

        {open.length > 0 && <Section title={`ยังไม่มีผู้รับผิดชอบ (${open.length})`} sub={canAssign ? "เลือกนักกายภาพ วัน และเวลา" : "รอผู้จัดการหรือฝ่ายขายจ่ายเคส"}>
          <ul className="pt-open">{open.map((c) => (
            <li key={c.id}>
              <span><b>{c.resident_name}</b><small>{c.name} · เหลือ {leftOf(c)}/{c.total}{c.room ? ` · ห้อง ${c.room}` : ""}{!br ? ` · ${c.branch_name}` : ""}{payOf(c) === "none" ? " · ยังไม่ออกใบแจ้งหนี้" : ""}</small></span>
              {canAssign && <button className="btn-primary !min-h-0 shrink-0 whitespace-nowrap !py-1.5" onClick={() => setPick(c)}>จ่ายเคส</button>}
            </li>
          ))}</ul>
        </Section>}

        <Section title={view === "เดือน" ? `ตารางเดือน ${monthLabel(ym)}` : "ตารางสัปดาห์"} sub={view === "เดือน" ? "วันนัดที่เหลือของทุกคอร์สตามแผน จนครบจำนวนครั้ง · ✓ = บันทึกแล้ววันนี้" : "แผนประจำของแต่ละคอร์ส · ✓ = บันทึกแล้ววันนี้"}
          actions={<Tabs tabs={["สัปดาห์", "เดือน"]} value={view} onChange={setView} />}>
          {view === "เดือน" ? <>
            <div className="pt-mhead">
              <button type="button" className="icon-button" aria-label="เดือนก่อน" onClick={() => setYm(addMonth(ym, -1))}>‹</button>
              <button type="button" className="btn-soft !min-h-0 !py-1.5" onClick={() => setYm(todayIso.slice(0, 7))}>เดือนนี้</button>
              <button type="button" className="icon-button" aria-label="เดือนถัดไป" onClick={() => setYm(addMonth(ym, 1))}>›</button>
              <select aria-label="เลือกนักกายภาพ" value={who} onChange={(e) => setWho(e.target.value)} className="!w-auto"><option value="">นักกายภาพทุกคน</option>{rows.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
            </div>
            <div className="pt-month-grid">
              {WEEK.map((x) => <span key={x} className="pt-mdow">{DAY_FULL[x]}</span>)}
              {monthCells(ym).map((day, k) => {
                if (!day) return <span key={k} className="pt-mday is-blank" />;
                const list = byDay.get(day) ?? [];
                return (
                  <div key={day} className={`pt-mday ${day === todayIso ? "is-today" : ""} ${day < todayIso ? "is-past" : ""}`}>
                    <span className="pt-mnum">{Number(day.slice(8, 10))}{list.length > 0 && <small>{list.length} ครั้ง</small>}</span>
                    {list.slice(0, 4).map(({ c, n, done }) => (
                      <button key={c.id} type="button" className={`pt-chip ${done ? "is-done" : ""}`} disabled={!canAssign} title={`${c.plan_time} ${c.resident_name} · ครั้งที่ ${n}/${c.total} · ${whoOn(c, day)?.name ?? "-"}`} onClick={() => (done ? setHist({ id: c.id, name: c.resident_name }) : setSlot({ c, date: day }))}>
                        <b>{c.plan_time}</b>{c.resident_name.replace(/^(คุณ|นาย|นางสาว|นาง)\s*/, "")}{done ? " ✓" : ""}
                      </button>
                    ))}
                    {list.length > 4 && <span className="pt-more">อีก {list.length - 4} เคส</span>}
                  </div>
                );
              })}
            </div>
          </> : rows.length === 0 ? <p className="rounded-xl bg-cream-50 px-4 py-6 text-center text-sm text-gold-600">ยังไม่มีบัญชีนักกายภาพ{br ? `ในสาขา${br}` : ""} · สร้างบัญชีตำแหน่ง "นักกายภาพบำบัด" ที่เมนูทีมและสิทธิ์การใช้งาน</p> : (
            <div className="pt-week-wrap"><table className="pt-week">
              <thead><tr><th scope="col">นักกายภาพ</th>{wk.map((dt) => <th key={dt} scope="col" className={dt === tIso ? "is-today" : ""}>{DAY_TH[dowOf(dt)]} {Number(dt.slice(8, 10))}</th>)}</tr></thead>
              <tbody>{rows.map((r) => {
                const l = loadOf(cases, r.id);
                return (
                  <tr key={r.id}>
                    <th scope="row"><b>{r.name}</b><small>{l.cases} เคส · {l.hours} ชม.{!br ? ` · ${r.branch}` : ""}</small></th>
                    {wk.map((dt) => (
                      <td key={dt} className={dt === tIso ? "is-today" : ""}>{cell(r.id, dt).map((x, k) => (
                        <button key={`${x.caseId}${k}`} type="button" className={`pt-chip is-${x.status}`} title={`${x.resident} · ${TRACK_TEXT[x.status]}${x.author ? ` · ${x.author} ${x.at}` : ""}`} onClick={() => openRow(x)}>
                          <b>{x.time}</b>{x.resident.replace(/^(คุณ|นาย|นางสาว|นาง)\s*/, "")}{x.status === "done" ? " ✓" : x.status === "missed" ? " ✗" : x.status === "noRecord" ? " !" : ""}
                        </button>
                      ))}</td>
                    ))}
                  </tr>
                );
              })}</tbody>
            </table></div>
          )}
        </Section>

        {(() => {
          // ติดตามการส่งงาน: นัดทุกนัดในช่วงที่เลือก พร้อมสถานะ · กดดูสิ่งที่บันทึกได้
          const range = trk === "วันนี้" ? [tIso, tIso] : trk === "สัปดาห์ก่อน" ? [addDays(wk[0], -7), addDays(wk[0], -1)] : trk === "30 วันล่าสุด" ? [addDays(tIso, -29), tIso] : [wk[0], wk[6]];
          const inRange = trackRows(d, range[0], range[1]);
          const resNames = [...new Set(inRange.map((x) => x.resident))].sort((a, b) => a.localeCompare(b, "th"));
          const all = inRange.filter((x) => (!trkWho || x.therapistId === trkWho) && (!trkRes || x.resident === trkRes));
          const list = all.filter((x) => !trkSt || x.status === trkSt);
          // ที่ถึงกำหนด = ทำแล้ว + ไม่ได้ทำ + เช็คอินไม่บันทึก (ไม่นับนัดวันนี้ที่ยังรอทำ และนัดข้างหน้า)
          const due = all.filter((x) => x.status === "done" || x.status === "missed" || x.status === "noRecord");
          const doneN = due.filter((x) => x.status === "done").length, missN = due.filter((x) => x.status === "missed" || x.status === "noRecord").length;
          const pct = due.length ? Math.round((doneN / due.length) * 100) : null;
          const exportTrack = () => downloadCsv(`กายภาพ-ติดตามการส่งงาน-${range[0]}-ถึง-${range[1]}${br ? `-${br}` : ""}`, ["วันที่", "เวลานัด/บันทึก", "ผู้รับบริการ", "นักกายภาพ", "สถานะ", "ผู้บันทึก", "เวลาเช็คอิน/บันทึก"],
            list.map((x) => [x.date, x.time, x.resident, x.therapist, TRACK_TEXT[x.status], x.author ?? "", x.at ?? ""]));
          return (
            <Section title="ติดตามการส่งงาน" sub="นัดตามแผนเทียบกับที่บันทึกจริง · นับ “ไม่ได้ทำ” ตั้งแต่วันที่จ่ายเคสหรือแก้แผนล่าสุด"
              actions={<><Tabs tabs={["วันนี้", "สัปดาห์นี้", "สัปดาห์ก่อน", "30 วันล่าสุด"]} value={trk} onChange={setTrk} /><button className="btn-soft" onClick={exportTrack}><CsvIcon /> ส่งออก</button></>}>
              <div className="pt-trk-sum">
                <span><b>{due.length}</b> นัดที่ถึงกำหนด</span>
                <span className="is-done"><b>{doneN}</b> ทำแล้ว</span>
                <span className={missN ? "is-miss" : ""}><b>{missN}</b> ไม่ได้ทำ / ไม่บันทึก</span>
                <span><b>{pct === null ? "-" : `${pct}%`}</b> ทำตามนัด</span>
                <select aria-label="นักกายภาพ" value={trkWho} onChange={(e) => setTrkWho(e.target.value)} className="!w-auto"><option value="">นักกายภาพทุกคน</option>{rows.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>
                <select aria-label="ผู้รับบริการ" value={trkRes} onChange={(e) => setTrkRes(e.target.value)} className="!w-auto"><option value="">ผู้รับบริการทุกคน</option>{resNames.map((n) => <option key={n} value={n}>{n}</option>)}</select>
                <select aria-label="สถานะ" value={trkSt} onChange={(e) => setTrkSt(e.target.value)} className="!w-auto"><option value="">ทุกสถานะ</option>{(Object.keys(TRACK_TEXT) as TrackStatus[]).map((k) => <option key={k} value={k}>{TRACK_TEXT[k]}</option>)}</select>
              </div>
              <DataTable search={false} columns={["วันที่", "เวลา", "ผู้รับบริการ", "นักกายภาพ", "สถานะ", "ผู้บันทึก"]}
                rows={list.map((x) => [dayLabel(x.date), x.time || "-", x.resident, x.therapist, x.status, x.author ? `${x.author} · ${x.at}` : x.status === "noRecord" ? `เช็คอิน ${x.at}` : "-"])}
                render={(k, col, value) => (col === 4 ? <span className={`pt-st is-${value}`}>{TRACK_TEXT[value as TrackStatus]}</span>
                  : col === 2 && residentOf(list[k]) ? <button type="button" className="pt-reslink" title="ดูข้อมูลผู้รับบริการ (แท็บกายภาพ)" onClick={() => setProf(residentOf(list[k]))}>{value}</button> : undefined)}
                actions={[{ label: "ดูรายละเอียด", hidden: (k) => !list[k].caseId || !["done", "noRecord"].includes(list[k].status), onClick: (k) => setHist({ id: list[k].caseId!, name: list[k].resident }) },
                  { label: "ข้อมูลผู้รับบริการ", more: true, hidden: (k) => !residentOf(list[k]), onClick: (k) => setProf(residentOf(list[k])) }]}
                empty="ไม่มีนัดในช่วงนี้" />
            </Section>
          );
        })()}

        <Section title={`เคสทั้งหมด (${cases.length})`} sub="คอร์สที่ยังเหลือครั้ง">
          <DataTable columns={["ผู้รับบริการ", "ห้อง", "คอร์ส", "ใช้ไป", "นักกายภาพ", "วัน · เวลา", "ใบแจ้งหนี้", "สถานะเคส"]}
            rows={cases.map((c) => [c.resident_name, c.room ?? "-", c.name, `${c.used}/${c.total}`, teamText(c) || "-", c.plan_time ? `${schedText(c)} ${c.plan_time} (${c.plan_minutes ?? 45} น.)` : "-", payOf(c), caseState(c)])}
            render={(row, col, value) => col === 0 ? <button type="button" className="pt-reslink" title="ดูข้อมูลผู้รับบริการ (แท็บกายภาพ)" onClick={() => setProf(cases[row].resident_id)}>{value}</button>
              : col === 6 ? <span className={`pt-pay is-${value}`}>{value === "paid" ? "✓ " : ""}{PAY_SHORT[value as PayState]}</span>
              : col === 7 ? <span className={`pt-st is-${!cases[row].therapist_id ? "noRecord" : leftOf(cases[row]) <= 2 ? "todo" : "done"}`}>{value}</span> : undefined}
            actions={[{ label: "ประวัติ", hidden: (k) => cases[k].used === 0, onClick: (k) => setHist({ id: cases[k].id, name: cases[k].resident_name }) },
              { label: "ข้อมูลผู้รับบริการ", more: true, onClick: (k) => setProf(cases[k].resident_id) },
              ...(boss ? [{ label: "ปิดคอร์ส (ไม่ทำต่อ)", more: true, danger: true, hidden: (k: number) => cases[k].used === 0, onClick: (k: number) => { const c = cases[k]; setCloseT({ id: c.id, name: c.name, used: c.used, total: c.total, resident: c.resident_name, billed: c.billed, team: teamText(c) || undefined }); } }] : []), ...(canAssign ? [{ label: "จ่ายเคส", onClick: (k: number) => setPick(cases[k]) }] : [])]} empty="ยังไม่มีคอร์สกายภาพที่ใช้ได้" />
        </Section>

        <Section title="ผลงานเดือนนี้" sub="จำนวนครั้งที่บันทึกกายภาพ (ตัดคอร์ส) แยกตามผู้บันทึก">
          {d.month.length === 0 ? <p className="rounded-xl bg-cream-50 px-4 py-6 text-center text-sm text-gold-600">ยังไม่มีบันทึกกายภาพเดือนนี้</p> : (
            <ul className="pt-month">{d.month.map((m) => <li key={m.author}><span>{m.author}</span><b>{m.n}</b><small>ครั้ง</small></li>)}</ul>
          )}
        </Section>
      </div>}
      <PhysioCloseCourse target={closeT} onClose={() => setCloseT(null)} onDone={load} />
      <ResidentProfile id={prof} initialTab="กายภาพ" onClose={() => { setProf(null); load(); }} />
      <PhysioHistoryModal courseId={hist?.id ?? null} title={hist?.name ?? ""} onClose={() => setHist(null)} />
      <PhysioSlot target={slot} cases={cases} therapists={d?.therapists ?? []} today={todayIso} doneToday={!!slot && doneIds.has(slot.c.id)} onClose={() => setSlot(null)} onSaved={load} onEditPlan={(c) => setPick(c)} />
      <PhysioReassign open={mv} cases={cases} therapists={d?.therapists ?? []} branch={br} onClose={() => setMv(false)} onSaved={load} />
      <PhysioAssign c={pick} cases={cases} therapists={d?.therapists ?? []} today={todayIso} doneToday={!!pick && doneIds.has(pick.id)} onClose={() => setPick(null)} onSaved={load} />
    </>
  );
}
