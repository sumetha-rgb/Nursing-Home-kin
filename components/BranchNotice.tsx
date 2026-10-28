"use client";
import { useEffect, useState } from "react";
import Icon from "./Icon";
import type { SessionUser } from "@/lib/roles";

/** ป้ายบนแถบด้านบน: สาขาที่กำลังดูอยู่ */
export function BranchBadge({ user, compact = false }: { user: SessionUser; compact?: boolean }) {
  const all = user.role === "Global Admin";
  const bad = user.branchCheck === "missing" || user.branchCheck === "closed";
  return (
    <span className={`branch-badge ${all ? "is-all" : ""} ${bad ? "is-bad" : ""}`} title={all ? "เห็นข้อมูลทุกสาขา" : `เห็นเฉพาะข้อมูลสาขา${user.branch}`}>
      <Icon name="building" className="h-4 w-4 shrink-0" />
      {!compact && <small>กำลังดู</small>}
      <b>{all ? "ทุกสาขา" : user.branch || "ไม่ระบุสาขา"}</b>
    </span>
  );
}

const TEXT: Record<NonNullable<SessionUser["branchCheck"]>, (b: string) => { tone: "ok" | "warn" | "bad"; title: string; body: string }> = {
  all: () => ({ tone: "ok", title: "คุณกำลังดูข้อมูลของทุกสาขา", body: "บัญชีผู้บริหารองค์กรเห็นและจัดการข้อมูลได้ทุกสาขา ใช้ตัวกรองสาขาในแต่ละหน้าเพื่อดูทีละสาขา" }),
  ok: (b) => ({ tone: "ok", title: `ระบบตรวจสอบสาขาแล้ว · คุณกำลังดูข้อมูลของสาขา${b}`, body: "ทุกหน้าแสดงและบันทึกเฉพาะข้อมูลของสาขานี้ ข้อมูลส่วนกลางดูได้แต่แก้ไม่ได้" }),
  upcoming: (b) => ({ tone: "warn", title: `สาขา${b} อยู่ในสถานะเตรียมเปิด`, body: "คุณกำลังดูข้อมูลของสาขานี้เท่านั้น เตรียมข้อมูลผู้รับบริการและทีมไว้ได้ก่อนวันเปิด" }),
  closed: (b) => ({ tone: "bad", title: `สาขา${b} ปิดให้บริการแล้ว`, body: "กรุณาติดต่อผู้บริหารองค์กรเพื่อย้ายสาขาของบัญชีนี้" }),
  missing: (b) => ({ tone: "bad", title: `ไม่พบสาขา "${b || "-"}" ในหน้าสาขาของเรา`, body: "บัญชีนี้จะไม่เห็นข้อมูลของสาขาใดเลย กรุณาติดต่อผู้บริหารองค์กรให้แก้สาขาของบัญชีที่เมนูทีมและสิทธิ์การใช้งาน" }),
};

/**
 * แถบแจ้งหลังเข้าสู่ระบบ: ผลตรวจสาขาของบัญชี
 * สาขาปกติแสดงครั้งเดียวต่อการเข้าใช้ (ปิดได้) · สาขาที่มีปัญหาแสดงทุกครั้ง
 */
export default function BranchNotice({ user }: { user: SessionUser }) {
  const check = user.branchCheck ?? "ok";
  const key = `kin-branch-notice:${user.id}:${user.branch}`;
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (check === "missing" || check === "closed") { setShow(true); return; }
    try { setShow(!sessionStorage.getItem(key)); } catch { setShow(true); }
  }, [check, key]);
  if (!show) return null;
  const t = TEXT[check](user.branch);
  const close = () => { try { sessionStorage.setItem(key, "1"); } catch { /* ignore */ } setShow(false); };
  return (
    <div role={t.tone === "bad" ? "alert" : "status"} className={`branch-notice is-${t.tone}`}>
      <Icon name={t.tone === "ok" ? "building" : "alert"} className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1"><p className="font-semibold">{t.title}</p><p className="mt-0.5 text-sm opacity-90">{t.body}</p></div>
      {t.tone !== "bad" && <button type="button" className="branch-notice-close" onClick={close} aria-label="ปิดข้อความ"><Icon name="close" className="h-4 w-4" /></button>}
    </div>
  );
}
