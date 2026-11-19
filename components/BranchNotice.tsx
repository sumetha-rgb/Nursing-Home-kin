"use client";
import { useEffect, useRef, useState } from "react";
import { ROLE_INFO, seesAllBranches } from "@/lib/roles";
import Icon from "./Icon";
import type { SessionUser } from "@/lib/roles";

type BranchRow = { name: string; status?: string | null; legal?: string | null };
const coShort = (c: string) => c.replace(/^บริษัท\s*/, "").replace(/\s*จำกัด(\s*\(มหาชน\))?$/, "");
const isExec = (u: SessionUser) => (u.viewAs ?? u.role) === "Global Admin";

/**
 * ผู้บริหารเลือกดูทีละสาขา: กดป้าย "กำลังดู" (แถบด้านบน) หรือการ์ดสาขา (แถบซ้าย) → รายการสาขาแยกตามบริษัท
 *  เลือกแล้วทุกหน้าเห็นเฉพาะสาขานั้น (server กรองให้ · /api/auth/view) แล้วโหลดหน้าใหม่ · "ทุกสาขา" = กลับไปดูทั้งหมด
 */
function BranchMenu({ user, align, onClose }: { user: SessionUser; align: "left" | "right"; onClose: () => void }) {
  const [rows, setRows] = useState<BranchRow[] | null>(null);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    fetch("/api/branches", { cache: "no-store" }).then((r) => r.json()).then((d) => setRows(d.branches ?? [])).catch(() => setErr("โหลดรายชื่อสาขาไม่สำเร็จ"));
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  useEffect(() => { first.current?.focus(); }, [rows]);
  const cur = user.viewAs ? user.branch : "";
  const pick = async (branch: string) => {
    if (branch === cur) return onClose();
    setBusy(branch || "all"); setErr("");
    const r = await fetch("/api/auth/view", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ branch }) }).catch(() => null);
    if (!r || !r.ok) { setBusy(""); setErr((await r?.json().catch(() => ({})))?.error || "เปลี่ยนสาขาไม่สำเร็จ ลองอีกครั้ง"); return; }
    window.location.reload();
  };
  const groups = new Map<string, BranchRow[]>();
  for (const b of rows ?? []) {
    const k = b.legal && b.legal.trim() && b.legal.trim() !== "-" ? coShort(b.legal.trim()) : "ยังไม่ระบุบริษัท";
    groups.set(k, [...(groups.get(k) ?? []), b]);
  }
  return <>
    <button type="button" aria-label="ปิดรายการสาขา" className="fixed inset-0 z-40 cursor-default" onClick={onClose} />
    <div role="menu" aria-label="เลือกสาขาที่จะดู" className={`branch-menu is-${align}`}>
      <p className="branch-menu-h">ดูข้อมูลของ</p>
      <button ref={first} type="button" role="menuitemradio" aria-checked={!cur} className={`branch-menu-item ${!cur ? "is-on" : ""}`} disabled={!!busy} onClick={() => pick("")}>
        <Icon name="building" className="h-4 w-4 shrink-0" /><span>ทุกสาขา<small>ภาพรวมทั้งองค์กร</small></span>{!cur && <i aria-hidden="true">✓</i>}{busy === "all" && <em>กำลังเปลี่ยน…</em>}
      </button>
      {!rows && !err && <p className="branch-menu-note">กำลังโหลด…</p>}
      {[...groups.entries()].map(([co, list]) => (
        <div key={co} role="group" aria-label={co}>
          <p className="branch-menu-co">{co}</p>
          {list.map((b) => {
            const on = b.name === cur, st = (b.status ?? "").trim();
            return (
              <button key={b.name} type="button" role="menuitemradio" aria-checked={on} className={`branch-menu-item ${on ? "is-on" : ""}`} disabled={!!busy} onClick={() => pick(b.name)}>
                <span className="branch-menu-dot" aria-hidden="true" /><span>สาขา{b.name}{st && st !== "เปิด" ? <small>{st}</small> : null}</span>{on && <i aria-hidden="true">✓</i>}{busy === b.name && <em>กำลังเปลี่ยน…</em>}
              </button>
            );
          })}
        </div>
      ))}
      {err && <p role="alert" className="branch-menu-note is-bad">{err}</p>}
      <p className="branch-menu-note">เลือกสาขาแล้วทุกหน้าจะเห็นเฉพาะข้อมูลสาขานั้น · ข้อมูลที่เพิ่มใหม่จะเข้าสาขาที่เลือก</p>
    </div>
  </>;
}

/** ป้ายบนแถบด้านบน: สาขาที่กำลังดูอยู่ · ผู้บริหารกดเพื่อเลือกสาขา */
export function BranchBadge({ user, compact = false }: { user: SessionUser; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const all = seesAllBranches(user.role);
  const bad = user.branchCheck === "missing" || user.branchCheck === "closed";
  const label = all ? "ทุกสาขา" : user.branch || "ไม่ระบุสาขา";
  const inner = <><Icon name="building" className="h-4 w-4 shrink-0" />{!compact && <small>กำลังดู</small>}<b>{label}</b></>;
  if (!isExec(user)) return (
    <span className={`branch-badge ${all ? "is-all" : ""} ${bad ? "is-bad" : ""}`} title={all ? "เห็นข้อมูลทุกสาขา" : `เห็นเฉพาะข้อมูลสาขา${user.branch}`}>{inner}</span>
  );
  return (
    <span className="branch-pick">
      <button type="button" className={`branch-badge is-btn ${all ? "is-all" : "is-view"}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}
        title={all ? "กดเพื่อเลือกดูทีละสาขา" : `กำลังดูเฉพาะสาขา${user.branch} · กดเพื่อเปลี่ยนสาขา`}>{inner}<span aria-hidden="true" className="branch-caret">▾</span></button>
      {open && <BranchMenu user={user} align="right" onClose={() => setOpen(false)} />}
    </span>
  );
}

/** การ์ดสาขาในแถบซ้าย · ผู้บริหารกดเพื่อเลือกสาขา (รายการเดียวกับป้ายด้านบน) */
export function WorkspaceIdentity({ user }: { user: SessionUser }) {
  const [open, setOpen] = useState(false);
  const all = seesAllBranches(user.role);
  const title = all ? "ทุกสาขา" : `สาขา${user.branch}`;
  const sub = user.viewAs ? "ผู้บริหาร · ดูในฐานะสาขานี้ · กดเพื่อเปลี่ยน" : user.role === "Global Admin" ? "ผู้บริหาร · เห็นข้อมูลทุกสาขา · กดเพื่อเลือกสาขา"
    : all ? `${ROLE_INFO[user.role].th} · เห็นทุกสาขา (ดูอย่างเดียว)` : `${ROLE_INFO[user.role].th} · เห็นเฉพาะสาขานี้`;
  const body = <><span className="workspace-monogram">{user.viewAs ? (user.branch.trim().charAt(0) || "K") : "K"}</span><div><strong>{title}</strong><span>{sub}</span></div>{isExec(user) ? <span aria-hidden="true" className="branch-caret">▾</span> : <span className="workspace-live" />}</>;
  if (!isExec(user)) return <div className="workspace-identity">{body}</div>;
  return (
    <div className="branch-pick is-block">
      <button type="button" className={`workspace-identity is-btn ${user.viewAs ? "is-view" : ""}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>{body}</button>
      {open && <BranchMenu user={user} align="left" onClose={() => setOpen(false)} />}
    </div>
  );
}

const TEXT: Record<NonNullable<SessionUser["branchCheck"]>, (b: string) => { tone: "ok" | "warn" | "bad"; title: string; body: string }> = {
  all: () => ({ tone: "ok", title: "คุณกำลังดูข้อมูลของทุกสาขา", body: "บัญชีผู้บริหารองค์กรเห็นและจัดการข้อมูลได้ทุกสาขา ใช้ตัวกรองสาขาในแต่ละหน้าเพื่อดูทีละสาขา" }),
  ok: (b) => ({ tone: "ok", title: `ระบบตรวจสอบสาขาแล้ว · คุณกำลังดูข้อมูลของสาขา${b}`, body: "ทุกหน้าแสดงและบันทึกเฉพาะข้อมูลของสาขานี้ ข้อมูลส่วนกลางดูได้แต่แก้ไม่ได้" }),
  upcoming: (b) => ({ tone: "warn", title: `สาขา${b} อยู่ในสถานะเตรียมเปิด`, body: "คุณกำลังดูข้อมูลของสาขานี้เท่านั้น เตรียมข้อมูลผู้รับบริการและทีมไว้ได้ก่อนวันเปิด" }),
  closed: (b) => ({ tone: "bad", title: `สาขา${b} ปิดให้บริการแล้ว`, body: "กรุณาติดต่อผู้บริหารองค์กรเพื่อย้ายสาขาของบัญชีนี้" }),
  missing: (b) => ({ tone: "bad", title: `ไม่พบสาขา "${b || "-"}" ในหน้าข้อมูลสาขา`, body: "บัญชีนี้จะไม่เห็นข้อมูลของสาขาใดเลย กรุณาติดต่อผู้บริหารองค์กรให้แก้สาขาของบัญชีที่เมนูทีมและสิทธิ์การใช้งาน" }),
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
    // สาขาปกติ: แสดงครั้งแรกครั้งเดียว (จำไว้ทันที) เปลี่ยนหน้า/รีเฟรชแล้วไม่ขึ้นอีกจนกว่าจะเข้าระบบใหม่
    try { const seen = !!sessionStorage.getItem(key); setShow(!seen); if (!seen && check !== "upcoming") sessionStorage.setItem(key, "1"); } catch { setShow(true); }
  }, [check, key]);
  if (!show) return null;
  const t = TEXT[check](user.branch);
  const close = () => { try { sessionStorage.setItem(key, "1"); } catch { /* ignore */ } setShow(false); };
  // สาขาปกติ: บรรทัดเดียว ไม่กินพื้นที่หน้า
  if (check === "ok" || check === "all") return (
    <div role="status" className="branch-notice-slim">
      <span className="branch-notice-dot" aria-hidden />{check === "all" ? "กำลังดูข้อมูลทุกสาขา" : `กำลังดูข้อมูลสาขา${user.branch} · บันทึกได้เฉพาะสาขานี้`}
      <button type="button" className="branch-notice-close" onClick={close} aria-label="ปิดข้อความ"><Icon name="close" className="h-3.5 w-3.5" /></button>
    </div>
  );
  return (
    <div role={t.tone === "bad" ? "alert" : "status"} className={`branch-notice is-${t.tone}`}>
      <Icon name={t.tone === "ok" ? "building" : "alert"} className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 flex-1"><p className="font-semibold">{t.title}</p><p className="mt-0.5 text-sm opacity-90">{t.body}</p></div>
      {t.tone !== "bad" && <button type="button" className="branch-notice-close" onClick={close} aria-label="ปิดข้อความ"><Icon name="close" className="h-4 w-4" /></button>}
    </div>
  );
}
