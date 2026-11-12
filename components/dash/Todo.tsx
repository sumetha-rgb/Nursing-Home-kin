"use client";
// (ยอดเงินในรายการเตือนไม่มีทศนิยม · วันที่แบบสั้น "30 ต.ค.")
import { bkkToday, thDateText } from "@/lib/servicePeriod";
import { can } from "@/lib/perms";
import { cashHandoff, taskHandoff } from "@/lib/handoff";
import type { ViewId } from "@/lib/nav";
import type { SessionUser } from "@/lib/roles";
import { wantStaffFilter } from "@/lib/staffIntent";

/** ข้อมูลจาก lib/attention.ts (/api/clinic?op=home และ attention ใน /api/ops?op=insights) · มีเฉพาะเรื่องที่บัญชีนี้มีสิทธิ์ */
export type HomeData = {
  late?: { task: string; name: string }[]; review?: { shift: string; n: number }[]; alerts?: { n: number; oldest: number };
  bills?: { n: number; sum: number; oldest: string | null }; debt60?: { n: number; sum: number }; physio?: number; drafts?: number; courses?: number;
  unclosed?: { date: string; branch: string }[]; monthDue?: { no: string; name: string; due: string }[]; deposit?: { no: string; name: string; billed: boolean }[];
  stock?: { meds: number; supplies: number; central: number }; noRoom?: { name: string }[]; checkin?: { name: string; shift: string }[];
  rosterGap?: { n: number; first: string | null; soon: number; branches: number };
  /** คอร์สกายภาพที่ยังไม่มีผู้รับผิดชอบ (คนที่มีสิทธิ์จ่ายเคส) */
  physioOpen?: { name: string }[];
  /** เมื่อวานมีนัดกายภาพแต่ไม่มีบันทึก */
  physioMissed?: { name: string; who: string }[];
  /** คอร์สกายภาพเหลือ 1–2 ครั้ง */
  physioLow?: { name: string; left: number }[];
  /** คนสมัครใช้งานเองที่รออนุมัติ (ผู้จัดการสาขา/ผู้บริหาร) · days = รอมากี่วัน */
  signups?: { name: string; branch: string; days: number }[];
  /** นักกายภาพขอคนแทน (ยังไม่มีใครจัด) */
  physioReq?: { name: string; date: string; who: string; reason: string }[];
};
/** urgent = ด่วน (แดง) · top = ขึ้นก่อนทุกเรื่องเมื่อมีค้าง · open = ทำก่อนไปหน้านั้น (เปิดตัวกรอง/หน้าต่าง) */
/** short / meta = ชื่อสั้นและตัวเลขสำคัญ 1 อย่าง สำหรับแถบ "ต้องจัดการ" (การ์ดหน้าแรกใช้ title / detail เต็ม) */
/** brief = ข้อมูลสำคัญ 1 บรรทัดใต้ชื่อเรื่องในหน้างานวันนี้ (ชื่อคน ยอดเงิน วันที่) · detail = รายละเอียดเต็มตอนกดดู */
/** urgent = ด่วน ขึ้นกล่อง "ทำก่อน" (แดง) · warn = ควรทำเร็ว (ส้ม) · ไม่มีทั้งคู่ = ทำตามรอบงาน */
/** hot = ข้อความใต้ชื่อเรื่องเป็นสีแดง (ค้างนานผิดปกติ) */
export type TodoItem = { key: string; title: string; short: string; meta?: string; brief?: string; hot?: boolean; n: number; unit: string; detail: string; cta: string; urgent?: boolean; warn?: boolean; top?: boolean; open?: () => void; view?: ViewId; href?: string };

/** ด้านของงาน (ใช้ทั้งหน้าแรกและแถบต้องจัดการ) · ตำแหน่งที่ไม่มีสิทธิ์ด้านนั้นจะไม่เห็นกล่อง */
export const TODO_AREAS = [
  { name: "การดูแลและทีม", keys: ["alerts", "late", "review", "gap", "checkin", "signup", "physioReq", "physioCase", "physioMissed"] },
  { name: "การเงิน", keys: ["bills", "debt60", "unclosed", "monthDue", "drafts", "courses", "deposit", "physio", "physioLow"] },
  { name: "ห้อง ยา และคลัง", keys: ["room", "stock"] },
];
/** เรื่องด่วนด้านความปลอดภัยผู้รับบริการ (ขึ้นก่อนเรื่องด่วนด้านงานเอกสาร/เงิน) */
export const SAFETY_KEYS = ["alerts", "late", "checkin"];
/** ปุ่มสั้นด้านขวาของแต่ละเรื่อง */
export const TODO_ACT: Record<string, string> = {
  alerts: "ดูรายการ", signup: "อนุมัติ", physioCase: "จ่ายเคส", physioMissed: "ดูงาน", physioReq: "จัดคนแทน", physioLow: "เสนอต่อ", late: "ตามงาน", review: "ตรวจงาน", gap: "จัดเวร", checkin: "ดูเวร", bills: "รับชำระ", debt60: "ดูลูกหนี้", unclosed: "ปิดยอด",
  monthDue: "ออกใบ", drafts: "ตรวจยอด", courses: "ออกใบ", deposit: "ดูสัญญา", physio: "ใส่ราคา", room: "จัดห้อง", stock: "ห้องยา",
};

/** พรุ่งนี้ (YYYY-MM-DD เวลาไทย) · คำขอคนแทนของวันนี้/พรุ่งนี้ = ด่วน */
const bkkTodayPlus1 = () => new Date(Date.now() + 7 * 36e5 + 864e5).toISOString().slice(0, 10);
const namesOf = (xs: string[], k = 2) => (xs.length ? `${xs.slice(0, k).join(", ")}${xs.length > k ? ` และอีก ${xs.length - k} คน` : ""}` : undefined);
/** 2026-11-11 → 11 พ.ย. */
const dayText = (iso: string) => thDateText(iso).replace(/ \d{4}$/, "");
/** ยอดเงินในรายการเตือน: ไม่มีทศนิยม (ยอดละเอียดดูในหน้าการเงิน) */
const baht = (v: number) => Math.round(v).toLocaleString("en-US");
const ago = (min: number) => (min >= 1440 ? `${Math.floor(min / 1440)} วัน` : min >= 60 ? `${Math.floor(min / 60)} ชม.` : `${min} นาที`);

/** เรื่องที่ต้องจัดการ: ชุดเดียวกันทั้งการ์ดหน้าแรกและแถบ "ต้องจัดการ" · เรียงเรื่องค้างก่อน (ด่วนก่อน) เรื่องเรียบร้อยไว้ท้าย */
export function buildTodos(d: HomeData, user: SessionUser | null | undefined): TodoItem[] {
  const c: TodoItem[] = [];
  if (d.alerts) c.push({ key: "alerts", short: "ค่าผิดปกติค้าง", meta: d.alerts.n ? `นานสุด ${ago(d.alerts.oldest)}` : undefined, title: "ค่าสัญญาณชีพผิดปกติ ยังไม่มีคนรับทราบ", brief: d.alerts.n ? `ค้างนานสุด ${ago(d.alerts.oldest)}` : undefined, hot: d.alerts.n > 0 && d.alerts.oldest >= 60, n: d.alerts.n, unit: "รายการ", detail: d.alerts.n ? `ค้างนานสุด ${ago(d.alerts.oldest)} · กดรับทราบที่ปุ่มแจ้งเตือนด้านบน` : "รับทราบครบแล้ว", cta: "ไปที่บันทึกสุขภาพ", urgent: true, top: true, view: "health_logs" });
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
  if (d.bills) c.push({ key: "bills", short: "ใบค้างชำระ", meta: d.bills.n ? `${baht(d.bills.sum)} บาท` : undefined, warn: true, title: "ใบแจ้งหนี้ค้างชำระ", brief: d.bills.n ? `รวม ${baht(d.bills.sum)} บาท · เก่าสุด ${d.bills.oldest ? dayText(d.bills.oldest) : "-"}` : undefined, n: d.bills.n, unit: "ใบ", detail: d.bills.n ? `รวม ${baht(d.bills.sum)} บาท · เก่าสุดออกเมื่อ ${d.bills.oldest ? thDateText(d.bills.oldest) : "-"}` : "ไม่มีใบค้างชำระ", cta: "ไปรับชำระ", view: "billing" });
  if (d.debt60) c.push({ key: "debt60", short: "หนี้ค้างเกิน 60 วัน", meta: d.debt60.n ? `${baht(d.debt60.sum)} บาท` : undefined, title: "ลูกหนี้ค้างเกิน 60 วัน", brief: d.debt60.n ? `รวม ${baht(d.debt60.sum)} บาท` : undefined, hot: d.debt60.n > 0, n: d.debt60.n, unit: "ใบ", detail: d.debt60.n ? `รวม ${baht(d.debt60.sum)} บาท · ส่งใบแจ้งยอดค้างชำระให้ญาติ` : "ไม่มีหนี้ค้างนาน", cta: "ไปที่ลูกหนี้", warn: true, view: "billing" });
  if (d.unclosed) {
    const days = [...new Set(d.unclosed.map((x) => x.date))];
    c.push({ key: "unclosed", short: "ยังไม่ปิดยอดเงิน", title: "ยังไม่ปิดยอดรายวัน", brief: days.length ? days.slice(0, 3).map((x) => dayText(x)).join(", ") : undefined, n: days.length, unit: "วัน", detail: days.length ? `มีรับเงินแล้วยังไม่นับเงินสดปิดยอด · ${days.slice(0, 3).map((x) => dayText(x)).join(", ")}${days.length > 3 ? ` และอีก ${days.length - 3} วัน` : ""}` : "ปิดยอดครบทุกวันแล้ว", cta: "ไปปิดยอด", warn: true, open: () => cashHandoff.set(), view: "billing" });
  }
  if (d.monthDue) {
    // รอบบิลนับตามวันเริ่มสัญญา · เลยวันครบรอบแล้ว = ด่วน · จะครบใน 7 วัน = ควรเตรียมออกใบ
    const m = d.monthDue, t = bkkToday(), late = m.filter((x) => x.due <= t).length, who = m.map((x) => `${x.name} (${x.due <= t ? "ครบแล้ว" : `ครบ ${dayText(x.due)}`})`);
    c.push({ key: "monthDue", short: "ครบรอบบิล", meta: m.length ? `ครบแล้ว ${late} · ใน 7 วัน ${m.length - late}` : undefined, title: "ครบรอบบิล ยังไม่ออกใบ", brief: m.length ? (m.length === 1 ? who[0] : `${who[0]} และอีก ${m.length - 1} สัญญา`) : undefined, n: m.length, unit: "สัญญา", detail: m.length ? `ครบรอบตามวันเริ่มสัญญาแล้ว ${late} สัญญา · จะครบใน 7 วัน ${m.length - late} สัญญา · ${who.slice(0, 3).join(", ")}${m.length > 3 ? ` และอีก ${m.length - 3} สัญญา` : ""}` : "ออกใบครบทุกรอบบิลแล้ว", cta: "ไปออกใบรายเดือน", urgent: late > 0, warn: true, view: "billing" });
  }
  if (d.drafts !== undefined) c.push({ key: "drafts", short: "ใบรอตรวจยอด", title: "ใบแจ้งหนี้รอตรวจสอบยอด", n: d.drafts, unit: "ใบ", detail: d.drafts ? "ออกจากสัญญาอัตโนมัติ · ตรวจรายการแล้วกด ยืนยันยอด จึงรับชำระได้" : "ไม่มีใบรอตรวจสอบ", cta: "ไปตรวจยอด", view: "billing" });
  if (d.courses !== undefined) c.push({ key: "courses", short: "คอร์สรอออกใบ", title: "คอร์สกายภาพรอออกใบ", n: d.courses, unit: "คอร์ส", detail: d.courses ? "ซื้อคอร์สแล้วแต่ยังไม่ออกใบแจ้งหนี้ · นักกายภาพเริ่มทำได้แล้ว อย่าลืมออกใบเรียกเก็บ" : "ไม่มีคอร์สรอออกใบ", cta: "ไปออกใบ", view: "billing" });
  if (d.deposit) {
    const nb = d.deposit.filter((x) => !x.billed).length, first = d.deposit[0];
    c.push({ key: "deposit", short: "รอชำระมัดจำ", title: "สัญญารอชำระมัดจำ", brief: first ? `${first.name}${d.deposit.length > 1 ? ` และอีก ${d.deposit.length - 1} สัญญา` : ""}` : undefined, n: d.deposit.length, unit: "สัญญา", detail: first ? `${first.no} · ${first.name}${d.deposit.length > 1 ? ` และอีก ${d.deposit.length - 1} สัญญา` : ""}${nb ? ` · ยังไม่มีใบแจ้งหนี้ ${nb} สัญญา` : ""}` : "ไม่มีสัญญารอชำระ", cta: nb ? "ออกใบแจ้งหนี้" : "ไปที่สัญญาบริการ", view: "contracts" });
  }
  if (d.physio !== undefined) c.push({ key: "physio", short: "กายภาพรอราคา", title: "กายภาพรอกำหนดราคา", n: d.physio, unit: "ครั้ง", detail: d.physio ? "ทำไปแล้วโดยยังไม่มีคอร์ส · ใส่ราคาแล้วดึงเข้าใบแจ้งหนี้" : "ไม่มีรายการรอราคา", cta: "ไปที่ใบแจ้งหนี้และใบเสร็จ", view: "billing" });
  if (d.physioReq) {
    const q = d.physioReq, soon = q.filter((x) => x.date <= bkkTodayPlus1()).length;
    c.push({ key: "physioReq", short: "ขอคนแทนกายภาพ", title: "นักกายภาพขอคนแทน", brief: q.length ? `${q.slice(0, 2).map((x) => `${x.who} · ${dayText(x.date)}`).join(", ")}${q.length > 2 ? ` และอีก ${q.length - 2} นัด` : ""}` : undefined, n: q.length, unit: "นัด",
      detail: q.length ? `${q.slice(0, 3).map((x) => `${x.name} ${dayText(x.date)} (${x.who}: ${x.reason})`).join(", ")}${q.length > 3 ? ` และอีก ${q.length - 3} นัด` : ""} · กดนัดในตารางกายภาพเพื่อเลือกคนทำแทน` : "ไม่มีคำขอคนแทน",
      cta: "ไปที่ตารางกายภาพ", urgent: soon > 0, warn: true, view: "physio" });
  }
  if (d.physioMissed) {
    const m = d.physioMissed, who = [...new Set(m.map((x) => x.who))];
    c.push({ key: "physioMissed", short: "กายภาพเมื่อวานไม่ได้ทำ", title: "นัดกายภาพเมื่อวานที่ไม่มีบันทึก", brief: m.length ? `${namesOf(m.map((x) => x.name))} · ${who.slice(0, 2).join(", ")}` : undefined, n: m.length, unit: "นัด",
      detail: m.length ? `${m.slice(0, 3).map((x) => `${x.name} (${x.who})`).join(", ")}${m.length > 3 ? ` และอีก ${m.length - 3} นัด` : ""} · ดูรายละเอียดที่ติดตามการส่งงาน` : "นัดเมื่อวานบันทึกครบแล้ว", cta: "ไปที่ตารางกายภาพ", warn: true, view: "physio" });
  }
  if (d.physioLow) {
    const l = d.physioLow;
    c.push({ key: "physioLow", short: "คอร์สกายภาพใกล้หมด", title: "คอร์สกายภาพใกล้หมด (เหลือ 1–2 ครั้ง)", brief: l.length ? namesOf(l.map((x) => x.name)) : undefined, n: l.length, unit: "คอร์ส",
      detail: l.length ? `${l.slice(0, 3).map((x) => `${x.name} (เหลือ ${x.left} ครั้ง)`).join(", ")}${l.length > 3 ? ` และอีก ${l.length - 3} คอร์ส` : ""} · แจ้งญาติเรื่องต่อคอร์สก่อนครบ` : "ไม่มีคอร์สใกล้หมด", cta: "ไปที่ตารางกายภาพ", view: "physio" });
  }
  if (d.physioOpen) { const ps = d.physioOpen.map((x) => x.name); c.push({ key: "physioCase", short: "เคสกายภาพรอจ่าย", title: "เคสกายภาพยังไม่มีผู้รับผิดชอบ", brief: namesOf(ps), n: ps.length, unit: "เคส", detail: ps.length ? `${namesOf(ps, 3)} · เลือกนักกายภาพ วัน และเวลา ที่เมนูตารางกายภาพ` : "ทุกเคสมีนักกายภาพรับผิดชอบแล้ว", cta: "ไปที่ตารางกายภาพ", warn: true, view: "physio" }); }
  if (d.signups) {
    const s = d.signups, oldest = s.reduce((m, x) => Math.max(m, x.days), 0);
    c.push({ key: "signup", short: "สมัครใหม่รออนุมัติ", title: "สมัครใหม่รออนุมัติ", n: s.length, unit: "คน", warn: true,
      brief: s.length ? `${namesOf(s.map((x) => x.name))}${oldest >= 2 ? ` · รอนานสุด ${oldest} วัน` : ""}` : undefined, hot: oldest >= 2,
      detail: s.length ? `${s.slice(0, 3).map((x) => `${x.name} (สาขา${x.branch})`).join(", ")}${s.length > 3 ? ` และอีก ${s.length - 3} คน` : ""} · ตรวจว่าเป็นพนักงานจริง แล้วกดอนุมัติพร้อมเลือกตำแหน่ง` : "ไม่มีคนสมัครรออนุมัติ",
      cta: "ไปอนุมัติ", view: "staff", open: () => wantStaffFilter("รออนุมัติ") });
  }
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
/** compact = แถวเดียว "ต้องจัดการ N เรื่อง · ด่วน X" + ชิป · กด "ดูทั้งหมด" จึงกางรายการ (หน้าภาพรวมและรายงาน) */
export function AttentionStrip({ items, go, compact, expanded, onToggle }: { items: TodoItem[]; go: (v: ViewId) => void; compact?: boolean; expanded?: boolean; onToggle?: (v: boolean) => void }) {
  const open = items.filter((x) => x.n), done = items.filter((x) => !x.n);
  const urgent = open.filter((x) => x.urgent);
  if (compact) {
    const chips = [...urgent, ...open.filter((x) => !x.urgent)];
    const MAX = 6;
    return (
      <section className={`attn is-compact ${open.length ? "" : "is-clear"} ${expanded ? "is-open" : ""}`} aria-label="ต้องจัดการ">
        <div className="attn-bar">
          <b>{open.length ? `ต้องจัดการ ${open.length} เรื่อง` : "ไม่มีเรื่องค้าง ✓"}</b>
          {urgent.length > 0 && <em>ด่วน {urgent.length}</em>}
          {!expanded && open.length > 0 && <span className="attn-chips">
            {chips.slice(0, MAX).map((x) => (
              <button key={x.key} type="button" className={`attn-chip ${x.urgent ? "is-bad" : x.warn ? "is-warn" : ""}`} title={`${x.title} · ${x.detail}`} onClick={() => runTodo(x, go)}>
                {x.short} <b>{x.n}</b>
              </button>
            ))}
            {chips.length > MAX && <span className="attn-chip is-more">อีก {chips.length - MAX}</span>}
          </span>}
          {open.length > 0 && <button type="button" className="attn-toggle" aria-expanded={!!expanded} onClick={() => onToggle?.(!expanded)}>{expanded ? "ย่อ ▴" : "ดูทั้งหมด ▾"}</button>}
        </div>
        {expanded && <AttentionStrip items={items} go={go} />}
      </section>
    );
  }
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
