"use client";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "../ui";
import { useApp } from "@/lib/app";
import { clashes, loadOf, PhysioCase, schedOf, schedText, Therapist } from "@/lib/physio";

/**
 * ย้ายเคสทั้งหมดของนักกายภาพคนหนึ่งไปให้อีกคน (ลา ลาออก ย้ายสาขา) · วันและเวลานัดเดิมไม่เปลี่ยน
 *  แสดงเคสที่จะย้าย + ภาระงานและเวลาที่ชนกับเคสเดิมของคนรับ ก่อนกดยืนยัน · ย้ายเฉพาะเคสในสาขาที่เลือก (ผู้จัดการ = สาขาตัวเอง)
 */
export default function PhysioReassign({ from, cases, therapists, branch, onClose, onSaved }: {
  from: { id: string; name: string } | null; cases: PhysioCase[]; therapists: Therapist[]; branch: string; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useApp();
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setTo(""); }, [from?.id]);
  const mine = useMemo(() => (from ? cases.filter((c) => c.therapist_id === from.id && (!branch || c.branch_name === branch)) : []), [cases, from, branch]);
  const team = therapists.filter((t) => t.id !== from?.id);
  /** เคสที่ย้ายไปแล้วเวลาชนกับเคสเดิมของคนรับ */
  const clash = useMemo(() => (to ? mine.filter((c) => c.plan_time && clashes(cases, to, schedOf(c), c.plan_time, c.plan_minutes || 45).length > 0) : []), [mine, cases, to]);
  const save = async () => {
    if (!from || !to || busy) return;
    setBusy(true);
    const r = await fetch("/api/clinic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "course_reassign", fromId: from.id, toId: to, branch: branch || undefined }) }).catch(() => null);
    setBusy(false);
    const d = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) return toast(d.error || "ย้ายเคสไม่สำเร็จ");
    toast(`ย้าย ${d.moved} เคสให้ ${team.find((t) => t.id === to)?.name ?? ""} แล้ว · แจ้งเตือนทั้งสองคนแล้ว`);
    onSaved(); onClose();
  };
  return (
    <Modal open={!!from} title={from ? `ย้ายเคสทั้งหมดของ ${from.name}` : ""} onClose={onClose}
      footer={<>
        <button type="button" className="btn-soft" onClick={onClose}>ยกเลิก</button>
        <button type="button" className="btn-primary" disabled={!to || !mine.length || busy} onClick={save}>{busy ? "กำลังย้าย…" : `ย้าย ${mine.length} เคส`}</button>
      </>}>
      {!mine.length ? <p className="rounded-xl bg-cream-50 px-4 py-6 text-center text-sm text-gold-600">ไม่มีเคสที่ยังเหลือครั้ง{branch ? `ในสาขา${branch}` : ""}</p> : <div className="space-y-3">
        <p className="text-sm text-gold-700">ใช้ตอนนักกายภาพลา ลาออก หรือย้ายสาขา · วันและเวลานัดเดิมไม่เปลี่ยน · คนรับจะได้แจ้งเตือนบนมือถือ</p>
        <ul className="pa-reassign">{mine.map((c) => (
          <li key={c.id}><b>{c.resident_name}</b><span>{schedText(c)} {c.plan_time ?? ""} · เหลือ {c.total - c.used} ครั้ง</span></li>
        ))}</ul>
        {!team.length && <p className="pk-vwarn">ยังไม่มีนักกายภาพคนอื่นในระบบ · สร้างบัญชีตำแหน่ง &quot;นักกายภาพบำบัด&quot; ที่เมนูทีมและสิทธิ์การใช้งานก่อน</p>}
        <label className="block text-sm font-semibold text-gold-800">ย้ายไปให้
          <select className="mt-1" value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">เลือกนักกายภาพ</option>
            {team.map((t) => { const l = loadOf(cases, t.id); return <option key={t.id} value={t.id}>{t.name}{t.branch && t.branch !== branch ? ` · ${t.branch}` : ""} · ตอนนี้ {t.cases_all ?? l.cases} เคส</option>; })}
          </select>
        </label>
        {to && (clash.length
          ? <p className="pk-vwarn">เวลาชนกับเคสเดิมของคนรับ {clash.length} เคส ({clash.slice(0, 3).map((c) => c.resident_name).join(", ")}{clash.length > 3 ? " …" : ""}) · ย้ายแล้วกดเคสในตารางเพื่อเลื่อนเวลา</p>
          : <p className="text-sm text-[#2f6b3a]">✓ เวลาไม่ชนกับเคสเดิมของคนรับ</p>)}
      </div>}
    </Modal>
  );
}
