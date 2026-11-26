"use client";
import { useEffect, useState } from "react";
import { NOTES_SHOWN, notesFor, RELEASE, type Release } from "@/lib/releaseNotes";
import { useSession } from "@/lib/session";

/** เวอร์ชันของหน้าเว็บนี้ (ฝังตอน build · next.config.mjs) */
const MINE = process.env.NEXT_PUBLIC_BUILD_ID ?? "";
const EVERY = 5 * 60 * 1000;

/**
 * แจ้ง "มีเวอร์ชันใหม่" หลัง deploy (ระบบจัดการ KinApp และแอปจัดยา) · ไม่บังหัวหน้าจอ
 *  คอม = มุมล่างซ้าย (การแจ้งเตือนอื่นอยู่มุมขวาบน) · มือถือ = เหนือแถบเมนูล่าง · แถวเดียว กด "มีอะไรใหม่" จึงเปิดรายการ
 *  ตรวจกับ /api/version ทุก 5 นาที และทุกครั้งที่กลับมาเปิดแอป/แท็บ · อัปเดต = โหลดหน้าใหม่ (รายการที่ยังส่งไม่ถึงเก็บในเครื่อง ส่งต่อหลังโหลด)
 *  × = ซ่อนไว้ เตือนอีกครั้งรอบตรวจถัดไป · ตอนพัฒนา (next dev) ไม่ตรวจ ยกเว้นเปิดดูตัวอย่างด้วย ?preview-update
 *  รายการกรองตามตำแหน่งของผู้ใช้ (lib/releaseNotes for) · ไม่มีเรื่องของตำแหน่งนี้ = ไม่ขึ้นแถบ · แสดงไม่เกิน NOTES_SHOWN เรื่อง ที่เหลือกด ดูอีก N เรื่อง
 *  เปิดแอปครั้งแรกหลังมีเวอร์ชันใหม่ (รวมเข้าสู่ระบบใหม่) = "อัปเดตแล้ว · มีอะไรใหม่" 1 ครั้งต่อเครื่องต่อเวอร์ชัน (จำในเครื่อง) · ?preview-updated = ดูตัวอย่าง
 */
const SEEN = "kin.seen-build";
export default function UpdateBar() {
  const [fresh, setFresh] = useState(false);
  const [notes, setNotes] = useState<Release | null>(null);
  const [all, setAll] = useState(false);
  const [path, setPath] = useState("");
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  const [app, setApp] = useState(false);
  /** เพิ่งอัปเดตเป็นเวอร์ชันนี้ (ยังไม่เคยเห็นในเครื่องนี้) */
  const [just, setJust] = useState(false);
  useEffect(() => {
    setApp(/^\/(staff|pharmacy)/.test(window.location.pathname)); setPath(window.location.pathname);
    // อัปเดตแล้ว: เวอร์ชันนี้ยังไม่เคยแสดงในเครื่องนี้ → บอกมีอะไรใหม่ 1 ครั้ง
    const q = new URLSearchParams(window.location.search), dev = process.env.NODE_ENV !== "production";
    const previewJust = dev && q.has("preview-updated");
    let seenTimer: ReturnType<typeof setTimeout> | undefined;
    // มีเรื่องของแอปนี้สำหรับตำแหน่งใดก็ได้ (กรองตามตำแหน่งตอนแสดง เมื่อรู้ว่าใครเข้าสู่ระบบ)
    if ((MINE || previewJust) && notesFor(RELEASE, window.location.pathname, "Global Admin").length) {
      let seen: string | null = null;
      try { seen = localStorage.getItem(SEEN); } catch { seen = MINE; }
      if (previewJust || seen !== MINE) {
        setNotes(RELEASE); setJust(true);
        // แสดงแล้ว 20 วินาที = ถือว่าเห็นแล้ว (เปิดแอปครั้งถัดไปไม่ขึ้นซ้ำ แม้ไม่ได้กด ×)
        seenTimer = setTimeout(() => { try { if (MINE) localStorage.setItem(SEEN, MINE); } catch { /* ไม่จำก็ได้ */ } }, 20_000);
      }
    }
    const preview = dev && q.has("preview-update");
    if (!preview && (dev || !MINE)) return () => clearTimeout(seenTimer);
    let busy = false;
    const check = async () => {
      if (busy || document.visibilityState !== "visible" || !navigator.onLine) return;
      busy = true;
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        const d = r.ok ? ((await r.json()) as { v?: string; notes?: Release }) : null;
        if (preview || (d?.v && d.v !== MINE)) {
          setNotes(d?.notes ?? null);
          setFresh(true);
        }
      } catch { /* ออฟไลน์ / เครือข่ายช้า: ลองใหม่รอบหน้า */ }
      finally { busy = false; }
    };
    if (preview) check();
    const t = setInterval(check, EVERY);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
    return () => { clearTimeout(seenTimer); clearInterval(t); document.removeEventListener("visibilitychange", check); window.removeEventListener("online", check); };
  }, []);
  const seenNow = () => { try { if (MINE) localStorage.setItem(SEEN, MINE); } catch { /* ไม่จำก็ได้ */ } };
  const items = notesFor(notes, path, user?.role);
  // อัปเดตแล้ว แต่ไม่มีเรื่องของตำแหน่งนี้ = ไม่ขึ้นแถบ (มีเวอร์ชันใหม่ยังขึ้นให้กดอัปเดต)
  if (!fresh && (!just || !items.length)) return null;
  const shown = all ? items : items.slice(0, NOTES_SHOWN);
  return (
    <div className={`update-bar ${app ? "is-app" : ""} ${open ? "is-open" : ""}`} role="status">
      {open && items.length > 0 && <div className="update-list" id="update-list">
        <p>มีอะไรใหม่{notes?.date ? ` · ${notes.date}` : ""}</p>
        <ul>{shown.map((x) => <li key={x}>{x}</li>)}</ul>
        {items.length > shown.length && <button type="button" className="update-all" onClick={() => setAll(true)}>ดูอีก {items.length - shown.length} เรื่อง ›</button>}
        <small>อัปเดตแล้วข้อมูลที่กรอกไว้ไม่หาย</small>
      </div>}
      <div className="update-row">
        <span className="update-dot" aria-hidden="true" />
        <b className="update-title">{fresh ? "มีเวอร์ชันใหม่" : "อัปเดตแล้ว"}{notes?.date ? <small> · {notes.date}</small> : null}</b>
        {items.length > 0 && <button type="button" className="update-more" aria-expanded={open} aria-controls="update-list" onClick={() => { setOpen(!open); setAll(false); }}>{open ? "ซ่อน" : `มีอะไรใหม่ ${items.length}`}</button>}
        {fresh && <button type="button" className="update-go" onClick={() => { seenNow(); window.location.reload(); }}>อัปเดต</button>}
        <button type="button" className="update-later" aria-label={fresh ? "ไว้ทีหลัง" : "ปิด"} title={fresh ? "ไว้ทีหลัง (เตือนอีกครั้งภายหลัง)" : "ปิด (ไม่แสดงอีกจนกว่าจะมีเวอร์ชันใหม่)"} onClick={() => { if (!fresh) seenNow(); setFresh(false); setJust(false); setOpen(false); }}>×</button>
      </div>
    </div>
  );
}
