"use client";
import { useEffect, useRef } from "react";

/**
 * รับแจ้งเตือนมือถือ (public/sw.js ส่งต่อมาให้หน้าที่เปิดอยู่) แล้วดึงข้อมูลใหม่ทันที · ไม่ต้องรอรอบดึงทุก 1 นาที
 *  match(tag) = แจ้งเตือนเรื่องไหนที่หน้านี้สนใจ เช่น tag ขึ้นต้น "physio"
 *  เครื่องที่ไม่มี service worker / ไม่เปิดรับแจ้งเตือน = ไม่ทำอะไร (ยังดึงตามรอบปกติ)
 */
export function usePushRefresh(match: (tag: string) => boolean, run: () => void) {
  const fn = useRef(run), ok = useRef(match);
  fn.current = run; ok.current = match;
  useEffect(() => {
    const sw = typeof navigator !== "undefined" ? navigator.serviceWorker : undefined;
    if (!sw) return;
    const on = (e: MessageEvent) => {
      const d = e.data as { type?: string; tag?: string } | null;
      if (d?.type === "kin-push" && ok.current(String(d.tag ?? ""))) fn.current();
    };
    sw.addEventListener("message", on);
    return () => sw.removeEventListener("message", on);
  }, []);
}
