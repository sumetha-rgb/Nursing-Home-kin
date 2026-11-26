"use client";
import { useEffect, useMemo, useState } from "react";
import Icon from "@/components/Icon";
import { AvatarEdit } from "@/components/Avatar";
import { useApp } from "@/lib/app";
import { DataTable, Field, Modal, StatusBadge } from "@/components/ui";
import ClinicalPanel, { ClinicalTab, useClinic } from "./Clinical";
import WoundLog from "./WoundLog";
import VitalPlanCard from "./VitalPlanCard";
import { PrintModal, ProfileDoc, ReferralDoc } from "@/components/print/Docs";
import { MedPhotoModal } from "@/components/pharmacy/MedPhotos";
import { useBranchInfo } from "@/components/views/Billing";
import { useSession } from "@/lib/session";
import ResidentBilling from "./ResidentBilling";
import { can, canNurseNote } from "@/lib/perms";
import { ADMISSION_FIELDS } from "@/lib/clinic";
import { fetchProfile, Profile, thDate, thWhen } from "@/lib/care";
import { evaluateVitals, LEVEL_TH, levelOf, LIMITS, parseVitals, Vitals } from "@/lib/vitals";
import { isNoAllergy } from "@/lib/medicalLists";
import { fetchVitalDue, INTAKE_SINCE, needOf, VITAL_DUE_EVENT } from "@/lib/vitalPlan";
import { mealByClock } from "@/components/pharmacy/GiveMeds";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v === null || v === undefined || v === "" ? "-" : Array.isArray(v) ? (v.length ? v.join(", ") : "-") : String(v));
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n.toLocaleString("th-TH", { maximumFractionDigits: 2 }) : "-"; };

/* ---------- กราฟเส้นขนาดเล็ก (SVG) ---------- */
type Series = { label: string; color: string; points: { x: string; y: number }[] };
function MiniChart({ title, unit, series, lines = [] }: { title: string; unit: string; series: Series[]; lines?: { y: number; label: string; tone: "watch" | "critical" }[] }) {
  const pts = series.flatMap((s) => s.points);
  if (!pts.length) return null;
  const W = 560, H = 170, L = 34, R = 10, T = 14, B = 26;
  const ys = [...pts.map((p) => p.y), ...lines.map((l) => l.y)];
  let lo = Math.min(...ys), hi = Math.max(...ys);
  const padY = Math.max((hi - lo) * 0.12, 2); lo -= padY; hi += padY;
  const n = Math.max(...series.map((s) => s.points.length));
  const xAt = (i: number) => L + (n <= 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (n - 1));
  const yAt = (y: number) => T + (1 - (y - lo) / (hi - lo)) * (H - T - B);
  const labels = series[0].points;
  const ticks = [lo + padY, (lo + hi) / 2, hi - padY].map((v) => Math.round(v * 10) / 10);
  return (
    <figure className="chart-card">
      <figcaption><span>{title}</span><small>{unit}</small></figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`กราฟ${title}`} className="w-full">
        {ticks.map((t) => <g key={t}><line x1={L} x2={W - R} y1={yAt(t)} y2={yAt(t)} className="chart-grid" /><text x={L - 6} y={yAt(t) + 3} className="chart-axis" textAnchor="end">{t}</text></g>)}
        {lines.map((l) => <g key={l.label + l.y}><line x1={L} x2={W - R} y1={yAt(l.y)} y2={yAt(l.y)} className={`chart-limit is-${l.tone}`} /><text x={W - R} y={yAt(l.y) - 3} textAnchor="end" className={`chart-limit-label is-${l.tone}`}>{l.label}</text></g>)}
        {series.map((s) => (
          <g key={s.label}>
            <polyline fill="none" stroke={s.color} strokeWidth={2.2} strokeLinejoin="round" strokeLinecap="round" points={s.points.map((p, i) => `${xAt(i)},${yAt(p.y)}`).join(" ")} />
            {s.points.map((p, i) => <circle key={i} cx={xAt(i)} cy={yAt(p.y)} r={3.2} fill="#fff" stroke={s.color} strokeWidth={2}><title>{`${p.x} · ${s.label} ${p.y}`}</title></circle>)}
          </g>
        ))}
        {labels.map((p, i) => (n <= 6 || i % Math.ceil(n / 6) === 0 || i === n - 1) && <text key={i} x={xAt(i)} y={H - 8} textAnchor={n > 1 && i === n - 1 ? "end" : n > 1 && i === 0 ? "start" : "middle"} className="chart-axis">{p.x.split(" ")[0]}</text>)}
      </svg>
      {series.length > 1 && <div className="chart-legend">{series.map((s) => <span key={s.label}><i style={{ background: s.color }} />{s.label}</span>)}</div>}
    </figure>
  );
}

const limitLines = (k: keyof Vitals) => {
  const l = LIMITS[k]; const out: { y: number; label: string; tone: "watch" | "critical" }[] = [];
  if (l.criticalHigh !== undefined) out.push({ y: l.criticalHigh, label: `ผิดปกติ ≥${l.criticalHigh}`, tone: "critical" });
  if (l.criticalLow !== undefined) out.push({ y: l.criticalLow, label: `ผิดปกติ <${l.criticalLow}`, tone: "critical" });
  return out;
};

const TABS = ["ภาพรวม", "แรกรับ/ประเมิน", "บันทึกพยาบาล", "บันทึกผู้ช่วยพยาบาล", "แผล", "สัญญาณชีพ", "ยาและการให้ยา", "กายภาพ", "เวชภัณฑ์", "งานดูแลและนัดหมาย", "สมุดส่งเวร", "ค่าใช้จ่าย"];
/** แท็บแบ่ง 2 แถวตามกลุ่ม ไม่ต้องเลื่อนซ้ายขวา */
const TAB_GROUPS = [
  { label: "ข้อมูลทั่วไป", tabs: ["ภาพรวม", "งานดูแลและนัดหมาย", "สมุดส่งเวร"] },
  // แรกรับ/ประเมิน = งานของพยาบาล ต้องบันทึกก่อนเขียนบันทึกอื่น (รับเข้าใหม่) จึงอยู่หน้าสุดของกลุ่มการพยาบาล
  { label: "การพยาบาลและดูแลรายวัน", tabs: ["แรกรับ/ประเมิน", "บันทึกพยาบาล", "บันทึกผู้ช่วยพยาบาล", "แผล", "สัญญาณชีพ", "ยาและการให้ยา", "กายภาพ", "เวชภัณฑ์"] },  { label: "การเงิน", tabs: ["ค่าใช้จ่าย"], money: true },
];
/** มือถือ: 4 หัวข้อหลักบนแถบ [แท็บ, ชื่อสั้น, ไอคอน] · ที่เหลืออยู่ในแผ่น "อื่น ๆ" */
const MOBILE_MAIN: [string, string, string][] = [["ภาพรวม", "ภาพรวม", "heart"], ["สัญญาณชีพ", "สัญญาณชีพ", "pulse"], ["ยาและการให้ยา", "ยา", "pill"], ["บันทึกพยาบาล", "บันทึก", "doc"]];
/** มือถือ: ปุ่ม "บันทึก" รวม 2 หน้า สลับด้วยปุ่มด้านบน · เปิดหน้าของตำแหน่งตัวเองก่อน (ผู้ช่วยพยาบาล = บันทึกผู้ช่วยพยาบาล) */
const NOTE_TABS = ["บันทึกพยาบาล", "บันทึกผู้ช่วยพยาบาล"];
const TAB_ICON: Record<string, string> = { "แรกรับ/ประเมิน": "files", "งานดูแลและนัดหมาย": "calendar", "สมุดส่งเวร": "book", "บันทึกผู้ช่วยพยาบาล": "user", "แผล": "alert", "กายภาพ": "trophy", "เวชภัณฑ์": "tag", "ค่าใช้จ่าย": "receipt" };
const CLINICAL: Record<string, ClinicalTab> = { "แรกรับ/ประเมิน": "admission", "บันทึกพยาบาล": "nursing", "บันทึกผู้ช่วยพยาบาล": "aide", "กายภาพ": "physio", "เวชภัณฑ์": "supplies" };

/** ประวัติรายบุคคล: กดชื่อผู้รับบริการแล้วเห็นทุกอย่างในหน้าเดียว (พิมพ์เป็นเอกสารได้) */
/** initialTab = เปิดที่แท็บนี้ (เช่น "กายภาพ" จากหน้าตารางกายภาพ) · startAdmission = เปิดแท็บแรกรับพร้อมฟอร์มบันทึกแรกรับ (ป้ายรอแรกรับ) */
export default function ResidentProfile({ id, onClose, initialTab, startAdmission }: { id: string | null; onClose: () => void; initialTab?: string; startAdmission?: boolean }) {
  const [p, setP] = useState<Profile | null>(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState(TABS[0]);
  /** เปิดฟอร์มบันทึกแรกรับทันทีเมื่อแท็บแรกรับโหลดเสร็จ */
  const [autoAdm, setAutoAdm] = useState(false);
  const startAdm = () => { setTab("แรกรับ/ประเมิน"); setAutoAdm(true); };
  const { toast } = useApp();
  const { c, reload } = useClinic(id);
  const { user } = useSession();
  // แท็บค่าใช้จ่าย: เฉพาะคนที่ดูใบแจ้งหนี้หรือสัญญาได้ (แคชเชียร์ ผู้จัดการ ผู้บริหาร)
  const canMoney = can(user, "billing") || can(user, "contracts");
  const branchInfo = useBranchInfo();
  const [doc, setDoc] = useState<null | "profile" | "referral">(null);
  const [packPic, setPackPic] = useState<{ id: string; title: string } | null>(null);
  const [ref, setRef] = useState({ to: "", reason: "", summary: "" });
  useEffect(() => {
    if (!id) return;
    setP(null); setErr(""); setTab(startAdmission ? "แรกรับ/ประเมิน" : initialTab && TABS.includes(initialTab) ? initialTab : TABS[0]); setAutoAdm(!!startAdmission);
    fetchProfile(id).then(setP).catch((e) => setErr((e as Error).message));
  }, [id]);

  /** บันทึกสุขภาพ + สัญญาณชีพจากงานประจำวัน เรียงเก่า→ใหม่ */
  const vitals = useMemo(() => {
    if (!p) return [];
    const h = p.health.map((r) => ({ at: String(r.at ?? ""), v: parseVitals(r.vital_signs as string, r.o2_sat as string, r.dtx as string), row: r, src: "บันทึกสุขภาพ" }));
    const d = p.daily.filter((r) => r.vital_signs && r.vital_signs !== "-").map((r) => ({ at: `${r.work_date} ${String(r.time ?? "00:00").slice(0, 5)}`, v: parseVitals(r.vital_signs as string), row: r, src: "งานประจำวัน" }));
    return [...h, ...d].filter((x) => Object.keys(x.v).length).sort((a, b) => a.at.localeCompare(b.at));
  }, [p]);
  const recent = vitals.slice(-30);
  const series = (k: keyof Vitals, label: string, color: string): Series => ({ label, color, points: recent.filter((x) => x.v[k] !== undefined).map((x) => ({ x: thDate(x.at), y: x.v[k]! })) });
  const last = vitals[vitals.length - 1];
  const lastFlags = last ? evaluateVitals(last.v) : [];
  const r = p?.resident;
  const openAlerts = (p?.alerts ?? []).filter((a) => a.status === "open");
  const activeMeds = (p?.meds ?? []).filter((m) => !m.on_hold && (m.status ?? "ปกติ") === "ปกติ");
  // วันนี้ตามเวลาไทย (UTC+7) · toISOString ตรง ๆ เป็นเวลา UTC ทำให้ 00:00–06:59 ยังเป็นเมื่อวาน
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  /** ประวัติการเบิกยา: ยาในตะกร้าที่คงเหลือเปลี่ยน (จากประวัติการแก้ไข) + เบิกจากคลังยากลาง · เรียงใหม่→เก่า */
  const medHistory = useMemo(() => {
    if (!p) return [];
    const ago = (d: unknown) => { if (!d) return "-"; const n = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 864e5); return !Number.isFinite(n) ? "-" : n <= 0 ? "วันนี้" : `${n} วันก่อน`; };
    const fx = (v: unknown) => { const s = String(v ?? "").trim(); const n = Number(s); return s !== "" && Number.isFinite(n) ? n : null; };
    const moves = (p.medMoves ?? []).flatMap((m) => {
      const b = fx(m.b), s = fx(m.s), u = str(m.unit) === "-" ? "" : ` ${str(m.unit)}`;
      if (m.action === "create") return s === null ? [] : [{ ts: String(m.ts), row: [str(m.at), ago(m.day), str(m.name), "เพิ่มยาใหม่", `${num(s)}${u}`, `${num(s)}${u}`, str(m.by), "-", "-"] }];
      if (b === null || s === null || b === s) return [];
      const out = s < b;
      return [{ ts: String(m.ts), row: [str(m.at), ago(m.day), str(m.name), out ? "เบิกออก" : "เติมยา / ปรับยอด", `${out ? "−" : "+"}${num(Math.abs(b - s))}${u}`, `${num(b)} → ${num(s)}${u}`, str(m.by), "-", "-"] }];
    });
    const central = (p.stockMeds ?? []).map((m) => ({ ts: String(m.ts ?? ""), row: [str(m.at), ago(m.day), str(m.name), "เบิกจากคลังกลาง", `${num(m.qty)} ${str(m.unit)}`, "-", str(m.moved_by),
      [m.basket ? "เข้าตะกร้ายา" : "ใช้ครั้งคราว", str(m.note) === "-" ? "" : str(m.note)].filter(Boolean).join(" · "), !m.priced ? "ไม่คิดเงิน" : m.billed ? "เรียกเก็บแล้ว" : "ยังไม่เรียกเก็บ"] }));
    // ประวัติการเบิก = การเคลื่อนไหวของยา · "ไม่ได้ให้เพราะ…" ไม่ตัดคงเหลือ จึงไม่อยู่ที่นี่ (ดูที่บันทึกการให้ยา)
    const taken = (p.withdrawals ?? []).filter((m) => !m.skip_reason).map((m) => { const u = str(m.unit) === "-" ? "" : ` ${str(m.unit)}`;
      const v = m.void_reason ? `ยกเลิกแล้ว: ${str(m.void_reason)} · ${str(m.voided_by)} (คืนคงเหลือ)` : "";
      return { ts: String(m.ts ?? ""), row: [str(m.at), ago(m.day), str(m.name), v ? "เบิกออก · ยกเลิกแล้ว" : "เบิกออก", `${v ? "" : "−"}${num(m.qty)}${u}${v ? " (คืนแล้ว)" : ""}`, `${num(m.b)} → ${num(m.s)}${u}`, str(m.by),
        [v, m.meal ? `มื้อ${str(m.meal)}` : "", str(m.note) === "-" ? "" : str(m.note)].filter(Boolean).join(" · ") || "-", "-"] }; });
    return [...taken, ...moves, ...central].sort((a, b) => b.ts.localeCompare(a.ts)).map((x) => x.row);
  }, [p, today]);
  /** บันทึกการให้ยา: การเบิก (ให้ยา) ทุกครั้ง · ไม่ได้ให้พร้อมเหตุผล · ยกเลิกแล้ว */
  const mar = useMemo(() => (p?.withdrawals ?? []).map((m) => {
    const u = str(m.unit) === "-" ? "" : ` ${str(m.unit)}`;
    return [str(m.at), str(m.meal), str(m.name), m.skip_reason ? "-" : `${num(m.qty)}${u}`, str(m.by),
      m.void_reason ? `ยกเลิก (${str(m.void_reason)})` : m.skip_reason ? `ไม่ได้ให้: ${str(m.skip_reason)}` : "ให้แล้ว"];
  }), [p]);
  const nextAppt = (p?.appts ?? []).filter((a) => String(a.date ?? "") >= today).sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
  // ---------- แถบหัวข้อบนมือถือ ----------
  const [sheet, setSheet] = useState(false);
  useEffect(() => { setSheet(false); }, [id]);
  /** สัญญาณชีพ: จำนวนรายการที่ถึงรอบ/เลยกำหนด (รอบการวัดรายบุคคล) */
  const [vdN, setVdN] = useState(0);
  useEffect(() => {
    if (!id) return;
    const load = () => fetchVitalDue({ id }).then((d) => setVdN(d.items[0] ? needOf(d.items[0]).length : 0)).catch(() => {});
    load(); window.addEventListener(VITAL_DUE_EVENT, load); return () => window.removeEventListener(VITAL_DUE_EVENT, load);
  }, [id]);
  /** ยา: ยามื้อนี้ (ตามเวลา) ที่ยังไม่มีบันทึกวันนี้ · เทียบชื่อยากับบันทึกการให้ยา (ให้แล้ว/ไม่ได้ให้ นับว่าบันทึกแล้ว) */
  const mealNow = mealByClock();
  const medLeft = activeMeds.filter((m) => (Array.isArray(m.meals) ? (m.meals as string[]) : String(m.meals ?? "").split(/,\s*/)).includes(mealNow)
    && !(p?.withdrawals ?? []).some((w) => w.day === today && !w.void_reason && w.name === m.drug_name && String(w.meal ?? "").split(", ").includes(mealNow))).length;
  const hoN = p?.handovers.length ?? 0;
  const noteHome = canNurseNote(user) ? NOTE_TABS[0] : NOTE_TABS[1];
  const mainTabs: [string, string, string][] = MOBILE_MAIN.map((m) => (m[0] === NOTE_TABS[0] ? [noteHome, m[1], m[2]] : m));
  /** แท็บนี้อยู่บนแถบหลักไหม (2 หน้าบันทึกนับเป็นปุ่ม "บันทึก") */
  const onMain = (t: string) => mainTabs.some(([m]) => m === t) || NOTE_TABS.includes(t);
  /** สถานะสั้นของหัวข้อในแผ่น "อื่น ๆ" */
  const statusOf = (t: string) => {
    const last = (kind: string) => c?.notes.find((n) => n.kind === kind)?.at;
    if (t === "แรกรับ/ประเมิน") return c?.admission ? `บันทึกแล้ว ${c.admission.at.slice(0, 10)}` : "ยังไม่ได้บันทึก";
    if (t === "บันทึกผู้ช่วยพยาบาล") return last("aide") ? `ล่าสุด ${last("aide")}` : "";
    if (t === "กายภาพ") { const a = (c?.courses ?? []).filter((x) => x.status !== "ปิดคอร์ส" && x.used < x.total); return a.length ? `คอร์สเหลือ ${a.reduce((n, x) => n + (x.total - x.used), 0)} ครั้ง` : ""; }
    if (t === "เวชภัณฑ์") return c?.supplies[0] ? `เบิกล่าสุด ${c.supplies[0].at}` : "";
    if (t === "งานดูแลและนัดหมาย") return nextAppt ? `นัด ${thDate(String(nextAppt.date), false)} ${String(nextAppt.time ?? "").slice(0, 5)}` : "";
    if (t === "สมุดส่งเวร") return hoN ? `${hoN} เรื่อง` : "";
    return "";
  };
  // ข้อมูลสำคัญสำหรับการดูแลจากสัญญา · แพ้ยา/แพ้อาหาร ขึ้นแถบแดงทุกแท็บ
  const ci = p?.careInfo ?? null;
  const txt = (v: unknown) => { const s = String(v ?? "").trim(); return s && s !== "-" ? s : ""; };
  const allergy = ci ? [isNoAllergy(txt(ci.drug_allergy)) ? "" : `แพ้ยา: ${txt(ci.drug_allergy)}`, isNoAllergy(txt(ci.food_allergy)) ? "" : `แพ้อาหาร: ${txt(ci.food_allergy)}`].filter(Boolean) : [];
  const phone = ci ? txt(ci.employer_phone).replace(/\D/g, "") : "";
  /** การ์ดรับเข้าใหม่ (แท็บภาพรวม): คนที่เข้าทะเบียนตั้งแต่วันที่เปิดใช้ · หายเองเมื่อมีห้อง แรกรับแล้ว และมียาประจำครบ */
  const created = String(r?.created ?? "");
  const regMeds = ci ? txt(ci.regular_meds) : "";
  const hasRoom = !!txt(r?.room);
  type Step = { t: string; done: boolean; sub: string; keep: boolean; act?: () => void; label?: string; primary?: boolean };
  const intakeSteps: Step[] = r && c ? [
    { t: "เปิดสัญญา", done: p!.contracts.length > 0 || !!ci, sub: p!.contracts.length ? `สัญญา ${str(p!.contracts[0].contract_no)}` : ci ? "มีข้อมูลจากสัญญาแล้ว" : "ยังไม่มีสัญญาในระบบ", keep: false },
    { t: "เข้าห้องและเตียง", done: hasRoom, sub: hasRoom ? `ห้อง ${str(r.room)}` : "หัวหน้าพยาบาลหรือผู้จัดการสาขาจัดห้องที่เมนูห้องพักและเตียง", keep: true },
    { t: "บันทึกแรกรับและตั้งรอบการวัด", done: !!c.admission, sub: c.admission ? `โดย ${c.admission.assessed_by ?? "-"} · ${c.admission.at}` : "ประวัติ ประเมินแรกรับ อาหาร และรอบวัดสัญญาณชีพในฟอร์มเดียว", keep: true, act: startAdm, label: "บันทึกแรกรับ", primary: true },
    { t: "ยาประจำตัว", done: activeMeds.length > 0 || !regMeds || /^ไม่มี/.test(regMeds), sub: activeMeds.length ? `ในแท็บยา ${activeMeds.length} รายการ` : regMeds && !/^ไม่มี/.test(regMeds) ? `สัญญาระบุ ${regMeds} · ยังไม่ได้เพิ่มในแท็บยา` : "สัญญาระบุว่าไม่มียาประจำ", keep: true, act: () => setTab("ยาและการให้ยา"), label: "เพิ่มยา" },
  ] : [];
  const intake = created >= INTAKE_SINCE && String(r?.status ?? "").startsWith("เข้าอยู่") && intakeSteps.some((s) => s.keep && !s.done) ? intakeSteps : null;

  return (
    <>
    <Modal open={!!id} wide title={r ? `ประวัติผู้รับบริการ · ${r.full_name}` : "ประวัติผู้รับบริการ"} onClose={onClose}
      footer={<><button className="btn-soft" disabled={!p} onClick={() => setDoc("referral")}><Icon name="send" className="h-4 w-4" /> ใบส่งต่อ</button><button className="btn-soft" disabled={!p} onClick={() => setDoc("profile")}><Icon name="print" className="h-4 w-4" /> พิมพ์สรุปประวัติ</button><button className="btn-primary" onClick={onClose}>ปิด</button></>}>
      {err && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{err}</p>}
      {!p && !err && <p className="py-10 text-center text-sm text-gold-500">กำลังโหลดประวัติ…</p>}
      {p && r && (
        <div className="space-y-5">
          <div className="profile-head">
            <AvatarEdit kind="resident" id={id!} name={r.full_name} size={72} onDone={(m) => toast(m)} title={<span className="min-w-0">
              <span className="block text-lg font-semibold text-gold-900">{r.full_name}</span>
              <span className="block text-sm text-gold-600">อายุ {r.age ?? "-"} ปี · ห้อง {r.room ?? "-"} · สาขา{r.branch_name ?? "-"}</span>
              <span className="mt-1 block text-sm text-gold-700">โรคประจำตัว: {str(r.chronic_diseases)}</span>
            </span>} />
            {r.status && <StatusBadge value={r.status} />}
          </div>
          {allergy.length > 0 && <p role="alert" className="care-allergy"><Icon name="alert" className="h-5 w-5 shrink-0" /><span><b>ระวัง · {allergy.join(" · ")}</b><small>ข้อมูลจากสัญญา · ตรวจก่อนให้ยาและอาหารทุกครั้ง</small></span></p>}

          {/* มือถือ: แถบ 4 หัวข้อหลัก + อื่น ๆ ติดหัวจอตอนเลื่อน · ตัวเลข = เรื่องค้าง · อื่น ๆ = แผ่นเลื่อนขึ้นจากล่าง (หัวข้อที่เหลือ จัดกลุ่ม พร้อมสถานะล่าสุด) */}
          <nav className="pf-tabs print-hide md:hidden" aria-label="หัวข้อ">
            {mainTabs.map(([t, short, ic]) => {
              const n = t === "สัญญาณชีพ" ? vdN : t === "ยาและการให้ยา" ? medLeft : 0;
              const on = tab === t || (NOTE_TABS.includes(t) && NOTE_TABS.includes(tab));
              return <button key={t} type="button" aria-current={on ? "page" : undefined} className={on ? "is-on" : ""} onClick={() => { setTab(t); setSheet(false); }}>
                <Icon name={ic} className="h-[19px] w-[19px]" />{short}{n > 0 && <i className="pf-n">{n}</i>}</button>;
            })}
            <button type="button" aria-haspopup="dialog" aria-expanded={sheet} className={onMain(tab) ? "" : "is-on"} onClick={() => setSheet(true)}>
              <Icon name="menu" className="h-[19px] w-[19px]" />{onMain(tab) ? "อื่น ๆ" : tab.length > 8 ? `${tab.slice(0, 7)}…` : tab}{hoN > 0 && <i className="pf-dot" aria-label="มีเรื่องใหม่" />}</button>
          </nav>
          {sheet && <div className="pf-sheet md:hidden" role="dialog" aria-modal="true" aria-label="หัวข้ออื่น" onClick={(e) => { if (e.target === e.currentTarget) setSheet(false); }}>
            <div className="pf-sheet-in">
              <span className="pf-grab" aria-hidden />
              {TAB_GROUPS.filter((g) => !("money" in g) || canMoney).map((g) => {
                const rest = g.tabs.filter((t) => !onMain(t));
                return rest.length ? <div key={g.label}><p className="pf-gh">{g.label}</p>{rest.map((t) => (
                  <button key={t} type="button" className={tab === t ? "is-on" : ""} onClick={() => { setTab(t); setSheet(false); }}>
                    <Icon name={TAB_ICON[t] ?? "doc"} className="h-[18px] w-[18px]" /><span>{t}</span>{t === "สมุดส่งเวร" && hoN > 0 && <i className="pf-dot" />}<small>{statusOf(t)}</small></button>))}</div> : null;
              })}
              <button type="button" className="pf-close" onClick={() => setSheet(false)}>ปิด</button>
            </div>
          </div>}

          <div className="print-hide hidden space-y-2 rounded-2xl border border-cream-300 bg-cream-50 p-3 md:block" role="group" aria-label="เลือกหัวข้อ">
            {TAB_GROUPS.filter((g) => !("money" in g) || canMoney).map((g) => <div key={g.label} className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
              <span className="w-28 shrink-0 text-xs font-medium text-gold-500">{g.label}</span>
              <div className="flex flex-wrap gap-1.5">{g.tabs.map((t) => <button type="button" key={t} aria-pressed={tab === t} onClick={() => setTab(t)}
                className={`rounded-full px-3.5 py-1.5 text-sm transition ${tab === t ? "bg-gold-700 font-medium text-white shadow-sm" : "border border-cream-300 bg-white text-gold-700 hover:border-gold-300"}`}>{t}</button>)}</div>
            </div>)}
          </div>

          {NOTE_TABS.includes(tab) && <div className="pf-notesw print-hide md:hidden" role="group" aria-label="เลือกบันทึก">{NOTE_TABS.map((t) => (
            <button key={t} type="button" aria-pressed={tab === t} className={tab === t ? "is-on" : ""} onClick={() => setTab(t)}>{t}</button>))}</div>}
          {tab === "แผล" && id && <WoundLog residentId={id} />}
          {tab === "ค่าใช้จ่าย" && canMoney && <ResidentBilling name={r.full_name} hn={r.hn as string | null | undefined} />}
          {tab === TABS[0] && (
            <div className="grid gap-4 md:grid-cols-2">
              {intake && <section className="profile-box md:col-span-2 !border-sky-200 !bg-sky-50/60">
                <h4>รับเข้าใหม่ · เหลือ {intake.filter((s) => s.keep && !s.done).length} ขั้นตอน <span className="text-xs font-normal text-gold-500">เข้าทะเบียน {thDate(created, false)}</span></h4>
                <ul className="space-y-2">{intake.map((s) => (
                  <li key={s.t} className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-white px-3 py-2 ${s.done ? "border-cream-200" : "border-sky-300"}`}>
                    <span className="min-w-0"><b className={`block text-sm ${s.done ? "text-gold-600" : "text-gold-900"}`}>{s.done ? "✓ " : ""}{s.t}</b><small className="block text-xs text-gold-500">{s.sub}</small></span>
                    {s.done ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">เสร็จ</span>
                      : s.act && <button type="button" className={s.primary ? "btn-primary !px-3 !py-1.5 text-sm" : "btn-soft !px-3 !py-1.5 text-sm"} onClick={s.act}>{s.label}</button>}
                  </li>
                ))}</ul>
              </section>}
              {ci && <section className="profile-box md:col-span-2">
                <h4>ข้อมูลสำคัญสำหรับการดูแล</h4>
                <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                  <div><dt className="text-xs text-gold-500">แพ้ยา</dt><dd className={isNoAllergy(txt(ci.drug_allergy)) ? "text-gold-800" : "font-semibold text-red-700"}>{isNoAllergy(txt(ci.drug_allergy)) ? "ไม่มีประวัติแพ้ยา" : txt(ci.drug_allergy)}</dd></div>
                  <div><dt className="text-xs text-gold-500">แพ้อาหาร</dt><dd className={isNoAllergy(txt(ci.food_allergy)) ? "text-gold-800" : "font-semibold text-red-700"}>{isNoAllergy(txt(ci.food_allergy)) ? "ไม่มีประวัติแพ้อาหาร" : txt(ci.food_allergy)}</dd></div>
                  <div><dt className="text-xs text-gold-500">ยา / เวชภัณฑ์ที่ใช้ประจำ (แจ้งตอนเปิดสัญญา)</dt><dd className="text-gold-800">{txt(ci.regular_meds) || "ไม่มี"}</dd></div>
                  <div><dt className="text-xs text-gold-500">โรงพยาบาลตามสิทธิ์</dt><dd className="text-gold-800">{[txt(ci.hospital), txt(ci.hospital_alt) ? `สำรอง ${txt(ci.hospital_alt)}` : ""].filter(Boolean).join(" · ") || "-"}</dd></div>
                  <div className="sm:col-span-2"><dt className="text-xs text-gold-500">ผู้ติดต่อฉุกเฉิน</dt><dd className="text-gold-800">{txt(ci.employer_name) || "-"}{txt(ci.relationship) ? ` (${txt(ci.relationship)})` : ""}{phone ? <> · <a className="font-medium text-gold-900 underline underline-offset-2" href={`tel:${phone}`}>{phone.length === 10 ? `${phone.slice(0, 3)}-${phone.slice(3, 6)}-${phone.slice(6)}` : phone}</a></> : ""}</dd></div>
                </dl>
              </section>}
              <section className="profile-box">
                <h4>สัญญาณชีพล่าสุด</h4>
                {last ? <>
                  <p className="text-xs text-gold-500">{thDate(last.at)} · {last.src}</p>
                  <p className="mt-1.5 text-sm font-medium text-gold-900">{str(last.row.vital_signs)}{last.row.o2_sat ? ` · O2 ${last.row.o2_sat}` : ""}{last.row.dtx && last.row.dtx !== "-" ? ` · DTX ${last.row.dtx}` : ""}</p>
                  <div className="mt-2"><StatusBadge value={LEVEL_TH[levelOf(lastFlags)]} /></div>
                </> : <p className="text-sm text-gold-500">ยังไม่มีบันทึก</p>}
              </section>
              <section className="profile-box">
                <h4>แจ้งเตือนที่รอรับทราบ</h4>
                {openAlerts.length ? <ul className="space-y-1.5 text-sm">{openAlerts.map((a) => <li key={String(a.id)} className={a.level === "critical" ? "text-red-700" : "text-amber-800"}>• {str(a.summary)} <span className="text-xs text-gold-500">({thWhen(a.created_at)})</span></li>)}</ul> : <p className="text-sm text-emerald-700">ไม่มีแจ้งเตือนค้าง</p>}
              </section>
              <section className="profile-box">
                <h4>ยาที่ใช้อยู่ ({activeMeds.length} รายการ)</h4>
                {activeMeds.length ? <ul className="space-y-1 text-sm text-gold-800">{activeMeds.slice(0, 6).map((m) => <li key={String(m.id)}>• {str(m.drug_name)} <span className="text-xs text-gold-500">{str(m.meals)}</span></li>)}</ul> : <p className="text-sm text-gold-500">ไม่มีรายการยา</p>}
              </section>
              <section className="profile-box">
                <h4>นัดหมายถัดไป / ส่งเวรล่าสุด</h4>
                <p className="text-sm text-gold-800">{nextAppt ? `${thDate(nextAppt.date, false)} ${String(nextAppt.time ?? "").slice(0, 5)} · ${str(nextAppt.purpose)}` : "ไม่มีนัดหมาย"}</p>
                {p.handovers[0] && <p className="mt-2 text-sm text-gold-700">ส่งเวร: {str(p.handovers[0].detail)} <span className="text-xs text-gold-500">({str(p.handovers[0].written_by)})</span></p>}
              </section>
              {p.contracts.length > 0 && <section className="profile-box md:col-span-2">
                <h4>สัญญาและแผนดูแล</h4>
                {p.contracts.map((c) => <p key={String(c.id)} className="text-sm text-gold-800">สัญญา {str(c.contract_no)} · ผู้ว่าจ้าง {str(c.employer_name)} · {num(c.monthly_fee)} บาท/เดือน · {str(c.status)}</p>)}
                {p.plans.map((c) => <p key={String(c.id)} className="text-sm text-gold-800">แผน {str(c.plan_name)} · ญาติ {str(c.relative_phone)}</p>)}
              </section>}
            </div>
          )}

          {tab === "สัญญาณชีพ" && (
            <div className="space-y-4">
              {id && <VitalPlanCard residentId={id} />}
              {!vitals.length && <p className="rounded-xl bg-cream-50 px-4 py-6 text-center text-sm text-gold-500">ยังไม่มีบันทึกสัญญาณชีพ</p>}
              {vitals.length > 0 && <>
                <p className="text-xs text-gold-500">แสดง {recent.length} ครั้งล่าสุด · เส้นประสีแดง = เกณฑ์ผิดปกติ</p>
                <div className="grid gap-4 lg:grid-cols-2">
                  <MiniChart title="ความดันโลหิต" unit="mmHg" series={[series("sys", "ตัวบน", "#8b6e3e"), series("dia", "ตัวล่าง", "#c9a96a")].filter((s) => s.points.length)} lines={[{ y: 180, label: "ตัวบน ≥180", tone: "critical" }, { y: 90, label: "ตัวบน <90", tone: "critical" }]} />
                  <MiniChart title="ชีพจร" unit="ครั้ง/นาที" series={[series("pr", "PR", "#8b6e3e")].filter((s) => s.points.length)} lines={limitLines("pr")} />
                  <MiniChart title="ออกซิเจนในเลือด" unit="%" series={[series("o2", "O2 Sat", "#3f7a5c")].filter((s) => s.points.length)} lines={limitLines("o2")} />
                  <MiniChart title="อุณหภูมิ" unit="°C" series={[series("bt", "BT", "#b4643a")].filter((s) => s.points.length)} lines={limitLines("bt")} />
                  <MiniChart title="น้ำตาลปลายนิ้ว" unit="mg/dL" series={[series("dtx", "DTX", "#6b5a9a")].filter((s) => s.points.length)} lines={limitLines("dtx")} />
                </div>
                <DataTable search={false} badgeCols={[4]} columns={["วันเวลา", "สัญญาณชีพ", "O2 Sat", "DTX", "ผลประเมิน", "ผู้บันทึก"]}
                  rows={[...vitals].reverse().map((x) => [thDate(x.at), str(x.row.vital_signs), str(x.row.o2_sat), str(x.row.dtx), LEVEL_TH[levelOf(evaluateVitals(x.v))], str(x.row.recorded_by ?? x.row.assignee)])} />
              </>}
            </div>
          )}

          {tab === "ยาและการให้ยา" && (
            <div className="space-y-5">
              <div><h4 className="profile-sub">รายการยาประจำตัว</h4>
                <DataTable search={false} columns={["ชื่อยา", "ข้อบ่งใช้", "ขนาด", "มื้อ", "คงเหลือ", "สถานะ"]} empty="ไม่มีรายการยา"
                  rows={p.meds.map((m) => [`${str(m.drug_name)}${m.source === "คลังศูนย์" ? " · [คลังศูนย์]" : " · [ญาตินำมา]"}`, str(m.indication), `${num(m.dose)} ${str(m.unit)}`, str(m.meals), `${num(m.stock)} ${str(m.unit)}`, m.on_hold ? "งดชั่วคราว" : str(m.status ?? "ปกติ")])} /></div>
              <div><h4 className="profile-sub !mb-0.5">ประวัติการเบิกยา</h4>
                <p className="mb-2 text-xs text-gold-500">เบิกยาจากตะกร้ายาของผู้รับบริการ (ให้ยาใน KinApp หรือเมนูเบิกยาใน KINmed) · เติมยา · เพิ่มยาใหม่ · เบิกจากคลังยากลาง · ใหม่สุดอยู่บน</p>
                <DataTable search={false} columns={["วันเวลา", "ผ่านมา", "ชื่อยา", "รายการ", "จำนวน", "คงเหลือ", "ผู้ทำรายการ", "หมายเหตุ", "สถานะเงิน"]} empty="ยังไม่มีประวัติการเบิกยา" minor={[1, 7]}
                  render={(_, col, v) => col === 3 ? <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${v.startsWith("เบิกออก") ? "bg-amber-50 text-amber-800" : v.startsWith("เบิกจากคลัง") ? "bg-sky-50 text-sky-800" : "bg-emerald-50 text-emerald-800"}`}>{v}</span> : undefined}
                  rows={medHistory} /></div>
              <div><h4 className="profile-sub">บันทึกการให้ยา (MAR)</h4>
                <p className="mb-2 text-xs text-gold-500">ให้ยาจาก KinApp แท็บให้ยา หรือ KINmed เมนูเบิกยา · ไม่ได้ให้ขึ้นพร้อมเหตุผล · ใหม่สุดอยู่บน</p>
                <DataTable search={false} columns={["วันเวลา", "มื้อ", "ยา", "จำนวน", "ผู้ให้ยา", "สถานะ"]} empty="ยังไม่มีบันทึกการให้ยา"
                  rows={mar} /></div>
              {p.packs.length > 0 && <details className="rounded-xl border border-cream-300 bg-white px-3 py-2"><summary className="cursor-pointer text-sm text-gold-700">ซองยาระบบเดิม (จัดซอง · ตรวจ QA) {p.packs.length} ซอง</summary>
                <div className="mt-2"><DataTable search={false} badgeCols={[6]} columns={["วันที่", "มื้อ", "รายการยา", "จัดโดย", "ตรวจ QA", "ผู้ให้ยา / เวลา", "สถานะ"]} empty="-"
                  actions={[{ label: "ดูรูปซอง", onClick: (i) => setPackPic({ id: String(p.packs[i].id), title: `รูปซองยา · มื้อ${str(p.packs[i].meal)} · ${thDate(p.packs[i].date as string, false)}` }) }]}
                  rows={p.packs.map((k) => [thDate(k.date, false), str(k.meal), str(k.items), str(k.packed_by), str(k.checked_by), k.given ? `${str(k.given_by)} · ${thDate(k.given_at)}` : "-", k.given ? "ให้ยาแล้ว" : k.qa_status === "ตรวจผ่าน" ? "ยังไม่ให้" : str(k.qa_status)])} /></div></details>}
            </div>
          )}

          {tab === "งานดูแลและนัดหมาย" && (
            <div className="space-y-5">
              <div><h4 className="profile-sub">นัดหมาย</h4>
                <DataTable search={false} columns={["วันที่", "เวลา", "วัตถุประสงค์", "ผู้ดูแล"]} empty="ไม่มีนัดหมาย"
                  rows={p.appts.map((a) => [thDate(a.date, false), String(a.time ?? "-").slice(0, 5), str(a.purpose), str(a.caregiver)])} /></div>
              <div><h4 className="profile-sub">งานดูแลประจำวัน</h4>
                <DataTable search={false} columns={["วันที่", "เวลา", "งาน", "ผู้รับผิดชอบ", "กะ", "สถานะ"]} empty="ไม่มีงานดูแล"
                  rows={[...p.daily.map((t) => [thDate(t.work_date, false), String(t.time ?? "-").slice(0, 5), str(t.task_name), str(t.assignee), str(t.shift), str(t.status)]),
                    ...p.tasks.map((t) => [thDate(t.date, false), String(t.time ?? "-").slice(0, 5), str(t.task_name), str(t.performed_by), str(t.category), str(t.status)])]} /></div>
            </div>
          )}

          {CLINICAL[tab] && id && <ClinicalPanel id={id} tab={CLINICAL[tab]} c={c} reload={reload} name={r.full_name} autoEdit={autoAdm && tab === "แรกรับ/ประเมิน"} onAutoDone={() => setAutoAdm(false)} onAide={() => setTab(NOTE_TABS[1])}
            needIntake={!!c && !c.admission && created >= INTAKE_SINCE && String(r.status ?? "").startsWith("เข้าอยู่")} onIntake={startAdm} />}

          {tab === "สมุดส่งเวร" && (
            <DataTable search={false} columns={["หัวข้อ", "รายละเอียด", "ผู้เขียน", "เวลา"]} empty="ไม่มีบันทึกส่งเวร"
              rows={p.handovers.map((h) => [str(h.topic_type), str(h.detail), str(h.written_by), str(h.written_at)])} />
          )}
        </div>
      )}
      {p && r && (() => {
        const adm = c?.admission?.data ?? {};
        const vit = [...vitals].reverse().slice(0, 5).map((x) => [thDate(x.at), str(x.row.vital_signs), str(x.row.o2_sat), str(x.row.dtx), str(x.row.recorded_by ?? x.row.done_by ?? x.src)]);
        // พิมพ์สรุปประวัติ: การให้ยาล่าสุด 6 รายการ (ระบบใหม่) ต่อด้วยซองยาระบบเดิม
        const marPrint = [...(p.withdrawals ?? []).filter((m) => !m.void_reason).slice(0, 6).map((m) => [str(m.at).slice(0, 10), str(m.meal), str(m.name), m.skip_reason ? `ไม่ได้ให้: ${str(m.skip_reason)}` : `${str(m.by)} ${str(m.at).slice(11)}`]),
          ...p.packs.slice(0, 6).map((k) => [thDate(k.date, false), str(k.meal), str(k.items), k.given ? `${str(k.given_by)} ${thDate(k.given_at)}` : "รอให้ยา"])].slice(0, 6);
        const nn = (c?.notes ?? []).filter((n) => n.kind === "nurse").slice(0, 5).map((n) => [n.at, `${n.title ? `${n.title} · ` : ""}${n.body ?? ""}`, n.author ?? "-"]);
        const probs = (c?.notes ?? []).filter((n) => n.kind === "problem" && n.status !== "Resolved").map((n) => `${n.title}${n.body ? ` · ${n.body}` : ""}`);
        const contact = adm.emergency_name ? `${adm.emergency_name}${adm.emergency_relation ? ` (${adm.emergency_relation})` : ""}${adm.emergency_phone ? ` ${adm.emergency_phone}` : ""}` : p.contracts[0] ? `${str(p.contracts[0].employer_name)}${p.contracts[0].employer_phone ? ` ${str(p.contracts[0].employer_phone)}` : ""}` : undefined;
        const admItems = ADMISSION_FIELDS.filter((f) => ["diagnosis", "allergy_drug", "mobility", "fall_risk", "diet_type", "diet_note", "devices"].includes(f.key) && adm[f.key]).map((f) => [f.label, adm[f.key]] as [string, string]);
        const lastText = last ? `${thDate(last.at)} · ${str(last.row.vital_signs)}${last.row.o2_sat ? ` · O₂ ${last.row.o2_sat}` : ""}${last.row.dtx && last.row.dtx !== "-" ? ` · DTX ${last.row.dtx}` : ""}` : undefined;
        const meds = activeMeds.map((m) => `${str(m.drug_name)} ${num(m.dose)} ${str(m.unit)} · ${str(m.meals)}`);
        const hn = String((r as Record<string, unknown>).hn ?? "") || undefined;
        return <>
          <PrintModal open={doc === "profile"} title="สรุปประวัติการดูแล" onClose={() => setDoc(null)}>
            <ProfileDoc name={r.full_name} hn={hn} age={r.age ? String(r.age) : undefined} room={r.room ?? undefined} branch={branchInfo(r.branch_name ?? "")} chronic={r.chronic_diseases ?? undefined}
              contact={contact} admission={admItems} vitals={vit} mar={marPrint} notes={nn} problems={probs} by={user?.name} />
          </PrintModal>
          <PrintModal open={doc === "referral"} title="ใบส่งต่อผู้รับบริการ" onClose={() => setDoc(null)}>
            <div className="mb-4 grid w-full max-w-[794px] gap-3 rounded-xl bg-white p-4 print-hide sm:grid-cols-2">
              <Field label="ส่งต่อไปยัง"><input value={ref.to} onChange={(e) => setRef({ ...ref, to: e.target.value })} placeholder="เช่น ห้องฉุกเฉิน รพ.ศิริราช" /></Field>
              <Field label="เหตุผลการส่งต่อ"><input value={ref.reason} onChange={(e) => setRef({ ...ref, reason: e.target.value })} placeholder="เช่น ไข้สูง 39.2 °C หายใจเหนื่อย" /></Field>
              <Field label="สรุปอาการและการดูแลที่ผ่านมา" className="sm:col-span-2"><textarea rows={2} value={ref.summary} onChange={(e) => setRef({ ...ref, summary: e.target.value })} /></Field>
            </div>
            <ReferralDoc name={r.full_name} hn={hn} age={r.age ? String(r.age) : undefined} branch={branchInfo(r.branch_name ?? "")} to={ref.to || "................................................"}
              reason={ref.reason || "-"} chronic={r.chronic_diseases ?? undefined} allergy={[adm.allergy_drug, adm.allergy_food].filter(Boolean).join(" · ") || undefined}
              diagnosis={adm.diagnosis} vitals={lastText} meds={meds} devices={adm.devices} summary={ref.summary || undefined} by={user?.name} />
          </PrintModal>
        </>;
      })()}
    </Modal>
    <MedPhotoModal open={!!packPic} title={packPic?.title ?? ""} items={packPic ? [{ kind: "pack", id: packPic.id, title: "รูปซองยาที่จัดเสร็จ" }] : []} onClose={() => setPackPic(null)} />
    </>
  );
}
