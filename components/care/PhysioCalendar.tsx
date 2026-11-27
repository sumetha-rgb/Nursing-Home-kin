"use client";
import { useMemo, useRef, useState } from "react";
import Icon from "../Icon";
import { addDays, addMonth, DAY_TH, dowOf, monthCells, monthLabel, PhysioBoard, PhysioCase, TRACK_TEXT, trackRows, TrackRow, TrackStatus, WEEK, weekDates, blockHit, blockText } from "@/lib/physio";

/**
 * ปฏิทินกายภาพ (26 พ.ย. 2569) · แบบปฏิทินนัด: เดือน / สัปดาห์
 *  สัปดาห์ = ตารางเวลา (แถวชั่วโมง × คอลัมน์วัน) การ์ดนัดยาวตามนาทีของคอร์ส · เดือน = ช่องวัน แสดง 2 นัดแรก + "+N งานที่เหลือ" (กดไปดูสัปดาห์นั้น)
 *  การ์ด: เวลาเริ่ม–สิ้นสุด + นักกายภาพ / ผู้รับบริการ · สีตามสถานะ (ทำแล้ว เขียว · ไม่ได้ทำ แดง · ไม่บันทึก ส้ม · นัดไว้/รอทำ น้ำเงิน)
 *  ตัวกรอง: นักกายภาพ · ผู้รับบริการ · สถานะ · ล้างตัวกรอง · พิมพ์ · ‹ วันนี้ ›
 *  กดนัด = เปลี่ยนคนทำ ย้ายวัน/เวลา ยกเลิก หรือแก้แผน (ผู้จัดการสาขา แคชเชียร์ · สิทธิ์ จ่ายเคสกายภาพ)
 *  กดช่องว่าง (วัน + เวลา) = วางนัดใหม่ · กดค้างที่นัดแล้วลาก = ย้ายนัด (เมาส์: กดแล้วลาก · มือถือ: กดค้างครู่หนึ่งแล้วลาก · ยืนยันก่อนบันทึก)
 *  ย้ายได้: นัดที่ยังไม่ทำ และนัดที่ไม่ได้ทำ (ย้ายไปวันนี้หรือข้างหน้าเป็นนัดชดเชย) · นัดที่บันทึกแล้วมีลายขีดขาว
 */
const HOUR = 66; // px ต่อชั่วโมง (ตารางสัปดาห์)
const toMin = (t: string) => { const m = /^(\d{1,2}):(\d{2})/.exec(t ?? ""); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
const hm = (n: number) => `${String(Math.floor(n / 60) % 24).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const tone = (s: TrackStatus) => (s === "done" || s === "live" ? "ok" : s === "missed" ? "bad" : s === "noRecord" ? "warn" : "plan");

export default function PhysioCalendar({ d, cases, therapists, today, canAssign, onOpen, onAdd, onMove }: {
  d: PhysioBoard; cases: PhysioCase[];
  /** นักกายภาพที่เลือกกรองได้ */ therapists: { id: string; name: string }[];
  today: string; canAssign: boolean;
  /** กดนัด (ทำแล้ว = ดูบันทึก · ยังไม่ทำ = เปลี่ยนคน/เวลาเฉพาะวัน หรือแผนทั้งคอร์ส) */ onOpen: (x: TrackRow) => void;
  /** กดช่องว่าง = วางนัด (วันที่ เวลา) */ onAdd?: (date: string, time: string) => void;
  /** ลากนัดไปช่องใหม่ = ย้ายนัด */ onMove?: (x: TrackRow, date: string, time: string) => void;
}) {
  const [over, setOver] = useState("");
  /** ลากนัด (pointer: ใช้ได้ทั้งเมาส์และนิ้ว) · ghost = การ์ดที่ตามนิ้ว พร้อมวันเวลาที่จะวาง */
  const [ghost, setGhost] = useState<{ x: number; y: number; label: string; to: string; ok: boolean } | null>(null);
  /** ระหว่างลาก: การ์ดนัดย้ายไปแสดงที่ช่องปลายทาง (วัน + เวลาใหม่) · ตัวเดิมจางลง */
  const [drop, setDrop] = useState<{ x: TrackRow; date: string; time: string } | null>(null);
  const skipClick = useRef(false);
  /** ย้ายได้: นัดที่ยังไม่ทำ (วันนี้/ข้างหน้า) และนัดที่ไม่ได้ทำ (ย้ายไปเป็นนัดชดเชย) */
  const movable = (x: TrackRow) => canAssign && !!onMove && !!x.caseId && (x.status === "planned" || x.status === "todo" || x.status === "missed");
  const canAdd = (dt: string) => canAssign && !!onAdd && dt >= today;
  const [mode, setMode] = useState<"week" | "month">("week");
  const [at, setAt] = useState(today);
  const [who, setWho] = useState("");
  const [res, setRes] = useState("");
  const [st, setSt] = useState<TrackStatus | "">("");

  const wk = weekDates(at);
  const ym = at.slice(0, 7);
  const cells = monthCells(ym);
  const from = mode === "week" ? wk[0] : `${ym}-01`, to = mode === "week" ? wk[6] : (cells.filter(Boolean).pop() as string);
  const all = useMemo(() => trackRows(d, from, to), [d, from, to]);
  const minutesOf = (x: TrackRow) => cases.find((c) => c.id === x.caseId)?.plan_minutes ?? 45;
  const resNames = useMemo(() => [...new Set(all.map((x) => x.resident))].sort((a, b) => a.localeCompare(b, "th")), [all]);
  const list = all.filter((x) => (!who || x.therapistId === who) && (!res || x.resident === res) && (!st || x.status === st))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const onDay = (dt: string) => list.filter((x) => x.date === dt);
  const filtered = !!(who || res || st);
  const step = (n: number) => setAt(mode === "week" ? addDays(at, n * 7) : `${addMonth(ym, n)}-01`);
  const label = mode === "week" ? (wk[0].slice(0, 7) === wk[6].slice(0, 7) ? `${Number(wk[0].slice(8, 10))} – ${Number(wk[6].slice(8, 10))} ${monthLabel(wk[0].slice(0, 7))}` : `${Number(wk[0].slice(8, 10))} ${monthLabel(wk[0].slice(0, 7))} – ${Number(wk[6].slice(8, 10))} ${monthLabel(wk[6].slice(0, 7))}`) : monthLabel(ym);
  const print = () => { document.body.classList.add("print-pcal"); window.print(); setTimeout(() => document.body.classList.remove("print-pcal"), 500); };

  // ตารางสัปดาห์: ช่วงชั่วโมง (อย่างน้อย 08:00–20:00 · ขยายตามนัดจริง)
  const times = list.filter((x) => mode === "week" && !Number.isNaN(toMin(x.time)));
  const h0 = Math.min(8, ...times.map((x) => Math.floor(toMin(x.time) / 60)));
  const h1 = Math.max(20, ...times.map((x) => Math.ceil((toMin(x.time) + minutesOf(x)) / 60)));
  const hours = Array.from({ length: h1 - h0 }, (_, i) => h0 + i);
  /** เวลาของจุดที่กด/วางในคอลัมน์วัน (ปัดทีละ 15 นาที) */
  const timeAt = (e: { currentTarget: HTMLElement; clientY: number }) => {
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const m = Math.max(h0 * 60, Math.min(h1 * 60 - 15, h0 * 60 + Math.round(((y / HOUR) * 60) / 15) * 15));
    return hm(m);
  };
  /** ช่องที่นิ้ว/เมาส์อยู่: วันที่ + เวลา (สัปดาห์ = ตามตำแหน่ง · เดือน = เวลาเดิมของนัด) · วันที่ผ่านไปแล้ววางไม่ได้ */
  const targetAt = (cx: number, cy: number, x: TrackRow) => {
    const el = (document.elementFromPoint(cx, cy) as HTMLElement | null)?.closest("[data-date]") as HTMLElement | null;
    const date = el?.dataset.date;
    if (!el || !date || date < today) return null;
    return { date, time: el.classList.contains("pc-col") ? timeAt({ currentTarget: el, clientY: cy }) : x.time };
  };
  /** กดค้างที่นัดแล้วลาก: เมาส์ = เริ่มเมื่อขยับเกิน 6px · นิ้ว = กดค้าง 280ms แล้วลาก (ไม่ให้หน้าเลื่อนระหว่างลาก) · ปล่อย = เปิดหน้าต่างยืนยันย้าย */
  const press = (e: React.PointerEvent, x: TrackRow) => {
    if (!movable(x) || e.button !== 0) return;
    const mouse = e.pointerType === "mouse", sx = e.clientX, sy = e.clientY;
    let on = false, to: { date: string; time: string } | null = null;
    const s0 = toMin(x.time), label = `${x.time}${Number.isNaN(s0) ? "" : `–${hm(s0 + minutesOf(x))}`} · ${x.resident}`;
    const show = (cx: number, cy: number) => {
      to = targetAt(cx, cy, x);
      setOver(to?.date ?? "");
      setDrop(to ? { x, ...to } : { x, date: "", time: "" });
      // วางได้ = การ์ดย้ายไปช่องปลายทางให้เห็น · วางไม่ได้ = ป้ายแดงตามนิ้ว
      setGhost(to ? null : { x: cx, y: cy, label, ok: false, to: "วางวันที่ผ่านไปแล้วไม่ได้" });
    };
    const begin = (cx: number, cy: number) => { on = true; document.body.classList.add("pc-dragging"); navigator.vibrate?.(15); show(cx, cy); };
    const timer = mouse ? 0 : window.setTimeout(() => begin(sx, sy), 280);
    const move = (ev: PointerEvent) => {
      if (!on) {
        const far = Math.hypot(ev.clientX - sx, ev.clientY - sy);
        if (mouse && far > 6) begin(ev.clientX, ev.clientY);
        else if (!mouse && far > 10) done();
        return;
      }
      show(ev.clientX, ev.clientY);
    };
    const block = (ev: TouchEvent) => { if (on) ev.preventDefault(); };
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", done);
      document.removeEventListener("touchmove", block);
      document.body.classList.remove("pc-dragging"); setGhost(null); setOver(""); setDrop(null);
    };
    const up = () => {
      const was = on, t = to; done();
      if (!was) return;
      skipClick.current = true; setTimeout(() => { skipClick.current = false; }, 60);
      if (t && !(t.date === x.date && t.time === x.time)) onMove!(x, t.date, t.time);
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", done);
    document.addEventListener("touchmove", block, { passive: false });
  };
  /** วางนัดที่เวลาทับกันเป็นช่องซ้าย–ขวา */
  const lay = (items: TrackRow[]) => {
    const ev = items.filter((x) => !Number.isNaN(toMin(x.time))).map((x) => ({ x, s: toMin(x.time), e: toMin(x.time) + minutesOf(x), lane: 0, of: 1 }));
    const ends: number[] = [];
    for (const v of ev) { let l = ends.findIndex((e) => e <= v.s); if (l < 0) { l = ends.length; ends.push(0); } ends[l] = v.e; v.lane = l; }
    for (const v of ev) v.of = Math.max(1, ...ev.filter((o) => o.s < v.e && o.e > v.s).map((o) => o.lane + 1));
    return ev;
  };
  const nowMin = (() => { const d = new Date(Date.now() + 7 * 36e5); return d.getUTCHours() * 60 + d.getUTCMinutes(); })();
  const Card = ({ x }: { x: TrackRow }) => {
    const s = toMin(x.time), e = Number.isNaN(s) ? NaN : s + minutesOf(x);
    // นัดวันนี้ที่เลยเวลาจบแล้วยังไม่บันทึก = แดง (เหมือนไม่ได้ทำ)
    const late = x.status === "todo" && x.date === today && !Number.isNaN(e) && e < nowMin;
    // นัดที่ยังไม่ทำแต่คนทำลา/ไม่ว่างช่วงนั้น = แดง "ชนวันลา" (ต้องย้ายหรือหาคนแทน)
    const lv = (x.status === "planned" || x.status === "todo") && x.therapistId ? blockHit(d.blocks, x.therapistId, x.date, Number.isNaN(s) ? undefined : s, Number.isNaN(e) ? undefined : e) : [];
    return (
      <button type="button" className={`pc-ev is-${late || lv.length ? "bad" : tone(x.status)} ${lv.length ? "is-leave" : ""} ${x.status === "done" ? "is-done" : ""} ${movable(x) ? "is-move" : ""} ${drop && drop.x === x ? "is-src" : ""}`} disabled={!canAssign && !["done", "noRecord"].includes(x.status)} onClick={(e) => { e.stopPropagation(); if (skipClick.current) return; onOpen(x); }}
        onPointerDown={(e) => press(e, x)} onContextMenu={(e) => { if (movable(x)) e.preventDefault(); }}
        title={`${x.time ? `${x.time}${Number.isNaN(e) ? "" : `–${hm(e)}`} · ` : ""}${x.therapist} · ${x.resident} · ${TRACK_TEXT[x.status]}${x.cover ? " · มีคนทำแทน" : ""}${x.req ? ` · ขอคนแทน: ${x.req}` : ""}${lv.length ? ` · ชนวันลา: ${lv.map(blockText).join(", ")} · ลากไปวันอื่นหรือกดเพื่อเปลี่ยนคน` : ""}`}>
        <b>{x.time ? `${x.time}${Number.isNaN(e) ? "" : `–${hm(e)}`} ` : ""}{x.therapist}{x.req ? " · ขอแทน" : x.cover ? " · แทน" : ""}</b>
        <small>{x.resident}{x.status === "done" ? " ✓" : x.status === "missed" ? " ✗" : x.status === "noRecord" ? " !" : lv.length ? ` · ⚠ ชนวันลา (${lv[0].reason || "ไม่ว่าง"})` : late ? " · เลยเวลา ยังไม่บันทึก" : ""}</small>
      </button>
    );
  };

  return (
    <div className="pcal">
      <div className="pc-bar">
        <span className="pc-seg" role="group" aria-label="มุมมอง">
          <button type="button" aria-pressed={mode === "month"} onClick={() => setMode("month")}>เดือน</button>
          <button type="button" aria-pressed={mode === "week"} onClick={() => setMode("week")}>สัปดาห์</button>
        </span>
        <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="นักกายภาพ"><option value="">นักกายภาพทุกคน</option>{therapists.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        <select value={res} onChange={(e) => setRes(e.target.value)} aria-label="ผู้รับบริการ"><option value="">ผู้รับบริการทุกคน</option>{resNames.map((n) => <option key={n} value={n}>{n}</option>)}</select>
        <select value={st} onChange={(e) => setSt(e.target.value as TrackStatus | "")} aria-label="สถานะ"><option value="">ทุกสถานะ</option>{(Object.keys(TRACK_TEXT) as TrackStatus[]).map((k) => <option key={k} value={k}>{TRACK_TEXT[k]}</option>)}</select>
        <button type="button" className="btn-soft" disabled={!filtered} onClick={() => { setWho(""); setRes(""); setSt(""); }}>ล้างตัวกรอง</button>
        <button type="button" className="btn-soft" onClick={print}><Icon name="print" className="h-4 w-4" /> พิมพ์</button>
        <span className="pc-nav">
          <button type="button" aria-label={mode === "week" ? "สัปดาห์ก่อน" : "เดือนก่อน"} onClick={() => step(-1)}>‹</button>
          <button type="button" onClick={() => setAt(today)}>วันนี้</button>
          <button type="button" aria-label={mode === "week" ? "สัปดาห์หน้า" : "เดือนถัดไป"} onClick={() => step(1)}>›</button>
        </span>
      </div>
      <p className="pc-label">{label} · {list.length} นัด{filtered ? " (กรองอยู่)" : ""}</p>

      {mode === "week" ? (
        <div className="pc-wwrap">
          <div className="pc-week" style={{ gridTemplateColumns: `52px repeat(7, minmax(0, 1fr))` }}>
            <span className="pc-corner" />
            {wk.map((dt) => <span key={dt} className={`pc-dh ${dt === today ? "is-today" : ""}`}><i>{DAY_TH[dowOf(dt)]}</i><b>{Number(dt.slice(8, 10))}</b><small>{onDay(dt).length ? `${onDay(dt).length} นัด` : ""}</small></span>)}
            <div className="pc-hours" style={{ height: hours.length * HOUR }}>{hours.map((h) => <span key={h} style={{ top: (h - h0) * HOUR }}>{String(h).padStart(2, "0")}:00</span>)}</div>
            {wk.map((dt) => {
              const day = onDay(dt);
              const noTime = day.filter((x) => Number.isNaN(toMin(x.time)));
              return (
                <div key={dt} className={`pc-col ${dt === today ? "is-today" : ""} ${dt < today ? "is-past" : ""} ${canAdd(dt) ? "can-add" : ""} ${over === dt ? "is-over" : ""}`} style={{ height: hours.length * HOUR }}
                  title={canAdd(dt) ? "กดช่องว่างเพื่อวางนัด" : undefined}
                  onClick={(e) => { if (skipClick.current || !canAdd(dt) || (e.target as HTMLElement).closest(".pc-ev")) return; onAdd!(dt, timeAt(e)); }}
                  data-date={dt}>
                  {hours.map((h) => <i key={h} className="pc-line" style={{ top: (h - h0) * HOUR }} />)}
                  {lay(day).map(({ x, s, e, lane, of }, k) => (
                    <div key={`${x.caseId}${k}`} className="pc-slot" style={{ top: ((s - h0 * 60) / 60) * HOUR + 1, height: Math.max(((e - s) / 60) * HOUR - 3, 30), left: `calc(${(lane / of) * 100}% + 2px)`, width: `calc(${100 / of}% - 4px)` }}>
                      <Card x={x} />
                    </div>
                  ))}
                  {drop?.date === dt && (() => {
                    const s1 = toMin(drop.time), m1 = minutesOf(drop.x);
                    return Number.isNaN(s1) ? null : (
                      <div className="pc-slot is-preview" style={{ top: ((s1 - h0 * 60) / 60) * HOUR + 1, height: Math.max((m1 / 60) * HOUR - 3, 30), left: 2, width: "calc(100% - 4px)" }}>
                        <div className={`pc-ev is-${tone(drop.x.status === "missed" ? "planned" : drop.x.status)}`}><b>{drop.time}–{hm(s1 + m1)} {drop.x.therapist}</b><small>{drop.x.resident} · ย้ายมาที่นี่</small></div>
                      </div>
                    );
                  })()}
                  {noTime.length > 0 && <div className="pc-notime">{noTime.map((x, k) => <Card key={k} x={x}/>)}</div>}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="pc-month">
          {WEEK.map((w) => <span key={w} className="pc-mdow">{DAY_TH[w]}</span>)}
          {cells.map((dt, k) => {
            if (!dt) return <span key={k} className="pc-mday is-blank" />;
            const day = onDay(dt);
            return (
              <div key={dt} className={`pc-mday ${dt === today ? "is-today" : ""} ${dt < today ? "is-past" : ""} ${canAdd(dt) ? "can-add" : ""} ${over === dt ? "is-over" : ""}`}
                onClick={(e) => { if (skipClick.current || !canAdd(dt) || (e.target as HTMLElement).closest(".pc-ev, .pc-more")) return; onAdd!(dt, "09:00"); }}
                data-date={dt}>
                <span className="pc-mnum"><b>{Number(dt.slice(8, 10))}</b>{day.length > 0 && <small>{day.length} นัด</small>}</span>
                {drop?.date === dt && <div className="pc-ev is-plan is-preview-m"><b>{drop.time} {drop.x.therapist}</b><small>{drop.x.resident} · ย้ายมาที่นี่</small></div>}
                {day.slice(0, 2).map((x, j) => <Card key={j} x={x}/>)}
                {day.length > 2 && <button type="button" className="pc-more" onClick={() => { setAt(dt); setMode("week"); }}>+{day.length - 2} งานที่เหลือ</button>}
              </div>
            );
          })}
        </div>
      )}
      {ghost && <div className={`pc-ghost ${ghost.ok ? "" : "is-no"}`} style={{ left: ghost.x + 14, top: ghost.y + 14 }} aria-hidden="true"><b>{ghost.to}</b><small>{ghost.label}</small></div>}
      <div className="pc-legend" aria-label="คำอธิบายสี">
        <span className="is-done">ทำแล้ว · บันทึกแล้ว (ลายขีด)</span><span className="is-bad">ไม่ได้ทำ / เลยเวลายังไม่บันทึก</span><span className="is-warn">เช็คอินไม่บันทึก</span><span className="is-plan">นัดไว้ / รอทำ</span>
        
        <small>{canAssign ? "กดช่องว่างเพื่อวางนัด · กดค้างที่นัดแล้วลากเพื่อย้าย (มือถือ: กดค้างครู่หนึ่ง) · กดนัดเพื่อเปลี่ยนคนทำ ย้าย ยกเลิก หรือแก้แผน" : "กดนัดที่ทำแล้วเพื่อดูบันทึก"} · “แทน” = มีคนทำแทน · “ขอแทน” = นักกายภาพขอคนแทน</small>
      </div>
    </div>
  );
}
