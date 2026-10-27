import type { Metadata, Viewport } from "next";
import StaffApp from "./StaffApp";

export const metadata: Metadata = {
  title: "KinApp | KIN Rehabilitation & Homecare",
  manifest: "/kinapp.webmanifest",
  appleWebApp: { capable: true, title: "KinApp", statusBarStyle: "default" },
  icons: { icon: "/logo-mark.png", apple: "/icons/apple-touch-icon.png" },
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#8B6E3E" };

export default function Page() {
  return <StaffApp />;
}
