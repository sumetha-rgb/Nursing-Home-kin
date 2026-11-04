"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useBranchNames, withBranches } from "@/lib/branches";
import Link from "next/link";
import Icon from "../Icon";
import { APPOINTMENTS, CONTRACTS, DAILY_LIST, RESIDENTS, BRANCH_NAMES } from "@/lib/mock";
import { downloadCsv, useCrud, useRecords } from "@/lib/store";
import { balanceOf, parseItems, lineNet, PAID, contractVat, DEFAULT_VAT, DRAFT, docDate, Invoice, isOpen, money, svcNet, todayIso, UNPAID, VOID } from "@/lib/billing";
import { contractInvoice, contractMonthTotal, prepaidMonths, useBranchInfo } from "./Billing";
import ContractView from "./ContractView";
import { ContractDoc, contractLines, contractRoomName, contractTotal, DcData, dcRefund, DischargeDoc, PrintModal, RenewDoc } from "../print/Docs";
import { ServiceLine, ServiceLines } from "../ServicePicker";
import { AddressFinder, ChipChoice, SuggestText, TagInput } from "../ContractInputs";
import { addMonthsIso, ALLERGY_DRUGS, COMMON_MEDS, FOOD_ALLERGENS, HEALTH_RIGHTS, HOSP_LATER, isNoAllergy, NO_ALLERGY, RELATIONS } from "@/lib/medicalLists";
import { PROGRAMS } from "@/lib/contractText";
import { ROOMS } from "@/lib/priceList";
import { clinic, fetchDocSettings } from "@/lib/clinic";
import { fetchProfile } from "@/lib/care";
import { billHandoff, handoff, QuoteHandoff } from "@/lib/handoff";
import { buildTodos, HomeData, runTodo } from "../dash/Todo";
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
/** link ว่าง = ขั้นที่ไม่มีเมนูให้ไป (เช่น กระดิ่งแจ้งเตือนมุมขวาบน) */
type Step = { t: string; d: string; link?: string; href?: string; go?: ViewId };

const ADMISSION: Step[] = [
  { t: "ประเมินและเสนอราคา", d: "ทำใบประเมินระดับการดูแลและใบเสนอราคา พิมพ์ให้ญาติพิจารณา", link: "ใบเสนอราคา / แผนดูแล", go: "quotations" },
  { t: "เปิดสัญญา", d: "กด \"เปิดสัญญา\" จากใบเสนอราคา ข้อมูลผู้รับบริการและราคาตามไปให้ ไม่ต้องกรอกซ้ำ", link: "สัญญาบริการ", go: "contracts" },
  { t: "เพิ่มผู้รับบริการเข้าห้อง", d: "เลือกห้องและเตียงที่ว่าง แล้วกด \"เพิ่มผู้รับบริการเข้าห้อง\"", link: "ห้องพักและเตียง", go: "rooms" },
  { t: "แรกรับและประเมิน", d: "เปิดประวัติผู้รับบริการ แท็บ \"แรกรับ/ประเมิน\" บันทึกอาการแรกรับ โรคประจำตัว และความเสี่ยง", link: "ผู้รับบริการ", go: "residents" },
  { t: "นำยาเข้าตะกร้า", d: "ยาที่ญาตินำมา ถ่ายรูปฉลากแล้วกรอกมื้อยา · ยาของศูนย์ เลือกเบิกจากคลังกลาง", link: "เปิดแอปจัดยา", href: "/pharmacy?page=inventory" },
  { t: "ตั้งงานประจำ", d: "เพิ่มงานดูแลที่ทำซ้ำทุกวัน ระบบส่งเข้า KinApp ของพยาบาลให้เองทุกวัน", link: "มอบหมายและตรวจงาน", go: "tasks" },
];

const DAILY: Step[] = [
  { t: "เช็คเวรและการเข้างาน", d: "ดูว่าใครอยู่เวร ใครเช็คชื่อแล้ว ใครสายหรือยังไม่มา", link: "ตารางเวร", go: "roster" },
  { t: "ดูแจ้งเตือน", d: "กดกระดิ่งมุมขวาบน: สัญญาณชีพผิดปกติ และยาคลังกลางใกล้หมดหรือใกล้หมดอายุ" },
  { t: "มอบหมายงานเพิ่ม", d: "งานเฉพาะวันนี้นอกจากงานประจำ (งานประจำส่งเข้า KinApp เองแล้ว ไม่ต้องกดส่ง)", link: "มอบหมายและตรวจงาน", go: "tasks" },
  { t: "ทีมทำงานใน KinApp", d: "พยาบาลทำงานดูแล ให้ยา วัดสัญญาณชีพ ส่งเวร และส่งข่าวญาติจากมือถือ", link: "เปิด KinApp", href: "/staff" },
  { t: "ตรวจงานที่ส่งมา", d: "ดูรูปหลักฐานและรายละเอียดงานที่พยาบาลส่ง แล้วให้ดาว", link: "มอบหมายและตรวจงาน", go: "tasks" },
  { t: "ติดตามผล", d: "ความเห็นจากครอบครัวอยู่ที่เมนูเสียงจากครอบครัว · คะแนนรายคนรายเดือนอยู่ที่ KPI พนักงาน", link: "KPI พนักงาน", go: "kpi" },
];

function Steps({title,steps}:{title:string;steps:Step[]}) {
  const {go}=useApp();
  const {user}=useSession();
  // ซ่อนปุ่มไปเมนูที่ผู้ใช้ไม่มีสิทธิ์ (เช่น หัวหน้าพยาบาลไม่มีเมนูสัญญา)
  return <Section title={title} sub="แนวทางสำหรับทีม เพื่อให้การดูแลครบถ้วนในทุกขั้นตอน"><ol className="workflow-list">{steps.map((s,i)=><li key={s.t} className="workflow-step"><span className="step-number">{String(i+1).padStart(2,"0")}</span><div><h3>{s.t}</h3><p>{s.d}</p>{s.link&&(!s.go||(user&&can(user,s.go)))&&<button className="step-link" onClick={()=>s.go?go(s.go):s.href&&window.location.assign(s.href)}>{s.link}<Icon name="arrow" className="h-3.5 w-3.5" /></button>}</div></li>)}</ol></Section>;
}
export function Workflow() {
  const {go}=useApp();
  const [routine,setRoutine]=useState("งานประจำวัน");
  const {user}=useSession();
  // รับผู้รับบริการใหม่ เริ่มที่ใบเสนอราคา (ไม่มีสิทธิ์ = ไปเปิดสัญญาตรง · ไม่มีทั้งคู่ = ซ่อนปุ่ม)
  const admitTo=can(user,"quotations")?"quotations":can(user,"contracts")?"contracts":null;
  const {rows:residents}=useCrud("residents",RESIDENTS);
  const {rows:contracts}=useCrud("contracts",CONTRACTS);
  const {rows:apptRows}=useCrud("appointments",APPOINTMENTS);
  const upcoming=upcomingAppts(apptRows);
  const active=residents.filter(r=>r[5].startsWith("เข้าอยู่")).length;
  const today=new Date().toLocaleDateString("th-TH",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
  const [todo,setTodo]=useState(0);
  return <>
    <PageHeader title={`สวัสดี ${user?.name??""}`.trim()} sub={`${today}${user?.branch&&user.role!=="Global Admin"?` · สาขา${user.branch}`:""} · ${todo?`วันนี้มี ${todo} เรื่องที่รอคุณจัดการ`:"วันนี้ไม่มีเรื่องค้าง"}`}
      actions={<><button className="btn-soft" onClick={()=>go("appointments")}><Icon name="calendar" className="h-4 w-4" /> ดูตารางนัดหมาย</button>{admitTo&&<button className="btn-primary" onClick={()=>go(admitTo)}><Icon name="plus" className="h-4 w-4" /> รับผู้รับบริการใหม่</button>}</>} />
    <TodayCards onCount={setTodo} />
    <div className="overview-columns mt-8"><div className="space-y-4"><h2 className="text-[17px] font-medium text-gold-800">ภาพรวมศูนย์</h2><Occupancy /><MetricGrid items={[{label:"ผู้รับบริการทั้งหมด",value:residents.length,unit:"คน",note:"ข้อมูลผู้รับบริการในระบบ",icon:"user",accent:true},{label:"กำลังรับการดูแล",value:active,unit:"คน",note:"สถานะเข้าอยู่ในศูนย์",icon:"heart"},{label:"สัญญาที่ใช้งาน",value:contracts.filter(r=>r[5]==="ใช้งานอยู่").length,unit:"สัญญา",note:"ทะเบียนสัญญาบริการ",icon:"doc"},{label:"นัดหมายที่กำลังจะมาถึง",value:upcoming.length,unit:"นัด",note:"จากตารางนัดหมาย",icon:"calendar"}]} /></div>
      <aside className="overview-sidebar"><section className="card side-section"><h2 className="section-mini-title">นัดหมายที่กำลังมาถึง<Icon name="calendar" className="h-4 w-4 text-gold-400" /></h2>{upcoming.length?upcoming.slice(0,3).map(({r:a},i)=>{const d=apptIso(a[0]);return <div key={i} className="appointment-mini"><div className="appointment-date">{Number(d.slice(8,10))}<small>{TH_MONTHS[Number(d.slice(5,7))-1]}</small></div><div><strong>{a[2]}</strong><p>{(a[1]??"").slice(0,5)} น. · {a[3]}</p></div></div>;}):<p className="py-3 text-sm text-gold-500">ยังไม่มีนัดหมายที่กำลังจะมาถึง</p>}<button className="side-link" onClick={()=>go("appointments")}>ดูนัดหมายทั้งหมด<Icon name="arrow" className="h-4 w-4" /></button></section>{can(user,"app.staff")&&<Link href="/staff" className="card side-section mt-4 flex items-center gap-4"><span className="grid h-10 w-10 place-items-center rounded-xl bg-cream-100 text-gold-500"><Icon name="phone" /></span><span><strong className="block text-sm font-medium text-gold-700">พื้นที่ของทีมดูแล</strong><span className="text-xs text-gold-500">เปิด KinApp →</span></span></Link>}</aside></div>
    <details className="card mt-8 p-5 [&_summary::-webkit-details-marker]:hidden"><summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3"><span><strong className="block text-[17px] font-medium text-gold-800">เส้นทางการดูแล (คู่มือขั้นตอน)</strong><span className="text-sm text-gold-600">ขั้นตอนงานประจำวัน และการรับผู้รับบริการใหม่ · กดเพื่อเปิดดู</span></span><span className="btn-soft !py-2">เปิด / ปิดขั้นตอน</span></summary>
      <div className="mt-5"><div className="mb-4"><Tabs tabs={["งานประจำวัน","รับผู้รับบริการใหม่"]} value={routine} onChange={setRoutine} /></div><Steps title={routine==="งานประจำวัน"?"เริ่มวันอย่างเป็นระบบ":"ต้อนรับสมาชิกใหม่อย่างพร้อมดูแล"} steps={routine==="งานประจำวัน"?DAILY:ADMISSION} /></div></details>
  </>;
}

/* ---------- สิ่งที่ต้องทำวันนี้ (หน้าแรก) ---------- */
/** การ์ดเรื่องที่ต้องจัดการวันนี้ · ชุดเดียวกับแถบ "ต้องจัดการ" ในภาพรวมและรายงาน (components/dash/Todo.tsx) · ดึงใหม่ทุก 1 นาทีและตอนกลับมาที่หน้าต่าง */
function TodayCards({ onCount }: { onCount: (n: number) => void }) {
  const { go } = useApp();
  const { user } = useSession();
  const [d, setD] = useState<HomeData | null>(null);
  useEffect(() => {
    const load = () => fetch("/api/clinic?op=home", { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})).then(setD).catch(() => {});
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 60_000);
    window.addEventListener("focus", load);
    return () => { clearInterval(t); window.removeEventListener("focus", load); };
  }, []);
  const cards = d ? buildTodos(d, user) : [];
  const open = cards.filter((c) => c.n > 0).length;
  useEffect(() => { onCount(open); }, [open, onCount]);
  if (!d) return <p className="rounded-2xl bg-cream-50 px-5 py-6 text-sm text-gold-600">กำลังโหลดสิ่งที่ต้องทำวันนี้…</p>;
  if (!cards.length) return null;
  // ใบที่มีเรื่องค้างขึ้นก่อน (ด่วนก่อน) · ใบที่เรียบร้อยแล้วอยู่ท้าย
  const sorted = cards;
  return (
    <section aria-labelledby="todo-h">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2"><h2 id="todo-h" className="text-[17px] font-medium text-gold-800">สิ่งที่ต้องทำวันนี้</h2><span className="text-xs text-gold-500">กดการ์ดเพื่อไปทำต่อ</span></div>
      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">{sorted.map((c) => {
        const done = c.n === 0;
        const body = <>
          <span className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-gold-800">{c.title}</span>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${done ? "bg-emerald-50 text-emerald-800" : c.urgent ? "bg-red-50 text-red-800" : "bg-amber-50 text-amber-900"}`}>{done ? "เรียบร้อย" : c.urgent ? "ด่วน" : "ต้องทำ"}</span></span>
          <span className="flex items-baseline gap-2"><span className={`text-4xl font-bold leading-tight ${done ? "text-gold-500" : c.urgent ? "text-red-800" : "text-gold-800"}`}>{c.n}</span><span className="text-sm text-gold-600">{c.unit}</span></span>
          <span className="text-[13px] leading-relaxed text-gold-600">{c.detail}</span>
          {(c.view || c.href) && <span className="mt-auto text-[13px] font-semibold text-gold-700">{c.cta} →</span>}
        </>;
        const cls = `flex min-h-[168px] flex-col gap-2 rounded-[20px] p-5 text-left transition ${done ? "border border-dashed border-cream-300 bg-cream-50" : c.top ? "border border-red-200 bg-red-50/60 shadow-soft hover:border-red-300" : "border border-gold-200 bg-white shadow-soft hover:border-gold-300"}`;
        return c.href || c.view ? <button key={c.key} type="button" className={cls} onClick={() => runTodo(c, go)}>{body}</button>
          : <div key={c.key} className={cls}>{body}</div>;
      })}</div>
    </section>
  );
}

/* ---------- ระบบสัญญา ---------- */
const CONTRACT_STATUSES = ["ใช้งานอยู่", "รอชำระเงินมัดจำ", "สิ้นสุดสัญญา", "ยกเลิกสัญญา"];
const CANCELLED = "ยกเลิกสัญญา";
/** พิมพ์ได้เฉพาะตัวเลข ไม่เกิน max หลัก */
const digitsOnly = (max: number) => (e: React.FormEvent<HTMLInputElement>) => { const el = e.currentTarget; el.value = el.value.replace(/\D/g, "").slice(0, max); };
/** จัดกลุ่มตัวเลขให้อ่านง่าย เช่น 1-1037-00123-45-6 / 081-234-5678 */
const groupDigits = (v: string, sizes: number[]) => { const out: string[] = []; let i = 0; for (const n of sizes) { if (i >= v.length) break; out.push(v.slice(i, i + n)); i += n; } return out.join("-"); };
const DIGIT_KINDS = {
  id: { max: 13, groups: [1, 4, 5, 2, 1], pattern: "\\d{13}", placeholder: "เช่น 1103700123456", title: "เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก" },
  phone: { max: 10, groups: [3, 3, 4], pattern: "0\\d{9}", placeholder: "เช่น 0812345678", title: "เบอร์โทรต้องเป็นตัวเลข 10 หลัก ขึ้นต้นด้วย 0" },
};
/**
 * ช่องเลขบัตรประชาชน / เบอร์โทร: พิมพ์ได้เฉพาะตัวเลขตามจำนวนหลัก
 * ตัวอย่างในช่องบอกวิธีกรอก · ระหว่างพิมพ์ใต้ช่องแสดงผลแบบจัดกลุ่ม พร้อมนับหลักหรือเตือนเมื่อผิด
 */
function DigitsInput({ kind, name, required, defaultValue, "aria-label": ariaLabel }: { kind: keyof typeof DIGIT_KINDS; name: string; required?: boolean; defaultValue?: string; "aria-label"?: string }) {
  const k = DIGIT_KINDS[kind];
  const [v, setV] = useState((defaultValue ?? "").replace(/\D/g, "").slice(0, k.max));
  const done = new RegExp(`^${k.pattern}$`).test(v);
  return <>
    <input name={name} aria-label={ariaLabel} required={required} type={kind === "phone" ? "tel" : "text"} inputMode="numeric" maxLength={k.max} pattern={k.pattern} title={k.title}
      placeholder={k.placeholder} defaultValue={v} onInput={(e) => { digitsOnly(k.max)(e); setV(e.currentTarget.value); }} />
    {v && <p className={`field-hint ${done ? "is-ok" : "is-typing"}`}>
      <b>{groupDigits(v, k.groups)}</b><span>{done ? "ครบแล้ว" : kind === "phone" && v[0] !== "0" ? "ต้องขึ้นต้นด้วย 0" : `${v.length}/${k.max} หลัก`}</span>
    </p>}
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
 * เปิดสัญญาใหม่ 2 ขั้น: กรอกรายละเอียด → เลือกห้องพัก (ห้องเต็ม/ปิดปรับปรุงเลือกไม่ได้)
 * ฟอร์มขั้นที่ 1 ยังอยู่ในหน้า (ซ่อนไว้) ย้อนกลับมาแก้ได้โดยข้อมูลไม่หาย · initial = ต่อสัญญา (ดึงข้อมูลสัญญาเดิมมาให้)
 */
/** รูปบัตรประชาชนที่แนบในฟอร์ม ("" = ไม่ได้แนบ) */
type IdPhotos = { employer: string; resident: string };

function ContractForm({ rooms, residents, contracts = [], initial, fromQuote, onClose, onSave }: { rooms: string[][]; residents: string[][]; contracts?: string[][]; initial?: string[]; fromQuote?: string; onClose: () => void; onSave: (r: string[], photos: IdPhotos) => void }) {
  const [photos, setPhotos] = useState<IdPhotos>({ employer: "", resident: "" });
  const iv = (i: number) => (initial?.[i] && initial[i] !== "-" ? initial[i] : "");
  // ช่องที่มีตัวช่วยกรอก (ปุ่มลัด / พิมพ์แล้วขึ้น / ดึงจากสัญญาเดิม)
  const [who, setWho] = useState(iv(2));
  const [boss, setBoss] = useState(iv(3));
  const [relation, setRelation] = useState(iv(11));
  const [addr, setAddr] = useState(iv(10));
  const [start, setStart] = useState(todayIso());
  const [endDate, setEndDate] = useState(iv(22).slice(0, 10));
  const hosp0 = iv(24).match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  const [hosp, setHosp] = useState(hosp0 && HEALTH_RIGHTS.includes(hosp0[2]) ? hosp0[1] : iv(24));
  const [right, setRight] = useState(hosp0 && HEALTH_RIGHTS.includes(hosp0[2]) ? hosp0[2] : "");
  const [hospAlt, setHospAlt] = useState(iv(29));
  const [meds, setMeds] = useState(iv(28));
  const [drugA, setDrugA] = useState(iv(25));
  const [foodA, setFoodA] = useState(iv(26));
  // ชำระล่วงหน้าเลือกเป็นจำนวนเดือน · ระบบคำนวณยอด (ค่าบริการต่อเดือนรวม VAT × จำนวนเดือน) เก็บในช่องยอดล่วงหน้าของสัญญา
  const [months, setMonths] = useState(0);
  const [deposit, setDeposit] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const [pulledRes, setPulledRes] = useState("");
  const [pulledBoss, setPulledBoss] = useState("");
  // ชื่อโรงพยาบาลที่เคยกรอก · ลูกค้าเก่า (ผู้รับบริการ / ผู้ว่าจ้าง) จากสัญญาเดิม
  const pastHosp = useMemo(() => [...new Set(contracts.map((c) => (c[24] ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim()).concat(contracts.map((c) => (c[29] ?? "").trim())).filter((x) => x && x !== "-" && x !== HOSP_LATER))], [contracts]);
  const latest = (k: number, v: string) => contracts.filter((c) => c[k] === v).sort((a, b) => String(b[0]).localeCompare(String(a[0])))[0];
  const setField = (name: string, v?: string) => {
    const el = formRef.current?.elements.namedItem(name) as HTMLInputElement | null;
    if (!el || !v || v === "-") return;
    el.value = v; el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const fillEmployer = (c: string[]) => { setBoss(c[3]); setField("employer_id", c[8]); setField("phone", c[9]); if (c[10] && c[10] !== "-") setAddr(c[10]); if (c[11] && c[11] !== "-") setRelation(c[11]); };
  const pickResident = (name: string) => {
    const c = latest(2, name);
    if (!c) return;
    setField("resident_id", c[12]); setField("age", c[13]);
    const h = (c[24] ?? "").match(/^(.*?)\s*\(([^)]+)\)\s*$/);
    if (c[24] && c[24] !== "-") { setHosp(h && HEALTH_RIGHTS.includes(h[2]) ? h[1] : c[24]); setRight(h && HEALTH_RIGHTS.includes(h[2]) ? h[2] : ""); }
    if (c[28] && c[28] !== "-") setMeds(c[28]);
    if (c[25] && c[25] !== "-") setDrugA(c[25]);
    if (c[26] && c[26] !== "-") setFoodA(c[26]);
    if (!boss.trim()) { fillEmployer(c); setPulledBoss(c[0]); }
    setWho(c[2]); setPulledRes(c[0]);
  };
  const pickEmployer = (name: string) => { const c = latest(3, name); if (c) { fillEmployer(c); setPulledBoss(c[0]); } };
  // ชื่อที่พิมพ์ตรงกับลูกค้าเก่า: เสนอให้ดึงข้อมูลเดิม (ไม่ดึงเอง เพราะอาจเป็นคนละคนที่ชื่อซ้ำ)
  const oldRes = !initial && who.trim() ? latest(2, who.trim().replace(/\s+/g, " ")) : undefined;
  const oldBoss = !initial && boss.trim() ? latest(3, boss.trim().replace(/\s+/g, " ")) : undefined;
  const PastBox = ({ c, pulled, kind, onPull }: { c?: string[]; pulled: string; kind: "res" | "boss"; onPull: () => void }) => !c ? null
    : pulled === c[0] ? <p role="status" className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">ดึงข้อมูลจากสัญญาเดิม {c[0]} แล้ว{kind === "res" ? " (เลขบัตร อายุ โรงพยาบาล ยาประจำ ประวัติแพ้)" : " (เลขบัตร โทรศัพท์ ที่อยู่ ความเกี่ยวข้อง)"} · ตรวจให้ตรงกับบัตรจริงอีกครั้ง</p>
    : <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <span>ชื่อนี้เคยมีสัญญา <b>{c[0]}</b> · สาขา{c[1]}{kind === "res" ? ` · ผู้ว่าจ้าง ${c[3]}` : ` · ผู้รับบริการ ${c[2]}`} · ถ้าเป็นคนเดิม กดดึงข้อมูลได้ · ถ้าเป็นคนละคนที่ชื่อซ้ำ ไม่ต้องกด</span>
        <button type="button" className="btn-soft !min-h-0 !py-1.5 !text-xs" onClick={onPull}>ดึงข้อมูลจากสัญญาเดิม</button>
      </div>;
  // รายการค่าบริการจากใบราคา (ต่อสัญญา / เปิดจากใบเสนอราคา = ดึงรายการเดิมมาให้)
  const [items, setItems] = useState<ServiceLine[]>(() => (initial ? contractLines(initial) : []));
  const [fee, setFee] = useState(() => initial?.[4] && initial[4] !== "-" ? initial[4].replace(/,/g, "") : "");
  // ช่องค่าห้อง: ตรงกับราคาในใบราคา = เลือกห้องนั้นไว้ · ราคาอื่น = กำหนดเอง
  const pickOf = (f: number) => { if (!f) return ""; const i = ROOMS.findIndex((x) => x.month === f || x.promo === f); return i < 0 ? "custom" : `${i}:${ROOMS[i].month === f ? "m" : "p"}`; };
  const [feePick, setFeePick] = useState(() => pickOf(Number(fee) || 0));
  // ชื่อห้องเมื่อกำหนดราคาเอง (ใช้ตั้งชื่อบรรทัดค่าห้องในใบแจ้งหนี้และสัญญา)
  const [roomName, setRoomName] = useState(() => (initial ? contractRoomName(initial) : ""));
  // VAT ค่าห้อง (%) บวกเพิ่มในใบแจ้งหนี้ · ต่อสัญญาใช้อัตราเดิม
  const [roomVat, setRoomVat] = useState(() => (initial ? String(contractVat(initial)) : String(DEFAULT_VAT)));
  // ค่าห้องที่กรอก: รวม VAT แล้ว หรือบวก VAT เพิ่ม · VAT คิดเฉพาะค่าห้อง ไม่รวมรายการบริการเพิ่มเติม
  // ติ๊ก "คิด VAT" (ค่าเริ่มต้น) · ไม่ติ๊ก = ค่าห้องไม่มี VAT (เก็บอัตรา 0)
  const [vatOn, setVatOn] = useState(() => (initial ? contractVat(initial) > 0 : true));
  const feeN = Number(fee) || 0, rateN = vatOn ? Number(roomVat) || 0 : 0;
  const vatAmt = Math.round(feeN * rateN) / 100;
  /** ค่าห้องที่ต้องจ่ายจริงต่อเดือน (รวม VAT) */
  const roomPay = feeN + vatAmt;
  const [roomDep, setRoomDep] = useState(() => initial?.[27] && initial[27] !== "-" ? initial[27].replace(/,/g, "") : "");
  const sum = (Number(fee) || 0) + items.reduce((n, x) => n + svcNet(x), 0);
  const monthly = Math.round((sum - feeN + roomPay) * 100) / 100;
  const prepaid = months > 0 && monthly > 0 ? String(Math.round(monthly * months * 100) / 100) : "";
  const firstBill = (months || 1) * monthly + (Number(deposit) || 0) - (Number(roomDep) || 0);
  const branchNames = useBranchNames();
  const { go, toast } = useApp();
  const { user } = useSession();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  /** ห้องที่กด "ราคาถูกแล้ว" (ไม่เตือนค่าห้องไม่ตรงซ้ำ) */
  const [priceOk, setPriceOk] = useState("");
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

  /** แถวสัญญาจากค่าที่กรอกทุกขั้น (ห้องใส่ตอนบันทึก) */
  const buildRow = () => {
    const f = new FormData(formRef.current ?? undefined);
    const g = (k: string) => String(f.get(k) ?? "").trim();
    const lines = items.filter((x) => x.desc.trim());
    return [
      "", g("branch"), norm(who), norm(boss), fee || "-", g("status") || CONTRACT_STATUSES[0],
      NO_ROOM, start, g("employer_id"), g("phone"), addr.trim(), relation.trim(),
      g("resident_id"), g("age"), initial?.[14] ?? "", lines.map((x) => x.desc).join(", "), lines.length ? String(lines.reduce((n, x) => n + svcNet(x), 0)) : "", initial?.[17] ?? "",
      prepaid, deposit, g("note"),
      g("program"), endDate, JSON.stringify([...lines, ...(feePick === "custom" && roomName.trim() ? [{ desc: roomName.trim(), qty: 1, unit: "เดือน", price: 0, room: true }] : [])]), [hosp.trim(), right ? `(${right})` : ""].filter(Boolean).join(" "), drugA.trim(), foodA.trim(), roomDep, meds.trim(), hospAlt.trim(),
      String(rateN),
    ];
  };

  /** ขั้น 1 → 2: ตรวจรายละเอียดแล้วไปกรอกค่าใช้จ่าย */
  const toCosts = () => {
    if (endDate && endDate < start) return toast("วันสิ้นสุดสัญญาต้องไม่ก่อนวันเริ่มสัญญา");
    if (!drugA.trim()) return toast(`กรุณาระบุประวัติแพ้ยา หรือกด "${NO_ALLERGY}"`);
    if (!foodA.trim()) return toast(`กรุณาระบุประวัติแพ้อาหาร หรือกด "${NO_ALLERGY}"`);
    const r = buildRow();
    if (!r[1]) return toast("กรุณาเลือกสาขา");
    setRow(r);
    setStep(2);
    window.scrollTo(0, 0);
  };

  /** ขั้น 2 → 3: ตรวจค่าใช้จ่ายแล้วไปเลือกห้อง */
  const toRooms = () => {
    if (items.some((x) => x.desc.trim() && (!(x.qty > 0) || x.price < 0))) return toast("กรุณาตรวจจำนวนและราคาของรายการค่าบริการ");
    const r = buildRow();
    setRow(r);
    // ผู้รับบริการที่มีห้องอยู่แล้ว (ต่อสัญญา): เลือกห้องเดิมไว้ให้
    const cur = residents.find((x) => norm(x[0]) === r[2] && x[3] === r[1] && staying(x[5] ?? ""));
    const curRoom = cur ? findRoom(all, r[1], cur[2]) : undefined;
    setRoom(curRoom ? curRoom.no : room && findRoom(all, r[1], room) ? room : "");
    setWarn("");
    setStep(3);
    window.scrollTo(0, 0);
  };

  /**
   * ค่าห้องจากห้องที่เลือก (ประเภทห้องต้องตรงหมวดในใบราคาก่อน เช่น ห้องเดี่ยวไม่เลือกราคาห้องคู่แม้ราคาเท่ากัน)
   *  ค่าห้องที่ตั้งไว้ตรงราคาในหมวด > ชื่อห้องตรงใบราคา (ราคาปกติ) > ค่าห้องที่ตั้งไว้ (กำหนดเอง)
   */
  const roomPrice = (r: RoomInfo): { fee: number; pick: string } | null => {
    const rate = Number(String(r.rate ?? "").replace(/,/g, "")) || 0;
    const cat = (n: string) => (/คู่|twin/i.test(n) ? "คู่" : /รวม|shared/i.test(n) ? "รวม" : /เดี่ยว|deluxe|superior|suite/i.test(n) ? "เดี่ยว" : "");
    const tc = cat(r.type), t = r.type.toLowerCase();
    const named = ROOMS.findIndex((x) => { const en = x.name.match(/\(([^)]+?)(?: Room)?\)/)?.[1]; return !!en && t.includes(en.toLowerCase()); });
    const byRate = ROOMS.findIndex((x, i) => (named < 0 ? !tc || cat(x.name) === tc : i === named) && (x.month === rate || x.promo === rate));
    if (rate && byRate >= 0) return { fee: rate, pick: `${byRate}:${ROOMS[byRate].month === rate ? "m" : "p"}` };
    const i = named >= 0 ? named : tc === "คู่" || tc === "รวม" ? ROOMS.findIndex((x) => cat(x.name) === tc) : -1;
    if (i >= 0) return { fee: ROOMS[i].month, pick: `${i}:m` };
    return rate ? { fee: rate, pick: "custom" } : null;
  };

  /** ขั้น 3: บันทึกสัญญา (มีห้อง / ยังไม่มีห้อง) */
  const finish = (withRoom: boolean) => {
    if (!row) return;
    if (withRoom) {
      const r = findRoom(all, row[1], room);
      if (!r) return toast("กรุณาเลือกห้องพัก");
      const problem = roomProblem(r, row[2]);
      if (problem) { setWarn(problem); return toast(problem); }
    }
    onSave(buildRow().map((x, i) => (i === 6 ? (withRoom ? room : NO_ROOM) : x)), photos);
  };

  // ค่าห้องที่เลือกในขั้นที่ 2 เทียบกับห้องที่เลือก (เตือนเท่านั้น)
  const picked = row && room ? findRoom(all, row[1], room) : undefined;
  const suggest = picked ? roomPrice(picked) : null;
  const mismatch = picked && suggest && suggest.fee !== (Number(fee) || 0) && priceOk !== picked.no ? suggest : null;
  const applyRoomPrice = (x: { fee: number; pick: string }) => {
    setFee(String(x.fee)); setFeePick(x.pick);
    if (row) setRow(row.map((v, k) => (k === 4 ? String(x.fee) : v)));
    toast(`เปลี่ยนค่าห้องเป็น ${money(x.fee)} บาท/เดือนแล้ว`);
  };

  const pick = (r: RoomInfo) => {
    const problem = roomProblem(r, row?.[2]);
    if (problem) { setWarn(problem); toast(problem); return; }
    setWarn(""); setRoom(r.no);
  };

  return (
    <Section title={fromQuote !== undefined ? `เปิดสัญญาใหม่ · จากใบเสนอราคา ${fromQuote}` : initial ? `ต่อสัญญา · ${initial[2]} (สัญญาเดิม ${initial[0]})` : "เปิดสัญญาใหม่"}>
      <div className="contract-steps" aria-label="ขั้นตอน">
        <span className={step === 1 ? "is-active" : ""}><b>1</b>รายละเอียดสัญญา</span>
        <span className={step === 2 ? "is-active" : ""}><b>2</b>ค่าใช้จ่าย</span>
        <span className={step === 3 ? "is-active" : ""}><b>3</b>เลือกห้องพัก</span>
      </div>

      <form ref={formRef} className={`space-y-8 ${step === 3 ? "hidden" : ""}`} onSubmit={(e) => { e.preventDefault(); if (step === 1) toCosts(); else toRooms(); }}>
        <div className={step === 1 ? "space-y-8" : "hidden"}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="สาขา (Branch)" required className="md:col-span-2"><select name="branch" defaultValue={d(1) ?? ""}><option value="">-- กรุณาเลือกสาขา --</option>{branchNames.map((b) => <option key={b}>{b}</option>)}</select></Field>
          <Field label="ชื่อ นามสกุล ผู้จ้าง" required>{initial ? <input value={boss} onChange={(e) => setBoss(e.target.value)} required />
            : <SuggestText value={boss} onChange={setBoss} options={[...new Set(contracts.map((c) => c[3]).filter((x) => x && x !== "-"))]} onPick={pickEmployer} label="ชื่อผู้ว่าจ้าง" placeholder="เช่น นายสมชาย ใจดี"
              renderSub={(n) => { const c = latest(3, n); return c ? `${c[0]} · ผู้รับบริการ ${c[2]}` : ""; }} />}
            {!initial && <PastBox c={oldBoss} pulled={pulledBoss} kind="boss" onPull={() => oldBoss && pickEmployer(oldBoss[3])} />}</Field>
          <Field label="เลขที่บัตรประชาชน"><DigitsInput kind="id" name="employer_id" defaultValue={d(8)} /></Field>
          <Field label="ที่อยู่" required className="md:col-span-2"><div className="space-y-2">
            <AddressFinder onPick={(t) => setAddr((a) => `${a.replace(/\s+(แขวง|ตำบล).*$/, "").trim()} ${t}`.trim())} />
            <textarea rows={2} required value={addr} onChange={(e) => setAddr(e.target.value)} aria-label="ที่อยู่" placeholder="บ้านเลขที่ ซอย ถนน" />
          </div></Field>
          <Field label="รูปถ่ายบัตรประชาชนผู้ว่าจ้าง" className="md:col-span-2"><PhotoPicker value={photos.employer} onChange={(v) => setPhotos({ ...photos, employer: v })} label={initial ? "ไม่แนบใหม่ = ใช้รูปจากสัญญาเดิม" : "ถ่ายหรือเลือกรูป · ให้เห็นชื่อ เลขบัตร รูปหน้า"} /></Field>
          <Field label="โทรศัพท์" required><DigitsInput kind="phone" name="phone" required defaultValue={d(9)} /></Field>
          <Field label="เกี่ยวข้อง"><div className="space-y-2"><ChipChoice label="เกี่ยวข้อง" options={RELATIONS} value={RELATIONS.includes(relation) ? relation : ""} onChange={setRelation} />
            <input value={relation} onChange={(e) => setRelation(e.target.value)} placeholder="หรือพิมพ์เอง เช่น ลูกเขย" aria-label="เกี่ยวข้อง (พิมพ์เอง)" /></div></Field>
          <Field label="ชื่อ นามสกุล ผู้รับบริการ" required>{initial ? <input value={who} readOnly required />
            : <SuggestText value={who} onChange={setWho} options={[...new Set(contracts.map((c) => c[2]).filter((x) => x && x !== "-"))]} onPick={pickResident} label="ชื่อผู้รับบริการ" placeholder="เช่น นางสมศรี ใจดี"
              renderSub={(n) => { const c = latest(2, n); return c ? `เคยมีสัญญา ${c[0]} · ${c[1]} · ดึงเลขบัตร อายุ ประวัติแพ้ โรงพยาบาลให้` : ""; }} />}
            {!initial && (oldRes ? <PastBox c={oldRes} pulled={pulledRes} kind="res" onPull={() => pickResident(oldRes[2])} /> : null)}</Field>
          <Field label="เลขที่บัตรประชาชนผู้รับบริการ"><DigitsInput kind="id" name="resident_id" defaultValue={d(12)} /></Field>
          <Field label="อายุ (ปี) ผู้รับบริการ"><input name="age" type="number" min={0} max={130} placeholder="เช่น 78" defaultValue={dn(13)} /></Field>
          <Field label="วันเริ่มสัญญา" required><input type="date" required value={start} onChange={(e) => setStart(e.target.value)} aria-label="วันเริ่มสัญญา" /></Field>
          <Field label="รูปถ่ายบัตรประชาชนผู้รับบริการ" className="md:col-span-2"><PhotoPicker value={photos.resident} onChange={(v) => setPhotos({ ...photos, resident: v })} label={initial ? "ไม่แนบใหม่ = ใช้รูปจากสัญญาเดิม" : "ถ่ายหรือเลือกรูป · ให้เห็นชื่อ เลขบัตร รูปหน้า"} /></Field>
          <Field label="เลขที่สัญญา"><input value={initial && fromQuote === undefined ? `ออกเลขใหม่อัตโนมัติ (สัญญาเดิม ${initial[0]})` : "ออกเลขอัตโนมัติ เช่น CT-2569-0001"} readOnly tabIndex={-1} className="field-locked" /></Field>
          <Field label="วันสิ้นสุดสัญญา"><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} aria-label="วันสิ้นสุดสัญญา" />
            <div className="mt-2 flex flex-wrap gap-1.5">{[[1, "1 เดือน"], [3, "3 เดือน"], [6, "6 เดือน"], [12, "1 ปี"]].map(([n, t]) => <button key={t} type="button" disabled={!start} onClick={() => setEndDate(addMonthsIso(start, Number(n)))} className="rounded-full border border-cream-300 bg-white px-3 py-1 text-xs text-gold-700 hover:border-gold-300">+{t}</button>)}
              {endDate && <button type="button" onClick={() => setEndDate("")} className="rounded-full px-3 py-1 text-xs text-gold-500 underline-offset-2 hover:underline">ไม่กำหนดวันสิ้นสุด</button>}</div>
            <p className="field-hint">ว่าง = มีผลต่อเนื่องจนกว่าจะจำหน่าย</p></Field>
          <Field label="สถานะสัญญา" required><select name="status" defaultValue={CONTRACT_STATUSES[0]}>{CONTRACT_STATUSES.slice(0, 2).map((x) => <option key={x}>{x}</option>)}</select></Field>
        </div>

        <div>
          <h3 className="mb-3 font-semibold text-gold-800">ข้อมูลด้านสุขภาพของผู้รับบริการ</h3>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="โรงพยาบาลตามสิทธิ์การรักษา"><div className="space-y-2"><div className="relative"><SuggestText value={hosp} onChange={setHosp} options={pastHosp} label="โรงพยาบาล" placeholder="ชื่อโรงพยาบาล เช่น รพ.ราชวิถี" inputClass={right ? "!pr-32" : undefined} />
                {right && <span className="pointer-events-none absolute right-3 top-[22px] -translate-y-1/2 rounded-full bg-gold-700 px-2.5 py-0.5 text-xs font-medium text-white">{right}</span>}</div>
              <div className="flex flex-wrap gap-1.5"><button type="button" aria-pressed={hosp.trim() === HOSP_LATER} onClick={() => setHosp(hosp.trim() === HOSP_LATER ? "" : HOSP_LATER)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${hosp.trim() === HOSP_LATER ? "bg-gold-700 text-white" : "border border-cream-300 bg-white text-gold-700 hover:border-gold-300"}`}>{HOSP_LATER}</button></div>
              <p className="text-xs text-gold-600">เลือกสิทธิ์การรักษา</p>
              <ChipChoice label="สิทธิ์การรักษา" options={HEALTH_RIGHTS} value={right} onChange={setRight} /></div>{(hosp.trim() || right) && <p className={`mt-2 rounded-xl px-3 py-2 text-sm ${hosp.trim() ? "bg-cream-50 text-gold-700" : "border border-amber-200 bg-amber-50 text-amber-900"}`}>
                {hosp.trim() ? <>ในสัญญาข้อ 3.8 จะพิมพ์ว่า ให้นำส่งโรงพยาบาล <b className="text-gold-900">{[hosp.trim(), right ? `(${right})` : ""].filter(Boolean).join(" ")}</b>{hosp.trim() === HOSP_LATER && " · อย่าลืมตามชื่อโรงพยาบาลจากญาติแล้วแก้ไขสัญญา"}</> : <>เลือกสิทธิ์ <b>{right}</b> แล้ว · ยังไม่ได้ใส่ชื่อโรงพยาบาล · ถ้ายังไม่รู้ กด &quot;{HOSP_LATER}&quot;</>}</p>}
              <p className="field-hint">นำส่งเมื่อเจ็บป่วย</p></Field>
            <Field label="โรงพยาบาลสำรอง (ใกล้เคียง)"><SuggestText value={hospAlt} onChange={setHospAlt} options={pastHosp} label="โรงพยาบาลสำรอง" placeholder="เช่น รพ.ใกล้ศูนย์ ส่งได้เร็วกรณีฉุกเฉิน" /><p className="field-hint">ว่างได้ · สัญญาเว้นเส้นให้เขียนตอนเซ็น</p></Field>
            <Field label="ยา / เวชภัณฑ์ที่ใช้ประจำ"><TagInput label="ยาที่ใช้ประจำ" value={meds} onChange={setMeds} suggestions={COMMON_MEDS} quick={["ยาความดัน", "ยาเบาหวาน", "ยาไขมัน"]} none="ไม่มียาประจำ" placeholder="พิมพ์ชื่อยา เช่น aml แล้วเลือก หรือพิมพ์เองแล้วกด Enter" /><p className="field-hint">ใช้พิมพ์ในสัญญาเท่านั้น · ยาที่ต้องจัดเพิ่มที่ประวัติผู้รับบริการ แท็บยา</p></Field>
            <Field label="ประวัติแพ้ยา" required><TagInput label="ประวัติแพ้ยา" value={drugA} onChange={setDrugA} suggestions={ALLERGY_DRUGS} none={NO_ALLERGY} quick={["Penicillin", "Sulfonamide (Sulfa)", "Aspirin", "NSAIDs"]} placeholder="พิมพ์ชื่อยาที่แพ้ เช่น pen แล้วเลือก" /><p className="field-hint">ไม่แพ้กด &quot;{NO_ALLERGY}&quot;</p></Field>
            <Field label="ประวัติแพ้อาหาร" required><TagInput label="ประวัติแพ้อาหาร" value={foodA} onChange={setFoodA} suggestions={FOOD_ALLERGENS} none={NO_ALLERGY} quick={["อาหารทะเล", "นมวัว", "ไข่", "ถั่วลิสง"]} placeholder="พิมพ์อาหารที่แพ้ แล้วกด Enter" /><p className="field-hint">ไม่แพ้กด &quot;{NO_ALLERGY}&quot;</p></Field>
          </div>
          <p className="mt-3 rounded-xl bg-cream-50 px-4 py-2.5 text-sm text-gold-700">โรคประจำตัว ไม่ต้องกรอกที่นี่ · ระบบดึงจากข้อมูลผู้รับบริการ (เมนูผู้รับบริการ) มาพิมพ์ในสัญญาให้เอง</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="หมายเหตุ" className="md:col-span-2"><textarea name="note" rows={2} placeholder="เช่น แพ้ยาเพนิซิลลิน, ญาติมาเยี่ยมทุกวันเสาร์" defaultValue={initial ? `ต่อจากสัญญา ${initial[0]}` : undefined} /></Field>
          </div>
        </div>
        </div>

        <div className={step === 2 ? "" : "hidden"}>
          {row && <div className="mb-5 rounded-2xl border border-cream-200 bg-cream-50/60 px-4 py-3 text-sm text-gold-700">
            <p><span className="text-gold-500">ผู้รับบริการ</span> <b className="font-medium text-gold-800">{row[2]}</b> · <span className="text-gold-500">สาขา</span> {row[1]} · <span className="text-gold-500">ผู้ว่าจ้าง</span> {row[3]}</p>
          </div>}
          <h3 className="mb-3 font-semibold text-gold-800">โปรแกรมและค่าบริการ</h3>
          <div className="grid gap-4">
            <Field label="โปรแกรม"><input name="program" list="contract-programs" placeholder="เลือกหรือพิมพ์ชื่อโปรแกรม" defaultValue={d(21) ?? PROGRAMS[0]} /><datalist id="contract-programs">{PROGRAMS.map((x) => <option key={x} value={x} />)}</datalist></Field>
            <Field label="ค่าห้อง (บาท/เดือน)">
              {/* เลือกค่าห้อง: การ์ดละประเภทห้อง กดราคาปกติหรือโปรโมชันได้ทันที */}
              <div className="room-pick" role="radiogroup" aria-label="ค่าห้อง">
                {ROOMS.map((x, i) => {
                  const [th, en] = [x.name.replace(/\s*\(.*\)\s*$/, ""), x.name.match(/\(([^)]+)\)/)?.[1] ?? ""];
                  const on = feePick.startsWith(`${i}:`);
                  return (
                    <div key={x.name} className={`room-pick-row ${on ? "is-on" : ""}`}>
                      <span className="room-pick-name"><b>{th}</b>{en && <small>{en}</small>}</span>
                      {([["m", "ปกติ", x.month], ["p", "โปรโมชัน", x.promo]] as const).map(([k, t, v]) => (
                        <button key={k} type="button" role="radio" aria-checked={feePick === `${i}:${k}`} aria-label={`${x.name} ราคา${t} ${v.toLocaleString()} บาท`}
                          className={`room-pick-price ${feePick === `${i}:${k}` ? "is-on" : ""}`} onClick={() => { setFeePick(`${i}:${k}`); setFee(String(v)); }}>
                          <small>{t}</small>{v.toLocaleString()}
                        </button>
                      ))}
                    </div>
                  );
                })}
                <div className={`room-pick-row room-pick-custom ${feePick === "custom" ? "is-on" : ""}`}>
                  <span className="room-pick-name"><b>กำหนดราคาเอง</b><small>ราคาพิเศษ / ห้องนอกใบราคา</small></span>
                  {feePick === "custom"
                    ? <>
                      <label className="room-pick-field">ชื่อห้อง<input type="text" list="room-names" value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="เช่น ห้องเดี่ยวพิเศษ" /></label>
                      <datalist id="room-names">{[...new Set(["ห้องรวม", "ห้องคู่", "ห้องเดี่ยว", ...ROOMS.map((x) => x.name)])].map((x) => <option key={x} value={x} />)}</datalist>
                      <label className="room-pick-field">ราคา (บาท/เดือน)<input type="number" min={0} value={fee} onChange={(e) => setFee(e.target.value)} placeholder="เช่น 14000" autoFocus /></label>
                    </>
                    : <button type="button" role="radio" aria-checked={false} className="room-pick-price" onClick={() => setFeePick("custom")}><small>ใส่ราคา</small>กำหนดเอง</button>}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-gold-700">
                <label className="flex cursor-pointer items-center gap-2 font-medium">
                  <input type="checkbox" className="!h-4 !w-4 !min-h-0" checked={vatOn} onChange={(e) => { setVatOn(e.target.checked); if (e.target.checked && !(Number(roomVat) > 0)) setRoomVat(String(DEFAULT_VAT)); }} />
                  คิด VAT ค่าห้อง
                </label>
                {vatOn && <><input type="number" min={0} max={30} step="0.5" className="!w-20" value={roomVat} onChange={(e) => setRoomVat(e.target.value)} aria-label="VAT ค่าห้อง (%)" /><span>%</span></>}
              </div>
            </Field>
          </div>
          <p className="label mt-4">รายการบริการและค่าบริการเพิ่มเติม</p>
          <ServiceLines items={items} onChange={setItems} total={false} exclude={["ห้องพัก"]} />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="หักค่ามัดจำห้องพัก (บาท)"><input type="number" min={0} value={roomDep} onChange={(e) => setRoomDep(e.target.value)} placeholder="เช่น 3000" /></Field>
            <div className="self-end rounded-2xl bg-cream-50 px-4 py-3 text-sm text-gold-700">
              {feeN > 0 && <p>ค่าห้อง {money(roomPay)}{vatAmt > 0 ? ` (+ VAT ${rateN}% ${money(vatAmt)})` : " (ไม่คิด VAT)"}</p>}
              {sum - feeN > 0 && <p>บริการเพิ่มเติม {money(sum - feeN)} (ไม่มี VAT)</p>}
              <p>รวมต่อเดือน <b className="text-gold-900">{money(monthly)}</b> บาท</p>
              {monthly > 0 && <p className="mt-1 border-t border-cream-300 pt-1">ใบแจ้งหนี้แรกเข้า: ค่าบริการ {months || 1} เดือน {money((months || 1) * monthly)}{Number(deposit) > 0 ? ` + เงินประกัน ${money(Number(deposit))}` : ""}{Number(roomDep) > 0 ? ` − มัดจำห้องที่รับไว้แล้ว ${money(Number(roomDep))}` : ""} = <b className="text-gold-900">{money(firstBill)}</b> บาท</p>}
            </div>
            <Field label="ชำระค่าบริการล่วงหน้า">
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="ชำระค่าบริการล่วงหน้า">{[0, 1, 2, 3, 6].map((n) => (
                <button key={n} type="button" role="radio" aria-checked={months === n} onClick={() => setMonths(n)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium ${months === n ? "bg-gold-700 text-white" : "border border-cream-300 bg-white text-gold-700 hover:border-gold-300"}`}>
                  {n ? `${n} เดือน${monthly > 0 ? ` · ${money(monthly * n)}` : ""}` : "ไม่เก็บล่วงหน้า"}</button>
              ))}</div></Field>
            <Field label="ชำระเงินประกัน (บาท)"><input type="number" min={0} value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="เช่น 60000" aria-label="ชำระเงินประกัน" />
              {sum > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{[1, 2].map((n) => <button key={n} type="button" onClick={() => setDeposit(String(sum * n))} className="rounded-full border border-cream-300 bg-white px-3 py-1 text-xs text-gold-700 hover:border-gold-300">{n} เดือน · {money(sum * n)}</button>)}</div>}</Field>
            {!prepaid && !deposit && sum > 0 && <p role="status" className="md:col-span-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">ไม่เก็บล่วงหน้า · ระบบออกใบเดือนแรก {money(Math.max(0, firstBill))} บาท เป็น &quot;{DRAFT}&quot;</p>}
          </div>
        </div>

        {step === 1 ? <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-soft" onClick={onClose}>ยกเลิก</button>
          <button className="btn-primary">ถัดไป: ค่าใช้จ่าย <Icon name="arrow" className="h-4 w-4" /></button>
        </div> : <div className="flex flex-col-reverse gap-2 border-t border-cream-200 pt-4 sm:flex-row sm:justify-end">
          <button type="button" className="btn-soft" onClick={() => { setStep(1); window.scrollTo(0, 0); }}>ย้อนกลับไปแก้รายละเอียด</button>
          <button className="btn-primary">ถัดไป: เลือกห้องพัก <Icon name="arrow" className="h-4 w-4" /></button>
        </div>}
      </form>

      {step === 3 && row && <div className="space-y-5">
        <div className="rounded-2xl border border-cream-200 bg-cream-50/60 px-4 py-3 text-sm text-gold-700">
          <p><span className="text-gold-500">ผู้รับบริการ</span> <b className="font-medium text-gold-800">{row[2]}</b>{row[13] ? ` · ${row[13]} ปี` : ""} · <span className="text-gold-500">สาขา</span> {row[1]} · <span className="text-gold-500">ผู้ว่าจ้าง</span> {row[3]}{contractTotal(row) ? <> · <span className="text-gold-500">ยอดรวม</span> {money(contractTotal(row))} บาท/เดือน</> : ""}</p>
          {existing && <p className="mt-1 text-xs text-gold-500">มีชื่อนี้ในทะเบียนผู้รับบริการแล้ว ระบบจะอัปเดตห้องให้คนเดิม ไม่สร้างรายชื่อซ้ำ</p>}
        </div>
        {warn && <p role="alert" className="room-warn">{warn}</p>}
        {!options.length ? <div className="empty-state"><Icon name="bed" /><p>สาขา{row[1]}ยังไม่มีห้องในระบบ {can(user, "rooms.manage") ? "สร้างห้องที่เมนูห้องพักและเตียง หรือบันทึกสัญญาไปก่อนแล้วจัดห้องภายหลัง" : "แจ้งผู้จัดการสาขาให้สร้างห้อง หรือบันทึกสัญญาไปก่อนแล้วจัดห้องภายหลัง"}</p>
          {can(user, "rooms.manage") && <button type="button" className="mt-3 text-sm text-gold-700 underline-offset-4 hover:underline" onClick={() => go("rooms")}>ไปที่ห้องพักและเตียง (ข้อมูลที่กรอกจะไม่ถูกบันทึก)</button>}</div>
          : <>
            <p className="text-sm text-gold-600">เลือกห้องที่ยังว่าง · สาขา{row[1]} ว่าง {free} เตียง จาก {options.length} ห้อง</p>
            {free === 0 && <p role="alert" className="room-warn">ห้องของสาขา{row[1]}เต็มทุกห้องแล้ว บันทึกสัญญาโดยยังไม่เลือกห้อง แล้วแจ้งผู้จัดการสาขาให้เพิ่มห้องหรือเพิ่มจำนวนผู้ป่วยต่อห้อง</p>}
            <div className="room-grid">{options.map((r) => <RoomCard key={r.i} room={r} selected={roomKey(r.no) === roomKey(room)} onClick={() => pick(r)} />)}</div>
            {picked && mismatch && <div role="status" className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
              <p className="text-sm text-amber-950"><b>ห้อง {picked.no} ({picked.type}) ค่าห้องคือ {money(mismatch.fee)} บาท/เดือน</b> {Number(fee) ? <>แต่ค่าห้องที่เลือกในขั้นที่ 2 คือ <b>{money(Number(fee))} บาท</b></> : "แต่ยังไม่ได้เลือกค่าห้องในขั้นที่ 2"} · ตรวจอีกครั้งก่อนบันทึก</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-primary !min-h-0 !py-2 !text-sm" onClick={() => applyRoomPrice(mismatch)}>ใช้ค่าห้อง {money(mismatch.fee)}</button>
                {Number(fee) > 0 && <button type="button" className="btn-soft !min-h-0 !py-2 !text-sm" onClick={() => setPriceOk(picked.no)}>ราคาเดิมถูกแล้ว ไม่ต้องเปลี่ยน</button>}
              </div>
            </div>}
          </>}
        <div className="flex flex-col-reverse gap-2 border-t border-cream-200 pt-4 sm:flex-row sm:justify-end">
          <button type="button" className="btn-soft" onClick={() => { setStep(2); window.scrollTo(0, 0); }}>ย้อนกลับไปแก้ค่าใช้จ่าย</button>
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
  { label: "โปรแกรม", suggest: PROGRAMS },
  { label: "วันสิ้นสุดสัญญา (วว/ดด/ปปปป)" },
  { label: "รายการค่าบริการ", hidden: true },
  { label: "โรงพยาบาลตามสิทธิ์การรักษา" },
  { label: "แพ้ยา" },
  { label: "แพ้อาหาร" },
  { label: "หักค่ามัดจำห้องพัก" },
  { label: "ยา / เวชภัณฑ์ที่ใช้ประจำ" },
  { label: "โรงพยาบาลสำรอง (ใกล้เคียง)" },
];
const CONTRACT_COLS = ["เลขที่สัญญา", "สาขา", "ผู้รับบริการ", "ห้อง", "ผู้ว่าจ้าง", "ต่อเดือน (รวม VAT)", "สถานะ"];

type Dlg = { mode: "view" | "edit"; i: number } | null;

export function Contracts() {
  const branchNames = useBranchNames();
  const { user } = useSession();
  const { rows, ids, add, update, remove } = useCrud("contracts", CONTRACTS);
  const [cards, setCards] = useState<{ i: number; employer: string | null; resident: string | null; edit: IdPhotos; loading: boolean } | null>(null);
  const rooms = useCrud("rooms", []);
  const res = useCrud("residents", RESIDENTS);
  const { confirm, toast, go } = useApp();
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
  // เปิดสัญญาจากใบเสนอราคา (ส่งมาจากหน้าใบเสนอราคา)
  const quotes = useCrud("assessments", []);
  const [fromQuote, setFromQuote] = useState<QuoteHandoff | null>(null);
  useEffect(() => { const h = handoff.take(); if (h) { setFromQuote(h); setCreating(true); } }, []);
  const [dc, setDc] = useState<{ i: number; date: string; reason: string; done?: boolean } | null>(null);
  // รายการที่ยังไม่ได้ออกใบแจ้งหนี้ (ยา เวชภัณฑ์ คอร์สกายภาพ กายภาพรายครั้ง) · เตือนก่อน D/C จะได้ไม่ลืมเก็บเงิน
  type Unbilled = { meds: number; supplies: number; courses: number; sessions: number; sum: number };
  const [unbilled, setUnbilled] = useState<Unbilled | null>(null);
  const dcC = dc ? rows[dc.i] : null;
  const dcResId = dcC ? res.ids[resIndex(dcC[2], dcC[1])] : undefined;
  useEffect(() => {
    setUnbilled(null);
    if (!dcResId) return;
    let live = true;
    type U = { qty?: number; price: number };
    fetch(`/api/clinic?op=unbilled&resident=${encodeURIComponent(dcResId)}`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!live || !d) return;
      const sum = (xs: U[] = [], q = true) => xs.reduce((n, x) => n + (q ? x.qty ?? 1 : 1) * (x.price || 0), 0);
      setUnbilled({ meds: d.meds?.length ?? 0, supplies: d.items?.length ?? 0, courses: d.courses?.length ?? 0, sessions: d.sessions?.length ?? 0, sum: sum(d.meds) + sum(d.items) + sum(d.courses, false) });
    }).catch(() => {});
    return () => { live = false; };
  }, [dcResId]);
  // เอกสารพิมพ์: สัญญา · บันทึกต่อท้ายสัญญา · ใบจำหน่าย (ข้อมูลประกอบจากประวัติผู้รับบริการ)
  const branchInfo = useBranchInfo();
  const [doc, setDoc] = useState<null | { kind: "contract"; i: number; copy?: boolean } | { kind: "renew"; before: string[]; after: string[] } | { kind: "dc"; d: DcData; branch: string }>(null);
  const [terms, setTerms] = useState("");
  const [termsDlg, setTermsDlg] = useState<string | null>(null);
  const admin = user?.role === "Global Admin" || user?.role === "Branch Admin";
  useEffect(() => { fetchDocSettings().then((s) => setTerms(s.contract_terms ?? "")).catch(() => {}); }, []);
  const saveTerms = async () => {
    if (termsDlg === null) return;
    try { await clinic({ op: "doc_settings", key: "contract_terms", value: termsDlg.trim() }); setTerms(termsDlg.trim()); setTermsDlg(null); toast("บันทึกเงื่อนไขเพิ่มเติมแล้ว · ขึ้นในข้อ 5.4 ของสัญญาที่พิมพ์หลังจากนี้"); }
    catch (e) { toast((e as Error).message); }
  };
  const resOf = (c: string[]) => { const j = resIndex(c[2], c[1]); return j >= 0 ? { row: res.rows[j], id: res.ids[j] } : null; };

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
    if (renew !== null) { const old = rows[renew]; update(renew, old.map((x, k) => (k === 5 ? "สิ้นสุดสัญญา" : x))); setDoc({ kind: "renew", before: old, after: r }); }
    const inv = contractInvoice(r, j >= 0 ? res.rows[j][6] ?? "" : "");
    if (inv) setInvoices([inv, ...invoices]);
    if (fromQuote) { const k = quotes.ids.indexOf(fromQuote.quoteId); if (k >= 0) quotes.update(k, quotes.rows[k].map((x, n) => (n === 12 ? `เปิดสัญญาแล้ว ${docDate(todayIso())}` : x))); setFromQuote(null); }
    setCreating(false); setRenew(null);
    toast(`${renew !== null ? "ต่อสัญญาแล้ว" : "บันทึกสัญญาแล้ว"} · ${r[2]}${r[6] === NO_ROOM ? " (ยังไม่มีห้อง)" : ` ห้อง ${r[6]}`}${inv ? ` · ออกใบแจ้งหนี้ ${money(inv.net)} บาทที่เมนูการเงินแล้ว${inv.status === DRAFT ? ` (${DRAFT})` : ""}` : ""}`);
  };

  const ended = (c: string[]) => c[5] === CANCELLED || c[5] === "สิ้นสุดสัญญา";
  /** ออกใบแจ้งหนี้ตามสัญญา: ไปหน้าการเงินพร้อมรายการในสัญญา (แก้/เพิ่มได้ก่อนบันทึก) · มีใบค้างชำระอยู่แล้ว ถามก่อน */
  const billContract = (i: number) => {
    const c = rows[i], open = invoices.filter((x) => x.contract === c[0] && (isOpen(x) || x.status === DRAFT));
    const goBill = () => { billHandoff.set(ids[i]); go("billing"); };
    if (!open.length) return goBill();
    confirm({ title: "ออกใบแจ้งหนี้", okLabel: "ออกใบใหม่", message: `สัญญา ${c[0]} มีใบแจ้งหนี้ที่ยังชำระไม่ครบ ${open.length} ใบ (${open.map((x) => x.no ?? "").filter(Boolean).join(", ") || "กำลังออกเลข"}) ต้องการออกใบใหม่อีกใบหรือไม่ · ถ้าจะรับเงินใบเดิม ให้กด รับชำระ ที่หน้าการเงิน`, onOk: goBill });
  };

  /** ยกเลิกสัญญา (เช่น ลูกค้าเปลี่ยนใจ ทำสัญญาผิด): สัญญายังอยู่ในทะเบียน · คืนห้อง · ใบแจ้งหนี้ที่ยังไม่ชำระของสัญญานี้ถูกยกเลิกตาม */
  const cancel = (i: number) => {
    const c = rows[i];
    if (c[5] === CANCELLED) return toast("ไม่สามารถยกเลิกได้ สัญญานี้ถูกยกเลิกไปแล้ว");
    const j = resIndex(c[2], c[1]);
    const stay = j >= 0 && staying(res.rows[j][5] ?? "") && !rows.some((x, k) => k !== i && x[2] === c[2] && x[1] === c[1] && ["ใช้งานอยู่", "รอชำระเงินมัดจำ"].includes(x[5]));
    const bills = invoices.filter((x) => x.contract === c[0] && (x.status === UNPAID || x.status === DRAFT));
    confirm({
      title: "ยกเลิกสัญญา", danger: true, okLabel: "ยกเลิกสัญญา",
      message: `ต้องการยกเลิกสัญญา ${c[0]} ของ ${c[2]} ใช่หรือไม่${stay ? ` · ${c[2]} จะเปลี่ยนเป็นย้ายออกและคืนห้อง${c[6] && c[6] !== NO_ROOM ? ` ${c[6]}` : ""}` : ""}${bills.length ? ` · ใบแจ้งหนี้ที่ยังไม่ชำระ ${bills.length} ใบจะถูกยกเลิก` : ""} (ใบเสร็จที่ชำระแล้วไม่เปลี่ยน)`,
      onOk: () => {
        const note = [c[20], `ยกเลิก ${docDate(todayIso())} โดย ${user?.name ?? ""}`].filter((x) => x && x !== "-").join(" · ");
        update(i, c.map((x, k) => (k === 5 ? CANCELLED : k === 20 ? note : x)));
        if (stay) setResident(j, NO_ROOM, "ย้ายออก (Inactive)");
        if (bills.length) setInvoices(invoices.map((x) => (bills.includes(x) ? { ...x, status: VOID } : x)));
        toast(`ยกเลิกสัญญาแล้ว · ${c[0]} · ${c[2]}`);
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
    toast("บันทึกรูปบัตรประชาชนแล้ว · ดูได้ที่ปุ่ม รูปบัตร ของสัญญานี้"); setCards(null);
  };

  /** D/C กลับบ้าน: สิ้นสุดสัญญา ย้ายออก คืนห้อง แล้วพิมพ์ใบจำหน่าย */
  const discharge = () => {
    if (!dc) return;
    const c = rows[dc.i];
    const j = resIndex(c[2], c[1]);
    const note = [c[20], `D/C ${docDate(dc.date)} · ${dc.reason}`].filter((x) => x && x !== "-").join(" · ");
    update(dc.i, c.map((x, k) => (k === 5 ? "สิ้นสุดสัญญา" : k === 20 ? note : x)));
    if (j >= 0) setResident(j, NO_ROOM, "ย้ายออก (Inactive)");
    setDc(null);
    toast(`D/C แล้ว · ${c[2]} · คืนห้อง${c[6] && c[6] !== NO_ROOM ? ` ${c[6]}` : ""}ให้ว่าง`);
    openDc(c, dc.date, dc.reason);
  };

  /** ใบจำหน่าย: สัญญาณชีพล่าสุด ยาที่ใช้อยู่ นัดถัดไป จากประวัติผู้รับบริการ · ยอดค้างจากหน้าการเงิน */
  const openDc = async (c: string[], date: string, reason: string) => {
    const r = resOf(c);
    const start = c[7] ? c[7].split("/") : [];
    const startIso = start.length === 3 ? `${Number(start[2]) - 543}-${start[1].padStart(2, "0")}-${start[0].padStart(2, "0")}` : "";
    const days = startIso ? Math.max(0, Math.round((new Date(date).getTime() - new Date(startIso).getTime()) / 864e5)) : undefined;
    const base: DcData = { contract: c, hn: r?.row[6], age: r?.row[1] && r.row[1] !== "-" ? r.row[1] : c[13], date, reason, days, chronic: r?.row[4], vitals: null, meds: [], nextAppt: null,
      owing: invoices.filter((x) => x.who === c[2] && isOpen(x)).reduce((n, x) => n + balanceOf(x), 0), deposit: Number(String(c[19] ?? "").replace(/,/g, "")) || 0,
      depositPaid: depositPaidOf(c[0]), unbilled: unbilled?.sum ?? 0 };
    setDoc({ kind: "dc", d: base, branch: c[1] });
    if (!r?.id) return;
    try {
      const p = await fetchProfile(r.id);
      const h = [...p.health].sort((a, b) => String(b.at).localeCompare(String(a.at)))[0];
      const meds = p.meds.filter((m) => !m.on_hold && (m.status ?? "ปกติ") === "ปกติ").map((m) => ({ name: String(m.drug_name ?? "-"), how: `ครั้งละ ${m.dose ?? "-"} ${m.unit ?? ""}`.trim(), meals: String(Array.isArray(m.meals) ? m.meals.join(" · ") : m.meals ?? "-") }));
      const next = p.appts.filter((a) => String(a.date ?? "") >= date).sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
      setDoc({ kind: "dc", branch: c[1], d: { ...base, meds,
        vitals: h ? { at: String(h.at ?? "").slice(0, 16), text: [h.vital_signs, h.o2_sat ? `O₂ ${h.o2_sat}` : "", h.dtx && h.dtx !== "-" ? `DTX ${h.dtx}` : ""].filter(Boolean).join(" · ") } : null,
        nextAppt: next ? `${String(next.date)} ${String(next.time ?? "").slice(0, 5)} น. ${next.purpose ?? ""}` : null } });
    } catch { /* ข้อมูลประกอบโหลดไม่ได้ ยังพิมพ์ส่วนหลักได้ */ }
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
      if (!info) return toast(`ไม่พบห้อง ${v[6]} ในสาขา${v[1]} สร้างห้องที่เมนูห้องพักและเตียงก่อน`);
      const problem = roomProblem(info, v[2]);
      if (problem) return toast(problem);
      v = v.map((x, k) => (k === 6 ? info.no : x));
      if (j >= 0) setResident(j, info.no);
    }
    update(i, v); setDlg(null);
    toast(roomChanged ? `ย้ายห้องแล้ว · ${v[2]} · ไปห้อง ${v[6]}` : `แก้ไขสัญญาแล้ว · ${v[0] || ""} ${v[2]}`.trim());
    // ชำระมัดจำแล้ว (รอชำระ → ใช้งานอยู่): เปลี่ยนจากจองห้องเป็นเข้าพัก
    if (v[5] === "ใช้งานอยู่" && before[5] === "รอชำระเงินมัดจำ" && j >= 0 && res.rows[j][5].startsWith("มัดจำ")) setResident(j, res.rows[j][2], "เข้าอยู่ (Active)");
    if (v[5] === "สิ้นสุดสัญญา" && before[5] !== "สิ้นสุดสัญญา" && j >= 0 && staying(res.rows[j][5] ?? ""))
      confirm({ title: "สิ้นสุดสัญญา", message: `ต้องการเปลี่ยนสถานะ ${v[2]} เป็นย้ายออก และคืนห้อง ${res.rows[j][2]} ให้ว่างด้วยหรือไม่`, okLabel: "ย้ายออกและคืนห้อง", onOk: () => { setResident(j, NO_ROOM, "ย้ายออก (Inactive)"); toast(`ย้ายออกและคืนห้องแล้ว · ${v[2]}`); } });
  };

  if (creating || renew !== null)
    return <ContractForm rooms={rooms.rows} residents={res.rows} contracts={rows} initial={renew !== null ? rows[renew] : fromQuote?.prefill} fromQuote={fromQuote ? fromQuote.quoteNo : undefined} onClose={() => { setCreating(false); setRenew(null); setFromQuote(null); }} onSave={create} />;
  const dcRow = dc ? rows[dc.i] : null;
  const dcRes = dcRow ? res.rows[resIndex(dcRow[2], dcRow[1])] : undefined;
  const owing = dcRow ? invoices.filter((x) => x.who === dcRow[2] && isOpen(x)) : [];
  const unbilledN = unbilled ? unbilled.meds + unbilled.supplies + unbilled.courses + unbilled.sessions : 0;
  /** เงินประกันที่รับไว้จริงของสัญญา: บรรทัด "เงินประกัน" ในใบที่ชำระแล้ว */
  function depositPaidOf(no: string) {
    return invoices.filter((x) => x.contract === no && x.status === PAID).reduce((n, x) => n + parseItems(x.items).filter((i) => i.desc.trim().startsWith("เงินประกัน")).reduce((m, i) => m + lineNet(i), 0), 0);
  }
  const dcMoney = dcRow ? { owing: owing.reduce((n, x) => n + balanceOf(x), 0), depositPaid: depositPaidOf(dcRow[0]), unbilled: unbilled?.sum ?? 0 } : null;
  /** ออกใบสรุปค่าใช้จ่ายก่อนกลับบ้าน: ไปหน้าการเงิน ดึงรายการที่ยังไม่เรียกเก็บเข้าใบให้ (กลับมากด D/C ต่อได้) */
  const billDc = () => { if (!dc) return; billHandoff.set(ids[dc.i], true); setDc(null); go("billing"); };
  const shown = rows.map((r, i) => ({ r, i })).filter(({ r }) => filter.startsWith("ทั้งหมด") || r[5] === filter);
  /** ส่งออกทะเบียนสัญญาตามแท็บที่เลือก (ผู้จัดการขึ้นไป) · มีเลขบัตรประชาชนและที่อยู่ จึงบันทึกในประวัติการใช้งานทุกครั้ง */
  const boss = user?.role === "Branch Admin" || user?.role === "Global Admin";
  const exportContracts = () => {
    const t = (v?: string) => (v && v !== "-" ? v : "");
    // ใส่ขีดคั่นเลขบัตร/เบอร์โทร ให้ Excel อ่านเป็นข้อความ (ไม่ตัดเลข 0 นำหน้า ไม่แปลงเป็น 1.05E+12)
    const id = (v?: string) => { const d = String(v ?? "").replace(/\D/g, ""); return d.length === 13 ? `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}` : t(v); };
    const tel = (v?: string) => { const d = String(v ?? "").replace(/\D/g, ""); return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d.length === 9 ? `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}` : t(v); };
    const cols = ["เลขที่สัญญา", "สาขา", "สถานะ", "ผู้รับบริการ", "อายุ", "เลขบัตรประชาชนผู้รับบริการ", "ห้อง", "วันเริ่มสัญญา", "วันสิ้นสุดสัญญา", "โปรแกรม",
      "ค่าห้อง (ก่อน VAT)", "VAT ค่าห้อง (%)", "ค่าบริการต่อเดือน (รวม VAT)", "บริการเพิ่มเติม", "ชำระล่วงหน้า (เดือน)", "ชำระล่วงหน้า (บาท)", "มัดจำห้องที่รับไว้แล้ว", "เงินประกัน",
      "ผู้ว่าจ้าง", "ความเกี่ยวข้อง", "เลขบัตรประชาชนผู้ว่าจ้าง", "โทรศัพท์", "ที่อยู่ผู้ว่าจ้าง", "โรงพยาบาลตามสิทธิ์", "โรงพยาบาลสำรอง", "แพ้ยา", "แพ้อาหาร", "ยาที่ใช้ประจำ", "หมายเหตุ"];
    const data = shown.map(({ r }) => [r[0], r[1], r[5], r[2], t(r[13]), id(r[12]), t(r[6]), t(r[7]), t(r[22]), t(r[21]),
      t(r[4]), String(contractVat(r)), money(contractMonthTotal(r)), contractLines(r).map((x) => `${x.desc}${x.price ? ` ${money(svcNet(x))}` : ""}`).join(" | "),
      t(r[18]) ? String(prepaidMonths(r)) : "", t(r[18]), t(r[27]), t(r[19]),
      r[3], t(r[11]), id(r[8]), tel(r[9]), t(r[10]), t(r[24]), t(r[29]), t(r[25]), t(r[26]), t(r[28]), t(r[20])]);
    downloadCsv(`ทะเบียนสัญญา-${filter}-${todayIso()}`, cols, data);
    fetch("/api/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ what: "contracts", count: data.length }) }).catch(() => {});
    toast(`ส่งออกทะเบียนสัญญาแล้ว ${data.length} สัญญา · ไฟล์มีข้อมูลส่วนบุคคล เก็บให้ปลอดภัย`);
  };
  return (
    <>
      <PageHeader
        title="สัญญาบริการ"
        actions={<>
          <button className="btn-primary" onClick={() => setCreating(true)}><Icon name="plus" className="h-4 w-4" /> เปิดสัญญาใหม่</button>
          {admin && <button className="btn-soft" onClick={() => setTermsDlg(terms)}><Icon name="doc" className="h-4 w-4" /> เงื่อนไขเพิ่มเติมในสัญญา</button>}
          {boss && <button className="btn-soft" disabled={!shown.length} onClick={exportContracts}><Icon name="download" className="h-4 w-4" /> ส่งออก CSV</button>}
          <button className="btn-soft" onClick={() => setSample(true)}><Icon name="print" className="h-4 w-4" /> ตัวอย่าง สบส. (แบบฟอร์มเปล่า)</button>
        </>}
      />
      <MetricGrid items={[{label:"สัญญาทั้งหมด",value:rows.length,unit:"สัญญา",accent:true,icon:"doc"},{label:"ใช้งานอยู่",value:rows.filter(r=>r[5]==="ใช้งานอยู่").length,unit:"สัญญา",icon:"check"},{label:"รอชำระมัดจำ",value:rows.filter(r=>r[5]==="รอชำระเงินมัดจำ").length,unit:"สัญญา",icon:"receipt"},{label:"สิ้นสุดสัญญา",value:rows.filter(r=>r[5]==="สิ้นสุดสัญญา").length,unit:"สัญญา",icon:"files",note:rows.some(r=>r[5]===CANCELLED)?`ยกเลิก ${rows.filter(r=>r[5]===CANCELLED).length} สัญญา`:undefined}]} /><Section title="ทะเบียนสัญญาบริการ" actions={<Tabs tabs={["ใช้งานอยู่", "รอชำระเงินมัดจำ", "สิ้นสุดสัญญา", CANCELLED, "ทั้งหมด"]} value={filter} onChange={setFilter} />}>
        <DataTable
          columns={CONTRACT_COLS}
          rows={shown.map(({ r }) => [r[0] || "กำลังออกเลข…", r[1], r[2], r[6] || NO_ROOM, r[3], contractMonthTotal(r) ? money(contractMonthTotal(r)) : "-", r[5]])}
          actions={[
            { label: "รายละเอียด", onClick: (k) => setDlg({ mode: "view", i: shown[k].i }) },
            { label: "พิมพ์สัญญา", onClick: (k) => setDoc({ kind: "contract", i: shown[k].i }) },
            { label: "ออกใบแจ้งหนี้", hidden: (k) => !can(user, "billing") || ended(shown[k].r), onClick: (k) => billContract(shown[k].i) },
            { label: "แก้ไข", more: true, onClick: (k) => setDlg({ mode: "edit", i: shown[k].i }) },
            { label: "รูปบัตร", more: true, onClick: (k) => openCards(shown[k].i) },
            { label: "ต่อสัญญา", more: true, hidden: (k) => ended(shown[k].r), onClick: (k) => setRenew(shown[k].i) },
            { label: "D/C กลับบ้าน", more: true, hidden: (k) => ended(shown[k].r), onClick: (k) => [CANCELLED, "สิ้นสุดสัญญา"].includes(shown[k].r[5]) ? toast("ไม่สามารถ D/C ได้ สัญญานี้สิ้นสุดหรือถูกยกเลิกแล้ว") : setDc({ i: shown[k].i, date: todayIso(), reason: DC_REASONS[0] }) },
            { label: "ยกเลิกสัญญา", danger: true, more: true, hidden: (k) => shown[k].r[5] === CANCELLED, onClick: (k) => cancel(shown[k].i) },
            ...(can(user, "contracts.delete") ? [{ label: "ลบ", danger: true, more: true, onClick: (k: number) => confirm({ title: "ลบสัญญา", message: `ต้องการลบสัญญา ${shown[k].r[0]} (${shown[k].r[2]}) ออกจากระบบใช่หรือไม่ ลบแล้วกู้คืนไม่ได้ (ดูย้อนหลังได้ที่ประวัติการใช้งาน) ถ้าแค่ไม่ใช้สัญญานี้แล้ว แนะนำให้กด "ยกเลิกสัญญา" แทน`, danger: true, okLabel: "ลบ", onOk: () => { const c = shown[k].r; remove(shown[k].i); toast(`ลบสัญญาแล้ว · ${c[0] || ""} ${c[2]}`.trim()); } }) }] : []),
          ]}
        />
      </Section>
      <ContractView r={dlg?.mode === "view" ? rows[dlg.i] : null} onClose={() => setDlg(null)}
        onEdit={() => dlg && setDlg({ mode: "edit", i: dlg.i })}
        onPrint={() => { if (dlg) { setDoc({ kind: "contract", i: dlg.i }); setDlg(null); } }}
        onBill={dlg && can(user, "billing") && !ended(rows[dlg.i]) ? () => { const i = dlg.i; setDlg(null); billContract(i); } : undefined} />
      <FormDialog
        open={dlg?.mode === "edit"} mode="edit" title="แก้ไขสัญญา"
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
          <p className="text-xs leading-6 text-gold-500 md:col-span-2">ข้อมูลส่วนบุคคล: การเปิดดูและเปลี่ยนรูปบันทึกไว้ในประวัติการใช้งานทุกครั้ง</p>
        </div>)}
      </Modal>
      <Modal open={!!dc} title="D/C กลับบ้าน" onClose={() => setDc(null)}
        footer={<><button className="btn-soft" onClick={() => setDc(null)}>ยกเลิก</button><button className="btn-primary" onClick={discharge}>ยืนยัน D/C และพิมพ์ใบจำหน่าย</button></>}>
        {dc && dcRow && <div className="space-y-4">
          <p className="rounded-xl bg-cream-50 px-4 py-3 text-sm text-gold-700">{dcRow[2]} · สัญญา {dcRow[0]} · ห้อง {dcRow[6] || "-"} · สาขา{dcRow[1]}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="วันที่ D/C"><input type="date" value={dc.date} onChange={(e) => setDc({ ...dc, date: e.target.value })} /></Field>
            <Field label="เหตุผล"><select value={dc.reason} onChange={(e) => setDc({ ...dc, reason: e.target.value })}>{DC_REASONS.map((x) => <option key={x}>{x}</option>)}</select></Field>
          </div>
          {unbilledN > 0 && unbilled && <div role="alert" className="room-warn">
            <p>ยังมีรายการที่ยังไม่ได้ออกใบแจ้งหนี้ {unbilledN} รายการ{unbilled.sum > 0 ? ` · ประมาณ ${money(unbilled.sum)} บาท` : ""}</p>
            <p className="mt-1 text-xs">{[unbilled.courses ? `คอร์สกายภาพ ${unbilled.courses}` : "", unbilled.meds ? `ยา ${unbilled.meds}` : "", unbilled.supplies ? `เวชภัณฑ์ ${unbilled.supplies}` : "", unbilled.sessions ? `กายภาพรายครั้ง ${unbilled.sessions} (ยังไม่มีราคา)` : ""].filter(Boolean).join(" · ")}</p>
            <button type="button" className="btn-soft mt-2 !py-1.5" onClick={billDc}>ออกใบสรุปค่าใช้จ่ายก่อนกลับบ้าน</button>
          </div>}
          {dcMoney && (dcMoney.depositPaid > 0 || Number(String(dcRow[19] ?? "").replace(/,/g, "")) > 0) && <div className="rounded-xl border border-cream-300 bg-cream-50 px-4 py-3 text-sm text-gold-700">
            <p className="font-medium text-gold-800">คืนเงินประกัน</p>
            <p className="mt-1">รับไว้ {money(dcMoney.depositPaid)}{!dcMoney.depositPaid ? ` (ตามสัญญา ${money(Number(String(dcRow[19]).replace(/,/g, "")) || 0)} ยังไม่ได้รับ)` : ""} − ค้างชำระ {money(dcMoney.owing)}{dcMoney.unbilled ? ` − ยังไม่เรียกเก็บ ${money(dcMoney.unbilled)}` : ""}
              {" = "}<b className="text-gold-900">{dcRefund(dcMoney) >= 0 ? `คืนสุทธิ ${money(dcRefund(dcMoney))}` : `ต้องชำระเพิ่ม ${money(-dcRefund(dcMoney))}`} บาท</b></p>
            <p className="mt-1 text-xs text-gold-500">ใบจำหน่ายจะพิมพ์ยอดนี้ให้ญาติเซ็นรับทราบ · ออกใบสรุปค่าใช้จ่ายก่อน ยอดคืนจะถูกต้องที่สุด</p>
          </div>}
          {owing.length > 0 && <p role="alert" className="room-warn">ยังมียอดค้างชำระ {money(owing.reduce((n, x) => n + balanceOf(x), 0))} บาท ({owing.length} ใบ) เรียกเก็บที่เมนูการเงินก่อนหรือหลัง D/C ได้</p>}
          <p className="text-xs text-gold-500">ระบบจะเปลี่ยนสัญญาเป็นสิ้นสุด เปลี่ยนผู้รับบริการเป็นย้ายออก คืนห้องให้ว่าง แล้วเปิดใบจำหน่ายให้พิมพ์</p>
        </div>}
      </Modal>
      <PrintModal open={!!doc} title={doc?.kind === "contract" ? "สัญญาจ้างดูแลผู้สูงอายุ หรือผู้มีภาวะพึ่งพิง" : doc?.kind === "renew" ? "บันทึกต่อท้ายสัญญา" : "ใบจำหน่ายผู้รับบริการ (D/C)"} onClose={() => setDoc(null)}
        extra={doc?.kind === "contract" ? <button className="btn-soft" onClick={() => setDoc({ ...doc, copy: !doc.copy })}>{doc.copy ? "เปลี่ยนเป็นต้นฉบับ" : "เปลี่ยนเป็นสำเนา"}</button> : undefined}>
        {doc?.kind === "contract" && rows[doc.i] && <ContractDoc r={rows[doc.i]} hn={resOf(rows[doc.i])?.row[6]} bed={resOf(rows[doc.i])?.row[7]} chronic={resOf(rows[doc.i])?.row[4]} branch={branchInfo(rows[doc.i][1])} terms={terms} by={user?.name} copy={doc.copy} />}
        {doc?.kind === "renew" && <RenewDoc before={doc.before} after={doc.after} hn={resOf(doc.after)?.row[6]} branch={branchInfo(doc.after[1])} by={user?.name} />}
        {doc?.kind === "dc" && <DischargeDoc d={doc.d} branch={branchInfo(doc.branch)} by={user?.name} />}
      </PrintModal>
      <Modal open={termsDlg !== null} wide title="เงื่อนไขอื่น ๆ เพิ่มเติม (ข้อ 5.4 ในสัญญา)" onClose={() => setTermsDlg(null)}
        footer={<><button className="btn-soft" onClick={() => setTermsDlg(null)}>ยกเลิก</button><button className="btn-primary" onClick={saveTerms}>บันทึกเงื่อนไขเพิ่มเติม</button></>}>
        <p className="form-intro">ข้อความหลักของสัญญา (ระเบียบข้อ 1–5 หนังสือยินยอม มาตรการเข้าเยี่ยม) ใช้ตามแบบฟอร์มของ KIN · ช่องนี้สำหรับเงื่อนไขที่เพิ่มเอง พิมพ์บรรทัดละ 1 ข้อ ขึ้นในข้อ 5.4 ของสัญญาทุกฉบับ · ว่าง = เว้นเส้นให้เขียนด้วยมือ</p>
        <textarea rows={12} value={termsDlg ?? ""} onChange={(e) => setTermsDlg(e.target.value)} aria-label="ข้อตกลงในสัญญา" />
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
  // ตัวกรองสถานะแบบปุ่มพร้อมจำนวน (สีเดียวกับป้ายสถานะ) · "ยังไม่มีห้อง" นับเฉพาะคนที่ยังพักอยู่
  const STATUS_F: { k: string; t: string; c: string }[] = [
    { k: "", t: "ทั้งหมด", c: "is-all" }, { k: "เข้าอยู่", t: "เข้าอยู่", c: "is-done" }, { k: "มัดจำ", t: "มัดจำ (จองห้อง)", c: "is-todo" },
    { k: "แอดมิท", t: "แอดมิท รพ.", c: "is-review" }, { k: "ย้ายออก", t: "ย้ายออก", c: "is-todo" },
  ];
  const noRoomOf = (r: string[]) => (!r[2] || r[2] === "-") && staying(r[5] ?? "");
  const byRoom = rows.map((r, i) => ({ r, i })).filter(({ r }) => !roomF || (roomF === NO_ROOM_F ? !r[2] || r[2] === "-" : roomName(r[2], r[3]) === roomF));
  const statusCount = (k: string) => byRoom.filter(({ r }) => !k || r[5].startsWith(k)).length;
  const shown = byRoom.filter(({ r }) => !statusF || r[5].startsWith(statusF));
  const noRoomN = rows.filter(noRoomOf).length;
  // ประวัติแพ้ยา/อาหารจากสัญญาล่าสุด (ป้ายแดงข้างชื่อ)
  const [allergy, setAllergy] = useState<Record<string, string>>({});
  useEffect(() => {
    fetch("/api/care?op=allergies", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { items: [] })).then((d: { items: { name: string; branch: string; drug: string | null; food: string | null }[] }) => {
      const m: Record<string, string> = {};
      for (const x of d.items ?? []) {
        const t = [!isNoAllergy(x.drug ?? "") && x.drug ? `แพ้ยา: ${x.drug}` : "", !isNoAllergy(x.food ?? "") && x.food ? `แพ้อาหาร: ${x.food}` : ""].filter(Boolean).join(" · ");
        if (t) m[`${x.name}|${x.branch}`] = t;
      }
      setAllergy(m);
    }).catch(() => {});
  }, []);
  const cols = ["HN", "ชื่อ-นามสกุล", "อายุ", "ห้อง/เตียง", ...(multiBranch ? ["สาขา"] : []), "โรคประจำตัว", "สถานะ"];
  return (
    <>
      <PageHeader
        title="ข้อมูลผู้รับบริการ (Residents)"
        actions={<><button className="btn-soft" onClick={() => setHub(true)}><Icon name="chat" className="h-4 w-4" /> ข่าวและลิงก์ญาติ</button><button className="btn-soft" onClick={() => setSample(true)}><Icon name="print" className="h-4 w-4" /> ตัวอย่าง สบส. (แบบฟอร์มเปล่า)</button></>}
      />
      <MetricGrid items={[{label:"ผู้รับบริการทั้งหมด",value:rows.length,unit:"คน",icon:"user",accent:true},{label:"เข้าอยู่ในศูนย์",value:rows.filter(r=>r[5].startsWith("เข้าอยู่")).length,unit:"คน",icon:"heart"},{label:"รับการรักษาที่โรงพยาบาล",value:rows.filter(r=>r[5].startsWith("แอดมิท")).length,unit:"คน",icon:"building"},{label:"ย้ายออกแล้ว",value:rows.filter(r=>r[5].startsWith("ย้ายออก")).length,unit:"คน",icon:"doc"}]} /><Section title="ทะเบียนผู้รับบริการ" actions={<div className="flex flex-wrap gap-2">
          <div className="min-w-40"><Select aria-label="กรองตามห้อง" options={[...roomOpts, NO_ROOM_F]} placeholder="ทุกห้อง" value={roomF} onChange={setRoomF} /></div>
          {(roomF || statusF) && <button type="button" className="row-action" onClick={() => { setRoomF(""); setStatusF(""); }}>ล้างตัวกรอง</button>}
        </div>}>
        <div className="stat-filter" role="radiogroup" aria-label="กรองตามสถานะ">
          {STATUS_F.map((f) => (
            <button key={f.t} type="button" role="radio" aria-checked={statusF === f.k} className={`${f.c} ${statusF === f.k ? "is-on" : ""}`} onClick={() => setStatusF(f.k)}>
              {f.k && <i aria-hidden />}{f.t} <b>{statusCount(f.k)}</b>
            </button>
          ))}
          {noRoomN > 0 && <button type="button" aria-pressed={roomF === NO_ROOM_F} className={`is-review ${roomF === NO_ROOM_F ? "is-on" : ""}`} onClick={() => setRoomF(roomF === NO_ROOM_F ? "" : NO_ROOM_F)}><i aria-hidden />ยังไม่มีห้อง <b>{noRoomN}</b></button>}
        </div>
        <DataTable
          columns={cols}
          rows={shown.map(({ r }) => [r[6] || "-", r[0], r[1], r[2] && r[2] !== "-" ? `${r[2]}${r[7] ? ` · เตียง ${r[7]}` : ""}` : "-", ...(multiBranch ? [r[3]] : []), r[4], r[5]])}
          render={(k, col, value) => {
            const r = shown[k]?.r;
            if (!r) return undefined;
            if (col === 1) { const a = allergy[`${r[0]}|${r[3]}`]; return a ? <>{value} <span className="v-check" title={a}>{/แพ้ยา/.test(a) ? "แพ้ยา" : "แพ้อาหาร"}</span></> : undefined; }
            if (col === 3 && noRoomOf(r)) return <span className="status-badge status-warning">รอจัดห้อง</span>;
            return undefined;
          }}
          empty={roomF || statusF ? "ไม่พบผู้รับบริการตามตัวกรอง" : undefined}
          actions={[
            { label: "ประวัติ", onClick: (k) => setProfile(ids[shown[k].i]) },
            { label: "ลิงก์ครอบครัว", onClick: (k) => setFamily(ids[shown[k].i]) },
            { label: "แก้ไข", onClick: (k) => setDlg({ mode: "edit", i: shown[k].i }) },
            { label: "ลบ", danger: true, onClick: (k) => confirm({ title: "ลบข้อมูลผู้รับบริการ", message: `ต้องการลบ ${shown[k].r[0]} ใช่หรือไม่`, danger: true, okLabel: "ลบ", onOk: () => { const n = shown[k].r[0]; remove(shown[k].i); toast(`ลบผู้รับบริการแล้ว · ${n}`); } }) },
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
          // ห้องที่สร้างไว้ในเมนูห้องพักและเตียง: เต็มหรือปิดปรับปรุงย้ายเข้าไม่ได้
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

export function TasksTable() {
  const branchNames = useBranchNames();
  const iso = (d: number) => new Date(Date.now() + 7 * 3600e3 - d * 864e5).toISOString().slice(0, 10);
  const [branch, setBranch] = useState("");
  const [from, setFrom] = useState(iso(6));
  const [to, setTo] = useState(iso(0));
  const [rows, setRows] = useState<string[][] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setRows(null);
    const q = new URLSearchParams({ op: "tasklog", from, to, ...(branch ? { branch } : {}) });
    fetch(`/api/ops?${q}`, { cache: "no-store" }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error);
      setRows((j.rows as Record<string, string | number | null>[]).map((x) => [docDate(String(x.date)), String(x.branch ?? "-"), String(x.resident ?? "-"), String(x.shift ?? "-"), String(x.task ?? "-"), String(x.who ?? "-"), String(x.time ?? "-"), String(x.sent ?? "-"), String(x.status ?? "-"), x.stars ? `${x.stars} ดาว` : "-"]));
      setErr(""); }).catch((e) => { setErr((e as Error).message); setRows([]); });
  }, [from, to, branch]);
  const cols = ["วันที่", "สาขา", "ผู้รับบริการ", "กะ", "งาน", "ผู้ทำ / ผู้รับผิดชอบ", "เวลางาน", "ส่งเมื่อ", "สถานะ", "ดาวผู้ตรวจ"];
  return (
    <>
      <PageHeader title="ประวัติงานดูแล" sub="งานทุกงานย้อนหลังตามช่วงวันที่"
        actions={<>
          {branchNames.length > 1 && <div className="min-w-44"><Select options={branchNames} placeholder="รวมทุกสาขา" value={branch} onChange={setBranch} /></div>}
          <button className="btn-primary" disabled={!rows?.length} onClick={() => downloadCsv(`ประวัติงานดูแล-${from}-${to}`, cols, rows ?? [])}><Icon name="download" className="h-4 w-4" /> โหลด CSV</button>
        </>} />
      <Section>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <input type="date" aria-label="ตั้งแต่วันที่" className="!w-auto" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          <span className="text-sm text-gold-600">ถึง</span>
          <input type="date" aria-label="ถึงวันที่" className="!w-auto" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
          <span className="text-xs text-gold-500">ดูย้อนหลังได้ครั้งละไม่เกิน 3 เดือน</span>
        </div>
        {err && <p role="alert" className="mb-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</p>}
        <DataTable columns={cols} rows={rows ?? []} badgeCols={[8]} empty={rows === null ? "กำลังโหลด…" : "ไม่มีงานในช่วงวันที่นี้"} />
      </Section>
    </>
  );
}



