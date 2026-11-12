/**
 * แอปทั้ง 3 ของ KIN (ใช้บัญชีเดียวกัน) · ชื่อชุดเดียวทั้งระบบ: ระบบจัดการ · KinApp · ห้องยา
 * เข้าสู่ระบบที่ไหนก็ได้ แล้วพาเข้าแอปให้เอง:
 *  - ใช้ได้แอปเดียว → เข้าแอปนั้น
 *  - ใช้ได้หลายแอป → แอปที่ใช้ล่าสุดในเครื่องนี้ · ยังไม่เคยใช้ → หน้าเลือกแอป (ครั้งเดียว)
 */
import { can, hasConsole } from "./perms";
import type { SessionUser } from "./roles";

export type AppId = "console" | "kinapp" | "pharmacy";
export type AppInfo = { id: AppId; name: string; href: string; icon: string; desc: string; users: string; fit: string };

export const APPS: Record<AppId, AppInfo> = {
  console: { id: "console", name: "ระบบจัดการ", href: "/", icon: "grid", desc: "งานบริหาร: สัญญา การเงิน ห้องพัก ตารางเวร รายงาน", users: "ผู้จัดการสาขา · หัวหน้าพยาบาล · ฝ่ายขาย", fit: "เหมาะกับคอม" },
  kinapp: { id: "kinapp", name: "KinApp", href: "/staff", icon: "phone", desc: "งานประจำวันของทีมดูแล: งานเวร จ่ายยา สัญญาณชีพ กายภาพ", users: "พยาบาล · ผู้ช่วยพยาบาล · นักกายภาพ", fit: "เหมาะกับมือถือ" },
  pharmacy: { id: "pharmacy", name: "ห้องยา", href: "/pharmacy", icon: "pill", desc: "จัดยาใส่ซอง ตรวจยาก่อนจ่าย คลังยา เวชภัณฑ์", users: "พยาบาล · หัวหน้าพยาบาล", fit: "งานห้องยา" },
};
export const APP_ORDER: AppId[] = ["console", "kinapp", "pharmacy"];

/** แอปที่บัญชีนี้เปิดได้ (ตามสิทธิ์ที่ติ๊กไว้) */
export function appsFor(u: SessionUser | null | undefined): AppId[] {
  if (!u) return [];
  return APP_ORDER.filter((id) => (id === "console" ? hasConsole(u) : can(u, id === "kinapp" ? "app.staff" : "app.pharmacy")));
}

/** แอปของหน้าที่เปิดอยู่ */
export function appAt(path: string): AppId {
  return path.startsWith("/staff") ? "kinapp" : path.startsWith("/pharmacy") ? "pharmacy" : "console";
}

const LAST_KEY = "kin-last-app";
const HINT_KEY = "kin-app-hint";
export function lastApp(): AppId | null {
  try { const v = localStorage.getItem(LAST_KEY); return v && v in APPS ? (v as AppId) : null; } catch { return null; }
}
export function rememberApp(id: AppId) {
  try { localStorage.setItem(LAST_KEY, id); } catch { /* โหมดส่วนตัว */ }
}

/** จอเล็ก (มือถือ) */
export const isPhone = () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches;

/** แอปที่แนะนำเมื่อเครื่องนี้ยังไม่เคยใช้: มือถือ → KinApp · คอมพิวเตอร์ → ระบบจัดการ */
export function suggestedApp(apps: AppId[]): AppId {
  const want: AppId = isPhone() ? "kinapp" : "console";
  return apps.includes(want) ? want : apps[0];
}

/** แอปที่จะพาเข้าเมื่อไม่ต้องถาม · null = ต้องให้เลือก (หลายแอป และเครื่องนี้ยังไม่เคยใช้) */
export function autoApp(apps: AppId[]): AppId | null {
  if (apps.length === 1) return apps[0];
  const last = lastApp();
  return last && apps.includes(last) ? last : null;
}

/** แอปที่ควรพาไปเมื่อเปิดหน้าที่บัญชีนี้ไม่มีสิทธิ์ (ไม่ถาม) */
export function fallbackApp(apps: AppId[]): AppId | null {
  return apps.length ? autoApp(apps) ?? suggestedApp(apps) : null;
}

/** ไปแอป · hint = แสดงป้าย "ไปแอปอื่นได้ที่ปุ่มแอป" ครั้งเดียวที่ปลายทาง (เฉพาะคนที่ใช้ได้หลายแอป) */
export function openApp(id: AppId, opts: { hint?: boolean; replace?: boolean; href?: string } = {}) {
  rememberApp(id);
  if (opts.hint) { try { sessionStorage.setItem(HINT_KEY, id); } catch { /* ไม่เป็นไร */ } }
  const href = opts.href ?? APPS[id].href;
  if (opts.replace) window.location.replace(href); else window.location.assign(href);
}
/** มีป้ายแนะนำรอแสดงที่แอปนี้ไหม · แสดงแล้วเรียก clearHint (แสดงครั้งเดียว) */
export function hasHint(id: AppId): boolean {
  try { return sessionStorage.getItem(HINT_KEY) === id; } catch { return false; }
}
export function clearHint() {
  try { sessionStorage.removeItem(HINT_KEY); } catch { /* ไม่เป็นไร */ }
}
export function setHint(id: AppId) {
  try { sessionStorage.setItem(HINT_KEY, id); } catch { /* ไม่เป็นไร */ }
}
