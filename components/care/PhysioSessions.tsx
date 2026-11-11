"use client";
import { useState } from "react";
import { Modal } from "../ui";
import { PhysioHistory, photoUrl, VITAL_RANGE, Vitals } from "@/lib/physio";
import { EditNote } from "./PhysioRecord";

/** สัญญาณชีพเป็นป้ายสั้น ๆ · ค่านอกช่วงที่เป็นไปได้ = สีแดง */
const VITAL_PILLS: { k: keyof Vitals; label: string; unit: string }[] = [
  { k: "bw", label: "น้ำหนัก", unit: "kg" }, { k: "ht", label: "ส่วนสูง", unit: "cm" }, { k: "bmi", label: "BMI", unit: "" },
  { k: "bt", label: "อุณหภูมิ", unit: "°C" }, { k: "pr", label: "ชีพจร", unit: "/นาที" }, { k: "rr", label: "หายใจ", unit: "/นาที" }, { k: "o2", label: "O₂", unit: "%" },
];
const odd = (k: keyof Vitals, v?: number) => { const r = VITAL_RANGE[k]; return v != null && !!r && (v < r[0] || v > r[1]); };
/** ระดับปวด: 0–3 น้อย · 4–6 ปานกลาง · 7–10 มาก */
const painTone = (p: string) => (Number(p) >= 7 ? "is-hi" : Number(p) >= 4 ? "is-mid" : "is-lo");

/**
 * บันทึกกายภาพทีละครั้งแบบการ์ด (อ่านง่ายทั้งคอมและมือถือ) · ใช้ร่วมกัน: โปรไฟล์ผู้รับบริการ · หน้าต่างประวัติ · KinApp
 *  หัวการ์ด = ครั้งที่ + วันเวลา + ผู้บันทึก · แถบสรุป = เวลาทำ ปวด การเคลื่อนไหว กิจกรรม · สัญญาณชีพ · บันทึกการตรวจรักษา · รูป · แก้ไขได้ภายใน 7 วัน
 */
export default function PhysioSessions({ items, onEdit, empty = "ยังไม่มีบันทึกกายภาพ" }: { items: PhysioHistory[] | null; onEdit?: (h: PhysioHistory) => void; empty?: string }) {
  const [zoom, setZoom] = useState<string | null>(null);
  if (!items) return <p className="pk-empty">กำลังโหลด…</p>;
  if (!items.length) return <p className="pk-empty">{empty}</p>;
  return (
    <>
      <ol className="ps-list">{items.map((h) => {
        const m = (h.title ?? "").match(/^(.*?)\s*ครั้งที่\s*(\d+)\/(\d+)\s*$/);
        const v = h.vitals ?? {};
        const pills = VITAL_PILLS.filter((x) => v[x.k] != null);
        const bp = v.sys || v.dia;
        const tx = [["อาการสำคัญ", h.cc], ["ตรวจร่างกาย", h.pe], ["วินิจฉัย", h.dx], ["แผนการรักษา", h.plan]].filter(([, x]) => x) as [string, string][];
        return (
          <li key={h.id} className="ps-card">
            <header className="ps-head">
              <span className="ps-no">{m ? <><small>ครั้งที่</small><b>{m[2]}</b><small>/{m[3]}</small></> : <b>•</b>}</span>
              <div className="ps-title"><b>{m ? m[1] : h.title ?? "กายภาพ"}</b><span>{h.at}{h.author ? ` · ${h.author}` : ""}</span></div>
            </header>

            <div className="ps-tags">
              {h.checkin && <span className="ps-tag">⏱ {h.checkin}–{h.done}{h.minutes != null ? ` · ${h.minutes} นาที` : ""}</span>}
              {!h.checkin && h.minutes != null && <span className="ps-tag">⏱ {h.minutes} นาที</span>}
              {h.pain && <span className={`ps-tag ps-pain ${painTone(h.pain)}`}>ปวด {h.pain}/10</span>}
              {h.mobility && <span className="ps-tag">{h.mobility}</span>}
              {(h.activities ?? []).map((a) => <span key={a} className="ps-tag is-soft">{a}</span>)}
            </div>

            {(pills.length > 0 || bp) && <div className="ps-vit" aria-label="สัญญาณชีพ">
              {pills.map((x) => <span key={x.k} className={odd(x.k, v[x.k]) ? "is-odd" : ""}><small>{x.label}</small><b>{v[x.k]}</b>{x.unit && <em>{x.unit}</em>}</span>)}
              {bp ? <span className={odd("sys", v.sys) || odd("dia", v.dia) ? "is-odd" : ""}><small>ความดัน</small><b>{v.sys ?? "-"}/{v.dia ?? "-"}</b><em>mmHg</em></span> : null}
            </div>}

            {tx.length > 0 ? <dl className="ps-tx">{tx.map(([k, x]) => <div key={k}><dt>{k}</dt><dd>{x}</dd></div>)}</dl>
              : h.body ? <p className="ps-body">{h.body}</p> : null}

            {h.visit_id && <div className="pk-thumbs">
              <button type="button" onClick={() => setZoom(photoUrl(h.visit_id!, "checkin"))}><img src={photoUrl(h.visit_id, "checkin")} alt={`รูปเช็คอิน ${h.title ?? ""}`} loading="lazy" /><span>เช็คอิน</span></button>
              {Array.from({ length: h.work_n ?? 0 }, (_, i) => <button key={i} type="button" onClick={() => setZoom(photoUrl(h.visit_id!, "work", i))}><img src={photoUrl(h.visit_id!, "work", i)} alt={`รูปงาน ${i + 1} ${h.title ?? ""}`} loading="lazy" /><span>รูปงาน{(h.work_n ?? 0) > 1 ? ` ${i + 1}` : ""}</span></button>)}
            </div>}

            {onEdit && <EditNote h={h} onEdit={() => onEdit(h)} />}
          </li>
        );
      })}</ol>
      <Modal open={!!zoom} title="รูปภาพ" onClose={() => setZoom(null)} footer={<button className="btn-primary" onClick={() => setZoom(null)}>ปิด</button>}>
        {zoom && <img src={zoom} alt="รูปกายภาพ" className="pk-zoom" />}
      </Modal>
    </>
  );
}
