"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Icon from "../Icon";
import { useApp } from "@/lib/app";
import { useSession } from "@/lib/session";
import { can } from "@/lib/perms";
import { useBranchNames } from "@/lib/branches";
import { money } from "@/lib/billing";
import { useAutoRefresh } from "@/lib/autoRefresh";
import { DataTable, Field, MetricGrid, Modal, PageHeader, Section, Select } from "../ui";

/**
 * คลังเวชภัณฑ์ของสาขา (ผ้าอ้อม ถุงมือ สายให้อาหาร ฯลฯ)
 *  เพิ่มรายการ ตั้งราคา เติมสต็อก = ผู้มีสิทธิ์ "ผู้รับบริการ" (หัวหน้าพยาบาล ผู้จัดการ)
 *  เบิกให้ผู้ป่วยยังทำที่ประวัติผู้รับบริการ แท็บเวชภัณฑ์ · ยอดเบิกขึ้นเป็น "ยังไม่เรียกเก็บ" ที่หน้าใบแจ้งหนี้และใบเสร็จ
 */
type Item = { id: string; branch_name: string; name: string; unit: string; price: number; stock: number };
type Form = { id?: string; branch: string; name: string; unit: string; price: string; stock: string; add: string };

const LOW = 5;
const UNITS = ["ชิ้น", "ห่อ", "แพ็ก", "กล่อง", "ม้วน", "ขวด", "ถุง", "คู่", "เส้น", "ชุด"];

export default function SupplyStock() {
  const { toast } = useApp();
  const { user } = useSession();
  const manage = can(user, "residents");
  const branchNames = useBranchNames();
  const [branch, setBranch] = useState("");
  const [items, setItems] = useState<Item[] | null>(null);
  const [err, setErr] = useState("");
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/clinic?op=supplies", { cache: "no-store" })
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "โหลดคลังเวชภัณฑ์ไม่สำเร็จ"); setItems(d.items); setErr(""); })
      .catch((e) => setErr((e as Error).message));
  }, []);
  useEffect(load, [load]);
  useAutoRefresh(load);

  const multi = branchNames.length > 1;
  const shown = useMemo(() => (items ?? []).filter((x) => !branch || x.branch_name === branch), [items, branch]);

  const save = async () => {
    if (!form || busy) return;
    const name = form.name.trim(), price = Number(form.price), stock = Math.floor(Number(form.stock) || 0) + Math.floor(Number(form.add) || 0);
    if (!name) return toast("กรุณากรอกชื่อเวชภัณฑ์");
    if (!(price >= 0) || form.price === "") return toast("กรุณากรอกราคาต่อหน่วย (ใส่ 0 ถ้าไม่คิดเงิน)");
    if (stock < 0) return toast("จำนวนคงเหลือต้องไม่ติดลบ");
    if (!form.id && multi && !form.branch) return toast("กรุณาเลือกสาขา");
    setBusy(true);
    try {
      const r = await fetch("/api/clinic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "supply_item", id: form.id, branch: form.branch, name, unit: form.unit, price, stock }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "บันทึกไม่สำเร็จ");
      const added = Math.floor(Number(form.add) || 0);
      toast(form.id ? `บันทึกแล้ว · ${name}${added ? ` · รับเข้า ${added} ${form.unit}` : ""} · คงเหลือ ${stock} ${form.unit}` : `เพิ่มเวชภัณฑ์แล้ว · ${name} · คงเหลือ ${stock} ${form.unit}`);
      setForm(null); load();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <>
      <PageHeader title="คลังเวชภัณฑ์" sub="ผ้าอ้อม ถุงมือ สายให้อาหาร และของใช้ที่คิดเงินผู้ป่วย แยกตามสาขา · เบิกให้ผู้ป่วยที่ประวัติผู้รับบริการ แท็บเวชภัณฑ์"
        actions={<>
          {multi && <div className="min-w-44"><Select options={branchNames} placeholder="รวมทุกสาขา" value={branch} onChange={setBranch} /></div>}
          {manage && <button className="btn-primary" onClick={() => setForm({ branch: branch || (multi ? "" : branchNames[0] ?? ""), name: "", unit: "ชิ้น", price: "", stock: "", add: "" })}><Icon name="plus" className="h-4 w-4" /> เพิ่มเวชภัณฑ์</button>}
        </>} />
      {err && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</p>}
      <MetricGrid items={[
        { label: "รายการเวชภัณฑ์", value: shown.length, unit: "รายการ", icon: "files", accent: true },
        { label: "มีในคลัง", value: shown.filter((x) => x.stock > 0).length, unit: "รายการ", icon: "check" },
        { label: "เหลือน้อย", value: shown.filter((x) => x.stock > 0 && x.stock <= LOW).length, unit: "รายการ", icon: "alert", note: `เหลือไม่เกิน ${LOW}` },
        { label: "หมดแล้ว", value: shown.filter((x) => x.stock <= 0).length, unit: "รายการ", icon: "close" },
      ]} />
      <Section title={branch ? `คงเหลือของสาขา${branch}` : multi ? "คงเหลือทุกสาขา" : "คงเหลือในคลัง"}>
        <DataTable columns={[...(multi && !branch ? ["สาขา"] : []), "รายการ", "หน่วย", "ราคา/หน่วย (บาท)", "คงเหลือ", "สถานะ"]}
          rows={shown.map((x) => [...(multi && !branch ? [x.branch_name] : []), x.name, x.unit, money(x.price), `${x.stock} ${x.unit}`, x.stock <= 0 ? "หมด" : x.stock <= LOW ? "เหลือน้อย" : "ปกติ"])}
          empty={!items ? "กำลังโหลด…" : manage ? "ยังไม่มีเวชภัณฑ์ · กด เพิ่มเวชภัณฑ์ ที่มุมขวาบน" : "ยังไม่มีเวชภัณฑ์ในคลัง · แจ้งหัวหน้าพยาบาลหรือผู้จัดการให้เพิ่มรายการ"}
          actions={manage ? [{ label: "เติมสต็อก / แก้ไข", onClick: (i) => { const x = shown[i]; setForm({ id: x.id, branch: x.branch_name, name: x.name, unit: x.unit, price: String(x.price), stock: String(x.stock), add: "" }); } }] : []} />
      </Section>

      <Modal open={!!form} title={form?.id ? `เติมสต็อก / แก้ไข · ${form.name}` : "เพิ่มเวชภัณฑ์"} onClose={() => setForm(null)}
        footer={<><button className="btn-soft" onClick={() => setForm(null)}>ยกเลิก</button><button className="btn-primary" disabled={busy} onClick={save}>{busy ? "กำลังบันทึก…" : "บันทึก"}</button></>}>
        {form && <div className="space-y-4">
          <div className="form-grid">
            {!form.id && multi && <Field label="สาขา" required className="md:col-span-2"><Select options={branchNames} placeholder="-- เลือกสาขา --" value={form.branch} onChange={(v) => setForm({ ...form, branch: v })} /></Field>}
            <Field label="ชื่อเวชภัณฑ์" required className="md:col-span-2"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="เช่น ผ้าอ้อมผู้ใหญ่ ไซซ์ L" /></Field>
            <Field label="หน่วย"><input list="supply-units" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /><datalist id="supply-units">{UNITS.map((u) => <option key={u} value={u} />)}</datalist></Field>
            <Field label="ราคาต่อหน่วย (บาท)" required><input type="number" min={0} value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} placeholder="เช่น 25" /></Field>
            <Field label={form.id ? "คงเหลือตอนนี้ (แก้ได้ถ้านับแล้วไม่ตรง)" : "จำนวนเริ่มต้น"}><input type="number" min={0} value={form.stock} onChange={(e) => setForm({ ...form, stock: e.target.value })} /></Field>
            {form.id && <Field label={`รับเข้าเพิ่ม (${form.unit})`}><input type="number" min={0} value={form.add} onChange={(e) => setForm({ ...form, add: e.target.value })} placeholder="เช่น 50" /></Field>}
          </div>
          {form.id && Number(form.add) > 0 && <p className="field-hint is-ok">หลังบันทึก คงเหลือ {Math.floor(Number(form.stock) || 0) + Math.floor(Number(form.add) || 0)} {form.unit}</p>}
        </div>}
      </Modal>
    </>
  );
}
