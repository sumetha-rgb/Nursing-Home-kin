"use client";
import { KeyboardEvent, useLayoutEffect, useMemo, useRef, useState } from "react";
import Icon from "../Icon";
import { Invoice, money } from "@/lib/billing";
import { useCrud, useRecords } from "@/lib/store";
import { CONTRACTS, RESIDENTS } from "@/lib/mock";
import { usePriceList } from "@/lib/usePrices";
import { DP_NAME, SALE_CATS, SaleCat, saleLines } from "@/lib/salesCategory";

/**
 * ยอดขายตามหมวด (ภาพรวมและรายงาน → แท็บยอดขายตามหมวด)
 * ยอด = หลังส่วนลด ก่อน VAT ของใบที่ออกแล้ว ตามวันที่ออกใบ · ไม่นับเงินประกัน/รับล่วงหน้า และบรรทัดหักเงินที่รับไว้แล้ว
 * กราฟสีทองเฉดเดียว: เส้นการเติบโต · แท่งเทียบเดือนนี้กับเดือนก่อน · เส้นเล็กของแต่ละหมวด · รายการขายดี
 */
const TH_MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];
const monLabel = (k: string) => `${TH_MON[Number(k.slice(5, 7)) - 1]} ${String(Number(k.slice(0, 4)) + 543).slice(2)}`;
const monthsTo = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number); return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1)).toISOString().slice(0, 7)); };
const short = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)} ล.` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(Math.round(n)));
const pct = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);
const Change = ({ cur, prev }: { cur: number; prev: number }) => {
  const p = pct(cur, prev);
  if (p === null) return <span className="sc-chg">{cur > 0 ? "ใหม่" : "-"}</span>;
  return <span className={`sc-chg ${p > 0 ? "is-up" : p < 0 ? "is-down" : ""}`}>{p > 0 ? "▲" : p < 0 ? "▼" : "•"} {Math.abs(p)}%</span>;
};
/** ค่าสูงสุดของแกนที่อ่านง่าย (1, 2, 2.5, 5 × 10ⁿ) */
const niceMax = (v: number) => { if (v <= 0) return 1; const e = 10 ** Math.floor(Math.log10(v)); return [1, 2, 2.5, 5, 10].map((s) => s * e).find((s) => s >= v)!; };

function useWidth(min = 240) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // วัดทันทีตอนแสดงครั้งแรก แล้วตามขนาดที่เปลี่ยนภายหลัง
    setW(Math.max(min, Math.round(el.getBoundingClientRect().width)));
    const ro = new ResizeObserver(([e]) => setW(Math.max(min, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [min]);
  return [ref, w] as const;
}

/** กราฟเส้นการเติบโตรายเดือน: เส้น 2px + พื้นจาง · ชี้/ลูกศรซ้ายขวาเห็นยอดและการเปลี่ยนแปลงจากเดือนก่อน · ป้ายตัวเลขเฉพาะจุดล่าสุด */
function TrendChart({ months, values, name }: { months: string[]; values: number[]; name: string }) {
  const [ref, w] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const H = 240, L = 44, R = 64, T = 16, B = 28;
  const max = niceMax(Math.max(...values, 1));
  const x = (i: number) => L + (i * (w - L - R)) / Math.max(1, months.length - 1);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const pts = values.map((v, i) => [x(i), y(v)] as const);
  const line = pts.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)},${b.toFixed(1)}`).join("");
  const area = `${line}L${x(values.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const last = values.length - 1;
  const every = w < 520 ? 2 : 1;
  const at = (clientX: number, el: SVGSVGElement) => {
    const px = clientX - el.getBoundingClientRect().left;
    setHover(Math.max(0, Math.min(last, Math.round(((px - L) / (w - L - R)) * last))));
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); setHover((h) => Math.max(0, (h ?? last) - 1)); }
    if (e.key === "ArrowRight") { e.preventDefault(); setHover((h) => Math.min(last, (h ?? last) + 1)); }
  };
  const h = hover;
  return (
    <div ref={ref} className="sc-trend">
      <svg width={w} height={H} role="img" tabIndex={0} aria-label={`${name} รายเดือน: ${months.map((m, i) => `${monLabel(m)} ${money(values[i])} บาท`).join(", ")}`}
        onMouseMove={(e) => at(e.clientX, e.currentTarget)} onMouseLeave={() => setHover(null)} onKeyDown={key} onBlur={() => setHover(null)}>
        <defs><linearGradient id="sc-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#c9a96a" stopOpacity=".32" /><stop offset="1" stopColor="#c9a96a" stopOpacity="0" /></linearGradient></defs>
        {[0, 0.5, 1].map((g) => <g key={g}><line x1={L} x2={w - R} y1={y(max * g)} y2={y(max * g)} className={g ? "sc-grid" : "sc-axis"} /><text x={L - 8} y={y(max * g) + 4} textAnchor="end" className="sc-tick">{short(max * g)}</text></g>)}
        {months.map((m, i) => (i % every === (last % every) ? <text key={m} x={x(i)} y={H - 8} textAnchor="middle" className={`sc-tick ${i === h ? "is-on" : ""}`}>{monLabel(m)}</text> : null))}
        <path d={area} fill="url(#sc-fill)" />
        <path d={line} fill="none" stroke="#8b6e3e" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {h !== null && <line x1={x(h)} x2={x(h)} y1={T} y2={y(0)} className="sc-cross" />}
        <circle cx={pts[last][0]} cy={pts[last][1]} r={4.5} fill="#8b6e3e" stroke="#fff" strokeWidth={2} />
        {h !== null && h !== last && <circle cx={pts[h][0]} cy={pts[h][1]} r={4.5} fill="#8b6e3e" stroke="#fff" strokeWidth={2} />}
        <text x={pts[last][0] + 9} y={pts[last][1] + 4} className="sc-endval">{short(values[last])}</text>
      </svg>
      {h !== null && <div className="sc-tip" style={{ left: Math.min(Math.max(x(h), 90), w - 90), top: Math.max(0, y(values[h]) - 74) }}>
        <b>{monLabel(months[h])}</b><span>{money(values[h])} บาท</span>
        {h > 0 && (values[h] > 0 || values[h - 1] > 0) && <span><Change cur={values[h]} prev={values[h - 1]} /><small> จาก {monLabel(months[h - 1])}</small></span>}
      </div>}
    </div>
  );
}

/** เส้นเล็กของแต่ละหมวด (สเกลของตัวเอง ดูทิศทางการเติบโต) */
function Spark({ values, months }: { values: number[]; months: string[] }) {
  const [ref, w] = useWidth(80);
  const [hover, setHover] = useState<number | null>(null);
  const H = 56, P = 6;
  const max = Math.max(...values, 1), last = values.length - 1;
  const x = (i: number) => P + (i * (w - 2 * P)) / Math.max(1, last);
  const y = (v: number) => P + (1 - v / max) * (H - 2 * P);
  const line = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const h = hover ?? last;
  return (
    <div ref={ref} className="sc-spark">
      <svg width={w} height={H} aria-hidden="true" onMouseMove={(e) => { const px = e.clientX - e.currentTarget.getBoundingClientRect().left; setHover(Math.max(0, Math.min(last, Math.round(((px - P) / (w - 2 * P)) * last)))); }} onMouseLeave={() => setHover(null)}>
        <path d={`${line}L${x(last)},${H - P}L${x(0)},${H - P}Z`} fill="#c9a96a" fillOpacity={0.16} />
        <path d={line} fill="none" stroke="#8b6e3e" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && <line x1={x(h)} x2={x(h)} y1={P} y2={H - P} className="sc-cross" />}
        <circle cx={x(h)} cy={y(values[h])} r={4} fill="#8b6e3e" stroke="#fff" strokeWidth={2} />
      </svg>
      <p className="sc-spark-at">{hover !== null ? `${monLabel(months[h])} · ${money(values[h])} บาท` : " "}</p>
    </div>
  );
}

export default function SalesByCategory({ branch, month }: { branch: string; month: string }) {
  const [all, , meta] = useRecords<Invoice>("invoices", []);
  const res = useCrud("residents", RESIDENTS);
  const con = useCrud("contracts", CONTRACTS);
  const prices = usePriceList();
  const [cat, setCat] = useState<SaleCat | "">("");
  const [range, setRange] = useState<"month" | "year">("month");
  const [q, setQ] = useState("");
  const [hoverBar, setHoverBar] = useState<string | null>(null);

  const branchOf = (x: Invoice) => con.rows.find((c) => c[0] === x.contract)?.[1] ?? res.rows.find((r) => r[0] === x.who)?.[3] ?? "";
  const list = branch ? all.filter((x) => branchOf(x) === branch) : all;
  const lines = useMemo(() => saleLines(list, prices), [list, prices]); // eslint-disable-line react-hooks/exhaustive-deps
  const months = monthsTo(month, 12), prev = months[10];
  const sales = lines.filter((l) => l.cat !== "DP");
  const sumOf = (m: string, c?: SaleCat) => sales.reduce((n, l) => n + (l.date.startsWith(m) && (!c || l.cat === c) ? l.amount : 0), 0);
  const cats = SALE_CATS.filter((c) => sales.some((l) => l.cat === c.id && months.some((m) => l.date.startsWith(m))));
  const name = cat ? SALE_CATS.find((c) => c.id === cat)?.name ?? cat : "ทุกหมวด";
  const trend = months.map((m) => sumOf(m, cat || undefined));
  const rows = cats.map((c) => ({ ...c, cur: sumOf(month, c.id), prev: sumOf(prev, c.id) })).sort((a, b) => b.cur - a.cur || b.prev - a.prev);
  const barMax = niceMax(Math.max(1, ...rows.flatMap((r) => [r.cur, r.prev])));
  const totalNow = sumOf(month), totalPrev = sumOf(prev);
  const dpNow = lines.filter((l) => l.cat === "DP" && l.date.startsWith(month)).reduce((n, l) => n + l.amount, 0);

  // รายการขายดี: ในหมวดที่เลือก (หรือทุกหมวด) · เดือนที่เลือก หรือ 12 เดือน · ค้นหาชื่อหรือรหัส
  const k = q.replace(/\s+/g, "").toLowerCase();
  const inRange = (d: string) => (range === "month" ? d.startsWith(month) : d >= months[0] && d.slice(0, 7) <= month);
  const items = Object.values(sales.filter((l) => (!cat || l.cat === cat) && inRange(l.date)).reduce<Record<string, { item: string; code: string; cat: SaleCat; sub: string; amount: number; qty: number }>>((acc, l) => {
    const key = l.code || l.item;
    acc[key] ??= { item: l.item, code: l.code, cat: l.cat, sub: l.sub, amount: 0, qty: 0 };
    acc[key].amount += l.amount; acc[key].qty += l.qty;
    return acc;
  }, {})).filter((x) => !k || (x.item + x.code + x.sub).replace(/\s+/g, "").toLowerCase().includes(k)).sort((a, b) => b.amount - a.amount);
  const top = items.slice(0, 10), topMax = Math.max(1, ...top.map((x) => x.amount));

  if (!meta.loaded && !all.length) return <p className="py-10 text-center text-sm text-gold-500">กำลังโหลดยอดขาย…</p>;
  return (
    <div className="space-y-5">
      <div className="pl-chips sc-filter" role="group" aria-label="เลือกหมวด">
        <button type="button" aria-pressed={!cat} onClick={() => setCat("")}>ทุกหมวด</button>
        {cats.map((c) => <button key={c.id} type="button" aria-pressed={cat === c.id} onClick={() => setCat(cat === c.id ? "" : c.id)}><span className="pl-code">{c.id}</span> {c.name}</button>)}
      </div>

      <section className="card sc-card">
        <header className="sc-h">
          <div><h3>การเติบโตของยอดขาย · {name}</h3><p>12 เดือนถึง {monLabel(month)} · หลังส่วนลด ก่อน VAT</p></div>
          <div className="sc-hero"><b>{money(trend[11])}</b><span>บาท ใน {monLabel(month)} <Change cur={trend[11]} prev={trend[10]} /></span></div>
        </header>
        {trend.some((v) => v > 0) ? <TrendChart months={months} values={trend} name={`ยอดขาย${name}`} /> : <p className="sc-empty">ยังไม่มียอดขาย{cat ? `ในหมวด${name}` : ""}ใน 12 เดือนนี้</p>}
      </section>

      <div className="sc-two">
        <section className="card sc-card">
          <header className="sc-h">
            <div><h3>เทียบหมวด {monLabel(month)} กับ {monLabel(prev)}</h3><p>กดแถบเพื่อดูหมวดนั้น</p></div>
          </header>
          <div className="sc-legend" aria-hidden="true"><span><i className="is-prev" />{monLabel(prev)}</span><span><i className="is-cur" />{monLabel(month)}</span></div>
          {rows.length ? <div className="sc-bars" role="list">
            {rows.map((r) => (
              <button key={r.id} type="button" role="listitem" className={`sc-bar-row ${cat === r.id ? "is-on" : ""}`} onClick={() => setCat(cat === r.id ? "" : r.id)}
                onMouseEnter={() => setHoverBar(r.id)} onMouseLeave={() => setHoverBar(null)} onFocus={() => setHoverBar(r.id)} onBlur={() => setHoverBar(null)}
                aria-label={`${r.name}: ${monLabel(month)} ${money(r.cur)} บาท, ${monLabel(prev)} ${money(r.prev)} บาท`}>
                <span className="sc-bar-name">{r.name}</span>
                <span className="sc-bar-track">
                  <i className="is-prev" style={{ width: `${(r.prev / barMax) * 100}%` }} />
                  <i className="is-cur" style={{ width: `${(r.cur / barMax) * 100}%` }} />
                  {hoverBar === r.id && <span className="sc-tip is-bar"><b>{r.name}</b><span>{monLabel(month)} {money(r.cur)}</span><span>{monLabel(prev)} {money(r.prev)}</span></span>}
                </span>
                <span className="sc-bar-val"><b>{short(r.cur)}</b><Change cur={r.cur} prev={r.prev} /></span>
              </button>
            ))}
          </div> : <p className="sc-empty">ยังไม่มียอดขายในช่วงนี้</p>}
          <p className="sc-foot">รวม {monLabel(month)} {money(totalNow)} บาท <Change cur={totalNow} prev={totalPrev} />{dpNow > 0 ? ` · ไม่นับ${DP_NAME} ${money(dpNow)} บาท` : ""}</p>
        </section>

        <section className="card sc-card">
          <header className="sc-h">
            <div><h3>ขายดี · {name}</h3><p>เรียงตามยอดขาย 10 อันดับ</p></div>
            <div className="segmented-tabs" role="group" aria-label="ช่วงเวลา">
              {([["month", monLabel(month)], ["year", "12 เดือน"]] as const).map(([v, t]) => <button key={v} type="button" className={range === v ? "is-selected" : ""} aria-pressed={range === v} onClick={() => setRange(v)}>{t}</button>)}
            </div>
          </header>
          <div className="relative">
            <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gold-400" />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} className="!pl-10" placeholder="ค้นหารายการหรือรหัส เช่น พ่นยา หรือ NS-21" aria-label="ค้นหารายการขายดี" />
          </div>
          {top.length ? <ol className="sc-top">
            {top.map((x, i) => (
              <li key={x.code || x.item} title={`${x.item} · ${money(x.amount)} บาท · ${x.qty} หน่วย`}>
                <span className="sc-rank">{i + 1}</span>
                <div className="min-w-0">
                  <p><span className="sc-item">{x.item}</span>{x.code && <span className="pl-code">{x.code}</span>}</p>
                  <span className="sc-top-track"><i style={{ width: `${(x.amount / topMax) * 100}%` }} /></span>
                </div>
                <span className="sc-top-val"><b>{money(x.amount)}</b><small>{x.qty.toLocaleString("en-US")} หน่วย</small></span>
              </li>
            ))}
          </ol> : <p className="sc-empty">{q ? `ไม่พบ "${q}"` : "ยังไม่มียอดขายในช่วงนี้"}</p>}
        </section>
      </div>

      {cats.length > 1 && <section className="card sc-card">
        <header className="sc-h"><div><h3>แนวโน้มแต่ละหมวด</h3><p>12 เดือน · แต่ละกราฟใช้สเกลของตัวเองเพื่อดูทิศทาง · กดเพื่อดูหมวดนั้น</p></div></header>
        <div className="sc-multi">
          {cats.map((c) => {
            const vals = months.map((m) => sumOf(m, c.id));
            return (
              <button key={c.id} type="button" className={`sc-mini ${cat === c.id ? "is-on" : ""}`} onClick={() => setCat(cat === c.id ? "" : c.id)}>
                <span className="sc-mini-h"><b>{c.name}</b><Change cur={vals[11]} prev={vals[10]} /></span>
                <span className="sc-mini-v">{money(vals[11])} <small>บาท · {totalNow ? Math.round((vals[11] / totalNow) * 100) : 0}% ของยอดรวม</small></span>
                <Spark values={vals} months={months} />
              </button>
            );
          })}
        </div>
      </section>}
    </div>
  );
}
