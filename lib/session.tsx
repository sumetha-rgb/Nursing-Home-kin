"use client";
import { useCallback, useEffect, useState } from "react";
import type { SessionUser } from "./roles";
import { clearOfflineData, setOfflineOwner } from "./store";
import { setBranchScope } from "./branches";

export type { SessionUser };

async function post<T>(url: string, body?: object): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "เกิดข้อผิดพลาด กรุณาลองใหม่");
  return data as T;
}

export const api = {
  login: (email: string, password: string) => post<{ user: SessionUser }>("/api/auth/login", { email, password }),
  register: (b: { name: string; email: string; password: string; branch: string }) => post<{ pending: boolean; user?: SessionUser }>("/api/auth/register", b),
  logout: () => post("/api/auth/logout"),
  changePassword: (current: string, next: string) => post("/api/auth/password", { current, next }),
  users: (body?: object) => (body ? post<{ users: UserRow[] }>("/api/users", body) : fetch("/api/users", { cache: "no-store" }).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d as { users: UserRow[] }; })),
};

export type UserRow = { id: string; full_name: string; email: string | null; contract_type: string | null; access_level: string; branch_name: string | null; status: string; last_login_at: string | null; permissions: string[] | null };

/** ผู้ใช้ล่าสุดที่เข้าสู่ระบบในเครื่องนี้ ใช้เปิดแอปตอนออฟไลน์ (server ยังตรวจ cookie ทุกครั้งที่ส่งข้อมูล) */
const LAST_USER = "kin-user";
const remember = (u: SessionUser | null) => { try { if (u) localStorage.setItem(LAST_USER, JSON.stringify(u)); else localStorage.removeItem(LAST_USER); } catch { /* ignore */ } };
const remembered = (): SessionUser | null => { try { return JSON.parse(localStorage.getItem(LAST_USER) ?? "null"); } catch { return null; } };

/** สถานะการเข้าสู่ระบบของหน้านี้ (ตรวจจาก cookie ผ่าน /api/auth/me) */
export function useSession() {
  const [user, setUserState] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const setUser = useCallback((u: SessionUser | null) => {
    if (u) setOfflineOwner(u.id);
    setBranchScope(u);
    remember(u);
    setUserState(u);
  }, []);
  useEffect(() => {
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setUser(d.user ?? null))
      .catch(() => { const u = remembered(); setBranchScope(u); setUserState(u); }) // ออฟไลน์: ใช้ผู้ใช้ล่าสุดในเครื่อง
      .finally(() => setReady(true));
  }, [setUser]);
  const logout = useCallback(async () => {
    await api.logout().catch(() => {});
    clearOfflineData();
    remember(null);
    setUserState(null);
    window.location.reload();
  }, []);
  return { user, ready, setUser, logout };
}
