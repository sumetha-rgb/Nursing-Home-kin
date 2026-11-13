"use client";
import { useCallback, useEffect, useState } from "react";
import { Section } from "../ui";
import { useApp } from "@/lib/app";

export type TurnRisk = { name: string; room: string | null; branch: string | null; braden: string | null; mobility: string | null };
type Phase = "late" | "todo" | "review" | "done";
/** รอบพลิกตัว 12 รอบต่อวัน (ทุก 2 ชั่วโมง) · ชื่องาน "พลิกตัว HH:00" ไม่ซ้ำกันต่อรอบ (งานประจำแยกด้วยชื่อ+กะ) */
export const TURN_HOURS = Array.from({ length: 12 }, (_, i) => `${String(i * 2).padStart(2, "0")}:00`);
export const turnTask = (hh: string) => `พลิกตัว ${hh}`;
const shiftOf = (time: string) => { const h = Number(time.slice(0, 2)); return h >= 7 && h < 19 ? "กะเช้า" : "กะดึก"; };

/**
 * ตารางพลิกตัวทุก 2 ชั่วโมง: ผู้ที่ Braden ต่ำกว่า 13 หรือติดเตียง (จากประเมินแรกรับ)
 *  ยังไม่ได้ตั้ง = ปุ่มตั้งงานประจำ 12 รอบ (สร้างเป็นงานประจำวันใน KinApp ทุกวัน) · ตั้งแล้ว = แถบ 12 ช่องของวันที่เลือก (เขียว ทำแล้ว · แดง เลยเวลา · กรอบทอง รอบนี้)
 */
export default function TurningBoard({ rows, phase, routineTasks, isToday, canSetup, onChanged }: {
  rows: string[][]; phase: (r: string[]) => Phase; routineTasks: { resident_name: string; task_name: string }[];
  isToday: boolean; canSetup: boolean; onChanged: () => void;
}) {
  const { toast, confirm } = useApp();
  const [risk, setRisk] = useState<TurnRisk[] | null>(null);
  const [busy, setBusy] = useState("");
  const load = useCallback(() => { fetch("/api/care?op=turning_risk", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { items: [] })).then((d) => setRisk(d.items ?? [])).catch(() => setRisk([])); }, []);
  useEffect(load, [load]);
  if (!risk?.length) return null;
  const hasRoutine = (who: string) => routineTasks.some((t) => t.resident_name === who && t.task_name.startsWith("พลิกตัว "));
  const nowH = new Date().getHours();
  const curSlot = TURN_HOURS[Math.floor(nowH / 2)];
  const setup = (p: TurnRisk) => confirm({
    title: "ตั้งตารางพลิกตัวทุก 2 ชั่วโมง", okLabel: "ตั้งงานประจำ 12 รอบ",
    message: `${p.name}${p.braden ? ` · Braden ${p.braden}` : ""}${p.mobility ? ` · ${p.mobility}` : ""} · ระบบสร้างงาน "พลิกตัว" 00:00 ถึง 22:00 ทุก 2 ชั่วโมงใน KinApp ทุกวัน (หยุดได้ที่เมนู งานประจำ)`,
    onOk: async () => {
      setBusy(p.name);
      const items = TURN_HOURS.map((hh) => ({ resident: p.name, task: turnTask(hh), ins: `พลิกตะแคงตัว ตรวจผิวหนังจุดกดทับ${p.braden ? ` (Braden ${p.braden})` : ""}`, shift: shiftOf(hh), time: hh }));
      const r = await fetch("/api/care", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "routines_add", items }) });
      const d = await r.json().catch(() => ({}));
      setBusy("");
      if (!r.ok) return toast(d.error || "ตั้งงานไม่สำเร็จ");
      toast(`ตั้งตารางพลิกตัวแล้ว · ${p.name} · ${d.added ?? 0} รอบ · ขึ้นใน KinApp`);
      onChanged();
    },
  });
  return (
    <Section title="ตารางพลิกตัวทุก 2 ชั่วโมง" sub="ผู้ที่ Braden ต่ำกว่า 13 หรือติดเตียง (จากประเมินแรกรับ) · เขียว = ทำแล้ว · แดง = เลยเวลายังไม่ได้ทำ · กรอบทอง = รอบนี้">
      <ul className="turn-list">
        {risk.map((p) => {
          const mine = rows.filter((r) => r[0] === p.name && r[1].startsWith("พลิกตัว "));
          const set = hasRoutine(p.name);
          return (
            <li key={`${p.branch}-${p.name}`}>
              <div className="turn-who"><b>{p.name}</b><span>{[p.room && p.room !== "-" ? `ห้อง ${p.room}` : "", p.braden ? `Braden ${p.braden}` : "", p.mobility === "ติดเตียง" ? "ติดเตียง" : ""].filter(Boolean).join(" · ")}</span></div>
              {mine.length ? <div className="turn-slots" role="list" aria-label={`รอบพลิกตัวของ ${p.name}`}>
                {TURN_HOURS.map((hh) => {
                  const r = mine.find((x) => x[1] === turnTask(hh));
                  const ph = r ? phase(r) : null;
                  const cls = !r ? "is-none" : ph === "done" || ph === "review" ? "is-done" : ph === "late" ? "is-miss" : isToday && hh === curSlot ? "is-now" : "";
                  const label = !r ? "ไม่มีงาน" : ph === "done" || ph === "review" ? "ทำแล้ว" : ph === "late" ? "เลยเวลา" : "รอทำ";
                  return <span key={hh} role="listitem" className={cls} title={`${hh} · ${label}`}>{hh.slice(0, 2)}</span>;
                })}
              </div> : set ? <p className="turn-note">ตั้งไว้แล้ว · งานของวันนี้จะขึ้นเมื่อเปิดวันนั้นครั้งแรก</p>
                : canSetup ? <button type="button" className="btn-soft !min-h-0 !py-1.5 !text-sm" disabled={busy === p.name} onClick={() => setup(p)}>{busy === p.name ? "กำลังตั้ง…" : "ตั้งพลิกตัวทุก 2 ชม."}</button>
                : <p className="turn-note">ยังไม่ได้ตั้งตารางพลิกตัว · แจ้งหัวหน้าพยาบาล</p>}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
