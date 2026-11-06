"use client";
import { useEffect, useSyncExternalStore } from "react";

/**
 * รูปโปรไฟล์ฝั่งเว็บ: รู้ว่าใครมีรูป (โหลดครั้งเดียวต่อชนิด) แล้วใช้ /api/photo?kind=&id=&v= เป็น src
 * อัปโหลด: เลือกรูป → ตัดเป็นสี่เหลี่ยมจัตุรัสตรงกลาง → ย่อ 320px JPEG → ส่งขึ้น
 */
export type PhotoKind = "staff" | "resident";
const index: Record<PhotoKind, Record<string, number> | null> = { staff: null, resident: null };
const loading: Partial<Record<PhotoKind, Promise<void>>> = {};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
let snap = 0;
const subscribe = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };

function load(kind: PhotoKind) {
  if (!loading[kind]) {
    loading[kind] = fetch(`/api/photo?list=${kind}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { index[kind] = d?.v ?? {}; snap++; emit(); })
      .catch(() => { delete loading[kind]; });
  }
  return loading[kind];
}

/** url ของรูป (ไม่มีรูป = null) · เรียกในคอมโพเนนต์เพื่อให้แสดงใหม่เมื่อมีรูปใหม่ */
export function usePhotos(kind: PhotoKind) {
  useSyncExternalStore(subscribe, () => snap, () => 0);
  useEffect(() => { load(kind); }, [kind]);
  return (id?: string | null) => {
    const v = id ? index[kind]?.[id] : undefined;
    return id && v ? `/api/photo?kind=${kind}&id=${encodeURIComponent(id)}&v=${v}` : null;
  };
}

/** ย่อรูปเป็นสี่เหลี่ยมจัตุรัส 320px (ตัดตรงกลาง) → JPEG data URL */
export function shrinkPhoto(file: File, size = 320): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("กรุณาเลือกไฟล์รูปภาพ"));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const s = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const g = c.getContext("2d");
      if (!g) { URL.revokeObjectURL(url); return reject(new Error("เครื่องนี้ย่อรูปไม่ได้")); }
      g.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("เปิดรูปนี้ไม่ได้ · ลองรูปอื่น")); };
    img.src = url;
  });
}

/** ตั้งรูป (หรือลบเมื่อ file = null) · คืนข้อความแจ้งผล */
export async function savePhoto(kind: PhotoKind, id: string, file: File | null): Promise<string> {
  const body = file ? { kind, id, photo: await shrinkPhoto(file) } : { kind, id, remove: true };
  const r = await fetch("/api/photo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "บันทึกรูปไม่สำเร็จ");
  const cur = index[kind] ?? {};
  if (file) cur[id] = d.v ?? Math.floor(Date.now() / 1000); else delete cur[id];
  index[kind] = { ...cur }; snap++; emit();
  return file ? "เปลี่ยนรูปแล้ว" : "ลบรูปแล้ว";
}
