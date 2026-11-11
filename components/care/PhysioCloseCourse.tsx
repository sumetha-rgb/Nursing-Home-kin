"use client";
import { useEffect, useState } from "react";
import { Modal } from "../ui";
import { useApp } from "@/lib/app";
import { useSession } from "@/lib/session";
import { thNowText } from "@/lib/physio";

/** เหตุผลที่ใช้บ่อย (กดเลือกแล้วแก้ต่อได้) */
const REASONS = ["ผู้รับบริการย้ายออก", "ญาติขอหยุดคอร์ส", "จบการรักษา อาการดีขึ้น", "เปลี่ยนเป็นคอร์สใหม่", "ส่งต่อโรงพยาบาล"];

export type CloseTarget = { id: string; name: string; used: number; total: number; resident: string; billed: boolean; team?: string };

/**
 * ปิดคอร์สกายภาพที่ใช้ไปแล้วแต่ไม่ทำต่อ (ผู้จัดการสาขา/ผู้บริหาร) · ต้องมีเหตุผล
 *  ผู้จัดการสาขา ผู้บริหาร ฝ่ายขาย/แคชเชียร์ · ครั้งที่เหลือยกเลิก · นัดและทีมถูกล้าง · ประวัติการรักษาคงไว้ · เงินคืน/ส่วนต่าง = แคชเชียร์ออกใบลดหนี้แยก
 */
export default function PhysioCloseCourse({ target, onClose, onDone }: { target: CloseTarget | null; onClose: () => void; onDone: () => void }) {
  const { toast } = useApp();
  const { user } = useSession();
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setWhy(""); }, [target?.id]);
  if (!target) return null;
  const t = target, left = t.total - t.used;
  const save = async () => {
    if (!why.trim()) return toast("กรุณาระบุเหตุผลที่ปิดคอร์ส");
    setBusy(true);
    const r = await fetch("/api/clinic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "course_close", courseId: t.id, reason: why.trim() }) }).catch(() => null);
    setBusy(false);
    const d = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) return toast(d.error || "ปิดคอร์สไม่สำเร็จ");
    toast(`ปิดคอร์ส${t.resident}แล้ว · ยกเลิก ${left} ครั้งที่เหลือ`); onDone(); onClose();
  };
  return (
    <Modal open title="ปิดคอร์สกายภาพ" onClose={onClose}
      footer={<>
        <button type="button" className="btn-soft" disabled={busy} onClick={onClose}>ไม่ปิด</button>
        <button type="button" className="btn-cancelred" disabled={busy || !why.trim()} onClick={save}>{busy ? "กำลังปิด…" : "ยืนยันปิดคอร์ส"}</button>
      </>}>
      <div className="pc-wrap">
        <div className="pc-ticket">
          <div className="pc-date"><small>ใช้ไป</small><b>{t.used}</b><span>จาก {t.total}</span></div>
          <div className="pc-info">
            <b>{t.resident}</b>
            <span>{t.name}</span>
            {t.team && <span>นักกายภาพ: {t.team}</span>}
          </div>
          <em className="pc-tag">ยกเลิก {left} ครั้ง</em>
        </div>

        <label className="block">
          <span className="pc-h">เหตุผลที่ปิดคอร์ส <b className="text-[#a3202d]">*</b></span>
          <div className="pk-chips mb-2">{REASONS.map((x) => <button key={x} type="button" aria-pressed={why === x} className={why === x ? "is-on" : ""} onClick={() => setWhy(x)}>{x}</button>)}</div>
          <input value={why} onChange={(e) => setWhy(e.target.value)} maxLength={200} placeholder="หรือพิมพ์เหตุผลเอง" aria-label="เหตุผลที่ปิดคอร์ส" />
        </label>

        <div>
          <p className="pc-h">หลังปิดคอร์ส</p>
          <ul className="pc-after">
            <li>ยกเลิก <b>{left} ครั้งที่เหลือ</b> และนัดที่วางไว้ทั้งหมด · คอร์สหายจากตารางกายภาพและคิวของนักกายภาพ</li>
            <li>ประวัติ <b>{t.used} ครั้งที่ทำไปแล้ว</b> เก็บไว้ครบ (บันทึก สัญญาณชีพ รูป) ดูได้ที่โปรไฟล์ผู้รับบริการ</li>
            <li>{t.billed ? <>คอร์สนี้ออกใบแจ้งหนี้แล้ว · ถ้าต้องคืนเงินหรือลดยอด ให้แคชเชียร์ออก<b>ใบลดหนี้</b>ที่เมนูใบแจ้งหนี้และใบเสร็จ</> : <>ยังไม่ออกใบแจ้งหนี้ · แคชเชียร์ปรับยอดตามครั้งที่ใช้จริงตอนออกใบ</>}</li>
            {t.team && <li>{t.team} ได้แจ้งเตือนบนมือถือ</li>}
            <li>บันทึกผู้ปิด <b>{user?.name ?? "-"}</b> · <b>{thNowText()}</b> ไว้กับคอร์ส (เห็นในโปรไฟล์ผู้รับบริการ) · ย้อนกลับไม่ได้</li>
          </ul>
        </div>
      </div>
    </Modal>
  );
}
