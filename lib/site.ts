/**
 * ที่อยู่เว็บจริงสำหรับลิงก์และ QR ที่ส่งให้ญาติ (ต้องเปิดได้จากมือถือ ไม่ใช่ localhost)
 * เปลี่ยนได้ด้วย NEXT_PUBLIC_SITE_URL เช่นเมื่อใช้โดเมนของบริษัท
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://nursing-home-kin.vercel.app").replace(/\/+$/, "");

/** ปุ่ม "เปิดดู" ในระบบจัดการ: เปิดหน้าเดียวกันบนเว็บที่ใช้อยู่ (ทดสอบบนเครื่องได้) ส่วนลิงก์ที่คัดลอกและ QR ยังเป็น SITE_URL */
export const openHere = (url: string) => {
  if (!url) return;
  window.open(url.startsWith(SITE_URL) ? window.location.origin + url.slice(SITE_URL.length) : url, "_blank", "noopener");
};
