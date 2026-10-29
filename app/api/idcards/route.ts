import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUser, forbidden, unauthorized } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { can } from "@/lib/perms";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * รูปถ่ายบัตรประชาชนในสัญญา (ข้อมูลส่วนบุคคล · เก็บแยกจากรายการสัญญา ไม่ถูกโหลดไปกับทะเบียน)
 * เฉพาะผู้มีสิทธิ์เมนูสัญญาบริการ · เห็นเฉพาะสาขาตัวเอง (ยกเว้นผู้บริหาร) · ทุกครั้งที่เปิดดูหรือเปลี่ยนรูปบันทึกในประวัติการแก้ไข
 *  GET  ?id=…                              รูปทั้งสองใบของสัญญา (บันทึกว่าใครเปิดดู)
 *  GET  ?id=…&check=1                      มีรูปหรือไม่ (ไม่ส่งรูป ไม่บันทึกประวัติ)
 *  POST { id, employer?, resident?, copyFrom? }   แนบ/เปลี่ยนรูป ("" = ลบ · ไม่ส่ง = ไม่เปลี่ยน) · copyFrom = ใช้รูปจากสัญญาเดิม (ต่อสัญญา)
 */
const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
type Row = { id: string; contract_no: string | null; resident_name: string | null; branch_name: string | null; employer_id_photo: string | null; resident_id_photo: string | null };

async function load(req: NextRequest, id: string) {
  const me = await currentUser(req);
  if (!me) return { res: unauthorized() };
  if (!can(me, "contracts")) return { res: forbidden() };
  const [c] = (await sql`SELECT id, contract_no, resident_name, branch_name, employer_id_photo, resident_id_photo FROM contracts WHERE id = ${id}`) as Row[];
  if (!c) return { res: bad("ไม่พบสัญญา", 404) };
  if (me.role !== "Global Admin" && c.branch_name !== me.branch) return { res: forbidden() };
  return { me, c };
}
const okPhoto = (x: unknown) => typeof x === "string" && (x === "" || (x.startsWith("data:image/") && x.length <= 900_000));

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const o = await load(req, q.get("id") ?? "");
  if (!o.c) return o.res;
  const { c } = o;
  if (q.get("check")) return NextResponse.json({ employer: !!c.employer_id_photo, resident: !!c.resident_id_photo });
  if (c.employer_id_photo || c.resident_id_photo)
    await audit(req, o.me, [{ area: "contracts", action: "view_idcard", recordId: c.id, summary: `${c.contract_no ?? ""} · ${c.resident_name ?? ""} · เปิดดูรูปบัตรประชาชน`, branch: c.branch_name }]);
  return NextResponse.json({ employer: c.employer_id_photo, resident: c.resident_id_photo });
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const o = await load(req, String(b.id ?? ""));
  if (!o.c) return o.res;
  const { c } = o;
  let employer = b.employer, resident = b.resident;
  if (employer !== undefined && !okPhoto(employer)) return bad("รูปบัตรผู้ว่าจ้างไม่ถูกต้องหรือมีขนาดใหญ่เกินไป");
  if (resident !== undefined && !okPhoto(resident)) return bad("รูปบัตรผู้รับบริการไม่ถูกต้องหรือมีขนาดใหญ่เกินไป");
  if (b.copyFrom) {
    // ต่อสัญญา: รูปที่ไม่ได้แนบใหม่ ใช้ของสัญญาเดิม (ต้องเป็นสัญญาที่ผู้ใช้เปิดได้)
    const old = await load(req, String(b.copyFrom));
    if (old.c) { employer ??= old.c.employer_id_photo ?? undefined; resident ??= old.c.resident_id_photo ?? undefined; }
  }
  if (employer === undefined && resident === undefined) return NextResponse.json({ ok: true });
  await sql`UPDATE contracts SET
      employer_id_photo = ${employer === undefined ? c.employer_id_photo : employer || null},
      resident_id_photo = ${resident === undefined ? c.resident_id_photo : resident || null},
      updated_at = now()
    WHERE id = ${c.id}`;
  const what = [employer !== undefined && (employer ? "แนบรูปบัตรผู้ว่าจ้าง" : "ลบรูปบัตรผู้ว่าจ้าง"), resident !== undefined && (resident ? "แนบรูปบัตรผู้รับบริการ" : "ลบรูปบัตรผู้รับบริการ")].filter(Boolean).join(", ");
  await audit(req, o.me, [{ area: "contracts", action: "update", recordId: c.id, summary: `${c.contract_no ?? ""} · ${c.resident_name ?? ""} · ${what}`, branch: c.branch_name }]);
  return NextResponse.json({ ok: true });
}
