import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUser, forbidden, unauthorized } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { can } from "@/lib/perms";
import type { SessionUser } from "@/lib/roles";
import { NOTE_KINDS } from "@/lib/clinic";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

/**
 * งานพยาบาลและกายภาพรายบุคคล (เห็นเฉพาะสาขาตัวเอง ยกเว้นผู้บริหาร)
 *  GET  ?op=resident&id=…           ประเมินแรกรับ บันทึกทางคลินิก คอร์สกายภาพ เวชภัณฑ์ที่เบิก
 *  GET  ?op=supplies                 รายการเวชภัณฑ์ในคลังของสาขา
 *  GET  ?op=unbilled&resident=…      เวชภัณฑ์และคอร์สกายภาพที่ยังไม่ออกใบแจ้งหนี้ (หน้าการเงิน)
 *  GET  ?op=doc_file&id=…          ไฟล์แนบของเอกสารระเบียบ
 *  POST { op: "doc_file", id, name, data }   แนบ/เปลี่ยนไฟล์ (data URL ไม่เกิน 4 MB · รูปหรือ PDF)
 *  GET  ?op=doc_settings             ข้อความในเอกสาร (เช่น ข้อสัญญา)
 *  POST { op: "admission", residentId, data }             บันทึกประวัติและประเมินแรกรับ
 *  POST { op: "note", residentId, kind, title?, body?, data?, status? }   เพิ่มบันทึก
 *  POST { op: "note_status", id, status }                  ปิด/เปิดปัญหาใน Problem list
 *  POST { op: "note_delete", id }                          ลบบันทึก (ผู้เขียน หรือผู้มีสิทธิ์ผู้รับบริการ)
 *  POST { op: "course", residentId, name, total, price? }   ซื้อคอร์สกายภาพ
 *  POST { op: "course_use", courseId, body?, data? }        ใช้คอร์ส 1 ครั้ง + Progress note
 *  POST { op: "supply_item", id?, name, unit, price, stock } เพิ่ม/แก้เวชภัณฑ์ในคลัง
 *  POST { op: "supply_issue", residentId, itemId, qty }     เบิกเวชภัณฑ์ให้ผู้รับบริการ (ตัดสต็อก)
 *  POST { op: "supply_bill", ids, courseIds?, invoiceId }   ทำเครื่องหมายว่าออกใบแจ้งหนี้แล้ว
 *  POST { op: "doc_settings", key, value }                 ตั้งข้อความในเอกสาร (ผู้จัดการขึ้นไป)
 */
const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status });
const scoped = (me: SessionUser) => me.role !== "Global Admin";
const canRead = (me: SessionUser) => can(me, "residents") || can(me, "health_logs") || can(me, "app.staff") || can(me, "careplan");
const canManage = (me: SessionUser) => can(me, "residents");
const TH_AT = (col: string) => `to_char(${col} AT TIME ZONE 'Asia/Bangkok', 'DD/MM/') || (extract(year FROM ${col} AT TIME ZONE 'Asia/Bangkok')::int + 543) || to_char(${col} AT TIME ZONE 'Asia/Bangkok', ' HH24:MI')`;
const text = (v: unknown, max = 2000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

async function residentOf(me: SessionUser, id: string) {
  const [r] = (await sql`SELECT id, full_name, branch_name FROM residents WHERE id = ${id}`) as { id: string; full_name: string; branch_name: string }[];
  if (!r) return { res: bad("ไม่พบผู้รับบริการ", 404) };
  if (scoped(me) && r.branch_name !== me.branch) return { res: forbidden("ดูได้เฉพาะผู้รับบริการในสาขาของคุณ") };
  return { r };
}

export async function GET(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const q = req.nextUrl.searchParams;
  try {
    switch (q.get("op")) {
      case "resident": {
        if (!canRead(me)) return forbidden();
        const o = await residentOf(me, q.get("id") ?? "");
        if (!o.r) return o.res;
        const id = o.r.id;
        const [adm] = (await sql(`SELECT data, assessed_by, ${TH_AT("updated_at")} AS at FROM resident_admissions WHERE resident_id = $1`, [id])) as Record<string, unknown>[];
        const notes = await sql(`SELECT id, kind, title, body, data, status, author, ${TH_AT("created_at")} AS at FROM clinical_notes WHERE resident_id = $1 ORDER BY created_at DESC LIMIT 300`, [id]);
        const courses = await sql(`SELECT id, name, total, used, price::float, status, created_by, invoice_id, ${TH_AT("created_at")} AS at FROM physio_courses WHERE resident_id = $1 ORDER BY created_at DESC`, [id]);
        const supplies = await sql(`SELECT id, item_name, unit, qty, price::float, issued_by, invoice_id, ${TH_AT("created_at")} AS at FROM supply_issues WHERE resident_id = $1 ORDER BY created_at DESC LIMIT 200`, [id]);
        return NextResponse.json({ admission: adm ?? null, notes, courses, supplies });
      }
      case "supplies": {
        if (!canRead(me)) return forbidden();
        const rows = scoped(me)
          ? await sql`SELECT id, branch_name, name, unit, price::float, stock FROM supply_items WHERE branch_name = ${me.branch} ORDER BY name`
          : await sql`SELECT id, branch_name, name, unit, price::float, stock FROM supply_items ORDER BY branch_name, name`;
        return NextResponse.json({ items: rows });
      }
      case "unbilled": {
        if (!can(me, "billing") && !can(me, "contracts")) return forbidden();
        const o = await residentOf(me, q.get("resident") ?? "");
        if (!o.r) return o.res;
        const rows = await sql(`SELECT id, item_name, unit, qty, price::float, ${TH_AT("created_at")} AS at FROM supply_issues WHERE resident_id = $1 AND invoice_id IS NULL ORDER BY created_at`, [o.r.id]);
        const courses = await sql(`SELECT id, name, total, price::float, ${TH_AT("created_at")} AS at FROM physio_courses WHERE resident_id = $1 AND invoice_id IS NULL AND coalesce(price, 0) > 0 ORDER BY created_at`, [o.r.id]);
        // ยาจากคลังยากลางที่เบิกให้ผู้ป่วย (มีราคาขาย) ยังไม่เรียกเก็บ
        const meds = await sql(`SELECT m.id, d.name, d.unit, (-m.delta)::float AS qty, m.price::float, ${TH_AT("m.created_at")} AS at FROM stock_moves m JOIN stock_drugs d ON d.id = m.drug_id
          WHERE m.resident_id = $1 AND m.reason = 'เบิกให้ผู้ป่วย' AND m.invoice_id IS NULL AND m.price IS NOT NULL ORDER BY m.created_at`, [o.r.id]);
        return NextResponse.json({ items: rows, courses, meds });
      }
      case "doc_file": {
        if (!can(me, "official-docs")) return forbidden();
        const [d] = (await sql`SELECT file_name, file_data, branch_name FROM official_documents WHERE id = ${q.get("id") ?? ""}`) as Record<string, string>[];
        if (!d?.file_data) return bad("ยังไม่มีไฟล์แนบ", 404);
        if (scoped(me) && d.branch_name && d.branch_name !== me.branch) return forbidden();
        return NextResponse.json({ name: d.file_name, data: d.file_data });
      }
      case "doc_settings": {
        const rows = (await sql`SELECT key, value FROM doc_settings`) as { key: string; value: string }[];
        return NextResponse.json({ settings: Object.fromEntries(rows.map((r) => [r.key, r.value])) });
      }
      default:
        return bad("unknown op");
    }
  } catch (e) {
    console.error("[api/clinic]", e);
    return bad("database error", 500);
  }
}

export async function POST(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    switch (b.op) {
      case "admission": {
        if (!canRead(me)) return forbidden();
        const o = await residentOf(me, String(b.residentId ?? ""));
        if (!o.r) return o.res;
        const data = JSON.stringify(obj(b.data)).slice(0, 60000);
        await sql`INSERT INTO resident_admissions (resident_id, branch_name, data, assessed_by, updated_at) VALUES (${o.r.id}, ${o.r.branch_name}, ${data}::jsonb, ${me.name}, now())
                  ON CONFLICT (resident_id) DO UPDATE SET data = EXCLUDED.data, assessed_by = EXCLUDED.assessed_by, updated_at = now()`;
        await audit(req, me, [{ area: "admissions", action: "update", recordId: o.r.id, summary: `ประวัติและประเมินแรกรับ · ${o.r.full_name}`, branch: o.r.branch_name }]);
        return NextResponse.json({ ok: true });
      }
      case "note": {
        if (!canRead(me)) return forbidden();
        const kind = String(b.kind ?? "");
        if (!(NOTE_KINDS as readonly string[]).includes(kind)) return bad("ประเภทบันทึกไม่ถูกต้อง");
        const o = await residentOf(me, String(b.residentId ?? ""));
        if (!o.r) return o.res;
        const title = text(b.title, 200), body = text(b.body, 4000);
        if (!title && !body) return bad("กรุณากรอกรายละเอียดบันทึก");
        const id = randomUUID();
        await sql`INSERT INTO clinical_notes (id, resident_id, resident_name, branch_name, kind, title, body, data, status, author)
                  VALUES (${id}, ${o.r.id}, ${o.r.full_name}, ${o.r.branch_name}, ${kind}, ${title || null}, ${body || null}, ${JSON.stringify(obj(b.data))}::jsonb, ${text(b.status, 40) || null}, ${me.name})`;
        await audit(req, me, [{ area: "clinical", action: "create", recordId: id, summary: `${kind} · ${o.r.full_name}${title ? ` · ${title}` : ""}`, branch: o.r.branch_name }]);
        return NextResponse.json({ ok: true, id });
      }
      case "note_status": case "note_delete": {
        if (!canRead(me)) return forbidden();
        const [n] = (await sql`SELECT id, resident_name, branch_name, author, kind FROM clinical_notes WHERE id = ${String(b.id ?? "")}`) as Record<string, string>[];
        if (!n) return bad("ไม่พบบันทึก", 404);
        if (scoped(me) && n.branch_name !== me.branch) return forbidden();
        if (b.op === "note_delete") {
          if (n.author !== me.name && !canManage(me)) return forbidden("ลบได้เฉพาะบันทึกที่ตัวเองเขียน");
          await sql`DELETE FROM clinical_notes WHERE id = ${n.id}`;
          await audit(req, me, [{ area: "clinical", action: "delete", recordId: n.id, summary: `${n.kind} · ${n.resident_name}`, branch: n.branch_name }]);
        } else {
          await sql`UPDATE clinical_notes SET status = ${text(b.status, 40)}, updated_at = now() WHERE id = ${n.id}`;
        }
        return NextResponse.json({ ok: true });
      }
      case "course": {
        if (!canManage(me) && !can(me, "billing")) return forbidden("บัญชีนี้ไม่มีสิทธิ์ขายคอร์ส");
        const o = await residentOf(me, String(b.residentId ?? ""));
        if (!o.r) return o.res;
        const total = Math.floor(Number(b.total)), name = text(b.name, 120), price = Number(b.price) || 0;
        if (!name || !(total > 0 && total <= 500)) return bad("กรุณากรอกชื่อคอร์สและจำนวนครั้ง (1–500)");
        const id = randomUUID();
        await sql`INSERT INTO physio_courses (id, resident_id, resident_name, branch_name, name, total, price, created_by) VALUES (${id}, ${o.r.id}, ${o.r.full_name}, ${o.r.branch_name}, ${name}, ${total}, ${price}, ${me.name})`;
        await audit(req, me, [{ area: "physio", action: "create", recordId: id, summary: `คอร์ส ${name} ${total} ครั้ง · ${o.r.full_name}`, branch: o.r.branch_name }]);
        return NextResponse.json({ ok: true, id });
      }
      case "course_use": {
        if (!canRead(me)) return forbidden();
        const [c] = (await sql`SELECT * FROM physio_courses WHERE id = ${String(b.courseId ?? "")}`) as Record<string, string & number>[];
        if (!c) return bad("ไม่พบคอร์ส", 404);
        if (scoped(me) && c.branch_name !== me.branch) return forbidden();
        // ตัดครั้งในคำสั่งเดียว กันสองเครื่องกดพร้อมกันจนเกินจำนวน
        const done = (await sql`UPDATE physio_courses SET used = used + 1, status = CASE WHEN used + 1 >= total THEN 'ครบแล้ว' ELSE status END
                                WHERE id = ${c.id} AND used < total RETURNING used, total`) as { used: number; total: number }[];
        if (!done.length) return bad("คอร์สนี้ใช้ครบจำนวนครั้งแล้ว", 409);
        const id = randomUUID();
        await sql`INSERT INTO clinical_notes (id, resident_id, resident_name, branch_name, kind, title, body, data, author)
                  VALUES (${id}, ${c.resident_id}, ${c.resident_name}, ${c.branch_name}, 'physio', ${`${c.name} ครั้งที่ ${done[0].used}/${done[0].total}`}, ${text(b.body, 4000) || null},
                          ${JSON.stringify({ ...obj(b.data), course_id: c.id, session: done[0].used })}::jsonb, ${me.name})`;
        await audit(req, me, [{ area: "physio", action: "update", recordId: c.id, summary: `ใช้คอร์ส ${c.name} ครั้งที่ ${done[0].used}/${done[0].total} · ${c.resident_name}`, branch: c.branch_name }]);
        return NextResponse.json({ ok: true, used: done[0].used, total: done[0].total });
      }
      case "supply_item": {
        if (!canManage(me)) return forbidden("บัญชีนี้ไม่มีสิทธิ์จัดการคลังเวชภัณฑ์");
        const name = text(b.name, 120);
        if (!name) return bad("กรุณากรอกชื่อเวชภัณฑ์");
        const price = Math.max(0, Number(b.price) || 0), stock = Math.max(0, Math.floor(Number(b.stock) || 0)), unit = text(b.unit, 30) || "ชิ้น";
        const branch = scoped(me) ? me.branch : text(b.branch, 120) || me.branch;
        const id = typeof b.id === "string" && b.id ? b.id : randomUUID();
        if (b.id) {
          const [it] = (await sql`SELECT branch_name FROM supply_items WHERE id = ${id}`) as { branch_name: string }[];
          if (!it) return bad("ไม่พบรายการ", 404);
          if (scoped(me) && it.branch_name !== me.branch) return forbidden();
          await sql`UPDATE supply_items SET name = ${name}, unit = ${unit}, price = ${price}, stock = ${stock} WHERE id = ${id}`;
        } else {
          await sql`INSERT INTO supply_items (id, branch_name, name, unit, price, stock) VALUES (${id}, ${branch}, ${name}, ${unit}, ${price}, ${stock})`;
        }
        await audit(req, me, [{ area: "supplies", action: b.id ? "update" : "create", recordId: id, summary: `เวชภัณฑ์ ${name} คงเหลือ ${stock} ${unit}`, branch }]);
        return NextResponse.json({ ok: true, id });
      }
      case "supply_issue": {
        if (!canRead(me)) return forbidden();
        const o = await residentOf(me, String(b.residentId ?? ""));
        if (!o.r) return o.res;
        const qty = Math.floor(Number(b.qty));
        if (!(qty > 0 && qty <= 1000)) return bad("กรุณาระบุจำนวนที่เบิก");
        // ตัดสต็อกในคำสั่งเดียว: ของไม่พอ = ไม่ตัด (กันสองเครื่องเบิกพร้อมกันจนติดลบ)
        const left = (await sql(`UPDATE supply_items SET stock = stock - $1 WHERE id = $2 AND stock >= $1 ${scoped(me) ? "AND branch_name = $3" : ""}
                                RETURNING id, name, unit, price::float, stock, branch_name`, scoped(me) ? [qty, String(b.itemId ?? ""), me.branch] : [qty, String(b.itemId ?? "")])) as { id: string; name: string; unit: string; price: number; stock: number; branch_name: string }[];
        if (!left.length) return bad("เวชภัณฑ์ในคลังไม่พอ หรือไม่พบรายการ", 409);
        const it = left[0];
        const id = randomUUID();
        await sql`INSERT INTO supply_issues (id, branch_name, resident_id, resident_name, item_id, item_name, unit, qty, price, issued_by)
                  VALUES (${id}, ${o.r.branch_name}, ${o.r.id}, ${o.r.full_name}, ${it.id}, ${it.name}, ${it.unit}, ${qty}, ${it.price}, ${me.name})`;
        await audit(req, me, [{ area: "supplies", action: "update", recordId: id, summary: `เบิก ${it.name} ${qty} ${it.unit} · ${o.r.full_name}`, branch: o.r.branch_name }]);
        return NextResponse.json({ ok: true, id, stock: it.stock });
      }
      case "supply_bill": {
        if (!can(me, "billing") && !can(me, "contracts")) return forbidden();
        const ids = (Array.isArray(b.ids) ? b.ids : []).map(String).slice(0, 200);
        const cids = (Array.isArray(b.courseIds) ? b.courseIds : []).map(String).slice(0, 50);
        if (cids.length) await sql(`UPDATE physio_courses SET invoice_id = $1 WHERE id = ANY($2) AND invoice_id IS NULL ${scoped(me) ? "AND branch_name = $3" : ""}`,
          scoped(me) ? [String(b.invoiceId ?? ""), cids, me.branch] : [String(b.invoiceId ?? ""), cids]);
        const mids = (Array.isArray(b.medIds) ? b.medIds : []).map(String).slice(0, 200);
        if (mids.length) await sql(`UPDATE stock_moves SET invoice_id = $1 WHERE id = ANY($2) AND invoice_id IS NULL ${scoped(me) ? "AND branch_name = $3" : ""}`,
          scoped(me) ? [String(b.invoiceId ?? ""), mids, me.branch] : [String(b.invoiceId ?? ""), mids]);
        if (!ids.length) return NextResponse.json({ ok: true });
        await sql(`UPDATE supply_issues SET invoice_id = $1 WHERE id = ANY($2) AND invoice_id IS NULL ${scoped(me) ? "AND branch_name = $3" : ""}`,
          scoped(me) ? [String(b.invoiceId ?? ""), ids, me.branch] : [String(b.invoiceId ?? ""), ids]);
        return NextResponse.json({ ok: true });
      }
      case "doc_file": {
        if (!can(me, "official-docs")) return forbidden();
        const data = typeof b.data === "string" ? b.data : "";
        if (!/^data:(image\/(png|jpeg|webp)|application\/pdf);base64,/.test(data) || data.length > 5_600_000) return bad("แนบได้เฉพาะรูปหรือ PDF ขนาดไม่เกิน 4 MB");
        const [d] = (await sql`SELECT id, title, branch_name FROM official_documents WHERE id = ${String(b.id ?? "")}`) as Record<string, string>[];
        if (!d) return bad("ไม่พบเอกสาร", 404);
        if (scoped(me) && d.branch_name && d.branch_name !== me.branch) return forbidden();
        await sql`UPDATE official_documents SET file_name = ${text(b.name, 200) || "ไฟล์แนบ"}, file_data = ${data}, updated_at = now() WHERE id = ${d.id}`;
        await audit(req, me, [{ area: "docs", action: "update", recordId: d.id, summary: `แนบไฟล์ · ${d.title}`, branch: d.branch_name }]);
        return NextResponse.json({ ok: true });
      }
      case "doc_settings": {
        if (me.role !== "Global Admin" && me.role !== "Branch Admin") return forbidden("ตั้งข้อความเอกสารได้เฉพาะผู้จัดการขึ้นไป");
        const key = text(b.key, 60);
        if (!/^[a-z_]+$/.test(key)) return bad("ชื่อการตั้งค่าไม่ถูกต้อง");
        const value = typeof b.value === "string" ? b.value.slice(0, 20000) : "";
        await sql`INSERT INTO doc_settings (key, value, updated_by, updated_at) VALUES (${key}, ${value}, ${me.name}, now())
                  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
        await audit(req, me, [{ area: "doc_settings", action: "update", recordId: key, summary: `ข้อความเอกสาร · ${key}`, branch: null }]);
        return NextResponse.json({ ok: true });
      }
      default:
        return bad("unknown op");
    }
  } catch (e) {
    console.error("[api/clinic]", e);
    return bad("database error", 500);
  }
}
