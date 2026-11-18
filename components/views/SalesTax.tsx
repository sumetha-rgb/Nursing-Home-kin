"use client";
/**
 * รายงานภาษีขาย (ประกอบ ภ.พ.30 รายเดือน) · ดึงจากใบกำกับภาษีในระบบ
 *  ใบกำกับภาษี 1 แถว = งวดรับเงิน 1 งวด (เลขที่ใบเสร็จ KN-RC…/KO-RC… · งวดก่อน 18 พ.ย. 2569 ใช้เลขเดิม: ครั้งเดียวครบ = เลขที่ใบ · หลายงวด = เลขที่-งวด) + ใบลดหนี้ (ยอดติดลบ)
 *  VAT ของงวด = ตัดรายการที่มี VAT ก่อน (lib/billing payTake) · แยกรายงานตามบริษัทของสาขา (ชื่อนิติบุคคล + เลขผู้เสียภาษี + สนญ./สาขา)
 *  เฉพาะยอดที่มี VAT ตามแบบสรรพากร (งวดที่ชำระเฉพาะส่วนไม่มี VAT ไม่ลงรายงาน) · เรียงตามวันที่ออกใบกำกับภาษี · หน้าจอ/พิมพ์/ส่งออก ตรงกันเสมอ
 */
import { receiptNoOf } from "@/lib/receiptNo";
import { useEffect, useMemo, useState } from "react";
import Icon from "../Icon";
import CsvIcon from "../CsvIcon";
import { COMPANY, PageHeader } from "../ui";
import { PrintModal } from "../print/Docs";
import { useBranchInfo } from "./Billing";
import { useBranchNames } from "@/lib/branches";
import { creditOf, docDate, money, parseItems, payTake, vatOf } from "@/lib/billing";
import { downloadCsv } from "@/lib/store";
import { useApp } from "@/lib/app";
import { taxIdText } from "@/lib/taxInfo";

type PayRow = { id: string; date: string; amount: number; invId: string; no: string; items: string; net: number; payer: string | null; who: string; taxId: string; payerBranch: string; branch: string; realN: number; n: number; paidBefore: number; status?: string; receiptNo?: string | null };
type CnRow = { id: string; date: string; no: string; items: string; net: number; payer: string | null; who: string; taxId: string; payerBranch: string; branch: string; ref: string };
type Row = { key: string; date: string; no: string; buyer: string; taxId: string; payerBranch: string; branch: string; base: number; vat: number; ex: number; tag?: string; ref?: string; inv: string; cn?: boolean };

const r2 = (n: number) => Math.round(n * 100) / 100;
const TH_MON = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const monthTh = (m: string) => `${TH_MON[Number(m.slice(5, 7)) - 1]} ปี ${Number(m.slice(0, 4)) + 543}`;
const thisMonth = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7);
const neg = (n: number) => (n ? -n : 0);

export function SalesTax() {
  const { toast } = useApp();
  const branchInfo = useBranchInfo();
  const [month, setMonth] = useState(thisMonth);
  const [data, setData] = useState<{ pays: PayRow[]; cns: CnRow[] } | null>(null);
  const [err, setErr] = useState("");
  const [co, setCo] = useState("");
  /** แยกดูสาขา: ว่าง = ทุกสาขาของบริษัท · เลือกสาขา = ใช้ตรวจสอบภายใน */
  const [br, setBr] = useState("");
  const branchNames = useBranchNames();
  const [print, setPrint] = useState(false);

  useEffect(() => {
    setData(null); setErr("");
    let live = true;
    fetch(`/api/billing?op=sales_tax&month=${month}`, { cache: "no-store" })
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "โหลดรายงานไม่สำเร็จ"); return d; })
      .then((d) => { if (live) setData({ pays: d.pays ?? [], cns: d.cns ?? [] }); })
      .catch((e) => { if (live) setErr((e as Error).message); });
    return () => { live = false; };
  }, [month]);

  /** บริษัทผู้ออกใบกำกับภาษีของสาขา (ตามข้อมูลสาขา) */
  const coOf = (branch: string) => {
    const b = branchInfo(branch), legal = b.legal || COMPANY.th;
    const office = b.office || "สำนักงานใหญ่";
    return { key: `${legal}|${b.taxId ?? ""}|${office}`, legal, taxId: b.taxId ?? "", office, address: office === "สำนักงานใหญ่" && legal === COMPANY.th ? COMPANY.address : b.address };
  };

  const all: Row[] = useMemo(() => {
    if (!data) return [];
    const out: Row[] = [];
    for (const p of data.pays) {
      const its = parseItems(p.items);
      const t = payTake(its, creditOf(its) + p.paidBefore, p.amount);
      const single = p.realN <= 1 && p.amount >= p.net - 0.005;
      const done = r2(p.paidBefore + p.amount) >= p.net - 0.005;
      out.push({
        key: p.id, date: p.date, no: receiptNoOf(p, p.no, p.n, single), buyer: p.payer || p.who, taxId: p.taxId, payerBranch: p.payerBranch, branch: p.branch,
        base: t.base, vat: t.vat, ex: t.exempt, inv: p.no,
        // งวด n/ทั้งหมด (รู้จำนวนงวดทั้งหมดเมื่อใบชำระครบแล้ว) · งวดที่ทำให้ครบ บอก "ชำระครบ"
        ...(single ? {} : { tag: `งวด ${p.n}${p.status === "ชำระแล้ว" ? `/${p.realN}` : ""}`, ref: `ใบ ${p.no}${done ? " · ชำระครบ" : ""}` }),
      });
    }
    for (const c of data.cns) {
      const v = vatOf(parseItems(c.items));
      out.push({ key: c.id, date: c.date, no: c.no, buyer: c.payer || c.who, taxId: c.taxId, payerBranch: c.payerBranch, branch: c.branch,
        base: neg(v.base), vat: neg(v.vat), ex: neg(v.exempt), tag: "ลดหนี้", ref: c.ref ? `อ้างอิง ${c.ref}` : undefined, inv: c.ref || c.no, cn: true });
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.no.localeCompare(b.no));
  }, [data]);

  // บริษัทที่มีในเดือนนี้ (ผู้บริหารเห็นทุกบริษัท · ผู้ใช้สาขาเห็นสาขาตัวเอง)
  const cos = useMemo(() => {
    const m = new Map<string, ReturnType<typeof coOf>>();
    all.forEach((r) => { const c = coOf(r.branch); if (!m.has(c.key)) m.set(c.key, c); });
    return [...m.values()];
  }, [all]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = cos.find((c) => c.key === co) ?? cos[0];
  // สาขาของบริษัทนี้ (จากข้อมูลสาขา + สาขาที่มีใบในเดือน)
  const coBranches = cur ? [...new Set([...branchNames, ...all.map((r) => r.branch)])].filter((b) => b && coOf(b).key === cur.key).sort((a, b) => a.localeCompare(b, "th")) : [];
  const brNow = br && coBranches.includes(br) ? br : "";
  const dated = all.filter((r) => cur && coOf(r.branch).key === cur.key && (!brNow || r.branch === brNow) && (r.vat !== 0 || r.base !== 0));
  const sum = (k: "base" | "vat") => r2(dated.reduce((n, r) => n + r[k], 0));
  const tot = { base: sum("base"), vat: sum("vat") };
  const rowTotal = (r: Row) => r2(r.base + r.vat);
  const grand = r2(tot.base + tot.vat);

  const exportCsv = () => {
    if (!cur || !dated.length) return toast("ไม่มีรายการในเดือนนี้");
    downloadCsv(`รายงานภาษีขาย-${month}-${cur.legal}${cur.office !== "สำนักงานใหญ่" ? `-${cur.office}` : ""}${brNow ? `-เฉพาะสาขา${brNow}` : ""}`,
      ["ลำดับ", "วันที่", "เลขที่ใบกำกับภาษี", "ชื่อผู้ซื้อสินค้า / ผู้รับบริการ", "เลขประจำตัวผู้เสียภาษีของผู้ซื้อ", "สนญ. / สาขา", "มูลค่าสินค้า / บริการ", "จำนวนเงินภาษีมูลค่าเพิ่ม", "มูลค่าสุทธิ", "หมายเหตุ"],
      [...dated.map((r, i) => [String(i + 1), docDate(r.date), r.no, r.buyer, r.taxId, r.payerBranch, money(r.base), money(r.vat), money(rowTotal(r)), [r.tag, r.ref].filter(Boolean).join(" · ")]),
        ["", "", "", `รวม ${dated.length} รายการ`, "", "", money(tot.base), money(tot.vat), money(grand), `${cur.legal} · เลขผู้เสียภาษี ${cur.taxId ? taxIdText(cur.taxId) : "-"} · ${cur.office} · เดือนภาษี ${monthTh(month)}${brNow ? ` · เฉพาะสาขา ${brNow} (ตรวจสอบภายใน)` : ""}`]]);
    toast(`ส่งออกรายงานภาษีขาย ${monthTh(month)} แล้ว ${dated.length} รายการ`);
  };

  const table = (rows: Row[]) => (
    <table className="st-table">
      <thead>
        <tr><th rowSpan={2}>ลำดับ</th><th colSpan={2}>ใบกำกับภาษี</th><th rowSpan={2}>ชื่อผู้ซื้อสินค้า / ผู้รับบริการ</th><th rowSpan={2}>เลขประจำตัว<br />ผู้เสียภาษีของผู้ซื้อ</th><th rowSpan={2}>สนญ. /<br />สาขา</th>
          <th rowSpan={2}>มูลค่าสินค้า /<br />บริการ</th><th rowSpan={2}>จำนวนเงิน<br />ภาษีมูลค่าเพิ่ม</th><th rowSpan={2}>มูลค่าสุทธิ</th></tr>
        <tr><th>วันที่</th><th>เลขที่</th></tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.key} className={r.cn ? "is-neg" : ""}>
            <td className="c">{i + 1}</td><td className="c">{docDate(r.date)}</td><td className="c">{r.no}</td>
            <td>{r.buyer}{r.tag && <span className={`st-chip ${r.cn ? "is-cn" : ""}`}>{r.tag}</span>}{r.ref && <><br /><small>{r.ref}</small></>}</td>
            <td className="c">{r.taxId ? taxIdText(r.taxId) : ""}</td><td className="c">{r.payerBranch}</td>
            <td className="n">{money(r.base)}</td><td className="n">{money(r.vat)}</td><td className="n">{money(rowTotal(r))}</td>
          </tr>
        ))}
        {!rows.length && <tr><td colSpan={9} className="c st-empty">ไม่มีใบกำกับภาษีในเดือนนี้</td></tr>}
        <tr className="is-tot"><td colSpan={6} className="n">รวม {rows.length} รายการ</td><td className="n">{money(tot.base)}</td><td className="n">{money(tot.vat)}</td><td className="n">{money(grand)}</td></tr>
      </tbody>
    </table>
  );
  const head = cur && (
    <>
      <div className="st-title"><b>รายงานภาษีขาย</b><span>เดือนภาษี {monthTh(month)}</span></div>
      <div className="st-meta">
        <span>ชื่อผู้ประกอบการ : <b>{cur.legal}</b></span><span>เลขประจำตัวผู้เสียภาษีอากร : <b>{cur.taxId ? taxIdText(cur.taxId) : "-"}</b></span>
        <span>ชื่อสถานประกอบการ : {cur.address || "-"}</span><span>{cur.office === "สำนักงานใหญ่" ? "☑ สำนักงานใหญ่ ☐ สาขาที่ ....." : `☐ สำนักงานใหญ่ ☑ ${cur.office}`}</span>
      </div>
      {brNow && <p className="st-only">เฉพาะสาขา {brNow} · ใช้ตรวจสอบภายใน</p>}
    </>
  );

  return (
    <>
      <PageHeader title="รายงานภาษีขาย" sub="ใบกำกับภาษีที่ออกในเดือน (งวดรับเงิน + ใบลดหนี้) · ใช้ประกอบการยื่น ภ.พ.30 · เรียงตามวันที่ออกใบกำกับภาษี"
        actions={<>
          <button className="btn-soft" disabled={!dated.length} onClick={exportCsv}><CsvIcon /> ส่งออก Excel / CSV</button>
          <button className="btn-primary" disabled={!cur} onClick={() => setPrint(true)}><Icon name="print" className="h-4 w-4" /> พิมพ์รายงาน</button>
        </>} />
      <div className="st-bar">
        <label><span className="label">เดือนภาษี</span><input type="month" value={month} max={thisMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="เดือนภาษี" /></label>
        {cos.length > 1 && <label><span className="label">บริษัท / สถานประกอบการ</span>
          <select value={cur?.key ?? ""} onChange={(e) => { setCo(e.target.value); setBr(""); }} aria-label="บริษัท">{cos.map((c) => <option key={c.key} value={c.key}>{c.legal} · {c.office}</option>)}</select></label>}
        {coBranches.length > 0 && <label><span className="label">สาขา</span>
          <select value={brNow} onChange={(e) => setBr(e.target.value)} aria-label="สาขา">
            <option value="">ทุกสาขาของบริษัท</option>
            {coBranches.map((b) => <option key={b} value={b}>{b}{all.some((r) => r.branch === b && (r.vat || r.base)) ? "" : " · ไม่มีใบในเดือนนี้"}</option>)}
          </select></label>}
      </div>
      {err && <p role="alert" className="form-error">{err}</p>}
      {cur && !cur.taxId && <p className="st-warn">ยังไม่ได้ตั้งเลขประจำตัวผู้เสียภาษีของ {cur.legal} · ตั้งได้ที่หน้าใบแจ้งหนี้และใบเสร็จ (ข้อมูลผู้เสียภาษีของสาขา)</p>}
      <div className="st-tiles">
        <div><small>จำนวนใบกำกับภาษี</small><b>{data ? dated.length : "…"}</b></div>
        <div><small>มูลค่าสินค้า/บริการ (ก่อน VAT)</small><b>{data ? money(tot.base) : "…"}</b></div>
        <div><small>ภาษีมูลค่าเพิ่ม</small><b>{data ? money(tot.vat) : "…"}</b></div>
        <div><small>รวมทั้งสิ้น</small><b>{data ? money(grand) : "…"}</b></div>
      </div>
      <section className="card st-paper">
        {!data && !err ? <p className="st-empty">กำลังโหลด…</p> : !cur ? <p className="st-empty">ไม่มีใบกำกับภาษีใน{monthTh(month)}</p> : <>{head}<div className="st-scroll">{table(dated)}</div></>}
      </section>
      <PrintModal open={print} title={`รายงานภาษีขาย · ${monthTh(month)}${brNow ? ` · สาขา ${brNow}` : ""}`} onClose={() => setPrint(false)}>
        {cur && <div className="doc-paper st-print">{head}{table(dated)}<div className="st-sign"><div>ผู้จัดทำ</div><div>ผู้ตรวจสอบ</div></div></div>}
      </PrintModal>
    </>
  );
}
