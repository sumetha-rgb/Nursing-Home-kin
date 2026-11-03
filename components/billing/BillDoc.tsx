"use client";
import { bahtText, BillItem, docDate, Invoice, lineAmount, lineDiscount, money, PAID, PARTIAL, parseItems, Payment, vatOf } from "@/lib/billing";
import { COMPANY } from "../ui";

export type Branch = { name: string; legal: string; address: string; phone: string };
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
export default function BillDoc({ inv, branch, format, copy, slips = [], payment, printedBy }: {
  inv: Invoice; branch: Branch; format: DocFormat; copy: boolean; slips?: Payment[]; payment?: Payment; printedBy: string;
}) {
  // payment = ใบรับเงินของงวดนั้น · ไม่มี = ใบรวมของทั้งเอกสาร
  const partial = !payment && inv.status === PARTIAL;
  const paid = inv.status === PAID || inv.status === PARTIAL || !!payment;
  const full = payment ? payment.paidBefore + payment.amount >= inv.net - 0.005 : inv.status === PAID;
  const RECEIPT = ["ใบเสร็จรับเงิน / ใบกำกับภาษี", "RECEIPT / TAX INVOICE"];
  const title = payment ? (full ? RECEIPT : [`ใบรับเงิน (งวดที่ ${payment.n})`, "RECEIPT"]) : full ? RECEIPT : partial ? ["ใบแจ้งหนี้ (ชำระบางส่วน)", "INVOICE"] : ["ใบแจ้งหนี้", "INVOICE"];
  const items = parseItems(inv.items);
  const tax = vatOf(items);
  // มัดจำห้องที่จ่ายตอนจอง (ใบแรกเข้าจากสัญญาเขียนไว้ในหมายเหตุ) · ใช้บอกว่าส่วนลดของบรรทัดค่าห้องคือการหักมัดจำ
  const roomDep = Number((inv.note ?? "").match(/หักมัดจำห้องพัก[^0-9]*([\d,]+(?:\.\d+)?)/)?.[1]?.replace(/,/g, "")) || 0;
  const discNote = (i: BillItem) => {
    const d = lineDiscount(i);
    if (!d) return null;
    const dep = roomDep && /ห้อง|room/i.test(i.desc) && d >= roomDep ? roomDep : 0;
    const parts = [dep ? `หักมัดจำห้องพัก ${money(dep)}` : "", d - dep > 0 ? `ส่วนลด${i.pct ? ` ${i.pct}%` : ""} ${money(d - dep)}` : ""].filter(Boolean).join(" · ");
    return <small className="bill-disc">{parts} · คงเหลือ {money(lineAmount(i) - d)}</small>;
  };
  const legal = branch.legal || COMPANY.th;
  const m = payment ?? { cash: inv.cash, credit: inv.credit, transfer: inv.transfer };
  const methods = [["เงินสด", "Cash", m.cash], ["บัตรเครดิต", "Credit", m.credit], ["โอนเงิน", "Transfer", m.transfer]] as const;
  const date = docDate(payment ? payment.date : full ? inv.paidDate || inv.date : inv.date);
  const cashier = payment?.cashier || inv.cashier || printedBy;
  // ยอดที่รับในใบนี้ / สะสม / คงเหลือ (ใช้กับใบรับเงินรายงวดและใบที่ยังไม่ครบ)
  const thisAmt = payment?.amount ?? 0;
  const paidTo = payment ? payment.paidBefore + payment.amount : inv.paid ?? 0;
  const owe = Math.max(0, Math.round((inv.net - paidTo) * 100) / 100);
  const showBal = !!payment || partial;

  const attach = <>
    {slips.map((p) => <div className="bill-slip" key={p.id}>
      <p className="bill-slip-title">เอกสารแนบ: หลักฐานการโอนเงิน (Payment slip){slips.length > 1 || payment ? ` งวดที่ ${p.n}` : ""} — {inv.no}</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={p.slip ?? ""} alt="หลักฐานการโอนเงิน" />
      {p.slipAt && <p className="bill-slip-at">แนบเมื่อ {p.slipAt}</p>}
    </div>)}
  </>;

  if (format === "finance") return (
    <div className="bill-doc">
      <p className="bill-part">ส่วนที่ 2 สำหรับฝ่ายการเงิน / บัญชี</p>
      <div className="bill-frame">
        <div className="bill-head2">
          <div className="flex gap-4">
            <Logo />
            <div className="bill-company"><b>{legal}</b><span>{branch.address}</span><span>โทร {branch.phone}</span></div>
          </div>
          <dl className="bill-meta">
            <dt>วันที่ / Date :</dt><dd>{date}</dd>
            <dt>เลขที่เอกสาร / Document No :</dt><dd>{inv.no ?? "-"}</dd>
            <dt>ชื่อผู้ชำระ / Name :</dt><dd>{inv.payer || "-"}</dd>
            <dt>รหัสผู้รับบริการ :</dt><dd>{inv.hn || "-"}</dd>
            <dt>เลขที่เคส :</dt><dd>{inv.contract || inv.hn || "-"}</dd>
            <dt>ที่อยู่ :</dt><dd className="whitespace-pre-line">{inv.address || "-"}</dd>
          </dl>
          <div className="bill-title2"><b>{title[0]} / {title[1]}</b><span>{copy ? "สำเนา / COPY" : "ต้นฉบับ / ORIGINAL"}</span></div>
        </div>
        <table className="bill-table bill-table2">
          <thead><tr><th>ลำดับ<br />NO.</th><th>รายการ<br />DESCRIPTION</th><th>จำนวนเงิน<br />AMOUNT</th><th>ส่วนลด<br />DISCOUNT</th><th>VAT</th><th>คงเหลือ<br />NET AMOUNT</th></tr></thead>
          <tbody>
            {items.map((i, k) => <tr key={k}><td>{k + 1}</td><td>{i.desc}{i.qty !== 1 ? ` · ${i.qty} หน่วย` : ""}{inv.who ? ` — ผู้รับบริการ: ${inv.who}` : ""}</td><td>{money(lineAmount(i))}</td><td>{money(lineDiscount(i))}{i.pct ? <small> ({i.pct}%{i.discount ? ` + ${money(i.discount)}` : ""})</small> : null}</td><td className="bill-vat-col">{i.vat ? `${i.vat}%` : "-"}</td><td>{money(lineAmount(i) - lineDiscount(i))}</td></tr>)}
            <tr className="bill-filler"><td /><td /><td /><td /><td /><td /></tr>
            {tax.vat > 0 && <>
              <tr className="bill-vat-row"><td /><td>มูลค่าที่เสียภาษีมูลค่าเพิ่ม (ก่อน VAT) / VATABLE AMOUNT</td><td /><td /><td /><td>{money(tax.base)}</td></tr>
              {tax.rates.map((x) => <tr key={x.rate} className="bill-vat-row"><td /><td>ภาษีมูลค่าเพิ่ม {x.rate}% / VAT {x.rate}%</td><td /><td /><td /><td>{money(x.vat)}</td></tr>)}
              {tax.exempt > 0 && <tr className="bill-vat-row"><td /><td>มูลค่าที่ไม่มีภาษีมูลค่าเพิ่ม / NON-VAT AMOUNT</td><td /><td /><td /><td>{money(tax.exempt)}</td></tr>}
              <tr className="bill-vat-row"><td /><td><b>รวมทั้งสิ้น (รวม VAT) / GRAND TOTAL</b></td><td /><td /><td /><td><b>{money(inv.net)}</b></td></tr>
            </>}
          </tbody>
        </table>
        <div className="bill-sum2">
          <div><small>จำนวนเงิน / TOTAL AMOUNT IN LETTERS</small><b>{bahtText(payment ? thisAmt : inv.net)}</b></div>
          <div><small>{payment ? "รับครั้งนี้ / THIS PAYMENT" : "รวมทั้งสิ้น / TOTAL"}</small><b>{money(payment ? thisAmt : inv.net)}</b>{showBal && <small>สะสม {money(paidTo)} · คงเหลือ {money(owe)}</small>}</div>
        </div>
        <div className="bill-pay2">
          <span>วิธีการชำระ :</span>
          {methods.map(([th, en, v]) => <span key={en}>{box(paid && !!v)} {th}<small>{en}{paid && v ? ` - ${money(v)} บาท` : ""}</small></span>)}
        </div>
        <div className="bill-sign2">
          <div><p>{inv.payer}</p><span>ชื่อผู้รับบริการ (CLIENT&apos;S SIGNATURE)</span></div>
          <div className="bill-seal">ตราประทับบริษัท</div>
          <div><p>{cashier}</p><span>เจ้าหน้าที่การเงิน (CASHIER)</span></div>
        </div>
      </div>
      {attach}
    </div>
  );

  return (
    <div className="bill-doc">
      <div className="bill-head">
        <Logo />
        <h2>{title[0].includes("/") ? title[0] : `${title[0]} /${title[1][0] + title[1].slice(1).toLowerCase()}`}</h2>
        <b>{copy ? "สำเนา" : "ต้นฉบับ"}</b>
        <p>{legal}</p>
        <p>{branch.address}</p>
        <p>Tel. {branch.phone}</p>
      </div>
      <div className="bill-who">
        <div><p>รหัสผู้รับบริการ : <b>{inv.hn || "-"}</b></p><p>ชื่อผู้รับบริการ : {inv.who}</p></div>
        <div className="text-right"><p>Bill No: <b>{inv.no ?? "-"}</b></p><p>วันที่ /Date : {date}</p></div>
      </div>
      <table className="bill-table">
        <thead><tr><th>No.</th><th>รายการ (Description)</th><th>จำนวน (Qty)</th><th>VAT</th><th>จำนวนเงิน (Amount)</th></tr></thead>
        <tbody>
          {items.map((i, k) => <tr key={k}><td>{k + 1}</td><td>{i.desc}{inv.who ? ` — ผู้รับบริการ: ${inv.who}` : ""}{discNote(i)}</td><td>{i.qty}</td><td className="bill-vat-col">{i.vat ? `${i.vat}%` : "-"}</td><td>{money(lineAmount(i))}</td></tr>)}
          <tr><td colSpan={4}>ยอดรวมทั้งสิ้น/Total</td><td>{money(inv.total)}</td></tr>
          <tr><td colSpan={4}>ส่วนลดที่ได้รับ/Discount</td><td>{money(inv.discount)}</td></tr>
          <tr><td colSpan={4}>รวมเงิน(หลังหักส่วนลด)/Sub Total</td><td>{money(inv.total - inv.discount)}</td></tr>
          {tax.vat > 0 && <>
            <tr><td colSpan={4}>มูลค่าที่เสียภาษีมูลค่าเพิ่ม (ก่อน VAT)/Vatable Amount</td><td>{money(tax.base)}</td></tr>
            {tax.rates.map((x) => <tr key={x.rate}><td colSpan={4}>ภาษีมูลค่าเพิ่ม {x.rate}%/VAT {x.rate}%</td><td>{money(x.vat)}</td></tr>)}
            {tax.exempt > 0 && <tr><td colSpan={4}>มูลค่าที่ไม่มีภาษีมูลค่าเพิ่ม/Non-VAT Amount</td><td>{money(tax.exempt)}</td></tr>}
            <tr><td colSpan={4}><b>รวมทั้งสิ้น (รวม VAT)/Grand Total</b></td><td><b>{money(inv.net)}</b></td></tr>
          </>}
          {showBal ? <>
            {payment && <tr><td colSpan={4}>รับชำระครั้งนี้ (งวดที่ {payment.n})/This payment</td><td><b>{money(thisAmt)}</b></td></tr>}
            <tr><td colSpan={4}>ชำระสะสม/Paid to date</td><td>{money(paidTo)}</td></tr>
            <tr><td colSpan={4}>{owe > 0 ? "ยอดคงเหลือที่ต้องชำระ/Balance Due" : "ยอดคงเหลือ/Balance"}</td><td><b>{money(owe)}</b></td></tr>
            <tr><td colSpan={5} className="bill-words">( {bahtText(payment ? thisAmt : owe)} )</td></tr>
          </> : <>
            <tr><td colSpan={4}>{paid ? "รับชำระแล้ว/Paid" : "ยอดที่ต้องชำระ/Amount Due"}</td><td><b>{money(inv.net)}</b></td></tr>
            <tr><td colSpan={5} className="bill-words">( {bahtText(inv.net)} )</td></tr>
          </>}
        </tbody>
      </table>
      {paid && <div className="bill-pay2 bill-pay-cust">
        <span>วิธีการชำระ :</span>
        {methods.map(([th, en, v]) => <span key={en}>{box(!!v)} {th}<small>{en}{v ? ` - ${money(v)} บาท` : ""}</small></span>)}
      </div>}
      <p className="bill-line">{paid ? "ได้รับเงินจาก (Received from)" : "เรียกเก็บจาก (Bill to)"} คุณ {inv.payer || "-"}</p>
      <p className="bill-line">หมายเหตุ : {inv.note}</p>
      <div className="bill-sign">
        <p><span>ผู้จ่ายเงิน</span>(...................................................)</p><p className="bill-sign-name">( คุณ {inv.payer || "........................"} )</p>
        <p><span>ผู้ออกเอกสาร / ผู้รับชำระเงิน</span>(...................................................)</p><p className="bill-sign-name">( {cashier} )</p>
      </div>
    </div>
  );
}
