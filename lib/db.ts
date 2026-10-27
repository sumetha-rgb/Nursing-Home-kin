import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

// ใช้เฉพาะฝั่ง server (route handlers) เท่านั้น ห้าม import จาก client component
// เชื่อมต่อตอนเรียกใช้ครั้งแรก ไม่ใช่ตอน import: next build โหลดไฟล์ API ได้แม้ยังไม่ได้ตั้ง DATABASE_URL
type Sql = NeonQueryFunction<false, false>;
let client: Sql | null = null;
function db(): Sql {
  if (!client) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
    client = neon(url);
  }
  return client;
}

/** ใช้ได้เหมือน neon() ทุกแบบ: sql`...`, sql(text, params), sql.transaction([...]) */
export const sql = new Proxy(function () {} as unknown as Sql, {
  apply: (_t, _this, args) => (db() as unknown as (...a: unknown[]) => unknown)(...args),
  get: (_t, prop) => Reflect.get(db() as object, prop),
});

/** ชื่อชุดข้อมูลที่อนุญาต เช่น contracts, daily-2026-10-27 */
export const validKey = (k: string) => /^[a-z0-9_-]{1,64}$/i.test(k);
