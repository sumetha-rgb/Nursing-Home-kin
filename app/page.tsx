"use client";
import { useEffect, useState, type ComponentType } from "react";
import dynamic from "next/dynamic";
import Login from "@/components/Login";
import Shell from "@/components/Shell";
import PasswordDialog from "@/components/PasswordDialog";
import { AppProvider } from "@/lib/app";
import { useSession } from "@/lib/session";
import { can, hasConsole } from "@/lib/perms";
import CashierOnly from "@/components/CashierOnly";
import { wantStaffFilter } from "@/lib/staffIntent";
import { EXPORT_SOURCES, NAV, ViewId } from "@/lib/nav";

/** แต่ละหน้าโหลดตอนเปิดใช้เท่านั้น (หน้าแรกไม่ต้องรอโค้ดของทุกเมนู) */
const view = (load: () => Promise<() => JSX.Element>) =>
  dynamic(load, { loading: () => <p className="py-16 text-center text-sm text-gold-500">กำลังโหลด…</p> });
const Contracts = view(() => import("@/components/views/Core").then((m) => m.Contracts));
const Residents = view(() => import("@/components/views/Core").then((m) => m.Residents));
const TasksTable = view(() => import("@/components/views/Core").then((m) => m.TasksTable));
const Workflow = view(() => import("@/components/views/Core").then((m) => m.Workflow));
const DailyTasks = view(() => import("@/components/views/Daily").then((m) => m.DailyTasks));
const FacilityTasks = view(() => import("@/components/views/Tasks").then((m) => m.FacilityTasks));
const MasterTasks = view(() => import("@/components/views/Tasks").then((m) => m.MasterTasks));
const Quotations = view(() => import("@/components/views/Quotations").then((m) => m.Quotations));
const Appointments = view(() => import("@/components/views/Ops").then((m) => m.Appointments));
const Dashboard = view(() => import("@/components/views/Ops").then((m) => m.Dashboard));
const HealthLogs = view(() => import("@/components/views/Ops").then((m) => m.HealthLogs));
const OfficialDocs = view(() => import("@/components/views/Ops").then((m) => m.OfficialDocs));
const Feedbacks = view(() => import("@/components/views/Feedbacks").then((m) => m.Feedbacks));
const StaffReviews = view(() => import("@/components/views/StaffReviews").then((m) => m.StaffReviews));
const StaffKpi = view(() => import("@/components/views/StaffKpi").then((m) => m.StaffKpi));
const Branches = view(() => import("@/components/views/Admin").then((m) => m.Branches));
const Staff = view(() => import("@/components/views/Admin").then((m) => m.Staff));
const AuditLog = view(() => import("@/components/views/Audit").then((m) => m.AuditLog));
const Roster = view(() => import("@/components/views/Roster").then((m) => m.Roster));
const Tutorials = view(() => import("@/components/views/Tutorials").then((m) => m.Tutorials));
const Rooms = view(() => import("@/components/views/Rooms").then((m) => m.Rooms));
const Billing = view(() => import("@/components/views/Billing").then((m) => m.Billing));
const PriceList = view(() => import("@/components/views/PriceList").then((m) => m.PriceList));
const Exports = view(() => import("@/components/views/Exports").then((m) => m.Exports));
const Physio = view(() => import("@/components/views/Physio").then((m) => m.Physio));

const VIEWS: Record<ViewId, ComponentType> = {
  careplan: Workflow,
  contracts: Contracts,
  residents: Residents,
  tasks_table: TasksTable,
  tasks: DailyTasks,
  appointments: Appointments,
  health_logs: HealthLogs,
  feedbacks: Feedbacks,
  dashboard: Dashboard,
  "official-docs": OfficialDocs,
  branches: Branches,
  staff: Staff,
  facility_tasks: FacilityTasks,
  master_tasks: MasterTasks,
  quotations: Quotations,
  audit: AuditLog,
  roster: Roster,
  reviews: StaffReviews,
  kpi: StaffKpi,
  tutorials: Tutorials,
  rooms: Rooms,
  billing: Billing,
  prices: PriceList,
  exports: Exports,
  physio: Physio,
};

function Splash() {
  return <main className="grid min-h-dvh place-items-center text-sm text-gold-500">กำลังตรวจสอบการเข้าสู่ระบบ…</main>;
}

export default function Home() {
  const { user, ready, setUser, logout } = useSession();
  const [view, setView] = useState<ViewId>("careplan");
  const [pw, setPw] = useState(false);
  // ลิงก์จากแจ้งเตือนบนมือถือ: ?view=<เมนู>&filter=pending → เปิดเมนูนั้น (ตัวกรองรออนุมัติ) แล้วล้างที่อยู่เว็บ
  useEffect(() => {
    const q = new URLSearchParams(window.location.search), v = q.get("view");
    if (!v) return;
    if (v === "staff" && q.get("filter") === "pending") wantStaffFilter("รออนุมัติ");
    if (NAV.some((n) => n.kind === "view" && n.id === v)) setView(v as ViewId);
    window.history.replaceState(null, "", "/");
  }, []);

  if (!ready) return <Splash />;
  if (!user) return <Login onLogin={setUser} />;
  // บัญชีที่ไม่มีเมนูระบบจัดการ (พยาบาล นักกายภาพ) → พาไปแอปของตัวเอง
  if (!hasConsole(user)) return <CashierOnly user={user} app="console" onLogout={logout} />;
  // เห็นเฉพาะเมนูที่ติ๊กสิทธิ์ไว้ (lib/perms)
  const views = NAV.flatMap((n) => (n.kind === "view" && (n.id === "exports" ? EXPORT_SOURCES.some((p) => can(user, p)) : can(user, n.id)) ? [n.id] : []));
  const shown = !views.includes(view) ? views[0] : view;
  const View = VIEWS[shown];
  const go = (v: ViewId) => { setView(v); window.scrollTo(0, 0); };

  return (
    <AppProvider go={go}>
      <Shell view={shown} views={views} onView={go} user={user} onLogout={logout} onChangePassword={() => setPw(true)}>
        <View />
      </Shell>
      <PasswordDialog open={pw} onClose={() => setPw(false)} />
    </AppProvider>
  );
}
