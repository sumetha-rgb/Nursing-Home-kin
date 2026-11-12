"use client";
import type { BranchCompare } from "@/lib/insights";
import { DEFAULT_TARGETS, type Targets } from "./Insights";

/* ---------- 1 · ตัวเลขหลักแถวบน (กดแล้วไปหน้าที่เกี่ยวข้อง) ---------- */
export type Tile = {
  key: string; label: string; value: string; unit?: string; sub?: string;
  /** ▲▼ เทียบช่วงก่อน · tone = ดี/แย่ */
  delta?: { text: string; tone: "ok" | "bad" | "flat" };
  /** แถบ % พร้อมเส้นเป้า */
  meter?: { pct: number; goal: number };
  urgent?: boolean; onClick?: () => void;
};
export function DashTiles({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="dx-tiles" style={{ ["--n" as string]: tiles.length }}>
      {tiles.map((t) => (
        <button key={t.key} type="button" className={`dx-tile ${t.urgent ? "is-urgent" : ""}`} onClick={t.onClick} disabled={!t.onClick}
          aria-label={`${t.label} ${t.value}${t.unit ? ` ${t.unit}` : ""}${t.sub ? ` · ${t.sub}` : ""}${t.delta ? ` · ${t.delta.text}` : ""}`}>
          <span className="dx-lbl">{t.label}</span>
          <span className="dx-val">{t.value}{t.unit && <small>{t.unit}</small>}</span>
          {t.meter && <span className="dx-meter" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, t.meter.pct))}%` }} /><b style={{ left: `${Math.min(100, t.meter.goal)}%` }} /></span>}
          {t.sub && <span className="dx-sub">{t.sub}</span>}
          {t.delta && <span className={`dx-delta is-${t.delta.tone}`}>{t.delta.text}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------- 3 · แท็บ 4 กลุ่ม + แท็บย่อย ---------- */
export type TabGroup = { name: string; subs: string[]; hint?: string };
export function GroupTabs({ groups, value, onChange }: { groups: TabGroup[]; value: string; onChange: (v: string) => void }) {
  const cur = groups.find((g) => g.subs.includes(value)) ?? groups[0];
  return (
    <div className="dx-tabs-wrap">
      <div className="dx-tabs" role="tablist" aria-label="หมวดรายงาน">
        {groups.map((g) => (
          <button key={g.name} type="button" role="tab" aria-selected={g === cur} onClick={() => g !== cur && onChange(g.subs[0])}>
            {g.name}{(g.hint || g.subs.length > 1) && <small>{g.hint ?? g.subs.join(" · ")}</small>}
          </button>
        ))}
      </div>
      {cur.subs.length > 1 && <div className="dx-subtabs" role="group" aria-label={`หัวข้อใน${cur.name}`}>
        {cur.subs.map((s) => <button key={s} type="button" aria-pressed={s === value} className={s === value ? "is-on" : ""} onClick={() => onChange(s)}>{s}</button>)}
      </div>}
    </div>
  );
}

/* ---------- 6 · เทียบสาขา (ผู้บริหารที่ดูรวมทุกสาขา) ---------- */
type Store = { default?: Partial<Targets>; branches?: Record<string, Partial<Targets>> };
const money = (v: number) => Math.round(v).toLocaleString("en-US");
/** ดี = ถึงเป้า · กลาง = ขาดไม่เกิน 10 · แย่ = ขาดเกิน 10 */
const heatPct = (v: number | null, goal: number) => (v === null ? "" : v >= goal ? "h-good" : v >= goal - 10 ? "h-mid" : "h-bad");
const heatCount = (n: number, mid: number) => (n === 0 ? "h-good" : n <= mid ? "h-mid" : "h-bad");
export function BranchCompareTable({ rows, store, money: showMoney, onPick }: { rows: BranchCompare[]; store: Store; money: boolean; onPick: (b: string) => void }) {
  const t = (b: string): Targets => ({ ...DEFAULT_TARGETS, ...(store.default ?? {}), ...(store.branches?.[b] ?? {}) });
  const list = rows.map((r) => {
    const T = t(r.branch);
    const occ = r.capacity ? Math.round((r.inBed / r.capacity) * 100) : null;
    const ontimePct = r.done ? Math.round((r.ontime / r.done) * 100) : null;
    // ยังไม่มีผู้รับบริการ (สาขายังไม่เปิด/ไม่มีข้อมูล) = ไม่คิดกะคนไม่พอ
    const gaps = r.residents ? r.shifts.filter((s) => !s || r.residents / s > T.ratio).length : null;
    return { ...r, T, occ, ontimePct, gaps };
  });
  if (!list.length) return null;
  return (
    <section className="card kc-card dx-cmp">
      <header className="kc-h"><div><h3>เทียบสาขา</h3><p><span className="dx-key h-good">ถึงเป้า</span> <span className="dx-key h-mid">ใกล้เป้า</span> <span className="dx-key h-bad">ต้องดู</span> · เป้าของแต่ละสาขาตามที่ตั้งไว้ · กดชื่อสาขาเพื่อดูเฉพาะสาขานั้น</p></div></header>
      <div className="dx-tbl">
        <table>
          <thead><tr>
            <th scope="col">สาขา</th><th scope="col" className="n">อัตราเข้าพัก</th>
            {showMoney && <><th scope="col" className="n">รับชำระเดือนนี้</th><th scope="col" className="n">ค้างชำระ</th></>}
            <th scope="col" className="n">ส่งงานตรงเวลา</th><th scope="col" className="n">ค่าผิดปกติรอรับทราบ</th><th scope="col" className="n">กะคนไม่พอ</th>
          </tr></thead>
          <tbody>{list.map((r) => (
            <tr key={r.branch}>
              <th scope="row"><button type="button" className="dx-branch" onClick={() => onPick(r.branch)}>{r.branch}</button></th>
              <td className={`n ${heatPct(r.occ, r.T.occupancy)}`}>{r.occ === null ? "-" : `${r.occ}%`}<small>{r.inBed}/{r.capacity} เตียง</small></td>
              {showMoney && <><td className="n">{money(r.paid ?? 0)}</td><td className="n">{money(r.owe ?? 0)}<small>{r.oweN ?? 0} ใบ</small></td></>}
              <td className={`n ${heatPct(r.ontimePct, r.T.ontime)}`}>{r.ontimePct === null ? "-" : `${r.ontimePct}%`}<small>{r.ontimePct === null ? "ยังไม่มีงานส่ง" : `${r.ontime}/${r.done} งาน`}</small></td>
              <td className={`n ${heatCount(r.openAlerts, 2)}`}>{r.openAlerts}</td>
              <td className={`n ${r.gaps === null ? "" : heatCount(r.gaps, 2)}`}>{r.gaps === null ? "-" : r.gaps}<small>{r.gaps === null ? "ยังไม่มีผู้รับบริการ" : `จาก ${r.shifts.length} กะ`}</small></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}
