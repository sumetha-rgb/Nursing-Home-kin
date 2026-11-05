"use client";
import { useEffect, useSyncExternalStore } from "react";
import { priceSnapshot, setPrices, subscribePrices } from "./priceList";

let loading: Promise<void> | null = null;
/** โหลดใบราคาครั้งเดียวต่อการเปิดหน้า (force = โหลดใหม่) · โหลดไม่สำเร็จใช้ใบราคาเดิมไปก่อน */
export function loadPrices(force = false) {
  if (!loading || force) {
    loading = fetch("/api/prices", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.items?.length && !d.missing) setPrices(d.items); })
      .catch(() => { loading = null; });
  }
  return loading;
}

/** ใบราคาปัจจุบัน · คอมโพเนนต์ที่แสดงราคาเรียกเพื่อให้แสดงใหม่เมื่อโหลดหรือแก้ใบราคา */
export function usePriceList() {
  const items = useSyncExternalStore(subscribePrices, priceSnapshot, priceSnapshot);
  useEffect(() => { loadPrices(); }, []);
  return items;
}
