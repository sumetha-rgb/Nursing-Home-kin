"use client";
import { useState } from "react";
import Link from "next/link";
import Icon from "../Icon";
import { APPOINTMENTS, CONTRACTS, DAILY_LIST, RESIDENTS, TASKS, BRANCH_NAMES } from "@/lib/mock";
import { downloadCsv, useCrud } from "@/lib/store";
import { useApp } from "@/lib/app";
import { ViewId } from "@/lib/nav";
import { BlankForm, DataTable, Field, FieldDef, FormDialog, Modal, MetricGrid, PageHeader, Section, Select, Upload, Tabs } from "../ui";

/* ---------- ขั้นตอนการทำงาน ---------- */
type Step = { t: string; d: string; link: string; href?: string; go?: ViewId };

const ADMISSION: Step[] = [
  { t: "ทำใบเสนอราคาและสัญญา", d: "สร้างใบเสนอราคาใหม่ และกดปุ่มอัปเกรดเป็นสัญญาเพื่อรับผู้รับบริการ", link: "ระบบสัญญา", go: "contracts" },
  { t: "นำเข้าประวัติและวิเคราะห์ความเสี่ยง", d: "เปิดโปรไฟล์ผู้รับบริการใหม่ และกดปุ่มให้ AI วิเคราะห์ความเสี่ยงจากโรคและยา", link: "ข้อมูลผู้สูงอายุ", go: "residents" },
  { t: "นำเข้ายา (Pharmacy Hub)", d: "บันทึกข้อมูลยาทั้งหมดที่ญาตินำมาให้ เพื่อจ่ายยาให้ตรงรอบเวลา", link: "เปิด Pharmacy Hub", href: "pharmacy_app/index.html" },
  { t: "สร้างแผนการดูแล 24 ชม.", d: "ใช้ AI Careplan Designer ร่างตารางงานตลอด 24 ชั่วโมง", link: "หน้าจัดแผนดูแล", go: "quotations" },
  { t: "อนุมัติและกระจายงาน", d: "กดปุ่ม \"เปิดใช้ระบบจ่ายงานทั้งหมด\" เพื่อยิงตารางงานไปที่แอปพนักงาน (CG2)", link: "อนุมัติกระจายงาน", go: "tasks" },
];

const DAILY: Step[] = [
  { t: "ตรวจปรับปรุงประวัติและวิเคราะห์ความเสี่ยง", d: "ตรวจสอบความถูกต้องของข้อมูลผู้รับบริการและประเมินความเสี่ยง", link: "ข้อมูลผู้สูงอายุ", go: "residents" },
  { t: "อัปเดตแผนการดูแล", d: "จัดการแผนการดูแลผู้รับบริการรายบุคคล", link: "หน้ารายชื่อผู้สูงอายุ", go: "residents" },
  { t: "ตรวจสอบอัปเดตระบบยา", d: "นำเข้าข้อมูลการกินยา หรือจัดการยาประจำตัวของผู้รับบริการ", link: "เปิด Pharmacy Hub", href: "pharmacy_app/index.html" },
  { t: "กระจายงานให้แอปพนักงาน (CG2)", d: "กดปุ่มนี้ทุกเช้า เพื่อส่งงานทั้งหมดประจำวันเข้าสู่มือถือพนักงาน", link: "เปิดแอปพนักงาน (CG2)", href: "cg2.html" },
  { t: "ตรวจสอบความคืบหน้าของงาน ตรวจงาน", d: "ดูสถานะว่าพนักงานทำภารกิจสำเร็จกี่เปอร์เซ็นต์ หรือมีปัญหาอะไรไหม", link: "ผลงาน KPI (Dashboard)", go: "dashboard" },
  { t: "ตรวจสอบงานทั่วไปรายวัน", d: "จัดการงานที่ได้รับมอบหมายอื่นๆ นอกเหนือจากงานประจำวัน เช่น การซ่อมบำรุง หรือทำความสะอาดทั่วไป", link: "งานทั่วไปประจำศูนย์", go: "facility_tasks" },
  { t: "สรุปผลการประเมินผู้ดูแลและ KPI", d: "ติดตามคะแนนประเมินคุณภาพของแต่ละสาขาจากแบบสอบถามความพึงพอใจของลูกค้าและครอบครัว", link: "ผลงาน KPI (Dashboard)", go: "dashboard" },
];

function Steps({title,steps}:{title:string;steps:Step[]}) {
  const {go,toast}=useApp();
  return <Section title={title} sub="แนวทางสำหรับทีม เพื่อให้การดูแลครบถ้วนในทุกขั้นตอน"><ol className="workflow-list">{steps.map((s,i)=><li key={s.t} className="workflow-step"><span className="step-number">{String(i+1).padStart(2,"0")}</span><div><h3>{s.t}</h3><p>{s.d}</p><button className="step-link" onClick={()=>s.go?go(s.go):toast(`“${s.link}” ยังไม่เชื่อมต่อในระบบตัวอย่าง`)}>{s.link}<Icon name="arrow" className="h-3.5 w-3.5" /></button></div></li>)}</ol></Section>;
}
export function Workflow() {
  const {go}=useApp();
  const [routine,setRoutine]=useState("งานประจำวัน");
  const {rows:residents}=useCrud("residents",RESIDENTS);
  const {rows:contracts}=useCrud("contracts",CONTRACTS);
  const active=residents.filter(r=>r[5].startsWith("เข้าอยู่")).length;
  const shortcuts=[{label:"ผู้รับบริการ",sub:"ทุกข้อมูลของคนสำคัญ",icon:"user",view:"residents"},{label:"ตรวจงานวันนี้",sub:"ติดตามทุกความใส่ใจ",icon:"check",view:"tasks"},{label:"แผนการดูแล",sub:"ออกแบบการดูแลรายบุคคล",icon:"flow",view:"quotations"},{label:"ผลการดำเนินงาน",sub:"มองเห็นภาพรวมของทีม",icon:"chart",view:"dashboard"}] as const;
  return <>
    <PageHeader title="ดูแลทุกวัน ให้ดียิ่งขึ้น" sub="พื้นที่ของทีม สำหรับทุกช่วงเวลาที่สำคัญของการดูแล" actions={<button className="btn-soft" onClick={()=>go("appointments")}><Icon name="calendar" className="h-4 w-4" /> ดูตารางนัดหมาย</button>} />
    <section className="care-hero"><div className="care-hero-copy"><span className="kicker">THOUGHTFUL CARE. BEAUTIFUL EVERYDAY.</span><h2>ทุกความใส่ใจ มีความหมาย</h2><p>เชื่อมต่อคน ข้อมูล และการทำงาน<br />ให้ทีมของคุณพร้อมสำหรับทุกการดูแล</p><button className="btn-primary" onClick={()=>go("contracts")}><Icon name="plus" className="h-4 w-4" /> รับผู้รับบริการใหม่</button></div><div className="hero-art" aria-hidden="true"><div className="sculpture-petal petal-one" /><div className="sculpture-petal petal-two" /><div className="sculpture-petal petal-three" /><span className="art-label">The art of care.</span></div></section>
    <MetricGrid items={[{label:"ผู้รับบริการทั้งหมด",value:residents.length,unit:"คน",note:"ข้อมูลผู้รับบริการในระบบ",icon:"user",accent:true},{label:"กำลังรับการดูแล",value:active,unit:"คน",note:"สถานะเข้าอยู่ในศูนย์",icon:"heart"},{label:"สัญญาที่ใช้งาน",value:contracts.filter(r=>r[5]==="ใช้งานอยู่").length,unit:"สัญญา",note:"ทะเบียนสัญญาบริการ",icon:"doc"},{label:"นัดหมายที่บันทึก",value:APPOINTMENTS.length,unit:"รายการ",note:"ข้อมูลนัดหมายตัวอย่าง",icon:"calendar"}]} />
    <div className="home-shortcuts">{shortcuts.map(q=><button className="shortcut-card" key={q.view} onClick={()=>go(q.view)}><span className="shortcut-icon"><Icon name={q.icon} /><Icon name="arrow" className="h-4 w-4" /></span><strong>{q.label}</strong><small>{q.sub}</small></button>)}</div>
    <div className="overview-columns"><div><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-[17px] font-medium text-gold-800">เส้นทางการดูแล</h2><Tabs tabs={["งานประจำวัน","รับผู้รับบริการใหม่"]} value={routine} onChange={setRoutine} /></div><Steps title={routine==="งานประจำวัน"?"เริ่มวันอย่างเป็นระบบ":"ต้อนรับสมาชิกใหม่อย่างพร้อมดูแล"} steps={routine==="งานประจำวัน"?DAILY:ADMISSION} /></div><aside className="overview-sidebar"><section className="card side-section"><h2 className="section-mini-title">นัดหมายที่กำลังมาถึง<Icon name="calendar" className="h-4 w-4 text-gold-400" /></h2>{APPOINTMENTS.slice(0,3).map((a,i)=><div key={i} className="appointment-mini"><div className="appointment-date">{a[0].split("/")[0]}<small>ต.ค.</small></div><div><strong>{a[2]}</strong><p>{a[1]} น. · {a[3]}</p></div></div>)}<button className="side-link" onClick={()=>go("appointments")}>ดูนัดหมายทั้งหมด<Icon name="arrow" className="h-4 w-4" /></button></section><div className="quote-card"><span className="quote-mark">“</span><p>คุณภาพของการดูแล<br />อยู่ในรายละเอียดเล็ก ๆ<br />ที่เราใส่ใจทุกวัน</p><small>THE KIN PHILOSOPHY</small></div><Link href="/staff" className="card side-section mt-4 flex items-center gap-4"><span className="grid h-10 w-10 place-items-center rounded-xl bg-cream-100 text-gold-500"><Icon name="phone" /></span><span><strong className="block text-sm font-medium text-gold-700">พื้นที่ของทีมดูแล</strong><span className="text-xs text-gold-500">เปิดแอปพนักงาน →</span></span></Link></aside></div>
  </>;
}

/* ---------- ระบบสัญญา ---------- */
const BASE = [
  "การดูแลขั้นพื้นฐานและช่วยเหลือในกิจวัตรประจำวัน (ADL)",
  "อาหารหลัก 3 มื้อ และอาหารว่าง 1 มื้อ",
  "กิจกรรมสันทนาการตามตารางของศูนย์",
  "การวัดและบันทึกสัญญาณชีพประจำวัน",
];
const EXTRA = [
  "การให้บริการโดยทีมสหวิชาชีพ",
  "หัตถการทางการพยาบาล",
  "ยาสามัญประจำบ้าน, ยาประจำตัว, เวชภัณฑ์",
  "ของใช้ส่วนตัว (เสื้อผ้า, แพมเพิส, สบู่ ฯลฯ)",
  "อาหารทางการแพทย์ / อาหารเสริม (เพิ่มไข่, นม)",
  "ค่าบริการดูแลระหว่างไป รพ. และค่ารถ",
];

function Check({ text }: { text: string }) {
  return (
    <label className="flex items-start gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-cream-50">
      <input type="checkbox" className="mt-0.5" />
      <span>{text}</span>
    </label>
  );
}

function ContractForm({ onClose, onSave }: { onClose: () => void; onSave: (r: string[]) => void }) {
  return (
    <Section title="สัญญาปกติ Form">
      <form className="space-y-8" onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const g = (k: string) => String(f.get(k) ?? "");
        onSave([g("no") || `CT-2569-${String(Date.now()).slice(-3)}`, g("branch"), g("resident"), g("employer"), g("fee") || "-", "ใช้งานอยู่"]);
      }}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="สาขา (Branch)" required className="md:col-span-2"><Select name="branch" options={BRANCH_NAMES} placeholder="-- กรุณาเลือกสาขา --" /></Field>
          <Field label="ชื่อ นามสกุล ผู้จ้าง" required><input name="employer" required /></Field>
          <Field label="เลขที่บัตรประชาชน"><input inputMode="numeric" /></Field>
          <Field label="ที่อยู่" required className="md:col-span-2"><textarea rows={2} /></Field>
          <Field label="รูปถ่ายบัตรประชาชนผู้ว่าจ้าง" className="md:col-span-2"><Upload /></Field>
          <Field label="โทรศัพท์" required><input type="tel" /></Field>
          <Field label="เกี่ยวข้อง"><input /></Field>
          <Field label="ชื่อ นามสกุล ผู้รับบริการ" required><input name="resident" required /></Field>
          <Field label="เลขที่บัตรประชาชนผู้รับบริการ"><input inputMode="numeric" /></Field>
          <Field label="อายุ (ปี) ผู้รับบริการ"><input type="number" /></Field>
          <Field label="เลขห้อง / เตียง"><input /></Field>
          <Field label="รูปถ่ายบัตรประชาชนผู้รับบริการ" className="md:col-span-2"><Upload /></Field>
          <Field label="วันเริ่มสัญญา" required><input type="date" /></Field>
          <Field label="เลขที่สัญญา"><input name="no" /></Field>
          <Field label="ค่าบริการ/เดือน"><input name="fee" type="number" /></Field>
        </div>

        <div>
          <h3 className="mb-3 font-semibold text-gold-800">ขอบเขตการให้บริการ</h3>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-cream-300 bg-cream-50/60 p-3">
              <p className="px-3 py-2 text-sm font-medium text-gold-700">รวมอยู่ในค่าบริการพื้นฐาน:</p>
              {BASE.map((t) => <Check key={t} text={t} />)}
            </div>
            <div className="rounded-2xl border border-cream-300 bg-cream-50/60 p-3">
              <p className="px-3 py-2 text-sm font-medium text-gold-700">รายการที่มีค่าใช้จ่ายเพิ่มเติม (ไม่รวมในค่าบริการพื้นฐาน):</p>
              {EXTRA.map((t) => <Check key={t} text={t} />)}
            </div>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="ค่าบริการเพิ่มเติมรายเดือนที่ตกลงไว้ (ระบุถ้ามี)"><input /></Field>
            <Field label="แพ็กเกจเสริมอื่นๆ (ระบุถ้ามี)"><input /></Field>
            <Field label="หมายเหตุ" className="md:col-span-2"><textarea rows={2} /></Field>
            <Field label="ชำระค่าบริการล่วงหน้า"><input type="number" /></Field>
            <Field label="ชำระเงินประกัน"><input type="number" /></Field>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-soft" onClick={onClose}>ยกเลิก</button>
          <button className="btn-primary">บันทึก</button>
        </div>
      </form>
    </Section>
  );
}

const CONTRACT_FIELDS: FieldDef[] = [
  { label: "เลขที่สัญญา", required: true },
  { label: "สาขา", options: BRANCH_NAMES, required: true },
  { label: "ผู้รับบริการ", required: true },
  { label: "ผู้ว่าจ้าง", required: true },
  { label: "ค่าบริการ/เดือน", type: "number" },
  { label: "สถานะ", options: ["ใช้งานอยู่", "สิ้นสุดสัญญา", "รอชำระเงินมัดจำ"], required: true },
];
const CONTRACT_COLS = ["เลขที่สัญญา", "สาขา", "ผู้รับบริการ", "ผู้ว่าจ้าง", "ค่าบริการ/เดือน", "สถานะ"];

type Dlg = { mode: "view" | "edit"; i: number } | null;

export function Contracts() {
  const { rows, add, update, remove } = useCrud("contracts", CONTRACTS);
  const { confirm, toast } = useApp();
  const [creating, setCreating] = useState(false);
  const [sample, setSample] = useState(false);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [filter, setFilter] = useState("ทั้งหมด");
  if (creating)
    return <ContractForm onClose={() => setCreating(false)} onSave={(r) => { add(r); setCreating(false); toast("บันทึกสัญญาใหม่เรียบร้อย"); }} />;
  const shown = rows.map((r, i) => ({ r, i })).filter(({ r }) => filter.startsWith("ทั้งหมด") || r[5] === filter);
  return (
    <>
      <PageHeader
        title="ระบบสัญญา (Contracts)"
        sub="ดูแลรายละเอียดข้อตกลงบริการ ตั้งแต่วันแรกจนถึงวันสิ้นสุดสัญญา"
        actions={<>
          <button className="btn-primary" onClick={() => setCreating(true)}><Icon name="plus" className="h-4 w-4" /> เปิดสัญญาใหม่</button>
          <button className="btn-soft" onClick={() => setSample(true)}><Icon name="print" className="h-4 w-4" /> ตัวอย่าง สบส. (แบบฟอร์มเปล่า)</button>
        </>}
      />
      <MetricGrid items={[{label:"สัญญาทั้งหมด",value:rows.length,unit:"สัญญา",accent:true,icon:"doc"},{label:"ใช้งานอยู่",value:rows.filter(r=>r[5]==="ใช้งานอยู่").length,unit:"สัญญา",icon:"check"},{label:"รอชำระมัดจำ",value:rows.filter(r=>r[5]==="รอชำระเงินมัดจำ").length,unit:"สัญญา",icon:"receipt"},{label:"สิ้นสุดสัญญา",value:rows.filter(r=>r[5]==="สิ้นสุดสัญญา").length,unit:"สัญญา",icon:"files"}]} /><Section title="ทะเบียนสัญญาบริการ" actions={<Tabs tabs={["ใช้งานอยู่", "สิ้นสุดสัญญา", "รอชำระเงินมัดจำ", "ทั้งหมด"]} value={filter} onChange={setFilter} />}>
        <DataTable
          columns={CONTRACT_COLS}
          rows={shown.map((x) => x.r)}
          actions={[
            { label: "ดู", onClick: (k) => setDlg({ mode: "view", i: shown[k].i }) },
            { label: "แก้ไข", onClick: (k) => setDlg({ mode: "edit", i: shown[k].i }) },
            { label: "ลบ", danger: true, onClick: (k) => confirm({ title: "ลบสัญญา", message: `ต้องการลบสัญญา ${shown[k].r[0]} ใช่หรือไม่`, danger: true, okLabel: "ลบ", onOk: () => { remove(shown[k].i); toast("ลบสัญญาแล้ว"); } }) },
          ]}
        />
      </Section>
      <FormDialog
        open={!!dlg} mode={dlg?.mode ?? "view"} title={dlg?.mode === "edit" ? "รายละเอียด/แก้ไขสัญญา" : "รายละเอียดสัญญา"}
        fields={CONTRACT_FIELDS} value={dlg ? rows[dlg.i] : undefined} onClose={() => setDlg(null)}
        onSave={(v) => { if (dlg) update(dlg.i, v); setDlg(null); toast("บันทึกการแก้ไขแล้ว"); }} saveLabel="บันทึกการแก้ไข"
      />
      <BlankForm open={sample} title="หนังสือสัญญาว่าจ้างบริการดูแลผู้สูงอายุ (แบบฟอร์มเปล่า)" onClose={() => setSample(false)}
        lines={["สัญญาเลขที่", "วันที่", "ชื่อ นามสกุล ผู้ว่าจ้าง", "เลขที่บัตรประชาชน", "ชื่อ นามสกุล ผู้รับบริการ", "เลขห้อง / เตียง", "ค่าบริการ/เดือน", "ลายมือชื่อ ผู้ว่าจ้าง", "ลายมือชื่อ ผู้รับจ้าง", "ลายมือชื่อ พยาน"]} />
    </>
  );
}

/* ---------- ข้อมูลผู้สูงอายุ ---------- */
const RES_FIELDS: FieldDef[] = [
  { label: "ชื่อ-นามสกุล", required: true },
  { label: "อายุ", type: "number" },
  { label: "ห้อง/เตียง" },
  { label: "สาขา", options: BRANCH_NAMES, required: true },
  { label: "โรคประจำตัว", area: true },
  { label: "สถานะ", options: ["เข้าอยู่ (Active)", "แอดมิท รพ. (Hospitalized)", "ย้ายออก (Inactive)"], required: true },
];

export function Residents() {
  const { rows, update, remove } = useCrud("residents", RESIDENTS);
  const { confirm, toast } = useApp();
  const [sample, setSample] = useState(false);
  const [dlg, setDlg] = useState<Dlg>(null);
  return (
    <>
      <PageHeader
        title="ข้อมูลผู้รับบริการ (Residents)"
        sub="ทุกข้อมูลสำคัญ เพื่อการดูแลที่เข้าใจแต่ละบุคคล"
        actions={<button className="btn-soft" onClick={() => setSample(true)}><Icon name="print" className="h-4 w-4" /> ตัวอย่าง สบส. (แบบฟอร์มเปล่า)</button>}
      />
      <MetricGrid items={[{label:"ผู้รับบริการทั้งหมด",value:rows.length,unit:"คน",icon:"user",accent:true},{label:"เข้าอยู่ในศูนย์",value:rows.filter(r=>r[5].startsWith("เข้าอยู่")).length,unit:"คน",icon:"heart"},{label:"รับการรักษาที่โรงพยาบาล",value:rows.filter(r=>r[5].startsWith("แอดมิท")).length,unit:"คน",icon:"building"},{label:"ย้ายออกแล้ว",value:rows.filter(r=>r[5].startsWith("ย้ายออก")).length,unit:"คน",icon:"doc"}]} /><Section title="ทะเบียนผู้รับบริการ" sub="ค้นหาและเปิดดูรายละเอียดของผู้รับบริการแต่ละคน">
        <DataTable
          columns={["ชื่อ-นามสกุล", "อายุ", "ห้อง/เตียง", "สาขา", "โรคประจำตัว", "สถานะ"]}
          rows={rows}
          actions={[
            { label: "ดู", onClick: (i) => setDlg({ mode: "view", i }) },
            { label: "แก้ไข", onClick: (i) => setDlg({ mode: "edit", i }) },
            { label: "ลบ", danger: true, onClick: (i) => confirm({ title: "ลบข้อมูลผู้รับบริการ", message: `ต้องการลบ ${rows[i][0]} ใช่หรือไม่`, danger: true, okLabel: "ลบ", onOk: () => { remove(i); toast("ลบข้อมูลแล้ว"); } }) },
          ]}
        />
      </Section>
      <FormDialog
        open={!!dlg} mode={dlg?.mode ?? "view"} title={dlg?.mode === "edit" ? "แก้ไขข้อมูลผู้รับบริการ" : "ข้อมูลผู้รับบริการ"}
        fields={RES_FIELDS} value={dlg ? rows[dlg.i] : undefined} onClose={() => setDlg(null)}
        onSave={(v) => { if (dlg) update(dlg.i, v); setDlg(null); toast("บันทึกการแก้ไขแล้ว"); }} saveLabel="บันทึกการแก้ไข"
      />
      <BlankForm open={sample} title="แบบประเมินแรกรับ (แบบฟอร์มเปล่า)" onClose={() => setSample(false)}
        lines={["ชื่อ-สกุล ผู้รับบริการ", "สาขา", "วันเข้าอยู่ (รับดูแลเมื่อ)", "อายุ (ปี)", "BT อุณหภูมิ", "PR ชีพจร", "RR การหายใจ", "BP ความดันโลหิต", "O2SAT ออกซิเจน", "DTX น้ำตาล", "น้ำหนัก (ก.ก.)", "ส่วนสูง (ซ.ม.)", "ลงชื่อผู้ประเมิน", "วัน/เดือน/ปี ที่ประเมิน"]} />
    </>
  );
}

/* ---------- ข้อมูลงาน (Table) ---------- */
const TASK_COLS = ["วันที่", "สาขา", "ผู้รับบริการ", "หมวดหมู่", "ชื่องาน", "ผู้ทำ", "สถานะ", "เวลาที่ส่ง"];

export function TasksTable() {
  const { rows } = useCrud("tasks_table", TASKS);
  const [branch, setBranch] = useState("");
  const [view, setView] = useState<number | null>(null);
  const shown = rows.filter((r) => !branch || r[1] === branch);
  return (
    <>
      <PageHeader
        title="ข้อมูลงานรายวัน (Table)"
        sub="ดูข้อมูลงานทั้งหมดในรูปแบบตาราง Excel (สามารถโหลด Excel ได้)"
        actions={<>
          <div className="min-w-44"><Select options={BRANCH_NAMES} placeholder="รวมทุกสาขา" value={branch} onChange={setBranch} /></div>
          <button className="btn-primary" onClick={() => downloadCsv("ข้อมูลงานรายวัน", TASK_COLS, shown)}><Icon name="download" className="h-4 w-4" /> โหลด CSV</button>
        </>}
      />
      <p className="mb-4 rounded-xl bg-gold-100/70 px-4 py-2.5 text-sm text-gold-700">ข้อมูลยึดตามรอบเวร (ตัดกะ 07:00 น.)</p>
      <Section>
        <DataTable columns={TASK_COLS} rows={shown} actions={[{ label: "ดู", onClick: (i) => setView(rows.indexOf(shown[i])) }]} />
      </Section>
      <FormDialog open={view !== null} mode="view" title="รายละเอียดงาน" fields={TASK_COLS.map((label) => ({ label }))} value={view !== null ? rows[view] : undefined} onClose={() => setView(null)} onSave={() => {}} />
    </>
  );
}



