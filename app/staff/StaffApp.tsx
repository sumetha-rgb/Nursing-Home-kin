"use client";
import { useEffect, useState } from "react";
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
import { Avatar, AvatarEdit } from "@/components/Avatar";
import { Field, Modal, Select } from "@/components/ui";
import { ResidentPicker } from "@/components/SearchSelect";
import { AppProvider, useApp } from "@/lib/app";
import { downloadCsv, SYNC_ERROR_EVENT, useCrud, useRecords } from "@/lib/store";
import { useResidents } from "@/lib/care";
import { useAutoRefresh } from "@/lib/autoRefresh";
import { HEALTH } from "@/lib/mock";
import { daysLeft, Drug, DRUGS0, iso, MEALS, nowTh, Pack } from "@/lib/pharmacy";
import AlertsBell from "@/components/care/AlertsBell";
import BranchNotice from "@/components/BranchNotice";
import ResidentProfile from "@/components/care/ResidentProfile";
import VitalsDialog from "@/components/care/VitalsDialog";
import FamilyLinkDialog from "@/components/care/FamilyLinkDialog";
import PhotoPicker from "@/components/PhotoPicker";
import { OfflineBar, usePwa } from "@/components/Pwa";
import { usePush } from "@/lib/usePush";
import { CheckInCard, StaffRoster } from "@/components/roster/StaffRoster";
import { fetchToday, shortName, SHIFTS, stampPhoto } from "@/lib/roster";
import type { StaffReview } from "@/lib/reviews";
import { KPI_PARTS, KpiResp, pointsOf } from "@/lib/kpi";
import { NO_ALLERGY } from "@/lib/medicalLists";
import PhysioKin from "@/components/care/PhysioKin";

/* ---------- ข้อมูลจำลอง ---------- */
/** งานวันนี้ใน KinApp (มาจากหน้างานประจำวันของผู้จัดการ) */
type Task = { id: string; rid?: string; who: string; title: string; time: string; ins: string; done?: string; note?: string; shift?: string; status?: string; by?: string; owner?: string };

const HANDOVER0 = [
  { id: 1, type: "เฝ้าระวังอาการ", who: "คุณมาลี ศรีสุข", text: "แขนขวาอ่อนแรงมากขึ้นเล็กน้อย ให้ตรวจซ้ำทุก 4 ชม.", by: "พยาบาล วิภา", at: "เมื่อวาน 19:10" },
  { id: 2, type: "ญาติฝากแจ้ง", who: "คุณสุดา วงศ์สวัสดิ์", text: "ลูกสาวจะมาเยี่ยมบ่ายนี้ ฝากเตรียมเสื้อผ้าชุดใหม่", by: "พนักงาน ลัดดา", at: "วันนี้ 06:40" },
];
const TYPES = ["เฝ้าระวังอาการ", "คำสั่งแพทย์", "ญาติฝากแจ้ง", "งานค้าง/ทั่วไป"];

type Tab = "tasks" | "meds" | "residents" | "roster" | "perf" | "ptoday" | "pweek" | "pcases";
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "tasks", label: "งานวันนี้", icon: "check" },
  { id: "meds", label: "จ่ายยา", icon: "pill" },
  { id: "residents", label: "ผู้รับบริการ", icon: "user" },
  { id: "roster", label: "ตารางเวร", icon: "calendar" },
  { id: "perf", label: "ฉัน", icon: "me" },
];
/** นักกายภาพ: กายภาพวันนี้ · ตารางสัปดาห์ · เคสของฉัน · งานอื่นที่ได้รับมอบหมาย · ฉัน */
const PHYSIO_TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "ptoday", label: "วันนี้", icon: "pulse" },
  { id: "pweek", label: "ตาราง", icon: "calendar" },
  { id: "pcases", label: "เคสของฉัน", icon: "user" },
  { id: "tasks", label: "งานอื่น", icon: "check" },
  { id: "perf", label: "ฉัน", icon: "me" },
];
const PHYSIO_VIEWS: Tab[] = ["ptoday", "pweek", "pcases"];
/** เหตุผลที่ทำแทน (ต่อท้ายในบันทึกงาน "ทำแทน <ชื่อ> · <เหตุผล>") */
const PROXY_REASONS = ["ไม่อยู่ในเวร", "ติดงานอื่น", "งานด่วน", "อื่น ๆ"];
const LATE_MIN = 30;
/** ตัวย่อในวงกลม: ตัดคำนำหน้า และข้ามสระนำ (เ แ โ ใ ไ) เช่น นางเชียงราย ไทรงาม → ชท */


/**
 * วันทำงานของ KinApp (YYYY-MM-DD) ตามเวลาไทย UTC+7 เสมอ ไม่ขึ้นกับเขตเวลาของเครื่อง
 * ตัดวันที่ 07:00 น. (เปลี่ยนเวร) ตรงกับตารางเวรและหน้ามอบหมายงาน: 00:00–06:59 ยังเป็นวันของเวรดึกเมื่อวาน
 */
// เวลาไทย (UTC+7) ลบ 7 ชั่วโมงของการตัดวัน 07:00 = เวลา UTC พอดี · วันที่ UTC จึงเป็นวันทำงานของ KinApp
const workDayTh = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

/* ---------- ตัวช่วย UI ---------- */
const Empty = ({ t }: { t: string }) => <p className="rounded-2xl bg-cream-50 py-6 text-center text-sm text-gold-500">{t}</p>;

function PhotoInput({ label, file, onFile }: { label: string; file: string; onFile: (u: string) => void }) {
  return <PhotoPicker value={file} onChange={onFile} label={label} hint="ถ่ายสดจากกล้อง หรือเลือกรูปจากเครื่อง" />;
}

/* ---------- แอป ---------- */
function App({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const { toast } = useApp();
  const pwa = usePwa();
  // แจ้งเตือนบนโทรศัพท์: การ์ดชวนเปิดบนหน้างาน (ซ่อนได้) + เมนูโปรไฟล์
  const push = usePush();
  // ติดตั้งแอปก่อน (หัวแจ้งเตือนเป็นชื่อและโลโก้ KinApp แทน Chrome) แล้วค่อยเปิดแจ้งเตือน · "ไว้ทีหลัง" จำไว้ในเครื่อง
  // ค่าที่จำในเครื่อง: การ์ดที่กด "ไว้ทีหลัง" · ป้ายแนะนำ "ฉัน" (ครั้งเดียว) · ตัวอักษรใหญ่
  const [hidden, setHidden] = useState<string[]>([]);
  const [prefs, setPrefs] = useState(false);
  const [big, setBig] = useState(false);
  useEffect(() => {
    try {
      setHidden(["kin-push-hide", "kin-install-hide", "kin-coach-me"].filter((k) => localStorage.getItem(k) === "1"));
      setBig(localStorage.getItem("kin-big") === "1");
    } catch { /* ไม่เป็นไร */ }
    setPrefs(true);
  }, []);
  const hideCard = (k: string) => { setHidden((h) => [...h, k]); try { localStorage.setItem(k, "1"); } catch { /* ไม่เป็นไร */ } };
  const toggleBig = () => { const v = !big; setBig(v); try { localStorage.setItem("kin-big", v ? "1" : "0"); } catch { /* ไม่เป็นไร */ } toast(v ? "เปิดตัวอักษรใหญ่แล้ว" : "กลับเป็นตัวอักษรปกติแล้ว"); };
  const goMe = () => { setTab("perf"); setPerfView("me"); window.scrollTo(0, 0); hideCard("kin-coach-me"); };
  const installApp = async () => {
    if (pwa.canInstall) { if (await pwa.install()) toast("ติดตั้ง KinApp แล้ว · เปิดได้จากหน้าจอโทรศัพท์"); }
    else toast(pwa.iosHint ? "กดปุ่มแชร์ของ Safari แล้วเลือก \"เพิ่มไปยังหน้าจอโฮม\"" : "เปิดเมนูของเบราว์เซอร์ (⋮) แล้วเลือก \"ติดตั้งแอป\" หรือ \"เพิ่มลงในหน้าจอหลัก\"");
  };
  const togglePush = async () => {
    if (push.state === "on") toast(await push.disable());
    else if (push.state === "off") toast(await push.enable());
    else toast(push.state === "ios" ? "iPhone: กดปุ่มแชร์ของ Safari → \"เพิ่มไปยังหน้าจอโฮม\" แล้วเปิด KinApp จากไอคอน จึงเปิดแจ้งเตือนได้" : "เคยกดไม่อนุญาตไว้ · เปิดได้ที่ตั้งค่าของเครื่อง → การแจ้งเตือน → KinApp");
  };
  const needInstall = !pwa.installed && (pwa.canInstall || pwa.iosHint);
  const pushCard: "install" | "enable" | "denied" | null =
    push.state === "loading" || (push.state === "none" && !pwa.iosHint) ? null
    : needInstall && !hidden.includes("kin-install-hide") ? "install"
    : hidden.includes("kin-push-hide") ? null
    : push.state === "off" ? "enable" : push.state === "denied" ? "denied" : null;
  // นักกายภาพเปิดแอปมาเจอคิวกายภาพวันนี้ · ตำแหน่งอื่นเจองานวันนี้
  const physio = user.role === "Physio";
  const tabs = physio ? PHYSIO_TABS : TABS;
  const [tab, setTab] = useState<Tab>(physio ? "ptoday" : "tasks");
  const [pkCount, setPkCount] = useState(0);
  // พยาบาล: ใครทำกายภาพแล้ววันนี้ (ดูอย่างเดียว · บันทึกกายภาพได้เฉพาะนักกายภาพ)
  const [ptDone, setPtDone] = useState<Record<string, string>>({});
  useEffect(() => {
    if (physio || tab !== "residents") return;
    fetch("/api/clinic?op=physio_today", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null))
      .then((x: { today?: { resident_name: string; at: string; author: string | null }[] } | null) => x?.today && setPtDone(Object.fromEntries(x.today.map((t) => [t.resident_name, `${t.at}${t.author ? ` · ${t.author}` : ""}`]))))
      .catch(() => {});
  }, [physio, tab]);
  useEffect(() => { if (prefs && tab === "perf" && !hidden.includes("kin-coach-me")) hideCard("kin-coach-me"); }, [prefs, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  // เวลาปัจจุบัน (อัปเดตทุกนาที) ใช้ตัดสินวันทำงานและงานเลยเวลา
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const h = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(h); }, []);
  // งานวันนี้ = งานที่ผู้จัดการมอบหมายในหน้า "ตรวจงานประจำวัน" ของวันทำงานนี้ · ส่งงานแล้วสถานะกลับไปให้ผู้จัดการตรวจ
  // วันทำงานตามเวลาไทย: ก่อน 07:00 ยังเป็นวันของเวรดึกเมื่อคืน (เปลี่ยนวันตอนเปลี่ยนเวร 07:00 ไม่ใช่เที่ยงคืน)
  const workDay = workDayTh(now);
  const { rows: drows, ids: dids, update: updDaily } = useCrud(`daily-${workDay}`, []);
  // รหัสงาน = รหัสแถวในฐานข้อมูล (ไม่ใช้ลำดับในรายการ เพราะลำดับเปลี่ยนได้เมื่อดึงข้อมูลใหม่)
  const tasks: Task[] = drows
    .map((r, k) => ({ id: dids[k], rid: dids[k], who: r[0], title: r[1], time: String(r[3] ?? "").slice(0, 5), ins: r[6] && r[6] !== "-" ? r[6] : "ไม่มีคำสั่งงานเพิ่มเติม", done: r[5] && r[5] !== "รอทำ" ? (r[8] && r[8] !== "-" ? String(r[8]).slice(0, 5) : "ส่งแล้ว") : undefined, note: r[9] && r[9] !== "-" ? r[9] : "", shift: r[4], status: r[5], by: r[10] && r[10] !== "-" ? r[10] : undefined, owner: r[2] && r[2] !== "-" ? r[2] : undefined }))
    .sort((a, b) => a.time.localeCompare(b.time));
  // คิวจ่ายยา = ซองยาที่ห้องยาจัด (แอปจัดยา) ของวันนี้ · ตรวจ QA ผ่านแล้วจึงจ่ายได้
  const [packs, setPacks] = useRecords<Pack>("pharmacy-packs", []);
  const [drugs] = useRecords<Drug>("pharmacy-drugs", DRUGS0);
  const { rows: healthRows, add: addHealth } = useCrud("health", HEALTH);
  const { residents: live } = useResidents();
  // รายชื่อจริงจากทะเบียนผู้รับบริการ (สำเนาในเครื่องใช้ตอนออฟไลน์) · ไม่ใช้ชื่อตัวอย่าง
  const RESIDENTS = live.map((r) => ({ id: r.id, name: r.full_name, room: r.room ?? "-", age: r.age ?? "-" }));
  // นัดหมายและงานส่วนกลาง: ชุดข้อมูลเดียวกับที่ผู้จัดการ/หัวหน้าพยาบาลบันทึกในระบบจัดการ
  const { rows: apptRows } = useCrud("appointments", []);
  // งานส่วนกลาง: ทำแล้วถ่ายรูปส่ง (รอบละครั้ง ทุกวัน / ทุกสัปดาห์ / ทุกเดือน) · นับเป็นผลงานใน KPI
  type Fac = { id: string; name: string; category: string | null; schedule: string; manual: boolean; assignee: string | null; done: boolean; late: boolean; last: { id: string; by: string; at: string; note: string | null } | null };
  const [fac, setFac] = useState<Fac[]>([]);
  const loadFac = () => { fetch("/api/care?op=facility&mine=1", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setFac(d.items)).catch(() => {}); };
  useEffect(() => { loadFac(); const t = setInterval(() => { if (document.visibilityState === "visible") loadFac(); }, 60_000); return () => clearInterval(t); }, []);
  const [facPick, setFacPick] = useState<Fac | null>(null);
  const [facBusy, setFacBusy] = useState(false);
  const tomorrowIso = new Date(Date.now() + 7 * 3600e3 + 864e5).toISOString().slice(0, 10);
  const appts = upcomingAppts(apptRows).filter(({ r }) => apptIso(r[0]) <= tomorrowIso).map(({ r }) => ({ who: r[2], what: r[3], when: `${apptIso(r[0]) === iso() ? "วันนี้" : "พรุ่งนี้"} ${(r[1] ?? "").slice(0, 5)}`, by: r[4] }));
  const [profile, setProfile] = useState<string | null>(null);
  const [vitalsFor, setVitalsFor] = useState<string | null>(null);
  const todayIso = iso();
  const queue = packs.filter((p) => p.date === todayIso).sort((a, b) => MEALS.indexOf(a.meal) - MEALS.indexOf(b.meal) || a.who.localeCompare(b.who, "th"));
  const ready = queue.filter((p) => p.qa === "ตรวจผ่าน" && !p.given);
  const lowFor = (who: string) => drugs.filter((x) => x.who === who && !x.hold && (daysLeft(x) ?? 99) <= 2);
  const [handover, setHandover] = useRecords("staff-handover", HANDOVER0);
  // ผลงานพิเศษ คำชม และกำลังใจของสาขา (บันทึกจริง เห็นทุกเครื่อง)
  /** nudges = งานที่หัวหน้ากด "ตามงาน" และยังไม่ส่ง (ถึงฉัน หรือถึงทุกคนในสาขา) */
  type Nudge = { id: string; taskId: string; task: string; resident: string | null; message: string | null; sentBy: string; at: string; time: string | null };
  type Feed = { kudos: { task_title: string; resident_name: string | null; given_by: string; at: string }[]; cheers: { message: string; sent_by: string; at: string }[]; bonusToday: number; nudges?: Nudge[] };
  const [feed, setFeed] = useState<Feed>({ kudos: [], cheers: [], bonusToday: 0 });
  const loadFeed = () => { fetch("/api/ops?op=feed", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setFeed(d)).catch(() => {}); };
  useEffect(loadFeed, []);
  useAutoRefresh(() => { loadFeed(); loadShift(); }); // ผลงานพิเศษ คำชม กำลังใจของทีม ตามงาน และเวรของฉัน
  // server ปฏิเสธการบันทึก (เช่น งานนี้มีคนส่งแล้ว ซองยานี้ให้ยาแล้ว) แสดงเหตุผล · ข้อมูลในเครื่องโหลดใหม่จาก server ให้เอง
  useEffect(() => {
    const onErr = (e: Event) => { const d = (e as CustomEvent<{ key: string; message: string }>).detail; if (d?.message && /^(daily-|pharmacy-packs$|staff-)/.test(d.key)) toast(d.message); };
    window.addEventListener(SYNC_ERROR_EVENT, onErr);
    return () => window.removeEventListener(SYNC_ERROR_EVENT, onErr);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const bonus = feed.bonusToday;
  const [fab, setFab] = useState(false);
  // หน้างานวันนี้แบบกระชับ: แถว "ต้องรู้ก่อนเริ่มงาน" พับไว้ก่อน · วิธีติดตั้งบน iPhone เปิดเป็นหน้าต่างเล็ก
  const [know, setKnow] = useState(false);
  const [iosHelp, setIosHelp] = useState(false);
  const [modal, setModal] = useState<null | "facility" | "task" | "sop" | "proxy" | "bonus" | "dispense" | "metrics" | "handover" | "write" | "pwd" | "manual" | "viewtask">(null);
  /** งานที่เปิดอยู่ = รหัสแถวงาน (string) · ซองยาที่เปิดอยู่ = รหัสซอง (number) */
  const [cur, setCur] = useState<string | number | null>(null);
  const [photo, setPhoto] = useState("");
  const [note, setNote] = useState("");
  const [shareFam, setShareFam] = useState(true);
  const [bonusWho, setBonusWho] = useState("");
  const [bonusText, setBonusText] = useState("");
  const [hoText, setHoText] = useState("");
  const [hoWho, setHoWho] = useState("");
  const [hoType, setHoType] = useState(TYPES[0]);
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
      toast(`ส่งข่าวถึงญาติแล้ว · ${fu.name} · ขึ้นในสมุดภาพประจำวัน`);
      setFu(null);
    } catch (e) { toast((e as Error).message); setFu((x) => (x ? { ...x, busy: false } : x)); }
  };

  const close = () => { setModal(null); setPhoto(""); setNote(""); setShareFam(true); setCur(null); setProxyFor(null); setProxyReason(PROXY_REASONS[0]); };
  const open = (m: NonNullable<typeof modal>, i: string | number | null = null) => { setCur(i); setPhoto(""); setNote(""); setModal(m); };
  // งานของฉัน = งานที่ระบุชื่อฉัน หรืองานที่ไม่ระบุคนในกะที่ฉันเข้าเวร (จากตารางเวร)
  // ดึงเวรใหม่เป็นระยะ (พร้อม feed) และเมื่อกลับมาที่แอป · เปลี่ยนเวร 07:00/19:00 ระหว่างเปิดแอปค้างไว้ก็ถูกต้อง
  type ShiftRef = { date: string; shift: string } | null;
  const [shiftInfo, setShiftInfo] = useState<{ cur: ShiftRef; next: ShiftRef } | undefined>(undefined);
  const loadShift = () => { fetchToday().then((d) => setShiftInfo({ cur: d.shift ?? null, next: d.next ?? null })).catch(() => setShiftInfo((x) => x ?? { cur: null, next: null })); };
  /** เวรที่แสดงบนหัวแอป: เวรตอนนี้ หรือเวรถัดไปของวันนี้ */
  const shownShift = shiftInfo === undefined ? undefined : (shiftInfo.cur ?? shiftInfo.next)?.shift ?? null;
  // เวรของวันทำงานที่แสดงอยู่ (วันที่ของเวร = workDay) · ก่อน 07:00 เวรเช้าของวันนี้เป็นของวันทำงานถัดไป
  //  ไม่นับงานกะเช้าของเมื่อวาน (ยังอยู่ในวันทำงานนี้) เป็นงานของฉัน
  const myShift = shiftInfo === undefined ? undefined : [shiftInfo.cur, shiftInfo.next].find((x) => x?.date === workDay)?.shift ?? null;
  useEffect(() => {
    loadShift();
    // กลับมาเปิดแอปจากพื้นหลัง (PWA บางเครื่องไม่ยิง focus) · focus และทุก 1 นาทีอยู่ใน useAutoRefresh ด้านบน
    const onShow = () => { if (document.visibilityState === "visible") loadShift(); };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const isMine = (k: Task) => k.owner === user.name || (!k.owner && !!myShift && k.shift === `กะ${myShift}`);
  const [taskView, setTaskView] = useState<"mine" | "all">("mine");
  // ส่งงานได้: งานที่ระบุชื่อฉัน · งานกลางของเวรที่ฉันเข้า · หัวหน้าพยาบาล/ผู้ตรวจงาน ส่งงานกลางได้ทุกเวร
  // งานของคนอื่น (หรืองานกลางของเวรอื่น) ต้องกด "ทำแทน" และยืนยัน ระบบบันทึกว่าใครทำแทนใคร
  const canSubmit = (k: Task) => k.owner === user.name || (!k.owner && (isMine(k) || can(user, "tasks.review")));
  const ownerOf = (k: Task) => k.owner || `ทีม${k.shift ?? "เวร"}`;
  const [proxyFor, setProxyFor] = useState<string | null>(null);
  const [proxyReason, setProxyReason] = useState(PROXY_REASONS[0]);
  const doFor = (k: Task) => { setCur(k.id); setProxyReason(PROXY_REASONS[0]); setModal("proxy"); };
  /** ป้ายทำแทนจากบันทึกงาน "ทำแทน <ชื่อ> · <เหตุผล> · <โน้ต>" */
  const proxyText = (n?: string) => { if (!n?.startsWith("ทำแทน")) return ""; const p = n.split(" · "); return PROXY_REASONS.includes(p[1]) ? `${p[0]} · ${p[1]}` : p[0]; };
  // รีวิวจากครอบครัวของฉัน (คะแนนเฉลี่ยย้อนหลัง 90 วัน)
  const [myRev, setMyRev] = useState<{ reviews: number; avg: number | null; recent: StaffReview[] } | null>(null);
  useEffect(() => { fetch("/api/reviews?op=mine", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setMyRev).catch(() => {}); }, []);
  const myStars = myRev?.avg ? myRev.avg.toFixed(1) : "-";
  // ผลตรวจงานของฉันจากหัวหน้า ย้อนหลัง 7 วัน (ดาว 1–2 ดวง = ต้องแก้ไข ขึ้นก่อน)
  type MyReview = { id: string; date: string; task: string; name: string; stars: number; note: string | null; by: string | null; at: string | null };
  const [myReviews, setMyReviews] = useState<MyReview[]>([]);
  useEffect(() => {
    const load = () => fetch("/api/care?op=my_reviews", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { items: [] })).then((d) => setMyReviews(d.items ?? [])).catch(() => {});
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, 120_000);
    return () => clearInterval(t);
  }, []);
  const reviewOf = (rid?: string) => (rid ? myReviews.find((x) => x.id === rid) : undefined);
  const starText = (n: number) => `${"★".repeat(n)}${"☆".repeat(Math.max(0, 5 - n))}`;
  // KPI เดือนนี้: อันดับในสาขา (รายละเอียดแยกส่วนเห็นเฉพาะของตัวเอง)
  const [kpi, setKpi] = useState<KpiResp | null>(null);
  const [perfView, setPerfView] = useState<"me" | "team" | "rank">("me");
  useEffect(() => {
    if (tab !== "perf") return;
    const d = new Date();
    fetch(`/api/kpi?month=${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setKpi).catch(() => {});
  }, [tab]);
  const doneTasks = tasks.filter((t) => t.done);
  // รูปหลักฐานของงานที่ส่งแล้ว (โหลดเฉพาะตอนเปิดแท็บผลงานทีม)
  const [photos, setPhotos] = useState<Record<string, string>>({});
  const doneIds = doneTasks.map((t) => t.rid).filter(Boolean).join(",");
  useEffect(() => {
    if (tab !== "perf" || perfView !== "team" || !doneIds) return;
    fetch(`/api/care?op=task_photos&ids=${encodeURIComponent(doneIds)}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : { photos: {} })).then((d) => setPhotos(d.photos ?? {})).catch(() => {});
  }, [tab, perfView, doneIds]);
  // งานที่ฉันส่งแล้ววันนี้ (ล่าสุดก่อน)
  const mySent = doneTasks.filter((k) => k.by === user.name).sort((a, b) => String(b.done).localeCompare(String(a.done)));
  const pendingAll = tasks.filter((t) => !t.done);
  const myPending = pendingAll.filter(isMine);
  const waiting = taskView === "mine" ? myPending : pendingAll;
  const t = cur !== null ? tasks.find((x) => x.id === cur) : undefined;
  // กำหนดเวลาของงาน (เวลาไทย) · งานกะดึกก่อน 07:00 เป็นของวันถัดจากวันทำงาน (เหมือนหน้ามอบหมายงาน)
  const dueAt = (k: Task) => {
    const m = k.time.match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const t = Date.parse(`${workDay}T${m[1].padStart(2, "0")}:${m[2]}:00+07:00`);
    return k.shift === "กะดึก" && Number(m[1]) < 7 ? t + 864e5 : t;
  };
  const isLate = (k: Task) => !k.done && (dueAt(k) ?? Infinity) + LATE_MIN * 60e3 < now;
  const dueIn = (k: Task) => { const d = dueAt(k); if (d === null) return null; const min = Math.round((d - now) / 60e3); return <small className={min < 0 ? "is-late" : ""}>{min < 0 ? `เลย ${-min} นาที` : min < 60 ? `อีก ${min} นาที` : `อีก ${Math.floor(min / 60)} ชม.`}</small>; };
  const [taskTab, setTaskTab] = useState<"todo" | "sent" | "fac">("todo");
  const myLate = myPending.filter(isLate);
  const myGroups = Object.entries(myPending.filter((k) => !isLate(k)).reduce<Record<string, Task[]>>((g, k) => ({ ...g, [k.time]: [...(g[k.time] ?? []), k] }), {})).sort(([a], [b]) => a.localeCompare(b));
  const others = pendingAll.filter((k) => !isMine(k));
  const nextTask = myPending.filter((k) => !isLate(k))[0] ?? myLate[0];
  const doneForMe = doneTasks.filter((k) => k.owner === user.name && k.by && k.by !== user.name);
  const fixCount = myReviews.filter((r) => r.stars <= 2).length;
  const myShiftText = shownShift === undefined ? "กำลังตรวจตารางเวร…" : shownShift ? `เวร${shownShift} ${SHIFTS.find((x) => x.key === shownShift)?.time ?? ""}` : "วันนี้ไม่มีเวรในตาราง";
  const roomOf = (name: string) => { const r = RESIDENTS.find((x) => x.name === name)?.room; return r && r !== "-" ? r : ""; };
  const ownerTag = (k: Task) => (k.owner === user.name ? <em className="ka-me">งานของคุณ</em> : !isMine(k) ? <em className="ka-own">{k.owner ? `ของ${k.owner}` : `ทีม${k.shift ?? "เวร"}`}</em> : null);
  // ตามงาน: แถบแดงบนสุด + ป้าย "ถูกตาม" ที่งาน · ตอบว่าทำไม่ได้ = ส่งเหตุผลถึงหัวหน้า
  const nudges = feed.nudges ?? [];
  const nudged = new Set(nudges.map((n) => n.taskId));
  const [why, setWhy] = useState<string | null>(null);
  const NUDGE_WHY = ["ผู้ป่วยหลับอยู่", "ผู้ป่วยไม่พร้อม", "ติดงานด่วน", "ผู้ป่วยไม่อยู่ในห้อง"];
  const replyNudge = async (n: Nudge, reason: string) => {
    const r = await fetch("/api/ops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "nudge_reply", id: n.id, reason }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { toast(d.error || "ส่งไม่สำเร็จ"); return; }
    toast(`แจ้งหัวหน้าแล้ว · ${n.task} · ${reason}`); setWhy(null); loadFeed();
  };
  const taskRow = (k: Task) => (
    <li key={k.id} className={`ka-task ${isLate(k) ? "is-late" : ""} ${canSubmit(k) ? "" : "is-other"}`}>
      <button type="button" className="ka-task-main" onClick={() => open("sop", k.id)}>
        <span className="ka-time"><b>{k.time || "-"}</b></span>
        <span className="ka-t"><b>{k.title}{k.rid && nudged.has(k.rid) && <em className="ka-nudged">ถูกตาม</em>}</b><small>{k.who}{ownerTag(k) && <> · {ownerTag(k)}</>}</small></span>
      </button>
      {canSubmit(k)
        ? <button type="button" className="ka-send" onClick={() => { open("task", k.id); setProxyFor(null); }}><Icon name="camera" className="h-5 w-5" /><span>ส่งงาน</span></button>
        : <button type="button" className="ka-send is-ghost" onClick={() => doFor(k)}>ทำแทน</button>}
    </li>
  );
  // ผู้รับบริการ: วัดสัญญาณชีพวันนี้แล้วหรือยัง (จากบันทึกสุขภาพ) · ประวัติแพ้ยา (จากสัญญา)
  const thToday = (() => { const d = new Date(now); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear() + 543}`; })();
  const measured: Record<string, string> = {};
  for (const r of healthRows) if (String(r[0]).startsWith(thToday)) { const tm = String(r[0]).slice(11, 16); if (!measured[r[1]] || tm > measured[r[1]]) measured[r[1]] = tm; }
  const [allergy, setAllergy] = useState<Record<string, string>>({});
  useEffect(() => {
    fetch("/api/care?op=allergies", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { items: [] })).then((d: { items: { name: string; drug: string | null }[] }) => {
      const m: Record<string, string> = {};
      for (const x of d.items ?? []) { const v = String(x.drug ?? "").trim(); if (v && v !== "-" && v !== NO_ALLERGY && v !== "ปฏิเสธ") m[x.name] = v.length > 26 ? `${v.slice(0, 26)}…` : v; }
      setAllergy(m);
    }).catch(() => {});
  }, []);
  const [resQ, setResQ] = useState("");
  const [resTodo, setResTodo] = useState(false);
  const [resPick, setResPick] = useState<(typeof RESIDENTS)[number] | null>(null);
  const resList = RESIDENTS.filter((r) => (!resQ.trim() || `${r.name} ${r.room}`.toLowerCase().includes(resQ.trim().toLowerCase())) && (!resTodo || !measured[r.name]));
  // จ่ายยา: เปิดที่มื้อตามเวลาตอนนี้ · กรองตามสถานะซอง
  const [meal, setMeal] = useState(() => { const h = new Date().getHours() + new Date().getMinutes() / 60; return h < 10.5 ? MEALS[0] : h < 15 ? MEALS[1] : h < 19.5 ? MEALS[2] : MEALS[3]; });
  const [medF, setMedF] = useState<"" | "ready" | "wait" | "done">("");
  const packState = (p: Pack) => (p.given ? "done" : p.qa === "ตรวจผ่าน" ? "ready" : "wait");
  const mealQ = queue.filter((p) => p.meal === meal);
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
  const facMine = fac.filter((x) => x.last?.by === user.name && x.last.at.startsWith(todayIso)).length;
  const mine = doneTasks.length + bonus + facMine;
  const facLeft = fac.filter((x) => !x.done);
  const saveFac = async () => {
    if (!facPick || facBusy) return;
    if (!photo) return toast("กรุณาถ่ายรูปหลักฐาน");
    setFacBusy(true);
    try {
      const r = await fetch("/api/care", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "facility_done", taskId: facPick.id, photo, note }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "ส่งงานไม่สำเร็จ กรุณาลองใหม่");
      toast(`ส่งงานส่วนกลางแล้ว · ${facPick.name} · นับเป็นผลงานของคุณ`);
      close(); setFacPick(null); loadFac();
    } catch (e) { toast((e as Error).message); loadFac(); }
    finally { setFacBusy(false); }
  };

  return (
    <div className="staff-app mx-auto min-h-dvh w-full max-w-lg pb-28 sm:border-x sm:border-cream-300/60">
      {/* header */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-cream-300/60 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2.5">
          <Image src="/logo-mark.png" alt="KIN" width={44} height={33} className="h-9 w-auto" />
          <div className="leading-tight"><p className="text-[15px] font-semibold text-gold-800">KinApp</p><p className="text-[11px] font-medium text-gold-600">สาขา{user.branch || "-"}</p></div>
        </div>
        <div className="flex items-center gap-2">
          <AlertsBell compact />
          <button type="button" className={`ka-me ${tab === "perf" ? "is-on" : ""}`} onClick={goMe} aria-label="หน้าฉัน: รูปโปรไฟล์ ผลงาน และตั้งค่า">
            <Avatar kind="staff" id={user.id} name={user.name} size={30} />
            <span>{shortName(user.name)}</span>
            <Icon name="chevron" className="h-3.5 w-3.5" />
          </button>
        </div>
        {prefs && !hidden.includes("kin-coach-me") && tab !== "perf" && (
          <div className="ka-coach" role="note">
            <p>รูปโปรไฟล์ แจ้งเตือน และตั้งค่า อยู่ที่ปุ่มชื่อของคุณ หรือแท็บ <b>ฉัน</b> ด้านล่าง</p>
            <button type="button" onClick={() => hideCard("kin-coach-me")}>เข้าใจแล้ว</button>
          </div>
        )}
        <div className="absolute inset-x-0 top-full"><OfflineBar /></div>
      </header>

      <main className="space-y-4 px-4 py-5" style={big ? { zoom: 1.12 } : undefined}>
        <BranchNotice user={user} />
        {tab === "tasks" && (
          <>
            <div className="ka-head">
              <div><div className="ka-hello"><h1>สวัสดี {shortName(user.name)}</h1>
                {/* งานที่หัวหน้าให้ดาวต่ำ (ต้องแก้) · กดไปดูที่แท็บ "ฉัน" */}
                {fixCount > 0 && <button type="button" className="ka-fix" onClick={() => { setTab("perf"); setPerfView("me"); window.scrollTo(0, 0); }} aria-label={`งานต้องแก้ ${fixCount} งาน · ดูที่แท็บฉัน`}><Icon name="alert" className="h-3.5 w-3.5" />ต้องแก้ {fixCount}</button>}
              </div><p>{new Date().toLocaleDateString("th-TH", { weekday: "short", day: "numeric", month: "short" })} · {myShiftText}</p></div>
              <div className="relative" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="ka-pill" aria-expanded={fab} onClick={() => setFab(!fab)}><Icon name="plus" className="h-4 w-4" />ผลงานพิเศษ</button>
                {fab && (
                  <div className="absolute right-0 top-[calc(100%+6px)] z-20 w-64 overflow-hidden rounded-2xl border border-cream-300 bg-white shadow-soft">
                    <button className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-cream-100" onClick={() => { setFab(false); setBonusWho(""); setBonusText("ภาพประทับใจส่งญาติ"); open("bonus"); }}><Icon name="camera" className="h-5 w-5 text-gold-600" /><span>ภาพประทับใจส่งญาติ<span className="block text-xs text-gold-500">(ได้ดาว)</span></span></button>
                    <button className="flex w-full items-center gap-3 border-t border-cream-300/60 px-4 py-3 text-left text-sm hover:bg-cream-100" onClick={() => { setFab(false); setBonusWho(""); setBonusText(""); open("bonus"); }}><Icon name="alert" className="h-5 w-5 text-gold-600" /><span>แจ้งงาน/เก็บตกด่วน<span className="block text-xs text-gold-500">(ฮีโร่ +1)</span></span></button>
                  </div>
                )}
              </div>
            </div>

            {nudges.map((n) => {
              const t = tasks.find((k) => k.rid === n.taskId);
              if (t?.done) return null; // ส่งงานแล้ว: ซ่อนทันที ไม่ต้องรอดึงข้อมูลรอบถัดไป
              return (
                <section key={n.id} className="ka-nudge" role="alert">
                  <p className="ka-nudge-h"><Icon name="bell" className="h-4 w-4" />หัวหน้าตามงาน<span>{n.at}</span></p>
                  <p className="ka-nudge-b"><b>{n.task}{n.resident ? ` · ${n.resident}` : ""}</b><small>{n.time ? `กำหนด ${n.time} น. · ` : ""}{n.sentBy}{n.message ? `: "${n.message}"` : ""}</small></p>
                  {why === n.id
                    ? <div className="ka-nudge-why"><small>ทำไม่ได้เพราะ</small>{NUDGE_WHY.map((w) => <button key={w} type="button" onClick={() => replyNudge(n, w)}>{w}</button>)}<button type="button" className="is-x" onClick={() => setWhy(null)}>ยกเลิก</button></div>
                    : <div className="ka-nudge-a">
                      {t && canSubmit(t) && <button type="button" className="ka-nudge-go" onClick={() => { open("task", t.id); setProxyFor(null); }}><Icon name="camera" className="h-4 w-4" />ทำเลย · ถ่ายรูปส่ง</button>}
                      {t && !canSubmit(t) && <button type="button" className="ka-nudge-go" onClick={() => open("sop", t.id)}>ดูงาน</button>}
                      <button type="button" className="ka-nudge-no" onClick={() => setWhy(n.id)}>ทำไม่ได้</button>
                    </div>}
                </section>
              );
            })}

            <CheckInCard user={user} compact />

            {nextTask && taskTab === "todo" && <>
              <p className="ka-h">งานถัดไป</p>
              <div className="ka-next">
                <button type="button" className="ka-next-main" onClick={() => open("sop", nextTask.id)}>
                  <span className="ka-time"><b>{nextTask.time || "-"}</b>{dueIn(nextTask)}</span>
                  <span className="ka-t"><b>{nextTask.title}</b><small>{nextTask.who}{roomOf(nextTask.who) ? ` · ห้อง ${roomOf(nextTask.who)}` : ""}</small></span>
                </button>
                <button type="button" className="btn-primary ka-btn-sm" onClick={() => { open("task", nextTask.id); setProxyFor(null); }}><Icon name="camera" className="h-4 w-4" />ส่งงาน</button>
              </div>
            </>}

            {/* ต้องรู้ก่อนเริ่มงาน: แถวเดียว กดเพื่อกาง/พับ (เริ่มต้นพับไว้) · ไม่มีส่งเวรค้าง = ลิงก์เขียนส่งเวรอยู่ในแถวเดียวกัน */}
            <section className="ka-know" aria-label="ต้องรู้ก่อนเริ่มงาน">
              <div className="ka-know-bar">
                {(handover.length > 0 || appts.length > 0) && (
                  <button type="button" className="ka-know-t" aria-expanded={know} aria-controls="ka-know-body" onClick={() => setKnow(!know)}>
                    <span className={`ka-dot ${handover.length > 0 ? "is-warn" : ""}`} />
                    <span className="ka-know-x">{[handover.length > 0 ? `สมุดส่งเวร ${handover.length} เรื่อง` : "", appts.length > 0 ? `นัด ${appts.length} รายการ` : ""].filter(Boolean).join(" · ")}</span>
                    <Icon name="chevron" className={`ka-know-c ${know ? "is-open" : ""}`} />
                  </button>
                )}
                {handover.length === 0 && <button type="button" className="ka-link" onClick={() => open("handover")}><Icon name="book" className="h-4 w-4" />สมุดส่งเวร · เขียนส่งเวร</button>}
              </div>
              {know && (handover.length > 0 || appts.length > 0) && (
                <ul id="ka-know-body" className="ka-list">
                  {handover.length > 0 && (
                    <li><button type="button" className="ka-row" onClick={() => open("handover")}>
                      <span className="ka-dot is-warn" /><span className="ka-t"><b>สมุดส่งเวร {handover.length} เรื่อง</b><small>{handover[0].who ? `${handover[0].who} · ` : ""}{handover[0].text}</small></span><Icon name="chevron" className="ka-chev" />
                    </button></li>
                  )}
                  {appts.map((a, k) => (
                    <li key={k} className="ka-row"><span className="ka-dot" /><span className="ka-t"><b>นัด{a.when} น.</b><small>{a.who} · {a.what}</small></span></li>
                  ))}
                </ul>
              )}
            </section>

            {/* แถบเดียวบรรทัดเดียว: ติดตั้งแอปมาก่อน แล้วจึงเปิดแจ้งเตือน · × = ไว้ทีหลัง (จำในเครื่อง) */}
            {pushCard && (
              <section className="ka-pbar" aria-label={pushCard === "install" ? "ติดตั้ง KinApp" : "เปิดการแจ้งเตือน"}>
                <Icon name={pushCard === "install" ? "download" : "bell"} className="h-4 w-4 shrink-0" />
                <p>{pushCard === "install" ? (push.state === "on" ? "ติดตั้งให้แจ้งเตือนเป็น KinApp" : "ติดตั้ง KinApp ก่อนรับแจ้งเตือน")
                  : pushCard === "enable" ? "รับแจ้งเตือนเมื่อหัวหน้าตามงาน" : "เปิดแจ้งเตือนได้ที่ตั้งค่าเครื่อง"}</p>
                {pushCard === "install" && pwa.canInstall && <button type="button" className="ka-pbar-go" onClick={async () => { if (await pwa.install()) toast(push.state === "on" ? "ติดตั้ง KinApp แล้ว · แจ้งเตือนครั้งต่อไปจะขึ้นเป็น KinApp" : "ติดตั้ง KinApp แล้ว · เปิดจากไอคอนบนหน้าจอโทรศัพท์ แล้วกดเปิดการแจ้งเตือน"); }}>ติดตั้ง</button>}
                {pushCard === "install" && !pwa.canInstall && pwa.iosHint && <button type="button" className="ka-pbar-go" onClick={() => setIosHelp(true)}>วิธีติดตั้ง</button>}
                {pushCard === "enable" && <button type="button" className="ka-pbar-go" disabled={push.busy} aria-label="เปิดการแจ้งเตือน" onClick={async () => toast(await push.enable())}>{push.busy ? "กำลังเปิด…" : "เปิด"}</button>}
                <button type="button" className="ka-pbar-x" aria-label="ซ่อนไว้ก่อน" title="ซ่อนไว้ก่อน" onClick={() => hideCard(pushCard === "install" ? "kin-install-hide" : "kin-push-hide")}><Icon name="close" className="h-4 w-4" /></button>
              </section>
            )}

            <div className="ka-seg" role="tablist" aria-label="รายการงาน">
              <button type="button" role="tab" aria-selected={taskTab === "todo"} onClick={() => setTaskTab("todo")}>รอทำ {taskView === "mine" ? myPending.length : pendingAll.length}</button>
              <button type="button" role="tab" aria-selected={taskTab === "sent"} onClick={() => setTaskTab("sent")}>ส่งแล้ว {mySent.length}</button>
              <button type="button" role="tab" aria-selected={taskTab === "fac"} onClick={() => setTaskTab("fac")}>ส่วนกลาง {facLeft.length}</button>
            </div>

            {taskTab === "todo" && <>
              <div className="ka-chips" role="radiogroup" aria-label="แสดงงาน">
                <button type="button" role="radio" aria-checked={taskView === "mine"} onClick={() => setTaskView("mine")}>ของฉันและทีม {myPending.length}</button>
                <button type="button" role="radio" aria-checked={taskView === "all"} onClick={() => setTaskView("all")}>ทั้งสาขา {pendingAll.length}</button>
              </div>
              {myShift === null && taskView === "mine" && <p className="ka-note">{shownShift ? `เวร${shownShift}ของคุณเป็นของวันทำงานอื่น (เปลี่ยนวัน 07:00 น.)` : "วันนี้ไม่มีเวรของคุณในตาราง"} · แสดงเฉพาะงานที่ระบุชื่อคุณ</p>}
              {myPending.length === 0 && (taskView === "mine" || pendingAll.length === 0) && <Empty t={pendingAll.length ? "ไม่มีงานของคุณค้างแล้ว · กด \"ทั้งสาขา\" เพื่อดูงานของทีม" : tasks.length ? "ไม่มีงานค้างแล้ว เยี่ยมมาก" : "ยังไม่มีงานที่ผู้จัดการมอบหมายสำหรับวันนี้"} />}
              {myLate.length > 0 && <><p className="ka-h is-bad">เลยเวลา · {myLate.length}</p><ul className="ka-list">{myLate.map(taskRow)}</ul></>}
              {myGroups.map(([time, list]) => <div key={time}><p className="ka-h">{time || "ไม่ระบุเวลา"} · {list.length} งาน</p><ul className="ka-list">{list.map(taskRow)}</ul></div>)}
              {taskView === "all" && others.length > 0 && <><p className="ka-h">{others.some((k) => !canSubmit(k)) ? "ของคนอื่นหรือเวรอื่น · ทำแทนได้" : "งานของเวรอื่น"}</p><ul className="ka-list">{others.map(taskRow)}</ul></>}
            </>}

            {taskTab === "sent" && <>
              {mySent.length === 0 && doneForMe.length === 0 && <Empty t="ยังไม่มีงานที่คุณส่งวันนี้" />}
              {mySent.length > 0 && <ul className="ka-list">{mySent.map((k) => {
                const rv = reviewOf(k.rid);
                const proxy = proxyText(k.note);
                return (
                  <li key={k.id}><button type="button" className="ka-row" onClick={() => open("viewtask", k.id)}>
                    <span className="ka-time"><b>{k.done}</b></span>
                    <span className="ka-t"><b>{k.title}</b><small>{k.who}</small>
                      <span className="ka-tags">
                        {proxy && <em className="ka-flag info">{proxy}</em>}
                        {!rv ? <em className={`ka-flag ${k.status === "ตรวจแล้ว" ? "ok" : "warn"}`}>{k.status === "ตรวจแล้ว" ? "ตรวจแล้ว" : "รอหัวหน้าตรวจ"}</em>
                          : <em className={`ka-flag ${rv.stars <= 2 ? "warn" : "ok"}`}>{rv.stars <= 2 ? "ต้องแก้ไข" : "ตรวจแล้ว"} <span className="review-stars">{starText(rv.stars)}</span></em>}
                      </span>
                      {rv?.note && <small className="ka-quote">&ldquo;{rv.note}&rdquo;</small>}
                    </span>
                    <Icon name="chevron" className="ka-chev" />
                  </button></li>
                );
              })}</ul>}
              {doneForMe.length > 0 && <><p className="ka-h">มีคนทำแทนให้คุณ</p><ul className="ka-list">{doneForMe.map((k) => (
                <li key={k.id} className="ka-row"><span className="ka-dot is-ok" /><span className="ka-t"><b>{k.title}</b><small>{k.who} · {k.by} ทำแทนให้แล้ว {k.done} น.</small></span></li>
              ))}</ul></>}
            </>}

            {taskTab === "fac" && <>
              {fac.length === 0 ? <Empty t="ยังไม่มีงานส่วนกลางของสาขา" /> : <ul className="ka-list">{[...fac].sort((a, b) => Number(a.done) - Number(b.done) || Number(b.late) - Number(a.late)).map((f) => (
                <li key={f.id} className={`ka-row ${f.late && !f.done ? "is-late" : ""}`}>
                  <span className="ka-t"><b>{f.name}{f.manual && <em className="ka-flag me">มอบหมายให้คุณ</em>}</b>
                    <small>{[f.category, f.schedule].filter((x) => x && x !== "-").join(" · ")}</small>
                    {f.done && f.last && <small className="text-emerald-800">ทำแล้ว {f.last.at.slice(11)} น. โดย {f.last.by}</small>}
                    {!f.done && f.late && <small className="font-semibold text-red-700">เลยเวลาแล้ว ยังไม่มีคนทำ</small>}</span>
                  {!f.done && <button type="button" className="ka-send" onClick={() => { setFacPick(f); setPhoto(""); setNote(""); setModal("facility"); }}><Icon name="camera" className="h-5 w-5" /><span>ทำแล้ว</span></button>}
                </li>
              ))}</ul>}
              {fac.length > 0 && <p className="ka-note">ส่งได้รอบละ 1 ครั้ง · ใครทำก่อนกดส่ง · งานที่มอบหมายให้คุณ คุณเป็นคนส่ง</p>}
            </>}
          </>
        )}

        {tab === "roster" && <StaffRoster user={user} />}

        {tab === "meds" && (
          <>
            <div className="ka-head">
              <div><h1>จ่ายยา</h1><p>มื้อ{meal} · จ่ายแล้ว {mealQ.filter((p) => p.given).length} จาก {mealQ.length} ซอง</p></div>
              <Link href="/pharmacy?page=dispense" className="ka-pill"><Icon name="pill" className="h-4 w-4" />แอปจัดยา</Link>
            </div>
            <div className="ka-meals" role="radiogroup" aria-label="มื้อยา">
              {MEALS.map((m) => <button key={m} type="button" role="radio" aria-checked={meal === m} onClick={() => setMeal(m)}>{m}<b>{queue.filter((p) => p.meal === m).length}</b></button>)}
            </div>
            <div className="ka-prog" aria-hidden><i style={{ width: `${mealQ.length ? Math.round((mealQ.filter((p) => p.given).length / mealQ.length) * 100) : 0}%` }} /></div>
            <div className="ka-chips" role="radiogroup" aria-label="สถานะซอง">
              {([["", "ทั้งหมด"], ["ready", "พร้อมจ่าย"], ["wait", "รอห้องยา"], ["done", "จ่ายแล้ว"]] as const).map(([k, l]) => (
                <button key={k} type="button" role="radio" aria-checked={medF === k} onClick={() => setMedF(k)}>{l} {mealQ.filter((p) => !k || packState(p) === k).length}</button>
              ))}
            </div>
            {mealQ.length === 0 ? <Empty t={queue.length ? `ไม่มีซองยามื้อ${meal}ของวันนี้` : "ยังไม่มีซองยาของวันนี้ ห้องยาจัดยาได้ที่แอปจัดยา"} /> : (
              <ul className="space-y-3">{mealQ.filter((p) => !medF || packState(p) === medF).map((m) => {
                const low = lowFor(m.who);
                const room = roomOf(m.who);
                return (
                  <li key={m.id} className={`ka-pack ${m.given ? "is-done" : ""}`}>
                    <div className="ka-pack-h"><Avatar kind="resident" id={RESIDENTS.find((x) => x.name === m.who)?.id} name={m.who} size={40} />
                      <span className="ka-t"><b>{m.who}</b><small>{room ? `ห้อง ${room}` : "ยังไม่มีห้อง"} · {m.items.length} รายการ{allergy[m.who] && <em className="ka-flag bad">แพ้ {allergy[m.who]}</em>}</small></span></div>
                    <div className="ka-pills">{m.items.map((x) => {
                      const l = low.find((d) => x.includes(d.name));
                      return <span key={x} className={l && !m.given ? "is-low" : ""}>{x}{l && !m.given ? ` · เหลือ ${l.stock} ${l.unit}` : ""}</span>;
                    })}</div>
                    {m.given ? <p className="ka-given"><Icon name="check" className="h-4 w-4" />ให้ยาแล้ว · {m.gby ?? "-"}{m.gat ? ` · ${m.gat}` : ""}</p>
                      : m.qa === "ตรวจผ่าน" ? <button type="button" className="btn-primary w-full" onClick={() => open("dispense", m.id)}><Icon name="check" className="h-4 w-4" /> บันทึกการให้ยา</button>
                        : <p className={`ka-wait ${m.qa === "แจ้งจัดยาผิด" ? "is-bad" : ""}`}>{m.qa === "แจ้งจัดยาผิด" ? "ห้องยากำลังแก้ไขซองนี้" : "รอห้องยาตรวจ QA ก่อนจ่าย"}</p>}
                  </li>
                );
              })}</ul>
            )}
          </>
        )}

        {PHYSIO_VIEWS.includes(tab) && <PhysioKin view={tab as "ptoday" | "pweek" | "pcases"} user={user} onCount={setPkCount} />}

        {tab === "residents" && (
          <>
            <div className="ka-head"><div><h1>ผู้รับบริการ</h1><p>{RESIDENTS.length} คน · สาขา{user.branch || "-"}</p></div></div>
            <label className="ka-search"><Icon name="search" className="h-4 w-4" /><input value={resQ} onChange={(e) => setResQ(e.target.value)} placeholder="ค้นหาชื่อหรือเลขห้อง" aria-label="ค้นหาผู้รับบริการ" /></label>
            <div className="ka-chips" role="radiogroup" aria-label="กรองผู้รับบริการ">
              <button type="button" role="radio" aria-checked={!resTodo} onClick={() => setResTodo(false)}>ทั้งหมด {RESIDENTS.length}</button>
              <button type="button" role="radio" aria-checked={resTodo} onClick={() => setResTodo(true)}>ยังไม่วัดวันนี้ {RESIDENTS.filter((r) => !measured[r.name]).length}</button>
            </div>
            {resList.length === 0 ? <Empty t={resQ ? `ไม่พบ "${resQ}"` : "วัดสัญญาณชีพครบทุกคนแล้ว"} /> : (
              <ul className="ka-res-list">{resList.map((r) => (
                // การ์ดทั้งใบกดดูข้อมูลได้ ("ดูข้อมูล ›") · ปุ่มวัดสัญญาณชีพแยกลงบรรทัดล่าง ไม่ติดกับลูกศร
                <li key={r.id ?? r.name} className="ka-res">
                  <button type="button" className="ka-res-main" onClick={() => setResPick(r)} aria-label={`ดูข้อมูล ${r.name}`}>
                    <Avatar kind="resident" id={r.id} name={r.name} size={46} />
                    <span className="ka-t"><b>{r.name}</b><small>{r.room && r.room !== "-" ? `ห้อง ${r.room}` : "ยังไม่มีห้อง"} · {r.age} ปี{allergy[r.name] && <em className="ka-flag bad">แพ้ {allergy[r.name]}</em>}</small>{ptDone[r.name] && <em className="ka-pt">กายภาพแล้ว {ptDone[r.name]}</em>}</span>
                    <span className="ka-res-go">ดูข้อมูล<Icon name="chevron" className="h-4 w-4 -rotate-90" /></span>
                  </button>
                  <div className="ka-res-foot">
                    <span className={`ka-res-st ${measured[r.name] ? "is-done" : ""}`}><i aria-hidden />{measured[r.name] ? `วัดแล้ว ${measured[r.name]} น.` : "ยังไม่วัดวันนี้"}</span>
                    <button type="button" className="ka-res-vital" onClick={() => setVitalsFor(r.name)}><Icon name="pulse" className="h-4 w-4" />{measured[r.name] ? "วัดอีกครั้ง" : "วัดสัญญาณชีพ"}</button>
                  </div>
                </li>
              ))}</ul>
            )}
          </>
        )}

        {tab === "perf" && (() => {
          const ranked = (kpi?.rows ?? []).filter((r) => r.total != null);
          const me = kpi?.rows.find((r) => r.id === user.id);
          const sc = me ? { family: me.family?.score ?? null, manager: me.manager?.score ?? null, tasks: me.tasks?.score ?? null, punctual: me.punctual?.score ?? null } : null;
          return (
            <>
              <section className="ka-me-card">
                <AvatarEdit kind="staff" id={user.id} name={user.name} size={76} onDone={(m) => toast(m)}
                  title={<span className="ka-me-name"><b>{user.name}</b><small>{ROLE_INFO[user.role].th} · สาขา{user.branch || "-"}</small></span>} />
              </section>
              <ul className="ka-set" aria-label="ตั้งค่าและบัญชี">
                {push.state !== "loading" && push.state !== "none" && <li><button type="button" disabled={push.busy} onClick={togglePush}>
                  <Icon name="bell" className="h-5 w-5" /><span><b>แจ้งเตือนบนโทรศัพท์</b><small>{push.state === "on" ? "เด้งเมื่อหัวหน้าตามงาน" : push.state === "ios" ? "ติดตั้งแอปที่หน้าจอโฮมก่อน" : push.state === "denied" ? "เปิดได้ที่ตั้งค่าของเครื่อง" : "ยังไม่ได้เปิด"}</small></span>
                  <em className={push.state === "on" ? "is-on" : ""}>{push.state === "on" ? "เปิด" : "ปิด"}</em></button></li>}
                {!pwa.installed && <li><button type="button" onClick={installApp}><Icon name="download" className="h-5 w-5" /><span><b>ติดตั้ง KinApp บนเครื่อง</b><small>เปิดจากไอคอนบนหน้าจอได้เลย</small></span><Icon name="chevron" className="ka-set-go h-4 w-4 -rotate-90" /></button></li>}
                <li><button type="button" onClick={toggleBig}><span className="ka-set-aa" aria-hidden>Aa</span><span><b>ตัวอักษรใหญ่</b><small>ขยายทุกหน้าในแอปนี้</small></span><em className={big ? "is-on" : ""}>{big ? "เปิด" : "ปิด"}</em></button></li>
                <li><button type="button" onClick={() => open("manual")}><Icon name="book" className="h-5 w-5" /><span><b>คู่มือผู้ใช้งาน</b></span><Icon name="chevron" className="ka-set-go h-4 w-4 -rotate-90" /></button></li>
                <li><button type="button" onClick={() => open("pwd")}><Icon name="lock" className="h-5 w-5" /><span><b>เปลี่ยนรหัสผ่าน</b></span><Icon name="chevron" className="ka-set-go h-4 w-4 -rotate-90" /></button></li>
                <li><button type="button" className="is-out" onClick={onLogout}><Icon name="logout" className="h-5 w-5" /><span><b>ออกจากระบบ</b></span></button></li>
              </ul>
              <p className="ka-h">ผลงาน · {new Date().toLocaleDateString("th-TH", { month: "long", year: "numeric" })}</p>
              <section className="ka-kpi">
                <div className="ka-ring" style={{ ["--p" as string]: me?.total ?? 0 }}><b>{me?.total ?? "-"}</b><small>คะแนน</small></div>
                <div className="ka-t">
                  <b>{me?.rank ? `อันดับ ${me.rank} จาก ${ranked.length} คน` : kpi ? "ยังไม่มีคะแนนเดือนนี้" : "กำลังโหลด…"}</b>
                  <small>KPI เดือนนี้ · งานวันนี้ {mine} งาน · ดาวครอบครัว {myStars}</small>
                  {sc && kpi && <ul className="ka-bars">{KPI_PARTS.map((p) => (
                    <li key={p.key}><span>{p.label}</span><i style={{ ["--w" as string]: `${sc[p.key] ?? 0}%` }} /><b>{pointsOf(p.key, sc, kpi.weights) ?? "-"}</b></li>
                  ))}</ul>}
                </div>
              </section>
              <div className="ka-seg" role="tablist" aria-label="ผลงาน">
                {([["me", "ของฉัน"], ["team", "ทีม"], ["rank", "อันดับ"]] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={perfView === k} onClick={() => setPerfView(k)}>{l}</button>)}
              </div>

              {perfView === "me" && <>
                <p className="ka-h">ผลตรวจงานล่าสุด · 7 วัน</p>
                {!myReviews.length ? <p className="ka-empty">ยังไม่มีงานที่หัวหน้าตรวจในสัปดาห์นี้</p> : (
                  <ul className="ka-list">{myReviews.slice(0, 8).map((r) => (
                    <li key={r.id} className="ka-row"><span className={`ka-dot ${r.stars <= 2 ? "is-warn" : "is-ok"}`} />
                      <span className="ka-t"><b>{r.task} · <span className="review-stars">{starText(r.stars)}</span></b>
                        <small>{r.name} · {r.date.split("-").reverse().slice(0, 2).join("/")}{r.by ? ` · ตรวจโดย ${r.by}` : ""}</small>
                        {r.stars <= 2 && <small className="font-semibold text-amber-900">ต้องแก้ไข · ทำตามความเห็นของหัวหน้าในงานครั้งถัดไป</small>}
                        {r.note && <small className="ka-quote">&ldquo;{r.note}&rdquo;</small>}</span></li>
                  ))}</ul>
                )}
                <p className="ka-h">รีวิวจากครอบครัว</p>
                {!myRev?.recent.length ? <p className="ka-empty">ยังไม่มีรีวิวจากครอบครัว</p> : (
                  <ul className="ka-list">{myRev.recent.slice(0, 5).map((r) => (
                    <li key={r.id} className="ka-row"><span className="ka-t"><b><span className="review-stars">{"★".repeat(r.rating)}{"☆".repeat(5 - r.rating)}</span></b>
                      {r.comment && <small className="ka-quote">&ldquo;{r.comment}&rdquo;</small>}
                      <small>{[r.rater_name || "ญาติ", r.relation].filter(Boolean).join(" · ")} ของ{r.resident_name} · {r.at}</small></span></li>
                  ))}</ul>
                )}
                {(feed.cheers.length > 0 || feed.kudos.length > 0) && <>
                  <p className="ka-h">คำชมและกำลังใจ</p>
                  <ul className="ka-list">
                    {feed.cheers.map((c, k) => <li key={`c${k}`} className="ka-row"><span className="ka-t"><b>{c.message}</b><small>กำลังใจถึงสาขา · {c.sent_by} · {c.at}</small></span></li>)}
                    {feed.kudos.map((c, k) => <li key={`k${k}`} className="ka-row"><span className="ka-t"><b>{c.given_by} ชื่นชมคุณ</b><small>{c.task_title}{c.resident_name ? ` · ${c.resident_name}` : ""} · {c.at}</small></span></li>)}
                  </ul>
                </>}
              </>}

              {perfView === "team" && <>
                <p className="ka-h">งานที่ทีมทำเสร็จวันนี้ · {doneTasks.length}</p>
                {doneTasks.length === 0 ? <p className="ka-empty">ยังไม่มีงานที่ทำเสร็จวันนี้</p> : (
                  <ul className="space-y-2">{doneTasks.map((k) => (
                    <li key={k.id}><button onClick={() => open("viewtask", k.id)} className="team-done">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {k.rid && photos[k.rid] ? <img src={photos[k.rid]} alt={`รูปงาน ${k.title}`} /> : <span className="team-done-nophoto"><Icon name="camera" className="h-5 w-5" /></span>}
                      <span className="min-w-0 flex-1"><b>{k.title}</b><small>{k.who}</small><small>โดย {k.by ?? "-"}</small></span>
                      <span className="shrink-0 text-xs text-gold-600">{k.done}</span>
                    </button></li>
                  ))}</ul>
                )}
              </>}

              {perfView === "rank" && <>
                {ranked[0] && (
                  <section className="rounded-3xl bg-gradient-to-br from-gold-700 to-gold-400 p-5 text-white shadow-soft">
                    <p className="text-xs tracking-wider text-white/80">พนักงานดีเด่นประจำเดือน · สาขา{user.branch}</p>
                    <p className="mt-1 text-xl font-semibold">{ranked[0].name}</p>
                    <p className="text-sm text-white/80">KPI {ranked[0].total} คะแนน</p>
                  </section>
                )}
                {!ranked.length ? <p className="ka-empty">ยังไม่มีคะแนน KPI ของเดือนนี้</p> : (
                  <ol className="ka-list">{ranked.map((r) => (
                    <li key={r.id} className={`ka-row ${r.id === user.id ? "is-me" : ""}`}>
                      <span className="ka-rank">{r.rank}</span>
                      <span className="ka-t"><b>{r.name}{r.id === user.id ? " (ฉัน)" : ""}</b><span className="ka-rank-bar"><i style={{ width: `${r.total ?? 0}%` }} /></span></span>
                      <b className="ka-score">{r.total}</b>
                    </li>
                  ))}</ol>
                )}
              </>}
            </>
          );
        })()}
      </main>

      {/* เมนูล่าง: แถบลอยสีสว่าง · ปุ่มที่เลือกเป็นแคปซูลสีแชมเปญ · ตัวเลข = งานรอทำ (แดงเมื่อมีงานเลยเวลา) / ซองยาพร้อมจ่าย */}
      <nav aria-label="เมนูล่าง" className="ka-nav">
        {tabs.map((x) => {
          const n = x.id === "tasks" ? myPending.length : x.id === "meds" ? ready.length : x.id === "ptoday" ? pkCount : 0;
          return (
            <button key={x.id} type="button" aria-current={tab === x.id ? "page" : undefined} className={tab === x.id ? "is-on" : ""} onClick={() => { setTab(x.id); setFab(false); window.scrollTo(0, 0); }}>
              <span className="ka-nav-ic"><Icon name={x.icon} className="h-[22px] w-[22px]" />{n > 0 && <i className={`ka-bdg ${x.id === "tasks" && myLate.length ? "is-bad" : ""}`}>{n > 99 ? "99+" : n}</i>}</span>{x.label}
            </button>
          );
        })}
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
          // หางานจากรหัสแถวตอนกดยืนยัน (ลำดับในรายการอาจเปลี่ยนหลังดึงข้อมูลใหม่)
          const id = String(cur ?? "");
          const k = dids.indexOf(id);
          if (k < 0) { close(); return toast("ไม่พบงานนี้แล้ว (อาจถูกลบหรือย้ายวัน) · กรุณาเปิดรายการงานใหม่"); }
          if (drows[k][5] && drows[k][5] !== "รอทำ") { close(); return toast(`งานนี้ส่งไปแล้ว${drows[k][10] && drows[k][10] !== "-" ? `โดย ${drows[k][10]}` : ""} · ไม่ต้องส่งซ้ำ`); }
          const row = [...drows[k]]; while (row.length < 11) row.push("-");
          const now = new Date();
          row[5] = "เสร็จแล้ว"; row[8] = new Date(now.getTime() + 7 * 3600e3).toISOString().slice(11, 16); row[9] = [proxyFor ? `ทำแทน ${proxyFor}` : "", proxyFor ? proxyReason : "", note.trim()].filter(Boolean).join(" · ") || "-"; row[10] = user.name;
          const shot = photo, share = shareFam;
          // รูปหลักฐาน: ส่งหลัง server รับการส่งงานแล้วเท่านั้น (มีคนส่งก่อน = ไม่ส่งรูปทับของเขา) · ออฟไลน์ = รอส่งพร้อมงาน
          // ประทับวันเวลา ผู้รับบริการ และชื่องาน แล้วเก็บแยกให้ผู้จัดการเปิดดูตอนตรวจงาน
          updDaily(k, row).then((res) => {
            if (!res.ok) return; // เหตุผลขึ้นจาก event ของที่เก็บข้อมูล
            return stampPhoto(shot, [`ส่งงาน ${now.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })} น. · ${now.toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric" })}`, `${row[0]} · ${row[1]}`, `${user.name} · สาขา${user.branch ?? "-"}`])
              .then((p) => fetch("/api/care", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "task_photo", id, photo: p, share }) }))
              .then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error); })
              .catch((e) => toast((e as Error).message || "ส่งงานแล้ว แต่อัปโหลดรูปไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ต"));
          });
          close(); toast(`${proxyFor ? `ส่งงานแทน ${proxyFor} แล้ว` : "ส่งงานแล้ว"} · ${row[1]} · ${row[0]}${shareFam ? " · แชร์รูปให้ญาติแล้ว" : ""}`); setProxyFor(null);
        }}>ยืนยันการส่งงาน</button>}>
        {t && <div className="space-y-4">
          <div className="rounded-2xl bg-cream-50 p-4 text-sm"><p className="font-semibold text-gold-900">{t.title}</p><p className="text-gold-600">{t.who} · เวลา: {t.time}</p></div>
          {proxyFor && <p className="ka-proxy-banner"><Icon name="info" className="h-4 w-4" />กำลังส่งแทน {proxyFor} · {proxyReason}</p>}
          <PhotoInput label="แตะเพื่อเปิดกล้องถ่ายรูป" file={photo} onFile={setPhoto} />
          <label className="share-toggle"><input type="checkbox" checked={shareFam} onChange={(e) => setShareFam(e.target.checked)} />
            <span><b>แชร์รูปนี้ให้ครอบครัวเห็น</b><small>ขึ้นในสมุดภาพประจำวันของ{t.who} · เอาติ๊กออกถ้ารูปติดผู้รับบริการคนอื่น หรือเห็นร่างกายส่วนที่ไม่ควรเปิดเผย</small></span></label>
          <Field label="บันทึกย่อ (Note) - ไม่บังคับ"><textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="ตัวอย่าง: ทานอาหารหมดจาน, หลับสนิทดี, ร่วมกิจกรรมยิ้มแย้ม..." /><p className="mt-1 text-xs text-gold-500">ญาติเห็นบันทึกนี้ในสมุดภาพประจำวัน · เรื่องอาการที่ต้องแจ้งทีม ให้เขียนในสมุดส่งเวร</p></Field>
        </div>}
      </Modal>

      <Modal open={modal === "sop"} title="รายละเอียดงาน" onClose={close}
        footer={t && (canSubmit(t)
          ? <button className="btn-primary w-full" onClick={() => { open("task", t.id); setProxyFor(null); }}><Icon name="camera" className="h-4 w-4" /> ถ่ายรูปและส่งงาน</button>
          : <button className="btn-soft w-full" onClick={() => doFor(t)}>ทำแทน</button>)}>
        {t && <div className="space-y-3 text-sm">
          <div><p className="text-base font-semibold text-gold-900">{t.title} · {t.time || "-"}</p><p className="text-gold-600">{t.who}{roomOf(t.who) ? ` · ห้อง ${roomOf(t.who)}` : ""} · {t.owner === user.name ? "งานของคุณ" : t.owner ? `มอบหมายให้ ${t.owner}` : `ทีม${t.shift ?? "เวร"}`}</p></div>
          {isLate(t) && <p className="ka-wait is-bad">เลยเวลาแล้ว · ส่งได้ทันที</p>}
          {allergy[t.who] && <p className="ka-wait is-bad">แพ้ {allergy[t.who]}</p>}
          <div className="rounded-2xl bg-cream-50 p-4"><p className="mb-1 flex items-center gap-2 font-semibold text-gold-800"><Icon name="book" className="h-4 w-4" />คู่มือปฏิบัติงาน</p><p className="leading-7">{t.ins}</p></div>
        </div>}
      </Modal>

      <Modal open={modal === "proxy"} title={t ? `ทำแทน ${ownerOf(t)}` : "ทำแทน"} onClose={close}
        footer={<button className="btn-primary w-full" onClick={() => { if (!t) return; const who = ownerOf(t); open("task", t.id); setProxyFor(who); }}><Icon name="camera" className="h-4 w-4" /> ถ่ายรูปและส่งแทน</button>}>
        {t && <div className="space-y-4 text-sm">
          <p className="rounded-2xl bg-cream-50 p-3"><b className="text-gold-900">{t.title}</b><br /><span className="text-gold-600">{t.who} · {t.time || "-"} · {t.owner ? `มอบหมายให้ ${t.owner}` : `งานของทีม${t.shift ?? "เวร"}`}</span></p>
          <div><p className="label">เหตุผล (เลือก 1 ข้อ)</p>
            <div className="ka-chips" role="radiogroup" aria-label="เหตุผลที่ทำแทน">{PROXY_REASONS.map((x) => <button key={x} type="button" role="radio" aria-checked={proxyReason === x} onClick={() => setProxyReason(x)}>{x}</button>)}</div></div>
          <p className="ka-note">ผลงานนับให้คุณ · {ownerOf(t)} และหัวหน้าจะเห็นว่าคุณทำแทน</p>
        </div>}
      </Modal>

      <Modal open={!!resPick} title={resPick?.name ?? ""} onClose={() => setResPick(null)}>
        {resPick && <div className="space-y-3">
          {resPick.id && <AvatarEdit kind="resident" id={resPick.id} name={resPick.name} size={72} onDone={(m) => toast(m)}
            title={<span className="ka-me-name"><b>{resPick.name}</b></span>} />}
          <p className="text-sm text-gold-600">{resPick.room && resPick.room !== "-" ? `ห้อง ${resPick.room}` : "ยังไม่มีห้อง"} · {resPick.age} ปี{measured[resPick.name] ? ` · วัดสัญญาณชีพแล้ว ${measured[resPick.name]} น.` : ""}</p>
          {allergy[resPick.name] && <p className="ka-wait is-bad">แพ้ {allergy[resPick.name]}</p>}
          <div className="ka-acts">
            <button type="button" className="is-primary" onClick={() => { const n = resPick.name; setResPick(null); setVitalsFor(n); }}><Icon name="pulse" className="h-5 w-5" />บันทึกสัญญาณชีพ</button>
            <button type="button" disabled={!resPick.id} onClick={() => { const id = resPick.id!; setResPick(null); setProfile(id); }}><Icon name="doc" className="h-5 w-5" />ประวัติและสรุปตอบญาติ</button>
            <button type="button" disabled={!resPick.id} onClick={() => { const r = resPick; setResPick(null); setFu({ id: r.id!, name: r.name, text: "", photo: "", busy: false }); }}><Icon name="camera" className="h-5 w-5" />ส่งข่าวญาติ</button>
            <button type="button" disabled={!resPick.id} onClick={() => { const id = resPick.id!; setResPick(null); setLinkFor(id); }}><Icon name="chat" className="h-5 w-5" />ลิงก์ญาติ</button>
          </div>
        </div>}
      </Modal>

      <Modal open={modal === "viewtask"} title="ผลการปฏิบัติงาน" onClose={close} footer={<button className="btn-soft w-full" onClick={close}>ปิดหน้าต่าง</button>}>
        {t?.rid && photos[t.rid] && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photos[t.rid]} alt={`รูปหลักฐาน ${t.title}`} className="mb-4 w-full rounded-2xl" />
        )}
        {t && <dl className="space-y-3 text-sm">{[["ผู้รับบริการ", t.who], ["ชื่องาน", t.title], ["คำสั่งงาน", t.ins], ["ผู้ปฏิบัติงาน", t.by ?? user.name], ["เวลาที่ส่งจริง", t.done ?? "-"], ["บันทึกย่อ", t.note || "-"], ["สถานะ", t.status === "ตรวจแล้ว" ? `ตรวจแล้ว${review?.by ? ` โดย ${review.by}` : ""}` : "รอผู้จัดการหรือหัวหน้าพยาบาลตรวจ"], ...(review?.stars ? [["ดาวจากผู้ตรวจ", `${"★".repeat(review.stars)}${"☆".repeat(Math.max(0, 5 - review.stars))} (${review.stars}/5)`]] : []), ...(review?.note ? [["ความเห็นผู้ตรวจ", review.note]] : [])].map(([k, v]) => <div key={k}><dt className="text-xs text-gold-500">{k}</dt><dd className="font-medium">{v}</dd></div>)}</dl>}
      </Modal>

      {/* ผลงานพิเศษ */}
      <Modal open={modal === "facility"} title={facPick ? `ส่งงานส่วนกลาง · ${facPick.name}` : "ส่งงานส่วนกลาง"} onClose={() => { close(); setFacPick(null); }}
        footer={<button className="btn-primary w-full" disabled={facBusy} onClick={saveFac}>{facBusy ? "กำลังส่ง…" : "ยืนยันส่งงาน"}</button>}>
        {facPick && <div className="space-y-4">
          <p className="rounded-xl bg-cream-50 px-4 py-3 text-sm text-gold-700">{[facPick.category, facPick.schedule].filter(Boolean).join(" · ")} · <b>{facPick.schedule.includes("ทุกเดือน") ? "ส่งได้เดือนละ 1 ครั้งต่อสาขา" : facPick.schedule.includes("ทุกสัปดาห์") ? "ส่งได้สัปดาห์ละ 1 ครั้งต่อสาขา (จันทร์–อาทิตย์)" : "ส่งได้วันละ 1 ครั้งต่อสาขา"} {facPick.manual ? "งานนี้มอบหมายให้คุณรับผิดชอบ" : "ใครทำก่อนเป็นคนส่ง"}</b> · นับเป็นผลงานของคุณใน KPI</p>
          <div><p className="label">ถ่ายภาพหลักฐาน (บังคับ)</p><PhotoInput label="กดเพื่อถ่ายภาพ" file={photo} onFile={setPhoto} /></div>
          <Field label="หมายเหตุ (ถ้ามี)"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ถังดับเพลิงหมดอายุ 1 ถัง แจ้งผู้จัดการแล้ว" /></Field>
        </div>}
      </Modal>

      <Modal open={modal === "bonus"} title="เพิ่มผลงานพิเศษ" onClose={close}
        footer={<button className="btn-primary w-full" onClick={() => {
          if (!bonusWho) return toast("กรุณาเลือกผู้รับบริการ");
          if (!bonusText.trim()) return toast("กรุณากรอกรายละเอียดงาน");
          if (!photo) return toast("กรุณาถ่ายภาพผลงาน");
          const body = JSON.stringify({ op: "bonus", title: `${bonusText.trim()} · ${bonusWho}`, photo });
          close();
          fetch("/api/ops", { method: "POST", headers: { "Content-Type": "application/json" }, body }).then(async (r) => {
            const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error);
            toast(`ส่งงานพิเศษแล้ว · ${bonusText.trim()} · ${bonusWho}`); loadFeed();
          }).catch((e) => toast((e as Error).message || "ส่งงานพิเศษไม่สำเร็จ กรุณาลองใหม่"));
        }}>ยืนยันส่งงานพิเศษ</button>}>
        <div className="space-y-4">
          <Field label="ผู้รับบริการ (Resident)"><ResidentPicker names={RESIDENTS.map((r) => r.name)} value={bonusWho} onChange={setBonusWho} /></Field>
          <Field label="รายละเอียดงาน"><input value={bonusText} onChange={(e) => setBonusText(e.target.value)} placeholder="เช่น เช็ดน้ำหก, ถ่ายภาพรอยยิ้ม" /></Field>
          <div><p className="label">ถ่ายภาพผลงาน (บังคับ)</p><PhotoInput label="กดเพื่อถ่ายภาพ" file={photo} onFile={setPhoto} /></div>
          <p className="rounded-2xl bg-cream-50 p-3 text-xs leading-6 text-gold-600">แชร์ส่งให้ญาติทาง LINE พร้อมแนบลิงก์แอป Family (ส่งเสร็จจะมีปุ่มให้กดแชร์)</p>
        </div>
      </Modal>

      {/* จ่ายยา */}
      <Modal open={modal === "dispense"} title="ยืนยันการจ่ายยา" onClose={close}
        footer={<><button className="btn-soft" onClick={close}>ยกเลิก</button><button className="btn-primary" onClick={() => {
          if (!photo) return toast("กรุณาถ่ายรูปยืนยันการให้ยาก่อน (แตะช่องกล้องด้านบน)");
          // ตรวจกับข้อมูลล่าสุดในเครื่องก่อน · server ตรวจซ้ำอีกชั้น (ซองที่ให้แล้ว / QA ยังไม่ผ่าน = ปฏิเสธ แจ้งเหตุผลผ่าน event)
          if (!md) { close(); return toast("ไม่พบซองยานี้แล้ว · กรุณาเปิดรายการใหม่"); }
          if (md.given) { close(); return toast(`ซองนี้ให้ยาไปแล้วโดย ${md.gby ?? "-"}${md.gat ? ` เมื่อ ${md.gat}` : ""}`); }
          if (md.qa !== "ตรวจผ่าน") { close(); return toast("ซองนี้ยังไม่ผ่านการตรวจ QA ของห้องยา · ยังให้ยาไม่ได้"); }
          // ส่งเฉพาะซองนี้ (useRecords บันทึกเฉพาะรายการที่เปลี่ยน) · server ใช้ข้อมูลซองบน server ใส่แค่ผู้ให้ยาและเวลา
          setPacks(packs.map((m) => (m.id === md.id ? { ...m, given: true, gby: user.name, gat: nowTh() } : m))); close(); toast(`ให้ยาแล้ว · ${md.who} มื้อ${md.meal} · ห้องยาเห็นสถานะนี้ทันที`);
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

      {/* วิธีติดตั้ง KinApp บน iPhone (เปิดจากแถบติดตั้งบนหน้างานวันนี้) */}
      <Modal open={iosHelp} title="ติดตั้ง KinApp บน iPhone" onClose={() => setIosHelp(false)} footer={<button type="button" className="btn-primary w-full" onClick={() => setIosHelp(false)}>เข้าใจแล้ว</button>}>
        <ol className="ka-ios-steps"><li>กดปุ่มแชร์ของ Safari (สี่เหลี่ยมมีลูกศรขึ้น)</li><li>เลือก "เพิ่มไปยังหน้าจอโฮม"</li><li>เปิด KinApp จากไอคอนบนหน้าจอโฮม แล้วกดเปิดการแจ้งเตือน</li></ol>
      </Modal>

      {/* สมุดส่งเวร */}
      <Modal open={modal === "handover"} title="สมุดส่งเวร" onClose={close} footer={<button className="btn-primary w-full" onClick={() => { setHoWho(""); setHoText(""); setModal("write"); }}><Icon name="plus" className="h-4 w-4" /> เขียนส่งเวรใหม่</button>}>
        <p className="mb-3 text-sm font-medium text-gold-700">เรื่องที่ต้องตามต่อ</p>
        {handover.length === 0 ? <Empty t="ไม่มีเรื่องค้าง" /> : (
          <ul className="space-y-3">{handover.map((h, i) => (
            <li key={i} className="rounded-2xl border border-cream-300/70 p-4 text-sm">
              <div className="flex items-center justify-between gap-2"><span className="rounded-full bg-gold-100 px-2.5 py-0.5 text-xs font-medium text-gold-700">{h.type}</span><span className="text-xs text-gold-500">{h.at}</span></div>
              <p className="mt-2 font-medium">{h.who}</p><p className="mt-0.5 text-gold-700">{h.text}</p>
              <div className="mt-3 flex items-center justify-between"><span className="text-xs text-gold-500">โดย {h.by}</span><button className="btn-soft !px-3 !py-1.5 text-xs" onClick={() => { setHandover(handover.filter((_, j) => j !== i)); toast(`รับทราบส่งเวรแล้ว · ${h.who || h.type}`); }}>รับทราบ</button></div>
            </li>
          ))}</ul>
        )}
      </Modal>

      <Modal open={modal === "write"} title="บันทึกส่งเวร" onClose={() => setModal("handover")}
        footer={<button className="btn-primary w-full" onClick={() => {
          if (!hoWho || !hoText.trim()) return toast("กรุณาเลือกผู้ป่วยและกรอกรายละเอียด");
          setHandover([{ id: Date.now(), type: hoType, who: hoWho, text: hoText, by: user.name, at: nowTh() }, ...handover]); setModal("handover"); toast(`บันทึกส่งเวรแล้ว · ${hoType}${hoWho ? ` · ${hoWho}` : ""}`);
        }}>บันทึกส่งเวร</button>}>
        <div className="space-y-4">
          <Field label="1. ระบุผู้ป่วย"><ResidentPicker names={RESIDENTS.map((r) => r.name)} value={hoWho} onChange={setHoWho} /></Field>
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
