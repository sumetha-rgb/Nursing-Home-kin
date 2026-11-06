"use client";
import { ReactNode, useRef, useState } from "react";
import Icon from "./Icon";
import { PhotoKind, savePhoto, usePhotos } from "@/lib/photos";

/** อักษรย่อจากชื่อ (ตัดคำนำหน้า) */
export const initialsOf = (name: string) => {
  const w = name.replace(/^(คุณ|นางสาว|นาย|นาง|น\.ส\.|พว\.|ด\.ช\.|ด\.ญ\.)\s*/, "").replace(/\s*\(.*\)\s*$/, "").trim().split(/\s+/);
  // สระหน้า (เ แ โ ใ ไ) ไม่ใช่อักษรแรกที่อ่าน: ใช้ตัวถัดไป · 2 ตัวอักษร = ชื่อ + นามสกุล
  const c = (x = "") => (/^[เแโใไ]/.test(x) ? x.charAt(1) : x.charAt(0));
  return (c(w[0]) + (w[1] ? c(w[1]) : "")) || name.charAt(0) || "?";
};

/** รูปโปรไฟล์วงกลม · ไม่มีรูป = อักษรย่อ */
export function Avatar({ kind, id, name, size = 40, className = "" }: { kind: PhotoKind; id?: string | null; name: string; size?: number; className?: string }) {
  const url = usePhotos(kind)(id);
  return (
    <span className={`avatar ${className}`} style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }} aria-hidden="true">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt="" loading="lazy" /> : initialsOf(name)}
    </span>
  );
}

/**
 * รูปใหญ่พร้อมปุ่มเปลี่ยนรูป (ถ่ายใหม่หรือเลือกจากเครื่อง) · ลบรูปได้
 * onDone = ข้อความแจ้งผล (ใส่ toast)
 */
export function AvatarEdit({ kind, id, name, size = 88, onDone, title }: { kind: PhotoKind; id: string; name: string; size?: number; onDone: (msg: string) => void; title?: ReactNode }) {
  const url = usePhotos(kind)(id);
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const run = async (f: File | null) => {
    setBusy(true);
    try { onDone(await savePhoto(kind, id, f)); } catch (e) { onDone((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="avatar-edit">
      <button type="button" className="avatar-edit-pic" style={{ width: size, height: size }} disabled={busy} onClick={() => input.current?.click()} aria-label={`เปลี่ยนรูปของ ${name}`}>
        <Avatar kind={kind} id={id} name={name} size={size} />
        <span className="avatar-edit-cam"><Icon name="camera" className="h-4 w-4" /></span>
      </button>
      <div className="avatar-edit-a">
        {title}
        <button type="button" disabled={busy} onClick={() => input.current?.click()}>{busy ? "กำลังบันทึก…" : url ? "เปลี่ยนรูป" : "เพิ่มรูป"}</button>
        {url && <button type="button" className="is-del" disabled={busy} onClick={() => run(null)}>ลบรูป</button>}
      </div>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) run(f); }} />
    </div>
  );
}
