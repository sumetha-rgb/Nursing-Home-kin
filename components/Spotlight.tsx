"use client";
import { useEffect } from "react";

/** แสงตามเมาส์บนการ์ด (แบบ Spotlight Card) ตั้งค่า --mx / --my ให้การ์ดที่ชี้อยู่ ใช้ได้ทุกหน้า */
const TARGET = ".card, .metric, .shortcut-card, .branch-card, .mobile-data-row";

export default function Spotlight() {
  useEffect(() => {
    if (!window.matchMedia("(hover: hover)").matches) return;
    const move = (e: PointerEvent) => {
      const el = (e.target as Element | null)?.closest?.(TARGET) as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
    };
    document.addEventListener("pointermove", move, { passive: true });
    return () => document.removeEventListener("pointermove", move);
  }, []);
  return null;
}
