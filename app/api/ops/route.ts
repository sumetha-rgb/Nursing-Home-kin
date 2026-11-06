import { randomUUID } from "node:crypto";
import { pushTo, shiftStaffIds, staffIds } from "@/lib/push";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUser, forbidden, unauthorized } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { can } from "@/lib/perms";
import type { SessionUser } from "@/lib/roles";
import { insights } from "@/lib/insights";
import { attention } from "@/lib/attention";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * ภาพรวมและรายงานจากข้อมูลจริง และกำลังใจของทีม
 *  GET  ?op=dashboard&range=today|month[&branch=]  สรุปรายสาขา สถานะกะวันนี้ งานที่เพิ่งส่ง (ผู้มีเมนูภาพรวมและรายงาน)
 *  GET  ?op=tasklog&from=&to=[&branch=]           ทะเบียนงานย้อนหลัง (งานประจำวันทุกวันในช่วง)
 *  GET  ?op=insights&from=&to=&pfrom=&pto=[&branch=]  แถบต้องจัดการ สุขภาพ คุณภาพการดูแล ทีมงาน รับเข้า-จำหน่าย อัตราเข้าพัก (เทียบช่วงก่อน)
 *  GET  ?op=feed                                    KinApp: คำชมถึงฉัน ข้อความกำลังใจของสาขา ผลงานพิเศษของฉันวันนี้
 *  POST { op: "kudos", taskId }                     ชื่นชมงานที่พนักงานส่ง (ผู้จัดการ/หัวหน้าพยาบาล)
 *  POST { op: "cheer", branch, message }            ส่งกำลังใจถึงสาขา
 *  POST { op: "bonus", title, note?, photo? }       พนักงานส่งผลงานพิเศษ
 *  GET  ?op=nudges&date=                            ตามงานของวันนั้น (สาขาตัวเอง) · สถานะเห็นแล้ว/ตอบกลับ ล่าสุดต่องาน
 *  POST { op: "nudge", taskId, message? }           ตามงานที่ยังไม่ส่ง (ผู้มีสิทธิ์มอบหมายงาน) · ถึงผู้รับผิดชอบ หรือทุกคนในสาขาถ้ายังไม่มีผู้รับผิดชอบ
 *  POST { op: "nudge_reply", id, reason }            KinApp: ตอบว่าทำไม่ได้พร้อมเหตุผล
 *  feed (KinApp) มี nudges = งานที่ถูกตามและยังไม่ส่ง · เปิด feed = บันทึกว่าเห็นแล้ว
 */
const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
const scoped = (me: SessionUser) => me.role !== "Global Admin";
const text = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const TH_TIME = (col: string) => `to_char(${col} AT TIME ZONE 'Asia/Bangkok', 'DD/MM HH24:MI')`;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

export async function GET(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const q = req.nextUrl.searchParams;
  try {
    if (q.get("op") === "feed") {
      const kudos = await sql(`SELECT task_title, resident_name, given_by, ${TH_TIME("created_at")} AS at FROM kudos WHERE staff_name = $1 ORDER BY created_at DESC LIMIT 5`, [me.name]);
      const cheers = await sql(`SELECT message, sent_by, ${TH_TIME("created_at")} AS at FROM branch_cheers WHERE branch_name = $1 AND created_at > now() - interval '7 days' ORDER BY created_at DESC LIMIT 3`, [me.branch]);
      const [b] = (await sql(`SELECT count(*)::int AS n FROM staff_bonus WHERE staff_name = $1 AND (created_at AT TIME ZONE 'Asia/Bangkok')::date = (now() AT TIME ZONE 'Asia/Bangkok')::date`, [me.name])) as { n: number }[];
      // งานที่หัวหน้าตามและยังไม่ส่ง (ถึงฉัน หรือถึงทุกคนในสาขา) · ตารางยังไม่สร้าง = ไม่มี
      let nudges: Record<string, unknown>[] = [];
      try {
        nudges = await sql(`SELECT n.id, n.task_id AS "taskId", n.task_name AS task, n.resident_name AS resident, n.message, n.sent_by AS "sentBy", ${TH_TIME("n.sent_at")} AS at,
            to_char(d.scheduled_time, 'HH24:MI') AS time
          FROM task_nudges n JOIN daily_tasks d ON d.id = n.task_id
          WHERE n.branch_name = $1 AND d.status NOT IN ('เสร็จแล้ว', 'ตรวจแล้ว')
            -- วันทำงานเดียวกับ KinApp (เปลี่ยนตอน 07:00): เวรดึกยังเห็นจนจบเวร · หลัง 07:00 ไม่ค้างของเมื่อวาน
            AND n.work_date >= (now() AT TIME ZONE 'Asia/Bangkok' - interval '7 hours')::date
            AND (
              -- ถึงฉันโดยตรง และยังไม่ตอบ
              (n.target = $2 AND n.reply IS NULL)
              -- ถึงทีมเวร: เฉพาะคนที่อยู่เวรของงานนั้น (ยังไม่ได้จัดใครเข้าเวร = ทุกคนในสาขา) · ซ่อนเฉพาะคนที่ตอบว่าทำไม่ได้แล้ว
              OR (n.target IS NULL
                AND position(', ' || $2 || ', ' in ', ' || coalesce(n.reply_by, '') || ', ') = 0
                AND (EXISTS (SELECT 1 FROM staff_shifts s WHERE s.branch_name = n.branch_name AND s.shift_date = d.work_date AND 'กะ' || s.shift = d.shift AND s.staff_id = $3)
                  OR NOT EXISTS (SELECT 1 FROM staff_shifts s WHERE s.branch_name = n.branch_name AND s.shift_date = d.work_date AND 'กะ' || s.shift = d.shift)))
            )
          ORDER BY n.sent_at DESC LIMIT 5`, [me.branch, me.name, me.id]);
        if (nudges.length) await sql(`UPDATE task_nudges SET seen_by = $2, seen_at = now() WHERE id = ANY($1) AND seen_at IS NULL`, [nudges.map((x) => x.id), me.name]);
      } catch { nudges = []; }
      return NextResponse.json({ kudos, cheers, bonusToday: b?.n ?? 0, nudges });
    }
    if (q.get("op") === "nudges") {
      if (!can(me, "tasks")) return forbidden();
      const date = /^\d{4}-\d{2}-\d{2}$/.test(q.get("date") ?? "") ? q.get("date")! : null;
      if (!date) return bad("วันที่ไม่ถูกต้อง");
      try {
        const rows = await sql(`SELECT DISTINCT ON (task_id) task_id AS "taskId", sent_by AS "sentBy", to_char(sent_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS at,
            seen_by AS "seenBy", to_char(seen_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS "seenAt", reply, reply_by AS "replyBy", to_char(replied_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS "replyAt"
          FROM task_nudges WHERE work_date = $1::date ${scoped(me) ? "AND branch_name = $2" : ""} ORDER BY task_id, sent_at DESC`, scoped(me) ? [date, me.branch] : [date]);
        return NextResponse.json({ items: rows });
      } catch { return NextResponse.json({ items: [] }); }
    }
    if (q.get("op") === "tasklog") {
      // ทะเบียนงาน: งานประจำวันย้อนหลังตามช่วงวันที่ (สูงสุด 92 วัน · 3,000 แถว)
      if (!can(me, "tasks_table") && !can(me, "tasks")) return forbidden();
      const ok = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
      const from = ok(q.get("from")), to = ok(q.get("to"));
      if (!from || !to || to < from) return bad("ช่วงวันที่ไม่ถูกต้อง");
      const br = scoped(me) ? me.branch : q.get("branch") || null;
      const rows = await sql(`SELECT work_date::text AS date, branch_name AS branch, resident_name AS resident, shift, task_name AS task, coalesce(nullif(done_by, '-'), nullif(assignee, '-'), '-') AS who,
          status, to_char(scheduled_time, 'HH24:MI') AS time, to_char(submitted_time, 'HH24:MI') AS sent, review_stars AS stars
        FROM daily_tasks WHERE work_date >= $1::date AND work_date <= $2::date AND work_date <= $1::date + 92 ${br ? "AND branch_name = $3" : ""}
        ORDER BY work_date DESC, scheduled_time, resident_name LIMIT 3000`, br ? [from, to, br] : [from, to]);
      return NextResponse.json({ rows });
    }
    if (q.get("op") === "insights") {
      if (!can(me, "dashboard")) return forbidden();
      const ok = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
      const from = ok(q.get("from")), to = ok(q.get("to")), pfrom = ok(q.get("pfrom")), pto = ok(q.get("pto"));
      if (!from || !to || !pfrom || !pto || to < from || pto < pfrom) return bad("ช่วงวันที่ไม่ถูกต้อง");
      const br = scoped(me) ? me.branch : q.get("branch") || null;
      const [data, att] = await Promise.all([insights(br, { from, to, pfrom, pto }), attention(me, br)]);
      return NextResponse.json({ ...data, attention: att });
    }
    if (q.get("op") !== "dashboard") return bad("unknown op");
    if (!can(me, "dashboard")) return forbidden();
    const month = q.get("range") === "month";
    const br = scoped(me) ? me.branch : q.get("branch") || null;
    const [{ today, mstart }] = (await sql`SELECT to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS today, to_char(date_trunc('month', now() AT TIME ZONE 'Asia/Bangkok'), 'YYYY-MM-DD') AS mstart`) as { today: string; mstart: string }[];
    const okd = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
    const from = okd(q.get("from")) ?? (month ? mstart : today);
    const until = okd(q.get("to")) ?? today;
    const bp = br ? [from, br] : [from];
    const bw = (col: string) => (br ? `AND ${col} = $2` : "");
    const tsFrom = `$1::date::timestamp AT TIME ZONE 'Asia/Bangkok'`;

    // สรุปรายสาขา
    const tasks = (await sql(`SELECT branch_name AS b, count(*)::int AS total, count(*) FILTER (WHERE status IN ('เสร็จแล้ว','ตรวจแล้ว'))::int AS done,
        count(*) FILTER (WHERE status = 'ตรวจแล้ว')::int AS checked, avg(review_stars)::float AS mstars
      FROM daily_tasks WHERE work_date >= $1::date AND work_date <= LEAST('${until}'::date, (now() AT TIME ZONE 'Asia/Bangkok')::date) ${bw("branch_name")} GROUP BY branch_name`, bp)) as Record<string, number & string>[];
    const fam = (await sql(`SELECT branch_name AS b, avg(rating)::float AS v, count(*)::int AS n FROM staff_reviews WHERE created_at >= ${tsFrom} AND (created_at AT TIME ZONE 'Asia/Bangkok')::date <= '${until}'::date ${bw("branch_name")} GROUP BY branch_name`, bp)) as Record<string, number & string>[];
    const sat = (await sql(`SELECT branch_name AS b, avg(score_overall)::float AS v, count(*)::int AS n FROM satisfaction_surveys WHERE created_at >= ${tsFrom} AND (created_at AT TIME ZONE 'Asia/Bangkok')::date <= '${until}'::date ${bw("branch_name")} GROUP BY branch_name`, bp)) as Record<string, number & string>[];
    const comp = (await sql(`SELECT branch_name AS b, count(*)::int AS n FROM complaints WHERE coalesce(reported_at, created_at AT TIME ZONE 'Asia/Bangkok') >= $1::date AND coalesce(reported_at, created_at AT TIME ZONE 'Asia/Bangkok')::date <= '${until}'::date ${bw("branch_name")} GROUP BY branch_name`, bp)) as Record<string, number & string>[];
    const res = (await sql(`SELECT branch_name AS b, count(*)::int AS n FROM residents WHERE coalesce(status, '') NOT LIKE 'ย้ายออก%' ${br ? "AND branch_name = $1" : ""} GROUP BY branch_name`, br ? [br] : [])) as Record<string, number & string>[];
    const names = [...new Set([...tasks, ...fam, ...sat, ...comp, ...res].map((x) => x.b).filter(Boolean))].sort();
    const one = (list: Record<string, number & string>[], b: string) => list.find((x) => x.b === b);
    const branches = names.map((b) => {
      const t = one(tasks, b), f = one(fam, b), s = one(sat, b), c = one(comp, b), r = one(res, b);
      const done = t?.done ?? 0, total = t?.total ?? 0, checked = t?.checked ?? 0;
      const donePct = pct(done, total), checkPct = pct(checked, done);
      const satPct = s?.v ? Math.round((s.v / 5) * 100) : null;
      // คะแนนรวม = % สำเร็จ + % ตรวจงาน × 0.5 + ดาวญาติเฉลี่ย × 10 + ความพึงพอใจ × 0.5 − คอมเพลน × 5
      const score = Math.round((donePct + checkPct * 0.5 + (f?.v ?? 0) * 10 + (satPct ?? 0) * 0.5 - (c?.n ?? 0) * 5) * 10) / 10;
      return { branch: b, total, done, checked, donePct, checkPct, mstars: t?.mstars ?? null, famStars: f?.v ?? null, famN: f?.n ?? 0, satPct, satN: s?.n ?? 0, complaints: c?.n ?? 0, residents: r?.n ?? 0, perResident: r?.n ? Math.round((done / r.n) * 10) / 10 : 0, score };
    });

    // สถานะกะวันนี้
    const shiftRows = (await sql(`SELECT shift, count(*)::int AS total, count(*) FILTER (WHERE status IN ('เสร็จแล้ว','ตรวจแล้ว'))::int AS done, count(*) FILTER (WHERE status = 'ตรวจแล้ว')::int AS checked
      FROM daily_tasks WHERE work_date = $1::date ${bw("branch_name")} GROUP BY shift`, [today, ...(br ? [br] : [])])) as { shift: string; total: number; done: number; checked: number }[];
    const duty = (await sql(`SELECT s.shift, s.staff_name, EXISTS (SELECT 1 FROM daily_tasks d WHERE d.work_date = s.shift_date AND d.done_by = s.staff_name) AS active
      FROM staff_shifts s WHERE s.shift_date = $1::date ${br ? "AND s.branch_name = $2" : ""}`, [today, ...(br ? [br] : [])])) as { shift: string; staff_name: string; active: boolean }[];
    const shifts = ["เช้า", "ดึก"].map((s) => {
      const r = shiftRows.find((x) => x.shift === `กะ${s}`) ?? { total: 0, done: 0, checked: 0 };
      const d = duty.filter((x) => x.shift === s);
      return { shift: s, total: r.total, done: r.done, checked: r.checked, staff: d.length, active: d.filter((x) => x.active).length, names: d.map((x) => x.staff_name) };
    });

    // งานที่เพิ่งส่ง (พร้อมสถานะชื่นชม)
    const activity = await sql(`SELECT d.id, d.done_by AS who, d.task_name AS task, d.resident_name AS resident, d.branch_name AS branch, to_char(d.submitted_time, 'HH24:MI') AS at, d.work_date::text AS date,
        EXISTS (SELECT 1 FROM kudos k WHERE k.task_id = d.id) AS praised
      FROM daily_tasks d WHERE d.work_date >= (now() AT TIME ZONE 'Asia/Bangkok')::date - 1 AND d.status IN ('เสร็จแล้ว','ตรวจแล้ว') AND d.done_by IS NOT NULL AND d.done_by <> '-' ${br ? "AND d.branch_name = $1" : ""}
      ORDER BY d.work_date DESC, d.submitted_time DESC NULLS LAST LIMIT 12`, br ? [br] : []);
    return NextResponse.json({ range: month ? "month" : "today", from, to: until, branches, shifts, activity });
  } catch (e) {
    console.error("[api/ops]", e);
    return bad("database error", 500);
  }
}

export async function POST(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    if (b.op === "kudos") {
      if (!can(me, "dashboard") && !can(me, "tasks.review")) return forbidden("บัญชีนี้ไม่มีสิทธิ์ชื่นชมงาน");
      const [t] = (await sql`SELECT id, task_name, resident_name, branch_name, done_by FROM daily_tasks WHERE id = ${String(b.taskId ?? "")}`) as Record<string, string>[];
      if (!t || !t.done_by || t.done_by === "-") return bad("ไม่พบงานที่ส่งแล้ว", 404);
      if (scoped(me) && t.branch_name !== me.branch) return forbidden();
      const [had] = await sql`SELECT 1 FROM kudos WHERE task_id = ${t.id}`;
      if (had) return NextResponse.json({ ok: true, already: true });
      await sql`INSERT INTO kudos (id, branch_name, staff_name, task_id, task_title, resident_name, given_by) VALUES (${randomUUID()}, ${t.branch_name}, ${t.done_by}, ${t.id}, ${t.task_name}, ${t.resident_name}, ${me.name})`;
      return NextResponse.json({ ok: true, staff: t.done_by });
    }
    if (b.op === "nudge") {
      if (!can(me, "tasks")) return forbidden("บัญชีนี้ไม่มีสิทธิ์ตามงาน");
      const [t] = (await sql`SELECT id, work_date::text AS date, branch_name, task_name, resident_name, assignee, status, shift, to_char(scheduled_time, 'HH24:MI') AS time FROM daily_tasks WHERE id = ${String(b.taskId ?? "")}`) as Record<string, string>[];
      if (!t) return bad("ไม่พบงาน", 404);
      if (scoped(me) && t.branch_name !== me.branch) return forbidden();
      if (t.status === "เสร็จแล้ว" || t.status === "ตรวจแล้ว") return bad("งานนี้ส่งแล้ว");
      // ตามผู้รับผิดชอบ · ยังไม่มีผู้รับผิดชอบ (ใครก็ได้) = พยาบาลที่อยู่เวรของงานนั้น (ยังไม่จัดเวร = ทุกคนในสาขา)
      const target = t.assignee && t.assignee !== "-" && !/ใครก็ได้|ทุกคน/.test(t.assignee) ? t.assignee : null;
      await sql`INSERT INTO task_nudges (id, task_id, work_date, branch_name, task_name, resident_name, target, message, sent_by)
        VALUES (${randomUUID()}, ${t.id}, ${t.date}::date, ${t.branch_name}, ${t.task_name}, ${t.resident_name}, ${target}, ${text(b.message, 200) || null}, ${me.name})`;
      // เด้งบนโทรศัพท์ของผู้รับผิดชอบ (หรือพยาบาลทุกคนในสาขา) ที่เปิดการแจ้งเตือนไว้ · ส่งไม่ได้ก็ไม่เป็นไร แถบแดงใน KinApp ยังขึ้นตามปกติ
      const msg = text(b.message, 80);
      const phones = await pushTo(target ? await staffIds(t.branch_name, target) : await shiftStaffIds(t.branch_name, t.date, t.shift), {
        title: `หัวหน้าตามงาน · ${me.name}`,
        body: `${t.task_name}${t.resident_name && t.resident_name !== "-" ? ` · ${t.resident_name}` : ""}${t.time ? ` · ${t.time} น.` : ""}${msg ? `
"${msg}"` : ""}`,
        url: "/staff", tag: `nudge-${t.id}`,
      });
      return NextResponse.json({ ok: true, target, phones });
    }
    if (b.op === "nudge_reply") {
      const reason = text(b.reason, 120);
      if (!reason) return bad("กรุณาเลือกเหตุผล");
      // ถึงฉันโดยตรง: ตอบได้ครั้งเดียว · ถึงทีมเวร: แต่ละคนตอบได้ (ต่อท้ายเหตุผลและชื่อ) ซ่อนเฉพาะคนที่ตอบ คนอื่นในเวรยังเห็น
      const [n] = (await sql`UPDATE task_nudges SET
          reply = CASE WHEN reply IS NULL THEN ${reason} ELSE reply || ' · ' || ${reason} END,
          reply_by = CASE WHEN reply_by IS NULL THEN ${me.name} ELSE reply_by || ', ' || ${me.name} END, replied_at = now()
        WHERE id = ${String(b.id ?? "")} AND branch_name = ${me.branch}
          AND ((target = ${me.name} AND reply IS NULL)
            OR (target IS NULL AND position(', ' || ${me.name} || ', ' in ', ' || coalesce(reply_by, '') || ', ') = 0))
        RETURNING task_name`) as { task_name: string }[];
      if (!n) return bad("ไม่พบการตามงานนี้ หรือมีคนตอบไปแล้ว", 404);
      return NextResponse.json({ ok: true });
    }
    if (b.op === "cheer") {
      if (!can(me, "dashboard")) return forbidden();
      const branch = scoped(me) ? me.branch : text(b.branch, 120);
      const message = text(b.message, 500);
      if (!branch || !message) return bad("กรุณาเลือกสาขาและพิมพ์ข้อความ");
      const id = randomUUID();
      await sql`INSERT INTO branch_cheers (id, branch_name, message, sent_by) VALUES (${id}, ${branch}, ${message}, ${me.name})`;
      await audit(req, me, [{ area: "cheers", action: "create", recordId: id, summary: `ส่งกำลังใจถึงสาขา${branch}`, branch }]);
      return NextResponse.json({ ok: true, branch });
    }
    if (b.op === "bonus") {
      if (!can(me, "app.staff")) return forbidden();
      const title = text(b.title, 200);
      if (!title) return bad("กรุณาระบุผลงานพิเศษ");
      const id = randomUUID();
      const photo = typeof b.photo === "string" && b.photo.startsWith("data:image/") && b.photo.length < 900_000 ? b.photo : null;
      await sql`INSERT INTO staff_bonus (id, branch_name, staff_name, title, note, photo) VALUES (${id}, ${me.branch}, ${me.name}, ${title}, ${text(b.note, 1000) || null}, ${photo})`;
      await audit(req, me, [{ area: "bonus", action: "create", recordId: id, summary: `ผลงานพิเศษ · ${title}`, branch: me.branch }]);
      return NextResponse.json({ ok: true, id });
    }
    return bad("unknown op");
  } catch (e) {
    console.error("[api/ops]", e);
    return bad("database error", 500);
  }
}
