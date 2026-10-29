"use client";
import { useEffect, useMemo, useState } from "react";
import Icon from "../Icon";
import PhotoPicker from "../PhotoPicker";
import BillDoc, { Branch, DocFormat } from "../billing/BillDoc";
import { balanceOf, BILL_KINDS, BillItem, docDate, Invoice, isOpen, money, PAID, PARTIAL, Payment, todayIso, totals, UNPAID, VOID } from "@/lib/billing";
import { CONTRACTS, RESIDENTS } from "@/lib/mock";
import { newId, useCrud, useRecords, downloadCsv, refreshData } from "@/lib/store";
import { useApp } from "@/lib/app";
import { useSession } from "@/lib/session";
import { can } from "@/lib/perms";
import { staying } from "@/lib/rooms";
import { DataTable, Field, MetricGrid, Modal, PageHeader, Section, Tabs } from "../ui";

const blankItem = (): BillItem => ({ desc: "", qty: 1, price: 0, discount: 0 });
const num = (x: string) => Number(String(x).replace(/,/g, "")) || 0;

/** ข้อมูลหัวกระดาษของสาขา จากหน้า "สาขาของเรา" (แถว: รหัส, ชื่อ, นิติบุคคล, โทร, ที่อยู่, ...) */
export function useBranchInfo() {
  const { rows } = useCrud("branches", []);
  return (name: string): Branch => {
    const r = rows.find((x) => x[1] === name);
    return { name, legal: r?.[2] && r[2] !== "-" ? r[2] : "", address: r?.[4] && r[4] !== "-" ? r[4] : "", phone: r?.[3] && r[3] !== "-" ? r[3] : "" };
  };
}

/** หน้าการเงิน: ออกใบแจ้งหนี้ รับชำระ (เป็นใบเสร็จ) แนบหลักฐานการโอน และพิมพ์ตามแบบของศูนย์ */
export function Billing() {
  const { user } = useSession();
  const admin = can(user, "invoices.void");
  const [list, setList, meta] = useRecords<Invoice>("invoices", []);
  const res = useCrud("residents", RESIDENTS);
  const con = useCrud("contracts", CONTRACTS);
  const branchInfo = useBranchInfo();
  const { confirm, toast } = useApp();
  const [tab, setTab] = useState("ทั้งหมด");
  const [form, setForm] = useState<Invoice | null>(null);
  const [lines, setLines] = useState<BillItem[]>([blankItem()]);
  const [pay, setPay] = useState<Invoice | null>(null);
  const [amt, setAmt] = useState({ cash: "", credit: "", transfer: "", date: todayIso() });
  const [slip, setSlip] = useState("");
  const [view, setView] = useState<Invoice | null>(null);
  const [format, setFormat] = useState<DocFormat>("customer");
  const [copy, setCopy] = useState(false);
  const [pays, setPays] = useState<Payment[]>([]);
  const [which, setWhich] = useState(0); // 0 = ใบรวม, n = ใบรับเงินงวดที่ n
  const [busy, setBusy] = useState(false);

  const shown = list.filter((x) => tab === "ทั้งหมด" || (tab === UNPAID ? isOpen(x) : x.status === tab));
  const month = todayIso().slice(0, 7);
  const unpaid = list.filter(isOpen);
  // รับชำระเดือนนี้ = ยอดเงินที่รับจริงในเดือนนี้ (รวมงวดของใบที่ยังไม่ครบ) · ใช้วันที่รับล่าสุดของแต่ละใบ
  const paidMonth = list.filter((x) => (x.status === PAID || x.status === PARTIAL) && (x.paidDate ?? "").startsWith(month));
  const people = res.rows.filter((r) => staying(r[5] ?? ""));
  const residentOf = (name: string) => res.rows.find((r) => r[0] === name);
  /** สัญญาล่าสุดของผู้รับบริการ (ผู้ว่าจ้าง ที่อยู่ เลขที่สัญญา) */
  const contractOf = (name: string) => con.rows.find((r) => r[2] === name && r[5] !== "สิ้นสุดสัญญา") ?? con.rows.find((r) => r[2] === name);

  const startNew = () => {
    setForm({ id: newId(), date: todayIso(), who: "", hn: "", payer: "", address: "", kind: BILL_KINDS[1], contract: "", items: "[]", total: 0, discount: 0, net: 0, status: UNPAID, note: "" });
    setLines([blankItem()]);
  };
  const pickResident = (name: string) => {
    if (!form) return;
    const r = residentOf(name), c = contractOf(name);
    setForm({ ...form, who: name, hn: r?.[6] ?? "", payer: c?.[3] ?? form.payer, address: c?.[10] ?? form.address, contract: c?.[0] ?? "" });
    if (c && lines.length === 1 && !lines[0].desc && form.kind === BILL_KINDS[1] && c[4] !== "-") setLines([{ desc: `ค่าบริการรายเดือน ${c[6] && c[6] !== "-" ? `ห้อง ${c[6]}` : ""}`.trim(), qty: 1, price: num(c[4]), discount: 0 }]);
  };
  const sum = totals(lines.filter((l) => l.desc.trim()));
  const saveNew = () => {
    if (!form) return;
    const items = lines.filter((l) => l.desc.trim());
    if (!form.who) return toast("กรุณาเลือกผู้รับบริการ");
    if (!form.payer.trim()) return toast("กรุณากรอกชื่อผู้ชำระ");
    if (!items.length) return toast("กรุณาเพิ่มรายการอย่างน้อย 1 รายการ");
    if (items.some((l) => l.qty <= 0 || l.price < 0 || l.discount < 0 || l.discount > l.qty * l.price)) return toast("กรุณาตรวจจำนวน ราคา และส่วนลดของแต่ละรายการ");
    setList([{ ...form, items: JSON.stringify(items), ...totals(items) }, ...list]);
    setForm(null); setTab(UNPAID);
    toast("บันทึกใบแจ้งหนี้แล้ว · ระบบออกเลขที่เอกสารให้อัตโนมัติ");
  };

  const openPay = (x: Invoice) => { setPay(x); setSlip(""); setAmt({ cash: "", credit: "", transfer: String(balanceOf(x)), date: todayIso() }); };
  const left = pay ? balanceOf(pay) : 0;
  const now = num(amt.cash) + num(amt.credit) + num(amt.transfer);
  const savePay = async () => {
    if (!pay || busy) return;
    const cash = num(amt.cash), credit = num(amt.credit), transfer = num(amt.transfer);
    if (now <= 0) return toast("กรุณาระบุยอดที่รับชำระครั้งนี้");
    if (now > left + 0.005) return toast(`ยอดรับชำระ ${money(now)} บาท เกินยอดคงเหลือ ${money(left)} บาท`);
    if (transfer > 0 && !slip) return toast("กรุณาแนบหลักฐานการโอนเงิน");
    setBusy(true);
    // ใบแจ้งหนี้ที่เพิ่งสร้างอาจยังบันทึกขึ้นระบบไม่เสร็จ (404) ลองซ้ำก่อนแจ้งว่าไม่สำเร็จ
    const send = () => fetch("/api/billing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "pay", id: pay.id, cash, credit, transfer, date: amt.date, slip: slip || undefined }) });
    try {
      let r = await send();
      for (let i = 0; i < 3 && r.status === 404; i++) { await new Promise((x) => setTimeout(x, 1500)); r = await send(); }
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "รับชำระไม่สำเร็จ");
      setPay(null);
      refreshData("invoices");
      toast(d.status === PAID ? `รับชำระครบแล้ว · ${pay.no ?? ""} เป็นใบเสร็จรับเงิน` : `รับชำระ ${money(now)} บาท · คงเหลือ ${money(left - now)} บาท (ชำระบางส่วน)`);
      setTab(d.status === PAID ? PAID : UNPAID);
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  };

  // ประวัติการรับชำระของเอกสารที่เปิดดู (แต่ละงวดมีสลิปของตัวเอง)
  useEffect(() => {
    setPays([]); setWhich(0);
    if (!view || !(view.paid ?? 0)) return;
    fetch(`/api/billing?id=${encodeURIComponent(view.id)}`).then((r) => (r.ok ? r.json() : null)).then((d) => d && setPays(d.payments ?? [])).catch(() => {});
  }, [view?.id, view?.paid]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => shown.map((x) => [x.no ?? "กำลังออกเลข…", docDate(x.status === PAID ? x.paidDate || x.date : x.date), x.hn || "-", x.who, x.kind, money(x.net), money(x.paid ?? 0), money(balanceOf(x)), x.status]), [shown]);
  const branchOfInv = (x: Invoice) => residentOf(x.who)?.[3] ?? user?.branch ?? "";

  return (
    <>
      <PageHeader title="การเงิน" sub="ออกใบแจ้งหนี้ รับชำระเงิน และพิมพ์ใบเสร็จตามแบบของศูนย์"
        actions={<>
          <button className="btn-soft" onClick={() => downloadCsv("การเงิน", ["เลขที่เอกสาร", "วันที่", "HN", "ผู้รับบริการ", "ประเภท", "ยอดสุทธิ", "ชำระแล้ว", "คงเหลือ", "สถานะ"], rows)}><Icon name="download" className="h-4 w-4" /> ส่งออก CSV</button>
          <button className="btn-primary" onClick={startNew}><Icon name="plus" className="h-4 w-4" /> ออกใบแจ้งหนี้</button>
        </>} />
      <MetricGrid items={[
        { label: "ค้างชำระ", value: unpaid.length, unit: "ใบ", icon: "receipt", accent: true, note: unpaid.length ? `ค้างรวม ${money(unpaid.reduce((n, x) => n + balanceOf(x), 0))} บาท` : undefined },
        { label: "รับชำระเดือนนี้", value: money(paidMonth.reduce((n, x) => n + (x.paid ?? 0), 0)), unit: "บาท", icon: "check", note: `${paidMonth.length} เอกสาร` },
        { label: "ใบเสร็จทั้งหมด", value: list.filter((x) => x.status === PAID).length, unit: "ใบ", icon: "files" },
        { label: "ยกเลิก", value: list.filter((x) => x.status === VOID).length, unit: "ใบ", icon: "close" },
      ]} />
      <Section title="เอกสารการเงิน" actions={<Tabs tabs={["ทั้งหมด", UNPAID, PAID, VOID]} value={tab} onChange={setTab} />}>
        <DataTable columns={["เลขที่เอกสาร", "วันที่", "HN", "ผู้รับบริการ", "ประเภท", "ยอดสุทธิ (บาท)", "ชำระแล้ว", "คงเหลือ", "สถานะ"]} rows={rows}
          empty={meta.loaded ? "ยังไม่มีเอกสาร" : "กำลังโหลด…"}
          actions={[
            { label: "ดู/พิมพ์", onClick: (k) => { setFormat("customer"); setCopy(false); setView(shown[k]); } },
            { label: "รับชำระ", onClick: (k) => isOpen(shown[k]) ? openPay(shown[k]) : toast("ไม่สามารถรับชำระได้ เอกสารนี้ชำระครบแล้วหรือถูกยกเลิก") },
            ...(admin ? [{ label: "ยกเลิก", danger: true, onClick: (k: number) => { const x = shown[k]; if (x.status === VOID) return; confirm({ title: "ยกเลิกเอกสาร", message: `ต้องการยกเลิก ${x.no ?? ""} (${money(x.net)} บาท) ใช่หรือไม่ เอกสารยังเก็บไว้ในระบบพร้อมสถานะยกเลิก`, danger: true, okLabel: "ยกเลิกเอกสาร", onOk: () => { setList(list.map((y) => (y.id === x.id ? { ...x, status: VOID } : y))); toast("ยกเลิกเอกสารแล้ว"); } }); } }] : []),
          ]} />
      </Section>

      {/* ออกใบแจ้งหนี้ */}
      <Modal open={!!form} wide title="ออกใบแจ้งหนี้" onClose={() => setForm(null)}
        footer={<><button className="btn-soft" onClick={() => setForm(null)}>ยกเลิก</button><button className="btn-primary" onClick={saveNew}>บันทึกใบแจ้งหนี้</button></>}>
        {form && <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="ผู้รับบริการ" required><select value={form.who} onChange={(e) => pickResident(e.target.value)}>
              <option value="">-- เลือกผู้รับบริการ --</option>
              {people.map((r) => <option key={`${r[0]}|${r[3]}`} value={r[0]}>{r[0]}{r[6] ? ` · ${r[6]}` : ""} · {r[3]}</option>)}
            </select></Field>
            <Field label="ประเภท"><select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{BILL_KINDS.map((k) => <option key={k}>{k}</option>)}</select></Field>
            <Field label="ชื่อผู้ชำระ" required><input value={form.payer} onChange={(e) => setForm({ ...form, payer: e.target.value })} /></Field>
            <Field label="วันที่"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label="ที่อยู่ผู้ชำระ" className="md:col-span-2"><textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          </div>
          {form.who && <p className="text-xs text-gold-500">HN {form.hn || "(ออกให้เมื่อบันทึกผู้รับบริการ)"}{form.contract ? ` · สัญญา ${form.contract}` : ""}</p>}
          <div className="bill-items">
            <div className="mb-2 flex items-center justify-between"><h3 className="font-medium text-gold-800">รายการ</h3><button type="button" className="row-action" onClick={() => setLines([...lines, blankItem()])}>+ เพิ่มรายการ</button></div>
            <div className="space-y-3">{lines.map((l, i) => {
              const set = (p: Partial<BillItem>) => setLines(lines.map((x, j) => (j === i ? { ...x, ...p } : x)));
              return <div key={i} className="grid gap-2 rounded-xl border border-cream-200 p-3 sm:grid-cols-[1fr_80px_120px_110px_auto] sm:items-end">
                <Field label="รายการ"><input value={l.desc} placeholder="เช่น ค่าบริการรายเดือน พ.ย. 2569" onChange={(e) => set({ desc: e.target.value })} /></Field>
                <Field label="จำนวน"><input type="number" min={0} value={l.qty} onChange={(e) => set({ qty: num(e.target.value) })} /></Field>
                <Field label="ราคา/หน่วย"><input type="number" min={0} value={l.price} onChange={(e) => set({ price: num(e.target.value) })} /></Field>
                <Field label="ส่วนลด"><input type="number" min={0} value={l.discount} onChange={(e) => set({ discount: num(e.target.value) })} /></Field>
                <button type="button" className="row-action danger" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>ลบ</button>
              </div>;
            })}</div>
            <p className="mt-3 text-right text-sm text-gold-700">รวม {money(sum.total)} · ส่วนลด {money(sum.discount)} · <b className="text-base text-gold-800">สุทธิ {money(sum.net)} บาท</b></p>
          </div>
          <Field label="หมายเหตุ"><input value={form.note ?? ""} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
        </div>}
      </Modal>

      {/* รับชำระ */}
      <Modal open={!!pay} title={`รับชำระ ${pay?.no ?? ""}`} onClose={() => setPay(null)}
        footer={<><button className="btn-soft" onClick={() => setPay(null)}>ยกเลิก</button><button className="btn-primary" disabled={busy} onClick={savePay}>{busy ? "กำลังบันทึก…" : "ยืนยันรับชำระ"}</button></>}>
        {pay && <div className="space-y-4">
          <div className="rounded-xl bg-cream-50 px-4 py-3 text-sm text-gold-700">
            <p>{pay.who} · ผู้ชำระ {pay.payer}</p>
            <p className="mt-1">ยอดสุทธิ {money(pay.net)} · ชำระแล้ว {money(pay.paid ?? 0)} · <b className="text-gold-800">คงเหลือ {money(left)} บาท</b></p>
          </div>
          <p className="text-xs text-gold-600">กรอกยอดที่ลูกค้าจ่ายในครั้งนี้ แยกตามวิธีชำระ · จ่ายไม่ครบได้ (ระบบเก็บเป็น "ชำระบางส่วน" และกลับมารับเพิ่มได้ภายหลัง)</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="เงินสด"><input type="number" min={0} value={amt.cash} onChange={(e) => setAmt({ ...amt, cash: e.target.value })} /></Field>
            <Field label="บัตรเครดิต"><input type="number" min={0} value={amt.credit} onChange={(e) => setAmt({ ...amt, credit: e.target.value })} /></Field>
            <Field label="โอนเงิน"><input type="number" min={0} value={amt.transfer} onChange={(e) => setAmt({ ...amt, transfer: e.target.value })} /></Field>
          </div>
          <p className={`rounded-xl px-4 py-2 text-sm ${now > left + 0.005 ? "bg-red-50 text-red-700" : "bg-gold-50 text-gold-800"}`}>
            รับครั้งนี้ <b>{money(now)}</b> บาท · {now > left + 0.005 ? "เกินยอดคงเหลือ" : now >= left - 0.005 && now > 0 ? "ชำระครบ ออกเป็นใบเสร็จรับเงิน" : `คงเหลือหลังรับ ${money(Math.max(0, left - now))} บาท`}
          </p>
          <Field label="วันที่รับชำระ"><input type="date" value={amt.date} onChange={(e) => setAmt({ ...amt, date: e.target.value })} /></Field>
          {num(amt.transfer) > 0 && <PhotoPicker value={slip} onChange={setSlip} label="หลักฐานการโอนเงิน (สลิป)" hint="แนบท้ายใบเสร็จเป็นหน้าที่ 2" />}
        </div>}
      </Modal>

      {/* ดู / พิมพ์ */}
      <Modal open={!!view} wide title={view ? `${view.status === PAID ? "ใบเสร็จรับเงิน" : "ใบแจ้งหนี้"} ${view.no ?? ""}${view.status === PARTIAL ? " · ชำระบางส่วน" : ""}` : ""} onClose={() => setView(null)}
        footer={<><button className="btn-soft" onClick={() => setView(null)}>ปิด</button><button className="btn-primary" disabled={!view?.no} onClick={() => window.print()}><Icon name="print" className="h-4 w-4" /> พิมพ์</button></>}>
        {view && <>
          <div className="bill-switch mb-4 flex flex-wrap items-center gap-3">
            <Tabs tabs={["สำหรับผู้ชำระ", "สำหรับฝ่ายการเงิน"]} value={format === "customer" ? "สำหรับผู้ชำระ" : "สำหรับฝ่ายการเงิน"} onChange={(t) => setFormat(t === "สำหรับผู้ชำระ" ? "customer" : "finance")} />
            <Tabs tabs={["ต้นฉบับ", "สำเนา"]} value={copy ? "สำเนา" : "ต้นฉบับ"} onChange={(t) => setCopy(t === "สำเนา")} />
            {view.status === VOID && <span className="status-badge status-danger">เอกสารนี้ถูกยกเลิก</span>}
          </div>
          {pays.length > 0 && (
            <div className="mb-4 space-y-2">
              <Tabs tabs={[view.status === PAID ? "ใบเสร็จรวม" : "ใบแจ้งหนี้", ...pays.map((p) => `ใบรับเงิน งวดที่ ${p.n}`)]}
                value={which === 0 ? (view.status === PAID ? "ใบเสร็จรวม" : "ใบแจ้งหนี้") : `ใบรับเงิน งวดที่ ${which}`}
                onChange={(t) => setWhich(t.startsWith("ใบรับเงิน") ? Number(t.split(" ").pop()) : 0)} />
              <ul className="pay-history">
                {pays.map((p) => <li key={p.id}><b>งวดที่ {p.n}</b> · {docDate(p.date)} · {money(p.amount)} บาท <small>({[p.cash && `เงินสด ${money(p.cash)}`, p.credit && `บัตร ${money(p.credit)}`, p.transfer && `โอน ${money(p.transfer)}`].filter(Boolean).join(" · ")}) · รับโดย {p.cashier || "-"}</small></li>)}
                {view.status === PARTIAL && <li className="is-left"><b>คงเหลือ {money(balanceOf(view))} บาท</b> <small>กด "รับชำระ" ที่รายการเพื่อรับงวดถัดไป</small></li>}
              </ul>
            </div>
          )}
          <BillDoc inv={view} branch={branchInfo(branchOfInv(view))} format={format} copy={copy} printedBy={user?.name ?? ""}
            payment={which > 0 ? pays[which - 1] : undefined}
            slips={format === "finance" ? (which > 0 ? (pays[which - 1]?.slip ? [pays[which - 1]] : []) : pays.filter((p) => p.slip)) : []} />
        </>}
      </Modal>
    </>
  );
}

/** ใบแจ้งหนี้ใหม่จากสัญญา (ค่าบริการล่วงหน้า + เงินประกัน) · คืน null ถ้าไม่มียอด */
export function contractInvoice(row: string[], hn: string): Invoice | null {
  const prepaid = num(row[18] === "-" ? "" : row[18]), deposit = num(row[19] === "-" ? "" : row[19]);
  const items = [
    ...(prepaid ? [{ desc: `ชำระค่าบริการล่วงหน้า${row[6] && row[6] !== "-" ? ` ห้อง ${row[6]}` : ""}`, qty: 1, price: prepaid, discount: 0 }] : []),
    ...(deposit ? [{ desc: "เงินประกัน", qty: 1, price: deposit, discount: 0 }] : []),
  ];
  if (!items.length) return null;
  return { id: newId(), date: todayIso(), who: row[2], hn, payer: row[3], address: row[10] ?? "", kind: BILL_KINDS[0], contract: row[0], items: JSON.stringify(items), ...totals(items), status: UNPAID, note: "" };
}
