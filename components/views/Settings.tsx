"use client";
/**
 * หน้า "ตั้งค่า": รวมรายการที่ผู้ใช้เพิ่ม/แก้/ปิดใช้เองได้ไว้ที่เดียว (ซ้าย = หมวด · ขวา = รายการ)
 *  แต่ละคนเห็นเฉพาะหมวดที่มีสิทธิ์แก้ · ปุ่มตั้งค่าในแต่ละหน้ายังอยู่ (แก้ข้อมูลชุดเดียวกัน)
 *  หน้าที่มีอยู่แล้ว (ราคาสินค้า ข้อมูลสาขา แม่แบบงาน ทีมและสิทธิ์) ไม่ย้ายมา
 */
import { ReactNode, useState } from "react";
import { PageHeader } from "../ui";
import { PayAccountsManager } from "../billing/PayAccounts";
import { OptionListPanel } from "../OptionSettings";
import { PriceSubsPanel } from "./PriceList";
import { BuSettings } from "../BuSettings";
import { useSession } from "@/lib/session";
import { can } from "@/lib/perms";
import type { SessionUser } from "@/lib/roles";
import { OPT_WRITE, OPTION_LISTS, OptList } from "@/lib/optionLists";
import { canPriceSubs } from "@/lib/settingsAccess";

type Sec = { id: string; head: string; label: string; sub: string; show: (u: SessionUser | null) => boolean; body: () => ReactNode };
const opt = (list: OptList, head: string): Sec => ({
  id: list, head, label: OPTION_LISTS[list].label, sub: OPTION_LISTS[list].hint,
  show: (u) => OPT_WRITE[OPTION_LISTS[list].group].some((p) => can(u, p)), body: () => <OptionListPanel list={list} bare />,
});

const SECTIONS: Sec[] = [
  { id: "bank", head: "การเงิน", label: "บัญชีธนาคาร / เครื่อง EDC", sub: "บัญชีรับโอน เครื่องรูดบัตร และช่องทางบัตร ที่แคชเชียร์เลือกตอนรับชำระ", show: (u) => can(u, "billing"), body: () => <PayAccountsManager /> },
  { id: "price_subs", head: "การเงิน", label: "หมวดย่อยใบราคา", sub: "หมวดย่อยและช่วงรหัสของราคาสินค้าและบริการ", show: canPriceSubs, body: () => <PriceSubsPanel /> },
  { id: "bu", head: "การเงิน", label: "BU (ฝ่ายและบริษัท)", sub: "หมวดในใบราคาไหนเป็นของฝ่ายไหน และเป็นรายได้ของบริษัทไหน · ใช้กับรายงานรายได้ตาม BU", show: (u) => u?.role === "Global Admin", body: () => <BuSettings /> },
  opt("cn_reasons", "การเงิน"),
  ...(["relations", "health_rights", "booking_amounts", "dc_reasons", "allergy_drugs", "food_allergens", "common_meds"] as OptList[]).map((l) => opt(l, "สัญญาบริการ")),
  ...(["task_categories", "review_notes"] as OptList[]).map((l) => opt(l, "งานดูแล")),
  ...(["physio_activities", "physio_mobility", "physio_slots", "physio_minutes", "physio_close_reasons"] as OptList[]).map((l) => opt(l, "กายภาพ")),
];

export function Settings() {
  const { user } = useSession();
  const mine = SECTIONS.filter((s) => s.show(user));
  const [id, setId] = useState(mine[0]?.id ?? "");
  const cur = mine.find((s) => s.id === id) ?? mine[0];
  const heads = [...new Set(mine.map((s) => s.head))];
  return (
    <>
      <PageHeader title="ตั้งค่า" sub="เพิ่ม แก้ไข และเปิด/ปิดตัวเลือกที่ใช้ในระบบ · ปิดแล้วไม่ขึ้นให้เลือก แต่ข้อมูลเก่ายังอยู่ · ใช้ร่วมกันทุกสาขา" />
      {!cur ? <p className="card section-surface text-sm text-gold-600">บัญชีนี้ยังไม่มีสิทธิ์แก้การตั้งค่าส่วนใด</p> : (
        <div className="set-layout">
          {/* มือถือ: เลือกจากรายการ · จอใหญ่: เมนูด้านซ้าย */}
          <label className="set-pick"><span className="label">หมวด</span>
            <select value={cur.id} onChange={(e) => setId(e.target.value)} aria-label="เลือกหมวดตั้งค่า">
              {heads.map((h) => <optgroup key={h} label={h}>{mine.filter((s) => s.head === h).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</optgroup>)}
            </select>
          </label>
          <nav className="set-nav" aria-label="หมวดตั้งค่า">
            {heads.map((h) => (
              <div key={h} className="set-grp">
                <p>{h}</p>
                {mine.filter((s) => s.head === h).map((s) => <button key={s.id} type="button" aria-current={s.id === cur.id ? "page" : undefined} className={s.id === cur.id ? "is-on" : ""} onClick={() => setId(s.id)}>{s.label}</button>)}
              </div>
            ))}
          </nav>
          <section className="set-main" aria-label={cur.label}>
            <header className="set-h"><span>{cur.head}</span><h2>{cur.label}</h2><p>{cur.sub}</p></header>
            {cur.id === "bank" ? cur.body() : <div className="card section-surface">{cur.body()}</div>}
          </section>
        </div>
      )}
    </>
  );
}
