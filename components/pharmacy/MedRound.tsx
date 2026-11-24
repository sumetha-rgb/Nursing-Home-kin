"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Icon from "../Icon";
import { Avatar } from "../Avatar";
import { Modal, ThaiDateInput } from "../ui";
import { useApp } from "@/lib/app";
import { downloadCsv, refreshData } from "@/lib/store";
import { useAutoRefresh } from "@/lib/autoRefresh";
import { daysLeft, Drug, drugsFor, isLiquid, isUseDrug, MEALS, Page, stockText } from "@/lib/pharmacy";
import { DaySlot, fetchDaySlots, MEDS_EVENT, SKIP_REASONS, slotOf } from "./GiveMeds";
import { DayTimeline, fetchWithdrawals, WithdrawItem } from "./Withdraw";

/**
 * เบิกยา (KINmed) แบบ ข-1 · หน้าเดียวต่อผู้ป่วย 1 คน ไม่มีแถบรายชื่อซ้าย
 *  หัวหน้า: วันที่ + เลือกมื้อครั้งเดียว (ให้แล้ว/ทั้งหมด · ตอนนี้ · ไม่ครบ)
 *  แถบเลือกคน: รูป ห้อง ชื่อ แพ้ยา สถานะ 4 มื้อ · กดแล้วรายชื่อเลื่อนลงมา (ค้นหา · ตัวกรอง) · ‹ › · คนถัดไปที่ค้าง
 *  ซ้าย: ยามื้อนี้ ติ๊กไว้ครบ › เอาติ๊กออก = ไม่ได้ให้ + เหตุผล › 5R › บันทึกครั้งเดียว (POST /api/pharmstock op give ชุดเดียวกับ KinApp)
 *        ยาตามอาการ ยาขวด ยาทา เบิกทีละตัว (op withdraw)
 *  ขวา: เพิ่มยา · ประวัติทั้งหมด · ตารางยาวันนี้ · ประวัติวันนี้ (ยกเลิกได้) · ยาใกล้หมด
 *  บันทึกได้เฉพาะวันนี้ (server บันทึกเวลาปัจจุบัน) · วันอื่นดูอย่างเดียว
 */
export type RoundPerson = { id?: string; name: string; room: string; age?: number | string | null };
type St = "ok" | "late" | "now" | "wait" | "";
const SHORT = ["เช้า", "เที่ยง", "เย็น", "นอน"];
const ST_TEXT: Record<Exclude<St, "">, string> = { ok: "ให้แล้ว", late: "เลยมื้อ ยังไม่บันทึก", now: "มื้อนี้", wait: "ยังไม่ถึง" };
const PRN = "ตามอาการ";
/** มื้อตามเวลาตอนนี้ (ตรงกับแท็บให้ยาใน KinApp) · เช้าถึง 10:00 กลางวันถึง 14:00 เย็นถึง 19:00 */
const mealIdxNow = () => { const h = new Date().getHours(); return h < 10 ? 0 : h < 14 ? 1 : h < 19 ? 2 : 3; };
const todayIso = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round(n * 100) / 100;
const stepOf = (x: Drug) => (isLiquid(x) ? (x.dose > 0 ? x.dose : 5) : 1);
const doseOf = (x: Drug) => (isLiquid(x) ? x.dose || 5 : x.dose || 1);
const unitOf = (x: Drug) => (isLiquid(x) ? "ml" : x.unit);
const roomKey = (p: RoundPerson) => (p.room && p.room !== "-" ? p.room : "");
const initials = (n: string) => n.replace(/^(คุณ|นาย|นางสาว|นาง)\s*/, "").slice(0, 2);
async function post<T>(body: object): Promise<T> {
  const r = await fetch("/api/pharmstock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "บันทึกไม่สำเร็จ");
  return d as T;
}

export default function MedRound({ drugs, people, who, setWho, allergy, me, canVoidAll, onAddDrug, go }: {
  drugs: Drug[]; people: RoundPerson[]; who: string; setWho: (w: string) => void; allergy: Record<string, string>;
  me: string; canVoidAll: boolean; onAddDrug: (who: string) => void; go: (p: Page) => void;
}) {
  const { toast, confirm } = useApp();
  const [date, setDate] = useState(todayIso);
  const isToday = date === todayIso();
  const [meal, setMeal] = useState(MEALS[mealIdxNow()]);
  const [slots, setSlots] = useState<DaySlot[] | null>(null);
  const [tick, setTick] = useState(0);
  const load = useCallback(() => { fetchDaySlots(date).then(setSlots).catch(() => setSlots([])); }, [date]);
  useEffect(() => { load(); }, [load, tick]);
  useAutoRefresh(load);
  const bump = () => { setTick((k) => k + 1); refreshData("pharmacy-drugs"); window.dispatchEvent(new Event(MEDS_EVENT)); };

  // ---------- สถานะของแต่ละคน ----------
  const listOf = useCallback((w: string, m: string) => drugsFor(drugs, w, m, date), [drugs, date]);
  const recsOf = (d: Drug, m: string) => slotOf(slots ?? [], d.id, m);
  const doneOf = (w: string, m: string) => { const l = listOf(w, m); return l.length > 0 && l.every((d) => recsOf(d, m).length > 0); };
  const stOf = (w: string, m: string): St => {
    if (!listOf(w, m).length) return "";
    if (doneOf(w, m)) return "ok";
    if (date < todayIso()) return "late";
    if (date > todayIso()) return "wait";
    const i = MEALS.indexOf(m), n = mealIdxNow();
    return i < n ? "late" : i === n ? "now" : "wait";
  };
  const pendingOf = (w: string) => listOf(w, meal).length > 0 && !doneOf(w, meal);
  const hasPrn = (w: string) => drugs.some((x) => x.who === w && isUseDrug(x) && !x.hold);
  const ordered = useMemo(() => [...people].sort((a, b) => Number(!roomKey(a)) - Number(!roomKey(b)) || roomKey(a).localeCompare(roomKey(b), "th", { numeric: true }) || a.name.localeCompare(b.name, "th")), [people]);
  const cur = people.find((p) => p.name === who) ?? ordered[0];
  const curName = cur?.name ?? "";
  const dueList = ordered.filter((p) => pendingOf(p.name));
  /** คนถัดไปที่ค้างมื้อนี้ (ข้ามคน skip) */
  const nextDue = (from: string, skip = "") => {
    const i = ordered.findIndex((p) => p.name === from);
    for (let k = 1; k <= ordered.length; k++) { const p = ordered[(i + k) % ordered.length]; if (p.name !== skip && p.name !== from && pendingOf(p.name)) return p; }
    return null;
  };
  const stepPerson = (dir: 1 | -1) => { const i = ordered.findIndex((p) => p.name === curName); const p = ordered[(i + dir + ordered.length) % ordered.length]; if (p) setWho(p.name); };

  // ---------- แถบเลือกคน ----------
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  /** ตัวกรองรายชื่อ: เปิดมาที่ทุกคน (แบ่งกลุ่ม ค้างมื้อนี้ › ให้แล้ว › ไม่มียามื้อนี้) */
  const [f, setF] = useState<"due" | "has" | "all" | "prn">("all");
  const qRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open) setTimeout(() => qRef.current?.focus(), 30); }, [open]);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (pickRef.current && !pickRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", off); return () => document.removeEventListener("mousedown", off);
  }, [open]);
  // แป้นพิมพ์: / ค้นหาคน · ← → คนก่อน/ถัดไป (ไม่ทำงานระหว่างพิมพ์)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (document.querySelector("[role=dialog]")) return;
      if (e.key === "/") { e.preventDefault(); setOpen(true); }
      else if (e.key === "ArrowRight") stepPerson(1);
      else if (e.key === "ArrowLeft") stepPerson(-1);
    };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  });
  const counts = { due: dueList.length, has: ordered.filter((p) => listOf(p.name, meal).length).length, all: ordered.length, prn: ordered.filter((p) => hasPrn(p.name)).length };
  const match = (p: RoundPerson) => !q.trim() || `${p.name} ${p.room}`.toLowerCase().includes(q.trim().toLowerCase());
  const shown = ordered.filter((p) => (f === "all" || (f === "due" ? pendingOf(p.name) : f === "has" ? listOf(p.name, meal).length > 0 : hasPrn(p.name))) && match(p));
  /** ทุกคน = 3 กลุ่ม · ตัวกรองที่เลือกว่าง = บอกว่าครบแล้ว แล้วแสดงทุกคนต่อ (รายชื่อไม่ว่าง) */
  const groups: { t: string; list: RoundPerson[] }[] = f === "all" || !shown.length ? [
    { t: `ค้างมื้อ${meal}`, list: ordered.filter((p) => match(p) && pendingOf(p.name)) },
    { t: `ให้ยามื้อ${meal}แล้ว`, list: ordered.filter((p) => match(p) && listOf(p.name, meal).length > 0 && !pendingOf(p.name)) },
    { t: `ไม่มียามื้อ${meal}`, list: ordered.filter((p) => match(p) && !listOf(p.name, meal).length) },
  ].filter((g) => g.list.length) : [{ t: "", list: shown }];
  const emptyNote = f !== "all" && !shown.length && !q.trim() ? (f === "due" ? `✓ ให้ยามื้อ${meal}ครบทุกคนแล้ว` : f === "has" ? `ไม่มีใครมียามื้อ${meal}` : "ไม่มีใครมียาตามอาการ") : "";
  const pick = (w: string) => { setWho(w); setOpen(false); setQ(""); };

  // ---------- ยามื้อนี้ของคนที่เลือก ----------
  const rows = curName ? listOf(curName, meal) : [];
  const live = rows.filter((d) => !recsOf(d, meal).length);
  type Form = { off: Record<number, boolean>; why: Record<number, string>; qty: Record<number, number>; ok: boolean };
  const [form, setForm] = useState<Form>({ off: {}, why: {}, qty: {}, ok: false });
  useEffect(() => { setForm({ off: {}, why: {}, qty: {}, ok: false }); }, [curName, meal, date]);
  const isOn = (d: Drug) => !form.off[d.id];
  const qtyOf = (d: Drug) => form.qty[d.id] ?? doseOf(d);
  const onN = live.filter(isOn).length, offN = live.length - onN;
  const short = live.filter((d) => isOn(d) && qtyOf(d) > d.stock);
  const missingWhy = live.some((d) => !isOn(d) && !form.why[d.id]);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!isToday) return toast("บันทึกการให้ยาได้เฉพาะวันนี้");
    if (!form.ok) return toast("กรุณาติ๊ก ตรวจชื่อผู้ป่วยและยาแล้ว");
    if (missingWhy) return toast("เลือกเหตุผลของยาที่ไม่ได้ให้ก่อนบันทึก");
    if (short.length) return toast(`ยาไม่พอ: ${short.map((d) => `${d.name} เหลือ ${stockText(d)}`).join(", ")}`);
    setBusy(true);
    try {
      await post({ op: "give", meal, checked: true,
        items: live.filter(isOn).map((d) => ({ medId: String(d.id), qty: qtyOf(d) })),
        skips: live.filter((d) => !isOn(d)).map((d) => ({ medId: String(d.id), reason: form.why[d.id] })) });
      const nx = nextDue(curName);
      toast(`บันทึกแล้ว · ${curName} มื้อ${meal} · ให้ ${onN}${offN ? ` · ไม่ได้ให้ ${offN}` : ""} รายการ${nx ? ` · ไปคนถัดไป ${nx.name}` : ""} · ผิดพลาดยกเลิกได้ที่ประวัติวันนี้`);
      bump();
      if (nx) setWho(nx.name);
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  // ---------- ยาตามอาการ ยาขวด ยาทา ----------
  const prnList = drugs.filter((x) => x.who === curName && isUseDrug(x) && !x.hold).sort((a, b) => a.name.localeCompare(b.name, "th"));
  const [prn, setPrn] = useState<Record<number, { qty: number; note: string }>>({});
  useEffect(() => { setPrn({}); }, [curName]);
  const prnOf = (d: Drug) => prn[d.id] ?? { qty: doseOf(d), note: "" };
  const [hist, setHist] = useState<WithdrawItem[]>([]);
  const loadHist = useCallback(() => { if (curName) fetchWithdrawals(curName).then(setHist).catch(() => setHist([])); }, [curName]);
  useEffect(() => { setHist([]); loadHist(); }, [loadHist, tick]);
  const prnToday = (d: Drug) => hist.filter((h) => h.med_id === String(d.id) && h.ts.startsWith(date) && !h.void_reason && !h.skip_reason);
  const withdrawPrn = (d: Drug) => {
    const v = prnOf(d);
    if (!(v.qty > 0)) return toast("กรุณาระบุจำนวน");
    if (v.qty > d.stock) return toast(`เบิกเกินคงเหลือ · ${d.name} เหลือ ${stockText(d)}`);
    const before = prnToday(d);
    confirm({ title: before.length ? "วันนี้เบิกยานี้ไปแล้ว · ยืนยันอีกครั้ง" : "ยืนยันเบิกยา", danger: before.length > 0, okLabel: "เบิก",
      message: `${before.length ? `⚠ วันนี้เบิก ${d.name} ไปแล้ว ${before.length} ครั้ง (${before.map((h) => h.ts.slice(11, 16)).join(" / ")}) · ตรวจว่าไม่ใช่การให้ยาซ้ำ\n\n` : ""}เบิก ${d.name} ${fmt(v.qty)} ${d.unit} ให้ ${curName} · ${PRN} · คงเหลือ ${fmt(d.stock)} → ${fmt(round2(d.stock - v.qty))} ${d.unit}`,
      onOk: async () => {
        try { await post({ op: "withdraw", medId: String(d.id), qty: v.qty, meal: PRN, note: v.note }); toast(`เบิกแล้ว · ${d.name} ${fmt(v.qty)} ${d.unit}`); setPrn((s) => { const c = { ...s }; delete c[d.id]; return c; }); bump(); }
        catch (e) { toast((e as Error).message); }
      } });
  };

  // ---------- ข้อมูลประกอบ ----------
  const mine = drugs.filter((x) => x.who === curName && !isUseDrug(x) && !x.hold).sort((a, b) => a.name.localeCompare(b.name, "th"));
  const low = drugs.filter((x) => x.who === curName && !x.hold && (x.stock < doseOf(x) || (daysLeft(x) ?? 99) <= 3));
  const [histOpen, setHistOpen] = useState(false);

  const mealBtn = (m: string, i: number) => {
    const ws = ordered.filter((p) => listOf(p.name, m).length), left = ws.filter((p) => !doneOf(p.name, m)).length;
    const bad = left > 0 && (date < todayIso() || (isToday && i < mealIdxNow()));
    return <button key={m} type="button" aria-pressed={meal === m} onClick={() => setMeal(m)} className={`mr-meal ${bad ? "is-bad" : ""} ${ws.length ? "" : "is-empty"}`}>
      <b>{m}</b><small>{ws.length ? `${ws.length - left}/${ws.length}` : "-"}{isToday && i === mealIdxNow() ? " · ตอนนี้" : bad ? " · ไม่ครบ" : ""}</small></button>;
  };
  const dot = (s: St, i: number) => (s ? <span key={i} className={`mr-dot is-${s}`} title={`${MEALS[i]} · ${ST_TEXT[s]}`}>{SHORT[i]}{s === "ok" ? " ✓" : s === "late" ? " !" : ""}</span> : null);

  return (
    <div className="space-y-4">
      {/* หัวหน้า: ชื่อหน้า วันที่ มื้อ */}
      <div className="mr-top">
        <div className="min-w-0"><h1 className="text-xl font-semibold text-gold-900">เบิกยา</h1><p className="text-xs text-gold-500">ให้ยาตามมื้อ บันทึกครั้งเดียวทั้งมื้อ · ยาตามอาการเบิกทีละตัว</p></div>
        <div className="w-44"><ThaiDateInput label="วันที่" value={date} onChange={(v) => v && setDate(v)} /></div>
        <div className="mr-meals" role="group" aria-label="เลือกมื้อ">{MEALS.map(mealBtn)}</div>
      </div>

      {/* แถบเลือกคน (แทนรายชื่อซ้าย) */}
      <div className="mr-pick" ref={pickRef}>
        <button type="button" className="mr-nav" aria-label="คนก่อนหน้า" onClick={() => stepPerson(-1)}>‹</button>
        {cur && <button type="button" className="mr-who" aria-expanded={open} onClick={() => setOpen(!open)}>
          <Avatar kind="resident" id={cur.id} name={cur.name} size={44} />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">{roomKey(cur) && <span className="mr-rm">{roomKey(cur)}</span>}<b className="truncate text-[17px] text-gold-900">{cur.name}</b>{allergy[cur.name] && <span className="mr-alg">แพ้ยา {allergy[cur.name]}</span>}</span>
            <small className="block text-xs text-gold-500">{cur.age ? `${cur.age} ปี · ` : ""}ยาประจำ {drugs.filter((x) => x.who === cur.name && !x.hold).length} รายการ · กดเพื่อเปลี่ยนคน<span className="hidden lg:inline"> (กด / ค้นหา)</span></small>
          </span>
          <span className="mr-dots">{MEALS.map((m, i) => dot(stOf(cur.name, m), i))}</span>
          <Icon name="chevron" className={`h-4 w-4 shrink-0 text-gold-500 transition ${open ? "rotate-180" : ""}`} />
        </button>}
        <button type="button" className="mr-nav" aria-label="คนถัดไป" onClick={() => stepPerson(1)}>›</button>
        <button type="button" className="mr-next" disabled={!nextDue(curName)} onClick={() => { const n = nextDue(curName); if (n) setWho(n.name); }}>
          คนถัดไปที่ค้าง ›<small>{dueList.length ? `ค้างมื้อ${meal} ${dueList.length} คน` : `มื้อ${meal}ครบทุกคนแล้ว`}</small></button>
        {open && <div className="mr-dd" role="listbox" aria-label="เลือกผู้ป่วย">
          <input ref={qRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อ / ห้อง" aria-label="ค้นหาผู้ป่วย"
            onKeyDown={(e) => { if (e.key === "Enter" && shown[0]) pick(shown[0].name); if (e.key === "Escape") setOpen(false); }} />
          <div className="mr-chips">{([["all", "ทุกคน"], ["due", `ค้างมื้อ${meal}`], ["has", `มียามื้อ${meal}`], ["prn", "มียาตามอาการ"]] as const).map(([k, l]) =>
            <button key={k} type="button" aria-pressed={f === k} onClick={() => setF(k)}>{l} <b>{counts[k]}</b></button>)}</div>
          {emptyNote && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800">{emptyNote} · แสดงทุกคนด้านล่าง</p>}
          <div className="mr-rows">{groups.some((g) => g.list.length) ? groups.map((g) => (
            <div key={g.t || "list"} className="grid gap-0.5">
              {g.t && <p className="mr-grp">{g.t} · {g.list.length}</p>}
              {g.list.map((p) => (
                <button key={p.name} type="button" role="option" aria-selected={p.name === curName} className="mr-row" onClick={() => pick(p.name)}>
                  <span className="mr-rm text-center">{roomKey(p) || "–"}</span>
                  <span className="min-w-0"><b className="truncate">{p.name}</b>{allergy[p.name] && <span className="mr-alg ml-1.5">แพ้ยา</span>}</span>
                  <span className="mr-dots">{MEALS.map((m, i) => dot(stOf(p.name, m), i))}</span>
                </button>))}
            </div>)) : <p className="px-2 py-3 text-sm text-gold-500">{q ? `ไม่พบ "${q}"` : "ไม่มีรายชื่อ"}</p>}</div>
        </div>}
      </div>

      {!cur ? <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-gold-500">ยังไม่มีผู้ป่วยในสาขานี้</p> : (
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ซ้าย: งานที่ต้องทำ */}
        <div className="min-w-0 space-y-4">
          <div className="mr-card">
            <div className="mr-h"><b>ยามื้อ{meal} · {rows.length} รายการ</b><small>{!isToday ? "ดูย้อนหลัง · บันทึกได้เฉพาะวันนี้" : live.length ? "ติ๊กไว้ครบแล้ว · ตัวไหนไม่ได้ให้ เอาติ๊กออกแล้วเลือกเหตุผล" : rows.length ? "บันทึกครบแล้ว" : ""}</small></div>
            {slots === null ? <p className="px-4 py-6 text-center text-sm text-gold-500">กำลังโหลด…</p> : !rows.length ? (
              <p className="border-t border-cream-200 px-4 py-5 text-sm text-gold-500">ไม่มียามื้อ{meal}{drugs.some((x) => x.who === curName) ? "" : <> · {curName} ยังไม่มียาในระบบ <button type="button" className="font-medium text-gold-800 underline" onClick={() => onAddDrug(curName)}>เพิ่มยา</button></>}</p>
            ) : rows.map((d) => {
              const recs = recsOf(d, meal), g = recs.find((r) => !r.skip_reason), k = recs.find((r) => r.skip_reason);
              if (recs.length) return (
                <div key={d.id} className="mr-rx is-done">
                  <span className={g ? "text-emerald-700" : "text-amber-700"} aria-hidden>{g ? "✓" : "✕"}</span>
                  <div className="min-w-0"><b className="block text-[14.5px] text-gold-900">{d.name}</b><small className="text-xs text-gold-500">{d.how || `ครั้งละ ${fmt(d.dose)} ${d.unit}`}</small></div>
                  <b className="hidden tabular-nums text-gold-800 sm:block">{g ? `${fmt(g.qty)} ${unitOf(d)}` : "–"}</b>
                  <small className={g ? "font-semibold text-emerald-700" : "font-semibold text-amber-800"}>{g ? <><span className="sm:hidden">{fmt(g.qty)} {unitOf(d)} · </span>ให้แล้ว {g.at} · {g.by ?? "-"}</> : `ไม่ได้ให้ · ${k!.skip_reason} · ${k!.by ?? "-"}`}</small>
                </div>);
              const on = isOn(d), qn = qtyOf(d), over = on && qn > d.stock, dl = daysLeft(d);
              return (
                <div key={d.id} className={`mr-rx ${on ? "" : "is-off"}`}>
                  <input type="checkbox" className="!h-5 !w-5 !min-h-0 accent-emerald-700" checked={on} disabled={!isToday} aria-label={`ให้ ${d.name}`}
                    onChange={(e) => setForm((s) => ({ ...s, off: { ...s.off, [d.id]: !e.target.checked } }))} />
                  <div className="min-w-0"><b className="block text-[14.5px] text-gold-900">{d.name}</b>
                    <small className="block text-xs text-gold-500">{[d.how, d.warn.length ? `คำเตือน: ${d.warn.join(" · ")}` : ""].filter(Boolean).join(" · ") || `ครั้งละ ${fmt(d.dose)} ${d.unit}`}</small></div>
                  <div className="mr-step"><button type="button" aria-label="ลด" disabled={!isToday || !on} onClick={() => setForm((s) => ({ ...s, qty: { ...s.qty, [d.id]: Math.max(stepOf(d), round2(qn - stepOf(d))) } }))}>−</button>
                    <span>{fmt(qn)} {unitOf(d)}</span>
                    <button type="button" aria-label="เพิ่ม" disabled={!isToday || !on} onClick={() => setForm((s) => ({ ...s, qty: { ...s.qty, [d.id]: round2(qn + stepOf(d)) } }))}>+</button></div>
                  <div className={`text-xs leading-tight ${over ? "font-semibold text-red-700" : dl !== null && dl <= 3 ? "text-amber-800" : "text-emerald-700"}`}>
                    <b className="block text-[13px] text-gold-900">{stockText(d)}</b>{over ? "ไม่พอมื้อนี้" : dl !== null ? `พออีก ${dl} วัน${dl <= 3 ? " · ใกล้หมด" : ""}` : "คงเหลือ"}</div>
                  {!on && <div className="mr-why">ไม่ได้ให้เพราะ {SKIP_REASONS.map((r) => <button key={r} type="button" aria-pressed={form.why[d.id] === r}
                    onClick={() => setForm((s) => ({ ...s, why: { ...s.why, [d.id]: r } }))}>{r}</button>)}</div>}
                </div>);
            })}
            {isToday && live.length > 0 && (
              <div className="mr-save">
                <label className="flex cursor-pointer items-center gap-2.5 text-sm font-semibold text-gold-900">
                  <input type="checkbox" className="!h-5 !w-5 !min-h-0 accent-emerald-700" checked={form.ok} onChange={(e) => setForm((s) => ({ ...s, ok: e.target.checked }))} />
                  <span>ตรวจชื่อผู้ป่วยและยาแล้ว<small className="block text-[11.5px] font-normal text-gold-500">5R: ถูกคน ถูกยา ถูกขนาด ถูกเวลา ถูกวิธี</small></span></label>
                <button type="button" className="btn-primary ml-auto !px-5" disabled={busy || !form.ok || missingWhy || short.length > 0} onClick={save}>
                  {busy ? "กำลังบันทึก…" : offN ? `บันทึก · ให้ ${onN} · ไม่ได้ให้ ${offN}` : `บันทึกการให้ยา ${onN} รายการ`}</button>
              </div>
            )}
          </div>

          <div className="mr-card">
            <div className="mr-h"><b>ยาตามอาการ · ยาขวด · ยาทา</b><small>เบิกเมื่อใช้ ทีละตัว</small></div>
            {!prnList.length ? <p className="border-t border-cream-200 px-4 py-4 text-sm text-gold-500">ไม่มียาตามอาการ · เพิ่มได้จากปุ่ม เพิ่มยา</p> : prnList.map((d) => {
              const v = prnOf(d), today = prnToday(d), over = v.qty > d.stock;
              return (
                <div key={d.id} className="mr-prn">
                  <div className="min-w-0"><b className="block text-[14px] text-gold-900">{d.name}</b>
                    <small className="block text-xs text-gold-500">{[d.how || d.use, today.length ? `วันนี้เบิกแล้ว ${today.length} ครั้ง · ล่าสุด ${today[today.length - 1].ts.slice(11, 16)}` : ""].filter(Boolean).join(" · ")}</small></div>
                  <div className="mr-step"><button type="button" aria-label="ลด" disabled={!isToday} onClick={() => setPrn((s) => ({ ...s, [d.id]: { ...v, qty: Math.max(stepOf(d), round2(v.qty - stepOf(d))) } }))}>−</button>
                    <span>{fmt(v.qty)} {unitOf(d)}</span>
                    <button type="button" aria-label="เพิ่ม" disabled={!isToday} onClick={() => setPrn((s) => ({ ...s, [d.id]: { ...v, qty: round2(v.qty + stepOf(d)) } }))}>+</button></div>
                  <input className="!min-h-0 !py-1.5 text-sm" placeholder="หมายเหตุ เช่น ไข้ 38.2" aria-label={`หมายเหตุ ${d.name}`} value={v.note} disabled={!isToday} onChange={(e) => setPrn((s) => ({ ...s, [d.id]: { ...v, note: e.target.value } }))} />
                  <div className={`text-xs leading-tight ${over ? "font-semibold text-red-700" : "text-gold-500"}`}><b className="block text-[13px] text-gold-900">{stockText(d)}</b>{over ? "ไม่พอ" : "คงเหลือ"}</div>
                  <button type="button" className="btn-soft !min-h-[36px] !px-4 !py-1.5" disabled={!isToday || over || d.stock <= 0} onClick={() => withdrawPrn(d)}>เบิก</button>
                </div>);
            })}
          </div>
        </div>

        {/* ขวา: ข้อมูลประกอบ */}
        <div className="min-w-0 space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-soft !justify-center" onClick={() => onAddDrug(curName)}><Icon name="plus" className="h-4 w-4" /> เพิ่มยา</button>
            <button type="button" className="btn-soft !justify-center" onClick={() => setHistOpen(true)}><Icon name="history" className="h-4 w-4" /> ประวัติทั้งหมด</button>
          </div>
          <div className="mr-card">
            <div className="mr-h"><b>ตารางยาวันนี้</b><small>✓ ให้ · ✕ ไม่ได้ให้ · ! เลยมื้อ</small></div>
            {!mine.length ? <p className="border-t border-cream-200 px-4 py-3 text-sm text-gold-500">ไม่มียาตามมื้อ</p> : (
              <div className="overflow-x-auto px-3 pb-2"><table className="mr-mar"><thead><tr><th>ยา</th>{SHORT.map((m) => <th key={m}>{m}</th>)}</tr></thead><tbody>
                {mine.map((d) => <tr key={d.id}><td title={d.name}>{d.name.split(" ")[0]}</td>{MEALS.map((m) => {
                  if (!drugsFor([d], curName, m, date).length) return <td key={m} className="is-na">–</td>;
                  const r = recsOf(d, m), g = r.find((x) => !x.skip_reason);
                  if (r.length) return <td key={m} className={g ? "is-ok" : "is-x"} title={g ? `${g.at} · ${g.by ?? "-"}` : r[0].skip_reason ?? ""}>{g ? "✓" : "✕"}</td>;
                  const s = stOf(curName, m);
                  return <td key={m} className={s === "late" ? "is-late" : ""}>{s === "late" ? "!" : s === "now" ? "รอ" : "·"}</td>;
                })}</tr>)}
              </tbody></table></div>)}
          </div>
          <div className="mr-card px-3 py-3">
            <DayTimeline only="use" who={curName} date={date} packs={[]} me={me} canVoidAll={canVoidAll} reload={tick} onVoided={bump} />
          </div>
          {low.length > 0 && <div className="mr-card space-y-2 !border-amber-200 !bg-amber-50/70 px-3 py-3">
            <b className="block text-sm text-amber-900">ยาใกล้หมดของ {curName}</b>
            {low.map((d) => { const dl = daysLeft(d); return <p key={d.id} className="text-[13px] text-amber-900"><b>{d.name}</b> เหลือ {stockText(d)}{dl !== null ? ` · พออีก ${dl} วัน` : ""}</p>; })}
            <div className="flex flex-wrap gap-2"><button type="button" className="btn-soft !min-h-[34px] !py-1 text-xs" onClick={() => go("inventory")}>เติมยา (ญาตินำมา)</button><button type="button" className="btn-soft !min-h-[34px] !py-1 text-xs" onClick={() => go("central")}>เบิกจากคลังกลาง</button></div>
          </div>}
          <p className="hidden text-xs text-gold-500 lg:block">แป้นพิมพ์: <kbd>/</kbd> ค้นหาคน · <kbd>←</kbd> <kbd>→</kbd> คนก่อน/ถัดไป</p>
        </div>
      </div>)}

      <HistoryModal open={histOpen} who={curName} items={hist} onClose={() => setHistOpen(false)} />
    </div>
  );
}

/* ---------- ประวัติทั้งหมด: ให้ยา ไม่ได้ให้ ตามอาการ ยกเลิก · กรองช่วงและประเภท · ส่งออก CSV ---------- */
type Kind = "give" | "skip" | "prn" | "void" | "old";
const KIND_TEXT: Record<Kind, string> = { give: "ให้ยา", skip: "ไม่ได้ให้", prn: "ตามอาการ", void: "ยกเลิก", old: "บันทึกเดิม" };
const kindOf = (h: WithdrawItem): Kind => (h.legacy ? "old" : h.void_reason ? "void" : h.skip_reason ? "skip" : !h.meal || h.meal.includes(PRN) ? "prn" : "give");
const thDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${Number(iso.slice(0, 4)) + 543}`;
function HistoryModal({ open, who, items, onClose }: { open: boolean; who: string; items: WithdrawItem[]; onClose: () => void }) {
  const [range, setRange] = useState<"1" | "7" | "30" | "all">("7");
  const [kind, setKind] = useState<"all" | Kind>("all");
  const since = range === "all" ? "" : new Date(Date.now() + 7 * 3600e3 - (Number(range) - 1) * 864e5).toISOString().slice(0, 10);
  const list = items.filter((h) => (!since || h.ts.slice(0, 10) >= since) && (kind === "all" || kindOf(h) === kind)).sort((a, b) => b.ts.localeCompare(a.ts));
  const today = todayIso(), yest = new Date(Date.now() + 7 * 3600e3 - 864e5).toISOString().slice(0, 10);
  const qtyText = (h: WithdrawItem) => (h.skip_reason ? "–" : `${fmt(h.qty)} ${h.unit ?? ""}`.trim());
  const stockMove = (h: WithdrawItem) => (h.b !== null && h.s !== null ? `${fmt(h.b)} → ${fmt(h.s)}` : "–");
  const noteOf = (h: WithdrawItem) => [h.skip_reason, h.void_reason ? `ยกเลิก: ${h.void_reason} · ${h.voided_by ?? "-"}` : "", h.note].filter(Boolean).join(" · ") || "–";
  const exportCsv = () => downloadCsv(`ประวัติให้และเบิกยา-${who}`, ["วันที่", "เวลา", "ประเภท", "ยา", "มื้อ", "จำนวน", "คงเหลือก่อน", "คงเหลือหลัง", "ผู้บันทึก", "หมายเหตุ"],
    list.map((h) => [thDay(h.ts.slice(0, 10)), h.ts.slice(11, 16), KIND_TEXT[kindOf(h)], h.name, h.meal ?? "", h.skip_reason ? "" : String(h.qty), h.b === null ? "" : String(h.b), h.s === null ? "" : String(h.s), h.by ?? "", noteOf(h) === "–" ? "" : noteOf(h)]));
  let day = "";
  return (
    <Modal open={open} wide title={`ประวัติการให้และเบิกยา · ${who}`} onClose={onClose}
      footer={<><span className="mr-auto text-xs text-gold-500">{list.length} รายการ<span className="hidden sm:inline"> · รายการที่ยกเลิกขีดฆ่าไว้ ไม่ลบทิ้ง · การเติมยาดูที่ประวัติผู้รับบริการ › ยาและการให้ยา</span></span>
        <button type="button" className="btn-soft whitespace-nowrap" disabled={!list.length} onClick={exportCsv}>ส่งออก CSV</button><button type="button" className="btn-primary whitespace-nowrap" onClick={onClose}>ปิด</button></>}>
      <div className="mr-hf">
        <span>ช่วง</span><div>{([["1", "วันนี้"], ["7", "7 วัน"], ["30", "30 วัน"], ["all", "ทั้งหมด"]] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={range === k} onClick={() => setRange(k)} className="mr-chip">{l}</button>)}</div>
        <span>ประเภท</span><div>{([["all", "ทั้งหมด"], ["give", "ให้ยา"], ["skip", "ไม่ได้ให้"], ["prn", "ตามอาการ"], ["void", "ยกเลิก"]] as const).map(([k, l]) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className="mr-chip">{l}</button>)}</div>
      </div>
      {!list.length ? <p className="rounded-xl bg-cream-50 px-4 py-8 text-center text-sm text-gold-500">ไม่มีรายการในช่วงนี้</p> : <>
        {/* มือถือ: การ์ดแถวละรายการ (ตารางกว้างเกินจอ ข้อความตัดกัน) */}
        <div className="grid gap-1.5 sm:hidden">{(() => { let dd = ""; return list.map((h) => {
          const d = h.ts.slice(0, 10), head = d !== dd ? (dd = d, <p key={`m${d}`} className="mr-hday">{d === today ? "วันนี้ · " : d === yest ? "เมื่อวาน · " : ""}{thDay(d)}</p>) : null, k = kindOf(h);
          return [head, <div key={`m${h.id}`} className={`mr-hcard ${k === "void" ? "is-void" : ""}`}>
            <div className="flex items-center gap-2"><b className="tabular-nums text-gold-900">{h.ts.slice(11, 16)}</b><span className={`mr-k is-${k}`}>{KIND_TEXT[k]}</span><b className="ml-auto tabular-nums text-gold-900">{qtyText(h)}</b></div>
            <p className="mr-hname">{h.name}<small> · {h.meal || "-"}</small></p>
            <p className="text-xs text-gold-600">{h.b !== null && h.s !== null ? `คงเหลือ ${stockMove(h)} · ` : ""}{h.by ?? "-"}</p>
            {noteOf(h) !== "–" && <p className="text-xs text-gold-700">{noteOf(h)}</p>}
          </div>];
        }); })()}</div>
        <div className="hidden overflow-x-auto sm:block"><table className="mr-hist"><thead><tr><th>เวลา</th><th>ประเภท</th><th>ยา · มื้อ</th><th className="text-right">จำนวน</th><th className="text-right">คงเหลือ ก่อน → หลัง</th><th>ผู้บันทึก</th><th>หมายเหตุ / เหตุผล</th></tr></thead>
          <tbody>{list.map((h) => {
            const d = h.ts.slice(0, 10), head = d !== day ? (day = d, <tr key={`d${d}`} className="is-day"><td colSpan={7}>{d === today ? "วันนี้ · " : d === yest ? "เมื่อวาน · " : ""}{thDay(d)}</td></tr>) : null, k = kindOf(h);
            return [head, <tr key={h.id} className={k === "void" ? "is-void" : ""}>
              <td className="tabular-nums">{h.ts.slice(11, 16)}</td><td><span className={`mr-k is-${k}`}>{KIND_TEXT[k]}</span></td>
              <td><b className="text-gold-900">{h.name}</b><small className="block text-gold-500">{h.meal || "-"}</small></td>
              <td className="text-right tabular-nums">{qtyText(h)}</td><td className="text-right tabular-nums">{stockMove(h)}</td><td>{h.by ?? "-"}</td><td>{noteOf(h)}</td>
            </tr>];
          })}</tbody></table></div>
      </>}
    </Modal>
  );
}
