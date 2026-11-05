"use client";
import { useEffect, useSyncExternalStore } from "react";

/**
 * ข้อมูลผู้ขายในใบกำกับภาษีของแต่ละสาขา: เลขประจำตัวผู้เสียภาษี 13 หลัก และ สำนักงานใหญ่ / สาขาที่ 00001
 * เก็บใน doc_settings คีย์ tax_info = { [ชื่อสาขา]: { taxId, office } } · ผู้จัดการสาขาและผู้บริหารแก้ได้
 */
export type TaxInfo = { taxId: string; office: string };
let map: Record<string, TaxInfo> = {};
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());

function load() {
  if (!loading) {
    loading = fetch("/api/clinic?op=doc_settings", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { try { map = JSON.parse(d?.settings?.tax_info || "{}") || {}; } catch { map = {}; } emit(); })
      .catch(() => { loading = null; });
  }
  return loading;
}

export function useTaxInfo() {
  const m = useSyncExternalStore((f) => { listeners.add(f); return () => { listeners.delete(f); }; }, () => map, () => map);
  useEffect(() => { load(); }, []);
  return m;
}

/** เลขผู้เสียภาษีแสดงแบบ 0-1055-12345-67-8 */
export const taxIdText = (v: string) => { const d = v.replace(/\D/g, ""); return d.length === 13 ? `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}` : v; };

/** บันทึกข้อมูลภาษีของสาขา (โหลดค่าล่าสุดก่อน เพื่อไม่ทับของสาขาอื่น) */
export async function saveTaxInfo(branch: string, info: TaxInfo) {
  loading = null;
  await load();
  const next = { ...map, [branch]: info };
  const r = await fetch("/api/clinic", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "doc_settings", key: "tax_info", value: JSON.stringify(next) }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "บันทึกไม่สำเร็จ");
  map = next; emit();
}
