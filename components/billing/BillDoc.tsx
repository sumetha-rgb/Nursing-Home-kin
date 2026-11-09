"use client";
import { ReactNode, useEffect, useRef } from "react";
import { bahtText, creditOf, docDate, Invoice, isCN, lineAmount, lineDiscount, money, PAID, PARTIAL, parseItems, Payment, vatOf } from "@/lib/billing";
import { COMPANY } from "../ui";
import { taxIdText } from "@/lib/taxInfo";
import { lineCode } from "@/lib/priceList";
import { usePriceList } from "@/lib/usePrices";

/** taxId / office = ข้อมูลผู้ขายในใบกำกับภาษี (ตั้งที่ปุ่ม "ข้อมูลผู้เสียภาษี" หน้าใบแจ้งหนี้และใบเสร็จ) */
export type Branch = { name: string; legal: string; address: string; phone: string; taxId?: string; office?: string };
export type DocFormat = "customer" | "finance";

const box = (on: boolean) => (on ? "☑" : "☐");

function Logo() {
  return <div className="bill-logo"><img src="/logo-mark.png" alt="" /><span>KIN<small>REHABILITATION &amp; HOMECARE</small></span></div>;
}

/**
 * เอกสารการเงินตามแบบของศูนย์
 *  customer : ใบเสร็จ/ใบแจ้งหนี้ให้ผู้ชำระ (หัวกระดาษกลาง + ช่องลงชื่อผู้จ่ายเงิน/ผู้รับชำระ) แนบหลักฐานการโอนหน้าถัดไป
 *  finance  : ส่วนที่ 2 สำหรับฝ่ายการเงิน/บัญชี (กรอบเดียว + ส่วนลดรายบรรทัด + ตราประทับ)
 */
export default function BillDoc({ inv, branch, format, copy, slips = [], payment, printedBy, pays = [] }: {
  inv: Invoice; branch: Branch; format: DocFormat; copy: boolean; slips?: Payment[]; payment?: Payment; printedBy: string; pays?: Payment[];
}) {
  /*
   * payment = ใบเสร็จของงวดนั้น · ไม่มี = เอกสารรวมของทั้งใบ
   * ใบกำกับภาษีออกทุกครั้งที่รับเงิน (ค่าบริการถึงกำหนดเสีย VAT เมื่อได้รับชำระ):
   *  รับครั้งเดียวครบ = ใบเสร็จรับเงิน / ใบกำกับภาษี ใบเดียว เลขที่เดียวกับใบแจ้งหนี้
   *  รับหลายงวด = ใบกำกับภาษีแยกตามงวด เลขที่ "เลขใบ-งวด" แจกแจง VAT ตามสัดส่วนของยอดที่รับ · เอกสารรวมเป็น "สรุปการชำระ" (ไม่ใช่ใบกำกับภาษี)
   * ใบลดหนี้ (CREDIT NOTE) อ้างอิงใบเดิม · ภาษีหัก ณ ที่จ่าย ตัดยอดค้างแต่ไม่ใช่เงินที่รับ
   */
  const cn = isCN(inv);
  const real = pays.filter((p) => p.kind !== "credit");
  const payN = payment ? real.findIndex((p) => p.id === payment.id) + 1 || payment.n : 0;
  const singleFull = real.length <= 1 && (payment ? payment.amount >= inv.net - 0.005 : inv.status === PAID);
  const partial = !payment && inv.status === PARTIAL;
  const paid = !cn && (inv.status === PAID || inv.status === PARTIAL || !!payment);
  const full = !payment && inv.status === PAID;
  usePriceList();
  const items = parseItems(inv.items);
  const invTax = vatOf(items), hasVat = invTax.vat > 0;
  const RECEIPT = hasVat ? ["ใบเสร็จรับเงิน / ใบกำกับภาษี", "RECEIPT / TAX INVOICE"] : ["ใบเสร็จรับเงิน", "RECEIPT"];
  const title = cn ? ["ใบลดหนี้", "CREDIT NOTE"]
    : payment ? (singleFull ? RECEIPT : [`${RECEIPT[0]} (งวดที่ ${payN})`, RECEIPT[1]])
    : full ? (singleFull ? RECEIPT : ["ใบเสร็จรับเงิน (สรุปการชำระ)", "RECEIPT SUMMARY"]) : partial ? ["ใบแจ้งหนี้ (ชำระบางส่วน)", "INVOICE"] : ["ใบแจ้งหนี้", "INVOICE"];
  const docNo = payment && !singleFull ? `${inv.no ?? "-"}-${payN}` : inv.no ?? "-";
  // ใบเสร็จรายงวด: ตารางรายการแสดงยอดเต็มของใบ ส่วน VAT แจกแจงเฉพาะยอดของงวดนี้ (ด้านล่าง)
  const tax = vatOf(payment ? [] : items);
  // บรรทัดหักเงินที่รับไว้แล้ว (มัดจำห้องตอนจอง) แสดงใต้ยอดรวม VAT ไม่ใช่ในรายการสินค้า/บริการ
  const sale = items.filter((i) => !i.credit), credits = items.filter((i) => i.credit), credit = creditOf(items);
  const grand = Math.round((inv.net + credit) * 100) / 100;
  const legal = branch.legal || COMPANY.th;
  // ผู้ขายในใบกำกับภาษี: ออกในนามสำนักงานใหญ่ของบริษัท = พิมพ์ที่อยู่จดทะเบียน (ตามทะเบียนสรรพากร)
  // สาขาที่ให้บริการจริงอยู่คนละที่ → แสดงชื่อสาขา ที่อยู่ และเบอร์สาขาอีกบรรทัด ให้ลูกค้ารู้ว่ารับบริการที่ไหน
  const sellerAddr = branch.office === "สำนักงานใหญ่" && legal === COMPANY.th ? COMPANY.address : branch.address;
  const atSite = branch.address !== sellerAddr;
  const m = payment ?? { cash: inv.cash, credit: inv.credit, transfer: inv.transfer };
  const methods = [["เงินสด", "Cash", m.cash], ["บัตรเครดิต", "Credit", m.credit], ["โอนเงิน", "Transfer", m.transfer]] as const;
  const date = docDate(payment ? payment.date : full ? inv.paidDate || inv.date : inv.date);
  const cashier = payment?.cashier || inv.cashier || printedBy;
  // ยอดที่รับในใบนี้ / สะสม / คงเหลือ (ใช้กับใบรับเงินรายงวดและใบที่ยังไม่ครบ)
  const thisAmt = payment?.amount ?? 0;
  /** ภาษีหัก ณ ที่จ่าย ของงวดนี้ / ของทั้งใบ · เงินที่รับจริง = ยอดที่ตัด − ภาษีหัก ณ ที่จ่าย */
  const wht = payment ? payment.wht ?? 0 : real.reduce((n, p) => n + (p.wht ?? 0), 0);
  const got = Math.round(((payment ? thisAmt : real.reduce((n, p) => n + p.amount, 0)) - wht) * 100) / 100;
  /** VAT ของยอดที่รับในงวดนี้ ตามสัดส่วนของใบ (ก่อน VAT / VAT / ไม่มี VAT) */
  const share = (v: number) => Math.round(((thisAmt * v) / (invTax.base + invTax.vat + invTax.exempt || 1)) * 100) / 100;
  const payVat = payment && hasVat ? { base: share(invTax.base), vat: share(invTax.vat), exempt: Math.round((thisAmt - share(invTax.base) - share(invTax.vat)) * 100) / 100 } : null;
  const paidTo = payment ? payment.paidBefore + payment.amount : inv.paid ?? 0;
  const owe = Math.max(0, Math.round((inv.net - paidTo) * 100) / 100);
  const showBal = !!payment || partial;
  // พิมพ์ให้จบใน A4 แผ่นเดียว: ก่อนพิมพ์วัดความสูงที่ความกว้างกระดาษ ถ้าเกินพื้นที่พิมพ์ (A4 หักขอบ) ย่อทั้งหน้าลงพอดี · สลิปแนบอยู่หน้าถัดไปตามเดิม
  const pageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    const fit = () => {
      el.style.zoom = ""; el.style.width = "182mm";
      const mm = 96 / 25.4, h = el.scrollHeight, avail = 262 * mm;
      el.style.width = "";
      el.style.zoom = h > avail ? String(Math.max(0.6, avail / h)) : "";
    };
    const reset = () => { el.style.zoom = ""; };
    window.addEventListener("beforeprint", fit); window.addEventListener("afterprint", reset);
    return () => { window.removeEventListener("beforeprint", fit); window.removeEventListener("afterprint", reset); };
  }, []);

  const attach = <>
    {slips.map((p) => <div className="bill-slip" key={p.id}>
      <p className="bill-slip-title">เอกสารแนบ: หลักฐานการโอนเงิน (Payment slip){slips.length > 1 || payment ? ` งวดที่ ${p.n}` : ""} — {inv.no}</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={p.slip ?? ""} alt="หลักฐานการโอนเงิน" />
      {p.slipAt && <p className="bill-slip-at">แนบเมื่อ {p.slipAt}</p>}
    </div>)}
  </>;

  // ทั้งสองแบบใช้กรอบเดียวกัน · สำหรับผู้ชำระ: ซ่อนคอลัมน์ส่วนลด/VAT ที่ไม่มี แสดงยอดสะสม/คงเหลือของการชำระเป็นงวด และหมายเหตุ
  const cust = format === "customer";
  const anyDisc = sale.some((i) => lineDiscount(i) > 0), anyVat = sale.some((i) => i.vat);
  const colDisc = !cust || anyDisc, colVat = !payment && (!cust || anyVat);
  // รหัสจากหน้าราคา: เฉพาะใบฝ่ายการเงิน (คอลัมน์ "รหัส") · ใบที่ให้ผู้ชำระไม่แสดงรหัส
  const colCode = !cust;
  const cols = [["ลำดับ", "NO."], ...(colCode ? [["รหัส", "CODE"]] : []), ["รายการ", "DESCRIPTION"], ...(colDisc ? [["จำนวนเงิน", "AMOUNT"], ["ส่วนลด", "DISCOUNT"]] : []), ...(colVat ? [["VAT", ""]] : []), [colDisc ? "คงเหลือ" : "จำนวนเงิน", colDisc ? "NET AMOUNT" : "AMOUNT"]];
  const lead = colCode ? 2 : 1, blank = cols.length - lead - 1;
  /** แถวสรุปใต้รายการ: ข้อความอยู่ช่องรายการ ยอดอยู่ช่องขวาสุด */
  const sumRow = (key: string, label: ReactNode, v: ReactNode) => <tr key={key} className="bill-vat-row">{Array.from({ length: lead }, (_, k) => <td key={`l${k}`} />)}<td className="bill-desc">{label}</td>{Array.from({ length: blank - 1 }, (_, k) => <td key={k} />)}<td>{v}</td></tr>;
  return (
    <div className="bill-doc"><div className="bill-page" ref={pageRef}>
      {!cust && <p className="bill-part">ส่วนที่ 2 สำหรับฝ่ายการเงิน / บัญชี</p>}
      <div className="bill-frame">
        <div className="bill-head2">
          <div className="flex gap-4">
            <Logo />
            <div className="bill-company"><b>{legal}{branch.office ? ` (${branch.office})` : ""}</b><span>{sellerAddr}</span>{!atSite && <span>โทร {branch.phone}</span>}{branch.taxId && <span>เลขประจำตัวผู้เสียภาษี {taxIdText(branch.taxId)}</span>}
              {atSite && <span className="bill-site">สถานที่ให้บริการ: สาขา{branch.name}{branch.address ? ` · ${branch.address}` : ""}{branch.phone ? ` · โทร ${branch.phone}` : ""}</span>}</div>
          </div>
          <dl className="bill-meta">
            <dt>วันที่ / Date :</dt><dd>{date}</dd>
            <dt>เลขที่เอกสาร / Document No :</dt><dd>{docNo}</dd>
            {cn && <><dt>อ้างอิงเอกสาร / Ref. :</dt><dd>{inv.ref || "-"}</dd></>}
            <dt>ชื่อผู้ชำระ / Name :</dt><dd>{inv.payer || "-"}</dd>
            <dt>รหัสผู้รับบริการ :</dt><dd>{inv.hn || "-"}</dd>
            <dt>ผู้รับบริการ :</dt><dd>{inv.who || "-"}</dd>
            <dt>เลขที่สัญญา :</dt><dd>{inv.contract || "-"}</dd>
            <dt>ที่อยู่ :</dt><dd className="whitespace-pre-line">{inv.address || "-"}</dd>
            {inv.payerTaxId?.replace(/\D/g, "") && <><dt>เลขผู้เสียภาษี / Tax ID :</dt><dd>{taxIdText(inv.payerTaxId)}{inv.payerBranch ? ` (${inv.payerBranch})` : ""}</dd></>}
          </dl>
          <div className="bill-title2"><b>{title[0]}</b><small>{title[1]}</small><span>{copy ? "สำเนา / COPY" : "ต้นฉบับ / ORIGINAL"}</span></div>
        </div>
        <table className="bill-table bill-table2">
          <thead><tr>{cols.map(([th, en]) => <th key={th}>{th}{en && <><br />{en}</>}</th>)}</tr></thead>
          <tbody>
            {sale.map((i, k) => <tr key={k}>
              <td>{k + 1}</td>{colCode && <td className="bill-code-col">{lineCode(i)}</td>}<td className="bill-desc">{i.desc}{i.qty !== 1 ? ` · ${i.qty} หน่วย` : ""}</td>
              {colDisc && <><td>{money(lineAmount(i))}</td><td>{lineDiscount(i) ? money(lineDiscount(i)) : "-"}{i.pct ? <small> ({i.pct}%{i.discount ? ` + ${money(i.discount)}` : ""})</small> : null}</td></>}
              {colVat && <td className="bill-vat-col">{i.vat ? `${i.vat}%` : "-"}</td>}
              <td>{money(lineAmount(i) - lineDiscount(i))}</td>
            </tr>)}
            <tr className="bill-filler">{cols.map(([th], c) => <td key={th} className={c === lead ? "bill-desc" : colCode && c === 1 ? "bill-code-col" : undefined} />)}</tr>
            {tax.vat > 0 && <>
              {sumRow("base", "มูลค่าที่เสียภาษีมูลค่าเพิ่ม (ก่อน VAT) / VATABLE AMOUNT", money(tax.base))}
              {tax.rates.map((x) => sumRow(`v${x.rate}`, `ภาษีมูลค่าเพิ่ม ${x.rate}% / VAT ${x.rate}%`, money(x.vat)))}
              {tax.exempt > 0 && sumRow("ex", "มูลค่าที่ไม่มีภาษีมูลค่าเพิ่ม / NON-VAT AMOUNT", money(tax.exempt))}
              {sumRow("grand", <b>รวมทั้งสิ้น (รวม VAT) / GRAND TOTAL</b>, <b>{money(grand)}</b>)}
            </>}
            {payVat && <>
              {sumRow("pb", "มูลค่าที่เสียภาษีของงวดนี้ (ก่อน VAT) / VATABLE AMOUNT", money(payVat.base))}
              {sumRow("pv", `ภาษีมูลค่าเพิ่มของงวดนี้ / VAT`, money(payVat.vat))}
              {payVat.exempt > 0.005 && sumRow("pe", "มูลค่าที่ไม่มีภาษีมูลค่าเพิ่มของงวดนี้ / NON-VAT", money(payVat.exempt))}
            </>}
            {credits.map((c, k) => sumRow(`c${k}`, `${c.desc} / LESS: AMOUNT RECEIVED`, `-${money(c.qty * c.price)}`))}
            {credit > 0 && sumRow("due", <b>ยอดที่ต้องชำระ / AMOUNT DUE</b>, <b>{money(inv.net)}</b>)}
            {wht > 0 && <>
              {sumRow("wht", "หักภาษี ณ ที่จ่าย / WITHHOLDING TAX", `-${money(wht)}`)}
              {sumRow("got", <b>รับเงินสุทธิ / NET RECEIVED</b>, <b>{money(got)}</b>)}
            </>}
            {cust && showBal && <>
              {payment && sumRow("this", <b>ชำระครั้งนี้{singleFull ? "" : ` (งวดที่ ${payN})`} / THIS PAYMENT</b>, <b>{money(thisAmt)}</b>)}
              {sumRow("todate", "ชำระสะสม / PAID TO DATE", money(paidTo))}
              {sumRow("owe", <b>{owe > 0 ? "คงเหลือที่ต้องชำระ / BALANCE DUE" : "คงเหลือ / BALANCE"}</b>, <b>{money(owe)}</b>)}
            </>}
          </tbody>
        </table>
        <div className="bill-sum2">
          <div><small>จำนวนเงิน / TOTAL AMOUNT IN LETTERS</small><b>{bahtText(payment ? thisAmt : inv.net)}</b></div>
          <div><small>{cn ? "มูลค่าที่ลดลงรวม / CREDIT AMOUNT" : payment ? "ชำระครั้งนี้ / THIS PAYMENT" : paid && full ? "รับชำระแล้ว / PAID" : "รวมทั้งสิ้น / TOTAL"}</small><b>{money(payment ? thisAmt : inv.net)}</b>{showBal && <small>สะสม {money(paidTo)} · คงเหลือ {money(owe)}</small>}</div>
        </div>
        {full && !singleFull && hasVat && cust && <p className="bill-note2"><span>ใบกำกับภาษี :</span> ออกแยกตามงวดที่รับเงิน เลขที่ {real.map((_, k) => `${inv.no}-${k + 1}`).join(", ")}</p>}
        {!cn && <div className="bill-pay2">
          <span>วิธีการชำระ :</span>
          {methods.map(([th, en, v]) => <span key={en}>{box(paid && !!v)} {th}<small>{en}{paid && v ? ` - ${money(v)} บาท` : ""}</small></span>)}
        </div>}
        {cust && inv.note && <p className="bill-note2"><span>หมายเหตุ / NOTE :</span> {inv.note}</p>}
        <div className="bill-sign2">
          <div><p>{inv.payer}</p><span>{cust ? "ผู้จ่ายเงิน (PAYER'S SIGNATURE)" : "ชื่อผู้รับบริการ (CLIENT'S SIGNATURE)"}</span></div>
          <div className="bill-seal">ตราประทับบริษัท</div>
          <div><p>{cashier}</p><span>{cn ? "ผู้อนุมัติ (AUTHORIZED)" : cust && paid ? "ผู้รับเงิน (COLLECTOR)" : "เจ้าหน้าที่การเงิน (CASHIER)"}</span></div>
        </div>
      </div>
      </div>
      {attach}
    </div>
  );
}
