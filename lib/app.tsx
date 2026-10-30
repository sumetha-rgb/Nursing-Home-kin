"use client";
import { createContext, ReactNode, useCallback, useContext, useState } from "react";
import { ViewId } from "./nav";
import { Modal } from "@/components/ui";
import { clearNotice, hasModal, showNotice } from "./notice";
import { fromText, Toaster, ToastInput, useToaster } from "@/components/Toaster";

type Confirm = { title: string; message: string; okLabel?: string; danger?: boolean; onOk: () => void };
/** toast("หัวข้อ · รายละเอียด") เดาประเภทจากข้อความ หรือส่งเป็นวัตถุเพื่อกำหนดประเภทและปุ่ม (เช่น เลิกทำ) เอง */
type Ctx = { go: (v: ViewId) => void; toast: (m: string | ToastInput) => void; confirm: (c: Confirm) => void };

const AppCtx = createContext<Ctx>({ go: () => {}, toast: () => {}, confirm: () => {} });
export const useApp = () => useContext(AppCtx);

export function AppProvider({ go, children }: { go: (v: ViewId) => void; children: ReactNode }) {
  const [cf, setCf] = useState<Confirm | null>(null);
  const { items, push, dismiss } = useToaster();
  const toast = useCallback((m: string | ToastInput) => {
    const t = typeof m === "string" ? fromText(m) : m;
    // คำเตือนตอนมี popup เปิด: แสดงเป็นตัวหนังสือสีแดงใน popup นั้น (ผู้ใช้กำลังดู popup อยู่)
    if (t.type === "warn" && hasModal()) { showNotice(t.detail ? `${t.title} · ${t.detail}` : t.title); return; }
    clearNotice();
    push(t);
  }, [push]);

  return (
    <AppCtx.Provider value={{ go, toast, confirm: setCf }}>
      {children}
      <Toaster items={items} dismiss={dismiss} />
      <Modal
        open={!!cf}
        title={cf?.title ?? ""}
        onClose={() => setCf(null)}
        footer={
          <>
            <button className="btn-soft" onClick={() => setCf(null)}>ยกเลิก</button>
            <button className={cf?.danger ? "btn-danger" : "btn-primary"} onClick={() => { cf?.onOk(); setCf(null); }}>{cf?.okLabel ?? "ยืนยัน"}</button>
          </>
        }
      >
        <p className="text-[15px] font-medium leading-relaxed text-gold-900">{cf?.message}</p>
      </Modal>
    </AppCtx.Provider>
  );
}
