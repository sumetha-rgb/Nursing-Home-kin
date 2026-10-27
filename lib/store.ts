"use client";
import { useCallback, useSyncExternalStore } from "react";

/** ที่เก็บข้อมูลจำลองในหน่วยความจำ (หายเมื่อรีเฟรชหน้า) ใช้ร่วมกันข้ามหน้า */
const data = new Map<string, string[][]>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useCrud(key: string, initial: string[][]) {
  if (!data.has(key)) data.set(key, initial);
  const rows = useSyncExternalStore(subscribe, () => data.get(key)!, () => initial);
  const set = useCallback((next: string[][]) => { data.set(key, next); emit(); }, [key]);
  return {
    rows,
    set,
    add: (r: string[]) => set([r, ...rows]),
    update: (i: number, r: string[]) => set(rows.map((x, j) => (j === i ? r : x))),
    remove: (i: number) => set(rows.filter((_, j) => j !== i)),
    clear: () => set([]),
  };
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
