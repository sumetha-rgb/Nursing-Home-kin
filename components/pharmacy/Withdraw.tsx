"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Icon from "../Icon";
import { useApp } from "@/lib/app";
import { Drug, isLiquid, MEALS, stockText } from "@/lib/pharmacy";
import { refreshData } from "@/lib/store";
import { PageHeader } from "../ui";
import { ResidentPicker } from "../SearchSelect";

/**
 * เบิกยา (แอปห้องยา): เบิกยาจากตะกร้าผู้ป่วยตามจำนวนที่ใช้จริง
 *  ยาน้ำ (ml) ยาขวด ยาทา ยาพ่น ยาเมื่อมีอาการ · ยาเม็ดตามมื้อตัดตอนจัดซองที่เมนูจัดยารายวัน (เปิด "แสดงยาเม็ด" เพื่อเบิกยาเม็ดครั้งคราว)
 *  เบิกที่ server (ตัดคงเหลือแบบมีเงื่อนไข) แล้วเก็บเป็นรายการ → ไทม์ไลน์ประวัติด้านขวา และแท็บยาในประวัติผู้รับบริการ
 *  Layout: จอกว้าง 2 คอลัมน์ (ซ้าย = ผู้ป่วย + การ์ดยา · ขวา = ประวัติแบบไทม์ไลน์ ตรึงไว้) · มือถือเรียงลงมา
 */
type Item = { id: string; med_id: string | null; name: string; qty: number; unit: string | null; b: number | null; s: number | null; meal: string | null; note: string | null; by: string | null; at: string; ts: string; legacy?: boolean };
type Form = { qty: string; meal: string; note: string };
const PRN = "ตามอาการ";
const MEAL_OPTS = [...MEALS, PRN];
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round(n * 100) / 100;

async function call<T>(url: string, body?: object): Promise<T> {
  const r = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "ทำรายการไม่สำเร็จ");
  return d as T;
}
/** มื้อตามเวลาตอนนี้ (ค่าเริ่มต้น) */
const mealNow = () => { const h = new Date().getHours(); return h < 10 ? "เช้า" : h < 14 ? "กลางวัน" : h < 19 ? "เย็น" : "ก่อนนอน"; };
const bkk = (offsetDays = 0) => new Date(Date.now() + 7 * 3600e3 - offsetDays * 864e5).toISOString().slice(0, 10);
const dayLabel = (d: string) => {
  if (d === bkk()) return "วันนี้";
  if (d === bkk(1)) return "เมื่อวาน";
  const [y, m, dd] = d.split("-");
  return `${dd}/${m}/${Number(y) + 543}`;
};

export default function Withdraw({ drugs, names, initialWho, onWho }: { drugs: Drug[]; names: string[]; initialWho?: string; onWho?: (w: string) => void }) {
  const { toast, confirm } = useApp();
  const [who, setWho] = useState(initialWho && names.includes(initialWho) ? initialWho : names[0] ?? "");
  useEffect(() => { if (who && !names.includes(who) && names.length) setWho(names[0]); }, [names]); // eslint-disable-line react-hooks/exhaustive-deps
  const [pills, setPills] = useState(false);
  const [form, setForm] = useState<Record<string, Form>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [hist, setHist] = useState<Item[] | null>(null);
  const [showAll, setShowAll] = useState(false);

  const mine = useMemo(() => drugs.filter((x) => x.who === who), [drugs, who]);
  const fluid = (x: Drug) => x.bulk || isLiquid(x);
  const list = useMemo(() => mine.filter((x) => pills || fluid(x)).sort((a, b) => Number(fluid(b)) - Number(fluid(a)) || a.name.localeCompare(b.name, "th")), [mine, pills]);
  const pillCount = mine.filter((x) => !fluid(x)).length;

  const loadHist = useCallback(() => {
    if (!who) return setHist([]);
    setHist(null); setShowAll(false);
    call<{ items: Item[] }>(`/api/pharmstock?op=withdrawals&resident=${encodeURIComponent(who)}`).then((d) => setHist(d.items)).catch((e) => { setHist([]); toast((e as Error).message); });
  }, [who, toast]);
  useEffect(loadHist, [loadHist]);

  const stepOf = (x: Drug) => (isLiquid(x) ? (x.dose > 0 ? x.dose : 5) : 1);
  const f = (x: Drug): Form => form[x.id] ?? { qty: String(isLiquid(x) ? x.dose || "" : 1), meal: mealNow(), note: "" };
  const setF = (x: Drug, patch: Partial<Form>) => setForm((s) => ({ ...s, [x.id]: { ...f(x), ...patch } }));
  const bump = (x: Drug, dir: 1 | -1) => setF(x, { qty: String(Math.max(0, round2((Number(f(x).qty) || 0) + dir * stepOf(x)))) });

  const go = (x: Drug) => {
    const v = f(x), n = Number(v.qty);
    if (!(n > 0)) return toast("กรุณาระบุจำนวนที่เบิก");
    if (n > x.stock) return toast(`เบิกเกินคงเหลือ · ${x.name} เหลือ ${stockText(x)}`);
    confirm({ title: "ยืนยันเบิกยา", okLabel: "เบิก", message: `เบิก ${x.name} ${fmt(n)} ${x.unit} ให้ ${who} · ${v.meal === PRN ? "ตามอาการ" : `มื้อ${v.meal}`} · คงเหลือ ${fmt(x.stock)} → ${fmt(round2(x.stock - n))} ${x.unit}`,
      onOk: async () => {
        setBusy(String(x.id));
        try {
          const r = await call<{ stock: number }>("/api/pharmstock", { op: "withdraw", medId: String(x.id), qty: n, meal: v.meal === PRN ? PRN : v.meal, note: v.note });
          toast(`เบิกยาแล้ว · ${x.name} ${fmt(n)} ${x.unit} · คงเหลือ ${stockText({ ...x, stock: r.stock })}`);
          setF(x, { note: "" });
          refreshData("pharmacy-drugs"); loadHist();
        } catch (e) { toast((e as Error).message); } finally { setBusy(null); }
      } });
  };

  const today = bkk();
  const todays = (hist ?? []).filter((h) => h.ts.startsWith(today));
  const shown = showAll ? hist ?? [] : (hist ?? []).slice(0, 15);
  const days = useMemo(() => {
    const m = new Map<string, Item[]>();
    for (const h of shown) { const d = h.ts.slice(0, 10); m.set(d, [...(m.get(d) ?? []), h]); }
    return [...m];
  }, [shown]);
  const subOf = (x: Drug) => [x.bulk ? "ยาขวด / ไม่แพ็คซอง" : isLiquid(x) ? `ยาน้ำ · ครั้งละ ${fmt(x.dose)} ml` : `ยาเม็ด · ครั้งละ ${fmt(x.dose)} ${x.unit}`,
    x.meals.length ? `มื้อ ${x.meals.join(", ")}` : "", /\D/.test(x.how ?? "") ? x.how : ""].filter(Boolean).join(" · ");

  return (
    <>
      <PageHeader title="เบิกยา" sub="เบิกยาน้ำ ยาขวด ยาทา และยาตามอาการจากตะกร้าของผู้ป่วยตามจำนวนที่ใช้จริง · ระบบตัดคงเหลือและเก็บประวัติให้" />

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* ---------- ซ้าย: ผู้ป่วย + การ์ดยา ---------- */}
        <div className="min-w-0 space-y-4">
          <div className="card p-4 sm:p-5">
            <label className="mb-1.5 block text-xs font-medium text-gold-600">ผู้สูงอายุ</label>
            <ResidentPicker names={names} requireRoom clearable={false} value={who} ariaLabel="เลือกผู้สูงอายุ" onChange={(v) => { const w = v || names[0] || ""; setWho(w); onWho?.(w); }} />
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-full bg-cream-200 px-3 py-1 text-gold-700">ยาที่เบิกได้ <b>{mine.filter(fluid).length}</b> รายการ</span>
              <span className="rounded-full bg-cream-200 px-3 py-1 text-gold-700">วันนี้เบิกแล้ว <b>{todays.length}</b> ครั้ง</span>
              {pillCount > 0 && <button type="button" aria-pressed={pills} onClick={() => setPills(!pills)}
                className={`ml-auto rounded-full border px-3 py-1 transition ${pills ? "border-gold-600 bg-gold-100 font-medium text-gold-800" : "border-cream-300 bg-white text-gold-600 hover:border-gold-300"}`}>
                {pills ? "✓ " : "+ "}แสดงยาเม็ด ({pillCount})</button>}
            </div>
          </div>

          {list.length === 0 ? (
            <div className="card empty-state"><Icon name="pill" /><p>{mine.length ? "ไม่มียาน้ำ ยาขวด หรือยาทาของผู้ป่วยคนนี้" : `${who || "ผู้ป่วยคนนี้"} ยังไม่มียาในระบบ`}</p>
              <p className="mt-1 text-xs text-gold-500">{mine.length ? "ยาเม็ดตามมื้อตัดคงเหลือตอนจัดซองที่เมนูจัดยารายวัน · กด \"แสดงยาเม็ด\" เพื่อเบิกยาเม็ดครั้งคราว" : "เพิ่มยาได้ที่เมนู ยาของผู้ป่วย (รับเข้า · แก้ไข)"}</p></div>
          ) : list.map((x) => {
            const v = f(x), out = x.stock <= 0, n = Number(v.qty), after = n > 0 ? round2(x.stock - n) : null, over = after !== null && after < 0;
            const full = isLiquid(x) && x.pack ? x.pack : x.received || null;
            const pct = full ? Math.max(0, Math.min(100, Math.round((x.stock / full) * 100))) : null;
            const low = !out && pct !== null && pct <= 20;
            return (
              <article key={x.id} className={`card overflow-hidden ${x.hold ? "opacity-70" : ""}`}>
                <div className="flex items-start justify-between gap-4 p-4 sm:p-5">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-gold-900">{x.name}</h3>
                    <p className="mt-0.5 text-xs text-gold-500">{subOf(x)}{x.hold ? " · งดชั่วคราว" : ""}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-xl font-semibold leading-tight ${out ? "text-red-700" : low ? "text-amber-700" : "text-gold-900"}`}>{out ? "หมด" : `${fmt(x.stock)} ${x.unit}`}</p>
                    <p className="text-xs text-gold-500">{out ? "เติมยาก่อนเบิก" : isLiquid(x) && x.pack ? `≈ ${fmt(round2(x.stock / x.pack))} ขวด` : "คงเหลือ"}</p>
                  </div>
                </div>
                {pct !== null && <div className="mx-4 -mt-1 mb-4 h-1.5 overflow-hidden rounded-full bg-cream-300 sm:mx-5"><i className={`block h-full rounded-full ${low ? "bg-amber-500" : "bg-gold-600"}`} style={{ width: `${pct}%` }} /></div>}

                <div className="space-y-3 border-t border-cream-200 bg-cream-50/60 p-4 sm:px-5">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gold-600">จำนวน</span>
                      <div className="flex items-center overflow-hidden rounded-xl border border-cream-300 bg-white">
                        <button type="button" className="h-10 w-10 text-lg text-gold-700 hover:bg-cream-100 disabled:opacity-40" aria-label="ลด" disabled={out} onClick={() => bump(x, -1)}>−</button>
                        <input type="number" inputMode="decimal" min={0} className="!h-10 !min-h-0 !w-16 !rounded-none !border-0 !px-1 text-center font-medium" aria-label={`จำนวนที่เบิก ${x.name}`} value={v.qty} disabled={out} onChange={(e) => setF(x, { qty: e.target.value })} />
                        <button type="button" className="h-10 w-10 text-lg text-gold-700 hover:bg-cream-100 disabled:opacity-40" aria-label="เพิ่ม" disabled={out} onClick={() => bump(x, 1)}>+</button>
                      </div>
                      <span className="text-sm text-gold-600">{x.unit}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="มื้อ">
                      {MEAL_OPTS.map((m) => <button key={m} type="button" aria-pressed={v.meal === m} disabled={out} onClick={() => setF(x, { meal: m })}
                        className={`rounded-full border px-3 py-1.5 text-sm transition disabled:opacity-40 ${v.meal === m ? "border-gold-700 bg-gold-700 font-medium text-white" : "border-cream-300 bg-white text-gold-700 hover:border-gold-300"}`}>{m}</button>)}
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <input aria-label="หมายเหตุ" placeholder="หมายเหตุ (ถ้ามี) เช่น ท้องผูก 3 วัน, ทาแผลก้นกบ" value={v.note} disabled={out} onChange={(e) => setF(x, { note: e.target.value })} />
                    <button className="btn-primary !min-h-[42px] !px-6" disabled={out || over || busy === String(x.id)} onClick={() => go(x)}><Icon name="download" className="h-4 w-4" /> {busy === String(x.id) ? "กำลังเบิก…" : "เบิกยา"}</button>
                  </div>
                  {after !== null && !out && <p className={`text-xs ${over ? "font-medium text-red-700" : "text-gold-600"}`}>{over ? `เกินคงเหลือ · เหลือ ${stockText(x)}` : <>คงเหลือ {fmt(x.stock)} → <b>{stockText({ ...x, stock: after })}</b> หลังเบิก</>}</p>}
                </div>
              </article>
            );
          })}
        </div>

        {/* ---------- ขวา: ประวัติการเบิกแบบไทม์ไลน์ ---------- */}
        <aside className="card p-4 sm:p-5 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6.5rem)] lg:overflow-y-auto">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-gold-900">ประวัติการเบิก</h2>
            {hist && <span className="text-xs text-gold-500">{hist.length} รายการ</span>}
          </div>
          {hist === null ? <p className="py-8 text-center text-sm text-gold-500">กำลังโหลด…</p>
            : !hist.length ? <p className="rounded-xl bg-cream-50 px-4 py-8 text-center text-sm text-gold-500">ยังไม่มีประวัติการเบิกยา</p>
            : <>
              {days.map(([d, items]) => (
                <section key={d} className="mb-4 last:mb-0">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gold-500">{dayLabel(d)}</h3>
                  <ol className="relative space-y-3 border-l border-cream-300 pl-4">
                    {items.map((h) => (
                      <li key={h.id} className="relative">
                        <span className={`absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${h.legacy ? "bg-cream-400" : "bg-gold-600"}`} aria-hidden />
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="min-w-0 text-sm"><span className="mr-1.5 tabular-nums text-gold-500">{h.ts.slice(11, 16)}</span><b className="font-medium text-gold-900">{h.name}</b></p>
                          <span className="shrink-0 text-sm font-semibold tabular-nums text-amber-800">−{fmt(h.qty)} {h.unit ?? ""}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-gold-600">
                          {[h.b !== null && h.s !== null ? `${fmt(h.b)} → ${fmt(h.s)} ${h.unit ?? ""}`.trim() : "", h.meal ? (h.meal === PRN ? "ตามอาการ" : `มื้อ${h.meal}`) : "", h.by].filter(Boolean).join(" · ")}
                        </p>
                        {(h.note || h.legacy) && <p className="mt-0.5 text-xs text-gold-500">
                          {h.legacy && <span className="mr-1.5 rounded bg-cream-200 px-1.5 py-px text-[11px] text-gold-600" title="บันทึกก่อนมีเมนูเบิกยา: คงเหลือที่ลดลง (รวมการตัดตอนจัดซอง)">บันทึกเดิม</span>}{h.note}</p>}
                      </li>
                    ))}
                  </ol>
                </section>
              ))}
              {hist.length > shown.length && <button type="button" className="btn-soft mt-2 w-full !py-2 text-sm" onClick={() => setShowAll(true)}>ดูทั้งหมด ({hist.length} รายการ)</button>}
            </>}
          <p className="mt-4 border-t border-cream-200 pt-3 text-xs text-gold-500">ดูได้ที่ประวัติผู้รับบริการ › ยาและการให้ยา ด้วย</p>
        </aside>
      </div>
    </>
  );
}
