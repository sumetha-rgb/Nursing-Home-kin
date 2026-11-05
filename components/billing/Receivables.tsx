"use client";
import { useState } from "react";
import CsvIcon from "@/components/CsvIcon";
import Icon from "../Icon";
import { DataTable, Section } from "../ui";
import { balanceOf, bahtText, docDate, Invoice, isOpen, money, todayIso } from "@/lib/billing";
import { downloadCsv } from "@/lib/store";
import { PAY_CHANNELS } from "@/lib/contractText";
import { DocBranch, DocFoot, DocHead, DocTitle, KV, longDate, Paper, PrintModal, Signs } from "../print/Docs";

/** ช่วงอายุหนี้ นับจากวันที่ออกใบ · ค้างนานขึ้นสีเข้มขึ้น */
const BUCKETS = [
  { k: "b0", t: "0–30 วัน", min: 0, max: 30, c: "is-b0" },
  { k: "b1", t: "31–60 วัน", min: 31, max: 60, c: "is-b1" },
  { k: "b2", t: "61–90 วัน", min: 61, max: 90, c: "is-b2" },
  { k: "b3", t: "เกิน 90 วัน", min: 91, max: Infinity, c: "is-b3" },
] as const;
type BucketKey = (typeof BUCKETS)[number]["k"];

const ageOf = (x: Invoice, today: string) => Math.max(0, Math.floor((Date.parse(today) - Date.parse(x.date.slice(0, 10))) / 864e5));
const bucketOf = (age: number) => BUCKETS.find((b) => age >= b.min && age <= b.max)!.k;

type Debtor = { key: string; who: string; payer: string; hn: string; branch: string; address: string; contract: string; docs: { x: Invoice; age: number }[]; by: Record<BucketKey, number>; total: number; oldest: number };

/**
 * ลูกหนี้ค้างชำระตามอายุหนี้ (หน้าใบแจ้งหนี้และใบเสร็จ)
 *  สรุปยอดค้าง 0–30 / 31–60 / 61–90 / เกิน 90 วัน · รายคน · พิมพ์ใบแจ้งยอดค้างชำระรวมทุกใบที่ค้างของคนนั้นให้ญาติ
 */
export default function Receivables({ list, branchOf, branchInfo, by }: { list: Invoice[]; branchOf: (x: Invoice) => string; branchInfo: (name: string) => DocBranch; by?: string }) {
  const today = todayIso();
  const [pick, setPick] = useState<BucketKey | "">("");
  const [doc, setDoc] = useState<Debtor | null>(null);
  const open = list.filter(isOpen).map((x) => ({ x, age: ageOf(x, today) })).filter(({ x }) => balanceOf(x) > 0);
  const sumOf = (k: BucketKey) => open.filter((d) => bucketOf(d.age) === k).reduce((n, d) => n + balanceOf(d.x), 0);
  const countOf = (k: BucketKey) => open.filter((d) => bucketOf(d.age) === k).length;
  const grand = open.reduce((n, d) => n + balanceOf(d.x), 0);

  // รวมรายคน (ผู้รับบริการ + สาขา) · เรียงคนที่ค้างนานที่สุดก่อน
  const map = new Map<string, Debtor>();
  for (const d of open) {
    const branch = branchOf(d.x), key = `${d.x.who}|${branch}`;
    if (!map.has(key)) map.set(key, { key, who: d.x.who, payer: d.x.payer, hn: d.x.hn, branch, address: d.x.address, contract: d.x.contract, docs: [], by: { b0: 0, b1: 0, b2: 0, b3: 0 }, total: 0, oldest: 0 });
    const m = map.get(key)!;
    m.docs.push(d); m.by[bucketOf(d.age)] += balanceOf(d.x); m.total += balanceOf(d.x); m.oldest = Math.max(m.oldest, d.age);
    if (!m.payer && d.x.payer) m.payer = d.x.payer;
    if (!m.address && d.x.address) m.address = d.x.address;
  }
  const debtors = [...map.values()].sort((a, b) => b.oldest - a.oldest || b.total - a.total);
  const shown = pick ? debtors.filter((d) => d.by[pick] > 0) : debtors;
  const multi = new Set(debtors.map((d) => d.branch)).size > 1;
  const r2 = (n: number) => (n ? money(n) : "-");

  const exportCsv = () => downloadCsv(`ลูกหนี้ตามอายุหนี้-${today}`, ["ผู้รับบริการ", "HN", "สาขา", "ผู้ชำระ", "ใบค้าง", ...BUCKETS.map((b) => b.t), "รวมค้าง", "ค้างนานสุด (วัน)"],
    debtors.map((d) => [d.who, d.hn || "", d.branch, d.payer, String(d.docs.length), ...BUCKETS.map((b) => money(d.by[b.k])), money(d.total), String(d.oldest)]));

  if (!open.length) return null;
  return (
    <Section title="ลูกหนี้ค้างชำระตามอายุหนี้" sub="นับจากวันที่ออกใบ · ยิ่งค้างนานสียิ่งเข้ม · กดช่วงอายุเพื่อดูเฉพาะคนในช่วงนั้น · พิมพ์ใบแจ้งยอดค้างชำระรวมทุกใบให้ญาติได้"
      actions={<button className="btn-soft" onClick={exportCsv}><CsvIcon /> ส่งออก CSV</button>}>
      <div className="aging">
        <div className="aging-bar" role="img" aria-label={`ยอดค้างรวม ${money(grand)} บาท`}>
          {BUCKETS.map((b) => { const v = sumOf(b.k); return v ? <i key={b.k} className={b.c} style={{ width: `${(v / grand) * 100}%` }} title={`${b.t} ${money(v)} บาท`} /> : null; })}
        </div>
        <div className="aging-tiles" role="radiogroup" aria-label="กรองตามอายุหนี้">
          <button type="button" role="radio" aria-checked={pick === ""} className={`aging-tile is-all ${pick === "" ? "is-on" : ""}`} onClick={() => setPick("")}>
            <span>ค้างทั้งหมด</span><b>{money(grand)}</b><small>{open.length} ใบ · {debtors.length} คน</small>
          </button>
          {BUCKETS.map((b) => (
            <button key={b.k} type="button" role="radio" aria-checked={pick === b.k} disabled={!countOf(b.k)} className={`aging-tile ${b.c} ${pick === b.k ? "is-on" : ""}`} onClick={() => setPick(pick === b.k ? "" : b.k)}>
              <span><i aria-hidden />{b.t}</span><b>{money(sumOf(b.k))}</b><small>{countOf(b.k)} ใบ</small>
            </button>
          ))}
        </div>
      </div>
      <DataTable search columns={["ผู้รับบริการ", ...(multi ? ["สาขา"] : []), "ผู้ชำระ", "ใบค้าง", ...BUCKETS.map((b) => b.t), "รวมค้าง (บาท)", "ค้างนานสุด"]}
        rows={shown.map((d) => [d.who, ...(multi ? [d.branch] : []), d.payer || "-", String(d.docs.length), ...BUCKETS.map((b) => r2(d.by[b.k])), money(d.total), `${d.oldest} วัน`])}
        render={(k, col) => {
          const d = shown[k], last = multi ? 9 : 8;
          if (!d || col !== last) return undefined;
          const c = BUCKETS.find((b) => b.k === bucketOf(d.oldest))!.c;
          return <span className={`aging-age ${c}`}>{d.oldest} วัน</span>;
        }}
        empty="ไม่มีลูกหนี้ในช่วงนี้"
        actions={[{ label: "ใบแจ้งยอดค้าง", onClick: (k) => setDoc(shown[k]) }]} />
      <PrintModal open={!!doc} title="ใบแจ้งยอดค้างชำระ" onClose={() => setDoc(null)}>
        {doc && <StatementDoc d={doc} branch={branchInfo(doc.branch)} today={today} by={by} />}
      </PrintModal>
    </Section>
  );
}

/** ใบแจ้งยอดค้างชำระ: ทุกใบที่ยังค้างของผู้รับบริการคนนี้ ณ วันที่พิมพ์ (ไม่ใช่ใบกำกับภาษี) */
function StatementDoc({ d, branch, today, by }: { d: Debtor; branch: DocBranch; today: string; by?: string }) {
  const docs = [...d.docs].sort((a, b) => a.x.date.localeCompare(b.x.date));
  return (
    <Paper>
      <DocHead branch={branch} refs={[["ณ วันที่", longDate(today)], ["HN", d.hn || "-"]]} />
      <DocTitle title="ใบแจ้งยอดค้างชำระ" sub="Statement of Outstanding Balance" />
      <KV items={[["เรียน", d.payer || "-"], ["ผู้รับบริการ", d.who], ["ที่อยู่", d.address || "-", true], ...(d.contract ? [["เลขที่สัญญา", d.contract] as [string, string]] : [])]} />
      <p className="doc-indent">ตามที่ท่านได้ใช้บริการของศูนย์ฯ ขอแจ้งรายการที่ยังค้างชำระ ณ วันที่ {longDate(today)} ดังนี้</p>
      <div className="doc-tbl"><table>
        <thead><tr><th>เลขที่เอกสาร</th><th>วันที่</th><th>รายการ</th><th className="n">ยอดตามใบ</th><th className="n">ชำระแล้ว</th><th className="n">คงค้าง</th><th className="n">ค้างมา</th></tr></thead>
        <tbody>{docs.map(({ x, age }) => (
          <tr key={x.id}><td>{x.no ?? "-"}</td><td>{docDate(x.date)}</td><td>{x.kind}{x.note ? ` · ${x.note}` : ""}</td><td className="n">{money(x.net)}</td><td className="n">{money(x.paid ?? 0)}</td><td className="n">{money(balanceOf(x))}</td><td className="n">{age} วัน</td></tr>
        ))}</tbody>
        <tfoot><tr><td colSpan={5}>รวมยอดค้างชำระ ({bahtText(d.total)})</td><td className="n">{money(d.total)}</td><td /></tr></tfoot>
      </table></div>
      <p className="doc-note">ช่องทางการชำระเงิน: {PAY_CHANNELS.join(" · ")}</p>
      <p className="doc-note">หากท่านชำระแล้ว ขออภัยมา ณ ที่นี้ และกรุณาแจ้งหลักฐานการชำระเงินกับฝ่ายการเงิน · เอกสารนี้ไม่ใช่ใบเสร็จรับเงินหรือใบกำกับภาษี</p>
      <Signs people={[["ฝ่ายการเงิน", by]]} />
      <DocFoot left={`ใบแจ้งยอดค้างชำระ · ${d.who}`} by={by} />
    </Paper>
  );
}
