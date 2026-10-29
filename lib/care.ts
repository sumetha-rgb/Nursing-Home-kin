"use client";
import { useCallback, useEffect, useState } from "react";
import { isIdle } from "./store";

/** ตัวช่วยฝั่งหน้าเว็บสำหรับ /api/care: รายชื่อผู้รับบริการ ประวัติรายบุคคล แจ้งเตือนสัญญาณชีพ */
export type ResidentLite = { id: string; full_name: string; age: number | null; room: string | null; branch_name: string | null; status: string | null; chronic_diseases: string | null };
export type CareAlert = { id: string; area: string; record_id: string; resident_id: string | null; resident_name: string | null; branch_name: string | null; level: "watch" | "critical"; summary: string; vital_text: string | null; created_by: string | null; created_at: string };

const CACHE = "kin-cache:residents";

async function call<T>(url: string, body?: object): Promise<T> {
  const r = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "โหลดข้อมูลไม่สำเร็จ");
  return d as T;
}

/** รายชื่อผู้รับบริการในสาขา (ออฟไลน์ใช้สำเนาล่าสุดในเครื่อง) */
export function useResidents() {
  const [list, setList] = useState<ResidentLite[]>(() => { try { return JSON.parse(localStorage.getItem(CACHE) ?? "[]"); } catch { return []; } });
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(() => {
    call<{ residents: ResidentLite[] }>("/api/care?op=residents")
      .then((d) => { setList(d.residents); try { localStorage.setItem(CACHE, JSON.stringify(d.residents)); } catch { /* ignore */ } })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);
  // ผู้รับบริการที่ผู้จัดการ/แคชเชียร์เพิ่มหรือย้ายห้อง ให้ KinApp และแอปจัดยาเห็นตามโดยไม่ต้องรีเฟรช
  useEffect(() => {
    reload();
    const t = setInterval(() => { if (document.visibilityState === "visible" && !isIdle()) reload(); }, 30_000);
    window.addEventListener("focus", reload);
    return () => { clearInterval(t); window.removeEventListener("focus", reload); };
  }, [reload]);
  return { residents: list, loaded, reload };
}

export const fetchProfile = (id: string) => call<Profile>(`/api/care?op=profile&id=${encodeURIComponent(id)}`);
/** รายชื่อพยาบาลของสาขา (ตัวเลือกผู้ดูแลในนัดหมาย) */
export const fetchNurses = () => call<{ nurses: string[] }>("/api/care?op=nurses").then((d) => d.nurses);
export const ackAlert = (id: string, note: string) => call<{ ok: boolean }>("/api/care", { op: "ack", id, note });

/** แจ้งเตือนที่ยังไม่มีคนรับทราบ ดึงใหม่ทุก 1 นาที และเมื่อกลับมาที่หน้านี้ */
export function useAlerts() {
  const [alerts, setAlerts] = useState<CareAlert[]>([]);
  const reload = useCallback(() => { call<{ alerts: CareAlert[] }>("/api/care?op=alerts").then((d) => setAlerts(d.alerts)).catch(() => {}); }, []);
  useEffect(() => {
    reload();
    const t = setInterval(() => { if (document.visibilityState === "visible" && !isIdle()) reload(); }, 60_000);
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    window.addEventListener("kin-vitals-saved", onFocus);
    return () => { clearInterval(t); window.removeEventListener("focus", onFocus); window.removeEventListener("kin-vitals-saved", onFocus); };
  }, [reload]);
  return { alerts, reload };
}
/** บอกตัวนับแจ้งเตือนให้ดึงใหม่ หลังบันทึกสัญญาณชีพ (รอ server สร้างแจ้งเตือนก่อน) */
export const notifyVitalsSaved = () => setTimeout(() => window.dispatchEvent(new Event("kin-vitals-saved")), 1500);

type Row = Record<string, unknown>;
export type Profile = {
  resident: ResidentLite;
  health: Row[]; daily: Row[]; meds: Row[]; packs: Row[]; appts: Row[]; tasks: Row[]; handovers: Row[]; alerts: Row[]; contracts: Row[]; plans: Row[];
};

/* ---------- รูปแบบวันที่ ---------- */
const pad = (n: number) => String(n).padStart(2, "0");
/** "2026-10-26 07:30:00" → "26/10/69 07:30" · "2026-10-26" → "26/10/69" */
export function thDate(v: unknown, withTime = true) {
  const s = String(v ?? "");
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return s || "-";
  const d = `${m[3]}/${m[2]}/${String(Number(m[1]) + 543).slice(2)}`;
  return withTime && m[4] ? `${d} ${m[4]}:${m[5]}` : d;
}
/** เวลา ISO (UTC) → วันเวลาไทย */
export function thWhen(iso: unknown) {
  const d = new Date(String(iso ?? ""));
  if (Number.isNaN(d.getTime())) return "-";
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(d.getFullYear() + 543).slice(2)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
