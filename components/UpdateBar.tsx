"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { notesFor, type Release } from "@/lib/releaseNotes";

/** เวอร์ชันของหน้าเว็บนี้ (ฝังตอน build · next.config.mjs) */
const MINE = process.env.NEXT_PUBLIC_BUILD_ID ?? "";
const EVERY = 5 * 60 * 1000;

/**
 * แถบ "มีเวอร์ชันใหม่ · แตะเพื่ออัปเดต" หลัง deploy (ทั้งระบบจัดการ KinApp และแอปจัดยา)
 *  ตรวจกับ /api/version ทุก 5 นาที และทุกครั้งที่กลับมาเปิดแอป/แท็บ · แตะ = โหลดหน้าใหม่ (รายการที่ยังส่งไม่ถึงเก็บในเครื่อง ส่งต่อหลังโหลด)
 *  บอก "มีอะไรใหม่" จากเวอร์ชันใหม่ (2 ข้อแรก + กดดูทั้งหมด) เฉพาะเรื่องของแอปที่เปิดอยู่
 *  "ภายหลัง" = ซ่อนไว้ แล้วเตือนอีกครั้งตอนตรวจรอบถัดไป · ตอนพัฒนา (next dev) ไม่ตรวจ ยกเว้นเปิดดูตัวอย่างด้วย ?preview-update
 *  แถบแสดงอยู่: ตั้ง html[data-update] + --update-bottom ให้กล่องแนะนำของ KinApp เลื่อนลงใต้แถบ (ไม่ซ้อนกัน)
 */
export default function UpdateBar() {
  const [fresh, setFresh] = useState(false);
  const [notes, setNotes] = useState<{ date: string; items: string[] } | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const preview = process.env.NODE_ENV !== "production" && window.location.search.includes("preview-update");
    if (!preview && (process.env.NODE_ENV !== "production" || !MINE)) return;
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== "visible" || !navigator.onLine) return;
      busy = true;
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        const d = r.ok ? ((await r.json()) as { v?: string; notes?: Release }) : null;
        if (preview || (d?.v && d.v !== MINE)) {
          const items = notesFor(d?.notes, window.location.pathname);
          setNotes(d?.notes ? { date: d.notes.date, items } : null);
          setFresh(true);
        }
      } catch { /* ออฟไลน์ / เครือข่ายช้า: ลองใหม่รอบหน้า */ }
      finally { busy = false; }
    };
    if (preview) check();
    const t = setInterval(check, EVERY);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", check); window.removeEventListener("online", check); };
  }, []);
  // บอกหน้าอื่นว่าแถบแสดงอยู่ และขอบล่างของแถบอยู่ตรงไหน (กล่องแนะนำ KinApp เลื่อนลงตาม)
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!fresh || !ref.current) { delete root.dataset.update; root.style.removeProperty("--update-bottom"); return; }
    const set = () => { if (ref.current) root.style.setProperty("--update-bottom", `${Math.round(ref.current.getBoundingClientRect().bottom)}px`); };
    root.dataset.update = "1"; set();
    // วัดใหม่เมื่อขนาดเปลี่ยน และหลังแอนิเมชันเลื่อนเข้าจบ (ตอนแรกแถบยังเลื่อนไม่สุด)
    const el = ref.current, ro = new ResizeObserver(set); ro.observe(el);
    el.addEventListener("animationend", set); const t = setTimeout(set, 350);
    return () => { ro.disconnect(); el.removeEventListener("animationend", set); clearTimeout(t); delete root.dataset.update; root.style.removeProperty("--update-bottom"); };
  }, [fresh, open]);
  if (!fresh) return null;
  const items = notes?.items ?? [];
  const brief = items.length ? `${items.slice(0, 2).join(" · ")}${items.length > 2 ? ` · และอีก ${items.length - 2} เรื่อง` : ""}` : "แตะอัปเดต ข้อมูลที่กรอกไว้ไม่หาย";
  return (
    <div className="update-bar" role="status" ref={ref}>
      <div className="update-row">
        <span className="update-dot" aria-hidden="true" />
        <span className="update-text"><b>มีเวอร์ชันใหม่{notes?.date ? ` · ${notes.date}` : "ของระบบ"}</b><small>{brief}</small></span>
        <button type="button" className="update-go" onClick={() => window.location.reload()}>อัปเดตเลย</button>
        <button type="button" className="update-later" onClick={() => { setFresh(false); setOpen(false); }}>ภายหลัง</button>
      </div>
      {items.length > 0 && <>
        <button type="button" className="update-more" aria-expanded={open} aria-controls="update-list" onClick={() => setOpen(!open)}>{open ? "ซ่อนรายการ ▴" : "ดูว่ามีอะไรใหม่ ▾"}</button>
        {open && <ul className="update-list" id="update-list">{items.map((x) => <li key={x}>{x}</li>)}<li className="is-note">อัปเดตแล้วข้อมูลที่กรอกไว้ไม่หาย</li></ul>}
      </>}
    </div>
  );
}
