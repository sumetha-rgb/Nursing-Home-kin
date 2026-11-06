import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { audit } from "@/lib/audit";
import { currentUser, forbidden, unauthorized } from "@/lib/auth";
import type { SessionUser } from "@/lib/roles";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * รูปโปรไฟล์ (ตาราง profile_photos) · ต้องเข้าระบบ
 *  GET ?list=staff|resident        { v: { [id]: เวอร์ชัน } } = ใครมีรูปบ้าง (ไม่ส่งรูป) · ผู้รับบริการเห็นเฉพาะสาขาตัวเอง (ผู้บริหารเห็นทุกสาขา)
 *  GET ?kind=staff|resident&id=    ไฟล์รูป JPEG (ใส่ใน <img src> ได้ · ?v= ใช้ล้าง cache)
 *  POST { kind, id, photo }        ตั้งรูป (data URL JPEG/PNG/WebP ไม่เกิน 150KB · ฝั่งเว็บย่อเหลือ 320px ก่อนส่ง)
 *  POST { kind, id, remove: true } ลบรูป
 * สิทธิ์แก้: รูปพนักงาน = เจ้าของบัญชี หรือผู้จัดการสาขา/ผู้บริหาร (สาขาเดียวกัน) · รูปผู้รับบริการ = ทุกคนที่เข้าระบบในสาขาเดียวกัน (ผู้บริหารทุกสาขา)
 */
const KINDS = ["staff", "resident"] as const;
type Kind = (typeof KINDS)[number];
const isKind = (k: unknown): k is Kind => KINDS.includes(k as Kind);
const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
const MAX = 150_000;
const global = (me: SessionUser) => me.role === "Global Admin";

/** สาขาของเจ้าของรูป (ไม่พบ = null) */
async function ownerBranch(kind: Kind, id: string): Promise<{ branch: string | null; name: string } | null> {
  const rows = (kind === "staff"
    ? await sql`SELECT branch_name, full_name FROM staff_users WHERE id = ${id}`
    : await sql`SELECT branch_name, full_name FROM residents WHERE id = ${id}`) as { branch_name: string | null; full_name: string }[];
  return rows[0] ? { branch: rows[0].branch_name, name: rows[0].full_name } : null;
}

export async function GET(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const q = req.nextUrl.searchParams;
  try {
    const list = q.get("list");
    if (list) {
      if (!isKind(list)) return bad("ชนิดรูปไม่ถูกต้อง");
      const rows = (list === "resident" && !global(me)
        ? await sql`SELECT p.ref_id, extract(epoch FROM p.updated_at)::bigint AS v FROM profile_photos p JOIN residents r ON r.id = p.ref_id WHERE p.kind = 'resident' AND r.branch_name = ${me.branch}`
        : await sql`SELECT ref_id, extract(epoch FROM updated_at)::bigint AS v FROM profile_photos WHERE kind = ${list}`) as { ref_id: string; v: number }[];
      return NextResponse.json({ v: Object.fromEntries(rows.map((r) => [r.ref_id, Number(r.v)])) });
    }
    const kind = q.get("kind"), id = q.get("id") ?? "";
    if (!isKind(kind) || !id) return bad("ระบุรูปไม่ถูกต้อง");
    if (kind === "resident" && !global(me)) {
      const o = await ownerBranch(kind, id);
      if (!o || o.branch !== me.branch) return forbidden();
    }
    const [p] = (await sql`SELECT photo FROM profile_photos WHERE kind = ${kind} AND ref_id = ${id}`) as { photo: string }[];
    const m = p?.photo.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/);
    if (!m) return new NextResponse(null, { status: 404 });
    return new NextResponse(Buffer.from(m[2], "base64"), { headers: { "Content-Type": m[1], "Cache-Control": "private, max-age=86400" } });
  } catch (e) {
    return bad(/profile_photos/.test(String((e as Error)?.message)) ? "ยังไม่ได้สร้างตารางรูปโปรไฟล์ในฐานข้อมูล" : "โหลดรูปไม่สำเร็จ", 500);
  }
}

export async function POST(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const b = await req.json().catch(() => ({}));
  const kind = b.kind, id = typeof b.id === "string" ? b.id.slice(0, 80) : "";
  if (!isKind(kind) || !id) return bad("ระบุรูปไม่ถูกต้อง");
  try {
    const o = await ownerBranch(kind, id);
    if (!o) return bad("ไม่พบข้อมูลเจ้าของรูป", 404);
    const sameBranch = global(me) || o.branch === me.branch;
    const allowed = kind === "staff" ? id === me.id || ((me.role === "Branch Admin" || global(me)) && sameBranch) : sameBranch;
    if (!allowed) return forbidden(kind === "staff" ? "เปลี่ยนรูปได้เฉพาะของตัวเอง" : "เปลี่ยนรูปได้เฉพาะผู้รับบริการในสาขาของคุณ");
    const area = kind === "staff" ? "users" : "residents";
    if (b.remove) {
      await sql`DELETE FROM profile_photos WHERE kind = ${kind} AND ref_id = ${id}`;
      await audit(req, me, [{ area, action: "update", recordId: id, summary: `ลบรูปโปรไฟล์ · ${o.name}`, branch: o.branch }]);
      return NextResponse.json({ ok: true });
    }
    const photo = typeof b.photo === "string" ? b.photo : "";
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(photo)) return bad("ไฟล์รูปไม่ถูกต้อง");
    if (photo.length > MAX) return bad("รูปใหญ่เกินไป");
    await sql`INSERT INTO profile_photos (kind, ref_id, photo, updated_by) VALUES (${kind}, ${id}, ${photo}, ${me.name})
      ON CONFLICT (kind, ref_id) DO UPDATE SET photo = EXCLUDED.photo, updated_by = EXCLUDED.updated_by, updated_at = now()`;
    await audit(req, me, [{ area, action: "update", recordId: id, summary: `เปลี่ยนรูปโปรไฟล์ · ${o.name}`, branch: o.branch }]);
    return NextResponse.json({ ok: true, v: Math.floor(Date.now() / 1000) });
  } catch (e) {
    return bad(/profile_photos/.test(String((e as Error)?.message)) ? "ยังไม่ได้สร้างตารางรูปโปรไฟล์ในฐานข้อมูล" : "บันทึกรูปไม่สำเร็จ", 500);
  }
}
