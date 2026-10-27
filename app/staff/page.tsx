import type { Metadata } from "next";
import StaffApp from "./StaffApp";

export const metadata: Metadata = { title: "CG2 App | KIN Rehabilitation & Homecare" };

export default function Page() {
  return <StaffApp />;
}
