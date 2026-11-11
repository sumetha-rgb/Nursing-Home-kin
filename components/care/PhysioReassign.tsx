"use client";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "../ui";
import { useApp } from "@/lib/app";
import { clashes, inCase, PhysioCase, schedFor, schedText, teamOf, Therapist } from "@/lib/physio";

/**
 * ย้ายเคสทั้งหมดของนักกายภาพคนหนึ่งไปให้อีกคน (ลา ลาออก ย้ายสาขา) · วันและเวลานัดเดิมไม่เปลี่ยน
 *  เปิดจากปุ่ม "ย้ายเคส" บนหัวหน้าตารางกายภาพ (ไม่ใส่ปุ่มในแถวตาราง ทีมใหญ่ตารางจะรก)
 *  1) เลือกคนที่จะย้ายออก (เฉพาะคนที่มีเคสในสาขาที่เลือก) 2) ดูเคสที่จะย้าย 3) เลือกคนรับ + ดูเวลาที่ชน · ผู้จัดการ = สาขาตัวเอง
 */
export default function PhysioReassign({ open, cases, therapists, branch, onClose, onSaved }: {
  open: boolean; cases: PhysioCase[]; therapists: Therapist[]; branch: string; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useApp();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setFrom(""); setTo(""); } }, [open]);
  /** คนที่มีเคส (รวมคนที่ไม่อยู่ในทีมแล้วแต่ยังค้างเคส) เรียงตามจำนวนเคสมากไปน้อย */
  const owners = useMemo(() => {
    const m = new Map<string, { id: string; name: string; n: number }>();
    for (const c of cases) if (c.therapist_id && (!branch || c.branch_name === branch)) for (const p of teamOf(c)) {
      const t = therapists.find((x) => x.id === p.id);
      const o = m.get(p.id) ?? { id: p.id, name: t ? t.name : `${p.name} (ไม่อยู่ในทีมแล้ว)`, n: 0 };
      o.n++; m.set(p.id, o);
    }
    return [...m.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "th"));
  }, [cases, therapists, branch]);
  const fromName = owners.find((o) => o.id === from)?.name ?? "";
  const mine = useMemo(() => cases.filter((c) => from && inCase(c, from) && (!branch || c.branch_name === branch)), [cases, from, branch]);
  const team = therapists.filter((t) => t.id !== from);
  /** นัดส่วนของคนที่ย้ายออก ชนกับนัดเดิมของคนรับไหม */
  const clash = useMemo(() => (to ? mine.filter((c) => { const s = schedFor(c, from); return c.plan_time && s && clashes(cases, to, s, c.plan_time, c.plan_minutes || 45, c.id).length > 0; }) : []), [mine, cases, to, from]);
  const save = async () => {
    if (!from || !to || busy) return;
    setBusy(true);
    const r = await fetch("/api/clinic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "course_reassign", fromId: from, toId: to, branch: branch || undefined }) }).catch(() => null);
    setBusy(false);
    const d = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) return toast(d.error || "ย้ายเคสไม่สำเร็จ");
    toast(`ย้าย ${d.moved} เคสจาก ${fromName} ให้ ${team.find((t) => t.id === to)?.name ?? ""} แล้ว · แจ้งเตือนทั้งสองคนแล้ว`);
    onSaved(); onClose();
  };
  return (
    <Modal open={open} title="ย้ายเคสกายภาพ" onClose={onClose}
      footer={<>
        <button type="button" className="btn-soft" onClick={onClose}>ยกเลิก</button>
        <button type="button" className="btn-primary" disabled={!from || !to || !mine.length || busy} onClick={save}>{busy ? "กำลังย้าย…" : mine.length ? `ย้าย ${mine.length} เคส` : "ย้ายเคส"}</button>
      </>}>
      {!owners.length ? <p className="rounded-xl bg-cream-50 px-4 py-6 text-center text-sm text-gold-600">ยังไม่มีเคสที่จ่ายให้นักกายภาพ{branch ? `ในสาขา${branch}` : ""}</p> : <div className="space-y-3">
        <p className="text-sm text-gold-700">ใช้ตอนนักกายภาพลา ลาออก หรือย้ายสาขา · วันและเวลานัดเดิมไม่เปลี่ยน · ทั้งสองคนได้แจ้งเตือนบนมือถือ</p>
        <ul className="pa-rule">
          <li><b>ย้าย</b> เฉพาะนัดที่ยังไม่ได้ทำ (ครั้งที่เหลือของคอร์ส) ไปให้คนใหม่</li>
          <li><b>ไม่ย้าย</b> ครั้งที่ทำไปแล้ว · ยังเป็นผลงานของคนเดิม ในตาราง ติดตามการส่งงาน และผลงานเดือนนี้</li>
          <li>ประวัติการบันทึกเดิมยังอยู่กับเคส · คนใหม่เปิดดูได้เพื่อทำต่อ</li>
        </ul>
        <section className="pa2-step"><h4><i>1</i>ย้ายเคสของ</h4>
          <select aria-label="ย้ายเคสของ" value={from} onChange={(e) => { setFrom(e.target.value); setTo(""); }}>
            <option value="">เลือกนักกายภาพที่จะย้ายเคสออก</option>
            {owners.map((o) => <option key={o.id} value={o.id}>{o.name} · {o.n} เคส</option>)}
          </select>
        </section>
        {from && <>
          <ul className="pa-reassign">{mine.map((c) => (
            <li key={c.id}><b>{c.resident_name}</b><span>{c.therapist_id === from ? `${schedText(c)} ${c.plan_time ?? ""} · ย้ายนัดที่เหลือของคนนี้${c.used ? ` · ทำแล้ว ${c.used} ครั้งไม่ย้าย` : ""}` : `อยู่ในทีม (บางวัน) · ย้ายเฉพาะวันของคนนี้`}</span></li>
          ))}</ul>
          {!team.length && <p className="pk-vwarn">ยังไม่มีนักกายภาพคนอื่นในระบบ · สร้างบัญชีตำแหน่ง &quot;นักกายภาพบำบัด&quot; ที่เมนูทีมและสิทธิ์การใช้งานก่อน</p>}
          <section className="pa2-step"><h4><i>2</i>ย้ายไปให้</h4>
            <select aria-label="ย้ายไปให้" value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="">เลือกนักกายภาพที่จะรับเคส</option>
              {team.map((t) => <option key={t.id} value={t.id}>{t.name}{t.branch && t.branch !== branch ? ` · ${t.branch}` : ""} · ตอนนี้ {t.cases_all ?? 0} เคส</option>)}
            </select>
          </section>
          {to && (clash.length
            ? <p className="pk-vwarn">เวลาชนกับเคสเดิมของคนรับ {clash.length} เคส ({clash.slice(0, 3).map((c) => c.resident_name).join(", ")}{clash.length > 3 ? " …" : ""}) · ย้ายแล้วกดเคสในตารางเพื่อเลื่อนเวลา</p>
            : <p className="text-sm text-[#2f6b3a]">✓ เวลาไม่ชนกับเคสเดิมของคนรับ</p>)}
        </>}
      </div>}
    </Modal>
  );
}
