"use client";
import { useState } from "react";
import Icon from "./Icon";
import { money } from "@/lib/billing";
import { PriceItem, Rate, rateText, searchPrices } from "@/lib/priceList";

/** รายการค่าบริการในเอกสาร (ใบเสนอราคา / สัญญา) */
export type ServiceLine = { desc: string; qty: number; unit: string; price: number };
const UNITS = ["เดือน", "สัปดาห์", "วัน", "ครั้ง", "แพ็กเกจ", "ชุด", "รายการ"];

/**
 * ช่องค้นหาค่าบริการจากใบราคา: พิมพ์อย่างน้อย 2 ตัวอักษรจึงแสดงรายการ (รายการเยอะ)
 * กดราคาที่ต้องการ (รายครั้ง / รายวัน / รายเดือน) แล้วเพิ่มเป็นบรรทัดใหม่ แก้จำนวนและราคาต่อได้
 */
export function ServicePicker({ onPick }: { onPick: (line: ServiceLine) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const list = searchPrices(q);
  const pick = (x: PriceItem, r: Rate) => {
    onPick({ desc: x.name, qty: 1, unit: r.unit, price: r.price });
    setQ(""); setOpen(false);
  };
  return (
    <div className="relative">
      <div className="relative">
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold-400" />
        <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="!pl-9" placeholder="ค้นหาค่าบริการจากใบราคา เช่น ออกซิเจน, ห้องเดี่ยว, ทีมฟื้นฟู" aria-label="ค้นหาค่าบริการ" autoComplete="off" />
      </div>
      {open && (
        <div className="absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-2xl border border-gold-200 bg-white py-1 shadow-lg">
          {q.replace(/\s+/g, "").length < 2 ? <p className="px-4 py-3 text-sm text-gold-500">พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหา</p>
            : !list.length ? <p className="px-4 py-3 text-sm text-gold-500">ไม่พบ &quot;{q}&quot; ในใบราคา · เพิ่มเป็นรายการเองด้วยปุ่ม &quot;เพิ่มรายการเอง&quot;</p>
            : list.map((x) => (
              <div key={x.code} className="border-b border-cream-200 px-4 py-2.5 last:border-0">
                <p className="text-sm font-medium text-gold-800">{x.name}</p>
                <p className="mb-1.5 text-xs text-gold-500">{x.group}</p>
                <div className="flex flex-wrap gap-1.5">{x.rates.map((r, k) => (
                  <button key={k} type="button" className="rounded-lg border border-gold-300 bg-cream-50 px-2.5 py-1 text-xs font-medium text-gold-800 hover:border-gold-600 hover:bg-gold-100"
                    onMouseDown={(e) => { e.preventDefault(); pick(x, r); }}>+ {rateText(r)}</button>
                ))}</div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

/** ตารางแก้รายการ: ค้นหาจากใบราคา หรือพิมพ์เองก็ได้ · price 0 = รวมในโปรแกรม (ไม่คิดเพิ่ม) */
export function ServiceLines({ items, onChange, total = true }: { items: ServiceLine[]; onChange: (x: ServiceLine[]) => void; total?: boolean }) {
  const add = (line: ServiceLine) => onChange([...items.filter((x) => x.desc.trim()), line]);
  return (
    <div className="space-y-2">
      <ServicePicker onPick={add} />
      {items.map((x, k) => {
        const set = (p: Partial<ServiceLine>) => onChange(items.map((y, j) => (j === k ? { ...y, ...p } : y)));
        return (
          <div key={k} className="quote-line">
            <input value={x.desc} onChange={(e) => set({ desc: e.target.value })} placeholder="รายการ" aria-label="รายการ" />
            <input type="number" min={0} value={x.qty} onChange={(e) => set({ qty: Number(e.target.value) || 0 })} aria-label="จำนวน" />
            <select value={x.unit} onChange={(e) => set({ unit: e.target.value })} aria-label="หน่วย">{(UNITS.includes(x.unit) ? UNITS : [x.unit, ...UNITS]).map((u) => <option key={u}>{u}</option>)}</select>
            <input type="number" min={0} value={x.price} onChange={(e) => set({ price: Number(e.target.value) || 0 })} aria-label="ราคาต่อหน่วย" />
            <button type="button" className="row-action danger" onClick={() => onChange(items.filter((_, j) => j !== k))}>ลบ</button>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="btn-soft !py-2" onClick={() => onChange([...items, { desc: "", qty: 1, unit: "ครั้ง", price: 0 }])}><Icon name="plus" className="h-4 w-4" /> เพิ่มรายการเอง</button>
        {total && <b className="text-gold-800">รวม {money(items.reduce((n, x) => n + x.qty * x.price, 0))} บาท</b>}
      </div>
    </div>
  );
}
