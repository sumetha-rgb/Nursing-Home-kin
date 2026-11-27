"use client";
import { useEffect, useRef, useState } from "react";
import CsvIcon from "@/components/CsvIcon";
import Icon from "../Icon";
import { MenuButton, MetricGrid, Section, Tile } from "../ui";
import { balanceOf, BILL_KINDS, docDate, DRAFT, Invoice, invoiceBranch, isOpen, money, PAID, PARTIAL, signedNet, VOID } from "@/lib/billing";
import { downloadCsv, useCrud, useRecords } from "@/lib/store";
import { CONTRACTS, RESIDENTS } from "@/lib/mock";
import { useApp } from "@/lib/app";
import { exportInvoiceLines, exportPayments, OwingAt, useOwingAt, usePaidDays } from "@/lib/billingExport";
import { useSession } from "@/lib/session";
import { useBranchInfo } from "../views/Billing";
import Receivables from "../billing/Receivables";
import StatusExport from "../billing/StatusExport";
import { revenueIn } from "@/lib/servicePeriod";
import { invoiceDocsCsv } from "@/lib/exportsCsv";
import SalesTargets from "./SalesTargets";
import CompanyStrip from "./CompanyStrip";
import { canSalesTax } from "@/lib/settingsAccess";

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
/** ช่วงวันที่แบบสั้น: "5 พ.ย. 69" · "1–18 พ.ย. 69" · "20 ต.ค. 69 – 5 พ.ย. 69" */
const spanTh = (a: string, b: string) => {
  const sd = (s: string) => ({ d: Number(s.slice(8, 10)), m: monLabel(s.slice(0, 7)) });
  const x = sd(a), z = sd(b);
  return a === b ? `${x.d} ${x.m}` : x.m === z.m ? `${x.d}–${z.d} ${z.m}` : `${x.d} ${x.m} – ${z.d} ${z.m}`;
};
/** ช่วงวันที่ที่เลือกเอง (หน้าภาพรวมและรายงาน › เลือกช่วงวันที่) · pfrom–pto = ช่วงก่อนหน้าจำนวนวันเท่ากัน */
export type FinRange = { from: string; to: string; pfrom: string; pto: string };
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

/** กราฟแท่งคู่ต่อเดือน: ยอดออกใบ (อ่อน) กับ รับจริง (เข้ม) แกนเดียวกัน · ใต้เดือน = % เก็บได้ (รับ ÷ ออกใบ)
 *  ต่ำกว่าเป้า = ตัวแดง (ยกเว้นเดือนที่ยังไม่จบ open) · ชี้/โฟกัสที่เดือนเห็นยอดทั้งคู่ */
function PairBars({ data, goal, open }: { data: { label: string; billed: number; paid: number }[]; goal?: number; open?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.flatMap((d) => [d.billed, d.paid]));
  const pctOf = (d: { billed: number; paid: number }) => (d.billed > 0 ? Math.round((d.paid / d.billed) * 100) : null);
  // จอแคบเลื่อนแนวนอน: เปิดมาเห็นเดือนล่าสุดก่อน
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = scroller.current; if (el) el.scrollLeft = el.scrollWidth; }, [data.length]);
  return (
    <div className="space-y-2">
      <p className="viz-legend"><span><i className="is-billed" />ยอดออกใบ</span><span><i className="is-paid" />รับจริง</span><span className="text-gold-600">ตัวเลขใต้เดือน = % เก็บได้ (รับ ÷ ออกใบ){goal ? ` · ตัวแดง = ต่ำกว่าเป้า ${goal}%` : ""}</span></p>
      <div className="viz-scroll" ref={scroller}>
        <div className="viz-bars viz-pair" role="img" aria-label={data.map((d) => `${d.label} ออกใบ ${money(d.billed)} รับจริง ${money(d.paid)} บาท`).join(", ")}>
          {[1, 0.5].map((g) => <div key={g} className="viz-grid" style={{ bottom: `calc(${g} * (100% - 52px) + 52px)` }}><span>{short(max * g)}</span></div>)}
          {data.map((d, i) => {
            const hb = (d.billed / max) * 100, hp = (d.paid / max) * 100, p = pctOf(d);
            const low = goal !== undefined && p !== null && p < goal && d.label !== open;
            return (
              <div key={d.label} className="viz-col" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0}
                aria-label={`${d.label} ออกใบ ${money(d.billed)} บาท รับจริง ${money(d.paid)} บาท${p !== null ? ` เก็บได้ ${p}%` : ""}`}>
                <div className="viz-track">
                  {hover === i && <span className="viz-val is-two" style={{ bottom: `calc(${Math.max(hb, hp)}% + 4px)` }}>ออกใบ {money(d.billed)}<br />รับจริง {money(d.paid)}</span>}
                  <div className="viz-bar is-billed" style={{ height: `${Math.max(d.billed ? 1.5 : 0, hb)}%` }} />
                  <div className="viz-bar is-paid" style={{ height: `${Math.max(d.paid ? 1.5 : 0, hp)}%` }} />
                </div>
                <span className="viz-x">{d.label}</span>
                <span className={`viz-pct ${low ? "is-low" : ""}`}>{p === null ? "-" : `${p}%`}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** แท่งแนวนอน (สัดส่วนต่อยอดรวม) · ชื่อและยอดเป็นตัวอักษร สีแท่งบอกขนาดอย่างเดียว */
export function ShareBars({ rows }: { rows: { label: string; value: number; note?: string }[] }) {
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
export type FinSummary = { month: string; prevMonth: string; prevLabel: string; paid: number; paidPrev: number; billed: number; billedPrev: number; collect: number | null; collectPrev: number | null; owe: number; openN: number; discPct: number | null;
  /** เลือกเดือนที่ผ่านมา: ค้างชำระ ณ สิ้นเดือนนั้น (null = เดือนปัจจุบัน ใช้ยอด ณ วันนี้) */
  oweAt?: OwingAt | null;
  /** ชื่อช่วงที่แสดงในการ์ด เช่น "พ.ย. 69" หรือ "1–18 พ.ย. 69" (เลือกช่วงวันที่) · oweLabel = "ณ สิ้น ต.ค. 69" / "ณ 18 พ.ย. 69" */
  label?: string; oweLabel?: string;
  /** อัตราเก็บเงินได้ 6 เดือนจบที่เดือนที่เลือก (กราฟเทียบเดือน) */
  collectMonthly?: { month: string; v: number | null }[] };

/** collectGoal = เป้าอัตราเก็บเงินได้ (%) ของสาขาที่ดู · ใช้ทำตัวแดงในกราฟ 12 เดือน */
/** rng = ช่วงวันที่ที่เลือกเอง: ตัวเลขหลักและแถบบริษัทคิดตามช่วงนี้ เทียบช่วงก่อนหน้าจำนวนวันเท่ากัน · กราฟ 12 เดือน/เป้ายอดขายยังเป็นรายเดือน (เดือนของวันสุดท้าย) */
export default function FinanceAnalytics({ branch, compact, onTiles, month, prevMonth, onSummary, collectGoal, rng }: { branch: string; compact?: boolean; onTiles?: (t: Tile[]) => void; month?: string; prevMonth?: string; onSummary?: (s: FinSummary) => void; collectGoal?: number; rng?: FinRange }) {
  const [all, , meta] = useRecords<Invoice>("invoices", []);
  const res = useCrud("residents", RESIDENTS);
  const con = useCrud("contracts", CONTRACTS);
  const { toast, go } = useApp();
  const { user } = useSession();
  const branchInfo = useBranchInfo();
  // ใบแจ้งหนี้ไม่มีสาขาฝั่งหน้าจอ: ดูจากสัญญา หรือผู้รับบริการ หรือสาขาของผู้ใช้ (เหมือนหน้าใบแจ้งหนี้และใบเสร็จ)
  const branchOf = (x: Invoice) => invoiceBranch(x, con.rows, res.rows, user?.branch);
  /** ส่งออก CSV แยกค้างชำระ / ชำระครบ ตามช่วงวัน */
  const [exp, setExp] = useState(false);
  const list = (branch ? all.filter((x) => branchOf(x) === branch) : all).filter((x) => x.status !== VOID);
  // เดือนที่เลือกจากตัวเลือกช่วงเวลา (ค่าเริ่มต้น = เดือนนี้) · กราฟ 12 เดือนจบที่เดือนนั้น
  const now = month ?? monthKey();
  const months = lastMonthsTo(now, 12), prev = prevMonth ?? months[months.length - 2];
  // เดือนปัจจุบันยังไม่จบ: เทียบกับเดือนก่อนช่วงวันเดียวกัน (เช่น 1–5 พ.ย. เทียบ 1–5 ต.ค.) · เดือนที่จบแล้วเทียบทั้งเดือน
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const cut = now === today.slice(0, 7) ? Number(today.slice(8, 10)) : 0;
  // เดือนที่ผ่านมา: ค้างชำระ ณ วันสุดท้ายของเดือนนั้น (คำนวณจากวันที่รับเงินแต่ละงวด) · เดือนปัจจุบัน = ยอด ณ วันนี้
  const pastEnd = rng ? (rng.to < today ? rng.to : null) : now < today.slice(0, 7) ? `${now}-${String(new Date(Date.UTC(Number(now.slice(0, 4)), Number(now.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}` : null;
  const oweAt = useOwingAt(pastEnd, branch);
  const upTo = (d: string | undefined, day: number) => !day || Number((d ?? "").slice(8, 10)) <= day;
  // รับชำระของเดือน = รวมเงินที่รับแต่ละงวดตามวันที่รับจริง (จาก /api/billing) · ยังโหลดไม่ได้ = ประมาณจากยอดสะสมของใบตามวันที่รับล่าสุด (แบบเดิม)
  const from = rng && rng.pfrom < `${months[0]}-01` ? rng.pfrom : `${prev < months[0] ? prev : months[0]}-01`;
  const days = usePaidDays(from, meta.loaded ? all.reduce((n, x) => n + (x.paid ?? 0), 0) : undefined);
  const dayRows = days ? (branch ? days.filter((p) => p.branch === branch) : days) : null;
  const paidIn = (m: string, day = 0) => dayRows
    ? dayRows.filter((p) => p.date.startsWith(m) && upTo(p.date, day)).reduce((n, p) => n + p.amount, 0)
    : list.filter((x) => (x.status === PAID || x.status === PARTIAL) && (x.paidDate ?? "").startsWith(m) && upTo(x.paidDate, day)).reduce((n, x) => n + (x.paid ?? 0), 0);
  const billedIn = (m: string, day = 0) => list.filter((x) => x.status !== DRAFT && x.date.startsWith(m) && upTo(x.date, day));
  /** ช่วงวันที่ที่เลือกเอง: รับชำระตามวันที่รับจริง · ออกใบตามวันที่ออกใบ */
  const paidBetween = (a: string, b: string) => dayRows
    ? dayRows.filter((p) => p.date >= a && p.date <= b).reduce((n, p) => n + p.amount, 0)
    : list.filter((x) => (x.status === PAID || x.status === PARTIAL) && (x.paidDate ?? "") >= a && (x.paidDate ?? "") <= b).reduce((n, x) => n + (x.paid ?? 0), 0);
  const billedBetween = (a: string, b: string) => list.filter((x) => x.status !== DRAFT && x.date >= a && x.date <= b);
  const open = list.filter(isOpen), drafts = list.filter((x) => x.status === DRAFT);
  const owe = open.reduce((n, x) => n + balanceOf(x), 0);
  const paidNow = rng ? paidBetween(rng.from, rng.to) : paidIn(now), paidPrev = rng ? paidBetween(rng.pfrom, rng.pto) : paidIn(prev, cut);
  const prevDays = cut ? Math.min(cut, new Date(Date.UTC(Number(prev.slice(0, 4)), Number(prev.slice(5, 7)), 0)).getUTCDate()) : 0;
  const prevLabel = rng ? spanTh(rng.pfrom, rng.pto) : cut ? `${prevDays > 1 ? "1–" : ""}${prevDays} ${monLabel(prev)}` : monLabel(prev);
  const curLabel = rng ? spanTh(rng.from, rng.to) : monLabel(now);
  const billedNow = rng ? billedBetween(rng.from, rng.to) : billedIn(now), discNow = billedNow.reduce((n, x) => n + (x.discount || 0), 0);
  const delta = paidPrev ? Math.round(((paidNow - paidPrev) / paidPrev) * 100) : null;
  // ใบลดหนี้ในเดือนเดียวกันหักออกจากยอดออกใบ
  const billedSum = (m: string, day = 0) => billedIn(m, day).reduce((n, x) => n + signedNet(x), 0);
  const collectOf = (m: string, day = 0) => (billedSum(m, day) ? Math.round((paidIn(m, day) / billedSum(m, day)) * 100) : null);
  const grossNow = billedNow.reduce((n, x) => n + (x.total || 0), 0);
  const billedNowSum = billedNow.reduce((n, x) => n + signedNet(x), 0);
  const billedPrevSum = rng ? billedBetween(rng.pfrom, rng.pto).reduce((n, x) => n + signedNet(x), 0) : billedSum(prev, cut);
  const pctRound = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
  const summary: FinSummary = { month: now, prevMonth: prev, paid: paidNow, paidPrev, billed: billedNowSum, billedPrev: billedPrevSum, collect: pctRound(paidNow, billedNowSum), collectPrev: pctRound(paidPrev, billedPrevSum), prevLabel,
    label: curLabel, oweLabel: rng ? `ณ ${spanTh(rng.to, rng.to)}` : `ณ สิ้น ${monLabel(now)}`, owe, openN: open.length, oweAt: pastEnd ? oweAt : null, collectMonthly: months.slice(-6).map((m) => ({ month: m, v: collectOf(m) })), discPct: grossNow ? Math.round((discNow / grossNow) * 1000) / 10 : null };
  const sumKey = JSON.stringify(summary);
  useEffect(() => { onSummary?.(summary); }, [sumKey]); // eslint-disable-line react-hooks/exhaustive-deps
  /** รายได้ตามช่วงบริการของเดือน (กระจายใบจ่ายล่วงหน้าตามวันที่พักจริง · วิธีเดียวกับ CSV ค้างชำระ / ชำระครบ) */
  const monthEnd = (m: string) => `${m}-${String(new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate()).padStart(2, "0")}`;
  const revOf = (m: string) => revenueIn(list, con.rows, `${m}-01`, monthEnd(m));
  const revNow = rng ? revenueIn(list, con.rows, rng.from, rng.to) : revOf(now), revPrev = rng ? revenueIn(list, con.rows, rng.pfrom, rng.pto) : revOf(prev);
  const kpis = [
    { label: `รับชำระ ${curLabel}`, value: money(paidNow), unit: "บาท", icon: "check", accent: true, note: delta === null ? `ไม่มีรายรับ ${prevLabel} ให้เทียบ` : delta === 0 ? `เท่ากับ ${prevLabel}` : `${delta > 0 ? "▲ เพิ่มขึ้น" : "▼ ลดลง"} ${Math.abs(delta)}% จาก ${prevLabel}` },
    { label: `ออกใบแจ้งหนี้ ${curLabel}`, value: money(billedNowSum), unit: "บาท", icon: "receipt", note: `${billedNow.length} ใบ · ส่วนลด ${money(discNow)} บาท${summary.discPct !== null ? ` (${summary.discPct}%)` : ""}` },
    { label: `รายได้ตามช่วงบริการ ${curLabel}`, value: money(revNow), unit: "บาท", icon: "calendar", note: `กระจายยอดตามวันที่พัก · ${rng ? prevLabel : monLabel(prev)} ${money(revPrev)} บาท` },
    { label: "อัตราเก็บเงินได้", value: summary.collect === null ? "-" : `${summary.collect}%`, icon: "chart", note: `รับชำระ ÷ ยอดออกใบ${rng ? "ในช่วง" : "ของเดือน"}${summary.collectPrev !== null ? ` · ${prevLabel} ${summary.collectPrev}%` : ""}` },
    pastEnd
      ? { label: `ค้างชำระ ${summary.oweLabel}`, value: oweAt ? money(oweAt.sum) : "…", unit: "บาท", icon: "alert", note: oweAt ? `${oweAt.n} ใบ · ตอนนี้ค้าง ${money(owe)} บาท (${open.length} ใบ)` : "กำลังคำนวณ…" }
      : { label: "ค้างชำระ", value: money(owe), unit: "บาท", icon: "alert", note: `${open.length} ใบ` },
    { label: "รอตรวจสอบยอด", value: drafts.length, unit: "ใบ", icon: "history", note: drafts.length ? `รวม ${money(drafts.reduce((n, x) => n + x.net, 0))} บาท` : "ไม่มีใบรอตรวจ" },
  ];
  const key = JSON.stringify(kpis.map((t) => [t.label, t.value, t.note]));
  useEffect(() => { onTiles?.(kpis); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (compact) return <MetricGrid items={kpis} />;
  const months12 = months;
  const exportMonths = () => downloadCsv(`การเงิน-รายเดือน${branch ? `-${branch}` : ""}`, ["เดือน", "ออกใบ (ใบ)", "ยอดออกใบ (บาท)", "ส่วนลด (บาท)", "รายได้ตามช่วงบริการ (บาท)", "รับชำระ (บาท)"],
    months12.map((m) => { const b = billedIn(m); return [monLabel(m), String(b.length), money(b.reduce((n, x) => n + x.net, 0)), money(b.reduce((n, x) => n + (x.discount || 0), 0)), money(revOf(m)), money(paidIn(m))]; }));
  /** เอกสารทั้งหมด 1 แถวต่อใบ · แยกค่าห้อง (รวม VAT) / ค่าบริการทางการแพทย์ / มี VAT / VAT / ไม่มี VAT / ยอดสุทธิ */
  const exportDocs = () => invoiceDocsCsv(all.filter((x) => !branch || branchOf(x) === branch), branchOf, `การเงิน-เอกสาร${branch ? `-${branch}` : ""}`);

  const byKind = BILL_KINDS.map((k) => ({ label: k, value: billedNow.filter((x) => x.kind === k).reduce((n, x) => n + x.net, 0), n: billedNow.filter((x) => x.kind === k).length }))
    .filter((r) => r.value > 0).sort((a, b) => b.value - a.value).map((r) => ({ label: r.label, value: r.value, note: `${r.n} ใบ` }));
  const mine = all.filter((x) => !branch || branchOf(x) === branch);
  const exportItems = [
    { label: "สรุปรายเดือน (12 เดือน)", onClick: exportMonths },
    { label: "ค้างชำระ / ชำระครบ", hint: "เลือกช่วงวัน", onClick: () => setExp(true) },
    { label: "เอกสารทั้งหมด", hint: "1 แถวต่อใบ", onClick: exportDocs },
    { label: "รายการในใบ (แยกหมวด)", onClick: () => { const n = exportInvoiceLines(mine, branchOf, `การเงิน-รายการในใบ${branch ? `-${branch}` : ""}`); toast(`ส่งออกรายการในใบแล้ว ${n} บรรทัด`); } },
    { label: "การรับเงินรายงวด", onClick: () => { exportPayments(branch, `การเงิน-การรับเงินรายงวด${branch ? `-${branch}` : ""}`).then((n) => toast(`ส่งออกการรับเงินแล้ว ${n} งวด`)).catch((e) => toast((e as Error).message)); } },
    { label: "ดูทั้งหมดที่เมนู ส่งออกข้อมูล ›", onClick: () => go("exports") },
  ];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-end gap-2">
        <MenuButton label="ส่งออก" icon={<CsvIcon />} items={exportItems} />
        <StatusExport open={exp} onClose={() => setExp(false)} list={mine} contracts={con.rows} branchOf={branchOf} scope={branch} />
      </div>
      <MetricGrid items={kpis} />
      {canSalesTax(user) && <CompanyStrip month={now} range={rng} branch={branch} monthLabel={curLabel} />}
      {/* อายุลูกหนี้ (ชุดเดียวกับหน้าใบแจ้งหนี้และใบเสร็จ) · ไว้ใต้ตัวเลขหลัก เพราะเป็นงานที่ต้องตาม */}
      {open.length ? <Receivables list={list} branchOf={branchOf} branchInfo={branchInfo} by={user?.name} />
        : <Section title="ลูกหนี้ค้างชำระตามอายุหนี้"><p className="rounded-xl bg-cream-50 px-4 py-6 text-center text-sm text-gold-600">{meta.loaded ? "ไม่มีใบค้างชำระ" : "กำลังโหลด…"}</p></Section>}
      <SalesTargets month={now} branch={branch} list={all.filter((x) => x.status !== VOID)} contracts={con.rows} branchOf={branchOf} />
      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <Section title="ออกใบ กับ รับจริง 12 เดือน" sub="ยอดที่ออกใบแจ้งหนี้ เทียบกับเงินที่ได้รับจริงในแต่ละเดือน (หักใบลดหนี้แล้ว) · ชี้ที่เดือนเพื่อดูตัวเลข">
          {meta.loaded ? <PairBars data={months.map((m) => ({ label: monLabel(m), billed: billedSum(m), paid: paidIn(m) }))} goal={collectGoal} open={cut ? monLabel(now) : undefined} /> : <p className="text-sm text-gold-500">กำลังโหลด…</p>}
        </Section>
        <Section title={`ยอดออกใบ ${curLabel} แยกตามประเภท`} sub="ไม่นับใบที่ยกเลิกและใบรอตรวจสอบยอด (บาท)">
          <ShareBars rows={byKind} />
        </Section>
      </div>
    </div>
  );
}
