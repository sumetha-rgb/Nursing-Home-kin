"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "@/components/Icon";
import { DataTable, MetricGrid, Modal, PageHeader, Section, Select, Tabs } from "@/components/ui";
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
  const columns = global
    ? ["วันเวลา", "ผู้ทำรายการ", "สาขาของข้อมูล", "ส่วนของระบบ", "การกระทำ", "รายการ"]
    : ["วันเวลา", "ผู้ทำรายการ", "ส่วนของระบบ", "การกระทำ", "รายการ"];
  const rows = items.map((l) => {
    const who = `${l.actor_name ?? "-"}${l.actor_role ? ` (${roleTh(l.actor_role)})` : ""}`;
    const base = [when(l.at), who];
    const rest = [areaLabel(l.area), ACTION_LABEL[l.action] ?? l.action, l.summary ?? "-"];
    return global ? [...base, l.branch_name ?? "ส่วนกลาง", ...rest] : [...base, ...rest];
  });

  return (
    <>
      <PageHeader
        title="ประวัติการแก้ไข"
        sub={global
          ? "ทุกการเพิ่ม แก้ไข ลบข้อมูล การจัดการบัญชี และการเข้าสู่ระบบ ของทุกสาขา"
          : `ทุกการเพิ่ม แก้ไข ลบข้อมูล และการเข้าสู่ระบบ เฉพาะสาขา${data?.scope.branch ?? ""}`}
        actions={<button className="btn-soft" onClick={() => load()} disabled={busy}><Icon name="refresh" className="h-4 w-4" /> รีเฟรช</button>}
      />

      {!global && data && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-cream-300 bg-white px-4 py-3 text-sm text-gold-700">
          <Icon name="lock" className="mt-0.5 h-4 w-4 shrink-0" />
          <span>คุณเห็นเฉพาะประวัติของสาขา <b>{data.scope.branch}</b> ส่วนประวัติของสาขาอื่นและข้อมูลส่วนกลางดูได้เฉพาะผู้บริหารองค์กร</span>
        </div>
      )}

      {s && <MetricGrid items={global ? [
        { label: "รายการวันนี้ (ทุกสาขา)", value: s.total, unit: "รายการ", icon: "table", accent: true },
        { label: "การแก้ไขข้อมูล", value: s.changes, unit: "ครั้ง", icon: "doc", note: `ลบ ${s.deletes} ครั้ง` },
        { label: "เข้าสู่ระบบ", value: s.logins, unit: "ครั้ง", icon: "user" },
        { label: "เข้าสู่ระบบไม่สำเร็จ", value: s.failed, unit: "ครั้ง", icon: "alert", note: s.failed >= 5 ? "ควรตรวจสอบ" : "ปกติ" },
      ] : [
        { label: "รายการวันนี้ของสาขา", value: s.total, unit: "รายการ", icon: "table", accent: true },
        { label: "การแก้ไขข้อมูล", value: s.changes, unit: "ครั้ง", icon: "doc" },
        { label: "การลบข้อมูล", value: s.deletes, unit: "ครั้ง", icon: "alert" },
        { label: "เข้าสู่ระบบ", value: s.logins, unit: "ครั้ง", icon: "user", note: s.failed ? `ไม่สำเร็จ ${s.failed} ครั้ง` : undefined },
      ]} />}

      <Section
        title="รายการล่าสุด"
        sub="กดดูเพื่อเปิดค่าก่อนและหลังแก้ไข"
        actions={<Tabs tabs={[ALL, ...Object.keys(ACTION_GROUPS)]} value={group} onChange={setGroup} />}
      >
        <div className={`mb-4 grid gap-3 ${global ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-3"}`}>
          <div className="table-search max-w-none"><Icon name="search" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อผู้ทำรายการ หรือรายการ" aria-label="ค้นหาประวัติ" /></div>
          <select value={area} onChange={(e) => setArea(e.target.value)} aria-label="ส่วนของระบบ">{AREAS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          {global && <Select aria-label="สาขา" placeholder="ทุกสาขา" options={data?.branches ?? []} value={branch} onChange={setBranch} />}
          <div className="flex gap-2">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="วันที่" />
            {date ? <button className="btn-soft shrink-0" onClick={() => setDate("")}>ทุกวัน</button> : <button className="btn-soft shrink-0" onClick={() => setDate(today())}>วันนี้</button>}
          </div>
        </div>
        {error && <p role="alert" className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <DataTable search={false} columns={columns} rows={rows} badgeCols={[global ? 4 : 3]} empty={busy ? "กำลังโหลด…" : "ยังไม่มีประวัติตามเงื่อนไขนี้"} actions={[{ label: "ดู", onClick: (i) => setOpen(items[i]) }]} />
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
