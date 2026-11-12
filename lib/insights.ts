// ใช้ฝั่ง server เท่านั้น: ข้อมูลหน้า "ภาพรวมและรายงาน" (สุขภาพ · คุณภาพการดูแล · ทีมงาน · รับเข้า-จำหน่าย · อัตราเข้าพัก)
// ช่วงเวลาและช่วงเปรียบเทียบส่งมาจากหน้าจอ (from/to และ pfrom/pto) · br = สาขา (ว่าง = ทุกสาขาที่เห็น)
import { sql } from "@/lib/db";
import { evaluateVitals, levelOf, parseVitals } from "@/lib/vitals";

type Row = Record<string, unknown>;
const n = (v: unknown) => Number(v) || 0;
const TODAY = "(now() AT TIME ZONE 'Asia/Bangkok')::date";
const NOW_BKK = "(now() AT TIME ZONE 'Asia/Bangkok')";

/** สัปดาห์ (จันทร์–อาทิตย์) 5 สัปดาห์ล่าสุดที่จบที่วันที่ to */
function weeks(to: string) {
  const end = new Date(`${to}T00:00:00Z`);
  const mon = new Date(end); mon.setUTCDate(end.getUTCDate() - ((end.getUTCDay() + 6) % 7));
  return Array.from({ length: 5 }, (_, i) => {
    const s = new Date(mon); s.setUTCDate(mon.getUTCDate() - (4 - i) * 7);
    const e = new Date(s); e.setUTCDate(s.getUTCDate() + 6);
    return { from: s.toISOString().slice(0, 10), to: e.toISOString().slice(0, 10) };
  });
}
/** เดือน (YYYY-MM) ย้อนหลัง count เดือนที่จบที่เดือนของ to */
function months(to: string, count: number) {
  const [y, m] = to.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => { const d = new Date(Date.UTC(y, m - 1 - (count - 1 - i), 1)); return d.toISOString().slice(0, 7); });
}
const monthEnd = (ym: string) => { const [y, m] = ym.split("-").map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10); };

export type Range = { from: string; to: string; pfrom: string; pto: string };

export async function insights(br: string | null, r: Range) {
  const B = (col: string, i: number) => (br ? `AND ${col} = $${i}` : "");
  const P = (...a: unknown[]) => (br ? [...a, br] : a);

  /* ---------- สุขภาพผู้รับบริการ ---------- */
  const W = weeks(r.to);
  const logs = (await sql(`SELECT resident_name AS name, recorded_at::date::text AS day, vital_signs, o2_sat, dtx FROM health_logs
      WHERE recorded_at::date >= $1::date AND recorded_at::date <= $2::date ${B("branch_name", 3)}`, P(W[0].from < r.pfrom ? W[0].from : r.pfrom, r.to))) as Row[];
  const lv = logs.map((x) => ({ name: String(x.name), day: String(x.day), level: levelOf(evaluateVitals(parseVitals(String(x.vital_signs ?? ""), String(x.o2_sat ?? ""), String(x.dtx ?? "")))) }));
  const vit = (f: string, t: string) => { const s = lv.filter((x) => x.day >= f && x.day <= t); return { logs: s.length, abnormal: s.filter((x) => x.level !== "normal").length, critical: s.filter((x) => x.level === "critical").length }; };
  const wk7 = new Date(Date.parse(r.to) - 6 * 864e5).toISOString().slice(0, 10);
  const rep = new Map<string, { name: string; n: number; critical: number }>();
  lv.filter((x) => x.day >= wk7 && x.day <= r.to && x.level !== "normal").forEach((x) => { const e = rep.get(x.name) ?? { name: x.name, n: 0, critical: 0 }; e.n++; if (x.level === "critical") e.critical++; rep.set(x.name, e); });
  const alertStat = async (f: string, t: string) => {
    const [a] = (await sql(`SELECT count(*)::int AS n, avg(extract(epoch FROM ack_at - created_at) / 60) FILTER (WHERE ack_at IS NOT NULL)::float AS ack
        FROM care_alerts WHERE (created_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN $1::date AND $2::date ${B("branch_name", 3)}`, P(f, t))) as Row[];
    const [m] = (await sql(`SELECT count(*)::int AS total, count(*) FILTER (WHERE given)::int AS given FROM medication_packs
        WHERE pack_date BETWEEN $1::date AND LEAST($2::date, ${TODAY} - 1) ${B("branch_name", 3)}`, P(f, t))) as Row[];
    return { alerts: n(a.n), ackMin: a.ack === null ? null : Math.round(n(a.ack)), meds: { total: n(m.total), given: n(m.given) } };
  };
  const [hc, hp] = await Promise.all([alertStat(r.from, r.to), alertStat(r.pfrom, r.pto)]);
  const [adm] = (await sql(`SELECT count(*)::int AS n FROM residents WHERE status LIKE 'แอดมิท%' ${B("branch_name", 1)}`, P())) as Row[];
  const health = {
    cur: { ...vit(r.from, r.to), ...hc }, prev: { ...vit(r.pfrom, r.pto), ...hp }, admitted: n(adm.n),
    weekly: W.map((w) => ({ ...w, ...vit(w.from, w.to) })),
    repeat: [...rep.values()].filter((x) => x.n >= 2).sort((a, b) => b.critical - a.critical || b.n - a.n).slice(0, 8),
  };

  /* ---------- คุณภาพการดูแล ---------- */
  const careStat = async (f: string, t: string) => {
    const [c] = (await sql(`SELECT count(*)::int AS total, count(*) FILTER (WHERE status IN ('เสร็จแล้ว','ตรวจแล้ว'))::int AS done, count(*) FILTER (WHERE status = 'ตรวจแล้ว')::int AS checked,
        count(*) FILTER (WHERE status IN ('เสร็จแล้ว','ตรวจแล้ว') AND submitted_time IS NOT NULL AND scheduled_time IS NOT NULL
          AND (CASE WHEN submitted_time - scheduled_time < interval '-12 hours' THEN submitted_time - scheduled_time + interval '24 hours'
                    WHEN submitted_time - scheduled_time > interval '12 hours' THEN submitted_time - scheduled_time - interval '24 hours'
                    ELSE submitted_time - scheduled_time END) <= interval '30 minutes')::int AS ontime,
        avg(review_stars)::float AS stars, count(*) FILTER (WHERE review_stars < 3)::int AS low
      FROM daily_tasks WHERE work_date BETWEEN $1::date AND LEAST($2::date, ${TODAY}) ${B("branch_name", 3)}`, P(f, t))) as Row[];
    return { total: n(c.total), done: n(c.done), checked: n(c.checked), ontime: n(c.ontime), stars: c.stars === null ? null : Math.round(n(c.stars) * 10) / 10, low: n(c.low) };
  };
  const [cc, cp, ...cw] = await Promise.all([careStat(r.from, r.to), careStat(r.pfrom, r.pto), ...W.map((w) => careStat(w.from, w.to))]);
  const care = { cur: cc, prev: cp, weekly: W.map((w, i) => ({ ...w, total: cw[i].total, done: cw[i].done })) };

  /* ---------- ทีมงาน ---------- */
  const [resNow] = (await sql(`SELECT count(*)::int AS n FROM residents WHERE status LIKE 'เข้าอยู่%' ${B("branch_name", 1)}`, P())) as Row[];
  const teamStat = async (f: string, t: string) => {
    const shifts = (await sql(`SELECT d::date::text AS day, s.shift, (SELECT count(*)::int FROM staff_shifts x WHERE x.shift_date = d::date AND x.shift = s.shift ${B("x.branch_name", 3)}) AS staff
        FROM generate_series($1::date, LEAST($2::date, ${TODAY} + 6), interval '1 day') d CROSS JOIN (VALUES ('เช้า'), ('ดึก')) s(shift) ORDER BY 1, 2 DESC`, P(f, t))) as Row[];
    const [a] = (await sql(`SELECT count(*) FILTER (WHERE late_min > 0)::int AS late, coalesce(sum(late_min) FILTER (WHERE late_min > 0), 0)::int AS lmin FROM attendance
        WHERE kind = 'in' AND work_date BETWEEN $1::date AND $2::date ${B("branch_name", 3)}`, P(f, t))) as Row[];
    const [ab] = (await sql(`SELECT count(*)::int AS n FROM staff_shifts s WHERE s.shift_date BETWEEN $1::date AND LEAST($2::date, ${TODAY} - 1) ${B("s.branch_name", 3)}
        AND NOT EXISTS (SELECT 1 FROM attendance a WHERE a.staff_id = s.staff_id AND a.work_date = s.shift_date AND a.shift = s.shift AND a.kind = 'in')`, P(f, t))) as Row[];
    return { shifts: shifts.map((x) => ({ day: String(x.day), shift: String(x.shift), staff: n(x.staff) })), late: n(a.late), lateMin: n(a.lmin), absent: n(ab.n) };
  };
  const [tc, tp] = await Promise.all([teamStat(r.from, r.to), teamStat(r.pfrom, r.pto)]);
  const team = { residents: n(resNow.n), cur: tc, prev: { late: tp.late, lateMin: tp.lateMin, absent: tp.absent, shifts: tp.shifts } };

  /* ---------- รับเข้า-จำหน่าย ---------- */
  const flowStat = async (f: string, t: string) => {
    const [q] = (await sql(`SELECT count(*)::int AS n FROM care_assessments WHERE coalesce(quote_date, (created_at AT TIME ZONE 'Asia/Bangkok')::date) BETWEEN $1::date AND $2::date ${B("branch_name", 3)}`, P(f, t))) as Row[];
    const [c] = (await sql(`SELECT count(*) FILTER (WHERE (created_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN $1::date AND $2::date AND coalesce(status, '') <> 'ยกเลิกสัญญา')::int AS contracts,
        count(*) FILTER (WHERE start_date BETWEEN $1::date AND $2::date AND coalesce(status, '') NOT IN ('ยกเลิกสัญญา', 'รอชำระเงินมัดจำ'))::int AS admits,
        count(*) FILTER (WHERE status = 'สิ้นสุดสัญญา' AND end_date BETWEEN $1::date AND $2::date)::int AS discharges,
        avg((end_date - start_date) / 30.44) FILTER (WHERE status = 'สิ้นสุดสัญญา' AND end_date BETWEEN $1::date AND $2::date AND start_date IS NOT NULL)::float AS los
      FROM contracts WHERE true ${B("branch_name", 3)}`, P(f, t))) as Row[];
    return { quotes: n(q.n), contracts: n(c.contracts), admits: n(c.admits), discharges: n(c.discharges), los: c.los === null ? null : Math.round(n(c.los) * 10) / 10 };
  };
  const M6 = months(r.to, 6);
  const [fc, fp, ...fm] = await Promise.all([flowStat(r.from, r.to), flowStat(r.pfrom, r.pto), ...M6.map((m) => flowStat(`${m}-01`, monthEnd(m)))]);
  const flow = { cur: fc, prev: fp, monthly: M6.map((m, i) => ({ month: m, admits: fm[i].admits, discharges: fm[i].discharges })) };

  /* ---------- อัตราเข้าพัก 12 เดือน (ย้อนหลังจากสัญญา · เดือนปัจจุบันจากผู้รับบริการที่พักอยู่จริง) ---------- */
  const [cap] = (await sql(`SELECT coalesce(sum(capacity), 0)::int AS n FROM rooms WHERE coalesce(status, '') NOT LIKE 'ปิด%' ${B("branch_name", 1)}`, P())) as Row[];
  const M12 = months(r.to, 12);
  const occ = await Promise.all(M12.map(async (m) => {
    const e = monthEnd(m);
    const [x] = (await sql(`SELECT count(*)::int AS n FROM contracts WHERE start_date <= $1::date AND coalesce(status, '') NOT IN ('ยกเลิกสัญญา', 'รอชำระเงินมัดจำ')
        AND (status <> 'สิ้นสุดสัญญา' OR end_date IS NULL OR end_date >= $1::date) ${B("branch_name", 2)}`, P(e < r.to ? e : r.to))) as Row[];
    return { month: m, people: n(x.n) };
  }));
  // เดือนปัจจุบัน: คนที่พักอยู่และมีห้องแล้ว (ตรงกับหน้าห้องพักและเตียง) · คนที่รอจัดห้องไม่นับเป็นเตียงที่มีคน
  // นับเฉพาะคนที่อยู่ในห้องที่สร้างไว้ในระบบ (เกณฑ์เดียวกับการ์ดอัตราการเข้าพักและหน้าห้องพักและเตียง) · ห้องที่บันทึกไว้แต่ยังไม่ได้สร้าง = ยังไม่นับ
  const [inBed] = (await sql(`SELECT count(*)::int AS n FROM residents x WHERE coalesce(x.status, '') NOT LIKE 'ย้ายออก%'
      AND EXISTS (SELECT 1 FROM rooms r WHERE r.branch_name = x.branch_name AND lower(regexp_replace(trim(r.room_no), '\\s+', ' ', 'g')) = lower(regexp_replace(trim(x.room), '\\s+', ' ', 'g')) AND coalesce(r.status, '') NOT LIKE 'ปิด%') ${B("x.branch_name", 1)}`, P())) as Row[];
  const thisMonth = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7);
  const occupancy = { capacity: n(cap.n), inBed: n(inBed.n), monthly: occ.map((o) => (o.month === thisMonth ? { ...o, people: n(inBed.n) } : o)) };

  return { range: r, health, care, team, flow, occupancy };
}

/* ---------- เทียบสาขา (ผู้บริหาร · ดูรวมทุกสาขา) ---------- */
export type BranchCompare = {
  branch: string; capacity: number; inBed: number; residents: number;
  done: number; ontime: number; openAlerts: number;
  /** จำนวนพยาบาลแต่ละกะในช่วง (ถึงวันนี้) ไว้คิดกะที่คนไม่พอตามเป้าของแต่ละสาขา */
  shifts: number[];
  paid?: number; owe?: number; oweN?: number;
};
/** ตัวเลขหลักของทุกสาขาในช่วงเดียวกัน · money = รวมรับชำระ/ค้างชำระ (เฉพาะผู้มีสิทธิ์การเงิน) */
export async function compareBranches(r: Range, money: boolean): Promise<BranchCompare[]> {
  const g = async (q: string, p: unknown[] = []) => new Map(((await sql(q, p)) as Row[]).map((x) => [String(x.b), x]));
  const month = r.to.slice(0, 7);
  const [cap, bed, res, care, alerts, shifts, paid, owe] = await Promise.all([
    g(`SELECT branch_name AS b, coalesce(sum(capacity), 0)::int AS n FROM rooms WHERE coalesce(status, '') NOT LIKE 'ปิด%' GROUP BY 1`),
    g(`SELECT x.branch_name AS b, count(*)::int AS n FROM residents x WHERE coalesce(x.status, '') NOT LIKE 'ย้ายออก%'
        AND EXISTS (SELECT 1 FROM rooms r WHERE r.branch_name = x.branch_name AND lower(regexp_replace(trim(r.room_no), '\s+', ' ', 'g')) = lower(regexp_replace(trim(x.room), '\s+', ' ', 'g')) AND coalesce(r.status, '') NOT LIKE 'ปิด%') GROUP BY 1`),
    g(`SELECT branch_name AS b, count(*)::int AS n FROM residents WHERE status LIKE 'เข้าอยู่%' GROUP BY 1`),
    g(`SELECT branch_name AS b, count(*) FILTER (WHERE status IN ('เสร็จแล้ว','ตรวจแล้ว'))::int AS done,
        count(*) FILTER (WHERE status IN ('เสร็จแล้ว','ตรวจแล้ว') AND submitted_time IS NOT NULL AND scheduled_time IS NOT NULL
          AND (CASE WHEN submitted_time - scheduled_time < interval '-12 hours' THEN submitted_time - scheduled_time + interval '24 hours'
                    WHEN submitted_time - scheduled_time > interval '12 hours' THEN submitted_time - scheduled_time - interval '24 hours'
                    ELSE submitted_time - scheduled_time END) <= interval '30 minutes')::int AS ontime
      FROM daily_tasks WHERE work_date BETWEEN $1::date AND LEAST($2::date, ${TODAY}) GROUP BY 1`, [r.from, r.to]),
    g(`SELECT branch_name AS b, count(*)::int AS n FROM care_alerts WHERE status = 'open' GROUP BY 1`),
    sql(`SELECT branch_name AS b, shift_date::text AS day, shift, count(*)::int AS n FROM staff_shifts
      WHERE shift_date BETWEEN $1::date AND LEAST($2::date, ${TODAY}) GROUP BY 1, 2, 3`, [r.from, r.to]) as Promise<Row[]>,
    money ? g(`SELECT i.branch_name AS b, coalesce(sum(p.amount), 0)::float AS n FROM invoice_payments p JOIN invoices i ON i.id = p.invoice_id
        WHERE p.kind = 'pay' AND to_char(p.pay_date, 'YYYY-MM') = $1 AND p.pay_date <= LEAST($2::date, ${TODAY}) GROUP BY 1`, [month, r.to]) : Promise.resolve(new Map<string, Row>()),
    money ? g(`SELECT branch_name AS b, count(*)::int AS c, coalesce(sum(net - coalesce(paid_total, 0)), 0)::float AS n FROM invoices WHERE status IN ('ค้างชำระ', 'ชำระบางส่วน') GROUP BY 1`) : Promise.resolve(new Map<string, Row>()),
  ]);
  const names = [...new Set([...cap.keys(), ...res.keys(), ...care.keys()])].filter((b) => b && b !== "null").sort();
  // ทุกวัน × กะเช้า/ดึก ในช่วง (ถึงวันนี้) · ไม่มีเวร = 0 คน
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10), end = r.to < today ? r.to : today;
  const days: string[] = [];
  for (let t = Date.parse(r.from); days.length < 400 && new Date(t).toISOString().slice(0, 10) <= end; t += 864e5) days.push(new Date(t).toISOString().slice(0, 10));
  const staffOf = new Map(shifts.map((x) => [`${x.b}|${x.day}|${x.shift}`, n(x.n)]));
  return names.map((b) => ({
    branch: b, capacity: n(cap.get(b)?.n), inBed: n(bed.get(b)?.n), residents: n(res.get(b)?.n),
    done: n(care.get(b)?.done), ontime: n(care.get(b)?.ontime), openAlerts: n(alerts.get(b)?.n),
    shifts: days.flatMap((d) => ["เช้า", "ดึก"].map((sh) => staffOf.get(`${b}|${d}|${sh}`) ?? 0)),
    ...(money ? { paid: n(paid.get(b)?.n), owe: n(owe.get(b)?.n), oweN: n(owe.get(b)?.c) } : {}),
  }));
}
