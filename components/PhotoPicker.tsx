"use client";
import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { Modal } from "./ui";

/** ย่อรูปให้ด้านยาวไม่เกิน max px แล้วแปลงเป็น JPEG (data URL) — พร้อมส่งขึ้นที่เก็บรูปภายหลัง */
async function toJpeg(src: CanvasImageSource & { width: number; height: number }, max = 1280, quality = 0.8) {
  const w = "videoWidth" in src ? (src as HTMLVideoElement).videoWidth : src.width;
  const h = "videoHeight" in src ? (src as HTMLVideoElement).videoHeight : src.height;
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext("2d")!.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}
function readFile(f: File) {
  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(f);
    img.onload = async () => { try { resolve(await toJpeg(img)); } finally { URL.revokeObjectURL(url); } };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("เปิดไฟล์รูปไม่ได้")); };
    img.src = url;
  });
}

/**
 * ช่องแนบรูป: เลือกได้ทั้ง "เปิดกล้อง" (ถ่ายสดผ่านกล้องของเครื่อง ทั้งมือถือและคอม) และ "เลือกรูป" (จากไฟล์/คลังรูป)
 * เครื่องที่เปิดกล้องผ่านเบราว์เซอร์ไม่ได้ ปุ่มกล้องจะใช้กล้องของระบบปฏิบัติการแทน
 */
export default function PhotoPicker({ value, onChange, label = "แนบรูปภาพ", hint, invalid = false, allowFile = true }: {
  value: string; onChange: (dataUrl: string) => void; label?: string; hint?: string; invalid?: boolean; allowFile?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const nativeCam = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [cam, setCam] = useState(false);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [err, setErr] = useState("");
  const [ready, setReady] = useState(false);

  const stop = () => { stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null; setReady(false); };
  useEffect(() => () => stop(), []);
  useEffect(() => {
    if (!cam) { stop(); return; }
    let cancelled = false;
    setErr(""); setReady(false);
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; }
        stop(); stream.current = s;
        if (video.current) { video.current.srcObject = s; video.current.play().catch(() => {}); }
      })
      .catch((e: Error) => setErr(e.name === "NotAllowedError" ? "เบราว์เซอร์ไม่ได้รับอนุญาตให้ใช้กล้อง กรุณากดอนุญาตที่แถบที่อยู่ด้านบน หรือเลือกรูปจากไฟล์แทน" : e.name === "NotFoundError" ? "ไม่พบกล้องในเครื่องนี้ กรุณาเลือกรูปจากไฟล์แทน" : "เปิดกล้องไม่สำเร็จ กรุณาลองใหม่หรือเลือกรูปจากไฟล์แทน"));
    return () => { cancelled = true; };
  }, [cam, facing]); // eslint-disable-line react-hooks/exhaustive-deps

  const openCamera = () => {
    if (typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function") setCam(true);
    else nativeCam.current?.click(); // เบราว์เซอร์รุ่นเก่า: ใช้กล้องของระบบ
  };
  const shoot = async () => {
    if (!video.current || !ready) return;
    onChange(await toJpeg(video.current));
    setCam(false);
  };
  const pick = async (f?: File) => {
    if (!f) return;
    try { onChange(await readFile(f)); } catch (e) { setErr((e as Error).message); }
  };

  return (
    <div>
      <div className={`photo-picker ${invalid ? "is-invalid" : ""} ${value ? "has-photo" : ""}`}>
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="รูปที่แนบ" />
        ) : (
          <div className="photo-picker-empty"><Icon name="camera" className="h-8 w-8" /><span>{label}</span></div>
        )}
        <div className="photo-picker-actions">
          <button type="button" className="btn-primary" onClick={openCamera}><Icon name="camera" className="h-4 w-4" /> {value ? "ถ่ายใหม่" : "เปิดกล้อง"}</button>
          {allowFile && <button type="button" className="btn-soft" onClick={() => fileRef.current?.click()}><Icon name="upload" className="h-4 w-4" /> {value ? "เปลี่ยนรูป" : "เลือกรูป"}</button>}
          {value && <button type="button" className="btn-soft !px-3" aria-label="ลบรูป" onClick={() => onChange("")}><Icon name="close" className="h-4 w-4" /></button>}
        </div>
      </div>
      {hint && <p className="mt-1.5 text-xs leading-5 text-gold-500">{hint}</p>}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      <input ref={nativeCam} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />

      <Modal open={cam} title="ถ่ายรูป" onClose={() => setCam(false)}
        footer={<>
          <button type="button" className="btn-soft" onClick={() => setCam(false)}>ยกเลิก</button>
          {allowFile && err && <button type="button" className="btn-soft" onClick={() => { setCam(false); fileRef.current?.click(); }}><Icon name="upload" className="h-4 w-4" /> เลือกรูปจากไฟล์</button>}
          <button type="button" className="btn-primary" disabled={!ready} onClick={shoot}><Icon name="camera" className="h-4 w-4" /> ถ่ายภาพ</button>
        </>}>
        {err ? <p role="alert" className="form-error"><Icon name="alert" className="h-4 w-4 shrink-0" />{err}</p> : (
          <div className="camera-view">
            <video ref={video} playsInline muted autoPlay onLoadedData={() => setReady(true)} />
            {!ready && <p className="camera-wait">กำลังเปิดกล้อง…</p>}
            <button type="button" className="camera-flip" onClick={() => setFacing(facing === "environment" ? "user" : "environment")} aria-label="สลับกล้องหน้า/หลัง"><Icon name="refresh" className="h-5 w-5" /></button>
          </div>
        )}
      </Modal>
    </div>
  );
}
