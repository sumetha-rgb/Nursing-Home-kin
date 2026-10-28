import type { Role } from "./roles";

/** วิดีโอสอนใช้งาน (YouTube แบบไม่เป็นสาธารณะ) · อัดคลิปใหม่แล้วเปลี่ยนแค่ youtube ตรงนี้ */
export type Tutorial = { no: number; title: string; who: string; topics: string[]; youtube: string; roles: Role[] };

export const TUTORIALS: Tutorial[] = [
  { no: 1, title: "ตั้งค่าสาขาและทีม", who: "ผู้บริหารองค์กร", youtube: "https://youtu.be/rAekCtReXfQ", roles: ["Global Admin"],
    topics: ["ข้อมูลสาขา", "สร้างบัญชีและสิทธิ์", "อนุมัติพนักงานใหม่", "ประวัติการแก้ไข", "น้ำหนัก KPI"] },
  { no: 2, title: "วางงานและตรวจงานประจำวัน", who: "ผู้จัดการสาขา", youtube: "https://youtu.be/W_nHH2YATTw", roles: ["Global Admin", "Branch Admin"],
    topics: ["งานประจำ", "มอบหมายคน", "ตรวจงานพร้อมรูป", "ตารางเวร"] },
  { no: 3, title: "รับแจ้งเตือนและสั่งงานติดตาม", who: "หัวหน้าพยาบาล", youtube: "https://youtu.be/PFkU-f3nu74", roles: ["Global Admin", "Branch Admin"],
    topics: ["แจ้งเตือนค่าผิดปกติ", "รับทราบพร้อมบันทึกการดูแล", "สั่งงานวัดซ้ำ"] },
  { no: 4, title: "ใช้ KinApp ในหนึ่งกะ", who: "พนักงานดูแล", youtube: "https://youtu.be/kZqzEZe4rXs", roles: ["Global Admin", "Branch Admin", "Operation"],
    topics: ["เช็คชื่อด้วยรูป", "ส่งงาน", "จ่ายยา", "สัญญาณชีพ", "ส่งเวร", "KPI ของฉัน"] },
  { no: 5, title: "รับยา จัดยา ตรวจ QA", who: "ห้องยา", youtube: "https://youtu.be/2jV9e0MS0KU", roles: ["Global Admin", "Branch Admin", "Operation"],
    topics: ["รับยาเข้าคลัง", "จัดยาลงซอง", "ตรวจ QA", "รายงาน"] },
  { no: 6, title: "ลิงก์ครอบครัว รีวิว และ KPI", who: "ผู้จัดการสาขา", youtube: "https://youtu.be/r_8dIcMsdeI", roles: ["Global Admin", "Branch Admin"],
    topics: ["ป้าย QR แบบประเมิน", "ลิงก์ครอบครัว", "รีวิวพนักงาน", "KPI พนักงาน"] },
];

/** รหัสวิดีโอจากลิงก์ YouTube ทุกรูปแบบ (watch?v=, youtu.be/, shorts/) */
export function youtubeId(url: string) {
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/);
  return m ? m[1] : /^[\w-]{11}$/.test(url) ? url : "";
}
