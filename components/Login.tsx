"use client";
import { FormEvent, useState } from "react";
import { useBranchNames } from "@/lib/branches";
import Image from "next/image";
import Link from "next/link";
import Icon from "./Icon";
import { BRANCH_NAMES } from "@/lib/mock";
import { api, SessionUser } from "@/lib/session";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, ROLE_INFO, ROLES, Role, SHOW_DEMO } from "@/lib/roles";
import { Modal } from "./ui";

const ROLE_ICON: Record<Role, string> = { "Global Admin": "grid", "Branch Admin": "building", "Head Nurse": "pill", Cashier: "receipt", Nurse: "heart" };

export default function Login({ onLogin, staff = false }: { onLogin: (u: SessionUser) => void; staff?: boolean }) {
  const branchNames = useBranchNames({ all: true });
  const [mode, setMode] = useState<"login" | "register">("login");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [demo, setDemo] = useState<Role | null>(null);
  const [copied, setCopied] = useState("");
  const demoAcc = SHOW_DEMO && demo ? DEMO_ACCOUNTS.find((d) => d.role === demo) : undefined;
  const [f, setF] = useState({ name: "", email: "", password: "", confirm: "", branch: "" });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const login = async (email: string, password: string) => {
    setBusy(true); setError(""); setNotice("");
    try { onLogin((await api.login(email, password)).user); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (mode === "login") return login(f.email, f.password);
    if (f.password !== f.confirm) return setError("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await api.register({ name: f.name, email: f.email, password: f.password, branch: f.branch });
      if (!r.pending && r.user) return onLogin(r.user);
      setMode("login"); setF({ ...f, password: "", confirm: "" });
      setNotice("สมัครสมาชิกเรียบร้อย บัญชีของคุณรอผู้จัดการสาขาหรือผู้บริหารอนุมัติก่อนเข้าสู่ระบบ");
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  const switchMode = (m: "login" | "register") => { setMode(m); setError(""); setNotice(""); };
  const reg = mode === "register";

  return <main className="auth-page">
    <header className="auth-top"><a href="/" className="brand-lockup"><Image src="/logo-mark.png" alt="KIN" width={48} height={36} priority /><span>KIN<span className="brand-divider" />THE ART OF CARE</span></a><span className="auth-top-note">REHABILITATION & HOMECARE</span><Link href={staff ? "/" : "/staff"} className="auth-top-link">{staff ? "ระบบจัดการ KIN" : "แอปพนักงาน"}<Icon name="arrow" className="h-4 w-4" /></Link></header>
    <div className="auth-stage">
      <section className="auth-editorial">
        <span className="kicker"><span className="small-line" /> PEOPLE. PURPOSE. CARE.</span>
        <h1>พื้นที่ของความใส่ใจ<br /><span>ที่ออกแบบเพื่อคุณ</span></h1>
        <p className="auth-description">ให้ทุกช่วงเวลาของการดูแลมีความหมาย<br />ด้วยพื้นที่ทำงานที่เชื่อมทุกคนไว้ด้วยกัน</p>
        <div className="sculpture" aria-hidden="true"><div className="sculpture-orbit" /><div className="sculpture-petal petal-one" /><div className="sculpture-petal petal-two" /><div className="sculpture-petal petal-three" /><span className="sculpture-caption">A LITTLE MORE CARE.<br />A BETTER EVERYDAY.</span><span className="sculpture-star">✳</span></div>
        <div className="auth-editorial-foot"><span className="editorial-number">01 —</span><span>การดูแลที่ดี เริ่มต้นจากทีมที่พร้อม</span></div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form">
          <span className="auth-symbol"><Icon name={staff ? "heart" : "grid"} className="h-6 w-6" /></span>
          <p className="kicker mt-5">{staff ? "KIN CARE TEAM" : "KIN CARE MANAGEMENT"}</p>
          <h2>{reg ? "สมัครสมาชิก" : staff ? "พร้อมดูแลวันนี้" : "ยินดีต้อนรับ"}</h2>
          <p className="auth-form-description">{reg ? "สร้างบัญชีสำหรับทีมดูแล (พยาบาล)" : staff ? "เข้าสู่พื้นที่ทำงานของทีมดูแล" : "เข้าสู่พื้นที่ทำงานของคุณ"}</p>

          <div className="segmented-tabs mt-6" role="tablist" aria-label="เลือกการเข้าใช้งาน">
            <button type="button" role="tab" aria-selected={!reg} className={!reg ? "is-selected flex-1" : "flex-1"} onClick={() => switchMode("login")}>เข้าสู่ระบบ</button>
            <button type="button" role="tab" aria-selected={reg} className={reg ? "is-selected flex-1" : "flex-1"} onClick={() => switchMode("register")}>สมัครสมาชิก</button>
          </div>

          <form onSubmit={submit} noValidate>
            {reg && <div className="mt-4"><label className="label" htmlFor="reg-name">ชื่อ-นามสกุล</label><div className="input-with-icon"><Icon name="user" /><input id="reg-name" value={f.name} onChange={set("name")} placeholder="เช่น สมหญิง ใจดี" autoComplete="name" required /></div></div>}
            <div className="mt-4"><label className="label" htmlFor="login-email">อีเมล</label><div className="input-with-icon"><Icon name="mail" /><input id="login-email" type="email" value={f.email} onChange={set("email")} placeholder="name@kinhomecare.com" autoComplete={reg ? "email" : "username"} required /></div></div>
            {reg && <div className="mt-4"><label className="label" htmlFor="reg-branch">สาขาที่ปฏิบัติงาน</label><select id="reg-branch" value={f.branch} onChange={set("branch")} required><option value="">-- เลือกสาขา --</option>{branchNames.map((b) => <option key={b}>{b}</option>)}</select></div>}
            <div className="mt-4"><label className="label" htmlFor="login-password">รหัสผ่าน{reg && " (อย่างน้อย 8 ตัวอักษร)"}</label><div className="input-with-icon"><Icon name="lock" /><input id="login-password" type={show ? "text" : "password"} value={f.password} onChange={set("password")} placeholder="กรอกรหัสผ่านของคุณ" autoComplete={reg ? "new-password" : "current-password"} required /><button type="button" className="password-eye" onClick={() => setShow(!show)} aria-pressed={show} aria-label={show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}><Icon name="eye" /></button></div></div>
            {reg && <div className="mt-4"><label className="label" htmlFor="reg-confirm">ยืนยันรหัสผ่าน</label><div className="input-with-icon"><Icon name="lock" /><input id="reg-confirm" type={show ? "text" : "password"} value={f.confirm} onChange={set("confirm")} placeholder="กรอกรหัสผ่านอีกครั้ง" autoComplete="new-password" required /></div></div>}

            {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
            {notice && <p role="status" className="mt-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</p>}
            <button className="btn-primary auth-submit" disabled={busy}>{busy ? "กำลังตรวจสอบ…" : reg ? "สมัครสมาชิก" : "เข้าสู่ระบบ"} <Icon name="arrow" className="h-5 w-5" /></button>
          </form>
          {reg && <p className="demo-note"><span /> บัญชีที่สมัครเองได้สิทธิ์พยาบาล และต้องรอผู้ดูแลอนุมัติก่อนใช้งาน</p>}

          <div className="mt-5 rounded-2xl border border-cream-200 bg-cream-50/60 px-4 py-3">
            <p className="text-sm font-medium text-gold-800">{SHOW_DEMO ? "บัญชีทดลองตามตำแหน่ง" : "ระดับสิทธิ์การใช้งาน"}</p>
            <p className="demo-hint mt-0.5 text-xs leading-6 text-gold-500">{SHOW_DEMO ? "เลือกตำแหน่งเพื่อดูรหัสทดลองและสิ่งที่มองเห็นได้" : "เลือกตำแหน่งเพื่อดูว่าเข้าถึงอะไรได้บ้าง"}</p>
            <div className="mt-2.5 grid grid-cols-5 gap-1.5">
              {ROLES.slice().reverse().map((role) => (
                <button key={role} type="button" onClick={() => { setCopied(""); setDemo(role); }} className="flex min-w-0 flex-col items-center gap-1 rounded-xl border border-cream-200 bg-white px-2 py-2 text-center transition hover:border-gold-300 hover:bg-cream-50">
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-cream-100 text-gold-600"><Icon name={ROLE_ICON[role]} className="h-[18px] w-[18px]" /></span>
                  <span className="text-[11px] font-medium leading-4 text-gold-800">{ROLE_INFO[role].th}</span>
                </button>
              ))}
            </div>
          </div>

          <Modal open={!!demo} title={demo ? ROLE_INFO[demo].th : ""} onClose={() => setDemo(null)}
            footer={demoAcc ? <><button className="btn-soft" onClick={() => { setMode("login"); setF({ ...f, email: demoAcc.email, password: DEMO_PASSWORD }); setDemo(null); }}>กรอกให้ในฟอร์ม</button><button className="btn-primary" disabled={busy} onClick={() => { setDemo(null); setMode("login"); setF({ ...f, email: demoAcc.email, password: DEMO_PASSWORD }); login(demoAcc.email, DEMO_PASSWORD); }}>เข้าด้วยบัญชีนี้ <Icon name="arrow" className="h-4 w-4" /></button></> : <button className="btn-primary" onClick={() => setDemo(null)}>ปิด</button>}>
            {demo && <div className="space-y-5">
              <div className="flex items-start gap-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-cream-100 text-gold-600"><Icon name={ROLE_ICON[demo]} className="h-6 w-6" /></span>
                <div><p className="text-xs tracking-wider text-gold-500">ACCESS LEVEL · {demo.toUpperCase()}</p><p className="mt-1 text-sm leading-7 text-gold-700">{ROLE_INFO[demo].sees}</p></div>
              </div>
              {demoAcc && <dl className="divide-y divide-cream-200 rounded-2xl border border-cream-200">
                {[["อีเมล", demoAcc.email], ["รหัสผ่าน", DEMO_PASSWORD], ["สาขา", demoAcc.branch], ["เปิดใช้งานที่", demo === "Nurse" ? "KinApp และแอปจัดยา" : demo === "Cashier" ? "ระบบจัดการ (สัญญาบริการ การเงิน ห้องผู้ป่วย)" : demo === "Head Nurse" ? "ระบบจัดการ (งานดูแล ห้องผู้ป่วย) · KinApp · แอปจัดยา" : "ระบบจัดการ"]].map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                    <dt className="shrink-0 text-gold-500">{k}</dt>
                    <dd className="flex min-w-0 items-center gap-2"><span className={`truncate ${k === "อีเมล" || k === "รหัสผ่าน" ? "font-mono" : ""} text-gold-800`}>{v}</span>
                      {(k === "อีเมล" || k === "รหัสผ่าน") && <button type="button" className="row-action shrink-0" onClick={() => { navigator.clipboard?.writeText(v).then(() => setCopied(k)).catch(() => {}); }}>{copied === k ? "คัดลอกแล้ว" : "คัดลอก"}</button>}
                    </dd>
                  </div>
                ))}
              </dl>}
              <p className="text-xs leading-6 text-gold-500">{demoAcc ? "บัญชีทดลองมีไว้สำหรับทดสอบเท่านั้น ลบออกก่อนใช้งานจริง" : "ติดต่อผู้ดูแลระบบเพื่อขอบัญชีระดับนี้"}</p>
            </div>}
          </Modal>

          <div className="auth-alternate"><span>{staff ? "สำหรับผู้จัดการศูนย์" : "สำหรับทีมดูแล"}</span><Link href={staff ? "/" : "/staff"}>{staff ? "ระบบจัดการ KIN" : "แอปพนักงาน"}<Icon name="arrow" className="h-4 w-4" /></Link></div>
        </div>
      </section>
    </div>
    <footer className="auth-bottom"><span>KIN REHABILITATION & HOMECARE</span><span>Thoughtfully designed. Carefully connected.</span></footer>
  </main>;
}
