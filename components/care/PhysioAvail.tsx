"use client";
import { useEffect, useMemo, useState } from "react";
import { addDays, blockHit, blockText, dayLabel, DAY_TH, DEFAULT_HOURS, dowOf, hoursOn, leftOf, monthLabel, onDate, PhysioBlock, PhysioCase, PhysioHours, schedOf, timeOn, whoOn } from "@/lib/physio";
import { fetchMonth, Month } from "@/lib/roster";

/**
 * ตารางว่างนักกายภาพ (26 พ.ย. 2569) · ดูทีละสัปดาห์ (จ.–อา.) หรือทีละเดือน (เดือนนี้เริ่มจากวันนี้)
 *  สัปดาห์นี้: วันที่ผ่านไปแล้วเป็นช่องลาย กดไม่ได้
 *  ไม่เลือกเคส: แถว = นักกายภาพ · ช่อง = วัน → แถบเวลา 08:00–18:00 (ช่วงที่มีนัด) + จำนวนนัด + ชั่วโมงว่าง · กดช่อง = วางนัด (เลือกคนนั้นไว้แล้ว)
 *  เลือกเคส + เวลา: แต่ละวันแสดงเฉพาะนักกายภาพที่ว่างช่วงนั้น · กดชื่อ = วางนัดเคสนี้ให้คนนั้นทันที (หน้าต่างยืนยัน)
 *  วันหยุด: นักกายภาพที่มีเวรในตารางเวรเดือนนั้น วันที่ไม่มีเวร = หยุด · ไม่มีเวรเลยทั้งเดือน = ถือว่าทำทุกวัน
 *  ว่าง = ไม่มีนัดทับช่วงเวลา (ตามวันเวลาจริงของแต่ละนัด รวมนัดที่ย้าย/เพิ่ม) และไม่ได้ตั้งไม่ว่าง (ลา ป่วย ประชุม)
 *  กดช่อง = เมนู วางนัด / ตั้งไม่ว่าง · ชั่วโมงว่าง = เวลางานของคนนั้น (ค่าเริ่มต้น 08:00–19:00) ลบเวลาที่มีนัดและที่ตั้งไม่ว่าง
 *  เวลางานรายคน: ปุ่ม "ตั้งเวลางาน" ใต้ชื่อ (ช่องซ้าย) → ตั้งเวลาเข้า–ออก และวันที่เข้างาน · วันที่ไม่เข้างาน = "ไม่เข้างาน"
 *  ดูแบบ 14 วัน | ทั้งเดือน (เลื่อนทีละเดือน ดูล่วงหน้าได้หลายเดือน · ใช้วางแผนลา/ไม่ว่างล่วงหน้า)
 */
const W0 = 6 * 60, W1 = 21 * 60;
/** วันจันทร์ของสัปดาห์ */
const monOf = (d: string) => addDays(d, -((dowOf(d) + 6) % 7));
const toMin = (t: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(t ?? ""); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
const hm = (n: number) => `${String(Math.floor(n / 60) % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const TIMES = Array.from({ length: (W1 - W0) / 30 }, (_, i) => hm(W0 + i * 30));

/** นาที → "9 ชม. 15 นาที" */
const dur = (m: number) => { const h = Math.floor(m / 60), r = m % 60; return h && r ? `${h} ชม. ${r} นาที` : h ? `${h} ชม.` : `${r} นาที`; };
/** แบบย่อในช่อง: "10 ชม. 15 น." */
const durS = (m: number) => dur(m).replace("นาที", "น.");

export default function PhysioAvail({ cases, therapists, today, branch, canAssign, blocks = [], hours = [], onBook, onBlock, onHours }: {
  cases: PhysioCase[]; therapists: { id: string; name: string }[]; today: string; branch?: string; canAssign: boolean;
  /** ช่วงไม่ว่างที่ตั้งไว้ (ลา ป่วย ประชุม) */ blocks?: PhysioBlock[];
  /** วางนัด: วันที่ เวลา (เคส · นักกายภาพ ที่เลือกไว้) */ onBook: (date: string, time: string, cid?: string, tid?: string) => void;
  /** ตั้งไม่ว่าง (นักกายภาพ · วันที่) */ onBlock?: (tid: string, tname: string, date: string) => void;
  /** เวลางานรายคน */ hours?: PhysioHours[];
  /** ตั้งเวลางาน (นักกายภาพ) */ onHours?: (tid: string, tname: string) => void;
}) {
  /** เวลางานของคนนี้วันนั้น · null = ไม่เข้างาน */
  const hrs = (tid: string, date: string) => hoursOn(hours, tid, date);
  const hm2 = (n: number) => hm(n);
  /** ข้อความเวลางาน เช่น "08:00–19:00 · ทุกวัน" */
  const hoursLabel = (tid: string) => {
    const h = hours.find((x) => x.therapist_id === tid);
    const r = h ?? { s: DEFAULT_HOURS.s, e: DEFAULT_HOURS.e, days: null };
    return `${hm2(r.s)}–${hm2(r.e)} · ${r.days?.length ? r.days.map((x) => DAY_TH[x]).join(" ") : "ทุกวัน"}`;
  };
  /** เมนูของช่องที่กด (วางนัด / ตั้งไม่ว่าง) */
  const [pop, setPop] = useState<{ tid: string; tname: string; date: string; x: number; y: number } | null>(null);
  const [start, setStart] = useState(monOf(today));
  const [cid, setCid] = useState("");
  const [time, setTime] = useState("09:00");
  const [roster, setRoster] = useState<Month[]>([]);
  /** มุมมอง: 14 วัน | ทั้งเดือน (ym = เดือนที่ดู) */
  const [view, setView] = useState<"week" | "month">("week");
  const [ym, setYm] = useState(today.slice(0, 7));
  const shiftYm = (n: number) => { const [y, m] = ym.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); setYm(d.toISOString().slice(0, 7)); };
  const days = useMemo(() => {
    if (view === "week") return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const [y, m] = ym.split("-").map(Number), n = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return Array.from({ length: n }, (_, i) => `${ym}-${String(i + 1).padStart(2, "0")}`).filter((x) => x >= today);
  }, [view, start, ym, today]);
  // ตารางเวรของเดือนที่อยู่ในช่วง (ใช้ดูวันหยุดของนักกายภาพ)
  useEffect(() => {
    const yms = [...new Set(days.map((d) => d.slice(0, 7)))];
    Promise.all(yms.map((ym) => fetchMonth(ym, branch).catch(() => null))).then((l) => setRoster(l.filter(Boolean) as Month[]));
  }, [days, branch]);
  const c = cases.find((x) => x.id === cid) ?? null;
  useEffect(() => { if (c?.plan_time) setTime(c.plan_time); }, [cid]); // eslint-disable-line react-hooks/exhaustive-deps
  const minutes = c?.plan_minutes || 45;
  /** นัดของนักกายภาพคนนี้วันนั้น [เริ่ม, จบ] (นาที) */
  const booked = (tid: string, date: string, skip?: string) => cases.filter((k) => k.id !== skip && onDate(schedOf(k), date) && whoOn(k, date)?.id === tid)
    .map((k) => { const s = toMin(timeOn(k, date)); return { k: k as PhysioCase | null, s, e: s + (k.plan_minutes || 45), b: null as PhysioBlock | null }; }).filter((x) => !Number.isNaN(x.s))
    .concat(blockHit(blocks, tid, date).filter((b) => b.s != null && b.e != null).map((b) => ({ k: null, s: b.s!, e: b.e!, b }))).sort((a, b) => a.s - b.s);
  /** ตั้งไม่ว่างทั้งวัน */
  const allDay = (tid: string, date: string) => blockHit(blocks, tid, date).find((b) => b.s == null || b.e == null) ?? null;
  /** หยุดวันนั้น (มีเวรในเดือนนั้นแต่ไม่มีเวรวันนี้) */
  const off = (tid: string, date: string) => {
    const mine = roster.flatMap((r) => r.shifts).filter((s) => s.staff_id === tid && s.date.slice(0, 7) === date.slice(0, 7));
    return mine.length > 0 && !mine.some((s) => s.date.slice(0, 10) === date);
  };
  const freeMin = (tid: string, date: string) => {
    const h = hrs(tid, date); if (!h) return 0;
    // ช่วงที่ไม่ว่าง (นัด + ตั้งไม่ว่าง) ในเวลางาน รวมช่วงซ้อนกันก่อนนับ
    const b = booked(tid, date).map((x) => [Math.max(h.s, x.s), Math.min(h.e, x.e)] as const).filter(([a, e]) => e > a);
    let used = 0, cur = -1;
    for (const [a, e] of b) { const from = Math.max(a, cur); if (e > from) used += e - from; cur = Math.max(cur, e); }
    return h.e - h.s - used;
  };
  /** ช่วงว่างแรกของวัน (ทีละ 30 นาที) สำหรับเติมเวลาตอนกดช่อง */
  const firstFree = (tid: string, date: string) => {
    const b = booked(tid, date), h = hrs(tid, date) ?? DEFAULT_HOURS;
    for (let t = h.s; t + minutes <= h.e; t += 30) if (!b.some((x) => x.s < t + minutes && t < x.e)) return hm(t);
    return "09:00";
  };
  const isFree = (tid: string, date: string) => {
    const a = toMin(time); if (Number.isNaN(a)) return false;
    const h = hrs(tid, date);
    return !!h && a >= h.s && a + minutes <= h.e && !off(tid, date) && !allDay(tid, date) && !booked(tid, date, c?.id).some((x) => x.s < a + minutes && a < x.e);
  };
  const hasOwn = (date: string) => !!c && onDate(schedOf(c), date);
  const open = cases.filter((x) => leftOf(x) > 0).sort((a, b) => a.resident_name.localeCompare(b.resident_name, "th"));
  const label = view === "month" ? monthLabel(ym) : `${dayLabel(days[0])} – ${dayLabel(days[days.length - 1])}`;
  /** ผ่านไปแล้ว (สัปดาห์นี้) */
  const past = (dt: string) => dt < today;


  return (
    <div className="pv">
      {pop && <>
        <button type="button" className="pv-popbg" aria-label="ปิดเมนู" onClick={() => setPop(null)} />
        <div className="pv-pop" role="menu" style={{ left: Math.min(pop.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 230), top: pop.y }}>
          <p>{pop.tname} · {dayLabel(pop.date)}</p>
          <button type="button" role="menuitem" onClick={() => { setPop(null); onBook(pop.date, firstFree(pop.tid, pop.date), undefined, pop.tid); }}>+ วางนัด <small>เริ่มเวลาว่างแรก {firstFree(pop.tid, pop.date)}</small></button>
          {onBlock && <button type="button" role="menuitem" onClick={() => { setPop(null); onBlock(pop.tid, pop.tname, pop.date); }}>ตั้งไม่ว่าง <small>ลา · ป่วย · ประชุม · บางช่วงเวลา</small></button>}
        </div>
      </>}
      <div className="pv-bar">
        <span className="pbk-seg pv-view" role="group" aria-label="มุมมอง">
          <button type="button" aria-pressed={view === "week"} onClick={() => setView("week")}>สัปดาห์</button>
          <button type="button" aria-pressed={view === "month"} onClick={() => setView("month")}>เดือน</button>
        </span>
        {view === "week" ? <span className="pc-nav">
          <button type="button" aria-label="สัปดาห์ก่อน" disabled={start <= monOf(today)} onClick={() => setStart(addDays(start, -7))}>‹</button>
          <button type="button" onClick={() => setStart(monOf(today))}>สัปดาห์นี้</button>
          <button type="button" aria-label="สัปดาห์ถัดไป" onClick={() => setStart(addDays(start, 7))}>›</button>
        </span> : <span className="pc-nav">
          <button type="button" aria-label="เดือนก่อน" disabled={ym <= today.slice(0, 7)} onClick={() => shiftYm(-1)}>‹</button>
          <button type="button" onClick={() => setYm(today.slice(0, 7))}>เดือนนี้</button>
          <button type="button" aria-label="เดือนถัดไป" onClick={() => shiftYm(1)}>›</button>
        </span>}
        <b className="pv-range">{label}</b>
        <select value={cid} onChange={(e) => setCid(e.target.value)} aria-label="เลือกเคส"><option value="">เลือกเคส: ดูว่าใครว่าง</option>{open.map((x) => <option key={x.id} value={x.id}>{x.resident_name} · {x.name} · เหลือ {leftOf(x)}</option>)}</select>
        {c && <select value={time} onChange={(e) => setTime(e.target.value)} aria-label="เวลาที่ต้องการ">{(TIMES.includes(time) ? TIMES : [...TIMES, time].sort()).map((t) => <option key={t} value={t}>{t}</option>)}</select>}
        {c && <button type="button" className="btn-soft" onClick={() => setCid("")}>ดูทั้งหมด</button>}
      </div>
      <p className="pv-hint">{c ? `เคส ${c.resident_name} · ${time}–${hm(toMin(time) + minutes)} น. (${minutes} นาที) · แต่ละวันแสดงเฉพาะนักกายภาพที่ว่าง${canAssign ? " · กดชื่อเพื่อวางนัด" : ""}` : <span className="pv-legend"><span><i className="is-appt" />มีนัด</span><span><i className="is-blk" />ลา / ไม่ว่าง</span><span><i className="is-free" />ว่าง = ยังลงนัดได้อีกกี่ชั่วโมง</span>{canAssign && <em>กดช่องเพื่อลงนัดหรือตั้งลา</em>}</span>}</p>

      {!therapists.length ? <p className="pv-empty">ยังไม่มีบัญชีนักกายภาพในสาขา</p> : c ? (
        <div className="pv-wrap"><div className="pv-cols" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(128px, 1fr))` }}>
          {days.map((dt) => {
            const free = therapists.filter((t) => isFree(t.id, dt));
            return (
              <div key={dt} className={`pv-col ${dt === today ? "is-today" : ""}`}>
                <p className="pv-dh"><i>{DAY_TH[dowOf(dt)]}</i><b>{Number(dt.slice(8, 10))}</b></p>
                {past(dt) ? <span className="pv-none">ผ่านไปแล้ว</span> : <>
                {hasOwn(dt) && <span className="pv-own">มีนัดเคสนี้แล้ว {timeOn(c, dt)}</span>}
                {free.length ? free.map((t) => (
                  <button key={t.id} type="button" className="pv-free" disabled={!canAssign || hasOwn(dt)} onClick={() => onBook(dt, time, c.id, t.id)} title={`วางนัด ${c.resident_name} ${dayLabel(dt)} ${time} ให้ ${t.name}`}>{t.name}</button>
                )) : <span className="pv-none">ไม่มีคนว่าง</span>}
                {therapists.length - free.length > 0 && <small className="pv-busyn">ไม่ว่าง {therapists.length - free.length} คน</small>}
                </>}
              </div>
            );
          })}
        </div></div>
      ) : (
        <div className="pv-wrap"><table className={`pv-grid ${view === "month" ? "is-month" : ""}`} style={{ minWidth: view === "month" ? 170 + days.length * 76 : 900 }}>
          <thead><tr><th scope="col">นักกายภาพ</th>{days.map((dt) => <th key={dt} scope="col" className={`${dt === today ? "is-today" : ""} ${dowOf(dt) === 0 || dowOf(dt) === 6 ? "is-we" : ""}`}><i>{DAY_TH[dowOf(dt)]}</i>{view === "week" ? dayLabel(dt).replace(/^\S+\s/, "") : Number(dt.slice(8, 10))}</th>)}</tr></thead>
          <tbody>{therapists.map((t) => (
            <tr key={t.id}>
              <th scope="row"><div className="pv-who">
                <b>{t.name}</b>
                <span className="pv-hrs"><svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" /><path d="M8 4.5V8l2.5 1.5" /></svg>{hoursLabel(t.id)}</span>
                {onHours && canAssign && <button type="button" className="pv-set" onClick={() => onHours(t.id, t.name)}>ตั้งเวลางาน</button>}
              </div></th>
              {days.map((dt) => {
                if (past(dt)) return <td key={dt} className="is-past" aria-label="ผ่านไปแล้ว" />;
                if (off(t.id, dt)) return <td key={dt} className="is-off"><span>หยุด (ตารางเวร)</span></td>;
                const wh = hrs(t.id, dt);
                if (!wh) return <td key={dt} className="is-off"><span>ไม่เข้างาน</span></td>;
                const ad = allDay(t.id, dt);
                if (ad) return <td key={dt} className="is-off"><button type="button" className="pv-blk" disabled={!canAssign || !onBlock} onClick={() => onBlock?.(t.id, t.name, dt)} title="กดเพื่อดู/ยกเลิก">{ad.reason || "ไม่ว่าง"}<small>ทั้งวัน</small></button></td>;
                const b = booked(t.id, dt), fm = freeMin(t.id, dt), tone = fm >= 240 ? "ok" : fm >= 60 ? "mid" : "full", appts = b.filter((x) => x.k), blks = b.filter((x) => x.b);
                return (
                  <td key={dt} className={dt === today ? "is-today" : ""}>
                    <button type="button" className={`pv-cell is-${tone}`} disabled={!canAssign} onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setPop({ tid: t.id, tname: t.name, date: dt, x: r.left, y: r.bottom + 4 }); }}
                      title={`${t.name} · ${dayLabel(dt)} · เวลางาน ${hm(wh.s)}–${hm(wh.e)}${appts.length ? ` · นัด: ${appts.map((x) => `${hm(x.s)}–${hm(x.e)} ${x.k!.resident_name}`).join(", ")}` : " · ยังไม่มีนัด"}${blks.length ? ` · ไม่ว่าง: ${blks.map((x) => blockText(x.b!)).join(", ")}` : ""}`}>
                      <span className="pv-bar2">{b.filter((x) => x.e > wh.s && x.s < wh.e).map((x, i) => <i key={i} className={x.b ? "is-blk" : ""} style={{ left: `${((Math.max(wh.s, x.s) - wh.s) / (wh.e - wh.s)) * 100}%`, width: `${((Math.min(wh.e, x.e) - Math.max(wh.s, x.s)) / (wh.e - wh.s)) * 100}%` }} />)}</span>
                      <b>{fm >= wh.e - wh.s ? (view === "month" ? "ว่างหมด" : "ว่างทั้งวัน") : fm <= 0 ? "เต็ม" : `${view === "month" ? "" : "ว่าง "}${durS(fm)}`}</b>
                      <small>{appts.length ? `${appts.length} นัด` : "ไม่มีนัด"}{blks.length ? ` · ${blks.map((x) => x.b!.reason || "ไม่ว่าง").join(", ")}` : ""}</small>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
