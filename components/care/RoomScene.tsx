"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import Icon from "../Icon";
import { RoomInfo } from "@/lib/rooms";

/**
 * แผนผังห้องผู้ป่วย 3 มิติ (three.js · WebGL) หมุน ซูม เลื่อนได้ด้วยเมาส์และนิ้ว
 * ทุกอย่างสร้างจากข้อมูลห้อง: ขนาดห้องตามจำนวนเตียง ห้องน้ำ เตียง ตู้ข้างเตียง ม่าน ฉากกั้น หน้าต่าง ประตู
 * โทนขาว-มิ้นต์ · ป้ายลอยเหนือห้องบอกเลขห้องและสถานะ (สีป้าย) · จิ้มคนบนเตียง = ดูรายละเอียดผู้ป่วย · จิ้มห้อง/ป้าย/เตียงว่าง = ดูรายละเอียดห้อง
 * แสดงทีละชั้น/โซน และใช้รูปทรงชุดเดียวกันทั้งฉาก เพื่อให้เปิดบนมือถือได้ลื่น
 */
type Pick = { kind: "room"; i: number } | { kind: "bed"; i: number; bed: string; who?: string };

const WALL_H = 1.15, T = 0.12, BATH = 1.9, BED_W = 1.0, BED_L = 2.05, PITCH = 1.8, ROW = 3.2, PER_ROW = 4;
/** สีสถานะ (ป้ายเหนือห้อง) และสีพื้นห้องอ่อน ๆ ตามสถานะ */
const WALL = { free: "#2f9e7a", part: "#d49a2a", full: "#d0574a", closed: "#9a948a" };
const FLOOR_TINT = { free: "#f3fbf8", part: "#fffaf0", full: "#fff3f1", closed: "#f1f0ee" };
const CHIP = (r: RoomInfo) => (r.closed ? "ปิดปรับปรุง" : r.full ? "เต็ม" : r.people.length ? `ว่าง ${r.free}` : "ว่าง");
const esc = (x: string) => x.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const statusOf = (r: RoomInfo) => (r.closed ? "closed" : r.full ? "full" : r.people.length ? "part" : "free") as keyof typeof WALL;
const roomSize = (n: number) => {
  const perRow = Math.min(n, PER_ROW), rows = Math.ceil(n / PER_ROW);
  return { w: BATH + 0.45 + perRow * PITCH + 0.3, d: Math.max(BATH + 2.6, 0.35 + rows * ROW + 1.6) };
};

/** ป้ายข้อความบนพื้น (CanvasTexture) */
function label(lines: { text: string; size: number; color: string; weight?: number }[], w = 512, h = 256) {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d")!;
  const font = getComputedStyle(document.body).fontFamily || "sans-serif";
  const total = lines.reduce((n, l) => n + l.size * 1.15, 0);
  let y = (h - total) / 2;
  for (const l of lines) {
    g.font = `${l.weight ?? 700} ${l.size}px ${font}`; g.fillStyle = l.color; g.textAlign = "center"; g.textBaseline = "top";
    g.fillText(l.text, w / 2, y); y += l.size * 1.15;
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
/** ลายกระเบื้องพื้น */
function tileTexture(base: string, line: string) {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.fillStyle = base; g.fillRect(0, 0, 128, 128); g.strokeStyle = line; g.lineWidth = 3; g.strokeRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export default function RoomScene({ rooms, selected, onRoom, onPerson, onFail }: {
  rooms: RoomInfo[]; selected: number | null; onRoom: (i: number) => void; onPerson: (i: number, bed: string, who: string) => void; onFail: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const api = useRef<{ fit: (top?: boolean) => void; zoom: (k: number) => void; highlight: (i: number | null) => void } | null>(null);
  const cb = useRef({ onRoom, onPerson }); cb.current = { onRoom, onPerson };
  const floors = useMemo(() => [...new Set(rooms.map((r) => r.floor))].sort((a, b) => (a || "ฮ").localeCompare(b || "ฮ", "th", { numeric: true })), [rooms]);
  const [floor, setFloor] = useState<string>("");
  const cur = floors.includes(floor) ? floor : floors[0] ?? "";
  const list = rooms.filter((r) => r.floor === cur);
  // สร้างฉากใหม่เมื่อข้อมูลห้อง/คนเปลี่ยนเท่านั้น
  const key = JSON.stringify(list.map((r) => [r.i, r.no, r.capacity, r.closed, r.beds.map((b) => b.who ?? "")]));

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { onFail(); return; }
    const small = window.innerWidth < 900;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, small ? 1.5 : 2));
    renderer.shadowMap.enabled = !small;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 500);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = 1.38; controls.screenSpacePanning = true;
    scene.add(new THREE.HemisphereLight(0xffffff, 0xe3eeeb, 1.7), new THREE.AmbientLight(0xffffff, 0.45));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.castShadow = !small; sun.shadow.mapSize.set(2048, 2048);
    scene.add(sun, sun.target);

    // วัสดุและรูปทรงใช้ร่วมกันทั้งฉาก
    const unit = new THREE.BoxGeometry(1, 1, 1);
    const sphere = new THREE.SphereGeometry(1, 20, 14);
    const mats = new Map<string, THREE.Material>();
    const mat = (color: string, o: { opacity?: number; rough?: number } = {}) => {
      const k = `${color}|${o.opacity ?? 1}|${o.rough ?? 0.85}`;
      if (!mats.has(k)) mats.set(k, new THREE.MeshStandardMaterial({ color, roughness: o.rough ?? 0.85, transparent: (o.opacity ?? 1) < 1, opacity: o.opacity ?? 1 }));
      return mats.get(k)!;
    };
    const textures: THREE.Texture[] = [];
    const floorTex = tileTexture("#ffffff", "#e7ecea"); textures.push(floorTex);
    const bathTex = tileTexture("#e8f4f6", "#cfe2e6"); textures.push(bathTex);
    const pickables: THREE.Object3D[] = [];

    const box = (g: THREE.Group, sx: number, sy: number, sz: number, x: number, y: number, z: number, m: THREE.Material, shadow = true) => {
      const b = new THREE.Mesh(unit, m); b.scale.set(sx, sy, sz); b.position.set(x, y, z);
      b.castShadow = shadow; b.receiveShadow = true; g.add(b); return b;
    };
    const plane = (g: THREE.Group, w: number, d: number, x: number, z: number, y: number, m: THREE.Material) => {
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), m); p.rotation.x = -Math.PI / 2; p.position.set(x, y, z); p.receiveShadow = true; g.add(p); return p;
    };

    /** ห้องหนึ่งห้อง วางมุมซ้ายหลังที่ (0,0) · z = 0 ผนังหลัง · z = d ประตูหน้าห้อง */
    function buildRoom(r: RoomInfo) {
      const g = new THREE.Group();
      const { w, d } = roomSize(r.capacity);
      const st = statusOf(r);
      const wallM = mat("#f4f6f5", { rough: 0.6 }), capM = mat("#7fcdbd", { rough: 0.5 });
      // พื้น
      const fm = new THREE.MeshStandardMaterial({ map: floorTex.clone(), color: FLOOR_TINT[st], roughness: 0.9 }); (fm.map as THREE.Texture).repeat.set(w / 0.6, d / 0.6); (fm.map as THREE.Texture).needsUpdate = true; textures.push(fm.map!);
      const fl = plane(g, w, d, w / 2, d / 2, 0.002, fm); fl.userData.pick = { kind: "room", i: r.i } satisfies Pick; pickables.push(fl);
      // ผนังรอบห้อง (ประตูหน้าห้องเว้นช่อง 1 เมตร)
      const wall = (sx: number, sz: number, x: number, z: number) => { box(g, sx, WALL_H, sz, x, WALL_H / 2, z, wallM); box(g, sx + 0.002, 0.03, sz + 0.002, x, WALL_H + 0.015, z, capM, false); };
      wall(w, T, w / 2, 0); wall(T, d, 0, d / 2); wall(T, d, w, d / 2);
      const door = w - 1.5;
      wall(door, T, door / 2, d); wall(w - door - 1.0, T, (door + 1.0 + w) / 2, d);
      // หน้าต่างผนังหลัง
      box(g, Math.min(2.4, w - BATH - 0.8), 0.5, 0.05, BATH + (w - BATH) / 2, 0.75, 0.07, mat("#cfe6f1", { opacity: 0.85, rough: 0.2 }), false);
      // ห้องน้ำ: พื้นกระเบื้องฟ้า ผนังกั้น โถส้วม อ่างล้างหน้า
      const bm = new THREE.MeshStandardMaterial({ map: bathTex.clone(), roughness: 0.6 }); (bm.map as THREE.Texture).repeat.set(BATH / 0.3, BATH / 0.3); (bm.map as THREE.Texture).needsUpdate = true; textures.push(bm.map!);
      plane(g, BATH, BATH, BATH / 2, BATH / 2, 0.004, bm);
      const inner = mat("#eef3f2");
      box(g, T * 0.8, WALL_H, BATH - 0.9, BATH, WALL_H / 2, (BATH - 0.9) / 2, inner);
      box(g, BATH, WALL_H, T * 0.8, BATH / 2, WALL_H / 2, BATH, inner);
      const white = mat("#ffffff", { rough: 0.35 });
      box(g, 0.38, 0.4, 0.5, 0.35, 0.2, 0.42, white); box(g, 0.42, 0.45, 0.16, 0.35, 0.45, 0.14, white);
      box(g, 0.55, 0.75, 0.4, 1.35, 0.375, 0.28, mat("#dfe7e5")); box(g, 0.42, 0.06, 0.3, 1.35, 0.78, 0.28, white);
      // เตียง
      const wood = mat("#e1e7e6", { rough: 0.5 }), woodDark = mat("#b9cecb", { rough: 0.5 }), sheet = mat("#ffffff"), blanket = mat("#f2b7c7"), blanket2 = mat("#f6c8d4"), folded = mat("#bfe3da");
      const skin = mat("#ecc6a2"), hair = mat("#5b4430"), curtain = mat("#bfe6dd", { opacity: 0.92 }), rail = mat("#b4c2bf"), screen = mat("#d6edea", { opacity: 0.7, rough: 0.2 });
      r.beds.forEach((b, k) => {
        const row = Math.floor(k / PER_ROW), col = k % PER_ROW;
        const x0 = BATH + 0.45 + col * PITCH + (PITCH - BED_W) / 2, z0 = 0.35 + row * ROW + (row === 0 ? 0 : 0.2);
        const cx = x0 + BED_W / 2, cz = z0 + BED_L / 2;
        box(g, BED_W, 0.32, BED_L, cx, 0.16, cz, wood);
        box(g, BED_W - 0.08, 0.14, BED_L - 0.12, cx, 0.39, cz + 0.03, sheet);
        box(g, BED_W, 0.78, 0.07, cx, 0.39, z0 + 0.035, woodDark);
        box(g, BED_W, 0.46, 0.05, cx, 0.23, z0 + BED_L - 0.025, woodDark);
        box(g, 0.62, 0.1, 0.32, cx, 0.51, z0 + 0.3, white);
        if (b.who) {
          box(g, BED_W - 0.04, 0.07, 1.3, cx, 0.5, z0 + BED_L - 0.72, blanket);
          box(g, 0.5, 0.12, 1.05, cx, 0.57, z0 + 1.1, blanket2);
          const head = new THREE.Mesh(sphere, skin); head.scale.setScalar(0.12); head.position.set(cx, 0.63, z0 + 0.36); head.castShadow = true; g.add(head);
          const hr = new THREE.Mesh(sphere, hair); hr.scale.set(0.13, 0.11, 0.1); hr.position.set(cx, 0.66, z0 + 0.3); g.add(hr);
        } else box(g, BED_W - 0.08, 0.06, 0.32, cx, 0.49, z0 + BED_L - 0.3, folded);
        // ตู้ข้างเตียง
        box(g, 0.42, 0.56, 0.42, x0 - 0.33, 0.28, z0 + 0.3, mat("#ffffff", { rough: 0.5 }));
        // ราวม่านรอบเตียง และม่านรูดเก็บไว้ที่หัวเตียงด้านขวา
        const rx0 = x0 - 0.12, rx1 = x0 + BED_W + 0.12, rz1 = z0 + BED_L + 0.15, ry = 1.75;
        box(g, 0.03, 0.03, rz1 - z0, rx1, ry, (z0 + rz1) / 2, rail, false); box(g, rx1 - rx0, 0.03, 0.03, (rx0 + rx1) / 2, ry, rz1, rail, false); box(g, 0.03, 0.03, rz1 - z0, rx0, ry, (z0 + rz1) / 2, rail, false);
        for (let f = 0; f < 4; f++) box(g, 0.05, 1.55, 0.16, rx1 + (f % 2 ? 0.03 : -0.01), 0.97, z0 + 0.12 + f * 0.13, curtain);
        // ฉากกั้นระหว่างเตียงในแถวเดียวกัน
        if (col < PER_ROW - 1 && k + 1 < r.beds.length) box(g, 0.05, 1.05, 0.95, x0 + BED_W + (PITCH - BED_W) / 2, 0.55, z0 + BED_L - 0.6, screen);
        // ป้ายเตียง
        const bt = label([{ text: b.label, size: 150, color: b.who ? "#c0587a" : "#5fae9c" }], 256, 256); textures.push(bt);
        const bp = plane(g, 0.42, 0.42, cx, z0 + BED_L + 0.35, 0.006, new THREE.MeshBasicMaterial({ map: bt, transparent: true }));
        bp.userData.pick = { kind: "bed", i: r.i, bed: b.label, who: b.who } satisfies Pick; pickables.push(bp);
        // พื้นที่จิ้มเตียง (มองไม่เห็น)
        const hit = new THREE.Mesh(unit, new THREE.MeshBasicMaterial({ visible: false })); hit.scale.set(BED_W + 0.1, 1, BED_L + 0.1); hit.position.set(cx, 0.5, cz);
        hit.userData.pick = { kind: "bed", i: r.i, bed: b.label, who: b.who } satisfies Pick; g.add(hit); pickables.push(hit);
      });
      // เก้าอี้ญาติ มุมหน้าห้อง
      box(g, 0.6, 0.4, 0.6, w - 0.7, 0.2, d - 0.75, mat("#cfd9d7")); box(g, 0.6, 0.5, 0.12, w - 0.7, 0.55, d - 0.47, mat("#bdcac8"));
      return { g, w, d };
    }

    // จัดห้องเป็นแถว (ทางเดินกว้าง 2 เมตรระหว่างแถว)
    const world = new THREE.Group(); scene.add(world);
    const built = list.map((r) => ({ r, ...buildRoom(r) }));
    const cols = Math.max(1, Math.min(5, Math.ceil(Math.sqrt(built.length * 1.3))));
    const pos = new Map<number, { x: number; z: number; w: number; d: number }>();
    let z = 0;
    for (let k = 0; k < built.length; k += cols) {
      const rowItems = built.slice(k, k + cols);
      let x = 0;
      for (const b of rowItems) { b.g.position.set(x, 0, z); world.add(b.g); pos.set(b.r.i, { x, z, w: b.w, d: b.d }); x += b.w + 0.25; }
      z += Math.max(...rowItems.map((b) => b.d)) + 2.0;
    }
    const bbox = new THREE.Box3().setFromObject(world);
    const size = bbox.getSize(new THREE.Vector3()), center = bbox.getCenter(new THREE.Vector3());
    // ฐานอาคารพอดีตัว (ไม่มีพื้นที่โล่งรอบ ๆ)
    const slab = new THREE.Mesh(unit, mat("#e4ebe9", { rough: 0.9 }));
    slab.scale.set(size.x + 1.2, 0.25, size.z + 1.2); slab.position.set(center.x, -0.126, center.z); slab.receiveShadow = true; scene.add(slab);
    const slabEdge = new THREE.Mesh(unit, mat("#7fcdbd", { rough: 0.5 }));
    slabEdge.scale.set(size.x + 1.3, 0.06, size.z + 1.3); slabEdge.position.set(center.x, -0.27, center.z); scene.add(slabEdge);
    const span = Math.max(size.x, size.z);
    sun.position.set(center.x + span * 0.4, span + 12, center.z + span * 0.3); sun.target.position.copy(center);
    Object.assign(sun.shadow.camera, { left: -span, right: span, top: span, bottom: -span, far: span * 3 + 40 }); sun.shadow.camera.updateProjectionMatrix();
    controls.maxDistance = span * 3 + 25; controls.minDistance = 2.5;

    // กรอบเรืองแสงของห้องที่เลือก
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x3fb59b, transparent: true, opacity: 0.4 }));
    glow.rotation.x = -Math.PI / 2; glow.visible = false; scene.add(glow);

    let need = true;
    const fit = (top = false) => {
      // ระยะกล้องที่ทำให้ทั้งอาคารพอดีกรอบภาพ (เผื่อป้ายลอยเหนือห้อง)
      const half = Math.tan((camera.fov * Math.PI) / 360);
      const need2 = Math.max(size.z * 0.62 + 1.2, (size.x * 0.55 + 1) / Math.max(0.6, camera.aspect));
      const r = need2 / half;
      controls.target.copy(center).setY(0.6);
      const dir = top ? new THREE.Vector3(0, 1, 0.02) : new THREE.Vector3(0.42, 0.95, 0.85);
      camera.position.copy(controls.target).add(dir.normalize().multiplyScalar(r));
      controls.update(); need = true;
    };
    const zoom = (k: number) => { const v = camera.position.clone().sub(controls.target).multiplyScalar(k); if (v.length() > controls.minDistance && v.length() < controls.maxDistance) camera.position.copy(controls.target).add(v); need = true; };
    const highlight = (i: number | null) => {
      const p = i !== null ? pos.get(i) : undefined;
      glow.visible = !!p;
      if (p) { glow.scale.set(p.w + 0.7, p.d + 0.7, 1); glow.position.set(p.x + p.w / 2, 0.001, p.z + p.d / 2); }
      need = true;
    };
    api.current = { fit, zoom, highlight };

    // ป้ายลอยเหนือห้อง: เลขห้องตัวใหญ่ + สถานะสี (ขยับตามกล้องทุกครั้งที่วาด)
    const tagLayer = document.createElement("div"); tagLayer.className = "r3d-tags"; el.appendChild(tagLayer);
    const tags = built.map((b) => {
      const t = document.createElement("button"); t.type = "button"; t.className = `r3d-tag is-${statusOf(b.r)}`;
      t.innerHTML = `<b>${esc(b.r.no)}</b><span>${esc(CHIP(b.r))}</span><small>${b.r.people.length}/${b.r.capacity}</small>`;
      t.setAttribute("aria-label", `ห้อง ${b.r.no} ${CHIP(b.r)}`);
      t.addEventListener("click", () => cb.current.onRoom(b.r.i)); tagLayer.appendChild(t);
      const p = pos.get(b.r.i)!;
      return { t, v: new THREE.Vector3(p.x + p.w * 0.5, WALL_H + 0.45, p.z + p.d * 0.5) };
    });
    const tmp = new THREE.Vector3();
    const placeTags = () => {
      const w = el.clientWidth, h = el.clientHeight;
      for (const { t, v } of tags) {
        tmp.copy(v).project(camera);
        if (tmp.z > 1) { t.style.display = "none"; continue; }
        t.style.display = ""; t.style.transform = `translate(${((tmp.x + 1) / 2) * w}px, ${((1 - tmp.y) / 2) * h}px) translate(-50%, -100%)`;
      }
    };

    const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); need = true; };
    const ro = new ResizeObserver(resize); ro.observe(el); resize();
    fit(); highlight(selected);
    controls.addEventListener("change", () => { need = true; });

    // จิ้ม/คลิก (ไม่นับตอนลากหมุน) และ tooltip ตอนชี้
    const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
    const hitAt = (e: PointerEvent) => {
      const rc = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const h = ray.intersectObjects(pickables, false).find((x) => x.object.userData.pick);
      // เตียงอยู่หน้าพื้นห้องเสมอ
      const bed = ray.intersectObjects(pickables, false).find((x) => x.object.userData.pick?.kind === "bed");
      return (bed ?? h)?.object.userData.pick as Pick | undefined;
    };
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => { down = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; }
      down = null;
      const p = hitAt(e);
      if (!p) return;
      if (p.kind === "bed" && p.who) cb.current.onPerson(p.i, p.bed, p.who); else cb.current.onRoom(p.i);
    };
    let hoverQueued = false, lastMove: PointerEvent | null = null;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      lastMove = e;
      if (hoverQueued) return; hoverQueued = true;
      requestAnimationFrame(() => {
        hoverQueued = false;
        const p = lastMove && hitAt(lastMove), t = tip.current;
        renderer.domElement.style.cursor = p ? "pointer" : "grab";
        if (!t || !lastMove) return;
        const room = p && list.find((r) => r.i === p.i);
        if (!p || !room) { t.style.opacity = "0"; return; }
        t.textContent = p.kind === "bed" ? `ห้อง ${room.no} · เตียง ${p.bed} · ${p.who ?? "ว่าง"}${p.who ? " (จิ้มเพื่อดูรายละเอียด)" : ""}` : `ห้อง ${room.no} · ${room.people.length}/${room.capacity} คน`;
        const rc = el.getBoundingClientRect();
        t.style.transform = `translate(${lastMove.clientX - rc.left + 14}px, ${lastMove.clientY - rc.top + 14}px)`; t.style.opacity = "1";
      });
    };
    const onLeave = () => { if (tip.current) tip.current.style.opacity = "0"; };
    const cv = renderer.domElement;
    cv.addEventListener("pointerdown", onDown); cv.addEventListener("pointerup", onUp); cv.addEventListener("pointermove", onMove); cv.addEventListener("pointerleave", onLeave);

    // วาดใหม่เฉพาะตอนมีการเปลี่ยนแปลง (ประหยัดแบตมือถือ)
    let raf = 0;
    const tick = () => { raf = requestAnimationFrame(tick); const moved = controls.update(); if (moved || need) { renderer.render(scene, camera); placeTags(); need = false; } };
    tick();

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose();
      cv.removeEventListener("pointerdown", onDown); cv.removeEventListener("pointerup", onUp); cv.removeEventListener("pointermove", onMove); cv.removeEventListener("pointerleave", onLeave);
      // คืนหน่วยความจำการ์ดจอ: รูปทรง วัสดุ และลายพื้น/ป้ายทั้งหมด
      const done = new Set<unknown>();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry && !done.has(m.geometry)) { done.add(m.geometry); m.geometry.dispose(); }
        const mm = m.material as THREE.Material | undefined;
        if (mm && !done.has(mm)) { done.add(mm); mm.dispose(); }
      });
      textures.forEach((t) => t.dispose());
      renderer.dispose(); el.removeChild(renderer.domElement); tagLayer.remove(); api.current = null;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { api.current?.highlight(selected); }, [selected, key]);

  return (
    <div className="r3d">
      <div className="r3d-bar">
        {floors.length > 1 && <div className="r3d-floors" role="tablist" aria-label="เลือกชั้น/โซน">{floors.map((f) => <button key={f || "-"} type="button" role="tab" aria-selected={f === cur} className={f === cur ? "is-on" : ""} onClick={() => setFloor(f)}>{f || "ไม่ระบุชั้น"}</button>)}</div>}
        <ul className="rmap-legend" aria-label="สีป้ายสถานะห้อง">
          <li><i style={{ background: WALL.free }} />ว่างทั้งห้อง</li><li><i style={{ background: WALL.part }} />มีคนบางส่วน</li><li><i style={{ background: WALL.full }} />เต็ม</li><li><i style={{ background: WALL.closed }} />ปิดปรับปรุง</li>
        </ul>
      </div>
      <div ref={host} className="r3d-canvas">
        <div ref={tip} className="r3d-tip" aria-hidden />
        <div className="r3d-tools">
          <button type="button" aria-label="ซูมเข้า" onClick={() => api.current?.zoom(0.8)}><Icon name="plus" className="h-4 w-4" /></button>
          <button type="button" aria-label="ซูมออก" onClick={() => api.current?.zoom(1.25)}><span className="text-lg leading-none">−</span></button>
          <button type="button" aria-label="มุมมองเอียง" onClick={() => api.current?.fit(false)}><Icon name="refresh" className="h-4 w-4" /></button>
          <button type="button" aria-label="มองจากด้านบน" onClick={() => api.current?.fit(true)}><Icon name="eye" className="h-4 w-4" /></button>
        </div>
        <p className="r3d-hint">ลากเพื่อหมุน · เลื่อนลูกกลิ้ง/บีบนิ้วเพื่อซูม · คลิกขวาหรือสองนิ้วเพื่อเลื่อน · จิ้มคนบนเตียงเพื่อดูรายละเอียด</p>
      </div>
    </div>
  );
}
