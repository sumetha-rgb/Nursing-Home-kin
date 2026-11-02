"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "./Icon";

const norm = (s: string) => s.toLocaleLowerCase().replace(/\s+/g, "");
const splitTags = (v: string) => v.split(/\s*,\s*/).map((x) => x.trim()).filter(Boolean);

/** ปุ่มเลือกค่าเดียว (กดซ้ำ = ยกเลิก) · ใช้กับ เกี่ยวข้อง สิทธิ์การรักษา */
export function ChipChoice({ options, value, onChange, label }: { options: string[]; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
      {options.map((o) => <button key={o} type="button" aria-pressed={value === o} onClick={() => onChange(value === o ? "" : o)}
        className={`rounded-full px-3 py-1.5 text-sm transition ${value === o ? "bg-gold-700 font-medium text-white" : "border border-cream-300 bg-white text-gold-700 hover:border-gold-300"}`}>{o}</button>)}
    </div>
  );
}

/**
 * หลายค่าคั่นด้วยจุลภาค: พิมพ์แล้วขึ้นรายการที่ตรง กดหรือ Enter เพื่อเพิ่ม · ปุ่มลัดด้านล่างกดเพิ่มได้เลย
 * none: ปุ่ม "ไม่มีประวัติแพ้" (เลือกแล้วล้างรายการอื่น)
 */
export function TagInput({ value, onChange, suggestions, quick = [], none, placeholder, label }: {
  value: string; onChange: (v: string) => void; suggestions: string[]; quick?: string[]; none?: string; placeholder?: string; label: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const tags = none && value === none ? [] : splitTags(value);
  const isNone = !!none && value === none;
  const add = (t: string) => { const x = t.trim(); if (!x) return; if (!tags.some((y) => norm(y) === norm(x))) onChange([...tags, x].join(", ")); setQ(""); };
  const list = useMemo(() => { const t = norm(q); return t ? suggestions.filter((s) => norm(s).includes(t) && !tags.some((y) => norm(y) === norm(s))).slice(0, 8) : []; }, [q, suggestions, tags]);
  const chip = (t: string, ok?: boolean) => (
    <span key={t} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-sm font-medium ${ok ? "bg-emerald-50 text-emerald-800" : "bg-gold-100 text-gold-800"}`}>{t}
      <button type="button" aria-label={`ลบ ${t}`} className="rounded-full p-0.5 hover:bg-white/70" onClick={(e) => { e.stopPropagation(); onChange(ok ? "" : tags.filter((y) => y !== t).join(", ")); }}><Icon name="close" className="h-3 w-3" /></button>
    </span>
  );
  // ป้ายที่เลือกอยู่ในกรอบเดียวกับช่องพิมพ์ (กดที่กรอบ = เริ่มพิมพ์)
  return (
    <div className="space-y-2">
      <div className="relative">
        <div onClick={() => ref.current?.focus()}
          className="flex min-h-[42px] w-full cursor-text flex-wrap items-center gap-1.5 rounded-[10px] border border-[var(--border)] bg-white px-2.5 py-1.5 transition focus-within:border-[#b8975e] focus-within:shadow-[0_0_0_3px_var(--ring-soft)]">
          {isNone ? chip(none!, true) : tags.map((t) => chip(t))}
          {!isNone && <input ref={ref} value={q} placeholder={tags.length ? "พิมพ์เพิ่ม…" : placeholder} aria-label={label} autoComplete="off"
            className="!min-h-0 min-w-[140px] flex-1 !border-0 !bg-transparent !px-1.5 !py-1 !shadow-none"
            onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => { setTimeout(() => setOpen(false), 150); if (q.trim()) add(q); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(list[0] && norm(list[0]).startsWith(norm(q)) ? list[0] : q); } else if (e.key === "Backspace" && !q && tags.length) onChange(tags.slice(0, -1).join(", ")); }} />}
        </div>
        {open && list.length > 0 && <div className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-2xl border border-gold-200 bg-white py-1 shadow-lg">
          {list.map((s) => <button key={s} type="button" className="block w-full px-4 py-2 text-left text-sm text-gold-800 hover:bg-cream-50" onMouseDown={(e) => { e.preventDefault(); add(s); }}>{s}</button>)}
        </div>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {none && !isNone && !tags.length && <button type="button" onClick={() => onChange(none)} className="rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800 hover:border-emerald-500">{none}</button>}
        {!isNone && quick.filter((x) => !tags.includes(x)).map((x) => <button key={x} type="button" onClick={() => add(x)} className="rounded-full border border-cream-300 bg-white px-3 py-1 text-xs text-gold-700 hover:border-gold-300">+ {x}</button>)}
      </div>
    </div>
  );
}

/** ช่องข้อความเดียว + รายการที่เคยกรอก (พิมพ์แล้วขึ้น) */
export function SuggestText({ value, onChange, options, placeholder, label, onPick, renderSub, inputClass }: {
  value: string; onChange: (v: string) => void; options: string[]; placeholder?: string; label: string; onPick?: (v: string) => void; renderSub?: (v: string) => string; inputClass?: string;
}) {
  const [open, setOpen] = useState(false);
  const t = norm(value);
  const list = t.length >= 2 ? options.filter((o) => norm(o).includes(t) && norm(o) !== t).slice(0, 8) : [];
  return (
    <div className="relative">
      <input value={value} placeholder={placeholder} aria-label={label} autoComplete="off" className={inputClass} onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }} />
      {open && list.length > 0 && <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-2xl border border-gold-200 bg-white py-1 shadow-lg">
        {list.map((o) => <button key={o} type="button" className="block w-full px-4 py-2 text-left hover:bg-cream-50" onMouseDown={(e) => { e.preventDefault(); onChange(o); onPick?.(o); setOpen(false); }}>
          <span className="block text-sm text-gold-800">{o}</span>{renderSub && <span className="block text-xs text-gold-500">{renderSub(o)}</span>}
        </button>)}
      </div>}
    </div>
  );
}

/** ค้นหาแขวง/ตำบล เขต/อำเภอ จังหวัด หรือรหัสไปรษณีย์ แล้วเติมท้ายที่อยู่ให้ (โหลดข้อมูลเมื่อใช้ครั้งแรก) */
type Addr = [string, string, string, string];
let addrCache: Addr[] | null = null;
export function AddressFinder({ onPick }: { onPick: (text: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Addr[] | null>(addrCache);
  const [err, setErr] = useState(false);
  useEffect(() => {
    if (!open || data) return;
    fetch("/thai-address.json").then((r) => r.json()).then((d: Addr[]) => { addrCache = d; setData(d); }).catch(() => setErr(true));
  }, [open, data]);
  const t = norm(q);
  const list = data && t.length >= 2 ? data.filter((a) => (/^\d+$/.test(t) ? a[3].startsWith(t) : norm(a[0]).includes(t) || norm(a[1]).includes(t))).slice(0, 12) : [];
  const text = (a: Addr) => (a[2] === "กรุงเทพมหานคร" ? `แขวง${a[0]} เขต${a[1]} ${a[2]} ${a[3]}` : `ตำบล${a[0]} อำเภอ${a[1]} จังหวัด${a[2]} ${a[3]}`);
  return (
    <div className="relative">
      <Icon name="search" className="pointer-events-none absolute left-3 top-[22px] h-4 w-4 -translate-y-1/2 text-gold-400" />
      <input value={q} className="!pl-9" placeholder="ค้นหาแขวง/ตำบล เขต/อำเภอ หรือรหัสไปรษณีย์ เช่น 10260, บางนา" aria-label="ค้นหาตำบลหรือรหัสไปรษณีย์" autoComplete="off"
        onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} />
      {open && t.length >= 2 && <div className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-2xl border border-gold-200 bg-white py-1 shadow-lg">
        {err ? <p className="px-4 py-3 text-sm text-gold-500">โหลดข้อมูลที่อยู่ไม่สำเร็จ พิมพ์ที่อยู่เองได้</p>
          : !data ? <p className="px-4 py-3 text-sm text-gold-500">กำลังโหลดข้อมูลที่อยู่…</p>
          : !list.length ? <p className="px-4 py-3 text-sm text-gold-500">ไม่พบ &quot;{q}&quot;</p>
          : list.map((a, i) => <button key={i} type="button" className="block w-full px-4 py-2 text-left text-sm text-gold-800 hover:bg-cream-50" onMouseDown={(e) => { e.preventDefault(); onPick(text(a)); setQ(""); setOpen(false); }}>{text(a)}</button>)}
      </div>}
    </div>
  );
}
