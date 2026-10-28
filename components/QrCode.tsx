"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";

/** สร้างรูป QR Code จากข้อความ/ลิงก์ (ทำในเครื่อง ไม่ส่งลิงก์ไปบริการภายนอก) */
export function useQr(text: string, size = 512) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    if (!text) { setSrc(""); return; }
    let live = true;
    QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: "M", color: { dark: "#3d2d14", light: "#ffffff" } })
      .then((u) => { if (live) setSrc(u); }).catch(() => setSrc(""));
    return () => { live = false; };
  }, [text, size]);
  return src;
}

export default function QrCode({ text, size = 512, className = "", alt = "QR Code" }: { text: string; size?: number; className?: string; alt?: string }) {
  const src = useQr(text, size);
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt={alt} className={className} /> : <div className={`qr-placeholder ${className}`} />;
}
