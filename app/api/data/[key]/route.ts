import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sql, validKey } from "@/lib/db";
import { currentUser, forbidden, unauthorized } from "@/lib/auth";
import { audit, AuditEntry } from "@/lib/audit";
import { can } from "@/lib/perms";
import { normValue } from "@/lib/auditLabels";
import { accessOf, fromDb, RESIDENT_TABLES, selectExpr, SHARED_BRANCHES, specFor, Spec, toDb } from "@/lib/schema";
import { evaluateVitals, flagText, levelOf, parseVitals } from "@/lib/vitals";
import { RESIDENTS } from "@/lib/mock";
import type { SessionUser } from "@/lib/roles";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

type Item = { id: string; data: unknown };
type Body =
  | { op: "seed"; items: Item[] }
  | { op: "upsert"; items: Item[] }
  | { op: "delete"; ids: string[] }
  | { op: "replace"; items: Item[] }
  | { op: "clear" };

const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });

/**
 * เงื่อนไข WHERE เพิ่มเติมของชุดข้อมูล
 *  scope  : ชุดข้อมูลย่อย เช่น daily_tasks เฉพาะวันที่ในชื่อชุดข้อมูล
 *  branch : ผู้ใช้ที่ไม่ใช่ Global Admin เห็นสาขาตัวเอง + ข้อมูลส่วนกลาง (read) แต่ลบได้เฉพาะสาขาตัวเอง
 */
function where(s: Spec, branch: string | null, from: number, read = false) {
  const parts: string[] = [];
  const params: unknown[] = [];
  const p = () => `$${from + params.length - 1}`;
  if (s.scope) { params.push(s.scope.value); parts.push(`${s.scope.col} = ${p()}`); }
  if (branch && s.branchCol) {
    params.push(branch); const own = `${s.branchCol} = ${p()}`;
    if (read) { params.push(SHARED_BRANCHES); parts.push(`(${own} OR ${s.branchCol} = ANY(${p()}))`); } else parts.push(own);
  }
  return { clause: parts.map((p) => ` AND ${p}`).join(""), params };
}

function rowToItem(s: Spec, r: Record<string, unknown>): Item {
  if (s.kind === "rows") return { id: r.id as string, data: s.cols.map((c) => fromDb(c.t, r[c.col], "rows")) };
  const obj: Record<string, unknown> = { id: s.numericId && /^\d+$/.test(r.id as string) ? Number(r.id) : r.id };
  for (const c of s.cols) { const v = fromDb(c.t, r[c.col], "object"); if (v !== undefined) obj[c.field!] = v; }
  return { id: r.id as string, data: obj };
}

function values(s: Spec, data: unknown): unknown[] {
  if (s.kind === "rows") { const arr = Array.isArray(data) ? data : []; return s.cols.map((c, i) => toDb(c.t, arr[i])); }
  const obj = (data ?? {}) as Record<string, unknown>;
  return s.cols.map((c) => toDb(c.t, obj[c.field!]));
}

/** คอลัมน์ที่หน้าเว็บบันทึกได้ (ไม่รวมคอลัมน์ ro ที่ server ใส่เอง) */
const writable = (s: Spec) => s.cols.filter((c) => !c.ro);
const writeValues = (s: Spec, data: unknown) => values(s, data).filter((_, i) => !s.cols[i].ro);

/** ค่าสาขาของรายการที่ส่งมา (ใช้ตรวจว่า Branch Admin ไม่ได้บันทึกข้ามสาขา) */
function branchOf(s: Spec, data: unknown) {
  const i = s.cols.findIndex((c) => c.col === s.branchCol);
  return i < 0 ? null : values(s, data)[i];
}

/* ---------- ประวัติการแก้ไข ---------- */
type Rec = Record<string, unknown>;
/** ค่าของรายการตามชื่อคอลัมน์ในฐานข้อมูล */
const asRec = (s: Spec, vals: unknown[]): Rec => Object.fromEntries(s.cols.map((c, i) => [c.col, vals[i] ?? null] as const).filter((_, i) => !s.cols[i].ro));
const LABEL_COLS = ["contract_no", "resident_name", "full_name", "name", "plan_name", "task_name", "title", "drug_name", "purpose", "issue", "topic_type", "meal"];
function labelOf(rec: Rec) {
  const parts = LABEL_COLS.map((c) => rec[c]).filter((v) => v !== null && v !== undefined && v !== "").slice(0, 2);
  return (parts.length ? parts : Object.values(rec).filter(Boolean).slice(0, 1)).map(String).join(" · ").slice(0, 200);
}
const same = (a: Rec, b: Rec) => Object.keys(b).every((k) => normValue(a[k]) === normValue(b[k]));

/** ค่าปัจจุบันในฐานข้อมูลของรายการที่จะถูกแก้/ลบ พร้อมสาขาเจ้าของ */
async function snapshot(s: Spec, ids: string[]) {
  if (!ids.length) return new Map<string, { rec: Rec; branch: string | null }>();
  const rows = (await sql(`SELECT id, ${s.cols.map(selectExpr).join(", ")}${s.branchCol ? `, ${s.branchCol} AS _branch` : ""} FROM ${s.table} WHERE id = ANY($1)`, [ids])) as Rec[];
  return new Map(rows.map((r) => [r.id as string, { rec: Object.fromEntries(s.cols.map((c) => [c.col, r[c.col] ?? null])) as Rec, branch: (r._branch as string) ?? null }]));
}

/* ---------- งานประจำ → งานประจำวันอัตโนมัติ ---------- */
const dayTh = (offset = 0) => new Date(Date.now() + 7 * 3600e3 + offset * 864e5).toISOString().slice(0, 10);
/**
 * ครั้งแรกที่มีคนเปิดงานของวันหนึ่ง (วันนี้ถึงล่วงหน้า 14 วัน) สร้างงานจากงานประจำที่ยังใช้อยู่ของทุกสาขา
 * app_seed กันสร้างซ้ำ · ข้ามผู้รับบริการที่ย้ายออกแล้ว
 */
async function generateDaily(key: string, s: Spec) {
  if (!key.startsWith("daily-") || !s.scope) return;
  const d = s.scope.value;
  if (d < dayTh() || d > dayTh(14)) return;
  const created = await sql`INSERT INTO app_seed (collection) VALUES (${key}) ON CONFLICT DO NOTHING RETURNING collection`;
  if (!created.length) return;
  const routines = (await sql`
    SELECT r.* FROM care_routines r LEFT JOIN residents x ON x.id = r.resident_id
    WHERE r.active AND (x.status IS NULL OR x.status NOT LIKE 'ย้ายออก%')
    ORDER BY r.sched_time`) as Record<string, string>[];
  if (!routines.length) return;
  const top = Date.now();
  await sql.transaction(routines.map((r, i) => sql`
    INSERT INTO daily_tasks (id, sort_order, work_date, branch_name, resident_id, resident_name, task_name, assignee, scheduled_time, shift, status, instruction)
    VALUES (${randomUUID()}, ${top - i}, ${d}, ${r.branch_name}, ${r.resident_id}, ${r.resident_name}, ${r.task_name}, '-', ${r.sched_time}, ${r.shift}, 'รอทำ', ${r.instruction ?? "-"})`));
}

async function list(key: string, s: Spec, branch: string | null) {
  const [meta] = await sql`SELECT 1 FROM app_seed WHERE collection = ${key}`;
  const w = where(s, branch, 1, true);
  const rows = (await sql(`SELECT id, ${s.cols.map(selectExpr).join(", ")} FROM ${s.table} WHERE true${w.clause} ORDER BY sort_order DESC, created_at DESC`, w.params)) as Record<string, unknown>[];
  return { seeded: !!meta, items: rows.map((r) => rowToItem(s, r)) };
}

/**
 * สาขาเจ้าของรายการใหม่ (เฉพาะ spec ที่ hiddenBranch)
 * ผู้ใช้ทั่วไป = สาขาของตัวเอง · Global Admin และข้อมูลตัวอย่าง = สาขาของผู้รับบริการ ไม่พบ = ทุกสาขา (ส่วนกลาง)
 */
async function ownerBranches(s: Spec, items: Item[], me: SessionUser, seed: boolean) {
  if (!s.hiddenBranch) return undefined;
  if (!seed && me.role !== "Global Admin") return items.map(() => me.branch);
  const ri = s.cols.findIndex((c) => c.col === "resident_name");
  if (ri < 0 || !items.length) return items.map(() => SHARED_BRANCHES[0]);
  const map = new Map(RESIDENTS.map((r) => [r[0], r[3]]));
  for (const r of (await sql`SELECT full_name, branch_name FROM residents WHERE branch_name IS NOT NULL`) as { full_name: string; branch_name: string }[]) map.set(r.full_name, r.branch_name);
  return items.map((it) => map.get(String(values(s, it.data)[ri] ?? "")) ?? SHARED_BRANCHES[0]);
}

/** คอลัมน์ที่ server ใส่เอง (ไม่อยู่ในข้อมูลจากหน้าเว็บ) เช่น branch_name ของ hiddenBranch · resident_id */
type Extra = Record<string, unknown[] | undefined>;
const extraCols = (x: Extra) => Object.keys(x).filter((k) => k !== "_" && x[k]);

/** INSERT ... ON CONFLICT (id) DO UPDATE — รายการใหม่อยู่บนสุดตามลำดับที่ส่งมา (ไม่เปลี่ยนสาขาเจ้าของของรายการเดิม) */
function upsertQueries(s: Spec, items: Item[], extra: Extra = {}, top = Date.now()) {
  const ex = extraCols(extra);
  const cols = [...(s.scope ? [s.scope.col] : []), ...ex, ...writable(s).map((c) => c.col)];
  const ph = ["$1", "$2", ...cols.map((_, i) => `$${i + 3}`)].join(", ");
  const upd = [...writable(s).map((c) => c.col), ...ex.filter((c) => c !== s.branchCol)].map((c) => `${c} = EXCLUDED.${c}`).join(", ");
  const text = `INSERT INTO ${s.table} (id, sort_order, ${cols.join(", ")}) VALUES (${ph}) ON CONFLICT (id) DO UPDATE SET ${upd}, updated_at = now()`;
  return items.map((it, i) => sql(text, [it.id, top - i, ...(s.scope ? [s.scope.value] : []), ...ex.map((c) => extra[c]![i]), ...writeValues(s, it.data)]));
}
function updateQueries(s: Spec, items: Item[], extra: Extra = {}) {
  const ex = extraCols(extra).filter((c) => c !== s.branchCol);
  const set = [...writable(s).map((c) => c.col), ...ex].map((c, i) => `${c} = $${i + 2}`).join(", ");
  return items.map((it, i) => sql(`UPDATE ${s.table} SET ${set}, updated_at = now() WHERE id = $1`, [it.id, ...writeValues(s, it.data), ...ex.map((c) => extra[c]![i])]));
}

/* ---------- รหัสผู้รับบริการ ---------- */
const normName = (x: unknown) => String(x ?? "").trim().replace(/\s+/g, " ");
type ResidentRow = { id: string; full_name: string; branch_name: string | null };
const allResidents = async () => (await sql`SELECT id, full_name, branch_name FROM residents`) as ResidentRow[];

/** resident_id ของแต่ละรายการ จากชื่อที่เลือก · ชื่อซ้ำต่างสาขา เลือกคนในสาขาเดียวกับรายการก่อน */
async function residentIds(s: Spec, items: Item[], branches: (string | null | undefined)[]) {
  if (!s.residentLink || !items.length) return undefined;
  const ri = s.cols.findIndex((c) => c.col === "resident_name");
  const all = await allResidents();
  return items.map((it, i) => {
    const name = normName(values(s, it.data)[ri]);
    const hits = all.filter((r) => normName(r.full_name) === name);
    return (hits.find((r) => r.branch_name === branches[i]) ?? hits[0])?.id ?? null;
  });
}

/** ผู้รับบริการ: ห้ามชื่อซ้ำในสาขาเดียวกัน (ต่างสาขาได้) */
async function duplicateResident(s: Spec, items: Item[]) {
  const ni = s.cols.findIndex((c) => c.col === "full_name"), bi = s.cols.findIndex((c) => c.col === "branch_name");
  const all = await allResidents();
  const seen = new Map<string, string>();
  for (const it of items) {
    const v = values(s, it.data);
    const k = `${normName(v[ni])}|${v[bi] ?? ""}`;
    const other = all.find((r) => r.id !== it.id && `${normName(r.full_name)}|${r.branch_name ?? ""}` === k);
    if (other || (seen.has(k) && seen.get(k) !== it.id)) return `มีผู้รับบริการชื่อ "${normName(v[ni])}" ในสาขา${v[bi] ?? ""}แล้ว กรุณาเพิ่มชื่อเล่นหรือเลขห้องต่อท้ายเพื่อแยกกัน`;
    seen.set(k, it.id);
  }
  return null;
}

/** หลังบันทึกผู้รับบริการ: เปลี่ยนชื่อ = แก้ชื่อในทุกตาราง · ผูกรายการเก่าที่ยังไม่มีรหัสแต่ชื่อตรงกัน */
function residentSyncQueries(s: Spec, items: Item[], prev?: Map<string, { rec: Rec }>) {
  const ni = s.cols.findIndex((c) => c.col === "full_name"), bi = s.cols.findIndex((c) => c.col === "branch_name");
  const q = [];
  for (const it of items) {
    const v = values(s, it.data);
    const name = normName(v[ni]);
    const old = prev?.get(it.id)?.rec.full_name;
    for (const t of RESIDENT_TABLES) {
      if (old !== undefined && old !== null && normName(old) !== name) q.push(sql(`UPDATE ${t} SET resident_name = $1 WHERE resident_id = $2`, [name, it.id]));
      q.push(sql(`UPDATE ${t} SET resident_id = $1 WHERE resident_id IS NULL AND resident_name = $2 AND (branch_name IS NULL OR branch_name = $3 OR branch_name = ANY($4))`, [it.id, name, v[bi] ?? null, SHARED_BRANCHES]));
    }
  }
  return q;
}

/* ---------- เลขที่ออกโดย server ---------- */
/** วันนี้ตามเวลาไทย เป็น พ.ศ. 2 หลัก + เดือน (+ วัน) เช่น 691029 */
const thaiStamp = (withDay: boolean) => {
  const d = new Date(Date.now() + 7 * 3600e3);
  const yy = String((d.getUTCFullYear() + 543) % 100).padStart(2, "0");
  return yy + String(d.getUTCMonth() + 1).padStart(2, "0") + (withDay ? String(d.getUTCDate()).padStart(2, "0") : "");
};
/** HN (IPD) ของผู้รับบริการใหม่: KN + ปีเดือน + ลำดับ 5 หลัก เช่น KN691000031 */
const hnQueries = (ids: string[]) => ids.map((id) => sql(
  `UPDATE residents SET hn = 'KN' || $2 || lpad(nextval('hn_seq')::text, 5, '0') WHERE id = $1 AND (hn IS NULL OR hn = '')`, [id, thaiStamp(false)]));
/** เลขที่ใบแจ้งหนี้/ใบเสร็จ: KN-IV + ปีเดือนวัน + ลำดับของวัน 4 หลัก เช่น KN-IV6910290001 */
async function numberInvoices(ids: string[]) {
  const prefix = "KN-IV" + thaiStamp(true);
  for (const id of ids) {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await sql(`UPDATE invoices SET doc_no = $2 || lpad((SELECT count(*) + 1 FROM invoices WHERE doc_no LIKE $2 || '%')::text, 4, '0')
                   WHERE id = $1 AND doc_no IS NULL`, [id, prefix]);
        break;
      } catch (e) { if (attempt === 4) throw e; } // เลขชนกับอีกเครื่อง (unique) ลองใหม่
    }
  }
}

/** เลขที่สัญญา: CT-ปี พ.ศ.-ลำดับของปี 4 หลัก เช่น CT-2569-0007 (นับต่อจากเลขสูงสุดของปีนั้นทุกสาขา) */
async function numberContracts(ids: string[]) {
  const prefix = `CT-${new Date(Date.now() + 7 * 3600e3).getUTCFullYear() + 543}-`;
  for (const id of ids)
    await sql(`UPDATE contracts SET contract_no = $2 || lpad((SELECT coalesce(max(substring(contract_no from '^' || $2 || '([0-9]+)$')::int), 0) + 1 FROM contracts)::text, 4, '0')
               WHERE id = $1 AND (contract_no IS NULL OR contract_no = '')`, [id, prefix]);
}

/** เลขที่ใบเสนอราคา: QT-ปี พ.ศ.-ลำดับของปี 4 หลัก เช่น QT-2569-0012 */
async function numberQuotes(ids: string[]) {
  const prefix = `QT-${new Date(Date.now() + 7 * 3600e3).getUTCFullYear() + 543}-`;
  for (const id of ids)
    await sql(`UPDATE care_assessments SET doc_no = $2 || lpad((SELECT coalesce(max(substring(doc_no from '^' || $2 || '([0-9]+)$')::int), 0) + 1 FROM care_assessments)::text, 4, '0')
               WHERE id = $1 AND (doc_no IS NULL OR doc_no = '')`, [id, prefix]);
}

/* ---------- แจ้งเตือนสัญญาณชีพ ---------- */
/** ชุดข้อมูลที่มีสัญญาณชีพ: บันทึกสุขภาพ และงานประจำวัน */
const vitalsOf = (key: string, rec: Rec) =>
  key === "health" ? parseVitals(rec.vital_signs as string, rec.o2_sat as string, rec.dtx as string)
    : key.startsWith("daily-") ? parseVitals(rec.vital_signs as string) : null;

function alertQueries(key: string, s: Spec, me: SessionUser, rows: { id: string; rec: Rec; branch: string | null; residentId: string | null }[]) {
  const q = [];
  for (const r of rows) {
    const v = vitalsOf(key, r.rec);
    if (!v) continue;
    const id = `${s.table}:${r.id}`;
    const flags = evaluateVitals(v);
    if (!flags.length) { q.push(sql(`DELETE FROM care_alerts WHERE id = $1 AND status = 'open'`, [id])); continue; }
    const vt = [r.rec.vital_signs, r.rec.o2_sat && `O2 ${r.rec.o2_sat}`, r.rec.dtx && `DTX ${r.rec.dtx}`].filter((x) => x && x !== "-").join(", ");
    q.push(sql(
      `INSERT INTO care_alerts (id, area, record_id, resident_id, resident_name, branch_name, level, summary, items, vital_text, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11)
       ON CONFLICT (id) DO UPDATE SET level = EXCLUDED.level, summary = EXCLUDED.summary, items = EXCLUDED.items, vital_text = EXCLUDED.vital_text,
         resident_id = EXCLUDED.resident_id, resident_name = EXCLUDED.resident_name, created_by = EXCLUDED.created_by, created_at = now(),
         status = 'open', ack_by = NULL, ack_at = NULL, ack_note = NULL`,
      [id, key, r.id, r.residentId, r.rec.resident_name ?? null, r.branch, levelOf(flags), flags.map(flagText).join(" · "), JSON.stringify(flags), vt, me.name]));
  }
  return q;
}

/** ตรวจสิทธิ์: ต้องล็อกอิน · สิทธิ์ที่ติ๊กไว้ (lib/schema accessOf) · ทุกระดับยกเว้น Global Admin เห็นเฉพาะสาขาตัวเอง */
async function access(req: NextRequest, key: string) {
  const s = validKey(key) ? specFor(key) : null;
  if (!s) return { res: bad("unknown collection") };
  const me = await currentUser(req);
  if (!me) return { res: unauthorized() };
  const level = accessOf(me, key);
  if (level === "none") return { res: forbidden() };
  return { s, me, level, branch: me.role !== "Global Admin" && s.branchCol ? me.branch : null };
}

export async function GET(req: NextRequest, { params }: { params: { key: string } }) {
  const a = await access(req, params.key);
  if (!a.s) return a.res;
  try { await generateDaily(params.key, a.s); } catch (e) { console.error("[generateDaily]", e); }
  return NextResponse.json(await list(params.key, a.s, a.branch));
}

export async function POST(req: NextRequest, { params }: { params: { key: string } }) {
  const key = params.key;
  const a = await access(req, key);
  if (!a.s) return a.res;
  const { s, me, branch } = a;
  let body: Body;
  try { body = await req.json(); } catch { return bad("invalid json"); }
  // อ่านอย่างเดียว: ข้อมูลตั้งต้นให้ผู้มีสิทธิ์แก้เป็นคนใส่ ตอบรายการปัจจุบันกลับไป
  if (a.level === "read") return body.op === "seed" ? NextResponse.json(await list(key, s, branch)) : forbidden("บัญชีนี้ดูข้อมูลส่วนนี้ได้อย่างเดียว");
  if (key === "contracts" && body.op === "delete" && !can(me, "contracts.delete")) return forbidden("บัญชีนี้ไม่มีสิทธิ์ลบสัญญา");
  // ข้อมูลระดับองค์กร (เช่น สาขา): ผู้จัดการสาขาอ่านได้ แต่เพิ่ม/แก้/ลบได้เฉพาะผู้บริหาร
  if (s.globalWrite && me.role !== "Global Admin") return forbidden("แก้ไขข้อมูลสาขาได้เฉพาะผู้บริหาร (Global Admin)");
  const logs: AuditEntry[] = [];

  try {
    switch (body.op) {
      case "seed": {
        // ใส่ข้อมูลตั้งต้นครั้งเดียว ถ้าเคยใส่แล้ว (แม้ผู้ใช้จะลบจนว่าง) จะไม่ใส่ซ้ำ · ไม่บันทึกประวัติ
        const created = await sql`INSERT INTO app_seed (collection) VALUES (${key}) ON CONFLICT DO NOTHING RETURNING collection`;
        if (created.length && body.items.length) {
          const owners = await ownerBranches(s, body.items, me, true);
          const rids = await residentIds(s, body.items, owners ?? body.items.map((it) => branchOf(s, it.data) as string | null));
          await sql.transaction([...upsertQueries(s, body.items, { [s.branchCol ?? "_"]: owners, resident_id: rids }), ...(key === "residents" ? residentSyncQueries(s, body.items) : [])]);
          if (key === "residents") await sql.transaction(hnQueries(body.items.map((x) => x.id)));
          if (key === "contracts") await numberContracts(body.items.map((x) => x.id));
        }
        break;
      }
      case "upsert": {
        if (branch && !s.hiddenBranch && body.items.some((it) => branchOf(s, it.data) !== branch)) return forbidden("บันทึกได้เฉพาะข้อมูลของสาขาตัวเอง");
        await sql`INSERT INTO app_seed (collection) VALUES (${key}) ON CONFLICT DO NOTHING`;
        const prev = await snapshot(s, body.items.map((x) => x.id));
        if (branch && [...prev.values()].some((r) => r.branch !== branch)) return forbidden("แก้ไขได้เฉพาะข้อมูลของสาขาตัวเอง (ข้อมูลส่วนกลางแก้ได้เฉพาะผู้บริหาร)");
        if (key === "residents") { const dup = await duplicateResident(s, body.items); if (dup) return bad(dup, 409); }
        const fresh = body.items.filter((x) => !prev.has(x.id));
        const changed = body.items.filter((x) => prev.has(x.id));
        const owners = await ownerBranches(s, fresh, me, false);
        const freshBranch = fresh.map((it, i) => owners?.[i] ?? (branchOf(s, it.data) as string | null) ?? me.branch);
        const changedBranch = changed.map((it) => prev.get(it.id)!.branch ?? (branchOf(s, it.data) as string | null));
        const freshRids = await residentIds(s, fresh, freshBranch);
        const changedRids = await residentIds(s, changed, changedBranch);
        const queries = [
          ...upsertQueries(s, fresh, { [s.branchCol ?? "_"]: owners, resident_id: freshRids }),
          ...updateQueries(s, changed, { resident_id: changedRids }),
          ...(key === "residents" ? residentSyncQueries(s, body.items, prev) : []),
          ...alertQueries(key, s, me, [
            ...fresh.map((it, i) => ({ id: it.id, rec: asRec(s, values(s, it.data)), branch: freshBranch[i], residentId: freshRids?.[i] ?? null })),
            ...changed
              .filter((it) => { const b = prev.get(it.id)!.rec, a = asRec(s, values(s, it.data)); return ["vital_signs", "o2_sat", "dtx"].some((c) => normValue(a[c]) !== normValue(b[c])); })
              .map((it) => { const i = changed.indexOf(it); return { id: it.id, rec: asRec(s, values(s, it.data)), branch: changedBranch[i], residentId: changedRids?.[i] ?? null }; }),
          ]),
        ];
        if (queries.length) await sql.transaction(queries);
        if (key === "residents" && fresh.length) await sql.transaction(hnQueries(fresh.map((x) => x.id)));
        if (key === "contracts" && fresh.length) await numberContracts(fresh.map((x) => x.id));
        if (key === "assessments") await numberQuotes(body.items.map((x) => x.id));
        if (key === "invoices" && fresh.length) await numberInvoices(fresh.map((x) => x.id));
        // ใบแจ้งหนี้ที่ยังไม่มี HN (เช่น ออกพร้อมสัญญาก่อน server ออก HN ให้ผู้รับบริการ) เติมจากทะเบียนผู้รับบริการ
        if (key === "invoices") await sql(`UPDATE invoices i SET hn = r.hn FROM residents r WHERE i.id = ANY($1) AND r.id = i.resident_id AND (i.hn IS NULL OR i.hn = '')`, [body.items.map((x) => x.id)]);
        // ใบแจ้งหนี้ที่ออกพร้อมสัญญาใหม่ (ตอนนั้นยังไม่มีเลขที่สัญญา) ใช้เลขของสัญญาล่าสุดของผู้รับบริการคนนี้
        if (key === "invoices") await sql(`UPDATE invoices i SET contract_no = c.contract_no
          FROM (SELECT DISTINCT ON (resident_id) resident_id, contract_no FROM contracts WHERE resident_id IS NOT NULL ORDER BY resident_id, created_at DESC) c
          WHERE i.id = ANY($1) AND c.resident_id = i.resident_id AND (i.contract_no IS NULL OR i.contract_no = '')`, [body.items.map((x) => x.id)]);
        fresh.forEach((it, i) => {
          const after = asRec(s, values(s, it.data));
          logs.push({ area: key, action: "create", recordId: it.id, summary: labelOf(after), branch: owners?.[i] ?? (branchOf(s, it.data) as string | null) ?? me.branch, after });
        });
        for (const it of changed) {
          const before = prev.get(it.id)!; const after = asRec(s, values(s, it.data));
          if (!same(before.rec, after)) logs.push({ area: key, action: "update", recordId: it.id, summary: labelOf(after), branch: before.branch ?? me.branch, before: before.rec, after });
        }
        break;
      }
      case "delete": {
        const prev = await snapshot(s, body.ids);
        const w = where(s, branch, 2);
        // ซองยาที่จ่ายให้ผู้รับบริการแล้ว = บันทึกการให้ยา (MAR) ห้ามลบ
        const keep = s.table === "medication_packs" ? " AND given = false" : "";
        const gone = (await sql(`DELETE FROM ${s.table} WHERE id = ANY($1)${w.clause}${keep} RETURNING id`, [body.ids, ...w.params])) as { id: string }[];
        for (const { id } of gone) { const b = prev.get(id); if (b) logs.push({ area: key, action: "delete", recordId: id, summary: labelOf(b.rec), branch: b.branch ?? me.branch, before: b.rec }); }
        if (gone.length) await sql(`DELETE FROM care_alerts WHERE status = 'open' AND id = ANY($1)`, [gone.map((g) => `${s.table}:${g.id}`)]);
        break;
      }
      case "clear": {
        const w = where(s, branch, 1);
        const gone = (await sql(`DELETE FROM ${s.table} WHERE true${w.clause} RETURNING id`, w.params)) as { id: string }[];
        if (gone.length) logs.push({ area: key, action: "clear", summary: `ล้างข้อมูล ${gone.length} รายการ`, branch: branch ?? null });
        break;
      }
      case "replace": {
        if (branch) return forbidden();
        await sql`INSERT INTO app_seed (collection) VALUES (${key}) ON CONFLICT DO NOTHING`;
        const w = where(s, null, 1);
        const owners = await ownerBranches(s, body.items, me, false);
        const rids = await residentIds(s, body.items, owners ?? body.items.map((it) => branchOf(s, it.data) as string | null));
        await sql.transaction([sql(`DELETE FROM ${s.table} WHERE true${w.clause}`, w.params), ...upsertQueries(s, body.items, { [s.branchCol ?? "_"]: owners, resident_id: rids })]);
        logs.push({ area: key, action: "replace", summary: `แทนที่ข้อมูลทั้งหมด ${body.items.length} รายการ`, branch: null });
        break;
      }
      default:
        return bad("unknown op");
    }
  } catch (e) {
    console.error(`[api/data/${key}]`, e);
    return bad("database error", 500);
  }
  await audit(req, me, logs);
  return NextResponse.json(await list(key, s, branch));
}
