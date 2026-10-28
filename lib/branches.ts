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

function load() {
  if (started || typeof window === "undefined") return;
  started = true;
  try { const c = JSON.parse(localStorage.getItem(CACHE) ?? "null"); if (Array.isArray(c) && c.length) { names = c; listeners.forEach((l) => l()); } } catch { /* ignore */ }
  fetch("/api/branches", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((d: { branches?: { name: string }[] } | null) => {
      const list = d?.branches?.map((b) => b.name).filter(Boolean) ?? [];
      if (!list.length) return;
      names = list;
      try { localStorage.setItem(CACHE, JSON.stringify(list)); } catch { /* ignore */ }
      listeners.forEach((l) => l());
    })
    .catch(() => {});
}

/** โหลดรายชื่อสาขาใหม่ (หลังเพิ่ม/แก้สาขา) */
export function reloadBranches() { started = false; load(); }

export function useBranchNames() {
  useEffect(load, []);
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => names, () => FALLBACK);
}

/** แทนตัวเลือกของช่อง "สาขา" ในฟอร์มด้วยรายชื่อจริง (ช่องที่มี "ส่วนกลาง" / "ทุกสาขา" นำหน้า คงไว้) */
export function withBranches(fields: FieldDef[], list: string[]): FieldDef[] {
  return fields.map((f) => {
    if (!/^สาขา/.test(f.label) || !f.options) return f;
    const lead = f.options.filter((o) => o === "ส่วนกลาง" || o === "ทุกสาขา");
    return { ...f, options: [...lead, ...list] };
  });
}
