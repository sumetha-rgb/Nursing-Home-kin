"use client";
/**
 * ตั้งค่า › BU (ฝ่ายและบริษัท): หมวดในใบราคาไหนเป็นของฝ่ายไหน และฝ่ายนั้นเป็นรายได้ของบริษัทไหน
 *  ใช้กับรายงาน "รายได้ตาม BU" (รายงานภายใน) · แก้ได้เฉพาะผู้บริหาร · บริษัทว่าง = บริษัทของสาขาที่ออกใบ
 */
import { useState } from "react";
import Icon from "./Icon";
import { COMPANY } from "./ui";
import { newId, useCrud, useRecords } from "@/lib/store";
import { useApp } from "@/lib/app";
import { BU_CAT_TH, BU_CATS, DEFAULT_DIVISIONS, Division } from "@/lib/bu";

export function BuSettings() {
  const [saved, setList, meta] = useRecords<Division>("bu-divisions", DEFAULT_DIVISIONS);
  // ยังไม่มีในระบบ = แสดงค่าตั้งต้น (แก้ครั้งแรกจะบันทึกทั้งชุด)
  const list = saved.length ? saved : meta.loaded ? DEFAULT_DIVISIONS : [];
  const { rows: branches } = useCrud("branches", []);
  const { toast, confirm } = useApp();
  const [edit, setEdit] = useState<{ id: string; name: string } | null>(null);
  const [adding, setAdding] = useState("");
  const companies = [...new Set([COMPANY.th, ...branches.map((b) => b[2]).filter((x) => x && x !== "-")])];
  const save = (d: Division, msg: string) => { setList(list.map((x) => (x.id === d.id ? d : x))); toast(msg); };
  // หมวดที่ผูกหลายฝ่าย (ใช้ฝ่ายแรก) / ยังไม่ผูก
  const used = (cat: string) => list.filter((d) => d.active && d.cats.includes(cat));
  const free = BU_CATS.filter(([c]) => !used(c).length);
  const dupes = BU_CATS.filter(([c]) => used(c).length > 1);
  const toggleCat = (d: Division, cat: string) => save({ ...d, cats: d.cats.includes(cat) ? d.cats.filter((c) => c !== cat) : [...d.cats, cat] }, `${d.name}: ${d.cats.includes(cat) ? "เอาออก" : "เพิ่ม"} ${BU_CAT_TH[cat]}`);
  /** ลบฝ่าย: หมวดของฝ่ายนี้จะไปฝ่ายอื่นที่ผูกหมวดเดียวกัน หรือขึ้นเป็น "ยังไม่ได้กำหนดฝ่าย" · รายงานคิดใหม่ทันที (ไม่แตะใบแจ้งหนี้/ใบเสร็จ) */
  const remove = (d: Division) => {
    if (list.length <= 1) return toast("ต้องมีอย่างน้อย 1 ฝ่าย");
    const moves = d.cats.map((c) => { const to = list.find((x) => x.id !== d.id && x.active && x.cats.includes(c)); return `${BU_CAT_TH[c]} → ${to ? to.name : "ยังไม่ได้กำหนดฝ่าย"}`; });
    confirm({ title: `ลบ ${d.name}`, danger: true, okLabel: "ลบฝ่าย",
      message: `ลบ ${d.name} ออกจากการตั้งค่าฝ่ายใช่หรือไม่${moves.length ? `\n\nหมวดของฝ่ายนี้จะย้ายไป: ${moves.join(" · ")}` : ""}\n\nรายงานรายได้ตาม BU คิดใหม่ทันที ใบแจ้งหนี้และใบเสร็จไม่เปลี่ยน`,
      onOk: () => { setList(list.filter((x) => x.id !== d.id)); toast(`ลบ ${d.name} แล้ว`); } });
  };
  const add = () => {
    const name = adding.replace(/\s+/g, " ").trim();
    if (name.length < 2) return toast("ใส่ชื่อฝ่ายอย่างน้อย 2 ตัวอักษร");
    if (list.some((d) => d.name === name)) return toast(`มี ${name} อยู่แล้ว`);
    setList([...list, { id: `bu-${newId()}`, name, cats: [], company: "", active: true }]); setAdding(""); toast(`เพิ่ม ${name} แล้ว`);
  };
  return (
    <div className="space-y-4">
      {!meta.loaded && <p className="text-sm text-gold-500">กำลังโหลด…</p>}
      {(free.length > 0 || dupes.length > 0) && <p className="st-warn">
        {free.length > 0 && <>ยังไม่ได้ผูกฝ่าย: {free.map(([, t]) => t).join(" · ")} (รายงานจะขึ้นเป็น "ยังไม่ได้กำหนดฝ่าย")</>}
        {free.length > 0 && dupes.length > 0 && <br />}
        {dupes.length > 0 && <>ผูกซ้ำหลายฝ่าย (ใช้ฝ่ายแรก): {dupes.map(([, t]) => t).join(" · ")}</>}
      </p>}
      <ul className="bu-list">
        {list.map((d) => (
          <li key={d.id} className={d.active ? "" : "is-off"}>
            <div className="bu-row">
              {edit?.id === d.id
                ? <span className="flex min-w-0 flex-1 gap-2">
                    <input autoFocus value={edit.name} maxLength={60} aria-label="ชื่อฝ่าย" onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Enter" && edit.name.trim().length >= 2) { save({ ...d, name: edit.name.trim() }, "บันทึกชื่อฝ่ายแล้ว"); setEdit(null); } if (e.key === "Escape") setEdit(null); }} />
                    <button type="button" className="btn-primary !min-h-0 shrink-0" onClick={() => { if (edit.name.trim().length < 2) return; save({ ...d, name: edit.name.trim() }, "บันทึกชื่อฝ่ายแล้ว"); setEdit(null); }}>บันทึก</button>
                  </span>
                : <b className="bu-name">{d.name}</b>}
              <label className="bu-co"><span>เป็นรายได้ของ</span>
                <select value={d.company || ""} onChange={(e) => save({ ...d, company: e.target.value }, `${d.name} → ${e.target.value || "บริษัทของสาขา"}`)} aria-label={`บริษัทของ ${d.name}`}>
                  <option value="">ตามบริษัทของสาขาที่ออกใบ</option>
                  {companies.map((c) => <option key={c} value={c}>{c}</option>)}
                </select></label>
              <button type="button" role="switch" aria-checked={d.active} className="pl-switch" aria-label={`${d.name} ${d.active ? "เปิดใช้งาน" : "ปิดใช้งาน"}`} onClick={() => save({ ...d, active: !d.active }, `${d.active ? "ปิดใช้" : "เปิดใช้"} ${d.name} แล้ว`)}>
                <i aria-hidden="true" /><span>{d.active ? "เปิดใช้งาน" : "ปิดใช้งาน"}</span>
              </button>
              {edit?.id !== d.id && <button type="button" className="row-action" onClick={() => setEdit({ id: d.id, name: d.name })}>แก้ชื่อ</button>}
              {edit?.id !== d.id && <button type="button" className="row-action danger" onClick={() => remove(d)}>ลบ</button>}
            </div>
            <div className="bu-cats" role="group" aria-label={`หมวดของ ${d.name}`}>
              {BU_CATS.map(([c, t]) => <button key={c} type="button" aria-pressed={d.cats.includes(c)} className={`bu-cat ${d.cats.includes(c) ? "is-on" : ""}`} onClick={() => toggleCat(d, c)}>{d.cats.includes(c) && <Icon name="check" className="h-3.5 w-3.5" />}{t}</button>)}
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2">
        <input className="!w-auto min-w-0 flex-1" value={adding} maxLength={60} placeholder="เพิ่มฝ่าย เช่น ฝ่าย HomeCare" aria-label="ชื่อฝ่ายใหม่" onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button type="button" className="btn-primary" onClick={add}><Icon name="plus" className="h-4 w-4" /> เพิ่มฝ่าย</button>
      </div>
      <p className="field-hint">กดหมวดสินค้าเพื่อใส่เข้าหรือเอาออกจากฝ่ายนี้ · "ตามบริษัทของสาขาที่ออกใบ" = รายได้เข้าบริษัทที่ออกใบเสร็จ · มีผลกับรายงานรายได้ตามฝ่ายเท่านั้น เอกสารลูกค้าไม่เปลี่ยน</p>
    </div>
  );
}
