/**
 * NEXT_PUBLIC_BUILD_ID: รหัสเวอร์ชันของการ build แต่ละครั้ง (Vercel = commit)
 *  ฝังทั้งฝั่งหน้าเว็บและ /api/version · หน้าเว็บที่เปิดค้างไว้เทียบกับเซิร์ฟเวอร์ ถ้าไม่ตรง = มีเวอร์ชันใหม่ (components/UpdateBar)
 */
// ใช้รหัส commit (Vercel ตั้งให้ทั้งตอน build และตอนรัน จึงตรงกัน) · ไม่มี = ปิดการเตือน (เช่น เครื่องพัฒนา)
const BUILD_ID = (process.env.VERCEL_GIT_COMMIT_SHA || "").slice(0, 12);

/** @type {import('next').NextConfig} */
const nextConfig = { reactStrictMode: true, env: { NEXT_PUBLIC_BUILD_ID: BUILD_ID } };
export default nextConfig;
