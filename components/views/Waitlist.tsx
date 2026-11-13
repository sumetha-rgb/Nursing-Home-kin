"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DataTable, Field, Modal, Section } from "../ui";
import Icon from "../Icon";
import { useApp } from "@/lib/app";
import { useSession } from "@/lib/session";
import { useCrud } from "@/lib/store";
import { useBranchNames } from "@/lib/branches";
import { roomInfos, ROOM_TYPES } from "@/lib/rooms";
import { contractDateIso, thDateText } from "@/lib/servicePeriod";

export type WaitItem = { id: string; branch: string; name: string; phone: string; roomType: string; quoteNo: string; note: string; by: string; since: string };
export type WaitDraft = { name: string; phone: string; roomType: string; quoteNo: string; note: string; branch: string };
const today = () => new Date(Date.now() + 7 * 36e5).toISOString().slice(0, 10);

/**
 * คนรอเข้าพัก (หน้าใบเสนอราคา): ลำดับคนรอ · ห้องที่ต้องการ · คาดว่าว่าง (เตียงว่างตอนนี้ หรือวันสิ้นสุดสัญญาที่ใกล้ที่สุดของห้องประเภทนั้น)
 *  draft = เปิดฟอร์มเพิ่มคนรอจากใบเสนอราคา (ชื่อ เบอร์ เลขที่ใบ) · onContract = ทำสัญญาจากใบเสนอราคาของคนนั้น
 */
export default function Waitlist({ draft, onDraftDone, onContract }: { draft: WaitDraft | null; onDraftDone: () => void; onContract?: (quoteNo: string) => void }) {
  const { toast, confirm } = useApp();
  const { user } = useSession();
  const branchNames = useBranchNames();
  const global = user?.role === "Global Admin";
  const [items, setItems] = useState<WaitItem[] | null>(null);
  const [f, setF] = useState<WaitDraft | null>(null);
  const rooms = useCrud("rooms", []), res = useCrud("residents", []), con = useCrud("contracts", []);
  const load = useCallback(() => { fetch("/api/waitlist", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { items: [] })).then((d) => setItems(d.items ?? [])).catch(() => setItems([])); }, []);
  useEffect(load, [load]);
  useEffect(() => { if (draft) setF({ ...draft, branch: draft.branch || (global ? "" : user?.branch ?? "") }); }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps
  const infos = useMemo(() => roomInfos(rooms.rows, res.rows), [rooms.rows, res.rows]);
  /** คาดว่าว่าง: เตียงว่างตอนนี้ของประเภทนั้น · ไม่มี = สัญญาใช้งานอยู่ที่สิ้นสุดเร็วที่สุดในห้องประเภทนั้น */
  const expect = (w: WaitItem) => {
    const same = infos.filter((r) => r.branch === w.branch && !r.closed && (!w.roomType || r.type === w.roomType));
    const free = same.find((r) => r.free > 0);
    if (free) return { text: `ว่างตอนนี้ · ห้อง ${free.no}`, now: true };
    const nos = new Set(same.map((r) => r.no));
    const ends = con.rows.filter((c) => c[1] === w.branch && c[5] === "ใช้งานอยู่" && nos.has(c[6]) && contractDateIso(c[22]) >= today())
      .map((c) => ({ room: c[6], end: contractDateIso(c[22]) })).sort((a, b) => a.end.localeCompare(b.end));
    return ends[0] ? { text: `ห้อง ${ends[0].room} · ${thDateText(ends[0].end)}`, now: false } : { text: "ยังไม่มีกำหนด", now: false };
  };
  const save = async () => {
    if (!f) return;
    if (!f.name.trim()) return toast("กรุณาระบุชื่อผู้สนใจ");
    if (global && !f.branch) return toast("กรุณาเลือกสาขา");
    const r = await fetch("/api/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "add", ...f }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return toast(d.error || "บันทึกไม่สำเร็จ");
    toast(`เพิ่มในคนรอเข้าพักแล้ว · ${f.name}`); setF(null); onDraftDone(); load();
  };
  const setStatus = (w: WaitItem, status: string) => confirm({ title: status, okLabel: status, message: `${w.name}${w.roomType ? ` · ${w.roomType}` : ""} · ${status === "ได้ห้องแล้ว" ? "นำออกจากคนรอ (ได้ห้องแล้ว)" : "ยกเลิกการรอ"}`,
    onOk: async () => { const r = await fetch("/api/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "status", id: w.id, status }) }); toast(r.ok ? `${status} · ${w.name}` : "บันทึกไม่สำเร็จ"); load(); } });
  const list = items ?? [];
  const cols = ["ลำดับ", "ผู้สนใจ", ...(global ? ["สาขา"] : []), "ห้องที่ต้องการ", "ใบเสนอราคา", "รอมา", "คาดว่าว่าง"];
  return (
    <Section title="คนรอเข้าพัก" sub={items ? `${list.length} คน · คาดว่าว่าง = เตียงว่างตอนนี้ หรือวันสิ้นสุดสัญญาที่ใกล้ที่สุดของห้องประเภทนั้น` : "กำลังโหลด…"}
      actions={<button className="btn-soft" onClick={() => setF({ name: "", phone: "", roomType: "", quoteNo: "", note: "", branch: global ? "" : user?.branch ?? "" })}><Icon name="plus" className="h-4 w-4" /> เพิ่มคนรอ</button>}>
      <DataTable search={false} columns={cols} empty={items ? "ไม่มีคนรอเข้าพัก" : "กำลังโหลด…"}
        rows={list.map((w, i) => [String(i + 1), `${w.name}${w.phone ? ` · ${w.phone}` : ""}`, ...(global ? [w.branch] : []), w.roomType || "ไม่ระบุ", w.quoteNo || "-",
          `${Math.max(0, Math.round((Date.parse(today()) - Date.parse(w.since)) / 864e5))} วัน`, expect(w).text])}
        render={(row, col, value) => (col === cols.length - 1 && expect(list[row]).now ? <span className="q-chip is-ok">{value}</span> : undefined)}
        actions={[
          ...(onContract ? [{ label: "ทำสัญญา", tone: "primary" as const, hidden: (k: number) => !list[k].quoteNo, onClick: (k: number) => onContract(list[k].quoteNo) }] : []),
          { label: "ได้ห้องแล้ว", more: true, onClick: (k) => setStatus(list[k], "ได้ห้องแล้ว") },
          { label: "ยกเลิกการรอ", more: true, danger: true, onClick: (k) => setStatus(list[k], "ยกเลิก") },
        ]} />
      <Modal open={!!f} title="เพิ่มคนรอเข้าพัก" onClose={() => { setF(null); onDraftDone(); }}
        footer={<><button className="btn-soft" onClick={() => { setF(null); onDraftDone(); }}>ยกเลิก</button><button className="btn-primary" onClick={save}>เพิ่มในคนรอ</button></>}>
        {f && <div className="form-grid">
          {global && <Field label="สาขา" required><select value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })}><option value="">-- เลือกสาขา --</option>{branchNames.map((b) => <option key={b}>{b}</option>)}</select></Field>}
          <Field label="ชื่อผู้สนใจ / ผู้รับบริการ" required><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="เบอร์โทร"><input value={f.phone} inputMode="tel" onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          <Field label="ห้องที่ต้องการ"><select value={f.roomType} onChange={(e) => setF({ ...f, roomType: e.target.value })}><option value="">-- ไม่ระบุ --</option>{ROOM_TYPES.map((x) => <option key={x}>{x}</option>)}</select></Field>
          <Field label="ใบเสนอราคา"><input value={f.quoteNo} onChange={(e) => setF({ ...f, quoteNo: e.target.value })} placeholder="เช่น QT-2569-0041" /></Field>
          <Field label="หมายเหตุ" className="md:col-span-2"><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="เช่น อยากได้ชั้นล่าง · เข้าได้ต้นเดือนหน้า" /></Field>
        </div>}
      </Modal>
    </Section>
  );
}
