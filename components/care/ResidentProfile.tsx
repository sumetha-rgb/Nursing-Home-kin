"use client";
import { useEffect, useMemo, useState } from "react";
import Icon from "@/components/Icon";
import { DataTable, Modal, StatusBadge, Tabs } from "@/components/ui";
import { fetchProfile, Profile, thDate, thWhen } from "@/lib/care";
import { evaluateVitals, LEVEL_TH, levelOf, LIMITS, parseVitals, Vitals } from "@/lib/vitals";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined || v === "" ? "-" : Array.isArray(v) ? (v.length ? v.join(", ") : "-") : String(v));
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString("th-TH", { maximumFractionDigits: 2 }) : "-"; };

/* ---------- กราฟเส้นขนาดเล็ก (SVG) ---------- */
type Series = { label: string; color: string; points: { x: string; y: number }[] };
function MiniChart({ title, unit, series, lines = [] }: { title: string; unit: string; series: Series[]; lines?: { y: number; label: string; tone: "watch" | "critical" }[] }) {
  const pts = series.flatMap((s) => s.points);
  if (!pts.length) return null;
  const W = 560, H = 170, L = 34, R = 10, T = 14, B = 26;
  const ys = [...pts.map((p) => p.y), ...lines.map((l) => l.y)];
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const padY = Math.max((hi - lo) * 0.12, 2); lo -= padY; hi += padY;
  const n = Math.max(...series.map((s) => s.points.length));
  const xAt = (i: number) => L + (n <= 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const yAt = (y: number) => T + (1 - (y - lo) / (hi - lo)) * (H - T - B);
  const labels = series[0].points;
  const ticks = [lo + padY, (lo + hi) / 2, hi - padY].map((v) => Math.round(v * 10) / 10);
  return (
    <figure className="chart-card">
      <figcaption><span>{title}</span><small>{unit}</small></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`กราฟ${title}`} className="w-full">
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={yAt(t)} y2={yAt(t)} className="chart-grid" /><text x={L - 6} y={yAt(t) + 3} className="chart-axis" textAnchor="end">{t}</text></g>)}
        {lines.map((l) => <g key={l.label + l.y}><line x1={L} x2={W - R} y1={yAt(l.y)} y2={yAt(l.y)} className={`chart-limit is-${l.tone}`} /><text x={W - R} y={yAt(l.y) - 3} textAnchor="end" className={`chart-limit-label is-${l.tone}`}>{l.label}</text></g>)}
        {series.map((s) => (
          <g key={s.label}>
            <polyline fill="none" stroke={s.color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" points={s.points.map((p, i) => `${xAt(i)},${yAt(p.y)}`).join(" ")} />
            {s.points.map((p, i) => <circle key={i} cx={xAt(i)} cy={yAt(p.y)} r={3.2} fill="#fff" stroke={s.color} strokeWidth={2}><title>{`${p.x} · ${s.label} ${p.y}`}</title></circle>)}
          </g>
        ))}
        {labels.map((p, i) => (n <= 6 || i % Math.ceil(n / 6) === 0 || i === n - 1) && <text key={i} x={xAt(i)} y={H - 8} textAnchor={n > 1 && i === n - 1 ? "end" : n > 1 && i === 0 ? "start" : "middle"} className="chart-axis">{p.x.split(" ")[0]}</text>)}
      </svg>
      {series.length > 1 && <div className="chart-legend">{series.map((s) => <span key={s.label}><i style={{ background: s.color }} />{s.label}</span>)}</div>}
    </figure>
  );
}

const limitLines = (k: keyof Vitals) => {
  const l = LIMITS[k]; const out: { y: number; label: string; tone: "watch" | "critical" }[] = [];
  if (l.criticalHigh !== undefined) out.push({ y: l.criticalHigh, label: `ผิดปกติ ≥${l.criticalHigh}`, tone: "critical" });
  if (l.criticalLow !== undefined) out.push({ y: l.criticalLow, label: `ผิดปกติ <${l.criticalLow}`, tone: "critical" });
  return out;
};

const TABS = ["ภาพรวม", "สัญญาณชีพ", "ยาและการให้ยา", "งานดูแลและนัดหมาย", "สมุดส่งเวร"];

/** ประวัติรายบุคคล: กดชื่อผู้รับบริการแล้วเห็นทุกอย่างในหน้าเดียว (พิมพ์เป็นเอกสารได้) */
export default function ResidentProfile({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [p, setP] = useState<Profile | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState(TABS[0]);
  useEffect(() => {
    if (!id) return;
    setP(null); setErr(""); setTab(TABS[0]);
    fetchProfile(id).then(setP).catch((e) => setErr((e as Error).message));
  }, [id]);

  /** บันทึกสุขภาพ + สัญญาณชีพจากงานประจำวัน เรียงเก่า→ใหม่ */
  const vitals = useMemo(() => {
    if (!p) return [];
    const h = p.health.map((r) => ({ at: String(r.at ?? ""), v: parseVitals(r.vital_signs as string, r.o2_sat as string, r.dtx as string), row: r, src: "บันทึกสุขภาพ" }));
    const d = p.daily.filter((r) => r.vital_signs && r.vital_signs !== "-").map((r) => ({ at: `${r.work_date} ${String(r.time ?? "00:00").slice(0, 5)}`, v: parseVitals(r.vital_signs as string), row: r, src: "งานประจำวัน" }));
    return [...h, ...d].filter((x) => Object.keys(x.v).length).sort((a, b) => a.at.localeCompare(b.at));
  }, [p]);
  const recent = vitals.slice(-30);
  const series = (k: keyof Vitals, label: string, color: string): Series => ({ label, color, points: recent.filter((x) => x.v[k] !== undefined).map((x) => ({ x: thDate(x.at), y: x.v[k]! })) });
  const last = vitals[vitals.length - 1];
  const lastFlags = last ? evaluateVitals(last.v) : [];
  const r = p?.resident;
  const openAlerts = (p?.alerts ?? []).filter((a) => a.status === "open");
  const activeMeds = (p?.meds ?? []).filter((m) => !m.on_hold && (m.status ?? "ปกติ") === "ปกติ");
  const today = new Date().toISOString().slice(0, 10);
  const nextAppt = (p?.appts ?? []).filter((a) => String(a.date ?? "") >= today).sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];

  return (
    <Modal open={!!id} wide title={r ? `ประวัติผู้รับบริการ · ${r.full_name}` : "ประวัติผู้รับบริการ"} onClose={onClose}
      footer={<><button className="btn-soft" onClick={() => window.print()}><Icon name="print" className="h-4 w-4" /> พิมพ์ประวัติ</button><button className="btn-primary" onClick={onClose}>ปิด</button></>}>
      {err && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</p>}
      {!p && !err && <p className="py-10 text-center text-sm text-gold-500">กำลังโหลดประวัติ…</p>}
      {p && r && (
        <div className="space-y-5">
          <div className="profile-head">
            <span className="profile-avatar">{r.full_name.replace(/^คุณ/, "").charAt(0)}</span>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-semibold text-gold-900">{r.full_name}</p>
              <p className="text-sm text-gold-600">อายุ {r.age ?? "-"} ปี · ห้อง {r.room ?? "-"} · สาขา{r.branch_name ?? "-"}</p>
              <p className="mt-1 text-sm text-gold-700">โรคประจำตัว: {str(r.chronic_diseases)}</p>
            </div>
            {r.status && <StatusBadge value={r.status} />}
          </div>

          <div className="print-hide"><Tabs tabs={TABS} value={tab} onChange={setTab} /></div>

          {tab === TABS[0] && (
            <div className="grid gap-4 md:grid-cols-2">
              <section className="profile-box">
                <h4>สัญญาณชีพล่าสุด</h4>
                {last ? <>
                  <p className="text-xs text-gold-500">{thDate(last.at)} · {last.src}</p>
                  <p className="mt-1.5 text-sm font-medium text-gold-900">{str(last.row.vital_signs)}{last.row.o2_sat ? ` · O2 ${last.row.o2_sat}` : ""}{last.row.dtx && last.row.dtx !== "-" ? ` · DTX ${last.row.dtx}` : ""}</p>
                  <div className="mt-2"><StatusBadge value={LEVEL_TH[levelOf(lastFlags)]} /></div>
                </> : <p className="text-sm text-gold-500">ยังไม่มีบันทึก</p>}
              </section>
              <section className="profile-box">
                <h4>แจ้งเตือนที่รอรับทราบ</h4>
                {openAlerts.length ? <ul className="space-y-1.5 text-sm">{openAlerts.map((a) => <li key={String(a.id)} className={a.level === "critical" ? "text-red-700" : "text-amber-800"}>• {str(a.summary)} <span className="text-xs text-gold-500">({thWhen(a.created_at)})</span></li>)}</ul> : <p className="text-sm text-emerald-700">ไม่มีแจ้งเตือนค้าง</p>}
              </section>
              <section className="profile-box">
                <h4>ยาที่ใช้อยู่ ({activeMeds.length} รายการ)</h4>
                {activeMeds.length ? <ul className="space-y-1 text-sm text-gold-800">{activeMeds.slice(0, 6).map((m) => <li key={String(m.id)}>• {str(m.drug_name)} <span className="text-xs text-gold-500">{str(m.meals)}</span></li>)}</ul> : <p className="text-sm text-gold-500">ไม่มีรายการยา</p>}
              </section>
              <section className="profile-box">
                <h4>นัดหมายถัดไป / ส่งเวรล่าสุด</h4>
                <p className="text-sm text-gold-800">{nextAppt ? `${thDate(nextAppt.date, false)} ${String(nextAppt.time ?? "").slice(0, 5)} · ${str(nextAppt.purpose)}` : "ไม่มีนัดหมาย"}</p>
                {p.handovers[0] && <p className="mt-2 text-sm text-gold-700">ส่งเวร: {str(p.handovers[0].detail)} <span className="text-xs text-gold-500">({str(p.handovers[0].written_by)})</span></p>}
              </section>
              {p.contracts.length > 0 && <section className="profile-box md:col-span-2">
                <h4>สัญญาและแผนดูแล</h4>
                {p.contracts.map((c) => <p key={String(c.id)} className="text-sm text-gold-800">สัญญา {str(c.contract_no)} · ผู้ว่าจ้าง {str(c.employer_name)} · {num(c.monthly_fee)} บาท/เดือน · {str(c.status)}</p>)}
                {p.plans.map((c) => <p key={String(c.id)} className="text-sm text-gold-800">แผน {str(c.plan_name)} · ญาติ {str(c.relative_phone)}</p>)}
              </section>}
            </div>
          )}

          {tab === TABS[1] && (
            <div className="space-y-4">
              {!vitals.length && <p className="rounded-xl bg-cream-50 px-4 py-6 text-center text-sm text-gold-500">ยังไม่มีบันทึกสัญญาณชีพ</p>}
              {vitals.length > 0 && <>
                <p className="text-xs text-gold-500">แสดง {recent.length} ครั้งล่าสุด · เส้นประสีแดง = เกณฑ์ผิดปกติ</p>
                <div className="grid gap-4 lg:grid-cols-2">
                  <MiniChart title="ความดันโลหิต" unit="mmHg" series={[series("sys", "ตัวบน", "#8b6e3e"), series("dia", "ตัวล่าง", "#c9a96a")].filter((s) => s.points.length)} lines={[{ y: 180, label: "ตัวบน ≥180", tone: "critical" }, { y: 90, label: "ตัวบน <90", tone: "critical" }]} />
                  <MiniChart title="ชีพจร" unit="ครั้ง/นาที" series={[series("pr", "PR", "#8b6e3e")].filter((s) => s.points.length)} lines={limitLines("pr")} />
                  <MiniChart title="ออกซิเจนในเลือด" unit="%" series={[series("o2", "O2 Sat", "#3f7a5c")].filter((s) => s.points.length)} lines={limitLines("o2")} />
                  <MiniChart title="อุณหภูมิ" unit="°C" series={[series("bt", "BT", "#b4643a")].filter((s) => s.points.length)} lines={limitLines("bt")} />
                  <MiniChart title="น้ำตาลปลายนิ้ว" unit="mg/dL" series={[series("dtx", "DTX", "#6b5a9a")].filter((s) => s.points.length)} lines={limitLines("dtx")} />
                </div>
                <DataTable search={false} badgeCols={[4]} columns={["วันเวลา", "สัญญาณชีพ", "O2 Sat", "DTX", "ผลประเมิน", "ผู้บันทึก"]}
                  rows={[...vitals].reverse().map((x) => [thDate(x.at), str(x.row.vital_signs), str(x.row.o2_sat), str(x.row.dtx), LEVEL_TH[levelOf(evaluateVitals(x.v))], str(x.row.recorded_by ?? x.row.assignee)])} />
              </>}
            </div>
          )}

          {tab === TABS[2] && (
            <div className="space-y-5">
              <div><h4 className="profile-sub">รายการยาประจำตัว</h4>
                <DataTable search={false} columns={["ชื่อยา", "ข้อบ่งใช้", "ขนาด", "มื้อ", "คงเหลือ", "สถานะ"]} empty="ไม่มีรายการยา"
                  rows={p.meds.map((m) => [str(m.drug_name), str(m.indication), `${num(m.dose)} ${str(m.unit)}`, str(m.meals), `${num(m.stock)} ${str(m.unit)}`, m.on_hold ? "งดชั่วคราว" : str(m.status ?? "ปกติ")])} /></div>
              <div><h4 className="profile-sub">บันทึกการให้ยา (MAR)</h4>
                <DataTable search={false} badgeCols={[6]} columns={["วันที่", "มื้อ", "รายการยา", "จัดโดย", "ตรวจ QA", "ผู้ให้ยา / เวลา", "สถานะ"]} empty="ยังไม่มีประวัติการจัดยา"
                  rows={p.packs.map((k) => [thDate(k.date, false), str(k.meal), str(k.items), str(k.packed_by), str(k.checked_by), k.given ? `${str(k.given_by)} · ${thDate(k.given_at)}` : "-", k.given ? "จ่ายยาแล้ว" : k.qa_status === "ตรวจผ่าน" ? "รอจ่าย" : str(k.qa_status)])} /></div>
            </div>
          )}

          {tab === TABS[3] && (
            <div className="space-y-5">
              <div><h4 className="profile-sub">นัดหมาย</h4>
                <DataTable search={false} columns={["วันที่", "เวลา", "วัตถุประสงค์", "ผู้ดูแล"]} empty="ไม่มีนัดหมาย"
                  rows={p.appts.map((a) => [thDate(a.date, false), String(a.time ?? "-").slice(0, 5), str(a.purpose), str(a.caregiver)])} /></div>
              <div><h4 className="profile-sub">งานดูแลประจำวัน</h4>
                <DataTable search={false} columns={["วันที่", "เวลา", "งาน", "ผู้รับผิดชอบ", "กะ", "สถานะ"]} empty="ไม่มีงานดูแล"
                  rows={[...p.daily.map((t) => [thDate(t.work_date, false), String(t.time ?? "-").slice(0, 5), str(t.task_name), str(t.assignee), str(t.shift), str(t.status)]),
                    ...p.tasks.map((t) => [thDate(t.date, false), String(t.time ?? "-").slice(0, 5), str(t.task_name), str(t.performed_by), str(t.category), str(t.status)])]} /></div>
            </div>
          )}

          {tab === TABS[4] && (
            <DataTable search={false} columns={["หัวข้อ", "รายละเอียด", "ผู้เขียน", "เวลา"]} empty="ไม่มีบันทึกส่งเวร"
              rows={p.handovers.map((h) => [str(h.topic_type), str(h.detail), str(h.written_by), str(h.written_at)])} />
          )}
        </div>
      )}
    </Modal>
  );
}
