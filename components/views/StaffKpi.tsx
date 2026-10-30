"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "../Icon";
import { useApp } from "@/lib/app";
import { useBranchNames } from "@/lib/branches";
import { downloadCsv } from "@/lib/store";
import { KPI_PARTS, KpiKey, KpiResp, KpiRow, pointsOf, Weights } from "@/lib/kpi";
import { monthTitle, shiftMonth, ymOf } from "@/lib/roster";
import { DataTable, Field, Modal, PageHeader, Section, Select } from "../ui";

const fmt = (n: number | null | undefined) => (n == null ? "-" : n.toFixed(n % 1 ? 1 : 0));
const scoresOf = (r: KpiRow) => ({ family: r.family?.score ?? null, manager: r.manager?.score ?? null, tasks: r.tasks?.score ?? null, punctual: r.punctual?.score ?? null });
/** รายละเอียดดิบของแต่ละส่วน เช่น 4.5 ดาว (2 รีวิว) */
function rawOf(r: KpiRow, k: KpiKey) {
  if (k === "family") return r.family?.n ? `${r.family.avg} ดาว (${r.family.n} รีวิว)` : "ยังไม่มีรีวิว";
  if (k === "manager") return r.manager?.n ? `${r.manager.avg} ดาว (${r.manager.n} งาน)` : "ยังไม่มีงานที่ตรวจ";
  if (k === "tasks") return `${r.tasks?.n ?? 0} งาน`;
  const p = r.punctual;
  return p?.scheduled ? `ตรงเวลา ${p.ontime}/${p.scheduled} เวร${p.late ? ` · สาย ${p.late}` : ""}${p.missed ? ` · ไม่เช็คชื่อ ${p.missed}` : ""}` : "ไม่มีเวรในตาราง";
}
const cell = (r: KpiRow, k: KpiKey) => { const s = scoresOf(r)[k]; return s == null ? "-" : `${fmt(s)} · ${rawOf(r, k)}`; };

/** KPI พนักงานรายเดือน: 4 ส่วน คะแนนแยกรายการ รวมตามน้ำหนัก */
export function StaffKpi() {
  const { toast } = useApp();
  const branches = useBranchNames();
  const [month, setMonth] = useState(ymOf(new Date()));
  const [branch, setBranch] = useState("");
  const [data, setData] = useState<KpiResp | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<KpiRow | null>(null);
  const [edit, setEdit] = useState<Weights | null>(null);
  const [werr, setWerr] = useState("");

  const load = useCallback(() => {
    fetch(`/api/kpi?month=${month}${branch ? `&branch=${encodeURIComponent(branch)}` : ""}`, { cache: "no-store" })
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); setData(d); setError(""); })
      .catch((e) => setError((e as Error).message || "โหลด KPI ไม่สำเร็จ"));
  }, [month, branch]);
  useEffect(load, [load]);

  const w = data?.weights;
  const rows = data?.rows ?? [];
  const ranked = rows.filter((r) => r.total != null);
  const avg = ranked.length ? ranked.reduce((a, r) => a + (r.total ?? 0), 0) / ranked.length : null;
  const sum = edit ? Object.values(edit).reduce((a, v) => a + (Number(v) || 0), 0) : 0;
  const saveWeights = async () => {
    if (!edit) return;
    if (sum !== 100) return setWerr(`น้ำหนักรวมตอนนี้ ${sum}% ต้องเท่ากับ 100%`);
    const r = await fetch("/api/kpi", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(edit) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setWerr(d.error || "บันทึกไม่สำเร็จ");
    setEdit(null); toast("แก้ไขน้ำหนัก KPI แล้ว · คะแนนทุกคนคำนวณใหม่ตามน้ำหนักนี้"); load();
  };
  const csv = () => downloadCsv(`KPI พนักงาน ${month}`, ["อันดับ", "พนักงาน", "สาขา", "คะแนนรวม", ...KPI_PARTS.map((p) => `${p.label} (${w?.[p.key]}%)`)],
    rows.map((r) => [r.rank ? String(r.rank) : "-", r.name, r.branch, fmt(r.total), ...KPI_PARTS.map((p) => cell(r, p.key))]));

  return (
    <>
      <PageHeader title="KPI พนักงาน" sub="คะแนนรายเดือนจากข้อมูลจริง 4 ส่วน แต่ละส่วนคิดเป็น 0–100 แล้วรวมตามน้ำหนัก · กด &quot;ดูรายละเอียด&quot; เพื่อดูว่าแต่ละส่วนได้กี่คะแนน"
        actions={<>
          {data?.canEdit && w && <button className="btn-soft" onClick={() => { setWerr(""); setEdit({ ...w }); }}><Icon name="cpu" className="h-4 w-4" /> ตั้งน้ำหนัก</button>}
          <button className="btn-soft" onClick={csv}><Icon name="download" className="h-4 w-4" /> โหลด CSV</button>
        </>} />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="roster-head !mb-0 gap-3">
          <button type="button" className="icon-button" aria-label="เดือนก่อน" onClick={() => setMonth(shiftMonth(month, -1))}><Icon name="chevron" className="h-4 w-4 rotate-90" /></button>
          <b>{monthTitle(month)}</b>
          <button type="button" className="icon-button" aria-label="เดือนถัดไป" onClick={() => setMonth(shiftMonth(month, 1))}><Icon name="chevron" className="h-4 w-4 -rotate-90" /></button>
        </div>
        {branches.length > 1 && <div className="min-w-48"><Select aria-label="เลือกสาขา" options={branches} placeholder="ทุกสาขา" value={branch} onChange={setBranch} /></div>}
      </div>

      {w && (
        <div className="kpi-weights">
          {KPI_PARTS.map((p) => (
            <div key={p.key}><b>{w[p.key]}%</b><span>{p.label}</span><small>{p.how}</small></div>
          ))}
        </div>
      )}
      {error && <p role="alert" className="form-error my-3"><Icon name="alert" className="h-4 w-4 shrink-0" />{error}</p>}

      <Section title={`อันดับ KPI · ${monthTitle(month)}`} sub={`คะแนนเฉลี่ยของทีม ${fmt(avg)} · ${ranked.length} คนมีคะแนน · ส่วนที่ยังไม่มีข้อมูลไม่นับ และเกลี่ยน้ำหนักที่เหลือให้ครบ 100`}>
        <DataTable columns={["อันดับ", "พนักงาน", "คะแนนรวม", ...KPI_PARTS.map((p) => `${p.label} ${w?.[p.key] ?? ""}%`)]} search={rows.length > 8}
          rows={rows.map((r) => [r.rank ? String(r.rank) : "-", `${r.name}${branches.length > 1 && !branch ? ` · ${r.branch}` : ""}`, fmt(r.total), ...KPI_PARTS.map((p) => cell(r, p.key))])}
          empty="ยังไม่มีพนักงานในสาขานี้"
          actions={[{ label: "ดูรายละเอียด", onClick: (i) => setOpen(rows[i]) }]} />
      </Section>

      <Modal open={!!open} wide title={open ? `KPI ของ ${open.name} · ${monthTitle(month)}` : ""} onClose={() => setOpen(null)} footer={<button className="btn-primary" onClick={() => setOpen(null)}>ปิด</button>}>
        {open && w && (() => {
          const sc = scoresOf(open);
          return (
            <>
              <div className="kpi-total">
                <div><span>คะแนนรวม</span><b>{fmt(open.total)}</b><small>/ 100</small></div>
                <div><span>อันดับในสาขา</span><b>{open.rank || "-"}</b><small>จาก {ranked.filter((r) => r.branch === open.branch).length} คน</small></div>
              </div>
              <ul className="kpi-parts">
                {KPI_PARTS.map((p) => {
                  const s = sc[p.key]; const pts = pointsOf(p.key, sc, w);
                  return (
                    <li key={p.key} className={s == null ? "is-empty" : ""}>
                      <div className="kpi-part-head"><b>{p.label}</b><span>น้ำหนัก {w[p.key]}%</span></div>
                      <div className="kpi-bar"><i style={{ width: `${s ?? 0}%` }} /></div>
                      <div className="kpi-part-foot">
                        <span>{rawOf(open, p.key)}</span>
                        <span>คะแนน <b>{fmt(s)}</b>/100 → ได้ <b>{pts == null ? "-" : fmt(pts)}</b> คะแนน</span>
                      </div>
                      <small>{p.how}</small>
                    </li>
                  );
                })}
              </ul>
              {KPI_PARTS.some((p) => sc[p.key] == null) && <p className="mt-3 text-xs text-gold-600">ส่วนที่ยังไม่มีข้อมูล (-) ไม่นับคะแนน ระบบเกลี่ยน้ำหนักของส่วนที่มีข้อมูลให้รวมเป็น 100</p>}
            </>
          );
        })()}
      </Modal>

      <Modal open={!!edit} title="ตั้งน้ำหนัก KPI พนักงาน" onClose={() => setEdit(null)}
        footer={<><button className="btn-soft" onClick={() => setEdit(null)}>ยกเลิก</button><button className="btn-primary" onClick={saveWeights}>บันทึกน้ำหนัก</button></>}>
        {edit && (
          <div className="space-y-3">
            <p className="text-sm text-gold-600">ใช้กับทุกสาขา · รวมกันต้องเท่ากับ 100% · ใส่ 0 เพื่อไม่นับส่วนนั้น</p>
            {KPI_PARTS.map((p) => (
              <Field key={p.key} label={`${p.label} (%)`}>
                <input type="number" min={0} max={100} value={edit[p.key]} onChange={(e) => { setWerr(""); setEdit({ ...edit, [p.key]: Number(e.target.value) }); }} />
                <p className="mt-1 text-xs text-gold-500">{p.how}</p>
              </Field>
            ))}
            <p className={`text-sm font-semibold ${sum === 100 ? "text-green-700" : "text-red-700"}`}>รวม {sum}%</p>
            {werr && <p role="alert" className="form-error"><Icon name="alert" className="h-4 w-4 shrink-0" />{werr}</p>}
          </div>
        )}
      </Modal>
    </>
  );
}
