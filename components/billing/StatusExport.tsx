"use client";
import { useMemo, useState } from "react";
import CsvIcon from "@/components/CsvIcon";
import { Field, Modal } from "../ui";
import { docDate, Invoice, isCN, isOpen, money, PAID, todayIso } from "@/lib/billing";
import { serviceLinesCsv, serviceLinesRows } from "@/lib/exportsCsv";
import { useApp } from "@/lib/app";

type Status = "open" | "paid" | "all";
type Range = "today" | "week" | "month" | "all" | "custom";
const STATUS: [Status, string][] = [["open", "คนที่ค้างชำระ"], ["paid", "ชำระครบแล้ว"], ["all", "ทั้งสองแบบ"]];
const RANGES: [Range, string][] = [["today", "วันนี้"], ["week", "สัปดาห์นี้"], ["month", "เดือนนี้"], ["custom", "เลือกเอง"], ["all", "ทุกวันที่"]];

/**
 * ส่งออก CSV แยก "ค้างชำระ" กับ "ชำระครบแล้ว" ตามช่วงวัน (วันนี้ / สัปดาห์นี้ / เดือนนี้ / เลือกเอง / ทุกวันที่)
 *  1 แถวต่อรายการ เรียงตามคน · ยอดกระจายตามช่วงบริการ (ใบจ่ายล่วงหน้า 3 เดือน = เดือนนี้ได้เฉพาะส่วนของเดือนนี้) · คอลัมน์ท้าย = ชำระด้วย
 *  ค้างชำระ = ค้างชำระ + ชำระบางส่วน (ไม่รวมใบรอตรวจสอบยอด)
 *  ใช้ทั้งหน้าใบแจ้งหนี้และใบเสร็จ และแท็บการเงินในภาพรวม (list = ใบที่หน้านั้นกรองสาขาแล้ว)
 */
export default function StatusExport({ open, onClose, list, contracts = [], branchOf, scope = "" }: {
  open: boolean; onClose: () => void; list: Invoice[]; contracts?: string[][]; branchOf: (x: Invoice) => string;
  /** ต่อท้ายชื่อไฟล์ เช่น ชื่อสาขาที่เลือก */
  scope?: string;
}) {
  const { toast } = useApp();
  const t = todayIso();
  const [status, setStatus] = useState<Status>("open");
  const [range, setRange] = useState<Range>("month");
  const [from, setFrom] = useState(`${t.slice(0, 7)}-01`);
  const [to, setTo] = useState(t);
  const out = useMemo(() => {
    const d = new Date(`${t}T00:00:00Z`);
    const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
    // สัปดาห์นี้ = จันทร์–อาทิตย์ · เดือนนี้ = ทั้งเดือนปฏิทิน (ยอดกระจายตามช่วงบริการตรงกับ Dashboard)
    const sunday = new Date(Date.parse(`${monday}T00:00:00Z`) + 6 * 864e5).toISOString().slice(0, 10);
    const monthEnd = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const [f, e] = range === "today" ? [t, t] : range === "week" ? [monday, sunday] : range === "month" ? [`${t.slice(0, 7)}-01`, monthEnd]
      : range === "custom" ? (from <= to ? [from, to] : [to, from]) : ["", ""];
    const inv = list.filter((x) => !isCN(x) && ((status !== "paid" && isOpen(x)) || (status !== "open" && x.status === PAID)));
    const lines = serviceLinesRows(inv, contracts, f, e);
    return { inv, lines, from: f, to: e };
  }, [list, contracts, status, range, from, to, t]);
  const sumOf = (pick: (x: Invoice) => boolean) => out.lines.filter((l) => pick(l.x)).reduce((n, l) => n + l.alloc, 0);
  const people = (pick: (x: Invoice) => boolean) => new Set(out.lines.filter((l) => pick(l.x)).map((l) => l.x.who)).size;
  const run = () => {
    if (!out.lines.length) return;
    const st = status === "open" ? "ค้างชำระ" : status === "paid" ? "ชำระครบแล้ว" : "ค้างชำระและชำระครบ";
    const when = out.from ? (out.from === out.to ? out.from : `${out.from}-ถึง-${out.to}`) : "ทุกวันที่";
    const n = serviceLinesCsv(out.inv, contracts, branchOf, `การเงิน-${st}-${when}${scope ? `-${scope}` : ""}`, out.from, out.to);
    onClose(); toast(`ส่งออก${st}แล้ว ${n} รายการ`);
  };
  return (
    <Modal open={open} title="ส่งออก CSV ค้างชำระ / ชำระครบ" onClose={onClose}
      footer={<><button className="btn-soft" onClick={onClose}>ยกเลิก</button><button className="btn-primary" disabled={!out.lines.length} onClick={run}><CsvIcon /> ส่งออก {out.lines.length} รายการ</button></>}>
      <div className="space-y-4">
        <Field label="ต้องการดู">
          <div className="segmented-tabs" role="group" aria-label="สถานะที่ส่งออก">
            {STATUS.map(([v, x]) => <button key={v} type="button" className={status === v ? "is-selected" : ""} aria-pressed={status === v} onClick={() => setStatus(v)}>{x}</button>)}
          </div>
        </Field>
        <Field label="ช่วงวันที่">
          <div className="segmented-tabs" role="group" aria-label="ช่วงวันที่">
            {RANGES.map(([v, x]) => <button key={v} type="button" className={range === v ? "is-selected" : ""} aria-pressed={range === v} onClick={() => setRange(v)}>{x}</button>)}
          </div>
          {range === "custom" && <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-gold-700">ตั้งแต่<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="text-sm text-gold-700">ถึง<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>}
        </Field>
        <div className="rounded-xl bg-cream-50 px-4 py-3 text-sm text-gold-700">
          <p>{out.from ? `${docDate(out.from)}${out.to !== out.from ? ` ถึง ${docDate(out.to)}` : ""}` : "ทุกวันที่"}{scope ? ` · ${scope}` : ""} · พบ <b className="text-gold-900">{out.lines.length}</b> รายการ</p>
          {status !== "paid" && <p>ค้างชำระ (ยอดในช่วง) <b className="text-gold-900">{money(sumOf(isOpen))}</b> บาท · {people(isOpen)} คน</p>}
          {status !== "open" && <p>ชำระครบ (ยอดในช่วง) <b className="text-gold-900">{money(sumOf((x) => x.status === PAID))}</b> บาท · {people((x) => x.status === PAID)} คน</p>}
          <p className="mt-1 text-xs text-gold-500">1 แถวต่อรายการ เรียงตามคน · ยอดกระจายตามช่วงบริการ (เช่น จ่ายล่วงหน้า 3 เดือน เดือนนี้ได้เฉพาะส่วนของเดือนนี้) · ยา เวชภัณฑ์ เงินประกัน นับตามวันที่ออกใบ · คอลัมน์ท้ายบอกวิธีชำระ</p>
        </div>
      </div>
    </Modal>
  );
}
