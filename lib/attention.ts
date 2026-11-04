// ใช้ฝั่ง server เท่านั้น: เรื่องที่ต้องจัดการ ณ ตอนนี้ · ชุดเดียวกันทั้งการ์ด "สิ่งที่ต้องทำวันนี้" (หน้าแรก)
// และแถบ "ต้องจัดการ" (ภาพรวมและรายงาน) ตัวเลขจึงตรงกันทุกที่ · ส่งเฉพาะเรื่องที่บัญชีนี้มีสิทธิ์ · br ว่าง = ทุกสาขา
import { sql } from "@/lib/db";
import { can } from "@/lib/perms";
import type { SessionUser } from "@/lib/roles";

export async function attention(me: SessionUser, br: string | null) {
  const p = br ? [br] : [];
  const w = (col: string) => (br ? `AND ${col} = $1` : "");
  const TODAY = "(now() AT TIME ZONE 'Asia/Bangkok')::date";
  const out: Record<string, unknown> = {};
  if (can(me, "tasks") || can(me, "tasks.review")) {
    out.review = await sql(`SELECT shift, count(*)::int AS n FROM daily_tasks WHERE work_date = ${TODAY} AND status = 'เสร็จแล้ว' ${w("branch_name")} GROUP BY shift`, p);
    // งานวันนี้ที่เลยเวลาเกิน 30 นาทีแล้วยังไม่ส่ง (งานกะดึกก่อน 07:00 เป็นเวลาของเช้าวันถัดไป) · เกณฑ์เดียวกับหน้ามอบหมายงาน
    out.late = await sql(`SELECT task_name AS task, resident_name AS name FROM daily_tasks
        WHERE work_date = ${TODAY} AND status = 'รอทำ' AND scheduled_time IS NOT NULL ${w("branch_name")}
          AND work_date + scheduled_time + (CASE WHEN shift = 'กะดึก' AND scheduled_time < time '07:00' THEN interval '1 day' ELSE interval '0' END) + interval '30 minutes'
            < (now() AT TIME ZONE 'Asia/Bangkok')
        ORDER BY scheduled_time LIMIT 100`, p);
  }
  if (can(me, "health_logs") || can(me, "residents")) {
    // ค่าสัญญาณชีพผิดปกติที่ยังไม่มีพยาบาลกดรับทราบ (นานสุดกี่นาที)
    [out.alerts] = await sql(`SELECT count(*)::int AS n, coalesce(max(extract(epoch FROM now() - created_at) / 60), 0)::int AS oldest
        FROM care_alerts WHERE status = 'open' ${w("branch_name")}`, p);
  }
  if (can(me, "billing")) {
    [out.bills] = await sql(`SELECT count(*)::int AS n, coalesce(sum(net - coalesce(paid_total, 0)), 0)::float AS sum, to_char(min(doc_date), 'YYYY-MM-DD') AS oldest
      FROM invoices WHERE status IN ('ค้างชำระ', 'ชำระบางส่วน') ${w("branch_name")}`, p);
    [out.debt60] = await sql(`SELECT count(*)::int AS n, coalesce(sum(net - coalesce(paid_total, 0)), 0)::float AS sum
      FROM invoices WHERE status IN ('ค้างชำระ', 'ชำระบางส่วน') AND doc_date < ${TODAY} - 60 ${w("branch_name")}`, p);
    const [ph] = (await sql(`SELECT count(*)::int AS n FROM clinical_notes WHERE kind = 'physio' AND data->>'nocourse' = 'true' AND invoice_id IS NULL ${w("branch_name")}`, p)) as { n: number }[];
    out.physio = ph.n;
    const [dr] = (await sql(`SELECT count(*)::int AS n FROM invoices WHERE status = 'รอตรวจสอบยอด' ${w("branch_name")}`, p)) as { n: number }[];
    out.drafts = dr.n;
    const [cu] = (await sql(`SELECT count(*)::int AS n FROM physio_courses WHERE coalesce(price, 0) > 0 AND invoice_id IS NULL ${w("branch_name")}`, p)) as { n: number }[];
    out.courses = cu.n;
    // วันที่มีการรับเงินแต่ยังไม่ปิดยอด (7 วันก่อนหน้า ไม่รวมวันนี้) · ตารางปิดยอดยังไม่ถูกสร้าง = ไม่แสดง
    try {
      out.unclosed = await sql(`SELECT DISTINCT p.pay_date::text AS date, i.branch_name AS branch FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
          WHERE p.pay_date >= ${TODAY} - 7 AND p.pay_date < ${TODAY} ${w("i.branch_name")}
            AND NOT EXISTS (SELECT 1 FROM cash_closes c WHERE c.branch_name = i.branch_name AND c.close_date = p.pay_date)
          ORDER BY 1`, p);
    } catch { /* ยังไม่ได้รัน db:setup */ }
    // สัญญาที่ใช้งานอยู่แต่ยังไม่มีใบรายเดือน/แรกเข้า ลงวันที่เดือนนี้ (ครบรอบบิล)
    out.monthDue = await sql(`SELECT c.contract_no AS no, c.resident_name AS name FROM contracts c WHERE c.status = 'ใช้งานอยู่' ${w("c.branch_name")}
        AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.contract_no = c.contract_no AND i.status <> 'ยกเลิก' AND i.category IN ('ค่าบริการรายเดือน', 'มัดจำ / แรกเข้า')
          AND date_trunc('month', i.doc_date) = date_trunc('month', ${TODAY}))
      ORDER BY c.contract_no LIMIT 100`, p);
  }
  if (can(me, "contracts") || can(me, "billing")) {
    out.deposit = await sql(`SELECT c.contract_no AS no, c.resident_name AS name,
        EXISTS (SELECT 1 FROM invoices i WHERE i.contract_no = c.contract_no AND i.status <> 'ยกเลิก') AS billed
      FROM contracts c WHERE c.status = 'รอชำระเงินมัดจำ' ${w("c.branch_name")} ORDER BY c.created_at LIMIT 20`, p);
  }
  if (can(me, "residents") || can(me, "app.pharmacy")) {
    // เกณฑ์เดียวกับแอปจัดยา: เหลือไม่พอ 2 วัน (ยาขวด/ยาทาเหลือ 1) · ไม่นับยาที่งดหรือผู้ที่ย้ายออกแล้ว
    const [m] = (await sql(`SELECT count(*)::int AS n FROM resident_medications m WHERE NOT m.on_hold
        AND coalesce(m.stock, 0) <= CASE WHEN m.is_bulk THEN 1 ELSE coalesce(m.dose, 0) * cardinality(m.meals) * 2 END
        AND NOT EXISTS (SELECT 1 FROM residents r WHERE r.full_name = m.resident_name AND r.branch_name = m.branch_name AND r.status LIKE 'ย้ายออก%') ${w("m.branch_name")}`, p)) as { n: number }[];
    const [sp] = (await sql(`SELECT count(*)::int AS n FROM supply_items WHERE stock <= 5 ${w("branch_name")}`, p)) as { n: number }[];
    const [ce] = (await sql(`SELECT count(*)::int AS n FROM (SELECT 1 FROM stock_lots l JOIN stock_drugs d ON d.id = l.drug_id WHERE true ${w("l.branch_name")}
        GROUP BY d.id, d.min_qty, l.branch_name HAVING sum(l.qty) <= d.min_qty OR min(l.expiry) FILTER (WHERE l.qty > 0) <= ${TODAY} + 60) x`, p)) as { n: number }[];
    out.stock = { meds: m.n, supplies: sp.n, central: ce.n };
  }
  if (can(me, "rooms")) {
    // ผู้รับบริการที่ยังพักอยู่ (ไม่ใช่ย้ายออก) แต่ยังไม่ได้ระบุห้อง · เกณฑ์เดียวกับทะเบียนผู้รับบริการ
    const [r] = (await sql(`SELECT count(*)::int AS n FROM residents WHERE coalesce(status, '') NOT LIKE 'ย้ายออก%' AND (room IS NULL OR trim(room) IN ('', '-')) ${w("branch_name")}`, p)) as { n: number }[];
    out.noRoom = r.n;
  }
  if (can(me, "roster")) {
    // เวรวันนี้ที่เลยเวลาเข้างาน + ผ่อนผัน 15 นาทีแล้วยังไม่เช็คชื่อ (เกณฑ์เดียวกับ KPI)
    out.checkin = await sql(`SELECT s.staff_name AS name, s.shift FROM staff_shifts s WHERE s.shift_date = ${TODAY} ${w("s.branch_name")}
        AND (now() AT TIME ZONE 'Asia/Bangkok')::time >= (CASE WHEN s.shift = 'ดึก' THEN time '19:15' ELSE time '07:15' END)
        AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.staff_id = s.staff_id AND a.work_date = s.shift_date AND a.shift = s.shift AND a.kind = 'in')
      ORDER BY s.shift, s.staff_name`, p);
    // วันนี้ถึงสิ้นเดือนที่ยังไม่มีคนเข้าเวรครบทั้งเช้าและดึก (นับเฉพาะสาขาที่มีผู้รับบริการพักอยู่) · เกณฑ์เดียวกับหน้าตารางเวร
    const [g] = (await sql(`SELECT count(*)::int AS n FROM (
        SELECT b.name, d::date AS day FROM generate_series(${TODAY}, (date_trunc('month', ${TODAY}) + interval '1 month - 1 day')::date, interval '1 day') d
        CROSS JOIN (SELECT DISTINCT branch_name AS name FROM residents WHERE coalesce(status, '') NOT LIKE 'ย้ายออก%' ${w("branch_name")}) b
        WHERE (SELECT count(DISTINCT shift) FROM staff_shifts s WHERE s.branch_name = b.name AND s.shift_date = d::date) < 2) x`, p)) as { n: number }[];
    out.rosterGap = g.n;
  }
  return out;
}
