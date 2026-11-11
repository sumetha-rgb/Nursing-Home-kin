"use client";
import { ReactNode, useLayoutEffect, useRef, useState } from "react";

/**
 * จองพื้นที่ให้กล่องที่โหลดข้อมูลทีหลัง (กันหน้าเลื่อน / CLS)
 *  ระหว่างโหลด: กล่องโครงสูงเท่าครั้งล่าสุดที่เห็นในเครื่องนี้ (จำไว้ใน localStorage · ครั้งแรกใช้ fallback)
 *  โหลดเสร็จ: แสดงเนื้อหาจริงแล้ววัดความสูงเก็บไว้ใช้ครั้งถัดไป · อ่าน/เขียน localStorage ไม่ได้ = ใช้ fallback
 */
export default function Reserve({ id, loading, fallback, label, children }: { id: string; loading: boolean; fallback: number; label: string; children: ReactNode }) {
  const key = `kin.h.${id}`;
  const [h, setH] = useState(fallback);
  const ref = useRef<HTMLDivElement>(null);
  // ก่อนวาดครั้งแรก: ใช้ความสูงที่จำไว้ (ไม่มีจังหวะเตี้ยแล้วสูง)
  useLayoutEffect(() => {
    try { const v = Number(localStorage.getItem(key)); if (v > 40 && v < 3000) setH(v); } catch { /* ใช้ fallback */ }
  }, [key]);
  useLayoutEffect(() => {
    if (loading || !ref.current) return;
    const v = Math.round(ref.current.offsetHeight);
    if (v > 0) try { localStorage.setItem(key, String(v)); } catch { /* ไม่จำก็ได้ */ }
  });
  if (loading) return <div className="reserve-skel" style={{ minHeight: h }} role="status" aria-busy="true"><span>{label}</span></div>;
  return <div ref={ref}>{children}</div>;
}
