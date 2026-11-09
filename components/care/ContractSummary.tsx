"use client";
import { useMemo, useState } from "react";
import CsvIcon from "../CsvIcon";
import { MetricGrid, Section } from "../ui";
import { money } from "@/lib/billing";
import { contractMonthTotal } from "../views/Billing";
import { downloadCsv } from "@/lib/store";

/**
 * สรุปการเปิดสัญญา รายวัน / รายเดือน / รายปี (หน้าสัญญาบริการ แท็บ "สรุปการเปิดสัญญา")
 *  นับตามวันเวลาที่เปิดสัญญาในระบบ (r[31] created_at) · สัญญาเก่าที่ไม่มีใช้วันเริ่มสัญญาแทน
 *  แต่ละช่วงบอก: เปิดใหม่กี่สัญญา · สถานะปัจจุบันของสัญญาเหล่านั้น · ค่าบริการต่อเดือนรวม · เงินประกันรวม
 *  กดแถวเพื่อดูรายชื่อสัญญาในช่วงนั้น · ส่งออก CSV ทั้งสรุปและรายชื่อ
 */
type Mode = "day" | "month" | "year";
const TH_MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const ACTIVE = "ใช้งานอยู่", WAIT = "รอชำระเงินมัดจำ", ENDED = "สิ้นสุดสัญญา", CANCELLED = "ยกเลิกสัญญา";
const num = (v?: string) => Number(String(v ?? "").replace(/,/g, "")) || 0;
/** "03/11/2569 10:22" · "03/11/2569" · "2026-11-03" → "2026-11-03" */
const isoOf = (v?: string) => {
  const s = String(v ?? "").trim();
  const a = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (a) return `${a[1]}-${a[2]}-${a[3]}`;
  const b = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (!b) return "";
  const y = +b[3] > 2400 ? +b[3] - 543 : +b[3];
  return `${y}-${b[2].padStart(2, "0")}-${b[1].padStart(2, "0")}`;
};
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const dayLabel = (d: string) => `${Number(d.slice(8, 10))} ${TH_MON[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(0, 4)) + 543}`;
const monLabel = (m: string) => `${TH_MON[Number(m.slice(5, 7)) - 1]} ${Number(m.slice(0, 4)) + 543}`;

export default function ContractSummary({ rows, onOpen }: { rows: string[][]; onOpen: (i: number) => void }) {
  const t = today();
  const [mode, setMode] = useState<Mode>("month");
  const [month, setMonth] = useState(t.slice(0, 7));
  const [year, setYear] = useState(t.slice(0, 4));
  const [branch, setBranch] = useState("");
  const [pick, setPick] = useState<string | null>(null);
  const all = useMemo(() => rows.map((r, i) => ({ r, i, d: isoOf(r[31]) || isoOf(r[7]) })).filter((x) => x.d), [rows]);
  const branches = [...new Set(rows.map((r) => r[1]).filter(Boolean))].sort();
  const list = all.filter((x) => !branch || x.r[1] === branch);
  const years = [...new Set([...all.map((x) => x.d.slice(0, 4)), t.slice(0, 4)])].sort().reverse();

  // ช่วงที่แสดง: รายวัน = ทุกวันของเดือนที่เลือก · รายเดือน = 12 เดือนของปีที่เลือก · รายปี = ทุกปีที่มีข้อมูล
  const keys = mode === "day"
    ? Array.from({ length: new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).getUTCDate() }, (_, k) => `${month}-${String(k + 1).padStart(2, "0")}`).filter((d) => d <= t)
    : mode === "month" ? Array.from({ length: 12 }, (_, k) => `${year}-${String(k + 1).padStart(2, "0")}`).filter((m) => m <= t.slice(0, 7))
    : years.slice().sort();
  const keyOf = (d: string) => (mode === "day" ? d : mode === "month" ? d.slice(0, 7) : d.slice(0, 4));
  const label = (k: string) => (mode === "day" ? dayLabel(k) : mode === "month" ? monLabel(k) : `ปี ${Number(k) + 543}`);
  const stat = (xs: typeof list) => ({
    n: xs.length,
    active: xs.filter((x) => x.r[5] === ACTIVE).length, wait: xs.filter((x) => x.r[5] === WAIT).length,
    ended: xs.filter((x) => x.r[5] === ENDED).length, cancelled: xs.filter((x) => x.r[5] === CANCELLED).length,
    fee: xs.filter((x) => x.r[5] !== CANCELLED).reduce((n, x) => n + contractMonthTotal(x.r), 0),
    deposit: xs.filter((x) => x.r[5] !== CANCELLED).reduce((n, x) => n + num(x.r[19]), 0),
  });
  const table = keys.map((k) => ({ k, xs: list.filter((x) => keyOf(x.d) === k) })).map((p) => ({ ...p, s: stat(p.xs) }));
  // รายวันแสดงเฉพาะวันที่มีการเปิดสัญญา (เดือนหนึ่งมี 30 แถวจะยาวเกิน) · รายเดือน/รายปีแสดงครบทุกช่วง
  const shown = mode === "day" ? table.filter((p) => p.s.n) : table;
  const tot = stat(table.flatMap((p) => p.xs));
  const picked = pick ? table.find((p) => p.k === pick) : null;
  const tiles = [
    { label: "เปิดวันนี้", value: list.filter((x) => x.d === t).length, unit: "สัญญา", icon: "doc", accent: true, note: dayLabel(t) },
    { label: "เปิดเดือนนี้", value: list.filter((x) => x.d.slice(0, 7) === t.slice(0, 7)).length, unit: "สัญญา", icon: "calendar", note: monLabel(t.slice(0, 7)) },
    { label: "เปิดปีนี้", value: list.filter((x) => x.d.slice(0, 4) === t.slice(0, 4)).length, unit: "สัญญา", icon: "chart", note: `ปี ${Number(t.slice(0, 4)) + 543}` },
    { label: "ใช้งานอยู่ตอนนี้", value: list.filter((x) => x.r[5] === ACTIVE).length, unit: "สัญญา", icon: "check", note: `ค่าบริการรวม ${money(list.filter((x) => x.r[5] === ACTIVE).reduce((n, x) => n + contractMonthTotal(x.r), 0))} บาท/เดือน` },
  ];
  const period = mode === "day" ? monLabel(month) : mode === "month" ? `ปี ${Number(year) + 543}` : "ทุกปี";
  const tag = `${mode === "day" ? month : mode === "month" ? year : "ทุกปี"}${branch ? `-${branch}` : ""}`;
  const COLS = ["เปิดใหม่", "ใช้งานอยู่", "รอชำระมัดจำ", "สิ้นสุดแล้ว", "ยกเลิก", "ค่าบริการ/เดือน รวม", "เงินประกันรวม"];
  const cells = (s: ReturnType<typeof stat>) => [String(s.n), String(s.active), String(s.wait), String(s.ended), String(s.cancelled), money(s.fee), money(s.deposit)];
  const exportSummary = () => downloadCsv(`สรุปการเปิดสัญญา-${mode === "day" ? "รายวัน" : mode === "month" ? "รายเดือน" : "รายปี"}-${tag}`, ["ช่วง", ...COLS], [...table.map((p) => [label(p.k), ...cells(p.s)]), ["รวม", ...cells(tot)]]);
  const exportList = () => downloadCsv(`รายชื่อสัญญาที่เปิด-${tag}`, ["วันที่เปิดสัญญา", "เลขที่สัญญา", "สาขา", "ผู้รับบริการ", "ผู้ว่าจ้าง", "ห้อง", "วันเริ่มสัญญา", "ค่าบริการ/เดือน (รวม VAT)", "เงินประกัน", "สถานะ"],
    table.flatMap((p) => p.xs).sort((a, b) => a.d.localeCompare(b.d)).map((x) => [dayLabel(x.d), x.r[0], x.r[1], x.r[2], x.r[3], x.r[6] || "-", x.r[7], money(contractMonthTotal(x.r)), money(num(x.r[19])), x.r[5]]));

  return (
    <div className="space-y-5">
      <MetricGrid items={tiles} />
      <Section title={`สรุปการเปิดสัญญา · ${period}`} sub="นับตามวันที่เปิดสัญญาในระบบ · สถานะเป็นสถานะปัจจุบันของสัญญาที่เปิดในช่วงนั้น · ยอดเงินไม่นับสัญญาที่ยกเลิก · กดแถวเพื่อดูรายชื่อ"
        actions={<><button type="button" className="btn-soft" onClick={exportSummary}><CsvIcon /> ส่งออกสรุป</button><button type="button" className="btn-soft" disabled={!tot.n} onClick={exportList}><CsvIcon /> ส่งออกรายชื่อ</button></>}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="segmented-tabs" role="group" aria-label="สรุปตาม">
            {([["day", "รายวัน"], ["month", "รายเดือน"], ["year", "รายปี"]] as const).map(([v, l]) => <button key={v} type="button" className={mode === v ? "is-selected" : ""} aria-pressed={mode === v} onClick={() => { setMode(v); setPick(null); }}>{l}</button>)}
          </div>
          {mode === "day" && <input type="month" className="!w-auto" value={month} max={t.slice(0, 7)} aria-label="เลือกเดือน" onChange={(e) => { if (e.target.value) { setMonth(e.target.value); setPick(null); } }} />}
          {mode === "month" && <select className="!w-auto" value={year} aria-label="เลือกปี" onChange={(e) => { setYear(e.target.value); setPick(null); }}>{years.map((y) => <option key={y} value={y}>ปี {Number(y) + 543}</option>)}</select>}
          {branches.length > 1 && <select className="!w-auto" value={branch} aria-label="เลือกสาขา" onChange={(e) => { setBranch(e.target.value); setPick(null); }}><option value="">ทุกสาขา</option>{branches.map((b) => <option key={b}>{b}</option>)}</select>}
        </div>
        {shown.length ? <div className="overflow-x-auto"><table className="sales-top cs-table">
          <thead><tr><th>{mode === "day" ? "วันที่" : mode === "month" ? "เดือน" : "ปี"}</th>{COLS.map((c) => <th key={c} className="n">{c}</th>)}</tr></thead>
          <tbody>{shown.map((p) => <tr key={p.k} className={`${p.s.n ? "is-click" : "is-zero"} ${pick === p.k ? "is-on" : ""}`} onClick={() => p.s.n && setPick(pick === p.k ? null : p.k)} tabIndex={p.s.n ? 0 : -1} onKeyDown={(e) => { if (e.key === "Enter" && p.s.n) setPick(pick === p.k ? null : p.k); }}>
            <td className="whitespace-nowrap font-medium">{label(p.k)}</td>{cells(p.s).map((v, j) => <td key={j} className="n">{v === "0" || v === "0.00" ? "-" : v}</td>)}
          </tr>)}</tbody>
          <tfoot><tr><td>รวม</td>{cells(tot).map((v, j) => <td key={j} className="n">{v}</td>)}</tr></tfoot>
        </table></div> : <p className="rounded-xl bg-cream-50 px-4 py-6 text-center text-sm text-gold-600">ยังไม่มีการเปิดสัญญาใน{period}</p>}
        {picked && <div className="mt-4">
          <p className="label">สัญญาที่เปิด{mode === "day" ? "วันที่" : mode === "month" ? "เดือน" : ""} {label(picked.k)} · {picked.s.n} สัญญา</p>
          <ul className="cs-list">{picked.xs.map((x) => <li key={x.i}><button type="button" onClick={() => onOpen(x.i)}>
            <b>{x.r[0] || "กำลังออกเลข…"}</b><span>{x.r[2]} · {x.r[1]}{x.r[6] && x.r[6] !== "-" ? ` · ห้อง ${x.r[6]}` : ""}</span><small>{dayLabel(x.d)} · {money(contractMonthTotal(x.r))} บาท/เดือน · {x.r[5]}</small>
          </button></li>)}</ul>
        </div>}
      </Section>
    </div>
  );
}
