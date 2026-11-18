"use client";
/**
 * รายได้ตาม BU (รายงานภายใน) · ตอบว่าเงินแต่ละส่วนเป็นรายได้ของบริษัทไหน มาจากฝ่ายไหน
 *  ยอดออกใบ = ใบที่ออกในเดือน (ใบลดหนี้เป็นยอดลบ) · รับเงินจริง = งวดรับเงินในเดือน ตัดลงรายการตามลำดับตัดชำระ (lib/billing payTake)
 *  ค้างรับ = ยอดที่ยังไม่ได้รับของใบที่ออกในเดือน · ไม่นับเงินประกัน/มัดจำ · รายการ → ฝ่าย → บริษัท ตั้งค่าได้ที่ ตั้งค่า › BU (ฝ่ายและบริษัท)
 */
import { Fragment, useEffect, useMemo, useState } from "react";
import CsvIcon from "../CsvIcon";
import { COMPANY, PageHeader } from "../ui";
import { useBranchInfo } from "./Billing";
import { creditOf, money, parseItems, payOrder, payTake } from "@/lib/billing";
import { buCatOf, DEFAULT_DIVISIONS, Division, divisionOf, NO_DIV } from "@/lib/bu";
import { downloadCsv, useRecords } from "@/lib/store";
import { useBranchNames } from "@/lib/branches";
import { usePriceList } from "@/lib/usePrices";
import { useSession } from "@/lib/session";
import { seesAllBranches } from "@/lib/roles";
import { useApp } from "@/lib/app";

type Inv = { id: string; no: string; date: string; items: string; net: number; paid: number; branch: string; status: string; cn: boolean };
type Pay = { id: string; date: string; amount: number; items: string; branch: string; paidBefore: number };
type Cell = { billed: number; recv: number; base: number; vat: number; owe: number };
type Div = Cell & { name: string; byBranch: Map<string, Cell> };
type Co = Cell & { name: string; divs: Map<string, Div> };

const r2 = (n: number) => Math.round(n * 100) / 100;
const TH_MON = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const monthTh = (m: string) => `${TH_MON[Number(m.slice(5, 7)) - 1]} ${Number(m.slice(0, 4)) + 543}`;
const thisMonth = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7);
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
  const [branch, setBranch] = useState("");
  const [basis, setBasis] = useState<"recv" | "billed">("recv");
  const [open, setOpen] = useState<string | null>(null);
  const [data, setData] = useState<{ invs: Inv[]; pays: Pay[] } | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    setData(null); setErr("");
    let live = true;
    fetch(`/api/billing?op=revenue&month=${month}${all && branch ? `&branch=${encodeURIComponent(branch)}` : ""}`, { cache: "no-store" })
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "โหลดรายงานไม่สำเร็จ"); return d; })
      .then((d) => { if (live) setData({ invs: d.invs ?? [], pays: d.pays ?? [] }); })
      .catch((e) => { if (live) setErr((e as Error).message); });
    return () => { live = false; };
  }, [month, branch, all]);

  const legalOf = (b: string) => branchInfo(b).legal || COMPANY.th;
  const { cos, total, dep } = useMemo(() => {
    const cos = new Map<string, Co>(), total = zero();
    let dep = 0;
    const slot = (coName: string, divName: string, b: string) => {
      if (!cos.has(coName)) cos.set(coName, { name: coName, divs: new Map(), ...zero() });
      const co = cos.get(coName)!;
      if (!co.divs.has(divName)) co.divs.set(divName, { name: divName, byBranch: new Map(), ...zero() });
      const dv = co.divs.get(divName)!;
      if (!dv.byBranch.has(b)) dv.byBranch.set(b, zero());
      return [co, dv, dv.byBranch.get(b)!] as const;
    };
    const put = (b: string, cat: string, d: Partial<Cell>) => {
      const dv = divisionOf(divs, cat);
      const [co, div, br] = slot(dv?.company || legalOf(b), dv?.name ?? NO_DIV, b);
      [co, div, br, total].forEach((c) => add(c, d));
    };
    if (!data) return { cos: [] as Co[], total, dep };
    for (const x of data.invs) {
      const its = parseItems(x.items);
      if (x.cn) { // ใบลดหนี้: ลดยอดออกใบของบริษัทสาขา
        const sum = payOrder(its).reduce((n, l) => n + l.incl, 0);
        const [co, div, br] = slot(legalOf(x.branch), CN_DIV, x.branch);
        [co, div, br, total].forEach((c) => add(c, { billed: -sum }));
        continue;
      }
      const paidK = new Map(payTake(its, 0, creditOf(its) + x.paid).lines.map((l) => [l.k, l.take]));
      for (const l of payOrder(its)) {
        const cat = buCatOf(l.item);
        if (cat === "dep") continue;
        put(x.branch, cat, { billed: l.incl, owe: Math.max(0, r2(l.incl - (paidK.get(l.k) ?? 0))) });
      }
    }
    for (const p of data.pays) {
      const its = parseItems(p.items);
      for (const l of payTake(its, creditOf(its) + p.paidBefore, p.amount).lines) {
        const cat = buCatOf(l.item);
        if (cat === "dep") { dep = r2(dep + l.take); continue; }
        put(p.branch, cat, { recv: l.take, vat: l.takeVat, base: r2(l.take - l.takeVat) });
      }
    }
    const sorted = [...cos.values()].sort((a, b) => b[basis] - a[basis]);
    return { cos: sorted, total, dep };
  }, [data, divs, basis]); // eslint-disable-line react-hooks/exhaustive-deps

  const share = (c: Cell) => (total[basis] ? Math.round((c[basis] / total[basis]) * 100) : 0);
  const exportCsv = () => {
    if (!cos.length) return toast("ไม่มีข้อมูลในเดือนนี้");
    const row = (a: string, b: string, c: string, x: Cell) => [a, b, c, money(x.billed), money(x.recv), money(x.base), money(x.vat), money(x.owe), `${share(x)}%`];
    downloadCsv(`รายได้ตาม BU-${month}${branch ? `-${branch}` : ""}`, ["บริษัท", "ฝ่าย", "สาขา", "ยอดออกใบ", "รับเงินจริง", "ก่อน VAT (เงินที่รับ)", "VAT (เงินที่รับ)", "ค้างรับ", `สัดส่วน (${basis === "recv" ? "เงินที่รับ" : "ยอดออกใบ"})`],
      [...cos.flatMap((co) => [row(co.name, "รวมบริษัท", "", co), ...[...co.divs.values()].flatMap((d) => [row(co.name, d.name, "ทุกสาขา", d), ...[...d.byBranch.entries()].map(([b, x]) => row(co.name, d.name, b, x))])]), row("รวมทุกบริษัท", "", "", total)]);
    toast(`ส่งออกรายได้ตาม BU ${monthTh(month)} แล้ว`);
  };

  return (
    <>
      <PageHeader title="รายได้ตาม BU" sub="เงินแต่ละส่วนเป็นรายได้ของบริษัทไหน มาจากฝ่ายไหน · รายงานภายใน (ใบเสร็จของลูกค้ายังออกในนามบริษัทของสาขา) · ไม่นับเงินประกัน/มัดจำ"
        actions={<button className="btn-soft" disabled={!cos.length} onClick={exportCsv}><CsvIcon /> ส่งออก Excel / CSV</button>} />
      <div className="st-bar">
        <label><span className="label">เดือน</span><input type="month" value={month} max={thisMonth()} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="เดือน" /></label>
        {all && <label><span className="label">สาขา</span><select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="สาขา"><option value="">ทุกสาขา</option>{branchNames.map((b) => <option key={b} value={b}>{b}</option>)}</select></label>}
        <label><span className="label">คิดสัดส่วนจาก</span><select value={basis} onChange={(e) => setBasis(e.target.value as "recv" | "billed")} aria-label="คิดสัดส่วนจาก"><option value="recv">เงินที่รับจริง</option><option value="billed">ยอดออกใบ</option></select></label>
      </div>
      {err && <p role="alert" className="form-error">{err}</p>}
      <div className="st-tiles">
        <div><small>ยอดออกใบ</small><b>{data ? money(total.billed) : "…"}</b></div>
        <div><small>รับเงินจริง</small><b>{data ? money(total.recv) : "…"}</b></div>
        <div><small>VAT ของเงินที่รับ</small><b>{data ? money(total.vat) : "…"}</b></div>
        <div><small>ค้างรับ (ใบของเดือนนี้)</small><b>{data ? money(total.owe) : "…"}</b></div>
      </div>
      <section className="card st-paper rv-card">
        {!data && !err ? <p className="st-empty">กำลังโหลด…</p> : !cos.length ? <p className="st-empty">ไม่มีรายได้ใน{monthTh(month)}</p> : <>
          <div className="rv-bar" role="img" aria-label={cos.map((c) => `${c.name} ${share(c)}%`).join(" · ")}>
            {cos.map((c, i) => <i key={c.name} style={{ width: `${Math.max(0, share(c))}%`, background: CO_COLORS[i % CO_COLORS.length] }} />)}
          </div>
          <p className="rv-legend">{cos.map((c, i) => <span key={c.name}><i style={{ background: CO_COLORS[i % CO_COLORS.length] }} />{c.name} <b>{share(c)}%</b></span>)}</p>
          <div className="st-scroll">
            <table className="rv-table">
              <thead><tr><th>บริษัท / ฝ่าย</th><th>ยอดออกใบ</th><th>รับเงินจริง</th><th>ก่อน VAT</th><th>VAT</th><th>ค้างรับ</th><th>สัดส่วน</th></tr></thead>
              <tbody>
                {cos.map((co) => (
                  <Fragment key={co.name}>
                    <tr className="is-co"><td>{co.name}</td><td>{money(co.billed)}</td><td>{money(co.recv)}</td><td>{money(co.base)}</td><td>{money(co.vat)}</td><td>{money(co.owe)}</td><td>{share(co)}%</td></tr>
                    {[...co.divs.values()].sort((a, b) => b[basis] - a[basis]).map((d) => {
                      const k = `${co.name}|${d.name}`, isOpen = open === k;
                      return (
                        <Fragment key={k}>
                          <tr className={`is-div ${isOpen ? "is-open" : ""}`} onClick={() => setOpen(isOpen ? null : k)} tabIndex={0} aria-expanded={isOpen}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(isOpen ? null : k); } }}>
                            <td><span className="rv-caret" aria-hidden="true">{isOpen ? "▾" : "▸"}</span>{d.name}{d.name === NO_DIV && <small> · ตั้งได้ที่ ตั้งค่า › BU (ฝ่ายและบริษัท)</small>}</td>
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
                <tr className="is-tot"><td>รวมทุกบริษัท</td><td>{money(total.billed)}</td><td>{money(total.recv)}</td><td>{money(total.base)}</td><td>{money(total.vat)}</td><td>{money(total.owe)}</td><td>100%</td></tr>
              </tbody>
            </table>
          </div>
          <p className="field-hint">กดแถวฝ่ายเพื่อดูแยกตามสาขา{dep ? ` · เงินประกัน/มัดจำที่รับในเดือนนี้ ${money(dep)} บาท ไม่นับเป็นรายได้` : ""} · ฝ่ายและบริษัทของแต่ละหมวด ตั้งได้ที่ ตั้งค่า › BU (ฝ่ายและบริษัท) (ผู้บริหาร)</p>
        </>}
      </section>
    </>
  );
}
