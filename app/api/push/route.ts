import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUser, unauthorized } from "@/lib/auth";
import { pushKey, pushTo } from "@/lib/push";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * แจ้งเตือนบนโทรศัพท์ของบัญชีที่เข้าระบบอยู่
 *  GET                                              { key } = public key สำหรับ pushManager.subscribe (ว่าง = เซิร์ฟเวอร์ยังไม่ได้ตั้งกุญแจ)
 *  POST { op: "subscribe", sub: { endpoint, keys: { p256dh, auth } }, device? }   ลงทะเบียนเครื่องนี้ (เครื่องเดิมเปลี่ยนเจ้าของได้ = คนที่เข้าระบบล่าสุด)
 *  POST { op: "unsubscribe", endpoint }             ยกเลิกเครื่องนี้
 *  POST { op: "test" }                              ส่งแจ้งเตือนทดสอบถึงทุกเครื่องของฉัน
 */
const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const NO_TABLE = "ยังไม่ได้สร้างตารางแจ้งเตือน (push_subs) ในฐานข้อมูล";

export async function GET(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  return NextResponse.json({ key: pushKey() });
}

export async function POST(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const b = await req.json().catch(() => ({}));
  try {
    if (b.op === "subscribe") {
      const endpoint = str(b.sub?.endpoint, 1000), p256dh = str(b.sub?.keys?.p256dh, 200), auth = str(b.sub?.keys?.auth, 100);
      if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) return bad("ข้อมูลเครื่องไม่ถูกต้อง");
      await sql`INSERT INTO push_subs (id, user_id, endpoint, p256dh, auth, device) VALUES (${randomUUID()}, ${me.id}, ${endpoint}, ${p256dh}, ${auth}, ${str(b.device, 80) || null})
        ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, device = EXCLUDED.device`;
      return NextResponse.json({ ok: true });
    }
    if (b.op === "unsubscribe") {
      await sql`DELETE FROM push_subs WHERE endpoint = ${str(b.endpoint, 1000)} AND user_id = ${me.id}`;
      return NextResponse.json({ ok: true });
    }
    if (b.op === "test") {
      if (!pushKey()) return bad("เซิร์ฟเวอร์ยังไม่ได้ตั้งค่าการแจ้งเตือน");
      const sent = await pushTo([me.id], { title: "KinApp", body: "เครื่องนี้รับแจ้งเตือนได้แล้ว · จะเด้งเมื่อหัวหน้าตามงาน", url: "/staff", tag: "kin-test" });
      return NextResponse.json({ ok: true, sent });
    }
    return bad("ไม่รู้จักคำสั่งนี้");
  } catch (e) {
    const m = String((e as Error)?.message ?? "");
    return bad(/push_subs/.test(m) && /does not exist/.test(m) ? NO_TABLE : "บันทึกไม่สำเร็จ", 500);
  }
}
