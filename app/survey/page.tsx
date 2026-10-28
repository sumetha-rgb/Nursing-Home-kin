import type { Metadata } from "next";
import SurveyApp from "./SurveyApp";

export const metadata: Metadata = {
  title: "แบบประเมินและแจ้งเรื่อง | KIN Rehabilitation & Homecare",
  description: "ช่องทางสำหรับครอบครัวและญาติ ประเมินความพึงพอใจหรือแจ้งเรื่องถึงผู้จัดการสาขา",
  robots: { index: false },
};

/** หน้าสาธารณะสำหรับครอบครัว/ญาติ (ไม่ต้องเข้าสู่ระบบ) · /survey?branch=สาขา&type=survey|complaint */
export default function Page({ searchParams }: { searchParams: { branch?: string; type?: string } }) {
  return <SurveyApp branch={searchParams.branch ?? ""} initial={searchParams.type === "complaint" ? "complaint" : "survey"} />;
}
