"use client";
import { memo, useMemo } from "react";
import { RoomInfo } from "@/lib/rooms";

/**
 * แผนผังห้องแบบ 3 มิติเอียง (isometric) วาดจากข้อมูลห้องล้วน ๆ ไม่ใช้รูปภาพหรือ WebGL (เบา ใช้ได้ทุกเครื่อง)
 * ในห้อง: เตียงคนไข้ (หัวเตียง ฟูก หมอน ผ้าห่ม) · เตียงที่มีผู้พักมีคนนอนอยู่ · ฉากกั้นระหว่างเตียง · ม่านรูดข้างเตียง · หน้าต่าง
 * สีพื้นและขอบห้อง: เขียว = ว่างทั้งห้อง · ทอง = มีคนบางส่วน · แดง = เต็ม · เทา = ปิดปรับปรุง
 */
const W = 264, H = 132, WALL = 60, GAP_X = 34, GAP_Y = 62;
type Pt = [number, number];
/** พิกัดพื้นห้อง (u,v 0-1) + ความสูง z (px) → จุดบนจอ */
const Pz = (u: number, v: number, z = 0): Pt => [((u - v) * W) / 2, ((u + v) * H) / 2 - z];
const P = (u: number, v: number): Pt => Pz(u, v, 0);
const pts = (a: Pt[]) => a.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");

/** ปรับความสว่างสี hex (+ สว่างขึ้น / − เข้มขึ้น) */
function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.max(0, Math.min(255, Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k))));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
/** กล่อง 3 มิติ: ด้านหน้าซ้าย (v=v1) ด้านหน้าขวา (u=u1) และด้านบน */
function Box({ u0, u1, v0, v1, z0, z1, c, stroke }: { u0: number; u1: number; v0: number; v1: number; z0: number; z1: number; c: string; stroke?: string }) {
  const s = stroke ?? shade(c, -0.22);
  return <g>
    <polygon points={pts([Pz(u0, v1, z0), Pz(u1, v1, z0), Pz(u1, v1, z1), Pz(u0, v1, z1)])} fill={shade(c, -0.1)} stroke={s} strokeWidth={0.7} />
    <polygon points={pts([Pz(u1, v0, z0), Pz(u1, v1, z0), Pz(u1, v1, z1), Pz(u1, v0, z1)])} fill={shade(c, -0.22)} stroke={s} strokeWidth={0.7} />
    <polygon points={pts([Pz(u0, v0, z1), Pz(u1, v0, z1), Pz(u1, v1, z1), Pz(u0, v1, z1)])} fill={c} stroke={s} strokeWidth={0.7} />
  </g>;
}

const TONE = {
  free: { floor: "#e6f3ea", edge: "#5f9c7b" },
  part: { floor: "#f9efd8", edge: "#b8955a" },
  full: { floor: "#f8e1dc", edge: "#b3261e" },
  closed: { floor: "#ece8e1", edge: "#a79f90" },
};
const toneOf = (r: RoomInfo) => (r.closed ? TONE.closed : r.full ? TONE.full : r.people.length ? TONE.part : TONE.free);
const WOOD = "#c9a274", WOOD_DARK = "#9c7a4e", SHEET = "#fbf8f1", BLANKET = "#9fbfd6", BLANKET_FREE = "#e7dcc4", SCREEN = "#efe7d8", CURTAIN = "#b7d8d1", SKIN = "#e9c4a0", HAIR = "#6b5338";

type Slot = { r: number; c: number; cols: number; u0: number; u1: number; v0: number; v1: number; vEdge: number };
/** ช่องวางเตียง: ไม่เกิน 4 เตียงเรียงแถวเดียว มากกว่านั้น 2 แถว · หัวเตียงชิดผนังด้านหลัง */
function bedSlots(n: number): Slot[] {
  const rows = n <= 4 ? 1 : 2, cols = Math.ceil(n / rows);
  return Array.from({ length: n }, (_, i) => {
    const r = Math.floor(i / cols), c = i % cols, ru = 1 / rows, cv = 1 / cols;
    return { r, c, cols, u0: r * ru + ru * 0.05, u1: r * ru + ru * (rows === 1 ? 0.74 : 0.8), v0: c * cv + cv * 0.12, v1: (c + 1) * cv - cv * 0.12, vEdge: (c + 1) * cv };
  });
}

/** เตียงหนึ่งเตียง (มีผู้พัก = คนนอนห่มผ้า · ว่าง = ปูผ้าเรียบ พับผ้าห่มไว้ปลายเตียง) */
function Bed({ s, label, who }: { s: Slot; label: string; who?: string }) {
  const L = s.u1 - s.u0, Wd = s.v1 - s.v0, vm = (s.v0 + s.v1) / 2;
  const head = Pz(s.u0 + L * 0.17, vm, 23);
  const tag = Pz(s.u0 + L * 0.025, vm, 34);
  return <g>
    <title>{`เตียง ${label}${who ? ` · ${who}` : " · ว่าง"}`}</title>
    <Box u0={s.u0} u1={s.u1} v0={s.v0} v1={s.v1} z0={0} z1={9} c={WOOD} />
    <Box u0={s.u0 + L * 0.04} u1={s.u1 - L * 0.02} v0={s.v0 + Wd * 0.06} v1={s.v1 - Wd * 0.06} z0={9} z1={16} c={SHEET} stroke="#d9cdb4" />
    <Box u0={s.u0} u1={s.u0 + L * 0.05} v0={s.v0} v1={s.v1} z0={0} z1={30} c={WOOD_DARK} />
    <Box u0={s.u0 + L * 0.07} u1={s.u0 + L * 0.25} v0={s.v0 + Wd * 0.16} v1={s.v1 - Wd * 0.16} z0={16} z1={20} c="#ffffff" stroke="#d9cdb4" />
    {who ? <>
      <Box u0={s.u0 + L * 0.27} u1={s.u1 - L * 0.03} v0={s.v0 + Wd * 0.03} v1={s.v1 - Wd * 0.03} z0={16} z1={21} c={BLANKET} />
      <polygon points={pts(Array.from({ length: 18 }, (_, k) => { const a = (k / 18) * Math.PI * 2; return Pz(s.u0 + L * 0.52 + Math.cos(a) * L * 0.2, vm + Math.sin(a) * Wd * 0.26, 23); }))} fill={shade(BLANKET, 0.16)} />
      <circle cx={head[0] - 1.4} cy={head[1] - 1.6} r={8} fill={HAIR} />
      <circle cx={head[0] + 1.8} cy={head[1] + 0.8} r={6.6} fill={SKIN} stroke="#c59b74" strokeWidth={0.7} />
    </> : <Box u0={s.u1 - L * 0.22} u1={s.u1 - L * 0.04} v0={s.v0 + Wd * 0.05} v1={s.v1 - Wd * 0.05} z0={16} z1={19} c={BLANKET_FREE} />}
    <text x={tag[0]} y={tag[1]} textAnchor="middle" className="rmap-bedtxt">{label}</text>
  </g>;
}

/** ฉากกั้นระหว่างเตียง (แผงผ้าในกรอบ) */
function Screen({ v, u0, u1 }: { v: number; u0: number; u1: number }) {
  const t = 0.008;
  const line = (k: number) => { const a = Pz(u0 + (u1 - u0) * k, v + t, 2), b = Pz(u0 + (u1 - u0) * k, v + t, 38); return <line key={k} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#c9b994" strokeWidth={0.8} />; };
  return <g>
    <Box u0={u0} u1={u1} v0={v - t} v1={v + t} z0={2} z1={38} c={SCREEN} stroke="#b9a988" />
    {[0.33, 0.66].map(line)}
  </g>;
}

/** ม่านรูดข้างเตียง: ราวม่านเหนือเตียง และผ้าม่านที่รูดเก็บไว้ปลายเตียง */
function Curtain({ s }: { s: Slot }) {
  const L = s.u1 - s.u0, v = Math.min(s.vEdge - 0.012, s.v1 + (s.vEdge - s.v1) * 0.6);
  const ua = s.u1 - L * 0.2, ub = s.u1 + L * 0.06;
  const folds = [0, 0.25, 0.5, 0.75, 1].map((k) => ua + (ub - ua) * k);
  const top = 50, bottom = 5;
  const off = (k: number) => v + (k % 2 ? 0.012 : -0.004);
  const wave = [...folds.map((u, k) => Pz(u, off(k), top)), ...folds.map((u, k) => Pz(u, off(k), bottom)).reverse()];
  const r0 = Pz(ua - L * 0.08, v, 52), r1 = Pz(ub, v, 52);
  return <g>
    <line x1={r0[0]} y1={r0[1]} x2={r1[0]} y2={r1[1]} stroke="#a89a80" strokeWidth={1.4} strokeLinecap="round" opacity={0.75} />
    <polygon points={pts(wave)} fill={CURTAIN} stroke="#86b6ad" strokeWidth={0.8} opacity={0.94} />
    {folds.slice(1, -1).map((u) => { const a = Pz(u, v, top - 2), b = Pz(u, v, bottom + 2); return <line key={u} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke="#8fbcb3" strokeWidth={0.8} />; })}
  </g>;
}

const Room = memo(function Room({ r, x, y, selected, onSelect }: { r: RoomInfo; x: number; y: number; selected: boolean; onSelect: (i: number) => void }) {
  const t = toneOf(r);
  const slots = bedSlots(r.beds.length);
  const wallL = [P(0, 0), P(0, 1), Pz(0, 1, WALL), Pz(0, 0, WALL)];
  const wallR = [P(0, 0), P(1, 0), Pz(1, 0, WALL), Pz(0, 0, WALL)];
  const floor = [P(0, 0), P(1, 0), P(1, 1), P(0, 1)];
  const win = [Pz(0.52, 0, 24), Pz(0.86, 0, 24), Pz(0.86, 0, 50), Pz(0.52, 0, 50)];
  const w0 = Pz(0.69, 0, 24), w1 = Pz(0.69, 0, 50);
  const sub = r.closed ? "ปิดปรับปรุง" : r.full ? `เต็ม ${r.people.length}/${r.capacity}` : `${r.people.length}/${r.capacity} · ว่าง ${r.free}`;
  return (
    <g transform={`translate(${x} ${y})`} role="button" tabIndex={0} className={`rmap-room ${selected ? "is-selected" : ""}`}
      aria-label={`ห้อง ${r.no} ${sub}`} aria-pressed={selected} onClick={() => onSelect(r.i)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(r.i); } }}>
      <polygon points={pts(wallL)} fill="#f3ece0" stroke={t.edge} strokeWidth={1.2} />
      <polygon points={pts(wallR)} fill="#e9dfcd" stroke={t.edge} strokeWidth={1.2} />
      <polygon points={pts(win)} fill="#d9ecf4" stroke="#a6b9c2" strokeWidth={1} />
      <line x1={w0[0]} y1={w0[1]} x2={w1[0]} y2={w1[1]} stroke="#a6b9c2" strokeWidth={1} />
      <polygon points={pts(floor)} fill={t.floor} stroke={t.edge} strokeWidth={selected ? 3.2 : 1.6} />
      {[1, 2, 3, 4, 5].map((k) => { const a = P(0, k / 6), b = P(1, k / 6); return <line key={k} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={t.edge} strokeOpacity={0.12} strokeWidth={1} />; })}
      {/* หลังไปหน้า: แถวด้านในก่อน ในแถวจากซ้ายไปขวา · ม่านและฉากกั้นอยู่ระหว่างเตียง จึงวาดก่อนเตียงถัดไป */}
      {slots.map((s, i) => <g key={r.beds[i].label}>
        <Bed s={s} label={r.beds[i].label} who={r.beds[i].who} />
        <Curtain s={s} />
        {s.c < s.cols - 1 && i + 1 < slots.length && <Screen v={s.vEdge} u0={s.u0} u1={s.u0 + (s.u1 - s.u0) * 0.62} />}
      </g>)}
      <text x={0} y={-WALL - 26} textAnchor="middle" className="rmap-no">{r.no}</text>
      <text x={0} y={-WALL - 9} textAnchor="middle" className="rmap-sub" fill={r.closed ? "#8a8272" : r.full ? "#b3261e" : "#5b4a2c"}>{sub}</text>
    </g>
  );
});

/** ห้องหนึ่งชั้น/โซน = แผนผังหนึ่งภาพ */
function Floor({ rooms, selected, onSelect }: { rooms: RoomInfo[]; selected: number | null; onSelect: (i: number) => void }) {
  const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(rooms.length * 1.4))));
  const items = rooms.map((r, k) => {
    const c = k % cols, row = Math.floor(k / cols);
    return { r, c, row, x: (c - row) * (W / 2 + GAP_X), y: (c + row) * (H / 2 + GAP_Y) };
  });
  const minX = Math.min(...items.map((i) => i.x)) - W / 2 - 8, maxX = Math.max(...items.map((i) => i.x)) + W / 2 + 8;
  const minY = Math.min(...items.map((i) => i.y)) - WALL - 52, maxY = Math.max(...items.map((i) => i.y)) + H + 10;
  // ห้องด้านหลังวาดก่อน ห้องด้านหน้าทับ
  const order = [...items].sort((a, b) => a.c + a.row - (b.c + b.row) || a.row - b.row);
  return (
    <svg viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} className="rmap-svg" style={{ maxWidth: Math.min(1100, (maxX - minX) * 1.35) }} role="group" aria-label="แผนผังห้อง">
      {order.map(({ r, x, y }) => <Room key={r.i} r={r} x={x} y={y} selected={selected === r.i} onSelect={onSelect} />)}
    </svg>
  );
}

export default function RoomMap({ rooms, selected, onSelect }: { rooms: RoomInfo[]; selected: number | null; onSelect: (i: number) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, RoomInfo[]>();
    for (const r of rooms) m.set(r.floor || "", [...(m.get(r.floor || "") ?? []), r]);
    return [...m].sort((a, b) => (a[0] || "ฮ").localeCompare(b[0] || "ฮ", "th", { numeric: true }));
  }, [rooms]);
  return (
    <div className="rmap">
      <ul className="rmap-legend" aria-label="สีของห้อง">
        <li><i style={{ background: TONE.free.floor, borderColor: TONE.free.edge }} />ว่างทั้งห้อง</li><li><i style={{ background: TONE.part.floor, borderColor: TONE.part.edge }} />มีคนบางส่วน</li>
        <li><i style={{ background: TONE.full.floor, borderColor: TONE.full.edge }} />เต็ม</li><li><i style={{ background: TONE.closed.floor, borderColor: TONE.closed.edge }} />ปิดปรับปรุง</li>
        <li><i style={{ background: BLANKET }} />เตียงมีผู้พัก</li><li><i style={{ background: BLANKET_FREE }} />เตียงว่าง</li><li><i style={{ background: CURTAIN }} />ม่าน</li><li><i style={{ background: SCREEN }} />ฉากกั้น</li>
      </ul>
      {groups.map(([floor, rs]) => (
        <div key={floor || "-"} className="rmap-floor">
          {(groups.length > 1 || floor) && <h4>{floor || "ไม่ระบุชั้น/โซน"} <small>{rs.length} ห้อง · ว่าง {rs.filter((r) => !r.closed).reduce((n, r) => n + r.free, 0)} เตียง</small></h4>}
          <Floor rooms={rs} selected={selected} onSelect={onSelect} />
        </div>
      ))}
    </div>
  );
}
