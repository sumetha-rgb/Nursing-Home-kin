import { siteUrl } from "./site";

/** รีวิวพนักงานจากครอบครัว: ค่าที่ใช้ร่วมกันทั้งหน้าแบบฟอร์มสาธารณะ ระบบจัดการ และ API */
export const REVIEW_TAGS = ["ใส่ใจ อ่อนโยน", "สุภาพ ยิ้มแย้ม", "ตรงเวลา", "สื่อสารกับญาติดี", "ดูแลความสะอาด", "มืออาชีพ"] as const;
export const RELATIONS = ["บุตร/ธิดา", "คู่สมรส", "หลาน", "ญาติ", "ผู้รับบริการเอง", "อื่น ๆ"] as const;
/** อายุลิงก์รีวิว (วัน) · หมดอายุแล้วผู้จัดการสร้างใหม่ได้ */
export const LINK_DAYS = 90;
/** ช่วงเวลาที่ใช้คิดคะแนนรีวิวของพนักงาน (วัน) */
export const SCORE_DAYS = 90;

export type StaffScore = { staff_id: string; staff_name: string; branch_name: string; reviews: number; avg: number; five: number; top_tags: string[] };
export type StaffReview = {
  id: string; staff_id: string; staff_name: string; branch_name: string; resident_name: string | null; rating: number;
  tags: string[]; comment: string | null; rater_name: string | null; relation: string | null; at: string;
};
export type ReviewLink = { id: string; token: string; resident_id: string; resident_name: string; branch_name: string; created_by: string | null; carers?: string[]; active: boolean; expires: string | null; expired: boolean; reviews: number; at: string };

export const reviewUrl = (token: string) => `${siteUrl()}/review/${token}`;
/** สมุดภาพประจำวันของครอบครัว (ลิงก์เดียวกัน มีปุ่มไปหน้ารีวิว) */
export const familyUrl = (token: string) => `${siteUrl()}/family/${token}`;
