import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUser, forbidden, unauthorized } from "@/lib/auth";
import { can } from "@/lib/perms";
import type { SessionUser } from "@/lib/roles";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * รูปของแอปจัดยา (แยกจากข้อมูลยา จึงไม่ถูกดึงไปทุกครั้งที่ระบบรีเฟรช)
 *  POST { kind: "label" | "pack", id, photo }   label = รูปฉลากยาตอนรับเข้า · pack = รูปซองยาที่จัดเสร็จ
 *  GET  ?kind=…&ids=a,b                          รูปของหลายรายการ → { photos: { [id]: dataUrl } }
 *  ผู้ใช้ที่ไม่ใช่ผู้บริหารเห็นเฉพาะรูปของสาขาตัวเอง
 */
const KINDS = ["label", "pack"];
const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
const allowed = (me: SessionUser) => ["Global Admin", "Branch Admin", "Head Nurse"].includes(me.role) || can(me, "app.pharmacy") || can(me, "app.staff") || can(me, "residents");

export async function GET(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (!allowed(me)) return forbidden();
  const q = req.nextUrl.searchParams;
  const kind = q.get("kind") ?? "";
  if (!KINDS.includes(kind)) return bad("unknown kind");
  const ids = (q.get("ids") ?? "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 50);
  if (!ids.length) return NextResponse.json({ photos: {} });
  try {
    const rows = (me.role === "Global Admin"
      ? await sql`SELECT ref_id, photo FROM med_photos WHERE kind = ${kind} AND ref_id = ANY(${ids})`
      : await sql`SELECT ref_id, photo FROM med_photos WHERE kind = ${kind} AND ref_id = ANY(${ids}) AND (branch_name = ${me.branch} OR branch_name IS NULL)`) as { ref_id: string; photo: string }[];
    return NextResponse.json({ photos: Object.fromEntries(rows.map((r) => [r.ref_id, r.photo])) });
  } catch (e) {
    console.error("[api/medphoto]", e);
    return bad("database error", 500);
  }
}

export async function POST(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (!allowed(me)) return forbidden();
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const kind = String(b.kind ?? ""), id = String(b.id ?? "").slice(0, 60), photo = typeof b.photo === "string" ? b.photo : "";
  if (!KINDS.includes(kind) || !id) return bad("ข้อมูลไม่ครบ");
  if (!photo.startsWith("data:image/")) return bad("กรุณาถ่ายรูปก่อนบันทึก");
  if (photo.length > 900_000) return bad("รูปมีขนาดใหญ่เกินไป กรุณาถ่ายใหม่");
  try {
    await sql`INSERT INTO med_photos (kind, ref_id, branch_name, photo, taken_by) VALUES (${kind}, ${id}, ${me.role === "Global Admin" ? null : me.branch}, ${photo}, ${me.name})
      ON CONFLICT (kind, ref_id) DO UPDATE SET photo = EXCLUDED.photo, taken_by = EXCLUDED.taken_by, created_at = now()`;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/medphoto]", e);
    return bad("database error", 500);
  }
}
