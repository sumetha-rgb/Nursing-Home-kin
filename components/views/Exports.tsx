"use client";
import { useEffect, useMemo, useState } from "react";
import Icon from "../Icon";
import CsvIcon from "../CsvIcon";
import { PageHeader } from "../ui";
import { useApp } from "@/lib/app";
import { useSession } from "@/lib/session";
import { seesAllBranches } from "@/lib/roles";
import { can, Perm, seesMoney } from "@/lib/perms";
import { ViewId } from "@/lib/nav";
import { useBranchNames } from "@/lib/branches";
import { usePriceList } from "@/lib/usePrices";
import { downloadCsv, fetchKey } from "@/lib/store";
import { csvDate, DRAFT, Invoice, invoiceBranch, isCN, isOpen, todayIso, VOID } from "@/lib/billing";
import { RangePicker } from "../PeriodPicker";
import { canSalesTax } from "@/lib/settingsAccess";
import { exportInvoiceLines, exportPayments } from "@/lib/billingExport";
import { debtorsCsv, debtorsOf, personKey, salesItemsCsv, spendLines, spendLinesCsv, spendPeople, spendSummaryCsv, serviceLinesCsv } from "@/lib/exportsCsv";
import { CATS, PriceItem, rateCode } from "@/lib/priceList";
import { apptIso, apptKey, nowTh } from "@/lib/appointments";
import { invoiceDocsCsv } from "@/lib/exportsCsv";
import { contractsCsv } from "../billing/contractsCsv";
import { BRANCH_COLS, BRANCH_IDX } from "./Admin";
import { FAC_CSV_COLS, MT_COLS, mtRow } from "./Tasks";

/**
 * หน้า "ส่งออกข้อมูล" (เมนูบริหาร) · รวมไฟล์ CSV ของทั้งระบบไว้ที่เดียว แยก 5 หมวด
 *  ตัวเลือกกลาง: ช่วงวันที่ (วันนี้ / สัปดาห์นี้ / เดือนนี้ / เดือนที่แล้ว / เลือกเอง) และสาขา (ผู้บริหาร) · ใช้กับไฟล์ที่มีป้าย "ตามช่วงวันที่"
 *  แต่ละไฟล์แสดงเฉพาะคนที่มีสิทธิ์หน้าต้นทาง · ข้อมูลดึงใหม่จากฐานข้อมูลทุกครั้งที่กด (ฝั่ง server จำกัดสาขาตามบัญชีอยู่แล้ว)
 *  ไฟล์ที่ต้องใช้ตัวกรองของหน้านั้นเอง (เช่น ตารางเวร KPI) เป็นปุ่ม "ไปหน้า…" แทน · ปุ่ม CSV เดิมในแต่ละหน้ายังอยู่ครบ
 */
type Ctx = { from: string; to: string; branch: string; inRange: (d: string) => boolean; tag: string; userBranch?: string; prices: PriceItem[] };
/** money = ไฟล์เงินและการขาย: เฉพาะคนที่เห็นตัวเลขเงิน (lib/perms seesMoney) แม้มีสิทธิ์หน้าต้นทาง */
/** salesTax = หน้ารายงานภาษีขาย / รายได้ตามฝ่าย / รับเงินแยกตามบัญชี: ผู้บริหาร ผู้จัดการสาขา การเงิน (เกณฑ์เดียวกับเมนู · lib/settingsAccess) */
type Item = { id: string; t: string; d: string; rng?: boolean; pdpa?: boolean; money?: boolean; salesTax?: boolean; perms: Perm[]; run?: (c: Ctx) => Promise<number>; link?: { view: ViewId; where: string } };
type Group = { id: string; name: string; hint: string; icon: string; items: Item[] };

const thd = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}-${m}-${Number(y) + 543}`; };
const iso = (dt: Date) => dt.toISOString().slice(0, 10);
/** วันที่ในข้อมูลได้หลายแบบ: 2026-10-30 · 30/10/2569 · 30-10-2569 → 2026-10-30 */
const isoOf = (v?: string) => {
  const s = String(v ?? "");
  const a = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (a) return `${a[1]}-${a[2]}-${a[3]}`;
  const b = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/); if (!b) return "";
  const y = +b[3] > 2400 ? +b[3] - 543 : +b[3];
  return `${y}-${b[2].padStart(2, "0")}-${b[1].padStart(2, "0")}`;
};

/** ใบแจ้งหนี้ + สาขาของแต่ละใบ (ดูจากสัญญา หรือผู้รับบริการ) */
async function invoicesWithBranch(c: Ctx) {
  const [inv, con, res] = await Promise.all([fetchKey<Invoice>("invoices"), fetchKey<string[]>("contracts"), fetchKey<string[]>("residents")]);
  const branchOf = (x: Invoice) => invoiceBranch(x, con, res, c.userBranch);
  return { list: inv.filter((x) => !c.branch || branchOf(x) === c.branch), branchOf };
}
const getJson = async (url: string) => { const r = await fetch(url, { cache: "no-store" }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "ดึงข้อมูลไม่สำเร็จ"); return j; };
const qsOf = (c: Ctx) => `from=${c.from}&to=${c.to}${c.branch ? `&branch=${encodeURIComponent(c.branch)}` : ""}`;
const num = (v: unknown) => (v === null || v === undefined || v === "" ? "" : String(Math.round(Number(v) * 100) / 100));
const timeOf = (v?: string) => String(v ?? "").match(/(\d{1,2}:\d{2})/)?.[1] ?? "";
const audit = (what: string, count: number) => fetch("/api/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ what, count }) }).catch(() => {});

const GROUPS: Group[] = [
  { id: "fin", name: "การเงินและบัญชี", hint: "ส่งฝ่ายบัญชี กระทบยอดธนาคาร", icon: "receipt", items: [
    { id: "docs", t: "เอกสารการเงินทั้งหมด", d: "1 แถวต่อใบ: เลขที่ วันที่ ผู้รับบริการ ยอดสุทธิ ชำระแล้ว คงเหลือ สถานะ", rng: true, perms: ["billing"],
      run: async (c) => { const { list, branchOf } = await invoicesWithBranch(c); return invoiceDocsCsv(list.filter((x) => c.inRange(x.date)), branchOf, `การเงิน-เอกสาร-${c.tag}`); } },
    { id: "owing", t: "คนที่ค้างชำระ", d: "รายการที่ยังค้างชำระ เรียงตามคน · แบ่งยอดตามช่วงบริการที่อยู่ในช่วงวันที่ · VAT", rng: true, perms: ["billing"],
      run: async (c) => { const { list, branchOf } = await invoicesWithBranch(c); return serviceLinesCsv(list.filter((x) => isOpen(x) && !isCN(x)), await fetchKey<string[]>("contracts"), branchOf, `การเงิน-ค้างชำระ-${c.tag}`, c.from, c.to); } },
    { id: "paidAll", t: "ชำระครบแล้ว", d: "รายการที่ชำระครบแล้ว เรียงตามคน · แบ่งยอดตามช่วงบริการ · พร้อมวิธีชำระ", rng: true, perms: ["billing"],
      run: async (c) => { const { list, branchOf } = await invoicesWithBranch(c); return serviceLinesCsv(list.filter((x) => x.status === "ชำระแล้ว" && !isCN(x)), await fetchKey<string[]>("contracts"), branchOf, `การเงิน-ชำระครบ-${c.tag}`, c.from, c.to); } },
    { id: "lines", t: "รายการในใบ (แยกหมวด)", d: "1 แถวต่อบรรทัด: รหัสสินค้า รายการ หมวด จำนวน ราคา ส่วนลด VAT ยอดสุทธิ", rng: true, perms: ["billing"],
      run: async (c) => { const { list, branchOf } = await invoicesWithBranch(c); return exportInvoiceLines(list.filter((x) => c.inRange(x.date)), branchOf, `การเงิน-รายการในใบ-${c.tag}`); } },
    { id: "pays", t: "การรับเงินรายงวด", d: "ทุกครั้งที่รับเงิน: วันที่ เลขที่ใบเสร็จ เงินสด โอน บัตร บัญชีที่รับ ผู้รับเงิน มีสลิปไหม", rng: true, perms: ["billing"],
      run: (c) => exportPayments(c.branch, `การเงิน-การรับเงินรายงวด-${c.tag}`, c.inRange) },
    { id: "aging", t: "ลูกหนี้ค้างชำระตามอายุหนี้", d: "ใบที่ยังชำระไม่ครบ แยก 0–30 / 31–60 / 61–90 / เกิน 90 วัน รายคน", perms: ["billing"],
      run: async (c) => { const { list, branchOf } = await invoicesWithBranch(c); return debtorsCsv(debtorsOf(list.filter((x) => x.status !== VOID), branchOf).debtors, `ลูกหนี้ตามอายุหนี้-${todayIso()}${c.branch ? `-${c.branch}` : ""}`); } },
    { id: "salestax", t: "รายงานภาษีขาย", d: "ใบที่มี VAT เรียงตามวันที่ แยกตามบริษัท", money: true, salesTax: true, perms: ["billing"], link: { view: "sales_tax", where: "รายงานภาษีขาย › ส่งออก CSV" } },
    { id: "deposits", t: "รับเงินแยกตามบัญชี", d: "ช่องทาง บัญชีธนาคาร / เครื่อง EDC และเป็นค่าอะไร", money: true, salesTax: true, perms: ["billing"], link: { view: "deposits", where: "รับเงินแยกตามบัญชี › ส่งออก CSV" } },
    { id: "revenue", t: "รายได้ตามฝ่าย", d: "ยอดออกใบ รับเงินจริง ก่อน VAT และ VAT ตามบริษัทและฝ่าย", money: true, salesTax: true, perms: ["billing"], link: { view: "revenue", where: "รายได้ตามฝ่าย › ส่งออก CSV" } },
    { id: "monthly", t: "สรุปการเงินรายเดือน (12 เดือน)", d: "ยอดออกใบ ส่วนลด รับชำระ ต่อเดือน", money: true, perms: ["dashboard"], link: { view: "dashboard", where: "ภาพรวมและรายงาน › แท็บการเงิน" } },
  ] },
  { id: "sales", name: "ยอดขาย", hint: "อะไรขายดี ใครซื้ออะไร จ่ายเท่าไร", icon: "chart", items: [
    { id: "items", t: "ยอดขายตามรายการ", d: "สาขา รหัส รายการ หมวด จำนวน ครั้งที่ขาย ยอดขาย สัดส่วน % (หลังส่วนลด ก่อน VAT)", rng: true, money: true, perms: ["billing", "dashboard"],
      run: async (c) => { const { list, branchOf } = await invoicesWithBranch(c); return salesItemsCsv(list, c.prices, c.inRange, `ยอดขายตามรายการ-${c.tag}`, branchOf); } },
    { id: "spend", t: "ค่าใช้จ่ายรายบุคคล · สรุปรายคน", d: "1 แถวต่อคน: ยอดแยกหมวด รวมเรียกเก็บ ชำระแล้ว ค้างชำระ", rng: true, pdpa: true, money: true, perms: ["billing", "dashboard"],
      run: async (c) => {
        const { list, branchOf } = await invoicesWithBranch(c);
        const invs = list.filter((x) => x.status !== VOID && x.status !== DRAFT && c.inRange(x.date)), lines = spendLines(invs, c.prices), { cols, people } = spendPeople(invs, lines, branchOf);
        const n = spendSummaryCsv(people.sort((a, b) => b.billed - a.billed), cols, `ค่าใช้จ่ายรายบุคคล-${c.tag}`); audit("spend", n); return n;
      } },
    { id: "spendLines", t: "รายการที่ซื้อ · ทุกคน", d: "ทุกบรรทัด: ผู้รับบริการ วันที่ เลขที่ใบ รหัสสินค้า ชื่อ จำนวน ราคาต่อหน่วย ยอดที่จ่าย", rng: true, pdpa: true, money: true, perms: ["billing", "dashboard"],
      run: async (c) => {
        const { list, branchOf } = await invoicesWithBranch(c);
        const invs = list.filter((x) => x.status !== VOID && x.status !== DRAFT && c.inRange(x.date));
        const n = spendLinesCsv(spendLines(invs, c.prices).filter((l) => personKey(l.x)), branchOf, `รายการที่ซื้อ-ทุกคน-${c.tag}`); audit("spend", n); return n;
      } },
    { id: "quotes", t: "ใบเสนอราคา", d: "เลขที่ วันที่ สาขา ผู้รับบริการ ผู้ชำระ แผน ยอดรวม และเลขที่สัญญาที่ปิดได้", rng: true, perms: ["quotations"],
      run: async (c) => {
        const [all, br] = await Promise.all([fetchKey<string[]>("assessments"), getJson("/api/care?op=quote_branches").catch(() => ({ items: [] }))]);
        const brOf = new Map(((br.items ?? []) as { no: string; branch: string }[]).map((x) => [x.no, x.branch]));
        const rows = all.filter((x) => { const d = isoOf(x[7]); return (!d || c.inRange(d)) && (!c.branch || brOf.get(x[6]) === c.branch); });
        const blank = (v?: string) => (!v || v.trim() === "-" ? "" : v);
        const baht = (v?: string) => { const n = Number(String(v ?? "").replace(/,/g, "")); return v && Number.isFinite(n) ? n.toLocaleString("en-US", { maximumFractionDigits: 2 }) : ""; };
        downloadCsv(`ใบเสนอราคา-${c.tag}`, ["เลขที่", "วันที่", "สาขา", "ผู้รับบริการ", "ผู้ชำระ", "แผน", "ยอดรวม (บาท)", "เลขที่สัญญาที่ปิดได้"],
          rows.map((x) => [x[6], csvDate(isoOf(x[7])) || x[7], brOf.get(x[6]) ?? "", x[1], blank(x[9]), x[0], baht(x[4]), blank(x[12])]));
        return rows.length;
      } },
  ] },
  { id: "care", name: "ผู้รับบริการและการดูแล", hint: "สัญญา การเข้าพัก สุขภาพ นัดหมาย", icon: "user", items: [
    { id: "contracts", t: "ทะเบียนสัญญาบริการ", d: "ทุกสัญญา: ผู้รับบริการ ผู้ว่าจ้าง ห้อง ค่าบริการ เงินประกัน สถานะ", pdpa: true, perms: ["contracts"],
      run: async (c) => { const rows = (await fetchKey<string[]>("contracts")).filter((r) => !c.branch || r[1] === c.branch); return contractsCsv(rows, `ทะเบียนสัญญา-ข้อมูลส่วนบุคคล-${todayIso()}${c.branch ? `-${c.branch}` : ""}`); } },
    { id: "appts", t: "นัดหมาย", d: "วันที่ เวลา สาขา ผู้รับบริการ HN ห้อง เตียง รายการ สถานที่ การเดินทาง ผู้พาไป การเตรียมตัว สถานะ", rng: true, pdpa: true, perms: ["appointments"],
      run: async (c) => {
        const [rows, res] = await Promise.all([fetchKey<string[]>("appointments"), fetchKey<string[]>("residents")]);
        const resOf = (n: string) => res.find((r) => r[0] === n);
        const now = nowTh(), today = now.slice(0, 10);
        const list = rows.filter((r) => c.inRange(apptIso(r[0])) && (!c.branch || resOf(r[2])?.[3] === c.branch)).sort((a, b) => apptKey(a).localeCompare(apptKey(b)));
        // ทะเบียนผู้รับบริการ: [ชื่อ, อายุ, ห้อง, สาขา, โรคประจำตัว, สถานะ, HN, เตียง] · HN ห้อง เตียง แยกช่อง กรองใน Excel ได้
        const v = (x?: string) => (x && x.trim() !== "-" ? x : "");
        downloadCsv(`นัดหมาย-${c.tag}`, ["วันที่", "เวลา", "สาขา", "ผู้รับบริการ", "HN", "ห้อง", "เตียง", "รายการ", "สถานที่", "การเดินทาง", "ผู้พาไป", "การเตรียมตัว", "สถานะ"], list.map((r) => {
          const p = resOf(r[2]), k = apptKey(r);
          return [csvDate(apptIso(r[0])) || r[0], (r[1] ?? "").slice(0, 5), v(p?.[3]), r[2], v(p?.[6]), v(p?.[2]), v(p?.[7]), r[3], v(r[7]), v(r[6]), v(r[4]), v(r[5]), k < now ? "ผ่านแล้ว" : k.startsWith(today) ? "วันนี้" : "กำลังจะมาถึง"];
        }));
        audit("appointments", list.length); return list.length;
      } },
    { id: "occ", t: "การเข้าพักรายสาขา", d: "เตียงทั้งหมด ผู้พักอยู่ เตียงว่าง อัตราการเข้าพัก", perms: ["dashboard"], link: { view: "dashboard", where: "ภาพรวมและรายงาน › แท็บการเข้าพัก" } },
    { id: "health", t: "บันทึกสุขภาพ", d: "สัญญาณชีพ น้ำตาล ออกซิเจน และค่าที่ผิดปกติ", pdpa: true, perms: ["health_logs"], link: { view: "health_logs", where: "บันทึกสุขภาพ › ส่งออก CSV (ตามคนและช่วงที่กรอง)" } },
    { id: "history", t: "งานดูแลย้อนหลัง", d: "งานประจำวันที่ทำแล้ว ผู้ทำ เวลา และผลตรวจงาน", pdpa: true, perms: ["tasks_table"], link: { view: "tasks_table", where: "งานดูแลย้อนหลัง › เลือกช่วงแล้วกดส่งออก CSV" } },
    { id: "courses", t: "คอร์สกายภาพ", d: "คอร์สที่ใช้อยู่ ใช้ไปกี่ครั้ง เหลือกี่ครั้ง (คนที่มีสิทธิ์การเงินเห็นราคาด้วย)", perms: ["dashboard"], link: { view: "dashboard", where: "ภาพรวมและรายงาน › แท็บกายภาพ" } },
  ] },
  { id: "quality", name: "การให้ยาและคุณภาพการดูแล", hint: "การให้ยา รอบวัด เสียงจากครอบครัว เหตุการณ์", icon: "pill", items: [
    { id: "mar", t: "บันทึกการให้ยา (MAR)", d: "ทุกครั้งที่ให้ยา: วันที่ เวลา ผู้รับบริการ ห้อง ยา มื้อ จำนวน ผล (ให้แล้ว / ไม่ได้ให้ / ยกเลิก) เหตุผล ผู้ให้ยา คงเหลือก่อนและหลัง", rng: true, pdpa: true, perms: ["app.pharmacy", "app.staff"],
      run: async (c) => {
        const { items } = await getJson(`/api/pharmstock?op=mar&${qsOf(c)}`) as { items: Record<string, string | number | boolean | null>[] };
        downloadCsv(`บันทึกการให้ยา-${c.tag}`, ["วันที่", "เวลา", "สาขา", "ผู้รับบริการ", "ห้อง", "ยา", "มื้อ", "จำนวน", "หน่วย", "ผล", "เหตุผลที่ไม่ได้ให้", "ผู้ให้ยา", "คงเหลือก่อน", "คงเหลือหลัง", "หมายเหตุ", "ยกเลิก"],
          items.map((x) => [csvDate(String(x.day)), String(x.time ?? ""), String(x.branch ?? ""), String(x.resident ?? ""), x.room && x.room !== "-" ? String(x.room) : "", String(x.drug ?? ""), String(x.meal ?? ""),
            num(x.qty), String(x.unit ?? ""), x.voided ? "ยกเลิก" : x.skip ? "ไม่ได้ให้" : "ให้แล้ว", String(x.skip ?? ""), String(x.by ?? ""), num(x.b), num(x.a), String(x.note ?? ""),
            x.voided ? [x.void_reason, x.voided_by].filter(Boolean).join(" · ") : ""]));
        audit("mar", items.length); return items.length;
      } },
    { id: "missed", t: "ยาที่ยังไม่ได้ให้ / ไม่ได้ให้", d: "ชุดเดียวกับตัวชี้วัดให้ยาครบตามมื้อ · ยาแต่ละตัวในแต่ละมื้อที่ยังไม่บันทึก หรือไม่ได้ให้พร้อมเหตุผล · นับถึงเมื่อวาน", rng: true, pdpa: true, perms: ["app.pharmacy", "app.staff"],
      run: async (c) => {
        const { items } = await getJson(`/api/pharmstock?op=missed&${qsOf(c)}`) as { items: Record<string, string | null>[] };
        downloadCsv(`ยาที่ยังไม่ได้ให้-${c.tag}`, ["วันที่", "สาขา", "ผู้รับบริการ", "ห้อง", "มื้อ", "ยา", "สถานะ", "เหตุผล"],
          items.map((x) => [csvDate(x.day), x.branch ?? "", x.resident ?? "", x.room && x.room !== "-" ? x.room : "", x.meal ?? "", x.drug ?? "", x.skip ? "ไม่ได้ให้" : "ยังไม่บันทึก", x.skip ?? ""]));
        audit("missed", items.length); return items.length;
      } },
    { id: "vround", t: "รอบวัดสัญญาณชีพรายคน", d: "รอบที่ตั้งแต่ละรายการ วัดล่าสุด วัดทันรอบ % ขาดวัดกี่ครั้ง (ในช่วงวันที่ นับถึงเมื่อวาน) และสถานะตอนนี้", rng: true, pdpa: true, perms: ["health_logs", "residents"],
      run: async (c) => {
        const { items } = await getJson(`/api/care?op=vital_rounds&${qsOf(c)}`) as { items: { name: string; room: string | null; branch: string | null; plan: Record<string, string>; lastVs: string | null; ok: number; total: number; now: string; by: string }[] };
        downloadCsv(`รอบวัดสัญญาณชีพ-${c.tag}`, ["ผู้รับบริการ", "ห้อง", "สาขา", "รอบสัญญาณชีพ", "รอบ O2", "รอบน้ำตาล (DTX)", "รอบน้ำหนัก", "รอบส่วนสูง", "วัดสัญญาณชีพล่าสุด", "วัดทันรอบ (%)", "ขาดวัด (ครั้ง)", "ตอนนี้", "ตั้งรอบโดย"],
          items.map((x) => [x.name, x.room && x.room !== "-" ? x.room : "", x.branch ?? "", x.plan.vs, x.plan.o2, x.plan.dtx, x.plan.wt, x.plan.ht,
            x.lastVs ? `${csvDate(x.lastVs)} ${x.lastVs.slice(11, 16)}` : "", x.total ? String(Math.round((x.ok / x.total) * 1000) / 10) : "", x.total ? String(x.total - x.ok) : "", x.now, x.by]));
        audit("vround", items.length); return items.length;
      } },
    { id: "complaints", t: "เรื่องร้องเรียนจากญาติ", d: "วันที่ สาขา หมวด เรื่อง ผู้แจ้ง สถานะ ค้างกี่วัน (ไม่มีเบอร์โทร ดูในหน้าเสียงจากครอบครัว)", rng: true, perms: ["feedbacks"],
      run: async (c) => {
        // ทะเบียนร้องเรียน: [วันเวลา, สาขา, เรื่อง, เบอร์ติดต่อกลับ, สถานะ] · "[หมวด] เรื่อง · ผู้แจ้ง: ชื่อ"
        const rows = (await fetchKey<string[]>("complaints")).filter((r) => { const d = isoOf(r[0]); return (!d || c.inRange(d)) && (!c.branch || r[1] === c.branch); });
        const today = todayIso();
        downloadCsv(`ร้องเรียนจากญาติ-${c.tag}`, ["วันที่", "เวลา", "สาขา", "หมวด", "เรื่อง", "ผู้แจ้ง", "สถานะ", "ค้าง (วัน)"], rows.map((r) => {
          const d = isoOf(r[0]), cat = r[2]?.match(/^\[([^\]]+)\]\s*/), who = r[2]?.match(/\s*·\s*ผู้แจ้ง:\s*(.+)$/);
          const issue = String(r[2] ?? "").replace(/^\[[^\]]+\]\s*/, "").replace(/\s*·\s*ผู้แจ้ง:\s*.+$/, "");
          const open = r[4] !== "แก้ไขแล้ว" && d ? String(Math.max(0, Math.floor((Date.parse(today) - Date.parse(d)) / 864e5))) : "";
          return [csvDate(d) || r[0], timeOf(r[0]), r[1] ?? "", cat?.[1] ?? "", issue, who?.[1] ?? "", r[4] ?? "", open];
        }));
        return rows.length;
      } },
    { id: "incidents", t: "เหตุการณ์ไม่พึงประสงค์", d: "วันที่ ผู้รับบริการ ห้อง ชนิด ความรุนแรง รายละเอียด ผู้รายงาน หัวหน้าที่รับทราบ รับทราบภายในกี่นาที การแก้ไข", rng: true, pdpa: true, perms: ["health_logs", "residents", "tasks.review"],
      run: async (c) => {
        const days = Math.min(400, Math.ceil((Date.now() - Date.parse(c.from)) / 864e5) + 2);
        const [{ items }, res] = await Promise.all([getJson(`/api/safety?op=incidents&days=${days}${c.branch ? `&branch=${encodeURIComponent(c.branch)}` : ""}`) as Promise<{ items: Record<string, string | number | null>[] }>, fetchKey<string[]>("residents")]);
        const list = items.filter((x) => c.inRange(String(x.occurred ?? x.reported ?? "")));
        const roomOf = (n: unknown) => { const r = res.find((p) => p[0] === n); return r?.[2] && r[2] !== "-" ? r[2] : ""; };
        downloadCsv(`เหตุการณ์-${c.tag}`, ["วันที่", "เวลา", "สาขา", "ผู้รับบริการ", "ห้อง", "ชนิด", "ความรุนแรง", "รายละเอียด", "ผู้รายงาน", "หัวหน้าที่รับทราบ", "รับทราบภายใน (นาที)", "การแก้ไข"],
          list.map((x) => { const at = String(x.occurred ?? x.reported ?? ""); return [csvDate(at), at.slice(11, 16), String(x.branch ?? ""), String(x.resident_name ?? ""), roomOf(x.resident_name), String(x.kind ?? ""), String(x.severity ?? ""), String(x.detail ?? ""), String(x.reported_by ?? ""), String(x.ack_by ?? ""), x.ack_min === null || x.ack_min === undefined ? "" : String(x.ack_min), String(x.action ?? "")]; }));
        audit("incidents", list.length); return list.length;
      } },
    { id: "reviews", t: "รีวิวพนักงาน", d: "คะแนนและความเห็นจากญาติต่อพนักงานแต่ละคน", perms: ["reviews"], link: { view: "reviews", where: "รีวิวพนักงาน › ส่งออก CSV" } },
  ] },
  { id: "team", name: "ทีมงาน", hint: "เวร การเข้างาน และ KPI", icon: "clock", items: [
    { id: "roster", t: "ตารางเวร (ทุกเวร / สรุปรายคน)", d: "วัน กะ พนักงาน เช็คชื่อ สาย ขาด ของเดือนที่ดู", perms: ["roster"], link: { view: "roster", where: "ตารางเวร › ส่งออก CSV" } },
    { id: "kpi", t: "KPI พนักงาน", d: "คะแนนรวมและคะแนนแต่ละด้านของเดือน", perms: ["kpi"], link: { view: "kpi", where: "KPI พนักงาน › ส่งออก CSV" } },
    { id: "users", t: "ผู้ใช้งานระบบ", d: "ชื่อ ตำแหน่ง สาขา สถานะบัญชี", pdpa: true, perms: ["staff"], link: { view: "staff", where: "ทีมและสิทธิ์การใช้งาน › ส่งออก CSV" } },
  ] },
  { id: "branch", name: "สาขาและงานส่วนกลาง", hint: "ข้อมูลสาขา ราคากลาง และรายการงาน", icon: "building", items: [
    { id: "kpib", t: "KPI สาขา", d: "ตัวชี้วัดหลักของแต่ละสาขา (คนที่ไม่มีสิทธิ์การเงินเห็นเฉพาะงานดูแล)", perms: ["dashboard"], link: { view: "dashboard", where: "ภาพรวมและรายงาน › แท็บตัวชี้วัดหลัก" } },
    { id: "branches", t: "ข้อมูลสาขา", d: "รหัส ชื่อ นิติบุคคล เบอร์ ประเภทกิจการ บัญชีรับโอน สถานะ", perms: ["branches"],
      run: async () => { const rows = await fetchKey<string[]>("branches"); downloadCsv("สาขา", BRANCH_COLS, rows.map((r) => BRANCH_IDX.map((k) => r[k]))); return rows.length; } },
    { id: "prices", t: "ใบราคาและรหัส", d: "ราคากลางทุกรายการพร้อมรหัส · แก้ใน Excel แล้วนำเข้ากลับได้ที่หน้าราคา", perms: ["prices"],
      run: async (c) => {
        const items = c.prices;
        downloadCsv(`ราคาสินค้าและบริการ-${todayIso()}`, ["รหัส", "รายการ", "หมวด", "หมวดย่อย", "หน่วย", "คำอธิบายราคา", "ราคา", "ราคาใหม่", "มีผลวันที่", "สถานะ", "รหัสเดิม"],
          items.flatMap((x) => x.rates.map((r, i) => [rateCode(x, i), x.name, CATS[x.cat].name, x.sub, r.unit, r.label ?? "", String(r.price), r.next ? String(r.next.price) : "", r.next ? r.next.from : "", x.active === false ? "ปิดใช้" : "ใช้อยู่", (x.old ?? []).join(" ")])));
        return items.length;
      } },
    { id: "facility", t: "งานส่วนกลางของสาขา", d: "งานสถานที่ ทำความสะอาด ความถี่ และวิธีจ่ายงาน", perms: ["facility_tasks"],
      run: async () => { const rows = await fetchKey<string[]>("facility"); downloadCsv("งานส่วนกลางของสาขา", FAC_CSV_COLS, rows); return rows.length; } },
    { id: "master", t: "รายการงาน", d: "รหัส ชื่องาน คำสั่งงาน กะ สาขา", perms: ["master_tasks"],
      run: async () => { const rows = await fetchKey<string[]>("master"); downloadCsv("รายการงาน", MT_COLS, rows.map(mtRow)); return rows.length; } },
  ] },
];
const QUICK_MONEY = ["lines", "spendLines", "spend"], QUICK_CARE = ["mar", "health", "roster"];
type RangeKey = "today" | "week" | "month" | "last" | "custom";
const RANGES: [RangeKey, string][] = [["today", "วันนี้"], ["week", "สัปดาห์นี้"], ["month", "เดือนนี้"], ["last", "เดือนที่แล้ว"], ["custom", "เลือกเอง"]];
type Hist = { at: string; t: string; range: string; branch: string; n: number };
const HKEY = "kin-export-history";

export function Exports() {
  const { toast, go } = useApp();
  const { user } = useSession();
  const prices = usePriceList();
  const branches = useBranchNames();
  const isGlobal = seesAllBranches(user?.role);
  const today = todayIso();
  const [range, setRange] = useState<RangeKey>("month");
  const [cFrom, setCFrom] = useState(`${today.slice(0, 7)}-01`);
  const [cTo, setCTo] = useState(today);
  const [branch, setBranch] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [hist, setHist] = useState<Hist[]>([]);
  useEffect(() => { try { setHist(JSON.parse(localStorage.getItem(HKEY) || "[]")); } catch { /* ไม่มีที่เก็บในเครื่อง */ } }, []);

  const { from, to } = useMemo(() => {
    const d = new Date(`${today}T00:00:00Z`);
    if (range === "today") return { from: today, to: today };
    if (range === "week") return { from: iso(new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5)), to: today };
    // เดือนนี้ = ทั้งเดือนปฏิทิน (ยอดกระจายตามช่วงบริการตรงกับ Dashboard)
    if (range === "month") return { from: `${today.slice(0, 7)}-01`, to: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))) };
    if (range === "last") return { from: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1))), to: iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0))) };
    return cFrom <= cTo ? { from: cFrom, to: cTo } : { from: cTo, to: cFrom };
  }, [range, cFrom, cTo, today]);
  const rangeText = from === to ? thd(from) : `${thd(from)} ถึง ${thd(to)}`;
  const branchText = isGlobal ? branch || "ทุกสาขา" : user?.branch ?? "";
  const ctx: Ctx = { from, to, branch: isGlobal ? branch : "", userBranch: user?.branch, prices, inRange: (d) => !!d && d.slice(0, 10) >= from && d.slice(0, 10) <= to,
    tag: `${from === to ? from : `${from}-ถึง-${to}`}${isGlobal && branch ? `-${branch}` : !isGlobal && user?.branch ? `-${user.branch}` : ""}` };

  const money = seesMoney(user);
  const allowed = (it: Item) => it.perms.some((p) => can(user, p)) && (!it.money || money) && (!it.salesTax || canSalesTax(user));
  const k = q.replace(/\s+/g, "").toLowerCase();
  const match = (g: Group, it: Item) => allowed(it) && (!k || (it.t + it.d + g.name).replace(/\s+/g, "").toLowerCase().includes(k));
  const shown = GROUPS.map((g) => ({ ...g, items: g.items.filter((it) => match(g, it)) })).filter((g) => g.items.length);
  const all = GROUPS.flatMap((g) => g.items);
  const quick = (money ? QUICK_MONEY : QUICK_CARE).map((id) => all.find((x) => x.id === id)!).filter((it) => it && allowed(it));

  const run = async (it: Item) => {
    if (it.link) { go(it.link.view); toast(`เปิดหน้า${it.link.where.split(" › ")[0]} · ส่งออกที่ ${it.link.where}`); return; }
    if (!it.run || busy) return;
    setBusy(it.id);
    try {
      const n = await it.run(ctx);
      if (!n) { toast(`ไม่มีข้อมูล "${it.t}"${it.rng ? ` ช่วง ${rangeText}` : ""}`); return; }
      toast(`ส่งออก "${it.t}" แล้ว ${n} แถว${it.pdpa ? " · ไฟล์มีข้อมูลส่วนบุคคล เก็บให้ปลอดภัย" : ""}`);
      const h: Hist = { at: nowTh(), t: it.t, range: it.rng ? rangeText : "ข้อมูลปัจจุบัน", branch: branchText, n };
      setHist((p) => { const next = [h, ...p].slice(0, 10); try { localStorage.setItem(HKEY, JSON.stringify(next)); } catch { /* เก็บไม่ได้ ไม่เป็นไร */ } return next; });
    } catch (e) { toast((e as Error).message || "ส่งออกไม่สำเร็จ"); }
    finally { setBusy(""); }
  };
  const btn = (it: Item) => it.link
    ? <button type="button" className="btn-soft !py-1.5 text-sm" onClick={() => run(it)}>ไปหน้านั้น <Icon name="chevron" className="h-3.5 w-3.5 -rotate-90" /></button>
    : <button type="button" className="btn-soft !py-1.5 text-sm" disabled={!!busy} onClick={() => run(it)}><CsvIcon /> {busy === it.id ? "กำลังเตรียมไฟล์…" : "ส่งออก"}</button>;

  return (
    <>
      <PageHeader title="ส่งออกข้อมูล" sub="เลือกช่วงวันที่และสาขา แล้วกดดาวน์โหลดไฟล์ที่ต้องการ · เปิดใน Excel หรือ Google Sheets ได้" />
      <div className="space-y-5">
        <section className="ex-bar" aria-label="ตัวเลือกกลาง">
          <div className="min-w-0">
            <span className="label">ช่วงวันที่</span>
            <div className="pl-chips" role="group" aria-label="ช่วงวันที่">
              {RANGES.map(([v, t]) => <button key={v} type="button" aria-pressed={range === v} onClick={() => setRange(v)}>{t}</button>)}
            </div>
            {range === "custom" && <div className="mt-2"><RangePicker ariaLabel="ช่วงวันที่ที่ส่งออก" from={cFrom} to={cTo} months onChange={(f, t) => { setCFrom(f); setCTo(t); }} /></div>}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            {isGlobal && <label className="block"><span className="label">สาขา</span>
              <select className="!w-auto" value={branch} onChange={(e) => setBranch(e.target.value)}><option value="">ทุกสาขา</option>{branches.map((b) => <option key={b}>{b}</option>)}</select></label>}
            <label className="relative block"><span className="label">ค้นหาไฟล์</span>
              <Icon name="search" className="pointer-events-none absolute bottom-3 left-3 h-4 w-4 text-gold-400" />
              <input type="search" className="!pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="เช่น ลูกหนี้ สัญญา เวร" /></label>
          </div>
          <p className="ex-note">ไฟล์ที่มีป้าย "ตามช่วงวันที่" ส่งออกช่วง <b>{rangeText}</b> · สาขา <b>{branchText}</b> · ไฟล์อื่นส่งออกข้อมูลปัจจุบันทั้งหมด</p>
        </section>

        {quick.length > 0 && !k && <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-gold-600">ใช้บ่อย:</span>
          {quick.map((it) => <button key={it.id} type="button" className="ex-quick" disabled={!!busy} onClick={() => run(it)}><b aria-hidden="true">↓</b> {it.t}</button>)}
        </div>}

        {shown.length ? <div className="ex-cards">{shown.map((g) => (
          <section key={g.id} className="ex-card" aria-label={g.name}>
            <header><span className="ex-ic"><Icon name={g.icon} className="h-5 w-5" /></span><div className="min-w-0"><b>{g.name}</b><small>{g.hint}</small></div><span className="ex-n">{g.items.length} ไฟล์</span></header>
            <ul>{g.items.map((it) => (
              <li key={it.id}>
                <div className="min-w-0"><b>{it.t}</b><p>{it.d}</p>
                  <div className="ex-tags">{it.link ? <span>ส่งออกจากหน้านั้น · {it.link.where}</span> : it.rng ? <span className="is-rng">ตามช่วงวันที่</span> : <span>ข้อมูลปัจจุบัน</span>}{it.pdpa && <span className="is-pdpa">ข้อมูลส่วนบุคคล</span>}</div>
                </div>
                {btn(it)}
              </li>
            ))}</ul>
          </section>
        ))}</div> : <p className="rounded-2xl border border-dashed border-cream-300 bg-white px-4 py-8 text-center text-sm text-gold-600">{k ? `ไม่พบไฟล์ "${q}" ที่คุณส่งออกได้` : "บัญชีนี้ยังไม่มีสิทธิ์ส่งออกไฟล์ใด"}</p>}

        <section className="ex-hist" aria-label="ส่งออกล่าสุด">
          <h2>ส่งออกล่าสุดในเครื่องนี้</h2>
          {hist.length ? <div className="overflow-x-auto"><table className="sales-top">
            <thead><tr><th>เวลา</th><th>ไฟล์</th><th>ช่วง</th><th>สาขา</th><th className="n">แถว</th></tr></thead>
            <tbody>{hist.map((h, i) => <tr key={i}><td className="whitespace-nowrap">{h.at.replace("T", " ")}</td><td>{h.t}</td><td>{h.range}</td><td>{h.branch}</td><td className="n">{h.n}</td></tr>)}</tbody>
          </table></div> : <p className="text-sm text-gold-500">ยังไม่ได้ส่งออกไฟล์จากหน้านี้</p>}
          <p className="mt-2 text-xs text-gold-500">ไฟล์ที่มีป้าย "ข้อมูลส่วนบุคคล" บันทึกลงบันทึกการใช้งานระบบทุกครั้ง ว่าใครส่งออก เมื่อไร</p>
        </section>
      </div>
    </>
  );
}
