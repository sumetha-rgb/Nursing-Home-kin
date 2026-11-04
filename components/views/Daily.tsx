"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Icon from "../Icon";
import { MASTER_TASKS } from "@/lib/mock";
import { useCrud } from "@/lib/store";
import { taskHandoff } from "@/lib/handoff";
import { useApp } from "@/lib/app";
import { fetchNurses, useResidents } from "@/lib/care";
import { fetchMonth, Month } from "@/lib/roster";
import { staying } from "@/lib/rooms";
import { DataTable, Field, FieldDef, FormDialog, MetricGrid, Modal, PageHeader, Section, StatusBadge, Tabs, TimeInput } from "../ui";

/**
 * งานประจำวัน: ผู้จัดการมอบหมายงาน → ขึ้นใน "งานวันนี้" ของ KinApp → พนักงานส่งงาน → ผู้จัดการตรวจ
 * แถวของชุดข้อมูล daily-YYYY-MM-DD:
 * [ผู้รับบริการ, ชื่องาน, ผู้รับผิดชอบ, เวลา, กะ, สถานะ, คำสั่งงาน, สัญญาณชีพ, เวลาที่ส่งจริง, บันทึกจากผู้ทำ, ผู้ส่งงาน]
 */
const COLS = ["มอบหมายเมื่อ", "ผู้รับบริการ", "ชื่องาน", "ประเภท", "ผู้รับผิดชอบ", "เวลา", "กะ", "สถานะ"];
/** ผู้รับผิดชอบว่าง ("-") = ใครก็ได้ในเวรนั้น */
const ANYONE = "ทุกคนในเวร (ไม่ระบุคน)";
const owner = (r: string[]) => (r[10] && r[10] !== "-" ? `${r[10]} (ส่งแล้ว)` : r[2] && r[2] !== "-" ? r[2] : `ทีม${r[4] || "เวร"}`);
const SHIFTS = ["ทั้งหมด", "กะเช้า", "กะดึก"];
/**
 * สถานะที่แสดงในหน้านี้ (ข้อมูลจริงยังเป็น รอทำ / เสร็จแล้ว / ตรวจแล้ว)
 *  เลยเวลา = แดง (เลยเวลาที่กำหนดเกิน LATE_MIN นาทียังไม่ส่ง) · ยังไม่ได้ทำ = เทา · ส่งแล้ว รอตรวจ = ส้ม · ตรวจแล้ว = เขียว
 */
const LATE_MIN = 30;
type Phase = "late" | "todo" | "review" | "done";
const PHASE_TEXT: Record<Phase, string> = { late: "เลยเวลา ยังไม่ได้ทำ", todo: "ยังไม่ได้ทำ", review: "ส่งแล้ว รอตรวจ", done: "ตรวจแล้ว" };
const STAT_FILTERS: { k: Phase | ""; t: string }[] = [
  { k: "", t: "ทุกสถานะ" },
  { k: "late", t: "เลยเวลา" },
  { k: "review", t: "ยังไม่ได้ตรวจ" },
  { k: "todo", t: "ยังไม่ได้ทำ" },
  { k: "done", t: "ตรวจแล้ว" },
];
const SHIFT_TIME: Record<string, string> = { กะเช้า: "08:00", กะดึก: "20:00" };
/** เวลาที่มอบหมาย (ระบบบันทึกเอง) · "dd/mm/yyyy HH:MM" → เทียบเรียงด้วย yyyy-mm-dd HH:MM */
const stamp = (r: string[]) => { const m = String(r[11] ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}:\d{2})/); return m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}` : "9999"; };
const assignedAt = (r: string[]) => { const m = String(r[11] ?? "").match(/^(\d{2})\/(\d{2})\/\d{4} (\d{2}:\d{2})/); return m ? `${m[1]}/${m[2]} ${m[3]} น.` : "เพิ่งมอบหมาย"; };
const blankRow = (who: string, task: string, time: string, shift: string, ins: string, by = "-") => [who, task, by, time, shift, "รอทำ", ins || "-", "-", "-", "-", "-"];

const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayIso = () => isoOf(new Date());
const prevIso = (iso: string) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() - 1); return isoOf(d); };
const thaiDate = (iso: string) =>
  iso ? new Date(iso + "T00:00:00").toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric", weekday: "long" }) : "";
const shiftOf = (time: string) => { const h = Number(time.slice(0, 2)); return h >= 7 && h < 19 ? "กะเช้า" : "กะดึก"; };

/** หน้าต่างตรวจงาน: ระดับดาว และข้อความสำเร็จรูป (กดแล้วต่อท้ายความคิดเห็น) */
const STAR_TEXT = ["", "ไม่ผ่าน ต้องทำใหม่", "ต้องปรับปรุง", "พอใช้", "ดี", "ดีมาก"];
const QUICK_NOTES = ["ทำครบตามคำสั่ง", "ส่งตรงเวลา", "รูปหลักฐานชัดเจน", "รูปไม่ชัด ครั้งหน้าถ่ายใหม่", "ส่งช้ากว่ากำหนด", "บันทึกไม่ครบ"];
const filled = (x?: string) => (x && x.trim() && x.trim() !== "-" ? x.trim() : "");
/** ส่งจริงเทียบเวลาที่กำหนด (นาที) · ข้ามเที่ยงคืนได้ · อ่านเวลาไม่ได้ = null */
const lateBy = (sched: string, sent: string) => {
  const m = (t: string) => { const x = String(t ?? "").match(/(\d{1,2})[:.](\d{2})(?!.*\d{1,2}[:.]\d{2})/); return x ? Number(x[1]) * 60 + Number(x[2]) : null; };
  const a = m(sched), b = m(sent);
  if (a === null || b === null) return null;
  let d = b - a; if (d < -720) d += 1440; if (d > 720) d -= 1440;
  return d;
};

export function DailyTasks() {
  const [date, setDate] = useState(todayIso);
  const [shift, setShift] = useState("ทั้งหมด");
  const [kind, setKind] = useState("ทั้งหมด"); // งานประจำ (ระบบสร้างทุกวัน) / งานรายครั้ง
  // กรองสถานะ: เลยเวลา / ยังไม่ได้ตรวจ / ยังไม่ได้ทำ / ตรวจแล้ว · มาจากการ์ดหน้าแรกเปิดตัวกรองไว้ให้
  const [stat, setStat] = useState<Phase | "">(() => (taskHandoff.take() as Phase | null) ?? "");
  // เวลาปัจจุบัน (อัปเดตทุกนาที ให้งานที่เลยเวลาเปลี่ยนเป็นสีแดงเอง)
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);
  // งานแยกตามวันที่ · วันที่ยังไม่มีงานจะว่าง (ไม่ใส่ข้อมูลตัวอย่างให้เอง) สร้างจากคลังงานหรือคัดลอกจากวันก่อน
  const { rows, ids, add, update, remove } = useCrud(`daily-${date}`, []);
  const { rows: master } = useCrud("master", MASTER_TASKS);
  const { residents } = useResidents();
  const { toast, confirm } = useApp();
  const [i, setI] = useState<number | null>(null);
  const [star, setStar] = useState("5");
  const [note, setNote] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [assign, setAssign] = useState(false);
  const [pickRes, setPickRes] = useState<string[]>([]);
  const [pickTask, setPickTask] = useState<number[]>([]);
  const [times, setTimes] = useState(SHIFT_TIME);
  const [assignErr, setAssignErr] = useState("");
  const [repeat, setRepeat] = useState(true);
  const [routineOpen, setRoutineOpen] = useState(false);
  type Routine = { id: string; resident_name: string; branch_name: string; task_name: string; shift: string; sched_time: string; created_by: string };
  const [routines, setRoutines] = useState<Routine[]>([]);
  const loadRoutines = useCallback(() => { fetch("/api/care?op=routines", { cache: "no-store" }).then((r) => r.json()).then((d) => setRoutines(d.routines ?? [])).catch(() => {}); }, []);
  useEffect(loadRoutines, [loadRoutines]);
  const stopRoutine = (r: Routine) => confirm({ title: "หยุดทำซ้ำ", message: `หยุดสร้างงาน "${r.task_name}" ของ ${r.resident_name} ทุกวัน ใช่หรือไม่ (งานที่สร้างไปแล้วไม่หาย)`, okLabel: "หยุดทำซ้ำ", danger: true,
    onOk: async () => { const res = await fetch("/api/care", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "routine_stop", id: r.id }) }); toast(res.ok ? "หยุดทำซ้ำแล้ว" : "หยุดไม่สำเร็จ"); loadRoutines(); } });

  // ตารางเวรของวันที่เลือก: ใช้เลือกคนรับผิดชอบงาน (คนที่เข้าเวรนั้นขึ้นก่อน)
  const [roster, setRoster] = useState<Month | null>(null);
  useEffect(() => { fetchMonth(date.slice(0, 7)).then(setRoster).catch(() => setRoster(null)); }, [date]);
  // ผู้รับผิดชอบเลือกได้เฉพาะพยาบาล (พนักงานพยาบาลและหัวหน้าพยาบาล) · ผู้จัดการ แคชเชียร์ ไม่อยู่ในรายการ
  // ผู้บริหาร (ทุกสาขา) ไม่มีรายชื่อทีมจากตารางเวร: ใช้รายชื่อพยาบาลที่ทำงานอยู่ของทุกสาขาแทน
  const [allNurses, setAllNurses] = useState<string[]>([]);
  useEffect(() => { fetchNurses().then(setAllNurses).catch(() => setAllNurses([])); }, []);
  const teamNurses = (roster?.team ?? []).filter((t) => t.role === "Nurse" || t.role === "Head Nurse").map((t) => t.name);
  const pool = roster?.team?.length ? teamNurses : allNurses;
  const isNurse = (n: string) => pool.includes(n);
  const onDuty = (sh: string) => (roster?.shifts ?? []).filter((x) => x.date === date && `กะ${x.shift}` === sh && isNurse(x.staff_name)).map((x) => x.staff_name);
  const people = (sh: string) => { const d = onDuty(sh); return [...new Set([...d, ...pool])]; };
  const [who, setWho] = useState<{ k: number; v: string } | null>(null);
  const names = useMemo(() => residents.filter((r) => staying(r.status ?? "")).map((r) => r.full_name), [residents]);
  // งานประจำ = มีรายการทำซ้ำของผู้รับบริการ + งาน + กะ เดียวกัน
  const routine = (r: string[]) => routines.some((x) => x.resident_name === r[0] && x.task_name === r[1] && x.shift === r[4]);
  const kindOf = (r: string[]) => (routine(r) ? "งานประจำ" : "งานรายครั้ง");
  /** เวลาที่ต้องทำงาน · งานกะดึกหลังเที่ยงคืน (ก่อน 07:00) เป็นของวันถัดไป */
  const dueAt = (r: string[]) => {
    const m = String(r[3] ?? "").match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const d = new Date(`${date}T00:00:00`);
    if (r[4] === "กะดึก" && Number(m[1]) < 7) d.setDate(d.getDate() + 1);
    d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    return d.getTime();
  };
  const phase = (r: string[]): Phase => (r[5] === "ตรวจแล้ว" ? "done" : r[5] === "เสร็จแล้ว" ? "review" : (dueAt(r) ?? Infinity) + LATE_MIN * 60e3 < now ? "late" : "todo");
  const base = rows.map((r, k) => ({ r, k })).filter(({ r }) => (shift === "ทั้งหมด" || r[4] === shift) && (kind === "ทั้งหมด" || kindOf(r) === kind));
  const statCount = (k: Phase | "") => base.filter(({ r }) => !k || phase(r) === k).length;
  const shown = base.filter(({ r }) => !stat || phase(r) === stat)
    // มอบหมายล่าสุดอยู่บนสุด (งานที่ยังไม่บันทึกขึ้นระบบ = เพิ่งมอบหมาย) · มอบหมายพร้อมกันเรียงตามเวลางาน
    .sort((a, b) => stamp(b.r).localeCompare(stamp(a.r)) || String(a.r[3]).localeCompare(String(b.r[3])));
  const checked = statCount("done");
  const pending = statCount("review");
  const waiting = statCount("todo") + statCount("late");
  const pct = base.length ? Math.round((checked / base.length) * 100) : 0;
  const count = (s: string) => rows.filter((r) => s === "ทั้งหมด" || r[4] === s).length;
  const kindCount = (s: string) => rows.filter((r) => (shift === "ทั้งหมด" || r[4] === shift) && (s === "ทั้งหมด" || kindOf(r) === s)).length;
  const cur = i !== null ? rows[i] : null;
  // รูปหลักฐานโหลดแยกตอนเปิดตรวจงาน (ไม่รวมในรายการงานเพื่อให้หน้าโหลดเร็ว)
  const [shot, setShot] = useState<{ photo: string | null; at: string | null; share?: boolean; stars?: number | null; note?: string | null } | null>(null);
  const curId = i !== null ? ids[i] : null;
  const [big, setBig] = useState(false);
  useEffect(() => {
    setShot(null); setBig(false);
    if (!curId) return;
    fetch(`/api/care?op=task_photo&id=${encodeURIComponent(curId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { photo: null, at: null }))
      .then((d) => { setShot(d); if (d.stars) setStar(String(d.stars)); if (d.note) setNote(d.note); }) // ตรวจแล้ว: แสดงดาวเดิม
      .catch(() => setShot({ photo: null, at: null }));
  }, [curId]);
  const exists = (who: string, task: string, sh: string) => rows.some((r) => r[0] === who && r[1] === task && r[4] === sh);

  /** มอบหมายจากคลังงาน: ผู้รับบริการที่เลือก × งานที่เลือก (งาน "ทั้งสองกะ" สร้างทั้งกะเช้าและกะดึก) ข้ามงานที่มีอยู่แล้ว */
  const doAssign = () => {
    if (!pickRes.length) return setAssignErr("กรุณาเลือกผู้รับบริการอย่างน้อย 1 คน");
    if (!pickTask.length) return setAssignErr("กรุณาเลือกงานจากคลังงานอย่างน้อย 1 งาน");
    let made = 0, skipped = 0;
    const plan: { resident: string; task: string; ins: string; shift: string; time: string }[] = [];
    for (const who of pickRes) for (const ti of pickTask) {
      const t = master[ti];
      const shifts = t[4] === "ทั้งสองกะ" ? ["กะเช้า", "กะดึก"] : [t[4] === "กะดึก" ? "กะดึก" : "กะเช้า"];
      for (const sh of shifts) {
        plan.push({ resident: who, task: t[1], ins: t[2], shift: sh, time: times[sh] });
        if (exists(who, t[1], sh)) { skipped++; continue; }
        add(blankRow(who, t[1], times[sh], sh, t[2])); made++;
      }
    }
    setAssign(false); setPickRes([]); setPickTask([]); setAssignErr("");
    if (repeat && plan.length) {
      fetch("/api/care", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "routines_add", items: plan }) })
        .then((r) => r.json()).then((d) => { loadRoutines(); toast(`ตั้งงานประจำแล้ว ${d.added ?? 0} รายการ · ระบบสร้างงานให้เองทุกวัน`); })
        .catch(() => toast("มอบหมายงานวันนี้แล้ว แต่ตั้งงานประจำไม่สำเร็จ"));
      return;
    }
    toast(`มอบหมายงานแล้ว ${made} งาน · ขึ้นใน KinApp แล้ว${skipped ? ` · ข้ามงานที่มีอยู่แล้ว ${skipped} งาน` : ""}`);
  };

  /** คัดลอกงานของวันก่อนหน้า (สถานะกลับเป็นรอทำ) */
  const copyPrev = async () => {
    const from = prevIso(date);
    try {
      const r = await fetch(`/api/data/daily-${from}`, { cache: "no-store" });
      if (!r.ok) throw new Error();
      const d = (await r.json()) as { items: { data: string[] }[] };
      const src = d.items.map((x) => x.data).filter((x) => !exists(x[0], x[1], x[4]));
      if (!d.items.length) return toast(`วันที่ ${thaiDate(from)} ไม่มีงานให้คัดลอก`);
      src.forEach((x) => add(blankRow(x[0], x[1], x[3], x[4], x[6])));
      toast(src.length ? `คัดลอก ${src.length} งานจากเมื่อวานแล้ว` : "งานของเมื่อวานมีครบในวันนี้แล้ว");
    } catch { toast("โหลดงานของวันก่อนหน้าไม่สำเร็จ"); }
  };

  const ADD_FIELDS: FieldDef[] = [
    { label: "ผู้รับบริการ", options: names, required: true, pick: "resident", requireRoom: true },
    { label: "ชื่องาน", required: true },
    { label: "เวลา", type: "time", required: true },
    { label: "คำสั่งงาน", area: true },
    { label: "ผู้รับผิดชอบ", options: [ANYONE, ...people("กะเช้า"), ...people("กะดึก").filter((n) => !people("กะเช้า").includes(n))] },
  ];

  return (
    <>
      <PageHeader
        title="มอบหมายและตรวจงาน"
        sub="งานของทีมดูแล · ส่งแล้วตรวจที่หน้านี้"
        actions={<>
          <button className="btn-soft" onClick={() => { loadRoutines(); setRoutineOpen(true); }}><Icon name="refresh" className="h-4 w-4" /> งานประจำ ({routines.length})</button>
          <button className="btn-soft" onClick={copyPrev}><Icon name="files" className="h-4 w-4" /> คัดลอกงานจากวันก่อน</button>
          <button className="btn-soft" onClick={() => setAddOpen(true)}><Icon name="plus" className="h-4 w-4" /> มอบหมายงาน</button>
          <button className="btn-primary" onClick={() => { setAssignErr(""); setAssign(true); }}><Icon name="book" className="h-4 w-4" /> มอบหมายจากแม่แบบงานมาตรฐาน</button>
        </>}
      />

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <Icon name="calendar" className="h-5 w-5 shrink-0 text-gold-600" />
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="เลือกวันที่" className="!w-auto font-medium" />
          {date !== todayIso() && <button className="btn-soft !py-2" onClick={() => setDate(todayIso())}>วันนี้</button>}
        </div>
        <p className="text-sm text-gold-600">{thaiDate(date)} <span className="text-gold-500">· ตัดกะ 07:00 น.</span></p>
      </div>

      <MetricGrid items={[{ label: "งานในกะที่เลือก", value: base.length, unit: "งาน", accent: true, icon: "check" }, { label: "รอพนักงานทำ", value: waiting, unit: "งาน", icon: "calendar" }, { label: "ส่งแล้ว รอผู้จัดการตรวจ", value: pending, unit: "งาน", icon: "search" }, { label: "ตรวจเรียบร้อย", value: checked, unit: "งาน", icon: "check", note: `ความคืบหน้า ${pct}%` }]} />
      <div className="mt-6">
        <Section title="รายการงาน" actions={<div className="flex flex-wrap gap-2">
          <Tabs tabs={["ทั้งหมด", "งานประจำ", "งานรายครั้ง"].map((s) => `${s === "ทั้งหมด" ? "ทุกประเภท" : s} (${kindCount(s)})`)} value={`${kind === "ทั้งหมด" ? "ทุกประเภท" : kind} (${kindCount(kind)})`} onChange={(t) => { const v = t.split(" (")[0]; setKind(v === "ทุกประเภท" ? "ทั้งหมด" : v); }} />
          <Tabs tabs={SHIFTS.map((s) => `${s} (${count(s)})`)} value={`${shift} (${count(shift)})`} onChange={(t) => setShift(t.split(" (")[0])} />
        </div>}>
          <div className="stat-filter" role="radiogroup" aria-label="กรองตามสถานะ">
            {STAT_FILTERS.map((f) => (
              <button key={f.t} type="button" role="radio" aria-checked={stat === f.k} className={`is-${f.k || "all"} ${stat === f.k ? "is-on" : ""}`} onClick={() => setStat(f.k)}>
                {f.k && <i aria-hidden />}{f.t} <b>{statCount(f.k)}</b>
              </button>
            ))}
          </div>
          <DataTable
            columns={COLS}
            rows={shown.map(({ r }) => [assignedAt(r), r[0], r[1], kindOf(r), owner(r), r[3], r[4], PHASE_TEXT[phase(r)]])}
            render={(_, col, v) => (col === 3 ? <span className={`kind-badge ${v === "งานประจำ" ? "is-routine" : "is-once"}`}>{v === "งานประจำ" ? <><Icon name="refresh" className="h-3 w-3" />งานประจำ</> : "งานรายครั้ง"}</span> : undefined)}
            empty={stat ? `ไม่มีงานที่${STAT_FILTERS.find((f) => f.k === stat)?.t} ในกะที่เลือก` : "ยังไม่มีงานของวันนี้ · กด \"มอบหมายจากแม่แบบงานมาตรฐาน\" หรือ \"คัดลอกงานจากวันก่อน\""}
            actions={[
              { label: "ตรวจงาน", onClick: (n) => { setI(shown[n].k); setStar("5"); setNote(""); } },
              { label: "มอบหมายคน", onClick: (n) => { const r = rows[shown[n].k]; setWho({ k: shown[n].k, v: r[2] && r[2] !== "-" ? r[2] : ANYONE }); } },
              { label: "ลบ", danger: true, onClick: (n) => { const k = shown[n].k; confirm({ title: "ลบงาน", message: `ลบงาน "${rows[k][1]}" ของ ${rows[k][0]} ใช่หรือไม่`, danger: true, okLabel: "ลบ", onOk: () => { const r = rows[k]; remove(k); toast(`ลบงานแล้ว · ${r[1]} · ${r[0]}`); } }); } },
            ]}
          />
        </Section>
      </div>

      {/* มอบหมายจากคลังงาน */}
      <Modal open={assign} wide title="มอบหมายงานจากแม่แบบงานมาตรฐาน" onClose={() => setAssign(false)}
        footer={<><button className="btn-soft" onClick={() => setAssign(false)}>ยกเลิก</button><button className="btn-primary" onClick={doAssign}>มอบหมาย {pickRes.length * pickTask.length > 0 ? `(${pickRes.length} คน × ${pickTask.length} งาน)` : ""}</button></>}>
        <p className="form-intro">เลือกผู้รับบริการและงาน ระบบสร้างงานของวันที่ {thaiDate(date)} ให้ทุกคู่ งาน &quot;ทั้งสองกะ&quot; สร้างทั้งกะเช้าและกะดึก</p>
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center justify-between"><p className="label !mb-0">1. ผู้รับบริการ ({pickRes.length})</p><button type="button" className="text-xs font-medium text-gold-700 underline-offset-2 hover:underline" onClick={() => setPickRes(pickRes.length === names.length ? [] : names)}>{pickRes.length === names.length ? "ไม่เลือกทั้งหมด" : "เลือกทั้งหมด"}</button></div>
            <ul className="pick-list">{names.map((n) => <li key={n}><label><input type="checkbox" checked={pickRes.includes(n)} onChange={() => { setAssignErr(""); setPickRes(pickRes.includes(n) ? pickRes.filter((x) => x !== n) : [...pickRes, n]); }} /> {n}</label></li>)}</ul>
            {!names.length && <p className="text-sm text-gold-500">ยังไม่มีผู้รับบริการในสาขา</p>}
          </div>
          <div>
            <p className="label">2. งานจากแม่แบบงานมาตรฐาน ({pickTask.length})</p>
            <ul className="pick-list">{master.map((t, k) => <li key={k}><label><input type="checkbox" checked={pickTask.includes(k)} onChange={() => { setAssignErr(""); setPickTask(pickTask.includes(k) ? pickTask.filter((x) => x !== k) : [...pickTask, k]); }} /> <span>{t[1]} <small className="text-gold-500">· {t[4]} · {t[6]}</small></span></label></li>)}</ul>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Field label="3. เวลางานกะเช้า"><TimeInput value={times["กะเช้า"]} onChange={(v) => setTimes({ ...times, กะเช้า: v })} /></Field>
          <Field label="เวลางานกะดึก"><TimeInput value={times["กะดึก"]} onChange={(v) => setTimes({ ...times, กะดึก: v })} /></Field>
        </div>
        <label className="repeat-toggle mt-4"><input type="checkbox" checked={repeat} onChange={(e) => setRepeat(e.target.checked)} /><span><b>ทำซ้ำทุกวัน (งานประจำ)</b><small>ระบบสร้างงานชุดนี้ให้เองทุกวัน ไม่ต้องมอบหมายใหม่ทุกเช้า · หยุดได้ที่ปุ่ม &quot;งานประจำ&quot;</small></span></label>
        {assignErr && <p role="alert" className="form-error mt-4"><Icon name="alert" className="h-4 w-4 shrink-0" />{assignErr}</p>}
      </Modal>

      {/* งานประจำ */}
      <Modal open={routineOpen} wide title="งานประจำ (ทำซ้ำทุกวัน)" onClose={() => setRoutineOpen(false)} footer={<button className="btn-primary" onClick={() => setRoutineOpen(false)}>ปิด</button>}>
        <p className="form-intro">งานในรายการนี้ระบบสร้างให้เองทุกวัน ตั้งแต่วันนี้ถึงล่วงหน้า 14 วัน เมื่อมีคนเปิดดูวันนั้นครั้งแรก · เพิ่มงานประจำได้ที่ &quot;มอบหมายจากแม่แบบงานมาตรฐาน&quot; แล้วติ๊ก &quot;ทำซ้ำทุกวัน&quot;</p>
        <DataTable search={false} columns={["ผู้รับบริการ", "สาขา", "งาน", "กะ", "เวลา", "ตั้งโดย"]} empty="ยังไม่มีงานประจำ"
          rows={routines.map((r) => [r.resident_name, r.branch_name, r.task_name, r.shift, r.sched_time, r.created_by ?? "-"])}
          actions={[{ label: "หยุดทำซ้ำ", danger: true, onClick: (i) => stopRoutine(routines[i]) }]} />
      </Modal>

      <FormDialog open={addOpen} mode="add" title="มอบหมายงานประจำวัน" fields={ADD_FIELDS} onClose={() => setAddOpen(false)} saveLabel="มอบหมายงาน"
        onSave={(v) => {
          if (!v[0] || !v[1].trim() || !v[2]) return toast("กรุณากรอกผู้รับบริการ ชื่องาน และเวลา");
          const sh = shiftOf(v[2]);
          if (exists(v[0], v[1].trim(), sh)) return toast("มีงานนี้ของผู้รับบริการคนนี้ในกะนี้แล้ว");
          add(blankRow(v[0], v[1].trim(), v[2], sh, v[3], v[4] && v[4] !== ANYONE ? v[4] : "-")); setAddOpen(false); toast(`มอบหมายงานแล้ว · ${v[1].trim()} · ${v[0]} · ${sh} ${v[2]} น. · ขึ้นใน KinApp แล้ว`);
        }} />

      <Modal open={!!who} title="มอบหมายผู้รับผิดชอบ" onClose={() => setWho(null)}
        footer={<>
          <button className="btn-soft" onClick={() => setWho(null)}>ยกเลิก</button>
          <button className="btn-primary" onClick={() => {
            if (!who) return;
            const r = [...rows[who.k]]; while (r.length < 11) r.push("-");
            r[2] = who.v === ANYONE ? "-" : who.v;
            update(who.k, r); setWho(null);
            toast(r[2] === "-" ? `งานนี้ให้ทุกคนใน${r[4]}ทำได้` : `มอบหมายให้ ${r[2]} แล้ว · ขึ้นใน "งานของฉัน" ของ KinApp`);
          }}>บันทึก</button>
        </>}>
        {who && (() => {
          const r = rows[who.k]; const duty = onDuty(r[4]);
          return (
            <div className="space-y-3">
              <p className="rounded-xl bg-cream-50 px-4 py-3 text-sm"><b>{r[1]}</b> · {r[0]}<br /><span className="text-gold-600">{r[3]} น. · {r[4]}</span></p>
              <ul className="pick-list">
                {[ANYONE, ...people(r[4])].map((n) => (
                  <li key={n}><label><input type="radio" name="owner" checked={who.v === n} onChange={() => setWho({ ...who, v: n })} />
                    <span>{n}{duty.includes(n) && <small className="ml-1 text-green-700">· เข้า{r[4].replace("กะ", "เวร")}วันนี้</small>}</span></label></li>
                ))}
              </ul>
              {!duty.length && <p className="text-sm text-gold-500">ยังไม่ได้จัดคนเข้า{r[4].replace("กะ", "เวร")}ของวันนี้ · จัดได้ที่เมนู &quot;ตารางเวร&quot;</p>}
            </div>
          );
        })()}
      </Modal>

      <Modal
        open={cur !== null} wide title="ตรวจสอบผลการปฏิบัติงาน" onClose={() => setI(null)}
        footer={<>
          <button className={cur?.[5] === "รอทำ" ? "btn-primary" : "btn-soft"} onClick={() => setI(null)}>{cur?.[5] === "รอทำ" ? "ปิด" : "ยกเลิก"}</button>
          {cur?.[5] !== "รอทำ" && <button className="btn-primary" onClick={() => {
            if (i === null || !cur) return;
            if (cur[5] === "รอทำ") { toast("งานนี้พนักงานยังไม่ได้ส่ง ยังตรวจไม่ได้"); return; }
            update(i, cur.map((c, j) => (j === 5 ? "ตรวจแล้ว" : c)));
            // ดาวและความเห็นเก็บแยก ใช้คิด KPI ของพนักงานที่ส่งงาน
            fetch("/api/care", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "task_review", id: curId, stars: Number(star), note }) })
              .then((r) => toast(r.ok ? `บันทึกผลการตรวจแล้ว · ${star} ดาวนับเข้า KPI ของ${cur[10] && cur[10] !== "-" ? cur[10] : "พนักงาน"}` : "เปลี่ยนสถานะแล้ว แต่บันทึกดาวไม่สำเร็จ"))
              .catch(() => toast("เปลี่ยนสถานะแล้ว แต่บันทึกดาวไม่สำเร็จ"));
            setI(null);
          }}>{cur?.[5] === "ตรวจแล้ว" ? "บันทึกผลการตรวจใหม่" : "บันทึกผลการตรวจ"}</button>}
        </>}
      >
        {cur && (() => {
          const notSent = cur[5] === "รอทำ";
          const doer = filled(cur[10]) || filled(cur[2]) || `ทีม${cur[4] || "เวร"}`;
          const late = notSent ? null : lateBy(cur[3], cur[8]);
          return (
          <div className="space-y-5">
            {/* หัวสรุป: ผู้รับบริการ งาน สถานะ แล้วแถวเวลา/ผู้ทำ */}
            <div className="review-head">
              <div className="min-w-0">
                <p className="review-who">{cur[0]}</p>
                <h3>{cur[1]}</h3>
              </div>
              <StatusBadge value={PHASE_TEXT[phase(cur)]} />
            </div>
            <div className="review-meta">
              <div><span>ผู้ปฏิบัติงาน</span><b>{doer}</b></div>
              <div><span>เวลาที่กำหนด</span><b>{cur[3]} น. · {cur[4]}</b></div>
              <div><span>ส่งงานเมื่อ</span><b>{notSent ? "ยังไม่ส่ง" : filled(cur[8]) ? `${cur[8]} น.` : "-"}</b>
                {late !== null && <em className={late > 15 ? "is-late" : "is-ok"}>{late > 15 ? `ช้า ${late} นาที` : "ตรงเวลา"}</em>}</div>
            </div>
            {filled(cur[6]) && <div className="review-order"><span>คำสั่งงาน</span><p>{cur[6]}</p></div>}

            {notSent ? (
              <p role="status" className="review-wait"><Icon name="calendar" className="h-5 w-5 shrink-0" /><span><b>พนักงานยังไม่ได้ส่งงานนี้</b>ตรวจได้หลังพนักงานกดส่งงานใน KinApp · ถ้าเลยเวลาแล้ว ลองกด &quot;มอบหมายคน&quot; เพื่อระบุคนรับผิดชอบ</span></p>
            ) : (<div className="review-cols">
            <section className="review-sec">
              <h4>สิ่งที่พนักงานส่งมา</h4>
              {filled(cur[9]) && <blockquote className="review-quote">{cur[9]}</blockquote>}
              {filled(cur[7]) && <div className="review-order"><span>สัญญาณชีพ (Vital Signs)</span><p>{cur[7]}</p></div>}
              <div>
                {shot === null ? <p className="text-sm text-gold-500">กำลังโหลดรูป…</p>
                  : shot.photo ? (<>
                    <button type="button" className={`task-proof ${big ? "is-big" : ""}`} onClick={() => setBig(!big)}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={shot.photo} alt={`รูปหลักฐาน ${cur[1]}`} />
                      <span>อัปโหลดเมื่อ {shot.at} น. · {big ? "กดเพื่อย่อ" : "กดเพื่อดูภาพเต็ม"}</span>
                    </button>
                    <label className="share-toggle mt-2"><input type="checkbox" checked={shot.share !== false} onChange={async (e) => {
                      const share = e.target.checked;
                      const r = await fetch("/api/care", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "task_share", id: curId, share }) });
                      if (r.ok) { setShot({ ...shot, share }); toast(share ? "แสดงรูปนี้ในสมุดภาพของครอบครัวแล้ว" : "ซ่อนรูปนี้จากครอบครัวแล้ว"); } else toast("เปลี่ยนการแชร์ไม่สำเร็จ");
                    }} /><span><b>แสดงในสมุดภาพของครอบครัว</b><small>เอาติ๊กออกเพื่อซ่อนรูปนี้จากญาติ (บันทึกในประวัติการใช้งาน)</small></span></label>
                  </>) : <p className="rounded-xl bg-cream-50 px-4 py-3 text-sm text-gold-600">ไม่มีรูปหลักฐาน (ส่งก่อนระบบเก็บรูป หรืออัปโหลดไม่สำเร็จ)</p>}
                {!filled(cur[9]) && !filled(cur[7]) && shot && !shot.photo && <p className="mt-2 text-xs text-gold-500">พนักงานไม่ได้เขียนบันทึกเพิ่ม</p>}
              </div>
            </section>

            <section className="review-sec">
              <h4>ผลการตรวจ</h4>
              <div className="review-rate" role="radiogroup" aria-label="ให้ดาว">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={star === String(n)} aria-label={`${n} ดาว · ${STAR_TEXT[n]}`}
                    className={Number(star) >= n ? "is-on" : ""} onClick={() => setStar(String(n))}><Icon name="star" className="h-8 w-8" /></button>
                ))}
                <span className="review-star-text"><b>{star} ดาว</b> · {STAR_TEXT[Number(star)]}</span>
              </div>
              <p className="text-xs text-gold-500">ดาวนับเข้า KPI ของ {doer}</p>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_NOTES.map((q) => {
                  const on = note.includes(q);
                  return <button key={q} type="button" aria-pressed={on} className={`review-chip ${on ? "is-on" : ""}`}
                    onClick={() => setNote(on ? note.replace(q, "").replace(/\s*·\s*·\s*/g, " · ").replace(/^\s*·\s*|\s*·\s*$/g, "").trim() : note.trim() ? `${note.trim()} · ${q}` : q)}>{on ? "✓ " : "+ "}{q}</button>;
                })}
              </div>
              <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} aria-label="ความคิดเห็น / ข้อเสนอแนะ" placeholder="ความคิดเห็นถึงพนักงาน (ไม่บังคับ) · กดข้อความด้านบนเพื่อเติมเร็ว" />
            </section>
            </div>)}
          </div>
          );
        })()}
      </Modal>
    </>
  );
}
