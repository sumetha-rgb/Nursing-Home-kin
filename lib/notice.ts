"use client";
import { useSyncExternalStore } from "react";

/**
 * ข้อความเตือนในหน้าต่าง (popup) ที่เปิดอยู่บนสุด
 * toast() ที่เป็นคำเตือน เช่น "กรุณาถ่ายรูป…" ตอนมี popup เปิด จะแสดงเป็นตัวหนังสือสีแดงใน popup นั้น
 * แทนการลอยไว้ด้านล่างจอ (ซึ่งถูก popup บังจนมองไม่เห็น)
 */
let stack: number[] = [];
let message: string | null = null;
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** ข้อความที่เป็นคำเตือน / ข้อบังคับก่อนบันทึก */
export const isWarning = (m: string) => /^(กรุณา|ต้อง|ไม่สามารถ|ไม่พบ|ยังไม่|มี.*แล้ว|รหัสผ่าน.*ไม่)/.test(m.trim());

export function openModal() { const id = ++seq; stack = [...stack, id]; message = null; emit(); return id; }
export function closeModal(id: number) { stack = stack.filter((x) => x !== id); message = null; emit(); }
export const hasModal = () => stack.length > 0;
export function showNotice(m: string) { message = m; emit(); }
export function clearNotice() { if (message !== null) { message = null; emit(); } }

/** ข้อความเตือนของ popup นี้ (เฉพาะ popup บนสุด) */
export function useNotice(id: number | null) {
  return useSyncExternalStore(subscribe, () => (id !== null && stack[stack.length - 1] === id ? message : null), () => null);
}
