"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Modal, Section } from "../ui";
import { Invoice, money } from "@/lib/billing";
import { useCrud } from "@/lib/store";
import { useApp } from "@/lib/app";
import { bkkToday, revenueIn } from "@/lib/servicePeriod";

type Target = { branch: string; month: string; amount: number; by?: string; at?: string };
const TH_MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
/** "2026-11" → "พ.ย. 69" */
const monLabel = (k: string) => `${TH_MON[Number(k.slice(5, 7)) - 1]} ${String(Number(k.slice(0, 4)) + 543).slice(2)}`;
const addMonth = (ym: string, n: number) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
const lastDay = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
const baht = (n: number) => money(n).replace(/\.00$/, "");

/**
 * เป้ายอดขายรายเดือนของแต่ละสาขา (ภาพรวมและรายงาน แท็บการเงิน)
 *  วัดผลด้วย "รายได้ตามช่วงบริการ" ของเดือน (รวม VAT · ตัวเดียวกับ Dashboard และ CSV) · ผู้บริหารตั้ง/แก้เป้าได้ คนอื่นดูอย่างเดียว
 *  branch = สาขาที่เลือกในหน้าภาพรวม (ว่าง = ทุกสาขา) · list = ใบที่บัญชีนี้เห็น (ยังไม่กรองสาขา)
 */
export default function SalesTargets({ month, branch, list, contracts, branchOf }: {
  month: string; branch: string; list: Invoice[]; contracts: string[][]; branchOf: (x: Invoice) => string;
}) {
  const { toast } = useApp();
  const br = useCrud("branches", []);
  const [targets, setTargets] = useState<Target[] | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [edit, setEdit] = useState<{ month: string; vals: Record<string, string> } | null>(null);
  const [saving, setSaving] = useState(false);
  // สาขาที่เปิดหรือเตรียมเปิด (ไม่นับสาขาที่ปิดแล้ว) · เลือกสาขาไว้ = เฉพาะสาขานั้น
  const names = useMemo(() => {
    const all = br.rows.filter((r) => r[1] && !/^ปิด/.test(r[10] ?? "")).map((r) => r[1]);
    return branch ? all.filter((n) => n === branch).concat(all.includes(branch) ? [] : [branch]) : all;
  }, [br.rows, branch]);

  const load = useCallback(() => {
    fetch(`/api/ops?op=targets&from=${addMonth(month, -12)}&to=${addMonth(month, 12)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { setTargets(d.items ?? []); setCanEdit(!!d.canEdit); })
      .catch(() => setTargets([]));
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const targetOf = (b: string, m: string) => targets?.find((t) => t.branch === b && t.month === m)?.amount ?? 0;
  const today = bkkToday(), isNow = today.slice(0, 7) === month, from = `${month}-01`, to = `${month}-${String(lastDay(month)).padStart(2, "0")}`;
  const daysLeft = isNow ? lastDay(month) - Number(today.slice(8, 10)) : 0;
  const rows = names.map((b) => {
    const mine = list.filter((x) => branchOf(x) === b);
    return { b, target: targetOf(b, month), got: revenueIn(mine, contracts, from, to), soFar: isNow ? revenueIn(mine, contracts, from, today) : 0 };
  });
  const sum = rows.reduce((t, r) => ({ target: t.target + r.target, got: t.got + r.got }), { target: 0, got: 0 });
  const anyTarget = rows.some((r) => r.target > 0);

  const openEdit = (m = month) => setEdit({ month: m, vals: Object.fromEntries(names.map((b) => [b, targetOf(b, m) ? String(targetOf(b, m)) : ""])) });
  const save = async () => {
    if (!edit) return;
    setSaving(true);
    try {
      const r = await fetch("/api/ops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "targets", month: edit.month, items: names.map((b) => ({ branch: b, amount: Number(edit.vals[b] || 0) })) }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "บันทึกเป้าไม่สำเร็จ");
      toast(d.changed ? `บันทึกเป้ายอดขาย ${monLabel(edit.month)} แล้ว ${d.changed} สาขา` : "เป้าเหมือนเดิม ไม่มีการเปลี่ยนแปลง");
      setEdit(null); load();
    } catch (e) { toast((e as Error).message); } finally { setSaving(false); }
  };

  const bar = (got: number, target: number) => {
    const pct = target ? Math.round((got / target) * 100) : 0;
    return { pct, w: Math.min(100, pct) };
  };
  const status = (got: number, target: number) => {
    if (!target) return "ยังไม่ตั้งเป้า";
    if (got >= target) return `ถึงเป้าแล้ว เกิน ${baht(got - target)} บาท`;
    return `ขาดอีก ${baht(target - got)} บาท${isNow ? ` · เหลือ ${daysLeft} วัน` : ""}`;
  };

  return (
    <Section title={`เป้ายอดขาย ${monLabel(month)}`} sub="วัดจากรายได้ตามช่วงบริการของเดือน (รวม VAT) · ใบจ่ายล่วงหน้านับเฉพาะส่วนของเดือนนี้"
      actions={canEdit ? <button className="btn-soft" onClick={() => openEdit()}>{anyTarget ? "แก้เป้ายอดขาย" : "ตั้งเป้ายอดขาย"}</button> : undefined}>
      {targets === null ? <p className="text-sm text-gold-500">กำลังโหลด…</p> : (
        <div className="tgt">
          {rows.map((r) => {
            const { pct, w } = bar(r.got, r.target);
            return (
              <div key={r.b} className={`tgt-row ${r.target ? (r.got >= r.target ? "is-hit" : "") : "is-none"}`}>
                <div className="tgt-top">
                  <b>{r.b}</b>
                  <span>{r.target ? <><strong>{baht(r.got)}</strong> / {baht(r.target)} บาท <em>{pct}%</em></> : <>ทำได้ <strong>{baht(r.got)}</strong> บาท</>}</span>
                </div>
                <div className="tgt-bar" role="img" aria-label={r.target ? `${r.b} ${pct}% ของเป้า` : `${r.b} ยังไม่ตั้งเป้า`}><span style={{ width: `${w}%` }} /></div>
                <p className="tgt-note">{status(r.got, r.target)}{isNow && r.target > 0 ? ` · ถึงวันนี้ ${baht(r.soFar)} บาท` : ""}</p>
              </div>
            );
          })}
          {rows.length > 1 && sum.target > 0 && (() => {
            const { pct, w } = bar(sum.got, sum.target);
            return (
              <div className={`tgt-row is-total ${sum.got >= sum.target ? "is-hit" : ""}`}>
                <div className="tgt-top"><b>รวมทุกสาขา</b><span><strong>{baht(sum.got)}</strong> / {baht(sum.target)} บาท <em>{pct}%</em></span></div>
                <div className="tgt-bar" role="img" aria-label={`รวมทุกสาขา ${pct}% ของเป้า`}><span style={{ width: `${w}%` }} /></div>
                <p className="tgt-note">{status(sum.got, sum.target)}</p>
              </div>
            );
          })()}
          {!anyTarget && <p className="tgt-empty">{canEdit ? "ยังไม่ได้ตั้งเป้าเดือนนี้ · กด ตั้งเป้ายอดขาย เพื่อกำหนดยอดของแต่ละสาขา" : "ผู้บริหารยังไม่ได้ตั้งเป้าเดือนนี้"}</p>}
        </div>
      )}
      <Modal open={!!edit} title={`ตั้งเป้ายอดขาย ${edit ? monLabel(edit.month) : ""}`} onClose={() => setEdit(null)}
        footer={<><button className="btn-soft" onClick={() => setEdit(null)}>ยกเลิก</button><button className="btn-primary" disabled={saving} onClick={save}>{saving ? "กำลังบันทึก…" : "บันทึกเป้า"}</button></>}>
        {edit && <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-soft" onClick={() => openEdit(addMonth(edit.month, -1))} aria-label="เดือนก่อน">‹</button>
            <b className="min-w-24 text-center text-gold-900">{monLabel(edit.month)}</b>
            <button type="button" className="btn-soft" onClick={() => openEdit(addMonth(edit.month, 1))} aria-label="เดือนถัดไป">›</button>
            <button type="button" className="btn-soft ml-auto" onClick={() => setEdit({ ...edit, vals: Object.fromEntries(names.map((b) => [b, targetOf(b, addMonth(edit.month, -1)) ? String(targetOf(b, addMonth(edit.month, -1))) : edit.vals[b]])) })}>ใช้เป้า {monLabel(addMonth(edit.month, -1))}</button>
          </div>
          <div className="tgt-form">
            {names.map((b) => {
              const prev = targetOf(b, addMonth(edit.month, -1));
              return (
                <label key={b}>
                  <span>{b}{prev ? <small>{monLabel(addMonth(edit.month, -1))}: {baht(prev)}</small> : null}</span>
                  <input type="number" inputMode="numeric" min={0} step={1000} placeholder="ไม่ตั้งเป้า" value={edit.vals[b] ?? ""}
                    onChange={(e) => setEdit({ ...edit, vals: { ...edit.vals, [b]: e.target.value } })} />
                </label>
              );
            })}
          </div>
          <p className="text-xs text-gold-500">ใส่เป็นบาท (รวม VAT) · เว้นว่างหรือ 0 = ไม่ตั้งเป้าสาขานั้น · ดูเป้าได้ทุกสาขาที่หน้าภาพรวม แท็บการเงิน</p>
        </div>}
      </Modal>
    </Section>
  );
}
