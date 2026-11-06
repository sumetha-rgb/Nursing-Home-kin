"use client";
import { useState } from "react";
import CsvIcon from "@/components/CsvIcon";
import { balanceOf, docDate, DRAFT, Invoice, money, parseItems, VOID } from "@/lib/billing";
import { lineTotal } from "@/lib/billingExport";
import { classify, DP_NAME, SALE_CATS } from "@/lib/salesCategory";
import { usePriceList } from "@/lib/usePrices";
import { lineCode } from "@/lib/priceList";
import { downloadCsv, useRecords } from "@/lib/store";
import { ShareBars } from "./FinanceAnalytics";

/**
 * ค่าใช้จ่ายของผู้รับบริการ 1 คน (แท็บ "ค่าใช้จ่าย" ในหน้าประวัติผู้รับบริการ · เห็นเฉพาะคนที่มีสิทธิ์ใบแจ้งหนี้หรือสัญญา)
 *  ทุกบรรทัดในทุกใบของคนนี้ (จับคู่ด้วย HN ถ้ามี ไม่มีใช้ชื่อ) · ไม่นับใบยกเลิก · ใบรอตรวจสอบยอดแสดงแต่ไม่รวมยอด
 *  สรุป: เรียกเก็บทั้งหมด ชำระแล้ว ค้างชำระ · ยอดตามหมวด · กรองตามหมวด · ส่งออก CSV
 */
export default function ResidentBilling({ name, hn }: { name: string; hn?: string | null }) {
  const [all, , meta] = useRecords<Invoice>("invoices", []);
  const [cat, setCat] = useState("");
  const mine = all.filter((x) => (hn ? x.hn === hn : x.who === name) && x.status !== VOID).sort((a, b) => b.date.localeCompare(a.date));
  const real = mine.filter((x) => x.status !== DRAFT);
  const billed = real.reduce((n, x) => n + x.net, 0), paid = real.reduce((n, x) => n + (x.paid ?? 0), 0), owe = real.reduce((n, x) => n + balanceOf(x), 0);
  // หมวดชุดเดียวกับแท็บ "ยอดขายตามหมวด" (ตามรหัสในใบราคา) · เงินประกัน/รับล่วงหน้า = DP · บรรทัดหักเงิน = หักเงินที่รับไว้แล้ว
  const prices = usePriceList();
  const catName = (i: Parameters<typeof classify>[0]) => { const c = classify(i, prices); return !c ? "หักเงินที่รับไว้แล้ว" : c.cat === "DP" ? DP_NAME : SALE_CATS.find((x) => x.id === c.cat)?.name ?? c.cat; };
  const lines = mine.flatMap((x) => parseItems(x.items).map((i, k) => ({ x, k, i, cat: catName(i), total: lineTotal(i) })));
  const cats = [...new Set(lines.map((l) => l.cat))];
  const sales = lines.filter((l) => l.x.status !== DRAFT && l.cat !== DP_NAME && l.cat !== "หักเงินที่รับไว้แล้ว");
  const byCat = [...new Set(sales.map((l) => l.cat))].map((c) => {
    const ls = sales.filter((l) => l.cat === c);
    return { label: c, value: ls.reduce((n, l) => n + l.total, 0), note: `${ls.length} รายการ` };
  }).filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  const shown = cat ? lines.filter((l) => l.cat === cat) : lines;
  const exportCsv = () => downloadCsv(`ค่าใช้จ่าย-${name}${hn ? `-${hn}` : ""}`, ["วันที่", "เลขที่เอกสาร", "ประเภทใบ", "สถานะใบ", "บรรทัด", "รหัสสินค้า", "รายการ", "หมวด", "จำนวน", "ราคาต่อหน่วย", "ยอดที่จ่าย (บาท)"],
    shown.map((l) => [docDate(l.x.date), l.x.no ?? "", l.x.kind, l.x.status, String(l.k + 1), l.i.credit ? "" : lineCode(l.i, prices), l.i.desc, l.cat, String(l.i.qty), money(l.i.price), money(l.total)]));

  if (!meta.loaded && !all.length) return <p className="py-6 text-center text-sm text-gold-500">กำลังโหลด…</p>;
  if (!mine.length) return <p className="rounded-xl bg-cream-50 px-4 py-6 text-center text-sm text-gold-600">ยังไม่มีใบแจ้งหนี้ของ {name}</p>;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rb-tile"><span>เรียกเก็บทั้งหมด</span><b>{money(billed)}</b><small>{real.length} ใบ{mine.length > real.length ? ` · รอตรวจสอบยอดอีก ${mine.length - real.length} ใบ` : ""}</small></div>
        <div className="rb-tile"><span>ชำระแล้ว</span><b>{money(paid)}</b><small>บาท</small></div>
        <div className={`rb-tile ${owe > 0 ? "is-owe" : ""}`}><span>ค้างชำระ</span><b>{money(owe)}</b><small>{owe > 0 ? `${real.filter((x) => balanceOf(x) > 0).length} ใบ` : "ไม่มียอดค้าง"}</small></div>
      </div>
      <div>
        <h4 className="profile-sub">ใช้จ่ายตามหมวด</h4>
        <p className="mb-2 text-xs text-gold-500">หลังส่วนลด รวม VAT · ไม่นับ{DP_NAME} และใบรอตรวจสอบยอด · หมวดเดียวกับแท็บยอดขายตามหมวด</p>
        <ShareBars rows={byCat} />
      </div>
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h4 className="profile-sub !mb-0">ทุกรายการที่เรียกเก็บ</h4>
          <div className="flex flex-wrap items-center gap-2">
            <select aria-label="กรองตามหมวด" className="!w-auto !py-1.5 text-sm" value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">ทุกหมวด ({lines.length})</option>
              {cats.map((c) => <option key={c} value={c}>{c} ({lines.filter((l) => l.cat === c).length})</option>)}
            </select>
            <button type="button" className="btn-soft !py-1.5" onClick={exportCsv}><CsvIcon /> ส่งออก CSV</button>
          </div>
        </div>
        <div className="overflow-x-auto"><table className="sales-top">
          <thead><tr><th>วันที่</th><th>เลขที่เอกสาร</th><th>รายการ</th><th>หมวด</th><th className="n">จำนวน</th><th className="n">ยอด (บาท)</th><th>สถานะใบ</th></tr></thead>
          <tbody>{shown.map((l) => <tr key={`${l.x.id}-${l.k}`} className={l.x.status === DRAFT ? "opacity-60" : ""}>
            <td className="whitespace-nowrap">{docDate(l.x.date)}</td><td className="whitespace-nowrap">{l.x.no ?? "-"}</td><td>{l.i.desc}</td><td className="text-gold-600">{l.cat}</td>
            <td className="n">{l.i.qty}</td><td className={`n font-semibold ${l.total < 0 ? "text-red-700" : ""}`}>{money(l.total)}</td><td className="whitespace-nowrap">{l.x.status}</td>
          </tr>)}</tbody>
          <tfoot><tr><td colSpan={5}>รวม{cat ? ` ${cat}` : ""} ({shown.length} รายการ)</td><td className="n">{money(shown.reduce((n, l) => n + l.total, 0))}</td><td /></tr></tfoot>
        </table></div>
      </div>
    </div>
  );
}
