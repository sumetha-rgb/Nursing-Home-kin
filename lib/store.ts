"use client";
import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * ที่เก็บข้อมูลฝั่งหน้าเว็บ ซิงก์กับฐานข้อมูล Neon ผ่าน /api/data/[key]
 * แก้ไขในหน้าจอทันที (optimistic) แล้วค่อยส่งไปบันทึก
 * ครั้งแรกที่ชุดข้อมูลยังไม่มีในฐานข้อมูล จะใส่ข้อมูลตัวอย่าง (initial) ให้
 *
 * ใช้งานออฟไลน์ (KinApp / แอปจัดยา):
 *  - การบันทึกทุกครั้งเข้าคิว outbox ที่เก็บในเครื่อง ส่งทีละรายการตามลำดับ
 *    เน็ตหลุด = รอในคิว แล้วส่งต่อเองเมื่อกลับมาออนไลน์ (ปิดแอปแล้วเปิดใหม่ก็ยังอยู่)
 *  - ชุดข้อมูล staff-* / pharmacy-* เก็บสำเนาล่าสุดในเครื่อง เปิดดูได้ตอนออฟไลน์
 *
 * ข้อมูลตรงกันทุกเครื่อง (ทุกตำแหน่งเห็นข้อมูลชุดเดียวกัน):
 *  - ชุดข้อมูลที่หน้าจอกำลังแสดง ดึงใหม่ทุก 20 วินาที (หยุดเมื่อซ่อนแท็บหรือไม่ได้แตะหน้าจอเกิน 5 นาที) เมื่อกลับมาที่แท็บ/แอป และเมื่อเปิดหน้านั้นอีกครั้ง
 *  - ไม่ดึงทับระหว่างมีรายการรอส่งของชุดนั้น หรือระหว่างเปิดหน้าต่างแก้ไข (กันข้อมูลที่กำลังกรอกหาย/แก้ผิดแถว)
 *  - ข้อมูลไม่เปลี่ยน = ไม่วาดหน้าจอใหม่
 */
type Item<T> = { id: string; data: T };
type Entry = { items: Item<unknown>[]; loaded: boolean; error: boolean };

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const EMPTY: Entry = { items: [], loaded: false, error: false };
const isBrowser = typeof window !== "undefined";

/* ---------- สำเนาในเครื่อง ---------- */
const CACHE = "kin-cache:";
const OUTBOX = "kin-outbox";
const cacheable = (key: string) => /^(staff|pharmacy)-/.test(key);
const ls = {
  get<T>(k: string): T | null { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* เต็มหรือถูกปิด: ใช้ต่อได้แต่ไม่มีสำเนา */ } },
};

export const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const fetchedAt = new Map<string, number>();
const mounted = new Map<string, number>();
const put = (key: string, e: Partial<Entry>) => {
  const next = { ...(store.get(key) ?? EMPTY), ...e };
  store.set(key, next);
  if (isBrowser && cacheable(key) && next.loaded && !next.error) ls.set(CACHE + key, next.items);
  emit();
};

class Offline extends Error {}
async function call(key: string, body?: object) {
  let res: Response;
  try {
    res = await fetch(`/api/data/${encodeURIComponent(key)}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  } catch { throw new Offline("offline"); }
  // 401 = session หมดอายุ / 502-504 = เซิร์ฟเวอร์ไม่ตอบ: เก็บไว้ส่งใหม่ ไม่ทิ้งงานที่บันทึกไว้
  if (res.status === 401 || res.status >= 502) throw new Offline(String(res.status));
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as { seeded: boolean; items: Item<unknown>[] };
}

/* ---------- สถานะการเชื่อมต่อ (ใช้แสดงแถบออฟไลน์) ---------- */
type Op = { key: string; body: object };
let outbox: Op[] = (isBrowser && ls.get<Op[]>(OUTBOX)) || [];
let online = isBrowser ? navigator.onLine : true;
let status = { online, pending: outbox.length };
const setStatus = () => { if (status.online !== online || status.pending !== outbox.length) { status = { online, pending: outbox.length }; emit(); } };
const saveOutbox = () => { ls.set(OUTBOX, outbox); setStatus(); };
const stale = new Set<string>(); // ชุดข้อมูลที่เปิดจากสำเนา ต้องโหลดใหม่เมื่อออนไลน์

function load<T>(key: string, initial: () => Item<T>[]) {
  if (store.get(key)?.loaded || inflight.has(key)) return;
  const p = (async () => {
    try {
      let r = await call(key);
      if (!r.seeded) r = await call(key, { op: "seed", items: initial() });
      online = true; setStatus();
      // ยังมีรายการรอส่งของชุดนี้: ใช้ของในเครื่องไปก่อน ผลจากฐานข้อมูลจะมาหลังส่งครบ
      fetchedAt.set(key, Date.now());
      if (!outbox.some((o) => o.key === key)) put(key, { items: r.items, loaded: true, error: false });
      else put(key, { loaded: true, error: false });
    } catch (e) {
      const cached = cacheable(key) ? ls.get<Item<unknown>[]>(CACHE + key) : null;
      if (e instanceof Offline) { online = false; setStatus(); }
      if (cached) { stale.add(key); put(key, { items: cached, loaded: true, error: false }); }
      else { console.error(`โหลดข้อมูล ${key} ไม่สำเร็จ`, e); put(key, { loaded: true, error: true }); }
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
}

/** ส่งคิวทีละรายการตามลำดับ หยุดเมื่อออฟไลน์ ใช้ผลจากฐานข้อมูลแทนของในหน้าจอเมื่อไม่มีรายการรอส่งของชุดนั้นแล้ว */
let flushing = false;
async function flush() {
  if (flushing || !isBrowser) return;
  flushing = true;
  try {
    while (outbox.length) {
      const op = outbox[0];
      let r;
      try { r = await call(op.key, op.body); }
      catch (e) {
        if (e instanceof Offline) { online = false; setStatus(); return; }
        console.error(`บันทึกข้อมูล ${op.key} ไม่สำเร็จ`, e);
        outbox.shift(); saveOutbox();
        put(op.key, { error: true, loaded: false });
        load(op.key, () => []);
        continue;
      }
      online = true; outbox.shift(); saveOutbox();
      if (!outbox.some((o) => o.key === op.key)) put(op.key, { items: r.items, error: false });
    }
    for (const key of stale) { stale.delete(key); put(key, { loaded: false }); load(key, () => []); }
  } finally {
    flushing = false;
  }
}
function sync(key: string, body: object) {
  outbox.push({ key, body });
  saveOutbox();
  flush();
}

if (isBrowser) {
  window.addEventListener("online", () => { online = true; setStatus(); flush(); });
  window.addEventListener("offline", () => { online = false; setStatus(); });
  setTimeout(flush, 0); // ส่งรายการที่ค้างจากครั้งก่อน
}

/** สถานะออนไลน์และจำนวนรายการที่รอส่ง */
export function useSyncStatus() {
  return useSyncExternalStore(subscribe, () => status, () => status);
}

/** ล้างสำเนาและคิวในเครื่อง (เรียกตอนออกจากระบบ) */
export function clearOfflineData() {
  try {
    Object.keys(localStorage).filter((k) => k.startsWith(CACHE)).forEach((k) => localStorage.removeItem(k));
    localStorage.removeItem(OUTBOX);
  } catch { /* ignore */ }
  outbox = []; setStatus();
}

/** ข้อมูลในเครื่องเป็นของผู้ใช้คนเดียว: ถ้าคนอื่นเข้าสู่ระบบในเครื่องนี้ ล้างของคนก่อนทิ้ง ไม่ส่งงานค้างในชื่อคนใหม่ */
const OWNER = "kin-offline-owner";
export function setOfflineOwner(userId: string) {
  const prev = ls.get<string>(OWNER);
  if (prev && prev !== userId) clearOfflineData();
  ls.set(OWNER, userId);
}

/** ดึงชุดข้อมูลใหม่จากฐานข้อมูล (ข้อมูลที่คนอื่นเพิ่ม/แก้) · ข้ามถ้ามีรายการรอส่ง กำลังโหลด หรือเปิดหน้าต่างแก้ไขอยู่ */
const later = new Set<string>(); // ดึงไม่ได้ตอนนี้ (เปิดหน้าต่างแก้ไข/มีรายการรอส่ง) ไว้ดึงทันทีที่ทำได้
async function refresh(key: string) {
  if (!isBrowser || !store.get(key)?.loaded) return;
  if (inflight.has(key) || outbox.some((o) => o.key === key) || document.querySelector(".modal-overlay")) { later.add(key); return; }
  later.delete(key);
  const p = (async () => {
    try {
      const r = await call(key);
      fetchedAt.set(key, Date.now());
      online = true; setStatus();
      if (outbox.some((o) => o.key === key)) return;
      const cur = store.get(key);
      if (JSON.stringify(cur?.items) !== JSON.stringify(r.items)) put(key, { items: r.items, error: false });
    } catch (e) { if (e instanceof Offline) { online = false; setStatus(); } }
    finally { inflight.delete(key); }
  })();
  inflight.set(key, p);
  await p;
}
/** ผู้ใช้ไม่ได้แตะหน้าจอเกิน 5 นาที = หยุดดึงอัตโนมัติ (ขยับ/แตะอีกครั้งจะดึงทันที) */
const IDLE_MS = 5 * 60_000;
let lastTouch = Date.now();
export const isIdle = () => Date.now() - lastTouch > IDLE_MS;
const refreshMounted = () => { if (document.visibilityState === "visible" && !isIdle()) { lastPoll = Date.now(); mounted.forEach((n, key) => { if (n > 0) refresh(key); }); } };
let lastPoll = Date.now();
if (isBrowser) {
  setInterval(() => {
    if (later.size && !document.querySelector(".modal-overlay")) [...later].forEach((k) => refresh(k));
    if (Date.now() - lastPoll >= 20_000) refreshMounted();
  }, 3000);
  const touch = () => {
    const wasIdle = isIdle();
    lastTouch = Date.now();
    if (wasIdle) refreshMounted();
  };
  // throttle: บันทึกเวลาไม่เกินวินาทีละครั้ง (mousemove/scroll ยิงถี่)
  let last = 0;
  const onAct = () => { const n = Date.now(); if (n - last < 1000 && !isIdle()) return; last = n; touch(); };
  (["pointerdown", "keydown", "scroll", "touchstart", "mousemove"] as const).forEach((e) => window.addEventListener(e, onAct, { passive: true, capture: true }));
  window.addEventListener("focus", () => { lastTouch = Date.now(); refreshMounted(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") lastTouch = Date.now(); refreshMounted(); });
}
/** ให้หน้าจอสั่งดึงข้อมูลใหม่ทันที (เช่น ปุ่มรีเฟรช) */
export const refreshData = (key?: string) => (key ? refresh(key) : refreshMounted());

function useEntry<T>(key: string, initial: () => Item<T>[]) {
  useEffect(() => {
    load(key, initial);
    mounted.set(key, (mounted.get(key) ?? 0) + 1);
    // เปิดหน้านี้อีกครั้ง: ข้อมูลเก่ากว่า 5 วินาที ดึงใหม่
    if (store.get(key)?.loaded && Date.now() - (fetchedAt.get(key) ?? 0) > 5000) refresh(key);
    return () => { mounted.set(key, (mounted.get(key) ?? 1) - 1); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return useSyncExternalStore(subscribe, () => store.get(key) ?? EMPTY, () => EMPTY) as { items: Item<T>[]; loaded: boolean; error: boolean };
}

/** ตารางแบบแถวข้อความ (string[][]) ใช้กับหน้าระบบจัดการ */
export function useCrud(key: string, initial: string[][]) {
  const { items, loaded, error } = useEntry<string[]>(key, () => initial.map((data) => ({ id: newId(), data })));
  const rows = items.map((x) => x.data);
  const local = (next: Item<string[]>[]) => put(key, { items: next });
  const set = useCallback((next: string[][]) => {
    const list = next.map((data) => ({ id: newId(), data }));
    local(list);
    sync(key, { op: "replace", items: list });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return {
    rows, ids: items.map((x) => x.id), loaded, error, set,
    /** คืนรหัสรายการใหม่ (ใช้แนบข้อมูลที่เก็บแยก เช่น รูปบัตรของสัญญา) */
    add: (r: string[]) => { const it = { id: newId(), data: r }; local([it, ...items]); sync(key, { op: "upsert", items: [it] }); return it.id; },
    update: (i: number, r: string[]) => { const it = { ...items[i], data: r }; local(items.map((x, j) => (j === i ? it : x))); sync(key, { op: "upsert", items: [it] }); },
    remove: (i: number) => { const id = items[i]?.id; local(items.filter((_, j) => j !== i)); if (id) sync(key, { op: "delete", ids: [id] }); },
    clear: () => { local([]); sync(key, { op: "clear" }); },
  };
}

/**
 * รายการแบบ object ที่มีฟิลด์ id ของตัวเอง ใช้แทน useState: const [list, setList] = useRecords(key, initial)
 * setList(next) จะเทียบกับของเดิมตาม id แล้วบันทึกเฉพาะรายการที่เพิ่ม/แก้/ลบ
 */
export function useRecords<T extends { id: string | number }>(key: string, initial: T[]) {
  const { items, loaded, error } = useEntry<T>(key, () => initial.map((data) => ({ id: String(data.id), data })));
  const list = items.map((x) => x.data);
  const setList = (next: T[]) => {
    const prev = new Map(items.map((x) => [x.id, x.data]));
    const nextIds = new Set(next.map((x) => String(x.id)));
    const changed = next.filter((x) => prev.get(String(x.id)) !== x).map((data) => ({ id: String(data.id), data }));
    const removed = items.filter((x) => !nextIds.has(x.id)).map((x) => x.id);
    put(key, { items: next.map((data) => ({ id: String(data.id), data })) });
    if (changed.length) sync(key, { op: "upsert", items: changed });
    if (removed.length) sync(key, { op: "delete", ids: removed });
  };
  return [list, setList, { loaded, error }] as const;
}

export function downloadCsv(name: string, columns: string[], rows: string[][]) {
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const csv = "﻿" + [columns, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
