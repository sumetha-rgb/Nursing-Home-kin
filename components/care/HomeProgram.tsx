"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "../Icon";
import { useApp } from "@/lib/app";

type Item = { name: string; reps: string; note: string };
type Data = { program: { id: string; items: Item[]; created_by: string; at: string } | null; log: { d: string; n: number }[] };
/** ท่าที่ใช้บ่อย (เลือกแล้วแก้ได้) */
const COMMON: Item[] = [
  { name: "ยกขาตรง (นอนหงาย)", reps: "ข้างละ 10 ครั้ง · วันละ 2 รอบ", note: "" },
  { name: "ลุกนั่งจากเก้าอี้", reps: "5 ครั้ง · วันละ 2 รอบ", note: "มีคนยืนข้าง ๆ" },
  { name: "กระดกข้อเท้าขึ้นลง", reps: "20 ครั้ง · ทุก 2 ชม.", note: "" },
  { name: "บีบลูกบอลยาง", reps: "ข้างละ 15 ครั้ง", note: "" },
  { name: "ฝึกเดินพร้อมอุปกรณ์ช่วยเดิน", reps: "5–10 นาที · วันละ 2 รอบ", note: "มีคนช่วยพยุง" },
];

/**
 * โปรแกรมออกกำลังกายที่บ้าน (ประวัติรายบุคคล · แท็บกายภาพ): นักกายภาพเลือก/พิมพ์ท่า จำนวนครั้ง คำแนะนำ
 *  ญาติเห็นในลิงก์ครอบครัว (สมุดภาพประจำวัน) และติ๊กว่าทำแล้ว · ที่นี่เห็นว่าทำไปกี่ท่าต่อวัน 14 วันล่าสุด
 */
export default function HomeProgram({ residentId, canEdit }: { residentId: string; canEdit: boolean }) {
  const { toast } = useApp();
  const [d, setD] = useState<Data | null>(null);
  const [edit, setEdit] = useState<Item[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    fetch(`/api/clinic?op=home_program&resident=${encodeURIComponent(residentId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)).then((x) => setD(x ?? { program: null, log: [] })).catch(() => setD({ program: null, log: [] }));
  }, [residentId]);
  useEffect(load, [load]);
  const save = async (items: Item[]) => {
    setBusy(true);
    const r = await fetch("/api/clinic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "home_program_save", residentId, items }) });
    const x = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast(x.error || "บันทึกไม่สำเร็จ");
    toast(items.length ? `บันทึกโปรแกรมแล้ว ${items.length} ท่า · ญาติเห็นในลิงก์ครอบครัว` : "หยุดโปรแกรมแล้ว");
    setEdit(null); load();
  };
  const items = d?.program?.items ?? [];
  const set = (i: number, p: Partial<Item>) => edit && setEdit(edit.map((x, k) => (k === i ? { ...x, ...p } : x)));
  return (
    <section className="profile-box">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="!mb-0">โปรแกรมออกกำลังกายที่บ้าน <small className="font-normal text-gold-500">ญาติเห็นและติ๊กว่าทำแล้วในลิงก์ครอบครัว</small></h4>
        {canEdit && !edit && <button type="button" className="btn-soft !min-h-0 !py-1.5 !text-sm print-hide" onClick={() => setEdit(items.length ? items : [{ name: "", reps: "", note: "" }])}>
          <Icon name={items.length ? "doc" : "plus"} className="h-4 w-4" /> {items.length ? "แก้โปรแกรม" : "ตั้งโปรแกรม"}</button>}
      </div>
      {!edit && (d === null ? <p className="mt-2 text-sm text-gold-600">กำลังโหลด…</p> : !items.length ? <p className="mt-2 text-sm text-gold-600">ยังไม่มีโปรแกรม{canEdit ? " · กดตั้งโปรแกรม แล้วส่งลิงก์ครอบครัวให้ญาติ" : ""}</p> : <>
        <ol className="mt-2 space-y-1 text-sm text-gold-800">{items.map((x, i) => <li key={i}><b>{i + 1}. {x.name}</b>{x.reps && ` · ${x.reps}`}{x.note && <span className="text-gold-500"> · {x.note}</span>}</li>)}</ol>
        <p className="mt-2 text-xs text-gold-500">ตั้งโดย {d.program?.created_by ?? "-"} · {d.program?.at ?? ""} · ญาติติ๊กทำแล้ว 14 วันล่าสุด:</p>
        <div className="hp-days">{d.log.length ? d.log.map((x) => <span key={x.d} className={x.n >= items.length ? "is-full" : ""}>{x.d.slice(8, 10)}/{x.d.slice(5, 7)} · {x.n}/{items.length}</span>) : <span>ยังไม่มีการติ๊ก</span>}</div>
      </>)}
      {edit && <div className="mt-3 space-y-2 print-hide">
        {edit.map((x, i) => (
          <div key={i} className="hp-row">
            <input value={x.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="ชื่อท่า" aria-label={`ชื่อท่าที่ ${i + 1}`} />
            <input value={x.reps} onChange={(e) => set(i, { reps: e.target.value })} placeholder="จำนวนครั้ง / รอบ" aria-label={`จำนวนครั้งท่าที่ ${i + 1}`} />
            <input value={x.note} onChange={(e) => set(i, { note: e.target.value })} placeholder="คำแนะนำ (ไม่บังคับ)" aria-label={`คำแนะนำท่าที่ ${i + 1}`} />
            <button type="button" className="row-action" aria-label={`ลบท่าที่ ${i + 1}`} onClick={() => setEdit(edit.filter((_, k) => k !== i))}>ลบ</button>
          </div>
        ))}
        <div className="flex flex-wrap gap-1.5">
          {edit.length < 12 && <button type="button" className="row-action" onClick={() => setEdit([...edit, { name: "", reps: "", note: "" }])}>+ เพิ่มท่า</button>}
          {COMMON.filter((c) => !edit.some((x) => x.name === c.name)).map((c) => <button key={c.name} type="button" className="row-action" onClick={() => setEdit([...edit.filter((x) => x.name.trim()), c])}>+ {c.name}</button>)}
        </div>
        <div className="flex flex-wrap justify-end gap-2 pt-1">
          {items.length > 0 && <button type="button" className="btn-soft mr-auto" disabled={busy} onClick={() => save([])}>หยุดโปรแกรม</button>}
          <button type="button" className="btn-soft" onClick={() => setEdit(null)}>ยกเลิก</button>
          <button type="button" className="btn-primary" disabled={busy || !edit.some((x) => x.name.trim())} onClick={() => save(edit.filter((x) => x.name.trim()))}>{busy ? "กำลังบันทึก…" : "บันทึกโปรแกรม"}</button>
        </div>
      </div>}
    </section>
  );
}
