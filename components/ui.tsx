"use client";
import { ReactNode, useEffect, useState, useId, useRef, Children, isValidElement, cloneElement, ReactElement } from "react";
import Icon from "./Icon";

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
  const success=/^(ตรวจแล้ว|เสร็จแล้ว|เสร็จสิ้น|แก้ไขแล้ว|ใช้งานอยู่|ทำงาน|เปิด|เข้าอยู่|สำเร็จ)/.test(value);
  const warning=/^(รอ|กำลัง|แอดมิท)/.test(value);
  const danger=/^(ปิด|ลาออก|สิ้นสุด|พักงาน)/.test(value);
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

export type RowAction = { label: string; onClick: (i: number) => void; danger?: boolean };

/** Table on desktop, stacked label/value cards on mobile. */
export function DataTable({ columns, rows = [], empty = "ไม่พบข้อมูล", actions }: { columns: string[]; rows?: string[][]; empty?: string; actions?: RowAction[] }) {
  const [query,setQuery]=useState("");
  const [page,setPage]=useState(0);
  const PAGE_SIZE=8;
  const filtered=rows.map((r,i)=>({r,i})).filter(({r})=>!query||r.some(v=>v.toLocaleLowerCase().includes(query.toLocaleLowerCase())));
  const pages=Math.max(1,Math.ceil(filtered.length/PAGE_SIZE));
  const current=Math.min(page,pages-1);
  const shown=filtered.slice(current*PAGE_SIZE,(current+1)*PAGE_SIZE);
  const searchId=useId();
  const button=(x:RowAction,i:number)=><button type="button" key={x.label} onClick={()=>x.onClick(i)} className={"row-action "+(x.danger?"danger":"")}>{x.label}</button>;
  const cell=(value:string,col:number)=>columns[col]?.includes("สถานะ")?<StatusBadge value={value} />:value;
  const blank=<div className="empty-state"><Icon name="search" /><p>{query?"ไม่พบรายการที่ตรงกับคำค้นหา":empty}</p>{query&&<button className="mt-3 text-sm text-plum-700" onClick={()=>{setQuery("");setPage(0);}}>ล้างคำค้นหา</button>}</div>;
  return <div className="data-table-container"><div className="table-toolbar"><div className="table-search"><Icon name="search" /><input id={searchId} aria-label="ค้นหาในรายการ" placeholder="ค้นหาในรายการ…" value={query} onChange={e=>{setQuery(e.target.value);setPage(0);}} /></div><span className="table-count" aria-live="polite">{filtered.length} รายการ</span></div><div className="table-scroll hidden md:block"><table className="data-table"><thead><tr>{columns.map((c,i)=><th scope="col" key={i}>{c.replace(/\s*\([^)]*\)/g,"")}</th>)}{actions&&<th scope="col">จัดการ</th>}</tr></thead><tbody>{shown.length?shown.map(({r,i})=><tr key={i}>{r.map((c,j)=><td key={j}>{cell(c,j)}</td>)}{actions&&<td className="cell-actions"><div className="row-actions">{actions.map(x=>button(x,i))}</div></td>}</tr>):<tr><td colSpan={columns.length+(actions?1:0)}>{blank}</td></tr>}</tbody></table></div><div className="space-y-3 md:hidden">{shown.length?shown.map(({r,i})=><dl className="mobile-data-row" key={i}>{r.map((c,j)=><div key={j}><dt>{columns[j]?.replace(/\s*\([^)]*\)/g,"")}</dt><dd>{cell(c,j)}</dd></div>)}{actions&&<div className="row-actions border-t border-cream-200 pt-3">{actions.map(x=>button(x,i))}</div>}</dl>):blank}</div><div className="table-pagination"><span>{filtered.length?(current*PAGE_SIZE+1)+"–"+Math.min((current+1)*PAGE_SIZE,filtered.length)+" จาก "+filtered.length+" รายการ":"0 รายการ"}</span><div className="table-pagination-controls"><button type="button" disabled={current===0} aria-label="หน้าก่อนหน้า" onClick={()=>setPage(current-1)}><Icon name="chevron" className="h-3.5 w-3.5 rotate-90" /></button><span>หน้า {current+1} / {pages}</span><button type="button" disabled={current>=pages-1} aria-label="หน้าถัดไป" onClick={()=>setPage(current+1)}><Icon name="chevron" className="h-3.5 w-3.5 -rotate-90" /></button></div></div></div>;
}

export type FieldDef = { label: string; options?: string[]; type?: string; area?: boolean; required?: boolean; wide?: boolean };

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
      footer={view ? <button className="btn-primary" onClick={onClose}>ปิด</button> : (
        <><button type="button" className="btn-soft" onClick={onClose}>ยกเลิก</button><button form="form-dialog" className="btn-primary">{saveLabel}</button></>
      )}
    >
      <div className="form-intro">{view ? "รายละเอียดข้อมูลที่บันทึกไว้ในระบบ" : "กรอกข้อมูลให้ครบถ้วน ช่องที่มีเครื่องหมาย * เป็นข้อมูลที่จำเป็น"}</div>
      <form id="form-dialog" onSubmit={(e) => { e.preventDefault(); onSave(v); }} className="form-grid">
        {fields.map((f, i) => (
          <Field key={f.label} label={f.label} required={f.required && !view} className={f.wide || f.area ? "md:col-span-2" : ""}>
            {view ? (
              <p className="min-h-[2.5rem] rounded-xl bg-cream-50 px-3.5 py-2.5 text-sm">{v[i] || "-"}</p>
            ) : f.options ? (
              <select value={v[i] ?? ""} required={f.required} onChange={(e) => set(i, e.target.value)}>
                <option value="">-- เลือก --</option>
                {f.options.map((o) => <option key={o}>{o}</option>)}
              </select>
            ) : f.area ? (
              <textarea rows={2} value={v[i] ?? ""} onChange={(e) => set(i, e.target.value)} />
            ) : (
              <input type={f.type ?? "text"} value={v[i] ?? ""} required={f.required} onChange={(e) => set(i, e.target.value)} />
            )}
          </Field>
        ))}
      </form>
    </Modal>
  );
}

/** ตัวอย่างแบบฟอร์มเปล่า สำหรับพิมพ์ */
export function BlankForm({ open, title, lines, onClose }: { open: boolean; title: string; lines: string[]; onClose: () => void }) {
  return (
    <Modal open={open} wide title={title} onClose={onClose} footer={<><button className="btn-soft" onClick={onClose}>ปิด</button><button className="btn-primary" onClick={() => window.print()}>พิมพ์</button></>}>
      <div className="rounded-xl border border-cream-300 p-5">
        <p className="mb-5 text-center font-semibold text-gold-800">{title}</p>
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
          {lines.map((l) => (
            <div key={l} className="text-sm"><span className="text-gold-700">{l}</span><div className="mt-5 border-b border-dashed border-gold-400" /></div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export function Modal({ open, title, onClose, children, footer, wide }: { open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const titleId=useId();
  const panel=useRef<HTMLDivElement>(null);
  const closeRef=useRef(onClose); closeRef.current=onClose;
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
  return <div className="modal-overlay" onClick={onClose}><div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} className={"modal-panel "+(wide?"is-wide":"")} onClick={e=>e.stopPropagation()}><div className="modal-header"><h3 id={titleId}>{title}</h3><button type="button" className="icon-button" onClick={onClose} aria-label="ปิดหน้าต่าง"><Icon name="close" className="h-4 w-4" /></button></div><div className="modal-body">{children}</div>{footer&&<div className="modal-footer">{footer}</div>}</div></div>;
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
