import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUser, forbidden, hashPassword, normEmail, passwordProblem, unauthorized, validEmail } from "@/lib/auth";
import { BRANCH_ROLES, ROLES, Role, SessionUser } from "@/lib/roles";
import { ALL_PERMS, can, PERM_LABEL, permsFor } from "@/lib/perms";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * จัดการบัญชีทีม (ระบบจัดการ › ทีมและสิทธิ์การใช้งาน)
 *  Global Admin : ทุกบัญชี ทุกระดับ
 *  ระดับอื่นที่มีสิทธิ์เมนูทีม : เฉพาะบัญชีพยาบาล แคชเชียร์ และหัวหน้าพยาบาลในสาขาตัวเอง
 *  action "permissions" : ติ๊กสิทธิ์รายคน (ให้ได้ไม่เกินสิทธิ์ของตัวเอง · null = กลับไปใช้ค่าเริ่มต้นของตำแหน่ง)
 */
const STATUSES = ["ทำงาน", "รออนุมัติ", "พักงาน", "ลาออก"];
type Row = { id: string; full_name: string; email: string | null; contract_type: string | null; access_level: string; branch_name: string | null; status: string; last_login_at: string | null; permissions: string[] | null };

const err = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });

async function listFor(me: SessionUser) {
  const rows = (me.role === "Global Admin"
    ? await sql`SELECT id, full_name, email, contract_type, access_level, branch_name, status, last_login_at::text, permissions FROM staff_users ORDER BY sort_order DESC, created_at DESC`
    : await sql`SELECT id, full_name, email, contract_type, access_level, branch_name, status, last_login_at::text, permissions FROM staff_users WHERE branch_name = ${me.branch} ORDER BY sort_order DESC, created_at DESC`) as Row[];
  return rows;
}

/** ระดับที่ไม่ใช่ผู้บริหาร แก้ได้เฉพาะพยาบาล/แคชเชียร์/หัวหน้าพยาบาลในสาขาตัวเอง */
const branchRole = (r: string) => (BRANCH_ROLES as string[]).includes(r);
const canManage = (me: SessionUser, target: { access_level: string; branch_name: string | null }) =>
  me.role === "Global Admin" || (branchRole(target.access_level) && target.branch_name === me.branch);

async function guard(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return { res: unauthorized() };
  if (!can(me, "staff")) return { res: forbidden() };
  return { me };
}

export async function GET(req: NextRequest) {
  const g = await guard(req);
  if (!g.me) return g.res;
  return NextResponse.json({ users: await listFor(g.me), me: g.me });
}

export async function POST(req: NextRequest) {
  const g = await guard(req);
  if (!g.me) return g.res;
  const me = g.me;
  const b = await req.json().catch(() => ({}));

  const pick = (x: Record<string, unknown>) => ({
    full_name: typeof x.full_name === "string" ? x.full_name.trim() : "",
    email: normEmail(x.email),
    contract_type: typeof x.contract_type === "string" ? x.contract_type : null,
    access_level: (ROLES as readonly string[]).includes(x.access_level as string) ? (x.access_level as Role) : "Nurse",
    branch_name: typeof x.branch_name === "string" ? x.branch_name : "",
    status: STATUSES.includes(x.status as string) ? (x.status as string) : "ทำงาน",
  });

  switch (b.action) {
    case "create": {
      const v = pick(b);
      if (!v.full_name) return err("กรุณากรอกชื่อ-นามสกุล");
      if (!validEmail(v.email)) return err("รูปแบบอีเมลไม่ถูกต้อง");
      const pwErr = passwordProblem(b.password);
      if (pwErr) return err(pwErr);
      if (me.role !== "Global Admin") { if (!branchRole(v.access_level)) v.access_level = "Nurse"; v.branch_name = me.branch; }
      const [dup] = await sql`SELECT 1 FROM staff_users WHERE lower(email) = ${v.email}`;
      if (dup) return err("อีเมลนี้มีบัญชีอยู่แล้ว", 409);
      const id = randomUUID();
      await sql`
        INSERT INTO staff_users (id, full_name, email, password_hash, contract_type, access_level, branch_name, status, sort_order)
        VALUES (${id}, ${v.full_name}, ${v.email}, ${await hashPassword(b.password)}, ${v.contract_type}, ${v.access_level}, ${v.branch_name}, ${v.status}, ${Date.now()})`;
      await audit(req, me, [{ area: "users", action: "create", recordId: id, summary: `${v.full_name} (${v.email})`, branch: v.branch_name || null, after: v }]);
      break;
    }
    case "update": case "approve": case "reset_password": case "delete": case "permissions": {
      const [t] = (await sql`SELECT id, full_name, email, contract_type, access_level, branch_name, status, permissions FROM staff_users WHERE id = ${String(b.id)}`) as Row[];
      if (!t) return err("ไม่พบบัญชีนี้", 404);
      if (!canManage(me, t)) return forbidden();
      const self = t.id === me.id;
      const before = { full_name: t.full_name, email: t.email, contract_type: t.contract_type, access_level: t.access_level, branch_name: t.branch_name, status: t.status };
      const log = (action: string, after?: object) => audit(req, me, [{ area: "users", action, recordId: t.id, summary: `${t.full_name}${t.email ? ` (${t.email})` : ""}`, branch: t.branch_name, before, after }]);
      if (b.action === "permissions") {
        if (self) return err("แก้สิทธิ์ของตัวเองไม่ได้ ให้ผู้ดูแลคนอื่นแก้ให้");
        if (t.access_level === "Global Admin") return err("ผู้บริหารองค์กรได้ทุกสิทธิ์เสมอ");
        // ให้ได้เฉพาะสิทธิ์ที่ตัวเองมี
        const list = Array.isArray(b.permissions) ? ALL_PERMS.filter((p) => b.permissions.includes(p) && can(me, p)) : null;
        if (list && me.role !== "Global Admin") {
          // สิทธิ์เดิมของคนนี้ที่ตัวเองไม่มี ห้ามถูกตัดทิ้งโดยไม่ตั้งใจ
          for (const p of permsFor(t.access_level as Role, t.permissions)) if (!can(me, p) && !list.includes(p)) list.push(p);
        }
        await sql`UPDATE staff_users SET permissions = ${list}, updated_at = now() WHERE id = ${t.id}`;
        await log("permissions", { permissions: list ? list.map((p) => PERM_LABEL[p]).join(", ") : "ค่าเริ่มต้นของตำแหน่ง" });
      } else if (b.action === "approve") {
        await sql`UPDATE staff_users SET status = 'ทำงาน', updated_at = now() WHERE id = ${t.id}`;
        await log("approve", { ...before, status: "ทำงาน" });
      } else if (b.action === "reset_password") {
        const pwErr = passwordProblem(b.password);
        if (pwErr) return err(pwErr);
        await sql.transaction([
          sql`UPDATE staff_users SET password_hash = ${await hashPassword(b.password)}, updated_at = now() WHERE id = ${t.id}`,
          sql`DELETE FROM sessions WHERE user_id = ${t.id}`, // บังคับให้ล็อกอินใหม่ด้วยรหัสใหม่
        ]);
        await log("reset_password");
      } else if (b.action === "delete") {
        if (self) return err("ลบบัญชีของตัวเองไม่ได้");
        await sql`DELETE FROM staff_users WHERE id = ${t.id}`;
        await log("delete");
      } else {
        const v = pick(b);
        if (!v.full_name) return err("กรุณากรอกชื่อ-นามสกุล");
        if (v.email && !validEmail(v.email)) return err("รูปแบบอีเมลไม่ถูกต้อง");
        if (me.role !== "Global Admin") { if (!branchRole(v.access_level)) v.access_level = "Nurse"; v.branch_name = me.branch; }
        if (self && (v.access_level !== me.role || v.status !== "ทำงาน")) return err("เปลี่ยนระดับสิทธิ์หรือระงับบัญชีของตัวเองไม่ได้");
        if (v.email) {
          const [dup] = await sql`SELECT 1 FROM staff_users WHERE lower(email) = ${v.email} AND id <> ${t.id}`;
          if (dup) return err("อีเมลนี้มีบัญชีอยู่แล้ว", 409);
        }
        await sql`
          UPDATE staff_users SET full_name = ${v.full_name}, email = ${v.email || null}, contract_type = ${v.contract_type},
            access_level = ${v.access_level}, branch_name = ${v.branch_name}, status = ${v.status}, updated_at = now()
          WHERE id = ${t.id}`;
        if (v.status !== "ทำงาน") await sql`DELETE FROM sessions WHERE user_id = ${t.id}`;
        await log("update", v);
      }
      break;
    }
    default:
      return err("unknown action");
  }
  return NextResponse.json({ users: await listFor(me), me });
}
