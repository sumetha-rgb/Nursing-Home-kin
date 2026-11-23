// ใช้ฝั่ง server เท่านั้น: แตกย่อยตัวชี้วัด % (GET /api/ops?op=drill)
//  rows = แต่ละกลุ่มของมิติที่ขอ { key, num, den } · records = รายการจริงที่ต้องตาม (หมดชั้นแตกย่อยแล้ว)
//  มิติและตัวกรองตรวจกับ lib/drillDims (whitelist) · ค่าที่กรองส่งเป็นพารามิเตอร์เสมอ
import { sql } from "@/lib/db";
import { medSlotsSql } from "@/lib/medSlots";
import { CN_KIND, DRAFT, PARTIAL, UNPAID, VOID } from "@/lib/billing";
import type { DrillDim, DrillKpi } from "@/lib/drillDims";

type Row = Record<string, unknown>;
/** สาขาที่ยังไม่ระบุนิติบุคคล = บริษัทหลัก (เหมือน COMPANY.th ใน components/ui) */
const COMPANY_TH = "บริษัท ทีทรี สโตรก เนอสซิ่งโฮม จำกัด";
const TODAY = "(now() AT TIME ZONE 'Asia/Bangkok')::date";
const DONE = "t.status IN ('เสร็จแล้ว','ตรวจแล้ว')";
/** ส่งช้าไม่เกิน 30 นาที (ข้ามเที่ยงคืนได้) · สูตรเดียวกับ lib/insights */
const DIFF = `(CASE WHEN t.submitted_time - t.scheduled_time < interval '-12 hours' THEN t.submitted_time - t.scheduled_time + interval '24 hours'
  WHEN t.submitted_time - t.scheduled_time > interval '12 hours' THEN t.submitted_time - t.scheduled_time - interval '24 hours'
  ELSE t.submitted_time - t.scheduled_time END)`;
const ONTIME = `(${DONE} AND t.submitted_time IS NOT NULL AND t.scheduled_time IS NOT NULL AND ${DIFF} <= interval '30 minutes')`;
const LATE = `(${DONE} AND t.submitted_time IS NOT NULL AND t.scheduled_time IS NOT NULL AND ${DIFF} > interval '30 minutes')`;
const ROOM_KEY = (x: string) => `lower(regexp_replace(trim(${x}), '\\s+', ' ', 'g'))`;
const dash = (x: string) => `coalesce(nullif(trim(${x}), ''), '-')`;

/** นิพจน์ของแต่ละมิติต่อตัวชี้วัด */
const EXPR: Record<DrillKpi, Partial<Record<DrillDim, string>>> = {
  occ: { branch: dash("r.branch_name"), room_type: dash("r.room_type"), floor: dash("r.floor") },
  collect: {
    branch: dash("i.branch_name"), company: `coalesce(nullif(nullif(trim(b.legal_entity), ''), '-'), '${COMPANY_TH}')`, kind: dash("i.category"),
    age: `(CASE WHEN ${TODAY} - i.doc_date <= 30 THEN '0–30 วัน' WHEN ${TODAY} - i.doc_date <= 60 THEN '31–60 วัน' WHEN ${TODAY} - i.doc_date <= 90 THEN '61–90 วัน' ELSE 'เกิน 90 วัน' END)`,
  },
  tasks: { branch: dash("t.branch_name"), task: dash("t.task_name"), shift: dash("t.shift"), who: `coalesce(nullif(nullif(t.done_by, '-'), ''), nullif(nullif(t.assignee, '-'), ''), '-')` },
  ontime: {},
  meds: { branch: dash("m.branch_name"), meal: dash("m.meal"), resident: dash("m.resident_name") },
};
EXPR.ontime = EXPR.tasks;
const AGE_ORDER = ["0–30 วัน", "31–60 วัน", "61–90 วัน", "เกิน 90 วัน"];

export type DrillQuery = { kpi: DrillKpi; by: DrillDim | null; filters: [DrillDim, string][]; from: string; to: string; br: string | null };
export type DrillRow = { key: string; num: number; den: number; n?: number };

export async function drill(q: DrillQuery): Promise<{ rows?: DrillRow[]; records?: Row[] }> {
  const E = EXPR[q.kpi];
  const params: unknown[] = [q.from, q.to];
  const where: string[] = [];
  const add = (sqlExpr: string, v: unknown) => { params.push(v); where.push(`${sqlExpr} = $${params.length}`); };
  const brCol = { occ: "r.branch_name", collect: "i.branch_name", tasks: "t.branch_name", ontime: "t.branch_name", meds: "m.branch_name" }[q.kpi];
  if (q.br) add(brCol, q.br);
  for (const [d, v] of q.filters) add(E[d]!, v);
  const W = where.length ? `AND ${where.join(" AND ")}` : "";
  const by = q.by ? E[q.by]! : null;
  const num = (v: unknown) => Number(v) || 0;
  const rowsOf = (rs: Row[]) => rs.map((r) => ({ key: String(r.k), num: num(r.num), den: num(r.den), n: r.n === undefined ? undefined : num(r.n) }));

  if (q.kpi === "occ") {
    const occ = `(SELECT count(*) FROM residents x WHERE x.branch_name = r.branch_name AND ${ROOM_KEY("x.room")} = ${ROOM_KEY("r.room_no")} AND coalesce(x.status, '') NOT LIKE 'ย้ายออก%')`;
    const base = `FROM rooms r WHERE coalesce(r.status, '') NOT LIKE 'ปิด%' AND $1::text IS NOT NULL AND $2::text IS NOT NULL ${W}`;
    if (by) return { rows: rowsOf(await sql(`SELECT ${by} AS k, sum(LEAST(${occ}, r.capacity))::int AS num, sum(r.capacity)::int AS den ${base} GROUP BY 1`, params) as Row[]) };
    return { records: await sql(`SELECT r.room_no AS room, r.branch_name AS branch, ${dash("r.room_type")} AS type, ${dash("r.floor")} AS floor, (r.capacity - LEAST(${occ}, r.capacity))::int AS free
        ${base} AND r.capacity > ${occ} ORDER BY r.branch_name, r.room_no LIMIT 200`, params) as Row[] };
  }

  if (q.kpi === "tasks" || q.kpi === "ontime") {
    const base = `FROM daily_tasks t WHERE t.work_date BETWEEN $1::date AND LEAST($2::date, ${TODAY}) ${W}`;
    if (by) {
      const sel = q.kpi === "tasks" ? `count(*) FILTER (WHERE ${DONE})::int AS num, count(*)::int AS den` : `count(*) FILTER (WHERE ${ONTIME})::int AS num, count(*) FILTER (WHERE ${DONE})::int AS den`;
      return { rows: rowsOf(await sql(`SELECT ${by} AS k, ${sel} ${base} GROUP BY 1`, params) as Row[]).filter((r) => r.den > 0) };
    }
    if (q.kpi === "tasks") return { records: await sql(`SELECT t.work_date::text AS date, t.task_name AS task, coalesce(t.resident_name, '-') AS resident, ${dash("t.shift")} AS shift,
        ${E.who} AS who, to_char(t.scheduled_time, 'HH24:MI') AS time ${base} AND NOT ${DONE} ORDER BY t.work_date DESC, t.scheduled_time LIMIT 200`, params) as Row[] };
    return { records: await sql(`SELECT t.work_date::text AS date, t.task_name AS task, coalesce(t.resident_name, '-') AS resident, ${E.who} AS who,
        to_char(t.scheduled_time, 'HH24:MI') AS time, to_char(t.submitted_time, 'HH24:MI') AS sent, (extract(epoch FROM ${DIFF}) / 60)::int AS late
        ${base} AND ${LATE} ORDER BY ${DIFF} DESC LIMIT 200`, params) as Row[] };
  }

  if (q.kpi === "meds") {
    // มื้อยาที่ต้องให้ (ยา × มื้อ × วัน) · given = ให้แล้ว (lib/medSlots)
    const base = `FROM ${medSlotsSql("$1::date", `LEAST($2::date, ${TODAY} - 1)`)} m WHERE true ${W}`;
    if (by) return { rows: rowsOf(await sql(`SELECT ${by} AS k, count(*) FILTER (WHERE m.given)::int AS num, count(*)::int AS den ${base} GROUP BY 1`, params) as Row[]) };
    return { records: await sql(`SELECT m.day::text AS date, m.resident_name AS resident, m.meal, m.drug_name AS items, coalesce('ไม่ได้ให้: ' || m.skip, 'ยังไม่ได้บันทึก') AS who
        ${base} AND NOT m.given ORDER BY m.day DESC, m.resident_name LIMIT 200`, params) as Row[] };
  }

  // collect: รับเงินในช่วง ÷ ยอดออกใบในช่วง (สูตรเดียวกับหน้าการเงิน) · ใบลดหนี้ลดยอดออกใบ · แยกตามประเภทใบไม่นับใบลดหนี้
  const J = "FROM invoices i LEFT JOIN branches b ON b.name = i.branch_name";
  const cn = params.push(CN_KIND), vd = params.push(VOID), dr = params.push(DRAFT), up = params.push(UNPAID), pa = params.push(PARTIAL);
  // ทุกคำสั่งอ้างค่าทุกตัวที่ส่ง (Postgres ระบุชนิดของพารามิเตอร์ที่ไม่ถูกใช้ไม่ได้)
  const P = [cn, vd, dr, up, pa].map((i) => `$${i}::text IS NOT NULL`).join(" AND ");
  const noCn = q.by === "kind" || q.filters.some(([d]) => d === "kind") ? `AND coalesce(i.category, '') <> $${cn}` : "";
  if (q.by === "age") {
    return { rows: rowsOf(await sql(`SELECT ${by} AS k, sum(i.net - coalesce(i.paid_total, 0))::float AS num, count(*)::int AS n, 0 AS den ${J}
        WHERE i.doc_date BETWEEN $1::date AND $2::date AND i.status IN ($${up}, $${pa}) AND ${P} ${W} GROUP BY 1`, params) as Row[])
      .sort((a, b) => AGE_ORDER.indexOf(a.key) - AGE_ORDER.indexOf(b.key)) };
  }
  if (by) {
    const [billed, paid] = await Promise.all([
      sql(`SELECT ${by} AS k, sum(CASE WHEN coalesce(i.category, '') = $${cn} THEN -i.net ELSE i.net END)::float AS v ${J}
        WHERE i.doc_date BETWEEN $1::date AND $2::date AND coalesce(i.status, '') NOT IN ($${vd}, $${dr}) AND ${P} ${noCn} ${W} GROUP BY 1`, params) as Promise<Row[]>,
      sql(`SELECT ${by} AS k, sum(p.cash + p.credit + p.transfer)::float AS v FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id LEFT JOIN branches b ON b.name = i.branch_name
        WHERE p.pay_date BETWEEN $1::date AND $2::date AND coalesce(i.status, '') <> $${vd} AND ${P} ${noCn} ${W} GROUP BY 1`, params) as Promise<Row[]>,
    ]);
    const m = new Map<string, DrillRow>();
    for (const r of billed) m.set(String(r.k), { key: String(r.k), num: 0, den: num(r.v) });
    for (const r of paid) { const k = String(r.k); const x = m.get(k) ?? { key: k, num: 0, den: 0 }; x.num = num(r.v); m.set(k, x); }
    return { rows: [...m.values()].filter((r) => r.den > 0 || r.num > 0) };
  }
  return { records: await sql(`SELECT i.doc_no AS no, coalesce(i.resident_name, '-') AS resident, coalesce(i.branch_name, '-') AS branch, (i.net - coalesce(i.paid_total, 0))::float AS owe,
      (${TODAY} - i.doc_date)::int AS days ${J}
      WHERE i.doc_date BETWEEN $1::date AND $2::date AND i.status IN ($${up}, $${pa}) AND ${P} ${W} ORDER BY i.doc_date LIMIT 200`, params) as Row[] };
}
