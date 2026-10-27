import { NextRequest, NextResponse } from "next/server";
import { sql, validKey } from "@/lib/db";
import { currentUser, forbidden, unauthorized } from "@/lib/auth";
import { audit, AuditEntry } from "@/lib/audit";
import { normValue } from "@/lib/auditLabels";
import { fromDb, selectExpr, SHARED_BRANCHES, specFor, Spec, toDb } from "@/lib/schema";
import { RESIDENTS } from "@/lib/mock";
import type { SessionUser } from "@/lib/roles";

export const dynamic = "force-dynamic";

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

/** ค่าสาขาของรายการที่ส่งมา (ใช้ตรวจว่า Branch Admin ไม่ได้บันทึกข้ามสาขา) */
function branchOf(s: Spec, data: unknown) {
  const i = s.cols.findIndex((c) => c.col === s.branchCol);
  return i < 0 ? null : values(s, data)[i];
}

/* ---------- ประวัติการแก้ไข ---------- */
type Rec = Record<string, unknown>;
/** ค่าของรายการตามชื่อคอลัมน์ในฐานข้อมูล */
const asRec = (s: Spec, vals: unknown[]): Rec => Object.fromEntries(s.cols.map((c, i) => [c.col, vals[i] ?? null]));
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

/** INSERT ... ON CONFLICT (id) DO UPDATE — รายการใหม่อยู่บนสุดตามลำดับที่ส่งมา (ไม่เปลี่ยนสาขาเจ้าของของรายการเดิม) */
function upsertQueries(s: Spec, items: Item[], owners?: string[], top = Date.now()) {
  const cols = [...(s.scope ? [s.scope.col] : []), ...(owners ? [s.branchCol!] : []), ...s.cols.map((c) => c.col)];
  const ph = ["$1", "$2", ...cols.map((_, i) => `$${i + 3}`)].join(", ");
  const upd = s.cols.map((c) => `${c.col} = EXCLUDED.${c.col}`).join(", ");
  const text = `INSERT INTO ${s.table} (id, sort_order, ${cols.join(", ")}) VALUES (${ph}) ON CONFLICT (id) DO UPDATE SET ${upd}, updated_at = now()`;
  return items.map((it, i) => sql(text, [it.id, top - i, ...(s.scope ? [s.scope.value] : []), ...(owners ? [owners[i]] : []), ...values(s, it.data)]));
}
function updateQueries(s: Spec, items: Item[]) {
  const set = s.cols.map((c, i) => `${c.col} = $${i + 2}`).join(", ");
  return items.map((it) => sql(`UPDATE ${s.table} SET ${set}, updated_at = now() WHERE id = $1`, [it.id, ...values(s, it.data)]));
}

/** ตรวจสิทธิ์: ต้องล็อกอิน · ระดับปฏิบัติงานใช้ได้เฉพาะข้อมูลแอปพนักงาน/แอปจัดยา · ทุกระดับยกเว้น Global Admin เห็นเฉพาะสาขาตัวเอง */
async function access(req: NextRequest, key: string) {
  const s = validKey(key) ? specFor(key) : null;
  if (!s) return { res: bad("unknown collection") };
  const me = await currentUser(req);
  if (!me) return { res: unauthorized() };
  if (s.adminOnly && me.role === "Operation") return { res: forbidden() };
  return { s, me, branch: me.role !== "Global Admin" && s.branchCol ? me.branch : null };
}

export async function GET(req: NextRequest, { params }: { params: { key: string } }) {
  const a = await access(req, params.key);
  if (!a.s) return a.res;
  return NextResponse.json(await list(params.key, a.s, a.branch));
}

export async function POST(req: NextRequest, { params }: { params: { key: string } }) {
  const key = params.key;
  const a = await access(req, key);
  if (!a.s) return a.res;
  const { s, me, branch } = a;
  let body: Body;
  try { body = await req.json(); } catch { return bad("invalid json"); }
  const logs: AuditEntry[] = [];

  try {
    switch (body.op) {
      case "seed": {
        // ใส่ข้อมูลตั้งต้นครั้งเดียว ถ้าเคยใส่แล้ว (แม้ผู้ใช้จะลบจนว่าง) จะไม่ใส่ซ้ำ · ไม่บันทึกประวัติ
        const created = await sql`INSERT INTO app_seed (collection) VALUES (${key}) ON CONFLICT DO NOTHING RETURNING collection`;
        if (created.length && body.items.length) await sql.transaction(upsertQueries(s, body.items, await ownerBranches(s, body.items, me, true)));
        break;
      }
      case "upsert": {
        if (branch && !s.hiddenBranch && body.items.some((it) => branchOf(s, it.data) !== branch)) return forbidden("บันทึกได้เฉพาะข้อมูลของสาขาตัวเอง");
        await sql`INSERT INTO app_seed (collection) VALUES (${key}) ON CONFLICT DO NOTHING`;
        const prev = await snapshot(s, body.items.map((x) => x.id));
        if (branch && [...prev.values()].some((r) => r.branch !== branch)) return forbidden("แก้ไขได้เฉพาะข้อมูลของสาขาตัวเอง (ข้อมูลส่วนกลางแก้ได้เฉพาะผู้บริหาร)");
        const fresh = body.items.filter((x) => !prev.has(x.id));
        const changed = body.items.filter((x) => prev.has(x.id));
        const owners = await ownerBranches(s, fresh, me, false);
        const queries = [...upsertQueries(s, fresh, owners), ...updateQueries(s, changed)];
        if (queries.length) await sql.transaction(queries);
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
        const gone = (await sql(`DELETE FROM ${s.table} WHERE id = ANY($1)${w.clause} RETURNING id`, [body.ids, ...w.params])) as { id: string }[];
        for (const { id } of gone) { const b = prev.get(id); if (b) logs.push({ area: key, action: "delete", recordId: id, summary: labelOf(b.rec), branch: b.branch ?? me.branch, before: b.rec }); }
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
        await sql.transaction([sql(`DELETE FROM ${s.table} WHERE true${w.clause}`, w.params), ...upsertQueries(s, body.items, await ownerBranches(s, body.items, me, false))]);
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
