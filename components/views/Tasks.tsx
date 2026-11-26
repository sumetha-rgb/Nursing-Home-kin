"use client";
import { useEffect, useMemo, useState } from "react";
import CsvIcon from "@/components/CsvIcon";
import { useBranchNames, withBranches } from "@/lib/branches";
import Icon from "../Icon";
import { BRANCH_NAMES, FACILITY_TASKS, MASTER_TASKS } from "@/lib/mock";
import { downloadCsv, useCrud } from "@/lib/store";
import { useApp } from "@/lib/app";
import { useSession } from "@/lib/session";
import { seesAllBranches } from "@/lib/roles";
import { effectiveTasks, parseRepeat, parseWindows, repeatText, windowsText } from "@/lib/taskPlan";
import { hourOf, shiftOfHour } from "@/lib/shifts";
import { useShiftCfg } from "@/lib/shiftsClient";
import { fetchNurses } from "@/lib/care";
import { DataTable, FieldDef, FormDialog, Modal, PageHeader, Section, SearchBox, Select, Tabs, Field } from "../ui";
import FacilityDialog, { facFromRow, facSchedule } from "./FacilityDialog";

/* หมวดหมู่งาน: แก้ได้ที่ ตั้งค่าตัวเลือก (lib/optionLists task_categories) */
type Dlg = { mode: "add" | "edit"; i: number } | null;
/** copy = สาขาแก้งานส่วนกลาง (บันทึกเป็นงานของสาขาตัวเอง แทนงานส่วนกลางนั้น) */
type MtDlg = { mode: "add" | "edit"; i: number; copy?: boolean } | null;

/* ---------- งานทั่วไปประจำสาขา ---------- */
export const FAC_COLS = ["ชื่องาน", "หมวดหมู่", "เวลา / ความถี่", "วิธีจ่ายงาน"];
/** CSV: เพิ่มคำแนะนำเพิ่มเติม (แถวที่ 5) */
const FAC_CATS = ["ความสะอาด NA", "งานทั่วไป / ซ่อมบำรุง", "อื่น ๆ"];
export const FAC_CSV_COLS = [...FAC_COLS, "คำแนะนำเพิ่มเติม"];
/** วิธีจ่ายงานส่วนกลาง · ค่าเดิม "สร้างอัตโนมัติ (Routine)" / "จ่ายเอง (Manual)" ยังใช้ได้ */
const AUTO = "ขึ้นให้ทุกคน · ใครทำก่อนส่ง (Routine)";
const MANUAL = "มอบหมายคนรับผิดชอบ (Manual)";
const isManual = (v?: string) => /Manual|มอบหมาย/.test(v ?? "");
const modeText = (v?: string) => (isManual(v) ? MANUAL : AUTO);
type HistLog = { id: string; branch: string; by: string; note: string | null; date: string; time: string };
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
/** รอบของงานในเดือนนั้น (ถึงวันนี้) · ทุกวัน = รายวัน · ทุกสัปดาห์ = จันทร์–อาทิตย์ · ทุกเดือน = ทั้งเดือน */
function periodsOf(schedule: string, month: string, today: string) {
  const [y, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const first = `${month}-01`, last = `${month}-${String(days).padStart(2, "0")}`;
  if (schedule.includes("ทุกเดือน")) return first <= today ? [{ label: `เดือน ${m}/${y + 543}`, start: first, end: last }] : [];
  const out: { label: string; start: string; end: string }[] = [];
  if (schedule.includes("ทุกสัปดาห์")) {
    const d = new Date(`${first}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    for (; iso(d) <= last && iso(d) <= today; d.setUTCDate(d.getUTCDate() + 7)) { const e = new Date(d); e.setUTCDate(e.getUTCDate() + 6); out.push({ label: `สัปดาห์ ${dm(iso(d))}–${dm(iso(e))}`, start: iso(d), end: iso(e) }); }
    return out;
  }
  for (let k = 1; k <= days; k++) { const s = `${month}-${String(k).padStart(2, "0")}`; if (s > today) break; out.push({ label: dm(s), start: s, end: s }); }
  return out;
}
export function FacilityTasks() {
  // หมวดหมู่งานส่วนกลาง: ความสะอาด / ซ่อมบำรุง + หมวดหมู่งานที่ตั้งค่าไว้
  // หมวดหมู่งานส่วนกลาง (งานสถานที่): ความสะอาด / ซ่อมบำรุง / อื่น ๆ · ไม่ปนหมวดงานดูแลผู้ป่วย (ค่าเดิมของแถวยังแสดงได้)
  const facCats = FAC_CATS;
  const { rows, ids, add, update, remove } = useCrud("facility", FACILITY_TASKS);
  const { toast, confirm } = useApp();
  // สถานะรอบนี้และคนทำล่าสุด (พยาบาลกดทำแล้ว · ถ่ายรูปใน KinApp)
  type Fac = { id: string; assignee: string | null; done: boolean; late: boolean; last: { id: string; by: string; at: string; note: string | null } | null; monthCount: number };
  const [fac, setFac] = useState<Fac[]>([]);
  const loadFac = () => { fetch("/api/care?op=facility", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setFac(d.items)).catch(() => {}); };
  // ดึงสถานะใหม่ทุก 1 นาที และเมื่อกลับมาที่หน้าต่าง (พยาบาลส่งงานจาก KinApp ระหว่างเปิดหน้านี้ค้างไว้)
  useEffect(() => {
    loadFac();
    const t = setInterval(() => { if (document.visibilityState === "visible") loadFac(); }, 60_000);
    window.addEventListener("focus", loadFac);
    return () => { clearInterval(t); window.removeEventListener("focus", loadFac); };
  }, [rows.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const { user } = useSession();
  const global = user?.role === "Global Admin";
  const branchNames = useBranchNames();
  const facOf = (i: number) => fac.find((x) => x.id === ids[i]);
  const [pic, setPic] = useState<{ title: string; sub: string; photo: string | null } | null>(null);
  // มอบหมายคนรับผิดชอบ (งานแบบ Manual)
  const [assign, setAssign] = useState<{ i: number; who: string; branch: string } | null>(null);
  // ประวัติย้อนหลังรายเดือน (ทุกครั้งที่ทำ + รอบที่ไม่มีคนทำ)
  const [hist, setHist] = useState<{ i: number; month: string; logs: HistLog[] | null; today: string } | null>(null);
  const loadHist = (i: number, month: string) => {
    setHist({ i, month, logs: null, today: "" });
    fetch(`/api/care?op=facility_history&id=${encodeURIComponent(ids[i])}&month=${month}`).then((r) => r.json())
      .then((d) => setHist((h) => h && h.i === i && h.month === month ? { ...h, logs: d.logs ?? [], today: d.today } : h)).catch(() => toast("โหลดประวัติไม่สำเร็จ"));
  };
  const histRows = (() => {
    if (!hist?.logs) return [];
    const r = rows[hist.i], logs = hist.logs;
    if (global) return logs.map((l) => ({ cells: [dm(l.date), "ทำแล้ว", l.branch, l.by, `${l.time} น.`, l.note || "-"], log: l }));
    return periodsOf(r[2] ?? "", hist.month, hist.today).reverse().flatMap((p) => {
      const got = logs.filter((l) => l.date >= p.start && l.date <= p.end);
      if (got.length) return got.map((l) => ({ cells: [p.start === p.end ? p.label : `${p.label} (ทำ ${dm(l.date)})`, "ทำแล้ว", l.by, `${l.time} น.`, l.note || "-"], log: l as HistLog | null }));
      return [{ cells: [p.label, p.end < hist.today ? "ไม่มีคนทำ" : "รอทำ", "-", "-", "-"], log: null as HistLog | null }];
    });
  })();
  const histCols = global ? ["วันที่", "สถานะ", "สาขา", "คนทำ", "เวลา", "หมายเหตุ"] : ["รอบ", "สถานะ", "คนทำ", "เวลา", "หมายเหตุ"];
  const [nurses, setNurses] = useState<string[]>([]);
  useEffect(() => { fetchNurses().then(setNurses).catch(() => {}); }, []);
  const openLog = (name: string, l: HistLog) => {
    setPic({ title: name, sub: `${l.date.slice(8, 10)}/${l.date.slice(5, 7)}/${Number(l.date.slice(0, 4)) + 543} ${l.time} น. · โดย ${l.by}${l.note ? ` · ${l.note}` : ""}`, photo: null });
    fetch(`/api/care?op=facility_photo&id=${encodeURIComponent(l.id)}`).then((r) => r.json()).then((d) => setPic((p) => p && { ...p, photo: d.photo ?? "" })).catch(() => toast("โหลดรูปไม่สำเร็จ"));
  };
  const openPic = (f: Fac, name: string) => {
    if (!f.last) return;
    setPic({ title: name, sub: `${f.last.at.replace(/^(\d{4})-(\d{2})-(\d{2})/, (_, y, m, d) => `${d}/${m}/${Number(y) + 543}`)} น. · โดย ${f.last.by}${f.last.note ? ` · ${f.last.note}` : ""}`, photo: null });
    fetch(`/api/care?op=facility_photo&id=${encodeURIComponent(f.last.id)}`).then((r) => r.json()).then((d) => setPic((p) => p && { ...p, photo: d.photo ?? "" })).catch(() => toast("โหลดรูปไม่สำเร็จ"));
  };
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [mode, setMode] = useState("ทั้งหมด");
  const [dlg, setDlg] = useState<Dlg>(null);
  const shown = rows.map((r, i) => ({ r, i })).filter(({ r }) =>
    (!q || r[0].includes(q)) && (!cat || r[1] === cat) && (mode === "ทั้งหมด" || (mode === "มอบหมายคนรับผิดชอบ") === isManual(r[3])));
  const needAssign = (n: number) => isManual(shown[n].r[3]) && !facOf(shown[n].i)?.assignee;
  const startAssign = (n: number) => { setAssign({ i: shown[n].i, who: global ? "" : facOf(shown[n].i)?.assignee ?? "", branch: global ? "" : user?.branch ?? "" }); if (!nurses.length) fetchNurses().then(setNurses).catch(() => toast("โหลดรายชื่อทีมดูแลไม่สำเร็จ")); };
  // ฟอร์ม (FacilityDialog) · ค่าเริ่มต้น: ทุกวัน · ขึ้นให้ทุกคน (useMemo: ฟอร์มล้างค่าเมื่อ value เปลี่ยน)
  const dlgValue = useMemo(() => facFromRow(dlg?.mode === "edit" ? rows[dlg.i] : undefined, dlg?.mode === "edit" ? facOf(dlg.i)?.assignee ?? "" : ""), [dlg]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <PageHeader
        title="งานส่วนกลางของสาขา"
        sub="งานสถานที่และทำความสะอาด · ส่งรูปใน KinApp"
        actions={<>
          <button className="btn-soft" onClick={() => downloadCsv("งานส่วนกลางของสาขา", FAC_CSV_COLS, rows)}><CsvIcon /> ส่งออก CSV</button>
          <button className="btn-primary" onClick={() => setDlg({ mode: "add", i: -1 })}><Icon name="plus" className="h-4 w-4" /> เพิ่มงาน</button>
        </>}
      />
      <Section>
        <div className="mb-4 grid gap-3 md:grid-cols-[1fr_16rem]">
          <div onChange={(e) => setQ((e.target as HTMLInputElement).value)}><SearchBox placeholder="ค้นหาชื่อ/รายละเอียดงาน" /></div>
          <Select options={facCats} placeholder="หมวดหมู่" value={cat} onChange={setCat} />
        </div>
        <div className="mb-4 grid gap-3 rounded-2xl border border-cream-300 bg-cream-50 p-4 text-sm text-gold-700 md:grid-cols-2">
          <p><b className="text-gold-800">ขึ้นให้ทุกคน · ใครทำก่อนส่ง</b><br />งานขึ้นใน KinApp ของพยาบาลทุกคนในสาขาทุกรอบ ใครทำก่อนกดส่ง เหมาะกับงานที่ใครทำก็ได้ เช่น ทำความสะอาดห้องโถง</p>
          <p><b className="text-gold-800">มอบหมายคนรับผิดชอบ</b><br />กด &quot;มอบหมาย&quot; เลือกพยาบาล 1 คน งานขึ้นใน KinApp เฉพาะคนนั้น คนอื่นส่งแทนไม่ได้ เหมาะกับงานที่ต้องมีผู้รับผิดชอบชัดเจน เช่น ตรวจถังดับเพลิง</p>
        </div>
        <div className="mb-4"><Tabs tabs={["ทั้งหมด", "ขึ้นให้ทุกคน", "มอบหมายคนรับผิดชอบ"]} value={mode} onChange={setMode} /></div>
        <DataTable
          columns={[...FAC_COLS, "ผู้รับผิดชอบ", "สถานะรอบนี้", "ทำล่าสุด"]}
          rows={shown.map((x) => { const f = facOf(x.i); const manual = isManual(x.r[3]); return [x.r[0], x.r[1], x.r[2], isManual(x.r[3]) ? "มอบหมายคนรับผิดชอบ" : "ขึ้นให้ทุกคน", manual ? f?.assignee || "ยังไม่ได้มอบหมาย" : "ทุกคนในสาขา", !f ? "-" : f.done ? "ทำแล้ว" : manual && !f.assignee ? "รอมอบหมาย" : f.late ? "เลยเวลา" : "รอทำ", f?.last ? `${f.last.at.slice(8, 10)}/${f.last.at.slice(5, 7)} ${f.last.at.slice(11)} · ${f.last.by}${f.monthCount ? ` · เดือนนี้ ${f.monthCount} ครั้ง` : ""}` : "ยังไม่เคยทำ"]; })}
          onRow={(n) => loadHist(shown[n].i, new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7))} rowLabel="กดเพื่อดูประวัติของงานนี้"
          actions={[
            // ปุ่มหลักตามสถานะ: ยังไม่มีผู้รับผิดชอบ = มอบหมาย · มีรูปรอบล่าสุด = ดูรูป · ที่เหลืออยู่ในเมนู ⋯
            { label: "มอบหมาย", tone: "primary", hidden: (n) => !needAssign(n), onClick: (n) => startAssign(n) },
            { label: "ดูรูป", tone: "primary", hidden: (n) => needAssign(n) || !facOf(shown[n].i)?.last, onClick: (n) => { const f = facOf(shown[n].i); if (f) openPic(f, shown[n].r[0]); } },
            { label: "เปลี่ยนผู้รับผิดชอบ", more: true, hidden: (n) => !isManual(shown[n].r[3]) || needAssign(n), onClick: (n) => startAssign(n) },
            { label: "ประวัติรอบที่ผ่านมา", more: true, onClick: (n) => loadHist(shown[n].i, new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7)) },
            { label: "แก้ไขงาน", more: true, onClick: (n) => setDlg({ mode: "edit", i: shown[n].i }) },
            { label: "ลบงาน", danger: true, more: true, onClick: (n) => confirm({ title: "ลบงานทั่วไป", message: `ต้องการลบ "${shown[n].r[0]}" ใช่หรือไม่`, danger: true, okLabel: "ลบ", onOk: () => { const r = shown[n].r; const undo = remove(shown[n].i); toast({ type: "del", title: "ลบงานทั่วไปแล้ว", detail: r[0], action: { label: "เลิกทำ", run: () => { undo(); toast(`กู้คืนงานแล้ว · ${r[0]}`); } } }); } }) },
          ]}
        />
      </Section>
      <Modal open={!!assign} title={assign ? `มอบหมาย · ${rows[assign.i]?.[0] ?? ""}` : ""} onClose={() => setAssign(null)}
        footer={<><button type="button" className="btn-soft" onClick={() => setAssign(null)}>ยกเลิก</button><button type="button" className="btn-primary" onClick={() => {
          if (!assign) return;
          if (global && !assign.branch) return toast("กรุณาเลือกสาขา");
          const name = rows[assign.i][0];
          fetch("/api/care", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "facility_assign", taskId: ids[assign.i], assignee: assign.who, branch: assign.branch }) })
            .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "มอบหมายไม่สำเร็จ"); })
            .then(() => { toast(assign.who ? `มอบหมายแล้ว · ${name} · ${assign.who} เห็นงานนี้ใน KinApp` : `ยกเลิกการมอบหมายแล้ว · ${name}`); setAssign(null); loadFac(); })
            .catch((e) => toast((e as Error).message));
        }}>บันทึก</button></>}>
        {assign && <div className="space-y-3">
          {global && <Field label="สาขา"><Select options={branchNames} placeholder="-- เลือกสาขา --" value={assign.branch} onChange={(v) => setAssign({ ...assign, branch: v })} /></Field>}
          <Field label="ผู้รับผิดชอบ (พยาบาล / ผู้ช่วยพยาบาล)"><Select options={nurses} placeholder={nurses.length ? "-- ยังไม่มอบหมาย --" : "กำลังโหลดรายชื่อ…"} value={assign.who} onChange={(v) => setAssign({ ...assign, who: v })} /></Field>
          <p className="text-sm text-gold-600">งานนี้จะขึ้นใน KinApp เฉพาะคนที่เลือก ทุกรอบตามความถี่ คนอื่นส่งแทนไม่ได้ · เปลี่ยนคนได้ทุกเมื่อ · เลือก &quot;ยังไม่มอบหมาย&quot; เพื่อยกเลิก{global ? " · งานที่ตั้งไว้ทุกสาขา แต่ละสาขามอบหมายคนของตัวเอง" : ""}</p>
        </div>}
      </Modal>
      <Modal open={!!hist} wide title={hist ? `ประวัติ · ${rows[hist.i]?.[0] ?? ""}` : ""} onClose={() => setHist(null)}
        footer={<><button type="button" className="btn-soft" disabled={!histRows.length} onClick={() => hist && downloadCsv(`ประวัติงานส่วนกลาง-${rows[hist.i]?.[0] ?? ""}-${hist.month}`, histCols, histRows.map((x) => x.cells))}><CsvIcon /> ส่งออก CSV</button><button type="button" className="btn-primary" onClick={() => setHist(null)}>ปิด</button></>}>
        {hist && <div className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <Field label="เดือน"><input type="month" value={hist.month} max={new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7)} onChange={(e) => e.target.value && loadHist(hist.i, e.target.value)} aria-label="เลือกเดือน" /></Field>
            {hist.logs && <p className="text-sm text-gold-600">{rows[hist.i]?.[2]} · ทำ {hist.logs.length} ครั้ง{!global && histRows.some((x) => x.cells[1] === "ไม่มีคนทำ") ? ` · ไม่มีคนทำ ${histRows.filter((x) => x.cells[1] === "ไม่มีคนทำ").length} รอบ` : ""}</p>}
          </div>
          {global && <p className="rounded-xl bg-cream-50 px-4 py-2.5 text-sm text-gold-700">ผู้บริหารเห็นทุกสาขารวมกัน จึงแสดงเฉพาะครั้งที่ทำ · รอบที่ไม่มีคนทำดูได้จากบัญชีของแต่ละสาขา</p>}
          {!hist.logs ? <p className="text-sm text-gold-500">กำลังโหลดประวัติ…</p> : (
            <DataTable search={false} columns={histCols} rows={histRows.map((x) => x.cells)} empty="ยังไม่มีรอบในเดือนนี้"
              actions={[{ label: "ดูรูป", hidden: (k) => !histRows[k]?.log, onClick: (k) => { const l = histRows[k].log; if (l) openLog(rows[hist.i][0], l); } }]} />
          )}
        </div>}
      </Modal>
      <Modal open={!!pic} title={pic ? `รูปหลักฐาน · ${pic.title}` : ""} onClose={() => setPic(null)}
        footer={<button type="button" className="btn-primary" onClick={() => setPic(null)}>ปิด</button>}>
        {pic && <div className="space-y-3"><p className="text-sm text-gold-600">{pic.sub}</p>
          {pic.photo === null ? <p className="text-sm text-gold-500">กำลังโหลดรูป…</p> : pic.photo ? <img src={pic.photo} alt={`รูปหลักฐาน ${pic.title}`} className="w-full rounded-xl" /> : <p className="text-sm text-gold-500">ไม่มีรูป</p>}</div>}
      </Modal>
      <FacilityDialog open={!!dlg} edit={dlg?.mode === "edit"} value={dlgValue} cats={facCats} names={rows.map((r) => r[0])} nurses={nurses} global={global}
        onClose={() => setDlg(null)}
        onSave={(v) => {
          const r = [v.name, v.cat, facSchedule(v), v.manual ? MANUAL : AUTO, v.note];
          const taskId = dlg?.mode === "edit" ? (update(dlg.i, r), ids[dlg.i]) : add(r);
          // มอบหมายคนรับผิดชอบของสาขา (งานใหม่อาจยังบันทึกไม่เสร็จ ลองซ้ำ) · เปลี่ยนเป็นขึ้นให้ทุกคน = ยกเลิกการมอบหมาย
          const who = v.manual ? v.who.trim() : "";
          const prev = dlg?.mode === "edit" ? facOf(dlg.i)?.assignee ?? "" : "";
          if (!global && taskId && who !== prev) {
            const send = (n: number): void => { fetch("/api/care", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "facility_assign", taskId, assignee: who }) })
              .then(async (res) => { if (res.status === 404 && n < 5) return void setTimeout(() => send(n + 1), 1500); if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "มอบหมายไม่สำเร็จ"); loadFac(); })
              .catch((e) => toast((e as Error).message)); };
            send(0);
          }
          const edit = dlg?.mode === "edit"; setDlg(null); toast({ type: edit ? "edit" : "ok", title: edit ? "แก้ไขงานส่วนกลางแล้ว" : "เพิ่มงานส่วนกลางแล้ว", detail: v.name });
        }} />
    </>
  );
}

/* ---------- ตั้งค่ารายการงาน (เดิมชื่อ แม่แบบงานมาตรฐาน · ข้อมูล key "master") ---------- */
/**
 * แถวข้อมูล (lib/schema master): [รหัส, ชื่องาน, คำสั่งงาน, หมวด, กะ, สาขา, วิชาชีพ, เวลาแนะนำ, ทำเมื่อไร]
 *  26 พ.ย. 2569 เพิ่ม เวลาแนะนำ ("07:00–08:00, 12:00–13:00") และ ทำเมื่อไร ("ทุกวัน" / "ครั้งเดียว" / "จ. พ. ศ.") · หน้ามอบหมายงานเติมให้เมื่อเลือกงานนี้ (lib/taskPlan)
 *  กะ คิดจากเวลาแนะนำให้เอง (ไม่มีเวลา = ทั้งสองกะ) จึงไม่ต้องเลือก
 *  25 พ.ย. 2569 เอาหมวดและวิชาชีพออกจากหน้าจอ (ไม่ได้ใช้ต่อ: หมวดใช้แค่ตัวกรอง วิชาชีพเป็นแค่ข้อความกำกับ) · ค่าเดิมยังเก็บในฐานข้อมูล
 *  กะ = สิ่งที่ใช้จริงตอนมอบหมาย (ทั้งสองกะ = สร้างทั้งกะเช้าและกะดึก) จึงบังคับเลือก
 */
export const MT_COLS = ["รหัส", "ชื่องาน", "คำสั่งงาน (Instruction)", "เวลาแนะนำ", "ทำเมื่อไร", "สาขา"];
export const mtRow = (r: string[]) => [r[0], r[1], r[2], r[7] && r[7] !== "-" ? r[7] : r[4] || "-", r[8] && r[8] !== "-" ? r[8] : "ทุกวัน", r[5]];
const REPEAT_SUGGEST = ["ทุกวัน", "ครั้งเดียว", "จ. พ. ศ.", "อ. พฤ.", "จ.–ศ.", "ส. อา.", "จ.", "อา."];
const MT_FIELDS: FieldDef[] = [
  { label: "รหัสงาน" },
  { label: "ชื่องาน", required: true },
  { label: "คำสั่งงาน (Instruction)", area: true, required: true },
  { label: "หมวดหมู่", hidden: true },
  { label: "กะที่ต้องทำ", hidden: true },
  { label: "สาขา", options: ["ส่วนกลาง", ...BRANCH_NAMES] },
  { label: "วิชาชีพ", hidden: true },
  { label: "เวลาแนะนำ (ไม่บังคับ)", placeholder: "พิมพ์ได้หลายช่วง เช่น 7-8, 12-13, 17-18" },
  { label: "ทำเมื่อไร", suggest: REPEAT_SUGGEST, placeholder: "ทุกวัน · ครั้งเดียว · จ. พ. ศ." },
];

/** รหัสงานถัดไป (T-007) จากงานที่เห็น · server ตรวจซ้ำกับทุกสาขาอีกครั้งแล้วออกรหัสใหม่ถ้าชน (numberMasterTasks) */
const nextTaskCode = (rows: string[][]) => `T-${String(rows.reduce((n, r) => Math.max(n, Number(/^T-(\d+)$/.exec(r[0] ?? "")?.[1] ?? 0)), 0) + 1).padStart(3, "0")}`;

export function MasterTasks() {
  const branchNames = useBranchNames();
  const { rows, add, update, remove } = useCrud("master", MASTER_TASKS);
  const { toast, confirm } = useApp();
  const { user } = useSession();
  /** เวลากะของสาขา (คิดกะของงานจากเวลาแนะนำ) */
  const shCfg = useShiftCfg(user?.branch);
  // ผู้บริหาร (เห็นทุกสาขา) เลือกสาขา/ส่วนกลางได้ · คนอื่นล็อกเป็นสาขาตัวเอง ไม่มีตัวเลือกส่วนกลาง
  const allBranches = seesAllBranches(user?.role);
  const myBranch = user?.branch ?? "";
  const [q, setQ] = useState("");
  const [shift, setShift] = useState("");
  const [dlg, setDlg] = useState<MtDlg>(null);
  // สาขาเห็นงานของสาขาที่แก้แล้ว แทนงานส่วนกลางตัวเดิม
  const shown = effectiveTasks(rows.map((r, i) => ({ r, i })), allBranches ? undefined : myBranch).filter(({ r }) =>
    (!q || r[1].includes(q) || r[2].includes(q)) && (!shift || r[4] === shift));
  /** แถวที่บัญชีนี้แก้/ลบได้: ผู้บริหารได้ทุกแถว · สาขาแก้/ลบได้เฉพาะงานของสาขาตัวเอง
   *  งานส่วนกลาง: สาขากดแก้ไข = บันทึกเป็นงานของสาขาตัวเอง แทนงานส่วนกลางนั้น (ฉบับส่วนกลางและสาขาอื่นไม่เปลี่ยน) */
  const mine = (b?: string) => allBranches || b === myBranch;
  const guard = (b: string | undefined, run: () => void) => (mine(b) ? run() : toast(`งานของ${b === "ส่วนกลาง" ? "ส่วนกลาง" : `สาขา ${b}`} ลบได้เฉพาะผู้บริหาร`));
  const editRow = (i: number) => (mine(rows[i][5]) ? setDlg({ mode: "edit", i }) : rows[i][5] === "ส่วนกลาง" && myBranch ? setDlg({ mode: "add", i, copy: true }) : guard(rows[i][5], () => {}));
  const fields = useMemo(() => MT_FIELDS.map((f) => {
    if (f.label === "รหัสงาน") return { ...f, readOnly: true };
    if (f.label === "สาขา") return allBranches ? withBranches([f], branchNames)[0] : { ...f, readOnly: true };
    return f;
  }), [allBranches, branchNames]);
  // ค่าเริ่มต้นของฟอร์มเพิ่ม: รหัสถัดไป · ทั้งสองกะ · สาขาของตัวเอง (useMemo: FormDialog ล้างฟอร์มทุกครั้งที่ value เปลี่ยน)
  const dlgValue = useMemo(() => !dlg ? undefined : dlg.mode === "edit" ? rows[dlg.i] : dlg.copy ? Object.assign([...rows[dlg.i]], { 0: nextTaskCode(rows), 5: myBranch }) : [nextTaskCode(rows), "", "", "", "ทั้งสองกะ", allBranches ? "" : myBranch, "", "", "ทุกวัน"], [dlg]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <PageHeader
        title="ตั้งค่ารายการงาน"
        sub="เพิ่มงานที่ทีมต้องทำไว้ที่นี่ แล้วไปมอบหมายให้ผู้รับบริการได้ที่หน้า มอบหมายและตรวจงาน"
        actions={<>
          <button className="btn-soft" onClick={() => downloadCsv("รายการงาน", MT_COLS, rows.map(mtRow))}><CsvIcon /> ส่งออก CSV</button>
          <button className="btn-primary" onClick={() => setDlg({ mode: "add", i: -1 })}><Icon name="plus" className="h-4 w-4" /> เพิ่มงาน</button>
        </>}
      />
      <Section>
        <div className="mb-4 grid gap-3 md:grid-cols-[1fr_12rem]">
          <div onChange={(e) => setQ((e.target as HTMLInputElement).value)}><SearchBox placeholder="ค้นหาชื่อ/คำสั่งงาน" /></div>
          <Select options={["กะเช้า", "กะดึก", "ทั้งสองกะ"]} placeholder="กะ: ทั้งหมด" value={shift} onChange={setShift} />
        </div>
        <DataTable
          columns={MT_COLS}
          rows={shown.map((x) => { const v = mtRow(x.r); if (x.r[9] && x.r[9] !== "-") v[5] = `${x.r[5]} · แก้จาก ${x.r[9]}`; return v; })}
          actions={[
            { label: "แก้ไข", onClick: (n) => editRow(shown[n].i) },
            { label: "ลบ", danger: true, onClick: (n) => guard(shown[n].r[5], () => confirm({ title: "ลบงาน", message: `ต้องการลบ "${shown[n].r[1]}" ใช่หรือไม่`, danger: true, okLabel: "ลบ", onOk: () => { const r = shown[n].r; const undo = remove(shown[n].i); toast({ type: "del", title: r[9] && r[9] !== "-" ? `ลบงานแล้ว · กลับไปใช้งานส่วนกลาง ${r[9]}` : "ลบงานแล้ว", detail: `${r[0]} ${r[1]}`, action: { label: "เลิกทำ", run: () => { undo(); toast(`กู้คืนงานแล้ว · ${r[1]}`); } } }); } })) },
          ]}
        />
      </Section>
      <FormDialog
        open={!!dlg} mode={dlg?.mode ?? "add"} title={dlg?.copy ? `แก้ไขงาน · บันทึกเป็นงานของสาขา ${myBranch}` : dlg?.mode === "edit" ? "แก้ไขงาน" : "เพิ่มงาน"}
        fields={fields} value={dlgValue}
        onClose={() => setDlg(null)} saveLabel="บันทึกข้อมูล"
        onSave={(v) => {
          const edit = dlg?.mode === "edit";
          const r = [...v]; if (!allBranches) r[5] = edit ? rows[dlg!.i][5] : myBranch;
          // สาขาแก้งานส่วนกลาง = งานใหม่ของสาขา จำรหัสงานส่วนกลางที่แทนไว้ · แก้แถวเดิมคงค่าเดิม
          r[9] = dlg?.copy ? rows[dlg.i][0] : edit ? rows[dlg!.i][9] ?? "" : "";
          // เวลาแนะนำ: จัดรูปให้ (อ่านไม่ออก = เตือน) · กะคิดจากเวลา · ทำเมื่อไร: จัดเป็นข้อความมาตรฐาน
          const raw = String(r[7] ?? "").trim(), wins = parseWindows(raw);
          if (raw && raw !== "-" && wins.length !== raw.split(/[,·;\n]+/).filter((x) => x.trim()).length) return toast("เวลาแนะนำอ่านไม่ออกบางช่วง · พิมพ์เช่น 7-8, 12-13");
          r[7] = wins.length ? windowsText(wins) : "";
          const sh = [...new Set(wins.map((w) => shiftOfHour(hourOf(w.s), shCfg)))];
          r[4] = sh.length === 1 ? sh[0] : sh.length ? "ทั้งสองกะ" : (r[4] || "ทั้งสองกะ");
          r[8] = repeatText(parseRepeat(r[8]), false);
          if (edit) update(dlg!.i, r); else add(r);
          setDlg(null); toast({ type: edit || dlg?.copy ? "edit" : "ok", title: dlg?.copy ? `บันทึกเป็นงานของสาขา ${myBranch} แล้ว · ส่วนกลางไม่เปลี่ยน` : edit ? "แก้ไขงานแล้ว" : "เพิ่มงานแล้ว", detail: [r[0], r[1]].filter(Boolean).join(" ") });
        }}
      />
    </>
  );
}
