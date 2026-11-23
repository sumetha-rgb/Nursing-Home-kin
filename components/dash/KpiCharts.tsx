"use client";
import { useLayoutEffect, useRef, useState } from "react";
import DrillPanel from "./DrillPanel";
import { isDrillKpi } from "@/lib/drillDims";
import type { ViewId } from "@/lib/nav";

/**
 * แท็บ "ตัวชี้วัดหลัก" แบบกราฟ (แทนการ์ดตัวเลข)
 *  1) ตัวชี้วัดที่เป็น % กราฟแท่งแนวตั้งเทียบเดือนก่อนๆ (2 / 3 / 6 เดือน) · แท่งเข้มสุด = เดือนนี้ · เส้นแดง = เป้า
 *     กดกลุ่มแท่ง (หรือชื่อตัวชี้วัด) = เจาะดูแนวโน้มการเติบโตของตัวนั้นในการ์ดถัดไป
 *  2) แนวโน้มการเติบโต: เส้นรายเดือน 6 เดือน + เพิ่ม/ลดจากเดือนก่อนทุกเดือน (+ รายสัปดาห์ถ้ามี) · สรุปและลิงก์ไปหน้ารายละเอียด
 *  3) ตัวชี้วัดที่เป็นจำนวน: เดิม → ตอนนี้ · กดไปแท็บรายละเอียด
 * สีทองเฉดเดียวไล่อ่อน → เข้มตามเดือน (เก่า → ใหม่) · ข้อความใช้สีตัวหนังสือ ไม่ใช้สีของแท่ง
 */
type Pt = { label: string; v: number | null };
/** base = ฐานของ % เช่น "18 จาก 24 เตียง" · drill = สรุปในการ์ดแนวโน้ม · monthly = รายเดือนเก่า → ใหม่ (ตัวสุดท้าย = ช่วงที่เลือก) · trend = รายสัปดาห์ (ถ้ามี) */
export type PctKpi = { key: string; label: string; cur: number | null; prev: number | null; goal: number; note?: string; base?: string; prevLabel?: string; drill?: string[]; openLabel?: string; monthly?: Pt[]; trend?: Pt[]; trendName?: string; onOpen?: () => void };
export type CountKpi = { key: string; label: string; unit: string; cur: number; prev: number; higherBetter: boolean; text?: string; prevText?: string; onOpen?: () => void };

function useWidth(min = 200) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(Math.max(min, Math.round(el.getBoundingClientRect().width)));
    const ro = new ResizeObserver(([e]) => setW(Math.max(min, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [min]);
  return [ref, w] as const;
}

/** ไล่สีทองอ่อน → เข้ม (เดือนเก่า → เดือนนี้) */
const RAMP = ["#ead9b4", "#dcc28d", "#c9a96a", "#ad8a4c", "#93723c", "#6f552c"];
const rampOf = (m: number) => (m <= 1 ? [RAMP[5]] : m === 2 ? [RAMP[2], RAMP[5]] : m === 3 ? [RAMP[1], RAMP[3], RAMP[5]] : RAMP.slice(6 - m));
const COMPARE = [2, 3, 6] as const;

/** กราฟแท่งแนวตั้ง: กลุ่มละ 1 ตัวชี้วัด · แท่งละ 1 เดือน */
function Columns({ list, m, sel, onPick }: { list: PctKpi[]; m: number; sel: string; onPick: (k: string) => void }) {
  const [ref, w] = useWidth(300);
  const [tip, setTip] = useState<{ x: number; y: number; t: string } | null>(null);
  const H = 250, L = 36, R = 8, T = 22, B = 8, n = list.length;
  const band = (w - L - R) / Math.max(1, n), pad = Math.min(26, band * 0.16), inner = band - pad * 2;
  const bw = Math.max(6, (inner - (m - 1) * 3) / m);
  const y = (v: number) => T + (1 - Math.min(100, Math.max(0, v)) / 100) * (H - T - B);
  const col = rampOf(m);
  // จอแคบ (โทรศัพท์): กลุ่มแท่งเบียดจนชื่อหักทีละพยางค์ → เป็นรายการทีละแถว แถบ = ค่าล่าสุด เส้นแดง = เป้า · เดือนก่อนๆ เป็นตัวเลขใต้แถว
  if (w < 560) return (
    <div ref={ref} className="kc-list" role="list">
      {list.map((k) => {
        const gap = k.cur === null ? null : k.cur - k.goal, on = k.key === sel;
        const prev = (k.monthly ?? []).slice(-m, -1).filter((p) => p.v !== null);
        return (
          <button key={k.key} type="button" role="listitem" className={`kc-li ${on ? "is-on" : ""}`} aria-pressed={on} onClick={() => onPick(k.key)}>
            <span className="kc-li-h"><b>{k.label}</b><span><em>{k.cur === null ? "-" : `${k.cur}%`}</em> <small className={gap === null ? "" : gap >= 0 ? "is-ok" : "is-bad"}>{gap === null ? "ไม่มีข้อมูล" : gap >= 0 ? "ถึงเป้า" : `ขาด ${Math.abs(gap)}%`}</small></span></span>
            <span className="kc-li-track" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, k.cur ?? 0))}%` }} /><u style={{ left: `${Math.min(100, Math.max(0, k.goal))}%` }} /></span>
            <small className="kc-li-sub">{k.base ?? ""}{prev.length ? `${k.base ? " · " : ""}${prev.map((p) => `${p.label} ${p.v}%`).join(" · ")}` : ""}</small>
          </button>
        );
      })}
    </div>
  );
  return (
    <div ref={ref} className="kc-cols" onMouseLeave={() => setTip(null)}>
      <svg width={w} height={H} role="img" aria-label={`ตัวชี้วัดเทียบ ${m} เดือน: ${list.map((k) => `${k.label} ${(k.monthly ?? []).slice(-m).map((p) => `${p.label} ${p.v ?? "-"}%`).join(", ")} · เป้า ${k.goal}%`).join(" · ")}`}>
        {[0, 25, 50, 75, 100].map((g) => <g key={g}><line x1={L} x2={w - R} y1={y(g)} y2={y(g)} className={g ? "kc-grid" : "kc-base"} /><text x={L - 6} y={y(g) + 4} textAnchor="end" className="kc-tick">{g}%</text></g>)}
        {list.map((k, i) => {
          const x0 = L + i * band, pts = (k.monthly ?? []).slice(-m);
          const on = k.key === sel;
          return (
            <g key={k.key} className="kc-grp" onClick={() => onPick(k.key)} role="button" tabIndex={0} aria-label={`ดูแนวโน้ม ${k.label}`} aria-pressed={on}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(k.key); } }}>
              <rect x={x0 + 2} y={T - 18} width={band - 4} height={H - T + 18 - B} rx={10} className={on ? "kc-band is-on" : "kc-band"} />
              {pts.map((p, j) => {
                if (p.v === null) return null;
                const bx = x0 + pad + (m - pts.length + j) * (bw + 3), top = y(p.v), h = Math.max(1.5, y(0) - top), last = j === pts.length - 1;
                return <g key={p.label}>
                  <path d={`M${bx},${y(0)}V${top + Math.min(4, h)}Q${bx},${top} ${bx + Math.min(4, bw / 2)},${top}H${bx + bw - Math.min(4, bw / 2)}Q${bx + bw},${top} ${bx + bw},${top + Math.min(4, h)}V${y(0)}Z`} fill={col[m - pts.length + j]}
                    onMouseMove={(e) => { const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect(); setTip({ x: e.clientX - r.left, y: e.clientY - r.top, t: `${k.label} · ${p.label} ${p.v}%` }); }} />
                  {last && <text x={bx + bw / 2} y={top - 6} textAnchor="middle" className="kc-val">{p.v}%</text>}
                </g>;
              })}
              <line x1={x0 + pad - 4} x2={x0 + band - pad + 4} y1={y(k.goal)} y2={y(k.goal)} className="kc-goal-bar" />
            </g>
          );
        })}
      </svg>
      {tip && <div className="kc-tip" style={{ left: Math.min(tip.x + 12, w - 170), top: Math.max(0, tip.y - 34) }}>{tip.t}</div>}
      <div className="kc-xlabels" style={{ paddingLeft: L, paddingRight: R, gridTemplateColumns: `repeat(${n}, minmax(0,1fr))` }}>
        {list.map((k) => {
          const gap = k.cur === null ? null : k.cur - k.goal;
          return <button key={k.key} type="button" className={`kc-xl ${k.key === sel ? "is-on" : ""}`} onClick={() => onPick(k.key)} aria-pressed={k.key === sel}>
            <b>{k.label}</b>
            <span><em>{k.cur === null ? "-" : `${k.cur}%`}</em> <small className={gap === null ? "" : gap >= 0 ? "is-ok" : "is-bad"}>{gap === null ? "ไม่มีข้อมูล" : gap >= 0 ? "ถึงเป้า" : `ขาด ${Math.abs(gap)}%`}</small></span>
            {k.base && <small className="kc-xl-b">{k.base}</small>}
          </button>;
        })}
      </div>
    </div>
  );
}

/** เส้นแนวโน้ม + พื้นที่ใต้เส้น + เส้นเป้า · ใต้แกนบอกเพิ่ม/ลดจากจุดก่อนหน้า */
function Growth({ pts, goal, name }: { pts: Pt[]; goal: number; name: string }) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const H = 230, L = 40, R = 64, T = 20, B = 50, n = pts.length;
  const x = (i: number) => L + (n > 1 ? (i * (w - L - R)) / (n - 1) : (w - L - R) / 2);
  const y = (v: number) => T + (1 - Math.min(100, Math.max(0, v)) / 100) * (H - T - B);
  const seg = pts.map((p, i) => (p.v === null ? null : [x(i), y(p.v)] as const));
  const path = seg.reduce<string>((d, s, i) => (s ? `${d}${d && seg[i - 1] ? "L" : "M"}${s[0].toFixed(1)},${s[1].toFixed(1)}` : d), "");
  const valid = seg.map((s, i) => (s ? i : -1)).filter((i) => i >= 0);
  const area = valid.length > 1 ? `${path}L${x(valid[valid.length - 1]).toFixed(1)},${y(0)}L${x(valid[0]).toFixed(1)},${y(0)}Z` : "";
  const prevOf = (i: number) => { for (let j = i - 1; j >= 0; j--) if (pts[j].v !== null) return pts[j].v; return null; };
  return (
    <div ref={ref} className="kc-trend kc-growth">
      <svg width={w} height={H} role="img" aria-label={`แนวโน้ม${name}: ${pts.map((p) => `${p.label} ${p.v ?? "-"}%`).join(", ")} · เป้า ${goal}%`}
        onMouseMove={(e) => { const px = e.clientX - e.currentTarget.getBoundingClientRect().left; setHover(Math.max(0, Math.min(n - 1, Math.round(((px - L) / Math.max(1, w - L - R)) * (n - 1))))); }} onMouseLeave={() => setHover(null)}>
        <defs><linearGradient id="kc-area" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#c9a96a" stopOpacity="0.35" /><stop offset="100%" stopColor="#c9a96a" stopOpacity="0.02" /></linearGradient></defs>
        {[0, 50, 100].map((g) => <g key={g}><line x1={L} x2={w - R} y1={y(g)} y2={y(g)} className={g ? "kc-grid" : "kc-base"} /><text x={L - 6} y={y(g) + 4} textAnchor="end" className="kc-tick">{g}%</text></g>)}
        <line x1={L} x2={w - R} y1={y(goal)} y2={y(goal)} className="kc-goal" />
        <text x={w - R + 6} y={y(goal) + 4} className="kc-goal-t">เป้า {goal}%</text>
        {area && <path d={area} fill="url(#kc-area)" />}
        <path d={path} fill="none" stroke="#8b6e3e" strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={y(0)} className="kc-cross" />}
        {pts.map((p, i) => {
          const d = p.v === null ? null : prevOf(i) === null ? null : p.v - (prevOf(i) as number);
          const on = hover === i || (hover === null && i === n - 1);
          return <g key={i}>
            {p.v !== null && <>
              <circle cx={x(i)} cy={y(p.v)} r={on ? 5 : 3.5} fill="#8b6e3e" stroke="#fff" strokeWidth={2} />
              <text x={x(i)} y={y(p.v) - 10} textAnchor="middle" className={on ? "kc-val" : "kc-val-s"}>{p.v}%</text>
            </>}
            <text x={x(i)} y={H - 28} textAnchor="middle" className={`kc-tick ${on ? "is-on" : ""}`}>{p.label}</text>
            <text x={x(i)} y={H - 10} textAnchor="middle" className={`kc-chg ${d === null ? "" : d > 0 ? "is-up" : d < 0 ? "is-down" : ""}`}>{d === null ? "" : d === 0 ? "เท่าเดิม" : `${d > 0 ? "▲" : "▼"} ${Math.abs(d)}%`}</text>
          </g>;
        })}
      </svg>
    </div>
  );
}

/** ช่วงที่ใช้แตกย่อย (ตรงกับตัวเลขใต้กราฟ) · ranges = ช่วงเฉพาะตัวชี้วัด (เช่น การเงินคิดทั้งเดือน) · money = เห็นข้อมูลการเงิน */
export type DrillCtx = { from: string; to: string; label: string; branch: string; money: boolean; ranges?: Record<string, { from: string; to: string; label: string }>; go?: (v: ViewId) => void };

/** curNote = ตัวเลขใต้กราฟมาจากช่วงไหน (เมื่อไม่ใช่ทั้งเดือน เช่น เลือกวันนี้/ช่วงวันที่) */
/** initial = ตัวชี้วัดที่เลือกไว้ตอนเปิด (ไม่ส่ง = ตัวแรก) */
export default function KpiCharts({ pct, counts, vs, drill, curNote, initial }: { pct: PctKpi[]; counts: CountKpi[]; vs: string; drill?: DrillCtx; curNote?: string; initial?: string }) {
  const [sel, setSel] = useState(initial ?? pct[0]?.key);
  const [m, setM] = useState<number>(3);
  const [by, setBy] = useState<"month" | "week">("month");
  const k = pct.find((x) => x.key === sel) ?? pct[0];
  const canDrill = (key: string) => !!drill && isDrillKpi(key) && (key !== "collect" || drill.money);
  const dr = k && drill && canDrill(k.key) && isDrillKpi(k.key) ? { kpi: k.key, ...(drill.ranges?.[k.key] ?? drill) } : null;
  const num = (v: number) => v.toLocaleString("en-US");
  const prevName = vs.trim();
  const months = pct.find((x) => x.monthly?.length)?.monthly ?? [];
  const legend = months.slice(-m);
  // มีแผงแตกย่อย: กดกลุ่มแท่งแล้วเลื่อนไปที่แผง (จอแคบแผงอยู่ใต้กราฟ) · ไม่มี: เลื่อนไปการ์ดแนวโน้ม
  const pick = (key: string) => { setSel(key); setBy("month"); setTimeout(() => document.getElementById(canDrill(key) ? "kc-drill" : "kc-growth")?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 30); };
  // สรุปการเติบโตของตัวที่เลือก: เดือนแรกที่มีข้อมูล → เดือนล่าสุด
  // ตัดเดือนต้นๆ ที่ยังไม่มีข้อมูลเลยออก (เช่น ระบบเริ่มใช้กลางปี) ให้เส้นเริ่มจากเดือนแรกที่มีข้อมูล · เหลืออย่างน้อย 2 จุด
  const raw = k ? (by === "week" && k.trend?.length ? k.trend : k.monthly ?? []) : [];
  const fi = raw.findIndex((p) => p.v !== null);
  const series = fi < 0 ? raw : raw.slice(Math.min(fi, Math.max(0, raw.length - 2)));
  const vals = series.filter((p) => p.v !== null) as { label: string; v: number }[];
  const first = vals[0], last = vals[vals.length - 1];
  const change = first && last && first !== last ? last.v - first.v : null;
  const best = vals.length ? vals.reduce((a, b) => (b.v > a.v ? b : a)) : null;
  const hit = vals.filter((p) => k && p.v >= k.goal).length;
  return (
    <div className="kc">
      <section className="card kc-card is-wide">
        <header className="kc-h">
          <div><h3>ตัวชี้วัดที่เป็น % เทียบเดือนก่อนๆ</h3><p>แท่งเข้มสุด = {legend[legend.length - 1]?.label ?? "เดือนนี้"} · เส้นแดง = เป้า · {drill ? "กดกลุ่มแท่งเพื่อแตกย่อย" : "กดกลุ่มแท่งเพื่อดูแนวโน้มการเติบโต"}{curNote ? ` · ตัวเลขใต้กราฟ = ${curNote}` : ""}</p></div>
          <div className="dash-period" role="radiogroup" aria-label="เทียบกี่เดือน">
            {COMPARE.map((c) => <button key={c} type="button" role="radio" aria-checked={m === c} className={m === c ? "is-on" : ""} onClick={() => setM(c)}>{c} เดือน</button>)}
          </div>
        </header>
        <div className="kc-leg" aria-hidden="true">
          {legend.map((p, i) => <span key={p.label}><i style={{ background: rampOf(legend.length)[i] }} />{p.label}</span>)}
          <span><i className="goal" />เป้าหมาย</span>
        </div>
        <Columns list={pct} m={m} sel={k?.key ?? ""} onPick={pick} />
      </section>
      {dr && k && <div id="kc-drill" className="kc-span min-w-0"><DrillPanel kpi={dr.kpi} label={k.label} goal={k.goal} cur={k.cur} base={k.base} from={dr.from} to={dr.to} period={dr.label} branch={drill!.branch} go={drill!.go} /></div>}

      {k && <section id="kc-growth" className="card kc-card is-wide">
        <header className="kc-h">
          <div><h3>แนวโน้มการเติบโต · {k.label}</h3>
            <p>{vals.length > 1 && change !== null
              ? <>{first.label} {first.v}% → {last.label} {last.v}% · <b className={change >= 0 ? "kc-ok-t" : "kc-bad-t"}>{change > 0 ? "▲ โตขึ้น" : change < 0 ? "▼ ลดลง" : "เท่าเดิม"} {Math.abs(change)}%</b> · ถึงเป้า {hit} จาก {vals.length} {by === "week" ? "สัปดาห์" : "เดือน"}{best ? ` · สูงสุด ${best.label} ${best.v}%` : ""}</>
              : k.note ?? `ช่วงนี้ ${k.cur ?? "-"}% · เป้า ${k.goal}%`}</p></div>
          <div className="flex flex-wrap items-center gap-2">
            {!!k.trend?.length && <div className="dash-period" role="radiogroup" aria-label="ดูแนวโน้มแบบ">
              {([["month", "รายเดือน"], ["week", k.trendName ?? "รายสัปดาห์"]] as const).map(([v, t]) => <button key={v} type="button" role="radio" aria-checked={by === v} className={by === v ? "is-on" : ""} onClick={() => setBy(v)}>{t}</button>)}
            </div>}
            {k.onOpen && <button type="button" className="btn-soft !min-h-0 !py-1.5 !text-sm" onClick={k.onOpen}>{k.openLabel ?? "ดูรายละเอียด"}</button>}
          </div>
        </header>
        {series.length ? <Growth pts={series} goal={k.goal} name={k.label} /> : <p className="kc-empty">ตัวนี้ยังไม่มีข้อมูลย้อนหลัง</p>}
        {(!!k.drill?.length || k.base) && <div className="kc-drill">
          <p>ตอนนี้ {k.cur === null ? "ไม่มีข้อมูล" : `${k.cur}%`}{k.base ? ` (${k.base})` : ""} · {k.prevLabel ?? prevName} {k.prev === null ? "ไม่มีข้อมูล" : `${k.prev}%`} · เป้า {k.goal}%</p>
          {!!k.drill?.length && <ul>{k.drill.map((t) => <li key={t}>{t}</li>)}</ul>}
        </div>}
      </section>}

      {counts.length > 0 && <section className="card kc-card is-wide">
        <header className="kc-h"><div><h3>ตัวชี้วัดที่เป็นจำนวน</h3><p>เทียบช่วง {prevName} กับตอนนี้ · <span className="kc-ok-t">เขียว</span> = ดีขึ้น · <span className="kc-bad-t">แดง</span> = แย่ลง ควรตรวจดู · กดการ์ดเพื่อดูรายละเอียด</p></div></header>
        <div className="kc-counts">
          {counts.map((c) => {
            const d = c.cur - c.prev;
            const good = d === 0 ? null : (d > 0) === c.higherBetter;
            return (
              <button key={c.key} type="button" className="kc-count" onClick={c.onOpen} disabled={!c.onOpen}
                aria-label={`${c.label} ${prevName} ${c.prev} ${c.unit} → ตอนนี้ ${c.cur} ${c.unit}`}>
                <span className="kc-count-n">{c.label}</span>
                <span className="kc-was">เดิม <b>{c.prevText ?? num(c.prev)}</b> → ตอนนี้</span>
                <b className="kc-now">{c.text ?? num(c.cur)} <small>{c.unit}</small></b>
                <small className={`kc-d ${good === null ? "" : good ? "is-ok" : "is-bad"}`}>{d === 0 ? "เท่าเดิม" : `${d > 0 ? "▲ เพิ่ม" : "▼ ลด"} ${num(Math.abs(d))} ${c.unit} · ${good ? "ดีขึ้น" : "ควรตรวจดู"}`}</small>
              </button>
            );
          })}
        </div>
      </section>}
    </div>
  );
}
