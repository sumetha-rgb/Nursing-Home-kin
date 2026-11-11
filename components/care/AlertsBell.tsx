"use client";
import { useEffect, useState } from "react";
import { inCase, leftOf, onDate, PhysioBoard, schedOf, whoOn } from "@/lib/physio";
import Icon from "@/components/Icon";
import { Modal } from "@/components/ui";
import { useApp } from "@/lib/app";
import { ackAlert, thWhen, useAlerts } from "@/lib/care";
import ResidentProfile from "./ResidentProfile";
import { useSession } from "@/lib/session";
import { stockAlertText, useStockAlerts } from "@/lib/stockAlerts";

/** กระดิ่งแจ้งเตือนสัญญาณชีพผิดปกติ: นับรายการที่ยังไม่มีคนรับทราบ กดเปิดรายการ รับทราบ หรือดูประวัติผู้รับบริการ */
/** กระดิ่งแจ้งเตือน: นักกายภาพเห็นเฉพาะงานกายภาพของตัวเอง · ตำแหน่งอื่นเห็นสัญญาณชีพผิดปกติ (และคลังยากลางสำหรับผู้จัดการ) */
export default function AlertsBell({ compact = false }: { compact?: boolean }) {
  const { user } = useSession();
  return user?.role === "Physio" ? <PhysioBell compact={compact} userId={user.id} /> : <CareBell compact={compact} />;
}

/** กระดิ่งของนักกายภาพ: นัดวันนี้ที่ยังไม่บันทึก · เคสของฉันที่ใกล้หมดคอร์ส (เหลือ ≤ 2 ครั้ง) */
function PhysioBell({ compact, userId }: { compact: boolean; userId: string }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<PhysioBoard | null>(null);
  useEffect(() => {
    const load = () => fetch("/api/clinic?op=physio_board", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((x) => x && setD(x)).catch(() => {});
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 60_000);
    return () => clearInterval(t);
  }, []);
  const mine = (d?.cases ?? []).filter((c) => inCase(c, userId));
  const done = new Set((d?.today ?? []).map((x) => x.course_id));
  const today = d?.date ?? "";
  const pending = mine.filter((c) => today && onDate(schedOf(c), today) && whoOn(c, today)?.id === userId && !done.has(c.id)).sort((a, b) => (a.plan_time ?? "").localeCompare(b.plan_time ?? ""));
  const low = mine.filter((c) => leftOf(c) <= 2);
  const total = pending.length + low.length;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`แจ้งเตือน ${total} รายการ`}
        className={`alerts-bell ${total ? "is-watch" : ""} ${compact ? "is-compact" : ""}`}>
        <Icon name="bell" className="h-[18px] w-[18px]" />
        {!compact && <span>แจ้งเตือน</span>}
        {total > 0 && <b>{total}</b>}
      </button>
      <Modal open={open} title="แจ้งเตือนกายภาพ" onClose={() => setOpen(false)} footer={<button className="btn-primary" onClick={() => setOpen(false)}>ปิด</button>}>
        <h4 className="mb-2 font-semibold text-gold-900">นัดวันนี้ที่ยังไม่บันทึก ({pending.length})</h4>
        {pending.length === 0 ? <p className="mb-5 rounded-xl bg-emerald-50 px-4 py-4 text-center text-sm text-emerald-800">บันทึกครบทุกนัดวันนี้แล้ว</p> : (
          <ul className="mb-5 space-y-2">{pending.map((c) => (
            <li key={c.id} className="alert-item is-watch"><p className="font-semibold text-gold-900">{c.plan_time} · {c.resident_name}</p>
              <p className="text-xs text-gold-600">{c.room ? `ห้อง ${c.room} · ` : ""}{c.name} · ครั้งที่ {c.used + 1}/{c.total}</p></li>
          ))}</ul>
        )}
        <h4 className="mb-2 font-semibold text-gold-900">คอร์สใกล้หมด ({low.length})</h4>
        {low.length === 0 ? <p className="rounded-xl bg-cream-50 px-4 py-4 text-center text-sm text-gold-600">ไม่มีคอร์สใกล้หมด</p> : (
          <ul className="space-y-2">{low.map((c) => (
            <li key={c.id} className="alert-item is-watch"><p className="font-semibold text-gold-900">{c.resident_name} · เหลือ {leftOf(c)} ครั้ง</p>
              <p className="text-xs text-gold-600">{c.name} · แจ้งญาติ/แคชเชียร์เรื่องต่อคอร์ส</p></li>
          ))}</ul>
        )}
      </Modal>
    </>
  );
}

/** กระดิ่งของพยาบาลและผู้จัดการ: สัญญาณชีพผิดปกติ + คลังยากลาง (ผู้จัดการ) */
function CareBell({ compact = false }: { compact?: boolean }) {
  const { alerts, reload } = useAlerts();
  const { toast } = useApp();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [profile, setProfile] = useState<string | null>(null);
  // ผู้จัดการสาขา / หัวหน้าพยาบาล / ผู้บริหาร: เห็นยาคลังกลางที่ถึงจุดสั่งซื้อหรือใกล้หมดอายุด้วย
  const { user } = useSession();
  const manager = !!user && ["Global Admin", "Branch Admin", "Head Nurse"].includes(user.role);
  const { items: stock } = useStockAlerts(manager);
  const total = alerts.length + stock.length;
  const critical = alerts.some((a) => a.level === "critical");

  const ack = async (id: string) => {
    setBusy(id);
    try { await ackAlert(id, note[id] ?? ""); toast("รับทราบแจ้งเตือนแล้ว · บันทึกชื่อผู้รับทราบไว้ในประวัติ"); reload(); }
    catch (e) { toast((e as Error).message); }
    finally { setBusy(""); }
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`แจ้งเตือน ${total} รายการ`}
        className={`alerts-bell ${total ? (critical ? "is-critical" : "is-watch") : ""} ${compact ? "is-compact" : ""}`}>
        <Icon name="bell" className="h-[18px] w-[18px]" />
        {!compact && <span>แจ้งเตือน</span>}
        {total > 0 && <b>{total}</b>}
      </button>
      <Modal open={open} wide title="แจ้งเตือน" onClose={() => setOpen(false)} footer={<button className="btn-primary" onClick={() => setOpen(false)}>ปิด</button>}>
        {stock.length > 0 && <section className="mb-5 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><h4 className="font-semibold text-gold-900">คลังยากลาง ({stock.length} รายการ)</h4><a className="row-action" href="/pharmacy?page=central">เปิดคลังยากลาง</a></div>
          <ul className="space-y-1.5 text-sm">{stock.map((x) => <li key={`${x.id}${x.branch_name}`} className={x.qty <= 0 || (x.days ?? 99) < 0 ? "text-red-700" : "text-amber-900"}>• <b>{x.name}</b> · {stockAlertText(x)}{user?.role === "Global Admin" ? ` · สาขา${x.branch_name}` : ""}</li>)}</ul>
        </section>}
        <h4 className="mb-2 font-semibold text-gold-900">สัญญาณชีพผิดปกติ</h4>
        <p className="mb-3 text-sm text-gold-600">รายการที่ค่าเกินเกณฑ์และยังไม่มีพยาบาลรับทราบ · กดรับทราบหลังประเมินอาการแล้ว (ระบบบันทึกชื่อและเวลาไว้ในบันทึกการใช้งานระบบ)</p>
        {alerts.length === 0 ? <p className="rounded-xl bg-emerald-50 px-4 py-6 text-center text-sm text-emerald-800">ไม่มีแจ้งเตือนค้าง</p> : (
          <ul className="space-y-3">{alerts.map((a) => (
            <li key={a.id} className={`alert-item is-${a.level}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-gold-900">{a.resident_name ?? "-"} <span className={`alert-level is-${a.level}`}>{a.level === "critical" ? "ผิดปกติ" : "เฝ้าระวัง"}</span></p>
                  <p className="text-xs text-gold-500">{thWhen(a.created_at)} · บันทึกโดย {a.created_by ?? "-"}{a.branch_name ? ` · สาขา${a.branch_name}` : ""}</p>
                </div>
                {a.resident_id && <button className="row-action" onClick={() => setProfile(a.resident_id)}>ดูประวัติ</button>}
              </div>
              <p className="mt-2 text-sm text-gold-800">{a.summary}</p>
              {a.vital_text && <p className="mt-1 text-xs text-gold-600">ค่าที่บันทึก: {a.vital_text}</p>}
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <input value={note[a.id] ?? ""} onChange={(e) => setNote({ ...note, [a.id]: e.target.value })} placeholder="บันทึกการดูแล เช่น วัดซ้ำแล้ว แจ้งแพทย์แล้ว (ไม่บังคับ)" className="min-w-0 flex-1" />
                <button className="btn-primary shrink-0" disabled={busy === a.id} onClick={() => ack(a.id)}><Icon name="check" className="h-4 w-4" /> {busy === a.id ? "กำลังบันทึก…" : "รับทราบ"}</button>
              </div>
            </li>
          ))}</ul>
        )}
      </Modal>
      <ResidentProfile id={profile} onClose={() => setProfile(null)} />
    </>
  );
}
