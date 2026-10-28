"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import Icon from "@/components/Icon";
import { COMPANY } from "@/components/ui";

type Kind = "survey" | "complaint";
const RELATIONS = ["บุตร/ธิดา", "คู่สมรส", "หลาน", "ญาติ", "ผู้รับบริการเอง", "อื่น ๆ"];
const ASPECTS = [
  { key: "care", label: "การดูแลผู้สูงอายุ" },
  { key: "staff", label: "ความใส่ใจของพนักงาน" },
  { key: "food", label: "อาหาร" },
  { key: "clean", label: "ความสะอาดของสถานที่" },
] as const;
const LEVEL = ["", "ควรปรับปรุง", "พอใช้", "ปานกลาง", "ดี", "ดีมาก"];

function Stars({ value, onChange, big = false, label }: { value: number; onChange: (n: number) => void; big?: boolean; label: string }) {
  return (
    <div className={`stars ${big ? "is-big" : ""}`} role="radiogroup" aria-label={label}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} ดาว ${LEVEL[n]}`} className={n <= value ? "is-on" : ""} onClick={() => onChange(n)}>★</button>
      ))}
      {value > 0 && <span>{LEVEL[value]}</span>}
    </div>
  );
}

/** แบบประเมินความพึงพอใจ และแจ้งเรื่อง/ร้องเรียน สำหรับครอบครัว (เปิดจากลิงก์หรือ QR ของสาขา) */
export default function SurveyApp({ branch, initial }: { branch: string; initial: Kind }) {
  const [kind, setKind] = useState<Kind>(initial);
  const [valid, setValid] = useState<boolean | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [f, setF] = useState<Record<string, string>>({ relation: RELATIONS[0] });
  const [scores, setScores] = useState<Record<string, number>>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Kind | null>(null);

  useEffect(() => {
    fetch(`/api/public/feedback?branch=${encodeURIComponent(branch)}`, { cache: "no-store" })
      .then((r) => r.json()).then((d) => { setValid(!!d.ok); setCategories(d.categories ?? []); setF((x) => ({ ...x, category: d.categories?.[0] ?? "" })); })
      .catch(() => setValid(false));
  }, [branch]);

  const set = (k: string) => (e: { target: { value: string } }) => { setErr(""); setF({ ...f, [k]: e.target.value }); };
  const submit = async () => {
    setErr("");
    if (kind === "survey" && !scores.overall) return setErr("กรุณาให้คะแนนความพึงพอใจโดยรวม (กดดาว)");
    if (kind === "complaint" && (f.detail ?? "").trim().length < 5) return setErr("กรุณาเล่ารายละเอียดของเรื่องที่ต้องการแจ้ง");
    if (kind === "complaint" && !/^[0-9+\-\s]{9,20}$/.test(f.phone ?? "")) return setErr("กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง เพื่อให้ผู้จัดการสาขาติดต่อกลับ");
    setBusy(true);
    try {
      const r = await fetch("/api/public/feedback", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: kind, branch, ...f, ...scores }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "ส่งไม่สำเร็จ กรุณาลองใหม่");
      setDone(kind);
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };

  return (
    <main className="survey-page">
      <header className="survey-head">
        <Image src="/logo-mark.png" alt="KIN" width={56} height={42} className="h-11 w-auto" />
        <div><b>{COMPANY.brand}</b><span>{valid ? `สาขา${branch}` : "THE ART OF CARE"}</span></div>
      </header>

      {valid === null && <p className="survey-card text-center text-gold-500">กำลังโหลด…</p>}
      {valid === false && (
        <section className="survey-card text-center">
          <Icon name="alert" className="mx-auto h-8 w-8 text-red-600" />
          <h1 className="mt-2 text-lg font-semibold text-gold-900">ไม่พบสาขานี้</h1>
          <p className="mt-1 text-sm text-gold-600">กรุณาสแกน QR Code ที่ศูนย์อีกครั้ง หรือติดต่อ {COMPANY.contact}</p>
        </section>
      )}

      {valid && done && (
        <section className="survey-card text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-green-100 text-green-700"><Icon name="check" className="h-7 w-7" /></span>
          <h1 className="mt-3 text-xl font-semibold text-gold-900">{done === "survey" ? "ขอบคุณสำหรับการประเมิน" : "ได้รับเรื่องของท่านแล้ว"}</h1>
          <p className="mt-2 text-sm leading-6 text-gold-700">{done === "survey" ? "ความคิดเห็นของท่านส่งถึงผู้จัดการสาขาแล้ว และจะนำไปพัฒนาการดูแลให้ดียิ่งขึ้น" : "ผู้จัดการสาขาจะติดต่อกลับทางเบอร์โทรศัพท์ที่ท่านให้ไว้โดยเร็วที่สุด กรณีเร่งด่วนโทร 02-096-4996"}</p>
          <button type="button" className="btn-soft mt-5" onClick={() => { setDone(null); setScores({}); setF({ relation: RELATIONS[0], category: categories[0] ?? "" }); }}>ส่งอีกครั้ง</button>
        </section>
      )}

      {valid && !done && (
        <section className="survey-card">
          <div className="seg mb-5 w-full" role="tablist">
            <button type="button" className="flex-1" aria-pressed={kind === "survey"} onClick={() => { setKind("survey"); setErr(""); }}>ประเมินความพึงพอใจ</button>
            <button type="button" className="flex-1" aria-pressed={kind === "complaint"} onClick={() => { setKind("complaint"); setErr(""); }}>แจ้งเรื่อง / ร้องเรียน</button>
          </div>

          {kind === "survey" ? (
            <div className="space-y-5">
              <div>
                <h1 className="text-lg font-semibold text-gold-900">แบบประเมินความพึงพอใจ</h1>
                <p className="text-sm text-gold-600">ใช้เวลาประมาณ 1 นาที ความเห็นของท่านช่วยให้เราดูแลคนที่ท่านรักได้ดีขึ้น</p>
              </div>
              <div className="survey-q"><p>ความพึงพอใจโดยรวม <i>*</i></p><Stars big label="ความพึงพอใจโดยรวม" value={scores.overall ?? 0} onChange={(n) => { setErr(""); setScores({ ...scores, overall: n }); }} /></div>
              {ASPECTS.map((a) => (
                <div key={a.key} className="survey-q is-small"><p>{a.label}</p><Stars label={a.label} value={scores[a.key] ?? 0} onChange={(n) => setScores({ ...scores, [a.key]: n })} /></div>
              ))}
              <label className="block"><span className="label">ข้อเสนอแนะ / คำชม</span><textarea rows={3} value={f.comment ?? ""} onChange={set("comment")} placeholder="เล่าสิ่งที่ประทับใจ หรือสิ่งที่อยากให้ปรับปรุง" /></label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block"><span className="label">ชื่อผู้ประเมิน (ไม่บังคับ)</span><input value={f.name ?? ""} onChange={set("name")} /></label>
                <label className="block"><span className="label">ความเกี่ยวข้อง</span><select value={f.relation} onChange={set("relation")}>{RELATIONS.map((r) => <option key={r}>{r}</option>)}</select></label>
                <label className="block"><span className="label">ชื่อผู้รับบริการ (ไม่บังคับ)</span><input value={f.resident ?? ""} onChange={set("resident")} /></label>
                <label className="block"><span className="label">เบอร์ติดต่อกลับ (ไม่บังคับ)</span><input type="tel" inputMode="tel" value={f.phone ?? ""} onChange={set("phone")} /></label>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              <div>
                <h1 className="text-lg font-semibold text-gold-900">แจ้งเรื่อง / ร้องเรียนถึงผู้จัดการสาขา</h1>
                <p className="text-sm text-gold-600">เรื่องของท่านส่งตรงถึงผู้จัดการสาขา{branch} และจะติดต่อกลับโดยเร็ว</p>
              </div>
              <label className="block"><span className="label">เรื่องเกี่ยวกับ</span><select value={f.category} onChange={set("category")}>{categories.map((c) => <option key={c}>{c}</option>)}</select></label>
              <label className="block"><span className="label">รายละเอียด <i className="text-red-600">*</i></span><textarea rows={5} value={f.detail ?? ""} onChange={set("detail")} placeholder="เกิดอะไรขึ้น เมื่อไร และเกี่ยวกับผู้รับบริการท่านใด" /></label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block"><span className="label">ชื่อผู้แจ้ง (ไม่บังคับ)</span><input value={f.name ?? ""} onChange={set("name")} /></label>
                <label className="block"><span className="label">เบอร์ติดต่อกลับ <i className="text-red-600">*</i></span><input type="tel" inputMode="tel" value={f.phone ?? ""} onChange={set("phone")} placeholder="08x-xxx-xxxx" /></label>
              </div>
            </div>
          )}

          <input className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website ?? ""} onChange={set("website")} />
          {err && <p role="alert" className="form-error mt-5"><Icon name="alert" className="h-4 w-4 shrink-0" />{err}</p>}
          <button type="button" className="btn-primary mt-5 w-full !py-3" disabled={busy} onClick={submit}>{busy ? "กำลังส่ง…" : kind === "survey" ? "ส่งแบบประเมิน" : "ส่งเรื่องถึงผู้จัดการสาขา"}</button>
          <p className="mt-3 text-center text-xs text-gold-500">ข้อมูลของท่านใช้เพื่อปรับปรุงบริการและติดต่อกลับเท่านั้น</p>
        </section>
      )}
      <footer className="survey-foot">{COMPANY.th}<br />{COMPANY.contact}</footer>
    </main>
  );
}
