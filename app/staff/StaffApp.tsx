"use client";
import { ReactNode, useEffect, useState } from "react";
import TutorialVideos from "@/components/TutorialVideos";
import Image from "next/image";
import Link from "next/link";
import Login from "@/components/Login";
import PasswordDialog from "@/components/PasswordDialog";
import { useSession, SessionUser } from "@/lib/session";
import { ROLE_INFO } from "@/lib/roles";
import { apptIso, upcomingAppts } from "@/lib/appointments";
import CashierOnly from "@/components/CashierOnly";
import { can } from "@/lib/perms";
import Icon from "@/components/Icon";
import { Field, Modal, Select } from "@/components/ui";
import { AppProvider, useApp } from "@/lib/app";
import { downloadCsv, useCrud, useRecords } from "@/lib/store";
import { useResidents } from "@/lib/care";
import { HEALTH } from "@/lib/mock";
import { daysLeft, Drug, DRUGS0, iso, MEALS, nowTh, Pack } from "@/lib/pharmacy";
import AlertsBell from "@/components/care/AlertsBell";
import BranchNotice from "@/components/BranchNotice";
import ResidentProfile from "@/components/care/ResidentProfile";
import VitalsDialog from "@/components/care/VitalsDialog";
import FamilyLinkDialog from "@/components/care/FamilyLinkDialog";
import PhotoPicker from "@/components/PhotoPicker";
import { OfflineBar, usePwa } from "@/components/Pwa";
import { CheckInCard, StaffRoster } from "@/components/roster/StaffRoster";
import { fetchToday, SHIFTS, stampPhoto } from "@/lib/roster";
import type { StaffReview } from "@/lib/reviews";
import { KPI_PARTS, KpiResp, pointsOf } from "@/lib/kpi";

/* ---------- ข้อมูลจำลอง ---------- */
/** งานวันนี้ใน KinApp (มาจากหน้างานประจำวันของผู้จัดการ) */
type Task = { id: number; rid?: string; who: string; title: string; time: string; ins: string; done?: string; note?: string; shift?: string; status?: string; by?: string; owner?: string };

const HANDOVER0 = [
  { id: 1, type: "เฝ้าระวังอาการ", who: "คุณมาลี ศรีสุข", text: "แขนขวาอ่อนแรงมากขึ้นเล็กน้อย ให้ตรวจซ้ำทุก 4 ชม.", by: "พยาบาล วิภา", at: "เมื่อวาน 19:10" },
  { id: 2, type: "ญาติฝากแจ้ง", who: "คุณสุดา วงศ์สวัสดิ์", text: "ลูกสาวจะมาเยี่ยมบ่ายนี้ ฝากเตรียมเสื้อผ้าชุดใหม่", by: "พนักงาน ลัดดา", at: "วันนี้ 06:40" },
];
const TYPES = ["เฝ้าระวังอาการ", "คำสั่งแพทย์", "ญาติฝากแจ้ง", "งานค้าง/ทั่วไป"];

type Tab = "tasks" | "roster" | "meds" | "residents" | "team" | "fame";
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "tasks", label: "งานวันนี้", icon: "check" },
  { id: "roster", label: "ตารางเวร", icon: "calendar" },
  { id: "meds", label: "จ่ายยา", icon: "pill" },
  { id: "residents", label: "ผู้รับบริการ", icon: "user" },
  { id: "team", label: "ผลงานทีม", icon: "grid" },
  { id: "fame", label: "เกียรติยศ", icon: "trophy" },
];

const today = () => new Date().toLocaleDateString("th-TH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

/* ---------- ตัวช่วย UI ---------- */
function Card({ title, icon, right, children }: { title?: string; icon?: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-cream-300/70 bg-white p-4 shadow-soft">
      {title && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-gold-800">{icon && <Icon name={icon} className="h-[18px] w-[18px] text-gold-500" />}{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}
const Count = ({ n }: { n: number }) => <span className="grid h-6 min-w-6 place-items-center rounded-full bg-gold-700 px-1.5 text-xs font-semibold text-white">{n}</span>;
const Empty = ({ t }: { t: string }) => <p className="rounded-2xl bg-cream-50 py-6 text-center text-sm text-gold-500">{t}</p>;

function PhotoInput({ label, file, onFile }: { label: string; file: string; onFile: (u: string) => void }) {
  return <PhotoPicker value={file} onChange={onFile} label={label} hint="ถ่ายสดจากกล้อง หรือเลือกรูปจากเครื่อง" />;
}

/* ---------- แอป ---------- */
function App({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const { toast, confirm } = useApp();
  const pwa = usePwa();
  const [tab, setTab] = useState<Tab>("tasks");
  // งานวันนี้ = งานที่ผู้จัดการมอบหมายในหน้า "ตรวจงานประจำวัน" ของวันนี้ · ส่งงานแล้วสถานะกลับไปให้ผู้จัดการตรวจ
  const { rows: drows, ids: dids, update: updDaily } = useCrud(`daily-${iso()}`, []);
  const tasks: Task[] = drows
    .map((r, k) => ({ id: k + 1, rid: dids[k], who: r[0], title: r[1], time: String(r[3] ?? "").slice(0, 5), ins: r[6] && r[6] !== "-" ? r[6] : "ไม่มีคำสั่งงานเพิ่มเติม", done: r[5] && r[5] !== "รอทำ" ? (r[8] && r[8] !== "-" ? String(r[8]).slice(0, 5) : "ส่งแล้ว") : undefined, note: r[9] && r[9] !== "-" ? r[9] : "", shift: r[4], status: r[5], by: r[10] && r[10] !== "-" ? r[10] : undefined, owner: r[2] && r[2] !== "-" ? r[2] : undefined }))
    .sort((a, b) => a.time.localeCompare(b.time));
  // คิวจ่ายยา = ซองยาที่ห้องยาจัด (แอปจัดยา) ของวันนี้ · ตรวจ QA ผ่านแล้วจึงจ่ายได้
  const [packs, setPacks] = useRecords<Pack>("pharmacy-packs", []);
  const [drugs] = useRecords<Drug>("pharmacy-drugs", DRUGS0);
  const { add: addHealth } = useCrud("health", HEALTH);
  const { residents: live } = useResidents();
  // รายชื่อจริงจากทะเบียนผู้รับบริการ (สำเนาในเครื่องใช้ตอนออฟไลน์) · ไม่ใช้ชื่อตัวอย่าง
  const RESIDENTS = live.map((r) => ({ id: r.id, name: r.full_name, room: r.room ?? "-", age: r.age ?? "-" }));
  // นัดหมายและงานส่วนกลาง: ชุดข้อมูลเดียวกับที่ผู้จัดการ/หัวหน้าพยาบาลบันทึกในระบบจัดการ
  const { rows: apptRows } = useCrud("appointments", []);
  const { rows: facilityRows } = useCrud("facility", []);
  const tomorrowIso = new Date(Date.now() + 7 * 3600e3 + 864e5).toISOString().slice(0, 10);
  const appts = upcomingAppts(apptRows).filter(({ r }) => apptIso(r[0]) <= tomorrowIso).map(({ r }) => ({ who: r[2], what: r[3], when: `${apptIso(r[0]) === iso() ? "วันนี้" : "พรุ่งนี้"} ${(r[1] ?? "").slice(0, 5)}`, by: r[4] }));
  const [profile, setProfile] = useState<string | null>(null);
  const [vitalsFor, setVitalsFor] = useState<string | null>(null);
  const todayIso = iso();
  const queue = packs.filter((p) => p.date === todayIso).sort((a, b) => MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal) || a.who.localeCompare(b.who, "th"));
  const ready = queue.filter((p) => p.qa === "ตรวจผ่าน" && !p.given);
  const lowFor = (who: string) => drugs.filter((x) => x.who === who && !x.hold && (daysLeft(x) ?? 99) <= 2);
  const [handover, setHandover] = useRecords("staff-handover", HANDOVER0);
  const [bonus, setBonus] = useState(0);
  const [menu, setMenu] = useState(false);
  const [fab, setFab] = useState(false);
  const [modal, setModal] = useState<null | "task" | "sop" | "bonus" | "dispense" | "metrics" | "handover" | "write" | "pwd" | "manual" | "viewtask">(null);
  const [cur, setCur] = useState<number | null>(null);
  const [photo, setPhoto] = useState("");
  const [note, setNote] = useState("");
  const [shareFam, setShareFam] = useState(true);
  const [bonusWho, setBonusWho] = useState("");
  const [bonusText, setBonusText] = useState("");
  const [hoText, setHoText] = useState("");
  const [hoWho, setHoWho] = useState("");
  const [hoType, setHoType] = useState(TYPES[0]);
  const [rep, setRep] = useState({ who: "", day: "วันนี้" });
  const [praised, setPraised] = useState<string[]>([]);
  // อัปเดตถึงครอบครัว (ข้อความ/รูป) และลิงก์ให้ญาติ
  const [fu, setFu] = useState<{ id: string; name: string; text: string; photo: string; busy: boolean } | null>(null);
  const [linkFor, setLinkFor] = useState<string | null>(null);
  const sendFamilyUpdate = async () => {
    if (!fu) return;
    if (!fu.text.trim() && !fu.photo) return toast("พิมพ์ข้อความหรือแนบรูปอย่างน้อยหนึ่งอย่าง");
    setFu({ ...fu, busy: true });
    try {
      const r = await fetch("/api/care", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "family_update", residentId: fu.id, text: fu.text, photo: fu.photo || undefined }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "ส่งไม่สำเร็จ");
      toast(`ส่งอัปเดตของ${fu.name}ให้ครอบครัวแล้ว · ญาติเห็นในสมุดภาพประจำวัน`);
      setFu(null);
    } catch (e) { toast((e as Error).message); setFu((x) => (x ? { ...x, busy: false } : x)); }
  };

  const close = () => { setModal(null); setPhoto(""); setNote(""); setShareFam(true); setCur(null); setMenu(false); setProxyFor(null); };
  const open = (m: NonNullable<typeof modal>, i: number | null = null) => { setCur(i); setPhoto(""); setNote(""); setModal(m); };
  // งานของฉัน = งานที่ระบุชื่อฉัน หรืองานที่ไม่ระบุคนในกะที่ฉันเข้าเวร (จากตารางเวร)
  const [myShift, setMyShift] = useState<string | null | undefined>(undefined);
  useEffect(() => { fetchToday().then((d) => setMyShift(d.shift?.shift ?? null)).catch(() => setMyShift(null)); }, []);
  const isMine = (k: Task) => k.owner === user.name || (!k.owner && !!myShift && k.shift === `กะ${myShift}`);
  const [taskView, setTaskView] = useState<"mine" | "all">("mine");
  // ส่งงานได้: งานที่ระบุชื่อฉัน · งานกลางของเวรที่ฉันเข้า · หัวหน้าพยาบาล/ผู้ตรวจงาน ส่งงานกลางได้ทุกเวร
  // งานของคนอื่น (หรืองานกลางของเวรอื่น) ต้องกด "ทำแทน" และยืนยัน ระบบบันทึกว่าใครทำแทนใคร
  const canSubmit = (k: Task) => k.owner === user.name || (!k.owner && (isMine(k) || can(user, "tasks.review")));
  const ownerOf = (k: Task) => k.owner || `ทีม${k.shift ?? "เวร"}`;
  const [proxyFor, setProxyFor] = useState<string | null>(null);
  const doFor = (k: Task) => confirm({ title: "ทำงานแทน", message: `งาน "${k.title}" ของ${k.who} มอบหมายให้ ${ownerOf(k)} ต้องการส่งงานนี้แทนใช่หรือไม่ ระบบจะบันทึกว่าคุณ (${user.name}) ทำแทน ${ownerOf(k)} และผู้จัดการจะเห็นตอนตรวจงาน`, okLabel: "ทำแทน",
    onOk: () => { open("task", k.id); setProxyFor(ownerOf(k)); } });
  // รีวิวจากครอบครัวของฉัน (คะแนนเฉลี่ยย้อนหลัง 90 วัน)
  const [myRev, setMyRev] = useState<{ reviews: number; avg: number | null; recent: StaffReview[] } | null>(null);
  useEffect(() => { fetch("/api/reviews?op=mine", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setMyRev).catch(() => {}); }, []);
  const myStars = myRev?.avg ? myRev.avg.toFixed(1) : "-";
  // KPI เดือนนี้: อันดับในสาขา (รายละเอียดแยกส่วนเห็นเฉพาะของตัวเอง)
  const [kpi, setKpi] = useState<KpiResp | null>(null);
  useEffect(() => {
    if (tab !== "fame") return;
    const d = new Date();
    fetch(`/api/kpi?month=${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setKpi).catch(() => {});
  }, [tab]);
  const doneTasks = tasks.filter((t) => t.done);
  // รูปหลักฐานของงานที่ส่งแล้ว (โหลดเฉพาะตอนเปิดแท็บผลงานทีม)
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const doneIds = doneTasks.map((t) => t.rid).filter(Boolean).join(",");
  useEffect(() => {
    if (tab !== "team" || !doneIds) return;
    fetch(`/api/care?op=task_photos&ids=${encodeURIComponent(doneIds)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : { photos: {} })).then((d) => setPhotos(d.photos ?? {})).catch(() => {});
  }, [tab, doneIds]);
  // งานที่ฉันส่งแล้ววันนี้ (ล่าสุดก่อน)
  const mySent = doneTasks.filter((k) => k.by === user.name).sort((a, b) => String(b.done).localeCompare(String(a.done)));
  const pendingAll = tasks.filter((t) => !t.done);
  const myPending = pendingAll.filter(isMine);
  const waiting = taskView === "mine" ? myPending : pendingAll;
  const t = cur !== null ? tasks.find((x) => x.id === cur) : undefined;
  const [review, setReview] = useState<{ stars: number | null; note: string | null; by: string | null } | null>(null);
  useEffect(() => {
    setReview(null);
    if (modal !== "viewtask" || !t?.rid) return;
    fetch(`/api/care?op=task_photo&id=${encodeURIComponent(t.rid)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      if (d.photo) setPhotos((p) => ({ ...p, [t.rid!]: d.photo }));
      setReview({ stars: d.stars ?? null, note: d.note ?? null, by: d.by ?? null });
    }).catch(() => {});
  }, [modal, t?.rid]); // eslint-disable-line react-hooks/exhaustive-deps
  const md = cur !== null ? packs.find((x) => x.id === cur) : undefined;
  const unread = handover.length;
  const mine = doneTasks.length + bonus;

  return (
    <div className="staff-app mx-auto min-h-dvh w-full max-w-lg pb-28 sm:border-x sm:border-cream-300/60" onClick={() => menu && setMenu(false)}>
      {/* header */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-cream-300/60 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <Image src="/logo-mark.png" alt="KIN" width={44} height={33} className="h-9 w-auto" />
          <div className="leading-tight"><p className="text-[15px] font-semibold text-gold-800">KinApp</p><p className="text-[11px] font-medium text-gold-600">สาขา{user.branch || "-"}</p></div>
        </div>
        <div className="flex items-center gap-2">
          <AlertsBell compact />
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setMenu(!menu)} className="flex min-w-0 max-w-[40vw] items-center gap-2 rounded-full border border-cream-300 py-1 pl-1 pr-1 text-sm sm:max-w-none sm:pr-3" aria-label={user.name}><span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-gold-700 text-xs font-semibold text-white">{user.name.charAt(0)}</span><span className="hidden truncate sm:inline">{user.name}</span></button>
            {menu && (
              <div className="absolute right-0 top-[calc(100%+8px)] w-56 overflow-hidden rounded-2xl border border-cream-300 bg-white shadow-soft">
                <div className="border-b border-cream-300/60 px-4 py-3"><p className="text-sm font-medium">{user.name}</p><p className="text-xs text-gold-500">{ROLE_INFO[user.role].th} · {user.branch}</p></div>
                {!pwa.installed && <button className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-gold-800 hover:bg-cream-100" onClick={async () => {
                  setMenu(false);
                  if (pwa.canInstall) { if (await pwa.install()) toast("ติดตั้ง KinApp แล้ว เปิดได้จากหน้าจอโทรศัพท์"); }
                  else toast(pwa.iosHint ? "กดปุ่มแชร์ของ Safari แล้วเลือก \"เพิ่มไปยังหน้าจอโฮม\"" : "เปิดเมนูของเบราว์เซอร์ (⋮) แล้วเลือก \"ติดตั้งแอป\" หรือ \"เพิ่มลงในหน้าจอหลัก\"");
                }}><Icon name="download" className="h-4 w-4" /> ติดตั้ง KinApp บนเครื่อง</button>}
                <button className="flex w-full items-center gap-2 px-4 py-3 text-sm hover:bg-cream-100" onClick={() => open("manual")}><Icon name="book" className="h-4 w-4" /> คู่มือผู้ใช้งาน</button>
                <button className="flex w-full items-center gap-2 px-4 py-3 text-sm hover:bg-cream-100" onClick={() => open("pwd")}><Icon name="lock" className="h-4 w-4" /> เปลี่ยนรหัสผ่าน</button>
                <button className="flex w-full items-center gap-2 px-4 py-3 text-sm text-red-600 hover:bg-red-50" onClick={onLogout}><Icon name="logout" className="h-4 w-4" /> ออกจากระบบ</button>
              </div>
            )}
          </div>
        </div>
        <div className="absolute inset-x-0 top-full"><OfflineBar /></div>
      </header>

      <main className="space-y-4 px-4 py-5">
        <BranchNotice user={user} />
        {tab === "tasks" && (
          <>
            <section className="staff-welcome relative overflow-hidden">
              <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/10" />
              <p className="text-sm text-white/80">{today()}</p>
              <h1 className="mt-1 text-xl font-semibold">พร้อมสำหรับการดูแลวันนี้</h1>
              <p className="mt-1 text-sm text-white/80">ภารกิจวันนี้: {tasks.length} งาน (ตัดกะ 07:00 น.)</p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-white/15 p-3"><p className="text-xs text-white/75">ผลงานคุณวันนี้</p><p className="mt-1 text-2xl font-semibold">{mine} <span className="text-sm font-normal">งาน</span></p></div>
                <div className="rounded-2xl bg-white/15 p-3"><p className="text-xs text-white/75">ดาวจากครอบครัว</p><p className="mt-1 text-2xl font-semibold">{myStars} <span className="text-sm font-normal">({myRev?.reviews ?? 0} รีวิว)</span></p></div>
              </div>
            </section>

            <CheckInCard user={user} />

            <button onClick={() => open("handover")} className="flex w-full items-center gap-3 rounded-3xl border border-cream-300/70 bg-cream-50 p-4 text-left">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gold-100 text-gold-700"><Icon name="book" /></span>
              <span className="flex-1"><span className="block font-semibold text-gold-800">สมุดส่งเวร (Handover)</span><span className="text-xs text-gold-600">{unread} เรื่องที่ต้องตามต่อ</span></span>
              <Count n={unread} />
            </button>

            <Card title="แจ้งเตือนนัดแพทย์ (วันนี้-พรุ่งนี้)" icon="bell">
              {appts.length === 0 ? <Empty t="ไม่มีนัดหมายวันนี้และพรุ่งนี้" /> : <ul className="space-y-2">{appts.map((a, k) => (
                <li key={k} className="flex items-center justify-between gap-3 rounded-2xl bg-cream-50 px-4 py-3 text-sm"><span><b className="font-medium">{a.who}</b><span className="block text-xs text-gold-600">{a.what}</span></span><span className="shrink-0 text-xs font-medium text-gold-700">{a.when}</span></li>
              ))}</ul>}
            </Card>

            <Card title="งานที่รอทำ" icon="check" right={<div className="seg"><button type="button" aria-pressed={taskView === "mine"} onClick={() => setTaskView("mine")}>ของฉัน ({myPending.length})</button><button type="button" aria-pressed={taskView === "all"} onClick={() => setTaskView("all")}>ทั้งหมด ({pendingAll.length})</button></div>}>
              <p className="mb-3 rounded-2xl bg-cream-50 px-3 py-2 text-xs text-gold-700">
                {myShift === undefined ? "กำลังตรวจตารางเวร…" : myShift ? <>เวรของคุณวันนี้: <b>เวร{myShift} {SHIFTS.find((x) => x.key === myShift)?.time}</b> · งานของฉัน = งานที่ระบุชื่อคุณ และงานของทีม{`กะ${myShift}`}</> : <>วันนี้ไม่มีเวรของคุณในตาราง · แสดงเฉพาะงานที่ระบุชื่อคุณ กด &quot;ทั้งหมด&quot; เพื่อดูงานทั้งสาขา</>}
              </p>
              {waiting.length === 0 ? <Empty t={taskView === "mine" && pendingAll.length ? "ไม่มีงานของคุณค้างแล้ว · กด \"ทั้งหมด\" เพื่อดูงานของทีม" : tasks.length ? "ไม่มีงานค้างแล้ว เยี่ยมมาก" : "ยังไม่มีงานที่ผู้จัดการมอบหมายสำหรับวันนี้"} /> : (
                <ul className="space-y-3">{waiting.map((k) => (
                  <li key={k.id} className={`rounded-2xl border border-cream-300/70 p-4 ${canSubmit(k) ? "" : "task-other"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="font-medium text-gold-900">{k.title}</p><p className="mt-0.5 text-sm text-gold-600">{k.who}</p>
                        <p className={`task-owner ${k.owner === user.name ? "is-me" : !k.owner ? "is-team" : ""}`}>{k.owner === user.name ? "งานของคุณ" : k.owner ? `มอบหมายให้ ${k.owner}` : canSubmit(k) ? `ทีม${k.shift ?? "เวร"} · ใครในเวรก็ทำได้` : `งานของทีม${k.shift ?? "เวร"} · เฉพาะคนที่เข้าเวรนี้`}</p></div>
                      <span className="shrink-0 rounded-full bg-gold-100 px-2.5 py-1 text-xs font-medium text-gold-700">{k.time}{k.shift ? ` · ${k.shift}` : ""}</span>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button className="btn-soft flex-1 !py-2.5" onClick={() => open("sop", k.id)}>คู่มือปฏิบัติงาน</button>
                      {canSubmit(k)
                        ? <button className="btn-primary flex-1 !py-2.5" onClick={() => { open("task", k.id); setProxyFor(null); }}>ส่งงาน</button>
                        : <button className="btn-soft flex-1 !py-2.5" onClick={() => doFor(k)}>ทำแทน</button>}
                    </div>
                  </li>
                ))}</ul>
              )}
            </Card>

            <Card title="งานที่ฉันส่งแล้ววันนี้" icon="doc" right={<Count n={mySent.length} />}>
              {mySent.length === 0 ? <Empty t="ยังไม่มีงานที่คุณส่งวันนี้" /> : <ul className="space-y-2">{mySent.map((k) => (
                <li key={k.id} className="flex items-center gap-3 rounded-2xl border border-cream-300/70 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-gold-900">{k.title}</p>
                    <p className="text-xs text-gold-600">{k.who} · ส่ง {k.done} น.{(k.note ?? "").startsWith("ทำแทน") ? " · ทำแทน" : ""}</p>
                    <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${k.status === "ตรวจแล้ว" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>{k.status === "ตรวจแล้ว" ? "ตรวจแล้ว" : "รอหัวหน้าตรวจ"}</span>
                  </div>
                  <button className="btn-soft shrink-0 !min-h-0 !px-3 !py-2 text-xs" onClick={() => open("viewtask", k.id)}>ดูรายละเอียด</button>
                </li>
              ))}</ul>}
            </Card>

            <Card title="งานส่วนกลางตามรอบ" icon="building" right={<Count n={facilityRows.length} />}>
              {facilityRows.length === 0 ? <Empty t="ยังไม่มีงานส่วนกลางของสาขา (ผู้จัดการเพิ่มได้ที่เมนูงานทั่วไปของศูนย์)" /> : <ul className="space-y-2">{facilityRows.map((f, k) => (
                <li key={k} className="flex items-center justify-between gap-3 rounded-2xl bg-cream-50 px-4 py-3 text-sm"><span>{f[0]}<span className="block text-xs text-gold-500">{[f[1], f[2]].filter((x) => x && x !== "-").join(" · ")}</span></span></li>
              ))}</ul>}
            </Card>
          </>
        )}

        {tab === "roster" && <StaffRoster user={user} />}
        {tab === "meds" && (
          <>
            <Card title="คิวจ่ายยาวันนี้" icon="pill" right={<Link href="/pharmacy?page=dispense" className="btn-soft !min-h-0 !px-3 !py-1.5 text-xs">เปิดแอปจัดยา (Pharmacy Hub)</Link>}>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-2xl bg-amber-50 p-3"><p className="text-2xl font-semibold text-amber-700">{ready.length}</p><p className="text-xs text-amber-700">พร้อมจ่าย</p></div>
                <div className="rounded-2xl bg-cream-100 p-3"><p className="text-2xl font-semibold text-gold-700">{queue.filter((m) => m.qa !== "ตรวจผ่าน").length}</p><p className="text-xs text-gold-600">รอห้องยาตรวจ</p></div>
                <div className="rounded-2xl bg-emerald-50 p-3"><p className="text-2xl font-semibold text-emerald-700">{queue.filter((m) => m.given).length}</p><p className="text-xs text-emerald-700">จ่ายแล้ว</p></div>
              </div>
              <p className="mt-3 text-xs leading-6 text-gold-600">ซองยามาจากห้องยา (แอปจัดยา) · จ่ายได้เมื่อห้องยาตรวจ QA ผ่านแล้ว · กดจ่ายแล้วระบบบันทึกชื่อผู้ให้ยาและเวลา</p>
            </Card>
            {queue.length === 0 ? <Empty t="ยังไม่มีซองยาของวันนี้ ห้องยาจัดยาได้ที่แอปจัดยา" /> : (
              <ul className="space-y-3">{queue.map((m) => {
                const low = lowFor(m.who);
                return (
                  <li key={m.id} className={`rounded-3xl border p-4 ${m.given ? "border-emerald-200 bg-emerald-50/50" : "border-cream-300/70 bg-white shadow-soft"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0"><p className="font-semibold text-gold-900">{m.who}</p><p className="text-sm text-gold-600">มื้อ{m.meal} · {m.items.length} รายการ</p></div>
                      {m.given ? <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-700">จ่ายแล้ว</span>
                        : m.qa === "ตรวจผ่าน" ? <button className="btn-primary shrink-0 !px-4 !py-2" onClick={() => open("dispense", m.id)}>จ่ายยา</button>
                          : <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${m.qa === "แจ้งจัดยาผิด" ? "bg-red-100 text-red-700" : "bg-cream-200 text-gold-700"}`}>{m.qa === "แจ้งจัดยาผิด" ? "ห้องยากำลังแก้ไข" : "รอห้องยาตรวจ"}</span>}
                    </div>
                    <ul className="mt-2 space-y-0.5 text-sm text-gold-700">{m.items.map((x) => <li key={x}>• {x}</li>)}</ul>
                    {m.given && <p className="mt-2 text-xs text-emerald-800">ให้ยาโดย {m.gby ?? "-"}{m.gat ? ` · ${m.gat}` : ""}</p>}
                    {!m.given && low.length > 0 && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">ระวังยาใกล้หมด: {low.map((x) => `${x.name} เหลือ ${x.stock} ${x.unit}`).join(", ")}</p>}
                  </li>
                );
              })}</ul>
            )}
          </>
        )}

        {tab === "residents" && (
          <Card title="ผู้รับบริการ (สาขาของคุณ)" icon="user">
            <ul className="space-y-3">{RESIDENTS.map((r) => (
              <li key={r.name} className="flex items-center gap-3 rounded-2xl border border-cream-300/70 p-3">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gold-100 text-lg font-semibold text-gold-700">{r.name.replace("คุณ", "").charAt(0)}</span>
                <div className="min-w-0 flex-1"><p className="truncate font-medium">{r.name}</p><p className="text-xs text-gold-600">ห้อง {r.room} · อายุ {r.age} ปี</p></div>
                <div className="flex shrink-0 flex-col gap-1.5">
                  <button className="btn-primary !min-h-0 !px-3 !py-1.5 text-xs" onClick={() => setVitalsFor(r.name)}>สัญญาณชีพ</button>
                  {r.id && <button className="btn-soft !min-h-0 !px-3 !py-1.5 text-xs" onClick={() => setProfile(r.id!)}>ประวัติ</button>}
                  {r.id && <button className="btn-soft !min-h-0 !px-3 !py-1.5 text-xs" onClick={() => setFu({ id: r.id!, name: r.name, text: "", photo: "", busy: false })}>ส่งข่าวญาติ</button>}
                  {r.id && <button className="btn-soft !min-h-0 !px-3 !py-1.5 text-xs" onClick={() => setLinkFor(r.id!)}>ลิงก์ญาติ</button>}
                </div>
              </li>
            ))}</ul>
          </Card>
        )}

        {tab === "team" && (
          <>
            <Card title="ผลงานของทีมวันนี้" icon="grid">
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="rounded-2xl bg-cream-50 p-3"><p className="text-2xl font-semibold text-gold-700">{mine}</p><p className="text-xs text-gold-600">งานที่ทำเสร็จ</p></div>
                <div className="rounded-2xl bg-cream-50 p-3"><p className="text-2xl font-semibold text-gold-700">{myStars}</p><p className="text-xs text-gold-600">ดาวจากครอบครัว (ของฉัน)</p></div>
              </div>
              <ul className="mt-3 space-y-2">{doneTasks.length === 0 ? <Empty t="ยังไม่มีงานที่ทำเสร็จวันนี้" /> : doneTasks.map((k) => (
                <li key={k.id}><button onClick={() => open("viewtask", k.id)} className="team-done">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {k.rid && photos[k.rid] ? <img src={photos[k.rid]} alt={`รูปงาน ${k.title}`} /> : <span className="team-done-nophoto"><Icon name="camera" className="h-5 w-5" /></span>}
                  <span className="min-w-0 flex-1"><b>{k.title}</b><small>{k.who}</small><small>โดย {k.by ?? "-"}</small></span>
                  <span className="shrink-0 text-xs text-gold-600">{k.done}</span>
                </button></li>
              ))}</ul>
            </Card>
            <Card title="รีวิวจากครอบครัว (ของฉัน)" icon="trophy" right={myRev?.reviews ? <span className="review-stars text-sm">{"★".repeat(Math.floor(myRev.avg ?? 0))}</span> : undefined}>
              {!myRev?.recent.length ? <Empty t="ยังไม่มีรีวิว · ผู้จัดการสาขาส่งลิงก์รีวิวให้ญาติได้ที่เมนู &quot;รีวิวพนักงาน&quot;" /> : (
                <ul className="space-y-2">{myRev.recent.slice(0, 5).map((r) => (
                  <li key={r.id} className="rounded-2xl bg-cream-50 px-4 py-3 text-sm">
                    <div className="flex items-center justify-between gap-2"><span className="review-stars">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span><span className="text-xs text-gold-500">{r.at}</span></div>
                    {r.comment && <p className="mt-1 text-gold-900">&ldquo;{r.comment}&rdquo;</p>}
                    {r.tags.length > 0 && <p className="mt-1 text-xs text-gold-600">{r.tags.join(" · ")}</p>}
                    <p className="mt-1 text-xs text-gold-500">{[r.rater_name || "ญาติ", r.relation].filter(Boolean).join(" · ")} ของ{r.resident_name}</p>
                  </li>
                ))}</ul>
              )}
            </Card>
            <Card title="สรุปรายงานประจำวัน (ตอบญาติ)" icon="doc">
              <p className="mb-3 text-xs text-gold-600">รวมข้อมูลรายงานสุขภาพ (สัญญาณชีพ/อาหาร/ขับถ่าย) การให้ยา เรื่องเฝ้าระวัง และโน้ตการทำงาน รายบุคคล เพื่อให้พนักงานทุกคนตอบคำถามญาติได้ตรงกัน</p>
              <Select options={RESIDENTS.map((r) => r.name)} placeholder="-- เลือกผู้รับบริการเพื่อดูข้อมูลตอบญาติ --" value={rep.who} onChange={(v) => setRep({ ...rep, who: v })} />
              <div className="my-3 flex gap-2">{["วันนี้", "เมื่อวาน"].map((d) => <button key={d} onClick={() => setRep({ ...rep, day: d })} className={`flex-1 rounded-full py-2 text-sm ${rep.day === d ? "bg-gold-700 text-white" : "bg-cream-200 text-gold-700"}`}>{d}</button>)}</div>
              {rep.who ? (() => {
                const r = RESIDENTS.find((x) => x.name === rep.who);
                return r?.id ? <button className="btn-primary w-full" onClick={() => setProfile(r.id!)}><Icon name="doc" className="h-4 w-4" /> เปิดประวัติของ {rep.who}</button>
                  : <Empty t="ไม่พบผู้รับบริการคนนี้ในทะเบียน" />;
              })() : <Empty t="กรุณาเลือกผู้รับบริการด้านบนเพื่อดูสรุปสุขภาพและไทม์ไลน์ตอบญาติ" />}
            </Card>
          </>
        )}

        {tab === "fame" && (
          <>
            <div>
              <h1 className="text-xl font-semibold text-gold-800">กระดานเกียรติยศ</h1>
              <p className="text-sm text-gold-600">อันดับจาก KPI เดือนนี้: ดาวจากครอบครัว ดาวจากผู้จัดการ งานที่ส่ง และการมาตรงเวลา</p>
            </div>
            {(() => {
              const ranked = (kpi?.rows ?? []).filter((r) => r.total != null);
              const me = kpi?.rows.find((r) => r.id === user.id);
              const sc = me ? { family: me.family?.score ?? null, manager: me.manager?.score ?? null, tasks: me.tasks?.score ?? null, punctual: me.punctual?.score ?? null } : null;
              return (<>
                {ranked[0] && (
                  <section className="rounded-3xl bg-gradient-to-br from-gold-700 to-gold-400 p-5 text-white shadow-soft">
                    <p className="text-xs tracking-wider text-white/80">พนักงานดีเด่นประจำเดือน · สาขา{user.branch}</p>
                    <p className="mt-1 text-xl font-semibold">{ranked[0].name}</p>
                    <p className="text-sm text-white/80">KPI {ranked[0].total} คะแนน</p>
                  </section>
                )}
                {me && sc && kpi && (
                  <Card title={`KPI ของฉัน · ${me.total ?? "-"} คะแนน`} icon="chart" right={me.rank ? <span className="text-xs font-medium text-gold-700">อันดับ {me.rank}/{ranked.length}</span> : undefined}>
                    <ul className="kpi-parts">{KPI_PARTS.map((p) => {
                      const v = sc[p.key]; const pts = pointsOf(p.key, sc, kpi.weights);
                      return (
                        <li key={p.key} className={v == null ? "is-empty" : ""}>
                          <div className="kpi-part-head"><b>{p.label}</b><span>{kpi.weights[p.key]}%</span></div>
                          <div className="kpi-bar"><i style={{ width: `${v ?? 0}%` }} /></div>
                          <div className="kpi-part-foot"><span>{v == null ? "ยังไม่มีข้อมูล" : `${v}/100`}</span><span>ได้ <b>{pts ?? "-"}</b> คะแนน</span></div>
                        </li>
                      );
                    })}</ul>
                  </Card>
                )}
                <Card title="อันดับในสาขา" icon="trophy">
                  {!ranked.length ? <Empty t="ยังไม่มีคะแนน KPI ของเดือนนี้" /> : (
                    <ol className="space-y-2">{ranked.map((r) => (
                      <li key={r.id} className={`rounded-2xl p-3 ${r.id === user.id ? "bg-gold-100" : "bg-cream-50"}`}>
                        <div className="flex items-center gap-3 text-sm">
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gold-700 text-xs font-semibold text-white">{r.rank}</span>
                          <span className="min-w-0 flex-1"><b className="font-medium">{r.name}{r.id === user.id ? " (ฉัน)" : ""}</b></span>
                          <span className="font-semibold text-gold-700">{r.total}</span>
                          {r.id !== user.id && <button className={`rounded-lg px-2.5 py-1 text-xs ${praised.includes(r.name) ? "bg-gold-700 text-white" : "bg-white text-gold-700"}`} onClick={() => { setPraised(praised.includes(r.name) ? praised.filter((x) => x !== r.name) : [...praised, r.name]); }}>ชื่นชม</button>}
                        </div>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-cream-300"><div className="h-full rounded-full bg-gold-500" style={{ width: `${r.total ?? 0}%` }} /></div>
                      </li>
                    ))}</ol>
                  )}
                </Card>
              </>);
            })()}
          </>
        )}
      </main>

      {/* FAB */}
      {tab === "tasks" && (
        <div className="fixed bottom-24 left-1/2 z-30 w-full max-w-lg -translate-x-1/2 px-4">
          <div className="flex flex-col items-end gap-2">
            {fab && (
              <div className="w-64 overflow-hidden rounded-2xl border border-cream-300 bg-white shadow-soft">
                <button className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-cream-100" onClick={() => { setFab(false); setBonusWho(""); setBonusText("ภาพประทับใจส่งญาติ"); open("bonus"); }}><Icon name="camera" className="h-5 w-5 text-gold-600" /><span>ภาพประทับใจส่งญาติ<span className="block text-xs text-gold-500">(ได้ดาว)</span></span></button>
                <button className="flex w-full items-center gap-3 border-t border-cream-300/60 px-4 py-3 text-left text-sm hover:bg-cream-100" onClick={() => { setFab(false); setBonusWho(""); setBonusText(""); open("bonus"); }}><Icon name="alert" className="h-5 w-5 text-gold-600" /><span>แจ้งงาน/เก็บตกด่วน<span className="block text-xs text-gold-500">(ฮีโร่ +1)</span></span></button>
              </div>
            )}
            <button onClick={() => setFab(!fab)} aria-label="เพิ่มผลงานพิเศษ" className="grid h-14 w-14 place-items-center rounded-full bg-gold-700 text-white shadow-2xl transition active:scale-95"><Icon name={fab ? "close" : "plus"} className="h-6 w-6" /></button>
          </div>
        </div>
      )}

      {/* bottom nav */}
      <nav aria-label="เมนูล่าง" className="fixed bottom-0 left-1/2 z-30 grid w-full max-w-lg -translate-x-1/2 grid-cols-6 border-t border-cream-300/70 bg-white/95 px-2 pb-[env(safe-area-inset-bottom)] pt-1.5 backdrop-blur">
        {TABS.map((x) => (
          <button key={x.id} aria-current={tab === x.id ? "page" : undefined} onClick={() => { setTab(x.id); setFab(false); window.scrollTo(0, 0); }} className={`flex flex-col items-center gap-0.5 rounded-xl py-2 text-[10.5px] ${tab === x.id ? "text-gold-700" : "text-gold-400"}`}>
            <span className={`grid h-8 w-11 place-items-center rounded-full transition ${tab === x.id ? "bg-gold-100" : ""}`}><Icon name={x.icon} className="h-5 w-5" /></span>{x.label}
          </button>
        ))}
      </nav>

      {/* ส่งอัปเดตให้ครอบครัว */}
      <Modal open={!!fu} title={fu ? `ส่งข่าวถึงครอบครัวของ${fu.name}` : ""} onClose={() => setFu(null)}
        footer={<button className="btn-primary w-full" disabled={fu?.busy} onClick={sendFamilyUpdate}>{fu?.busy ? "กำลังส่ง…" : "ส่งให้ครอบครัว"}</button>}>
        {fu && <div className="space-y-4">
          <p className="rounded-2xl bg-cream-50 p-3 text-xs text-gold-600">ข้อความและรูปนี้จะขึ้นในสมุดภาพประจำวันที่ญาติเปิดผ่านลิงก์ (กดปุ่ม "ลิงก์ญาติ" เพื่อคัดลอกส่งทาง LINE) · ไม่ต้องใส่ข้อมูลสุขภาพที่ละเอียดอ่อน</p>
          <Field label="ข้อความ"><textarea rows={4} maxLength={1000} value={fu.text} onChange={(e) => setFu({ ...fu, text: e.target.value })} placeholder="ตัวอย่าง: วันนี้คุณยายทานข้าวหมดจาน อารมณ์ดี ทำกายภาพบำบัดได้ 20 นาที" /></Field>
          <PhotoInput label="แตะเพื่อถ่ายรูป หรือเลือกรูป (ไม่บังคับ)" file={fu.photo} onFile={(p) => setFu((x) => (x ? { ...x, photo: p } : x))} />
        </div>}
      </Modal>
      <FamilyLinkDialog open={!!linkFor} residentId={linkFor ?? ""} onClose={() => setLinkFor(null)} />

      {/* ส่งงาน */}
      <Modal open={modal === "task"} title="ส่งงาน (Proof of Work)" onClose={close}
        footer={<button className="btn-primary w-full" onClick={() => {
          if (!photo) return toast("กรุณาถ่ายภาพก่อนส่งงาน");
          const k = (cur as number) - 1;
          const row = [...drows[k]]; while (row.length < 11) row.push("-");
          const now = new Date();
          row[5] = "เสร็จแล้ว"; row[8] = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`; row[9] = [proxyFor ? `ทำแทน ${proxyFor}` : "", note.trim()].filter(Boolean).join(" · ") || "-"; row[10] = user.name;
          updDaily(k, row);
          // รูปหลักฐาน: ประทับวันเวลา ผู้รับบริการ และชื่องาน แล้วเก็บแยกให้ผู้จัดการเปิดดูตอนตรวจงาน
          const id = dids[k];
          stampPhoto(photo, [`ส่งงาน ${now.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} น. · ${now.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" })}`, `${row[0]} · ${row[1]}`, `${user.name} · สาขา${user.branch ?? "-"}`])
            .then((p) => fetch("/api/care", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "task_photo", id, photo: p, share: shareFam }) }))
            .then((r) => { if (!r.ok) throw new Error(); })
            .catch(() => toast("ส่งงานแล้ว แต่อัปโหลดรูปไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ต"));
          close(); toast(proxyFor ? `ส่งงานแทน ${proxyFor} เรียบร้อย` : "ส่งงานเรียบร้อย"); setProxyFor(null);
        }}>ยืนยันการส่งงาน</button>}>
        {t && <div className="space-y-4">
          <div className="rounded-2xl bg-cream-50 p-4 text-sm"><p className="font-semibold text-gold-900">{t.title}</p><p className="text-gold-600">{t.who} · เวลา: {t.time}</p></div>
          {proxyFor && <p className="rounded-2xl bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900">คุณกำลังส่งงานนี้แทน {proxyFor}</p>}
          <PhotoInput label="แตะเพื่อเปิดกล้องถ่ายรูป" file={photo} onFile={setPhoto} />
          <label className="share-toggle"><input type="checkbox" checked={shareFam} onChange={(e) => setShareFam(e.target.checked)} />
            <span><b>แชร์รูปนี้ให้ครอบครัวเห็น</b><small>ขึ้นในสมุดภาพประจำวันของ{t.who} · เอาติ๊กออกถ้ารูปติดผู้รับบริการคนอื่น หรือเห็นร่างกายส่วนที่ไม่ควรเปิดเผย</small></span></label>
          <Field label="บันทึกย่อ (Note) - ไม่บังคับ"><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="ตัวอย่าง: ทานอาหารหมดจาน, หลับสนิทดี, ร่วมกิจกรรมยิ้มแย้ม..." /><p className="mt-1 text-xs text-gold-500">ญาติเห็นบันทึกนี้ในสมุดภาพประจำวัน · เรื่องอาการที่ต้องแจ้งทีม ให้เขียนในสมุดส่งเวร</p></Field>
        </div>}
      </Modal>

      <Modal open={modal === "sop"} title="คู่มือปฏิบัติงาน" onClose={close} footer={<button className="btn-soft w-full" onClick={close}>ปิดหน้าต่าง</button>}>
        {t && <div className="space-y-3 text-sm"><p className="text-base font-semibold text-gold-900">{t.title}</p><p className="rounded-2xl bg-cream-50 p-4 leading-7">{t.ins}</p></div>}
      </Modal>

      <Modal open={modal === "viewtask"} title="ผลการปฏิบัติงาน" onClose={close} footer={<button className="btn-soft w-full" onClick={close}>ปิดหน้าต่าง</button>}>
        {t?.rid && photos[t.rid] && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photos[t.rid]} alt={`รูปหลักฐาน ${t.title}`} className="mb-4 w-full rounded-2xl" />
        )}
        {t && <dl className="space-y-3 text-sm">{[["ผู้รับบริการ", t.who], ["ชื่องาน", t.title], ["คำสั่งงาน", t.ins], ["ผู้ปฏิบัติงาน", t.by ?? user.name], ["เวลาที่ส่งจริง", t.done ?? "-"], ["บันทึกย่อ", t.note || "-"], ["สถานะ", t.status === "ตรวจแล้ว" ? `ตรวจแล้ว${review?.by ? ` โดย ${review.by}` : ""}` : "รอผู้จัดการหรือหัวหน้าพยาบาลตรวจ"], ...(review?.stars ? [["ดาวจากผู้ตรวจ", `${"★".repeat(review.stars)}${"☆".repeat(Math.max(0, 5 - review.stars))} (${review.stars}/5)`]] : []), ...(review?.note ? [["ความเห็นผู้ตรวจ", review.note]] : [])].map(([k, v]) => <div key={k}><dt className="text-xs text-gold-500">{k}</dt><dd className="font-medium">{v}</dd></div>)}</dl>}
      </Modal>

      {/* ผลงานพิเศษ */}
      <Modal open={modal === "bonus"} title="เพิ่มผลงานพิเศษ" onClose={close}
        footer={<button className="btn-primary w-full" onClick={() => {
          if (!bonusWho) return toast("กรุณาเลือกผู้รับบริการ");
          if (!bonusText.trim()) return toast("กรุณากรอกรายละเอียดงาน");
          if (!photo) return toast("กรุณาถ่ายภาพผลงาน");
          setBonus(bonus + 1); close(); toast("ส่งงานพิเศษเรียบร้อย");
        }}>ยืนยันส่งงานพิเศษ</button>}>
        <div className="space-y-4">
          <Field label="ผู้รับบริการ (Resident)"><Select options={RESIDENTS.map((r) => r.name)} placeholder="-- เลือกผู้รับบริการ --" value={bonusWho} onChange={setBonusWho} /></Field>
          <Field label="รายละเอียดงาน"><input value={bonusText} onChange={(e) => setBonusText(e.target.value)} placeholder="เช่น เช็ดน้ำหก, ถ่ายภาพรอยยิ้ม" /></Field>
          <div><p className="label">ถ่ายภาพผลงาน (บังคับ)</p><PhotoInput label="กดเพื่อถ่ายภาพ" file={photo} onFile={setPhoto} /></div>
          <p className="rounded-2xl bg-cream-50 p-3 text-xs leading-6 text-gold-600">แชร์ส่งให้ญาติทาง LINE พร้อมแนบลิงก์แอป Family (ส่งเสร็จจะมีปุ่มให้กดแชร์)</p>
        </div>
      </Modal>

      {/* จ่ายยา */}
      <Modal open={modal === "dispense"} title="ยืนยันการจ่ายยา" onClose={close}
        footer={<><button className="btn-soft" onClick={close}>ยกเลิก</button><button className="btn-primary" onClick={() => {
          if (!photo) return toast("กรุณาถ่ายรูปยืนยันการให้ยาก่อน (แตะช่องกล้องด้านบน)");
          setPacks(packs.map((m) => (m.id === cur ? { ...m, given: true, gby: user.name, gat: nowTh() } : m))); close(); toast("บันทึกการให้ยาแล้ว ห้องยาเห็นสถานะนี้ทันที");
        }}>ยืนยันว่าจ่ายแล้ว</button></>}>
        {md && <div className="space-y-4">
          <div className="rounded-2xl bg-cream-50 p-4"><p className="font-semibold text-gold-900">{md.who}</p><p className="text-sm text-gold-600">มื้อ{md.meal} · จัดโดย {md.by}{md.qby ? ` · ตรวจ QA โดย ${md.qby}` : ""}</p></div>
          {lowFor(md.who).length > 0 && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">ระวังยาใกล้หมด: {lowFor(md.who).map((x) => `${x.name} เหลือ ${x.stock} ${x.unit}`).join(", ")}</p>}
          <div><p className="label">รายการยาในซอง (ตรวจให้ตรงก่อนให้ยา):</p><ul className="space-y-1.5">{md.items.map((x) => <li key={x} className="rounded-xl border border-cream-300 px-3 py-2 text-sm">{x}</li>)}</ul></div>
          <div><p className="label">ถ่ายรูปยืนยันการให้ยา (จำเป็นต้องถ่ายสด):</p><PhotoInput label="แตะเพื่อเปิดกล้อง" file={photo} onFile={setPhoto} /></div>
        </div>}
      </Modal>

      {/* บันทึกสัญญาณชีพ (ลงบันทึกสุขภาพ · ค่าเกินเกณฑ์แจ้งเตือนพยาบาลอัตโนมัติ) */}
      <VitalsDialog open={vitalsFor !== null} residents={RESIDENTS.map((r) => r.name)} resident={vitalsFor ?? undefined} recorder={user.name}
        onClose={() => setVitalsFor(null)} onSave={(row) => addHealth(row)} />
      <ResidentProfile id={profile} onClose={() => setProfile(null)} />

      {/* สมุดส่งเวร */}
      <Modal open={modal === "handover"} title="สมุดส่งเวร" onClose={close} footer={<button className="btn-primary w-full" onClick={() => { setHoWho(""); setHoText(""); setModal("write"); }}><Icon name="plus" className="h-4 w-4" /> เขียนส่งเวรใหม่</button>}>
        <p className="mb-3 text-sm font-medium text-gold-700">เรื่องที่ต้องตามต่อ</p>
        {handover.length === 0 ? <Empty t="ไม่มีเรื่องค้าง" /> : (
          <ul className="space-y-3">{handover.map((h, i) => (
            <li key={i} className="rounded-2xl border border-cream-300/70 p-4 text-sm">
              <div className="flex items-center justify-between gap-2"><span className="rounded-full bg-gold-100 px-2.5 py-0.5 text-xs font-medium text-gold-700">{h.type}</span><span className="text-xs text-gold-500">{h.at}</span></div>
              <p className="mt-2 font-medium">{h.who}</p><p className="mt-0.5 text-gold-700">{h.text}</p>
              <div className="mt-3 flex items-center justify-between"><span className="text-xs text-gold-500">โดย {h.by}</span><button className="btn-soft !px-3 !py-1.5 text-xs" onClick={() => { setHandover(handover.filter((_, j) => j !== i)); toast("รับทราบและปิดเรื่องแล้ว"); }}>รับทราบ</button></div>
            </li>
          ))}</ul>
        )}
      </Modal>

      <Modal open={modal === "write"} title="บันทึกส่งเวร" onClose={() => setModal("handover")}
        footer={<button className="btn-primary w-full" onClick={() => {
          if (!hoWho || !hoText.trim()) return toast("กรุณาเลือกผู้ป่วยและกรอกรายละเอียด");
          setHandover([{ id: Date.now(), type: hoType, who: hoWho, text: hoText, by: user.name, at: "เมื่อสักครู่" }, ...handover]); setModal("handover"); toast("บันทึกส่งเวรแล้ว");
        }}>บันทึกส่งเวร</button>}>
        <div className="space-y-4">
          <Field label="1. ระบุผู้ป่วย"><Select options={RESIDENTS.map((r) => r.name)} placeholder="-- เลือก --" value={hoWho} onChange={setHoWho} /></Field>
          <div><p className="label">2. ประเภทเรื่องที่ส่ง</p><div className="grid grid-cols-2 gap-2">{TYPES.map((x) => <button key={x} type="button" onClick={() => setHoType(x)} className={`rounded-xl border px-3 py-2.5 text-sm ${hoType === x ? "border-gold-600 bg-gold-100 text-gold-800" : "border-cream-300 text-gold-600"}`}>{x}</button>)}</div></div>
          <Field label="3. รายละเอียด (พิมพ์ หรือ ใช้เสียงพูด)"><textarea rows={4} value={hoText} onChange={(e) => setHoText(e.target.value)} placeholder="ระบุรายละเอียดที่ต้องการส่งเวร..." /></Field>
        </div>
      </Modal>

      <Modal open={modal === "manual"} title="วิดีโอสอนใช้งาน" onClose={close} footer={<button className="btn-soft w-full" onClick={close}>ปิดหน้าต่าง</button>}><TutorialVideos only={[4, 5, 2, 3, 6, 1]} compact /></Modal>

      <PasswordDialog open={modal === "pwd"} onClose={close} />
    </div>
  );
}

/* ---------- หน้าเข้าสู่ระบบแอปพนักงาน ---------- */
export default function StaffApp() {
 const { user, ready, setUser, logout } = useSession();
 return <AppProvider go={()=>{}}>{!ready?<main className="grid min-h-dvh place-items-center text-sm text-gold-500">กำลังตรวจสอบการเข้าสู่ระบบ…</main>:user&&!can(user,"app.staff")?<CashierOnly name={user.name} app="KinApp" onLogout={logout} />:user?<App user={user} onLogout={logout} />:<Login staff onLogin={setUser} />}</AppProvider>;
}
