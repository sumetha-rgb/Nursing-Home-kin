"use client";
import { useLayoutEffect, useRef, useState } from "react";

/**
 * แท็บ "ตัวชี้วัดหลัก" แบบกราฟ (แทนการ์ดตัวเลข)
 *  1) ตัวชี้วัดที่เป็น % ในกราฟเดียว: แท่งเข้ม = ช่วงนี้ · แท่งอ่อน = ช่วงก่อน · เส้นแดง = เป้า · กดแถวดูแนวโน้ม
 *  2) แนวโน้มของตัวที่เลือก พร้อมเส้นเป้า (มีข้อมูลรายเดือน/รายสัปดาห์เฉพาะบางตัว)
 *  3) ตัวชี้วัดที่เป็นจำนวน: แท่งคู่ช่วงก่อน/ช่วงนี้ (แต่ละตัวสเกลของตัวเอง) · กดไปแท็บรายละเอียด
 * สีทองเฉดเดียว 2 ระดับ (#c9a96a / #7a5f33 ผ่านการตรวจสีแล้ว) · ข้อความใช้สีตัวหนังสือ ไม่ใช้สีของแท่ง
 */
export type PctKpi = { key: string; label: string; cur: number | null; prev: number | null; goal: number; note?: string; trend?: { label: string; v: number | null }[]; trendName?: string; onOpen?: () => void };
export type CountKpi = { key: string; label: string; unit: string; cur: number; prev: number; higherBetter: boolean; text?: string; onOpen?: () => void };

function useWidth(min = 200) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(480);
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

function Trend({ k }: { k: PctKpi }) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const pts = k.trend ?? [];
  const H = 200, L = 40, R = 58, T = 12, B = 26, n = pts.length;
  const x = (i: number) => L + (n > 1 ? (i * (w - L - R)) / (n - 1) : (w - L - R) / 2);
  const y = (v: number) => T + (1 - Math.min(100, Math.max(0, v)) / 100) * (H - T - B);
  const seg = pts.map((p, i) => (p.v === null ? null : `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`));
  const path = seg.reduce<string>((d, s, i) => (s ? `${d}${d && seg[i - 1] ? "L" : "M"}${s}` : d), "");
  const lastI = pts.map((p) => p.v).lastIndexOf(pts.filter((p) => p.v !== null).slice(-1)[0]?.v ?? -1);
  const h = hover ?? lastI;
  return (
    <div ref={ref} className="kc-trend">
      <svg width={w} height={H} role="img" aria-label={`แนวโน้ม${k.label}: ${pts.map((p) => `${p.label} ${p.v ?? "-"}%`).join(", ")} · เป้า ${k.goal}%`}
        onMouseMove={(e) => { const px = e.clientX - e.currentTarget.getBoundingClientRect().left; setHover(Math.max(0, Math.min(n - 1, Math.round(((px - L) / Math.max(1, w - L - R)) * (n - 1))))); }} onMouseLeave={() => setHover(null)}>
        {[0, 50, 100].map((g) => <g key={g}><line x1={L} x2={w - R} y1={y(g)} y2={y(g)} className={g ? "kc-grid" : "kc-base"} /><text x={L - 6} y={y(g) + 4} textAnchor="end" className="kc-tick">{g}%</text></g>)}
        {pts.map((p, i) => (n <= 8 || i % 2 === (n - 1) % 2 ? <text key={i} x={x(i)} y={H - 7} textAnchor="middle" className={`kc-tick ${i === hover ? "is-on" : ""}`}>{p.label}</text> : null))}
        <line x1={L} x2={w - R} y1={y(k.goal)} y2={y(k.goal)} className="kc-goal" />
        <text x={w - R + 6} y={y(k.goal) + 4} className="kc-goal-t">เป้า {k.goal}%</text>
        <path d={path} fill="none" stroke="#8b6e3e" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={T} y2={y(0)} className="kc-cross" />}
        {h >= 0 && pts[h]?.v !== null && pts[h] && <>
          <circle cx={x(h)} cy={y(pts[h].v!)} r={4.5} fill="#8b6e3e" stroke="#fff" strokeWidth={2} />
          <text x={x(h)} y={y(pts[h].v!) - 10} textAnchor="middle" className="kc-val">{pts[h].v}%</text>
        </>}
      </svg>
    </div>
  );
}

export default function KpiCharts({ pct, counts, vs }: { pct: PctKpi[]; counts: CountKpi[]; vs: string }) {
  const [sel, setSel] = useState(pct.find((k) => k.trend?.length)?.key ?? pct[0]?.key);
  const k = pct.find((x) => x.key === sel) ?? pct[0];
  const prevName = vs.trim();
  return (
    <div className="kc">
      <section className="card kc-card">
        <header className="kc-h"><div><h3>ตัวชี้วัดที่เป็น % เทียบเป้า</h3><p>เทียบกับช่วง {prevName} กดที่แต่ละแถวเพื่อดูแนวโน้ม</p></div></header>
        <div className="kc-leg" aria-hidden="true"><span><i className="cur" />ช่วงนี้</span><span><i className="prev" />ช่วง {prevName}</span><span><i className="goal" />เส้นเป้าหมาย</span></div>
        <div className="kc-bullets" role="list">
          {pct.map((x) => {
            const gap = x.cur === null ? null : x.cur - x.goal;
            return (
              <button key={x.key} type="button" role="listitem" className={`kc-bul ${x.key === k?.key ? "is-on" : ""}`} onClick={() => setSel(x.key)}
                aria-label={`${x.label} ช่วงนี้ ${x.cur ?? "ไม่มีข้อมูล"}% · ${prevName} ${x.prev ?? "ไม่มีข้อมูล"}% · เป้า ${x.goal}%`}>
                <span className="kc-bul-n">{x.label}</span>
                <span className="kc-track">
                  {x.prev !== null && <i className="p" style={{ width: `${Math.min(100, x.prev)}%` }} />}
                  {x.cur !== null && <i className="c" style={{ width: `${Math.min(100, x.cur)}%` }} />}
                  <i className="g" style={{ left: `${Math.min(100, x.goal)}%` }} />
                </span>
                <span className="kc-bul-v"><b>{x.cur === null ? "-" : `${x.cur}%`}</b><small className={gap === null ? "" : gap >= 0 ? "is-ok" : "is-bad"}>{gap === null ? "ไม่มีข้อมูล" : gap >= 0 ? "ถึงเป้า" : `ขาดอีก ${Math.abs(gap)}%`}</small></span>
              </button>
            );
          })}
        </div>
        <div className="kc-axis" aria-hidden="true"><span>0%</span><span>50%</span><span>100%</span></div>
      </section>

      {k && <section className="card kc-card">
        <header className="kc-h"><div><h3>{k.trend?.length ? `แนวโน้ม${k.trendName ?? ""} · ${k.label}` : k.label}</h3><p>{k.note ?? `ช่วงนี้ ${k.cur ?? "-"}% · ${prevName} ${k.prev ?? "-"}% · เป้า ${k.goal}%`}</p></div>
          {k.onOpen && <button type="button" className="btn-soft !min-h-0 !py-1.5 !text-sm" onClick={k.onOpen}>ดูรายละเอียด</button>}</header>
        {k.trend?.length ? <Trend k={k} /> : <p className="kc-empty">ตัวนี้ยังไม่มีข้อมูลรายเดือนให้ดูแนวโน้ม · ดูรายละเอียดที่ปุ่มด้านบน</p>}
      </section>}

      {counts.length > 0 && <section className="card kc-card is-wide">
        <header className="kc-h"><div><h3>ตัวชี้วัดที่เป็นจำนวน</h3><p>แท่งสีอ่อนคือช่วง {prevName} แท่งสีเข้มคือช่วงนี้ ตัวเลขสี<span className="kc-ok-t">เขียว</span>แปลว่าดีขึ้น สี<span className="kc-bad-t">แดง</span>แปลว่าแย่ลงและควรตรวจดู กดที่การ์ดเพื่อดูรายละเอียด</p></div></header>
        <div className="kc-counts">
          {counts.map((c) => {
            const max = Math.max(c.cur, c.prev, 1), d = c.cur - c.prev;
            const good = d === 0 ? null : (d > 0) === c.higherBetter;
            return (
              <button key={c.key} type="button" className="kc-count" onClick={c.onOpen} disabled={!c.onOpen}
                aria-label={`${c.label} ช่วงนี้ ${c.cur} ${c.unit} · ${prevName} ${c.prev} ${c.unit}`}>
                <span className="kc-count-n">{c.label}</span>
                <span className="kc-pair" aria-hidden="true"><i className="p" style={{ height: `${Math.max(4, (c.prev / max) * 100)}%` }} /><i className="c" style={{ height: `${Math.max(4, (c.cur / max) * 100)}%` }} /></span>
                <b>{c.text ?? c.cur.toLocaleString("en-US")} <small>{c.unit}</small></b>
                <small className={`kc-d ${good === null ? "" : good ? "is-ok" : "is-bad"}`}>{d === 0 ? `เท่ากับช่วง ${prevName}` : `${d > 0 ? "▲ มากขึ้น" : "▼ น้อยลง"} ${Math.abs(d).toLocaleString("en-US")} ${c.unit} ${good ? "ดีขึ้น" : "ควรตรวจดู"}`}</small>
              </button>
            );
          })}
        </div>
      </section>}
    </div>
  );
}
