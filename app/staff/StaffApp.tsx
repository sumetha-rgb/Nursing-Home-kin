"use client";
import { ReactNode, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import Login from "@/components/Login";
import PasswordDialog from "@/components/PasswordDialog";
import { useSession, SessionUser } from "@/lib/session";
import { ROLE_INFO } from "@/lib/roles";
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
import PhotoPicker from "@/components/PhotoPicker";
import { OfflineBar, usePwa } from "@/components/Pwa";
import { CheckInCard, StaffRoster } from "@/components/roster/StaffRoster";

/* ---------- ข้อมูลจำลอง ---------- */
/** งานวันนี้ใน KinApp (มาจากหน้างานประจำวันของผู้จัดการ) */
type Task = { id: number; who: string; title: string; time: string; ins: string; done?: string; note?: string; shift?: string; status?: string; by?: string };

const FLOATING = [
  { id: 101, title: "ทำความสะอาดห้องโถงส่วนกลาง", time: "09:00" },
  { id: 102, title: "เช็ดทำความสะอาดโซฟาส่วนกลาง", time: "14:00" },
];
const APPTS = [
  { who: "คุณสุดา วงศ์สวัสดิ์", what: "พบแพทย์ตามนัด", when: "วันนี้ 13:00" },
  { who: "คุณมาลี ศรีสุข", what: "ตรวจเลือด", when: "พรุ่งนี้ 10:00" },
];
/** ใช้เมื่อยังโหลดรายชื่อจริงไม่ได้ (ครั้งแรกที่ออฟไลน์) */
const RESIDENTS0: { id?: string; name: string; room: string; age: number | string }[] = [
  { name: "คุณสุดา วงศ์สวัสดิ์", room: "A-101", age: 78 },
  { name: "คุณมาลี ศรีสุข", room: "A-103", age: 84 },
  { name: "คุณบุญช่วย แก้วมณี", room: "B-204", age: 81 },
  { name: "คุณสมศรี พิมพ์ทอง", room: "C-012", age: 76 },
];
const RANK = [
  { name: "พนักงาน อารี", branch: "สุขุมวิท 107", shift: "D", n: 128 },
  { name: "พนักงาน ลัดดา", branch: "พัทยา", shift: "N", n: 117 },
  { name: "พนักงาน สมหญิง", branch: "ราชพฤกษ์", shift: "D", n: 109 },
  { name: "พยาบาล วิภา", branch: "สุขุมวิท 107", shift: "D", n: 98 },
  { name: "พยาบาล นภา", branch: "ราชพฤกษ์", shift: "N", n: 91 },
];
const HANDOVER0 = [
  { id: 1, type: "เฝ้าระวังอาการ", who: "คุณมาลี ศรีสุข", text: "แขนขวาอ่อนแรงมากขึ้นเล็กน้อย ให้ตรวจซ้ำทุก 4 ชม.", by: "พยาบาล วิภา", at: "เมื่อวาน 19:10" },
  { id: 2, type: "ญาติฝากแจ้ง", who: "คุณสุดา วงศ์สวัสดิ์", text: "ลูกสาวจะมาเยี่ยมบ่ายนี้ ฝากเตรียมเสื้อผ้าชุดใหม่", by: "พนักงาน ลัดดา", at: "วันนี้ 06:40" },
];
const TYPES = ["เฝ้าระวังอาการ", "คำสั่งแพทย์", "ญาติฝากแจ้ง", "งานค้าง/ทั่วไป"];
const REPORT: Record<string, Record<string, string[][]>> = {};
const reportFor = (name: string, day: string) => [
  ["รายงานสุขภาพ (สัญญาณชีพ/อาหาร/ขับถ่าย)", day === "วันนี้" ? "BP 128/80, PR 76, BT 36.6 ทานอาหารเช้าหมด ขับถ่ายปกติ" : "BP 130/82, PR 78, BT 36.7 ทานอาหารได้ 3/4 ขับถ่ายปกติ"],
  ["การให้ยา", "ได้รับยาครบตามรอบเวลา"],
  ["เรื่องเฝ้าระวัง", name.includes("มาลี") ? "แขนขวาอ่อนแรง ตรวจซ้ำทุก 4 ชม." : "ไม่มี"],
  ["โน้ตการทำงาน", "อารมณ์ดี ร่วมกิจกรรมกลุ่มได้"],
];
void REPORT;

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
  const { toast } = useApp();
  const pwa = usePwa();
  const [tab, setTab] = useState<Tab>("tasks");
  // งานวันนี้ = งานที่ผู้จัดการมอบหมายในหน้า "ตรวจงานประจำวัน" ของวันนี้ · ส่งงานแล้วสถานะกลับไปให้ผู้จัดการตรวจ
  const { rows: drows, update: updDaily } = useCrud(`daily-${iso()}`, []);
  const tasks: Task[] = drows
    .map((r, k) => ({ id: k + 1, who: r[0], title: r[1], time: String(r[3] ?? "").slice(0, 5), ins: r[6] && r[6] !== "-" ? r[6] : "ไม่มีคำสั่งงานเพิ่มเติม", done: r[5] && r[5] !== "รอทำ" ? (r[8] && r[8] !== "-" ? String(r[8]).slice(0, 5) : "ส่งแล้ว") : undefined, note: r[9] && r[9] !== "-" ? r[9] : "", shift: r[4], status: r[5], by: r[10] && r[10] !== "-" ? r[10] : undefined }))
    .sort((a, b) => a.time.localeCompare(b.time));
  // คิวจ่ายยา = ซองยาที่ห้องยาจัด (แอปจัดยา) ของวันนี้ · ตรวจ QA ผ่านแล้วจึงจ่ายได้
  const [packs, setPacks] = useRecords<Pack>("pharmacy-packs", []);
  const [drugs] = useRecords<Drug>("pharmacy-drugs", DRUGS0);
  const { add: addHealth } = useCrud("health", HEALTH);
  const { residents: live } = useResidents();
  const RESIDENTS = live.length ? live.map((r) => ({ id: r.id, name: r.full_name, room: r.room ?? "-", age: r.age ?? "-" })) : RESIDENTS0;
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
  const [modal, setModal] = useState<null | "task" | "sop" | "bonus" | "dispense" | "metrics" | "handover" | "write" | "chat" | "pwd" | "manual" | "viewtask">(null);
  const [cur, setCur] = useState<number | null>(null);
  const [photo, setPhoto] = useState("");
  const [note, setNote] = useState("");
  const [bonusWho, setBonusWho] = useState("");
  const [bonusText, setBonusText] = useState("");
  const [hoText, setHoText] = useState("");
  const [hoWho, setHoWho] = useState("");
  const [hoType, setHoType] = useState(TYPES[0]);
  const [scope, setScope] = useState("สาขาเรา");
  const [rep, setRep] = useState({ who: "", day: "วันนี้" });
  const [praised, setPraised] = useState<string[]>([]);
  const [chatTab, setChatTab] = useState("กลุ่มสาขา");
  const [chat, setChat] = useState<{ me: boolean; t: string }[]>([{ me: false, t: "สวัสดีครับ วันนี้มีงานด่วนที่ต้องช่วยกันไหม" }]);
  const [msg, setMsg] = useState("");

  const close = () => { setModal(null); setPhoto(""); setNote(""); setCur(null); setMenu(false); };
  const open = (m: NonNullable<typeof modal>, i: number | null = null) => { setCur(i); setPhoto(""); setNote(""); setModal(m); };
  const doneTasks = tasks.filter((t) => t.done);
  const waiting = tasks.filter((t) => !t.done);
  const t = cur !== null ? tasks.find((x) => x.id === cur) : undefined;
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
          <button onClick={() => open("chat")} className="relative flex items-center gap-1.5 rounded-full bg-gold-100 px-3 py-1.5 text-xs font-medium text-gold-700">พี่แคร์<span className="grid h-4 w-4 place-items-center rounded-full bg-red-500 text-[10px] text-white">1</span></button>
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
                <div className="rounded-2xl bg-white/15 p-3"><p className="text-xs text-white/75">คะแนนดาวเฉลี่ย</p><p className="mt-1 text-2xl font-semibold">{mine ? "4.8" : "-"}</p></div>
              </div>
            </section>

            <CheckInCard user={user} />

            <button onClick={() => open("handover")} className="flex w-full items-center gap-3 rounded-3xl border border-cream-300/70 bg-cream-50 p-4 text-left">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gold-100 text-gold-700"><Icon name="book" /></span>
              <span className="flex-1"><span className="block font-semibold text-gold-800">สมุดส่งเวร (Handover)</span><span className="text-xs text-gold-600">{unread} เรื่องที่ต้องตามต่อ</span></span>
              <Count n={unread} />
            </button>

            <Card title="แจ้งเตือนนัดแพทย์ (วันนี้-พรุ่งนี้)" icon="bell">
              <ul className="space-y-2">{APPTS.map((a) => (
                <li key={a.who} className="flex items-center justify-between gap-3 rounded-2xl bg-cream-50 px-4 py-3 text-sm"><span><b className="font-medium">{a.who}</b><span className="block text-xs text-gold-600">{a.what}</span></span><span className="shrink-0 text-xs font-medium text-gold-700">{a.when}</span></li>
              ))}</ul>
            </Card>

            <Card title="งานใหม่ที่รอทำ" icon="check" right={<Count n={waiting.length} />}>
              {waiting.length === 0 ? <Empty t={tasks.length ? "ไม่มีงานค้างแล้ว เยี่ยมมาก" : "ยังไม่มีงานที่ผู้จัดการมอบหมายสำหรับวันนี้"} /> : (
                <ul className="space-y-3">{waiting.map((k) => (
                  <li key={k.id} className="rounded-2xl border border-cream-300/70 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div><p className="font-medium text-gold-900">{k.title}</p><p className="mt-0.5 text-sm text-gold-600">{k.who}</p></div>
                      <span className="shrink-0 rounded-full bg-gold-100 px-2.5 py-1 text-xs font-medium text-gold-700">{k.time}{k.shift ? ` · ${k.shift}` : ""}</span>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button className="btn-soft flex-1 !py-2.5" onClick={() => open("sop", k.id)}>คู่มือปฏิบัติงาน</button>
                      <button className="btn-primary flex-1 !py-2.5" onClick={() => open("task", k.id)}>ส่งงาน</button>
                    </div>
                  </li>
                ))}</ul>
              )}
            </Card>

            <Card title="งานส่วนกลางตามรอบ" icon="building" right={<Count n={FLOATING.length} />}>
              <ul className="space-y-2">{FLOATING.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-3 rounded-2xl bg-cream-50 px-4 py-3 text-sm"><span>{f.title}<span className="block text-xs text-gold-500">{f.time}</span></span><button className="btn-soft !px-3 !py-1.5 text-xs" onClick={() => toast("รับงานส่วนกลางแล้ว")}>รับงาน</button></li>
              ))}</ul>
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
                <div className="rounded-2xl bg-cream-50 p-3"><p className="text-2xl font-semibold text-gold-700">{mine ? "4.8" : "-"}</p><p className="text-xs text-gold-600">ดาวเฉลี่ยวันนี้</p></div>
              </div>
              <ul className="mt-3 space-y-2">{doneTasks.length === 0 ? <Empty t="ยังไม่มีงานที่ทำเสร็จวันนี้" /> : doneTasks.map((k) => (
                <li key={k.id}><button onClick={() => open("viewtask", k.id)} className="flex w-full items-center justify-between gap-3 rounded-2xl bg-cream-50 px-4 py-3 text-left text-sm"><span>{k.title}<span className="block text-xs text-gold-500">{k.who}</span></span><span className="text-xs text-gold-600">{k.done}</span></button></li>
              ))}</ul>
            </Card>
            <Card title="สรุปรายงานประจำวัน (ตอบญาติ)" icon="doc">
              <p className="mb-3 text-xs text-gold-600">รวมข้อมูลรายงานสุขภาพ (สัญญาณชีพ/อาหาร/ขับถ่าย) การให้ยา เรื่องเฝ้าระวัง และโน้ตการทำงาน รายบุคคล เพื่อให้พนักงานทุกคนตอบคำถามญาติได้ตรงกัน</p>
              <Select options={RESIDENTS.map((r) => r.name)} placeholder="-- เลือกผู้รับบริการเพื่อดูข้อมูลตอบญาติ --" value={rep.who} onChange={(v) => setRep({ ...rep, who: v })} />
              <div className="my-3 flex gap-2">{["วันนี้", "เมื่อวาน"].map((d) => <button key={d} onClick={() => setRep({ ...rep, day: d })} className={`flex-1 rounded-full py-2 text-sm ${rep.day === d ? "bg-gold-700 text-white" : "bg-cream-200 text-gold-700"}`}>{d}</button>)}</div>
              {rep.who ? (() => {
                const r = RESIDENTS.find((x) => x.name === rep.who);
                return r?.id ? <button className="btn-primary w-full" onClick={() => setProfile(r.id!)}><Icon name="doc" className="h-4 w-4" /> เปิดประวัติของ {rep.who}</button>
                  : <dl className="space-y-2">{reportFor(rep.who, rep.day).map(([k, v]) => <div key={k} className="rounded-2xl bg-cream-50 p-3 text-sm"><dt className="text-xs font-medium text-gold-600">{k}</dt><dd className="mt-0.5">{v}</dd></div>)}</dl>;
              })() : <Empty t="กรุณาเลือกผู้รับบริการด้านบนเพื่อดูสรุปสุขภาพและไทม์ไลน์ตอบญาติ" />}
            </Card>
          </>
        )}

        {tab === "fame" && (
          <>
            <div>
              <h1 className="text-xl font-semibold text-gold-800">กระดานเกียรติยศ</h1>
              <p className="text-sm text-gold-600">สุดยอดพนักงานดีเด่นประจำเดือน</p>
            </div>
            <div className="flex gap-2">{["สาขาเรา", "ทั่วประเทศ", "ระดับสาขา"].map((s) => <button key={s} onClick={() => setScope(s)} className={`flex-1 rounded-full py-2 text-sm ${scope === s ? "bg-gold-700 text-white shadow-soft" : "bg-cream-200 text-gold-700"}`}>{s}</button>)}</div>
            <button className="btn-soft w-full" onClick={() => downloadCsv("ผลงานพนักงาน", ["อันดับ", "ชื่อ", "สาขา", "เวร", "งาน"], RANK.map((r, i) => [String(i + 1), r.name, r.branch, r.shift, String(r.n)]))}><Icon name="download" className="h-4 w-4" /> ดาวน์โหลดผลงาน (CSV)</button>
            <section className="rounded-3xl bg-gradient-to-br from-gold-700 to-gold-400 p-5 text-white shadow-soft">
              <p className="text-xs tracking-wider text-white/80">พนักงานดีเด่น{scope === "ทั่วประเทศ" ? "ระดับประเทศ" : "สาขา"}</p>
              <p className="mt-1 text-xl font-semibold">{RANK[0].name}</p>
              <p className="text-sm text-white/80">{RANK[0].n} งาน · เวรเช้า (D)</p>
            </section>
            <Card title="Top 10" icon="trophy">
              <ol className="space-y-2">{RANK.filter((r) => scope !== "สาขาเรา" || r.branch === user.branch).map((r, i, arr) => (
                <li key={r.name} className="rounded-2xl bg-cream-50 p-3">
                  <div className="flex items-center gap-3 text-sm">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gold-700 text-xs font-semibold text-white">{i + 1}</span>
                    <span className="min-w-0 flex-1"><b className="font-medium">{r.name}</b><span className="block text-xs text-gold-500">{r.branch} · เวร {r.shift === "D" ? "เช้า (D)" : "ดึก (N)"}</span></span>
                    <span className="font-semibold text-gold-700">{r.n}</span>
                    <button className={`rounded-lg px-2.5 py-1 text-xs ${praised.includes(r.name) ? "bg-gold-700 text-white" : "bg-white text-gold-700"}`} onClick={() => { setPraised(praised.includes(r.name) ? praised.filter((x) => x !== r.name) : [...praised, r.name]); }}>ชื่นชม</button>
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-cream-300"><div className="h-full rounded-full bg-gold-500" style={{ width: `${(r.n / arr[0].n) * 100}%` }} /></div>
                </li>
              ))}</ol>
            </Card>
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

      {/* ส่งงาน */}
      <Modal open={modal === "task"} title="ส่งงาน (Proof of Work)" onClose={close}
        footer={<button className="btn-primary w-full" onClick={() => {
          if (!photo) return toast("กรุณาถ่ายภาพก่อนส่งงาน");
          const k = (cur as number) - 1;
          const row = [...drows[k]]; while (row.length < 11) row.push("-");
          const now = new Date();
          row[5] = "เสร็จแล้ว"; row[8] = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`; row[9] = note.trim() || "-"; row[10] = user.name;
          updDaily(k, row);
          close(); toast("ส่งงานเรียบร้อย");
        }}>ยืนยันการส่งงาน</button>}>
        {t && <div className="space-y-4">
          <div className="rounded-2xl bg-cream-50 p-4 text-sm"><p className="font-semibold text-gold-900">{t.title}</p><p className="text-gold-600">{t.who} · เวลา: {t.time}</p></div>
          <PhotoInput label="แตะเพื่อเปิดกล้องถ่ายรูป" file={photo} onFile={setPhoto} />
          <Field label="บันทึกย่อ (Note) - ไม่บังคับ"><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="ตัวอย่าง: ความดัน 120/80, ทานอาหารหมดจาน, หลับสนิทดี..." /></Field>
        </div>}
      </Modal>

      <Modal open={modal === "sop"} title="คู่มือปฏิบัติงาน" onClose={close} footer={<button className="btn-soft w-full" onClick={close}>ปิดหน้าต่าง</button>}>
        {t && <div className="space-y-3 text-sm"><p className="text-base font-semibold text-gold-900">{t.title}</p><p className="rounded-2xl bg-cream-50 p-4 leading-7">{t.ins}</p></div>}
      </Modal>

      <Modal open={modal === "viewtask"} title="ผลการปฏิบัติงาน" onClose={close} footer={<button className="btn-soft w-full" onClick={close}>ปิดหน้าต่าง</button>}>
        {t && <dl className="space-y-3 text-sm">{[["ผู้รับบริการ", t.who], ["ชื่องาน", t.title], ["คำสั่งงาน", t.ins], ["ผู้ปฏิบัติงาน", t.by ?? user.name], ["เวลาที่ส่งจริง", t.done ?? "-"], ["บันทึกย่อ", t.note || "-"], ["สถานะ", t.status === "ตรวจแล้ว" ? "ผู้จัดการตรวจแล้ว" : "รอผู้จัดการตรวจ"]].map(([k, v]) => <div key={k}><dt className="text-xs text-gold-500">{k}</dt><dd className="font-medium">{v}</dd></div>)}</dl>}
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

      {/* พี่แคร์ */}
      <Modal open={modal === "chat"} title="พี่แคร์" onClose={close}
        footer={<form className="flex w-full gap-2" onSubmit={(e) => { e.preventDefault(); if (!msg.trim()) return; setChat([...chat, { me: true, t: msg }]); setMsg(""); }}><input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="พิมพ์ข้อความ..." /><button className="btn-primary !px-4" aria-label="ส่ง"><Icon name="send" className="h-4 w-4" /></button></form>}>
        <div className="mb-3 flex gap-2">{["กลุ่มสาขา", "คุยส่วนตัว (1:1)", "โหมด CEO"].map((x) => <button key={x} onClick={() => setChatTab(x)} className={`flex-1 rounded-full py-1.5 text-xs ${chatTab === x ? "bg-gold-700 text-white" : "bg-cream-200 text-gold-700"}`}>{x}</button>)}</div>
        <div className="space-y-2">{chat.map((c, i) => <div key={i} className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${c.me ? "ml-auto bg-gold-700 text-white" : "bg-cream-100 text-gold-900"}`}>{c.t}</div>)}</div>
      </Modal>

      <Modal open={modal === "manual"} title="คู่มือผู้ใช้งาน" onClose={close} footer={<button className="btn-soft w-full" onClick={close}>ปิดหน้าต่าง</button>}><p className="text-sm text-gold-600">-</p></Modal>

      <PasswordDialog open={modal === "pwd"} onClose={close} />
    </div>
  );
}

/* ---------- หน้าเข้าสู่ระบบแอปพนักงาน ---------- */
export default function StaffApp() {
 const { user, ready, setUser, logout } = useSession();
 return <AppProvider go={()=>{}}>{!ready?<main className="grid min-h-dvh place-items-center text-sm text-gold-500">กำลังตรวจสอบการเข้าสู่ระบบ…</main>:user?<App user={user} onLogout={logout} />:<Login staff onLogin={setUser} />}</AppProvider>;
}
