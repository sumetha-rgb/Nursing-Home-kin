"use client";
import { useEffect, useSyncExternalStore } from "react";
import { DEFAULT_SHIFT, type ShiftCfg } from "@/lib/shifts";

/**
 * เวลากะของทุกสาขา (หน้าเว็บ · lib/shifts) · โหลดครั้งเดียวต่อหน้า จาก /api/roster?op=shift_starts
 *  useShiftCfg(สาขา) = { d: เริ่มกะเช้า, n: เริ่มกะดึก } (ยังโหลดไม่เสร็จ/ไม่ได้ตั้ง = 07:00 / 19:00) · ตั้งค่าใหม่แล้วเรียก reloadShiftStarts()
 */
let cfgs: Record<string, ShiftCfg> = {};
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
export function reloadShiftStarts() {
  loading = fetch("/api/roster?op=shift_starts", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : { shifts: {} }))
    .then((d: { shifts?: Record<string, ShiftCfg> }) => { cfgs = d.shifts ?? {}; emit(); })
    .catch(() => {});
  return loading;
}
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export function useShiftCfgs(): Record<string, ShiftCfg> {
  useEffect(() => { if (!loading) reloadShiftStarts(); }, []);
  return useSyncExternalStore(subscribe, () => cfgs, () => cfgs);
}
export function useShiftCfg(branch?: string | null): ShiftCfg {
  const all = useShiftCfgs();
  return (branch && all[branch]) || DEFAULT_SHIFT;
}
