"use client";
import Reserve from "@/components/Reserve";
import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import CsvIcon from "@/components/CsvIcon";
import { useBranchNames, withBranches } from "@/lib/branches";
import Link from "next/link";
import Icon from "../Icon";
import { APPOINTMENTS, CONTRACTS, DAILY_LIST, RESIDENTS, BRANCH_NAMES } from "@/lib/mock";
import { downloadCsv, newId, refreshData, useCrud, useRecords } from "@/lib/store";
import { balanceOf, baseOfIncl, BILL_KINDS, BillItem, contractMeta, ContractLine, isOldRoomPricing, splitOldRoom, splitOldRoomLines, installmentsOf, splitInstallments, parseItems, lineNet, PAID, contractVat, DEFAULT_VAT, DRAFT, docDate, inclOf, Invoice, invoiceBranch, isOpen, lineAmount, money, svcNet, todayIso, totals, UNPAID, vatOf, VOID } from "@/lib/billing";
import { cycleDue, nextCycle } from "@/lib/servicePeriod";
import { bookingInvoiceOf, bookingPaid, contractMonthTotal, contractStartLines, contractStartNote, isStartInvoice, prepaidMonths, useBranchInfo } from "./Billing";
import ContractView from "./ContractView";
import { contractsCsv } from "../billing/contractsCsv";
import ContractSummary from "../care/ContractSummary";
import { ContractDoc, contractLines, contractRoomName, DcData, dcRefund, DepositDoc, DischargeDoc, PrintModal, RenewDoc } from "../print/Docs";
import { ServiceLine, ServiceLines } from "../ServicePicker";
import { AddressFinder, ChipChoice, SuggestText, TagInput } from "../ContractInputs";
import { addMonthsIso, ALLERGY_DRUGS, COMMON_MEDS, FOOD_ALLERGENS, HEALTH_RIGHTS, HOSP_LATER, isNoAllergy, NO_ALLERGY, RELATIONS } from "@/lib/medicalLists";
import { PROGRAMS } from "@/lib/contractText";
import { roomByPrice, roomShareOf, rooms as priceRooms } from "@/lib/priceList";
import { usePriceList } from "@/lib/usePrices";
import { clinic, fetchDocSettings } from "@/lib/clinic";
import { fetchProfile } from "@/lib/care";
import { billHandoff, contractHandoff, handoff, invoiceHandoff, QuoteHandoff } from "@/lib/handoff";
import { buildTodos, HomeData, runTodo, SAFETY_KEYS, TODO_ACT, TODO_AREAS, TodoItem } from "../dash/Todo";
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
import { Avatar } from "../Avatar";
import { BlankForm, DataTable, Field, FieldDef, FormDialog, MenuButton, Modal, MetricGrid, PageHeader, PrintSignatures, Section, Select, StatFilter, Tabs } from "../ui";

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
  return <>
    <PageHeader title={`สวัสดี ${user?.name??""}`.trim()} sub={<>{today}{user?.branch&&user.role!=="Global Admin"?` · สาขา${user.branch}`:""}</>}
      actions={<><button className="btn-soft" onClick={()=>go("appointments")}><Icon name="calendar" className="h-4 w-4" /> ดูตารางนัดหมาย</button>{admitTo&&<button className="btn-primary" onClick={()=>go(admitTo)}><Icon name="plus" className="h-4 w-4" /> รับผู้รับบริการใหม่</button>}</>} />
    <TodayCards />
    <div className="overview-columns mt-8"><div className="space-y-4"><h2 className="text-[17px] font-medium text-gold-800">ภาพรวมศูนย์</h2><Occupancy /><MetricGrid items={[{label:"ผู้รับบริการทั้งหมด",value:residents.length,unit:"คน",note:"ข้อมูลผู้รับบริการในระบบ",icon:"user",accent:true},{label:"กำลังรับการดูแล",value:active,unit:"คน",note:"สถานะเข้าอยู่ในศูนย์",icon:"heart"},{label:"สัญญาที่ใช้งาน",value:contracts.filter(r=>r[5]==="ใช้งานอยู่").length,unit:"สัญญา",note:"ทะเบียนสัญญาบริการ",icon:"doc"},{label:"นัดหมายที่กำลังจะมาถึง",value:upcoming.length,unit:"นัด",note:"จากตารางนัดหมาย",icon:"calendar"}]} /></div>
      <aside className="overview-sidebar"><section className="card side-section"><h2 className="section-mini-title">นัดหมายที่กำลังมาถึง<Icon name="calendar" className="h-4 w-4 text-gold-400" /></h2>{upcoming.length?upcoming.slice(0,3).map(({r:a},i)=>{const d=apptIso(a[0]);return <div key={i} className="appointment-mini"><div className="appointment-date">{Number(d.slice(8,10))}<small>{TH_MONTHS[Number(d.slice(5,7))-1]}</small></div><div><strong>{a[2]}</strong><p>{(a[1]??"").slice(0,5)} น. · {a[3]}</p></div></div>;}):<p className="py-3 text-sm text-gold-500">ยังไม่มีนัดหมายที่กำลังจะมาถึง</p>}<button className="side-link" onClick={()=>go("appointments")}>ดูนัดหมายทั้งหมด<Icon name="arrow" className="h-4 w-4" /></button></section>{can(user,"app.staff")&&<Link href="/staff" className="card side-section mt-4 flex items-center gap-4"><span className="grid h-10 w-10 place-items-center rounded-xl bg-cream-100 text-gold-500"><Icon name="phone" /></span><span><strong className="block text-sm font-medium text-gold-700">พื้นที่ของทีมดูแล</strong><span className="text-xs text-gold-500">เปิด KinApp →</span></span></Link>}</aside></div>
    <details className="card mt-8 p-5 [&_summary::-webkit-details-marker]:hidden"><summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3"><span><strong className="block text-[17px] font-medium text-gold-800">เส้นทางการดูแล (คู่มือขั้นตอน)</strong><span className="text-sm text-gold-600">ขั้นตอนงานประจำวัน และการรับผู้รับบริการใหม่ · กดเพื่อเปิดดู</span></span><span className="btn-soft !py-2">เปิด / ปิดขั้นตอน</span></summary>
      <div className="mt-5"><div className="mb-4"><Tabs tabs={["งานประจำวัน","รับผู้รับบริการใหม่"]} value={routine} onChange={setRoutine} /></div><Steps title={routine==="งานประจำวัน"?"เริ่มวันอย่างเป็นระบบ":"ต้อนรับสมาชิกใหม่อย่างพร้อมดูแล"} steps={routine==="งานประจำวัน"?DAILY:ADMISSION} /></div></details>
  </>;
}

/* ---------- สิ่งที่ต้องทำวันนี้ (หน้าแรก) ---------- */
/** การ์ดเรื่องที่ต้องจัดการวันนี้ · ชุดเดียวกับแถบ "ต้องจัดการ" ในภาพรวมและรายงาน (components/dash/Todo.tsx) · ดึงใหม่ทุก 1 นาทีและตอนกลับมาที่หน้าต่าง
 *  หัว = เหลือกี่เรื่อง · ด่วนกี่เรื่อง · แถบเคลียร์แล้ว · ทำก่อน แบ่ง 2 ระดับ (ความปลอดภัยผู้รับบริการ → ต้องทำวันนี้)
 *  กล่องด้านอื่นกว้างตามจำนวนเรื่อง (ไม่มีช่องว่างเปล่า) · เรื่องที่เรียบร้อยย่อเป็นบรรทัดเดียว กดดูรายการ */
function TodayCards() {
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
  const [more, setMore] = useState<string | null>(null);
  // ระหว่างโหลด: จองพื้นที่เท่าครั้งก่อน (ภาพรวมศูนย์ด้านล่างไม่กระโดด)
  if (!d) return <Reserve id="today" loading fallback={560} label="กำลังโหลดสิ่งที่ต้องทำวันนี้…">{null}</Reserve>;
  if (!cards.length) return null;
  const open = cards.filter((c) => c.n > 0);
  const urgent = open.filter((c) => c.urgent);
  const safety = urgent.filter((c) => SAFETY_KEYS.includes(c.key)), today = urgent.filter((c) => !SAFETY_KEYS.includes(c.key));
  const areas = TODO_AREAS.map((a) => ({ ...a, all: cards.filter((c) => a.keys.includes(c.key)) }))
    .filter((a) => a.all.length)
    .map((a) => ({ ...a, open: a.all.filter((c) => c.n > 0 && !c.urgent), urgentHere: a.all.filter((c) => c.n > 0 && c.urgent).length }));
  const done = cards.filter((c) => !c.n);
  const total = cards.length, cleared = done.length, pct = Math.round((cleared / total) * 100);
  const row = (c: TodoItem) => {
    const on = more === c.key, go2 = !!(c.view || c.href);
    return (
      <li key={c.key} className={on ? "is-open" : ""}>
        <div className="td-row">
          <button type="button" className="td-main" aria-expanded={on} onClick={() => setMore(on ? null : c.key)}>
            <span className={`td-n ${c.urgent ? "is-bad" : c.warn ? "is-warn" : ""}`}>{c.n}<small>{c.unit}</small></span>
            <span className="td-t">{c.title}{c.brief && <small className={c.hot ? "is-hot" : ""}>{c.brief}</small>}</span>
          </button>
          {go2 && <button type="button" className="td-go" onClick={() => runTodo(c, go)}><span>{c.key === "deposit" && c.cta === "ออกใบแจ้งหนี้" ? "ออกใบ" : TODO_ACT[c.key] ?? c.cta}</span><Icon name="chevron" className="h-4 w-4 -rotate-90" /></button>}
        </div>
        {on && <p className="td-more">{c.detail}</p>}
      </li>
    );
  };
  const tier = (name: string, list: TodoItem[]) => list.length > 0 && (
    <div className="td-tier"><h4>{name}<span>{list.length}</span></h4><ul className={`td-list ${list.length > 1 ? "is-2col" : ""}`}>{list.map(row)}</ul></div>
  );
  const shown = areas.filter((a) => a.open.length || !a.urgentHere);
  return (
    <Reserve id="today" loading={false} fallback={560} label=""><section aria-labelledby="todo-h" className="td">
      <div className="td-head">
        <h2 id="todo-h">สิ่งที่ต้องทำวันนี้</h2>
        <p className="td-sum">{open.length ? <>เหลือ <b>{open.length}</b> เรื่อง</> : <b className="is-ok">เคลียร์ครบทุกเรื่องแล้ว</b>}
          {urgent.length > 0 && <em>ด่วน {urgent.length}</em>}</p>
        <div className="td-bar" role="img" aria-label={`เคลียร์แล้ว ${cleared} จาก ${total} เรื่อง`}>
          <span className="td-track"><i style={{ width: `${pct}%` }} /></span>
          <small>เคลียร์แล้ว {cleared} จาก {total} เรื่อง</small>
        </div>
      </div>
      {urgent.length > 0 && <section className="td-box is-urgent" aria-label="ทำก่อน">
        <h3><i className="td-dot is-bad" />ทำก่อน <span>{urgent.length}</span></h3>
        {tier("ความปลอดภัยผู้รับบริการ", safety)}
        {tier("ต้องทำวันนี้", today)}
      </section>}
      {shown.length > 0 && <div className="td-cols">{shown.map((a) => (
        <section key={a.name} className="td-box" aria-label={a.name} style={{ flex: `${Math.max(1, a.open.length)} 1 300px` }}>
          <h3><i className={`td-dot ${a.open.length ? "is-warn" : "is-good"}`} />{a.name} <span>{a.open.length}</span></h3>
          {a.open.length ? <ul className="td-list">{a.open.map(row)}</ul> : <p className="td-clear">✓ ไม่มีงานค้าง</p>}
          {a.open.length > 0 && a.urgentHere > 0 && <p className="td-clear is-muted">↑ อีก {a.urgentHere} เรื่องของด้านนี้อยู่ในกล่องทำก่อน</p>}
        </section>
      ))}</div>}
      {done.length > 0 && <details className="td-done">
        <summary><b>✓ เรียบร้อย {done.length} เรื่อง</b><span>กดดูรายการ</span></summary>
        <ul>{done.map((c) => <li key={c.key}><b>{c.short}</b> {c.detail}</li>)}</ul>
      </details>}
    </section></Reserve>
  );
}
/* ---------- ระบบสัญญา ---------- */
const CONTRACT_STATUSES = ["ใช้งานอยู่", "รอชำระเงินมัดจำ", "สิ้นสุดสัญญา", "ยกเลิกสัญญา"];
const CANCELLED = "ยกเลิกสัญญา";
/** สัญญาที่ยังผูกกับผู้รับบริการ (ใช้งานอยู่ / รอชำระมัดจำ) */
const LIVE_CONTRACT = CONTRACT_STATUSES.slice(0, 2);
const isLive = (c: string[]) => LIVE_CONTRACT.includes(c[5]);
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
/**
 * ขั้นที่ 4 ของฟอร์ม: ใบแจ้งหนี้ที่ออกให้คนนี้พร้อมการบันทึกสัญญา
 *  unpaid = ค้างชำระ (รับเงินทีหลัง) · pay = รับชำระเต็มจำนวนเลย (เป็นใบเสร็จ) · draft = รอการเงินตรวจยอด · none = ไม่ออกใบ
 */
type BillChoice = { mode: "unpaid" | "pay" | "draft" | "none"; items: BillItem[]; note: string; booking: boolean; pay?: PayNow };
type PayNow = { method: string; slip: string; date: string };
const PAY_METHODS = ["เงินสด", "โอนเงิน", "บัตรเครดิต"];
/** ยอดมัดจำค่าห้องที่ใช้บ่อย (ตามเอกสารการมัดจำ) */
const BOOKING_AMOUNTS = [3000, 5000];
const WAIT_DEPOSIT = "รอชำระเงินมัดจำ";
/** สัญญาที่จองห้องด้วยมัดจำค่าห้อง ยังไม่ได้กรอกค่าบริการ (รอกด "เปิดสัญญา" ให้ครบ) */
const isBookingRow = (c: string[]) => c[5] === WAIT_DEPOSIT && !contractMonthTotal(c);
/** วันที่ในสัญญา (วว/ดด/ปปปป พ.ศ. หรือ YYYY-MM-DD) → YYYY-MM-DD · ไม่มี = "" */
const isoDate = (v?: string) => {
  const t = String(v ?? "").trim(), iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/), th = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (iso) return `${Number(iso[1]) > 2400 ? Number(iso[1]) - 543 : iso[1]}-${iso[2]}-${iso[3]}`;
  if (th) return `${Number(th[3]) > 2400 ? Number(th[3]) - 543 : th[3]}-${th[2].padStart(2, "0")}-${th[1].padStart(2, "0")}`;
  return "";
};

/** ปุ่มเล็กในกล่องแจ้งปัญหา */
const CALLOUT_PRIMARY = "btn-primary !min-h-0 !py-2 !text-sm";
const CALLOUT_SOFT = "btn-soft !min-h-0 !py-2 !text-sm";
/** ปัญหาที่ทำให้ไปขั้นถัดไปไม่ได้ · field = aria-label ของช่องที่ต้องแก้ · el = ช่องที่เบราว์เซอร์ตรวจไม่ผ่าน · live = สัญญาเดิมที่ยังใช้งานอยู่ */
type FormProblem = { msg: string; field?: string; el?: HTMLElement; live?: string[] };
/**
 * กล่องแจ้งปัญหาในฟอร์ม (แทน toast ที่หายไปเอง) · แสดงค้างในขั้นนั้นจนกว่าจะแก้
 *  block = ไปต่อไม่ได้ (แดง · role=alert) · warn = เตือนให้ตรวจ (เหลือง · role=status)
 *  focus = ชื่อกล่อง ให้ฟอร์มเลื่อนมาและย้ายโฟกัสมาที่กล่องเมื่อกดถัดไป/บันทึกแล้วไม่ผ่าน
 */
function FormCallout({ tone = "block", title, children, actions, focus }: { tone?: "block" | "warn"; title: ReactNode; children?: ReactNode; actions?: ReactNode; focus?: string }) {
  return (
    <div data-form-callout={focus} tabIndex={-1} role={tone === "block" ? "alert" : "status"} className={`form-callout is-${tone}`}>
      <div className="form-callout-head">
        <Icon name={tone === "block" ? "alert" : "info"} className="h-5 w-5" />
        <div className="min-w-0 flex-1"><b>{title}</b>{children && <div className="form-callout-body">{children}</div>}</div>
      </div>
      {actions && <div className="form-callout-actions">{actions}</div>}
    </div>
  );
}

function ContractForm({ rooms, residents, contracts = [], initial, fromQuote, completing = false, paidDeposit = 0, bookedDeposit = 0, canPay = false, billPreview, onClose, onSave, onRenew, onView }: {
  rooms: string[][]; residents: string[][]; contracts?: string[][]; initial?: string[]; fromQuote?: string; onClose: () => void;
  /** เปิดสัญญาเต็มจากสัญญาที่จองห้องไว้ (initial = สัญญาที่จอง · บันทึกทับแถวเดิม เลขที่สัญญาเดิม) */
  completing?: boolean;
  /** มัดจำห้องที่รับชำระแล้วตอนจอง (หักในใบแรกเข้า) · bookedDeposit = ยอดมัดจำที่จองไว้ */
  paidDeposit?: number; bookedDeposit?: number;
  /** รับชำระในขั้นที่ 4 ได้ (มีสิทธิ์การเงิน) */
  canPay?: boolean;
  /** ใบแรกเข้าของแถวสัญญา r · has = เลขที่ใบแรกเข้าที่ออกไว้แล้ว (ไม่ต้องออกซ้ำ) */
  billPreview: (r: string[]) => { items: BillItem[]; note: string; has: string };
  /** คืนสัญญาเดิมที่ยังใช้งานอยู่ = บันทึกไม่ได้ (สัญญาซ้อน) ฟอร์มแสดงกล่องแจ้งพร้อมปุ่มต่อสัญญา */
  onSave: (r: string[], photos: IdPhotos, bill: BillChoice) => string[] | void;
  /** ปิดฟอร์มแล้วต่อสัญญา / ดูสัญญาเดิม (ใช้เมื่อชื่อนี้มีสัญญาใช้งานอยู่แล้ว) */
  onRenew?: (c: string[]) => void; onView?: (c: string[]) => void;
}) {
  const [photos, setPhotos] = useState<IdPhotos>({ employer: "", resident: "" });
  /** ต่อสัญญา (initial = สัญญาเดิม) · เปิดจากใบเสนอราคา initial เป็นแค่ข้อมูลตั้งต้น ไม่ใช่การต่อสัญญา */
  const renewing = !!initial && fromQuote === undefined && !completing;
  /** ชื่อผู้รับบริการผูกกับทะเบียนแล้ว (ต่อสัญญา / เปิดสัญญาที่จองไว้) แก้ชื่อไม่ได้ */
  const lockNames = renewing || completing;
  /** มัดจำค่าห้อง (จองห้องไว้ก่อน): กรอกแค่สาขา ผู้ว่าจ้าง ผู้รับบริการ เลือกห้อง แล้วออกใบแจ้งหนี้มัดจำ · ข้อมูลอื่นกรอกตอนเปิดสัญญา */
  const [booking, setBooking] = useState(false);
  const [depAmt, setDepAmt] = useState(String(BOOKING_AMOUNTS[0]));
  const hide = booking ? "hidden" : "";
  const iv = (i: number) => (initial?.[i] && initial[i] !== "-" ? initial[i] : "");
  // ช่องที่มีตัวช่วยกรอก (ปุ่มลัด / พิมพ์แล้วขึ้น / ดึงจากสัญญาเดิม)
  const [who, setWho] = useState(iv(2));
  const [boss, setBoss] = useState(iv(3));
  const [relation, setRelation] = useState(iv(11));
  const [addr, setAddr] = useState(iv(10));
  const [start, setStart] = useState(() => (completing && isoDate(initial?.[7])) || todayIso());
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
  // ชำระล่วงหน้าตั้งแต่ 2 เดือน: ส่วนลดค่าห้อง (%) จำนวนเต็ม · แบ่งชำระใบแรกเข้าเป็นงวด (เปิดสัญญาจากที่จองไว้ = ดึงที่ตั้งไว้)
  const [roomPct, setRoomPct] = useState(() => (completing && initial ? String(contractMeta(initial).prepaidPct || "") : ""));
  /** ส่วนลดค่าห้องเป็น % หรือเป็นจำนวนบาท */
  const [offMode, setOffMode] = useState<"pct" | "baht">(() => (completing && initial && contractMeta(initial).prepaidOff ? "baht" : "pct"));
  const [offAmt, setOffAmt] = useState(() => (completing && initial ? String(contractMeta(initial).prepaidOff || "") : ""));
  const [parts, setParts] = useState(() => (completing && initial ? Math.max(1, contractMeta(initial).installments ?? 1) : 1));
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
  const oldRes = !renewing && who.trim() ? latest(2, who.trim().replace(/\s+/g, " ")) : undefined;
  const oldBoss = !renewing && boss.trim() ? latest(3, boss.trim().replace(/\s+/g, " ")) : undefined;
  const PastBox = ({ c, pulled, kind, onPull }: { c?: string[]; pulled: string; kind: "res" | "boss"; onPull: () => void }) => !c ? null
    : pulled === c[0] ? <p role="status" className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">ดึงข้อมูลจากสัญญาเดิม {c[0]} แล้ว{kind === "res" ? " (เลขบัตร อายุ โรงพยาบาล ยาประจำ ประวัติแพ้)" : " (เลขบัตร โทรศัพท์ ที่อยู่ ความเกี่ยวข้อง)"} · ตรวจให้ตรงกับบัตรจริงอีกครั้ง</p>
    : <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <span>ชื่อนี้เคยมีสัญญา <b>{c[0]}</b> · สาขา{c[1]}{kind === "res" ? ` · ผู้ว่าจ้าง ${c[3]}` : ` · ผู้รับบริการ ${c[2]}`} · ถ้าเป็นคนเดิม กดดึงข้อมูลได้ · ถ้าเป็นคนละคนที่ชื่อซ้ำ ไม่ต้องกด</span>
        <button type="button" className="btn-soft !min-h-0 !py-1.5 !text-xs" onClick={onPull}>ดึงข้อมูลจากสัญญาเดิม</button>
      </div>;
  // รายการค่าบริการจากใบราคา (ต่อสัญญา / เปิดจากใบเสนอราคา = ดึงรายการเดิมมาให้)
  const [items, setItems] = useState<ServiceLine[]>(() => (initial ? contractLines(initial).filter((l) => !l.stay && !l.pkg) : []));
  /** ส่วนค่าบริการทางการแพทย์ของราคาห้อง (สัญญาเดิม) */
  const pkg0 = initial ? (contractLines(initial).find((l) => l.pkg) as ContractLine | undefined) : undefined;
  /** ค่าห้องคิด รายวัน / รายสัปดาห์ / รายเดือน · รายวัน-สัปดาห์ = พักระยะสั้น กรอกจำนวนวัน/สัปดาห์ */
  const stay0 = initial ? contractLines(initial).find((l) => l.stay) as ContractLine | undefined : undefined;
  const [stay, setStay] = useState<"วัน" | "สัปดาห์" | "เดือน">(stay0?.stay ?? "เดือน");
  const [stayN, setStayN] = useState(stay0?.n ? String(stay0.n) : "7");
  // ค่าห้องที่กรอก/เลือก = ราคารายเดือนรวม VAT แล้ว (ใบราคา) · สัญญาเก็บค่าห้องก่อน VAT ระบบคำนวณกลับให้ (ไม่บวก VAT ซ้ำ)
  const baseIn = Number(String(initial?.[4] ?? "").replace(/,/g, "")) || 0;
  // ราคาห้องทั้งหมดต่อหน่วย (รวม VAT) = ส่วนค่าห้อง + ค่าบริการทางการแพทย์ · roomPart = ส่วนค่าห้อง (มี VAT) ต่อหน่วย
  const part0 = stay0?.part ?? (baseIn ? inclOf(baseIn, initial ? contractVat(initial) : DEFAULT_VAT) : 0);
  const [fee, setFee] = useState(() => (stay0?.rate ? String(stay0.rate) : baseIn ? String(Math.round((part0 + (pkg0?.price ?? 0)) * 100) / 100) : ""));
  const [roomPart, setRoomPart] = useState(() => (part0 ? String(part0) : ""));
  // ห้องพักในใบราคา (ราคาปัจจุบัน)
  usePriceList();
  const ROOMS = priceRooms();
  /** ราคารายเดือนของห้อง = ราคาโปรโมชันในใบราคา (รวม VAT แล้ว) · ไม่มีโปรโมชันใช้ราคาปกติ */
  const monthOf = (x: { month: number; promo: number }) => x.promo || x.month;
  // ช่องค่าห้อง: ตรงกับราคารายเดือนในใบราคา = เลือกห้องนั้นไว้ (เก็บลำดับห้อง) · ราคาอื่น = กำหนดเอง
  /** ราคาต่อหน่วยของห้องตามที่เลือก รายวัน / รายสัปดาห์ / รายเดือน (รวม VAT) */
  const unitOf = (x: { day: number; week: number; month: number; promo: number }, u: string) => (u === "วัน" ? x.day : u === "สัปดาห์" ? x.week : monthOf(x));
  const pickOf = (f: number) => { if (!f) return ""; const i = ROOMS.findIndex((x) => unitOf(x, stay0?.stay ?? "เดือน") === f); return i < 0 ? "custom" : String(i); };
  const [feePick, setFeePick] = useState(() => pickOf(Number(fee) || 0));
  // ชื่อห้องของค่าห้อง (ใช้ตั้งชื่อบรรทัดค่าห้องในใบแจ้งหนี้และสัญญา) · สัญญาเดิมที่ไม่ได้ตั้งชื่อ = ประเภทห้องจากราคาเดิม
  const [roomName, setRoomName] = useState(() => (initial ? contractRoomName(initial) || roomByPrice(baseIn)?.name || "" : ""));
  // VAT ค่าห้อง (%) บวกเพิ่มในใบแจ้งหนี้ · ต่อสัญญาใช้อัตราเดิม
  const [roomVat, setRoomVat] = useState(() => (initial ? String(contractVat(initial)) : String(DEFAULT_VAT)));
  // ค่าห้องที่กรอก: รวม VAT แล้ว หรือบวก VAT เพิ่ม · VAT คิดเฉพาะค่าห้อง ไม่รวมรายการบริการเพิ่มเติม
  // ติ๊ก "คิด VAT" (ค่าเริ่มต้น) · ไม่ติ๊ก = ค่าห้องไม่มี VAT (เก็บอัตรา 0)
  const [vatOn, setVatOn] = useState(() => (initial ? contractVat(initial) > 0 : true));
  const rateN = vatOn ? Number(roomVat) || 0 : 0;
  /** ค่าห้องที่ต้องจ่ายจริงต่อเดือน (รวม VAT · ที่กรอก) และก่อน VAT (เก็บในสัญญา) */
  /** จำนวนวัน/สัปดาห์ที่พัก (รายเดือน = 1) · ค่าห้องทั้งช่วง = ราคาต่อหน่วย × จำนวน */
  const nStay = stay === "เดือน" ? 1 : Math.max(0, Math.floor(Number(stayN) || 0));
  /** ราคาห้องทั้งช่วง (รวม VAT) · ส่วนค่าห้อง (มี VAT) · ค่าบริการทางการแพทย์ (ส่วนที่เหลือ ไม่มี VAT) · ค่าห้องก่อน VAT */
  const unitPart = Math.min(Number(fee) || 0, roomPart === "" ? roomShareOf(Number(fee) || 0) : Number(roomPart) || 0);
  const roomPay = Math.round((Number(fee) || 0) * nStay * 100) / 100, partPay = Math.round(unitPart * nStay * 100) / 100;
  const medPay = Math.round((roomPay - partPay) * 100) / 100, feeN = baseOfIncl(partPay, rateN);
  const vatAmt = Math.round((partPay - feeN) * 100) / 100;
  // หักมัดจำห้อง: เปิดสัญญาจากที่จองไว้ = ยอดมัดจำที่รับชำระแล้วเท่านั้น
  const [roomDep, setRoomDep] = useState(() => completing ? (paidDeposit ? String(paidDeposit) : "") : initial?.[27] && initial[27] !== "-" ? initial[27].replace(/,/g, "") : "");
  const sum = feeN + medPay + items.reduce((n, x) => n + svcNet(x), 0);
  const monthly = Math.round((sum - feeN + partPay) * 100) / 100;
  const prepaid = months > 0 && monthly > 0 ? String(Math.round(monthly * months * 100) / 100) : "";
  // ส่วนลดค่าห้อง: ลดเฉพาะค่าบริการห้องพัก (ไม่ลดค่าบริการทางการแพทย์) · ได้ตั้งแต่ 1 เดือน (ไม่เก็บล่วงหน้า = เดือนแรก)
  const pctN = stay === "เดือน" && offMode === "pct" ? Math.min(100, Math.max(0, Math.floor(Number(roomPct) || 0))) : 0;
  const offN = stay === "เดือน" && offMode === "baht" ? Math.max(0, Math.floor(Number(offAmt) || 0)) : 0;
  /** ส่วนลดค่าห้องชำระล่วงหน้า (รวม VAT · ประมาณ ยอดจริงคิดตามบรรทัดในขั้นที่ 4) */
  const mOff = Math.max(1, months), roomOff = offN ? Math.min(offN, partPay * mOff) : Math.round(partPay * mOff * pctN) / 100;
  const firstBill = (months || 1) * monthly - roomOff + (Number(deposit) || 0) - (Number(roomDep) || 0);
  const branchNames = useBranchNames();
  const { go, toast } = useApp();
  const { user } = useSession();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  /** ห้องที่กด "ราคาถูกแล้ว" (ไม่เตือนค่าห้องไม่ตรงซ้ำ) */
  const [priceOk, setPriceOk] = useState("");
  const [row, setRow] = useState<string[] | null>(null);
  const [room, setRoom] = useState("");
  /** กดถัดไป/บันทึกในขั้นนี้แล้วไม่ผ่านกี่ครั้ง (0 = ยังไม่กด) · ไม่ผ่าน = กล่องแจ้งปัญหาค้างไว้ ตรวจใหม่ทุกครั้งที่แก้ข้อมูล หายเองเมื่อแก้ครบ */
  const [tried, setTried] = useState(0);
  /** ครั้งล่าสุดกดบันทึกแบบเลือกห้อง (ตรวจห้อง) หรือบันทึกโดยยังไม่เลือกห้อง */
  const [triedRoom, setTriedRoom] = useState(false);
  /** กดเลือกห้องที่เต็ม/ปิดปรับปรุง (ค้างไว้จนกว่าจะเลือกห้องที่ใช้ได้ หรือบันทึกโดยยังไม่เลือกห้อง) */
  const [pickIssue, setPickIssue] = useState<{ msg: string } | null>(null);
  /** ช่องแรกที่เบราว์เซอร์ตรวจไม่ผ่าน (ช่องบังคับกรอก / เลขบัตร / เบอร์โทร) */
  const [invalid, setInvalid] = useState<{ el: HTMLInputElement; msg: string; field: string } | null>(null);
  /** สัญญาซ้อนที่หน้าทะเบียนสัญญาตรวจพบตอนบันทึก (ข้อมูลเพิ่งโหลด) */
  const [saveLive, setSaveLive] = useState<string[] | null>(null);
  const [, rerender] = useState(0);
  const step3Ref = useRef<HTMLDivElement>(null);
  const step4Ref = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const norm = (x: string) => x.trim().replace(/\s+/g, " ");
  /** ค่าเริ่มต้นจากสัญญาเดิม (ต่อสัญญา) */
  const d = (i: number) => (initial?.[i] && initial[i] !== "-" ? initial[i] : undefined);
  const dn = (i: number) => d(i)?.replace(/,/g, "");

  const all = roomInfos(rooms, residents);
  const options = row ? all.filter((r) => r.branch === row[1]) : [];
  const free = options.filter((r) => !r.closed).reduce((n, r) => n + r.free, 0);
  const existing = row ? residents.find((r) => norm(r[0]) === row[2] && r[3] === row[1] && staying(r[5] ?? "")) : undefined;
  /**
   * ชื่อนี้ตรงกับผู้รับบริการที่ย้ายออกไปแล้วในสาขาเดียวกัน: ให้เลือกเองว่าเป็นคนเดิมกลับมาพัก (ใช้ประวัติ HN เดิม) หรือคนละคน (ไม่รวมประวัติ)
   *  คนละคน = ต้องเพิ่มข้อความต่อท้ายชื่อให้ไม่ซ้ำ (ระบบไม่ให้มีชื่อซ้ำในสาขาเดียวกัน) · ค่าเริ่มต้น = ยังไม่เลือก (ไม่รวมให้เอง)
   */
  const pastRes = row && !existing && !renewing ? residents.find((r) => norm(r[0]) === row[2] && r[3] === row[1] && !staying(r[5] ?? "")) : undefined;
  const [samePerson, setSamePerson] = useState<"" | "same" | "new">("");
  const [suffix, setSuffix] = useState("");
  const newName = suffix.trim() ? `${row?.[2] ?? ""} (${norm(suffix).replace(/^\(|\)$/g, "")})` : "";
  /** ชื่อผู้รับบริการที่จะบันทึกในสัญญา (คนละคน = ชื่อที่เพิ่มข้อความต่อท้ายแล้ว) */
  const finalName = pastRes && samePerson === "new" ? newName : row?.[2] ?? "";

  /** แถวสัญญาจากค่าที่กรอกทุกขั้น (ห้องใส่ตอนบันทึก) */
  const buildRow = () => {
    const f = new FormData(formRef.current ?? undefined);
    const g = (k: string) => String(f.get(k) ?? "").trim();
    // มัดจำค่าห้อง: ยังไม่มีค่าบริการ โปรแกรม ล่วงหน้า เงินประกัน · ยอดมัดจำเก็บในช่องหักมัดจำห้อง (หักตอนเปิดสัญญาเต็ม)
    const lines: ServiceLine[] = booking ? [] : items.filter((x) => x.desc.trim());
    const fee4 = !booking && feeN && stay === "เดือน" ? String(feeN) : "-";
    if (!booking && stay !== "เดือน" && feeN > 0) {
      const name = roomName.trim() || "ห้องพัก";
      // จำนวน = จำนวนวัน/สัปดาห์ · ราคาต่อหน่วยก่อน VAT ไม่ปัดเศษ (ยอดรวม × VAT ตรงกับราคารวม VAT พอดี) · ใบแจ้งหนี้แสดง 500 × 5 วัน
      lines.unshift({ desc: `ค่า${name.replace(/^ค่า/, "")} ราย${stay}`, qty: nStay, unit: stay, price: feeN / nStay, stay, n: nStay, rate: Number(fee) || 0, part: unitPart } as ServiceLine);
    }
    // ส่วนที่เหลือของราคาห้อง = ค่าบริการทางการแพทย์ (ไม่มี VAT) · ชื่อห้ามมีคำว่า "ห้อง" (ระบบจะนับเป็นค่าห้องและคิด VAT)
    if (!booking && medPay > 0) lines.splice(stay === "เดือน" ? 0 : 1, 0, (stay === "เดือน"
      ? { desc: "ค่าบริการทางการแพทย์", qty: 1, unit: stay, price: medPay, code: "RM-MD", pkg: true }
      : { desc: `ค่าบริการทางการแพทย์ ราย${stay}`, qty: nStay, unit: stay, price: Math.round((medPay / nStay) * 100) / 100, code: "RM-MD", pkg: true }) as unknown as ServiceLine);
    return [
      completing ? initial?.[0] ?? "" : "", g("branch"), norm(who), norm(boss), fee4, booking ? WAIT_DEPOSIT : g("status") || CONTRACT_STATUSES[0],
      NO_ROOM, start, g("employer_id"), g("phone"), addr.trim(), relation.trim(),
      g("resident_id"), g("age"), initial?.[14] ?? "", lines.map((x) => x.desc).join(", "), lines.length ? String(lines.reduce((n, x) => n + svcNet(x), 0)) : "", initial?.[17] ?? "",
      booking ? "" : prepaid, booking ? "" : deposit, g("note"),
      booking ? "" : g("program"), booking ? "" : endDate, JSON.stringify([...lines, ...(fee4 !== "-" && roomName.trim() ? [{ desc: roomName.trim(), qty: 1, unit: "เดือน", price: 0, room: true }] : []),
        ...(!booking && (pctN > 0 || offN > 0 || parts > 1) ? [{ desc: "", qty: 0, unit: "", price: 0, meta: { ...(pctN > 0 ? { prepaidPct: pctN } : {}), ...(offN > 0 ? { prepaidOff: offN } : {}), ...(parts > 1 ? { installments: parts } : {}) } }] : [])]), [hosp.trim(), right ? `(${right})` : ""].filter(Boolean).join(" "), drugA.trim(), foodA.trim(), booking ? String(Number(depAmt) || 0) : roomDep, meds.trim(), hospAlt.trim(),
      String(rateN),
    ];
  };

  /** เปิดสัญญาใหม่ (ไม่ใช่ต่อสัญญา): สัญญาใช้งานอยู่/รอชำระมัดจำของชื่อนี้ในสาขานี้ · มี = ต้องใช้ "ต่อสัญญา" แทน */
  const liveOf = (name: string, branch: string) => (!renewing ? contracts.find((c) => c !== initial && !(completing && c[0] && c[0] === initial?.[0]) && norm(c[2] ?? "") === name && c[1] === branch && isLive(c)) : undefined);
  const curBranch = () => String((formRef.current?.elements.namedItem("branch") as HTMLSelectElement | null)?.value ?? "").trim();
  /** ขั้น 1: ปัญหาแรกที่ต้องแก้ก่อนไปกรอกค่าใช้จ่าย (ลำดับเดิม) · ชื่อผู้จ้าง/ผู้รับบริการเป็นช่องบังคับ (*) ตรวจด้วยกันที่นี่ */
  const check1 = (): FormProblem | null => {
    if (!booking && endDate && endDate < start) return { msg: "วันสิ้นสุดสัญญาต้องไม่ก่อนวันเริ่มสัญญา", field: "วันสิ้นสุดสัญญา" };
    if (booking) { /* มัดจำค่าห้อง: ประวัติแพ้ยา/อาหารกรอกตอนเปิดสัญญา */ }
    else if (!drugA.trim()) return { msg: `กรุณาระบุประวัติแพ้ยา หรือกด "${NO_ALLERGY}"`, field: "ประวัติแพ้ยา" };
    else if (!foodA.trim()) return { msg: `กรุณาระบุประวัติแพ้อาหาร หรือกด "${NO_ALLERGY}"`, field: "ประวัติแพ้อาหาร" };
    const branch = curBranch();
    if (!branch) return { msg: "กรุณาเลือกสาขา", field: "สาขา (Branch)" };
    if (!norm(boss)) return { msg: "กรุณากรอกชื่อ นามสกุล ผู้จ้าง", field: renewing ? "ชื่อ นามสกุล ผู้จ้าง" : "ชื่อผู้ว่าจ้าง" };
    if (!norm(who)) return { msg: "กรุณากรอกชื่อ นามสกุล ผู้รับบริการ", field: "ชื่อผู้รับบริการ" };
    const live = liveOf(norm(who), branch);
    return live ? { msg: "", live } : null;
  };
  /** ขั้น 2: รายการค่าบริการ */
  const check2 = (): FormProblem | null =>
    !booking && items.some((x) => x.desc.trim() && (!(x.qty > 0) || x.price < 0)) ? { msg: "กรุณาตรวจจำนวนและราคาของรายการค่าบริการ · จำนวนต้องมากกว่า 0 และราคาต้องไม่ติดลบ" } : null;
  /** ไปขั้นอื่น: ล้างกล่องแจ้งปัญหาของขั้นเดิม */
  const goStep = (s: 1 | 2 | 3 | 4) => { setStep(s); setTried(0); setInvalid(null); setSaveLive(null); window.scrollTo(0, 0); };
  /** เลื่อนไปและโฟกัสช่องที่ต้องแก้ (หาจาก aria-label) */
  const focusField = (f: string | HTMLElement) => {
    const sel = typeof f === "string" ? `[aria-label="${f}"]` : "";
    const el = typeof f === "string" ? step3Ref.current?.querySelector<HTMLElement>(sel) ?? formRef.current?.querySelector<HTMLElement>(sel) : f;
    el?.scrollIntoView({ block: "center", behavior: "smooth" }); el?.focus({ preventScroll: true });
  };
  /** เบราว์เซอร์ตรวจช่องไม่ผ่านตอนกดถัดไป: จำช่องแรกไว้แสดงในกล่องแจ้งปัญหา (เบราว์เซอร์ย้ายโฟกัสไปที่ช่องให้เอง) */
  const onInvalid = (e: FormEvent) => {
    const el = e.target as HTMLInputElement;
    const field = el.getAttribute("aria-label") ?? "";
    const where = field ? `ช่อง "${field}"` : "ช่องที่มีเครื่องหมาย *";
    const msg = el.validity.valueMissing ? `กรุณา${el.tagName === "SELECT" ? "เลือก" : "กรอก"}${where}` : `${where} · ${el.title || el.validationMessage}`;
    setInvalid((p) => p ?? { el, msg, field });
  };

  /** ขั้น 1 → 2: ตรวจรายละเอียดแล้วไปกรอกค่าใช้จ่าย */
  const toCosts = () => {
    if (check1()) { setTried((n) => n + 1); return; }
    const r = buildRow();
    if (r[2] !== row?.[2] || r[1] !== row?.[1]) { setSamePerson(""); setSuffix(""); }
    setRow(r);
    // มัดจำค่าห้องไม่มีขั้นค่าใช้จ่าย ไปเลือกห้องเลย
    if (booking) return toRooms();
    goStep(2);
  };

  /** ขั้น 2 → 3: ตรวจค่าใช้จ่ายแล้วไปเลือกห้อง */
  const toRooms = () => {
    if (check2()) { setTried((n) => n + 1); return; }
    const r = buildRow();
    setRow(r);
    // ผู้รับบริการที่มีห้องอยู่แล้ว (ต่อสัญญา): เลือกห้องเดิมไว้ให้
    const cur = residents.find((x) => norm(x[0]) === r[2] && x[3] === r[1] && staying(x[5] ?? ""));
    const curRoom = cur ? findRoom(all, r[1], cur[2]) : undefined;
    setRoom(curRoom ? curRoom.no : room && findRoom(all, r[1], room) ? room : "");
    setPickIssue(null); setTriedRoom(false);
    goStep(3);
  };

  /**
   * ค่าห้องจากห้องที่เลือก (ประเภทห้องต้องตรงหมวดในใบราคาก่อน เช่น ห้องเดี่ยวไม่เลือกราคาห้องคู่แม้ราคาเท่ากัน)
   *  ค่าห้องที่ตั้งไว้ตรงราคาในหมวด > ชื่อห้องตรงใบราคา (ราคาปกติ) > ค่าห้องที่ตั้งไว้ (กำหนดเอง)
   */
  const roomPrice = (r: RoomInfo): { fee: number; pick: string; name?: string } | null => {
    const rate = Number(String(r.rate ?? "").replace(/,/g, "")) || 0;
    const cat = (n: string) => (/คู่|twin/i.test(n) ? "คู่" : /รวม|shared/i.test(n) ? "รวม" : /เดี่ยว|deluxe|superior|suite/i.test(n) ? "เดี่ยว" : "");
    const tc = cat(r.type), t = r.type.toLowerCase();
    const named = ROOMS.findIndex((x) => { const en = x.name.match(/\(([^)]+?)(?: Room)?\)/)?.[1]; return !!en && t.includes(en.toLowerCase()); });
    const byRate = ROOMS.findIndex((x, i) => (named < 0 ? !tc || cat(x.name) === tc : i === named) && (x.month === rate || x.promo === rate));
    // ค่าห้องที่เสนอ = ราคารายเดือน (รวม VAT) ของประเภทห้องนั้นในใบราคา
    const i = rate && byRate >= 0 ? byRate : named >= 0 ? named : tc === "คู่" || tc === "รวม" ? ROOMS.findIndex((x) => cat(x.name) === tc) : -1;
    if (i >= 0) return { fee: monthOf(ROOMS[i]), pick: String(i), name: ROOMS[i].name };
    return rate ? { fee: rate, pick: "custom" } : null;
  };

  /**
   * ขั้น 3: ชื่อตรงกับผู้รับบริการที่ย้ายออกแล้ว ต้องเลือกว่าเป็นคนเดิมหรือคนละคน · คนละคน = ต้องมีข้อความต่อท้าย และชื่อใหม่ต้องไม่ซ้ำในสาขา
   *  ชื่อใหม่ซ้ำ = บอกใต้ช่องทันทีระหว่างพิมพ์ · ข้อความต่อท้ายว่าง = บอกหลังกดบันทึก
   */
  const nameClash = !!(row && pastRes && samePerson === "new" && newName && residents.some((r) => norm(r[0]) === newName && r[3] === row[1]));
  const suffixMsg = nameClash ? `มีผู้รับบริการชื่อ "${newName}" ในสาขา${row?.[1] ?? ""}แล้ว กรุณาใช้ข้อความต่อท้ายอื่น`
    : tried && pastRes && samePerson === "new" && !newName ? "กรุณาเพิ่มข้อความต่อท้ายชื่อ เช่น ชื่อเล่น หรือปีเกิด เพื่อแยกจากคนเดิม" : "";
  const nameIssue = !!pastRes && (!samePerson || (samePerson === "new" && (!newName || nameClash)));
  /** ห้องที่เลือกใช้ได้หรือไม่ (ห้องอาจเต็ม/ปิดหลังจากเลือก เพราะข้อมูลโหลดใหม่) */
  const roomIssue = () => { if (!row) return ""; const r = findRoom(all, row[1], room); return r ? roomProblem(r, finalName) : "กรุณาเลือกห้องพัก"; };

  /** ห้องที่เลือกในขั้นที่ 3 (NO_ROOM = ยังไม่เลือก) · ขั้นที่ 4 ออกใบแจ้งหนี้ */
  const [chosen, setChosen] = useState(NO_ROOM);
  const [billMode, setBillMode] = useState<BillChoice["mode"]>("unpaid");
  const [payBy, setPayBy] = useState<PayNow>({ method: PAY_METHODS[0], slip: "", date: todayIso() });
  /** แถวสัญญาที่จะบันทึก (ห้องจากขั้นที่ 3 · ชื่อหลังเพิ่มข้อความต่อท้าย) */
  const finalRow = () => buildRow().map((x, i) => (i === 6 ? chosen : i === 2 ? finalName : x));
  /** ใบมัดจำค่าห้อง: บรรทัดเดียว (DP-02 ไม่มี VAT) */
  const bookingBill = (r: string[]): { items: BillItem[]; note: string; has: string } => {
    const amt = Number(depAmt) || 0;
    return { items: amt > 0 ? [{ desc: `มัดจำห้องพัก${r[6] !== NO_ROOM ? ` ห้อง ${r[6]}` : ""}`, qty: 1, price: amt, discount: 0, code: "DP-02" }] : [], note: `มัดจำค่าห้องพัก${start ? ` · วันที่จะเข้าพัก ${docDate(start)}` : ""}`, has: "" };
  };
  const billOf = (r: string[]) => (booking ? bookingBill(r) : billPreview(r));
  /** ขั้น 3 → 4: ตรวจชื่อและห้องแล้วไปหน้าใบแจ้งหนี้ */
  const finish = (withRoom: boolean) => {
    // มัดจำค่าห้อง = จองห้อง ต้องเลือกห้องทุกครั้ง
    if (!row || (booking && !withRoom)) return;
    setTriedRoom(withRoom);
    if (!withRoom) setPickIssue(null);
    if (nameIssue || liveOf(finalName, row[1]) || (withRoom && roomIssue())) { setTried((n) => n + 1); return; }
    const next = withRoom ? room : NO_ROOM;
    setChosen(next);
    const b = billOf(buildRow().map((x, i) => (i === 6 ? next : x)));
    setBillMode(b.has ? "none" : booking && canPay ? "pay" : "unpaid");
    goStep(4);
  };
  /** ขั้น 4: ปัญหาที่ทำให้บันทึกไม่ได้ */
  const check4 = () => booking && billMode !== "none" && !(Number(depAmt) > 0) ? "กรุณาระบุยอดมัดจำค่าห้อง"
    : billMode === "pay" && payBy.method === "โอนเงิน" && !payBy.slip ? "กรุณาแนบหลักฐานการโอนเงิน" : "";
  /** ขั้น 4: บันทึกสัญญา / การจอง พร้อมออกใบแจ้งหนี้ */
  const save = () => {
    if (check4()) { setTried((n) => n + 1); return; }
    const r = finalRow(), b = billOf(r);
    const mode = b.items.length ? billMode : "none";
    const clash = onSave(r, photos, { mode, items: b.items, note: b.note, booking, pay: mode === "pay" ? payBy : undefined });
    if (clash) { setSaveLive(clash); setTried((n) => n + 1); }
  };

  // กดถัดไป/บันทึกไม่ผ่าน: เลื่อนไปและย้ายโฟกัสไปที่กล่องแจ้งปัญหากล่องแรกของขั้นนั้น (โปรแกรมอ่านหน้าจออ่านให้ทันที)
  useEffect(() => {
    if (!tried) return;
    const box = (step === 3 ? step3Ref.current : step === 4 ? step4Ref.current : formRef.current)?.querySelector<HTMLElement>("[data-form-callout]");
    box?.scrollIntoView({ block: "center", behavior: "smooth" }); box?.focus({ preventScroll: true });
  }, [tried, step]);
  // กดห้องที่เลือกไม่ได้: โฟกัสกล่องแจ้งใต้ผังห้อง
  useEffect(() => {
    if (!pickIssue) return;
    const box = step3Ref.current?.querySelector<HTMLElement>('[data-form-callout="room"]');
    box?.scrollIntoView({ block: "nearest", behavior: "smooth" }); box?.focus({ preventScroll: true });
  }, [pickIssue]);

  // ค่าห้องที่เลือกในขั้นที่ 2 เทียบกับห้องที่เลือก (เตือนเท่านั้น)
  const picked = row && room ? findRoom(all, row[1], room) : undefined;
  const suggest = picked ? roomPrice(picked) : null;
  const mismatch = !booking && stay === "เดือน" && picked && suggest && suggest.fee !== (Number(fee) || 0) && priceOk !== picked.no ? suggest : null;
  const applyRoomPrice = (x: { fee: number; pick: string; name?: string }) => {
    setFee(String(x.fee)); setFeePick(x.pick); if (x.name) setRoomName(x.name);
    if (row) setRow(row.map((v, k) => (k === 4 ? String(baseOfIncl(x.fee, rateN)) : v)));
    toast(`เปลี่ยนค่าห้องเป็น ${money(x.fee)} บาท/เดือนแล้ว`);
  };

  const pick = (r: RoomInfo) => {
    const problem = roomProblem(r, row?.[2]);
    if (problem) { setPickIssue({ msg: problem }); return; }
    setPickIssue(null); setRoom(r.no);
  };
  /** "เลือกห้องอื่น": โฟกัสการ์ดห้องแรกที่ยังรับได้ */
  const freeIdx = row ? options.findIndex((r) => !roomProblem(r, row[2])) : -1;
  const focusFreeRoom = () => { const el = gridRef.current?.children[freeIdx] as HTMLElement | undefined; el?.scrollIntoView({ block: "center", behavior: "smooth" }); el?.focus({ preventScroll: true }); };
  const roomMsg = pickIssue?.msg || (tried && triedRoom ? roomIssue() : "");
  const live3 = (step === 3 || step === 4) && tried && row ? liveOf(finalName, row[1]) ?? saveLive ?? undefined : undefined;
  /** ปัญหาของขั้น 1-2 ที่แสดงเหนือปุ่ม (ช่องที่เบราว์เซอร์ตรวจไม่ผ่านก่อน) */
  const stepProblem: FormProblem | null = invalid ? { msg: invalid.msg, el: invalid.el, field: invalid.field || undefined }
    : !tried ? null : step === 1 ? check1() : step === 2 ? check2() : null;
  const backToName = () => { goStep(1); setTimeout(() => focusField("ชื่อผู้รับบริการ"), 50); };
  /** ชื่อนี้มีสัญญาใช้งานอยู่แล้ว: ทางออก = ต่อสัญญาฉบับเดิม / ดูสัญญาเดิม / แก้ชื่อ (คนละคนที่ชื่อซ้ำ) */
  const liveBox = (live: string[]) => {
    const suffixHere = step >= 3 && !!pastRes && samePerson === "new";
    return (
      <FormCallout focus="step" title={`${live[2]} มีสัญญา ${live[0] || "ที่บันทึกไว้"} (${live[5]}) ในสาขา${live[1]}อยู่แล้ว`}
        actions={<>
          {onRenew && <button type="button" className={CALLOUT_PRIMARY} onClick={() => onRenew(live)}>ต่อสัญญาฉบับเดิม</button>}
          {onView && <button type="button" className={CALLOUT_SOFT} onClick={() => onView(live)}>ดูสัญญาเดิม</button>}
          <button type="button" className={CALLOUT_SOFT} onClick={() => (suffixHere ? (step === 4 ? goStep(3) : focusField("ข้อความต่อท้ายชื่อ")) : step >= 3 ? backToName() : focusField("ชื่อผู้รับบริการ"))}>
            {suffixHere ? "แก้ข้อความต่อท้ายชื่อ" : step >= 3 ? "ย้อนกลับไปแก้ชื่อ" : "แก้ชื่อผู้รับบริการ"}</button>
        </>}>
        <p>ถ้าเป็นคนเดิม ให้ต่อสัญญาฉบับเดิมแทนการเปิดสัญญาใหม่ · ถ้าเป็นคนละคนที่ชื่อซ้ำ ให้เพิ่มชื่อเล่นหรือปีเกิดต่อท้ายชื่อ</p>
        {(onRenew || onView) && <p className="form-callout-note">กดต่อสัญญาหรือดูสัญญาเดิม ฟอร์มนี้จะปิด ข้อมูลที่กรอกไว้จะไม่ถูกบันทึก</p>}
      </FormCallout>
    );
  };
  const calloutOf = (p: FormProblem) => p.live ? liveBox(p.live) : (
    <FormCallout focus="step" title={p.msg}
      actions={p.el || p.field ? <button type="button" className={CALLOUT_SOFT} onClick={() => focusField(p.el ?? p.field ?? "")}>{p.field ? `ไปที่ช่อง "${p.field}"` : "ไปที่ช่องนี้"}</button> : undefined} />
  );

  return (
    <Section title={completing && initial ? `เปิดสัญญา · ${initial[2]} (จองห้องไว้ ${initial[0] || ""})`.replace(" )", ")").replace(" ()", "") : booking ? "มัดจำค่าห้อง (จองห้องไว้ก่อน)" : fromQuote !== undefined ? `เปิดสัญญาใหม่ · จากใบเสนอราคา ${fromQuote}` : initial ? `ต่อสัญญา · ${initial[2]} (สัญญาเดิม ${initial[0]})` : "เปิดสัญญาใหม่"}>
      <div className="contract-steps" aria-label="ขั้นตอน">
        {(booking ? [[1, "ข้อมูลการจอง"], [3, "เลือกห้อง / เตียง"], [4, "ใบแจ้งหนี้มัดจำ"]] as const : [[1, "รายละเอียดสัญญา"], [2, "ค่าใช้จ่าย"], [3, "เลือกห้องพัก"], [4, "ใบแจ้งหนี้"]] as const)
          .map(([s, t], k) => <span key={s} className={step === s ? "is-active" : ""} aria-current={step === s ? "step" : undefined}><b>{k + 1}</b>{t}</span>)}
      </div>

      <form ref={formRef} className={`space-y-8 ${step >= 3 ? "hidden" : ""}`} onSubmit={(e) => { e.preventDefault(); if (step === 1) toCosts(); else toRooms(); }}
        onInvalidCapture={onInvalid} onChangeCapture={() => { if (invalid?.el.validity.valid) setInvalid(null); if (tried) rerender((n) => n + 1); }}>
        <div className={step === 1 ? "space-y-8" : "hidden"}>
        {!renewing && !completing && <label className={`booking-toggle ${booking ? "is-on" : ""}`}>
          <input type="checkbox" checked={booking} onChange={(e) => { setBooking(e.target.checked); setStart(e.target.checked ? "" : start || todayIso()); setTried(0); setInvalid(null); }} />
          <span><b>มัดจำค่าห้อง (จองห้องไว้ก่อน)</b>
            <small>กรอกแค่สาขา ผู้ว่าจ้าง ผู้รับบริการ แล้วเลือกห้อง/เตียงที่จะจอง · ระบบออกใบแจ้งหนี้มัดจำให้ · ข้อมูลอื่นกรอกตอนกด &quot;เปิดสัญญา&quot; ทีหลัง</small></span>
        </label>}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="สาขา (Branch)" required className="md:col-span-2"><select name="branch" defaultValue={d(1) ?? ""}><option value="">-- กรุณาเลือกสาขา --</option>{branchNames.map((b) => <option key={b}>{b}</option>)}</select></Field>
          {booking && <h3 className="booking-group md:col-span-2">ผู้ว่าจ้าง (ผู้วางมัดจำ)</h3>}
          <Field label="ชื่อ นามสกุล ผู้จ้าง" required>{lockNames ? <input value={boss} onChange={(e) => setBoss(e.target.value)} required />
            : <SuggestText value={boss} onChange={setBoss} options={[...new Set(contracts.map((c) => c[3]).filter((x) => x && x !== "-"))]} onPick={pickEmployer} label="ชื่อผู้ว่าจ้าง" placeholder="เช่น นายสมชาย ใจดี"
              renderSub={(n) => { const c = latest(3, n); return c ? `${c[0]} · ผู้รับบริการ ${c[2]}` : ""; }} />}
            {!lockNames && <PastBox c={oldBoss} pulled={pulledBoss} kind="boss" onPull={() => oldBoss && pickEmployer(oldBoss[3])} />}</Field>
          <Field label="เลขที่บัตรประชาชน" className={hide}><DigitsInput kind="id" name="employer_id" defaultValue={d(8)} /></Field>
          <Field label="ที่อยู่ (ไม่บังคับ)" className={`md:col-span-2 ${hide}`}><div className="space-y-2">
            <AddressFinder onPick={(t) => setAddr((a) => `${a.replace(/\s+(แขวง|ตำบล).*$/, "").trim()} ${t}`.trim())} />
            <textarea rows={2} value={addr} onChange={(e) => setAddr(e.target.value)} aria-label="ที่อยู่" placeholder="บ้านเลขที่ ซอย ถนน" />
          </div></Field>
          <Field label="รูปถ่ายบัตรประชาชนผู้ว่าจ้าง (ไม่บังคับ · แนบทีหลังได้)" className={`md:col-span-2 ${hide}`}><PhotoPicker value={photos.employer} onChange={(v) => setPhotos({ ...photos, employer: v })} label={renewing ?"ไม่แนบใหม่ = ใช้รูปจากสัญญาเดิม" : "ถ่ายหรือเลือกรูป · ให้เห็นชื่อ เลขบัตร รูปหน้า"} /></Field>
          <Field label="โทรศัพท์" required={!booking}><DigitsInput kind="phone" name="phone" required={!booking} defaultValue={d(9)} /></Field>
          <Field label="เกี่ยวข้อง" className={booking ? "md:col-span-2" : ""}><div className={booking ? "booking-relation" : "space-y-2"}><ChipChoice label="เกี่ยวข้อง" options={RELATIONS} value={RELATIONS.includes(relation) ? relation : ""} onChange={setRelation} />
            <input value={relation} onChange={(e) => setRelation(e.target.value)} placeholder="หรือพิมพ์เอง เช่น ลูกเขย" aria-label="เกี่ยวข้อง (พิมพ์เอง)" /></div></Field>
          {booking && <h3 className="booking-group md:col-span-2">ผู้รับบริการ (ผู้เข้าพัก)</h3>}
          <Field label="ชื่อ นามสกุล ผู้รับบริการ" required className={booking ? "md:col-span-2" : ""}>{lockNames ? <input value={who} readOnly required />
            : <SuggestText value={who} onChange={setWho} options={[...new Set(contracts.map((c) => c[2]).filter((x) => x && x !== "-"))]} onPick={pickResident} label="ชื่อผู้รับบริการ" placeholder="เช่น นางสมศรี ใจดี"
              renderSub={(n) => { const c = latest(2, n); return c ? `เคยมีสัญญา ${c[0]} · ${c[1]} · ดึงเลขบัตร อายุ ประวัติแพ้ โรงพยาบาลให้` : ""; }} />}
            {!lockNames && (oldRes ? <PastBox c={oldRes} pulled={pulledRes} kind="res" onPull={() => pickResident(oldRes[2])} /> : null)}</Field>
          <Field label="เลขที่บัตรประชาชนผู้รับบริการ" className={hide}><DigitsInput kind="id" name="resident_id" defaultValue={d(12)} /></Field>
          <Field label="อายุ (ปี) ผู้รับบริการ"><input name="age" type="number" min={0} max={130} placeholder="เช่น 78" defaultValue={dn(13)} /></Field>
          <Field label={booking ? "วันที่จะเข้าพัก (ใส่ทีหลังได้)" : "วันเริ่มสัญญา"} required={!booking}><input type="date" required={!booking} value={start} onChange={(e) => setStart(e.target.value)} aria-label="วันเริ่มสัญญา" />
            {booking && <div className="mt-2 flex flex-wrap items-center gap-2">
              {start ? <button type="button" onClick={() => setStart("")} className="rounded-full px-3 py-1 text-xs text-gold-500 underline-offset-2 hover:underline">ล้างวันที่ (ยังไม่กำหนด)</button>
                : <button type="button" onClick={() => setStart(todayIso())} className="rounded-full border border-cream-300 bg-white px-3 py-1 text-xs text-gold-700 hover:border-gold-300">ใส่วันนี้</button>}
              <p className="field-hint !mt-0">ว่าง = ยังไม่กำหนด · สัญญายังไม่เริ่มจนกว่าจะกด &quot;เปิดสัญญา&quot; และใส่วันเริ่มสัญญา</p>
            </div>}</Field>
          <Field label="รูปถ่ายบัตรประชาชนผู้รับบริการ (ไม่บังคับ · แนบทีหลังได้)" className={`md:col-span-2 ${hide}`}><PhotoPicker value={photos.resident} onChange={(v) => setPhotos({ ...photos, resident: v })} label={renewing ?"ไม่แนบใหม่ = ใช้รูปจากสัญญาเดิม" : "ถ่ายหรือเลือกรูป · ให้เห็นชื่อ เลขบัตร รูปหน้า"} /></Field>
          <Field label="เลขที่สัญญา" className={hide}><input value={completing ? initial?.[0] || "ออกเลขอัตโนมัติ" : initial && fromQuote === undefined ? `ออกเลขใหม่อัตโนมัติ (สัญญาเดิม ${initial[0]})` : "ออกเลขอัตโนมัติ เช่น CT-2569-0001"} readOnly tabIndex={-1} className="field-locked" /></Field>
          <Field label="วันสิ้นสุดสัญญา" className={hide}><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} aria-label="วันสิ้นสุดสัญญา" />
            <div className="mt-2 flex flex-wrap gap-1.5">{[[1, "1 เดือน"], [3, "3 เดือน"], [6, "6 เดือน"], [12, "1 ปี"]].map(([n, t]) => <button key={t} type="button" disabled={!start} onClick={() => setEndDate(addMonthsIso(start, Number(n)))} className="rounded-full border border-cream-300 bg-white px-3 py-1 text-xs text-gold-700 hover:border-gold-300">+{t}</button>)}
              {endDate && <button type="button" onClick={() => setEndDate("")} className="rounded-full px-3 py-1 text-xs text-gold-500 underline-offset-2 hover:underline">ไม่กำหนดวันสิ้นสุด</button>}</div>
            <p className="field-hint">ว่าง = มีผลต่อเนื่องจนกว่าจะจำหน่าย</p></Field>
          <Field label="สถานะสัญญา" required className={hide}><select name="status" defaultValue={CONTRACT_STATUSES[0]}>{CONTRACT_STATUSES.slice(0, 2).map((x) => <option key={x}>{x}</option>)}</select></Field>
        </div>

        <div>
          <h3 className={`mb-3 font-semibold text-gold-800 ${hide}`}>ข้อมูลด้านสุขภาพของผู้รับบริการ</h3>
          <div className={`grid gap-4 md:grid-cols-2 ${hide}`}>
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
          <p className={`mt-3 rounded-xl bg-cream-50 px-4 py-2.5 text-sm text-gold-700 ${hide}`}>โรคประจำตัว ไม่ต้องกรอกที่นี่ · ระบบดึงจากข้อมูลผู้รับบริการ (เมนูผู้รับบริการ) มาพิมพ์ในสัญญาให้เอง</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="หมายเหตุ" className="md:col-span-2"><textarea name="note" rows={2} placeholder="เช่น แพ้ยาเพนิซิลลิน, ญาติมาเยี่ยมทุกวันเสาร์" defaultValue={renewing ? `ต่อจากสัญญา ${initial?.[0] ?? ""}` : d(20)} /></Field>
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
            <Field label={`ค่าห้อง (บาท/${stay} · รวม VAT แล้ว)`}>
              {/* คิดค่าห้อง รายวัน / รายสัปดาห์ / รายเดือน + จำนวนที่พัก อยู่บรรทัดเดียวกัน · เปลี่ยนหน่วยแล้วราคาห้องที่เลือกไว้เปลี่ยนตาม */}
              <div className="stay-bar">
                <div className="stay-tabs" role="radiogroup" aria-label="คิดค่าห้อง">
                  {(["วัน", "สัปดาห์", "เดือน"] as const).map((u) => (
                    <button key={u} type="button" role="radio" aria-checked={stay === u} className={stay === u ? "is-on" : ""}
                      onClick={() => { setStay(u); if (u !== "เดือน") setMonths(0); const i = Number(feePick); if (feePick !== "" && feePick !== "custom" && ROOMS[i]) { setFee(String(unitOf(ROOMS[i], u))); setRoomPart(String(ROOMS[i].part[u])); } if (u !== stay) setStayN(u === "วัน" ? "7" : "1"); }}>
                      ราย{u}</button>
                  ))}
                </div>
                {stay !== "เดือน" && <div className="stay-n">
                  <label htmlFor="stay-n">พัก</label>
                  <button type="button" className="stay-step" aria-label={`ลด 1 ${stay}`} onClick={() => setStayN(String(Math.max(1, nStay - 1)))}>−</button>
                  <input id="stay-n" type="text" inputMode="numeric" maxLength={3} value={stayN} onChange={(e) => setStayN(e.target.value.replace(/\D/g, "").slice(0, 3))} aria-label={`จำนวน${stay}ที่พัก`} />
                  <button type="button" className="stay-step" aria-label={`เพิ่ม 1 ${stay}`} onClick={() => setStayN(String(nStay + 1))}>+</button>
                  <span>{stay}</span>
                  {(stay === "วัน" ? [3, 7, 14] : [1, 2, 3]).map((n) => <button key={n} type="button" onClick={() => setStayN(String(n))} className={`stay-quick ${nStay === n ? "is-on" : ""}`}>{n}</button>)}
                </div>}
              </div>
              {/* การ์ดห้อง: กดทั้งการ์ด · ราคาต่อหน่วย และยอดรวมตามจำนวนที่พัก */}
              <div className="room-opts" role="radiogroup" aria-label="ค่าห้อง">
                {ROOMS.map((x, i) => {
                  const [th, en] = [x.name.replace(/\s*\(.*\)\s*$/, ""), x.name.match(/\(([^)]+)\)/)?.[1] ?? ""];
                  const on = feePick === String(i), v = unitOf(x, stay);
                  return (
                    <button key={x.name} type="button" role="radio" aria-checked={on} disabled={!v} aria-label={`${x.name} ราย${stay} ${v.toLocaleString()} บาท รวม VAT`}
                      className={`room-opt ${on ? "is-on" : ""}`} onClick={() => { setFeePick(String(i)); setFee(String(v)); setRoomPart(String(x.part[stay])); setRoomName(x.name); }}>
                      <span className="room-opt-name"><b>{th}</b>{en && <small>{en}</small>}</span>
                      <span className="room-opt-price"><b>{v ? v.toLocaleString() : "-"}</b><small>/{stay}{stay === "สัปดาห์" && !x.weekSet ? " (7 วัน)" : ""}</small>
                        {stay !== "เดือน" && v > 0 && nStay > 0 && <em>{nStay} {stay} = {(v * nStay).toLocaleString()}</em>}</span>
                    </button>
                  );
                })}
                <button type="button" role="radio" aria-checked={feePick === "custom"} className={`room-opt is-custom ${feePick === "custom" ? "is-on" : ""}`} onClick={() => { if (feePick !== "custom") { setFeePick("custom"); setRoomName(""); setRoomPart(""); } }}>
                  <span className="room-opt-name"><b>กำหนดราคาเอง</b><small>ราคาพิเศษ / ห้องนอกใบราคา</small></span>
                </button>
              </div>
              {feePick === "custom" && <div className="room-custom">
                <label>ชื่อห้อง<input type="text" list="room-names" value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="เช่น ห้องเดี่ยวพิเศษ" /></label>
                <datalist id="room-names">{[...new Set(["ห้องรวม", "ห้องคู่", "ห้องเดี่ยว", ...ROOMS.map((x) => x.name)])].map((x) => <option key={x} value={x} />)}</datalist>
                <label>ราคาห้องทั้งหมด (บาท/{stay} รวม VAT)<input type="number" min={0} value={fee} onChange={(e) => setFee(e.target.value)} placeholder={stay === "เดือน" ? "เช่น 14000" : "เช่น 1500"} autoFocus /></label>
                <label>ในนี้เป็นค่าห้อง (มี VAT)<input type="number" min={0} value={roomPart} onChange={(e) => setRoomPart(e.target.value)} placeholder="ว่าง = 40% ของราคา" /></label>
              </div>}
              {/* ยอดค่าห้องทั้งหมด: เปลี่ยนจำนวนวัน/ห้อง แล้วเห็นยอดใหม่ทันที */}
              <div className="room-total">
                <div className="min-w-0">
                  {roomPay > 0 ? <>
                    <p className="room-total-calc">{stay !== "เดือน" ? `${money(Number(fee) || 0)} × ${nStay} ${stay}` : "ราคาห้องต่อเดือน"}</p>
                    <p className="room-total-vat">ค่าห้อง {money(partPay)}{vatOn && vatAmt > 0 ? ` (ก่อน VAT ${money(feeN)} + VAT ${rateN}% ${money(vatAmt)})` : " (ไม่มี VAT)"}{medPay > 0 ? ` + ค่าบริการทางการแพทย์ ${money(medPay)} (ไม่มี VAT)` : ""}</p>
                  </> : <p className="room-total-calc">เลือกห้องด้านบน</p>}
                </div>
                <b>{money(roomPay)}<small> บาท</small></b>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-gold-700">
                <label className="flex cursor-pointer items-center gap-2 font-medium">
                  <input type="checkbox" className="!h-4 !w-4 !min-h-0" checked={vatOn} onChange={(e) => { setVatOn(e.target.checked); if (e.target.checked && !(Number(roomVat) > 0)) setRoomVat(String(DEFAULT_VAT)); }} />
                  ค่าห้องมี VAT (รวมในราคาแล้ว)
                </label>
                {vatOn && <><input type="number" min={0} max={30} step="0.5" className="!w-16 !min-h-0 !py-1.5" value={roomVat} onChange={(e) => setRoomVat(e.target.value)} aria-label="VAT ค่าห้อง (%)" /><span>%</span></>}
              </div>
            </Field>
          </div>
          <p className="label mt-4">รายการบริการและค่าบริการเพิ่มเติม</p>
          <ServiceLines items={items} onChange={setItems} total={false} exclude={["ห้องพัก"]} />
          {/* การชำระ (ซ้าย) · สรุปใบแจ้งหนี้แรกเข้า (ขวา) */}
          <div className="pay2">
            <div className="pay2-main">
              {stay === "เดือน" ? <div className="pay2-sec">
                <p className="pay2-h">ชำระค่าบริการล่วงหน้า</p>
                <div className="pay2-chips" role="radiogroup" aria-label="ชำระค่าบริการล่วงหน้า">{[0, 1, 2, 3, 6].map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={months === n} onClick={() => setMonths(n)} className={`pay2-chip ${months === n ? "is-on" : ""}`}>
                    {n ? `${n} เดือน` : "ไม่เก็บล่วงหน้า"}</button>
                ))}</div>
                {/* ชำระล่วงหน้าตั้งแต่ 2 เดือน: ส่วนลดค่าห้องเป็น % (จำนวนเต็ม) · ลดเฉพาะค่าห้อง */}
                {partPay > 0 && <div className="pay2-inline">
                  <label htmlFor="room-pct">ส่วนลดค่าห้อง</label>
                  <span className="pay2-mode" role="radiogroup" aria-label="ลดเป็น">
                    {([["pct", "%"], ["baht", "บาท"]] as const).map(([k, t]) => <button key={k} type="button" role="radio" aria-checked={offMode === k} className={offMode === k ? "is-on" : ""} onClick={() => setOffMode(k)}>{t}</button>)}
                  </span>
                  {offMode === "pct"
                    ? <><input id="room-pct" type="text" inputMode="numeric" maxLength={3} value={roomPct} placeholder="0"
                        onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 3); setRoomPct(v && Number(v) > 100 ? "100" : v); }} aria-label="ส่วนลดค่าห้อง (%)" /><span>%</span></>
                    : <><input id="room-pct" type="text" inputMode="numeric" maxLength={7} value={offAmt} placeholder="เช่น 1000" className="is-wide"
                        onChange={(e) => setOffAmt(e.target.value.replace(/\D/g, "").slice(0, 7))} aria-label="ส่วนลดค่าห้อง (บาท)" /><span>บาท</span></>}
                  <small>{roomOff > 0 ? `ค่าห้อง ${money(partPay)} ${pctN ? `− ${pctN}%` : `− ${money(Math.min(offN, partPay * mOff) / mOff)}`} = ${money(Math.round((partPay - roomOff / mOff) * 100) / 100)}${mOff > 1 ? "/เดือน" : ""}` : "ลดเฉพาะค่าบริการห้องพัก"}</small>
                </div>}
              </div> : <p className="pay2-note">พักระยะสั้น {nStay} {stay} · เก็บครั้งเดียวในใบแรกเข้า ไม่ออกใบรายเดือนให้อัตโนมัติ</p>}
              <div className="pay2-sec">
                <p className="pay2-h">แบ่งชำระ</p>
                <div className="pay2-chips" role="radiogroup" aria-label="แบ่งชำระใบแรกเข้า">{[1, 2, 3, 4, 6].map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={parts === n} onClick={() => setParts(n)} className={`pay2-chip ${parts === n ? "is-on" : ""}`}>{n === 1 ? "จ่ายครั้งเดียว" : `${n} งวด`}</button>
                ))}</div>
              </div>
              <div className="pay2-grid">
                <Field label="เงินประกัน (บาท)"><input type="number" min={0} value={deposit} onChange={(e) => setDeposit(e.target.value)} placeholder="ไม่เก็บ = เว้นว่าง" aria-label="ชำระเงินประกัน" />
                  {monthly > 0 && stay === "เดือน" && <div className="pay2-chips mt-1.5">{[1, 2].map((n) => <button key={n} type="button" onClick={() => setDeposit(String(Math.round(monthly * n * 100) / 100))} className="pay2-chip is-sm">{n} เดือน · {money(monthly * n)}</button>)}</div>}</Field>
                <Field label="หักมัดจำห้องที่จ่ายตอนจอง (บาท)"><input type="number" min={0} value={roomDep} onChange={(e) => setRoomDep(e.target.value)} placeholder="ไม่มี = เว้นว่าง" />
                  {completing && bookedDeposit > 0 && <p className={paidDeposit >= bookedDeposit ? "field-hint" : "field-error"}>{paidDeposit >= bookedDeposit ? `มัดจำตอนจอง ${money(bookedDeposit)} บาท รับชำระแล้ว` : `มัดจำตอนจอง ${money(bookedDeposit)} บาท ${paidDeposit ? `รับชำระแล้ว ${money(paidDeposit)} บาท` : "ยังไม่ได้รับชำระ"} · หักเฉพาะยอดที่รับแล้ว`}</p>}</Field>
              </div>
            </div>
            <aside className="pay2-sum" aria-label="สรุปใบแจ้งหนี้แรกเข้า">
              <p className="pay2-sum-t">ใบแจ้งหนี้แรกเข้า</p>
              <dl>
                {feeN > 0 && <div><dt>ค่าบริการห้องพัก<small>{vatAmt > 0 ? `รวม VAT ${money(vatAmt)}` : "ไม่มี VAT"}</small></dt><dd>{money(partPay)}</dd></div>}
                {medPay > 0 && <div><dt>ค่าบริการทางการแพทย์</dt><dd>{money(medPay)}</dd></div>}
                {sum - feeN - medPay > 0 && <div><dt>บริการเพิ่มเติม</dt><dd>{money(sum - feeN - medPay)}</dd></div>}
                <div className="is-sub"><dt>{stay === "เดือน" ? "รวมต่อเดือน" : `รวม ${nStay} ${stay}`}</dt><dd>{money(monthly)}</dd></div>
                {stay === "เดือน" && months > 1 && <div><dt>× {months} เดือน</dt><dd>{money(monthly * months)}</dd></div>}
                {roomOff > 0 && <div className="is-minus"><dt>ส่วนลดค่าบริการห้องพัก{pctN ? ` ${pctN}%` : ""}<small>ค่าห้องเหลือ {money(Math.round((partPay * mOff - roomOff) * 100) / 100)}{mOff > 1 ? ` (${money(Math.round((partPay - roomOff / mOff) * 100) / 100)}/เดือน)` : ""}</small></dt><dd>−{money(roomOff)}</dd></div>}
                {Number(deposit) > 0 && <div><dt>เงินประกัน</dt><dd>{money(Number(deposit))}</dd></div>}
                {Number(roomDep) > 0 && <div className="is-minus"><dt>หักมัดจำห้อง</dt><dd>−{money(Number(roomDep))}</dd></div>}
              </dl>
              <p className="pay2-total"><span>ยอดใบแรกเข้า</span><b>{money(Math.max(0, firstBill))}</b></p>
              {parts > 1 && firstBill > 0 && <p className="pay2-parts">แบ่ง {parts} งวด · งวดละ {money(splitInstallments(firstBill, parts)[0])}</p>}
              {stay === "เดือน" && !prepaid && !deposit && sum > 0 && <p className="pay2-foot">ไม่เก็บล่วงหน้า · เลือกวิธีออกใบในขั้นที่ 4</p>}
            </aside>
          </div>
        </div>

        {/* ปัญหาที่ทำให้ไปขั้นถัดไปไม่ได้: ค้างไว้เหนือปุ่มจนกว่าจะแก้ */}
        {stepProblem && calloutOf(stepProblem)}
        {step === 1 ? <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn-soft" onClick={onClose}>ยกเลิก</button>
          <button className="btn-primary" onClick={() => setInvalid(null)}>{booking ? "ถัดไป: เลือกห้องพัก" : "ถัดไป: ค่าใช้จ่าย"} <Icon name="arrow" className="h-4 w-4" /></button>
        </div> : <div className="flex flex-col-reverse gap-2 border-t border-cream-200 pt-4 sm:flex-row sm:justify-end">
          <button type="button" className="btn-soft" onClick={() => goStep(1)}>ย้อนกลับไปแก้รายละเอียด</button>
          <button className="btn-primary" onClick={() => setInvalid(null)}>ถัดไป: เลือกห้องพัก <Icon name="arrow" className="h-4 w-4" /></button>
        </div>}
      </form>

      {step === 3 && row && <div ref={step3Ref} className="space-y-5">
        <div className="rounded-2xl border border-cream-200 bg-cream-50/60 px-4 py-3 text-sm text-gold-700">
          <p><span className="text-gold-500">ผู้รับบริการ</span> <b className="font-medium text-gold-800">{row[2]}</b>{row[13] ? ` · ${row[13]} ปี` : ""} · <span className="text-gold-500">สาขา</span> {row[1]} · <span className="text-gold-500">ผู้ว่าจ้าง</span> {row[3]}{booking ? <> · <span className="text-gold-500">เข้าพัก</span> {start ? docDate(start) : "ยังไม่กำหนด"}</> : contractMonthTotal(row) ? <> · <span className="text-gold-500">ยอดรวม</span> {money(contractMonthTotal(row))} บาท/เดือน</> : ""}</p>
          {existing && <p className="mt-1 text-xs text-gold-500">มีชื่อนี้ในทะเบียนผู้รับบริการแล้ว ระบบจะอัปเดตห้องให้คนเดิม ไม่สร้างรายชื่อซ้ำ</p>}
        </div>
        {/* ชื่อตรงกับคนที่ย้ายออกแล้ว: เตือน (เหลือง) · กดบันทึกแล้วยังเลือก/กรอกไม่ครบ = ไปต่อไม่ได้ (แดง) */}
        {pastRes && <FormCallout tone={tried && nameIssue ? "block" : "warn"} focus={tried && nameIssue ? "step" : undefined}
          title={<>ชื่อนี้เคยเป็นผู้รับบริการของสาขา{row[1]}{pastRes[6] ? ` (HN ${pastRes[6]})` : ""} และย้ายออกไปแล้ว</>}>
          <p>{tried && !samePerson ? "กรุณาเลือกว่าเป็นคนเดิมกลับมาพัก หรือคนละคนที่ชื่อซ้ำ ก่อนบันทึก" : "เลือกให้ถูกก่อนบันทึก ระบบจะไม่รวมประวัติให้เอง"}</p>
          <div role="radiogroup" aria-label="เป็นคนเดิมหรือไม่" aria-required="true" className="choice-cards">
            {([["same", "เป็นคนเดิม (กลับมาพักอีกครั้ง)", "ใช้ทะเบียนเดิม (HN ประวัติการรักษา โรคประจำตัว ยา) · สถานะเปลี่ยนเป็นเข้าพักอีกครั้ง"],
              ["new", "คนละคน (ชื่อซ้ำ)", "สร้างทะเบียนผู้รับบริการใหม่ (HN ใหม่) ไม่รวมกับคนเดิม · ต้องเพิ่มข้อความต่อท้ายชื่อ"]] as const).map(([k, t, s]) => (
              <button key={k} type="button" role="radio" aria-checked={samePerson === k} onClick={() => setSamePerson(k)} className={`choice-card ${samePerson === k ? "is-on" : ""}`}>
                <span className="choice-card-dot" aria-hidden="true" /><span><b>{t}</b><small>{s}</small></span>
              </button>
            ))}
          </div>
          {samePerson === "new" && <>
            <Field label="ข้อความต่อท้ายชื่อ (ใช้แยกจากคนเดิม)" required>
              <input value={suffix} onChange={(e) => setSuffix(e.target.value)} placeholder="เช่น ชื่อเล่น หรือปีเกิด 2485" aria-label="ข้อความต่อท้ายชื่อ"
                aria-invalid={suffixMsg ? true : undefined} aria-describedby="contract-suffix-msg" autoFocus />
            </Field>
            <p id="contract-suffix-msg" className={suffixMsg ? "field-error" : "field-hint"}>{suffixMsg || (newName ? <>จะบันทึกเป็น <b>{newName}</b> · สร้างทะเบียนผู้รับบริการใหม่ (HN ใหม่) ไม่รวมกับคนเดิม</> : "ระบบไม่ให้มีชื่อซ้ำในสาขาเดียวกัน จึงต้องเพิ่มข้อความต่อท้าย")}</p>
          </>}
        </FormCallout>}
        {!options.length ? <div className="empty-state"><Icon name="bed" /><p>สาขา{row[1]}ยังไม่มีห้องในระบบ {booking ? (can(user, "rooms.manage") ? "มัดจำค่าห้องต้องเลือกห้อง สร้างห้องที่เมนูห้องพักและเตียงก่อน" : "มัดจำค่าห้องต้องเลือกห้อง แจ้งผู้จัดการสาขาให้สร้างห้องก่อน") : can(user, "rooms.manage") ? "สร้างห้องที่เมนูห้องพักและเตียง หรือบันทึกสัญญาไปก่อนแล้วจัดห้องภายหลัง" : "แจ้งผู้จัดการสาขาให้สร้างห้อง หรือบันทึกสัญญาไปก่อนแล้วจัดห้องภายหลัง"}</p>
          {can(user, "rooms.manage") && <button type="button" className="mt-3 text-sm text-gold-700 underline-offset-4 hover:underline" onClick={() => go("rooms")}>ไปที่ห้องพักและเตียง (ข้อมูลที่กรอกจะไม่ถูกบันทึก)</button>}</div>
          : <>
            <p className="text-sm text-gold-600">{booking ? <><b className="text-gold-800">ต้องเลือกห้องที่จะจอง</b> · </> : ""}เลือกห้องที่ยังว่าง · สาขา{row[1]} ว่าง {free} เตียง จาก {options.length} ห้อง</p>
            {free === 0 && <FormCallout tone="warn" title={`ห้องของสาขา${row[1]}เต็มทุกห้องแล้ว`}
              actions={booking ? undefined : <button type="button" className={CALLOUT_SOFT} onClick={() => finish(false)}>ไม่เลือกห้อง ไปขั้นถัดไป</button>}>
              <p>{booking ? "มัดจำค่าห้องต้องเลือกห้องที่ว่าง จึงจองไม่ได้ตอนนี้ · แจ้งผู้จัดการสาขาให้เพิ่มห้องหรือเพิ่มจำนวนผู้ป่วยต่อห้องก่อน" : "บันทึกสัญญาโดยยังไม่เลือกห้อง แล้วแจ้งผู้จัดการสาขาให้เพิ่มห้องหรือเพิ่มจำนวนผู้ป่วยต่อห้อง"}</p>
            </FormCallout>}
            <div ref={gridRef} className="room-grid">{options.map((r) => <RoomCard key={r.i} room={r} selected={roomKey(r.no) === roomKey(room)} onClick={() => pick(r)} />)}</div>
            {/* ห้องที่กด/ที่เลือกไว้ใช้ไม่ได้ (เต็ม / ปิดปรับปรุง / ไม่พบห้อง): ค้างใต้ผังห้องจนกว่าจะเลือกห้องที่ใช้ได้ */}
            {roomMsg && <FormCallout focus="room" title={roomMsg}
              actions={<>
                {freeIdx >= 0 && <button type="button" className={CALLOUT_PRIMARY} onClick={focusFreeRoom}>เลือกห้องอื่น</button>}
                {!booking && <button type="button" className={CALLOUT_SOFT} onClick={() => finish(false)}>ไม่เลือกห้อง ไปขั้นถัดไป</button>}
              </>} />}
            {picked && mismatch && <FormCallout tone="warn" title={`ห้อง ${picked.no} (${picked.type}) ค่าห้องคือ ${money(mismatch.fee)} บาท/เดือน`}
              actions={<>
                <button type="button" className={CALLOUT_PRIMARY} onClick={() => applyRoomPrice(mismatch)}>ใช้ค่าห้อง {money(mismatch.fee)}</button>
                {Number(fee) > 0 && <button type="button" className={CALLOUT_SOFT} onClick={() => setPriceOk(picked.no)}>ราคาเดิมถูกแล้ว ไม่ต้องเปลี่ยน</button>}
              </>}>
              <p>{Number(fee) ? <>แต่ค่าห้องที่เลือกในขั้นที่ 2 คือ <b>{money(Number(fee))} บาท</b></> : "แต่ยังไม่ได้เลือกค่าห้องในขั้นที่ 2"} · ตรวจอีกครั้งก่อนบันทึก</p>
            </FormCallout>}
          </>}
        {/* ชื่อนี้มีสัญญาใช้งานอยู่แล้ว (ตรวจซ้ำตอนบันทึก) */}
        {step === 3 && live3 && liveBox(live3)}
        <div className="flex flex-col-reverse gap-2 border-t border-cream-200 pt-4 sm:flex-row sm:justify-end">
          <button type="button" className="btn-soft" onClick={() => goStep(booking ? 1 : 2)}>{booking ? "ย้อนกลับไปแก้ข้อมูลการจอง" : "ย้อนกลับไปแก้ค่าใช้จ่าย"}</button>
          {!booking && <button type="button" className="btn-soft" onClick={() => finish(false)}>ไม่เลือกห้อง ไปขั้นถัดไป</button>}
          <button type="button" className="btn-primary" disabled={!room} onClick={() => finish(true)}>{room ? `ถัดไป: ใบแจ้งหนี้ · ห้อง ${room}` : "เลือกห้องก่อน"} {room && <Icon name="arrow" className="h-4 w-4" />}</button>
        </div>
      </div>}

      {/* ขั้นที่ 4: ใบแจ้งหนี้ของคนนี้ (ใบแรกเข้า / ใบมัดจำค่าห้อง) · ซ้าย = เลือกทีละข้อ · ขวา = สรุปยอดแบบใบเสร็จ */}
      {step === 4 && row && (() => {
        const r = finalRow(), b = billOf(r), t = totals(b.items), vat = vatOf(b.items.filter((i) => !i.credit)).vat;
        type Mode = [BillChoice["mode"], string, string, "receipt" | "doc" | "check" | "clock"];
        const modes: Mode[] = [
          ...(canPay ? [["pay", parts > 1 && !booking ? "รับงวดที่ 1 เลย" : "รับชำระเลย", parts > 1 && !booking ? `รับ ${money(splitInstallments(t.net, parts)[0])} บาท ออกใบเสร็จงวดที่ 1` : "ออกใบเสร็จ พิมพ์ให้ลูกค้าได้ทันที", "receipt"] as Mode] : []),
          ["unpaid", "รับเงินทีหลัง", `ออกใบแจ้งหนี้ "${UNPAID}" ไว้ก่อน`, "doc"],
          ...(!booking ? [["draft", "ให้การเงินตรวจยอดก่อน", `ออกเป็น "${DRAFT}"`, "check"] as Mode] : []),
          // "ไม่ออกใบ" มีเฉพาะสัญญาที่ออกใบแรกเข้าไว้แล้ว (กันออกซ้ำ)
          ...(b.has ? [["none", "ไม่ต้องออกใบใหม่", `ใช้ใบแรกเข้า ${b.has} ที่ออกไว้แล้ว`, "clock"] as Mode] : []),
        ];
        const p4 = tried ? check4() : "";
        const outcome = !b.items.length || billMode === "none" ? "ยังไม่ออกใบแจ้งหนี้" : billMode === "pay" ? `รับ${payBy.method}แล้วออกใบเสร็จ` : billMode === "draft" ? `ออกใบ "${DRAFT}"` : `ออกใบแจ้งหนี้ "${UNPAID}"`;
        return (
          <div ref={step4Ref} className="bill4">
            <div className="bill4-main">
              {b.has && <FormCallout tone="warn" title={`สัญญานี้มีใบแรกเข้า ${b.has} แล้ว`}><p>ไม่ต้องออกใบใหม่ เว้นแต่ยกเลิกใบเดิมไปแล้ว · เลือก &quot;ยังไม่ออกใบแจ้งหนี้&quot; ไว้ให้</p></FormCallout>}
              {booking ? <section>
                <h3 className="bill4-h"><b>1</b>เลือกยอดมัดจำค่าห้อง</h3>
                <div role="radiogroup" aria-label="ยอดมัดจำค่าห้อง" className="amt-cards">
                  {BOOKING_AMOUNTS.map((n) => {
                    const on = Number(depAmt) === n;
                    return (
                      <button key={n} type="button" role="radio" aria-checked={on} onClick={() => setDepAmt(String(n))} className={`amt-card ${on ? "is-on" : ""}`}>
                        <span className="amt-check" aria-hidden="true">{on && <Icon name="check" className="h-4 w-4" />}</span>
                        <span className="amt-num">{n.toLocaleString()}<small>บาท</small></span>
                        <span className="amt-sub">มัดจำค่าห้องพัก</span>
                      </button>
                    );
                  })}
                </div>
              </section> : <section>
                <h3 className="bill4-h"><b>1</b>รายการในใบแจ้งหนี้แรกเข้า</h3>
                {b.items.length ? <ul className="bill4-lines">
                  {b.items.map((i, k) => <li key={k} className={i.credit ? "is-credit" : ""}><span>{i.desc}{i.vat ? <small> · VAT {i.vat}%</small> : null}{!i.credit && i.qty !== 1 ? <small> × {i.qty}</small> : null}</span><b>{i.credit ? `-${money(lineAmount(i))}` : money(lineNet(i))}</b></li>)}
                </ul> : <p className="rounded-xl bg-cream-50 px-4 py-3 text-sm text-gold-600">สัญญานี้ยังไม่มีค่าบริการ · ไม่มีใบแจ้งหนี้ให้ออก</p>}
                <p className="field-hint mt-2">แก้รายการ ยอดล่วงหน้า เงินประกัน หรือหักมัดจำห้อง ได้ที่ขั้นที่ 2 ค่าใช้จ่าย</p>
              </section>}
              {b.items.length > 0 && <section>
                <h3 className="bill4-h"><b>2</b>รับเงินอย่างไร</h3>
                <div role="radiogroup" aria-label="วิธีออกใบแจ้งหนี้" className={`opt-cards ${modes.length > 3 ? "is-2" : ""}`}>
                  {modes.map(([k, t2, sub, icon]) => (
                    <button key={k} type="button" role="radio" aria-checked={billMode === k} onClick={() => setBillMode(k)} className={`opt-card ${billMode === k ? "is-on" : ""}`}>
                      <span className="opt-ico" aria-hidden="true"><Icon name={icon} className="h-5 w-5" /></span>
                      <span className="min-w-0"><b>{t2}</b><small>{sub}</small></span>
                      <span className="opt-dot" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </section>}
              {billMode === "pay" && b.items.length > 0 && <section>
                <h3 className="bill4-h"><b>3</b>ช่องทางชำระ</h3>
                <div role="radiogroup" aria-label="ช่องทางชำระ" className="pay-cards">
                  {PAY_METHODS.map((m) => (
                    <button key={m} type="button" role="radio" aria-checked={payBy.method === m} onClick={() => setPayBy({ ...payBy, method: m })} className={`pay-card ${payBy.method === m ? "is-on" : ""}`}>
                      <Icon name={m === "เงินสด" ? "receipt" : m === "โอนเงิน" ? "building" : "id"} className="h-4 w-4" />{m === "โอนเงิน" ? "โอนเข้าบัญชีบริษัท" : m}
                    </button>
                  ))}
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <Field label="วันที่รับเงิน"><input type="date" value={payBy.date} max={todayIso()} onChange={(e) => setPayBy({ ...payBy, date: e.target.value })} /></Field>
                  {payBy.method === "โอนเงิน" && <Field label="หลักฐานการโอนเงิน" required className="md:col-span-2"><PhotoPicker value={payBy.slip} onChange={(v) => setPayBy({ ...payBy, slip: v })} label="ถ่ายหรือเลือกรูปสลิป" /></Field>}
                </div>
              </section>}
              {p4 && <FormCallout focus="step" title={p4} />}
              {live3 && liveBox(live3)}
            </div>

            <aside className="bill4-sum" aria-label="สรุป">
              <p className="bill4-sum-t">{booking ? "สรุปการจอง" : "สรุปใบแจ้งหนี้แรกเข้า"}</p>
              <dl>
                <div><dt>ผู้เข้าพัก</dt><dd>{finalName}</dd></div>
                <div><dt>ผู้ว่าจ้าง</dt><dd>{r[3]}</dd></div>
                <div><dt>สาขา</dt><dd>{r[1]}</dd></div>
                <div><dt>ห้อง</dt><dd>{chosen === NO_ROOM ? "ยังไม่เลือก" : chosen}</dd></div>
                <div><dt>{booking ? "เข้าพัก" : "เริ่มสัญญา"}</dt><dd>{start ? docDate(start) : "ยังไม่กำหนด"}</dd></div>
              </dl>
              <div className="bill4-total">
                {vat > 0 && <p><span>รวม VAT</span><span>{money(vat)}</span></p>}
                <p className="is-big"><span>ยอดที่ต้องชำระ</span><b>{money(t.net)}</b></p>
                {!booking && parts > 1 && t.net > 0 && <ol className="bill4-parts">{splitInstallments(t.net, parts).map((x, k) => <li key={k}><span>งวดที่ {k + 1}</span><span>{money(x)}</span></li>)}</ol>}
                <span className={`bill4-out ${billMode === "pay" && b.items.length ? "is-pay" : ""}`}>{outcome}</span>
              </div>
              {booking && <ul className="bill4-terms">
                <li>เข้าพักภายใน 20 วันหลังวางมัดจำ ไม่เข้าพัก = ไม่คืนมัดจำทุกกรณี</li>
                <li>เลือกห้องแล้ว ต้องเข้าพักภายใน 15 วัน</li>
                <li>ยอดมัดจำหักในใบแรกเข้าตอนกด &quot;เปิดสัญญา&quot;</li>
              </ul>}
            </aside>

            <div className="bill4-foot">
              <button type="button" className="btn-soft" onClick={() => goStep(3)}>ย้อนกลับไปเลือกห้อง</button>
              <button type="button" className="btn-primary" onClick={save}>
                {booking ? "บันทึกการจอง" : "บันทึกสัญญา"}{b.items.length && billMode === "pay" ? " และรับชำระ" : b.items.length && billMode !== "none" ? " และออกใบแจ้งหนี้" : ""}
              </button>
            </div>
          </div>
        );
      })()}
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
  /** ทะเบียนสัญญา หรือ สรุปการเปิดสัญญา รายวัน/เดือน/ปี */
  const [page, setPage] = useState<"list" | "summary">("list");
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
  /** เปิดสัญญาเต็มจากสัญญาที่จองห้องไว้ (มัดจำค่าห้อง) · ลำดับแถวในทะเบียน */
  const [complete, setComplete] = useState<number | null>(null);
  // มาจากปุ่ม "เปิดสัญญา" ในหน้าห้องพัก (รอข้อมูลสัญญาโหลดก่อน)
  const [completeFor, setCompleteFor] = useState(() => contractHandoff.take());
  useEffect(() => {
    if (!completeFor) return;
    const i = ids.indexOf(completeFor);
    if (i >= 0) { setCompleteFor(null); setComplete(i); window.scrollTo(0, 0); }
  }, [completeFor, ids]);
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
  const [doc, setDoc] = useState<null | { kind: "contract"; i: number; copy?: boolean } | { kind: "renew"; before: string[]; after: string[] } | { kind: "dc"; d: DcData; branch: string } | { kind: "deposit"; id: string }>(null);
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
  /** สาขาของใบแจ้งหนี้ (หน้าจอไม่มีช่องสาขา): จากสัญญาของใบ หรือผู้รับบริการชื่อนั้น · แบบเดียวกับหน้าใบแจ้งหนี้และใบเสร็จ */
  const invBranch = (x: Invoice) => invoiceBranch(x, rows, res.rows, user?.branch);
  /** ใบค้างชำระของสัญญา c: ใบของสัญญานี้ + ใบที่ไม่ผูกสัญญาของคนนี้ในสาขาเดียวกัน (มี HN = เทียบ HN) · ไม่รวมคนชื่อซ้ำต่างสาขา */
  const owingOf = (c: string[]) => {
    const hn = resOf(c)?.row[6] ?? "";
    return invoices.filter((x) => isOpen(x) && ((!!c[0] && x.contract === c[0]) || (x.who === c[2] && (!x.contract || !rows.some((k) => k[0] === x.contract && k[1] !== c[1])) && (x.hn && hn ? x.hn === hn : invBranch(x) === c[1]))));
  };

  /**
   * สัญญาใหม่ / ต่อสัญญา: เพิ่มหรืออัปเดตผู้รับบริการพร้อมห้องก่อน (server ออก HN ให้) แล้วจึงบันทึกสัญญา
   * มีค่าบริการล่วงหน้า/เงินประกัน = ออกใบแจ้งหนี้ให้ที่เมนูใบแจ้งหนี้และใบเสร็จ · รอชำระมัดจำ = จองห้องไว้ก่อน
   */
  const create = (r: string[], photos: IdPhotos, bill: BillChoice): string[] | void => {
    const oldId = renew !== null ? ids[renew] : undefined;
    // เปิดสัญญาเต็มจากสัญญาที่จองไว้: บันทึกทับแถวเดิม (เลขที่สัญญาเดิม) ไม่สร้างสัญญาใหม่
    const doneI = complete !== null && rows[complete] ? complete : null;
    // กันสัญญาซ้อน: เปิดสัญญาใหม่ให้คนที่มีสัญญาใช้งานอยู่/รอชำระมัดจำในสาขานี้แล้วไม่ได้ (ฟอร์มตรวจแล้ว ตรวจซ้ำกันข้อมูลเพิ่งโหลด)
    //  คืนสัญญาเดิมให้ฟอร์มแสดงกล่องแจ้งค้างไว้ พร้อมปุ่มต่อสัญญาฉบับเดิม
    const live = renew === null ? rows.find((c, k) => k !== doneI && norm(c[2] ?? "") === norm(r[2]) && c[1] === r[1] && isLive(c)) : undefined;
    if (live) return live;
    const j = resIndex(r[2], r[1]);
    const p0 = j >= 0 ? res.rows[j] : undefined;
    // คนที่ยังพักอยู่ (เข้าอยู่ / แอดมิท รพ.) คงสถานะเดิม เช่น ต่อสัญญาระหว่างแอดมิทยังเป็นแอดมิท · คนใหม่/กลับมาพักใหม่ ตามสถานะสัญญา
    const status = p0 && /^(เข้าอยู่|แอดมิท)/.test(p0[5] ?? "") ? p0[5] : r[5] === "รอชำระเงินมัดจำ" ? "มัดจำ (จองห้อง)" : "เข้าอยู่ (Active)";
    // ต่อสัญญาแบบไม่เลือกห้อง แต่ยังพักห้องเดิม: ห้องในสัญญาใหม่ = ห้องปัจจุบัน (ใบแจ้งหนี้/เอกสารพิมพ์ห้องถูก)
    if (r[6] === NO_ROOM && p0 && staying(p0[5] ?? "") && p0[2] && p0[2] !== NO_ROOM) r = r.map((x, k) => (k === 6 ? p0[2] : x));
    const info = r[6] === NO_ROOM ? undefined : findRoom(roomInfos(rooms.rows, res.rows), r[1], r[6]);
    if (p0) {
      const p = p0;
      const bed = r[6] === NO_ROOM ? p[7] ?? "" : p[2] === r[6] && p[7] ? p[7] : freeBed(info, p[0]);
      res.update(j, [p[0], r[13] || p[1], r[6] === NO_ROOM ? p[2] : r[6], p[3], p[4], status, p[6] ?? "", bed]);
    } else res.add([r[2], r[13] || "-", r[6], r[1], "", status, "", freeBed(info)]);
    let id: string;
    if (doneI !== null) { id = ids[doneI]; update(doneI, r); } else id = add(r);
    if (photos.employer || photos.resident || oldId) uploadIdCards(id, { ...(photos.employer ? { employer: photos.employer } : {}), ...(photos.resident ? { resident: photos.resident } : {}), ...(oldId ? { copyFrom: oldId } : {}) });
    if (renew !== null) { const old = rows[renew]; update(renew, old.map((x, k) => (k === 5 ? "สิ้นสุดสัญญา" : x))); setDoc({ kind: "renew", before: old, after: r }); }
    // ใบแจ้งหนี้จากขั้นที่ 4 (ใบแรกเข้า / ใบมัดจำค่าห้อง) · ตรวจรายการในฟอร์มแล้ว จึงออกเป็นค้างชำระได้เลย
    const inv: Invoice | null = bill.mode !== "none" && bill.items.length ? { id: newId(), date: todayIso(), who: r[2], hn: j >= 0 ? res.rows[j][6] ?? "" : "", payer: r[3], address: r[10] ?? "", kind: BILL_KINDS[0], contract: r[0], items: JSON.stringify(bill.items), ...totals(bill.items), status: bill.mode === "draft" ? DRAFT : UNPAID, note: bill.note } : null;
    if (inv) setInvoices([inv, ...invoices]);
    if (inv && bill.mode === "pay" && bill.pay) payNow(inv, bill.pay, bill.booking);
    if (fromQuote) { const k = quotes.ids.indexOf(fromQuote.quoteId); if (k >= 0) quotes.update(k, quotes.rows[k].map((x, n) => (n === 12 ? `เปิดสัญญาแล้ว ${docDate(todayIso())}` : x))); setFromQuote(null); }
    setCreating(false); setRenew(null); setComplete(null);
    // จองห้อง: เปิดเอกสารการมัดจำค่าห้องพักให้พิมพ์ทันที
    if (bill.booking) setDoc({ kind: "deposit", id });
    const what = bill.booking ? "บันทึกการจองแล้ว" : renew !== null ? "ต่อสัญญาแล้ว" : doneI !== null ? "เปิดสัญญาแล้ว" : "บันทึกสัญญาแล้ว";
    toast(`${what} · ${r[2]}${r[6] === NO_ROOM ? " (ยังไม่มีห้อง)" : ` ห้อง ${r[6]}`}${inv ? bill.mode === "pay" ? ` · กำลังรับชำระ ${money(inv.net)} บาท` : ` · ออกใบแจ้งหนี้ ${money(inv.net)} บาทที่เมนูใบแจ้งหนี้และใบเสร็จแล้ว${inv.status === DRAFT ? ` (${DRAFT})` : ""}` : ""}`);
  };
  /**
   * รับชำระเต็มจำนวนจากขั้นที่ 4 (ออกเป็นใบเสร็จ) · ใบแจ้งหนี้เพิ่งส่งขึ้นระบบ อาจยังไม่ถึง (404) ลองซ้ำก่อนแจ้งว่าไม่สำเร็จ
   *  สำเร็จ: จองห้อง = เอกสารมัดจำที่เปิดอยู่ติ๊กช่องทางชำระให้เอง · สัญญา = ถามเปิดใบเสร็จเพื่อพิมพ์
   */
  const payNow = async (inv: Invoice, p: PayNow, booking: boolean) => {
    const n = installmentsOf(inv.note), amt = n > 1 ? splitInstallments(inv.net, n)[0] : inv.net;
    const body = { op: "pay", id: inv.id, cash: p.method === "เงินสด" ? amt : 0, credit: p.method === "บัตรเครดิต" ? amt : 0, transfer: p.method === "โอนเงิน" ? amt : 0, date: p.date, slip: p.method === "โอนเงิน" ? p.slip : undefined, note: booking ? "มัดจำค่าห้อง" : "รับชำระตอนเปิดสัญญา" };
    const send = () => fetch("/api/billing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    try {
      let r = await send();
      for (let i = 0; i < 6 && r.status === 404; i++) { await new Promise((x) => setTimeout(x, 1500)); r = await send(); }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "รับชำระไม่สำเร็จ");
      refreshData("invoices");
      if (booking) return toast(`รับชำระมัดจำแล้ว ${money(amt)} บาท · ${inv.who} · พิมพ์ใบเสร็จได้ที่ปุ่ม "เปิดใบเสร็จ"`);
      confirm({ title: "รับชำระแล้ว", okLabel: "เปิดใบเสร็จ",
        message: `รับชำระ${n > 1 ? `งวดที่ 1/${n}` : ""} ${money(amt)} บาท (${p.method}) ของ ${inv.who} แล้ว ออกเป็นใบเสร็จรับเงิน${n > 1 ? ` · งวดถัดไปรับที่หน้าใบแจ้งหนี้และใบเสร็จ` : ""} · ต้องการเปิดใบเสร็จเพื่อพิมพ์เลยหรือไม่`,
        onOk: () => { invoiceHandoff.set(inv.id); go("billing"); } });
    } catch (e) { toast(`${(e as Error).message} · ออกใบแจ้งหนี้ไว้แล้ว รับชำระต่อที่หน้าใบแจ้งหนี้และใบเสร็จ`); }
  };
  /** ใบแรกเข้าที่จะออกในขั้นที่ 4 · ใบเดิมของสาขาเดียวกัน: ต่อสัญญาที่เคยหักมัดจำห้อง (AD-01) ไปแล้ว ไม่หักซ้ำ */
  const billPreview = (r: string[]) => {
    const prior = invoices.filter((x) => invBranch(x) === r[1]);
    // เปิดสัญญาจากที่จองไว้ แต่ออกใบแรกเข้าไปแล้ว (ไม่นับใบมัดจำห้อง) = ไม่ต้องออกซ้ำ
    const had = r[0] ? invoices.find((x) => x.contract === r[0] && x.status !== VOID && isStartInvoice(x)) : undefined;
    return { items: contractStartLines(r, prior), note: contractStartNote(r, prior), has: had ? had.no || "ที่ออกไว้" : "" };
  };

  const ended = (c: string[]) => c[5] === CANCELLED || c[5] === "สิ้นสุดสัญญา";
  /** ปุ่มหลักของแถวสัญญา: deposit = ออกใบแจ้งหนี้ (รอชำระมัดจำ ยังไม่มีใบ) · month = ออกใบเดือนนี้ · print = พิมพ์สัญญา · none = ไม่มี */
  const primaryOf = (c: string[]): "complete" | "deposit" | "month" | "print" | "none" => {
    if (ended(c)) return "none";
    // จองห้องด้วยมัดจำค่าห้อง ยังไม่ได้กรอกค่าบริการ = ปุ่ม "เปิดสัญญา" (กรอกให้ครบ)
    if (isBookingRow(c)) return "complete";
    const bills = invoices.filter((x) => x.contract === c[0] && x.status !== VOID);
    if (can(user, "billing") && c[5] === "รอชำระเงินมัดจำ" && !bills.length) return "deposit";
    // ครบรอบบิลแล้วหรือภายใน 7 วัน ยังไม่มีใบของรอบนั้น (นับตามวันเริ่มสัญญาและเดือนที่ชำระล่วงหน้า · lib/servicePeriod nextCycle)
    if (can(user, "billing") && c[5] === "ใช้งานอยู่" && cycleDue(nextCycle(c, bills))) return "month";
    return "print";
  };
  /** ออกใบแจ้งหนี้ตามสัญญา: ไปหน้าใบแจ้งหนี้และใบเสร็จพร้อมรายการในสัญญา (แก้/เพิ่มได้ก่อนบันทึก) · มีใบค้างชำระอยู่แล้ว ถามก่อน */
  const billContract = (i: number) => {
    const c = rows[i], open = invoices.filter((x) => x.contract === c[0] && (isOpen(x) || x.status === DRAFT));
    const goBill = () => { billHandoff.set(ids[i]); go("billing"); };
    if (!open.length) return goBill();
    confirm({ title: "ออกใบแจ้งหนี้", okLabel: "ออกใบใหม่", message: `สัญญา ${c[0]} มีใบแจ้งหนี้ที่ยังชำระไม่ครบ ${open.length} ใบ (${open.map((x) => x.no ?? "").filter(Boolean).join(", ") || "กำลังออกเลข"}) ต้องการออกใบใหม่อีกใบหรือไม่ · ถ้าจะรับเงินใบเดิม ให้กด รับชำระ ที่หน้าใบแจ้งหนี้และใบเสร็จ`, onOk: goBill });
  };

  /**
   * สัญญาที่เปิดจากใบเสนอราคาถูกยกเลิก: ล้าง "เปิดสัญญาแล้ว" ในใบเสนอราคา ให้กดเปิดสัญญาจากใบนั้นได้อีกครั้ง
   *  หาใบจากหมายเหตุสัญญา "เปิดจากใบเสนอราคา QT-…" (ใส่ให้ตอนเปิดสัญญา) · ไม่มีเลขที่ = ใบที่เปิดสัญญาแล้วของชื่อนี้ ถ้ามีใบเดียว · คืนเลขที่ใบที่ล้าง
   */
  const reopenQuote = (c: string[]) => {
    const no = String(c[20] ?? "").match(/เปิดจากใบเสนอราคา\s+(QT-[\w-]+)/)?.[1];
    const opened = (q: string[]) => /^เปิดสัญญาแล้ว/.test(q[12] ?? "");
    const hits = quotes.rows.map((q, k) => ({ q, k })).filter(({ q }) => opened(q) && (no ? q[6] === no : /เปิดจากใบเสนอราคา/.test(c[20] ?? "") && q[1] === c[2]));
    if (hits.length !== 1) return "";
    const { q, k } = hits[0];
    quotes.update(k, q.map((x, n) => (n === 12 ? "-" : x)));
    return q[6] || "ของ " + q[1];
  };

  /**
   * สัญญาแบบเดิม (ค่าห้อง + VAT บวกเพิ่ม) → แบบใหม่: ค่าห้องเดิมเป็นราคารวม VAT · ค่าห้อง 15,000 (มี VAT) + ค่าบริการทางการแพทย์ส่วนที่เหลือ
   *  ใบที่ยังไม่ได้รับเงิน (ค้างชำระ / รอตรวจสอบยอด) ของสัญญานี้ปรับบรรทัดค่าห้องตาม · ใบที่รับเงินแล้วไม่เปลี่ยน (ออกใบลดหนี้แทน)
   */
  const repriceRoom = (i: number) => {
    const c = rows[i], part = roomShareOf(Number(String(c[4] ?? "").replace(/,/g, "")) || 0), x = splitOldRoom(c, part);
    const open = invoices.filter((v) => v.contract === c[0] && (v.status === UNPAID || v.status === DRAFT) && !(v.paid ?? 0) && parseItems(v.items).some((l) => l.vat && !l.credit));
    const paidN = invoices.filter((v) => v.contract === c[0] && (v.paid ?? 0) > 0).length;
    const vat = Math.round((x.part - baseOfIncl(x.part, x.rate)) * 100) / 100;
    confirm({
      title: "ปรับเป็นราคาห้องรวม VAT", okLabel: "ปรับราคา",
      message: `สัญญา ${c[0]} ${c[2]}: ค่าห้อง ${money(x.total)} บาท/เดือน จะถือเป็นราคารวม VAT แล้ว (เดิมบวก VAT เพิ่มอีก ${money(Math.round(x.total * x.rate) / 100)}) · แยกเป็นค่าห้อง ${money(x.part)} (รวม VAT ${money(vat)}) + ค่าบริการทางการแพทย์ ${money(x.med)} (ไม่มี VAT)${open.length ? ` · ใบที่ยังไม่ชำระ ${open.length} ใบ (${open.map((v) => v.no ?? "").filter(Boolean).join(", ")}) ปรับยอดตาม` : ""}${paidN ? ` · ใบที่รับเงินแล้ว ${paidN} ใบไม่เปลี่ยน ถ้าต้องคืนส่วนต่างให้ออกใบลดหนี้` : ""}`,
      onOk: () => {
        update(i, x.row);
        if (open.length) setInvoices(invoices.map((v) => { if (!open.includes(v)) return v; const its = splitOldRoomLines(parseItems(v.items), part); return { ...v, items: JSON.stringify(its), ...totals(its) }; }));
        toast(`ปรับราคาห้องแล้ว · ${c[0]} ${c[2]} · ค่าห้อง ${money(x.part)} + ค่าบริการทางการแพทย์ ${money(x.med)}${open.length ? ` · ปรับใบที่ยังไม่ชำระ ${open.length} ใบ` : ""}`);
      },
    });
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
        // ย้ายออก = server ปิดลิงก์ครอบครัวที่ยังใช้ได้ให้ด้วย (api/data residents)
        if (stay) setResident(j, NO_ROOM, "ย้ายออก (Inactive)");
        if (bills.length) setInvoices(invoices.map((x) => (bills.includes(x) ? { ...x, status: VOID } : x)));
        const q = reopenQuote(c);
        toast(`ยกเลิกสัญญาแล้ว · ${c[0]} · ${c[2]}${q ? ` · ใบเสนอราคา ${q} เปิดสัญญาใหม่ได้อีกครั้ง` : ""}`);
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
    // ย้ายออกเมื่อไม่มีสัญญาอื่นที่ยังใช้งาน (เหมือนยกเลิกสัญญา) · server ปิดลิงก์ครอบครัวให้ตอนย้ายออก
    const other = rows.some((x, k) => k !== dc.i && x[2] === c[2] && x[1] === c[1] && isLive(x));
    if (j >= 0 && !other) setResident(j, NO_ROOM, "ย้ายออก (Inactive)");
    setDc(null);
    toast(other ? `D/C แล้ว · ${c[0]} · ${c[2]} ยังมีสัญญาอื่นที่ใช้งานอยู่ จึงยังไม่ย้ายออก` : `D/C แล้ว · ${c[2]} · คืนห้อง${c[6] && c[6] !== NO_ROOM ? ` ${c[6]}` : ""}ให้ว่าง`);
    openDc(c, dc.date, dc.reason);
  };

  /** ใบจำหน่าย: สัญญาณชีพล่าสุด ยาที่ใช้อยู่ นัดถัดไป จากประวัติผู้รับบริการ · ยอดค้างจากหน้าใบแจ้งหนี้และใบเสร็จ */
  const openDc = async (c: string[], date: string, reason: string) => {
    const r = resOf(c);
    const start = c[7] ? c[7].split("/") : [];
    const startIso = start.length === 3 ? `${Number(start[2]) - 543}-${start[1].padStart(2, "0")}-${start[0].padStart(2, "0")}` : "";
    const days = startIso ? Math.max(0, Math.round((new Date(date).getTime() - new Date(startIso).getTime()) / 864e5)) : undefined;
    const base: DcData = { contract: c, hn: r?.row[6], age: r?.row[1] && r.row[1] !== "-" ? r.row[1] : c[13], date, reason, days, chronic: r?.row[4], vitals: null, meds: [], nextAppt: null,
      owing: owingOf(c).reduce((n, x) => n + balanceOf(x), 0), deposit: Number(String(c[19] ?? "").replace(/,/g, "")) || 0,
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

  /**
   * แก้สัญญา: เปลี่ยนห้อง = ย้ายผู้รับบริการตาม
   *  ผู้รับบริการและสาขากำหนดตอนเปิดสัญญา แก้ที่นี่ไม่ได้ (server ผูกสัญญากับผู้รับบริการจากชื่อ แก้ชื่อแล้วสัญญาจะหลุด)
   *  สิ้นสุด / ยกเลิกสัญญา ต้องทำผ่านปุ่ม D/C กลับบ้าน หรือ ยกเลิกสัญญา (ย้ายออก คืนห้อง ยกเลิกใบค้าง ปิดลิงก์ครอบครัว)
   *  รอชำระมัดจำ → ใช้งานอยู่ โดยใบแรกเข้ายังไม่ได้ชำระ = ถามยืนยันก่อน
   */
  const edit = (i: number, v: string[]) => {
    v = v.map((x, k) => ([8, 9, 12].includes(k) ? (x ?? "").replace(/[\s-]/g, "") : x));
    const bad = idPhoneProblem(v);
    if (bad) return toast(bad);
    const before = rows[i];
    v = v.map((x, k) => (k === 1 || k === 2 ? before[k] : x));
    if (v[5] !== before[5] && (v[5] === CANCELLED || v[5] === "สิ้นสุดสัญญา")) return toast(v[5] === CANCELLED ? `ยกเลิกสัญญาใช้ปุ่ม "ยกเลิกสัญญา" ในเมนู ⋯ ของสัญญานี้ (ระบบคืนห้องและยกเลิกใบแจ้งหนี้ที่ยังไม่ชำระให้)` : `สิ้นสุดสัญญาใช้ปุ่ม "D/C กลับบ้าน" ในเมนู ⋯ ของสัญญานี้ (ระบบย้ายออก คืนห้อง และพิมพ์ใบจำหน่ายให้)`);
    if (ended(before) && v[5] !== before[5]) return toast(`สัญญานี้${before[5]}แล้ว เปลี่ยนสถานะไม่ได้ · ถ้าจะกลับมาพักอีกครั้ง ให้เปิดสัญญาใหม่`);
    const activating = v[5] === "ใช้งานอยู่" && before[5] === "รอชำระเงินมัดจำ";
    const startPaid = !!before[0] && invoices.some((x) => x.contract === before[0] && isStartInvoice(x) && x.status === PAID);
    if (activating && !startPaid) return confirm({
      title: "เปลี่ยนเป็นใช้งานอยู่", okLabel: "ยืนยันเปลี่ยนสถานะ",
      message: `ใบแจ้งหนี้แรกเข้าของสัญญา ${before[0] || ""} (มัดจำ / ค่าบริการล่วงหน้า) ยังไม่ได้รับชำระ${invoices.some((x) => x.contract === before[0] && x.status !== VOID && isStartInvoice(x)) ? "" : " หรือยังไม่ได้ออกใบ"} · ปกติเมื่อรับชำระใบแรกเข้าครบ ระบบจะถามเปลี่ยนเป็นใช้งานอยู่ให้เอง · ต้องการเปลี่ยนเป็นใช้งานอยู่และให้เข้าพักโดยยังไม่ได้รับเงินใช่หรือไม่`,
      onOk: () => applyEdit(i, v),
    });
    applyEdit(i, v);
  };
  const applyEdit = (i: number, v: string[]) => {
    const before = rows[i];
    const j = resIndex(v[2], v[1]);
    const roomChanged = norm(v[6] || NO_ROOM) !== norm(before[6] || NO_ROOM) && norm(v[6] || NO_ROOM) !== NO_ROOM;
    let room = j >= 0 ? res.rows[j][2] : NO_ROOM;
    if (roomChanged) {
      const info = findRoom(roomInfos(rooms.rows, res.rows), v[1], v[6]);
      if (!info) return toast(`ไม่พบห้อง ${v[6]} ในสาขา${v[1]} สร้างห้องที่เมนูห้องพักและเตียงก่อน`);
      const problem = roomProblem(info, v[2]);
      if (problem) return toast(problem);
      v = v.map((x, k) => (k === 6 ? info.no : x));
      room = info.no;
    }
    // ชำระมัดจำแล้ว (รอชำระ → ใช้งานอยู่): เปลี่ยนจากจองห้องเป็นเข้าพัก · ย้ายห้องและเปลี่ยนสถานะบันทึกครั้งเดียว
    const checkIn = v[5] === "ใช้งานอยู่" && before[5] === "รอชำระเงินมัดจำ" && j >= 0 && res.rows[j][5].startsWith("มัดจำ");
    if (j >= 0 && (roomChanged || checkIn)) setResident(j, room, checkIn ? "เข้าอยู่ (Active)" : undefined);
    update(i, v); setDlg(null);
    toast(roomChanged ? `ย้ายห้องแล้ว · ${v[2]} · ไปห้อง ${v[6]}` : `แก้ไขสัญญาแล้ว · ${v[0] || ""} ${v[2]}`.trim());
  };

  /** แถวสัญญาที่ฟอร์มส่งกลับมา → ลำดับในทะเบียน (ข้อมูลโหลดใหม่ระหว่างนั้น = หาจากเลขที่สัญญา) */
  const contractIndex = (c: string[]) => { const i = rows.indexOf(c); return i >= 0 || !c[0] ? i : rows.findIndex((x) => x[0] === c[0]); };
  // ชื่อนี้มีสัญญาใช้งานอยู่แล้ว: ปิดฟอร์มใหม่ แล้วเปิดฟอร์มต่อสัญญาของสัญญาเดิม (เหมือนกด "ต่อสัญญา" ในทะเบียน) / เปิดดูรายละเอียดสัญญาเดิม
  //  key เปลี่ยน = ฟอร์มเริ่มใหม่ด้วยข้อมูลสัญญาเดิม
  const done = complete !== null ? rows[complete] : undefined;
  if (creating || renew !== null || done)
    return <ContractForm key={renew !== null ? `renew-${renew}` : done ? `complete-${complete}` : "new"} rooms={rooms.rows} residents={res.rows} contracts={rows}
      initial={renew !== null ? rows[renew] : done ?? fromQuote?.prefill} fromQuote={fromQuote && !done ? fromQuote.quoteNo : undefined}
      completing={!!done} paidDeposit={done ? bookingPaid(done, invoices) : 0} bookedDeposit={done ? Number(String(done[27] ?? "").replace(/,/g, "")) || 0 : 0}
      canPay={can(user, "billing")} billPreview={billPreview}
      onClose={() => { setCreating(false); setRenew(null); setComplete(null); setFromQuote(null); }} onSave={create}
      onRenew={(c) => { const i = contractIndex(c); if (i < 0) return; setCreating(false); setComplete(null); setFromQuote(null); setRenew(i); window.scrollTo(0, 0); }}
      onView={(c) => { const i = contractIndex(c); if (i < 0) return; setCreating(false); setRenew(null); setComplete(null); setFromQuote(null); setDlg({ mode: "view", i }); }} />;
  const dcRow = dc ? rows[dc.i] : null;
  /** เอกสารการมัดจำค่าห้องพัก: สัญญาที่จอง + ใบมัดจำล่าสุด (ช่องทางชำระจากการรับเงิน) */
  const depRow = doc?.kind === "deposit" ? rows[ids.indexOf(doc.id)] : undefined;
  const depInv = depRow ? bookingInvoiceOf(depRow, invoices) : undefined;
  const dcRes = dcRow ? res.rows[resIndex(dcRow[2], dcRow[1])] : undefined;
  const owing = dcRow ? owingOf(dcRow) : [];
  const unbilledN = unbilled ? unbilled.meds + unbilled.supplies + unbilled.courses + unbilled.sessions : 0;
  /** เงินประกันที่รับไว้จริงของสัญญา: บรรทัด "เงินประกัน" ในใบที่ชำระแล้ว */
  function depositPaidOf(no: string) {
    return invoices.filter((x) => x.contract === no && x.status === PAID).reduce((n, x) => n + parseItems(x.items).filter((i) => i.desc.trim().startsWith("เงินประกัน")).reduce((m, i) => m + lineNet(i), 0), 0);
  }
  const dcMoney = dcRow ? { owing: owing.reduce((n, x) => n + balanceOf(x), 0), depositPaid: depositPaidOf(dcRow[0]), unbilled: unbilled?.sum ?? 0 } : null;
  /** ออกใบสรุปค่าใช้จ่ายก่อนกลับบ้าน: ไปหน้าใบแจ้งหนี้และใบเสร็จ ดึงรายการที่ยังไม่เรียกเก็บเข้าใบให้ (กลับมากด D/C ต่อได้) */
  const billDc = () => { if (!dc) return; billHandoff.set(ids[dc.i], true, dc.date); setDc(null); go("billing"); };
  /**
   * ช่องในกล่องแก้ไขสัญญา: สาขาและผู้รับบริการอ่านอย่างเดียว (กำหนดตอนเปิดสัญญา)
   *  สถานะเลือกได้แค่ ใช้งานอยู่ / รอชำระมัดจำ · สิ้นสุด/ยกเลิกใช้ปุ่ม D/C หรือ ยกเลิกสัญญา · สัญญาที่จบแล้วเปลี่ยนสถานะไม่ได้
   */
  const editFields = (c?: string[]) => withBranches(CONTRACT_FIELDS, branchNames).map((f, k) =>
    k === 1 || k === 2 ? { ...f, readOnly: true }
    : k === 5 ? (c && ended(c) ? { ...f, readOnly: true } : { ...f, label: "สถานะ (สิ้นสุดใช้ปุ่ม D/C กลับบ้าน · ยกเลิกใช้ปุ่มยกเลิกสัญญา)", options: LIVE_CONTRACT })
    : f);
  const shown = rows.map((r, i) => ({ r, i })).filter(({ r }) => filter.startsWith("ทั้งหมด") || r[5] === filter);
  /** ส่งออกทะเบียนสัญญาตามแท็บที่เลือก (ผู้จัดการขึ้นไป) · มีเลขบัตรประชาชนและที่อยู่ จึงบันทึกในบันทึกการใช้งานระบบทุกครั้ง */
  const boss = user?.role === "Branch Admin" || user?.role === "Global Admin";
  const exportContracts = () => {
    const n = contractsCsv(shown.map(({ r }) => r), `ทะเบียนสัญญา-${filter}-${todayIso()}`);
    toast(`ส่งออกทะเบียนสัญญาแล้ว ${n} สัญญา · ไฟล์มีข้อมูลส่วนบุคคล เก็บให้ปลอดภัย`);
  };
  return (
    <>
      <PageHeader
        title="สัญญาบริการ"
        actions={<>
          <button className="btn-primary" onClick={() => setCreating(true)}><Icon name="plus" className="h-4 w-4" /> เปิดสัญญาใหม่ / มัดจำห้อง</button>
          {admin && <button className="btn-soft" onClick={() => setTermsDlg(terms)}><Icon name="doc" className="h-4 w-4" /> เงื่อนไขเพิ่มเติมในสัญญา</button>}
          {boss && <button className="btn-soft" disabled={!shown.length} onClick={exportContracts}><CsvIcon /> ส่งออก CSV</button>}
          <button className="btn-soft" onClick={() => setSample(true)}><Icon name="print" className="h-4 w-4" /> ตัวอย่าง สบส. (แบบฟอร์มเปล่า)</button>
        </>}
      />
      <div className="mb-4"><Tabs tabs={["ทะเบียนสัญญา", "สรุปการเปิดสัญญา"]} value={page === "list" ? "ทะเบียนสัญญา" : "สรุปการเปิดสัญญา"} onChange={(x) => setPage(x === "ทะเบียนสัญญา" ? "list" : "summary")} /></div>
      {page === "summary" && <ContractSummary rows={rows} onOpen={(i) => setDlg({ mode: "view", i })} />}
      {page === "list" && <Section title="ทะเบียนสัญญาบริการ">
        <StatFilter label="กรองสัญญา" value={filter} onChange={setFilter} items={[
          { k: "ทั้งหมด", t: "ทั้งหมด", n: rows.length, tone: "all" },
          { k: "ใช้งานอยู่", t: "ใช้งานอยู่", n: rows.filter((r) => r[5] === "ใช้งานอยู่").length, tone: "good" },
          { k: "รอชำระเงินมัดจำ", t: "รอชำระมัดจำ", n: rows.filter((r) => r[5] === "รอชำระเงินมัดจำ").length, tone: "warn" },
          { k: "สิ้นสุดสัญญา", t: "สิ้นสุดแล้ว", n: rows.filter((r) => r[5] === "สิ้นสุดสัญญา").length, tone: "muted" },
          ...(rows.some((r) => r[5] === CANCELLED) ? [{ k: CANCELLED, t: CANCELLED, n: rows.filter((r) => r[5] === CANCELLED).length, tone: "bad" as const }] : []),
        ]} />
        <DataTable
          columns={CONTRACT_COLS}
          rows={shown.map(({ r }) => [r[0] || "กำลังออกเลข…", r[1], r[2], r[6] || NO_ROOM, r[3], contractMonthTotal(r) ? money(contractMonthTotal(r)) : "-", r[5]])}
          onRow={(k) => setDlg({ mode: "view", i: shown[k].i })} rowLabel="กดเพื่อดูรายละเอียดสัญญา"
          actions={[
            // ปุ่มหลักปุ่มเดียวตามสถานะ: รอชำระมัดจำ (ยังไม่มีใบ) = ออกใบแจ้งหนี้ · ใช้งานอยู่แต่เดือนนี้ยังไม่ออกใบ = ออกใบเดือนนี้ · ใช้งานปกติ = พิมพ์สัญญา (ปุ่มรอง)
            { label: "เปิดสัญญา", tone: "primary", hidden: (k) => primaryOf(shown[k].r) !== "complete", onClick: (k) => { setComplete(shown[k].i); window.scrollTo(0, 0); } },
            { label: "ออกใบแจ้งหนี้", tone: "primary", hidden: (k) => primaryOf(shown[k].r) !== "deposit", onClick: (k) => billContract(shown[k].i) },
            { label: "ออกใบเดือนนี้", tone: "primary", hidden: (k) => primaryOf(shown[k].r) !== "month", onClick: (k) => billContract(shown[k].i) },
            { label: "พิมพ์สัญญา", tone: "ghost", hidden: (k) => primaryOf(shown[k].r) !== "print", onClick: (k) => setDoc({ kind: "contract", i: shown[k].i }) },
            { label: "รายละเอียด", more: true, onClick: (k) => setDlg({ mode: "view", i: shown[k].i }) },
            { label: "พิมพ์สัญญา", more: true, hidden: (k) => ["print", "complete"].includes(primaryOf(shown[k].r)), onClick: (k) => setDoc({ kind: "contract", i: shown[k].i }) },
            { label: "พิมพ์ใบมัดจำค่าห้อง", more: true, hidden: (k) => !bookingInvoiceOf(shown[k].r, invoices), onClick: (k) => setDoc({ kind: "deposit", id: ids[shown[k].i] }) },
            { label: "เปิดสัญญา (กรอกให้ครบ)", more: true, hidden: (k) => shown[k].r[5] !== WAIT_DEPOSIT || primaryOf(shown[k].r) === "complete", onClick: (k) => { setComplete(shown[k].i); window.scrollTo(0, 0); } },
            { label: "ออกใบแจ้งหนี้", more: true, hidden: (k) => !can(user, "billing") || ended(shown[k].r) || ["deposit", "month", "complete"].includes(primaryOf(shown[k].r)), onClick: (k) => billContract(shown[k].i) },
            { label: "แก้ไข", more: true, onClick: (k) => setDlg({ mode: "edit", i: shown[k].i }) },
            { label: "ปรับเป็นราคาห้องรวม VAT", more: true, hidden: (k) => ended(shown[k].r) || !isOldRoomPricing(shown[k].r) || !can(user, "billing"), onClick: (k) => repriceRoom(shown[k].i) },
            { label: "รูปบัตร", more: true, onClick: (k) => openCards(shown[k].i) },
            { label: "ต่อสัญญา", more: true, hidden: (k) => ended(shown[k].r) || isBookingRow(shown[k].r), onClick: (k) => setRenew(shown[k].i) },
            { label: "D/C กลับบ้าน", more: true, hidden: (k) => ended(shown[k].r), onClick: (k) => [CANCELLED, "สิ้นสุดสัญญา"].includes(shown[k].r[5]) ? toast("ไม่สามารถ D/C ได้ สัญญานี้สิ้นสุดหรือถูกยกเลิกแล้ว") : setDc({ i: shown[k].i, date: todayIso(), reason: DC_REASONS[0] }) },
            { label: "ยกเลิกสัญญา", danger: true, more: true, hidden: (k) => shown[k].r[5] === CANCELLED, onClick: (k) => cancel(shown[k].i) },
            ...(can(user, "contracts.delete") ? [{ label: "ลบ", danger: true, more: true, onClick: (k: number) => confirm({ title: "ลบสัญญา", message: `ต้องการลบสัญญา ${shown[k].r[0]} (${shown[k].r[2]}) ออกจากระบบใช่หรือไม่ ลบแล้วกู้คืนไม่ได้ (ดูย้อนหลังได้ที่บันทึกการใช้งานระบบ) ถ้าแค่ไม่ใช้สัญญานี้แล้ว แนะนำให้กด "ยกเลิกสัญญา" แทน`, danger: true, okLabel: "ลบ", onOk: () => { const c = shown[k].r; remove(shown[k].i); toast(`ลบสัญญาแล้ว · ${c[0] || ""} ${c[2]}`.trim()); } }) }] : []),
          ]}
        />
      </Section>}
      <ContractView r={dlg?.mode === "view" ? rows[dlg.i] : null} onClose={() => setDlg(null)}
        onEdit={() => dlg && setDlg({ mode: "edit", i: dlg.i })}
        onPrint={() => { if (dlg) { setDoc({ kind: "contract", i: dlg.i }); setDlg(null); } }}
        onBill={dlg && can(user, "billing") && !ended(rows[dlg.i]) ? () => { const i = dlg.i; setDlg(null); billContract(i); } : undefined} />
      <FormDialog
        open={dlg?.mode === "edit"} mode="edit" title="แก้ไขสัญญา"
        fields={editFields(dlg ? rows[dlg.i] : undefined)} value={dlg ? rows[dlg.i] : undefined} onClose={() => setDlg(null)}
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
          <p className="text-xs leading-6 text-gold-500 md:col-span-2">ข้อมูลส่วนบุคคล: การเปิดดูและเปลี่ยนรูปบันทึกไว้ในบันทึกการใช้งานระบบทุกครั้ง</p>
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
          {owing.length > 0 && <p role="alert" className="room-warn">ยังมียอดค้างชำระ {money(owing.reduce((n, x) => n + balanceOf(x), 0))} บาท ({owing.length} ใบ) เรียกเก็บที่เมนูใบแจ้งหนี้และใบเสร็จก่อนหรือหลัง D/C ได้</p>}
          <p className="text-xs text-gold-500">ระบบจะเปลี่ยนสัญญาเป็นสิ้นสุด เปลี่ยนผู้รับบริการเป็นย้ายออก คืนห้องให้ว่าง ปิดลิงก์ครอบครัว แล้วเปิดใบจำหน่ายให้พิมพ์</p>
        </div>}
      </Modal>
      <PrintModal open={!!doc} title={doc?.kind === "contract" ? "สัญญาจ้างดูแลผู้สูงอายุ หรือผู้มีภาวะพึ่งพิง" : doc?.kind === "renew" ? "บันทึกต่อท้ายสัญญา" : doc?.kind === "deposit" ? "เอกสารการมัดจำค่าห้องพัก" : "ใบจำหน่ายผู้รับบริการ (D/C)"} onClose={() => setDoc(null)}
        extra={doc?.kind === "contract" ? <button className="btn-soft" onClick={() => setDoc({ ...doc, copy: !doc.copy })}>{doc.copy ? "เปลี่ยนเป็นต้นฉบับ" : "เปลี่ยนเป็นสำเนา"}</button>
          : doc?.kind === "deposit" && depInv && can(user, "billing") ? <button className="btn-soft" onClick={() => { invoiceHandoff.set(depInv.id); setDoc(null); go("billing"); }}>{depInv.status === PAID ? "เปิดใบเสร็จ" : "ไปรับชำระ"}</button> : undefined}>
        {doc?.kind === "contract" && rows[doc.i] && <ContractDoc r={rows[doc.i]} hn={resOf(rows[doc.i])?.row[6]} bed={resOf(rows[doc.i])?.row[7]} chronic={resOf(rows[doc.i])?.row[4]} branch={branchInfo(rows[doc.i][1])} terms={terms} by={user?.name} copy={doc.copy} />}
        {doc?.kind === "renew" && <RenewDoc before={doc.before} after={doc.after} hn={resOf(doc.after)?.row[6]} branch={branchInfo(doc.after[1])} by={user?.name} />}
        {doc?.kind === "dc" && <DischargeDoc d={doc.d} branch={branchInfo(doc.branch)} by={user?.name} />}
        {doc?.kind === "deposit" && (depRow ? <DepositDoc r={depRow} inv={depInv} branch={branchInfo(depRow[1])} by={user?.name} /> : <p className="py-8 text-center text-sm text-gold-500">กำลังโหลด…</p>)}
      </PrintModal>
      <Modal open={termsDlg !== null} wide title="เงื่อนไขอื่น ๆ เพิ่มเติม (ข้อ 5.4 ในสัญญา)" onClose={() => setTermsDlg(null)}
        footer={<><button className="btn-soft" onClick={() => setTermsDlg(null)}>ยกเลิก</button><button className="btn-primary" onClick={saveTerms}>บันทึกเงื่อนไขเพิ่มเติม</button></>}>
        <p className="form-intro">เงื่อนไขเพิ่มเติม บรรทัดละ 1 ข้อ (ขึ้นในข้อ 5.4) · เว้นว่างได้</p>
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
  const { rows: conRows, ids: conIds } = useCrud("contracts", CONTRACTS);
  /** สัญญาของผู้รับบริการคนนี้ (ชื่อ + สาขา) · live = ใช้งานอยู่ / รอชำระมัดจำ */
  const contractsOf = (r: string[], live = false) => conRows.filter((c) => norm(c[2] ?? "") === norm(r[0]) && c[1] === r[3] && (!live || isLive(c)));
  const { confirm, toast, go } = useApp();
  const { user } = useSession();
  /** สัญญาที่จองห้องไว้ (รอชำระมัดจำ) ของคนนี้ · ต้องมีสิทธิ์เมนูสัญญา */
  //  เฉพาะคนที่สถานะ "มัดจำ (จองห้อง)" (คนที่เข้าอยู่/ย้ายออกแล้วแต่สัญญายังค้างสถานะเดิม ไม่แสดง ให้แก้ที่ทะเบียนสัญญา)
  const reservedOf = (r: string[]) => (can(user, "contracts") && (r[5] ?? "").startsWith("มัดจำ") ? contractsOf(r).find((c) => c[5] === WAIT_DEPOSIT) : undefined);
  const [sample, setSample] = useState(false);
  const [dlg, setDlg] = useState<Dlg>(null);
  const [profile, setProfile] = useState<string | null>(null);
  const [family, setFamily] = useState<string | null>(null);
  const [hub, setHub] = useState(false);
  const [roomF, setRoomF] = useState("");
  const [statusF, setStatusF] = useState("");
  const canDelete = user?.role === "Global Admin" || user?.role === "Branch Admin";
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
        actions={<><button className="btn-soft" onClick={() => setHub(true)}><Icon name="chat" className="h-4 w-4" /> ข่าวและลิงก์ญาติ</button><MenuButton label="เอกสาร" icon={<Icon name="print" className="h-4 w-4" />} items={[{ label: "ตัวอย่าง สบส. (แบบฟอร์มเปล่า)", onClick: () => setSample(true) }]} /></>}
      />
      <Section title="ทะเบียนผู้รับบริการ" actions={<div className="flex flex-wrap gap-2">
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
            if (col === 1) { const a = allergy[`${r[0]}|${r[3]}`]; return <span className="flex items-center gap-2.5"><Avatar kind="resident" id={ids[shown[k].i]} name={r[0]} size={32} /><span>{value}{a && <> <span className="v-check" title={a}>{/แพ้ยา/.test(a) ? "แพ้ยา" : "แพ้อาหาร"}</span></>}</span></span>; }
            if (col === 3 && noRoomOf(r)) return <span className="text-gold-500">ยังไม่มีห้อง</span>;
            return undefined;
          }}
          empty={roomF || statusF ? "ไม่พบผู้รับบริการตามตัวกรอง" : undefined}
          onRow={(k) => setProfile(ids[shown[k].i])} rowLabel="กดเพื่อเปิดประวัติ"
          actions={[
            // กดแถว = ประวัติ · จัดห้องขึ้นเฉพาะคนที่ยังพักอยู่แต่ยังไม่มีห้อง · ที่เหลืออยู่ใน ⋯ (ลบท้ายสุด)
            // จองห้องไว้ (สัญญารอชำระมัดจำ): ปุ่มหลัก = เปิดสัญญา (ฟอร์มเปิดสัญญาที่ดึงข้อมูลตอนจองมาให้ เลือกห้องในขั้นที่ 3)
            { label: "เปิดสัญญา", tone: "primary", hidden: (k) => !reservedOf(shown[k].r), onClick: (k) => { const c = reservedOf(shown[k].r); if (!c) return; contractHandoff.set(conIds[conRows.indexOf(c)]); go("contracts"); } },
            { label: "จัดห้อง", tone: "primary", hidden: (k) => !noRoomOf(shown[k].r) || !can(user, "rooms") || !!reservedOf(shown[k].r), onClick: () => go("rooms") },
            { label: "ประวัติ", more: true, onClick: (k) => setProfile(ids[shown[k].i]) },
            { label: "ลิงก์ครอบครัว", more: true, onClick: (k) => setFamily(ids[shown[k].i]) },
            { label: "แก้ไขข้อมูล", more: true, onClick: (k) => setDlg({ mode: "edit", i: shown[k].i }) },
            // ลบได้เฉพาะผู้จัดการสาขา/ผู้บริหาร และคนที่ไม่เคยมีสัญญา (เช่น บันทึกผิด) · คนที่มีสัญญาให้ D/C / ย้ายออกแทน (server ตรวจซ้ำ)
            { label: "ลบ…", danger: true, more: true, hidden: (k) => !canDelete || contractsOf(shown[k].r).length > 0,
              onClick: (k) => confirm({ title: "ลบข้อมูลผู้รับบริการ", danger: true, okLabel: "ลบถาวร",
                message: `ต้องการลบ ${shown[k].r[0]} ออกจากทะเบียนใช่หรือไม่ · ข้อมูลแรกรับ บันทึกทางคลินิก งานประจำ ลิงก์และข่าวถึงครอบครัวของคนนี้จะถูกลบถาวร กู้คืนไม่ได้ · ถ้าไม่ได้พักแล้ว แนะนำให้แก้สถานะเป็น "ย้ายออก" แทน ประวัติจะยังอยู่ครบ`,
                onOk: () => { const n = shown[k].r[0]; remove(shown[k].i); toast(`ลบผู้รับบริการแล้ว · ${n}`); } }) },
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
          const live = contractsOf(rows[dlg.i], true);
          // ย้ายสาขาไม่ได้ระหว่างมีสัญญา (สัญญา งานประจำ ลิงก์ครอบครัว ผูกกับสาขาเดิม) · server ตรวจซ้ำ
          if (v[3] !== rows[dlg.i][3] && live.length) return toast(`${rows[dlg.i][0]} ยังมีสัญญา ${live[0][0] || ""} (${live[0][5]}) ที่สาขา${rows[dlg.i][3]} จึงย้ายสาขาไม่ได้ · ให้ D/C สิ้นสุดสัญญาที่สาขาเดิมก่อน แล้วเปิดสัญญาใหม่ที่สาขา${v[3]}`);
          // ย้ายออกระหว่างมีสัญญา: ต้อง D/C หรือยกเลิกสัญญาก่อน (ระบบย้ายออก คืนห้อง และปิดลิงก์ครอบครัวให้เอง)
          if (v[5].startsWith("ย้ายออก") && !rows[dlg.i][5].startsWith("ย้ายออก") && live.length) {
            const msg = `${rows[dlg.i][0]} ยังมีสัญญา ${live[0][0] || ""} (${live[0][5]}) · ให้ "D/C กลับบ้าน" หรือ "ยกเลิกสัญญา" ที่เมนูสัญญาบริการก่อน ระบบจะเปลี่ยนเป็นย้ายออกและคืนห้องให้เอง`;
            return can(user, "contracts") ? confirm({ title: "ยังมีสัญญาที่ใช้งานอยู่", message: msg, okLabel: "ไปที่สัญญาบริการ", onOk: () => { setDlg(null); go("contracts"); } }) : toast(`${msg} (แจ้งผู้ดูแลสัญญา)`);
          }
          // ห้องที่สร้างไว้ในเมนูห้องพักและเตียง: เต็มหรือปิดปรับปรุงย้ายเข้าไม่ได้
          const problem = staying(v[5] ?? "") ? roomProblem(findRoom(roomInfos(roomRows, rows), v[3], v[2]), rows[dlg.i][0]) : "";
          if (problem) return toast(problem);
          // เปลี่ยนห้องในหน้านี้ = ได้เตียงว่างลำดับแรกของห้องใหม่ (ห้องเดิม = เตียงเดิม)
          const oldRow = rows[dlg.i];
          const roomNew = findRoom(roomInfos(roomRows, rows), v[3], v[2]);
          const bed = oldRow[2] === v[2] ? oldRow[7] ?? "" : freeBed(roomNew, oldRow[0]);
          // เปลี่ยนห้อง: server เปลี่ยนห้องในสัญญาที่ใช้งานอยู่ตาม แล้วดึงทะเบียนสัญญาใหม่
          update(dlg.i, [norm(v[0]), v[1], v[2], v[3], v[4], v[5], oldRow[6] ?? "", bed]).then(() => refreshData("contracts")); setDlg(null); toast("บันทึกการแก้ไขแล้ว · ข้อมูลที่เกี่ยวข้องเปลี่ยนชื่อตามให้แล้ว");
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
      <PageHeader title="งานดูแลย้อนหลัง" sub="งานทุกงานย้อนหลังตามช่วงวันที่"
        actions={<>
          {branchNames.length > 1 && <div className="min-w-44"><Select options={branchNames} placeholder="รวมทุกสาขา" value={branch} onChange={setBranch} /></div>}
          <button className="btn-primary" disabled={!rows?.length} onClick={() => downloadCsv(`งานดูแลย้อนหลัง-${from}-${to}`, cols, rows ?? [])}><CsvIcon /> ส่งออก CSV</button>
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



