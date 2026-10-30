import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { currentUser, forbidden, unauthorized } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { can } from "@/lib/perms";
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
        const pricer = isManager(me); // ราคาเดียวทุกสาขา: ผู้จัดการสาขาหรือหัวหน้าพยาบาลแก้ = มีผลทุกสาขา (บันทึกในประวัติการแก้ไข)
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
      default:
        return bad("unknown op");
    }
  } catch (e) {
    console.error("[api/pharmstock]", e);
    return bad("database error", 500);
  }
}
