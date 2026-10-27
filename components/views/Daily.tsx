"use client";
import { useState } from "react";
import Icon from "../Icon";
import { DAILY_LIST } from "@/lib/mock";
import { useCrud } from "@/lib/store";
import { useApp } from "@/lib/app";
import { DataTable, Field, MetricGrid, Modal, PageHeader, Section, Select, Tabs } from "../ui";

const COLS = ["ผู้รับบริการ", "ชื่องาน", "ผู้ทำ", "เวลา", "กะ", "สถานะ"];
const SHIFTS = ["ทั้งหมด", "กะเช้า", "กะดึก"];

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const thaiDate = (iso: string) =>
  iso ? new Date(iso + "T00:00:00").toLocaleDateString("th-TH", { year: "numeric", month: "long", day: "numeric", weekday: "long" }) : "";

export function DailyTasks() {
  const [date, setDate] = useState(todayIso);
  const [shift, setShift] = useState("ทั้งหมด");
  // รายการงานแยกตามวันที่ เปลี่ยนวันแล้วได้ชุดงานของวันนั้น
  const { rows, update } = useCrud(`daily-${date}`, DAILY_LIST);
  const { toast } = useApp();
  const [i, setI] = useState<number | null>(null);
  const [star, setStar] = useState("5");
  const [note, setNote] = useState("");

  const shown = rows.map((r, k) => ({ r, k })).filter(({ r }) => shift === "ทั้งหมด" || r[4] === shift);
  const checked = shown.filter(({ r }) => r[5] === "ตรวจแล้ว").length;
  const pending = shown.filter(({ r }) => r[5] === "เสร็จแล้ว").length;
  const pct = shown.length ? Math.round((checked / shown.length) * 100) : 0;
  const count = (s: string) => rows.filter((r) => s === "ทั้งหมด" || r[4] === s).length;
  const cur = i !== null ? rows[i] : null;

  return (
    <>
      <PageHeader
        title="ตรวจงานประจำวัน (Daily Tasks)"
        sub="ติดตามสถานะการทำงานของพนักงานตามแผนการดูแล"
        actions={<button className="btn-primary" onClick={() => toast(`ซิงค์งานวันที่ ${thaiDate(date)} เรียบร้อย`)}><Icon name="refresh" className="h-4 w-4" /> ซิงค์งานวันนี้</button>}
      />

      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <Icon name="calendar" className="h-5 w-5 shrink-0 text-gold-600" />
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="เลือกวันที่" className="!w-auto font-medium" />
          {date !== todayIso() && <button className="btn-soft !py-2" onClick={() => setDate(todayIso())}>วันนี้</button>}
        </div>
        <p className="text-sm text-gold-600">{thaiDate(date)} <span className="text-gold-500">· ตัดกะ 07:00 น.</span></p>
      </div>

      <MetricGrid items={[{label:"งานในกะที่เลือก",value:shown.length,unit:"งาน",accent:true,icon:"check"},{label:"รอผู้จัดการตรวจ",value:pending,unit:"งาน",icon:"search"},{label:"ตรวจเรียบร้อย",value:checked,unit:"งาน",icon:"check"},{label:"ความคืบหน้าการตรวจ",value:pct+"%",note:"คำนวณจากรายการในกะที่เลือก",icon:"chart"}]} />
  <div className="mt-6">
        <Section title="รายการงานวันนี้" actions={<Tabs tabs={SHIFTS.map((s) => `${s} (${count(s)})`)} value={`${shift} (${count(shift)})`} onChange={(t) => setShift(t.split(" (")[0])} />}>
          <DataTable
            columns={COLS}
            rows={shown.map(({ r }) => r.slice(0, 6))}
            empty="ไม่มีงานในกะนี้"
            actions={[{ label: "ตรวจงาน", onClick: (n) => { setI(shown[n].k); setStar("5"); setNote(""); } }]}
          />
        </Section>
      </div>

      <Modal
        open={cur !== null} wide title="ตรวจสอบผลการปฏิบัติงาน" onClose={() => setI(null)}
        footer={<>
          <button className="btn-soft" onClick={() => setI(null)}>ยกเลิก</button>
          <button className="btn-primary" onClick={() => {
            if (i === null || !cur) return;
            if (cur[5] === "รอทำ") { toast("งานนี้ยังไม่ถูกส่ง ตรวจไม่ได้"); return; }
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
              <div className="sm:col-span-2"><dt className="text-gold-500">บันทึกค่าสัญญาณชีพ (Vital Signs)</dt><dd className="font-medium">{cur[7]}</dd></div>
              <div><dt className="text-gold-500">ผู้ปฏิบัติงาน</dt><dd className="font-medium">{cur[2]}</dd></div>
              <div><dt className="text-gold-500">เวลาที่กำหนด</dt><dd className="font-medium">{cur[3]} ({cur[4]})</dd></div>
              <div><dt className="text-gold-500">เวลาที่ส่งจริง</dt><dd className="font-medium">{cur[8]}</dd></div>
              <div><dt className="text-gold-500">สถานะ</dt><dd className="font-medium">{cur[5]}</dd></div>
            </dl>
            <div className="grid gap-3 sm:grid-cols-2">
              {["ภาพตัวอย่าง", "ภาพส่งงาน"].map((t) => (
                <div key={t}>
                  <p className="label">{t}</p>
                  <div className="grid h-28 place-items-center rounded-xl border border-dashed border-gold-300 bg-cream-50 text-sm text-gold-500">ไม่มีรูปถ่ายแนบมา</div>
                </div>
              ))}
            </div>
            <Field label="ให้ดาว (ความพึงพอใจ)"><Select options={["5", "4", "3", "2", "1"]} value={star} onChange={setStar} /></Field>
            <Field label="ความคิดเห็น / ข้อเสนอแนะ"><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
        )}
      </Modal>
    </>
  );
}
