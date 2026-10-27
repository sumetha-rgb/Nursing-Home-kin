"use client";
import { useState } from "react";
import Login from "@/components/Login";
import Shell from "@/components/Shell";
import { Field, Modal } from "@/components/ui";
import { AppProvider, useApp } from "@/lib/app";
import { ViewId } from "@/lib/nav";
import { Contracts, Residents, TasksTable, Workflow } from "@/components/views/Core";
import { DailyTasks } from "@/components/views/Daily";
import { FacilityTasks, MasterTasks, Quotations } from "@/components/views/Tasks";
import { Appointments, Dashboard, Feedbacks, HealthLogs, OfficialDocs } from "@/components/views/Ops";
import { Branches, Staff } from "@/components/views/Admin";

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
};

function PasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useApp();
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const done = () => { setA(""); setB(""); onClose(); };
  return (
    <Modal
      open={open}
      title="เปลี่ยนรหัสผ่านใหม่"
      onClose={done}
      footer={<>
        <button className="btn-soft" onClick={done}>ยกเลิก</button>
        <button className="btn-primary" onClick={() => {
          if (a.length < 6) return toast("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร");
          if (a !== b) return toast("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
          done(); toast("เปลี่ยนรหัสผ่านเรียบร้อย");
        }}>ยืนยันการเปลี่ยนรหัสผ่าน</button>
      </>}
    >
      <div className="space-y-4">
        <Field label="รหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร)" required><input type="password" value={a} onChange={(e) => setA(e.target.value)} /></Field>
        <Field label="ยืนยันการเปลี่ยนรหัสผ่าน"><input type="password" value={b} onChange={(e) => setB(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export default function Home() {
  const [authed, setAuthed] = useState(false);
  const [view, setView] = useState<ViewId>("careplan");
  const [pw, setPw] = useState(false);

  if (!authed) return <Login onLogin={() => setAuthed(true)} />;
  const View = VIEWS[view];
  const go = (v: ViewId) => { setView(v); window.scrollTo(0, 0); };

  return (
    <AppProvider go={go}>
      <Shell view={view} onView={go} onLogout={() => { setPw(false); setAuthed(false); }} onChangePassword={() => setPw(true)}>
        <View />
      </Shell>
      <PasswordDialog open={pw} onClose={() => setPw(false)} />
    </AppProvider>
  );
}
