import { sql } from "./db";

/**
 * "ดูแลโดย": พนักงานที่ดูแลผู้รับบริการคนนี้จริง ใน 90 วันล่าสุด
 * (ส่งงานประจำวัน บันทึกสัญญาณชีพ หรือส่งข่าวถึงญาติ) · ถ้ายังไม่มีบันทึกเลย ใช้พนักงานที่เข้าเวรของสาขาใน 14 วันล่าสุดแทน
 * ใช้ทั้งในตารางลิงก์ครอบครัวและเป็นรายชื่อที่ญาติรีวิวได้ (รีวิวได้เฉพาะรายชื่อนี้)
 */
export async function carersOf(branch: string, residentId: string | null, residentName: string) {
  const rid = residentId ?? "";
  const direct = (await sql`
    SELECT DISTINCT u.id, u.full_name AS name FROM staff_users u
    WHERE u.branch_name = ${branch} AND u.status = 'ทำงาน' AND u.full_name IN (
      SELECT done_by FROM daily_tasks WHERE (resident_id = ${rid} OR (resident_id IS NULL AND resident_name = ${residentName})) AND work_date > current_date - 90 AND done_by IS NOT NULL
      UNION SELECT recorded_by FROM health_logs WHERE (resident_id = ${rid} OR (resident_id IS NULL AND resident_name = ${residentName})) AND recorded_at > now() - interval '90 days' AND recorded_by IS NOT NULL
      UNION SELECT posted_by FROM family_updates WHERE resident_id = ${rid} AND created_at > now() - interval '90 days' AND posted_by IS NOT NULL)
    ORDER BY u.full_name`) as { id: string; name: string }[];
  if (direct.length) return { list: direct, fromShifts: false };
  const shifts = (await sql`
    SELECT DISTINCT u.id, u.full_name AS name FROM staff_shifts s JOIN staff_users u ON u.id = s.staff_id
    WHERE s.branch_name = ${branch} AND u.status = 'ทำงาน' AND s.shift_date > current_date - 14 AND s.shift_date <= current_date
    ORDER BY u.full_name`) as { id: string; name: string }[];
  return { list: shifts, fromShifts: true };
}
