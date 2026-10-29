/**
 * ที่อยู่เว็บสำหรับลิงก์และ QR ที่ส่งให้ญาติ
 *  - ใช้งานจริง: เว็บจริง (ต้องเปิดได้จากมือถือ) เปลี่ยนได้ด้วย NEXT_PUBLIC_SITE_URL เช่นเมื่อใช้โดเมนของบริษัท
 *  - ทดสอบบนเครื่องตัวเอง (localhost): ใช้ที่อยู่ของเครื่องนั้นก่อน เพื่อกดเปิดทดสอบได้ทันที (ลิงก์/QR นี้มือถือเครื่องอื่นเปิดไม่ได้)
 */
export const PROD_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://nursing-home-kin.vercel.app").replace(/\/+$/, "");
export const isLocalHost = () => typeof window !== "undefined" && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
export const siteUrl = () => (isLocalHost() ? window.location.origin : PROD_URL);

/** ปุ่ม "เปิดดู" ในระบบจัดการ: เปิดหน้าเดียวกันบนเว็บที่ใช้อยู่ */
export const openHere = (url: string) => {
  if (!url) return;
  window.open(url.startsWith(PROD_URL) ? window.location.origin + url.slice(PROD_URL.length) : url, "_blank", "noopener");
};
