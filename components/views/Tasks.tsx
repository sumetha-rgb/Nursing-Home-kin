"use client";
import { useState } from "react";
import { useBranchNames, withBranches } from "@/lib/branches";
import Icon from "../Icon";
import { BRANCH_NAMES, FACILITY_TASKS, MASTER_TASKS } from "@/lib/mock";
import { downloadCsv, useCrud } from "@/lib/store";
import { useApp } from "@/lib/app";
import { DataTable, FieldDef, FormDialog, Modal, PageHeader, Section, SearchBox, Select, Tabs, Field } from "../ui";

const CATEGORIES = ["กิจวัตรประจำวัน (ADL)", "งานพยาบาล", "กายภาพบำบัด", "ส่งเสริมสุขภาพ", "กิจกรรมกลุ่ม", "งานทั่วไป", "งานอื่นๆ"];
type Dlg = { mode: "add" | "edit"; i: number } | null;

/* ---------- งานทั่วไปประจำสาขา ---------- */
const FAC_COLS = ["ชื่องาน", "หมวดหมู่", "เวลา / ความถี่", "ระบบจ่ายงาน"];
const FAC_FIELDS: FieldDef[] = [
  { label: "เลือกงานจากคลังมาตรฐาน (Task Dictionary)", options: Array.from(new Set([...MASTER_TASKS, ...FACILITY_TASKS].map((t) => t[1] === undefined ? "" : t[0].startsWith("T-") ? t[1] : t[0]))), required: true, wide: true },
  { label: "หมวดหมู่ (ดึงจากคลังอัตโนมัติ)", options: ["ความสะอาด NA", "งานทั่วไป / ซ่อมบำรุง", ...CATEGORIES] },
  { label: "ระบบจ่ายงาน", options: ["สร้างอัตโนมัติ (Routine)", "จ่ายเอง (Manual)"], required: true },
  { label: "ความถี่", options: ["ทุกวัน (Daily)", "ทุกสัปดาห์ (Weekly)", "ทุกเดือน (Monthly)"], required: true },
  { label: "เวลาที่ต้องทำ (เช่น 07:00 หรือ กะเช้า)" },
  { label: "คำแนะนำเพิ่มเติม (ถ้ามี)", area: true },
];

export function FacilityTasks() {
  const { rows, add, update, remove } = useCrud("facility", FACILITY_TASKS);
  const { toast, confirm, go } = useApp();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [mode, setMode] = useState("ทั้งหมด");
  const [dlg, setDlg] = useState<Dlg>(null);
  const shown = rows.map((r, i) => ({ r, i })).filter(({ r }) =>
    (!q || r[0].includes(q)) && (!cat || r[1] === cat) && (mode === "ทั้งหมด" || r[3] === mode));
  // ฟอร์มมี 6 ช่อง ส่วนตารางแสดง 4 คอลัมน์: ชื่องาน, หมวดหมู่, เวลา/ความถี่, ระบบจ่ายงาน
  const toRow = (v: string[]) => [v[0], v[1], [v[4], v[3]].filter(Boolean).join(" / "), v[2], v[5]];
  return (
    <>
      <PageHeader
        title="งานทั่วไปประจำสาขา (Facility Tasks)"
        sub="จัดการงานสถานที่ งานทำความสะอาด และงานทั่วไปที่ไม่ผูกกับผู้รับบริการ"
        actions={<>
          <button className="btn-soft" onClick={() => go("master_tasks")}>จัดการคลังงานมาตรฐาน</button>
          <button className="btn-soft" onClick={() => downloadCsv("งานทั่วไปประจำสาขา", FAC_COLS, rows)}><Icon name="download" className="h-4 w-4" /> ส่งออก CSV (Excel)</button>
          <button className="btn-primary" onClick={() => setDlg({ mode: "add", i: -1 })}><Icon name="plus" className="h-4 w-4" /> เพิ่มงานทั่วไป</button>
        </>}
      />
      <Section>
        <div className="mb-4 grid gap-3 md:grid-cols-[1fr_16rem]">
          <div onChange={(e) => setQ((e.target as HTMLInputElement).value)}><SearchBox placeholder="ค้นหาชื่อ/รายละเอียดงาน" /></div>
          <Select options={["ความสะอาด NA", "งานทั่วไป / ซ่อมบำรุง", ...CATEGORIES]} placeholder="หมวดหมู่" value={cat} onChange={setCat} />
        </div>
        <div className="mb-4"><Tabs tabs={["ทั้งหมด", "จ่ายเอง (Manual)", "สร้างอัตโนมัติ (Routine)"]} value={mode} onChange={setMode} /></div>
        <DataTable
          columns={FAC_COLS}
          rows={shown.map((x) => x.r)}
          actions={[
            { label: "แก้ไข", onClick: (n) => setDlg({ mode: "edit", i: shown[n].i }) },
            { label: "ลบ", danger: true, onClick: (n) => confirm({ title: "ลบงานทั่วไป", message: `ต้องการลบ "${shown[n].r[0]}" ใช่หรือไม่`, danger: true, okLabel: "ลบ", onOk: () => { const r = shown[n].r; const undo = remove(shown[n].i); toast({ type: "del", title: "ลบงานทั่วไปแล้ว", detail: r[0], action: { label: "เลิกทำ", run: () => { undo(); toast(`กู้คืนงานแล้ว · ${r[0]}`); } } }); } }) },
          ]}
        />
      </Section>
      <FormDialog
        open={!!dlg} mode={dlg?.mode ?? "add"} title={dlg?.mode === "edit" ? "แก้ไขงานการดูแล" : "เพิ่มงานทั่วไปประจำสาขา"}
        fields={FAC_FIELDS} value={dlg?.mode === "edit" ? [rows[dlg.i][0], rows[dlg.i][1], rows[dlg.i][3], "", rows[dlg.i][2], ""] : undefined}
        onClose={() => setDlg(null)} saveLabel="บันทึกข้อมูล"
        onSave={(v) => {
          const r = toRow(v).slice(0, 4);
          if (dlg?.mode === "edit") update(dlg.i, r); else add(r);
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
        title="คลังงานมาตรฐาน (Master Tasks)"
        sub="จัดการชื่องานและคำสั่งงานที่เป็นมาตรฐานของศูนย์"
        actions={<>
          <button className="btn-soft" onClick={() => downloadCsv("คลังงานมาตรฐาน", MT_COLS, rows.map((r) => r.slice(0, 6)))}><Icon name="download" className="h-4 w-4" /> ส่งออก CSV</button>
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
