"use client";
/**
 * รับเงินแยกตามบัญชี (ขายและการเงิน) · เงินที่รับในช่วงวันที่ เข้าช่องทางไหน บัญชีไหน เท่าไร และเป็นค่าอะไร
 *  ใช้กระทบยอดกับ statement ธนาคาร / เครื่อง EDC และลงบัญชี · เป็นรายงานดูยอด ไม่ใช่การปิดยอดรายวัน
 *  ช่องทาง: เงินสด · โอน (แยกทีละบัญชีที่รับ) · EDC (แยกทีละเครื่อง) · บัตรช่องทางอื่น · ภาษีหัก ณ ที่จ่าย (ไม่ใช่เงินเข้าบัญชี แสดงแยก)
 *  "เป็นค่าอะไร" ตัดตามลำดับชำระ (รายการที่มี VAT ก่อน · lib/billing payTake) · งวดที่จ่ายหลายช่องทาง แบ่งตามสัดส่วนยอดของช่องทาง
 *  ข้อมูลจาก GET /api/billing?op=deposits · เห็นเฉพาะผู้บริหาร ผู้จัดการสาขา (สาขาตัวเอง) และการเงิน
 */
import { useEffect, useMemo, useState } from "react";
import CsvIcon from "../CsvIcon";
import { COMPANY, PageHeader } from "../ui";
import { RangePicker, quickRanges } from "../PeriodPicker";
import { useBranchInfo } from "./Billing";
import { bankOf } from "../billing/PayAccounts";
import { creditOf, money, parseItems, payTake } from "@/lib/billing";
import { BU_CAT_TH, buCatOf } from "@/lib/bu";
import { downloadCsv } from "@/lib/store";
import { useBranchNames } from "@/lib/branches";
import { useSession } from "@/lib/session";
import { seesAllBranches } from "@/lib/roles";
import { useApp } from "@/lib/app";

type Row = {
  id: string; date: string; time: string; receiptNo: string; no: string; n: number; paidBefore: number; items: string; branch: string; legal: string; who: string;
  cash: number; transfer: number; credit: number; edc: number; wht: number; amount: number; transferRef: string; transferAccount: string; cardAccount: string; edcAccount: string; cashier: string;
};
type Kind = "cash" | "transfer" | "edc" | "card" | "wht";
/** group = ประเภทช่องทาง (หัวการ์ด) · name = บัญชี / เครื่อง (บรรทัดรอง) · warn = ไม่รู้ว่าเข้าบัญชีไหน (รับก่อนมีการเลือกบัญชี) */
type Part = { key: string; kind: Kind; group: string; name: string; label: string; amt: number; logo: string | null; warn?: boolean };
type Bucket = Omit<Part, "amt"> & { sum: number; n: number };
const GROUP: Record<Kind, string> = { cash: "เงินสด", transfer: "โอนเข้าบัญชี", edc: "รูดบัตร EDC", card: "บัตรช่องทางอื่น", wht: "ภาษีหัก ณ ที่จ่าย" };

/** ไอคอนช่องทางที่ไม่มีโลโก้ธนาคาร (เส้น ใช้สีตัวอักษร) */
function KindIcon({ kind }: { kind: Kind }) {
  const p = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (kind === "cash") return <svg {...p}><rect x="2.5" y="6" width="19" height="12" rx="2" /><circle cx="12" cy="12" r="2.6" /><path d="M6 9.5v.01M18 14.5v.01" /></svg>;
  if (kind === "card" || kind === "edc") return <svg {...p}><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 9.5h19M6.5 15h4" /></svg>;
  if (kind === "wht") return <svg {...p}><path d="M7 3h7l4 4v14H7z" /><path d="M14 3v4h4M9.5 12h6M9.5 16h4" /></svg>;
  return <svg {...p}><path d="M3 9.5 12 4l9 5.5M4.5 10v8M9 10v8M15 10v8M19.5 10v8M3 20h18" /></svg>;
}
/** โลโก้ธนาคาร หรือไอคอนช่องทาง */
const ChanMark = ({ logo, kind, size = 30 }: { logo: string | null; kind: Kind; size?: number }) =>
  logo ? <img src={logo} alt="" width={size} height={size} className="dp-logo" style={{ width: size, height: size }} />
    : <span className={`dp-ico is-${kind}`} style={{ width: size, height: size }}><KindIcon kind={kind} /></span>;

const r2 = (n: number) => Math.round(n * 100) / 100;
const SH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const dTh = (s: string) => `${Number(s.slice(8, 10))} ${SH[Number(s.slice(5, 7)) - 1]} ${String(Number(s.slice(0, 4)) + 543).slice(2)}`;
const spanTh = (a: string, b: string) => (a === b ? dTh(a) : a.slice(0, 7) === b.slice(0, 7) ? `${Number(a.slice(8, 10))}–${dTh(b)}` : `${dTh(a)} – ${dTh(b)}`);
/** วันที่แบบสั้นในแถวมือถือ "3 พ.ย." (ไม่มีปี) */
const dShort = (s: string) => `${Number(s.slice(8, 10))} ${SH[Number(s.slice(5, 7)) - 1]}`;
/** ชื่อสั้นในแถวมือถือ: ธนาคาร (ไม่มีเลขบัญชี) */
const bankShort = (p: Part) => { const b = bankOf(p.name); return b ? `${p.kind === "edc" ? "EDC " : ""}${b.name}` : p.name; };
const KIND_ORDER: Kind[] = ["cash", "transfer", "edc", "card", "wht"];
/** สีประเภทรายได้ (ลำดับคงที่) */
const CAT_COLOR: Record<string, string> = { RM: "#8A5A1A", MD: "#2B6B7A", NS: "#4A7A8A", CR: "#7A2B5A", EQ: "#4A4A8A", PT: "#6B7A2B", OT: "#8A7A5A", dep: "#B9AC95" };
const catName = (c: string) => (c === "dep" ? "มัดจำ / ประกัน" : c === "MD" ? "ค่าบริการทางการแพทย์" : BU_CAT_TH[c] ?? c);

/** แต่ละงวดเข้าช่องทางไหนเท่าไร (งวดเดียวจ่ายได้หลายช่องทาง) · credit ในฐานข้อมูล = EDC + บัตรช่องทางอื่น */
function partsOf(r: Row): Part[] {
  const out: Part[] = [];
  const logo = (t: string) => { const b = bankOf(t); return b ? `/banks/${b.file}.png` : null; };
  const add = (key: string, kind: Kind, name: string, amt: number, lg: string | null, warn = false) => out.push({ key, kind, group: GROUP[kind], name, label: `${GROUP[kind]} · ${name}`, amt, logo: lg, warn });
  if (r.cash > 0) add("cash", "cash", "รับที่เคาน์เตอร์สาขา", r.cash, null);
  if (r.transfer > 0) add(`t:${r.transferAccount}`, "transfer", r.transferAccount || "ไม่ระบุบัญชี (รับก่อนมีการเลือกบัญชี)", r.transfer, logo(r.transferAccount), !r.transferAccount);
  if (r.edc > 0) add(`e:${r.edcAccount}`, "edc", r.edcAccount || "ไม่ระบุเครื่อง", r.edc, logo(r.edcAccount), !r.edcAccount);
  const other = r2(r.credit - r.edc);
  if (other > 0) add(`c:${r.cardAccount}`, "card", r.cardAccount || "ไม่ระบุช่องทาง (รับก่อนแยกเครื่อง EDC)", other, logo(r.cardAccount), !r.cardAccount);
  if (r.wht > 0) add("wht", "wht", "ไม่ใช่เงินเข้าบัญชี · ขอ 50 ทวิ", r.wht, null);
  return out;
}
/** งวดนี้ชำระค่าอะไรเท่าไร (ตามหมวดรายการ) */
function catsOf(r: Row): Map<string, number> {
  const its = parseItems(r.items), m = new Map<string, number>();
  for (const l of payTake(its, creditOf(its) + r.paidBefore, r.amount).lines) {
    if (!l.take) continue;
    const c = buCatOf(l.item);
    m.set(c, r2((m.get(c) ?? 0) + l.take));
  }
  return m;
}

export function Deposits() {
  const { toast } = useApp();
  const { user } = useSession();
  const all = seesAllBranches(user?.role);
  const branchNames = useBranchNames();
  const branchInfo = useBranchInfo();
  const legalOf = (b: string) => branchInfo(b).legal || COMPANY.th;
  // ช่วงวันที่ (ค่าเริ่มต้น = เดือนนี้) · ปุ่มปฏิทินแบบเดียวกับทุกหน้า (components/PeriodPicker)
  const [[from, to], setRng] = useState<[string, string]>(() => { const m = quickRanges().find((x) => x.k === "month")!; return [m.from, m.to]; });
  const [company, setCompany] = useState("");
  const [branch, setBranch] = useState("");
  const [pick, setPick] = useState<string | null>(null);
  /** ค้นในรายการ: ชื่อ เลขใบเสร็จ เลขใบแจ้งหนี้ เลขอ้างอิง สาขา ผู้รับเงิน */
  const [q, setQ] = useState("");
  /** มือถือ: แถวที่กดเปิดดูรายละเอียด */
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [data, setData] = useState<Row[] | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let live = true;
    setData(null); setErr(""); setPick(null);
    fetch(`/api/billing?op=deposits&from=${from}&to=${to}${all && branch ? `&branch=${encodeURIComponent(branch)}` : ""}`, { cache: "no-store" })
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "โหลดข้อมูลไม่สำเร็จ"); return d; })
      .then((d) => { if (live) setData(d.rows ?? []); })
      .catch((e) => { if (live) setErr((e as Error).message); });
    return () => { live = false; };
  }, [from, to, branch, all]);

  const coNames = [...new Set(branchNames.map((b) => legalOf(b)))];
  const branchOpts = branchNames.filter((b) => !company || legalOf(b) === company);
  const rows = useMemo(() => (data ?? []).filter((r) => !company || (r.legal || legalOf(r.branch)) === company), [data, company]); // eslint-disable-line react-hooks/exhaustive-deps

  const buckets = useMemo(() => {
    const m = new Map<string, Bucket>();
    for (const r of rows) for (const p of partsOf(r)) {
      const { amt: _amt, ...rest } = p; void _amt;
      const b = m.get(p.key) ?? { ...rest, sum: 0, n: 0 };
      b.sum = r2(b.sum + p.amt); b.n += 1; m.set(p.key, b);
    }
    return [...m.values()].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.sum - a.sum);
  }, [rows]);
  const cashIn = r2(rows.reduce((n, r) => n + r.cash + r.credit + r.transfer, 0));
  const whtSum = r2(rows.reduce((n, r) => n + r.wht, 0));
  const sel = buckets.find((b) => b.key === pick) ?? null;

  // รายการที่แสดง + ยอดของช่องทางที่เลือก
  const shown = rows.map((r) => {
    const parts = partsOf(r), own = sel ? parts.find((p) => p.key === sel.key) : null;
    return { r, parts, amt: sel ? own?.amt ?? 0 : r2(r.cash + r.credit + r.transfer) };
  }).filter((x) => x.amt > 0);
  const qq = q.trim().toLowerCase();
  const listed = qq ? shown.filter(({ r }) => [r.who, r.receiptNo, r.no, r.transferRef, r.branch, r.cashier].some((v) => (v || "").toLowerCase().includes(qq))) : shown;
  // เป็นค่าอะไร (แบ่งตามสัดส่วนของช่องทางที่เลือก · ภาษีหัก ณ ที่จ่ายไม่แยกค่า)
  const mix = new Map<string, number>();
  if (!sel || sel.kind !== "wht") for (const x of shown) {
    const share = x.r.amount ? (sel ? x.amt : x.r.amount) / x.r.amount : 0;
    for (const [c, v] of catsOf(x.r)) mix.set(c, r2((mix.get(c) ?? 0) + v * share));
  }
  const mixRows = [...mix.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const mixTotal = mixRows.reduce((n, [, v]) => n + v, 0);
  const scope = `${spanTh(from, to)}${company ? ` · ${company}` : ""}${branch ? ` · สาขา${branch}` : !all && user?.branch ? ` · สาขา${user.branch}` : ""}`;

  const exportCsv = () => {
    if (!shown.length) return toast("ไม่มีรายการในช่วงนี้");
    downloadCsv(`รับเงินแยกตามบัญชี-${from}-ถึง-${to}${branch ? `-${branch}` : ""}${sel ? `-${sel.label}` : ""}`,
      ["วันที่รับเงิน", "เวลา", "เลขที่ใบเสร็จ", "เลขที่ใบแจ้งหนี้", "ผู้รับบริการ", "สาขา", "บริษัท", "เงินสด", "โอน", "บัญชีรับโอน", "เลขอ้างอิงการโอน", "รูดบัตร EDC", "เครื่อง EDC", "บัตรช่องทางอื่น", "ช่องทางบัตร", "ภาษีหัก ณ ที่จ่าย", "รวมเงินเข้า", "ชำระค่าอะไร", "ผู้รับเงิน"],
      shown.map(({ r }) => [r.date, r.time, r.receiptNo || r.no, r.no, r.who, r.branch, r.legal || legalOf(r.branch), money(r.cash), money(r.transfer), r.transferAccount, r.transferRef, money(r.edc), r.edcAccount, money(r2(r.credit - r.edc)), r.cardAccount, money(r.wht),
        money(r2(r.cash + r.credit + r.transfer)), [...catsOf(r)].map(([c, v]) => `${catName(c)} ${money(v)}`).join(" · "), r.cashier]));
    toast(`ส่งออกรับเงินแยกตามบัญชี ${shown.length} รายการแล้ว`);
  };

  return (
    <>
      <PageHeader title="รับเงินแยกตามบัญชี" sub="เงินที่รับในช่วงนี้เข้าช่องทางไหน บัญชีไหน เท่าไร และเป็นค่าอะไร · ใช้กระทบยอดกับ statement ธนาคารและลงบัญชี · กดการ์ดช่องทางเพื่อดูรายการ"
        actions={<button className="btn-soft" disabled={!shown.length} onClick={exportCsv}><CsvIcon /> ส่งออก Excel / CSV</button>} />
      <div className="st-bar is-grid dp-bar">
        <div className="pp-field dp-when"><span className="label">ช่วงเวลา</span><RangePicker from={from} to={to} onChange={(f, t) => setRng([f, t])} /></div>
        {all && coNames.length > 1 && <label><span className="label">บริษัท</span><select value={company} onChange={(e) => { setCompany(e.target.value); setBranch(""); }} aria-label="บริษัท"><option value="">ทุกบริษัท</option>{coNames.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>}
        {all && <label><span className="label">สาขา</span><select value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="สาขา"><option value="">ทุกสาขา</option>{branchOpts.map((b) => <option key={b} value={b}>{b}</option>)}</select></label>}
      </div>
      {!all && <p className="field-hint">แสดงเฉพาะสาขาของคุณ ({user?.branch || "-"}) · ดูทุกสาขาได้เฉพาะผู้บริหารและการเงิน</p>}
      {err && <p role="alert" className="form-error">{err}</p>}

      <div className="dp-total" aria-live="polite">
        <span>เงินเข้าทั้งหมด</span>
        <b>{data ? `${money(cashIn)} บาท` : "…"}</b>
        <small>{data ? `${rows.length} รายการ · ${scope}${whtSum ? ` · ภาษีหัก ณ ที่จ่ายอีก ${money(whtSum)} บาท` : ""}` : "กำลังโหลด…"}</small>
      </div>

      {data && !rows.length ? <p className="st-empty card dp-empty">ไม่มีการรับเงินใน{scope}</p> : <>
        <h3 className="dp-h">แยกตามช่องทางและบัญชี</h3>
        <div className="dp-chans">
          {buckets.map((b) => {
            const pct = b.kind === "wht" || !cashIn ? null : Math.round((b.sum / cashIn) * 100);
            return (
              <button key={b.key} type="button" className={`dp-chan is-${b.kind} ${b.warn ? "is-warn" : ""}`} aria-pressed={pick === b.key} onClick={() => setPick(pick === b.key ? null : b.key)}
                aria-label={`${b.label} ${money(b.sum)} บาท ${b.n} รายการ${pct !== null ? ` ${pct}% ของเงินเข้า` : ""}${pick === b.key ? " กำลังเลือก กดอีกครั้งเพื่อดูทุกช่องทาง" : " กดเพื่อดูเฉพาะช่องทางนี้"}`}>
                <span className="dp-chan-h"><ChanMark logo={b.logo} kind={b.kind} /><span><b>{b.group}</b><small>{b.name}</small></span></span>
                <span className="v">{money(b.sum)} <small>บาท</small>{pct !== null && <em className="dp-pct">{pct}%</em>}</span>
                {pct !== null && <span className="dp-share" aria-hidden="true"><i style={{ width: `${Math.max(2, pct)}%` }} /></span>}
                <span className="n">{b.n} รายการ{pct !== null && <> · {pct}%<span className="dp-long"> ของเงินเข้า</span></>}{b.warn ? " · ตรวจกับ statement" : ""}</span>
              </button>
            );
          })}
        </div>
        {sel && <p className="dp-picked">กำลังดู: <b>{sel.label}</b> <button type="button" onClick={() => setPick(null)}>ดูทุกช่องทาง ✕</button></p>}

        <section className="card dp-card" aria-labelledby="dp-mix-h">
          <h3 id="dp-mix-h">เป็นค่าอะไรบ้าง</h3>
          {sel?.kind === "wht" ? <p className="field-hint">ภาษีหัก ณ ที่จ่ายเป็นส่วนที่ลูกค้าหักไว้ ไม่ได้เข้าบัญชี จึงไม่แยกว่าเป็นค่าอะไร · ขอหนังสือรับรอง 50 ทวิ จากผู้ชำระเก็บไว้ให้ฝ่ายบัญชี</p> : <>
            <p className="field-hint">{sel ? `${sel.label} · ` : "ทุกช่องทาง · "}รวมรายการที่ชำระ {money(mixTotal)} บาท (ก่อนหักภาษี ณ ที่จ่าย) · ตัดตามลำดับรายการที่มี VAT ก่อน</p>
            <div className="dp-mixbar" role="img" aria-label={mixRows.map(([c, v]) => `${catName(c)} ${money(v)} บาท`).join(", ")}>
              {mixRows.map(([c, v]) => <i key={c} style={{ width: `${(v / (mixTotal || 1)) * 100}%`, background: CAT_COLOR[c] ?? "#8A7A5A" }} />)}
            </div>
            <ul className="dp-mixlist">
              {mixRows.map(([c, v]) => <li key={c}><i style={{ background: CAT_COLOR[c] ?? "#8A7A5A" }} /><span>{catName(c)}</span><b>{money(v)}</b><small>{mixTotal ? Math.round((v / mixTotal) * 100) : 0}%</small></li>)}
            </ul>
          </>}
        </section>

        <section className="card dp-card" aria-labelledby="dp-list-h">
          <h3 id="dp-list-h">รายการรับเงิน</h3>
          <div className="dp-list-bar">
            <p className="field-hint">{sel ? `เฉพาะ${sel.label} · ` : "ทุกช่องทาง · "}{qq ? `พบ ${listed.length} จาก ${shown.length}` : shown.length} รายการ · เรียงตามวันและเวลาที่รับเงิน</p>
            <label className="dp-search"><span className="sr-only">ค้นหาในรายการรับเงิน</span><input id="dp-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อ เลขใบเสร็จ เลขอ้างอิง…" /></label>
          </div>
          <div className="dd-table dp-table"><table>
            <thead><tr><th scope="col" className="dp-m">รายการ</th><th scope="col">วันที่ · เวลา</th><th scope="col">เลขที่ใบเสร็จ</th><th scope="col">ผู้รับบริการ · สาขา</th><th scope="col">ช่องทาง / บัญชี</th><th scope="col">เลขอ้างอิง</th><th scope="col" className="is-num">ยอด (บาท)</th><th scope="col">ชำระค่าอะไร</th></tr></thead>
            <tbody>
              {listed.map(({ r, parts, amt }) => (
                <tr key={r.id} className={openRow === r.id ? "is-open" : ""}>
                  <td className="dp-m" data-label="">
                    <button type="button" aria-expanded={openRow === r.id} onClick={() => setOpenRow(openRow === r.id ? null : r.id)}>
                      <span className="dp-m-who">{r.who}</span><b className="dp-m-amt">{money(amt)}</b>
                      <span className="dp-m-meta"><span>{dShort(r.date)}{r.time ? ` ${r.time}` : ""}</span>
                        {(sel ? parts.filter((p) => p.key === sel.key) : parts.filter((p) => p.kind !== "wht")).slice(0, 2).map((p) => <span key={p.key} className="dp-m-via"><ChanMark logo={p.logo} kind={p.kind} size={16} />{p.kind === "cash" ? "เงินสด" : p.warn ? GROUP[p.kind] : bankShort(p)}</span>)}
                        <span className="dp-m-rc">{r.receiptNo || r.no}</span></span>
                    </button>
                  </td>
                  <td data-label="วันที่ · เวลา" className="is-nw dp-date">{dTh(r.date)}{r.time ? ` · ${r.time}` : ""}</td>
                  <td data-label="เลขที่ใบเสร็จ" className="is-nw">{r.receiptNo || r.no}{r.cashier && <small className="dp-2nd">รับโดย {r.cashier}</small>}</td>
                  <td data-label="ผู้รับบริการ" className="dp-who">{r.who}<small className="dp-2nd">{r.branch}</small></td>
                  <td data-label="ช่องทาง / บัญชี"><span className="dp-via">{(sel ? parts.filter((p) => p.key === sel.key) : parts.filter((p) => p.kind !== "wht")).map((p) => (
                    <span key={p.key} title={p.label}><ChanMark logo={p.logo} kind={p.kind} size={18} />{p.kind === "cash" ? "เงินสด" : p.warn ? `${GROUP[p.kind]} · ไม่ระบุ` : p.name}{!sel && parts.filter((x) => x.kind !== "wht").length > 1 ? ` ${money(p.amt)}` : ""}</span>))}</span></td>
                  <td data-label="เลขอ้างอิง" className="is-nw">{r.transferRef || "-"}</td>
                  <td data-label="ยอด (บาท)" className="is-num dp-amt">{money(amt)}</td>
                  <td data-label="ชำระค่าอะไร" className="dp-wide"><span className="dp-chips">{[...catsOf(r)].map(([c, v]) => <span key={c}>{catName(c)} {money(v)}</span>)}</span></td>
                </tr>
              ))}
              {listed.length > 0 ? <tr className="dp-sum"><td className="dp-m" data-label="" /><td colSpan={5} data-label="">รวม {listed.length} รายการ</td><td className="is-num" data-label="ยอดรวม (บาท)">{money(listed.reduce((n, x) => n + x.amt, 0))}</td><td data-label="" /></tr>
                : <tr><td colSpan={8} className="kc-empty">ไม่พบรายการที่ตรงกับ “{q}”</td></tr>}
            </tbody>
          </table></div>
        </section>
        <p className="field-hint">ยอดตามวันที่รับเงินจริง · งวดที่จ่ายหลายช่องทางแยกยอดไปตามแต่ละช่องทาง · ไม่นับการหักด้วยใบลดหนี้ · เลขบัญชีและเครื่อง EDC มาจาก ตั้งค่า › บัญชีธนาคาร (ชื่อ ณ ตอนรับเงิน)</p>
      </>}
    </>
  );
}
