import { neon } from "@neondatabase/serverless";

// ใช้เฉพาะฝั่ง server (route handlers) เท่านั้น ห้าม import จาก client component
const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");

export const sql = neon(url);

/** ชื่อชุดข้อมูลที่อนุญาต เช่น contracts, daily-2026-10-27 */
export const validKey = (k: string) => /^[a-z0-9_-]{1,64}$/i.test(k);
