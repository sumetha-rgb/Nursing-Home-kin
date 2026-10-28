"use client";
import { useEffect, useMemo, useState } from "react";
import { reloadBranches, useBranchNames } from "@/lib/branches";
import Icon from "../Icon";
import { BRANCHES, BRANCH_NAMES } from "@/lib/mock";
import { api, SessionUser, UserRow, useSession } from "@/lib/session";
import { ROLE_INFO, ROLES } from "@/lib/roles";
import { downloadCsv, useCrud } from "@/lib/store";
import { useApp } from "@/lib/app";
import { DataTable, Field, FieldDef, FormDialog, Modal, PageHeader, Section, MetricGrid, StatusBadge, Tabs } from "../ui";

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
  { label: "สถานะ", options: ["เปิด", "เตรียมเปิด", "ปิด", "ภายใน"], required: true },
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
  // ข้อมูลสาขาเป็นของระดับองค์กร: ผู้จัดการสาขาดูได้อย่างเดียว เพิ่ม/แก้/ลบได้เฉพาะผู้บริหาร (server บังคับด้วย)
  const {user}=useSession();
  const canEdit=user?.role==="Global Admin";
  const [dlg,setDlg]=useState<{mode:"add"|"edit";i:number}|null>(null);
  const [layout,setLayout]=useState("การ์ดสาขา");
  const [query,setQuery]=useState("");
  const table=rows.map(r=>BRANCH_IDX.map(k=>r[k]));
  const shown=rows.map((r,i)=>({r,i})).filter(({r})=>!query||[r[0],r[1],r[2],r[3]].some(v=>v.includes(query)));
  const deleteBranch=(i:number)=>confirm({title:"ลบสาขา",message:`ต้องการลบสาขา ${rows[i][1]} ใช่หรือไม่`,danger:true,okLabel:"ลบสาขา",onOk:()=>{remove(i);toast("ลบสาขาเรียบร้อย");}});
  return <>
    <PageHeader title="สาขาของเรา" sub={canEdit?"ทุกพื้นที่ของ KIN เชื่อมต่อกันด้วยมาตรฐานการดูแลเดียวกัน":"ข้อมูลสาขาของคุณ (ดูได้อย่างเดียว) · ต้องการแก้ไขเบอร์โทร ที่อยู่ หรือข้อมูลอื่น แจ้งผู้บริหาร"} actions={<><button className="btn-soft" onClick={()=>downloadCsv("สาขา",BRANCH_COLS,table)}><Icon name="download" className="h-4 w-4" />ส่งออกข้อมูล</button>{canEdit&&<button className="btn-primary" onClick={()=>setDlg({mode:"add",i:-1})}><Icon name="plus" className="h-4 w-4" />เพิ่มสาขา</button>}</>} />
    <MetricGrid items={[{label:"สาขาในเครือ",value:rows.length,unit:"สาขา",accent:true,icon:"building"},{label:"เปิดให้บริการ",value:rows.filter(r=>r[10]==="เปิด").length,unit:"สาขา",icon:"check"},{label:"จำนวนเตียงรองรับ",value:rows.reduce((n,r)=>n+(Number(r[5])||0),0),unit:"เตียง",icon:"heart"},{label:"สำนักงานและสาขาภายใน",value:rows.filter(r=>r[10]==="ภายใน").length,unit:"แห่ง",icon:"id"}]} />
    <div className="mb-5 flex flex-wrap items-center justify-between gap-4"><h2 className="text-[17px] font-medium text-gold-800">พื้นที่แห่งความใส่ใจ</h2><Tabs tabs={["การ์ดสาขา","ตารางข้อมูล"]} value={layout} onChange={setLayout} /></div>
    {layout==="การ์ดสาขา"?<><div className="table-search mb-5"><Icon name="search" /><input aria-label="ค้นหาสาขา" placeholder="ค้นหาชื่อหรือรหัสสาขา…" value={query} onChange={e=>setQuery(e.target.value)} /></div><div className="branch-grid">{shown.map(({r,i})=><article className="branch-card" key={i}><div className="branch-card-head"><span><Icon name="building" className="h-6 w-6" /></span><StatusBadge value={r[10]} /></div><div className="branch-card-body"><h3>{r[1]}</h3><p className="branch-card-id">KIN HOMECARE · {r[0]}</p><dl><div><dt>รองรับการดูแล</dt><dd>{r[5]} เตียง</dd></div><div><dt>ติดต่อสาขา</dt><dd>{r[3]||"—"}</dd></div><div><dt>ประเภทสาขา</dt><dd>{r[6]||"—"}</dd></div></dl><p className="mb-5 text-xs leading-7 text-gold-500">{r[8]||r[4]}</p><div className="branch-card-footer"><button className="btn-soft" onClick={()=>setDlg({mode:"edit",i})}>{canEdit?"รายละเอียดและแก้ไข":"ดูรายละเอียด"} <Icon name="arrow" className="h-4 w-4" /></button>{canEdit&&<button className="row-action danger" onClick={()=>deleteBranch(i)}>ลบ</button>}</div></div></article>)}</div>{!shown.length&&<div className="card empty-state">ไม่พบสาขาที่ค้นหา</div>}</>:<Section title="ทะเบียนสาขา"><DataTable columns={BRANCH_COLS} rows={table} actions={canEdit?[{label:"แก้ไข",onClick:i=>setDlg({mode:"edit",i})},{label:"ลบ",danger:true,onClick:deleteBranch}]:[{label:"ดู",onClick:i=>setDlg({mode:"edit",i})}]} /></Section>}
    <details className="mt-8 text-xs text-gold-500"><summary className="cursor-pointer">การจัดการข้อมูลขั้นสูง</summary><div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-red-100 bg-red-50/40 p-5"><p>ลบข้อมูลทุกสาขาออกจากระบบตัวอย่าง</p><button className="btn-danger" onClick={()=>confirm({title:"ล้างสาขาทั้งหมด",message:"ต้องการลบข้อมูลสาขาทั้งหมดใช่หรือไม่",danger:true,okLabel:"ล้างทั้งหมด",onOk:()=>{clear();toast("ล้างข้อมูลเรียบร้อย");}})}>ล้างข้อมูลสาขา</button></div></details>
    <FormDialog open={!!dlg} mode={dlg?.mode==="edit"&&!canEdit?"view":dlg?.mode??"add"} title={dlg?.mode==="edit"?"รายละเอียดสาขา":"เพิ่มพื้นที่แห่งการดูแล"} fields={BRANCH_FIELDS} value={dlg?.mode==="edit"?rows[dlg.i]:undefined} onClose={()=>setDlg(null)} onSave={v=>{if(dlg?.mode==="edit")update(dlg.i,v);else add(v);setDlg(null);setTimeout(reloadBranches,1500);toast("บันทึกข้อมูลสาขาเรียบร้อย");}} />
  </>;
}

/* ---------- ผู้ใช้งานระบบ (บัญชีล็อกอินจริง ผ่าน /api/users) ---------- */
const TYPES = ["B (NJY GROUP)", "MF (Master Franchise)", "F (Franchise)"];
const STATUSES = ["ทำงาน", "รออนุมัติ", "พักงาน", "ลาออก"];
const STAFF_COLS = ["ชื่อ-นามสกุล", "อีเมล", "ประเภทสัญญา", "ระดับสิทธิ์", "สาขา", "สถานะ"];

export function Staff() {
  const branchNames = useBranchNames();
  const { toast, confirm } = useApp();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [me, setMe] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [dlg, setDlg] = useState<{ mode: "add" | "edit"; u?: UserRow } | null>(null);
  const [reset, setReset] = useState<UserRow | null>(null);
  const [newPw, setNewPw] = useState("");
  const [filter, setFilter] = useState("ทั้งหมด");

  const run = async (body?: object, ok?: string) => {
    try {
      const r = await api.users(body) as { users: UserRow[]; me?: SessionUser };
      setUsers(r.users); if (r.me) setMe(r.me);
      if (ok) toast(ok);
      return true;
    } catch (e) { toast((e as Error).message); return false; }
    finally { setLoading(false); }
  };
  useEffect(() => { run(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const global = me?.role === "Global Admin";
  const levels = global ? [...ROLES] : ["Operation"];
  const branches = global ? ["ทุกสาขา", ...branchNames] : [me?.branch ?? ""];
  const fields: FieldDef[] = [
    { label: "ชื่อ-นามสกุล", required: true },
    { label: "อีเมล (ใช้เข้าสู่ระบบ)", type: "email", required: true },
    ...(dlg?.mode === "add" ? [{ label: "รหัสผ่านเริ่มต้น (อย่างน้อย 8 ตัวอักษร)", type: "password", required: true }] : []),
    { label: "ประเภทสัญญา", options: TYPES },
    { label: "ระดับสิทธิ์", options: levels, required: true },
    { label: "สาขา", options: branches, required: true },
    { label: "สถานะ", options: STATUSES, required: true },
  ];
  const toForm = (u: UserRow) => [u.full_name, u.email ?? "", u.contract_type ?? "", u.access_level, u.branch_name ?? "", u.status];
  const save = async (v: string[]) => {
    const add = dlg?.mode === "add";
    const [full_name, email, ...rest] = v;
    const [password, contract_type, access_level, branch_name, status] = add ? rest : ["", ...rest];
    const ok = await run(add ? { action: "create", full_name, email, password, contract_type, access_level, branch_name, status }
      : { action: "update", id: dlg!.u!.id, full_name, email, contract_type, access_level, branch_name, status }, add ? "สร้างบัญชีเรียบร้อย" : "บันทึกข้อมูลสมาชิกเรียบร้อย");
    if (ok) setDlg(null);
  };

  // ค่าเริ่มต้นของฟอร์มต้องคงที่ระหว่างพิมพ์ (FormDialog รีเซตเมื่อ value เปลี่ยน)
  const formValue = useMemo(() => dlg?.mode === "edit" && dlg.u ? toForm(dlg.u) : dlg?.mode === "add" ? ["", "", "", TYPES[0], "Operation", global ? "" : me?.branch ?? "", "ทำงาน"] : undefined, [dlg]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = users.filter((u) => filter === "ทั้งหมด" || u.status === filter);
  const pending = users.filter((u) => u.status === "รออนุมัติ").length;
  return <>
    <PageHeader title="ทีมและสิทธิ์การใช้งาน" sub={global ? "สร้างบัญชีเข้าสู่ระบบ อนุมัติผู้สมัคร และกำหนดสิทธิ์ให้เหมาะกับหน้าที่" : `จัดการบัญชีระดับปฏิบัติงานของสาขา${me?.branch ?? ""}`}
      actions={<><button className="btn-soft" onClick={() => downloadCsv("ผู้ใช้งานระบบ", STAFF_COLS, users.map(toForm))}><Icon name="download" className="h-4 w-4" />ส่งออกข้อมูล</button><button className="btn-primary" onClick={() => setDlg({ mode: "add" })}><Icon name="plus" className="h-4 w-4" />สร้างบัญชีสมาชิก</button></>} />
    <MetricGrid items={[
      { label: "สมาชิกในระบบ", value: users.length, unit: "คน", icon: "user", accent: true },
      { label: "กำลังปฏิบัติงาน", value: users.filter((u) => u.status === "ทำงาน").length, unit: "คน", icon: "check" },
      { label: "รออนุมัติ", value: pending, unit: "คน", icon: "bell", note: pending ? "สมัครเองจากหน้าเข้าสู่ระบบ" : undefined },
      { label: "มีบัญชีล็อกอิน", value: users.filter((u) => u.email).length, unit: "คน", icon: "lock" },
    ]} />
    <Section title="สมาชิกทีม KIN" sub="อนุมัติผู้สมัคร แก้ไขสิทธิ์ และรีเซตรหัสผ่าน" actions={<Tabs tabs={["ทั้งหมด", ...STATUSES]} value={filter} onChange={setFilter} />}>
      <DataTable columns={STAFF_COLS} rows={shown.map((u) => [u.full_name, u.email ?? "—", u.contract_type ?? "—", u.access_level, u.branch_name ?? "—", u.status])}
        empty={loading ? "กำลังโหลดรายชื่อ…" : "ไม่พบสมาชิก"}
        actions={[
          { label: "อนุมัติ", onClick: (n) => shown[n].status === "รออนุมัติ" ? run({ action: "approve", id: shown[n].id }, `อนุมัติ ${shown[n].full_name} แล้ว`) : toast("บัญชีนี้ไม่ได้อยู่ในสถานะรออนุมัติ") },
          { label: "แก้ไข", onClick: (n) => setDlg({ mode: "edit", u: shown[n] }) },
          { label: "รีเซตรหัสผ่าน", onClick: (n) => { setNewPw(""); setReset(shown[n]); } },
          { label: "ลบ", danger: true, onClick: (n) => { const u = shown[n]; confirm({ title: "ลบบัญชีสมาชิก", message: `ต้องการลบบัญชี ${u.full_name} ใช่หรือไม่ บัญชีนี้จะเข้าสู่ระบบไม่ได้อีก`, danger: true, okLabel: "ลบบัญชี", onOk: () => { run({ action: "delete", id: u.id }, "ลบบัญชีเรียบร้อย"); } }); } },
        ]} />
    </Section>
    <div className="mt-5 grid gap-3 md:grid-cols-3">{[...ROLES].reverse().map((r) => <div key={r} className="rounded-xl border border-cream-200 bg-cream-100/50 p-4"><p className="text-sm font-medium text-gold-800">{ROLE_INFO[r].th} <span className="font-normal text-gold-500">· {r}</span></p><p className="mt-1 text-xs leading-6 text-gold-600">{ROLE_INFO[r].sees}</p></div>)}</div>
    <FormDialog open={!!dlg} mode={dlg?.mode ?? "add"} title={dlg?.mode === "edit" ? "แก้ไขสมาชิกทีม" : "สร้างบัญชีสมาชิกทีม KIN"} fields={fields}
      value={formValue}
      onClose={() => setDlg(null)} onSave={save} saveLabel={dlg?.mode === "edit" ? "บันทึก" : "สร้างบัญชี"} />
    <Modal open={!!reset} title={`รีเซตรหัสผ่าน · ${reset?.full_name ?? ""}`} onClose={() => setReset(null)}
      footer={<><button className="btn-soft" onClick={() => setReset(null)}>ยกเลิก</button><button className="btn-primary" onClick={async () => { if (await run({ action: "reset_password", id: reset!.id, password: newPw }, "ตั้งรหัสผ่านใหม่แล้ว แจ้งรหัสให้สมาชิกทราบ")) setReset(null); }}>ตั้งรหัสผ่านใหม่</button></>}>
      <p className="mb-4 text-sm text-gold-600">สมาชิกจะถูกออกจากระบบทุกเครื่อง และต้องเข้าสู่ระบบด้วยรหัสใหม่</p>
      <Field label="รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)" required><input type="text" autoComplete="off" value={newPw} onChange={(e) => setNewPw(e.target.value)} /></Field>
    </Modal>
  </>;
}
