/**
 * กระจายยอดใบแจ้งหนี้ตามช่วงบริการ (ใช้ร่วมกันทั้ง CSV และ Dashboard KPI ให้ตัวเลขตรงกัน)
 *
 * ช่วงบริการของใบ
 *  - ใบแรกเข้าของสัญญา: วันเริ่มสัญญา ถึงวันก่อนครบจำนวนเดือนที่ชำระล่วงหน้า (พักรายวัน/สัปดาห์ = ตามจำนวนวัน)
 *  - ใบค่าบริการรายเดือน: วันที่ตรงกับวันเริ่มสัญญาในเดือนของใบ ถึงวันก่อนเดือนถัดไป (ไม่มีสัญญา = ทั้งเดือนปฏิทินของใบ)
 *  - ใบพักรายวัน/สัปดาห์ที่ไม่มีสัญญา: วันที่ออกใบ + จำนวนวันในรายการ
 *  - อื่น ๆ (ยา เวชภัณฑ์ คอร์ส D/C ใบลดหนี้): ไม่มีช่วง นับทั้งก้อนในวันที่ออกใบ
 * บรรทัดที่กระจาย = ค่าห้อง ค่าบริการทางการแพทย์ และบริการรายเดือนตามสัญญา · ไม่กระจาย = เงินประกัน มัดจำ ยา เวชภัณฑ์ คอร์ส บรรทัดหักเงิน
 * ยอดในช่วงที่เลือก = ยอดบรรทัด (รวม VAT) × จำนวนวันที่ทับช่วง ÷ จำนวนวันของช่วงบริการ
 */
import { BillItem, BILL_KINDS, contractLines, contractMonthLines, groupOf, inclNet, Invoice, isCN, isStayContract, lineSign, parseItems, totals } from "./billing";
import { lineCode } from "./priceList";

export type Period = { from: string; to: string };
const TH_MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
/** 2026-11-10 → 10 พ.ย. 2569 */
export const thDateText = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return `${d} ${TH_MON[m - 1]} ${y + 543}`; };
/** ระยะเวลาบริการแบบอ่านง่าย: 10 พ.ย. 2569 – 9 ธ.ค. 2569 */
export const periodText = (p: Period | null) => (p ? (p.from === p.to ? thDateText(p.from) : `${thDateText(p.from)} – ${thDateText(p.to)}`) : "");
const DAY = 864e5;
const d0 = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const isoOf = (t: number) => new Date(t).toISOString().slice(0, 10);
export const addDaysIso = (iso: string, n: number) => isoOf(d0(iso) + n * DAY);
/** วันที่เดียวกันของ n เดือนถัดไป (วันเกินเดือน = วันสุดท้ายของเดือน) */
export function addMonthsIso(iso: string, n: number) {
  const [y, m, d] = iso.split("-").map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return isoOf(Date.UTC(y, m - 1 + n, Math.min(d, last)));
}
/** วันที่ในสัญญา (วว/ดด/ปปปป พ.ศ. หรือ YYYY-MM-DD) → YYYY-MM-DD */
export function contractDateIso(v?: string) {
  const t = String(v ?? "").trim(), iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/), th = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (iso) return `${Number(iso[1]) > 2400 ? Number(iso[1]) - 543 : iso[1]}-${iso[2]}-${iso[3]}`;
  if (th) return `${Number(th[3]) > 2400 ? Number(th[3]) - 543 : th[3]}-${th[2].padStart(2, "0")}-${th[1].padStart(2, "0")}`;
  return "";
}
const num = (v?: string) => Number(String(v ?? "").replace(/,/g, "")) || 0;
/** จำนวนเดือนที่ชำระล่วงหน้าของสัญญา (เหมือน prepaidMonths ในหน้าใบแจ้งหนี้) */
function prepaidMonthsOf(c: string[]) { const p = num(c[18]), m = totals(contractMonthLines(c)).net; return p && m ? Math.min(12, Math.max(1, Math.round(p / m))) : 1; }
/** บรรทัดที่กระจายตามช่วงบริการ */
export function spreads(i: BillItem) {
  if (i.credit) return false;
  const d = i.desc.trim(), code = lineCode(i);
  if (code === "DP-01" || code === "DP-02" || /^(ยา|เวชภัณฑ์):|^เงินประกัน|^มัดจำ|คอร์ส/.test(d)) return false;
  return true;
}
/** ใบมัดจำค่าห้องตอนจอง (มีแต่ DP-02) */
const bookingOnly = (items: BillItem[]) => { const s = items.filter((i) => !i.credit && i.desc.trim()); return s.length > 0 && s.every((i) => lineCode(i) === "DP-02"); };

/** ช่วงบริการของใบ · null = ไม่มีช่วง (นับทั้งก้อนในวันที่ออกใบ) */
export function invoicePeriod(x: Invoice, contracts: string[][] = []): Period | null {
  if (isCN(x)) return null;
  const items = parseItems(x.items);
  if (bookingOnly(items)) return null;
  const c = x.contract ? contracts.find((r) => r[0] === x.contract) : undefined;
  const start = c ? contractDateIso(c[7]) : "";
  const stay = c ? contractLines(c).find((l) => l.stay) : undefined;
  // พักรายวัน/สัปดาห์ (จากสัญญา หรือจากชื่อรายการในใบ)
  const stayLine = items.find((i) => /ราย(วัน|สัปดาห์)/.test(i.desc) && !i.credit);
  if (stay || stayLine) {
    const weeks = stay ? stay.stay === "สัปดาห์" : /รายสัปดาห์/.test(stayLine!.desc);
    const n = stay?.n ?? (Number(stayLine!.desc.match(/(\d+)\s*(วัน|สัปดาห์)/)?.[1]) || stayLine!.qty || 1);
    const from = x.kind === BILL_KINDS[0] && start ? start : x.date.slice(0, 10);
    return { from, to: addDaysIso(from, n * (weeks ? 7 : 1) - 1) };
  }
  if (x.kind === BILL_KINDS[0] && start) return { from: start, to: addDaysIso(addMonthsIso(start, c ? prepaidMonthsOf(c) : 1), -1) };
  if (x.kind === BILL_KINDS[1]) {
    // เดือนของใบ: จากหมายเหตุ "ค่าบริการประจำเดือน 11/2569" หรือวันที่ออกใบ
    const nm = String(x.note ?? "").match(/ประจำเดือน\s*(\d{1,2})[/-](\d{4})/);
    const ym = nm ? `${Number(nm[2]) > 2400 ? Number(nm[2]) - 543 : nm[2]}-${nm[1].padStart(2, "0")}` : x.date.slice(0, 7);
    if (start) { const day = Number(start.slice(8, 10)), last = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate(); const from = `${ym}-${String(Math.min(day, last)).padStart(2, "0")}`; return { from, to: addDaysIso(addMonthsIso(from, 1), -1) }; }
    const last = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
    return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, "0")}` };
  }
  return null;
}

/** วันนี้ตามเวลาไทย (YYYY-MM-DD) */
export const bkkToday = () => new Date(Date.now() + 7 * 36e5).toISOString().slice(0, 10);
/** แจ้งรอบบิลล่วงหน้ากี่วัน */
export const DUE_AHEAD = 7;
/**
 * รอบบิลถัดไปของสัญญารายเดือน = วันถัดจากวันสุดท้ายที่มีใบแรกเข้า/ใบรายเดือนครอบคลุมแล้ว (ไม่มีใบ = วันเริ่มสัญญา)
 *  ใช้ร่วมกันทั้งแถบ "ต้องจัดการ" (server) หน้าใบแจ้งหนี้ และรายการสัญญา · null = พักรายวัน/สัปดาห์ หรือยังไม่มีวันเริ่ม
 */
export function nextCycle(c: string[], invoices: Invoice[]): string | null {
  // พักรายวัน/สัปดาห์ (เก็บครั้งเดียว) หรือสัญญาที่ไม่มีค่าบริการรายเดือน = ไม่มีรอบบิล
  if (isStayContract(c) || totals(contractMonthLines(c)).net <= 0) return null;
  const start = contractDateIso(c[7]);
  if (!start) return null;
  let until = "";
  for (const x of invoices) {
    if (x.contract !== c[0] || x.status === "ยกเลิก" || isCN(x) || (x.kind !== BILL_KINDS[0] && x.kind !== BILL_KINDS[1])) continue;
    const p = invoicePeriod(x, [c]);
    if (p && p.to > until) until = p.to;
  }
  return until ? addDaysIso(until, 1) : start;
}
/** ครบรอบบิลแล้วหรือจะครบภายใน DUE_AHEAD วัน */
export const cycleDue = (next: string | null, today = bkkToday()) => !!next && next <= addDaysIso(today, DUE_AHEAD);
/** หมายเหตุใบรายเดือนของรอบที่เริ่มวันที่ next: "ค่าบริการประจำเดือน 12/2569" (invoicePeriod อ่านเดือนจากหมายเหตุนี้) */
export const cycleNote = (next: string) => `ค่าบริการประจำเดือน ${next.slice(5, 7)}/${Number(next.slice(0, 4)) + 543}`;

export type AllocLine = { line: BillItem; k: number; grp: string; incl: number; period: Period | null; days: number; inDays: number; alloc: number; vatAlloc: number };
/**
 * ยอดของแต่ละบรรทัดในช่วง from–to (ว่าง = ทุกวันที่) · ใบลดหนี้ติดลบ
 *  บรรทัดที่ไม่กระจาย นับเต็มถ้าวันที่ออกใบอยู่ในช่วง
 */
export function allocate(x: Invoice, contracts: string[][], from = "", to = ""): AllocLine[] {
  const p = invoicePeriod(x, contracts), sg = lineSign(x), inR = (d: string) => !from || (d >= from && d <= to);
  return parseItems(x.items).map((l, k) => ({ l, k })).filter(({ l }) => !l.credit && l.desc.trim()).map(({ l, k }) => {
    const incl = Math.round(sg * inclNet(l) * 100) / 100, vatPart = l.vat ? Math.round((incl - incl / (1 + l.vat / 100)) * 100) / 100 : 0;
    const g = groupOf(l);
    if (p && spreads(l)) {
      const days = Math.round((d0(p.to) - d0(p.from)) / DAY) + 1;
      const a = from && from > p.from ? from : p.from, b = to && to < p.to ? to : p.to;
      const inDays = b >= a ? Math.round((d0(b) - d0(a)) / DAY) + 1 : 0;
      const share = days > 0 ? inDays / days : 0;
      return { line: l, k, grp: g, incl, period: p, days, inDays, alloc: Math.round(incl * share * 100) / 100, vatAlloc: Math.round(vatPart * share * 100) / 100 };
    }
    const hit = inR(x.date.slice(0, 10));
    return { line: l, k, grp: g, incl, period: null, days: 1, inDays: hit ? 1 : 0, alloc: hit ? incl : 0, vatAlloc: hit ? vatPart : 0 };
  });
}
/** รายได้ตามช่วงบริการ (รวม VAT) ของรายการใบ ในช่วง from–to · ไม่นับใบยกเลิก/รอตรวจสอบยอด */
export function revenueIn(list: Invoice[], contracts: string[][], from: string, to: string) {
  return Math.round(list.filter((x) => x.status !== "ยกเลิก" && x.status !== "รอตรวจสอบยอด").reduce((n, x) => n + allocate(x, contracts, from, to).reduce((m, a) => m + a.alloc, 0), 0) * 100) / 100;
}
/** วิธีชำระของใบ: เงินสด / โอนเงิน / บัตรเครดิต (หลายวิธี = รวมพร้อมยอด) · ยังไม่ชำระ = "-" */
export function payMethodOf(x: Invoice) {
  const m = ([["เงินสด", x.cash], ["โอนเงิน", x.transfer], ["บัตรเครดิต", x.credit]] as const).filter(([, v]) => (v ?? 0) > 0);
  if (!m.length) return (x.paid ?? 0) > 0 ? "ลดหนี้ / หักยอด" : "-";
  return m.length === 1 ? m[0][0] : m.map(([t, v]) => `${t} ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2 })}`).join(" + ");
}
