import type { Metadata, Viewport } from "next";
import { Noto_Sans_Thai } from "next/font/google";
import "./globals.css";
import Spotlight from "@/components/Spotlight";
const thai = Noto_Sans_Thai({subsets:["thai","latin"],weight:["400","500","600","700"],variable:"--font-thai",display:"swap"});
export const metadata: Metadata = {title:"KIN | The Art of Care",description:"พื้นที่ทำงานสำหรับทุกการดูแล · KIN Care Management",icons:{icon:"/logo-mark.png"}};
export const viewport: Viewport = {width:"device-width",initialScale:1,themeColor:"#8B6E3E"};
export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="th" className={thai.variable}><body className="min-h-dvh"><Spotlight />{children}</body></html>;
}
