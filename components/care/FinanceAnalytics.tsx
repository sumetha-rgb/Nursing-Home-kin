"use client";
import { useEffect, useState } from "react";
import CsvIcon from "@/components/CsvIcon";
import Icon from "../Icon";
import { MetricGrid, Section, Tile } from "../ui";
import { balanceOf, BILL_KINDS, docDate, DRAFT, Invoice, isOpen, money, PAID, PARTIAL, VOID } from "@/lib/billing";
import { downloadCsv, useCrud, useRecords } from "@/lib/store";
import { CONTRACTS, RESIDENTS } from "@/lib/mock";
import { useApp } from "@/lib/app";
import { exportInvoiceLines, exportPayments } from "@/lib/billingExport";
import { cashHandoff } from "@/lib/handoff";
import { useSession } from "@/lib/session";
import { useBranchInfo } from "../views/Billing";
import Receivables from "../billing/Receivables";
import { CashCloseStatus } from "../billing/CashClose";

const TH_MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const monthKey = (d = new Date(Date.now() + 7 * 3600e3)) => d.toISOString().slice(0, 7);
/** "2026-11" → "พ.ย. 69" */
const monLabel = (k: string) => `${TH_MON[Number(k.slice(5, 7)) - 1]} ${String(Number(k.slice(0, 4)) + 543).slice(2)}`;
const lastMonths = (n: number) => {
  const now = new Date(Date.now() + 7 * 3600e3);
  return Array.from({ length: n }, (_, i) => monthKey(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (n - 1 - i), 1))));
};
/** 12 (หรือ n) เดือนที่จบที่เดือน ym */
const lastMonthsTo = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number); return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1)).toISOString().slice(0, 7)); };
const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)} ล.` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));

/** กราฟแท่งแนวตั้ง 1 ชุดข้อมูล: แท่งบาง ปลายมน ฐานชิดแกน · ชี้ที่แท่งเห็นยอด · ป้ายตัวเลขเฉพาะแท่งล่าสุด */
function MonthBars({ data, unit = "บาท" }: { data: { label: string; value: number }[]; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div className="viz-bars" role="img" aria-label={data.map((d) => `${d.label} ${money(d.value)} ${unit}`).join(", ")}>
      {[1, 0.5].map((g) => <div key={g} className="viz-grid" style={{ bottom: `${g * 100}%` }}><span>{short(max * g)}</span></div>)}
      {data.map((d, i) => {
        const h = (d.value / max) * 100, last = i === data.length - 1;
        return (
          <div key={d.label} className="viz-col" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}>
            <div className="viz-track">
              {(hover === i || last) && d.value > 0 && <span className="viz-val" style={{ bottom: `calc(${h}% + 4px)` }}>{hover === i ? `${money(d.value)} ${unit}` : short(d.value)}</span>}
              <div className={`viz-bar ${hover === i ? "is-on" : ""}`} style={{ height: `${Math.max(d.value ? 1.5 : 0, h)}%` }} />
            </div>
            <span className="viz-x">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/** แท่งแนวนอน (สัดส่วนต่อยอดรวม) · ชื่อและยอดเป็นตัวอักษร สีแท่งบอกขนาดอย่างเดียว */
function ShareBars({ rows }: { rows: { label: string; value: number; note?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="rounded-xl bg-cream-50 px-4 py-6 text-center text-sm text-gold-600">ยังไม่มีข้อมูลเดือนนี้</p>;
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label} ${money(r.value)} บาท`}>
          <div className="flex items-baseline justify-between gap-3 text-sm"><span className="text-gold-800">{r.label}</span><span className="tabular-nums text-gold-700">{money(r.value)}{r.note ? <small className="ml-1 text-gold-500">{r.note}</small> : null}</span></div>
          <div className="viz-hbar"><span style={{ width: `${(r.value / max) * 100}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

/**
 * แดชบอร์ดการเงิน: รายรับรายเดือน ยอดออกใบแยกประเภท ค้างชำระ ใบรอตรวจสอบยอด
 *  branch ว่าง = ทุกสาขาที่บัญชีนี้เห็น · compact = แสดงเฉพาะตัวเลขสรุป (หน้าภาพรวม)
 */
/** สรุปการเงินของเดือนที่เลือกเทียบเดือนก่อน (การ์ดหน้าภาพรวม · รายงานผู้บริหาร) · collect = รับชำระ ÷ ยอดออกใบของเดือน (%) */
/** prevLabel = ช่วงที่เอามาเทียบ เช่น "1–5 ต.ค. 69" (เดือนปัจจุบัน) หรือ "ต.ค. 69" */
export type FinSummary = { month: string; prevMonth: string; prevLabel: string; paid: number; paidPrev: number; billed: number; billedPrev: number; collect: number | null; collectPrev: number | null; owe: number; openN: number; discPct: number | null };

export default function FinanceAnalytics({ branch, compact, onTiles, month, prevMonth, onSummary }: { branch: string; compact?: boolean; onTiles?: (t: Tile[]) => void; month?: string; prevMonth?: string; onSummary?: (s: FinSummary) => void }) {
  const [all, , meta] = useRecords<Invoice>("invoices", []);
  const res = useCrud("residents", RESIDENTS);
  const con = useCrud("contracts", CONTRACTS);
  const { go, toast } = useApp();
  const { user } = useSession();
  const branchInfo = useBranchInfo();
  // ใบแจ้งหนี้ไม่มีสาขาฝั่งหน้าจอ: ดูจากสัญญา หรือผู้รับบริการ
  const branchOf = (x: Invoice) => con.rows.find((c) => c[0] === x.contract)?.[1] ?? res.rows.find((r) => r[0] === x.who)?.[3] ?? "";
  const list = (branch ? all.filter((x) => branchOf(x) === branch) : all).filter((x) => x.status !== VOID);
  // เดือนที่เลือกจากตัวเลือกช่วงเวลา (ค่าเริ่มต้น = เดือนนี้) · กราฟ 12 เดือนจบที่เดือนนั้น
  const now = month ?? monthKey();
  const months = lastMonthsTo(now, 12), prev = prevMonth ?? months[months.length - 2];
  // เดือนปัจจุบันยังไม่จบ: เทียบกับเดือนก่อนช่วงวันเดียวกัน (เช่น 1–5 พ.ย. เทียบ 1–5 ต.ค.) · เดือนที่จบแล้วเทียบทั้งเดือน
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const cut = now === today.slice(0, 7) ? Number(today.slice(8, 10)) : 0;
  const upTo = (d: string | undefined, day: number) => !day || Number((d ?? "").slice(8, 10)) <= day;
  const paidIn = (m: string, day = 0) => list.filter((x) => (x.status === PAID || x.status === PARTIAL) && (x.paidDate ?? "").startsWith(m) && upTo(x.paidDate, day)).reduce((n, x) => n + (x.paid ?? 0), 0);
  const billedIn = (m: string, day = 0) => list.filter((x) => x.status !== DRAFT && x.date.startsWith(m) && upTo(x.date, day));
  const open = list.filter(isOpen), drafts = list.filter((x) => x.status === DRAFT);
  const owe = open.reduce((n, x) => n + balanceOf(x), 0);
  const paidNow = paidIn(now), paidPrev = paidIn(prev, cut);
  const prevDays = cut ? Math.min(cut, new Date(Date.UTC(Number(prev.slice(0, 4)), Number(prev.slice(5, 7)), 0)).getUTCDate()) : 0;
  const prevLabel = cut ? `${prevDays > 1 ? "1–" : ""}${prevDays} ${monLabel(prev)}` : monLabel(prev);
  const billedNow = billedIn(now), discNow = billedNow.reduce((n, x) => n + (x.discount || 0), 0);
  const delta = paidPrev ? Math.round(((paidNow - paidPrev) / paidPrev) * 100) : null;
  const billedSum = (m: string, day = 0) => billedIn(m, day).reduce((n, x) => n + x.net, 0);
  const collectOf = (m: string, day = 0) => (billedSum(m, day) ? Math.round((paidIn(m, day) / billedSum(m, day)) * 100) : null);
  const grossNow = billedNow.reduce((n, x) => n + (x.total || 0), 0);
  const summary: FinSummary = { month: now, prevMonth: prev, paid: paidNow, paidPrev, billed: billedSum(now), billedPrev: billedSum(prev, cut), collect: collectOf(now), collectPrev: collectOf(prev, cut), prevLabel, owe, openN: open.length, discPct: grossNow ? Math.round((discNow / grossNow) * 1000) / 10 : null };
  const sumKey = JSON.stringify(summary);
  useEffect(() => { onSummary?.(summary); }, [sumKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const kpis = [
    { label: `รับชำระ ${monLabel(now)}`, value: money(paidNow), unit: "บาท", icon: "check", accent: true, note: delta === null ? `ไม่มีรายรับ ${prevLabel} ให้เทียบ` : delta === 0 ? `เท่ากับ ${prevLabel}` : `${delta > 0 ? "▲ เพิ่มขึ้น" : "▼ ลดลง"} ${Math.abs(delta)}% จาก ${prevLabel}` },
    { label: `ออกใบแจ้งหนี้ ${monLabel(now)}`, value: money(billedSum(now)), unit: "บาท", icon: "receipt", note: `${billedNow.length} ใบ · ส่วนลด ${money(discNow)} บาท${summary.discPct !== null ? ` (${summary.discPct}%)` : ""}` },
    { label: "อัตราเก็บเงินได้", value: summary.collect === null ? "-" : `${summary.collect}%`, icon: "chart", note: `รับชำระ ÷ ยอดออกใบของเดือน${summary.collectPrev !== null ? ` · ${prevLabel} ${summary.collectPrev}%` : ""}` },
    { label: "ค้างชำระ", value: money(owe), unit: "บาท", icon: "alert", note: `${open.length} ใบ` },
    { label: "รอตรวจสอบยอด", value: drafts.length, unit: "ใบ", icon: "history", note: drafts.length ? `รวม ${money(drafts.reduce((n, x) => n + x.net, 0))} บาท` : "ไม่มีใบรอตรวจ" },
  ];
  const key = JSON.stringify(kpis.map((t) => [t.label, t.value, t.note]));
  useEffect(() => { onTiles?.(kpis); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (compact) return <MetricGrid items={kpis} />;
  const months12 = months;
  const exportMonths = () => downloadCsv(`การเงิน-รายเดือน${branch ? `-${branch}` : ""}`, ["เดือน", "ออกใบ (ใบ)", "ยอดออกใบ (บาท)", "ส่วนลด (บาท)", "รับชำระ (บาท)"],
    months12.map((m) => { const b = billedIn(m); return [monLabel(m), String(b.length), money(b.reduce((n, x) => n + x.net, 0)), money(b.reduce((n, x) => n + (x.discount || 0), 0)), money(paidIn(m))]; }));
  const exportDocs = () => downloadCsv(`การเงิน-เอกสาร${branch ? `-${branch}` : ""}`, ["เลขที่เอกสาร", "วันที่", "สาขา", "ผู้รับบริการ", "HN", "ผู้ชำระ", "ประเภท", "สัญญา", "ยอดก่อนส่วนลด", "ส่วนลด", "ยอดสุทธิ", "ชำระแล้ว", "คงเหลือ", "วันที่รับชำระ", "สถานะ"],
    [...all].filter((x) => !branch || branchOf(x) === branch).sort((a, b) => b.date.localeCompare(a.date))
      .map((x) => [x.no ?? "", docDate(x.date), branchOf(x), x.who, x.hn || "", x.payer, x.kind, x.contract || "", money(x.total), money(x.discount), money(x.net), money(x.paid ?? 0), x.status === VOID ? "0.00" : money(balanceOf(x)), x.paidDate ? docDate(x.paidDate) : "", x.status]));

  const byKind = BILL_KINDS.map((k) => ({ label: k, value: billedNow.filter((x) => x.kind === k).reduce((n, x) => n + x.net, 0), n: billedNow.filter((x) => x.kind === k).length }))
    .filter((r) => r.value > 0).sort((a, b) => b.value - a.value).map((r) => ({ label: r.label, value: r.value, note: `${r.n} ใบ` }));
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn-soft" onClick={exportMonths}><CsvIcon /> ส่งออกสรุปรายเดือน (12 เดือน)</button>
        <button className="btn-soft" onClick={exportDocs}><CsvIcon /> ส่งออกเอกสารทั้งหมด</button>
        <button className="btn-soft" onClick={() => { const n = exportInvoiceLines(all.filter((x) => !branch || branchOf(x) === branch), branchOf, `การเงิน-รายการในใบ${branch ? `-${branch}` : ""}`); toast(`ส่งออกรายการในใบแล้ว ${n} บรรทัด`); }}><CsvIcon /> ส่งออกรายการในใบ (แยกหมวด)</button>
        <button className="btn-soft" onClick={() => exportPayments(branch, `การเงิน-การรับเงินรายงวด${branch ? `-${branch}` : ""}`).then((n) => toast(`ส่งออกการรับเงินแล้ว ${n} งวด`)).catch((e) => toast((e as Error).message))}><CsvIcon /> ส่งออกการรับเงินรายงวด</button>
      </div>
      <MetricGrid items={kpis} />
      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <Section title="รายรับ 12 เดือน" sub="ยอดที่รับชำระจริง ตามเดือนที่รับเงิน (บาท) · ชี้ที่แท่งเพื่อดูยอด">
          {meta.loaded ? <MonthBars data={months.map((m) => ({ label: monLabel(m), value: paidIn(m) }))} /> : <p className="text-sm text-gold-500">กำลังโหลด…</p>}
        </Section>
        <Section title={`ยอดออกใบ ${monLabel(now)} แยกตามประเภท`} sub="ไม่นับใบที่ยกเลิกและใบรอตรวจสอบยอด (บาท)">
          <ShareBars rows={byKind} />
        </Section>
      </div>
      {/* อายุลูกหนี้ (ชุดเดียวกับหน้าใบแจ้งหนี้และใบเสร็จ) และสถานะการปิดยอดรายสาขา */}
      {open.length ? <Receivables list={list} branchOf={branchOf} branchInfo={branchInfo} by={user?.name} />
        : <Section title="ลูกหนี้ค้างชำระตามอายุหนี้"><p className="rounded-xl bg-cream-50 px-4 py-6 text-center text-sm text-gold-600">{meta.loaded ? "ไม่มีใบค้างชำระ" : "กำลังโหลด…"}</p></Section>}
      <CashCloseStatus branch={branch} onOpen={() => { cashHandoff.set(); go("billing"); }} />
    </div>
  );
}
