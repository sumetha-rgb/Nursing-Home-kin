import type { Metadata } from "next";
import PharmacyApp from "./PharmacyApp";

export const metadata: Metadata = {
  title: "KIN MedCare | ระบบบริหารจัดการยา",
  manifest: "/kinapp.webmanifest",
  appleWebApp: { capable: true, title: "KinApp" },
  icons: { icon: "/logo-mark.png", apple: "/icons/apple-touch-icon.png" },
};

export default function Page() {
  return <PharmacyApp />;
}
