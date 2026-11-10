"use client";
/**
 * ตัวสร้างไฟล์ CSV ที่ใช้ร่วมกันระหว่างปุ่มส่งออกในแต่ละหน้า และหน้า "ส่งออกข้อมูล" (components/views/Exports)
 *  ทุกฟังก์ชันรับข้อมูลที่กรองช่วงวันที่/สาขาแล้ว · คืนจำนวนแถวที่ส่งออก
 */
import { balanceOf, BILL_GROUPS, creditOf, docDate, groupOf, inclNet, Invoice, isOpen, lineSign, money, parseItems, signedNet, todayIso, vatOf, VOID } from "./billing";
import { lineTotal } from "./billingExport";
import { classify, DP_NAME, SALE_CATS, saleLines } from "./salesCategory";
import { lineCode, PriceItem } from "./priceList";
import { downloadCsv } from "./store";
import { allocate, payMethodOf } from "./servicePeriod";

/**
 * ค้างชำระ / ชำระครบ แบบ 1 แถวต่อรายการ เรียงตามผู้รับบริการ (ชื่อ → วันที่ออกใบ → เลขที่ → ลำดับบรรทัด)
 *  ยอดในช่วงที่เลือก = กระจายตามช่วงบริการ (lib/servicePeriod · ตรงกับรายได้ตามช่วงบริการใน Dashboard)
 *  แสดงเฉพาะรายการที่มียอดในช่วง (from ว่าง = ทุกวันที่) · บรรทัดหักเงินที่รับไว้แล้วเป็นยอดติดลบ ณ วันที่ออกใบ · คอลัมน์สุดท้าย = ชำระด้วย
 */
export function serviceLinesRows(list: Invoice[], contracts: string[][], from = "", to = "") {
  const inR = (d: string) => !from || (d >= from && d <= to);
  const out: { who: string; hn: string; date: string; no: string; k: number; x: Invoice; cells: string[]; alloc: number }[] = [];
  for (const x of list) {
    const base = (k: number, code: string, desc: string, grp: string, qty: number, incl: number, vat: number, p: { from: string; to: string } | null, days: number, inDays: number, alloc: number, vatAlloc: number) => out.push({
      who: x.who, hn: String(x.hn ?? "").trim(), date: x.date, no: x.no ?? "", k, x, alloc,
      cells: [code, desc, grp, String(qty), money(incl), vat ? `${vat}%` : "-", p ? docDate(p.from) : "", p ? docDate(p.to) : "", p ? String(days) : "", p ? String(inDays) : "", money(alloc), money(vatAlloc), money(Math.round((alloc - vatAlloc) * 100) / 100)],
    });
    for (const a of allocate(x, contracts, from, to)) {
      if (from && !a.inDays) continue;
      const g = a.grp === "dep" ? "เงินประกัน / มัดจำ" : BILL_GROUPS.find(([k]) => k === a.grp)?.[1] ?? "";
      base(a.k, lineCode(a.line), a.line.desc, g, a.line.qty, a.incl, a.line.vat ?? 0, a.period, a.days, a.inDays, a.alloc, a.vatAlloc);
    }
    if (inR(x.date.slice(0, 10))) parseItems(x.items).forEach((l, k) => { if (l.credit) { const v = -Math.round(lineSign(x) * l.qty * l.price * 100) / 100; base(k, lineCode(l), l.desc, "หักเงินที่รับไว้แล้ว", l.qty, v, 0, null, 0, 0, v, 0); } });
  }
  // เรียงตาม HN (ไม่มี HN ไว้ท้าย) → ชื่อ → วันที่ออกใบ → เลขที่เอกสาร → ลำดับบรรทัด
  return out.sort((a, b) => (a.hn ? 0 : 1) - (b.hn ? 0 : 1) || a.hn.localeCompare(b.hn) || a.who.localeCompare(b.who, "th") || a.date.localeCompare(b.date) || a.no.localeCompare(b.no) || a.k - b.k);
}
export function serviceLinesCsv(list: Invoice[], contracts: string[][], branchOf: (x: Invoice) => string, name: string, from = "", to = "") {
  // ลำดับคอลัมน์: ใคร (HN ชื่อ สาขา สัญญา) → เอกสาร (เลขที่ วันที่ ประเภท) → รายการ → ยอดในใบ → ช่วงบริการและยอดในช่วง → การชำระ
  const rows = serviceLinesRows(list, contracts, from, to).map(({ x, cells }) => [x.hn || "", x.who, branchOf(x), x.contract || "", x.no ?? "", docDate(x.date), x.kind, ...cells, x.status, x.paidDate ? docDate(x.paidDate) : "", payMethodOf(x)]);
  downloadCsv(name, ["HN", "ผู้รับบริการ", "สาขา", "สัญญา", "เลขที่เอกสาร", "วันที่ออกใบ", "ประเภทใบ",
    "รหัสสินค้า", "รายการ", "หมวดในใบเสร็จ", "จำนวน", "ยอดในใบ (รวม VAT)", "VAT", "ช่วงบริการ เริ่ม", "ช่วงบริการ สิ้นสุด", "วันทั้งหมดของช่วงบริการ", "วันที่อยู่ในช่วงที่เลือก",
    from ? "ยอดในช่วงที่เลือก (รวม VAT)" : "ยอด (รวม VAT)", from ? "VAT ในช่วงที่เลือก" : "VAT", from ? "ก่อน VAT ในช่วงที่เลือก" : "ก่อน VAT", "สถานะ", "วันที่รับชำระ", "ชำระด้วย"], rows);
  return rows.length;
}

/* ---------- เอกสารการเงิน 1 แถวต่อใบ ---------- */
/**
 * 1 แถวต่อใบ · แยกยอดตามหมวดในใบ (รวม VAT): ค่าบริการห้องพัก / ค่าบริการทางการแพทย์ / สินค้าและบริการอื่น / บริการเสริม / เงินประกัน-มัดจำ
 *  แจกแจงภาษี: มูลค่าที่มี VAT (ก่อน VAT) · VAT · มูลค่าที่ไม่มี VAT · รวมทั้งสิ้น (รวม VAT) · หักเงินที่รับไว้แล้ว · ยอดสุทธิ · ใบลดหนี้เป็นยอดลบ
 */
export function invoiceDocsCsv(list: Invoice[], branchOf: (x: Invoice) => string, name: string) {
  const rows = [...list].sort((a, b) => b.date.localeCompare(a.date)).map((x) => {
    const sg = lineSign(x), items = parseItems(x.items), sale = items.filter((i) => !i.credit), t = vatOf(sale);
    const grp = (k: string) => money(sg * sale.filter((i) => groupOf(i) === k).reduce((n, i) => n + inclNet(i), 0));
    // รหัสสินค้าในใบ (เรียงตามบรรทัด · จำนวนมากกว่า 1 ใส่ ×จำนวน) · รายการที่ไม่มีรหัส (ยา เวชภัณฑ์ ที่กรอกเอง) ไม่แสดง
    const codes = sale.map((i) => { const c = lineCode(i); return c ? (i.qty !== 1 ? `${c} ×${i.qty}` : c) : ""; }).filter(Boolean).join(", ");
    return [x.no ?? "", docDate(x.date), branchOf(x), x.who, x.hn || "", x.payer, x.ref ? `${x.kind} (อ้างอิง ${x.ref})` : x.kind, x.contract || "", codes,
      ...BILL_GROUPS.map(([k]) => grp(k)), grp("dep"),
      money(sg * t.base), money(sg * t.vat), money(sg * t.exempt), money(sg * (t.base + t.vat + t.exempt)), money(sg * creditOf(items)), money(x.discount),
      money(signedNet(x)), money(x.paid ?? 0), x.status === VOID ? "0.00" : money(balanceOf(x)), x.paidDate ? docDate(x.paidDate) : "", x.status];
  });
  downloadCsv(name, ["เลขที่เอกสาร", "วันที่", "สาขา", "ผู้รับบริการ", "HN", "ผู้ชำระ", "ประเภท", "สัญญา", "รหัสสินค้าในใบ",
    ...BILL_GROUPS.map(([k, th]) => (k === "room" ? `${th} (รวม VAT)` : th)), "เงินประกัน / มัดจำ",
    "มูลค่าที่มี VAT (ก่อน VAT)", "VAT 7%", "มูลค่าที่ไม่มี VAT", "รวมทั้งสิ้น (รวม VAT)", "หักเงินที่รับไว้แล้ว", "ส่วนลด (ก่อน VAT)",
    "ยอดสุทธิ", "ชำระแล้ว", "คงเหลือ", "วันที่รับชำระ", "สถานะ"], rows);
  return rows.length;
}

/* ---------- ปิดยอดรายวัน ---------- */
export type CloseRow = { branch: string; date: string; payments: number; cash: number; transfer: number; credit: number; counted: number; note: string; closedBy: string; closedAt: string; approvedBy: string | null; approvedAt: string | null };
export function closesCsv(rows: CloseRow[], name: string) {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  downloadCsv(name, ["วันที่", "สาขา", "รายการรับชำระ", "เงินสดในระบบ", "เงินโอน", "บัตรเครดิต", "รวมรับ", "เงินสดที่นับได้", "ส่วนต่างเงินสด", "หมายเหตุ", "ปิดยอดโดย", "เวลาปิดยอด", "ตรวจรับรองโดย", "เวลาตรวจรับรอง"],
    rows.map((c) => [docDate(c.date), c.branch, String(c.payments), money(c.cash), money(c.transfer), money(c.credit), money(c.cash + c.transfer + c.credit), money(c.counted), money(r2(c.counted - c.cash)), c.note, c.closedBy, c.closedAt, c.approvedBy ?? "", c.approvedAt ?? ""]));
  return rows.length;
}

/* ---------- ลูกหนี้ค้างชำระตามอายุหนี้ ---------- */
export const AGE_BUCKETS = [
  { k: "b0", t: "0–30 วัน", min: 0, max: 30, c: "is-b0" },
  { k: "b1", t: "31–60 วัน", min: 31, max: 60, c: "is-b1" },
  { k: "b2", t: "61–90 วัน", min: 61, max: 90, c: "is-b2" },
  { k: "b3", t: "เกิน 90 วัน", min: 91, max: Infinity, c: "is-b3" },
] as const;
export type BucketKey = (typeof AGE_BUCKETS)[number]["k"];
export const ageOf = (x: Invoice, today: string) => Math.max(0, Math.floor((Date.parse(today) - Date.parse(x.date.slice(0, 10))) / 864e5));
export const bucketOf = (age: number) => AGE_BUCKETS.find((b) => age >= b.min && age <= b.max)!.k;
export type Debtor = { key: string; who: string; payer: string; hn: string; branch: string; address: string; contract: string; docs: { x: Invoice; age: number }[]; by: Record<BucketKey, number>; total: number; oldest: number };
/** รวมใบค้างรายคน (ผู้รับบริการ + สาขา) · เรียงคนที่ค้างนานที่สุดก่อน */
export function debtorsOf(list: Invoice[], branchOf: (x: Invoice) => string, today = todayIso()) {
  const open = list.filter(isOpen).map((x) => ({ x, age: ageOf(x, today) })).filter(({ x }) => balanceOf(x) > 0);
  const map = new Map<string, Debtor>();
  for (const d of open) {
    const branch = branchOf(d.x), key = `${d.x.who}|${branch}`;
    if (!map.has(key)) map.set(key, { key, who: d.x.who, payer: d.x.payer, hn: d.x.hn, branch, address: d.x.address, contract: d.x.contract, docs: [], by: { b0: 0, b1: 0, b2: 0, b3: 0 }, total: 0, oldest: 0 });
    const m = map.get(key)!;
    m.docs.push(d); m.by[bucketOf(d.age)] += balanceOf(d.x); m.total += balanceOf(d.x); m.oldest = Math.max(m.oldest, d.age);
    if (!m.payer && d.x.payer) m.payer = d.x.payer;
    if (!m.address && d.x.address) m.address = d.x.address;
  }
  return { open, debtors: [...map.values()].sort((a, b) => b.oldest - a.oldest || b.total - a.total) };
}
export function debtorsCsv(debtors: Debtor[], name: string) {
  downloadCsv(name, ["ผู้รับบริการ", "HN", "สาขา", "ผู้ชำระ", "ใบค้าง", ...AGE_BUCKETS.map((b) => b.t), "รวมค้าง", "ค้างนานสุด (วัน)"],
    debtors.map((d) => [d.who, d.hn || "", d.branch, d.payer, String(d.docs.length), ...AGE_BUCKETS.map((b) => money(d.by[b.k])), money(d.total), String(d.oldest)]));
  return debtors.length;
}

/* ---------- ยอดขายตามรายการ (หลังส่วนลด ก่อน VAT · ไม่นับเงินประกัน/รับล่วงหน้า) ---------- */
export function salesItemsCsv(list: Invoice[], prices: PriceItem[], inRange: (d: string) => boolean, name: string) {
  const sales = saleLines(list, prices).filter((l) => l.cat !== "DP" && inRange(l.date));
  const by = new Map<string, { item: string; code: string; cat: string; sub: string; amount: number; qty: number; times: number }>();
  for (const l of sales) {
    const k = l.code || l.item;
    const e = by.get(k) ?? { item: l.item, code: l.code, cat: SALE_CATS.find((c) => c.id === l.cat)?.name ?? l.cat, sub: l.sub, amount: 0, qty: 0, times: 0 };
    e.amount += l.amount; e.qty += l.qty; e.times += 1; by.set(k, e);
  }
  const items = [...by.values()].sort((a, b) => b.amount - a.amount), tot = items.reduce((n, x) => n + x.amount, 0);
  downloadCsv(name, ["อันดับ", "รหัส", "รายการ", "หมวด", "หมวดย่อย", "จำนวน", "ครั้งที่ขาย", "ยอดขาย (บาท)", "สัดส่วน (%)"],
    items.map((x, i) => [String(i + 1), x.code, x.item, x.cat, x.sub, String(x.qty), String(x.times), money(x.amount), tot ? String(Math.round((x.amount / tot) * 1000) / 10) : "0"]));
  return items.length;
}

/* ---------- ค่าใช้จ่ายรายบุคคล (หลังส่วนลด รวม VAT) ---------- */
export const CREDIT_CAT = "หักเงินที่รับไว้แล้ว";
export type SpendLine = { x: Invoice; k: number; i: ReturnType<typeof parseItems>[number]; cat: string; code: string; total: number };
/** ทุกบรรทัดของใบ (ใบที่กรองแล้ว) พร้อมหมวดชุดเดียวกับแท็บยอดขายตามหมวด และรหัสสินค้า */
export function spendLines(invs: Invoice[], prices: PriceItem[]): SpendLine[] {
  const catOf = (i: SpendLine["i"]) => { const c = classify(i, prices); return !c ? CREDIT_CAT : c.cat === "DP" ? DP_NAME : SALE_CATS.find((s) => s.id === c.cat)?.name ?? c.cat; };
  return invs.flatMap((x) => parseItems(x.items).map((i, k) => ({ x, k, i, cat: catOf(i), code: lineCode(i, prices), total: lineSign(x) * lineTotal(i) })));
}
export const personKey = (x: Invoice) => x.hn || x.who;
export function spendPeople(invs: Invoice[], lines: SpendLine[], branchOf: (x: Invoice) => string) {
  const cols = [...SALE_CATS.map((c) => c.name), DP_NAME, CREDIT_CAT].filter((c) => lines.some((l) => l.cat === c));
  const people = [...new Set(invs.map(personKey))].map((key) => {
    const mine = invs.filter((x) => personKey(x) === key), ls = lines.filter((l) => personKey(l.x) === key);
    const by = Object.fromEntries(cols.map((c) => [c, ls.filter((l) => l.cat === c).reduce((n, l) => n + l.total, 0)])) as Record<string, number>;
    return { key, who: mine[0].who, hn: mine[0].hn || "", branch: branchOf(mine[0]), docs: mine.length, by, billed: mine.reduce((n, x) => n + signedNet(x), 0), paid: mine.reduce((n, x) => n + (x.paid ?? 0), 0), owe: mine.reduce((n, x) => n + balanceOf(x), 0), last: mine.map((x) => x.date).sort().pop() ?? "" };
  });
  return { cols, people };
}
export type SpendPerson = ReturnType<typeof spendPeople>["people"][number];
export function spendSummaryCsv(people: SpendPerson[], cols: string[], name: string) {
  downloadCsv(name, ["ผู้รับบริการ", "HN", "สาขา", "จำนวนใบ", ...cols, "รวมเรียกเก็บ", "ชำระแล้ว", "ค้างชำระ", "ออกใบล่าสุด"],
    people.map((p) => [p.who, p.hn, p.branch, String(p.docs), ...cols.map((c) => money(p.by[c])), money(p.billed), money(p.paid), money(p.owe), p.last ? docDate(p.last) : ""]));
  return people.length;
}
/** ทุกรายการที่ซื้อ: รหัสสินค้า ชื่อ จำนวน ราคาต่อหน่วย และยอดที่จ่ายจริง (หลังส่วนลด รวม VAT) */
export function spendLinesCsv(lines: SpendLine[], branchOf: (x: Invoice) => string, name: string) {
  const rows = [...lines].sort((a, b) => a.x.who.localeCompare(b.x.who, "th") || a.x.date.localeCompare(b.x.date) || a.k - b.k)
    .map((l) => [l.x.who, l.x.hn || "", branchOf(l.x), docDate(l.x.date), l.x.no ?? "", l.x.kind, l.x.status, String(l.k + 1), l.code, l.i.desc, l.cat, String(l.i.qty), money(l.i.price), money(l.total)]);
  downloadCsv(name, ["ผู้รับบริการ", "HN", "สาขา", "วันที่", "เลขที่เอกสาร", "ประเภทใบ", "สถานะใบ", "บรรทัด", "รหัสสินค้า", "รายการ", "หมวด", "จำนวน", "ราคาต่อหน่วย", "ยอดที่จ่าย (บาท)"], rows);
  return rows.length;
}
