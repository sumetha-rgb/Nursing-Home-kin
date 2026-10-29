"use client";
import { createContext, ReactNode, useCallback, useContext, useRef, useState } from "react";
import { ViewId } from "./nav";
import { Modal } from "@/components/ui";
import { clearNotice, hasModal, isWarning, showNotice } from "./notice";

type Confirm = { title: string; message: string; okLabel?: string; danger?: boolean; onOk: () => void };
type Ctx = { go: (v: ViewId) => void; toast: (m: string) => void; confirm: (c: Confirm) => void };

const AppCtx = createContext<Ctx>({ go: () => {}, toast: () => {}, confirm: () => {} });
export const useApp = () => useContext(AppCtx);

export function AppProvider({ go, children }: { go: (v: ViewId) => void; children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [cf, setCf] = useState<Confirm | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const [warn, setWarn] = useState(false);
  const toast = useCallback((m: string) => {
    const warning = isWarning(m);
    // คำเตือนตอนมี popup เปิด: แสดงเป็นตัวหนังสือสีแดงใน popup (toast ด้านล่างจะถูก popup บัง)
    if (warning && hasModal()) { showNotice(m); return; }
    clearNotice();
    setMsg(m); setWarn(warning);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), warning ? 4000 : 2600);
  }, []);

  return (
    <AppCtx.Provider value={{ go, toast, confirm: setCf }}>
      {children}
      {msg && (
        <div role={warn ? "alert" : "status"} className={`fixed bottom-6 left-1/2 z-[120] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-xl px-5 py-3 text-center text-sm text-white shadow-2xl ${warn ? "bg-red-700" : "bg-gold-800"}`}>
          {msg}
        </div>
      )}
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
