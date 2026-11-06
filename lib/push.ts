import webpush from "web-push";
import { sql } from "./db";

/**
 * แจ้งเตือนบนโทรศัพท์ (Web Push) · ใช้เฉพาะฝั่ง server
 * กุญแจอยู่ใน env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (ไม่ตั้ง = ไม่ส่ง ระบบอื่นทำงานปกติ)
 * เครื่องที่ยกเลิกแล้ว (404/410) ลบออกจาก push_subs ให้เอง
 * ข้อความเห็นได้บนหน้าจอล็อก: ใส่แค่ชื่องาน ชื่อผู้รับบริการ และเวลา ห้ามใส่ข้อมูลสุขภาพ
 */
export type PushMsg = { title: string; body: string; url?: string; tag?: string };

export const pushKey = () => process.env.VAPID_PUBLIC_KEY ?? "";
let ready = false;
function setup() {
  if (ready) return true;
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || "https://nursing-home-kin.vercel.app", pub, priv);
  ready = true;
  return true;
}

/** ส่งถึงทุกเครื่องของพนักงานเหล่านี้ · คืนจำนวนเครื่องที่ส่งสำเร็จ · ไม่ throw (แจ้งเตือนล้มเหลวต้องไม่ทำให้งานหลักล้ม) */
export async function pushTo(userIds: string[], msg: PushMsg): Promise<number> {
  if (!userIds.length || !setup()) return 0;
  try {
    const subs = (await sql`SELECT id, endpoint, p256dh, auth FROM push_subs WHERE user_id = ANY(${userIds})`) as { id: string; endpoint: string; p256dh: string; auth: string }[];
    const payload = JSON.stringify(msg), ok: string[] = [], dead: string[] = [];
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600, urgency: "high" });
        ok.push(s.id);
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.push(s.id);
      }
    }));
    if (dead.length) await sql`DELETE FROM push_subs WHERE id = ANY(${dead})`;
    if (ok.length) await sql`UPDATE push_subs SET last_ok_at = now() WHERE id = ANY(${ok})`;
    return ok.length;
  } catch { return 0; }
}

/**
 * พยาบาลที่อยู่เวรของงานนั้น (ตารางเวร วันที่ของงาน + กะ "กะเช้า"/"กะดึก")
 * งานกะดึกของวันที่ D (รวมช่วงหลังเที่ยงคืนก่อน 07:00) เป็นเวรดึกที่เริ่ม 19:00 ของวันที่ D
 * ยังไม่ได้จัดใครเข้าเวรนั้น = พยาบาลทุกคนในสาขา (เหมือนเดิม)
 */
export async function shiftStaffIds(branch: string, workDate: string, shift?: string | null): Promise<string[]> {
  const sh = String(shift ?? "").replace(/^กะ/, "");
  if (sh) {
    try {
      const rows = (await sql`SELECT s.staff_id AS id FROM staff_shifts s JOIN staff_users u ON u.id = s.staff_id
        WHERE s.branch_name = ${branch} AND s.shift_date = ${workDate}::date AND s.shift = ${sh} AND u.status = 'ทำงาน'`) as { id: string }[];
      if (rows.length) return rows.map((r) => r.id);
    } catch { /* ใช้ทุกคนในสาขาแทน */ }
  }
  return staffIds(branch, null);
}

/** พนักงานที่ยังทำงานอยู่ในสาขา: ระบุชื่อ = เฉพาะคนนั้น · ไม่ระบุ = พยาบาลและหัวหน้าพยาบาลทุกคนในสาขา */
export async function staffIds(branch: string, name?: string | null): Promise<string[]> {
  try {
    const rows = (name
      ? await sql`SELECT id FROM staff_users WHERE status = 'ทำงาน' AND branch_name = ${branch} AND full_name = ${name}`
      : await sql`SELECT id FROM staff_users WHERE status = 'ทำงาน' AND branch_name = ${branch} AND access_level IN ('Nurse', 'Head Nurse')`) as { id: string }[];
    return rows.map((r) => r.id);
  } catch { return []; }
}
