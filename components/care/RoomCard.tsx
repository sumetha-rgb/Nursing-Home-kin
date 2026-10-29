"use client";
import { ReactNode } from "react";
import { RoomInfo, roomLabel } from "@/lib/rooms";

/** การ์ดห้องหนึ่งห้อง: เลขห้อง ประเภท คนที่พักอยู่/จำนวนผู้ป่วยต่อห้อง · onClick = เลือกห้อง (ขั้นเปิดสัญญา) */
export default function RoomCard({ room, selected, onClick, people, children }: {
  room: RoomInfo; selected?: boolean; onClick?: () => void; people?: ReactNode; children?: ReactNode;
}) {
  const cls = `room-card ${room.full ? "is-full" : ""} ${room.closed ? "is-closed" : ""} ${selected ? "is-selected" : ""}`;
  const badge = room.closed ? "status-neutral" : room.full ? "status-danger" : "status-success";
  const body = <>
    <div className="flex items-start justify-between gap-2">
      <div><p className="room-no">{room.no}</p><p className="room-meta">{room.floor ? `${room.floor} · ` : ""}{room.type}{room.rate && room.rate !== "-" ? ` · ${room.rate} บาท/เดือน` : ""}</p></div>
      <span className={`status-badge ${badge}`}>{roomLabel(room)}</span>
    </div>
    <span className="room-meter" aria-hidden><span style={{ width: `${Math.min(100, (room.people.length / room.capacity) * 100)}%` }} /></span>
    <p className="room-bedrow" aria-label={`พักอยู่ ${room.people.length} จาก ${room.capacity} เตียง`}>{room.beds.map((b) => <i key={b.label} className={b.who ? "is-taken" : ""} title={`เตียง ${b.label}${b.who ? ` · ${b.who}` : " · ว่าง"}`}>{b.label}</i>)}<span>{room.people.length}/{room.capacity} คน</span></p>
    {people ?? (room.people.length > 0 && <div className="room-people">{room.people.map((p) => <span key={p}>{p}</span>)}</div>)}
    {room.note && <p className="text-xs text-gold-500">{room.note}</p>}
    {children}
  </>;
  return onClick
    ? <button type="button" className={cls} aria-pressed={selected} onClick={onClick}>{body}</button>
    : <div className={cls}>{body}</div>;
}
