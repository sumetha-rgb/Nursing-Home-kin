"use client";
import { useEffect, useState } from "react";
import { Modal } from "../ui";
import { PhysioHistory } from "@/lib/physio";
import PhysioRecordModal, { RecordTarget } from "./PhysioRecord";
import PhysioSessions from "./PhysioSessions";

/**
 * ประวัติกายภาพทุกครั้งของคอร์ส (ระบบจัดการ): เวลาเช็คอิน/บันทึก ระยะเวลา ผู้บันทึก สัญญาณชีพ บันทึกการตรวจรักษา และรูป (โหลดเมื่อเปิด)
 *  courseId = null → ปิด · title = ชื่อผู้รับบริการ
 */
export default function PhysioHistoryModal({ courseId, title, onClose }: { courseId: string | null; title: string; onClose: () => void }) {
  const [items, setItems] = useState<PhysioHistory[] | null>(null);
  const [edT, setEdT] = useState<RecordTarget | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!courseId) return;
    setItems(null);
    fetch(`/api/clinic?op=physio_history&course=${encodeURIComponent(courseId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)).then((x) => setItems(x?.items ?? [])).catch(() => setItems([]));
  }, [courseId, tick]);
  return (
    <>
      <Modal open={!!courseId} wide title={`ประวัติกายภาพ · ${title}`} onClose={onClose} footer={<button className="btn-primary" onClick={onClose}>ปิด</button>}>
        <PhysioSessions items={items} empty="ยังไม่มีบันทึก" onEdit={(h) => setEdT({ courseId: courseId ?? "", courseName: h.title ?? "", used: 0, total: 0, residentName: title, edit: h })} />
      </Modal>
      <PhysioRecordModal target={edT} onClose={() => setEdT(null)} onSaved={() => { setEdT(null); setTick((n) => n + 1); }} />
    </>
  );
}
