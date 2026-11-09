"use client";
import { useMemo, useState } from "react";
import CsvIcon from "@/components/CsvIcon";
import { Field, Modal } from "../ui";
import { balanceOf, docDate, Invoice, isCN, isOpen, money, PAID, todayIso } from "@/lib/billing";
import { invoiceDocsCsv } from "@/lib/exportsCsv";
import { useApp } from "@/lib/app";

type Status = "open" | "paid" | "all";
type Range = "today" | "week" | "month" | "all" | "custom";
const STATUS: [Status, string][] = [["open", "คนที่ค้างชำระ"], ["paid", "ชำระครบแล้ว"], ["all", "ทั้งสองแบบ"]];
const RANGES: [Range, string][] = [["today", "วันนี้"], ["week", "สัปดาห์นี้"], ["month", "เดือนนี้"], ["custom", "เลือกเอง"], ["all", "ทุกวันที่"]];

/**
 * ส่งออก CSV แยก "ค้างชำระ" กับ "ชำระครบแล้ว" ตามช่วงวัน (วันนี้ / สัปดาห์นี้ / เดือนนี้ / เลือกเอง / ทุกวันที่)
 *  ค้างชำระ = ค้างชำระ + ชำระบางส่วน นับจากวันที่ออกใบ (ไม่รวมใบรอตรวจสอบยอด) · ชำระครบ = นับจากวันที่รับชำระ
 *  ใช้ทั้งหน้าใบแจ้งหนี้และใบเสร็จ และแท็บการเงินในภาพรวม (list = ใบที่หน้านั้นกรองสาขาแล้ว)
 */
export default function StatusExport({ open, onClose, list, branchOf, scope = "" }: {
  open: boolean; onClose: () => void; list: Invoice[]; branchOf: (x: Invoice) => string;
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
    const [f, e] = range === "today" ? [t, t] : range === "week" ? [monday, t] : range === "month" ? [`${t.slice(0, 7)}-01`, t]
      : range === "custom" ? (from <= to ? [from, to] : [to, from]) : ["", ""];
    const inRange = (v?: string) => !f || (!!v && v.slice(0, 10) >= f && v.slice(0, 10) <= e);
    const rows = list.filter((x) => !isCN(x) && ((status !== "paid" && isOpen(x) && inRange(x.date)) || (status !== "open" && x.status === PAID && inRange(x.paidDate || x.date))));
    return { rows, from: f, to: e };
  }, [list, status, range, from, to, t]);
  const owing = out.rows.filter(isOpen), paid = out.rows.filter((x) => x.status === PAID);
  const run = () => {
    if (!out.rows.length) return;
    const st = status === "open" ? "ค้างชำระ" : status === "paid" ? "ชำระครบแล้ว" : "ค้างชำระและชำระครบ";
    const when = out.from ? (out.from === out.to ? out.from : `${out.from}-ถึง-${out.to}`) : "ทุกวันที่";
    const n = invoiceDocsCsv(out.rows, branchOf, `การเงิน-${st}-${when}${scope ? `-${scope}` : ""}`);
    onClose(); toast(`ส่งออก${st}แล้ว ${n} ใบ`);
  };
  return (
    <Modal open={open} title="ส่งออก CSV ค้างชำระ / ชำระครบ" onClose={onClose}
      footer={<><button className="btn-soft" onClick={onClose}>ยกเลิก</button><button className="btn-primary" disabled={!out.rows.length} onClick={run}><CsvIcon /> ส่งออก {out.rows.length} ใบ</button></>}>
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
          <p>{out.from ? `${docDate(out.from)}${out.to !== out.from ? ` ถึง ${docDate(out.to)}` : ""}` : "ทุกวันที่"}{scope ? ` · ${scope}` : ""} · พบ <b className="text-gold-900">{out.rows.length}</b> ใบ</p>
          {status !== "paid" && <p>ค้างชำระรวม <b className="text-gold-900">{money(owing.reduce((n, x) => n + balanceOf(x), 0))}</b> บาท ({owing.length} ใบ · {new Set(owing.map((x) => x.who)).size} คน)</p>}
          {status !== "open" && <p>ชำระครบรวม <b className="text-gold-900">{money(paid.reduce((n, x) => n + x.net, 0))}</b> บาท ({paid.length} ใบ · {new Set(paid.map((x) => x.who)).size} คน)</p>}
          <p className="mt-1 text-xs text-gold-500">ค้างชำระนับจากวันที่ออกใบ (รวมชำระบางส่วน ไม่รวมใบรอตรวจสอบยอด) · ชำระครบนับจากวันที่รับชำระ</p>
        </div>
      </div>
    </Modal>
  );
}
