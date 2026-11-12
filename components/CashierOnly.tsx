"use client";
import { useEffect, useRef } from "react";
import { APPS, AppId, appsFor, fallbackApp, openApp } from "@/lib/apps";
import type { SessionUser } from "@/lib/roles";

/**
 * เปิดแอปที่บัญชีนี้ไม่มีสิทธิ์ (เช่น พยาบาลเปิดระบบจัดการ แคชเชียร์เปิด KinApp)
 * → พาไปแอปที่ใช้ได้ให้เอง (แอปที่ใช้ล่าสุดในเครื่องนี้ หรือแอปที่เหมาะกับจอ) · ไม่มีสิทธิ์แอปใดเลย = บอกให้ติดต่อผู้จัดการสาขา
 */
export default function CashierOnly({ user, app, onLogout }: { user: SessionUser; app: AppId; onLogout: () => void }) {
  const apps = appsFor(user).filter((a) => a !== app);
  const target = fallbackApp(apps);
  const gone = useRef(false); // ไปครั้งเดียว (React โหมดพัฒนาเรียก effect ซ้ำ)
  useEffect(() => { if (target && !gone.current) { gone.current = true; openApp(target, { replace: true, hint: apps.length > 1 }); } }, [target, apps.length]);
  if (target) return <main className="grid min-h-dvh place-items-center px-5 text-sm text-gold-500" role="status">กำลังเปิด {APPS[target].name}…</main>;
  return (
    <main className="grid min-h-dvh place-items-center px-5">
      <section className="card w-full max-w-md p-8 text-center">
        <p className="kicker justify-center">KIN CARE</p>
        <h1 className="mt-3 text-2xl font-medium text-gold-800">สวัสดี {user.name}</h1>
        <p className="mt-3 text-sm leading-7 text-gold-600">บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้แอปใดเลย ติดต่อผู้จัดการสาขาให้ติ๊กสิทธิ์ที่เมนูทีมและสิทธิ์การใช้งาน แล้วเข้าสู่ระบบอีกครั้ง</p>
        <button className="btn-primary mt-6 w-full" onClick={onLogout}>ออกจากระบบ</button>
      </section>
    </main>
  );
}
