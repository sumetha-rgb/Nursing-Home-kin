import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUser, forbidden, unauthorized } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { can } from "@/lib/perms";
import type { SessionUser } from "@/lib/roles";
import { CATS, codeProblem, DEFAULT_ITEMS, isCat, PriceItem, Rate, RATE_UNITS, rateCode, RateUnit, sortItems } from "@/lib/priceList";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * ใบราคาและรหัส (ราคากลางทุกสาขา) · ทุกคนที่เข้าระบบอ่านได้ (ช่องเลือกค่าบริการในเอกสาร) · ผู้จัดการสาขาและผู้บริหารแก้ได้
 *  GET                         ทุกรายการ (รวมที่ปิดใช้) · ราคาที่ตั้งล่วงหน้าถึงวันมีผลแล้วจะเปลี่ยนให้ตอนอ่าน · ตารางว่าง = ตั้งต้นจากใบราคาเดิม
 *  GET  ?history=<id>          ประวัติการแก้ของรายการนั้น
 *  POST { op: "save", id?, code, cat, sub, name, rates: [{unit, price, label?, from?: index เดิม}], when?: "YYYY-MM-DD", reason }
 *                              ไม่มี id = เพิ่มรายการ · when = วันที่ราคาใหม่มีผล (ว่างหรือวันนี้ = มีผลทันที) · แก้รายการเดิมต้องมีเหตุผล
 *  POST { op: "cancel_next", id, i }       ยกเลิกราคาที่ตั้งล่วงหน้าของราคาที่ i
 *  POST { op: "active", id, active, reason? }  ปิดใช้ / เปิดใช้
 *  POST { op: "import", rows: [{code, name?, price?, status?}], reason, apply }  นำเข้า CSV · apply = false ดูผลก่อน
 */
const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
const NO_TABLE = "ยังไม่ได้สร้างตารางใบราคาในฐานข้อมูล · ให้ผู้ดูแลระบบรัน npm run db:setup ก่อน";
const noTable = (e: unknown) => /price_(items|history)/.test(String((e as Error)?.message ?? "")) && /does not exist/.test(String((e as Error)?.message ?? ""));
const today = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
const MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const thDate = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return `${d} ${MON[m - 1]} ${String(y + 543).slice(2)}`; };
const canEdit = (me: SessionUser) => (me.role === "Global Admin" || me.role === "Branch Admin") && can(me, "prices");
const who = (me: SessionUser) => `${me.name} · ${me.role === "Global Admin" ? "ผู้บริหาร" : `ผู้จัดการสาขา ${me.branch ?? ""}`.trim()}`;

type Row = Omit<PriceItem, "group">;
const SELECT = `SELECT id, code, cat, sub, name, rates, old_codes AS old, active, coalesce(updated_by, '') AS "updatedBy",
  to_char(updated_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI') AS "updatedAt" FROM price_items`;
const all = async () => (await sql(SELECT)) as Row[];
const one = async (id: string) => ((await sql(`${SELECT} WHERE id = $1`, [id])) as Row[])[0];

async function log(entries: { item: Row; action: string; detail?: string; reason?: string; by: string }[]) {
  if (!entries.length) return;
  await sql(`INSERT INTO price_history (id, item_id, code, action, detail, reason, by_name)
    SELECT x.id, x.item_id, x.code, x.action, x.detail, x.reason, x.by_name FROM jsonb_to_recordset($1::jsonb)
      AS x(id text, item_id text, code text, action text, detail text, reason text, by_name text)`,
  [JSON.stringify(entries.map((e) => ({ id: crypto.randomUUID(), item_id: e.item.id, code: e.item.code, action: e.action, detail: e.detail || null, reason: e.reason || null, by_name: e.by })))]);
}
const write = (x: Row, by: string) =>
  sql(`UPDATE price_items SET code = $2, sub = $3, name = $4, rates = $5::jsonb, old_codes = $6, active = $7, updated_by = $8, updated_at = now() WHERE id = $1`,
    [x.id, x.code, x.sub, x.name, JSON.stringify(x.rates), x.old ?? [], x.active !== false, by]);

/** ตารางว่าง: ตั้งต้นจากใบราคาเดิม (รันซ้ำพร้อมกันได้ รหัสซ้ำจะข้าม) */
async function seed() {
  const [{ n }] = (await sql("SELECT count(*)::int AS n FROM price_items")) as { n: number }[];
  if (n) return;
  const rows = DEFAULT_ITEMS.map((x) => ({ id: crypto.randomUUID(), code: x.code, cat: x.cat, sub: x.sub, name: x.name, rates: x.rates, old_codes: x.old ?? [] }));
  const added = (await sql(`INSERT INTO price_items (id, code, cat, sub, name, rates, old_codes, updated_by)
    SELECT x.id, x.code, x.cat, x.sub, x.name, x.rates, ARRAY(SELECT jsonb_array_elements_text(x.old_codes)), 'ระบบ'
      FROM jsonb_to_recordset($1::jsonb) AS x(id text, code text, cat text, sub text, name text, rates jsonb, old_codes jsonb)
    ON CONFLICT (code) DO NOTHING RETURNING id, code, old_codes AS old`, [JSON.stringify(rows)])) as Row[];
  await log(added.map((item) => ({ item, action: "เพิ่มรายการ", detail: `ย้ายจากใบราคาเดิม · รหัสเดิม ${item.old?.join(", ")}`, by: "ระบบ" })));
}

/** ราคาที่ตั้งล่วงหน้าและถึงวันมีผลแล้ว: เปลี่ยนเป็นราคาปัจจุบัน */
async function applyDue(items: Row[]) {
  const d = today();
  for (const x of items) {
    const due = x.rates.filter((r) => r.next && r.next.from <= d);
    if (!due.length) continue;
    const detail = due.map((r) => `${r.unit}${r.label ? ` (${r.label})` : ""} ${money(r.price)} → ${money(r.next!.price)}`).join(" · ");
    x.rates = x.rates.map((r) => (r.next && r.next.from <= d ? { unit: r.unit, price: r.next.price, ...(r.label ? { label: r.label } : {}) } : r));
    await sql(`UPDATE price_items SET rates = $2::jsonb WHERE id = $1`, [x.id, JSON.stringify(x.rates)]);
    await log([{ item: x, action: "ราคาใหม่มีผล", detail: `ตามที่ตั้งไว้ · ${detail}`, by: "ระบบ" }]);
  }
}

export async function GET(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  try {
    const hid = req.nextUrl.searchParams.get("history");
    if (hid) {
      const rows = await sql(`SELECT action, coalesce(detail, '') AS detail, coalesce(reason, '') AS reason, coalesce(by_name, '') AS by, code,
          to_char(created_at AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD HH24:MI') AS at FROM price_history WHERE item_id = $1 ORDER BY created_at DESC LIMIT 200`, [hid]);
      return NextResponse.json({ items: rows });
    }
    await seed();
    const items = await all();
    await applyDue(items);
    return NextResponse.json({ items: sortItems(items), canEdit: canEdit(me) });
  } catch (e) {
    if (noTable(e)) return NextResponse.json({ items: DEFAULT_ITEMS, missing: NO_TABLE, canEdit: false });
    throw e;
  }
}

/** ราคาที่ส่งมาจากหน้าเว็บ · from = ลำดับราคาเดิม (ไม่มี = ราคาที่เพิ่มใหม่) */
type InRate = { unit: RateUnit; price: number; label?: string; from?: number; room?: number };
function readRates(v: unknown): InRate[] | string {
  if (!Array.isArray(v) || !v.length) return "ต้องมีราคาอย่างน้อย 1 ราคา";
  if (v.length > 8) return "ราคาต่อรายการได้ไม่เกิน 8 ราคา";
  const out: InRate[] = [];
  for (const r of v as Record<string, unknown>[]) {
    const unit = r?.unit as RateUnit, price = Number(r?.price);
    if (!RATE_UNITS.includes(unit)) return "หน่วยราคาไม่ถูกต้อง";
    if (r?.price === "" || r?.price === null || !Number.isFinite(price) || price < 0 || price > 10_000_000) return `ราคา${unit}ไม่ถูกต้อง`;
    const label = typeof r.label === "string" ? r.label.trim().slice(0, 40) : "";
    const room = r?.room === "" || r?.room === null || r?.room === undefined ? NaN : Number(r.room);
    if (Number.isFinite(room) && (room < 0 || room > price)) return `ค่าห้องของราคา${unit}ต้องไม่ติดลบและไม่เกินราคา`;
    out.push({ unit, price: Math.round(price * 100) / 100, ...(label ? { label } : {}), ...(Number.isInteger(r.from) ? { from: r.from as number } : {}), ...(Number.isFinite(room) ? { room: Math.round(room * 100) / 100 } : {}) });
  }
  return out;
}
const rateName = (r: Rate) => `${r.unit}${r.label ? ` (${r.label})` : ""}`;

async function save(me: SessionUser, b: Record<string, unknown>) {
  const name = typeof b.name === "string" ? b.name.trim().replace(/\s+/g, " ") : "";
  const cat = b.cat, code = typeof b.code === "string" ? b.code.trim().toUpperCase() : "";
  const sub = typeof b.sub === "string" ? b.sub : "";
  const reason = typeof b.reason === "string" ? b.reason.trim().slice(0, 300) : "";
  const when = typeof b.when === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.when) && b.when > today() ? b.when : "";
  if (!isCat(cat)) return bad("กรุณาเลือกหมวด");
  if (!CATS[cat].subs.some((s) => s[0] === sub)) return bad("กรุณาเลือกหมวดย่อย");
  if (name.length < 2 || name.length > 200) return bad("กรุณาใส่ชื่อรายการ (2–200 ตัวอักษร)");
  const rates = readRates(b.rates);
  if (typeof rates === "string") return bad(rates);
  const items = sortItems(await all());
  const id = typeof b.id === "string" ? b.id : "";
  const prob = codeProblem(items, code, cat, id || undefined);
  if (prob) return bad(prob);
  const by = who(me);

  if (!id) {
    const x: Row = { id: crypto.randomUUID(), code, cat, sub, name, rates: rates.map(({ from: _f, ...r }) => r), old: [], active: true };
    await sql(`INSERT INTO price_items (id, code, cat, sub, name, rates, updated_by) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`, [x.id, code, cat, sub, name, JSON.stringify(x.rates), by]);
    await log([{ item: x, action: "เพิ่มรายการ", detail: x.rates.map((r, i) => `${rateCode(x, i)} ${money(r.price)}/${rateName(r)}`).join(" · "), reason, by }]);
    return { item: x, summary: `เพิ่ม ${code} ${name}` };
  }

  const old = items.find((x) => x.id === id);
  if (!old) return bad("ไม่พบรายการ", 404);
  if (old.cat !== cat) return bad("เปลี่ยนหมวดหลักไม่ได้ · ให้เพิ่มเป็นรายการใหม่แล้วปิดใช้รายการเดิม");
  const changes: string[] = [];
  if (old.code !== code) changes.push(`รหัส ${old.code} → ${code}`);
  if (old.name !== name) changes.push(`ชื่อ "${old.name}" → "${name}"`);
  if (old.sub !== sub) changes.push(`หมวดย่อย ${old.sub} → ${sub}`);
  const kept = new Set<number>();
  const next: Rate[] = rates.map((r) => {
    const was = r.from !== undefined ? old.rates[r.from] : undefined;
    if (!was) { changes.push(`เพิ่มราคา ${money(r.price)}/${rateName(r)}`); return { unit: r.unit, price: r.price, ...(r.label ? { label: r.label } : {}), ...(r.room !== undefined ? { room: r.room } : {}) }; }
    kept.add(r.from!);
    if (rateName(was) !== rateName(r)) changes.push(`หน่วย ${rateName(was)} → ${rateName(r)}`);
    if ((was.room ?? null) !== (r.room ?? null)) changes.push(`ค่าห้อง (มี VAT) ของราคา${rateName(r)} ${was.room !== undefined ? money(was.room) : "ค่าเริ่มต้น"} → ${r.room !== undefined ? money(r.room) : "ค่าเริ่มต้น"}`);
    const base = { unit: r.unit, ...(r.label ? { label: r.label } : {}), ...(r.room !== undefined ? { room: r.room } : {}) };
    if (r.price === was.price) return { ...base, price: was.price, ...(was.next ? { next: was.next } : {}) };
    if (when) { changes.push(`ราคา${rateName(r)} ${money(was.price)} → ${money(r.price)} มีผล ${thDate(when)}`); return { ...base, price: was.price, next: { price: r.price, from: when } }; }
    changes.push(`ราคา${rateName(r)} ${money(was.price)} → ${money(r.price)}`);
    return { ...base, price: r.price };
  });
  old.rates.forEach((r, i) => { if (!kept.has(i)) changes.push(`ลบราคา ${money(r.price)}/${rateName(r)}`); });
  if (!changes.length) return bad("ยังไม่ได้แก้อะไร");
  if (!reason) return bad("กรุณาใส่เหตุผลที่แก้");
  // เปลี่ยนรหัส: เก็บรหัสเดิมไว้ค้นหา · เปลี่ยนกลับไปใช้รหัสเดิมของตัวเอง = เอาออกจากรายการรหัสเดิม
  const oldCodes = old.code !== code ? [...new Set([...(old.old ?? []), old.code])].filter((c) => c !== code) : old.old ?? [];
  const x: Row = { ...old, code, sub, name, rates: next, old: oldCodes };
  await write(x, by);
  await log([{ item: x, action: "แก้ไข", detail: changes.join(" · "), reason, by }]);
  return { item: x, summary: `${code} ${name} · ${changes.join(" · ")}` };
}

async function importRows(me: SessionUser, b: Record<string, unknown>) {
  const rows = Array.isArray(b.rows) ? (b.rows as Record<string, unknown>[]).slice(0, 2000) : [];
  if (!rows.length) return bad("ไม่พบแถวข้อมูลในไฟล์");
  const reason = typeof b.reason === "string" ? b.reason.trim().slice(0, 300) : "";
  const items = sortItems(await all());
  const flat = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  type Plan = { row: number; code: string; name: string; change?: string; skip?: string };
  const plan: Plan[] = [];
  const touched = new Map<string, { x: Row; changes: string[] }>();
  rows.forEach((r, k) => {
    const full = String(r.code ?? "").trim().toUpperCase(), nm = String(r.name ?? "").trim();
    const p: Plan = { row: k + 2, code: full, name: nm };
    plan.push(p);
    const m = full.match(/^([A-Z]{2}-\d{2})-([A-Z]\w{0,2})$/);
    const x = m && items.find((i) => i.code === m[1]);
    if (!x) { p.skip = full ? "ไม่พบรหัสนี้ในใบราคา" : "ไม่มีรหัส"; return; }
    p.name = x.name;
    // ชื่อที่อ่านไม่ออก (ไฟล์ไม่ใช่ UTF-8) ไม่ใช้ตรวจ
    if (nm && !nm.includes("�") && flat(nm) !== flat(x.name)) { p.skip = "ชื่อไม่ตรงกับรหัส"; return; }
    const t = touched.get(x.id!) ?? { x: { ...x, rates: x.rates.map((y) => ({ ...y })) }, changes: [] };
    const i = t.x.rates.findIndex((_, j) => rateCode(t.x, j) === full);
    if (i < 0) { p.skip = "ไม่พบราคานี้ในรายการ"; return; }
    const out: string[] = [];
    const price = r.price === undefined || r.price === "" ? NaN : Number(String(r.price).replace(/,/g, ""));
    const rate = t.x.rates[i];
    if (Number.isFinite(price) && price >= 0 && price !== rate.price) {
      out.push(`ราคา ${money(rate.price)} → ${money(price)}`);
      t.x.rates[i] = { unit: rate.unit, price, ...(rate.label ? { label: rate.label } : {}) };
    }
    const st = String(r.status ?? "").trim();
    const want = st === "ปิดใช้" ? false : st === "ใช้อยู่" ? true : null;
    if (want !== null && want !== (t.x.active !== false)) { out.push(want ? "เปิดใช้" : "ปิดใช้"); t.x.active = want; }
    if (!out.length) { p.change = "ไม่เปลี่ยน"; return; }
    p.change = out.join(" · ");
    t.changes.push(`${full} ${out.join(" · ")}`);
    touched.set(x.id!, t);
  });
  const changed = [...touched.values()].filter((t) => t.changes.length);
  if (b.apply !== true) return { plan, count: changed.length };
  if (!changed.length) return bad("ไม่มีรายการที่ต้องเปลี่ยน");
  if (!reason) return bad("กรุณาใส่เหตุผลที่นำเข้า");
  const by = who(me);
  for (const t of changed) await write(t.x, by);
  await log(changed.map((t) => ({ item: t.x, action: "นำเข้า CSV", detail: t.changes.join(" · "), reason, by })));
  return { plan, count: changed.length, summary: `นำเข้า CSV · เปลี่ยน ${changed.length} รายการ` };
}

export async function POST(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (!canEdit(me)) return forbidden("แก้ใบราคาได้เฉพาะผู้จัดการสาขาและผู้บริหาร");
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const by = who(me);
  try {
    let out: { summary?: string } & Record<string, unknown>;
    if (b.op === "save") {
      const r = await save(me, b);
      if (r instanceof NextResponse) return r;
      out = r;
    } else if (b.op === "cancel_next" || b.op === "active") {
      const x = typeof b.id === "string" ? await one(b.id) : undefined;
      if (!x) return bad("ไม่พบรายการ", 404);
      if (b.op === "cancel_next") {
        const r = x.rates[Number(b.i)];
        if (!r?.next) return bad("ราคานี้ไม่มีราคาที่ตั้งล่วงหน้า");
        const detail = `ยกเลิกราคาใหม่ ${rateName(r)} ${money(r.next.price)} ที่จะมีผล ${thDate(r.next.from)}`;
        x.rates = x.rates.map((y, j) => (j === Number(b.i) ? { unit: y.unit, price: y.price, ...(y.label ? { label: y.label } : {}) } : y));
        await write(x, by);
        await log([{ item: x, action: "แก้ไข", detail, by }]);
        out = { item: x, summary: `${x.code} · ${detail}` };
      } else {
        const active = b.active === true;
        if ((x.active !== false) === active) return bad(active ? "รายการนี้ใช้อยู่แล้ว" : "รายการนี้ปิดใช้อยู่แล้ว");
        const reason = typeof b.reason === "string" ? b.reason.trim().slice(0, 300) : "";
        x.active = active;
        await write(x, by);
        await log([{ item: x, action: active ? "เปิดใช้" : "ปิดใช้", reason, by }]);
        out = { item: x, summary: `${active ? "เปิดใช้" : "ปิดใช้"} ${x.code} ${x.name}` };
      }
    } else if (b.op === "import") {
      const r = await importRows(me, b);
      if (r instanceof NextResponse) return r;
      out = r;
    } else return bad("คำสั่งไม่ถูกต้อง");
    if (out.summary) await audit(req, me, [{ area: "prices", action: "update", recordId: (out.item as Row | undefined)?.id ?? null, summary: out.summary, branch: "ส่วนกลาง" }]);
    return NextResponse.json(out);
  } catch (e) {
    if (noTable(e)) return bad(NO_TABLE, 503);
    if (/duplicate key/.test(String((e as Error)?.message))) return bad("รหัสนี้ถูกใช้แล้ว · โหลดหน้าใหม่แล้วลองอีกครั้ง", 409);
    throw e;
  }
}
