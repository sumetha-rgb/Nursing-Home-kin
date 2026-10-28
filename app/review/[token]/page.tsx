import type { Metadata } from "next";
import ReviewApp from "./ReviewApp";

export const metadata: Metadata = {
  title: "รีวิวพนักงานดูแล | KIN Rehabilitation & Homecare",
  description: "ให้คะแนนและคำชมพนักงานที่ดูแลคนที่ท่านรัก",
  robots: { index: false },
};

/** หน้าสาธารณะสำหรับครอบครัว: รีวิวพนักงานที่ดูแลผู้รับบริการ (เข้าได้เฉพาะลิงก์ที่สาขาสร้างให้) */
export default function Page({ params }: { params: { token: string } }) {
  return <ReviewApp token={params.token} />;
}
