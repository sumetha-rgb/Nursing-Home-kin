"use client";
import { useEffect, useMemo, useState } from "react";
import Icon from "../Icon";
import { Modal, Select } from "../ui";
import { usePriceList } from "@/lib/usePrices";
import { RoomInfo, roomKey, ROOM_STATUSES } from "@/lib/rooms";
import { PriceItem } from "@/lib/priceList";

/**
 * สร้าง / แก้ไขห้องพัก
 * ประเภทห้องเลือกจากใบราคา (หมวด RM) → ตั้งจำนวนเตียงและค่าห้องให้ · ค่าห้องแก้ที่หน้าราคาสินค้าและบริการเท่านั้น
 * ชั้น/โซนเลือกจากที่มีในสาขา (กันพิมพ์ไม่ตรงกัน) · สร้างหลายห้องพร้อมกันได้ เช่น 101 ถึง 110
 * แถวที่ส่งออก: [เลขห้อง, สาขา, ประเภท, เตียง, ค่าห้อง, สถานะ, หมายเหตุ, ชั้น/โซน]
 */
type Props = {
  open: boolean;
  /** แถวเดิม (แก้ไข) หรือค่าตั้งต้น (สร้างจากข้อมูลเดิม) */
  row?: string[];
  editing?: RoomInfo;
  branches: string[];
  /** ผู้บริหารเลือกสาขาได้ · ผู้จัดการสาขาเห็นเป็นชื่อสาขา */
  pickBranch: boolean;
  all: RoomInfo[];
  onClose: () => void;
  onSave: (rows: string[][]) => void;
};

const money = (n: number) => n.toLocaleString("th-TH");
/** จำนวนเตียงตามชื่อประเภท: "ห้องรวม 6 ท่าน" = 6 · ห้องคู่/Twin = 2 · อื่น ๆ = 1 */
const bedsOf = (name: string) => Number(name.match(/(\d+)\s*(ท่าน|คน|เตียง)/)?.[1]) || (/คู่|twin/i.test(name) ? 2 : 1);
const monthOf = (x: PriceItem) => x.rates.find((r) => r.unit === "เดือน" && !/โปร/.test(r.label ?? ""))?.price ?? x.rates.find((r) => r.unit === "เดือน")?.price ?? 0;
const num = (s?: string) => Number(String(s ?? "").replace(/[^\d.]/g, "")) || 0;
/** เลขห้องช่วง: "A101" ถึง "110" → A101 … A110 (ใช้ตัวเลขท้ายสุด) */
function range(from: string, to: string): string[] {
  const m = from.trim().match(/^(.*?)(\d+)$/), n = to.trim().match(/(\d+)$/);
  if (!m || !n) return [];
  const a = Number(m[2]), b = Number(n[1]);
  if (!(b > a) || b - a > 49) return [];
  return Array.from({ length: b - a + 1 }, (_, k) => `${m[1]}${String(a + k).padStart(m[2].length, "0")}`);
}

export default function RoomDialog({ open, row, editing, branches, pickBranch, all, onClose, onSave }: Props) {
  const prices = usePriceList();
  const types = useMemo(() => prices.filter((x) => x.cat === "RM" && x.active !== false).map((x) => ({ code: x.code, name: x.name, month: monthOf(x), beds: bedsOf(x.name) })), [prices]);
  const [no, setNo] = useState("");
  const [branch, setBranch] = useState("");
  const [floor, setFloor] = useState("");
  const [newFloor, setNewFloor] = useState(false);
  const [code, setCode] = useState("");
  const [beds, setBeds] = useState(1);
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [multi, setMulti] = useState(false);
  const [to, setTo] = useState("");
  const [tried, setTried] = useState(false);

  // แบบเดิมที่ไม่ตรงกับใบราคา (ห้องเก่า) ยังเลือกไว้ได้ ไม่บังคับเปลี่ยนตอนแก้ไข
  // ชื่อไม่ตรงกับใบราคา = แบบเดิม (ไม่จับคู่ตามราคาแล้วเปลี่ยนชื่อให้เอง)
  const legacy = editing && row?.[2] && row[2] !== "-" && !types.some((t) => t.name === row[2]) ? { code: "old", name: row[2], month: num(row[4]), beds: num(row[3]) || 1 } : null;
  const cards = legacy ? [...types, legacy] : types;

  useEffect(() => {
    if (!open) return;
    const r = row ?? [];
    setNo(r[0] ?? ""); setBranch(r[1] || (branches.length === 1 ? branches[0] : "")); setFloor((r[7] ?? "").trim()); setNewFloor(false);
    const t = r[2] ? types.find((x) => x.name === r[2]) : undefined;
    setCode(t?.code ?? (r[2] && r[2] !== "-" && editing ? "old" : ""));
    setBeds(num(r[3]) || t?.beds || 1);
    setNote((r[6] ?? "")); setShowNote(!!(r[6] ?? "").trim());
    setMulti(false); setTo(""); setTried(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const type = cards.find((t) => t.code === code);
  const floors = [...new Set(all.filter((r) => r.branch === branch && r.floor).map((r) => r.floor))].sort((a, b) => a.localeCompare(b, "th", { numeric: true }));
  const clean = no.trim().replace(/\s+/g, " ");
  const list = !editing && multi ? range(clean, to) : clean ? [clean] : [];
  const taken = (x: string) => all.some((r) => r.i !== editing?.i && r.branch === branch && roomKey(r.no) === roomKey(x));
  const dup = list.filter(taken);
  const make = list.filter((x) => !taken(x));
  const minBeds = editing?.people.length ?? 0;

  const problem =
    !branch ? "เลือกสาขา" :
    !clean ? "กรอกเลขห้อง" :
    multi && !editing && !list.length ? "ช่วงเลขห้องไม่ถูกต้อง (ใช้เลขท้าย เช่น 101 ถึง 110 ไม่เกิน 50 ห้อง)" :
    !type ? "เลือกประเภทห้อง" :
    !make.length ? (multi ? "ทุกห้องในช่วงนี้มีอยู่แล้ว" : `มีห้อง ${clean} ในสาขา${branch}แล้ว`) :
    beds < Math.max(1, minBeds) ? `ห้องนี้มีผู้พักอยู่ ${minBeds} คน ลดเตียงต่ำกว่านี้ไม่ได้` :
    editing && editing.people.length && editing.branch !== branch ? "ห้องที่มีผู้พักอยู่ย้ายไปสาขาอื่นไม่ได้" : "";

  const save = () => {
    setTried(true);
    if (problem || !type) return;
    const status = editing?.status || row?.[5] || ROOM_STATUSES[0];
    onSave(make.map((x) => [x, branch, type.name, String(beds), type.month ? String(type.month) : "", status, note.trim(), floor.trim()]));
  };

  const summary = type && make.length
    ? `${make.length > 1 ? `${make.length} ห้อง (${make[0]}–${make[make.length - 1]})` : `ห้อง ${make[0]}`}${floor ? ` · ${floor}` : ""} · ${type.name} ${beds} เตียง${type.month ? ` · ${money(type.month)}/เดือน` : ""}`
    : "";

  return (
    <Modal open={open} wide title={editing ? `แก้ไขห้อง ${editing.no}` : `สร้างห้องพัก${!pickBranch && branch ? ` · สาขา${branch}` : ""}`} onClose={onClose}
      footer={<div className="rd-foot">
        <p className={tried && problem ? "is-bad" : ""}>{tried && problem ? problem : summary || "เลือกเลขห้องและประเภทห้อง"}</p>
        <button type="button" className="btn-soft" onClick={onClose}>ยกเลิก</button>
        <button type="button" className="btn-primary" onClick={save}>{editing ? "บันทึก" : make.length > 1 ? `สร้าง ${make.length} ห้อง` : "สร้างห้อง"}</button>
      </div>}>
      <div className="rd">
        {pickBranch && <label className="rd-f"><span className="label">สาขา</span>
          <Select aria-label="สาขา" options={branches} value={branch} onChange={(v) => { setBranch(v); setFloor(""); }} /></label>}

        <div className="rd-row">
          <label className="rd-f"><span className="label">เลขห้อง <i>*</i></span>
            <input value={no} onChange={(e) => setNo(e.target.value)} placeholder="เช่น 101" maxLength={20} aria-invalid={!multi && !!clean && taken(clean)} />
            {!multi && clean && taken(clean) && <small className="rd-warn">มีห้อง {clean} ในสาขานี้แล้ว</small>}
            {!editing && <span className="rd-multi">
              <label><input type="checkbox" checked={multi} onChange={(e) => setMulti(e.target.checked)} /> สร้างหลายห้อง</label>
              {multi && <>ถึง <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="110" aria-label="ถึงเลขห้อง" maxLength={20} /></>}
            </span>}
            {multi && list.length > 0 && <small className={dup.length ? "rd-warn" : "rd-hint"}>{make.length} ห้อง{dup.length ? ` · ข้ามห้องที่มีแล้ว ${dup.join(", ")}` : ""}</small>}
          </label>

          <div className="rd-f"><span className="label">ชั้น/โซน</span>
            <div className="pl-chips is-pick" role="radiogroup" aria-label="ชั้น/โซน">
              <button type="button" role="radio" aria-checked={!floor && !newFloor} aria-pressed={!floor && !newFloor} onClick={() => { setFloor(""); setNewFloor(false); }}>ไม่ระบุ</button>
              {floors.map((f) => <button key={f} type="button" role="radio" aria-checked={floor === f && !newFloor} aria-pressed={floor === f && !newFloor} onClick={() => { setFloor(f); setNewFloor(false); }}>{f}</button>)}
              <button type="button" role="radio" aria-checked={newFloor} aria-pressed={newFloor} onClick={() => { setNewFloor(true); setFloor(""); }}><Icon name="plus" className="h-3 w-3" />ใหม่</button>
            </div>
            {newFloor && <input className="mt-2" autoFocus value={floor} onChange={(e) => setFloor(e.target.value)} placeholder="เช่น ชั้น 1 หรือ ปีก A" maxLength={30} aria-label="ชื่อชั้นหรือโซนใหม่" />}
          </div>
        </div>

        <div className="rd-f"><span className="label">ประเภทห้อง <i>*</i> <small>ราคาตามหน้าราคาสินค้าและบริการ</small></span>
          <div className="rd-types" role="radiogroup" aria-label="ประเภทห้อง">
            {cards.map((t) => (
              <button key={t.code} type="button" role="radio" aria-checked={code === t.code} className={`rd-type ${t.code === "old" ? "is-old" : ""}`}
                onClick={() => { setCode(t.code); if (t.code !== "old") setBeds(Math.max(t.beds, minBeds)); }}>
                <b>{t.name}</b>
                <small>{t.code === "old" ? "แบบเดิม ไม่ตรงกับใบราคา" : `${t.code} · ${t.beds} เตียง`}</small>
                <span>{t.month ? <>{money(t.month)} <i>/เดือน</i></> : "ยังไม่ระบุราคา"}</span>
                {code === t.code && <Icon name="check" className="rd-ok h-4 w-4" />}
              </button>
            ))}
          </div>
          {!types.length && <small className="rd-warn">ยังไม่มีห้องพักในหน้าราคาสินค้าและบริการ เพิ่มก่อนจึงสร้างห้องได้</small>}
        </div>

        <div className="rd-row">
          <div className="rd-f"><span className="label">จำนวนเตียง</span>
            <div className="rd-step">
              <button type="button" aria-label="ลดเตียง" disabled={beds <= Math.max(1, minBeds)} onClick={() => setBeds(beds - 1)}>−</button>
              <b aria-live="polite">{beds}</b>
              <button type="button" aria-label="เพิ่มเตียง" disabled={beds >= 20} onClick={() => setBeds(beds + 1)}>+</button>
              <small>{type && type.code !== "old" && beds !== type.beds ? `ประเภทนี้ปกติ ${type.beds} เตียง` : "ตั้งตามประเภทห้อง แก้ได้"}{minBeds ? ` · มีผู้พัก ${minBeds} คน` : ""}</small>
            </div>
          </div>
          <div className="rd-f">
            {showNote ? <><span className="label">หมายเหตุ</span><textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ใกล้ห้องพยาบาล มีห้องน้ำในตัว" maxLength={200} aria-label="หมายเหตุ" /></>
              : <button type="button" className="rd-addnote" onClick={() => setShowNote(true)}><Icon name="plus" className="h-3.5 w-3.5" />เพิ่มหมายเหตุ</button>}
          </div>
        </div>
      </div>
    </Modal>
  );
}
