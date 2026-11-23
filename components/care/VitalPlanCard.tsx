"use client";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/lib/app";
import { dueAll, DueCls, fetchVitalDue, presetLabel, saveVitalPlan, thShort, VITAL_DUE_EVENT, VITAL_PRESETS, VitalDueRow, VitalKey, PresetKey } from "@/lib/vitalPlan";

/** ป้ายสถานะรอบการวัด (ใช้ร่วมกับฟอร์มสัญญาณชีพและ KinApp) */
export const DUE_TONE: Record<DueCls, string> = {
  due: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  over: "bg-red-50 text-red-700 ring-1 ring-red-200",
  rest: "bg-cream-200 text-gold-600",
  off: "bg-transparent text-gold-400",
};
export function DueBadge({ cls, text }: { cls: DueCls; text: string }) {
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium ${DUE_TONE[cls]}`}>{cls !== "off" && <i className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}{text}</span>;
}

/**
 * การ์ดรอบการวัด (ประวัติผู้รับบริการ › สัญญาณชีพ)
 *  ตั้งรอบด้วยปุ่มภาษาคน ทีละรายการ (หัวหน้าพยาบาล/ผู้จัดการ) · คนอื่นเห็นอย่างเดียว
 *  ระบบนับจากครั้งล่าสุดที่บันทึกจริง → ฟอร์มสัญญาณชีพขึ้นป้ายถึงรอบ และ KinApp มีรายการถึงรอบวัด
 */
export default function VitalPlanCard({ residentId }: { residentId: string }) {
  const { toast } = useApp();
  const [row, setRow] = useState<VitalDueRow | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<VitalKey | null>(null);
  const load = useCallback(() => {
    fetchVitalDue({ id: residentId }).then((d) => { setRow(d.items[0] ?? null); setCanEdit(d.canEdit); setErr(d.items[0] ? "" : "ไม่พบผู้รับบริการคนนี้ อาจย้ายออกแล้ว"); }).catch((e) => setErr((e as Error).message));
  }, [residentId]);
  useEffect(() => { load(); window.addEventListener(VITAL_DUE_EVENT, load); return () => window.removeEventListener(VITAL_DUE_EVENT, load); }, [load]);

  const pick = async (k: VitalKey, p: PresetKey) => {
    if (!row || row.plan[k] === p) return;
    const prev = row;
    const next = { ...row, plan: { ...row.plan, [k]: p }, custom: true };
    setRow(next); setBusy(k);
    try { await saveVitalPlan(row.id, next.plan); toast(`ตั้งรอบแล้ว · ${VITAL_LABEL[k]}: ${presetLabel(p)}`); }
    catch (e) { setRow(prev); toast((e as Error).message); }
    finally { setBusy(null); }
  };

  if (err) return <p className="rounded-xl bg-cream-50 px-4 py-3 text-sm text-gold-600">{err}</p>;
  if (!row) return <p className="py-4 text-center text-sm text-gold-500">กำลังโหลดรอบการวัด…</p>;
  const items = dueAll(row);
  return (
    <section className="profile-box">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="!mb-0">รอบการวัด</h4>
        <span className="text-xs text-gold-500">{row.custom ? `ตั้งโดย ${row.by ?? "-"}` : "ใช้ค่าเริ่มต้น"} · นับจากครั้งล่าสุดที่บันทึกจริง</span>
      </div>
      {!canEdit && <p className="mb-1 text-xs text-gold-500">หัวหน้าพยาบาลหรือผู้จัดการสาขาเป็นคนตั้งรอบ · บันทึกสัญญาณชีพแล้วระบบนับรอบใหม่ให้เอง</p>}
      <ul className="divide-y divide-cream-200">
        {items.map((it) => (
          <li key={it.k} className="grid gap-2 py-2.5 md:grid-cols-[140px_minmax(0,1fr)_200px] md:items-center">
            <span><b className="block text-sm text-gold-900">{it.label}</b><small className="text-xs text-gold-500">{it.sub}</small></span>
            {canEdit ? (
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={`รอบการวัด ${it.label}`}>
                {VITAL_PRESETS.map((p) => (
                  <button key={p.k} type="button" aria-pressed={it.preset === p.k} disabled={busy === it.k} onClick={() => pick(it.k, p.k)}
                    className={`rounded-full border px-2.5 py-1 text-xs transition ${it.preset === p.k ? "border-gold-700 bg-gold-700 font-medium text-white" : "border-cream-300 bg-white text-gold-700 hover:border-gold-300"}`}>{p.label}</button>
                ))}
              </div>
            ) : <span className="text-sm text-gold-800">{presetLabel(it.preset)}</span>}
            <span className="grid justify-items-start gap-0.5 text-xs text-gold-500">
              <DueBadge cls={it.due.cls} text={it.due.text} />
              {it.due.cls !== "off" && <span>{it.last ? `ล่าสุด ${thShort(it.last)} ${it.last.slice(11, 16)}` : "ยังไม่เคยวัด"}{it.due.cls === "rest" && it.due.next ? ` · รอบถัดไป ${thShort(it.due.next)}` : ""}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
const VITAL_LABEL: Record<VitalKey, string> = { vs: "สัญญาณชีพ", o2: "ออกซิเจนในเลือด", dtx: "น้ำตาลในเลือด (DTX)", wt: "น้ำหนัก", ht: "ส่วนสูง" };
