"use client";
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import Icon from "./Icon";
export default function Login({onLogin,staff=false}:{onLogin:()=>void;staff?:boolean}) {
  const [show,setShow]=useState(false);
  return <main className="auth-page">
    <header className="auth-top"><a href="/" className="brand-lockup"><Image src="/logo-mark.png" alt="KIN" width={48} height={36} priority /><span>KIN<span className="brand-divider" />THE ART OF CARE</span></a><span className="auth-top-note">REHABILITATION & HOMECARE</span></header>
    <div className="auth-stage">
      <section className="auth-editorial">
        <span className="kicker"><span className="small-line" /> PEOPLE. PURPOSE. CARE.</span>
        <h1>พื้นที่ของความใส่ใจ<br /><span>ที่ออกแบบเพื่อคุณ</span></h1>
        <p className="auth-description">ให้ทุกช่วงเวลาของการดูแลมีความหมาย<br />ด้วยพื้นที่ทำงานที่เชื่อมทุกคนไว้ด้วยกัน</p>
        <div className="sculpture" aria-hidden="true"><div className="sculpture-orbit" /><div className="sculpture-petal petal-one" /><div className="sculpture-petal petal-two" /><div className="sculpture-petal petal-three" /><span className="sculpture-caption">A LITTLE MORE CARE.<br />A BETTER EVERYDAY.</span><span className="sculpture-star">✳</span></div>
        <div className="auth-editorial-foot"><span className="editorial-number">01 —</span><span>การดูแลที่ดี เริ่มต้นจากทีมที่พร้อม</span></div>
      </section>
      <section className="auth-form-panel">
        <form onSubmit={e=>{e.preventDefault();onLogin();}} className="auth-form">
          <span className="auth-symbol"><Icon name={staff?"heart":"grid"} className="h-6 w-6" /></span>
          <p className="kicker mt-7">{staff?"KIN CARE TEAM":"KIN CARE MANAGEMENT"}</p>
          <h2>{staff?"พร้อมดูแลวันนี้":"ยินดีต้อนรับ"}</h2>
          <p className="auth-form-description">{staff?"เข้าสู่พื้นที่ทำงานของทีมดูแล":"เข้าสู่พื้นที่ทำงานของคุณ"}</p>
          <div className="mt-8"><label className="label" htmlFor="login-email">อีเมล</label><div className="input-with-icon"><Icon name="mail" /><input id="login-email" type="email" placeholder="name@kinhomecare.com" autoComplete="username" /></div></div>
          <div className="mt-5"><label className="label" htmlFor="login-password">รหัสผ่าน</label><div className="input-with-icon"><Icon name="lock" /><input id="login-password" type={show?"text":"password"} placeholder="กรอกรหัสผ่านของคุณ" autoComplete="current-password" /><button type="button" className="password-eye" onClick={()=>setShow(!show)} aria-pressed={show} aria-label={show?"ซ่อนรหัสผ่าน":"แสดงรหัสผ่าน"}><Icon name="eye" /></button></div></div>
          <button className="btn-primary auth-submit">เข้าสู่ระบบ <Icon name="arrow" className="h-5 w-5" /></button>
          <div className="demo-note"><span /> โหมดตัวอย่าง · ทดลองใช้งานได้โดยไม่ต้องกรอกข้อมูล</div>
          <div className="auth-alternate"><span>{staff?"สำหรับผู้จัดการศูนย์":"สำหรับทีมดูแล"}</span><Link href={staff?"/":"/staff"}>{staff?"ระบบจัดการ KIN":"แอปพนักงาน"}<Icon name="arrow" className="h-4 w-4" /></Link></div>
        </form>
      </section>
    </div>
    <footer className="auth-bottom"><span>KIN REHABILITATION & HOMECARE</span><span>Thoughtfully designed. Carefully connected.</span></footer>
  </main>;
}

