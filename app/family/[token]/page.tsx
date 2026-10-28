import type { Metadata } from "next";
import FamilyApp from "./FamilyApp";

export const metadata: Metadata = {
  title: "สมุดภาพประจำวัน | KIN Rehabilitation & Homecare",
  description: "ภาพและบันทึกการดูแลประจำวันสำหรับครอบครัว",
  robots: { index: false },
};

/** หน้าสาธารณะสำหรับครอบครัว: สมุดภาพการดูแลประจำวัน (เข้าได้เฉพาะลิงก์ครอบครัวที่สาขาสร้างให้) */
export default function Page({ params }: { params: { token: string } }) {
  return <FamilyApp token={params.token} />;
}
