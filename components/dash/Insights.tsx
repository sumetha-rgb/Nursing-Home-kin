"use client";
import { ReactNode, useEffect, useRef, useState } from "react";
import type { BranchCompare } from "@/lib/insights";
import { Field, Modal, Section } from "../ui";
import { money } from "@/lib/billing";
import { useApp } from "@/lib/app";
import { useCrud } from "@/lib/store";
import type { FinSummary } from "../care/FinanceAnalytics";
import type { HomeData, TodoItem } from "./Todo";

/* ---------- ข้อมูลจาก /api/ops?op=insights (lib/insights.ts) ---------- */
type Vit = { logs: number; abnormal: number; critical: number };
type CareStat = { total: number; done: number; checked: number; ontime: number; stars: number | null; low: number };
type Shift = { day: string; shift: string; staff: number };
type FlowStat = { quotes: number; contracts: number; admits: number; discharges: number; los: number | null };
export type Insights = {
  range: { from: string; to: string; pfrom: string; pto: string };
  attention: HomeData;
  health: { cur: Vit & { alerts: number; ackMin: number | null; meds: { total: number; given: number } }; prev: Vit & { alerts: number; ackMin: number | null; meds: { total: number; given: number } }; admitted: number; weekly: (Vit & { from: string; to: string })[]; repeat: { name: string; n: number; critical: number }[] };
  care: { cur: CareStat; prev: CareStat; weekly: { from: string; to: string; total: number; done: number }[] };
  team: { residents: number; cur: { shifts: Shift[]; late: number; lateMin: number; absent: number }; prev: { shifts: Shift[]; late: number; lateMin: number; absent: number } };
  flow: { cur: FlowStat; prev: FlowStat; monthly: { month: string; admits: number; discharges: number }[] };
  occupancy: { capacity: number; inBed: number; monthly: { month: string; people: number }[] };
  /** เทียบสาขา (เฉพาะผู้บริหารที่ดูรวมทุกสาขา) */
  compare?: BranchCompare[];
};

/* ---------- เป้าหมาย (เก็บใน doc_settings คีย์ dash_targets · ค่า default + รายสาขา) ---------- */
export type Targets = { occupancy: number; collect: number; tasks: number; ontime: number; ackMin: number; meds: number; ratio: number };
export const DEFAULT_TARGETS: Targets = { occupancy: 85, collect: 95, tasks: 98, ontime: 90, ackMin: 15, meds: 100, ratio: 6 };
type TargetStore = { default?: Partial<Targets>; branches?: Record<string, Partial<Targets>> };
const TARGET_FIELDS: { k: keyof Targets; label: string; unit: string; hint: string }[] = [
  { k: "occupancy", label: "อัตราเข้าพัก", unit: "%", hint: "ขั้นต่ำ" },
  { k: "collect", label: "อัตราเก็บเงินได้", unit: "%", hint: "รับชำระ ÷ ยอดออกใบของเดือน" },
  { k: "tasks", label: "งานสำเร็จ", unit: "%", hint: "งานที่ส่ง ÷ งานที่สั่ง" },
  { k: "ontime", label: "ส่งงานตรงเวลา", unit: "%", hint: "ส่งภายใน 30 นาทีหลังเวลาที่กำหนด" },
  { k: "ackMin", label: "เวลารับทราบค่าผิดปกติ", unit: "นาที", hint: "ไม่เกิน" },
  { k: "meds", label: "ให้ยาครบตามมื้อ", unit: "%", hint: "ขั้นต่ำ" },
  { k: "ratio", label: "ผู้รับบริการต่อพยาบาล 1 คน", unit: "คน", hint: "ไม่เกิน (ต่อกะ)" },
];
export function useTargets(branch: string) {
  const [store, setStore] = useState<TargetStore>({});
  const load = () => fetch("/api/clinic?op=doc_settings", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => {
    const raw = d?.settings?.dash_targets;
    try { setStore(raw ? JSON.parse(raw) : {}); } catch { setStore({}); }
  }).catch(() => {});
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const t: Targets = { ...DEFAULT_TARGETS, ...(store.default ?? {}), ...(branch ? store.branches?.[branch] ?? {} : {}) };
  return { targets: t, store, reload: load };
}

/** หมวดของเป้า (จัดหน้าต่างตั้งเป้า) · dir = ทิศของเป้า: min = ไม่ต่ำกว่า · max = ไม่เกิน */
const TARGET_GROUPS: { name: string; items: { k: keyof Targets; dir: "min" | "max" }[] }[] = [
  { name: "การเงินและการเข้าพัก", items: [{ k: "occupancy", dir: "min" }, { k: "collect", dir: "min" }] },
  { name: "คุณภาพงานดูแล", items: [{ k: "tasks", dir: "min" }, { k: "ontime", dir: "min" }, { k: "meds", dir: "min" }] },
  { name: "ความปลอดภัยและกำลังคน", items: [{ k: "ackMin", dir: "max" }, { k: "ratio", dir: "max" }] },
];

/**
 * ตั้งเป้า: ผู้บริหารเลือกด้านซ้ายว่าจะตั้ง "ค่าเริ่มต้นทุกสาขา" หรือสาขาใด (แต่ละสาขาตั้งอิสระได้) · ผู้จัดการสาขาตั้งของสาขาตัวเอง
 *  ช่องที่ว่าง = ใช้ค่าเริ่มต้น · ช่องที่ตั้งเองมีแถบสีทองและปุ่ม "ใช้ค่าเริ่มต้น" · ล้างทุกช่องแล้วบันทึก = กลับไปใช้ค่าเริ่มต้นทั้งหมด
 */
export function TargetsDialog({ open, onClose, branch, store, onSaved, isGlobal }: { open: boolean; onClose: () => void; branch: string; store: TargetStore; onSaved: () => void; isGlobal: boolean }) {
  const { toast, confirm } = useApp();
  const br = useCrud("branches", []);
  const names = br.rows.filter((r) => r[1] && !/^ปิด/.test(r[10] ?? "")).map((r) => r[1]);
  // scope = สาขาที่กำลังตั้งเป้า · ว่าง = ค่าเริ่มต้นทุกสาขา (เฉพาะผู้บริหาร) · เริ่มจากสาขาที่เลือกไว้ในหน้า
  const [scope, setScope] = useState(branch);
  // สำเนาในหน้าต่าง: บันทึกหลายสาขาต่อกันได้โดยไม่ทับของสาขาที่เพิ่งบันทึก (ระหว่างรอโหลดใหม่)
  const [local, setLocal] = useState<TargetStore>(store);
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setScope(branch); setLocal(store); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const curOf = (sc: string): Partial<Targets> => (sc ? local.branches?.[sc] ?? {} : local.default ?? {});
  const cur = curOf(scope);
  const formOf = (c: Partial<Targets>) => Object.fromEntries(TARGET_FIELDS.map((x) => [x.k, c[x.k] !== undefined ? String(c[x.k]) : ""]));
  useEffect(() => { if (open) setF(formOf(cur)); }, [open, scope, local]); // eslint-disable-line react-hooks/exhaustive-deps
  /** ค่าที่ใช้ถ้าเว้นว่าง: สาขา = ค่าเริ่มต้นทุกสาขา · ค่าเริ่มต้นทุกสาขา = ค่าของระบบ */
  const fallback: Targets = scope ? { ...DEFAULT_TARGETS, ...(local.default ?? {}) } : DEFAULT_TARGETS;
  const ownN = (b: string) => Object.keys(local.branches?.[b] ?? {}).length;
  const dirty = JSON.stringify(f) !== JSON.stringify(formOf(cur));
  const pick = (sc: string) => {
    if (sc === scope) return;
    if (!dirty) return setScope(sc);
    confirm({ title: "ยังไม่ได้บันทึก", message: `ค่าที่แก้ของ${scope ? `สาขา${scope}` : "ค่าเริ่มต้นทุกสาขา"}ยังไม่ได้บันทึก · เปลี่ยนไป${sc ? `สาขา${sc}` : "ค่าเริ่มต้นทุกสาขา"}โดยไม่บันทึก?`, okLabel: "เปลี่ยนโดยไม่บันทึก", onOk: () => setScope(sc) });
  };
  const save = async () => {
    const vals: Partial<Targets> = {};
    for (const x of TARGET_FIELDS) { const v = f[x.k]?.trim(); if (v) { const nv = Number(v); if (!(nv > 0)) return toast(`กรุณากรอก${x.label}เป็นตัวเลขมากกว่า 0`); vals[x.k] = nv; } }
    const branches = { ...(local.branches ?? {}) };
    if (scope) { if (Object.keys(vals).length) branches[scope] = vals; else delete branches[scope]; }
    const next: TargetStore = scope ? { ...local, branches } : { ...local, default: vals };
    setBusy(true);
    const r = await fetch("/api/clinic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "doc_settings", key: "dash_targets", value: JSON.stringify(next) }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast(d.error || "บันทึกเป้าหมายไม่สำเร็จ");
    setLocal(next); onSaved();
    toast(`บันทึกเป้าหมายแล้ว · ${scope ? (Object.keys(vals).length ? `สาขา${scope}` : `สาขา${scope} กลับไปใช้ค่าเริ่มต้น`) : "ค่าเริ่มต้นทุกสาขา"}`);
    // ผู้บริหารตั้งหลายสาขาต่อกันได้ (หน้าต่างยังเปิดอยู่) · ผู้จัดการสาขาปิดหน้าต่าง
    if (!isGlobal) onClose();
  };
  const fieldOf = (k: keyof Targets) => TARGET_FIELDS.find((x) => x.k === k)!;
  const hasAny = TARGET_FIELDS.some((x) => f[x.k]?.trim());
  return (
    <Modal open={open} wide title={`ตั้งเป้าหมาย · ${scope ? `สาขา${scope}` : "ค่าเริ่มต้นทุกสาขา"}`} onClose={onClose}
      footer={<>
        {hasAny && <button className="btn-soft tg-clear" disabled={busy} onClick={() => setF(Object.fromEntries(TARGET_FIELDS.map((x) => [x.k, ""])))}>{scope ? "ใช้ค่าเริ่มต้นทั้งหมด" : "ล้างทุกช่อง"}</button>}
        <button className="btn-soft" onClick={onClose}>{isGlobal ? "ปิด" : "ยกเลิก"}</button>
        <button className="btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? "กำลังบันทึก…" : dirty ? "บันทึกเป้าหมาย" : "บันทึกแล้ว"}</button>
      </>}>
      <div className={`tg ${isGlobal ? "" : "is-single"}`}>
        {isGlobal && <nav className="tg-nav" aria-label="เลือกว่าจะตั้งเป้าของใคร">
          <button type="button" className={!scope ? "is-on" : ""} aria-current={!scope ? "true" : undefined} onClick={() => pick("")}>
            <b>ค่าเริ่มต้นทุกสาขา</b><small>ใช้กับสาขาที่ไม่ได้ตั้งเอง</small>
          </button>
          <span className="tg-nav-h">ตั้งรายสาขา</span>
          {names.map((b) => (
            <button key={b} type="button" className={`${scope === b ? "is-on" : ""} ${ownN(b) ? "is-own" : ""}`} aria-current={scope === b ? "true" : undefined} onClick={() => pick(b)}>
              <b>{b}</b><small>{ownN(b) ? `ตั้งเอง ${ownN(b)} ค่า` : "ใช้ค่าเริ่มต้น"}</small>
            </button>
          ))}
        </nav>}
        <div className="tg-body">
          <p className="tg-intro">{scope
            ? <>ตั้งเฉพาะ<b>สาขา{scope}</b> · เว้นว่าง = ใช้ค่าเริ่มต้นทุกสาขา</>
            : <>ใช้กับ<b>ทุกสาขาที่ไม่ได้ตั้งเอง</b> · เว้นว่าง = ค่าของระบบ</>} · ป้ายสีบนการ์ดภาพรวมเทียบกับเป้านี้</p>
          {TARGET_GROUPS.map((g) => (
            <section key={g.name} className="tg-group" aria-label={g.name}>
              <h4>{g.name}</h4>
              {g.items.map(({ k, dir }) => {
                const x = fieldOf(k), v = f[k] ?? "", set = v.trim() !== "";
                return (
                  <div key={k} className={`tg-row ${set ? "is-set" : ""}`}>
                    <label htmlFor={`tg-${k}`}><b>{x.label}</b><small>{dir === "min" ? "ไม่ต่ำกว่า" : "ไม่เกิน"}{x.hint && !/^(ขั้นต่ำ|ไม่เกิน)/.test(x.hint) ? ` · ${x.hint}` : x.hint.includes("ต่อกะ") ? " · ต่อกะ" : ""} · ค่าเริ่มต้น {fallback[k]} {x.unit}</small></label>
                    <div className="tg-in">
                      <input id={`tg-${k}`} type="number" min={0} inputMode="decimal" value={v} placeholder={String(fallback[k])} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
                      <span>{x.unit}</span>
                      {set ? <button type="button" className="tg-reset" title={`ใช้ค่าเริ่มต้น (${fallback[k]})`} aria-label={`${x.label} ใช้ค่าเริ่มต้น ${fallback[k]}`} onClick={() => setF({ ...f, [k]: "" })}>↺</button> : <i className="tg-reset" aria-hidden />}
                    </div>
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </div>
    </Modal>
  );
}

/* ---------- การ์ดตัวชี้วัด: ค่าช่วงนี้ · ▲▼ เทียบช่วงก่อน · ป้ายเทียบเป้า ---------- */
/** delta.text = ▲▼ ส่วนต่าง (ว่าง = เท่ากัน · null = ช่วงที่เทียบไม่มีข้อมูล) · delta.vs = ช่วงที่เทียบของการ์ดนี้ (ไม่ใส่ = ช่วงที่เลือกบนหน้า) */
export type Delta = { text: string | null; good: boolean | null; vs?: string };
export type Kpi = { key: string; label: string; value: string; delta?: Delta; target?: { text: string; tone: "ok" | "warn" | "bad" }; note?: string; onClick?: () => void };
/** ข้อความเทียบ เช่น "▲ เพิ่มขึ้น 15% จาก 1–4 ต.ค." · "เท่ากับเมื่อวาน" · "ไม่มีข้อมูล 1–4 ต.ค. ให้เทียบ" */
export function deltaText(d: Delta | undefined, vs: string) {
  if (!d) return "";
  const v = d.vs ?? vs;
  return d.text === null ? `ไม่มีข้อมูล${v.startsWith(" ") ? v : ` ${v}`} ให้เทียบ` : !d.text ? `เท่ากับ${v}` : `${d.text} จาก${v}`;
}
export function KpiGrid({ items, vs }: { items: Kpi[]; vs: string }) {
  return (
    <div className="kgrid">
      {items.map((k) => {
        const body = <>
          <span className="k">{k.label}</span><b>{k.value}</b>
          {k.delta && <span className={`d ${k.delta.good === null ? "" : k.delta.good ? "up" : "dn"}`}>{deltaText(k.delta, vs)}</span>}
          {k.note && <span className="d">{k.note}</span>}
          {k.target && <span className={`tg ${k.target.tone}`}>{k.target.text}</span>}
        </>;
        return k.onClick ? <button key={k.key} type="button" className="kpi is-link" onClick={k.onClick}>{body}</button> : <div key={k.key} className="kpi">{body}</div>;
      })}
    </div>
  );
}
/** ▲▼ เทียบช่วงก่อน · higherBetter = ค่ามากขึ้นคือดีขึ้น · unit = หน่วยของส่วนต่าง (pt = จุดเปอร์เซ็นต์) */
export function deltaOf(cur: number | null, prev: number | null, higherBetter: boolean, unit = "", vs?: string): Delta {
  if (cur === null || prev === null) return { text: null, good: null, vs };
  const d = Math.round((cur - prev) * 10) / 10;
  if (!d) return { text: "", good: null, vs };
  return { text: `${d > 0 ? "▲ เพิ่มขึ้น" : "▼ ลดลง"} ${Math.abs(d)}${unit}`, good: d > 0 === higherBetter, vs };
}
/** ชื่อช่วงที่เอามาเทียบ: วันนี้ → "เมื่อวาน" · เดือนเต็ม → " ต.ค. 69" · บางวัน → " 1–4 ต.ค." (ขึ้นต้นด้วยช่องว่าง ต่อท้ายคำว่า "จาก") */
export function vsLabel(pfrom: string, pto: string, today: boolean) {
  if (today) return "เมื่อวาน";
  const d1 = Number(pfrom.slice(8, 10)), d2 = Number(pto.slice(8, 10));
  const last = new Date(Date.UTC(Number(pto.slice(0, 4)), Number(pto.slice(5, 7)), 0)).getUTCDate();
  if (pfrom.slice(0, 7) === pto.slice(0, 7) && d1 === 1 && d2 === last) return ` ${monTh(pfrom.slice(0, 7))}`;
  const m = TH_MON[Number(pto.slice(5, 7)) - 1];
  return pfrom === pto ? ` ${d2} ${m}` : pfrom.slice(0, 7) === pto.slice(0, 7) ? ` ${d1}–${d2} ${m}` : ` ${dayTh(pfrom)} – ${dayTh(pto)}`;
}
/** ป้ายเทียบเป้า: ถึงเป้า (เขียว) · ห่างไม่เกิน 5% ของเป้า = ใกล้เป้า (ส้ม) · ยังไม่ถึงเป้า (แดง) · คำเดียวกันทั้งตัวชี้วัดที่ยิ่งมากยิ่งดีและยิ่งน้อยยิ่งดี */
export function targetOf(v: number | null, goal: number, higherBetter: boolean, unit: string): Kpi["target"] {
  if (v === null) return undefined;
  const ok = higherBetter ? v >= goal : v <= goal;
  const near = higherBetter ? v >= goal * 0.95 : v <= goal * 1.05;
  return { text: `เป้า ${goal}${unit} · ${ok ? "ถึงเป้า" : near ? "ใกล้เป้า" : "ยังไม่ถึงเป้า"}`, tone: ok ? "ok" : near ? "warn" : "bad" };
}
export const pctOf = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);

/* ---------- กราฟเล็ก (แกนเดียว) · เส้นประสีแดง = เป้า ---------- */
const TH_MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
export const monTh = (ym: string) => `${TH_MON[Number(ym.slice(5, 7)) - 1]} ${String(Number(ym.slice(0, 4)) + 543).slice(2)}`;
export const dayTh = (iso: string) => `${Number(iso.slice(8, 10))} ${TH_MON[Number(iso.slice(5, 7)) - 1]}`;
type Series = { name: string; color: string; data: (number | null)[] };
/**
 * กราฟเล็ก (แกนเดียว) วาดตามความกว้างจริงของการ์ด ตัวหนังสือจึงขนาดคงที่ 11px ทุกจอ
 *  เส้น: โค้งนุ่ม พื้นไล่สีใต้เส้น จุดเฉพาะค่าล่าสุด · แท่ง: มุมบนมน เว้นช่องระหว่างชุด
 *  ชี้/แตะที่ช่วงไหนเห็นค่า (เส้นแนวตั้ง + กล่องค่า) · เส้นประ = เป้า · ไม่มีข้อมูล = เส้นขาดช่วง
 */
export function MiniChart({ labels, series, type = "bar", target, max, fmt = (v) => String(Math.round(v)), aria, height = 230 }: { labels: string[]; series: Series[]; type?: "bar" | "line"; target?: number; max?: number; fmt?: (v: number) => string; aria: string; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const H = height, L = 44, R = 16, T = 22, B = 30, n = labels.length, plotW = W - L - R, plotH = H - T - B, gw = plotW / Math.max(1, n);
  const vals = series.flatMap((s) => s.data.filter((v): v is number => v !== null));
  // ค่าบนสุดของแกนเป็นเลขกลม (เส้นกลางเป็นจำนวนเต็มด้วย) ป้ายแกนจึงตรงกับเส้นจริง
  const raw = Math.max(1, ...vals, target ?? 0) * 1.15;
  const mag = 10 ** Math.floor(Math.log10(raw)), nice = [1, 2, 4, 5, 10].map((x) => x * mag).find((x) => x >= raw) ?? 10 * mag;
  const top = max ?? (raw <= 10 ? Math.max(2, Math.ceil(raw / 2) * 2) : nice);
  const x = (i: number) => L + gw * i + gw / 2, y = (v: number) => T + plotH - (v / top) * plotH;
  const step = gw < 46 ? Math.ceil(46 / gw) : 1; // ป้ายแกน x ไม่ชนกันบนจอแคบ
  const k = series.length, bw = Math.min(26, (gw * 0.62) / k);
  const uid = aria.replace(/[^a-z0-9]/gi, "").slice(0, 12) + series.length;
  /** เส้นโค้งผ่านทุกจุด (Catmull-Rom → Bézier) แยกเป็นช่วงเมื่อเจอค่าว่าง */
  const segs = (data: (number | null)[]) => {
    const out: [number, number][][] = []; let cur: [number, number][] = [];
    data.forEach((v, i) => { if (v === null) { if (cur.length) out.push(cur); cur = []; } else cur.push([x(i), y(v)]); });
    if (cur.length) out.push(cur);
    return out;
  };
  const curve = (p: [number, number][]) => p.length < 2 ? "" : p.reduce((d, pt, i) => {
    if (!i) return `M${pt[0]},${pt[1]}`;
    const p0 = p[i - 2] ?? p[i - 1], p1 = p[i - 1], p3 = p[i + 1] ?? pt, t = 0.18;
    const c1 = [p1[0] + (pt[0] - p0[0]) * t, Math.min(T + plotH, p1[1] + (pt[1] - p0[1]) * t)], c2 = [pt[0] - (p3[0] - p1[0]) * t, Math.min(T + plotH, pt[1] - (p3[1] - p1[1]) * t)];
    return `${d} C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${pt[0]},${pt[1]}`;
  }, "");
  const tip = hover !== null ? series.map((s) => ({ name: s.name, color: s.color, v: s.data[hover] })) : [];
  const tipLeft = hover !== null ? Math.min(Math.max(x(hover), 70), W - 70) : 0;
  return (
    <div className="mchart" ref={box} onMouseLeave={() => setHover(null)}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={aria}>
        <defs>{series.map((s, j) => <linearGradient key={j} id={`g${uid}${j}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={s.color} stopOpacity={0.22} /><stop offset="100%" stopColor={s.color} stopOpacity={0} /></linearGradient>)}</defs>
        {[0, 0.5, 1].map((g) => <g key={g}><line x1={L} x2={W - R} y1={y(top * g)} y2={y(top * g)} className={g ? "mc-grid" : "mc-base"} /><text x={L - 8} y={y(top * g) + 4} textAnchor="end" className="mc-axis">{fmt(top * g)}</text></g>)}
        {hover !== null && (type === "line" ? <line x1={x(hover)} x2={x(hover)} y1={T} y2={T + plotH} className="mc-cross" /> : <rect x={L + gw * hover + 2} y={T} width={gw - 4} height={plotH} rx={6} className="mc-band" />)}
        {type === "line" ? series.map((s, j) => {
          const parts = segs(s.data);
          const lastI = s.data.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0).pop() ?? -1;
          return <g key={j}>
            {parts.map((p, pi) => p.length > 1 && <path key={`a${pi}`} d={`${curve(p)} L${p[p.length - 1][0]},${T + plotH} L${p[0][0]},${T + plotH} Z`} fill={`url(#g${uid}${j})`} />)}
            {parts.map((p, pi) => p.length > 1 ? <path key={`l${pi}`} d={curve(p)} fill="none" stroke={s.color} strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" /> : <circle key={`l${pi}`} cx={p[0][0]} cy={p[0][1]} r={3.5} fill={s.color} />)}
            {hover !== null && s.data[hover] !== null && <circle cx={x(hover)} cy={y(s.data[hover]!)} r={5} fill={s.color} stroke="#fff" strokeWidth={2} />}
            {lastI >= 0 && hover === null && <g>
              <circle cx={x(lastI)} cy={y(s.data[lastI]!)} r={5} fill={s.color} stroke="#fff" strokeWidth={2} />
              <rect x={x(lastI) - 22} y={y(s.data[lastI]!) - 30} width={44} height={20} rx={10} className="mc-pill" />
              <text x={x(lastI)} y={y(s.data[lastI]!) - 16} textAnchor="middle" className="mc-pill-t">{fmt(s.data[lastI]!)}</text>
            </g>}
          </g>;
        }) : series.map((s, j) => s.data.map((v, i) => {
          if (v === null || v <= 0) return null;
          const bx = x(i) - (bw * k) / 2 + j * bw + 1, w = bw - 2, by = y(v), h = T + plotH - by, r = Math.min(4, w / 2, h);
          return <path key={`${j}-${i}`} d={`M${bx},${T + plotH} V${by + r} Q${bx},${by} ${bx + r},${by} H${bx + w - r} Q${bx + w},${by} ${bx + w},${by + r} V${T + plotH} Z`} fill={s.color} opacity={hover === null || hover === i ? 1 : 0.45} />;
        }))}
        {target !== undefined && <g>
          <line x1={L} x2={W - R} y1={y(target)} y2={y(target)} className="mc-target" />
          <text x={W - R} y={y(target) - 6} textAnchor="end" className="mc-target-t">เป้า {fmt(target)}</text>
        </g>}
        {labels.map((lb, i) => (i % step === 0 || i === n - 1) && <text key={i} x={x(i)} y={H - 9} textAnchor="middle" className={`mc-axis ${hover === i ? "is-on" : ""}`}>{lb}</text>)}
        {labels.map((_, i) => <rect key={`h${i}`} x={L + gw * i} y={T} width={gw} height={plotH + B} fill="transparent" onMouseEnter={() => setHover(i)} onTouchStart={() => setHover(i)} />)}
      </svg>
      {hover !== null && <div className="mc-tip" style={{ left: tipLeft }}>
        <b>{labels[hover]}</b>
        {tip.map((t) => <span key={t.name}>{k > 1 && <i style={{ background: t.color }} />}{k > 1 ? `${t.name} ` : ""}<strong>{t.v === null ? "ไม่มีข้อมูล" : fmt(t.v)}</strong></span>)}
        {target !== undefined && <small>เป้า {fmt(target)}</small>}
      </div>}
      {k > 1 && <p className="mchart-legend">{series.map((s) => <span key={s.name}><i style={{ background: s.color }} />{s.name}</span>)}</p>}
    </div>
  );
}
const GOLD = "#a87a2c", BLUE = "#2f74b5";

/* ---------- แท็บสุขภาพผู้รับบริการ ---------- */
export function HealthTab({ d, t, vs, onResident }: { d: Insights; t: Targets; vs: string; onResident: (name: string) => void }) {
  const h = d.health, meds = pctOf(h.cur.meds.given, h.cur.meds.total), medsP = pctOf(h.prev.meds.given, h.prev.meds.total);
  return (
    <div className="space-y-6">
      <KpiGrid items={[
        { key: "ab", label: "ค่าผิดปกติ / เฝ้าระวัง", value: String(h.cur.abnormal), delta: deltaOf(h.cur.abnormal, h.prev.abnormal, false, " ครั้ง"), note: `ผิดปกติ ${h.cur.critical} · จากการวัด ${h.cur.logs} ครั้ง` },
        { key: "ack", label: "เวลาเฉลี่ยถึงพยาบาลรับทราบ", value: h.cur.ackMin === null ? "-" : `${h.cur.ackMin} นาที`, delta: deltaOf(h.cur.ackMin, h.prev.ackMin, false, " นาที"), target: targetOf(h.cur.ackMin, t.ackMin, false, " นาที"), note: `แจ้งเตือน ${h.cur.alerts} ครั้ง` },
        { key: "adm", label: "แอดมิทโรงพยาบาลตอนนี้", value: `${h.admitted} คน` },
        { key: "meds", label: "ให้ยาครบตามมื้อ", value: meds === null ? "-" : `${meds}%`, delta: deltaOf(meds, medsP, true, "%"), target: targetOf(meds, t.meds, true, "%"), note: h.cur.meds.total ? `ขาด ${h.cur.meds.total - h.cur.meds.given} มื้อ จาก ${h.cur.meds.total}` : "ยังไม่มีมื้อยาในช่วงนี้" },
      ]} vs={vs} />
      <div className="grid gap-6 xl:grid-cols-[3fr_2fr]">
        <Section title="ค่าผิดปกติรายสัปดาห์" sub="จากบันทึกสัญญาณชีพ · ผิดปกติ (ทอง) / เฝ้าระวัง (ฟ้า)">
          <MiniChart aria="ค่าผิดปกติรายสัปดาห์" labels={h.weekly.map((w) => `${dayTh(w.from)}`)} series={[{ name: "ผิดปกติ", color: GOLD, data: h.weekly.map((w) => w.critical) }, { name: "เฝ้าระวัง", color: BLUE, data: h.weekly.map((w) => w.abnormal - w.critical) }]} />
        </Section>
        <Section title="ผิดปกติซ้ำบ่อย (7 วัน)" sub="ตั้งแต่ 2 ครั้งขึ้นไป · กดชื่อเพื่อเปิดประวัติ">
          {!h.repeat.length ? <p className="rounded-xl bg-cream-50 px-4 py-6 text-center text-sm text-gold-600">ไม่มีผู้รับบริการที่ผิดปกติซ้ำใน 7 วัน</p> : (
            <ul className="space-y-2">{h.repeat.map((x) => (
              <li key={x.name}><button type="button" className="flex w-full items-center justify-between gap-3 rounded-xl border border-cream-300 px-4 py-2.5 text-left text-sm hover:border-gold-300" onClick={() => onResident(x.name)}>
                <span className="font-medium text-gold-900">{x.name}</span><span className="text-xs">{x.critical ? <b className="text-red-700">ผิดปกติ {x.critical}</b> : null}{x.critical && x.n - x.critical ? " · " : ""}{x.n - x.critical ? <span className="text-amber-800">เฝ้าระวัง {x.n - x.critical}</span> : null}</span>
              </button></li>
            ))}</ul>
          )}
        </Section>
      </div>
    </div>
  );
}

/* ---------- แท็บทีมงาน ---------- */
export function TeamTab({ d, t, vs }: { d: Insights; t: Targets; vs: string }) {
  const tm = d.team, res = tm.residents;
  const ratio = (staff: number) => (staff ? Math.round((res / staff) * 10) / 10 : null);
  const toneOf = (staff: number) => (!staff ? "bad" : (ratio(staff) ?? 0) > t.ratio ? "warn" : "ok");
  const past = tm.cur.shifts.filter((s) => s.day <= d.range.to);
  const short = past.filter((s) => toneOf(s.staff) !== "ok").length, shortP = tm.prev.shifts.filter((s) => toneOf(s.staff) !== "ok").length;
  const staffed = past.filter((s) => s.staff), avg = staffed.length ? Math.round((res / (staffed.reduce((n, s) => n + s.staff, 0) / staffed.length)) * 10) / 10 : null;
  // 14 วันล่าสุดในช่วง (รวม 7 วันข้างหน้าที่จัดเวรไว้แล้ว)
  const days = [...new Set(tm.cur.shifts.map((s) => s.day))].slice(-14);
  return (
    <div className="space-y-6">
      <KpiGrid items={[
        { key: "ratio", label: "ผู้รับบริการต่อพยาบาล 1 คน (เฉลี่ยต่อกะ)", value: avg === null ? "-" : `1 : ${avg}`, target: avg === null ? undefined : targetOf(avg, t.ratio, false, " คน"), note: `ผู้รับบริการพักอยู่ ${res} คน` },
        { key: "short", label: "กะที่ไม่มีคนหรือคนไม่พอ", value: `${short} กะ`, delta: deltaOf(short, shortP, false, " กะ"), target: short ? { text: "ต้องจัดคนเพิ่ม", tone: "bad" } : { text: "ครบทุกกะ", tone: "ok" } },
        { key: "late", label: "มาสาย", value: `${tm.cur.late} ครั้ง`, delta: deltaOf(tm.cur.late, tm.prev.late, false, " ครั้ง"), note: `รวม ${tm.cur.lateMin} นาที` },
        { key: "absent", label: "ขาดงาน (ไม่เช็คชื่อ)", value: `${tm.cur.absent} ครั้ง`, delta: deltaOf(tm.cur.absent, tm.prev.absent, false, " ครั้ง") },
      ]} vs={vs} />
      <Section title="คนเข้าเวรต่อผู้รับบริการ รายกะ" sub={`เกณฑ์ไม่เกิน ${t.ratio} คนต่อพยาบาล 1 คน · 14 วันล่าสุด`}>
        {!days.length ? <p className="rounded-xl bg-cream-50 px-4 py-6 text-center text-sm text-gold-600">ไม่มีข้อมูลเวรในช่วงนี้</p> : (
          <><div className="overflow-x-auto"><table className="data-table w-full min-w-[480px]"><thead><tr><th>วันที่</th><th>เวรเช้า</th><th>เวรดึก</th></tr></thead><tbody>
            {days.map((day) => <tr key={day}><td>{dayTh(day)}</td>{["เช้า", "ดึก"].map((sh) => { const s = tm.cur.shifts.find((x) => x.day === day && x.shift === sh); const st = s?.staff ?? 0; const tone = toneOf(st);
              return <td key={sh}><span className={`status-badge ${tone === "bad" ? "status-danger" : tone === "warn" ? "status-warning" : "status-success"}`}>{st ? `${st} คน · 1 : ${ratio(st)}` : "ไม่มีคน"}</span></td>; })}</tr>)}
          </tbody></table></div>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gold-600"><span><span className="status-badge status-success">เขียว</span> ตามเกณฑ์</span><span><span className="status-badge status-warning">ส้ม</span> เกินเกณฑ์</span><span><span className="status-badge status-danger">แดง</span> ไม่มีคน</span></p></>
        )}
      </Section>
    </div>
  );
}

/* ---------- แท็บรับเข้า-จำหน่าย ---------- */
export function FlowTab({ d, vs }: { d: Insights; vs: string }) {
  const f = d.flow, conv = pctOf(f.cur.contracts, f.cur.quotes), convP = pctOf(f.prev.contracts, f.prev.quotes);
  return (
    <div className="space-y-6">
      <KpiGrid items={[
        { key: "conv", label: "ใบเสนอราคา → สัญญา", value: conv === null ? "-" : `${conv}%`, delta: deltaOf(conv, convP, true, "%"), note: `ใบเสนอราคา ${f.cur.quotes} · สัญญาใหม่ ${f.cur.contracts}` },
        { key: "in", label: "รับเข้าใหม่", value: `${f.cur.admits} คน`, delta: deltaOf(f.cur.admits, f.prev.admits, true, " คน") },
        { key: "out", label: "จำหน่ายกลับบ้าน", value: `${f.cur.discharges} คน`, delta: deltaOf(f.cur.discharges, f.prev.discharges, false, " คน") },
        { key: "los", label: "ระยะเวลาพักเฉลี่ย", value: f.cur.los === null ? "-" : `${f.cur.los} เดือน`, note: "ของผู้ที่จำหน่ายในช่วงนี้" },
      ]} vs={vs} />
      <Section title="รับเข้าและจำหน่าย 6 เดือน" sub="นับจากวันเริ่มสัญญา และวันสิ้นสุดของสัญญาที่จำหน่ายแล้ว">
        <MiniChart aria="รับเข้าและจำหน่ายรายเดือน" labels={f.monthly.map((m) => monTh(m.month))} series={[{ name: "รับเข้า", color: GOLD, data: f.monthly.map((m) => m.admits) }, { name: "จำหน่าย", color: BLUE, data: f.monthly.map((m) => m.discharges) }]} />
      </Section>
    </div>
  );
}

/* ---------- กราฟอัตราเข้าพัก 12 เดือน (แท็บการเข้าพัก) ---------- */
export function OccupancyTrend({ d, t }: { d: Insights; t: Targets }) {
  const o = d.occupancy, cap = o.capacity;
  return (
    <Section title="อัตราเข้าพัก 12 เดือน" sub={`เทียบเตียงที่เปิดใช้ ${cap} เตียง · เส้นประ = เป้า`}>
      {cap ? <MiniChart type="line" aria="อัตราเข้าพัก 12 เดือน" max={100} target={t.occupancy} fmt={(v) => `${Math.round(v)}%`} labels={o.monthly.map((m) => monTh(m.month))}
        series={[{ name: "อัตราเข้าพัก", color: GOLD, data: o.monthly.map((m) => Math.min(100, Math.round((m.people / cap) * 100))) }]} />
        : <p className="rounded-xl bg-cream-50 px-4 py-6 text-center text-sm text-gold-600">ยังไม่มีห้องที่เปิดใช้งาน</p>}
    </Section>
  );
}

/* ---------- แนวโน้มงาน (แท็บคุณภาพการดูแล) ---------- */
export function CareTrend({ d, t }: { d: Insights; t: Targets }) {
  return (
    <Section title="% งานสำเร็จ รายสัปดาห์" sub="งานที่ส่งแล้ว ÷ งานที่สั่ง · เส้นประ = เป้า">
      <MiniChart type="line" aria="งานสำเร็จรายสัปดาห์" max={100} target={t.tasks} fmt={(v) => `${Math.round(v)}%`} labels={d.care.weekly.map((w) => dayTh(w.from))}
        series={[{ name: "งานสำเร็จ", color: GOLD, data: d.care.weekly.map((w) => (w.total ? Math.round((w.done / w.total) * 100) : null)) }]} />
    </Section>
  );
}

/* ---------- รายงานผู้บริหาร (พิมพ์ A4) ---------- */
export function ExecReportBody({ title, period, kpis, attn, d, head, vs }: { title: string; period: string; kpis: Kpi[]; attn: TodoItem[]; d: Insights; head: ReactNode; vs: string }) {
  return (
    <>
      {head}
      <h2 className="doc-title">{title}</h2>
      <p className="text-center text-sm">{period}</p>
      <h4 className="doc-h">ตัวชี้วัดหลัก (เทียบกับ{vs})</h4>
      <div className="doc-tbl"><table><thead><tr><th>ตัวชี้วัด</th><th className="n">ช่วงนี้</th><th>เทียบกับ{vs}</th><th>เป้าหมาย</th></tr></thead>
        <tbody>{kpis.map((k) => <tr key={k.key}><td>{k.label}</td><td className="n"><b>{k.value}</b></td><td>{k.delta ? deltaText(k.delta, vs) : k.note ?? "-"}</td><td>{k.target?.text ?? "-"}</td></tr>)}</tbody></table></div>
      <h4 className="doc-h">เรื่องที่ต้องจัดการ ณ วันที่พิมพ์</h4>
      <div className="doc-tbl"><table><tbody>{attn.map((x) => <tr key={x.key}><td>{x.title}</td><td className="n"><b>{x.n}</b> {x.unit}</td><td>{x.detail}</td></tr>)}</tbody></table></div>
      {d.health.repeat.length > 0 && <><h4 className="doc-h">ผู้รับบริการที่ค่าผิดปกติซ้ำ (7 วัน)</h4>
        <div className="doc-tbl"><table><tbody>{d.health.repeat.map((x) => <tr key={x.name}><td>{x.name}</td><td>ผิดปกติ {x.critical} · เฝ้าระวัง {x.n - x.critical}</td></tr>)}</tbody></table></div></>}
      <h4 className="doc-h">รับเข้า-จำหน่าย</h4>
      <p>ใบเสนอราคา {d.flow.cur.quotes} ใบ · สัญญาใหม่ {d.flow.cur.contracts} · รับเข้า {d.flow.cur.admits} คน · จำหน่าย {d.flow.cur.discharges} คน{d.flow.cur.los !== null ? ` · พักเฉลี่ย ${d.flow.cur.los} เดือน` : ""}</p>
    </>
  );
}
export const finKpis = (f: FinSummary | null, t: Targets, onClick?: () => void): Kpi[] => !f ? [] : [
  { key: "paid", label: `รับชำระ ${monTh(f.month)}`, value: `${money(f.paid)} บาท`, delta: f.paidPrev ? { text: f.paid === f.paidPrev ? "" : `${f.paid > f.paidPrev ? "▲ เพิ่มขึ้น" : "▼ ลดลง"} ${Math.abs(Math.round(((f.paid - f.paidPrev) / f.paidPrev) * 100))}%`, good: f.paid === f.paidPrev ? null : f.paid > f.paidPrev, vs: ` ${f.prevLabel}` } : { text: null, good: null, vs: ` ${f.prevLabel}` }, onClick },
  { key: "collect", label: `อัตราเก็บเงินได้ ${monTh(f.month)}`, value: f.collect === null ? "-" : `${f.collect}%`, delta: deltaOf(f.collect, f.collectPrev, true, "%", ` ${f.prevLabel}`), target: targetOf(f.collect, t.collect, true, "%"), onClick },
  { key: "owe", label: "ค้างชำระ ณ ตอนนี้", value: `${money(f.owe)} บาท`, note: `${f.openN} ใบ`, onClick },
];
