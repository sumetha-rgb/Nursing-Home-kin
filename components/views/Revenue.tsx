"use client";
/**
 * รายได้ตามฝ่าย (รายงานภายใน) · ตอบว่าเงินแต่ละส่วนเป็นรายได้ของบริษัทไหน มาจากฝ่ายไหน
 *  ยอดออกใบ = ใบที่ออกในเดือน (ใบลดหนี้เป็นยอดลบ) · รับเงินจริง = งวดรับเงินในเดือน ตัดลงรายการตามลำดับตัดชำระ (lib/billing payTake)
 *  ค้างรับ = ยอดที่ยังไม่ได้รับของใบที่ออกในเดือน · ไม่นับเงินประกัน/มัดจำ · รายการ → ฝ่าย → บริษัท ตั้งค่าได้ที่ ตั้งค่า › ฝ่ายและบริษัท
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import CsvIcon from "../CsvIcon";
import { COMPANY, Modal, PageHeader } from "../ui";
import { lineCode } from "@/lib/priceList";
import { MonthPicker, RangePicker } from "../PeriodPicker";
import { useBranchInfo } from "./Billing";
import { creditOf, money, parseItems, payOrder, payTake } from "@/lib/billing";
import { BU_CAT_TH, buCatOf, DEFAULT_DIVISIONS, Division, divisionOf, NO_DIV } from "@/lib/bu";
import { downloadCsv, useRecords } from "@/lib/store";
import { useBranchNames } from "@/lib/branches";
import { usePriceList } from "@/lib/usePrices";
import { useSession } from "@/lib/session";
import { seesAllBranches } from "@/lib/roles";
import { useApp } from "@/lib/app";

type Inv = { id: string; no: string; date: string; items: string; net: number; paid: number; branch: string; status: string; cn: boolean; who?: string };
type Pay = { id: string; date: string; amount: number; items: string; branch: string; paidBefore: number; no?: string; receiptNo?: string; who?: string };
/** บรรทัดที่นับเข้าฝ่าย (ปุ่ม "ดูรายการ"): bill = ยอดออกใบ · recv = เงินที่รับจริง */
type Line = { kind: "bill" | "recv"; date: string; no: string; rcpt: string; who: string; branch: string; desc: string; code: string; cat: string; amount: number; vat: number; owe: number };
type Cell = { billed: number; recv: number; base: number; vat: number; owe: number };
type Div = Cell & { name: string; byBranch: Map<string, Cell> };
type Co = Cell & { name: string; divs: Map<string, Div> };

const r2 = (n: number) => Math.round(n * 100) / 100;
const TH_MON = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const monthTh = (m: string) => `${TH_MON[Number(m.slice(5, 7)) - 1]} ${Number(m.slice(0, 4)) + 543}`;
const thisMonth = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7);
const todayIso = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const SHM = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const dTh = (s: string) => `${Number(s.slice(8, 10))} ${SHM[Number(s.slice(5, 7)) - 1]} ${String(Number(s.slice(0, 4)) + 543).slice(2)}`;
/** ช่วงวันที่แบบสั้น: "5 พ.ย. 69" · "1–18 พ.ย. 69" · "20 ต.ค. 69 – 5 พ.ย. 69" */
const spanTh = (a: string, b: string) => (a === b ? dTh(a) : a.slice(0, 7) === b.slice(0, 7) ? `${Number(a.slice(8, 10))}–${dTh(b)}` : `${dTh(a)} – ${dTh(b)}`);
const zero = (): Cell => ({ billed: 0, recv: 0, base: 0, vat: 0, owe: 0 });
const add = (c: Cell, d: Partial<Cell>) => { (Object.keys(d) as (keyof Cell)[]).forEach((k) => { c[k] = r2(c[k] + (d[k] ?? 0)); }); };
const CN_DIV = "ลดหนี้ (ปรับลดยอดออกใบ)";
/** สีของบริษัทในแถบสัดส่วน (เรียงตามยอด) */
const CO_COLORS = ["#8a5a1a", "#2b6b7a", "#6b7a2b", "#7a2b5a", "#4a4a8a"];

export function Revenue() {
  usePriceList();
  const { toast } = useApp();
  const { user } = useSession();
  const all = seesAllBranches(user?.role);
  const branchInfo = useBranchInfo();
  const branchNames = useBranchNames();
  // ยังไม่มีการตั้งค่าฝ่ายในระบบ = ใช้ค่าตั้งต้น (ผู้บริหารเปิดหน้าตั้งค่าครั้งแรกจะบันทึกค่าตั้งต้นให้)
  const [saved] = useRecords<Division>("bu-divisions", DEFAULT_DIVISIONS);
  const divs = saved.length ? saved : DEFAULT_DIVISIONS;
  const [month, setMonth] = useState(thisMonth);
  /** เลือกช่วงวันที่เอง (ปฏิทิน) แทนทั้งเดือน */
  const [useRange, setUseRange] = useState(false);
  const [rng, setRng] = useState<[string, string]>(() => [`${thisMonth()}-01`, todayIso()]);
  const [from, to] = rng[0] <= rng[1] ? rng : [rng[1], rng[0]];
  const label = useRange ? spanTh(from, to) : monthTh(month);
  const [branch, setBranch] = useState("");
  /** เลือกดูบริษัทเดียว (ผู้เห็นทุกสาขา) · ว่าง = ทุกบริษัท */
  const [company, setCompany] = useState("");
  const [basis, setBasis] = useState<"recv" | "billed">("recv");
  const [open, setOpen] = useState<string | null>(null);
  /** ตารางกว้างกว่าจอ (มือถือ): บอกว่าเลื่อนดูต่อได้ · เงาขอบขวาหายเมื่อเลื่อนสุด */
  const scrollRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const checkMore = useCallback(() => { const el = scrollRef.current; setMore(!!el && el.scrollWidth - el.clientWidth - el.scrollLeft > 4); }, []);
  const [data, setData] = useState<{ invs: Inv[]; pays: Pay[] } | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    setData(null); setErr("");
    let live = true;
    const q = useRange ? `month=${to.slice(0, 7)}&from=${from}&to=${to}` : `month=${month}`;
    fetch(`/api/billing?op=revenue&${q}${all && branch ? `&branch=${encodeURIComponent(branch)}` : ""}`, { cache: "no-store" })
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "โหลดรายงานไม่สำเร็จ"); return d; })
      .then((d) => { if (live) setData({ invs: d.invs ?? [], pays: d.pays ?? [] }); })
      .catch((e) => { if (live) setErr((e as Error).message); });
    return () => { live = false; };
  }, [month, branch, all, useRange, from, to]);

  const legalOf = (b: string) => branchInfo(b).legal || COMPANY.th;
  const { cos, total, dep, lines } = useMemo(() => {
    const cos = new Map<string, Co>(), total = zero();
    /** บรรทัดของแต่ละ บริษัท|ฝ่าย (ใช้กับหน้าต่างดูรายการ) */
    const lines = new Map<string, Line[]>();
    const keep = (k: string, ln: Line) => { if (!lines.has(k)) lines.set(k, []); lines.get(k)!.push(ln); };
    let dep = 0;
    const slot = (coName: string, divName: string, b: string) => {
      if (!cos.has(coName)) cos.set(coName, { name: coName, divs: new Map(), ...zero() });
      const co = cos.get(coName)!;
      if (!co.divs.has(divName)) co.divs.set(divName, { name: divName, byBranch: new Map(), ...zero() });
      const dv = co.divs.get(divName)!;
      if (!dv.byBranch.has(b)) dv.byBranch.set(b, zero());
      return [co, dv, dv.byBranch.get(b)!] as const;
    };
    const put = (b: string, cat: string, d: Partial<Cell>, ln: Omit<Line, "cat">) => {
      const dv = divisionOf(divs, cat);
      const [co, div, br] = slot(dv?.company || legalOf(b), dv?.name ?? NO_DIV, b);
      [co, div, br, total].forEach((c) => add(c, d));
      keep(`${co.name}|${div.name}`, { ...ln, cat });
    };
    if (!data) return { cos: [] as Co[], total, dep, lines };
    for (const x of data.invs) {
      const its = parseItems(x.items);
      if (x.cn) { // ใบลดหนี้: ลดยอดออกใบของบริษัทสาขา
        const sum = payOrder(its).reduce((n, l) => n + l.incl, 0);
        const [co, div, br] = slot(legalOf(x.branch), CN_DIV, x.branch);
        [co, div, br, total].forEach((c) => add(c, { billed: -sum }));
        keep(`${co.name}|${div.name}`, { kind: "bill", date: x.date, no: x.no, rcpt: "", who: x.who ?? "", branch: x.branch, desc: "ใบลดหนี้", code: "", cat: "CN", amount: -r2(sum), vat: 0, owe: 0 });
        continue;
      }
      const paidK = new Map(payTake(its, 0, creditOf(its) + x.paid).lines.map((l) => [l.k, l.take]));
      for (const l of payOrder(its)) {
        const cat = buCatOf(l.item);
        if (cat === "dep") continue;
        const owe = Math.max(0, r2(l.incl - (paidK.get(l.k) ?? 0)));
        put(x.branch, cat, { billed: l.incl, owe }, { kind: "bill", date: x.date, no: x.no, rcpt: "", who: x.who ?? "", branch: x.branch, desc: l.item.desc, code: lineCode(l.item), amount: l.incl, vat: 0, owe });
      }
    }
    for (const p of data.pays) {
      const its = parseItems(p.items);
      for (const l of payTake(its, creditOf(its) + p.paidBefore, p.amount).lines) {
        const cat = buCatOf(l.item);
        if (cat === "dep") { dep = r2(dep + l.take); continue; }
        put(p.branch, cat, { recv: l.take, vat: l.takeVat, base: r2(l.take - l.takeVat) },
          { kind: "recv", date: p.date, no: p.no ?? "", rcpt: p.receiptNo ?? "", who: p.who ?? "", branch: p.branch, desc: l.item.desc, code: lineCode(l.item), amount: l.take, vat: l.takeVat, owe: 0 });
      }
    }
    const sorted = [...cos.values()].sort((a, b) => b[basis] - a[basis]);
    return { cos: sorted, total, dep, lines };
  }, [data, divs, basis]); // eslint-disable-line react-hooks/exhaustive-deps

  // เลือกบริษัท: ตารางและตัวเลขด้านบนเหลือบริษัทนั้น · สัดส่วนคิดภายในบริษัทนั้น
  const coNames = [...new Set([...branchNames.map((b) => legalOf(b)), ...cos.map((c) => c.name)])];
  const view = company ? cos.filter((c) => c.name === company) : cos;
  const vt = company ? view.reduce((t, c) => { add(t, { billed: c.billed, recv: c.recv, base: c.base, vat: c.vat, owe: c.owe }); return t; }, zero()) : total;
  const share = (c: Cell) => (vt[basis] ? Math.round((c[basis] / vt[basis]) * 100) : 0);
  const exportCsv = () => {
    if (!view.length) return toast("ไม่มีข้อมูลในเดือนนี้");
    const row = (a: string, b: string, c: string, x: Cell) => [a, b, c, money(x.billed), money(x.recv), money(x.base), money(x.vat), money(x.owe), `${share(x)}%`];
    downloadCsv(`รายได้ตามฝ่าย-${useRange ? `${from}-ถึง-${to}` : month}${branch ? `-${branch}` : ""}${company ? `-${company}` : ""}`, ["บริษัท", "ฝ่าย", "สาขา", "ยอดออกใบ", "รับเงินจริง", "ก่อน VAT (เงินที่รับ)", "VAT (เงินที่รับ)", "ค้างรับ", `สัดส่วน (${basis === "recv" ? "เงินที่รับ" : "ยอดออกใบ"})`],
      [...view.flatMap((co) => [row(co.name, "รวมบริษัท", "", co), ...[...co.divs.values()].flatMap((d) => [row(co.name, d.name, "ทุกสาขา", d), ...[...d.byBranch.entries()].map(([b, x]) => row(co.name, d.name, b, x))])]), row(company ? `รวม ${company}` : "รวมทุกบริษัท", "", "", vt)]);
    toast(`ส่งออกรายได้ตามฝ่าย ${label} แล้ว`);
  };

  // แท็บ: สรุป (บริษัท › ฝ่าย › สาขา) · รายการทั้งหมด (ทุกบรรทัด กรองได้ ใช้กระทบยอด)
  const [tab, setTab] = useState<"sum" | "lines">("sum");
  const [lf, setLf] = useState({ kind: "recv" as "recv" | "billed", div: "", cat: "", nocode: false, q: "" });
  const allLines = [...lines.entries()].flatMap(([k, arr]) => { const [co, div] = k.split("|"); return arr.map((x) => ({ ...x, co, div })); })
    .filter((x) => !company || x.co === company);
  const divNames = [...new Set(allLines.map((x) => x.div))];
  const catsIn = [...new Set(allLines.map((x) => x.cat))];
  const lq = lf.q.trim().toLowerCase();
  const lfShown = allLines.filter((x) => (lf.kind === "recv" ? x.kind === "recv" : x.kind === "bill") && (!lf.div || x.div === lf.div) && (!lf.cat || x.cat === lf.cat)
    && (!lf.nocode || (!x.code && x.cat !== "CN")) && (!lq || `${x.no} ${x.rcpt} ${x.who} ${x.desc} ${x.code} ${x.branch}`.toLowerCase().includes(lq)))
    .sort((a, b) => b.date.localeCompare(a.date) || a.no.localeCompare(b.no));
  const LF_MAX = 300;
  const noCodeN = allLines.filter((x) => (lf.kind === "recv" ? x.kind === "recv" : x.kind === "bill") && !x.code && x.cat !== "CN").length;
  const exportAll = () => downloadCsv(`รายการรายได้ตามฝ่าย-${useRange ? `${from}-ถึง-${to}` : month}${branch ? `-${branch}` : ""}`,
    ["วันที่", "เลขที่ใบเสร็จ", "เลขที่ใบแจ้งหนี้", "ผู้รับบริการ", "สาขา", "บริษัท", "ฝ่าย", "รายการ", "รหัส", "หมวด", lf.kind === "recv" ? "รับเงิน" : "ยอดออกใบ", lf.kind === "recv" ? "VAT" : "ค้างรับ"],
    lfShown.map((x) => [dTh(x.date), x.rcpt, x.no, x.who, x.branch, x.co, x.div, x.desc, x.code, x.cat === "CN" ? "ใบลดหนี้" : BU_CAT_TH[x.cat] ?? x.cat, money(x.amount), money(lf.kind === "recv" ? x.vat : x.owe)]));
  // หน้าต่างดูรายการของฝ่าย
  const [linesOf, setLinesOf] = useState<{ co: string; div: string } | null>(null);
  const [linesTab, setLinesTab] = useState<"recv" | "billed">("recv");
  const lnAll = linesOf ? lines.get(`${linesOf.co}|${linesOf.div}`) ?? [] : [];
  const lnShown = lnAll.filter((x) => (linesTab === "recv" ? x.kind === "recv" : x.kind === "bill")).sort((a, b) => b.date.localeCompare(a.date) || a.no.localeCompare(b.no));
  const lnCats = [...lnShown.reduce((m, x) => { const v = m.get(x.cat) ?? [0, 0]; m.set(x.cat, [v[0] + 1, r2(v[1] + x.amount)]); return m; }, new Map<string, [number, number]>()).entries()].map(([c, [n, s]]) => [c, n, s] as const);
  const exportLines = () => {
    if (!linesOf) return;
    downloadCsv(`รายการ-${linesOf.div}-${useRange ? `${from}-ถึง-${to}` : month}`, ["วันที่", "เลขที่ใบเสร็จ", "เลขที่ใบแจ้งหนี้", "ผู้รับบริการ", "สาขา", "รายการ", "รหัส", "หมวด", linesTab === "recv" ? "รับเงิน" : "ยอดออกใบ", linesTab === "recv" ? "VAT" : "ค้างรับ"],
      lnShown.map((x) => [dTh(x.date), x.rcpt, x.no, x.who, x.branch, x.desc, x.code, x.cat === "CN" ? "ใบลดหนี้" : BU_CAT_TH[x.cat] ?? x.cat, money(x.amount), money(linesTab === "recv" ? x.vat : x.owe)]));
  };

  useEffect(() => { checkMore(); window.addEventListener("resize", checkMore); return () => window.removeEventListener("resize", checkMore); }, [checkMore, data, open, company, basis]);

  return (
    <>
      <PageHeader title="รายได้ตามฝ่าย" sub="รายได้แยกตามฝ่าย (กายภาพ พยาบาล ห้องพัก ฯลฯ) และบริษัทที่ได้รับ · ใช้ดูภายใน ใบเสร็จลูกค้าไม่เปลี่ยน · ไม่รวมเงินประกัน/มัดจำ"
        actions={<button className="btn-soft" disabled={!view.length} onClick={exportCsv}><CsvIcon /> ส่งออก Excel / CSV</button>} />
      <div className="st-bar is-grid">
        <div className="pp-field"><span className="label">เดือน</span><MonthPicker value={month} active={!useRange} onChange={(m) => { setMonth(m); setUseRange(false); }} /></div>
        <div className="pp-field"><span className="label">หรือเลือกช่วงวันที่</span><RangePicker from={from} to={to} active={useRange} onChange={(f, t) => { setRng([f, t]); setUseRange(true); }} onClear={() => setUseRange(false)} /></div>
        {all && coNames.length > 1 && <label><span className="label">บริษัท</span><select value={company} onChange={(e) => setCompany(e.target.value)} aria-label="บริษัท"><option value="">ทุกบริษัท</option>{coNames.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>}
        {all && <label><span className="label">สาขา</span><select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="สาขา"><option value="">ทุกสาขา</option>{branchNames.map((b) => <option key={b} value={b}>{b}</option>)}</select></label>}
        <label><span className="label">คิดสัดส่วนจาก</span><select value={basis} onChange={(e) => setBasis(e.target.value as "recv" | "billed")} aria-label="คิดสัดส่วนจาก"><option value="recv">เงินที่รับจริง</option><option value="billed">ยอดออกใบ</option></select></label>
      </div>
      {err && <p role="alert" className="form-error">{err}</p>}
      {!all && <p className="field-hint">แสดงเฉพาะสาขาของคุณ ({user?.branch || "-"}) · ดูทุกสาขาและทุกบริษัทได้เฉพาะผู้บริหารและการเงิน</p>}
      <div className="st-tiles">
        <div><small>ยอดออกใบ</small><b>{data ? money(vt.billed) : "…"}</b></div>
        <div><small>รับเงินจริง</small><b>{data ? money(vt.recv) : "…"}</b></div>
        <div><small>VAT ของเงินที่รับ</small><b>{data ? money(vt.vat) : "…"}</b></div>
        <div><small>ค้างรับ (ใบ{useRange ? "ในช่วงนี้" : "ของเดือนนี้"})</small><b>{data ? money(vt.owe) : "…"}</b></div>
      </div>
      <div className="seg rv-tabs" role="tablist" aria-label="มุมมอง">
        <button type="button" role="tab" aria-pressed={tab === "sum"} onClick={() => setTab("sum")}>สรุปตามบริษัทและฝ่าย</button>
        <button type="button" role="tab" aria-pressed={tab === "lines"} onClick={() => setTab("lines")}>รายการทั้งหมด{data ? ` ${allLines.length}` : ""}</button>
      </div>

      {/* รายการทั้งหมด: ทุกบรรทัดที่นับเป็นรายได้ กรองตามชนิดยอด ฝ่าย หมวด ไม่มีรหัส ค้นหา · ใช้กระทบยอดและหาบรรทัดที่เข้าฝ่ายผิด */}
      {tab === "lines" && <section className="card st-paper rv-card">
        {!data && !err ? <p className="st-empty">กำลังโหลด…</p> : <>
          <div className="rv-lf">
            <div className="seg" role="tablist" aria-label="ชนิดยอด">
              <button type="button" role="tab" aria-pressed={lf.kind === "recv"} onClick={() => setLf({ ...lf, kind: "recv" })}>รับเงินจริง</button>
              <button type="button" role="tab" aria-pressed={lf.kind === "billed"} onClick={() => setLf({ ...lf, kind: "billed" })}>ยอดออกใบ</button>
            </div>
            <select value={lf.div} onChange={(e) => setLf({ ...lf, div: e.target.value })} aria-label="ฝ่าย"><option value="">ทุกฝ่าย</option>{divNames.map((d) => <option key={d} value={d}>{d}</option>)}</select>
            <select value={lf.cat} onChange={(e) => setLf({ ...lf, cat: e.target.value })} aria-label="หมวด"><option value="">ทุกหมวด</option>{catsIn.map((c) => <option key={c} value={c}>{c === "CN" ? "ใบลดหนี้" : `${c} · ${BU_CAT_TH[c] ?? c}`}</option>)}</select>
            <button type="button" aria-pressed={lf.nocode} className={`rv-nocode ${lf.nocode ? "is-on" : ""}`} onClick={() => setLf({ ...lf, nocode: !lf.nocode })}>ไม่มีรหัส {noCodeN}</button>
            <input value={lf.q} onChange={(e) => setLf({ ...lf, q: e.target.value })} placeholder="ค้นหา เลขที่ ชื่อ รายการ รหัส" aria-label="ค้นหารายการ" />
            {(lf.div || lf.cat || lf.nocode || lf.q) && <button type="button" className="row-action" onClick={() => setLf({ ...lf, div: "", cat: "", nocode: false, q: "" })}>ล้างตัวกรอง</button>}
            <button type="button" className="btn-soft ml-auto" disabled={!lfShown.length} onClick={exportAll}><CsvIcon /> CSV</button>
          </div>
          <p className="mb-2 text-sm text-gold-700">{lfShown.length} บรรทัด · รวม <b>{money(lfShown.reduce((n, x) => n + x.amount, 0))}</b> บาท{lfShown.length > LF_MAX ? ` · แสดง ${LF_MAX} บรรทัดแรก ใช้ตัวกรองหรือส่งออก CSV เพื่อดูทั้งหมด` : ""}</p>
          {!lfShown.length ? <p className="st-empty">ไม่มีรายการตามตัวกรองใน{label}</p> : (
            <div className="overflow-x-auto"><table className="rv-lines">
              <thead><tr><th>วันที่</th><th>เลขที่</th><th>ผู้รับบริการ · สาขา</th><th>รายการในใบ</th><th>รหัส · หมวด</th><th>ฝ่าย · บริษัท</th><th className="num">{lf.kind === "recv" ? "รับเงิน" : "ยอดออกใบ"}</th><th className="num">{lf.kind === "recv" ? "VAT" : "ค้างรับ"}</th></tr></thead>
              <tbody>{lfShown.slice(0, LF_MAX).map((x, k) => (
                <tr key={k} className={!x.code && x.cat !== "CN" ? "is-nocode" : ""}>
                  <td className="whitespace-nowrap">{dTh(x.date)}</td>
                  <td className="whitespace-nowrap">{x.rcpt ? <>{x.rcpt}<small>{x.no}</small></> : x.no}</td>
                  <td>{x.who || "-"}<small>{x.branch}</small></td>
                  <td>{x.desc}</td>
                  <td className="whitespace-nowrap">{x.code || (x.cat === "CN" ? "-" : "ไม่มีรหัส")}<small>{x.cat === "CN" ? "ใบลดหนี้" : BU_CAT_TH[x.cat] ?? x.cat}</small></td>
                  <td>{x.div}<small>{x.co}</small></td>
                  <td className="num">{money(x.amount)}</td>
                  <td className="num">{money(lf.kind === "recv" ? x.vat : x.owe)}</td>
                </tr>))}</tbody>
            </table></div>)}
          <p className="field-hint mt-2">หมวดมาจากรหัสสินค้า 2 ตัวแรก (ราคาสินค้าและบริการ) · ไม่มีรหัส = ยา เวชภัณฑ์ หรือรายการที่พิมพ์เอง จะเข้าหมวดอื่น ๆ · ฝ่ายของแต่ละหมวดตั้งได้ที่ ตั้งค่า › ฝ่ายและบริษัท</p>
        </>}
      </section>}

      {tab === "sum" && <section className="card st-paper rv-card">
        {!data && !err ? <p className="st-empty">กำลังโหลด…</p> : !view.length ? <p className="st-empty">ไม่มีรายได้ใน{label}{company ? ` ของ${company}` : ""}</p> : <>
          <div className="rv-bar" role="img" aria-label={view.map((c) => `${c.name} ${share(c)}%`).join(" · ")}>
            {view.map((c) => <i key={c.name} style={{ width: `${Math.max(0, share(c))}%`, background: CO_COLORS[cos.indexOf(c) % CO_COLORS.length] }} />)}
          </div>
          <p className="rv-legend">{view.map((c) => <span key={c.name}><i style={{ background: CO_COLORS[cos.indexOf(c) % CO_COLORS.length] }} />{c.name} <b>{share(c)}%</b></span>)}</p>
          <p className="rv-swipe" hidden={!more} aria-hidden="true">เลื่อนดูคอลัมน์อื่น →</p>
          <div className={`rv-scroll-wrap ${more ? "has-more" : ""}`}><div className="st-scroll" ref={scrollRef} onScroll={checkMore} tabIndex={0} aria-label="ตารางรายได้ตามฝ่าย เลื่อนซ้ายขวาได้">
            <table className="rv-table">
              <thead><tr><th>บริษัท / ฝ่าย</th><th>ยอดออกใบ</th><th>รับเงินจริง</th><th>ก่อน VAT</th><th>VAT</th><th>ค้างรับ</th><th>สัดส่วน</th></tr></thead>
              <tbody>
                {view.map((co) => (
                  <Fragment key={co.name}>
                    <tr className="is-co"><td>{co.name}</td><td>{money(co.billed)}</td><td>{money(co.recv)}</td><td>{money(co.base)}</td><td>{money(co.vat)}</td><td>{money(co.owe)}</td><td>{share(co)}%</td></tr>
                    {[...co.divs.values()].sort((a, b) => b[basis] - a[basis]).map((d) => {
                      const k = `${co.name}|${d.name}`, isOpen = open === k;
                      return (
                        <Fragment key={k}>
                          <tr className={`is-div ${isOpen ? "is-open" : ""}`} onClick={() => setOpen(isOpen ? null : k)} tabIndex={0} aria-expanded={isOpen}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(isOpen ? null : k); } }}>
                            <td><span className="rv-caret" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>{d.name}{d.name === NO_DIV && <small> · ตั้งได้ที่ ตั้งค่า › ฝ่ายและบริษัท</small>}
                              <button type="button" className="rv-lines-btn" onClick={(e) => { e.stopPropagation(); setLinesOf({ co: co.name, div: d.name }); setLinesTab(basis); }}>ดูรายการ</button></td>
                            <td>{money(d.billed)}</td><td>{money(d.recv)}</td><td>{money(d.base)}</td><td>{money(d.vat)}</td><td>{money(d.owe)}</td><td className="rv-pct">{share(d)}%</td>
                          </tr>
                          {isOpen && [...d.byBranch.entries()].sort((a, b) => b[1][basis] - a[1][basis]).map(([b, x]) => (
                            <tr key={`${k}|${b}`} className="is-br"><td>สาขา {b}</td><td>{money(x.billed)}</td><td>{money(x.recv)}</td><td>{money(x.base)}</td><td>{money(x.vat)}</td><td>{money(x.owe)}</td><td className="rv-pct">{share(x)}%</td></tr>
                          ))}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                ))}
                <tr className="is-tot"><td>{company ? `รวม ${company}` : "รวมทุกบริษัท"}</td><td>{money(vt.billed)}</td><td>{money(vt.recv)}</td><td>{money(vt.base)}</td><td>{money(vt.vat)}</td><td>{money(vt.owe)}</td><td>100%</td></tr>
              </tbody>
            </table>
          </div></div>
          <p className="field-hint">กดแถวฝ่ายเพื่อดูแยกตามสาขา · กด “ดูรายการ” เพื่อดูว่าบรรทัดไหนจากใบไหนถูกนับเข้าฝ่ายนั้น{dep ? ` · เงินประกัน/มัดจำที่รับในเดือนนี้ ${money(dep)} บาท ไม่นับเป็นรายได้` : ""} · ฝ่ายและบริษัทของแต่ละหมวด ตั้งได้ที่ ตั้งค่า › ฝ่ายและบริษัท (ผู้บริหาร)</p>
        </>}
      </section>}

      {/* ดูรายการของฝ่าย: บรรทัดไหนจากใบไหนถูกนับเข้าฝ่ายนี้ · แยกแท็บ รับเงินจริง / ยอดออกใบ · สรุปตามหมวด · บรรทัดที่ไม่มีรหัสขึ้นสีส้ม */}
      <Modal open={!!linesOf} wide title={linesOf ? `${linesOf.div} · ${linesOf.co}` : ""} onClose={() => setLinesOf(null)}
        footer={<><span className="mr-auto text-xs text-gold-500">{label}{branch ? ` · สาขา${branch}` : ""} · หมวดมาจากรหัสสินค้า (2 ตัวแรก) · ไม่มีรหัส = อื่น ๆ</span>
          <button type="button" className="btn-soft" onClick={() => { if (!linesOf) return; setLf({ kind: linesTab, div: linesOf.div, cat: "", nocode: false, q: "" }); setTab("lines"); setLinesOf(null); }}>เปิดในรายการทั้งหมด ›</button>
          <button type="button" className="btn-soft" disabled={!lnShown.length} onClick={exportLines}><CsvIcon /> CSV</button><button type="button" className="btn-primary" onClick={() => setLinesOf(null)}>ปิด</button></>}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="seg" role="tablist" aria-label="ชนิดยอด">
            <button type="button" role="tab" aria-pressed={linesTab === "recv"} onClick={() => setLinesTab("recv")}>รับเงินจริง {lnAll.filter((x) => x.kind === "recv").length}</button>
            <button type="button" role="tab" aria-pressed={linesTab === "billed"} onClick={() => setLinesTab("billed")}>ยอดออกใบ {lnAll.filter((x) => x.kind === "bill").length}</button>
          </div>
          <span className="text-sm text-gold-700">รวม <b>{money(lnShown.reduce((n, x) => n + x.amount, 0))}</b> บาท</span>
        </div>
        {lnCats.length > 0 && <p className="mb-3 flex flex-wrap gap-1.5 text-xs">{lnCats.map(([c, n, sum]) => <span key={c} className="rounded-full bg-cream-100 px-2.5 py-0.5 text-gold-800">{c === "CN" ? "ใบลดหนี้" : `${c} · ${BU_CAT_TH[c] ?? c}`} · {n} บรรทัด · <b>{money(sum)}</b></span>)}</p>}
        {!lnShown.length ? <p className="rounded-xl bg-cream-50 px-4 py-8 text-center text-sm text-gold-500">ไม่มีรายการ{linesTab === "recv" ? "รับเงิน" : "ออกใบ"}ของฝ่ายนี้ใน{label}</p> : (
          <div className="overflow-x-auto"><table className="rv-lines">
            <thead><tr><th>วันที่</th><th>เลขที่</th><th>ผู้รับบริการ · สาขา</th><th>รายการในใบ</th><th>รหัส · หมวด</th><th className="num">{linesTab === "recv" ? "รับเงิน" : "ยอดออกใบ"}</th><th className="num">{linesTab === "recv" ? "VAT" : "ค้างรับ"}</th></tr></thead>
            <tbody>{lnShown.map((x, k) => (
              <tr key={k} className={!x.code && x.cat !== "CN" ? "is-nocode" : ""}>
                <td className="whitespace-nowrap">{dTh(x.date)}</td>
                <td className="whitespace-nowrap">{x.rcpt ? <>{x.rcpt}<small>{x.no}</small></> : x.no}</td>
                <td>{x.who || "-"}<small>{x.branch}</small></td>
                <td>{x.desc}</td>
                <td className="whitespace-nowrap">{x.code || (x.cat === "CN" ? "-" : "ไม่มีรหัส")}<small>{x.cat === "CN" ? "ใบลดหนี้" : BU_CAT_TH[x.cat] ?? x.cat}</small></td>
                <td className="num">{money(x.amount)}</td>
                <td className="num">{money(linesTab === "recv" ? x.vat : x.owe)}</td>
              </tr>))}</tbody>
          </table></div>)}
      </Modal>
    </>
  );
}
