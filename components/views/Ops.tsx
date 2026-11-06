"use client";
import Occupancy from "../care/Occupancy";
import CsvIcon from "@/components/CsvIcon";
import CourseSummary from "../care/CourseSummary";
import FinanceAnalytics, { FinSummary } from "../care/FinanceAnalytics";
import { AttentionStrip, buildTodos } from "../dash/Todo";
import { CareTrend, deltaOf, deltaText, monTh, vsLabel, ExecReportBody, finKpis, FlowTab, HealthTab, Insights, Kpi, KpiGrid, OccupancyTrend, pctOf, TargetsDialog, targetOf, TeamTab, useTargets } from "../dash/Insights";
import VitalsView from "../care/VitalsView";
import { can } from "@/lib/perms";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useBranchNames } from "@/lib/branches";
import Icon from "../Icon";
import { APPOINTMENTS, DOCS, HEALTH, RESIDENTS } from "@/lib/mock";
import { ApptSlip, DocFoot, DocHead, longDate, Paper, PrintModal } from "../print/Docs";
import { docDate } from "@/lib/billing";
import { useBranchInfo } from "./Billing";
import { downloadCsv, useCrud } from "@/lib/store";
import { useApp } from "@/lib/app";
import ResidentProfile from "../care/ResidentProfile";
import VitalsDialog from "../care/VitalsDialog";
import { fetchNurses, useResidents } from "@/lib/care";
import { useSession } from "@/lib/session";
import { staying } from "@/lib/rooms";
import { apptIso, apptKey, apptTh, nowTh } from "@/lib/appointments";
import { evaluateVitals, implausible, Level, LEVEL_TH, levelOf, parseVitals, Vitals } from "@/lib/vitals";
import { BlankForm, DataTable, Field, FieldDef, FormDialog, MenuButton, Modal, PageHeader, Section, Select, Tabs } from "../ui";
import SalesByCategory from "../dash/SalesByCategory";
import KpiCharts, { CountKpi, PctKpi } from "../dash/KpiCharts";

/* ---------- ภาพรวมและรายงาน (ข้อมูลจริงจาก /api/ops) ---------- */
type DashBranch = { branch: string; total: number; done: number; checked: number; donePct: number; checkPct: number; mstars: number | null; famStars: number | null; famN: number; satPct: number | null; satN: number; complaints: number; residents: number; perResident: number; score: number };
type DashShift = { shift: string; total: number; done: number; checked: number; staff: number; active: number; names: string[] };
type DashAct = { id: string; who: string; task: string; resident: string; branch: string; at: string | null; date: string; praised: boolean };
type Dash = { range: string; from: string; to: string; branches: DashBranch[]; shifts: DashShift[]; activity: DashAct[] };
const KPI_COLS = ["สาขา", "งานที่สั่ง", "% สำเร็จ", "% ตรวจงาน", "ดาวญาติ", "งาน/ผู้รับบริการ", "% ความพึงพอใจ", "คอมเพลน", "คะแนนรวม"];
const stars = (v: number | null, n?: number) => (v === null ? "-" : `${v.toFixed(1)}${n ? ` (${n})` : ""}`);

/** ช่วงเวลาที่เลือก + ช่วงเปรียบเทียบ (วันนี้ ↔ เมื่อวาน · เดือนนี้ ↔ ช่วงเดียวกันของเดือนก่อน · เดือนเต็ม ↔ เดือนก่อนหน้า) */
type Period = "today" | "month" | "prev" | "pick";
const PERIODS: { k: Period; t: string }[] = [{ k: "today", t: "วันนี้" }, { k: "month", t: "เดือนนี้" }, { k: "prev", t: "เดือนก่อน" }, { k: "pick", t: "เลือกเดือน" }];
const TH_MONTH = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
function rangeOf(p: Period, pick: string) {
  const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
  const dim = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const now = new Date(Date.now() + 7 * 3600e3), today = now.toISOString().slice(0, 10);
  const Y = now.getUTCFullYear(), M = now.getUTCMonth(), D = now.getUTCDate();
  const mName = (y: number, m: number) => { const d = new Date(Date.UTC(y, m, 1)); return `${TH_MONTH[d.getUTCMonth()]} ${d.getUTCFullYear() + 543}`; };
  // ช่วงวันที่แบบสั้น: "1–5 พ.ย. 69" · "5 พ.ย. 69"
  const SH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
  const sd = (s: string) => ({ d: Number(s.slice(8, 10)), m: `${SH[Number(s.slice(5, 7)) - 1]} ${String(Number(s.slice(0, 4)) + 543).slice(2)}` });
  const span = (a: string, b: string) => { const x = sd(a), z = sd(b); return a === b ? `${x.d} ${x.m}` : x.m === z.m ? `${x.d}–${z.d} ${z.m}` : `${x.d} ${x.m} – ${z.d} ${z.m}`; };
  /** ข้อความใต้ตัวเลือกช่วงเวลา: ตัวเลขในหน้านี้มาจากช่วงไหน และ ▲▼ เทียบกับช่วงไหน */
  const cap = (from: string, to: string, pfrom: string, pto: string, same = false) => `ข้อมูล ${span(from, to)} · เทียบกับ ${span(pfrom, pto)}${same ? " (จำนวนวันเท่ากัน)" : ""}`;
  if (p === "today") { const y = new Date(Date.parse(today) - 864e5).toISOString().slice(0, 10); return { from: today, to: today, pfrom: y, pto: y, label: `ข้อมูลวันนี้ ${span(today, today)} · เทียบกับเมื่อวาน ${span(y, y)}`, title: `ประจำวันที่ ${D} ${mName(Y, M)}` }; }
  if (p === "month") { const pfrom = iso(Y, M - 1, 1), pto = iso(Y, M - 1, Math.min(D, dim(Y, M - 1))); return { from: iso(Y, M, 1), to: today, pfrom, pto, label: cap(iso(Y, M, 1), today, pfrom, pto, true), title: `ประจำเดือน${mName(Y, M)} (ถึงวันที่ ${D})` }; }
  const [py, pm] = p === "prev" ? [Y, M - 1] : pick.split("-").map(Number).map((v, i) => (i ? v - 1 : v));
  const end = iso(py, pm + 1, 0);
  const to = end < today ? end : today;
  return { from: iso(py, pm, 1), to, pfrom: iso(py, pm - 1, 1), pto: iso(py, pm, 0), label: cap(iso(py, pm, 1), to, iso(py, pm - 1, 1), iso(py, pm, 0)), title: `ประจำเดือน${mName(py, pm)}` };
}

export function Dashboard() {
  const branchNames = useBranchNames();
  const { user } = useSession();
  const { toast, go } = useApp();
  const fin = can(user, "billing");
  // ยอดขายตามหมวด: ผู้บริหาร (ทุกสาขา) และผู้จัดการสาขา (สาขาตัวเอง) เสมอ · ตำแหน่งอื่นตามสิทธิ์การเงิน
  const sales = fin || user?.role === "Global Admin" || user?.role === "Branch Admin";
  // แยกดูทีละหมวด · หมวดการเงินเฉพาะผู้มีสิทธิ์การเงิน
  const DASH_TABS = ["ตัวชี้วัดหลัก", ...(fin ? ["การเงิน"] : []), ...(sales ? ["ยอดขายตามหมวด"] : []), "การเข้าพัก", "สุขภาพผู้รับบริการ", "คุณภาพการดูแล", "ทีมงาน", "รับเข้า-จำหน่าย", "กายภาพ"];
  const [view, setView] = useState("ตัวชี้วัดหลัก");
  const [period, setPeriod] = useState<Period>("month");
  const [pick, setPick] = useState(() => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7));
  const R = rangeOf(period, pick);
  // ชื่อช่วงที่เอามาเทียบ แสดงในทุกการ์ด เช่น "▲ 15% จาก 1–4 ต.ค." · "▲ 2 จากเมื่อวาน"
  const vs = vsLabel(R.pfrom, R.pto, period === "today");
  // การเงินเทียบเดือนต่อเดือนเสมอ (เลือก "วันนี้" ก็เทียบเดือนนี้กับเดือนก่อน)
  const finMonth = R.to.slice(0, 7), finPrev = new Date(Date.UTC(Number(finMonth.slice(0, 4)), Number(finMonth.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
  const [shiftBranch, setShiftBranch] = useState("");
  const global = user?.role === "Global Admin";
  const scopeBranch = global ? shiftBranch : user?.branch ?? "";
  const { targets: T, store, reload } = useTargets(scopeBranch);
  const [tgOpen, setTgOpen] = useState(false);
  const canTarget = global || user?.role === "Branch Admin";
  const [d, setD] = useState<Dash | null>(null);
  const [ins, setIns] = useState<Insights | null>(null);
  const [finSum, setFinSum] = useState<FinSummary | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState(false);
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [report, setReport] = useState(false);
  const { residents } = useResidents();
  const [profile, setProfile] = useState<string | null>(null);
  const branchInfo = useBranchInfo();
  const load = useCallback(() => {
    const b: Record<string, string> = shiftBranch ? { branch: shiftBranch } : {};
    const get = (q: Record<string, string>) => fetch(`/api/ops?${new URLSearchParams({ ...q, ...b })}`, { cache: "no-store" }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); return j; });
    get({ op: "dashboard", range: period === "today" ? "today" : "month", from: R.from, to: R.to }).then((j) => { setD(j); setErr(""); }).catch((e) => setErr((e as Error).message || "โหลดข้อมูลไม่สำเร็จ"));
    get({ op: "insights", from: R.from, to: R.to, pfrom: R.pfrom, pto: R.pto }).then(setIns).catch((e) => setErr((e as Error).message || "โหลดข้อมูลไม่สำเร็จ"));
  }, [R.from, R.to, R.pfrom, R.pto, shiftBranch, period]);
  useEffect(() => { load(); const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 60_000); return () => clearInterval(t); }, [load]);

  const sum = (k: "total" | "done" | "checked") => (d?.branches ?? []).reduce((n, b) => n + b[k], 0);
  const total = sum("total"), done = sum("done"), checked = sum("checked");
  const rows = (d?.branches ?? []).map((b) => [b.branch, String(b.total), `${b.donePct}%`, `${b.checkPct}%`, stars(b.famStars, b.famN), String(b.perResident), b.satPct === null ? "-" : `${b.satPct}%`, String(b.complaints), b.score.toFixed(1)]);

  // แถบต้องจัดการ: ชุดเดียวกับการ์ด "สิ่งที่ต้องทำวันนี้" หน้าแรก (components/dash/Todo.tsx)
  const attn = ins ? buildTodos(ins.attention, user) : [];

  // ตัวชี้วัดหน้าภาพรวม (กดแล้วไปแท็บนั้น)
  const kpis: Kpi[] = [];
  // ชุดเดียวกันในรูปกราฟ (แท็บตัวชี้วัดหลัก) · kpis ยังใช้กับส่งออก CSV และรายงานผู้บริหาร
  const pct: PctKpi[] = [], counts: CountKpi[] = [];
  if (ins) {
    const o = ins.occupancy, cap = o.capacity, mi = o.monthly.findIndex((m) => m.month === R.to.slice(0, 7));
    const occ = cap && mi >= 0 ? Math.round((o.monthly[mi].people / cap) * 100) : null, occP = cap && mi > 0 ? Math.round((o.monthly[mi - 1].people / cap) * 100) : null;
    const c = ins.care, tasks = pctOf(c.cur.done, c.cur.total), tasksP = pctOf(c.prev.done, c.prev.total);
    const ontime = pctOf(c.cur.ontime, c.cur.done), ontimeP = pctOf(c.prev.ontime, c.prev.done);
    const h = ins.health, tm = ins.team;
    const shortOf = (sh: { day: string; staff: number }[]) => sh.filter((s) => s.day <= R.to && (!s.staff || tm.residents / s.staff > T.ratio)).length;
    const famN = (d?.branches ?? []).reduce((n, b) => n + b.famN, 0), fam = famN ? (d?.branches ?? []).reduce((n, b) => n + (b.famStars ?? 0) * b.famN, 0) / famN : null;
    kpis.push(
      { key: "occ", label: "อัตราเข้าพัก", value: occ === null ? "-" : `${occ}%`, delta: deltaOf(occ, occP, true, "%", mi > 0 ? `สิ้น ${monTh(o.monthly[mi - 1].month)}` : undefined), target: targetOf(occ, T.occupancy, true, "%"), note: `${o.monthly[mi]?.people ?? 0} จาก ${cap} เตียง`, onClick: () => setView("การเข้าพัก") },
      ...finKpis(finSum, T, () => setView("การเงิน")).slice(0, 2),
      { key: "tasks", label: "งานสำเร็จ", value: tasks === null ? "-" : `${tasks}%`, delta: deltaOf(tasks, tasksP, true, "%"), target: targetOf(tasks, T.tasks, true, "%"), note: `${c.cur.done} จาก ${c.cur.total} งาน`, onClick: () => setView("คุณภาพการดูแล") },
      { key: "ontime", label: "ส่งงานตรงเวลา", value: ontime === null ? "-" : `${ontime}%`, delta: deltaOf(ontime, ontimeP, true, "%"), target: targetOf(ontime, T.ontime, true, "%"), onClick: () => setView("คุณภาพการดูแล") },
      { key: "vit", label: "ค่าผิดปกติ / เฝ้าระวัง", value: `${h.cur.abnormal} ครั้ง`, delta: deltaOf(h.cur.abnormal, h.prev.abnormal, false, " ครั้ง"), target: h.cur.ackMin === null ? undefined : targetOf(h.cur.ackMin, T.ackMin, false, " นาที (รับทราบ)"), onClick: () => setView("สุขภาพผู้รับบริการ") },
      { key: "staff", label: "กะที่ไม่มีคนหรือคนไม่พอ", value: `${shortOf(tm.cur.shifts)} กะ`, delta: deltaOf(shortOf(tm.cur.shifts), shortOf(tm.prev.shifts), false, " กะ"), target: shortOf(tm.cur.shifts) ? { text: "ต้องจัดคนเพิ่ม", tone: "bad" } : { text: "ครบทุกกะ", tone: "ok" }, onClick: () => setView("ทีมงาน") },
      { key: "flow", label: "รับเข้าใหม่", value: `${ins.flow.cur.admits} คน`, delta: deltaOf(ins.flow.cur.admits, ins.flow.prev.admits, true, " คน"), note: `จำหน่าย ${ins.flow.cur.discharges} คน`, onClick: () => setView("รับเข้า-จำหน่าย") },
      { key: "fam", label: "ดาวจากครอบครัว", value: fam === null ? "-" : fam.toFixed(1), note: famN ? `${famN} รีวิว` : "ยังไม่มีรีวิวในช่วงนี้", onClick: () => go("reviews") },
    );
    const meds = pctOf(h.cur.meds.given, h.cur.meds.total), medsP = pctOf(h.prev.meds.given, h.prev.meds.total);
    const dm = (s: string) => `${Number(s.slice(8, 10))}/${Number(s.slice(5, 7))}`;
    pct.push(
      { key: "occ", label: "อัตราเข้าพัก", cur: occ, prev: occP, goal: T.occupancy, trendName: "รายเดือน", note: `${o.monthly[mi]?.people ?? 0} จาก ${cap} เตียง · เป้า ${T.occupancy}%`,
        trend: o.monthly.slice(Math.max(0, mi - 5), mi + 1).map((m) => ({ label: monTh(m.month), v: cap ? Math.round((m.people / cap) * 100) : null })), onOpen: () => setView("การเข้าพัก") },
      ...(finSum ? [{ key: "collect", label: "อัตราเก็บเงินได้", cur: finSum.collect, prev: finSum.collectPrev, goal: T.collect, note: `รับชำระ ÷ ยอดออกใบ · เทียบ ${finSum.prevLabel} · เป้า ${T.collect}%`, onOpen: () => setView("การเงิน") }] : []),
      { key: "tasks", label: "งานสำเร็จ", cur: tasks, prev: tasksP, goal: T.tasks, trendName: "รายสัปดาห์", note: `${c.cur.done} จาก ${c.cur.total} งาน · เป้า ${T.tasks}%`,
        trend: c.weekly.map((w) => ({ label: dm(w.from), v: pctOf(w.done, w.total) })), onOpen: () => setView("คุณภาพการดูแล") },
      { key: "ontime", label: "ส่งงานตรงเวลา", cur: ontime, prev: ontimeP, goal: T.ontime, onOpen: () => setView("คุณภาพการดูแล") },
      { key: "meds", label: "ให้ยาครบตามมื้อ", cur: meds, prev: medsP, goal: T.meds, onOpen: () => setView("สุขภาพผู้รับบริการ") },
    );
    counts.push(
      { key: "vit", label: "ค่าผิดปกติ / เฝ้าระวัง", unit: "ครั้ง", cur: h.cur.abnormal, prev: h.prev.abnormal, higherBetter: false, onOpen: () => setView("สุขภาพผู้รับบริการ") },
      { key: "staff", label: "กะที่ไม่มีคนหรือคนไม่พอ", unit: "กะ", cur: shortOf(tm.cur.shifts), prev: shortOf(tm.prev.shifts), higherBetter: false, onOpen: () => setView("ทีมงาน") },
      { key: "flow", label: "รับเข้าใหม่", unit: "คน", cur: ins.flow.cur.admits, prev: ins.flow.prev.admits, higherBetter: true, onOpen: () => setView("รับเข้า-จำหน่าย") },
      ...(finSum ? [{ key: "paid", label: `รับชำระ ${monTh(finSum.month)}`, unit: "บาท", cur: Math.round(finSum.paid), prev: Math.round(finSum.paidPrev), higherBetter: true, onOpen: () => setView("การเงิน") }] : []),
    );
  }
  const exportOverview = () => {
    const att = attn.map((x) => ["ต้องจัดการ", x.title, `${x.n} ${x.unit}`, "", x.detail]);
    downloadCsv(`ภาพรวมและรายงาน-${scopeBranch || "ทุกสาขา"}-${R.from}-ถึง-${R.to}`, ["หมวด", "ตัวชี้วัด", "ค่า", "เปรียบเทียบ", "เป้าหมาย / รายละเอียด"],
      [...kpis.map((k) => ["ตัวชี้วัด", k.label, k.value, deltaText(k.delta, vs), k.target?.text ?? k.note ?? ""]), ...att]);
  };
  const praise = async (a: DashAct) => {
    try {
      const r = await fetch("/api/ops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "kudos", taskId: a.id }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      toast(`ชื่นชมแล้ว · ${a.who} · ${a.task} · พนักงานเห็นใน KinApp`); load();
    } catch (e) { toast((e as Error).message); }
  };
  const cheer = async () => {
    const branch = global ? to : user?.branch ?? "";
    if (!branch || !text.trim()) return toast("กรุณาเลือกสาขาและพิมพ์ข้อความ");
    try {
      const r = await fetch("/api/ops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "cheer", branch, message: text }) });
      const j = await r.json(); if (!r.ok) throw new Error(j.error);
      setMsg(false); setText(""); toast(`ส่งกำลังใจแล้ว · สาขา${branch} · ทีมเห็นใน KinApp`);
    } catch (e) { toast((e as Error).message); }
  };
  const openResident = (name: string) => { const r = residents.find((x) => x.full_name === name); if (r) setProfile(r.id); else toast("ไม่พบผู้รับบริการชื่อนี้ในทะเบียน"); };

  return (
    <>
      <PageHeader title="ภาพรวมและรายงาน" sub="ตัวเลขจากงานจริง · อัปเดตทุก 1 นาที"
        actions={<>
          {branchNames.length > 1 && <div className="min-w-44"><Select options={branchNames} placeholder="รวมทุกสาขา" value={shiftBranch} onChange={setShiftBranch} /></div>}
          <button className="btn-soft" disabled={!ins} onClick={() => setReport(true)}><Icon name="print" className="h-4 w-4" /> รายงานผู้บริหาร</button>
          {canTarget && <button className="btn-soft" onClick={() => setTgOpen(true)}><Icon name="trophy" className="h-4 w-4" /> ตั้งเป้าหมาย</button>}
          <button className="btn-soft" onClick={() => setMsg(true)}><Icon name="heart" className="h-4 w-4" /> ส่งกำลังใจให้สาขา</button>
        </>} />
      {err && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</p>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="dash-period" role="radiogroup" aria-label="ช่วงเวลา">
          {PERIODS.map((p) => <button key={p.k} type="button" role="radio" aria-checked={period === p.k} className={period === p.k ? "is-on" : ""} onClick={() => setPeriod(p.k)}>{p.t}</button>)}
        </div>
        {period === "pick" && <input type="month" aria-label="เลือกเดือน" className="!w-auto" value={pick} max={new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7)} onChange={(e) => e.target.value && setPick(e.target.value)} />}
        <span className="text-sm text-gold-600">{R.label}</span>
      </div>
      {ins ? <AttentionStrip items={attn} go={go} /> : <p className="mb-4 rounded-xl bg-cream-50 px-4 py-4 text-sm text-gold-600">กำลังโหลดเรื่องที่ต้องจัดการ…</p>}
      <div className="dash-tabs mt-5 flex flex-wrap items-center justify-between gap-3"><Tabs tabs={DASH_TABS} value={view} onChange={setView} />
        {view === "ตัวชี้วัดหลัก" && <button className="btn-soft" disabled={!kpis.length} onClick={exportOverview}><CsvIcon /> ส่งออก CSV</button>}</div>
      {/* สรุปการเงินของเดือนที่เลือก (ใช้ในการ์ดภาพรวมและรายงานผู้บริหาร) */}
      {fin && view !== "การเงิน" && <div hidden><FinanceAnalytics branch={shiftBranch} compact month={finMonth} prevMonth={finPrev} onSummary={setFinSum} /></div>}

      {view === "ตัวชี้วัดหลัก" && <div className="space-y-6">
        {pct.length ? <KpiCharts pct={pct} counts={counts} vs={vs} /> : <p className="rounded-xl bg-cream-50 px-4 py-6 text-sm text-gold-600">กำลังโหลดตัวชี้วัด…</p>}
        <p className="text-xs text-gold-500">กดแถวหรือกล่องเพื่อดูรายละเอียด · สีเขียว = ดีขึ้น · สีแดง = แย่ลง</p>
        <section><h3 className="dash-h">กายภาพ <button className="dash-more" onClick={() => setView("กายภาพ")}>ดูรายละเอียด</button></h3><CourseSummary branch={shiftBranch} compact /></section>
      </div>}

      {view === "การเงิน" && <FinanceAnalytics branch={shiftBranch} month={finMonth} prevMonth={finPrev} onSummary={setFinSum} />}
      {view === "ยอดขายตามหมวด" && <SalesByCategory branch={shiftBranch} month={finMonth} />}
      {view === "การเข้าพัก" && <div className="space-y-6"><Occupancy />{ins && <OccupancyTrend d={ins} t={T} />}</div>}
      {view === "สุขภาพผู้รับบริการ" && (ins ? <HealthTab d={ins} t={T} vs={vs} onResident={openResident} /> : <p className="text-sm text-gold-500">กำลังโหลด…</p>)}
      {view === "ทีมงาน" && (ins ? <TeamTab d={ins} t={T} vs={vs} /> : <p className="text-sm text-gold-500">กำลังโหลด…</p>)}
      {view === "รับเข้า-จำหน่าย" && (ins ? <FlowTab d={ins} vs={vs} /> : <p className="text-sm text-gold-500">กำลังโหลด…</p>)}
      {view === "กายภาพ" && <CourseSummary branch={shiftBranch} />}

      {view === "คุณภาพการดูแล" && <div className="space-y-6">
        {ins && <KpiGrid items={[
          { key: "t", label: "งานสำเร็จ", value: `${pctOf(done, total) ?? 0}%`, delta: deltaOf(pctOf(ins.care.cur.done, ins.care.cur.total), pctOf(ins.care.prev.done, ins.care.prev.total), true, "%"), target: targetOf(pctOf(done, total), T.tasks, true, "%"), note: `${done} จาก ${total} งาน` },
          { key: "o", label: "ส่งงานตรงเวลา", value: `${pctOf(ins.care.cur.ontime, ins.care.cur.done) ?? 0}%`, delta: deltaOf(pctOf(ins.care.cur.ontime, ins.care.cur.done), pctOf(ins.care.prev.ontime, ins.care.prev.done), true, "%"), target: targetOf(pctOf(ins.care.cur.ontime, ins.care.cur.done), T.ontime, true, "%") },
          { key: "c", label: "ตรวจงานแล้ว", value: `${pctOf(checked, done) ?? 0}%`, delta: deltaOf(pctOf(ins.care.cur.checked, ins.care.cur.done), pctOf(ins.care.prev.checked, ins.care.prev.done), true, "%"), note: "งานที่หัวหน้าตรวจแล้ว" },
          { key: "s", label: "ดาวจากหัวหน้า", value: ins.care.cur.stars === null ? "-" : String(ins.care.cur.stars), delta: deltaOf(ins.care.cur.stars, ins.care.prev.stars, true), note: ins.care.cur.low ? `ต่ำกว่า 3 ดาว ${ins.care.cur.low} งาน` : undefined },
        ]} vs={vs} />}
        {ins && <CareTrend d={ins} t={T} />}
        <Section title="คุณภาพการดูแลของแต่ละสาขา" sub={d ? `ข้อมูลตั้งแต่ ${longDate(d.from, true)} ถึง ${longDate(d.to ?? d.from, true)}` : "กำลังโหลด…"}
          actions={<button className="btn-soft" onClick={() => downloadCsv(`KPI-สาขา-${R.from}-ถึง-${R.to}`, KPI_COLS, rows)}><CsvIcon /> ส่งออก CSV</button>}>
          <details className="group mb-5 rounded-xl border border-cream-300 bg-cream-50">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-gold-700">
              วิธีอ่านค่าและคำนวณคะแนน (กดเพื่อดู)
              <Icon name="chevron" className="h-4 w-4 transition group-open:rotate-180" />
            </summary>
            <ul className="space-y-2 border-t border-cream-300 px-4 py-4 text-sm text-gold-700">
              <li><b>% สำเร็จ:</b> งานที่พยาบาลส่งแล้ว หารด้วยงานที่มอบหมายทั้งหมด</li>
              <li><b>% ตรวจงาน:</b> งานที่หัวหน้าตรวจแล้ว หารด้วยงานที่ส่งแล้ว</li>
              <li><b>ดาวญาติ:</b> ดาวเฉลี่ยจากรีวิวพนักงานของครอบครัว (วงเล็บ = จำนวนรีวิว)</li>
              <li><b>งาน/ผู้รับบริการ:</b> งานที่ทำเสร็จ หารด้วยจำนวนผู้รับบริการที่ยังพักอยู่</li>
              <li><b>% ความพึงพอใจ:</b> คะแนนแบบประเมินจากครอบครัว เทียบเต็ม 5</li>
              <li><b>คอมเพลน:</b> เรื่องร้องเรียนในช่วงเวลานี้</li>
              <li className="rounded-lg bg-gold-100 px-3 py-2 font-medium">คะแนนรวม = % สำเร็จ + (% ตรวจงาน × 0.5) + (ดาวญาติ × 10) + (% ความพึงพอใจ × 0.5) − (คอมเพลน × 5)</li>
            </ul>
          </details>
          <DataTable columns={KPI_COLS} rows={rows} empty={d ? "ยังไม่มีข้อมูลในช่วงเวลานี้" : "กำลังโหลด…"} />
        </Section>

        <div className="grid gap-6 xl:grid-cols-2">
          <Section title="งานที่ทีมเพิ่งส่ง" sub="กดชื่นชมเป็นกำลังใจ พนักงานเห็นคำชมใน KinApp">
            {!d?.activity.length ? <p className="rounded-xl bg-cream-50 px-4 py-6 text-center text-sm text-gold-600">ยังไม่มีงานที่ส่งในเมื่อวานและวันนี้</p> :
              <ul className="divide-y divide-cream-300/70 rounded-xl border border-cream-300/70">
                {d.activity.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <span className="min-w-0"><b className="font-medium">{a.who}</b> <span className="text-gold-600">{a.task} · {a.resident}</span><span className="ml-2 text-xs text-gold-500">{a.at ? `${a.at} น.` : ""}{global ? ` · ${a.branch}` : ""}</span></span>
                    <button disabled={a.praised} className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition ${a.praised ? "bg-gold-700 text-white" : "bg-cream-200 text-gold-700 hover:bg-cream-300"}`} onClick={() => praise(a)}>{a.praised ? "ชื่นชมแล้ว" : "ชื่นชม"}</button>
                  </li>
                ))}
              </ul>}
          </Section>

          <Section title="สถานะกะวันนี้" sub="งานของแต่ละกะ และพยาบาลในเวรที่ส่งงานแล้ว" actions={<button className="btn-soft" onClick={() => go("tasks")}>ไปที่มอบหมายและตรวจงาน</button>}>
            <div className="grid gap-4 sm:grid-cols-2">
              {(d?.shifts ?? []).map((s) => {
                const p = s.total ? Math.round((s.done / s.total) * 100) : 0;
                return (
                  <div key={s.shift} className="rounded-2xl border border-cream-300 bg-cream-50 p-4">
                    <p className="mb-3 text-sm font-medium text-gold-800">กะ{s.shift}</p>
                    <div className="flex items-end justify-between text-sm">
                      <div><p className="text-gold-500">สั่งงาน</p><p className="text-lg font-semibold">{s.total}</p></div>
                      <div><p className="text-gold-500">ส่งแล้ว</p><p className="text-lg font-semibold">{s.done}</p></div>
                      <div><p className="text-gold-500">ตรวจแล้ว</p><p className="text-lg font-semibold">{s.checked}</p></div>
                      <p className="text-xl font-semibold text-gold-700">{p}%</p>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-cream-300"><div className="h-full rounded-full bg-gold-600" style={{ width: `${p}%` }} /></div>
                    <p className="mt-3 text-xs text-gold-600">{s.staff ? `พยาบาลในเวร ${s.staff} คน · ส่งงานแล้ว ${s.active} คน` : "ยังไม่ได้จัดเวรกะนี้"}</p>
                  </div>
                );
              })}
            </div>
          </Section>
        </div>
      </div>}

      <TargetsDialog open={tgOpen} onClose={() => setTgOpen(false)} branch={scopeBranch} store={store} onSaved={reload} isGlobal={global} />
      <ResidentProfile id={profile} onClose={() => setProfile(null)} />
      <PrintModal open={report && !!ins} title="รายงานผู้บริหาร" onClose={() => setReport(false)}>
        {ins && <Paper><ExecReportBody title={`รายงานผู้บริหาร ${R.title}`} period={`${scopeBranch ? `สาขา${scopeBranch}` : "ทุกสาขา"} · ${R.label}`} kpis={kpis} attn={attn} d={ins} vs={vs}
          head={<DocHead branch={scopeBranch ? branchInfo(scopeBranch) : undefined} refs={[["ช่วงเวลา", `${longDate(R.from, true)} – ${longDate(R.to, true)}`], ["สาขา", scopeBranch || "ทุกสาขา"]]} />} />
          <DocFoot left={`รายงานผู้บริหาร · ${scopeBranch || "ทุกสาขา"}`} by={user?.name} /></Paper>}
      </PrintModal>
      <Modal open={msg} title="ส่งกำลังใจให้สาขา" onClose={() => setMsg(false)}
        footer={<><button className="btn-soft" onClick={() => setMsg(false)}>ยกเลิก</button><button className="btn-primary" onClick={cheer}>ส่งกำลังใจ</button></>}>
        <div className="space-y-4">
          {global ? <Field label="ส่งถึงสาขา"><Select options={branchNames} placeholder="-- เลือกสาขา --" value={to} onChange={setTo} /></Field> : <p className="text-sm text-gold-700">ส่งถึงทีมสาขา{user?.branch}</p>}
          <Field label="ข้อความ"><textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="เช่น ขอบคุณทีมกะดึกที่ดูแลคุณสมชายอย่างใกล้ชิดเมื่อคืน" /></Field>
          <p className="text-xs text-gold-500">ข้อความขึ้นในแท็บผลงานทีมของ KinApp นาน 7 วัน</p>
        </div>
      </Modal>
    </>
  );
}

/* ---------- ระบบตารางนัดหมาย ---------- */
/** ช่องในฟอร์มนัดหมาย · รายชื่อผู้รับบริการมาจากทะเบียนจริง (เฉพาะคนที่ยังไม่ย้ายออก) */
const apptFields = (names: string[], nurses: string[]): FieldDef[] => [
  { label: "วันที่", type: "date", required: true },
  { label: "เวลา", type: "time", required: true },
  { label: "ผู้รับบริการ", options: names, required: true, pick: "resident" },
  { label: "รายการ", required: true, placeholder: "เช่น พบแพทย์อายุรกรรม รพ.ศิริราช, ทำกายภาพ, ตรวจเลือด" },
  { label: "ผู้ดูแล / ผู้พาไป", suggest: nurses, placeholder: "พิมพ์ค้นหาชื่อพยาบาล หรือพิมพ์เอง เช่น ญาติพาไปเอง" },
  { label: "การเตรียมตัว", placeholder: "เช่น งดน้ำและอาหารหลังเที่ยงคืน นำสมุดยาไปด้วย (พิมพ์ในใบนัด)" },
];
/** ตัวกรองนัดหมาย · สีเดียวกับป้ายในตาราง (วันนี้ = ส้ม · กำลังจะมาถึง = เทา · ผ่านแล้ว = เขียว) */
type ApptPhase = "today" | "soon" | "past";
const APPT_FILTERS: { k: ApptPhase | ""; t: string }[] = [{ k: "", t: "ทั้งหมด" }, { k: "today", t: "วันนี้" }, { k: "soon", t: "กำลังจะมาถึง" }, { k: "past", t: "ผ่านมาแล้ว" }];
const APPT_CLASS: Record<ApptPhase | "", string> = { "": "is-all", today: "is-review", soon: "is-todo", past: "is-done" };

export function Appointments() {
  const { rows, add, update, remove } = useCrud("appointments", APPOINTMENTS);
  const res = useCrud("residents", RESIDENTS);
  const { toast, confirm } = useApp();
  const [dlg, setDlg] = useState<{ mode: "add" | "edit"; i: number } | null>(null);
  const [tab, setTab] = useState<ApptPhase | "">("");
  const [nurses, setNurses] = useState<string[]>([]);
  useEffect(() => { fetchNurses().then(setNurses).catch(() => {}); }, []);
  const { user } = useSession();
  const branchInfo = useBranchInfo();
  const [slip, setSlip] = useState<number | null>(null);
  const active = res.rows.filter((r) => staying(r[5] ?? ""));
  const residentOf = (name: string) => res.rows.find((r) => r[0] === name);
  // คนที่ย้ายออกแล้วแต่มีนัดเดิม ยังแสดงในช่องเลือกตอนแก้ไขนัดนั้น
  const editName = dlg?.mode === "edit" ? rows[dlg.i]?.[2] : undefined;
  const names = [...new Set([...active.map((r) => r[0]), ...(editName ? [editName] : [])])];
  const now = nowTh(), today = now.slice(0, 10);
  const week = new Date(Date.now() + 7 * 3600e3 + 7 * 864e5).toISOString().slice(0, 10);
  const all = rows.map((r, i) => ({ r, i, k: apptKey(r) }));
  const phase = (k: string): ApptPhase => (k < now ? "past" : k.startsWith(today) ? "today" : "soon");
  const count = (p: ApptPhase | "") => all.filter((x) => !p || phase(x.k) === p).length;
  const ORDER: Record<ApptPhase, number> = { today: 0, soon: 1, past: 2 };
  // วันนี้ → กำลังจะมาถึง (ใกล้ก่อน) → ผ่านแล้ว (ล่าสุดก่อน)
  const shown = all.filter((x) => !tab || phase(x.k) === tab)
    .sort((a, b) => ORDER[phase(a.k)] - ORDER[phase(b.k)] || (phase(a.k) === "past" ? b.k.localeCompare(a.k) : a.k.localeCompare(b.k)));
  const statusOf = (k: string) => {
    const p = phase(k);
    if (p === "today") return { t: "วันนี้", c: "status-warning" };
    if (p === "past") return { t: "ผ่านแล้ว", c: "status-success" };
    const d = Math.round((Date.parse(k.slice(0, 10)) - Date.parse(today)) / 864e5);
    return { t: d <= 1 ? "พรุ่งนี้" : `อีก ${d} วัน`, c: "status-neutral" };
  };
  const who = (name: string) => { const p = residentOf(name); return p ? [p[6], p[2] && p[2] !== "-" ? `ห้อง ${p[2]}${p[7] ? ` เตียง ${p[7]}` : ""}` : ""].filter(Boolean).join(" · ") || "-" : "ไม่พบในทะเบียน"; };
  const formValue = useMemo(() => {
    if (!dlg) return undefined;
    if (dlg.mode === "edit") { const r = rows[dlg.i]; return [apptIso(r[0]), (r[1] ?? "").slice(0, 5), r[2], r[3], r[4] === "-" ? "" : r[4], r[5] && r[5] !== "-" ? r[5] : ""]; }
    return [today, "", "", "", "", ""];
  }, [dlg]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = (v: string[]) => {
    if (!v[0] || !v[1]) return toast("กรุณาระบุวันที่และเวลานัด");
    if (!names.includes(v[2])) return toast("กรุณาเลือกผู้รับบริการจากทะเบียน");
    if (!v[3].trim()) return toast("กรุณากรอกรายการนัดหมาย");
    const row = [apptTh(v[0]), v[1], v[2], v[3].trim(), v[4].trim() || "-", (v[5] ?? "").trim() || "-"];
    if (dlg?.mode === "edit") update(dlg.i, row); else add(row);
    const edit = dlg?.mode === "edit"; setDlg(null); toast({ type: edit ? "edit" : "ok", title: edit ? "แก้ไขนัดหมายแล้ว" : "บันทึกนัดหมายแล้ว", detail: `${row[2]} · ${row[0]} ${row[1].slice(0, 5)} น. ${row[3]}` });
  };
  return (
    <div>
      <PageHeader title="ตารางนัดหมาย" sub="นัดแพทย์และธุระของผู้รับบริการ"
        actions={<button className="btn-primary" onClick={() => setDlg({ mode: "add", i: -1 })}><Icon name="plus" className="h-4 w-4" /> เพิ่มนัดหมาย</button>} />
      <Section title="นัดหมายของผู้รับบริการ" actions={<button className="btn-soft" disabled={!shown.length} onClick={() => {
        downloadCsv(`นัดหมาย-${tab ? APPT_FILTERS.find((f) => f.k === tab)?.t : "ทั้งหมด"}-${today}`, ["วันที่", "เวลา", "ผู้รับบริการ", "HN · ห้อง", "รายการ", "ผู้ดูแล", "การเตรียมตัว", "สถานะ"],
          shown.map(({ r, k }) => [r[0], (r[1] ?? "").slice(0, 5), r[2], who(r[2]), r[3], r[4], r[5] && r[5] !== "-" ? r[5] : "", statusOf(k).t]));
        toast(`ส่งออกนัดหมายแล้ว ${shown.length} รายการ`);
      }}><CsvIcon /> ส่งออก CSV</button>}>
        <div className="stat-filter" role="radiogroup" aria-label="กรองนัดหมาย">
          {APPT_FILTERS.map((f) => (
            <button key={f.t} type="button" role="radio" aria-checked={tab === f.k} className={`${APPT_CLASS[f.k]} ${tab === f.k ? "is-on" : ""}`} onClick={() => setTab(f.k)}>
              {f.k && <i aria-hidden />}{f.t} <b>{count(f.k)}</b>
            </button>
          ))}
        </div>
        {!active.length && <p className="mb-4 rounded-xl bg-cream-50 px-4 py-3 text-sm text-gold-600">ยังไม่มีผู้รับบริการในทะเบียน เพิ่มผู้รับบริการ (หรือเปิดสัญญา) ก่อนจึงจะลงนัดหมายได้</p>}
        <DataTable
          columns={["วันที่", "เวลา", "ผู้รับบริการ", "รายการ", "ผู้ดูแล", "สถานะ"]}
          rows={shown.map(({ r, k }) => [r[0], (r[1] ?? "").slice(0, 5), r[2], r[3], r[4], statusOf(k).t])}
          render={(i, col) => {
            if (col === 2) return <span className="block leading-tight"><b className="font-semibold">{shown[i].r[2]}</b><small className="block text-xs text-gold-500">{who(shown[i].r[2])}</small></span>;
            if (col !== 5) return undefined;
            const s = statusOf(shown[i].k); return <span className={`status-badge ${s.c}`}>{s.t}</span>;
          }}
          onRow={(k) => setDlg({ mode: "edit", i: shown[k].i })} rowLabel="กดเพื่อแก้ไขนัดหมาย"
          empty={tab ? `ไม่มีนัดหมายที่${APPT_FILTERS.find((f) => f.k === tab)?.t}` : "ยังไม่มีนัดหมาย · กด \"เพิ่มนัดหมาย\""}
          actions={[
            { label: "ใบนัด", tone: "primary", onClick: (k) => setSlip(shown[k].i) },
            { label: "แก้ไขนัด", more: true, onClick: (k) => setDlg({ mode: "edit", i: shown[k].i }) },
            { label: "ลบนัด", danger: true, more: true, onClick: (k) => confirm({ title: "ลบนัดหมาย", message: `ต้องการลบนัดหมาย "${shown[k].r[3]}" ของ ${shown[k].r[2]} ใช่หรือไม่`, danger: true, okLabel: "ลบ", onOk: () => { const r = shown[k].r; const undo = remove(shown[k].i); toast({ type: "del", title: "ลบนัดหมายแล้ว", detail: `${r[2]} · ${r[0]} ${(r[1] ?? "").slice(0, 5)} ${r[3]}`, action: { label: "เลิกทำ", run: () => { undo(); toast(`กู้คืนนัดหมายแล้ว · ${r[2]}`); } } }); } }) },
          ]}
        />
      </Section>
      <FormDialog
        open={!!dlg} mode={dlg?.mode ?? "add"} title={dlg?.mode === "edit" ? "แก้ไขนัดหมาย" : "เพิ่มนัดหมาย"}
        fields={apptFields(names, nurses)} value={formValue} onClose={() => setDlg(null)} onSave={save}
      />
      <PrintModal open={slip !== null && !!rows[slip]} title="ใบนัดหมาย" onClose={() => setSlip(null)}>
        {slip !== null && rows[slip] && <ApptSlip resident={rows[slip][2]} hn={residentOf(rows[slip][2])?.[6]} date={apptIso(rows[slip][0])} time={(rows[slip][1] ?? "").slice(0, 5)}
          purpose={rows[slip][3]} caregiver={rows[slip][4]} prep={rows[slip][5]} branch={branchInfo(residentOf(rows[slip][2])?.[3] ?? user?.branch ?? "")} by={user?.name} />}
      </PrintModal>
    </div>
  );
}

/* ---------- รายงานสุขภาพ ---------- */
const HEALTH_COLS = ["วัน-เวลา", "ชื่อผู้สูงอายุ", "สัญญาณชีพ (Vital Signs)", "O2 Sat", "DTX", "น้ำหนัก/ส่วนสูง", "ข้อมูลอื่น", "โน้ต / อาการ", "ผู้บันทึก"];
/** ตัวกรองผลประเมิน · สีเดียวกับป้าย (ผิดปกติ = แดง · เฝ้าระวัง = ส้ม · ปกติ = เขียว) */
const LEVEL_FILTERS: { k: Level | ""; t: string; c: string }[] = [
  { k: "", t: "ทั้งหมด", c: "is-all" }, { k: "critical", t: "ผิดปกติ", c: "is-late" }, { k: "watch", t: "เฝ้าระวัง", c: "is-review" }, { k: "normal", t: "ปกติ", c: "is-done" },
];
const hasVal = (x?: string) => !!x && x.trim() !== "" && x.trim() !== "-";
/** สัญญาณชีพแต่ละส่วน ("BP 186/108") ผูกกับค่าที่ใช้ประเมิน */
const partKeys = (p: string): (keyof Vitals)[] => (/^BP/i.test(p) ? ["sys", "dia"] : /^(PR|HR|P)\b/i.test(p) ? ["pr"] : /^RR/i.test(p) ? ["rr"] : /^(BT|T)\b/i.test(p) ? ["bt"] : []);

/** ช่องวันที่ที่ยังว่าง: แสดงคำไทยแทน mm/dd/yyyy ของเบราว์เซอร์ */
function DateBox({ value, label, onChange }: { value: string; label: string; onChange: (v: string) => void }) {
  return (
    <span className="date-box">
      <input type="date" aria-label={label} className={value ? "" : "is-empty"} value={value} onChange={(e) => onChange(e.target.value)} />
      {!value && <span className="date-ph" aria-hidden>{label}</span>}
    </span>
  );
}

export function HealthLogs() {
  const branchNames = useBranchNames();
  const { rows, add } = useCrud("health", HEALTH);
  const { toast } = useApp();
  const { user } = useSession();
  const { residents } = useResidents();
  const [record, setRecord] = useState(false);
  const [profile, setProfile] = useState<string | null>(null);
  const names = residents.map((r) => r.full_name);
  // ตัวกรอง: สาขา (ของผู้รับบริการ) · ผู้รับบริการ · ช่วงวันที่
  const [branch, setBranch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  // ตัวกรองมีผลทันทีที่เลือก
  const [person, setPerson] = useState("");
  const applied = { person, branch, from, to };
  const isoOf = (th: string) => { const m = th.match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${Number(m[3]) - 543}-${m[2]}-${m[1]}` : ""; };
  const branchOf = (name: string) => residents.find((x) => x.full_name === name)?.branch_name ?? "";
  const levelCol = (r: string[]) => LEVEL_TH[levelOf(evaluateVitals(parseVitals(r[2], r[3], r[4])))];
  const [sample, setSample] = useState(false);
  const [view, setView] = useState<number | null>(null);
  const base = rows.filter((r) => {
    const d = isoOf(r[0] ?? "");
    return (!applied.person || r[1] === applied.person) && (!applied.branch || branchOf(r[1]) === applied.branch)
      && (!applied.from || (d && d >= applied.from)) && (!applied.to || (d && d <= applied.to));
  });
  const [lv, setLv] = useState<Level | "">("");
  const levelKey = (r: string[]) => levelOf(evaluateVitals(parseVitals(r[2], r[3], r[4])));
  const lvCount = (k: Level | "") => base.filter((r) => !k || levelKey(r) === k).length;
  const shown = base.filter((r) => !lv || levelKey(r) === lv);
  // คอลัมน์ที่ว่างทุกแถว (DTX น้ำหนัก ข้อมูลอื่น โน้ต) ไม่แสดง
  const keep = HEALTH_COLS.map((_, j) => j).filter((j) => ![4, 5, 6, 7].includes(j) || shown.some((r) => hasVal(r[j])));
  /** ส่งออกตามตัวกรองที่เลือก พร้อมผลประเมินและค่าที่เกินเกณฑ์ · ข้อมูลสุขภาพ: บันทึกการส่งออกในบันทึกการใช้งานระบบ */
  const exportHealth = () => {
    downloadCsv(`บันทึกสุขภาพ-${applied.person || "ทุกคน"}-${new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)}`, [...HEALTH_COLS, "สาขา", "ผลประเมิน", "ค่าที่เกินเกณฑ์", "ค่าที่ควรตรวจซ้ำ (น่าจะพิมพ์ผิด)"],
      shown.map((r) => {
        const v = parseVitals(r[2], r[3], r[4]), flags = evaluateVitals(v);
        return [...HEALTH_COLS.map((_, j) => (hasVal(r[j]) ? r[j] : "")), branchOf(r[1]), LEVEL_TH[levelOf(flags)], flags.map((f) => `${f.label} ${f.value} ${f.unit} (${f.note})`).join(" · "), implausible(v).map((k) => `${k.toUpperCase()} ${v[k]}`).join(" · ")];
      }));
    fetch("/api/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ what: "health", count: shown.length }) }).catch(() => {});
    toast(`ส่งออกบันทึกสุขภาพแล้ว ${shown.length} รายการ`);
  };
  // ---------- ล่าสุดของแต่ละคน (มุมมองแรก) ----------
  const [mode, setMode] = useState<"ล่าสุดของแต่ละคน" | "ประวัติทั้งหมด">("ล่าสุดของแต่ละคน");
  const stampOf = (th: string) => { const m = th.match(/^(\d{2})\/(\d{2})\/(\d{4})\s*(\d{2}:\d{2})?/); return m ? `${Number(m[3]) - 543}-${m[2]}-${m[1]} ${m[4] ?? "00:00"}` : ""; };
  const sysOf = (r: string[]) => Number(String(r[2] ?? "").match(/BP\s*(\d{2,3})\s*\//i)?.[1]) || null;
  const ago = (st: string) => { const d = Math.floor((Date.now() + 7 * 3600e3 - Date.parse(`${st.slice(0, 10)}T00:00:00Z`)) / 864e5); return d <= 0 ? "วันนี้" : d === 1 ? "เมื่อวาน" : `${d} วันก่อน`; };
  const RANK: Record<Level, number> = { critical: 0, watch: 1, normal: 2 };
  const people = residents.filter((x) => staying(x.status ?? "") && (!applied.branch || x.branch_name === applied.branch) && (!applied.person || x.full_name === applied.person));
  const latest = people.map((x) => {
    const mine = base.filter((r) => r[1] === x.full_name).sort((a, b) => stampOf(b[0] ?? "").localeCompare(stampOf(a[0] ?? "")));
    const r = mine[0];
    return { id: x.id, name: x.full_name, r, level: r ? levelKey(r) : null, trend: mine.slice(0, 5).map(sysOf).reverse() };
  }).sort((a, b) => (a.level === null ? 9 : RANK[a.level]) - (b.level === null ? 9 : RANK[b.level]) || stampOf(b.r?.[0] ?? "").localeCompare(stampOf(a.r?.[0] ?? "")));
  const latestShown = latest.filter((x) => !lv || x.level === lv);
  const lvLatest = (k: Level | "") => latest.filter((x) => !k || x.level === k).length;
  const spark = (t: (number | null)[]) => {
    const v = t.filter((x): x is number => x !== null);
    if (v.length < 2) return null;
    const lo = Math.min(...v) - 5, hi = Math.max(...v) + 5, W = 80, H = 26;
    const pts = t.map((x, i) => (x === null ? null : `${((i / (t.length - 1)) * (W - 6) + 3).toFixed(1)},${(H - 3 - ((x - lo) / (hi - lo)) * (H - 6)).toFixed(1)}`)).filter(Boolean) as string[];
    const [lx, ly] = pts[pts.length - 1].split(",");
    return <svg viewBox={`0 0 ${W} ${H}`} className="hl-spark" aria-label={`ความดันตัวบน ${v.join(", ")}`}><polyline points={pts.join(" ")} /><circle cx={lx} cy={ly} r="2.8" /></svg>;
  };

  /** ค่าที่เกินเกณฑ์เป็นตัวส้ม/แดงเฉพาะค่านั้น · ค่าที่เป็นไปไม่ได้ขึ้นป้าย "ตรวจค่า" */
  const renderCell = (i: number, col: number, value: string) => {
    const j = keep[col], r = shown[i];
    if (!r || ![2, 3, 4].includes(j) || !hasVal(value)) return undefined;
    const v = parseVitals(r[2], r[3], r[4]), flags = evaluateVitals(v), odd = implausible(v);
    const tone = (ks: (keyof Vitals)[]) => { const f = flags.filter((x) => ks.includes(x.key)); return f.some((x) => x.level === "critical") ? "v-crit" : f.length ? "v-watch" : ""; };
    const check = (ks: (keyof Vitals)[]) => (ks.some((k) => odd.includes(k)) ? <span className="v-check">ตรวจค่า</span> : null);
    if (j === 3 || j === 4) { const ks: (keyof Vitals)[] = [j === 3 ? "o2" : "dtx"]; return <><span className={tone(ks)}>{value}</span>{check(ks)}</>; }
    return <>{value.split(/,\s*/).map((p, k) => <span key={k}>{k ? ", " : ""}<span className={tone(partKeys(p))}>{p}</span>{check(partKeys(p))}</span>)}</>;
  };
  return (
    <>
      <PageHeader title="บันทึกสุขภาพ" sub="สัญญาณชีพและการประเมินทุกคน"
        actions={<button className="btn-primary" onClick={() => setRecord(true)}><Icon name="plus" className="h-4 w-4" /> บันทึกสัญญาณชีพ</button>} />
      <Section>
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {branchNames.length > 1 && <Select options={branchNames} placeholder="-- ทุกสาขา --" value={branch} onChange={setBranch} />}
          <Select options={names.filter((n) => !branch || branchOf(n) === branch)} placeholder="-- ทุกคน --" value={person} onChange={setPerson} />
          <div className="flex min-w-0 items-center gap-2 sm:col-span-2 lg:col-span-2">
            <DateBox label="ตั้งแต่วันที่" value={from} onChange={setFrom} />
            <span className="shrink-0 text-sm text-gold-600">ถึง</span>
            <DateBox label="ถึงวันที่" value={to} onChange={setTo} />
          </div>
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Tabs tabs={["ล่าสุดของแต่ละคน", "ประวัติทั้งหมด"]} value={mode} onChange={(v) => setMode(v as typeof mode)} />
          {(person || branch || from || to) && <button className="row-action" onClick={() => { setBranch(""); setPerson(""); setFrom(""); setTo(""); }}>ล้างตัวกรอง</button>}
          <span className="sm:ml-auto" />
          <MenuButton label="เพิ่มเติม" items={[
            { label: "พิมพ์", onClick: () => window.print() },
            { label: "ส่งออก CSV", hint: "ตามตัวกรอง · บันทึกในบันทึกการใช้งานระบบ", onClick: () => (shown.length ? exportHealth() : toast("ไม่มีรายการให้ส่งออก")) },
            { label: "ตัวอย่าง สบส. (แบบฟอร์มเปล่า)", onClick: () => setSample(true) },
          ]} />
        </div>
        <div className="stat-filter" role="radiogroup" aria-label="กรองตามผลประเมิน">
          {LEVEL_FILTERS.map((f) => (
            <button key={f.t} type="button" role="radio" aria-checked={lv === f.k} className={`${f.c} ${lv === f.k ? "is-on" : ""}`} onClick={() => setLv(f.k)}>
              {f.k && <i aria-hidden />}{f.t} <b>{mode === "ล่าสุดของแต่ละคน" ? lvLatest(f.k) : lvCount(f.k)}</b>
            </button>
          ))}
        </div>
        {mode === "ล่าสุดของแต่ละคน" ? (
          latestShown.length ? <ul className="hl-list">
            {latestShown.map((x) => (
              <li key={x.id} className={x.level ? `is-${x.level}` : "is-none"}>
                <button type="button" className="hl-row" onClick={() => setProfile(x.id)}>
                  <span className="hl-who"><b>{x.name}</b><small>{x.r ? `${x.r[0]} · ${ago(stampOf(x.r[0] ?? ""))}` : "ยังไม่มีบันทึก"}</small></span>
                  <span className="hl-v">{x.r ? <>{[x.r[2], hasVal(x.r[3]) ? `O₂ ${x.r[3]}` : "", hasVal(x.r[4]) ? `DTX ${x.r[4]}` : ""].filter(hasVal).join(" · ")}</> : "-"}</span>
                  <span className="hl-sp">{spark(x.trend)}</span>
                  <span className={`status-badge ${x.level === "critical" ? "status-danger" : x.level === "watch" ? "status-warning" : x.level === "normal" ? "status-success" : "status-neutral"}`}>{x.level ? LEVEL_TH[x.level] : "ยังไม่วัด"}</span>
                </button>
              </li>
            ))}
          </ul> : <p className="empty-state">{lv ? `ไม่มีผู้รับบริการที่${LEVEL_FILTERS.find((f) => f.k === lv)?.t}` : "ยังไม่มีผู้รับบริการที่พักอยู่"}</p>
        ) : <DataTable columns={[...keep.map((j) => HEALTH_COLS[j]), "ผลประเมิน"]} badgeCols={[keep.length]} rows={shown.map((r) => [...keep.map((j) => r[j] ?? "-"), levelCol(r)])} render={renderCell}
          empty={lv ? `ไม่มีบันทึกที่${LEVEL_FILTERS.find((f) => f.k === lv)?.t}` : "ยังไม่มีบันทึกสัญญาณชีพ"}
          onRow={(i) => setView(rows.indexOf(shown[i]))} rowLabel="กดเพื่อดูรายละเอียด"
          actions={[
            { label: "รายละเอียด", more: true, onClick: (i) => setView(rows.indexOf(shown[i])) },
            { label: "ประวัติผู้รับบริการ", more: true, onClick: (i) => { const r = residents.find((x) => x.full_name === shown[i][1]); if (r) setProfile(r.id); else toast("ยังไม่มีผู้รับบริการชื่อนี้ในทะเบียน"); } },
          ]} />}
      </Section>
      <VitalsDialog open={record} residents={names} recorder={user?.name ?? "-"} onClose={() => setRecord(false)} onSave={(row) => add(row)} />
      <ResidentProfile id={profile} onClose={() => setProfile(null)} />
      <VitalsView row={view !== null ? rows[view] : null} onClose={() => setView(null)} onProfile={() => { const r = view !== null ? residents.find((x) => x.full_name === rows[view][1]) : undefined; if (r) { setView(null); setProfile(r.id); } else toast("ยังไม่มีผู้รับบริการชื่อนี้ในทะเบียน"); }} />
      <BlankForm open={sample} title="แบบบันทึกสัญญาณชีพ (แบบฟอร์มเปล่า)" onClose={() => setSample(false)}
        lines={["ชื่อผู้สูงอายุ", "วัน-เวลา", "BT อุณหภูมิ", "PR ชีพจร", "RR การหายใจ", "BP ความดันโลหิต", "O2SAT ออกซิเจน", "DTX น้ำตาล", "น้ำหนัก (ก.ก.)", "ส่วนสูง (ซ.ม.)", "โน้ต / อาการ", "ผู้บันทึก"]} />
    </>
  );
}

/* ---------- เอกสารระเบียบ (แนบไฟล์รูปหรือ PDF ได้) ---------- */
const DOC_TYPES = ["ระเบียบภายใน", "แบบฟอร์ม", "คู่มือ", "ใบอนุญาต / เอกสารราชการ", "ประกาศ", "อื่น ๆ"];
const DOC_STATUS = ["เผยแพร่แล้ว", "ฉบับร่าง", "ยกเลิกใช้"];
type DocForm = { i: number | null; title: string; type: string; date: string; status: string; note: string; file: string; fileName: string };
export function OfficialDocs() {
  const { rows, ids, add, update, remove } = useCrud("docs", DOCS);
  const { toast, confirm } = useApp();
  const [f, setF] = useState<DocForm | null>(null);
  const [busy, setBusy] = useState(false);
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const isoOf = (th?: string) => { const m = String(th ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${Number(m[3]) - 543}-${m[2]}-${m[1]}` : today; };
  const open = (i: number | null) => { const r = i !== null ? rows[i] : null; setF({ i, title: r?.[0] ?? "", type: r?.[1] ?? DOC_TYPES[0], date: r ? isoOf(r[2]) : today, status: r?.[3] ?? DOC_STATUS[0], note: r?.[4] && r[4] !== "-" ? r[4] : "", file: "", fileName: "" }); };
  const pick = (file?: File) => {
    if (!f || !file) return;
    if (file.size > 4 * 1024 * 1024) return toast("ไฟล์ใหญ่เกิน 4 MB · ลดขนาดหรือแยกไฟล์ก่อนแนบ");
    const rd = new FileReader(); rd.onload = () => setF({ ...f, file: String(rd.result), fileName: file.name }); rd.readAsDataURL(file);
  };
  /** แนบไฟล์หลังบันทึกรายการ · รายการใหม่อาจยังส่งไม่ถึงฐานข้อมูล ลองซ้ำ */
  const upload = async (id: string, name: string, data: string) => {
    for (let k = 0; k < 6; k++) {
      const r = await fetch("/api/clinic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "doc_file", id, name, data }) }).catch(() => null);
      if (r?.ok) return true;
      if (r && r.status !== 404) { const j = await r.json().catch(() => ({})); toast(j.error || "แนบไฟล์ไม่สำเร็จ"); return false; }
      await new Promise((x) => setTimeout(x, 1500));
    }
    toast("แนบไฟล์ไม่สำเร็จ · ลองแนบใหม่อีกครั้ง"); return false;
  };
  const save = async () => {
    if (!f || busy) return;
    if (!f.title.trim()) return toast("กรุณากรอกชื่อเอกสาร");
    const row = [f.title.trim(), f.type, docDate(f.date).replace(/-/g, "/"), f.status, f.note.trim() || "-", f.i !== null ? rows[f.i][5] ?? "" : ""];
    setBusy(true);
    const id = f.i !== null ? ids[f.i] : (add(row) as string);
    if (f.i !== null) update(f.i, row);
    if (f.file) await upload(id, f.fileName, f.file);
    setBusy(false); setF(null);
    toast(`${f.i !== null ? "แก้ไขเอกสารแล้ว" : "เพิ่มเอกสารแล้ว"} · ${row[0]}${f.file ? " · แนบไฟล์แล้ว" : ""}`);
  };
  const view = async (i: number) => {
    const r = await fetch(`/api/clinic?op=doc_file&id=${encodeURIComponent(ids[i])}`).then((x) => (x.ok ? x.json() : null)).catch(() => null);
    if (!r?.data) return toast("เอกสารนี้ยังไม่มีไฟล์แนบ · กดแก้ไขเพื่อแนบไฟล์");
    const blob = await fetch(r.data).then((x) => x.blob());
    window.open(URL.createObjectURL(blob), "_blank", "noopener");
  };
  return (
    <>
      <PageHeader title="เอกสารและระเบียบ" sub="ระเบียบ แบบฟอร์ม คู่มือ และใบอนุญาต"
        actions={<button className="btn-primary" onClick={() => open(null)}><Icon name="plus" className="h-4 w-4" /> เพิ่มเอกสาร</button>} />
      <Section>
        <DataTable columns={["ชื่อเอกสาร", "ประเภท", "วันที่", "สถานะ", "ไฟล์แนบ"]}
          rows={rows.map((r) => [r[0], r[1], r[2], r[3], r[5] && r[5] !== "-" ? r[5] : "-"])}
          empty="ยังไม่มีเอกสาร · กด เพิ่มเอกสาร"
          actions={[
            { label: "เปิดไฟล์", hidden: (i) => !rows[i][5] || rows[i][5] === "-", onClick: (i) => view(i) },
            { label: "แก้ไข", onClick: (i) => open(i) },
            { label: "ลบ", danger: true, onClick: (i) => confirm({ title: "ลบเอกสาร", message: `ต้องการลบ "${rows[i][0]}" พร้อมไฟล์แนบใช่หรือไม่`, danger: true, okLabel: "ลบ", onOk: () => { const n = rows[i][0]; remove(i); toast(`ลบเอกสารแล้ว · ${n}`); } }) },
          ]} />
      </Section>
      <Modal open={!!f} title={f?.i !== null && f ? "แก้ไขเอกสาร" : "เพิ่มเอกสาร"} onClose={() => setF(null)}
        footer={<><button className="btn-soft" onClick={() => setF(null)}>ยกเลิก</button><button className="btn-primary" disabled={busy} onClick={save}>{busy ? "กำลังบันทึก…" : "บันทึกเอกสาร"}</button></>}>
        {f && <div className="form-grid">
          <Field label="ชื่อเอกสาร" required className="md:col-span-2"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="เช่น ใบอนุญาตประกอบกิจการสถานดูแลผู้สูงอายุ" /></Field>
          <Field label="ประเภท"><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{DOC_TYPES.map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="สถานะ"><select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{DOC_STATUS.map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="วันที่"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="ไฟล์แนบ (รูปหรือ PDF ไม่เกิน 4 MB)"><input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => pick(e.target.files?.[0])} />
            {f.fileName && <small className="mt-1 block text-gold-600">เลือกแล้ว: {f.fileName}</small>}
            {!f.fileName && f.i !== null && rows[f.i][5] && rows[f.i][5] !== "-" && <small className="mt-1 block text-gold-600">ไฟล์เดิม: {rows[f.i][5]} (เลือกไฟล์ใหม่เพื่อแทน)</small>}</Field>
          <Field label="หมายเหตุ" className="md:col-span-2"><textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="เช่น หมดอายุ 31/12/2570 ต้องต่ออายุก่อน 30 วัน" /></Field>
        </div>}
      </Modal>
    </>
  );
}
