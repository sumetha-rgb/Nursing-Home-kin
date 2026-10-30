"use client";
import { useEffect, useMemo, useState, createContext, useContext } from "react";
import Image from "next/image";
import Link from "next/link";
import Icon from "@/components/Icon";
import { DataTable, Field, MetricGrid, Modal, PageHeader, PrintLetterhead, Section, Select, StatusBadge, Tabs } from "@/components/ui";
import { AppProvider, useApp } from "@/lib/app";
import { downloadCsv, refreshData, useCrud, useRecords } from "@/lib/store";
import { OfflineBar } from "@/components/Pwa";
import PhotoPicker from "@/components/PhotoPicker";
import TutorialVideos from "@/components/TutorialVideos";
import CashierOnly from "@/components/CashierOnly";
import CentralStock from "@/components/pharmacy/CentralStock";
import { MedPhotoModal, PhotoItem, saveMedPhoto } from "@/components/pharmacy/MedPhotos";
import { stockAlertText, useStockAlerts } from "@/lib/stockAlerts";
import { can } from "@/lib/perms";
import { useResidents } from "@/lib/care";
import Login from "@/components/Login";
import { useSession, SessionUser } from "@/lib/session";

import { nowTh, Drug, Pack, Page, MEALS, DAYS, FORMS, STORES, TIMINGS, AUDIT_STATUS, ERR_5R, WARN_SUGGEST, RESIDENTS as RESIDENTS0, d, DRUGS0, MASTER0, iso, thai, dayOf, drugsFor, isLiquid, stockText, sumByUnit, daysLeft } from "@/lib/pharmacy";

const NAV: { id: Page; label: string; icon: string; group: number }[] = [
  { id: "dashboard", label: "แดชบอร์ด", icon: "grid", group: 0 },
  { id: "dispense", label: "จัดยารายวัน", icon: "pill", group: 0 },
  { id: "qa", label: "ตะกร้ายา & ตรวจสอบ (QA)", icon: "check", group: 0 },
  { id: "central", label: "คลังยากลางของศูนย์", icon: "building", group: 1 },
  { id: "inventory", label: "รับยาเข้าคลัง (ยาผู้ป่วย)", icon: "download", group: 1 },
  { id: "audit", label: "เคลียร์คลังยา", icon: "refresh", group: 1 },
  { id: "templates", label: "ซองมื้อยา", icon: "files", group: 1 },
  { id: "master", label: "ฐานข้อมูลยา", icon: "book", group: 1 },
  { id: "report", label: "รายงานการจัดยา", icon: "table", group: 2 },
  { id: "manual", label: "คู่มือผู้ใช้งาน", icon: "doc", group: 2 },
];
const GROUPS = [{ id: 0, label: "งานประจำวัน", en: "DAILY" }, { id: 1, label: "คลังยา", en: "STOCK" }, { id: 2, label: "รายงาน", en: "REPORT" }];

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

  // เปิดหน้าตาม ?page= เช่น /pharmacy?page=dispense
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("page") as Page | null;
    if (p && NAV.some((n) => n.id === p)) setPage(p);
  }, []);
  const go = (p: Page) => {
    setPage(p); setDrawer(false); window.scrollTo(0, 0);
    window.history.replaceState(null, "", `/pharmacy?page=${p}`);
  };

  const todayNeed = RESIDENTS.flatMap((w) => MEALS.filter((m) => drugsFor(drugs, w, m, today).length).map((m) => ({ w, m })));
  const packedToday = todayNeed.filter(({ w, m }) => packs.some((p) => p.date === today && p.who === w && p.meal === m)).length;
  const low = drugs.filter((x) => !x.hold && x.stock <= (x.bulk ? 1 : x.dose * x.meals.length * 2));
  const waitQa = packs.filter((p) => p.qa === "รอตรวจ").length;
  const current = NAV.find((n) => n.id === page)!;

  const sidebar = (
    <div className="sidebar-inner">
      <Link href="/pharmacy" className="sidebar-brand"><Image src="/logo-mark.png" alt="KIN" width={43} height={34} /><div><span className="sidebar-wordmark">KIN<span>med</span></span><span className="sidebar-brand-caption">ระบบบริหารจัดการยา</span></div></Link>
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
          <button className="btn-primary !min-h-[40px] !px-4 !py-2 text-sm" onClick={() => go("dispense")}><Icon name="pill" className="h-4 w-4" /> จัดยา</button>
        </header>
        <OfflineBar />
        <main className="workspace-main" key={page}>
          <PrintLetterhead title="ระบบบริหารจัดการยา" className="page-letterhead" />
          {page === "dashboard" && <Dashboard go={go} need={todayNeed.length} packed={packedToday} low={low} waitQa={waitQa} />}
          {page === "dispense" && <Dispense drugs={drugs} setDrugs={setDrugs} packs={packs} setPacks={setPacks} go={go} me={user.name} onAddDrug={(w) => { setAddFor(w); go("inventory"); }} />}
          {page === "qa" && <QA packs={packs} setPacks={setPacks} drugs={drugs} go={go} me={user.name} />}
          {page === "inventory" && <Inventory drugs={drugs} setDrugs={setDrugs} master={master} addFor={addFor} onAdded={() => setAddFor(null)} />}
          {page === "central" && <CentralStock />}
          {page === "audit" && <Audit drugs={drugs} setDrugs={setDrugs} />}
          {page === "templates" && <Templates drugs={drugs} setDrugs={setDrugs} />}
          {page === "master" && <Master master={master} setMaster={setMaster} drugs={drugs} />}
          {page === "report" && <Report packs={packs} />}
          {page === "manual" && <Manual />}
        </main>
        <footer className="workspace-footer"><span>KIN MEDCARE</span><span>จัดยาด้วยหลัก 5R เพื่อความปลอดภัยของผู้รับบริการ</span></footer>
      </div>
    </div>
    </NamesCtx.Provider>
  );
}

/* ---------- แดชบอร์ด ---------- */
function Dashboard({ go, need, packed, low, waitQa }: { go: (p: Page) => void; need: number; packed: number; low: Drug[]; waitQa: number }) {
  const { items: stock } = useStockAlerts();
  const steps: { n: string; t: string; staff: string; sys: string; p: Page | "kinapp"; cta: string }[] = [
    { n: "01", t: "รับยาเข้าตะกร้าผู้ป่วย", staff: "ยาที่ญาติหรือโรงพยาบาลนำมา: ถ่ายรูปฉลากแล้วกรอกมื้อยา · ยาของศูนย์: เลือก \"เบิกจากคลังกลาง\"", sys: "สร้างตารางมื้อยาให้เอง เก็บรูปฉลากไว้ตรวจ · ยาคลังกลางหักคลังและขึ้นค่ายาที่การเงินให้", p: "inventory", cta: "ไปที่รับยาเข้าคลัง" },
    { n: "02", t: "จัดยารายวัน", staff: "เลือกผู้ป่วยและมื้อ ติ๊กยาที่หยิบ แล้วถ่ายรูปซองยาที่จัดเสร็จ · ยาน้ำหรือยาขวดกด \"เบิกยาตามจำนวน\"", sys: "หักยาในตะกร้าผู้ป่วย เก็บรูปซอง และส่งซองเข้าตะกร้ารอตรวจ QA", p: "dispense", cta: "ไปที่จัดยารายวัน" },
    { n: "03", t: "ตรวจ QA", staff: "ดูรูปซองเทียบรายการยาและรูปฉลาก ถูกต้องกด \"ตรวจผ่าน\" · ผิดกด \"แจ้งจัดยาผิด\" แล้วกลับไปจัดยา กด \"รีเซต\" เพื่อจัดใหม่", sys: "ซองที่ตรวจผ่านขึ้นคิวจ่ายยาใน KinApp · ซองที่จัดผิดบันทึกเป็น Near Miss", p: "qa", cta: "ไปที่ตะกร้ายา & QA" },
    { n: "04", t: "ให้ยา (KinApp)", staff: "พยาบาลเปิด \"คิวจ่ายยาวันนี้\" ในแอปพยาบาล ให้ยาแล้วกดบันทึก", sys: "บันทึกผู้ให้ยาและเวลา ขึ้นในบันทึกการให้ยา (MAR) ของประวัติผู้ป่วย", p: "kinapp", cta: "เปิด KinApp" },
    { n: "05", t: "เติมยาเมื่อใกล้หมด", staff: "ดูรายการยาผู้ป่วยใกล้หมด · ยาคลังศูนย์กด \"เติมจากคลังกลาง\" · ยาของญาติแจ้งญาตินำมาเพิ่ม", sys: "เตือนยาที่เหลือไม่ถึง 2 วัน และยาคลังกลางที่ถึงจุดสั่งซื้อหรือใกล้หมดอายุ", p: "inventory", cta: "ไปที่รับยาเข้าคลัง" },
    { n: "06", t: "สุ่มนับยา (ทำเป็นครั้งคราว)", staff: "นับยาจริงเทียบกับระบบ แก้ยอดหรือสถานะ เช่น ยาหมด ยาหมดอายุ ยางดใช้", sys: "อัปเดตยอดคงเหลือให้ตรงของจริง", p: "audit", cta: "ไปที่เคลียร์คลังยา" },
  ];
  return (
    <>
      <PageHeader title="แดชบอร์ด & เส้นทางทำงาน" sub="เรียนรู้ขั้นตอนการทำงานและเข้าสู่เมนูต่างๆ ได้ทันที (คลิกที่การ์ดเพื่อไปยังเมนู)" />
      <MetricGrid items={[
        { label: "ซองยาที่ต้องจัดวันนี้", value: need, unit: "ซอง", icon: "pill", accent: true },
        { label: "จัดแล้ววันนี้", value: packed, unit: `/ ${need}`, icon: "check", note: need ? `${Math.round((packed / need) * 100)}% ของทั้งหมด` : undefined },
        { label: "รอตรวจ QA", value: waitQa, unit: "ซอง", icon: "eye" },
        { label: "ยาผู้ป่วยใกล้หมด", value: low.length, unit: "รายการ", icon: "alert", note: "เหลือไม่ถึง 2 วัน" },
      ]} />
      {stock.length > 0 && (
        <button type="button" onClick={() => go("central")} className="card mb-6 flex w-full flex-wrap items-center gap-4 border-amber-200 bg-amber-50/70 p-5 text-left transition hover:border-amber-300">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-800"><Icon name="alert" className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1">
            <b className="block text-gold-900">คลังยากลาง: ใกล้หมด {stock.filter((x) => x.low).length} รายการ · ใกล้หมดอายุ {stock.filter((x) => x.days !== null && x.days <= 60).length} รายการ</b>
            <span className="block truncate text-sm text-gold-600">{stock.slice(0, 3).map((x) => `${x.name} (${stockAlertText(x)})`).join(" · ")}{stock.length > 3 ? ` · และอีก ${stock.length - 3} รายการ` : ""}</span>
          </span>
          <span className="step-link">ไปที่คลังยากลาง<Icon name="arrow" className="h-3.5 w-3.5" /></span>
        </button>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {steps.map((s) => (
          <button key={s.n} onClick={() => (s.p === "kinapp" ? window.location.assign("/staff") : go(s.p))} className="card group flex min-w-0 flex-col p-6 text-left transition hover:-translate-y-0.5 hover:border-gold-300">
            <span className="step-number">{s.n}</span>
            <h2 className="mt-4 text-[17px] font-medium text-gold-800">{s.t}</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div><dt className="inline font-medium text-gold-700">พนักงาน: </dt><dd className="inline text-gold-600">{s.staff}</dd></div>
              <div><dt className="inline font-medium text-gold-700">ระบบ: </dt><dd className="inline text-gold-600">{s.sys}</dd></div>
            </dl>
            <span className="step-link mt-auto pt-4">{s.cta}<Icon name="arrow" className="h-3.5 w-3.5 transition group-hover:translate-x-1" /></span>
          </button>
        ))}
      </div>
      {low.length > 0 && (
        <div className="mt-6"><Section title="ยาใกล้หมด" sub="ยาคลังศูนย์กด &quot;เติมจากคลังกลาง&quot; ที่เมนูรับยาเข้าคลัง · ยาของญาติแจ้งญาตินำมาเพิ่มก่อนรอบจัดยาถัดไป">
          <DataTable columns={["ผู้รับบริการ", "ชื่อยา", "คงเหลือ", "สถานะ"]} rows={low.map((x) => [x.who, x.name, `${x.stock} ${x.unit}`, x.stock === 0 ? "ยาหมด" : "รอเติมยา"])} />
        </Section></div>
      )}
    </>
  );
}

/* ---------- จัดยารายวัน ---------- */
function Dispense({ drugs, setDrugs, packs, setPacks, go, me, onAddDrug }: { drugs: Drug[]; setDrugs: (x: Drug[]) => void; packs: Pack[]; setPacks: (x: Pack[]) => void; go: (p: Page) => void; me: string; onAddDrug: (who: string) => void }) {
  const RESIDENTS = useNames();
  const { toast, confirm } = useApp();
  const [who, setWho] = useState(RESIDENTS[0]);
  useEffect(() => { if (!RESIDENTS.includes(who)) setWho(RESIDENTS[0]); }, [RESIDENTS]); // eslint-disable-line react-hooks/exhaustive-deps
  const [date, setDate] = useState(iso());
  const [meal, setMeal] = useState<string | null>(null);
  const [photo, setPhoto] = useState("");
  const [checked, setChecked] = useState<number[]>([]);
  const [bulk, setBulk] = useState(false);
  const [preview, setPreview] = useState(false);
  /** ข้อความเตือนสีแดงเหนือปุ่มบันทึก (หน้านี้ไม่ใช่ popup จึงไม่ใช้ toast) */
  const [saveErr, setSaveErr] = useState<"" | "check" | "photo">("");
  const meals = MEALS.map((m) => ({ m, list: drugsFor(drugs, who, m, date), pack: packs.find((p) => p.date === date && p.who === who && p.meal === m) })).filter((x) => x.list.length || x.pack);
  const sel = meals.find((x) => x.m === meal);
  // เบิกยาตามจำนวนที่ใช้จริง: ยาขวด/ยาทา และยาน้ำที่นับเป็น ml (เช่น มี 1,000 เบิก 50 แล้ว 100 → เหลือ 850)
  const bulkDrugs = drugs.filter((x) => x.who === who && (x.bulk || isLiquid(x)));
  const [take, setTake] = useState<Record<number, string>>({});
  const withdraw = (x: Drug) => {
    const n = Number(take[x.id] ?? (isLiquid(x) ? x.dose : 1));
    if (!(n > 0)) return toast("กรุณาระบุจำนวนที่เบิก");
    if (n > x.stock) return toast(`เบิกเกินคงเหลือ · ${x.name} เหลือ ${stockText(x)}`);
    const left = Math.round((x.stock - n) * 100) / 100;
    setDrugs(drugs.map((y) => (y.id === x.id ? { ...y, stock: left } : y)));
    setTake({ ...take, [x.id]: "" });
    toast(`เบิกยาแล้ว · ${x.name} ${n.toLocaleString("en-US")} ${x.unit} · คงเหลือ ${stockText({ ...x, stock: left })}`);
  };
  const done = meals.filter((x) => x.pack).length;

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
      <PageHeader title="จัดยาใหม่ (Dispense)" sub="เลือกผู้สูงอายุและวันที่กินยา แล้วแตะที่การ์ดมื้อยาเพื่อเริ่มจัด"
        actions={<><button className="btn-soft" onClick={() => onAddDrug(who)}><Icon name="plus" className="h-4 w-4" /> เพิ่มยาให้ {who || "ผู้ป่วย"}</button><button className="btn-soft" onClick={() => setPreview(true)}><Icon name="eye" className="h-4 w-4" /> ตรวจสอบซองมื้อยาก่อนจัด</button><button className="btn-soft" onClick={() => setBulk(true)}><Icon name="pill" className="h-4 w-4" /> เบิกยาตามจำนวน</button></>} />
      <div className="card mb-6 grid gap-4 p-5 sm:grid-cols-2">
        <Field label="เลือกผู้สูงอายุ"><Select options={RESIDENTS} value={who} onChange={(v) => { setWho(v || RESIDENTS[0]); }} /></Field>
        <Field label="วันกินยา"><input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></Field>
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[17px] font-medium text-gold-800">ซองยาที่ต้องจัดของ: {who}</h2>
        <span className="text-sm text-gold-600">จัดแล้ว {done} / {meals.length} มื้อ</span>
      </div>
      {meals.length === 0 ? <div className="card empty-state"><Icon name="pill" /><p>{drugs.some((x) => x.who === who) ? "ไม่มียาที่ต้องจัดลงซองในวันนี้" : `${who} ยังไม่มียาในระบบ`}</p>
        <p className="mt-1 text-xs text-gold-500">{drugs.some((x) => x.who === who) ? "ยาทุกตัวอาจเป็นยาขวด/ยาทา งดชั่วคราว หรือไม่ได้กินวันนี้" : "เพิ่มยาที่ญาตินำมาหรือแพทย์สั่ง แล้วซองยาตามมื้อจะขึ้นในหน้านี้"}</p>
        <button className="btn-primary mt-4" onClick={() => onAddDrug(who)}><Icon name="plus" className="h-4 w-4" /> เพิ่มยาให้ {who}</button></div> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {meals.map((x) => (
            <div key={x.m} className={`card flex min-w-0 flex-col p-5 ${x.pack ? "!border-emerald-200 bg-emerald-50/40" : ""}`}>
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
      {done > 0 && done === meals.length && <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-emerald-50 p-5 text-sm text-emerald-800"><span>จัดยาครบทุกมื้อแล้ว ส่งเข้าตะกร้ายารอตรวจ QA</span><button className="btn-soft" onClick={() => go("qa")}>ไปตรวจตะกร้ายา</button></div>}

      <Modal open={preview} wide title="ตรวจสอบซองมื้อยาก่อนจัด" onClose={() => setPreview(false)} footer={<button className="btn-primary" onClick={() => setPreview(false)}>ปิด</button>}>
        <p className="mb-4 text-sm text-gold-600">สรุปยาที่ต้องหยิบมาจัดของ {who} วันที่ {thai(date)}</p>
        <DataTable columns={["มื้อยา", "ชื่อยา", "จำนวน", "คงเหลือในคลัง"]} rows={meals.flatMap((x) => x.list.map((y) => [x.m, y.name, `${y.dose} ${y.unit}`, stockText(y)]))} />
      </Modal>
      <Modal open={bulk} title="เบิกยาตามจำนวน" onClose={() => setBulk(false)} footer={<button className="btn-soft" onClick={() => setBulk(false)}>ปิด</button>}>
        <p className="mb-4 text-sm text-gold-600">กรอกจำนวนที่เบิกจริงแล้วกดเบิก ระบบลดสต็อกตามนั้นและแสดงยอดคงเหลือ · ยาน้ำนับเป็น ml (เช่น มี 1,000 เบิก 50 แล้ว 100 → เหลือ 850 ml)</p>
        {bulkDrugs.length === 0 ? <p className="empty-state">ไม่มียาน้ำ ยาขวด หรือยาทาของ {who}</p> : (
          <ul className="space-y-2">{bulkDrugs.map((x) => {
            const pct = isLiquid(x) && x.pack ? Math.min(100, Math.round((x.stock / x.pack) * 100)) : null;
            return (
              <li key={x.id} className="grid gap-3 rounded-2xl border border-cream-300 p-4 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                <span className="min-w-0"><b className="font-medium">{x.name}</b><span className="block text-gold-500">คงเหลือ <b className="text-gold-800">{stockText(x)}</b></span>
                  {pct !== null && <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-cream-300"><i className="block h-full rounded-full bg-gold-600" style={{ width: `${pct}%` }} /></span>}</span>
                <span className="flex items-center gap-2">
                  <input type="number" min={0} step={isLiquid(x) ? 5 : 1} className="!w-24" aria-label={`จำนวนที่เบิก ${x.name}`} value={take[x.id] ?? String(isLiquid(x) ? x.dose : 1)} onChange={(e) => setTake({ ...take, [x.id]: e.target.value })} />
                  <span className="text-gold-600">{x.unit}</span>
                  <button className="btn-primary !min-h-[38px] shrink-0 !px-4 !py-2" disabled={x.stock <= 0} onClick={() => withdraw(x)}>เบิก</button>
                </span>
              </li>
            );
          })}</ul>
        )}
      </Modal>
    </>
  );
}

/* ---------- ตะกร้ายา & QA ---------- */
function QA({ packs, setPacks, drugs, go, me }: { packs: Pack[]; setPacks: (x: Pack[]) => void; drugs: Drug[]; go: (p: Page) => void; me: string }) {
  const { toast } = useApp();
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
      <PageHeader title="ตรวจสอบตะกร้ายา (QA)" sub="ตรวจสอบซองยาทั้งหมดที่จัดเสร็จแล้วในตะกร้า แยกตามผู้สูงอายุและวันที่ เพื่อเช็คความถูกต้องก่อนจบงาน"
        actions={<button className="btn-soft" onClick={() => { go("audit"); toast("สุ่มตรวจสต็อก: เลือกผู้รับบริการเพื่อนับยาเทียบกับระบบ"); }}><Icon name="refresh" className="h-4 w-4" /> สุ่มตรวจ (Cycle Count)</button>} />
      <div className="mb-5"><Tabs tabs={["รอตรวจ", "ตรวจผ่าน", "แจ้งจัดยาผิด", "ทั้งหมด"].map((t) => `${t} (${count(t)})`)} value={`${tab} (${count(tab)})`} onChange={(v) => setTab(v.split(" (")[0])} /></div>
      {list.length === 0 ? (
        <div className="card empty-state"><Icon name="check" /><p>{packs.length ? "ไม่มีซองยาในสถานะนี้" : "ยังไม่มีซองยาในตะกร้า เริ่มจากเมนูจัดยารายวัน"}</p>{!packs.length && <button className="btn-primary mt-4" onClick={() => go("dispense")}>ไปจัดยารายวัน</button>}</div>
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
              {p.reason && <p className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">สาเหตุ: {p.reason} · กลับไปหน้าจัดยารายวัน กด &quot;รีเซต&quot; มื้อนี้แล้วจัดใหม่</p>}
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

function Inventory({ drugs, setDrugs, master, addFor, onAdded }: { drugs: Drug[]; setDrugs: (x: Drug[]) => void; master: string[][]; addFor: string | null; onAdded: () => void }) {
  const RESIDENTS = useNames();
  const { toast, confirm } = useApp();
  const [f, setF] = useState(blankForm);
  const [tag, setTag] = useState("");
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<Drug | null>(null);
  const [label, setLabel] = useState<Drug | null>(null);
  const [filter, setFilter] = useState("");
  const toggle = (k: "meals" | "days" | "warn", v: string) => setF({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] });
  const shown = drugs.filter((x) => !filter || x.who === filter);
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
    setF({ ...blankForm(), who: f.who }); setOpen(false); toast(`รับยาเข้าตะกร้าแล้ว · ${f.name.trim()} · ${f.who} · ระบบสร้างซองยาตามมื้อให้`);
  };
  return (
    <>
      <PageHeader title="รับยาเข้าคลัง (Receiving)" sub="บันทึกสต็อกยาและข้อมูลจากโรงพยาบาล เพื่อเป็นฐานข้อมูลหลักให้ระบบจัดยารายวันดึงไปใช้ และคำนวณการหักสต็อก"
        actions={<><button className="btn-soft" onClick={() => window.print()}><Icon name="print" className="h-4 w-4" /> พิมพ์ใบรับยาเข้า</button><button className="btn-primary" onClick={() => { setF(blankForm()); setOpen(true); }}><Icon name="plus" className="h-4 w-4" /> บันทึกข้อมูลยาใหม่จากโรงพยาบาล</button></>} />
      <Section title="คลังยาทั้งหมด (แยกตามผู้สูงอายุ)" actions={<div className="min-w-52"><Select options={RESIDENTS} placeholder="ผู้สูงอายุทั้งหมด" value={filter} onChange={setFilter} /></div>}>
        <DataTable
          columns={["ผู้สูงอายุ", "ชื่อยา", "วิธีทาน", "มื้อ", "คงเหลือ", "สถานะ"]}
          rows={shown.map((x) => [x.who, `${x.name} · [${x.src === CENTRAL ? CENTRAL : "ญาตินำมา"}]`, x.how || "-", x.bulk ? "ยาขวด / ไม่แพ็คซอง" : `${x.meals.join(", ")} · ครั้งละ ${x.dose} ${x.unit}`, stockText(x), x.hold ? "งดยาชั่วคราว" : x.status])}
          actions={[
            { label: "ดู", onClick: (i) => setView(shown[i]) },
            { label: "เติมจากคลังกลาง", hidden: (i) => !shown[i].sdid, onClick: (i) => setRefill({ x: shown[i], qty: "" }) },
            { label: "ลบ", danger: true, onClick: (i) => confirm({ title: "ลบยาออกจากตะกร้า", message: `ต้องการลบ ${shown[i].name} ของ ${shown[i].who} ใช่หรือไม่`, danger: true, okLabel: "ลบ", onOk: () => { setDrugs(drugs.filter((x) => x.id !== shown[i].id)); toast("ลบยาแล้ว"); } }) },
          ]}
        />
      </Section>

      <Modal open={open} wide title="บันทึกข้อมูลยาใหม่จากโรงพยาบาล" onClose={() => setOpen(false)}
        footer={<><button className="btn-soft" onClick={() => setOpen(false)}>ยกเลิก</button>{f.src === "central"
          ? <button className="btn-primary" disabled={busy} onClick={saveCentral}>เบิกและเพิ่มเข้าตะกร้า</button>
          : <button className="btn-primary" onClick={save}>บันทึกรับยาเข้าตะกร้าผู้สูงอายุ</button>}</>}>
        <div className="space-y-6">
          <Field label="1. เลือกผู้สูงอายุที่รับยามา" required><Select options={RESIDENTS} placeholder="-- เลือกผู้สูงอายุ --" value={f.who} onChange={(v) => setF({ ...f, who: v, sdrug: "" })} /></Field>
          <div><p className="label">แหล่งที่มาของยา</p><div className="flex flex-wrap gap-2">
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
          <div><p className="label">ถ่ายรูปกล่องยา / ฉลากยา (สำคัญมากสำหรับตรวจสอบก่อนบันทึก) <span className="text-red-500">*</span></p><Photo value={f.photo} onChange={(u) => setF({ ...f, photo: u })} /></div>
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-cream-300 bg-cream-50 p-4 text-sm">
            <input type="checkbox" className="mt-1" checked={f.bulk} onChange={(e) => setF({ ...f, bulk: e.target.checked, unit: e.target.checked ? "ขวด" : "เม็ด" })} />
            <span><b className="font-medium">เป็นยาที่ไม่ต้องจัดรายมื้อ (เช่น ยาทา ยาพ่น ยาที่ให้เมื่อมีอาการ)</b><span className="block text-gold-600">ยาจะไม่ขึ้นในหน้าจัดยารายวัน ต้องกดเบิกทั้งขวดแทน · ยาน้ำที่ให้ตามมื้อ (เช่น ครั้งละ 15 ml) ไม่ต้องติ๊กข้อนี้ ระบบจะตัดเป็น ml</span></span>
          </label>
          </>}
          <div className="form-grid">
            {f.src === "own" && <Field label="ชื่อยา (พิมพ์เพื่อค้นหา)" required><input list="master-drugs" value={f.name} placeholder="เช่น Atorvastatin 40mg" onChange={(e) => { const m = master.find((x) => x[0] === e.target.value); setF({ ...f, name: e.target.value, use: m ? m[1] : f.use }); }} /><datalist id="master-drugs">{master.map((x) => <option key={x[0]} value={x[0]} />)}</datalist></Field>}
            <Field label="สรรพคุณ / ข้อบ่งใช้"><input value={f.use} placeholder="เช่น ยาลดไขมัน, ยาลดความดัน" onChange={(e) => setF({ ...f, use: e.target.value })} /></Field>
            <Field label="วิธีทานตามฉลาก"><input value={f.how} placeholder="เช่น วันละ 1 ครั้ง ก่อนนอน" onChange={(e) => setF({ ...f, how: e.target.value })} /></Field>
            <Field label="แหล่งเก็บยา"><Select options={STORES} value={f.store} onChange={(v) => setF({ ...f, store: v || STORES[0] })} /></Field>
            {f.src === "own" && <Field label="รูปแบบยา"><Select options={FORMS} value={f.form} onChange={(v) => setF({ ...f, form: v || FORMS[0], ...(v === LIQUID ? { unit: "ml", dose: "" } : f.unit === "ml" ? { unit: "เม็ด", dose: "1" } : {}) })} /></Field>}
            <Field label="ช่วงเวลา (Timing)"><Select options={TIMINGS} value={f.timing} onChange={(v) => setF({ ...f, timing: v || TIMINGS[0] })} /></Field>
          </div>
          {!f.bulk && (
            <div className="rounded-2xl border border-cream-300 p-4">
              <p className="mb-3 font-medium text-gold-800">ข้อมูลสำหรับการจัดยา (กำหนดมื้อ)</p>
              <div className="form-grid">
                <Field label={liquid ? "ให้ครั้งละ (ml)" : "กินครั้งละ (Dose)"}><div className="flex items-center gap-2"><input type="number" min={liquid ? "1" : "0.5"} step={liquid ? "1" : "0.5"} value={f.dose} placeholder={liquid ? "เช่น 15" : ""} onChange={(e) => setF({ ...f, dose: e.target.value })} /><span className="shrink-0 text-sm text-gold-600">{f.src === "central" ? cd?.unit ?? "" : liquid ? "ml" : f.unit}</span></div></Field>
                <div><p className="label">มื้อยาที่ต้องทาน (เลือกได้หลายข้อ)</p><div className="flex flex-wrap gap-2">{MEALS.map((m) => <Chip key={m} on={f.meals.includes(m)} onClick={() => toggle("meals", m)}>{m}</Chip>)}</div></div>
              </div>
              <p className="label mt-5">เงื่อนไขวันกิน (ปล่อยว่างไว้ถ้าทานทุกวัน)</p>
              <div className="flex flex-wrap gap-2">{DAYS.map((x) => <Chip key={x} on={f.days.includes(x)} onClick={() => toggle("days", x)}>{x}</Chip>)}</div>
            </div>
          )}
          <div>
            <p className="label">คำเตือน / ข้อควรระวังจากฉลากยา (ถ้ามี)</p>
            <div className="mb-2 flex flex-wrap gap-2">{f.warn.length ? f.warn.map((w) => <button type="button" key={w} onClick={() => toggle("warn", w)} className="rounded-full bg-red-50 px-3 py-1 text-xs text-red-700">{w} ×</button>) : <span className="text-sm text-gold-500">ยังไม่มีคำเตือน (คลิกเพิ่มด้านล่าง)</span>}</div>
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

      <MedPhotoModal open={!!label} title={label ? `รูปฉลากยา · ${label.name}` : ""} items={label ? [{ kind: "label", id: label.id, title: `${label.name} · ${label.who}` }] : []} onClose={() => setLabel(null)} />
      <Modal open={!!view} title={view?.name ?? ""} onClose={() => setView(null)} footer={<><button className="btn-soft" onClick={() => { setLabel(view); setView(null); }}>ดูรูปฉลากยา</button><button className="btn-primary" onClick={() => setView(null)}>ปิดหน้าต่าง</button></>}>
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
  useEffect(() => { if (cur) { setCount(cur.stock); setStatus(cur.status); } }, [cur?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (who && cur) {
    const next = () => {
      setDrugs(drugs.map((x) => (x.id === cur.id ? { ...x, stock: count, status } : x)));
      setDone(Array.from(new Set([...done, cur.id])));
      if (idx + 1 < list.length) setIdx(idx + 1); else { setWho(null); toast(`ตรวจนับคลังยาครบแล้ว · ${who}`); }
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
          <p className="mt-6 text-center text-sm font-medium text-gold-700">คุณนับยาในคลังของผู้สูงอายุได้เท่าไหร่? <span className="block text-xs font-normal text-gold-500">(ไม่รวมยาที่จัดใส่ซองไปแล้ว)</span></p>
          <div className="mt-3 flex items-center justify-center gap-3">
            <button className="icon-button !h-14 !w-14 text-2xl" aria-label="ลด 1" onClick={() => setCount(Math.max(0, count - 1))}>−</button>
            <input type="number" aria-label="จำนวนที่นับได้" className="!w-28 text-center !text-2xl font-semibold" value={count} onChange={(e) => setCount(Math.max(0, Number(e.target.value)))} />
            <button className="icon-button !h-14 !w-14 text-2xl" aria-label="เพิ่ม 1" onClick={() => setCount(count + 1)}>+</button>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <button className="btn-soft !px-2 text-xs" onClick={() => setCount(count + 10)}>+1 แผง (10)</button>
            <button className="btn-soft !px-2 text-xs" onClick={() => setCount(count + 30)}>+1 กล่อง (30)</button>
            <button className="btn-soft !px-2 text-xs" onClick={() => setCount(cur.stock)}>ครบถ้วน (ตรงเป๊ะ)</button>
          </div>
          <p className="label mt-6">สถานะยา (อัปเดตหากพบปัญหา)</p>
          <div className="grid grid-cols-2 gap-2">{AUDIT_STATUS.map((s) => <Chip key={s} on={status === s} onClick={() => setStatus(s)}>{s}</Chip>)}</div>
          <button className="btn-primary mt-6 w-full" onClick={next}>บันทึก & ถัดไป <Icon name="arrow" className="h-4 w-4" /></button>
        </section>
      </div>
    );
  }
  return (
    <>
      <PageHeader title="ภารกิจเคลียร์คลังยา" sub="เช็กสต็อกเพื่อความแม่นยำก่อนจัดยา" />
      <Section title="ความคืบหน้าวันนี้">
        <div className="flex items-center justify-between text-sm text-gold-600"><span>ตรวจแล้ว {done.length} / {total} รายการ</span><b className="text-gold-700">{total ? Math.round((done.length / total) * 100) : 0}%</b></div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-cream-200"><div className="h-full rounded-full bg-gold-600 transition-all" style={{ width: `${total ? (done.length / total) * 100 : 0}%` }} /></div>
      </Section>
      <h2 className="mb-4 mt-6 text-[17px] font-medium text-gold-800">เลือกลิสต์ผู้รับบริการเพื่อตรวจ</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {RESIDENTS.map((w) => {
          const mine = drugs.filter((x) => x.who === w);
          const ok = mine.filter((x) => done.includes(x.id)).length;
          return (
            <button key={w} disabled={!mine.length} onClick={() => { setWho(w); setIdx(0); }} className="card min-w-0 p-5 text-left transition hover:border-gold-300 disabled:opacity-50">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-cream-100 font-semibold text-gold-700">{w.replace("คุณ", "").charAt(0)}</span>
              <p className="mt-3 truncate font-medium text-gold-800">{w}</p>
              <p className="text-sm text-gold-500">ยา {mine.length} รายการ</p>
              <div className="mt-3">{ok === mine.length && mine.length ? <StatusBadge value="ตรวจแล้ว" /> : <StatusBadge value={`รอตรวจ ${mine.length - ok}`} />}</div>
            </button>
          );
        })}
      </div>
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
  return (
    <>
      <PageHeader title="ซองมื้อยา" sub="ใช้สำหรับตั้งค่าและตรวจสอบยาที่จะถูกจัดลงในแต่ละซอง" />
      <div className="card mb-6 p-5"><Field label="เลือกผู้สูงอายุ"><Select options={RESIDENTS} placeholder="-- เลือกผู้สูงอายุ --" value={who} onChange={setWho} /></Field></div>
      {!who ? <div className="card empty-state"><Icon name="files" /><p>กรุณาเลือกผู้สูงอายุด้านบนเพื่อแสดงแม่แบบซองยา</p></div> : (
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
      <PageHeader title="ฐานข้อมูลยา (Master Drugs)" sub="จัดการรายชื่อยาที่เป็นพจนานุกรมส่วนกลางของระบบ" actions={<button className="btn-primary" onClick={() => { setName(""); setUse(""); setOpen(true); }}><Icon name="plus" className="h-4 w-4" /> เพิ่มยาตัวใหม่</button>} />
      <Section title="รายชื่อยาทั้งหมด">
        <DataTable columns={["ชื่อยา", "สรรพคุณ / การออกฤทธิ์", "ผู้ป่วยที่ใช้", "คงเหลือรวม", "ใช้ไปแล้ว"]} rows={rows}
          actions={[{ label: "ดูรายคน", hidden: (i) => !usersOf(master[i][0]).length, onClick: (i) => setOpen2(master[i][0]) },{ label: "ลบ", danger: true, onClick: (i) => confirm({ title: "ลบยาจากฐานข้อมูล", message: `ต้องการลบ ${master[i][0]} ใช่หรือไม่`, danger: true, okLabel: "ลบ", onOk: () => { setMaster(master.filter((_, j) => j !== i)); toast("ลบแล้ว"); } }) }]} />
      </Section>
      <Modal open={!!open2} wide title={open2 ? `คงเหลือรายคน · ${open2}` : ""} onClose={() => setOpen2(null)} footer={<button className="btn-primary" onClick={() => setOpen2(null)}>ปิด</button>}>
        {open2 && <DataTable search={false} columns={["ผู้ป่วย", "ชื่อยาในตะกร้า", "รับเข้า", "ใช้ไปแล้ว", "คงเหลือ", "ใช้ได้อีก"]}
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
    .filter((p) => (!q.who || p.who === q.who) && (!q.from || p.date >= q.from) && (!q.to || p.date <= q.to) && (!q.status || (q.status === "จ่ายยาแล้ว") === p.given))
    .map((p) => [thai(p.date), p.who, p.meal, p.items.join(", "), p.by || "-", p.qby || "-", p.gby || "-", p.gat || "-", p.given ? "จ่ายยาแล้ว" : "รอจ่าย"]), [packs, q]);
  return (
    <>
      <PageHeader title="รายงานการจัดยา" sub="ดูประวัติและรายงานการจัดยาทั้งหมด แยกตามวันเวลา สาขา และผู้จัดยา"
        actions={<><button className="btn-soft" onClick={() => downloadCsv("รายงานการจัดยา", cols, rows)}><Icon name="download" className="h-4 w-4" /> ดาวน์โหลด CSV</button><button className="btn-primary" onClick={() => window.print()}><Icon name="print" className="h-4 w-4" /> พิมพ์รายงานจัดยา (A4)</button></>} />
      <form className="card mb-6 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1fr_1fr_auto] lg:items-end" onSubmit={(e) => { e.preventDefault(); setQ({ who, from, to, status }); }}>
        <Field label="ค้นหาผู้สูงอายุ"><Select options={RESIDENTS} placeholder="-- ทั้งหมด --" value={who} onChange={setWho} /></Field>
        <Field label="วันกินยา (เริ่มต้น)"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="วันกินยา (สิ้นสุด)"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="สถานะ"><Select options={["รอจ่าย", "จ่ายยาแล้ว"]} placeholder="-- ทั้งหมด --" value={status} onChange={setStatus} /></Field>
        <button className="btn-primary sm:col-span-2 lg:col-span-1"><Icon name="search" className="h-4 w-4" /> ค้นหา</button>
      </form>
      <Section title="รายงานการจัดยา (Medication Dispensing Report)" sub="จัดยาโดยหลักการ 5R เพื่อความปลอดภัยสูงสุดของผู้รับบริการ">
        <DataTable columns={cols} rows={rows} empty="ยังไม่มีประวัติการจัดยา เริ่มจัดยาได้ที่เมนูจัดยารายวัน" />
      </Section>
    </>
  );
}

/* ---------- คู่มือ ---------- */
function Manual() {
  const parts = [
    ["1. การรับยาเข้าตะกร้าผู้ป่วย", "ยาที่ญาติหรือโรงพยาบาลนำมา: ถ่ายรูปฉลาก ระบุมื้อและจำนวนต่อครั้ง (Dose) ยาที่ไม่ได้กินทุกวันให้ติ๊กวันที่ต้องกิน · ยาของศูนย์: เลือกแหล่งที่มา \"เบิกจากคลังกลางของศูนย์\" ระบบหักคลังกลางและขึ้นค่ายาที่การเงินให้ ยาที่ใกล้หมดกด \"เติมจากคลังกลาง\" ได้ เมื่อบันทึกแล้วระบบสร้างซองมื้อยาให้อัตโนมัติ"],
    ["2. การจัดยา (Dispensing Process)", "เลือกผู้รับบริการและวันกินยา แล้วกด \"เริ่มจัดยามื้อนี้\" ถ้ายาในคลังมีไม่พอ ระบบจะแจ้งเตือนสีเหลืองทันทีและจัดเท่าที่มี สำหรับยาที่มีเงื่อนไขวันกิน ระบบจะดึงยาเข้าซองเฉพาะวันที่ตรงเงื่อนไขให้อัตโนมัติ ถ่ายรูปซองยาที่จัดเสร็จแล้วกดบันทึก สถานะจะเปลี่ยนเป็น \"จัดยาแล้ว\" และรูปซองถูกเก็บไว้ให้ผู้ตรวจ QA ดู"],
    ["3. การแก้ไขเมื่อทำผิดพลาด (Reset)", "หากจัดยาผิด ถ่ายรูปผิด หรือต้องการจัดใหม่ ให้กดปุ่ม \"รีเซต\" บนการ์ดมื้อยา ระบบจะล้างการจัดยาของมื้อนั้นและคืนสต็อกยา"],
    ["4. ระบบตรวจสอบการจัดยา (QA & Near Miss)", "ใช้หลัก 5R (Right Patient, Right Drug, Right Dose, Right Time, Right Route) ร่วมกับรูปถ่าย ผู้ตรวจกด \"ดูรูปซองเทียบฉลากยา\" เพื่อเทียบรูปซองกับรูปฉลากต้นฉบับ หากถูกต้องกด \"ตรวจผ่าน\" ซองจะขึ้นคิวจ่ายยาใน KinApp หากพบว่าจัดผิดกด \"แจ้งจัดยาผิด\" ระบุสาเหตุ แล้วกลับไปรีเซตมื้อนั้นเพื่อจัดใหม่ การดักจับความผิดพลาดตรงนี้เรียกว่า Category B (Near Miss)"],
    ["5. การให้ยา (KinApp)", "พยาบาลเปิดคิวจ่ายยาวันนี้ในแอปพยาบาล ให้ยาแล้วกดบันทึก ระบบเก็บชื่อผู้ให้ยาและเวลา ขึ้นในบันทึกการให้ยา (MAR) ของประวัติผู้ป่วย"],
    ["6. การสุ่มตรวจ (Cycle Count)", "ใช้เมนูเคลียร์คลังยาเพื่อนับยาจริงเทียบกับระบบเป็นประจำ และอัปเดตสถานะยา เช่น ยาหมด ยาหมดอายุ หรือยางดใช้"],
  ];
  return (
    <>
      <PageHeader title="คู่มือผู้ใช้งานระบบ (User Manual)" sub="ระบบถูกออกแบบมาเพื่อความถูกต้อง ปลอดภัย และสืบย้อนข้อมูลได้ ตั้งแต่ตอนรับยาจากโรงพยาบาล จนถึงตอนที่ผู้สูงอายุทานยา" />
      <div className="mb-6"><TutorialVideos only={[5, 4]} /></div>
      <div className="grid gap-4 lg:grid-cols-2">{parts.map(([t, p]) => <section key={t} className="card p-6"><h2 className="text-[17px] font-medium text-gold-800">{t}</h2><p className="mt-2 text-sm leading-7 text-gold-600">{p}</p></section>)}</div>
    </>
  );
}

export default function PharmacyApp() {
  const { user, ready, setUser, logout } = useSession();
  if (!ready) return <main className="grid min-h-dvh place-items-center text-sm text-gold-500">กำลังตรวจสอบการเข้าสู่ระบบ…</main>;
  return <AppProvider go={() => {}}>{user && !can(user, "app.pharmacy") ? <CashierOnly name={user.name} app="แอปจัดยา" onLogout={logout} /> : user ? <App user={user} onLogout={logout} /> : <Login staff onLogin={setUser} />}</AppProvider>;
}
