"use client";
/**
 * ตัวเลือกช่วงเวลาแบบปฏิทิน (ใช้ซ้ำได้ทุกหน้า)
 *  MonthPicker = ปุ่มไอคอนปฏิทิน → ตารางเลือกเดือน 12 เดือน (เปลี่ยนปีได้ · ปี พ.ศ.)
 *  RangePicker = ปุ่มปฏิทิน → ปุ่มลัด (ใช้ทันที) · ปฏิทินรายวัน คลิกวันเริ่ม → วันสิ้นสุด → "ใช้ช่วงนี้" · แท็บทั้งเดือน (months)
 *  ใช้ทุกหน้าที่เลือกช่วงวันที่: ภาพรวมและรายงาน · รายได้ตาม BU · รับเงินแยกตามบัญชี
 *  ค่าทั้งหมดเป็น YYYY-MM / YYYY-MM-DD (ค.ศ.) · แสดงผลเป็นภาษาไทย ปี พ.ศ.
 */
import { useEffect, useState } from "react";
import Icon from "./Icon";

const TH_MON = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const TH_SH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const WD = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];
const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
export const todayBkk = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
export const monthTh = (m: string) => `${TH_MON[Number(m.slice(5, 7)) - 1]} ${Number(m.slice(0, 4)) + 543}`;
const dTh = (s: string) => `${Number(s.slice(8, 10))} ${TH_SH[Number(s.slice(5, 7)) - 1]} ${String(Number(s.slice(0, 4)) + 543).slice(2)}`;
/** "5 พ.ย. 69" · "1–18 พ.ย. 69" · "20 ต.ค. 69 – 5 พ.ย. 69" */
export const spanTh = (a: string, b: string) => (a === b ? dTh(a) : a.slice(0, 7) === b.slice(0, 7) ? `${Number(a.slice(8, 10))}–${dTh(b)}` : `${dTh(a)} – ${dTh(b)}`);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;

/** กล่องลอยใต้ปุ่ม · กดนอกกล่องหรือ Esc เพื่อปิด */
function Pop({ onClose, children, label }: { onClose: () => void; children: React.ReactNode; label: string }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return <>
    <button type="button" aria-label="ปิด" className="fixed inset-0 z-40 cursor-default" onClick={onClose} />
    <div role="dialog" aria-label={label} className="pp-pop">{children}</div>
  </>;
}

/** เลือกเดือน (ตาราง 12 เดือน) · active = กำลังใช้เดือนนี้อยู่ (ไม่ได้เลือกช่วงวันที่) */
export function MonthPicker({ value, onChange, active = true, max = todayBkk().slice(0, 7) }: { value: string; onChange: (m: string) => void; active?: boolean; max?: string }) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(Number(value.slice(0, 4)));
  useEffect(() => { if (open) setYear(Number(value.slice(0, 4))); }, [open, value]);
  const maxY = Number(max.slice(0, 4));
  return (
    <span className="ppk">
      <button type="button" className={`pp-btn ${active ? "is-on" : ""}`} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="calendar" className="h-4 w-4 shrink-0" /><span>{monthTh(value)}</span><i aria-hidden="true">▾</i>
      </button>
      {open && <Pop label="เลือกเดือน" onClose={() => setOpen(false)}>
        <div className="pp-head">
          <button type="button" className="pp-nav" aria-label="ปีก่อน" onClick={() => setYear(year - 1)}>‹</button>
          <b>ปี {year + 543}</b>
          <button type="button" className="pp-nav" aria-label="ปีถัดไป" disabled={year >= maxY} onClick={() => setYear(year + 1)}>›</button>
        </div>
        <div className="pp-months">
          {TH_SH.map((t, i) => {
            const m = `${year}-${String(i + 1).padStart(2, "0")}`, sel = active && m === value, future = m > max;
            return <button key={m} type="button" disabled={future} aria-pressed={sel} className={`${sel ? "is-sel" : ""} ${m === todayBkk().slice(0, 7) ? "is-now" : ""}`}
              onClick={() => { onChange(m); setOpen(false); }}>{t}</button>;
          })}
        </div>
      </Pop>}
    </span>
  );
}

/** ปุ่มลัด · k = รหัส (ส่งกลับใน onChange ให้หน้าที่ต้องรู้ว่าเลือกปุ่มไหน เช่น เดือนนี้ = เทียบช่วงเดียวกันของเดือนก่อน) */
export type Quick = { k: string; t: string; from: string; to: string };
export function quickRanges(): Quick[] {
  const t = todayBkk(), T = new Date(Date.parse(t)), Y = T.getUTCFullYear(), M = T.getUTCMonth(), D = T.getUTCDate();
  return [
    { k: "today", t: "วันนี้", from: t, to: t },
    { k: "yday", t: "เมื่อวาน", from: iso(Y, M, D - 1), to: iso(Y, M, D - 1) },
    { k: "7d", t: "7 วันล่าสุด", from: iso(Y, M, D - 6), to: t },
    { k: "30d", t: "30 วันล่าสุด", from: iso(Y, M, D - 29), to: t },
    { k: "month", t: "เดือนนี้", from: iso(Y, M, 1), to: t },
    { k: "prev", t: "เดือนก่อน", from: iso(Y, M - 1, 1), to: iso(Y, M, 0) },
  ];
}

/**
 * เลือกช่วงวันที่ (ปฏิทินรายวัน) · ใช้แบบเดียวกันทุกหน้า
 *  active = กำลังใช้ช่วงวันที่ (ไม่ active = ปุ่มบอก "เลือกช่วงวันที่") · onClear = มีปุ่ม ✕ กลับไปค่าเดิมของหน้า
 *  ปุ่มลัดกดแล้วใช้ทันที · months = มีแท็บ "ทั้งเดือน" เลือกเดือนใดก็ได้ (onChange ได้ k = "m:YYYY-MM")
 *  current = รหัสปุ่มลัด/เดือนที่กำลังใช้ (ไม่ส่ง = เดาจากช่วงวันที่) · label = ข้อความบนปุ่ม (ไม่ส่ง = ชื่อปุ่มลัด · ช่วง · จำนวนวัน)
 */
export function RangePicker({ from, to, active = true, onChange, onClear, max = todayBkk(), quick, months = false, current, label, ariaLabel = "ช่วงวันที่" }: {
  from: string; to: string; active?: boolean; onChange: (from: string, to: string, k?: string) => void; onClear?: () => void; max?: string;
  quick?: Quick[]; months?: boolean; current?: string; label?: string; ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"day" | "month">("day");
  const [a, setA] = useState(from), [b, setB] = useState<string | null>(to);
  const [hover, setHover] = useState<string | null>(null);
  const [view, setView] = useState(from.slice(0, 7));
  const [year, setYear] = useState(Number(to.slice(0, 4)));
  const Q = quick ?? quickRanges();
  const hit = current ?? Q.find((x) => x.from === from && x.to === to)?.k;
  useEffect(() => { if (open) { setA(from); setB(to); setView((to || from).slice(0, 7)); setYear(Number(to.slice(0, 4))); setHover(null); setTab(hit?.startsWith("m:") ? "month" : "day"); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const y = Number(view.slice(0, 4)), m = Number(view.slice(5, 7)) - 1;
  const first = new Date(Date.UTC(y, m, 1)).getUTCDay(), dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(first).fill(null), ...Array.from({ length: dim }, (_, i) => iso(y, m, i + 1))];
  const end = b ?? hover ?? a;
  const lo = a <= end ? a : end, hi = a <= end ? end : a;
  const click = (d: string) => {
    if (b !== null) { setA(d); setB(null); return; }
    if (d < a) { setB(a); setA(d); } else setB(d);
  };
  const t = todayBkk();
  const ready = b !== null;
  const apply = (f: string, e: string, k?: string) => { onChange(f, e, k); setOpen(false); };
  const qName = Q.find((x) => x.k === hit)?.t;
  const text = label ?? (active ? `${qName ? `${qName} · ` : ""}${spanTh(from, to)} · ${daysBetween(from, to)} วัน` : "เลือกช่วงวันที่");
  const maxM = max.slice(0, 7), maxY = Number(max.slice(0, 4));
  return (
    <span className="ppk">
      <button type="button" className={`pp-btn ${active ? "is-on" : ""}`} aria-haspopup="dialog" aria-expanded={open} aria-label={`${ariaLabel}: ${text}`} onClick={() => setOpen(!open)}>
        <Icon name="calendar" className="h-4 w-4 shrink-0" /><span className="pp-txt">{text}</span><i aria-hidden="true">▾</i>
      </button>
      {active && onClear && <button type="button" className="pp-clear" aria-label="ยกเลิกช่วงวันที่ กลับไปดูทั้งเดือน" title="กลับไปดูทั้งเดือน" onClick={onClear}>✕</button>}
      {open && <Pop label="เลือกช่วงวันที่" onClose={() => setOpen(false)}>
        <div className="pp-quick">
          {Q.map((x) => <button key={x.k} type="button" aria-pressed={hit === x.k} onClick={() => apply(x.from, x.to, x.k)}>{x.t}</button>)}
        </div>
        {months && <div className="pp-tabs" role="tablist" aria-label="เลือกแบบ">
          <button type="button" role="tab" aria-selected={tab === "day"} onClick={() => setTab("day")}>เลือกวัน</button>
          <button type="button" role="tab" aria-selected={tab === "month"} onClick={() => setTab("month")}>ทั้งเดือน</button>
        </div>}
        {tab === "month" && months ? <>
          <div className="pp-head">
            <button type="button" className="pp-nav" aria-label="ปีก่อน" onClick={() => setYear(year - 1)}>‹</button>
            <b>ปี {year + 543}</b>
            <button type="button" className="pp-nav" aria-label="ปีถัดไป" disabled={year >= maxY} onClick={() => setYear(year + 1)}>›</button>
          </div>
          <div className="pp-months">
            {TH_SH.map((sh, i) => {
              const mk = `${year}-${String(i + 1).padStart(2, "0")}`, sel = hit === `m:${mk}`, last = iso(year, i + 1, 0);
              return <button key={mk} type="button" disabled={mk > maxM} aria-pressed={sel} className={`${sel ? "is-sel" : ""} ${mk === t.slice(0, 7) ? "is-now" : ""}`}
                onClick={() => apply(`${mk}-01`, last < max ? last : max, `m:${mk}`)}>{sh}</button>;
            })}
          </div>
        </> : <>
          <div className="pp-head">
            <button type="button" className="pp-nav" aria-label="เดือนก่อน" onClick={() => setView(iso(y, m - 1, 1).slice(0, 7))}>‹</button>
            <b>{monthTh(view)}</b>
            <button type="button" className="pp-nav" aria-label="เดือนถัดไป" disabled={view >= maxM} onClick={() => setView(iso(y, m + 1, 1).slice(0, 7))}>›</button>
          </div>
          <div className="pp-days" role="grid" aria-label={`วันในเดือน${monthTh(view)}`} onMouseLeave={() => setHover(null)}>
            {WD.map((w) => <span key={w} className="pp-wd" aria-hidden="true">{w}</span>)}
            {cells.map((d, i) => d === null ? <span key={`e${i}`} /> : (
              <button key={d} type="button" disabled={d > max} onClick={() => click(d)} onMouseEnter={() => b === null && setHover(d)}
                aria-label={`${dTh(d)}${d === lo ? " วันเริ่ม" : ""}${d === hi ? " วันสิ้นสุด" : ""}`} aria-pressed={d >= lo && d <= hi}
                className={`${d >= lo && d <= hi ? "in" : ""} ${d === lo ? "lo" : ""} ${d === hi ? "hi" : ""} ${d === t ? "now" : ""}`}>{Number(d.slice(8))}</button>
            ))}
          </div>
          <p className="pp-sum">{ready ? <><b>{spanTh(lo, hi)}</b> · {daysBetween(lo, hi)} วัน</> : <>แตะวันสิ้นสุด · เริ่ม <b>{dTh(a)}</b></>}</p>
          <div className="pp-foot">
            <button type="button" className="btn-soft !min-h-0 !py-1.5 !text-sm" onClick={() => setOpen(false)}>ยกเลิก</button>
            <button type="button" className="btn-primary !min-h-0 !py-1.5 !text-sm" disabled={!ready} onClick={() => { const k = Q.find((x) => x.from === lo && x.to === hi)?.k; apply(lo, hi, k); }}>ใช้ช่วงนี้</button>
          </div>
        </>}
      </Pop>}
    </span>
  );
}
