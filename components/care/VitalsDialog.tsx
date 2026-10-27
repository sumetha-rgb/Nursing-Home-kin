"use client";
import { useEffect, useMemo, useState } from "react";
import Icon from "@/components/Icon";
import { Field, Modal, Select } from "@/components/ui";
import { useApp } from "@/lib/app";
import { nowTh } from "@/lib/pharmacy";
import { evaluateVitals, flagText, levelOf, LEVEL_TH, parseVitals, vitalText } from "@/lib/vitals";

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
  useEffect(() => { if (open) { setWho(resident ?? ""); setF(BLANK); } }, [open, resident]);
  const flags = useMemo(() => evaluateVitals(parseVitals(vitalText(f), f.o2, f.dtx)), [f]);
  const level = levelOf(flags);
  const filled = Object.entries(f).some(([k, v]) => k !== "note" && v.trim());

  const save = () => {
    if (!who) return toast("กรุณาเลือกผู้รับบริการ");
    if (!filled) return toast("กรุณากรอกสัญญาณชีพอย่างน้อย 1 ช่อง");
    if (f.bp && !/^\d{2,3}\s*\/\s*\d{2,3}$/.test(f.bp.trim())) return toast("กรุณากรอกความดันเป็นตัวบน/ตัวล่าง เช่น 120/80");
    const bad = (["pr", "rr", "bt", "o2", "dtx", "weight", "height"] as const).find((k) => f[k].trim() && Number.isNaN(Number(f[k])));
    if (bad) return toast(`กรุณากรอก${FIELDS.find((x) => x.k === bad)!.label.split(" (")[0]}เป็นตัวเลข`);
    const wh = [f.weight && `${f.weight} กก.`, f.height && `${f.height} ซม.`].filter(Boolean).join(" / ");
    onSave([nowTh(), who, vitalText({ bp: f.bp.replace(/\s/g, ""), pr: f.pr, rr: f.rr, bt: f.bt }) || "-", f.o2 ? `${f.o2}%` : "-", f.dtx || "-", wh || "-", "-", f.note.trim() || "-", recorder]);
    onClose();
    toast(level === "normal" ? "บันทึกสัญญาณชีพแล้ว" : `บันทึกแล้ว · ค่า${LEVEL_TH[level]} ระบบแจ้งเตือนพยาบาลแล้ว`);
  };

  return (
    <Modal open={open} title="บันทึกสัญญาณชีพ" onClose={onClose}
      footer={<><button className="btn-soft" onClick={onClose}>ยกเลิก</button><button className={level === "critical" ? "btn-danger" : "btn-primary"} onClick={save}>{level === "normal" ? "บันทึก" : "บันทึกและแจ้งพยาบาล"}</button></>}>
      <div className="space-y-4">
        <Field label="ผู้รับบริการ" required><Select options={residents} placeholder="-- เลือกผู้รับบริการ --" value={who} onChange={setWho} /></Field>
        <div className="grid grid-cols-2 gap-3">
          {FIELDS.map((x) => (
            <Field key={x.k} label={x.label}>
              <input inputMode={x.mode ?? "decimal"} value={f[x.k]} placeholder={x.ph} onChange={(e) => setF({ ...f, [x.k]: e.target.value })} />
            </Field>
          ))}
        </div>
        <Field label="อาการ / หมายเหตุ"><textarea rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="เช่น ทานอาหารได้ดี หลับสนิท" /></Field>
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
