/**
 * ห้องผู้ป่วย (ชุดข้อมูล "rooms") และการนับคนในห้อง ใช้ได้ทั้งหน้าห้องผู้ป่วยและฟอร์มเปิดสัญญา
 * แถวห้อง: [เลขห้อง, สาขา, ประเภทห้อง, จำนวนผู้ป่วยต่อห้อง, ค่าห้อง/เดือน, สถานะ, หมายเหตุ, ชั้น/โซน]
 * แถวผู้รับบริการ: [ชื่อ, อายุ, ห้อง, สาขา, โรคประจำตัว, สถานะ, HN, เตียง] · คนที่ย้ายออกแล้วไม่นับ
 * เตียงตั้งชื่อตามลำดับ A, B, C… ตามจำนวนผู้ป่วยต่อห้อง · คนที่ยังไม่ได้ระบุเตียง (ข้อมูลเก่า) ได้เตียงว่างลำดับแรกให้อัตโนมัติ
 */
export const ROOM_TYPES = ["ห้องเดี่ยว", "ห้องคู่", "ห้องรวม", "ห้องพิเศษ (VIP)"];
export const ROOM_STATUSES = ["พร้อมใช้งาน", "ปิดปรับปรุง"];

export type RoomInfo = {
  /** ตำแหน่งในชุดข้อมูล rooms (ใช้แก้/ลบ) */
  i: number;
  no: string; branch: string; type: string; capacity: number; rate: string; status: string; note: string;
  /** ชั้น/โซน (ว่าง = ทั่วไป) */
  floor: string;
  /** ชื่อผู้รับบริการที่พักอยู่ */
  people: string[];
  /** เตียงทุกเตียงของห้อง: ป้ายเตียง และชื่อผู้พัก (ไม่มี = ว่าง) */
  beds: { label: string; who?: string }[];
  free: number;
  full: boolean;
  closed: boolean;
};

export const roomKey = (x: string) => x.trim().replace(/\s+/g, " ").toLowerCase();
const blank = (x?: string) => !x || x.trim() === "" || x.trim() === "-";
export const staying = (status: string) => !status.startsWith("ย้ายออก");

/** ป้ายเตียงลำดับที่ i (0 = A) */
export const bedLabel = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String(i + 1));

/** ห้องทั้งหมดพร้อมคนที่พักอยู่ (เรียงตามสาขา ชั้น แล้วเลขห้อง) */
export function roomInfos(rooms: string[][], residents: string[][]): RoomInfo[] {
  return rooms.map((r, i) => {
    const capacity = Math.max(1, parseInt(r[3], 10) || 1);
    const stay = residents.filter((p) => staying(p[5] ?? "") && p[3] === r[1] && !blank(p[2]) && roomKey(p[2]) === roomKey(r[0]));
    const people = stay.map((p) => p[0]);
    const labels = Array.from({ length: capacity }, (_, k) => bedLabel(k));
    const beds: RoomInfo["beds"] = labels.map((label) => ({ label }));
    const rest: string[] = [];
    // คนที่ระบุเตียงไว้ได้เตียงนั้น (ถ้าซ้ำหรือเตียงเกินจำนวน ถือว่ายังไม่ได้ระบุ) · ที่เหลือได้เตียงว่างตามลำดับ
    for (const p of stay) { const b = beds.find((x) => x.label === (p[7] ?? "")); if (b && !b.who) b.who = p[0]; else rest.push(p[0]); }
    for (const name of rest) { const b = beds.find((x) => !x.who); if (b) b.who = name; }
    const closed = r[5] === "ปิดปรับปรุง";
    return { i, no: r[0], branch: r[1], type: r[2] || "-", capacity, rate: r[4], status: r[5], note: r[6] ?? "", floor: (r[7] ?? "").trim(), people, beds, free: Math.max(0, capacity - people.length), full: people.length >= capacity, closed };
  }).sort((a, b) => a.branch.localeCompare(b.branch, "th") || a.floor.localeCompare(b.floor, "th", { numeric: true }) || a.no.localeCompare(b.no, "th", { numeric: true }));
}

/** เตียงว่างลำดับแรกของห้อง (who = ผู้ที่ย้ายอยู่แล้ว ถือว่าเตียงของตัวเองว่าง) · ไม่มี = "" */
export const freeBed = (room: RoomInfo | undefined, who?: string) => room?.beds.find((b) => !b.who || b.who === who)?.label ?? "";

/** แถวผู้รับบริการหลังเปลี่ยนห้อง/เตียง (คงช่อง HN ไว้) */
export function withRoom(r: string[], room: string, bed: string, status?: string): string[] {
  return [r[0], r[1], room, r[3], r[4], status ?? r[5], r[6] ?? "", bed];
}

/** ห้องของผู้รับบริการในสาขา (ไม่พบ = ห้องที่ยังไม่ได้สร้างในระบบ หรือไม่ได้ระบุห้อง) */
export const findRoom = (list: RoomInfo[], branch: string, room: string) =>
  blank(room) ? undefined : list.find((r) => r.branch === branch && roomKey(r.no) === roomKey(room));

/** ข้อความเตือนเมื่อจะให้ผู้รับบริการ (who) เข้าห้องนี้ ว่างเปล่า = เข้าได้ (ขึ้นต้น "ไม่สามารถ" = แสดงเป็นคำเตือนสีแดง) */
export function roomProblem(room: RoomInfo | undefined, who?: string) {
  if (!room) return "";
  if (room.closed) return `ไม่สามารถเลือกห้อง ${room.no} ได้ ห้องปิดปรับปรุงอยู่`;
  const others = room.people.filter((p) => p !== who);
  if (others.length >= room.capacity) return `ไม่สามารถเลือกห้อง ${room.no} ได้ ห้องเต็มแล้ว (${others.length}/${room.capacity} คน) กรุณาเลือกห้องอื่น หรือเพิ่มจำนวนผู้ป่วยต่อห้อง`;
  return "";
}

/** ป้ายสถานะห้อง */
export const roomLabel = (r: RoomInfo) => (r.closed ? "ปิดปรับปรุง" : r.full ? "เต็ม" : r.people.length ? `ว่าง ${r.free} เตียง` : "ห้องว่าง");

/** สรุปเตียงของสาขา (นับเฉพาะห้องที่เปิดใช้งาน · คนที่มัดจำจองห้องนับรวม) */
export type BranchBeds = { branch: string; rooms: number; closed: number; capacity: number; people: number; free: number; full: number; pct: number };
export function branchBeds(list: RoomInfo[]): BranchBeds[] {
  const by = new Map<string, RoomInfo[]>();
  for (const r of list) by.set(r.branch, [...(by.get(r.branch) ?? []), r]);
  return [...by].map(([branch, rs]) => {
    const open = rs.filter((r) => !r.closed);
    const capacity = open.reduce((n, r) => n + r.capacity, 0), people = open.reduce((n, r) => n + r.people.length, 0);
    return { branch, rooms: rs.length, closed: rs.length - open.length, capacity, people, free: open.reduce((n, r) => n + r.free, 0), full: open.filter((r) => r.full).length, pct: capacity ? Math.round((people / capacity) * 100) : 0 };
  }).sort((a, b) => a.branch.localeCompare(b.branch, "th"));
}
