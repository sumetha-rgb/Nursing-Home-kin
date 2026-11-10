"use client";
import { docDate, money } from "@/lib/billing";
import { bkkToday, thDateText } from "@/lib/servicePeriod";
import { can } from "@/lib/perms";
import { cashHandoff, taskHandoff } from "@/lib/handoff";
import type { ViewId } from "@/lib/nav";
import type { SessionUser } from "@/lib/roles";

/** ข้อมูลจาก lib/attention.ts (/api/clinic?op=home และ attention ใน /api/ops?op=insights) · มีเฉพาะเรื่องที่บัญชีนี้มีสิทธิ์ */
export type HomeData = {
  late?: { task: string; name: string }[]; review?: { shift: string; n: number }[]; alerts?: { n: number; oldest: number };
  bills?: { n: number; sum: number; oldest: string | null }; debt60?: { n: number; sum: number }; physio?: number; drafts?: number; courses?: number;
  unclosed?: { date: string; branch: string }[]; monthDue?: { no: string; name: string; due: string }[]; deposit?: { no: string; name: string; billed: boolean }[];
  stock?: { meds: number; supplies: number; central: number }; noRoom?: { name: string }[]; checkin?: { name: string; shift: string }[];
  rosterGap?: { n: number; first: string | null; soon: number; branches: number };
};
/** urgent = ด่วน (แดง) · top = ขึ้นก่อนทุกเรื่องเมื่อมีค้าง · open = ทำก่อนไปหน้านั้น (เปิดตัวกรอง/หน้าต่าง) */
/** short / meta = ชื่อสั้นและตัวเลขสำคัญ 1 อย่าง สำหรับแถบ "ต้องจัดการ" (การ์ดหน้าแรกใช้ title / detail เต็ม) */
/** brief = ข้อมูลสำคัญ 1 บรรทัดใต้ชื่อเรื่องในหน้างานวันนี้ (ชื่อคน ยอดเงิน วันที่) · detail = รายละเอียดเต็มตอนกดดู */
/** urgent = ด่วน ขึ้นกล่อง "ทำก่อน" (แดง) · warn = ควรทำเร็ว (ส้ม) · ไม่มีทั้งคู่ = ทำตามรอบงาน */
export type TodoItem = { key: string; title: string; short: string; meta?: string; brief?: string; n: number; unit: string; detail: string; cta: string; urgent?: boolean; warn?: boolean; top?: boolean; open?: () => void; view?: ViewId; href?: string };

/** ด้านของงาน (ใช้ทั้งหน้าแรกและแถบต้องจัดการ) · ตำแหน่งที่ไม่มีสิทธิ์ด้านนั้นจะไม่เห็นกล่อง */
export const TODO_AREAS = [
  { name: "การดูแลและทีม", keys: ["alerts", "late", "review", "gap", "checkin"] },
  { name: "การเงิน", keys: ["bills", "debt60", "unclosed", "monthDue", "drafts", "courses", "deposit", "physio"] },
  { name: "ห้อง ยา และคลัง", keys: ["room", "stock"] },
];
/** ปุ่มสั้นด้านขวาของแต่ละเรื่อง */
export const TODO_ACT: Record<string, string> = {
  alerts: "ดูรายการ", late: "ตามงาน", review: "ตรวจงาน", gap: "จัดเวร", checkin: "ดูเวร", bills: "รับชำระ", debt60: "ดูลูกหนี้", unclosed: "ปิดยอด",
  monthDue: "ออกใบ", drafts: "ตรวจยอด", courses: "ออกใบ", deposit: "ดูสัญญา", physio: "ใส่ราคา", room: "จัดห้อง", stock: "ห้องยา",
};

const namesOf = (xs: string[], k = 2) => (xs.length ? `${xs.slice(0, k).join(", ")}${xs.length > k ? ` และอีก ${xs.length - k} คน` : ""}` : undefined);
/** 2026-11-11 → 11 พ.ย. */
const dayText = (iso: string) => thDateText(iso).replace(/ \d{4}$/, "");
const ago = (min: number) => (min >= 1440 ? `${Math.floor(min / 1440)} วัน` : min >= 60 ? `${Math.floor(min / 60)} ชม.` : `${min} นาที`);

/** เรื่องที่ต้องจัดการ: ชุดเดียวกันทั้งการ์ดหน้าแรกและแถบ "ต้องจัดการ" · เรียงเรื่องค้างก่อน (ด่วนก่อน) เรื่องเรียบร้อยไว้ท้าย */
export function buildTodos(d: HomeData, user: SessionUser | null | undefined): TodoItem[] {
  const c: TodoItem[] = [];
  if (d.alerts) c.push({ key: "alerts", short: "ค่าผิดปกติค้าง", meta: d.alerts.n ? `นานสุด ${ago(d.alerts.oldest)}` : undefined, title: "ค่าสัญญาณชีพผิดปกติ ยังไม่มีคนรับทราบ", brief: d.alerts.n ? `ค้างนานสุด ${ago(d.alerts.oldest)}` : undefined, n: d.alerts.n, unit: "รายการ", detail: d.alerts.n ? `ค้างนานสุด ${ago(d.alerts.oldest)} · กดรับทราบที่ปุ่มแจ้งเตือนด้านบน` : "รับทราบครบแล้ว", cta: "ไปที่บันทึกสุขภาพ", urgent: true, top: true, view: "health_logs" });
  if (d.late) {
    const n = d.late.length, list = d.late.slice(0, 2).map((x) => `${x.task} (${x.name})`).join(", ");
    c.push({ key: "late", short: "งานเลยเวลา", title: "งานเลยเวลา", brief: n ? `${[...new Set(d.late.map((x) => x.name))].slice(0, 2).join(", ")}${n > 2 ? ` และอีก ${n - 2} งาน` : ""}` : undefined, n, unit: "งาน", detail: n ? `เลยเวลาเกิน 30 นาทียังไม่มีใครส่ง · ${list}${n > 2 ? ` และอีก ${n - 2} งาน` : ""}` : "งานวันนี้ส่งตรงเวลา", cta: "ไปตามงาน", urgent: true, top: true, open: () => taskHandoff.set("late"), view: "tasks" });
  }
  if (d.review) {
    const n = d.review.reduce((x, r) => x + r.n, 0), of = (s: string) => d.review!.find((r) => r.shift === s)?.n ?? 0;
    c.push({ key: "review", short: "งานรอตรวจ", title: "งานรอตรวจ", brief: n ? `กะเช้า ${of("กะเช้า")} · กะดึก ${of("กะดึก")}` : undefined, n, unit: "งาน", detail: n ? `พยาบาลส่งงานพร้อมรูปแล้ว รอให้ดาว · กะเช้า ${of("กะเช้า")} · กะดึก ${of("กะดึก")}` : "ตรวจงานที่ส่งมาครบแล้ว", cta: "ไปตรวจงาน", warn: true, open: () => taskHandoff.set("review"), view: "tasks" });
  }
  if (d.rosterGap) {
    // ด่วนเฉพาะเมื่อขาดเวรภายใน 3 วัน (วันนี้ถึงมะรืน) · ไกลกว่านั้น = ควรจัดล่วงหน้า
    const g = d.rosterGap, when = g.first ? `${g.first === bkkToday() ? "ขาดตั้งแต่วันนี้" : `ขาดวันแรก ${dayText(g.first)}`}${g.branches > 1 ? ` · ${g.branches} สาขา` : ""}` : undefined;
    c.push({ key: "gap", short: "ยังไม่จัดเวร", title: "วันที่ยังจัดเวรไม่ครบ", brief: g.n ? when : undefined, n: g.n, unit: "วัน", detail: g.n ? `${when} · วันนี้ถึงสิ้นเดือนยังไม่มีคนเข้าเวรเช้าหรือดึก ${g.n} วัน${g.soon ? ` (ใน 3 วันนี้ ${g.soon} วัน)` : ""}` : "จัดเวรครบถึงสิ้นเดือนแล้ว", cta: "ไปที่ตารางเวร", urgent: g.soon > 0, warn: true, view: "roster" });
  }
  if (d.checkin) c.push({ key: "checkin", short: "ยังไม่เช็คชื่อ", title: "ยังไม่เช็คชื่อเข้าเวร", brief: d.checkin.length ? `${d.checkin.slice(0, 2).map((x) => x.name).join(", ")}${d.checkin.length > 2 ? ` และอีก ${d.checkin.length - 2} คน` : ""}` : undefined, n: d.checkin.length, unit: "คน", detail: d.checkin.length ? `${d.checkin.slice(0, 3).map((x) => `${x.name} (เวร${x.shift})`).join(", ")}${d.checkin.length > 3 ? ` และอีก ${d.checkin.length - 3} คน` : ""} · เลยเวลาผ่อนผันแล้ว` : "ทุกคนในเวรเช็คชื่อแล้ว", cta: "ไปที่ตารางเวร", urgent: true, view: "roster" });
  if (d.bills) c.push({ key: "bills", short: "ใบค้างชำระ", meta: d.bills.n ? `${money(d.bills.sum)} บาท` : undefined, warn: true, title: "ใบแจ้งหนี้ค้างชำระ", brief: d.bills.n ? `รวม ${money(d.bills.sum)} บาท · เก่าสุด ${docDate(d.bills.oldest ?? "")}` : undefined, n: d.bills.n, unit: "ใบ", detail: d.bills.n ? `รวม ${money(d.bills.sum)} บาท · เก่าสุดออกเมื่อ ${docDate(d.bills.oldest ?? "")}` : "ไม่มีใบค้างชำระ", cta: "ไปรับชำระ", view: "billing" });
  if (d.debt60) c.push({ key: "debt60", short: "หนี้ค้างเกิน 60 วัน", meta: d.debt60.n ? `${money(d.debt60.sum)} บาท` : undefined, title: "ลูกหนี้ค้างเกิน 60 วัน", brief: d.debt60.n ? `รวม ${money(d.debt60.sum)} บาท` : undefined, n: d.debt60.n, unit: "ใบ", detail: d.debt60.n ? `รวม ${money(d.debt60.sum)} บาท · ส่งใบแจ้งยอดค้างชำระให้ญาติ` : "ไม่มีหนี้ค้างนาน", cta: "ไปที่ลูกหนี้", warn: true, view: "billing" });
  if (d.unclosed) {
    const days = [...new Set(d.unclosed.map((x) => x.date))];
    c.push({ key: "unclosed", short: "ยังไม่ปิดยอดเงิน", title: "ยังไม่ปิดยอดรายวัน", brief: days.length ? days.slice(0, 3).map((x) => docDate(x)).join(", ") : undefined, n: days.length, unit: "วัน", detail: days.length ? `มีรับเงินแล้วยังไม่นับเงินสดปิดยอด · ${days.slice(0, 3).map((x) => docDate(x)).join(", ")}${days.length > 3 ? ` และอีก ${days.length - 3} วัน` : ""}` : "ปิดยอดครบทุกวันแล้ว", cta: "ไปปิดยอด", warn: true, open: () => cashHandoff.set(), view: "billing" });
  }
  if (d.monthDue) {
    // รอบบิลนับตามวันเริ่มสัญญา · เลยวันครบรอบแล้ว = ด่วน · จะครบใน 7 วัน = ควรเตรียมออกใบ
    const m = d.monthDue, t = bkkToday(), late = m.filter((x) => x.due <= t).length, who = m.map((x) => `${x.name} (${x.due <= t ? "ครบแล้ว" : `ครบ ${dayText(x.due)}`})`);
    c.push({ key: "monthDue", short: "ครบรอบบิล", meta: m.length ? `ครบแล้ว ${late} · ใน 7 วัน ${m.length - late}` : undefined, title: "ครบรอบบิล ยังไม่ออกใบ", brief: m.length ? (m.length === 1 ? who[0] : `${who[0]} และอีก ${m.length - 1} สัญญา`) : undefined, n: m.length, unit: "สัญญา", detail: m.length ? `ครบรอบตามวันเริ่มสัญญาแล้ว ${late} สัญญา · จะครบใน 7 วัน ${m.length - late} สัญญา · ${who.slice(0, 3).join(", ")}${m.length > 3 ? ` และอีก ${m.length - 3} สัญญา` : ""}` : "ออกใบครบทุกรอบบิลแล้ว", cta: "ไปออกใบรายเดือน", urgent: late > 0, warn: true, view: "billing" });
  }
  if (d.drafts !== undefined) c.push({ key: "drafts", short: "ใบรอตรวจยอด", title: "ใบแจ้งหนี้รอตรวจสอบยอด", n: d.drafts, unit: "ใบ", detail: d.drafts ? "ออกจากสัญญาอัตโนมัติ · ตรวจรายการแล้วกด ยืนยันยอด จึงรับชำระได้" : "ไม่มีใบรอตรวจสอบ", cta: "ไปตรวจยอด", view: "billing" });
  if (d.courses !== undefined) c.push({ key: "courses", short: "คอร์สรอออกใบ", title: "คอร์สกายภาพรอออกใบ", n: d.courses, unit: "คอร์ส", detail: d.courses ? "ซื้อคอร์สแล้วแต่ยังไม่ออกใบแจ้งหนี้ · นักกายภาพยังใช้คอร์สไม่ได้จนกว่าจะออกใบ" : "ไม่มีคอร์สรอออกใบ", cta: "ไปออกใบ", view: "billing" });
  if (d.deposit) {
    const nb = d.deposit.filter((x) => !x.billed).length, first = d.deposit[0];
    c.push({ key: "deposit", short: "รอชำระมัดจำ", title: "สัญญารอชำระมัดจำ", brief: first ? `${first.name}${d.deposit.length > 1 ? ` และอีก ${d.deposit.length - 1} สัญญา` : ""}` : undefined, n: d.deposit.length, unit: "สัญญา", detail: first ? `${first.no} · ${first.name}${d.deposit.length > 1 ? ` และอีก ${d.deposit.length - 1} สัญญา` : ""}${nb ? ` · ยังไม่มีใบแจ้งหนี้ ${nb} สัญญา` : ""}` : "ไม่มีสัญญารอชำระ", cta: nb ? "ออกใบแจ้งหนี้" : "ไปที่สัญญาบริการ", view: "contracts" });
  }
  if (d.physio !== undefined) c.push({ key: "physio", short: "กายภาพรอราคา", title: "กายภาพรอกำหนดราคา", n: d.physio, unit: "ครั้ง", detail: d.physio ? "ทำไปแล้วโดยยังไม่มีคอร์ส · ใส่ราคาแล้วดึงเข้าใบแจ้งหนี้" : "ไม่มีรายการรอราคา", cta: "ไปที่ใบแจ้งหนี้และใบเสร็จ", view: "billing" });
  if (d.noRoom) { const nr = d.noRoom.map((x) => x.name); c.push({ key: "room", short: "รอจัดห้อง", title: "ผู้รับบริการที่ยังไม่มีห้อง", brief: namesOf(nr), n: nr.length, unit: "คน", detail: nr.length ? `${namesOf(nr, 4)} · จัดห้องและเตียงให้ (คนที่จองห้องไว้แล้วอยู่ในเรื่องรอชำระมัดจำ)` : "ทุกคนมีห้องแล้ว", cta: "ไปที่ห้องพักและเตียง", view: "rooms" }); }
  if (d.stock) {
    const s = d.stock, n = s.meds + s.supplies + s.central;
    const page = s.meds ? "inventory" : s.supplies ? "supplies" : "central";
    c.push({ key: "stock", short: "ยาใกล้หมด", meta: `ยา ${d.stock.meds + d.stock.central} · เวชภัณฑ์ ${d.stock.supplies}`, title: "ยาและเวชภัณฑ์ใกล้หมด", brief: n ? [s.meds + s.central ? `ยา ${s.meds + s.central}` : "", s.supplies ? `เวชภัณฑ์ ${s.supplies}` : ""].filter(Boolean).join(" · ") : undefined, n, unit: "รายการ", detail: n ? [s.meds ? `ยาผู้ป่วย ${s.meds}` : "", s.supplies ? `เวชภัณฑ์ ${s.supplies}` : "", s.central ? `คลังยากลาง ${s.central}` : ""].filter(Boolean).join(" · ") : "ยาและเวชภัณฑ์พอใช้", cta: "ไปที่ห้องยา", href: can(user, "app.pharmacy") ? `/pharmacy?page=${page}` : undefined });
  }
  return c.sort((a, b) => Number(b.n > 0) - Number(a.n > 0) || Number(!!b.top && b.n > 0) - Number(!!a.top && a.n > 0) || Number(!!b.urgent) - Number(!!a.urgent) || Number(!!b.warn) - Number(!!a.warn));
}

/** ไปทำเรื่องนั้น (หน้าแรกและแถบต้องจัดการใช้เหมือนกัน) */
export function runTodo(t: TodoItem, go: (v: ViewId) => void) {
  if (t.href) { window.location.href = t.href; return; }
  if (t.n) t.open?.();
  if (t.view) go(t.view);
}

/**
 * แถบ "ต้องจัดการ" (ภาพรวมและรายงาน)
 *  ด่วน = แถวเต็มบนสุด มีชื่อคน/รายละเอียดและปุ่มไปทำ · ที่เหลือแยก 3 ด้าน (การดูแลและทีม / การเงิน / ห้อง ยา และคลัง)
 *  ตัวเลขมีหน่วยทุกตัว · ด้านที่ไม่มีเรื่องค้างย่อเหลือ ✓ · เรื่องที่เรียบร้อยรวมเป็นบรรทัดเดียว
 */
export function AttentionStrip({ items, go }: { items: TodoItem[]; go: (v: ViewId) => void }) {
  const open = items.filter((x) => x.n), done = items.filter((x) => !x.n);
  const urgent = open.filter((x) => x.urgent);
  const areas = TODO_AREAS.map((a) => ({ name: a.name, all: items.filter((x) => a.keys.includes(x.key)) })).filter((a) => a.all.length)
    .map((a) => ({ ...a, open: a.all.filter((x) => x.n && !x.urgent), urgentHere: a.all.filter((x) => x.n && x.urgent).length }));
  const act = (x: TodoItem) => (x.key === "deposit" && x.cta === "ออกใบแจ้งหนี้" ? "ออกใบ" : TODO_ACT[x.key] ?? x.cta);
  return (
    <section className={`attn ${open.length ? "" : "is-clear"}`} aria-label="ต้องจัดการ">
      <p className="attn-h"><b>{open.length ? `ต้องจัดการ ${open.length} เรื่อง` : "ไม่มีเรื่องค้าง"}</b>
        {open.length > 0 && <span>{urgent.length > 0 && <em>ด่วน {urgent.length}</em>}{urgent.length > 0 && " · "}กดเพื่อไปจัดการ</span>}</p>
      {urgent.length > 0 && <div className="attn-urgent" aria-label="เรื่องด่วน">
        {urgent.map((x) => (
          <button key={x.key} type="button" className="attn-row" title={x.detail} onClick={() => runTodo(x, go)}>
            <b>{x.n}<i>{x.unit}</i></b>
            <span>{x.title}{(x.brief ?? x.meta) && <small>{x.brief ?? x.meta}</small>}<em>{act(x)} ›</em></span>
          </button>
        ))}
      </div>}
      {/* แสดงเฉพาะด้านที่มีเรื่องค้าง · ความกว้างตามจำนวนเรื่อง (เรื่องของด้านเดียวกันเรียงต่อกันในแถว) */}
      {areas.some((a) => a.open.length) && <div className="attn-cols">{areas.filter((a) => a.open.length).map((a) => (
        <section key={a.name} className="attn-col" style={{ flex: `${a.open.length} 1 ${a.open.length * 176}px` }} aria-label={a.name}>
          <h4>{a.name}<span>{a.open.length}</span></h4>
          <div className="attn-grid">{a.open.map((x) => (
            <button key={x.key} type="button" title={`${x.title} · ${x.detail}`} className={`attn-i ${x.warn ? "warn" : ""}`} onClick={() => runTodo(x, go)}>
              <b>{x.n}<i>{x.unit}</i></b><span>{x.short}{(x.brief ?? x.meta) && <small>{x.brief ?? x.meta}</small>}</span>
            </button>
          ))}</div>
        </section>
      ))}</div>}
      {done.length > 0 && <p className="attn-done"><span>✓ เรียบร้อย:</span> {done.map((x) => x.short).join(" · ")}</p>}
    </section>
  );
}
