"use client";
import { useState } from "react";
import Icon from "../Icon";
import { ASSESSMENTS } from "@/lib/mock";
import { downloadCsv, useCrud } from "@/lib/store";
import { useApp } from "@/lib/app";
import { useSession } from "@/lib/session";
import { money } from "@/lib/billing";
import { handoff } from "@/lib/handoff";
import { longDate, PrintModal, QuoteDoc, QuoteItem } from "../print/Docs";
import { useBranchInfo } from "./Billing";
import { DataTable, Field, Modal, PageHeader, Section, SuggestInput } from "../ui";

/**
 * ใบเสนอราคาและแผนการดูแล
 * แถว: [ชื่อแผน, ผู้รับบริการ, โรคประจำตัว, เบอร์ติดต่อ, ราคารวม, หมายเหตุ, เลขที่ (ระบบออก), วันที่, ยืนราคา (วัน), ผู้ชำระ, ระดับการดูแล, รายการ (JSON), สัญญาที่เปิดจากใบนี้]
 * กด "เปิดสัญญา" = ไปหน้าสัญญาพร้อมข้อมูลจากใบนี้ ไม่ต้องกรอกซ้ำ
 */
const CARE_LEVELS = ["ช่วยเหลือตัวเองได้", "ต้องการความช่วยเหลือบางส่วน", "ติดเตียง", "ฟื้นฟูหลังโรคหลอดเลือดสมอง"];
const UNITS = ["เดือน", "ครั้ง", "วัน", "ชุด", "รายการ"];
const blankItem = (): QuoteItem => ({ desc: "", qty: 1, unit: "ครั้ง", price: 0 });
const numOf = (v?: string) => Number(String(v ?? "").replace(/,/g, "")) || 0;
const has = (v?: string) => !!v && v !== "-";
const itemsOf = (r: string[]): QuoteItem[] => {
  try { const x = JSON.parse(r[11] || "[]"); if (Array.isArray(x) && x.length) return x; } catch { /* แถวเก่าที่ยังไม่มีรายการ */ }
  return [{ desc: r[0] || "ค่าบริการ", qty: 1, unit: "เดือน", price: numOf(r[4]) }];
};
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const expired = (r: string[]) => has(r[7]) && new Date(r[7]).getTime() + (Number(r[8]) || 30) * 864e5 < Date.now();
const totalOf = (items: QuoteItem[]) => items.reduce((n, x) => n + x.qty * x.price, 0);
type QForm = { i: number | null; plan: string; who: string; chronic: string; phone: string; payer: string; level: string; date: string; days: string; note: string; items: QuoteItem[] };

export function Quotations() {
  const { rows, ids, add, update, remove } = useCrud("assessments", ASSESSMENTS);
  const res = useCrud("residents", []);
  const { toast, confirm, go } = useApp();
  const { user } = useSession();
  const branchInfo = useBranchInfo();
  const [q, setQ] = useState("");
  const [f, setF] = useState<QForm | null>(null);
  const [print, setPrint] = useState<number | null>(null);
  const shown = rows.map((r, i) => ({ r, i })).filter(({ r }) => !q || [r[0], r[1], r[6], r[9]].some((x) => (x ?? "").includes(q)));
  const resident = (name: string) => res.rows.find((x) => x[0] === name);

  const open = (i: number | null) => {
    const r = i !== null ? rows[i] : null;
    setF(r ? { i, plan: r[0], who: r[1], chronic: has(r[2]) ? r[2] : "", phone: has(r[3]) ? r[3] : "", payer: has(r[9]) ? r[9] : "", level: has(r[10]) ? r[10] : CARE_LEVELS[1],
      date: has(r[7]) ? r[7] : today(), days: has(r[8]) ? r[8] : "30", note: has(r[5]) ? r[5] : "", items: itemsOf(r) }
      : { i: null, plan: "", who: "", chronic: "", phone: "", payer: "", level: CARE_LEVELS[1], date: today(), days: "30", note: "", items: [{ desc: "ห้องพักพร้อมการดูแลพื้นฐาน 24 ชม.", qty: 1, unit: "เดือน", price: 0 }] });
  };
  const save = () => {
    if (!f) return;
    const items = f.items.filter((x) => x.desc.trim());
    if (!f.who.trim()) return toast("กรุณาระบุชื่อผู้รับบริการ");
    if (!items.length) return toast("กรุณาเพิ่มรายการบริการอย่างน้อย 1 รายการ");
    if (items.some((x) => !(x.qty > 0) || x.price < 0)) return toast("กรุณาตรวจจำนวนและราคาของแต่ละรายการ");
    const prev = f.i !== null ? rows[f.i] : [];
    const row = [f.plan.trim() || items[0].desc, f.who.trim(), f.chronic.trim() || "-", f.phone.trim() || "-", String(totalOf(items)), f.note.trim() || "-",
      prev[6] ?? "", f.date, f.days || "30", f.payer.trim() || "-", f.level, JSON.stringify(items), prev[12] ?? "-"];
    if (f.i !== null) update(f.i, row); else add(row);
    toast(`${f.i !== null ? "แก้ไขใบเสนอราคาแล้ว" : "สร้างใบเสนอราคาแล้ว"} · ${row[1]} · ${money(totalOf(items))} บาท${f.i === null ? " · ระบบออกเลขที่ให้" : ""}`);
    setF(null);
  };
  /** เปิดสัญญาจากใบเสนอราคา: รายการหน่วย "เดือน" รวมเป็นค่าบริการรายเดือน · รายการอื่นเป็นค่าใช้จ่ายเพิ่มเติม */
  const toContract = (i: number) => {
    const r = rows[i];
    if (has(r[12])) return toast(`ใบเสนอราคานี้เปิดสัญญาไปแล้ว · ${r[12]}`);
    const items = itemsOf(r);
    const monthly = items.filter((x) => x.unit === "เดือน").reduce((n, x) => n + x.qty * x.price, 0);
    const extra = items.filter((x) => x.unit !== "เดือน");
    const p = resident(r[1]);
    const prefill = ["", p?.[3] ?? user?.branch ?? "", r[1], has(r[9]) ? r[9] : "", monthly ? String(monthly) : "", "รอชำระเงินมัดจำ", "", "", "", has(r[3]) ? r[3].replace(/\D/g, "") : "", "", "", "", p?.[1] && p[1] !== "-" ? p[1] : "",
      r[0], extra.map((x) => `${x.desc} ${x.qty} ${x.unit}`).join(", "), extra.length ? String(extra.reduce((n, x) => n + x.qty * x.price, 0)) : "", "", "", "", `เปิดจากใบเสนอราคา ${r[6] || ""}`.trim()];
    handoff.set({ prefill, quoteId: ids[i], quoteNo: r[6] || "" });
    go("contracts");
  };

  const r = print !== null ? rows[print] : null;
  return (
    <>
      <PageHeader
        title="ใบเสนอราคาและแผนการดูแล"
        sub="ประเมินระดับการดูแล เสนอราคา พิมพ์ให้ลูกค้า แล้วกดเปิดสัญญาได้ทันทีโดยไม่ต้องกรอกซ้ำ"
        actions={<>
          <button className="btn-soft" onClick={() => downloadCsv("ใบเสนอราคา", ["เลขที่", "วันที่", "ผู้รับบริการ", "ผู้ชำระ", "แผน", "รวม (บาท)", "สัญญา"], rows.map((x) => [x[6], x[7], x[1], x[9], x[0], x[4], x[12]]))}><Icon name="download" className="h-4 w-4" /> ส่งออก CSV</button>
          <button className="btn-primary" onClick={() => open(null)}><Icon name="plus" className="h-4 w-4" /> สร้างใบเสนอราคา</button>
        </>}
      />
      <Section>
        <div className="mb-4 max-w-md"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาเลขที่ ชื่อผู้รับบริการ หรือผู้ชำระ" aria-label="ค้นหาใบเสนอราคา" /></div>
        <DataTable search={false}
          columns={["เลขที่", "วันที่", "ผู้รับบริการ", "ผู้ชำระ", "แผน", "รวม (บาท)", "สถานะ"]}
          rows={shown.map(({ r }) => [r[6] || "กำลังออกเลข…", has(r[7]) ? longDate(r[7], true) : "-", r[1], has(r[9]) ? r[9] : "-", r[0], money(numOf(r[4])),
            has(r[12]) ? "เปิดสัญญาแล้ว" : expired(r) ? "หมดอายุ" : "รอตัดสินใจ"])}
          empty="ยังไม่มีใบเสนอราคา · กด สร้างใบเสนอราคา"
          actions={[
            { label: "พิมพ์", onClick: (n) => setPrint(shown[n].i) },
            { label: "เปิดสัญญา", hidden: (n) => has(shown[n].r[12]), onClick: (n) => toContract(shown[n].i) },
            { label: "แก้ไข", onClick: (n) => open(shown[n].i) },
            { label: "ลบ", danger: true, onClick: (n) => confirm({ title: "ลบใบเสนอราคา", message: `ต้องการลบใบเสนอราคา ${shown[n].r[6] || ""} ของ ${shown[n].r[1]} ใช่หรือไม่`, danger: true, okLabel: "ลบ",
              onOk: () => { const x = shown[n].r; remove(shown[n].i); toast(`ลบใบเสนอราคาแล้ว · ${x[6] || ""} ${x[1]}`.trim()); } }) },
          ]} />
      </Section>

      <Modal open={!!f} wide title={f && f.i !== null ? "แก้ไขใบเสนอราคา" : "สร้างใบเสนอราคา"} onClose={() => setF(null)}
        footer={<><button className="btn-soft" onClick={() => setF(null)}>ยกเลิก</button><button className="btn-primary" onClick={save}>บันทึกใบเสนอราคา</button></>}>
        {f && <div className="space-y-5">
          <div className="form-grid">
            <Field label="ผู้รับบริการ" required><SuggestInput value={f.who} options={res.rows.map((x) => x[0])} placeholder="พิมพ์ชื่อ หรือเลือกจากทะเบียน"
              onChange={(v) => { const x = resident(v); setF({ ...f, who: v, chronic: x && !f.chronic && has(x[4]) ? x[4] : f.chronic }); }} /></Field>
            <Field label="ผู้ชำระ / ผู้ติดต่อ"><input value={f.payer} onChange={(e) => setF({ ...f, payer: e.target.value })} placeholder="เช่น คุณสมศรี ใจดี (บุตร)" /></Field>
            <Field label="เบอร์โทรติดต่อ"><input value={f.phone} inputMode="tel" onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="08X-XXX-XXXX" /></Field>
            <Field label="ระดับการดูแลที่ประเมิน"><select value={f.level} onChange={(e) => setF({ ...f, level: e.target.value })}>{CARE_LEVELS.map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="โรคประจำตัว"><input value={f.chronic} onChange={(e) => setF({ ...f, chronic: e.target.value })} placeholder="เช่น เบาหวาน ความดันโลหิตสูง" /></Field>
            <Field label="ชื่อแผนการดูแล"><input value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} placeholder="เช่น แผนดูแลระดับ 2 + กายภาพ" /></Field>
            <Field label="วันที่"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field label="ยืนราคา (วัน)"><input type="number" min={1} value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /></Field>
          </div>
          <div>
            <p className="label">รายการบริการ <small className="font-normal text-gold-500">· หน่วย &quot;เดือน&quot; จะเป็นค่าบริการรายเดือนตอนเปิดสัญญา</small></p>
            <div className="space-y-2">{f.items.map((x, k) => {
              const set = (p: Partial<QuoteItem>) => setF({ ...f, items: f.items.map((y, j) => (j === k ? { ...y, ...p } : y)) });
              return (
                <div key={k} className="quote-line">
                  <input value={x.desc} onChange={(e) => set({ desc: e.target.value })} placeholder="รายการ เช่น กายภาพบำบัด" aria-label="รายการ" />
                  <input type="number" min={0} value={x.qty} onChange={(e) => set({ qty: Number(e.target.value) || 0 })} aria-label="จำนวน" />
                  <select value={x.unit} onChange={(e) => set({ unit: e.target.value })} aria-label="หน่วย">{UNITS.map((u) => <option key={u}>{u}</option>)}</select>
                  <input type="number" min={0} value={x.price} onChange={(e) => set({ price: Number(e.target.value) || 0 })} aria-label="ราคาต่อหน่วย" />
                  <button type="button" className="row-action danger" disabled={f.items.length === 1} onClick={() => setF({ ...f, items: f.items.filter((_, j) => j !== k) })}>ลบ</button>
                </div>
              );
            })}</div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <button type="button" className="btn-soft !py-2" onClick={() => setF({ ...f, items: [...f.items, blankItem()] })}><Icon name="plus" className="h-4 w-4" /> เพิ่มรายการ</button>
              <b className="text-gold-800">รวม {money(totalOf(f.items))} บาท</b>
            </div>
          </div>
          <Field label="หมายเหตุ / เงื่อนไขเพิ่มเติม"><textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        </div>}
      </Modal>

      <PrintModal open={!!r} title="ใบเสนอราคา" onClose={() => setPrint(null)}>
        {r && <QuoteDoc no={r[6]} date={has(r[7]) ? r[7] : today()} validDays={Number(r[8]) || 30} payer={has(r[9]) ? r[9] : r[1]} resident={r[1]}
          age={resident(r[1])?.[1]} chronic={has(r[2]) ? r[2] : undefined} level={r[10]} items={itemsOf(r)} note={has(r[5]) ? r[5] : undefined}
          branch={branchInfo(resident(r[1])?.[3] ?? user?.branch ?? "")} by={user?.name} />}
      </PrintModal>
    </>
  );
}
