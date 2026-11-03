"use client";
import { ReactNode } from "react";
import Icon from "../Icon";
import { Modal } from "../ui";
import { bahtText, money, svcDiscount, svcNet } from "@/lib/billing";
import { EXTRA_SERVICES, PACKAGES, rateColumns, ROOMS } from "@/lib/priceList";
import { isNoAllergy } from "@/lib/medicalLists";
import { ACCEPT, CONSENT, CONSENT_MARKETING, DOC_RECEIPT, EXCLUDED, EXCLUDED_NOTE, FINES, HOSPITAL_STEPS, INCLUDED, INCLUDED_NOTE, PAY_CHANNELS, REHAB_CHECKS, ROOM_CHECK, ROOM_CHECK_NOTE,
  RULES_CENTER, RULES_FINANCE_AFTER, RULES_FINANCE_BEFORE, RULES_NURSING, RULES_REFUND, RULES_REHAB, VISIT_EFFECTIVE, VISIT_RULES } from "@/lib/contractText";

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
  <div className="doc-sign">{people.map(([role, name], i) => <div key={i}><span className="line" /><b>( {name || "...................................."} )</b><small>{role}</small></div>)}</div>
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

/* ---------- สัญญาจ้างดูแลผู้สูงอายุ หรือผู้มีภาวะพึ่งพิง (แบบฟอร์ม KIN) ---------- */
/** ข้อความเดิมที่เคยตั้งไว้เป็นข้อตกลงหลัก · ตอนนี้ใช้เป็น "เงื่อนไขอื่น ๆ เพิ่มเติม" (ข้อ 5.4) */
export const DEFAULT_TERMS = "";

/** แถวสัญญา: [เลขที่, สาขา, ผู้รับบริการ, ผู้ว่าจ้าง, ราคาโปรแกรม, สถานะ, ห้อง, วันเริ่ม, บัตรผู้ว่าจ้าง, โทร, ที่อยู่, ความเกี่ยวข้อง, บัตรผู้รับบริการ, อายุ, บริการพื้นฐาน, รายการเพิ่มเติม, ค่าเพิ่มเติม, แพ็กเกจ, ล่วงหน้า, ประกัน, หมายเหตุ,
 *  โปรแกรม, วันสิ้นสุด, รายการ (JSON), โรงพยาบาลตามสิทธิ์, แพ้ยา, แพ้อาหาร, หักมัดจำห้อง, ยา/เวชภัณฑ์ที่ใช้ประจำ] */
export type ContractLine = { desc: string; qty: number; unit: string; price: number; discount?: number; pct?: number };
/** รายการค่าบริการของสัญญา · สัญญาเก่าที่ยังไม่มีรายการ: แปลงจากค่าบริการเพิ่มเติมรายเดือนเดิม */
export function contractLines(r: string[]): ContractLine[] {
  try { const x = JSON.parse(r[23] || "[]"); if (Array.isArray(x)) return x; } catch { /* สัญญาเก่า */ }
  const extra = numOf(r[16]);
  return extra ? [{ desc: blank(r[15]) ? `ค่าบริการเพิ่มเติม (${r[15]})` : "ค่าบริการเพิ่มเติม", qty: 1, unit: "เดือน", price: extra }] : [];
}
/** ยอดรวม = ราคาโปรแกรม + รายการค่าบริการ (ก่อนหักมัดจำห้อง) */
export const contractTotal = (r: string[]) => numOf(r[4]) + contractLines(r).reduce((n, x) => n + svcNet(x), 0);

const Num = ({ n, children }: { n: string; children: ReactNode }) => <div className="doc-num"><b>{n}</b><div>{children}</div></div>;
const Fill = ({ v, w }: { v?: string | null; w?: string }) => <span className="doc-fill" style={w ? { minWidth: w } : undefined}>{blank(v) || " "}</span>;
const Break = () => <div className="doc-break" aria-hidden="true" />;

export function ContractDoc({ r, hn, bed, branch, terms, by, copy, chronic }: { r: string[]; hn?: string; bed?: string; branch?: DocBranch; terms?: string; by?: string; copy?: boolean; chronic?: string }) {
  const lines = contractLines(r);
  const fee = numOf(r[4]), total = contractTotal(r), dep = numOf(r[27]), prepaid = numOf(r[18]), deposit = numOf(r[19]);
  const net = total - dep;
  const legal = branch?.legal || COMPANY.legal;
  const room = blank(r[6]) ? `ห้อง ${r[6]}${bed ? ` เตียง ${bed}` : ""}` : "";
  const extra = (terms ?? "").split(/\n+/).map((x) => x.trim()).filter(Boolean);
  const head = (title: string) => <><DocHead branch={branch} refs={[["เลขที่สัญญา", val(r[0])], ["HN", val(hn)]]} /><DocTitle title={title} /></>;
  const sign = (people: [string, string?][]) => <Signs people={people} />;
  return (
    <Paper>
      {/* หน้า 1: คู่สัญญา ผู้รับบริการ ระยะเวลา และค่าบริการ */}
      <DocHead branch={branch} refs={[["เลขที่สัญญา", val(r[0])], ["HN", val(hn)], ["จัดทำที่", `สาขา${r[1]}`]]} />
      <DocTitle title="สัญญาจ้างดูแลผู้สูงอายุ หรือผู้มีภาวะพึ่งพิง" sub={`วันที่ ${longDate(r[7])}`} copy={copy ? "สำเนา" : "ต้นฉบับ"} />
      <p className="doc-indent">ข้าพเจ้า <Fill v={r[3]} w="14em" /> มีความสัมพันธ์เกี่ยวข้องเป็น <Fill v={r[11]} w="5em" /> เลขบัตรประชาชน <Fill v={idFmt(r[8]) === "-" ? "" : idFmt(r[8])} w="10em" /> เบอร์ติดต่อ <Fill v={telFmt(r[9]) === "-" ? "" : telFmt(r[9])} w="7em" /> ที่อยู่ <Fill v={r[10]} w="20em" /> ซึ่งต่อไปนี้เรียกว่า &quot;ผู้ว่าจ้าง&quot; ฝ่ายหนึ่ง กับ {legal} ที่ตั้งเลขที่ {branch?.address || COMPANY.address} ซึ่งต่อไปนี้เรียกว่า &quot;ผู้รับจ้าง&quot; อีกฝ่ายหนึ่ง</p>
      <Num n="1.">
        <p>ผู้ว่าจ้างตกลงว่าจ้างให้ผู้รับจ้างดูแลผู้สูงอายุ หรือผู้มีภาวะพึ่งพิง โดยมีประวัติดังต่อไปนี้</p>
        <KV items={[
          ["ชื่อ - นามสกุล", val(r[2])], ["อายุ", blank(r[13]) ? `${r[13]} ปี` : "-"], ["เลขบัตรประชาชน", idFmt(r[12])], ["ห้องพัก", room || "-"],
          ["โรคประจำตัว", val(chronic)], ["โรงพยาบาลตามสิทธิ์การรักษา", val(r[24])],
          ["ประวัติการแพ้ยา", isNoAllergy(r[25]) ? "ปฏิเสธ" : `แพ้ยา (ระบุ: ${r[25]})`], ["ประวัติการแพ้อาหาร", isNoAllergy(r[26]) ? "ปฏิเสธ" : `แพ้ (ระบุ: ${r[26]})`],
          ["ยา / เวชภัณฑ์ที่ใช้ประจำ", val(r[28]), true],
        ]} />
      </Num>
      <Num n="2."><p>สัญญานี้เริ่มตั้งแต่วันที่ <Fill v={longDate(r[7])} w="9em" /> จนถึงวันที่ <Fill v={blank(r[22]) ? longDate(r[22]) : ""} w="9em" /> และสัญญาจะมีผลต่อเนื่องจนกว่าผู้รับบริการจะจำหน่ายจากศูนย์ฯ</p></Num>
      <div className="doc-tbl"><table>
        <thead><tr><th>รายการ</th><th className="n">จำนวนเงิน (บาท)</th></tr></thead>
        <tbody>
          <tr><td><b>{val(r[21]) === "-" ? "ค่าบริการ" : r[21]}</b></td><td className="n">{fee ? money(fee) : ""}</td></tr>
          {lines.map((x, i) => <tr key={i}><td>&nbsp;- {x.desc}{x.qty !== 1 || !["เดือน", "แพ็กเกจ"].includes(x.unit) ? ` (${x.qty.toLocaleString("en-US")} ${x.unit}${x.price ? ` × ${money(x.price)}` : ""})` : ""}{svcDiscount(x) ? ` ส่วนลด${x.pct ? ` ${x.pct}%` : ""} ${money(svcDiscount(x))}` : ""}</td><td className="n">{x.price ? money(svcNet(x)) : "รวมในโปรแกรม"}</td></tr>)}
        </tbody>
        <tfoot>
          <tr><td>ยอดรวมทั้งหมด</td><td className="n">{money(total)}</td></tr>
          {dep > 0 && <tr><td>หักค่ามัดจำห้องพัก</td><td className="n">-{money(dep)}</td></tr>}
          {dep > 0 && <tr><td>ยอดรวมทั้งหมด ({bahtText(net)})</td><td className="n">{money(net)}</td></tr>}
        </tfoot>
      </table></div>
      {(prepaid > 0 || deposit > 0) && <p className="doc-note">ชำระแรกเข้า: {[prepaid ? `ค่าบริการล่วงหน้า ${money(prepaid)} บาท` : "", deposit ? `เงินประกัน ${money(deposit)} บาท (คืนเมื่อสิ้นสุดสัญญา หักค่าใช้จ่ายค้างชำระ)` : ""].filter(Boolean).join(" · ")}</p>}
      {blank(r[20]) && <p className="doc-note">หมายเหตุ: {r[20]}</p>}
      {sign([["ผู้ว่าจ้าง ผู้รับบริการ ญาติ หรือผู้สนับสนุน", blank(r[3])]])}

      {/* หน้า 2: รายการที่รวม/ไม่รวม และอัตราค่าบริการ */}
      <Break />
      {head("สัญญาจ้างดูแลผู้สูงอายุ หรือผู้มีภาวะพึ่งพิง")}
      <DocH>รายการที่รวมอยู่ในบริการรายวัน และรายเดือน</DocH>
      <ol className="doc-clauses">{INCLUDED.map((x) => <li key={x}>{x}</li>)}</ol>
      <p className="doc-note"><b>{INCLUDED_NOTE}</b></p>
      <DocH>สิ่งที่ไม่รวมในรายการ</DocH>
      <ol className="doc-clauses">{EXCLUDED.map((x) => <li key={x}>{x}</li>)}</ol>
      <p className="doc-note">{EXCLUDED_NOTE}</p>
      <DocH>อัตราค่าบริการห้องพัก</DocH>
      <div className="doc-tbl"><table>
        <thead><tr><th>รายการ</th><th className="n">ราคารายวัน</th><th className="n">ราคารายเดือน</th><th className="n">โปรโมชัน/เดือน</th></tr></thead>
        <tbody>{ROOMS.map((x) => <tr key={x.name}><td>{x.name}</td><td className="n">{money(x.day)}</td><td className="n">{money(x.month)}</td><td className="n">{money(x.promo)}</td></tr>)}</tbody>
      </table></div>
      <DocH>อัตราค่าบริการเพิ่มเติม</DocH>
      <div className="doc-tbl"><table>
        <thead><tr><th>รายการ</th><th className="n">รายครั้ง</th><th className="n">รายวัน</th><th className="n">รายเดือน</th></tr></thead>
        <tbody>{EXTRA_SERVICES.map((x) => { const c = rateColumns(x); return <tr key={x.code}><td>{x.name}</td><td className="n">{c.once}</td><td className="n">{c.day}</td><td className="n">{c.month}</td></tr>; })}</tbody>
      </table></div>
      <DocH>แพ็กเกจฟื้นฟู</DocH>
      <div className="doc-tbl"><table>
        <thead><tr><th>แพ็กเกจ</th><th className="n">ราคา (บาท)</th></tr></thead>
        <tbody>{PACKAGES.map((x) => <tr key={x.code}><td>{x.name}</td><td className="n">{money(x.rates[0].price)}</td></tr>)}</tbody>
      </table></div>

      {/* หน้า 3: อัตราค่าปรับทรัพย์สิน */}
      <Break />
      {head("สัญญาจ้างดูแลผู้สูงอายุ หรือผู้มีภาวะพึ่งพิง")}
      <DocH>อัตราค่าปรับกรณีทรัพย์สินชำรุด สูญหาย หรือเสียหาย</DocH>
      <div className="doc-tbl"><table>
        <thead><tr><th className="n">ลำดับ</th><th>รายการ</th><th>จำนวน</th><th className="n">อัตราค่าปรับ</th></tr></thead>
        <tbody>{FINES.map(([t, q, n], i) => <tr key={t}><td className="n">{i + 1}</td><td>{t}</td><td>{q}</td><td className="n">{n.toLocaleString("en-US")} บาท</td></tr>)}</tbody>
      </table></div>

      {/* หน้า 4–8: ระเบียบข้อบังคับ */}
      <Break />
      {head("สัญญาจ้างดูแลผู้สูงอายุ หรือผู้มีภาวะพึ่งพิง")}
      <DocH>1. ระเบียบข้อบังคับของทางศูนย์ฯ</DocH>
      {RULES_CENTER.map((x, i) => <Num key={i} n={`1.${i + 1}`}><p>{x}</p></Num>)}

      <Break />
      <DocH>2. ระเบียบข้อบังคับ และเงื่อนไขการใช้บริการทางการเงิน และบัญชี</DocH>
      {RULES_FINANCE_BEFORE.map((x, i) => <Num key={i} n={`2.${i + 1}`}><p>{x}</p></Num>)}
      <Num n="2.3">
        <p>ผู้ที่จะอุปถัมภ์ช่วยสนับสนุนทางด้านการเงินตามที่ได้ตกลงกับศูนย์ฯ มีดังนี้</p>
        {[0, 1].map((k) => (
          <div key={k} className="doc-sponsor">
            <KV items={[
              [`${k + 1}. ชื่อ - นามสกุล`, k ? "" : val(r[3])], ["เลขบัตรประชาชน", k ? "" : idFmt(r[8])],
              ["ที่อยู่", k ? "" : val(r[10]), true], ["เบอร์ติดต่อ", k ? "" : telFmt(r[9])], ["ความสัมพันธ์", k ? "" : val(r[11])],
            ]} />
            <p>ยินดีสนับสนุนด้านการเงินตามอัตราที่ตกลงกันไว้ข้างต้น</p>
            {sign([["ผู้รับผิดชอบอุปถัมภ์ด้านการเงิน", k ? undefined : blank(r[3])]])}
          </div>
        ))}
        <p>ที่อยู่ที่ปรากฏในข้อ 2.3 เป็นที่อยู่ในการจัดส่งสรรพเอกสาร และให้ถือเป็นภูมิลำเนาอีกแห่งหนึ่งของญาติ หรือผู้สนับสนุนด้วย</p>
      </Num>
      {RULES_FINANCE_AFTER.map((x, i) => <Num key={i} n={`2.${i + 4}`}><p>{x}</p></Num>)}
      <Num n={`2.${RULES_FINANCE_AFTER.length + 4}`}><p>ช่องทางการชำระค่าใช้จ่าย</p><ul className="doc-dash">{PAY_CHANNELS.map((x) => <li key={x}>{x}</li>)}</ul></Num>

      <DocH>3. ระเบียบข้อบังคับทางการพยาบาล</DocH>
      {RULES_NURSING.map((x, i) => <Num key={i} n={`3.${i + 1}`}><p>{x}</p></Num>)}
      <Num n={`3.${RULES_NURSING.length + 1}`}>
        <p>ในกรณีที่ผู้รับบริการจำเป็นต้องเข้ารับการรักษา ให้นำส่งโรงพยาบาล <Fill v={r[24]} w="14em" /></p>
        <p>หรือให้นำส่งโรงพยาบาลใกล้เคียงชื่อ <Fill v={r[29]} w="14em" /></p>
        <p>หมายเลขโทรศัพท์ที่สามารถติดต่อได้เร่งด่วนที่สุดในกรณีฉุกเฉิน <Fill v={telFmt(r[9]) === "-" ? "" : telFmt(r[9])} w="9em" /></p>
      </Num>

      <Break />
      <DocH>4. ระเบียบข้อบังคับในการรับบริการทีมฟื้นฟู</DocH>
      {RULES_REHAB.map((x, i) => <Num key={i} n={`4.${i + 1}`}><p>{x}</p>{i === 0 && <ul className="doc-dash">{REHAB_CHECKS.map((c) => <li key={c}>{c}</li>)}</ul>}</Num>)}

      <DocH>5. ระเบียบข้อบังคับกรณีคืนเตียง / การคืนเงิน</DocH>
      {RULES_REFUND.map((x, i) => <Num key={i} n={`5.${i + 1}`}><p>{x}</p></Num>)}
      <Num n="5.3"><p>ทรัพย์สินแรกรับ</p><div className="doc-lines">{[0, 1, 2].map((k) => <span key={k} />)}</div></Num>
      <Num n="5.4"><p>เงื่อนไขอื่น ๆ เพิ่มเติม</p>{extra.length ? <ul className="doc-dash">{extra.map((x, i) => <li key={i}>{x}</li>)}</ul> : <div className="doc-lines">{[0, 1, 2].map((k) => <span key={k} />)}</div>}</Num>
      <p className="doc-indent">{ACCEPT}</p>
      {sign([["ผู้ว่าจ้าง ผู้รับบริการ ญาติ หรือผู้สนับสนุน", blank(r[3])], ["ผู้รับจ้าง หรือผู้แทนบริษัท"], ["พยาน"], ["พยาน"]])}

      {/* หน้า 9: หนังสือยินยอมเปิดเผยข้อมูล */}
      <Break />
      {head("หนังสือแสดงความยินยอมให้เปิดเผยข้อมูลทางการพยาบาล")}
      <Num n="1."><p>ข้าพเจ้า <Fill v={r[3]} w="12em" /> เลขประจำตัวประชาชน <Fill v={idFmt(r[8]) === "-" ? "" : idFmt(r[8])} w="10em" /> ในฐานะผู้ว่าจ้าง ญาติ ผู้สนับสนุน หรือผู้มีอำนาจกระทำแทน เป็นผู้มีอำนาจกระทำแทนผู้รับบริการ เกี่ยวข้องเป็น <Fill v={r[11]} w="5em" /> ของผู้รับบริการ ชื่อ - นามสกุล <Fill v={r[2]} w="12em" /> เลขประจำตัวประชาชน <Fill v={idFmt(r[12]) === "-" ? "" : idFmt(r[12])} w="10em" /></p></Num>
      {CONSENT.map((x, i) => <Num key={i} n={`${i + 2}.`}>{x === "MARKETING" ? <p>ข้าพเจ้า ☐ ไม่ยินยอม ☐ ยินยอม {CONSENT_MARKETING.replace("ให้บริษัท", `ให้${legal}`)}</p> : <p>{x.replace(/บริษัท(?!ฯ)/, legal)}</p>}</Num>)}
      {sign([["ผู้ว่าจ้าง ผู้รับบริการ ญาติ หรือผู้สนับสนุน", blank(r[3])], ["ผู้รับจ้าง หรือผู้แทนบริษัท"], ["พยาน"], ["พยาน"]])}

      {/* หน้า 10: ขั้นตอนไปโรงพยาบาลตามนัด และมาตรการเข้าเยี่ยม */}
      <Break />
      {head("ขั้นตอนการไปโรงพยาบาลตามนัดหมาย")}
      <ol className="doc-clauses">{HOSPITAL_STEPS.map((x) => <li key={x}>{x}</li>)}</ol>
      <DocH>มาตรการการเข้าเยี่ยม</DocH>
      <ol className="doc-clauses">{VISIT_RULES.map((x) => <li key={x}>{x}</li>)}</ol>
      <p className="doc-indent">{VISIT_EFFECTIVE}</p>
      {sign([["ผู้ว่าจ้าง ผู้รับบริการ ญาติ หรือผู้สนับสนุน", blank(r[3])]])}

      {/* หน้า 11: บันทึกการรับเอกสาร */}
      <Break />
      {head("บันทึกการรับเอกสาร")}
      <p>ชื่อ - นามสกุลผู้รับบริการ <Fill v={r[2]} w="16em" /></p>
      <div className="doc-tbl doc-grid"><table>
        <thead><tr><th>วันที่รับ</th><th>รายการเอกสารที่ได้รับ</th><th>หมายเหตุ</th><th>ลงชื่อผู้มอบ</th><th>ลงชื่อผู้รับ</th></tr></thead>
        <tbody>
          {DOC_RECEIPT.map((x) => <tr key={x}><td /><td>☐ {x}</td><td>☐ สำเนาแล้ว ☐ ส่งคืนแล้ว</td><td /><td /></tr>)}
          <tr><td /><td><b>เอกสารอื่น ๆ เพิ่มเติม</b></td><td /><td /><td /></tr>
          {[0, 1, 2, 3, 4, 5].map((k) => <tr key={k}><td>&nbsp;</td><td /><td /><td /><td /></tr>)}
        </tbody>
      </table></div>

      {/* หน้า 12: ตรวจห้องพักและอุปกรณ์ */}
      <Break />
      {head("เอกสารตรวจห้องพักและอุปกรณ์")}
      <p>ชื่อ - นามสกุลผู้รับบริการ <Fill v={r[2]} w="16em" /> {room && <>· {room}</>}</p>
      <div className="doc-tbl doc-grid"><table>
        <thead><tr><th>รายการ</th><th>จำนวน</th><th>ครบ</th><th>ไม่ครบ</th></tr></thead>
        <tbody>{ROOM_CHECK.map(([g, items]) => [
          <tr key={g}><td colSpan={4}><b>{g}</b></td></tr>,
          ...items.map(([t, q]) => <tr key={g + t}><td>&nbsp;&nbsp;{t}</td><td>{q}</td><td /><td /></tr>),
        ])}</tbody>
      </table></div>
      <p className="doc-note" style={{ color: "#b42318" }}>{ROOM_CHECK_NOTE}</p>
      {sign([["ผู้ว่าจ้าง ผู้รับบริการ ญาติ หรือผู้สนับสนุน", blank(r[3])], ["เจ้าหน้าที่ผู้ตรวจ"]])}
      <DocFoot left={`สัญญา ${val(r[0])}`} by={by} />
    </Paper>
  );
}

/* ---------- บันทึกต่อท้ายสัญญา (ต่อสัญญา / เปลี่ยนเงื่อนไข) ---------- */
const DIFF: [number, string][] = [[21, "โปรแกรม"], [7, "วันเริ่มสัญญา"], [22, "วันสิ้นสุดสัญญา"], [6, "ห้องพัก"], [4, "ราคาโปรแกรม"], [23, "รายการค่าบริการ"], [27, "หักมัดจำห้องพัก"], [19, "เงินประกัน"]];
const linesText = (r: string[]) => contractLines(r).map((x) => `${x.desc}${x.price ? ` ${money(svcNet(x))}` : ""}`).join(" · ") || "-";
export function RenewDoc({ before, after, hn, branch, by }: { before: string[]; after: string[]; hn?: string; branch?: DocBranch; by?: string }) {
  const show = (k: number, v?: string, r?: string[]) => (k === 23 && r ? linesText(r) : [7, 22].includes(k) ? (blank(v) ? longDate(v, true) : "-") : [4, 19, 27].includes(k) && numOf(v) ? money(numOf(v)) : val(v));
  const rows = DIFF.filter(([k]) => (k === 23 ? linesText(before) !== linesText(after) : (before[k] ?? "") !== (after[k] ?? "")));
  return (
    <Paper>
      <DocHead branch={branch} refs={[["อ้างอิงสัญญา", val(before[0])], ["สัญญาใหม่", val(after[0]) === "-" ? "รอออกเลข" : after[0]], ["HN", val(hn)]]} />
      <DocTitle title="บันทึกต่อท้ายสัญญาให้บริการ" sub={`การต่อสัญญาและเปลี่ยนแปลงเงื่อนไข · วันที่ ${longDate(after[7])}`} copy="ต้นฉบับ" />
      <p className="doc-indent">ตามที่ <span className="doc-fill">{val(before[3])}</span> (ผู้ว่าจ้าง) ได้ทำสัญญาให้บริการเลขที่ {val(before[0])} ลงวันที่ {longDate(before[7])} สำหรับ <span className="doc-fill">{val(before[2])}</span> คู่สัญญาตกลงต่อสัญญาและเปลี่ยนแปลงเงื่อนไขดังนี้ ส่วนข้อความอื่นในสัญญาเดิมยังคงมีผลบังคับทุกประการ</p>
      <DocH>รายการที่เปลี่ยนแปลง</DocH>
      <div className="doc-tbl"><table>
        <thead><tr><th>หัวข้อ</th><th>เดิม</th><th>ใหม่</th></tr></thead>
        <tbody>{rows.length ? rows.map(([k, t]) => <tr key={k}><td>{t}</td><td>{show(k, before[k], before)}</td><td><b>{show(k, after[k], after)}</b></td></tr>) : <tr><td colSpan={3}>ต่อสัญญาด้วยเงื่อนไขเดิมทุกข้อ</td></tr>}</tbody>
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
export type QuoteItem = { desc: string; qty: number; unit: string; price: number; discount?: number; pct?: number };
export function QuoteDoc({ no, date, validDays, payer, resident, age, chronic, level, items, note, branch, by }: {
  no: string; date: string; validDays: number; payer: string; resident: string; age?: string; chronic?: string; level?: string; items: QuoteItem[]; note?: string; branch?: DocBranch; by?: string;
}) {
  const total = items.reduce((n, i) => n + svcNet(i), 0);
  const disc = items.some((i) => svcDiscount(i));
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
        <thead><tr><th>รายการ</th><th className="n">จำนวน</th><th className="n">ราคา/หน่วย</th>{disc && <th className="n">ส่วนลด</th>}<th className="n">รวม (บาท)</th></tr></thead>
        <tbody>{items.map((i, k) => <tr key={k}><td>{i.desc}</td><td className="n">{i.qty} {i.unit}</td><td className="n">{money(i.price)}</td>{disc && <td className="n">{svcDiscount(i) ? `${i.pct ? `${i.pct}% · ` : ""}${money(svcDiscount(i))}` : "-"}</td>}<td className="n">{money(svcNet(i))}</td></tr>)}</tbody>
        <tfoot><tr><td colSpan={disc ? 4 : 3}>รวมทั้งสิ้น ({bahtText(total)})</td><td className="n">{money(total)}</td></tr></tfoot>
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
