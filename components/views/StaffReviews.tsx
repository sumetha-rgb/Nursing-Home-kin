"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "../Icon";
import FamilyLinkDialog from "../care/FamilyLinkDialog";
import { useApp } from "@/lib/app";
import { useBranchNames } from "@/lib/branches";
import { StaffReview, StaffScore } from "@/lib/reviews";
import { DataTable, MetricGrid, Modal, PageHeader, Section, Select } from "../ui";

/** ดาวเต็มเท่าที่ได้จริง (4.5 = 4 ดวง) ตัวเลขเฉลี่ยแสดงแยกไว้แล้ว */
const stars = (n: number) => { const k = Math.floor(n + 1e-9); return `${"★".repeat(k)}${"☆".repeat(5 - k)}`; };
async function call<T>(url: string, body?: object): Promise<T> {
  const r = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "ทำรายการไม่สำเร็จ");
  return d as T;
}

/** รีวิวพนักงานจากครอบครัว: คะแนน/KPI รายคน รีวิวล่าสุด และสร้างลิงก์รีวิวให้ญาติของผู้รับบริการแต่ละคน */
export function StaffReviews() {
  const { toast } = useApp();
  const branches = useBranchNames();
  const [branch, setBranch] = useState("");
  const [data, setData] = useState<{ scores: StaffScore[]; recent: StaffReview[]; days: number } | null>(null);
  const [error, setError] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [person, setPerson] = useState<StaffScore | null>(null);
  const [view, setView] = useState<StaffReview | null>(null);

  const load = useCallback(() => {
    call<{ scores: StaffScore[]; recent: StaffReview[]; days: number }>(`/api/reviews?op=scores${branch ? `&branch=${encodeURIComponent(branch)}` : ""}`)
      .then((d) => { setData(d); setError(""); }).catch((e) => setError((e as Error).message));
  }, [branch]);
  useEffect(load, [load]);
  const scores = data?.scores ?? [];
  const recent = data?.recent ?? [];
  const total = scores.reduce((a, s) => a + s.reviews, 0);
  const avg = total ? (scores.reduce((a, s) => a + s.avg * s.reviews, 0) / total).toFixed(2) : "-";
  const forPerson = person ? recent.filter((r) => r.staff_id === person.staff_id) : [];

  return (
    <>
      <PageHeader title="รีวิวพนักงานจากครอบครัว"
        sub={`ญาติให้ดาวและคำชมพนักงานที่ดูแลผ่านลิงก์ของผู้รับบริการแต่ละคน · คะแนนเฉลี่ยย้อนหลัง ${data?.days ?? 90} วันใช้เป็น KPI ของพนักงาน`}
        actions={<button className="btn-primary" onClick={() => setLinkOpen(true)}><Icon name="qr" className="h-4 w-4" /> ลิงก์ครอบครัว (สมุดภาพ + รีวิว)</button>} />
      {branches.length > 1 && <div className="mb-4 max-w-xs"><Select aria-label="เลือกสาขา" options={branches} placeholder="ทุกสาขา" value={branch} onChange={setBranch} /></div>}
      <MetricGrid items={[
        { label: "คะแนนเฉลี่ยของทีม", value: avg, unit: "/ 5", icon: "trophy", accent: true },
        { label: "จำนวนรีวิว", value: total, unit: "รีวิว", icon: "chat" },
        { label: "พนักงานที่ได้รับรีวิว", value: scores.length, unit: "คน", icon: "user" },
        { label: "รีวิว 5 ดาว", value: scores.reduce((a, s) => a + s.five, 0), unit: "รีวิว", icon: "heart" },
      ]} />
      {error && <p role="alert" className="form-error my-3"><Icon name="alert" className="h-4 w-4 shrink-0" />{error}</p>}
      <div className="mt-6 space-y-6">
        <Section title="คะแนนรายพนักงาน (KPI)" sub="เรียงตามคะแนนเฉลี่ย กด &quot;ดูรีวิว&quot; เพื่ออ่านคำชมของแต่ละคน">
          <DataTable columns={["อันดับ", "พนักงาน", "สาขา", "คะแนนเฉลี่ย", "ดาว", "จำนวนรีวิว", "คำชมที่ได้บ่อย"]} search={scores.length > 8}
            rows={scores.map((s, i) => [String(i + 1), s.staff_name, s.branch_name, s.avg.toFixed(2), stars(s.avg), String(s.reviews), s.top_tags.join(", ") || "-"])}
            empty="ยังไม่มีรีวิว · กด &quot;สร้างลิงก์รีวิวให้ญาติ&quot; แล้วส่งลิงก์ทาง LINE"
            actions={[{ label: "ดูรีวิว", onClick: (i) => setPerson(scores[i]) }]} />
        </Section>
        <Section title="รีวิวล่าสุด">
          <DataTable columns={["วันเวลา", "พนักงาน", "ดาว", "ผู้รับบริการ", "ผู้รีวิว", "ความเห็น"]} search={recent.length > 8}
            rows={recent.map((r) => [r.at, r.staff_name, stars(r.rating), r.resident_name ?? "-", [r.rater_name || "ไม่ระบุชื่อ", r.relation].filter(Boolean).join(" · "), r.comment || (r.tags.length ? r.tags.join(", ") : "-")])}
            empty="ยังไม่มีรีวิว" actions={[{ label: "ดู", onClick: (i) => setView(recent[i]) }]} />
        </Section>
      </div>

      <FamilyLinkDialog open={linkOpen} onClose={() => setLinkOpen(false)} />

      <Modal open={!!person} wide title={person ? `รีวิวของ ${person.staff_name}` : ""} onClose={() => setPerson(null)} footer={<button className="btn-primary" onClick={() => setPerson(null)}>ปิด</button>}>
        {person && (
          <>
            <div className="mb-4 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl bg-cream-50 p-3"><p className="text-xs text-gold-600">คะแนนเฉลี่ย</p><p className="text-2xl font-semibold text-gold-800">{person.avg.toFixed(2)}</p></div>
              <div className="rounded-xl bg-cream-50 p-3"><p className="text-xs text-gold-600">จำนวนรีวิว</p><p className="text-2xl font-semibold text-gold-800">{person.reviews}</p></div>
              <div className="rounded-xl bg-cream-50 p-3"><p className="text-xs text-gold-600">5 ดาว</p><p className="text-2xl font-semibold text-gold-800">{person.five}</p></div>
            </div>
            <DataTable columns={["วันเวลา", "ดาว", "ผู้รับบริการ", "คำชม", "ความเห็น"]} search={false}
              rows={forPerson.map((r) => [r.at, stars(r.rating), r.resident_name ?? "-", r.tags.join(", ") || "-", r.comment || "-"])} empty="ไม่มีรีวิวในรายการล่าสุด" />
          </>
        )}
      </Modal>

      <Modal open={!!view} title="รายละเอียดรีวิว" onClose={() => setView(null)} footer={<button className="btn-primary" onClick={() => setView(null)}>ปิด</button>}>
        {view && (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {[["วันเวลา", view.at], ["พนักงาน", view.staff_name], ["ผู้รับบริการ", view.resident_name ?? "-"], ["ผู้รีวิว", [view.rater_name || "ไม่ระบุชื่อ", view.relation].filter(Boolean).join(" · ")]]
              .map(([k, v]) => <div key={k}><dt className="text-gold-500">{k}</dt><dd className="font-medium">{v}</dd></div>)}
            <div><dt className="text-gold-500">ดาว</dt><dd className="review-stars text-lg">{stars(view.rating)}</dd></div>
            <div><dt className="text-gold-500">คำชม</dt><dd className="font-medium">{view.tags.join(", ") || "-"}</dd></div>
            <div className="sm:col-span-2"><dt className="text-gold-500">ความเห็น</dt><dd className="font-medium">{view.comment || "-"}</dd></div>
          </dl>
        )}
      </Modal>
    </>
  );
}
