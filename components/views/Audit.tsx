"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { Modal, PageHeader, Section, Select, StatFilter } from "@/components/ui";
import { ACTION_GROUPS, ACTION_LABEL, AREA_LABEL, areaLabel, displayValue, FIELD_LABEL, normValue } from "@/lib/auditLabels";
import { ROLE_INFO, Role } from "@/lib/roles";

type Log = {
  id: string; at: string; actor_name: string | null; actor_role: string | null; actor_branch: string | null; branch_name: string | null;
  area: string; action: string; record_id: string | null; summary: string | null;
  before: Record<string, unknown> | null; after: Record<string, unknown> | null; ip: string | null;
};
type Resp = {
  items: Log[]; more: boolean; branches: string[];
  stats: { total: number; changes: number; deletes: number; logins: number; failed: number };
  scope: { role: Role; branch: string | null };
};

const ALL = "ทั้งหมด";
const AREAS = [["", "ทุกส่วนของระบบ"], ["daily", "งานประจำวัน"], ...Object.entries(AREA_LABEL)];
const roleTh = (r: string | null) => (r && r in ROLE_INFO ? ROLE_INFO[r as Role].th : r ?? "-");
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** แสดงวันเวลาตามเวลาไทย ปี พ.ศ. */
function when(at: string) {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return d.toLocaleString("th-TH", { timeZone: "Asia/Bangkok", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** ช่องที่เปลี่ยน (แก้ไข) หรือทุกช่องที่มีค่า (เพิ่ม/ลบ) */
function fieldRows(l: Log) {
  const keys = [...new Set([...Object.keys(l.before ?? {}), ...Object.keys(l.after ?? {})])];
  return keys
    .map((k) => ({ k, b: l.before?.[k], a: l.after?.[k] }))
    .filter(({ b, a }) => (l.before && l.after ? normValue(b) !== normValue(a) : normValue(l.after ? a : b) !== ""));
}

/** สรุปการแก้ไขในแถว: "ช่อง ก่อน → หลัง" สูงสุด 2 ช่อง (ดูครบในรายละเอียด) · เพิ่ม/ลบ ไม่สรุป */
function changes(l: Log) {
  if (!l.before || !l.after) return "-";
  // ช่องที่ไม่ได้ส่งมาตอนแก้ (เช่น เลขที่เอกสารที่ระบบออกให้) ไม่ใช่การเปลี่ยนค่า
  const f = fieldRows(l).filter(({ k }) => l.after && k in l.after);
  if (!f.length) return "-";
  const cut = (v: unknown) => { const s = String(displayValue(v)); return s.length > 24 ? `${s.slice(0, 24)}…` : s; };
  return f.slice(0, 2).map(({ k, b, a }) => `${FIELD_LABEL[k] ?? k}: ${cut(b)} → ${cut(a)}`).join(" · ") + (f.length > 2 ? ` · และอีก ${f.length - 2} ช่อง` : "");
}

export function AuditLog() {
  const [group, setGroup] = useState(ALL);
  const [area, setArea] = useState("");
  const [branch, setBranch] = useState("");
  const [date, setDate] = useState("");
  const [q, setQ] = useState("");
  const [data, setData] = useState<Resp | null>(null);
  const [items, setItems] = useState<Log[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Log | null>(null);

  const load = useCallback(async (before?: string) => {
    setBusy(true); setError("");
    const p = new URLSearchParams();
    if (group !== ALL) p.set("group", group);
    if (area) p.set("area", area);
    if (branch) p.set("branch", branch);
    if (date) p.set("date", date);
    if (q.trim()) p.set("q", q.trim());
    if (before) p.set("before", before);
    try {
      const r = await fetch(`/api/audit?${p}`, { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "โหลดประวัติไม่สำเร็จ");
      setData(d);
      setItems((prev) => (before ? [...prev, ...d.items] : d.items));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }, [group, area, branch, date, q]);

  useEffect(() => { const t = setTimeout(() => load(), q ? 300 : 0); return () => clearTimeout(t); }, [load, q]);

  const global = data?.scope.role === "Global Admin";
  const s = data?.stats;
  // เส้นเวลาแบ่งตามวัน (เวลาไทย) · ลบ / เข้าสู่ระบบไม่สำเร็จ = แถบแดง (เรื่องที่ต้องตรวจ)
  const dayOf = (at: string) => new Date(at).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
  const timeOf = (at: string) => new Date(at).toLocaleTimeString("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" });
  const dayLabel = (d: string) => {
    const t = today(), y = new Date(Date.now() - 864e5).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
    if (d === t) return "วันนี้";
    if (d === y) return "เมื่อวาน";
    return new Date(`${d}T12:00:00`).toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short", year: "2-digit" });
  };
  const ALERT = ["login_failed", "delete", "clear"];
  const toneOf = (a: string) => (ALERT.includes(a) ? "status-danger" : a === "create" || a === "register" || a === "approve" ? "status-success" : ["update", "replace", "permissions", "reset_password", "view_idcard", "export"].includes(a) ? "status-warning" : "status-neutral");
  const days = [...new Set(items.map((l) => dayOf(l.at)))];

  return (
    <>
      <PageHeader
        title="บันทึกการใช้งานระบบ"
        sub={global ? "ใครทำอะไร เมื่อไร · ทุกสาขา" : `ใครทำอะไร เมื่อไร · สาขา${data?.scope.branch ?? ""}`}
        actions={<button className="btn-soft" onClick={() => load()} disabled={busy}><Icon name="refresh" className="h-4 w-4" /> รีเฟรช</button>}
      />

      <Section>
        <StatFilter label="กรองรายการ" value={group} onChange={setGroup} items={[
          { k: ALL, t: ALL, tone: "all" },
          { k: "ต้องตรวจ", t: "ต้องตรวจ", tone: "bad" },
          ...Object.keys(ACTION_GROUPS).filter((g) => g !== "ต้องตรวจ").map((g) => ({ k: g, t: g, tone: "muted" as const })),
        ]} summary={s ? <>วันนี้ <b>{s.total}</b> รายการ{s.failed ? <> · เข้าระบบไม่สำเร็จ <b className="!text-red-700">{s.failed}</b></> : null}{s.deletes ? <> · ลบ <b className="!text-red-700">{s.deletes}</b></> : null}</> : undefined} />
        <div className="al-filters">
          <div className="table-search max-w-none"><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อ หรือรายการ" aria-label="ค้นหาชื่อผู้ทำรายการ หรือรายการ" /></div>
          <select value={area} onChange={(e) => setArea(e.target.value)} aria-label="ส่วนของระบบ">{AREAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          {global && <div><Select aria-label="สาขา" placeholder="ทุกสาขา" options={data?.branches ?? []} value={branch} onChange={setBranch} /></div>}
          <div className="al-date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="วันที่" />
            {date && <button className="btn-soft shrink-0" onClick={() => setDate("")}>ทุกวัน</button>}
          </div>
        </div>
        {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        {!items.length ? <p className="empty-state">{busy ? "กำลังโหลด…" : "ยังไม่มีประวัติตามเงื่อนไขนี้"}</p>
          : <div className="space-y-4">{days.map((d) => (
            <div key={d}>
              <p className="al-day">{dayLabel(d)}</p>
              <ul className="al-list">
                {items.filter((l) => dayOf(l.at) === d).map((l) => {
                  const ch = changes(l);
                  return (
                    <li key={l.id} className={ALERT.includes(l.action) ? "is-alert" : ""}>
                      <button type="button" onClick={() => setOpen(l)} aria-label={`ดูรายละเอียด ${ACTION_LABEL[l.action] ?? l.action} ${l.summary ?? ""}`}>
                        <time>{timeOf(l.at)}</time>
                        <span className="al-what">
                          <span className="al-top"><span className={`status-badge ${toneOf(l.action)}`}>{ACTION_LABEL[l.action] ?? l.action}</span><b>{l.actor_name ?? "-"}</b><small>{roleTh(l.actor_role)}{global && l.branch_name ? ` · ${l.branch_name}` : ""}</small></span>
                          <small>{areaLabel(l.area)}{l.summary ? ` · ${l.summary}` : ""}{ch !== "-" ? ` · ${ch}` : ""}</small>
                        </span>
                        <Icon name="chevron" className="al-go h-4 w-4 -rotate-90" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}</div>}
        {data?.more && <div className="mt-4 text-center"><button className="btn-soft" disabled={busy} onClick={() => load(items[items.length - 1]?.id)}>{busy ? "กำลังโหลด…" : "โหลดรายการก่อนหน้า"}</button></div>}
      </Section>

      <Modal open={!!open} wide title={open ? `${ACTION_LABEL[open.action] ?? open.action} · ${areaLabel(open.area)}` : ""} onClose={() => setOpen(null)} footer={<button className="btn-primary" onClick={() => setOpen(null)}>ปิด</button>}>
        {open && <div className="space-y-5">
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            {[
              ["วันเวลา", when(open.at)],
              ["ผู้ทำรายการ", `${open.actor_name ?? "-"} · ${roleTh(open.actor_role)}${open.actor_branch ? ` · ${open.actor_branch}` : ""}`],
              ["รายการ", open.summary ?? "-"],
              ["สาขาของข้อมูล", open.branch_name ?? "ส่วนกลาง"],
              ...(global ? [["IP", open.ip ?? "-"], ["รหัสรายการ", open.record_id ?? "-"]] : []),
            ].map(([k, v]) => <div key={k}><dt className="text-xs text-gold-500">{k}</dt><dd className="mt-0.5 break-words font-medium text-gold-800">{v}</dd></div>)}
          </dl>
          {(() => {
            const f = fieldRows(open);
            if (!f.length) return <p className="rounded-xl bg-cream-50 px-4 py-3 text-sm text-gold-600">ไม่มีรายละเอียดข้อมูลสำหรับรายการนี้</p>;
            const both = !!(open.before && open.after);
            return <div className="table-scroll"><table className="data-table w-full">
              <thead><tr><th>ช่องข้อมูล</th>{open.before && <th>{both ? "ก่อนแก้ไข" : "ค่าที่ถูกลบ"}</th>}{open.after && <th>{both ? "หลังแก้ไข" : "ค่าที่บันทึก"}</th>}</tr></thead>
              <tbody>{f.map(({ k, b, a }) => <tr key={k}>
                <td>{FIELD_LABEL[k] ?? k}</td>
                {open.before && <td className={both ? "text-red-700 line-through decoration-red-300" : ""}>{displayValue(b)}</td>}
                {open.after && <td className={both ? "font-medium text-emerald-800" : ""}>{displayValue(a)}</td>}
              </tr>)}</tbody>
            </table></div>;
          })()}
        </div>}
      </Modal>
    </>
  );
}
