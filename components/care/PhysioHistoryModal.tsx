"use client";
import { useEffect, useState } from "react";
import { Modal } from "../ui";
import Icon from "../Icon";
import { PhysioHistory } from "@/lib/physio";
import PhysioRecordModal, { RecordTarget } from "./PhysioRecord";
import PhysioSessions from "./PhysioSessions";
import { CourseInfo, PhysioProgress, PhysioSummaryDoc } from "./PhysioProgress";

/**
 * ประวัติกายภาพทุกครั้งของคอร์ส (ระบบจัดการ): กราฟความก้าวหน้า (ปวด · ADL) · เวลาเช็คอิน/บันทึก ระยะเวลา ผู้บันทึก สัญญาณชีพ บันทึกการตรวจรักษา และรูป (โหลดเมื่อเปิด)
 *  ปุ่ม "สรุปผลจบคอร์ส" = เอกสารพิมพ์ให้ญาติ (ครั้งแรกเทียบล่าสุด + คำแนะนำ)
 *  courseId = null → ปิด · title = ชื่อผู้รับบริการ
 */
export default function PhysioHistoryModal({ courseId, title, onClose }: { courseId: string | null; title: string; onClose: () => void }) {
  const [items, setItems] = useState<PhysioHistory[] | null>(null);
  const [course, setCourse] = useState<CourseInfo | null>(null);
  const [edT, setEdT] = useState<RecordTarget | null>(null);
  const [sum, setSum] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!courseId) { setSum(false); return; }
    setItems(null);
    fetch(`/api/clinic?op=physio_history&course=${encodeURIComponent(courseId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)).then((x) => { setItems(x?.items ?? []); setCourse(x?.course ?? null); }).catch(() => setItems([]));
  }, [courseId, tick]);
  const done = !!course && course.used >= course.total;
  return (
    <>
      <Modal open={!!courseId && !sum} wide title={`ประวัติกายภาพ · ${title}`} onClose={onClose}
        footer={<>
          {!!items?.length && course && <button className={done ? "btn-primary" : "btn-soft"} onClick={() => setSum(true)}><Icon name="print" className="h-4 w-4" /> สรุปผล{done ? "จบคอร์ส" : "ถึงตอนนี้"}</button>}
          <button className={items?.length && course && done ? "btn-soft" : "btn-primary"} onClick={onClose}>ปิด</button>
        </>}>
        {!!items?.length && <PhysioProgress items={items} />}
        <PhysioSessions items={items} empty="ยังไม่มีบันทึก" onEdit={(h) => setEdT({ courseId: courseId ?? "", courseName: h.title ?? "", used: 0, total: 0, residentName: title, edit: h })} />
      </Modal>
      <Modal open={!!courseId && sum} wide title={`สรุปผลการทำกายภาพ · ${title}`} onClose={() => setSum(false)}
        footer={<><button className="btn-soft" onClick={() => setSum(false)}>กลับไปดูประวัติ</button><button className="btn-primary" onClick={() => window.print()}><Icon name="print" className="h-4 w-4" /> พิมพ์ให้ญาติ</button></>}>
        {items && course && <PhysioSummaryDoc items={items} course={course} />}
      </Modal>
      <PhysioRecordModal target={edT} onClose={() => setEdT(null)} onSaved={() => { setEdT(null); setTick((n) => n + 1); }} />
    </>
  );
}
