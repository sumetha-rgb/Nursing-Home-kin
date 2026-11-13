"use client";
import { PhysioHistory } from "@/lib/physio";
import { PrintLetterhead } from "../ui";

export type CourseInfo = { name: string; total: number; used: number; branch: string; resident: string };
type Pt = { n: number; v: number; at: string };

/** ค่าตัวเลขของแต่ละครั้ง เรียงครั้งแรก → ล่าสุด (items มาจาก API เรียงล่าสุดก่อน) · ครั้งที่ไม่ได้กรอกข้าม */
function series(items: PhysioHistory[], key: "pain" | "adl"): Pt[] {
  return items.slice().reverse().map((h, i) => ({ n: i + 1, v: Number(h[key]), at: h.at, raw: h[key] }))
    .filter((p) => p.raw !== null && p.raw !== undefined && p.raw !== "" && Number.isFinite(p.v)).map(({ n, v, at }) => ({ n, v, at }));
}
const dateOf = (at: string) => at.split(" ")[0] ?? at;

/** กราฟเส้นเดียว แกนเดียว · ชี้จุดดูค่า (title) · ป้ายค่าล่าสุดที่ปลายเส้น */
function Line({ title, sub, pts, max, total, goodDown, color }: { title: string; sub: string; pts: Pt[]; max: number; total: number; goodDown: boolean; color: string }) {
  const W = 320, H = 150, L = 26, Rr = 14, T = 14, B = 24;
  const x = (n: number) => L + ((n - 1) / Math.max(1, total - 1)) * (W - L - Rr);
  const y = (v: number) => T + (1 - v / max) * (H - T - B);
  const step = max <= 10 ? 2 : 5;
  const first = pts[0], last = pts[pts.length - 1];
  const better = goodDown ? last.v < first.v : last.v > first.v, same = last.v === first.v;
  const ticks = [1, ...(total > 2 ? [Math.ceil(total / 2)] : []), total].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <figure className="pp-chart">
      <figcaption><b>{title}</b><span>{sub} · ครั้งแรก {first.v} → ล่าสุด <em className={same ? "" : better ? "is-good" : "is-bad"}>{last.v}</em></span></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title} ครั้งแรก ${first.v} ล่าสุด ${last.v}`}>
        {Array.from({ length: max / step + 1 }, (_, k) => k * step).map((v) => <g key={v}><line className="pp-grid" x1={L} x2={W - Rr} y1={y(v)} y2={y(v)} /><text className="pp-tick" x={L - 5} y={y(v) + 3} textAnchor="end">{v}</text></g>)}
        {ticks.map((n) => <text key={n} className="pp-tick" x={x(n)} y={H - 6} textAnchor="middle">{n}</text>)}
        <polyline points={pts.map((p) => `${x(p.n)},${y(p.v)}`).join(" ")} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => <circle key={p.n} cx={x(p.n)} cy={y(p.v)} r={i === pts.length - 1 ? 4.5 : 3} fill={color} stroke="#fff" strokeWidth={2}><title>ครั้งที่ {p.n} · {dateOf(p.at)} · {p.v}</title></circle>)}
        <text className="pp-lbl" x={x(last.n) - 6} y={y(last.v) - 8} textAnchor="end">{last.v}</text>
      </svg>
    </figure>
  );
}

/** กราฟความก้าวหน้าต่อคอร์ส: ระดับปวด (0–10) และ ADL (0–20) ตามครั้ง · ต้องมีอย่างน้อย 2 ครั้งที่กรอกค่า */
export function PhysioProgress({ items }: { items: PhysioHistory[] }) {
  const pain = series(items, "pain"), adl = series(items, "adl"), total = items.length;
  const mob = items.slice().reverse().map((h) => h.mobility).filter(Boolean) as string[];
  if (pain.length < 2 && adl.length < 2 && mob.length < 2) return null;
  return (
    <section className="pp">
      <h4>ความก้าวหน้า <small>{total} ครั้ง</small></h4>
      <div className="pp-grid2">
        {pain.length >= 2 && <Line title="ระดับปวด" sub="0–10 ยิ่งต่ำยิ่งดี" pts={pain} max={10} total={total} goodDown color="#8b6e3e" />}
        {adl.length >= 2 && <Line title="ADL (Barthel)" sub="0–20 ยิ่งสูงยิ่งทำกิจวัตรเองได้" pts={adl} max={20} total={total} goodDown={false} color="#3f6f8f" />}
      </div>
      {mob.length >= 2 && <p className="pp-mob">การเคลื่อนไหว: <b>{mob[0]}</b> → <b>{mob[mob.length - 1]}</b></p>}
    </section>
  );
}

/** สรุปผลการทำกายภาพเมื่อจบคอร์ส (พิมพ์ให้ญาติ) · ครั้งแรกเทียบครั้งล่าสุด + คำแนะนำจากแผนล่าสุด */
export function PhysioSummaryDoc({ items, course }: { items: PhysioHistory[]; course: CourseInfo }) {
  const asc = items.slice().reverse(), first = asc[0], last = asc[asc.length - 1];
  const firstOf = (k: "pain" | "adl" | "mobility") => asc.find((h) => h[k])?.[k] ?? "-";
  const lastOf = (k: "pain" | "adl" | "mobility") => items.find((h) => h[k])?.[k] ?? "-";
  const people = [...new Set(asc.map((h) => h.author).filter(Boolean))].join(", ");
  const plan = items.find((h) => h.plan?.trim())?.plan ?? "";
  return (
    <div className="ps-doc">
      <PrintLetterhead branch={course.branch} title="สรุปผลการทำกายภาพบำบัด" />
      <h3 className="ps-title">สรุปผลการทำกายภาพบำบัด</h3>
      <dl className="ps-meta">
        <dt>ผู้รับบริการ</dt><dd>{course.resident}</dd>
        <dt>คอร์ส</dt><dd>{course.name} · ทำแล้ว {course.used}/{course.total} ครั้ง</dd>
        <dt>ช่วงเวลา</dt><dd>{first ? dateOf(first.at) : "-"} – {last ? dateOf(last.at) : "-"}</dd>
        <dt>สาขา</dt><dd>{course.branch}</dd>
        <dt>นักกายภาพ</dt><dd>{people || "-"}</dd>
      </dl>
      <table className="ps-table">
        <thead><tr><th></th><th>ครั้งแรก</th><th>ครั้งล่าสุด</th></tr></thead>
        <tbody>
          <tr><td>ระดับความปวด (0–10)</td><td>{firstOf("pain")}</td><td>{lastOf("pain")}</td></tr>
          <tr><td>ADL Barthel (0–20)</td><td>{firstOf("adl")}</td><td>{lastOf("adl")}</td></tr>
          <tr><td>การเคลื่อนไหว</td><td>{firstOf("mobility")}</td><td>{lastOf("mobility")}</td></tr>
        </tbody>
      </table>
      <PhysioProgress items={items} />
      <div className="ps-plan"><b>คำแนะนำต่อเนื่อง</b><p>{plan || "-"}</p></div>
      <div className="ps-sign"><span>ลงชื่อ ........................................ นักกายภาพบำบัด</span><span>วันที่ ........................................</span></div>
    </div>
  );
}
