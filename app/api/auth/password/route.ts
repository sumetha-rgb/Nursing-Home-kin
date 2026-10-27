import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUser, hashPassword, passwordProblem, unauthorized, verifyPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

/** เปลี่ยนรหัสผ่านของตัวเอง ต้องยืนยันรหัสผ่านเดิม */
export async function POST(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const [u] = await sql`SELECT password_hash FROM staff_users WHERE id = ${me.id}`;
  if (!(await verifyPassword(String(body.current ?? ""), u?.password_hash))) return NextResponse.json({ error: "รหัสผ่านเดิมไม่ถูกต้อง" }, { status: 400 });
  const pwErr = passwordProblem(body.next);
  if (pwErr) return NextResponse.json({ error: pwErr }, { status: 400 });
  await sql`UPDATE staff_users SET password_hash = ${await hashPassword(body.next)}, updated_at = now() WHERE id = ${me.id}`;
  await audit(req, me, [{ area: "auth", action: "change_password", recordId: me.id, summary: me.email }]);
  return NextResponse.json({ ok: true });
}
