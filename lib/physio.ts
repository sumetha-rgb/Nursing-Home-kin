/**
 * งานกายภาพ: จ่ายเคส (คอร์ส → นักกายภาพ + วัน/เวลา) คิววันนี้ และตารางสัปดาห์
 *  ใช้ร่วมกันทั้งหน้า "ตารางกายภาพ" (ระบบจัดการ) KinApp ของนักกายภาพ และ /api/clinic
 */
export type PhysioNote = { at: string; author: string | null; title: string | null; body: string | null; pain: string | null; plan: string | null; mobility: string | null; cc?: string | null; dx?: string | null };
/** คอร์สที่ยังใช้ได้ (ยังเหลือครั้ง) พร้อมผู้รับผิดชอบและแผนรายสัปดาห์ */
export type PhysioCase = {
  id: string; resident_id: string; resident_name: string; branch_name: string; hn?: string | null; room: string | null; bed: string | null;
  name: string; total: number; used: number; price: number; billed: boolean;
  /** ใบแจ้งหนี้ของคอร์สชำระแล้ว */
  paid?: boolean;
  therapist_id: string | null; therapist_name: string | null; plan_days: number[] | null; plan_time: string | null; plan_minutes: number | null;
  /** นัดแบบเลือกวันเอง (YYYY-MM-DD) · มีค่า = ใช้แทน plan_days */
  plan_dates?: string[] | null;
  /** บันทึกล่าสุด 3 ครั้ง (ใหม่ก่อน) */
  recent: PhysioNote[];
};
/** cases_all = เคสที่ยังเหลือครั้งทุกสาขา (ภาระงานรวม) */
export type Therapist = { id: string; name: string; branch: string; role: string; cases_all?: number };
/** บันทึกกายภาพของวันนี้ (ทำแล้ว) */
export type PhysioDone = { course_id: string | null; resident_name: string; author: string | null; at: string; pain: string | null };
/** เช็คอินวันนี้ที่ยังไม่ได้บันทึก (กำลังทำ) · iso = เวลาเช็คอิน UTC */
export type PhysioVisit = { id: string; course_id: string; therapist_id: string | null; therapist_name: string | null; at: string; iso: string };
/** บันทึกของฉันย้อนหลัง 90 วัน (ปฏิทิน KinApp) */
export type PhysioLog = { course_id: string | null; date: string; at: string; title: string | null; resident_name: string };
/** บันทึกกายภาพ 42 วันล่าสุด (ติดตามการส่งงาน) */
export type PhysioRecord = { id: string; course_id: string | null; resident_name: string; author: string | null; date: string; at: string; title: string | null };
export type PhysioBoard = { cases: PhysioCase[]; therapists: Therapist[]; today: PhysioDone[]; month: { author: string; n: number }[]; visits?: PhysioVisit[]; mylog?: PhysioLog[];
  log?: PhysioRecord[];
  /** เช็คอินวันก่อน ๆ ที่ไม่ได้บันทึก */
  stale?: { course_id: string; resident_name: string; therapist_name: string | null; date: string; at: string }[];
  /** วันที่จ่ายเคส/แก้แผนล่าสุดของแต่ละคอร์ส (นับ "ไม่ได้ทำ" ตั้งแต่วันนี้เป็นต้นไป) */
  assigned?: { course_id: string; date: string }[];
  date: string };

/** สถานะนัดกายภาพ (ติดตามการส่งงาน) */
export type TrackStatus = "done" | "missed" | "noRecord" | "live" | "todo" | "planned";
export const TRACK_TEXT: Record<TrackStatus, string> = { done: "ทำแล้ว", missed: "ไม่ได้ทำ", noRecord: "เช็คอินแล้ว ไม่บันทึก", live: "กำลังทำ (เช็คอินแล้ว)", todo: "รอทำวันนี้", planned: "นัดไว้" };
export type TrackRow = { date: string; time: string; resident: string; therapist: string; therapistId: string | null; status: TrackStatus; at?: string; author?: string; caseId: string | null };
/**
 * นัดทุกนัดในช่วง from–to พร้อมสถานะ · วันที่ผ่านมา: ตามแผนตั้งแต่วันจ่ายเคส (เทียบบันทึกจริง) · วันนี้/ข้างหน้า: ตามแผนจนครบคอร์ส
 *  บันทึกทุกครั้งนับเป็น "ทำแล้ว" (รวมที่ไม่ตรงวันนัด) · ประวัติทุกบันทึกจึงอยู่ในรายการนี้
 */
export function trackRows(d: PhysioBoard, from: string, to: string): TrackRow[] {
  const today = d.date, rows: TrackRow[] = [];
  const recs = (d.log ?? []).filter((r) => r.date >= from && r.date <= to);
  const used = new Set<string>();
  const asg = new Map((d.assigned ?? []).map((a) => [a.course_id, a.date]));
  const live = new Set((d.visits ?? []).map((v) => v.course_id));
  for (const c of d.cases) {
    if (!c.therapist_id) continue;
    const s = schedOf(c), start = asg.get(c.id) ?? today;
    const dates = new Set<string>();
    for (let x = from; x <= to && x < today; x = addDays(x, 1)) if (x >= start && onDate(s, x)) dates.add(x);
    if (to >= today) {
      const doneToday = recs.some((r) => r.course_id === c.id && r.date === today);
      if (doneToday && onDate(s, today)) dates.add(today);
      for (const p of projectDates(c, today, doneToday)) if (p.date >= from && p.date <= to) dates.add(p.date);
    }
    for (const date of [...dates].sort()) {
      const rec = recs.find((r) => r.course_id === c.id && r.date === date && !used.has(r.id));
      if (rec) used.add(rec.id);
      const stale = (d.stale ?? []).find((v) => v.course_id === c.id && v.date === date);
      const status: TrackStatus = rec ? "done" : date < today ? (stale ? "noRecord" : "missed") : date === today ? (live.has(c.id) ? "live" : "todo") : "planned";
      rows.push({ date, time: rec?.at ?? c.plan_time ?? "", resident: c.resident_name, therapist: c.therapist_name ?? "-", therapistId: c.therapist_id, status, at: rec?.at ?? stale?.at, author: rec?.author ?? undefined, caseId: c.id });
    }
  }
  for (const r of recs) if (!used.has(r.id)) {
    const c = d.cases.find((k) => k.id === r.course_id);
    rows.push({ date: r.date, time: r.at, resident: r.resident_name, therapist: c?.therapist_name ?? r.author ?? "-", therapistId: c?.therapist_id ?? null, status: "done", at: r.at, author: r.author ?? undefined, caseId: r.course_id });
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}
/** ประวัติการทำกายภาพ 1 ครั้ง (op=physio_history) */
export type PhysioHistory = { id: string; title: string | null; body: string | null; author: string | null; at: string; pain: string | null; mobility: string | null; plan: string | null;
  activities: string[] | null; visit_id: string | null; checkin: string | null; done: string | null; minutes: number | null; work_n: number | null;
  vitals: Vitals | null; cc: string | null; pe: string | null; dx: string | null };
/** รูปเช็คอิน / รูปงาน (i = ลำดับรูปงาน 0–9) */
export const photoUrl = (visitId: string, kind: "checkin" | "work", i = 0) => `/api/clinic?op=physio_photo&visit=${encodeURIComponent(visitId)}&kind=${kind}${kind === "work" ? `&i=${i}` : ""}`;
export const MAX_PHOTOS = 10;

/** สัญญาณชีพ / ข้อมูลร่างกาย (วัดได้ช่องไหนกรอกช่องนั้น · BMI คำนวณจากน้ำหนักและส่วนสูง) */
export type Vitals = Partial<Record<"bw" | "ht" | "bmi" | "bt" | "pr" | "rr" | "o2" | "sys" | "dia", number>>;
export const VITAL_FIELDS: { k: keyof Vitals; label: string; step?: string }[] = [
  { k: "bw", label: "BW (kg.)", step: "0.1" }, { k: "ht", label: "Ht (cm.)", step: "0.1" }, { k: "bmi", label: "BMI" },
  { k: "bt", label: "BT (°C)", step: "0.1" }, { k: "pr", label: "PR (t/m)" }, { k: "rr", label: "RR (t/m)" },
  { k: "o2", label: "O₂sat (%)" }, { k: "sys", label: "BP Systolic (mmHg)" }, { k: "dia", label: "BP Diastolic (mmHg)" },
];
/** ช่วงค่าที่เป็นไปได้ของผู้ใหญ่ (กันพิมพ์ผิด) · นอกช่วง = เตือนให้ตรวจสอบก่อนบันทึก */
export const VITAL_RANGE: Partial<Record<keyof Vitals, [number, number, string]>> = {
  bw: [20, 250, "น้ำหนัก"], ht: [80, 230, "ส่วนสูง"], bt: [34, 42, "อุณหภูมิ"], pr: [30, 200, "ชีพจร"], rr: [6, 50, "หายใจ"],
  o2: [70, 100, "O₂sat"], sys: [60, 250, "ความดันตัวบน"], dia: [30, 150, "ความดันตัวล่าง"],
};
/** ค่าที่อยู่นอกช่วง เช่น ["O₂sat 5 (ปกติ 70–100)"] */
export const vitalWarnings = (v: Vitals) => (Object.keys(VITAL_RANGE) as (keyof Vitals)[])
  .filter((k) => v[k] != null && (v[k]! < VITAL_RANGE[k]![0] || v[k]! > VITAL_RANGE[k]![1]))
  .map((k) => `${VITAL_RANGE[k]![2]} ${v[k]} (ช่วงที่เป็นไปได้ ${VITAL_RANGE[k]![0]}–${VITAL_RANGE[k]![1]})`);
export const bmiOf = (bw?: number, ht?: number) => (bw && ht ? Math.round((bw / (ht / 100) ** 2) * 10) / 10 : undefined);
/** สรุปสัญญาณชีพเป็นบรรทัดเดียว เช่น BW 60 · BP 120/80 · O₂ 98% */
export function vitalsText(v: Vitals | null | undefined) {
  if (!v) return "";
  const p: string[] = [];
  if (v.bw) p.push(`BW ${v.bw} kg`); if (v.ht) p.push(`Ht ${v.ht} cm`); if (v.bmi) p.push(`BMI ${v.bmi}`); if (v.bt) p.push(`BT ${v.bt}`);
  if (v.pr) p.push(`PR ${v.pr}`); if (v.rr) p.push(`RR ${v.rr}`); if (v.o2) p.push(`O₂ ${v.o2}%`);
  if (v.sys || v.dia) p.push(`BP ${v.sys ?? "-"}/${v.dia ?? "-"}`);
  return p.join(" · ");
}

/** วันในสัปดาห์ (0 = อาทิตย์ ตาม getUTCDay) · เรียงจันทร์ก่อนสำหรับตาราง */
export const DAY_TH = ["อา.", "จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส."];
export const DAY_FULL = ["อาทิตย์", "จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์"];
export const WEEK = [1, 2, 3, 4, 5, 6, 0];
export const daysText = (d: number[] | null | undefined) => (d?.length ? WEEK.filter((x) => d.includes(x)).map((x) => DAY_TH[x]).join(" ") : "");
/**
 * สถานะเงินของคอร์ส (บันทึกกายภาพได้ทุกสถานะ · แสดงให้รู้เท่านั้น)
 *  free = คอร์สฟรี · none = แคชเชียร์ยังไม่ได้ออกใบแจ้งหนี้ · open = ออกใบแล้ว รอชำระ · paid = ชำระแล้ว
 */
export type PayState = "free" | "none" | "open" | "paid";
export const payOf = (c: { price: number; billed: boolean; paid?: boolean }): PayState => (!c.price ? "free" : !c.billed ? "none" : c.paid ? "paid" : "open");
export const PAY_TEXT: Record<PayState, string> = { free: "คอร์สฟรี", none: "แคชเชียร์ยังไม่ได้ออกใบแจ้งหนี้", open: "ออกใบแจ้งหนี้แล้ว · รอชำระ", paid: "ชำระแล้ว" };
export const leftOf = (c: { total: number; used: number }) => c.total - c.used;

/** ระดับการเคลื่อนไหว (บันทึกทุกครั้ง ดูแนวโน้มได้) */
export const MOBILITY = ["ติดเตียง", "ลุกนั่งได้", "ยืนได้ มีคนช่วย", "เดินด้วยอุปกรณ์", "เดินได้เอง"];
export const ACTIVITIES = ["ฝึกเดิน", "ฝึกยืน/ทรงตัว", "ยืดเหยียด", "เพิ่มกำลังกล้ามเนื้อ", "ฝึกลุกนั่ง/เคลื่อนย้าย", "ฝึกหายใจ", "จัดท่า/ป้องกันข้อติด", "เครื่องมือกายภาพ"];

const mins = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
/** แผนนัดของคอร์ส: ทุกสัปดาห์ (days) หรือเลือกวันเอง (dates) */
export type Sched = { days?: number[] | null; dates?: string[] | null };
export const schedOf = (c: { plan_days: number[] | null; plan_dates?: string[] | null }): Sched => ({ days: c.plan_days, dates: c.plan_dates });
const explicit = (s: Sched) => !!s.dates?.length;
/** มีนัดวันที่ date ไหม (เลือกวันเอง = ตรงวันที่ · ทุกสัปดาห์ = ตรงวันในสัปดาห์) */
export const onDate = (s: Sched, date: string) => (explicit(s) ? s.dates!.includes(date) : !!s.days?.includes(dowOf(date)));
/** สองแผนมีวันที่อาจตรงกันไหม (ใช้หาเวลาชน) */
function sharesDay(a: Sched, b: Sched) {
  if (explicit(a) && explicit(b)) return a.dates!.some((d) => b.dates!.includes(d));
  if (explicit(a)) return a.dates!.some((d) => !!b.days?.includes(dowOf(d)));
  if (explicit(b)) return b.dates!.some((d) => !!a.days?.includes(dowOf(d)));
  return !!a.days?.some((d) => b.days?.includes(d));
}
/** ข้อความแผนนัด เช่น "จ. พ. ศ." หรือ "เลือกวันเอง 6 วัน" */
export const schedText = (c: { plan_days: number[] | null; plan_dates?: string[] | null }) => (c.plan_dates?.length ? `เลือกวันเอง ${c.plan_dates.length} วัน` : daysText(c.plan_days));
/** เคสของนักกายภาพคนเดียวกันที่เวลาทับกัน (วันเดียวกัน ช่วงเวลาซ้อน) */
export function clashes(cases: PhysioCase[], therapistId: string, sched: Sched, time: string, minutes: number, self?: string) {
  if (!therapistId || !time) return [];
  const a = mins(time), b = a + minutes;
  return cases.filter((c) => c.id !== self && c.therapist_id === therapistId && c.plan_time && sharesDay(schedOf(c), sched))
    .filter((c) => { const x = mins(c.plan_time!), y = x + (c.plan_minutes || 45); return x < b && a < y; });
}
/** จำนวนครั้งต่อสัปดาห์ของแผน (เลือกวันเอง = เฉลี่ยตามช่วงวันที่) */
function perWeek(c: { plan_days: number[] | null; plan_dates?: string[] | null }) {
  if (!c.plan_dates?.length) return c.plan_days?.length ?? 0;
  const s = [...c.plan_dates].sort(), span = (Date.parse(s[s.length - 1]) - Date.parse(s[0])) / 864e5 + 1;
  return Math.min(7, s.length / Math.max(1, Math.ceil(span / 7)));
}
/** ภาระงานต่อสัปดาห์ของนักกายภาพ: จำนวนเคส และชั่วโมง */
export function loadOf(cases: PhysioCase[], therapistId: string) {
  const mine = cases.filter((c) => c.therapist_id === therapistId);
  const minutes = mine.reduce((n, c) => n + perWeek(c) * (c.plan_minutes || 45), 0);
  return { cases: mine.length, hours: Math.round((minutes / 60) * 10) / 10 };
}
/** วันในสัปดาห์ของวันที่ YYYY-MM-DD */
export const dowOf = (iso: string) => new Date(`${iso}T00:00:00Z`).getUTCDay();
export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const TH_MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
/** 2026-11-12 → พ. 12 พ.ย. */
export const dayLabel = (iso: string) => `${DAY_TH[dowOf(iso)]} ${Number(iso.slice(8, 10))} ${TH_MON[Number(iso.slice(5, 7)) - 1]}`;
/** ชื่อเดือน เช่น พฤศจิกายน 2569 */
export const monthLabel = (ym: string) => `${["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"][Number(ym.slice(5, 7)) - 1]} ${Number(ym.slice(0, 4)) + 543}`;

/**
 * วันนัดที่เหลือของคอร์ส ตามแผนรายสัปดาห์ (ครั้งที่ used+1 ถึง total) เริ่มจากวันที่ from
 *  skipFrom = วันแรกทำไปแล้ว (บันทึกวันนี้แล้ว) ให้เริ่มวันถัดไป · ไม่มีแผน = ไม่มีวันนัด
 */
export function projectDates(c: { used: number; total: number; plan_days: number[] | null; plan_dates?: string[] | null }, from: string, skipFrom = false) {
  const out: { date: string; n: number }[] = [];
  // เลือกวันเอง: วันที่ตั้งแต่วันนี้ (บันทึกวันนี้แล้ว = ตั้งแต่พรุ่งนี้) เรียงตามวันที่ ไม่เกินจำนวนครั้งที่เหลือ
  if (c.plan_dates?.length) {
    const start = skipFrom ? addDays(from, 1) : from;
    return [...new Set(c.plan_dates)].filter((d) => d >= start).sort().slice(0, Math.max(0, c.total - c.used)).map((date, k) => ({ date, n: c.used + 1 + k }));
  }
  if (!c.plan_days?.length) return out;
  let d = skipFrom ? addDays(from, 1) : from, n = c.used + 1;
  for (let guard = 0; n <= c.total && guard < 400; guard++, d = addDays(d, 1)) {
    if (c.plan_days.includes(dowOf(d))) out.push({ date: d, n: n++ });
  }
  return out;
}
/** วันจันทร์–อาทิตย์ของสัปดาห์ที่มีวันที่ iso */
export const weekDates = (iso: string) => { const mon = addDays(iso, -((dowOf(iso) + 6) % 7)); return Array.from({ length: 7 }, (_, k) => addDays(mon, k)); };
/** ช่องวันในปฏิทินเดือน (เริ่มวันจันทร์) · null = ช่องว่างก่อนวันที่ 1 / หลังสิ้นเดือน */
export function monthCells(ym: string) {
  const first = `${ym}-01`, last = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  const lead = (dowOf(first) + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let i = 1; i <= last; i++) cells.push(`${ym}-${String(i).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}
export const addMonth = (ym: string, n: number) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
/** เวลาที่ให้กดเลือก (ชั่วโมงทำงานปกติ) */
export const TIME_SLOTS = ["08:00", "09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00"];
