"use client";
import Icon from "@/components/Icon";
import { Attendance, monthCells, monthTitle, Shift, shiftMonth, shortName, SHIFTS, WEEKDAYS } from "@/lib/roster";

/**
 * ปฏิทินเวรรายเดือน ใช้ทั้งระบบจัดการและ KinApp
 * แต่ละวันแสดงชื่อคนเข้าเวรเช้า/ดึก · mine = เน้นเวรของฉัน · ติ๊กถูกเมื่อเช็คชื่อเข้างานแล้ว
 */
/** gaps (หน้าจัดเวรของผู้จัดการ): วันนี้และวันข้างหน้าที่ยังไม่มีคนเข้าเวร ขอบแดง · ขาดกะใดกะหนึ่ง ขอบส้ม */
export default function RosterCalendar({ ym, onMonth, shifts, attendance = [], mineId, onlyMine = false, today, selected, onDay, compact = false, gaps = false }: {
  ym: string; onMonth: (ym: string) => void; shifts: Shift[]; attendance?: Attendance[]; mineId?: string; onlyMine?: boolean;
  today: string; selected?: string | null; onDay?: (date: string) => void; compact?: boolean; gaps?: boolean;
}) {
  const cells = monthCells(ym);
  const list = onlyMine && mineId ? shifts.filter((s) => s.staff_id === mineId) : shifts;
  const checked = (s: Shift) => attendance.some((a) => a.staff_id === s.staff_id && a.date === s.date && a.shift === s.shift && a.kind === "in");
  return (
    <div className={`roster ${compact ? "is-compact" : ""}`}>
      <div className="roster-head">
        <button type="button" className="icon-button" aria-label="เดือนก่อน" onClick={() => onMonth(shiftMonth(ym, -1))}><Icon name="chevron" className="h-4 w-4 rotate-90" /></button>
        <b>{monthTitle(ym)}</b>
        <button type="button" className="icon-button" aria-label="เดือนถัดไป" onClick={() => onMonth(shiftMonth(ym, 1))}><Icon name="chevron" className="h-4 w-4 -rotate-90" /></button>
      </div>
      <div className="roster-grid">
        {WEEKDAYS.map((w) => <div key={w} className="roster-wd">{w}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="roster-cell is-empty" />;
          const day = list.filter((s) => s.date === d);
          const mine = mineId ? shifts.some((s) => s.date === d && s.staff_id === mineId) : false;
          const missing = gaps && d >= today ? SHIFTS.filter((sh) => !day.some((s) => s.shift === sh.key)) : [];
          const gap = missing.length === SHIFTS.length ? "is-gap" : missing.length ? "is-half" : "";
          return (
            <button type="button" key={d} onClick={() => onDay?.(d)}
              className={`roster-cell ${d === today ? "is-today" : ""} ${d === selected ? "is-selected" : ""} ${mine ? "is-mine" : ""} ${gap}`}>
              <span className="roster-num">{Number(d.slice(8))}</span>
              {gap && <span className={`roster-miss ${gap}`}>{gap === "is-gap" ? "ยังไม่จัดเวร" : `ขาดเวร${missing[0].key}`}</span>}
              {SHIFTS.map((sh) => {
                const who = day.filter((s) => s.shift === sh.key);
                if (!who.length) return null;
                return (
                  <span key={sh.key} className={`roster-shift is-${sh.key === "เช้า" ? "day" : "night"}`}>
                    {compact ? <>{sh.key === "เช้า" ? "ช" : "ด"} {who.length}</> : <><i>{sh.key}</i>{who.map((s) => <em key={s.id} className={`${s.staff_id === mineId ? "is-me" : ""} ${checked(s) ? "is-in" : ""}`}>{checked(s) ? "✓" : ""}{shortName(s.staff_name)}</em>)}</>}
                  </span>
                );
              })}
            </button>
          );
        })}
      </div>
      <div className="roster-legend"><span className="is-day">เวรเช้า 07:00–19:00</span><span className="is-night">เวรดึก 19:00–07:00</span>{mineId && <span className="is-me">เวรของฉัน</span>}<span>✓ เช็คชื่อเข้างานแล้ว</span>
        {gaps && <><span className="roster-key is-gap">ยังไม่จัดเวร</span><span className="roster-key is-half">ขาดบางกะ</span></>}</div>
    </div>
  );
}
