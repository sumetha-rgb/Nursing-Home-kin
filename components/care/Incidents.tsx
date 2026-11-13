"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Field, Modal, Section } from "../ui";
import Icon from "../Icon";
import PhotoPicker from "../PhotoPicker";
import { useApp } from "@/lib/app";
import { Incident, INCIDENT_KINDS, INCIDENT_LEVELS, shortAt } from "@/lib/safety";

type Res = { id: string; name: string; room?: string | null };
const nowLocal = () => new Date(Date.now() + 7 * 36e5).toISOString().slice(0, 16);
const post = async (body: object) => {
  const r = await fetch("/api/safety", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "บันทึกไม่สำเร็จ");
  return d;
};

/**
 * รายงานเหตุการณ์ไม่พึงประสงค์ (KinApp / ระบบจัดการ): ผู้รับบริการ · ประเภท · ความรุนแรง · เวลา · เล่าเหตุการณ์ · รูป
 *  ส่งแล้วหัวหน้าพยาบาลและผู้จัดการสาขาได้แจ้งเตือนทันที
 */
export function IncidentReport({ open, residents, onClose, onDone, compact }: { open: boolean; residents: Res[]; onClose: () => void; onDone?: () => void; compact?: boolean }) {
  const { toast } = useApp();
  const blank = () => ({ who: "", kind: "", level: "", at: nowLocal(), detail: "", photo: "" });
  const [f, setF] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { if (open) { setF(blank()); setErr(""); } }, [open]);
  const send = async () => {
    const miss = [!f.who && "ผู้รับบริการ", !f.kind && "ประเภท", !f.level && "ความรุนแรง", !f.detail.trim() && "สิ่งที่เกิดขึ้น"].filter(Boolean);
    if (miss.length) return setErr(`ยังขาด: ${miss.join(" · ")}`);
    setBusy(true);
    try {
      const d = await post({ op: "incident_report", residentId: f.who, kind: f.kind, severity: f.level, detail: f.detail, photo: f.photo || undefined, occurredAt: f.at });
      toast(`ส่งรายงานแล้ว · ${f.kind}${d.notified ? ` · แจ้งหัวหน้า ${d.notified} คน` : ""}`);
      onDone?.(); onClose();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const Seg = ({ list, v, set, label }: { list: readonly string[]; v: string; set: (x: string) => void; label: string }) => (
    <div className="inc-seg" role="radiogroup" aria-label={label}>{list.map((x) => <button key={x} type="button" role="radio" aria-checked={v === x} className={v === x ? "is-on" : ""} onClick={() => set(x)}>{x}</button>)}</div>
  );
  return (
    <Modal open={open} title="รายงานเหตุการณ์ไม่พึงประสงค์" onClose={onClose}
      footer={<><button className={compact ? "btn-soft w-full" : "btn-soft"} onClick={onClose}>ยกเลิก</button><button className={compact ? "btn-primary w-full" : "btn-primary"} disabled={busy} onClick={send}>{busy ? "กำลังส่ง…" : "ส่งรายงาน · แจ้งหัวหน้าพยาบาล"}</button></>}>
      <div className="space-y-4">
        <Field label="ผู้รับบริการ" required><select value={f.who} onChange={(e) => setF({ ...f, who: e.target.value })}><option value="">-- เลือกผู้รับบริการ --</option>
          {residents.map((r) => <option key={r.id} value={r.id}>{r.name}{r.room && r.room !== "-" ? ` · ห้อง ${r.room}` : ""}</option>)}</select></Field>
        <Field label="ประเภท" required><Seg list={INCIDENT_KINDS} v={f.kind} set={(kind) => setF({ ...f, kind })} label="ประเภทเหตุการณ์" /></Field>
        <Field label="ความรุนแรง" required><Seg list={INCIDENT_LEVELS} v={f.level} set={(level) => setF({ ...f, level })} label="ความรุนแรง" /></Field>
        <Field label="เวลาที่เกิด"><input type="datetime-local" value={f.at} max={nowLocal()} onChange={(e) => setF({ ...f, at: e.target.value })} /></Field>
        <Field label="สิ่งที่เกิดขึ้น และสิ่งที่ทำไปแล้ว" required><textarea rows={3} value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} placeholder="เช่น ลื่นในห้องน้ำ มีรอยถลอกที่เข่าซ้าย ทำแผลแล้ว วัดสัญญาณชีพปกติ" /></Field>
        <PhotoPicker value={f.photo} onChange={(photo) => setF({ ...f, photo })} label="แนบรูป (ถ้ามี)" hint="เช่น บาดแผล จุดที่เกิดเหตุ" />
        {err && <p role="alert" className="form-error"><Icon name="alert" className="h-4 w-4 shrink-0" />{err}</p>}
      </div>
    </Modal>
  );
}

/** โหลดรายการเหตุการณ์ (ใช้ทั้งกระดานและสรุปรายเดือน) */
export function useIncidents(days = 180, branch = "") {
  const [items, setItems] = useState<Incident[] | null>(null);
  const [canAck, setCanAck] = useState(false);
  const load = useCallback(() => {
    fetch(`/api/safety?op=incidents&days=${days}${branch ? `&branch=${encodeURIComponent(branch)}` : ""}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { items: [] })).then((d) => { setItems(d.items ?? []); setCanAck(!!d.canAck); }).catch(() => setItems([]));
  }, [days, branch]);
  useEffect(load, [load]);
  return { items, canAck, load };
}

/**
 * กระดานเหตุการณ์ (ระบบจัดการ · บันทึกสุขภาพ): รอรับทราบอยู่บนสุด · หัวหน้าพยาบาล/ผู้จัดการกดรับทราบพร้อมบันทึกการแก้ไข · บันทึกว่าแจ้งญาติแล้ว
 */
export function IncidentBoard({ residents }: { residents: Res[] }) {
  const { toast } = useApp();
  const { items, canAck, load } = useIncidents(60);
  const [report, setReport] = useState(false);
  const [ack, setAck] = useState<{ x: Incident; action: string; family: boolean } | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const list = useMemo(() => (items ?? []).slice().sort((a, b) => Number(!!a.ack_by) - Number(!!b.ack_by)), [items]);
  const waiting = list.filter((x) => !x.ack_by).length;
  const shown = showAll ? list : list.filter((x, i) => !x.ack_by || i < 5);
  const saveAck = async () => {
    if (!ack) return;
    if (!ack.action.trim()) return toast("กรุณาบันทึกการแก้ไข / ป้องกัน");
    try {
      await post({ op: "incident_ack", id: ack.x.id, action: ack.action });
      if (ack.family && !ack.x.family_at) await post({ op: "incident_family", id: ack.x.id });
      toast(`รับทราบแล้ว · ${ack.x.kind} · ${ack.x.resident_name}`); setAck(null); load();
    } catch (e) { toast((e as Error).message); }
  };
  const family = async (x: Incident) => { try { await post({ op: "incident_family", id: x.id }); toast(`บันทึกว่าแจ้งญาติแล้ว · ${x.resident_name}`); load(); } catch (e) { toast((e as Error).message); } };
  const openPhoto = (x: Incident) => fetch(`/api/safety?op=incident_photo&id=${x.id}`).then((r) => r.json()).then((d) => setPhoto(d.photo ?? null)).catch(() => {});
  return (
    <Section title="เหตุการณ์ไม่พึงประสงค์" sub={items ? `60 วันล่าสุด ${list.length} เรื่อง${waiting ? ` · รอรับทราบ ${waiting}` : " · รับทราบครบแล้ว"}` : "กำลังโหลด…"}
      actions={<button className="btn-soft" onClick={() => setReport(true)}><Icon name="alert" className="h-4 w-4" /> รายงานเหตุการณ์</button>}>
      {items && !list.length && <p className="rounded-xl bg-cream-50 px-4 py-6 text-center text-sm text-gold-600">ไม่มีเหตุการณ์ใน 60 วันล่าสุด</p>}
      <ul className="inc-list">{shown.map((x) => (
        <li key={x.id} className={x.ack_by ? "" : "is-wait"}>
          <div className="inc-top"><b>{x.kind} · {x.severity}</b>
            {x.ack_by ? <span className="inc-chip is-ok">รับทราบแล้ว · {x.ack_by}</span> : <span className="inc-chip is-late">รอรับทราบ {x.age_min < 60 ? `${x.age_min} นาที` : x.age_min < 1440 ? `${Math.floor(x.age_min / 60)} ชม.` : `${Math.floor(x.age_min / 1440)} วัน`}</span>}</div>
          <span className="inc-meta">{x.resident_name}{x.branch ? ` · ${x.branch}` : ""} · เกิด {shortAt(x.occurred)} · รายงานโดย {x.reported_by ?? "-"}</span>
          <p className="inc-detail">{x.detail}</p>
          {x.action && <p className="inc-action"><b>การแก้ไข / ป้องกัน:</b> {x.action}</p>}
          <div className="inc-row">
            {x.family_at ? <span className="inc-chip is-ok">✓ แจ้งญาติแล้ว {shortAt(x.family_at)}{x.family_by ? ` · ${x.family_by}` : ""}</span> : <button type="button" className="row-action" onClick={() => family(x)}>แจ้งญาติแล้ว</button>}
            {x.has_photo && <button type="button" className="row-action" onClick={() => openPhoto(x)}>ดูรูป</button>}
            {!x.ack_by && canAck && <button type="button" className="btn-primary !min-h-0 !py-1.5 !text-sm" onClick={() => setAck({ x, action: "", family: !!x.family_at })}>รับทราบ</button>}
          </div>
        </li>
      ))}</ul>
      {list.length > shown.length && <button type="button" className="row-action mt-3" onClick={() => setShowAll(true)}>ดูทั้งหมด {list.length} เรื่อง</button>}
      <IncidentReport open={report} residents={residents} onClose={() => setReport(false)} onDone={load} />
      <Modal open={!!ack} title={ack ? `รับทราบ · ${ack.x.kind} · ${ack.x.resident_name}` : ""} onClose={() => setAck(null)}
        footer={<><button className="btn-soft" onClick={() => setAck(null)}>ยกเลิก</button><button className="btn-primary" onClick={saveAck}>รับทราบ</button></>}>
        {ack && <div className="space-y-4">
          <p className="rounded-xl bg-cream-50 px-4 py-3 text-sm text-gold-700">{ack.x.detail}</p>
          <Field label="การแก้ไข / ป้องกัน" required><textarea rows={3} value={ack.action} onChange={(e) => setAck({ ...ack, action: e.target.value })} placeholder="เช่น ติดแผ่นกันลื่น เพิ่มการพาเข้าห้องน้ำทุก 2 ชม." /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={ack.family} disabled={!!ack.x.family_at} onChange={(e) => setAck({ ...ack, family: e.target.checked })} /> แจ้งญาติแล้ว</label>
        </div>}
      </Modal>
      <Modal open={!!photo} title="รูปเหตุการณ์" onClose={() => setPhoto(null)} footer={<button className="btn-primary" onClick={() => setPhoto(null)}>ปิด</button>}>
        {photo && <img src={photo} alt="รูปเหตุการณ์" className="mx-auto max-h-[70vh] rounded-xl" />}
      </Modal>
    </Section>
  );
}

/** ภาพรวมเหตุการณ์รายเดือน (ภาพรวมและรายงาน › คุณภาพการดูแล): จำนวนตามประเภท และตามสาขา · รับทราบครบกี่เรื่อง */
export function IncidentStats({ branch, showBranch }: { branch: string; showBranch: boolean }) {
  const { items } = useIncidents(400, branch);
  const [mon, setMon] = useState(() => new Date(Date.now() + 7 * 36e5).toISOString().slice(0, 7));
  if (!items) return <Section title="เหตุการณ์ไม่พึงประสงค์รายเดือน"><p className="text-sm text-gold-600">กำลังโหลด…</p></Section>;
  const months = [...new Set([mon, ...items.map((x) => x.reported.slice(0, 7))])].sort().reverse().slice(0, 12);
  const inMon = items.filter((x) => x.reported.startsWith(mon));
  const by = (k: (x: Incident) => string) => Object.entries(inMon.reduce<Record<string, number>>((m, x) => { const v = k(x) || "-"; m[v] = (m[v] ?? 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]);
  const kinds = by((x) => x.kind), branches = by((x) => x.branch ?? ""), max = Math.max(1, ...kinds.map((x) => x[1]));
  const [y, m] = mon.split("-").map(Number);
  const prevMon = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`, prevN = items.filter((x) => x.reported.startsWith(prevMon)).length;
  const label = (k: string) => new Date(`${k}-01T00:00:00`).toLocaleDateString("th-TH", { month: "short", year: "numeric" });
  return (
    <Section title="เหตุการณ์ไม่พึงประสงค์รายเดือน" sub={`${label(mon)} · ${inMon.length} เรื่อง (เดือนก่อน ${prevN}) · รับทราบครบ ${inMon.filter((x) => x.ack_by).length} · แจ้งญาติ ${inMon.filter((x) => x.family_at).length}`}
      actions={<select className="!w-auto" value={mon} onChange={(e) => setMon(e.target.value)} aria-label="เลือกเดือน">{months.map((k) => <option key={k} value={k}>{label(k)}</option>)}</select>}>
      {!inMon.length ? <p className="rounded-xl bg-cream-50 px-4 py-6 text-center text-sm text-gold-600">ไม่มีเหตุการณ์ในเดือนนี้</p> : (
        <div className="inc-stats">
          <div><p className="label">แยกตามประเภท</p>
            <ul className="inc-bars">{kinds.map(([k, n]) => <li key={k}><span>{k}</span><i style={{ width: `${(n / max) * 100}%` }} /><b>{n}</b></li>)}</ul></div>
          {showBranch && <div><p className="label">แยกตามสาขา</p>
            <ul className="inc-bars">{branches.map(([k, n]) => <li key={k}><span>{k}</span><i style={{ width: `${(n / Math.max(1, branches[0][1])) * 100}%` }} /><b>{n}</b></li>)}</ul></div>}
        </div>
      )}
    </Section>
  );
}
