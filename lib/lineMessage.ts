import { balanceOf, Invoice, money, PARTIAL } from "./billing";
import { payChannels } from "./contractText";

/**
 * ข้อความแจ้งยอดส่งให้ญาติทาง LINE (คัดลอกไปวาง ไม่ได้เชื่อมต่อ LINE)
 *  ชื่อ · เลขที่ใบ · รอบบริการ · ยอดที่ต้องชำระ (ชำระบางส่วน = ยอดคงเหลือ) · ช่องทางชำระตามบริษัทของสาขา
 *  ยังไม่ใส่ QR พร้อมเพย์ (ตัดสินใจไว้แล้ว)
 */
export function lineMessage(x: Invoice, o: { branch: string; legal?: string | null; period?: string }) {
  const left = balanceOf(x);
  return [
    `เรียน ญาติของ${x.who}`,
    `KIN สาขา${o.branch} ขอแจ้งยอดค่าบริการ`,
    `• ${x.no ? `ใบแจ้งหนี้ ${x.no}` : "ใบแจ้งหนี้"}`,
    ...(o.period ? [`• รอบบริการ ${o.period}`] : []),
    x.status === PARTIAL ? `• ยอดคงเหลือ ${money(left)} บาท (จากทั้งหมด ${money(x.net)} บาท)` : `• ยอดชำระ ${money(left)} บาท`,
    "ช่องทางชำระ",
    ...payChannels(o.legal).map((c) => `- ${c}`),
    "ชำระแล้วส่งสลิปในแชทนี้ได้เลย ขอบคุณที่ใช้บริการ KIN",
  ].join("\n");
}

/** คัดลอกลงคลิปบอร์ด · ไม่ได้ (เบราว์เซอร์ไม่อนุญาต) = false */
export async function copyToClipboard(text: string) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
