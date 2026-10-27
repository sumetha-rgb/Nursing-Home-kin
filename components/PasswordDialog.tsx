"use client";
import { useState } from "react";
import { Field, Modal } from "./ui";
import { useApp } from "@/lib/app";
import { api } from "@/lib/session";

/** เปลี่ยนรหัสผ่านของบัญชีที่ล็อกอินอยู่ (ต้องยืนยันรหัสผ่านเดิม) */
export default function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useApp();
  const [p, setP] = useState({ current: "", next: "", confirm: "" });
  const [busy, setBusy] = useState(false);
  const done = () => { setP({ current: "", next: "", confirm: "" }); onClose(); };
  const save = async () => {
    if (p.next.length < 8) return toast("รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร");
    if (p.next !== p.confirm) return toast("รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน");
    setBusy(true);
    try { await api.changePassword(p.current, p.next); done(); toast("เปลี่ยนรหัสผ่านเรียบร้อย"); }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={open} title="เปลี่ยนรหัสผ่าน" onClose={done}
      footer={<><button className="btn-soft" onClick={done}>ยกเลิก</button><button className="btn-primary" disabled={busy} onClick={save}>{busy ? "กำลังบันทึก…" : "บันทึกรหัสผ่านใหม่"}</button></>}>
      <div className="space-y-4">
        <Field label="รหัสผ่านปัจจุบัน" required><input type="password" autoComplete="current-password" value={p.current} onChange={(e) => setP({ ...p, current: e.target.value })} /></Field>
        <Field label="รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)" required><input type="password" autoComplete="new-password" value={p.next} onChange={(e) => setP({ ...p, next: e.target.value })} /></Field>
        <Field label="ยืนยันรหัสผ่านใหม่" required><input type="password" autoComplete="new-password" value={p.confirm} onChange={(e) => setP({ ...p, confirm: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
