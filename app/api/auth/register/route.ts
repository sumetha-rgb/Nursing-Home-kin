import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { hashPassword, normEmail, passwordProblem, startSession, validEmail } from "@/lib/auth";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/**
 * สมัครสมาชิกเอง: ได้สิทธิ์ระดับปฏิบัติงาน (Operation) เสมอ
 * ค่าเริ่มต้นต้องรอผู้ดูแลอนุมัติก่อนเข้าสู่ระบบ ตั้ง AUTO_APPROVE_SIGNUP=true เพื่อให้เข้าได้ทันที
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = normEmail(body.email);
  const branch = typeof body.branch === "string" ? body.branch.trim() : "";
  if (!name) return NextResponse.json({ error: "กรุณากรอกชื่อ-นามสกุล" }, { status: 400 });
  if (!validEmail(email)) return NextResponse.json({ error: "รูปแบบอีเมลไม่ถูกต้อง" }, { status: 400 });
  if (!branch) return NextResponse.json({ error: "กรุณาเลือกสาขาที่ปฏิบัติงาน" }, { status: 400 });
  const pwErr = passwordProblem(body.password);
  if (pwErr) return NextResponse.json({ error: pwErr }, { status: 400 });

  const [dup] = await sql`SELECT 1 FROM staff_users WHERE lower(email) = ${email}`;
  if (dup) return NextResponse.json({ error: "อีเมลนี้มีบัญชีอยู่แล้ว" }, { status: 409 });

  const auto = process.env.AUTO_APPROVE_SIGNUP === "true";
  const id = randomUUID();
  await sql`
    INSERT INTO staff_users (id, full_name, email, password_hash, contract_type, access_level, branch_name, status, sort_order)
    VALUES (${id}, ${name}, ${email}, ${await hashPassword(body.password)}, null, 'Operation', ${branch}, ${auto ? "ทำงาน" : "รออนุมัติ"}, ${Date.now()})`;
  await audit(req, null, [{ area: "users", action: "register", recordId: id, summary: `${name} (${email})`, branch, after: { full_name: name, email, access_level: "Operation", branch_name: branch, status: auto ? "ทำงาน" : "รออนุมัติ" } }], name);

  if (!auto) return NextResponse.json({ pending: true });
  const res = NextResponse.json({ pending: false, user: { id, name, email, role: "Operation", branch } });
  await startSession(res, id);
  return res;
}
