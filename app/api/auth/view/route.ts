import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUser, forbidden, packView, unauthorized, VIEW_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * ผู้บริหารเลือกดูทีละสาขา (ป้าย "กำลังดู" บนแถบด้านบน / การ์ดสาขาในแถบซ้าย)
 *  POST { branch } = ดูในฐานะสาขานั้น (ทุกหน้าเห็นและบันทึกเฉพาะสาขานั้น) · { branch: "" } = กลับไปดูทุกสาขา
 *  ตรวจตำแหน่งจริง (viewAs) เพื่อให้สลับสาขา/กลับได้แม้กำลังดูในฐานะสาขาอยู่
 */
export async function POST(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if ((me.viewAs ?? me.role) !== "Global Admin") return forbidden("เลือกดูทีละสาขาได้เฉพาะผู้บริหาร");
  const b = await req.json().catch(() => ({}));
  const branch = typeof b.branch === "string" ? b.branch.trim().slice(0, 120) : "";
  const res = NextResponse.json({ ok: true, branch });
  if (!branch) { res.cookies.set(VIEW_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 }); return res; }
  const [row] = await sql`SELECT name FROM branches WHERE name = ${branch} LIMIT 1`;
  if (!row) return NextResponse.json({ error: "ไม่พบสาขานี้" }, { status: 400 });
  res.cookies.set(VIEW_COOKIE, packView(branch), { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 12 * 3600 });
  return res;
}
