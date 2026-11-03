"use client";
import { useEffect, useMemo, useState } from "react";
import Icon from "../Icon";
import PhotoPicker from "../PhotoPicker";
import BillDoc, { Branch, DocFormat } from "../billing/BillDoc";
import { balanceOf, BILL_KINDS, BillItem, docDate, Invoice, isOpen, lineAmount, lineDiscount, money, PAID, PARTIAL, Payment, todayIso, totals, UNPAID, DEFAULT_VAT, contractVat, DRAFT, lineNet, vatOf, VOID } from "@/lib/billing";
import { CONTRACTS, RESIDENTS } from "@/lib/mock";
import { newId, useCrud, useRecords, downloadCsv, refreshData } from "@/lib/store";
import { useApp } from "@/lib/app";
import { useSession } from "@/lib/session";
import { can } from "@/lib/perms";
import { staying } from "@/lib/rooms";
import { billHandoff } from "@/lib/handoff";
import { contractLines } from "../print/Docs";
import { DataTable, Field, MetricGrid, Modal, PageHeader, Section, Tabs } from "../ui";
import { ResidentPicker } from "../SearchSelect";
import { rateText, roomByPrice, searchPrices } from "@/lib/priceList";

const blankItem = (): BillItem => ({ desc: "", qty: 1, price: 0, discount: 0, pct: 0 });

/** ช่องชื่อรายการ: พิมพ์อย่างน้อย 2 ตัวแล้วขึ้นค่าบริการจากใบราคา กดราคาแล้วชื่อกับราคาลงให้ · ไม่มีในใบราคาพิมพ์เองได้ */
function LineDesc({ value, onText, onPick }: { value: string; onText: (v: string) => void; onPick: (desc: string, price: number) => void }) {
  const [open, setOpen] = useState(false);
  const list = open ? searchPrices(value, 8) : [];
  return (
    <div className="relative">
      <input value={value} placeholder="พิมพ์ 2 ตัวเพื่อค้นจากใบราคา หรือพิมพ์เอง" autoComplete="off" aria-label="รายการ"
        onChange={(e) => { onText(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }} />
      {list.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-72 w-full min-w-[320px] overflow-auto rounded-2xl border border-gold-200 bg-white shadow-lg">
          <p className="sticky top-0 border-b border-cream-200 bg-cream-50 px-4 py-2 text-xs text-gold-600">จากใบราคาของศูนย์ · กดราคาแล้วชื่อกับราคาลงให้เลย</p>
          {list.map((x) => (
            <div key={x.code} className="border-b border-cream-100 px-4 py-2.5 last:border-0">
              <p className="text-sm font-medium text-gold-800">{x.name}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">{x.rates.map((r, k) => (
                <button key={k} type="button" className="rounded-lg border border-gold-300 bg-cream-50 px-2.5 py-1 text-xs font-medium text-gold-800 hover:border-gold-600 hover:bg-gold-100"
                  onMouseDown={(e) => { e.preventDefault(); onPick(x.name, r.price); setOpen(false); }}>{rateText(r)}</button>
              ))}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
const num = (x: string) => Number(String(x).replace(/,/g, "")) || 0;
const val = (x?: string) => num(x && x !== "-" ? x : "");

const isRoomLine = (d: string) => /ห้อง|room/i.test(d);

/**
 * ค่าบริการต่อเดือนตามสัญญา (แจกแจงรายการ)
 *  มีรายการค่าห้องในสัญญา = ค่าห้องรวมค่าดูแลแล้ว ไม่ใส่ราคาโปรแกรมซ้ำ · ไม่มี = ราคาโปรแกรม + รายการอื่น
 */
export function contractMonthLines(r: string[]): BillItem[] {
  const no = r[6] && r[6] !== "-" ? r[6] : "";
  const items = contractLines(r).filter((x) => x.price > 0);
  const hasRoom = items.some((x) => isRoomLine(x.desc));
  const rate = contractVat(r);
  const fee = val(r[4]), kind = roomByPrice(fee);
  const feeDesc = kind ? `ค่า${kind.name}${kind.promo ? " ราคาโปรโมชัน" : ""}` : r[21] && r[21] !== "-" ? r[21] : "ค่าบริการรายเดือน";
  return [
    ...(!hasRoom && fee ? [{ desc: `${feeDesc}${no ? ` · ห้อง ${no}` : ""}`, qty: 1, price: fee, discount: 0, vat: rate }] : []),
    ...items.map((x) => {
      const room = isRoomLine(x.desc);
      return { desc: no && room && !x.desc.includes(no) ? `${x.desc} · ห้อง ${no}` : x.desc, qty: x.qty, price: x.price, discount: Number(x.discount) || 0, pct: Number(x.pct) || 0, vat: room ? rate : 0 };
    }),
  ];
}

/**
 * รายการใบแจ้งหนี้แรกเข้าจากสัญญา: ค่าบริการแจกแจง หักมัดจำห้องที่จ่ายตอนจอง (ที่บรรทัดค่าห้อง) · บวกเงินประกัน
 *  ยอด "ชำระล่วงหน้า" ใช้เมื่อสัญญาไม่มีรายการค่าบริการเลย
 */
export function contractStartLines(r: string[]): BillItem[] {
  const prepaid = val(r[18]), deposit = val(r[19]), dep = val(r[27]);
  const service = contractMonthLines(r);
  if (!service.length && prepaid) service.push({ desc: "ชำระค่าบริการล่วงหน้า", qty: 1, price: prepaid, discount: 0 });
  if (dep) {
    const fits = (l: BillItem) => l.qty * l.price - l.discount >= dep;
    const k = service.findIndex((l) => isRoomLine(l.desc) && fits(l)) >= 0 ? service.findIndex((l) => isRoomLine(l.desc) && fits(l)) : service.findIndex(fits);
    if (k >= 0) service[k] = { ...service[k], discount: service[k].discount + dep };
  }
  return [...service, ...(deposit ? [{ desc: "เงินประกัน", qty: 1, price: deposit, discount: 0 }] : [])];
}

/** หมายเหตุใบแจ้งหนี้แรกเข้า: มัดจำห้องที่หักแล้ว และยอดชำระล่วงหน้าที่ตกลงในสัญญา */
export function contractStartNote(r: string[]): string {
  const prepaid = val(r[18]), dep = val(r[27]);
  return [dep ? `หักมัดจำห้องพักที่ชำระตอนจอง ${money(dep)} บาท` : "", prepaid && contractMonthLines(r).length ? `ตามสัญญาชำระล่วงหน้า ${money(prepaid)} บาท` : ""].filter(Boolean).join(" · ");
}

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
  /** อัตรา VAT ของใบที่กำลังออก (%) · ใช้กับบรรทัดที่ติ๊ก VAT */
  const [vatRate, setVatRate] = useState(DEFAULT_VAT);
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
  /** ผู้ที่ชำระค่าบริการเดือนนี้ครบแล้ว (ใบแรกเข้า / รายเดือน ลงวันที่เดือนนี้) · ไม่ให้เลือกออกใบแจ้งหนี้ซ้ำ เดือนถัดไปกลับมาเลือกได้ */
  const paidNow = new Set(list.filter((x) => x.status === PAID && (x.kind === BILL_KINDS[0] || x.kind === BILL_KINDS[1]) && x.date.startsWith(month)).map((x) => x.who));
  const billable = people.filter((r) => !paidNow.has(r[0]));
  const residentOf = (name: string) => res.rows.find((r) => r[0] === name);
  /** สัญญาล่าสุดของผู้รับบริการ (ผู้ว่าจ้าง ที่อยู่ เลขที่สัญญา) */
  const contractOf = (name: string) => con.rows.find((r) => r[2] === name && r[5] !== "สิ้นสุดสัญญา") ?? con.rows.find((r) => r[2] === name);

  // มาจากปุ่ม "ออกใบแจ้งหนี้" ในทะเบียนสัญญา · รอข้อมูลสัญญาโหลดก่อนเปิดฟอร์ม
  const [billFor, setBillFor] = useState<string | null>(null);
  useEffect(() => { const h = billHandoff.take(); if (h) setBillFor(h); }, []);
  useEffect(() => {
    if (!billFor) return;
    const k = con.ids.indexOf(billFor);
    if (k < 0) return;
    setBillFor(null);
    const c = con.rows[k], p = res.rows.find((r) => r[0] === c[2] && r[3] === c[1]);
    const items = contractStartLines(c);
    setForm({ id: newId(), date: todayIso(), who: c[2], hn: p?.[6] ?? "", payer: c[3] ?? "", address: c[10] ?? "", kind: c[5] === "รอชำระเงินมัดจำ" ? BILL_KINDS[0] : BILL_KINDS[1], contract: c[0] ?? "", items: "[]", total: 0, discount: 0, net: 0, status: UNPAID, note: contractStartNote(c) });
    setLines(items.length ? items : [blankItem()]); setVatRate(contractVat(c) || DEFAULT_VAT);
    loadUnbilled(c[2]);
  }, [billFor, con.ids, con.rows, res.rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const startNew = () => {
    setForm({ id: newId(), date: todayIso(), who: "", hn: "", payer: "", address: "", kind: BILL_KINDS[1], contract: "", items: "[]", total: 0, discount: 0, net: 0, status: UNPAID, note: "" });
    setLines([blankItem()]); setVatRate(DEFAULT_VAT);
  };
  // เวชภัณฑ์ที่เบิกแล้วยังไม่เรียกเก็บ ของผู้รับบริการที่เลือก (ดึงเข้าใบแจ้งหนี้ได้ในคลิกเดียว)
  const [unbilled, setUnbilled] = useState<{ id: string; item_name: string; unit: string; qty: number; price: number; at: string; course?: boolean; med?: boolean; session?: boolean }[]>([]);
  const [pulled, setPulled] = useState<string[]>([]);
  const loadUnbilled = (name: string, pre: string[] = []) => {
    setUnbilled([]); setPulled(pre);
    const k = res.rows.findIndex((r) => r[0] === name);
    if (k < 0) return;
    fetch(`/api/clinic?op=unbilled&resident=${encodeURIComponent(res.ids[k])}`).then((r) => (r.ok ? r.json() : { items: [] })).then((d) => setUnbilled([...(d.meds ?? []).map((m: { id: string; name: string; unit: string; qty: number; price: number; at: string }) => ({ id: m.id, item_name: m.name, unit: m.unit, qty: m.qty, price: m.price, at: m.at, med: true })), ...(d.courses ?? []).map((c: { id: string; name: string; total: number; price: number; at: string }) => ({ id: c.id, item_name: `คอร์ส${c.name.startsWith("กายภาพ") ? "" : "กายภาพ "}${c.name} ${c.total} ครั้ง`, unit: "คอร์ส", qty: 1, price: c.price, at: c.at, course: true })), ...(d.items ?? []), ...(d.sessions ?? []).map((x: { id: string; at: string }) => ({ id: x.id, item_name: `กายภาพรายครั้ง (ยังไม่มีคอร์ส) ${x.at.slice(0, 10)}`, unit: "ครั้ง", qty: 1, price: 0, at: x.at, session: true }))])).catch(() => {});
  };
  const pullSupplies = () => {
    const add = unbilled.filter((x) => !pulled.includes(x.id));
    if (!add.length) return;
    setLines([...lines.filter((l) => l.desc.trim()), ...add.map((x) => ({ desc: x.course ? `${x.item_name} (ซื้อ ${x.at.slice(0, 10)})` : x.session ? x.item_name : x.med ? `ยา: ${x.item_name} ${x.qty} ${x.unit} (จ่าย ${x.at.slice(0, 10)})` : `เวชภัณฑ์: ${x.item_name} (เบิก ${x.at.slice(0, 10)})`, qty: x.qty, price: x.price, discount: 0 }))]);
    setPulled([...pulled, ...add.map((x) => x.id)]);
    if (form && form.kind === BILL_KINDS[1]) setForm({ ...form, kind: (add.every((x) => x.course || x.session) ? BILL_KINDS.find((k) => k.startsWith("คอร์ส")) : BILL_KINDS.find((k) => k.startsWith("เวชภัณฑ์"))) ?? form.kind });
  };
  const pickResident = (name: string) => {
    if (!form) return;
    loadUnbilled(name);
    const r = residentOf(name), c = contractOf(name);
    setForm({ ...form, who: name, hn: r?.[6] ?? "", payer: c?.[3] ?? form.payer, address: c?.[10] ?? form.address, contract: c?.[0] ?? "" });
    if (c && lines.length === 1 && !lines[0].desc && form.kind === BILL_KINDS[1]) { const m = contractMonthLines(c); if (m.length) setLines(m); }
  };
  // ขายคอร์สกายภาพจากหน้าการเงิน: สร้างคอร์ส (นักกายภาพตัดครั้งที่แท็บกายภาพ) แล้วเปิดใบแจ้งหนี้ที่ใส่คอร์สไว้ให้
  const [course, setCourse] = useState<{ who: string; name: string; total: string; price: string; busy: boolean } | null>(null);
  const saveCourse = async () => {
    if (!course || course.busy) return;
    const k = res.rows.findIndex((r) => r[0] === course.who);
    const name = course.name.trim(), total = Math.floor(num(course.total)), price = num(course.price);
    if (k < 0) return toast("กรุณาเลือกผู้รับบริการ");
    if (!name) return toast("กรุณากรอกชื่อคอร์ส");
    if (!(total > 0 && total <= 500)) return toast("กรุณากรอกจำนวนครั้ง 1–500 ครั้ง");
    if (!(price > 0)) return toast("กรุณากรอกราคาคอร์ส");
    setCourse({ ...course, busy: true });
    let id = "";
    try {
      const r = await fetch("/api/clinic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "course", residentId: res.ids[k], name, total, price }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d.id) throw new Error(d.error || "บันทึกคอร์สไม่สำเร็จ");
      id = d.id;
    } catch (e) {
      setCourse({ ...course, busy: false });
      return toast(e instanceof Error ? e.message : "บันทึกคอร์สไม่สำเร็จ");
    }
    const p = res.rows[k], c = contractOf(course.who);
    setCourse(null);
    setForm({ id: newId(), date: todayIso(), who: course.who, hn: p[6] ?? "", payer: c?.[3] ?? "", address: c?.[10] ?? "", kind: BILL_KINDS.find((x) => x.startsWith("คอร์ส")) ?? BILL_KINDS[1], contract: c?.[0] ?? "", items: "[]", total: 0, discount: 0, net: 0, status: UNPAID, note: "" });
    setLines([{ desc: `คอร์ส${name.startsWith("กายภาพ") ? "" : "กายภาพ "}${name} ${total} ครั้ง`, qty: 1, price, discount: 0 }]);
    loadUnbilled(course.who, [id]);
    toast(`บันทึกคอร์สแล้ว · ${name} ${total} ครั้ง · ${course.who} · ตรวจใบแจ้งหนี้แล้วกดบันทึก`);
  };
  const sum = totals(lines.filter((l) => l.desc.trim()));
  const vatSum = vatOf(lines.filter((l) => l.desc.trim()));
  const saveNew = () => {
    if (!form) return;
    const items = lines.filter((l) => l.desc.trim());
    if (!form.who) return toast("กรุณาเลือกผู้รับบริการ");
    if (!form.payer.trim()) return toast("กรุณากรอกชื่อผู้ชำระ");
    if (!items.length) return toast("กรุณาเพิ่มรายการอย่างน้อย 1 รายการ");
    if (items.some((l) => l.desc.startsWith("กายภาพรายครั้ง") && !(l.price > 0))) return toast("กรุณากรอกราคากายภาพรายครั้ง (ยังไม่มีคอร์ส)");
    if (items.some((l) => l.qty <= 0 || l.price < 0 || l.discount < 0 || (l.pct ?? 0) < 0 || (l.pct ?? 0) > 100 || lineDiscount(l) > l.qty * l.price)) return toast("กรุณาตรวจจำนวน ราคา และส่วนลดของแต่ละรายการ");
    setList([{ ...form, items: JSON.stringify(items), ...totals(items) }, ...list]);
    // เวชภัณฑ์ที่ดึงเข้าใบนี้: ทำเครื่องหมายว่าเรียกเก็บแล้ว (ไม่ดึงซ้ำในใบถัดไป)
    if (pulled.length) fetch("/api/clinic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "supply_bill", ids: pulled.filter((id) => { const x = unbilled.find((y) => y.id === id); return x && !x.course && !x.med && !x.session; }), noteIds: pulled.filter((id) => unbilled.find((x) => x.id === id)?.session), medIds: pulled.filter((id) => unbilled.find((x) => x.id === id)?.med), courseIds: pulled.filter((id) => unbilled.find((x) => x.id === id)?.course), invoiceId: form.id }) }).catch(() => {});
    setForm(null); setTab(UNPAID);
    toast(`ออกใบแจ้งหนี้แล้ว · ${form.who} · ${money(totals(items).net)} บาท · ระบบออกเลขที่เอกสารให้`);
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
      toast(d.status === PAID ? `รับชำระครบแล้ว · ${pay.no ?? ""} · ${pay.who} · ออกเป็นใบเสร็จรับเงิน` : `รับชำระบางส่วนแล้ว · ${pay.no ?? ""} · รับ ${money(now)} บาท · คงเหลือ ${money(left - now)} บาท`);
      setTab(d.status === PAID ? PAID : UNPAID);
      // ชำระครบ และสัญญายังรอชำระมัดจำ: ถามเปลี่ยนเป็นใช้งานอยู่ + ให้ผู้รับบริการเข้าพัก
      const k = d.status === PAID && pay.contract && can(user, "contracts") ? con.rows.findIndex((c) => c[0] === pay.contract && c[5] === "รอชำระเงินมัดจำ") : -1;
      if (k >= 0) {
        const c = con.rows[k], j = res.rows.findIndex((r) => r[0] === c[2] && r[3] === c[1]);
        confirm({
          title: "เริ่มสัญญา", okLabel: "เปลี่ยนเป็นใช้งานอยู่",
          message: `รับชำระครบแล้ว ต้องการเปลี่ยนสัญญา ${c[0]} เป็น "ใช้งานอยู่"${j >= 0 && res.rows[j][5]?.startsWith("มัดจำ") ? ` และให้ ${c[2]} เข้าพัก${c[6] && c[6] !== "-" ? `ห้อง ${c[6]}` : ""}` : ""} เลยหรือไม่`,
          onOk: () => {
            con.update(k, c.map((x, n) => (n === 5 ? "ใช้งานอยู่" : x)));
            if (j >= 0 && res.rows[j][5]?.startsWith("มัดจำ")) res.update(j, res.rows[j].map((x, n) => (n === 5 ? "เข้าอยู่ (Active)" : x)));
            toast(`เริ่มสัญญาแล้ว · ${c[0]} · ${c[2]} เข้าพัก`);
          },
        });
      }
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
          <button className="btn-soft" onClick={() => setCourse({ who: "", name: "กายภาพบำบัด (ครั้งละ 45 นาที)", total: "10", price: "", busy: false })}><Icon name="plus" className="h-4 w-4" /> ขายคอร์สกายภาพ</button>
          <button className="btn-primary" onClick={startNew}><Icon name="plus" className="h-4 w-4" /> ออกใบแจ้งหนี้</button>
        </>} />
      <MetricGrid items={[
        { label: "ค้างชำระ", value: unpaid.length, unit: "ใบ", icon: "receipt", accent: true, note: unpaid.length ? `ค้างรวม ${money(unpaid.reduce((n, x) => n + balanceOf(x), 0))} บาท` : undefined },
        { label: "รับชำระเดือนนี้", value: money(paidMonth.reduce((n, x) => n + (x.paid ?? 0), 0)), unit: "บาท", icon: "check", note: `${paidMonth.length} เอกสาร` },
        { label: "ใบเสร็จทั้งหมด", value: list.filter((x) => x.status === PAID).length, unit: "ใบ", icon: "files" },
        { label: DRAFT, value: list.filter((x) => x.status === DRAFT).length, unit: "ใบ", icon: "history", note: "ออกจากสัญญาอัตโนมัติ · ตรวจแล้วกดยืนยันยอด" },
      ]} />
      <Section title="เอกสารการเงิน" actions={<Tabs tabs={["ทั้งหมด", DRAFT, UNPAID, PAID, VOID]} value={tab} onChange={setTab} />}>
        <DataTable columns={["เลขที่เอกสาร", "วันที่", "HN", "ผู้รับบริการ", "ประเภท", "ยอดสุทธิ (บาท)", "ชำระแล้ว", "คงเหลือ", "สถานะ"]} rows={rows}
          empty={meta.loaded ? "ยังไม่มีเอกสาร" : "กำลังโหลด…"}
          actions={[
            { label: "ดู/พิมพ์", onClick: (k) => { setFormat("customer"); setCopy(false); setView(shown[k]); } },
            { label: "ยืนยันยอด", hidden: (k) => shown[k].status !== DRAFT, onClick: (k) => { const x = shown[k]; if (x.status !== DRAFT) return toast("เอกสารนี้ยืนยันยอดแล้ว"); confirm({ title: "ยืนยันยอดใบแจ้งหนี้", okLabel: "ยืนยันยอด", message: `ตรวจรายการและยอด ${money(x.net)} บาท ของ ${x.who} ถูกต้องแล้วใช่หรือไม่ · ยืนยันแล้วจะเป็น "${UNPAID}" และรับชำระได้ · ถ้ายอดไม่ถูกให้ยกเลิกใบนี้แล้วออกใบใหม่`, onOk: () => { setList(list.map((y) => (y.id === x.id ? { ...x, status: UNPAID } : y))); setTab(UNPAID); toast(`ยืนยันยอดแล้ว · ${x.no ?? ""} · ${x.who} · พร้อมรับชำระ`); } }); } },
            { label: "รับชำระ", onClick: (k) => isOpen(shown[k]) ? openPay(shown[k]) : toast(shown[k].status === DRAFT ? "กด ยืนยันยอด ก่อน จึงจะรับชำระได้" : "ไม่สามารถรับชำระได้ เอกสารนี้ชำระครบแล้วหรือถูกยกเลิก") },
            ...(admin ? [{ label: "ยกเลิก", danger: true, onClick: (k: number) => { const x = shown[k]; if (x.status === VOID) return; confirm({ title: "ยกเลิกเอกสาร", message: `ต้องการยกเลิก ${x.no ?? ""} (${money(x.net)} บาท) ใช่หรือไม่ เอกสารยังเก็บไว้ในระบบพร้อมสถานะยกเลิก`, danger: true, okLabel: "ยกเลิกเอกสาร", onOk: () => { setList(list.map((y) => (y.id === x.id ? { ...x, status: VOID } : y))); toast(`ยกเลิกเอกสารแล้ว · ${x.no ?? ""} · ${x.who}`); } }); } }] : []),
          ]} />
      </Section>

      {/* ออกใบแจ้งหนี้ */}
      <Modal open={!!form} wide title="ออกใบแจ้งหนี้" onClose={() => setForm(null)}
        footer={<><button className="btn-soft" onClick={() => setForm(null)}>ยกเลิก</button><button className="btn-primary" onClick={saveNew}>บันทึกใบแจ้งหนี้</button></>}>
        {form && <div className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="ผู้รับบริการ" required><ResidentPicker value={form.who} names={billable.map((r) => r[0])} onChange={pickResident} />
              {people.length > billable.length && <p className="field-hint">ไม่แสดง {people.length - billable.length} คนที่ชำระค่าบริการเดือนนี้แล้ว ({people.filter((r) => paidNow.has(r[0])).map((r) => r[0]).join(", ")})</p>}</Field>
            <Field label="ประเภท"><select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{BILL_KINDS.map((k) => <option key={k}>{k}</option>)}</select><p className="field-hint">หมวดหลักของใบนี้ · ใบเดียวใส่ได้หลายรายการ เช่น ค่าห้อง + ค่ากายภาพ + เวชภัณฑ์</p></Field>
            <Field label="ชื่อผู้ชำระ" required><input value={form.payer} onChange={(e) => setForm({ ...form, payer: e.target.value })} /></Field>
            <Field label="วันที่"><input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
            <Field label="ที่อยู่ผู้ชำระ" className="md:col-span-2"><textarea rows={2} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></Field>
          </div>
          {unbilled.length > 0 && unbilled.some((x) => !pulled.includes(x.id)) && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span>มียา เวชภัณฑ์ หรือคอร์สกายภาพที่ยังไม่เรียกเก็บ {unbilled.filter((x) => !pulled.includes(x.id)).length} รายการ · {money(unbilled.filter((x) => !pulled.includes(x.id)).reduce((n, x) => n + x.qty * x.price, 0))} บาท</span>
            <button type="button" className="btn-soft !py-1.5" onClick={pullSupplies}>ดึงเข้าใบแจ้งหนี้นี้</button>
          </div>}
          {form.who && <p className="text-xs text-gold-500">HN {form.hn || "(ออกให้เมื่อบันทึกผู้รับบริการ)"}{form.contract ? ` · สัญญา ${form.contract}` : ""}</p>}
          <div className="bill-items">
            <div className="mb-2 flex items-center justify-between"><h3 className="font-medium text-gold-800">รายการ</h3><button type="button" className="row-action" onClick={() => setLines([...lines, blankItem()])}>+ เพิ่มรายการ</button></div>
            <div className="space-y-3">{lines.map((l, i) => {
              const set = (p: Partial<BillItem>) => setLines(lines.map((x, j) => (j === i ? { ...x, ...p } : x)));
              return <div key={i} className="bill-item">
                <Field label="รายการ"><LineDesc value={l.desc} onText={(desc) => set({ desc })} onPick={(desc, price) => set({ desc, price, vat: isRoomLine(desc) ? vatRate : 0 })} /></Field>
                <Field label="จำนวน"><input type="number" min={0} value={l.qty} onChange={(e) => set({ qty: num(e.target.value) })} /></Field>
                <Field label="ราคา/หน่วย"><input type="number" min={0} value={l.price} onChange={(e) => set({ price: num(e.target.value) })} /></Field>
                <Field label="ส่วนลด (บาท)"><input type="number" min={0} value={l.discount} onChange={(e) => set({ discount: num(e.target.value) })} /></Field>
                <Field label="ส่วนลด (%)"><input type="number" min={0} max={100} step="0.5" value={l.pct ?? 0} onChange={(e) => set({ pct: Math.min(100, num(e.target.value)) })} /></Field>
                <label className="bill-vat" title="บวกภาษีมูลค่าเพิ่มจากยอดหลังส่วนลด (ค่าห้อง)"><input type="checkbox" checked={!!l.vat} onChange={(e) => set({ vat: e.target.checked ? vatRate : 0 })} /> VAT {l.vat || vatRate}%</label>
                <button type="button" className="row-action danger" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>ลบ</button>
                {(lineDiscount(l) > 0 || !!l.vat) && <p className="bill-line-sum">ยอด {money(lineAmount(l))}{lineDiscount(l) > 0 ? <> · ลด {money(lineDiscount(l))}{l.pct ? ` (รวม ${l.pct}%)` : ""}</> : null}{l.vat ? <> · ก่อน VAT {money(lineNet(l))} · VAT {l.vat}% {money(Math.round(lineNet(l) * l.vat) / 100)}</> : null} · <b>สุทธิ {money(Math.round(lineNet(l) * (100 + (l.vat ?? 0))) / 100)}</b>{lineDiscount(l) > lineAmount(l) ? <span className="text-red-700"> · ส่วนลดเกินยอด</span> : null}</p>}
              </div>;
            })}</div>
            <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
              <label className="flex items-center gap-2 text-sm text-gold-700">อัตรา VAT (%)
                <input type="number" min={0} max={30} step="0.5" className="!w-20" value={vatRate} aria-label="อัตรา VAT"
                  onChange={(e) => { const v = Math.max(0, Math.min(30, num(e.target.value))); setVatRate(v); setLines(lines.map((l) => (l.vat ? { ...l, vat: v } : l))); }} />
                <small className="text-gold-500">ใช้กับบรรทัดที่ติ๊ก VAT · ค่าห้องติ๊กให้เอง</small></label>
              <div className="text-right text-sm text-gold-700">
                <p>รวม {money(sum.total)} · ส่วนลด {money(sum.discount)}</p>
                {vatSum.vat > 0 && <p>มูลค่าก่อน VAT {money(vatSum.base)}{vatSum.rates.map((x) => ` · VAT ${x.rate}% ${money(x.vat)}`).join("")}{vatSum.exempt > 0 ? ` · ไม่มี VAT ${money(vatSum.exempt)}` : ""}</p>}
                <b className="text-base text-gold-800">สุทธิ{vatSum.vat > 0 ? " (รวม VAT)" : ""} {money(sum.net)} บาท</b>
              </div>
            </div>
          </div>
          <Field label="หมายเหตุ"><input value={form.note ?? ""} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
        </div>}
      </Modal>

      {/* ขายคอร์สกายภาพ */}
      <Modal open={!!course} title="ขายคอร์สกายภาพ" onClose={() => setCourse(null)}
        footer={<><button className="btn-soft" onClick={() => setCourse(null)}>ยกเลิก</button><button className="btn-primary" disabled={course?.busy} onClick={saveCourse}>{course?.busy ? "กำลังบันทึก…" : "บันทึกคอร์สและออกใบแจ้งหนี้"}</button></>}>
        {course && <div className="space-y-4">
          <div className="form-grid">
            <Field label="ผู้รับบริการ" required className="md:col-span-2"><ResidentPicker value={course.who} names={people.map((r) => r[0])} onChange={(v) => setCourse({ ...course, who: v })} /></Field>
            <Field label="ชื่อคอร์ส" required className="md:col-span-2"><input value={course.name} onChange={(e) => setCourse({ ...course, name: e.target.value })} /></Field>
            <Field label="จำนวนครั้ง" required><input type="number" min={1} max={500} value={course.total} onChange={(e) => setCourse({ ...course, total: e.target.value })} /></Field>
            <Field label="ราคาคอร์ส (บาท)" required><input type="number" min={0} value={course.price} onChange={(e) => setCourse({ ...course, price: e.target.value })} placeholder="เช่น 8000" /></Field>
          </div>
          <p className="rounded-xl bg-cream-50 px-4 py-3 text-sm text-gold-700">กดบันทึกแล้วระบบเปิดใบแจ้งหนี้ที่ใส่คอร์สนี้ไว้ให้ เพิ่มรายการอื่นในใบเดียวกันได้ · นักกายภาพเห็นคอร์สและตัดครั้งได้ที่ประวัติผู้รับบริการ แท็บกายภาพ</p>
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

/**
 * ใบแจ้งหนี้แรกเข้าจากสัญญาใหม่ · แจกแจงค่าห้องตามสัญญา · คืน null ถ้าสัญญาไม่มีรายการค่าบริการเลย
 *  กรอกยอดล่วงหน้าหรือเงินประกัน = ค้างชำระ (เรียกเก็บได้ทันที) · ไม่ได้กรอก = รอตรวจสอบยอด (การเงินตรวจแล้วกดยืนยันยอดก่อนรับชำระ)
 */
export function contractInvoice(row: string[], hn: string): Invoice | null {
  const items = contractStartLines(row);
  if (!items.length) return null;
  const ready = !!(val(row[18]) || val(row[19]));
  const note = [contractStartNote(row), ready ? "" : "ออกอัตโนมัติจากสัญญา (ไม่ได้ระบุยอดล่วงหน้า) · รอการเงินตรวจสอบยอดก่อนเรียกเก็บ"].filter(Boolean).join(" · ");
  return { id: newId(), date: todayIso(), who: row[2], hn, payer: row[3], address: row[10] ?? "", kind: BILL_KINDS[0], contract: row[0], items: JSON.stringify(items), ...totals(items), status: ready ? UNPAID : DRAFT, note };
}
