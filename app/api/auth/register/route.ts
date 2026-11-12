import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { hashPassword, normEmail, passwordProblem, startSession, validEmail } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { permsFor } from "@/lib/perms";
import { pushTo } from "@/lib/push";

/**
 * แจ้งเตือนบนมือถือถึงคนที่อนุมัติได้ของสาขานั้น (ผู้จัดการสาขา หรือคนที่ได้สิทธิ์เมนูทีมเพิ่ม) · ผู้บริหารไม่ได้แจ้งเตือน เห็นในแถบต้องจัดการ
 * tag เดียวต่อสาขา: หลายคนสมัครติดกัน แจ้งเตือนเดิมถูกแทนด้วยยอดล่าสุด "สมัครใหม่รออนุมัติ 3 คน"
 */
async function notifyApprovers(branch: string) {
  const ids = (await sql`SELECT id FROM staff_users WHERE branch_name = ${branch} AND coalesce(status, 'ทำงาน') = 'ทำงาน' AND access_level <> 'Global Admin'
      AND CASE WHEN permissions IS NULL THEN access_level = 'Branch Admin' ELSE 'staff' = ANY(permissions) END`) as { id: string }[];
  if (!ids.length) return;
  const wait = (await sql`SELECT full_name FROM staff_users WHERE status = 'รออนุมัติ' AND branch_name = ${branch} ORDER BY created_at DESC LIMIT 20`) as { full_name: string }[];
  const names = wait.slice(0, 2).map((x) => x.full_name).join(", ") + (wait.length > 2 ? ` และอีก ${wait.length - 2} คน` : "");
  await pushTo(ids.map((x) => x.id), {
    title: wait.length > 1 ? `มีคนสมัครใหม่ รออนุมัติ ${wait.length} คน` : "มีคนสมัครใหม่ รออนุมัติ",
    body: `${names} · สาขา${branch} · กดเพื่อตรวจและเลือกตำแหน่ง`,
    url: "/?view=staff&filter=pending",
    tag: `signup-${branch}`,
  });
}

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * สมัครสมาชิกเอง: ได้สิทธิ์พยาบาล (Nurse) เสมอ
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
    VALUES (${id}, ${name}, ${email}, ${await hashPassword(body.password)}, null, 'Nurse', ${branch}, ${auto ? "ทำงาน" : "รออนุมัติ"}, ${Date.now()})`;
  await audit(req, null, [{ area: "users", action: "register", recordId: id, summary: `${name} (${email})`, branch, after: { full_name: name, email, access_level: "Nurse", branch_name: branch, status: auto ? "ทำงาน" : "รออนุมัติ" } }], name);

  if (!auto) {
    await notifyApprovers(branch).catch(() => {}); // แจ้งเตือนไม่สำเร็จ ไม่ทำให้การสมัครล้ม
    return NextResponse.json({ pending: true });
  }
  const res = NextResponse.json({ pending: false, user: { id, name, email, role: "Nurse", branch, perms: permsFor("Nurse") } });
  await startSession(res, id);
  return res;
}
