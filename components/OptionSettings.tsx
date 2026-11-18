"use client";
/**
 * ชุดตัวเลือกที่ผู้ใช้แก้เองได้ (lib/optionLists) · ข้อมูลกลางทุกสาขา เก็บใน /api/data/opts-<group>
 *  useOptions(list)  → ตัวเลือกที่เปิดใช้ (เรียงตามลำดับตั้งต้น แล้วตามที่เพิ่ม) · all = รวมที่ปิดใช้ (ใช้อ่านค่าที่บันทึกไว้เดิม)
 *  <OptionSettings group /> → ปุ่ม "ตั้งค่าตัวเลือก" + หน้าต่างเพิ่ม · เปลี่ยนชื่อ · สวิตช์เปิด/ปิดใช้ (เห็นเฉพาะคนที่มีสิทธิ์แก้หน้านั้น)
 *  ยังไม่มีข้อมูลในระบบ (หรือโหลดไม่ได้) = ใช้ค่าตั้งต้นเดิมในโค้ด
 */
import { useMemo, useState } from "react";
import Icon from "./Icon";
import { Modal } from "./ui";
import { newId, useRecords } from "@/lib/store";
import { useSession } from "@/lib/session";
import { can } from "@/lib/perms";
import { readOnlyRole } from "@/lib/roles";
import { useApp } from "@/lib/app";
import { listsOf, OPT_GROUP_TH, OPT_WRITE, OptGroup, OPTION_LISTS, OptKind, OptList, OptListDef, OTHER } from "@/lib/optionLists";

type Row = { id: string; list: OptList; value: string; active: boolean; sort?: number | null };

const seedOf = (g: OptGroup): Row[] => listsOf(g).flatMap((list) => (OPTION_LISTS[list].defaults as readonly string[]).map((value, i) => ({ id: `${list}-${i}`, list, value, active: true })));
/** ลำดับ: ค่าตั้งต้นตามลำดับเดิม (id = <list>-<ลำดับ>) แล้วตามด้วยที่เพิ่มภายหลังตามเวลาที่เพิ่ม */
const orderOf = (r: Row) => { const m = r.id.match(/-(\d+)$/); return r.id.startsWith(`${r.list}-`) && m ? Number(m[1]) : 1e4 + (r.sort ?? 0) / 1e13; };

function useGroup(g: OptGroup) {
  const seed = useMemo(() => seedOf(g), [g]);
  return useRecords<Row>(`opts-${g}`, seed);
}

export function useOptions(list: OptList): { values: string[]; all: string[] } {
  const def: OptListDef = OPTION_LISTS[list];
  const [rows] = useGroup(def.group);
  return useMemo(() => {
    const mine = rows.filter((r) => r.list === list).sort((a, b) => orderOf(a) - orderOf(b));
    if (!mine.length) return { values: [...def.defaults], all: [...def.defaults] };
    return { values: mine.filter((r) => r.active).map((r) => r.value), all: mine.map((r) => r.value) };
  }, [rows, list, def]);
}

const clean = (v: string) => v.replace(/\s+/g, " ").trim();
/** ตรวจค่าตามชนิด · คืนค่าที่จัดรูปแล้ว หรือข้อความปัญหา */
function check(kind: OptKind | undefined, v: string): { ok: string } | { err: string } {
  const t = clean(v);
  if (!t) return { err: "กรุณาใส่ข้อความ" };
  if (kind === "money" || kind === "minutes") {
    const n = Number(t.replace(/,/g, ""));
    if (!Number.isInteger(n) || n <= 0 || n > (kind === "money" ? 1_000_000 : 600)) return { err: kind === "money" ? "ใส่จำนวนเงินเป็นตัวเลข เช่น 3000" : "ใส่จำนวนนาที เช่น 45" };
    return { ok: String(n) };
  }
  if (kind === "time") {
    const m = t.match(/^(\d{1,2})[:.](\d{2})$/);
    if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return { err: "ใส่เวลาแบบ 08:00" };
    return { ok: `${m[1].padStart(2, "0")}:${m[2]}` };
  }
  if (t.length > 80) return { err: "ยาวได้ไม่เกิน 80 ตัวอักษร" };
  if (t === OTHER) return { err: `"${OTHER}" มีให้อยู่แล้วเสมอ` };
  return { ok: t };
}
const show = (kind: OptKind | undefined, v: string) => (kind === "money" ? `${Number(v).toLocaleString("en-US")} บาท` : kind === "minutes" ? `${v} นาที` : v);

/** ปุ่ม "ตั้งค่าตัวเลือก" ของหน้า · lists = เฉพาะบางชุด (ไม่ระบุ = ทุกชุดของหน้า) */
export function OptionSettings({ group, lists, label = "ตั้งค่าตัวเลือก", small }: { group: OptGroup; lists?: OptList[]; label?: string; small?: boolean }) {
  const { user } = useSession();
  const [open, setOpen] = useState(false);
  if (readOnlyRole(user?.role) || !OPT_WRITE[group].some((p) => can(user, p))) return null;
  return (
    <>
      <button type="button" className={small ? "row-action" : "btn-soft"} onClick={() => setOpen(true)}><Icon name="wrench" className="h-4 w-4" /> {label}</button>
      {open && <OptionDialog group={group} lists={lists ?? listsOf(group)} onClose={() => setOpen(false)} />}
    </>
  );
}

function OptionDialog({ group, lists, onClose }: { group: OptGroup; lists: OptList[]; onClose: () => void }) {
  const [list, setList] = useState<OptList>(lists[0]);
  return (
    <Modal open wide title={`ตั้งค่าตัวเลือก · ${OPT_GROUP_TH[group]}`} onClose={onClose} footer={<button type="button" className="btn-primary" onClick={onClose}>เสร็จ</button>}>
      <div className="space-y-4">
        {lists.length > 1 && <div className="pl-chips is-pick" role="radiogroup" aria-label="ชุดตัวเลือก">
          {lists.map((l) => <button key={l} type="button" role="radio" aria-checked={l === list} aria-pressed={l === list} onClick={() => setList(l)}>{OPTION_LISTS[l].label}</button>)}
        </div>}
        <OptionListPanel key={list} list={list} />
      </div>
    </Modal>
  );
}

/** รายการของชุดตัวเลือก 1 ชุด: เพิ่ม · แก้ไข · สวิตช์เปิด/ปิด (ใช้ทั้งในหน้าต่างของแต่ละหน้า และหน้า "ตั้งค่า") */
export function OptionListPanel({ list, bare }: { list: OptList; bare?: boolean }) {
  const def: OptListDef = OPTION_LISTS[list];
  const group = def.group;
  const [rows, setRows, meta] = useGroup(group);
  const { toast } = useApp();
  const { user } = useSession();
  const canEdit = !readOnlyRole(user?.role) && OPT_WRITE[group].some((p) => can(user, p));
  const [edit, setEdit] = useState<{ id: string; value: string } | null>(null);
  const [add, setAdd] = useState("");
  const [err, setErr] = useState("");
  // ยังไม่เคยบันทึกในระบบ = แสดงค่าตั้งต้น (บันทึกครั้งแรกจะเขียนค่าตั้งต้นพร้อมกัน)
  const base = rows.filter((r) => r.list === list).length ? rows : [...rows, ...seedOf(group).filter((r) => r.list === list)];
  const mine = base.filter((r) => r.list === list).sort((a, b) => orderOf(a) - orderOf(b));
  const dup = (v: string, self?: string) => mine.some((r) => r.id !== self && r.value.toLowerCase() === v.toLowerCase());
  /** แทนชุดของ list นี้ด้วย next · ชุดอื่นคงเดิม (useRecords บันทึกเฉพาะแถวที่เพิ่ม/แก้) */
  const commit = (next: Row[], msg: string) => { setRows([...base.filter((r) => r.list !== list), ...next]); toast(msg); };
  const doAdd = () => {
    const c = check(def.kind, add);
    if ("err" in c) return setErr(c.err);
    if (dup(c.ok)) return setErr(`มี "${show(def.kind, c.ok)}" อยู่แล้ว`);
    commit([...mine, { id: `x-${newId()}`, list, value: c.ok, active: true }], `เพิ่ม ${show(def.kind, c.ok)} แล้ว`);
    setAdd(""); setErr("");
  };
  const doRename = () => {
    if (!edit) return;
    const c = check(def.kind, edit.value);
    if ("err" in c) return setErr(c.err);
    if (dup(c.ok, edit.id)) return setErr(`มี "${show(def.kind, c.ok)}" อยู่แล้ว`);
    commit(mine.map((r) => (r.id === edit.id ? { ...r, value: c.ok } : r)), "บันทึกแล้ว");
    setEdit(null); setErr("");
  };
  const toggle = (r: Row) => {
    if (r.active && mine.filter((x) => x.active).length <= 1) return toast("ต้องเปิดใช้ไว้อย่างน้อย 1 ตัวเลือก");
    commit(mine.map((x) => (x.id === r.id ? { ...x, active: !x.active } : x)), `${r.active ? "ปิดใช้" : "เปิดใช้"} ${show(def.kind, r.value)} แล้ว`);
  };
  const on = mine.filter((r) => r.active).length;
  return (
    <div className="space-y-4">
      <p className="text-sm text-gold-700">{bare ? <>เปิดใช้ {on} จาก {mine.length} ตัวเลือก</> : <><b className="text-gold-900">{def.label}</b> · {def.hint} · เปิดใช้ {on} จาก {mine.length}</>}</p>
      {!meta.loaded && <p className="text-sm text-gold-500">กำลังโหลด…</p>}
      <ul className="sub-list opt-list">
        {mine.map((r) => (
          <li key={r.id} className={r.active ? "" : "is-off"}>
            {edit?.id === r.id
              ? <span className="flex min-w-0 gap-2">
                  <input autoFocus value={edit.value} maxLength={80} aria-label="แก้ตัวเลือก" onChange={(e) => setEdit({ ...edit, value: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Enter") doRename(); if (e.key === "Escape") setEdit(null); }} />
                  <button type="button" className="btn-primary !min-h-0 shrink-0" onClick={doRename}>บันทึก</button>
                  <button type="button" className="btn-soft !min-h-0 shrink-0" onClick={() => { setEdit(null); setErr(""); }}>ยกเลิก</button>
                </span>
              : <span className="sub-t"><b>{show(def.kind, r.value)}</b></span>}
            <button type="button" role="switch" aria-checked={r.active} className="pl-switch" disabled={!canEdit} aria-label={`${r.value} ${r.active ? "เปิดใช้งาน" : "ปิดใช้งาน"}`} onClick={() => toggle(r)}>
              <i aria-hidden="true" /><span>{r.active ? "เปิดใช้งาน" : "ปิดใช้งาน"}</span>
            </button>
            {canEdit && edit?.id !== r.id ? <button type="button" className="row-action" onClick={() => { setEdit({ id: r.id, value: r.value }); setErr(""); }}>แก้ไข</button> : <span />}
          </li>
        ))}
        {(list === "dc_reasons" || list === "cn_reasons") && <li className="is-fixed"><span className="sub-t"><b>{OTHER}</b><small>ต่อท้ายเสมอ{list === "cn_reasons" ? " · เลือกแล้วพิมพ์เหตุผลเอง" : ""}</small></span><span /><span /></li>}
      </ul>
      {canEdit && <div className="flex flex-wrap items-center gap-2">
        <input className="!w-auto min-w-0 flex-1" value={add} maxLength={80} aria-label={`เพิ่ม${def.label}`}
          placeholder={def.kind === "money" ? "เพิ่มยอด เช่น 10000" : def.kind === "minutes" ? "เพิ่มนาที เช่น 120" : def.kind === "time" ? "เพิ่มเวลา เช่น 17:00" : `เพิ่ม${def.label}`}
          inputMode={def.kind && def.kind !== "text" ? "numeric" : undefined}
          onChange={(e) => { setAdd(e.target.value); setErr(""); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); doAdd(); } }} />
        <button type="button" className="btn-primary" onClick={doAdd}><Icon name="plus" className="h-4 w-4" /> เพิ่ม</button>
      </div>}
      {err && <p className="text-sm text-red-600">{err}</p>}
      <p className="field-hint">ปิดใช้แล้วจะไม่ขึ้นให้เลือกในฟอร์ม แต่ข้อมูลเก่าที่เคยเลือกไว้ยังอยู่ · แก้ชื่อมีผลกับการเลือกครั้งต่อไป ข้อมูลที่บันทึกไปแล้วไม่เปลี่ยน · ใช้ร่วมกันทุกสาขา</p>
    </div>
  );
}
