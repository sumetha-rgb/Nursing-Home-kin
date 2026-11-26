"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../Icon";
import { Modal } from "../ui";
import { hourOf, shiftOfHour, suggestTimes, type ShiftCfg } from "@/lib/shifts";
import { DAYS_TH, isoDow, normTime, parseRepeat, parseWindows, repeatText, type Repeat } from "@/lib/taskPlan";

/**
 * มอบหมายงาน (26 พ.ย. 2569 · แบบใหม่) · ใช้ได้ทั้งจอคอมและมือถือ
 *  1 ใครบ้าง: แตะชื่อ (ค้นหาชื่อ/เลขห้อง) · 2 งานอะไร: พิมพ์อิสระ (ใส่เวลาต่อท้ายได้ "ตัดเล็บ 9.30" "ทานอาหาร 7-8") หรือจิ้มงานจากตั้งค่ารายการงาน
 *  3 การ์ดงาน: ครั้งเดียว / ทุกวัน / เลือกวัน (จ–อา) · เวลาเริ่ม–สิ้นสุด เลือกจาก dropdown (ทีละ 30 นาที แบ่งกะเช้า/กะดึก) · + เวลา · ลบ
 *  จอคอม: ซ้าย = รายชื่อ (แถวยาว) · ขวา = งานและเวลา · มือถือ: เรียงลงล่าง รายชื่อเลื่อนในกล่อง ปุ่มมอบหมายติดล่าง
 *  พิมพ์งานค้างไว้แล้วกดมอบหมายได้เลย (ไม่ต้องกดเพิ่ม) · งานจากรายการงานใช้เวลาแนะนำและ "ทำเมื่อไร" ที่ตั้งไว้
 *  วันนี้ (วันที่ของหน้า) สร้างงานทันที · เลือกวันแล้ววันนี้ไม่ตรง = ไม่สร้างวันนี้ ตั้งเป็นงานประจำอย่างเดียว
 */
/** เวลาเก็บตามที่พิมพ์ (อ่านค่าด้วย normTime ตอนใช้) · พิมพ์ผิดก็ยังเห็นข้อความเดิมให้แก้ */
type Time = { s: string; e: string };
type Card = { id: number; name: string; ins: string; rep: Repeat; times: Time[] };
export type AssignPlan = { who: string; name: string; ins: string; s: string; e: string; sh: string };
export type RoutineItem = { resident: string; task: string; ins: string; shift: string; time: string; end?: string; days?: number[] };

export type AssignResult = { made: number; skipped: number; routines: number; routineFail: boolean };

export default function AssignDialog({ open, onClose, date, dateText, people, master, cfg, onCreate, onRoutines, onDone }: {
  open: boolean; onClose: () => void;
  /** วันที่ของหน้ามอบหมายงาน (YYYY-MM-DD) · ข้อความวันที่ */
  date: string; dateText: string;
  people: { name: string; room: string }[];
  /** แถวรายการงาน [รหัส, ชื่องาน, คำสั่งงาน, หมวด, กะ, สาขา, วิชาชีพ, เวลาแนะนำ, ทำเมื่อไร] */
  master: string[][];
  cfg: ShiftCfg;
  /** สร้างงานของวันนี้ทีละรายการ · คืน false = มีอยู่แล้ว (ข้าม) */
  onCreate: (p: AssignPlan) => boolean;
  /** ตั้งงานประจำ · คืนจำนวนที่ตั้งได้ */
  onRoutines: (items: RoutineItem[]) => Promise<number>;
  onDone: (r: AssignResult) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const [pending, setPending] = useState("");
  const [cards, setCards] = useState<Card[]>([]);
  const [busy, setBusy] = useState(false);
  const [moreQ, setMoreQ] = useState(false);
  const seq = useRef(0);
  /** id ของการ์ดจากช่องพิมพ์ (คงที่จนกดเพิ่ม/มอบหมาย · ไม่ให้ช่องเวลาหลุดโฟกัส) */
  const pid = useRef(1_000_000);
  useEffect(() => { if (open) { setPicked([]); setQ(""); setPending(""); setCards([]); setBusy(false); setMoreQ(false); } }, [open]);

  const sug = suggestTimes(cfg);
  const lib = useMemo(() => {
    const seen = new Set<string>();
    return master.filter((r) => r[1] && !seen.has(r[1]) && seen.add(r[1]));
  }, [master]);
  const libOf = (name: string) => lib.find((r) => r[1] === name);
  const shOf = (t: string | null) => (t ? shiftOfHour(hourOf(t), cfg) : "");
  const toMin = (t: string) => { const h = hourOf(t); return Number.isNaN(h) ? NaN : Math.round(h * 60); };
  const fmt = (m: number) => { const x = ((m % 1440) + 1440) % 1440; return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`; };
  /** ตัวเลือกเวลาเริ่ม: ทุก 30 นาที เริ่มที่ต้นกะเช้า วนครบวัน แบ่งกลุ่มกะเช้า/กะดึก (มีเวลาที่ไม่ตรงตาราง = แทรกให้) */
  const startOpts = (cur: string) => {
    const d0 = Math.round(cfg.d * 60), all = Array.from({ length: 48 }, (_, i) => fmt(d0 + i * 30));
    if (cur && !all.includes(cur)) { all.push(cur); all.sort((a, b) => ((toMin(a) - d0 + 1440) % 1440) - ((toMin(b) - d0 + 1440) % 1440)); }
    return [["กะเช้า", all.filter((t) => shOf(t) === "กะเช้า")], ["กะดึก", all.filter((t) => shOf(t) === "กะดึก")]] as const;
  };
  /** เปลี่ยนเวลาเริ่ม: เลื่อนเวลาสิ้นสุดตามไปให้ช่วงยาวเท่าเดิม (เช่น 07:00–08:00 → 07:30–08:30) */
  const keepLen = (t: Time, v: string) => { const s0 = N(t.s), e0 = N(t.e); if (!s0 || !e0) return ""; const len = (toMin(e0) - toMin(s0) + 1440) % 1440; return len ? fmt(toMin(v) + len) : ""; };
  /** ตัวเลือกเวลาสิ้นสุด: ไม่กำหนด หรือ หลังเวลาเริ่ม 30 นาที – 6 ชม. (บอกว่านานเท่าไร) */
  const endOpts = (st: string, cur: string) => {
    const a = toMin(st); if (Number.isNaN(a)) return [] as { v: string; l: string }[];
    const dur = (m: number) => (m < 60 ? `${m} น.` : `${m / 60} ชม.`);
    // งานกะเช้าไม่ข้ามเที่ยงคืน (นับเลยเวลาในวันเดียวกัน) · กะดึกข้ามได้
    const o = Array.from({ length: 12 }, (_, i) => (i + 1) * 30).filter((m) => shOf(st) === "กะดึก" || a + m < 1440).map((m) => ({ v: fmt(a + m), l: `${fmt(a + m)} · ${dur(m)}` }));
    if (cur && !o.some((x) => x.v === cur)) o.unshift({ v: cur, l: cur });
    return o;
  };
  const N = (t: string) => normTime(t);

  /** "ตัดเล็บ 9.30" → { name, s } · "ทานอาหาร 7-8" → 07:00–08:00 */
  const split = (text: string): { name: string; s?: string; e?: string } => {
    const t = text.trim();
    const m = /^(.*?)\s+(\d{1,2}(?:[.:]\d{1,2})?|\d{3,4})(?:\s*(?:-|–|ถึง)\s*(\d{1,2}(?:[.:]\d{1,2})?|\d{3,4}))?\s*(?:น\.?)?$/.exec(t);
    if (!m || !m[1].trim()) return { name: t };
    const s = normTime(m[2]), e = m[3] ? normTime(m[3]) : "";
    return s ? { name: m[1].trim(), s, e: e ?? "" } : { name: t };
  };
  /** เพิ่มงาน (จากที่พิมพ์ หรือจิ้มจากรายการงาน) · ชื่อซ้ำ = เพิ่มเวลาให้การ์ดเดิม */
  const addTask = (list: Card[], text: string, id = ++seq.current): Card[] => {
    const p = split(text);
    if (!p.name) return list;
    const had = list.find((c) => c.name === p.name);
    if (had) return p.s && !had.times.some((x) => N(x.s) === p.s) ? list.map((c) => (c === had ? { ...c, times: [...c.times, { s: p.s!, e: p.e ?? "" }] } : c)) : list;
    const r = libOf(p.name);
    const wins = r ? parseWindows(r[7]) : [];
    const sh = r?.[4] || "กะเช้า";
    const times: Time[] = p.s ? [{ s: p.s, e: p.e ?? "" }] : wins.length ? wins : sh === "ทั้งสองกะ" ? [{ s: sug["กะเช้า"], e: "" }, { s: sug["กะดึก"], e: "" }] : [{ s: sh === "กะดึก" ? sug["กะดึก"] : sug["กะเช้า"], e: "" }];
    const rep: Repeat = r ? parseRepeat(r[8]) : { rep: "once", days: [] };
    return [...list, { id, name: p.name, ins: r && r[2] && r[2] !== "-" ? r[2] : "-", rep, times }];
  };
  const flushInto = (list: Card[]) => (pending.trim() ? addTask(list, pending, pid.current) : list);
  /** ย้ายงานในช่องพิมพ์ลงรายการ */
  const commit = (list: Card[]) => { setCards(list); setPending(""); pid.current++; };
  const edit = (id: number, f: (c: Card) => Card) => setCards((l) => l.map((c) => (c.id === id ? f(c) : c)));

  const all = flushInto(cards);
  /** งานที่พิมพ์ค้างในช่อง (ตามแบบ HTML: ยังไม่ขึ้นการ์ด · นับในสรุป · มอบหมายให้ตอนกดมอบหมาย) */
  const pendingCard = all.find((c) => !cards.some((x) => x.id === c.id));
  const problem = (() => {
    if (!picked.length) return "ยังไม่ได้เลือกผู้รับบริการ";
    if (!all.length) return `เลือกแล้ว ${picked.length} คน · ต่อไปเลือกหรือพิมพ์งาน`;
    for (const c of all) {
      if (!c.times.length) return `${c.name}: ยังไม่มีเวลา`;
      const t = c.times.map((x) => ({ s: N(x.s), e: N(x.e) }));
      const bad = c.times.find((x, i) => t[i].s === null || t[i].e === null);
      if (bad) return `${c.name}: อ่านเวลา "${t[c.times.indexOf(bad)].s === null ? bad.s : bad.e}" ไม่ออก · พิมพ์เช่น 7 · 730 · 19.30`;
      if (t.some((x) => !x.s)) return `${c.name}: ใส่เวลาเริ่ม`;
      if (t.some((x) => x.e && x.s && (x.e === x.s || (x.e < x.s && shOf(x.s) === "กะเช้า")))) return `${c.name}: เวลาสิ้นสุดต้องหลังเวลาเริ่ม`;
      if (t.some((x, i) => t.findIndex((y) => y.s === x.s) !== i)) return `${c.name}: มีเวลาเริ่มซ้ำกัน`;
      if (c.rep.rep === "days" && !c.rep.days.length) return `${c.name}: จิ้มเลือกวัน`;
    }
    return "";
  })();
  const dow = isoDow(date);
  const todayOf = (c: Card) => c.rep.rep !== "days" || c.rep.days.includes(dow);
  const slotsToday = all.filter(todayOf).reduce((n, c) => n + c.times.length, 0);
  const repN = all.filter((c) => c.rep.rep !== "once").length;

  const go = async () => {
    if (problem || busy) return;
    setBusy(true);
    let made = 0, skipped = 0;
    const items: RoutineItem[] = [];
    for (const who of picked) for (const c of all) for (const x of c.times) {
      const s = N(x.s) as string, e = N(x.e) || "", sh = shOf(s);
      if (todayOf(c)) { if (onCreate({ who, name: c.name, ins: c.ins, s, e, sh })) made++; else skipped++; }
      if (c.rep.rep !== "once") items.push({ resident: who, task: c.name, ins: c.ins, shift: sh, time: s, ...(e ? { end: e } : {}), ...(c.rep.rep === "days" ? { days: c.rep.days } : {}) });
    }
    let routines = 0;
    try { if (items.length) routines = await onRoutines(items); } catch { /* แจ้งผลด้านล่าง */ }
    setBusy(false);
    onClose();
    onDone({ made, skipped, routines, routineFail: items.length > 0 && routines === 0 });
  };

  const shown = people.filter((p) => !q || p.name.includes(q) || p.room.toLowerCase().includes(q.toLowerCase()));
  const quick = lib.filter((r) => !pending.trim() || r[1].includes(split(pending).name));

  return (
    <Modal open={open} wide title="มอบหมายงาน" onClose={onClose}
      footer={<div className="asg-f">
        <span className="asg-sum">{problem ? <em>{problem}</em> : <>{dateText}: สร้าง <b>{picked.length * slotsToday} งาน</b>{slotsToday ? ` (${picked.length} คน × ${slotsToday} เวลา)` : ""}{repN ? ` · ทำซ้ำ ${repN} งาน` : ""}</>}</span>
        <button type="button" className="btn-soft" onClick={onClose}>ยกเลิก</button>
        <button type="button" className="btn-primary asg-go" disabled={!!problem || busy} onClick={go}>{busy ? "กำลังมอบหมาย…" : "มอบหมาย"}</button>
      </div>}>
      <div className="asg">
        <section className="asg-s asg-who" data-q={q.trim() ? "1" : undefined}>
          <div className="asg-t"><span>1. ใครบ้าง {picked.length > 0 && <i className="asg-n">{picked.length}</i>}</span>
            <button type="button" onClick={() => setPicked(picked.length === people.length ? [] : people.map((p) => p.name))}>{picked.length === people.length && people.length ? "ไม่เลือกทั้งหมด" : "เลือกทั้งหมด"}</button></div>
          {/* มือถือ: แสดงเฉพาะคนที่เลือก (แตะ ✕ เอาออก) · พิมพ์ชื่อ/เลขห้องแล้วรายชื่อที่ตรงขึ้นให้แตะ · จอคอม: รายชื่อทั้งหมดด้านล่าง */}
          {picked.length > 0 && <div className="asg-picked">{picked.map((n) => (
            <button key={n} type="button" onClick={() => setPicked((l) => l.filter((x) => x !== n))} aria-label={`เอา ${n} ออก`}>{n} <span aria-hidden>✕</span></button>))}</div>}
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="พิมพ์ชื่อหรือเลขห้อง" aria-label="ค้นหาผู้รับบริการ" />
          <div className="asg-people">
            {shown.map((p) => { const on = picked.includes(p.name); return (
              <button key={p.name} type="button" className="asg-chip" aria-pressed={on} onClick={() => { setPicked((l) => (l.includes(p.name) ? l.filter((x) => x !== p.name) : [...l, p.name])); if (q.trim() && window.matchMedia("(max-width: 767px)").matches) setQ(""); }}>
                {on ? "✓ " : ""}{p.name}{p.room && p.room !== "-" && <small>{p.room}</small>}</button>); })}
            {!shown.length && <span className="asg-hint">{people.length ? "ไม่พบ" : "ยังไม่มีผู้รับบริการในสาขา"}</span>}
          </div>
        </section>
        <section className="asg-s">
          <div className="asg-t"><span>2. งานอะไร</span></div>
          <div className="asg-add">
            <input type="text" value={pending} onChange={(e) => setPending(e.target.value)} placeholder="พิมพ์งาน เช่น ตัดเล็บ 9.30" aria-label="พิมพ์งาน" enterKeyHint="done"
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit(flushInto(cards)); } }} />
            <button type="button" className="btn-soft" disabled={!pending.trim()} aria-label="เพิ่มงาน" onClick={() => commit(flushInto(cards))}><Icon name="plus" className="h-4 w-4" /><span>เพิ่ม</span></button>
          </div>
          <p className="asg-hint">{pendingCard ? <>กด มอบหมาย ได้เลย ({pendingCard.times.map((t) => `${N(t.s)}${N(t.e) ? `–${N(t.e)}` : ""}`).join(", ")} · {repeatText(pendingCard.rep)}) · กด + หรือ Enter เพื่อตั้งเวลาและวัน</> : "ใส่เวลาต่อท้ายได้ เช่น ทานอาหาร 7-8"}</p>
        </section>
        <section className="asg-s asg-s3">
          <div className="asg-t"><span>3. เวลาและวัน</span></div>
          {!cards.length ? <p className="asg-empty">{pending.trim() ? <>กด + หรือ Enter เพื่อตั้งเวลาและวัน · หรือกด มอบหมาย ได้เลย{split(pending).s ? ` (เวลา ${split(pending).s}${split(pending).e ? `–${split(pending).e}` : ""})` : ""}</> : "พิมพ์งานด้านบน หรือแตะงานจากรายการงาน"}</p> : (
            <div className="asg-cards">
              {cards.map((c) => {
                const isPending = !cards.some((x) => x.id === c.id);
                const upd = (f: (c: Card) => Card) => (isPending ? commit([...cards, f(c)]) : edit(c.id, f));
                return (
                  <div key={c.id} className={`asg-card ${isPending ? "is-pending" : ""}`}>
                    <div className="top">
                      <b>{c.name}{isPending && <small> · จากช่องพิมพ์</small>}</b>
                      <button type="button" className="x" aria-label={`เอางาน ${c.name} ออก`} onClick={() => (isPending ? setPending("") : setCards(cards.filter((x) => x.id !== c.id)))}>✕</button>
                      <span className="asg-seg" role="group" aria-label={`ทำ ${c.name} เมื่อไร`}>
                        {([["once", "ครั้งเดียว"], ["daily", "ทุกวัน"], ["days", "เลือกวัน"]] as const).map(([k, l]) => (
                          <button key={k} type="button" aria-pressed={c.rep.rep === k} onClick={() => upd((x) => ({ ...x, rep: { rep: k, days: k === "days" ? (x.rep.days.length ? x.rep.days : [dow]) : x.rep.days } }))}>{l}</button>))}
                      </span>
                    </div>
                    {c.rep.rep === "days" && <div className="asg-days">
                      {DAYS_TH.map((d, i) => { const on = c.rep.days.includes(i + 1); return (
                        <button key={d} type="button" aria-pressed={on} aria-label={`วัน${d}`} onClick={() => upd((x) => ({ ...x, rep: { rep: "days", days: on ? x.rep.days.filter((y) => y !== i + 1) : [...x.rep.days, i + 1].sort((a, b) => a - b) } }))}>{d}</button>); })}
                      <span className="lbl">{c.rep.days.length ? `${repeatText(c.rep)}${c.rep.days.includes(dow) ? "" : " · วันนี้ไม่สร้าง"}` : "จิ้มเลือกวัน"}</span>
                    </div>}
                    <div className="asg-tms">
                      {c.times.map((x, i) => {
                        const ns = N(x.s), bad = ns === null || N(x.e) === null, sh = bad ? "" : shOf(ns);
                        return (
                          <span key={i} className="asg-tm">
                            <span className={`sh ${bad || !sh ? "q" : sh === "กะดึก" ? "n" : ""}`} title={sh || undefined}>{bad || !sh ? "?" : sh === "กะดึก" ? "ดึก" : "เช้า"}</span>
                            <select value={ns ?? ""} aria-label={`เวลาเริ่ม ${c.name}`} aria-invalid={ns === null || undefined}
                              onChange={(e) => { const v = e.target.value; upd((y) => ({ ...y, times: y.times.map((t, j) => (j === i ? { s: v, e: keepLen(t, v) } : t)) })); }}>
                              {ns === null && <option value="">{x.s} ?</option>}
                              {!ns && ns !== null && <option value="">เริ่ม</option>}
                              {startOpts(ns ?? "").map(([g, list]) => <optgroup key={g} label={g}>{list.map((t) => <option key={t} value={t}>{t}</option>)}</optgroup>)}
                            </select>
                            <span className="to">–</span>
                            <select value={N(x.e) ?? ""} aria-label={`เวลาสิ้นสุด ${c.name}`} disabled={!ns}
                              onChange={(e) => { const v = e.target.value; upd((y) => ({ ...y, times: y.times.map((t, j) => (j === i ? { ...t, e: v } : t)) })); }}>
                              <option value="">ไม่กำหนด</option>
                              {endOpts(ns ?? "", N(x.e) ?? "").map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                            </select>
                            <button type="button" className="dx" aria-label="ลบเวลานี้" onClick={() => upd((y) => ({ ...y, times: y.times.filter((_, j) => j !== i) }))}>✕</button>
                          </span>);
                      })}
                      <button type="button" className="asg-more" onClick={() => upd((y) => { const last = N(y.times[y.times.length - 1]?.s ?? ""); let t = last ? fmt(toMin(last) + 60) : sug["กะเช้า"]; while (y.times.some((z) => N(z.s) === t)) t = fmt(toMin(t) + 30); return { ...y, times: [...y.times, { s: t, e: "" }] }; })}>+ เวลา</button>
                    </div>
                  </div>);
              })}
            </div>)}
        </section>
        <section className="asg-s asg-lib">
          <div className="asg-t"><span>เพิ่มจากรายการงาน</span>{pending.trim() && <span className="asg-hint">ตรงกับ “{split(pending).name}”</span>}</div>
          {!quick.length ? <p className="asg-hint">ไม่มีงานที่ชื่อตรงกัน · กด + เพื่อเพิ่มงานที่พิมพ์</p> : <div className="asg-quick">
            {quick.slice(0, moreQ ? undefined : 10).map((r) => <button key={r[1]} type="button" disabled={all.some((c) => c.name === r[1])} onClick={() => { setCards(addTask(cards, r[1])); if (pending.trim() && r[1].includes(split(pending).name)) setPending(""); }}>+ {r[1]}</button>)}
            {quick.length > 10 && <button type="button" className="asg-qmore" onClick={() => setMoreQ(!moreQ)}>{moreQ ? "ย่อ" : `ดูทั้งหมด (${quick.length})`}</button>}</div>}
        </section>
      </div>
    </Modal>
  );
}
