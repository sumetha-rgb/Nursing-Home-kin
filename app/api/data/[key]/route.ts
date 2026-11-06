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

/* ---------- ประวัติการใช้งาน ---------- */
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

/* ---------- งานประจำวัน (daily-*) และซองยา: กันหลายเครื่องบันทึกทับกัน + สิทธิ์ฝั่ง server ---------- */
type Prev = Map<string, { rec: Rec; branch: string | null }>;
type Query = ReturnType<typeof updateQueries>[number];
/** claims: คำสั่งจองการส่งงาน ต้องรันเป็นคำสั่งแรกใน transaction เดียวกับการบันทึก (ดู claimQuery) */
type Guard = { res?: NextResponse; items: Item[]; claims?: Query[]; claimIds?: string[] };
const DAILY_DONE = ["เสร็จแล้ว", "ตรวจแล้ว"];
/** ช่องที่พนักงานกรอกตอนส่งงานจาก KinApp */
const SUBMIT_COLS = ["status", "submitted_time", "note", "done_by", "vital_signs"];
const blankVal = (v: unknown) => v === null || v === undefined || v === "" || v === "-";
const txt = (v: unknown) => (blankVal(v) ? "" : String(v).trim());
const hhmm = (v: unknown) => (blankVal(v) ? "" : String(v).slice(0, 5));
const sentBy = (rec: Rec) => `งานนี้ส่งไปแล้วโดย ${txt(rec.done_by) || "พนักงานอีกคน"}${hhmm(rec.submitted_time) ? ` เมื่อ ${hhmm(rec.submitted_time)} น.` : ""} · ไม่ต้องส่งซ้ำ`;
/** มอบหมาย/ตรวจงานได้ (เพิ่ม ลบ แก้ชื่องาน ผู้รับผิดชอบ เวลา และตรวจงาน) · ไม่มีสิทธิ์นี้ = ส่งงานได้อย่างเดียว */
const canManageDaily = (me: SessionUser) => can(me, "tasks") || can(me, "tasks.review");
/** ค่าบน server ในรูปแบบเดียวกับที่หน้าเว็บส่งมา */
const serverData = (s: Spec, id: string, rec: Rec) => rowToItem(s, { ...rec, id }).data;

/** ชุดข้อมูลที่มีตัวกันบันทึกทับ/ลบ (guardDaily guardPacks guardInvoices ผู้รับบริการ): ห้าม replace และ seed ไม่เขียนทับแถวเดิม */
const guardedKey = (key: string) => key.startsWith("daily-") || key === "residents" || key === "invoices" || key === "pharmacy-packs";

/** ลบ/ล้างงานประจำวัน: เฉพาะผู้มอบหมายงาน */
function guardDailyOp(key: string, me: SessionUser, op: string) {
  if (!key.startsWith("daily-") || canManageDaily(me)) return null;
  if (op === "delete" || op === "clear" || op === "replace") return forbidden("ลบงานประจำวันได้เฉพาะผู้มีสิทธิ์มอบหมายงาน");
  return null;
}

/**
 * บันทึกงานประจำวัน (upsert)
 *  - งานที่ส่งแล้ว (เสร็จแล้ว/ตรวจแล้ว) ห้ามส่งซ้ำโดยคนอื่น = 409 บอกชื่อคนที่ส่ง
 *  - ผู้จัดการบันทึกแถวเก่าในเครื่อง (เช่น เปลี่ยนผู้รับผิดชอบ) ทับงานที่เพิ่งส่ง = รับเฉพาะส่วนที่แก้ ช่องส่งงานใช้ค่าบน server
 *  - พนักงานทั่วไป: ส่งงาน (รอทำ → เสร็จแล้ว ในชื่อตัวเอง) ได้อย่างเดียว · ช่องอื่นใช้ค่าบน server เสมอ
 *  - การส่งงานจองแถวด้วย UPDATE แบบมีเงื่อนไข (สองเครื่องกดส่งพร้อมกัน ได้คนเดียว)
 *    อยู่ใน transaction เดียวกับการบันทึกทั้งชุด: จองไม่ได้ = ยกเลิกทั้งชุด (ไม่มีงานที่ค้างสถานะเสร็จแล้วแต่ไม่มีบันทึก/สัญญาณชีพ)
 */
function guardDaily(s: Spec, me: SessionUser, items: Item[], prev: Prev): Guard {
  const manage = canManageDaily(me);
  const idx = Object.fromEntries(s.cols.map((c, i) => [c.col, i])) as Record<string, number>;
  const out: Item[] = [];
  const claims: { id: string; by: string; at: string | null }[] = [];
  for (const it of items) {
    const old = prev.get(it.id);
    if (!old) {
      if (!manage) return { res: forbidden("เพิ่มงานประจำวันได้เฉพาะผู้มีสิทธิ์มอบหมายงาน"), items };
      out.push(it); continue;
    }
    const inc = values(s, it.data);
    const raw = (Array.isArray(it.data) ? it.data : []) as unknown[];
    const sStatus = txt(old.rec.status) || "รอทำ", iStatus = txt(inc[idx.status]) || "รอทำ";
    const submitted = DAILY_DONE.includes(sStatus);
    const isSubmit = iStatus === "เสร็จแล้ว";
    const sameSubmission = txt(inc[idx.done_by]) === txt(old.rec.done_by) && hhmm(inc[idx.submitted_time]) === hhmm(old.rec.submitted_time);
    if (submitted && isSubmit && !sameSubmission) return { res: bad(sentBy(old.rec), 409), items };
    const server = serverData(s, it.id, old.rec) as unknown[];
    if (!manage) {
      if (iStatus === "ตรวจแล้ว") return { res: forbidden("ตรวจงานได้เฉพาะผู้มีสิทธิ์ตรวจงาน"), items };
      if (!isSubmit || submitted) continue; // ไม่ได้ส่งงาน หรือส่งซ้ำของเดิม (ส่งใหม่หลังเน็ตหลุด) = ไม่ต้องบันทึก
      if (txt(inc[idx.done_by]) !== me.name) return { res: forbidden("ส่งงานได้ในชื่อของตัวเองเท่านั้น (ทำแทนคนอื่น ให้กด \"ทำแทน\")"), items };
      out.push({ id: it.id, data: s.cols.map((c, i) => (SUBMIT_COLS.includes(c.col) ? raw[i] : server[i])) });
    } else if (submitted) {
      // คงข้อมูลการส่งงานบน server · ผู้ตรวจเปลี่ยนสถานะเป็น "ตรวจแล้ว" ได้
      out.push({ id: it.id, data: s.cols.map((c, i) => (c.col === "status" ? (iStatus === "ตรวจแล้ว" ? "ตรวจแล้ว" : sStatus) : SUBMIT_COLS.includes(c.col) ? server[i] : raw[i])) });
    } else out.push(it);
    if (!submitted && isSubmit) claims.push({ id: it.id, by: txt(inc[idx.done_by]) || me.name, at: hhmm(inc[idx.submitted_time]) || null });
  }
  return { items: out, claims: claims.map(claimQuery), claimIds: claims.map((c) => c.id) };
}

/**
 * จองการส่งงาน: UPDATE แบบมีเงื่อนไข (ยังไม่มีใครส่ง) · ไม่ได้แถว = หารด้วยศูนย์ ให้ทั้ง transaction ยกเลิก
 *  ตัวหารเป็น subquery (ไม่ใช่ค่าคงที่) จึงไม่ถูกคำนวณล่วงหน้าตอนวางแผนคำสั่ง
 */
const claimQuery = (c: { id: string; by: string; at: string | null }) => sql(`WITH c AS (
    UPDATE daily_tasks SET status = 'เสร็จแล้ว', done_by = $2, submitted_time = $3::time, updated_at = now()
    WHERE id = $1 AND coalesce(status, 'รอทำ') NOT IN ('เสร็จแล้ว', 'ตรวจแล้ว') RETURNING id)
  SELECT 1 / (SELECT count(*)::int FROM c) AS claimed`, [c.id, c.by, c.at]);
const claimLost = (e: unknown) => { const x = e as { code?: string; message?: string }; return x?.code === "22012" || /division by zero/i.test(String(x?.message ?? "")); };
/** จองไม่สำเร็จ (อีกเครื่องส่งงานไปก่อน): บอกชื่อคนที่ส่ง */
async function claimConflict(ids: string[]) {
  const [cur] = (await sql(`SELECT done_by, submitted_time::text AS submitted_time FROM daily_tasks WHERE id = ANY($1) AND status IN ('เสร็จแล้ว', 'ตรวจแล้ว') LIMIT 1`, [ids])) as Rec[];
  return bad(sentBy(cur ?? {}), 409);
}

/**
 * ซองยา: บันทึกการให้ยาจากเครื่องที่ข้อมูลเก่า
 *  - ซองที่ให้ยาแล้ว: คนอื่นบันทึกซ้ำ = 409 · ห้ามแก้กลับเป็นยังไม่ให้ (เป็นบันทึกการให้ยา)
 *  - ให้ยาได้เฉพาะซองที่ QA บน server "ตรวจผ่าน" · ใช้ข้อมูลซอง (รายการยา QA) จาก server ใส่แค่ผู้ให้ยาและเวลา
 *  - ซองที่ให้ยาแล้วบน server: ไม่มีช่องไหนแก้ได้อีก (ทั้งแอปจัดยาและ KinApp ไม่แก้ซองหลังให้ยา) = คงแถวบน server ไม่บันทึก
 *  - ซองใหม่ที่ส่งมาเป็นให้ยาแล้ว: แอปจัดยาสร้างซองเป็น "รอตรวจ" ยังไม่ให้ยาเสมอ · ยอมเฉพาะผู้มีสิทธิ์แอปจัดยา และ QA ตรวจผ่าน
 */
function guardPacks(s: Spec, me: SessionUser, items: Item[], prev: Prev): Guard {
  const out: Item[] = [];
  for (const it of items) {
    const old = prev.get(it.id);
    const inc = (it.data ?? {}) as Record<string, unknown>;
    if (!old) {
      if (inc.given && (txt(inc.qa) !== "ตรวจผ่าน" || !can(me, "app.pharmacy"))) return { res: bad("ซองยาใหม่ต้องผ่านการตรวจ QA ของห้องยาก่อน จึงบันทึกว่าให้ยาแล้วได้", 409), items };
      out.push(inc.given ? { id: it.id, data: { ...inc, gby: txt(inc.gby) || me.name } } : it);
      continue;
    }
    const server = serverData(s, it.id, old.rec) as Record<string, unknown>;
    if (old.rec.given) {
      if (inc.given && txt(inc.gby) !== txt(old.rec.given_by)) return { res: bad(`ซองนี้ให้ยาไปแล้วโดย ${txt(old.rec.given_by) || "พนักงานอีกคน"}${server.gat ? ` เมื่อ ${server.gat}` : ""} · ไม่ต้องบันทึกซ้ำ`, 409), items };
      continue; // สำเนาเก่า/ส่งซ้ำ: คงข้อมูลบน server ทั้งแถว (รายการยา QA ผู้ให้ยา เวลา)
    } else if (inc.given) {
      if (txt(old.rec.qa_status) !== "ตรวจผ่าน") return { res: bad(`ซองนี้ยังไม่ผ่านการตรวจ QA ของห้องยา (สถานะ: ${txt(old.rec.qa_status) || "รอตรวจ"}) · ยังให้ยาไม่ได้`, 409), items };
      out.push({ id: it.id, data: { ...server, given: true, gby: txt(inc.gby) || me.name, gat: inc.gat ?? null } });
    } else out.push(it);
  }
  return { items: out };
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
  // ก่อน 07:00 ยังเป็นวันทำงานของเมื่อวาน (เวรดึก) ให้สร้างงานของเมื่อวานได้ถ้ายังไม่มีใครเปิด
  const first = new Date(Date.now() + 7 * 3600e3).getUTCHours() < 7 ? dayTh(-1) : dayTh();
  if (d < first || d > dayTh(14)) return;
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

/**
 * resident_id ของแต่ละรายการ จากชื่อที่เลือก · ชื่อซ้ำต่างสาขา เลือกคนในสาขาเดียวกับรายการ
 *  ไม่ผูกข้ามสาขา (ยกเว้นรายการส่วนกลาง/ไม่มีสาขา) · ยังไม่มีคนในสาขา = NULL แล้วผูกให้ตอนบันทึกผู้รับบริการ (residentSyncQueries)
 *  รายการเดิม (current) ที่ผูกไว้แล้วและชื่อยังตรงกับคนเดิม = คงรหัสเดิม (แก้ช่องอื่นไม่ทำให้หลุดไปผูกคนอื่นที่ชื่อเหมือน)
 */
async function residentIds(s: Spec, items: Item[], branches: (string | null | undefined)[], current?: Map<string, string | null>) {
  if (!s.residentLink || !items.length) return undefined;
  const ri = s.cols.findIndex((c) => c.col === "resident_name");
  const all = await allResidents();
  return items.map((it, i) => {
    const name = normName(values(s, it.data)[ri]);
    const cur = current?.get(it.id);
    if (cur && all.some((r) => r.id === cur && normName(r.full_name) === name)) return cur;
    const hits = all.filter((r) => normName(r.full_name) === name);
    // ชื่อไม่ตรงกับใครเลย (เช่น หน้าจอยังถือชื่อเก่าก่อนเปลี่ยนชื่อผู้รับบริการ) = ไม่ตัดการผูกเดิมทิ้ง
    if (cur && !hits.length && all.some((r) => r.id === cur)) return cur;
    const b = branches[i];
    return (hits.find((r) => r.branch_name === b) ?? (!b || SHARED_BRANCHES.includes(b) ? hits[0] : undefined))?.id ?? null;
  });
}
/** resident_id ปัจจุบันของรายการที่มีอยู่แล้ว */
async function currentResidentIds(s: Spec, ids: string[]) {
  if (!s.residentLink || !ids.length) return undefined;
  const rows = (await sql(`SELECT id, resident_id FROM ${s.table} WHERE id = ANY($1)`, [ids])) as { id: string; resident_id: string | null }[];
  return new Map(rows.map((r) => [r.id, r.resident_id]));
}

/**
 * ลบผู้รับบริการ: เฉพาะผู้จัดการสาขา / ผู้บริหาร และต้องไม่มีสัญญาเลย (ทุกสถานะ)
 *  ลบแล้วประวัติการดูแลบางส่วนถูกลบถาวร (แรกรับ บันทึกคลินิก ลิงก์ครอบครัว ข่าวถึงญาติ) · คนที่เคยมีสัญญาให้เปลี่ยนเป็นย้ายออกแทน
 */
async function guardResidentDelete(me: SessionUser, ids: string[]) {
  if (me.role !== "Global Admin" && me.role !== "Branch Admin") return forbidden("ลบผู้รับบริการได้เฉพาะผู้จัดการสาขาและผู้บริหาร · ถ้าไม่ได้พักแล้ว ให้เปลี่ยนสถานะเป็นย้ายออกแทน");
  if (!ids.length) return null;
  const [hit] = (await sql(`SELECT r.full_name FROM residents r WHERE r.id = ANY($1) AND EXISTS (SELECT 1 FROM contracts c
      WHERE c.resident_id = r.id OR (c.resident_id IS NULL AND c.resident_name = r.full_name AND c.branch_name IS NOT DISTINCT FROM r.branch_name)) LIMIT 1`, [ids])) as { full_name: string }[];
  return hit ? bad(`${hit.full_name} มีสัญญาอยู่ ใช้ย้ายออกแทนการลบ (ประวัติการดูแลจะยังอยู่ครบ)`, 409) : null;
}

/**
 * ผู้รับบริการเปลี่ยนห้อง (จัดเข้าห้อง ย้ายห้อง ย้ายออกจากห้อง เปลี่ยนเลขห้อง): ห้องในสัญญาที่ใช้งานอยู่/รอชำระมัดจำของคนนี้เปลี่ยนตาม
 *  ใบแจ้งหนี้และเอกสารพิมพ์จะได้ห้องปัจจุบัน · ไม่มีห้อง = "-" (ค่าเดียวกับ NO_ROOM ในหน้าสัญญา) · ทำหลังผูก resident_id ในชุดคำสั่งเดียวกัน
 */
function contractRoomQueries(s: Spec, items: Item[], prev: Prev) {
  const at = (col: string) => s.cols.findIndex((c) => c.col === col);
  const ri = at("room"), ni = at("full_name"), bi = at("branch_name");
  const roomOf = (v: unknown) => { const t = String(v ?? "").trim().replace(/\s+/g, " "); return t && t !== "-" ? t : "-"; };
  const q = [];
  for (const it of items) {
    const p = prev.get(it.id);
    if (!p) continue;
    const v = values(s, it.data);
    const room = roomOf(v[ri]);
    if (room === roomOf(p.rec.room)) continue;
    q.push(sql(`UPDATE contracts SET room = $1, updated_at = now() WHERE status IN ('ใช้งานอยู่', 'รอชำระเงินมัดจำ') AND coalesce(room, '') <> $1
      AND (resident_id = $2 OR (resident_id IS NULL AND resident_name = $3 AND branch_name IS NOT DISTINCT FROM $4))`, [room, it.id, normName(v[ni]), v[bi] ?? null]));
  }
  return q;
}

/** ย้ายผู้รับบริการไปสาขาอื่นไม่ได้ ถ้ายังมีสัญญาที่ใช้งานอยู่/รอชำระมัดจำ (สัญญา งานประจำ ลิงก์ครอบครัว ยังผูกกับสาขาเดิม) */
async function branchMoveDenied(s: Spec, items: Item[], prev: Prev) {
  const bi = s.cols.findIndex((c) => c.col === "branch_name");
  const moved = items.filter((it) => { const p = prev.get(it.id); return p && (p.rec.branch_name ?? null) !== (values(s, it.data)[bi] ?? null); });
  if (!moved.length) return null;
  const [hit] = (await sql(`SELECT r.full_name, r.branch_name FROM residents r WHERE r.id = ANY($1) AND EXISTS (SELECT 1 FROM contracts c
      WHERE (c.resident_id = r.id OR (c.resident_id IS NULL AND c.resident_name = r.full_name AND c.branch_name IS NOT DISTINCT FROM r.branch_name))
        AND c.status IN ('ใช้งานอยู่', 'รอชำระเงินมัดจำ')) LIMIT 1`, [moved.map((x) => x.id)])) as { full_name: string; branch_name: string }[];
  return hit ? `${hit.full_name} ยังมีสัญญาที่ใช้งานอยู่ในสาขา${hit.branch_name ?? ""} จึงย้ายสาขาไม่ได้ · ให้สิ้นสุดสัญญา (D/C) ที่สาขาเดิม แล้วเปิดสัญญาใหม่ที่สาขาใหม่` : null;
}

/** ผู้รับบริการที่บันทึกเป็นย้ายออก: ปิดลิงก์ครอบครัวที่ยังใช้ได้ (ญาติเปิดสมุดภาพ/รีวิวต่อไม่ได้) */
async function closeFamilyLinks(s: Spec, items: Item[]): Promise<AuditEntry[]> {
  const si = s.cols.findIndex((c) => c.col === "status");
  const out = items.filter((it) => String(values(s, it.data)[si] ?? "").startsWith("ย้ายออก")).map((it) => it.id);
  if (!out.length) return [];
  const closed = (await sql(`UPDATE review_links SET active = false WHERE active AND resident_id = ANY($1) RETURNING id, resident_name, branch_name`, [out])) as { id: string; resident_name: string; branch_name: string }[];
  return closed.map((l) => ({ area: "review_links", action: "delete", recordId: l.id, summary: `ปิดลิงก์ครอบครัวอัตโนมัติ (ย้ายออก) · ${l.resident_name}`, branch: l.branch_name }));
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
  // งานประจำวัน: พนักงานทั่วไปลบ/ล้างไม่ได้ และใส่ข้อมูลตั้งต้นเองไม่ได้
  const dailyDenied = guardDailyOp(key, me, body.op);
  if (dailyDenied) return dailyDenied;
  if (body.op === "seed" && key.startsWith("daily-") && !canManageDaily(me)) body.items = [];
  const logs: AuditEntry[] = [];

  try {
    switch (body.op) {
      case "seed": {
        // ใส่ข้อมูลตั้งต้นครั้งเดียว ถ้าเคยใส่แล้ว (แม้ผู้ใช้จะลบจนว่าง) จะไม่ใส่ซ้ำ · ไม่บันทึกประวัติ
        const created = await sql`INSERT INTO app_seed (collection) VALUES (${key}) ON CONFLICT DO NOTHING RETURNING collection`;
        // ชุดข้อมูลที่มีตัวกันบันทึกทับ: ข้อมูลตั้งต้นใส่ได้เฉพาะรายการใหม่ ไม่เขียนทับแถวที่มีอยู่แล้ว
        if (created.length && guardedKey(key) && body.items.length) { const exist = await snapshot(s, body.items.map((x) => x.id)); body.items = body.items.filter((x) => !exist.has(x.id)); }
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
        if (key === "residents") { const moved = await branchMoveDenied(s, body.items, prev); if (moved) return bad(moved, 409); }
        // งานประจำวัน / ซองยา: กันบันทึกทับข้อมูลที่เครื่องอื่นเพิ่งบันทึก (ดู guardDaily / guardPacks)
        const guarded = key.startsWith("daily-") ? guardDaily(s, me, body.items, prev) : key === "pharmacy-packs" ? guardPacks(s, me, body.items, prev) : null;
        if (guarded?.res) return guarded.res;
        if (guarded) body.items = guarded.items;
        // ใบแจ้งหนี้: กันแก้สถานะ/ยอดของใบที่รับเงินแล้ว · ยกเลิกต้องมีสิทธิ์ · ยกเลิกแล้วคืนรายการที่ผูกกับใบ (ดู guardInvoices)
        const invGuard = key === "invoices" ? await guardInvoices(s, me, body.items, prev) : null;
        if (invGuard?.res) return invGuard.res;
        if (invGuard) body.items = invGuard.items;
        const fresh = body.items.filter((x) => !prev.has(x.id));
        const changed = body.items.filter((x) => prev.has(x.id));
        const owners = await ownerBranches(s, fresh, me, false);
        const freshBranch = fresh.map((it, i) => owners?.[i] ?? (branchOf(s, it.data) as string | null) ?? me.branch);
        const changedBranch = changed.map((it) => prev.get(it.id)!.branch ?? (branchOf(s, it.data) as string | null));
        const freshRids = await residentIds(s, fresh, freshBranch);
        const changedRids = await residentIds(s, changed, changedBranch, await currentResidentIds(s, changed.map((x) => x.id)));
        const queries = [
          // จองการส่งงานก่อน (ต้องอยู่ก่อนคำสั่งบันทึกแถวเดียวกัน) · จองไม่ได้ = ทั้งชุดยกเลิก
          ...(guarded?.claims ?? []),
          ...upsertQueries(s, fresh, { [s.branchCol ?? "_"]: owners, resident_id: freshRids }),
          ...updateQueries(s, changed, { resident_id: changedRids }),
          ...(invGuard?.release ?? []),
          ...(key === "residents" ? residentSyncQueries(s, body.items, prev) : []),
          ...(key === "residents" ? contractRoomQueries(s, changed, prev) : []),
          ...alertQueries(key, s, me, [
            ...fresh.map((it, i) => ({ id: it.id, rec: asRec(s, values(s, it.data)), branch: freshBranch[i], residentId: freshRids?.[i] ?? null })),
            ...changed
              .filter((it) => { const b = prev.get(it.id)!.rec, a = asRec(s, values(s, it.data)); return ["vital_signs", "o2_sat", "dtx"].some((c) => normValue(a[c]) !== normValue(b[c])); })
              .map((it) => { const i = changed.indexOf(it); return { id: it.id, rec: asRec(s, values(s, it.data)), branch: changedBranch[i], residentId: changedRids?.[i] ?? null }; }),
          ]),
        ];
        try {
          if (queries.length) await sql.transaction(queries);
        } catch (e) {
          if (guarded?.claimIds?.length && claimLost(e)) return await claimConflict(guarded.claimIds);
          throw e;
        }
        if (key === "residents" && fresh.length) await sql.transaction(hnQueries(fresh.map((x) => x.id)));
        if (key === "residents") logs.push(...await closeFamilyLinks(s, body.items));
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
        if (key === "invoices") { const paidDenied = guardInvoiceDelete(prev); if (paidDenied) return paidDenied; }
        if (key === "residents") { const resDenied = await guardResidentDelete(me, body.ids); if (resDenied) return resDenied; }
        const w = where(s, branch, 2);
        // ซองยาที่จ่ายให้ผู้รับบริการแล้ว = บันทึกการให้ยา (MAR) ห้ามลบ
        const keep = s.table === "medication_packs" ? " AND given = false" : "";
        const gone = (await sql(`DELETE FROM ${s.table} WHERE id = ANY($1)${w.clause}${keep} RETURNING id`, [body.ids, ...w.params])) as { id: string }[];
        for (const { id } of gone) { const b = prev.get(id); if (b) logs.push({ area: key, action: "delete", recordId: id, summary: labelOf(b.rec), branch: b.branch ?? me.branch, before: b.rec }); }
        if (gone.length) await sql(`DELETE FROM care_alerts WHERE status = 'open' AND id = ANY($1)`, [gone.map((g) => `${s.table}:${g.id}`)]);
        break;
      }
      case "clear": {
        // ผู้รับบริการล้างทั้งชุดไม่ได้ (ลบทีละคนตามเงื่อนไขใน guardResidentDelete)
        if (key === "residents") return forbidden("ล้างทะเบียนผู้รับบริการทั้งหมดไม่ได้ · ลบได้ทีละคน (เฉพาะคนที่ไม่มีสัญญา)");
        // ใบแจ้งหนี้ (มีใบที่รับเงินแล้ว) และซองยา (มีบันทึกการให้ยา) ล้างทั้งชุดไม่ได้ · หน้าเว็บไม่มีปุ่มล้างของชุดนี้
        if (key === "invoices" || key === "pharmacy-packs") return forbidden("ชุดข้อมูลนี้ล้างทั้งชุดไม่ได้ · ลบทีละรายการ");
        const w = where(s, branch, 1);
        const gone = (await sql(`DELETE FROM ${s.table} WHERE true${w.clause} RETURNING id`, w.params)) as { id: string }[];
        if (gone.length) logs.push({ area: key, action: "clear", summary: `ล้างข้อมูล ${gone.length} รายการ`, branch: branch ?? null });
        break;
      }
      case "replace": {
        if (branch) return forbidden();
        // ลบทั้งชุดแล้วใส่ใหม่ ข้ามตัวกันของ upsert/delete (ใบที่รับเงินแล้ว ซองที่ให้ยาแล้ว งานที่ส่งแล้ว ผู้รับบริการที่มีสัญญา) · หน้าเว็บไม่ได้ใช้กับชุดเหล่านี้
        if (guardedKey(key)) return forbidden("ชุดข้อมูลนี้แทนที่ทั้งชุดไม่ได้ · บันทึกหรือลบทีละรายการ");
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

/* ---------- ใบแจ้งหนี้: กันแก้ยอด/สถานะของใบที่รับเงินแล้ว และคืนรายการเมื่อยกเลิกใบ ---------- */
const INV_PAID = ["ชำระแล้ว", "ชำระบางส่วน"], INV_VOID = "ยกเลิก";
const invNum = (v: unknown) => Math.round((Number(String(v ?? "").replace(/,/g, "")) || 0) * 100) / 100;
/** รายการในใบ (JSON) เทียบแบบไม่สนรูปแบบการเว้นวรรค */
const invItems = (v: unknown) => { try { return JSON.stringify(JSON.parse(String(v ?? "") || "[]")); } catch { return String(v ?? ""); } };
type InvGuard = { res?: NextResponse; release: ReturnType<typeof updateQueries>; items: Item[] };
/** ใบที่ชำระแล้ว / ชำระบางส่วน / ยกเลิก: ช่องที่ยังแก้ได้ (ไม่กระทบยอด เลขที่ ผู้รับบริการ หรือรายงาน) · ช่องอื่นใช้ค่าบน server */
const INV_LOCKED_EDITABLE = ["note"];
/** ตารางที่ผูกรายการเข้ากับใบแจ้งหนี้ (ดึงเข้าใบจากหน้าใบแจ้งหนี้และใบเสร็จ · /api/clinic supply_bill) */
const INVOICE_LINKED = ["supply_issues", "stock_moves", "physio_courses", "clinical_notes"];

/**
 * บันทึกใบแจ้งหนี้ผ่าน /api/data/invoices (การรับชำระทำได้ที่ /api/billing เท่านั้น)
 *  - ตั้งสถานะเป็น ชำระแล้ว / ชำระบางส่วน เองไม่ได้ (ทั้งใบใหม่และใบเดิม)
 *  - ใบใน server ที่ชำระแล้ว / ชำระบางส่วน / ยกเลิก: แก้ยอด รายการ หรือสถานะไม่ได้ (กันสำเนาเก่าในอีกเครื่องเขียนทับ)
 *    ช่องอื่น (วันที่ ประเภท เลขที่สัญญา ผู้รับบริการ HN ผู้ชำระ) ใช้ค่าบน server · แก้ได้เฉพาะ INV_LOCKED_EDITABLE (หน้าเว็บไม่ได้แก้ใบหลังรับเงิน)
 *  - ยกเลิกใบ: ต้องมีสิทธิ์ "ยกเลิกใบแจ้งหนี้ / ใบเสร็จ" และใบใน server ต้องยังไม่ได้รับเงิน
 *    ยกเว้นตอนยกเลิกสัญญา: ใบที่ยังไม่ได้รับเงินของสัญญาที่ถูกยกเลิกแล้ว ผู้มีสิทธิ์สัญญายกเลิกตามได้
 *  - ยกเลิกแล้ว: คืนยา เวชภัณฑ์ คอร์สกายภาพ กายภาพรายครั้งที่ผูกกับใบนี้ (invoice_id = NULL) ให้ดึงเข้าใบใหม่ได้ · อยู่ในคำสั่งชุดเดียวกับการบันทึก
 */
async function guardInvoices(s: Spec, me: SessionUser, items: Item[], prev: Map<string, { rec: Rec; branch: string | null }>): Promise<InvGuard> {
  const at = (it: Item, col: string) => values(s, it.data)[s.cols.findIndex((c) => c.col === col)];
  const stop = (msg: string): InvGuard => ({ res: bad(msg, 409), release: [], items });
  const voided: string[] = [], needContract: { id: string; no: string; label: string }[] = [];
  const out: Item[] = [];
  for (const it of items) {
    out.push(it);
    const status = String(at(it, "status") ?? "");
    const b = prev.get(it.id)?.rec;
    if (!b) {
      if (INV_PAID.includes(status)) return stop(`บันทึกใบแจ้งหนี้เป็นสถานะ "${status}" ไม่ได้ · รับชำระที่ปุ่ม รับชำระ`);
      continue;
    }
    const was = String(b.status ?? ""), label = b.doc_no ? `${b.doc_no} ` : "";
    if (status !== was && INV_PAID.includes(status)) return stop(`เปลี่ยนสถานะเป็น "${status}" ไม่ได้ · การรับชำระต้องทำที่ปุ่ม รับชำระ`);
    if (INV_PAID.includes(was) || was === INV_VOID) {
      if (status !== was) return stop(`เอกสาร ${label}เป็นสถานะ "${was}" แล้ว (อาจมีอีกเครื่องเพิ่งบันทึก) จึงเปลี่ยนสถานะไม่ได้ · กรุณาโหลดหน้าใหม่`);
      const moneyChanged = invNum(at(it, "net")) !== invNum(b.net) || invNum(at(it, "total")) !== invNum(b.total) || invNum(at(it, "discount")) !== invNum(b.discount) || invItems(at(it, "items_json")) !== invItems(b.items_json);
      if (moneyChanged) return stop(`เอกสาร ${label}สถานะ "${was}" แก้ยอดหรือรายการไม่ได้ · ถ้ายอดไม่ถูกต้องให้ออกใบใหม่`);
      const server = serverData(s, it.id, b) as Record<string, unknown>, inc = (it.data ?? {}) as Record<string, unknown>;
      out[out.length - 1] = { id: it.id, data: { ...server, ...Object.fromEntries(INV_LOCKED_EDITABLE.filter((f) => f in inc).map((f) => [f, inc[f]])) } };
      continue;
    }
    if (status === INV_VOID) {
      if (invNum(b.paid_total) > 0) return stop(`ยกเลิก ${label}ไม่ได้ เพราะรับชำระไปแล้ว ${invNum(b.paid_total).toLocaleString("en-US", { minimumFractionDigits: 2 })} บาท`);
      if (!can(me, "invoices.void")) needContract.push({ id: it.id, no: String(b.contract_no ?? ""), label });
      voided.push(it.id);
    }
  }
  if (needContract.length) {
    // ไม่มีสิทธิ์ยกเลิกใบ: ยอมเฉพาะใบของสัญญาที่ถูกยกเลิกแล้ว (ยกเลิกสัญญา → ใบที่ยังไม่ชำระถูกยกเลิกตาม) และผู้ใช้มีสิทธิ์สัญญา
    const nos = [...new Set(needContract.map((x) => x.no).filter(Boolean))];
    const cancelled = new Set(nos.length ? ((await sql(`SELECT contract_no FROM contracts WHERE contract_no = ANY($1) AND status = 'ยกเลิกสัญญา'`, [nos])) as { contract_no: string }[]).map((r) => r.contract_no) : []);
    const denied = needContract.find((x) => !can(me, "contracts") || !cancelled.has(x.no));
    if (denied) return { res: forbidden(`บัญชีนี้ไม่มีสิทธิ์ยกเลิกใบแจ้งหนี้ ${denied.label}· ให้ผู้มีสิทธิ์ "ยกเลิกใบแจ้งหนี้ / ใบเสร็จ" เป็นผู้ยกเลิก`), release: [], items };
  }
  if (!voided.length) return { release: [], items: out };
  return { items: out, release: [
    // มีอีกเครื่องรับชำระแทรกเข้ามาหลังตรวจ (ก่อนคำสั่งนี้): คืนสถานะตามยอดที่รับจริง ไม่ยกเลิกใบที่มีเงินเข้าแล้ว
    sql(`UPDATE invoices SET status = CASE WHEN paid_total >= net - 0.005 THEN 'ชำระแล้ว' ELSE 'ชำระบางส่วน' END WHERE id = ANY($1) AND status = 'ยกเลิก' AND paid_total > 0`, [voided]),
    ...INVOICE_LINKED.map((t) => sql(`UPDATE ${t} SET invoice_id = NULL WHERE invoice_id = ANY($1) AND EXISTS (SELECT 1 FROM invoices v WHERE v.id = ${t}.invoice_id AND v.status = 'ยกเลิก')`, [voided])),
  ] };
}

/** ลบใบแจ้งหนี้: ใบที่รับเงินแล้วลบไม่ได้ (การรับเงินรายงวดจะหายตาม) · ให้ยกเลิกเอกสารแทน */
function guardInvoiceDelete(prev: Map<string, { rec: Rec; branch: string | null }>) {
  const paid = [...prev.values()].find((r) => INV_PAID.includes(String(r.rec.status ?? "")) || invNum(r.rec.paid_total) > 0);
  return paid ? bad(`ลบเอกสาร ${paid.rec.doc_no ?? ""} ไม่ได้ เพราะรับชำระแล้ว · ใช้การยกเลิกเอกสารแทน`, 409) : null;
}
