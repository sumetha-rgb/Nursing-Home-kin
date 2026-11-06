"use client";
import { useCallback, useEffect, useState } from "react";

/**
 * เปิด/ปิดแจ้งเตือนบนโทรศัพท์เครื่องนี้ (KinApp)
 * สถานะ: loading · none (เบราว์เซอร์ไม่รองรับ หรือเซิร์ฟเวอร์ยังไม่ตั้งกุญแจ) · ios (iPhone ต้องเพิ่มไปที่หน้าจอโฮมก่อน)
 *        denied (เคยกดไม่อนุญาต ต้องไปเปิดในตั้งค่าเครื่อง) · off · on
 */
export type PushState = "loading" | "none" | "ios" | "denied" | "off" | "on";

const b64 = (s: string) => {
  const p = (s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(p), (c) => c.charCodeAt(0));
};
const device = () => {
  const ua = navigator.userAgent;
  const os = /iphone|ipad|ipod/i.test(ua) ? "iPhone" : /android/i.test(ua) ? "Android" : /windows/i.test(ua) ? "Windows" : /mac/i.test(ua) ? "Mac" : "อื่น ๆ";
  const br = /edg\//i.test(ua) ? "Edge" : /chrome|crios/i.test(ua) ? "Chrome" : /firefox|fxios/i.test(ua) ? "Firefox" : /safari/i.test(ua) ? "Safari" : "";
  return [os, br].filter(Boolean).join(" · ");
};
const post = (body: unknown) => fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "บันทึกไม่สำเร็จ"); return d; });
const registration = async () => (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));

export function usePush() {
  const [state, setState] = useState<PushState>("loading");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      const ok = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!ok) { if (live) setState(ios && !standalone ? "ios" : "none"); return; }
      const k = await fetch("/api/push", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => d?.key ?? "").catch(() => "");
      if (!live) return;
      setKey(k);
      if (!k) return setState("none");
      if (Notification.permission === "denied") return setState("denied");
      const sub = Notification.permission === "granted" ? await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription() : null;
      if (!live) return;
      // เครื่องที่เปิดไว้แล้ว: ส่งข้อมูลเครื่องซ้ำ (ผูกกับบัญชีที่เข้าระบบอยู่ตอนนี้)
      if (sub) post({ op: "subscribe", sub: sub.toJSON(), device: device() }).catch(() => {});
      setState(sub ? "on" : "off");
    })();
    return () => { live = false; };
  }, []);

  /** เปิด: ขออนุญาต → ลงทะเบียนเครื่อง → ส่งแจ้งเตือนทดสอบ · คืนข้อความผลลัพธ์ */
  const enable = useCallback(async (): Promise<string> => {
    setBusy(true);
    try {
      const p = await Notification.requestPermission();
      if (p !== "granted") { setState(p === "denied" ? "denied" : "off"); return "ยังไม่ได้อนุญาตการแจ้งเตือน"; }
      const reg = await registration();
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key) }));
      await post({ op: "subscribe", sub: sub.toJSON(), device: device() });
      setState("on");
      const t = await post({ op: "test" }).catch(() => null);
      return t?.sent ? "เปิดการแจ้งเตือนแล้ว · ส่งแจ้งเตือนทดสอบให้ดูแล้ว" : "เปิดการแจ้งเตือนแล้ว";
    } catch (e) {
      const m = (e as Error).message ?? "";
      return /permission denied|not supported|incognito/i.test(m)
        ? "เบราว์เซอร์นี้รับแจ้งเตือนไม่ได้ (เช่น โหมดไม่ระบุตัวตน) · เปิด KinApp ด้วย Chrome หรือแอปที่ติดตั้งไว้"
        : `เปิดการแจ้งเตือนไม่สำเร็จ · ${m}`;
    } finally { setBusy(false); }
  }, [key]);

  const disable = useCallback(async (): Promise<string> => {
    setBusy(true);
    try {
      const sub = await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription();
      if (sub) { await post({ op: "unsubscribe", endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
      setState("off");
      return "ปิดการแจ้งเตือนในเครื่องนี้แล้ว";
    } finally { setBusy(false); }
  }, []);

  const test = useCallback(async () => {
    const t = await post({ op: "test" }).catch((e) => ({ error: (e as Error).message }));
    return t?.sent ? "ส่งแจ้งเตือนทดสอบแล้ว" : t?.error || "ส่งไม่สำเร็จ · ลองปิดแล้วเปิดการแจ้งเตือนใหม่";
  }, []);

  return { state, busy, enable, disable, test };
}
