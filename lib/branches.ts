"use client";
import { useEffect, useSyncExternalStore } from "react";
import type { FieldDef } from "@/components/ui";
import { BRANCH_NAMES as FALLBACK } from "./mock";

/**
 * รายชื่อสาขาจากหน้า "สาขาของเรา" (ตาราง branches) ใช้ในทุกช่องเลือกสาขา
 * โหลดครั้งเดียวต่อหน้า เก็บสำเนาในเครื่อง · โหลดไม่ได้ใช้รายชื่อตัวอย่าง
 */
const CACHE = "kin-cache:branch-names";
const listeners = new Set<() => void>();
let names: string[] = FALLBACK;
let started = false;
/** สาขาของผู้ใช้ที่ไม่ใช่ผู้บริหาร: ช่องเลือกสาขาแสดงเฉพาะสาขานี้ (server จำกัดข้อมูลตามสาขาอยู่แล้ว) */
let scope: string | null = null;
let scoped: string[] = names;
const notify = () => { scoped = scope ? [scope] : names; listeners.forEach((l) => l()); };

/** เรียกเมื่อรู้ว่าใครเข้าสู่ระบบ (lib/session) */
export function setBranchScope(u: { role: string; branch: string | null } | null) {
  const next = u && u.role !== "Global Admin" && u.branch ? u.branch : null;
  if (next !== scope) { scope = next; notify(); }
}

function load() {
  if (started || typeof window === "undefined") return;
  started = true;
  try { const c = JSON.parse(localStorage.getItem(CACHE) ?? "null"); if (Array.isArray(c) && c.length) { names = c; notify(); } } catch { /* ignore */ }
  fetch("/api/branches", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { branches?: { name: string }[] } | null) => {
      const list = d?.branches?.map((b) => b.name).filter(Boolean) ?? [];
      if (!list.length) return;
      names = list;
      try { localStorage.setItem(CACHE, JSON.stringify(list)); } catch { /* ignore */ }
      notify();
    })
    .catch(() => {});
}

/** โหลดรายชื่อสาขาใหม่ (หลังเพิ่ม/แก้สาขา) */
export function reloadBranches() { started = false; load(); }

/** รายชื่อสาขาสำหรับช่องเลือก · all = ทุกสาขา (หน้าสมัครสมาชิก) ไม่อย่างนั้นผู้จัดการ/พนักงานเห็นเฉพาะสาขาตัวเอง */
export function useBranchNames({ all = false }: { all?: boolean } = {}) {
  useEffect(load, []);
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => (all ? names : scoped), () => FALLBACK);
}

/** แทนตัวเลือกของช่อง "สาขา" ในฟอร์มด้วยรายชื่อจริง (ช่องที่มี "ส่วนกลาง" / "ทุกสาขา" นำหน้า คงไว้) */
export function withBranches(fields: FieldDef[], list: string[]): FieldDef[] {
  return fields.map((f) => {
    if (!/^สาขา/.test(f.label) || !f.options) return f;
    const lead = f.options.filter((o) => o === "ส่วนกลาง" || o === "ทุกสาขา");
    return { ...f, options: [...lead, ...list] };
  });
}
