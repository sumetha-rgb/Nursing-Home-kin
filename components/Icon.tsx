const P: Record<string, string> = {
  arrow: "M4 12h16m-6-6 6 6-6 6",
  chart: "M4 4v16h17M8 15V9m5 6V6m5 9v-4",
  flow: "M6 3v6m0 0a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm0 0V9a6 6 0 0 0-6-6H9",
  doc: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5M9 13h6M9 17h6",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-8 9a8 8 0 0 1 16 0",
  table: "M3 5h18v14H3V5Zm0 5h18M9 5v14",
  check: "m5 12 5 5L20 7",
  calendar: "M7 3v3m10-3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z",
  heart: "M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z",
  chat: "M4 5h16v11H9l-5 4V5Z",
  grid: "M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z",
  files: "M8 3h8l4 4v12H8V3Zm-4 4v14h12",
  building: "M5 21V4h9v17M14 9h5v12M9 8h1m-1 4h1m-1 4h1M3 21h18",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6",
  id: "M3 5h18v14H3V5Zm5 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm-3 7a3 3 0 0 1 6 0m4-7h4m-4 4h4",
  cpu: "M7 7h10v10H7V7Zm3-4v4m4-4v4m-4 10v4m4-4v4M3 10h4m-4 4h4m10-4h4m-4 4h4",
  upload: "M12 16V4m0 0-4 4m4-4 4 4M4 16v4h16v-4",
  book: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5Zm2 14h13v2H6",
  code: "m8 8-5 4 5 4m8-8 5 4-5 4m-3-10-2 12",
  pill: "M10.5 20.5 3.5 13.5a4.95 4.95 0 0 1 7-7l7 7a4.95 4.95 0 0 1-7 7ZM8.5 8.5l7 7",
  trophy: "M8 4h8v5a4 4 0 0 1-8 0V4ZM4 5h4v2a3 3 0 0 1-3 3M20 5h-4v2a3 3 0 0 0 3 3M12 13v4m-3 3h6",
  camera: "M4 8h3l2-3h6l2 3h3v11H4V8Zm8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  bell: "M6 17V11a6 6 0 0 1 12 0v6l2 2H4l2-2Zm4 4h4",
  phone: "M7 3h10v18H7V3Zm4 15h2",
  alert: "M12 4 3 20h18L12 4Zm0 6v4m0 3v.01",
  send: "M4 12 20 4l-4 16-4-6-8-2Z",
  menu: "M4 6h16M4 12h16M4 18h16",
  close: "M6 6l12 12M18 6 6 18",
  search: "m21 21-4.3-4.3M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Z",
  download: "M12 4v12m0 0-4-4m4 4 4-4M4 20h16",
  plus: "M12 5v14M5 12h14",
  lock: "M7 11V8a5 5 0 0 1 10 0v3M6 11h12v10H6V11Z",
  mail: "M3 6h18v12H3V6Zm0 0 9 7 9-7",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  logout: "M10 4H5v16h5m4-4 4-4-4-4m4 4H9",
  chevron: "m6 9 6 6 6-6",
  external: "M14 4h6v6m0-6-9 9M18 14v5H5V6h5",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7",
  qr: "M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h2v2h-2v-2Zm4 0h2v2h-2v-2Zm-4 4h2v2h-2v-2Zm4 0h2v2h-2v-2Z",
  print: "M7 9V3h10v6M7 17H4v-7h16v7h-3m-10-3h10v7H7v-7Z",
};

export default function Icon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={P[name] ?? P.doc} />
    </svg>
  );
}

