// ใช้ฝั่ง server เท่านั้น: ตัวชี้วัด "วัดสัญญาณชีพตามรอบ" (หน้าภาพรวมและรายงาน)
import { sql } from "@/lib/db";
import { planOf, VITAL_ITEMS, VITAL_PRESETS, type VitalKey } from "@/lib/vitalPlan";

/**
 * วัดตามรอบ % = ช่วงที่วัดทันรอบ ÷ ช่วงที่ต้องวัด (ทุกคน × ทุกรายการที่ไม่ได้ตั้ง "ไม่ต้องวัด")
 *  วันละ 2 ครั้ง  = นับทีละเวร (เวรเช้า 07:00–19:00 · เวรดึก 19:00–07:00) ทันรอบ = มีบันทึกในเวรนั้น
 *  ทุก N วัน     = นับทีละวัน ทันรอบ = ณ สิ้นวันนั้น มีบันทึกภายใน N วันล่าสุด (ยังไม่เลยกำหนด · ตรงกับ "เลยกำหนด" ใน lib/vitalPlan)
 *  นับถึงเมื่อวาน (วันนี้ยังไม่จบ) · ผู้รับบริการที่เข้าอยู่ตอนนี้ (ไม่นับย้ายออก/มัดจำ) · เริ่มนับจากวันที่เพิ่มเข้าระบบ
 *  ใช้รอบที่ตั้งไว้ตอนนี้กับทั้งช่วง (ระบบไม่ได้เก็บประวัติการเปลี่ยนรอบ) · ยังไม่ตั้งรอบ = ค่าเริ่มต้น
 *  miss = คนที่ขาดวัดมากที่สุดในช่วงแรก (ranges[0])
 */
export type RoundStat = { total: number; ok: number };
type Ev = Record<VitalKey, number[]>;

const DAY = 864e5, H = 3600e3;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const VS = "~* '(BP|PR|RR|BT)[ :]*[0-9]'";
/** เวลาไทยที่เก็บแบบไม่มีโซนเวลา → ตัวเลข ms (อ่านเป็น UTC ให้ตรงกับ ms() ข้างบน) */
const E = (c: string) => `extract(epoch FROM ${c}) * 1000`;

export async function vitalRounds(br: string | null, ranges: { from: string; to: string }[]): Promise<{ stats: RoundStat[]; miss: { name: string; n: number }[]; perRes: Record<string, RoundStat> }> {
  const today = new Date(Date.now() + 7 * H).toISOString().slice(0, 10);
  const yday = iso(ms(today) - DAY);
  const rs = ranges.map((r) => ({ from: r.from, to: r.to < yday ? r.to : yday }));
  const valid = rs.filter((r) => r.from <= r.to);
  if (!valid.length) return { stats: ranges.map(() => ({ total: 0, ok: 0 })), miss: [], perRes: {} };
  const lo = iso(ms(valid.reduce((a, r) => (r.from < a ? r.from : a), valid[0].from)) - 31 * DAY);
  const hi = iso(ms(valid.reduce((a, r) => (r.to > a ? r.to : a), valid[0].to)) + 2 * DAY);
  const rw = (i: number) => ["coalesce(r.status, '') NOT LIKE 'ย้ายออก%'", "coalesce(r.status, '') NOT LIKE 'มัดจำ%'", ...(br ? [`r.branch_name = $${i}`] : [])].join(" AND ");
  const resQ = (withPlan: boolean) => sql(`SELECT r.id, r.full_name AS name, (r.created_at AT TIME ZONE 'Asia/Bangkok')::date::text AS start, ${withPlan ? "vp.plan" : "NULL AS plan"}
      FROM residents r ${withPlan ? "LEFT JOIN vital_plans vp ON vp.resident_id = r.id" : ""} WHERE ${rw(1)}`, br ? [br] : []);
  const [res, evs] = (await Promise.all([
    resQ(true).catch(() => resQ(false)), // ยังไม่ได้รัน db:setup (ไม่มีตาราง vital_plans) = ทุกคนใช้ค่าเริ่มต้น
    sql(`WITH r AS (SELECT r.id, r.full_name, r.branch_name FROM residents r WHERE ${rw(3)})
      SELECT r.id, ${E("h.recorded_at")} AS t, h.vital_signs ${VS} AS vs, h.o2_sat ~ '[0-9]' AS o2, h.dtx ~ '[0-9]' AS dtx,
          h.weight_height ~ '[0-9][ .]*กก' AS wt, h.weight_height ~ '[0-9][ .]*ซม' AS ht
        FROM r JOIN health_logs h ON h.resident_id = r.id OR (h.resident_id IS NULL AND h.resident_name = r.full_name AND (h.branch_name IS NULL OR h.branch_name = r.branch_name))
        WHERE h.recorded_at >= $1::date AND h.recorded_at < $2::date
      UNION ALL
      SELECT r.id, ${E("t.work_date + coalesce(t.submitted_time, t.scheduled_time, '00:00'::time)")}, true, false, false, false, false
        FROM r JOIN daily_tasks t ON t.resident_id = r.id OR (t.resident_id IS NULL AND t.resident_name = r.full_name AND t.branch_name = r.branch_name)
        WHERE t.vital_signs ${VS} AND t.work_date >= $1::date AND t.work_date < $2::date`, br ? [lo, hi, br] : [lo, hi]),
  ])) as [Record<string, unknown>[], Record<string, unknown>[]];

  const empty = (): Ev => ({ vs: [], o2: [], dtx: [], wt: [], ht: [] });
  const byRes = new Map<string, Ev>();
  for (const e of evs) {
    const t = Number(e.t);
    if (!Number.isFinite(t)) continue;
    const ev = byRes.get(String(e.id)) ?? empty();
    for (const { k } of VITAL_ITEMS) if (e[k] === true) ev[k].push(t);
    byRes.set(String(e.id), ev);
  }
  const has = (list: number[], a: number, b: number) => list.some((t) => t >= a && t < b);
  const stats = rs.map(() => ({ total: 0, ok: 0 }));
  const missBy = new Map<string, number>();
  /** ช่วงแรก (ranges[0]) แยกรายคน ตามรหัสผู้รับบริการ (ไฟล์ส่งออกรอบวัดรายคน) */
  const perRes: Record<string, RoundStat> = {};
  let curId = "";
  const count = (i: number, ok: boolean, name: string) => {
    stats[i].total++;
    if (i === 0) { const p = (perRes[curId] ??= { total: 0, ok: 0 }); p.total++; if (ok) p.ok++; }
    if (ok) stats[i].ok++; else if (i === 0) missBy.set(name, (missBy.get(name) ?? 0) + 1);
  };
  for (const r of res) {
    const plan = planOf(r.plan), ev = byRes.get(String(r.id)) ?? empty(), name = String(r.name);
    curId = String(r.id);
    const start = ms(String(r.start ?? lo));
    for (const { k } of VITAL_ITEMS) {
      const days = VITAL_PRESETS.find((x) => x.k === plan[k])?.days ?? null;
      if (days === null) continue;
      rs.forEach((rg, i) => {
        for (let d = Math.max(ms(rg.from), start); d <= ms(rg.to); d += DAY) {
          if (days < 1) {
            // วันละ 2 ครั้ง: เวรเช้า 07–19 · เวรดึก 19 – 07 ของวันถัดไป
            count(i, has(ev[k], d + 7 * H, d + 19 * H), name);
            count(i, has(ev[k], d + 19 * H, d + 31 * H), name);
          } else {
            const n = Math.round(days);
            if (d - (n - 1) * DAY < start) continue; // เพิ่งเข้าอยู่ ยังไม่ครบรอบแรก
            count(i, has(ev[k], d - (n - 1) * DAY, d + DAY), name);
          }
        }
      });
    }
  }
  const miss = [...missBy.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n).slice(0, 5);
  return { stats, miss, perRes };
}
