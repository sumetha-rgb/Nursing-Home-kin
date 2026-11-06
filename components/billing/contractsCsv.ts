"use client";
import { contractVat, money, svcNet } from "@/lib/billing";
import { downloadCsv } from "@/lib/store";
import { contractMonthTotal, prepaidMonths } from "../views/Billing";
import { contractLines } from "../print/Docs";

/**
 * ทะเบียนสัญญา CSV (หน้าสัญญาบริการ และหน้าส่งออกข้อมูล) · มีเลขบัตรประชาชน เบอร์ และที่อยู่ = บันทึกลงบันทึกการใช้งานระบบทุกครั้ง
 *  rows = แถวสัญญา (useCrud "contracts") ที่กรองแล้ว · คืนจำนวนสัญญาที่ส่งออก
 */
export function contractsCsv(rows: string[][], name: string) {
  const t = (v?: string) => (v && v !== "-" ? v : "");
  // ใส่ขีดคั่นเลขบัตร/เบอร์โทร ให้ Excel อ่านเป็นข้อความ (ไม่ตัดเลข 0 นำหน้า ไม่แปลงเป็น 1.05E+12)
  const id = (v?: string) => { const d = String(v ?? "").replace(/\D/g, ""); return d.length === 13 ? `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}` : t(v); };
  const tel = (v?: string) => { const d = String(v ?? "").replace(/\D/g, ""); return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}` : d.length === 9 ? `${d.slice(0, 2)}-${d.slice(2, 5)}-${d.slice(5)}` : t(v); };
  const cols = ["เลขที่สัญญา", "สาขา", "สถานะ", "ผู้รับบริการ", "อายุ", "เลขบัตรประชาชนผู้รับบริการ", "ห้อง", "วันเริ่มสัญญา", "วันสิ้นสุดสัญญา", "โปรแกรม",
    "ค่าห้อง (ก่อน VAT)", "VAT ค่าห้อง (%)", "ค่าบริการต่อเดือน (รวม VAT)", "บริการเพิ่มเติม", "ชำระล่วงหน้า (เดือน)", "ชำระล่วงหน้า (บาท)", "มัดจำห้องที่รับไว้แล้ว", "เงินประกัน",
    "ผู้ว่าจ้าง", "ความเกี่ยวข้อง", "เลขบัตรประชาชนผู้ว่าจ้าง", "โทรศัพท์", "ที่อยู่ผู้ว่าจ้าง", "โรงพยาบาลตามสิทธิ์", "โรงพยาบาลสำรอง", "แพ้ยา", "แพ้อาหาร", "ยาที่ใช้ประจำ", "หมายเหตุ"];
  const data = rows.map((r) => [r[0], r[1], r[5], r[2], t(r[13]), id(r[12]), t(r[6]), t(r[7]), t(r[22]), t(r[21]),
    t(r[4]), String(contractVat(r)), money(contractMonthTotal(r)), contractLines(r).map((x) => `${x.desc}${x.price ? ` ${money(svcNet(x))}` : ""}`).join(" | "),
    t(r[18]) ? String(prepaidMonths(r)) : "", t(r[18]), t(r[27]), t(r[19]),
    r[3], t(r[11]), id(r[8]), tel(r[9]), t(r[10]), t(r[24]), t(r[29]), t(r[25]), t(r[26]), t(r[28]), t(r[20])]);
  downloadCsv(name, cols, data);
  fetch("/api/audit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ what: "contracts", count: data.length }) }).catch(() => {});
  return data.length;
}
