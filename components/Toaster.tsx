"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { isWarning } from "@/lib/notice";

/**
 * แจ้งเตือนการทำรายการ (บันทึก แก้ไข ลบ ทำไม่ได้ รอส่ง)
 *  - สีตามการกระทำ · หัวข้อ = การกระทำ บรรทัดรอง = รายการนั้น (ข้อความแบบเดิม "หัวข้อ · รายละเอียด" แยกให้เอง)
 *  - ข้อความเดิมซ้ำภายใน 3 วินาที รวมเป็นอันเดียวพร้อมตัวนับ · แสดงพร้อมกันไม่เกิน 3 อัน
 *  - ปิดเอง 4 วินาที (ลบ 6 วินาที ให้กดเลิกทำทัน) · ชี้เมาส์/แตะค้าง แถบเวลาหยุด · คำเตือนไม่ปิดเอง
 */
export type ToastType = "ok" | "edit" | "del" | "warn" | "busy" | "off";
export type ToastAction = { label: string; run: () => void };
export type ToastInput = { type?: ToastType; title: string; detail?: string; action?: ToastAction; ms?: number };
type Item = Required<Pick<ToastInput, "title">> & { id: number; type: ToastType; detail: string; action?: ToastAction; ms: number; n: number; at: number; key: string; bar: number; out: boolean };

const DEL = /^(ลบ|ยกเลิก|ล้าง|ย้าย.*ออก|หยุด|เอาออก)/;
const EDIT = /^(แก้|อัปเดต|ย้าย|เปลี่ยน|ปรับ|ต่อสัญญา|ซ่อน|แสดง)/;
const FAIL = /(ไม่สำเร็จ|ไม่ได้|ผิดพลาด|เกินยอด|หมดอายุ)/;
/** ข้อความแบบเดิม (string) → ประเภทและหัวข้อ/รายละเอียด */
export function fromText(m: string): ToastInput {
  const s = m.trim();
  const i = s.indexOf(" · ");
  const title = i > 0 ? s.slice(0, i) : s;
  // ดูประเภทจากหัวข้อเท่านั้น (รายละเอียดอาจมีคำว่า "ไม่ได้" ในความหมายอื่น)
  const type: ToastType = isWarning(title) || FAIL.test(title) ? "warn" : DEL.test(title) ? "del" : EDIT.test(title) ? "edit" : "ok";
  return i > 0 ? { type, title, detail: s.slice(i + 3) } : { type, title };
}

const PATH: Record<ToastType, JSX.Element> = {
  ok: <path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16v4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />,
  del: <path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  warn: <><path d="M12 4l9 16H3L12 4z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><path d="M12 10v4M12 17v.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></>,
  busy: <path d="M12 3a9 9 0 1 0 9 9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />,
  off: <path d="M4 9a12 12 0 0 1 16 0M7.5 12.5a7 7 0 0 1 9 0M11 16a2 2 0 0 1 2 0M3 3l18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
};
const defaultMs = (t: ToastType) => (t === "del" ? 6000 : t === "warn" || t === "busy" || t === "off" ? 0 : 4000);

export function useToaster() {
  const [items, setItems] = useState<Item[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => {
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, out: true } : x)));
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 180);
  }, []);
  const push = useCallback((t: ToastInput) => {
    const type = t.type ?? "ok", detail = t.detail ?? "", key = `${type}|${t.title}|${detail}`, now = Date.now();
    const id = ++seq.current;
    setItems((xs) => {
      const same = xs.find((x) => x.key === key && !x.out && now - x.at < 3000);
      if (same) return xs.map((x) => (x === same ? { ...x, n: x.n + 1, at: now, bar: x.bar + 1 } : x));
      const next: Item = { id, type, title: t.title, detail, action: t.action, ms: t.ms ?? defaultMs(type), n: 1, at: now, key, bar: 0, out: false };
      return [next, ...xs.filter((x) => !x.out)].slice(0, 3);
    });
    return id;
  }, []);
  return { items, push, dismiss };
}

export function Toaster({ items, dismiss }: { items: Item[]; dismiss: (id: number) => void }) {
  return (
    <div className="toast-stack" role="region" aria-label="การแจ้งเตือน">
      {items.map((t) => <Toast key={t.id} t={t} dismiss={dismiss} />)}
    </div>
  );
}

function Toast({ t, dismiss }: { t: Item; dismiss: (id: number) => void }) {
  // ปิดเองเมื่อแถบเวลาหมด (แถบหยุดเมื่อชี้เมาส์/แตะค้าง ผ่าน CSS)
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const end = () => dismiss(t.id);
    el.addEventListener("animationend", end);
    return () => el.removeEventListener("animationend", end);
  }, [t.id, t.bar, dismiss]);
  return (
    <div className={`kin-toast is-${t.type}${t.out ? " is-out" : ""}`} role={t.type === "warn" || t.type === "off" ? "alert" : "status"}>
      <span className="kin-toast-icon"><svg viewBox="0 0 24 24" aria-hidden="true">{PATH[t.type]}</svg></span>
      <div className="kin-toast-body">
        <p className="kin-toast-title">{t.title}{t.n > 1 && <span className="kin-toast-count">×{t.n}</span>}</p>
        {t.detail && <p className="kin-toast-detail">{t.detail}</p>}
        {t.action && <button type="button" className="kin-toast-btn" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
      </div>
      <button type="button" className="kin-toast-close" aria-label="ปิดการแจ้งเตือน" onClick={() => dismiss(t.id)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
      </button>
      {t.ms > 0 && <span key={t.bar} ref={ref} className="kin-toast-bar" style={{ animationDuration: `${t.ms}ms` }} />}
    </div>
  );
}
