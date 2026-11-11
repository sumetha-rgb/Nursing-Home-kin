"use client";
import { useCallback, useEffect, useState } from "react";
import { Modal } from "../ui";
import Icon from "../Icon";
import { useApp } from "@/lib/app";
import type { SessionUser } from "@/lib/roles";
import PhotoPicker from "../PhotoPicker";
import PhysioRecordModal, { RecordTarget, stampFor, testPhoto } from "./PhysioRecord";
import { addMonth, DAY_FULL, DAY_TH, dayLabel, dowOf, monthCells, monthLabel, projectDates, WEEK, leftOf, loadOf, onDate, PAY_TEXT, payOf, PhysioBoard, PhysioCase, PhysioHistory, PhysioVisit, photoUrl, schedOf, vitalsText, weekDates } from "@/lib/physio";

export type PhysioView = "ptoday" | "pweek" | "pcases";
const short = (n: string) => n.replace(/^(คุณ|นาย|นางสาว|นาง)\s*/, "");
/** นาทีตั้งแต่เช็คอิน */
const since = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));

/**
 * KinApp ของนักกายภาพ: วันนี้ (คิวตามเวลา) · ตารางสัปดาห์ · เคสของฉัน
 *  ขั้นตอนแต่ละเคส: 1 เช็คอิน (ถ่ายรูปข้างเตียง · เวลาจาก server) → 2 บันทึกครั้งนี้ (รูปงานบังคับ · ตัดคอร์ส 1 ครั้ง) · ประวัติทุกครั้งดูย้อนหลังได้
 *  ข้อมูลจาก /api/clinic?op=physio_board (สาขาตัวเอง) · onCount = จำนวนเคสวันนี้ที่ยังไม่ได้บันทึก (ตัวเลขบนเมนูล่าง)
 */
export default function PhysioKin({ view, user, onCount }: { view: PhysioView; user: SessionUser; onCount: (n: number) => void }) {
  const { toast, confirm } = useApp();
  const [d, setD] = useState<PhysioBoard | null>(null);
  const [all, setAll] = useState(false);
  const [recT, setRecT] = useState<RecordTarget | null>(null);
  const [busy, setBusy] = useState(false);
  /** เช็คอิน: รูปที่ประทับเวลาแล้ว */
  const [ci, setCi] = useState<{ c: PhysioCase; photo: string } | null>(null);
  const [hist, setHist] = useState<{ c: PhysioCase; items: PhysioHistory[] | null } | null>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  /** แท็บตาราง: สัปดาห์ / เดือน · วันที่เลือกในปฏิทิน · รายละเอียดนัด */
  const [cal, setCal] = useState<"week" | "month">("week");
  const [ym, setYm] = useState(() => new Date(Date.now() + 7 * 36e5).toISOString().slice(0, 7));
  const [pick, setPick] = useState("");
  const [appt, setAppt] = useState<{ c: PhysioCase; date: string; n: number; doneAt?: string } | null>(null);
  const load = useCallback(() => {
    fetch("/api/clinic?op=physio_board", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((x) => x && setD(x)).catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 60_000);
    return () => clearInterval(t);
  }, [load]);

  const cases = d?.cases ?? [];
  const mine = cases.filter((c) => c.therapist_id === user.id);
  const dow = d?.date ? dowOf(d.date) : new Date().getDay();
  const done = new Map((d?.today ?? []).filter((x) => x.course_id).map((x) => [x.course_id!, x]));
  const tIso = d?.date ?? new Date(Date.now() + 7 * 36e5).toISOString().slice(0, 10);
  // นัดวันนี้ (ทุกสัปดาห์ หรือเลือกวันเอง)
  const queue = mine.filter((c) => onDate(schedOf(c), tIso)).sort((a, b) => (a.plan_time ?? "").localeCompare(b.plan_time ?? ""));
  const pending = queue.filter((c) => !done.has(c.id)).length;
  useEffect(() => { onCount(pending); }, [pending, onCount]);
  const monthN = d?.month.find((m) => m.author === user.name)?.n ?? 0;
  /** เช็คอินของฉันที่ยังไม่ได้บันทึก (กำลังทำ) */
  const visitOf = (c: PhysioCase) => (d?.visits ?? []).find((v) => v.course_id === c.id && v.therapist_id === user.id);
  const post = async (body: object) => {
    const r = await fetch("/api/clinic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const x = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(x.error || "บันทึกไม่สำเร็จ");
    return x;
  };
  /** บัญชีทดลอง (@kin.test): มีปุ่มใช้รูปทดสอบ (คอมที่ไม่มีกล้อง) · อัปโหลดไฟล์ไม่ได้ทุกบัญชี · บัญชีจริงต้องถ่ายจากกล้องเท่านั้น */
  const testMode = /@kin\.test$/i.test(user.email ?? "");
  const stamp = (u: string, title: string, c: PhysioCase) => stampFor(u, title, c.resident_name, c.room, user.name);
  const checkIn = async () => {
    if (!ci?.photo) return toast("กรุณาถ่ายรูปข้างเตียงก่อนเช็คอิน");
    setBusy(true);
    try { const x = await post({ op: "physio_checkin", courseId: ci.c.id, photo: ci.photo }); toast(`เช็คอิน ${ci.c.resident_name} ${x.at} น. แล้ว · ทำเสร็จกด บันทึกครั้งนี้`); setCi(null); load(); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const cancelIn = (c: PhysioCase, v: PhysioVisit) => confirm({
    title: "ยกเลิกเช็คอิน", danger: true, okLabel: "ยกเลิกเช็คอิน",
    message: `ยกเลิกเช็คอิน ${c.resident_name} เวลา ${v.at} น.? รูปเช็คอินจะถูกลบ และต้องเช็คอินใหม่ก่อนบันทึกกายภาพ`,
    onOk: async () => { try { await post({ op: "physio_checkin_cancel", visitId: v.id }); toast("ยกเลิกเช็คอินแล้ว"); load(); } catch (e) { toast((e as Error).message); } },
  });
  const openHist = async (c: PhysioCase) => {
    setHist({ c, items: null });
    const x = await fetch(`/api/clinic?op=physio_history&course=${encodeURIComponent(c.id)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    setHist({ c, items: x?.items ?? [] });
  };

  /** เปิดฟอร์มบันทึก (หลังเช็คอิน) · ค่าเริ่มต้นจากครั้งก่อน */
  const open = (c: PhysioCase, v: PhysioVisit) => setRecT({
    courseId: c.id, courseName: c.name, used: c.used, total: c.total, residentName: c.resident_name, hn: c.hn, room: c.room, visit: v,
    last: { cc: c.recent[0]?.cc, dx: c.recent[0]?.dx, pain: c.recent[0]?.pain, mobility: c.recent[0]?.mobility },
    forName: c.therapist_id && c.therapist_id !== user.id ? c.therapist_name : null,
  });

  /** การ์ดเคส: เวลา ชื่อ ห้อง ครั้งที่ ผลครั้งก่อน แผน และปุ่มบันทึก */
  const card = (c: PhysioCase, opts: { time?: boolean; who?: boolean } = {}) => {
    const dn = done.get(c.id), left = leftOf(c), last = c.recent[0], v = visitOf(c);
    return (
      <li key={c.id} className={`pk-card ${dn && !v ? "is-done" : ""} ${v ? "is-live" : ""}`}>
        <div className="pk-top">
          {opts.time && <span className="pk-time">{c.plan_time ?? "--:--"}</span>}
          <div className="pk-who"><b>{c.resident_name}</b><small>{c.branch_name !== user.branch && <em className="pk-away">📍 {c.branch_name}</em>}{c.room ? `ห้อง ${c.room}${c.bed ? ` · เตียง ${c.bed}` : ""}` : "ยังไม่มีห้อง"}{opts.who ? ` · ${c.therapist_name ?? "ยังไม่มีผู้รับผิดชอบ"}` : ""}</small></div>
          {dn ? <span className="pk-st is-done">✓ {dn.at}</span> : left <= 2 ? <span className="pk-st is-warn">เหลือ {left}</span> : null}
        </div>
        <p className="pk-meta">{c.name} · ครั้งที่ {Math.min(c.used + 1, c.total)} จาก {c.total}{c.plan_minutes ? ` · ${c.plan_minutes} นาที` : ""}</p>
        {last && <p className="pk-last">ครั้งก่อน {last.at.slice(0, 5)}: {[last.pain ? `ปวด ${last.pain}` : "", last.mobility ?? ""].filter(Boolean).join(" · ") || "-"}{last.plan ? <><br />แผน: {last.plan}</> : null}</p>}
        {c.recent.length > 1 && c.recent.some((n) => n.pain) && <p className="pk-trend">ความปวด {c.recent.slice().reverse().map((n) => n.pain || "–").join(" → ")}</p>}
        {payOf(c) !== "free" && <p className={`pk-pay is-${payOf(c)}`}>{payOf(c) === "paid" ? "✓ " : ""}{PAY_TEXT[payOf(c)]}</p>}
        {v ? <>
            <p className="pk-live"><i aria-hidden />เช็คอินแล้ว {v.at} น.<button type="button" onClick={() => setZoom(photoUrl(v.id, "checkin"))}>ดูรูป</button></p>
            <button type="button" className="btn-primary pk-go" onClick={() => open(c, v)}>บันทึกครั้งนี้ (ถ่ายรูปงาน)</button>
            <button type="button" className="pk-again" onClick={() => cancelIn(c, v)}>ยกเลิกเช็คอิน</button>
          </> : left > 0 && (dn
            ? <button type="button" className="pk-again" onClick={() => setCi({ c, photo: "" })}>เช็คอินอีกครั้ง</button>
            : <button type="button" className="btn-primary pk-go" onClick={() => setCi({ c, photo: "" })}><Icon name="camera" className="h-5 w-5" /> เช็คอิน (ถ่ายรูปข้างเตียง)</button>)}
        {c.used > 0 && (dn && !v
          ? <button type="button" className="btn-soft pk-detail" onClick={() => openHist(c)}>ดูรายละเอียดที่บันทึก</button>
          : <button type="button" className="pk-again" onClick={() => openHist(c)}>ดูประวัติทั้งหมด ({c.used} ครั้ง)</button>)}
      </li>
    );
  };

  if (!d) return <p className="rounded-2xl bg-cream-50 py-6 text-center text-sm text-gold-500">กำลังโหลดเคสกายภาพ…</p>;
  return (
    <>
      {view === "ptoday" && <>
        <div className="ka-head"><div><h1>กายภาพวันนี้</h1><p>{DAY_FULL[dow]} · ทำแล้ว {queue.length - pending}/{queue.length} · เดือนนี้ {monthN} ครั้ง</p></div></div>
        {queue.length === 0
          ? <p className="pk-empty">วันนี้ไม่มีเคสตามตาราง{mine.length ? ` · คุณรับผิดชอบ ${mine.length} เคส ดูที่แท็บตารางสัปดาห์` : " · รอผู้จัดการจ่ายเคสให้"}</p>
          : <ul className="pk-list">{queue.map((c) => card(c, { time: true }))}</ul>}
        {(d.today.filter((x) => !queue.some((c) => c.id === x.course_id)).length > 0) && <section className="pk-other">
          <h2>บันทึกอื่นวันนี้ในสาขา</h2>
          <ul>{d.today.filter((x) => !queue.some((c) => c.id === x.course_id)).map((x, k) => <li key={k}>{x.at} · {x.resident_name} · {x.author ?? "-"}{x.pain ? ` · ปวด ${x.pain}` : ""}</li>)}</ul>
        </section>}
      </>}

      {view === "pweek" && (() => {
        // นัดของฉันรายวัน: วันที่ผ่านมา = บันทึกจริง (90 วัน) · วันนี้เป็นต้นไป = นัดตามแผนจนครบคอร์ส
        const byDay = new Map<string, { c: PhysioCase; n: number; doneAt?: string }[]>();
        const put = (d: string, x: { c: PhysioCase; n: number; doneAt?: string }) => byDay.set(d, [...(byDay.get(d) ?? []), x]);
        for (const l of d.mylog ?? []) { const c = cases.find((k) => k.id === l.course_id); if (c) put(l.date, { c, n: Number(l.title?.match(/ครั้งที่ (\d+)/)?.[1]) || 0, doneAt: l.at }); }
        for (const c of mine) for (const p of projectDates(c, tIso, done.has(c.id))) put(p.date, { c, n: p.n });
        byDay.forEach((l) => l.sort((x, y) => (x.c.plan_time ?? "").localeCompare(y.c.plan_time ?? "")));
        const sel = pick || tIso;
        const row = (x: { c: PhysioCase; n: number; doneAt?: string }, date: string) => (
          <li key={`${x.c.id}${date}${x.n}`}><button type="button" className={`pk-appt ${x.doneAt ? "is-done" : ""}`} onClick={() => setAppt({ c: x.c, date, n: x.n, doneAt: x.doneAt })}>
            <b>{x.doneAt ?? x.c.plan_time ?? "--:--"}</b>
            <span><strong>{x.c.resident_name}</strong><small>{x.c.room ? `ห้อง ${x.c.room} · ` : ""}ครั้งที่ {x.n}/{x.c.total}{x.doneAt ? " · บันทึกแล้ว" : ` · ${x.c.plan_minutes ?? 45} นาที`}</small></span>
            <i aria-hidden>{x.doneAt ? "✓" : "›"}</i>
          </button></li>
        );
        return <>
          <div className="ka-head"><div><h1>ตาราง</h1><p>{mine.length} เคส · {loadOf(cases, user.id).hours} ชม./สัปดาห์</p></div></div>
          {/* สลับมุมมอง: แถบเต็มความกว้าง ไอคอน + คำอธิบาย กดง่ายบนมือถือ */}
          <div className="pk-seg" role="radiogroup" aria-label="มุมมองตาราง">
            {([["week", "table", "สัปดาห์", "รายการทีละวัน"], ["month", "calendar", "เดือน", "ปฏิทินทั้งเดือน"]] as const).map(([v, ic, t, sub]) => (
              <button key={v} type="button" role="radio" aria-checked={cal === v} className={cal === v ? "is-on" : ""} onClick={() => setCal(v)}>
                <Icon name={ic} className="h-5 w-5" /><span><b>{t}</b><small>{sub}</small></span>
              </button>
            ))}
          </div>
          {cal === "week" ? <ul className="pk-week">{weekDates(tIso).map((dt) => {
            const list = byDay.get(dt) ?? [];
            return (
              <li key={dt} className={dt === tIso ? "is-today" : dt < tIso ? "is-past" : ""}>
                <h3>{DAY_FULL[dowOf(dt)]} {Number(dt.slice(8, 10))}{dt === tIso && <em>วันนี้</em>}<small>{list.length ? `${list.length} เคส` : "ว่าง"}</small></h3>
                {list.length > 0 && <ul className="pk-appts">{list.map((x) => row(x, dt))}</ul>}
              </li>
            );
          })}</ul> : <>
            <div className="pk-cal">
              <div className="pk-cal-h">
                <button type="button" aria-label="เดือนก่อน" onClick={() => setYm(addMonth(ym, -1))}>‹</button>
                <b>{monthLabel(ym)}</b>
                <button type="button" aria-label="เดือนถัดไป" onClick={() => setYm(addMonth(ym, 1))}>›</button>
              </div>
              <div className="pk-cal-g">
                {WEEK.map((x) => <span key={x} className="pk-cal-dow">{DAY_TH[x]}</span>)}
                {monthCells(ym).map((dt, k) => {
                  if (!dt) return <span key={k} />;
                  const list = byDay.get(dt) ?? [], doneN = list.filter((x) => x.doneAt).length;
                  return (
                    <button key={dt} type="button" aria-pressed={sel === dt} aria-label={`${dayLabel(dt)} · ${list.length ? `${list.length} เคส` : "ว่าง"}`}
                      className={`pk-cal-d ${sel === dt ? "is-sel" : ""} ${dt === tIso ? "is-today" : ""} ${dt < tIso ? "is-past" : ""}`} onClick={() => setPick(dt)}>
                      {Number(dt.slice(8, 10))}
                      {list.length > 0 && <small className={doneN === list.length ? "is-done" : ""}>{list.length}</small>}
                    </button>
                  );
                })}
              </div>
              <p className="pk-cal-key"><i className="is-plan" />มีนัด <i className="is-done" />บันทึกครบแล้ว · ตัวเลข = จำนวนเคส</p>
            </div>
            <section className="pk-day">
              <h3>{dayLabel(sel)}{sel === tIso && <em>วันนี้</em>}<small>{(byDay.get(sel) ?? []).length ? `${(byDay.get(sel) ?? []).length} เคส` : "ว่าง"}</small></h3>
              {(byDay.get(sel) ?? []).length ? <ul className="pk-appts">{(byDay.get(sel) ?? []).map((x) => row(x, sel))}</ul> : <p className="pk-empty">ไม่มีนัดวันนี้</p>}
            </section>
          </>}
        </>;
      })()}

      {view === "pcases" && <>
        <div className="ka-head"><div><h1>{all ? "เคสทั้งสาขา" : "เคสของฉัน"}</h1><p>{all ? `${cases.length} เคส · บันทึกแทนเพื่อนได้` : `${mine.length} เคส · เหลือรวม ${mine.reduce((n, c) => n + leftOf(c), 0)} ครั้ง`}</p></div></div>
        <div className="ka-chips" role="radiogroup" aria-label="เลือกเคส">
          <button type="button" role="radio" aria-checked={!all} onClick={() => setAll(false)}>ของฉัน {mine.length}</button>
          <button type="button" role="radio" aria-checked={all} onClick={() => setAll(true)}>ทั้งสาขา {cases.length}</button>
        </div>
        {(all ? cases : mine).length === 0 ? <p className="pk-empty">{all ? "สาขานี้ยังไม่มีคอร์สกายภาพที่ใช้ได้" : "ยังไม่มีเคสที่รับผิดชอบ · ผู้จัดการจ่ายเคสได้ที่เมนูตารางกายภาพ"}</p>
          : <ul className="pk-list">{(all ? cases : mine).map((c) => card(c, { who: all }))}</ul>}
      </>}

      <Modal open={!!ci} title={ci ? `เช็คอิน · ${ci.c.resident_name}` : ""} onClose={() => setCi(null)}
        footer={<><button className="btn-soft" onClick={() => setCi(null)}>ยกเลิก</button><button className="btn-primary" disabled={busy || !ci?.photo} onClick={checkIn}>{busy ? "กำลังเช็คอิน…" : "ยืนยันเช็คอิน"}</button></>}>
        {ci && <div className="pk-form">
          <p className="pk-meta">{ci.c.name} · ครั้งที่ {ci.c.used + 1} จาก {ci.c.total}{ci.c.room ? ` · ห้อง ${ci.c.room}` : ""}</p>
          {testMode && !ci.photo && <button type="button" className="pk-test" onClick={async () => setCi({ ...ci, photo: await stamp(testPhoto("เช็คอินข้างเตียง"), "เช็คอินกายภาพ", ci.c) })}>ใช้รูปทดสอบ · บัญชีทดลองเท่านั้น</button>}
          <PhotoPicker value={ci.photo} allowFile={false} label="ถ่ายรูปข้างเตียง" hint="ให้เห็นผู้รับบริการหรือป้ายเตียง · ระบบประทับชื่อและเวลาลงรูป · เวลาเช็คอินใช้เวลาของระบบ"
            onChange={async (u) => setCi({ ...ci, photo: u ? await stamp(u, "เช็คอินกายภาพ", ci.c) : "" })} />
        </div>}
      </Modal>
      <Modal open={!!hist} title={hist ? `ประวัติกายภาพ · ${hist.c.resident_name}` : ""} onClose={() => setHist(null)} footer={<button className="btn-primary" onClick={() => setHist(null)}>ปิด</button>}>
        {hist && (!hist.items ? <p className="pk-empty">กำลังโหลด…</p> : hist.items.length === 0 ? <p className="pk-empty">ยังไม่มีบันทึก</p> : (
          <ul className="pk-hist">{hist.items.map((h) => (
            <li key={h.id}>
              <div className="pk-hist-h"><b>{h.title}</b><small>{h.at}{h.author ? ` · ${h.author}` : ""}</small></div>
              {h.checkin && <p className="pk-meta">เช็คอิน {h.checkin} · บันทึก {h.done}{h.minutes != null ? ` · ${h.minutes} นาที` : ""}</p>}
              <p className="pk-meta">{[h.pain ? `ปวด ${h.pain}` : "", h.mobility ?? "", (h.activities ?? []).join(", ")].filter(Boolean).join(" · ") || "-"}</p>
              {vitalsText(h.vitals) && <p className="pk-meta">สัญญาณชีพ: {vitalsText(h.vitals)}</p>}
              {h.cc || h.pe || h.dx ? <dl className="pk-tx">
                {h.cc && <><dt>อาการสำคัญ</dt><dd>{h.cc}</dd></>}{h.pe && <><dt>ตรวจร่างกาย</dt><dd>{h.pe}</dd></>}{h.dx && <><dt>วินิจฉัย</dt><dd>{h.dx}</dd></>}{h.plan && <><dt>แผนการรักษา</dt><dd>{h.plan}</dd></>}
              </dl> : <>{h.body && <p className="pk-hist-b">{h.body}</p>}{h.plan && <p className="pk-meta">แผน: {h.plan}</p>}</>}
              {h.visit_id && <div className="pk-thumbs">
                <button type="button" onClick={() => setZoom(photoUrl(h.visit_id!, "checkin"))}><img src={photoUrl(h.visit_id, "checkin")} alt={`รูปเช็คอิน ${h.title ?? ""}`} loading="lazy" /><span>เช็คอิน</span></button>
                {Array.from({ length: h.work_n ?? 0 }, (_, i) => <button key={i} type="button" onClick={() => setZoom(photoUrl(h.visit_id!, "work", i))}><img src={photoUrl(h.visit_id!, "work", i)} alt={`รูปงาน ${i + 1} ${h.title ?? ""}`} loading="lazy" /><span>รูปงาน{(h.work_n ?? 0) > 1 ? ` ${i + 1}` : ""}</span></button>)}
              </div>}
            </li>
          ))}</ul>
        ))}
      </Modal>
      <Modal open={!!zoom} title="รูปภาพ" onClose={() => setZoom(null)} footer={<button className="btn-primary" onClick={() => setZoom(null)}>ปิด</button>}>
        {zoom && <img src={zoom} alt="รูปกายภาพ" className="pk-zoom" />}
      </Modal>
      <PhysioRecordModal target={recT} testMode={testMode} onClose={() => setRecT(null)} onSaved={() => { setRecT(null); load(); }} />
      <Modal open={!!appt} title={appt ? appt.c.resident_name : ""} onClose={() => setAppt(null)}
        footer={appt ? <>
          {appt.c.used > 0 && <button className="btn-soft" onClick={() => { const c = appt.c; setAppt(null); openHist(c); }}>{appt.doneAt ? "ดูสิ่งที่บันทึก" : "ดูประวัติทั้งหมด"}</button>}
          {appt.date === tIso && !appt.doneAt && !visitOf(appt.c) && <button className="btn-primary" onClick={() => { const c = appt.c; setAppt(null); setCi({ c, photo: "" }); }}>เช็คอิน</button>}
          {appt.date === tIso && !appt.doneAt && visitOf(appt.c) && <button className="btn-primary" onClick={() => { const c = appt.c, v = visitOf(c)!; setAppt(null); open(c, v); }}>บันทึกครั้งนี้</button>}
          <button className="btn-soft" onClick={() => setAppt(null)}>ปิด</button>
        </> : undefined}>
        {appt && <div className="pk-form">
          <dl className="pk-kv">
            <dt>วันที่</dt><dd>{dayLabel(appt.date)}{appt.date === tIso ? " (วันนี้)" : ""}</dd>
            <dt>{appt.doneAt ? "บันทึกเมื่อ" : "เวลานัด"}</dt><dd>{appt.doneAt ?? appt.c.plan_time ?? "-"} น.{!appt.doneAt && appt.c.plan_minutes ? ` · ${appt.c.plan_minutes} นาที` : ""}</dd>
            <dt>ห้อง</dt><dd>{appt.c.room ? `${appt.c.room}${appt.c.bed ? ` · เตียง ${appt.c.bed}` : ""}` : "ยังไม่มีห้อง"}</dd>
            <dt>คอร์ส</dt><dd>{appt.c.name}</dd>
            <dt>ครั้งที่</dt><dd>{appt.n} จาก {appt.c.total}{appt.doneAt ? " · บันทึกแล้ว ✓" : appt.date > tIso ? " (ตามแผน)" : ""}</dd>
            {appt.c.hn && <><dt>HN</dt><dd>{appt.c.hn}</dd></>}
          </dl>
          {!appt.doneAt && appt.c.recent[0] && <div className="pk-last">
            ครั้งก่อน {appt.c.recent[0].at.slice(0, 5)}: {[appt.c.recent[0].pain ? `ปวด ${appt.c.recent[0].pain}` : "", appt.c.recent[0].mobility ?? ""].filter(Boolean).join(" · ") || "-"}
            {appt.c.recent[0].dx && <><br />วินิจฉัย: {appt.c.recent[0].dx}</>}
            {appt.c.recent[0].plan && <><br />แผน: {appt.c.recent[0].plan}</>}
          </div>}
          {payOf(appt.c) !== "free" && <p className={`pk-pay is-${payOf(appt.c)}`}>{payOf(appt.c) === "paid" ? "✓ " : ""}{PAY_TEXT[payOf(appt.c)]}</p>}
        </div>}
      </Modal>
      <button type="button" className="pk-refresh" onClick={load} aria-label="โหลดเคสใหม่"><Icon name="history" className="h-4 w-4" /> โหลดใหม่</button>
    </>
  );
}
