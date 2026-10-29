// สร้าง/อัปเดตตารางตาม db/schema.sql: npm run db:setup
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const envFile = (() => { try { return readFileSync(new URL("../.env.local", import.meta.url), "utf8"); } catch { return ""; } })();
const url = process.env.DATABASE_URL ?? envFile.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim();
if (!url) throw new Error("ไม่พบ DATABASE_URL (ตั้งใน .env.local หรือ environment)");
const sql = neon(url);

// ตัดคอมเมนต์ แล้วแยกทีละคำสั่ง
const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8")
  .split(/\r?\n/).map((l) => l.replace(/--.*$/, "")).join("\n")
  .split(";").map((s) => s.trim()).filter(Boolean);
for (const stmt of schema) await sql(stmt);

// บัญชีทดลองทุกระดับ (ข้อมูลตรงกับ lib/roles.ts) ปิดได้ด้วย SEED_DEMO=false
// รหัสผ่านเก็บแบบ scrypt รูปแบบเดียวกับ lib/auth.ts
const DEMO_PASSWORD = "demo1234";
const DEMOS = [
  ["global@kin.test", "ผู้บริหาร (ทดลอง)", "Global Admin", "ทุกสาขา"],
  ["branch@kin.test", "ผู้จัดการสาขา (ทดลอง)", "Branch Admin", "สุขุมวิท 107"],
  ["staff@kin.test", "พนักงานดูแล (ทดลอง)", "Nurse", "สุขุมวิท 107"],
  ["cashier@kin.test", "แคชเชียร์ (ทดลอง)", "Cashier", "สุขุมวิท 107"],
  ["nurse@kin.test", "หัวหน้าพยาบาล (ทดลอง)", "Head Nurse", "สุขุมวิท 107"],
  ["branch2@kin.test", "ผู้จัดการสาขาลาดพร้าว 71 (ทดลอง)", "Branch Admin", "ลาดพร้าว 71"],
];
if (process.env.SEED_DEMO !== "false") {
  const { randomBytes, scryptSync, randomUUID } = await import("node:crypto");
  const hash = (pw) => { const salt = randomBytes(16); return `scrypt$${salt.toString("base64")}$${scryptSync(pw, salt, 64).toString("base64")}`; };
  for (const [email, name, role, branch] of DEMOS) {
    await sql(
      `INSERT INTO staff_users (id, full_name, email, password_hash, contract_type, access_level, branch_name, status, sort_order)
       SELECT $1, $2, $3, $4, 'B (NJY GROUP)', $5, $6, 'ทำงาน', $7
       WHERE NOT EXISTS (SELECT 1 FROM staff_users WHERE lower(email) = $3)`,
      [randomUUID(), name, email, hash(DEMO_PASSWORD), role, branch, Date.now()],
    );
  }
  console.log(`demo accounts: ${DEMOS.map((d) => d[0]).join(", ")} (password ${DEMO_PASSWORD})`);
}

// ตารางชั่วคราวรุ่นแรก (เก็บเป็น JSON) ไม่ใช้แล้ว
await sql("DROP TABLE IF EXISTS records");
await sql("DROP TABLE IF EXISTS collections");

const tables = await sql("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1");
console.log(`db ready: ${tables.length} tables\n` + tables.map((t) => "  - " + t.table_name).join("\n"));
