"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Icon from "../Icon";
import { useApp } from "@/lib/app";
import { useResidents } from "@/lib/care";
import { useBranchNames } from "@/lib/branches";
import { money } from "@/lib/billing";
import { MEALS } from "@/lib/pharmacy";
import { refreshData } from "@/lib/store";
import { useAutoRefresh } from "@/lib/autoRefresh";
import { DataTable, Field, Modal, PageHeader, Section, Select, StatFilter } from "../ui";
import { SearchSelect } from "../SearchSelect";

/**
 * คลังยากลางของศูนย์ (ยาที่ศูนย์ซื้อเอง แยกจากยาของผู้ป่วย)
 *  แยกตามสาขา · ราคาขายเดียวทุกสาขา (ผู้จัดการคลังตั้ง) · ผู้บริหาร/ผู้จัดการสาขา/หัวหน้าพยาบาล รับเข้าและปรับสต็อก · พยาบาลเบิกให้ผู้ป่วย
 *  เบิกแล้วขึ้นเป็นรายการ "ยังไม่เรียกเก็บ" ให้แคชเชียร์ดึงเข้าใบแจ้งหนี้ · ติ๊ก "ใส่เข้าตะกร้า" = ยาประจำ ขึ้นหน้าจัดยารายวันตามมื้อ
 */
type SDrug = { id: string; name: string; unit: string; form: string | null; price: number | null; min_qty: number; note: string | null };
type Lot = { id: string; branch_name: string; drug_id: string; lot: string | null; expiry: string | null; qty: number; cost: number | null };
type Move = { branch_name: string; delta: number; reason: string; resident_name: string | null; price: number | null; invoice_id: string | null; note: string | null; moved_by: string | null; lot: string | null; at: string };
type List = { branch: string | null; drugs: SDrug[]; lots: Lot[]; manager: boolean; pricer: boolean; reasons: string[] };

const UNITS = ["เม็ด", "แคปซูล", "ซอง", "ml", "ขวด", "หลอด", "แผง", "อัน"];
const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const thDate = (iso?: string | null) => { if (!iso) return "-"; const [y, m, d] = iso.split("-"); return `${d}/${m}/${Number(y) + 543}`; };
const daysTo = (iso?: string | null) => (iso ? Math.ceil((new Date(iso).getTime() - Date.now()) / 864e5) : null);
const NEAR = 60;

async function call<T>(url: string, body?: object): Promise<T> {
  const r = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "ทำรายการไม่สำเร็จ");
  return d as T;
}

export default function CentralStock() {
  const { toast } = useApp();
  const branchNames = useBranchNames();
  const { residents } = useResidents();
  const [branch, setBranch] = useState("");
  const [data, setData] = useState<List | null>(null);
  const [err, setErr] = useState("");
  const [item, setItem] = useState<{ id?: string; name: string; unit: string; form: string; price: string; min: string; note: string } | null>(null);
  const [recv, setRecv] = useState<{ drug: SDrug; qty: string; lot: string; expiry: string; cost: string } | null>(null);
  const [adj, setAdj] = useState<{ drug: SDrug; lot: Lot; qty: string; reason: string; note: string } | null>(null);
  const [issue, setIssue] = useState<{ drug: SDrug; resident: string; qty: string; note: string; basket: boolean; dose: string; meals: string[] } | null>(null);
  const [hist, setHist] = useState<{ drug: SDrug; moves: Move[] | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    call<List>(`/api/pharmstock?op=list${branch ? `&branch=${encodeURIComponent(branch)}` : ""}`).then((d) => { setData(d); setErr(""); }).catch((e) => setErr((e as Error).message));
  }, [branch]);
  useEffect(load, [load]);
  useAutoRefresh(load);
  const global = data !== null && data.branch === null && !branch;

  const rows = useMemo(() => (data?.drugs ?? []).map((d) => {
    const lots = (data?.lots ?? []).filter((l) => l.drug_id === d.id);
    const qty = lots.reduce((n, l) => n + l.qty, 0);
    const exp = lots.map((l) => l.expiry).filter(Boolean).sort()[0] ?? null;
    return { d, lots, qty, exp, low: qty <= d.min_qty, near: (daysTo(exp) ?? 999) <= NEAR };
  }), [data]);
  const pick = residents.filter((r) => !branch || r.branch_name === branch);

  const run = async (body: object, ok: string, done: () => void) => {
    if (busy) return; setBusy(true);
    try { await call("/api/pharmstock", body); toast(ok); done(); load(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  /** ตัวกรอง: "" ทั้งหมด · low ใกล้หมด · near ใกล้หมดอายุ · out หมดแล้ว */
  const [sf, setSf] = useState("");
  const view = rows.filter((x) => !sf || (sf === "low" ? x.low : sf === "near" ? x.near : !x.qty));
  const openHist = (drug: SDrug) => {
    setHist({ drug, moves: null });
    call<{ moves: Move[] }>(`/api/pharmstock?op=moves&drug=${encodeURIComponent(drug.id)}${branch ? `&branch=${encodeURIComponent(branch)}` : ""}`).then((r) => setHist({ drug, moves: r.moves })).catch((e) => { setHist(null); toast((e as Error).message); });
  };
  const needBranch = () => { if (global) { toast("กรุณาเลือกสาขาก่อน (มุมขวาบน)"); return true; } return false; };

  return (
    <>
      <PageHeader title="คลังยากลางของศูนย์" sub="ยาที่ศูนย์ซื้อ · เบิกแล้วดึงเข้าใบแจ้งหนี้ได้"
        actions={<>
          {branchNames.length > 1 && <div className="min-w-44"><Select options={branchNames} placeholder="รวมทุกสาขา" value={branch} onChange={setBranch} /></div>}
          {data?.manager && <button className="btn-primary" onClick={() => setItem({ name: "", unit: "เม็ด", form: "", price: "", min: "10", note: "" })}><Icon name="plus" className="h-4 w-4" /> เพิ่มรายการยา</button>}
        </>} />
      {err && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</p>}
      <Section title={global ? "คงเหลือรวมทุกสาขา" : `คงเหลือของสาขา${data?.branch ?? branch}`}>
        <StatFilter label="กรองรายการยา" value={sf} onChange={setSf} items={[
          { k: "", t: "ทั้งหมด", n: rows.length, tone: "all" },
          { k: "low", t: "ใกล้หมด", n: rows.filter((x) => x.low).length, tone: "warn" },
          { k: "near", t: `หมดอายุใน ${NEAR} วัน`, n: rows.filter((x) => x.near).length, tone: "bad" },
          { k: "out", t: "หมดแล้ว", n: rows.filter((x) => !x.qty).length, tone: "muted" },
        ]} />
        <DataTable columns={["ชื่อยา", "คงเหลือ", "จุดสั่งซื้อ", "หมดอายุใกล้สุด", "ราคาขาย/หน่วย", "สถานะ"]}
          rows={view.map((x) => [x.d.name, `${fmt(x.qty)} ${x.d.unit}`, `${x.d.min_qty} ${x.d.unit}`, x.exp ? `${thDate(x.exp)}${(daysTo(x.exp) ?? 999) <= NEAR ? ` (อีก ${daysTo(x.exp)} วัน)` : ""}` : "-",
            x.d.price === null ? "ยังไม่ตั้งราคา" : money(x.d.price), !x.qty ? "หมด" : x.near ? "ใกล้หมดอายุ" : x.low ? "ใกล้หมด" : "ปกติ"])}
          empty={!data ? "กำลังโหลด…" : data.manager ? "ยังไม่มีรายการยา · กด เพิ่มรายการยา ที่มุมขวาบน" : "ยังไม่มีรายการยาในคลังกลาง · หัวหน้าพยาบาลหรือผู้จัดการสาขาเป็นผู้เพิ่มรายการและรับยาเข้า"}
          onRow={(i) => openHist(view[i].d)} rowLabel="กดเพื่อดูประวัติการเคลื่อนไหวของยานี้"
          actions={[
            { label: "เบิกให้ผู้ป่วย", tone: "primary", hidden: (i) => !view[i].qty, onClick: (i) => { if (!needBranch()) setIssue({ drug: view[i].d, resident: "", qty: "1", note: "", basket: false, dose: "1", meals: ["เช้า"] }); } },
            { label: "รับเข้า", tone: "primary", hidden: (i) => !data?.manager || view[i].qty > 0, onClick: (i) => { if (!needBranch()) setRecv({ drug: view[i].d, qty: "", lot: "", expiry: "", cost: "" }); } },
            { label: "รับเข้า", more: true, hidden: (i) => !data?.manager || !view[i].qty, onClick: (i) => { if (!needBranch()) setRecv({ drug: view[i].d, qty: "", lot: "", expiry: "", cost: "" }); } },
            { label: "ปรับ / ตรวจนับ", more: true, hidden: (i) => !data?.manager || !view[i].lots.length, onClick: (i) => { if (!needBranch()) setAdj({ drug: view[i].d, lot: view[i].lots[0], qty: String(view[i].lots[0].qty), reason: data?.reasons[0] ?? "", note: "" }); } },
            { label: "ประวัติการเคลื่อนไหว", more: true, onClick: (i) => openHist(view[i].d) },
            { label: "แก้ไขรายการยา", more: true, hidden: () => !data?.manager, onClick: (i) => { const d = view[i].d; setItem({ id: d.id, name: d.name, unit: d.unit, form: d.form ?? "", price: d.price === null ? "" : String(d.price), min: String(d.min_qty), note: d.note ?? "" }); } },
          ]} />
      </Section>

      <Modal open={!!item} title={item?.id ? "แก้ไขรายการยา" : "เพิ่มรายการยาในคลังกลาง"} onClose={() => setItem(null)}
        footer={<><button className="btn-soft" onClick={() => setItem(null)}>ยกเลิก</button><button className="btn-primary" disabled={busy} onClick={() => item && run({ op: "item", ...item, price: item.price === "" ? null : Number(item.price), min: Number(item.min) }, `${item.id ? "แก้ไขรายการยาแล้ว" : "เพิ่มรายการยาแล้ว"} · ${item.name}`, () => setItem(null))}>บันทึก</button></>}>
        {item && <div className="form-grid">
          <Field label="ชื่อยา" required className="md:col-span-2"><input value={item.name} onChange={(e) => setItem({ ...item, name: e.target.value })} placeholder="เช่น Paracetamol 500 mg" /></Field>
          <Field label="หน่วย"><select value={item.unit} onChange={(e) => setItem({ ...item, unit: e.target.value })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></Field>
          <Field label="จุดสั่งซื้อ (เตือนเมื่อเหลือไม่เกิน)"><input type="number" min={0} value={item.min} onChange={(e) => setItem({ ...item, min: e.target.value })} /></Field>
          <Field label="ราคาขายต่อหน่วย (บาท · ทุกสาขา)"><input type="number" min={0} disabled={!data?.pricer} value={item.price} onChange={(e) => setItem({ ...item, price: e.target.value })} placeholder={data?.pricer ? "เช่น 2" : "ผู้จัดการ/หัวหน้าพยาบาลเป็นผู้ตั้งราคา"} /></Field>
          <Field label="รูปแบบ"><input value={item.form} onChange={(e) => setItem({ ...item, form: e.target.value })} placeholder="เช่น ยาเม็ด, ยาน้ำ" /></Field>
          <Field label="หมายเหตุ" className="md:col-span-2"><input value={item.note} onChange={(e) => setItem({ ...item, note: e.target.value })} /></Field>
        </div>}
      </Modal>

      <Modal open={!!recv} title={recv ? `รับเข้าคลังกลาง · ${recv.drug.name}` : ""} onClose={() => setRecv(null)}
        footer={<><button className="btn-soft" onClick={() => setRecv(null)}>ยกเลิก</button><button className="btn-primary" disabled={busy} onClick={() => recv && run({ op: "receive", drugId: recv.drug.id, qty: Number(recv.qty), lot: recv.lot, expiry: recv.expiry, cost: recv.cost === "" ? null : Number(recv.cost), branch }, `รับยาเข้าคลังกลางแล้ว · ${recv.drug.name} ${recv.qty} ${recv.drug.unit}`, () => setRecv(null))}>บันทึกรับเข้า</button></>}>
        {recv && <div className="form-grid">
          <Field label={`จำนวนที่รับเข้า (${recv.drug.unit})`} required><input type="number" min={0} value={recv.qty} onChange={(e) => setRecv({ ...recv, qty: e.target.value })} /></Field>
          <Field label="วันหมดอายุ"><input type="date" value={recv.expiry} onChange={(e) => setRecv({ ...recv, expiry: e.target.value })} /></Field>
          <Field label="เลขล็อต (Lot No.)"><input value={recv.lot} onChange={(e) => setRecv({ ...recv, lot: e.target.value })} /></Field>
          <Field label="ราคาทุนต่อหน่วย (บาท · ไม่บังคับ)"><input type="number" min={0} value={recv.cost} onChange={(e) => setRecv({ ...recv, cost: e.target.value })} /></Field>
        </div>}
      </Modal>

      <Modal open={!!adj} title={adj ? `ปรับ / ตรวจนับ · ${adj.drug.name}` : ""} onClose={() => setAdj(null)}
        footer={<><button className="btn-soft" onClick={() => setAdj(null)}>ยกเลิก</button><button className="btn-primary" disabled={busy} onClick={() => adj && run({ op: "adjust", lotId: adj.lot.id, qty: Number(adj.qty), reason: adj.reason, note: adj.note }, `ปรับสต็อกแล้ว · ${adj.drug.name} ล็อต ${adj.lot.lot || "-"} · ${fmt(adj.lot.qty)} → ${adj.qty} ${adj.drug.unit}`, () => setAdj(null))}>บันทึก</button></>}>
        {adj && <div className="form-grid">
          <Field label="ล็อต" className="md:col-span-2"><select value={adj.lot.id} onChange={(e) => { const l = (data?.lots ?? []).find((x) => x.id === e.target.value)!; setAdj({ ...adj, lot: l, qty: String(l.qty) }); }}>
            {(data?.lots ?? []).filter((l) => l.drug_id === adj.drug.id).map((l) => <option key={l.id} value={l.id}>ล็อต {l.lot || "-"} · หมดอายุ {thDate(l.expiry)} · คงเหลือ {fmt(l.qty)} {adj.drug.unit}</option>)}
          </select></Field>
          <Field label={`คงเหลือจริงที่นับได้ (${adj.drug.unit})`}><input type="number" min={0} value={adj.qty} onChange={(e) => setAdj({ ...adj, qty: e.target.value })} /></Field>
          <Field label="เหตุผล"><select value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })}>{(data?.reasons ?? []).map((r) => <option key={r}>{r}</option>)}</select></Field>
          <Field label="หมายเหตุ" className="md:col-span-2"><input value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} placeholder="เช่น ขวดแตกระหว่างเคลื่อนย้าย" /></Field>
        </div>}
      </Modal>

      <Modal open={!!issue} title={issue ? `เบิกให้ผู้ป่วย · ${issue.drug.name}` : ""} onClose={() => setIssue(null)}
        footer={<><button className="btn-soft" onClick={() => setIssue(null)}>ยกเลิก</button><button className="btn-primary" disabled={busy} onClick={() => issue && (!issue.resident ? toast("กรุณาเลือกผู้รับบริการ")
          : issue.basket && !issue.meals.length ? toast("กรุณาเลือกมื้อยาอย่างน้อย 1 มื้อ")
          : run({ op: "issue", drugId: issue.drug.id, qty: Number(issue.qty), residentId: issue.resident, note: issue.note, ...(issue.basket ? { basket: { dose: Number(issue.dose) || 1, meals: issue.meals } } : {}) },
            `เบิกยาแล้ว · ${issue.drug.name} ${issue.qty} ${issue.drug.unit} · ${residents.find((r) => r.id === issue.resident)?.full_name ?? ""}${issue.basket ? " · เข้าตะกร้ายาผู้ป่วย" : ""}${issue.drug.price !== null ? " · ขึ้นรอเรียกเก็บที่การเงิน" : ""}`,
            () => { if (issue.basket) refreshData("pharmacy-drugs"); setIssue(null); }))}>ยืนยันเบิก</button></>}>
        {issue && <div className="space-y-4">
          <Field label="ผู้รับบริการ" required><SearchSelect value={issue.resident} onChange={(v) => setIssue({ ...issue, resident: v })} ariaLabel="ผู้รับบริการ" placeholder="พิมพ์ชื่อ, HN หรือเลขห้อง"
            items={pick.map((r) => { const room = r.room && r.room.trim() !== "-" ? r.room : ""; return { value: r.id, label: r.full_name, sub: [r.hn || "ยังไม่มี HN", r.branch_name].filter(Boolean).join(" · "), badge: room ? `ห้อง ${room}` : "ยังไม่มีห้อง", tone: room ? "room" as const : "warn" as const, keys: room ? "" : "ยังไม่มีห้อง" }; })} /></Field>
          <Field label={`จำนวน (${issue.drug.unit})`}><input type="number" min={0} value={issue.qty} onChange={(e) => setIssue({ ...issue, qty: e.target.value })} /></Field>
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-cream-300 bg-cream-50 p-4 text-sm">
            <input type="checkbox" className="mt-1" checked={issue.basket} onChange={(e) => setIssue({ ...issue, basket: e.target.checked })} />
            <span><b className="font-medium">ใส่เข้าตะกร้ายาผู้ป่วย</b><span className="block text-gold-600">ยาที่ต้องให้ประจำ จะขึ้นในหน้าจัดยารายวันตามมื้อ · ไม่ติ๊ก = ให้ครั้งคราว เช่น ยาแก้ไข้</span></span>
          </label>
          {issue.basket && <div className="rounded-2xl border border-cream-300 p-4">
            <Field label={`กินครั้งละ (${issue.drug.unit})`}><input type="number" min="0.5" step="0.5" value={issue.dose} onChange={(e) => setIssue({ ...issue, dose: e.target.value })} /></Field>
            <p className="label mt-4">มื้อยา</p>
            <div className="flex flex-wrap gap-2">{MEALS.map((m) => { const on = issue.meals.includes(m); return (
              <button key={m} type="button" aria-pressed={on} onClick={() => setIssue({ ...issue, meals: on ? issue.meals.filter((x) => x !== m) : [...issue.meals, m] })}
                className={`rounded-xl border px-3.5 py-2 text-sm transition ${on ? "border-gold-600 bg-gold-100 font-medium text-gold-800" : "border-cream-300 bg-white text-gold-600"}`}>{m}</button>); })}</div>
          </div>}
          <Field label="หมายเหตุ"><input value={issue.note} onChange={(e) => setIssue({ ...issue, note: e.target.value })} placeholder="เช่น ไข้ 38.2 °C ให้ตามคำสั่งแพทย์" /></Field>
          <p className="text-xs text-gold-600">{issue.drug.price !== null ? `ราคา ${money(issue.drug.price)} บาท/${issue.drug.unit} · ขึ้นเป็นรายการยังไม่เรียกเก็บ ให้แคชเชียร์ดึงเข้าใบแจ้งหนี้` : "ยานี้ยังไม่ได้ตั้งราคา จะไม่ขึ้นที่การเงิน"} · ระบบตัดล็อตที่หมดอายุก่อนก่อน</p>
        </div>}
      </Modal>

      <Modal open={!!hist} wide title={hist ? `ประวัติการเพิ่มลด · ${hist.drug.name}` : ""} onClose={() => setHist(null)} footer={<button className="btn-primary" onClick={() => setHist(null)}>ปิด</button>}>
        {hist && <DataTable search={false} columns={["วันเวลา", "รายการ", "จำนวน", "ล็อต", "ผู้ป่วย", "โดย", "หมายเหตุ"]}
          rows={(hist.moves ?? []).map((m) => [m.at, m.reason, `${m.delta > 0 ? "+" : ""}${fmt(m.delta)} ${hist.drug.unit}`, m.lot ?? "-", m.resident_name ?? "-", m.moved_by ?? "-", [m.note, m.invoice_id ? "เรียกเก็บแล้ว" : ""].filter(Boolean).join(" · ") || "-"])}
          empty={hist.moves === null ? "กำลังโหลด…" : "ยังไม่มีการเพิ่มลด"} />}
      </Modal>
    </>
  );
}
