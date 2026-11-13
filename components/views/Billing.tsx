"use client";
import { useEffect, useMemo, useState } from "react";
import CsvIcon from "@/components/CsvIcon";
import Icon from "../Icon";
import PhotoPicker from "../PhotoPicker";
import BillDoc, { Branch, DocFormat } from "../billing/BillDoc";
import { balanceOf, baseOfIncl, BILL_KINDS, contractLines, contractMeta, inclOf, creditOf, installmentsOf, splitInstallments, grandOf, BillItem, docDate, Invoice, isOpen, lineAmount, lineDiscount, money, PAID, PARTIAL, parseItems, Payment, todayIso, totals, UNPAID, DEFAULT_VAT, contractVat, DRAFT, lineNet, vatOf, VOID, contractMonthLines, invoiceBranch, isRoomLine, isCN, CN_KIND, CN_REFUND, validTaxId } from "@/lib/billing";
import { cycleDue, cycleNote, DUE_AHEAD, invoicePeriod, nextCycle, periodText, thDateText } from "@/lib/servicePeriod";
import { CONTRACTS, RESIDENTS } from "@/lib/mock";
import { newId, useCrud, useRecords, downloadCsv, refreshData } from "@/lib/store";
import { useApp } from "@/lib/app";
import { useSession } from "@/lib/session";
import { can } from "@/lib/perms";
import { staying } from "@/lib/rooms";
import { billHandoff, CourseBill, courseHandoff, invoiceHandoff } from "@/lib/handoff";
import StatusExport from "../billing/StatusExport";
import { invoiceDocsCsv } from "@/lib/exportsCsv";
import Receivables from "../billing/Receivables";
import { copyToClipboard, lineMessage } from "@/lib/lineMessage";
import { exportInvoiceLines, exportPayments, usePaidDays } from "@/lib/billingExport";
import { DataTable, Field, MenuButton, Modal, PageHeader, Section, StatFilter, StatusBadge, Tabs } from "../ui";
import { ResidentPicker } from "../SearchSelect";
import { courseOptText, fillFromCourse, lineCode, physioCourses, pickName, rateCode, rateText, roomPartByCode, rooms as priceRooms, searchPrices } from "@/lib/priceList";
import { ServicePicker } from "../ServicePicker";
import { usePriceList } from "@/lib/usePrices";
import { refreshTaxInfo, saveTaxInfo, useTaxInfo } from "@/lib/taxInfo";

const blankItem = (): BillItem => ({ desc: "", qty: 1, price: 0, discount: 0, pct: 0 });

/** ช่องชื่อรายการ: พิมพ์อย่างน้อย 2 ตัวแล้วขึ้นค่าบริการจากใบราคา กดราคาแล้วชื่อกับราคาลงให้ · ไม่มีในใบราคาพิมพ์เองได้ */
function LineDesc({ value, onText, onPick }: { value: string; onText: (v: string) => void; onPick: (desc: string, price: number, code: string) => void }) {
  const [open, setOpen] = useState(false);
  usePriceList();
  const list = open ? searchPrices(value, 8) : [];
  return (
    <div className="relative">
      <input value={value} placeholder="พิมพ์ 2 ตัวเพื่อค้นจากใบราคา หรือพิมพ์เอง" autoComplete="off" aria-label="รายการ"
        onChange={(e) => { onText(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }} />
      {list.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-72 w-full min-w-[320px] overflow-auto rounded-2xl border border-gold-200 bg-white shadow-lg">
          <p className="sticky top-0 border-b border-cream-200 bg-cream-50 px-4 py-2 text-xs text-gold-600">จากใบราคาของศูนย์ · กดราคาแล้วชื่อกับราคาลงให้เลย</p>
          {list.map((x) => (
            <div key={x.code} className="border-b border-cream-100 px-4 py-2.5 last:border-0">
              <p className="text-sm font-medium text-gold-800"><span className="pl-code mr-1.5">{x.code}</span>{x.name}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">{x.rates.map((r, k) => (
                <button key={k} type="button" className="rounded-lg border border-gold-300 bg-cream-50 px-2.5 py-1 text-xs font-medium text-gold-800 hover:border-gold-600 hover:bg-gold-100"
                  onMouseDown={(e) => { e.preventDefault(); onPick(pickName(x), r.price, rateCode(x, k)); setOpen(false); }}>{rateText(r)}</button>
              ))}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
const num = (x: string) => Number(String(x).replace(/,/g, "")) || 0;
/** เหตุผลที่ใช้บ่อยของใบลดหนี้ */
const CN_REASONS = ["คิดค่าบริการเกิน", "กลับบ้านก่อนกำหนด คืนค่าบริการส่วนที่ไม่ได้อยู่", "ให้ส่วนลดเพิ่มภายหลัง", "คิดรายการซ้ำ", "อื่น ๆ"];
const val = (x?: string) => num(x && x !== "-" ? x : "");

/** ใบที่ยังชำระไม่ครบ: ค้างมากี่วันนับจากวันที่ออกใบ (ต่อท้ายป้ายสถานะ "ค้างชำระ · 3 วัน") · เกิน 30 วัน = สีแดง */
const overdueDays = (x: Invoice) => (isOpen(x) ? Math.max(0, Math.floor((new Date(todayIso()).getTime() - new Date(x.date).getTime()) / 864e5)) : -1);
/** ชื่อประเภทใบแบบสั้นในตาราง (ค่าที่เก็บในระบบไม่เปลี่ยน) */
const kindShort = (k: string) => (k === "ค่าบริการรายเดือน" ? "รายเดือน" : k === "มัดจำ / แรกเข้า" ? "แรกเข้า" : /D\/C/.test(k) ? "จำหน่ายออก" : k === "เวชภัณฑ์และอื่น ๆ" ? "เวชภัณฑ์" : k);

// ค่าบริการต่อเดือนตามสัญญา (contractMonthLines) อยู่ที่ lib/billing ใช้ร่วมกับเอกสารพิมพ์สัญญา

/**
 * รายการใบแจ้งหนี้แรกเข้าจากสัญญา: ค่าบริการแจกแจง หักมัดจำห้องที่จ่ายตอนจอง (ที่บรรทัดค่าห้อง) · บวกเงินประกัน
 *  ยอด "ชำระล่วงหน้า" ใช้เมื่อสัญญาไม่มีรายการค่าบริการเลย
 */
export function contractStartLines(r: string[], prior: Invoice[] = []): BillItem[] {
  const prepaid = val(r[18]), deposit = val(r[19]), dep = roomDepositDue(r, prior);
  const months = prepaidMonths(r), pct = Math.min(100, Math.max(0, Math.floor(contractMeta(r).prepaidPct ?? 0)));
  // ล่วงหน้าหลายเดือน: คูณจำนวนในแต่ละบรรทัด (VAT คิดตามยอดจริง) · ส่วนลดชำระล่วงหน้า (%) เฉพาะบรรทัดค่าห้อง
  const isRoomFee = (l: BillItem) => !!l.vat || isRoomLine(l.desc) || /^RM-/.test(lineCode(l));
  /** ส่วนลดค่าห้องลดเฉพาะค่าบริการห้องพัก (ไม่ลดค่าบริการทางการแพทย์ RM-MD) */
  const isRoomPart = (l: BillItem) => isRoomFee(l) && lineCode(l) !== "RM-MD";
  const r2 = (n: number) => Math.round(n * 100) / 100;
  /** ยอดรวม VAT ที่ตั้งใจเก็บของแต่ละบรรทัดค่าห้อง (ใช้เก็บเศษสตางค์จากการถอด VAT) */
  const want: number[] = [];
  const service = contractMonthLines(r).map((l, k) => {
    const off = pct && isRoomPart(l) ? pct : 0;
    if (months <= 1 && !off) return l;
    const desc = months > 1 ? `${l.desc} (ล่วงหน้า ${months} เดือน)` : l.desc;
    if (isRoomFee(l)) { const f = r2((l.vat ? inclOf(lineNet(l), l.vat) : lineNet(l)) * months); want[k] = off ? r2((f * (100 - off)) / 100) : f; }
    if (!l.vat && !off) return { ...l, qty: l.qty * months, desc };
    // บรรทัดที่มี VAT / มีส่วนลด: คิดจากราคารวม VAT ต่อเดือน × จำนวนเดือน (− ส่วนลด %) แล้วถอด VAT กลับ
    //  ยอดรวม VAT ตรงกับราคาที่ตกลง (เช่น 40,000 × 3 − 10% = 108,000.00) ไม่มีเศษสตางค์จากการปัด VAT ทีละเดือน
    const rate = l.vat ?? 0, full = r2(inclOf(lineNet(l), rate) * months), gross = baseOfIncl(full, rate);
    const net = off ? baseOfIncl(r2((full * (100 - off)) / 100), rate) : gross;
    return { ...l, qty: 1, price: gross, discount: r2(gross - net), pct: 0, desc: off ? `${desc} · ส่วนลดค่าห้อง ${off}%` : desc };
  });
  // ส่วนลดค่าห้องเป็นบาท (รวม VAT): ลดเฉพาะค่าบริการห้องพัก (มี VAT · ถอด VAT จากยอดที่เหลือ)
  let rest = !pct ? Math.max(0, Math.floor(contractMeta(r).prepaidOff ?? 0)) : 0, noted = false;
  if (rest > 0) for (const k of service.map((l, k) => ({ l, k })).filter(({ l }) => isRoomPart(l)).map(({ k }) => k)) {
    if (rest <= 0) break;
    const l = service[k], rate = l.vat ?? 0, net = lineNet(l), incl = rate ? inclOf(net, rate) : net, cut = Math.min(rest, incl);
    const left = rate ? baseOfIncl(r2(incl - cut), rate) : r2(net - cut);
    service[k] = { ...l, discount: r2((l.discount ?? 0) + net - left), desc: noted ? l.desc : `${l.desc} · ส่วนลดค่าห้อง ${money(Math.max(0, Math.floor(contractMeta(r).prepaidOff ?? 0)))} บาท` };
    if (want[k] !== undefined) want[k] = r2(want[k] - cut);
    noted = true; rest = r2(rest - cut);
  }
  // เศษสตางค์: ค่าห้องรวม VAT บางยอด (เช่น 45,000) ถอด VAT แล้วบวกกลับไม่ได้ยอดเดิมพอดี · เอาส่วนต่าง ±0.0x ไปไว้ที่ค่าบริการทางการแพทย์ (ไม่มี VAT)
  if (months > 1 || pct || noted) {
    const idx = service.map((_, k) => k).filter((k) => want[k] !== undefined);
    const byRate: Record<number, number> = {};
    let got = 0;
    for (const k of idx) { const l = service[k], net = lineNet(l); got += net; if (l.vat) byRate[l.vat] = (byRate[l.vat] ?? 0) + net; }
    got += Object.entries(byRate).reduce((n, [rate, b]) => n + r2((b * Number(rate)) / 100), 0);
    const diff = r2(idx.reduce((n, k) => n + want[k], 0) - got), md = idx.find((k) => !service[k].vat && lineCode(service[k]) === "RM-MD");
    if (diff && md !== undefined && Math.abs(diff) < 1) { const l = service[md]; service[md] = { ...l, qty: 1, price: r2(l.qty * l.price + diff) }; }
  }
  if (!service.length && prepaid) service.push({ desc: "ชำระค่าบริการล่วงหน้า", qty: 1, price: prepaid, discount: 0 });
  return [
    ...service,
    ...(deposit ? [{ desc: "เงินประกัน", qty: 1, price: deposit, discount: 0, code: "DP-01" }] : []),
    // มัดจำห้องที่จ่ายตอนจอง = เงินที่รับไว้แล้ว หักหลังรวม VAT (VAT ค่าห้องคิดจากราคาเต็ม)
    ...(dep ? [{ desc: ROOM_DEP_DESC, qty: 1, price: dep, discount: 0, credit: true, code: "AD-01" }] : []),
  ];
}
const ROOM_DEP_DESC = "หัก มัดจำห้องพักที่ชำระตอนจอง";
/**
 * มัดจำห้องที่ต้องหักในใบแรกเข้า · 0 = ไม่ต้องหัก
 *  ต่อสัญญาคัดลอกยอดมัดจำห้องมาที่สัญญาใหม่ด้วย: ถ้าเคยหักมัดจำก้อนเดียวกัน (AD-01 ยอดเท่ากัน) ในใบที่ไม่ยกเลิกของผู้รับบริการคนนี้แล้ว ไม่หักซ้ำ
 *  prior = ใบแจ้งหนี้ของสาขาเดียวกับสัญญา (ผู้เรียกกรองสาขาให้)
 */
export function roomDepositDue(r: string[], prior: Invoice[] = []) {
  const dep = val(r[27]);
  if (!dep) return 0;
  const used = prior.some((x) => x.status !== VOID && x.who === r[2] && parseItems(x.items).some((i) => i.credit && lineCode(i) === "AD-01" && Math.abs(lineAmount(i) - dep) < 0.005));
  return used ? 0 : dep;
}

/** ใบแรกเข้าของสัญญา (ออกจาก contractStartLines): ประเภทมัดจำ/แรกเข้า หรือมีเงินประกัน ค่าบริการล่วงหน้า หักมัดจำห้องตอนจอง */
export function isStartInvoice(x: Invoice, items?: BillItem[]) {
  const its = items ?? parseItems(x.items);
  // ใบมัดจำห้องตอนจอง (มีแต่บรรทัดมัดจำห้อง DP-02) ไม่ใช่ใบแรกเข้า: ยังไม่ได้เรียกเก็บค่าบริการเดือนแรก · ชำระแล้วยังไม่เริ่มสัญญา
  if (isBookingInvoice(its)) return false;
  if (x.kind === BILL_KINDS[0]) return true;
  if (x.kind === BILL_KINDS[5]) return false;
  return its.some((i) => { const d = i.desc.trim(); return (!i.credit && lineCode(i) === "DP-01") || d === ROOM_DEP_DESC || /\(ล่วงหน้า \d+ เดือน\)$|^ชำระค่าบริการล่วงหน้า/.test(d); });
}
/** ใบมัดจำค่าห้องตอนจอง: ทุกบรรทัดเป็นมัดจำห้องพัก (DP-02) */
export const isBookingInvoice = (items: BillItem[]) => { const sale = items.filter((i) => !i.credit && i.desc.trim()); return sale.length > 0 && sale.every((i) => lineCode(i) === "DP-02"); };
/** ยอดมัดจำห้องที่รับชำระแล้วของสัญญา (ใบมัดจำตอนจองที่ชำระครบ) · ใช้หักในใบแรกเข้าตอนเปิดสัญญาเต็ม */
export function bookingPaid(c: string[], invoices: Invoice[]) {
  return invoices.filter((x) => x.status === PAID && (c[0] ? x.contract === c[0] : x.who === c[2]) && isBookingInvoice(parseItems(x.items)))
    .reduce((n, x) => n + x.net, 0);
}
/** ใบมัดจำห้องล่าสุดของสัญญา (ไม่นับใบที่ยกเลิก) */
export const bookingInvoiceOf = (c: string[], invoices: Invoice[]) =>
  invoices.filter((x) => x.status !== VOID && (c[0] ? x.contract === c[0] : x.who === c[2]) && isBookingInvoice(parseItems(x.items))).sort((a, b) => b.date.localeCompare(a.date))[0];
const baseDesc = (d: string) => d.replace(/\s*\(ล่วงหน้า \d+ เดือน\)$/, "").trim();
/**
 * ใบนี้มีบรรทัดค่าห้อง / ค่าบริการรายเดือนตามสัญญาหรือไม่ (ดูจากบรรทัด ไม่ดูประเภทใบ เพราะประเภทใบแก้ได้)
 *  รหัส RM-* · ชื่อมีคำว่าห้อง (ไม่ใช่ยา เวชภัณฑ์ มัดจำ) · ชื่อตรงกับรายการรายเดือนของสัญญา c
 */
export function hasMonthLine(items: BillItem[], c?: string[]) {
  return hasMonthLineOf(items, c ? monthDescs(c) : null);
}
/** ชื่อรายการรายเดือนของสัญญา (ไม่มีวงเล็บล่วงหน้า) */
const monthDescs = (c: string[]) => new Set(contractMonthLines(c).map((l) => baseDesc(l.desc)));
function hasMonthLineOf(items: BillItem[], own: Set<string> | null) {
  return items.some((i) => {
    const d = i.desc.trim();
    if (i.credit || !(i.price > 0) || !d) return false;
    return /^RM-/.test(lineCode(i)) || (isRoomLine(d) && !/^(ยา|เวชภัณฑ์):|มัดจำ/.test(d)) || !!own?.has(baseDesc(d));
  });
}
/** วันเริ่มสัญญา (วว/ดด/ปปปป พ.ศ. หรือ YYYY-MM-DD) → "YYYY-MM" · ไม่มี = "" */
export function contractStartMonth(r: string[]) {
  const s = String(r[7] ?? "").trim();
  const iso = s.match(/^(\d{4})-(\d{2})/), th = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  const ce = (y: number) => (y > 2400 ? y - 543 : y);
  if (iso) return `${ce(Number(iso[1]))}-${iso[2]}`;
  if (th) return `${ce(Number(th[3]))}-${th[2].padStart(2, "0")}`;
  return "";
}
const addMonths = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7); };
/**
 * เดือน month ("YYYY-MM") ของสัญญา c เรียกเก็บแล้วหรือยัง (ใช้ตัดสิน "ครบรอบบิล" / "ออกใบเดือนนี้")
 *  (ก) ใบแรกเข้าที่ไม่ยกเลิกของสัญญานี้ ครอบคลุมเดือนเริ่มสัญญาถึงเดือนเริ่ม + จำนวนเดือนที่ชำระล่วงหน้า − 1 (ออกใบก่อนเดือนเริ่ม = นับเดือนที่ออกใบด้วย)
 *  (ข) ใบที่ไม่ยกเลิกของสัญญานี้ ลงวันที่ในเดือนนั้น ที่มีบรรทัดค่าห้อง/ค่าบริการรายเดือนตามสัญญา (หรือประเภทค่าบริการรายเดือน)
 *  ใบรอตรวจสอบยอดนับว่าออกแล้ว
 */
export function contractBilledFor(c: string[], month: string, invoices: Invoice[] | BilledIndex) {
  if (!c[0]) return false;
  const list = (Array.isArray(invoices) ? buildBilledIndex(invoices) : invoices).get(c[0]);
  if (!list?.length) return false;
  const start = contractStartMonth(c), months = prepaidMonths(c);
  let own: Set<string> | null = null; // รายการรายเดือนของสัญญา คำนวณครั้งเดียวเมื่อต้องใช้
  return list.some(({ x, items, isStart }) => {
    const d = (x.date ?? "").slice(0, 7);
    if (isStart) {
      const s = start || d, from = d && d < s ? d : s;
      if (from && month >= from && month <= addMonths(s, months - 1)) return true;
    }
    return d === month && (x.kind === BILL_KINDS[1] || hasMonthLineOf(items, own ??= monthDescs(c)));
  });
}
/** ใบที่ไม่ยกเลิก จัดกลุ่มตามเลขที่สัญญา พร้อมรายการที่แยกแล้ว (สร้างครั้งเดียวต่อรายการใบ ใช้กับ contractBilledFor หลายสัญญา) */
export type BilledIndex = Map<string, { x: Invoice; items: BillItem[]; isStart: boolean }[]>;
/** ใบที่เรียกเก็บค่าบริการเดือน month ของสัญญา c (เงื่อนไขเดียวกับ contractBilledFor) · ไม่พบ = undefined */
export function contractInvoiceFor(c: string[], month: string, invoices: Invoice[]) {
  const list = buildBilledIndex(invoices).get(c[0]);
  if (!list?.length) return undefined;
  const start = contractStartMonth(c), months = prepaidMonths(c), own = monthDescs(c);
  return list.find(({ x, items, isStart }) => {
    const d = (x.date ?? "").slice(0, 7);
    if (isStart) { const st = start || d, from = d && d < st ? d : st; if (from && month >= from && month <= addMonths(st, months - 1)) return true; }
    return d === month && (x.kind === BILL_KINDS[1] || hasMonthLineOf(items, own));
  })?.x;
}
/** วันเริ่มสัญญา → YYYY-MM-DD · ไม่มี = "" */
const contractStartIso = (r: string[]) => {
  const t = String(r[7] ?? "").trim(), iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/), th = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (iso) return `${Number(iso[1]) > 2400 ? Number(iso[1]) - 543 : iso[1]}-${iso[2]}-${iso[3]}`;
  if (th) return `${Number(th[3]) > 2400 ? Number(th[3]) - 543 : th[3]}-${th[2].padStart(2, "0")}-${th[1].padStart(2, "0")}`;
  return "";
};
export function buildBilledIndex(invoices: Invoice[]): BilledIndex {
  const m: BilledIndex = new Map();
  for (const x of invoices) {
    if (!x.contract || x.status === VOID || isCN(x)) continue;
    const items = parseItems(x.items);
    const g = m.get(x.contract) ?? [];
    if (!g.length) m.set(x.contract, g);
    g.push({ x, items, isStart: isStartInvoice(x, items) });
  }
  return m;
}
/** ค่าบริการต่อเดือนตามสัญญา (รวม VAT) */
export const contractMonthTotal = (r: string[]) => totals(contractMonthLines(r)).net;
/** จำนวนเดือนที่ชำระล่วงหน้า: ยอดล่วงหน้าในสัญญา ÷ ค่าบริการต่อเดือน (ระบบคำนวณยอดจากจำนวนเดือนตอนเปิดสัญญา) · ไม่ระบุ = 1 เดือน */
export function prepaidMonths(r: string[]) {
  const prepaid = val(r[18]), m = contractMonthTotal(r);
  return prepaid && m ? Math.min(12, Math.max(1, Math.round(prepaid / m))) : 1;
}

/** หมายเหตุใบแจ้งหนี้แรกเข้า: มัดจำห้องที่หักแล้ว และยอดชำระล่วงหน้าที่ตกลงในสัญญา */
export function contractStartNote(r: string[], prior: Invoice[] = []): string {
  const prepaid = val(r[18]), dep = roomDepositDue(r, prior), months = prepaidMonths(r), m = contractMeta(r);
  const pct = Math.floor(m.prepaidPct ?? 0), n = Math.floor(m.installments ?? 1), off = !pct ? Math.floor(m.prepaidOff ?? 0) : 0;
  return [prepaid && contractMonthLines(r).length ? `ชำระค่าบริการล่วงหน้า ${months} เดือน` : "", pct ? `ลดค่าบริการห้องพัก ${pct}%` : off ? `ลดค่าบริการห้องพัก ${money(off)} บาท` : "", dep ? `หักมัดจำห้องพักที่ชำระตอนจอง ${money(dep)} บาท` : "", n > 1 ? `แบ่งชำระ ${n} งวด` : ""].filter(Boolean).join(" · ");
}

/** ข้อมูลหัวกระดาษของสาขา จากหน้า "ข้อมูลสาขา" (แถว: รหัส, ชื่อ, นิติบุคคล, โทร, ที่อยู่, ...) */
export function useBranchInfo() {
  const { rows } = useCrud("branches", []);
  const tax = useTaxInfo();
  return (name: string): Branch => {
    const r = rows.find((x) => x[1] === name);
    return { name, legal: r?.[2] && r[2] !== "-" ? r[2] : "", address: r?.[4] && r[4] !== "-" ? r[4] : "", phone: r?.[3] && r[3] !== "-" ? r[3] : "", taxId: tax[name]?.taxId ?? "", office: tax[name]?.office ?? "" };
  };
}

/** หน้าใบแจ้งหนี้และใบเสร็จ: ออกใบแจ้งหนี้ รับชำระ (เป็นใบเสร็จ) แนบหลักฐานการโอน และพิมพ์ตามแบบของศูนย์ */
export function Billing() {
  const { user } = useSession();
  const admin = can(user, "invoices.void");
  const [list, setList, meta] = useRecords<Invoice>("invoices", []);
  const res = useCrud("residents", RESIDENTS);
  const con = useCrud("contracts", CONTRACTS);
  const branchInfo = useBranchInfo();
  const { confirm, toast } = useApp();
  const [tab, setTab] = useState("ทั้งหมด");
  const [form, setForm] = useState<Invoice | null>(null);
  const [lines, setLines] = useState<BillItem[]>([blankItem()]);
  /** อัตรา VAT ของใบที่กำลังออก (%) · ใช้กับบรรทัดที่ติ๊ก VAT */
  const [vatRate, setVatRate] = useState(DEFAULT_VAT);
  const [pay, setPay] = useState<Invoice | null>(null);
  const [amt, setAmt] = useState({ cash: "", credit: "", transfer: "", wht: "", date: todayIso(), tref: "" });
  /** ใบลดหนี้: ใบเดิม ยอด เหตุผล · คืนเงินตามใบลดหนี้: วิธีคืน */
  const [cn, setCn] = useState<{ x: Invoice; amount: string; reason: string; other: string; busy?: boolean } | null>(null);
  const [refund, setRefund] = useState<{ x: Invoice; method: string; busy?: boolean } | null>(null);
  const [slip, setSlip] = useState("");
  const [view, setView] = useState<Invoice | null>(null);
  /**
   * ตัวอย่างใบเสร็จที่ชำระแล้ว ห้องละ 1 ใบ จากราคาห้องในใบราคา (ค่าห้องรวม VAT + ค่าบริการทางการแพทย์)
   *  สร้างในหน้าจอเท่านั้น ไม่บันทึกลงระบบ (ไม่เข้ายอดรับเงินหรือรายงาน) · เลขที่เอกสารขึ้นต้นด้วย "ตัวอย่าง"
   */
  const [sampleOpen, setSampleOpen] = useState(false);
  const [sampleOf, setSampleOf] = useState<{ room: string; period: string } | null>(null);
  const openSample = (k: number) => {
    const x = priceRooms()[k]; if (!x) return;
    const part = x.part.เดือน, base = baseOfIncl(part, DEFAULT_VAT), med = Math.round((x.promo - part) * 100) / 100, t = todayIso();
    const items: BillItem[] = [{ desc: `ค่า${x.name}`, qty: 1, price: base, discount: 0, vat: DEFAULT_VAT, code: `${x.code}-MP` }, ...(med > 0 ? [{ desc: "ค่าบริการทางการแพทย์", qty: 1, price: med, discount: 0, code: "RM-MD" }] : [])];
    const end = new Date(Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1 + 1, Number(t.slice(8, 10)) - 1)).toISOString().slice(0, 10);
    setSampleOf({ room: "ตัวอย่าง", period: periodText({ from: t, to: end }) });
    setSampleOpen(false); setFormat("customer"); setCopy(false); setWhich(0);
    setView({ id: `sample-${k}`, no: `ตัวอย่าง-${x.code}`, date: t, who: "คุณตัวอย่าง ผู้รับบริการ", hn: "-", payer: "คุณตัวอย่าง ผู้ชำระ", address: "-", kind: BILL_KINDS[1], contract: "",
      items: JSON.stringify(items), ...totals(items), net: x.promo, status: PAID, paid: x.promo, cash: x.promo, credit: 0, transfer: 0, paidDate: t, cashier: user?.name ?? "", note: "ใบตัวอย่าง ไม่ได้บันทึกในระบบ" });
  };
  // เปิดเอกสารทุกครั้ง โหลดข้อมูลผู้เสียภาษีล่าสุด (ค่าที่เพิ่งตั้งจากเครื่องอื่นขึ้นทันทีโดยไม่ต้องรีเฟรชหน้า)
  const viewId = view?.id;
  useEffect(() => { if (viewId) refreshTaxInfo(); }, [viewId]);
  const [format, setFormat] = useState<DocFormat>("customer");
  const [copy, setCopy] = useState(false);
  /** ตั้งข้อมูลผู้ขายในใบกำกับภาษีของสาขา (ผู้จัดการสาขา / ผู้บริหาร) */
  const [taxDlg, setTaxDlg] = useState<{ branch: string; taxId: string; office: string; hq: boolean } | null>(null);
  const canTax = user?.role === "Global Admin" || user?.role === "Branch Admin";
  const [pays, setPays] = useState<Payment[]>([]);
  const [which, setWhich] = useState(0); // 0 = ใบรวม, n = ใบรับเงินงวดที่ n
  const [busy, setBusy] = useState(false);
  // เปิดดู/พิมพ์เอกสารที่ส่งมาจากหน้าอื่น (เช่น ใบเสร็จที่รับชำระตอนเปิดสัญญา) · รอรายการโหลดก่อน
  const [viewFor, setViewFor] = useState(() => invoiceHandoff.take());
  useEffect(() => {
    if (!viewFor) return;
    const x = list.find((y) => y.id === viewFor);
    if (x) { setViewFor(null); setFormat("customer"); setCopy(false); setView(x); }
  }, [viewFor, list]); // eslint-disable-line react-hooks/exhaustive-deps
  /** ส่งออก CSV แยกค้างชำระ / ชำระครบ ตามช่วงวัน (components/billing/StatusExport) */
  const [exp, setExp] = useState(false);

  const shown = list.filter((x) => tab === "ทั้งหมด" || (tab === CN_KIND ? isCN(x) : tab === UNPAID ? isOpen(x) : x.status === tab));
  const month = todayIso().slice(0, 7);
  const unpaid = list.filter(isOpen);
  // รับชำระเดือนนี้ = ยอดเงินที่รับจริงในเดือนนี้ รวมจากการรับเงินแต่ละงวด (วันที่รับของงวดนั้น)
  //  ยังโหลดยอดรายงวดไม่ได้: ประมาณจากยอดชำระสะสมของใบที่รับล่าสุดเดือนนี้ (แบบเดิม)
  const paidDays = usePaidDays(`${month}-01`, meta.loaded ? list.reduce((n, x) => n + (x.paid ?? 0), 0) : undefined);
  const paidMonthSum = paidDays ? paidDays.filter((p) => p.date.startsWith(month)).reduce((n, p) => n + p.amount, 0)
    : list.filter((x) => (x.status === PAID || x.status === PARTIAL) && (x.paidDate ?? "").startsWith(month)).reduce((n, x) => n + (x.paid ?? 0), 0);
  const people = res.rows.filter((r) => staying(r[5] ?? ""));
  /** ครบรอบบิล: สัญญาใช้งานอยู่ที่รอบถัดไป (นับตามวันเริ่มสัญญาและเดือนที่ชำระล่วงหน้าแล้ว) เริ่มแล้วหรือจะเริ่มภายใน 7 วัน · ตัวเดียวกับแถบต้องจัดการ */
  const due = useMemo(() => con.rows.map((c, i) => ({ c, id: con.ids[i], next: c[5] === "ใช้งานอยู่" ? nextCycle(c, list) : null }))
    .filter((d): d is { c: string[]; id: string; next: string } => cycleDue(d.next)).sort((a, b) => a.next.localeCompare(b.next)), [con.rows, con.ids, list]);
  const makeDue = () => confirm({
    title: "สร้างใบค่าบริการเดือนนี้", okLabel: `สร้าง ${due.length} ใบ`,
    message: `สร้างใบแจ้งหนี้ค่าบริการรายเดือนตามสัญญา ${due.length} ใบ เป็นสถานะ "${DRAFT}" · ตรวจรายการแต่ละใบ (เช่น ค่ายา เวชภัณฑ์เพิ่ม) แล้วกด ยืนยันยอด ก่อนรับชำระ`,
    onOk: () => {
      const made = due.map(({ c, next }) => {
        const items = contractMonthLines(c), p = res.rows.find((r) => r[0] === c[2] && r[3] === c[1]);
        return { id: newId(), date: todayIso(), who: c[2], hn: p?.[6] ?? "", payer: c[3] ?? "", address: c[10] ?? "", kind: BILL_KINDS[1], contract: c[0], items: JSON.stringify(items), ...totals(items), status: DRAFT, note: cycleNote(next) };
      }).filter((x) => x.net > 0);
      if (!made.length) return toast("สัญญาที่ครบรอบไม่มีรายการค่าบริการ");
      setList([...made, ...list]); setTab(DRAFT);
      toast(`สร้างใบรอตรวจสอบยอดแล้ว ${made.length} ใบ · ตรวจแล้วกด ยืนยันยอด`);
    },
  });
  /** ผู้ที่ชำระค่าบริการเดือนนี้ครบแล้ว (ใบแรกเข้า / รายเดือน ลงวันที่เดือนนี้) · ไม่ให้เลือกออกใบแจ้งหนี้ซ้ำ เดือนถัดไปกลับมาเลือกได้ */
  const paidNow = new Set(list.filter((x) => x.status === PAID && x.date.startsWith(month) && (isStartInvoice(x) || x.kind === BILL_KINDS[1] || hasMonthLine(parseItems(x.items)))).map((x) => x.who));
  const billable = people.filter((r) => !paidNow.has(r[0]));
  const residentOf = (name: string) => res.rows.find((r) => r[0] === name);
  /** สัญญาล่าสุดของผู้รับบริการ (ผู้ว่าจ้าง ที่อยู่ เลขที่สัญญา) */
  const contractOf = (name: string) => con.rows.find((r) => r[2] === name && r[5] !== "สิ้นสุดสัญญา") ?? con.rows.find((r) => r[2] === name);
  /** สาขาของใบ (ใบไม่มีสาขาฝั่งหน้าจอ): จากสัญญา หรือผู้รับบริการ */
  const invBranch = (x: Invoice) => invoiceBranch(x, con.rows, res.rows, user?.branch);

  // มาจากปุ่ม "ออกใบแจ้งหนี้" ในทะเบียนสัญญา · รอข้อมูลสัญญาโหลดก่อนเปิดฟอร์ม
  const [billFor, setBillFor] = useState<{ id: string; dc?: boolean; date?: string } | null>(null);
  /** ใบสรุปก่อนกลับบ้าน: สัญญาและวันที่ D/C (คิดค่าบริการเดือนสุดท้าย) · mode: actual = ตามวันที่อยู่จริง · full = เต็มเดือน ไม่คืน */
  const [dcCtx, setDcCtx] = useState<{ c: string[]; date: string; mode: "actual" | "full"; added?: boolean } | null>(null);
  useEffect(() => { const h = billHandoff.take(); if (h) setBillFor(h); }, []);
  useEffect(() => {
    if (!billFor) return;
    const k = con.ids.indexOf(billFor.id);
    if (k < 0) return;
    setBillFor(null);
    const c = con.rows[k], p = res.rows.find((r) => r[0] === c[2] && r[3] === c[1]);
    if (billFor.dc) {
      setDcCtx({ c, date: billFor.date || todayIso(), mode: "actual" });
      // ใบสรุปค่าใช้จ่ายก่อนกลับบ้าน: เริ่มจากใบว่าง แล้วดึงยา เวชภัณฑ์ คอร์สกายภาพที่ยังไม่เรียกเก็บเข้าใบให้เอง
      setForm({ id: newId(), date: todayIso(), who: c[2], hn: p?.[6] ?? "", payer: c[3] ?? "", address: c[10] ?? "", kind: BILL_KINDS[5], contract: c[0] ?? "", items: "[]", total: 0, discount: 0, net: 0, status: UNPAID, note: "สรุปค่าใช้จ่ายก่อนกลับบ้าน" });
      setLines([blankItem()]); setVatRate(contractVat(c) || DEFAULT_VAT);
      setAutoPull(true); loadUnbilled(c[2]);
      return;
    }
    // สัญญาใช้งานอยู่ที่ออกใบแรกเข้าแล้ว = ใบค่าบริการรายเดือน (ไม่มีเงินประกัน ค่าล่วงหน้า หักมัดจำ) · ยังไม่มีใบแรกเข้า = ใบแรกเข้า
    const monthly = c[5] === "ใช้งานอยู่" && list.some((x) => x.contract === c[0] && x.status !== VOID && isStartInvoice(x));
    const prior = list.filter((x) => invBranch(x) === c[1]);
    const items = monthly ? contractMonthLines(c) : contractStartLines(c, prior);
    setForm({ id: newId(), date: todayIso(), who: c[2], hn: p?.[6] ?? "", payer: c[3] ?? "", address: c[10] ?? "", kind: monthly ? BILL_KINDS[1] : BILL_KINDS[0], contract: c[0] ?? "", items: "[]", total: 0, discount: 0, net: 0, status: UNPAID,
      note: monthly ? cycleNote(nextCycle(c, list) ?? todayIso()) : contractStartNote(c, prior) });
    setLines(items.length ? items : [blankItem()]); setVatRate(contractVat(c) || DEFAULT_VAT);
    loadUnbilled(c[2]);
  }, [billFor, con.ids, con.rows, res.rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const startNew = () => {
    setForm({ id: newId(), date: todayIso(), who: "", hn: "", payer: "", address: "", kind: BILL_KINDS[1], contract: "", items: "[]", total: 0, discount: 0, net: 0, status: UNPAID, note: "" });
    setLines([blankItem()]); setVatRate(DEFAULT_VAT);
  };
  // เวชภัณฑ์ที่เบิกแล้วยังไม่เรียกเก็บ ของผู้รับบริการที่เลือก (ดึงเข้าใบแจ้งหนี้ได้ในคลิกเดียว)
  const [unbilled, setUnbilled] = useState<{ id: string; item_name: string; unit: string; qty: number; price: number; at: string; course?: boolean; med?: boolean; session?: boolean }[]>([]);
  const [pulled, setPulled] = useState<string[]>([]);
  const loadUnbilled = (name: string, pre: string[] = []) => {
    setUnbilled([]); setPulled(pre);
    const k = res.rows.findIndex((r) => r[0] === name);
    if (k < 0) return;
    fetch(`/api/clinic?op=unbilled&resident=${encodeURIComponent(res.ids[k])}`).then((r) => (r.ok ? r.json() : { items: [] })).then((d) => setUnbilled([...(d.meds ?? []).map((m: { id: string; name: string; unit: string; qty: number; price: number; at: string }) => ({ id: m.id, item_name: m.name, unit: m.unit, qty: m.qty, price: m.price, at: m.at, med: true })), ...(d.courses ?? []).map((c: { id: string; name: string; total: number; price: number; at: string }) => ({ id: c.id, item_name: `คอร์ส${c.name.startsWith("กายภาพ") ? "" : "กายภาพ "}${c.name} ${c.total} ครั้ง`, unit: "คอร์ส", qty: 1, price: c.price, at: c.at, course: true })), ...(d.items ?? []), ...(d.sessions ?? []).map((x: { id: string; at: string }) => ({ id: x.id, item_name: `กายภาพรายครั้ง (ยังไม่มีคอร์ส) ${x.at.slice(0, 10)}`, unit: "ครั้ง", qty: 1, price: 0, at: x.at, session: true }))])).catch(() => {});
  };
  // เปิดจาก D/C: รายการที่ยังไม่เรียกเก็บโหลดเสร็จแล้วดึงเข้าใบทันที
  const [autoPull, setAutoPull] = useState(false);
  useEffect(() => { if (autoPull && unbilled.length) { setAutoPull(false); pullSupplies(); } }, [autoPull, unbilled]); // eslint-disable-line react-hooks/exhaustive-deps
  const pullSupplies = () => {
    const add = unbilled.filter((x) => !pulled.includes(x.id));
    if (!add.length) return;
    setLines([...lines.filter((l) => l.desc.trim()), ...add.map((x) => ({ desc: x.course ? `${x.item_name} (ซื้อ ${x.at.slice(0, 10)})` : x.session ? x.item_name : x.med ? `ยา: ${x.item_name} ${x.qty} ${x.unit} (จ่าย ${x.at.slice(0, 10)})` : `เวชภัณฑ์: ${x.item_name} (เบิก ${x.at.slice(0, 10)})`, qty: x.qty, price: x.price, discount: 0 }))]);
    setPulled([...pulled, ...add.map((x) => x.id)]);
    // เปลี่ยนประเภทใบตามของที่ดึงเข้า เฉพาะใบว่างที่ยังเป็นค่าเริ่มต้น · ใบที่มีค่าห้อง/ค่าบริการรายเดือนตามสัญญาแล้วคงประเภทเดิม (ไม่งั้นเดือนนี้จะดูเหมือนยังไม่ได้เรียกเก็บ)
    const keep = hasMonthLine(lines, form?.contract ? con.rows.find((c) => c[0] === form.contract) : undefined);
    if (form && form.kind === BILL_KINDS[1] && !keep) setForm({ ...form, kind: (add.every((x) => x.course || x.session) ? BILL_KINDS.find((k) => k.startsWith("คอร์ส")) : BILL_KINDS.find((k) => k.startsWith("เวชภัณฑ์"))) ?? form.kind });
  };
  const pickResident = (name: string) => {
    if (!form) return;
    loadUnbilled(name);
    const r = residentOf(name), c = contractOf(name);
    setForm({ ...form, who: name, hn: r?.[6] ?? "", payer: c?.[3] ?? form.payer, address: c?.[10] ?? form.address, contract: c?.[0] ?? "" });
    if (c && lines.length === 1 && !lines[0].desc && form.kind === BILL_KINDS[1]) { const m = contractMonthLines(c); if (m.length) setLines(m); }
  };
  // ขายคอร์สกายภาพจากหน้าใบแจ้งหนี้และใบเสร็จ: สร้างคอร์ส (นักกายภาพตัดครั้งที่แท็บกายภาพ) แล้วเปิดใบแจ้งหนี้ที่ใส่คอร์สไว้ให้
  const [course, setCourse] = useState<{ who: string; name: string; total: string; price: string; busy: boolean; code?: string } | null>(null);
  const ptCourses = physioCourses();
  const saveCourse = async () => {
    if (!course || course.busy) return;
    const k = res.rows.findIndex((r) => r[0] === course.who);
    const name = course.name.trim(), total = Math.floor(num(course.total)), price = num(course.price);
    if (k < 0) return toast("กรุณาเลือกผู้รับบริการ");
    if (!name) return toast("กรุณากรอกชื่อคอร์ส");
    if (!(total > 0 && total <= 500)) return toast("กรุณากรอกจำนวนครั้ง 1–500 ครั้ง");
    if (!(price > 0)) return toast("กรุณากรอกราคาคอร์ส");
    setCourse({ ...course, busy: true });
    let id = "";
    try {
      const r = await fetch("/api/clinic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "course", residentId: res.ids[k], name, total, price, priceCode: course.code || undefined }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.id) throw new Error(d.error || "บันทึกคอร์สไม่สำเร็จ");
      id = d.id;
    } catch (e) {
      setCourse({ ...course, busy: false });
      return toast(e instanceof Error ? e.message : "บันทึกคอร์สไม่สำเร็จ");
    }
    setCourse(null);
    openCourseBill(k, id, name, total, price);
  };
  /** เปิดฟอร์มใบแจ้งหนี้ของคอร์สที่เพิ่งซื้อ (ผู้ชำระ/ที่อยู่จากสัญญา) · ใช้ทั้งปุ่มขายคอร์สหน้านี้ และการซื้อคอร์สจากโปรไฟล์ผู้รับบริการ */
  const openCourseBill = (k: number, id: string, name: string, total: number, price: number) => {
    const p = res.rows[k], who = p[0], c = contractOf(who);
    setForm({ id: newId(), date: todayIso(), who, hn: p[6] ?? "", payer: c?.[3] ?? "", address: c?.[10] ?? "", kind: BILL_KINDS.find((x) => x.startsWith("คอร์ส")) ?? BILL_KINDS[1], contract: c?.[0] ?? "", items: "[]", total: 0, discount: 0, net: 0, status: UNPAID, note: "" });
    setLines([{ desc: `คอร์ส${name.startsWith("กายภาพ") ? "" : "กายภาพ "}${name} ${total} ครั้ง`, qty: 1, price, discount: 0 }]);
    loadUnbilled(who, [id]);
    toast(`บันทึกคอร์สแล้ว · ${name} ${total} ครั้ง · ${who} · ตรวจผู้ชำระ ส่วนลด เลขผู้เสียภาษี แล้วกดบันทึกใบแจ้งหนี้`);
  };
  // ซื้อคอร์สจากโปรไฟล์ผู้รับบริการ → เปิดใบแจ้งหนี้ให้ทันทีเมื่อรายชื่อผู้รับบริการโหลดแล้ว
  const [courseFor, setCourseFor] = useState<CourseBill | null>(() => courseHandoff.take());
  useEffect(() => {
    if (!courseFor || !res.loaded || !con.loaded) return;
    const k = res.ids.indexOf(courseFor.residentId);
    if (k < 0) { setCourseFor(null); return toast("บันทึกคอร์สแล้ว · ไม่พบผู้รับบริการในสาขานี้ · ออกใบแจ้งหนี้จากปุ่มสร้างใบแจ้งหนี้"); }
    setCourseFor(null);
    openCourseBill(k, courseFor.courseId, courseFor.name, courseFor.total, courseFor.price);
  }, [courseFor, res.loaded, con.loaded, res.ids]); // eslint-disable-line react-hooks/exhaustive-deps
  const sum = totals(lines.filter((l) => l.desc.trim()));
  const vatSum = vatOf(lines.filter((l) => l.desc.trim()));
  const saveNew = () => {
    if (!form) return;
    const items = lines.filter((l) => l.desc.trim());
    if (!form.who) return toast("กรุณาเลือกผู้รับบริการ");
    if (!form.payer.trim()) return toast("กรุณากรอกชื่อผู้ชำระ");
    if (form.payerTaxId?.replace(/\D/g, "") && !validTaxId(form.payerTaxId)) return toast("เลขผู้เสียภาษีของผู้ชำระไม่ถูกต้อง · ตรวจว่าครบ 13 หลัก");
    if (!items.length) return toast("กรุณาเพิ่มรายการอย่างน้อย 1 รายการ");
    if (items.some((l) => l.desc.includes("(ยังไม่มีราคา)") && !(l.price > 0))) return toast("กรุณากรอกราคายาที่ยังไม่มีราคาขาย");
    if (items.some((l) => l.desc.startsWith("กายภาพรายครั้ง") && !(l.price > 0))) return toast("กรุณากรอกราคากายภาพรายครั้ง (ยังไม่มีคอร์ส)");
    if (items.some((l) => l.qty <= 0 || l.price < 0 || l.discount < 0 || (l.pct ?? 0) < 0 || (l.pct ?? 0) > 100 || lineDiscount(l) > l.qty * l.price)) return toast("กรุณาตรวจจำนวน ราคา และส่วนลดของแต่ละรายการ");
    setList([{ ...form, items: JSON.stringify(items), ...totals(items) }, ...list]);
    // เวชภัณฑ์ที่ดึงเข้าใบนี้: ทำเครื่องหมายว่าเรียกเก็บแล้ว (ไม่ดึงซ้ำในใบถัดไป)
    if (pulled.length) fetch("/api/clinic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "supply_bill", ids: pulled.filter((id) => { const x = unbilled.find((y) => y.id === id); return x && !x.course && !x.med && !x.session; }), noteIds: pulled.filter((id) => unbilled.find((x) => x.id === id)?.session), medIds: pulled.filter((id) => unbilled.find((x) => x.id === id)?.med), courseIds: pulled.filter((id) => unbilled.find((x) => x.id === id)?.course), invoiceId: form.id }) }).catch(() => {});
    setForm(null); setTab(UNPAID);
    toast(`ออกใบแจ้งหนี้แล้ว · ${form.who} · ${money(totals(items).net)} บาท · ระบบออกเลขที่เอกสารให้`);
  };

  /**
   * ยกเลิกเอกสาร: ส่งตรงไปที่ server แล้วรอผล (ไม่บันทึกล่วงหน้าในหน้าจอ) เพื่อแจ้งเหตุผลได้ถ้า server ไม่ยอม
   *  เช่น อีกเครื่องเพิ่งรับชำระใบนี้ · server คืนยา เวชภัณฑ์ คอร์สกายภาพที่ผูกกับใบนี้ให้ดึงเข้าใบใหม่ได้
   */
  const voidInv = async (x: Invoice) => {
    try {
      const r = await fetch("/api/data/invoices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "upsert", items: [{ id: String(x.id), data: { ...x, status: VOID } }] }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "ยกเลิกเอกสารไม่สำเร็จ");
      refreshData("invoices");
      toast(`ยกเลิกเอกสารแล้ว · ${x.no ?? ""} · ${x.who}`);
    } catch (e) { toast((e as Error).message); refreshData("invoices"); }
  };
  const openPay = (x: Invoice) => { setPay(x); setExtra([]); setSlip(""); setAmt({ cash: "", credit: "", transfer: "", wht: "", date: todayIso(), tref: "" }); };
  /**
   * รับเงินหลายใบในครั้งเดียว: ใบค้างอื่นของคนเดียวกันในสาขาเดียวกัน ติ๊กรวมได้
   *  เงินที่รับตัดใบเก่าก่อน (เงินสด → โอน → บัตร) และบันทึกเป็นการรับชำระของแต่ละใบ (ใบเสร็จแยกตามใบ)
   */
  const [extra, setExtra] = useState<string[]>([]);
  const payOthers = pay ? list.filter((y) => y.id !== pay.id && isOpen(y) && !isCN(y) && y.who === pay.who && invBranch(y) === invBranch(pay) && balanceOf(y) > 0)
    .sort((a, b) => a.date.localeCompare(b.date)) : [];
  const batch = pay ? [pay, ...payOthers.filter((y) => extra.includes(y.id))].sort((a, b) => a.date.localeCompare(b.date)) : [];
  const multi = batch.length > 1;
  const left = multi ? Math.round(batch.reduce((n, y) => n + balanceOf(y), 0) * 100) / 100 : pay ? balanceOf(pay) : 0;
  const got = num(amt.cash) + num(amt.credit) + num(amt.transfer), wht = num(amt.wht);
  /** ยอดที่ตัดจากยอดค้าง = เงินที่รับ + ภาษีหัก ณ ที่จ่าย */
  const now = got + wht;
  /** ภาษีหัก ณ ที่จ่าย 3% ของค่าบริการก่อน VAT ในยอดคงเหลือ (ไม่คิดจากเงินประกัน) */
  const wht3 = (() => {
    if (!pay) return 0;
    const its = parseItems(pay.items).filter((i) => !i.credit), g = grandOf(its);
    const base = its.filter((i) => !/^เงินประกัน/.test(i.desc.trim())).reduce((n, i) => n + lineNet(i), 0);
    return g > 0 ? Math.round(left * (base / g) * 3) / 100 : 0;
  })();
  /** รับหลายใบ: แบ่งเงินตัดใบเก่าก่อน แล้วบันทึกทีละใบ · ใบไหนไม่สำเร็จ หยุดและบอกว่าบันทึกไปแล้วกี่ใบ */
  const savePayMany = async () => {
    const pool = { cash: num(amt.cash), transfer: num(amt.transfer), credit: num(amt.credit) };
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const plan = batch.map((x) => {
      let need = balanceOf(x);
      const take = (k: keyof typeof pool) => { const t = r2(Math.min(need, pool[k])); pool[k] = r2(pool[k] - t); need = r2(need - t); return t; };
      return { x, cash: take("cash"), transfer: take("transfer"), credit: take("credit") };
    }).filter((p) => p.cash + p.transfer + p.credit > 0);
    let done = 0;
    try {
      for (const p of plan) {
        const r = await fetch("/api/billing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "pay", id: p.x.id, cash: p.cash, credit: p.credit, transfer: p.transfer, wht: 0, date: amt.date, slip: p.transfer > 0 ? slip : undefined, transferRef: amt.tref }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(`${p.x.no ?? ""}: ${d.error || "รับชำระไม่สำเร็จ"}`);
        done++;
      }
      setPay(null);
      toast(`รับชำระ ${done} ใบแล้ว · ${pay?.who ?? ""} · รวม ${money(got)} บาท · ใบเสร็จแยกตามใบ`);
      setTab(PAID);
    } catch (e) {
      toast(`${(e as Error).message}${done ? ` · บันทึกไปแล้ว ${done} ใบ` : ""}`);
    } finally { refreshData("invoices"); setBusy(false); }
  };
  const savePay = async () => {
    if (!pay || busy) return;
    const cash = num(amt.cash), credit = num(amt.credit), transfer = num(amt.transfer);
    if (got <= 0) return toast("กรุณาระบุยอดที่รับชำระครั้งนี้");
    if (now > left + 0.005) return toast(`ยอดรับชำระ ${money(now)} บาท เกินยอดคงเหลือ ${money(left)} บาท`);
    if (transfer > 0 && !slip) return toast("กรุณาแนบหลักฐานการโอนเงิน");
    if (multi && wht > 0) return toast("หัก ณ ที่จ่ายใช้ได้เมื่อรับทีละใบ");
    setBusy(true);
    if (multi) return savePayMany();
    // ใบแจ้งหนี้ที่เพิ่งสร้างอาจยังบันทึกขึ้นระบบไม่เสร็จ (404) ลองซ้ำก่อนแจ้งว่าไม่สำเร็จ
    const send = () => fetch("/api/billing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "pay", id: pay.id, cash, credit, transfer, wht, date: amt.date, slip: slip || undefined, transferRef: amt.tref }) });
    try {
      let r = await send();
      for (let i = 0; i < 3 && r.status === 404; i++) { await new Promise((x) => setTimeout(x, 1500)); r = await send(); }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "รับชำระไม่สำเร็จ");
      setPay(null);
      refreshData("invoices");
      toast(d.status === PAID ? `รับชำระครบแล้ว · ${pay.no ?? ""} · ${pay.who} · ออกเป็นใบเสร็จรับเงิน` : `รับชำระบางส่วนแล้ว · ${pay.no ?? ""} · รับ ${money(now)} บาท · คงเหลือ ${money(left - now)} บาท`);
      setTab(d.status === PAID ? PAID : UNPAID);
      // ชำระครบเฉพาะใบแรกเข้าของสัญญา และสัญญายังรอชำระมัดจำ: ถามเปลี่ยนเป็นใช้งานอยู่ + ให้ผู้รับบริการเข้าพัก
      const k = d.status === PAID && pay.contract && isStartInvoice(pay) && can(user, "contracts") ? con.rows.findIndex((c) => c[0] === pay.contract && c[5] === "รอชำระเงินมัดจำ") : -1;
      if (k >= 0) {
        const c = con.rows[k], j = res.rows.findIndex((r) => r[0] === c[2] && r[3] === c[1]);
        confirm({
          title: "เริ่มสัญญา", okLabel: "เปลี่ยนเป็นใช้งานอยู่",
          message: `รับชำระครบแล้ว ต้องการเปลี่ยนสัญญา ${c[0]} เป็น "ใช้งานอยู่"${j >= 0 && res.rows[j][5]?.startsWith("มัดจำ") ? ` และให้ ${c[2]} เข้าพัก${c[6] && c[6] !== "-" ? `ห้อง ${c[6]}` : ""}` : ""} เลยหรือไม่`,
          onOk: () => {
            con.update(k, c.map((x, n) => (n === 5 ? "ใช้งานอยู่" : x)));
            if (j >= 0 && res.rows[j][5]?.startsWith("มัดจำ")) res.update(j, res.rows[j].map((x, n) => (n === 5 ? "เข้าอยู่ (Active)" : x)));
            toast(`เริ่มสัญญาแล้ว · ${c[0]} · ${c[2]} เข้าพัก`);
          },
        });
      }
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  };

  // ประวัติการรับชำระของเอกสารที่เปิดดู (แต่ละงวดมีสลิปของตัวเอง)
  useEffect(() => {
    setPays([]); setWhich(0);
    if (!view || !(view.paid ?? 0)) return;
    fetch(`/api/billing?id=${encodeURIComponent(view.id)}`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setPays(d.payments ?? [])).catch(() => {});
  }, [view?.id, view?.paid]); // eslint-disable-line react-hooks/exhaustive-deps

  const branchOfInv = (x: Invoice) => invBranch(x) || residentOf(x.who)?.[3] || user?.branch || "";
  // ผู้บริหารดูทุกสาขา: มีคอลัมน์สาขา · ใบยกเลิก: คงเหลือ "-" (ไม่ใช่หนี้) · วันที่แบบ "10 พ.ย. 2569"
  const allBranches = user?.role === "Global Admin";
  const invCols = ["เลขที่เอกสาร", "วันที่", ...(allBranches ? ["สาขา"] : []), "HN", "ผู้รับบริการ", "ประเภท", "ยอดสุทธิ (บาท)", "ชำระแล้ว", "คงเหลือ", "สถานะ"];
  const rows = useMemo(() => shown.map((x) => [x.no ?? "กำลังออกเลข…", thDateText((x.status === PAID ? x.paidDate || x.date : x.date).slice(0, 10)), ...(allBranches ? [branchOfInv(x) || "-"] : []), x.hn || "-", x.who, kindShort(x.kind), money(x.net), money(x.paid ?? 0), x.status === VOID ? "-" : money(balanceOf(x)), x.status]), [shown, allBranches]); // eslint-disable-line react-hooks/exhaustive-deps
  /**
   * หน้า 2 ของใบ: ห้องจากสัญญา · ระยะเวลาบริการ (ใช้ invoicePeriod ตัวเดียวกับ CSV และ Dashboard)
   *  ใบแรกเข้า = วันเริ่มสัญญา ถึงวันก่อนครบจำนวนเดือนที่ชำระล่วงหน้า (พักรายวัน/สัปดาห์ = ตามจำนวนวัน) · ใบรายเดือน = รอบเดือนตามวันเริ่มสัญญา
   */
  /** คัดลอกข้อความแจ้งยอดส่ง LINE (ใบที่ยังค้าง) */
  const copyLine = async (x: Invoice) => {
    const b = branchInfo(branchOfInv(x));
    const ok = await copyToClipboard(lineMessage(x, { branch: b.name || branchOfInv(x), legal: b.legal, period: billDetail(x).period }));
    toast(ok ? `คัดลอกข้อความแจ้งยอดแล้ว · ${x.who} · วางในแชท LINE ได้เลย` : "คัดลอกไม่ได้ในเบราว์เซอร์นี้");
  };
  const billDetail = (x: Invoice) => {
    const c = x.contract ? con.rows.find((r) => r[0] === x.contract) : undefined;
    const room = c?.[6] && c[6] !== "-" ? c[6] : res.rows.find((r) => r[0] === x.who)?.[2] ?? "";
    const period = periodText(invoicePeriod(x, con.rows));
    return { room: room && room !== "-" ? room : "", period };
  };

  return (
    <>
      <PageHeader title="ใบแจ้งหนี้และใบเสร็จ" sub="ใบแจ้งหนี้ · รับชำระ · ใบเสร็จ"
        actions={<>
          <MenuButton label="ส่งออก CSV" icon={<CsvIcon />} items={[
            { label: "ค้างชำระ / ชำระครบ ตามช่วงวัน", hint: "เลือกวันนี้ สัปดาห์ เดือน", onClick: () => setExp(true) },
            { label: "เอกสารทั้งหมด", hint: "1 แถวต่อใบ ตามแท็บที่เลือก · แยกค่าห้อง VAT", onClick: () => { const n = invoiceDocsCsv(shown, invBranch, `การเงิน-${tab}`); toast(`ส่งออกเอกสารแล้ว ${n} ใบ`); } },
            { label: "รายการในใบ", hint: "แยกค่าห้อง คอร์ส ยา", onClick: () => { const n = exportInvoiceLines(list, invBranch, "การเงิน-รายการในใบ"); toast(`ส่งออกรายการในใบแล้ว ${n} บรรทัด`); } },
            { label: "การรับเงิน", hint: "แยกเงินสด โอน บัตร", onClick: () => exportPayments("", "การเงิน-การรับเงินรายงวด").then((n) => toast(`ส่งออกการรับเงินแล้ว ${n} งวด`)).catch((e) => toast((e as Error).message)) },
          ]} />
          <button className="btn-soft" title="ดูหน้าตาใบเสร็จของแต่ละห้อง (ไม่บันทึกในระบบ)" onClick={() => setSampleOpen(true)}><Icon name="receipt" className="h-4 w-4" /> <span>ตัวอย่าง<span className="hidden sm:inline">ใบเสร็จ</span></span></button>
          <button className="btn-soft" onClick={() => setCourse({ who: "", name: "กายภาพบำบัด (ครั้งละ 45 นาที)", total: "10", price: "", busy: false })}><Icon name="plus" className="h-4 w-4" /> <span>ขายคอร์ส<span className="hidden sm:inline">กายภาพ</span></span></button>
          <button className="btn-primary" onClick={startNew}><Icon name="plus" className="h-4 w-4" /> ออกใบแจ้งหนี้</button>
        </>} />
      {due.length > 0 && <Section title="ครบรอบบิล" sub={`${due.length} สัญญาครบรอบแล้วหรือจะครบภายใน ${DUE_AHEAD} วัน · ยังไม่มีใบของรอบนั้น · ออกเป็นใบร่างให้การเงินตรวจยอดก่อนส่งให้ญาติ`}
        actions={<button className="btn-primary" onClick={makeDue}><Icon name="plus" className="h-4 w-4" /> ออกใบแจ้งหนี้รอบนี้ {due.length} ใบ (ร่าง)</button>}>
        <DataTable search={false} columns={["ครบรอบ", "เลขที่สัญญา", ...(allBranches ? ["สาขา"] : []), "ผู้รับบริการ", "ผู้ชำระ", "ห้อง", "ค่าบริการ/เดือน (บาท)"]}
          rows={due.map(({ c, next }) => [thDateText(next), c[0], ...(allBranches ? [c[1] || "-"] : []), c[2], c[3] || "-", c[6] && c[6] !== "-" ? c[6] : "-", money(totals(contractMonthLines(c)).net)])}
          actions={[{ label: "ออกใบ", onClick: (k) => setBillFor({ id: due[k].id }) }]} />
      </Section>}

      <Section title="เอกสารการเงิน">
        <StatFilter label="กรองเอกสาร" value={tab} onChange={setTab} items={[
          { k: "ทั้งหมด", t: "ทั้งหมด", n: list.length, tone: "all" },
          { k: DRAFT, t: DRAFT, n: list.filter((x) => x.status === DRAFT).length, tone: "warn" },
          { k: UNPAID, t: UNPAID, n: unpaid.length, tone: "bad" },
          { k: PAID, t: PAID, n: list.filter((x) => x.status === PAID).length, tone: "good" },
          { k: VOID, t: VOID, n: list.filter((x) => x.status === VOID).length, tone: "muted" },
          ...(list.some(isCN) ? [{ k: CN_KIND, t: CN_KIND, n: list.filter(isCN).length, tone: "warn" as const }] : []),
        ]} summary={<>ค้างรวม <b>{money(unpaid.reduce((n, x) => n + balanceOf(x), 0))}</b> · รับเดือนนี้ <b>{money(paidMonthSum)}</b> บาท</>} />
        <DataTable columns={invCols} rows={rows} minor={[invCols.indexOf("HN")]}
          mobileCard={{ title: invCols.indexOf("ผู้รับบริการ"), value: invCols.indexOf("คงเหลือ"), sub: [0, 1, invCols.indexOf("ประเภท")] }}
          render={(k, col, v) => {
            const c = invCols[col], x = shown[k];
            if (!x) return undefined;
            if (c === "สถานะ") { const d = overdueDays(x); return <span className="inv-status"><StatusBadge value={v} />{d >= 0 && <small className={d > 30 ? "is-late" : ""}>{d > 30 ? `เกินกำหนด ${d} วัน` : `${d} วัน`}</small>}</span>; }
            if (c === "ผู้รับบริการ" || c === "ประเภท" || c === "สาขา" || c === "วันที่") return <span className="whitespace-nowrap">{v}</span>;
            if (c === "ยอดสุทธิ (บาท)" && x.status === VOID) return <span className="whitespace-nowrap text-gold-400 line-through">{v}</span>;
            return undefined;
          }}
          empty={meta.loaded ? "ยังไม่มีเอกสาร" : "กำลังโหลด…"}
          onRow={(k) => { setFormat("customer"); setCopy(false); setView(shown[k]); }} rowLabel="กดเพื่อดูหรือพิมพ์เอกสาร"
          actions={[
            // กดแถว = ดู/พิมพ์ · ปุ่มหลักขึ้นเฉพาะเมื่อมีงานต้องทำ (ยืนยันยอด / รับชำระ) · ยกเลิกอยู่ท้ายเมนู ⋯
            { label: "ยืนยันยอด", tone: "primary", hidden: (k) => shown[k].status !== DRAFT, onClick: (k) => { const x = shown[k]; if (x.status !== DRAFT) return toast("เอกสารนี้ยืนยันยอดแล้ว"); confirm({ title: "ยืนยันยอดใบแจ้งหนี้", okLabel: "ยืนยันยอด", message: `ตรวจรายการและยอด ${money(x.net)} บาท ของ ${x.who} ถูกต้องแล้วใช่หรือไม่ · ยืนยันแล้วจะเป็น "${UNPAID}" และรับชำระได้ · ถ้ายอดไม่ถูกให้ยกเลิกใบนี้แล้วออกใบใหม่`, onOk: () => { setList(list.map((y) => (y.id === x.id ? { ...x, status: UNPAID } : y))); setTab(UNPAID); toast(`ยืนยันยอดแล้ว · ${x.no ?? ""} · ${x.who} · พร้อมรับชำระ`); } }); } },
            { label: "รับชำระ", tone: "primary", hidden: (k) => !isOpen(shown[k]), onClick: (k) => openPay(shown[k]) },
            { label: "บันทึกคืนเงิน", tone: "primary", hidden: (k) => shown[k].status !== CN_REFUND, onClick: (k) => setRefund({ x: shown[k], method: "โอนเงิน" }) },
            { label: "ดู / พิมพ์", more: true, onClick: (k) => { setFormat("customer"); setCopy(false); setView(shown[k]); } },
            { label: "คัดลอกข้อความแจ้งยอด (LINE)", more: true, hidden: (k) => !isOpen(shown[k]) || isCN(shown[k]), onClick: (k) => copyLine(shown[k]) },
            ...(admin ? [{ label: "ออกใบลดหนี้…", more: true, hidden: (k: number) => isCN(shown[k]) || ![UNPAID, PARTIAL, PAID].includes(shown[k].status), onClick: (k: number) => setCn({ x: shown[k], amount: "", reason: CN_REASONS[0], other: "" }) }] : []),
            ...(admin ? [{ label: "ยกเลิกใบนี้…", danger: true, more: true, hidden: (k: number) => isCN(shown[k]) || shown[k].status === VOID || shown[k].status === PAID || shown[k].status === PARTIAL, onClick: (k: number) => { const x = shown[k]; if (x.status === VOID) return; if (x.status === PAID || x.status === PARTIAL) return toast("เอกสารที่รับชำระแล้วยกเลิกไม่ได้"); confirm({ title: "ยกเลิกเอกสาร", message: `ต้องการยกเลิก ${x.no ?? ""} (${money(x.net)} บาท) ใช่หรือไม่ เอกสารยังเก็บไว้ในระบบพร้อมสถานะยกเลิก`, danger: true, okLabel: "ยกเลิกเอกสาร", onOk: () => voidInv(x) }); } }] : []),
          ]} />
      </Section>

      <Modal open={sampleOpen} title="ตัวอย่างใบเสร็จ (ชำระแล้ว)" onClose={() => setSampleOpen(false)}
        footer={<button className="btn-soft" onClick={() => setSampleOpen(false)}>ปิด</button>}>
        <p className="form-intro">เลือกห้องเพื่อดูใบเสร็จตัวอย่างค่าบริการ 1 เดือน · สร้างในหน้าจอเท่านั้น ไม่บันทึกในระบบ ไม่เข้ายอดรับเงินหรือรายงาน</p>
        <div className="grid gap-2">
          {priceRooms().map((x, k) => (
            <button key={x.code} type="button" className="room-opt" onClick={() => openSample(k)}>
              <span className="room-opt-name"><b>{x.name.replace(/\s*\(.*\)\s*$/, "")}</b><small>{x.name.match(/\(([^)]+)\)/)?.[1] ?? ""}</small></span>
              <span className="room-opt-price"><b>{x.promo.toLocaleString()}</b><small>ห้อง {x.part.เดือน.toLocaleString()} + แพทย์ {(x.promo - x.part.เดือน).toLocaleString()}</small></span>
            </button>
          ))}
        </div>
      </Modal>
      <StatusExport open={exp} onClose={() => setExp(false)} list={list} contracts={con.rows} branchOf={invBranch} />

      <Receivables list={list} branchOf={invBranch} branchInfo={branchInfo} by={user?.name} />

      {/* ออกใบแจ้งหนี้ */}
      <Modal open={!!form} wide title="ออกใบแจ้งหนี้" onClose={() => setForm(null)}
        footer={<><button className="btn-soft" onClick={() => setForm(null)}>ยกเลิก</button><button className="btn-primary" onClick={saveNew}>บันทึกใบแจ้งหนี้</button></>}>
        {form && <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="ผู้รับบริการ" required><ResidentPicker value={form.who} names={billable.map((r) => r[0])} onChange={pickResident} />
              {people.length > billable.length && <p className="field-hint">ไม่แสดง {people.length - billable.length} คนที่ชำระค่าบริการเดือนนี้แล้ว ({people.filter((r) => paidNow.has(r[0])).map((r) => r[0]).join(", ")})</p>}</Field>
            <Field label="ประเภท"><select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{BILL_KINDS.map((k) => <option key={k}>{k}</option>)}</select><p className="field-hint">หมวดหลักของใบนี้ · ใบเดียวใส่ได้หลายรายการ เช่น ค่าห้อง + ค่ากายภาพ + เวชภัณฑ์</p></Field>
            <Field label="ชื่อผู้ชำระ" required><input value={form.payer} onChange={(e) => setForm({ ...form, payer: e.target.value })} /></Field>
            <Field label="วันที่"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label="ที่อยู่ผู้ชำระ" className="md:col-span-2"><textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
            {/* ผู้ชำระเป็นบริษัท: ใบกำกับภาษีต้องมีเลขผู้เสียภาษีและสำนักงานใหญ่/สาขาของผู้ซื้อ · บุคคลธรรมดาเว้นว่าง */}
            <Field label="เลขผู้เสียภาษีผู้ชำระ (เฉพาะบริษัท)">
              <input inputMode="numeric" maxLength={17} value={form.payerTaxId ?? ""} placeholder="13 หลัก · บุคคลธรรมดาเว้นว่าง" onChange={(e) => setForm({ ...form, payerTaxId: e.target.value })} />
              {!!form.payerTaxId?.replace(/\D/g, "") && !validTaxId(form.payerTaxId) && <p className="mt-1 text-xs font-medium text-red-700">เลขไม่ถูกต้อง · ตรวจว่าครบ 13 หลักและพิมพ์ถูก</p>}
            </Field>
            <Field label="สำนักงานของผู้ชำระ">
              <div className="flex gap-2">
                <select className="!w-auto" disabled={!form.payerTaxId?.trim()} value={(form.payerBranch ?? "").startsWith("สาขาที่") ? "branch" : "hq"} onChange={(e) => setForm({ ...form, payerBranch: e.target.value === "hq" ? "สำนักงานใหญ่" : "สาขาที่ " })}>
                  <option value="hq">สำนักงานใหญ่</option><option value="branch">สาขาที่</option>
                </select>
                {(form.payerBranch ?? "").startsWith("สาขาที่") && <input inputMode="numeric" maxLength={5} className="!w-28" placeholder="00001" value={(form.payerBranch ?? "").replace(/\D/g, "")} onChange={(e) => setForm({ ...form, payerBranch: `สาขาที่ ${e.target.value.replace(/\D/g, "")}` })} />}
              </div>
            </Field>
          </div>
          {unbilled.length > 0 && unbilled.some((x) => !pulled.includes(x.id)) && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span>มียา เวชภัณฑ์ หรือคอร์สกายภาพที่ยังไม่เรียกเก็บ {unbilled.filter((x) => !pulled.includes(x.id)).length} รายการ · {money(unbilled.filter((x) => !pulled.includes(x.id)).reduce((n, x) => n + x.qty * x.price, 0))} บาท</span>
            <button type="button" className="btn-soft !py-1.5" onClick={pullSupplies}>ดึงเข้าใบแจ้งหนี้นี้</button>
          </div>}
          {form.who && <p className="text-xs text-gold-500">HN {form.hn || "(ออกให้เมื่อบันทึกผู้รับบริการ)"}{form.contract ? ` · สัญญา ${form.contract}` : ""}</p>}
          {form.kind === BILL_KINDS[5] && dcCtx && dcCtx.c[0] === form.contract && (() => {
            // ค่าบริการเดือนสุดท้าย: วันที่อยู่ในเดือน D/C (นับวัน D/C ด้วย) · เดือนนี้เรียกเก็บแล้วหรือยัง · เดือนที่จ่ายล่วงหน้าเกินวัน D/C
            const { c, date, mode } = dcCtx, month = date.slice(0, 7);
            const [yy, mm] = month.split("-").map(Number), dim = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
            const st = contractStartIso(c), from = st && st > `${month}-01` ? st : `${month}-01`;
            const days = Math.max(0, Math.round((Date.parse(date) - Date.parse(from)) / 864e5) + 1);
            const mLines = contractMonthLines(c), mTotal = contractMonthTotal(c);
            const billed = contractBilledFor(c, month, list);
            const future: string[] = [];
            for (let k = 1; k <= 24; k++) { const m2 = new Date(Date.UTC(yy, mm - 1 + k, 1)).toISOString().slice(0, 7); if (contractBilledFor(c, m2, list)) future.push(m2); else break; }
            const label = `${mm}/${yy + 543}`;
            const addLines = (ratio: number, note: string) => {
              const add = mLines.map((l) => ({ ...l, price: Math.round(l.price * ratio * 100) / 100, desc: `${l.desc} (${note})` }));
              setLines([...lines.filter((l) => !l.credit && l.desc.trim()), ...add, ...lines.filter((l) => l.credit)]); setDcCtx({ ...dcCtx, added: true });
              toast(`เพิ่มค่าบริการเดือน ${label} แล้ว ${add.length} รายการ`);
            };
            // คืนเงิน: แยกตามใบที่เรียกเก็บแต่ละเดือน (ใบลดหนี้ออกต่อใบ)
            const refunds = new Map<string, { x: Invoice; amount: number; what: string[] }>();
            const addRefund = (m2: string, amount: number, what: string) => {
              const x = contractInvoiceFor(c, m2, list); if (!x || amount <= 0) return;
              const r = refunds.get(x.id) ?? { x, amount: 0, what: [] }; r.amount = Math.round((r.amount + amount) * 100) / 100; r.what.push(what); refunds.set(x.id, r);
            };
            if (mode === "actual" && billed && days < dim) addRefund(month, Math.round(mTotal * (dim - days) / dim * 100) / 100, `เดือน ${label} ไม่ได้อยู่ ${dim - days} วัน`);
            if (mode === "actual") future.forEach((m2) => addRefund(m2, mTotal, `เดือน ${m2.slice(5, 7)}/${Number(m2.slice(0, 4)) + 543} ทั้งเดือน`));
            return (
              <div className="dc-month">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-gold-800">ค่าบริการเดือนสุดท้าย · D/C {docDate(date)}</p>
                    <p className="text-sm text-gold-600">อยู่จริงเดือน {label} {days} จาก {dim} วัน · ค่าบริการต่อเดือน {money(mTotal)} บาท · {billed ? "เดือนนี้เรียกเก็บแล้ว" : "เดือนนี้ยังไม่ได้เรียกเก็บ"}{future.length ? ` · จ่ายล่วงหน้าเกินอีก ${future.length} เดือน` : ""}</p>
                  </div>
                  <div className="segmented-tabs" role="group" aria-label="วิธีคิดเดือนสุดท้าย">
                    {([["actual", "ตามวันที่อยู่จริง"], ["full", "เต็มเดือน ไม่คืน"]] as const).map(([v, t]) => <button key={v} type="button" className={mode === v ? "is-selected" : ""} aria-pressed={mode === v} onClick={() => setDcCtx({ ...dcCtx, mode: v })}>{t}</button>)}
                  </div>
                </div>
                {!billed && days > 0 && <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  {mode === "actual"
                    ? <><span>ค่าบริการ {days}/{dim} วัน = <b>{money(Math.round(mTotal * days / dim * 100) / 100)}</b> บาท</span><button type="button" className="row-action" disabled={dcCtx.added} onClick={() => addLines(days / dim, `${days}/${dim} วัน · ${label}`)}>{dcCtx.added ? "เพิ่มแล้ว" : "เพิ่มลงใบนี้"}</button></>
                    : <><span>ค่าบริการเต็มเดือน <b>{money(mTotal)}</b> บาท</span><button type="button" className="row-action" disabled={dcCtx.added} onClick={() => addLines(1, `เดือน ${label}`)}>{dcCtx.added ? "เพิ่มแล้ว" : "เพิ่มลงใบนี้"}</button></>}
                </div>}
                {mode === "actual" && refunds.size > 0 && <div className="mt-3 space-y-2 text-sm">
                  {[...refunds.values()].map((r) => <div key={r.x.id} className="flex flex-wrap items-center gap-2">
                    <span>คืนให้ลูกค้า <b>{money(r.amount)}</b> บาท ({r.what.join(" · ")}) จากใบ {r.x.no}</span>
                    {admin ? <button type="button" className="row-action" onClick={() => setCn({ x: r.x, amount: String(r.amount), reason: CN_REASONS[1], other: "" })}>ออกใบลดหนี้</button>
                      : <span className="text-xs text-gold-500">ให้ผู้จัดการสาขากด "ออกใบลดหนี้" ที่ใบ {r.x.no}</span>}
                  </div>)}
                </div>}
                {mode === "full" && (billed || future.length > 0) && <p className="mt-2 text-sm text-gold-600">ไม่คืนเงินส่วนที่จ่ายไว้แล้ว{future.length ? ` (รวมค่าบริการล่วงหน้าอีก ${future.length} เดือน)` : ""}</p>}
                {billed && mode === "actual" && days >= dim && !future.length && <p className="mt-2 text-sm text-gold-600">อยู่ครบเดือนแล้ว ไม่มีส่วนต้องคืน</p>}
              </div>
            );
          })()}
          <div className="bill-items">
            <div className="mb-2 flex items-center justify-between"><h3 className="font-medium text-gold-800">รายการ</h3><button type="button" className="row-action" onClick={() => setLines([...lines, blankItem()])}>+ เพิ่มรายการ</button>
              <button type="button" className="row-action" title="เช่น มัดจำห้องที่รับตอนจอง · หักหลังรวม VAT" onClick={() => setLines([...lines.filter((l) => l.desc.trim()), { desc: "หัก มัดจำที่ชำระไว้แล้ว", qty: 1, price: 0, discount: 0, credit: true }])}>+ หักเงินที่รับไว้แล้ว</button></div>
            {/* ค้นหรือกดหมวดแบบเดียวกับหน้าเปิดสัญญา · กดราคาแล้วเพิ่มเป็นบรรทัดใหม่ (แทนบรรทัดว่าง) · ค่าห้องติ๊ก VAT ให้เอง */}
            <div className="mb-3"><ServicePicker onPick={(x) => {
              // ราคาห้อง (รวม VAT แล้ว): แยกเป็นค่าห้อง (ส่วนที่มี VAT เช่น 500/วัน 15,000/เดือน) + ค่าบริการทางการแพทย์ (ส่วนต่าง ไม่มี VAT)
              const rp = roomPartByCode(x.code);
              const add: BillItem[] = rp ? [
                { desc: `ค่า${rp.name} ราย${rp.unit}`, qty: x.qty, price: baseOfIncl(rp.part, vatRate), discount: 0, code: x.code, vat: vatRate },
                ...(x.price - rp.part > 0 ? [{ desc: `ค่าบริการทางการแพทย์ ราย${rp.unit}`, qty: x.qty, price: Math.round((x.price - rp.part) * 100) / 100, discount: 0, code: "RM-MD" }] : []),
              ] : [{ desc: x.desc, qty: x.qty, price: x.price, discount: 0, code: x.code, vat: isRoomLine(x.desc) ? vatRate : 0 }];
              setLines([...lines.filter((l) => !l.credit && l.desc.trim()), ...add, ...lines.filter((l) => l.credit)]);
            }} /></div>
            <div className="space-y-3">{lines.map((l, i) => {
              const set = (p: Partial<BillItem>) => setLines(lines.map((x, j) => (j === i ? { ...x, ...p } : x)));
              // บรรทัดหักเงินที่รับไว้แล้ว: หักหลังรวม VAT · ไม่มีส่วนลด/VAT
              if (l.credit) return <div key={i} className="bill-item bill-credit">
                <Field label="หักเงินที่รับไว้แล้ว"><input value={l.desc} onChange={(e) => set({ desc: e.target.value })} /></Field>
                <Field label="จำนวนเงิน (บาท)"><input type="number" min={0} value={l.price} onChange={(e) => set({ price: num(e.target.value), qty: 1 })} /></Field>
                <p className="bill-credit-note">หักจากยอดรวม VAT แล้ว · ไม่ใช่ส่วนลด ไม่ลด VAT</p>
                <button type="button" className="row-action danger" onClick={() => setLines(lines.filter((_, j) => j !== i))}>ลบ</button>
              </div>;
              return <div key={i} className="bill-item">
                <Field label="รายการ"><LineDesc value={l.desc} onText={(desc) => set({ desc, code: undefined })} onPick={(desc, price, code) => set({ desc, price, code, vat: isRoomLine(desc) ? vatRate : 0 })} /></Field>
                <Field label="จำนวน"><input type="number" min={0} value={l.qty} onChange={(e) => set({ qty: num(e.target.value) })} /></Field>
                <Field label="ราคา/หน่วย"><input type="number" min={0} value={l.price} onChange={(e) => set({ price: num(e.target.value) })} /></Field>
                <Field label="ส่วนลด (บาท)"><input type="number" min={0} value={l.discount} onChange={(e) => set({ discount: num(e.target.value) })} /></Field>
                <Field label="ส่วนลด (%)"><input type="number" min={0} max={100} step="0.5" value={l.pct ?? 0} onChange={(e) => set({ pct: Math.min(100, num(e.target.value)) })} /></Field>
                <label className="bill-vat" title="บวกภาษีมูลค่าเพิ่มจากยอดหลังส่วนลด (ค่าห้อง)"><input type="checkbox" checked={!!l.vat} onChange={(e) => set({ vat: e.target.checked ? vatRate : 0 })} /> VAT {l.vat || vatRate}%</label>
                {/* เหลือบรรทัดเดียว = ล้างช่องให้ว่าง (ใบต้องมีอย่างน้อย 1 บรรทัด) */}
                <button type="button" className="row-action danger" title={lines.filter((x) => !x.credit).length === 1 ? "ล้างรายการนี้ให้ว่าง" : "ลบรายการนี้"}
                  onClick={() => setLines(lines.filter((x) => !x.credit).length === 1 ? lines.map((x, j) => (j === i ? blankItem() : x)) : lines.filter((_, j) => j !== i))}>ลบ</button>
                {(lineDiscount(l) > 0 || !!l.vat) && <p className="bill-line-sum">ยอด {money(lineAmount(l))}{lineDiscount(l) > 0 ? <> · ลด {money(lineDiscount(l))}{l.pct ? ` (รวม ${l.pct}%)` : ""}</> : null}{l.vat ? <> · ก่อน VAT {money(lineNet(l))} · VAT {l.vat}% {money(Math.round(lineNet(l) * l.vat) / 100)}</> : null} · <b>สุทธิ {money(Math.round(lineNet(l) * (100 + (l.vat ?? 0))) / 100)}</b>{lineDiscount(l) > lineAmount(l) ? <span className="text-red-700"> · ส่วนลดเกินยอด</span> : null}</p>}
              </div>;
            })}</div>
            <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
              <label className="flex items-center gap-2 text-sm text-gold-700">อัตรา VAT (%)
                <input type="number" min={0} max={30} step="0.5" className="!w-20" value={vatRate} aria-label="อัตรา VAT"
                  onChange={(e) => { const v = Math.max(0, Math.min(30, num(e.target.value))); setVatRate(v); setLines(lines.map((l) => (l.vat ? { ...l, vat: v } : l))); }} />
                <small className="text-gold-500">ใช้กับบรรทัดที่ติ๊ก VAT · ค่าห้องติ๊กให้เอง</small></label>
              <div className="text-right text-sm text-gold-700">
                <p>รวม {money(sum.total)} · ส่วนลด {money(sum.discount)}</p>
                {creditOf(lines) > 0 && <p>รวมทั้งสิ้น{vatSum.vat > 0 ? " (รวม VAT)" : ""} {money(grandOf(lines.filter((l) => l.desc.trim())))} · หักเงินที่รับไว้แล้ว {money(creditOf(lines.filter((l) => l.desc.trim())))}</p>}
                {vatSum.vat > 0 && <p>มูลค่าก่อน VAT {money(vatSum.base)}{vatSum.rates.map((x) => ` · VAT ${x.rate}% ${money(x.vat)}`).join("")}{vatSum.exempt > 0 ? ` · ไม่มี VAT ${money(vatSum.exempt)}` : ""}</p>}
                <b className="text-base text-gold-800">{creditOf(lines) > 0 ? "ยอดที่ต้องชำระ" : `สุทธิ${vatSum.vat > 0 ? " (รวม VAT)" : ""}`} {money(sum.net)} บาท</b>
              </div>
            </div>
          </div>
          <Field label="หมายเหตุ"><input value={form.note ?? ""} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
        </div>}
      </Modal>

      {/* ขายคอร์สกายภาพ */}
      <Modal open={!!course} title="ขายคอร์สกายภาพ" onClose={() => setCourse(null)}
        footer={<><button className="btn-soft" onClick={() => setCourse(null)}>ยกเลิก</button><button className="btn-primary" disabled={course?.busy} onClick={saveCourse}>{course?.busy ? "กำลังบันทึก…" : "บันทึกคอร์สและออกใบแจ้งหนี้"}</button></>}>
        {course && <div className="space-y-4">
          <div className="form-grid">
            <Field label="ผู้รับบริการ" required className="md:col-span-2"><ResidentPicker value={course.who} names={people.map((r) => r[0])} onChange={(v) => setCourse({ ...course, who: v })} /></Field>
            {ptCourses.length > 0 && <Field label="เลือกคอร์สจากใบราคา" className="md:col-span-2"><select value={course.code ?? ""} onChange={(e) => {
              const p = ptCourses.find((x) => x.code === e.target.value);
              if (!p) return setCourse({ ...course, code: "" });
              setCourse({ ...course, code: p.code, ...fillFromCourse(p, course.total) });
            }}><option value="">คอร์สอื่น (พิมพ์ชื่อและราคาเอง)</option>{ptCourses.map((p) => <option key={p.code} value={p.code}>{courseOptText(p)}</option>)}</select>
              <p className="field-hint">เลือกแล้วระบบเติมชื่อ จำนวนครั้ง และราคาให้ · แก้ได้ถ้าตกลงราคาพิเศษ · ไม่มีในใบราคา เลือก "คอร์สอื่น" แล้วพิมพ์เองด้านล่าง</p></Field>}
            <Field label={course.code ? "ชื่อคอร์ส (เติมจากใบราคา · แก้ได้)" : "ชื่อคอร์ส · พิมพ์เอง"} required className="md:col-span-2"><input value={course.name} onChange={(e) => setCourse({ ...course, name: e.target.value })} /></Field>
            <Field label="จำนวนครั้ง" required><input type="number" min={1} max={500} value={course.total} onChange={(e) => setCourse({ ...course, total: e.target.value })} /></Field>
            <Field label="ราคาคอร์ส (บาท)" required><input type="number" min={0} value={course.price} onChange={(e) => setCourse({ ...course, price: e.target.value })} placeholder="เช่น 8000" /></Field>
          </div>
          <p className="rounded-xl bg-cream-50 px-4 py-3 text-sm text-gold-700">กดบันทึกแล้วระบบเปิดใบแจ้งหนี้ที่ใส่คอร์สนี้ไว้ให้ เพิ่มรายการอื่นในใบเดียวกันได้ · นักกายภาพเห็นคอร์สและตัดครั้งได้ที่ประวัติผู้รับบริการ แท็บกายภาพ</p>
        </div>}
      </Modal>

      {/* รับชำระ */}
      <Modal open={!!pay} title={multi ? `รับชำระ ${batch.length} ใบ` : `รับชำระ ${pay?.no ?? ""}`} onClose={() => setPay(null)}
        footer={<><button className="btn-soft" onClick={() => setPay(null)}>ยกเลิก</button><button className="btn-primary" disabled={busy} onClick={savePay}>{busy ? "กำลังบันทึก…" : "ยืนยันรับชำระ"}</button></>}>
        {pay && <div className="space-y-4">
          <div className="rounded-xl bg-cream-50 px-4 py-3 text-sm text-gold-700">
            <p>{pay.who} · ผู้ชำระ {pay.payer}</p>
            {multi ? <p className="mt-1">{batch.length} ใบ · <b className="text-gold-800">คงเหลือรวม {money(left)} บาท</b></p>
              : <p className="mt-1">ยอดสุทธิ {money(pay.net)} · ชำระแล้ว {money(pay.paid ?? 0)} · <b className="text-gold-800">คงเหลือ {money(left)} บาท</b></p>}
          </div>
          {payOthers.length > 0 && <div className="rounded-xl border border-cream-300 bg-white px-4 py-3 text-sm text-gold-700">
            <p className="font-medium text-gold-900">{pay.who} มีใบค้างอื่นอีก {payOthers.length} ใบ · ติ๊กเพื่อรับเงินรวมครั้งเดียว</p>
            <ul className="mt-2 space-y-1.5">
              {[pay, ...payOthers].sort((a, b) => a.date.localeCompare(b.date)).map((y) => (
                <li key={y.id}><label className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" className="h-4 w-4 accent-[#8B6E3E]" checked={y.id === pay.id || extra.includes(y.id)} disabled={y.id === pay.id}
                    onChange={(e) => setExtra(e.target.checked ? [...extra, y.id] : extra.filter((id) => id !== y.id))} />
                  <span className="min-w-0 flex-1">{y.no ?? "-"} · {thDateText(y.date.slice(0, 10))} · {kindShort(y.kind)}</span>
                  <b className="tabular-nums">{money(balanceOf(y))}</b>
                </label></li>
              ))}
            </ul>
            {multi && <p className="field-hint mt-2">ตัดใบเก่าก่อน · ออกใบเสร็จแยกตามใบ · จ่ายไม่ครบ ใบท้ายๆ จะเป็นชำระบางส่วนหรือยังค้าง</p>}
          </div>}
          <p className="text-xs text-gold-600">กรอกยอดที่ลูกค้าจ่ายในครั้งนี้ แยกตามวิธีชำระ · จ่ายไม่ครบได้ (ระบบเก็บเป็น "ชำระบางส่วน" และกลับมารับเพิ่มได้ภายหลัง)</p>
          {/* ช่องรับเงินเริ่มว่างทุกช่อง (เดิมเติมยอดลงช่องโอนให้เอง ทำให้รับเงินสดแล้วบันทึกผิดช่องทาง) · กดปุ่มลัดเพื่อรับเต็มยอดด้วยวิธีเดียว */}
          {/* ใบที่ตกลงแบ่งชำระ: บอกงวดถัดไปและยอดของงวด กดใส่ยอดงวดนี้ได้ทันที */}
          {(() => {
            const n = installmentsOf(pay.note);
            if (n < 2 || multi) return null;
            const parts = splitInstallments(pay.net, n);
            let k = 0, acc = 0;
            while (k < n - 1 && acc + parts[k] <= (pay.paid ?? 0) + 0.005) acc += parts[k++];
            const due = Math.min(left, Math.round((acc + parts[k] - (pay.paid ?? 0)) * 100) / 100);
            return <div className="rounded-xl border border-cream-300 bg-white px-4 py-3 text-sm text-gold-700">
              <p>ตกลงแบ่งชำระ {n} งวด · งวดละ {money(parts[0])} บาท{parts[n - 1] !== parts[0] ? ` (งวดสุดท้าย ${money(parts[n - 1])})` : ""}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2"><b className="text-gold-900">งวดที่ {k + 1}/{n} · {money(due)} บาท</b>
                {([["cash", "เงินสด"], ["transfer", "โอนเงิน"], ["credit", "บัตรเครดิต"]] as const).map(([key, t]) => (
                  <button key={key} type="button" className="row-action" onClick={() => setAmt({ ...amt, cash: "", credit: "", transfer: "", [key]: String(due) })}>{t}</button>
                ))}</div>
            </div>;
          })()}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-gold-600">รับเต็มยอด {money(left)} บาท เป็น:</span>
            {([["cash", "เงินสด"], ["transfer", "โอนเงิน"], ["credit", "บัตรเครดิต"]] as const).map(([k, t]) => (
              <button key={k} type="button" className="row-action" onClick={() => setAmt({ ...amt, cash: "", credit: "", transfer: "", [k]: String(Math.round((left - wht) * 100) / 100) })}>{t}</button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="เงินสด"><input type="number" min={0} value={amt.cash} onChange={(e) => setAmt({ ...amt, cash: e.target.value })} /></Field>
            <Field label="โอนเงิน"><input type="number" min={0} value={amt.transfer} onChange={(e) => setAmt({ ...amt, transfer: e.target.value })} /></Field>
            <Field label="บัตรเครดิต"><input type="number" min={0} value={amt.credit} onChange={(e) => setAmt({ ...amt, credit: e.target.value })} /></Field>
          </div>
          {num(amt.transfer) > 0 && <Field label="เลขอ้างอิงการโอน (ไม่บังคับ)"><input value={amt.tref} maxLength={40} placeholder="เลขที่รายการ / Ref. No. จากสลิป" onChange={(e) => setAmt({ ...amt, tref: e.target.value })} /></Field>}
          {/* บริษัทจ่ายแทนและหักภาษีไว้: ตัดยอดค้างด้วย แต่ไม่ใช่เงินที่รับเข้า (ไม่นับเป็นเงินรับ) */}
          {!multi && <div className="rounded-xl border border-cream-300 bg-cream-50 px-4 py-3">
            <Field label="ภาษีหัก ณ ที่จ่าย (ถ้าผู้ชำระเป็นบริษัทและหักภาษีไว้)">
              <div className="flex flex-wrap items-center gap-2">
                <input type="number" min={0} className="!w-40" value={amt.wht} placeholder="0" onChange={(e) => setAmt({ ...amt, wht: e.target.value })} />
                <button type="button" className="row-action" disabled={!wht3} onClick={() => { const rest = Math.round((left - wht3) * 100) / 100; const key = num(amt.transfer) ? "transfer" : num(amt.credit) ? "credit" : num(amt.cash) ? "cash" : "transfer"; setAmt({ ...amt, wht: String(wht3), cash: "", credit: "", transfer: "", [key]: String(rest) }); }}>หัก 3% = {money(wht3)}</button>
                {wht > 0 && <button type="button" className="row-action" onClick={() => setAmt({ ...amt, wht: "" })}>ไม่หัก</button>}
              </div>
            </Field>
            <p className="field-hint mt-1">คิด 3% จากค่าบริการก่อน VAT (ไม่รวมเงินประกัน) · ขอหนังสือรับรองการหักภาษี (50 ทวิ) จากผู้ชำระเก็บไว้ให้ฝ่ายบัญชี</p>
          </div>}
          <p className={`rounded-xl px-4 py-2 text-sm ${now > left + 0.005 ? "bg-red-50 text-red-700" : "bg-gold-50 text-gold-800"}`}>
            รับเงินครั้งนี้ <b>{money(got)}</b> บาท{wht > 0 ? <> + หัก ณ ที่จ่าย <b>{money(wht)}</b> = ตัดยอด <b>{money(now)}</b> บาท</> : ""} · {now > left + 0.005 ? "เกินยอดคงเหลือ" : now >= left - 0.005 && got > 0 ? "ชำระครบ" : `คงเหลือหลังรับ ${money(Math.max(0, left - now))} บาท`}
          </p>
          <Field label="วันที่รับชำระ"><input type="date" value={amt.date} onChange={(e) => setAmt({ ...amt, date: e.target.value })} /></Field>
          {num(amt.transfer) > 0 && <PhotoPicker value={slip} onChange={setSlip} label="หลักฐานการโอนเงิน (สลิป)" hint="แนบท้ายใบเสร็จเป็นหน้าที่ 2" />}
        </div>}
      </Modal>

      {/* ดู / พิมพ์ */}
      <Modal open={!!view} wide title={view ? `${view.status === PAID ? "ใบเสร็จรับเงิน" : "ใบแจ้งหนี้"} ${view.no ?? ""}${view.status === PARTIAL ? " · ชำระบางส่วน" : ""}` : ""} onClose={() => setView(null)}
        footer={<><button className="btn-soft" onClick={() => setView(null)}>ปิด</button><button className="btn-primary" disabled={!view?.no} onClick={() => window.print()}><Icon name="print" className="h-4 w-4" /> พิมพ์</button></>}>
        {view && <>
          <div className="bill-switch bill-summary">
            <div><span>สถานะ</span><StatusBadge value={view.status} /></div>
            <div><span>ยอดสุทธิ</span><b>{money(view.net)}</b></div>
            <div><span>ชำระแล้ว</span><b>{money(view.paid ?? 0)}</b></div>
            <div><span>คงเหลือ</span><b className={balanceOf(view) > 0 ? "text-red-700" : ""}>{money(balanceOf(view))}</b>{isOpen(view) && <small>{overdueDays(view) > 30 ? `เกินกำหนด ${overdueDays(view)} วัน` : `ค้าง ${overdueDays(view)} วัน`}</small>}</div>
            {isOpen(view) && <button className="btn-primary !py-2" onClick={() => { const x = view; setView(null); openPay(x); }}>รับชำระ</button>}
            {view.status === DRAFT && <span className="text-sm text-amber-800">ยังรับชำระไม่ได้ · กด ยืนยันยอด ในตารางก่อน</span>}
          </div>
          <div className="bill-switch mb-4 flex flex-wrap items-center gap-3">
            <Tabs tabs={["สำหรับผู้ชำระ", "สำหรับฝ่ายการเงิน"]} value={format === "customer" ? "สำหรับผู้ชำระ" : "สำหรับฝ่ายการเงิน"} onChange={(t) => setFormat(t === "สำหรับผู้ชำระ" ? "customer" : "finance")} />
            <Tabs tabs={["ต้นฉบับ", "สำเนา"]} value={copy ? "สำเนา" : "ต้นฉบับ"} onChange={(t) => setCopy(t === "สำเนา")} />
            {view.status === VOID && <span className="status-badge status-danger">เอกสารนี้ถูกยกเลิก</span>}
            {isOpen(view) && !isCN(view) && !view.id.startsWith("sample-") && <button type="button" className="btn-soft !min-h-0 !py-2 !text-sm" onClick={() => copyLine(view)}>คัดลอกข้อความแจ้งยอด (LINE)</button>}
            {canTax && <button type="button" className="btn-soft !min-h-0 !py-2 !text-sm sm:ml-auto" onClick={() => {
              const b = branchInfo(branchOfInv(view));
              setTaxDlg({ branch: b.name, taxId: b.taxId ?? "", office: b.office && b.office !== "สำนักงานใหญ่" ? b.office.replace(/\D/g, "") : "", hq: !b.office || b.office === "สำนักงานใหญ่" });
            }}>ข้อมูลผู้เสียภาษี</button>}
          </div>
          {!branchInfo(branchOfInv(view)).taxId && <p className="bill-switch mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            ยังไม่ได้ตั้งเลขประจำตัวผู้เสียภาษีของสาขา {branchOfInv(view)} · ใบกำกับภาษีต้องมีเลขนี้{canTax ? " · กดปุ่ม \"ข้อมูลผู้เสียภาษี\"" : " · แจ้งผู้จัดการสาขาให้ตั้ง"}
          </p>}
          {pays.length > 0 && (
            <div className="mb-4 space-y-2">
              <Tabs tabs={[view.status === PAID ? "ใบเสร็จรวม" : "ใบแจ้งหนี้", ...pays.filter((p) => p.kind !== "credit").map((p) => `ใบเสร็จ งวดที่ ${p.n}`)]}
                value={which === 0 ? (view.status === PAID ? "ใบเสร็จรวม" : "ใบแจ้งหนี้") : `ใบเสร็จ งวดที่ ${which}`}
                onChange={(t) => setWhich(t.startsWith("ใบเสร็จ งวด") ? Number(t.split(" ").pop()) : 0)} />
              <ul className="pay-history">
                {pays.map((p) => p.kind === "credit"
                  ? <li key={p.id}><b>หักด้วยใบลดหนี้</b> · {docDate(p.date)} · {money(p.amount)} บาท <small>· {p.note} · โดย {p.cashier || "-"}</small></li>
                  : <li key={p.id}><b>งวดที่ {p.n}</b> · {docDate(p.date)} · {money(p.amount - (p.wht ?? 0))} บาท <small>({[p.cash && `เงินสด ${money(p.cash)}`, p.credit && `บัตร ${money(p.credit)}`, p.transfer && `โอน ${money(p.transfer)}`, p.wht && `หัก ณ ที่จ่าย ${money(p.wht)}`].filter(Boolean).join(" · ")}){p.transferRef ? ` · อ้างอิงโอน ${p.transferRef}` : ""} · รับโดย {p.cashier || "-"}</small></li>)}
                {view.status === PARTIAL && <li className="is-left"><b>คงเหลือ {money(balanceOf(view))} บาท</b> <small>กด "รับชำระ" ที่รายการเพื่อรับงวดถัดไป</small></li>}
              </ul>
            </div>
          )}
          <BillDoc inv={view} branch={branchInfo(branchOfInv(view))} format={format} copy={copy} printedBy={user?.name ?? ""} pays={pays} detail={view.id.startsWith("sample-") && sampleOf ? sampleOf : billDetail(view)}
            payment={which > 0 ? pays[which - 1] : undefined}
            slips={format === "finance" ? (which > 0 ? (pays[which - 1]?.slip ? [pays[which - 1]] : []) : pays.filter((p) => p.slip)) : []} />
        </>}
      </Modal>

      {cn && (() => {
        // ลดได้ไม่เกินยอดใบเดิม − ใบลดหนี้ที่ออกไปแล้ว · ส่วนที่เกินยอดค้าง = ต้องคืนเงินลูกค้า
        const done = list.filter((y) => isCN(y) && y.ref === cn.x.no).reduce((n, y) => n + y.net, 0);
        const max = Math.max(0, Math.round((cn.x.net - done) * 100) / 100), a = num(cn.amount), owe = balanceOf(cn.x);
        const applied = Math.min(a, owe), back = Math.max(0, Math.round((a - applied) * 100) / 100);
        const reason = cn.reason === "อื่น ๆ" ? cn.other.trim() : cn.reason;
        const submit = async () => {
          if (cn.busy) return;
          if (!(a > 0)) return toast("กรุณาระบุยอดลดหนี้");
          if (a > max + 0.005) return toast(`ลดได้ไม่เกิน ${money(max)} บาท`);
          if (!reason) return toast("กรุณาระบุเหตุผล");
          setCn({ ...cn, busy: true });
          const r = await fetch("/api/billing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "credit_note", id: cn.x.id, amount: a, reason }) });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) { setCn({ ...cn, busy: false }); return toast(d.error || "ออกใบลดหนี้ไม่สำเร็จ"); }
          setCn(null); await refreshData("invoices"); setTab(CN_KIND);
          toast(`ออกใบลดหนี้ ${d.no ?? ""} แล้ว · ${money(a)} บาท${d.applied > 0 ? ` · หักยอดค้าง ${money(d.applied)}` : ""}${d.refund > 0 ? ` · ต้องคืนเงินลูกค้า ${money(d.refund)} บาท` : ""}`);
        };
        return <Modal open title={`ออกใบลดหนี้ · อ้างอิง ${cn.x.no ?? ""}`} onClose={() => setCn(null)}
          footer={<><button className="btn-soft" onClick={() => setCn(null)}>ยกเลิก</button><button className="btn-primary" disabled={cn.busy} onClick={submit}>{cn.busy ? "กำลังบันทึก…" : "ออกใบลดหนี้"}</button></>}>
          <div className="space-y-4">
            <div className="rounded-xl bg-cream-50 px-4 py-3 text-sm text-gold-700">
              <p>{cn.x.who} · {cn.x.kind} · ยอดสุทธิ {money(cn.x.net)} บาท · ชำระแล้ว {money(cn.x.paid ?? 0)} · ค้าง {money(owe)}</p>
              {done > 0 && <p className="mt-1">ออกใบลดหนี้ของใบนี้ไปแล้ว {money(done)} บาท</p>}
            </div>
            <p className="text-xs text-gold-600">ใช้เมื่อออกใบกำกับภาษีไปแล้วแต่ยอดต้องลดลง เช่น คิดเกิน หรือกลับบ้านก่อนกำหนด · ใบเดิมยังอยู่ ใบลดหนี้เป็นเอกสารใหม่อ้างอิงใบเดิม</p>
            <Field label={`ยอดลดหนี้ (รวม VAT) · ลดได้ไม่เกิน ${money(max)} บาท`} required>
              <div className="flex flex-wrap items-center gap-2">
                <input type="number" min={0} className="!w-44" value={cn.amount} onChange={(e) => setCn({ ...cn, amount: e.target.value })} />
                <button type="button" className="row-action" onClick={() => setCn({ ...cn, amount: String(max) })}>ลดเต็มจำนวน</button>
              </div>
            </Field>
            <Field label="เหตุผล" required>
              <select value={cn.reason} onChange={(e) => setCn({ ...cn, reason: e.target.value })}>{CN_REASONS.map((x) => <option key={x}>{x}</option>)}</select>
              {cn.reason === "อื่น ๆ" && <input className="mt-2" value={cn.other} placeholder="ระบุเหตุผล" onChange={(e) => setCn({ ...cn, other: e.target.value })} />}
            </Field>
            {a > 0 && <p className={`rounded-xl px-4 py-2 text-sm ${a > max + 0.005 ? "bg-red-50 text-red-700" : "bg-gold-50 text-gold-800"}`}>
              {a > max + 0.005 ? `เกินยอดที่ลดได้ ${money(max)} บาท` : <>หักยอดค้างของใบเดิม <b>{money(applied)}</b> บาท{back > 0 ? <> · <b>ต้องคืนเงินลูกค้า {money(back)} บาท</b> (กด &quot;บันทึกคืนเงิน&quot; หลังคืนแล้ว)</> : ""}</>}
            </p>}
          </div>
        </Modal>;
      })()}
      {refund && <Modal open title={`บันทึกคืนเงิน · ${refund.x.no ?? ""}`} onClose={() => setRefund(null)}
        footer={<><button className="btn-soft" onClick={() => setRefund(null)}>ยกเลิก</button><button className="btn-primary" disabled={refund.busy} onClick={async () => {
          setRefund({ ...refund, busy: true });
          const r = await fetch("/api/billing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "refund_done", id: refund.x.id, method: refund.method }) });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) { setRefund({ ...refund, busy: false }); return toast(d.error || "บันทึกไม่สำเร็จ"); }
          setRefund(null); await refreshData("invoices"); toast(`บันทึกคืนเงินแล้ว · ${refund.x.no ?? ""}`);
        }}>{refund.busy ? "กำลังบันทึก…" : "ยืนยันว่าคืนเงินแล้ว"}</button></>}>
        <div className="space-y-4">
          <p className="text-sm text-gold-700">{refund.x.who} · {refund.x.note}</p>
          <Field label="คืนเงินด้วย"><select value={refund.method} onChange={(e) => setRefund({ ...refund, method: e.target.value })}>{["โอนเงิน", "เงินสด", "หักจากเงินประกัน", "อื่น ๆ"].map((x) => <option key={x}>{x}</option>)}</select></Field>
          <p className="field-hint">คืนเป็นเงินสดจากลิ้นชัก ให้ใส่หมายเหตุไว้ด้วย (ระบบไม่หักเงินสดในลิ้นชักให้เอง)</p>
        </div>
      </Modal>}

      <Modal open={!!taxDlg} title="ข้อมูลผู้เสียภาษี" onClose={() => setTaxDlg(null)}
        footer={<><button className="btn-soft" onClick={() => setTaxDlg(null)}>ยกเลิก</button><button className="btn-primary" onClick={async () => {
          if (!taxDlg) return;
          const id = taxDlg.taxId.replace(/\D/g, "");
          if (id.length !== 13) return toast("เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก");
          if (!taxDlg.hq && !/^\d{1,5}$/.test(taxDlg.office)) return toast("ใส่เลขสาขา 5 หลัก เช่น 00001");
          try {
            await saveTaxInfo(taxDlg.branch, { taxId: id, office: taxDlg.hq ? "สำนักงานใหญ่" : `สาขาที่ ${taxDlg.office.padStart(5, "0")}` });
            toast(`บันทึกข้อมูลผู้เสียภาษีของสาขา ${taxDlg.branch} แล้ว`); setTaxDlg(null);
          } catch (e) { toast((e as Error).message); }
        }}>บันทึก</button></>}>
        {taxDlg && <div className="space-y-4">
          <p className="text-sm text-gold-700">ขึ้นที่หัวใบเสร็จรับเงิน / ใบกำกับภาษี ของสาขา <b className="font-semibold text-gold-800">{taxDlg.branch}</b></p>
          <Field label="เลขประจำตัวผู้เสียภาษี (13 หลัก)" required>
            <input inputMode="numeric" maxLength={17} value={taxDlg.taxId} onChange={(e) => setTaxDlg({ ...taxDlg, taxId: e.target.value })} placeholder="0105555000000" />
          </Field>
          <Field label="ที่ตั้งตามทะเบียนภาษี">
            <div className="flex flex-wrap items-center gap-3">
              <Tabs tabs={["สำนักงานใหญ่", "สาขา"]} value={taxDlg.hq ? "สำนักงานใหญ่" : "สาขา"} onChange={(t) => setTaxDlg({ ...taxDlg, hq: t === "สำนักงานใหญ่" })} />
              {!taxDlg.hq && <input inputMode="numeric" maxLength={5} value={taxDlg.office} onChange={(e) => setTaxDlg({ ...taxDlg, office: e.target.value.replace(/\D/g, "") })} placeholder="เลขสาขา เช่น 00001" className="!w-48" aria-label="เลขสาขา" />}
            </div>
          </Field>
        </div>}
      </Modal>
    </>
  );
}

/**
 * ใบแจ้งหนี้แรกเข้าจากสัญญาใหม่ · แจกแจงค่าห้องตามสัญญา · คืน null ถ้าสัญญาไม่มีรายการค่าบริการเลย
 *  กรอกยอดล่วงหน้าหรือเงินประกัน = ค้างชำระ (เรียกเก็บได้ทันที) · ไม่ได้กรอก = รอตรวจสอบยอด (การเงินตรวจแล้วกดยืนยันยอดก่อนรับชำระ)
 */
export function contractInvoice(row: string[], hn: string, prior: Invoice[] = []): Invoice | null {
  const items = contractStartLines(row, prior);
  if (!items.length) return null;
  const ready = !!(val(row[18]) || val(row[19]));
  const note = [contractStartNote(row, prior), ready ? "" : "ออกอัตโนมัติจากสัญญา (ไม่ได้ระบุยอดล่วงหน้า) · รอการเงินตรวจสอบยอดก่อนเรียกเก็บ"].filter(Boolean).join(" · ");
  return { id: newId(), date: todayIso(), who: row[2], hn, payer: row[3], address: row[10] ?? "", kind: BILL_KINDS[0], contract: row[0], items: JSON.stringify(items), ...totals(items), status: ready ? UNPAID : DRAFT, note };
}
