"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Icon from "../Icon";
import { useApp } from "@/lib/app";
import { Drug, isLiquid, isUseDrug, MEALS, Pack, stockText } from "@/lib/pharmacy";
import { refreshData } from "@/lib/store";

/**
 * ส่วนประกอบของเมนู จัดยาตามมื้อ / เบิกยาตามใช้ (แอปห้องยา · app/pharmacy Dispense)
 *  WithdrawBox = กล่องส้ม: ยาเบิกตามใช้ (ยาขวด ยาทา ยาพ่น ตามอาการ · lib/pharmacy isUseDrug) · เบิกที่ server ตัดคงเหลือแบบมีเงื่อนไข เก็บเป็นรายการ
 *  DayTimeline = ไทม์ไลน์ของวัน: จัดซองตามมื้อ + เบิกยา รวมกัน · ยกเลิกการเบิกที่กดผิดได้ (เลือกเหตุผล · คืนคงเหลือ · เก็บรายการไว้)
 */
export type WithdrawItem = { id: string; med_id: string | null; name: string; qty: number; unit: string | null; b: number | null; s: number | null; meal: string | null; note: string | null; by: string | null; at: string; ts: string;
  legacy?: boolean; void_reason?: string | null; voided_by?: string | null; voided_at?: string | null; fresh?: boolean; skip_reason?: string | null };
type Form = { qty: string; meals: string[]; note: string; qtyTouched?: boolean; ok: boolean };
const PRN = "ตามอาการ";
const MEAL_OPTS = [...MEALS, PRN];
export const VOID_REASONS = ["กดผิด", "จำนวนผิด", "ผิดคน", "ยาไม่ได้ใช้", "อื่น ๆ"];
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round(n * 100) / 100;

async function call<T>(url: string, body?: object): Promise<T> {
  const r = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "ทำรายการไม่สำเร็จ");
  return d as T;
}
const mealNow = () => { const h = new Date().getHours(); return h < 10 ? "เช้า" : h < 14 ? "กลางวัน" : h < 19 ? "เย็น" : "ก่อนนอน"; };
export const fetchWithdrawals = (who: string) => call<{ items: WithdrawItem[] }>(`/api/pharmstock?op=withdrawals&resident=${encodeURIComponent(who)}`).then((d) => d.items);

/* ---------- การ์ดยา: เบิกยา (= บันทึกการให้ยาของมื้อนั้น) ---------- */
/**
 * ยาทุกตัวของผู้ป่วย (ไม่มีจัดซอง/QA แล้ว) · ยาตามมื้อบอกสถานะแต่ละมื้อของวันนี้ (ให้แล้ว / ไม่ได้ให้ / ยังไม่ให้)
 *  มื้อเริ่มต้น = มื้อที่ยังไม่ให้ (มื้อตามเวลาตอนนี้ก่อน) · ต้องติ๊ก "ตรวจชื่อผู้ป่วยและยาแล้ว" ก่อนเบิก
 *  เลือกมื้อที่ให้ไปแล้ว / เบิกซ้ำวันเดียวกัน = เตือนสีแดงก่อนยืนยัน
 */
export function WithdrawBox({ drugs, who, onDone, reload = 0 }: { drugs: Drug[]; who: string; onDone: () => void; reload?: number }) {
  const { toast, confirm } = useApp();
  const [form, setForm] = useState<Record<string, Form>>({});
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { setForm({}); }, [who]);
  const list = useMemo(() => drugs.filter((x) => x.who === who)
    .sort((a, b) => Number(a.hold) - Number(b.hold) || Number(isUseDrug(a)) - Number(isUseDrug(b)) || a.name.localeCompare(b.name, "th")), [drugs, who]);
  const [hist, setHist] = useState<WithdrawItem[]>([]);
  const loadHist = useCallback(() => { if (who) fetchWithdrawals(who).then(setHist).catch(() => setHist([])); }, [who]);
  useEffect(() => { setHist([]); loadHist(); }, [loadHist]);
  useEffect(() => { if (reload) loadHist(); }, [reload]); // eslint-disable-line react-hooks/exhaustive-deps
  const todayIso = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  /** บันทึกของยานี้วันนี้ (ไม่นับที่ยกเลิก) */
  const todayOf = (x: Drug) => hist.filter((h) => !h.legacy && !h.void_reason && h.med_id === String(x.id) && h.ts.startsWith(todayIso)).sort((a, b) => a.ts.localeCompare(b.ts));
  /** มื้อนี้ของยานี้วันนี้: ให้แล้ว / ไม่ได้ให้ */
  const mealRec = (x: Drug, m: string) => todayOf(x).filter((h) => String(h.meal ?? "").split(", ").includes(m));
  const given = (x: Drug, m: string) => mealRec(x, m).find((h) => !h.skip_reason);

  /** มื้อเริ่มต้น: มื้อที่ยังไม่ได้บันทึก (มื้อตามเวลาตอนนี้ก่อน) · ยาไม่มีมื้อ หรือให้ครบทุกมื้อแล้ว = ตามอาการ */
  const firstMeal = (x: Drug) => {
    const mine = MEALS.filter((m) => x.meals.includes(m)), now = mealNow();
    const open = mine.filter((m) => !mealRec(x, m).length);
    if (!open.length) return [PRN];
    if (open.includes(now)) return [now];
    return [open.find((m) => MEALS.indexOf(m) > MEALS.indexOf(now)) ?? open[0]];
  };
  const perMeal = (x: Drug) => (isLiquid(x) ? x.dose || 0 : x.dose || 1);
  const stepOf = (x: Drug) => (isLiquid(x) ? (x.dose > 0 ? x.dose : 5) : 1);
  const autoQty = (x: Drug, meals: string[]) => String(round2(perMeal(x) * Math.max(1, meals.filter((m) => m !== PRN).length || 1)) || "");
  const f = (x: Drug): Form => { const meals = firstMeal(x); return form[x.id] ?? { qty: autoQty(x, meals), meals, note: "", ok: false }; };
  const setF = (x: Drug, patch: Partial<Form>) => setForm((s) => ({ ...s, [x.id]: { ...(s[x.id] ?? f(x)), ...patch } }));
  const bump = (x: Drug, dir: 1 | -1) => setF(x, { qty: String(Math.max(0, round2((Number(f(x).qty) || 0) + dir * stepOf(x)))), qtyTouched: true });
  const toggleMeal = (x: Drug, m: string) => {
    const cur = f(x);
    let meals = m === PRN ? (cur.meals.includes(PRN) ? [] : [PRN]) : cur.meals.includes(m) ? cur.meals.filter((y) => y !== m) : [...cur.meals.filter((y) => y !== PRN), m];
    meals = MEAL_OPTS.filter((y) => meals.includes(y));
    setF(x, { meals, ...(cur.qtyTouched ? {} : { qty: autoQty(x, meals) }) });
  };

  const go = (x: Drug) => {
    const v = f(x), n = Number(v.qty);
    if (!v.meals.length) return toast("กรุณาเลือกมื้อ หรือ ตามอาการ");
    if (!(n > 0)) return toast("กรุณาระบุจำนวนที่เบิก");
    if (n > x.stock) return toast(`เบิกเกินคงเหลือ · ${x.name} เหลือ ${stockText(x)}`);
    if (!v.ok) return toast("กรุณาติ๊ก ตรวจชื่อผู้ป่วยและยาแล้ว");
    const mealText = v.meals.includes(PRN) ? "ตามอาการ" : `มื้อ${v.meals.join(", ")}`;
    const dup = v.meals.filter((m) => m !== PRN).map((m) => ({ m, g: given(x, m) })).filter((d) => d.g);
    const done = todayOf(x).filter((h) => !h.skip_reason);
    const warn = dup.length ? `⚠ ${dup.map((d) => `มื้อ${d.m}ให้ไปแล้ว ${d.g!.ts.slice(11, 16)} โดย ${d.g!.by ?? "-"}`).join(" · ")} · ตรวจว่าไม่ใช่การให้ยาซ้ำ\n\n`
      : done.length && v.meals.includes(PRN) ? `⚠ วันนี้เบิก ${x.name} ไปแล้ว ${done.length} ครั้ง (${done.map((h) => `${h.ts.slice(11, 16)}${h.meal ? ` ${h.meal}` : ""}`).join(" / ")}) · ตรวจว่าไม่ใช่การให้ยาซ้ำ\n\n` : "";
    confirm({ title: warn ? "อาจเป็นการให้ยาซ้ำ · ยืนยันอีกครั้ง" : "ยืนยันเบิกยา", okLabel: warn ? "เบิกเพิ่ม" : "เบิก", danger: !!warn,
      message: `${warn}เบิก ${x.name} ${fmt(n)} ${x.unit} ให้ ${who} · ${mealText} · คงเหลือ ${fmt(x.stock)} → ${fmt(round2(x.stock - n))} ${x.unit}`,
      onOk: async () => {
        setBusy(String(x.id));
        try {
          const r = await call<{ stock: number }>("/api/pharmstock", { op: "withdraw", medId: String(x.id), qty: n, meal: v.meals.join(", "), note: v.note });
          toast(`เบิกยาแล้ว · ${x.name} ${fmt(n)} ${x.unit} · ${mealText} · คงเหลือ ${stockText({ ...x, stock: r.stock })}`);
          setForm((s) => { const c = { ...s }; delete c[x.id]; return c; });
          refreshData("pharmacy-drugs"); loadHist(); onDone();
        } catch (e) { toast((e as Error).message); } finally { setBusy(null); }
      } });
  };

  if (!list.length) return <p className="rounded-xl bg-white px-4 py-4 text-sm text-gold-700">{who || "ผู้ป่วยคนนี้"} ยังไม่มียาในระบบ · เพิ่มยาได้ที่ปุ่ม เพิ่มยา ด้านบน</p>;
  return (
    <ul className="grid gap-3 xl:grid-cols-2">{list.map((x) => {
      const v = f(x), out = x.stock <= 0, n = Number(v.qty), after = n > 0 ? round2(x.stock - n) : null, over = after !== null && after < 0;
      const full = isLiquid(x) && x.pack ? x.pack : x.received || null;
      const pct = full ? Math.max(0, Math.min(100, Math.round((x.stock / full) * 100))) : null;
      const scheduled = isUseDrug(x) ? [] : MEALS.filter((m) => x.meals.includes(m));
      const prn = todayOf(x).filter((h) => !h.skip_reason && !scheduled.some((m) => String(h.meal ?? "").split(", ").includes(m)));
      return (
        <li key={x.id} className={`overflow-hidden rounded-2xl border border-cream-300 bg-white ${x.hold ? "opacity-70" : ""}`}>
          <div className="flex items-start justify-between gap-3 px-4 pt-3">
            <span className="min-w-0"><b className="block text-[15px] font-semibold text-gold-900">{x.name}{!isUseDrug(x) ? <span className="font-normal text-gold-600"> · ครั้งละ {fmt(x.dose)} {x.unit}</span> : ""}</b>
              <small className="block text-xs text-gold-500">{[isUseDrug(x) ? (x.bulk ? "ใช้เมื่อจำเป็น · ยาขวด / ยาทา" : "ใช้เมื่อจำเป็น") : `กินตามมื้อ ${x.meals.join(", ")}`, /\D/.test(x.how ?? "") ? x.how : "", x.hold ? "งดชั่วคราว" : ""].filter(Boolean).join(" · ")}</small></span>
            <span className="shrink-0 text-right"><b className={`block text-lg leading-tight ${out ? "text-red-700" : "text-gold-900"}`}>{out ? "หมด" : `${fmt(x.stock)} ${x.unit}`}</b><small className="text-[11px] text-gold-500">{out ? "เติมยาก่อนเบิก" : isLiquid(x) && x.pack ? `≈ ${fmt(round2(x.stock / x.pack))} ขวด` : "คงเหลือ"}</small></span>
          </div>
          {/* สถานะแต่ละมื้อของวันนี้ */}
          {(scheduled.length > 0 || prn.length > 0) && <div className="mx-4 mt-2 flex flex-wrap gap-1.5">
            {scheduled.map((m) => { const g = given(x, m), k = mealRec(x, m).find((h) => h.skip_reason);
              return <span key={m} className={`rounded-lg px-2 py-0.5 text-xs ${g ? "bg-emerald-50 font-medium text-emerald-800" : k ? "bg-amber-50 text-amber-800" : "border border-dashed border-amber-300 text-amber-800"}`}>
                {g ? `${m} ✓ ${g.ts.slice(11, 16)} · ${g.by ?? "-"}` : k ? `${m} ✕ ไม่ได้ให้ (${k.skip_reason})` : `${m} · ยังไม่ให้`}</span>; })}
            {prn.length > 0 && <span className="rounded-lg bg-cream-100 px-2 py-0.5 text-xs text-gold-700">ตามอาการวันนี้ {prn.length} ครั้ง · ล่าสุด {prn[prn.length - 1].ts.slice(11, 16)}</span>}
          </div>}
          {pct !== null && <div className="mx-4 mt-2 h-1.5 overflow-hidden rounded-full bg-cream-300"><i className={`block h-full rounded-full ${pct <= 20 ? "bg-amber-500" : "bg-gold-600"}`} style={{ width: `${pct}%` }} /></div>}
          <div className="mt-3 space-y-2 border-t border-cream-200 bg-cream-50/60 px-4 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center overflow-hidden rounded-xl border border-cream-300 bg-white">
                <button type="button" className="h-9 w-9 text-lg text-gold-700 hover:bg-cream-100 disabled:opacity-40" aria-label="ลด" disabled={out} onClick={() => bump(x, -1)}>−</button>
                <input type="number" inputMode="decimal" min={0} className="!h-9 !min-h-0 !w-16 !rounded-none !border-0 !px-1 text-center font-medium" aria-label={`จำนวนที่เบิก ${x.name}`} value={v.qty} disabled={out} onChange={(e) => setF(x, { qty: e.target.value, qtyTouched: true })} />
                <button type="button" className="h-9 w-9 text-lg text-gold-700 hover:bg-cream-100 disabled:opacity-40" aria-label="เพิ่ม" disabled={out} onClick={() => bump(x, 1)}>+</button>
              </div>
              <span className="text-sm text-gold-600">{x.unit}</span>
              <div className="flex flex-wrap gap-1" role="group" aria-label="มื้อ (เลือกได้หลายมื้อ)">
                {MEAL_OPTS.map((m) => { const on = v.meals.includes(m), done = m !== PRN && !!given(x, m);
                  return <button key={m} type="button" aria-pressed={on} disabled={out} onClick={() => toggleMeal(x, m)} title={done ? `มื้อ${m}ให้ไปแล้ววันนี้` : undefined}
                    className={`rounded-full border px-2.5 py-1 text-xs transition disabled:opacity-40 ${on ? "border-gold-800 bg-gold-800 font-medium text-white" : done ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-cream-300 bg-white text-gold-700 hover:border-gold-300"}`}>{m}{done && !on ? " ✓" : ""}</button>; })}
              </div>
            </div>
            <input className="w-full" aria-label="หมายเหตุ" placeholder="หมายเหตุ (ถ้ามี) เช่น ไข้ 38.2, แพทย์สั่งเพิ่ม" value={v.note} disabled={out} onChange={(e) => setF(x, { note: e.target.value })} />
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm text-gold-800">
                <input type="checkbox" className="!h-5 !w-5 !min-h-0 accent-emerald-700" checked={v.ok} disabled={out} onChange={(e) => setF(x, { ok: e.target.checked })} /> ตรวจชื่อผู้ป่วยและยาแล้ว</label>
              <button className="btn-primary !min-h-[40px] shrink-0 !px-6" disabled={out || over || !v.ok || busy === String(x.id)} onClick={() => go(x)}>{busy === String(x.id) ? "กำลังเบิก…" : "เบิก"}</button>
            </div>
            {!out && after !== null && <p className={`text-xs ${over ? "font-medium text-red-700" : "text-gold-600"}`}>{over ? `เกินจำนวนที่เหลือ (เหลือ ${stockText(x)})` : <>หลังเบิกเหลือ <b>{stockText({ ...x, stock: after })}</b></>}</p>}
          </div>
        </li>
      );
    })}</ul>
  );
}

/* ---------- ไทม์ไลน์ของวัน: จัดซอง + เบิก ---------- */
type Ev = { key: string; ts: string; time: string; kind: "pack" | "use"; title: string; sub: string; qty?: string; w?: WithdrawItem; state?: string };
/** เวลาไทย HH:MM จากรหัสซอง (Date.now() ตอนจัด) */
const packTime = (id: number) => (id > 1e12 ? new Date(id + 7 * 3600e3).toISOString().slice(11, 16) : "");

/** only = แสดงเฉพาะการจัดซอง (เมนูจัดยาตามมื้อ) หรือเฉพาะการเบิก (เมนูเบิกยาตามใช้) */
export function DayTimeline({ who, date, packs, me, canVoidAll, reload, onVoided, only }: { who: string; date: string; packs: Pack[]; me: string; canVoidAll: boolean; reload: number; onVoided: () => void; only?: "pack" | "use" }) {
  const { toast } = useApp();
  const [items, setItems] = useState<WithdrawItem[] | null>(null);
  const [all, setAll] = useState(false);
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { if (!who) return setItems([]); fetchWithdrawals(who).then(setItems).catch(() => setItems([])); }, [who]);
  useEffect(() => { setItems(null); setVoiding(null); load(); }, [load, reload]);

  const evs = useMemo(() => {
    const w: Ev[] = only === "pack" ? [] : (items ?? []).filter((x) => all || x.ts.startsWith(date)).map((x) => ({
      key: `w${x.id}`, ts: x.ts, time: x.ts.slice(11, 16), kind: "use", w: x,
      title: x.skip_reason ? `ไม่ได้ให้ ${x.name}${x.meal ? ` · ${x.meal}` : ""}` : `เบิก ${x.name}${x.meal ? ` · ${x.meal}` : ""}`,
      sub: [x.skip_reason ? `เหตุผล: ${x.skip_reason}` : "", x.by, !x.skip_reason && x.b !== null && x.s !== null ? `${fmt(x.b)} → ${fmt(x.s)} ${x.unit ?? ""}` : "", x.note].filter(Boolean).join(" · "),
      qty: x.skip_reason ? "ไม่ได้ให้" : `−${fmt(x.qty)} ${x.unit ?? ""}`.trim() }));
    const p: Ev[] = all || only === "use" ? [] : packs.filter((k) => k.who === who && k.date === date).map((k) => ({
      key: `p${k.id}`, ts: `${k.date} ${packTime(k.id) || "00:00"}`, time: packTime(k.id) || "-", kind: "pack",
      title: `จัดซองมื้อ${k.meal} (${k.items.length} รายการ)`, sub: [`จัดโดย ${k.by}`, k.qby ? `ตรวจโดย ${k.qby}` : "", k.given ? `ให้ยาโดย ${k.gby ?? "-"}${k.gat ? ` ${k.gat.slice(11, 16)}` : ""}` : ""].filter(Boolean).join(" · "),
      state: k.given ? "ให้ยาแล้ว" : k.qa }));
    return [...w, ...p].sort((a, b) => b.ts.localeCompare(a.ts));
  }, [items, packs, who, date, all, only]);

  const canVoid = (x: WithdrawItem) => !x.legacy && !x.void_reason && (canVoidAll || (x.by === me && !!x.fresh));
  const doVoid = async (x: WithdrawItem) => {
    if (!reason) return toast("กรุณาเลือกเหตุผลที่ยกเลิก");
    setBusy(true);
    try {
      await call("/api/pharmstock", { op: "withdraw_void", id: x.id, reason });
      toast(`ยกเลิกการเบิกแล้ว · ${x.name} คืน ${fmt(x.qty)} ${x.unit ?? ""}`);
      setVoiding(null); setReason(""); refreshData("pharmacy-drugs"); load(); onVoided();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const tone: Record<string, string> = { "รอตรวจ": "bg-amber-50 text-amber-800", "ตรวจผ่าน": "bg-sky-50 text-sky-800", "แจ้งจัดยาผิด": "bg-red-50 text-red-700", "ให้ยาแล้ว": "bg-emerald-50 text-emerald-800" };

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[15px] font-semibold text-gold-900">{all ? "ประวัติการเบิกทั้งหมด" : only === "pack" ? "ซองที่จัดวันนี้" : only === "use" ? "ให้ยาและเบิกยาของวันที่เลือก" : "ไทม์ไลน์ของวัน"} <small className="font-normal text-gold-500">· {evs.length} รายการ</small></h3>
        {only !== "pack" && <div className="flex gap-1 text-xs" role="group" aria-label="ช่วงที่แสดง">
          <button type="button" aria-pressed={!all} onClick={() => setAll(false)} className={`rounded-full border px-3 py-1 ${!all ? "border-gold-700 bg-gold-700 text-white" : "border-cream-300 bg-white text-gold-700"}`}>วันที่เลือก</button>
          <button type="button" aria-pressed={all} onClick={() => setAll(true)} className={`rounded-full border px-3 py-1 ${all ? "border-gold-700 bg-gold-700 text-white" : "border-cream-300 bg-white text-gold-700"}`}>ทั้งหมด</button>
        </div>}
      </div>
      {items === null ? <p className="py-4 text-center text-sm text-gold-500">กำลังโหลด…</p>
        : !evs.length ? <p className="rounded-xl bg-cream-50 px-4 py-4 text-center text-sm text-gold-500">{all ? "ยังไม่มีประวัติการเบิก" : only === "pack" ? "ยังไม่มีซองที่จัดของวันนี้" : only === "use" ? "ยังไม่มีการเบิกยาของวันนี้" : "ยังไม่มีการจัดซองหรือเบิกยาของวันนี้"}</p>
        : <ol className="space-y-1.5">{evs.map((e) => {
          const x = e.w, voided = !!x?.void_reason;
          return (
            <li key={e.key} className={`rounded-xl bg-cream-50 px-3 py-2 ${voided ? "opacity-60" : ""}`}>
              <div className="grid grid-cols-[44px_10px_minmax(0,1fr)_auto] items-start gap-2 text-sm">
                <span className="tabular-nums text-gold-500">{all && x ? x.at.slice(0, 5) : e.time}</span>
                <i className={`mt-1.5 h-2.5 w-2.5 rounded-full ${e.kind === "pack" ? "bg-sky-600" : "bg-amber-600"}`} aria-hidden />
                <span className="min-w-0"><b className={`font-medium text-gold-900 ${voided ? "line-through" : ""}`}>{e.title}</b>
                  <small className="block text-xs text-gold-500">{e.sub}
                    {x?.legacy && <span className="ml-1 rounded bg-cream-200 px-1.5 text-[11px] text-gold-600" title="บันทึกก่อนมีเมนูเบิกยา · แก้คงเหลือได้ที่เมนู นับยาคงเหลือ">บันทึกเดิม</span>}
                    {voided && <span className="ml-1 rounded bg-red-50 px-1.5 text-[11px] font-medium text-red-700">ยกเลิกแล้ว · {x!.void_reason} · {x!.voided_by ?? "-"} · คืนคงเหลือ</span>}</small></span>
                <span className="flex flex-col items-end gap-0.5">
                  {e.qty && <b className={`whitespace-nowrap tabular-nums ${voided ? "text-gold-400 line-through" : "text-amber-800"}`}>{e.qty}</b>}
                  {e.state && <span className={`whitespace-nowrap rounded-full px-2 text-[11px] font-medium ${tone[e.state] ?? "bg-cream-200 text-gold-600"}`}>{e.state}</span>}
                  {x && canVoid(x) && voiding !== x.id && <button type="button" className="text-xs text-red-700 underline underline-offset-2" onClick={() => { setVoiding(x.id); setReason(""); }}>ยกเลิก</button>}
                </span>
              </div>
              {x && voiding === x.id && (
                <div className="mt-2 space-y-2 rounded-xl border border-red-100 bg-red-50 p-3 text-sm">
                  <p className="text-red-800">เหตุผลที่ยกเลิก · ระบบจะคืน {fmt(x.qty)} {x.unit} เข้าคงเหลือ และเก็บรายการนี้ไว้</p>
                  <div className="flex flex-wrap gap-1.5">{VOID_REASONS.map((r) => <button key={r} type="button" aria-pressed={reason === r} onClick={() => setReason(r)}
                    className={`rounded-full border px-3 py-1 text-xs ${reason === r ? "border-red-700 bg-red-700 text-white" : "border-cream-300 bg-white text-gold-700"}`}>{r}</button>)}</div>
                  <div className="flex gap-2"><button type="button" className="btn-soft !py-1.5" onClick={() => setVoiding(null)}>ไม่ยกเลิก</button><button type="button" className="btn-danger !py-1.5" disabled={!reason || busy} onClick={() => doVoid(x)}>{busy ? "กำลังยกเลิก…" : "ยืนยันยกเลิก"}</button></div>
                </div>
              )}
            </li>
          );
        })}</ol>}
      <p className="flex items-center gap-1.5 text-xs text-gold-500"><Icon name="doc" className="h-3.5 w-3.5" />ประวัติทั้งหมดดูได้ที่ประวัติผู้รับบริการ › ยาและการให้ยา · บันทึกเดิมแก้คงเหลือได้ที่เมนู นับยาคงเหลือ</p>
    </section>
  );
}
