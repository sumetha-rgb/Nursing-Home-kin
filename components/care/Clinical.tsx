"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "../Icon";
import { useApp } from "@/lib/app";
import { useSession } from "@/lib/session";
import { can } from "@/lib/perms";
import { money } from "@/lib/billing";
import { ADMISSION, call, Clinic, clinic, fetchClinic, Note, SupplyItem } from "@/lib/clinic";
import { DataTable, Field, Modal } from "../ui";

/**
 * งานพยาบาลและกายภาพรายบุคคล (แท็บในหน้าประวัติผู้รับบริการ · ใช้ได้ทั้งระบบจัดการและ KinApp)
 *  admission = ประวัติและประเมินแรกรับ · nursing = Nurse Note / Problem list / ฉีดอินซูลิน · physio = คอร์สกายภาพ · supplies = เวชภัณฑ์
 */
export type ClinicalTab = "admission" | "nursing" | "physio" | "supplies";
const SHIFTS = ["เวรเช้า", "เวรดึก"];
const SITES = ["หน้าท้อง", "ต้นแขน", "ต้นขา", "สะโพก"];
const ADM_DEFAULTS = Object.fromEntries(ADMISSION.flatMap((s) => s.fields).filter((f) => f.options).map((f) => [f.key, ""]));

export function useClinic(id: string | null) {
  const [c, setC] = useState<Clinic | null>(null);
  const [err, setErr] = useState("");
  const load = useCallback(() => { if (!id) return; fetchClinic(id).then((d) => { setC(d); setErr(""); }).catch((e) => setErr((e as Error).message)); }, [id]);
  useEffect(() => { setC(null); load(); }, [load]);
  return { c, err, reload: load };
}

export default function ClinicalPanel({ id, tab, c, reload }: { id: string; tab: ClinicalTab; c: Clinic | null; reload: () => void }) {
  if (!c) return <p className="py-8 text-center text-sm text-gold-500">กำลังโหลด…</p>;
  if (tab === "admission") return <Admission id={id} c={c} reload={reload} />;
  if (tab === "nursing") return <Nursing id={id} c={c} reload={reload} />;
  if (tab === "physio") return <Physio id={id} c={c} reload={reload} />;
  return <Supplies id={id} c={c} reload={reload} />;
}

type P = { id: string; c: Clinic; reload: () => void };
const run = async (toast: (m: string) => void, body: object, ok: string, after: () => void) => {
  try { await clinic(body); toast(ok); after(); } catch (e) { toast((e as Error).message); }
};

/* ---------- ประวัติและประเมินแรกรับ ---------- */
function Admission({ id, c, reload }: P) {
  const { toast } = useApp();
  const [edit, setEdit] = useState<Record<string, string> | null>(null);
  const data = c.admission?.data ?? {};
  const filled = ADMISSION.flatMap((s) => s.fields).filter((f) => data[f.key]).length;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gold-600">{c.admission ? `บันทึกล่าสุดโดย ${c.admission.assessed_by ?? "-"} · ${c.admission.at}` : "ยังไม่ได้บันทึกประวัติและประเมินแรกรับ"}</p>
        <button className="btn-primary !py-2" onClick={() => setEdit({ ...ADM_DEFAULTS, ...data })}><Icon name={c.admission ? "doc" : "plus"} className="h-4 w-4" /> {c.admission ? "แก้ไขแบบประเมิน" : "บันทึกแรกรับ"}</button>
      </div>
      {filled > 0 && ADMISSION.map((s) => {
        const items = s.fields.filter((f) => data[f.key]);
        return items.length ? <section key={s.title} className="profile-box"><h4>{s.title}</h4>
          <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">{items.map((f) => <div key={f.key} className={f.area ? "sm:col-span-2" : ""}><dt className="text-xs text-gold-500">{f.label}</dt><dd className="whitespace-pre-line text-gold-900">{data[f.key]}</dd></div>)}</dl>
        </section> : null;
      })}
      <Modal open={!!edit} wide title="ประวัติและประเมินแรกรับ" onClose={() => setEdit(null)}
        footer={<><button className="btn-soft" onClick={() => setEdit(null)}>ยกเลิก</button><button className="btn-primary" onClick={() => edit && run(toast, { op: "admission", residentId: id, data: edit }, "บันทึกประวัติและประเมินแรกรับแล้ว · ดูได้ในแท็บแรกรับ", () => { setEdit(null); reload(); })}>บันทึกแบบประเมิน</button></>}>
        {edit && <div className="space-y-6">{ADMISSION.map((s) => (
          <fieldset key={s.title} className="space-y-3">
            <legend className="mb-2 text-sm font-semibold text-gold-800">{s.title}</legend>
            <div className="form-grid">{s.fields.map((f) => (
              <Field key={f.key} label={f.label} className={f.area ? "md:col-span-2" : ""}>
                {f.options ? <select value={edit[f.key] ?? ""} onChange={(e) => setEdit({ ...edit, [f.key]: e.target.value })}><option value="">-- เลือก --</option>{f.options.map((o) => <option key={o}>{o}</option>)}</select>
                  : f.area ? <textarea rows={3} value={edit[f.key] ?? ""} onChange={(e) => setEdit({ ...edit, [f.key]: e.target.value })} />
                  : <input value={edit[f.key] ?? ""} placeholder={f.placeholder} onChange={(e) => setEdit({ ...edit, [f.key]: e.target.value })} />}
              </Field>
            ))}</div>
          </fieldset>
        ))}</div>}
      </Modal>
    </div>
  );
}

/* ---------- Nurse Note · Problem list · ฉีดอินซูลิน ---------- */
function Nursing({ id, c, reload }: P) {
  const { toast, confirm } = useApp();
  const { user } = useSession();
  const [nn, setNn] = useState({ shift: SHIFTS[0], body: "" });
  const [pb, setPb] = useState({ title: "", body: "" });
  const [ins, setIns] = useState({ drug: "", dose: "", site: SITES[0], dtx: "", body: "" });
  const notes = c.notes.filter((n) => n.kind === "nurse");
  const problems = c.notes.filter((n) => n.kind === "problem");
  const insulin = c.notes.filter((n) => n.kind === "insulin");
  const del = (n: Note, label: string) => confirm({ title: `ลบ${label}`, message: `ต้องการลบ${label}ที่บันทึกเมื่อ ${n.at} ใช่หรือไม่`, danger: true, okLabel: "ลบ",
    onOk: () => run(toast, { op: "note_delete", id: n.id }, `ลบ${label}แล้ว · ${n.at}`, reload) });
  const mine = (n: Note) => n.author === user?.name || can(user, "residents");
  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h4 className="profile-sub">Nurse Note</h4>
        <div className="grid gap-2 sm:grid-cols-[140px_1fr_auto]">
          <select value={nn.shift} onChange={(e) => setNn({ ...nn, shift: e.target.value })} aria-label="เวร">{SHIFTS.map((x) => <option key={x}>{x}</option>)}</select>
          <textarea rows={2} value={nn.body} onChange={(e) => setNn({ ...nn, body: e.target.value })} placeholder="อาการ การดูแลที่ให้ และการตอบสนอง เช่น หลับได้ดี ไม่มีไข้ ทานอาหารได้ครึ่งจาน" aria-label="บันทึกพยาบาล" />
          <button className="btn-primary !py-2" onClick={() => nn.body.trim() ? run(toast, { op: "note", residentId: id, kind: "nurse", title: nn.shift, body: nn.body }, `บันทึก Nurse Note แล้ว · ${nn.shift}`, () => { setNn({ ...nn, body: "" }); reload(); }) : toast("กรุณาพิมพ์บันทึก")}>บันทึก</button>
        </div>
        <DataTable search={false} columns={["วันเวลา", "เวร", "บันทึก", "ผู้บันทึก"]} empty="ยังไม่มี Nurse Note"
          rows={notes.map((n) => [n.at, n.title ?? "-", n.body ?? "-", n.author ?? "-"])}
          actions={[{ label: "ลบ", danger: true, hidden: (i) => !mine(notes[i]), onClick: (i) => del(notes[i], "Nurse Note") }]} />
      </section>

      <section className="space-y-3">
        <h4 className="profile-sub">Problem list</h4>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input value={pb.title} onChange={(e) => setPb({ ...pb, title: e.target.value })} placeholder="ปัญหา เช่น เสี่ยงต่อการเกิดแผลกดทับ" aria-label="ปัญหา" />
          <input value={pb.body} onChange={(e) => setPb({ ...pb, body: e.target.value })} placeholder="เป้าหมาย / การดูแล เช่น พลิกตัวทุก 2 ชม." aria-label="การดูแล" />
          <button className="btn-primary !py-2" onClick={() => pb.title.trim() ? run(toast, { op: "note", residentId: id, kind: "problem", title: pb.title, body: pb.body, status: "Active" }, `เพิ่มปัญหาแล้ว · ${pb.title}`, () => { setPb({ title: "", body: "" }); reload(); }) : toast("กรุณาระบุปัญหา")}>เพิ่ม</button>
        </div>
        <DataTable search={false} badgeCols={[3]} columns={["เริ่มเมื่อ", "ปัญหา", "เป้าหมาย / การดูแล", "สถานะ"]} empty="ยังไม่มีปัญหาที่บันทึก"
          rows={problems.map((n) => [n.at, n.title ?? "-", n.body ?? "-", n.status === "Resolved" ? "แก้ไขแล้ว" : "กำลังดูแล"])}
          actions={[
            { label: "ปิดปัญหา", hidden: (i) => problems[i].status === "Resolved", onClick: (i) => run(toast, { op: "note_status", id: problems[i].id, status: "Resolved" }, `ปิดปัญหาแล้ว · ${problems[i].title}`, reload) },
            { label: "เปิดอีกครั้ง", hidden: (i) => problems[i].status !== "Resolved", onClick: (i) => run(toast, { op: "note_status", id: problems[i].id, status: "Active" }, `เปิดปัญหาอีกครั้ง · ${problems[i].title}`, reload) },
            { label: "ลบ", danger: true, hidden: (i) => !mine(problems[i]), onClick: (i) => del(problems[i], "ปัญหา") },
          ]} />
      </section>

      <section className="space-y-3">
        <h4 className="profile-sub">บันทึกฉีดอินซูลิน</h4>
        <div className="grid gap-2 sm:grid-cols-[1.2fr_90px_120px_90px_1fr_auto]">
          <input value={ins.drug} onChange={(e) => setIns({ ...ins, drug: e.target.value })} placeholder="ชนิดอินซูลิน เช่น RI, NPH" aria-label="ชนิดอินซูลิน" />
          <input inputMode="decimal" value={ins.dose} onChange={(e) => setIns({ ...ins, dose: e.target.value })} placeholder="ยูนิต" aria-label="ขนาด (ยูนิต)" />
          <select value={ins.site} onChange={(e) => setIns({ ...ins, site: e.target.value })} aria-label="ตำแหน่งฉีด">{SITES.map((x) => <option key={x}>{x}</option>)}</select>
          <input inputMode="numeric" value={ins.dtx} onChange={(e) => setIns({ ...ins, dtx: e.target.value })} placeholder="DTX" aria-label="DTX ก่อนฉีด" />
          <input value={ins.body} onChange={(e) => setIns({ ...ins, body: e.target.value })} placeholder="หมายเหตุ" aria-label="หมายเหตุ" />
          <button className="btn-primary !py-2" onClick={() => !ins.drug.trim() || !(Number(ins.dose) > 0) ? toast("กรุณาระบุชนิดอินซูลินและจำนวนยูนิต")
            : run(toast, { op: "note", residentId: id, kind: "insulin", title: `${ins.drug} ${ins.dose} ยูนิต`, body: ins.body, data: { drug: ins.drug, dose: ins.dose, site: ins.site, dtx: ins.dtx } }, `บันทึกฉีดอินซูลินแล้ว · ${ins.drug} ${ins.dose} ยูนิต · ${ins.site}`, () => { setIns({ ...ins, dose: "", dtx: "", body: "" }); reload(); })}>บันทึก</button>
        </div>
        <DataTable search={false} columns={["วันเวลา", "อินซูลิน", "ตำแหน่ง", "DTX ก่อนฉีด", "หมายเหตุ", "ผู้ฉีด"]} empty="ยังไม่มีบันทึกฉีดอินซูลิน"
          rows={insulin.map((n) => [n.at, n.title ?? "-", String(n.data.site ?? "-"), String(n.data.dtx || "-"), n.body ?? "-", n.author ?? "-"])}
          actions={[{ label: "ลบ", danger: true, hidden: (i) => !mine(insulin[i]), onClick: (i) => del(insulin[i], "บันทึกอินซูลิน") }]} />
      </section>
    </div>
  );
}

/* ---------- คอร์สกายภาพ ---------- */
function Physio({ id, c, reload }: P) {
  const { toast } = useApp();
  const { user } = useSession();
  const canSell = can(user, "residents") || can(user, "billing");
  const [buy, setBuy] = useState<{ name: string; total: string; price: string } | null>(null);
  const [use, setUse] = useState<{ id: string; name: string; body: string; pain: string; plan: string } | null>(null);
  const sessions = c.notes.filter((n) => n.kind === "physio");
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gold-600">ใช้คอร์สทีละครั้งพร้อมบันทึก Progress note · เหลือ 2 ครั้งระบบเตือนให้แจ้งญาติต่อคอร์ส</p>
        {canSell && <button className="btn-primary !py-2" onClick={() => setBuy({ name: "กายภาพบำบัด (ครั้งละ 45 นาที)", total: "10", price: "" })}><Icon name="plus" className="h-4 w-4" /> ซื้อคอร์ส</button>}
      </div>
      {!c.courses.length && <p className="rounded-xl bg-cream-50 px-4 py-6 text-center text-sm text-gold-600">ยังไม่มีคอร์สกายภาพ</p>}
      <div className="grid gap-3 md:grid-cols-2">{c.courses.map((k) => {
        const left = k.total - k.used, pct = Math.round((k.used / k.total) * 100);
        return (
          <section key={k.id} className="profile-box">
            <div className="flex items-start justify-between gap-3"><h4 className="!mb-0">{k.name}</h4><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${left <= 0 ? "bg-cream-200 text-gold-600" : left <= 2 ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>{left <= 0 ? "ครบแล้ว" : `เหลือ ${left} ครั้ง`}</span></div>
            <p className="mt-1 text-xs text-gold-500">ซื้อเมื่อ {k.at} · โดย {k.created_by ?? "-"}{k.price ? ` · ${money(k.price)} บาท · ${k.invoice_id ? "ออกใบแจ้งหนี้แล้ว" : "ยังไม่เรียกเก็บ"}` : ""}</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-cream-300"><div className="h-full rounded-full bg-gold-600" style={{ width: `${pct}%` }} /></div>
            <p className="mt-1 text-xs text-gold-600">ใช้ไป {k.used}/{k.total} ครั้ง</p>
            {left > 0 && <button className="btn-soft mt-3 w-full !py-2" onClick={() => setUse({ id: k.id, name: k.name, body: "", pain: "", plan: "" })}>บันทึกการทำกายภาพ (ใช้ 1 ครั้ง)</button>}
          </section>
        );
      })}</div>
      <div><h4 className="profile-sub">ประเมินและ Progress note</h4>
        <DataTable search={false} columns={["วันเวลา", "ครั้งที่", "Progress note", "ปวด (0–10)", "แผนครั้งถัดไป", "ผู้บันทึก"]} empty="ยังไม่มีบันทึกกายภาพ"
          rows={sessions.map((n) => [n.at, n.title ?? "-", n.body ?? "-", String(n.data.pain || "-"), String(n.data.plan || "-"), n.author ?? "-"])} /></div>

      <Modal open={!!buy} title="ซื้อคอร์สกายภาพ" onClose={() => setBuy(null)}
        footer={<><button className="btn-soft" onClick={() => setBuy(null)}>ยกเลิก</button><button className="btn-primary" onClick={() => buy && run(toast, { op: "course", residentId: id, name: buy.name, total: Number(buy.total), price: Number(buy.price) || 0 }, `ซื้อคอร์สแล้ว · ${buy.name} ${buy.total} ครั้ง${Number(buy.price) > 0 ? " · แคชเชียร์ดึงเข้าใบแจ้งหนี้ได้ที่เมนูการเงิน" : ""}`, () => { setBuy(null); reload(); })}>บันทึกคอร์ส</button></>}>
        {buy && <div className="form-grid">
          <Field label="ชื่อคอร์ส" className="md:col-span-2"><input value={buy.name} onChange={(e) => setBuy({ ...buy, name: e.target.value })} /></Field>
          <Field label="จำนวนครั้ง"><input type="number" min={1} value={buy.total} onChange={(e) => setBuy({ ...buy, total: e.target.value })} /></Field>
          <Field label="ราคาคอร์ส (บาท)"><input type="number" min={0} value={buy.price} onChange={(e) => setBuy({ ...buy, price: e.target.value })} placeholder="เช่น 8000" /></Field>
        </div>}
      </Modal>
      <Modal open={!!use} title={use ? `บันทึกการทำกายภาพ · ${use.name}` : ""} onClose={() => setUse(null)}
        footer={<><button className="btn-soft" onClick={() => setUse(null)}>ยกเลิก</button><button className="btn-primary" onClick={() => use && (use.body.trim() ? run(toast, { op: "course_use", courseId: use.id, body: use.body, data: { pain: use.pain, plan: use.plan } }, `บันทึกกายภาพแล้ว · ${use.name} · ตัดคอร์ส 1 ครั้ง`, () => { setUse(null); reload(); }) : toast("กรุณาพิมพ์ Progress note"))}>บันทึกและใช้ 1 ครั้ง</button></>}>
        {use && <div className="space-y-4">
          <Field label="Progress note"><textarea rows={4} value={use.body} onChange={(e) => setUse({ ...use, body: e.target.value })} placeholder="สิ่งที่ทำและผล เช่น ฝึกเดินด้วย walker 20 เมตร 2 รอบ ทรงตัวดีขึ้น" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="ระดับความปวด (0–10)"><input inputMode="numeric" value={use.pain} onChange={(e) => setUse({ ...use, pain: e.target.value })} /></Field>
            <Field label="แผนครั้งถัดไป"><input value={use.plan} onChange={(e) => setUse({ ...use, plan: e.target.value })} placeholder="เช่น เพิ่มระยะเดินเป็น 30 เมตร" /></Field>
          </div>
        </div>}
      </Modal>
    </div>
  );
}

/* ---------- เวชภัณฑ์ ---------- */
function Supplies({ id, c, reload }: P) {
  const { toast } = useApp();
  const { user } = useSession();
  const manage = can(user, "residents");
  const [items, setItems] = useState<SupplyItem[]>([]);
  const [pick, setPick] = useState({ item: "", qty: "1" });
  const [edit, setEdit] = useState<{ id?: string; name: string; unit: string; price: string; stock: string } | null>(null);
  const loadItems = useCallback(() => { call<{ items: SupplyItem[] }>("/api/clinic?op=supplies").then((d) => setItems(d.items)).catch(() => {}); }, []);
  useEffect(loadItems, [loadItems]);
  const it = items.find((x) => x.id === pick.item);
  const unbilled = c.supplies.filter((s) => !s.invoice_id);
  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h4 className="profile-sub">เบิกเวชภัณฑ์ให้ผู้รับบริการ</h4>
        <div className="grid gap-2 sm:grid-cols-[1fr_100px_auto]">
          <select value={pick.item} onChange={(e) => setPick({ ...pick, item: e.target.value })} aria-label="เวชภัณฑ์">
            <option value="">-- เลือกเวชภัณฑ์ --</option>
            {items.map((x) => <option key={x.id} value={x.id} disabled={x.stock < 1}>{x.name} · คงเหลือ {x.stock} {x.unit}{x.price ? ` · ${money(x.price)} บาท` : ""}</option>)}
          </select>
          <input type="number" min={1} value={pick.qty} onChange={(e) => setPick({ ...pick, qty: e.target.value })} aria-label="จำนวน" />
          <button className="btn-primary !py-2" onClick={() => !it ? toast("กรุณาเลือกเวชภัณฑ์") : run(toast, { op: "supply_issue", residentId: id, itemId: it.id, qty: Number(pick.qty) }, `เบิกเวชภัณฑ์แล้ว · ${it.name} ${pick.qty} ${it.unit}`, () => { setPick({ item: "", qty: "1" }); reload(); loadItems(); })}>เบิก</button>
        </div>
        {!items.length && <p className="text-sm text-gold-600">ยังไม่มีเวชภัณฑ์ในคลังของสาขา{manage ? " · กด จัดการคลังเวชภัณฑ์ เพื่อเพิ่ม" : " · แจ้งหัวหน้าพยาบาลให้เพิ่มรายการ"}</p>}
      </section>
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h4 className="profile-sub !mb-0">ประวัติการเบิก</h4>{unbilled.length > 0 && <span className="text-xs text-amber-800">ยังไม่เรียกเก็บ {unbilled.length} รายการ · {money(unbilled.reduce((n, s) => n + s.qty * s.price, 0))} บาท (ดึงเข้าใบแจ้งหนี้ได้ที่เมนูการเงิน)</span>}</div>
        <DataTable search={false} columns={["วันเวลา", "รายการ", "จำนวน", "ราคารวม", "ผู้เบิก", "เรียกเก็บ"]} empty="ยังไม่มีการเบิก"
          rows={c.supplies.map((s) => [s.at, s.item_name, `${s.qty} ${s.unit}`, money(s.qty * s.price), s.issued_by ?? "-", s.invoice_id ? "ออกใบแจ้งหนี้แล้ว" : "ยังไม่เรียกเก็บ"])} />
      </div>
      {manage && <div>
        <div className="mb-2 flex items-center justify-between gap-2"><h4 className="profile-sub !mb-0">คลังเวชภัณฑ์ของสาขา</h4><button className="btn-soft !py-2" onClick={() => setEdit({ name: "", unit: "ชิ้น", price: "", stock: "" })}><Icon name="plus" className="h-4 w-4" /> เพิ่มรายการ</button></div>
        <DataTable search={false} columns={["รายการ", "หน่วย", "ราคา/หน่วย", "คงเหลือ"]} empty="ยังไม่มีรายการ"
          rows={items.map((x) => [x.name, x.unit, money(x.price), String(x.stock)])}
          actions={[{ label: "แก้ไข / เติมสต็อก", onClick: (i) => setEdit({ id: items[i].id, name: items[i].name, unit: items[i].unit, price: String(items[i].price), stock: String(items[i].stock) }) }]} />
      </div>}
      <Modal open={!!edit} title={edit?.id ? "แก้ไขเวชภัณฑ์" : "เพิ่มเวชภัณฑ์"} onClose={() => setEdit(null)}
        footer={<><button className="btn-soft" onClick={() => setEdit(null)}>ยกเลิก</button><button className="btn-primary" onClick={() => edit && run(toast, { op: "supply_item", ...edit, price: Number(edit.price) || 0, stock: Number(edit.stock) || 0 }, `${edit.id ? "แก้ไขเวชภัณฑ์แล้ว" : "เพิ่มเวชภัณฑ์แล้ว"} · ${edit.name} · คงเหลือ ${edit.stock || 0} ${edit.unit}`, () => { setEdit(null); loadItems(); })}>บันทึก</button></>}>
        {edit && <div className="form-grid">
          <Field label="ชื่อเวชภัณฑ์" className="md:col-span-2"><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="เช่น ผ้าอ้อมผู้ใหญ่ ไซซ์ L" /></Field>
          <Field label="หน่วย"><input value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} placeholder="ชิ้น / ห่อ / กล่อง" /></Field>
          <Field label="ราคาต่อหน่วย (บาท)"><input type="number" min={0} value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} /></Field>
          <Field label="จำนวนคงเหลือ"><input type="number" min={0} value={edit.stock} onChange={(e) => setEdit({ ...edit, stock: e.target.value })} /></Field>
        </div>}
      </Modal>
    </div>
  );
}
