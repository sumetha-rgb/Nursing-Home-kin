"use client";
/**
 * เงินที่รับในเดือน แยกตามบริษัทที่ออกใบเสร็จ (บริษัทของสาขา) · หน้า ภาพรวมและรายงาน › การเงิน
 *  รับจริง / ก่อน VAT / VAT ขาย ตัดลงรายการตามลำดับตัดชำระ (lib/billing payTake) · ไม่นับเงินประกัน/มัดจำ
 *  ข้อมูลชุดเดียวกับเมนูรายได้ตามฝ่าย (GET /api/billing?op=revenue) · เห็นเฉพาะผู้บริหาร ผู้จัดการสาขา การเงิน
 */
import { useEffect, useMemo, useState } from "react";
import { COMPANY, Section } from "../ui";
import { useBranchInfo } from "../views/Billing";
import { buCatOf } from "@/lib/bu";
import { creditOf, money, parseItems, payTake } from "@/lib/billing";
import { useApp } from "@/lib/app";

type Pay = { date: string; amount: number; items: string; branch: string; paidBefore: number };
type Co = { name: string; recv: number; base: number; vat: number; branches: Set<string> };
const r2 = (n: number) => Math.round(n * 100) / 100;
/** สีบริษัทเดียวกับหน้ารายได้ตามฝ่าย */
const CO_COLORS = ["#8a5a1a", "#2b6b7a", "#6b7a2b", "#7a2b5a", "#4a4a8a"];

export default function CompanyStrip({ month, range, branch, monthLabel }: { month: string; range?: { from: string; to: string }; branch: string; monthLabel: string }) {
  const { go } = useApp();
  const branchInfo = useBranchInfo();
  const [pays, setPays] = useState<Pay[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    setPays(null); setErr("");
    let live = true;
    fetch(`/api/billing?op=revenue&month=${month}${range ? `&from=${range.from}&to=${range.to}` : ""}${branch ? `&branch=${encodeURIComponent(branch)}` : ""}`, { cache: "no-store" })
      .then(async (r) => { const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.error || "โหลดยอดแยกบริษัทไม่สำเร็จ"); return d; })
      .then((d) => { if (live) setPays(d.pays ?? []); })
      .catch((e) => { if (live) setErr((e as Error).message); });
    return () => { live = false; };
  }, [month, branch, range?.from, range?.to]);

  const cos = useMemo(() => {
    const m = new Map<string, Co>();
    for (const p of pays ?? []) {
      const name = branchInfo(p.branch).legal || COMPANY.th;
      if (!m.has(name)) m.set(name, { name, recv: 0, base: 0, vat: 0, branches: new Set() });
      const co = m.get(name)!;
      const its = parseItems(p.items);
      let got = 0;
      for (const l of payTake(its, creditOf(its) + p.paidBefore, p.amount).lines) {
        if (buCatOf(l.item) === "dep") continue;
        co.recv = r2(co.recv + l.take); co.vat = r2(co.vat + l.takeVat); co.base = r2(co.base + l.take - l.takeVat); got += l.take;
      }
      if (got && p.branch) co.branches.add(p.branch);
    }
    return [...m.values()].filter((c) => c.recv).sort((a, b) => b.recv - a.recv);
  }, [pays, branchInfo]);
  const total = cos.reduce((n, c) => n + c.recv, 0);
  const pct = (c: Co) => (total ? Math.round((c.recv / total) * 100) : 0);

  const links = <div className="flex flex-wrap gap-2">
    <button type="button" className="btn-soft" onClick={() => go("revenue")}>รายได้ตามฝ่าย ›</button>
    <button type="button" className="btn-soft" onClick={() => go("sales_tax")}>รายงานภาษีขาย ›</button>
  </div>;
  return (
    <Section title={`เงินที่รับ ${monthLabel} แยกตามบริษัท`} sub="ตามบริษัทที่ออกใบเสร็จ (บริษัทของสาขา) · ไม่นับเงินประกัน/มัดจำ" actions={links}>
      {err ? <p role="alert" className="form-error">{err}</p>
        : !pays ? <p className="text-sm text-gold-500">กำลังโหลด…</p>
        : !cos.length ? <p className="rounded-xl bg-cream-50 px-4 py-6 text-center text-sm text-gold-600">ยังไม่มีการรับเงินในช่วงนี้</p>
        : <>
          <div className="co-strip" role="img" aria-label={cos.map((c) => `${c.name} ${pct(c)}%`).join(", ")}>
            {cos.map((c, i) => <span key={c.name} style={{ width: `${(c.recv / total) * 100}%`, background: CO_COLORS[i % CO_COLORS.length] }} />)}
          </div>
          <div className="co-cards">
            {cos.map((c, i) => (
              <div key={c.name} className="co-card">
                <p className="co-name"><i aria-hidden="true" style={{ background: CO_COLORS[i % CO_COLORS.length] }} />{c.name}<b>{pct(c)}%</b></p>
                <dl>
                  <div><dt>รับจริง</dt><dd>{money(c.recv)}</dd></div>
                  <div><dt>ก่อน VAT</dt><dd>{money(c.base)}</dd></div>
                  <div><dt>VAT ขาย</dt><dd>{money(c.vat)}</dd></div>
                </dl>
                <p className="co-br">{[...c.branches].join(" · ")}</p>
              </div>
            ))}
          </div>
        </>}
    </Section>
  );
}
