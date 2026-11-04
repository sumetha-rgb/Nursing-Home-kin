"use client";
import { useEffect, useState } from "react";
import { DataTable, MetricGrid, Section, Tabs, Tile } from "../ui";
import Icon from "../Icon";
import { docDate, money } from "@/lib/billing";
import { downloadCsv } from "@/lib/store";
import { useSession } from "@/lib/session";

type Course = { id: string; resident_name: string; branch_name: string; name: string; total: number; used: number; price: number; status: string; created_by: string; billed: boolean; day: string; last_used: string | null };
const TABS = ["ยังเหลือ", "ใช้ครบแล้ว", "ทั้งหมด"];

/**
 * คอร์สกายภาพในแดชบอร์ด: ขายไปกี่คอร์ส ใครซื้อ ใช้ไปกี่ครั้ง เหลือกี่ครั้ง
 *  branch ว่าง = ทุกสาขาที่บัญชีนี้เห็น (ผู้จัดการสาขาเห็นเฉพาะสาขาตัวเอง)
 */
export default function CourseSummary({ branch, compact, onTiles }: { branch: string; compact?: boolean; onTiles?: (t: Tile[]) => void }) {
  const { user } = useSession();
  const global = user?.role === "Global Admin";
  const [items, setItems] = useState<Course[] | null>(null);
  const [tab, setTab] = useState(TABS[0]);
  useEffect(() => {
    fetch(`/api/clinic?op=courses${branch ? `&branch=${encodeURIComponent(branch)}` : ""}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { items: [] })).then((d) => setItems(d.items ?? [])).catch(() => setItems([]));
  }, [branch]);

  const list = items ?? [];
  const left = (c: Course) => Math.max(0, c.total - c.used);
  const month = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7);
  const thisMonth = list.filter((c) => c.day.startsWith(month));
  const buyers = new Set(list.map((c) => `${c.branch_name}|${c.resident_name}`)).size;
  const shown = list.filter((c) => tab === "ทั้งหมด" || (tab === "ยังเหลือ" ? left(c) > 0 : left(c) === 0));
  const cols = ["ผู้รับบริการ", ...(global ? ["สาขา"] : []), "คอร์ส", "วันที่ซื้อ", "ใช้แล้ว", "คงเหลือ", "ใช้ล่าสุด", "ราคา (บาท)", "ใบแจ้งหนี้"];
  const rows = shown.map((c) => [c.resident_name, ...(global ? [c.branch_name] : []), c.name, docDate(c.day), `${c.used}/${c.total} ครั้ง`, `${left(c)} ครั้ง`, c.last_used ? docDate(c.last_used) : "ยังไม่ได้ใช้", c.price ? money(c.price) : "-", c.billed ? "ออกแล้ว" : c.price ? "รอออกใบ" : "-"]);

  const tiles = [
        { label: "คอร์สกายภาพที่ขาย", value: list.length, unit: "คอร์ส", icon: "receipt", accent: true, note: `เดือนนี้ ${thisMonth.length} คอร์ส · ${money(thisMonth.reduce((n, c) => n + c.price, 0))} บาท` },
        { label: "ผู้ซื้อคอร์ส", value: buyers, unit: "คน", icon: "user", note: `ยอดขายรวม ${money(list.reduce((n, c) => n + c.price, 0))} บาท` },
        { label: "ใช้ไปแล้ว", value: list.reduce((n, c) => n + c.used, 0), unit: "ครั้ง", icon: "check", note: `จาก ${list.reduce((n, c) => n + c.total, 0)} ครั้งที่ขาย` },
        { label: "คงเหลือ", value: list.reduce((n, c) => n + left(c), 0), unit: "ครั้ง", icon: "history", note: `${list.filter((c) => left(c) > 0).length} คอร์สที่ยังใช้ไม่ครบ` },
  ];
  const key = JSON.stringify(tiles.map((t) => [t.label, t.value, t.note]));
  useEffect(() => { onTiles?.(tiles); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (compact) return <MetricGrid items={tiles} />;
  return (
    <div>
      <MetricGrid items={tiles} />
      <Section title="คอร์สกายภาพ" sub="ใครซื้อคอร์สอะไร ใช้ไปกี่ครั้ง เหลือกี่ครั้ง · ตัดคอร์สเมื่อนักกายภาพบันทึก Progress note"
        actions={<>
          <Tabs tabs={TABS} value={tab} onChange={setTab} />
          <button className="btn-soft" onClick={() => downloadCsv(`คอร์สกายภาพ-${tab}`, cols, rows)}><Icon name="download" className="h-4 w-4" /> โหลด Excel</button>
        </>}>
        <DataTable columns={cols} rows={rows} badgeCols={[cols.length - 1]} empty={items ? (tab === "ยังเหลือ" ? "ไม่มีคอร์สที่ยังใช้ไม่ครบ" : "ยังไม่มีคอร์สกายภาพ") : "กำลังโหลด…"} />
      </Section>
    </div>
  );
}
