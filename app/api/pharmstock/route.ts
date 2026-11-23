import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUser, forbidden, unauthorized } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { can } from "@/lib/perms";
import { medSlotsSql } from "@/lib/medSlots";
import { seesAllBranches } from "@/lib/roles";
import type { SessionUser } from "@/lib/roles";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * คลังยากลางของศูนย์ (ยาที่ศูนย์ซื้อเอง · แยกตามสาขา · ราคาขายเดียวทุกสาขา)
 *  ผู้จัดการคลัง = ผู้บริหาร ผู้จัดการสาขา หัวหน้าพยาบาล · พยาบาลเบิกให้ผู้ป่วยได้อย่างเดียว · ตั้งราคา = ผู้จัดการคลังทุกคน (ราคาเดียวใช้ทุกสาขา)
 *  GET  ?op=list[&branch=]           รายการยา คงเหลือของสาขา ล็อต และวันหมดอายุใกล้สุด
 *  GET  ?op=alerts                  ยาคลังกลางที่ถึงจุดสั่งซื้อหรือหมดอายุภายใน 60 วัน (แดชบอร์ดแอปจัดยา · กระดิ่งของผู้จัดการ)
 *  GET  ?op=moves&drug=…[&branch=]   ประวัติการเพิ่มลดของยานั้น
 *  POST { op: "item", id?, name, unit, form?, price?, min?, note? }   เพิ่ม/แก้รายการยาและราคา (ผู้บริหาร ผู้จัดการสาขา หัวหน้าพยาบาล)
 *  POST { op: "receive", drugId, qty, lot?, expiry?, cost?, branch? }  รับยาเข้าคลังสาขา
 *  POST { op: "adjust", lotId, qty, reason, note? }   ตรวจนับ/ตัดหมดอายุ: ตั้งคงเหลือของล็อตเป็นค่าใหม่
 *  POST { op: "issue", drugId, qty, residentId | residentName, note?, basket?, medId? }   เบิกให้ผู้ป่วย (ตัดล็อตที่หมดอายุก่อนก่อน) · ขึ้นรอเรียกเก็บที่การเงิน
 *       basket = { dose, meals, days?, how?, use?, timing?, store?, form?, bulk?, warn?, fridge? } → สร้างยาในตะกร้าผู้ป่วย (ขึ้นหน้าจัดยารายวัน)
 *       medId  = เติมยาในตะกร้าที่มีอยู่ (บวกคงเหลือ) · ไม่ส่งทั้งสองอย่าง = เบิกครั้งเดียว (ยาให้ครั้งคราว)
 *  GET  ?op=withdrawals&resident=ชื่อ   ประวัติการเบิกยาจากตะกร้าผู้ป่วย (รวมคงเหลือที่ลดลงก่อนมีเมนูเบิกยา)
 *  POST { op: "withdraw", medId, qty, meal?, note? }   เบิกยาจากตะกร้าผู้ป่วยตามจำนวนที่ใช้จริง (ตัดคงเหลือ + เก็บเป็นรายการ)
 *  POST { op: "withdraw_void", id, reason }   ยกเลิกการเบิกที่กดผิด (คืนคงเหลือ · เก็บรายการพร้อมเหตุผล)
 *  POST { op: "give", meal, checked, items: [{ medId, qty }], skips: [{ medId, reason }], note? }   ให้ยาทั้งมื้อของผู้ป่วย 1 คน (KinApp)
 *  GET  ?op=summary&from=&to=[&branch=]   ภาพรวมห้องยาตามช่วงวันที่: ให้ยาตามมื้อรายวัน/รายมื้อ · เหตุผลที่ไม่ได้ให้ · ผู้ป่วยที่ให้ไม่ครบ · เบิกตามอาการ · เทียบช่วงก่อน
 *  GET  ?op=mar&from=&to=[&branch=]      บันทึกการให้ยาทุกครั้งในช่วง (ให้แล้ว · ไม่ได้ให้ · ยกเลิก) สำหรับไฟล์ส่งออก
 *  GET  ?op=missed&from=&to=[&branch=]   ยา × มื้อ ที่ยังไม่ได้ให้ / ไม่ได้ให้ (lib/medSlots · นับถึงเมื่อวาน) สำหรับไฟล์ส่งออก
 *  GET  ?op=withdrawals_day&date=   จำนวนครั้งที่เบิกของแต่ละคน + slots (ยา × มื้อ ที่ให้แล้ว/ไม่ได้ให้) ของวันนั้น
 */
const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
const isManager = (me: SessionUser) => ["Global Admin", "Branch Admin", "Head Nurse"].includes(me.role);
const canIssue = (me: SessionUser) => isManager(me) || can(me, "app.pharmacy") || can(me, "app.staff");
const text = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN; };
const branchOf = (me: SessionUser, b: unknown) => (me.role === "Global Admin" ? text(b, 120) || null : me.branch);
const REASONS = ["ตรวจนับแล้วไม่ตรง", "หมดอายุ / เสีย", "แตก / หาย", "อื่น ๆ"];

export async function GET(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (!canIssue(me)) return forbidden();
  const q = req.nextUrl.searchParams;
  const br = branchOf(me, q.get("branch"));
  try {
    if (q.get("op") === "list") {
      const drugs = await sql`SELECT id, name, unit, form, price::float, min_qty, note FROM stock_drugs ORDER BY lower(name)`;
      const lots = br
        ? await sql`SELECT id, branch_name, drug_id, lot, expiry::text, qty::float, cost::float FROM stock_lots WHERE branch_name = ${br} AND qty > 0 ORDER BY expiry NULLS LAST, created_at`
        : await sql`SELECT id, branch_name, drug_id, lot, expiry::text, qty::float, cost::float FROM stock_lots WHERE qty > 0 ORDER BY expiry NULLS LAST, created_at`;
      return NextResponse.json({ branch: br, drugs, lots, manager: isManager(me), pricer: isManager(me), reasons: REASONS });
    }
    if (q.get("op") === "alerts") {
      // นับเฉพาะยาที่สาขาเคยรับเข้า (มีล็อต) · หมดอายุนับจากล็อตที่ยังเหลือของ
      const rows = (await sql(`SELECT d.id, d.name, d.unit, d.min_qty, l.branch_name, sum(l.qty)::float AS qty, (min(l.expiry) FILTER (WHERE l.qty > 0))::text AS expiry
        FROM stock_lots l JOIN stock_drugs d ON d.id = l.drug_id ${br ? "WHERE l.branch_name = $1" : ""}
        GROUP BY d.id, d.name, d.unit, d.min_qty, l.branch_name
        HAVING sum(l.qty) <= d.min_qty OR min(l.expiry) FILTER (WHERE l.qty > 0) <= (now() AT TIME ZONE 'Asia/Bangkok')::date + 60
        ORDER BY l.branch_name, d.name`, br ? [br] : [])) as { id: string; name: string; unit: string; min_qty: number; branch_name: string; qty: number; expiry: string | null }[];
      const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
      const items = rows.map((r) => ({ ...r, low: r.qty <= r.min_qty, days: r.expiry ? Math.ceil((new Date(r.expiry).getTime() - new Date(today).getTime()) / 864e5) : null }));
      return NextResponse.json({ items });
    }
    if (q.get("op") === "moves") {
      const drug = q.get("drug") ?? "";
      const rows = await sql(`SELECT m.branch_name, m.delta::float, m.reason, m.resident_name, m.price::float, m.invoice_id, m.note, m.moved_by, l.lot,
          to_char(m.created_at AT TIME ZONE 'Asia/Bangkok', 'DD/MM/') || (extract(year FROM m.created_at AT TIME ZONE 'Asia/Bangkok')::int + 543) || to_char(m.created_at AT TIME ZONE 'Asia/Bangkok', ' HH24:MI') AS at
        FROM stock_moves m LEFT JOIN stock_lots l ON l.id = m.lot_id WHERE m.drug_id = $1 ${br ? "AND m.branch_name = $2" : ""} ORDER BY m.created_at DESC LIMIT 200`, br ? [drug, br] : [drug]);
      return NextResponse.json({ moves: rows });
    }
    if (q.get("op") === "mar" || q.get("op") === "missed") {
      // ไฟล์ส่งออก (หน้าส่งออกข้อมูล): ช่วงไม่เกิน 1 ปี · ผู้บริหารเลือกสาขาได้ · คนอื่นเห็นสาขาตัวเอง
      const D = /^\d{4}-\d{2}-\d{2}$/;
      const from = String(q.get("from") ?? ""), to = String(q.get("to") ?? "");
      if (!D.test(from) || !D.test(to) || to < from) return bad("ช่วงวันที่ไม่ถูกต้อง");
      if ((Date.parse(to) - Date.parse(from)) / 864e5 > 366) return bad("เลือกช่วงได้ไม่เกิน 1 ปี");
      const scope = seesAllBranches(me.role) ? text(q.get("branch"), 120) || null : me.branch;
      const ROOM = (name: string, br: string) => `(SELECT r.room FROM residents r WHERE r.full_name = ${name} AND r.branch_name IS NOT DISTINCT FROM ${br} LIMIT 1)`;
      if (q.get("op") === "mar") {
        const rows = await sql(`SELECT to_char(w.created_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS day, to_char(w.created_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS time,
            w.branch_name AS branch, w.resident_name AS resident, ${ROOM("w.resident_name", "w.branch_name")} AS room, w.drug_name AS drug, coalesce(w.meal, '') AS meal,
            w.qty::float AS qty, coalesce(w.unit, '') AS unit, w.skip_reason AS skip, w.withdrawn_by AS by, w.stock_before::float AS b, w.stock_after::float AS a, coalesce(w.note, '') AS note,
            w.voided_at IS NOT NULL AS voided, coalesce(w.void_reason, '') AS void_reason, coalesce(w.voided_by, '') AS voided_by
          FROM med_withdrawals w WHERE (w.created_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN $1::date AND $2::date ${scope ? "AND w.branch_name = $3" : ""}
          ORDER BY w.created_at LIMIT 20000`, scope ? [from, to, scope] : [from, to]);
        return NextResponse.json({ items: rows });
      }
      const rows = await sql(`SELECT m.day::text AS day, m.branch_name AS branch, m.resident_name AS resident, ${ROOM("m.resident_name", "m.branch_name")} AS room, m.meal, m.drug_name AS drug, m.skip
        FROM ${medSlotsSql("$1::date", "LEAST($2::date, (now() AT TIME ZONE 'Asia/Bangkok')::date - 1)")} m WHERE NOT m.given ${scope ? "AND m.branch_name = $3" : ""}
        ORDER BY m.day, m.resident_name, m.meal LIMIT 20000`, scope ? [from, to, scope] : [from, to]);
      return NextResponse.json({ items: rows });
    }
    if (q.get("op") === "summary") {
      // ภาพรวมห้องยา (KINmed): นับจากยา × มื้อ ที่ต้องให้ (medSlotsSql) · ผู้บริหารเลือกสาขาได้ (ไม่เลือก = ทุกสาขา) · คนอื่นเห็นสาขาตัวเอง
      const D = /^\d{4}-\d{2}-\d{2}$/;
      const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
      let from = D.test(q.get("from") ?? "") ? String(q.get("from")) : today, to = D.test(q.get("to") ?? "") ? String(q.get("to")) : today;
      if (to > today) to = today;
      if (from > to) [from, to] = [to, from];
      const n = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
      if (n > 366) return bad("เลือกช่วงได้ไม่เกิน 1 ปี");
      const all = seesAllBranches(me.role);
      const scope = all ? text(q.get("branch"), 120) || null : me.branch;
      const pFrom = new Date(Date.parse(from) - n * 864e5).toISOString().slice(0, 10), pTo = new Date(Date.parse(from) - 864e5).toISOString().slice(0, 10);
      const W = scope ? "AND m.branch_name = $3" : "";
      const WW = scope ? "AND w.branch_name = $3" : "";
      const p = (a: string, b: string) => (scope ? [a, b, scope] : [a, b]);
      const S = `WITH s AS (SELECT m.*, (NOT m.given AND m.skip IS NOT NULL) AS sk FROM ${medSlotsSql("$1::date", "$2::date")} m WHERE true ${W})`;
      const PRN = `FROM med_withdrawals w WHERE w.voided_at IS NULL AND w.skip_reason IS NULL AND coalesce(w.meal, '') = ''
          AND (w.created_at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN $1::date AND $2::date ${WW}`;
      const [[cur], [prev], branches] = await Promise.all([
        sql(`${S} SELECT
          (SELECT coalesce(json_agg(x ORDER BY x.day), '[]') FROM (SELECT day::text AS day, count(*)::int AS due, count(*) FILTER (WHERE given)::int AS given, count(*) FILTER (WHERE sk)::int AS skip FROM s GROUP BY day) x) AS days,
          (SELECT coalesce(json_agg(x), '[]') FROM (SELECT meal, count(*)::int AS due, count(*) FILTER (WHERE given)::int AS given, count(*) FILTER (WHERE sk)::int AS skip FROM s GROUP BY meal) x) AS meals,
          (SELECT coalesce(json_agg(x ORDER BY x.n DESC), '[]') FROM (SELECT skip AS reason, count(*)::int AS n FROM s WHERE sk GROUP BY skip) x) AS reasons,
          (SELECT coalesce(json_agg(x ORDER BY x.due - x.given DESC, x.name), '[]') FROM (
            SELECT y.*, (SELECT r.room FROM residents r WHERE r.full_name = y.name AND r.branch_name IS NOT DISTINCT FROM y.branch LIMIT 1) AS room
            FROM (SELECT resident_name AS name, branch_name AS branch, count(*)::int AS due, count(*) FILTER (WHERE given)::int AS given, count(*) FILTER (WHERE sk)::int AS skip
              FROM s GROUP BY resident_name, branch_name HAVING count(*) FILTER (WHERE NOT given) > 0 ORDER BY count(*) FILTER (WHERE NOT given) DESC LIMIT 8) y) x) AS people,
          (SELECT coalesce(json_agg(x ORDER BY x.day), '[]') FROM (SELECT (w.created_at AT TIME ZONE 'Asia/Bangkok')::date::text AS day, count(*)::int AS n ${PRN} GROUP BY 1) x) AS prn,
          (SELECT coalesce(json_agg(x ORDER BY x.n DESC), '[]') FROM (SELECT w.drug_name AS name, count(*)::int AS n ${PRN} GROUP BY 1 ORDER BY 2 DESC LIMIT 6) x) AS "prnTop"`, p(from, to)),
        sql(`${S} SELECT (SELECT count(*)::int FROM s) AS due, (SELECT count(*) FILTER (WHERE given)::int FROM s) AS given, (SELECT count(*)::int ${PRN}) AS prn`, p(pFrom, pTo)),
        all ? sql`SELECT DISTINCT branch_name AS b FROM resident_medications WHERE branch_name IS NOT NULL ORDER BY 1` : Promise.resolve([]),
      ]);
      return NextResponse.json({ from, to, today, branch: scope, all, branches: (branches as { b: string }[]).map((x) => x.b), prev: { from: pFrom, to: pTo, ...prev }, ...cur });
    }
    if (q.get("op") === "withdrawals_day") {
      // จำนวนครั้งที่เบิกของแต่ละคนในวันที่เลือก (ไม่นับที่ยกเลิก) · รายชื่อในเมนูเบิกยาตามใช้
      const day = /^\d{4}-\d{2}-\d{2}$/.test(q.get("date") ?? "") ? String(q.get("date")) : new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
      const scope = me.role === "Global Admin" ? null : me.branch;
      const p = scope ? [day, scope] : [day];
      const [rows, slots] = await Promise.all([
        sql(`SELECT resident_name AS name, count(*)::int AS n, to_char(max(created_at) AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS last
          FROM med_withdrawals WHERE voided_at IS NULL AND skip_reason IS NULL AND (created_at AT TIME ZONE 'Asia/Bangkok')::date = $1::date ${scope ? "AND branch_name = $2" : ""}
          GROUP BY resident_name`, p).catch(() => []),
        // ยาไหน มื้อไหน ให้แล้ว/ไม่ได้ให้ (หน้าให้ยา KinApp · สถานะมื้อในเมนูเบิกยา)
        sql(`SELECT id, resident_name AS name, med_id, meal, qty::float, skip_reason, withdrawn_by AS by, to_char(created_at AT TIME ZONE 'Asia/Bangkok', 'HH24:MI') AS at
          FROM med_withdrawals WHERE voided_at IS NULL AND (created_at AT TIME ZONE 'Asia/Bangkok')::date = $1::date ${scope ? "AND branch_name = $2" : ""}
          ORDER BY created_at`, p).catch(() => []),
      ]);
      return NextResponse.json({ items: rows, slots });
    }
    if (q.get("op") === "withdrawals") {
      // ประวัติการเบิกยาจากตะกร้าของผู้ป่วยคนนี้: รายการเบิก (med_withdrawals) + คงเหลือที่ลดลงก่อนมีเมนูเบิกยา (จากประวัติการแก้ไข)
      const who = text(q.get("resident"), 200);
      if (!who) return bad("กรุณาเลือกผู้ป่วย");
      const scope = me.role === "Global Admin" ? null : me.branch;
      const p = scope ? [who, scope] : [who];
      const TH = (c: string) => `to_char(${c} AT TIME ZONE 'Asia/Bangkok', 'DD/MM/') || (extract(year FROM ${c} AT TIME ZONE 'Asia/Bangkok')::int + 543) || to_char(${c} AT TIME ZONE 'Asia/Bangkok', ' HH24:MI')`;
      const TS = (c: string) => `to_char(${c} AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI:SS')`;
      const [rows, legacy] = await Promise.all([
        sql(`SELECT id, med_id, drug_name AS name, qty::float, unit, stock_before::float AS b, stock_after::float AS s, meal, note, withdrawn_by AS by, ${TH("created_at")} AS at, ${TS("created_at")} AS ts,
            void_reason, voided_by, skip_reason, ${TH("voided_at")} AS voided_at, created_at > now() - interval '24 hours' AS fresh
          FROM med_withdrawals WHERE resident_name = $1 ${scope ? "AND branch_name = $2" : ""} ORDER BY created_at DESC LIMIT 300`, p).catch(() => []), // ยังไม่ได้รัน db:setup
        // บันทึกเดิม: คงเหลือที่ลดลงก่อนมีเมนูเบิกยา ของยาที่ปุ่ม "เบิกยาตามจำนวน" เดิมเบิกได้ (ยาขวด · ยาน้ำ ml · ไม่มีมื้อ) · อาจรวมการตัดยาน้ำตอนจัดซอง (แยกไม่ได้)
        sql(`SELECT a.id::text, a.record_id AS med_id, coalesce(a.after->>'drug_name', a.before->>'drug_name') AS name, coalesce(a.after->>'unit', a.before->>'unit') AS unit,
            a.before->>'stock' AS b, a.after->>'stock' AS s, a.actor_name AS by, ${TH("a.at")} AS at, ${TS("a.at")} AS ts
          FROM audit_logs a WHERE a.area = 'pharmacy-drugs' AND a.action = 'update' AND (a.before->>'stock') IS DISTINCT FROM (a.after->>'stock')
            AND (a.after->>'is_bulk' = 'true' OR lower(trim(coalesce(a.after->>'unit', ''))) = 'ml' OR (jsonb_typeof(a.after->'meals') = 'array' AND jsonb_array_length(a.after->'meals') = 0))
            AND a.at < coalesce((SELECT min(created_at) FROM med_withdrawals), now())
            AND a.record_id IN (SELECT id::text FROM resident_medications WHERE resident_name = $1 ${scope ? "AND branch_name = $2" : ""})
          ORDER BY a.at DESC LIMIT 300`, p).catch(() => []),
      ]);
      const n = (v: unknown) => { const s = String(v ?? "").trim(); const x = Number(s); return s !== "" && Number.isFinite(x) ? x : null; };
      const old = (legacy as Record<string, unknown>[]).flatMap((r): Record<string, unknown>[] => {
        const b = n(r.b), s = n(r.s);
        return b !== null && s !== null && s < b ? [{ ...r, b, s, qty: Math.round((b - s) * 100) / 100, meal: null, note: null, legacy: true }] : [];
      });
      const items = [...(rows as Record<string, unknown>[]), ...old].sort((x, y) => String(y.ts).localeCompare(String(x.ts)));
      return NextResponse.json({ items });
    }
    return bad("unknown op");
  } catch (e) {
    console.error("[api/pharmstock]", e);
    return bad("database error", 500);
  }
}

export async function POST(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    switch (b.op) {
      case "item": {
        if (!isManager(me)) return forbidden("เพิ่มรายการยาได้เฉพาะผู้จัดการสาขาและหัวหน้าพยาบาลขึ้นไป");
        const name = text(b.name, 120), unit = text(b.unit, 30) || "เม็ด";
        if (!name) return bad("กรุณากรอกชื่อยา");
        const min = Math.max(0, Math.floor(Number(b.min) || 10));
        const priceIn = num(b.price);
        const pricer = isManager(me); // ราคาเดียวทุกสาขา: ผู้จัดการสาขาหรือหัวหน้าพยาบาลแก้ = มีผลทุกสาขา (บันทึกในบันทึกการใช้งานระบบ)
        if (b.id) {
          const [d] = (await sql`SELECT id, price::float FROM stock_drugs WHERE id = ${String(b.id)}`) as { id: string; price: number | null }[];
          if (!d) return bad("ไม่พบรายการยา", 404);
          const price = pricer && Number.isFinite(priceIn) ? priceIn : d.price;
          await sql`UPDATE stock_drugs SET name = ${name}, unit = ${unit}, form = ${text(b.form, 60) || null}, price = ${price}, min_qty = ${min}, note = ${text(b.note, 300) || null} WHERE id = ${d.id}`;
          await audit(req, me, [{ area: "stock", action: "update", recordId: d.id, summary: `รายการยาคลังกลาง · ${name}${pricer && price !== d.price ? ` · ราคา ${price ?? "-"}` : ""}`, branch: null }]);
          return NextResponse.json({ ok: true, id: d.id });
        }
        const [dup] = await sql`SELECT 1 FROM stock_drugs WHERE lower(name) = lower(${name})`;
        if (dup) return bad("มียานี้ในคลังกลางแล้ว");
        const id = randomUUID();
        await sql`INSERT INTO stock_drugs (id, name, unit, form, price, min_qty, note) VALUES (${id}, ${name}, ${unit}, ${text(b.form, 60) || null}, ${pricer && Number.isFinite(priceIn) ? priceIn : null}, ${min}, ${text(b.note, 300) || null})`;
        await audit(req, me, [{ area: "stock", action: "create", recordId: id, summary: `เพิ่มยาในคลังกลาง · ${name}`, branch: null }]);
        return NextResponse.json({ ok: true, id });
      }
      case "receive": {
        if (!isManager(me)) return forbidden("รับยาเข้าคลังกลางได้เฉพาะผู้จัดการสาขาและหัวหน้าพยาบาลขึ้นไป");
        const br = branchOf(me, b.branch);
        if (!br) return bad("กรุณาเลือกสาขา");
        const qty = num(b.qty);
        if (!(qty > 0)) return bad("กรุณาระบุจำนวนที่รับเข้า");
        const [d] = (await sql`SELECT id, name, unit FROM stock_drugs WHERE id = ${String(b.drugId ?? "")}`) as Record<string, string>[];
        if (!d) return bad("ไม่พบรายการยา", 404);
        const expiry = typeof b.expiry === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.expiry) ? b.expiry : null;
        const cost = num(b.cost);
        const lotId = randomUUID();
        await sql`INSERT INTO stock_lots (id, branch_name, drug_id, lot, expiry, qty, cost) VALUES (${lotId}, ${br}, ${d.id}, ${text(b.lot, 60) || null}, ${expiry}::date, ${qty}, ${Number.isFinite(cost) ? cost : null})`;
        await sql`INSERT INTO stock_moves (id, branch_name, drug_id, lot_id, delta, reason, moved_by, note) VALUES (${randomUUID()}, ${br}, ${d.id}, ${lotId}, ${qty}, 'รับเข้า', ${me.name}, ${text(b.note, 300) || null})`;
        await audit(req, me, [{ area: "stock", action: "update", recordId: d.id, summary: `รับยาเข้าคลังกลาง · ${d.name} ${qty} ${d.unit}`, branch: br }]);
        return NextResponse.json({ ok: true });
      }
      case "adjust": {
        if (!isManager(me)) return forbidden("ปรับสต็อกได้เฉพาะผู้จัดการสาขาและหัวหน้าพยาบาลขึ้นไป");
        const reason = text(b.reason, 60);
        if (!REASONS.includes(reason)) return bad("กรุณาเลือกเหตุผล");
        const qty = num(b.qty);
        if (!(qty >= 0)) return bad("จำนวนคงเหลือใหม่ไม่ถูกต้อง");
        const [l] = (await sql`SELECT l.id, l.branch_name, l.drug_id, l.qty::float, d.name, d.unit FROM stock_lots l JOIN stock_drugs d ON d.id = l.drug_id WHERE l.id = ${String(b.lotId ?? "")}`) as Record<string, string & number>[];
        if (!l) return bad("ไม่พบล็อตนี้", 404);
        if (me.role !== "Global Admin" && l.branch_name !== me.branch) return forbidden();
        const delta = Math.round((qty - l.qty) * 100) / 100;
        if (!delta) return NextResponse.json({ ok: true, delta: 0 });
        await sql`UPDATE stock_lots SET qty = ${qty} WHERE id = ${l.id}`;
        await sql`INSERT INTO stock_moves (id, branch_name, drug_id, lot_id, delta, reason, moved_by, note) VALUES (${randomUUID()}, ${l.branch_name}, ${l.drug_id}, ${l.id}, ${delta}, ${reason}, ${me.name}, ${text(b.note, 300) || null})`;
        await audit(req, me, [{ area: "stock", action: "update", recordId: l.drug_id, summary: `ปรับสต็อก ${l.name} ${l.qty} → ${qty} ${l.unit} · ${reason}`, branch: l.branch_name }]);
        return NextResponse.json({ ok: true, delta });
      }
      case "issue": {
        if (!canIssue(me)) return forbidden();
        const qty = num(b.qty);
        if (!(qty > 0)) return bad("กรุณาระบุจำนวนที่เบิก");
        // จากหน้ารับยาเข้าตะกร้าส่งชื่อผู้ป่วยมา (หาในสาขาของผู้ใช้ก่อน)
        const [r] = (b.residentId
          ? await sql`SELECT id, full_name, branch_name FROM residents WHERE id = ${String(b.residentId)}`
          : await sql`SELECT id, full_name, branch_name FROM residents WHERE full_name = ${text(b.residentName, 200)} ORDER BY (branch_name = ${me.branch}) DESC, created_at LIMIT 1`) as Record<string, string>[];
        if (!r) return bad("ไม่พบผู้รับบริการ", 404);
        if (me.role !== "Global Admin" && r.branch_name !== me.branch) return forbidden("เบิกได้เฉพาะผู้รับบริการในสาขาของคุณ");
        const [d] = (await sql`SELECT id, name, unit, form, price::float FROM stock_drugs WHERE id = ${String(b.drugId ?? "")}`) as { id: string; name: string; unit: string; form: string | null; price: number | null }[];
        if (!d) return bad("ไม่พบรายการยา", 404);
        // เติมยาในตะกร้าที่มีอยู่: ต้องเป็นยาของผู้ป่วยคนนี้
        const refill = b.medId ? ((await sql`SELECT id, drug_name FROM resident_medications WHERE id = ${String(b.medId)} AND (resident_id = ${r.id} OR (resident_id IS NULL AND resident_name = ${r.full_name}))`) as { id: string; drug_name: string }[])[0] : null;
        if (b.medId && !refill) return bad("ไม่พบยานี้ในตะกร้าของผู้ป่วย", 404);
        const basket = !refill && b.basket && typeof b.basket === "object" ? (b.basket as Record<string, unknown>) : null;
        const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 60)).slice(0, 20) : []);
        if (basket && !basket.bulk && !list(basket.meals).length) return bad("กรุณาเลือกมื้อยาอย่างน้อย 1 มื้อ");
        // ตัดล็อตที่หมดอายุก่อนก่อน (FEFO) · ตัดทีละล็อตแบบมีเงื่อนไข กันสองเครื่องเบิกพร้อมกันจนติดลบ
        const lots = (await sql`SELECT id, qty::float FROM stock_lots WHERE branch_name = ${r.branch_name} AND drug_id = ${d.id} AND qty > 0 ORDER BY expiry NULLS LAST, created_at`) as { id: string; qty: number }[];
        const have = lots.reduce((n, l) => n + l.qty, 0);
        if (have < qty) return bad(`ยาในคลังกลางของสาขาไม่พอ · เหลือ ${have} ${d.unit}`, 409);
        let need = qty;
        const taken: { id: string; n: number }[] = [];
        for (const l of lots) {
          if (need <= 0) break;
          const n = Math.min(need, l.qty);
          const ok = (await sql`UPDATE stock_lots SET qty = qty - ${n} WHERE id = ${l.id} AND qty >= ${n} RETURNING id`) as unknown[];
          if (!ok.length) { for (const t of taken) await sql`UPDATE stock_lots SET qty = qty + ${t.n} WHERE id = ${t.id}`; return bad("มีการเบิกยานี้พร้อมกัน กรุณาลองใหม่", 409); }
          taken.push({ id: l.id, n }); need = Math.round((need - n) * 100) / 100;
        }
        // เข้าตะกร้าผู้ป่วย: เติมยาเดิม หรือสร้างรายการใหม่ (ขึ้นหน้าจัดยารายวันตามมื้อ) · พยาบาลให้ยาแล้วหักจากตะกร้า ไม่หักคลังกลางซ้ำ
        let medId: string | null = null;
        if (refill) {
          await sql`UPDATE resident_medications SET stock = COALESCE(stock, 0) + ${qty}, received_total = COALESCE(received_total, stock, 0) + ${qty}, status = 'ปกติ', updated_at = now() WHERE id = ${refill.id}`;
          medId = refill.id;
        } else if (basket) {
          medId = String(Date.now());
          const bulk = basket.bulk === true;
          await sql`INSERT INTO resident_medications (id, resident_id, resident_name, branch_name, drug_name, indication, directions, storage, dosage_form, is_bulk, dose, timing, meals, schedule_days, warnings, stock, received_total, unit, needs_fridge, status, source, stock_drug_id)
            VALUES (${medId}, ${r.id}, ${r.full_name}, ${r.branch_name}, ${d.name}, ${text(basket.use, 200) || null}, ${text(basket.how, 300) || null}, ${basket.fridge === true ? "ตู้เย็น" : text(basket.store, 60) || null},
              ${text(basket.form, 60) || d.form || null}, ${bulk}, ${num(basket.dose) > 0 ? num(basket.dose) : 1}, ${text(basket.timing, 60) || null}, ${bulk ? [] : list(basket.meals)}, ${list(basket.days)}, ${list(basket.warn)},
              ${qty}, ${qty}, ${d.unit}, ${basket.fridge === true}, 'ปกติ', 'คลังศูนย์', ${d.id})`;
        }
        const note = text(b.note, 300) || null;
        const at = new Date().toISOString(); // เวลาเดียวกันทุกล็อต → ประวัติผู้ป่วยรวมเป็นแถวเดียว
        for (const t of taken)
          await sql`INSERT INTO stock_moves (id, branch_name, drug_id, lot_id, delta, reason, resident_id, resident_name, price, moved_by, note, med_id, created_at)
                    VALUES (${randomUUID()}, ${r.branch_name}, ${d.id}, ${t.id}, ${-t.n}, 'เบิกให้ผู้ป่วย', ${r.id}, ${r.full_name}, ${d.price}, ${me.name}, ${note}, ${medId}, ${at})`;
        await audit(req, me, [{ area: "stock", action: "update", recordId: d.id, summary: `เบิกยาคลังกลาง · ${d.name} ${qty} ${d.unit} · ${r.full_name}${refill ? " · เติมตะกร้า" : basket ? " · เข้าตะกร้า" : ""}`, branch: r.branch_name }]);
        return NextResponse.json({ ok: true, left: Math.round((have - qty) * 100) / 100, unit: d.unit, priced: d.price !== null, medId });
      }
      case "withdraw": {
        // เบิกยาจากตะกร้าผู้ป่วยตามจำนวนที่ใช้จริง · ตัดคงเหลือแบบมีเงื่อนไข (ของไม่พอ = ไม่ตัด กันสองเครื่องเบิกพร้อมกันจนติดลบ)
        if (!canIssue(me)) return forbidden();
        const qty = num(b.qty);
        if (!(qty > 0)) return bad("กรุณาระบุจำนวนที่เบิก");
        const [m] = (await sql`SELECT id, resident_id, resident_name, branch_name, drug_name, unit, coalesce(stock, 0)::float AS stock FROM resident_medications WHERE id = ${String(b.medId ?? "")}`) as
          { id: string; resident_id: string | null; resident_name: string; branch_name: string | null; drug_name: string; unit: string | null; stock: number }[];
        if (!m) return bad("ไม่พบยานี้ในตะกร้าของผู้ป่วย", 404);
        if (me.role !== "Global Admin" && m.branch_name && m.branch_name !== me.branch) return forbidden("เบิกได้เฉพาะผู้รับบริการในสาขาของคุณ");
        const [u] = (await sql`UPDATE resident_medications SET stock = round((coalesce(stock, 0) - ${qty})::numeric, 2), updated_at = now()
          WHERE id = ${m.id} AND coalesce(stock, 0) >= ${qty} RETURNING stock::float AS stock`) as { stock: number }[];
        if (!u) return bad(`เบิกเกินคงเหลือ · ${m.drug_name} เหลือ ${m.stock} ${m.unit ?? ""}`.trim(), 409);
        const before = Math.round((u.stock + qty) * 100) / 100;
        const meal = text(b.meal, 40) || null, note = text(b.note, 300) || null;
        await sql`INSERT INTO med_withdrawals (id, med_id, resident_id, resident_name, branch_name, drug_name, qty, unit, stock_before, stock_after, meal, note, withdrawn_by)
                  VALUES (${randomUUID()}, ${m.id}, ${m.resident_id}, ${m.resident_name}, ${m.branch_name}, ${m.drug_name}, ${qty}, ${m.unit}, ${before}, ${u.stock}, ${meal}, ${note}, ${me.name})`;
        await audit(req, me, [{ area: "med_withdraw", action: "update", recordId: m.id, summary: `เบิกยา · ${m.drug_name} ${qty} ${m.unit ?? ""} · ${m.resident_name} · ${before} → ${u.stock}`, branch: m.branch_name }]);
        return NextResponse.json({ ok: true, stock: u.stock, before });
      }
      case "give": {
        // ให้ยาทั้งมื้อของผู้ป่วย 1 คน (KinApp แบบผสม): items = ยาที่ให้ (ตัดคงเหลือ) · skips = ยาที่ไม่ได้ให้พร้อมเหตุผล (ไม่ตัดคงเหลือ)
        //  ต้องติ๊ก "ตรวจชื่อผู้ป่วยและยาแล้ว" (checked) · ยาไม่พอตัวใดตัวหนึ่ง = ไม่บันทึกทั้งชุด (คืนคงเหลือที่ตัดไปแล้ว)
        if (!canIssue(me)) return forbidden();
        if (b.checked !== true) return bad("กรุณาติ๊ก ตรวจชื่อผู้ป่วยและยาแล้ว ก่อนบันทึก");
        const meal = text(b.meal, 40);
        if (!meal) return bad("กรุณาเลือกมื้อ");
        const rows = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object").slice(0, 40) : []);
        const items = rows(b.items).map((x) => ({ id: String(x.medId ?? ""), qty: num(x.qty) }));
        const skips = rows(b.skips).map((x) => ({ id: String(x.medId ?? ""), reason: text(x.reason, 80) }));
        if (!items.length && !skips.length) return bad("ไม่มีรายการยา");
        if (items.some((x) => !(x.qty > 0))) return bad("จำนวนยาไม่ถูกต้อง");
        if (skips.some((x) => !x.reason)) return bad("กรุณาเลือกเหตุผลของยาที่ไม่ได้ให้");
        const ids = [...items.map((x) => x.id), ...skips.map((x) => x.id)];
        const meds = (await sql`SELECT id, resident_id, resident_name, branch_name, drug_name, unit, coalesce(stock, 0)::float AS stock FROM resident_medications WHERE id = ANY(${ids})`) as
          { id: string; resident_id: string | null; resident_name: string; branch_name: string | null; drug_name: string; unit: string | null; stock: number }[];
        const byId = new Map(meds.map((m) => [m.id, m]));
        if (ids.some((id) => !byId.has(id))) return bad("ไม่พบยาบางรายการในตะกร้าของผู้ป่วย", 404);
        if (new Set(meds.map((m) => m.resident_name)).size > 1) return bad("ยาต้องเป็นของผู้ป่วยคนเดียวกัน");
        const m0 = meds[0];
        if (me.role !== "Global Admin" && m0.branch_name && m0.branch_name !== me.branch) return forbidden("ให้ยาได้เฉพาะผู้รับบริการในสาขาของคุณ");
        const done: { m: typeof m0; qty: number; after: number }[] = [];
        for (const it of items) {
          const m = byId.get(it.id)!;
          const [u] = (await sql`UPDATE resident_medications SET stock = round((coalesce(stock, 0) - ${it.qty})::numeric, 2), updated_at = now()
            WHERE id = ${m.id} AND coalesce(stock, 0) >= ${it.qty} RETURNING stock::float AS stock`) as { stock: number }[];
          if (!u) {
            for (const d of done) await sql`UPDATE resident_medications SET stock = round((coalesce(stock, 0) + ${d.qty})::numeric, 2) WHERE id = ${d.m.id}`;
            return bad(`ยาไม่พอ · ${m.drug_name} เหลือ ${m.stock} ${m.unit ?? ""} · เอาติ๊กยานี้ออก แล้วเลือกเหตุผล "ยาหมด"`.trim(), 409);
          }
          done.push({ m, qty: it.qty, after: u.stock });
        }
        const note = text(b.note, 300) || null;
        for (const d of done)
          await sql`INSERT INTO med_withdrawals (id, med_id, resident_id, resident_name, branch_name, drug_name, qty, unit, stock_before, stock_after, meal, note, withdrawn_by)
                    VALUES (${randomUUID()}, ${d.m.id}, ${d.m.resident_id}, ${d.m.resident_name}, ${d.m.branch_name}, ${d.m.drug_name}, ${d.qty}, ${d.m.unit}, ${Math.round((d.after + d.qty) * 100) / 100}, ${d.after}, ${meal}, ${note}, ${me.name})`;
        for (const s of skips) {
          const m = byId.get(s.id)!;
          await sql`INSERT INTO med_withdrawals (id, med_id, resident_id, resident_name, branch_name, drug_name, qty, unit, stock_before, stock_after, meal, note, withdrawn_by, skip_reason)
                    VALUES (${randomUUID()}, ${m.id}, ${m.resident_id}, ${m.resident_name}, ${m.branch_name}, ${m.drug_name}, 0, ${m.unit}, ${m.stock}, ${m.stock}, ${meal}, ${note}, ${me.name}, ${s.reason})`;
        }
        await audit(req, me, [{ area: "med_withdraw", action: "create", recordId: m0.id, branch: m0.branch_name,
          summary: `ให้ยามื้อ${meal} · ${m0.resident_name} · ให้ ${done.length} รายการ${skips.length ? ` · ไม่ได้ให้ ${skips.map((s) => `${byId.get(s.id)!.drug_name} (${s.reason})`).join(", ")}` : ""}` }]);
        return NextResponse.json({ ok: true, given: done.length, skipped: skips.length });
      }
      case "withdraw_void": {
        // ยกเลิกการเบิกที่กดผิด: คืนคงเหลือ · เก็บรายการไว้พร้อมเหตุผล · คนเบิกเองภายใน 24 ชม. หรือหัวหน้าพยาบาล/ผู้จัดการ/ผู้บริหาร
        if (!canIssue(me)) return forbidden();
        const reason = text(b.reason, 120);
        if (!reason) return bad("กรุณาเลือกเหตุผลที่ยกเลิก");
        const [w] = (await sql`SELECT id, med_id, resident_name, branch_name, drug_name, qty::float, unit, withdrawn_by, voided_at, created_at > now() - interval '24 hours' AS fresh FROM med_withdrawals WHERE id = ${String(b.id ?? "")}`) as
          { id: string; med_id: string | null; resident_name: string; branch_name: string | null; drug_name: string; qty: number; unit: string | null; withdrawn_by: string | null; voided_at: string | null; fresh: boolean }[];
        if (!w) return bad("ไม่พบรายการเบิกนี้", 404);
        if (me.role !== "Global Admin" && w.branch_name && w.branch_name !== me.branch) return forbidden();
        if (w.voided_at) return bad("รายการนี้ยกเลิกไปแล้ว", 409);
        if (!isManager(me) && !(w.withdrawn_by === me.name && w.fresh)) return forbidden("ยกเลิกได้เฉพาะรายการที่ตัวเองเบิกภายใน 24 ชั่วโมง · รายการอื่นแจ้งหัวหน้าพยาบาล");
        const done = (await sql`UPDATE med_withdrawals SET voided_at = now(), voided_by = ${me.name}, void_reason = ${reason} WHERE id = ${w.id} AND voided_at IS NULL RETURNING id`) as unknown[];
        if (!done.length) return bad("รายการนี้ยกเลิกไปแล้ว", 409);
        const [m] = w.med_id ? (await sql`UPDATE resident_medications SET stock = round((coalesce(stock, 0) + ${w.qty})::numeric, 2), updated_at = now() WHERE id = ${w.med_id} RETURNING stock::float AS stock`) as { stock: number }[] : [];
        await audit(req, me, [{ area: "med_withdraw", action: "delete", recordId: w.id, summary: `ยกเลิกการเบิก · ${w.drug_name} ${w.qty} ${w.unit ?? ""} · ${w.resident_name} · ${reason} (คืนคงเหลือ${m ? ` เป็น ${m.stock}` : ""})`, branch: w.branch_name }]);
        return NextResponse.json({ ok: true, stock: m?.stock ?? null });
      }
      default:
        return bad("unknown op");
    }
  } catch (e) {
    console.error("[api/pharmstock]", e);
    return bad("database error", 500);
  }
}
