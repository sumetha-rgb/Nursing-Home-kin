import { sql } from "@/lib/db";
import { cfgOfMinutes, DEFAULT_SHIFT, type ShiftCfg } from "@/lib/shifts";

/**
 * เวลากะของแต่ละสาขา (server · lib/shifts) · อ่านจากตาราง branch_shifts แล้วจำไว้ 30 วินาที
 *  SQL ที่ต้องใช้เวลากะใช้ SHIFT_DAY_MIN_SQL / SHIFT_NIGHT_MIN_SQL (นาทีนับจากเที่ยงคืน) แทนการเขียน 07:00 / 19:00 ตายตัว
 */
let cache: { at: number; map: Map<string, ShiftCfg> } | null = null;
export async function shiftCfgs(): Promise<Map<string, ShiftCfg>> {
  if (cache && Date.now() - cache.at < 30e3) return cache.map;
  const rows = (await sql(`SELECT branch_name AS name, day_min, night_min FROM branch_shifts`)) as { name: string; day_min: number; night_min: number }[];
  cache = { at: Date.now(), map: new Map(rows.map((r) => [r.name, cfgOfMinutes(r.day_min, r.night_min)])) };
  return cache.map;
}
export const clearShiftCache = () => { cache = null; };
export async function shiftCfgOf(branch: string | null | undefined): Promise<ShiftCfg> {
  if (!branch) return DEFAULT_SHIFT;
  return (await shiftCfgs()).get(branch) ?? DEFAULT_SHIFT;
}
/** นิพจน์ SQL: นาทีที่เริ่มกะเช้า / กะดึกของสาขาในคอลัมน์ col (ไม่ได้ตั้ง = 420 / 1140) */
export const SHIFT_DAY_MIN_SQL = (col: string) => `coalesce((SELECT bs.day_min FROM branch_shifts bs WHERE bs.branch_name = ${col}), ${DEFAULT_SHIFT.d * 60})`;
export const SHIFT_NIGHT_MIN_SQL = (col: string) => `coalesce((SELECT bs.night_min FROM branch_shifts bs WHERE bs.branch_name = ${col}), ${DEFAULT_SHIFT.n * 60})`;
