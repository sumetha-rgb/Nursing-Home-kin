/* KinApp service worker: เปิดแอปได้แม้ออฟไลน์
 *  หน้า /staff, /pharmacy : network-first (ออฟไลน์ใช้หน้าที่เก็บไว้ล่าสุด)
 *  /_next/static, ไอคอน, ฟอนต์ : cache-first (ไฟล์มีเลขเวอร์ชันในชื่ออยู่แล้ว)
 *  /api/* : ไม่ผ่าน service worker เลย (ข้อมูลจริงจัดการใน lib/store.ts)
 *  push : แจ้งเตือนบนโทรศัพท์ (หัวหน้าตามงาน ฯลฯ) · กดแจ้งเตือน = เปิด KinApp · ส่งต่อให้หน้าที่เปิดอยู่ดึงข้อมูลใหม่ทันที
 *  localhost : ไม่ cache อะไรเลย (ตอนพัฒนาไฟล์เปลี่ยนตลอด) แต่ยังรับแจ้งเตือนได้
 * เปลี่ยน VERSION เมื่อแก้ไฟล์นี้ เพื่อล้าง cache เก่า */
const VERSION = "kinapp-v4";
const DEV = ["localhost", "127.0.0.1"].includes(self.location.hostname);
const SHELL = ["/staff", "/pharmacy", "/kinapp.webmanifest", "/icons/kinapp-192.png", "/logo-mark.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const put = (req, res) => { if (res.ok && res.type === "basic") { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; };

self.addEventListener("fetch", (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (DEV || req.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((res) => put(req, res)).catch(async () => (await caches.match(req, { ignoreSearch: true })) || caches.match("/staff")));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/") || /\.(png|svg|woff2?|webmanifest)$/.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => put(req, res))));
  }
});

// ---------- แจ้งเตือนบนโทรศัพท์ ----------
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  // ส่งต่อให้หน้าที่เปิดอยู่ ดึงข้อมูลใหม่ทันที (lib/pushRefresh.ts) · แล้วแสดงแจ้งเตือนตามปกติ
  const tell = self.clients.matchAll({ type: "window", includeUncontrolled: true })
    .then((list) => list.forEach((c) => c.postMessage({ type: "kin-push", tag: d.tag || "", title: d.title || "", body: d.body || "" })));
  e.waitUntil(Promise.all([tell, self.registration.showNotification(d.title || "KinApp", {
    body: d.body || "",
    icon: "/icons/kinapp-192.png",
    badge: "/icons/kinapp-badge-96.png", // ไอคอนเล็กบนแถบสถานะ Android (ขาวโปร่งใส · ไม่ใส่ = ขึ้นโลโก้ Chrome)
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: d.url || "/staff" },
  })]));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "/staff";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    const target = new URL(url, self.location.origin);
    // ลิงก์ที่ระบุเมนู (?view=...): ใช้หน้าต่างของแอปเดียวกันแล้วพาไปหน้านั้น · ไม่มี = โฟกัสหน้าต่างเดิมตามเดิม
    const same = list.find((c) => new URL(c.url).pathname === target.pathname);
    if (target.search && same) return same.focus().then((c) => (c && c.navigate ? c.navigate(target.href) : c));
    if (target.search) return self.clients.openWindow(target.href);
    const open = list.find((c) => new URL(c.url).pathname.startsWith(target.pathname));
    return open ? open.focus() : self.clients.openWindow(url);
  }));
});
