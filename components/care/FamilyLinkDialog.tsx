"use client";
import { useCallback, useEffect, useState } from "react";
import Icon from "../Icon";
import QrCode from "../QrCode";
import { useApp } from "@/lib/app";
import { useSession } from "@/lib/session";
import { can } from "@/lib/perms";
import { useResidents } from "@/lib/care";
import { familyUrl, LINK_DAYS, ReviewLink, reviewUrl } from "@/lib/reviews";
import { openHere } from "@/lib/site";
import { DataTable, Field, Modal, Select } from "../ui";

async function call<T>(url: string, body?: object): Promise<T> {
  const r = await fetch(url, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "ทำรายการไม่สำเร็จ");
  return d as T;
}

/**
 * ลิงก์ครอบครัวของผู้รับบริการ 1 คน: เปิดสมุดภาพประจำวัน และรีวิวพนักงานจากหน้าเดียวกัน
 * รหัสสุ่ม เดาไม่ได้ · ใช้ได้ LINK_DAYS วัน · ยกเลิกได้ (ลิงก์และ QR เก่าใช้ไม่ได้ทันที)
 */
export default function FamilyLinkDialog({ open, onClose, residentId = "" }: { open: boolean; onClose: () => void; residentId?: string }) {
  const { toast, confirm } = useApp();
  const { residents } = useResidents();
  const [resId, setResId] = useState(residentId);
  const [links, setLinks] = useState<ReviewLink[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [old, setOld] = useState(false);
  const { user } = useSession();
  const canPurge = can(user, "residents") || can(user, "reviews");
  useEffect(() => { if (open) setResId(residentId); }, [open, residentId]);
  const load = useCallback((id: string) => {
    if (!id) return setLinks([]);
    call<{ links: ReviewLink[] }>(`/api/reviews?op=links&resident=${encodeURIComponent(id)}`).then((d) => setLinks(d.links)).catch(() => setLinks([]));
  }, []);
  useEffect(() => { setFresh(null); if (open) load(resId); }, [open, resId, load]);

  const name = residents.find((r) => r.id === resId)?.full_name ?? "";
  const create = async () => {
    if (!resId) return toast("กรุณาเลือกผู้รับบริการก่อน");
    try { const d = await call<{ token: string }>("/api/reviews", { op: "create", residentId: resId }); setFresh(d.token); load(resId); toast("สร้างลิงก์แล้ว คัดลอกส่งให้ญาติทาง LINE ได้เลย"); }
    catch (e) { toast((e as Error).message); }
  };
  const revoke = (l: ReviewLink) => confirm({ title: "ยกเลิกลิงก์", message: `ยกเลิกลิงก์ครอบครัวของ ${l.resident_name} ใช่หรือไม่ ญาติจะเปิดสมุดภาพและหน้ารีวิวจากลิงก์นี้ไม่ได้อีก`, danger: true, okLabel: "ยกเลิกลิงก์",
    onOk: async () => { try { await call("/api/reviews", { op: "revoke", id: l.id }); if (fresh === l.token) setFresh(null); load(resId); toast("ยกเลิกลิงก์แล้ว"); } catch (e) { toast((e as Error).message); } } });
  const dead = links.filter((l) => !l.active || l.expired).length;
  const purge = () => confirm({ title: "ล้างลิงก์เก่า", message: `ลบลิงก์ที่ยกเลิกหรือหมดอายุแล้ว ${dead} ลิงก์ของ ${name} ออกจากระบบถาวร ส่วนรีวิวพนักงานที่เคยได้รับและคะแนน KPI ยังอยู่ครบ`, danger: true, okLabel: "ลบลิงก์เก่า",
    onOk: async () => { try { const d = await call<{ count: number }>("/api/reviews", { op: "purge", resident: resId }); load(resId); toast(`ลบลิงก์เก่า ${d.count} ลิงก์แล้ว`); } catch (e) { toast((e as Error).message); } } });
  const copy = async (u: string) => { try { await navigator.clipboard.writeText(u); toast("คัดลอกลิงก์แล้ว ส่งให้ญาติทาง LINE ได้เลย"); } catch { toast(u); } };
  const live = links.filter((l) => l.active && !l.expired);
  const listed = old ? links : live;
  const token = fresh ?? live[0]?.token ?? null;

  return (
    <Modal open={open} wide title="ลิงก์ครอบครัว (สมุดภาพประจำวัน + รีวิวพนักงาน)" onClose={onClose} footer={<button className="btn-primary" onClick={onClose}>ปิด</button>}>
      <p className="mb-4 text-sm text-gold-600">
        ญาติเปิดลิงก์เดียวแล้วเห็นรูปและบันทึกการดูแลแต่ละวัน (เฉพาะรูปที่พนักงานแชร์) การให้ยาตามมื้อ และกดรีวิวพนักงานได้ · ไม่ต้องสมัครสมาชิก
        · ลิงก์มีรหัสสุ่ม ใช้ได้ {LINK_DAYS} วัน ยกเลิกได้ทุกเมื่อ
      </p>
      <Field label="ผู้รับบริการ"><Select options={residents.map((r) => r.full_name)} placeholder="-- เลือกผู้รับบริการ --"
        value={name} onChange={(n) => setResId(residents.find((r) => r.full_name === n)?.id ?? "")} /></Field>
      {resId && (
        <div className="mt-4 space-y-4">
          {token ? (
            <div className="qr-card">
              <QrCode text={familyUrl(token)} alt="QR ลิงก์ครอบครัว" />
              <div>
                <h4>สมุดภาพประจำวันของ{name}</h4>
                <p>ส่งให้ญาติทาง LINE หรือให้สแกน QR ตอนมาเยี่ยม · ในหน้าเดียวกันมีปุ่มรีวิวพนักงาน</p>
                <a className="qr-link" href={familyUrl(token)} target="_blank" rel="noopener" title="กดเพื่อเปิดสมุดภาพประจำวันของญาติ"><code>{familyUrl(token)}</code></a>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-soft !py-2" onClick={() => copy(familyUrl(token))}>คัดลอกลิงก์สมุดภาพ</button>
                  <button type="button" className="btn-soft !py-2" onClick={() => copy(reviewUrl(token))}>คัดลอกลิงก์รีวิวอย่างเดียว</button>
                  <button type="button" className="btn-soft !py-2" onClick={() => openHere(familyUrl(token))}><Icon name="external" className="h-4 w-4" /> เปิดดูหน้าของญาติ</button>
                </div>
              </div>
            </div>
          ) : <p className="rounded-xl bg-cream-50 px-4 py-3 text-sm text-gold-700">ผู้รับบริการคนนี้ยังไม่มีลิงก์ที่ใช้งานได้</p>}
          <button type="button" className={token ? "btn-soft" : "btn-primary"} onClick={create}><Icon name="plus" className="h-4 w-4" /> {token ? "สร้างลิงก์ใหม่" : "สร้างลิงก์ครอบครัว"}</button>
          {links.length > 0 && (
            <label className="flex items-center gap-2 text-sm text-gold-700">
              <input type="checkbox" checked={old} onChange={(e) => setOld(e.target.checked)} />
              แสดงลิงก์ที่ยกเลิก/หมดอายุแล้วด้วย {links.filter((l) => !l.active || l.expired).length > 0 && <small className="text-gold-500">(ซ่อนอยู่ {old ? 0 : dead} ลิงก์)</small>}
              {dead > 0 && canPurge && <button type="button" className="row-action danger ml-auto" onClick={purge}>ล้างลิงก์เก่า ({dead})</button>}
            </label>
          )}
          {links.length > 0 && (
            <div className="link-table"><DataTable columns={["สร้างเมื่อ", "ดูแลโดย", "หมดอายุ", "สถานะ", "รีวิวที่ได้"]} search={false}
              rows={listed.map((l) => [`${l.at}${l.created_by ? `
สร้างโดย ${l.created_by}` : ""}`, l.carers?.length ? l.carers.join(", ") : "ยังไม่มีผู้ดูแลที่บันทึกในระบบ", l.expires ?? "-", !l.active ? "ยกเลิกแล้ว" : l.expired ? "หมดอายุ" : "ใช้งานได้", `${l.reviews} ครั้ง`])}
              badgeCols={[3]} actions={[{ label: "ยกเลิกลิงก์", danger: true, hidden: (i) => !listed[i].active, onClick: (i) => revoke(listed[i]) }]} /></div>
          )}
        </div>
      )}
    </Modal>
  );
}
