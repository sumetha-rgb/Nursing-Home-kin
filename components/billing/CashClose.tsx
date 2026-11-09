"use client";
import { useCallback, useEffect, useState } from "react";
import CsvIcon from "@/components/CsvIcon";
import Icon from "../Icon";
import { DataTable, Field, MenuButton, Modal, Section } from "../ui";
import { docDate, money, todayIso } from "@/lib/billing";
import { useApp } from "@/lib/app";
import { useBranchNames } from "@/lib/branches";
import { downloadCsv } from "@/lib/store";
import { closesCsv } from "@/lib/exportsCsv";

/**
 * สถานะการปิดยอดรายสาขา 30 วันล่าสุด (แท็บการเงินในภาพรวมและรายงาน)
 *  วันที่มีรับเงินแต่ยังไม่ปิดยอด · รอตรวจรับรอง · ส่วนต่างเงินสดสะสม · ส่งออก CSV
 */
export function CashCloseStatus({ branch, onOpen }: { branch: string; onOpen?: () => void }) {
  const [pays, setPays] = useState<Pay[] | null>(null);
  const [closes, setCloses] = useState<Close[]>([]);
  useEffect(() => {
    const q = branch ? `&branch=${encodeURIComponent(branch)}` : "";
    Promise.all([
      fetch(`/api/billing?op=payments${q}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/billing?op=closes${q}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
    ]).then(([p, c]) => { setPays(p?.items ? (p.items as Pay[]).filter(hasMoney) : null); setCloses(c?.items ?? []); }).catch(() => setPays(null));
  }, [branch]);
  if (!pays) return null;
  const today = todayIso(), since = new Date(Date.parse(today) - 30 * 864e5).toISOString().slice(0, 10);
  const names = [...new Set([...pays.map((p) => p.branch), ...closes.map((c) => c.branch)])].filter((b) => b && (!branch || b === branch)).sort();
  const rows = names.map((b) => {
    const days = [...new Set(pays.filter((p) => p.branch === b && p.date >= since && p.date < today).map((p) => p.date))];
    const cl = closes.filter((c) => c.branch === b && c.date >= since);
    const open = days.filter((d) => !cl.some((c) => c.date === d)).sort();
    return { b, days: days.length, closed: cl.length, open, wait: cl.filter((c) => !c.approvedBy).length, diff: r2(cl.reduce((n, c) => n + (c.counted - c.cash), 0)), short: cl.filter((c) => c.counted < c.cash - 0.005).length, last: cl.map((c) => c.date).sort().pop() ?? "" };
  });
  const exportCsv = () => downloadCsv(`สถานะปิดยอด-30วัน-${branch || "ทุกสาขา"}-${today}`, ["สาขา", "วันที่มีรับเงิน", "ปิดยอดแล้ว", "ยังไม่ปิดยอด (วัน)", "วันที่ยังไม่ปิด", "รอตรวจรับรอง", "วันที่เงินสดขาด", "ส่วนต่างเงินสดรวม", "ปิดยอดล่าสุด"],
    rows.map((r) => [r.b, String(r.days), String(r.closed), String(r.open.length), r.open.map(docDate).join(" "), String(r.wait), String(r.short), money(r.diff), r.last ? docDate(r.last) : ""]));
  return (
    <Section title="สถานะปิดยอดรายวัน (30 วัน)" sub="แดง = ยังไม่ได้ปิดยอด · ส่วนต่าง = เงินที่นับได้ − ยอดในระบบ"
      actions={<><button className="btn-soft" disabled={!rows.length} onClick={exportCsv}><CsvIcon /> ส่งออก CSV</button>{onOpen && <button className="btn-soft" onClick={onOpen}>ไปปิดยอด</button>}</>}>
      <DataTable search={false} columns={["สาขา", "วันที่มีรับเงิน", "ปิดยอดแล้ว", "ยังไม่ปิดยอด", "รอตรวจรับรอง", "ส่วนต่างเงินสดรวม", "ปิดยอดล่าสุด"]} empty="ยังไม่มีการรับเงินใน 30 วัน"
        rows={rows.map((r) => [r.b, `${r.days} วัน`, `${r.closed} วัน`, r.open.length ? `${r.open.length} วัน` : "-", r.wait ? `${r.wait} วัน` : "-", r.diff ? money(r.diff) : "ตรงยอด", r.last ? docDate(r.last) : "-"])}
        render={(k, col) => {
          const r = rows[k];
          if (col === 3 && r.open.length) return <span className="status-badge status-danger" title={r.open.map(docDate).join(", ")}>{r.open.length} วัน</span>;
          if (col === 4 && r.wait) return <span className="status-badge status-warning">{r.wait} วัน</span>;
          if (col === 5) return <span className={r.diff < 0 ? "v-crit" : r.diff > 0 ? "v-watch" : ""}>{r.diff ? `${r.diff > 0 ? "เกิน" : "ขาด"} ${money(Math.abs(r.diff))}` : "ตรงยอด"}</span>;
          return undefined;
        }} />
    </Section>
  );
}

type Pay = { date: string; no: string | null; n: number; branch: string; who: string; cash: number; transfer: number; credit: number; amount: number; cashier: string; slip: boolean };
type Close = { id: string; branch: string; date: string; payments: number; cash: number; transfer: number; credit: number; counted: number; note: string; closedBy: string; closedAt: string; approvedBy: string | null; approvedAt: string | null };

const r2 = (n: number) => Math.round(n * 100) / 100;
/** งวดที่มีเงินเข้าจริง (ไม่นับใบลดหนี้ที่หักยอด และภาษีหัก ณ ที่จ่ายที่ไม่มีเงิน) */
const hasMoney = (p: Pay) => p.cash + p.transfer + p.credit > 0;
const num = (s: string) => Number(String(s).replace(/,/g, "")) || 0;

/**
 * ปิดยอดเงินรายวัน (หน้าใบแจ้งหนี้และใบเสร็จ)
 *  แคชเชียร์เลือกวัน → เห็นยอดรับชำระของวันนั้นแยก เงินสด / โอน / บัตร → กรอกเงินสดที่นับได้จริง → ปิดยอด (ไม่ตรงต้องใส่หมายเหตุ)
 *  ผู้จัดการสาขาตรวจรับรอง · รับเงินของวันนั้นเพิ่มหลังปิดยอด ระบบเตือนให้ปิดยอดใหม่
 */
export default function CashClose({ open, onClose, isGlobal }: { open: boolean; onClose: () => void; isGlobal: boolean }) {
  const { toast } = useApp();
  const branches = useBranchNames();
  const [branch, setBranch] = useState("");
  const [date, setDate] = useState(todayIso());
  const [pays, setPays] = useState<Pay[]>([]);
  const [closes, setCloses] = useState<Close[]>([]);
  const [canApprove, setCanApprove] = useState(false);
  const [missing, setMissing] = useState("");
  const [counted, setCounted] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [redo, setRedo] = useState(false);

  useEffect(() => { if (isGlobal && !branch && branches.length) setBranch(branches[0]); }, [isGlobal, branch, branches]);
  const load = useCallback(async () => {
    const q = isGlobal && branch ? `&branch=${encodeURIComponent(branch)}` : "";
    const [p, c] = await Promise.all([
      fetch(`/api/billing?op=payments${q}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : { items: [] })),
      fetch(`/api/billing?op=closes${q}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : { items: [] })),
    ]).catch(() => [{ items: [] }, { items: [] }]);
    setPays(((p.items ?? []) as Pay[]).filter(hasMoney)); setCloses(c.items ?? []); setCanApprove(!!c.canApprove); setMissing(c.missing ?? "");
  }, [isGlobal, branch]);
  useEffect(() => { if (open) load(); }, [open, load]);
  useEffect(() => { setCounted(""); setNote(""); setRedo(false); }, [date, branch]);

  const inBranch = (x: { branch: string }) => !isGlobal || !branch || x.branch === branch;
  const day = pays.filter((p) => p.date === date && inBranch(p));
  const sum = { cash: r2(day.reduce((n, p) => n + p.cash, 0)), transfer: r2(day.reduce((n, p) => n + p.transfer, 0)), credit: r2(day.reduce((n, p) => n + p.credit, 0)) };
  const total = r2(sum.cash + sum.transfer + sum.credit);
  const noSlip = day.filter((p) => p.transfer > 0 && !p.slip).length;
  const closed = closes.find((c) => c.date === date && inBranch(c));
  // รับเงินของวันนั้นเพิ่ม/แก้หลังปิดยอด
  const changed = !!closed && (closed.payments !== day.length || Math.abs(closed.cash - sum.cash) > 0.005 || Math.abs(closed.transfer - sum.transfer) > 0.005 || Math.abs(closed.credit - sum.credit) > 0.005);
  const diff = counted === "" ? null : r2(num(counted) - sum.cash);
  const showForm = !closed || changed || redo;
  // วันที่รับเงินแล้วยังไม่ปิดยอด (14 วันล่าสุด)
  const since = new Date(Date.parse(todayIso()) - 14 * 864e5).toISOString().slice(0, 10);
  const unclosed = [...new Set(pays.filter((p) => inBranch(p) && p.date >= since && p.date <= todayIso()).map((p) => p.date))]
    .filter((d) => !closes.some((c) => c.date === d && inBranch(c))).sort().reverse();

  const save = async () => {
    if (busy) return;
    if (counted === "") return toast("กรุณากรอกเงินสดที่นับได้จริง (ไม่มีเงินสด ใส่ 0)");
    if (diff && !note.trim()) return toast(`เงินสด${diff > 0 ? "เกิน" : "ขาด"} ${money(Math.abs(diff))} บาท · กรุณาใส่หมายเหตุ`);
    setBusy(true);
    try {
      const r = await fetch("/api/billing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "close", date, branch, counted: num(counted), note: note.trim() }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "ปิดยอดไม่สำเร็จ");
      toast(`ปิดยอดแล้ว · ${docDate(date)} · ${diff ? `เงินสด${diff > 0 ? "เกิน" : "ขาด"} ${money(Math.abs(diff))} บาท` : "เงินสดตรงยอด"} · รอผู้จัดการตรวจรับรอง`);
      setRedo(false); await load();
    } catch (e) { toast((e as Error).message); }
    finally { setBusy(false); }
  };
  const approve = async (c: Close) => {
    const r = await fetch("/api/billing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "close_approve", id: c.id }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return toast(d.error || "ตรวจรับรองไม่สำเร็จ");
    toast(`ตรวจรับรองการปิดยอดแล้ว · ${docDate(c.date)}`); load();
  };
  const diffOf = (c: Close) => r2(c.counted - c.cash);
  const diffText = (v: number) => (v === 0 ? "ตรงยอด" : `${v > 0 ? "เกิน" : "ขาด"} ${money(Math.abs(v))}`);
  /**
   * ส่งออกประวัติการปิดยอดตามช่วง ให้ฝ่ายบัญชีกระทบยอดเงินสดกับเงินฝากธนาคาร
   *  วันนี้ · สัปดาห์นี้ (จันทร์–วันนี้) · เดือนนี้ · เดือนที่แล้ว · ทั้งหมดที่มี (ย้อนหลัง 3 เดือน)
   */
  const ranges = (() => {
    const t = todayIso(), d = new Date(`${t}T00:00:00Z`);
    const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
    const m1 = `${t.slice(0, 7)}-01`;
    const pm = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
    const pmEnd = new Date(Date.parse(`${m1}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
    return [
      { key: "วันนี้", from: t, to: t, label: docDate(t) },
      { key: "สัปดาห์นี้", from: monday, to: t, label: `${docDate(monday)} ถึง ${docDate(t)}` },
      { key: "เดือนนี้", from: m1, to: t, label: `${docDate(m1)} ถึง ${docDate(t)}` },
      { key: "เดือนที่แล้ว", from: pm, to: pmEnd, label: `${docDate(pm)} ถึง ${docDate(pmEnd)}` },
      { key: "ทั้งหมดที่มี", from: "", to: t, label: "ย้อนหลัง 3 เดือน" },
    ];
  })();
  const exportCsv = (rg: (typeof ranges)[number]) => {
    const rows = closes.filter(inBranch).filter((c) => (!rg.from || c.date >= rg.from) && c.date <= rg.to);
    if (!rows.length) return toast(`ไม่มีการปิดยอดช่วง${rg.key} (${rg.label})`);
    const name = isGlobal ? branch || "ทุกสาขา" : rows[0].branch;
    closesCsv(rows, `ปิดยอดรายวัน-${name}-${rg.from ? (rg.from === rg.to ? rg.from : `${rg.from}-ถึง-${rg.to}`) : `ถึง-${rg.to}`}`);
    toast(`ส่งออกการปิดยอด${rg.key}แล้ว ${rows.length} วัน`);
  };

  return (
    <Modal open={open} wide title="ปิดยอดเงินรายวัน" onClose={onClose}
      footer={<><div className="mr-auto"><MenuButton label="ส่งออก CSV" icon={<CsvIcon />} items={ranges.map((rg) => ({ label: rg.key, hint: rg.label, onClick: () => exportCsv(rg) }))} /></div><button className="btn-soft" onClick={onClose}>ปิดหน้าต่าง</button></>}>
      <div className="space-y-5">
        {missing && <p role="alert" className="form-error"><Icon name="alert" className="h-4 w-4 shrink-0" />{missing}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {isGlobal && <Field label="สาขา"><select value={branch} onChange={(e) => setBranch(e.target.value)}>{branches.map((b) => <option key={b}>{b}</option>)}</select></Field>}
          <Field label="วันที่รับเงิน"><input type="date" value={date} max={todayIso()} onChange={(e) => e.target.value && setDate(e.target.value)} /><p className="field-hint">วันที่ {docDate(date)}{date === todayIso() ? " (วันนี้)" : ""}</p></Field>
        </div>
        {unclosed.length > 0 && <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-red-800">ยังไม่ปิดยอด:</span>
          {unclosed.map((d) => <button key={d} type="button" className={`cc-day ${d === date ? "is-on" : ""}`} onClick={() => setDate(d)}>{docDate(d)}</button>)}
        </div>}

        <div className="cc-tiles">
          <div><span>รับชำระ</span><b>{day.length}</b><small>รายการ</small></div>
          <div className="is-cash"><span>เงินสด (ในระบบ)</span><b>{money(sum.cash)}</b><small>ต้องตรงกับเงินในลิ้นชัก</small></div>
          <div><span>เงินโอน</span><b>{money(sum.transfer)}</b><small>{noSlip ? <em className="text-red-700">ไม่มีสลิป {noSlip} รายการ</em> : "ตรวจกับบัญชีธนาคาร"}</small></div>
          <div><span>บัตรเครดิต</span><b>{money(sum.credit)}</b><small>ตรวจกับสลิปเครื่องรูดบัตร</small></div>
          <div className="is-total"><span>รวมรับทั้งวัน</span><b>{money(total)}</b><small>บาท</small></div>
        </div>

        {day.length > 0 && <DataTable search={false} columns={["เลขที่เอกสาร", "ผู้รับบริการ", "งวด", "เงินสด", "เงินโอน", "บัตร", "ผู้รับเงิน", "สลิป"]}
          rows={day.map((p) => [p.no ?? "-", p.who, String(p.n), p.cash ? money(p.cash) : "-", p.transfer ? money(p.transfer) : "-", p.credit ? money(p.credit) : "-", p.cashier || "-", p.transfer > 0 ? (p.slip ? "มี" : "ไม่มี") : "-"])}
          render={(k, col, v) => (col === 7 && v === "ไม่มี" ? <span className="status-badge status-danger">ไม่มีสลิป</span> : undefined)} />}

        {closed && !changed && !redo && (
          <div className={`cc-done ${diffOf(closed) ? "is-diff" : ""}`}>
            <div className="min-w-0">
              <p className="font-semibold">ปิดยอดแล้ว · นับเงินสดได้ {money(closed.counted)} บาท · {diffText(diffOf(closed))}</p>
              <p className="text-sm opacity-80">โดย {closed.closedBy} เมื่อ {closed.closedAt}{closed.note ? ` · หมายเหตุ: ${closed.note}` : ""}</p>
              <p className="mt-1 text-sm">{closed.approvedBy ? <span className="status-badge status-success">ตรวจรับรองแล้ว · {closed.approvedBy} {closed.approvedAt}</span> : <span className="status-badge status-warning">รอผู้จัดการตรวจรับรอง</span>}</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {canApprove && !closed.approvedBy && <button className="btn-primary" onClick={() => approve(closed)}>ตรวจรับรอง</button>}
              <button className="btn-soft" onClick={() => setRedo(true)}>ปิดยอดใหม่</button>
            </div>
          </div>
        )}
        {changed && <p role="alert" className="form-error"><Icon name="alert" className="h-4 w-4 shrink-0" />มีการรับเงินของวันนี้เพิ่มหรือเปลี่ยนหลังปิดยอด ({closed!.payments} → {day.length} รายการ) · กรุณานับเงินและปิดยอดใหม่</p>}

        {showForm && !missing && (
          <div className="cc-form">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="เงินสดที่นับได้จริง (บาท)" required>
                <input type="number" min={0} step="0.01" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} placeholder={money(sum.cash)} />
                {diff !== null && <p className={`mt-1 text-sm font-semibold ${diff === 0 ? "text-emerald-700" : "text-red-700"}`}>{diff === 0 ? "ตรงกับยอดในระบบ" : `เงินสด${diff > 0 ? "เกิน" : "ขาด"} ${money(Math.abs(diff))} บาท`}</p>}
              </Field>
              <Field label={diff ? "หมายเหตุ (ต้องใส่เมื่อยอดไม่ตรง)" : "หมายเหตุ"}>
                <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ทอนเงินผิด 20 บาท · นำเงินสดฝากธนาคารแล้ว" />
              </Field>
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              {redo && <button className="btn-soft" onClick={() => setRedo(false)}>ยกเลิก</button>}
              <button className="btn-primary" disabled={busy} onClick={save}>{busy ? "กำลังบันทึก…" : `ปิดยอดวันที่ ${docDate(date)}`}</button>
            </div>
            <p className="field-hint mt-2">ปิดยอดแล้วผู้จัดการสาขาตรวจรับรอง · ถ้ารับเงินของวันนี้เพิ่มภายหลัง ระบบจะเตือนให้ปิดยอดใหม่</p>
          </div>
        )}

        {closes.length > 0 && <div>
          <p className="label">ประวัติการปิดยอด (3 เดือน)</p>
          <DataTable search={false} columns={["วันที่", ...(isGlobal ? ["สาขา"] : []), "รายการ", "เงินสดในระบบ", "นับได้", "ส่วนต่าง", "ปิดโดย", "ตรวจรับรอง"]}
            rows={closes.filter(inBranch).map((c) => [docDate(c.date), ...(isGlobal ? [c.branch] : []), String(c.payments), money(c.cash), money(c.counted), diffText(diffOf(c)), c.closedBy, c.approvedBy ? `ตรวจแล้ว · ${c.approvedBy}` : "รอตรวจ"])}
            render={(k, col, v) => {
              const off = isGlobal ? 1 : 0;
              if (col === 4 + off) return <span className={`status-badge ${v === "ตรงยอด" ? "status-success" : "status-danger"}`}>{v}</span>;
              if (col === 6 + off) return <span className={`status-badge ${v === "รอตรวจ" ? "status-warning" : "status-success"}`}>{v}</span>;
              return undefined;
            }}
            actions={[{ label: "เปิดดู", onClick: (k) => setDate(closes.filter(inBranch)[k].date) }]} />
        </div>}
      </div>
    </Modal>
  );
}
