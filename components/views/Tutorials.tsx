"use client";
import TutorialVideos from "../TutorialVideos";
import { useSession } from "@/lib/session";
import { TUTORIALS } from "@/lib/tutorials";
import { PageHeader } from "../ui";

/** วิดีโอสอนใช้งาน: แสดงคลิปที่เกี่ยวกับตำแหน่งของผู้ใช้ */
export function Tutorials() {
  const { user } = useSession();
  const only = user ? TUTORIALS.filter((t) => t.roles.includes(user.role)).map((t) => t.no) : undefined;
  return (
    <>
      <PageHeader title="วิดีโอสอนใช้งาน" sub="คลิปสั้นทีละขั้นตอนของแต่ละตำแหน่ง กดที่คลิปเพื่อเล่น · ส่งต่อให้พนักงานใหม่ดูก่อนเริ่มงานได้" />
      <TutorialVideos only={only} />
    </>
  );
}
