"use client";
import { courseHandoff } from "@/lib/handoff";
import { useCallback, useEffect, useState } from "react";
import Icon from "../Icon";
import { useApp } from "@/lib/app";
import { useSession } from "@/lib/session";
import { can } from "@/lib/perms";
import { money } from "@/lib/billing";
import { ADMISSION, call, Clinic, clinic, fetchClinic, Note, SupplyItem } from "@/lib/clinic";
import { DataTable, Field, Modal } from "../ui";
import { SearchSelect } from "../SearchSelect";
import PhysioAssign from "./PhysioAssign";
import PhysioRecordModal, { RecordTarget } from "./PhysioRecord";
import PhysioSessions from "./PhysioSessions";
import PhysioCloseCourse, { CloseTarget } from "./PhysioCloseCourse";
import { courseOptText, fillFromCourse, physioCourses } from "@/lib/priceList";
import { usePriceList } from "@/lib/usePrices";
import { closedInfo, PhysioBoard, PhysioCase, PhysioHistory, schedText, teamText } from "@/lib/physio";

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

export default function ClinicalPanel({ id, tab, c, reload, name = "" }: { id: string; tab: ClinicalTab; c: Clinic | null; reload: () => void; name?: string }) {
  if (!c) return <p className="py-8 text-center text-sm text-gold-500">กำลังโหลด…</p>;
  if (tab === "admission") return <Admission id={id} c={c} reload={reload} />;
  if (tab === "nursing") return <Nursing id={id} c={c} reload={reload} />;
  if (tab === "physio") return <Physio id={id} c={c} reload={reload} name={name} />;
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
  // ช่องแพ้ยา/แพ้อาหารที่ยังว่าง เติมจากสัญญาให้ก่อน (พยาบาลแก้ได้)
  const ca = c.contractAllergy, ok = (v?: string | null) => !!v && v.trim() !== "" && v.trim() !== "-";
  const fromContract: Record<string, string> = { ...(ok(ca?.drug_allergy) ? { allergy_drug: ca!.drug_allergy! } : {}), ...(ok(ca?.food_allergy) ? { allergy_food: ca!.food_allergy! } : {}) };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gold-600">{c.admission ? `บันทึกล่าสุดโดย ${c.admission.assessed_by ?? "-"} · ${c.admission.at}` : "ยังไม่ได้บันทึกประวัติและประเมินแรกรับ"}</p>
        <button className="btn-primary !py-2" onClick={() => setEdit({ ...ADM_DEFAULTS, ...fromContract, ...data })}><Icon name={c.admission ? "doc" : "plus"} className="h-4 w-4" /> {c.admission ? "แก้ไขแบบประเมิน" : "บันทึกแรกรับ"}</button>
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
function Physio({ id, c, reload, name }: P & { name: string }) {
  const { toast } = useApp();
  const { user } = useSession();
  // ขายคอร์ส = ผู้จัดการสาขา ผู้บริหาร ฝ่ายขาย (สิทธิ์ใบแจ้งหนี้และใบเสร็จ) · หัวหน้าพยาบาลดูได้ แต่ไม่ขาย
  const canSell = can(user, "billing");
  const { go } = useApp();
  /** ซื้อคอร์ส · bill = เปิดฟอร์มใบแจ้งหนี้ต่อทันที (ระบบจัดการเท่านั้น ไม่ใช่ KinApp) */
  const buyCourse = async (bill: boolean) => {
    if (!buy) return;
    if (buy.free ? !buy.why.trim() : !(Number(buy.price) > 0)) return toast(buy.free ? "กรุณาระบุเหตุผลที่ให้ฟรี" : "กรุณากรอกราคาคอร์ส");
    const total = Number(buy.total), price = buy.free ? 0 : Number(buy.price) || 0;
    const r = await fetch("/api/clinic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "course", residentId: id, name: buy.name, total, price, freeReason: buy.free ? buy.why : "", priceCode: buy.code || undefined }) }).catch(() => null);
    const d = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) return toast(d.error || "บันทึกคอร์สไม่สำเร็จ");
    setBuy(null); reload();
    if (bill && d.id) { courseHandoff.set({ residentId: id, courseId: d.id, name: buy.name.trim(), total, price }); go("billing"); return; }
    toast(`ซื้อคอร์สแล้ว · ${buy.name} ${buy.total} ครั้ง${buy.free ? " · ฟรี ใช้ได้ทันที" : " · ออกใบแจ้งหนี้ภายหลังได้ที่เมนูใบแจ้งหนี้และใบเสร็จ"}`);
  };
  const inConsole = typeof window !== "undefined" && !window.location.pathname.startsWith("/staff");
  // บันทึกกายภาพได้เฉพาะสิทธิ์ "บันทึกกายภาพ" (นักกายภาพ) · จ่ายเคสได้เฉพาะสิทธิ์ "จ่ายเคสกายภาพ"
  const canRecord = can(user, "physio.record"), canAssign = can(user, "physio.assign");
  const [board, setBoard] = useState<PhysioBoard | null>(null);
  const [assign, setAssign] = useState<PhysioCase | null>(null);
  const openAssign = async (courseId: string) => {
    const b: PhysioBoard | null = board ?? await fetch("/api/clinic?op=physio_board", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!b) return toast("โหลดรายชื่อนักกายภาพไม่สำเร็จ");
    setBoard(b);
    const x = b.cases.find((k) => k.id === courseId);
    x ? setAssign(x) : toast("คอร์สนี้ใช้ครบแล้วหรือยังไม่พร้อมจ่ายเคส");
  };
  const [buy, setBuy] = useState<{ name: string; total: string; price: string; free: boolean; why: string; code?: string } | null>(null);
  usePriceList();
  const ptCourses = physioCourses();
  const boss = user?.role === "Branch Admin" || user?.role === "Global Admin";
  const { confirm } = useApp();
  /** ใช้คอร์สได้: คอร์สฟรี หรือออกใบแจ้งหนี้แล้ว */
  /** สถานะเงินของคอร์ส (บันทึกกายภาพได้ทันทีหลังซื้อ ไม่ต้องรอใบแจ้งหนี้) */
  const payText = (k: { price: number; invoice_id: string | null; paid?: boolean }) => (!k.price ? "" : !k.invoice_id ? "แคชเชียร์ยังไม่ได้ออกใบแจ้งหนี้" : k.paid ? "ชำระแล้ว" : "ออกใบแจ้งหนี้แล้ว · รอชำระ");
  /** ฟอร์มบันทึกเดียวกับ KinApp (สัญญาณชีพ · บันทึกการตรวจรักษา · ผลการทำ) · บันทึกจากระบบจัดการไม่บังคับรูป */
  const [recT, setRecT] = useState<RecordTarget | null>(null);
  const openRec = (k: { id: string; name: string; used: number; total: number }) => {
    const last = c.notes.find((n) => n.kind === "physio" && n.data.course_id === k.id)?.data ?? {};
    const s = (v: unknown) => (typeof v === "string" ? v : null);
    setRecT({ courseId: k.id, courseName: k.name, used: k.used, total: k.total, residentName: name, last: { cc: s(last.cc), dx: s(last.dx), pain: s(last.pain), mobility: s(last.mobility) } });
  };
  /** ปิดคอร์สที่ใช้ไปแล้วแต่ไม่ทำต่อ (ผู้จัดการสาขา/ผู้บริหาร) */
  const [closeT, setCloseT] = useState<CloseTarget | null>(null);
  const sessions = c.notes.filter((n) => n.kind === "physio");
  /** บันทึก (clinical_notes) + การเช็คอิน → รูปแบบเดียวกับประวัติ (การ์ด) · แก้ได้ถึง = เวลาบันทึก + 7 วัน */
  const toHist = (n: (typeof sessions)[number]): PhysioHistory => {
    const v = c.visits?.find((x) => x.note_id === n.id), d = n.data, s2 = (x: unknown) => (typeof x === "string" && x ? x : null);
    const t = n.at.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/);
    const until = t ? new Date(Date.parse(`${Number(t[3]) - 543}-${t[2]}-${t[1]}T${t[4]}:${t[5]}:00+07:00`) + 7 * 864e5).toISOString() : null;
    return { id: n.id, title: n.title, body: n.body, author: n.author, at: n.at, pain: s2(d.pain), mobility: s2(d.mobility), plan: s2(d.plan),
      activities: Array.isArray(d.activities) ? (d.activities as string[]) : null, visit_id: v?.id ?? null, checkin: v?.checkin ?? null, done: v?.done ?? null,
      minutes: typeof d.minutes_fixed === "number" ? d.minutes_fixed : v?.minutes ?? (typeof d.minutes === "number" ? d.minutes : null), work_n: v?.work_n ?? null,
      vitals: (d.vitals as PhysioHistory["vitals"]) ?? null, cc: s2(d.cc), pe: s2(d.pe), dx: s2(d.dx), edited: s2(d.edited_at), edited_by: s2(d.edited_by), edit_until: until };
  };
  // ทำกายภาพโดยยังไม่มีคอร์ส (หลังซื้อคอร์สล่าสุด) · เตือนให้แจ้งญาติเปิดคอร์ส
  const key = (at: string) => at.replace(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}).*$/, "$3$2$1$4$5"); // "DD/MM/YYYY HH:MM" → เรียงตามเวลาได้
  const lastBuy = c.courses.map((k) => key(k.at)).sort().pop() ?? "";
  const free = sessions.filter((n) => n.data.nocourse && key(n.at) >= lastBuy).length;
  const active = c.courses.some((k) => k.total - k.used > 0);
  const waiting = c.courses.some((k) => k.total - k.used > 0 && k.price > 0 && !k.invoice_id);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gold-600">ใช้คอร์สทีละครั้งพร้อมบันทึก Progress note · เหลือ 2 ครั้งระบบเตือนให้แจ้งญาติต่อคอร์ส</p>
        <div className="flex flex-wrap gap-2">
          {canSell && <button className="btn-primary !py-2" onClick={() => setBuy({ name: "กายภาพบำบัด (ครั้งละ 45 นาที)", total: "10", price: "", free: false, why: "" })}><Icon name="plus" className="h-4 w-4" /> ซื้อคอร์ส</button>}
        </div>
      </div>
      {free > 0 && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">ทำกายภาพไปแล้ว {free} ครั้งโดยยังไม่มีคอร์ส · แจ้งญาติเปิดคอร์ส · แคชเชียร์กำหนดราคาครั้งที่ทำไปแล้วตอนออกใบแจ้งหนี้</p>}
      {!active && <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{waiting ? "คอร์สกายภาพยังไม่ได้ออกใบแจ้งหนี้ · แจ้งแคชเชียร์ออกใบที่เมนูใบแจ้งหนี้และใบเสร็จก่อนจึงจะบันทึกกายภาพได้" : <>{c.courses.length ? "คอร์สกายภาพใช้ครบแล้ว" : "ยังไม่มีคอร์สกายภาพ"} · ต้องซื้อคอร์สก่อนจึงจะบันทึกการทำกายภาพได้{canSell ? " · กดปุ่ม ซื้อคอร์ส ด้านบน" : " · แจ้งผู้จัดการสาขาหรือฝ่ายขายให้เปิดคอร์สให้ก่อน"}</>}</p>}
      <div className="grid gap-3 md:grid-cols-2">{c.courses.map((k) => {
        const cl = k.status === "ปิดคอร์ส" ? closedInfo(k.name) : null;
        const left = k.total - k.used, pct = Math.round((k.used / (cl ? cl.total : k.total || 1)) * 100);
        return (
          <section key={k.id} className="profile-box">
            <div className="flex items-start justify-between gap-3"><h4 className="!mb-0">{cl ? cl.base : k.name}</h4><span className={`rounded-full px-2 py-0.5 text-xs font-medium ${k.status === "ปิดคอร์ส" ? "bg-red-50 text-red-800" : left <= 0 ? "bg-cream-200 text-gold-600" : left <= 2 ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>{k.status === "ปิดคอร์ส" ? "ปิดคอร์สแล้ว" : left <= 0 ? "ครบแล้ว" : `เหลือ ${left} ครั้ง`}</span></div>
            <p className="mt-1 text-xs text-gold-500">ซื้อเมื่อ {k.at} · โดย {k.created_by ?? "-"}{k.price ? ` · ${money(k.price)} บาท · ${payText(k)}` : ""}</p>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-cream-300"><div className="h-full rounded-full bg-gold-600" style={{ width: `${pct}%` }} /></div>
            <p className="mt-1 text-xs text-gold-600">ใช้ไป {k.used}/{cl ? cl.total : k.total} ครั้ง{cl ? ` · ยกเลิก ${cl.total - cl.used} ครั้งที่เหลือ` : ""}</p>
            {cl && <div className="pc-closed">
              <p><b>ปิดคอร์สแล้ว</b>{cl.by ? <> · โดย <b>{cl.by}</b></> : null}</p>
              {cl.when && <p>{cl.when}</p>}
              <p>เหตุผล: {cl.why}</p>
            </div>}
            {left > 0 && <div className="pa-own">
              <span>{k.therapist_name ? <><b>{teamText({ therapist_id: k.therapist_id ?? null, therapist_name: k.therapist_name ?? null, plan_slots: k.plan_slots, plan_days: k.plan_days ?? null, plan_dates: k.plan_dates })}</b> · {schedText({ plan_days: k.plan_days ?? null, plan_dates: k.plan_dates })} {k.plan_time}{k.plan_minutes ? ` (${k.plan_minutes} นาที)` : ""}</> : <em>ยังไม่มีนักกายภาพผู้รับผิดชอบ</em>}</span>
              {canAssign && <button type="button" className="row-action" onClick={() => openAssign(k.id)}>{k.therapist_name ? "เปลี่ยน" : "จ่ายเคส"}</button>}
            </div>}
            {left > 0 && k.price > 0 && <p className={`pk-pay mt-2 is-${!k.invoice_id ? "none" : k.paid ? "paid" : "open"}`}>{k.paid ? "✓ " : ""}{payText(k)}</p>}
            {left > 0 && (canRecord ? <button className="btn-soft mt-3 w-full !py-2" onClick={() => openRec(k)}>บันทึกการทำกายภาพ (ใช้ 1 ครั้ง)</button>
                : <p className="mt-3 rounded-lg bg-cream-50 px-3 py-2 text-xs text-gold-600">บันทึกกายภาพได้เฉพาะนักกายภาพ{k.therapist_name ? ` (${k.therapist_name})` : ""}</p>)}
            {canSell && k.used > 0 && left > 0 && <button type="button" className="row-action danger mt-2" onClick={() => setCloseT({ id: k.id, name: k.name, used: k.used, total: k.total, resident: name, billed: !!k.invoice_id,
              team: k.therapist_name ? teamText({ therapist_id: k.therapist_id ?? null, therapist_name: k.therapist_name ?? null, plan_slots: k.plan_slots, plan_days: k.plan_days ?? null, plan_dates: k.plan_dates }) : undefined })}>ปิดคอร์ส (ไม่ทำต่อ)</button>}
            {canSell && k.used === 0 && !k.invoice_id && <button className="row-action danger mt-2" onClick={() => confirm({ title: "ยกเลิกคอร์ส", danger: true, okLabel: "ยกเลิกคอร์ส", message: `ยกเลิกคอร์ส ${k.name} ${k.total} ครั้ง (ซื้อเมื่อ ${k.at}) ใช่หรือไม่ · ใช้กับคอร์สที่กดซ้ำหรือบันทึกผิด`, onOk: () => run(toast, { op: "course_cancel", courseId: k.id }, `ยกเลิกคอร์สแล้ว · ${k.name}`, reload) })}>ยกเลิกคอร์ส</button>}
          </section>
        );
      })}</div>
      <div><h4 className="profile-sub">ประเมินและ Progress note</h4>
        <PhysioSessions items={sessions.map(toHist)} onEdit={(h) => { const n = sessions.find((x) => x.id === h.id); const k = c.courses.find((x) => x.id === n?.data.course_id);
          setRecT({ courseId: k?.id ?? "", courseName: k?.name ?? h.title ?? "", used: k?.used ?? 0, total: k?.total ?? 0, residentName: name, edit: h }); }} /></div>
      <PhysioAssign c={assign} cases={board?.cases ?? []} therapists={board?.therapists ?? []} today={board?.date ?? new Date(Date.now() + 7 * 36e5).toISOString().slice(0, 10)}
        doneToday={!!assign && !!board?.today.some((t) => t.course_id === assign.id)} onClose={() => setAssign(null)} onSaved={() => { setBoard(null); reload(); }} />

      <Modal open={!!buy} title="ซื้อคอร์สกายภาพ" onClose={() => setBuy(null)}
        footer={<><button className="btn-soft" onClick={() => setBuy(null)}>ยกเลิก</button>
          {buy && !buy.free && inConsole ? <>
            <button className="btn-soft" onClick={() => buyCourse(false)}>บันทึกคอร์สอย่างเดียว</button>
            <button className="btn-primary" onClick={() => buyCourse(true)}>บันทึกคอร์สและออกใบแจ้งหนี้</button>
          </> : <button className="btn-primary" onClick={() => buyCourse(false)}>บันทึกคอร์ส</button>}</>}>
        {buy && <div className="form-grid">
          {ptCourses.length > 0 && <Field label="เลือกคอร์สจากใบราคา" className="md:col-span-2"><select value={buy.code ?? ""} onChange={(e) => {
            const p = ptCourses.find((x) => x.code === e.target.value);
            setBuy(p ? { ...buy, code: p.code, ...fillFromCourse(p, buy.total) } : { ...buy, code: "" });
          }}><option value="">คอร์สอื่น (พิมพ์ชื่อและราคาเอง)</option>{ptCourses.map((p) => <option key={p.code} value={p.code}>{courseOptText(p)}</option>)}</select>
            <p className="field-hint">เลือกแล้วระบบเติมชื่อ จำนวนครั้ง และราคาให้ · แก้ได้ถ้าตกลงราคาพิเศษ · ไม่มีในใบราคา เลือก "คอร์สอื่น" แล้วพิมพ์เองด้านล่าง</p></Field>}
          <Field label={buy.code ? "ชื่อคอร์ส (เติมจากใบราคา · แก้ได้)" : "ชื่อคอร์ส · พิมพ์เอง"} className="md:col-span-2"><input value={buy.name} onChange={(e) => setBuy({ ...buy, name: e.target.value })} /></Field>
          <Field label="จำนวนครั้ง"><input type="number" min={1} value={buy.total} onChange={(e) => setBuy({ ...buy, total: e.target.value })} /></Field>
          <Field label="ราคาคอร์ส (บาท)" required={!buy.free}><input type="number" min={0} value={buy.free ? "" : buy.price} disabled={buy.free} onChange={(e) => setBuy({ ...buy, price: e.target.value })} placeholder="เช่น 8000" />
            <p className="field-hint">ซื้อแล้วนักกายภาพเริ่มทำได้ทันที · กด &quot;บันทึกคอร์สและออกใบแจ้งหนี้&quot; เพื่อออกใบต่อเลย (ผู้ชำระ ส่วนลด เลขผู้เสียภาษี และรวมรายการอื่นได้)</p></Field>
          {boss && <label className="md:col-span-2 flex items-center gap-2 text-sm text-gold-700"><input type="checkbox" className="!h-4 !w-4 !min-h-0" checked={buy.free} onChange={(e) => setBuy({ ...buy, free: e.target.checked })} /> ให้คอร์สนี้ฟรี (ผู้จัดการอนุมัติ)</label>}
          {buy.free && <Field label="เหตุผลที่ให้ฟรี" required className="md:col-span-2"><input value={buy.why} onChange={(e) => setBuy({ ...buy, why: e.target.value })} placeholder="เช่น โปรโมชันเปิดสาขา, ทดลองครั้งแรก" /></Field>}
        </div>}
      </Modal>
      <PhysioRecordModal target={recT} onClose={() => setRecT(null)} onSaved={() => { setRecT(null); reload(); }} />
      <PhysioCloseCourse target={closeT} onClose={() => setCloseT(null)} onDone={() => { setBoard(null); reload(); }} />
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
  const loadItems = useCallback(() => { call<{ items: SupplyItem[] }>("/api/clinic?op=supplies").then((d) => setItems(d.items)).catch(() => {}); }, []);
  useEffect(loadItems, [loadItems]);
  const it = items.find((x) => x.id === pick.item);
  const unbilled = c.supplies.filter((s) => !s.invoice_id);
  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h4 className="profile-sub">เบิกเวชภัณฑ์ให้ผู้รับบริการ</h4>
        <div className="grid gap-2 sm:grid-cols-[1fr_100px_auto]">
          <SearchSelect value={pick.item} onChange={(v) => setPick({ ...pick, item: v })} ariaLabel="เวชภัณฑ์" placeholder="พิมพ์ค้นหา เช่น ผ้าอ้อม"
            items={items.map((x) => ({ value: x.id, label: x.name, sub: `${money(x.price)} บาท / ${x.unit}`, disabled: x.stock < 1,
              badge: x.stock < 1 ? "หมด · เลือกไม่ได้" : x.stock <= 5 ? `เหลือน้อย ${x.stock} ${x.unit}` : `เหลือ ${x.stock} ${x.unit}`, tone: x.stock < 1 ? "muted" as const : x.stock <= 5 ? "warn" as const : "ok" as const }))} />
          <input type="number" min={1} value={pick.qty} onChange={(e) => setPick({ ...pick, qty: e.target.value })} aria-label="จำนวน" />
          <button className="btn-primary !py-2" onClick={() => !it ? toast("กรุณาเลือกเวชภัณฑ์") : run(toast, { op: "supply_issue", residentId: id, itemId: it.id, qty: Number(pick.qty) }, `เบิกเวชภัณฑ์แล้ว · ${it.name} ${pick.qty} ${it.unit}`, () => { setPick({ item: "", qty: "1" }); reload(); loadItems(); })}>เบิก</button>
        </div>
        {!items.length && <p className="text-sm text-gold-600">ยังไม่มีเวชภัณฑ์ในคลังของสาขา{manage ? "" : " · แจ้งหัวหน้าพยาบาลหรือผู้จัดการให้เพิ่มรายการ"}</p>}
      </section>
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h4 className="profile-sub !mb-0">ประวัติการเบิก</h4>{unbilled.length > 0 && <span className="text-xs text-amber-800">ยังไม่เรียกเก็บ {unbilled.length} รายการ · {money(unbilled.reduce((n, s) => n + s.qty * s.price, 0))} บาท (ดึงเข้าใบแจ้งหนี้ได้ที่เมนูใบแจ้งหนี้และใบเสร็จ)</span>}</div>
        <DataTable search={false} columns={["วันเวลา", "รายการ", "จำนวน", "ราคารวม", "ผู้เบิก", "เรียกเก็บ"]} empty="ยังไม่มีการเบิก"
          rows={c.supplies.map((s) => [s.at, s.item_name, `${s.qty} ${s.unit}`, money(s.qty * s.price), s.issued_by ?? "-", s.invoice_id ? "ออกใบแจ้งหนี้แล้ว" : "ยังไม่เรียกเก็บ"])} />
      </div>
      {manage && <p className="text-sm text-gold-600">เพิ่มรายการ ตั้งราคา หรือเติมสต็อก ได้ที่ <a className="font-medium text-gold-800 underline" href="/pharmacy?page=supplies">ห้องยา › คลังเวชภัณฑ์</a></p>}
    </div>
  );
}
