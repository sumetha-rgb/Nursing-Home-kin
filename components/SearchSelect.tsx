"use client";
import { useId, useMemo, useState } from "react";
import Icon from "./Icon";
import { useResidents } from "@/lib/care";
import { useApp } from "@/lib/app";
import { useSession } from "@/lib/session";
import { can } from "@/lib/perms";
import { staying } from "@/lib/rooms";

/** ตัวเลือกหนึ่งรายการ · tone ของป้ายด้านขวา: room = เลขห้อง, warn = ส้ม (ยังไม่มีห้อง / เหลือน้อย), ok = เขียว, muted = เทา (หมด) */
export type PickItem = { value: string; label: string; sub?: string; badge?: string; tone?: "room" | "warn" | "ok" | "muted"; disabled?: boolean; action?: { label: string; onClick: () => void }; keys?: string };

const TONE = {
  room: "border border-gold-300 bg-white text-gold-800",
  warn: "bg-amber-50 text-amber-900",
  ok: "bg-emerald-50 text-emerald-800",
  muted: "bg-cream-200 text-gold-800",
};
const norm = (s: string) => s.toLocaleLowerCase().replace(/\s+/g, "");

/**
 * ช่องพิมพ์ค้นหาแล้วขึ้นรายการ (แทนกล่องเลือกที่ต้องเลื่อนหา) · ค้นได้จากชื่อ บรรทัดรอง ป้าย และ keys
 * ลูกศรขึ้นลงเลือก Enter ยืนยัน Esc ปิด · รายการที่ disabled ยังเห็นแต่เลือกไม่ได้ (บอกเหตุผลใน sub)
 */
export function SearchSelect({ items, value, onChange, placeholder = "พิมพ์เพื่อค้นหา", id, ariaLabel, note, clearable = true }: {
  items: PickItem[]; value: string; onChange: (v: string) => void; placeholder?: string; id?: string; ariaLabel?: string; note?: string; clearable?: boolean;
}) {
  const auto = useId();
  const listId = `${id ?? auto}-list`;
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const current = items.find((x) => x.value === value);
  const list = useMemo(() => {
    const t = norm(q);
    return (t ? items.filter((x) => norm(`${x.label} ${x.sub ?? ""} ${x.badge ?? ""} ${x.keys ?? ""}`).includes(t)) : items).slice(0, 60);
  }, [items, q]);
  const usable = list.filter((x) => !x.disabled);
  const pick = (x: PickItem) => { if (x.disabled) return; onChange(x.value); setQ(""); setOpen(false); };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); setOpen(true);
      if (usable.length) setActive((a) => (a + (e.key === "ArrowDown" ? 1 : usable.length - 1)) % usable.length);
    } else if (e.key === "Enter" && open && usable[active]) { e.preventDefault(); pick(usable[active]); }
    else if (e.key === "Escape") setOpen(false);
  };
  return (
    <div className="relative">
      <div className="relative">
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold-400" />
        <input id={id} type="text" role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-label={ariaLabel} autoComplete="off"
          className={`!pl-9 ${clearable && value ? "!pr-9" : ""}`} placeholder={current ? current.label : placeholder}
          value={open ? q : current ? `${current.label}${current.badge ? ` · ${current.badge}` : ""}` : value}
          onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0); }}
          onFocus={() => { setQ(""); setOpen(true); setActive(0); }} onBlur={() => setTimeout(() => setOpen(false), 150)} onKeyDown={onKey} />
        {clearable && value && !open && <button type="button" aria-label="ล้างที่เลือก" className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full text-gold-500 hover:bg-cream-100" onClick={() => onChange("")}><Icon name="close" className="h-3.5 w-3.5" /></button>}
      </div>
      {open && (
        <div id={listId} role="listbox" className="absolute z-30 mt-1 max-h-80 w-full overflow-auto rounded-2xl border border-gold-200 bg-white shadow-lg">
          <p className="sticky top-0 border-b border-cream-200 bg-cream-50 px-4 py-2 text-xs text-gold-600">
            {list.length ? `พบ ${list.length}${list.length === 60 ? "+" : ""} รายการ${usable.length < list.length ? ` · เลือกได้ ${usable.length}` : ""}` : `ไม่พบ "${q}"`}{note ? ` · ${note}` : ""}
          </p>
          {list.map((x) => {
            const on = !x.disabled && usable[active] === x;
            return (
              <div key={x.value} role="option" aria-selected={x.value === value} aria-disabled={x.disabled || undefined}
                className={`flex items-center justify-between gap-3 border-b border-cream-100 px-4 py-2.5 last:border-0 ${x.disabled ? "bg-cream-50" : on || x.value === value ? "cursor-pointer bg-gold-100" : "cursor-pointer hover:bg-cream-50"}`}
                onMouseDown={(e) => { e.preventDefault(); pick(x); }} onMouseEnter={() => { const k = usable.indexOf(x); if (k >= 0) setActive(k); }}>
                <span className="min-w-0">
                  <span className={`block truncate text-sm font-medium ${x.disabled ? "text-gold-500" : "text-gold-800"}`}>{x.label}</span>
                  {x.sub && <span className={`block truncate text-xs ${x.disabled ? "text-gold-500" : "text-gold-600"}`}>{x.sub}</span>}
                </span>
                {x.action ? <button type="button" className="shrink-0 rounded-full bg-cream-200 px-2.5 py-0.5 text-xs font-semibold text-gold-800 hover:bg-cream-300" onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(false); x.action!.onClick(); }}>{x.action.label} →</button>
                  : x.badge && <span className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE[x.tone ?? "room"]}`}>{x.badge}</span>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * เลือกผู้รับบริการแบบพิมพ์ค้นหา (ชื่อ / HN / เลขห้อง / "ยังไม่มีห้อง") ใช้แบบเดียวกันทุกหน้า
 *  names: จำกัดเฉพาะรายชื่อนี้ (ตามที่หน้านั้นเคยให้เลือก) · ไม่ระบุ = ผู้ที่ยังพักอยู่ทั้งหมด
 *  by: ค่าที่ส่งกลับ ชื่อ (ค่าเริ่มต้น) หรือ id · requireRoom: คนที่ยังไม่มีห้องเห็นแต่เลือกไม่ได้ (เช่น จัดยา มอบหมายงาน)
 */
export function ResidentPicker({ value, onChange, names, by = "name", requireRoom, id, placeholder = "พิมพ์ชื่อ, HN หรือเลขห้อง", ariaLabel = "ผู้รับบริการ", clearable = true }: {
  value: string; onChange: (v: string) => void; names?: string[]; by?: "name" | "id"; requireRoom?: boolean; id?: string; placeholder?: string; ariaLabel?: string; clearable?: boolean;
}) {
  const { residents } = useResidents();
  const { go } = useApp();
  const { user } = useSession();
  // ปุ่ม "ไปจัดห้อง" เฉพาะในระบบจัดการ และคนที่มีสิทธิ์จัดห้อง
  const roomAction = requireRoom && can(user, "rooms.move") && typeof window !== "undefined" && window.location.pathname === "/";
  const items = useMemo(() => {
    const pool = names
      ? names.map((n) => residents.find((r) => r.full_name === n && staying(r.status ?? "")) ?? residents.find((r) => r.full_name === n) ?? { id: n, full_name: n, room: null, hn: null, branch_name: null })
      : residents.filter((r) => staying(r.status ?? ""));
    const seen = new Set<string>();
    return pool.flatMap((r): PickItem[] => {
      const v = by === "id" ? r.id : r.full_name;
      if (seen.has(v)) return [];
      seen.add(v);
      const room = r.room && r.room.trim() !== "-" ? r.room : "";
      const hn = "hn" in r && r.hn ? r.hn : "ยังไม่มี HN";
      const no = !room && requireRoom;
      return [{
        value: v, label: r.full_name,
        sub: no ? `${hn} · ยังไม่มีห้อง · จัดห้องก่อน` : [hn, r.branch_name].filter(Boolean).join(" · "),
        badge: room ? `ห้อง ${room}` : "ยังไม่มีห้อง", tone: room ? "room" : "warn", keys: room ? "" : "ยังไม่มีห้อง",
        disabled: no, action: no && roomAction ? { label: "ไปจัดห้อง", onClick: () => go("rooms") } : undefined,
      }];
    });
  }, [residents, names, by, requireRoom, roomAction, go]);
  return <SearchSelect items={items} value={value} onChange={onChange} id={id} placeholder={placeholder} ariaLabel={ariaLabel} clearable={clearable} note="พิมพ์ชื่อ HN หรือเลขห้องก็ได้" />;
}
