// ใช้ฝั่ง server เท่านั้น: รหัสผ่าน, session cookie และการตรวจสิทธิ์
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "./db";
import { ROLES, Role, SessionUser } from "./roles";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;
export const COOKIE = "kin_session";
const SESSION_DAYS = 7;

export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, 64);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}
export async function verifyPassword(pw: string, stored: string | null) {
  const [algo, salt, hash] = (stored ?? "").split("$");
  if (algo !== "scrypt" || !salt || !hash) return false;
  const want = Buffer.from(hash, "base64");
  const got = await scrypt(pw, Buffer.from(salt, "base64"), want.length);
  return timingSafeEqual(want, got);
}
export const passwordProblem = (pw: unknown) => (typeof pw !== "string" || pw.length < 8 ? "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร" : null);
export const normEmail = (e: unknown) => (typeof e === "string" ? e.trim().toLowerCase() : "");
export const validEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

const tokenId = (token: string) => createHash("sha256").update(token).digest("hex");

export async function startSession(res: NextResponse, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await sql`INSERT INTO sessions (id, user_id, expires_at) VALUES (${tokenId(token)}, ${userId}, ${expires.toISOString()})`;
  await sql`UPDATE staff_users SET last_login_at = now() WHERE id = ${userId}`;
  res.cookies.set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires });
}

export async function endSession(req: NextRequest, res: NextResponse) {
  const token = req.cookies.get(COOKIE)?.value;
  if (token) await sql`DELETE FROM sessions WHERE id = ${tokenId(token)}`;
  res.cookies.set(COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/** ผู้ใช้จาก cookie (ต้องมีสถานะ "ทำงาน" และ session ยังไม่หมดอายุ) */
export async function currentUser(req: NextRequest): Promise<SessionUser | null> {
  const token = req.cookies.get(COOKIE)?.value;
  if (!token) return null;
  const [u] = await sql`
    SELECT u.id, u.full_name, u.email, u.access_level, u.branch_name
    FROM sessions s JOIN staff_users u ON u.id = s.user_id
    WHERE s.id = ${tokenId(token)} AND s.expires_at > now() AND u.status = 'ทำงาน'`;
  if (!u || !ROLES.includes(u.access_level as Role)) return null;
  return { id: u.id, name: u.full_name, email: u.email, role: u.access_level as Role, branch: u.branch_name ?? "" };
}

/** ตรวจว่าสาขาของบัญชีมีอยู่ในหน้า "สาขาของเรา" และเปิดให้บริการหรือไม่ */
export async function checkBranch(u: SessionUser): Promise<SessionUser> {
  if (u.role === "Global Admin") return { ...u, branchCheck: "all" };
  const [b] = await sql`SELECT status FROM branches WHERE name = ${u.branch} LIMIT 1`;
  const st = String(b?.status ?? "");
  return { ...u, branchCheck: !b ? "missing" : st === "ปิด" ? "closed" : st === "เตรียมเปิด" ? "upcoming" : "ok" };
}

export const unauthorized = () => NextResponse.json({ error: "กรุณาเข้าสู่ระบบ" }, { status: 401 });
export const forbidden = (msg = "บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้") => NextResponse.json({ error: msg }, { status: 403 });

/** กันการเดารหัสผ่าน: ผิดเกิน 5 ครั้งใน 10 นาที ต่ออีเมล (เก็บในหน่วยความจำของ server) */
const fails = new Map<string, { n: number; until: number }>();
export function tooManyAttempts(email: string) {
  const f = fails.get(email);
  return !!f && f.n >= 5 && f.until > Date.now();
}
export function recordFailure(email: string) {
  const f = fails.get(email);
  const fresh = !f || f.until < Date.now();
  fails.set(email, { n: fresh ? 1 : f!.n + 1, until: Date.now() + 10 * 60e3 });
}
export const clearFailures = (email: string) => fails.delete(email);
