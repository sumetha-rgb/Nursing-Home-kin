"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import ResidentProfile from "../care/ResidentProfile";
import { fetchProfile, Profile, thDate } from "@/lib/care";
import Icon from "../Icon";
import RoomCard from "../care/RoomCard";
import RoomMap from "../care/RoomMap";
/** โหลด three.js เฉพาะตอนเปิดแผนผัง 3D (หน้าอื่นไม่หนักขึ้น) */
const RoomScene = dynamic(() => import("../care/RoomScene"), { ssr: false, loading: () => <p className="py-16 text-center text-sm text-gold-500">กำลังโหลดแผนผัง 3D…</p> });
import { useBranchNames } from "@/lib/branches";
import { RESIDENTS } from "@/lib/mock";
import { useCrud } from "@/lib/store";
import { useApp } from "@/lib/app";
import { useSession } from "@/lib/session";
import { can } from "@/lib/perms";
import { findRoom, freeBed, RoomInfo, roomInfos, roomKey, roomLabel, roomProblem, ROOM_STATUSES, ROOM_TYPES, staying, withRoom } from "@/lib/rooms";
import { DataTable, FieldDef, FormDialog, MetricGrid, Modal, PageHeader, Section, Select, StatusBadge, Tabs } from "../ui";

type Dlg = { mode: "add" | "edit"; i?: number; preset?: string[] } | null;
const VIEWS = ["แผนผัง 3D", "การ์ด"];
/** แถวห้อง [เลขห้อง, สาขา, ประเภท, เตียง, ค่าห้อง, สถานะ, หมายเหตุ, ชั้น/โซน] ⇄ ลำดับช่องในฟอร์ม */
const toForm = (r: string[]) => [r[0], r[1], r[7] ?? "", r[2], r[3], r[4] === "-" ? "" : (r[4] ?? "").replace(/,/g, ""), r[5], r[6] ?? ""];

/**
 * ห้องผู้ป่วย: แผนผัง 3 มิติเอียงวาดจากข้อมูลห้อง (จอกว้าง) หรือการ์ด (มือถือ) · กดห้องดูเตียงรายเตียงและจัดคนเข้าเตียง
 * สร้าง/แก้ห้อง = สิทธิ์ rooms.manage · จัดคนเข้าเตียง/ย้ายห้อง = สิทธิ์ rooms.move · คนอื่นดูอย่างเดียว
 */
export function Rooms() {
  const { user } = useSession();
  const admin = can(user, "rooms.manage");
  const move = can(user, "rooms.move");
  const branchNames = useBranchNames();
  const rooms = useCrud("rooms", []);
  const res = useCrud("residents", RESIDENTS);
  const { confirm, toast } = useApp();
  const [branch, setBranch] = useState("");
  const [dlg, setDlg] = useState<Dlg>(null);
  const [assign, setAssign] = useState<{ room: RoomInfo; bed: string } | null>(null);
  const [who, setWho] = useState("");
  const [place, setPlace] = useState<number | null>(null);
  const [view, setView] = useState("การ์ด");
  const [wide, setWide] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [no3d, setNo3d] = useState(false);
  const [branch3d, setBranch3d] = useState("");
  /** คนที่จิ้มในแผนผัง 3D · ข้อมูลสุขภาพเห็นเฉพาะผู้มีสิทธิ์เมนูผู้รับบริการหรือบันทึกสุขภาพ */
  const [person, setPerson] = useState<{ idx: number; room: number; bed: string } | null>(null);
  const [prof, setProf] = useState<Profile | null>(null);
  const [profErr, setProfErr] = useState("");
  const [profileId, setProfileId] = useState<string | null>(null);
  const canHealth = can(user, "residents") || can(user, "health_logs");

  // จอกว้าง = แผนผังเป็นค่าเริ่มต้น · มือถือใช้การ์ด (อ่านง่ายและเบากว่า)
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const apply = () => setWide(mq.matches);
    setView(mq.matches ? "แผนผัง 3D" : "การ์ด"); setWide(mq.matches);
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const all = roomInfos(rooms.rows, res.rows);
  const inBranch = (b: string) => !branch || b === branch;
  const list = all.filter((r) => inBranch(r.branch));
  const open = list.filter((r) => !r.closed);
  const people = res.rows.map((r, i) => ({ r, i })).filter(({ r }) => staying(r[5] ?? "") && inBranch(r[3]));
  const noRoom = people.filter(({ r }) => !findRoom(all, r[3], r[2]));
  // ห้องที่พิมพ์ไว้ในข้อมูลผู้รับบริการแต่ยังไม่ได้สร้างในระบบ
  const missing = [...new Map(noRoom.filter(({ r }) => r[2] && r[2].trim() !== "-").map(({ r }) => [`${r[3]}|${roomKey(r[2])}`, [r[2].trim(), r[3]]])).values()];
  const full = open.filter((r) => r.full);
  const free = open.reduce((n, r) => n + r.free, 0);
  const branches = [...new Set(list.map((r) => r.branch))];
  const selected = sel !== null ? all.find((r) => r.i === sel) ?? null : null;
  const showMap = view === "แผนผัง 3D";
  const b3 = branch || (branches.includes(branch3d) ? branch3d : branches[0] ?? "");

  useEffect(() => { if (selected && typeof window !== "undefined" && window.innerWidth < 1100) panelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps

  const setRoom = (i: number, room: string, bed = "") => res.update(i, withRoom(res.rows[i], room, bed));
  const openPerson = (roomI: number, bed: string, who: string) => {
    const room = all.find((r) => r.i === roomI);
    const idx = res.rows.findIndex((r) => r[0] === who && r[3] === room?.branch);
    setSel(roomI);
    if (idx >= 0) setPerson({ idx, room: roomI, bed });
  };
  useEffect(() => {
    setProf(null); setProfErr("");
    if (!person || !canHealth) return;
    // โหลดไม่สำเร็จ (เช่น ข้อมูลถูกลบไปแล้ว หรือเน็ตหลุด) ต้องบอก ไม่ค้างที่ "กำลังโหลด"
    const t = setTimeout(() => setProfErr("ใช้เวลานานผิดปกติ กรุณาลองใหม่"), 10000);
    fetchProfile(res.ids[person.idx]).then(setProf).catch((e) => setProfErr((e as Error).message || "โหลดข้อมูลไม่สำเร็จ")).finally(() => clearTimeout(t));
    return () => clearTimeout(t);
  }, [person]); // eslint-disable-line react-hooks/exhaustive-deps
  const putIn = (i: number, room: RoomInfo, bed?: string) => {
    const name = res.rows[i][0];
    const problem = roomProblem(room, name);
    if (problem) return toast(problem);
    const b = bed || freeBed(room, name);
    const taken = room.beds.find((x) => x.label === b)?.who;
    if (taken && taken !== name) return toast(`ไม่สามารถเลือกเตียง ${b} ได้ มี ${taken} พักอยู่`);
    setRoom(i, room.no, b);
    toast(`เพิ่มผู้ป่วยเข้าห้องแล้ว · ${name} · ห้อง ${room.no} เตียง ${b}`);
    setAssign(null); setPlace(null); setWho("");
  };
  const moveOut = (name: string, r: RoomInfo) => confirm({ title: "ย้ายออกจากห้อง", message: `ย้าย ${name} ออกจากห้อง ${r.no} ใช่หรือไม่ (ข้อมูลผู้รับบริการยังอยู่ เพิ่มเข้าห้องใหม่ได้ภายหลัง)`, okLabel: "ย้ายออก", onOk: () => { const i = res.rows.findIndex((x) => x[0] === name && x[3] === r.branch); if (i >= 0) { setRoom(i, "-"); toast(`ย้ายผู้ป่วยออกจากห้องแล้ว · ${name} · ห้อง ${r.no} ว่าง 1 เตียง`); } } });
  const removeRoom = (r: RoomInfo) => r.people.length ? confirm({ title: `ลบห้อง ${r.no} ไม่ได้`, message: `ห้องนี้ยังมีผู้พักอยู่ ${r.people.length} คน (${r.beds.filter((b) => b.who).map((b) => `${b.who} เตียง ${b.label}`).join(", ")}) กรุณาย้ายผู้รับบริการออกจากห้องนี้ก่อน แล้วจึงลบห้องได้`, okLabel: "เปิดห้องเพื่อย้ายผู้ป่วย", onOk: () => setSel(r.i) }) : confirm({ title: "ลบห้อง", message: `ต้องการลบห้อง ${r.no} (${r.branch}) ใช่หรือไม่`, danger: true, okLabel: "ลบ", onOk: () => { rooms.remove(r.i); setSel(null); toast(`ลบห้องแล้ว · ห้อง ${r.no} · ${r.branch}`); } });

  const fields: FieldDef[] = [
    { label: "เลขห้อง", required: true, placeholder: "เช่น 101" },
    { label: "สาขา", options: branchNames, required: true },
    { label: "ชั้น/โซน", placeholder: "เช่น ชั้น 1 หรือ ปีก A (ใช้จัดกลุ่มในแผนผัง)" },
    { label: "ประเภทห้อง", options: ROOM_TYPES },
    { label: "จำนวนเตียงในห้อง (คน)", type: "number", required: true },
    { label: "ค่าห้อง/เดือน (บาท)", type: "number" },
    { label: "สถานะ", options: ROOM_STATUSES, required: true },
    { label: "หมายเหตุ", area: true },
  ];
  // ค่าเริ่มต้นของฟอร์มต้องคงที่ระหว่างพิมพ์ (FormDialog รีเซตเมื่อ value เปลี่ยน)
  const formValue = useMemo(() => {
    if (!dlg) return undefined;
    if (dlg.mode === "edit" && dlg.i !== undefined) return toForm(rooms.rows[dlg.i]);
    return toForm(dlg.preset ?? ["", branch || (branchNames.length === 1 ? branchNames[0] : ""), ROOM_TYPES[0], "1", "", ROOM_STATUSES[0], "", ""]);
  }, [dlg]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (v: string[]) => {
    const no = v[0].trim().replace(/\s+/g, " ");
    const cap = parseInt(v[4], 10);
    if (!no) return toast("กรุณากรอกเลขห้อง");
    if (!(cap >= 1)) return toast("กรุณากำหนดจำนวนเตียงในห้องอย่างน้อย 1 เตียง");
    const editing = dlg?.mode === "edit" ? all.find((r) => r.i === dlg.i) : undefined;
    if (all.some((r) => r.i !== editing?.i && r.branch === v[1] && roomKey(r.no) === roomKey(no))) return toast(`มีห้อง ${no} ในสาขา${v[1]}แล้ว`);
    if (editing && cap < editing.people.length) return toast(`ไม่สามารถลดเหลือ ${cap} เตียงได้ ห้องนี้มีผู้พักอยู่ ${editing.people.length} คน ย้ายคนออกก่อน`);
    const cut = editing?.beds.slice(cap).filter((b) => b.who) ?? [];
    if (cut.length) return toast(`ไม่สามารถลดเหลือ ${cap} เตียงได้ เตียง ${cut.map((b) => b.label).join(", ")} มีผู้พักอยู่ ย้ายไปเตียงอื่นก่อน`);
    if (editing && editing.people.length && editing.branch !== v[1]) return toast("ไม่สามารถย้ายห้องที่มีผู้พักอยู่ไปสาขาอื่นได้");
    const row = [no, v[1], v[3], String(cap), v[5], v[6], v[7], v[2].trim()];
    if (editing) {
      rooms.update(editing.i, row);
      // เปลี่ยนเลขห้อง: ผู้ที่พักอยู่ย้ายตามเลขใหม่ (เตียงเดิม)
      if (roomKey(editing.no) !== roomKey(no)) res.rows.forEach((r, i) => { if (editing.people.includes(r[0]) && r[3] === editing.branch) setRoom(i, no, r[7] ?? ""); });
      toast({ type: "edit", title: "แก้ไขห้องแล้ว", detail: `ห้อง ${no} · ${v[1]} · ${cap} เตียง` });
    } else { rooms.add(row); toast(`สร้างห้องแล้ว · ห้อง ${no} · ${v[1]} · ${cap} เตียง`); }
    setDlg(null);
  };

  const card = (r: RoomInfo, pick?: () => void) => (
    <RoomCard key={r.i} room={r} onClick={pick} selected={!pick && sel === r.i}
      people={!pick && r.people.length > 0 && <div className="room-people">{r.beds.filter((b) => b.who).map((b) => <span key={b.label}><i className="not-italic text-gold-500">{b.label}</i> {b.who}{move && <button type="button" aria-label={`ย้าย ${b.who} ออกจากห้อง`} onClick={() => moveOut(b.who!, r)}>✕</button>}</span>)}</div>}>
      {(admin || move) && !pick && <div className="mt-1 flex flex-wrap gap-2 border-t border-cream-200 pt-2">
        {move && !r.full && !r.closed && <button type="button" className="row-action" onClick={() => { setWho(""); setAssign({ room: r, bed: freeBed(r) }); }}>+ เพิ่มผู้ป่วยเข้าห้อง</button>}
        {admin && <button type="button" className="row-action" onClick={() => setDlg({ mode: "edit", i: r.i })}>แก้ไข</button>}
        {admin && <button type="button" className="row-action danger" onClick={() => removeRoom(r)}>ลบ</button>}
      </div>}
    </RoomCard>
  );

  const candidates = assign ? res.rows.map((r, i) => ({ r, i })).filter(({ r }) => staying(r[5] ?? "") && r[3] === assign.room.branch) : [];
  const picked = who !== "" ? res.rows[Number(who)] : undefined;
  const bedChoices = assign ? assign.room.beds.filter((b) => !b.who || b.who === picked?.[0]) : [];
  const placing = place !== null ? res.rows[place] : null;

  const panel = selected && <div ref={panelRef} className="room-panel" aria-live="polite">
    <div className="flex items-start justify-between gap-3">
      <div><h3>ห้อง {selected.no}</h3><p className="room-meta">{selected.branch}{selected.floor ? ` · ${selected.floor}` : ""} · {selected.type}{selected.rate && selected.rate !== "-" ? ` · ${selected.rate} บาท/เดือน` : ""}</p></div>
      <button type="button" className="icon-button" aria-label="ปิดรายละเอียดห้อง" onClick={() => setSel(null)}><Icon name="close" className="h-4 w-4" /></button>
    </div>
    <p className="mt-2 flex items-center gap-2 text-sm text-gold-700"><StatusBadge value={roomLabel(selected)} />พักอยู่ {selected.people.length}/{selected.capacity} คน{!selected.closed && selected.free > 0 ? ` · ขาดอีก ${selected.free} คนจึงเต็ม` : ""}</p>
    {selected.note && <p className="mt-1 text-xs text-gold-500">{selected.note}</p>}
    <div className="mt-3">{selected.beds.map((b) => (
      <div key={b.label} className={`bed-row ${b.who ? "is-taken" : "is-free"}`}>
        <b>{b.label}</b>{b.who ? <button type="button" className="bed-who" onClick={() => openPerson(selected.i, b.label, b.who!)}>{b.who}</button> : <span>เตียงว่าง</span>}
        {b.who && move && <button type="button" className="row-action danger" onClick={() => moveOut(b.who!, selected)}>ย้ายออก</button>}
        {!b.who && move && !selected.closed && <button type="button" className="row-action" onClick={() => { setWho(""); setAssign({ room: selected, bed: b.label }); }}>+ เพิ่มผู้ป่วยเข้าเตียง</button>}
      </div>))}</div>
    {admin && <div className="mt-3 flex flex-wrap gap-2 border-t border-cream-200 pt-3">
      <button type="button" className="row-action" onClick={() => setDlg({ mode: "edit", i: selected.i })}>แก้ไขห้อง</button>
      <button type="button" className="row-action danger" onClick={() => removeRoom(selected)}>ลบห้อง</button>
    </div>}
  </div>;

  return (
    <>
      <PageHeader title="ห้องผู้ป่วย" sub={admin ? "สร้างห้อง กำหนดจำนวนเตียง และเพิ่มผู้ป่วยเข้าเตียง" : move ? "ดูห้องและเตียง เพิ่มผู้ป่วยเข้าเตียงหรือย้ายห้อง" : "ดูห้องว่างของสาขา เพื่อเลือกห้องตอนเปิดสัญญา"}
        actions={<>
          <Tabs tabs={VIEWS} value={view} onChange={setView} />
          {branchNames.length > 1 && <div className="min-w-44"><Select options={branchNames} placeholder="รวมทุกสาขา" value={branch} onChange={setBranch} /></div>}
          {admin && <button className="btn-primary" onClick={() => setDlg({ mode: "add" })}><Icon name="plus" className="h-4 w-4" /> สร้างห้อง</button>}
        </>} />
      <MetricGrid items={[
        { label: "ห้องทั้งหมด", value: list.length, unit: "ห้อง", icon: "bed", accent: true, note: list.length - open.length ? `ปิดปรับปรุง ${list.length - open.length} ห้อง` : undefined },
        { label: "รองรับได้", value: open.reduce((n, r) => n + r.capacity, 0), unit: "คน", icon: "building" },
        { label: "พักอยู่", value: open.reduce((n, r) => n + r.people.length, 0), unit: "คน", icon: "user" },
        { label: "เตียงว่าง", value: free, unit: "เตียง", icon: "check", note: full.length ? `ห้องเต็ม ${full.length} ห้อง` : undefined },
      ]} />
      {open.length > 0 && free === 0 && <p role="alert" className="room-warn mb-4">ห้องเต็มทุกห้องแล้ว ไม่สามารถรับผู้รับบริการใหม่ได้ {admin ? "สร้างห้องเพิ่ม หรือเพิ่มจำนวนเตียงในห้องก่อนเปิดสัญญาใหม่" : "แจ้งผู้จัดการสาขาให้เพิ่มห้องก่อนเปิดสัญญาใหม่"}</p>}
      {noRoom.length > 0 && <p className="mb-4 text-sm text-gold-600">รอจัดห้อง <b className="text-gold-800">{noRoom.length} คน</b> <button type="button" className="ml-2 text-gold-700 underline underline-offset-4" onClick={() => document.getElementById("room-waiting")?.scrollIntoView({ behavior: "smooth" })}>ดูรายชื่อ</button></p>}
      {!rooms.loaded ? <Section><p className="py-8 text-center text-sm text-gold-500">กำลังโหลดห้อง…</p></Section>
        : !list.length ? <Section><div className="empty-state"><Icon name="bed" /><p>{admin ? "ยังไม่มีห้องในสาขานี้ กด \"สร้างห้อง\" เพื่อเริ่มกำหนดห้องและจำนวนเตียง" : "ยังไม่มีห้องในสาขานี้ แจ้งผู้จัดการสาขาให้สร้างห้อง"}</p></div></Section>
        : showMap ? <div className={`room-layout ${selected ? "has-panel" : ""}`}>
          <div className="min-w-0"><Section title={`สาขา${b3}`} sub={`${list.filter((r) => r.branch === b3).length} ห้อง · ว่าง ${list.filter((r) => r.branch === b3 && !r.closed).reduce((n, r) => n + r.free, 0)} เตียง`}
            actions={!branch && branches.length > 1 ? <div className="min-w-44"><Select options={branches} value={b3} onChange={setBranch3d} /></div> : undefined}>
            {no3d ? <><p className="mb-3 text-sm text-gold-600">เครื่องนี้แสดงภาพ 3 มิติไม่ได้ จึงแสดงแผนผังแบบภาพนิ่งแทน</p><RoomMap rooms={list.filter((r) => r.branch === b3)} selected={sel} onSelect={setSel} /></>
              : <RoomScene rooms={list.filter((r) => r.branch === b3)} selected={sel} onRoom={setSel} onPerson={openPerson} onFail={() => setNo3d(true)} />}
          </Section></div>
          {panel}
        </div>
        : <div>{branches.map((b) => <Section key={b} title={branches.length > 1 || !branch ? `สาขา${b}` : "ห้องทั้งหมด"} sub={`${list.filter((r) => r.branch === b).length} ห้อง · ว่าง ${list.filter((r) => r.branch === b && !r.closed).reduce((n, r) => n + r.free, 0)} เตียง`}>
          <div className="room-grid">{list.filter((r) => r.branch === b).map((r) => card(r))}</div>
        </Section>)}</div>}
      {!showMap && selected && <div className="mt-4">{panel}</div>}
      {noRoom.length > 0 && <div id="room-waiting" className="mt-6"><Section title="ผู้รับบริการที่ยังไม่มีห้อง" sub="ยังไม่ได้ระบุห้อง หรือห้องที่บันทึกไว้ยังไม่ได้สร้างในระบบ">
        {admin && missing.length > 0 && <div className="mb-4 flex flex-wrap items-center gap-2 text-sm text-gold-600">สร้างห้องจากข้อมูลเดิม:
          {missing.map(([no, b]) => <button key={`${b}|${no}`} type="button" className="row-action" onClick={() => setDlg({ mode: "add", preset: [no, b, ROOM_TYPES[0], "1", "", ROOM_STATUSES[0], "", ""] })}>+ {no} ({b})</button>)}
        </div>}
        <DataTable search={false} columns={["ชื่อ-นามสกุล", "สาขา", "ห้องที่บันทึกไว้", "สถานะ"]}
          rows={noRoom.map(({ r }) => [r[0], r[3], r[2] && r[2].trim() !== "-" ? `${r[2]} (ยังไม่ได้สร้างห้องนี้)` : "ยังไม่ระบุ", r[5]])}
          actions={move ? [{ label: "จัดห้อง", onClick: (k) => setPlace(noRoom[k].i) }] : undefined} />
      </Section></div>}

      <Modal open={!!person} title="รายละเอียดผู้ป่วย" onClose={() => setPerson(null)}
        footer={<><button className="btn-soft" onClick={() => setPerson(null)}>ปิด</button>{canHealth && person && <button className="btn-primary" onClick={() => { setProfileId(res.ids[person.idx]); setPerson(null); }}>ดูประวัติการดูแลทั้งหมด</button>}</>}>
        {person && (() => {
          const r = res.rows[person.idx], room = all.find((x) => x.i === person.room);
          const open = (prof?.alerts ?? []).filter((a) => a.status === "open");
          const meds = (prof?.meds ?? []).filter((m) => !m.on_hold);
          const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
          const next = (prof?.appts ?? []).filter((a) => String(a.date ?? "") >= today).sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
          const since = (prof?.contracts ?? []).find((c) => c.status !== "สิ้นสุดสัญญา" && c.status !== "ยกเลิกสัญญา")?.start_date;
          const v = prof?.health?.[0];
          return <div className="space-y-4">
            <div className="flex items-start gap-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-cream-100 text-xl font-semibold text-gold-700">{r[0].replace(/^(คุณ|นาย|นางสาว|นาง)\s*/, "").charAt(0)}</span>
              <div className="min-w-0"><p className="text-lg font-semibold text-gold-800">{r[0]}</p>
                <p className="text-sm text-gold-600">{r[6] ? `HN ${r[6]} · ` : ""}{r[1] && r[1] !== "-" ? `อายุ ${r[1]} ปี · ` : ""}ห้อง {room?.no} เตียง {person.bed}</p>
                <div className="mt-1"><StatusBadge value={r[5]} /></div></div>
            </div>
            {canHealth && profErr && !prof && <p role="alert" className="room-warn">โหลดข้อมูลสุขภาพไม่สำเร็จ: {profErr} <button type="button" className="ml-2 underline underline-offset-4" onClick={() => setPerson({ ...person })}>ลองใหม่</button></p>}
            {canHealth ? <dl className="person-facts">
              <div><dt>อาการ / โรคประจำตัว</dt><dd>{r[4] || "-"}</dd></div>
              <div><dt>เข้าพักตั้งแต่</dt><dd>{since ? thDate(since, false) : prof || profErr ? "-" : "กำลังโหลด…"}</dd></div>
              <div><dt>สัญญาณชีพล่าสุด</dt><dd>{v ? `${v.vital_signs ?? "-"}${v.o2_sat ? ` · O2 ${v.o2_sat}` : ""}${v.dtx ? ` · DTX ${v.dtx}` : ""} (${thDate(v.at)})` : prof || profErr ? "ยังไม่มีบันทึก" : "กำลังโหลด…"}</dd></div>
              <div><dt>แจ้งเตือนที่ยังไม่รับทราบ</dt><dd className={open.length ? "text-red-700" : ""}>{open.length ? open.map((a) => String(a.summary)).join(" · ") : prof || profErr ? "ไม่มี" : "กำลังโหลด…"}</dd></div>
              <div><dt>ยาที่ใช้อยู่</dt><dd>{meds.length ? `${meds.length} รายการ: ${meds.slice(0, 4).map((m) => String(m.drug_name)).join(", ")}${meds.length > 4 ? " …" : ""}` : prof || profErr ? "-" : "กำลังโหลด…"}</dd></div>
              <div><dt>นัดหมายถัดไป</dt><dd>{next ? `${thDate(next.date, false)} ${String(next.time ?? "").slice(0, 5)} · ${next.purpose}` : prof || profErr ? "ไม่มี" : "กำลังโหลด…"}</dd></div>
            </dl> : <p className="rounded-xl bg-cream-50 px-4 py-3 text-sm text-gold-600">บัญชีนี้ไม่มีสิทธิ์ดูข้อมูลสุขภาพของผู้ป่วย (ต้องมีเมนูผู้รับบริการหรือบันทึกสุขภาพ)</p>}
            {move && room && <button type="button" className="row-action danger" onClick={() => { setPerson(null); moveOut(r[0], room); }}>ย้ายออกจากห้อง</button>}
          </div>;
        })()}
      </Modal>
      <ResidentProfile id={profileId} onClose={() => setProfileId(null)} />
      <FormDialog open={!!dlg} mode={dlg?.mode ?? "add"} title={dlg?.mode === "edit" ? "แก้ไขห้อง" : "สร้างห้องผู้ป่วย"} fields={fields} value={formValue}
        onClose={() => setDlg(null)} onSave={save} saveLabel={dlg?.mode === "edit" ? "บันทึก" : "สร้างห้อง"} />

      <Modal open={!!assign} title={`เพิ่มผู้ป่วยเข้าห้อง ${assign?.room.no ?? ""}`} onClose={() => setAssign(null)}
        footer={<><button className="btn-soft" onClick={() => setAssign(null)}>ยกเลิก</button><button className="btn-primary" disabled={!who || !assign?.bed} onClick={() => { if (assign) putIn(Number(who), assign.room, assign.bed); }}>เพิ่มเข้าเตียง {assign?.bed}</button></>}>
        {assign && <div className="space-y-4">
          <p className="text-sm text-gold-600">ห้อง {assign.room.no} · สาขา{assign.room.branch} · ว่าง {assign.room.free} จาก {assign.room.capacity} เตียง</p>
          {candidates.length ? <>
            <select value={who} onChange={(e) => { setWho(e.target.value); const p = res.rows[Number(e.target.value)]; const ok = assign.room.beds.find((b) => b.label === assign.bed && (!b.who || b.who === p?.[0])); if (!ok) setAssign({ ...assign, bed: freeBed(assign.room, p?.[0]) }); }} aria-label="เลือกผู้รับบริการ">
              <option value="">-- เลือกผู้รับบริการ --</option>
              {candidates.map(({ r, i }) => <option key={i} value={i}>{r[0]}{r[2] && r[2].trim() !== "-" ? ` (ตอนนี้อยู่ห้อง ${r[2]}${r[7] ? ` เตียง ${r[7]}` : ""})` : " (ยังไม่มีห้อง)"}</option>)}
            </select>
            <select value={assign.bed} onChange={(e) => setAssign({ ...assign, bed: e.target.value })} aria-label="เลือกเตียง">
              {bedChoices.map((b) => <option key={b.label} value={b.label}>เตียง {b.label}{b.who ? ` (เตียงของ ${b.who})` : " · ว่าง"}</option>)}
            </select>
          </> : <p className="text-sm text-gold-500">ไม่มีผู้รับบริการในสาขานี้ที่เพิ่มเข้าห้องได้</p>}
        </div>}
      </Modal>

      <Modal open={!!placing} wide title={`เลือกห้องให้ ${placing?.[0] ?? ""}`} onClose={() => setPlace(null)} footer={<button className="btn-soft" onClick={() => setPlace(null)}>ปิด</button>}>
        {placing && (() => {
          const options = all.filter((r) => r.branch === placing[3]);
          return options.length ? <div className="room-grid">{options.map((r) => card(r, () => putIn(place!, r)))}</div>
            : <p className="text-sm text-gold-500">สาขา{placing[3]}ยังไม่มีห้อง สร้างห้องก่อน</p>;
        })()}
      </Modal>
    </>
  );
}
