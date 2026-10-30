"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Icon from "../Icon";
import { useApp } from "@/lib/app";
import { familyUrl, ReviewLink } from "@/lib/reviews";
import { openHere } from "@/lib/site";
import { DataTable, Modal, Tabs } from "../ui";

type Upd = { id: string; resident_id: string; resident_name: string; branch_name: string; body: string | null; has_photo: boolean; posted_by: string | null; at: string };
type Link = ReviewLink & { branch_name: string };

async function call<T>(url: string, body?: object): Promise<T> {
  const r = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "ทำรายการไม่สำเร็จ");
  return d as T;
}

/**
 * ศูนย์รวมการสื่อสารกับครอบครัวของสาขา (ผู้จัดการ / หัวหน้าพยาบาล)
 *  - ข่าวที่ทีมส่งถึงญาติ: ใครส่ง ผู้รับบริการคนไหน เมื่อไร ข้อความ และรูป
 *  - ลิงก์ครอบครัวทั้งหมด: ค่าเริ่มต้นแสดงเฉพาะที่ใช้งานได้ (ที่ยกเลิก/หมดอายุซ่อนไว้ ติ๊กเพื่อดูย้อนหลัง)
 */
export default function FamilyHub({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast, confirm } = useApp();
  const [tab, setTab] = useState("ข่าวที่ส่งถึงญาติ");
  const [ups, setUps] = useState<Upd[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [old, setOld] = useState(false);
  const [photo, setPhoto] = useState<{ title: string; src: string | null } | null>(null);

  const load = useCallback(() => {
    Promise.all([
      call<{ updates: Upd[] }>("/api/care?op=family_updates_all").then((d) => d.updates).catch(() => []),
      call<{ links: Link[] }>("/api/reviews?op=all_links").then((d) => d.links).catch(() => []),
    ]).then(([u, l]) => { setUps(u); setLinks(l); setLoaded(true); });
  }, []);
  useEffect(() => { if (open) { setLoaded(false); load(); } }, [open, load]);

  const shownLinks = useMemo(() => links.filter((l) => old || (l.active && !l.expired)), [links, old]);
  const hidden = links.length - links.filter((l) => l.active && !l.expired).length;

  const viewPhoto = async (u: Upd) => {
    setPhoto({ title: `${u.resident_name} · ${u.at}`, src: null });
    try { const d = await call<{ photo: string }>(`/api/care?op=family_update_photo&id=${encodeURIComponent(u.id)}`); setPhoto({ title: `${u.resident_name} · ${u.at}`, src: d.photo }); }
    catch (e) { setPhoto(null); toast((e as Error).message); }
  };
  const removeUpd = (u: Upd) => confirm({ title: "ลบข่าวที่ส่งถึงญาติ", message: `ลบข่าวของ ${u.resident_name} ที่ ${u.posted_by ?? "ทีมดูแล"} ส่งเมื่อ ${u.at} ใช่หรือไม่ ญาติจะไม่เห็นข่าวนี้ในสมุดภาพอีก`, danger: true, okLabel: "ลบข่าว",
    onOk: async () => { try { await call("/api/care", { op: "family_update_delete", id: u.id }); load(); toast(`ลบข่าวถึงญาติแล้ว · ${u.resident_name} · ${u.at}`); } catch (e) { toast((e as Error).message); } } });
  const revoke = (l: Link) => confirm({ title: "ยกเลิกลิงก์", message: `ยกเลิกลิงก์ครอบครัวของ ${l.resident_name} ใช่หรือไม่ ญาติจะเปิดสมุดภาพและหน้ารีวิวจากลิงก์นี้ไม่ได้อีก`, danger: true, okLabel: "ยกเลิกลิงก์",
    onOk: async () => { try { await call("/api/reviews", { op: "revoke", id: l.id }); load(); toast(`ยกเลิกลิงก์แล้ว · ${l.resident_name} · ญาติเปิดลิงก์นี้ไม่ได้อีก`); } catch (e) { toast((e as Error).message); } } });
  const purge = () => confirm({ title: "ล้างลิงก์เก่า", message: `ลบลิงก์ที่ยกเลิกหรือหมดอายุแล้ว ${hidden} ลิงก์ ออกจากระบบถาวร ลิงก์เหล่านี้ใช้งานไม่ได้อยู่แล้ว ส่วนรีวิวพนักงานที่เคยได้รับและคะแนน KPI ยังอยู่ครบ`, danger: true, okLabel: "ลบลิงก์เก่า",
    onOk: async () => { try { const d = await call<{ count: number }>("/api/reviews", { op: "purge" }); load(); toast(`ล้างลิงก์เก่าแล้ว · ${d.count} ลิงก์ · รีวิวที่ได้รับยังอยู่ครบ`); } catch (e) { toast((e as Error).message); } } });
  const copy = async (l: Link) => { const u = familyUrl(l.token); try { await navigator.clipboard.writeText(u); toast(`คัดลอกลิงก์แล้ว · ${l.resident_name} · ส่งให้ญาติทาง LINE ได้เลย`); } catch { toast(u); } };

  return (
    <>
      <Modal open={open} wide title="ข่าวและลิงก์ที่ส่งถึงครอบครัว" onClose={onClose} footer={<button className="btn-primary" onClick={onClose}>ปิด</button>}>
        <div className="space-y-4">
          <Tabs tabs={["ข่าวที่ส่งถึงญาติ", "ลิงก์ครอบครัวทั้งหมด"]} value={tab} onChange={setTab} />
          {tab === "ข่าวที่ส่งถึงญาติ" ? (
            <>
              <p className="text-sm text-gold-700">ข้อความและรูปที่พยาบาลส่งให้ญาติผ่านสมุดภาพประจำวัน (ล่าสุด 150 รายการ) · ตรวจสอบหรือลบได้</p>
              <div className="link-table">
                <DataTable columns={["ส่งเมื่อ", "ผู้รับบริการ", "ส่งโดย", "ข้อความ", "รูป"]}
                  rows={ups.map((u) => [u.at, u.resident_name, u.posted_by ?? "-", u.body || "-", u.has_photo ? "มีรูป" : "-"])}
                  empty={loaded ? "ยังไม่มีข่าวที่ส่งถึงญาติ · พยาบาลส่งได้ที่ KinApp แท็บผู้รับบริการ ปุ่ม ส่งข่าวญาติ" : "กำลังโหลด…"}
                  actions={[{ label: "ดูรูป", hidden: (i) => !ups[i].has_photo, onClick: (i) => viewPhoto(ups[i]) }, { label: "ลบ", danger: true, onClick: (i) => removeUpd(ups[i]) }]} />
              </div>
            </>
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm text-gold-700">
                <input type="checkbox" checked={old} onChange={(e) => setOld(e.target.checked)} />
                แสดงลิงก์ที่ยกเลิก/หมดอายุแล้วด้วย {hidden > 0 && <small className="text-gold-500">(ซ่อนอยู่ {hidden} ลิงก์)</small>}
                {hidden > 0 && <button type="button" className="row-action danger ml-auto" onClick={purge}>ล้างลิงก์เก่า ({hidden})</button>}
              </label>
              <div className="link-table">
                <DataTable columns={["สร้างเมื่อ", "ผู้รับบริการ", "หมดอายุ", "สถานะ", "รีวิวที่ได้"]}
                  rows={shownLinks.map((l) => [`${l.at}${l.created_by ? `\nสร้างโดย ${l.created_by}` : ""}`, l.resident_name, l.expires ?? "-", !l.active ? "ยกเลิกแล้ว" : l.expired ? "หมดอายุ" : "ใช้งานได้", `${l.reviews} ครั้ง`])}
                  badgeCols={[3]} empty={loaded ? "ไม่มีลิงก์ที่ใช้งานอยู่" : "กำลังโหลด…"}
                  actions={[
                    { label: "ดู", hidden: (i) => !(shownLinks[i].active && !shownLinks[i].expired), onClick: (i) => openHere(familyUrl(shownLinks[i].token)) },
                    { label: "คัดลอก", hidden: (i) => !(shownLinks[i].active && !shownLinks[i].expired), onClick: (i) => copy(shownLinks[i]) },
                    { label: "ยกเลิกลิงก์", danger: true, hidden: (i) => !shownLinks[i].active, onClick: (i) => revoke(shownLinks[i]) },
                  ]} />
              </div>
            </>
          )}
        </div>
      </Modal>
      <Modal open={!!photo} title={photo?.title ?? ""} onClose={() => setPhoto(null)} footer={<button className="btn-primary" onClick={() => setPhoto(null)}>ปิด</button>}>
        {photo?.src ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={photo.src} alt="รูปที่ส่งถึงญาติ" className="mx-auto max-h-[70vh] rounded-xl" /> : <p className="py-10 text-center text-sm text-gold-500">กำลังโหลดรูป…</p>}
      </Modal>
    </>
  );
}
