"use client";
import { useState } from "react";
import Icon from "../Icon";
import { ACTIVITY, APPOINTMENTS, BRANCH_NAMES, COMPLAINTS, DOCS, HEALTH, KPI_ROWS, RESIDENTS } from "@/lib/mock";
import { downloadCsv, useCrud } from "@/lib/store";
import { useApp } from "@/lib/app";
import ResidentProfile from "../care/ResidentProfile";
import VitalsDialog from "../care/VitalsDialog";
import { useResidents } from "@/lib/care";
import { useSession } from "@/lib/session";
import { evaluateVitals, LEVEL_TH, levelOf, parseVitals } from "@/lib/vitals";
import { BlankForm, DataTable, Field, FieldDef, FormDialog, Modal, MetricGrid, PageHeader, Section, Select, Tabs, Toggle } from "../ui";

/* ---------- ผลงาน KPI ---------- */
const KPI_COLS = ["สาขา", "% สำเร็จ", "% สุ่มตรวจ", "ดาวญาติ", "งาน/คน", "% ความพึงพอใจ", "คอมเพลน", "คะแนนรวม"];
const KPI_MONTH = [
  ["กรุงเทพมหานคร", "90%", "44%", "2,310", "6.1", "93%", "1", "260.0"],
  ["เชียงใหม่", "86%", "39%", "1,742", "5.7", "90%", "2", "231.0"],
  ["ขอนแก่น", "79%", "33%", "1,260", "5.0", "88%", "1", "186.5"],
];
const SHIFT: Record<string, { done: [number, number, number]; check: [number, number, number]; m: string; n: string }> = {
  "": { done: [48, 42, 88], check: [42, 30, 71], m: "พนักงาน 8 คน ทำเสร็จ 6 คน", n: "พนักงาน 5 คน ทำเสร็จ 2 คน" },
  กรุงเทพมหานคร: { done: [20, 19, 95], check: [19, 15, 79], m: "พนักงาน 4 คน ทำเสร็จ 4 คน", n: "พนักงาน 2 คน ทำเสร็จ 1 คน" },
  เชียงใหม่: { done: [16, 14, 88], check: [14, 10, 71], m: "พนักงาน 2 คน ทำเสร็จ 1 คน", n: "พนักงาน 2 คน ทำเสร็จ 1 คน" },
  ขอนแก่น: { done: [12, 9, 75], check: [9, 5, 56], m: "พนักงาน 2 คน ทำเสร็จ 1 คน", n: "พนักงาน 1 คน ทำเสร็จ 0 คน" },
};

export function Dashboard() {
  const { toast, confirm } = useApp();
  const [range, setRange] = useState("วันนี้ (รายวัน)");
  const [msg, setMsg] = useState(false);
  const [to, setTo] = useState("");
  const [text, setText] = useState("");
  const [praised, setPraised] = useState<string[]>([]);
  const [shiftBranch, setShiftBranch] = useState("");
  const kpi = range.startsWith("วันนี้") ? KPI_ROWS : KPI_MONTH;
  const sh = SHIFT[shiftBranch];

  return (
    <>
      <PageHeader title="ผลการดำเนินงาน" sub="มองเห็นความก้าวหน้า ร่วมพัฒนาคุณภาพการดูแลของทุกสาขา" /><MetricGrid items={[{label:"งานที่สั่งทั้งหมด",value:sh.done[0],unit:"งาน",accent:true,icon:"check"},{label:"ดำเนินการแล้ว",value:sh.done[1],unit:"งาน",icon:"check"},{label:"อัตรางานสำเร็จ",value:sh.done[2]+"%",note:"ตามสาขาที่เลือกในสรุปกะ",icon:"chart"},{label:"อัตราการตรวจงาน",value:sh.check[2]+"%",note:"งานที่ผ่านการตรวจของผู้จัดการ",icon:"search"}]} />

      <Section
        title="คุณภาพการดูแลของแต่ละสาขา"
        sub="เป้าหมายความสำเร็จและคุณภาพบริการของแต่ละสาขา"
        actions={<>
          <button className="btn-primary" onClick={() => confirm({ title: "จ่ายงานอัตโนมัติเช้านี้", message: "ต้องการจ่ายงานอัตโนมัติให้พนักงานทุกคนในทุกสาขา ใช่หรือไม่", okLabel: "จ่ายงาน", onOk: () => toast("จ่ายงานอัตโนมัติเรียบร้อย 48 งาน") })}><Icon name="cpu" className="h-4 w-4" /> จ่ายงานอัตโนมัติเช้านี้ (ทุกคน/ทุกสาขา)</button>
          <button className="btn-soft" onClick={() => downloadCsv("KPI-" + range, KPI_COLS, kpi)}><Icon name="download" className="h-4 w-4" /> โหลด Excel</button>
        </>}
      >
        <div className="mb-4"><Tabs tabs={["วันนี้ (รายวัน)", "เดือนนี้ (รายเดือน)"]} value={range} onChange={setRange} /></div>

        <details className="group mb-5 rounded-xl border border-cream-300 bg-cream-50">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-gold-700">
            คำอธิบายวิธีอ่านค่าและคำนวณคะแนน KPI (คลิกเพื่อดูรายละเอียด)
            <Icon name="chevron" className="h-4 w-4 transition group-open:rotate-180" />
          </summary>
          <ul className="space-y-2 border-t border-cream-300 px-4 py-4 text-sm text-gold-700">
            <li><b>% งานสำเร็จ:</b> งานที่ทำเสร็จ หารด้วย งานที่ถูกสั่งทั้งหมด</li>
            <li><b>% สุ่มตรวจงาน:</b> งานที่แอดมิน กดสุ่มตรวจแล้ว หารด้วย งานที่ทำเสร็จทั้งหมด</li>
            <li><b>ดาวญาติ:</b> รวมดาวจากแอปญาติทั้งหมดที่กดชื่นชมพนักงาน</li>
            <li><b>งานเฉลี่ย/คน:</b> งานที่ทำเสร็จ หารด้วย จำนวนผู้สูงอายุในสาขา</li>
            <li><b>% ความพึงพอใจ:</b> ประเมินความพึงพอใจ (คลิกที่หัวตารางเพื่อเปิดแบบฟอร์ม)</li>
            <li><b>คอมเพลน:</b> จำนวนข้อร้องเรียน (ระบบในอนาคต)</li>
            <li className="rounded-lg bg-gold-100 px-3 py-2 font-medium">สูตรคำนวณคะแนนรวม = (% สำเร็จ x 1) + (% สุ่มตรวจ x 0.5) + (รวมดาว x 10)</li>
          </ul>
        </details>

        <DataTable columns={KPI_COLS} rows={kpi} />
      </Section>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Section title="ความใส่ใจจากทีมของเรา" sub="ติดตามงานที่เพิ่งทำเสร็จของพนักงานในทีม และกดชื่นชมเพื่อเป็นกำลังใจ">
          <ul className="divide-y divide-cream-300/70 rounded-xl border border-cream-300/70">
            {ACTIVITY.map((a) => {
              const on = praised.includes(a.t);
              return (
                <li key={a.t} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span className="min-w-0"><b className="font-medium">{a.who}</b> <span className="text-gold-600">{a.what}</span><span className="ml-2 text-xs text-gold-500">{a.t}</span></span>
                  <button
                    className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition ${on ? "bg-gold-700 text-white" : "bg-cream-200 text-gold-700 hover:bg-cream-300"}`}
                    onClick={() => { setPraised(on ? praised.filter((x) => x !== a.t) : [...praised, a.t]); if (!on) toast(`ชื่นชม ${a.who} แล้ว`); }}
                  >{on ? "ชื่นชมแล้ว" : "ชื่นชม"}</button>
                </li>
              );
            })}
          </ul>
          <button className="btn-soft mt-4 w-full" onClick={() => setMsg(true)}>ส่งกำลังใจให้สาขา</button>
        </Section>

        <Section title="ควบคุมงานประจำวันกะเช้า-ดึก" sub="ติดตามสถานะงานแบบเรียลไทม์ และสัดส่วนการตรวจงาน" actions={<div className="min-w-40"><Select options={BRANCH_NAMES} placeholder="รวมทุกสาขา" value={shiftBranch} onChange={setShiftBranch} /></div>}>
          <h3 className="mb-3 text-sm font-semibold text-gold-700">สถานะกะการทำงาน</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              { t: "สัดส่วนการทำเสร็จ", a: "สั่งงานรวม", b: "ทำเสร็จแล้ว", v: sh.done },
              { t: "สัดส่วนการตรวจงาน", a: "พนักงานทำเสร็จ", b: "ผจก.ตรวจแล้ว", v: sh.check },
            ].map((c) => (
              <div key={c.t} className="rounded-2xl border border-cream-300 bg-cream-50 p-4">
                <p className="mb-3 text-sm font-medium text-gold-800">{c.t}</p>
                <div className="flex items-end justify-between text-sm">
                  <div><p className="text-gold-500">{c.a}</p><p className="text-lg font-semibold">{c.v[0]}</p></div>
                  <div><p className="text-gold-500">{c.b}</p><p className="text-lg font-semibold">{c.v[1]}</p></div>
                  <p className="text-xl font-semibold text-gold-700">{c.v[2]} %</p>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-cream-300"><div className="h-full rounded-full bg-gold-600" style={{ width: `${c.v[2]}%` }} /></div>
              </div>
            ))}
          </div>
          <h3 className="mb-3 mt-6 text-sm font-semibold text-gold-700">สถานะรายบุคคล</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            {[["เช้า", sh.m], ["ดึก", sh.n]].map(([s, t]) => (
              <div key={s} className="rounded-xl border border-cream-300 p-4 text-sm">
                <p className="font-medium text-gold-800">{s}</p>
                <p className="mt-1 text-gold-600">{t}</p>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Modal
        open={msg} title="ส่งกำลังใจให้สาขา" onClose={() => setMsg(false)}
        footer={<button className="btn-primary" onClick={() => {
          if (!to || !text.trim()) { toast("กรุณาเลือกสาขาและพิมพ์ข้อความ"); return; }
          setMsg(false); setText(""); toast(`ส่งกำลังใจไปยังสาขา${to}แล้ว`);
        }}>ส่งกำลังใจ</button>}
      >
        <div className="space-y-4">
          <Field label="ส่งข้อความชื่นชมไปยัง"><Select options={BRANCH_NAMES} placeholder="-- เลือกสาขา --" value={to} onChange={setTo} /></Field>
          <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
      </Modal>
    </>
  );
}

/* ---------- ระบบตารางนัดหมาย ---------- */
const APPT_FIELDS: FieldDef[] = [
  { label: "วันที่ (วว/ดด/ปปปป)", type: "text", required: true },
  { label: "เวลา", type: "time", required: true },
  { label: "ผู้รับบริการ", options: RESIDENTS.map((r) => r[0]), required: true },
  { label: "รายการ", required: true },
  { label: "ผู้ดูแล" },
];

export function Appointments() {
  const { rows, add, update, remove } = useCrud("appointments", APPOINTMENTS);
  const { toast, confirm } = useApp();
  const [dlg, setDlg] = useState<{ mode: "add" | "edit"; i: number } | null>(null);
  return (
    <div>
      <PageHeader title="ตารางนัดหมาย" sub="วางแผนการพบแพทย์และธุระสำคัญ ให้ทุกการดูแลเป็นไปอย่างต่อเนื่อง" actions={<button className="btn-primary" onClick={()=>setDlg({mode:"add",i:-1})}><Icon name="plus" className="h-4 w-4" />เพิ่มนัดหมาย</button>} />
      <div className="mb-5 flex items-center gap-3 rounded-xl border border-cream-200 bg-cream-100/50 px-5 py-3 text-xs text-gold-600"><Icon name="calendar" className="h-4 w-4" />โหมดตัวอย่าง · ทดลองเพิ่มและจัดการนัดหมายได้ ข้อมูลจะเริ่มต้นใหม่เมื่อรีเฟรช</div>
      <div className="mt-6 text-left">
        <Section title="ตัวอย่างตารางนัดหมาย" actions={<button className="btn-soft" onClick={() => setDlg({ mode: "add", i: -1 })}><Icon name="plus" className="h-4 w-4" /> เพิ่มนัดหมาย</button>}>
          <DataTable
            columns={["วันที่", "เวลา", "ผู้รับบริการ", "รายการ", "ผู้ดูแล"]}
            rows={rows}
            actions={[
              { label: "แก้ไข", onClick: (i) => setDlg({ mode: "edit", i }) },
              { label: "ลบ", danger: true, onClick: (i) => confirm({ title: "ลบนัดหมาย", message: `ต้องการลบนัดหมาย "${rows[i][3]}" ใช่หรือไม่`, danger: true, okLabel: "ลบ", onOk: () => { remove(i); toast("ลบนัดหมายแล้ว"); } }) },
            ]}
          />
        </Section>
      </div>
      <FormDialog
        open={!!dlg} mode={dlg?.mode ?? "add"} title={dlg?.mode === "edit" ? "แก้ไขนัดหมาย" : "เพิ่มนัดหมาย (ทดสอบ)"}
        fields={APPT_FIELDS} value={dlg?.mode === "edit" ? rows[dlg.i] : undefined} onClose={() => setDlg(null)}
        onSave={(v) => { if (dlg?.mode === "edit") update(dlg.i, v); else add(v); setDlg(null); toast("บันทึกนัดหมายแล้ว"); }}
      />
    </div>
  );
}

/* ---------- รายงานสุขภาพ ---------- */
const HEALTH_COLS = ["วัน-เวลา", "ชื่อผู้สูงอายุ", "สัญญาณชีพ (Vital Signs)", "O2 Sat", "DTX", "น้ำหนัก/ส่วนสูง", "ข้อมูลอื่น", "โน้ต / อาการ", "ผู้บันทึก"];

export function HealthLogs() {
  const { rows, add } = useCrud("health", HEALTH);
  const { toast } = useApp();
  const { user } = useSession();
  const { residents } = useResidents();
  const [record, setRecord] = useState(false);
  const [profile, setProfile] = useState<string | null>(null);
  const names = residents.length ? residents.map((r) => r.full_name) : RESIDENTS.map((r) => r[0]);
  const levelCol = (r: string[]) => LEVEL_TH[levelOf(evaluateVitals(parseVitals(r[2], r[3], r[4])))];
  const [person, setPerson] = useState("");
  const [applied, setApplied] = useState("");
  const [sample, setSample] = useState(false);
  const [view, setView] = useState<number | null>(null);
  const shown = rows.filter((r) => !applied || r[1] === applied);
  return (
    <>
      <PageHeader title="รายงานข้อมูลสุขภาพ (Health Logs)" sub="ดูบันทึกสัญญาณชีพและการประเมินต่างๆ ของผู้สูงอายุ · ค่าที่เกินเกณฑ์ระบบแจ้งเตือนพยาบาลให้เอง"
        actions={<button className="btn-primary" onClick={() => setRecord(true)}><Icon name="plus" className="h-4 w-4" /> บันทึกสัญญาณชีพ</button>} />
      <Section>
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select options={BRANCH_NAMES} placeholder="-- ทุกสาขา --" />
          <Select options={names} placeholder="-- ทุกคน --" value={person} onChange={setPerson} />
          <div className="flex min-w-0 items-center gap-2 sm:col-span-2 lg:col-span-2">
            <input type="date" aria-label="วันที่เริ่มต้น" className="min-w-0 flex-1" />
            <span className="shrink-0 text-sm text-gold-600">ถึง</span>
            <input type="date" aria-label="วันที่สิ้นสุด" className="min-w-0 flex-1" />
          </div>
        </div>
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <button className="btn-primary sm:ml-auto" onClick={() => { setApplied(person); toast("อัปเดตข้อมูลแล้ว"); }}>ดูข้อมูล</button>
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

/* ---------- ประเมินและร้องเรียน ---------- */
const COMPLAINT_FIELDS: FieldDef[] = [
  { label: "วันเวลา" },
  { label: "สาขา", options: BRANCH_NAMES },
  { label: "ปัญหาที่ร้องเรียน", area: true },
  { label: "เบอร์ติดต่อกลับ", type: "tel" },
  { label: "สถานะ", options: ["รอดำเนินการ", "กำลังดำเนินการ", "แก้ไขแล้ว"], required: true },
];

export function Feedbacks() {
  const { rows, update, remove } = useCrud("complaints", COMPLAINTS);
  const { toast, confirm } = useApp();
  const [modal, setModal] = useState<null | "share" | "line" | "survey">(null);
  const [branch, setBranch] = useState("");
  const [row, setRow] = useState<number | null>(null);
  const close = () => setModal(null);
  const url = typeof window !== "undefined" ? `${window.location.origin}/survey?branch=${encodeURIComponent(branch)}` : "";
  const copy = async () => {
    if (!branch) { toast("กรุณาเลือกสาขาก่อน"); return; }
    try { await navigator.clipboard.writeText(url); toast("คัดลอกลิงก์แล้ว"); } catch { toast(url); }
  };
  const urgent = rows.filter((r) => r[4] === "รอดำเนินการ").length;
  return (
    <>
      <PageHeader
        title="เสียงจากครอบครัว"
        actions={<>
          <button className="btn-soft" onClick={() => setModal("share")}><Icon name="qr" className="h-4 w-4" /> ป้าย QR ร้องเรียน</button>
          <button className="btn-soft" onClick={() => setModal("share")}>ลิงก์ประเมินความพึงพอใจ</button>
          <button className="btn-soft" onClick={() => toast("รีเฟรชข้อมูลแล้ว")}><Icon name="refresh" className="h-4 w-4" /> รีเฟรชข้อมูล</button>
        </>}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="card p-5"><p className="text-sm text-gold-600">เรื่องร้องเรียนด่วน</p><p className="mt-1 text-3xl font-semibold text-gold-800">{urgent}</p></div>
        <button className="card p-5 text-left transition hover:border-gold-400" onClick={() => setModal("survey")}><p className="text-sm font-medium text-gold-800">ประเมินความพึงพอใจ</p></button>
        <button className="card p-5 text-left transition hover:border-gold-400" onClick={() => setModal("line")}><p className="text-sm font-medium text-gold-800">ตั้งค่าระบบ LINE</p></button>
      </div>
      <Section>
        <DataTable
          columns={["วันเวลา", "สาขา", "ปัญหาที่ร้องเรียน", "เบอร์ติดต่อกลับ", "สถานะ"]}
          rows={rows}
          actions={[
            { label: "ตรวจสอบ", onClick: (i) => setRow(i) },
            { label: "ลบ", danger: true, onClick: (i) => confirm({ title: "ลบเรื่องร้องเรียน", message: "ต้องการลบรายการนี้ใช่หรือไม่", danger: true, okLabel: "ลบ", onOk: () => { remove(i); toast("ลบรายการแล้ว"); } }) },
          ]}
        />
      </Section>

      <FormDialog
        open={row !== null} mode="edit" title="จัดการเรื่องร้องเรียน" fields={COMPLAINT_FIELDS} value={row !== null ? rows[row] : undefined}
        onClose={() => setRow(null)} onSave={(v) => { if (row !== null) update(row, v); setRow(null); toast("อัปเดตสถานะแล้ว"); }}
      />

      <Modal open={modal === "line"} title="ตั้งค่าเชื่อมต่อ LINE Messaging API" onClose={close} footer={<><button className="btn-soft" onClick={close}>ยกเลิก</button><button className="btn-primary" onClick={() => { close(); toast("บันทึกการตั้งค่า LINE แล้ว"); }}>บันทึกการตั้งค่า LINE</button></>}>
        <p className="mb-5 text-sm text-gold-600">กำหนดค่า LINE Channel Access Token และ LINE Group ID เพื่อให้ระบบสามารถดึงไปใช้ในการส่งแจ้งเตือนหรือบรอดแคสต์แบบประเมินได้ในอนาคต</p>
        <div className="space-y-4">
          <Toggle label="สถานะการใช้งาน LINE Bot" hint="เปิดเพื่ออนุญาตให้หุ่นยนต์ส่งข้อความแจ้งเตือน" />
          <Field label="เลือกสาขาที่ต้องการตั้งค่า:"><Select options={BRANCH_NAMES} /></Field>
          <Field label="1. LINE Channel Access Token" required><input /><p className="mt-1 text-xs text-gold-500">เอามาจากเว็บ LINE Developers (Long-lived token)</p></Field>
          <Field label="2. LINE Group ID (สำหรับกลุ่มผู้บริหารสาขา/แอดมินรับแจ้งเตือน)"><input /><p className="mt-1 text-xs text-gold-500">ไอดีของกลุ่มผู้บริหาร เพื่อรับแจ้งเตือนเวลามีเรื่องร้องเรียนด่วน</p></Field>
        </div>
      </Modal>

      <Modal open={modal === "share"} title="สร้างลิงก์และป้าย QR Code" onClose={close}>
        <Field label="เลือกสาขาที่ต้องการสร้างลิงก์"><Select options={BRANCH_NAMES} placeholder="-- เลือกสาขา --" value={branch} onChange={setBranch} /></Field>
        <div className="mt-5 space-y-4">
          <div className="rounded-2xl border border-cream-300 bg-cream-50 p-4">
            <p className="font-medium text-gold-800">1. แบบประเมินความพึงพอใจ</p>
            <p className="mb-3 text-sm text-gold-600">คัดลอกลิงก์ส่งให้ญาติทาง LINE</p>
            {branch && <p className="mb-3 break-all rounded-lg bg-white px-3 py-2 text-xs text-gold-700">{url}</p>}
            <button className="btn-soft w-full sm:w-auto" onClick={copy}>คัดลอกลิงก์</button>
          </div>
          <div className="rounded-2xl border border-cream-300 bg-cream-50 p-4">
            <p className="font-medium text-gold-800">2. ช่องทางร้องเรียนด่วน</p>
            <p className="mb-3 text-sm text-gold-600">ปริ้นท์เป็นป้ายตั้งโต๊ะไว้ที่ศูนย์</p>
            <button className="btn-primary w-full sm:w-auto" onClick={() => (branch ? window.print() : toast("กรุณาเลือกสาขาก่อน"))}><Icon name="print" className="h-4 w-4" /> พิมพ์ป้าย QR Code ตั้งโต๊ะ (A4)</button>
          </div>
        </div>
      </Modal>

      <Modal open={modal === "survey"} title="แบบประเมินความพึงพอใจ" onClose={close} footer={<><button className="btn-soft" onClick={close}>ยกเลิก</button><button className="btn-primary" onClick={() => { close(); toast("ส่งแบบประเมินแล้ว ขอบคุณครับ"); }}>ส่งแบบประเมิน</button></>}>
        <p className="mb-5 text-sm text-gold-600">กรุณากรอกแบบฟอร์มเพื่อประเมินความพึงพอใจในการให้บริการ ข้อมูลของคุณจะถูกนำไปพัฒนาและปรับปรุงคุณภาพต่อไป</p>
        <div className="space-y-4">
          <Field label="สาขาที่รับบริการ" required><Select options={BRANCH_NAMES} /></Field>
          <Field label="ชื่อผู้ประเมิน" required><input /></Field>
          <Field label="ความพึงพอใจโดยรวม" required><Select options={["5 (ดีมาก)", "4 (ดี)", "3 (ปานกลาง)", "2 (พอใช้)", "1 (ปรับปรุง)"]} /></Field>
          <Field label="ข้อเสนอแนะเพิ่มเติม"><textarea rows={3} /></Field>
        </div>
      </Modal>
    </>
  );
}

/* ---------- เอกสารระเบียบราชการ ---------- */
export function OfficialDocs() {
  const { rows, remove } = useCrud("docs", DOCS);
  const { toast, confirm } = useApp();
  const [view, setView] = useState<number | null>(null);
  return (
    <>
      <PageHeader title="เอกสารระเบียบราชการ" sub="ระบบจัดการเอกสารและระเบียบต่างๆ" />
      <div className="card mx-auto max-w-xl p-10 text-center">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-gold-100 text-gold-600"><Icon name="files" className="h-8 w-8" /></span>
        <h2 className="mt-5 text-lg font-semibold text-gold-800">กำลังอยู่ระหว่างการพัฒนา</h2>
        <p className="mt-2 text-sm text-gold-600">เมนูเอกสารระเบียบราชการ จะเปิดให้ใช้งานในเร็วๆ นี้ครับ</p>
      </div>
      <div className="mt-6">
        <Section title="ตัวอย่างรายการเอกสาร">
          <DataTable
            columns={["ชื่อเอกสาร", "ประเภท", "วันที่", "สถานะ"]}
            rows={rows}
            actions={[
              { label: "ดู", onClick: (i) => setView(i) },
              { label: "ลบ", danger: true, onClick: (i) => confirm({ title: "ลบเอกสาร", message: `ต้องการลบ "${rows[i][0]}" ใช่หรือไม่`, danger: true, okLabel: "ลบ", onOk: () => { remove(i); toast("ลบเอกสารแล้ว"); } }) },
            ]}
          />
        </Section>
      </div>
      <FormDialog open={view !== null} mode="view" title="รายละเอียดเอกสาร" fields={["ชื่อเอกสาร", "ประเภท", "วันที่", "สถานะ"].map((label) => ({ label }))} value={view !== null ? rows[view] : undefined} onClose={() => setView(null)} onSave={() => {}} />
    </>
  );
}
