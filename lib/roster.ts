"use client";

/** ตารางเวร: ตัวช่วยฝั่งหน้าเว็บสำหรับ /api/roster */
export const SHIFTS = [
  { key: "เช้า", label: "เวรเช้า", time: "07:00–19:00" },
  { key: "ดึก", label: "เวรดึก", time: "19:00–07:00" },
] as const;
export type Shift = { id: string; branch_name: string; staff_id: string; staff_name: string; date: string; shift: string };
export type Attendance = { id: string; staff_id: string; staff_name: string; date: string; shift: string | null; kind: "in" | "out"; time: string; late_min: number | null; photo?: string };
export type Month = { shifts: Shift[]; attendance: Attendance[]; team: { id: string; name: string; role: string }[]; branch: string | null; me: { id: string; name: string; role: string } };

async function call<T>(url: string, body?: object): Promise<T> {
  const r = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "บันทึกไม่สำเร็จ");
  return d as T;
}
export const fetchMonth = (ym: string, branch?: string) => call<Month>(`/api/roster?op=month&ym=${ym}${branch ? `&branch=${encodeURIComponent(branch)}` : ""}`);
export const fetchDay = (date: string, branch?: string) => call<{ attendance: Attendance[] }>(`/api/roster?op=day&date=${date}${branch ? `&branch=${encodeURIComponent(branch)}` : ""}`);
export const fetchToday = () => call<{ now: { d: string; t: string }; shift: { date: string; shift: string } | null; attendance: { kind: string; time: string; late_min: number | null }[] }>("/api/roster?op=today");
export const assignShift = (date: string, shift: string, staffIds: string[], branch?: string) => call<{ ok: boolean; count: number }>("/api/roster", { op: "assign", date, shift, staffIds, branch });
export const checkIn = (kind: "in" | "out", photo: string) => call<{ ok: boolean; at: string; shift: string | null; late: number | null }>("/api/roster", { op: "checkin", kind, photo });

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const ymOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
export const monthTitle = (ym: string) => new Date(ym + "-01T00:00:00").toLocaleDateString("th-TH", { month: "long", year: "numeric" });
export const dayTitle = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
export const shiftMonth = (ym: string, n: number) => { const d = new Date(ym + "-01T00:00:00"); d.setMonth(d.getMonth() + n); return ymOf(d); };
/** ช่องวันของเดือน เริ่มวันจันทร์ (null = ช่องว่างก่อนวันที่ 1) */
export function monthCells(ym: string) {
  const first = new Date(ym + "-01T00:00:00");
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${ym}-${pad(i + 1)}`)] as (string | null)[];
}
export const WEEKDAYS = ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."];
/** ชื่อย่อสำหรับช่องปฏิทิน: ตัดคำนำหน้าและวงเล็บ */
export const shortName = (n: string) => n.replace(/\s*\(.*?\)\s*/g, "").replace(/^(คุณ|นาย|นางสาว|นาง|พว\.)\s*/, "").split(" ")[0] || n;

/**
 * ประทับวันที่ เวลา ชื่อ และสาขาลงรูป (มุมล่าง) แล้วย่อเหลือด้านยาว 640px เพื่อเก็บเป็นหลักฐาน
 * เวลาบนรูปมาจากเครื่อง ส่วนเวลาที่บันทึกจริงใช้เวลาของ server
 */
export function stampPhoto(dataUrl: string, lines: string[]) {
  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 640 / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0, c.width, c.height);
      const fs = Math.max(14, Math.round(c.width / 28));
      const h = lines.length * fs * 1.45 + fs;
      g.fillStyle = "rgba(20,16,10,.62)"; g.fillRect(0, c.height - h, c.width, h);
      g.fillStyle = "#fff"; g.textBaseline = "top";
      lines.forEach((t, i) => { g.font = `${i === 0 ? "700 " : ""}${i === 0 ? fs * 1.15 : fs}px "Noto Sans Thai", Tahoma, sans-serif`; g.fillText(t, fs * 0.6, c.height - h + fs * 0.5 + i * fs * 1.45); });
      resolve(c.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = () => reject(new Error("เปิดรูปไม่ได้"));
    img.src = dataUrl;
  });
}
