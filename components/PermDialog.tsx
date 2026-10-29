"use client";
import { useEffect, useState } from "react";
import { Modal } from "./ui";
import { can, Perm, PERM_GROUPS, permsFor, ROLE_PERMS } from "@/lib/perms";
import { ROLE_INFO, Role, SessionUser } from "@/lib/roles";
import type { UserRow } from "@/lib/session";

/**
 * ติ๊กสิทธิ์รายคน: เมนูที่เห็น สิทธิ์การทำงาน และแอปในมือถือ
 * ให้ได้เฉพาะสิทธิ์ที่ผู้แก้มีเอง · "ใช้ค่าเริ่มต้นของตำแหน่ง" = เลิกกำหนดรายคน (ตามตำแหน่งต่อไป แม้ภายหลังเปลี่ยนตำแหน่ง)
 */
export default function PermDialog({ user, me, onClose, onSave }: {
  user: UserRow | null; me: SessionUser | null; onClose: () => void; onSave: (perms: Perm[] | null) => void;
}) {
  const role = (user?.access_level ?? "Nurse") as Role;
  const [on, setOn] = useState<Set<Perm>>(new Set());
  useEffect(() => { if (user) setOn(new Set(permsFor(role, user.permissions))); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps
  const top = role === "Global Admin";
  const mine = (p: Perm) => can(me, p);
  const toggle = (p: Perm) => { const n = new Set(on); if (n.has(p)) n.delete(p); else n.add(p); setOn(n); };
  const setGroup = (ids: Perm[], v: boolean) => { const n = new Set(on); ids.filter(mine).forEach((p) => (v ? n.add(p) : n.delete(p))); setOn(n); };
  const defaults = new Set(ROLE_PERMS[role]);
  const changed = [...on].some((p) => !defaults.has(p)) || [...defaults].some((p) => !on.has(p));

  return (
    <Modal open={!!user} wide title={`สิทธิ์การใช้งาน · ${user?.full_name ?? ""}`} onClose={onClose}
      footer={top ? <button className="btn-primary" onClick={onClose}>ปิด</button> : <>
        <button className="btn-soft" onClick={onClose}>ยกเลิก</button>
        <button className="btn-soft" onClick={() => onSave(null)}>ใช้ค่าเริ่มต้นของตำแหน่ง</button>
        <button className="btn-primary" onClick={() => onSave([...on])}>บันทึกสิทธิ์</button>
      </>}>
      {user && <div className="space-y-5">
        <p className="rounded-xl bg-cream-50 px-4 py-3 text-sm leading-7 text-gold-700">
          ตำแหน่ง <b className="font-medium text-gold-800">{ROLE_INFO[role].th}</b> · สาขา{user.branch_name ?? "-"} ·{" "}
          {top ? "ผู้บริหารองค์กรได้ทุกสิทธิ์และเห็นทุกสาขาเสมอ" : user.permissions ? "กำหนดสิทธิ์รายคนไว้" : "ใช้ค่าเริ่มต้นของตำแหน่ง"}
          {!top && changed && <span className="ml-1 text-gold-500">(ต่างจากค่าเริ่มต้นของตำแหน่ง)</span>}
        </p>
        {!top && PERM_GROUPS.map((g) => {
          const ids = g.items.map((i) => i.id);
          return <section key={g.title}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-medium text-gold-800">{g.title}</h4>
              <span className="flex gap-2"><button type="button" className="row-action" onClick={() => setGroup(ids, true)}>เลือกทั้งหมด</button><button type="button" className="row-action" onClick={() => setGroup(ids, false)}>ไม่เลือก</button></span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map((i) => (
                <label key={i.id} className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 text-sm ${on.has(i.id) ? "border-gold-300 bg-cream-50" : "border-cream-200 bg-white"} ${mine(i.id) ? "cursor-pointer" : "opacity-50"}`}>
                  <input type="checkbox" className="mt-1" checked={on.has(i.id)} disabled={!mine(i.id)} onChange={() => toggle(i.id)} />
                  <span><span className="block text-gold-800">{i.label}</span>{i.hint && <span className="block text-xs text-gold-500">{i.hint}</span>}</span>
                </label>
              ))}
            </div>
          </section>;
        })}
        {!top && <p className="text-xs leading-6 text-gold-500">ช่องสีจาง = สิทธิ์ที่บัญชีของคุณไม่มี จึงให้คนอื่นไม่ได้ · ขอบเขตข้อมูลยังเป็นตามสาขาของบัญชี · ผู้ใช้ต้องรีเฟรชหน้าหรือเข้าสู่ระบบใหม่เพื่อเห็นเมนูที่เปลี่ยน</p>}
      </div>}
    </Modal>
  );
}
