"use client";
import { ReactNode } from "react";
import Icon from "../Icon";
import { Modal, StatusBadge } from "../ui";
import { contractVat, money, svcNet } from "@/lib/billing";
import { isNoAllergy } from "@/lib/medicalLists";
import { contractLines, contractRoomTitle, longDate } from "../print/Docs";
import { contractMonthTotal, prepaidMonths } from "./Billing";

const has = (v?: string | null) => !!v && v.trim() !== "" && v.trim() !== "-";
const num = (v?: string | null) => Number(String(v ?? "").replace(/,/g, "")) || 0;
const idFmt = (v?: string | null) => { const s = String(v ?? "").replace(/\D/g, ""); return s.length === 13 ? `${s[0]}-${s.slice(1, 5)}-${s.slice(5, 10)}-${s.slice(10, 12)}-${s[12]}` : has(v) ? v! : "-"; };
const telFmt = (v?: string | null) => { const s = String(v ?? "").replace(/\D/g, ""); return s.length === 10 ? `${s.slice(0, 3)}-${s.slice(3, 6)}-${s.slice(6)}` : has(v) ? v! : "-"; };

/** กลุ่มข้อมูลแบบอ่าน (หัวข้อ + รายการ ป้าย/ค่า 2 คอลัมน์) · ใช้กับหน้ารายละเอียดอื่นได้ */
export function Group({ title, children }: { title: string; children: ReactNode }) {
  return <section className="cv-group"><h4>{title}</h4><dl>{children}</dl></section>;
}
export function Item({ k, v, wide }: { k: string; v: ReactNode; wide?: boolean }) {
  return <div className={wide ? "cv-wide" : ""}><dt>{k}</dt><dd>{v === "" || v === undefined || v === null ? "-" : v}</dd></div>;
}

/**
 * รายละเอียดสัญญาแบบอ่าน: หัวสรุป (เลขที่ สถานะ ผู้รับบริการ ห้อง) แล้วแยกกลุ่ม ผู้รับบริการ / ผู้ว่าจ้าง / ค่าใช้จ่าย
 *  ปุ่มทำต่อ (แก้ไข พิมพ์ ออกใบแจ้งหนี้) อยู่ท้ายหน้าต่าง
 */
export default function ContractView({ r, onClose, onEdit, onPrint, onBill }: {
  r: string[] | null; onClose: () => void; onEdit: () => void; onPrint: () => void; onBill?: () => void;
}) {
  const lines = r ? contractLines(r) : [];
  const fee = r ? num(r[4]) : 0, rate = r ? contractVat(r) : 0, vat = Math.round(fee * rate) / 100;
  const monthly = r ? contractMonthTotal(r) : 0, months = r ? prepaidMonths(r) : 1;
  return (
    <Modal open={!!r} wide title="รายละเอียดสัญญา" onClose={onClose}
      footer={<>
        <button className="btn-soft" onClick={onEdit}><Icon name="doc" className="h-4 w-4" /> แก้ไข</button>
        <button className="btn-soft" onClick={onPrint}><Icon name="print" className="h-4 w-4" /> พิมพ์สัญญา</button>
        {onBill && <button className="btn-soft" onClick={onBill}><Icon name="receipt" className="h-4 w-4" /> ออกใบแจ้งหนี้</button>}
        <button className="btn-primary" onClick={onClose}>ปิด</button>
      </>}>
      {r && <div className="space-y-5">
        <div className="cv-head">
          <div className="min-w-0">
            <p className="text-xs text-gold-500">{r[0] || "กำลังออกเลข"} · สาขา{r[1]}</p>
            <h3 className="truncate text-lg font-semibold text-gold-900">{r[2]}</h3>
            <p className="text-sm text-gold-600">ห้อง {has(r[6]) ? r[6] : "ยังไม่ระบุ"} · เริ่ม {longDate(r[7], true)}{has(r[22]) ? ` ถึง ${longDate(r[22], true)}` : ""}</p>
          </div>
          <div className="text-right">
            <StatusBadge value={r[5]} />
            <p className="mt-2 text-xs text-gold-500">ค่าบริการต่อเดือน</p>
            <p className="text-xl font-semibold tabular-nums text-gold-900">{money(monthly)} <small className="text-xs font-normal text-gold-500">บาท</small></p>
          </div>
        </div>

        <Group title="ผู้รับบริการ">
          <Item k="ชื่อ - นามสกุล" v={r[2]} />
          <Item k="อายุ" v={has(r[13]) ? `${r[13]} ปี` : "-"} />
          <Item k="เลขบัตรประชาชน" v={idFmt(r[12])} />
          <Item k="โรงพยาบาลตามสิทธิ์" v={[r[24], r[29]].filter(has).join(" · สำรอง ")} />
          <Item k="แพ้ยา" v={isNoAllergy(r[25]) ? "ไม่มี" : <b className="text-red-700">{r[25]}</b>} />
          <Item k="แพ้อาหาร" v={isNoAllergy(r[26]) ? "ไม่มี" : <b className="text-red-700">{r[26]}</b>} />
          <Item k="ยา / เวชภัณฑ์ที่ใช้ประจำ" v={has(r[28]) ? r[28] : "ไม่มี"} wide />
        </Group>

        <Group title="ผู้ว่าจ้าง">
          <Item k="ชื่อ - นามสกุล" v={r[3]} />
          <Item k="ความเกี่ยวข้อง" v={r[11]} />
          <Item k="เลขบัตรประชาชน" v={idFmt(r[8])} />
          <Item k="โทรศัพท์" v={has(r[9]) ? <a className="underline-offset-2 hover:underline" href={`tel:${String(r[9]).replace(/\D/g, "")}`}>{telFmt(r[9])}</a> : "-"} />
          <Item k="ที่อยู่" v={r[10]} wide />
        </Group>

        <Group title="ค่าใช้จ่าย">
          <Item k="โปรแกรม" v={r[21]} wide />
          <Item k="ห้องพัก" v={contractRoomTitle(r)} wide />
          <Item k="ค่าห้อง" v={fee ? `${money(fee)}${vat ? ` + VAT ${rate}% ${money(vat)}` : " (ไม่คิด VAT)"}` : "-"} wide />
          {lines.length > 0 && <div className="cv-wide"><dt>บริการเพิ่มเติม</dt><dd>
            <ul className="cv-lines">{lines.map((x, i) => <li key={i}><span>{x.desc}{x.qty !== 1 ? ` × ${x.qty} ${x.unit}` : ""}</span><b>{x.price ? money(svcNet(x)) : "รวมในโปรแกรม"}</b></li>)}</ul>
          </dd></div>}
          <Item k="รวมต่อเดือน (รวม VAT)" v={<b className="text-gold-900">{money(monthly)} บาท</b>} />
          <Item k="ชำระล่วงหน้า" v={num(r[18]) ? `${months} เดือน · ${money(num(r[18]))} บาท` : "ไม่เก็บล่วงหน้า"} />
          <Item k="มัดจำห้องที่รับไว้แล้ว" v={num(r[27]) ? `${money(num(r[27]))} บาท` : "-"} />
          <Item k="เงินประกัน" v={num(r[19]) ? `${money(num(r[19]))} บาท` : "-"} />
        </Group>

        {has(r[20]) && <Group title="หมายเหตุ"><Item k="" v={r[20]} wide /></Group>}
      </div>}
    </Modal>
  );
}
