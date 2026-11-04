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
      <PageHeader title="วิดีโอสอนใช้งาน" sub="คลิปสั้นทีละขั้นของแต่ละตำแหน่ง" />
      <TutorialVideos only={only} />
    </>
  );
}
