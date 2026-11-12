"use client";
import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { APPS, AppId, appsFor, clearHint, hasHint, openApp, rememberApp } from "@/lib/apps";
import type { SessionUser } from "@/lib/roles";

/** คนนี้เคยกดปุ่มแอปหรือกดรับทราบแล้วในเครื่องนี้ (แยกตามบัญชี: เครื่องที่ใช้ร่วมกัน คนใหม่ยังเห็นป้าย) */
const seenKey = (uid: string) => `kin-app-sw-seen:${uid}`;
const seen = (uid: string) => { try { return localStorage.getItem(seenKey(uid)) === "1"; } catch { return true; } };
const markSeen = (uid: string) => { try { localStorage.setItem(seenKey(uid), "1"); } catch { /* โหมดส่วนตัว */ } };

/**
 * ปุ่ม "แอป" มุมขวาบน (ตำแหน่งเดียวกันทั้ง 3 แอป) · กดแล้วเห็นเฉพาะแอปที่บัญชีนี้ใช้ได้
 * ใช้ได้แอปเดียว = ไม่แสดงปุ่ม · ทุกครั้งที่เปิดแอป จำไว้เป็น "แอปที่ใช้ล่าสุด" ของเครื่องนี้
 * คนที่ยังไม่เคยกด: ปุ่มมีจุดแดง + ป้ายอธิบายว่าปุ่มนี้ทำอะไร · ขึ้นจนกว่าจะกดปุ่มแอปหรือกดรับทราบครั้งแรก แล้วไม่ขึ้นอีก (ต่อคน ต่อเครื่อง)
 */
export default function AppSwitcher({ user, current, compact = false }: { user: SessionUser; current: AppId; compact?: boolean }) {
  const apps = appsFor(user);
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState(false);
  const [routed, setRouted] = useState(false);
  const [fresh, setFresh] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const many = apps.length > 1;
  useEffect(() => {
    rememberApp(current);
    if (!many) return;
    const isNew = !seen(user.id);
    setFresh(isNew);
    setRouted(hasHint(current));
    if (!isNew) { clearHint(); return; }
    // รอหน้าแอปโหลดก่อน · ถ้ามีป้ายแนะนำอื่นของแอปค้างอยู่ (เช่น KinApp "ปุ่มชื่อของคุณ") รอให้ปิดก่อนค่อยขึ้น ไม่ซ้อนป้าย
    let t = 0;
    const tick = () => { if (document.querySelector(".ka-coach")) t = window.setTimeout(tick, 800); else { clearHint(); setHint(true); } };
    t = window.setTimeout(tick, 1200);
    return () => clearTimeout(t);
  }, [current, many, user.id]);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, [open]);
  if (!many) return null;
  const done = () => { setHint(false); setFresh(false); markSeen(user.id); };
  return (
    <div className={`app-sw ${compact ? "is-compact" : ""}`} ref={box}>
      <button type="button" className={`app-sw-btn ${compact ? "is-compact" : ""}`} aria-haspopup="menu" aria-expanded={open}
        aria-label={`สลับแอป · ตอนนี้อยู่ ${APPS[current].name}`} title="สลับไปแอปอื่น (ระบบจัดการ · KinApp · ห้องยา)"
        onClick={() => { setOpen(!open); done(); }}>
        <Icon name="grid" className="h-[18px] w-[18px]" /><span>แอป</span>
        {fresh && <i className="app-sw-new" aria-hidden />}
      </button>
      {hint && !open && (
        <div className="app-sw-hint" role="status">
          <p><b>ใหม่ · ปุ่มแอป</b><br />{routed && <>เปิด {APPS[current].name} ให้แล้ว (แอปที่คุณใช้ล่าสุด) · </>}บัญชีของคุณใช้ได้ {apps.length} แอป ({apps.map((a) => APPS[a].name).join(" · ")}) กดปุ่มนี้เพื่อไปอีกแอปได้เลย ไม่ต้องเข้าสู่ระบบใหม่</p>
          <div className="app-sw-hint-act">
            <button type="button" onClick={done}>รับทราบ</button>
            <button type="button" className="is-main" onClick={() => { setOpen(true); done(); }}>ลองเปิดดู</button>
          </div>
        </div>
      )}
      {open && (
        <div className="app-sw-pop" role="menu" aria-label="สลับแอป">
          <div className="app-sw-head">
            <b>สลับแอป</b>
            <p>บัญชีเดียวใช้ได้ {apps.length} แอป · กดเพื่อไปอีกแอปได้เลย ไม่ต้องเข้าสู่ระบบใหม่</p>
          </div>
          {apps.map((id) => {
            const a = APPS[id], here = id === current;
            return (
              <button key={id} type="button" role="menuitem" className={`app-sw-row ${here ? "is-here" : ""}`} aria-current={here ? "page" : undefined}
                onClick={() => { setOpen(false); if (!here) openApp(id); }}>
                <span className="app-sw-ic"><Icon name={a.icon} className="h-5 w-5" /></span>
                <span className="min-w-0"><b>{a.name}<i>{a.fit}</i></b><small>{a.desc}</small></span>
                {here ? <em>อยู่ที่นี่</em> : <span className="app-sw-go">เปิด<Icon name="arrow" className="h-3.5 w-3.5" /></span>}
              </button>
            );
          })}
          <p className="app-sw-foot">เข้าสู่ระบบเป็น <b>{user.name}</b></p>
        </div>
      )}
    </div>
  );
}
