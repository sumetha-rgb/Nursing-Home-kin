"use client";
/**
 * ภาพรวมห้องยา (KINmed หน้าแรก) · เลือกช่วง วันนี้ / 7 วัน / 30 วัน / เดือนนี้ / เดือนก่อน / เลือกช่วงจากปฏิทิน
 *  ตัวเลขหลัก: ให้ยาครบ % (เทียบช่วงก่อนหน้าที่ยาวเท่ากัน) · ไม่ได้ให้ (มีเหตุผล) · ยังไม่บันทึก · เบิกตามอาการ
 *  กราฟ: ให้ยาตามมื้อรายวัน (วันเดียว = แยกมื้อ) · ให้ยาครบแยกมื้อ · เหตุผลที่ไม่ได้ให้ · ผู้ป่วยที่ให้ไม่ครบ · เบิกตามอาการรายวัน
 *  ข้อมูล: GET /api/pharmstock?op=summary (ยา × มื้อ ที่ต้องให้ จาก lib/medSlots · ชุดเดียวกับตัวชี้วัด ให้ยาครบ)
 *  สี: สถานะ ให้แล้ว = เขียว · ไม่ได้ให้ = ส้ม · ยังไม่บันทึก = แดง (มีคำกำกับเสมอ) · ปริมาณชุดเดียว = ฟ้า
 */
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/Icon";
import { RangePicker, quickRanges, spanTh } from "@/components/PeriodPicker";
import { MEALS } from "@/lib/pharmacy";

const C = { given: "#0ca30c", skip: "#ec835a", missing: "#d03b3b", s1: "#2a78d6" };
type Row = { due: number; given: number; skip: number };
type Summary = {
  from: string; to: string; today: string; branch: string | null; all: boolean; branches: string[];
  prev: { from: string; to: string; due: number; given: number; prn: number };
  days: ({ day: string } & Row)[]; meals: ({ meal: string } & Row)[]; reasons: { reason: string; n: number }[];
  people: ({ name: string; branch: string | null; room: string | null } & Row)[];
  prn: { day: string; n: number }[]; prnTop: { name: string; n: number }[];
};
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);
const dm = (s: string) => `${s.slice(8, 10)}/${s.slice(5, 7)}`;
const addDays = (s: string, n: number) => new Date(Date.parse(s) + n * 864e5).toISOString().slice(0, 10);
const SEG: Record<string, string> = { today: "วันนี้", "7d": "7 วัน", "30d": "30 วัน", month: "เดือนนี้", prev: "เดือนก่อน" };

/** กล่องบอกตัวเลขเมื่อชี้/แตะแท่งกราฟ */
function Tip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return <div className="pointer-events-none absolute z-20 w-max max-w-[220px] -translate-x-1/2 -translate-y-full rounded-xl bg-gold-900 px-3 py-2 text-xs leading-relaxed text-white shadow-lg" style={{ left: x, top: y - 8 }}>{children}</div>;
}
const TipRow = ({ c, t, v }: { c?: string; t: string; v: React.ReactNode }) => (
  <span className="flex items-center justify-between gap-4"><span className="flex items-center gap-1.5">{c && <i className="inline-block h-2 w-2 rounded-full" style={{ background: c }} />}{t}</span><b className="tabular-nums">{v}</b></span>
);

/** แท่งปลายมน 4px (ฐานตรง) */
const barPath = (x: number, y: number, w: number, h: number, r = 4) => {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
};

/** ความกว้างจริงของกล่อง (px) · กราฟวาดตามความกว้างจอ ตัวหนังสือจึงเป็นขนาดจริงทั้งโทรศัพท์และคอมพิวเตอร์ */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}
/** แสดงป้ายแกนนอนทุกกี่แท่ง (ป้ายละประมาณ 46px ไม่ให้ชนกัน) */
const labelEvery = (n: number, width: number) => Math.max(1, Math.ceil(n / Math.max(2, Math.floor(width / 46))));

type Bar = { k: string; label: string; given: number; skip: number; missing: number; due: number };
/** แท่งซ้อน ให้แล้ว / ไม่ได้ให้ / ยังไม่บันทึก */
function StackChart({ bars }: { bars: Bar[] }) {
  const [tip, setTip] = useState<{ i: number; x: number; y: number } | null>(null);
  const [box, cw] = useWidth<HTMLDivElement>();
  const W = cw || 900, narrow = W < 520, H = narrow ? 200 : 250, L = 30, R = 6, T = 10, B = 26, n = bars.length || 1;
  const max = Math.max(1, ...bars.map((b) => b.due)), step = Math.max(1, Math.ceil(max / 4)), top = step * 4;
  const slot = (W - L - R) / n, bw = Math.max(3, Math.min(56, slot * 0.64));
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const every = labelEvery(n, W - L - R);
  return (
    <div className="relative" ref={box} onPointerLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" role="img" aria-label="กราฟการให้ยาตามมื้อ">
        {(narrow ? [0, 2, 4] : [0, 1, 2, 3, 4]).map((i) => <g key={i}><line x1={L} x2={W - R} y1={y(step * i)} y2={y(step * i)} stroke="#EDE5D6" /><text x={L - 6} y={y(step * i) + 4} textAnchor="end" fontSize="12" fill="#A58E65">{step * i}</text></g>)}
        {bars.map((b, i) => {
          const x = L + slot * i + (slot - bw) / 2;
          const segs = ([["given", C.given], ["skip", C.skip], ["missing", C.missing]] as const).filter(([k]) => b[k] > 0);
          let acc = 0;
          return <g key={b.k} opacity={tip && tip.i !== i ? 0.55 : 1}>
            {segs.map(([k, c], si) => {
              const v = b[k], y0 = y(acc + v), h = Math.max(0, y(acc) - y0 - (acc ? 2 : 0));
              acc += v;
              return si === segs.length - 1 ? <path key={k} d={barPath(x, y0, bw, h)} fill={c} /> : <rect key={k} x={x} y={y0} width={bw} height={h} fill={c} />;
            })}
            {(i % every === 0 || i === n - 1) && <text x={x + bw / 2} y={H - 7} textAnchor="middle" fontSize="12" fill="#A58E65">{b.label}</text>}
          </g>;
        })}
        {bars.map((b, i) => (
          <rect key={`h${b.k}`} x={L + slot * i} y={T} width={slot} height={H - T - B} fill="transparent" className="cursor-pointer"
            onPointerEnter={(e) => { const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect(); setTip({ i, x: ((L + slot * i + slot / 2) / W) * r.width, y: (y(b.due) / H) * r.height }); }}
            onClick={(e) => { const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect(); setTip({ i, x: ((L + slot * i + slot / 2) / W) * r.width, y: (y(b.due) / H) * r.height }); }} />
        ))}
      </svg>
      {tip && bars[tip.i] && (() => { const b = bars[tip.i]; return (
        <Tip x={tip.x} y={tip.y}><b className="mb-0.5 block text-[13px]">{b.k}</b>
          <TipRow c={C.given} t="ให้แล้ว" v={b.given} /><TipRow c={C.skip} t="ไม่ได้ให้" v={b.skip} /><TipRow c={C.missing} t="ยังไม่บันทึก" v={b.missing} />
          <TipRow t="ให้ยาครบ" v={b.due ? `${pct(b.given, b.due)}%` : "-"} /></Tip>
      ); })()}
    </div>
  );
}

/** แท่งเดี่ยวสีฟ้า (เบิกตามอาการรายวัน) */
function CountChart({ rows }: { rows: { k: string; label: string; n: number }[] }) {
  const [tip, setTip] = useState<{ i: number; x: number; y: number } | null>(null);
  const [box, cw] = useWidth<HTMLDivElement>();
  const W = cw || 600, H = 120, L = 24, T = 8, B = 22, n = rows.length || 1;
  const max = Math.max(1, ...rows.map((r) => r.n)), slot = (W - L) / n, bw = Math.max(3, Math.min(30, slot * 0.62));
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const every = labelEvery(n, W - L);
  return (
    <div className="relative" ref={box} onPointerLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" role="img" aria-label="กราฟเบิกตามอาการรายวัน">
        <line x1={L} x2={W} y1={y(0)} y2={y(0)} stroke="#EDE5D6" /><text x={L - 5} y={y(max) + 4} textAnchor="end" fontSize="12" fill="#A58E65">{max}</text>
        {rows.map((r, i) => {
          const x = L + slot * i + (slot - bw) / 2;
          return <g key={r.k}>
            {r.n > 0 && <path d={barPath(x, y(r.n), bw, y(0) - y(r.n), 3)} fill={C.s1} opacity={tip && tip.i !== i ? 0.55 : 1} />}
            {(i % every === 0 || i === n - 1) && <text x={x + bw / 2} y={H - 5} textAnchor="middle" fontSize="12" fill="#A58E65">{r.label}</text>}
            <rect x={L + slot * i} y={T} width={slot} height={H - T - B} fill="transparent" className="cursor-pointer"
              onPointerEnter={(e) => { const b = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect(); setTip({ i, x: ((x + bw / 2) / W) * b.width, y: (y(r.n) / H) * b.height }); }} />
          </g>;
        })}
      </svg>
      {tip && rows[tip.i] && <Tip x={tip.x} y={tip.y}><b className="block">{rows[tip.i].k}</b>เบิกตามอาการ {rows[tip.i].n} ครั้ง</Tip>}
    </div>
  );
}

/** แถบแนวนอน: ชื่อ · แถบ · ตัวเลข */
function HBar({ label, children, value }: { label: string; children: React.ReactNode; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(64px,120px)_minmax(0,1fr)_64px] items-center gap-2.5 text-sm">
      <span className="truncate text-gold-800" title={label}>{label}</span>{children}<span className="text-right font-semibold tabular-nums text-gold-900">{value}</span>
    </div>
  );
}
const Track = ({ w, c = C.s1 }: { w: number; c?: string }) => <span className="h-3 overflow-hidden rounded bg-cream-100"><span className="block h-full rounded-r" style={{ width: `${w}%`, background: c }} /></span>;

function Card({ title, sub, children, actions }: { title: string; sub?: React.ReactNode; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <section className="card grid min-w-0 content-start gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><h2 className="text-base font-semibold text-gold-900">{title}</h2>{sub && <small className="text-xs text-gold-500">{sub}</small>}{actions}</div>
      {children}
    </section>
  );
}
const Legend = () => (
  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gold-700">
    {([["given", "ให้แล้ว"], ["skip", "ไม่ได้ให้ (มีเหตุผล)"], ["missing", "ยังไม่บันทึก"]] as const).map(([k, t]) => <span key={k} className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: C[k] }} />{t}</span>)}
  </div>
);

export default function RxOverview({ onPerson }: { onPerson: (name: string) => void }) {
  const Q = useMemo(() => quickRanges().filter((x) => SEG[x.k]).map((x) => ({ ...x, t: SEG[x.k] })), []);
  const [range, setRange] = useState<{ from: string; to: string; k: string }>(() => { const q = Q.find((x) => x.k === "7d")!; return { from: q.from, to: q.to, k: q.k }; });
  const [branch, setBranch] = useState("");
  const [data, setData] = useState<Summary | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [asTable, setAsTable] = useState(false);
  useEffect(() => {
    let off = false;
    setLoading(true); setErr("");
    fetch(`/api/pharmstock?op=summary&from=${range.from}&to=${range.to}${branch ? `&branch=${encodeURIComponent(branch)}` : ""}`, { cache: "no-store" })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || "โหลดข้อมูลไม่ได้"); return j as Summary; })
      .then((j) => { if (!off) setData(j); }).catch((e) => { if (!off) setErr(e.message); }).finally(() => { if (!off) setLoading(false); });
    return () => { off = true; };
  }, [range.from, range.to, branch]);

  const v = useMemo(() => {
    if (!data) return null;
    const days: string[] = [];
    for (let d = data.from; d <= data.to; d = addDays(d, 1)) days.push(d);
    const byDay = new Map(data.days.map((x) => [x.day, x]));
    const one = days.length === 1;
    const mealRows = MEALS.map((m) => data.meals.find((x) => x.meal === m) ?? { meal: m, due: 0, given: 0, skip: 0 });
    const bars: Bar[] = one
      ? mealRows.map((x) => ({ k: `มื้อ${x.meal}`, label: x.meal, due: x.due, given: x.given, skip: x.skip, missing: x.due - x.given - x.skip }))
      : days.map((d) => { const x = byDay.get(d) ?? { due: 0, given: 0, skip: 0 }; return { k: spanTh(d, d), label: dm(d), due: x.due, given: x.given, skip: x.skip, missing: x.due - x.given - x.skip }; });
    const due = data.days.reduce((n, x) => n + x.due, 0), given = data.days.reduce((n, x) => n + x.given, 0), skip = data.days.reduce((n, x) => n + x.skip, 0);
    const prnBy = new Map(data.prn.map((x) => [x.day, x.n]));
    return { one, days, bars, mealRows, due, given, skip, missing: due - given - skip, prn: data.prn.reduce((n, x) => n + x.n, 0),
      prnRows: days.map((d) => ({ k: spanTh(d, d), label: dm(d), n: prnBy.get(d) ?? 0 })), hasToday: data.to === data.today };
  }, [data]);

  const rate = v ? pct(v.given, v.due) : 0;
  const prevRate = data && data.prev.due ? pct(data.prev.given, data.prev.due) : null;
  const diff = prevRate === null ? null : Math.round((rate - prevRate) * 10) / 10;
  const custom = !Q.some((x) => x.k === range.k);

  return (
    <div className="grid gap-4">
      {/* ตัวเลือกช่วง · สาขา (แถวเดียวเหนือกราฟ) */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap gap-0.5 rounded-xl border border-gold-200 bg-white p-[3px]" role="group" aria-label="ช่วงเวลา">
          {Q.map((x) => (
            <button key={x.k} type="button" aria-pressed={range.k === x.k} onClick={() => setRange({ from: x.from, to: x.to, k: x.k })}
              className={`rounded-[9px] px-2.5 py-1 text-sm transition sm:px-3 ${range.k === x.k ? "bg-gold-700 font-semibold text-white" : "text-gold-800 hover:bg-cream-100"}`}>{x.t}</button>
          ))}
        </div>
        {/* โทรศัพท์: ยังไม่ได้เลือกช่วง = เหลือแค่ไอคอนปฏิทิน (อยู่แถวเดียวกับปุ่มช่วงเวลา) */}
        <span className="rx-range"><RangePicker from={range.from} to={range.to} active={custom} quick={Q} current={custom ? undefined : range.k} label={custom ? undefined : "เลือกช่วง"}
          onChange={(f, t, k) => setRange({ from: f, to: t, k: k ?? "custom" })} /></span>
        {data?.all && data.branches.length > 1 && (
          <select className="!min-h-0 !w-auto !py-1.5 text-sm" value={branch} onChange={(e) => setBranch(e.target.value)} aria-label="สาขา">
            <option value="">ทุกสาขา</option>{data.branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        )}
        <span className="text-sm text-gold-500">{data ? `${spanTh(data.from, data.to)} · ${v?.days.length ?? 0} วัน${data.branch ? ` · ${data.branch}` : data.all ? " · ทุกสาขา" : ""}` : ""}{loading ? " · กำลังโหลด…" : ""}</span>
      </div>
      {err && <p className="rounded-xl bg-red-50 px-4 py-2 text-sm text-red-700">{err}</p>}

      {v && data && <>
        {/* ตัวเลขหลัก */}
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <div className="card grid gap-0.5 p-4">
            <span className="flex items-center gap-1.5 text-xs text-gold-500"><i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: C.given }} />ให้ยาครบ</span>
            <b className="text-3xl font-bold tabular-nums text-gold-900">{v.due ? rate : "-"}<small className="text-base font-medium text-gold-500">{v.due ? "%" : ""}</small></b>
            <span className="text-xs text-gold-500">{v.given.toLocaleString()} จาก {v.due.toLocaleString()} รายการ{diff !== null && <> · <b className={diff >= 0 ? "text-emerald-700" : "text-red-700"}>{diff >= 0 ? "▲" : "▼"} {Math.abs(diff)}%</b> จากช่วงก่อนหน้า</>}</span>
          </div>
          <div className="card grid gap-0.5 p-4">
            <span className="flex items-center gap-1.5 text-xs text-gold-500"><i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: C.skip }} />ไม่ได้ให้ (มีเหตุผล)</span>
            <b className="text-3xl font-bold tabular-nums text-gold-900">{v.skip}<small className="text-base font-medium text-gold-500"> รายการ</small></b>
            <span className="text-xs text-gold-500">{data.reasons[0] ? `เหตุผลอันดับ 1: ${data.reasons[0].reason} (${data.reasons[0].n})` : "ไม่มี"}</span>
          </div>
          <div className="card grid gap-0.5 p-4">
            <span className="flex items-center gap-1.5 text-xs text-gold-500"><i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: C.missing }} />ยังไม่บันทึก</span>
            <b className="text-3xl font-bold tabular-nums text-gold-900">{v.missing}<small className="text-base font-medium text-gold-500"> รายการ</small></b>
            <span className="text-xs text-gold-500">{v.hasToday ? "รวมมื้อวันนี้ที่ยังไม่ถึงเวลา" : "อาจลืมให้ หรือลืมกดบันทึก"}</span>
          </div>
          <div className="card grid gap-0.5 p-4">
            <span className="flex items-center gap-1.5 text-xs text-gold-500"><i className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: C.s1 }} />เบิกตามอาการ</span>
            <b className="text-3xl font-bold tabular-nums text-gold-900">{v.prn}<small className="text-base font-medium text-gold-500"> ครั้ง</small></b>
            <span className="text-xs text-gold-500">ช่วงก่อน {data.prev.prn} ครั้ง</span>
          </div>
        </div>

        {/* กราฟหลัก */}
        <Card title={v.one ? "การให้ยา แยกตามมื้อ" : "การให้ยาตามมื้อ รายวัน"} sub="นับยาแต่ละตัวในแต่ละมื้อ เฉพาะยาที่กินตามมื้อ">
          <div className="flex flex-wrap items-center gap-2"><Legend /><button type="button" className="ml-auto text-xs font-semibold text-gold-700 underline-offset-2 hover:underline" onClick={() => setAsTable(!asTable)}>{asTable ? "ดูเป็นกราฟ" : "ดูเป็นตาราง"}</button></div>
          {!v.due ? <p className="py-8 text-center text-sm text-gold-500">ช่วงนี้ไม่มียาตามมื้อที่ต้องให้</p> : asTable ? (
            <div className="max-h-80 overflow-auto"><table className="w-full text-sm tabular-nums">
              <thead><tr className="text-left text-xs text-gold-500">{[v.one ? "มื้อ" : "วันที่", "ต้องให้", "ให้แล้ว", "ไม่ได้ให้", "ยังไม่บันทึก", "ให้ยาครบ"].map((h) => <th key={h} className="border-b border-gold-100 px-2 py-1.5 font-semibold">{h}</th>)}</tr></thead>
              <tbody>{v.bars.map((b) => <tr key={b.k} className="border-t border-cream-100"><td className="px-2 py-1.5">{b.k}</td><td className="px-2">{b.due}</td><td className="px-2">{b.given}</td><td className="px-2">{b.skip}</td><td className="px-2">{b.missing}</td><td className="px-2 font-semibold">{b.due ? `${pct(b.given, b.due)}%` : "-"}</td></tr>)}</tbody>
            </table></div>
          ) : <StackChart bars={v.bars} />}
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="ให้ยาครบ แยกตามมื้อ" sub="% ของรายการที่ต้องให้">
            <div className="grid gap-2.5">
              {v.mealRows.map((x) => {
                const miss = x.due - x.given - x.skip;
                return <HBar key={x.meal} label={`มื้อ${x.meal}`} value={x.due ? `${pct(x.given, x.due)}%` : "-"}>
                  <span className="flex h-3 gap-[2px] overflow-hidden rounded bg-cream-100" title={`ให้แล้ว ${x.given} · ไม่ได้ให้ ${x.skip} · ยังไม่บันทึก ${miss}`}>
                    {x.given > 0 && <i className="block h-full" style={{ width: `${pct(x.given, x.due)}%`, background: C.given }} />}
                    {x.skip > 0 && <i className="block h-full" style={{ width: `${pct(x.skip, x.due)}%`, background: C.skip }} />}
                    {miss > 0 && <i className="block h-full" style={{ width: `${pct(miss, x.due)}%`, background: C.missing }} />}
                  </span>
                </HBar>;
              })}
            </div>
            <Legend />
          </Card>
          <Card title="เหตุผลที่ไม่ได้ให้ยา" sub={`รวม ${v.skip} ครั้ง`}>
            {data.reasons.length ? <div className="grid gap-2.5">
              {data.reasons.map((r) => <HBar key={r.reason} label={r.reason} value={<>{r.n} <small className="font-normal text-gold-500">ครั้ง</small></>}><Track w={(r.n / data.reasons[0].n) * 100} /></HBar>)}
            </div> : <p className="text-sm text-gold-500">ช่วงนี้ไม่มีรายการที่ไม่ได้ให้ยา</p>}
          </Card>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="ผู้ป่วยที่ให้ยาไม่ครบมากที่สุด" sub="กดชื่อเพื่อไปเบิกยาของคนนั้น">
            {data.people.length ? <>
            {/* โทรศัพท์: แถวรายการ (ตาราง 4 คอลัมน์แคบจนคำหัก) */}
            <ul className="grid gap-2 sm:hidden">{data.people.map((p) => {
              const miss = p.due - p.given, room = p.room && p.room !== "-" ? `ห้อง ${p.room}` : "ไม่มีห้อง";
              return <li key={`m${p.branch}|${p.name}`} className="flex items-center justify-between gap-3 border-t border-cream-100 pt-2 first:border-0 first:pt-0">
                <span className="min-w-0"><button type="button" className="text-left font-semibold text-gold-800 underline-offset-2 hover:underline" onClick={() => onPerson(p.name)}>{p.name}</button>
                  <small className="block text-xs text-gold-500">{room} · ให้ยาครบ {pct(p.given, p.due)}%{data.all && !data.branch && p.branch ? ` · ${p.branch}` : ""}</small></span>
                <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${miss >= 3 ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>ให้ไม่ครบ {miss}{p.skip ? ` (ไม่ได้ให้ ${p.skip})` : ""}</span>
              </li>;
            })}</ul>
            <div className="hidden overflow-x-auto sm:block"><table className="w-full text-sm tabular-nums">
              <thead><tr className="text-left text-xs text-gold-500">{["ห้อง", "ผู้ป่วย", "ให้ไม่ครบ", "ให้ยาครบ"].map((h) => <th key={h} className="border-b border-gold-100 px-2 py-1.5 font-semibold">{h}</th>)}</tr></thead>
              <tbody>{data.people.map((p) => {
                const miss = p.due - p.given;
                return <tr key={`${p.branch}|${p.name}`} className="border-t border-cream-100">
                  <td className="px-2 py-1.5 font-semibold">{p.room && p.room !== "-" ? p.room : "-"}</td>
                  <td className="px-2"><button type="button" className="text-left font-medium text-gold-800 underline-offset-2 hover:underline" onClick={() => onPerson(p.name)}>{p.name}</button>{data.all && !data.branch && p.branch && <small className="block text-[11px] text-gold-500">{p.branch}</small>}</td>
                  <td className="px-2"><span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${miss >= 3 ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"}`}>{miss} รายการ{p.skip ? ` (ไม่ได้ให้ ${p.skip})` : ""}</span></td>
                  <td className="px-2">{pct(p.given, p.due)}%</td>
                </tr>;
              })}</tbody>
            </table></div></> : <p className="text-sm text-gold-500">{v.due ? "ให้ยาครบทุกคนในช่วงนี้" : "ช่วงนี้ไม่มียาตามมื้อ"}</p>}
          </Card>
          <Card title="เบิกยาตามอาการ" sub={`${v.prn} ครั้ง · เบิกที่ไม่ระบุมื้อ`}>
            {v.one || !v.prn ? null : <CountChart rows={v.prnRows} />}
            {data.prnTop.length ? <div className="grid gap-2">
              <p className="text-xs font-semibold text-gold-500">ยาที่เบิกบ่อย</p>
              {data.prnTop.map((r) => <HBar key={r.name} label={r.name} value={r.n}><Track w={(r.n / data.prnTop[0].n) * 100} /></HBar>)}
            </div> : <p className="text-sm text-gold-500">ช่วงนี้ไม่มีการเบิกตามอาการ</p>}
          </Card>
        </div>
      </>}
      {!data && !err && <p className="card p-8 text-center text-sm text-gold-500"><Icon name="refresh" className="mr-1 inline h-4 w-4 animate-spin" />กำลังโหลดภาพรวม…</p>}
    </div>
  );
}
