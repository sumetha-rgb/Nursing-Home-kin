"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../Icon";
import CsvIcon from "../CsvIcon";
import { Field, Modal, PageHeader, Tabs } from "../ui";
import { useApp } from "@/lib/app";
import { downloadCsv } from "@/lib/store";
import { CAT_IDS, CATS, CatId, CODE_RE, codeProblem, PriceItem, PriceSub, Rate, RATE_UNITS, rateCode, RateUnit, roomPartOf, roomShareOf, setPrices, setSubs, subRange, subsOf, suggestCode } from "@/lib/priceList";
import { baseOfIncl, DEFAULT_VAT } from "@/lib/billing";
import { useBranchNames } from "@/lib/branches";

/**
 * ใบราคาและรหัส: ราคากลางทุกสาขา · ผู้จัดการสาขาและผู้บริหารเพิ่ม แก้ราคา แก้รหัส ปิดใช้ และนำเข้า/ส่งออก CSV
 * ราคาใหม่มีผลทันทีหรือตั้งวันที่ล่วงหน้าได้ · ทุกการแก้เก็บประวัติพร้อมเหตุผล · เอกสารที่ออกไปแล้วไม่เปลี่ยนตาม
 * ราคาของสาขา (26 พ.ย. 2569): ผู้จัดการสาขาแก้ = ราคาของสาขาตัวเองเท่านั้น (ชื่อ รหัส หน่วย ใช้ร่วมทุกสาขา) · ปุ่ม ใช้ราคากลาง = เลิกตั้งราคาเอง
 *  ผู้บริหารเลือกดู/แก้ ราคากลาง หรือราคาของสาขาใดก็ได้ · ปิด/เปิดใช้รายการ = ผู้บริหารเท่านั้น (มีผลทุกสาขา)
 */
type Item = PriceItem & { id: string; central?: Rate[]; ownActive?: boolean };
type Hist = { at: string; action: string; detail: string; reason: string; by: string; code: string };
type FRate = { unit: RateUnit; price: string; label: string; from?: number; room?: string };
/** ห้องพัก: ราคา 4 แบบที่ใช้ในระบบ (หาในรายการราคาตามหน่วยและคำว่าโปรโมชัน) */
const isPromoL = (l: string) => /โปรโมชัน/.test(l);
const ROOM_ROWS: { k: string; t: string; sub?: string; unit: RateUnit; label: string; find: (r: FRate) => boolean }[] = [
  { k: "day", t: "รายวัน", unit: "วัน", label: "", find: (r) => r.unit === "วัน" },
  // รายสัปดาห์ = รายวัน × 7 (คำนวณให้ ไม่ตั้งแยก)
  { k: "week", t: "รายสัปดาห์", sub: "รายวัน × 7 วัน · คำนวณให้", unit: "สัปดาห์", label: "", find: () => false },
  { k: "month", t: "รายเดือน · ราคาปกติ", unit: "เดือน", label: "", find: (r) => r.unit === "เดือน" && !isPromoL(r.label) },
  { k: "promo", t: "รายเดือน · โปรโมชัน", sub: "ใช้ตอนเปิดสัญญา", unit: "เดือน", label: "โปรโมชัน", find: (r) => r.unit === "เดือน" && isPromoL(r.label) },
];
type Form = { id?: string; cat: CatId; sub: string; code: string; name: string; rates: FRate[] };
type Status = "all" | "on" | "off" | "next";

const MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const thDate = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return d ? `${d} ${MON[m - 1]} ${String(y + 543).slice(2)}` : ""; };
const thStamp = (s?: string) => (s ? `${thDate(s)}${s.length > 10 ? ` · ${s.slice(11, 16)}` : ""}` : "");
const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const todayIso = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const tomorrowIso = () => new Date(Date.now() + 31 * 3600e3).toISOString().slice(0, 10);
const rateName = (r: { unit: string; label?: string }) => `${r.unit}${r.label ? ` (${r.label})` : ""}`;
const flat = (s: string) => s.replace(/\s+/g, "").toLowerCase();
const hasNext = (x: PriceItem) => x.rates.some((r) => r.next);
/** สาขาที่ผู้บริหารเลือกดูอยู่ (ส่งไปกับทุกคำสั่ง · บัญชีสาขา server ใช้สาขาของบัญชีเอง) */
let VIEW_BRANCH = "";
const post = async (body: Record<string, unknown>) => {
  const r = await fetch("/api/prices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(VIEW_BRANCH ? { branch: VIEW_BRANCH } : {}), ...body }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "บันทึกไม่สำเร็จ");
  return d;
};

/** สิ่งที่จะเปลี่ยน (ตรงกับที่ server บันทึกในประวัติ) */
function changesOf(old: Item | undefined, f: Form, when: string) {
  if (!old) return [];
  const out: string[] = [];
  if (old.code !== f.code.trim().toUpperCase()) out.push(`รหัส ${old.code} → ${f.code.trim().toUpperCase()}`);
  if (old.name !== f.name.trim().replace(/\s+/g, " ")) out.push("แก้ชื่อรายการ");
  if (old.sub !== f.sub) out.push(`หมวดย่อย ${old.sub} → ${f.sub}`);
  const kept = new Set<number>();
  f.rates.forEach((r) => {
    const was = r.from !== undefined ? old.rates[r.from] : undefined, label = r.label.trim(), price = Number(r.price);
    if (!was) { out.push(`เพิ่มราคา ${r.price === "" ? "-" : money(price)}/${rateName({ unit: r.unit, label })}`); return; }
    kept.add(r.from!);
    if (rateName(was) !== rateName({ unit: r.unit, label })) out.push(`หน่วย ${rateName(was)} → ${rateName({ unit: r.unit, label })}`);
    if (r.price !== "" && price !== was.price) out.push(`ราคา${rateName({ unit: r.unit, label })} ${money(was.price)} → ${money(price)}${when ? ` มีผล ${thDate(when)}` : ""}`);
    const room = r.room === undefined || r.room === "" ? null : Number(r.room);
    if (f.cat === "RM" && (was.room ?? null) !== room) out.push(`ค่าห้อง (มี VAT) ของราคา${rateName({ unit: r.unit, label })} ${was.room !== undefined ? money(was.room) : "ค่าเริ่มต้น"} → ${room !== null ? money(room) : "ค่าเริ่มต้น"}`);
  });
  old.rates.forEach((r, i) => { if (!kept.has(i)) out.push(`ลบราคา ${money(r.price)}/${rateName(r)}`); });
  return out;
}

/** อ่าน CSV (รองรับช่องที่มีเครื่องหมายคำพูด และ ="..." ที่ระบบส่งออก) */
function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((v) => v.replace(/^﻿/, "").replace(/^="(.*)"$/, "$1").replace(/^'(?=[=+@-])/, "").trim())).filter((r) => r.some(Boolean));
}

export function PriceList() {
  const { toast, confirm } = useApp();
  const [items, setItems] = useState<Item[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [missing, setMissing] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<CatId | "">("");
  // เริ่มที่ ใช้อยู่ (รายการที่ปิดไม่แสดง · ดูได้ที่ตัวกรอง ปิดใช้ เพื่อเปิดกลับ)
  const [status, setStatus] = useState<Status>("on");
  const [edit, setEdit] = useState<{ item?: Item; tab: string } | null>(null);
  const [importing, setImporting] = useState(false);
  const [subs, setSubRows] = useState<PriceSub[]>([]);
  const [subsOpen, setSubsOpen] = useState(false);
  /** สาขาที่ดูราคาอยู่ (ว่าง = ราคากลาง) · central = ผู้บริหาร (เลือกสาขาได้ แก้ราคากลางได้) */
  const [branch, setBranch] = useState("");
  const [central, setCentral] = useState(false);
  const [view, setView] = useState("");
  const branchNames = useBranchNames();

  const load = async (v = view) => {
    VIEW_BRANCH = v;
    const r = await fetch(`/api/prices${v ? `?branch=${encodeURIComponent(v)}` : ""}`, { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast(d.error || "โหลดใบราคาไม่สำเร็จ"); return; }
    // หมวดย่อยก่อนใบราคา (setPrices แจ้งให้ช่องเลือกที่ใช้ subsOf แสดงใหม่)
    if (d.subs) { setSubs(d.subs); setSubRows(d.subs); }
    setItems(d.items); setCanEdit(!!d.canEdit); setMissing(d.missing || ""); setLoaded(true);
    setBranch(d.branch || ""); setCentral(!!d.central);
    // ช่องเลือกค่าบริการในเอกสารใช้ราคาของสาขาตัวเอง (ผู้บริหารดูสาขาอื่นอยู่ = ไม่เปลี่ยนใบราคาที่ใช้ในเอกสาร)
    if (!d.missing && !v) setPrices(d.items);
  };
  useEffect(() => { load(); return () => { VIEW_BRANCH = ""; }; }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /** ราคาที่สาขาตั้งเอง (ต่างจากราคากลาง) */
  const own = (x: Item) => !!x.central;
  // ปิด/เปิดใช้: ที่ราคากลาง (ผู้บริหาร) = ทุกสาขา · ราคาของสาขา = เฉพาะสาขานั้น
  const toggleOk = canEdit && (central || !!branch);

  const counts = useMemo(() => ({
    off: items.filter((x) => x.active === false).length,
    next: items.filter(hasNext).length,
  }), [items]);
  /** ตามสถานะที่เลือก (นับในปุ่มหมวด) */
  const byStatus = items.filter((x) => status === "all" || (status === "on" ? x.active !== false : status === "off" ? x.active === false : hasNext(x)));
  const k = flat(q);
  const shown = items.filter((x) => (!cat || x.cat === cat)
    && (status === "all" || (status === "on" ? x.active !== false : status === "off" ? x.active === false : hasNext(x)))
    && (!k || flat([x.code, x.name, x.sub, ...(x.old ?? []), ...x.rates.map((_, i) => rateCode(x, i))].join(" ")).includes(k)));
  const groups = CAT_IDS.map((c) => ({ c, list: shown.filter((x) => x.cat === c) })).filter((g) => g.list.length);

  const exportCsv = () => {
    if (!items.length) return;
    downloadCsv(`ราคาสินค้าและบริการ-${todayIso()}`,
      ["รหัส", "รายการ", "หมวด", "หมวดย่อย", "หน่วย", "คำอธิบายราคา", "ราคา", "ราคาใหม่", "มีผลวันที่", "สถานะ", "รหัสเดิม"],
      items.flatMap((x) => x.rates.map((r, i) => [rateCode(x, i), x.name, CATS[x.cat].name, x.sub, r.unit, r.label ?? "", String(r.price),
        r.next ? String(r.next.price) : "", r.next ? r.next.from : "", x.active === false ? "ปิดใช้" : "ใช้อยู่", (x.old ?? []).join(" ")])));
    toast(`ส่งออกใบราคาแล้ว ${items.length} รายการ`);
  };
  const [busy, setBusy] = useState("");
  const setActive = async (x: Item, on: boolean) => {
    setBusy(x.id);
    try { await post({ op: "active", id: x.id, active: on }); toast(`${on ? "เปิดใช้" : "ปิดใช้"} ${x.code} แล้ว`); setEdit(null); await load(); }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(""); }
  };
  /** เปิดใช้ = ทำทันที · ปิดใช้ = ถามก่อน (กันกดพลาด) */
  const toggle = (x: Item) => {
    const on = x.active === false;
    if (on) { setActive(x, true); return; }
    confirm({
      title: on ? `เปิดใช้ ${x.code} อีกครั้ง` : `ปิดใช้ ${x.code}`,
      message: on ? `"${x.name}" จะกลับมาให้เลือกในใบเสนอราคา สัญญา และใบแจ้งหนี้` : `"${x.name}" จะไม่ขึ้นให้เลือกในเอกสารใหม่${branch ? ` ของสาขา ${branch} (สาขาอื่นไม่เปลี่ยน)` : " ของทุกสาขา"} · เอกสารเดิมไม่เปลี่ยน · เปิดใช้อีกครั้งได้ภายหลัง`,
      okLabel: on ? "เปิดใช้" : "ปิดใช้", danger: !on,
      onOk: () => setActive(x, false),
    });
  };

  return (
    <div className="space-y-5">
      <PageHeader title="ราคาสินค้าและบริการ" sub={branch ? `ราคาของสาขา ${branch} · รายการที่สาขาไม่ได้ตั้งราคาเอง ใช้ราคากลาง` : "ราคากลาง · ใช้กับทุกสาขาที่ไม่ได้ตั้งราคาเอง"}
        actions={<>
          <button className="btn-soft" onClick={exportCsv} disabled={!items.length}><CsvIcon /> ส่งออก CSV</button>
          {canEdit && <button className="btn-soft" onClick={() => setImporting(true)}><CsvIcon /> นำเข้า CSV</button>}
          {canEdit && subs.length > 0 && <button className="btn-soft" onClick={() => setSubsOpen(true)}><Icon name="wrench" className="h-4 w-4" /> ตั้งค่าหมวดย่อย</button>}
          {canEdit && <button className="btn-primary" onClick={() => setEdit({ tab: "แก้ไข" })}><Icon name="plus" className="h-4 w-4" /> เพิ่มรายการ</button>}
        </>} />
      {central && <div className="pl-scope">
        <span>ดูราคาของ</span>
        <select value={view} onChange={(e) => { setView(e.target.value); load(e.target.value); }} aria-label="ดูราคาของสาขา">
          <option value="">ราคากลาง (ทุกสาขา)</option>
          {branchNames.map((b) => <option key={b} value={b}>สาขา {b}</option>)}
        </select>
        <small>{branch ? `แก้ราคาตรงนี้ = เฉพาะสาขา ${branch} · ${items.filter(own).length} รายการตั้งราคาเอง` : "แก้ราคาตรงนี้ = ราคากลาง (สาขาที่ตั้งราคาเองไม่เปลี่ยน)"}</small>
      </div>}
      {!central && branch && <p className="pl-scope"><b>ราคาของสาขา {branch}</b><small>แก้ราคาได้เฉพาะของสาขานี้ ไม่กระทบสาขาอื่น · ตั้งราคาเองแล้ว {items.filter(own).length} รายการ</small></p>}
      {missing && <p role="alert" className="form-error"><Icon name="alert" className="h-4 w-4 shrink-0" />{missing}</p>}

      <section className="card pl-panel">
        <div className="pl-tools">
          <div className="relative min-w-0">
            <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gold-400" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} className="!pl-10" placeholder="ค้นหารหัสหรือชื่อ เช่น NS-21 หรือ พ่นยา" aria-label="ค้นหารหัสหรือชื่อ" />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value as Status)} aria-label="สถานะ" className="pl-status">
            <option value="on">ใช้อยู่ ({items.length - counts.off})</option>
            <option value="off">ปิดใช้ ({counts.off})</option>
            <option value="next">มีราคาใหม่รอมีผล ({counts.next})</option>
            <option value="all">ทั้งหมด ({items.length})</option>
          </select>
        </div>
        <div className="pl-chips" role="group" aria-label="หมวด">
          <button type="button" aria-pressed={!cat} onClick={() => setCat("")}>ทั้งหมด <span>{byStatus.length}</span></button>
          {CAT_IDS.map((c) => {
            const n = byStatus.filter((x) => x.cat === c).length;
            return n ? <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(cat === c ? "" : c)}>{CATS[c].name} <span>{n}</span></button> : null;
          })}
        </div>

        {!loaded ? <p className="py-12 text-center text-sm text-gold-500">กำลังโหลด…</p>
          : !groups.length ? <p className="py-12 text-center text-sm text-gold-500">ไม่พบรายการ{q ? ` "${q}"` : ""}</p>
          : groups.map((g) => (
            <div key={g.c} className="pl-group">
              <h2><span className="pl-code">{g.c}</span>{CATS[g.c].name}</h2>
              {[...new Set(g.list.map((x) => x.sub))].map((sub) => (
                <div key={sub}>
                  <p className="pl-sub">{sub}</p>
                  <ul className="pl-list">
                    {g.list.filter((x) => x.sub === sub).map((x) => (
                      <li key={x.id} className={x.active === false ? "is-off" : ""}>
                        <span className="pl-code">{x.code}</span>
                        <div className="pl-name">
                          <b>{x.name}{x.branch && !branch && <em className="pl-own is-only">เฉพาะ {x.branch}</em>}{own(x) && <em className="pl-own">ราคาสาขา</em>}{x.ownActive && <em className="pl-own">{x.active === false ? "ปิดเฉพาะสาขา" : "เปิดเฉพาะสาขา"}</em>}</b>
                          <small>
                            {/* รหัสจากใบราคาเดิม (R1, X01, P01) ไม่เคยขึ้นในเอกสาร · แสดงเฉพาะรหัสที่เคยใช้ในระบบนี้แล้วเปลี่ยน · ทุกแบบยังค้นหาเจอ */}
                            {x.old?.some((c) => CODE_RE.test(c)) ? <span>รหัสเดิม {x.old.filter((c) => CODE_RE.test(c)).join(", ")}</span> : null}
                          </small>
                        </div>
                        <div className="pl-rates">
                          {x.rates.map((r, i) => (
                            <span key={i} title={rateCode(x, i)}>
                              {money(r.price)}<i>/{rateName(r)}</i>{x.cat === "RM" && <i className="pl-part"> · ห้อง {money(roomPartOf(r))}</i>}
                              {r.next && <em>→ {money(r.next.price)} · {thDate(r.next.from)}</em>}
                              {x.central?.[i] && x.central[i].price !== r.price && <i className="pl-central"> · กลาง {money(x.central[i].price)}</i>}
                            </span>
                          ))}
                        </div>
                        <button type="button" role="switch" aria-checked={x.active !== false} aria-label={`${x.code} ${x.active !== false ? "ใช้อยู่" : "ปิดใช้"}`} className="pl-switch"
                          disabled={!toggleOk || busy === x.id} title={toggleOk ? `${x.active !== false ? "กดเพื่อปิดใช้" : "กดเพื่อเปิดใช้"}${branch ? ` เฉพาะสาขา ${branch}` : " ทุกสาขา"}` : "แก้ได้เฉพาะผู้จัดการสาขาและผู้บริหาร"} onClick={() => toggle(x)}>
                          <i aria-hidden="true" /><span>{x.active !== false ? "ใช้อยู่" : "ปิดใช้"}</span>
                        </button>
                        <button type="button" className="row-action" onClick={() => setEdit({ item: x, tab: canEdit ? "แก้ไข" : "ประวัติ" })}>{canEdit ? "แก้ไข" : "ประวัติ"}</button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ))}
      </section>
      <p className="field-hint">ราคาในหน้านี้ใช้ตอนออกใบเสนอราคา สัญญา และใบแจ้งหนี้ · แก้ราคาแล้วเอกสารเก่าไม่เปลี่ยน</p>
      <p className="pl-legend"><span><i className="is-next" />ราคาใหม่ ยังไม่ถึงวันใช้</span><span><b>ราคาสาขา</b> สาขาตั้งเอง</span><span><b>กลาง</b> ราคาเดียวกันทุกสาขา</span></p>

      {edit && <EditDialog key={edit.item?.id ?? "new"} item={edit.item} tab={edit.tab} items={items} canEdit={canEdit} branch={branch} toggleOk={toggleOk}
        onClose={() => setEdit(null)} onToggle={toggle} onSaved={(m) => { toast(m); setEdit(null); load(); }} onReload={load} />}
      {subsOpen && <SubsDialog subs={subs} onClose={() => setSubsOpen(false)} onReload={load} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} onDone={(m) => { toast(m); setImporting(false); load(); }} />}
    </div>
  );
}

const NEW_SUB = "__new_sub__";

/**
 * ตั้งค่าหมวดย่อย: เพิ่ม · เปลี่ยนชื่อ (รายการในหมวดย่อยเปลี่ยนตาม) · สวิตช์เปิด/ปิดใช้
 *  ปิดใช้ = ไม่ขึ้นให้เลือกตอนเพิ่มรายการ · หมวดย่อยที่ยังมีรายการใช้อยู่ปิดไม่ได้ · ช่วงรหัสจองให้อัตโนมัติ (ช่วงละ 10 เลข)
 */
function SubsDialog({ subs, onClose, onReload }: { subs: PriceSub[]; onClose: () => void; onReload: () => Promise<void> | void }) {
  return (
    <Modal open wide title="ตั้งค่าหมวดย่อย" onClose={onClose} footer={<button className="btn-primary" onClick={onClose}>เสร็จ</button>}>
      <SubsBody subs={subs} onReload={onReload} />
    </Modal>
  );
}

/** หมวดย่อยใบราคาในหน้า "ตั้งค่า": โหลดใบราคาเอง (แก้ได้เฉพาะผู้จัดการสาขาและผู้บริหาร) */
export function PriceSubsPanel() {
  const [subs, setSubRows] = useState<PriceSub[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const load = async () => {
    const r = await fetch("/api/prices", { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (d.subs) { setSubs(d.subs); setSubRows(d.subs); } else setSubRows([]);
    setCanEdit(!!d.canEdit);
    if (d.items?.length && !d.missing) setPrices(d.items);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!subs) return <p className="text-sm text-gold-500">กำลังโหลด…</p>;
  if (!canEdit) return <p className="text-sm text-gold-600">หมวดย่อยใบราคาแก้ได้เฉพาะผู้จัดการสาขาและผู้บริหาร</p>;
  return <SubsBody subs={subs} onReload={load} />;
}

function SubsBody({ subs, onReload }: { subs: PriceSub[]; onReload: () => Promise<void> | void }) {
  const { toast } = useApp();
  const [cat, setCat] = useState<CatId>("NS");
  const [edit, setEdit] = useState<{ id: string; name: string } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (body: Record<string, unknown>, done: string) => {
    if (busy) return;
    setBusy(true);
    try { await post(body); await onReload(); toast(done); setEdit(null); setAdding(null); }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  };
  const rows = subs.filter((x) => x.cat === cat).sort((a, b) => a.start - b.start);
  const full = (Math.floor(Math.max(0, ...rows.map((x) => x.start)) / 10) + 1) * 10 > 90;
  return (
      <div className="space-y-4">
        <div className="pl-chips is-pick" role="radiogroup" aria-label="หมวด">
          {CAT_IDS.map((c) => <button key={c} type="button" role="radio" aria-checked={cat === c} aria-pressed={cat === c} onClick={() => { setCat(c); setEdit(null); setAdding(null); }}><span className="pl-code">{c}</span> {CATS[c].name}</button>)}
        </div>
        <ul className="sub-list">
          {rows.map((x) => (
            <li key={x.id} className={x.active ? "" : "is-off"}>
              <span className="pl-code">{cat === "RM" ? `${cat}-${String(x.start).padStart(2, "0")}` : subRange(cat, x.start)}</span>
              {edit?.id === x.id
                ? <span className="flex min-w-0 gap-2">
                    <input autoFocus value={edit.name} maxLength={60} aria-label="ชื่อหมวดย่อย" onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Enter") run({ op: "sub_edit", id: x.id, name: edit.name }, "เปลี่ยนชื่อหมวดย่อยแล้ว"); if (e.key === "Escape") setEdit(null); }} />
                    <button type="button" className="btn-primary !min-h-0 shrink-0" disabled={busy} onClick={() => run({ op: "sub_edit", id: x.id, name: edit.name }, "เปลี่ยนชื่อหมวดย่อยแล้ว")}>บันทึก</button>
                    <button type="button" className="btn-soft !min-h-0 shrink-0" onClick={() => setEdit(null)}>ยกเลิก</button>
                  </span>
                : <span className="sub-t"><b>{x.name}</b><small>{x.count ? `${x.count} รายการ` : "ยังไม่มีรายการ"}</small></span>}
              <button type="button" role="switch" aria-checked={x.active} className="pl-switch" aria-label={`${x.name} ${x.active ? "เปิดใช้งาน" : "ปิดใช้งาน"}`}
                disabled={busy} title={x.active ? "กดเพื่อปิดใช้ (ต้องไม่มีรายการที่ใช้อยู่)" : "กดเพื่อเปิดใช้"}
                onClick={() => run({ op: "sub_edit", id: x.id, active: !x.active }, `${x.active ? "ปิดใช้" : "เปิดใช้"}หมวดย่อย ${x.name} แล้ว`)}>
                <i aria-hidden="true" /><span>{x.active ? "เปิดใช้งาน" : "ปิดใช้งาน"}</span>
              </button>
              {edit?.id !== x.id ? <button type="button" className="row-action" onClick={() => setEdit({ id: x.id, name: x.name })}>เปลี่ยนชื่อ</button> : <span />}
            </li>
          ))}
        </ul>
        {adding === null
          ? <button type="button" className="btn-soft" disabled={full} title={full ? `หมวดนี้รหัสเต็มถึง ${cat}-99 แล้ว` : undefined} onClick={() => setAdding("")}><Icon name="plus" className="h-4 w-4" /> เพิ่มหมวดย่อยใน{CATS[cat].name}</button>
          : <div className="flex flex-wrap items-center gap-2">
              <input autoFocus className="!w-auto min-w-0 flex-1" value={adding} maxLength={60} placeholder={`ชื่อหมวดย่อยใหม่ใน${CATS[cat].name}`} aria-label="ชื่อหมวดย่อยใหม่"
                onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") run({ op: "sub_add", cat, name: adding }, `เพิ่มหมวดย่อย ${adding.trim()} แล้ว`); if (e.key === "Escape") setAdding(null); }} />
              <button type="button" className="btn-primary" disabled={busy} onClick={() => run({ op: "sub_add", cat, name: adding }, `เพิ่มหมวดย่อย ${adding.trim()} แล้ว`)}>เพิ่ม</button>
              <button type="button" className="btn-soft" onClick={() => setAdding(null)}>ยกเลิก</button>
            </div>}
        <p className="field-hint">ระบบตั้งรหัสให้หมวดย่อยใหม่เอง · เปลี่ยนชื่อได้ รหัสและราคาไม่เปลี่ยน · ปิดหมวดได้เมื่อไม่มีรายการเหลือในหมวด</p>
      </div>
  );
}

function EditDialog({ item, tab: tab0, items, canEdit, branch, toggleOk, onClose, onToggle, onSaved, onReload }: {
  item?: Item; tab: string; items: Item[]; canEdit: boolean;
  /** แก้ราคาของสาขา (ว่าง = ราคากลาง): ล็อกชื่อ รหัส หมวดย่อย หน่วย แก้ได้เฉพาะราคา */ branch: string; toggleOk: boolean;
  onClose: () => void; onToggle: (x: Item) => void; onSaved: (msg: string) => void; onReload: () => Promise<void> | void;
}) {
  const { toast } = useApp();
  const isNew = !item;
  const first: Form = item
    ? { id: item.id, cat: item.cat, sub: item.sub, code: item.code, name: item.name, rates: item.rates.map((r, i) => ({ unit: r.unit, price: String(r.price), label: r.label ?? "", from: i, room: r.room !== undefined ? String(r.room) : "" })) }
    : { cat: "NS", sub: subsOf("NS")[0][0], code: suggestCode(items, "NS", subsOf("NS")[0][0]), name: "", rates: [{ unit: "ครั้ง", price: "", label: "" }] };
  const [f, setF] = useState<Form>(first);
  const [tab, setTab] = useState(tab0);
  const [whenMode, setWhenMode] = useState<"now" | "date">("now");
  const [when, setWhen] = useState(tomorrowIso());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState<Hist[] | null>(null);
  const codeTouched = useRef(false);

  useEffect(() => {
    if (tab !== "ประวัติ" || !item || hist) return;
    fetch(`/api/prices?history=${encodeURIComponent(item.id)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : { items: [] })).then((d) => setHist(d.items ?? []));
  }, [tab, item, hist]);

  const set = (p: Partial<Form>) => setF((x) => ({ ...x, ...p }));
  const setRate = (i: number, p: Partial<FRate>) => setF((x) => ({ ...x, rates: x.rates.map((r, j) => (j === i ? { ...r, ...p } : r)) }));
  const pickCat = (c: CatId) => { const sub = subsOf(c)[0][0]; setNewSub(null); set({ cat: c, sub, ...(codeTouched.current ? {} : { code: suggestCode(items, c, sub) }) }); };
  const pickSub = (sub: string) => { if (sub === NEW_SUB) { setNewSub(""); return; } set({ sub, ...(isNew && !codeTouched.current ? { code: suggestCode(items, f.cat, sub) } : {}) }); };
  // เพิ่มหมวดย่อยใหม่จากช่องเลือก: ระบบจองช่วงรหัสว่างถัดไป แล้วเลือกหมวดย่อยนั้นพร้อมเสนอรหัสแรก
  const [newSub, setNewSub] = useState<string | null>(null);
  const [subBusy, setSubBusy] = useState(false);
  const addSub = async () => {
    const name = (newSub ?? "").trim();
    if (name.length < 2 || subBusy) return toast("ใส่ชื่อหมวดย่อยอย่างน้อย 2 ตัวอักษร");
    setSubBusy(true);
    try {
      const d = await post({ op: "sub_add", cat: f.cat, name });
      await onReload();
      setNewSub(null);
      set({ sub: d.sub.name, ...(isNew && !codeTouched.current ? { code: suggestCode(items, f.cat, d.sub.name) } : {}) });
      toast(`เพิ่มหมวดย่อย ${d.sub.name} แล้ว · รหัส ${subRange(f.cat, d.sub.start)}`);
    } catch (e) { toast((e as Error).message); }
    finally { setSubBusy(false); }
  };

  const code = f.code.trim().toUpperCase();
  const codeErr = codeProblem(items, code, f.cat, item?.id);
  const priceChanged = !!item && f.rates.some((r) => r.from !== undefined && r.price !== "" && Number(r.price) !== item.rates[r.from].price);
  const dated = priceChanged && whenMode === "date" && when > todayIso() ? when : "";
  const changes = changesOf(item, f, dated);
  const preview = { code, rates: f.rates.map((r) => ({ unit: r.unit, price: 0, label: r.label.trim() })) as Rate[] };
  const rateErr = f.rates.some((r) => r.price === "" || !(Number(r.price) >= 0)) ? "ใส่ราคาให้ครบทุกช่อง" : "";
  const nameErr = f.name.trim().length < 2 ? "ใส่ชื่อรายการ" : "";
  const problem = codeErr || nameErr || rateErr || (!isNew && !changes.length ? "ยังไม่ได้แก้อะไร" : "") || (!isNew && !reason.trim() ? "ใส่เหตุผลที่แก้" : "");

  const save = async () => {
    if (busy) return;
    if (problem) return toast(problem);
    setBusy(true);
    try {
      await post({ op: "save", id: f.id, cat: f.cat, sub: f.sub, code, name: f.name, reason, when: dated,
        rates: f.rates.map((r) => ({ unit: r.unit, price: Number(r.price), label: r.label.trim(), from: r.from, ...(f.cat === "RM" && r.room !== undefined && r.room !== "" ? { room: Number(r.room) } : {}) })) });
      onSaved(isNew ? `เพิ่ม ${code} แล้ว` : dated ? `ตั้งราคาใหม่ ${code} แล้ว · มีผล ${thDate(dated)}` : `บันทึก ${code} แล้ว`);
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  };
  /** ราคาของสาขา: ล็อกทุกอย่างยกเว้นราคา */
  const lock = !!branch && !isNew && item?.branch !== branch;
  const resetBranch = async () => {
    if (busy || !item) return;
    setBusy(true);
    try { await post({ op: "branch_reset", id: item.id }); onSaved(`${item.code} กลับไปใช้ราคากลางแล้ว`); }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  };
  const cancelNext = async (i: number) => {
    try { await post({ op: "cancel_next", id: item!.id, i }); toast("ยกเลิกราคาที่ตั้งล่วงหน้าแล้ว"); onReload(); onClose(); }
    catch (e) { toast((e as Error).message); }
  };

  const title = isNew ? "เพิ่มรายการในใบราคา" : `${item.code} · ${item.name}${lock ? ` · ราคาสาขา ${branch}` : ""}`;
  const editing = canEdit && tab === "แก้ไข";
  return (
    <Modal open wide title={title} onClose={onClose}
      footer={editing ? <>
        {!isNew && toggleOk && <button className={`${item.active === false ? "btn-soft" : "btn-danger"} mr-auto`} onClick={() => onToggle(item)}>{item.active === false ? "เปิดใช้อีกครั้ง" : "ปิดใช้รายการนี้"}</button>}
        {lock && item.central && <button className="btn-soft mr-auto" disabled={busy} onClick={resetBranch} title="เลิกตั้งราคาเอง ใช้ราคากลางแทน">ใช้ราคากลาง</button>}
        <button className="btn-soft" onClick={onClose}>ยกเลิก</button>
        <button className="btn-primary" disabled={busy || !!problem} title={problem} onClick={save}>{busy ? "กำลังบันทึก…" : isNew ? "เพิ่มรายการ" : dated ? `ตั้งราคาใหม่ มีผล ${thDate(dated)}` : "บันทึก"}</button>
      </> : <button className="btn-soft" onClick={onClose}>ปิดหน้าต่าง</button>}>
      <div className="space-y-5">
        {!isNew && canEdit && <Tabs tabs={["แก้ไข", "ประวัติ"]} value={tab} onChange={setTab} />}
        {isNew && branch && <p className="pl-scope is-in"><b>รายการใหม่นี้ใช้เฉพาะสาขา {branch}</b><small>สาขาอื่นไม่เห็น · แก้ชื่อ รหัส ราคา และปิดใช้ได้เอง</small></p>}
        {lock && tab === "แก้ไข" && <p className="pl-scope is-in"><b>แก้เฉพาะราคาของสาขา {branch}</b><small>สาขาอื่นไม่เปลี่ยน · ชื่อ รหัส และหน่วยใช้ร่วมทุกสาขา แก้ได้เฉพาะผู้บริหาร{item?.central ? "" : " · ตอนนี้สาขานี้ใช้ราคากลาง"}</small></p>}

        {tab === "ประวัติ" && item ? (
          !hist ? <p className="py-8 text-center text-sm text-gold-500">กำลังโหลด…</p>
            : !hist.length ? <p className="py-8 text-center text-sm text-gold-500">ยังไม่มีประวัติ</p>
            : <ol className="pl-hist">{hist.map((h, i) => (
              <li key={i}>
                <time>{thStamp(h.at)} · {h.by}</time>
                <b>{h.action}{h.code !== item.code ? ` (${h.code})` : ""}</b>
                {h.detail && <span>{h.detail}</span>}
                {h.reason && <small>เหตุผล: {h.reason}</small>}
              </li>
            ))}</ol>
        ) : (<>
          {/* 1 รายการ */}
          <div className="pl-step">
            <p className="pl-step-h">รายการ</p>
            {isNew ? <div className="pl-chips is-pick" role="radiogroup" aria-label="หมวด">
              {CAT_IDS.map((c) => <button key={c} type="button" role="radio" aria-checked={f.cat === c} aria-pressed={f.cat === c} onClick={() => pickCat(c)}><span className="pl-code">{c}</span> {CATS[c].name}</button>)}
            </div> : <p className="text-sm text-gold-700">หมวด <b className="font-semibold text-gold-800">{f.cat} · {CATS[f.cat].name}</b></p>}
            <div className="grid gap-3 sm:grid-cols-[1fr_150px]">
              <Field label="หมวดย่อย">
                {newSub === null
                  ? <select value={f.sub} disabled={lock} onChange={(e) => pickSub(e.target.value)}>
                      {subsOf(f.cat, item?.sub).map(([s, n]) => <option key={s} value={s}>{f.cat === "RM" ? s : `${s} · ${subRange(f.cat, n)}`}</option>)}
                      {canEdit && !lock && <option value={NEW_SUB}>+ เพิ่มหมวดย่อยใหม่…</option>}
                    </select>
                  : <div className="flex gap-2">
                      <input autoFocus value={newSub} maxLength={60} placeholder={`ชื่อหมวดย่อยใหม่ใน${CATS[f.cat].name}`} aria-label="ชื่อหมวดย่อยใหม่"
                        onChange={(e) => setNewSub(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSub(); } if (e.key === "Escape") setNewSub(null); }} />
                      <button type="button" className="btn-primary !min-h-0 shrink-0" disabled={subBusy} onClick={addSub}>{subBusy ? "กำลังเพิ่ม…" : "เพิ่ม"}</button>
                      <button type="button" className="btn-soft !min-h-0 shrink-0" onClick={() => setNewSub(null)}>ยกเลิก</button>
                    </div>}
              </Field>
              <Field label="รหัส" required>
                <input value={f.code} disabled={lock} onChange={(e) => { codeTouched.current = true; set({ code: e.target.value.toUpperCase() }); }} className={`font-mono ${codeErr ? "!border-red-400" : ""}`} maxLength={5} placeholder={`${f.cat}-00`} />
              </Field>
            </div>
            {codeErr ? <p className="pl-err">{codeErr}</p>
              : lock ? null : <p className="field-hint">{isNew ? `ระบบเสนอรหัสว่างถัดไปในหมวดย่อยนี้ · แก้เองได้` : code !== item!.code ? `รหัสเดิม ${item!.code} ยังค้นหาเจอ และจะไม่ถูกนำไปใช้ซ้ำ` : "เปลี่ยนรหัสได้ รหัสเดิมยังค้นหาเจอ"}</p>}
            <Field label="ชื่อรายการ (ที่ขึ้นในเอกสาร)" required>
              <input value={f.name} disabled={lock} onChange={(e) => set({ name: e.target.value })} placeholder="เช่น ค่าบริการพ่นยา พร้อมอุปกรณ์" maxLength={200} />
            </Field>
          </div>

          {/* 2 ราคา · ห้องพักใช้ตาราง 4 แถว (รายวัน / รายสัปดาห์ / รายเดือนปกติ / รายเดือนโปรโมชัน) */}
          {f.cat === "RM" && <div className="pl-step">
            <p className="pl-step-h">ราคาห้อง <small className="font-normal text-gold-500">ทุกช่องเป็นราคารวม VAT แล้ว · กรอกราคาห้องทั้งหมด และส่วนที่เป็นค่าห้อง ที่เหลือระบบคิดเป็นค่าบริการทางการแพทย์ให้</small></p>
            <div className="rm-rates">
              <div className="rm-head" aria-hidden="true"><span>แบบ</span><span>ราคาห้องทั้งหมด</span><span>ค่าบริการห้องพัก</span><span>ค่าบริการทางการแพทย์</span><span /></div>
              {ROOM_ROWS.map((row) => {
                const i = f.rates.findIndex(row.find);
                const dayR = f.rates.find((r) => r.unit === "วัน"), day = Number(dayR?.price) || 0;
                if (row.k === "week") {
                  // รายสัปดาห์: ราคาห้องและค่าห้องรายวัน × 7 ตามแถวรายวันด้านบน (แก้ที่รายวัน)
                  const dPart = Math.min(day, dayR?.room !== undefined && dayR.room !== "" ? Number(dayR.room) || 0 : roomShareOf(day));
                  const wp = day * 7, wPart = dPart * 7, wBase = baseOfIncl(wPart, DEFAULT_VAT);
                  return (
                    <div key={row.k} className="rm-row is-calc">
                      <span className="rm-k"><b>{row.t}</b><small>{row.sub}</small></span>
                      <span className="rm-f"><span className="rm-lab">ราคาห้องทั้งหมด</span><span className="rm-val">{money(wp)}</span><small>{money(day)} × 7 วัน</small></span>
                      <span className="rm-f"><span className="rm-lab">ค่าบริการห้องพัก</span><span className="rm-val">{money(wPart)}</span><small>ก่อน VAT {money(wBase)} + VAT {money(Math.round((wPart - wBase) * 100) / 100)}</small></span>
                      <span className="rm-med"><span className="rm-lab">ค่าบริการทางการแพทย์</span><b>{money(Math.max(0, wp - wPart))}</b></span>
                      <span />
                    </div>
                  );
                }
                if (i < 0) return (
                  <div key={row.k} className="rm-row is-empty">
                    <span className="rm-k"><b>{row.t}</b>{row.sub && <small>{row.sub}</small>}</span>
                    <span className="rm-none">{row.k === "week" && day ? `ยังไม่ได้ตั้ง · ตอนนี้ระบบใช้รายวัน × 7 = ${money(day * 7)} (ค่าห้อง ${money(roomShareOf(day * 7))})` : "ยังไม่ได้ตั้ง"}</span>
                    {!lock && <button type="button" className="row-action is-primary" onClick={() => set({ rates: [...f.rates, { unit: row.unit, price: row.k === "week" && day ? String(day * 7) : "", label: row.label, room: "" }] })}>+ ตั้งราคา{row.t.replace(/ ·.*/, "")}</button>}
                  </div>
                );
                const r = f.rates[i], price = Number(r.price) || 0, own = r.room !== undefined && r.room !== "";
                const part = Math.min(price, own ? Number(r.room) || 0 : roomShareOf(price)), med = Math.max(0, price - part), base = baseOfIncl(part, DEFAULT_VAT);
                const was = r.from !== undefined && item ? item.rates[r.from] : undefined, diff = !!was && r.price !== "" && price !== was.price;
                return (
                  <div key={row.k} className="rm-row">
                    <span className="rm-k"><b>{row.t}</b><small>{rateCode(preview, i)}{row.sub ? ` · ${row.sub}` : ""}</small></span>
                    <label className="rm-f"><span className="rm-lab">ราคาห้องทั้งหมด</span>
                      <input type="number" min={0} inputMode="decimal" value={r.price} onChange={(e) => setRate(i, { price: e.target.value })} className={`text-right tabular-nums ${diff ? "pl-changed" : ""}`} aria-label={`ราคาห้องทั้งหมด ${row.t}`} />
                      {lock && item?.central?.[r.from!] && <small className="pl-was">ราคากลาง {money(item.central[r.from!].price)}</small>}
                      {diff ? <small className="pl-was">เดิม {money(was!.price)}</small> : was?.next ? <small className="pl-was is-next">ราคาใหม่ {money(was.next.price)} มีผล {thDate(was.next.from)} · <button type="button" onClick={() => cancelNext(r.from!)}>ยกเลิก</button></small> : null}
                    </label>
                    <label className="rm-f"><span className="rm-lab">ค่าบริการห้องพัก</span>
                      <input type="number" min={0} inputMode="decimal" value={r.room ?? ""} placeholder={String(roomShareOf(price))} onChange={(e) => setRate(i, { room: e.target.value })} className="text-right tabular-nums" aria-label={`ค่าบริการห้องพัก ${row.t}`} />
                      <small>{own ? "" : "40% (ค่าเริ่มต้น) · "}ก่อน VAT {money(base)} + VAT {money(Math.round((part - base) * 100) / 100)}</small>
                    </label>
                    <span className="rm-med"><span className="rm-lab">ค่าบริการทางการแพทย์</span><b>{money(med)}</b></span>
                    {row.k === "week" && !lock ? <button type="button" className="row-action danger" onClick={() => set({ rates: f.rates.filter((_, j) => j !== i) })}>ลบ</button> : <span />}
                  </div>
                );
              })}
            </div>
            <p className="field-hint">ตอนเปิดสัญญา การ์ด "รายเดือน" ใช้ราคาโปรโมชัน · ใบเสร็จแสดงค่าบริการห้องพักและค่าบริการทางการแพทย์แยกกัน · VAT คิดเฉพาะค่าบริการห้องพัก</p>
          </div>}
          {(f.cat !== "RM" || f.rates.some((r) => !ROOM_ROWS.some((row) => f.rates.findIndex(row.find) === f.rates.indexOf(r)))) && <div className="pl-step">
            <p className="pl-step-h">{f.cat === "RM" ? "ราคาอื่น ๆ ของห้องนี้" : "ราคา"}</p>
            <div className="pl-rate-head" aria-hidden="true"><span>รหัสราคา</span><span>หน่วย</span><span>คำอธิบาย (ถ้ามี)</span><span>{f.cat === "RM" ? "ราคาห้อง (บาท · รวม VAT)" : "ราคา (บาท)"}</span><span /></div>
            {f.rates.map((r, i) => {
              if (f.cat === "RM" && ROOM_ROWS.some((row) => f.rates.findIndex(row.find) === i)) return null;
              const was = r.from !== undefined && item ? item.rates[r.from] : undefined;
              const diff = !!was && r.price !== "" && Number(r.price) !== was.price;
              return (
                <div key={i} className="pl-rate">
                  <span className="pl-code">{rateCode(preview, i)}</span>
                  <select value={r.unit} disabled={lock} onChange={(e) => setRate(i, { unit: e.target.value as RateUnit })} aria-label="หน่วย">{RATE_UNITS.map((u) => <option key={u}>{u}</option>)}</select>
                  <input value={r.label} disabled={lock} onChange={(e) => setRate(i, { label: e.target.value })} placeholder={i === 0 ? "เช่น โปรโมชัน, ราคาที่ 2" : "-"} maxLength={40} aria-label="คำอธิบายราคา" />
                  <div>
                    <input type="number" min={0} inputMode="decimal" value={r.price} onChange={(e) => setRate(i, { price: e.target.value })} className={`text-right tabular-nums ${diff ? "pl-changed" : ""}`} aria-label="ราคา" />
                    {diff && <small className="pl-was">เดิม {money(was!.price)}</small>}
                    {lock && item?.central?.[r.from!] && <small className="pl-was">ราคากลาง {money(item.central[r.from!].price)}</small>}
                    {/* ห้องพัก: แยกส่วนค่าห้อง (มี VAT) ที่เหลือเป็นค่าบริการทางการแพทย์ (ไม่มี VAT) */}
                    {f.cat === "RM" && <label className="pl-room">ในนี้เป็นค่าห้อง (รวม VAT){(r.room === undefined || r.room === "") && <i className="not-italic text-gold-500"> · ค่าเริ่มต้น</i>}
                      <input type="number" min={0} inputMode="decimal" value={r.room ?? ""} placeholder={String(roomShareOf(Number(r.price) || 0))} onChange={(e) => setRate(i, { room: e.target.value })} aria-label={`ค่าห้อง (มี VAT) ของราคา${r.unit}`} />
                      {Number(r.price) > 0 && <small>ค่าบริการทางการแพทย์ {money(Math.max(0, (Number(r.price) || 0) - Math.min(Number(r.price) || 0, r.room !== undefined && r.room !== "" ? Number(r.room) : roomShareOf(Number(r.price) || 0))))}</small>}
                    </label>}
                    {was?.next && !diff && <small className="pl-was is-next">ราคาใหม่ {money(was.next.price)} มีผล {thDate(was.next.from)} · <button type="button" onClick={() => cancelNext(r.from!)}>ยกเลิก</button></small>}
                  </div>
                  {lock ? <span /> : <button type="button" className="row-action danger" disabled={f.rates.length < 2} onClick={() => set({ rates: f.rates.filter((_, j) => j !== i) })}>ลบ</button>}
                </div>
              );
            })}
            {f.rates.length < 8 && f.cat !== "RM" && !lock && <button type="button" className="pl-add" onClick={() => set({ rates: [...f.rates, { unit: f.rates[f.rates.length - 1]?.unit ?? "ครั้ง", price: "", label: "" }] })}><Icon name="plus" className="h-4 w-4" /> เพิ่มราคา</button>}
            <p className="field-hint">ท้ายรหัสราคา: S ครั้ง · D วัน · W สัปดาห์ · M เดือน · P แพ็กเกจ · MP โปรโมชัน · M2 ราคาที่ 2</p>
          </div>}

          {/* 3 มีผลเมื่อ + เหตุผล (เฉพาะตอนแก้) */}
          {!isNew && changes.length > 0 && (
            <div className="pl-step">
              {priceChanged && <>
                <p className="pl-step-h">ราคาใหม่มีผล</p>
                <div className="flex flex-wrap items-center gap-3">
                  <Tabs tabs={["ทันที", "ตั้งวันที่"]} value={whenMode === "now" ? "ทันที" : "ตั้งวันที่"} onChange={(v) => setWhenMode(v === "ทันที" ? "now" : "date")} />
                  {whenMode === "date" && <input type="date" value={when} min={tomorrowIso()} onChange={(e) => setWhen(e.target.value)} className="!w-auto" aria-label="วันที่มีผล" />}
                </div>
              </>}
              <div className="pl-impact">
                <b>จะเปลี่ยน</b>
                <ul>{changes.map((c) => <li key={c}>{c}</li>)}</ul>
                <small>{dated ? `ก่อน ${thDate(dated)} เอกสารยังใช้ราคาเดิม` : "เอกสารที่ออกใหม่ใช้ราคานี้ทันที"} · เอกสารที่ออกไปแล้วไม่เปลี่ยน</small>
              </div>
              <Field label="เหตุผลที่แก้" required>
                <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ปรับตามต้นทุนอุปกรณ์ปี 2570" maxLength={300} />
              </Field>
            </div>
          )}
          {!isNew && item.updatedAt && <p className="field-hint">แก้ล่าสุด {thStamp(item.updatedAt)} · {item.updatedBy}</p>}
        </>)}
      </div>
    </Modal>
  );
}

type PlanRow = { row: number; code: string; name: string; change?: string; skip?: string };

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: (msg: string) => void }) {
  const { toast } = useApp();
  const [file, setFile] = useState("");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [plan, setPlan] = useState<PlanRow[] | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const read = async (fl: File) => {
    setPlan(null); setFile(fl.name);
    const buf = await fl.arrayBuffer();
    // ไฟล์ที่ Excel บันทึกเป็น CSV ธรรมดาเป็นภาษาไทยแบบ Windows (TIS-620) · อ่านเป็น UTF-8 ไม่ได้ให้ลองแบบนั้น
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { text = new TextDecoder("windows-874").decode(buf); }
    const t = parseCsv(text);
    const head = t[0] ?? [], col = (n: string) => head.indexOf(n);
    const ci = { code: col("รหัส"), name: col("รายการ"), price: col("ราคา"), status: col("สถานะ") };
    if (ci.code < 0 || ci.price < 0) { setRows([]); return toast("ไม่พบคอลัมน์ \"รหัส\" และ \"ราคา\" · ใช้ไฟล์จากปุ่มส่งออก CSV"); }
    const list = t.slice(1).map((r) => ({ code: r[ci.code] ?? "", name: ci.name >= 0 ? r[ci.name] ?? "" : "", price: r[ci.price] ?? "", status: ci.status >= 0 ? r[ci.status] ?? "" : "" }));
    setRows(list);
    setBusy(true);
    try { const d = await post({ op: "import", rows: list, apply: false }); setPlan(d.plan); }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!reason.trim()) return toast("ใส่เหตุผลที่นำเข้า");
    setBusy(true);
    try { const d = await post({ op: "import", rows, apply: true, reason }); onDone(`นำเข้าแล้ว · เปลี่ยน ${d.count} รายการ`); }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  };
  const change = plan?.filter((p) => p.change && p.change !== "ไม่เปลี่ยน") ?? [];
  const skip = plan?.filter((p) => p.skip) ?? [];
  const same = plan ? plan.length - change.length - skip.length : 0;

  return (
    <Modal open wide title="นำเข้าใบราคาจาก CSV" onClose={onClose}
      footer={<>
        <button className="btn-soft" onClick={onClose}>ยกเลิก</button>
        <button className="btn-primary" disabled={busy || !change.length || !reason.trim()} onClick={apply}>{busy ? "กำลังทำ…" : `นำเข้า ${change.length} แถว`}</button>
      </>}>
      <div className="space-y-5">
        <ol className="pl-howto">
          <li>กด <b>ส่งออก CSV</b> แล้วแก้ช่อง <b>ราคา</b> หรือ <b>สถานะ</b> (ใช้อยู่ / ปิดใช้) ใน Excel</li>
          <li>บันทึกเป็น CSV แล้วเลือกไฟล์ด้านล่าง · ระบบสรุปให้ดูก่อน ยังไม่บันทึก</li>
        </ol>
        <label className="pl-file">
          <CsvIcon className="h-6 w-6" />
          <span>{file || "เลือกไฟล์ CSV"}</span>
          <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { const fl = e.target.files?.[0]; if (fl) read(fl); e.target.value = ""; }} />
        </label>
        <p className="field-hint">ราคาจากไฟล์มีผลทันที · เพิ่มรายการใหม่ใช้ปุ่ม &quot;เพิ่มรายการ&quot;</p>

        {plan && <>
          <div className="pl-sum">
            <div className="is-on"><b>{change.length}</b><span>จะเปลี่ยน</span></div>
            <div><b>{same}</b><span>ไม่เปลี่ยน</span></div>
            <div className={skip.length ? "is-bad" : ""}><b>{skip.length}</b><span>ข้าม</span></div>
          </div>
          {change.length + skip.length > 0 && <ul className="pl-plan">
            {[...change, ...skip].map((p) => (
              <li key={p.row} className={p.skip ? "is-skip" : ""}>
                <span className="pl-code">{p.code || "-"}</span>
                <span className="min-w-0 flex-1 truncate">{p.name || "-"}</span>
                <b>{p.skip ? `ข้าม · ${p.skip}` : p.change}</b>
                <small>แถว {p.row}</small>
              </li>
            ))}
          </ul>}
          {change.length > 0 && <Field label="เหตุผลที่นำเข้า" required><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ปรับราคาประจำปี 2570" maxLength={300} /></Field>}
        </>}
      </div>
    </Modal>
  );
}
