"use client";
import { useEffect, useState } from "react";
import CsvIcon from "@/components/CsvIcon";
import { useBranchNames, withBranches } from "@/lib/branches";
import Icon from "../Icon";
import { BRANCH_NAMES, FACILITY_TASKS, MASTER_TASKS } from "@/lib/mock";
import { downloadCsv, useCrud } from "@/lib/store";
import { useApp } from "@/lib/app";
import { useSession } from "@/lib/session";
import { fetchNurses } from "@/lib/care";
import { DataTable, FieldDef, FormDialog, Modal, PageHeader, Section, SearchBox, Select, Tabs, Field } from "../ui";

const CATEGORIES = ["กิจวัตรประจำวัน (ADL)", "งานพยาบาล", "กายภาพบำบัด", "ส่งเสริมสุขภาพ", "กิจกรรมกลุ่ม", "งานทั่วไป", "งานอื่นๆ"];
type Dlg = { mode: "add" | "edit"; i: number } | null;

/* ---------- งานทั่วไปประจำสาขา ---------- */
const FAC_COLS = ["ชื่องาน", "หมวดหมู่", "เวลา / ความถี่", "วิธีจ่ายงาน"];
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
const FAC_FIELDS: FieldDef[] = [
  { label: "เลือกงานจากคลังมาตรฐาน (Task Dictionary)", options: Array.from(new Set([...MASTER_TASKS, ...FACILITY_TASKS].map((t) => t[1] === undefined ? "" : t[0].startsWith("T-") ? t[1] : t[0]))), required: true, wide: true },
  { label: "หมวดหมู่ (ดึงจากคลังอัตโนมัติ)", options: ["ความสะอาด NA", "งานทั่วไป / ซ่อมบำรุง", ...CATEGORIES] },
  { label: "วิธีจ่ายงาน", options: [AUTO, MANUAL], required: true },
  { label: "ความถี่", options: ["ทุกวัน (Daily)", "ทุกสัปดาห์ (Weekly)", "ทุกเดือน (Monthly)"], required: true },
  { label: "เวลาที่ต้องทำ (เช่น 07:00 หรือ กะเช้า)" },
  { label: "คำแนะนำเพิ่มเติม (ถ้ามี)", area: true },
];

export function FacilityTasks() {
  const { rows, ids, add, update, remove } = useCrud("facility", FACILITY_TASKS);
  const { toast, confirm, go } = useApp();
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
  const startAssign = (n: number) => { setAssign({ i: shown[n].i, who: global ? "" : facOf(shown[n].i)?.assignee ?? "", branch: global ? "" : user?.branch ?? "" }); if (!nurses.length) fetchNurses().then(setNurses).catch(() => toast("โหลดรายชื่อพยาบาลไม่สำเร็จ")); };
  // ฟอร์มมี 6 ช่อง ส่วนตารางแสดง 4 คอลัมน์: ชื่องาน, หมวดหมู่, เวลา/ความถี่, ระบบจ่ายงาน
  const toRow = (v: string[]) => [v[0], v[1], [v[4], v[3]].filter(Boolean).join(" / "), v[2], v[5]];
  return (
    <>
      <PageHeader
        title="งานส่วนกลางของสาขา"
        sub="งานสถานที่และทำความสะอาด · ส่งรูปใน KinApp"
        actions={<>
          <button className="btn-soft" onClick={() => go("master_tasks")}>จัดการแม่แบบงานมาตรฐาน</button>
          <button className="btn-soft" onClick={() => downloadCsv("งานส่วนกลางของสาขา", FAC_COLS, rows)}><CsvIcon /> ส่งออก CSV</button>
          <button className="btn-primary" onClick={() => setDlg({ mode: "add", i: -1 })}><Icon name="plus" className="h-4 w-4" /> เพิ่มงานทั่วไป</button>
        </>}
      />
      <Section>
        <div className="mb-4 grid gap-3 md:grid-cols-[1fr_16rem]">
          <div onChange={(e) => setQ((e.target as HTMLInputElement).value)}><SearchBox placeholder="ค้นหาชื่อ/รายละเอียดงาน" /></div>
          <Select options={["ความสะอาด NA", "งานทั่วไป / ซ่อมบำรุง", ...CATEGORIES]} placeholder="หมวดหมู่" value={cat} onChange={setCat} />
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
          <Field label="พยาบาลผู้รับผิดชอบ"><Select options={nurses} placeholder={nurses.length ? "-- ยังไม่มอบหมาย --" : "กำลังโหลดรายชื่อ…"} value={assign.who} onChange={(v) => setAssign({ ...assign, who: v })} /></Field>
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
      <FormDialog
        open={!!dlg} mode={dlg?.mode ?? "add"} title={dlg?.mode === "edit" ? "แก้ไขงานการดูแล" : "เพิ่มงานทั่วไปประจำสาขา"}
        fields={[...FAC_FIELDS, { label: "พยาบาลผู้รับผิดชอบ", options: nurses, pick: "search", placeholder: nurses.length ? "พิมพ์ชื่อพยาบาลเพื่อค้นหา" : "กำลังโหลดรายชื่อ…", showIf: (v) => isManual(v[2]), wide: true }]}
        value={dlg?.mode === "edit" ? [rows[dlg.i][0], rows[dlg.i][1], modeText(rows[dlg.i][3]), "", rows[dlg.i][2], "", facOf(dlg.i)?.assignee ?? ""] : undefined}
        onClose={() => setDlg(null)} saveLabel="บันทึกข้อมูล"
        onSave={(v) => {
          const r = toRow(v).slice(0, 4);
          const taskId = dlg?.mode === "edit" ? (update(dlg.i, r), ids[dlg.i]) : add(r);
          // มอบหมายคนรับผิดชอบของสาขา (งานใหม่อาจยังบันทึกไม่เสร็จ ลองซ้ำ) · เปลี่ยนเป็นขึ้นให้ทุกคน = ยกเลิกการมอบหมาย
          const who = isManual(v[2]) ? (v[6] ?? "").trim() : "";
          const prev = dlg?.mode === "edit" ? facOf(dlg.i)?.assignee ?? "" : "";
          if (!global && taskId && who !== prev) {
            const send = (n: number): void => { fetch("/api/care", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "facility_assign", taskId, assignee: who }) })
              .then(async (res) => { if (res.status === 404 && n < 5) return void setTimeout(() => send(n + 1), 1500); if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "มอบหมายไม่สำเร็จ"); loadFac(); })
              .catch((e) => toast((e as Error).message)); };
            send(0);
          }
          if (global && isManual(v[2]) && who) toast("ผู้บริหาร: เลือกสาขาแล้วมอบหมายที่ปุ่ม มอบหมาย ในตาราง");
          const edit = dlg?.mode === "edit"; setDlg(null); toast({ type: edit ? "edit" : "ok", title: edit ? "แก้ไขงานทั่วไปแล้ว" : "เพิ่มงานทั่วไปแล้ว", detail: r[0] });
        }}
      />
    </>
  );
}

/* ---------- คลังงานมาตรฐาน ---------- */
/** วิชาชีพที่งานมาตรฐานนี้เหมาะสม (ข้อความกำกับในรายการเลือกงาน ไม่ผูกกับตำแหน่งสิทธิ์) · ค่าอื่นที่เคยบันทึกไว้ยังแสดงและเลือกได้ */
const PROFESSIONS = ["พยาบาล", "ผู้ช่วยพยาบาล", "ผู้ดูแล / ผู้ช่วยเหลือคนไข้", "นักกายภาพบำบัด", "นักกิจกรรมบำบัด", "นักโภชนาการ", "แพทย์"];
const MT_COLS = ["รหัส", "ชื่องาน", "คำสั่งงาน (Instruction)", "หมวด", "กะ", "สาขา"];
const MT_FIELDS: FieldDef[] = [
  { label: "รหัสงาน" },
  { label: "ชื่องาน", required: true },
  { label: "คำสั่งงาน (Instruction)", area: true, required: true },
  { label: "หมวดหมู่", options: CATEGORIES },
  { label: "กะที่ต้องทำ", options: ["ทั้งสองกะ", "กะเช้า", "กะดึก"] },
  { label: "สาขา", options: ["ส่วนกลาง", ...BRANCH_NAMES] },
  { label: "วิชาชีพ", options: PROFESSIONS },
];

export function MasterTasks() {
  const branchNames = useBranchNames();
  const { rows, add, update, remove } = useCrud("master", MASTER_TASKS);
  const { toast, confirm } = useApp();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [shift, setShift] = useState("");
  const [dlg, setDlg] = useState<Dlg>(null);
  const [group, setGroup] = useState(false);
  const [gname, setGname] = useState("");
  const shown = rows.map((r, i) => ({ r, i })).filter(({ r }) =>
    (!q || r[1].includes(q) || r[2].includes(q)) && (!cat || r[3] === cat) && (!shift || r[4] === shift));
  return (
    <>
      <PageHeader
        title="แม่แบบงานมาตรฐาน"
        sub="ชื่องานและคำสั่งงานมาตรฐาน"
        actions={<>
          <button className="btn-soft" onClick={() => downloadCsv("แม่แบบงานมาตรฐาน", MT_COLS, rows.map((r) => r.slice(0, 6)))}><CsvIcon /> ส่งออก CSV</button>
          <button className="btn-soft" onClick={() => setGroup(true)}>สร้างกลุ่มงานใหม่</button>
          <button className="btn-primary" onClick={() => setDlg({ mode: "add", i: -1 })}><Icon name="plus" className="h-4 w-4" /> เพิ่มงานมาตรฐาน</button>
        </>}
      />
      <Section>
        <div className="mb-4 grid gap-3 md:grid-cols-[1fr_16rem_12rem]">
          <div onChange={(e) => setQ((e.target as HTMLInputElement).value)}><SearchBox placeholder="ค้นหาชื่อ/คำสั่งงาน" /></div>
          <Select options={CATEGORIES} placeholder="หมวดหมู่: ทั้งหมด" value={cat} onChange={setCat} />
          <Select options={["กะเช้า", "กะดึก", "ทั้งสองกะ"]} placeholder="กะ: ทั้งหมด" value={shift} onChange={setShift} />
        </div>
        <DataTable
          columns={MT_COLS}
          rows={shown.map((x) => x.r.slice(0, 6))}
          actions={[
            { label: "แก้ไข", onClick: (n) => setDlg({ mode: "edit", i: shown[n].i }) },
            { label: "ลบ", danger: true, onClick: (n) => confirm({ title: "ลบงานมาตรฐาน", message: `ต้องการลบ "${shown[n].r[1]}" ใช่หรือไม่`, danger: true, okLabel: "ลบ", onOk: () => { const r = shown[n].r; const undo = remove(shown[n].i); toast({ type: "del", title: "ลบงานมาตรฐานแล้ว", detail: `${r[0]} ${r[1]}`, action: { label: "เลิกทำ", run: () => { undo(); toast(`กู้คืนงานแล้ว · ${r[1]}`); } } }); } }) },
          ]}
        />
      </Section>
      <FormDialog
        open={!!dlg} mode={dlg?.mode ?? "add"} title={dlg?.mode === "edit" ? "แก้ไขงานมาตรฐาน" : "เพิ่มงานมาตรฐาน"}
        fields={withBranches(MT_FIELDS, branchNames).map((f) => f.label === "วิชาชีพ" ? { ...f, options: [...new Set([...PROFESSIONS, ...rows.map((r) => r[6]).filter((v) => v && v !== "-")])] } : f)} value={dlg?.mode === "edit" ? rows[dlg.i] : undefined}
        onClose={() => setDlg(null)} saveLabel="บันทึกข้อมูล"
        onSave={(v) => { const edit = dlg?.mode === "edit"; if (edit) update(dlg!.i, v); else add(v); setDlg(null); toast({ type: edit ? "edit" : "ok", title: edit ? "แก้ไขงานมาตรฐานแล้ว" : "เพิ่มงานมาตรฐานแล้ว", detail: [v[0], v[1]].filter(Boolean).join(" ") }); }}
      />
      <Modal
        open={group} title="สร้างกลุ่มงานใหม่" onClose={() => setGroup(false)}
        footer={<><button className="btn-soft" onClick={() => setGroup(false)}>ยกเลิก</button>
          <button className="btn-primary" onClick={() => { if (!gname.trim()) return toast("กรุณากรอกชื่อกลุ่มงาน"); setGroup(false); setGname(""); toast("บันทึกกลุ่มงานแล้ว"); }}>บันทึกกลุ่มงาน</button></>}
      >
        <div className="space-y-4">
          <Field label="ชื่อกลุ่มงาน" required><input value={gname} onChange={(e) => setGname(e.target.value)} /></Field>
          <Field label="คำอธิบาย"><textarea rows={2} /></Field>
          <Field label="รายการงานในกลุ่ม (ดึงงานจากคลัง)">
            <div className="space-y-1 rounded-xl border border-cream-300 bg-cream-50/60 p-2">
              {rows.map((r) => (
                <label key={r[0]} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-white"><input type="checkbox" /> {r[1]}</label>
              ))}
            </div>
          </Field>
        </div>
      </Modal>
    </>
  );
}
