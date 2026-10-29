"use client";
import { useState } from "react";
import { useBranchNames, withBranches } from "@/lib/branches";
import Link from "next/link";
import Icon from "../Icon";
import { APPOINTMENTS, CONTRACTS, DAILY_LIST, RESIDENTS, TASKS, BRANCH_NAMES } from "@/lib/mock";
import { downloadCsv, useCrud, useRecords } from "@/lib/store";
import { balanceOf, docDate, Invoice, isOpen, money, todayIso, UNPAID, VOID } from "@/lib/billing";
import { contractInvoice } from "./Billing";
import { apptIso, TH_MONTHS, upcomingAppts } from "@/lib/appointments";
import { useApp } from "@/lib/app";
import { ViewId } from "@/lib/nav";
import FamilyLinkDialog from "../care/FamilyLinkDialog";
import FamilyHub from "../care/FamilyHub";
import ResidentProfile from "../care/ResidentProfile";
import RoomCard from "../care/RoomCard";
import Occupancy from "../care/Occupancy";
import PhotoPicker from "../PhotoPicker";
import { useSession } from "@/lib/session";
import { can } from "@/lib/perms";
import { findRoom, freeBed, RoomInfo, roomInfos, roomKey, roomProblem, staying, withRoom } from "@/lib/rooms";
import { BlankForm, DataTable, Field, FieldDef, FormDialog, Modal, MetricGrid, PageHeader, PrintSignatures, Section, Select, Tabs } from "../ui";

/* ---------- ขั้นตอนการทำงาน ---------- */
type Step = { t: string; d: string; link: string; href?: string; go?: ViewId };

const ADMISSION: Step[] = [
  { t: "ทำใบเสนอราคาและสัญญา", d: "สร้างใบเสนอราคาใหม่ และกดปุ่มอัปเกรดเป็นสัญญาเพื่อรับผู้รับบริการ", link: "ระบบสัญญา", go: "contracts" },
  { t: "นำเข้าประวัติและวิเคราะห์ความเสี่ยง", d: "เปิดโปรไฟล์ผู้รับบริการใหม่ และกดปุ่มให้ AI วิเคราะห์ความเสี่ยงจากโรคและยา", link: "ข้อมูลผู้สูงอายุ", go: "residents" },
  { t: "นำเข้ายา (Pharmacy Hub)", d: "บันทึกข้อมูลยาทั้งหมดที่ญาตินำมาให้ เพื่อจ่ายยาให้ตรงรอบเวลา", link: "เปิด Pharmacy Hub", href: "/pharmacy?page=inventory" },
  { t: "สร้างแผนการดูแล 24 ชม.", d: "ใช้ AI Careplan Designer ร่างตารางงานตลอด 24 ชั่วโมง", link: "หน้าจัดแผนดูแล", go: "quotations" },
  { t: "อนุมัติและกระจายงาน", d: "กดปุ่ม \"เปิดใช้ระบบจ่ายงานทั้งหมด\" เพื่อยิงตารางงานไปที่แอปพนักงาน (KinApp)", link: "อนุมัติกระจายงาน", go: "tasks" },
];

const DAILY: Step[] = [
  { t: "ตรวจปรับปรุงประวัติและวิเคราะห์ความเสี่ยง", d: "ตรวจสอบความถูกต้องของข้อมูลผู้รับบริการและประเมินความเสี่ยง", link: "ข้อมูลผู้สูงอายุ", go: "residents" },
  { t: "อัปเดตแผนการดูแล", d: "จัดการแผนการดูแลผู้รับบริการรายบุคคล", link: "หน้ารายชื่อผู้สูงอายุ", go: "residents" },
  { t: "ตรวจสอบอัปเดตระบบยา", d: "นำเข้าข้อมูลการกินยา หรือจัดการยาประจำตัวของผู้รับบริการ", link: "เปิด Pharmacy Hub", href: "/pharmacy" },
  { t: "กระจายงานให้แอปพนักงาน (KinApp)", d: "กดปุ่มนี้ทุกเช้า เพื่อส่งงานทั้งหมดประจำวันเข้าสู่มือถือพนักงาน", link: "เปิดแอปพนักงาน (KinApp)", href: "cg2.html" },
  { t: "ตรวจสอบความคืบหน้าของงาน ตรวจงาน", d: "ดูสถานะว่าพนักงานทำภารกิจสำเร็จกี่เปอร์เซ็นต์ หรือมีปัญหาอะไรไหม", link: "ผลงาน KPI (Dashboard)", go: "dashboard" },
  { t: "ตรวจสอบงานทั่วไปรายวัน", d: "จัดการงานที่ได้รับมอบหมายอื่นๆ นอกเหนือจากงานประจำวัน เช่น การซ่อมบำรุง หรือทำความสะอาดทั่วไป", link: "งานทั่วไปประจำศูนย์", go: "facility_tasks" },
  { t: "สรุปผลการประเมินผู้ดูแลและ KPI", d: "ติดตามคะแนนประเมินคุณภาพของแต่ละสาขาจากแบบสอบถามความพึงพอใจของลูกค้าและครอบครัว", link: "ผลงาน KPI (Dashboard)", go: "dashboard" },
];

function Steps({title,steps}:{title:string;steps:Step[]}) {
  const {go,toast}=useApp();
  return <Section title={title} sub="แนวทางสำหรับทีม เพื่อให้การดูแลครบถ้วนในทุกขั้นตอน"><ol className="workflow-list">{steps.map((s,i)=><li key={s.t} className="workflow-step"><span className="step-number">{String(i+1).padStart(2,"0")}</span><div><h3>{s.t}</h3><p>{s.d}</p><button className="step-link" onClick={()=>s.go?go(s.go):s.href?.startsWith("/")?window.location.assign(s.href):toast(`“${s.link}” ยังไม่เชื่อมต่อในระบบตัวอย่าง`)}>{s.link}<Icon name="arrow" className="h-3.5 w-3.5" /></button></div></li>)}</ol></Section>;
}
export function Workflow() {
  const {go}=useApp();
  const [routine,setRoutine]=useState("งานประจำวัน");
  const {rows:residents}=useCrud("residents",RESIDENTS);
  const {rows:contracts}=useCrud("contracts",CONTRACTS);
  const {rows:apptRows}=useCrud("appointments",APPOINTMENTS);
  const upcoming=upcomingAppts(apptRows);
  const active=residents.filter(r=>r[5].startsWith("เข้าอยู่")).length;
  const shortcuts=[{label:"ผู้รับบริการ",sub:"ทุกข้อมูลของคนสำคัญ",icon:"user",view:"residents"},{label:"ตรวจงานวันนี้",sub:"ติดตามทุกความใส่ใจ",icon:"check",view:"tasks"},{label:"แผนการดูแล",sub:"ออกแบบการดูแลรายบุคคล",icon:"flow",view:"quotations"},{label:"ผลการดำเนินงาน",sub:"มองเห็นภาพรวมของทีม",icon:"chart",view:"dashboard"}] as const;
  return <>
    <PageHeader title="ดูแลทุกวัน ให้ดียิ่งขึ้น" sub="พื้นที่ของทีม สำหรับทุกช่วงเวลาที่สำคัญของการดูแล" actions={<button className="btn-soft" onClick={()=>go("appointments")}><Icon name="calendar" className="h-4 w-4" /> ดูตารางนัดหมาย</button>} />
    <section className="care-hero"><div className="care-hero-copy"><span className="kicker">THOUGHTFUL CARE. BEAUTIFUL EVERYDAY.</span><h2>ทุกความใส่ใจ มีความหมาย</h2><p>เชื่อมต่อคน ข้อมูล และการทำงาน<br />ให้ทีมของคุณพร้อมสำหรับทุกการดูแล</p><button className="btn-primary" onClick={()=>go("contracts")}><Icon name="plus" className="h-4 w-4" /> รับผู้รับบริการใหม่</button></div><div className="hero-art" aria-hidden="true"><div className="sculpture-petal petal-one" /><div className="sculpture-petal petal-two" /><div className="sculpture-petal petal-three" /><span className="art-label">The art of care.</span></div></section>
    <Occupancy />
    <MetricGrid items={[{label:"ผู้รับบริการทั้งหมด",value:residents.length,unit:"คน",note:"ข้อมูลผู้รับบริการในระบบ",icon:"user",accent:true},{label:"กำลังรับการดูแล",value:active,unit:"คน",note:"สถานะเข้าอยู่ในศูนย์",icon:"heart"},{label:"สัญญาที่ใช้งาน",value:contracts.filter(r=>r[5]==="ใช้งานอยู่").length,unit:"สัญญา",note:"ทะเบียนสัญญาบริการ",icon:"doc"},{label:"นัดหมายที่กำลังจะมาถึง",value:upcoming.length,unit:"นัด",note:"จากตารางนัดหมาย",icon:"calendar"}]} />
    <div className="home-shortcuts">{shortcuts.map(q=><button className="shortcut-card" key={q.view} onClick={()=>go(q.view)}><span className="shortcut-icon"><Icon name={q.icon} /><Icon name="arrow" className="h-4 w-4" /></span><strong>{q.label}</strong><small>{q.sub}</small></button>)}</div>
    <div className="overview-columns"><div><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-[17px] font-medium text-gold-800">เส้นทางการดูแล</h2><Tabs tabs={["งานประจำวัน","รับผู้รับบริการใหม่"]} value={routine} onChange={setRoutine} /></div><Steps title={routine==="งานประจำวัน"?"เริ่มวันอย่างเป็นระบบ":"ต้อนรับสมาชิกใหม่อย่างพร้อมดูแล"} steps={routine==="งานประจำวัน"?DAILY:ADMISSION} /></div><aside className="overview-sidebar"><section className="card side-section"><h2 className="section-mini-title">นัดหมายที่กำลังมาถึง<Icon name="calendar" className="h-4 w-4 text-gold-400" /></h2>{upcoming.length?upcoming.slice(0,3).map(({r:a},i)=>{const d=apptIso(a[0]);return <div key={i} className="appointment-mini"><div className="appointment-date">{Number(d.slice(8,10))}<small>{TH_MONTHS[Number(d.slice(5,7))-1]}</small></div><div><strong>{a[2]}</strong><p>{(a[1]??"").slice(0,5)} น. · {a[3]}</p></div></div>;}):<p className="py-3 text-sm text-gold-500">ยังไม่มีนัดหมายที่กำลังจะมาถึง</p>}<button className="side-link" onClick={()=>go("appointments")}>ดูนัดหมายทั้งหมด<Icon name="arrow" className="h-4 w-4" /></button></section><div className="quote-card"><span className="quote-mark">“</span><p>คุณภาพของการดูแล<br />อยู่ในรายละเอียดเล็ก ๆ<br />ที่เราใส่ใจทุกวัน</p><small>THE KIN PHILOSOPHY</small></div><Link href="/staff" className="card side-section mt-4 flex items-center gap-4"><span className="grid h-10 w-10 place-items-center rounded-xl bg-cream-100 text-gold-500"><Icon name="phone" /></span><span><strong className="block text-sm font-medium text-gold-700">พื้นที่ของทีมดูแล</strong><span className="text-xs text-gold-500">เปิดแอปพนักงาน →</span></span></Link></aside></div>
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

function Check({ text, name, checked }: { text: string; name: string; checked?: boolean }) {
  return (
    <label className="flex items-start gap-3 rounded-xl px-3 py-2.5 text-sm hover:bg-cream-50">
      <input type="checkbox" name={name} value={text} defaultChecked={checked} className="mt-0.5" />
      <span>{text}</span>
    </label>
  );
}

const CONTRACT_STATUSES = ["ใช้งานอยู่", "รอชำระเงินมัดจำ", "สิ้นสุดสัญญา", "ยกเลิกสัญญา"];
const CANCELLED = "ยกเลิกสัญญา";
/** พิมพ์ได้เฉพาะตัวเลข ไม่เกิน max หลัก */
const digitsOnly = (max: number) => (e: React.FormEvent<HTMLInputElement>) => { const el = e.currentTarget; el.value = el.value.replace(/\D/g, "").slice(0, max); };
/** จัดกลุ่มตัวเลขให้อ่านง่าย เช่น 1-1037-00123-45-6 / 081-234-5678 */
const groupDigits = (v: string, sizes: number[]) => { const out: string[] = []; let i = 0; for (const n of sizes) { if (i >= v.length) break; out.push(v.slice(i, i + n)); i += n; } return out.join("-"); };
const DIGIT_KINDS = {
  id: { max: 13, groups: [1, 4, 5, 2, 1], pattern: "\\d{13}", placeholder: "เช่น 1103700123456", title: "เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก", tip: "ตัวเลข 13 หลักตามบัตร ไม่ต้องใส่ขีด" },
  phone: { max: 10, groups: [3, 3, 4], pattern: "0\\d{9}", placeholder: "เช่น 0812345678", title: "เบอร์โทรต้องเป็นตัวเลข 10 หลัก ขึ้นต้นด้วย 0", tip: "มือถือ 10 หลัก ขึ้นต้นด้วย 0 ไม่ต้องใส่ขีด" },
};
/**
 * ช่องเลขบัตรประชาชน / เบอร์โทร: พิมพ์ได้เฉพาะตัวเลขตามจำนวนหลัก
 * ใต้ช่องแสดงวิธีกรอก แล้วเปลี่ยนเป็นผลจำลองแบบจัดกลุ่ม พร้อมนับหลักระหว่างพิมพ์
 */
function DigitsInput({ kind, name, required, defaultValue, "aria-label": ariaLabel }: { kind: keyof typeof DIGIT_KINDS; name: string; required?: boolean; defaultValue?: string; "aria-label"?: string }) {
  const k = DIGIT_KINDS[kind];
  const [v, setV] = useState((defaultValue ?? "").replace(/\D/g, "").slice(0, k.max));
  const done = new RegExp(`^${k.pattern}$`).test(v);
  return <>
    <input name={name} aria-label={ariaLabel} required={required} type={kind === "phone" ? "tel" : "text"} inputMode="numeric" maxLength={k.max} pattern={k.pattern} title={k.title}
      placeholder={k.placeholder} defaultValue={v} onInput={(e) => { digitsOnly(k.max)(e); setV(e.currentTarget.value); }} />
    <p className={`field-hint ${done ? "is-ok" : v ? "is-typing" : ""}`}>
      {!v ? k.tip : <><b>{groupDigits(v, k.groups)}</b><span>{done ? "ครบแล้ว" : kind === "phone" && v[0] !== "0" ? "ต้องขึ้นต้นด้วย 0" : `${v.length}/${k.max} หลัก`}</span></>}
    </p>
  </>;
}
/** ตรวจเลขบัตร/เบอร์โทรของแถวสัญญา (ใช้ตอนแก้สัญญา) · ว่าง = ผ่าน */
const idPhoneProblem = (r: string[]) => {
  const blank = (x?: string) => !x || x === "-";
  if (!blank(r[8]) && !/^\d{13}$/.test(r[8])) return "กรุณากรอกเลขบัตรประชาชนผู้ว่าจ้างเป็นตัวเลข 13 หลัก";
  if (!blank(r[12]) && !/^\d{13}$/.test(r[12])) return "กรุณากรอกเลขบัตรประชาชนผู้รับบริการเป็นตัวเลข 13 หลัก";
  if (!blank(r[9]) && !/^0\d{9}$/.test(r[9])) return "กรุณากรอกเบอร์โทรเป็นตัวเลข 10 หลัก ขึ้นต้นด้วย 0";
  return "";
};
const DC_REASONS = ["กลับบ้าน", "ส่งต่อโรงพยาบาล", "ย้ายไปสถานดูแลอื่น", "เสียชีวิต", "อื่น ๆ"];
/** แถวสัญญา: ลำดับตรงกับ lib/schema contracts · [6] = ห้อง (เลือกในขั้นที่ 2) */
const NO_ROOM = "-";

/**
 * เปิดสัญญาใหม่ 2 ขั้น: กรอกรายละเอียด → เลือกห้องผู้ป่วย (ห้องเต็ม/ปิดปรับปรุงเลือกไม่ได้)
 * ฟอร์มขั้นที่ 1 ยังอยู่ในหน้า (ซ่อนไว้) ย้อนกลับมาแก้ได้โดยข้อมูลไม่หาย · initial = ต่อสัญญา (ดึงข้อมูลสัญญาเดิมมาให้)
 */
/** รูปบัตรประชาชนที่แนบในฟอร์ม ("" = ไม่ได้แนบ) */
type IdPhotos = { employer: string; resident: string };

function ContractForm({ rooms, residents, initial, onClose, onSave }: { rooms: string[][]; residents: string[][]; initial?: string[]; onClose: () => void; onSave: (r: string[], photos: IdPhotos) => void }) {
  const [photos, setPhotos] = useState<IdPhotos>({ employer: "", resident: "" });
  const branchNames = useBranchNames();
  const { go, toast } = useApp();
  const { user } = useSession();
  const [step, setStep] = useState<1 | 2>(1);
  const [row, setRow] = useState<string[] | null>(null);
  const [room, setRoom] = useState("");
  const [warn, setWarn] = useState("");
  const norm = (x: string) => x.trim().replace(/\s+/g, " ");
  /** ค่าเริ่มต้นจากสัญญาเดิม (ต่อสัญญา) */
  const d = (i: number) => (initial?.[i] && initial[i] !== "-" ? initial[i] : undefined);
  const dn = (i: number) => d(i)?.replace(/,/g, "");

  const all = roomInfos(rooms, residents);
  const options = row ? all.filter((r) => r.branch === row[1]) : [];
  const free = options.filter((r) => !r.closed).reduce((n, r) => n + r.free, 0);
  const existing = row ? residents.find((r) => norm(r[0]) === row[2] && r[3] === row[1] && staying(r[5] ?? "")) : undefined;

  const next = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const g = (k: string) => String(f.get(k) ?? "").trim();
    const r = [
      "", g("branch"), norm(g("resident")), norm(g("employer")), g("fee") || "-", g("status") || CONTRACT_STATUSES[0],
      NO_ROOM, g("start"), g("employer_id"), g("phone"), g("address"), g("relation"),
      g("resident_id"), g("age"), f.getAll("base").map(String).join(", "), f.getAll("extra").map(String).join(", "), g("extra_fee"), g("package"),
      g("prepaid"), g("deposit"), g("note"),
    ];
    if (!r[1]) return toast("กรุณาเลือกสาขา");
    setRow(r);
    // ผู้รับบริการที่มีห้องอยู่แล้ว (ต่อสัญญา): เลือกห้องเดิมไว้ให้
    const cur = residents.find((x) => norm(x[0]) === r[2] && x[3] === r[1] && staying(x[5] ?? ""));
    const curRoom = cur ? findRoom(all, r[1], cur[2]) : undefined;
    setRoom(curRoom ? curRoom.no : room && findRoom(all, r[1], room) ? room : "");
    setWarn("");
    setStep(2);
    window.scrollTo(0, 0);
  };

  const pick = (r: RoomInfo) => {
    const problem = roomProblem(r, row?.[2]);
    if (problem) { setWarn(problem); toast(problem); return; }
    setWarn(""); setRoom(r.no);
  };

  const finish = (withRoom: boolean) => {
    if (!row) return;
    if (withRoom) {
      const r = findRoom(all, row[1], room);
      if (!r) return toast("กรุณาเลือกห้องผู้ป่วย");
      const problem = roomProblem(r, row[2]);
      if (problem) { setWarn(problem); return toast(problem); }
    }
    onSave(row.map((x, i) => (i === 6 ? (withRoom ? room : NO_ROOM) : x)), photos);
  };

  return (
    <Section title={initial ? `ต่อสัญญา · ${initial[2]} (สัญญาเดิม ${initial[0]})` : "เปิดสัญญาใหม่"}>
      <div className="contract-steps" aria-label="ขั้นตอน">
        <span className={step === 1 ? "is-active" : ""}><b>1</b>รายละเอียดสัญญา</span>
        <span className={step === 2 ? "is-active" : ""}><b>2</b>เลือกห้องผู้ป่วย</span>
      </div>

      <form className={`space-y-8 ${step === 1 ? "" : "hidden"}`} onSubmit={next}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="สาขา (Branch)" required className="md:col-span-2"><select name="branch" defaultValue={d(1) ?? ""}><option value="">-- กรุณาเลือกสาขา --</option>{branchNames.map((b) => <option key={b}>{b}</option>)}</select></Field>
          <Field label="ชื่อ นามสกุล ผู้จ้าง" required><input name="employer" required placeholder="เช่น นายสมชาย ใจดี" defaultValue={d(3)} /></Field>
          <Field label="เลขที่บัตรประชาชน"><DigitsInput kind="id" name="employer_id" defaultValue={d(8)} /></Field>
          <Field label="ที่อยู่" required className="md:col-span-2"><textarea name="address" rows={2} required placeholder="เช่น 99/1 ซอยสุขุมวิท 107 แขวงบางนาเหนือ เขตบางนา กรุงเทพมหานคร 10260" defaultValue={d(10)} /></Field>
          <Field label="รูปถ่ายบัตรประชาชนผู้ว่าจ้าง" className="md:col-span-2"><PhotoPicker value={photos.employer} onChange={(v) => setPhotos({ ...photos, employer: v })} label={initial ? "ไม่แนบใหม่ = ใช้รูปจากสัญญาเดิม" : "ถ่ายหรือเลือกรูปบัตรประชาชนผู้ว่าจ้าง"} /><p className="field-hint">ถ่ายให้เห็นชื่อ เลขบัตร และรูปหน้าชัดเจน · เปิดดูได้เฉพาะผู้มีสิทธิ์เมนูสัญญาบริการ</p></Field>
          <Field label="โทรศัพท์" required><DigitsInput kind="phone" name="phone" required defaultValue={d(9)} /></Field>
          <Field label="เกี่ยวข้อง"><input name="relation" placeholder="เช่น บุตร หลาน คู่สมรส" defaultValue={d(11)} /></Field>
          <Field label="ชื่อ นามสกุล ผู้รับบริการ" required><input name="resident" required placeholder="เช่น นางสมศรี ใจดี" defaultValue={d(2)} readOnly={!!initial} /></Field>
          <Field label="เลขที่บัตรประชาชนผู้รับบริการ"><DigitsInput kind="id" name="resident_id" defaultValue={d(12)} /></Field>
          <Field label="อายุ (ปี) ผู้รับบริการ"><input name="age" type="number" min={0} max={130} placeholder="เช่น 78" defaultValue={dn(13)} /></Field>
          <Field label="วันเริ่มสัญญา" required><input name="start" type="date" required /></Field>
          <Field label="รูปถ่ายบัตรประชาชนผู้รับบริการ" className="md:col-span-2"><PhotoPicker value={photos.resident} onChange={(v) => setPhotos({ ...photos, resident: v })} label={initial ? "ไม่แนบใหม่ = ใช้รูปจากสัญญาเดิม" : "ถ่ายหรือเลือกรูปบัตรประชาชนผู้รับบริการ"} /></Field>
          <Field label="เลขที่สัญญา"><input value={initial ? `ออกเลขใหม่อัตโนมัติ (สัญญาเดิม ${initial[0]})` : "ระบบออกเลขให้อัตโนมัติเมื่อบันทึก"} readOnly tabIndex={-1} className="field-locked" /><p className="field-hint">รูปแบบ CT-ปี พ.ศ.-ลำดับ เช่น CT-2569-0001 · แก้ไขไม่ได้</p></Field>
          <Field label="ค่าบริการ/เดือน (บาท)"><input name="fee" type="number" min={0} placeholder="เช่น 30000 (ไม่ต้องใส่จุลภาค)" defaultValue={dn(4)} /></Field>
          <Field label="สถานะสัญญา" required><select name="status" defaultValue={CONTRACT_STATUSES[0]}>{CONTRACT_STATUSES.slice(0, 2).map((x) => <option key={x}>{x}</option>)}</select></Field>
        </div>

        <div>
          <h3 className="mb-3 font-semibold text-gold-800">ขอบเขตการให้บริการ</h3>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-cream-300 bg-cream-50/60 p-3">
              <p className="px-3 py-2 text-sm font-medium text-gold-700">รวมอยู่ในค่าบริการพื้นฐาน:</p>
              {BASE.map((t) => <Check key={t} name="base" text={t} checked={!!d(14)?.includes(t)} />)}
            </div>
            <div className="rounded-2xl border border-cream-300 bg-cream-50/60 p-3">
              <p className="px-3 py-2 text-sm font-medium text-gold-700">รายการที่มีค่าใช้จ่ายเพิ่มเติม (ไม่รวมในค่าบริการพื้นฐาน):</p>
              {EXTRA.map((t) => <Check key={t} name="extra" text={t} checked={!!d(15)?.includes(t)} />)}
            </div>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="ค่าบริการเพิ่มเติมรายเดือนที่ตกลงไว้ (ระบุถ้ามี)"><input name="extra_fee" placeholder="เช่น ค่าแพมเพิส 1,500 บาท/เดือน" defaultValue={d(16)} /></Field>
            <Field label="แพ็กเกจเสริมอื่นๆ (ระบุถ้ามี)"><input name="package" placeholder="เช่น กายภาพบำบัด 8 ครั้ง/เดือน" defaultValue={d(17)} /></Field>
            <Field label="หมายเหตุ" className="md:col-span-2"><textarea name="note" rows={2} placeholder="เช่น แพ้ยาเพนิซิลลิน, ญาติมาเยี่ยมทุกวันเสาร์" defaultValue={initial ? `ต่อจากสัญญา ${initial[0]}` : undefined} /></Field>
            <Field label="ชำระค่าบริการล่วงหน้า (บาท)"><input name="prepaid" type="number" min={0} placeholder="เช่น 30000" /><p className="field-hint">ใส่ยอดแล้ว ระบบออกใบแจ้งหนี้ให้ที่เมนูการเงิน</p></Field>
            <Field label="ชำระเงินประกัน (บาท)"><input name="deposit" type="number" min={0} placeholder="เช่น 60000" /><p className="field-hint">คืนตอนสิ้นสุดสัญญาตามเงื่อนไขของศูนย์</p></Field>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-soft" onClick={onClose}>ยกเลิก</button>
          <button className="btn-primary">ถัดไป: เลือกห้องผู้ป่วย <Icon name="arrow" className="h-4 w-4" /></button>
        </div>
      </form>

      {step === 2 && row && <div className="space-y-5">
        <div className="rounded-2xl border border-cream-200 bg-cream-50/60 px-4 py-3 text-sm text-gold-700">
          <p><span className="text-gold-500">ผู้รับบริการ</span> <b className="font-medium text-gold-800">{row[2]}</b>{row[13] ? ` · ${row[13]} ปี` : ""} · <span className="text-gold-500">สาขา</span> {row[1]} · <span className="text-gold-500">ผู้ว่าจ้าง</span> {row[3]}{row[4] !== "-" ? ` · ${Number(row[4]).toLocaleString("en-US")} บาท/เดือน` : ""}</p>
          {existing && <p className="mt-1 text-xs text-gold-500">มีชื่อนี้ในทะเบียนผู้รับบริการแล้ว ระบบจะอัปเดตห้องให้คนเดิม ไม่สร้างรายชื่อซ้ำ</p>}
        </div>
        {warn && <p role="alert" className="room-warn">{warn}</p>}
        {!options.length ? <div className="empty-state"><Icon name="bed" /><p>สาขา{row[1]}ยังไม่มีห้องในระบบ {can(user, "rooms.manage") ? "สร้างห้องที่เมนูห้องผู้ป่วย หรือบันทึกสัญญาไปก่อนแล้วจัดห้องภายหลัง" : "แจ้งผู้จัดการสาขาให้สร้างห้อง หรือบันทึกสัญญาไปก่อนแล้วจัดห้องภายหลัง"}</p>
          {can(user, "rooms.manage") && <button type="button" className="mt-3 text-sm text-gold-700 underline-offset-4 hover:underline" onClick={() => go("rooms")}>ไปที่ห้องผู้ป่วย (ข้อมูลที่กรอกจะไม่ถูกบันทึก)</button>}</div>
          : <>
            <p className="text-sm text-gold-600">เลือกห้องที่ยังว่าง · สาขา{row[1]} ว่าง {free} เตียง จาก {options.length} ห้อง</p>
            {free === 0 && <p role="alert" className="room-warn">ห้องของสาขา{row[1]}เต็มทุกห้องแล้ว บันทึกสัญญาโดยยังไม่เลือกห้อง แล้วแจ้งผู้จัดการสาขาให้เพิ่มห้องหรือเพิ่มจำนวนผู้ป่วยต่อห้อง</p>}
            <div className="room-grid">{options.map((r) => <RoomCard key={r.i} room={r} selected={roomKey(r.no) === roomKey(room)} onClick={() => pick(r)} />)}</div>
          </>}
        <div className="flex flex-col-reverse gap-2 border-t border-cream-200 pt-4 sm:flex-row sm:justify-end">
          <button type="button" className="btn-soft" onClick={() => setStep(1)}>ย้อนกลับไปแก้รายละเอียด</button>
          <button type="button" className="btn-soft" onClick={() => finish(false)}>บันทึกโดยยังไม่เลือกห้อง</button>
          <button type="button" className="btn-primary" disabled={!room} onClick={() => finish(true)}>{room ? `บันทึกสัญญา · ห้อง ${room}` : "เลือกห้องก่อนบันทึก"}</button>
        </div>
      </div>}
    </Section>
  );
}

const CONTRACT_FIELDS: FieldDef[] = [
  { label: "เลขที่สัญญา", readOnly: true },
  { label: "สาขา", options: BRANCH_NAMES, required: true },
  { label: "ผู้รับบริการ", required: true },
  { label: "ผู้ว่าจ้าง", required: true },
  { label: "ค่าบริการ/เดือน" },
  { label: "สถานะ", options: CONTRACT_STATUSES, required: true },
  { label: "ห้อง" },
  { label: "วันเริ่มสัญญา (วว/ดด/ปปปป)" },
  { label: "เลขที่บัตรประชาชนผู้ว่าจ้าง" },
  { label: "โทรศัพท์ผู้ว่าจ้าง" },
  { label: "ที่อยู่ผู้ว่าจ้าง", area: true },
  { label: "ความเกี่ยวข้อง" },
  { label: "เลขที่บัตรประชาชนผู้รับบริการ" },
  { label: "อายุผู้รับบริการ (ปี)" },
  { label: "บริการในค่าบริการพื้นฐาน", area: true },
  { label: "รายการที่มีค่าใช้จ่ายเพิ่มเติม", area: true },
  { label: "ค่าบริการเพิ่มเติมรายเดือน" },
  { label: "แพ็กเกจเสริม" },
  { label: "ชำระค่าบริการล่วงหน้า" },
  { label: "เงินประกัน" },
  { label: "หมายเหตุ", area: true },
];
const CONTRACT_COLS = ["เลขที่สัญญา", "สาขา", "ผู้รับบริการ", "ห้อง", "ผู้ว่าจ้าง", "ค่าบริการ/เดือน", "สถานะ"];

type Dlg = { mode: "view" | "edit"; i: number } | null;

export function Contracts() {
  const branchNames = useBranchNames();
  const { user } = useSession();
  const { rows, ids, add, update, remove } = useCrud("contracts", CONTRACTS);
  const [cards, setCards] = useState<{ i: number; employer: string | null; resident: string | null; edit: IdPhotos; loading: boolean } | null>(null);
  const rooms = useCrud("rooms", []);
  const res = useCrud("residents", RESIDENTS);
  const { confirm, toast } = useApp();
  const [creating, setCreating] = useState(false);
  const [sample, setSample] = useState(false);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [filter, setFilter] = useState("ทั้งหมด");
  const norm = (x: string) => x.trim().replace(/\s+/g, " ");
  const resIndex = (name: string, branch: string) => res.rows.findIndex((r) => norm(r[0]) === norm(name) && r[3] === branch);
  /** ย้ายผู้รับบริการเข้า/ออกห้อง · เข้าห้องใหม่ = ได้เตียงว่างลำดับแรก (ห้องเดิม = เตียงเดิม) */
  const setResident = (j: number, room: string, status?: string) => {
    const r = res.rows[j];
    const info = room === NO_ROOM ? undefined : findRoom(roomInfos(rooms.rows, res.rows), r[3], room);
    const bed = !info ? "" : r[2] === room && r[7] ? r[7] : freeBed(info, r[0]);
    res.update(j, withRoom(r, room, bed, status));
  };
  const [invoices, setInvoices] = useRecords<Invoice>("invoices", []);
  const [renew, setRenew] = useState<number | null>(null);
  const [dc, setDc] = useState<{ i: number; date: string; reason: string; done?: boolean } | null>(null);

  /**
   * สัญญาใหม่ / ต่อสัญญา: เพิ่มหรืออัปเดตผู้รับบริการพร้อมห้องก่อน (server ออก HN ให้) แล้วจึงบันทึกสัญญา
   * มีค่าบริการล่วงหน้า/เงินประกัน = ออกใบแจ้งหนี้ให้ที่เมนูการเงิน · รอชำระมัดจำ = จองห้องไว้ก่อน
   */
  const create = (r: string[], photos: IdPhotos) => {
    const oldId = renew !== null ? ids[renew] : undefined;
    const status = r[5] === "รอชำระเงินมัดจำ" ? "มัดจำ (จองห้อง)" : "เข้าอยู่ (Active)";
    const j = resIndex(r[2], r[1]);
    const info = r[6] === NO_ROOM ? undefined : findRoom(roomInfos(rooms.rows, res.rows), r[1], r[6]);
    if (j >= 0) {
      const p = res.rows[j];
      const bed = r[6] === NO_ROOM ? p[7] ?? "" : p[2] === r[6] && p[7] ? p[7] : freeBed(info, p[0]);
      res.update(j, [p[0], r[13] || p[1], r[6] === NO_ROOM ? p[2] : r[6], p[3], p[4], status, p[6] ?? "", bed]);
    } else res.add([r[2], r[13] || "-", r[6], r[1], "", status, "", freeBed(info)]);
    const id = add(r);
    if (photos.employer || photos.resident || oldId) uploadIdCards(id, { ...(photos.employer ? { employer: photos.employer } : {}), ...(photos.resident ? { resident: photos.resident } : {}), ...(oldId ? { copyFrom: oldId } : {}) });
    if (renew !== null) { const old = rows[renew]; update(renew, old.map((x, k) => (k === 5 ? "สิ้นสุดสัญญา" : x))); }
    const inv = contractInvoice(r, j >= 0 ? res.rows[j][6] ?? "" : "");
    if (inv) setInvoices([inv, ...invoices]);
    setCreating(false); setRenew(null);
    toast(`${renew !== null ? "ต่อสัญญาแล้ว" : "บันทึกสัญญาแล้ว"} · ${r[2]}${r[6] === NO_ROOM ? " (ยังไม่มีห้อง)" : ` ห้อง ${r[6]}`}${inv ? ` · ออกใบแจ้งหนี้ ${money(inv.net)} บาทที่เมนูการเงินแล้ว` : ""}`);
  };

  /** ยกเลิกสัญญา (เช่น ลูกค้าเปลี่ยนใจ ทำสัญญาผิด): สัญญายังอยู่ในทะเบียน · คืนห้อง · ใบแจ้งหนี้ที่ยังไม่ชำระของสัญญานี้ถูกยกเลิกตาม */
  const cancel = (i: number) => {
    const c = rows[i];
    if (c[5] === CANCELLED) return toast("ไม่สามารถยกเลิกได้ สัญญานี้ถูกยกเลิกไปแล้ว");
    const j = resIndex(c[2], c[1]);
    const stay = j >= 0 && staying(res.rows[j][5] ?? "") && !rows.some((x, k) => k !== i && x[2] === c[2] && x[1] === c[1] && ["ใช้งานอยู่", "รอชำระเงินมัดจำ"].includes(x[5]));
    const bills = invoices.filter((x) => x.contract === c[0] && x.status === UNPAID);
    confirm({
      title: "ยกเลิกสัญญา", danger: true, okLabel: "ยกเลิกสัญญา",
      message: `ต้องการยกเลิกสัญญา ${c[0]} ของ ${c[2]} ใช่หรือไม่${stay ? ` · ${c[2]} จะเปลี่ยนเป็นย้ายออกและคืนห้อง${c[6] && c[6] !== NO_ROOM ? ` ${c[6]}` : ""}` : ""}${bills.length ? ` · ใบแจ้งหนี้ที่ยังไม่ชำระ ${bills.length} ใบจะถูกยกเลิก` : ""} (ใบเสร็จที่ชำระแล้วไม่เปลี่ยน)`,
      onOk: () => {
        const note = [c[20], `ยกเลิก ${docDate(todayIso())} โดย ${user?.name ?? ""}`].filter((x) => x && x !== "-").join(" · ");
        update(i, c.map((x, k) => (k === 5 ? CANCELLED : k === 20 ? note : x)));
        if (stay) setResident(j, NO_ROOM, "ย้ายออก (Inactive)");
        if (bills.length) setInvoices(invoices.map((x) => (bills.includes(x) ? { ...x, status: VOID } : x)));
        toast(`ยกเลิกสัญญา ${c[0]} แล้ว`);
      },
    });
  };

  /** แนบรูปบัตรของสัญญาที่เพิ่งบันทึก · สัญญาอาจยังส่งไม่ถึงฐานข้อมูล ลองซ้ำสูงสุด 6 ครั้ง */
  const uploadIdCards = (id: string, body: object, attempt = 0): void => {
    fetch("/api/idcards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, ...body }) })
      .then((r) => { if (r.status === 404 && attempt < 5) setTimeout(() => uploadIdCards(id, body, attempt + 1), 1500); else if (!r.ok) toast("ยังไม่สามารถบันทึกรูปบัตรประชาชนได้ แนบใหม่ได้ที่ปุ่มรูปบัตรในทะเบียนสัญญา"); })
      .catch(() => toast("ยังไม่สามารถบันทึกรูปบัตรประชาชนได้ (ออฟไลน์) แนบใหม่ได้ที่ปุ่มรูปบัตรในทะเบียนสัญญา"));
  };
  /** เปิดดูรูปบัตร (ระบบบันทึกว่าใครเปิดดู) */
  const openCards = async (i: number) => {
    setCards({ i, employer: null, resident: null, edit: { employer: "", resident: "" }, loading: true });
    const d = await fetch(`/api/idcards?id=${encodeURIComponent(ids[i])}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    setCards({ i, employer: d?.employer ?? null, resident: d?.resident ?? null, edit: { employer: "", resident: "" }, loading: false });
  };
  const saveCards = async () => {
    if (!cards) return;
    const body = { id: ids[cards.i], ...(cards.edit.employer ? { employer: cards.edit.employer } : {}), ...(cards.edit.resident ? { resident: cards.edit.resident } : {}) };
    if (Object.keys(body).length === 1) return setCards(null);
    const r = await fetch("/api/idcards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    if (!r?.ok) return toast("ยังไม่สามารถบันทึกรูปบัตรประชาชนได้ กรุณาลองใหม่");
    toast("บันทึกรูปบัตรประชาชนแล้ว"); setCards(null);
  };

  /** D/C กลับบ้าน: สิ้นสุดสัญญา ย้ายออก คืนห้อง แล้วพิมพ์ใบจำหน่าย */
  const discharge = () => {
    if (!dc) return;
    const c = rows[dc.i];
    const j = resIndex(c[2], c[1]);
    const note = [c[20], `D/C ${docDate(dc.date)} · ${dc.reason}`].filter((x) => x && x !== "-").join(" · ");
    update(dc.i, c.map((x, k) => (k === 5 ? "สิ้นสุดสัญญา" : k === 20 ? note : x)));
    if (j >= 0) setResident(j, NO_ROOM, "ย้ายออก (Inactive)");
    setDc({ ...dc, done: true });
    toast(`D/C ${c[2]} แล้ว · คืนห้อง${c[6] && c[6] !== NO_ROOM ? ` ${c[6]}` : ""}ให้ว่าง`);
  };

  /** แก้สัญญา: เปลี่ยนห้อง = ย้ายผู้รับบริการตาม · สิ้นสุดสัญญา = ถามว่าจะคืนห้องไหม */
  const edit = (i: number, v: string[]) => {
    v = v.map((x, k) => ([8, 9, 12].includes(k) ? (x ?? "").replace(/[\s-]/g, "") : x));
    const bad = idPhoneProblem(v);
    if (bad) return toast(bad);
    const before = rows[i];
    const j = resIndex(v[2], v[1]);
    const roomChanged = norm(v[6] || NO_ROOM) !== norm(before[6] || NO_ROOM) && norm(v[6] || NO_ROOM) !== NO_ROOM;
    if (roomChanged) {
      const info = findRoom(roomInfos(rooms.rows, res.rows), v[1], v[6]);
      if (!info) return toast(`ไม่พบห้อง ${v[6]} ในสาขา${v[1]} สร้างห้องที่เมนูห้องผู้ป่วยก่อน`);
      const problem = roomProblem(info, v[2]);
      if (problem) return toast(problem);
      v = v.map((x, k) => (k === 6 ? info.no : x));
      if (j >= 0) setResident(j, info.no);
    }
    update(i, v); setDlg(null);
    toast(roomChanged ? `บันทึกการแก้ไขแล้ว · ย้าย ${v[2]} ไปห้อง ${v[6]}` : "บันทึกการแก้ไขแล้ว");
    // ชำระมัดจำแล้ว (รอชำระ → ใช้งานอยู่): เปลี่ยนจากจองห้องเป็นเข้าพัก
    if (v[5] === "ใช้งานอยู่" && before[5] === "รอชำระเงินมัดจำ" && j >= 0 && res.rows[j][5].startsWith("มัดจำ")) setResident(j, res.rows[j][2], "เข้าอยู่ (Active)");
    if (v[5] === "สิ้นสุดสัญญา" && before[5] !== "สิ้นสุดสัญญา" && j >= 0 && staying(res.rows[j][5] ?? ""))
      confirm({ title: "สิ้นสุดสัญญา", message: `ต้องการเปลี่ยนสถานะ ${v[2]} เป็นย้ายออก และคืนห้อง ${res.rows[j][2]} ให้ว่างด้วยหรือไม่`, okLabel: "ย้ายออกและคืนห้อง", onOk: () => { setResident(j, NO_ROOM, "ย้ายออก (Inactive)"); toast(`คืนห้องแล้ว · ${v[2]} ย้ายออก`); } });
  };

  if (creating || renew !== null)
    return <ContractForm rooms={rooms.rows} residents={res.rows} initial={renew !== null ? rows[renew] : undefined} onClose={() => { setCreating(false); setRenew(null); }} onSave={create} />;
  const dcRow = dc ? rows[dc.i] : null;
  const dcRes = dcRow ? res.rows[resIndex(dcRow[2], dcRow[1])] : undefined;
  const owing = dcRow ? invoices.filter((x) => x.who === dcRow[2] && isOpen(x)) : [];
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
      <MetricGrid items={[{label:"สัญญาทั้งหมด",value:rows.length,unit:"สัญญา",accent:true,icon:"doc"},{label:"ใช้งานอยู่",value:rows.filter(r=>r[5]==="ใช้งานอยู่").length,unit:"สัญญา",icon:"check"},{label:"รอชำระมัดจำ",value:rows.filter(r=>r[5]==="รอชำระเงินมัดจำ").length,unit:"สัญญา",icon:"receipt"},{label:"สิ้นสุดสัญญา",value:rows.filter(r=>r[5]==="สิ้นสุดสัญญา").length,unit:"สัญญา",icon:"files",note:rows.some(r=>r[5]===CANCELLED)?`ยกเลิก ${rows.filter(r=>r[5]===CANCELLED).length} สัญญา`:undefined}]} /><Section title="ทะเบียนสัญญาบริการ" actions={<Tabs tabs={["ใช้งานอยู่", "รอชำระเงินมัดจำ", "สิ้นสุดสัญญา", CANCELLED, "ทั้งหมด"]} value={filter} onChange={setFilter} />}>
        <DataTable
          columns={CONTRACT_COLS}
          rows={shown.map(({ r }) => [r[0] || "กำลังออกเลข…", r[1], r[2], r[6] || NO_ROOM, r[3], r[4], r[5]])}
          actions={[
            { label: "ดู", onClick: (k) => setDlg({ mode: "view", i: shown[k].i }) },
            { label: "แก้ไข", onClick: (k) => setDlg({ mode: "edit", i: shown[k].i }) },
            { label: "รูปบัตร", onClick: (k) => openCards(shown[k].i) },
            { label: "ต่อสัญญา", onClick: (k) => setRenew(shown[k].i) },
            { label: "D/C กลับบ้าน", onClick: (k) => [CANCELLED, "สิ้นสุดสัญญา"].includes(shown[k].r[5]) ? toast("ไม่สามารถ D/C ได้ สัญญานี้สิ้นสุดหรือถูกยกเลิกแล้ว") : setDc({ i: shown[k].i, date: todayIso(), reason: DC_REASONS[0] }) },
            { label: "ยกเลิกสัญญา", danger: true, onClick: (k) => cancel(shown[k].i) },
            ...(can(user, "contracts.delete") ? [{ label: "ลบ", danger: true, onClick: (k: number) => confirm({ title: "ลบสัญญา", message: `ต้องการลบสัญญา ${shown[k].r[0]} (${shown[k].r[2]}) ออกจากระบบใช่หรือไม่ ลบแล้วกู้คืนไม่ได้ (ดูย้อนหลังได้ที่ประวัติการแก้ไข) ถ้าแค่ไม่ใช้สัญญานี้แล้ว แนะนำให้กด "ยกเลิกสัญญา" แทน`, danger: true, okLabel: "ลบ", onOk: () => { remove(shown[k].i); toast("ลบสัญญาแล้ว"); } }) }] : []),
          ]}
        />
      </Section>
      <FormDialog
        open={!!dlg} mode={dlg?.mode ?? "view"} title={dlg?.mode === "edit" ? "รายละเอียด/แก้ไขสัญญา" : "รายละเอียดสัญญา"}
        fields={withBranches(CONTRACT_FIELDS, branchNames)} value={dlg ? rows[dlg.i] : undefined} onClose={() => setDlg(null)}
        onSave={(v) => { if (dlg) edit(dlg.i, v); }} saveLabel="บันทึกการแก้ไข"
      />
      <Modal open={!!cards} wide title={cards ? `รูปบัตรประชาชน · ${rows[cards.i]?.[2] ?? ""} (${rows[cards.i]?.[0] || "สัญญาใหม่"})` : ""} onClose={() => setCards(null)}
        footer={<><button className="btn-soft" onClick={() => setCards(null)}>ปิด</button><button className="btn-primary" disabled={!cards?.edit.employer && !cards?.edit.resident} onClick={saveCards}>บันทึกรูปใหม่</button></>}>
        {cards && (cards.loading ? <p className="py-8 text-center text-sm text-gold-500">กำลังโหลดรูป…</p> : <div className="grid gap-5 md:grid-cols-2">
          {([["employer", "ผู้ว่าจ้าง", rows[cards.i]?.[3]], ["resident", "ผู้รับบริการ", rows[cards.i]?.[2]]] as const).map(([k, label, who]) => (
            <section key={k} className="space-y-2">
              <h4 className="font-medium text-gold-800">บัตรประชาชน{label} <span className="text-sm font-normal text-gold-500">· {who}</span></h4>
              {cards[k] && !cards.edit[k] && <img src={cards[k]!} alt={`บัตรประชาชน${label}`} className="w-full rounded-xl border border-cream-200" />}
              {!cards[k] && !cards.edit[k] && <p className="rounded-xl bg-cream-50 px-4 py-6 text-center text-sm text-gold-500">ยังไม่มีรูป</p>}
              <PhotoPicker value={cards.edit[k]} onChange={(v) => setCards({ ...cards, edit: { ...cards.edit, [k]: v } })} label={cards[k] ? "แนบรูปใหม่แทนรูปเดิม" : "แนบรูปบัตร"} />
            </section>
          ))}
          <p className="text-xs leading-6 text-gold-500 md:col-span-2">ข้อมูลส่วนบุคคล: การเปิดดูและเปลี่ยนรูปบันทึกไว้ในประวัติการแก้ไขทุกครั้ง</p>
        </div>)}
      </Modal>
      <Modal open={!!dc} title={dc?.done ? "ใบจำหน่ายผู้รับบริการ (D/C)" : "D/C กลับบ้าน"} onClose={() => setDc(null)}
        footer={dc?.done ? <><button className="btn-soft" onClick={() => setDc(null)}>ปิด</button><button className="btn-primary" onClick={() => window.print()}><Icon name="print" className="h-4 w-4" /> พิมพ์เอกสาร D/C</button></>
          : <><button className="btn-soft" onClick={() => setDc(null)}>ยกเลิก</button><button className="btn-primary" onClick={discharge}>ยืนยัน D/C</button></>}>
        {dc && dcRow && (dc.done ? <div className="space-y-4">
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            {[["HN", dcRes?.[6] || "-"], ["ชื่อผู้รับบริการ", dcRow[2]], ["อายุ", dcRes?.[1] && dcRes[1] !== "-" ? `${dcRes[1]} ปี` : dcRow[13] || "-"], ["สาขา", dcRow[1]],
              ["ห้อง", dcRow[6] || "-"], ["เลขที่สัญญา", dcRow[0]], ["วันเริ่มสัญญา", dcRow[7] || "-"], ["วันที่ D/C", docDate(dc.date)],
              ["เหตุผล", dc.reason], ["ผู้ว่าจ้าง / ญาติ", `${dcRow[3]}${dcRow[9] ? ` · ${dcRow[9]}` : ""}`],
              ["ยอดค้างชำระ", owing.length ? `${money(owing.reduce((n, x) => n + balanceOf(x), 0))} บาท (${owing.length} ใบ: ${owing.map((x) => x.no ?? "").join(", ")})` : "ไม่มี"]].map(([k, v]) =>
              <div key={k} className="flex justify-between gap-4 border-b border-cream-200 py-1.5"><dt className="text-gold-500">{k}</dt><dd className="text-right text-gold-800">{v}</dd></div>)}
          </dl>
          <PrintSignatures roles={["ผู้รับบริการ / ญาติ", "พยาบาลผู้จำหน่าย", "เจ้าหน้าที่การเงิน"]} />
        </div> : <div className="space-y-4">
          <p className="rounded-xl bg-cream-50 px-4 py-3 text-sm text-gold-700">{dcRow[2]} · สัญญา {dcRow[0]} · ห้อง {dcRow[6] || "-"} · สาขา{dcRow[1]}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="วันที่ D/C"><input type="date" value={dc.date} onChange={(e) => setDc({ ...dc, date: e.target.value })} /></Field>
            <Field label="เหตุผล"><select value={dc.reason} onChange={(e) => setDc({ ...dc, reason: e.target.value })}>{DC_REASONS.map((x) => <option key={x}>{x}</option>)}</select></Field>
          </div>
          {owing.length > 0 && <p role="alert" className="room-warn">ยังมียอดค้างชำระ {money(owing.reduce((n, x) => n + balanceOf(x), 0))} บาท ({owing.length} ใบ) เรียกเก็บที่เมนูการเงินก่อนหรือหลัง D/C ได้</p>}
          <p className="text-xs text-gold-500">ระบบจะเปลี่ยนสัญญาเป็นสิ้นสุด เปลี่ยนผู้รับบริการเป็นย้ายออก และคืนห้องให้ว่าง</p>
        </div>)}
      </Modal>
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
  { label: "สถานะ", options: ["เข้าอยู่ (Active)", "มัดจำ (จองห้อง)", "แอดมิท รพ. (Hospitalized)", "ย้ายออก (Inactive)"], required: true },
];

export function Residents() {
  const branchNames = useBranchNames();
  const { rows, ids, update, remove } = useCrud("residents", RESIDENTS);
  const { rows: roomRows } = useCrud("rooms", []);
  const { confirm, toast } = useApp();
  const [sample, setSample] = useState(false);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [profile, setProfile] = useState<string | null>(null);
  const [family, setFamily] = useState<string | null>(null);
  const [hub, setHub] = useState(false);
  const [roomF, setRoomF] = useState("");
  const [statusF, setStatusF] = useState("");
  const norm = (x: string) => x.trim().replace(/\s+/g, " ");
  // ตัวกรองห้อง: ห้องที่สร้างไว้ (เรียงตามสาขา ชั้น เลขห้อง) + ห้องที่บันทึกไว้แต่ยังไม่ได้สร้าง + "ยังไม่มีห้อง"
  const NO_ROOM_F = "ยังไม่มีห้อง";
  const multiBranch = new Set(rows.map((r) => r[3])).size > 1;
  const roomName = (no: string, branch: string) => (multiBranch ? `${no} (${branch})` : no);
  const roomOpts = [...new Set([...roomInfos(roomRows, rows).map((r) => roomName(r.no, r.branch)), ...rows.filter((r) => r[2] && r[2] !== "-").map((r) => roomName(r[2], r[3]))])];
  const STATUS_F = ["เข้าอยู่", "มัดจำ", "แอดมิท", "ย้ายออก"];
  const shown = rows.map((r, i) => ({ r, i })).filter(({ r }) =>
    (!roomF || (roomF === NO_ROOM_F ? !r[2] || r[2] === "-" : roomName(r[2], r[3]) === roomF)) && (!statusF || r[5].startsWith(statusF)));
  return (
    <>
      <PageHeader
        title="ข้อมูลผู้รับบริการ (Residents)"
        sub="ทุกข้อมูลสำคัญ เพื่อการดูแลที่เข้าใจแต่ละบุคคล"
        actions={<><button className="btn-soft" onClick={() => setHub(true)}><Icon name="chat" className="h-4 w-4" /> ข่าวและลิงก์ญาติ</button><button className="btn-soft" onClick={() => setSample(true)}><Icon name="print" className="h-4 w-4" /> ตัวอย่าง สบส. (แบบฟอร์มเปล่า)</button></>}
      />
      <MetricGrid items={[{label:"ผู้รับบริการทั้งหมด",value:rows.length,unit:"คน",icon:"user",accent:true},{label:"เข้าอยู่ในศูนย์",value:rows.filter(r=>r[5].startsWith("เข้าอยู่")).length,unit:"คน",icon:"heart"},{label:"รับการรักษาที่โรงพยาบาล",value:rows.filter(r=>r[5].startsWith("แอดมิท")).length,unit:"คน",icon:"building"},{label:"ย้ายออกแล้ว",value:rows.filter(r=>r[5].startsWith("ย้ายออก")).length,unit:"คน",icon:"doc"}]} /><Section title="ทะเบียนผู้รับบริการ" sub="ค้นหาและเปิดดูรายละเอียดของผู้รับบริการแต่ละคน" actions={<div className="flex flex-wrap gap-2">
          <div className="min-w-40"><Select aria-label="กรองตามห้อง" options={[...roomOpts, NO_ROOM_F]} placeholder="ทุกห้อง" value={roomF} onChange={setRoomF} /></div>
          <div className="min-w-36"><Select aria-label="กรองตามสถานะ" options={STATUS_F} placeholder="ทุกสถานะ" value={statusF} onChange={setStatusF} /></div>
          {(roomF || statusF) && <button type="button" className="row-action" onClick={() => { setRoomF(""); setStatusF(""); }}>ล้างตัวกรอง</button>}
        </div>}>
        <DataTable
          columns={["HN", "ชื่อ-นามสกุล", "อายุ", "ห้อง/เตียง", "สาขา", "โรคประจำตัว", "สถานะ"]}
          rows={shown.map(({ r }) => [r[6] || "-", r[0], r[1], r[2] && r[2] !== "-" ? `${r[2]}${r[7] ? ` · เตียง ${r[7]}` : ""}` : "-", r[3], r[4], r[5]])}
          empty={roomF || statusF ? "ไม่พบผู้รับบริการตามตัวกรอง" : undefined}
          actions={[
            { label: "ประวัติ", onClick: (k) => setProfile(ids[shown[k].i]) },
            { label: "ลิงก์ครอบครัว", onClick: (k) => setFamily(ids[shown[k].i]) },
            { label: "แก้ไข", onClick: (k) => setDlg({ mode: "edit", i: shown[k].i }) },
            { label: "ลบ", danger: true, onClick: (k) => confirm({ title: "ลบข้อมูลผู้รับบริการ", message: `ต้องการลบ ${shown[k].r[0]} ใช่หรือไม่`, danger: true, okLabel: "ลบ", onOk: () => { remove(shown[k].i); toast("ลบข้อมูลแล้ว"); } }) },
          ]}
        />
      </Section>
      <FormDialog
        open={!!dlg} mode={dlg?.mode ?? "view"} title={dlg?.mode === "edit" ? "แก้ไขข้อมูลผู้รับบริการ" : "ข้อมูลผู้รับบริการ"}
        fields={withBranches(RES_FIELDS, branchNames)} value={dlg ? rows[dlg.i] : undefined} onClose={() => setDlg(null)}
        onSave={(v) => {
          if (!dlg) return;
          if (!norm(v[0])) return toast("กรุณากรอกชื่อ-นามสกุล");
          if (rows.some((r, j) => j !== dlg.i && norm(r[0]) === norm(v[0]) && r[3] === v[3])) return toast(`มีผู้รับบริการชื่อ "${norm(v[0])}" ในสาขา${v[3]}แล้ว กรุณาเพิ่มชื่อเล่นหรือเลขห้องต่อท้ายเพื่อแยกกัน`);
          // ห้องที่สร้างไว้ในเมนูห้องผู้ป่วย: เต็มหรือปิดปรับปรุงย้ายเข้าไม่ได้
          const problem = staying(v[5] ?? "") ? roomProblem(findRoom(roomInfos(roomRows, rows), v[3], v[2]), rows[dlg.i][0]) : "";
          if (problem) return toast(problem);
          // เปลี่ยนห้องในหน้านี้ = ได้เตียงว่างลำดับแรกของห้องใหม่ (ห้องเดิม = เตียงเดิม)
          const oldRow = rows[dlg.i];
          const roomNew = findRoom(roomInfos(roomRows, rows), v[3], v[2]);
          const bed = oldRow[2] === v[2] ? oldRow[7] ?? "" : freeBed(roomNew, oldRow[0]);
          update(dlg.i, [norm(v[0]), v[1], v[2], v[3], v[4], v[5], oldRow[6] ?? "", bed]); setDlg(null); toast("บันทึกการแก้ไขแล้ว · ข้อมูลที่เกี่ยวข้องเปลี่ยนชื่อตามให้แล้ว");
        }} saveLabel="บันทึกการแก้ไข"
      />
      <ResidentProfile id={profile} onClose={() => setProfile(null)} />
      <FamilyHub open={hub} onClose={() => setHub(false)} />
      <FamilyLinkDialog open={!!family} residentId={family ?? ""} onClose={() => setFamily(null)} />
      <BlankForm open={sample} title="แบบประเมินแรกรับ (แบบฟอร์มเปล่า)" onClose={() => setSample(false)}
        lines={["ชื่อ-สกุล ผู้รับบริการ", "สาขา", "วันเข้าอยู่ (รับดูแลเมื่อ)", "อายุ (ปี)", "BT อุณหภูมิ", "PR ชีพจร", "RR การหายใจ", "BP ความดันโลหิต", "O2SAT ออกซิเจน", "DTX น้ำตาล", "น้ำหนัก (ก.ก.)", "ส่วนสูง (ซ.ม.)", "ลงชื่อผู้ประเมิน", "วัน/เดือน/ปี ที่ประเมิน"]} />
    </>
  );
}

/* ---------- ข้อมูลงาน (Table) ---------- */
const TASK_COLS = ["วันที่", "สาขา", "ผู้รับบริการ", "หมวดหมู่", "ชื่องาน", "ผู้ทำ", "สถานะ", "เวลาที่ส่ง"];

export function TasksTable() {
  const branchNames = useBranchNames();
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
          {branchNames.length > 1 && <div className="min-w-44"><Select options={branchNames} placeholder="รวมทุกสาขา" value={branch} onChange={setBranch} /></div>}
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



