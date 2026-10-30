"use client";
import { ReactNode } from "react";
import Icon from "../Icon";
import { Modal } from "../ui";
import { bahtText, money } from "@/lib/billing";

/**
 * เอกสารทางการสำหรับพิมพ์ (กระดาษ A4 · ฟอนต์ Sarabun)
 * หัวกระดาษบริษัท/สาขา · เลขอ้างอิงมุมขวา · ช่องลงนาม · ท้ายกระดาษบอกเลขเอกสาร วันเวลาที่พิมพ์ และผู้พิมพ์
 */
export type DocBranch = { name: string; legal: string; address: string; phone: string };
const COMPANY = { legal: "บริษัท ทีทรี สโตรก เนอสซิ่งโฮม จำกัด", brand: "KIN Rehabilitation & Homecare", address: "6 ซอยนาคนิวาส 18 (ลาดพร้าว 71) แขวงลาดพร้าว เขตลาดพร้าว กรุงเทพมหานคร 10230", phone: "02-096-4996" };

const MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];
const SHORT = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
/** "2026-10-29" หรือ "29/10/2569" → "29 ตุลาคม พ.ศ. 2569" */
export function longDate(v?: string | null, short = false) {
  const s = String(v ?? "").trim();
  let d: number, m: number, y: number;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/), th = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (iso) { y = +iso[1] + 543; m = +iso[2]; d = +iso[3]; } else if (th) { d = +th[1]; m = +th[2]; y = +th[3]; if (y < 2400) y += 543; } else return s || "-";
  return short ? `${d} ${SHORT[m - 1]} ${y}` : `${d} ${MONTHS[m - 1]} พ.ศ. ${y}`;
}
const nowTh = () => { const n = new Date(Date.now() + 7 * 3600e3); return `${n.getUTCDate()} ${SHORT[n.getUTCMonth()]} ${n.getUTCFullYear() + 543} ${String(n.getUTCHours()).padStart(2, "0")}:${String(n.getUTCMinutes()).padStart(2, "0")}`; };
const blank = (v?: string | null) => !v || v === "-" ? "" : v;
const val = (v?: string | null) => blank(v) || "-";
const numOf = (v?: string | null) => Number(String(v ?? "").replace(/,/g, "")) || 0;
/** เลขบัตร 13 หลัก → 1-2345-67890-12-3 · เบอร์ 10 หลัก → 081-234-5678 */
const idFmt = (v?: string | null) => { const s = String(v ?? "").replace(/\D/g, ""); return s.length === 13 ? `${s[0]}-${s.slice(1, 5)}-${s.slice(5, 10)}-${s.slice(10, 12)}-${s[12]}` : val(v); };
const telFmt = (v?: string | null) => { const s = String(v ?? "").replace(/\D/g, ""); return s.length === 10 ? `${s.slice(0, 3)}-${s.slice(3, 6)}-${s.slice(6)}` : val(v); };

/* ---------- ส่วนประกอบของกระดาษ ---------- */
export function Paper({ children, half = false }: { children: ReactNode; half?: boolean }) {
  return <article className={`doc-paper${half ? " is-half" : ""}`}>{children}</article>;
}
export function DocHead({ branch, refs, brandOnly = false }: { branch?: DocBranch; refs?: [string, string][]; brandOnly?: boolean }) {
  const b = branch;
  return (
    <header className="doc-head">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="doc-logo" src="/logo-mark.png" alt="KIN Rehabilitation & Homecare" />
      <div className="doc-co">
        <b>{brandOnly ? COMPANY.brand : b?.legal || COMPANY.legal}</b>
        <span>{brandOnly ? `สาขา${b?.name ?? ""} · โทร ${b?.phone || COMPANY.phone}` : `${COMPANY.brand}${b?.name ? ` · สาขา${b.name}` : ""}`}</span>
        {!brandOnly && <span>{b?.address || COMPANY.address} · โทร {b?.phone || COMPANY.phone}</span>}
      </div>
      {refs && refs.length > 0 && <dl className="doc-ref">{refs.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>}
    </header>
  );
}
export const DocTitle = ({ title, sub, copy }: { title: string; sub?: string; copy?: string }) => (
  <><h2 className="doc-title">{title}{copy && <span className="doc-copy">{copy}</span>}</h2>{sub && <p className="doc-sub">{sub}</p>}</>
);
export const DocH = ({ children }: { children: ReactNode }) => <h3 className="doc-h">{children}</h3>;
export const KV = ({ items }: { items: [string, ReactNode, boolean?][] }) => (
  <dl className="doc-kv">{items.map(([k, v, wide]) => <div key={k} className={wide ? "is-wide" : ""}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
);
export const Signs = ({ people }: { people: [string, string?][] }) => (
  <div className="doc-sign">{people.map(([role, name], i) => <div key={i}><span className="line" /><b>( {name || "................................................"} )</b><small>{role}</small></div>)}</div>
);
export const DocFoot = ({ left, by }: { left: string; by?: string }) => (
  <footer className="doc-foot"><span>{left}</span><span>พิมพ์เมื่อ {nowTh()}{by ? ` โดย ${by}` : ""}</span></footer>
);

/** หน้าต่างแสดงเอกสาร + ปุ่มพิมพ์ */
export function PrintModal({ open, title, onClose, children, extra }: { open: boolean; title: string; onClose: () => void; children: ReactNode; extra?: ReactNode }) {
  return (
    <Modal open={open} wide title={title} onClose={onClose}
      footer={<>{extra}<button className="btn-soft" onClick={onClose}>ปิด</button><button className="btn-primary" onClick={() => window.print()}><Icon name="print" className="h-4 w-4" /> พิมพ์</button></>}>
      <div className="doc-stage">{children}</div>
    </Modal>
  );
}

/* ---------- สัญญาให้บริการ ---------- */
/** ข้อสัญญามาตรฐาน (ใช้เมื่อยังไม่ได้ตั้งข้อความจริงที่เมนูสัญญา → ข้อความสัญญา) */
export const DEFAULT_TERMS = [
  "ผู้ให้บริการจะจัดให้มีการดูแลผู้รับบริการตามแผนการดูแลที่ตกลงร่วมกัน โดยทีมพยาบาลและผู้ช่วยพยาบาลตลอด 24 ชั่วโมง",
  "ผู้ว่าจ้างตกลงชำระค่าบริการตามอัตราในสัญญานี้ภายในกำหนด",
  "ค่ายา เวชภัณฑ์ และค่ารักษาพยาบาลภายนอก ไม่รวมอยู่ในค่าบริการ ผู้ให้บริการจะออกใบแจ้งหนี้แยกตามจริง",
  "การเปลี่ยนห้องพักหรือแผนการดูแล ให้ทำเป็นบันทึกต่อท้ายสัญญา ลงนามทั้งสองฝ่าย",
  "คู่สัญญาฝ่ายใดประสงค์บอกเลิกสัญญา ให้แจ้งอีกฝ่ายเป็นลายลักษณ์อักษรล่วงหน้า",
].join("\n");

/** แถวสัญญา: [เลขที่, สาขา, ผู้รับบริการ, ผู้ว่าจ้าง, ค่าบริการ/เดือน, สถานะ, ห้อง, วันเริ่ม, บัตรผู้ว่าจ้าง, โทร, ที่อยู่, ความเกี่ยวข้อง, บัตรผู้รับบริการ, อายุ, บริการพื้นฐาน, รายการเพิ่มเติม, ค่าเพิ่มเติม, แพ็กเกจ, ล่วงหน้า, ประกัน, หมายเหตุ] */
export function ContractDoc({ r, hn, bed, branch, terms, by, copy }: { r: string[]; hn?: string; bed?: string; branch?: DocBranch; terms?: string; by?: string; copy?: boolean }) {
  const fee = numOf(r[4]), extra = numOf(r[16]), prepaid = numOf(r[18]), deposit = numOf(r[19]);
  const lines: [string, number][] = [
    [`ค่าบริการรายเดือน${blank(r[6]) ? ` ห้อง ${r[6]}${bed ? ` เตียง ${bed}` : ""}` : ""}${blank(r[14]) ? ` (รวม ${r[14]})` : ""}`, fee],
    ...(extra ? [[`ค่าบริการเพิ่มเติมรายเดือน${blank(r[15]) ? ` (${r[15]})` : ""}`, extra] as [string, number]] : []),
    ...(blank(r[17]) ? [[`แพ็กเกจเสริม: ${r[17]}`, 0] as [string, number]] : []),
  ];
  const first = prepaid + deposit;
  const clauses = (terms?.trim() || DEFAULT_TERMS).split(/\n+/).map((x) => x.trim()).filter(Boolean);
  return (
    <Paper>
      <DocHead branch={branch} refs={[["เลขที่สัญญา", val(r[0])], ["HN", val(hn)], ["ทำที่", `สาขา${r[1]}`]]} />
      <DocTitle title="สัญญาให้บริการดูแลผู้สูงอายุและผู้ป่วย" sub={`ทำเมื่อวันที่ ${longDate(r[7])}`} copy={copy ? "สำเนา" : "ต้นฉบับ"} />
      <p className="doc-indent">สัญญาฉบับนี้ทำขึ้นระหว่าง <span className="doc-fill">{branch?.legal || COMPANY.legal}</span> ซึ่งต่อไปในสัญญานี้เรียกว่า &quot;ผู้ให้บริการ&quot; ฝ่ายหนึ่ง กับ <span className="doc-fill">{val(r[3])}</span> ซึ่งต่อไปในสัญญานี้เรียกว่า &quot;ผู้ว่าจ้าง&quot; อีกฝ่ายหนึ่ง ทั้งสองฝ่ายตกลงทำสัญญากันโดยมีข้อความดังต่อไปนี้</p>
      <DocH>ข้อมูลคู่สัญญาและผู้รับบริการ</DocH>
      <KV items={[
        ["ผู้ว่าจ้าง", val(r[3])], ["เลขบัตรประชาชน", idFmt(r[8])], ["เบอร์โทรศัพท์", telFmt(r[9])], ["ความเกี่ยวข้อง", val(r[11])],
        ["ที่อยู่", val(r[10]), true],
        ["ผู้รับบริการ", val(r[2])], ["อายุ", blank(r[13]) ? `${r[13]} ปี` : "-"], ["เลขบัตรประชาชน", idFmt(r[12])],
        ["ห้องพัก", blank(r[6]) ? `${r[6]}${bed ? ` เตียง ${bed}` : ""}` : "ยังไม่ระบุ"], ["เริ่มสัญญา", longDate(r[7])],
      ]} />
      <DocH>อัตราค่าบริการ</DocH>
      <div className="doc-tbl"><table>
        <thead><tr><th>รายการ</th><th className="n">จำนวนเงิน (บาท)</th></tr></thead>
        <tbody>{lines.map(([t, n], i) => <tr key={i}><td>{t}</td><td className="n">{n ? money(n) : "-"}</td></tr>)}</tbody>
      </table></div>
      {first > 0 && <>
        <DocH>ชำระแรกเข้า</DocH>
        <div className="doc-tbl"><table>
          <tbody>
            {prepaid > 0 && <tr><td>ค่าบริการล่วงหน้า</td><td className="n">{money(prepaid)}</td></tr>}
            {deposit > 0 && <tr><td>เงินประกัน (คืนเมื่อสิ้นสุดสัญญา หักค่าใช้จ่ายค้างชำระ)</td><td className="n">{money(deposit)}</td></tr>}
          </tbody>
          <tfoot><tr><td>รวมชำระแรกเข้า ({bahtText(first)})</td><td className="n">{money(first)}</td></tr></tfoot>
        </table></div>
      </>}
      <DocH>ข้อตกลง</DocH>
      <ol className="doc-clauses">{clauses.map((c, i) => <li key={i}>{c}</li>)}</ol>
      {blank(r[20]) && <p className="doc-note">หมายเหตุ: {r[20]}</p>}
      <p className="doc-indent">คู่สัญญาได้อ่านและเข้าใจข้อความในสัญญานี้โดยตลอดแล้ว เห็นว่าถูกต้องตามเจตนา จึงลงลายมือชื่อไว้เป็นสำคัญต่อหน้าพยาน สัญญานี้ทำขึ้นสองฉบับมีข้อความตรงกัน ต่างฝ่ายต่างยึดถือไว้ฝ่ายละหนึ่งฉบับ</p>
      <Signs people={[["ผู้ว่าจ้าง", blank(r[3])], ["ผู้ให้บริการ / ผู้มีอำนาจลงนาม"], ["พยาน"], ["พยาน"]]} />
      <DocFoot left={`สัญญา ${val(r[0])}`} by={by} />
    </Paper>
  );
}

/* ---------- บันทึกต่อท้ายสัญญา (ต่อสัญญา / เปลี่ยนเงื่อนไข) ---------- */
const DIFF: [number, string][] = [[7, "วันเริ่มสัญญา"], [6, "ห้องพัก"], [4, "ค่าบริการรายเดือน"], [14, "บริการในค่าบริการพื้นฐาน"], [15, "รายการที่มีค่าใช้จ่ายเพิ่มเติม"], [16, "ค่าบริการเพิ่มเติมรายเดือน"], [17, "แพ็กเกจเสริม"], [19, "เงินประกัน"]];
export function RenewDoc({ before, after, hn, branch, by }: { before: string[]; after: string[]; hn?: string; branch?: DocBranch; by?: string }) {
  const show = (k: number, v?: string) => (k === 7 ? longDate(v, true) : [4, 16, 19].includes(k) && numOf(v) ? money(numOf(v)) : val(v));
  const rows = DIFF.filter(([k]) => (before[k] ?? "") !== (after[k] ?? ""));
  return (
    <Paper>
      <DocHead branch={branch} refs={[["อ้างอิงสัญญา", val(before[0])], ["สัญญาใหม่", val(after[0]) === "-" ? "รอออกเลข" : after[0]], ["HN", val(hn)]]} />
      <DocTitle title="บันทึกต่อท้ายสัญญาให้บริการ" sub={`การต่อสัญญาและเปลี่ยนแปลงเงื่อนไข · วันที่ ${longDate(after[7])}`} copy="ต้นฉบับ" />
      <p className="doc-indent">ตามที่ <span className="doc-fill">{val(before[3])}</span> (ผู้ว่าจ้าง) ได้ทำสัญญาให้บริการเลขที่ {val(before[0])} ลงวันที่ {longDate(before[7])} สำหรับ <span className="doc-fill">{val(before[2])}</span> คู่สัญญาตกลงต่อสัญญาและเปลี่ยนแปลงเงื่อนไขดังนี้ ส่วนข้อความอื่นในสัญญาเดิมยังคงมีผลบังคับทุกประการ</p>
      <DocH>รายการที่เปลี่ยนแปลง</DocH>
      <div className="doc-tbl"><table>
        <thead><tr><th>หัวข้อ</th><th>เดิม</th><th>ใหม่</th></tr></thead>
        <tbody>{rows.length ? rows.map(([k, t]) => <tr key={k}><td>{t}</td><td>{show(k, before[k])}</td><td><b>{show(k, after[k])}</b></td></tr>) : <tr><td colSpan={3}>ต่อสัญญาด้วยเงื่อนไขเดิมทุกข้อ</td></tr>}</tbody>
      </table></div>
      <Signs people={[["ผู้ว่าจ้าง", blank(after[3])], ["ผู้ให้บริการ"]]} />
      <DocFoot left={`ต่อจากสัญญา ${val(before[0])}`} by={by} />
    </Paper>
  );
}

/* ---------- ใบจำหน่าย (D/C) ---------- */
export type DcData = {
  contract: string[]; hn?: string; age?: string; date: string; reason: string; days?: number; chronic?: string;
  vitals?: { at: string; text: string } | null; meds: { name: string; how: string; meals: string }[]; nextAppt?: string | null; advice?: string;
  owing: number; deposit: number;
};
export function DischargeDoc({ d, branch, by }: { d: DcData; branch?: DocBranch; by?: string }) {
  const c = d.contract;
  return (
    <Paper>
      <DocHead branch={branch} refs={[["HN", val(d.hn)], ["สัญญา", val(c[0])]]} />
      <DocTitle title="ใบจำหน่ายผู้รับบริการ (Discharge Summary)" sub={`วันที่จำหน่าย ${longDate(d.date)}`} />
      <KV items={[
        ["ผู้รับบริการ", `${val(c[2])}${d.age ? ` อายุ ${d.age} ปี` : ""}`], ["ห้องพัก", val(c[6])],
        ["วันที่เข้าพัก", longDate(c[7], true)], ["รวมระยะเวลา", d.days !== undefined ? `${d.days} วัน` : "-"],
        ["โรคประจำตัว", val(d.chronic)], ["เหตุผลจำหน่าย", d.reason],
        ["ผู้ว่าจ้าง / ญาติ", `${val(c[3])}${blank(c[9]) ? ` · ${telFmt(c[9])}` : ""}`, true],
      ]} />
      <DocH>สัญญาณชีพครั้งล่าสุด{d.vitals ? ` (${d.vitals.at})` : ""}</DocH>
      <p>{d.vitals?.text || "ไม่มีบันทึก"}</p>
      <DocH>ยาที่ต้องรับประทานต่อที่บ้าน</DocH>
      <div className="doc-tbl"><table>
        <thead><tr><th>ชื่อยา</th><th>วิธีใช้</th><th>มื้อ</th></tr></thead>
        <tbody>{d.meds.length ? d.meds.map((m, i) => <tr key={i}><td>{m.name}</td><td>{m.how}</td><td>{m.meals}</td></tr>) : <tr><td colSpan={3}>ไม่มียาประจำ</td></tr>}</tbody>
      </table></div>
      <DocH>คำแนะนำและนัดติดตาม</DocH>
      <p>{[d.advice, d.nextAppt ? `นัดถัดไป: ${d.nextAppt}` : ""].filter(Boolean).join(" · ") || "-"}</p>
      <DocH>สรุปค่าใช้จ่าย</DocH>
      <p className="doc-box">ยอดค้างชำระ ณ วันจำหน่าย <b>{money(d.owing)} บาท</b>{d.deposit > 0 ? <> · เงินประกันตามสัญญา <b>{money(d.deposit)} บาท</b></> : null}</p>
      <Signs people={[["ผู้รับบริการ / ญาติ", blank(c[3])], ["พยาบาลผู้จำหน่าย"], ["ฝ่ายการเงิน"]]} />
      <DocFoot left={`D/C · ${val(d.hn)}`} by={by} />
    </Paper>
  );
}

/* ---------- ใบเสนอราคา ---------- */
export type QuoteItem = { desc: string; qty: number; unit: string; price: number };
export function QuoteDoc({ no, date, validDays, payer, resident, age, chronic, level, items, note, branch, by }: {
  no: string; date: string; validDays: number; payer: string; resident: string; age?: string; chronic?: string; level?: string; items: QuoteItem[]; note?: string; branch?: DocBranch; by?: string;
}) {
  const total = items.reduce((n, i) => n + i.qty * i.price, 0);
  const LEVELS = ["ช่วยเหลือตัวเองได้", "ต้องการความช่วยเหลือบางส่วน", "ติดเตียง", "ฟื้นฟูหลังโรคหลอดเลือดสมอง"];
  return (
    <Paper>
      <DocHead branch={branch} refs={[["เลขที่", no || "รอออกเลข"], ["วันที่", longDate(date, true)], ["ยืนราคา", `${validDays} วัน`]]} />
      <DocTitle title="ใบเสนอราคาและแผนการดูแล" sub={`เสนอ ${payer || "-"} · สำหรับ ${resident}${age ? ` อายุ ${age} ปี` : ""}`} />
      {chronic && <p>โรคประจำตัว: {chronic}</p>}
      <DocH>ระดับการดูแลที่ประเมิน</DocH>
      <p className="doc-box doc-checks">{LEVELS.map((l) => <span key={l}>{level === l ? "☑" : "☐"} {l}</span>)}</p>
      <DocH>รายการบริการ</DocH>
      <div className="doc-tbl"><table>
        <thead><tr><th>รายการ</th><th className="n">จำนวน</th><th className="n">ราคา/หน่วย</th><th className="n">รวม (บาท)</th></tr></thead>
        <tbody>{items.map((i, k) => <tr key={k}><td>{i.desc}</td><td className="n">{i.qty} {i.unit}</td><td className="n">{money(i.price)}</td><td className="n">{money(i.qty * i.price)}</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={3}>รวมทั้งสิ้น ({bahtText(total)})</td><td className="n">{money(total)}</td></tr></tfoot>
      </table></div>
      <p className="doc-note">ราคานี้ยังไม่รวมค่ายา เวชภัณฑ์ และค่ารักษาพยาบาลภายนอก{note ? ` · ${note}` : ""}</p>
      <Signs people={[["ผู้เสนอราคา", by], ["ผู้รับใบเสนอราคา", payer]]} />
      <DocFoot left={no || "ใบเสนอราคา"} by={by} />
    </Paper>
  );
}

/* ---------- ใบนัดหมาย (ครึ่ง A4) ---------- */
export function ApptSlip({ resident, hn, date, time, purpose, caregiver, prep, branch, by }: { resident: string; hn?: string; date: string; time: string; purpose: string; caregiver?: string; prep?: string; branch?: DocBranch; by?: string }) {
  return (
    <Paper half>
      <DocHead branch={branch} brandOnly />
      <DocTitle title="ใบนัดหมาย" sub="แจ้งญาติ / ติดหน้าห้องผู้รับบริการ" />
      <KV items={[
        ["ผู้รับบริการ", `${resident}${hn ? ` · HN ${hn}` : ""}`, true],
        ["วันเวลานัด", <b key="d" className="doc-big">{longDate(date)} · {time} น.</b>, true],
        ["รายการ", purpose, true], ["ผู้พาไป", val(caregiver), true], ["เตรียมตัว", val(prep), true],
      ]} />
      <DocFoot left={by ? `บันทึกโดย ${by}` : "ใบนัดหมาย"} />
    </Paper>
  );
}

/* ---------- สรุปประวัติผู้รับบริการ ---------- */
export function ProfileDoc({ name, hn, age, room, branch, chronic, contact, admission, vitals, mar, notes, problems, by }: {
  name: string; hn?: string; age?: string; room?: string; branch?: DocBranch; chronic?: string; contact?: string;
  admission?: [string, string][]; vitals: string[][]; mar: string[][]; notes: string[][]; problems: string[]; by?: string;
}) {
  return (
    <Paper>
      <DocHead branch={branch} brandOnly refs={[["HN", val(hn)], ["พิมพ์ข้อมูลถึง", longDate(new Date(Date.now() + 7 * 3600e3).toISOString(), true)]]} />
      <DocTitle title="สรุปประวัติการดูแลผู้รับบริการ" sub={`${name}${age ? ` · อายุ ${age} ปี` : ""}${room ? ` · ห้อง ${room}` : ""}`} />
      <KV items={[["โรคประจำตัว", val(chronic)], ["ผู้ติดต่อ", val(contact)], ...(admission ?? []).map(([k, v]) => [k, v] as [string, string])]} />
      {problems.length > 0 && <><DocH>Problem list (ยังไม่ปิด)</DocH><ol className="doc-clauses">{problems.map((p, i) => <li key={i}>{p}</li>)}</ol></>}
      <DocH>สัญญาณชีพล่าสุด</DocH>
      <div className="doc-tbl"><table><thead><tr><th>วันเวลา</th><th>สัญญาณชีพ</th><th>O₂</th><th>DTX</th><th>ผู้บันทึก</th></tr></thead>
        <tbody>{vitals.length ? vitals.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>) : <tr><td colSpan={5}>ไม่มีบันทึก</td></tr>}</tbody></table></div>
      <DocH>การให้ยา (MAR) ล่าสุด</DocH>
      <div className="doc-tbl"><table><thead><tr><th>วันที่</th><th>มื้อ</th><th>รายการยา</th><th>ผู้ให้ยา</th></tr></thead>
        <tbody>{mar.length ? mar.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>) : <tr><td colSpan={4}>ไม่มีบันทึก</td></tr>}</tbody></table></div>
      {notes.length > 0 && <><DocH>Nurse Note ล่าสุด</DocH>
        <div className="doc-tbl"><table><thead><tr><th>วันเวลา</th><th>บันทึก</th><th>ผู้บันทึก</th></tr></thead>
          <tbody>{notes.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody></table></div></>}
      <Signs people={[["พยาบาลผู้พิมพ์รายงาน", by]]} />
      <DocFoot left="เอกสารภายใน ห้ามเผยแพร่" by={by} />
    </Paper>
  );
}

/* ---------- ใบส่งต่อผู้รับบริการ ---------- */
export function ReferralDoc({ name, hn, age, branch, to, reason, chronic, allergy, diagnosis, vitals, meds, devices, summary, by }: {
  name: string; hn?: string; age?: string; branch?: DocBranch; to: string; reason: string; chronic?: string; allergy?: string; diagnosis?: string;
  vitals?: string; meds: string[]; devices?: string; summary?: string; by?: string;
}) {
  return (
    <Paper>
      <DocHead branch={branch} refs={[["HN", val(hn)], ["วันที่", longDate(new Date(Date.now() + 7 * 3600e3).toISOString(), true)]]} />
      <DocTitle title="ใบส่งต่อผู้รับบริการ (Referral)" sub={`ส่งต่อไปยัง ${to}`} />
      <KV items={[
        ["ผู้รับบริการ", `${name}${age ? ` อายุ ${age} ปี` : ""}`], ["การวินิจฉัย", val(diagnosis)],
        ["โรคประจำตัว", val(chronic)], ["ประวัติแพ้ยา/อาหาร", val(allergy)],
        ["เหตุผลการส่งต่อ", reason, true], ["สัญญาณชีพล่าสุด", val(vitals), true], ["อุปกรณ์ที่ติดตัว", val(devices), true],
      ]} />
      <DocH>ยาที่ใช้อยู่</DocH>
      <ol className="doc-clauses">{meds.length ? meds.map((m, i) => <li key={i}>{m}</li>) : <li>ไม่มียาประจำ</li>}</ol>
      {summary && <><DocH>สรุปอาการและการดูแลที่ผ่านมา</DocH><p className="doc-indent">{summary}</p></>}
      <Signs people={[["พยาบาลผู้ส่งต่อ", by], ["ผู้รับการส่งต่อ"]]} />
      <DocFoot left={`ส่งต่อ · ${val(hn)}`} by={by} />
    </Paper>
  );
}
