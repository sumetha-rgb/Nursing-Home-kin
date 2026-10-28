"use client";
import { useState } from "react";
import Login from "@/components/Login";
import Shell from "@/components/Shell";
import PasswordDialog from "@/components/PasswordDialog";
import { AppProvider } from "@/lib/app";
import { useSession } from "@/lib/session";
import { isAdmin } from "@/lib/roles";
import { ViewId } from "@/lib/nav";
import { Contracts, Residents, TasksTable, Workflow } from "@/components/views/Core";
import { DailyTasks } from "@/components/views/Daily";
import { FacilityTasks, MasterTasks, Quotations } from "@/components/views/Tasks";
import { Appointments, Dashboard, HealthLogs, OfficialDocs } from "@/components/views/Ops";
import { Feedbacks } from "@/components/views/Feedbacks";
import { StaffReviews } from "@/components/views/StaffReviews";
import { StaffKpi } from "@/components/views/StaffKpi";
import { Branches, Staff } from "@/components/views/Admin";
import { AuditLog } from "@/components/views/Audit";
import { Roster } from "@/components/views/Roster";

const VIEWS: Record<ViewId, () => JSX.Element> = {
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
};

function Splash() {
  return <main className="grid min-h-dvh place-items-center text-sm text-gold-500">กำลังตรวจสอบการเข้าสู่ระบบ…</main>;
}

/** บัญชีระดับปฏิบัติงานเข้าระบบจัดการไม่ได้ */
function OperationOnly({ name, onLogout }: { name: string; onLogout: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center px-5">
      <section className="card w-full max-w-md p-8 text-center">
        <p className="kicker justify-center">KIN CARE TEAM</p>
        <h1 className="mt-3 text-2xl font-medium text-gold-800">สวัสดี {name}</h1>
        <p className="mt-3 text-sm leading-7 text-gold-600">บัญชีระดับปฏิบัติงาน (Operation) ใช้ได้กับแอปพนักงานและแอปจัดยา ระบบจัดการสำหรับผู้จัดการสาขาและผู้บริหาร</p>
        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <a href="/staff" className="btn-primary">KinApp (แอปพนักงาน)</a>
          <a href="/pharmacy" className="btn-soft">แอปจัดยา</a>
        </div>
        <button className="mt-5 text-sm text-gold-500 underline-offset-4 hover:underline" onClick={onLogout}>ออกจากระบบ</button>
      </section>
    </main>
  );
}

export default function Home() {
  const { user, ready, setUser, logout } = useSession();
  const [view, setView] = useState<ViewId>("careplan");
  const [pw, setPw] = useState(false);

  if (!ready) return <Splash />;
  if (!user) return <Login onLogin={setUser} />;
  if (!isAdmin(user.role)) return <OperationOnly name={user.name} onLogout={logout} />;
  const View = VIEWS[view];
  const go = (v: ViewId) => { setView(v); window.scrollTo(0, 0); };

  return (
    <AppProvider go={go}>
      <Shell view={view} onView={go} user={user} onLogout={logout} onChangePassword={() => setPw(true)}>
        <View />
      </Shell>
      <PasswordDialog open={pw} onClose={() => setPw(false)} />
    </AppProvider>
  );
}
