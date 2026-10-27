"use client";
import { useMemo, useState } from "react";
import Icon from "../Icon";
import { MASTER_TASKS } from "@/lib/mock";
import { useCrud } from "@/lib/store";
import { useApp } from "@/lib/app";
import { useResidents } from "@/lib/care";
import { DataTable, Field, FieldDef, FormDialog, MetricGrid, Modal, PageHeader, Section, Select, Tabs } from "../ui";

/**
 * งานประจำวัน: ผู้จัดการมอบหมายงาน → ขึ้นใน "งานวันนี้" ของ KinApp → พนักงานส่งงาน → ผู้จัดการตรวจ
 * แถวของชุดข้อมูล daily-YYYY-MM-DD:
 * [ผู้รับบริการ, ชื่องาน, ผู้รับผิดชอบ, เวลา, กะ, สถานะ, คำสั่งงาน, สัญญาณชีพ, เวลาที่ส่งจริง, บันทึกจากผู้ทำ, ผู้ส่งงาน]
 */
const COLS = ["ผู้รับบริการ", "ชื่องาน", "ผู้ทำ", "เวลา", "กะ", "สถานะ"];
const SHIFTS = ["ทั้งหมด", "กะเช้า", "กะดึก"];
const SHIFT_TIME: Record<string, string> = { กะเช้า: "08:00", กะดึก: "20:00" };
const blankRow = (who: string, task: string, time: string, shift: string, ins: string, by = "-") => [who, task, by, time, shift, "รอทำ", ins || "-", "-", "-", "-", "-"];

const isoOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const todayIso = () => isoOf(new Date());
const prevIso = (iso: string) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() - 1); return isoOf(d); };
const thaiDate = (iso: string) =>
  iso ? new Date(iso + "T00:00:00").toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric", weekday: "long" }) : "";
const shiftOf = (time: string) => { const h = Number(time.slice(0, 2)); return h >= 7 && h < 19 ? "กะเช้า" : "กะดึก"; };

export function DailyTasks() {
  const [date, setDate] = useState(todayIso);
  const [shift, setShift] = useState("ทั้งหมด");
  // งานแยกตามวันที่ · วันที่ยังไม่มีงานจะว่าง (ไม่ใส่ข้อมูลตัวอย่างให้เอง) สร้างจากคลังงานหรือคัดลอกจากวันก่อน
  const { rows, add, update, remove } = useCrud(`daily-${date}`, []);
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

  const names = useMemo(() => residents.filter((r) => !r.status || r.status.startsWith("เข้าอยู่")).map((r) => r.full_name), [residents]);
  const shown = rows.map((r, k) => ({ r, k })).filter(({ r }) => shift === "ทั้งหมด" || r[4] === shift).sort((a, b) => String(a.r[3]).localeCompare(String(b.r[3])));
  const checked = shown.filter(({ r }) => r[5] === "ตรวจแล้ว").length;
  const pending = shown.filter(({ r }) => r[5] === "เสร็จแล้ว").length;
  const waiting = shown.filter(({ r }) => r[5] === "รอทำ").length;
  const pct = shown.length ? Math.round((checked / shown.length) * 100) : 0;
  const count = (s: string) => rows.filter((r) => s === "ทั้งหมด" || r[4] === s).length;
  const cur = i !== null ? rows[i] : null;
  const exists = (who: string, task: string, sh: string) => rows.some((r) => r[0] === who && r[1] === task && r[4] === sh);

  /** มอบหมายจากคลังงาน: ผู้รับบริการที่เลือก × งานที่เลือก (งาน "ทั้งสองกะ" สร้างทั้งกะเช้าและกะดึก) ข้ามงานที่มีอยู่แล้ว */
  const doAssign = () => {
    if (!pickRes.length) return setAssignErr("กรุณาเลือกผู้รับบริการอย่างน้อย 1 คน");
    if (!pickTask.length) return setAssignErr("กรุณาเลือกงานจากคลังงานอย่างน้อย 1 งาน");
    let made = 0, skipped = 0;
    for (const who of pickRes) for (const ti of pickTask) {
      const t = master[ti];
      const shifts = t[4] === "ทั้งสองกะ" ? ["กะเช้า", "กะดึก"] : [t[4] === "กะดึก" ? "กะดึก" : "กะเช้า"];
      for (const sh of shifts) {
        if (exists(who, t[1], sh)) { skipped++; continue; }
        add(blankRow(who, t[1], times[sh], sh, t[2])); made++;
      }
    }
    setAssign(false); setPickRes([]); setPickTask([]); setAssignErr("");
    toast(`มอบหมายงานแล้ว ${made} งาน${skipped ? ` (ข้ามงานที่มีอยู่แล้ว ${skipped})` : ""} · ขึ้นใน KinApp ของพนักงานแล้ว`);
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
    { label: "ผู้รับบริการ", options: names, required: true },
    { label: "ชื่องาน", required: true },
    { label: "เวลา", type: "time", required: true },
    { label: "คำสั่งงาน", area: true },
  ];

  return (
    <>
      <PageHeader
        title="ตรวจงานประจำวัน (Daily Tasks)"
        sub="มอบหมายงานให้ทีมดูแล งานจะขึ้นใน KinApp ของพนักงาน ส่งงานแล้วกลับมาให้ตรวจที่หน้านี้"
        actions={<>
          <button className="btn-soft" onClick={copyPrev}><Icon name="files" className="h-4 w-4" /> คัดลอกงานจากวันก่อน</button>
          <button className="btn-soft" onClick={() => setAddOpen(true)}><Icon name="plus" className="h-4 w-4" /> เพิ่มงาน</button>
          <button className="btn-primary" onClick={() => { setAssignErr(""); setAssign(true); }}><Icon name="book" className="h-4 w-4" /> มอบหมายจากคลังงานมาตรฐาน</button>
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

      <MetricGrid items={[{ label: "งานในกะที่เลือก", value: shown.length, unit: "งาน", accent: true, icon: "check" }, { label: "รอพนักงานทำ", value: waiting, unit: "งาน", icon: "calendar" }, { label: "ส่งแล้ว รอผู้จัดการตรวจ", value: pending, unit: "งาน", icon: "search" }, { label: "ตรวจเรียบร้อย", value: checked, unit: "งาน", icon: "check", note: `ความคืบหน้า ${pct}%` }]} />
      <div className="mt-6">
        <Section title="รายการงาน" actions={<Tabs tabs={SHIFTS.map((s) => `${s} (${count(s)})`)} value={`${shift} (${count(shift)})`} onChange={(t) => setShift(t.split(" (")[0])} />}>
          <DataTable
            columns={COLS}
            rows={shown.map(({ r }) => [r[0], r[1], r[10] && r[10] !== "-" ? r[10] : r[2], r[3], r[4], r[5]])}
            empty="ยังไม่มีงานของวันนี้ · กด &quot;มอบหมายจากคลังงานมาตรฐาน&quot; หรือ &quot;คัดลอกงานจากวันก่อน&quot;"
            actions={[
              { label: "ตรวจงาน", onClick: (n) => { setI(shown[n].k); setStar("5"); setNote(""); } },
              { label: "ลบ", danger: true, onClick: (n) => { const k = shown[n].k; confirm({ title: "ลบงาน", message: `ลบงาน "${rows[k][1]}" ของ ${rows[k][0]} ใช่หรือไม่`, danger: true, okLabel: "ลบ", onOk: () => { remove(k); toast("ลบงานแล้ว"); } }); } },
            ]}
          />
        </Section>
      </div>

      {/* มอบหมายจากคลังงาน */}
      <Modal open={assign} wide title="มอบหมายงานจากคลังงานมาตรฐาน" onClose={() => setAssign(false)}
        footer={<><button className="btn-soft" onClick={() => setAssign(false)}>ยกเลิก</button><button className="btn-primary" onClick={doAssign}>มอบหมาย {pickRes.length * pickTask.length > 0 ? `(${pickRes.length} คน × ${pickTask.length} งาน)` : ""}</button></>}>
        <p className="form-intro">เลือกผู้รับบริการและงาน ระบบสร้างงานของวันที่ {thaiDate(date)} ให้ทุกคู่ งาน &quot;ทั้งสองกะ&quot; สร้างทั้งกะเช้าและกะดึก</p>
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center justify-between"><p className="label !mb-0">1. ผู้รับบริการ ({pickRes.length})</p><button type="button" className="text-xs font-medium text-gold-700 underline-offset-2 hover:underline" onClick={() => setPickRes(pickRes.length === names.length ? [] : names)}>{pickRes.length === names.length ? "ไม่เลือกทั้งหมด" : "เลือกทั้งหมด"}</button></div>
            <ul className="pick-list">{names.map((n) => <li key={n}><label><input type="checkbox" checked={pickRes.includes(n)} onChange={() => { setAssignErr(""); setPickRes(pickRes.includes(n) ? pickRes.filter((x) => x !== n) : [...pickRes, n]); }} /> {n}</label></li>)}</ul>
            {!names.length && <p className="text-sm text-gold-500">ยังไม่มีผู้รับบริการในสาขา</p>}
          </div>
          <div>
            <p className="label">2. งานจากคลังงานมาตรฐาน ({pickTask.length})</p>
            <ul className="pick-list">{master.map((t, k) => <li key={k}><label><input type="checkbox" checked={pickTask.includes(k)} onChange={() => { setAssignErr(""); setPickTask(pickTask.includes(k) ? pickTask.filter((x) => x !== k) : [...pickTask, k]); }} /> <span>{t[1]} <small className="text-gold-500">· {t[4]} · {t[6]}</small></span></label></li>)}</ul>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <Field label="3. เวลางานกะเช้า"><input type="time" value={times["กะเช้า"]} onChange={(e) => setTimes({ ...times, กะเช้า: e.target.value })} /></Field>
          <Field label="เวลางานกะดึก"><input type="time" value={times["กะดึก"]} onChange={(e) => setTimes({ ...times, กะดึก: e.target.value })} /></Field>
        </div>
        {assignErr && <p role="alert" className="form-error mt-4"><Icon name="alert" className="h-4 w-4 shrink-0" />{assignErr}</p>}
      </Modal>

      <FormDialog open={addOpen} mode="add" title="เพิ่มงานประจำวัน" fields={ADD_FIELDS} onClose={() => setAddOpen(false)} saveLabel="เพิ่มงาน"
        onSave={(v) => {
          if (!v[0] || !v[1].trim() || !v[2]) return toast("กรุณากรอกผู้รับบริการ ชื่องาน และเวลา");
          const sh = shiftOf(v[2]);
          if (exists(v[0], v[1].trim(), sh)) return toast("มีงานนี้ของผู้รับบริการคนนี้ในกะนี้แล้ว");
          add(blankRow(v[0], v[1].trim(), v[2], sh, v[3])); setAddOpen(false); toast(`เพิ่มงานแล้ว (${sh}) · ขึ้นใน KinApp ของพนักงานแล้ว`);
        }} />

      <Modal
        open={cur !== null} wide title="ตรวจสอบผลการปฏิบัติงาน" onClose={() => setI(null)}
        footer={<>
          <button className="btn-soft" onClick={() => setI(null)}>ยกเลิก</button>
          <button className="btn-primary" onClick={() => {
            if (i === null || !cur) return;
            if (cur[5] === "รอทำ") { toast("งานนี้พนักงานยังไม่ได้ส่ง ยังตรวจไม่ได้"); return; }
            update(i, cur.map((c, j) => (j === 5 ? "ตรวจแล้ว" : c)));
            setI(null); toast("บันทึกผลการตรวจแล้ว");
          }}>บันทึกผลการตรวจ</button>
        </>}
      >
        {cur && (
          <div className="space-y-5">
            <dl className="grid gap-3 rounded-xl bg-cream-50 p-4 text-sm sm:grid-cols-2">
              <div><dt className="text-gold-500">ผู้รับบริการ</dt><dd className="font-medium">{cur[0]}</dd></div>
              <div><dt className="text-gold-500">ชื่องาน</dt><dd className="font-medium">{cur[1]}</dd></div>
              <div className="sm:col-span-2"><dt className="text-gold-500">คำสั่งงาน</dt><dd className="font-medium">{cur[6]}</dd></div>
              <div className="sm:col-span-2"><dt className="text-gold-500">บันทึกจากผู้ทำ</dt><dd className="font-medium">{cur[9] || "-"}</dd></div>
              <div className="sm:col-span-2"><dt className="text-gold-500">บันทึกค่าสัญญาณชีพ (Vital Signs)</dt><dd className="font-medium">{cur[7]}</dd></div>
              <div><dt className="text-gold-500">ผู้ปฏิบัติงาน</dt><dd className="font-medium">{cur[10] && cur[10] !== "-" ? cur[10] : cur[2]}</dd></div>
              <div><dt className="text-gold-500">เวลาที่กำหนด</dt><dd className="font-medium">{cur[3]} ({cur[4]})</dd></div>
              <div><dt className="text-gold-500">เวลาที่ส่งจริง</dt><dd className="font-medium">{cur[8]}</dd></div>
              <div><dt className="text-gold-500">สถานะ</dt><dd className="font-medium">{cur[5]}</dd></div>
            </dl>
            <Field label="ให้ดาว (ความพึงพอใจ)"><Select options={["5", "4", "3", "2", "1"]} value={star} onChange={setStar} /></Field>
            <Field label="ความคิดเห็น / ข้อเสนอแนะ"><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
        )}
      </Modal>
    </>
  );
}
