"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/Icon";
import { Field, Modal } from "@/components/ui";
import { ResidentPicker } from "../SearchSelect";
import { useApp } from "@/lib/app";
import { nowTh } from "@/lib/pharmacy";
import { evaluateVitals, flagText, implausible, levelOf, LEVEL_TH, LIMITS, parseVitals, vitalText } from "@/lib/vitals";

const BLANK = { bp: "", pr: "", rr: "", bt: "", o2: "", dtx: "", weight: "", height: "", note: "" };
const FIELDS: { k: keyof typeof BLANK; label: string; ph: string; mode?: "decimal" | "text" }[] = [
  { k: "bp", label: "BP ความดันโลหิต", ph: "เช่น 120/80", mode: "text" },
  { k: "pr", label: "PR ชีพจร (ครั้ง/นาที)", ph: "เช่น 76" },
  { k: "rr", label: "RR การหายใจ (ครั้ง/นาที)", ph: "เช่น 18" },
  { k: "bt", label: "BT อุณหภูมิ (°C)", ph: "เช่น 36.6" },
  { k: "o2", label: "O2 Sat ออกซิเจน (%)", ph: "เช่น 98" },
  { k: "dtx", label: "DTX น้ำตาล (mg/dL)", ph: "เช่น 110" },
  { k: "weight", label: "น้ำหนัก (กก.)", ph: "เช่น 58" },
  { k: "height", label: "ส่วนสูง (ซม.)", ph: "เช่น 155" },
];

/** อ่านค่าจากรูปเปิดใช้หรือยัง (ถามเซิร์ฟเวอร์ครั้งเดียวต่อการเปิดหน้า) */
let aiReady: Promise<boolean> | null = null;
const aiEnabled = () => (aiReady ??= fetch("/api/vitals/read", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => !!d?.enabled).catch(() => false));
/** ย่อรูปให้ด้านยาวไม่เกิน 1280px (ตัวเลขบนจอยังอ่านชัด แต่ส่งเร็ว) */
const shrink = (file: File) => new Promise<string>((resolve, reject) => {
  const url = URL.createObjectURL(file), img = new Image();
  img.onload = () => {
    const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url); resolve(c.toDataURL("image/jpeg", 0.85));
  };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("เปิดรูปนี้ไม่ได้")); };
  img.src = url;
});
type AiRead = { readable: boolean; device: string; bp_sys: number | null; bp_dia: number | null; pulse: number | null; spo2: number | null; temp_c: number | null; glucose_mg_dl: number | null; weight_kg: number | null; note: string };

/**
 * บันทึกสัญญาณชีพ ใช้ทั้ง KinApp และระบบจัดการ
 * ประเมินค่าทันทีขณะกรอก · บันทึกแล้ว server สร้างแจ้งเตือนให้พยาบาลเองถ้าค่าเกินเกณฑ์
 * onSave ได้แถวตามคอลัมน์ของบันทึกสุขภาพ (ชุดข้อมูล "health")
 */
export default function VitalsDialog({ open, residents, resident, recorder, onClose, onSave }: {
  open: boolean; residents: string[]; resident?: string; recorder: string;
  onClose: () => void; onSave: (row: string[]) => void;
}) {
  const { toast } = useApp();
  const [who, setWho] = useState("");
  const [f, setF] = useState(BLANK);
  // ค่าที่เป็นไปไม่ได้: กดบันทึกครั้งแรกขึ้นเตือนให้ตรวจ กดอีกครั้งจึงบันทึก
  const [doubt, setDoubt] = useState(false);
  useEffect(() => { if (open) { setWho(resident ?? ""); setF(BLANK); setDoubt(false); setAi(null); } }, [open, resident]);
  // ถ่ายรูปหน้าจอเครื่องวัด → ระบบอ่านตัวเลขมากรอกให้ · พยาบาลต้องตรวจกับหน้าจอเครื่องก่อนบันทึกเอง
  const [aiOn, setAiOn] = useState(false);
  const [reading, setReading] = useState(false);
  const [ai, setAi] = useState<{ keys: string[]; note: string } | null>(null);
  const cam = useRef<HTMLInputElement>(null);
  const pick = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) aiEnabled().then(setAiOn); }, [open]);
  const readPhoto = async (file: File) => {
    setReading(true); setAi(null);
    try {
      const r = await fetch("/api/vitals/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: await shrink(file) }) });
      const d = (await r.json().catch(() => ({}))) as Partial<AiRead> & { error?: string };
      if (!r.ok) { toast(d.error || "อ่านค่าไม่สำเร็จ · กรอกค่าเองแทน"); return; }
      const n = (v: number | null | undefined, dp = 0) => (typeof v === "number" && Number.isFinite(v) ? (dp ? v.toFixed(dp) : String(Math.round(v))) : "");
      const got: Partial<typeof BLANK> = {
        bp: d.bp_sys && d.bp_dia ? `${n(d.bp_sys)}/${n(d.bp_dia)}` : "", pr: n(d.pulse), o2: n(d.spo2),
        bt: n(d.temp_c, 1), dtx: n(d.glucose_mg_dl), weight: n(d.weight_kg, d.weight_kg && d.weight_kg % 1 ? 1 : 0),
      };
      const keys = Object.entries(got).filter(([, v]) => v).map(([k]) => k);
      if (!d.readable || !keys.length) { toast(d.note || "อ่านตัวเลขจากรูปไม่ได้ · ถ่ายใหม่ให้หน้าจอชัด หรือกรอกเอง"); return; }
      setF((cur) => ({ ...cur, ...Object.fromEntries(keys.map((k) => [k, got[k as keyof typeof got]])) }));
      setDoubt(false); setAi({ keys, note: d.note ?? "" });
    } catch (e) { toast((e as Error).message || "อ่านค่าไม่สำเร็จ"); }
    finally { setReading(false); }
  };
  const parsed = useMemo(() => parseVitals(vitalText(f), f.o2, f.dtx), [f]);
  const flags = useMemo(() => evaluateVitals(parsed), [parsed]);
  const odd = implausible(parsed);
  const level = levelOf(flags);
  const filled = Object.entries(f).some(([k, v]) => k !== "note" && v.trim());

  const save = () => {
    if (!who) return toast("กรุณาเลือกผู้รับบริการ");
    if (!filled) return toast("กรุณากรอกสัญญาณชีพอย่างน้อย 1 ช่อง");
    if (f.bp && !/^\d{2,3}\s*\/\s*\d{2,3}$/.test(f.bp.trim())) return toast("กรุณากรอกความดันเป็นตัวบน/ตัวล่าง เช่น 120/80");
    const bad = (["pr", "rr", "bt", "o2", "dtx", "weight", "height"] as const).find((k) => f[k].trim() && Number.isNaN(Number(f[k])));
    if (bad) return toast(`กรุณากรอก${FIELDS.find((x) => x.k === bad)!.label.split(" (")[0]}เป็นตัวเลข`);
    if (odd.length && !doubt) { setDoubt(true); return; }
    const wh = [f.weight && `${f.weight} กก.`, f.height && `${f.height} ซม.`].filter(Boolean).join(" / ");
    onSave([nowTh(), who, vitalText({ bp: f.bp.replace(/\s/g, ""), pr: f.pr, rr: f.rr, bt: f.bt }) || "-", f.o2 ? `${f.o2}%` : "-", f.dtx || "-", wh || "-", "-", f.note.trim() || "-", recorder]);
    onClose();
    toast(level === "normal" ? "บันทึกสัญญาณชีพแล้ว" : `บันทึกแล้ว · ค่า${LEVEL_TH[level]} ระบบแจ้งเตือนพยาบาลแล้ว`);
  };

  return (
    <Modal open={open} title="บันทึกสัญญาณชีพ" onClose={onClose}
      footer={<><button className="btn-soft" onClick={onClose}>ยกเลิก</button><button className={level === "critical" ? "btn-danger" : "btn-primary"} onClick={save}>{doubt && odd.length ? "ยืนยันค่าที่กรอก" : level === "normal" ? "บันทึก" : "บันทึกและแจ้งพยาบาล"}</button></>}>
      <div className="space-y-4">
        <Field label="ผู้รับบริการ" required><ResidentPicker names={residents} value={who} onChange={setWho} /></Field>
        {aiOn && <div className="vitals-ai">
          <p className="vitals-ai-h">{reading ? "กำลังอ่านค่าจากรูป…" : "อ่านค่าจากรูปหน้าจอเครื่องวัด · กรอกให้อัตโนมัติ"}</p>
          {/* ถ่ายรูป = เปิดกล้องหลังทันที (มือถือ) · เลือกรูป = รูปที่ถ่ายไว้แล้วในเครื่อง */}
          <div className="vitals-ai-btns">
            <button type="button" className="vitals-ai-go" disabled={reading} onClick={() => cam.current?.click()}><Icon name="camera" className="h-5 w-5" /> ถ่ายรูป</button>
            <button type="button" className="vitals-ai-pick" disabled={reading} onClick={() => pick.current?.click()}><Icon name="download" className="h-5 w-5 rotate-180" /> เลือกรูปในเครื่อง</button>
          </div>
          <input ref={cam} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) readPhoto(file); }} />
          <input ref={pick} type="file" accept="image/*" hidden onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) readPhoto(file); }} />
          {ai && <p className="vitals-ai-note" role="status">อ่านจากรูปแล้ว {ai.keys.length} ช่อง (ไฮไลต์สีทอง) · <b>ตรวจตัวเลขกับหน้าจอเครื่องก่อนบันทึก</b>{ai.note ? ` · ${ai.note}` : ""}</p>}
        </div>}
        <div className="grid grid-cols-2 gap-3">
          {FIELDS.map((x) => (
            <Field key={x.k} label={x.label}>
              <input inputMode={x.mode ?? "decimal"} className={ai?.keys.includes(x.k) ? "is-ai" : undefined} value={f[x.k]} placeholder={x.ph} onChange={(e) => { setF({ ...f, [x.k]: e.target.value }); setDoubt(false); if (ai) setAi({ ...ai, keys: ai.keys.filter((k) => k !== x.k) }); }} />
            </Field>
          ))}
        </div>
        <Field label="อาการ / หมายเหตุ"><textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="เช่น ทานอาหารได้ดี หลับสนิท" /></Field>
        {doubt && odd.length > 0 && (
          <p role="alert" className="form-error"><Icon name="alert" className="h-4 w-4 shrink-0" />
            <span>ค่านี้ไม่น่าเป็นไปได้: {odd.map((k) => `${LIMITS[k].label.split(" (")[0]} ${parsed[k]} ${LIMITS[k].unit}`).join(" · ")} · ตรวจตัวเลขอีกครั้ง ถ้าถูกต้องกด &quot;ยืนยันค่าที่กรอก&quot;</span></p>
        )}
        {filled && (
          <div className={`vitals-verdict is-${level}`} role="status">
            <p className="flex items-center gap-2 font-semibold"><Icon name={level === "normal" ? "check" : "alert"} className="h-4 w-4" />ผลประเมิน: {LEVEL_TH[level]}</p>
            {flags.length > 0 && <ul className="mt-1.5 space-y-0.5">{flags.map((x) => <li key={x.key}>• {flagText(x)}</li>)}</ul>}
            {level !== "normal" && <p className="mt-1.5 text-xs opacity-80">บันทึกแล้วระบบจะแจ้งเตือนพยาบาลในสาขาทันที ควรวัดซ้ำและรายงานพยาบาลด้วยตัวเอง</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}
