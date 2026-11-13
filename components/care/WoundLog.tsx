"use client";
import { useCallback, useEffect, useState } from "react";
import { Field } from "../ui";
import Icon from "../Icon";
import PhotoPicker from "../PhotoPicker";
import { useApp } from "@/lib/app";
import { shortAt, WoundLog as Log, WOUND_SITES, WOUND_STAGES } from "@/lib/safety";

/**
 * บันทึกแผลเป็นลำดับเวลา (ประวัติรายบุคคล · แท็บแผล): ถ่ายรูปและวัดขนาดทุกครั้งที่ทำแผล
 *  แยกตามตำแหน่งแผล เรียงเก่า → ใหม่ เทียบกันได้ · ขนาดเล็กลง = ดีขึ้น (พื้นที่ ยาว × กว้าง)
 */
export default function WoundLog({ residentId }: { residentId: string }) {
  const { toast } = useApp();
  const [items, setItems] = useState<Log[] | null>(null);
  const [f, setF] = useState<{ site: string; stage: string; length: string; width: string; photo: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    fetch(`/api/safety?op=wounds&resident=${encodeURIComponent(residentId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { items: [] })).then((d) => setItems(d.items ?? [])).catch(() => setItems([]));
  }, [residentId]);
  useEffect(load, [load]);
  const sites = [...new Set((items ?? []).map((x) => x.site))];
  const save = async () => {
    if (!f) return;
    if (!f.site.trim()) return toast("กรุณาระบุตำแหน่งแผล");
    if (!f.photo && !f.length) return toast("กรุณาถ่ายรูปหรือวัดขนาดแผลอย่างน้อย 1 อย่าง");
    setBusy(true);
    const r = await fetch("/api/safety", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "wound_add", residentId, site: f.site, stage: f.stage, length: f.length, width: f.width, photo: f.photo || undefined, note: f.note }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast(d.error || "บันทึกไม่สำเร็จ");
    toast(`บันทึกแผลแล้ว · ${f.site}`); setF(null); load();
  };
  const area = (x: Log) => (x.length !== null && x.width !== null ? x.length * x.width : null);
  return (
    <section className="profile-box">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="!mb-0">บันทึกแผล <small className="font-normal text-gold-500">รูปและขนาดเรียงตามเวลา</small></h4>
        {!f && <button type="button" className="btn-soft !min-h-0 !py-1.5 !text-sm print-hide" onClick={() => setF({ site: sites[0] ?? "", stage: "", length: "", width: "", photo: "", note: "" })}><Icon name="plus" className="h-4 w-4" /> บันทึกแผลครั้งนี้</button>}
      </div>
      {f && <div className="mt-3 space-y-3 rounded-xl border border-cream-300 bg-white p-3 print-hide">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="ตำแหน่งแผล" required><input list="wound-sites" value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })} placeholder="เช่น ก้นกบ" />
            <datalist id="wound-sites">{[...new Set([...sites, ...WOUND_SITES])].map((x) => <option key={x} value={x} />)}</datalist></Field>
          <Field label="ระดับ"><select value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })}><option value="">-- ไม่ระบุ --</option>{WOUND_STAGES.map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="ยาว (ซม.)"><input type="number" inputMode="decimal" min={0} max={100} step={0.1} value={f.length} onChange={(e) => setF({ ...f, length: e.target.value })} /></Field>
          <Field label="กว้าง (ซม.)"><input type="number" inputMode="decimal" min={0} max={100} step={0.1} value={f.width} onChange={(e) => setF({ ...f, width: e.target.value })} /></Field>
        </div>
        <PhotoPicker value={f.photo} onChange={(photo) => setF({ ...f, photo })} label="รูปแผล" hint="ถ่ายมุมเดิม ระยะเดิม ทุกครั้ง เทียบกันง่าย" />
        <Field label="หมายเหตุ"><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="เช่น มีหนองเล็กน้อย เปลี่ยนเป็นแผ่นปิดแผลชนิดโฟม" /></Field>
        <div className="flex justify-end gap-2"><button type="button" className="btn-soft" onClick={() => setF(null)}>ยกเลิก</button><button type="button" className="btn-primary" disabled={busy} onClick={save}>{busy ? "กำลังบันทึก…" : "บันทึกแผล"}</button></div>
      </div>}
      {items && !items.length && !f && <p className="mt-3 text-sm text-gold-600">ยังไม่มีบันทึกแผล</p>}
      {sites.map((s) => {
        const list = (items ?? []).filter((x) => x.site === s).reverse();
        const first = list.find((x) => area(x) !== null), last = [...list].reverse().find((x) => area(x) !== null);
        const trend = first && last && first !== last ? (area(last)! < area(first)! ? "ดีขึ้น" : area(last)! > area(first)! ? "แย่ลง" : "เท่าเดิม") : "";
        return (
          <div key={s} className="mt-4">
            <p className="text-sm font-medium text-gold-900">แผล{s} <small className="font-normal text-gold-500">· {list.length} ครั้ง</small>{trend && <span className={`wound-trend ${trend === "ดีขึ้น" ? "is-good" : trend === "แย่ลง" ? "is-bad" : ""}`}>{trend}</span>}</p>
            <div className="wound-strip">{list.map((x) => (
              <figure key={x.id}>
                {x.photo ? <img src={x.photo} alt={`แผล${s} ${shortAt(x.at)}`} loading="lazy" /> : <div className="wound-nophoto">ไม่มีรูป</div>}
                <figcaption><span>{shortAt(x.at)}</span>{x.length !== null && <b>{x.length} × {x.width ?? "-"} ซม.</b>}{x.stage && <small>{x.stage}</small>}{x.note && <small>{x.note}</small>}<small>{x.author ?? ""}</small></figcaption>
              </figure>
            ))}</div>
          </div>
        );
      })}
    </section>
  );
}
