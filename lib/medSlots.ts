/**
 * มื้อยาที่ต้องให้ (server เท่านั้น · ใช้ใน SQL)
 *  1 แถว = ยาตามมื้อ 1 ตัว × มื้อ 1 มื้อ × วัน 1 วัน (ยาที่ไม่ใช่ยาขวด · ไม่งด · สถานะปกติ · ตรงวันกิน · เพิ่มเข้าตะกร้าแล้วในวันนั้น)
 *  given = ให้ยาแล้ว: มีการเบิกยานั้นของมื้อนั้นในวันนั้น (ไม่นับที่ยกเลิก และไม่นับ "ไม่ได้ให้เพราะ…") หรือซองยาระบบเดิมของมื้อนั้นให้ยาแล้ว
 *  คอลัมน์: day · branch_name · resident_name · meal · drug_name · given · skip (เหตุผลที่ไม่ได้ให้ ถ้ามี)
 *  ใช้แทน medication_packs ในตัวชี้วัด "ให้ยาครบ" (lib/insights, lib/drill)
 */
const DOW = "ARRAY['อา.','จ.','อ.','พ.','พฤ.','ศ.','ส.']";
export const medSlotsSql = (from: string, to: string) => `(
  SELECT d.day, m.branch_name, m.resident_name, u.meal, m.drug_name,
    (EXISTS (SELECT 1 FROM med_withdrawals w WHERE w.med_id = m.id::text AND w.voided_at IS NULL AND w.skip_reason IS NULL
        AND (w.created_at AT TIME ZONE 'Asia/Bangkok')::date = d.day AND position(u.meal IN coalesce(w.meal, '')) > 0)
     OR EXISTS (SELECT 1 FROM medication_packs p WHERE p.pack_date = d.day AND p.given AND p.meal = u.meal
        AND (p.resident_id = m.resident_id OR (p.resident_id IS NULL AND p.resident_name = m.resident_name)))) AS given,
    (SELECT w.skip_reason FROM med_withdrawals w WHERE w.med_id = m.id::text AND w.voided_at IS NULL AND w.skip_reason IS NOT NULL
        AND (w.created_at AT TIME ZONE 'Asia/Bangkok')::date = d.day AND position(u.meal IN coalesce(w.meal, '')) > 0 LIMIT 1) AS skip
  FROM (SELECT generate_series(${from}, ${to}, interval '1 day')::date AS day) d
  JOIN resident_medications m ON (m.created_at AT TIME ZONE 'Asia/Bangkok')::date <= d.day
  CROSS JOIN LATERAL unnest(m.meals) AS u(meal)
  WHERE NOT m.is_bulk AND NOT m.on_hold AND coalesce(m.status, 'ปกติ') = 'ปกติ'
    AND (cardinality(m.schedule_days) = 0 OR (${DOW})[extract(dow FROM d.day)::int + 1] = ANY(m.schedule_days))
)`;
