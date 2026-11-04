"use client";
import { Modal, StatusBadge } from "../ui";
import { evaluateVitals, LEVEL_TH, levelOf, LIMITS, parseVitals, Vitals } from "@/lib/vitals";

const has = (v?: string) => !!v && v.trim() !== "" && v.trim() !== "-";

/**
 * บันทึกสุขภาพ 1 ครั้ง แบบอ่าน: หัวสรุป (ผู้รับบริการ วันเวลา ผู้บันทึก ผลประเมิน) และการ์ดค่าสัญญาณชีพ
 *  ค่าเฝ้าระวังขึ้นสีส้ม ผิดปกติขึ้นสีแดง ตามเกณฑ์ใน lib/vitals.ts
 *  row = แถวรายงานสุขภาพ [วันเวลา, ชื่อ, สัญญาณชีพ, O2, DTX, น้ำหนัก/ส่วนสูง, ข้อมูลอื่น, โน้ต, ผู้บันทึก]
 */
export default function VitalsView({ row, onClose, onProfile }: { row: string[] | null; onClose: () => void; onProfile?: () => void }) {
  const v: Vitals = row ? parseVitals(row[2], row[3], row[4]) : {};
  const flags = evaluateVitals(v);
  const level = levelOf(flags);
  const flagOf = (k: keyof Vitals) => flags.find((f) => f.key === k);
  const cards: { k: keyof Vitals; label: string; value?: string }[] = [
    { k: "sys", label: "ความดันโลหิต", value: v.sys !== undefined ? `${v.sys}/${v.dia ?? "-"}` : undefined },
    { k: "pr", label: "ชีพจร" }, { k: "rr", label: "การหายใจ" }, { k: "bt", label: "อุณหภูมิ" }, { k: "o2", label: "ออกซิเจน (O2 Sat)" }, { k: "dtx", label: "น้ำตาลปลายนิ้ว (DTX)" },
  ];
  return (
    <Modal open={!!row} wide title="บันทึกสุขภาพ" onClose={onClose}
      footer={<>{onProfile && <button className="btn-soft" onClick={onProfile}>ประวัติผู้รับบริการ</button>}<button className="btn-primary" onClick={onClose}>ปิด</button></>}>
      {row && <div className="space-y-5">
        <div className="cv-head">
          <div className="min-w-0">
            <p className="text-xs text-gold-500">{row[0]} · บันทึกโดย {has(row[8]) ? row[8] : "-"}</p>
            <h3 className="truncate text-lg font-semibold text-gold-900">{row[1]}</h3>
          </div>
          <div className="text-right"><StatusBadge value={LEVEL_TH[level]} /></div>
        </div>
        {flags.length > 0 && <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {flags.map((f) => <li key={f.key} className={f.level === "critical" ? "font-semibold text-red-700" : ""}>{f.label} {f.value} {f.unit} · {f.note}</li>)}
        </ul>}
        <div className="vv-grid">
          {cards.map((c) => {
            const f = flagOf(c.k) ?? (c.k === "sys" ? flagOf("dia") : undefined);
            const raw = c.value ?? (v[c.k] !== undefined ? String(v[c.k]) : undefined);
            return (
              <div key={c.k} className={`vv-card ${f ? `is-${f.level}` : ""}`}>
                <span>{c.label}</span>
                <b>{raw ?? "-"}</b>
                <small>{raw ? `${LIMITS[c.k].unit}${f ? ` · ${f.level === "critical" ? "ผิดปกติ" : "เฝ้าระวัง"}` : " · ปกติ"}` : "ไม่ได้วัด"}</small>
              </div>
            );
          })}
        </div>
        <dl className="cv-group-plain">
          <div><dt>น้ำหนัก / ส่วนสูง</dt><dd>{has(row[5]) ? row[5] : "-"}</dd></div>
          <div><dt>ข้อมูลอื่น</dt><dd>{has(row[6]) ? row[6] : "-"}</dd></div>
          <div className="cv-wide"><dt>โน้ต / อาการ</dt><dd>{has(row[7]) ? row[7] : "-"}</dd></div>
          <div className="cv-wide"><dt>ข้อความที่บันทึก</dt><dd className="text-gold-600">{has(row[2]) ? row[2] : "-"}</dd></div>
        </dl>
      </div>}
    </Modal>
  );
}
