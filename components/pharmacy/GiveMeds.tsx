"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Icon from "../Icon";
import { useApp } from "@/lib/app";
import { Drug, drugsFor, isLiquid, MEALS, stockText } from "@/lib/pharmacy";
import { refreshData } from "@/lib/store";
import { useAutoRefresh } from "@/lib/autoRefresh";
import PhotoPicker from "../PhotoPicker";
import { Modal } from "../ui";
import { stampPhoto } from "@/lib/roster";

/**
 * ให้ยามื้อนี้ (KinApp แท็บให้ยา) · ไม่มีจัดซอง/QA แล้ว
 *  เลือกมื้อ › ทุกคนที่มียาตามมื้อนั้นเรียงตามห้อง › แบบผสม: ยาติ๊กไว้ทุกรายการ ("ให้ยาครบ n รายการ")
 *  เอาติ๊กออกตัวที่ไม่ได้ให้ + เลือกเหตุผล › ติ๊ก "ตรวจชื่อผู้ป่วยและยาแล้ว" › บันทึก (POST /api/pharmstock op give)
 *  ระบบตัดคงเหลือเฉพาะยาที่ให้ · บันทึกเป็นการเบิก (ข้อมูลชุดเดียวกับเมนูเบิกยาใน KINmed)
 */
export type DaySlot = { id: string; name: string; med_id: string | null; meal: string | null; qty: number; skip_reason: string | null; by: string | null; at: string };
export const SKIP_REASONS = ["ปฏิเสธยา", "หลับอยู่", "งดน้ำงดอาหาร", "ยาหมด", "อื่น ๆ"];
/** บอกหน้าอื่น (หน้างานวันนี้ใน KinApp) ให้ดึงสถานะการให้ยาใหม่หลังบันทึก */
export const MEDS_EVENT = "kin-meds-given";
export const mealByClock = () => { const h = new Date().getHours(); return h < 10 ? MEALS[0] : h < 14 ? MEALS[1] : h < 19 ? MEALS[2] : MEALS[3]; };
export const bkkToday = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
export const fetchDaySlots = (date: string) => fetch(`/api/pharmstock?op=withdrawals_day&date=${date}`, { cache: "no-store" })
  .then((r) => (r.ok ? r.json() : { slots: [] })).then((d: { slots?: DaySlot[] }) => d.slots ?? []);
/** แถวการให้ยาของยานี้ในมื้อนี้ (ให้แล้ว หรือไม่ได้ให้พร้อมเหตุผล) */
export const slotOf = (slots: DaySlot[], medId: number | string, meal: string) => slots.filter((s) => s.med_id === String(medId) && String(s.meal ?? "").split(", ").includes(meal));

/** photo = รูปตอนให้ยา (ประทับชื่อ มื้อ เวลาแล้ว) · ต้องมีเมื่อให้ยาอย่างน้อย 1 รายการ */
type Form = { on: number[]; why: Record<number, string>; ok: boolean; photo: string };
/** รหัสรูปการให้ยาของคนนี้ มื้อนี้ วันนี้ (ยาตัวแรกของคนนั้นเป็นตัวแทนผู้ป่วย) */
const giveRef = (date: string, meal: string, medId: string | number) => `${date}:${meal}:${medId}`;

export default function GiveMeds({ drugs, people }: { drugs: Drug[]; people: { name: string; room: string }[] }) {
  const { toast } = useApp();
  const date = bkkToday();
  const [meal, setMeal] = useState(mealByClock);
  const [slots, setSlots] = useState<DaySlot[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<Form>({ on: [], why: {}, ok: false, photo: "" });
  const [pic, setPic] = useState<{ who: string; photo: string | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [allergy, setAllergy] = useState<Record<string, string>>({});
  const load = useCallback(() => { fetchDaySlots(date).then(setSlots).catch(() => setSlots([])); }, [date]);
  useEffect(load, [load]);
  useAutoRefresh(load);
  useEffect(() => {
    fetch("/api/care?op=allergies", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { items: [] })).then((d: { items: { name: string; drug: string | null }[] }) => {
      const m: Record<string, string> = {};
      for (const x of d.items ?? []) { const v = String(x.drug ?? "").trim(); if (v && v !== "-" && !/^(ไม่มี|ไม่แพ้|ปฏิเสธ)/.test(v)) m[x.name] = v; }
      setAllergy(m);
    }).catch(() => {});
  }, []);

  const roomOf = (w: string) => { const r = people.find((p) => p.name === w)?.room ?? ""; return r && r !== "-" ? r : ""; };
  const listOf = useCallback((w: string, m: string) => drugsFor(drugs, w, m, date), [drugs, date]);
  /** สถานะของคนนี้ในมื้อนี้: done = ยาทุกตัวมีบันทึกแล้ว (ให้หรือไม่ได้ให้) */
  const statusOf = useCallback((w: string, m: string) => {
    const list = listOf(w, m), rows = list.map((d) => ({ d, s: slotOf(slots ?? [], d.id, m) }));
    return { list, rows, done: list.length > 0 && rows.every((r) => r.s.length > 0) };
  }, [listOf, slots]);
  const who = useMemo(() => people.map((p) => p.name).filter((w) => listOf(w, meal).length)
    .sort((a, b) => (roomOf(a) || "~").localeCompare(roomOf(b) || "~") || a.localeCompare(b, "th")), [people, listOf, meal]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = who.filter((w) => !statusOf(w, meal).done);
  // คนที่ยังไม่ได้ให้ขึ้นก่อน · กาง "ให้แล้ว" = ต่อท้ายด้วยคนที่ให้แล้ว
  const shown = showDone ? [...pending, ...who.filter((w) => !pending.includes(w))] : pending;

  /** all = เริ่มแบบให้ครบทุกรายการ · false = เริ่มแบบไม่ได้ให้ (เลือกเหตุผลทีละรายการ) */
  const start = (w: string, all = true) => { setOpen(w); setForm({ on: all ? listOf(w, meal).map((_, i) => i) : [], why: {}, ok: false, photo: "" }); };
  const takePhoto = async (w: string, raw: string) => {
    if (!raw) return setForm((f) => ({ ...f, photo: "" }));
    const at = new Date().toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
    try { const photo = await stampPhoto(raw, [`ให้ยามื้อ${meal} · ${w}`, at]); setForm((f) => ({ ...f, photo })); } catch { setForm((f) => ({ ...f, photo: raw })); }
  };
  /** ดูรูปตอนให้ยา (คนที่บันทึกแล้ว) */
  const showPhoto = (w: string) => {
    const first = listOf(w, meal)[0]; if (!first) return;
    const ref = giveRef(date, meal, first.id);
    setPic({ who: w, photo: null });
    fetch(`/api/medphoto?kind=give&ids=${encodeURIComponent(ref)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : { photos: {} })).then((d: { photos: Record<string, string> }) => setPic({ who: w, photo: d.photos[ref] ?? "" })).catch(() => setPic({ who: w, photo: "" }));
  };
  const nowMeal = mealByClock();
  const doneN = who.length - pending.length;
  const save = async (w: string) => {
    const list = listOf(w, meal);
    const skips = list.map((_, i) => i).filter((i) => !form.on.includes(i));
    if (!form.ok) return toast("กรุณาติ๊ก ตรวจชื่อผู้ป่วยและยาแล้ว");
    if (skips.some((i) => !form.why[i])) return toast("เลือกเหตุผลของยาที่ไม่ได้ให้ก่อนบันทึก");
    if (form.on.length && !form.photo) return toast("กรุณาถ่ายรูปตอนให้ยาก่อนบันทึก");
    setBusy(true);
    try {
      const r = await fetch("/api/pharmstock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        op: "give", meal, checked: true,
        items: form.on.map((i) => ({ medId: String(list[i].id), qty: list[i].dose || 1 })),
        skips: skips.map((i) => ({ medId: String(list[i].id), reason: form.why[i] })),
      }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "บันทึกการให้ยาไม่สำเร็จ");
      // รูปตอนให้ยา: ส่งหลังบันทึกการให้ยาแล้ว (ส่งรูปไม่ผ่าน = การให้ยายังบันทึกอยู่ แจ้งให้ทราบ)
      if (form.photo && list[0]) {
        const pr = await fetch("/api/medphoto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "give", id: giveRef(date, meal, list[0].id), photo: form.photo }) }).catch(() => null);
        if (!pr?.ok) toast("บันทึกการให้ยาแล้ว แต่ส่งรูปไม่สำเร็จ");
      }
      toast(`บันทึกแล้ว · ${w} มื้อ${meal} · ให้ ${form.on.length}${skips.length ? ` · ไม่ได้ให้ ${skips.length}` : ""} รายการ`);
      setOpen(null); refreshData("pharmacy-drugs"); load(); window.dispatchEvent(new Event(MEDS_EVENT));
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <div className="ka-head"><div><h1>ให้ยา · มื้อ{meal}</h1><p>{new Date().toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short" })} · ให้แล้ว {doneN} จาก {who.length} คน</p></div></div>
      {/* เลือกมื้อ: ตัวเลข ให้แล้ว/ทั้งหมด · ป้าย "ตอนนี้" ที่มื้อตามเวลา */}
      <div className="kn-meals" role="group" aria-label="เลือกมื้อ">
        {MEALS.map((m) => {
          const ws = people.map((p) => p.name).filter((w) => listOf(w, m).length), d = ws.filter((w) => statusOf(w, m).done).length;
          return <button key={m} type="button" aria-pressed={meal === m} onClick={() => { setMeal(m); setOpen(null); setShowDone(false); }} className={ws.length ? "" : "is-empty"}>
            <b>{m}</b><small>{ws.length ? `${d}/${ws.length}` : "-"}{m === nowMeal ? " · ตอนนี้" : ""}</small></button>;
        })}
      </div>
      {who.length > 0 && <div className="kn-bar" role="progressbar" aria-valuenow={doneN} aria-valuemin={0} aria-valuemax={who.length} aria-label={`ให้ยามื้อ${meal}แล้ว`}><i style={{ width: `${Math.round((doneN / who.length) * 100)}%` }} /></div>}
      {slots === null ? <p className="py-6 text-center text-sm text-gold-500">กำลังโหลด…</p>
        : !who.length ? <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-gold-500">ไม่มีใครต้องกินยามื้อ{meal}วันนี้</p>
        : <>
        {pending.length ? <p className="kn-h"><span>ยังไม่ได้ให้ · {pending.length} คน</span></p> : <p className="rounded-2xl bg-emerald-50 px-4 py-4 text-center text-sm font-medium text-emerald-800">✓ ให้ยามื้อ{meal}ครบทุกคนแล้ว</p>}
        <ul className="space-y-2.5">{shown.map((w) => {
          const st = statusOf(w, meal), isOpen = open === w, n = st.list.length;
          const allOn = form.on.length === n;
          return (
            <li key={w} className={`overflow-hidden rounded-2xl border ${st.done ? "border-emerald-200 bg-emerald-50/60" : isOpen ? "border-gold-600 bg-white shadow-soft" : "border-cream-300 bg-white"}`}>
              <div className="flex items-center gap-2.5 px-3.5 pt-3">
                {roomOf(w) && <span className="shrink-0 rounded-lg bg-gold-100 px-2 py-0.5 text-sm font-bold tabular-nums text-gold-800">{roomOf(w)}</span>}
                <span className="min-w-0 flex-1"><b className="block truncate text-[15px] text-gold-900">{w}</b>
                  {allergy[w] && <span className="inline-block rounded bg-red-50 px-1.5 text-[11px] font-semibold text-red-700">⚠ แพ้ยา: {allergy[w]}</span>}</span>
                {st.done && <button type="button" className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800" onClick={() => showPhoto(w)} title="ดูรูปตอนให้ยา">✓ บันทึกแล้ว · รูป</button>}
              </div>

              {/* ยังไม่เปิด / บันทึกแล้ว: รายการยา */}
              {!isOpen && <ul className="mx-3.5 mt-2 divide-y divide-cream-200 rounded-xl bg-cream-50 px-3">
                {st.rows.map(({ d, s }) => {
                  const g = s.find((x) => !x.skip_reason), k = s.find((x) => x.skip_reason);
                  return <li key={d.id} className="flex items-baseline justify-between gap-2 py-1.5 text-sm">
                    <span className={`min-w-0 ${k ? "text-amber-800" : "text-gold-800"}`}>{g ? "✓ " : k ? "✕ " : ""}{d.name}{d.stock < d.dose && !s.length ? <span className="ml-1 rounded bg-amber-100 px-1 text-[11px] text-amber-800">เหลือไม่พอ</span> : ""}
                      {(g || k) && <small className="block text-[11px] text-gold-500">{k ? `ไม่ได้ให้: ${k.skip_reason} · ` : ""}{(g ?? k)!.at} · {(g ?? k)!.by}</small>}</span>
                    <b className="shrink-0 tabular-nums text-gold-900">{d.dose} {d.unit}</b>
                  </li>;
                })}
              </ul>}

              {/* เปิดให้ยา: แบบผสม */}
              {isOpen && (
                <div className="space-y-2 px-3.5 pt-2.5">
                  <label className={`flex cursor-pointer items-center gap-3 rounded-xl border-2 px-3 py-2 ${allOn ? "border-emerald-500 bg-emerald-50" : "border-cream-300 bg-white"}`}>
                    <input type="checkbox" className="!h-5 !w-5 !min-h-0 accent-emerald-700" checked={allOn} onChange={(e) => setForm({ ...form, on: e.target.checked ? st.list.map((_, i) => i) : [], why: e.target.checked ? {} : form.why })} />
                    <span><b className="block text-sm text-gold-900">{allOn ? `ให้ยาครบ ${n} รายการ` : form.on.length ? `ให้ยา ${form.on.length} จาก ${n} รายการ` : "ไม่ได้ให้ยามื้อนี้"}</b>
                      <small className="text-[11.5px] text-gold-500">{allOn ? "ยาตัวไหนไม่ได้ให้ เอาติ๊กออก" : form.on.length ? "แตะเพื่อเลือกยาครบทุกรายการ" : "เลือกเหตุผลของแต่ละรายการด้านล่าง"}</small></span>
                  </label>
                  <ul className="space-y-1.5">{st.list.map((d, i) => {
                    const on = form.on.includes(i);
                    return <li key={d.id} className={`rounded-xl border px-3 py-2 ${on ? "border-cream-300 bg-white" : "border-amber-200 bg-amber-50"}`}>
                      <label className="flex cursor-pointer items-center gap-3">
                        <input type="checkbox" className="!h-5 !w-5 !min-h-0 accent-emerald-700" checked={on} onChange={(e) => setForm({ ...form, on: e.target.checked ? [...form.on, i].sort() : form.on.filter((x) => x !== i) })} />
                        <span className="min-w-0 flex-1"><b className="block text-sm font-medium text-gold-900">{d.name}</b>
                          <small className={`text-[11.5px] ${d.stock < d.dose ? "font-medium text-amber-800" : "text-gold-500"}`}>{d.stock < d.dose ? `เหลือ ${stockText(d)} · ไม่พอ` : `${d.how || ""}${d.how ? " · " : ""}เหลือ ${stockText(d)}`}</small>
                          {d.warn.length > 0 && <small className="block text-[11.5px] text-red-700">คำเตือน: {d.warn.join(" · ")}</small>}</span>
                        <b className="shrink-0 tabular-nums text-gold-900">{d.dose} {isLiquid(d) ? "ml" : d.unit}</b>
                      </label>
                      {!on && <select className="mt-2 w-full" aria-label={`เหตุผลที่ไม่ได้ให้ ${d.name}`} value={form.why[i] ?? ""} onChange={(e) => setForm({ ...form, why: { ...form.why, [i]: e.target.value } })}>
                        <option value="">ไม่ได้ให้เพราะ…</option>{SKIP_REASONS.map((r) => <option key={r}>{r}</option>)}</select>}
                    </li>;
                  })}</ul>
                  <label className="flex cursor-pointer items-center gap-3 rounded-xl bg-cream-50 px-3 py-2 text-sm text-gold-800">
                    <input type="checkbox" className="!h-5 !w-5 !min-h-0 accent-emerald-700" checked={form.ok} onChange={(e) => setForm({ ...form, ok: e.target.checked })} /> ตรวจชื่อผู้ป่วยและยาแล้ว</label>
                  {form.on.length > 0 && <PhotoPicker value={form.photo} onChange={(raw) => takePhoto(w, raw)} label="ถ่ายรูปตอนให้ยา" hint="ให้เห็นหน้าผู้ป่วยและยา/ซองยามื้อนี้ · ระบบประทับชื่อ มื้อ และเวลาให้" />}
                </div>
              )}

              <div className="flex gap-2 p-3.5">
                {st.done ? null : isOpen ? <>
                  <button type="button" className="btn-soft !py-2" onClick={() => setOpen(null)}>ยกเลิก</button>
                  <button type="button" className="btn-primary flex-1 !py-2" disabled={busy || !form.ok || (form.on.length > 0 && !form.photo) || st.list.some((_, i) => !form.on.includes(i) && !form.why[i])} onClick={() => save(w)}>
                    {busy ? "กำลังบันทึก…" : allOn ? `บันทึกการให้ยา ${n} รายการ` : `บันทึก · ให้ยา ${form.on.length} · ไม่ได้ให้ ${n - form.on.length}`}</button>
                </> : <>
                  <button type="button" className="btn-primary flex-1 !py-2.5" onClick={() => start(w)}><Icon name="pill" className="h-4 w-4" /> ให้ครบ {n} รายการ</button>
                  <button type="button" className="btn-soft !py-2.5" onClick={() => start(w, false)}>ไม่ได้ให้…</button>
                </>}
              </div>
            </li>
          );
        })}</ul>
        {/* คนที่ให้แล้วพับไว้ (แทนช่องติ๊กแสดงคนที่ให้แล้ว) */}
        {doneN > 0 && <button type="button" className="kn-fold" aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
          <span><b>ให้แล้ว {doneN} คน</b><small>{showDone ? "แตะเพื่อพับ" : "แตะเพื่อดูว่าใครให้ยาไปแล้ว"}</small></span><Icon name="chevron" className={`h-4 w-4 transition ${showDone ? "rotate-180" : ""}`} />
        </button>}
        </>}
      <Modal open={!!pic} title={pic ? `รูปตอนให้ยา · ${pic.who} · มื้อ${meal}` : ""} onClose={() => setPic(null)} footer={<button type="button" className="btn-primary" onClick={() => setPic(null)}>ปิด</button>}>
        {pic?.photo === null ? <p className="text-sm text-gold-500">กำลังโหลดรูป…</p> : pic?.photo ? <img src={pic.photo} alt={`รูปตอนให้ยา ${pic.who}`} className="w-full rounded-xl" /> : <p className="text-sm text-gold-500">ไม่มีรูป (ไม่ได้ให้ยามื้อนี้ หรือบันทึกก่อนเริ่มถ่ายรูป)</p>}
      </Modal>
      <p className="text-center text-xs text-gold-500">ให้ยาผิด แจ้งห้องยายกเลิกได้ที่ KINmed › เบิกยา · ยาขวด ยาทา ยาตามอาการ เบิกที่ KINmed › เบิกยา</p>
    </div>
  );
}
