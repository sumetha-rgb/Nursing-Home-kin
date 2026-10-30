"use client";
import { useCallback, useEffect, useState } from "react";

/** ยาคลังกลางของศูนย์ที่ถึงจุดสั่งซื้อ หรือหมดอายุภายใน 60 วัน (ดึงใหม่ทุก 5 นาที และเมื่อกลับมาที่แท็บ) */
export type StockAlert = { id: string; name: string; unit: string; min_qty: number; branch_name: string; qty: number; expiry: string | null; low: boolean; days: number | null };
export const stockAlertText = (a: StockAlert) => [
  a.qty <= 0 ? "หมดแล้ว" : a.low ? `เหลือ ${a.qty.toLocaleString("en-US")} ${a.unit} (จุดสั่งซื้อ ${a.min_qty})` : "",
  a.days !== null && a.days <= 60 ? (a.days < 0 ? `หมดอายุแล้ว ${-a.days} วัน` : `หมดอายุในอีก ${a.days} วัน`) : "",
].filter(Boolean).join(" · ");

export function useStockAlerts(enabled = true) {
  const [items, setItems] = useState<StockAlert[]>([]);
  const reload = useCallback(() => {
    if (!enabled) return;
    fetch("/api/pharmstock?op=alerts", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { items: [] })).then((d) => setItems(d.items ?? [])).catch(() => {});
  }, [enabled]);
  useEffect(() => {
    reload();
    const t = setInterval(() => { if (document.visibilityState === "visible") reload(); }, 300_000);
    window.addEventListener("focus", reload);
    return () => { clearInterval(t); window.removeEventListener("focus", reload); };
  }, [reload]);
  return { items, reload };
}
