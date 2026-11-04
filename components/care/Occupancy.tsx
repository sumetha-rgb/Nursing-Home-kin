"use client";
import { useEffect } from "react";
import Icon from "../Icon";
import { MetricGrid, Section, Tile } from "../ui";
import { downloadCsv } from "@/lib/store";
import { RESIDENTS } from "@/lib/mock";
import { useCrud } from "@/lib/store";
import { branchBeds, roomInfos } from "@/lib/rooms";
import { useApp } from "@/lib/app";

/**
 * อัตราการเข้าพัก: เตียงทั้งหมด / พักอยู่ / ว่าง และตารางเทียบรายสาขา (นับจากห้องในเมนูห้องพักและเตียง)
 * ผู้จัดการสาขาเห็นเฉพาะสาขาตัวเอง · ผู้บริหารเห็นทุกสาขา
 */
export default function Occupancy({ compact, onTiles }: { compact?: boolean; onTiles?: (t: Tile[]) => void } = {}) {
  const rooms = useCrud("rooms", []);
  const res = useCrud("residents", RESIDENTS);
  const { go } = useApp();
  const rows = branchBeds(roomInfos(rooms.rows, res.rows));
  const sum = rows.reduce((a, r) => ({ cap: a.cap + r.capacity, people: a.people + r.people, free: a.free + r.free, full: a.full + r.full }), { cap: 0, people: 0, free: 0, full: 0 });
  const pct = sum.cap ? Math.round((sum.people / sum.cap) * 100) : 0;
  const tiles: Tile[] = [
        { label: "อัตราการเข้าพัก", value: `${pct}%`, icon: "bed", accent: true, note: `${sum.people}/${sum.cap} เตียง` },
        { label: "เตียงทั้งหมด", value: sum.cap, unit: "เตียง", icon: "building" },
        { label: "เตียงว่าง", value: sum.free, unit: "เตียง", icon: "check", note: sum.full ? `ห้องเต็ม ${sum.full} ห้อง` : undefined },
        { label: "ผู้พักอยู่", value: sum.people, unit: "คน", icon: "user", note: "รวมผู้ที่มัดจำจองห้อง" },
  ];
  const key = JSON.stringify(tiles.map((t) => [t.label, t.value, t.note]));
  useEffect(() => { onTiles?.(tiles); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (rooms.loaded && !rows.length) return <Section title="อัตราการเข้าพัก" sub="ยังไม่มีห้องในระบบ"><p className="text-sm text-gold-500">สร้างห้องที่เมนูห้องพักและเตียงก่อน เพื่อดูอัตราการเข้าพักและเตียงว่าง <button className="text-gold-700 underline underline-offset-4" onClick={() => go("rooms")}>ไปที่ห้องพักและเตียง</button></p></Section>;
  if (compact) return <MetricGrid items={tiles} />;
  return (
    <div className="mb-6">
      <MetricGrid items={tiles} />
      <Section title="อัตราการเข้าพักรายสาขา" sub="นับจากห้องที่กำหนดไว้ในเมนูห้องพักและเตียง" actions={<>
        <button className="btn-soft" onClick={() => downloadCsv("การเข้าพักรายสาขา", ["สาขา", "เตียงทั้งหมด", "ผู้พักอยู่", "เตียงว่าง", "อัตราการเข้าพัก (%)", "ห้องเต็ม"], rows.map((r) => [r.branch, String(r.capacity), String(r.people), String(r.free), String(r.pct), String(r.full)]))}><Icon name="download" className="h-4 w-4" /> ส่งออก CSV</button>
        <button className="btn-soft" onClick={() => go("rooms")}>ดูห้องพักและเตียง</button></>}>
        <div className="space-y-3">
          {rows.map((r) => (
            <div key={r.branch} className="grid items-center gap-x-4 gap-y-1 sm:grid-cols-[170px_1fr_auto]">
              <b className="font-medium text-gold-800">{r.branch}</b>
              <span className="room-meter" aria-hidden><span style={{ width: `${Math.min(100, r.pct)}%`, background: r.pct >= 100 ? "#b3261e" : undefined }} /></span>
              <span className="text-sm text-gold-600">{r.people}/{r.capacity} เตียง · <b className="text-gold-800">{r.pct}%</b> · ว่าง {r.free}{r.full ? ` · เต็ม ${r.full} ห้อง` : ""}</span>
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
}
