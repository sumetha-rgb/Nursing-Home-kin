"use client";
import { useState } from "react";
import Icon from "../Icon";
import { BRANCHES, BRANCH_NAMES, STAFF } from "@/lib/mock";
import { downloadCsv, useCrud } from "@/lib/store";
import { useApp } from "@/lib/app";
import { DataTable, Field, FieldDef, FormDialog, PageHeader, Section, Select, MetricGrid, StatusBadge, Tabs } from "../ui";

/* ---------- จัดการสาขา ---------- */
const BRANCH_FIELDS: FieldDef[] = [
  { label: "รหัสสาขา" },
  { label: "ชื่อสาขา", required: true },
  { label: "นิติบุคคลหรือผู้แทน" },
  { label: "เบอร์ติดต่อศูนย์", type: "tel" },
  { label: "ที่อยู่ศูนย์", area: true },
  { label: "จำนวนเตียงรองรับ", type: "number" },
  { label: "ประเภทเจ้าของ", options: ["HQ", "F (Franchise)", "B (NJY GROUP)"] },
  { label: "ประเภทสาขา", options: ["ศูนย์ดูแลผู้สูงอายุ (Nursing Home)", "ศูนย์บริการจัดส่งพนักงาน (Central Services)", "จุดบริการหน้าร้าน (POS/Retail)", "สำนักงานส่วนกลาง (HQ/Backoffice)"] },
  { label: "จุดเด่นของสาขา", area: true },
  { label: "อีเมล", type: "email" },
  { label: "สถานะ", options: ["เปิด", "ปิด", "ภายใน"], required: true },
  { label: "พิกัด (ละติจูด, ลองจิจูด)" },
  { label: "ลิงก์ภาพสาขา", wide: true },
  { label: "เลขที่ใบอนุญาตประกอบกิจการดูแลผู้สูงอายุ", wide: true },
  { label: "ธนาคารและชื่อบัญชี", wide: true },
  { label: "เลขบัญชีหลัก" },
  { label: "เลขบัญชีสำรอง" },
];
const BRANCH_COLS = ["รหัสสาขา", "ชื่อสาขา", "นิติบุคคล", "เบอร์ติดต่อ", "ประเภทกิจการ", "บัญชีรับโอนหลัก", "บัญชีรับโอนสำรอง/ย่อย", "สถานะ"];
const BRANCH_IDX = [0, 1, 2, 3, 7, 15, 16, 10];

export function Branches() {
  const {rows,add,update,remove,clear}=useCrud("branches",BRANCHES);
  const {toast,confirm}=useApp();
  const [dlg,setDlg]=useState<{mode:"add"|"edit";i:number}|null>(null);
  const [layout,setLayout]=useState("การ์ดสาขา");
  const [query,setQuery]=useState("");
  const table=rows.map(r=>BRANCH_IDX.map(k=>r[k]));
  const shown=rows.map((r,i)=>({r,i})).filter(({r})=>!query||[r[0],r[1],r[2],r[3]].some(v=>v.includes(query)));
  const deleteBranch=(i:number)=>confirm({title:"ลบสาขา",message:`ต้องการลบสาขา ${rows[i][1]} ใช่หรือไม่`,danger:true,okLabel:"ลบสาขา",onOk:()=>{remove(i);toast("ลบสาขาเรียบร้อย");}});
  return <>
    <PageHeader title="สาขาของเรา" sub="ทุกพื้นที่ของ KIN เชื่อมต่อกันด้วยมาตรฐานการดูแลเดียวกัน" actions={<><button className="btn-soft" onClick={()=>downloadCsv("สาขา",BRANCH_COLS,table)}><Icon name="download" className="h-4 w-4" />ส่งออกข้อมูล</button><button className="btn-primary" onClick={()=>setDlg({mode:"add",i:-1})}><Icon name="plus" className="h-4 w-4" />เพิ่มสาขา</button></>} />
    <MetricGrid items={[{label:"สาขาในเครือ",value:rows.length,unit:"สาขา",accent:true,icon:"building"},{label:"เปิดให้บริการ",value:rows.filter(r=>r[10]==="เปิด").length,unit:"สาขา",icon:"check"},{label:"จำนวนเตียงรองรับ",value:rows.reduce((n,r)=>n+(Number(r[5])||0),0),unit:"เตียง",icon:"heart"},{label:"สำนักงานและสาขาภายใน",value:rows.filter(r=>r[10]==="ภายใน").length,unit:"แห่ง",icon:"id"}]} />
    <div className="mb-5 flex flex-wrap items-center justify-between gap-4"><h2 className="text-[17px] font-medium text-gold-800">พื้นที่แห่งความใส่ใจ</h2><Tabs tabs={["การ์ดสาขา","ตารางข้อมูล"]} value={layout} onChange={setLayout} /></div>
    {layout==="การ์ดสาขา"?<><div className="table-search mb-5"><Icon name="search" /><input aria-label="ค้นหาสาขา" placeholder="ค้นหาชื่อหรือรหัสสาขา…" value={query} onChange={e=>setQuery(e.target.value)} /></div><div className="branch-grid">{shown.map(({r,i})=><article className="branch-card" key={i}><div className="branch-card-head"><span><Icon name="building" className="h-6 w-6" /></span><StatusBadge value={r[10]} /></div><div className="branch-card-body"><h3>{r[1]}</h3><p className="branch-card-id">KIN HOMECARE · {r[0]}</p><dl><div><dt>รองรับการดูแล</dt><dd>{r[5]} เตียง</dd></div><div><dt>ติดต่อสาขา</dt><dd>{r[3]||"—"}</dd></div><div><dt>ประเภทสาขา</dt><dd>{r[6]||"—"}</dd></div></dl><p className="mb-5 text-xs leading-7 text-gold-500">{r[8]||r[4]}</p><div className="branch-card-footer"><button className="btn-soft" onClick={()=>setDlg({mode:"edit",i})}>รายละเอียดและแก้ไข <Icon name="arrow" className="h-4 w-4" /></button><button className="row-action danger" onClick={()=>deleteBranch(i)}>ลบ</button></div></div></article>)}</div>{!shown.length&&<div className="card empty-state">ไม่พบสาขาที่ค้นหา</div>}</>:<Section title="ทะเบียนสาขา"><DataTable columns={BRANCH_COLS} rows={table} actions={[{label:"แก้ไข",onClick:i=>setDlg({mode:"edit",i})},{label:"ลบ",danger:true,onClick:deleteBranch}]} /></Section>}
    <details className="mt-8 text-xs text-gold-500"><summary className="cursor-pointer">การจัดการข้อมูลขั้นสูง</summary><div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-red-100 bg-red-50/40 p-5"><p>ลบข้อมูลทุกสาขาออกจากระบบตัวอย่าง</p><button className="btn-danger" onClick={()=>confirm({title:"ล้างสาขาทั้งหมด",message:"ต้องการลบข้อมูลสาขาทั้งหมดใช่หรือไม่",danger:true,okLabel:"ล้างทั้งหมด",onOk:()=>{clear();toast("ล้างข้อมูลเรียบร้อย");}})}>ล้างข้อมูลสาขา</button></div></details>
    <FormDialog open={!!dlg} mode={dlg?.mode??"add"} title={dlg?.mode==="edit"?"รายละเอียดสาขา":"เพิ่มพื้นที่แห่งการดูแล"} fields={BRANCH_FIELDS} value={dlg?.mode==="edit"?rows[dlg.i]:undefined} onClose={()=>setDlg(null)} onSave={v=>{if(dlg?.mode==="edit")update(dlg.i,v);else add(v);setDlg(null);toast("บันทึกข้อมูลสาขาเรียบร้อย");}} />
  </>;
}

/* ---------- ผู้ใช้งานระบบ ---------- */
const TYPES = ["B (NJY GROUP)", "MF (Master Franchise)", "F (Franchise)"];
const LEVELS = ["Operation", "Branch Admin", "Global Admin"];
const STAFF_FIELDS: FieldDef[] = [
  { label: "ชื่อ-นามสกุล", required: true },
  { label: "ประเภทสัญญา", options: TYPES, required: true },
  { label: "ระดับสิทธิ์", options: LEVELS, required: true },
  { label: "สาขา", options: ["ทุกสาขา", ...BRANCH_NAMES], required: true },
  { label: "สถานะ", options: ["ทำงาน", "ลาออก", "พักงาน"], required: true },
];
const STAFF_COLS = ["ชื่อ-นามสกุล", "ประเภทสัญญา", "ระดับสิทธิ์", "สาขา", "สถานะ"];

export function Staff() {
  const {rows,add,update,remove,clear}=useCrud("staff",STAFF);
  const {toast,confirm}=useApp();
  const [dlg,setDlg]=useState<{mode:"add"|"edit";i:number}|null>(null);
  const [filter,setFilter]=useState("ทั้งหมด");
  const shown=rows.map((r,i)=>({r,i})).filter(({r})=>filter==="ทั้งหมด"||r[4]===filter);
  return <>
    <PageHeader title="ทีมและสิทธิ์การใช้งาน" sub="คนเบื้องหลังทุกการดูแล จัดการสมาชิกและสิทธิ์ให้เหมาะกับหน้าที่" actions={<><button className="btn-soft" onClick={()=>downloadCsv("ผู้ใช้งานระบบ",STAFF_COLS,rows)}><Icon name="download" className="h-4 w-4" />ส่งออกข้อมูล</button><button className="btn-primary" onClick={()=>setDlg({mode:"add",i:-1})}><Icon name="plus" className="h-4 w-4" />เพิ่มสมาชิกทีม</button></>} />
    <MetricGrid items={[{label:"สมาชิกในระบบ",value:rows.length,unit:"คน",icon:"user",accent:true},{label:"กำลังปฏิบัติงาน",value:rows.filter(r=>r[4]==="ทำงาน").length,unit:"คน",icon:"check"},{label:"ผู้บริหารองค์กร",value:rows.filter(r=>r[2].includes("Global Admin")).length,unit:"คน",icon:"id"},{label:"ดูแลทุกสาขา",value:rows.filter(r=>r[3]==="ทุกสาขา").length,unit:"คน",icon:"building"}]} />
    <Section title="สมาชิกทีม KIN" sub="ค้นหาสมาชิก ดูหน้าที่ และจัดการสิทธิ์การเข้าถึง" actions={<Tabs tabs={["ทั้งหมด","ทำงาน","พักงาน","ลาออก"]} value={filter} onChange={setFilter} />}><DataTable columns={STAFF_COLS} rows={shown.map(x=>x.r)} actions={[{label:"แก้ไขสมาชิก",onClick:n=>setDlg({mode:"edit",i:shown[n].i})},{label:"ลบ",danger:true,onClick:n=>{const i=shown[n].i;confirm({title:"ลบสมาชิกทีม",message:`ต้องการลบ ${rows[i][0]} ใช่หรือไม่`,danger:true,okLabel:"ลบสมาชิก",onOk:()=>{remove(i);toast("ลบสมาชิกเรียบร้อย");}});}}]} /></Section>
    <div className="mt-5 flex items-start gap-3 rounded-xl border border-cream-200 bg-cream-100/50 p-5"><Icon name="lock" className="mt-1 h-4 w-4 shrink-0 text-gold-500" /><p className="text-xs leading-7 text-gold-600">สิทธิ์การใช้งานแบ่งเป็นระดับปฏิบัติงาน ผู้จัดการสาขา และผู้บริหารองค์กร เพื่อให้สมาชิกแต่ละคนเข้าถึงข้อมูลตามหน้าที่</p></div>
    <details className="mt-7 text-xs text-gold-500"><summary className="cursor-pointer">การจัดการข้อมูลขั้นสูง</summary><button className="btn-danger mt-4" onClick={()=>confirm({title:"ล้างข้อมูลสมาชิกทั้งหมด",message:"ต้องการลบรายชื่อผู้ใช้งานทั้งหมดใช่หรือไม่",danger:true,okLabel:"ล้างทั้งหมด",onOk:()=>{clear();toast("ล้างข้อมูลเรียบร้อย");}})}>ล้างข้อมูลสมาชิก</button></details>
    <FormDialog open={!!dlg} mode={dlg?.mode??"add"} title={dlg?.mode==="edit"?"แก้ไขสมาชิกทีม":"เพิ่มสมาชิกทีม KIN"} fields={STAFF_FIELDS} value={dlg?.mode==="edit"?rows[dlg.i]:undefined} onClose={()=>setDlg(null)} onSave={v=>{if(dlg?.mode==="edit")update(dlg.i,v);else add(v);setDlg(null);toast("บันทึกข้อมูลสมาชิกเรียบร้อย");}} />
  </>;
}
