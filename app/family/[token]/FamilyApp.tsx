"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import Icon from "@/components/Icon";
import { COMPANY, CompanyFoot } from "@/components/ui";

type Task = { time: string | null; title: string; note: string | null; by: string | null; photo: string | null };
type Program = { items: { name: string; reps: string; note: string }[]; done: number[] };
type Diary = { resident: string; branch: string; date: string; today: string; days: string[]; tasks: Task[]; meds: { meal: string; given: boolean; at: string | null }[]; program?: Program | null };
const dayLabel = (iso: string, today: string) => {
  const d = new Date(iso + "T00:00:00");
  const diff = Math.round((new Date(today + "T00:00:00").getTime() - d.getTime()) / 864e5);
  return diff === 0 ? "วันนี้" : diff === 1 ? "เมื่อวาน" : d.toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short" });
};
const longDate = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const firstName = (n: string) => n.replace(/\s*\(.*?\)\s*/g, "").replace(/^(นางสาว|นาง|นาย|พว\.|คุณ)\s*/, "").split(" ")[0];

/** สมุดภาพประจำวัน: รูปและบันทึกจากงานที่พนักงานแชร์ การให้ยาตามมื้อ และปุ่มรีวิวพนักงาน */
export default function FamilyApp({ token }: { token: string }) {
  const [date, setDate] = useState("");
  const [d, setD] = useState<Diary | null>(null);
  const [fail, setFail] = useState("");
  const [loading, setLoading] = useState(true);
  const [big, setBig] = useState<Task | null>(null);
  /** ติ๊ก/ยกเลิกท่าที่ทำแล้ววันนี้ (อัปเดตหน้าจอก่อน ส่งไม่สำเร็จค่อยคืนค่า) */
  const tickProg = (i: number, done: boolean) => {
    setD((x) => (x?.program ? { ...x, program: { ...x.program, done: done ? [...x.program.done, i] : x.program.done.filter((k) => k !== i) } } : x));
    fetch("/api/public/family", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ t: token, item: i, done }) })
      .then((r) => { if (!r.ok) throw new Error(); })
      .catch(() => setD((x) => (x?.program ? { ...x, program: { ...x.program, done: done ? x.program.done.filter((k) => k !== i) : [...x.program.done, i] } } : x)));
  };

  useEffect(() => {
    setLoading(true);
    fetch(`/api/public/family?t=${encodeURIComponent(token)}${date ? `&date=${date}` : ""}`, { cache: "no-store" })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setD(j); setFail(""); })
      .catch((e) => setFail((e as Error).message || "เปิดสมุดภาพไม่สำเร็จ"))
      .finally(() => setLoading(false));
  }, [token, date]);

  const days = d ? [...new Set([d.today, ...d.days])].sort().reverse() : [];
  const photos = d?.tasks.filter((t) => t.photo) ?? [];

  return (
    <main className="survey-page">
      <header className="survey-head">
        <Image src="/logo-mark.png" alt="KIN" width={56} height={42} className="h-11 w-auto" />
        <div><b>{COMPANY.brand}</b><span>{d ? `สาขา${d.branch}` : "THE ART OF CARE"}</span></div>
      </header>

      {fail && (
        <section className="survey-card text-center">
          <Icon name="alert" className="mx-auto h-8 w-8 text-red-600" />
          <h1 className="mt-2 text-lg font-semibold text-gold-900">เปิดสมุดภาพไม่ได้</h1>
          <p className="mt-1 text-sm text-gold-600">{fail}</p>
          <p className="mt-3 text-xs text-gold-500">{COMPANY.contact}</p>
        </section>
      )}
      {!d && !fail && <p className="survey-card text-center text-gold-500">กำลังโหลด…</p>}

      {d && !fail && (
        <div className="space-y-4">
          <section className="family-hero">
            <p>สมุดภาพประจำวันของ</p>
            <h1>{d.resident}</h1>
            <span>{longDate(d.date)}</span>
          </section>

          <nav className="family-days" aria-label="เลือกวัน">
            {days.map((x) => (
              <button key={x} type="button" aria-pressed={x === d.date} onClick={() => setDate(x)}>{dayLabel(x, d.today)}</button>
            ))}
          </nav>

          {d.meds.length > 0 && (
            <section className="survey-card">
              <h2 className="family-h"><Icon name="pill" className="h-4 w-4" /> การให้ยา</h2>
              <ul className="family-meds">
                {d.meds.map((m) => (
                  <li key={m.meal} className={m.given ? "is-done" : ""}>
                    <b>มื้อ{m.meal}</b>
                    <span>{m.given ? `ให้ยาแล้ว${m.at ? ` ${m.at} น.` : ""}` : "ยังไม่ถึงเวลา / รอให้ยา"}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="survey-card">
            <h2 className="family-h"><Icon name="camera" className="h-4 w-4" /> การดูแล{d.date === d.today ? "วันนี้" : "วันนั้น"} <small>{d.tasks.length} รายการ · {photos.length} รูป</small></h2>
            {loading && <p className="text-sm text-gold-500">กำลังโหลด…</p>}
            {!loading && !d.tasks.length && <p className="rounded-2xl bg-cream-50 py-8 text-center text-sm text-gold-600">ยังไม่มีบันทึกการดูแลของวันนี้ · ทีมจะอัปเดตระหว่างวัน</p>}
            <ol className="family-timeline">
              {d.tasks.map((t, i) => (
                <li key={i}>
                  <span className="family-time">{t.time ?? "-"}</span>
                  <div>
                    <b>{t.title}</b>
                    {t.note && <p>{t.note}</p>}
                    {t.photo && (
                      <button type="button" className="family-photo" onClick={() => setBig(t)} aria-label={`ดูรูป ${t.title}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={t.photo} alt={t.title} loading="lazy" />
                      </button>
                    )}
                    {t.by && <small>ดูแลโดย {firstName(t.by)}</small>}
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {d.program && d.program.items.length > 0 && (
            <section className="survey-card">
              <h2 className="family-h"><Icon name="heart" className="h-4 w-4" /> โปรแกรมออกกำลังกายที่บ้าน <small>ทำแล้ววันนี้ {d.program.done.length}/{d.program.items.length} ท่า</small></h2>
              <ul className="family-prog">
                {d.program.items.map((x, i) => {
                  const done = d.program!.done.includes(i);
                  return (
                    <li key={i} className={done ? "is-done" : ""}>
                      <div><b>{i + 1}. {x.name}</b>{x.reps && <span>{x.reps}</span>}{x.note && <small>{x.note}</small>}</div>
                      <button type="button" aria-pressed={done} onClick={() => tickProg(i, !done)}>{done ? "ทำแล้ว ✓" : "ติ๊กว่าทำแล้ว"}</button>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-xs text-gold-500">นักกายภาพเห็นว่าทำไปกี่ท่าในแต่ละวัน · ทำไม่ไหวหรือเจ็บให้หยุดแล้วแจ้งสาขา</p>
            </section>
          )}

          <section className="survey-card text-center">
            <p className="text-sm text-gold-700">ประทับใจพนักงานคนไหน ส่งคำชมได้ที่นี่</p>
            <Link href={`/review/${token}`} className="btn-primary mt-3 inline-flex w-full justify-center !py-3"><Icon name="trophy" className="h-4 w-4" /> รีวิวพนักงานที่ดูแล</Link>
          </section>
        </div>
      )}

      {big?.photo && (
        <div className="family-lightbox" role="dialog" aria-label={big.title} onClick={() => setBig(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={big.photo} alt={big.title} />
          <p>{big.time} น. · {big.title}</p>
          <button type="button" aria-label="ปิด" onClick={() => setBig(null)}><Icon name="close" className="h-5 w-5" /></button>
        </div>
      )}
      <CompanyFoot branch={d?.branch} />
    </main>
  );
}
