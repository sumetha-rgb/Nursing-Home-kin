/** KPI พนักงาน: 4 ส่วน คิดเป็นคะแนน 0–100 แล้วรวมตามน้ำหนัก (ใช้ทั้งฝั่ง server และหน้าเว็บ) */
export const KPI_PARTS = [
  { key: "family", label: "ดาวจากครอบครัว", how: "ค่าเฉลี่ยดาวรีวิวจากญาติ ÷ 5 × 100" },
  { key: "manager", label: "ดาวจากผู้จัดการ", how: "ค่าเฉลี่ยดาวที่ผู้จัดการให้ตอนตรวจงาน ÷ 5 × 100" },
  { key: "tasks", label: "งานที่ส่ง", how: "จำนวนงานที่ส่งในเดือน เทียบกับคนที่ส่งมากที่สุดในสาขา (= 100)" },
  { key: "punctual", label: "มาตรงเวลา", how: "เช็คชื่อตรงเวลา ÷ เวรในตารางที่ถึงวันแล้ว × 100 (ไม่เช็คชื่อ = ไม่ตรงเวลา)" },
] as const;
export type KpiKey = (typeof KPI_PARTS)[number]["key"];
export type Weights = Record<KpiKey, number>;
export const DEFAULT_WEIGHTS: Weights = { family: 40, manager: 30, tasks: 20, punctual: 10 };

export type KpiRow = {
  id: string; name: string; branch: string; role: string; rank: number;
  total: number | null;
  family: { avg: number | null; n: number; score: number | null } | null;
  manager: { avg: number | null; n: number; score: number | null } | null;
  tasks: { n: number; score: number | null } | null;
  punctual: { ontime: number; late: number; missed: number; scheduled: number; score: number | null } | null;
};
export type KpiResp = { month: string; branch: string | null; weights: Weights; rows: KpiRow[]; me: string; canEdit: boolean };

/** รวมคะแนนตามน้ำหนัก · ส่วนที่ยังไม่มีข้อมูลไม่นับ แล้วเกลี่ยน้ำหนักที่เหลือให้ครบ 100 */
export function totalOf(scores: Partial<Record<KpiKey, number | null>>, w: Weights) {
  let sum = 0, weight = 0;
  for (const p of KPI_PARTS) { const s = scores[p.key]; if (s != null && w[p.key] > 0) { sum += s * w[p.key]; weight += w[p.key]; } }
  return weight ? Math.round((sum / weight) * 10) / 10 : null;
}
/** คะแนนที่ส่วนนี้ช่วยให้ (ตามน้ำหนักที่เกลี่ยแล้ว) */
export function pointsOf(key: KpiKey, scores: Partial<Record<KpiKey, number | null>>, w: Weights) {
  const used = KPI_PARTS.filter((p) => scores[p.key] != null && w[p.key] > 0).reduce((a, p) => a + w[p.key], 0);
  const s = scores[key];
  return s == null || !used ? null : Math.round(((s * w[key]) / used) * 10) / 10;
}
