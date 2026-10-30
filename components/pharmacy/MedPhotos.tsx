"use client";
import { useEffect, useState } from "react";
import { Modal } from "../ui";

/** รูปของแอปจัดยา: label = ฉลากยาตอนรับเข้า · pack = ซองยาที่จัดเสร็จ (เก็บแยกที่ /api/medphoto) */
export type MedPhotoKind = "label" | "pack";

/** บันทึกรูปหลังบันทึกข้อมูลแล้ว · ไม่สำเร็จแจ้งผ่าน onFail (ข้อมูลยายังบันทึกอยู่) */
export function saveMedPhoto(kind: MedPhotoKind, id: string | number, photo: string, onFail?: (msg: string) => void) {
  if (!photo) return;
  fetch("/api/medphoto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, id: String(id), photo }) })
    .then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "บันทึกรูปไม่สำเร็จ"); })
    .catch((e) => onFail?.(`บันทึกรูปไม่สำเร็จ · ${(e as Error).message}`));
}

export type PhotoItem = { kind: MedPhotoKind; id: string | number; title: string };

/** หน้าต่างดูรูป: โหลดเฉพาะตอนเปิด (รูปไม่ติดไปกับข้อมูลที่รีเฟรชอัตโนมัติ) */
export function MedPhotoModal({ open, title, items, onClose }: { open: boolean; title: string; items: PhotoItem[]; onClose: () => void }) {
  const [photos, setPhotos] = useState<Record<string, string> | null>(null);
  const key = items.map((x) => `${x.kind}:${x.id}`).join(",");
  useEffect(() => {
    if (!open) return;
    setPhotos(null);
    const kinds = Array.from(new Set(items.map((x) => x.kind)));
    Promise.all(kinds.map((k) => fetch(`/api/medphoto?kind=${k}&ids=${encodeURIComponent(items.filter((x) => x.kind === k).map((x) => String(x.id)).join(","))}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { photos: {} }))
      .then((d: { photos: Record<string, string> }) => Object.fromEntries(Object.entries(d.photos ?? {}).map(([id, p]) => [`${k}:${id}`, p])))))
      .then((all) => setPhotos(Object.assign({}, ...all)))
      .catch(() => setPhotos({}));
  }, [open, key]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Modal open={open} wide title={title} onClose={onClose} footer={<button className="btn-primary" onClick={onClose}>ปิด</button>}>
      {photos === null ? <p className="py-6 text-center text-sm text-gold-500">กำลังโหลดรูป…</p> : (
        <div className="grid gap-4 sm:grid-cols-2">{items.map((x) => {
          const src = photos[`${x.kind}:${x.id}`];
          return (
            <figure key={`${x.kind}:${x.id}`} className="min-w-0">
              <figcaption className="mb-2 truncate text-sm font-medium text-gold-800">{x.title}</figcaption>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {src ? <a href={src} target="_blank" rel="noreferrer"><img src={src} alt={x.title} className="w-full rounded-xl border border-cream-300" /></a>
                : <p className="rounded-xl bg-cream-50 px-4 py-8 text-center text-sm text-gold-500">ไม่มีรูป (บันทึกก่อนระบบเริ่มเก็บรูป หรือเบิกจากคลังกลาง)</p>}
            </figure>
          );
        })}</div>
      )}
    </Modal>
  );
}
