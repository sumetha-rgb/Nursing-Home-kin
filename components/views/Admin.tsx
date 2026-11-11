"use client";
import { useEffect, useMemo, useState } from "react";
import CsvIcon from "@/components/CsvIcon";
import { reloadBranches, useBranchNames } from "@/lib/branches";
import Icon from "../Icon";
import { BRANCHES, BRANCH_NAMES } from "@/lib/mock";
import { api, SessionUser, UserRow, useSession } from "@/lib/session";
import { BRANCH_ROLES, ROLE_INFO, ROLES, Role } from "@/lib/roles";
import PermDialog from "../PermDialog";
import { branchBeds, roomInfos } from "@/lib/rooms";
import { RESIDENTS } from "@/lib/mock";
import { downloadCsv, useCrud } from "@/lib/store";
import { useApp } from "@/lib/app";
import { Avatar } from "../Avatar";
import { DataTable, Field, FieldDef, FormDialog, Modal, PageHeader, Section, StatFilter, StatusBadge, Tabs } from "../ui";
import { Group, Item } from "./ContractView";

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
export const BRANCH_COLS = ["รหัสสาขา", "ชื่อสาขา", "นิติบุคคล", "เบอร์ติดต่อ", "ประเภทกิจการ", "บัญชีรับโอนหลัก", "บัญชีรับโอนสำรอง/ย่อย", "สถานะ"];
export const BRANCH_IDX = [0, 1, 2, 3, 7, 15, 16, 10];

export function Branches() {
  const {rows,add,update,remove,clear}=useCrud("branches",BRANCHES);
  const {toast,confirm}=useApp();
  // ข้อมูลสาขาเป็นของระดับองค์กร: ผู้จัดการสาขาดูได้อย่างเดียว เพิ่ม/แก้/ลบได้เฉพาะผู้บริหาร (server บังคับด้วย)
  const {user}=useSession();
  const canEdit=user?.role==="Global Admin";
  /** เตียงของสาขา: ถ้ามีห้องในเมนูห้องพักและเตียง นับจากห้อง (ไม่ต้องพิมพ์เอง) ไม่มี = ใช้ค่าที่กรอกไว้ */
  const roomRows=useCrud("rooms",[]).rows, resRows=useCrud("residents",RESIDENTS).rows;
  const beds=new Map(branchBeds(roomInfos(roomRows,resRows)).map(b=>[b.branch,b]));
  const bedsOf=(r:string[])=>beds.get(r[1])?beds.get(r[1])!.capacity:Number(r[5])||0;
  const [dlg,setDlg]=useState<{mode:"add"|"edit";i:number}|null>(null);
  const bedFields=BRANCH_FIELDS.map((f,k)=>k===5?{...f,label:"จำนวนเตียงรองรับ (นับจากห้องพักและเตียงอัตโนมัติ)",readOnly:!!(dlg&&beds.get(rows[dlg.i]?.[1]))}:f);
  const [layout,setLayout]=useState("การ์ดสาขา");
  const [query,setQuery]=useState("");
  const table=rows.map(r=>BRANCH_IDX.map(k=>r[k]));
  const shown=rows.map((r,i)=>({r,i})).filter(({r})=>!query||[r[0],r[1],r[2],r[3]].some(v=>v.includes(query)));
  const deleteBranch=(i:number)=>confirm({title:"ลบสาขา",message:`ต้องการลบสาขา ${rows[i][1]} ใช่หรือไม่`,danger:true,okLabel:"ลบสาขา",onOk:()=>{const n=rows[i][1];remove(i);toast(`ลบสาขาแล้ว · ${n}`);}});
  return <>
    <PageHeader title="ข้อมูลสาขา" sub={canEdit?undefined:"ดูได้อย่างเดียว · แก้ไขแจ้งผู้บริหาร"} actions={<><button className="btn-soft" onClick={()=>downloadCsv("สาขา",BRANCH_COLS,table)}><CsvIcon /> ส่งออก CSV</button>{canEdit&&<button className="btn-primary" onClick={()=>setDlg({mode:"add",i:-1})}><Icon name="plus" className="h-4 w-4" />เพิ่มสาขา</button>}</>} />
    <div className="mb-5 flex flex-wrap items-center justify-between gap-4"><p className="stat-sum !ml-0">สาขาในเครือ <b>{rows.length}</b> · เปิดให้บริการ <b>{rows.filter(r=>r[10]==="เปิด").length}</b> · เตียงรองรับ <b>{rows.reduce((n,r)=>n+bedsOf(r),0)}</b>{rows.some(r=>r[10]==="ภายใน")?<> · สำนักงานภายใน <b>{rows.filter(r=>r[10]==="ภายใน").length}</b></>:null}</p><Tabs tabs={["การ์ดสาขา","ตารางข้อมูล"]} value={layout} onChange={setLayout} /></div>
    {layout==="การ์ดสาขา"?<><div className="table-search mb-5"><Icon name="search" /><input aria-label="ค้นหาสาขา" placeholder="ค้นหาชื่อหรือรหัสสาขา…" value={query} onChange={e=>setQuery(e.target.value)} /></div><div className="branch-grid">{shown.map(({r,i})=><article className="branch-card" key={i}><div className="branch-card-head"><span><Icon name="building" className="h-6 w-6" /></span><StatusBadge value={r[10]} /></div><div className="branch-card-body"><h3>{r[1]}</h3><p className="branch-card-id">KIN HOMECARE · {r[0]}</p><dl><div><dt>รองรับการดูแล</dt><dd>{bedsOf(r)} เตียง{beds.get(r[1])?` · พักอยู่ ${beds.get(r[1])!.people} (${beds.get(r[1])!.pct}%)`:""}</dd></div><div><dt>ติดต่อสาขา</dt><dd>{r[3]||"—"}</dd></div><div><dt>ประเภทสาขา</dt><dd>{r[6]||"—"}</dd></div></dl><p className="mb-5 text-xs leading-7 text-gold-500">{r[8]||r[4]}</p><div className="branch-card-footer"><button className="btn-soft" onClick={()=>setDlg({mode:"edit",i})}>{canEdit?"รายละเอียดและแก้ไข":"ดูรายละเอียด"} <Icon name="arrow" className="h-4 w-4" /></button>{canEdit&&<button className="row-action danger" onClick={()=>deleteBranch(i)}>ลบ</button>}</div></div></article>)}</div>{!shown.length&&<div className="card empty-state">ไม่พบสาขาที่ค้นหา</div>}</>:<Section title="ทะเบียนสาขา"><DataTable columns={BRANCH_COLS} rows={table} actions={canEdit?[{label:"แก้ไข",onClick:i=>setDlg({mode:"edit",i})},{label:"ลบ",danger:true,onClick:deleteBranch}]:[{label:"ดู",onClick:i=>setDlg({mode:"edit",i})}]} /></Section>}
    <details className="mt-8 text-xs text-gold-500"><summary className="cursor-pointer">การจัดการข้อมูลขั้นสูง</summary><div className="mt-4 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-red-100 bg-red-50/40 p-5"><p>ลบข้อมูลทุกสาขาออกจากระบบตัวอย่าง</p><button className="btn-danger" onClick={()=>confirm({title:"ล้างสาขาทั้งหมด",message:"ต้องการลบข้อมูลสาขาทั้งหมดใช่หรือไม่",danger:true,okLabel:"ล้างทั้งหมด",onOk:()=>{clear();toast("ล้างข้อมูลแล้ว");}})}>ล้างข้อมูลสาขา</button></div></details>
    {/* ผู้จัดการสาขาแก้ไม่ได้: แสดงเป็นหน้าอ่านแบ่งกลุ่ม */}
    <Modal open={!!dlg&&!canEdit} wide title="รายละเอียดสาขา" onClose={()=>setDlg(null)} footer={<button className="btn-primary" onClick={()=>setDlg(null)}>ปิด</button>}>
      {dlg&&!canEdit&&rows[dlg.i]&&(()=>{const r=rows[dlg.i],b=beds.get(r[1]),tel=(r[3]??"").replace(/\D/g,""),has=(v?:string)=>!!v&&v.trim()!==""&&v.trim()!=="-";return <div className="space-y-5">
        <div className="cv-head"><div className="min-w-0"><p className="text-xs text-gold-500">{r[0]||"-"} · {r[7]||"-"}</p><h3 className="truncate text-lg font-semibold text-gold-900">สาขา{r[1]}</h3>{has(r[2])&&<p className="text-sm text-gold-600">{r[2]}</p>}</div>
          <div className="text-right"><StatusBadge value={r[10]||"-"} />{b&&<p className="mt-2 text-sm text-gold-700">เตียง <b className="text-gold-900">{b.people}/{b.capacity}</b> · ว่าง {b.free}</p>}</div></div>
        <Group title="ติดต่อ">
          <Item k="เบอร์ติดต่อศูนย์" v={tel?<a className="underline-offset-2 hover:underline" href={`tel:${tel}`}>{r[3]}</a>:"-"} />
          <Item k="อีเมล" v={has(r[9])?<a className="underline-offset-2 hover:underline" href={`mailto:${r[9]}`}>{r[9]}</a>:"-"} />
          <Item k="ที่อยู่ศูนย์" v={r[4]} wide />
          <Item k="พิกัด" v={has(r[11])?<a className="underline-offset-2 hover:underline" target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${encodeURIComponent(r[11])}`}>เปิดแผนที่ ({r[11]})</a>:"-"} wide />
        </Group>
        <Group title="นิติบุคคลและใบอนุญาต">
          <Item k="นิติบุคคลหรือผู้แทน" v={r[2]} />
          <Item k="ประเภทเจ้าของ" v={r[6]} />
          <Item k="ใบอนุญาตประกอบกิจการ" v={r[13]} wide />
        </Group>
        <Group title="บัญชีรับโอน">
          <Item k="ธนาคารและชื่อบัญชี" v={r[14]} wide />
          <Item k="เลขบัญชีหลัก" v={r[15]} />
          <Item k="เลขบัญชีสำรอง" v={r[16]} />
        </Group>
        {has(r[8])&&<Group title="จุดเด่นของสาขา"><Item k="" v={r[8]} wide /></Group>}
        <p className="text-xs text-gold-500">ข้อมูลสาขาแก้ไขได้เฉพาะผู้บริหาร</p>
      </div>;})()}
    </Modal>
    <FormDialog open={!!dlg&&(canEdit||dlg.mode==="add")} mode={dlg?.mode??"add"} title={dlg?.mode==="edit"?"รายละเอียดสาขา":"เพิ่มพื้นที่แห่งการดูแล"} fields={bedFields} value={dlg?.mode==="edit"?rows[dlg.i].map((v,k)=>k===5?String(bedsOf(rows[dlg.i])):v):undefined} onClose={()=>setDlg(null)} onSave={v=>{if(dlg?.mode==="edit")update(dlg.i,v);else add(v);setDlg(null);setTimeout(reloadBranches,1500);toast(`${dlg?.mode==="edit"?"แก้ไขข้อมูลสาขาแล้ว":"เพิ่มสาขาแล้ว"} · ${v[1]}`);}} />
  </>;
}

/* ---------- ผู้ใช้งานระบบ (บัญชีล็อกอินจริง ผ่าน /api/users) ---------- */
const TYPES = ["B (NJY GROUP)", "MF (Master Franchise)", "F (Franchise)"];
const STATUSES = ["ทำงาน", "รออนุมัติ", "พักงาน", "ลาออก"];
const STAFF_COLS = ["ชื่อ-นามสกุล", "อีเมล", "ประเภทสัญญา", "ตำแหน่ง", "สาขา", "สถานะ"];
const roleTh = (r: string) => (r in ROLE_INFO ? ROLE_INFO[r as Role].th : r);
/** ชื่อไทยของตำแหน่ง → รหัสตำแหน่งในระบบ (ฟอร์มเลือกเป็นชื่อไทย) */
const roleId = (th: string) => ROLES.find((r) => ROLE_INFO[r].th === th) ?? th;

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
  const [perm, setPerm] = useState<UserRow | null>(null);

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
  const levels: string[] = (global ? [...ROLES] : BRANCH_ROLES).map(roleTh);
  const branches = global ? ["ทุกสาขา", ...branchNames] : [me?.branch ?? ""];
  const fields: FieldDef[] = [
    { label: "ชื่อ-นามสกุล", required: true },
    { label: "อีเมล (ใช้เข้าสู่ระบบ)", type: "email", required: true },
    ...(dlg?.mode === "add" ? [{ label: "รหัสผ่านเริ่มต้น (อย่างน้อย 8 ตัวอักษร)", type: "password", required: true }] : []),
    { label: "ประเภทสัญญา", options: TYPES },
    { label: "ตำแหน่ง", options: levels, required: true },
    { label: "สาขา", options: branches, required: true },
    { label: "สถานะ", options: STATUSES, required: true },
  ];
  const toForm = (u: UserRow) => [u.full_name, u.email ?? "", u.contract_type ?? "", roleTh(u.access_level), u.branch_name ?? "", u.status];
  const save = async (v: string[]) => {
    const add = dlg?.mode === "add";
    const [full_name, email, ...rest] = v;
    const [password, contract_type, level, branch_name, status] = add ? rest : ["", ...rest];
    const access_level = roleId(level);
    const ok = await run(add ? { action: "create", full_name, email, password, contract_type, access_level, branch_name, status }
      : { action: "update", id: dlg!.u!.id, full_name, email, contract_type, access_level, branch_name, status }, add ? "สร้างบัญชีเรียบร้อย" : "บันทึกข้อมูลสมาชิกเรียบร้อย");
    if (ok) setDlg(null);
  };

  // ค่าเริ่มต้นของฟอร์มต้องคงที่ระหว่างพิมพ์ (FormDialog รีเซตเมื่อ value เปลี่ยน)
  const formValue = useMemo(() => dlg?.mode === "edit" && dlg.u ? toForm(dlg.u) : dlg?.mode === "add" ? ["", "", "", TYPES[0], roleTh("Nurse"), global ? "" : me?.branch ?? "", "ทำงาน"] : undefined, [dlg]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = users.filter((u) => filter === "ทั้งหมด" || u.status === filter);
  const pending = users.filter((u) => u.status === "รออนุมัติ").length;
  return <>
    <PageHeader title="ทีมและสิทธิ์การใช้งาน" sub={global ? "บัญชีเข้าสู่ระบบและสิทธิ์ของทีม" : `บัญชีของทีมสาขา${me?.branch ?? ""}`}
      actions={<><button className="btn-soft" onClick={() => downloadCsv("ผู้ใช้งานระบบ", STAFF_COLS, users.map(toForm))}><CsvIcon /> ส่งออก CSV</button><button className="btn-primary" onClick={() => setDlg({ mode: "add" })}><Icon name="plus" className="h-4 w-4" />สร้างบัญชีสมาชิก</button></>} />
    <Section title="สมาชิกทีม KIN">
      <StatFilter label="กรองตามสถานะ" value={filter} onChange={setFilter} items={[
        { k: "ทั้งหมด", t: "ทั้งหมด", n: users.length, tone: "all" },
        ...STATUSES.map((st) => ({ k: st, t: st, n: users.filter((u) => u.status === st).length, tone: (st === "ทำงาน" ? "good" : st === "รออนุมัติ" ? "warn" : "muted") as "good" | "warn" | "muted" })),
      ]} summary={<>มีบัญชีเข้าระบบ <b>{users.filter((u) => u.email).length}</b> คน</>} />
      <DataTable columns={[...STAFF_COLS.slice(0, 3), "ตำแหน่ง", "สิทธิ์", ...STAFF_COLS.slice(4)]} rows={shown.map((u) => [u.full_name, u.email ?? "—", u.contract_type ?? "—", roleTh(u.access_level), u.access_level === "Global Admin" ? "ทุกสิทธิ์" : u.permissions ? `กำหนดเอง ${u.permissions.length} รายการ` : "ตามตำแหน่ง", u.branch_name ?? "—", u.status])}
        empty={loading ? "กำลังโหลดรายชื่อ…" : "ไม่พบสมาชิก"}
        render={(n, col) => (col === 0 && shown[n] ? <span className="flex items-center gap-2.5"><Avatar kind="staff" id={shown[n].id} name={shown[n].full_name} size={32} /><b className="font-semibold">{shown[n].full_name}</b></span> : undefined)}
        onRow={(n) => setDlg({ mode: "edit", u: shown[n] })} rowLabel="กดเพื่อแก้ไขข้อมูลสมาชิก"
        actions={[
          { label: "อนุมัติ", tone: "primary", hidden: (n) => shown[n].status !== "รออนุมัติ", onClick: (n) => run({ action: "approve", id: shown[n].id }, `อนุมัติ ${shown[n].full_name} แล้ว`) },
          { label: "แก้ไข", more: true, onClick: (n) => setDlg({ mode: "edit", u: shown[n] }) },
          { label: "สิทธิ์การใช้งาน", more: true, onClick: (n) => setPerm(shown[n]) },
          { label: "รีเซตรหัสผ่าน", more: true, onClick: (n) => { setNewPw(""); setReset(shown[n]); } },
          { label: "ลบบัญชี", danger: true, more: true, onClick: (n) => { const u = shown[n]; confirm({ title: "ลบบัญชีสมาชิก", message: `ต้องการลบบัญชี ${u.full_name} ใช่หรือไม่ บัญชีนี้จะเข้าสู่ระบบไม่ได้อีก`, danger: true, okLabel: "ลบบัญชี", onOk: () => { run({ action: "delete", id: u.id }, "ลบบัญชีเรียบร้อย"); } }); } },
        ]} />
    </Section>
    <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[...ROLES].reverse().map((r) => <div key={r} className="rounded-xl border border-cream-200 bg-cream-100/50 p-4"><p className="text-sm font-medium text-gold-800">{ROLE_INFO[r].th}</p><p className="mt-1 text-xs leading-6 text-gold-600">{ROLE_INFO[r].sees}</p></div>)}</div>
    <PermDialog user={perm} me={me} onClose={() => setPerm(null)}
      onSave={async (list) => { if (perm && await run({ action: "permissions", id: perm.id, permissions: list }, list ? `บันทึกสิทธิ์ของ ${perm.full_name} แล้ว` : `${perm.full_name} กลับไปใช้สิทธิ์ตามตำแหน่งแล้ว`)) setPerm(null); }} />
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
