"use client";
import { useEffect, useMemo, useState, createContext, useContext } from "react";
import CsvIcon from "@/components/CsvIcon";
import Image from "next/image";
import Link from "next/link";
import Icon from "@/components/Icon";
import { DataTable, Field, Modal, PageHeader, PrintLetterhead, Section, Select, StatFilter, StatusBadge, Tabs, ThaiDateInput } from "@/components/ui";
import { AppProvider, useApp } from "@/lib/app";
import { downloadCsv, refreshData, useCrud, useRecords } from "@/lib/store";
import { OfflineBar } from "@/components/Pwa";
import PhotoPicker from "@/components/PhotoPicker";
import TutorialVideos from "@/components/TutorialVideos";
import CashierOnly from "@/components/CashierOnly";
import CentralStock from "@/components/pharmacy/CentralStock";
import { RangePicker } from "@/components/PeriodPicker";
import { DayTimeline, WithdrawBox } from "@/components/pharmacy/Withdraw";
import MedRound from "@/components/pharmacy/MedRound";
import { DaySlot, slotOf } from "@/components/pharmacy/GiveMeds";
import { ResidentPicker } from "@/components/SearchSelect";
import SupplyStock from "@/components/pharmacy/SupplyStock";
import RxOverview from "@/components/pharmacy/RxOverview";
import { MedPhotoModal, PhotoItem, saveMedPhoto } from "@/components/pharmacy/MedPhotos";
import { stockAlertText, useStockAlerts } from "@/lib/stockAlerts";
import { can } from "@/lib/perms";
import { useResidents } from "@/lib/care";
import Login from "@/components/Login";
import AppSwitcher from "@/components/AppSwitcher";
import { useSession, SessionUser } from "@/lib/session";

import { nowTh, Drug, Pack, Page, MEALS, DAYS, FORMS, STORES, TIMINGS, AUDIT_STATUS, ERR_5R, WARN_SUGGEST, RESIDENTS as RESIDENTS0, d, DRUGS0, MASTER0, iso, thai, dayOf, drugsFor, isLiquid, isUseDrug, stockText, sumByUnit, daysLeft } from "@/lib/pharmacy";

const NAV: { id: Page; label: string; icon: string; group: number }[] = [
  { id: "dashboard", label: "ภาพรวม", icon: "grid", group: 0 },
  { id: "withdraw", label: "เบิกยา", icon: "pill", group: 0 },
  { id: "central", label: "คลังยากลาง (ยาของศูนย์)", icon: "building", group: 1 },
  { id: "supplies", label: "คลังเวชภัณฑ์", icon: "files", group: 1 },
  { id: "inventory", label: "ยาของผู้ป่วย", icon: "download", group: 1 },
  { id: "audit", label: "นับยาคงเหลือ", icon: "refresh", group: 1 },
  { id: "templates", label: "ยาแต่ละมื้อของผู้ป่วย", icon: "files", group: 1 },
  { id: "master", label: "รายชื่อยา", icon: "book", group: 1 },
  { id: "report", label: "ซองยาระบบเดิม", icon: "table", group: 2 },
  { id: "manual", label: "วิธีใช้งาน", icon: "doc", group: 2 },
];
const GROUPS = [{ id: 0, label: "งานวันนี้", en: "DAILY" }, { id: 1, label: "คลังยา", en: "STOCK" }, { id: 2, label: "รายงาน", en: "REPORT" }];

/* ---------- ช่องถ่ายรูป ---------- */
/** รายชื่อผู้รับบริการจริงของสาขา (จากฐานข้อมูล) ส่งให้ทุกหน้าในแอป · ยังโหลดไม่ได้ใช้รายชื่อตัวอย่าง */
const NamesCtx = createContext<string[]>(RESIDENTS0);
const useNames = () => useContext(NamesCtx);

/** ช่องแนบรูป: เปิดกล้อง หรือเลือกรูปจากไฟล์ */
function Photo({ value, onChange, label = "แนบรูปภาพ", invalid = false }: { value: string; onChange: (u: string) => void; label?: string; invalid?: boolean }) {
  return <PhotoPicker value={value} onChange={onChange} label={label} invalid={invalid} />;
}
const Chip = ({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) => (
  <button type="button" onClick={onClick} aria-pressed={on} className={`rounded-xl border px-3.5 py-2 text-sm transition ${on ? "border-gold-600 bg-gold-100 font-medium text-gold-800" : "border-cream-300 bg-white text-gold-600"}`}>{children}</button>
);

/* ---------- แอป ---------- */
function App({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const { residents: live } = useResidents();
  const RESIDENTS = live.length ? live.map((r) => r.full_name) : RESIDENTS0;
  const [page, setPage] = useState<Page>("dashboard");
  const [drawer, setDrawer] = useState(false);
  const [drugs, setDrugs] = useRecords("pharmacy-drugs", DRUGS0);
  const { rows: master, set: setMaster } = useCrud("pharmacy-master", MASTER0);
  const [packs, setPacks] = useRecords<Pack>("pharmacy-packs", []);
  const today = iso();
  // กด "เพิ่มยาให้ผู้ป่วยคนนี้" จากหน้าจัดยา → เปิดฟอร์มรับยาพร้อมชื่อผู้ป่วย
  const [addFor, setAddFor] = useState<string | null>(null);
  /** ตัวกรองหน้ายาของผู้ป่วย: "" ทั้งหมด · low ใกล้หมด · hold งดยาชั่วคราว (คงไว้เมื่อสลับหน้า) */
  const [invView, setInvView] = useState("");
  // ตรวจ QA เจอซองจัดผิด → รีเซตแล้วเปิดหน้าจัดยาของผู้ป่วยและวันนั้นให้เลย
  const [focus, setFocus] = useState<{ who: string; date: string } | null>(null);
  /** ผู้ป่วยที่เลือกในจัดยาตามมื้อ / เบิกยาตามใช้ (สลับเมนูแล้วยังเป็นคนเดิม) */
  const [medWho, setMedWho] = useState("");

  // เปิดหน้าตาม ?page= เช่น /pharmacy?page=dispense
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("page") as Page | null;
    // จัดยาตามมื้อ / ตรวจซองยา เลิกใช้แล้ว (ให้ยาที่เบิกยา) · ลิงก์เดิมพามาหน้าเบิกยา
    const p = raw === "dispense" || raw === "qa" ? "withdraw" : raw;
    if (p && NAV.some((n) => n.id === p)) setPage(p);
  }, []);
  const go = (p: Page) => {
    setPage(p); setDrawer(false); window.scrollTo(0, 0);
    window.history.replaceState(null, "", `/pharmacy?page=${p}`);
  };

  const todayNeed = RESIDENTS.flatMap((w) => MEALS.filter((m) => drugsFor(drugs, w, m, today).length).map((m) => ({ w, m })));
  const packedToday = todayNeed.filter(({ w, m }) => packs.some((p) => p.date === today && p.who === w && p.meal === m)).length;
  const low = drugs.filter(isLowDrug);
  const waitQa = packs.filter((p) => p.qa === "รอตรวจ").length;
  const current = NAV.find((n) => n.id === page)!;

  const sidebar = (
    <div className="sidebar-inner">
      <Link href="/pharmacy" className="sidebar-brand"><Image src="/logo-mark.png" alt="KIN" width={43} height={34} /><div><span className="sidebar-wordmark">KIN<span>med</span></span><span className="sidebar-brand-caption">ห้องยา · ให้ยาและคลังยา</span></div></Link>
      <div className="workspace-identity"><span className="workspace-monogram">ห</span><div><strong>{user.name}</strong><span>ห้องยา · {user.branch}</span></div><span className="workspace-live" /></div>
      <nav className="sidebar-nav" aria-label="เมนูห้องยา">
        {GROUPS.map((g) => (
          <div key={g.id} className="nav-group">
            <p className="nav-group-title">{g.label}<span>{g.en}</span></p>
            {NAV.filter((n) => n.group === g.id).map((n) => (
              <button key={n.id} className={`nav-item ${page === n.id ? "is-active" : ""}`} aria-current={page === n.id ? "page" : undefined} onClick={() => go(n.id)}>
                <Icon name={n.icon} /><span>{n.label}</span>
                {n.id === "qa" && waitQa > 0 ? <span className="ml-auto rounded-full bg-gold-700 px-2 text-[11px] text-white">{waitQa}</span> : page === n.id && <span className="active-dot" />}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar-bottom space-y-1">
        <Link href="/staff" className="nav-item"><Icon name="phone" /><span>กลับ KinApp</span></Link>
        <button className="nav-item nav-logout" onClick={onLogout}><Icon name="logout" /><span>ออกจากระบบ</span></button>
      </div>
    </div>
  );

  return (
    <NamesCtx.Provider value={RESIDENTS}>
    <div className="app-shell">
      <aside className="desktop-sidebar">{sidebar}</aside>
      {drawer && <div className="mobile-drawer"><button className="drawer-scrim" aria-label="ปิดเมนู" onClick={() => setDrawer(false)} /><aside><button className="drawer-close icon-button" aria-label="ปิดเมนู" onClick={() => setDrawer(false)}><Icon name="close" /></button>{sidebar}</aside></div>}
      <div className="app-body">
        <header className="topbar">
          <div className="flex min-w-0 items-center gap-3">
            <button className="icon-button lg:hidden" onClick={() => setDrawer(true)} aria-label="เปิดเมนู"><Icon name="menu" /></button>
            <span className="topbar-section">ห้องยา</span><span className="topbar-slash">/</span><span className="topbar-current">{current.label}</span>
          </div>
          <div className="flex items-center gap-3">
            {page !== "withdraw" && <button className="btn-primary !min-h-[40px] !px-4 !py-2 text-sm" onClick={() => go("withdraw")}><Icon name="pill" className="h-4 w-4" /> เบิกยา</button>}
            <AppSwitcher user={user} current="pharmacy" />
          </div>
        </header>
        <OfflineBar />
        <main className="workspace-main" key={page}>
          <PrintLetterhead title="ระบบบริหารจัดการยา" className="page-letterhead" />
          {page === "dashboard" && <Dashboard go={go} low={low} onLow={() => { setInvView("low"); go("inventory"); }} onPerson={(w) => { setMedWho(w); go("withdraw"); }} />}
          {(page === "dispense" || page === "withdraw") && <Dispense mode="use" who={medWho} setWho={setMedWho}
            drugs={drugs} setDrugs={setDrugs} packs={packs} setPacks={setPacks} go={go} me={user.name} focus={focus} onAddDrug={(w) => { setAddFor(w); go("inventory"); }}
            canVoidAll={["Global Admin", "Branch Admin", "Head Nurse"].includes(user.role)} />}
          {page === "qa" && <QA packs={packs} setPacks={setPacks} drugs={drugs} setDrugs={setDrugs} me={user.name} go={go} onRedo={(who, date) => { setFocus({ who, date }); go("dispense"); }} />}
          {page === "inventory" && <Inventory drugs={drugs} setDrugs={setDrugs} master={master} addFor={addFor} onAdded={() => setAddFor(null)} lowView={invView} onLowView={setInvView} />}
          {page === "central" && <CentralStock />}
          {page === "supplies" && <SupplyStock />}
          {page === "audit" && <Audit drugs={drugs} setDrugs={setDrugs} />}
          {page === "templates" && <Templates drugs={drugs} setDrugs={setDrugs} />}
          {page === "master" && <Master master={master} setMaster={setMaster} drugs={drugs} />}
          {page === "report" && <Report packs={packs} />}
          {page === "manual" && <Manual />}
        </main>
        <footer className="workspace-footer"><span>KIN MEDCARE</span><span>ให้ยาตามหลัก 5R เพื่อความปลอดภัยของผู้ป่วย</span></footer>
      </div>
    </div>
    </NamesCtx.Provider>
  );
}

/* ---------- ภาพรวมห้องยา ---------- */
/** ภาพรวม: กราฟการให้ยาตามช่วงวันที่ (RxOverview) · ปุ่มลัด เติมยา/นับยา · แจ้งเตือนคลังกลาง · ยาใกล้หมด */
function Dashboard({ go, low, onLow, onPerson }: { go: (p: Page) => void; low: Drug[]; onLow: () => void; onPerson: (name: string) => void }) {
  const { items: stock } = useStockAlerts();
  return (
    <>
      <PageHeader title="ภาพรวมห้องยา" sub="การให้ยาตามมื้อ ไม่ได้ให้ยา และเบิกตามอาการ · เลือกดูวันนี้ รายสัปดาห์ รายเดือน หรือเลือกช่วงจากปฏิทิน" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button className="btn-soft" onClick={onLow}><Icon name="alert" className="h-4 w-4" /> เติมยาใกล้หมด{low.length ? ` ${low.length}` : ""}</button>
        <button className="btn-soft" onClick={() => go("audit")}><Icon name="check" className="h-4 w-4" /> นับยาคงเหลือ</button>
        <button className="btn-soft" onClick={() => go("inventory")}><Icon name="download" className="h-4 w-4" /> เพิ่มยาใหม่ของผู้ป่วย</button>
        <button className="step-link ml-auto !mt-0" onClick={() => go("manual")}>วิธีใช้งาน<Icon name="arrow" className="h-3.5 w-3.5" /></button>
      </div>
      {stock.length > 0 && (
        <button type="button" onClick={() => go("central")} className="card mb-4 flex w-full flex-wrap items-center gap-4 border-amber-200 bg-amber-50/70 p-5 text-left transition hover:border-amber-300">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-800"><Icon name="alert" className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1">
            <b className="block text-gold-900">คลังยากลาง: ใกล้หมด {stock.filter((x) => x.low).length} รายการ · ใกล้หมดอายุ {stock.filter((x) => x.days !== null && x.days <= 60).length} รายการ</b>
            <span className="block truncate text-sm text-gold-600">{stock.slice(0, 3).map((x) => `${x.name} (${stockAlertText(x)})`).join(" · ")}{stock.length > 3 ? ` · และอีก ${stock.length - 3} รายการ` : ""}</span>
          </span>
          <span className="step-link">ไปที่คลังยากลาง<Icon name="arrow" className="h-3.5 w-3.5" /></span>
        </button>
      )}
      <RxOverview onPerson={onPerson} />
      {low.length > 0 && (
        <div className="mt-6"><Section title="ยาใกล้หมด" sub="เหลือใช้ไม่ถึง 2 วัน · ยาที่ญาตินำมา แจ้งญาติให้นำมาเพิ่ม · ยาของศูนย์ เติมจากคลังยากลาง">
          <DataTable search={low.length > 10} columns={["ผู้ป่วย", "ชื่อยา", "คงเหลือ", "สถานะ"]} rows={low.map((x) => [x.who, x.name, `${x.stock} ${x.unit}`, x.stock === 0 ? "ยาหมด" : "รอเติมยา"])} />
        </Section></div>
      )}
    </>
  );
}

/* ---------- จัดยาตามมื้อ: ทีละมื้อ (ทั้งสาขา) / ทีละคน ---------- */
type PackState = "wait" | "qa" | "pass" | "bad" | "given";
const PACK_TH: Record<PackState, string> = { wait: "ยังไม่จัด", qa: "จัดแล้ว · รอตรวจ", pass: "ตรวจแล้ว · รอให้ยา", bad: "QA แจ้งว่าจัดผิด", given: "ให้ยาแล้ว" };
const PACK_TONE: Record<PackState, string> = { wait: "bg-amber-50 text-amber-800 ring-1 ring-amber-200", qa: "bg-sky-50 text-sky-800", pass: "bg-violet-50 text-violet-800", bad: "bg-red-50 text-red-700", given: "bg-emerald-50 text-emerald-800" };
const mealByClock = () => { const h = new Date().getHours(); return h < 10 ? MEALS[0] : h < 14 ? MEALS[1] : h < 19 ? MEALS[2] : MEALS[3]; };

/**
 * จัดยาตามมื้อ: เริ่มจากมื้อ (ห้องยาจัดซองเช้าให้ทุกคนรวดเดียว) · แถบมื้อบอกความคืบหน้าทั้งสาขา
 *  แถวละ 1 คน เรียงตามห้อง · กด "จัด" แล้วติ๊กยา + ถ่ายรูป + บันทึกในแถว · บันทึกแล้วกางแถวถัดไปให้เอง
 *  มุมมองทีละคน = ตาราง คน × 4 มื้อ แตะช่องรอจัดไปจัดมื้อนั้น
 */
function MealBoard({ drugs, setDrugs, packs, setPacks, go, me, focus, allergy, onAddDrug }: { drugs: Drug[]; setDrugs: (x: Drug[]) => void; packs: Pack[]; setPacks: (x: Pack[]) => void; go: (p: Page) => void; me: string; focus: { who: string; date: string } | null; allergy: Record<string, string>; onAddDrug: (who: string) => void }) {
  const RESIDENTS = useNames();
  const { residents: live } = useResidents();
  const { toast, confirm } = useApp();
  const [date, setDate] = useState(focus?.date ?? iso());
  const [view, setView] = useState<"meal" | "person">("meal");
  const [meal, setMeal] = useState(mealByClock);
  const [filt, setFilt] = useState<"wait" | "all">("wait");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<string | null>(null); // `${ผู้ป่วย}|${มื้อ}`
  const [ticks, setTicks] = useState<number[]>([]);
  const [photo, setPhoto] = useState("");
  const [err, setErr] = useState("");
  const [sum, setSum] = useState(false);
  // คนที่เบิกยานอกรอบไปแล้ววันนั้น (เมนูเบิกยาตามใช้) · เตือนในการ์ดก่อนจัดซอง กันให้ยาซ้ำ
  const [wdDay, setWdDay] = useState<Record<string, { n: number; last: string }>>({});
  useEffect(() => {
    fetch(`/api/pharmstock?op=withdrawals_day&date=${date}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items: { name: string; n: number; last: string }[] }) => setWdDay(Object.fromEntries((d.items ?? []).map((x) => [x.name, { n: x.n, last: x.last }])))).catch(() => {});
  }, [date]);
  const roomOf = (w: string) => { const r = live.find((x) => x.full_name === w)?.room ?? ""; return r && r !== "-" ? r : ""; };
  const packOf = (w: string, m: string, d = date) => packs.find((p) => p.date === d && p.who === w && p.meal === m);
  const stateOf = (w: string, m: string): PackState => { const p = packOf(w, m); if (!p) return "wait"; if (p.given) return "given"; return p.qa === "ตรวจผ่าน" ? "pass" : p.qa === "แจ้งจัดยาผิด" ? "bad" : "qa"; };
  const listOf = (w: string, m: string, d = date) => drugsFor(drugs, w, m, d);
  const slots = (m: string) => RESIDENTS.filter((w) => listOf(w, m).length || packOf(w, m));
  const byRoom = (a: string, b: string) => (roomOf(a) || "~").localeCompare(roomOf(b) || "~") || a.localeCompare(b, "th");
  const match = (w: string) => !q.trim() || `${w} ${roomOf(w)}`.toLowerCase().includes(q.trim().toLowerCase());
  const openSlot = (w: string, m: string) => { setOpen(`${w}|${m}`); setTicks([]); setPhoto(""); setErr(""); };
  // จาก QA "รีเซตซองนี้แล้วจัดใหม่" → เปิดมื้อที่ต้องจัดของคนนั้น
  useEffect(() => {
    if (!focus) return;
    setDate(focus.date); setView("meal"); setFilt("wait");
    const m = MEALS.find((x) => listOf(focus.who, x, focus.date).length && !packOf(focus.who, x, focus.date));
    if (m) { setMeal(m); openSlot(focus.who, m); }
  }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps

  const [ow, om] = open ? open.split("|") : ["", ""];
  const save = () => {
    if (!open) return;
    const list = listOf(ow, om);
    if (ticks.length < list.length) return setErr(`ติ๊กยาให้ครบก่อนบันทึก (ติ๊กแล้ว ${ticks.length} จาก ${list.length})`);
    if (!photo) return setErr("ยังไม่ได้ถ่ายรูปซอง · ถ่ายรูปก่อนบันทึก");
    const items = list.map((x) => (x.stock >= x.dose ? (isLiquid(x) ? `${x.name} ${x.dose} ml` : `${x.name} × ${x.dose} ${x.unit}`) : `${x.name} (ยาหมด/รอเติม)`));
    setDrugs(drugs.map((x) => (list.some((y) => y.id === x.id) ? { ...x, stock: Math.max(0, x.stock - x.dose) } : x)));
    const id = Date.now();
    setPacks([{ id, date, who: ow, meal: om, items, qa: "รอตรวจ", given: false, by: me }, ...packs]);
    saveMedPhoto("pack", id, photo, toast);
    toast(`จัดซองมื้อ${om}แล้ว · ${ow} · รอตรวจ QA`);
    const next = slots(om).filter((w) => w !== ow && stateOf(w, om) === "wait" && match(w)).sort(byRoom)[0];
    if (next) openSlot(next, om); else setOpen(null);
  };
  const reset = (w: string, m: string) => {
    const p = packOf(w, m); if (!p || p.given) return;
    confirm({ title: "รีเซตซองยา", danger: true, okLabel: "รีเซต", message: `ล้างซองมื้อ${m}ของ ${w} และคืนคงเหลือยา ใช่หรือไม่${p.qa === "ตรวจผ่าน" ? " (ซองนี้ตรวจ QA ผ่านแล้วและอยู่ในคิวจ่ายยาของ KinApp)" : ""}`, onOk: () => {
      const list = listOf(w, m);
      setDrugs(drugs.map((y) => (list.some((z) => z.id === y.id) ? { ...y, stock: y.stock + y.dose } : y)));
      setPacks(packs.filter((x) => x.id !== p.id)); toast(`รีเซตแล้ว · ${w} มื้อ${m} · จัดใหม่ได้`);
    } });
  };

  const mealSlots = slots(meal).filter(match).sort(byRoom);
  const waitN = mealSlots.filter((w) => stateOf(w, meal) === "wait").length;
  const shown = mealSlots.filter((w) => filt === "all" || stateOf(w, meal) === "wait" || `${w}|${meal}` === open);
  const people = RESIDENTS.filter((w) => MEALS.some((m) => listOf(w, m).length || packOf(w, m))).filter(match).sort(byRoom);

  return (
    <>
      <PageHeader title="จัดยาตามมื้อ" sub="สำหรับยาที่กินตามมื้อ · เลือกมื้อ แล้วจัดซองให้ทีละคน › ให้อีกคนตรวจซอง (QA) › พนักงานให้ยาใน KinApp"
        actions={<><button className="btn-soft" onClick={() => onAddDrug(ow)}><Icon name="plus" className="h-4 w-4" /> เพิ่มยา</button>{view === "meal" && <button className="btn-soft" onClick={() => setSum(true)}><Icon name="files" className="h-4 w-4" /> รายการยาที่ต้องหยิบ</button>}</>} />

      <div className="mb-3 grid gap-2 sm:grid-cols-[180px_minmax(0,1fr)_auto] sm:items-center">
        <ThaiDateInput label="วันกินยา" value={date} onChange={(v) => { if (v) { setDate(v); setOpen(null); } }} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ค้นหาชื่อหรือเลขห้อง" aria-label="ค้นหาผู้ป่วย" />
        <div className="inline-flex justify-self-start rounded-xl border border-cream-300 bg-white p-0.5 text-sm" role="group" aria-label="มุมมอง">
          {([["meal", "ดูทีละมื้อ"], ["person", "ดูทีละคน"]] as const).map(([k, t]) => <button key={k} type="button" aria-pressed={view === k} onClick={() => { setView(k); setOpen(null); }}
            className={`rounded-lg px-3.5 py-1.5 ${view === k ? "bg-gold-700 font-medium text-white" : "text-gold-600"}`}>{t}</button>)}
        </div>
      </div>

      {/* แถบมื้อ: ตัวเลขใหญ่ = ซองที่ยังไม่จัด · แถบสี = ความคืบหน้าทั้งสาขา */}
      <div className="mb-5 grid grid-cols-2 gap-2 lg:grid-cols-4" role="group" aria-label="เลือกมื้อ">
        {MEALS.map((m) => {
          const ss = slots(m).map((w) => stateOf(w, m)), n = ss.length || 1, c = (k: PackState) => ss.filter((s) => s === k).length;
          const on = view === "meal" && meal === m, wait = c("wait");
          return (
            <button key={m} type="button" aria-pressed={on} onClick={() => { setMeal(m); setView("meal"); setOpen(null); }}
              className={`grid gap-1.5 rounded-2xl border p-3 text-left transition ${on ? "border-gold-600 bg-gold-100/60 shadow-[inset_0_0_0_1.5px] shadow-gold-600" : "border-cream-300 bg-white hover:border-gold-300"} ${ss.length ? "" : "opacity-60"}`}>
              <span className="flex items-baseline justify-between gap-2"><b className="text-[15px] text-gold-900">มื้อ{m}</b>{ss.length > 0 && <small className="tabular-nums text-xs text-gold-500">{ss.length - wait}/{ss.length}</small>}</span>
              <span className={`text-sm font-semibold ${!ss.length ? "font-normal text-gold-500" : wait ? "text-amber-800" : "text-emerald-700"}`}>{!ss.length ? "ไม่มียามื้อนี้" : wait ? `${wait} ซองยังไม่จัด` : "✓ จัดครบแล้ว"}</span>
              <span className="flex h-1.5 overflow-hidden rounded-full bg-cream-300">
                <i className="block h-full bg-emerald-600" style={{ width: `${(c("given") / n) * 100}%` }} />
                <i className="block h-full bg-violet-500" style={{ width: `${(c("pass") / n) * 100}%` }} />
                <i className="block h-full bg-sky-500" style={{ width: `${((c("qa") + c("bad")) / n) * 100}%` }} />
              </span>
              <small className="truncate text-[11.5px] text-gold-500">{[c("qa") + c("bad") ? `รอตรวจ ${c("qa") + c("bad")}` : "", c("pass") ? `รอให้ยา ${c("pass")}` : "", c("given") ? `ให้ยาแล้ว ${c("given")}` : ""].filter(Boolean).join(" · ") || (ss.length ? "ยังไม่มีซองที่จัด" : " ")}</small>
            </button>
          );
        })}
      </div>

      {view === "meal" ? <>
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-lg font-semibold text-gold-900">ซองยามื้อ{meal} <small className="text-sm font-normal text-gold-500">· {thai(date)}</small></h2>
          <div className="flex gap-1.5 text-sm" role="group" aria-label="กรองซอง">
            {([["wait", `ยังไม่จัด ${waitN}`], ["all", `ทุกซอง ${mealSlots.length}`]] as const).map(([k, t]) => <button key={k} type="button" aria-pressed={filt === k} onClick={() => setFilt(k)}
              className={`rounded-full border px-3 py-1 ${filt === k ? "border-gold-800 bg-gold-800 font-medium text-white" : "border-cream-300 bg-white text-gold-700"}`}>{t}</button>)}
          </div>
          <p className="w-full text-xs text-gold-500 sm:ml-auto sm:w-auto">วิธีจัด: กด <b>จัดซองนี้</b> › ติ๊กยาที่หยิบ › ถ่ายรูปซอง › บันทึก (ระบบเปิดคนถัดไปให้)</p>
        </div>
        {!shown.length ? (
          mealSlots.length ? <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><span>✓ จัดซองมื้อ{meal}ครบทุกคนแล้ว · ขั้นต่อไป ให้อีกคนตรวจซองยา (QA)</span><button className="btn-soft" onClick={() => go("qa")}>ไปตรวจซองยา ›</button></div>
            : <div className="card empty-state"><Icon name="pill" /><p>{q ? `ไม่พบ "${q}"` : `ไม่มีใครต้องกินยามื้อ${meal}ในวันนี้`}</p></div>
        ) : <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{shown.map((w) => {
          const s = stateOf(w, meal), p = packOf(w, meal), list = listOf(w, meal), isOpen = open === `${w}|${meal}`;
          const items: { name: string; dose: string; low: boolean }[] = p ? p.items.map((t) => ({ name: t, dose: "", low: t.includes("รอเติม") }))
            : list.map((x) => ({ name: x.name, dose: `${x.dose} ${x.unit}`, low: x.stock < x.dose }));
          return (
            <li key={w} className={`flex flex-col overflow-hidden rounded-2xl border bg-white ${isOpen ? "border-gold-600 shadow-soft sm:col-span-2 xl:col-span-3" : "border-cream-300"}`}>
              <div className="flex items-start gap-3 p-4 pb-3">
                <span className={`shrink-0 rounded-xl px-2.5 py-1 text-center tabular-nums ${roomOf(w) ? "bg-gold-100 text-base font-bold text-gold-800" : "bg-cream-100 text-xs text-gold-500"}`}>{roomOf(w) || "ไม่มีห้อง"}</span>
                <span className="min-w-0 flex-1"><b className="block truncate text-[15px] text-gold-900">{w}</b>
                  {allergy[w] && <span className="mt-0.5 inline-block rounded bg-red-50 px-1.5 text-[11.5px] font-semibold text-red-700">⚠ แพ้ยา: {allergy[w]}</span>}</span>
                {s !== "wait" && <span className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${PACK_TONE[s]}`}>{PACK_TH[s]}</span>}
              </div>
              {wdDay[w] && s === "wait" && <button type="button" onClick={() => go("withdraw")} className="mx-4 mb-2 rounded-lg bg-amber-100/70 px-3 py-1.5 text-left text-xs text-amber-900">
                ⚠ วันนี้เบิกยานอกรอบให้คนนี้แล้ว <b>{wdDay[w].n} ครั้ง</b> (ล่าสุด {wdDay[w].last} น.) · ตรวจว่าไม่ใช่มื้อเดียวกัน ก่อนจัดซอง ›</button>}
              <ul className={`mx-4 flex-1 divide-y divide-cream-200 rounded-xl bg-cream-50 px-3 ${isOpen ? "hidden" : ""}`}>
                {items.map((it, i) => (
                  <li key={it.name + i} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
                    <span className={`min-w-0 ${it.low ? "font-medium text-amber-800" : "text-gold-800"}`}>{it.name}{it.low && !p ? " · ยาเหลือไม่พอ" : ""}</span>
                    {it.dose && <b className="shrink-0 tabular-nums text-gold-900">{it.dose}</b>}
                  </li>
                ))}
              </ul>
              <div className="p-4 pt-3">
                {s === "wait" ? (isOpen ? <button type="button" className="btn-soft w-full !py-2" onClick={() => setOpen(null)}>ยกเลิก ไม่จัดตอนนี้</button>
                  : <button type="button" className="btn-primary w-full !py-2" onClick={() => openSlot(w, meal)}>จัดซองนี้</button>)
                  : s === "given" ? <p className="text-center text-xs text-emerald-800">ให้ยาแล้ว{p?.gby ? ` โดย ${p.gby}` : ""}{p?.gat ? ` · ${p.gat.slice(11, 16)} น.` : ""}</p>
                  : <div className="flex items-center justify-between gap-2"><small className="text-xs text-gold-500">จัดโดย {p?.by ?? "-"}{p?.qby ? ` · ตรวจโดย ${p.qby}` : ""}</small>
                    <button type="button" className="btn-soft !py-1.5 text-sm text-red-700" onClick={() => reset(w, meal)}>{s === "bad" ? "ล้างซองแล้วจัดใหม่" : "จัดผิด? ล้างซอง"}</button></div>}
              </div>
              {isOpen && (
                <div className="grid gap-4 border-t border-cream-200 bg-cream-50 p-4 md:grid-cols-[minmax(0,1fr)_300px]">
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-gold-600">ขั้นที่ 1 · ติ๊กยาที่หยิบใส่ซองแล้ว ({ticks.length}/{list.length})</p>
                    {list.map((x, i) => { const on = ticks.includes(i);
                      return (
                        <label key={x.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border p-3 transition ${on ? "border-emerald-300 bg-emerald-50" : "border-cream-300 bg-white"}`}>
                          <input type="checkbox" className="!h-5 !w-5 !min-h-0 accent-emerald-700" checked={on} onChange={() => { setTicks(on ? ticks.filter((y) => y !== i) : [...ticks, i]); setErr(""); }} />
                          <span className="min-w-0 flex-1"><b className="block text-sm font-medium text-gold-900">{x.name}</b>
                            <small className={`text-xs ${x.stock < x.dose ? "font-medium text-amber-800" : "text-gold-500"}`}>{x.stock < x.dose ? `เหลือ ${stockText(x)} · จัดเท่าที่มี ติดป้ายรอเติม` : `${x.how || ""}${x.how ? " · " : ""}คงเหลือ ${stockText(x)}`}</small>
                            {x.warn.length > 0 && <small className="block text-xs text-red-700">คำเตือน: {x.warn.join(" · ")}</small>}</span>
                          <b className="shrink-0 text-lg tabular-nums text-gold-700">{x.dose} {x.unit}</b>
                        </label>
                      ); })}
                  </div>
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-gold-600">ขั้นที่ 2 · ถ่ายรูปซองที่จัดเสร็จ ให้เห็นเม็ดยาคู่ฉลาก (บังคับ)</p>
                    <Photo value={photo} onChange={(u) => { setPhoto(u); setErr(""); }} label="ถ่ายรูปซองยา" invalid={err.includes("ถ่ายรูป")} />
                    {err && <p role="alert" className="form-error"><Icon name="alert" className="h-4 w-4 shrink-0" />{err}</p>}
                    <button type="button" className="btn-primary w-full" onClick={save}>ขั้นที่ 3 · บันทึก แล้วไปคนถัดไป</button>
                  </div>
                </div>
              )}
            </li>
          );
        })}</ul>}
      </> : (
        /* ทีละคน: ตาราง คน × 4 มื้อ */
        <div className="overflow-x-auto rounded-2xl border border-cream-300 bg-white">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="text-left text-xs text-gold-500"><th className="px-3 py-2">ห้อง</th><th className="px-3 py-2">ผู้ป่วย</th>{MEALS.map((m) => <th key={m} className="px-2 py-2 text-center">{m}</th>)}</tr></thead>
            <tbody>{people.map((w) => (
              <tr key={w} className="border-t border-cream-200">
                <td className="px-3 py-2 font-bold tabular-nums text-gold-700">{roomOf(w) || "-"}</td>
                <td className="px-3 py-2"><b className="font-medium text-gold-900">{w}</b>{allergy[w] && <span className="ml-1.5 rounded bg-red-50 px-1.5 text-[11px] font-semibold text-red-700">⚠ แพ้ยา</span>}</td>
                {MEALS.map((m) => {
                  const has = listOf(w, m).length || packOf(w, m);
                  if (!has) return <td key={m} className="px-2 py-2 text-center text-gold-300">-</td>;
                  const s = stateOf(w, m);
                  return <td key={m} className="px-2 py-2 text-center">
                    {s === "wait" ? <button type="button" onClick={() => { setMeal(m); setView("meal"); setFilt("wait"); openSlot(w, m); }} className={`w-full rounded-lg px-2 py-1 text-xs font-medium ${PACK_TONE[s]}`}>ยังไม่จัด · จัด ›</button>
                      : <span className={`inline-block w-full rounded-lg px-2 py-1 text-xs font-medium ${PACK_TONE[s]}`}>{PACK_TH[s].split(" ·")[0]}</span>}
                  </td>;
                })}
              </tr>
            ))}</tbody>
          </table>
          {!people.length && <p className="py-6 text-center text-sm text-gold-500">{q ? `ไม่พบ "${q}"` : "ยังไม่มีผู้ป่วยที่มียาตามมื้อ"}</p>}
        </div>
      )}

      <Modal open={sum} wide title={`รายการยาที่ต้องหยิบ · มื้อ${meal}`} onClose={() => setSum(false)} footer={<button className="btn-primary" onClick={() => setSum(false)}>ปิด</button>}>
        <p className="mb-4 text-sm text-gold-600">ยาของทุกซองที่ยังไม่จัดในมื้อ{meal} วันที่ {thai(date)} · หยิบยาตามรายการนี้มาไว้ก่อน แล้วค่อยจัดทีละซอง</p>
        <DataTable columns={["ห้อง", "ผู้ป่วย", "ชื่อยา", "จำนวน", "คงเหลือ"]} empty="ไม่มีซองที่ต้องจัด"
          rows={mealSlots.filter((w) => stateOf(w, meal) === "wait").flatMap((w) => listOf(w, meal).map((x) => [roomOf(w) || "-", w, x.name, `${x.dose} ${x.unit}`, stockText(x)]))} />
      </Modal>
    </>
  );
}

/* ---------- จัดยาตามมื้อ / เบิกยาตามใช้ ---------- */
/**
 * 2 เมนูแยกกัน ใช้รายชื่อผู้ป่วยแบบเดียวกัน (เลือกคนไว้แล้วสลับเมนูยังเป็นคนเดิม)
 *  mode "meal" = จัดยาตามมื้อ: ซองตามมื้อ (จัด › QA › ให้ยา) · mode "use" = เบิกยาตามใช้: ยาขวด ยาทา ตามอาการ (lib/pharmacy isUseDrug)
 *  ยาหนึ่งตัวอยู่เมนูเดียว ไม่ตัดคงเหลือซ้ำ · ไทม์ไลน์ของแต่ละเมนูแสดงเฉพาะงานของเมนูนั้น
 */
function Dispense({ mode, who, setWho, drugs, setDrugs, packs, setPacks, go, me, focus, onAddDrug, canVoidAll }: { mode: "meal" | "use"; who: string; setWho: (w: string) => void; drugs: Drug[]; setDrugs: (x: Drug[]) => void; packs: Pack[]; setPacks: (x: Pack[]) => void; go: (p: Page) => void; me: string; focus: { who: string; date: string } | null; onAddDrug: (who: string) => void; canVoidAll: boolean }) {
  const RESIDENTS = useNames();
  const { residents: live } = useResidents();
  const { toast, confirm } = useApp();
  const isMeal = mode === "meal";
  const [tlKey, setTlKey] = useState(0);
  const [pq, setPq] = useState("");
  /** มือถือ: กางรายชื่อผู้ป่วยหรือไม่ */
  const [pickOpen, setPickOpen] = useState(false);
  // แพ้ยา (จากสัญญา) ขึ้นแถบแดงบนหัวหน้า
  const [allergy, setAllergy] = useState<Record<string, string>>({});
  useEffect(() => {
    fetch("/api/care?op=allergies", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { items: [] })).then((d: { items: { name: string; drug: string | null }[] }) => {
      const m: Record<string, string> = {};
      for (const x of d.items ?? []) { const v = String(x.drug ?? "").trim(); if (v && v !== "-" && !/^(ไม่มี|ไม่แพ้|ปฏิเสธ)/.test(v)) m[x.name] = v; }
      setAllergy(m);
    }).catch(() => {});
  }, []);
  useEffect(() => { if (focus?.who) setWho(focus.who); }, [focus]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!RESIDENTS.includes(who)) setWho(RESIDENTS[0]); }, [RESIDENTS, who]); // eslint-disable-line react-hooks/exhaustive-deps
  const [date, setDate] = useState(focus?.date ?? iso());
  const [meal, setMeal] = useState<string | null>(null);
  const [photo, setPhoto] = useState("");
  const [checked, setChecked] = useState<number[]>([]);
  const [preview, setPreview] = useState(false);
  /** ข้อความเตือนสีแดงเหนือปุ่มบันทึก (หน้านี้ไม่ใช่ popup จึงไม่ใช้ toast) */
  const [saveErr, setSaveErr] = useState<"" | "check" | "photo">("");
  const meals = MEALS.map((m) => ({ m, list: drugsFor(drugs, who, m, date), pack: packs.find((p) => p.date === date && p.who === who && p.meal === m) })).filter((x) => x.list.length || x.pack);
  const sel = meals.find((x) => x.m === meal);
  const done = meals.filter((x) => x.pack).length;
  /** ความคืบหน้าของแต่ละคนในวันที่เลือก (รายชื่อซ้าย) */
  const progressOf = (w: string) => {
    const ms = MEALS.filter((m) => drugsFor(drugs, w, m, date).length || packs.some((p) => p.date === date && p.who === w && p.meal === m));
    return { all: ms.length, done: ms.filter((m) => packs.some((p) => p.date === date && p.who === w && p.meal === m)).length, use: drugs.filter((x) => x.who === w && isUseDrug(x)).length };
  };
  const roomOf = (w: string) => live.find((r) => r.full_name === w)?.room ?? "";
  /** รายชื่อ: ต้องจัด = ยังจัดซองไม่ครบ · มียา = มียาในตะกร้า · เรียง ต้องจัดก่อน แล้วตามห้อง · คนที่ยังไม่มียาอยู่ท้าย */
  const [pf, setPf] = useState<"todo" | "has" | "done" | "all">("has");
  // เบิกยาตามใช้: คนที่เบิกแล้วในวันที่เลือก (จำนวนครั้ง · เวลาล่าสุด)
  const [wdDay, setWdDay] = useState<Record<string, { n: number; last: string }>>({});
  // การให้ยาของวันที่เลือก: ยา × มื้อ ที่บันทึกแล้ว (ให้ หรือไม่ได้ให้) · ใช้นับ "ให้ยาตามมื้อแล้ว x/y" ในรายชื่อ
  const [daySlots, setDaySlots] = useState<DaySlot[]>([]);
  useEffect(() => {
    if (isMeal) return;
    fetch(`/api/pharmstock?op=withdrawals_day&date=${date}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : { items: [], slots: [] }))
      .then((d: { items: { name: string; n: number; last: string }[]; slots?: DaySlot[] }) => {
        setWdDay(Object.fromEntries((d.items ?? []).map((x) => [x.name, { n: x.n, last: x.last }]))); setDaySlots(d.slots ?? []);
      }).catch(() => {});
  }, [isMeal, date, tlKey]);
  /** ยาตามมื้อของวันที่เลือก: ต้องให้กี่ (ยา × มื้อ) · บันทึกแล้วกี่ */
  const doseProgress = (w: string) => {
    const pairs = MEALS.flatMap((m) => drugsFor(drugs, w, m, date).map((d) => ({ d, m })));
    return { all: pairs.length, done: pairs.filter(({ d, m }) => slotOf(daySlots, d.id, m).length).length };
  };
  // เบิกยา: มียา = มียาตัวใดก็ได้ · ยังให้ไม่ครบ = ยาตามมื้อของวันนี้ยังบันทึกไม่ครบ
  const people = RESIDENTS.map((w) => { const g = isMeal ? progressOf(w) : { ...progressOf(w), ...doseProgress(w) }; return { w, g, has: isMeal ? g.all > 0 : drugs.some((x) => x.who === w), wd: wdDay[w] }; });
  const pCount = { todo: people.filter((p) => p.g.all > p.g.done).length, has: people.filter((p) => p.has).length, done: people.filter((p) => p.wd).length, all: people.length };
  const peopleShown = people
    .filter((p) => (pf === "all" || (pf === "has" ? p.has : pf === "done" ? !!p.wd : p.g.all > p.g.done) || p.w === who) && (!pq.trim() || `${p.w} ${roomOf(p.w)}`.toLowerCase().includes(pq.trim().toLowerCase())))
    .sort((a, b) => Number(b.g.all > b.g.done) - Number(a.g.all > a.g.done) || Number(b.has) - Number(a.has) || roomOf(a.w).localeCompare(roomOf(b.w)) || a.w.localeCompare(b.w, "th"));
  const otherCount = isMeal ? progressOf(who).use : 0;

  const save = () => {
    if (!sel) return;
    if (checked.length < sel.list.length) return setSaveErr("check");
    if (!photo) return setSaveErr("photo");
    setSaveErr("");
    const items = sel.list.map((x) => (x.stock >= x.dose ? (isLiquid(x) ? `${x.name} ${x.dose} ml` : `${x.name} × ${x.dose} ${x.unit}`) : `${x.name} (ยาหมด/รอเติม)`));
    setDrugs(drugs.map((x) => (sel.list.some((y) => y.id === x.id) ? { ...x, stock: Math.max(0, x.stock - x.dose) } : x)));
    const id = Date.now();
    setPacks([{ id, date, who, meal: sel.m, items, qa: "รอตรวจ", given: false, by: me }, ...packs]);
    saveMedPhoto("pack", id, photo, toast);
    setMeal(null); toast(`จัดยาแล้ว · มื้อ${sel.m} · ส่งเข้าตะกร้ายา รอตรวจ QA`);
  };

  // จัดยาตามมื้อใช้หน้าแบบทีละมื้อ (MealBoard) · ส่วนล่างของฟังก์ชันนี้เป็นของเบิกยาตามใช้
  if (isMeal) return <MealBoard drugs={drugs} setDrugs={setDrugs} packs={packs} setPacks={setPacks} go={go} me={me} focus={focus} allergy={allergy} onAddDrug={onAddDrug} />;
  // เบิกยา: แบบ ข-1 (หน้าเดียวต่อคน · แถบเลือกคนด้านบน · ยามื้อนี้บันทึกครั้งเดียว · components/pharmacy/MedRound)
  if (!isMeal) return <MedRound drugs={drugs} who={who} setWho={setWho} allergy={allergy} me={me} canVoidAll={canVoidAll} onAddDrug={onAddDrug} go={go}
    people={RESIDENTS.map((w) => { const r = live.find((x) => x.full_name === w); return { id: r?.id, name: w, room: r?.room ?? "", age: r?.age ?? null }; })} />;
  if (sel) {
    const short = sel.list.filter((x) => x.stock < x.dose);
    return (
      <>
        <button className="btn-soft mb-5" onClick={() => setMeal(null)}><Icon name="chevron" className="h-4 w-4 rotate-90" /> กลับหน้ารายการมื้อยา</button>
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Section title={`มื้อยา ${sel.m}`} sub={`${who} · ${thai(date)}`}>
            {short.length > 0 && <p className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">ยาในคลังไม่พอ: {short.map((x) => `${x.name} (เหลือ ${stockText(x)})`).join(", ")} ระบบจะจัดเท่าที่มี และติดป้ายว่ารอเติม</p>}
            <p className="mb-3 text-sm font-medium text-gold-700">รายการยาที่ต้องใส่ในซองนี้ (ติ๊กเมื่อหยิบแล้ว)</p>
            <ul className="space-y-2">
              {sel.list.map((x) => {
                const on = checked.includes(x.id);
                return (
                  <li key={x.id}>
                    <label className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${on ? "border-emerald-300 bg-emerald-50/60" : "border-cream-300 bg-white"}`}>
                      <input type="checkbox" className="mt-1.5" checked={on} onChange={() => { setChecked(on ? checked.filter((y) => y !== x.id) : [...checked, x.id]); if (saveErr === "check") setSaveErr(""); }} />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline justify-between gap-x-3"><b className="font-medium text-gold-900">{x.name}</b><span className="text-lg font-semibold text-gold-700">{x.dose} {x.unit}</span></span>
                        <span className="block text-sm text-gold-600">{x.how}{isLiquid(x) ? ` · ตวงด้วยถ้วยตวง · คงเหลือ ${stockText(x)} → หลังจัด ${stockText({ ...x, stock: Math.max(0, x.stock - x.dose) })}` : ""}</span>
                        {x.warn.length > 0 && <span className="mt-1 block text-xs text-red-700">คำเตือน: {x.warn.join(" · ")}</span>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </Section>
          <Section title="ถ่ายรูปเมื่อจัดเสร็จ">
            <Photo value={photo} onChange={(u) => { setPhoto(u); if (saveErr === "photo") setSaveErr(""); }} label="ถ่ายรูปซองยาที่จัดเสร็จ (บังคับ)" invalid={saveErr === "photo"} />
            <p className="mt-2 text-xs text-gold-500">ถ่ายให้เห็นเม็ดยาคู่กับป้ายฉลาก เพื่อให้ผู้ตรวจ QA เทียบกับรูปยาต้นฉบับได้</p>
            {saveErr && <p role="alert" className="form-error mt-4"><Icon name="alert" className="h-4 w-4 shrink-0" />{saveErr === "photo" ? "กรุณาถ่ายรูปซองยาที่จัดเสร็จก่อนบันทึก (แตะช่องกล้องด้านบน)" : `กรุณาติ๊กยาให้ครบทุกรายการก่อนบันทึก (ติ๊กแล้ว ${checked.length} จาก ${sel.list.length})`}</p>}
            <button className="btn-primary mt-4 w-full" onClick={save}>บันทึกการจัดยามื้อนี้</button>
          </Section>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader title={isMeal ? "จัดยาตามมื้อ" : "เบิกยา"}
        sub={isMeal ? "ยาที่กินตามมื้อประจำ (ยาเม็ด · ยาน้ำตามมื้อ) · จัดลงซอง › ตรวจซองยา (QA) › พนักงานให้ยาใน KinApp" : "ยาทุกตัวของผู้ป่วย · ยาตามมื้อบอกว่ามื้อไหนให้แล้ว · เบิกแล้วระบบตัดคงเหลือ และบันทึกเป็นการให้ยาของมื้อนั้น"}
        actions={<><button className="btn-soft" onClick={() => onAddDrug(who)}><Icon name="plus" className="h-4 w-4" /> เพิ่มยา<span className="hidden sm:inline">ให้ {who || "ผู้ป่วย"}</span></button>{isMeal && <button className="btn-soft" onClick={() => setPreview(true)}><Icon name="eye" className="h-4 w-4" /> ตรวจซอง<span className="hidden sm:inline">มื้อยาก่อนจัด</span></button>}</>} />
      {/* จอกว้าง (≥1024px): รายชื่อซ้ายตรึงไว้ + เนื้อหาขวา · แท็บเล็ต/มือถือ: รายชื่อเป็นแถบเลื่อนแนวนอนด้านบน */}
      <div className="grid items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-5">
        <aside className="card min-w-0 space-y-2 p-3 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
          {/* มือถือ/แท็บเล็ต: ปุ่มผู้ป่วยที่เลือก กดแล้วกางรายชื่อ (ไม่มีแถบเลื่อนแนวนอน) · จอกว้าง: รายชื่อเปิดตลอด */}
          <button type="button" aria-expanded={pickOpen} onClick={() => setPickOpen(!pickOpen)}
            className="flex w-full items-center justify-between gap-3 rounded-xl border border-gold-600 bg-gold-100/60 px-3 py-2.5 text-left lg:hidden">
            <span className="min-w-0"><small className="block text-[11px] text-gold-500">ผู้ป่วย</small><b className="block truncate text-[15px] text-gold-900">{who || "เลือกผู้ป่วย"}{roomOf(who) && roomOf(who) !== "-" ? ` · ${roomOf(who)}` : ""}</b></span>
            <span className="shrink-0 text-sm font-medium text-gold-700">{pickOpen ? "ปิด ▴" : "เปลี่ยน ▾"}</span>
          </button>
          <div className={`${pickOpen ? "grid" : "hidden"} gap-2 lg:grid`}>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
            <ThaiDateInput label="วันกินยา" value={date} onChange={(v) => v && setDate(v)} />
            <input value={pq} onChange={(e) => setPq(e.target.value)} placeholder="ค้นหาชื่อ / ห้อง" aria-label="ค้นหาผู้ป่วย" />
          </div>
          <div className="flex gap-1 text-xs" role="radiogroup" aria-label="กรองรายชื่อ">
            {(isMeal ? [["todo", "ต้องจัด"], ["has", "มีซอง"], ["all", "ทั้งหมด"]] as const : [["todo", "ยังให้ไม่ครบ"], ["has", "มียา"], ["all", "ทั้งหมด"]] as const).map(([k, t]) => (
              <button key={k} type="button" role="radio" aria-checked={pf === k} onClick={() => setPf(k)}
                className={`flex-1 rounded-full border px-2 py-1 ${pf === k ? "border-gold-700 bg-gold-700 font-medium text-white" : "border-cream-300 bg-white text-gold-700"}`}>{t} {pCount[k]}</button>
            ))}
          </div>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1">{peopleShown.map(({ w, g, has, wd }) => {
            const on = w === who, pending = g.all > g.done;
            return (
              <li key={w} className="min-w-0">
                <button type="button" aria-pressed={on} onClick={() => { setWho(w); setPickOpen(false); }} className={`grid w-full gap-1 rounded-xl border px-3 py-2 text-left transition ${on ? "border-gold-600 bg-gold-100/60 shadow-[inset_0_0_0_1px] shadow-gold-600" : "border-cream-300 bg-white hover:border-gold-300"} ${has ? "" : "opacity-60"}`}>
                  <span className="flex items-baseline justify-between gap-2"><b className="truncate text-sm text-gold-900">{w}</b><small className="shrink-0 text-xs text-gold-500">{roomOf(w) && roomOf(w) !== "-" ? roomOf(w) : ""}</small></span>
                  {(isMeal || g.all > 0) && (g.all > 0 ? <span className="h-1.5 overflow-hidden rounded-full bg-cream-300"><i className={`block h-full rounded-full ${pending ? "bg-amber-500" : "bg-emerald-600"}`} style={{ width: `${(g.done / g.all) * 100}%` }} /></span> : <span className="h-1.5 rounded-full bg-cream-200" />)}
                  <small className={`truncate text-[11.5px] ${pending ? "font-medium text-amber-800" : "text-gold-500"}`}>{isMeal
                    ? (!has ? "ไม่มีซองตามมื้อ" : pending ? `จัดซองแล้ว ${g.done}/${g.all} มื้อ` : `✓ จัดซองครบ ${g.all} มื้อ`)
                    : (!has ? "ยังไม่มียา" : g.all ? (pending ? `ให้ยาตามมื้อแล้ว ${g.done}/${g.all}` : `✓ ให้ยาตามมื้อครบ ${g.all}`) : `ยาใช้เมื่อจำเป็น ${g.use} รายการ`)}</small>
                  {!isMeal && wd && <small className="truncate text-[11.5px] text-gold-500">เบิกวันนี้ {wd.n} ครั้ง · ล่าสุด {wd.last} น.</small>}
                </button>
              </li>
            );
          })}</ul>
          {!peopleShown.length && <p className="py-3 text-center text-xs text-gold-500">{pq ? `ไม่พบ "${pq}"` : pf === "todo" ? (isMeal ? "จัดซองครบทุกคนแล้ว" : "ให้ยาตามมื้อครบทุกคนแล้ว") : isMeal ? "ไม่มีใครมีซองตามมื้อ" : pf === "done" ? "ยังไม่มีใครเบิกยาวันนี้" : "ไม่มีใครมียา"}</p>}
          </div>
        </aside>

        <div className="min-w-0 space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h2 className="text-lg font-semibold text-gold-900 sm:text-xl">{who || "-"}</h2><p className="text-sm text-gold-500">{roomOf(who) ? `ห้อง ${roomOf(who)} · ` : ""}ยา {drugs.filter((x) => x.who === who).length} รายการ · {thai(date)}</p></div>
            {allergy[who] && <p role="alert" className="rounded-xl bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-700">⚠ แพ้ยา: {allergy[who]}</p>}
          </div>

          {/* อีกเมนู: บอกว่ามียาอีกแบบของคนนี้ กดไปได้เลย */}
          {otherCount > 0 && <button type="button" onClick={() => go(isMeal ? "withdraw" : "dispense")}
            className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-2.5 text-left text-sm ${isMeal ? "border-amber-200 bg-amber-50 text-amber-900" : "border-sky-200 bg-sky-50 text-sky-900"}`}>
            <span>{isMeal ? `${who} มียาเบิกตามใช้ (ยาขวด · ยาทา · ตามอาการ) ${otherCount} รายการ · ไม่อยู่ในหน้านี้` : `${who} มีซองยาตามมื้อ ${otherCount} มื้อวันนี้ · จัดที่เมนูจัดยาตามมื้อ`}</span>
            <b className="whitespace-nowrap">{isMeal ? "ไปเบิกยาตามใช้ ›" : "ไปจัดยาตามมื้อ ›"}</b></button>}

          {/* จัดยาตามมื้อ */}
          {isMeal && <section className="space-y-3 rounded-2xl border border-sky-200 bg-sky-50/60 p-3 sm:p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="flex items-center gap-2 text-base font-semibold text-gold-900"><i className="h-2.5 w-2.5 rounded-full bg-sky-600" aria-hidden />ซองยาตามมื้อ</h3>
              <span className="text-xs text-gold-600">จัดลงซอง › ตรวจซองยา (QA) › พนักงานให้ยาใน KinApp · จัดแล้ว {done}/{meals.length} มื้อ</span>
            </div>
      {meals.length === 0 ? <div className="rounded-xl bg-white px-4 py-5 text-center text-sm text-gold-600">{drugs.some((x) => x.who === who) ? "ไม่มียาที่ต้องจัดลงซองวันนี้ (ยาอาจเป็นยาเบิกตามใช้ งดชั่วคราว หรือไม่ได้กินวันนี้)" : <>{who} ยังไม่มียาในระบบ · <button type="button" className="font-medium text-gold-800 underline" onClick={() => onAddDrug(who)}>เพิ่มยาให้ {who}</button></>}</div> : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {meals.map((x) => (
            <div key={x.m} className={`card flex min-w-0 flex-col p-4 ${x.pack ? "!border-emerald-200 bg-emerald-50/40" : ""}`}>
              <div className="flex items-center justify-between gap-2"><h3 className="text-lg font-medium text-gold-800">{x.m}</h3>{x.pack ? <StatusBadge value="จัดยาแล้ว" /> : <StatusBadge value={`รอจัด ${x.list.length} รายการ`} />}</div>
              <ul className="mt-3 flex-1 space-y-1 text-sm text-gold-600">{(x.pack ? x.pack.items : x.list.map((y) => (isLiquid(y) ? `${y.name} ${y.dose} ml` : `${y.name} × ${y.dose} ${y.unit}`))).map((t) => <li key={t} className="truncate">• {t}</li>)}</ul>
              {x.pack?.given ? (
                <p className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-center text-xs text-emerald-800">จ่ายยาแล้ว · {x.pack.gby ?? "-"}{x.pack.gat ? ` · ${x.pack.gat}` : ""}<br />ซองที่จ่ายแล้วรีเซตไม่ได้ (เป็นบันทึกการให้ยา)</p>
              ) : x.pack ? (
                <button className="btn-danger mt-4 w-full" onClick={() => confirm({ title: "รีเซตมื้อยา", message: `ล้างการจัดยามื้อ${x.m}ของวันนี้ และคืนสต็อกยา ใช่หรือไม่${x.pack!.qa === "ตรวจผ่าน" ? " (ซองนี้ตรวจ QA ผ่านแล้วและอยู่ในคิวจ่ายยาของ KinApp)" : ""}`, danger: true, okLabel: "รีเซต", onOk: () => {
                  setDrugs(drugs.map((y) => (x.list.some((z) => z.id === y.id) ? { ...y, stock: y.stock + y.dose } : y)));
                  setPacks(packs.filter((p) => p.id !== x.pack!.id)); toast("รีเซตแล้ว · เริ่มจัดยาใหม่ได้");
                } })}>รีเซต</button>
              ) : (
                <button className="btn-primary mt-4 w-full" onClick={() => { setMeal(x.m); setChecked([]); setPhoto(""); setSaveErr(""); }}>เริ่มจัดยามื้อนี้</button>
              )}
            </div>
          ))}
        </div>
      )}
      {done > 0 && done === meals.length && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><span>จัดยาครบทุกมื้อแล้ว ส่งเข้าตะกร้ายารอตรวจ QA</span><button className="btn-soft" onClick={() => go("qa")}>ไปตรวจซองยา</button></div>}
          </section>}

          {/* เบิกยาตามใช้ */}
          {!isMeal && <section className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50/60 p-3 sm:p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="flex items-center gap-2 text-base font-semibold text-gold-900"><i className="h-2.5 w-2.5 rounded-full bg-amber-600" aria-hidden />ยาของ {who || "ผู้ป่วย"}</h3>
              <span className="text-xs text-gold-600">เลือกมื้อ › ติ๊กตรวจแล้ว › เบิก · ระบบตัดคงเหลือและบันทึกการให้ยา</span>
            </div>
            <WithdrawBox drugs={drugs} who={who} reload={tlKey} onDone={() => setTlKey((k) => k + 1)} />
          </section>}

          <DayTimeline only={isMeal ? "pack" : "use"} who={who} date={date} packs={packs} me={me} canVoidAll={canVoidAll} reload={tlKey} onVoided={() => setTlKey((k) => k + 1)} />
        </div>
      </div>

      <Modal open={preview} wide title="ตรวจสอบซองมื้อยาก่อนจัด" onClose={() => setPreview(false)} footer={<button className="btn-primary" onClick={() => setPreview(false)}>ปิด</button>}>
        <p className="mb-4 text-sm text-gold-600">สรุปยาที่ต้องหยิบมาจัดของ {who} วันที่ {thai(date)}</p>
        <DataTable columns={["มื้อยา", "ชื่อยา", "จำนวน", "คงเหลือในคลัง"]} rows={meals.flatMap((x) => x.list.map((y) => [x.m, y.name, `${y.dose} ${y.unit}`, stockText(y)]))} />
      </Modal>
    </>
  );
}

/* ---------- ตะกร้ายา & QA ---------- */
function QA({ packs, setPacks, drugs, setDrugs, go, me, onRedo }: { packs: Pack[]; setPacks: (x: Pack[]) => void; drugs: Drug[]; setDrugs: (x: Drug[]) => void; go: (p: Page) => void; me: string; onRedo: (who: string, date: string) => void }) {
  const { toast, confirm } = useApp();
  /** ซองที่จัดผิด: ลบซอง คืนยาเข้าตะกร้าผู้ป่วย แล้วเปิดหน้าจัดยาของผู้ป่วยและวันนั้น (เหมือนกดรีเซตที่หน้าจัดยา) */
  const redo = (p: Pack) => confirm({ title: "รีเซตซองนี้แล้วจัดใหม่", message: `ล้างซองมื้อ${p.meal}ของ ${p.who} วันที่ ${thai(p.date)} คืนยาเข้าตะกร้า แล้วไปหน้าจัดยาเพื่อจัดใหม่ ใช่หรือไม่`, danger: true, okLabel: "รีเซตและจัดใหม่", onOk: () => {
    const list = drugsFor(drugs, p.who, p.meal, p.date);
    setDrugs(drugs.map((y) => (list.some((z) => z.id === y.id) ? { ...y, stock: y.stock + y.dose } : y)));
    setPacks(packs.filter((x) => x.id !== p.id));
    toast(`รีเซตแล้ว · ${p.who} มื้อ${p.meal} · จัดซองใหม่ได้เลย`);
    onRedo(p.who, p.date);
  } });
  // รูปซองที่จัดเสร็จ + รูปฉลากต้นฉบับของยาในซอง (โหลดตอนกดดู)
  const [pics, setPics] = useState<{ title: string; items: PhotoItem[] } | null>(null);
  const openPics = (p: Pack) => setPics({ title: `${p.who} · มื้อ${p.meal} · ${thai(p.date)}`, items: [
    { kind: "pack", id: p.id, title: "รูปซองยาที่จัดเสร็จ" },
    ...drugs.filter((x) => x.who === p.who && p.items.some((t) => t.startsWith(x.name))).map((x): PhotoItem => ({ kind: "label", id: x.id, title: `ฉลากต้นฉบับ · ${x.name}` })),
  ] });
  const [tab, setTab] = useState("รอตรวจ");
  const [err, setErr] = useState<Pack | null>(null);
  const [reason, setReason] = useState("");
  const list = packs.filter((p) => tab === "ทั้งหมด" || p.qa === tab);
  const set = (id: number, x: Partial<Pack>) => setPacks(packs.map((p) => (p.id === id ? { ...p, ...x } : p)));
  const count = (t: string) => packs.filter((p) => t === "ทั้งหมด" || p.qa === t).length;
  return (
    <>
      <PageHeader title="ตรวจซองยา" sub="ให้คนที่ไม่ได้จัดซองเป็นคนตรวจ · เทียบรูปซองกับฉลาก ว่าถูกคน ถูกยา ถูกขนาด ถูกมื้อ แล้วกดตรวจผ่าน"
        actions={<button className="btn-soft" onClick={() => { go("audit"); toast("สุ่มตรวจสต็อก: เลือกผู้รับบริการเพื่อนับยาเทียบกับระบบ"); }}><Icon name="refresh" className="h-4 w-4" /> นับยาคงเหลือ</button>} />
      <div className="mb-5"><Tabs tabs={["รอตรวจ", "ตรวจผ่าน", "แจ้งจัดยาผิด", "ทั้งหมด"].map((t) => `${t} (${count(t)})`)} value={`${tab} (${count(tab)})`} onChange={(v) => setTab(v.split(" (")[0])} /></div>
      {list.length === 0 ? (
        <div className="card empty-state"><Icon name="check" /><p>{packs.length ? "ไม่มีซองยาในสถานะนี้" : "ยังไม่มีซองยาในตะกร้า เริ่มจากเมนูจัดยาตามมื้อ"}</p>{!packs.length && <button className="btn-primary mt-4" onClick={() => go("dispense")}>ไปจัดยาตามมื้อ</button>}</div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => (
            <article key={p.id} className="card flex min-w-0 flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0"><p className="truncate font-medium text-gold-800">{p.who}</p><p className="text-xs text-gold-500">{thai(p.date)} · มื้อ{p.meal} · จัดโดย {p.by}</p></div>
                <StatusBadge value={p.qa} />
              </div>
              <ul className="mt-3 flex-1 space-y-1 text-sm text-gold-700">{p.items.map((t) => <li key={t} className={t.includes("รอเติม") ? "text-red-700" : ""}>• {t}</li>)}</ul>
              <button className="btn-soft mt-3 w-full" onClick={() => openPics(p)}><Icon name="eye" className="h-4 w-4" /> ดูรูปซองเทียบฉลากยา</button>
              {p.reason && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">สาเหตุ: {p.reason}</p>}
              {p.qa === "แจ้งจัดยาผิด" && !p.given && <button className="btn-primary mt-2 w-full" onClick={() => redo(p)}><Icon name="refresh" className="h-4 w-4" /> รีเซตซองนี้แล้วจัดใหม่</button>}
              {p.qa === "รอตรวจ" && (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <button className="btn-danger !px-3" onClick={() => { setErr(p); setReason(""); }}>แจ้งจัดยาผิด</button>
                  <button className="btn-primary !px-3" onClick={() => { set(p.id, { qa: "ตรวจผ่าน", qby: me }); toast(`ตรวจ QA ผ่านแล้ว · ${p.who} มื้อ${p.meal} · ขึ้นคิวจ่ายยาใน KinApp แล้ว`); }}>ตรวจผ่าน</button>
                </div>
              )}
              {p.qa === "ตรวจผ่าน" && !p.given && <p className="mt-4 rounded-xl bg-cream-50 px-3 py-2 text-center text-xs text-gold-600">ตรวจโดย {p.qby ?? "-"} · รอพนักงานจ่ายยาใน KinApp</p>}
              {p.qa === "ตรวจผ่าน" && !p.given && <button className="btn-soft mt-2 w-full" onClick={() => { set(p.id, { given: true, gby: me, gat: nowTh() }); toast(`ให้ยาแล้ว · ${p.who} มื้อ${p.meal}`); }}>บันทึกว่าจ่ายยาแล้ว (ห้องยาจ่ายเอง)</button>}
              {p.given && <p className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-center text-xs text-emerald-800">จ่ายยาแล้ว · {p.gby ?? "-"}{p.gat ? ` · ${p.gat}` : ""}</p>}
            </article>
          ))}
        </div>
      )}
      <MedPhotoModal open={!!pics} title={pics?.title ?? ""} items={pics?.items ?? []} onClose={() => setPics(null)} />
      <Modal open={!!err} title="แจ้งจัดยาผิด (Near Miss)" onClose={() => setErr(null)}
        footer={<><button className="btn-soft" onClick={() => setErr(null)}>ยกเลิก</button><button className="btn-danger" onClick={() => { if (!reason) return toast("กรุณาระบุสาเหตุที่จัดผิด"); set(err!.id, { qa: "แจ้งจัดยาผิด", reason }); setErr(null); toast(`บันทึกจัดยาผิดแล้ว · Near Miss (Category B) · ${reason}`); }}>บันทึกการแจ้ง</button></>}>
        <p className="mb-4 text-sm text-gold-600">ระบุสาเหตุตามหลัก 5R การดักจับความผิดพลาดตรงนี้เรียกว่า Category B (Near Miss)</p>
        <div className="grid gap-2">{ERR_5R.map((r) => <Chip key={r} on={reason === r} onClick={() => setReason(r)}>{r}</Chip>)}</div>
      </Modal>
    </>
  );
}

/* ---------- รับยาเข้าคลัง ---------- */
const blankForm = () => ({ who: "", name: "", use: "", how: "", store: STORES[0], form: FORMS[0], bulk: false, dose: "1", timing: TIMINGS[1], meals: ["เช้า"] as string[], days: [] as string[], warn: [] as string[], stock: "", unit: "เม็ด", fridge: false, hold: false, photo: "", bottles: "1", size: "", src: "own" as "own" | "central", sdrug: "", sqty: "" });
const CENTRAL = "คลังศูนย์";
type CDrug = { id: string; name: string; unit: string; form: string | null; price: number | null; have: number };
const postStock = async (body: object) => {
  const r = await fetch("/api/pharmstock", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "ทำรายการไม่สำเร็จ");
  return d as { left: number; unit: string; priced: boolean };
};
const LIQUID = FORMS[1];
/** ยาใกล้หมด: เหลือไม่ถึง 2 วัน (ยาขวดเหลือ 1 หน่วย) · ยางดชั่วคราวไม่นับ */
const isLowDrug = (x: Drug) => !x.hold && x.stock <= (x.bulk ? 1 : x.dose * x.meals.length * 2);

/** view: "" ทั้งหมด · low ใกล้หมด (ปุ่ม "เติมยาใกล้หมด" ในหน้าแรกเปิดมาที่นี่) · hold งดยาชั่วคราว */
function Inventory({ drugs, setDrugs, master, addFor, onAdded, lowView, onLowView }: { drugs: Drug[]; setDrugs: (x: Drug[]) => void; master: string[][]; addFor: string | null; onAdded: () => void; lowView: string; onLowView: (v: string) => void }) {
  const RESIDENTS = useNames();
  const { toast, confirm } = useApp();
  const [f, setF] = useState(blankForm);
  const [tag, setTag] = useState("");
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<Drug | null>(null);
  const [label, setLabel] = useState<Drug | null>(null);
  // แก้ไขรายการยา (แพทย์ปรับขนาด/มื้อ) · ยอดคงเหลือแก้ที่เมนูเคลียร์คลังยา
  const [edit, setEdit] = useState<(Drug & { doseText: string; tag: string }) | null>(null);
  const toggleEdit = (k: "meals" | "days" | "warn", v: string) => edit && setEdit({ ...edit, [k]: edit[k].includes(v) ? edit[k].filter((x) => x !== v) : [...edit[k], v] });
  const saveEdit = () => {
    if (!edit) return;
    const dose = Number(edit.doseText);
    if (!edit.name.trim()) return toast("กรุณากรอกชื่อยา");
    if (!edit.bulk && !(dose > 0)) return toast("กรุณากรอกปริมาณต่อครั้งให้มากกว่า 0");
    if (!edit.bulk && !edit.meals.length) return toast("กรุณาเลือกมื้อยาอย่างน้อย 1 มื้อ");
    const old = drugs.find((x) => x.id === edit.id);
    if (!old) return setEdit(null);
    const { doseText: _d, tag: _t, ...rest } = edit; // eslint-disable-line @typescript-eslint/no-unused-vars
    const next: Drug = { ...rest, name: edit.name.trim(), dose: dose > 0 ? dose : old.dose, store: edit.fridge ? "ตู้เย็น" : edit.store === "ตู้เย็น" ? STORES[0] : edit.store };
    setDrugs(drugs.map((x) => (x.id === edit.id ? next : x)));
    const changed = [isUseDrug(old) !== isUseDrug(next) ? (isUseDrug(next) ? "เปลี่ยนเป็นใช้เมื่อจำเป็น" : "เปลี่ยนเป็นกินตามมื้อ") : "", old.dose !== next.dose ? `ครั้งละ ${old.dose} → ${next.dose} ${next.unit}` : "", old.meals.join(",") !== next.meals.join(",") ? `มื้อ ${next.meals.join(", ") || "-"}` : "", old.hold !== next.hold ? (next.hold ? "งดยาชั่วคราว" : "ยกเลิกงดยา") : ""].filter(Boolean);
    toast(`แก้ไขยาแล้ว · ${next.name} · ${next.who}${changed.length ? ` · ${changed.join(" · ")}` : ""} · ซองที่จัดหลังจากนี้ใช้ข้อมูลใหม่`);
    setEdit(null);
  };
  const [filter, setFilter] = useState("");
  const toggle = (k: "meals" | "days" | "warn", v: string) => setF({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] });
  const mine = drugs.filter((x) => !filter || x.who === filter);
  const shown = mine.filter((x) => !lowView || (lowView === "low" ? isLowDrug(x) : x.hold));
  // เบิกจากคลังกลางของศูนย์: ยาที่สาขาของผู้ป่วยมีคงเหลือ
  const { residents } = useResidents();
  const [central, setCentral] = useState<CDrug[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [refill, setRefill] = useState<{ x: Drug; qty: string } | null>(null);
  const branchOf = (who: string) => residents.find((r) => r.full_name === who)?.branch_name ?? "";
  const loadCentral = (who: string) => {
    const br = branchOf(who);
    setCentral(null);
    fetch(`/api/pharmstock?op=list${br ? `&branch=${encodeURIComponent(br)}` : ""}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return setCentral([]);
      const have = (id: string) => (d.lots as { drug_id: string; qty: number }[]).filter((l) => l.drug_id === id).reduce((n, l) => n + l.qty, 0);
      setCentral((d.drugs as CDrug[]).map((x) => ({ ...x, have: have(x.id) })));
    }).catch(() => setCentral([]));
  };
  useEffect(() => { if (open && f.src === "central" && f.who) loadCentral(f.who); }, [open, f.src, f.who]); // eslint-disable-line react-hooks/exhaustive-deps
  const cd = central?.find((x) => x.id === f.sdrug) ?? null;
  const saveCentral = async () => {
    if (!f.who) return toast("กรุณาเลือกผู้สูงอายุที่รับยา");
    if (!cd) return toast("กรุณาเลือกยาจากคลังกลาง");
    const qty = Number(f.sqty);
    if (!(qty > 0)) return toast("กรุณากรอกจำนวนที่เบิก");
    if (!f.bulk && !f.meals.length) return toast("กรุณาเลือกมื้อยาอย่างน้อย 1 มื้อ");
    setBusy(true);
    try {
      const r = await postStock({ op: "issue", drugId: cd.id, qty, residentName: f.who, basket: { use: f.use, how: f.how, store: f.store, bulk: f.bulk, dose: Number(f.dose) || 1, timing: f.timing, meals: f.meals, days: f.days, warn: f.warn, fridge: f.fridge } });
      refreshData("pharmacy-drugs");
      setF({ ...blankForm(), who: f.who }); setOpen(false);
      toast(`เบิกจากคลังกลางเข้าตะกร้าแล้ว · ${cd.name} ${qty} ${cd.unit} · ${f.who} · คลังเหลือ ${r.left} ${r.unit}${r.priced ? " · ขึ้นค่ายารอเรียกเก็บที่การเงิน" : ""}`);
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const saveRefill = async () => {
    if (!refill?.x.sdid) return;
    const qty = Number(refill.qty);
    if (!(qty > 0)) return toast("กรุณากรอกจำนวนที่เติม");
    setBusy(true);
    try {
      const r = await postStock({ op: "issue", drugId: refill.x.sdid, qty, residentName: refill.x.who, medId: String(refill.x.id) });
      refreshData("pharmacy-drugs");
      toast(`เติมยาจากคลังกลางแล้ว · ${refill.x.name} +${qty} ${refill.x.unit} · ${refill.x.who} · คลังเหลือ ${r.left} ${r.unit}${r.priced ? " · ขึ้นค่ายารอเรียกเก็บที่การเงิน" : ""}`);
      setRefill(null);
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  // มาจากหน้าจัดยา: เปิดฟอร์มพร้อมชื่อผู้ป่วย
  useEffect(() => { if (addFor) { setF({ ...blankForm(), who: addFor }); setFilter(addFor); setOpen(true); onAdded(); } }, [addFor]); // eslint-disable-line react-hooks/exhaustive-deps
  /** ยาน้ำแบบตวงต่อมื้อ: นับเป็น ml (จำนวนขวด × ขนาดบรรจุ) */
  const liquid = f.form === LIQUID && !f.bulk;
  const save = () => {
    if (!f.who) return toast("กรุณาเลือกผู้สูงอายุที่รับยามา");
    if (!f.name.trim()) return toast("กรุณากรอกชื่อยา");
    if (!f.photo) return toast("กรุณาถ่ายรูปกล่องยา / ฉลากยา");
    if (!f.bulk && !f.meals.length) return toast("กรุณาเลือกมื้อยาอย่างน้อย 1 มื้อ");
    const size = Number(f.size), bottles = Number(f.bottles);
    if (liquid && !(size > 0 && bottles > 0)) return toast("กรุณากรอกขนาดบรรจุต่อขวด (ml) และจำนวนขวด");
    if (liquid && !(Number(f.dose) > 0)) return toast("กรุณากรอกปริมาณที่ให้ต่อครั้ง (ml)");
    const stock = liquid ? size * bottles : Number(f.stock);
    if (!stock) return toast("กรุณากรอกจำนวนที่รับมา");
    const id = Date.now();
    setDrugs([{ id, who: f.who, name: f.name.trim(), use: f.use, how: f.how, store: f.fridge ? "ตู้เย็น" : f.store, form: f.form, bulk: f.bulk, dose: Number(f.dose) || 1, timing: f.timing, meals: f.meals, days: f.days, warn: f.warn,
      stock, received: stock, unit: liquid ? "ml" : f.unit || "เม็ด", fridge: f.fridge, hold: f.hold, status: "ปกติ", ...(liquid ? { pack: size } : {}) }, ...drugs]);
    saveMedPhoto("label", id, f.photo, toast);
    setF({ ...blankForm(), who: f.who }); setOpen(false); toast(`เพิ่มยาแล้ว · ${f.name.trim()} · ${f.who} · ${f.bulk ? "ใช้เมื่อจำเป็น · เบิกที่เมนูเบิกยา" : "กินตามมื้อ · ขึ้นในรายการให้ยาของแต่ละมื้อ"}`);
  };
  return (
    <>
      <PageHeader title="ยาของผู้ป่วย" sub="เพิ่มยาใหม่ที่ได้มา แก้วิธีให้ยา และดูคงเหลือของแต่ละคน"
        actions={<><button className="btn-soft" onClick={() => window.print()}><Icon name="print" className="h-4 w-4" /> พิมพ์ใบรับยาเข้า</button><button className="btn-primary" onClick={() => { setF(blankForm()); setOpen(true); }}><Icon name="plus" className="h-4 w-4" /> เพิ่มยาใหม่</button></>} />
      <Section title="ยาทั้งหมด แยกตามผู้ป่วย" actions={<div className="min-w-52"><Select options={RESIDENTS} placeholder="ผู้ป่วยทุกคน" value={filter} onChange={setFilter} /></div>}>
        <StatFilter label="กรองยา" value={lowView} onChange={onLowView} items={[
          { k: "", t: "ทั้งหมด", n: mine.length, tone: "all" },
          { k: "low", t: "ใกล้หมด", n: mine.filter(isLowDrug).length, tone: "bad" },
          { k: "hold", t: "งดยาชั่วคราว", n: mine.filter((x) => x.hold).length, tone: "muted" },
        ]} />
        {/* มือถือ: 1 การ์ดต่อคน ยาเป็นแถวในการ์ด (ชื่อคนไม่ซ้ำทุกใบ) · คงเหลือบอกเป็นวัน · ใกล้หมดเป็นแถวแดง · กดแถว = รายละเอียดยา */}
        <div className="space-y-3 sm:hidden">
          {!shown.length && <p className="rounded-xl bg-cream-50 px-4 py-6 text-center text-sm text-gold-500">ไม่มียาในรายการนี้</p>}
          {[...new Set(shown.map((x) => x.who))].map((w) => {
            const items = shown.filter((x) => x.who === w), room = residents.find((r) => r.full_name === w)?.room;
            return (
              <div key={w} className="overflow-hidden rounded-2xl border border-cream-300 bg-white">
                <div className="flex items-center gap-2.5 px-3 py-2.5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cream-100 text-sm font-semibold text-gold-700">{initialsOf(w)}</span>
                  <span className="min-w-0 flex-1"><b className="block truncate text-[15px] text-gold-900">{w}</b><small className="block text-xs text-gold-500">{[room && room !== "-" ? `ห้อง ${room}` : "", `ยา ${items.length} รายการ`].filter(Boolean).join(" · ")}</small></span>
                  <button type="button" className="btn-soft !min-h-[32px] shrink-0 !px-3 !py-1 text-xs" onClick={() => { setF({ ...blankForm(), who: w }); setOpen(true); }}><Icon name="plus" className="h-3.5 w-3.5" /> ยา</button>
                </div>
                {items.map((x) => {
                  const low = isLowDrug(x), dl = daysLeft(x), refillable = !!x.sdid && low;
                  return (
                    <div key={x.id} role="button" tabIndex={0} aria-label={`รายละเอียด ${x.name}`} onClick={() => setView(x)} onKeyDown={(e) => { if (e.key === "Enter") setView(x); }}
                      className={`flex items-center gap-2 border-t border-cream-200 px-3 py-2 ${low ? "bg-red-50/70" : x.hold ? "bg-cream-50 opacity-70" : ""}`}>
                      <span className="min-w-0 flex-1"><b className="block text-sm font-medium text-gold-900">{x.name}</b>
                        <small className="block text-xs text-gold-500">{isUseDrug(x) ? `ใช้เมื่อจำเป็น${x.bulk ? " · ยาขวด / ยาทา" : ""}` : `${x.meals.join(" ")} · ครั้งละ ${x.dose} ${x.unit}`}{x.hold ? " · งดชั่วคราว" : ""}</small></span>
                      <span className="shrink-0 text-right text-xs leading-tight"><b className="block text-[13px] text-gold-900">{stockText(x)}</b><span className={low ? "font-semibold text-red-700" : "text-emerald-700"}>{low ? "ใกล้หมด" : dl !== null ? `พอ ${dl} วัน` : "คงเหลือ"}</span></span>
                      <button type="button" className={`${refillable ? "btn-primary" : "btn-soft"} !min-h-[30px] shrink-0 !px-2.5 !py-1 text-xs`}
                        onClick={(e) => { e.stopPropagation(); if (refillable) setRefill({ x, qty: "" }); else setEdit({ ...x, doseText: String(x.dose), tag: "" }); }}>{refillable ? "เติม" : "แก้ไข"}</button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="hidden sm:block"><DataTable
          columns={["ผู้สูงอายุ", "ชื่อยา", "วิธีทาน", "วิธีให้ยา / มื้อ", "คงเหลือ", "สถานะ"]}
          rows={shown.map((x) => [x.who, `${x.name} · [${x.src === CENTRAL ? CENTRAL : "ญาตินำมา"}]`, x.how || "-", isUseDrug(x) ? `ใช้เมื่อจำเป็น${x.bulk ? " · ยาขวด / ยาทา" : ""}` : `กินตามมื้อ · ${x.meals.join(", ")} · ครั้งละ ${x.dose} ${x.unit}`, stockText(x), x.hold ? "งดยาชั่วคราว" : x.status])}
          onRow={(i) => setView(shown[i])} rowLabel="กดเพื่อดูรายละเอียดยา"
          // ปุ่มหลัก 1 ปุ่มต่อแถว: ยาคลังกลางที่ใกล้หมด = เติม · นอกนั้น = แก้ไข · ที่เหลืออยู่ในเมนู ⋯
          actions={[
            { label: "เติมจากคลังกลาง", tone: "primary", hidden: (i) => !shown[i].sdid || !isLowDrug(shown[i]), onClick: (i) => setRefill({ x: shown[i], qty: "" }) },
            { label: "แก้ไข", tone: "primary", hidden: (i) => !!shown[i].sdid && isLowDrug(shown[i]), onClick: (i) => setEdit({ ...shown[i], doseText: String(shown[i].dose), tag: "" }) },
            { label: "แก้ไข", more: true, hidden: (i) => !shown[i].sdid || !isLowDrug(shown[i]), onClick: (i) => setEdit({ ...shown[i], doseText: String(shown[i].dose), tag: "" }) },
            { label: "เติมจากคลังกลาง", more: true, hidden: (i) => !shown[i].sdid || isLowDrug(shown[i]), onClick: (i) => setRefill({ x: shown[i], qty: "" }) },
            { label: "รายละเอียดยา", more: true, onClick: (i) => setView(shown[i]) },
            { label: "ลบ", more: true, danger: true, onClick: (i) => confirm({ title: "ลบยาออกจากตะกร้า", message: `ต้องการลบ ${shown[i].name} ของ ${shown[i].who} ใช่หรือไม่`, danger: true, okLabel: "ลบ", onOk: () => { setDrugs(drugs.filter((x) => x.id !== shown[i].id)); toast("ลบยาแล้ว"); } }) },
          ]}
        /></div>
      </Section>

      <Modal open={open} wide title="เพิ่มยาใหม่ของผู้ป่วย" onClose={() => setOpen(false)}
        footer={<><button className="btn-soft" onClick={() => setOpen(false)}>ยกเลิก</button>{f.src === "central"
          ? <button className="btn-primary" disabled={busy} onClick={saveCentral}>เบิกและเพิ่มเข้าตะกร้า</button>
          : <button className="btn-primary" onClick={save}>บันทึกยา</button>}</>}>
        <div className="space-y-6">
          <Field label="1. ยานี้ของใคร" required><ResidentPicker names={RESIDENTS} value={f.who} onChange={(v) => setF({ ...f, who: v, sdrug: "" })} /></Field>
          <div><p className="label">2. ได้ยามาจากไหน</p><div className="flex flex-wrap gap-2">
            <Chip on={f.src === "own"} onClick={() => setF({ ...f, src: "own" })}>ญาตินำมา / จากโรงพยาบาล</Chip>
            <Chip on={f.src === "central"} onClick={() => setF({ ...f, src: "central", form: FORMS[0], unit: "เม็ด", dose: "1" })}>เบิกจากคลังกลางของศูนย์</Chip>
          </div></div>
          {f.src === "central" ? <div className="form-grid">
            <Field label="ยาจากคลังกลาง" required className="md:col-span-2"><select value={f.sdrug} onChange={(e) => setF({ ...f, sdrug: e.target.value })} disabled={!f.who || !central}>
              <option value="">{!f.who ? "-- เลือกผู้สูงอายุก่อน --" : central === null ? "กำลังโหลด…" : central.length ? "-- เลือกยา --" : "ยังไม่มียาในคลังกลาง"}</option>
              {(central ?? []).map((x) => <option key={x.id} value={x.id} disabled={x.have <= 0}>{x.name} · คงเหลือ {x.have.toLocaleString("en-US")} {x.unit}{x.have <= 0 ? " (หมด)" : ""}</option>)}
            </select></Field>
            <Field label={`จำนวนที่เบิก${cd ? ` (${cd.unit})` : ""}`} required><input type="number" min="0" value={f.sqty} onChange={(e) => setF({ ...f, sqty: e.target.value })} placeholder="เช่น 30" /></Field>
            <p className="self-end pb-3 text-sm text-gold-700">{cd ? (cd.price !== null ? `ราคา ${cd.price.toLocaleString("en-US")} บาท/${cd.unit}${Number(f.sqty) > 0 ? ` = ${(cd.price * Number(f.sqty)).toLocaleString("en-US")} บาท` : ""}` : "ยานี้ยังไม่ได้ตั้งราคา (ไม่ขึ้นที่การเงิน)") : ""}</p>
            <p className="text-xs text-gold-600 md:col-span-2">ยาของศูนย์ ไม่ต้องถ่ายรูปฉลาก · กดบันทึกแล้วระบบหักคลังกลาง เพิ่มเข้าตะกร้า และขึ้นค่ายาที่การเงินในครั้งเดียว</p>
          </div> : <>
          <div><p className="label">3. ถ่ายรูปกล่องหรือฉลากยา (ใช้เทียบตอนตรวจซอง) <span className="text-red-500">*</span></p><Photo value={f.photo} onChange={(u) => setF({ ...f, photo: u })} /></div>
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-cream-300 bg-cream-50 p-4 text-sm">
            <input type="checkbox" className="mt-1" checked={f.bulk} onChange={(e) => setF({ ...f, bulk: e.target.checked, unit: e.target.checked ? "ขวด" : "เม็ด" })} />
            <span><b className="font-medium">ยานี้ไม่ได้กินเป็นมื้อ (ยาขวด ยาทา ยาพ่น ยาที่ให้เมื่อมีอาการ)</b><span className="block text-gold-600">ติ๊ก = ใช้เมื่อจำเป็น เบิกเมื่อใช้จริง · ไม่ติ๊ก = กินตามมื้อ ขึ้นในรายการให้ยาของแต่ละมื้อ (ยาน้ำที่ให้ตามมื้อ เช่น ครั้งละ 15 ml ไม่ต้องติ๊ก)</span></span>
          </label>
          </>}
          <div className="form-grid">
            {f.src === "own" && <Field label="ชื่อยา (พิมพ์เพื่อค้นหา)" required><input list="master-drugs" value={f.name} placeholder="เช่น Atorvastatin 40mg" onChange={(e) => { const m = master.find((x) => x[0] === e.target.value); setF({ ...f, name: e.target.value, use: m ? m[1] : f.use }); }} /><datalist id="master-drugs">{master.map((x) => <option key={x[0]} value={x[0]} />)}</datalist></Field>}
            <Field label="สรรพคุณ / ข้อบ่งใช้"><input value={f.use} placeholder="เช่น ยาลดไขมัน, ยาลดความดัน" onChange={(e) => setF({ ...f, use: e.target.value })} /></Field>
            <Field label="วิธีทานตามฉลาก"><input value={f.how} placeholder="เช่น วันละ 1 ครั้ง ก่อนนอน" onChange={(e) => setF({ ...f, how: e.target.value })} /></Field>
            <Field label="เก็บยาไว้ที่"><Select options={STORES} value={f.store} onChange={(v) => setF({ ...f, store: v || STORES[0] })} /></Field>
            {f.src === "own" && <Field label="รูปแบบยา"><Select options={FORMS} value={f.form} onChange={(v) => setF({ ...f, form: v || FORMS[0], ...(v === LIQUID ? { unit: "ml", dose: "" } : f.unit === "ml" ? { unit: "เม็ด", dose: "1" } : {}) })} /></Field>}
            <Field label="กินก่อนหรือหลังอาหาร"><Select options={TIMINGS} value={f.timing} onChange={(v) => setF({ ...f, timing: v || TIMINGS[0] })} /></Field>
          </div>
          {!f.bulk && (
            <div className="rounded-2xl border border-cream-300 p-4">
              <p className="mb-3 font-medium text-gold-800">มื้อและขนาดยา</p>
              <div className="form-grid">
                <Field label={liquid ? "ให้ครั้งละ (ml)" : "กินครั้งละ (Dose)"}><div className="flex items-center gap-2"><input type="number" min={liquid ? "1" : "0.5"} step={liquid ? "1" : "0.5"} value={f.dose} placeholder={liquid ? "เช่น 15" : ""} onChange={(e) => setF({ ...f, dose: e.target.value })} /><span className="shrink-0 text-sm text-gold-600">{f.src === "central" ? cd?.unit ?? "" : liquid ? "ml" : f.unit}</span></div></Field>
                <div><p className="label">กินมื้อไหนบ้าง (เลือกได้หลายมื้อ)</p><div className="flex flex-wrap gap-2">{MEALS.map((m) => <Chip key={m} on={f.meals.includes(m)} onClick={() => toggle("meals", m)}>{m}</Chip>)}</div></div>
              </div>
              <p className="label mt-5">กินเฉพาะบางวัน (ไม่เลือก = กินทุกวัน)</p>
              <div className="flex flex-wrap gap-2">{DAYS.map((x) => <Chip key={x} on={f.days.includes(x)} onClick={() => toggle("days", x)}>{x}</Chip>)}</div>
            </div>
          )}
          <div>
            <p className="label">คำเตือน / ข้อควรระวังจากฉลากยา (ถ้ามี)</p>
            <div className="mb-2 flex flex-wrap gap-2">{f.warn.length ? f.warn.map((w) => <button type="button" key={w} onClick={() => toggle("warn", w)} className="rounded-full bg-red-50 px-3 py-1 text-xs text-red-700">{w} ×</button>) : <span className="text-sm text-gold-500">ยังไม่มีคำเตือน</span>}</div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (tag.trim() && !f.warn.includes(tag.trim())) setF({ ...f, warn: [...f.warn, tag.trim()] }); setTag(""); }}>
              <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="พิมพ์คำเตือนใหม่แล้วกด Enter..." /><button className="btn-soft shrink-0">เพิ่ม</button>
            </form>
            <div className="mt-2 flex flex-wrap gap-2">{WARN_SUGGEST.filter((w) => !f.warn.includes(w)).map((w) => <button type="button" key={w} onClick={() => toggle("warn", w)} className="rounded-full border border-cream-300 px-3 py-1 text-xs text-gold-600">+ {w}</button>)}</div>
          </div>
          {f.src === "central" ? null : liquid ? <div className="form-grid">
            <Field label="ขนาดบรรจุต่อขวด (ml)" required><input type="number" min="1" value={f.size} placeholder="เช่น 1000" onChange={(e) => setF({ ...f, size: e.target.value })} /></Field>
            <Field label="จำนวนขวดที่รับมา" required><input type="number" min="1" value={f.bottles} onChange={(e) => setF({ ...f, bottles: e.target.value })} /></Field>
            {Number(f.size) > 0 && Number(f.bottles) > 0 && <p className="text-sm text-gold-700 md:col-span-2">สต็อกรวม <b>{(Number(f.size) * Number(f.bottles)).toLocaleString("en-US")} ml</b>{Number(f.dose) > 0 ? ` · ให้ครั้งละ ${f.dose} ml ${f.meals.length} มื้อ/วัน ใช้ได้ประมาณ ${Math.floor((Number(f.size) * Number(f.bottles)) / (Number(f.dose) * Math.max(1, f.meals.length)))} วัน` : ""}</p>}
          </div> : <div className="form-grid">
            <Field label="จำนวนที่รับมาทั้งหมด (สต็อก)" required><input type="number" min="0" value={f.stock} onChange={(e) => setF({ ...f, stock: e.target.value })} /></Field>
            <Field label="หน่วย"><input value={f.unit} placeholder="หน่วย" onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
          </div>}
          <div className="flex flex-wrap gap-2">
            <Chip on={f.fridge} onClick={() => setF({ ...f, fridge: !f.fridge })}>ต้องเก็บในตู้เย็น</Chip>
            <Chip on={f.hold} onClick={() => setF({ ...f, hold: !f.hold })}>งดยาชั่วคราว (Hold)</Chip>
          </div>
        </div>
      </Modal>

      <Modal open={!!refill} title={refill ? `เติมจากคลังกลาง · ${refill.x.name}` : ""} onClose={() => setRefill(null)}
        footer={<><button className="btn-soft" onClick={() => setRefill(null)}>ยกเลิก</button><button className="btn-primary" disabled={busy} onClick={saveRefill}>เบิกและเติมเข้าตะกร้า</button></>}>
        {refill && <div className="space-y-4">
          <p className="text-sm text-gold-700">{refill.x.who} · คงเหลือในตะกร้า <b>{stockText(refill.x)}</b></p>
          <Field label={`จำนวนที่เติม (${refill.x.unit})`} required><input type="number" min="0" value={refill.qty} onChange={(e) => setRefill({ ...refill, qty: e.target.value })} placeholder="เช่น 30" autoFocus /></Field>
          <p className="text-xs text-gold-600">หักจากคลังกลางของสาขา · ขึ้นค่ายารอเรียกเก็บที่การเงิน (ถ้ายาตั้งราคาไว้)</p>
        </div>}
      </Modal>

      <Modal open={!!edit} wide title={edit ? `แก้ไขยา · ${edit.name}` : ""} onClose={() => setEdit(null)}
        footer={<><button className="btn-soft" onClick={() => setEdit(null)}>ยกเลิก</button><button className="btn-primary" onClick={saveEdit}>บันทึกการแก้ไข</button></>}>
        {edit && <div className="space-y-5">
          <p className="rounded-xl bg-cream-50 px-4 py-3 text-sm text-gold-700">{edit.who} · คงเหลือ <b>{stockText(edit)}</b> · แก้คงเหลือได้ที่เมนู นับยาคงเหลือ</p>
          <div className="form-grid">
            <Field label="ชื่อยา" required><input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="สรรพคุณ / ข้อบ่งใช้"><input value={edit.use} onChange={(e) => setEdit({ ...edit, use: e.target.value })} /></Field>
            <Field label="วิธีทานตามฉลาก"><input value={edit.how} onChange={(e) => setEdit({ ...edit, how: e.target.value })} placeholder="เช่น ครั้งละ 20 ml ก่อนนอน" /></Field>
            <Field label="กินก่อนหรือหลังอาหาร"><Select options={TIMINGS} value={edit.timing} onChange={(v) => setEdit({ ...edit, timing: v || TIMINGS[0] })} /></Field>
            <Field label="เก็บยาไว้ที่"><Select options={STORES} value={edit.fridge ? "ตู้เย็น" : edit.store} onChange={(v) => setEdit({ ...edit, store: v || STORES[0], fridge: v === "ตู้เย็น" })} /></Field>
          </div>
          {/* ยาหนึ่งตัว หนึ่งทาง: จัดตามมื้อ (เมนูจัดยาตามมื้อ) หรือ เบิกตามใช้ (เมนูเบิกยาตามใช้) */}
          <div className="space-y-2">
            <p className="label">ยานี้ให้แบบไหน</p>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="ทางของยา">
              {[{ use: false, t: "กินตามมื้อ", d: "มีมื้อประจำ · ขึ้นในรายการให้ยาของมื้อนั้น (KinApp และเมนูเบิกยา) · ระบบเตือนมื้อที่ยังไม่ให้", c: "border-sky-500 bg-sky-50" },
                { use: true, t: "ใช้เมื่อจำเป็น", d: "ยาขวด ยาทา ยาพ่น ยาตามอาการ · ไม่มีมื้อประจำ · เบิกเมื่อใช้ที่เมนูเบิกยา", c: "border-amber-500 bg-amber-50" }].map((o) => {
                const on = isUseDrug(edit) === o.use;
                return <button key={o.t} type="button" role="radio" aria-checked={on} onClick={() => setEdit({ ...edit, bulk: o.use })}
                  className={`rounded-xl border-2 px-4 py-3 text-left transition ${on ? o.c : "border-cream-300 bg-white hover:border-gold-300"}`}><b className="block text-sm text-gold-900">{on ? "✓ " : ""}{o.t}</b><small className="text-xs text-gold-600">{o.d}</small></button>;
              })}
            </div>
            {!edit.bulk && !edit.meals.length && <p className="field-hint">กินตามมื้อต้องเลือกมื้อยาด้านล่างอย่างน้อย 1 มื้อ</p>}
          </div>
          {edit.bulk && (
            <Field label={`ใช้ครั้งละ (ค่าเริ่มต้นตอนเบิก)`}><div className="flex max-w-xs items-center gap-2"><input type="number" min={0} step={isLiquid(edit) ? "1" : "0.5"} value={edit.doseText} onChange={(e) => setEdit({ ...edit, doseText: e.target.value })} /><span className="shrink-0 text-sm text-gold-600">{edit.unit}</span></div></Field>
          )}
          {!edit.bulk && (
            <div className="rounded-2xl border border-cream-300 p-4">
              <p className="mb-3 font-medium text-gold-800">มื้อและขนาดยา</p>
              <div className="form-grid">
                <Field label={isLiquid(edit) ? "ให้ครั้งละ (ml)" : "กินครั้งละ (Dose)"}><div className="flex items-center gap-2"><input type="number" min={isLiquid(edit) ? "1" : "0.5"} step={isLiquid(edit) ? "1" : "0.5"} value={edit.doseText} onChange={(e) => setEdit({ ...edit, doseText: e.target.value })} /><span className="shrink-0 text-sm text-gold-600">{edit.unit}</span></div>
                  {Number(edit.doseText) !== edit.dose && Number(edit.doseText) > 0 && <p className="field-hint is-ok">เดิม {edit.dose} {edit.unit} → ใหม่ {edit.doseText} {edit.unit}</p>}</Field>
                <div><p className="label">กินมื้อไหนบ้าง</p><div className="flex flex-wrap gap-2">{MEALS.map((m) => <Chip key={m} on={edit.meals.includes(m)} onClick={() => toggleEdit("meals", m)}>{m}</Chip>)}</div></div>
              </div>
              <p className="label mt-5">กินเฉพาะบางวัน (ไม่เลือก = กินทุกวัน)</p>
              <div className="flex flex-wrap gap-2">{DAYS.map((x) => <Chip key={x} on={edit.days.includes(x)} onClick={() => toggleEdit("days", x)}>{x}</Chip>)}</div>
            </div>
          )}
          <div>
            <p className="label">คำเตือน / ข้อควรระวัง</p>
            <div className="mb-2 flex flex-wrap gap-2">{edit.warn.length ? edit.warn.map((w) => <button type="button" key={w} onClick={() => toggleEdit("warn", w)} className="rounded-full bg-red-50 px-3 py-1 text-xs text-red-700">{w} ×</button>) : <span className="text-sm text-gold-500">ไม่มีคำเตือน</span>}</div>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const t = edit.tag.trim(); setEdit({ ...edit, tag: "", warn: t && !edit.warn.includes(t) ? [...edit.warn, t] : edit.warn }); }}>
              <input value={edit.tag} onChange={(e) => setEdit({ ...edit, tag: e.target.value })} placeholder="พิมพ์คำเตือนใหม่แล้วกด Enter..." /><button className="btn-soft shrink-0">เพิ่ม</button>
            </form>
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip on={edit.hold} onClick={() => setEdit({ ...edit, hold: !edit.hold })}>งดยาชั่วคราว (Hold)</Chip>
          </div>
        </div>}
      </Modal>

      <MedPhotoModal open={!!label} title={label ? `รูปฉลากยา · ${label.name}` : ""} items={label ? [{ kind: "label", id: label.id, title: `${label.name} · ${label.who}` }] : []} onClose={() => setLabel(null)} />
      <Modal open={!!view} title={view?.name ?? ""} onClose={() => setView(null)} footer={<>
        {/* ลบ/แก้ไขจากหน้ารายละเอียดได้ด้วย (มือถือไม่มีเมนู ⋯ ในการ์ดแบบกลุ่มตามคน) */}
        {view && <button className="btn-danger mr-auto" onClick={() => { const v = view; setView(null); confirm({ title: "ลบยาออกจากตะกร้า", message: `ต้องการลบ ${v.name} ของ ${v.who} ใช่หรือไม่`, danger: true, okLabel: "ลบ", onOk: () => { setDrugs(drugs.filter((x) => x.id !== v.id)); toast("ลบยาแล้ว"); } }); }}>ลบ</button>}
        {view && <button className="btn-soft" onClick={() => { const v = view; setView(null); setEdit({ ...v, doseText: String(v.dose), tag: "" }); }}>แก้ไข</button>}
        <button className="btn-soft" onClick={() => { setLabel(view); setView(null); }}>ดูรูปฉลากยา</button><button className="btn-primary" onClick={() => setView(null)}>ปิดหน้าต่าง</button></>}>
        {view && <dl className="space-y-3 text-sm">{[
          ["ผู้สูงอายุ", view.who], ["สรรพคุณ/ข้อบ่งใช้", view.use || "-"], ["วิธีทาน", view.how || "-"], ["รูปแบบยา", view.form], ["แหล่งเก็บ", view.store],
          ["มื้อยา", view.bulk ? "ยาขวด / ไม่แพ็คซอง" : `${view.meals.join(", ")} · ครั้งละ ${view.dose} ${view.unit}`], ["วันกิน", view.days.length ? view.days.join(" ") : "ทุกวัน"],
          ["ที่มา", view.src === CENTRAL ? "เบิกจากคลังกลางของศูนย์ (คิดเงินแล้ว)" : "ญาตินำมา / จากโรงพยาบาล"], ["คำเตือน", view.warn.join(", ") || "-"], ["ยอดคงเหลือ (สต็อก)", stockText(view)], ["สถานะ", view.hold ? "งดยาชั่วคราว (Hold)" : view.status],
        ].map(([k, v]) => <div key={k} className="flex justify-between gap-4 border-b border-cream-200 pb-2"><dt className="shrink-0 text-gold-500">{k}</dt><dd className="text-right font-medium">{v}</dd></div>)}</dl>}
      </Modal>
    </>
  );
}

/* ---------- เคลียร์คลังยา ---------- */
/** ตัวย่อชื่อ 2 ตัว (ตัดคำนำหน้า ข้ามสระนำ เ แ โ ใ ไ) เช่น นายหมา กินดี → หก */
const initialsOf = (name: string) => name.replace(/^(คุณ|นางสาว|นาย|นาง)\s*/, "").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p.replace(/^[เแโใไ]/, "").charAt(0)).join("") || name.charAt(0);
function Audit({ drugs, setDrugs }: { drugs: Drug[]; setDrugs: (x: Drug[]) => void }) {
  const RESIDENTS = useNames();
  const { toast } = useApp();
  const [who, setWho] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [count, setCount] = useState(0);
  const [status, setStatus] = useState(AUDIT_STATUS[0]);
  const [done, setDone] = useState<number[]>([]);
  const total = drugs.length;
  const list = who ? drugs.filter((x) => x.who === who) : [];
  const cur = list[idx];
  // รายชื่อ: มียา (เริ่มต้น) · ยังไม่นับ · ทุกคน · เรียงคนที่ยังไม่นับก่อน แล้วตามห้อง
  const { residents: aLive } = useResidents();
  const roomOfA = (w: string) => { const r = aLive.find((x) => x.full_name === w)?.room; return r && r !== "-" ? `ห้อง ${r}` : ""; };
  const [af, setAf] = useState<"has" | "todo" | "all">("has");
  const aPeople = RESIDENTS.map((w) => { const mine = drugs.filter((x) => x.who === w); return { w, n: mine.length, ok: mine.filter((x) => done.includes(x.id)).length }; });
  const aCount = { has: aPeople.filter((p) => p.n).length, todo: aPeople.filter((p) => p.n && p.ok < p.n).length, all: aPeople.length };
  const aShown = aPeople.filter((p) => af === "all" || (af === "has" ? p.n > 0 : p.n > 0 && p.ok < p.n))
    .sort((a, b) => Number(b.n > 0 && b.ok < b.n) - Number(a.n > 0 && a.ok < a.n) || Number(b.n > 0) - Number(a.n > 0) || roomOfA(a.w).localeCompare(roomOfA(b.w), "th", { numeric: true }) || a.w.localeCompare(b.w, "th"));
  useEffect(() => { if (cur) { setCount(cur.stock); setStatus(cur.status); } }, [cur?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (who && cur) {
    const next = () => {
      setDrugs(drugs.map((x) => (x.id === cur.id ? { ...x, stock: count, status } : x)));
      setDone(Array.from(new Set([...done, cur.id])));
      if (idx + 1 < list.length) setIdx(idx + 1); else { setWho(null); toast(`นับยาครบทุกตัวแล้ว · ${who}`); }
    };
    return (
      <div className="mx-auto max-w-xl">
        <button className="btn-soft mb-5" onClick={() => setWho(null)}><Icon name="chevron" className="h-4 w-4 rotate-90" /> กลับไปหน้าหลัก</button>
        <section className="card p-6">
          <div className="flex items-center justify-between gap-3 text-sm text-gold-600"><span className="truncate">{who}</span><span className="shrink-0 rounded-full bg-cream-100 px-3 py-1">{idx + 1}/{list.length}</span></div>
          <h2 className="mt-5 text-2xl font-medium text-gold-900">{cur.name}</h2>
          <p className="text-sm text-gold-600">{cur.how || "-"}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-cream-50 p-3"><dt className="text-gold-500">แหล่งเก็บ</dt><dd className="font-medium">{cur.store}</dd></div>
            <div className="rounded-xl bg-cream-50 p-3"><dt className="text-gold-500">ยอดคงเหลือในระบบ</dt><dd className="font-medium">{cur.stock} {cur.unit}</dd></div>
          </dl>
          <p className="mt-6 text-center text-sm font-medium text-gold-700">นับได้จริงเท่าไร <span className="block text-xs font-normal text-gold-500">(ไม่รวมยาที่จัดใส่ซองไปแล้ว)</span></p>
          {/* พิมพ์ตัวเลขได้ตรง ๆ · ยาน้ำ (ml) ปุ่ม −/+ ทีละ 10 และมีปุ่มขวดเต็ม */}
          <div className="mt-3 flex items-center justify-center gap-3">
            <button className="icon-button !h-14 !w-14 text-2xl" aria-label={`ลด ${isLiquid(cur) ? 10 : 1}`} onClick={() => setCount(Math.max(0, Math.round((count - (isLiquid(cur) ? 10 : 1)) * 100) / 100))}>−</button>
            <input type="number" inputMode="decimal" aria-label="จำนวนที่นับได้" className="!w-32 text-center !text-2xl font-semibold" value={count} onFocus={(e) => e.target.select()} onChange={(e) => setCount(Math.max(0, Number(e.target.value) || 0))} />
            <button className="icon-button !h-14 !w-14 text-2xl" aria-label={`เพิ่ม ${isLiquid(cur) ? 10 : 1}`} onClick={() => setCount(Math.round((count + (isLiquid(cur) ? 10 : 1)) * 100) / 100)}>+</button>
          </div>
          <p className="mt-1 text-center text-xs text-gold-500">{cur.unit} · แตะช่องแล้วพิมพ์ตัวเลขได้เลย</p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {isLiquid(cur) ? <>
              <button className="btn-soft !px-2 text-xs" onClick={() => setCount(cur.pack || 1000)}>ขวดเต็ม ({(cur.pack || 1000).toLocaleString("en-US")} ml)</button>
              <button className="btn-soft !px-2 text-xs" onClick={() => setCount(0)}>หมด (0)</button>
            </> : <>
              <button className="btn-soft !px-2 text-xs" onClick={() => setCount(count + 10)}>+1 แผง (10)</button>
              <button className="btn-soft !px-2 text-xs" onClick={() => setCount(count + 30)}>+1 กล่อง (30)</button>
            </>}
            <button className="btn-soft !px-2 text-xs" onClick={() => setCount(cur.stock)}>ตรงกับระบบ</button>
          </div>
          <p className={`mt-3 rounded-xl px-3 py-2 text-center text-sm ${count === cur.stock ? "bg-cream-50 text-gold-600" : count > cur.stock ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
            {count === cur.stock ? "ตรงกับในระบบ" : `${count > cur.stock ? "มากกว่า" : "น้อยกว่า"}ในระบบ ${Math.abs(Math.round((count - cur.stock) * 100) / 100).toLocaleString("en-US")} ${cur.unit} · บันทึกแล้วคงเหลือเป็น ${count.toLocaleString("en-US")} ${cur.unit}`}</p>
          <p className="label mt-6">สถานะยา (อัปเดตหากพบปัญหา)</p>
          <div className="grid grid-cols-2 gap-2">{AUDIT_STATUS.map((s) => <Chip key={s} on={status === s} onClick={() => setStatus(s)}>{s}</Chip>)}</div>
          <button className="btn-primary mt-6 w-full" onClick={next}>บันทึก & ถัดไป <Icon name="arrow" className="h-4 w-4" /></button>
        </section>
      </div>
    );
  }
  return (
    <>
      <PageHeader title="นับยาคงเหลือ" sub="นับยาจริงในตะกร้าของผู้ป่วย แล้วแก้ตัวเลขในระบบให้ตรง · ควรนับสัปดาห์ละครั้ง" />
      <Section title="ความคืบหน้าวันนี้">
        <div className="flex items-center justify-between text-sm text-gold-600"><span>ตรวจแล้ว {done.length} / {total} รายการ</span><b className="text-gold-700">{total ? Math.round((done.length / total) * 100) : 0}%</b></div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-cream-200"><div className="h-full rounded-full bg-gold-600 transition-all" style={{ width: `${total ? (done.length / total) * 100 : 0}%` }} /></div>
      </Section>
      {/* รายชื่อแถวละคน · ซ่อนคนที่ไม่มียา (ตัวกรอง มียา · ยังไม่นับ · ทุกคน) */}
      <div className="mb-3 mt-6 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[17px] font-medium text-gold-800">เลือกผู้รับบริการเพื่อนับยา</h2>
        <div className="mr-chips" role="group" aria-label="กรองรายชื่อ">{([["has", "มียา"], ["todo", "ยังไม่นับ"], ["all", "ทุกคน"]] as const).map(([k, l]) =>
          <button key={k} type="button" aria-pressed={af === k} onClick={() => setAf(k)}>{l} <b>{aCount[k]}</b></button>)}</div>
      </div>
      {af !== "all" && aCount.all > aCount.has && <p className="mb-2 text-xs text-gold-500">ซ่อน {aCount.all - aCount.has} คนที่ไม่มียา · กด “ทุกคน” เพื่อดู</p>}
      {!aShown.length ? <p className="card px-4 py-6 text-center text-sm text-gold-500">{af === "todo" ? "นับยาครบทุกคนแล้ว" : "ยังไม่มีผู้ป่วยที่มียา"}</p> : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {aShown.map((p) => (
            <button key={p.w} type="button" disabled={!p.n} onClick={() => { setWho(p.w); setIdx(0); }} className="card flex min-w-0 items-center gap-3 px-3 py-2.5 text-left transition hover:border-gold-300 disabled:opacity-50">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cream-100 text-sm font-semibold text-gold-700">{initialsOf(p.w)}</span>
              <span className="min-w-0 flex-1"><b className="block truncate text-[15px] font-medium text-gold-900">{p.w}</b><small className="block text-xs text-gold-500">{[roomOfA(p.w), `ยา ${p.n} รายการ`].filter(Boolean).join(" · ")}</small></span>
              {p.n > 0 && (p.ok === p.n ? <StatusBadge value="ตรวจแล้ว" /> : <StatusBadge value={`รอตรวจ ${p.n - p.ok}`} />)}
              {p.n > 0 && <Icon name="chevron" className="h-4 w-4 shrink-0 -rotate-90 text-gold-400" />}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/* ---------- ซองมื้อยา ---------- */
function Templates({ drugs, setDrugs }: { drugs: Drug[]; setDrugs: (x: Drug[]) => void }) {
  const RESIDENTS = useNames();
  const { toast } = useApp();
  const [who, setWho] = useState("");
  const date = iso();
  const mine = drugs.filter((x) => x.who === who);
  const { residents: tLive } = useResidents();
  const withMeds = RESIDENTS.map((w) => {
    const ms = drugs.filter((x) => x.who === w && !x.hold), r = tLive.find((x) => x.full_name === w)?.room;
    return { w, mine: ms, room: r && r !== "-" ? `ห้อง ${r}` : "", meals: [...MEALS.filter((m) => ms.some((x) => !x.bulk && x.meals.includes(m))).map((m) => (m === "ก่อนนอน" ? "นอน" : m === "กลางวัน" ? "เที่ยง" : m)), ...(ms.some(isUseDrug) ? ["ตามอาการ"] : [])] };
  }).filter((p) => p.mine.length);
  return (
    <>
      <PageHeader title="ยาแต่ละมื้อของผู้ป่วย" sub="ดูว่าแต่ละคนกินยาอะไรมื้อไหน · งดยาชั่วคราวได้จากหน้านี้" />
      <div className="card mb-6 p-5"><Field label="เลือกผู้สูงอายุ"><ResidentPicker names={RESIDENTS} value={who} onChange={setWho} /></Field></div>
      {/* ยังไม่เลือก: รายชื่อคนที่มียา (จำนวนยา · มื้อที่กิน) กดเลือกได้เลย */}
      {!who ? (!withMeds.length ? <div className="card empty-state"><Icon name="files" /><p>ยังไม่มีผู้ป่วยที่มียาในระบบ</p></div> : <>
        <p className="mb-2 text-sm text-gold-600">ผู้ป่วยที่มียา {withMeds.length} คน · กดเพื่อดูยาแต่ละมื้อ</p>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{withMeds.map((p) => (
          <button key={p.w} type="button" onClick={() => setWho(p.w)} className="card flex min-w-0 items-center gap-3 px-3 py-2.5 text-left transition hover:border-gold-300">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cream-100 text-sm font-semibold text-gold-700">{initialsOf(p.w)}</span>
            <span className="min-w-0 flex-1"><b className="block truncate text-[15px] font-medium text-gold-900">{p.w}</b><small className="block text-xs text-gold-500">{[p.room, `ยา ${p.mine.length} รายการ`].filter(Boolean).join(" · ")}</small></span>
            <span className="flex shrink-0 flex-wrap justify-end gap-1">{p.meals.map((m) => <i key={m} className="rounded-md bg-gold-100 px-1.5 text-[11px] font-semibold not-italic text-gold-700">{m}</i>)}</span>
            <Icon name="chevron" className="h-4 w-4 shrink-0 -rotate-90 text-gold-400" />
          </button>))}</div>
      </>) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {MEALS.map((m) => {
            const list = mine.filter((x) => !x.bulk && x.meals.includes(m));
            return (
              <section key={m} className="card min-w-0 p-5">
                <div className="flex items-center justify-between"><h3 className="text-lg font-medium text-gold-800">ซอง{m}</h3><span className="text-xs text-gold-500">{list.length} รายการ</span></div>
                {list.length === 0 ? <p className="mt-4 text-sm text-gold-500">ไม่มียาในมื้อนี้</p> : (
                  <ul className="mt-3 space-y-2">{list.map((x) => (
                    <li key={x.id} className="rounded-xl border border-cream-200 p-3 text-sm">
                      <div className="flex items-start justify-between gap-2"><b className="min-w-0 font-medium">{x.name}</b><span className="shrink-0 text-gold-700">{x.dose} {x.unit}</span></div>
                      <p className="text-xs text-gold-500">{x.days.length ? `เฉพาะ ${x.days.join(" ")}` : "ทุกวัน"}{drugsFor(drugs, who, m, date).some((y) => y.id === x.id) ? " · จัดวันนี้" : " · ไม่จัดวันนี้"}</p>
                      <button className="mt-2 text-xs text-gold-600 underline-offset-2 hover:underline" onClick={() => { setDrugs(drugs.map((y) => (y.id === x.id ? { ...y, hold: !y.hold } : y))); toast(x.hold ? "ยกเลิกงดยาแล้ว" : "งดยาชั่วคราว (Hold) แล้ว"); }}>{x.hold ? "ยกเลิกงดยา" : "งดยาชั่วคราว (Hold)"}</button>
                    </li>
                  ))}</ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

/* ---------- ฐานข้อมูลยา ---------- */
function Master({ master, setMaster, drugs }: { master: string[][]; setMaster: (x: string[][]) => void; drugs: Drug[] }) {
  // ยอดจากตะกร้ายาของผู้ป่วยทุกคน: ชื่อตรงกัน หรือขึ้นต้นด้วยชื่อในฐานข้อมูล (เช่น "Lactulose syrup (ทดสอบ)")
  const usersOf = (name: string) => drugs.filter((x) => x.name.toLowerCase().startsWith(name.toLowerCase()));
  const [open2, setOpen2] = useState<string | null>(null);
  const rows = master.map((m) => {
    const list = usersOf(m[0]);
    const known = list.filter((x) => x.received !== undefined && x.received !== null);
    return [m[0], m[1] || "-", list.length ? `${new Set(list.map((x) => x.who)).size} คน` : "-", list.length ? sumByUnit(list.map((x) => ({ n: x.stock, unit: x.unit }))) : "-",
      known.length ? `${sumByUnit(known.map((x) => ({ n: Math.max(0, (x.received ?? 0) - x.stock), unit: x.unit })))} จาก ${sumByUnit(known.map((x) => ({ n: x.received ?? 0, unit: x.unit })))}` : "-"];
  });
  const { toast, confirm } = useApp();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [use, setUse] = useState("");
  return (
    <>
      <PageHeader title="รายชื่อยา" sub="รายชื่อยาที่ใช้ค้นหาตอนเพิ่มยาใหม่ของผู้ป่วย" actions={<button className="btn-primary" onClick={() => { setName(""); setUse(""); setOpen(true); }}><Icon name="plus" className="h-4 w-4" /> เพิ่มยาตัวใหม่</button>} />
      <Section title="รายชื่อยาทั้งหมด">
        <DataTable columns={["ชื่อยา", "สรรพคุณ / การออกฤทธิ์", "ผู้ป่วยที่ใช้", "คงเหลือรวม", "ใช้ไปแล้ว"]} rows={rows}
          onRow={(i) => setOpen2(master[i][0])} rowLabel="กดเพื่อดูคงเหลือรายคน"
          actions={[{ label: "ดูรายคน", hidden: (i) => !usersOf(master[i][0]).length, onClick: (i) => setOpen2(master[i][0]) },{ label: "ลบ", more: true, danger: true, onClick: (i) => confirm({ title: "ลบยาจากฐานข้อมูล", message: `ต้องการลบ ${master[i][0]} ใช่หรือไม่`, danger: true, okLabel: "ลบ", onOk: () => { setMaster(master.filter((_, j) => j !== i)); toast("ลบแล้ว"); } }) }]} />
      </Section>
      <Modal open={!!open2} wide title={open2 ? `คงเหลือรายคน · ${open2}` : ""} onClose={() => setOpen2(null)} footer={<button className="btn-primary" onClick={() => setOpen2(null)}>ปิด</button>}>
        {open2 && <DataTable search={false} empty="ยังไม่มีผู้ป่วยใช้ยานี้" columns={["ผู้ป่วย", "ชื่อยาในตะกร้า", "รับเข้า", "ใช้ไปแล้ว", "คงเหลือ", "ใช้ได้อีก"]}
          rows={usersOf(open2).map((x) => [x.who, x.name, x.received ? `${x.received.toLocaleString("en-US")} ${x.unit}` : "ไม่ทราบ", x.received ? `${Math.max(0, x.received - x.stock).toLocaleString("en-US")} ${x.unit}` : "-", stockText(x), daysLeft(x) === null ? "-" : `${daysLeft(x)} วัน`])} />}
      </Modal>
      <Modal open={open} title="เพิ่มฐานข้อมูลยาใหม่" onClose={() => setOpen(false)} footer={<><button className="btn-soft" onClick={() => setOpen(false)}>ยกเลิก</button><button className="btn-primary" onClick={() => {
        if (!name.trim()) return toast("กรุณากรอกชื่อยา");
        if (master.some((x) => x[0].toLowerCase() === name.trim().toLowerCase())) return toast("มียานี้ในฐานข้อมูลแล้ว");
        setMaster([[name.trim(), use], ...master]); setOpen(false); toast(`เพิ่มยาในฐานข้อมูลแล้ว · ${name.trim()}`);
      }}>บันทึกข้อมูล</button></>}>
        <div className="space-y-4">
          <Field label="ชื่อยา (Drug Name)" required><input value={name} placeholder="เช่น Atorvastatin 40mg" onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="สรรพคุณ / การออกฤทธิ์ (Properties)"><input value={use} placeholder="เช่น ยาลดไขมันในเลือด" onChange={(e) => setUse(e.target.value)} /></Field>
        </div>
      </Modal>
    </>
  );
}

/* ---------- รายงานการจัดยา ---------- */
function Report({ packs }: { packs: Pack[] }) {
  const RESIDENTS = useNames();
  const [who, setWho] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState({ who: "", from: "", to: "", status: "" });
  const cols = ["วันกินยา", "ชื่อผู้รับบริการ", "มื้อยา", "รายการยา", "จัดโดย", "ตรวจ QA โดย", "ผู้ให้ยา", "เวลาที่ให้ยา", "สถานะ"];
  const rows = useMemo(() => packs
    .filter((p) => (!q.who || p.who === q.who) && (!q.from || p.date >= q.from) && (!q.to || p.date <= q.to) && (!q.status || (q.status === "ให้ยาแล้ว") === p.given))
    .map((p) => [thai(p.date), p.who, p.meal, p.items.join(", "), p.by || "-", p.qby || "-", p.gby || "-", p.gat || "-", p.given ? "ให้ยาแล้ว" : "ยังไม่ให้"]), [packs, q]);
  return (
    <>
      <PageHeader title="ซองยาระบบเดิม" sub="ซองยาที่จัดก่อนเปลี่ยนมาให้ยาแบบใหม่ ดูย้อนหลังได้อย่างเดียว · การให้ยาแบบใหม่ดูที่ ประวัติผู้รับบริการ › ยาและการให้ยา"
        actions={<><button className="btn-soft" onClick={() => downloadCsv("รายงานการจัดยา", cols, rows)}><CsvIcon /> ส่งออก CSV</button><button className="btn-primary" onClick={() => window.print()}><Icon name="print" className="h-4 w-4" /> พิมพ์รายงานจัดยา (A4)</button></>} />
      <form className="card mb-6 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-[1.3fr_1.4fr_1fr_auto] lg:items-end" onSubmit={(e) => { e.preventDefault(); setQ({ who, from, to, status }); }}>
        <Field label="ผู้ป่วย"><Select options={RESIDENTS} placeholder="-- ทั้งหมด --" value={who} onChange={setWho} /></Field>
        {/* ช่วงวันกินยา: ปุ่มปฏิทินแบบเดียวกับทุกหน้า (วว/ดด/ปปปป · ปุ่มลัด) · เลือกแล้วกรองทันที · ✕ = ทุกวัน */}
        <Field label="ช่วงวันกินยา"><RangePicker from={from || `${iso().slice(0, 7)}-01`} to={to || iso()} active={!!from} label={from ? undefined : "ทุกวัน · เลือกช่วงวันที่"}
          onChange={(a, b) => { setFrom(a); setTo(b); setQ({ who, from: a, to: b, status }); }}
          onClear={() => { setFrom(""); setTo(""); setQ({ who, from: "", to: "", status }); }} /></Field>
        <Field label="สถานะ"><Select options={["ยังไม่ให้", "ให้ยาแล้ว"]} placeholder="-- ทั้งหมด --" value={status} onChange={setStatus} /></Field>
        <button className="btn-primary sm:col-span-2 lg:col-span-1"><Icon name="search" className="h-4 w-4" /> ค้นหา</button>
      </form>
      <Section title="ซองยาที่จัดไว้" sub="ระบบเดิม">
        <DataTable columns={cols} rows={rows} empty="ไม่มีซองยาระบบเดิมในช่วงนี้" />
      </Section>
    </>
  );
}

/* ---------- คู่มือ ---------- */
function Manual() {
  const parts = [
    ["1. รับยาเข้า (ยาของผู้ป่วย › เพิ่มยาใหม่)", "เลือกว่ายาของใคร และได้มาจากไหน (ญาติหรือโรงพยาบาลนำมา หรือเบิกจากคลังกลางของศูนย์) ถ่ายรูปฉลาก แล้วกรอกชื่อยา วิธีใช้ จำนวนที่ได้มา · ยาที่กินเป็นมื้อ เลือกมื้อและขนาดต่อครั้ง · ยาขวด ยาทา ยาพ่น หรือยาที่ให้เมื่อมีอาการ ติ๊ก \"ยานี้ไม่ได้กินเป็นมื้อ\" · ยาที่กินเฉพาะบางวัน เลือกวันไว้ด้วย"],
    ["2. ให้ยาตามมื้อ (KinApp › แท็บให้ยา)", "เลือกมื้อ จะเห็นทุกคนที่ต้องกินยามื้อนั้นเรียงตามห้อง กด \"ให้ยา\" ที่คน ยาทุกรายการติ๊กไว้แล้ว (ให้ยาครบ n รายการ) · ตัวไหนไม่ได้ให้ เอาติ๊กออก แล้วเลือกเหตุผล (ปฏิเสธยา หลับอยู่ งดน้ำงดอาหาร ยาหมด อื่น ๆ) · ติ๊ก \"ตรวจชื่อผู้ป่วยและยาแล้ว\" แล้วกดบันทึก ระบบตัดคงเหลือเฉพาะยาที่ให้ และเก็บเป็นบันทึกการให้ยา"],
    ["3. เบิกยา (KINmed › เบิกยา)", "หน้าเดียวกันสำหรับห้องยาและพยาบาลที่ใช้คอมพิวเตอร์ เลือกผู้ป่วย จะเห็นยาทุกตัว ยาตามมื้อบอกว่ามื้อไหนให้แล้ว มื้อไหนยังไม่ให้ · ใส่จำนวน เลือกมื้อหรือตามอาการ ติ๊ก \"ตรวจชื่อผู้ป่วยและยาแล้ว\" แล้วกดเบิก · ใช้กับยาขวด ยาทา ยาพ่น ยาตามอาการ และยาที่แพทย์สั่งเพิ่มนอกมื้อ"],
    ["4. กันให้ยาซ้ำ", "ถ้าเลือกมื้อที่ให้ไปแล้ว หรือเบิกยาตามอาการซ้ำในวันเดียวกัน ระบบเตือนสีแดงพร้อมเวลาและชื่อคนที่ให้ก่อนหน้า ให้ตรวจก่อนยืนยัน"],
    ["5. ให้ยาผิด หรือกดผิด", "ที่ KINmed › เบิกยา › ให้ยาและเบิกยาของวันที่เลือก กด \"ยกเลิก\" แล้วเลือกเหตุผล ระบบคืนคงเหลือและเก็บรายการไว้ · คนที่บันทึกยกเลิกเองได้ภายใน 24 ชั่วโมง หัวหน้าพยาบาลยกเลิกได้ทุกรายการ"],
    ["6. ดูย้อนหลัง", "ประวัติผู้รับบริการ › ยาและการให้ยา มีบันทึกการให้ยาทุกครั้ง (ให้ / ไม่ได้ให้พร้อมเหตุผล) · ญาติเห็นว่าได้รับยามื้อไหนแล้วในหน้าครอบครัว · ภาพรวมและรายงานมีตัวชี้วัดให้ยาครบ"],
    ["7. นับยาคงเหลือ", "สัปดาห์ละครั้ง นับยาจริงในตะกร้าของผู้ป่วย แล้วพิมพ์ตัวเลขที่นับได้ ระบบบอกว่าต่างจากในระบบเท่าไร ก่อนบันทึก · แก้สถานะยาได้ เช่น ยาหมด ยาหมดอายุ หรือหยุดใช้"],
  ];
  return (
    <>
      <PageHeader title="วิธีใช้งาน" sub="ทำทีละขั้น ตั้งแต่รับยาเข้าจนถึงให้ยา · ไม่มีขั้นจัดซองและตรวจซองแล้ว" />
      <div className="mb-6"><TutorialVideos only={[5, 4]} /></div>
      <div className="grid gap-4 lg:grid-cols-2">{parts.map(([t, p]) => <section key={t} className="card p-6"><h2 className="text-[17px] font-medium text-gold-800">{t}</h2><p className="mt-2 text-sm leading-7 text-gold-600">{p}</p></section>)}</div>
    </>
  );
}

export default function PharmacyApp() {
  const { user, ready, setUser, logout } = useSession();
  if (!ready) return <main className="grid min-h-dvh place-items-center text-sm text-gold-500">กำลังตรวจสอบการเข้าสู่ระบบ…</main>;
  return <AppProvider go={() => {}}>{user && !can(user, "app.pharmacy") ? <CashierOnly user={user} app="pharmacy" onLogout={logout} /> : user ? <App user={user} onLogout={logout} /> : <Login staff onLogin={setUser} />}</AppProvider>;
}
