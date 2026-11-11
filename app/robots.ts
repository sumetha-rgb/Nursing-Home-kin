import type { MetadataRoute } from "next";

/** ระบบงานภายใน: ไม่ให้เครื่องมือค้นหาเก็บหน้าใดเลย (ทุกหน้ามี noindex ใน app/layout.tsx ด้วย) */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
