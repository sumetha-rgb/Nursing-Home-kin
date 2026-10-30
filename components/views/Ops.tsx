"use client";
import Occupancy from "../care/Occupancy";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useBranchNames } from "@/lib/branches";
import Icon from "../Icon";
import { APPOINTMENTS, DOCS, HEALTH, RESIDENTS } from "@/lib/mock";
import { ApptSlip, longDate, PrintModal } from "../print/Docs";
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
import { evaluateVitals, LEVEL_TH, levelOf, parseVitals } from "@/lib/vitals";
import { BlankForm, DataTable, Field, FieldDef, FormDialog, Modal, MetricGrid, PageHeader, Section, Select, Tabs } from "../ui";

/* ---------- ผลการดำเนินงาน (ข้อมูลจริงจาก /api/ops) ---------- */
type DashBranch = { branch: string; total: number; done: number; checked: number; donePct: number; checkPct: number; mstars: number | null; famStars: number | null; famN: number; satPct: number | null; satN: number; complaints: number; residents: number; perResident: number; score: number };
type DashShift = { shift: string; total: number; done: number; checked: number; staff: number; active: number; names: string[] };
type DashAct = { id: string; who: string; task: string; resident: string; branch: string; at: string | null; date: string; praised: boolean };
type Dash = { range: string; from: string; branches: DashBranch[]; shifts: DashShift[]; activity: DashAct[] };
const KPI_COLS = ["สาขา", "งานที่สั่ง", "% สำเร็จ", "% ตรวจงาน", "ดาวญาติ", "งาน/ผู้รับบริการ", "% ความพึงพอใจ", "คอมเพลน", "คะแนนรวม"];
const stars = (v: number | null, n?: number) => (v === null ? "-" : `${v.toFixed(1)}${n ? ` (${n})` : ""}`);

export function Dashboard() {
  const branchNames = useBranchNames();
  const { user } = useSession();
  const { toast, go } = useApp();
  const [range, setRange] = useState("วันนี้ (รายวัน)");
  const [shiftBranch, setShiftBranch] = useState("");
  const [d, setD] = useState<Dash | null>(null);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState(false);
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const global = user?.role === "Global Admin";
  const load = useCallback(() => {
    const q = new URLSearchParams({ op: "dashboard", range: range.startsWith("วันนี้") ? "today" : "month", ...(shiftBranch ? { branch: shiftBranch } : {}) });
    fetch(`/api/ops?${q}`, { cache: "no-store" }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setD(j); setErr(""); }).catch((e) => setErr((e as Error).message || "โหลดข้อมูลไม่สำเร็จ"));
  }, [range, shiftBranch]);
  useEffect(() => { load(); const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 60_000); return () => clearInterval(t); }, [load]);

  const sum = (k: "total" | "done" | "checked") => (d?.branches ?? []).reduce((n, b) => n + b[k], 0);
  const total = sum("total"), done = sum("done"), checked = sum("checked");
  const rows = (d?.branches ?? []).map((b) => [b.branch, String(b.total), `${b.donePct}%`, `${b.checkPct}%`, stars(b.famStars, b.famN), String(b.perResident), b.satPct === null ? "-" : `${b.satPct}%`, String(b.complaints), b.score.toFixed(1)]);
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

  return (
    <>
      <PageHeader title="ผลการดำเนินงาน" sub="ตัวเลขทุกช่องมาจากงานจริงในระบบ อัปเดตทุก 1 นาที"
        actions={<>
          {branchNames.length > 1 && <div className="min-w-44"><Select options={branchNames} placeholder="รวมทุกสาขา" value={shiftBranch} onChange={setShiftBranch} /></div>}
          <button className="btn-soft" onClick={() => setMsg(true)}><Icon name="heart" className="h-4 w-4" /> ส่งกำลังใจให้สาขา</button>
        </>} />
      {err && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</p>}
      <Occupancy />
      <MetricGrid items={[
        { label: range.startsWith("วันนี้") ? "งานที่สั่งวันนี้" : "งานที่สั่งเดือนนี้", value: total, unit: "งาน", accent: true, icon: "check" },
        { label: "ทำเสร็จแล้ว", value: done, unit: "งาน", icon: "check" },
        { label: "อัตรางานสำเร็จ", value: `${total ? Math.round((done / total) * 100) : 0}%`, icon: "chart" },
        { label: "อัตราการตรวจงาน", value: `${done ? Math.round((checked / done) * 100) : 0}%`, note: "งานที่หัวหน้าตรวจแล้ว", icon: "search" },
      ]} />

      <Section title="คุณภาพการดูแลของแต่ละสาขา" sub={d ? `ข้อมูลตั้งแต่ ${longDate(d.from, true)} ถึงวันนี้` : "กำลังโหลด…"}
        actions={<>
          <Tabs tabs={["วันนี้ (รายวัน)", "เดือนนี้ (รายเดือน)"]} value={range} onChange={setRange} />
          <button className="btn-soft" onClick={() => downloadCsv("KPI-สาขา-" + range, KPI_COLS, rows)}><Icon name="download" className="h-4 w-4" /> โหลด Excel</button>
        </>}>
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

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
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
  { label: "ผู้รับบริการ", options: names, required: true },
  { label: "รายการ", required: true, placeholder: "เช่น พบแพทย์อายุรกรรม รพ.ศิริราช, ทำกายภาพ, ตรวจเลือด" },
  { label: "ผู้ดูแล / ผู้พาไป", suggest: nurses, placeholder: "พิมพ์ค้นหาชื่อพยาบาล หรือพิมพ์เอง เช่น ญาติพาไปเอง" },
  { label: "การเตรียมตัว", placeholder: "เช่น งดน้ำและอาหารหลังเที่ยงคืน นำสมุดยาไปด้วย (พิมพ์ในใบนัด)" },
];
const APPT_TABS = ["ทั้งหมด", "กำลังจะมาถึง", "ผ่านมาแล้ว"];

export function Appointments() {
  const { rows, add, update, remove } = useCrud("appointments", APPOINTMENTS);
  const res = useCrud("residents", RESIDENTS);
  const { toast, confirm } = useApp();
  const [dlg, setDlg] = useState<{ mode: "add" | "edit"; i: number } | null>(null);
  const [tab, setTab] = useState(APPT_TABS[0]);
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
  const shown = (tab === APPT_TABS[1] ? all.filter((x) => x.k >= now) : tab === APPT_TABS[2] ? all.filter((x) => x.k < now) : all)
    .sort((a, b) => (tab === APPT_TABS[2] ? b.k.localeCompare(a.k) : a.k.localeCompare(b.k)));
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
      <PageHeader title="ตารางนัดหมาย" sub="นัดพบแพทย์ ตรวจ และธุระสำคัญของผู้รับบริการแต่ละคน ให้ทุกการดูแลต่อเนื่อง"
        actions={<button className="btn-primary" onClick={() => setDlg({ mode: "add", i: -1 })}><Icon name="plus" className="h-4 w-4" /> เพิ่มนัดหมาย</button>} />
      <MetricGrid items={[
        { label: "นัดวันนี้", value: all.filter((x) => x.k.startsWith(today)).length, unit: "นัด", icon: "calendar", accent: true },
        { label: "7 วันข้างหน้า", value: all.filter((x) => x.k >= now && x.k.slice(0, 10) <= week).length, unit: "นัด", icon: "check" },
        { label: "นัดที่ยังไม่ถึง", value: all.filter((x) => x.k >= now).length, unit: "นัด", icon: "history" },
        { label: "ผู้รับบริการที่มีนัด", value: new Set(all.filter((x) => x.k >= now).map((x) => x.r[2])).size, unit: "คน", icon: "user" },
      ]} />
      <Section title="นัดหมายของผู้รับบริการ" actions={<Tabs tabs={APPT_TABS} value={tab} onChange={setTab} />}>
        {!active.length && <p className="mb-4 rounded-xl bg-cream-50 px-4 py-3 text-sm text-gold-600">ยังไม่มีผู้รับบริการในทะเบียน เพิ่มผู้รับบริการ (หรือเปิดสัญญา) ก่อนจึงจะลงนัดหมายได้</p>}
        <DataTable
          columns={["วันที่", "เวลา", "ผู้รับบริการ", "HN · ห้อง", "รายการ", "ผู้ดูแล"]}
          rows={shown.map(({ r }) => [`${r[0]}${apptIso(r[0]) === today ? " (วันนี้)" : ""}`, (r[1] ?? "").slice(0, 5), r[2], who(r[2]), r[3], r[4]])}
          empty={tab === APPT_TABS[1] ? "ไม่มีนัดหมายที่กำลังจะมาถึง" : "ไม่พบข้อมูล"}
          actions={[
            { label: "ใบนัด", onClick: (k) => setSlip(shown[k].i) },
            { label: "แก้ไข", onClick: (k) => setDlg({ mode: "edit", i: shown[k].i }) },
            { label: "ลบ", danger: true, onClick: (k) => confirm({ title: "ลบนัดหมาย", message: `ต้องการลบนัดหมาย "${shown[k].r[3]}" ของ ${shown[k].r[2]} ใช่หรือไม่`, danger: true, okLabel: "ลบ", onOk: () => { const r = shown[k].r; const undo = remove(shown[k].i); toast({ type: "del", title: "ลบนัดหมายแล้ว", detail: `${r[2]} · ${r[0]} ${(r[1] ?? "").slice(0, 5)} ${r[3]}`, action: { label: "เลิกทำ", run: () => { undo(); toast(`กู้คืนนัดหมายแล้ว · ${r[2]}`); } } }); } }) },
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

export function HealthLogs() {
  const branchNames = useBranchNames();
  const { rows, add } = useCrud("health", HEALTH);
  const { toast } = useApp();
  const { user } = useSession();
  const { residents } = useResidents();
  const [record, setRecord] = useState(false);
  const [profile, setProfile] = useState<string | null>(null);
  const names = residents.map((r) => r.full_name);
  // ตัวกรอง: สาขา (ของผู้รับบริการ) · ผู้รับบริการ · ช่วงวันที่ · กด "ดูข้อมูล" แล้วจึงกรอง
  const [branch, setBranch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [applied, setApplied] = useState({ person: "", branch: "", from: "", to: "" });
  const isoOf = (th: string) => { const m = th.match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${Number(m[3]) - 543}-${m[2]}-${m[1]}` : ""; };
  const branchOf = (name: string) => residents.find((x) => x.full_name === name)?.branch_name ?? "";
  const levelCol = (r: string[]) => LEVEL_TH[levelOf(evaluateVitals(parseVitals(r[2], r[3], r[4])))];
  const [person, setPerson] = useState("");
  const [sample, setSample] = useState(false);
  const [view, setView] = useState<number | null>(null);
  const shown = rows.filter((r) => {
    const d = isoOf(r[0] ?? "");
    return (!applied.person || r[1] === applied.person) && (!applied.branch || branchOf(r[1]) === applied.branch)
      && (!applied.from || (d && d >= applied.from)) && (!applied.to || (d && d <= applied.to));
  });
  return (
    <>
      <PageHeader title="รายงานข้อมูลสุขภาพ (Health Logs)" sub="ดูบันทึกสัญญาณชีพและการประเมินต่างๆ ของผู้สูงอายุ · ค่าที่เกินเกณฑ์ระบบแจ้งเตือนพยาบาลให้เอง"
        actions={<button className="btn-primary" onClick={() => setRecord(true)}><Icon name="plus" className="h-4 w-4" /> บันทึกสัญญาณชีพ</button>} />
      <Section>
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {branchNames.length > 1 && <Select options={branchNames} placeholder="-- ทุกสาขา --" value={branch} onChange={setBranch} />}
          <Select options={names.filter((n) => !branch || branchOf(n) === branch)} placeholder="-- ทุกคน --" value={person} onChange={setPerson} />
          <div className="flex min-w-0 items-center gap-2 sm:col-span-2 lg:col-span-2">
            <input type="date" aria-label="วันที่เริ่มต้น" className="min-w-0 flex-1" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="shrink-0 text-sm text-gold-600">ถึง</span>
            <input type="date" aria-label="วันที่สิ้นสุด" className="min-w-0 flex-1" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <div className="mb-5 flex flex-wrap items-center gap-2">
          {(applied.person || applied.branch || applied.from || applied.to) && <span className="text-sm text-gold-600">แสดง {shown.length} จาก {rows.length} รายการ</span>}
          <button className="btn-soft sm:ml-auto" onClick={() => { setBranch(""); setPerson(""); setFrom(""); setTo(""); setApplied({ person: "", branch: "", from: "", to: "" }); }}>ล้างตัวกรอง</button>
          <button className="btn-primary" onClick={() => setApplied({ person, branch, from, to })}>ดูข้อมูล</button>
          <button className="btn-soft" onClick={() => window.print()}><Icon name="print" className="h-4 w-4" /> พิมพ์</button>
          <button className="btn-soft" onClick={() => setSample(true)}>ตัวอย่าง สบส. (แบบฟอร์มเปล่า)</button>
        </div>
        <DataTable columns={[...HEALTH_COLS, "ผลประเมิน"]} badgeCols={[HEALTH_COLS.length]} rows={shown.map((r) => [...r, levelCol(r)])}
          actions={[
            { label: "ดู", onClick: (i) => setView(rows.indexOf(shown[i])) },
            { label: "ประวัติ", onClick: (i) => { const r = residents.find((x) => x.full_name === shown[i][1]); if (r) setProfile(r.id); else toast("ยังไม่มีผู้รับบริการชื่อนี้ในทะเบียน"); } },
          ]} />
      </Section>
      <VitalsDialog open={record} residents={names} recorder={user?.name ?? "-"} onClose={() => setRecord(false)} onSave={(row) => add(row)} />
      <ResidentProfile id={profile} onClose={() => setProfile(null)} />
      <FormDialog open={view !== null} mode="view" title="บันทึกสุขภาพ" fields={HEALTH_COLS.map((label) => ({ label }))} value={view !== null ? rows[view] : undefined} onClose={() => setView(null)} onSave={() => {}} />
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
      <PageHeader title="เอกสารระเบียบ" sub="เก็บระเบียบ แบบฟอร์ม คู่มือ และใบอนุญาตของศูนย์ แนบไฟล์รูปหรือ PDF ได้"
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
