"use client";
import { createContext, ReactNode, useCallback, useContext, useRef, useState } from "react";
import { ViewId } from "./nav";
import { Modal } from "@/components/ui";

type Confirm = { title: string; message: string; okLabel?: string; danger?: boolean; onOk: () => void };
type Ctx = { go: (v: ViewId) => void; toast: (m: string) => void; confirm: (c: Confirm) => void };

const AppCtx = createContext<Ctx>({ go: () => {}, toast: () => {}, confirm: () => {} });
export const useApp = () => useContext(AppCtx);

export function AppProvider({ go, children }: { go: (v: ViewId) => void; children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [cf, setCf] = useState<Confirm | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  const toast = useCallback((m: string) => {
    setMsg(m);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setMsg(null), 2600);
  }, []);

  return (
    <AppCtx.Provider value={{ go, toast, confirm: setCf }}>
      {children}
      {msg && (
        <div role="status" className="fixed bottom-6 left-1/2 z-[80] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 rounded-xl bg-gold-800 px-5 py-3 text-center text-sm text-white shadow-2xl">
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
        <p className="text-sm text-gold-700">{cf?.message}</p>
      </Modal>
    </AppCtx.Provider>
  );
}
