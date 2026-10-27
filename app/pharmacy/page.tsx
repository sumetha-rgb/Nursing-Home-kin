import type { Metadata } from "next";
import PharmacyApp from "./PharmacyApp";

export const metadata: Metadata = { title: "KIN MedCare | ระบบบริหารจัดการยา" };

export default function Page() {
  return <PharmacyApp />;
}
