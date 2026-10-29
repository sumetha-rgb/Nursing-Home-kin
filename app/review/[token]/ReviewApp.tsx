"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import Icon from "@/components/Icon";
import { COMPANY } from "@/components/ui";

type Staff = { id: string; name: string; cared: boolean };
type Info = { resident: string; branch: string; staff: Staff[]; tags: string[]; relations: string[] };
type Draft = { rating: number; tags: string[]; comment: string };
const LEVEL = ["", "ควรปรับปรุง", "พอใช้", "ปานกลาง", "ดี", "ดีมาก"];
const initial = (n: string) => n.replace(/^(นางสาว|นาง|นาย|พว\.|คุณ)\s*/, "").charAt(0);

function Stars({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="stars" role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} ดาว ${LEVEL[n]}`} className={n <= value ? "is-on" : ""} onClick={() => onChange(n)}>★</button>
      ))}
      {value > 0 && <span>{LEVEL[value]}</span>}
    </div>
  );
}

/** รีวิวพนักงานจากครอบครัว: เลือกได้หลายคน ให้ดาว คำชม และความเห็นแยกรายคน */
export default function ReviewApp({ token }: { token: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [fail, setFail] = useState("");
  const [picked, setPicked] = useState<Record<string, Draft>>({});
  const [rater, setRater] = useState("");
  const [relation, setRelation] = useState("");
  const [trap, setTrap] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);

  useEffect(() => {
    fetch(`/api/public/review?t=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); setInfo(d); setRelation(d.relations?.[0] ?? ""); })
      .catch((e) => setFail((e as Error).message || "เปิดแบบฟอร์มไม่สำเร็จ"));
  }, [token]);

  const toggle = (id: string) => { setErr(""); setPicked((p) => { const n = { ...p }; if (n[id]) delete n[id]; else n[id] = { rating: 0, tags: [], comment: "" }; return n; }); };
  const edit = (id: string, d: Partial<Draft>) => { setErr(""); setPicked((p) => ({ ...p, [id]: { ...p[id], ...d } })); };
  const submit = async () => {
    const ids = Object.keys(picked);
    if (!ids.length) return setErr("กรุณาเลือกพนักงานที่ต้องการรีวิวอย่างน้อย 1 คน");
    const missing = info?.staff.find((s) => picked[s.id] && !picked[s.id].rating);
    if (missing) return setErr(`กรุณาให้ดาวคุณ${missing.name}`);
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/public/review", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ t: token, rater, relation, website: trap, reviews: ids.map((staffId) => ({ staffId, ...picked[staffId] })) }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "ส่งไม่สำเร็จ กรุณาลองใหม่");
      setDone(d.count ?? ids.length);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  const cared = info?.staff.filter((s) => s.cared) ?? [];
  const others = info?.staff.filter((s) => !s.cared) ?? [];
  const list = cared.length && !showAll ? [...cared, ...others.filter((s) => picked[s.id])] : info?.staff ?? [];

  return (
    <main className="survey-page">
      <header className="survey-head">
        <Image src="/logo-mark.png" alt="KIN" width={56} height={42} className="h-11 w-auto" />
        <div><b>{COMPANY.brand}</b><span>{info ? `สาขา${info.branch}` : "THE ART OF CARE"}</span></div>
      </header>

      {!info && !fail && <p className="survey-card text-center text-gold-500">กำลังโหลด…</p>}
      {fail && (
        <section className="survey-card text-center">
          <Icon name="alert" className="mx-auto h-8 w-8 text-red-600" />
          <h1 className="mt-2 text-lg font-semibold text-gold-900">เปิดแบบฟอร์มไม่ได้</h1>
          <p className="mt-1 text-sm text-gold-600">{fail}</p>
          <p className="mt-3 text-xs text-gold-500">{COMPANY.contact}</p>
        </section>
      )}

      {info && done > 0 && (
        <section className="survey-card text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-green-100 text-green-700"><Icon name="check" className="h-7 w-7" /></span>
          <h1 className="mt-3 text-xl font-semibold text-gold-900">ขอบคุณสำหรับรีวิว</h1>
          <p className="mt-2 text-sm leading-6 text-gold-700">คำชมของท่านส่งถึงพนักงาน {done} คนแล้ว และเป็นส่วนหนึ่งของการประเมินผลงานประจำเดือน</p>
        </section>
      )}

      {info && !done && (
        <section className="survey-card space-y-5">
          <div>
            <h1 className="text-lg font-semibold text-gold-900">รีวิวพนักงานที่ดูแล{info.resident}</h1>
            <p className="text-sm text-gold-600">เลือกพนักงานที่ต้องการชม เลือกได้หลายคน แล้วให้ดาวและคำชมแยกรายคน</p>
          </div>

          <div>
            <p className="label">1. เลือกพนักงาน {cared.length > 0 && <small className="text-gold-500">· พนักงานที่ดูแล{info.resident}</small>}</p>
            {info.staff.length === 0 && <p className="rounded-2xl bg-cream-50 px-4 py-6 text-center text-sm text-gold-600">ยังไม่มีบันทึกว่าพนักงานคนใดดูแล{info.resident} กรุณาติดต่อสาขา</p>}
            <div className="staff-pick">
              {list.map((s) => (
                <button key={s.id} type="button" aria-pressed={!!picked[s.id]} onClick={() => toggle(s.id)}>
                  <span className="staff-avatar">{initial(s.name)}</span>
                  <span className="min-w-0 flex-1 text-left"><b>{s.name}</b>{s.cared && <small>ดูแล{info.resident}</small>}</span>
                  <span className="staff-check">{picked[s.id] ? <Icon name="check" className="h-4 w-4" /> : null}</span>
                </button>
              ))}
            </div>
            {cared.length > 0 && others.length > 0 && (
              <button type="button" className="mt-2 text-sm font-medium text-gold-700 underline" onClick={() => setShowAll(!showAll)}>
                {showAll ? "แสดงเฉพาะคนที่ดูแล" : `ดูพนักงานทั้งหมดของสาขา (${info.staff.length} คน)`}
              </button>
            )}
          </div>

          {info.staff.filter((s) => picked[s.id]).map((s) => (
            <div key={s.id} className="survey-q">
              <p>{s.name} <i>*</i></p>
              <Stars label={`ให้ดาว ${s.name}`} value={picked[s.id].rating} onChange={(n) => edit(s.id, { rating: n })} />
              <div className="review-tags">
                {info.tags.map((t) => {
                  const on = picked[s.id].tags.includes(t);
                  return <button key={t} type="button" aria-pressed={on} onClick={() => edit(s.id, { tags: on ? picked[s.id].tags.filter((x) => x !== t) : [...picked[s.id].tags, t] })}>{t}</button>;
                })}
              </div>
              <textarea rows={2} value={picked[s.id].comment} onChange={(e) => edit(s.id, { comment: e.target.value })} placeholder={`อยากบอกอะไรกับ${s.name} (ไม่บังคับ)`} />
            </div>
          ))}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block"><span className="label">ชื่อผู้รีวิว (ไม่บังคับ)</span><input value={rater} onChange={(e) => setRater(e.target.value)} /></label>
            <label className="block"><span className="label">ความเกี่ยวข้องกับ{info.resident}</span><select value={relation} onChange={(e) => setRelation(e.target.value)}>{info.relations.map((r) => <option key={r}>{r}</option>)}</select></label>
          </div>
          <input className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" value={trap} onChange={(e) => setTrap(e.target.value)} />
          {err && <p role="alert" className="form-error"><Icon name="alert" className="h-4 w-4 shrink-0" />{err}</p>}
          <button type="button" className="btn-primary w-full !py-3" disabled={busy} onClick={submit}>
            {busy ? "กำลังส่ง…" : Object.keys(picked).length ? `ส่งรีวิว (${Object.keys(picked).length} คน)` : "ส่งรีวิว"}
          </button>
        </section>
      )}
      <footer className="survey-foot">{COMPANY.th}<br />{COMPANY.contact}</footer>
    </main>
  );
}
