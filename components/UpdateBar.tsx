"use client";
import { useEffect, useState } from "react";

/** เวอร์ชันของหน้าเว็บนี้ (ฝังตอน build · next.config.mjs) */
const MINE = process.env.NEXT_PUBLIC_BUILD_ID ?? "";
const EVERY = 5 * 60 * 1000;

/**
 * แถบ "มีเวอร์ชันใหม่ · แตะเพื่ออัปเดต" หลัง deploy (ทั้งระบบจัดการ KinApp และแอปจัดยา)
 *  ตรวจกับ /api/version ทุก 5 นาที และทุกครั้งที่กลับมาเปิดแอป/แท็บ · แตะ = โหลดหน้าใหม่ (รายการที่ยังส่งไม่ถึงเก็บในเครื่อง ส่งต่อหลังโหลด)
 *  "ภายหลัง" = ซ่อนไว้ แล้วเตือนอีกครั้งตอนตรวจรอบถัดไป · ตอนพัฒนา (next dev) ไม่ตรวจ
 */
export default function UpdateBar() {
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !MINE) return;
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== "visible" || !navigator.onLine) return;
      busy = true;
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        const d = r.ok ? await r.json() : null;
        if (d?.v && d.v !== MINE) setFresh(true);
      } catch { /* ออฟไลน์ / เครือข่ายช้า: ลองใหม่รอบหน้า */ }
      finally { busy = false; }
    };
    const t = setInterval(check, EVERY);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", check); window.removeEventListener("online", check); };
  }, []);
  if (!fresh) return null;
  return (
    <div className="update-bar" role="status">
      <span className="update-dot" aria-hidden="true" />
      <span className="update-text"><b>มีเวอร์ชันใหม่ของระบบ</b><small>แตะอัปเดต ข้อมูลที่กรอกไว้ไม่หาย</small></span>
      <button type="button" className="update-go" onClick={() => window.location.reload()}>อัปเดตเลย</button>
      <button type="button" className="update-later" onClick={() => setFresh(false)}>ภายหลัง</button>
    </div>
  );
}
