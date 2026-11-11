// ใช้ฝั่ง server เท่านั้น: เรื่องที่ต้องจัดการ ณ ตอนนี้ · ชุดเดียวกันทั้งการ์ด "สิ่งที่ต้องทำวันนี้" (หน้าแรก)
// และแถบ "ต้องจัดการ" (ภาพรวมและรายงาน) ตัวเลขจึงตรงกันทุกที่ · ส่งเฉพาะเรื่องที่บัญชีนี้มีสิทธิ์ · br ว่าง = ทุกสาขา
import { sql } from "@/lib/db";
import { can } from "@/lib/perms";
import type { SessionUser } from "@/lib/roles";
import { fromDb, selectExpr, specFor } from "@/lib/schema";
import type { Invoice } from "@/lib/billing";
import { bkkToday, cycleDue, nextCycle } from "@/lib/servicePeriod";

/**
 * สัญญารายเดือนที่ครบรอบบิลแล้วหรือจะครบภายใน 7 วัน แต่ยังไม่มีใบของรอบนั้น
 *  รอบบิลนับตามวันเริ่มสัญญาและเดือนที่ชำระล่วงหน้าแล้ว (ตัวเดียวกับหน้าใบแจ้งหนี้ · lib/servicePeriod nextCycle)
 */
async function cyclesDue(br: string | null) {
  const spec = specFor("contracts")!;
  const raw = (await sql(`SELECT ${spec.cols.map(selectExpr).join(", ")} FROM contracts WHERE status = 'ใช้งานอยู่' ${br ? "AND branch_name = $1" : ""} ORDER BY contract_no`, br ? [br] : [])) as Record<string, unknown>[];
  const rows = raw.map((r) => spec.cols.map((c) => String(fromDb(c.t, r[c.col], "rows") ?? "")));
  if (!rows.length) return [];
  const inv = (await sql(`SELECT doc_date::text AS date, category AS kind, contract_no AS contract, items_json AS items, note, status
      FROM invoices WHERE contract_no = ANY($1) AND status <> 'ยกเลิก' AND category IN ('มัดจำ / แรกเข้า', 'ค่าบริการรายเดือน')`, [rows.map((r) => r[0])])) as unknown as Invoice[];
  const today = bkkToday();
  return rows.map((c) => ({ no: c[0], name: c[2], due: nextCycle(c, inv.filter((x) => x.contract === c[0])) }))
    .filter((x): x is { no: string; name: string; due: string } => cycleDue(x.due, today))
    .sort((a, b) => a.due.localeCompare(b.due));
}

/**
 * ผลลัพธ์ใช้ร่วมกันต่อ (สาขา + ชุดสิทธิ์) 30 วินาที · คนในสาขาเดียวกันที่สิทธิ์เหมือนกันเห็นชุดเดียวกันอยู่แล้ว
 *  เก็บเป็น Promise จึงรวมคำขอที่มาพร้อมกันให้คำนวณครั้งเดียว (เช่น ช่วงเปลี่ยนกะที่เปิดแอปพร้อมกัน)
 *  แคชอยู่ในหน่วยความจำของเซิร์ฟเวอร์แต่ละตัว · ข้อมูลช้ากว่าความจริงได้ไม่เกิน 30 วินาที (หน้าจอดึงใหม่ทุก 1 นาทีอยู่แล้ว)
 */
const SHARE_MS = 30_000;
const shared = new Map<string, { at: number; p: Promise<Record<string, unknown>> }>();
export function attention(me: SessionUser, br: string | null) {
  const flags = [can(me, "tasks") || can(me, "tasks.review"), can(me, "health_logs") || can(me, "residents"), can(me, "billing"), can(me, "contracts") || can(me, "billing"),
    can(me, "residents") || can(me, "app.pharmacy"), can(me, "rooms"), can(me, "roster"), can(me, "physio.assign")];
  const key = `${br ?? "*"}|${flags.map(Number).join("")}`, now = Date.now(), hit = shared.get(key);
  if (hit && now - hit.at < SHARE_MS) return hit.p;
  const p = compute(flags, br);
  shared.set(key, { at: now, p });
  p.catch(() => shared.delete(key)); // ผิดพลาด = ไม่เก็บไว้ คำขอถัดไปคำนวณใหม่
  if (shared.size > 200) for (const [k, v] of shared) if (now - v.at >= SHARE_MS) shared.delete(k);
  return p;
}

/** คำนวณทุกเรื่องพร้อมกัน (เดิมถามฐานข้อมูลทีละเรื่องต่อกัน 18 ครั้ง) */
async function compute([tasks, health, billing, contracts, stock, rooms, roster, physio]: boolean[], br: string | null) {
  const p = br ? [br] : [];
  const w = (col: string) => (br ? `AND ${col} = $1` : "");
  const TODAY = "(now() AT TIME ZONE 'Asia/Bangkok')::date";
  const out: Record<string, unknown> = {};
  const jobs: Promise<unknown>[] = [];
  const job = <T,>(f: () => Promise<T>, set: (v: T) => void) => jobs.push(f().then(set));
  const q = (text: string) => sql(text, p) as Promise<Record<string, unknown>[]>;
  const n = (rows: Record<string, unknown>[]) => (rows[0]?.n as number) ?? 0;
  if (tasks) {
    job(() => q(`SELECT shift, count(*)::int AS n FROM daily_tasks WHERE work_date = ${TODAY} AND status = 'เสร็จแล้ว' ${w("branch_name")} GROUP BY shift`), (v) => { out.review = v; });
    // งานวันนี้ที่เลยเวลาเกิน 30 นาทีแล้วยังไม่ส่ง (งานกะดึกก่อน 07:00 เป็นเวลาของเช้าวันถัดไป) · เกณฑ์เดียวกับหน้ามอบหมายงาน
    job(() => q(`SELECT task_name AS task, resident_name AS name FROM daily_tasks
        WHERE work_date = ${TODAY} AND status = 'รอทำ' AND scheduled_time IS NOT NULL ${w("branch_name")}
          AND work_date + scheduled_time + (CASE WHEN shift = 'กะดึก' AND scheduled_time < time '07:00' THEN interval '1 day' ELSE interval '0' END) + interval '30 minutes'
            < (now() AT TIME ZONE 'Asia/Bangkok')
        ORDER BY scheduled_time LIMIT 100`), (v) => { out.late = v; });
  }
  if (health) {
    // ค่าสัญญาณชีพผิดปกติที่ยังไม่มีพยาบาลกดรับทราบ (นานสุดกี่นาที)
    job(() => q(`SELECT count(*)::int AS n, coalesce(max(extract(epoch FROM now() - created_at) / 60), 0)::int AS oldest
        FROM care_alerts WHERE status = 'open' ${w("branch_name")}`), (v) => { out.alerts = v[0]; });
  }
  if (billing) {
    job(() => q(`SELECT count(*)::int AS n, coalesce(sum(net - coalesce(paid_total, 0)), 0)::float AS sum, to_char(min(doc_date), 'YYYY-MM-DD') AS oldest
      FROM invoices WHERE status IN ('ค้างชำระ', 'ชำระบางส่วน') ${w("branch_name")}`), (v) => { out.bills = v[0]; });
    job(() => q(`SELECT count(*)::int AS n, coalesce(sum(net - coalesce(paid_total, 0)), 0)::float AS sum
      FROM invoices WHERE status IN ('ค้างชำระ', 'ชำระบางส่วน') AND doc_date < ${TODAY} - 60 ${w("branch_name")}`), (v) => { out.debt60 = v[0]; });
    job(() => q(`SELECT count(*)::int AS n FROM clinical_notes WHERE kind = 'physio' AND data->>'nocourse' = 'true' AND invoice_id IS NULL ${w("branch_name")}`), (v) => { out.physio = n(v); });
    job(() => q(`SELECT count(*)::int AS n FROM invoices WHERE status = 'รอตรวจสอบยอด' ${w("branch_name")}`), (v) => { out.drafts = n(v); });
    job(() => q(`SELECT count(*)::int AS n FROM physio_courses WHERE coalesce(price, 0) > 0 AND invoice_id IS NULL ${w("branch_name")}`), (v) => { out.courses = n(v); });
    // วันที่มีการรับเงินแต่ยังไม่ปิดยอด (7 วันก่อนหน้า ไม่รวมวันนี้) · ตารางปิดยอดยังไม่ถูกสร้าง = ไม่แสดง
    job(() => q(`SELECT DISTINCT p.pay_date::text AS date, i.branch_name AS branch FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
          WHERE p.pay_date >= ${TODAY} - 7 AND p.pay_date < ${TODAY} ${w("i.branch_name")}
            AND NOT EXISTS (SELECT 1 FROM cash_closes c WHERE c.branch_name = i.branch_name AND c.close_date = p.pay_date)
          ORDER BY 1`).catch(() => undefined /* ยังไม่ได้รัน db:setup */), (v) => { if (v) out.unclosed = v; });
    // ครบรอบบิล (ตามวันเริ่มสัญญา) แล้วหรือภายใน 7 วัน ยังไม่ออกใบของรอบนั้น
    job(() => cyclesDue(br), (v) => { out.monthDue = v; });
  }
  if (contracts) {
    job(() => q(`SELECT c.contract_no AS no, c.resident_name AS name,
        EXISTS (SELECT 1 FROM invoices i WHERE i.contract_no = c.contract_no AND i.status <> 'ยกเลิก') AS billed
      FROM contracts c WHERE c.status = 'รอชำระเงินมัดจำ' ${w("c.branch_name")} ORDER BY c.created_at LIMIT 20`), (v) => { out.deposit = v; });
  }
  if (stock) {
    // เกณฑ์เดียวกับแอปจัดยา: เหลือไม่พอ 2 วัน (ยาขวด/ยาทาเหลือ 1) · ไม่นับยาที่งดหรือผู้ที่ย้ายออกแล้ว
    job(() => Promise.all([
      q(`SELECT count(*)::int AS n FROM resident_medications m WHERE NOT m.on_hold
        AND coalesce(m.stock, 0) <= CASE WHEN m.is_bulk THEN 1 ELSE coalesce(m.dose, 0) * cardinality(m.meals) * 2 END
        AND NOT EXISTS (SELECT 1 FROM residents r WHERE r.full_name = m.resident_name AND r.branch_name = m.branch_name AND r.status LIKE 'ย้ายออก%') ${w("m.branch_name")}`),
      q(`SELECT count(*)::int AS n FROM supply_items WHERE stock <= 5 ${w("branch_name")}`),
      q(`SELECT count(*)::int AS n FROM (SELECT 1 FROM stock_lots l JOIN stock_drugs d ON d.id = l.drug_id WHERE true ${w("l.branch_name")}
        GROUP BY d.id, d.min_qty, l.branch_name HAVING sum(l.qty) <= d.min_qty OR min(l.expiry) FILTER (WHERE l.qty > 0) <= ${TODAY} + 60) x`),
    ]), ([m, sp, ce]) => { out.stock = { meds: n(m), supplies: n(sp), central: n(ce) }; });
  }
  if (rooms) {
    // ผู้รับบริการที่ยังพักอยู่ (ไม่ใช่ย้ายออก) แต่ยังไม่ได้ระบุห้อง · เกณฑ์เดียวกับทะเบียนผู้รับบริการ
    //  ไม่นับคนที่จองห้องไว้แล้ว (สัญญารอชำระมัดจำที่เลือกห้องแล้ว) เพราะอยู่ในเรื่อง "รอชำระมัดจำ"
    job(() => q(`SELECT r.full_name AS name FROM residents r WHERE coalesce(r.status, '') NOT LIKE 'ย้ายออก%' AND (r.room IS NULL OR trim(r.room) IN ('', '-')) ${w("r.branch_name")}
        AND NOT EXISTS (SELECT 1 FROM contracts c WHERE c.resident_name = r.full_name AND c.branch_name = r.branch_name AND c.status = 'รอชำระเงินมัดจำ' AND coalesce(trim(c.room), '') NOT IN ('', '-'))
      ORDER BY r.full_name LIMIT 100`), (v) => { out.noRoom = v; });
  }
  if (roster) {
    // เวรวันนี้ที่เลยเวลาเข้างาน + ผ่อนผัน 15 นาทีแล้วยังไม่เช็คชื่อ (เกณฑ์เดียวกับ KPI)
    job(() => q(`SELECT s.staff_name AS name, s.shift FROM staff_shifts s WHERE s.shift_date = ${TODAY} ${w("s.branch_name")}
        AND (now() AT TIME ZONE 'Asia/Bangkok')::time >= (CASE WHEN s.shift = 'ดึก' THEN time '19:15' ELSE time '07:15' END)
        AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.staff_id = s.staff_id AND a.work_date = s.shift_date AND a.shift = s.shift AND a.kind = 'in')
      ORDER BY s.shift, s.staff_name`), (v) => { out.checkin = v; });
    // วันนี้ถึงสิ้นเดือนที่ยังไม่มีคนเข้าเวรครบทั้งเช้าและดึก (นับเฉพาะสาขาที่มีผู้รับบริการพักอยู่) · เกณฑ์เดียวกับหน้าตารางเวร
    //  n = จำนวนวัน (ไม่นับซ้ำสาขา) · first = วันแรกที่ยังขาด · soon = ขาดภายใน 3 วัน (วันนี้ถึงมะรืน) · branches = จำนวนสาขาที่ขาด
    job(() => q(`SELECT count(DISTINCT day)::int AS n, min(day)::text AS first, count(DISTINCT day) FILTER (WHERE day <= ${TODAY} + 2)::int AS soon, count(DISTINCT name)::int AS branches FROM (
        SELECT b.name, d::date AS day FROM generate_series(${TODAY}, (date_trunc('month', ${TODAY}) + interval '1 month - 1 day')::date, interval '1 day') d
        CROSS JOIN (SELECT DISTINCT branch_name AS name FROM residents WHERE coalesce(status, '') NOT LIKE 'ย้ายออก%' ${w("branch_name")}) b
        WHERE (SELECT count(DISTINCT shift) FROM staff_shifts s WHERE s.branch_name = b.name AND s.shift_date = d::date) < 2) x`), (v) => { out.rosterGap = v[0]; });
  }
  if (physio) {
    // คอร์สกายภาพที่ยังเหลือครั้ง แต่ยังไม่มีนักกายภาพผู้รับผิดชอบ (ทำได้ทันทีหลังซื้อ ไม่ต้องรอใบแจ้งหนี้)
    job(() => q(`SELECT c.resident_name AS name FROM physio_courses c LEFT JOIN residents r ON r.id = c.resident_id
        WHERE c.used < c.total AND c.therapist_id IS NULL AND coalesce(r.status, '') NOT LIKE 'ย้ายออก%' ${w("c.branch_name")}
        ORDER BY c.created_at LIMIT 50`), (v) => { out.physioOpen = v; });
    // เมื่อวานมีนัดตามแผน แต่ไม่มีบันทึกกายภาพของคอร์สนั้น (เกณฑ์เดียวกับหน้าติดตามการส่งงาน: นับตั้งแต่วันจ่ายเคส/แก้แผนล่าสุด · แก้แผนวันนี้ = ไม่นับ)
    job(() => q(`SELECT c.resident_name AS name, coalesce(c.therapist_name, '-') AS who FROM physio_courses c LEFT JOIN residents r ON r.id = c.resident_id
        WHERE c.therapist_id IS NOT NULL AND c.used < c.total AND coalesce(r.status, '') NOT LIKE 'ย้ายออก%' ${w("c.branch_name")}
          AND CASE WHEN coalesce(cardinality(c.plan_dates), 0) > 0 THEN (${TODAY} - 1)::text = ANY(c.plan_dates) ELSE extract(dow FROM ${TODAY} - 1)::int = ANY(coalesce(c.plan_days, '{}')) END
          AND NOT EXISTS (SELECT 1 FROM clinical_notes n WHERE n.kind = 'physio' AND n.data->>'course_id' = c.id AND (n.created_at AT TIME ZONE 'Asia/Bangkok')::date = ${TODAY} - 1)
          AND (SELECT (max(a.at) AT TIME ZONE 'Asia/Bangkok')::date FROM audit_logs a WHERE a.area = 'physio' AND a.action = 'update' AND a.summary LIKE 'จ่ายเคสกายภาพ%' AND a.record_id = c.id) < ${TODAY}
        ORDER BY c.resident_name LIMIT 50`), (v) => { out.physioMissed = v; });
    // คอร์สใกล้หมด (เหลือ 1–2 ครั้ง) · ฝ่ายขาย/ผู้จัดการเสนอต่อคอร์ส
    job(() => q(`SELECT c.resident_name AS name, (c.total - c.used)::int AS left FROM physio_courses c LEFT JOIN residents r ON r.id = c.resident_id
        WHERE c.used < c.total AND c.total - c.used <= 2 AND c.total > 2 AND coalesce(r.status, '') NOT LIKE 'ย้ายออก%' ${w("c.branch_name")}
        ORDER BY c.total - c.used, c.resident_name LIMIT 50`), (v) => { out.physioLow = v; });
  }
  await Promise.all(jobs);
  return out;
}
