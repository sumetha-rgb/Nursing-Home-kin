"use client";
import { useEffect, useRef } from "react";
import { isIdle } from "./store";

/**
 * ดึงข้อมูลใหม่เป็นระยะ และเมื่อกลับมาที่หน้าต่าง (หน้าที่โหลดข้อมูลเองนอกชุดข้อมูลหลัก)
 * ไม่ดึงตอนซ่อนหน้าต่างหรือไม่ได้ใช้งานนาน · เรียกฟังก์ชันล่าสุดเสมอ ไม่ต้องห่อ useCallback
 */
export function useAutoRefresh(load: () => void, ms = 60_000) {
  const fn = useRef(load);
  fn.current = load;
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible" && !isIdle()) fn.current(); }, ms);
    const onFocus = () => fn.current();
    window.addEventListener("focus", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, [ms]);
}
