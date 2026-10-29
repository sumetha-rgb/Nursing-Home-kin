"use client";

/** บัญชีที่ไม่ได้ติ๊กสิทธิ์แอปนี้ (เช่น แคชเชียร์) · ไปใช้ระบบจัดการแทน */
export default function CashierOnly({ name, app, onLogout }: { name: string; app: string; onLogout: () => void }) {
  return (
    <main className="grid min-h-dvh place-items-center px-5">
      <section className="card w-full max-w-md p-8 text-center">
        <p className="kicker justify-center">KIN CARE TEAM</p>
        <h1 className="mt-3 text-2xl font-medium text-gold-800">สวัสดี {name}</h1>
        <p className="mt-3 text-sm leading-7 text-gold-600">บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้{app} ติดต่อผู้จัดการสาขาให้ติ๊กสิทธิ์ในหน้าทีมและสิทธิ์การใช้งาน</p>
        <a href="/" className="btn-primary mt-6 w-full">ไปที่ระบบจัดการ</a>
        <button className="mt-5 text-sm text-gold-500 underline-offset-4 hover:underline" onClick={onLogout}>ออกจากระบบ</button>
      </section>
    </main>
  );
}
