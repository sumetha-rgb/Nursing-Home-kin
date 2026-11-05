"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "../Icon";
import CsvIcon from "../CsvIcon";
import { Field, Modal, PageHeader, Tabs } from "../ui";
import { useApp } from "@/lib/app";
import { downloadCsv } from "@/lib/store";
import { CAT_IDS, CATS, CatId, CODE_RE, codeProblem, PriceItem, Rate, RATE_UNITS, rateCode, RateUnit, setPrices, suggestCode } from "@/lib/priceList";

/**
 * ใบราคาและรหัส: ราคากลางทุกสาขา · ผู้จัดการสาขาและผู้บริหารเพิ่ม แก้ราคา แก้รหัส ปิดใช้ และนำเข้า/ส่งออก CSV
 * ราคาใหม่มีผลทันทีหรือตั้งวันที่ล่วงหน้าได้ · ทุกการแก้เก็บประวัติพร้อมเหตุผล · เอกสารที่ออกไปแล้วไม่เปลี่ยนตาม
 */
type Item = PriceItem & { id: string };
type Hist = { at: string; action: string; detail: string; reason: string; by: string; code: string };
type FRate = { unit: RateUnit; price: string; label: string; from?: number };
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
const post = async (body: Record<string, unknown>) => {
  const r = await fetch("/api/prices", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
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
  const [status, setStatus] = useState<Status>("all");
  const [edit, setEdit] = useState<{ item?: Item; tab: string } | null>(null);
  const [importing, setImporting] = useState(false);

  const load = async () => {
    const r = await fetch("/api/prices", { cache: "no-store" });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast(d.error || "โหลดใบราคาไม่สำเร็จ"); return; }
    setItems(d.items); setCanEdit(!!d.canEdit); setMissing(d.missing || ""); setLoaded(true);
    if (!d.missing) setPrices(d.items);
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => ({
    off: items.filter((x) => x.active === false).length,
    next: items.filter(hasNext).length,
  }), [items]);
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
      message: on ? `"${x.name}" จะกลับมาให้เลือกในใบเสนอราคา สัญญา และใบแจ้งหนี้` : `"${x.name}" จะไม่ขึ้นให้เลือกในเอกสารใหม่ · เอกสารเดิมไม่เปลี่ยน · เปิดใช้อีกครั้งได้ภายหลัง`,
      okLabel: on ? "เปิดใช้" : "ปิดใช้", danger: !on,
      onOk: () => setActive(x, false),
    });
  };

  return (
    <div className="space-y-5">
      <PageHeader title="ราคาสินค้าและบริการ" sub="ราคากลาง ใช้ทุกสาขา"
        actions={<>
          <button className="btn-soft" onClick={exportCsv} disabled={!items.length}><CsvIcon /> ส่งออก CSV</button>
          {canEdit && <button className="btn-soft" onClick={() => setImporting(true)}><CsvIcon /> นำเข้า CSV</button>}
          {canEdit && <button className="btn-primary" onClick={() => setEdit({ tab: "แก้ไข" })}><Icon name="plus" className="h-4 w-4" /> เพิ่มรายการ</button>}
        </>} />
      {missing && <p role="alert" className="form-error"><Icon name="alert" className="h-4 w-4 shrink-0" />{missing}</p>}

      <section className="card pl-panel">
        <div className="pl-tools">
          <div className="relative min-w-0">
            <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gold-400" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} className="!pl-10" placeholder="ค้นหารหัสหรือชื่อ เช่น NS-21 หรือ พ่นยา" aria-label="ค้นหารหัสหรือชื่อ" />
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value as Status)} aria-label="สถานะ" className="pl-status">
            <option value="all">ทุกสถานะ</option>
            <option value="on">ใช้อยู่</option>
            <option value="off">ปิดใช้ ({counts.off})</option>
            <option value="next">มีราคาใหม่รอมีผล ({counts.next})</option>
          </select>
        </div>
        <div className="pl-chips" role="group" aria-label="หมวด">
          <button type="button" aria-pressed={!cat} onClick={() => setCat("")}>ทั้งหมด <span>{items.length}</span></button>
          {CAT_IDS.map((c) => {
            const n = items.filter((x) => x.cat === c).length;
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
                          <b>{x.name}</b>
                          <small>
                            {/* รหัสจากใบราคาเดิม (R1, X01, P01) ไม่เคยขึ้นในเอกสาร · แสดงเฉพาะรหัสที่เคยใช้ในระบบนี้แล้วเปลี่ยน · ทุกแบบยังค้นหาเจอ */}
                            {x.old?.some((c) => CODE_RE.test(c)) ? <span>รหัสเดิม {x.old.filter((c) => CODE_RE.test(c)).join(", ")}</span> : null}
                          </small>
                        </div>
                        <div className="pl-rates">
                          {x.rates.map((r, i) => (
                            <span key={i} title={rateCode(x, i)}>
                              {money(r.price)}<i>/{rateName(r)}</i>
                              {r.next && <em>→ {money(r.next.price)} · {thDate(r.next.from)}</em>}
                            </span>
                          ))}
                        </div>
                        <button type="button" role="switch" aria-checked={x.active !== false} aria-label={`${x.code} ${x.active !== false ? "ใช้อยู่" : "ปิดใช้"}`} className="pl-switch"
                          disabled={!canEdit || busy === x.id} title={canEdit ? (x.active !== false ? "กดเพื่อปิดใช้" : "กดเพื่อเปิดใช้") : "แก้ได้เฉพาะผู้จัดการสาขาและผู้บริหาร"} onClick={() => toggle(x)}>
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
      <p className="field-hint">กดราคาในใบเสนอราคา สัญญา หรือใบแจ้งหนี้ จะได้ราคาจากหน้านี้ · เอกสารที่ออกไปแล้วไม่เปลี่ยนตาม · ส้ม = ราคาใหม่ที่ตั้งล่วงหน้า</p>

      {edit && <EditDialog key={edit.item?.id ?? "new"} item={edit.item} tab={edit.tab} items={items} canEdit={canEdit}
        onClose={() => setEdit(null)} onToggle={toggle} onSaved={(m) => { toast(m); setEdit(null); load(); }} onReload={load} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} onDone={(m) => { toast(m); setImporting(false); load(); }} />}
    </div>
  );
}

function EditDialog({ item, tab: tab0, items, canEdit, onClose, onToggle, onSaved, onReload }: {
  item?: Item; tab: string; items: Item[]; canEdit: boolean;
  onClose: () => void; onToggle: (x: Item) => void; onSaved: (msg: string) => void; onReload: () => void;
}) {
  const { toast } = useApp();
  const isNew = !item;
  const first: Form = item
    ? { id: item.id, cat: item.cat, sub: item.sub, code: item.code, name: item.name, rates: item.rates.map((r, i) => ({ unit: r.unit, price: String(r.price), label: r.label ?? "", from: i })) }
    : { cat: "NS", sub: CATS.NS.subs[0][0], code: suggestCode(items, "NS", CATS.NS.subs[0][0]), name: "", rates: [{ unit: "ครั้ง", price: "", label: "" }] };
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
  const pickCat = (c: CatId) => { const sub = CATS[c].subs[0][0]; set({ cat: c, sub, ...(codeTouched.current ? {} : { code: suggestCode(items, c, sub) }) }); };
  const pickSub = (sub: string) => set({ sub, ...(isNew && !codeTouched.current ? { code: suggestCode(items, f.cat, sub) } : {}) });

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
        rates: f.rates.map((r) => ({ unit: r.unit, price: Number(r.price), label: r.label.trim(), from: r.from })) });
      onSaved(isNew ? `เพิ่ม ${code} แล้ว` : dated ? `ตั้งราคาใหม่ ${code} แล้ว · มีผล ${thDate(dated)}` : `บันทึก ${code} แล้ว`);
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  };
  const cancelNext = async (i: number) => {
    try { await post({ op: "cancel_next", id: item!.id, i }); toast("ยกเลิกราคาที่ตั้งล่วงหน้าแล้ว"); onReload(); onClose(); }
    catch (e) { toast((e as Error).message); }
  };

  const title = isNew ? "เพิ่มรายการในใบราคา" : `${item.code} · ${item.name}`;
  const editing = canEdit && tab === "แก้ไข";
  return (
    <Modal open wide title={title} onClose={onClose}
      footer={editing ? <>
        {!isNew && <button className={`${item.active === false ? "btn-soft" : "btn-danger"} mr-auto`} onClick={() => onToggle(item)}>{item.active === false ? "เปิดใช้อีกครั้ง" : "ปิดใช้รายการนี้"}</button>}
        <button className="btn-soft" onClick={onClose}>ยกเลิก</button>
        <button className="btn-primary" disabled={busy || !!problem} title={problem} onClick={save}>{busy ? "กำลังบันทึก…" : isNew ? "เพิ่มรายการ" : dated ? `ตั้งราคาใหม่ มีผล ${thDate(dated)}` : "บันทึก"}</button>
      </> : <button className="btn-soft" onClick={onClose}>ปิดหน้าต่าง</button>}>
      <div className="space-y-5">
        {!isNew && canEdit && <Tabs tabs={["แก้ไข", "ประวัติ"]} value={tab} onChange={setTab} />}

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
                <select value={f.sub} onChange={(e) => pickSub(e.target.value)}>{CATS[f.cat].subs.map(([s, n]) => <option key={s} value={s}>{f.cat === "RM" ? s : `${s} · ${f.cat}-${Math.floor(n / 10)}x`}</option>)}</select>
              </Field>
              <Field label="รหัส" required>
                <input value={f.code} onChange={(e) => { codeTouched.current = true; set({ code: e.target.value.toUpperCase() }); }} className={`font-mono ${codeErr ? "!border-red-400" : ""}`} maxLength={5} placeholder={`${f.cat}-00`} />
              </Field>
            </div>
            {codeErr ? <p className="pl-err">{codeErr}</p>
              : <p className="field-hint">{isNew ? `ระบบเสนอรหัสว่างถัดไปในหมวดย่อยนี้ · แก้เองได้` : code !== item!.code ? `รหัสเดิม ${item!.code} ยังค้นหาเจอ และจะไม่ถูกนำไปใช้ซ้ำ` : "เปลี่ยนรหัสได้ รหัสเดิมยังค้นหาเจอ"}</p>}
            <Field label="ชื่อรายการ (ที่ขึ้นในเอกสาร)" required>
              <input value={f.name} onChange={(e) => set({ name: e.target.value })} placeholder="เช่น ค่าบริการพ่นยา พร้อมอุปกรณ์" maxLength={200} />
            </Field>
          </div>

          {/* 2 ราคา */}
          <div className="pl-step">
            <p className="pl-step-h">ราคา</p>
            <div className="pl-rate-head" aria-hidden="true"><span>รหัสราคา</span><span>หน่วย</span><span>คำอธิบาย (ถ้ามี)</span><span>ราคา (บาท)</span><span /></div>
            {f.rates.map((r, i) => {
              const was = r.from !== undefined && item ? item.rates[r.from] : undefined;
              const diff = !!was && r.price !== "" && Number(r.price) !== was.price;
              return (
                <div key={i} className="pl-rate">
                  <span className="pl-code">{rateCode(preview, i)}</span>
                  <select value={r.unit} onChange={(e) => setRate(i, { unit: e.target.value as RateUnit })} aria-label="หน่วย">{RATE_UNITS.map((u) => <option key={u}>{u}</option>)}</select>
                  <input value={r.label} onChange={(e) => setRate(i, { label: e.target.value })} placeholder={i === 0 ? "เช่น โปรโมชัน, ราคาที่ 2" : "-"} maxLength={40} aria-label="คำอธิบายราคา" />
                  <div>
                    <input type="number" min={0} inputMode="decimal" value={r.price} onChange={(e) => setRate(i, { price: e.target.value })} className={`text-right tabular-nums ${diff ? "pl-changed" : ""}`} aria-label="ราคา" />
                    {diff && <small className="pl-was">เดิม {money(was!.price)}</small>}
                    {was?.next && !diff && <small className="pl-was is-next">ราคาใหม่ {money(was.next.price)} มีผล {thDate(was.next.from)} · <button type="button" onClick={() => cancelNext(r.from!)}>ยกเลิก</button></small>}
                  </div>
                  <button type="button" className="row-action danger" disabled={f.rates.length < 2} onClick={() => set({ rates: f.rates.filter((_, j) => j !== i) })}>ลบ</button>
                </div>
              );
            })}
            {f.rates.length < 8 && <button type="button" className="pl-add" onClick={() => set({ rates: [...f.rates, { unit: f.rates[f.rates.length - 1]?.unit ?? "ครั้ง", price: "", label: "" }] })}><Icon name="plus" className="h-4 w-4" /> เพิ่มราคา</button>}
            <p className="field-hint">ท้ายรหัสราคา: S ครั้ง · D วัน · M เดือน · P แพ็กเกจ · MP โปรโมชัน · M2 ราคาที่ 2</p>
          </div>

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
