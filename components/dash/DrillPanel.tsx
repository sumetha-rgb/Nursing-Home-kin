"use client";
/**
 * แตกย่อยตัวชี้วัด % (ตัวชี้วัดหลัก › กดกลุ่มแท่ง) · โดนัทแบบงานวิเคราะห์ + รายการข้างวง
 *  โดนัท = "ส่วนที่ขาด" แบ่งตามกลุ่ม (ยังไม่ได้รับ · งานที่ยังไม่ส่ง · เตียงว่าง …) ชิ้นใหญ่ = ต้องตามก่อน · อัตรา % ของแต่ละกลุ่มอยู่ในรายการ
 *  ชี้ = ชิ้นหนาขึ้น อื่นจาง + การ์ดลอย · แตะชิ้นหรือแถว = ลงลึก (วงใหม่กวาดเข้ามา) · ชั้นสุดท้าย = รายการจริงที่ต้องตาม
 *  ข้อมูลจาก GET /api/ops?op=drill (lib/drill.ts) · มิติและลำดับชั้นจาก lib/drillDims
 */
import { useEffect, useId, useRef, useState } from "react";
import { DIM_LABEL, DRILL, type DrillKpi } from "@/lib/drillDims";
import type { ViewId } from "@/lib/nav";

type Row = { key: string; num: number; den: number; n?: number };
type Rec = Record<string, string | number | null>;
const money = (v: number) => Math.round(v).toLocaleString("en-US");
const SH = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const dShort = (s: unknown) => { const v = String(s ?? ""); return /^\d{4}-\d{2}-\d{2}/.test(v) ? `${Number(v.slice(8, 10))} ${SH[Number(v.slice(5, 7)) - 1]}` : v || "-"; };
const gapText = (v: number | null, goal: number) => (v === null ? "ไม่มีข้อมูล" : v >= goal ? "ถึงเป้า" : `ขาด ${goal - v}%`);

/** สีกลุ่ม (ลำดับคงที่ ไม่วนซ้ำ) · เกิน 6 กลุ่มรวมเป็น "อื่น ๆ" · ชั้นลึก = เฉดของสีกลุ่มที่กดลงมา */
const PAL = ["#8A5A1A", "#2B6B7A", "#6B7A2B", "#7A2B5A", "#4A4A8A", "#A8642A"];
const OTHER = "#B9AC95";
const MAX_SLICES = 6;
const mixHex = (hex: string, t: number) => {
  const n = parseInt(hex.slice(1), 16), m = (c: number) => Math.round(c + (255 - c) * t).toString(16).padStart(2, "0");
  return `#${m(n >> 16)}${m((n >> 8) & 255)}${m(n & 255)}`;
};
/** ส่วนที่ขาดของแต่ละตัวชี้วัด (ข้อความกลางวงและการ์ดลอย) */
const GAP: Record<DrillKpi, { word: string; unit: string }> = {
  occ: { word: "เตียงว่าง", unit: "เตียง" }, collect: { word: "ยังไม่ได้รับ", unit: "บาท" }, tasks: { word: "งานที่ยังไม่ส่ง", unit: "งาน" },
  ontime: { word: "งานที่ส่งช้า", unit: "งาน" }, meds: { word: "มื้อที่ยังไม่ให้ยา", unit: "มื้อ" },
};

/** แปลงรายการจริงเป็นช่องในตาราง · hot = ควรรีบดู (ตัวแดง) */
function cellsOf(kpi: DrillKpi, r: Rec): { v: string; num?: boolean; hot?: boolean }[] {
  const s = (k: string) => String(r[k] ?? "-");
  switch (kpi) {
    case "occ": return [{ v: s("room") }, { v: s("branch") }, { v: s("type") }, { v: s("floor") }, { v: `${s("free")} เตียง`, num: true }];
    case "collect": { const d = Number(r.days) || 0; return [{ v: s("no") }, { v: s("resident") }, { v: s("branch") }, { v: money(Number(r.owe) || 0), num: true }, { v: `${d} วัน`, num: true, hot: d > 60 }]; }
    case "tasks": return [{ v: dShort(r.date) }, { v: s("task") }, { v: s("resident") }, { v: s("shift") }, { v: s("who") }];
    case "ontime": { const late = Number(r.late) || 0; return [{ v: dShort(r.date) }, { v: s("task") }, { v: s("resident") }, { v: s("who") }, { v: `${s("time")} → ${s("sent")} (ช้า ${late} นาที)`, hot: late > 90 }]; }
    case "meds": return [{ v: dShort(r.date) }, { v: s("resident") }, { v: s("meal") }, { v: s("items") }, { v: s("who") }];
  }
}

type Slice = { key: string; value: number; share: number; color: string; rate: number | null; sub: string; other?: boolean; count?: number };

/* ---------- โดนัท ---------- */
const CX = 280, CY = 230, RR = 140, TH = 30, GAPA = 0.05;
const pt = (r: number, a: number) => [CX + r * Math.sin(a), CY - r * Math.cos(a)] as const;
const arc = (r: number, a0: number, a1: number) => { const [x0, y0] = pt(r, a0), [x1, y1] = pt(r, a1); return `M${x0.toFixed(2)},${y0.toFixed(2)}A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(2)},${y1.toFixed(2)}`; };

function Donut({ slices, total, gap, isMoney, rate, goal, title, selected, levelKey, share, onPick, deeper }: {
  slices: Slice[]; total: number; gap: { word: string; unit: string }; isMoney: boolean; rate: number | null; goal: number; title: string;
  selected: string | null; levelKey: string; share: boolean; onPick: (key: string) => void; deeper: string; }) {
  const uid = useId().replace(/:/g, "");
  const stage = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  useEffect(() => setHover(null), [levelKey]);
  const num = (v: number) => (isMoney ? money(v) : String(Math.round(v)));
  const cap = TH / 2 / RR;
  let at = 0;
  const geo = slices.map((s) => {
    const span = total ? (s.value / total) * Math.PI * 2 : 0, a0 = at, a1 = at + span, mid = (a0 + a1) / 2;
    at += span;
    let s0 = slices.length > 1 ? a0 + GAPA / 2 + cap : a0, s1 = slices.length > 1 ? a1 - GAPA / 2 - cap : a1 - 0.0001;
    if (s1 <= s0) { s0 = mid - 0.0005; s1 = mid + 0.0005; }
    return { s0, s1, mid };
  });
  const k = () => (stage.current ? stage.current.clientWidth / 560 : 1);
  const anchorOf = (i: number) => { const [x, y] = pt(RR + 20, geo[i].mid); return { x: x * k(), y: y * k() }; };
  const at2 = (i: number, e?: React.PointerEvent) => {
    if (e && e.pointerType === "touch") return;
    if (e && stage.current) { const b = stage.current.getBoundingClientRect(); setHover({ i, x: e.clientX - b.left, y: e.clientY - b.top }); }
    else { const p = anchorOf(i); setHover({ i, ...p }); }
  };
  const h = hover ? slices[hover.i] : null;
  // การ์ดลอย: ข้างตำแหน่งที่ชี้ ไม่ล้นกรอบ
  const W = stage.current?.clientWidth ?? 400, TW = 232;
  const tipLeft = hover ? Math.max(0, Math.min(hover.x + 18 + TW > W ? hover.x - TW - 18 : hover.x + 18, W - TW)) : 0;
  const tipTop = hover ? Math.max(0, hover.y - 24) : 0;
  const GR = RR - TH / 2 - 16, gC = 2 * Math.PI * GR, ga = (goal / 100) * Math.PI * 2;
  const [g1x, g1y] = pt(GR - 7, ga), [g2x, g2y] = pt(GR + 7, ga);
  const low = rate !== null && rate < goal;
  /** ส่วนที่ขาดมีกลุ่มเดียวหรือไม่มีเลย (ไม่ใช่แบบสัดส่วน): โดนัท 100% ไม่บอกอะไร → วงหลักแสดงอัตรารวมของชั้นนี้เทียบเป้าแทน */
  const single = !share && rate !== null && slices.length <= 1;
  const sRate = single ? Math.max(0, Math.min(100, rate as number)) : 0;
  const s0 = slices[0];
  const singleD = sRate >= 100 ? `M${CX},${CY - RR}a${RR},${RR} 0 1 1 -0.01,0` : arc(RR, cap, Math.max(cap + 0.001, (sRate / 100) * Math.PI * 2 - cap));
  const [t1x, t1y] = pt(RR - TH / 2 - 5, ga), [t2x, t2y] = pt(RR + TH / 2 + 5, ga);
  return (
    <div ref={stage} className="dn-stage" onPointerLeave={() => setHover(null)}>
      <svg viewBox="0 0 560 460" role="group" aria-label={`${gap.word} ${title} ${num(total)} ${gap.unit}`}>
        <defs>
          {slices.map((s, i) => { const [x0, y0] = pt(RR, geo[i].s0), [x1, y1] = pt(RR, geo[i].s1); return (
            <linearGradient key={i} id={`${uid}g${i}`} gradientUnits="userSpaceOnUse" x1={x0} y1={y0} x2={x1} y2={y1}>
              <stop offset="0" stopColor={s.color} /><stop offset="1" stopColor={mixHex(s.color, 0.18)} />
            </linearGradient>); })}
        </defs>
        <g aria-hidden="true">
          {Array.from({ length: 40 }, (_, t) => { const major = t % 10 === 0, a = (t / 40) * Math.PI * 2, r1 = RR + TH / 2 + 10, r2 = r1 + (major ? 9 : 4), [x1, y1] = pt(r1, a), [x2, y2] = pt(r2, a);
            return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} className={`dn-tick ${major ? "major" : ""}`} />; })}
        </g>
        <circle cx={CX} cy={CY} r={RR} fill="none" className="dn-track" strokeWidth={TH} />
        <g key={levelKey}>
          {single && <path d={singleD} stroke={s0?.color ?? "#6F5730"} strokeWidth={hover ? TH + 12 : TH} className={`dn-slice dn-sweep ${hover ? "is-on" : ""}`}
            style={{ cursor: s0 ? "pointer" : "default" }} tabIndex={s0 ? 0 : -1} role={s0 ? "button" : undefined}
            aria-label={s0 ? `${s0.key} ${gap.word} ${num(s0.value)} ${gap.unit} อัตรารวม ${sRate}% ${deeper}` : `อัตรารวม ${sRate}% ไม่มีส่วนที่ขาด`}
            onPointerMove={s0 ? (e) => at2(0, e) : undefined} onFocus={s0 ? () => at2(0) : undefined} onBlur={() => setHover(null)}
            onClick={() => s0 && onPick(s0.key)} onKeyDown={(e) => { if (s0 && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onPick(s0.key); } }} />}
          {!single && total > 0 && slices.map((s, i) => {
            const on = hover?.i === i || (!hover && s.key === selected);
            const dim = hover ? hover.i !== i : !!selected && s.key !== selected;
            return (
              <path key={s.key} d={single ? singleD : slices.length > 1 ? arc(RR, geo[i].s0, geo[i].s1) : `M${CX},${CY - RR}a${RR},${RR} 0 1 1 -0.01,0`} stroke={slices.length > 1 ? `url(#${uid}g${i})` : s.color} strokeWidth={on ? TH + 12 : TH}
                className={`dn-slice dn-sweep ${on ? "is-on" : ""} ${dim ? "is-dim" : ""}`} style={{ animationDelay: `${(i * 0.06).toFixed(2)}s`, cursor: s.other ? "default" : "pointer" }}
                tabIndex={s.other ? -1 : 0} role={s.other ? undefined : "button"} aria-label={`${s.key} ${gap.word} ${num(s.value)} ${gap.unit} ${s.share}%${s.rate !== null && !share ? ` อัตรา ${s.rate}%` : ""}${s.other ? "" : ` ${deeper}`}`}
                onPointerMove={(e) => at2(i, e)} onFocus={() => at2(i)} onBlur={() => setHover(null)}
                onClick={() => !s.other && onPick(s.key)} onKeyDown={(e) => { if (!s.other && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onPick(s.key); } }} />
            );
          })}
        </g>
        <g key={`l${levelKey}`} className="dn-fadein" aria-hidden="true">
          {total > 0 && !single && slices.map((s, i) => {
            if (s.share < 7) return null;
            const right = Math.sin(geo[i].mid) >= 0, [e0x, e0y] = pt(RR + TH / 2 + 22, geo[i].mid), [e1x, e1y] = pt(RR + TH / 2 + 36, geo[i].mid);
            const x2 = right ? Math.max(e1x + 14, CX + RR + 42) : Math.min(e1x - 14, CX - RR - 42), tx = x2 + (right ? 6 : -6);
            const dim = hover ? hover.i !== i : !!selected && s.key !== selected;
            return (
              <g key={s.key} className={`dn-lbl ${dim ? "is-dim" : ""}`}>
                <path d={`M${e0x.toFixed(1)},${e0y.toFixed(1)}L${e1x.toFixed(1)},${e1y.toFixed(1)}L${x2.toFixed(1)},${e1y.toFixed(1)}`} className="dn-lead" />
                <circle cx={e0x} cy={e0y} r={2.5} className="dn-pin" />
                <text x={tx} y={e1y - 3} textAnchor={right ? "start" : "end"} className="v">{s.share}%</text>
                <text x={tx} y={e1y + 13} textAnchor={right ? "start" : "end"} className="n">{s.key.length > 14 ? `${s.key.slice(0, 13)}…` : s.key}</text>
              </g>
            );
          })}
        </g>
        {single && <line x1={t1x} y1={t1y} x2={t2x} y2={t2y} className="dn-goal" strokeWidth={3} aria-hidden="true" />}
        {single && <text x={t2x + (Math.sin(ga) >= 0 ? 6 : -6)} y={t2y - 4} textAnchor={Math.sin(ga) >= 0 ? "start" : "end"} className="dn-goal-t" aria-hidden="true">เป้า {goal}%</text>}
        {rate !== null && !single && <>
          <g transform={`rotate(-90 ${CX} ${CY})`} aria-hidden="true">
            <circle cx={CX} cy={CY} r={GR} fill="none" className="dn-track" strokeWidth={5} />
            <circle key={`g${levelKey}`} cx={CX} cy={CY} r={GR} fill="none" className={`dn-gauge ${low ? "is-low" : ""}`} strokeWidth={5} strokeLinecap="round" style={{ strokeDasharray: `${((rate / 100) * gC).toFixed(1)} ${gC.toFixed(1)}` }} />
          </g>
          <line x1={g1x} y1={g1y} x2={g2x} y2={g2y} className="dn-goal" aria-hidden="true" />
        </>}
      </svg>
      <div className="dn-hub">
        <span className="dn-k">{title}</span>
        <b>{num(total)}</b>
        <span className="dn-u">{gap.unit} {gap.word === "ยังไม่ได้รับ" ? "ยังไม่ได้รับ" : `· ${gap.word}`}</span>
        {rate !== null && <span className={`dn-g ${low ? "bad" : "ok"}`}>อัตรา {rate}% · {gapText(rate, goal)}</span>}
      </div>
      {total === 0 && !single && <p className="dn-allgood">ไม่มีส่วนที่ขาด ถึงเป้าทุกกลุ่ม</p>}
      {single && <p className="dn-single">{s0 ? `ส่วนที่ขาดอยู่ที่ ${s0.key} กลุ่มเดียว · วงแสดงอัตรารวม ${sRate}% เทียบเป้า ${goal}% · ${deeper}` : `ไม่มีส่วนที่ขาด · อัตรารวม ${sRate}% เทียบเป้า ${goal}%`}</p>}
      {h && hover && <div className="dd-tip" role="status" style={{ left: tipLeft, top: tipTop, width: TW }}>
        <span className="t-head"><i style={{ background: h.color }} />{h.key}</span>
        <span className="t-big">{num(h.value)} <small>{gap.unit} · {gap.word}</small></span>
        <span className="t-sub">{h.share}% ของที่ขาดทั้งหมด{h.other ? ` · รวม ${h.count} กลุ่ม` : ""}</span>
        {!share && h.rate !== null && <>
          <span className={h.rate < goal ? "kc-bad-t" : "kc-ok-t"}>อัตรา {h.rate}% · {gapText(h.rate, goal)}</span>
          <span className="dd-meter" aria-hidden="true"><i className={h.rate < goal ? "is-bad" : ""} style={{ width: `${Math.min(100, h.rate)}%` }} /><b style={{ left: `${Math.min(100, goal)}%` }} /></span>
        </>}
        <span className="t-sub">{h.sub}</span>
        <span className="t-cta">{h.other ? "กลุ่มที่เหลือดูในรายการด้านข้าง" : `${deeper} ›`}</span>
      </div>}
    </div>
  );
}

export default function DrillPanel({ kpi, label, goal, cur, base, from, to, period, branch, go }: {
  kpi: DrillKpi; label: string; goal: number; cur: number | null; base?: string;
  from: string; to: string; period: string; branch: string; go?: (v: ViewId) => void;
}) {
  const def = DRILL[kpi], gap = GAP[kpi];
  const [dim, setDim] = useState(0);
  const [path, setPath] = useState<string[]>([]);
  /** สีของกลุ่มที่กดลงมาแต่ละชั้น (ชั้นลึกใช้เฉดของสีนี้) */
  const [pathColor, setPathColor] = useState<string[]>([]);
  const [data, setData] = useState<{ rows?: Row[]; records?: Rec[] } | null>(null);
  /** แถวของชั้นล่าสุดที่เป็นโดนัท (ชั้นรายการจริงยังโชว์วงนี้ โดยเน้นชิ้นที่กดลงมา) */
  const [ring, setRing] = useState<{ rows: Row[]; key: string; by: string } | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { setDim(0); setPath([]); setPathColor([]); setRing(null); }, [kpi]);
  const d = def.dims[Math.min(dim, def.dims.length - 1)];
  const level = path.length, by = d.chain[level] ?? null;
  const filters = path.map((v, i) => [d.chain[i], v]);
  const fKey = JSON.stringify(filters);

  useEffect(() => {
    let live = true;
    setData(null); setErr("");
    const q = new URLSearchParams({ op: "drill", kpi, from, to, ...(branch ? { branch } : {}), ...(by ? { by } : {}), ...(filters.length ? { f: fKey } : {}) });
    fetch(`/api/ops?${q}`, { cache: "no-store" })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "โหลดข้อมูลไม่สำเร็จ"); return j; })
      .then((j) => { if (!live) return; setData(j); if (j.rows && by) setRing({ rows: j.rows, key: `${kpi}|${dim}|${fKey}`, by }); })
      .catch((e) => { if (live) setErr((e as Error).message); });
    return () => { live = false; };
  }, [kpi, from, to, branch, by, fKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const pick = (key: string, color: string) => { setPath([...path, key]); setPathColor([...pathColor, color]); };
  const jump = (n: number) => { setPath(path.slice(0, n)); setPathColor(pathColor.slice(0, n)); };

  /** แถวของโดนัท (ชั้นปัจจุบัน หรือชั้นก่อนหน้าเมื่ออยู่ชั้นรายการจริง) */
  const ringRows = by ? data?.rows ?? null : ring?.rows ?? null;
  const ringLevel = by ? level : level - 1;
  const ringBy = by ?? ring?.by ?? null;
  const parentColor = ringLevel > 0 ? pathColor[ringLevel - 1] : null;
  const shareDim = !!d.share;
  const rows = (ringRows ?? []).map((r) => {
    const rate = shareDim ? null : r.den ? Math.round((r.num / r.den) * 100) : null;
    const value = shareDim ? r.num : Math.max(0, r.den - r.num);
    const sub = shareDim ? `ค้าง ${money(r.num)} บาท · ${r.n ?? 0} ใบ` : def.money ? `${def.numWord} ${money(r.num)} จาก ${money(r.den)} บาท` : `${def.numWord} ${money(r.num)} จาก ${money(r.den)} ${def.unit}`;
    return { ...r, rate, value, sub };
  });
  // สีตามตำแหน่งในลำดับยอดที่ขาด (มาก → น้อย) · ชั้นลึกเป็นเฉดของสีกลุ่มแม่
  const ranked = [...rows].sort((a, b) => (shareDim ? 0 : b.value - a.value));
  const colorOf = new Map(ranked.map((r, i) => [r.key, parentColor ? mixHex(parentColor, Math.min(0.7, i * 0.16)) : PAL[i % PAL.length]]));
  const total = rows.reduce((n, r) => n + r.value, 0);
  const shareOf = (v: number) => (total ? Math.round((v / total) * 100) : 0);
  const drawn = shareDim ? ranked : ranked.filter((r) => r.value > 0);
  const top = drawn.slice(0, MAX_SLICES), rest = drawn.slice(MAX_SLICES);
  const slices: Slice[] = top.map((r) => ({ key: r.key, value: r.value, share: shareOf(r.value), color: colorOf.get(r.key)!, rate: r.rate, sub: r.sub }));
  if (rest.length) { const v = rest.reduce((n, r) => n + r.value, 0); slices.push({ key: "อื่น ๆ", value: v, share: shareOf(v), color: OTHER, rate: null, sub: rest.map((r) => r.key).slice(0, 4).join(" · ") + (rest.length > 4 ? " …" : ""), other: true, count: rest.length }); }
  const sumNum = rows.reduce((n, r) => n + r.num, 0), sumDen = rows.reduce((n, r) => n + r.den, 0);
  const levelRate = shareDim ? cur : sumDen ? Math.round((sumNum / sumDen) * 100) : null;
  // รายการข้างวง: แย่สุดขึ้นก่อน (แบบสัดส่วนเรียงตามลำดับเดิม เช่น อายุหนี้)
  const list = shareDim ? rows : [...rows].sort((a, b) => (a.rate ?? 101) - (b.rate ?? 101));
  const records = data?.records ?? [];
  const low = cur !== null && cur < goal;
  const deeper = by && level + 1 < d.chain.length ? "แตะเพื่อดูลึกลงไป" : "แตะเพื่อดูรายการที่ต้องตาม";
  const ringTitle = ringLevel > 0 ? path[ringLevel - 1] : "ทั้งหมด";

  return (
    <section className="card kc-card dd" aria-labelledby="dd-h">
      <header className="dd-head">
        <small>แตกย่อย · {def.now ? "ณ วันนี้" : period}</small>
        <h3 id="dd-h">{label} <span className={low ? "kc-bad-t" : "kc-ok-t"}>{cur === null ? "-" : `${cur}%`} · {gapText(cur, goal)}</span></h3>
        {base && <p>{base} · เป้า {goal}% · โดนัท = {gap.word} แบ่งตามกลุ่ม ชิ้นใหญ่ = ต้องตามก่อน</p>}
      </header>

      <div className="dd-dims" role="group" aria-label="แยกตาม">
        <span>แยกตาม</span>
        {def.dims.map((x, i) => <button key={x.chain.join()} type="button" aria-pressed={i === dim} className={i === dim ? "is-on" : ""} onClick={() => { setDim(i); setPath([]); setPathColor([]); setRing(null); }}>{DIM_LABEL[x.chain[0]]}</button>)}
      </div>

      <nav className="dd-crumbs" aria-label="ชั้นที่ลงมา">
        {level === 0 ? <b aria-current="page">ทั้งหมด</b> : <button type="button" onClick={() => jump(0)}>ทั้งหมด</button>}
        {path.map((p, i) => <span key={i}><i aria-hidden="true">›</i>{i === level - 1 ? <b aria-current="page">{p}</b> : <button type="button" onClick={() => jump(i + 1)}>{p}</button>}</span>)}
      </nav>

      {err ? <p role="alert" className="form-error">{err}</p>
        : <div className="dd-body">
          <div className="dd-ring">
            {ringRows ? <Donut slices={slices} total={total} gap={gap} isMoney={!!def.money} rate={levelRate} goal={goal} title={ringTitle}
                selected={by ? null : path[level - 1] ?? null} levelKey={`${kpi}|${dim}|${ringLevel}|${path.slice(0, ringLevel).join("/")}`} share={shareDim}
                onPick={(key) => { const c = colorOf.get(key) ?? PAL[0]; if (by) pick(key, c); else { setPath([...path.slice(0, -1), key]); setPathColor([...pathColor.slice(0, -1), c]); } }} deeper={deeper} />
              : <p className="kc-empty">กำลังโหลด…</p>}
            {level > 0 && <button type="button" className="dn-back" onClick={() => jump(level - 1)}>‹ ถอยกลับ</button>}
          </div>
          <div className="dd-side">
            {!data ? <p className="kc-empty">กำลังโหลด…</p>
              : by ? <>
                <p className="dd-cap"><b>{level ? `${path[level - 1]} · ` : ""}แยกตาม{DIM_LABEL[ringBy ?? by]}</b>{!shareDim && " · เรียงจากแย่สุด"}</p>
                {list.length ? <div className="dd-rows">{list.map((r) => {
                  const bad = r.rate !== null && r.rate < goal, c = colorOf.get(r.key) ?? OTHER;
                  return (
                    <button key={r.key} type="button" className="dd-row" onClick={() => pick(r.key, c)} aria-label={`${r.key} ${gap.word} ${def.money || shareDim ? money(r.value) : r.value} ${gap.unit}${r.rate !== null ? ` อัตรา ${r.rate}% ${gapText(r.rate, goal)}` : ""} ${deeper}`}>
                      <i className="dd-dot" style={{ background: c }} aria-hidden="true" />
                      <span className="dd-row-m">
                        <b>{r.key}</b>
                        {r.rate !== null && <span className="dd-meter" aria-hidden="true"><i className={bad ? "is-bad" : ""} style={{ width: `${Math.min(100, r.rate)}%` }} /><b style={{ left: `${Math.min(100, goal)}%` }} /></span>}
                        <small className={r.rate === null ? "" : bad ? "kc-bad-t" : "kc-ok-t"}>{r.rate === null ? r.sub : `อัตรา ${r.rate}% · ${gapText(r.rate, goal)}`}</small>
                      </span>
                      <span className="dd-row-e"><b>{def.money || shareDim ? money(r.value) : r.value} {gap.unit}</b><small>{shareOf(r.value)}% ของที่ขาด</small></span>
                      <i className="dd-chev" aria-hidden="true">›</i>
                    </button>
                  );
                })}</div> : <p className="kc-empty">ไม่มีข้อมูลในช่วงนี้</p>}
              </>
              : <div className="dd-recs">
                <p className="dd-cap"><b>{def.recTitle}</b> · {path.join(" › ")} · {records.length}{records.length >= 200 ? "+" : ""} รายการ</p>
                {records.length ? <div className="dd-table"><table>
                  <thead><tr>{def.recHead.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
                  <tbody>{records.map((r, i) => <tr key={i}>{cellsOf(kpi, r).map((c, j) => <td key={j} data-label={def.recHead[j]} className={`${c.num ? "is-num" : ""} ${c.hot ? "is-hot" : ""}`}>{c.v}</td>)}</tr>)}</tbody>
                </table></div> : <p className="kc-empty">ไม่มีรายการที่ต้องตาม</p>}
                {go && def.view && <button type="button" className="btn-soft !min-h-0 !py-1.5 !text-sm" onClick={() => go(def.view as ViewId)}>{def.viewLabel} ›</button>}
              </div>}
          </div>
        </div>}
    </section>
  );
}
