"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";
import { useSyncStatus } from "@/lib/store";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/**
 * ติดตั้ง KinApp เป็นแอปบนมือถือ (PWA)
 * service worker ลงทะเบียนเฉพาะ production (ตอน npm run dev ไฟล์เปลี่ยนตลอด ถ้า cache ไว้จะได้หน้าเก่า)
 */
export function usePwa() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") navigator.serviceWorker.register("/sw.js").catch(() => {});
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standalone);
    setIos(/iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone);
    const onPrompt = (e: Event) => { e.preventDefault(); setPrompt(e as InstallEvent); };
    const onInstalled = () => { setInstalled(true); setPrompt(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  const install = async () => {
    if (!prompt) return false;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    setPrompt(null);
    return outcome === "accepted";
  };
  return { canInstall: !!prompt && !installed, iosHint: ios && !installed, installed, install };
}

/** แถบแจ้งสถานะ: ออฟไลน์ / กำลังส่งข้อมูลที่ค้าง */
export function OfflineBar() {
  const { online, pending } = useSyncStatus();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  if (!hydrated || (online && !pending)) return null;
  return (
    <div role="status" className={`flex items-center justify-center gap-2 px-4 py-2 text-center text-xs font-medium ${online ? "bg-amber-50 text-amber-900" : "bg-gold-800 text-white"}`}>
      <Icon name={online ? "refresh" : "alert"} className={`h-4 w-4 shrink-0 ${online ? "animate-spin" : ""}`} />
      {online
        ? `กำลังส่งข้อมูลที่บันทึกไว้ ${pending} รายการ…`
        : pending
          ? `ออฟไลน์ · บันทึกไว้ในเครื่อง ${pending} รายการ จะส่งให้อัตโนมัติเมื่อกลับมาออนไลน์`
          : "ออฟไลน์ · ใช้ข้อมูลล่าสุดในเครื่อง ยังบันทึกงานต่อได้"}
    </div>
  );
}
