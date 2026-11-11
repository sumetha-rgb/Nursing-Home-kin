"use client";
import { useEffect, useState } from "react";
import { Modal } from "../ui";
import { PhysioHistory, photoUrl, vitalsText } from "@/lib/physio";

/**
 * ประวัติกายภาพทุกครั้งของคอร์ส (ระบบจัดการ): เวลาเช็คอิน/บันทึก ระยะเวลา ผู้บันทึก สัญญาณชีพ บันทึกการตรวจรักษา และรูป (โหลดเมื่อเปิด)
 *  courseId = null → ปิด · title = ชื่อผู้รับบริการ
 */
export default function PhysioHistoryModal({ courseId, title, onClose }: { courseId: string | null; title: string; onClose: () => void }) {
  const [items, setItems] = useState<PhysioHistory[] | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  useEffect(() => {
    if (!courseId) return;
    setItems(null);
    fetch(`/api/clinic?op=physio_history&course=${encodeURIComponent(courseId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)).then((x) => setItems(x?.items ?? [])).catch(() => setItems([]));
  }, [courseId]);
  return (
    <>
      <Modal open={!!courseId} wide title={`ประวัติกายภาพ · ${title}`} onClose={onClose} footer={<button className="btn-primary" onClick={onClose}>ปิด</button>}>
        {!items ? <p className="pk-empty">กำลังโหลด…</p> : items.length === 0 ? <p className="pk-empty">ยังไม่มีบันทึก</p> : (
          <ul className="pk-hist">{items.map((h) => (
            <li key={h.id}>
              <div className="pk-hist-h"><b>{h.title}</b><small>{h.at}{h.author ? ` · ${h.author}` : ""}</small></div>
              {h.checkin && <p className="pk-meta">เช็คอิน {h.checkin} · บันทึก {h.done}{h.minutes != null ? ` · ${h.minutes} นาที` : ""}</p>}
              <p className="pk-meta">{[h.pain ? `ปวด ${h.pain}` : "", h.mobility ?? "", (h.activities ?? []).join(", ")].filter(Boolean).join(" · ") || "-"}</p>
              {vitalsText(h.vitals) && <p className="pk-meta">สัญญาณชีพ: {vitalsText(h.vitals)}</p>}
              {h.cc || h.pe || h.dx ? <dl className="pk-tx">
                {h.cc && <><dt>อาการสำคัญ</dt><dd>{h.cc}</dd></>}{h.pe && <><dt>ตรวจร่างกาย</dt><dd>{h.pe}</dd></>}{h.dx && <><dt>วินิจฉัย</dt><dd>{h.dx}</dd></>}{h.plan && <><dt>แผนการรักษา</dt><dd>{h.plan}</dd></>}
              </dl> : <>{h.body && <p className="pk-hist-b">{h.body}</p>}{h.plan && <p className="pk-meta">แผน: {h.plan}</p>}</>}
              {h.visit_id && <div className="pk-thumbs">
                <button type="button" onClick={() => setZoom(photoUrl(h.visit_id!, "checkin"))}><img src={photoUrl(h.visit_id, "checkin")} alt={`รูปเช็คอิน ${h.title ?? ""}`} loading="lazy" /><span>เช็คอิน</span></button>
                {Array.from({ length: h.work_n ?? 0 }, (_, i) => <button key={i} type="button" onClick={() => setZoom(photoUrl(h.visit_id!, "work", i))}><img src={photoUrl(h.visit_id!, "work", i)} alt={`รูปงาน ${i + 1}`} loading="lazy" /><span>รูปงาน{(h.work_n ?? 0) > 1 ? ` ${i + 1}` : ""}</span></button>)}
              </div>}
            </li>
          ))}</ul>
        )}
      </Modal>
      <Modal open={!!zoom} title="รูปภาพ" onClose={() => setZoom(null)} footer={<button className="btn-primary" onClick={() => setZoom(null)}>ปิด</button>}>
        {zoom && <img src={zoom} alt="รูปกายภาพ" className="pk-zoom" />}
      </Modal>
    </>
  );
}
