/** ตัวเลือกช่วยกรอกในหน้าเปิดสัญญา (พิมพ์เพิ่มเองได้ทุกช่อง) */

/** ค่าที่หมายถึง "ไม่มีประวัติแพ้" · สัญญาพิมพ์ว่า "ปฏิเสธ" */
export const NO_ALLERGY = "ไม่มีประวัติแพ้";
export const isNoAllergy = (v?: string | null) => !v || !v.trim() || v.trim() === "-" || /^(ไม่มีประวัติแพ้|ปฏิเสธ|ไม่แพ้|ไม่มี)$/.test(v.trim());

export const RELATIONS = ["บุตร", "บุตรสาว", "หลาน", "คู่สมรส", "พี่น้อง", "ญาติ", "ตนเอง"];
export const HEALTH_RIGHTS = ["บัตรทอง", "ประกันสังคม", "ข้าราชการ", "ประกันเอกชน", "ชำระเอง"];
/** ยังไม่รู้ชื่อโรงพยาบาลตอนเปิดสัญญา · พิมพ์ในสัญญาแทนชื่อ ให้ทีมรู้ว่าต้องตามต่อ */
export const HOSP_LATER = "ญาติแจ้งภายหลัง";

/** ยา/กลุ่มยาที่แพ้บ่อย */
export const ALLERGY_DRUGS = [
  "Penicillin", "Amoxicillin", "Ampicillin", "Cephalosporin", "Sulfonamide (Sulfa)", "Co-trimoxazole", "Aspirin", "NSAIDs", "Ibuprofen", "Diclofenac",
  "Naproxen", "Paracetamol", "Codeine", "Morphine", "Tramadol", "Allopurinol", "Carbamazepine", "Phenytoin", "Lamotrigine", "Ciprofloxacin",
  "Levofloxacin", "Erythromycin", "Clarithromycin", "Azithromycin", "Tetracycline", "Doxycycline", "Metronidazole", "Vancomycin", "Contrast media (สารทึบรังสี)", "Iodine",
  "Latex (ยางลาเท็กซ์)", "Heparin", "Insulin", "ACE inhibitors",
];
export const FOOD_ALLERGENS = ["อาหารทะเล", "กุ้ง", "ปู", "ปลา", "นมวัว", "ไข่", "ถั่วลิสง", "ถั่วเหลือง", "แป้งสาลี (กลูเตน)", "งา", "ผงชูรส"];

/** ยาที่ผู้สูงอายุใช้ประจำบ่อย */
export const COMMON_MEDS = [
  "Amlodipine", "Losartan", "Enalapril", "Hydrochlorothiazide", "Atenolol", "Metoprolol", "Carvedilol", "Furosemide", "Spironolactone", "Simvastatin",
  "Atorvastatin", "Rosuvastatin", "Metformin", "Glipizide", "Gliclazide", "Pioglitazone", "Insulin", "Aspirin", "Clopidogrel", "Warfarin",
  "Apixaban", "Rivaroxaban", "Omeprazole", "Pantoprazole", "Ranitidine", "Levothyroxine", "Allopurinol", "Colchicine", "Calcium carbonate", "Vitamin D",
  "Folic acid", "Ferrous sulfate", "Vitamin B complex", "Donepezil", "Memantine", "Rivastigmine", "Levodopa/Carbidopa", "Quetiapine", "Risperidone", "Sertraline",
  "Lorazepam", "Gabapentin", "Pregabalin", "Paracetamol", "Tramadol", "Senna", "Lactulose", "Bisacodyl", "Tamsulosin", "Finasteride",
  "Salbutamol", "Budesonide", "Prednisolone", "ยาความดัน", "ยาเบาหวาน", "ยาไขมัน", "ยาละลายลิ่มเลือด", "ยาหยอดตา", "ออกซิเจน", "สายให้อาหาร", "แพมเพิส / ผ้าอ้อม",
];

/** วันสิ้นสุด = วันเริ่ม + n เดือน − 1 วัน (เช่น เริ่ม 1 พ.ย. 1 เดือน สิ้นสุด 30 พ.ย.) */
export function addMonthsIso(start: string, n: number) {
  const [y, m, d] = start.split("-").map(Number);
  if (!y || !m || !d) return "";
  const t = new Date(Date.UTC(y, m - 1 + n, d));
  if (t.getUTCDate() !== d) t.setUTCDate(0); // 31 ม.ค. + 1 เดือน = สิ้นเดือน ก.พ.
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
}
