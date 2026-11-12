"use client";
import { FormEvent, useEffect, useState } from "react";
import { useBranchNames } from "@/lib/branches";
import Image from "next/image";
import Link from "next/link";
import Icon from "./Icon";
import { api, SessionUser } from "@/lib/session";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, ROLE_INFO, ROLES, Role, SHOW_DEMO } from "@/lib/roles";
import { permsFor } from "@/lib/perms";
import { APP_ORDER, APPS, AppId, appAt, appsFor, autoApp, isPhone, openApp, rememberApp, setHint, suggestedApp } from "@/lib/apps";
import { Modal, Tabs } from "./ui";
import { thDateText } from "@/lib/servicePeriod";
import { usePwa } from "./Pwa";

const ROLE_ICON: Record<Role, string> = { "Global Admin": "grid", "Branch Admin": "building", "Head Nurse": "pill", Cashier: "receipt", Physio: "pulse", Nurse: "heart" };
/** ขั้นตอนสมัครใช้งาน (ลำดับจริง) */
const STEPS: [string, string][] = [["กรอกข้อมูลสมัคร", "ชื่อ อีเมล สาขา และตั้งรหัสผ่าน"], ["ผู้จัดการสาขาอนุมัติ", "ตรวจชื่อ และกำหนดตำแหน่งให้ตรงงาน"], ["เข้าสู่ระบบได้", "ใช้อีเมลและรหัสผ่านที่ตั้งไว้"]];
/** "2026-11-12 14:20" → "12 พ.ย. 14:20" */
const sentAt = (s?: string) => (s ? `${thDateText(s.slice(0, 10)).replace(/ \d{4}$/, "")} ${s.slice(11, 16)}` : "");
function Steps({ now, mini = false, sent }: { now: number; mini?: boolean; sent?: string }) {
  return (
    <ol className={`auth-steps ${mini ? "is-mini" : ""}`} aria-label={`ขั้นตอนสมัครใช้งาน · ตอนนี้ขั้นที่ ${now}`}>
      {STEPS.map(([t, d], i) => {
        const n = i + 1;
        const note = n === 1 && sent ? `ส่งเมื่อ ${sent}` : n === 2 && now === 2 ? "ระบบแจ้งเตือนผู้จัดการสาขาแล้ว" : d;
        return <li key={t} className={n < now ? "is-done" : n === now ? "is-now" : ""}><span>{n < now ? "✓" : n}</span><div><b>{t}</b>{!mini && <small>{note}</small>}</div></li>;
      })}
    </ol>
  );
}

type View = "login" | "register" | "sent" | "pending" | "pick";

/**
 * หน้าเข้าสู่ระบบเดียวของทุกแอป (ระบบจัดการ · KinApp · ห้องยา)
 * เข้าสู่ระบบแล้วพาเข้าแอปให้เอง (lib/apps): เปิดแอปไหนมาและใช้ได้ → อยู่แอปนั้น · เข้าจากหน้าหลัก → แอปที่ใช้ล่าสุดในเครื่องนี้
 * ใช้ได้หลายแอปและเครื่องนี้ยังไม่เคยใช้ → หน้าเลือกแอปครั้งเดียว
 */
export default function Login({ onLogin, staff = false }: { onLogin: (u: SessionUser) => void; staff?: boolean }) {
  // ติดตั้ง KinApp: ติดตั้งจากหน้า /staff (manifest ของ KinApp) · หน้าหลักบนมือถือมีปุ่มพาไปติดตั้ง
  const pwa = usePwa();
  const [installInfo, setInstallInfo] = useState(false);
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    setPhone(isPhone());
    if (staff && new URLSearchParams(window.location.search).get("install") === "1") setInstallInfo(true);
  }, [staff]);
  const canOffer = !pwa.installed && (staff || phone);
  const [osTab, setOsTab] = useState("Android");
  useEffect(() => { if (pwa.iosHint || /iphone|ipad|ipod/i.test(navigator.userAgent)) setOsTab("iPhone"); }, [pwa.iosHint]);
  const branchNames = useBranchNames({ all: true });
  const [view, setView] = useState<View>("login");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [forgot, setForgot] = useState(false);
  const [waiting, setWaiting] = useState<{ name: string; branch: string; since: string } | null>(null);
  const [sent, setSent] = useState<{ name: string; email: string; branch: string; at: string } | null>(null);
  const [picker, setPicker] = useState<SessionUser | null>(null);
  const [demo, setDemo] = useState<Role | null>(null);
  const [copied, setCopied] = useState("");
  const demoAcc = SHOW_DEMO && demo ? DEMO_ACCOUNTS.find((d) => d.role === demo) : undefined;
  const [f, setF] = useState({ name: "", email: "", password: "", confirm: "", branch: "" });
  // จดจำฉันไว้: อยู่ในระบบ 30 วัน + จำอีเมลไว้ให้ · รหัสผ่านให้เบราว์เซอร์เป็นคนจำ (ระบบไม่เก็บรหัสผ่านในเครื่อง)
  const [remember, setRemember] = useState(true);
  useEffect(() => {
    try {
      const r = localStorage.getItem("kin-remember") !== "0";
      setRemember(r);
      const em = r ? localStorage.getItem("kin-email") : null;
      if (em) setF((x) => (x.email ? x : { ...x, email: em }));
    } catch { /* โหมดส่วนตัว */ }
  }, []);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const switchView = (v: View) => { setView(v); setError(""); setForgot(false); };

  /** เข้าแอป: แอปของหน้านี้ = แสดงต่อในหน้าเดิม · แอปอื่น = เปิดหน้าแอปนั้น */
  const enter = (u: SessionUser, id: AppId, hint: boolean) => {
    if (id === appAt(window.location.pathname)) { rememberApp(id); if (hint) setHint(id); onLogin(u); }
    else openApp(id, { hint });
  };
  const route = (u: SessionUser) => {
    const apps = appsFor(u), here = appAt(window.location.pathname);
    if (!apps.length) return onLogin(u); // ไม่มีสิทธิ์แอปใดเลย: หน้าแอปบอกให้ติดต่อผู้จัดการ
    if (here !== "console" && apps.includes(here)) return enter(u, here, false); // เปิด KinApp/ห้องยามาเอง (เช่น ไอคอนแอปบนมือถือ) → อยู่แอปนั้น
    const t = autoApp(apps);
    if (!t) { setPicker(u); setView("pick"); return; }
    enter(u, t, apps.length > 1);
  };

  const login = async (email: string, password: string) => {
    setBusy(true); setError("");
    try {
      const u = (await api.login(email, password, remember)).user;
      try { localStorage.setItem("kin-remember", remember ? "1" : "0"); if (remember) localStorage.setItem("kin-email", email); else localStorage.removeItem("kin-email"); } catch { /* โหมดส่วนตัว */ }
      route(u);
    } catch (e) {
      const d = (e as { data?: { pending?: boolean; name?: string; branch?: string; since?: string } }).data;
      if (d?.pending) { setWaiting({ name: d.name ?? "", branch: d.branch ?? "", since: sentAt(d.since) }); switchView("pending"); }
      else setError((e as Error).message);
    } finally { setBusy(false); }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (view === "login") return login(f.email, f.password);
    if (f.password !== f.confirm) return setError("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
    setBusy(true); setError("");
    try {
      const r = await api.register({ name: f.name, email: f.email, password: f.password, branch: f.branch });
      if (!r.pending && r.user) return route(r.user);
      const now = new Date(Date.now() + 7 * 36e5).toISOString();
      setSent({ name: f.name.trim(), email: f.email.trim(), branch: f.branch, at: sentAt(`${now.slice(0, 10)} ${now.slice(11, 16)}`) });
      setF({ ...f, password: "", confirm: "" });
      switchView("sent");
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  };
  const notMe = async () => { await api.logout().catch(() => {}); setPicker(null); switchView("login"); };
  const demoApps = (r: Role) => appsFor({ role: r, perms: permsFor(r) } as SessionUser).map((a) => APPS[a].name).join(" · ") || "-";

  const appList = (
    <ul className="auth-apps">
      {APP_ORDER.map((id) => { const a = APPS[id]; return (
        <li key={id}><span className="auth-app-ic"><Icon name={a.icon} className="h-[22px] w-[22px]" /></span><div><b>{a.name}</b><p>{a.desc}</p><small>ใช้โดย {a.users}</small></div></li>
      ); })}
    </ul>
  );
  const back = <button type="button" className="auth-back" onClick={() => switchView("login")}><Icon name="arrow" className="h-4 w-4 -scale-x-100" />กลับไปเข้าสู่ระบบ</button>;
  const errBox = error && <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>;

  let panel: JSX.Element;
  if (view === "pick" && picker) {
    const apps = appsFor(picker), rec = suggestedApp(apps);
    panel = <>
      <p className="auth-who">{ROLE_INFO[picker.role]?.th}{picker.role !== "Global Admin" && picker.branch ? ` · สาขา${picker.branch}` : ""}</p>
      <h2>สวัสดี {picker.name}</h2>
      <p className="auth-form-description is-keep">บัญชีนี้ใช้ได้ {apps.length} แอป เลือกแอปที่จะเปิดตอนนี้</p>
      <div className="auth-pick">
        {apps.map((id) => { const a = APPS[id]; return (
          <button key={id} type="button" className={id === rec ? "is-rec" : ""} onClick={() => enter(picker, id, true)}>
            <span className="auth-app-ic"><Icon name={a.icon} className="h-[22px] w-[22px]" /></span>
            <span className="min-w-0"><b>{a.name}{id === rec && <i>{phone ? "เหมาะกับมือถือ" : "แนะนำ"}</i>}</b><small>{a.desc}</small></span>
            <Icon name="arrow" className="h-4 w-4 shrink-0 text-gold-500" />
          </button>
        ); })}
      </div>
      <p className="auth-help">หน้านี้ขึ้นครั้งแรกในเครื่องนี้เท่านั้น ครั้งต่อไประบบเปิดแอปที่คุณใช้ล่าสุดให้เลย และสลับแอปได้ทุกเมื่อจากปุ่ม <b>แอป</b> มุมขวาบน</p>
      <button type="button" className="auth-link mt-3" onClick={notMe}>ไม่ใช่บัญชีของคุณ? ออกจากระบบ</button>
    </>;
  } else if (view === "pending" && waiting) {
    panel = <>
      <span className="auth-done-ic is-wait" aria-hidden>…</span>
      <h2>บัญชียังรออนุมัติ</h2>
      <p className="auth-form-description is-keep">{waiting.name} สมัครไว้แล้ว ผู้จัดการสาขา{waiting.branch} ยังไม่ได้อนุมัติ</p>
      <Steps now={2} sent={waiting.since} />
      <p className="auth-help">ถ้ารอนานเกินไป ติดต่อผู้จัดการสาขาให้อนุมัติที่เมนู <b>ทีมและสิทธิ์การใช้งาน</b> อนุมัติแล้วกลับมาเข้าสู่ระบบด้วยอีเมลและรหัสผ่านเดิม ไม่ต้องสมัครใหม่</p>
      <button type="button" className="btn-primary auth-submit !justify-center" onClick={() => switchView("login")}>กลับไปหน้าเข้าสู่ระบบ</button>
    </>;
  } else if (view === "sent" && sent) {
    panel = <>
      <span className="auth-done-ic" aria-hidden>✓</span>
      <h2>ส่งคำขอสมัครแล้ว</h2>
      <p className="auth-form-description is-keep">ยังเข้าสู่ระบบไม่ได้ จนกว่าผู้จัดการสาขา{sent.branch} จะอนุมัติ</p>
      <Steps now={2} sent={sent.at} />
      <dl className="auth-kv">
        <div><dt>ชื่อ</dt><dd>{sent.name}</dd></div>
        <div><dt>อีเมลที่ใช้เข้าสู่ระบบ</dt><dd>{sent.email}</dd></div>
        <div><dt>สาขา</dt><dd>{sent.branch}</dd></div>
      </dl>
      <p className="auth-help">ระบบแจ้งเตือนผู้จัดการสาขาให้แล้ว ผู้จัดการเห็นคำขอที่เมนู <b>ทีมและสิทธิ์การใช้งาน</b> สถานะ &quot;รออนุมัติ&quot;</p>
      <button type="button" className="btn-primary auth-submit !justify-center" onClick={() => { setF((x) => ({ ...x, email: sent.email })); switchView("login"); }}>กลับไปหน้าเข้าสู่ระบบ</button>
    </>;
  } else if (view === "register") {
    panel = <>
      {back}
      <h2>สมัครใช้งาน</h2>
      <p className="auth-form-description is-keep">สำหรับพนักงานใหม่ที่ยังไม่มีบัญชี</p>
      <Steps now={1} mini />
      <form onSubmit={submit} noValidate>
        <div className="mt-4"><label className="label" htmlFor="reg-name">ชื่อ-นามสกุล</label><div className="input-with-icon"><Icon name="user" /><input id="reg-name" value={f.name} onChange={set("name")} placeholder="เช่น สมหญิง ใจดี" autoComplete="name" required /></div></div>
        <div className="mt-4"><label className="label" htmlFor="reg-email">อีเมล</label><div className="input-with-icon"><Icon name="mail" /><input id="reg-email" type="email" value={f.email} onChange={set("email")} placeholder="name@kinhomecare.com" autoComplete="email" required /></div><p className="auth-help">ใช้อีเมลนี้เข้าสู่ระบบทุกครั้ง</p></div>
        <div className="mt-4"><label className="label" htmlFor="reg-branch">สาขาที่ปฏิบัติงาน</label><select id="reg-branch" value={f.branch} onChange={set("branch")} required><option value="">-- เลือกสาขา --</option>{branchNames.map((b) => <option key={b}>{b}</option>)}</select><p className="auth-help">ผู้จัดการสาขานี้จะเป็นคนอนุมัติ</p></div>
        <div className="mt-4"><label className="label" htmlFor="reg-password">ตั้งรหัสผ่าน (อย่างน้อย 8 ตัวอักษร)</label><div className="input-with-icon"><Icon name="lock" /><input id="reg-password" type={show ? "text" : "password"} value={f.password} onChange={set("password")} placeholder="ตั้งรหัสผ่าน" autoComplete="new-password" required /><button type="button" className="password-eye" onClick={() => setShow(!show)} aria-pressed={show} aria-label={show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}><Icon name="eye" /></button></div></div>
        <div className="mt-4"><label className="label" htmlFor="reg-confirm">ยืนยันรหัสผ่าน</label><div className="input-with-icon"><Icon name="lock" /><input id="reg-confirm" type={show ? "text" : "password"} value={f.confirm} onChange={set("confirm")} placeholder="กรอกรหัสผ่านอีกครั้ง" autoComplete="new-password" required /></div></div>
        {errBox}
        <button className="btn-primary auth-submit" disabled={busy}>{busy ? "กำลังส่ง…" : "ส่งคำขอสมัคร"} <Icon name="arrow" className="h-5 w-5" /></button>
      </form>
      <p className="auth-note"><Icon name="user" className="h-4 w-4 shrink-0" /><span>สมัครเองได้ในตำแหน่งพยาบาล · นักกายภาพ ฝ่ายขาย หรือตำแหน่งอื่น ผู้จัดการสาขาปรับตำแหน่งให้ตอนอนุมัติ หรือสร้างบัญชีให้แทนได้</span></p>
    </>;
  } else {
    panel = <>
      <span className="auth-symbol"><Icon name="heart" className="h-6 w-6" /></span>
      <p className="kicker mt-5">KIN CARE</p>
      <h2>ยินดีต้อนรับ</h2>
      <p className="auth-form-description">เข้าสู่ระบบครั้งเดียว ใช้ได้ทุกแอปที่คุณมีสิทธิ์</p>
      <div className="auth-mini-apps" aria-label="แอปของ KIN">{APP_ORDER.map((id) => <span key={id}><Icon name={APPS[id].icon} className="h-4 w-4" />{APPS[id].name}</span>)}</div>
      <form onSubmit={submit} noValidate>
        <div className="mt-5"><label className="label" htmlFor="login-email">อีเมล</label><div className="input-with-icon"><Icon name="mail" /><input id="login-email" type="email" value={f.email} onChange={set("email")} placeholder="name@kinhomecare.com" autoComplete="username" required /></div></div>
        <div className="mt-4">
          <div className="auth-label-row"><label className="label" htmlFor="login-password">รหัสผ่าน</label><button type="button" className="auth-link" aria-expanded={forgot} onClick={() => setForgot(!forgot)}>ลืมรหัสผ่าน?</button></div>
          <div className="input-with-icon"><Icon name="lock" /><input id="login-password" type={show ? "text" : "password"} value={f.password} onChange={set("password")} placeholder="กรอกรหัสผ่านของคุณ" autoComplete="current-password" required /><button type="button" className="password-eye" onClick={() => setShow(!show)} aria-pressed={show} aria-label={show ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}><Icon name="eye" /></button></div>
          {forgot && <p className="auth-help" role="status">ติดต่อผู้จัดการสาขาของคุณ ให้ตั้งรหัสผ่านใหม่ที่เมนู <b>ทีมและสิทธิ์การใช้งาน</b> แล้วเข้าสู่ระบบด้วยรหัสใหม่</p>}
        </div>
        <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm text-gold-700">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-[#8b6e3e]" />
          <span><b className="font-medium text-gold-800">จดจำฉันไว้ในเครื่องนี้</b><span className="block text-xs text-gold-500">อยู่ในระบบได้ 30 วัน และจำอีเมลไว้ให้ · ถ้าเป็นเครื่องที่ใช้ร่วมกับคนอื่น ไม่ต้องติ๊ก ระบบจะออกเองเมื่อปิดเบราว์เซอร์</span></span>
        </label>
        {errBox}
        <button className="btn-primary auth-submit" disabled={busy}>{busy ? "กำลังตรวจสอบ…" : "เข้าสู่ระบบ"} <Icon name="arrow" className="h-5 w-5" /></button>
      </form>
      <div className="auth-signup">
        <p className="auth-or"><span>ยังไม่มีบัญชี?</span></p>
        <button type="button" className="auth-signup-btn" onClick={() => switchView("register")}><Icon name="user" className="h-[18px] w-[18px]" />สมัครใช้งาน</button>
        <p className="auth-signup-note">สำหรับพนักงานใหม่ของ KIN · ผู้จัดการสาขาอนุมัติแล้วจึงเข้าใช้งานได้</p>
      </div>
      {SHOW_DEMO && <details className="auth-demo">
        <summary>บัญชีทดลองตามตำแหน่ง (สำหรับทดสอบ)</summary>
        <div className="mt-2.5 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          {ROLES.slice().reverse().map((role) => (
            <button key={role} type="button" onClick={() => { setCopied(""); setDemo(role); }} className="flex min-w-0 flex-col items-center gap-1 rounded-xl border border-cream-200 bg-white px-2 py-2 text-center transition hover:border-gold-300 hover:bg-cream-50">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-cream-100 text-gold-600"><Icon name={ROLE_ICON[role]} className="h-[18px] w-[18px]" /></span>
              <span className="text-[11px] font-medium leading-4 text-gold-800">{ROLE_INFO[role].th}</span>
            </button>
          ))}
        </div>
      </details>}
    </>;
  }

  return <main className="auth-page">
    <header className="auth-top"><a href="/" className="brand-lockup"><Image src="/logo-mark.png" alt="KIN" width={48} height={36} priority /><span>KIN<span className="brand-divider" />THE ART OF CARE</span></a>
      {canOffer && (staff
        ? <button type="button" className="auth-install-btn" onClick={() => setInstallInfo(true)} aria-label="ติดตั้ง KinApp บนโทรศัพท์ · ดูวิธีติดตั้ง"><Icon name="download" className="h-[18px] w-[18px]" /><span>ติดตั้งแอป</span><i aria-hidden /></button>
        : <Link href="/staff?install=1" className="auth-install-btn" aria-label="ติดตั้ง KinApp บนโทรศัพท์ · ดูวิธีติดตั้ง"><Icon name="download" className="h-[18px] w-[18px]" /><span>ติดตั้งแอป</span><i aria-hidden /></Link>)}
      <span className="auth-top-note">REHABILITATION & HOMECARE</span></header>
    <div className="auth-stage">
      <section className="auth-editorial">
        <span className="kicker"><span className="small-line" /> PEOPLE. PURPOSE. CARE.</span>
        <h1>พื้นที่ของความใส่ใจ<br /><span>ที่ออกแบบเพื่อคุณ</span></h1>
        <div className="auth-apps-head"><b>บัญชีเดียว ใช้ได้ทุกแอปของ KIN</b><small>เห็นเฉพาะแอปที่ได้รับสิทธิ์</small></div>
        {appList}
        <div className="auth-editorial-foot"><span>ผู้บริหารและผู้จัดการสาขาใช้ได้ทุกแอป</span></div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form">
          {panel}
          <Modal open={!!demo} title={demo ? ROLE_INFO[demo].th : ""} onClose={() => setDemo(null)}
            footer={demoAcc ? <><button className="btn-soft" onClick={() => { switchView("login"); setF({ ...f, email: demoAcc.email, password: DEMO_PASSWORD }); setDemo(null); }}>กรอกให้ในฟอร์ม</button><button className="btn-primary" disabled={busy} onClick={() => { setDemo(null); switchView("login"); setF({ ...f, email: demoAcc.email, password: DEMO_PASSWORD }); login(demoAcc.email, DEMO_PASSWORD); }}>เข้าด้วยบัญชีนี้ <Icon name="arrow" className="h-4 w-4" /></button></> : <button className="btn-primary" onClick={() => setDemo(null)}>ปิด</button>}>
            {demo && <div className="space-y-5">
              <div className="flex items-start gap-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-cream-100 text-gold-600"><Icon name={ROLE_ICON[demo]} className="h-6 w-6" /></span>
                <div><p className="text-xs tracking-wider text-gold-500">ACCESS LEVEL · {demo.toUpperCase()}</p><p className="mt-1 text-sm leading-7 text-gold-700">{ROLE_INFO[demo].sees}</p></div>
              </div>
              {demoAcc && <dl className="divide-y divide-cream-200 rounded-2xl border border-cream-200">
                {[["อีเมล", demoAcc.email], ["รหัสผ่าน", DEMO_PASSWORD], ["สาขา", demoAcc.branch], ["ใช้ได้กับแอป", demoApps(demo)]].map(([k, v]) => (
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
        </div>
      </section>
    </div>
    <footer className="auth-bottom"><span>KIN REHABILITATION & HOMECARE</span><span>Thoughtfully designed. Carefully connected.</span></footer>
    <Modal open={installInfo} title="ติดตั้ง KinApp บนโทรศัพท์" onClose={() => setInstallInfo(false)}
      footer={pwa.canInstall && osTab === "Android"
        ? <><button type="button" className="btn-soft" onClick={() => setInstallInfo(false)}>ไว้ทีหลัง</button><button type="button" className="btn-primary" onClick={async () => { if (await pwa.install()) setInstallInfo(false); }}><Icon name="download" className="h-4 w-4" /> ติดตั้ง KinApp</button></>
        : <button type="button" className="btn-primary" onClick={() => setInstallInfo(false)}>เข้าใจแล้ว</button>}>
      <div className="space-y-4 text-sm leading-6 text-gold-700">
        <div className="install-why">
          <p><b>ติดตั้งก่อนเข้าสู่ระบบ</b> แล้วเปิด KinApp จากไอคอน KIN บนหน้าจอโทรศัพท์</p>
          <ul>
            <li>เปิดแอปได้ทันที ไม่ต้องพิมพ์ที่อยู่เว็บ</li>
            <li>รับแจ้งเตือนเมื่อหัวหน้าตามงาน เป็นชื่อและโลโก้ KinApp</li>
            <li>เข้าสู่ระบบครั้งเดียวในแอป</li>
          </ul>
        </div>
        <Tabs tabs={["Android", "iPhone"]} value={osTab} onChange={setOsTab} />
        {osTab === "iPhone" ? <>
          <ol className="install-steps">
            <li>เปิดหน้านี้ใน <b>Safari</b> (ถ้าเปิดจาก LINE, Facebook หรือ Chrome ให้คัดลอกลิงก์ไปเปิดใน Safari)</li>
            <li>กดปุ่ม <b>แชร์</b> (สี่เหลี่ยมมีลูกศรชี้ขึ้น) แถบล่างของจอ</li>
            <li>เลื่อนลงแล้วกด <b>เพิ่มไปยังหน้าจอโฮม</b> · iOS 18 อาจต้องกด &quot;ดูเพิ่มเติม&quot; ก่อน · ถ้ามีสวิตช์ &quot;เปิดเป็นเว็บแอป&quot; ให้เปิดไว้</li>
            <li>กด <b>เพิ่ม</b> แล้วเปิด KinApp จาก<b>ไอคอนบนหน้าจอโฮม</b> จึงเข้าสู่ระบบ</li>
            <li>ในแอป กดแท็บ <b>ฉัน</b> → <b>แจ้งเตือนบนโทรศัพท์</b> → อนุญาต</li>
          </ol>
          <p className="install-note">ต้องเป็น iOS 16.4 ขึ้นไปจึงรับแจ้งเตือนได้ (ดูที่ ตั้งค่า → ทั่วไป → เกี่ยวกับ) · ถ้าเข้าสู่ระบบใน Safari ก่อน ต้องเข้าสู่ระบบอีกครั้งในแอปที่ติดตั้ง</p>
        </> : <>
          {pwa.canInstall
            ? <p>กดปุ่ม <b>ติดตั้ง KinApp</b> ด้านล่าง แล้วกดยืนยัน ไอคอน KIN จะอยู่บนหน้าจอโทรศัพท์ เปิดจากไอคอนแล้วเข้าสู่ระบบได้เลย</p>
            : <ol className="install-steps">
              <li>เปิดหน้านี้ใน <b>Chrome</b></li>
              <li>กดเมนู <b>⋮</b> มุมขวาบนของ Chrome</li>
              <li>เลือก <b>ติดตั้งแอป</b> หรือ <b>เพิ่มลงในหน้าจอหลัก → ติดตั้ง</b> (อย่าเลือก &quot;สร้างทางลัด&quot;)</li>
              <li>เปิด KinApp จาก<b>ไอคอน KIN</b> บนหน้าจอ แล้วเข้าสู่ระบบ</li>
            </ol>}
          <p className="install-note">ติดตั้งแล้วจะเห็น KinApp ในรายการแอปทั้งหมดของโทรศัพท์ · เปิดแจ้งเตือนในแอปที่แท็บ ฉัน → แจ้งเตือนบนโทรศัพท์</p>
        </>}
      </div>
    </Modal>
  </main>;
}
