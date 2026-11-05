"use client";
import { useState } from "react";
import Icon from "./Icon";
import { money, svcDiscount, svcNet } from "@/lib/billing";
import { pickName, priceList, PriceItem, Rate, rateCode, rateText, searchPrices } from "@/lib/priceList";
import { usePriceList } from "@/lib/usePrices";

/** รายการค่าบริการในเอกสาร (ใบเสนอราคา / สัญญา) · pct = ส่วนลด (% ของยอดบรรทัด) · discount = ส่วนลดเป็นบาท (ข้อมูลเดิม) */
export type ServiceLine = { desc: string; qty: number; unit: string; price: number; discount?: number; pct?: number; code?: string };
const UNITS = ["เดือน", "สัปดาห์", "วัน", "ครั้ง", "แพ็กเกจ", "ชุด", "รายการ"];

/**
 * ช่องค้นหาค่าบริการจากใบราคา: พิมพ์อย่างน้อย 2 ตัวอักษร หรือกดปุ่มหมวดเพื่อดูทุกรายการในหมวดนั้น
 * กดราคาที่ต้องการ (รายครั้ง / รายวัน / รายเดือน) แล้วเพิ่มเป็นบรรทัดใหม่ แก้จำนวนและราคาต่อได้
 * exclude: หมวดที่ไม่แสดง (สัญญาเลือกค่าห้องที่ช่องค่าห้องแล้ว)
 */
export function ServicePicker({ onPick, exclude = [] }: { onPick: (line: ServiceLine) => void; exclude?: string[] }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cat, setCat] = useState("");
  usePriceList();
  const all = priceList();
  /** หมวดในใบราคา (ตามลำดับในใบราคา) */
  const groups = [...new Set(all.map((x) => x.group))].filter((g) => !exclude.includes(g));
  const k = q.replace(/\s+/g, "").toLowerCase();
  const list = (cat ? all.filter((x) => x.group === cat && (!k || (x.name + x.code).replace(/\s+/g, "").toLowerCase().includes(k))) : searchPrices(q)).filter((x) => !exclude.includes(x.group));
  const show = !!cat || open;
  const pick = (x: PriceItem, r: Rate) => {
    onPick({ desc: pickName(x), qty: 1, unit: r.unit, price: r.price, code: rateCode(x, x.rates.indexOf(r)) });
    setQ(""); setOpen(false); setCat("");
  };
  return (
    <div className="relative">
      <div className="relative">
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold-400" />
        <input value={q} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
          className="!pl-9" placeholder={cat ? `ค้นหาในหมวด ${cat}` : "ค้นหาค่าบริการจากใบราคา เช่น ออกซิเจน, ดูดเสมหะ, ทีมฟื้นฟู"} aria-label="ค้นหาค่าบริการ" autoComplete="off" />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label="หมวดค่าบริการ">
        <span className="text-xs text-gold-500">หมวด:</span>
        {groups.map((g) => (
          <button key={g} type="button" aria-pressed={cat === g} onClick={() => setCat(cat === g ? "" : g)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${cat === g ? "bg-gold-700 text-white" : "border border-cream-300 bg-white text-gold-700 hover:border-gold-300"}`}>
            {g} <span className={cat === g ? "text-white/80" : "text-gold-400"}>{all.filter((x) => x.group === g).length}</span>
          </button>
        ))}
      </div>
      {show && (
        <div className="absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-2xl border border-gold-200 bg-white py-1 shadow-lg">
          {cat && <div className="sticky top-0 flex items-center justify-between border-b border-cream-200 bg-white px-4 py-2 text-xs text-gold-600">
            <span>หมวด {cat} · {list.length} รายการ</span>
            <button type="button" className="text-gold-700 underline-offset-2 hover:underline" onMouseDown={(e) => { e.preventDefault(); setCat(""); }}>ปิด</button>
          </div>}
          {!cat && k.length < 2 ? <p className="px-4 py-3 text-sm text-gold-500">พิมพ์อย่างน้อย 2 ตัวอักษรเพื่อค้นหา หรือกดปุ่มหมวดด้านล่างช่องค้นหา</p>
            : !list.length ? <p className="px-4 py-3 text-sm text-gold-500">ไม่พบ &quot;{q}&quot;{cat ? ` ในหมวด ${cat}` : " ในใบราคา"} · เพิ่มเป็นรายการเองด้วยปุ่ม &quot;เพิ่มรายการเอง&quot;</p>
            : list.map((x) => (
              <div key={x.code} className="border-b border-cream-200 px-4 py-2.5 last:border-0">
                <p className="text-sm font-medium text-gold-800"><span className="pl-code mr-1.5">{x.code}</span>{x.name}</p>
                {!cat && <p className="mb-1.5 text-xs text-gold-500">{x.group}</p>}
                <div className={`flex flex-wrap gap-1.5 ${cat ? "mt-1.5" : ""}`}>{x.rates.map((r, j) => (
                  <button key={j} type="button" className="rounded-lg border border-gold-300 bg-cream-50 px-2.5 py-1 text-xs font-medium text-gold-800 hover:border-gold-600 hover:bg-gold-100"
                    onMouseDown={(e) => { e.preventDefault(); pick(x, r); }}>+ {rateText(r)}</button>
                ))}</div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

/** ตารางแก้รายการ: ค้นหาจากใบราคา หรือพิมพ์เองก็ได้ · price 0 = รวมในโปรแกรม (ไม่คิดเพิ่ม) · แต่ละบรรทัดแสดงรวม = จำนวน × ราคาต่อหน่วย − ส่วนลด */
export function ServiceLines({ items, onChange, total = true, exclude }: { items: ServiceLine[]; onChange: (x: ServiceLine[]) => void; total?: boolean; exclude?: string[] }) {
  const add = (line: ServiceLine) => onChange([...items.filter((x) => x.desc.trim()), line]);
  return (
    <div className="space-y-2">
      <ServicePicker onPick={add} exclude={exclude} />
      {items.length > 0 && <div className="quote-line quote-head" aria-hidden="true"><span>รายการ</span><span>จำนวน</span><span>หน่วย</span><span>ราคาต่อหน่วย</span><span>ส่วนลด (%)</span><span className="text-right">รวม (บาท)</span><span /></div>}
      {items.map((x, k) => {
        const set = (p: Partial<ServiceLine>) => onChange(items.map((y, j) => (j === k ? { ...y, ...p } : y)));
        return (
          <div key={k} className="quote-line">
            <input value={x.desc} onChange={(e) => set({ desc: e.target.value, code: undefined })} placeholder="รายการ" aria-label="รายการ" />
            <input type="number" min={0} value={x.qty} onChange={(e) => set({ qty: Number(e.target.value) || 0 })} aria-label="จำนวน" />
            <select value={x.unit} onChange={(e) => set({ unit: e.target.value })} aria-label="หน่วย">{(UNITS.includes(x.unit) ? UNITS : [x.unit, ...UNITS]).map((u) => <option key={u}>{u}</option>)}</select>
            <input type="number" min={0} value={x.price} onChange={(e) => set({ price: Number(e.target.value) || 0 })} aria-label="ราคาต่อหน่วย" />
            <input type="number" min={0} max={100} step="0.5" value={x.pct || ""} placeholder="0" disabled={!x.price} onChange={(e) => set({ pct: Math.min(100, Math.max(0, Number(e.target.value) || 0)), discount: 0 })} aria-label="ส่วนลด (%)" />
            <b className="quote-sum" aria-label="รวมบรรทัดนี้">{x.price ? <>{money(svcNet(x))}{svcDiscount(x) ? <small className="block font-normal text-gold-500">ลด {money(svcDiscount(x))}</small> : null}</> : "รวมในโปรแกรม"}</b>
            <button type="button" className="row-action danger" onClick={() => onChange(items.filter((_, j) => j !== k))}>ลบ</button>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button type="button" className="btn-soft !py-2" onClick={() => onChange([...items, { desc: "", qty: 1, unit: "ครั้ง", price: 0 }])}><Icon name="plus" className="h-4 w-4" /> เพิ่มรายการเอง</button>
        {total && <b className="text-gold-800">รวม {money(items.reduce((n, x) => n + svcNet(x), 0))} บาท</b>}
      </div>
    </div>
  );
}
