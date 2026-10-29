"use client";
import { ReactNode, useEffect, useState, useId, useRef, Children, isValidElement, cloneElement, ReactElement } from "react";
import { createPortal } from "react-dom";
import Icon from "./Icon";
import { clearNotice, closeModal, openModal, useNotice } from "@/lib/notice";

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  const clean = title.replace(/\s*\([^)]*\)/g, "").trim();
  return <header className="page-header"><div><span className="kicker"><span className="small-line" /> KIN · THE ART OF CARE</span><h1>{clean}</h1>{sub && <p>{sub}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</header>;
}
export function Section({ title, sub, children, actions }: { title?: string; sub?: string; children: ReactNode; actions?: ReactNode }) {
  return <section className="card section-surface">{(title || actions) && <div className="section-heading"><div>{title && <h2>{title.replace(/\s*\([^)]*\)/g, "").trim()}</h2>}{sub && <p>{sub}</p>}</div>{actions && <div className="section-actions">{actions}</div>}</div>}{children}</section>;
}
export function MetricGrid({items}:{items:{label:string;value:string|number;unit?:string;note?:string;icon?:string;accent?:boolean}[]}) {
  return <div className="metrics-grid">{items.map(item=><div key={item.label} className={"metric "+(item.accent?"accent":"")}><div className="metric-top"><span>{item.label}</span><Icon name={item.icon||"chart"} /></div><div className="metric-value">{item.value}<small>{item.unit}</small></div>{item.note&&<p className="metric-note">{item.note}</p>}</div>)}</div>;
}
export function StatusBadge({value}:{value:string}) {
  const success=/^(เพิ่ม|อนุมัติ|สมัครสมาชิก|เข้าสู่ระบบ$|ตรวจแล้ว|เสร็จแล้ว|เสร็จสิ้น|แก้ไขแล้ว|ใช้งานอยู่|ทำงาน|เปิด|เข้าอยู่|สำเร็จ|ตรวจผ่าน|จัดยาแล้ว|จ่ายยาแล้ว|ปกติ|ชำระแล้ว)/.test(value);
  const warning=/^(เฝ้าระวัง|รอ|กำลัง|แอดมิท|ค้างชำระ|ชำระบางส่วน|มัดจำ|แก้ไข$|แทนที่|เปลี่ยนรหัส|รีเซตรหัส)/.test(value);
  const danger=/^(ผิดปกติ|ลบ|ล้างข้อมูล|เข้าสู่ระบบไม่สำเร็จ|ปิด|ลาออก|สิ้นสุด|พักงาน|งด|ยาหมด|ยางด|แจ้งจัดยาผิด|ยกเลิก)/.test(value);
  return <span className={"status-badge "+(success?"status-success":warning?"status-warning":danger?"status-danger":"status-neutral")}>{value.replace(/\s*\([^)]*\)/g, "")}</span>;
}

export function Field({label,required,children,className=""}:{label:string;required?:boolean;children:ReactNode;className?:string}) {
 const labelId=useId();
 const controls=Children.map(children,child=>isValidElement(child)?cloneElement(child as ReactElement<{"aria-label"?:string}>, {"aria-label":(child.props as {"aria-label"?:string})["aria-label"]||label}):child);
 return <div className={className} role="group" aria-labelledby={labelId}><div id={labelId} className="label">{label}{required&&<span className="ml-1 text-red-500">*</span>}</div><div className="field-control">{controls}</div></div>;
}

export function Select({ options, placeholder, name, value, onChange, "aria-label": ariaLabel }: { "aria-label"?:string; options: string[]; placeholder?: string; name?: string; value?: string; onChange?: (v: string) => void }) {
  const ctl = onChange ? { value: value ?? "", onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value) } : { defaultValue: "" };
  return (
    <select name={name} aria-label={ariaLabel} {...ctl}>
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o}>{o}</option>)}
    </select>
  );
}

export function Upload({ text = "คลิกเพื่ออัปโหลดรูป" }: { text?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-gold-300 bg-cream-50 px-4 py-5 text-sm text-gold-600 transition hover:bg-cream-200">
      <Icon name="upload" className="h-4 w-4" />
      {text}
      <input type="file" accept="image/*" className="hidden" />
    </label>
  );
}

export type RowAction = { label: string; onClick: (i: number) => void; danger?: boolean; hidden?: (i: number) => boolean };

/** Table on desktop, stacked label/value cards on mobile. */
export function DataTable({ columns, rows = [], empty = "ไม่พบข้อมูล", actions, badgeCols = [], search = true }: { columns: string[]; rows?: string[][]; empty?: string; actions?: RowAction[]; badgeCols?: number[]; search?: boolean }) {
  const [query,setQuery]=useState("");
  const [page,setPage]=useState(0);
  const PAGE_SIZE=8;
  const filtered=rows.map((r,i)=>({r,i})).filter(({r})=>!query||r.some(v=>v.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
  const current=Math.min(page,pages-1);
  const shown=filtered.slice(current*PAGE_SIZE,(current+1)*PAGE_SIZE);
  const searchId=useId();
  const button=(x:RowAction,i:number)=>x.hidden?.(i)?null:<button type="button" key={x.label} onClick={()=>x.onClick(i)} className={"row-action "+(x.danger?"danger":"")}>{x.label}</button>;
  const cell=(value:string,col:number)=>columns[col]?.includes("สถานะ")||badgeCols.includes(col)?<StatusBadge value={value} />:value;
  const blank=<div className="empty-state"><Icon name="search" /><p>{query?"ไม่พบรายการที่ตรงกับคำค้นหา":empty}</p>{query&&<button className="mt-3 text-sm text-plum-700" onClick={()=>{setQuery("");setPage(0);}}>ล้างคำค้นหา</button>}</div>;
  return <div className="data-table-container"><div className="table-toolbar">{search?<div className="table-search"><Icon name="search" /><input id={searchId} aria-label="ค้นหาในรายการ" placeholder="ค้นหาในรายการ…" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}} /></div>:<span />}<span className="table-count" aria-live="polite">{filtered.length} รายการ</span></div><div className="table-scroll hidden md:block"><table className="data-table"><thead><tr>{columns.map((c,i)=><th scope="col" key={i}>{c.replace(/\s*\([^)]*\)/g,"")}</th>)}{actions&&<th scope="col" className="cell-actions">จัดการ</th>}</tr></thead><tbody>{shown.length?shown.map(({r,i})=><tr key={i}>{r.map((c,j)=><td key={j}>{cell(c,j)}</td>)}{actions&&<td className="cell-actions"><div className="row-actions">{actions.map(x=>button(x,i))}</div></td>}</tr>):<tr><td colSpan={columns.length+(actions?1:0)}>{blank}</td></tr>}</tbody></table></div><div className="space-y-3 md:hidden">{shown.length?shown.map(({r,i})=><dl className="mobile-data-row" key={i}>{r.map((c,j)=><div key={j}><dt>{columns[j]?.replace(/\s*\([^)]*\)/g,"")}</dt><dd>{cell(c,j)}</dd></div>)}{actions&&<div className="row-actions border-t border-cream-200 pt-3">{actions.map(x=>button(x,i))}</div>}</dl>):blank}</div><div className="table-pagination"><span>{filtered.length?(current*PAGE_SIZE+1)+"–"+Math.min((current+1)*PAGE_SIZE,filtered.length)+" จาก "+filtered.length+" รายการ":"0 รายการ"}</span><div className="table-pagination-controls"><button type="button" disabled={current===0} aria-label="หน้าก่อนหน้า" onClick={()=>setPage(current-1)}><Icon name="chevron" className="h-3.5 w-3.5 rotate-90" /></button><span>หน้า {current+1} / {pages}</span><button type="button" disabled={current>=pages-1} aria-label="หน้าถัดไป" onClick={()=>setPage(current+1)}><Icon name="chevron" className="h-3.5 w-3.5 -rotate-90" /></button></div></div></div>;
}

/** readOnly: ระบบเป็นคนกำหนดค่า (เช่น เลขที่เอกสาร) แสดงอย่างเดียวแม้ในโหมดแก้ไข */
export type FieldDef = { label: string; options?: string[]; type?: string; area?: boolean; required?: boolean; wide?: boolean; readOnly?: boolean; placeholder?: string; suggest?: string[] };

/** เวลาแบบ 24 ชั่วโมง (เช่น 13:50 น.) ไม่ขึ้นกับภาษา/รูปแบบ AM-PM ของเบราว์เซอร์ · ค่าเป็น "HH:MM" */
export function TimeInput({ value, required, onChange }: { value: string; required?: boolean; onChange: (v: string) => void }) {
  const [h, m] = /^\d{2}:\d{2}/.test(value) ? value.slice(0, 5).split(":") : ["", ""];
  const pad = (n: number) => String(n).padStart(2, "0");
  const set = (nh: string, nm: string) => onChange(nh || nm ? `${nh || "00"}:${nm || "00"}` : "");
  return (
    <div className="flex items-center gap-2">
      <select value={h} required={required} onChange={(e) => set(e.target.value, m)} aria-label="ชั่วโมง">
        <option value="">ชม.</option>
        {Array.from({ length: 24 }, (_, i) => <option key={i} value={pad(i)}>{pad(i)}</option>)}
      </select>
      <span className="text-gold-600">:</span>
      <select value={m} required={required} onChange={(e) => set(h, e.target.value)} aria-label="นาที">
        <option value="">นาที</option>
        {Array.from({ length: 60 }, (_, i) => <option key={i} value={pad(i)}>{pad(i)}</option>)}
      </select>
      <span className="whitespace-nowrap text-sm text-gold-600">น.</span>
    </div>
  );
}

/** ช่องพิมพ์ค้นหา + รายการให้เลือก (พิมพ์ชื่ออื่นเองได้ เช่น ญาติพาไปเอง) */
export function SuggestInput({ value, options, placeholder, onChange }: { value: string; options: string[]; placeholder?: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const q = value.trim().toLowerCase();
  const list = options.filter((o) => !q || o.toLowerCase().includes(q)).slice(0, 30);
  return (
    <div className="relative">
      <input type="text" value={value} placeholder={placeholder} autoComplete="off" onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && list.length > 0 && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-2xl border border-gold-200 bg-white py-1 shadow-lg">
          {list.map((o) => (
            <li key={o}><button type="button" className="block w-full px-4 py-2 text-left text-sm hover:bg-cream-50" onMouseDown={(e) => { e.preventDefault(); onChange(o); setOpen(false); }}>{o}</button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** ฟอร์มเพิ่ม / แก้ไข / ดูรายละเอียด สำหรับหนึ่งรายการ (ค่าเก็บเป็น string[] ตามลำดับ fields) */
export function FormDialog({ open, mode, title, fields, value, onClose, onSave, saveLabel = "บันทึก" }: {
  open: boolean; mode: "add" | "edit" | "view"; title: string; fields: FieldDef[]; value?: string[];
  onClose: () => void; onSave: (v: string[]) => void; saveLabel?: string;
}) {
  const blank = () => fields.map(() => "");
  const [v, setV] = useState<string[]>(blank());
  useEffect(() => { if (open) setV(value ? [...value] : blank()); /* eslint-disable-next-line */ }, [open, value]);
  const view = mode === "view";
  const set = (i: number, x: string) => setV(v.map((o, j) => (j === i ? x : o)));
  return (
    <Modal
      open={open} wide={fields.length > 6} title={title} onClose={onClose}
      footer={view ? <><button className="btn-soft" onClick={() => window.print()}><Icon name="print" className="h-4 w-4" /> พิมพ์เอกสาร</button><button className="btn-primary" onClick={onClose}>ปิด</button></> : (
        <><button type="button" className="btn-soft" onClick={onClose}>ยกเลิก</button><button form="form-dialog" className="btn-primary">{saveLabel}</button></>
      )}
    >
      <div className="form-intro">{view ? "รายละเอียดข้อมูลที่บันทึกไว้ในระบบ" : "กรอกข้อมูลให้ครบถ้วน ช่องที่มีเครื่องหมาย * เป็นข้อมูลที่จำเป็น"}</div>
      <form id="form-dialog" onSubmit={(e) => { e.preventDefault(); onSave(v); }} className="form-grid">
        {fields.map((f, i) => (
          <Field key={f.label} label={f.label} required={f.required && !view} className={f.wide || f.area ? "md:col-span-2" : ""}>
            {view || f.readOnly ? (
              <p className="field-view">{v[i] || "-"}</p>
            ) : f.options ? (
              <select value={v[i] ?? ""} required={f.required} onChange={(e) => set(i, e.target.value)}>
                <option value="">-- เลือก --</option>
                {f.options.map((o) => <option key={o}>{o}</option>)}
              </select>
            ) : f.type === "time" ? (
              <TimeInput value={v[i] ?? ""} required={f.required} onChange={(x) => set(i, x)} />
            ) : f.suggest ? (
              <SuggestInput value={v[i] ?? ""} options={f.suggest} placeholder={f.placeholder} onChange={(x) => set(i, x)} />
            ) : f.area ? (
              <textarea rows={2} value={v[i] ?? ""} onChange={(e) => set(i, e.target.value)} />
            ) : (
              <input type={f.type ?? "text"} value={v[i] ?? ""} required={f.required} placeholder={f.placeholder} onChange={(e) => set(i, e.target.value)} />
            )}
          </Field>
        ))}
      </form>
      {view && <PrintSignatures />}
    </Modal>
  );
}

/* ---------- หัวกระดาษและท้ายกระดาษ (แสดงเฉพาะตอนพิมพ์) ---------- */
export const COMPANY = {
  th: "บริษัท ทีทรี สโตรก เนอสซิ่งโฮม จำกัด",
  brand: "KIN Rehabilitation & Homecare",
  address: "6 ซอยนาคนิวาส 18 (ลาดพร้าว 71) แขวงลาดพร้าว เขตลาดพร้าว กรุงเทพมหานคร 10230",
  contact: "โทร 02-096-4996 · kinrehab.com",
};
const printedAt = () => new Date().toLocaleString("th-TH", { dateStyle: "long", timeStyle: "short" });

/** หัวกระดาษบริษัท: โลโก้ ชื่อบริษัท ที่อยู่ ชื่อเอกสาร และวันที่พิมพ์ */
export function PrintLetterhead({ title, className = "" }: { title?: string; className?: string }) {
  return (
    <div className={"print-only print-letterhead " + className}>
      <div className="print-letterhead-row">
        <img src="/logo-mark.png" alt="KIN" className="print-logo" />
        <div className="print-company">
          <strong>{COMPANY.brand}</strong>
          <span>{COMPANY.th}</span>
          <small>{COMPANY.address}</small>
          <small>{COMPANY.contact}</small>
        </div>
        <div className="print-meta"><span>วันที่พิมพ์</span><b>{printedAt()}</b></div>
      </div>
      {title && <h1 className="print-title">{title}</h1>}
    </div>
  );
}

/** ท้ายกระดาษ: ข้อความกำกับเอกสาร */
export function PrintFooter() {
  return <div className="print-only print-footer"><span>{COMPANY.brand} · THE ART OF CARE</span><span>เอกสารนี้พิมพ์จากระบบ KIN Care Management · ใช้ภายในองค์กร</span></div>;
}

/** ช่องลงชื่อท้ายเอกสาร */
export function PrintSignatures({ roles = ["ผู้บันทึก", "ผู้ตรวจสอบ"] }: { roles?: string[] }) {
  return (
    <div className="print-only print-signatures">
      {roles.map((r) => <div key={r}><div className="print-sign-line" /><p>({r})</p><p>วันที่ ........./........./.........</p></div>)}
    </div>
  );
}

/** ตัวอย่างแบบฟอร์มเปล่า สำหรับพิมพ์ */
export function BlankForm({ open, title, lines, onClose }: { open: boolean; title: string; lines: string[]; onClose: () => void }) {
  return (
    <Modal open={open} wide title={title} onClose={onClose} footer={<><button className="btn-soft" onClick={onClose}>ปิด</button><button className="btn-primary" onClick={() => window.print()}>พิมพ์</button></>}>
      <div className="rounded-xl border border-cream-300 p-5">
        <p className="print-hide mb-5 text-center font-semibold text-gold-800">{title}</p>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {lines.map((l) => (
            <div key={l} className="text-sm"><span className="text-gold-700">{l}</span><div className="mt-5 border-b border-dashed border-gold-400" /></div>
          ))}
        </div>
      </div>
      <PrintSignatures roles={["ผู้ให้ข้อมูล", "เจ้าหน้าที่ผู้บันทึก"]} />
    </Modal>
  );
}

export function Modal({ open, title, onClose, children, footer, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const titleId=useId();
  const panel=useRef<HTMLDivElement>(null);
  const closeRef=useRef(onClose); closeRef.current=onClose;
  const [stackId,setStackId]=useState<number|null>(null);
  const notice=useNotice(stackId);
  useEffect(()=>{if(!open)return;const id=openModal();setStackId(id);return()=>{closeModal(id);setStackId(null);};},[open]);
  const noteRef=useRef<HTMLParagraphElement>(null);
  useEffect(()=>{if(notice)noteRef.current?.scrollIntoView({block:"nearest",behavior:"smooth"});},[notice]);
  useEffect(()=>{
    if(!open)return;
    const previous=document.activeElement as HTMLElement|null;
    const oldOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    const focusable=()=>Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]')||[]).filter(el=>el.getClientRects().length>0);
    (focusable()[0]||panel.current)?.focus();
    const key=(e:KeyboardEvent)=>{if(e.key==="Escape"){e.stopPropagation();closeRef.current();}if(e.key==="Tab"){const list=focusable();if(!list.length){e.preventDefault();return;}const first=list[0],last=list[list.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};
    window.addEventListener("keydown",key);
    return()=>{window.removeEventListener("keydown",key);document.body.style.overflow=oldOverflow;previous?.focus();};
  },[open]);
  if(!open)return null;
  // แสดงที่ document.body เสมอ: ถ้าอยู่ใต้กล่องที่มี backdrop-filter/transform (เช่นแถบด้านบน) popup จะถูกจำกัดอยู่ในกล่องนั้น
  const node = <div className="modal-overlay" onClick={onClose}><div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className={"modal-panel "+(wide?"is-wide":"")} onClick={e=>e.stopPropagation()}><div className="modal-header"><h3 id={titleId}>{title}</h3><button type="button" className="icon-button" onClick={onClose} aria-label="ปิดหน้าต่าง"><Icon name="close" className="h-4 w-4" /></button></div><div className="modal-body" onInput={clearNotice} onChange={clearNotice}><PrintLetterhead title={title} />{children}<PrintFooter /></div>{notice&&<p ref={noteRef} role="alert" className="modal-notice"><Icon name="alert" className="h-4 w-4 shrink-0" />{notice}</p>}{footer&&<div className="modal-footer">{footer}</div>}</div></div>;
  return typeof document === "undefined" ? node : createPortal(node, document.body);
}

export function Toggle({ label, hint }: { label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-cream-300 bg-cream-50 p-4">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="text-xs text-gold-600">{hint}</span>}
      </span>
      <input type="checkbox" className="peer sr-only" />
      <span className="relative h-6 w-11 shrink-0 rounded-full bg-cream-300 transition peer-checked:bg-gold-600 after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-5" />
    </label>
  );
}

export function Tabs({tabs,value,onChange}:{tabs:string[];value:string;onChange:(v:string)=>void}) {
  return <div className="segmented-tabs" role="group" aria-label="เลือกมุมมอง">{tabs.map(t=><button type="button" key={t} className={value===t?"is-selected":""} aria-pressed={value===t} onClick={()=>onChange(t)}>{t}</button>)}</div>;
}

export const SearchBox = ({ placeholder }: { placeholder: string }) => (
  <div className="relative">
    <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gold-400" />
    <input placeholder={placeholder} className="!pl-10" />
  </div>
);
