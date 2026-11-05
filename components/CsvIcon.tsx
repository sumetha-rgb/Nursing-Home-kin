/** ไอคอนไฟล์ CSV ใช้กับปุ่มส่งออกข้อมูลทุกปุ่ม (เปิดด้วย Excel หรือ Google Sheets ได้) · ป้าย CSV กว้างเต็มไอคอนให้อ่านออกที่ 20px */
export default function CsvIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} aria-hidden="true">
      <path d="M7 1.5h8.5L21 7v14.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1Z" fill="#fff" stroke="#8B6E3E" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M15.5 1.5V7H21" fill="none" stroke="#8B6E3E" strokeWidth="1.3" strokeLinejoin="round" />
      <rect x="0.5" y="10" width="19.5" height="10" rx="2" fill="#2E7D52" />
      <text x="10.25" y="18" textAnchor="middle" fontSize="8.4" fontWeight="800" fill="#fff" fontFamily="Arial, Helvetica, sans-serif" textLength="15.5" lengthAdjust="spacingAndGlyphs">CSV</text>
    </svg>
  );
}
