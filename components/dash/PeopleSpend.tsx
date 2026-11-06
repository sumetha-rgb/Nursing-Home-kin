"use client";
import { useState } from "react";
import Icon from "../Icon";
import CsvIcon from "../CsvIcon";
import { docDate, DRAFT, Invoice, money, todayIso, VOID } from "@/lib/billing";
import { personKey, spendLines, spendLinesCsv, spendPeople } from "@/lib/exportsCsv";
import { PriceItem } from "@/lib/priceList";

const TH_MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const monLabel = (k: string) => `${TH_MON[Number(k.slice(5, 7)) - 1]} ${String(Number(k.slice(0, 4)) + 543).slice(2)}`;
type Range = "today" | "week" | "month" | "year" | "all";

/**
 * ค่าใช้จ่ายรายบุคคลของทุกคน (ภาพรวมและรายงาน → แท็บยอดขายตามหมวด ส่วนล่าง)
 *  1 แถวต่อผู้รับบริการ (จับคู่ด้วย HN ถ้าไม่มีใช้ชื่อ) · ยอดแยกตามหมวดชุดเดียวกับกราฟด้านบน · ยอด = หลังส่วนลด รวม VAT (ตามที่ลูกค้าจ่าย)
 *  ไม่นับใบยกเลิกและใบรอตรวจสอบยอด · ช่วง: เดือนที่เลือก / 12 เดือน / ทั้งหมด (ตามวันที่ออกใบ)
 *  ส่งออก CSV: ทุกรายการที่ซื้อของคนที่แสดงอยู่ (รหัสสินค้า ราคา ยอดที่จ่าย) · ยอดรวมรายคนดูจากตารางบนหน้าจอ
 */
export default function PeopleSpend({ list, prices, month, branch, branchOf }: { list: Invoice[]; prices: PriceItem[]; month: string; branch: string; branchOf: (x: Invoice) => string }) {
  const [range, setRange] = useState<Range>("month");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"total" | "owe" | "name">("total");
  const [y, m] = month.split("-").map(Number);
  // วันนี้/สัปดาห์นี้ = ตามวันจริง (สัปดาห์เริ่มวันจันทร์) · เดือน/12 เดือน/ทั้งหมด = ตามเดือนที่เลือกด้านบนของหน้า
  const today = todayIso(), monday = new Date(Date.parse(`${today}T00:00:00Z`) - ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
  const from = range === "today" ? today : range === "week" ? monday : range === "month" ? `${month}-01` : range === "year" ? new Date(Date.UTC(y, m - 12, 1)).toISOString().slice(0, 10) : "";
  const inRange = (d: string) => (!from || d >= from) && (range === "today" || range === "week" ? d.slice(0, 10) <= today : d.slice(0, 7) <= month);
  const invs = list.filter((x) => x.status !== VOID && x.status !== DRAFT && inRange(x.date));
  const lines = spendLines(invs, prices);
  const { cols, people } = spendPeople(invs, lines, branchOf);
  const k = q.replace(/\s+/g, "").toLowerCase();
  const shown = people.filter((p) => !k || (p.who + p.hn).replace(/\s+/g, "").toLowerCase().includes(k))
    .sort((a, b) => (sort === "name" ? a.who.localeCompare(b.who, "th") : sort === "owe" ? b.owe - a.owe : b.billed - a.billed));
  const sum = (f: (p: (typeof people)[number]) => number) => shown.reduce((n, p) => n + f(p), 0);
  const label = range === "today" ? `วันนี้ ${docDate(today)}` : range === "week" ? `สัปดาห์นี้ ${docDate(monday)} ถึง ${docDate(today)}` : range === "month" ? monLabel(month) : range === "year" ? `12 เดือนถึง ${monLabel(month)}` : `ทั้งหมดถึง ${monLabel(month)}`;
  const tag = `${range === "today" ? today : range === "week" ? `${monday}-ถึง-${today}` : range === "month" ? month : range === "year" ? `12เดือน-ถึง-${month}` : `ทั้งหมด-ถึง-${month}`}${branch ? `-${branch}` : ""}`;
  // ไฟล์มีชื่อและยอดเงินของผู้รับบริการ = บันทึกลงบันทึกการใช้งานระบบ (เหมือนหน้าส่งออกข้อมูล)
  const exportLines = () => {
    const keys = new Set(shown.map((p) => p.key));
    const n = spendLinesCsv(lines.filter((l) => keys.has(personKey(l.x))), branchOf, `รายการที่ซื้อ-ทุกคน-${tag}`);
    fetch("/api/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ what: "spend", count: n }) }).catch(() => {});
  };

  return (
    <section className="card sc-card">
      <header className="sc-h">
        <div><h3>ค่าใช้จ่ายรายบุคคล · {label}</h3><p>{shown.length} คน · แยกตามหมวด หลังส่วนลด รวม VAT · ไม่นับใบยกเลิกและใบรอตรวจสอบยอด</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="segmented-tabs" role="group" aria-label="ช่วงเวลา">
            {([["today", "วันนี้"], ["week", "สัปดาห์นี้"], ["month", monLabel(month)], ["year", "12 เดือน"], ["all", "ทั้งหมด"]] as const).map(([v, t]) => <button key={v} type="button" className={range === v ? "is-selected" : ""} aria-pressed={range === v} onClick={() => setRange(v)}>{t}</button>)}
          </div>
          {/* ส่งออกไฟล์ละเอียดที่สุดอย่างเดียว (ทุกรายการที่ซื้อ) · ยอดรวมรายคนดูได้จากตารางบนหน้านี้ */}
          <button type="button" className="btn-soft" disabled={!shown.length} title="ทุกรายการที่แต่ละคนซื้อ พร้อมรหัสสินค้า ราคา และยอดที่จ่าย" onClick={exportLines}><CsvIcon /> ส่งออก CSV</button>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gold-400" />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} className="!pl-10" placeholder="ค้นหาชื่อหรือ HN" aria-label="ค้นหาผู้รับบริการ" />
        </div>
        <select aria-label="เรียงตาม" className="!w-auto" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
          <option value="total">เรียงตามยอดเรียกเก็บ</option><option value="owe">เรียงตามยอดค้าง</option><option value="name">เรียงตามชื่อ</option>
        </select>
      </div>
      {shown.length ? <div className="overflow-x-auto"><table className="sales-top ps-table">
        <thead><tr><th>ผู้รับบริการ</th>{cols.map((c) => <th key={c} className="n">{c}</th>)}<th className="n">รวมเรียกเก็บ</th><th className="n">ชำระแล้ว</th><th className="n">ค้างชำระ</th></tr></thead>
        <tbody>{shown.map((p) => <tr key={p.key}>
          <td><b className="block whitespace-nowrap">{p.who}</b><small className="text-gold-500">{p.hn || "ไม่มี HN"} · {p.docs} ใบ</small></td>
          {cols.map((c) => <td key={c} className={`n ${p.by[c] < 0 ? "text-red-700" : p.by[c] ? "" : "text-gold-300"}`}>{p.by[c] ? money(p.by[c]) : "-"}</td>)}
          <td className="n font-semibold">{money(p.billed)}</td><td className="n">{money(p.paid)}</td>
          <td className={`n ${p.owe > 0 ? "font-semibold text-red-700" : "text-gold-300"}`}>{p.owe > 0 ? money(p.owe) : "-"}</td>
        </tr>)}</tbody>
        <tfoot><tr><td>รวม {shown.length} คน</td>{cols.map((c) => <td key={c} className="n">{money(sum((p) => p.by[c]))}</td>)}<td className="n">{money(sum((p) => p.billed))}</td><td className="n">{money(sum((p) => p.paid))}</td><td className="n">{money(sum((p) => p.owe))}</td></tr></tfoot>
      </table></div> : <p className="sc-empty">{q ? `ไม่พบ "${q}"` : `ยังไม่มีใบแจ้งหนี้ใน${label}`}</p>}
    </section>
  );
}
