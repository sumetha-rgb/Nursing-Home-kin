"use client";
/**
 * รายงานภาษีขาย (ประกอบ ภ.พ.30 รายเดือน) · ดึงจากใบกำกับภาษีในระบบ
 *  ใบกำกับภาษี 1 แถว = งวดรับเงิน 1 งวด (เลขที่ใบเสร็จ KN-RC…/KO-RC… · งวดก่อน 18 พ.ย. 2569 ใช้เลขเดิม: ครั้งเดียวครบ = เลขที่ใบ · หลายงวด = เลขที่-งวด) + ใบลดหนี้ (ยอดติดลบ)
 *  VAT ของงวด = ตัดรายการที่มี VAT ก่อน (lib/billing payTake) · แยกรายงานตามบริษัทของสาขา (ชื่อนิติบุคคล + เลขผู้เสียภาษี + สนญ./สาขา)
 *  แสดง 2 แบบ: เฉพาะใบที่มี VAT (ตามแบบสรรพากร · งวดที่ชำระเฉพาะส่วนไม่มี VAT ไม่ลงรายงาน) · ทั้งหมด (ทุกใบเสร็จ + คอลัมน์ยอดที่ไม่มี VAT / ยกเว้น · เลขเรียงครบ)
 *  ช่วงวันที่เลือกจากปฏิทิน (ทั้งเดือน = เดือนภาษี) · เรียงตามวันที่ออกใบกำกับภาษี · หน้าจอ/พิมพ์/ส่งออก ตรงกันเสมอ
 */
import { receiptNoOf } from "@/lib/receiptNo";
import { useEffect, useMemo, useState } from "react";
import Icon from "../Icon";
import CsvIcon from "../CsvIcon";
import { COMPANY, PageHeader } from "../ui";
import { PrintModal } from "../print/Docs";
import { RangePicker, quickRanges, spanTh, todayBkk } from "../PeriodPicker";
import { useBranchInfo } from "./Billing";
import { useBranchNames } from "@/lib/branches";
import { creditOf, docDate, money, parseItems, payTake, vatOf } from "@/lib/billing";
import { downloadCsv } from "@/lib/store";
import { useApp } from "@/lib/app";
import { taxIdText } from "@/lib/taxInfo";

type PayRow = { id: string; date: string; amount: number; invId: string; no: string; items: string; net: number; payer: string | null; who: string; taxId: string; payerBranch: string; branch: string; realN: number; n: number; paidBefore: number; status?: string; receiptNo?: string | null };
type CnRow = { id: string; date: string; no: string; items: string; net: number; payer: string | null; who: string; taxId: string; payerBranch: string; branch: string; ref: string };
type Row = { key: string; date: string; no: string; buyer: string; taxId: string; payerBranch: string; branch: string; base: number; vat: number; ex: number; tag?: string; ref?: string; inv: string; cn?: boolean };
type Mode = "vat" | "all";

const r2 = (n: number) => Math.round(n * 100) / 100;
const TH_MON = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const monthTh = (m: string) => `${TH_MON[Number(m.slice(5, 7)) - 1]} ปี ${Number(m.slice(0, 4)) + 543}`;
const neg = (n: number) => (n ? -n : 0);
const lastDay = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);

export function SalesTax() {
  const { toast } = useApp();
  const branchInfo = useBranchInfo();
  // ช่วงวันที่: ค่าเริ่มต้น = เดือนนี้ทั้งเดือน (เดือนภาษี)
  const today = todayBkk();
  const [rng, setRng] = useState<{ from: string; to: string; k?: string }>(() => ({ from: `${today.slice(0, 7)}-01`, to: lastDay(today.slice(0, 7)), k: `m:${today.slice(0, 7)}` }));
  /** ทั้งเดือนปฏิทิน = เดือนภาษี (หัวรายงานบอกชื่อเดือน) · อื่น ๆ = ช่วงวันที่ */
  const wholeMonth = rng.from.slice(0, 7) === rng.to.slice(0, 7) && rng.from.endsWith("-01") && (rng.to === lastDay(rng.from.slice(0, 7)) || (rng.from.slice(0, 7) === today.slice(0, 7) && rng.to >= today));
  const periodText = wholeMonth ? `เดือนภาษี ${monthTh(rng.from.slice(0, 7))}` : `ช่วงวันที่ ${spanTh(rng.from, rng.to)}`;
  const tag = wholeMonth ? rng.from.slice(0, 7) : `${rng.from}-ถึง-${rng.to}`;
  const [mode, setMode] = useState<Mode>("vat");
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
    fetch(`/api/billing?op=sales_tax&from=${rng.from}&to=${rng.to}`, { cache: "no-store" })
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "โหลดรายงานไม่สำเร็จ"); return d; })
      .then((d) => { if (live) setData({ pays: d.pays ?? [], cns: d.cns ?? [] }); })
      .catch((e) => { if (live) setErr((e as Error).message); });
    return () => { live = false; };
  }, [rng.from, rng.to]);

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

  // บริษัทที่มีในช่วงนี้ (ผู้บริหารเห็นทุกบริษัท · ผู้ใช้สาขาเห็นสาขาตัวเอง)
  //  คิดใหม่ทุกครั้ง (ไม่ memo): ข้อมูลสาขาโหลดทีหลังรายงาน · เดิมจำกลุ่มบริษัทตอนข้อมูลสาขายังไม่มา แล้วจับคู่แถวไม่ได้ (รายงานว่าง 0 รายการ)
  const cos = (() => {
    const m = new Map<string, ReturnType<typeof coOf>>();
    all.forEach((r) => { const c = coOf(r.branch); if (!m.has(c.key)) m.set(c.key, c); });
    return [...m.values()];
  })();
  const cur = cos.find((c) => c.key === co) ?? cos[0];
  // สาขาของบริษัทนี้ (จากข้อมูลสาขา + สาขาที่มีใบในช่วงนี้)
  const coBranches = cur ? [...new Set([...branchNames, ...all.map((r) => r.branch)])].filter((b) => b && coOf(b).key === cur.key).sort((a, b) => a.localeCompare(b, "th")) : [];
  const brNow = br && coBranches.includes(br) ? br : "";
  const shows = (r: Row) => (mode === "all" ? r.vat !== 0 || r.base !== 0 || r.ex !== 0 : r.vat !== 0 || r.base !== 0);
  const dated = all.filter((r) => cur && coOf(r.branch).key === cur.key && (!brNow || r.branch === brNow) && shows(r));
  const sum = (k: "base" | "vat" | "ex") => r2(dated.reduce((n, r) => n + r[k], 0));
  const tot = { base: sum("base"), vat: sum("vat"), ex: sum("ex") };
  /** มูลค่าสุทธิของแถว: แบบเฉพาะ VAT = มูลค่า + VAT · แบบทั้งหมด = รวมยอดที่ไม่มี VAT (= เงินที่รับงวดนั้น) */
  const rowTotal = (r: Row) => r2(r.base + r.vat + (mode === "all" ? r.ex : 0));
  const grand = r2(tot.base + tot.vat + (mode === "all" ? tot.ex : 0));
  const exCount = mode === "all" ? dated.filter((r) => !r.vat && !r.base).length : 0;

  const exportCsv = () => {
    if (!cur || !dated.length) return toast("ไม่มีรายการในช่วงนี้");
    const ex = mode === "all";
    downloadCsv(`รายงานภาษีขาย${ex ? "-ทั้งหมด" : ""}-${tag}-${cur.legal}${cur.office !== "สำนักงานใหญ่" ? `-${cur.office}` : ""}${brNow ? `-เฉพาะสาขา${brNow}` : ""}`,
      ["ลำดับ", "วันที่", "เลขที่ใบกำกับภาษี", "ชื่อผู้ซื้อสินค้า / ผู้รับบริการ", "เลขประจำตัวผู้เสียภาษีของผู้ซื้อ", "สนญ. / สาขา", "มูลค่าสินค้า / บริการ", "จำนวนเงินภาษีมูลค่าเพิ่ม", ...(ex ? ["ยอดที่ไม่มี VAT / ยกเว้น"] : []), "มูลค่าสุทธิ", "หมายเหตุ"],
      [...dated.map((r, i) => [String(i + 1), docDate(r.date), r.no, r.buyer, r.taxId, r.payerBranch, money(r.base), money(r.vat), ...(ex ? [money(r.ex)] : []), money(rowTotal(r)), [r.tag, r.ref].filter(Boolean).join(" · ")]),
        ["", "", "", `รวม ${dated.length} รายการ`, "", "", money(tot.base), money(tot.vat), ...(ex ? [money(tot.ex)] : []), money(grand), `${cur.legal} · เลขผู้เสียภาษี ${cur.taxId ? taxIdText(cur.taxId) : "-"} · ${cur.office} · ${periodText}${ex ? " · รวมใบที่ไม่มี VAT" : ""}${brNow ? ` · เฉพาะสาขา ${brNow} (ตรวจสอบภายใน)` : ""}`]]);
    toast(`ส่งออกรายงานภาษีขาย ${periodText} แล้ว ${dated.length} รายการ`);
  };

  const table = (rows: Row[]) => {
    const ex = mode === "all", span = ex ? 10 : 9;
    return (
      <table className="st-table">
        <thead>
          <tr><th rowSpan={2}>ลำดับ</th><th colSpan={2}>ใบกำกับภาษี</th><th rowSpan={2}>ชื่อผู้ซื้อสินค้า / ผู้รับบริการ</th><th rowSpan={2}>เลขประจำตัว<br />ผู้เสียภาษีของผู้ซื้อ</th><th rowSpan={2}>สนญ. /<br />สาขา</th>
            <th rowSpan={2}>มูลค่าสินค้า /<br />บริการ</th><th rowSpan={2}>จำนวนเงิน<br />ภาษีมูลค่าเพิ่ม</th>{ex && <th rowSpan={2}>ยอดที่ไม่มี VAT /<br />ยกเว้น</th>}<th rowSpan={2}>มูลค่าสุทธิ</th></tr>
          <tr><th>วันที่</th><th>เลขที่</th></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.key} className={r.cn ? "is-neg" : ""}>
              <td className="c">{i + 1}</td><td className="c">{docDate(r.date)}</td><td className="c">{r.no}</td>
              <td>{r.buyer}{r.tag && <span className={`st-chip ${r.cn ? "is-cn" : ""}`}>{r.tag}</span>}{ex && !r.vat && !r.base && !r.cn && <span className="st-chip">ไม่มี VAT</span>}{r.ref && <><br /><small>{r.ref}</small></>}</td>
              <td className="c">{r.taxId ? taxIdText(r.taxId) : ""}</td><td className="c">{r.payerBranch}</td>
              <td className="n">{money(r.base)}</td><td className="n">{money(r.vat)}</td>{ex && <td className="n">{money(r.ex)}</td>}<td className="n">{money(rowTotal(r))}</td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={span} className="c st-empty">ไม่มีใบกำกับภาษีในช่วงนี้</td></tr>}
          <tr className="is-tot"><td colSpan={6} className="n">รวม {rows.length} รายการ</td><td className="n">{money(tot.base)}</td><td className="n">{money(tot.vat)}</td>{ex && <td className="n">{money(tot.ex)}</td>}<td className="n">{money(grand)}</td></tr>
        </tbody>
      </table>
    );
  };
  const head = cur && (
    <>
      <div className="st-title"><b>รายงานภาษีขาย{mode === "all" ? " (รวมใบที่ไม่มี VAT)" : ""}</b><span>{periodText}</span></div>
      <div className="st-meta">
        <span>ชื่อผู้ประกอบการ : <b>{cur.legal}</b></span><span>เลขประจำตัวผู้เสียภาษีอากร : <b>{cur.taxId ? taxIdText(cur.taxId) : "-"}</b></span>
        <span>ชื่อสถานประกอบการ : {cur.address || "-"}</span><span>{cur.office === "สำนักงานใหญ่" ? "☑ สำนักงานใหญ่ ☐ สาขาที่ ....." : `☐ สำนักงานใหญ่ ☑ ${cur.office}`}</span>
      </div>
      {brNow && <p className="st-only">เฉพาะสาขา {brNow} · ใช้ตรวจสอบภายใน</p>}
      {mode === "all" && <p className="st-only">รวมใบเสร็จที่ไม่มีรายการ VAT · ใช้ตรวจเลขที่ใบกำกับภาษีให้ครบ และยอดขายที่ได้รับยกเว้น (ภ.พ.30) · ยื่นสรรพากรใช้แบบเฉพาะใบที่มี VAT</p>}
    </>
  );

  return (
    <>
      <PageHeader title="รายงานภาษีขาย" sub="ใบกำกับภาษีที่ออกในช่วงที่เลือก (งวดรับเงิน + ใบลดหนี้) · ใช้ประกอบการยื่น ภ.พ.30 · เรียงตามวันที่ออกใบกำกับภาษี"
        actions={<>
          <button className="btn-soft" disabled={!dated.length} onClick={exportCsv}><CsvIcon /> ส่งออก Excel / CSV</button>
          <button className="btn-primary" disabled={!cur} onClick={() => setPrint(true)}><Icon name="print" className="h-4 w-4" /> พิมพ์รายงาน</button>
        </>} />
      <div className="st-bar">
        <div><span className="label">ช่วงวันที่</span>
          {/* ปุ่มปฏิทินแบบเดียวกับทุกหน้า · แท็บทั้งเดือน = เดือนภาษี */}
          <RangePicker ariaLabel="ช่วงวันที่ของรายงาน" from={rng.from} to={rng.to} months quick={quickRanges()} current={rng.k}
            label={wholeMonth ? monthTh(rng.from.slice(0, 7)) : undefined}
            onChange={(f, t, k) => setRng({ from: f, to: k?.startsWith("m:") ? lastDay(k.slice(2)) : t, k })} /></div>
        <div><span className="label">แสดง</span>
          <div className="dash-period" role="radiogroup" aria-label="แสดงใบแบบไหน">
            {([["vat", "เฉพาะใบที่มี VAT"], ["all", "ทั้งหมด"]] as const).map(([v, t]) => <button key={v} type="button" role="radio" aria-checked={mode === v} className={mode === v ? "is-on" : ""} onClick={() => setMode(v)}>{t}</button>)}
          </div></div>
        {cos.length > 1 && <label><span className="label">บริษัท / สถานประกอบการ</span>
          <select value={cur?.key ?? ""} onChange={(e) => { setCo(e.target.value); setBr(""); }} aria-label="บริษัท">{cos.map((c) => <option key={c.key} value={c.key}>{c.legal} · {c.office}</option>)}</select></label>}
        {coBranches.length > 0 && <label><span className="label">สาขา</span>
          <select value={brNow} onChange={(e) => setBr(e.target.value)} aria-label="สาขา">
            <option value="">ทุกสาขาของบริษัท</option>
            {coBranches.map((b) => <option key={b} value={b}>{b}{all.some((r) => r.branch === b && shows(r)) ? "" : " · ไม่มีใบในช่วงนี้"}</option>)}
          </select></label>}
      </div>
      {err && <p role="alert" className="form-error">{err}</p>}
      {cur && !cur.taxId && <p className="st-warn">ยังไม่ได้ตั้งเลขประจำตัวผู้เสียภาษีของ {cur.legal} · ตั้งได้ที่หน้าใบแจ้งหนี้และใบเสร็จ (ข้อมูลผู้เสียภาษีของสาขา)</p>}
      <div className="st-tiles">
        <div><small>จำนวนใบกำกับภาษี</small><b>{data ? dated.length : "…"}</b>{mode === "all" && data && exCount > 0 && <small>ไม่มี VAT {exCount} ใบ</small>}</div>
        <div><small>มูลค่าสินค้า/บริการ (ก่อน VAT)</small><b>{data ? money(tot.base) : "…"}</b></div>
        <div><small>ภาษีมูลค่าเพิ่ม</small><b>{data ? money(tot.vat) : "…"}</b></div>
        {mode === "all" && <div><small>ยอดที่ไม่มี VAT / ยกเว้น</small><b>{data ? money(tot.ex) : "…"}</b></div>}
        <div><small>รวมทั้งสิ้น</small><b>{data ? money(grand) : "…"}</b></div>
      </div>
      <section className="card st-paper">
        {!data && !err ? <p className="st-empty">กำลังโหลด…</p> : !cur ? <p className="st-empty">ไม่มีใบกำกับภาษีใน{periodText}</p> : <>{head}<div className="st-scroll">{table(dated)}</div></>}
      </section>
      <PrintModal open={print} title={`รายงานภาษีขาย · ${periodText}${mode === "all" ? " · รวมใบที่ไม่มี VAT" : ""}${brNow ? ` · สาขา ${brNow}` : ""}`} onClose={() => setPrint(false)}>
        {cur && <div className="doc-paper st-print">{head}{table(dated)}<div className="st-sign"><div>ผู้จัดทำ</div><div>ผู้ตรวจสอบ</div></div></div>}
      </PrintModal>
    </>
  );
}
