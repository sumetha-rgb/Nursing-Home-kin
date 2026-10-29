"use client";
import FamilyHub from "../care/FamilyHub";
import { useCallback, useEffect, useState } from "react";
import Icon from "../Icon";
import QrCode from "../QrCode";
import { useBranchNames, withBranches } from "@/lib/branches";
import { BRANCH_NAMES, COMPLAINTS } from "@/lib/mock";
import { useCrud } from "@/lib/store";
import { useApp } from "@/lib/app";
import { openHere, siteUrl } from "@/lib/site";
import { DataTable, Field, FieldDef, FormDialog, Modal, PageHeader, Section, Select, Toggle } from "../ui";

/* ---------- เสียงจากครอบครัว: ลิงก์/QR ของสาขา · เรื่องร้องเรียน · ผลประเมินความพึงพอใจ ---------- */
const COMPLAINT_FIELDS: FieldDef[] = [
  { label: "วันเวลา" },
  { label: "สาขา", options: BRANCH_NAMES },
  { label: "ปัญหาที่ร้องเรียน", area: true },
  { label: "เบอร์ติดต่อกลับ", type: "tel" },
  { label: "สถานะ", options: ["รอดำเนินการ", "กำลังดำเนินการ", "แก้ไขแล้ว"], required: true },
];

type Survey = {
  id: string; branch_name: string; rater_name: string | null; relation: string | null; resident_name: string | null;
  score_overall: number; score_care: number | null; score_staff: number | null; score_food: number | null; score_clean: number | null;
  comment: string | null; contact_phone: string | null; at: string;
};
type Kind = "survey" | "complaint";
const ASPECTS: [keyof Survey, string][] = [["score_overall", "โดยรวม"], ["score_care", "การดูแล"], ["score_staff", "พนักงาน"], ["score_food", "อาหาร"], ["score_clean", "ความสะอาด"]];
const avg = (list: Survey[], k: keyof Survey) => {
  const v = list.map((x) => x[k]).filter((n): n is number => typeof n === "number");
  return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(1) : "-";
};
const starText = (n: number | null) => (n ? `${"★".repeat(n)}${"☆".repeat(5 - n)}` : "-");
/** ลิงก์สาธารณะของสาขา (หน้า /survey ไม่ต้องเข้าสู่ระบบ) */
const linkOf = (branch: string, type: Kind) =>
  !branch ? "" : `${siteUrl()}/survey?branch=${encodeURIComponent(branch)}&type=${type}`;

export function Feedbacks() {
  const branchNames = useBranchNames();
  const { rows, update, remove } = useCrud("complaints", COMPLAINTS);
  const { toast, confirm } = useApp();
  const [modal, setModal] = useState<null | "share" | "line" | "results" | "sign">(null);
  const [branch, setBranch] = useState("");
  const [row, setRow] = useState<number | null>(null);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [open, setOpen] = useState<Survey | null>(null);
  const [hub, setHub] = useState(false);
  const close = () => setModal(null);
  // ผู้จัดการสาขามีสาขาเดียว: เลือกให้เลย
  useEffect(() => { if (branchNames.length === 1) setBranch(branchNames[0]); }, [branchNames]);
  const loadSurveys = useCallback(() => {
    fetch("/api/care?op=surveys", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { surveys: [] })).then((d) => setSurveys(d.surveys ?? [])).catch(() => {});
  }, []);
  useEffect(loadSurveys, [loadSurveys]);
  const links = { survey: linkOf(branch, "survey"), complaint: linkOf(branch, "complaint") };
  const copy = async (u: string) => {
    if (!u) { toast("กรุณาเลือกสาขาก่อน"); return; }
    try { await navigator.clipboard.writeText(u); toast("คัดลอกลิงก์แล้ว ส่งให้ญาติทาง LINE ได้เลย"); } catch { toast(u); }
  };
  const urgent = rows.filter((r) => r[4] === "รอดำเนินการ").length;

  const qrBox = (type: Kind, title: string, desc: string) => (
    <div className="qr-card">
      <QrCode text={links[type]} alt={`QR ${title}`} />
      <div>
        <h4>{title}</h4>
        <p>{desc}</p>
        {links[type] ? <code>{links[type]}</code> : <p className="mt-2 text-gold-500">เลือกสาขาก่อน</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-soft !py-2" onClick={() => copy(links[type])}>คัดลอกลิงก์</button>
          <button type="button" className="btn-soft !py-2" disabled={!links[type]} onClick={() => openHere(links[type])}><Icon name="external" className="h-4 w-4" /> เปิดดูหน้าฟอร์ม</button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <PageHeader
        title="เสียงจากครอบครัว"
        sub="ญาติสแกน QR หรือเปิดลิงก์ของสาขา เพื่อประเมินความพึงพอใจหรือแจ้งเรื่อง โดยไม่ต้องสมัครสมาชิก · เรื่องที่แจ้งเข้าตารางด้านล่างทันที"
        actions={<>
          <button className="btn-primary" onClick={() => setModal("share")}><Icon name="qr" className="h-4 w-4" /> ลิงก์และป้าย QR</button>
          <button className="btn-soft" onClick={() => setHub(true)}><Icon name="chat" className="h-4 w-4" /> ข่าวและลิงก์ญาติ</button>
          <button className="btn-soft" onClick={() => { loadSurveys(); toast("รีเฟรชข้อมูลแล้ว"); }}><Icon name="refresh" className="h-4 w-4" /> รีเฟรชข้อมูล</button>
        </>}
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="card p-5"><p className="text-sm text-gold-600">เรื่องร้องเรียนรอดำเนินการ</p><p className="mt-1 text-3xl font-semibold text-gold-800">{urgent}</p></div>
        <button className="card p-5 text-left transition hover:border-gold-400" onClick={() => { loadSurveys(); setModal("results"); }}>
          <p className="text-sm text-gold-600">ผลประเมินความพึงพอใจ</p>
          <p className="mt-1 text-3xl font-semibold text-gold-800">{avg(surveys, "score_overall")} <span className="text-base font-normal text-gold-600">/ 5 · {surveys.length} ความเห็น</span></p>
          <p className="mt-1 text-xs font-medium text-gold-700">กดเพื่อดูรายละเอียด</p>
        </button>
        <button className="card p-5 text-left transition hover:border-gold-400" onClick={() => setModal("line")}>
          <p className="text-sm font-medium text-gold-800">ตั้งค่าระบบ LINE</p>
          <p className="mt-1 text-xs text-gold-600">ยังไม่เชื่อมต่อ (เตรียมไว้สำหรับแจ้งเตือนเรื่องด่วน)</p>
        </button>
      </div>
      <Section title="เรื่องร้องเรียน / แจ้งเรื่อง">
        <DataTable
          columns={["วันเวลา", "สาขา", "ปัญหาที่ร้องเรียน", "เบอร์ติดต่อกลับ", "สถานะ"]}
          rows={rows}
          badgeCols={[4]}
          actions={[
            { label: "ตรวจสอบ", onClick: (i) => setRow(i) },
            { label: "ลบ", danger: true, onClick: (i) => confirm({ title: "ลบเรื่องร้องเรียน", message: "ต้องการลบรายการนี้ใช่หรือไม่", danger: true, okLabel: "ลบ", onOk: () => { remove(i); toast("ลบรายการแล้ว"); } }) },
          ]}
        />
      </Section>

      <FamilyHub open={hub} onClose={() => setHub(false)} />
      <FormDialog
        open={row !== null} mode="edit" title="จัดการเรื่องร้องเรียน" fields={withBranches(COMPLAINT_FIELDS, branchNames)} value={row !== null ? rows[row] : undefined}
        onClose={() => setRow(null)} onSave={(v) => { if (row !== null) update(row, v); setRow(null); toast("อัปเดตสถานะแล้ว"); }}
      />

      <Modal open={modal === "line"} title="ตั้งค่าเชื่อมต่อ LINE Messaging API" onClose={close} footer={<><button className="btn-soft" onClick={close}>ยกเลิก</button><button className="btn-primary" onClick={() => { close(); toast("บันทึกการตั้งค่า LINE แล้ว"); }}>บันทึกการตั้งค่า LINE</button></>}>
        <p className="mb-5 text-sm text-gold-600">กำหนดค่า LINE Channel Access Token และ LINE Group ID เพื่อให้ระบบสามารถดึงไปใช้ในการส่งแจ้งเตือนหรือบรอดแคสต์แบบประเมินได้ในอนาคต</p>
        <div className="space-y-4">
          <Toggle label="สถานะการใช้งาน LINE Bot" hint="เปิดเพื่ออนุญาตให้หุ่นยนต์ส่งข้อความแจ้งเตือน" />
          <Field label="เลือกสาขาที่ต้องการตั้งค่า:"><Select options={branchNames} /></Field>
          <Field label="1. LINE Channel Access Token" required><input /><p className="mt-1 text-xs text-gold-500">เอามาจากเว็บ LINE Developers (Long-lived token)</p></Field>
          <Field label="2. LINE Group ID (สำหรับกลุ่มผู้บริหารสาขา/แอดมินรับแจ้งเตือน)"><input /><p className="mt-1 text-xs text-gold-500">ไอดีของกลุ่มผู้บริหาร เพื่อรับแจ้งเตือนเวลามีเรื่องร้องเรียนด่วน</p></Field>
        </div>
      </Modal>

      <Modal open={modal === "share"} wide title="ลิงก์และป้าย QR Code สำหรับครอบครัว" onClose={close}
        footer={<><button className="btn-soft" onClick={close}>ปิด</button><button className="btn-primary" disabled={!branch} onClick={() => setModal("sign")}><Icon name="print" className="h-4 w-4" /> ดูและพิมพ์ป้ายตั้งโต๊ะ (A4)</button></>}>
        {branchNames.length > 1
          ? <Field label="เลือกสาขาที่ต้องการสร้างลิงก์"><Select options={branchNames} placeholder="-- เลือกสาขา --" value={branch} onChange={setBranch} /></Field>
          : <p className="text-sm text-gold-700">ลิงก์ของสาขา<b>{branch}</b></p>}
        <div className="mt-4 space-y-4">
          {qrBox("survey", "1. แบบประเมินความพึงพอใจ", "ส่งลิงก์ให้ญาติทาง LINE หลังเยี่ยม หรือทุกสิ้นเดือน ให้คะแนนดาว 1–5 พร้อมข้อเสนอแนะ")}
          {qrBox("complaint", "2. แจ้งเรื่อง / ร้องเรียนด่วน", "ตั้งป้าย QR ไว้ที่ศูนย์ เรื่องที่แจ้งเข้าตาราง \"เรื่องร้องเรียน\" ของสาขาทันที พร้อมเบอร์ติดต่อกลับ")}
        </div>
      </Modal>

      <Modal open={modal === "sign"} wide title="ป้ายตั้งโต๊ะ QR Code" onClose={() => setModal("share")}
        footer={<><button className="btn-soft" onClick={() => setModal("share")}>กลับ</button><button className="btn-primary" onClick={() => window.print()}><Icon name="print" className="h-4 w-4" /> พิมพ์ป้าย</button></>}>
        <div className="qr-sign">
          <div className="qr-sign-brand">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.png" alt="KIN" />
            <div className="text-left"><b>KIN Rehabilitation &amp; Homecare</b><span>สาขา{branch}</span></div>
          </div>
          <h2>ความเห็นของท่านสำคัญกับเรา</h2>
          <p>สแกนด้วยกล้องมือถือ ไม่ต้องสมัครสมาชิก ใช้เวลาไม่ถึง 1 นาที</p>
          <div className="qr-sign-grid">
            <div><QrCode text={links.survey} alt="QR ประเมินความพึงพอใจ" /><b>ประเมินความพึงพอใจ</b><small>ให้คะแนนการดูแล อาหาร ความสะอาด และพนักงาน</small></div>
            <div><QrCode text={links.complaint} alt="QR แจ้งเรื่อง" /><b>แจ้งเรื่อง / ร้องเรียน</b><small>ส่งตรงถึงผู้จัดการสาขา ติดต่อกลับโดยเร็ว</small></div>
          </div>
          <p className="qr-sign-foot">เรื่องเร่งด่วน โทร 02-096-4996 · kinrehab.com</p>
        </div>
      </Modal>

      <Modal open={modal === "results"} wide title="ผลประเมินความพึงพอใจจากครอบครัว" onClose={close} footer={<button className="btn-primary" onClick={close}>ปิด</button>}>
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {ASPECTS.map(([k, label]) => <div key={k} className="rounded-xl bg-cream-50 p-3 text-center"><p className="text-xs text-gold-600">{label}</p><p className="text-2xl font-semibold text-gold-800">{avg(surveys, k)}</p></div>)}
        </div>
        <DataTable columns={["วันเวลา", "สาขา", "ผู้ประเมิน", "โดยรวม", "ข้อเสนอแนะ"]} search={surveys.length > 5}
          rows={surveys.map((x) => [x.at, x.branch_name, [x.rater_name || "ไม่ระบุชื่อ", x.relation].filter(Boolean).join(" · "), starText(x.score_overall), x.comment || "-"])}
          empty="ยังไม่มีผลประเมิน · ส่งลิงก์หรือตั้งป้าย QR ให้ญาติ"
          actions={[{ label: "ดู", onClick: (n) => setOpen(surveys[n]) }]} />
      </Modal>

      <Modal open={!!open} title="รายละเอียดผลประเมิน" onClose={() => setOpen(null)} footer={<button className="btn-primary" onClick={() => setOpen(null)}>ปิด</button>}>
        {open && (
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            {[["วันเวลา", open.at], ["สาขา", open.branch_name], ["ผู้ประเมิน", open.rater_name || "ไม่ระบุชื่อ"], ["ความเกี่ยวข้อง", open.relation || "-"], ["ผู้รับบริการ", open.resident_name || "-"], ["เบอร์ติดต่อกลับ", open.contact_phone || "-"]]
              .map(([k, v]) => <div key={k}><dt className="text-gold-500">{k}</dt><dd className="font-medium">{v}</dd></div>)}
            {ASPECTS.map(([k, label]) => <div key={k}><dt className="text-gold-500">{label}</dt><dd className="font-medium text-[#b8862b]">{starText(open[k] as number | null)}</dd></div>)}
            <div className="sm:col-span-2"><dt className="text-gold-500">ข้อเสนอแนะ</dt><dd className="font-medium">{open.comment || "-"}</dd></div>
          </dl>
        )}
      </Modal>
    </>
  );
}
