"use client";
import { useEffect, useState } from "react";
import { Modal } from "./ui";
import { can, Perm, PERM_GROUPS, permsFor, ROLE_PERMS } from "@/lib/perms";
import { ROLE_INFO, Role, SessionUser } from "@/lib/roles";
import type { UserRow } from "@/lib/session";

/** สิทธิ์การทำงานอยู่ใต้เมนูที่เกี่ยวข้อง */
const SUB: Partial<Record<Perm, Perm[]>> = { rooms: ["rooms.move", "rooms.manage"], tasks: ["tasks.review"], contracts: ["contracts.delete"], billing: ["invoices.void"] };
const SUB_IDS = new Set(Object.values(SUB).flat());
const LABEL = Object.fromEntries(PERM_GROUPS.flatMap((g) => g.items.map((i) => [i.id, i]))) as Record<Perm, { id: Perm; label: string; hint?: string }>;

/**
 * สิทธิ์รายคนแบบสวิตช์ จัดกลุ่มตามเมนูด้านซ้าย · สิทธิ์การทำงานอยู่ใต้เมนูที่เกี่ยวข้อง
 * สวิตช์ที่ต่างจากค่าเริ่มต้นของตำแหน่งมีป้าย "เพิ่มให้คนนี้" / "ปิดให้คนนี้"
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
  const defaults = new Set(ROLE_PERMS[role]);
  const toggle = (p: Perm) => {
    const n = new Set(on);
    if (n.has(p)) { n.delete(p); (SUB[p] ?? []).forEach((s) => n.delete(s)); } else n.add(p);
    setOn(n);
  };
  const diff = [...on].filter((p) => !defaults.has(p)).length + [...defaults].filter((p) => !on.has(p)).length;

  const Row = ({ id, sub, parentOff }: { id: Perm; sub?: boolean; parentOff?: boolean }) => {
    const i = LABEL[id], v = on.has(id), d = v !== defaults.has(id), dis = !mine(id) || !!parentOff;
    return (
      <div className={`perm-row ${sub ? "is-sub" : ""} ${dis ? "is-dis" : ""}`}>
        <span className="perm-t">{i.label}{i.hint && <small>{i.hint}</small>}</span>
        {d && <em className="perm-diff">{v ? "เพิ่มให้คนนี้" : "ปิดให้คนนี้"}</em>}
        <button type="button" role="switch" aria-checked={v} aria-label={i.label} className="perm-sw" disabled={dis} onClick={() => toggle(id)}
          title={!mine(id) ? "บัญชีของคุณไม่มีสิทธิ์นี้ จึงให้คนอื่นไม่ได้" : parentOff ? "เปิดเมนูด้านบนก่อน" : undefined}><i aria-hidden="true" /></button>
      </div>
    );
  };

  return (
    <Modal open={!!user} wide title={`สิทธิ์การใช้งาน · ${user?.full_name ?? ""}`} onClose={onClose}
      footer={top ? <button className="btn-primary" onClick={onClose}>ปิด</button> : <>
        {(diff > 0 || !!user?.permissions) && <button className="btn-soft mr-auto" onClick={() => onSave(null)}>ใช้ค่าเริ่มต้นของตำแหน่ง</button>}
        <button className="btn-soft" onClick={onClose}>ยกเลิก</button>
        <button className="btn-primary" onClick={() => onSave([...on])}>บันทึกสิทธิ์</button>
      </>}>
      {user && <div className="space-y-4">
        <p className="text-sm text-gold-700">
          <b className="font-medium text-gold-800">{ROLE_INFO[role].th}</b> · สาขา{user.branch_name ?? "-"} ·{" "}
          {top ? "ผู้บริหารองค์กรได้ทุกสิทธิ์และเห็นทุกสาขาเสมอ" : diff ? `ต่างจากค่าเริ่มต้นของตำแหน่ง ${diff} รายการ` : "ตามค่าเริ่มต้นของตำแหน่ง"}
        </p>
        {!top && <div className="perm-grid">
          {PERM_GROUPS.filter((g) => g.items.some((i) => !SUB_IDS.has(i.id))).map((g) => (
            <section key={g.title} className="perm-box">
              <h4>{g.title.replace(/^เมนู/, "")}</h4>
              {g.items.filter((i) => !SUB_IDS.has(i.id)).map((i) => (
                <div key={i.id}>
                  <Row id={i.id} />
                  {(SUB[i.id] ?? []).map((s) => <Row key={s} id={s} sub parentOff={!on.has(i.id)} />)}
                </div>
              ))}
            </section>
          ))}
        </div>}
        {!top && <p className="text-xs leading-6 text-gold-500">สวิตช์จาง = สิทธิ์ที่บัญชีของคุณไม่มี หรือต้องเปิดเมนูด้านบนก่อน · ขอบเขตข้อมูลยังเป็นตามสาขาของบัญชี · ผู้ใช้ต้องรีเฟรชหน้าหรือเข้าสู่ระบบใหม่เพื่อเห็นเมนูที่เปลี่ยน</p>}
      </div>}
    </Modal>
  );
}
